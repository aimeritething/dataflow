import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import { join } from 'path';

interface ExportDatabaseRequest {
    type: string;
    host: string;
    port: string;
    user: string;
    password: string;
    database: string;
    format: 'csv' | 'json' | 'sql' | 'excel';
    rowCount?: number | null;
    filter?: string;
}

interface ForeignKeyInfo {
    constraintName: string;
    tableName: string;
    columnName: string;
    foreignTableName: string;
    foreignColumnName: string;
    updateRule: string;
    deleteRule: string;
}

interface TableExportData {
    columns: string[];
    data: any[];
    createTableSQL?: string;
    primaryKey?: string[];
    uniqueConstraints?: { name: string; columns: string[] }[];
    serialColumns?: { column: string; sequenceName: string }[];
}

export async function POST(req: NextRequest) {
    try {
        const body: ExportDatabaseRequest = await req.json();
        const { type, host, port, user, password, database, format, rowCount, filter } = body;

        console.log('[Export Database API] Received request:', { type, database, format, rowCount, filter });

        // Create a TransformStream for streaming response
        const encoder = new TextEncoder();
        const stream = new TransformStream();
        const writer = stream.writable.getWriter();

        // Connection object
        const connection = { type, host, port, user, password };

        // Start async export process
        (async () => {
            try {
                await sendProgress(writer, encoder, 5, 'Connecting to database...');

                let allContent: string = '';
                let tables: string[] = [];
                let foreignKeys: ForeignKeyInfo[] = [];
                let fileName: string;
                let mimeType: string;

                // Get list of tables based on database type
                if (connection.type.toLowerCase() === 'mysql') {
                    tables = await getMySQLTables(connection, database);
                    foreignKeys = await getMySQLForeignKeys(connection, database);
                } else if (connection.type.toLowerCase() === 'postgres' || connection.type.toLowerCase() === 'postgresql') {
                    tables = await getPostgresTables(connection, database);
                    foreignKeys = await getPostgresForeignKeys(connection, database);
                } else if (connection.type.toLowerCase() === 'mongodb') {
                    tables = await getMongoCollections(connection, database);
                } else {
                    throw new Error('Unsupported database type');
                }

                await sendProgress(writer, encoder, 10, `Found ${tables.length} tables/collections...`);

                if (tables.length === 0) {
                    throw new Error('No tables found in database');
                }

                // Sort tables by foreign key dependencies
                const sortedTables = sortTablesByDependencies(tables, foreignKeys);

                // Export each table
                const totalTables = sortedTables.length;
                const allTableData: { [key: string]: TableExportData } = {};

                for (let i = 0; i < totalTables; i++) {
                    const tableName = sortedTables[i];
                    const progress = 10 + Math.floor((i / totalTables) * 60);
                    await sendProgress(writer, encoder, progress, `Exporting ${tableName} (${i + 1}/${totalTables})...`);

                    try {
                        if (connection.type.toLowerCase() === 'mysql') {
                            allTableData[tableName] = await exportMySQL(connection, database, tableName, rowCount, filter);
                        } else if (connection.type.toLowerCase() === 'postgres' || connection.type.toLowerCase() === 'postgresql') {
                            // Parse schema from table name (format: schema.table or just table for public)
                            let schema = 'public';
                            let tblName = tableName;
                            if (tableName.includes('.')) {
                                const parts = tableName.split('.');
                                schema = parts[0];
                                tblName = parts[1];
                            }
                            allTableData[tableName] = await exportPostgreSQL(connection, database, schema, tblName, rowCount, filter);
                        } else if (connection.type.toLowerCase() === 'mongodb') {
                            allTableData[tableName] = await exportMongoDB(connection, database, tableName, rowCount, filter);
                        }
                    } catch (tableError: any) {
                        console.warn(`[Export Database API] Failed to export ${tableName}:`, tableError.message);
                        // Continue with other tables
                    }
                }

                await sendProgress(writer, encoder, 75, 'Generating export file...');

                // Generate combined file based on format
                if (format === 'sql') {
                    allContent = generateCombinedSQL(database, sortedTables, allTableData, foreignKeys, connection.type.toLowerCase());
                    fileName = `${database}_export.sql`;
                    mimeType = 'text/plain';
                } else if (format === 'json') {
                    allContent = JSON.stringify({ tables: allTableData, foreignKeys }, null, 2);
                    fileName = `${database}_export.json`;
                    mimeType = 'application/json';
                } else if (format === 'csv') {
                    allContent = generateCombinedCSV(allTableData);
                    fileName = `${database}_export.csv`;
                    mimeType = 'text/csv';
                } else if (format === 'excel') {
                    allContent = generateCombinedCSV(allTableData);
                    fileName = `${database}_export.csv`;
                    mimeType = 'text/csv';
                } else {
                    throw new Error('Unsupported export format');
                }

                await sendProgress(writer, encoder, 90, 'Saving file...');

                // Save to public/exports directory for download
                const { mkdir } = require('fs/promises');
                const exportsDir = join(process.cwd(), 'public', 'exports');
                await mkdir(exportsDir, { recursive: true });

                // Generate unique filename with timestamp
                const timestamp = Date.now();
                const safeDbName = database.replace(/[^a-zA-Z0-9_-]/g, '_');
                const exportFileName = `${safeDbName}_${timestamp}.${format === 'excel' ? 'csv' : format}`;
                const exportFilePath = join(exportsDir, exportFileName);

                await writeFile(exportFilePath, allContent);

                // Return download URL (relative to public)
                const downloadUrl = `/exports/${exportFileName}`;

                await sendProgress(writer, encoder, 100, 'Export complete!', downloadUrl);

            } catch (error: any) {
                console.error('[Export Database API] Error:', error);
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
        console.error('[Export Database API] Request error:', error);
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

// ============ Get Tables/Collections ============

async function getMySQLTables(connection: any, database: string): Promise<string[]> {
    const mysql = require('mysql2/promise');
    const conn = await mysql.createConnection({
        host: connection.host,
        port: parseInt(connection.port),
        user: connection.user,
        password: connection.password,
        database,
    });

    try {
        const [rows] = await conn.query('SHOW TABLES');
        return (rows as any[]).map((row: any) => Object.values(row)[0] as string);
    } finally {
        await conn.end();
    }
}

async function getPostgresTables(connection: any, database: string): Promise<string[]> {
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
        // Get tables from all user schemas (excluding system schemas)
        const result = await client.query(
            `SELECT table_schema, table_name FROM information_schema.tables 
             WHERE table_type = 'BASE TABLE'
             AND table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
             ORDER BY table_schema, table_name`
        );

        // For tables in public schema, return just the name; for others, include schema
        return result.rows.map((row: any) => {
            if (row.table_schema === 'public') {
                return row.table_name;
            }
            return `${row.table_schema}.${row.table_name}`;
        });
    } finally {
        await client.end();
    }
}

async function getMongoCollections(connection: any, database: string): Promise<string[]> {
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
        const collections = await db.listCollections().toArray();
        return collections.map((col: any) => col.name);
    } finally {
        await client.close();
    }
}

// ============ Get Foreign Keys ============

async function getMySQLForeignKeys(connection: any, database: string): Promise<ForeignKeyInfo[]> {
    const mysql = require('mysql2/promise');
    const conn = await mysql.createConnection({
        host: connection.host,
        port: parseInt(connection.port),
        user: connection.user,
        password: connection.password,
        database,
    });

    try {
        const [rows] = await conn.query(`
            SELECT 
                CONSTRAINT_NAME as constraintName,
                TABLE_NAME as tableName,
                COLUMN_NAME as columnName,
                REFERENCED_TABLE_NAME as foreignTableName,
                REFERENCED_COLUMN_NAME as foreignColumnName,
                'NO ACTION' as updateRule,
                'NO ACTION' as deleteRule
            FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
            ORDER BY TABLE_NAME, CONSTRAINT_NAME
        `, [database]);

        // Get update and delete rules
        const [refRows] = await conn.query(`
            SELECT 
                CONSTRAINT_NAME,
                UPDATE_RULE,
                DELETE_RULE
            FROM information_schema.REFERENTIAL_CONSTRAINTS
            WHERE CONSTRAINT_SCHEMA = ?
        `, [database]);

        const refRulesMap = new Map<string, { updateRule: string; deleteRule: string }>();
        (refRows as any[]).forEach((row: any) => {
            refRulesMap.set(row.CONSTRAINT_NAME, {
                updateRule: row.UPDATE_RULE,
                deleteRule: row.DELETE_RULE
            });
        });

        return (rows as any[]).map((row: any) => {
            const rules = refRulesMap.get(row.constraintName);
            return {
                ...row,
                updateRule: rules?.updateRule || 'NO ACTION',
                deleteRule: rules?.deleteRule || 'NO ACTION'
            };
        });
    } finally {
        await conn.end();
    }
}

async function getPostgresForeignKeys(connection: any, database: string): Promise<ForeignKeyInfo[]> {
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
        const result = await client.query(`
            SELECT 
                tc.constraint_name as "constraintName",
                tc.table_name as "tableName",
                kcu.column_name as "columnName",
                ccu.table_name as "foreignTableName",
                ccu.column_name as "foreignColumnName",
                rc.update_rule as "updateRule",
                rc.delete_rule as "deleteRule"
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
            WHERE tc.table_schema = 'public' 
                AND tc.constraint_type = 'FOREIGN KEY'
            ORDER BY tc.table_name, tc.constraint_name
        `);
        return result.rows;
    } finally {
        await client.end();
    }
}

// ============ Sort Tables by Dependencies ============

function sortTablesByDependencies(tables: string[], foreignKeys: ForeignKeyInfo[]): string[] {
    // Build dependency graph
    const dependencies = new Map<string, Set<string>>();
    tables.forEach(table => dependencies.set(table, new Set()));

    foreignKeys.forEach(fk => {
        if (tables.includes(fk.tableName) && tables.includes(fk.foreignTableName)) {
            // tableName depends on foreignTableName
            dependencies.get(fk.tableName)?.add(fk.foreignTableName);
        }
    });

    // Topological sort
    const sorted: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    function visit(table: string) {
        if (visited.has(table)) return;
        if (visiting.has(table)) {
            // Circular dependency, just add it anyway
            return;
        }
        visiting.add(table);

        const deps = dependencies.get(table) || new Set();
        deps.forEach(dep => visit(dep));

        visiting.delete(table);
        visited.add(table);
        sorted.push(table);
    }

    tables.forEach(table => visit(table));

    return sorted;
}

// ============ Export Functions ============

async function exportMySQL(connection: any, database: string, table: string, rowCount?: number | null, filter?: string): Promise<TableExportData> {
    const mysql = require('mysql2/promise');
    const conn = await mysql.createConnection({
        host: connection.host,
        port: parseInt(connection.port),
        user: connection.user,
        password: connection.password,
        database,
    });

    try {
        let query = 'SELECT * FROM `' + table + '`';
        if (filter) {
            query += ' WHERE ' + filter;
        }
        if (rowCount) {
            query += ' LIMIT ' + rowCount;
        }

        const [rows] = await conn.query(query);
        const [columnsResult] = await conn.query('SHOW COLUMNS FROM `' + table + '`');
        const columns = (columnsResult as any[]).map((col: any) => col.Field);

        const [createResult] = await conn.query('SHOW CREATE TABLE `' + table + '`');
        const createTableSQL = (createResult as any[])[0]?.['Create Table'] || '';

        return { data: rows as any[], columns, createTableSQL };
    } finally {
        await conn.end();
    }
}

async function exportPostgreSQL(connection: any, database: string, schema: string, table: string, rowCount?: number | null, filter?: string): Promise<TableExportData> {
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

        let query = 'SELECT * FROM "' + schemaName + '"."' + table + '"';
        if (filter) {
            query += ' WHERE ' + filter;
        }
        if (rowCount) {
            query += ' LIMIT ' + rowCount;
        }

        const result = await client.query(query);

        // Get columns with detailed type information
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

        // Get primary key
        const pkResult = await client.query(
            `SELECT kcu.column_name
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
        const primaryKey = pkResult.rows.map((row: any) => row.column_name);

        // Get unique constraints
        const uniqueResult = await client.query(
            `SELECT tc.constraint_name, kcu.column_name
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

        const uniqueConstraintsMap = new Map<string, string[]>();
        uniqueResult.rows.forEach((row: any) => {
            if (!uniqueConstraintsMap.has(row.constraint_name)) {
                uniqueConstraintsMap.set(row.constraint_name, []);
            }
            uniqueConstraintsMap.get(row.constraint_name)!.push(row.column_name);
        });
        const uniqueConstraints = Array.from(uniqueConstraintsMap.entries()).map(([name, cols]) => ({ name, columns: cols }));

        // Generate CREATE TABLE statement (without foreign keys)
        const formatDataType = (col: any): string => {
            const udtName = col.udt_name;
            const columnDefault = col.column_default || '';

            // Detect SERIAL/BIGSERIAL from nextval pattern
            if (columnDefault.includes('nextval(')) {
                if (udtName === 'int8') return 'BIGSERIAL';
                if (udtName === 'int4') return 'SERIAL';
                if (udtName === 'int2') return 'SMALLSERIAL';
            }

            if (udtName.startsWith('_')) {
                return udtName.slice(1).toUpperCase() + '[]';
            }
            switch (udtName) {
                case 'int4': return 'INTEGER';
                case 'int8': return 'BIGINT';
                case 'int2': return 'SMALLINT';
                case 'float4': return 'REAL';
                case 'float8': return 'DOUBLE PRECISION';
                case 'bool': return 'BOOLEAN';
                case 'varchar':
                    return col.character_maximum_length ? `VARCHAR(${col.character_maximum_length})` : 'VARCHAR';
                case 'bpchar':
                    return col.character_maximum_length ? `CHAR(${col.character_maximum_length})` : 'CHAR';
                case 'numeric':
                    if (col.numeric_precision && col.numeric_scale) {
                        return `NUMERIC(${col.numeric_precision}, ${col.numeric_scale})`;
                    } else if (col.numeric_precision) {
                        return `NUMERIC(${col.numeric_precision})`;
                    }
                    return 'NUMERIC';
                case 'timestamptz': return 'TIMESTAMP WITH TIME ZONE';
                case 'timetz': return 'TIME WITH TIME ZONE';
                case 'uuid': return 'UUID';
                case 'json': return 'JSON';
                case 'jsonb': return 'JSONB';
                case 'text': return 'TEXT';
                case 'bytea': return 'BYTEA';
                case 'date': return 'DATE';
                case 'time': return 'TIME';
                case 'timestamp': return 'TIMESTAMP';
                case 'interval': return 'INTERVAL';
                default: return col.data_type.toUpperCase();
            }
        };

        const columnDefs = colResult.rows.map((col: any) => {
            const dataType = formatDataType(col);
            let def = '"' + col.column_name + '" ' + dataType;
            if (col.is_nullable === 'NO') {
                def += ' NOT NULL';
            }
            // Skip nextval defaults for SERIAL types (it's implicit)
            if (col.column_default && !col.column_default.includes('nextval(')) {
                def += ' DEFAULT ' + col.column_default;
            }
            return def;
        });

        // Track serial columns for sequence reset
        const serialColumns: { column: string; sequenceName: string }[] = [];
        colResult.rows.forEach((col: any) => {
            if (col.column_default && col.column_default.includes('nextval(')) {
                // Extract sequence name from nextval('sequence_name'::regclass)
                const match = col.column_default.match(/nextval\('([^']+)'::regclass\)/);
                if (match) {
                    serialColumns.push({
                        column: col.column_name,
                        sequenceName: match[1]
                    });
                }
            }
        });

        if (primaryKey.length > 0) {
            columnDefs.push('PRIMARY KEY (' + primaryKey.map((c: string) => '"' + c + '"').join(', ') + ')');
        }

        uniqueConstraints.forEach(uc => {
            columnDefs.push('CONSTRAINT "' + uc.name + '" UNIQUE (' + uc.columns.map((c: string) => '"' + c + '"').join(', ') + ')');
        });

        // Note: Foreign keys are NOT included in CREATE TABLE, they will be added later via ALTER TABLE
        const createTableSQL = 'CREATE TABLE IF NOT EXISTS "' + schemaName + '"."' + table + '" (\n  ' + columnDefs.join(',\n  ') + '\n);';

        return { data: result.rows, columns, createTableSQL, primaryKey, uniqueConstraints, serialColumns };
    } finally {
        await client.end();
    }
}

async function exportMongoDB(connection: any, database: string, collection: string, rowCount?: number | null, filter?: string): Promise<TableExportData> {
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

// ============ Generate Combined Files ============

function generateCombinedSQL(
    database: string,
    sortedTables: string[],
    allTableData: { [key: string]: TableExportData },
    foreignKeys: ForeignKeyInfo[],
    dbType: string
): string {
    const sqlStatements: string[] = [];
    const isPostgres = dbType === 'postgres' || dbType === 'postgresql';
    const quote = isPostgres ? '"' : '`';

    // Helper function to properly quote table names (handles schema.table format)
    const quoteTableName = (tableName: string): string => {
        if (isPostgres && tableName.includes('.')) {
            const [schema, table] = tableName.split('.');
            return `"${schema}"."${table}"`;
        }
        return `${quote}${tableName}${quote}`;
    };

    sqlStatements.push(`-- Database Export: ${database}`);
    sqlStatements.push(`-- Exported by DataFlow AI Analyst`);
    sqlStatements.push(`-- Exported at: ${new Date().toISOString()}`);
    sqlStatements.push(`-- Database Type: ${dbType}`);
    sqlStatements.push('');

    // Disable foreign key checks
    if (isPostgres) {
        sqlStatements.push('-- Note: Foreign key constraints will be added at the end');
        sqlStatements.push('');

        // Create schemas if needed (for non-public schemas)
        const schemas = new Set<string>();
        for (const tableName of sortedTables) {
            if (tableName.includes('.')) {
                const schema = tableName.split('.')[0];
                if (schema !== 'public') {
                    schemas.add(schema);
                }
            }
        }

        if (schemas.size > 0) {
            sqlStatements.push(`-- ============================================`);
            sqlStatements.push(`-- Create Schemas`);
            sqlStatements.push(`-- ============================================`);
            sqlStatements.push('');
            for (const schema of schemas) {
                sqlStatements.push(`CREATE SCHEMA IF NOT EXISTS "${schema}";`);
            }
            sqlStatements.push('');
        }
    } else {
        sqlStatements.push('-- Disable foreign key checks');
        sqlStatements.push('SET FOREIGN_KEY_CHECKS = 0;');
        sqlStatements.push('');
    }

    // Create tables and insert data (in dependency order)
    for (const tableName of sortedTables) {
        const tableData = allTableData[tableName];
        if (!tableData) continue;

        sqlStatements.push(`-- ============================================`);
        sqlStatements.push(`-- Table: ${tableName}`);
        sqlStatements.push(`-- ============================================`);
        sqlStatements.push('');

        if (tableData.createTableSQL) {
            sqlStatements.push('-- Table structure');
            // Ensure CREATE TABLE ends with semicolon (MySQL's SHOW CREATE TABLE may not include it)
            let createSQL = tableData.createTableSQL.trim();
            if (!createSQL.endsWith(';')) {
                createSQL += ';';
            }
            sqlStatements.push(createSQL);
            sqlStatements.push('');
        }

        if (tableData.data.length > 0) {
            sqlStatements.push('-- Table data');
            for (const row of tableData.data) {
                const values = tableData.columns.map(col => formatValue(row[col]));
                sqlStatements.push(
                    `INSERT INTO ${quoteTableName(tableName)} (${tableData.columns.map(c => `${quote}${c}${quote}`).join(', ')}) VALUES (${values.join(', ')});`
                );
            }
        } else {
            sqlStatements.push('-- No data in this table');
        }
        sqlStatements.push('');
    }

    // Add foreign key constraints at the end (PostgreSQL only - MySQL's SHOW CREATE TABLE already includes them)
    if (foreignKeys.length > 0 && isPostgres) {
        sqlStatements.push(`-- ============================================`);
        sqlStatements.push(`-- Foreign Key Constraints`);
        sqlStatements.push(`-- ============================================`);
        sqlStatements.push('');

        // Group foreign keys by constraint name to handle composite keys
        const fkGroups = new Map<string, ForeignKeyInfo[]>();
        foreignKeys.forEach(fk => {
            const key = `${fk.tableName}.${fk.constraintName}`;
            if (!fkGroups.has(key)) {
                fkGroups.set(key, []);
            }
            fkGroups.get(key)!.push(fk);
        });

        fkGroups.forEach((fks, _key) => {
            const fk = fks[0];
            const cols = fks.map(f => `${quote}${f.columnName}${quote}`).join(', ');
            const refCols = fks.map(f => `${quote}${f.foreignColumnName}${quote}`).join(', ');

            let stmt = `ALTER TABLE ${quoteTableName(fk.tableName)} ADD CONSTRAINT ${quote}${fk.constraintName}${quote} `;
            stmt += `FOREIGN KEY (${cols}) REFERENCES ${quoteTableName(fk.foreignTableName)} (${refCols})`;

            if (fk.deleteRule && fk.deleteRule !== 'NO ACTION') {
                stmt += ` ON DELETE ${fk.deleteRule}`;
            }
            if (fk.updateRule && fk.updateRule !== 'NO ACTION') {
                stmt += ` ON UPDATE ${fk.updateRule}`;
            }
            stmt += ';';
            sqlStatements.push(stmt);
        });
        sqlStatements.push('');
    }

    // Reset sequences for PostgreSQL SERIAL columns
    if (isPostgres) {
        const sequenceResets: string[] = [];
        for (const tableName of sortedTables) {
            const tableData = allTableData[tableName];
            if (tableData?.serialColumns && tableData.serialColumns.length > 0) {
                tableData.serialColumns.forEach(sc => {
                    // Reset sequence to max value + 1
                    sequenceResets.push(
                        `SELECT setval('${sc.sequenceName}', COALESCE((SELECT MAX("${sc.column}") FROM ${quoteTableName(tableName)}), 1));`
                    );
                });
            }
        }

        if (sequenceResets.length > 0) {
            sqlStatements.push(`-- ============================================`);
            sqlStatements.push(`-- Reset Sequences`);
            sqlStatements.push(`-- ============================================`);
            sqlStatements.push('');
            sequenceResets.forEach(stmt => sqlStatements.push(stmt));
            sqlStatements.push('');
        }
    }

    // Re-enable foreign key checks
    if (!isPostgres) {
        sqlStatements.push('-- Re-enable foreign key checks');
        sqlStatements.push('SET FOREIGN_KEY_CHECKS = 1;');
        sqlStatements.push('');
    }

    return sqlStatements.join('\n');
}

function formatValue(value: any): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (value instanceof Date) return `'${value.toISOString()}'`;

    // Handle PostgreSQL arrays
    if (Array.isArray(value)) {
        if (value.length === 0) return "'{}'";
        const formattedElements = value.map(v => {
            if (v === null) return 'NULL';
            if (typeof v === 'string') return `"${v.replace(/"/g, '\\"')}"`;
            return String(v);
        }).join(',');
        return `'{${formattedElements}}'`;
    }

    // Handle Buffer/Uint8Array for bytea
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
        return `'\\x${Buffer.from(value).toString('hex')}'`;
    }

    // Handle objects (JSON/JSONB)
    if (typeof value === 'object') {
        return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
    }

    return "'" + String(value).replace(/'/g, "''") + "'";
}

function generateCombinedCSV(allTableData: { [key: string]: TableExportData }): string {
    const escapeCSV = (value: any): string => {
        if (value === null || value === undefined) return '';
        if (typeof value === 'object') {
            const str = JSON.stringify(value);
            return `"${str.replace(/"/g, '""')}"`;
        }
        const str = String(value);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    const allParts: string[] = [];

    for (const [tableName, tableData] of Object.entries(allTableData)) {
        allParts.push(`# Table: ${tableName}`);

        if (tableData.columns.length > 0) {
            const header = tableData.columns.map(escapeCSV).join(',');
            allParts.push(header);

            for (const row of tableData.data) {
                const rowData = tableData.columns.map(col => escapeCSV(row[col])).join(',');
                allParts.push(rowData);
            }
        }
        allParts.push('');
    }

    return allParts.join('\n');
}
