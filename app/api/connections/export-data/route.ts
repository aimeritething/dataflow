import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

interface ExportRequest {
    type: string;
    host: string;
    port: string;
    user: string;
    password: string;
    database: string;
    schema?: string;
    table: string;
    format: 'csv' | 'json' | 'sql' | 'excel';
    rowCount?: number | null;
    filter?: string;
}

export async function POST(req: NextRequest) {
    try {
        const body: ExportRequest = await req.json();
        const { type, host, port, user, password, database, schema, table, format, rowCount, filter } = body;

        console.log('[Export API] Received request:', { type, database, schema, table, format, rowCount, filter });

        // Create a TransformStream for streaming response
        const encoder = new TextEncoder();
        const stream = new TransformStream();
        const writer = stream.writable.getWriter();

        // Connection object
        const connection = { type, host, port, user, password };

        // Start async export process
        (async () => {
            try {
                let data: any[] = [];
                let columns: string[] = [];

                // Send initial progress
                await sendProgress(writer, encoder, 10, 'Connecting to database...');

                let createTableSQL: string | undefined;
                let exportedSchemaName: string | undefined;
                let exportedForeignKeys: any[] | undefined;

                // Fetch data based on connection type
                if (connection.type.toLowerCase() === 'mysql') {
                    const result = await exportMySQL(connection, database, table, rowCount, filter);
                    data = result.data;
                    columns = result.columns;
                    createTableSQL = result.createTableSQL;
                } else if (connection.type.toLowerCase() === 'postgres' || connection.type.toLowerCase() === 'postgresql') {
                    const result = await exportPostgreSQL(connection, database, schema, table, rowCount, filter);
                    data = result.data;
                    columns = result.columns;
                    createTableSQL = result.createTableSQL;
                    exportedSchemaName = result.schemaName;
                    exportedForeignKeys = result.foreignKeys;
                } else if (connection.type.toLowerCase() === 'mongodb') {
                    const result = await exportMongoDB(connection, database, table, rowCount, filter);
                    data = result.data;
                    columns = result.columns;
                } else {
                    throw new Error('Unsupported database type');
                }

                await sendProgress(writer, encoder, 50, 'Fetched ' + data.length + ' rows...');

                // Generate file based on format
                let fileContent: string | Buffer;
                let fileName: string;
                let mimeType: string;

                await sendProgress(writer, encoder, 70, 'Generating export file...');

                if (format === 'csv') {
                    fileContent = generateCSV(columns, data);
                    fileName = table + '_export.csv';
                    mimeType = 'text/csv';
                } else if (format === 'json') {
                    fileContent = JSON.stringify(data, null, 2);
                    fileName = table + '_export.json';
                    mimeType = 'application/json';
                } else if (format === 'sql') {
                    fileContent = generateSQL(table, columns, data, createTableSQL, connection.type, exportedSchemaName, exportedForeignKeys);
                    fileName = table + '_export.sql';
                    mimeType = 'text/plain';
                } else if (format === 'excel') {
                    // For Excel, we would use xlsx library, but for now we'll fall back to CSV
                    fileContent = generateCSV(columns, data);
                    fileName = table + '_export.csv';
                    mimeType = 'text/csv';
                } else {
                    throw new Error('Unsupported export format');
                }

                await sendProgress(writer, encoder, 90, 'Saving file...');

                // Save file to temp directory
                const tempFilePath = join(tmpdir(), fileName);
                await writeFile(tempFilePath, fileContent);

                // For production, you would upload to S3 or similar and return a URL
                // For now, we'll encode the data as base64 and return it
                const base64Data = Buffer.from(fileContent).toString('base64');
                const dataUrl = `data:${mimeType};base64,${base64Data}`;

                await sendProgress(writer, encoder, 100, 'Export complete!', dataUrl);

            } catch (error: any) {
                console.error('[Export API] Error:', error);
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
        console.error('[Export API] Request error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

async function sendProgress(
    writer: WritableStreamDefaultWriter,
    encoder: TextEncoder,
    progress: number,
    message: string,
    downloadUrl?: string
) {
    const data = JSON.stringify({
        progress,
        message,
        ...(downloadUrl && { downloadUrl })
    });
    await writer.write(encoder.encode(`data: ${data}\n\n`));
}

async function exportMySQL(connection: any, database: string, table: string, rowCount?: number | null, filter?: string) {
    const mysql = require('mysql2/promise');

    const conn = await mysql.createConnection({
        host: connection.host,
        port: parseInt(connection.port),
        user: connection.user,
        password: connection.password,
        database,
    });

    try {
        // Build query
        let query = 'SELECT * FROM `' + table + '`';
        if (filter) {
            query += ' WHERE ' + filter;
        }
        if (rowCount) {
            query += ' LIMIT ' + rowCount;
        }

        const [rows] = await conn.query(query);

        // Get columns
        const [columnsResult] = await conn.query('SHOW COLUMNS FROM `' + table + '`');
        const columns = (columnsResult as any[]).map((col: any) => col.Field);

        // Get CREATE TABLE statement
        const [createResult] = await conn.query('SHOW CREATE TABLE `' + table + '`');
        const createTableSQL = (createResult as any[])[0]?.['Create Table'] || '';

        return { data: rows as any[], columns, createTableSQL };
    } finally {
        await conn.end();
    }
}

async function exportPostgreSQL(connection: any, database: string, schema: string | undefined, table: string, rowCount?: number | null, filter?: string) {
    const { Client } = require('pg');

    const client = new Client({
        host: connection.host,
        port: parseInt(connection.port),
        user: connection.user,
        password: connection.password,
        database,
    });

    try {
        await client.connect();

        const schemaName = schema || 'public';

        // Build query
        let query = 'SELECT * FROM "' + schemaName + '"."' + table + '"';
        if (filter) {
            query += ' WHERE ' + filter;
        }
        if (rowCount) {
            query += ' LIMIT ' + rowCount;
        }

        const result = await client.query(query);

        // Get columns with types for CREATE TABLE
        const colResult = await client.query(
            `SELECT 
                column_name, 
                data_type, 
                udt_name,
                character_maximum_length, 
                numeric_precision,
                numeric_scale,
                is_nullable, 
                column_default
            FROM information_schema.columns 
            WHERE table_schema = $1 AND table_name = $2 
            ORDER BY ordinal_position`,
            [schemaName, table]
        );
        const columns = colResult.rows.map((row: any) => row.column_name);

        // Get primary key constraint
        const pkResult = await client.query(
            `SELECT 
                kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu 
                ON tc.constraint_name = kcu.constraint_name 
                AND tc.table_schema = kcu.table_schema
            WHERE tc.table_schema = $1 
                AND tc.table_name = $2 
                AND tc.constraint_type = 'PRIMARY KEY'
            ORDER BY kcu.ordinal_position`,
            [schemaName, table]
        );
        const pkColumns = pkResult.rows.map((row: any) => row.column_name);

        // Get foreign key constraints
        const fkResult = await client.query(
            `SELECT 
                tc.constraint_name,
                kcu.column_name,
                ccu.table_schema AS foreign_table_schema,
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name,
                rc.update_rule,
                rc.delete_rule
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu 
                ON tc.constraint_name = kcu.constraint_name 
                AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu 
                ON ccu.constraint_name = tc.constraint_name 
                AND ccu.table_schema = tc.table_schema
            JOIN information_schema.referential_constraints rc
                ON rc.constraint_name = tc.constraint_name
                AND rc.constraint_schema = tc.table_schema
            WHERE tc.table_schema = $1 
                AND tc.table_name = $2 
                AND tc.constraint_type = 'FOREIGN KEY'`,
            [schemaName, table]
        );

        // Group foreign keys by constraint name
        const foreignKeys: Map<string, any> = new Map();
        fkResult.rows.forEach((row: any) => {
            if (!foreignKeys.has(row.constraint_name)) {
                foreignKeys.set(row.constraint_name, {
                    name: row.constraint_name,
                    columns: [],
                    foreignSchema: row.foreign_table_schema,
                    foreignTable: row.foreign_table_name,
                    foreignColumns: [],
                    updateRule: row.update_rule,
                    deleteRule: row.delete_rule
                });
            }
            const fk = foreignKeys.get(row.constraint_name);
            fk.columns.push(row.column_name);
            fk.foreignColumns.push(row.foreign_column_name);
        });

        // Get unique constraints
        const uniqueResult = await client.query(
            `SELECT 
                tc.constraint_name,
                kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu 
                ON tc.constraint_name = kcu.constraint_name 
                AND tc.table_schema = kcu.table_schema
            WHERE tc.table_schema = $1 
                AND tc.table_name = $2 
                AND tc.constraint_type = 'UNIQUE'
            ORDER BY tc.constraint_name, kcu.ordinal_position`,
            [schemaName, table]
        );

        // Group unique constraints by constraint name
        const uniqueConstraints: Map<string, string[]> = new Map();
        uniqueResult.rows.forEach((row: any) => {
            if (!uniqueConstraints.has(row.constraint_name)) {
                uniqueConstraints.set(row.constraint_name, []);
            }
            uniqueConstraints.get(row.constraint_name)!.push(row.column_name);
        });

        // Get indexes (excluding primary key and unique constraint indexes)
        const indexResult = await client.query(
            `SELECT 
                i.relname AS index_name,
                a.attname AS column_name,
                ix.indisunique AS is_unique,
                am.amname AS index_type
            FROM pg_class t
            JOIN pg_namespace n ON n.oid = t.relnamespace
            JOIN pg_index ix ON t.oid = ix.indrelid
            JOIN pg_class i ON i.oid = ix.indexrelid
            JOIN pg_am am ON am.oid = i.relam
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
            WHERE n.nspname = $1 
                AND t.relname = $2
                AND NOT ix.indisprimary
                AND NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints tc 
                    WHERE tc.constraint_name = i.relname 
                    AND tc.table_schema = n.nspname
                )
            ORDER BY i.relname, array_position(ix.indkey, a.attnum)`,
            [schemaName, table]
        );

        // Group indexes by index name
        const indexes: Map<string, { columns: string[], isUnique: boolean, indexType: string }> = new Map();
        indexResult.rows.forEach((row: any) => {
            if (!indexes.has(row.index_name)) {
                indexes.set(row.index_name, {
                    columns: [],
                    isUnique: row.is_unique,
                    indexType: row.index_type
                });
            }
            indexes.get(row.index_name)!.columns.push(row.column_name);
        });

        // Generate CREATE TABLE statement with complete schema
        const formatDataType = (col: any): string => {
            const udtName = col.udt_name;
            // Handle array types
            if (udtName.startsWith('_')) {
                return udtName.slice(1) + '[]';
            }
            // Handle specific types
            switch (udtName) {
                case 'int4':
                    return 'INTEGER';
                case 'int8':
                    return 'BIGINT';
                case 'int2':
                    return 'SMALLINT';
                case 'float4':
                    return 'REAL';
                case 'float8':
                    return 'DOUBLE PRECISION';
                case 'bool':
                    return 'BOOLEAN';
                case 'varchar':
                    return col.character_maximum_length
                        ? `VARCHAR(${col.character_maximum_length})`
                        : 'VARCHAR';
                case 'bpchar':
                    return col.character_maximum_length
                        ? `CHAR(${col.character_maximum_length})`
                        : 'CHAR';
                case 'numeric':
                    if (col.numeric_precision && col.numeric_scale) {
                        return `NUMERIC(${col.numeric_precision}, ${col.numeric_scale})`;
                    } else if (col.numeric_precision) {
                        return `NUMERIC(${col.numeric_precision})`;
                    }
                    return 'NUMERIC';
                case 'timestamptz':
                    return 'TIMESTAMP WITH TIME ZONE';
                case 'timetz':
                    return 'TIME WITH TIME ZONE';
                default:
                    return col.data_type.toUpperCase();
            }
        };

        const columnDefs = colResult.rows.map((col: any) => {
            let def = '"' + col.column_name + '" ' + formatDataType(col);
            if (col.is_nullable === 'NO') {
                def += ' NOT NULL';
            }
            if (col.column_default) {
                def += ' DEFAULT ' + col.column_default;
            }
            return def;
        });

        // Add primary key constraint
        if (pkColumns.length > 0) {
            columnDefs.push('PRIMARY KEY (' + pkColumns.map((c: string) => '"' + c + '"').join(', ') + ')');
        }

        // Add unique constraints
        uniqueConstraints.forEach((cols, constraintName) => {
            columnDefs.push('CONSTRAINT "' + constraintName + '" UNIQUE (' + cols.map((c: string) => '"' + c + '"').join(', ') + ')');
        });

        // NOTE: Foreign key constraints are NOT added to CREATE TABLE
        // They will be added via ALTER TABLE after data is inserted to avoid FK violations

        let createTableSQL = 'CREATE TABLE IF NOT EXISTS "' + schemaName + '"."' + table + '" (\n  ' + columnDefs.join(',\n  ') + '\n);';

        // Add index creation statements
        indexes.forEach((idx, indexName) => {
            const uniqueStr = idx.isUnique ? 'UNIQUE ' : '';
            const usingStr = idx.indexType !== 'btree' ? ` USING ${idx.indexType}` : '';
            createTableSQL += '\n\nCREATE ' + uniqueStr + 'INDEX IF NOT EXISTS "' + indexName + '" ON "' + schemaName + '"."' + table + '"' + usingStr + ' (' + idx.columns.map((c: string) => '"' + c + '"').join(', ') + ');';
        });

        // Convert foreignKeys Map to Array for return
        const foreignKeysArray = Array.from(foreignKeys.values());

        return { data: result.rows, columns, createTableSQL, schemaName, foreignKeys: foreignKeysArray };
    } finally {
        await client.end();
    }
}

async function exportMongoDB(connection: any, database: string, collection: string, rowCount?: number | null, filter?: string) {
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

function generateSQL(
    table: string,
    columns: string[],
    data: any[],
    createTableSQL?: string,
    dbType?: string,
    schemaName?: string,
    foreignKeys?: Array<{
        name: string;
        columns: string[];
        foreignSchema: string;
        foreignTable: string;
        foreignColumns: string[];
        deleteRule: string;
        updateRule: string;
    }>
): string {
    const sqlStatements: string[] = [];

    // Determine quote character based on database type
    // PostgreSQL uses double quotes, MySQL uses backticks
    const isPostgres = dbType?.toLowerCase() === 'postgres' || dbType?.toLowerCase() === 'postgresql';
    const quote = isPostgres ? '"' : '`';
    const schema = schemaName || 'public';

    // Add header comment
    sqlStatements.push('-- Exported by DataFlow AI Analyst');
    sqlStatements.push('-- Generated at: ' + new Date().toISOString());
    sqlStatements.push('');

    // Add statements to disable foreign key checks
    if (isPostgres) {
        // For PostgreSQL, we'll drop and recreate foreign key constraints
        // This works without superuser privileges
        if (foreignKeys && foreignKeys.length > 0) {
            sqlStatements.push('-- Temporarily drop foreign key constraints');
            foreignKeys.forEach(fk => {
                sqlStatements.push(`ALTER TABLE "${schema}"."${table}" DROP CONSTRAINT IF EXISTS "${fk.name}";`);
            });
            sqlStatements.push('');
        }
    } else {
        sqlStatements.push('-- Disable foreign key checks');
        sqlStatements.push('SET FOREIGN_KEY_CHECKS = 0;');
        sqlStatements.push('');
    }

    // Add CREATE TABLE statement if provided
    if (createTableSQL) {
        sqlStatements.push('-- Table structure');
        sqlStatements.push(createTableSQL);
        sqlStatements.push('');
    }

    sqlStatements.push('-- Table data');

    if (data.length === 0) {
        sqlStatements.push('-- No data to export');
    } else {
        // Helper function to format values for SQL
        const formatValue = (value: any): string => {
            if (value === null || value === undefined) return 'NULL';
            if (typeof value === 'number') return String(value);
            if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';

            // Handle Date objects - convert to ISO 8601 format for PostgreSQL compatibility
            if (value instanceof Date) {
                // Format as ISO string without timezone suffix for better compatibility
                // PostgreSQL accepts: '2024-12-22 11:45:30' or '2024-12-22T11:45:30.000Z'
                return "'" + value.toISOString() + "'";
            }

            // Handle objects (including nested objects and arrays)
            if (typeof value === 'object') {
                // Escape single quotes in JSON string
                return "'" + JSON.stringify(value).replace(/'/g, "''") + "'";
            }

            // Escape single quotes for SQL strings
            return "'" + String(value).replace(/'/g, "''") + "'";
        };

        data.forEach(row => {
            const values = columns.map(col => formatValue(row[col]));

            sqlStatements.push(
                'INSERT INTO ' + quote + table + quote + ' (' + columns.map(c => quote + c + quote).join(', ') + ') VALUES (' + values.join(', ') + ');'
            );
        });
    }

    sqlStatements.push('');

    // Add statements to re-enable foreign key checks
    if (isPostgres) {
        // Re-create foreign key constraints
        if (foreignKeys && foreignKeys.length > 0) {
            sqlStatements.push('-- Re-create foreign key constraints');
            foreignKeys.forEach(fk => {
                let fkDef = `ALTER TABLE "${schema}"."${table}" ADD CONSTRAINT "${fk.name}" `;
                fkDef += `FOREIGN KEY (${fk.columns.map((c: string) => '"' + c + '"').join(', ')}) `;
                fkDef += `REFERENCES "${fk.foreignSchema}"."${fk.foreignTable}" (${fk.foreignColumns.map((c: string) => '"' + c + '"').join(', ')})`;
                if (fk.deleteRule && fk.deleteRule !== 'NO ACTION') {
                    fkDef += ' ON DELETE ' + fk.deleteRule;
                }
                if (fk.updateRule && fk.updateRule !== 'NO ACTION') {
                    fkDef += ' ON UPDATE ' + fk.updateRule;
                }
                fkDef += ';';
                sqlStatements.push(fkDef);
            });
        }
    } else {
        sqlStatements.push('-- Re-enable foreign key checks');
        sqlStatements.push('SET FOREIGN_KEY_CHECKS = 1;');
    }

    return sqlStatements.join('\n');
}
