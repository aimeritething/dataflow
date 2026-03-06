import { NextRequest, NextResponse } from 'next/server';

interface ImportCollectionRequest {
    connectionId: string;
    databaseName: string;
    collectionName: string;
    format: 'csv' | 'json';
    fileContent: string;  // Base64-encoded file content
    // Connection details (passed from frontend)
    type?: string;
    host?: string;
    port?: string;
    user?: string;
    password?: string;
}

export async function POST(req: NextRequest) {
    try {
        const body: ImportCollectionRequest = await req.json();
        const { connectionId, databaseName, collectionName, format, fileContent, type, host, port, user, password } = body;

        console.log('[Import Collection API] Received request:', { connectionId, databaseName, collectionName, format });

        // Create a TransformStream for streaming response
        const encoder = new TextEncoder();
        const stream = new TransformStream();
        const writer = stream.writable.getWriter();

        // Start async import process
        (async () => {
            try {
                // Send initial progress
                await sendProgress(writer, encoder, 5, 'Validating input...');

                // Check if we have connection details
                if (!host || !port) {
                    throw new Error('Connection details are required. Please pass connection info from frontend.');
                }

                if (!fileContent) {
                    throw new Error('File content is required');
                }

                await sendProgress(writer, encoder, 10, 'Parsing file content...');

                // Decode base64 file content
                const decodedContent = Buffer.from(fileContent, 'base64').toString('utf-8');

                // Parse documents based on format
                let documents: any[] = [];

                if (format === 'json') {
                    documents = parseJSON(decodedContent);
                } else if (format === 'csv') {
                    documents = parseCSV(decodedContent);
                } else {
                    throw new Error('Unsupported format');
                }

                if (documents.length === 0) {
                    throw new Error('No valid documents found in file');
                }

                await sendProgress(writer, encoder, 30, `Parsed ${documents.length} documents...`);

                // Connect to MongoDB and insert documents
                await sendProgress(writer, encoder, 40, 'Connecting to MongoDB...');

                const insertedCount = await importToMongoDB(
                    { type, host, port, user, password },
                    databaseName,
                    collectionName,
                    documents,
                    async (progress, message) => {
                        await sendProgress(writer, encoder, progress, message);
                    }
                );

                await sendProgress(writer, encoder, 100, `Import complete! Inserted ${insertedCount} documents.`, insertedCount);

            } catch (error: any) {
                console.error('[Import Collection API] Error:', error);
                const errorData = JSON.stringify({ error: error.message });
                await writer.write(encoder.encode(`data: ${errorData}\n\n`));
            } finally {
                await writer.close();
            }
        })();

        return new NextResponse(stream.readable, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });

    } catch (error: any) {
        console.error('[Import Collection API] Request error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

async function sendProgress(
    writer: WritableStreamDefaultWriter,
    encoder: TextEncoder,
    progress: number,
    message: string,
    insertedCount?: number
) {
    const data = JSON.stringify({
        progress,
        message,
        ...(insertedCount !== undefined && { insertedCount })
    });
    await writer.write(encoder.encode(`data: ${data}\n\n`));
}

function parseJSON(content: string): any[] {
    try {
        const parsed = JSON.parse(content);

        // Handle array of documents
        if (Array.isArray(parsed)) {
            return parsed;
        }

        // Handle single document
        if (typeof parsed === 'object' && parsed !== null) {
            return [parsed];
        }

        throw new Error('Invalid JSON format');
    } catch (e: any) {
        throw new Error(`Failed to parse JSON: ${e.message}`);
    }
}

function parseCSV(content: string): any[] {
    const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);

    if (lines.length < 2) {
        throw new Error('CSV must have at least a header row and one data row');
    }

    // Parse header
    const headers = parseCSVLine(lines[0]);

    // Parse data rows
    const documents: any[] = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length !== headers.length) {
            console.warn(`Skipping row ${i + 1}: column count mismatch`);
            continue;
        }

        const doc: any = {};
        headers.forEach((header, index) => {
            const value = values[index];
            // Try to parse numbers and booleans
            if (value === 'true') {
                doc[header] = true;
            } else if (value === 'false') {
                doc[header] = false;
            } else if (value === 'null' || value === '') {
                doc[header] = null;
            } else if (!isNaN(Number(value)) && value !== '') {
                doc[header] = Number(value);
            } else {
                doc[header] = value;
            }
        });
        documents.push(doc);
    }

    return documents;
}

function parseCSVLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (inQuotes) {
            if (char === '"' && nextChar === '"') {
                current += '"';
                i++;
            } else if (char === '"') {
                inQuotes = false;
            } else {
                current += char;
            }
        } else {
            if (char === '"') {
                inQuotes = true;
            } else if (char === ',') {
                values.push(current);
                current = '';
            } else {
                current += char;
            }
        }
    }
    values.push(current);

    return values;
}

async function importToMongoDB(
    connection: any,
    database: string,
    collection: string,
    documents: any[],
    onProgress: (progress: number, message: string) => Promise<void>
): Promise<number> {
    const { MongoClient } = require('mongodb');

    let uri: string;
    if (connection.host.startsWith('mongodb')) {
        uri = connection.host;
    } else {
        const auth = connection.user && connection.password
            ? `${encodeURIComponent(connection.user)}:${encodeURIComponent(connection.password)}@`
            : '';
        uri = `mongodb://${auth}${connection.host}:${connection.port}/${database}?authSource=admin&retryWrites=false`;
    }

    const client = new MongoClient(uri, {
        directConnection: true,
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000,
    });

    try {
        await client.connect();
        const db = client.db(database);
        const coll = db.collection(collection);

        await onProgress(50, 'Connected to MongoDB...');

        // Remove _id fields to let MongoDB generate new ones (if they exist as strings from CSV)
        const cleanedDocuments = documents.map(doc => {
            const { _id, ...rest } = doc;
            // Only keep _id if it looks like a valid ObjectId
            if (_id && typeof _id === 'string' && _id.length === 24) {
                try {
                    const { ObjectId } = require('mongodb');
                    return { _id: new ObjectId(_id), ...rest };
                } catch {
                    return rest;
                }
            }
            return rest;
        });

        await onProgress(60, `Inserting ${cleanedDocuments.length} documents...`);

        // Insert in batches for large datasets
        const batchSize = 1000;
        let insertedCount = 0;

        for (let i = 0; i < cleanedDocuments.length; i += batchSize) {
            const batch = cleanedDocuments.slice(i, i + batchSize);
            const result = await coll.insertMany(batch);
            insertedCount += result.insertedCount;

            const progress = 60 + Math.round((i / cleanedDocuments.length) * 35);
            await onProgress(progress, `Inserted ${insertedCount} of ${cleanedDocuments.length} documents...`);
        }

        await onProgress(95, 'Finalizing...');

        return insertedCount;
    } finally {
        await client.close();
    }
}
