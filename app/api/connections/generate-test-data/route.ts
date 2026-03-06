import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import { Pool } from 'pg';
import { generateTestDataWithAI } from '@/lib/ai/data-generator';

interface Column {
    name: string;
    type: string;
    nullable: boolean;
    defaultValue?: string;
    isAutoIncrement?: boolean;
}

// Helper to generate realistic data based on column type
function generateValueForColumn(column: Column, index: number): any {
    const { name, type } = column;
    const lowerName = name.toLowerCase();
    const lowerType = type.toLowerCase();

    // Note: Auto-increment columns are already filtered out before calling this function

    // For primary key ID columns (non-auto-increment), generate unique sequential values
    if (lowerName === 'id' && lowerType.includes('int')) {
        return index + 1; // Start from 1, ensure uniqueness
    }

    // Email fields
    if (lowerName.includes('email')) {
        return `user${index}@example.com`;
    }

    // Name fields
    if (lowerName.includes('first') && lowerName.includes('name')) {
        const names = ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda'];
        return names[index % names.length];
    }
    if (lowerName.includes('last') && lowerName.includes('name')) {
        const names = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis'];
        return names[index % names.length];
    }
    if (lowerName.includes('name') && !lowerName.includes('file') && !lowerName.includes('user')) {
        return `Name ${index}`;
    }

    // Status/Role fields
    if (lowerName.includes('status')) {
        const statuses = ['active', 'inactive', 'pending', 'completed'];
        return statuses[index % statuses.length];
    }
    if (lowerName.includes('role')) {
        const roles = ['admin', 'user', 'moderator', 'guest'];
        return roles[index % roles.length];
    }

    // Boolean fields
    if (lowerType.includes('bool') || lowerType.includes('bit')) {
        return index % 2 === 0;
    }

    // Numeric types
    if (lowerType.includes('int') || lowerType.includes('serial')) {
        return Math.floor(Math.random() * 1000) + 1;
    }
    if (lowerType.includes('decimal') || lowerType.includes('numeric') || lowerType.includes('float') || lowerType.includes('double')) {
        return (Math.random() * 1000).toFixed(2);
    }

    // Date/Time types
    if (lowerType.includes('date') || lowerType.includes('time')) {
        const now = new Date();
        const daysAgo = Math.floor(Math.random() * 365);
        const date = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

        if (lowerType.includes('timestamp')) {
            return date.toISOString();
        }
        return date.toISOString().split('T')[0];
    }

    // Text/VARCHAR types
    if (lowerType.includes('char') || lowerType.includes('text')) {
        if (lowerName.includes('description') || lowerName.includes('comment')) {
            return `Sample description for record ${index}`;
        }
        if (lowerName.includes('address')) {
            return `${100 + index} Main Street, City, State`;
        }
        if (lowerName.includes('phone')) {
            return `+1-555-${String(1000 + index).padStart(4, '0')}`;
        }
        return `Value ${index}`;
    }

    // JSON type
    if (lowerType.includes('json')) {
        return JSON.stringify({ key: `value_${index}`, index });
    }

    // Default fallback
    return `Data ${index}`;
}

export async function POST(request: NextRequest) {
    console.log('[Generate Test Data] ✅ API Route Called!');
    try {
        const body = await request.json();
        const { type, host, port, user, password, database, schema, table, rowCount, aiInstructions } = body;

        console.log(`[Generate Test Data] 📊 Request Parameters:`, {
            type,
            host,
            port,
            database,
            table,
            rowCount,
            aiInstructions: aiInstructions || '(none)'
        });
        console.log(`[Generate Test Data] Starting generation for ${database}.${table} - ${rowCount} rows`);

        // Create encoder for streaming response
        const encoder = new TextEncoder();
        const stream = new TransformStream();
        const writer = stream.writable.getWriter();

        // Send progress update
        const sendProgress = async (progress: number, message: string) => {
            await writer.write(encoder.encode(`data: ${JSON.stringify({ progress, message })}\n\n`));
        };

        // Start generation in background
        (async () => {
            try {
                await sendProgress(5, 'Connecting to database...');

                if (type === 'mysql') {
                    console.log('[Generate Test Data] 🔌 Attempting MySQL connection...');
                    const connection = await mysql.createConnection({
                        host,
                        port,
                        user,
                        password,
                        database,
                    });
                    console.log('[Generate Test Data] ✅ MySQL connected successfully');

                    await sendProgress(10, 'Analyzing table schema...');

                    // Get table schema including primary key info
                    const [columns] = await connection.execute(
                        `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_KEY
                         FROM INFORMATION_SCHEMA.COLUMNS
                         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
                         ORDER BY ORDINAL_POSITION`,
                        [database, table]
                    ) as any;

                    console.log('[Generate Test Data] 📋 Table columns:', columns);

                    // Get foreign key information
                    const [foreignKeys] = await connection.execute(
                        `SELECT 
                            COLUMN_NAME,
                            REFERENCED_TABLE_NAME,
                            REFERENCED_COLUMN_NAME
                         FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                         WHERE TABLE_SCHEMA = ? 
                           AND TABLE_NAME = ?
                           AND REFERENCED_TABLE_NAME IS NOT NULL`,
                        [database, table]
                    ) as any;

                    console.log('[Generate Test Data] 🔗 Foreign keys:', foreignKeys);

                    // Fetch valid IDs from parent tables for foreign keys
                    const foreignKeyValues: Record<string, any[]> = {};
                    for (const fk of foreignKeys) {
                        const parentTable = fk.REFERENCED_TABLE_NAME;
                        const parentColumn = fk.REFERENCED_COLUMN_NAME;
                        const childColumn = fk.COLUMN_NAME;

                        console.log(`[Generate Test Data] 📥 Fetching IDs from ${parentTable}.${parentColumn} for ${childColumn}...`);

                        try {
                            const [parentIds] = await connection.execute(
                                `SELECT DISTINCT \`${parentColumn}\` FROM \`${parentTable}\` LIMIT 1000`,
                                []
                            ) as any;

                            if (parentIds.length > 0) {
                                foreignKeyValues[childColumn] = parentIds.map((row: any) => row[parentColumn]);
                                console.log(`[Generate Test Data] ✅ Found ${parentIds.length} valid IDs for ${childColumn}`);
                            } else {
                                console.warn(`[Generate Test Data] ⚠️ No data in parent table ${parentTable}, will use random values`);
                                foreignKeyValues[childColumn] = [];
                            }
                        } catch (error: any) {
                            console.error(`[Generate Test Data] ❌ Error fetching parent IDs:`, error.message);
                            foreignKeyValues[childColumn] = [];
                        }
                    }

                    const tableColumns: Column[] = columns.map((col: any) => ({
                        name: col.COLUMN_NAME,
                        type: col.DATA_TYPE,
                        nullable: col.IS_NULLABLE === 'YES',
                        defaultValue: col.COLUMN_DEFAULT,
                        isAutoIncrement: col.EXTRA?.includes('auto_increment')  // Only skip if truly auto-increment
                    }));

                    console.log('[Generate Test Data] 🔍 Columns to skip (auto-increment only):',
                        tableColumns.filter(c => c.isAutoIncrement).map(c => c.name));

                    await sendProgress(20, 'Generating test data...');

                    // Filter out ONLY auto-increment columns
                    // Non-auto-increment primary keys will be included and get generated values
                    const insertableColumns = tableColumns.filter(col => !col.isAutoIncrement);
                    console.log('[Generate Test Data] ✏️ Columns to insert (including non-auto PK):', insertableColumns.map(c => c.name));

                    const columnNames = insertableColumns.map(c => `\`${c.name}\``).join(', ');

                    // Check if AI generation is requested
                    let aiGeneratedData: Record<string, any>[] | null = null;
                    if (aiInstructions && aiInstructions.trim()) {
                        console.log('[Generate Test Data] 🤖 AI instructions provided, attempting AI generation...');
                        await sendProgress(25, 'Using AI to generate data...');

                        const aiResult = await generateTestDataWithAI({
                            columns: insertableColumns,
                            rowCount,
                            aiInstructions,
                            tableName: table,
                            databaseType: 'mysql',
                        });

                        if (aiResult.success && aiResult.data) {
                            aiGeneratedData = aiResult.data;
                            console.log(`[Generate Test Data] ✅ AI generated ${aiGeneratedData.length} rows`);
                            await sendProgress(40, `AI generated ${aiGeneratedData.length} rows, inserting...`);
                        } else {
                            console.warn('[Generate Test Data] ⚠️ AI generation failed, falling back to rule-based:', aiResult.error);
                            await sendProgress(25, 'AI generation failed, using default generation...');
                        }
                    }

                    // Generate and insert data in batches
                    const batchSize = 50;
                    const totalBatches = Math.ceil(rowCount / batchSize);

                    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
                        const batchStart = batchIndex * batchSize;
                        const batchEnd = Math.min(batchStart + batchSize, rowCount);
                        const batchRows = batchEnd - batchStart;

                        const values: any[] = [];
                        const placeholders: string[] = [];

                        for (let i = 0; i < batchRows; i++) {
                            const rowIndex = batchStart + i;

                            let rowValues: any[];

                            // Use AI-generated data if available
                            if (aiGeneratedData && rowIndex < aiGeneratedData.length) {
                                const aiRow = aiGeneratedData[rowIndex];
                                rowValues = insertableColumns.map(col => {
                                    // Get value from AI data, or fallback to rule-based
                                    if (aiRow[col.name] !== undefined) {
                                        return aiRow[col.name];
                                    }
                                    // Foreign key handling still applies
                                    if (foreignKeyValues[col.name] && foreignKeyValues[col.name].length > 0) {
                                        const validIds = foreignKeyValues[col.name];
                                        return validIds[Math.floor(Math.random() * validIds.length)];
                                    }
                                    return generateValueForColumn(col, rowIndex);
                                });
                            } else {
                                // Rule-based generation
                                rowValues = insertableColumns.map(col => {
                                    if (foreignKeyValues[col.name] && foreignKeyValues[col.name].length > 0) {
                                        const validIds = foreignKeyValues[col.name];
                                        return validIds[Math.floor(Math.random() * validIds.length)];
                                    }
                                    return generateValueForColumn(col, rowIndex);
                                });
                            }

                            values.push(...rowValues);
                            placeholders.push(`(${insertableColumns.map(() => '?').join(', ')})`);
                        }

                        const insertSQL = `INSERT INTO \`${table}\` (${columnNames}) VALUES ${placeholders.join(', ')}`;
                        await connection.execute(insertSQL, values);

                        const progress = 40 + Math.floor((batchIndex + 1) / totalBatches * 55);
                        await sendProgress(progress, `Inserted batch ${batchIndex + 1} of ${totalBatches}...`);
                    }

                    await connection.end();
                    console.log('[Generate Test Data] ✅ MySQL generation completed successfully');
                    await sendProgress(100, 'Done!');

                } else if (type === 'postgresql' || type === 'postgres') {
                    console.log('[Generate Test Data] 🔌 Attempting PostgreSQL connection...');
                    const pool = new Pool({
                        host,
                        port,
                        user,
                        password,
                        database,
                    });
                    console.log('[Generate Test Data] ✅ PostgreSQL connected successfully');

                    await sendProgress(10, 'Analyzing table schema...');

                    // Get table schema - if schema not provided, find it
                    let schemaName = schema;

                    if (!schemaName) {
                        console.log(`[Generate Test Data] 🔎 Schema not provided, searching for table "${table}"...`);

                        // Find which schema contains this table
                        const { rows: schemaResults } = await pool.query(
                            `SELECT table_schema 
                             FROM information_schema.tables 
                             WHERE table_name = $1 
                             AND table_schema NOT IN ('pg_catalog', 'information_schema')
                             LIMIT 1`,
                            [table]
                        );

                        if (schemaResults.length > 0) {
                            schemaName = schemaResults[0].table_schema;
                            console.log(`[Generate Test Data] ✅ Found table in schema: "${schemaName}"`);
                            // Notify frontend of detected schema
                            await sendProgress(8, `schema:${schemaName}`);
                        } else {
                            schemaName = 'public';
                            console.log(`[Generate Test Data] ⚠️ Table not found, defaulting to schema: "public"`);
                            await sendProgress(8, `schema:public`);
                        }
                    } else {
                        // Schema was provided, send it to frontend
                        await sendProgress(8, `schema:${schemaName}`);
                    }

                    console.log(`[Generate Test Data] 🔎 Querying schema: "${schemaName}", table: "${table}"`);

                    const { rows: columns } = await pool.query(
                        `SELECT column_name, data_type, is_nullable, column_default
                         FROM information_schema.columns
                         WHERE table_schema = $1 AND table_name = $2
                         ORDER BY ordinal_position`,
                        [schemaName, table]
                    );

                    console.log('[Generate Test Data] 📋 Table columns:', columns);

                    // Get foreign key information for PostgreSQL
                    const { rows: foreignKeys } = await pool.query(
                        `SELECT
                            kcu.column_name,
                            ccu.table_name AS referenced_table_name,
                            ccu.column_name AS referenced_column_name
                         FROM information_schema.key_column_usage AS kcu
                         JOIN information_schema.constraint_column_usage AS ccu
                              ON kcu.constraint_name = ccu.constraint_name
                         JOIN information_schema.table_constraints AS tc
                              ON kcu.constraint_name = tc.constraint_name
                         WHERE tc.constraint_type = 'FOREIGN KEY'
                           AND kcu.table_schema = $1
                           AND kcu.table_name = $2`,
                        [schemaName, table]
                    );

                    console.log('[Generate Test Data] 🔗 Foreign keys:', foreignKeys);

                    // Fetch valid IDs from parent tables for foreign keys
                    const foreignKeyValues: Record<string, any[]> = {};
                    for (const fk of foreignKeys) {
                        const parentTable = fk.referenced_table_name;
                        const parentColumn = fk.referenced_column_name;
                        const childColumn = fk.column_name;

                        console.log(`[Generate Test Data] 📥 Fetching IDs from ${parentTable}.${parentColumn} for ${childColumn}...`);

                        try {
                            const { rows: parentIds } = await pool.query(
                                `SELECT DISTINCT "${parentColumn}" FROM "${schemaName}"."${parentTable}" LIMIT 1000`
                            );

                            if (parentIds.length > 0) {
                                foreignKeyValues[childColumn] = parentIds.map((row: any) => row[parentColumn]);
                                console.log(`[Generate Test Data] ✅ Found ${parentIds.length} valid IDs for ${childColumn}`);
                            } else {
                                console.warn(`[Generate Test Data] ⚠️ No data in parent table ${parentTable}, will use random values`);
                                foreignKeyValues[childColumn] = [];
                            }
                        } catch (error: any) {
                            console.error(`[Generate Test Data] ❌ Error fetching parent IDs:`, error.message);
                            foreignKeyValues[childColumn] = [];
                        }
                    }

                    const tableColumns: Column[] = columns.map((col: any) => ({
                        name: col.column_name,
                        type: col.data_type,
                        nullable: col.is_nullable === 'YES',
                        defaultValue: col.column_default,
                        isAutoIncrement: col.column_default?.includes('nextval')
                    }));

                    console.log('[Generate Test Data] 🔍 Columns to skip (auto-increment only):',
                        tableColumns.filter(c => c.isAutoIncrement).map(c => c.name));

                    await sendProgress(20, 'Generating test data...');

                    // Filter out auto-increment columns
                    const insertableColumns = tableColumns.filter(col => !col.isAutoIncrement);
                    console.log('[Generate Test Data] ✏️ Columns to insert (including non-auto PK):', insertableColumns.map(c => c.name));

                    const columnNames = insertableColumns.map(c => `"${c.name}"`).join(', ');

                    // Check if AI generation is requested
                    let aiGeneratedData: Record<string, any>[] | null = null;
                    if (aiInstructions && aiInstructions.trim()) {
                        console.log('[Generate Test Data] 🤖 AI instructions provided, attempting AI generation...');
                        await sendProgress(25, 'Using AI to generate data...');

                        const aiResult = await generateTestDataWithAI({
                            columns: insertableColumns,
                            rowCount,
                            aiInstructions,
                            tableName: table,
                            databaseType: 'postgresql',
                        });

                        if (aiResult.success && aiResult.data) {
                            aiGeneratedData = aiResult.data;
                            console.log(`[Generate Test Data] ✅ AI generated ${aiGeneratedData.length} rows`);
                            await sendProgress(40, `AI generated ${aiGeneratedData.length} rows, inserting...`);
                        } else {
                            console.warn('[Generate Test Data] ⚠️ AI generation failed, falling back to rule-based:', aiResult.error);
                            await sendProgress(25, 'AI generation failed, using default generation...');
                        }
                    }

                    // Generate and insert data in batches
                    const batchSize = 50;
                    const totalBatches = Math.ceil(rowCount / batchSize);

                    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
                        const batchStart = batchIndex * batchSize;
                        const batchEnd = Math.min(batchStart + batchSize, rowCount);
                        const batchRows = batchEnd - batchStart;

                        const values: any[] = [];
                        const valuePlaceholders: string[] = [];

                        for (let i = 0; i < batchRows; i++) {
                            const rowIndex = batchStart + i;

                            let rowValues: any[];

                            // Use AI-generated data if available
                            if (aiGeneratedData && rowIndex < aiGeneratedData.length) {
                                const aiRow = aiGeneratedData[rowIndex];
                                rowValues = insertableColumns.map(col => {
                                    if (aiRow[col.name] !== undefined) {
                                        return aiRow[col.name];
                                    }
                                    if (foreignKeyValues[col.name] && foreignKeyValues[col.name].length > 0) {
                                        const validIds = foreignKeyValues[col.name];
                                        return validIds[Math.floor(Math.random() * validIds.length)];
                                    }
                                    return generateValueForColumn(col, rowIndex);
                                });
                            } else {
                                rowValues = insertableColumns.map(col => {
                                    if (foreignKeyValues[col.name] && foreignKeyValues[col.name].length > 0) {
                                        const validIds = foreignKeyValues[col.name];
                                        return validIds[Math.floor(Math.random() * validIds.length)];
                                    }
                                    return generateValueForColumn(col, rowIndex);
                                });
                            }

                            const offset = i * insertableColumns.length;
                            const rowPlaceholders = insertableColumns.map((_, idx) => `$${offset + idx + 1}`).join(', ');
                            valuePlaceholders.push(`(${rowPlaceholders})`);
                            values.push(...rowValues);
                        }

                        const insertSQL = `INSERT INTO "${schemaName}"."${table}" (${columnNames}) VALUES ${valuePlaceholders.join(', ')}`;
                        await pool.query(insertSQL, values);

                        const progress = 40 + Math.floor((batchIndex + 1) / totalBatches * 55);
                        await sendProgress(progress, `Inserted batch ${batchIndex + 1} of ${totalBatches}...`);
                    }

                    await pool.end();
                    console.log('[Generate Test Data] ✅ PostgreSQL generation completed successfully');
                    await sendProgress(100, 'Done!');

                } else if (type === 'mongodb') {
                    console.log('[Generate Test Data] 🔌 Attempting MongoDB connection...');
                    const { MongoClient } = require('mongodb');

                    // Construct connection string
                    let connectionString = '';
                    if (host.startsWith('mongodb')) {
                        connectionString = host;
                    } else {
                        const auth = user && password ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}@` : '';
                        // Add authSource=admin for authentication
                        connectionString = `mongodb://${auth}${host}:${port}/${database}?authSource=admin`;
                    }

                    console.log('[Generate Test Data] 🔗 Connection string:', connectionString.replace(/:([^:@]+)@/, ':***@'));

                    const client = new MongoClient(connectionString, {
                        directConnection: true, // Force direct connection to specified host:port
                        serverSelectionTimeoutMS: 5000,
                        connectTimeoutMS: 10000,
                    });
                    await client.connect();
                    console.log('[Generate Test Data] ✅ MongoDB connected successfully');

                    await sendProgress(10, 'Analyzing collection schema...');

                    const db = client.db(database);
                    const collection = db.collection(table); // 'table' param holds collection name

                    // Infer schema from existing documents
                    const sampleDocs = await collection.find().limit(10).toArray();
                    let columns: Column[] = [];

                    if (sampleDocs.length > 0) {
                        // Simple schema inference: merge keys from sample docs
                        const keys = new Set<string>();
                        const types = new Map<string, string>();

                        sampleDocs.forEach((doc: any) => {
                            Object.keys(doc).forEach(key => {
                                if (key !== '_id') { // Skip _id as it's auto-generated
                                    keys.add(key);
                                    const val = doc[key];
                                    if (val !== null && val !== undefined) {
                                        types.set(key, typeof val);
                                    }
                                }
                            });
                        });

                        columns = Array.from(keys).map(key => ({
                            name: key,
                            type: types.get(key) || 'string',
                            nullable: true,
                            isAutoIncrement: false
                        }));

                        console.log('[Generate Test Data] 📋 Inferred schema:', columns);
                    } else {
                        // Fallback schema if collection is empty
                        console.log('[Generate Test Data] ⚠️ Collection is empty, using default schema');
                        columns = [
                            { name: 'name', type: 'string', nullable: true },
                            { name: 'email', type: 'string', nullable: true },
                            { name: 'createdAt', type: 'date', nullable: true },
                            { name: 'status', type: 'string', nullable: true }
                        ];
                    }

                    await sendProgress(20, 'Generating test data...');

                    // Check if AI generation is requested
                    let aiGeneratedData: Record<string, any>[] | null = null;
                    if (aiInstructions && aiInstructions.trim()) {
                        console.log('[Generate Test Data] 🤖 AI instructions provided, attempting AI generation...');
                        await sendProgress(25, 'Using AI to generate data...');

                        const aiResult = await generateTestDataWithAI({
                            columns,
                            rowCount,
                            aiInstructions,
                            tableName: table,
                            databaseType: 'mongodb',
                        });

                        if (aiResult.success && aiResult.data) {
                            aiGeneratedData = aiResult.data;
                            console.log(`[Generate Test Data] ✅ AI generated ${aiGeneratedData.length} rows`);
                            await sendProgress(40, `AI generated ${aiGeneratedData.length} documents, inserting...`);
                        } else {
                            console.warn('[Generate Test Data] ⚠️ AI generation failed, falling back to rule-based:', aiResult.error);
                            await sendProgress(25, 'AI generation failed, using default generation...');
                        }
                    }

                    // Generate and insert data in batches
                    const batchSize = 50;
                    const totalBatches = Math.ceil(rowCount / batchSize);

                    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
                        const batchStart = batchIndex * batchSize;
                        const batchEnd = Math.min(batchStart + batchSize, rowCount);
                        const batchRows = batchEnd - batchStart;

                        const documents: any[] = [];

                        for (let i = 0; i < batchRows; i++) {
                            const rowIndex = batchStart + i;

                            // Use AI-generated data if available
                            if (aiGeneratedData && rowIndex < aiGeneratedData.length) {
                                documents.push(aiGeneratedData[rowIndex]);
                            } else {
                                const doc: any = {};
                                columns.forEach(col => {
                                    doc[col.name] = generateValueForColumn(col, rowIndex);
                                });
                                documents.push(doc);
                            }
                        }

                        if (documents.length > 0) {
                            await collection.insertMany(documents);
                        }

                        const progress = 40 + Math.floor((batchIndex + 1) / totalBatches * 55);
                        await sendProgress(progress, `Inserted batch ${batchIndex + 1} of ${totalBatches}...`);
                    }

                    await client.close();
                    console.log('[Generate Test Data] ✅ MongoDB generation completed successfully');
                    await sendProgress(100, 'Done!');

                } else {
                    console.log(`[Generate Test Data] ❌ Unsupported database type: ${type}`);
                    await sendProgress(0, `Unsupported database type: ${type}`);
                }

                await writer.close();
            } catch (error: any) {
                console.error('[Generate Test Data] ❌ Error in async generation:', error);
                console.error('[Generate Test Data] Error stack:', error.stack);
                await sendProgress(0, `Error: ${error.message}`);
                await writer.close();
            }
        })();

        return new Response(stream.readable, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });

    } catch (error: any) {
        console.error('[Generate Test Data] ❌ Top-level error:', error);
        console.error('[Generate Test Data] Error stack:', error.stack);
        return NextResponse.json(
            { success: false, error: error.message || 'Failed to generate test data' },
            { status: 500 }
        );
    }
}
