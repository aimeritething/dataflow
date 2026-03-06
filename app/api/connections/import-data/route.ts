import { NextRequest, NextResponse } from 'next/server';

interface ImportParams {
    type: string;
    host: string;
    port: string;
    user: string;
    password: string;
    database: string;
    schema?: string;
    table: string;
    format: string;
}

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File;

        const params: ImportParams = {
            type: formData.get('type') as string,
            host: formData.get('host') as string,
            port: formData.get('port') as string,
            user: formData.get('user') as string,
            password: formData.get('password') as string,
            database: formData.get('database') as string,
            schema: formData.get('schema') as string | undefined,
            table: formData.get('table') as string,
            format: formData.get('format') as string,
        };

        console.log('[Import API] Received request:', {
            fileName: file.name,
            fileSize: file.size,
            type: params.type,
            database: params.database,
            table: params.table,
            format: params.format
        });

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
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
                await sendProgress(writer, encoder, 10, 'Parsing file...');

                // Parse data based on format
                let data: any[] = [];
                let columns: string[] = [];

                if (params.format === 'csv') {
                    const parsed = parseCSV(fileContent);
                    data = parsed.data;
                    columns = parsed.columns;
                } else if (params.format === 'json') {
                    data = JSON.parse(fileContent);
                    if (Array.isArray(data) && data.length > 0) {
                        columns = Object.keys(data[0]);
                    }
                } else if (params.format === 'sql') {
                    // For SQL files, we'll execute them directly
                    await sendProgress(writer, encoder, 30, 'Preparing SQL statements...');

                    if (params.type === 'mysql') {
                        await importSQLMySQL(params, fileContent, writer, encoder);
                    } else if (params.type === 'postgres' || params.type === 'postgresql') {
                        await importSQLPostgreSQL(params, fileContent, writer, encoder);
                    }
                    // SQL import functions send 100% progress internally
                    return;
                } else {
                    throw new Error('Unsupported format');
                }

                if (data.length === 0) {
                    throw new Error('No data found in file');
                }

                await sendProgress(writer, encoder, 30, `Parsed ${data.length} rows...`);

                // Import data based on database type
                if (params.type === 'mysql') {
                    await importDataMySQL(params, columns, data, writer, encoder);
                } else if (params.type === 'postgres' || params.type === 'postgresql') {
                    await importDataPostgreSQL(params, columns, data, writer, encoder);
                } else if (params.type === 'mongodb') {
                    await importDataMongoDB(params, data, writer, encoder);
                } else {
                    throw new Error('Unsupported database type');
                }

                await sendProgress(writer, encoder, 100, 'Import complete!');

            } catch (error: any) {
                console.error('[Import API] Error:', error);
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
        console.error('[Import API] Request error:', error);
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

function parseCSV(content: string): { columns: string[], data: any[] } {
    const lines = content.trim().split('\n');
    if (lines.length === 0) return { columns: [], data: [] };

    // Parse header
    const columns = lines[0].split(',').map(col => col.trim().replace(/^"|"$/g, ''));

    // Parse rows
    const data: any[] = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length === columns.length) {
            const row: any = {};
            columns.forEach((col, idx) => {
                row[col] = values[idx];
            });
            data.push(row);
        }
    }

    return { columns, data };
}

function parseCSVLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    values.push(current.trim());
    return values;
}

async function importDataMySQL(
    params: ImportParams,
    columns: string[],
    data: any[],
    writer: WritableStreamDefaultWriter,
    encoder: TextEncoder
) {
    const mysql = require('mysql2/promise');

    const connection = await mysql.createConnection({
        host: params.host,
        port: parseInt(params.port),
        user: params.user,
        password: params.password,
        database: params.database,
    });

    try {
        await sendProgress(writer, encoder, 50, 'Connecting to MySQL...');

        const batchSize = 100;
        const batches = Math.ceil(data.length / batchSize);

        for (let i = 0; i < batches; i++) {
            const start = i * batchSize;
            const end = Math.min((i + 1) * batchSize, data.length);
            const batch = data.slice(start, end);

            // Build bulk insert query
            const placeholders = batch.map(() =>
                `(${columns.map(() => '?').join(', ')})`
            ).join(', ');

            const query = `INSERT INTO \`${params.table}\` (${columns.map(c => `\`${c}\``).join(', ')}) VALUES ${placeholders}`;

            const values: any[] = [];
            batch.forEach(row => {
                columns.forEach(col => {
                    values.push(row[col] || null);
                });
            });

            await connection.execute(query, values);

            const progress = 50 + Math.round(((i + 1) / batches) * 40);
            await sendProgress(writer, encoder, progress, `Imported ${end} of ${data.length} rows...`);
        }
    } finally {
        await connection.end();
    }
}

async function importDataPostgreSQL(
    params: ImportParams,
    columns: string[],
    data: any[],
    writer: WritableStreamDefaultWriter,
    encoder: TextEncoder
) {
    const { Client } = require('pg');

    const client = new Client({
        host: params.host,
        port: parseInt(params.port),
        user: params.user,
        password: params.password,
        database: params.database,
    });

    try {
        await client.connect();
        await sendProgress(writer, encoder, 50, 'Connecting to PostgreSQL...');

        const schemaName = params.schema || 'public';
        const batchSize = 100;
        const batches = Math.ceil(data.length / batchSize);

        for (let i = 0; i < batches; i++) {
            const start = i * batchSize;
            const end = Math.min((i + 1) * batchSize, data.length);
            const batch = data.slice(start, end);

            // Build bulk insert query
            const valuePlaceholders: string[] = [];
            const values: any[] = [];
            let paramIndex = 1;

            batch.forEach((row) => {
                const rowPlaceholders = columns.map(() => `$${paramIndex++}`);
                valuePlaceholders.push(`(${rowPlaceholders.join(', ')})`);

                columns.forEach(col => {
                    values.push(row[col] || null);
                });
            });

            const query = `INSERT INTO "${schemaName}"."${params.table}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES ${valuePlaceholders.join(', ')}`;

            await client.query(query, values);

            const progress = 50 + Math.round(((i + 1) / batches) * 40);
            await sendProgress(writer, encoder, progress, `Imported ${end} of ${data.length} rows...`);
        }
    } finally {
        await client.end();
    }
}

async function importSQLMySQL(
    params: ImportParams,
    sqlContent: string,
    writer: WritableStreamDefaultWriter,
    encoder: TextEncoder
) {
    const mysql = require('mysql2/promise');

    const connection = await mysql.createConnection({
        host: params.host,
        port: parseInt(params.port),
        user: params.user,
        password: params.password,
        database: params.database,
        multipleStatements: true,
    });

    try {
        await sendProgress(writer, encoder, 35, 'Analyzing SQL statements...');

        const targetTable = params.table;

        // Smart SQL splitting that handles multi-line statements
        // Split by semicolons but be careful with strings
        const statements: string[] = [];
        let currentStatement = '';
        let inString = false;
        let stringChar = '';

        for (let i = 0; i < sqlContent.length; i++) {
            const char = sqlContent[i];
            const prevChar = i > 0 ? sqlContent[i - 1] : '';

            if (!inString && (char === "'" || char === '"')) {
                inString = true;
                stringChar = char;
            } else if (inString && char === stringChar && prevChar !== '\\') {
                inString = false;
            }

            if (char === ';' && !inString) {
                const stmt = currentStatement.trim();
                if (stmt.length > 0 && !stmt.startsWith('--')) {
                    statements.push(stmt);
                }
                currentStatement = '';
            } else {
                currentStatement += char;
            }
        }
        // Don't forget the last statement if no trailing semicolon
        const lastStmt = currentStatement.trim();
        if (lastStmt.length > 0 && !lastStmt.startsWith('--')) {
            statements.push(lastStmt);
        }

        console.log('[Import SQL] Total statements found:', statements.length);

        // Find CREATE TABLE statements and their original table names
        // More flexible regex that handles various formats
        const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)[`"']?\s*\(/i;
        const insertRegex = /INSERT\s+INTO\s+[`"']?(\w+)[`"']?\s*[\(\s]/i;

        let originalTableName: string | null = null;
        let hasCreateTable = false;

        // Find the original table name from CREATE TABLE or INSERT statements
        for (const stmt of statements) {
            const createMatch = stmt.match(createTableRegex);
            if (createMatch) {
                originalTableName = createMatch[1];
                hasCreateTable = true;
                console.log('[Import SQL] Found CREATE TABLE for:', originalTableName);
                break;
            }
        }

        // If no CREATE TABLE, look for INSERT
        if (!originalTableName) {
            for (const stmt of statements) {
                const insertMatch = stmt.match(insertRegex);
                if (insertMatch) {
                    originalTableName = insertMatch[1];
                    console.log('[Import SQL] Found INSERT INTO for:', originalTableName);
                    break;
                }
            }
        }

        console.log('[Import SQL] Original table:', originalTableName, 'Target table:', targetTable, 'Has CREATE:', hasCreateTable);

        // Check if target table exists
        const [tableRows] = await connection.query(
            'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
            [params.database, targetTable]
        );
        const tableExists = Array.isArray(tableRows) && tableRows.length > 0;
        console.log('[Import SQL] Target table exists:', tableExists);

        // If table doesn't exist and SQL has no CREATE TABLE, try to create table from INSERT statements
        if (!tableExists && !hasCreateTable) {
            console.log('[Import SQL] Table does not exist, attempting to create from INSERT...');
            await sendProgress(writer, encoder, 38, 'Creating table structure from data...');

            // Find the first INSERT statement to extract column info
            // Try multiple regex patterns to handle different SQL formats
            let columnsFromInsert: string[] = [];
            let valuesFromInsert: string[] = [];

            for (const stmt of statements) {
                // Log the statement being analyzed for debugging
                console.log('[Import SQL] Analyzing statement:', stmt.substring(0, 200));

                // Pattern 1: INSERT INTO `table` (`col1`, `col2`) VALUES (...)
                // Pattern 2: INSERT INTO table (col1, col2) VALUES (...)
                // Pattern 3: INSERT INTO "table" ("col1", "col2") VALUES (...)
                const columnMatch = stmt.match(/INSERT\s+INTO\s+[`"']?[\w]+[`"']?\s*\(\s*([^)]+)\s*\)\s*VALUES/i);

                if (columnMatch) {
                    // Extract column names
                    const columnsPart = columnMatch[1];
                    columnsFromInsert = columnsPart.split(',').map(c => c.trim().replace(/[`"']/g, ''));
                    console.log('[Import SQL] Extracted columns:', columnsFromInsert);

                    // Extract values - need to handle strings with commas
                    const valuesMatch = stmt.match(/VALUES\s*\(\s*(.+)\s*\)/i);
                    if (valuesMatch) {
                        // Smart split that respects quoted strings
                        const valuesPart = valuesMatch[1];
                        valuesFromInsert = [];
                        let currentValue = '';
                        let inString = false;
                        let stringChar = '';

                        for (let i = 0; i < valuesPart.length; i++) {
                            const char = valuesPart[i];
                            const prevChar = i > 0 ? valuesPart[i - 1] : '';

                            if (!inString && (char === "'" || char === '"')) {
                                inString = true;
                                stringChar = char;
                                currentValue += char;
                            } else if (inString && char === stringChar && prevChar !== '\\') {
                                inString = false;
                                currentValue += char;
                            } else if (char === ',' && !inString) {
                                valuesFromInsert.push(currentValue.trim());
                                currentValue = '';
                            } else {
                                currentValue += char;
                            }
                        }
                        if (currentValue.trim()) {
                            valuesFromInsert.push(currentValue.trim());
                        }
                        console.log('[Import SQL] Extracted values:', valuesFromInsert);
                    }
                    break;
                }
            }

            // If still no columns found, try a simpler approach
            if (columnsFromInsert.length === 0) {
                console.log('[Import SQL] First regex failed, trying simpler patterns...');
                for (const stmt of statements) {
                    if (stmt.toUpperCase().includes('INSERT') && stmt.toUpperCase().includes('INTO')) {
                        // Try to extract between first ( and ) before VALUES
                        const match = stmt.match(/\(\s*([^)]+)\s*\)\s*VALUES/i);
                        if (match) {
                            columnsFromInsert = match[1].split(',').map(c => c.trim().replace(/[`"']/g, ''));
                            console.log('[Import SQL] Extracted columns (fallback):', columnsFromInsert);

                            // Get first value set
                            const valMatch = stmt.match(/VALUES\s*\(\s*([^)]+)\s*\)/i);
                            if (valMatch) {
                                valuesFromInsert = valMatch[1].split(',').map(v => v.trim());
                            }
                            break;
                        }
                    }
                }
            }

            if (columnsFromInsert.length === 0) {
                throw new Error(
                    'Table "' + targetTable + '" does not exist and could not extract column information from INSERT statements. ' +
                    'Please create the table manually or use a SQL file that includes CREATE TABLE statement.'
                );
            }

            // Infer column types from values
            const columnDefs = columnsFromInsert.map((col, idx) => {
                const value = valuesFromInsert[idx] || 'NULL';
                let colType = 'TEXT'; // Default type

                // Try to infer type from value
                if (value === 'NULL') {
                    colType = 'TEXT';
                } else if (/^-?\d+$/.test(value)) {
                    // Integer
                    const num = parseInt(value);
                    if (num > 2147483647 || num < -2147483648) {
                        colType = 'BIGINT';
                    } else {
                        colType = 'INT';
                    }
                } else if (/^-?\d+\.\d+$/.test(value)) {
                    // Decimal
                    colType = 'DECIMAL(20,6)';
                } else if (/^'.*'$/.test(value)) {
                    // String - check length
                    const strLen = value.length - 2; // Remove quotes
                    if (strLen > 255) {
                        colType = 'TEXT';
                    } else {
                        colType = 'VARCHAR(255)';
                    }
                } else if (/^(TRUE|FALSE)$/i.test(value)) {
                    colType = 'BOOLEAN';
                }

                return '`' + col + '` ' + colType;
            });

            const createTableSQL = 'CREATE TABLE `' + targetTable + '` (\n  ' + columnDefs.join(',\n  ') + '\n)';
            console.log('[Import SQL] Auto-generated CREATE TABLE:', createTableSQL);

            try {
                await connection.query(createTableSQL);
                console.log('[Import SQL] Table created successfully');
            } catch (err: any) {
                throw new Error('Failed to auto-create table: ' + err.message);
            }
        }

        await sendProgress(writer, encoder, 40, 'Executing SQL statements...');

        const totalStatements = statements.length;
        let executedCount = 0;

        // Helper function to replace table names in SQL statements
        const replaceTableName = (sql: string, oldName: string, newName: string): string => {
            // Escape special regex characters in oldName
            const escapedOldName = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            // Replace in CREATE TABLE
            sql = sql.replace(
                new RegExp('(CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?)[`"\']?' + escapedOldName + '[`"\']?(\\s*\\()', 'gi'),
                '$1`' + newName + '`$2'
            );
            // Replace in INSERT INTO
            sql = sql.replace(
                new RegExp('(INSERT\\s+INTO\\s+)[`"\']?' + escapedOldName + '[`"\']?(\\s*[\\(\\s])', 'gi'),
                '$1`' + newName + '`$2'
            );
            // Replace in UPDATE
            sql = sql.replace(
                new RegExp('(UPDATE\\s+)[`"\']?' + escapedOldName + '[`"\']?(\\s+SET)', 'gi'),
                '$1`' + newName + '`$2'
            );
            // Replace in DELETE FROM
            sql = sql.replace(
                new RegExp('(DELETE\\s+FROM\\s+)[`"\']?' + escapedOldName + '[`"\']?(\\s|$)', 'gi'),
                '$1`' + newName + '`$2'
            );
            return sql;
        };

        for (let i = 0; i < totalStatements; i++) {
            let stmt = statements[i];

            // If we need to rename tables in SQL
            if (originalTableName && originalTableName.toLowerCase() !== targetTable.toLowerCase()) {
                stmt = replaceTableName(stmt, originalTableName, targetTable);
            }

            try {
                console.log('[Import SQL] Executing statement', i + 1, ':', stmt.substring(0, 100) + '...');
                await connection.query(stmt);
                executedCount++;
            } catch (err: any) {
                console.error('[Import SQL] Error executing statement:', err.message);
                // If it's a "table already exists" error, skip it
                if (err.code === 'ER_TABLE_EXISTS_ERROR') {
                    console.log('[Import SQL] Table already exists, skipping CREATE TABLE');
                } else {
                    throw err;
                }
            }

            // Progress from 40% to 95%
            const progress = 40 + Math.round(((i + 1) / totalStatements) * 55);
            await sendProgress(writer, encoder, progress, 'Executed ' + (i + 1) + ' of ' + totalStatements + ' statements...');
        }

        // Send final 100% progress
        await sendProgress(writer, encoder, 100, 'Import complete! Executed ' + executedCount + ' statements.');
    } finally {
        await connection.end();
    }
}

async function importSQLPostgreSQL(
    params: ImportParams,
    sqlContent: string,
    writer: WritableStreamDefaultWriter,
    encoder: TextEncoder
) {
    const { Client } = require('pg');

    const client = new Client({
        host: params.host,
        port: parseInt(params.port),
        user: params.user,
        password: params.password,
        database: params.database,
    });

    try {
        await client.connect();
        await sendProgress(writer, encoder, 35, 'Analyzing SQL statements...');

        const targetTable = params.table;
        const targetSchema = params.schema || 'public';

        // Smart SQL splitting that handles multi-line statements
        const statements: string[] = [];
        let currentStatement = '';
        let inString = false;
        let stringChar = '';

        for (let i = 0; i < sqlContent.length; i++) {
            const char = sqlContent[i];
            const prevChar = i > 0 ? sqlContent[i - 1] : '';

            if (!inString && (char === "'" || char === '"')) {
                inString = true;
                stringChar = char;
            } else if (inString && char === stringChar && prevChar !== '\\') {
                inString = false;
            }

            if (char === ';' && !inString) {
                const stmt = currentStatement.trim();
                if (stmt.length > 0 && !stmt.startsWith('--')) {
                    statements.push(stmt);
                }
                currentStatement = '';
            } else {
                currentStatement += char;
            }
        }
        const lastStmt = currentStatement.trim();
        if (lastStmt.length > 0 && !lastStmt.startsWith('--')) {
            statements.push(lastStmt);
        }

        console.log('[Import SQL PG] Total statements found:', statements.length);

        // Find CREATE TABLE statements
        const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?\s*\(/i;
        const insertRegex = /INSERT\s+INTO\s+["']?(\w+)["']?\s*[\(\s]/i;

        let originalTableName: string | null = null;
        let hasCreateTable = false;

        for (const stmt of statements) {
            const createMatch = stmt.match(createTableRegex);
            if (createMatch) {
                originalTableName = createMatch[1];
                hasCreateTable = true;
                console.log('[Import SQL PG] Found CREATE TABLE for:', originalTableName);
                break;
            }
        }

        if (!originalTableName) {
            for (const stmt of statements) {
                const insertMatch = stmt.match(insertRegex);
                if (insertMatch) {
                    originalTableName = insertMatch[1];
                    console.log('[Import SQL PG] Found INSERT INTO for:', originalTableName);
                    break;
                }
            }
        }

        console.log('[Import SQL PG] Original table:', originalTableName, 'Target table:', targetTable, 'Has CREATE:', hasCreateTable);

        // Check if target table exists
        const tableResult = await client.query(
            'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2',
            [targetSchema, targetTable]
        );
        const tableExists = tableResult.rows.length > 0;
        console.log('[Import SQL PG] Target table exists:', tableExists);

        // If table doesn't exist and SQL has no CREATE TABLE, try to create from INSERT
        if (!tableExists && !hasCreateTable) {
            console.log('[Import SQL PG] Table does not exist, attempting to create from INSERT...');
            await sendProgress(writer, encoder, 38, 'Creating table structure from data...');

            // Find the first INSERT statement to extract column info
            // Try multiple regex patterns to handle different SQL formats
            let columnsFromInsert: string[] = [];
            let valuesFromInsert: string[] = [];

            for (const stmt of statements) {
                console.log('[Import SQL PG] Analyzing statement:', stmt.substring(0, 200));

                const columnMatch = stmt.match(/INSERT\s+INTO\s+[`"']?[\w]+[`"']?\s*\(\s*([^)]+)\s*\)\s*VALUES/i);

                if (columnMatch) {
                    const columnsPart = columnMatch[1];
                    columnsFromInsert = columnsPart.split(',').map(c => c.trim().replace(/[`"']/g, ''));
                    console.log('[Import SQL PG] Extracted columns:', columnsFromInsert);

                    const valuesMatch = stmt.match(/VALUES\s*\(\s*(.+)\s*\)/i);
                    if (valuesMatch) {
                        const valuesPart = valuesMatch[1];
                        valuesFromInsert = [];
                        let currentValue = '';
                        let inString = false;
                        let stringChar = '';

                        for (let i = 0; i < valuesPart.length; i++) {
                            const char = valuesPart[i];
                            const prevChar = i > 0 ? valuesPart[i - 1] : '';

                            if (!inString && (char === "'" || char === '"')) {
                                inString = true;
                                stringChar = char;
                                currentValue += char;
                            } else if (inString && char === stringChar && prevChar !== '\\') {
                                inString = false;
                                currentValue += char;
                            } else if (char === ',' && !inString) {
                                valuesFromInsert.push(currentValue.trim());
                                currentValue = '';
                            } else {
                                currentValue += char;
                            }
                        }
                        if (currentValue.trim()) {
                            valuesFromInsert.push(currentValue.trim());
                        }
                        console.log('[Import SQL PG] Extracted values:', valuesFromInsert);
                    }
                    break;
                }
            }

            // Fallback pattern
            if (columnsFromInsert.length === 0) {
                console.log('[Import SQL PG] First regex failed, trying simpler patterns...');
                for (const stmt of statements) {
                    if (stmt.toUpperCase().includes('INSERT') && stmt.toUpperCase().includes('INTO')) {
                        const match = stmt.match(/\(\s*([^)]+)\s*\)\s*VALUES/i);
                        if (match) {
                            columnsFromInsert = match[1].split(',').map(c => c.trim().replace(/[`"']/g, ''));
                            console.log('[Import SQL PG] Extracted columns (fallback):', columnsFromInsert);

                            const valMatch = stmt.match(/VALUES\s*\(\s*([^)]+)\s*\)/i);
                            if (valMatch) {
                                valuesFromInsert = valMatch[1].split(',').map(v => v.trim());
                            }
                            break;
                        }
                    }
                }
            }

            if (columnsFromInsert.length === 0) {
                throw new Error(
                    'Table "' + targetTable + '" does not exist and could not extract column information from INSERT statements. ' +
                    'Please create the table manually or use a SQL file that includes CREATE TABLE statement.'
                );
            }

            // Infer column types from values (PostgreSQL types)
            const columnDefs = columnsFromInsert.map((col, idx) => {
                const value = valuesFromInsert[idx] || 'NULL';
                let colType = 'TEXT';

                if (value === 'NULL') {
                    colType = 'TEXT';
                } else if (/^-?\d+$/.test(value)) {
                    const num = parseInt(value);
                    if (num > 2147483647 || num < -2147483648) {
                        colType = 'BIGINT';
                    } else {
                        colType = 'INTEGER';
                    }
                } else if (/^-?\d+\.\d+$/.test(value)) {
                    colType = 'NUMERIC(20,6)';
                } else if (/^'.*'$/.test(value)) {
                    const strLen = value.length - 2;
                    if (strLen > 255) {
                        colType = 'TEXT';
                    } else {
                        colType = 'VARCHAR(255)';
                    }
                } else if (/^(TRUE|FALSE)$/i.test(value)) {
                    colType = 'BOOLEAN';
                }

                return '"' + col + '" ' + colType;
            });

            const createTableSQL = 'CREATE TABLE "' + targetSchema + '"."' + targetTable + '" (\n  ' + columnDefs.join(',\n  ') + '\n)';
            console.log('[Import SQL PG] Auto-generated CREATE TABLE in schema ' + targetSchema + ':', createTableSQL);

            try {
                await client.query(createTableSQL);
                console.log('[Import SQL PG] Table created successfully in schema:', targetSchema);
            } catch (err: any) {
                throw new Error('Failed to auto-create table: ' + err.message);
            }
        }

        await sendProgress(writer, encoder, 40, 'Executing SQL statements...');

        const totalStatements = statements.length;
        let executedCount = 0;

        const replaceTableName = (sql: string, oldName: string, newName: string): string => {
            const escapedOldName = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            sql = sql.replace(
                new RegExp('(CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?)["\']?' + escapedOldName + '["\']?(\\s*\\()', 'gi'),
                '$1"' + newName + '"$2'
            );
            sql = sql.replace(
                new RegExp('(INSERT\\s+INTO\\s+)["\']?' + escapedOldName + '["\']?(\\s*[\\(\\s])', 'gi'),
                '$1"' + newName + '"$2'
            );
            sql = sql.replace(
                new RegExp('(UPDATE\\s+)["\']?' + escapedOldName + '["\']?(\\s+SET)', 'gi'),
                '$1"' + newName + '"$2'
            );
            sql = sql.replace(
                new RegExp('(DELETE\\s+FROM\\s+)["\']?' + escapedOldName + '["\']?(\\s|$)', 'gi'),
                '$1"' + newName + '"$2'
            );
            return sql;
        };

        for (let i = 0; i < totalStatements; i++) {
            let stmt = statements[i];

            if (originalTableName && originalTableName.toLowerCase() !== targetTable.toLowerCase()) {
                stmt = replaceTableName(stmt, originalTableName, targetTable);
            }

            // Convert MySQL syntax to PostgreSQL syntax
            // Replace backticks with double quotes
            stmt = stmt.replace(/`/g, '"');

            // Skip MySQL-specific statements that PostgreSQL doesn't understand
            if (stmt.match(/^\s*(SET|LOCK\s+TABLES|UNLOCK\s+TABLES|\/\*!)/i)) {
                console.log('[Import SQL PG] Skipping MySQL-specific statement');
                continue;
            }

            try {
                console.log('[Import SQL PG] Executing statement', i + 1, ':', stmt.substring(0, 100) + '...');
                await client.query(stmt);
                executedCount++;
            } catch (err: any) {
                console.error('[Import SQL PG] Error executing statement:', err.message);
                if (err.code === '42P07') {
                    console.log('[Import SQL PG] Table already exists, skipping CREATE TABLE');
                } else {
                    throw err;
                }
            }

            const progress = 40 + Math.round(((i + 1) / totalStatements) * 55);
            await sendProgress(writer, encoder, progress, 'Executed ' + (i + 1) + ' of ' + totalStatements + ' statements...');
        }

        await sendProgress(writer, encoder, 100, 'Import complete! Executed ' + executedCount + ' statements.');
    } finally {
        await client.end();
    }
}

async function importDataMongoDB(
    params: ImportParams,
    data: any[],
    writer: WritableStreamDefaultWriter,
    encoder: TextEncoder
) {
    const { MongoClient } = require('mongodb');

    let uri: string;
    if (params.host.startsWith('mongodb')) {
        uri = params.host;
    } else {
        const auth = params.user && params.password
            ? `${encodeURIComponent(params.user)}:${encodeURIComponent(params.password)}@`
            : '';
        uri = `mongodb://${auth}${params.host}:${params.port}/${params.database}?authSource=admin`;
    }

    const client = new MongoClient(uri, {
        directConnection: true,
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000,
    });

    try {
        await client.connect();
        const db = client.db(params.database);
        const collection = db.collection(params.table);

        await sendProgress(writer, encoder, 50, 'Connected to MongoDB...');

        // Clean documents - remove _id fields to let MongoDB generate new ones
        const cleanedDocuments = data.map(doc => {
            const { _id, ...rest } = doc;
            return rest;
        });

        await sendProgress(writer, encoder, 60, `Inserting ${cleanedDocuments.length} documents...`);

        // Insert in batches for large datasets
        const batchSize = 1000;
        let insertedCount = 0;

        for (let i = 0; i < cleanedDocuments.length; i += batchSize) {
            const batch = cleanedDocuments.slice(i, i + batchSize);
            const result = await collection.insertMany(batch);
            insertedCount += result.insertedCount;

            const progress = 60 + Math.round((i / cleanedDocuments.length) * 35);
            await sendProgress(writer, encoder, progress, `Inserted ${insertedCount} of ${cleanedDocuments.length} documents...`);
        }

        await sendProgress(writer, encoder, 95, 'Finalizing...');
        console.log('[Import MongoDB] Successfully inserted', insertedCount, 'documents');
    } finally {
        await client.close();
    }
}
