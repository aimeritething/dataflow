import { NextRequest, NextResponse } from 'next/server';

interface ImportDatabaseParams {
    type: string;
    host: string;
    port: string;
    user: string;
    password: string;
    database: string;
    format: string;
}

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File;

        const params: ImportDatabaseParams = {
            type: formData.get('type') as string,
            host: formData.get('host') as string,
            port: formData.get('port') as string,
            user: formData.get('user') as string,
            password: formData.get('password') as string,
            database: formData.get('database') as string,
            format: formData.get('format') as string,
        };

        console.log('[Import Database API] Received request:', {
            fileName: file?.name,
            fileSize: file?.size,
            type: params.type,
            database: params.database,
            format: params.format
        });

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        if (!params.database) {
            return NextResponse.json({ error: 'No database name provided' }, { status: 400 });
        }

        // Read file content
        const fileContent = await file.text();

        // Create a TransformStream for streaming response
        const encoder = new TextEncoder();
        const stream = new TransformStream();
        const writer = stream.writable.getWriter();

        // Start async import process
        (async () => {
            try {
                await sendProgress(writer, encoder, 5, 'Preparing to import...');

                if (params.type === 'mysql') {
                    await importDatabaseMySQL(params, fileContent, writer, encoder);
                } else if (params.type === 'postgres' || params.type === 'postgresql') {
                    await importDatabasePostgreSQL(params, fileContent, writer, encoder);
                } else if (params.type === 'mongodb') {
                    await importDatabaseMongoDB(params, fileContent, writer, encoder);
                } else {
                    throw new Error(`Unsupported database type: ${params.type}`);
                }

            } catch (error: any) {
                console.error('[Import Database API] Error:', error);
                const errorData = JSON.stringify({
                    error: error.message,
                    progress: 0
                });
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
        console.error('[Import Database API] Request error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

async function sendProgress(
    writer: WritableStreamDefaultWriter,
    encoder: TextEncoder,
    progress: number,
    message: string
) {
    const data = JSON.stringify({ progress, message });
    await writer.write(encoder.encode(`data: ${data}\n\n`));
}

/**
 * Parse SQL content into individual statements, handling quoted strings correctly.
 */
function parseSQLStatements(sqlContent: string): string[] {
    const statements: string[] = [];
    let currentStatement = '';
    let inString = false;
    let stringChar = '';
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < sqlContent.length; i++) {
        const char = sqlContent[i];
        const nextChar = sqlContent[i + 1] || '';
        const prevChar = i > 0 ? sqlContent[i - 1] : '';

        // Handle block comments
        if (!inString && !inLineComment && char === '/' && nextChar === '*') {
            inBlockComment = true;
            i++;
            continue;
        }
        if (inBlockComment && char === '*' && nextChar === '/') {
            inBlockComment = false;
            i++;
            continue;
        }
        if (inBlockComment) continue;

        // Handle line comments
        if (!inString && char === '-' && nextChar === '-') {
            inLineComment = true;
            continue;
        }
        if (inLineComment && char === '\n') {
            inLineComment = false;
            currentStatement += '\n';
            continue;
        }
        if (inLineComment) continue;

        // Handle strings
        if (!inString && (char === "'" || char === '"')) {
            inString = true;
            stringChar = char;
        } else if (inString && char === stringChar && prevChar !== '\\') {
            inString = false;
        }

        // Handle statement end
        if (char === ';' && !inString) {
            const stmt = currentStatement.trim();
            if (stmt.length > 0) {
                statements.push(stmt);
            }
            currentStatement = '';
        } else {
            currentStatement += char;
        }
    }

    // Handle last statement without semicolon
    const lastStmt = currentStatement.trim();
    if (lastStmt.length > 0) {
        statements.push(lastStmt);
    }

    return statements;
}

/**
 * Import database for MySQL - executes SQL statements directly
 */
async function importDatabaseMySQL(
    params: ImportDatabaseParams,
    sqlContent: string,
    writer: WritableStreamDefaultWriter,
    encoder: TextEncoder
) {
    const mysql = require('mysql2/promise');

    await sendProgress(writer, encoder, 10, 'Connecting to MySQL...');

    // First, check if database exists and create it if not
    const connectionWithoutDb = await mysql.createConnection({
        host: params.host,
        port: parseInt(params.port),
        user: params.user,
        password: params.password,
        multipleStatements: true,
    });

    try {
        await sendProgress(writer, encoder, 15, `Checking database "${params.database}"...`);

        // Check if database exists
        const [databases] = await connectionWithoutDb.query(
            'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
            [params.database]
        );

        if (!Array.isArray(databases) || databases.length === 0) {
            await sendProgress(writer, encoder, 20, `Creating database "${params.database}"...`);
            await connectionWithoutDb.query(`CREATE DATABASE \`${params.database}\``);
            console.log('[Import Database MySQL] Created database:', params.database);
        }
    } finally {
        await connectionWithoutDb.end();
    }

    // Now connect to the target database
    const connection = await mysql.createConnection({
        host: params.host,
        port: parseInt(params.port),
        user: params.user,
        password: params.password,
        database: params.database,
        multipleStatements: true,
    });

    try {
        await sendProgress(writer, encoder, 25, 'Parsing SQL statements...');

        const statements = parseSQLStatements(sqlContent);
        console.log('[Import Database MySQL] Total statements found:', statements.length);

        if (statements.length === 0) {
            throw new Error('No SQL statements found in the file');
        }

        await sendProgress(writer, encoder, 30, `Found ${statements.length} statements. Executing...`);

        // Disable foreign key checks for import
        await connection.query('SET FOREIGN_KEY_CHECKS = 0');

        const totalStatements = statements.length;
        let executedCount = 0;
        let errorCount = 0;

        for (let i = 0; i < totalStatements; i++) {
            const stmt = statements[i];

            try {
                await connection.query(stmt);
                executedCount++;
            } catch (err: any) {
                console.error('[Import Database MySQL] Error executing statement:', err.message);
                // Skip certain non-critical errors
                if (err.code === 'ER_TABLE_EXISTS_ERROR' ||
                    err.code === 'ER_DUP_ENTRY' ||
                    err.code === 'ER_DB_CREATE_EXISTS') {
                    console.log('[Import Database MySQL] Skipping non-critical error:', err.code);
                    errorCount++;
                } else {
                    throw new Error(`Failed at statement ${i + 1}: ${err.message}`);
                }
            }

            // Update progress every 10 statements or at the end
            if ((i + 1) % 10 === 0 || i === totalStatements - 1) {
                const progress = 30 + Math.round(((i + 1) / totalStatements) * 65);
                await sendProgress(
                    writer, encoder, progress,
                    `Executed ${i + 1}/${totalStatements} statements...`
                );
            }
        }

        // Re-enable foreign key checks
        await connection.query('SET FOREIGN_KEY_CHECKS = 1');

        const successMessage = errorCount > 0
            ? `Import complete! Executed ${executedCount} statements (${errorCount} skipped).`
            : `Import complete! Executed ${executedCount} statements.`;

        await sendProgress(writer, encoder, 100, successMessage);

    } finally {
        await connection.end();
    }
}

/**
 * Import database for PostgreSQL - executes SQL statements directly
 */
async function importDatabasePostgreSQL(
    params: ImportDatabaseParams,
    sqlContent: string,
    writer: WritableStreamDefaultWriter,
    encoder: TextEncoder
) {
    const { Client } = require('pg');

    await sendProgress(writer, encoder, 10, 'Connecting to PostgreSQL...');

    // First, connect to 'postgres' database to check/create target database
    const adminClient = new Client({
        host: params.host,
        port: parseInt(params.port),
        user: params.user,
        password: params.password,
        database: 'postgres', // Connect to default postgres database first
    });

    try {
        await adminClient.connect();
        await sendProgress(writer, encoder, 15, `Checking database "${params.database}"...`);

        // Check if database exists
        const dbResult = await adminClient.query(
            'SELECT datname FROM pg_database WHERE datname = $1',
            [params.database]
        );

        if (dbResult.rows.length === 0) {
            await sendProgress(writer, encoder, 20, `Creating database "${params.database}"...`);
            // PostgreSQL doesn't allow parameterized CREATE DATABASE
            await adminClient.query(`CREATE DATABASE "${params.database}"`);
            console.log('[Import Database PostgreSQL] Created database:', params.database);
        }
    } finally {
        await adminClient.end();
    }

    // Now connect to the target database
    const client = new Client({
        host: params.host,
        port: parseInt(params.port),
        user: params.user,
        password: params.password,
        database: params.database,
    });

    try {
        await client.connect();
        await sendProgress(writer, encoder, 25, 'Parsing SQL statements...');

        const statements = parseSQLStatements(sqlContent);
        console.log('[Import Database PostgreSQL] Total statements found:', statements.length);

        if (statements.length === 0) {
            throw new Error('No SQL statements found in the file');
        }

        await sendProgress(writer, encoder, 30, `Found ${statements.length} statements. Executing...`);

        // Start a transaction for atomicity (optional, can be removed for large imports)
        // await client.query('BEGIN');

        const totalStatements = statements.length;
        let executedCount = 0;
        let errorCount = 0;

        for (let i = 0; i < totalStatements; i++) {
            const stmt = statements[i];

            try {
                await client.query(stmt);
                executedCount++;
            } catch (err: any) {
                console.error('[Import Database PostgreSQL] Error executing statement:', err.message);
                // Skip certain non-critical errors
                if (err.code === '42P07' || // duplicate_table
                    err.code === '23505' || // unique_violation
                    err.code === '42P04') { // duplicate_database
                    console.log('[Import Database PostgreSQL] Skipping non-critical error:', err.code);
                    errorCount++;
                } else {
                    throw new Error(`Failed at statement ${i + 1}: ${err.message}`);
                }
            }

            // Update progress every 10 statements or at the end
            if ((i + 1) % 10 === 0 || i === totalStatements - 1) {
                const progress = 30 + Math.round(((i + 1) / totalStatements) * 65);
                await sendProgress(
                    writer, encoder, progress,
                    `Executed ${i + 1}/${totalStatements} statements...`
                );
            }
        }

        // await client.query('COMMIT');

        const successMessage = errorCount > 0
            ? `Import complete! Executed ${executedCount} statements (${errorCount} skipped).`
            : `Import complete! Executed ${executedCount} statements.`;

        await sendProgress(writer, encoder, 100, successMessage);

    } finally {
        await client.end();
    }
}

/**
 * Import database for MongoDB - parses JSON and inserts documents
 */
async function importDatabaseMongoDB(
    params: ImportDatabaseParams,
    fileContent: string,
    writer: WritableStreamDefaultWriter,
    encoder: TextEncoder
) {
    const { MongoClient } = require('mongodb');

    await sendProgress(writer, encoder, 10, 'Connecting to MongoDB...');

    // Build connection URI
    let uri: string;
    if (params.host.startsWith('mongodb')) {
        uri = params.host;
    } else {
        const auth = params.user && params.password
            ? `${encodeURIComponent(params.user)}:${encodeURIComponent(params.password)}@`
            : '';
        uri = `mongodb://${auth}${params.host}:${params.port}/?authSource=admin`;
    }

    const client = new MongoClient(uri, {
        directConnection: true,
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000,
    });

    try {
        await client.connect();
        await sendProgress(writer, encoder, 15, `Connecting to database "${params.database}"...`);

        const db = client.db(params.database);

        await sendProgress(writer, encoder, 20, 'Parsing JSON data...');

        // Parse JSON content
        let importData: any;
        try {
            importData = JSON.parse(fileContent);
        } catch (e) {
            throw new Error('Invalid JSON file format');
        }

        // Expected format: { tables: { collectionName: { data: [...], columns: [...] }, ... } }
        const tables = importData.tables || importData;
        const collectionNames = Object.keys(tables);

        if (collectionNames.length === 0) {
            throw new Error('No collections found in import file');
        }

        await sendProgress(writer, encoder, 25, `Found ${collectionNames.length} collections. Importing...`);

        const totalCollections = collectionNames.length;
        let totalDocuments = 0;
        let importedDocuments = 0;

        // Count total documents
        for (const collectionName of collectionNames) {
            const collectionData = tables[collectionName];
            if (collectionData.data && Array.isArray(collectionData.data)) {
                totalDocuments += collectionData.data.length;
            }
        }

        // Import each collection
        for (let i = 0; i < totalCollections; i++) {
            const collectionName = collectionNames[i];
            const collectionData = tables[collectionName];

            const documents = collectionData.data || collectionData;
            if (!Array.isArray(documents) || documents.length === 0) {
                continue;
            }

            const progress = 25 + Math.round(((i + 1) / totalCollections) * 70);
            await sendProgress(
                writer, encoder, progress,
                `Importing ${collectionName} (${i + 1}/${totalCollections})...`
            );

            const collection = db.collection(collectionName);

            // Insert documents in batches of 100
            const batchSize = 100;
            for (let j = 0; j < documents.length; j += batchSize) {
                const batch = documents.slice(j, j + batchSize);
                try {
                    await collection.insertMany(batch, { ordered: false });
                    importedDocuments += batch.length;
                } catch (err: any) {
                    // Handle duplicate key errors gracefully
                    if (err.code === 11000) {
                        console.log(`[Import Database MongoDB] Skipping duplicates in ${collectionName}`);
                        // Count successful inserts from writeErrors
                        const successCount = batch.length - (err.writeErrors?.length || 0);
                        importedDocuments += successCount;
                    } else {
                        throw err;
                    }
                }
            }
        }

        const successMessage = `Import complete! Imported ${importedDocuments} documents into ${totalCollections} collections.`;
        await sendProgress(writer, encoder, 100, successMessage);

    } finally {
        await client.close();
    }
}
