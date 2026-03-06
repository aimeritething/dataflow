import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

interface ExportCollectionRequest {
    connectionId: string;
    databaseName: string;
    collectionName: string;
    format: 'csv' | 'json';
    filter?: any;
    limit?: number;
    // Connection details (passed from frontend)
    type?: string;
    host?: string;
    port?: string;
    user?: string;
    password?: string;
}

export async function POST(req: NextRequest) {
    try {
        const body: ExportCollectionRequest = await req.json();
        const { connectionId, databaseName, collectionName, format, filter, limit, type, host, port, user, password } = body;

        console.log('[Export Collection API] Received request:', { connectionId, databaseName, collectionName, format, limit });

        // Create a TransformStream for streaming response
        const encoder = new TextEncoder();
        const stream = new TransformStream();
        const writer = stream.writable.getWriter();

        // Start async export process
        (async () => {
            try {
                // Send initial progress
                await sendProgress(writer, encoder, 10, 'Connecting to database...');

                // Check if we have connection details
                if (!host || !port) {
                    throw new Error('Connection details are required. Please pass connection info from frontend.');
                }

                // Actually fetch and export MongoDB data
                const { data, columns } = await exportMongoDB(
                    { type, host, port, user, password },
                    databaseName,
                    collectionName,
                    limit,
                    filter ? JSON.stringify(filter) : undefined
                );

                await sendProgress(writer, encoder, 50, `Fetched ${data.length} documents...`);

                // Generate file based on format
                let fileContent: string;
                let fileName: string;
                let mimeType: string;

                await sendProgress(writer, encoder, 70, 'Generating export file...');

                if (format === 'csv') {
                    fileContent = generateCSV(columns, data);
                    fileName = `${collectionName}_export.csv`;
                    mimeType = 'text/csv';
                } else {
                    fileContent = JSON.stringify(data, null, 2);
                    fileName = `${collectionName}_export.json`;
                    mimeType = 'application/json';
                }

                await sendProgress(writer, encoder, 90, 'Preparing download...');

                // Encode as base64 data URL for download
                const base64Data = Buffer.from(fileContent).toString('base64');
                const dataUrl = `data:${mimeType};base64,${base64Data}`;

                await sendProgress(writer, encoder, 100, 'Export complete!', dataUrl, fileName);

            } catch (error: any) {
                console.error('[Export Collection API] Error:', error);
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
        console.error('[Export Collection API] Request error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

async function sendProgress(
    writer: WritableStreamDefaultWriter,
    encoder: TextEncoder,
    progress: number,
    message: string,
    downloadUrl?: string,
    fileName?: string
) {
    const data = JSON.stringify({
        progress,
        message,
        ...(downloadUrl && { downloadUrl }),
        ...(fileName && { fileName })
    });
    await writer.write(encoder.encode(`data: ${data}\n\n`));
}

async function exportMongoDB(connection: any, database: string, collection: string, rowCount?: number, filter?: string) {
    const { MongoClient } = require('mongodb');

    let uri: string;
    if (connection.host.startsWith('mongodb')) {
        uri = connection.host;
    } else {
        const auth = connection.user && connection.password
            ? `${encodeURIComponent(connection.user)}:${encodeURIComponent(connection.password)}@`
            : '';
        uri = `mongodb://${auth}${connection.host}:${connection.port}/${database}?authSource=admin`;
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

        // Build query
        let query = {};
        if (filter) {
            try {
                query = JSON.parse(filter);
            } catch (e) {
                console.warn('Failed to parse MongoDB filter, using empty query');
            }
        }

        let cursor = coll.find(query);
        if (rowCount) {
            cursor = cursor.limit(rowCount);
        }

        const documents = await cursor.toArray();

        // Get all unique keys from documents
        const allKeys = new Set<string>();
        documents.forEach((doc: any) => {
            Object.keys(doc).forEach(key => allKeys.add(key));
        });
        const columns = Array.from(allKeys);

        return { data: documents, columns };
    } finally {
        await client.close();
    }
}

function generateCSV(columns: string[], data: any[]): string {
    const escapeCSV = (value: any): string => {
        if (value === null || value === undefined) return '';

        // Handle ObjectId and other MongoDB types
        if (typeof value === 'object') {
            if (value._bsontype === 'ObjectId' || value.constructor?.name === 'ObjectId') {
                return value.toString();
            }
            return JSON.stringify(value);
        }

        const str = String(value);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    // Header row
    const header = columns.map(escapeCSV).join(',');

    // Data rows
    const rows = data.map(row =>
        columns.map(col => escapeCSV(row[col])).join(',')
    );

    return [header, ...rows].join('\n');
}
