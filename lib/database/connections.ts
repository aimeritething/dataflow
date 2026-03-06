import { Pool as PgPool } from 'pg';
import mysql from 'mysql2/promise';
import { MongoClient } from 'mongodb';
import { createClient } from 'redis';
import type { Connection } from '@/contexts/ConnectionContext';

// Connection pool cache
const connectionPools: { [key: string]: any } = {};

/**
 * Get database connection by ID
 * In a real implementation, this would fetch from a database or secure storage
 */
export async function getConnectionById(connectionId: string): Promise<Connection | null> {
    // This is a placeholder - in production, fetch from database
    // For now, we'll return null and the API will need to receive connection details
    return null;
}

/**
 * Create or get cached connection pool for PostgreSQL
 */
function getPostgresPool(connection: Connection): PgPool {
    const cacheKey = `pg-${connection.id}`;

    if (!connectionPools[cacheKey]) {
        connectionPools[cacheKey] = new PgPool({
            host: connection.host,
            port: parseInt(connection.port),
            database: connection.database,
            user: connection.user,
            password: connection.password,
            max: 10,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
        });
    }

    return connectionPools[cacheKey];
}

/**
 * Split SQL into individual statements
 * Handles semicolons within strings and comments
 */
function splitSQLStatements(sql: string): string[] {
    const statements: string[] = [];
    let current = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inLineComment = false;
    let inBlockComment = false;
    let inDollarQuote = false;
    let dollarTag = '';

    for (let i = 0; i < sql.length; i++) {
        const char = sql[i];
        const nextChar = sql[i + 1] || '';
        const prevChar = sql[i - 1] || '';

        // Handle dollar quoting (PostgreSQL)
        if (!inSingleQuote && !inDoubleQuote && !inLineComment && !inBlockComment) {
            if (char === '$') {
                // Check for dollar quote start/end
                let tag = '$';
                let j = i + 1;
                while (j < sql.length && (sql[j].match(/[a-zA-Z0-9_]/) || sql[j] === '$')) {
                    tag += sql[j];
                    if (sql[j] === '$') break;
                    j++;
                }
                if (tag.endsWith('$') && tag.length > 1) {
                    if (inDollarQuote && tag === dollarTag) {
                        inDollarQuote = false;
                        current += tag;
                        i = j;
                        continue;
                    } else if (!inDollarQuote) {
                        inDollarQuote = true;
                        dollarTag = tag;
                        current += tag;
                        i = j;
                        continue;
                    }
                }
            }
        }

        if (inDollarQuote) {
            current += char;
            continue;
        }

        // Handle comments
        if (!inSingleQuote && !inDoubleQuote && !inBlockComment && char === '-' && nextChar === '-') {
            inLineComment = true;
        }
        if (inLineComment && char === '\n') {
            inLineComment = false;
        }
        if (!inSingleQuote && !inDoubleQuote && !inLineComment && char === '/' && nextChar === '*') {
            inBlockComment = true;
        }
        if (inBlockComment && char === '*' && nextChar === '/') {
            current += char + nextChar;
            i++;
            inBlockComment = false;
            continue;
        }

        // Handle string quotes
        if (!inLineComment && !inBlockComment) {
            if (char === "'" && !inDoubleQuote && prevChar !== '\\') {
                inSingleQuote = !inSingleQuote;
            }
            if (char === '"' && !inSingleQuote && prevChar !== '\\') {
                inDoubleQuote = !inDoubleQuote;
            }
        }

        // Handle statement terminator
        if (!inSingleQuote && !inDoubleQuote && !inLineComment && !inBlockComment && char === ';') {
            const stmt = current.trim();
            if (stmt) {
                statements.push(stmt);
            }
            current = '';
            continue;
        }

        current += char;
    }

    // Add final statement if any
    const finalStmt = current.trim();
    if (finalStmt) {
        statements.push(finalStmt);
    }

    return statements;
}

/**
 * Execute PostgreSQL query
 * Supports multiple statements separated by semicolons
 * Returns partial results if a statement fails
 */
export async function executePostgresQuery(connection: Connection, query: string, database?: string) {
    const pool = new PgPool({
        host: connection.host,
        port: parseInt(connection.port),
        database: database || connection.database,
        user: connection.user,
        password: connection.password,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
    });

    const processedResults: any[] = [];

    try {
        // Get all non-system schemas and set search_path
        const schemaResult = await pool.query(`
            SELECT schema_name 
            FROM information_schema.schemata 
            WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast', 'pg_temp_1', 'pg_toast_temp_1')
            ORDER BY schema_name
        `);

        const schemas = schemaResult.rows.map((r: any) => r.schema_name);

        if (schemas.length > 0) {
            const orderedSchemas = schemas.includes('public')
                ? ['public', ...schemas.filter((s: string) => s !== 'public')]
                : schemas;
            const searchPath = orderedSchemas.map((s: string) => `"${s}"`).join(', ');
            await pool.query(`SET search_path TO ${searchPath}`);
        }

        // Split SQL into individual statements
        const statements = splitSQLStatements(query);

        // Execute each statement one by one
        for (let i = 0; i < statements.length; i++) {
            const stmt = statements[i];
            try {
                const result = await pool.query(stmt);

                if (result.fields && result.fields.length > 0) {
                    processedResults.push({
                        sql: stmt,
                        columns: result.fields.map((f: any) => f.name),
                        rows: result.rows,
                    });
                } else {
                    processedResults.push({
                        sql: stmt,
                        columns: ['command', 'rowCount'],
                        rows: [{
                            command: result.command || 'OK',
                            rowCount: result.rowCount ?? 0,
                        }],
                        info: `${result.command || 'OK'}: ${result.rowCount ?? 0} row(s) affected`,
                    });
                }
            } catch (stmtError: any) {
                // Add error result and stop execution
                processedResults.push({
                    sql: stmt,
                    columns: ['error'],
                    rows: [{ error: stmtError.message }],
                    error: `Statement ${i + 1} Error: ${stmtError.message}`,
                    isError: true,
                });
                // Return partial results with the error
                return {
                    success: false,
                    error: `Statement ${i + 1} failed: ${stmtError.message}`,
                    data: processedResults,
                };
            }
        }

        return {
            success: true,
            data: processedResults,
        };
    } catch (error: any) {
        return {
            success: false,
            error: `PostgreSQL Error: ${error.message}`,
            data: processedResults,
        };
    } finally {
        await pool.end();
    }
}

/**
 * Execute MySQL query
 * Supports multiple statements separated by semicolons
 * Returns partial results if a statement fails
 */
export async function executeMySQLQuery(connection: Connection, query: string, database?: string) {
    const processedResults: any[] = [];
    let mysqlConnection: any = null;

    try {
        mysqlConnection = await mysql.createConnection({
            host: connection.host,
            port: parseInt(connection.port),
            user: connection.user,
            password: connection.password,
            database: database || connection.database,
        });

        // Split SQL into individual statements
        const statements = splitSQLStatements(query);

        // Execute each statement one by one
        for (let i = 0; i < statements.length; i++) {
            const stmt = statements[i];
            try {
                const [results, fields] = await mysqlConnection.query(stmt);

                // Handle SELECT results (array of rows)
                if (Array.isArray(results) && (results.length === 0 || (results.length > 0 && typeof results[0] === 'object' && !('affectedRows' in results[0])))) {
                    let columns: string[];
                    if (results.length > 0 && typeof results[0] === 'object') {
                        columns = Object.keys(results[0]);
                    } else if (fields && Array.isArray(fields)) {
                        columns = fields.map((f: any) => f.name);
                    } else {
                        columns = ['Result'];
                    }
                    processedResults.push({
                        sql: stmt,
                        columns,
                        rows: results,
                    });
                } else if (typeof results === 'object' && 'affectedRows' in results) {
                    // DML result - OkPacket
                    const okResult = results as any;
                    processedResults.push({
                        sql: stmt,
                        columns: ['affectedRows', 'insertId', 'info'],
                        rows: [{
                            affectedRows: okResult.affectedRows ?? 0,
                            insertId: okResult.insertId ?? null,
                            info: okResult.info || 'Query executed successfully',
                        }],
                        info: `${okResult.affectedRows ?? 0} row(s) affected`,
                    });
                }
            } catch (stmtError: any) {
                // Add error result and stop execution
                processedResults.push({
                    sql: stmt,
                    columns: ['error'],
                    rows: [{ error: stmtError.message }],
                    error: `Statement ${i + 1} Error: ${stmtError.message}`,
                    isError: true,
                });
                // Return partial results with the error
                return {
                    success: false,
                    error: `Statement ${i + 1} failed: ${stmtError.message}`,
                    data: processedResults,
                };
            }
        }

        return {
            success: true,
            data: processedResults,
        };
    } catch (error: any) {
        return {
            success: false,
            error: `MySQL Error: ${error.message}`,
            data: processedResults,
        };
    } finally {
        if (mysqlConnection) {
            await mysqlConnection.end();
        }
    }
}

/**
 * Execute MongoDB query
 */
export async function executeMongoDBQuery(connection: Connection, query: string, database?: string) {
    try {
        const uri = `mongodb://${connection.user}:${connection.password}@${connection.host}:${connection.port}`;
        const client = new MongoClient(uri);

        await client.connect();
        const db = client.db(database || connection.database);

        // Parse query as MongoDB command or find operation
        let result;
        if (query.trim().startsWith('{')) {
            // Assume it's a find query like: { collection: "users", filter: {} }
            const queryObj = JSON.parse(query);
            const collection = db.collection(queryObj.collection || 'default');
            const docs = await collection.find(queryObj.filter || {}).limit(queryObj.limit || 100).toArray();

            result = {
                columns: docs.length > 0 ? Object.keys(docs[0]) : [],
                rows: docs,
            };
        } else {
            // Try as db command
            const commandResult = await db.command(JSON.parse(query));
            result = {
                columns: ['result'],
                rows: [commandResult],
            };
        }

        await client.close();

        return {
            success: true,
            data: result,
        };
    } catch (error: any) {
        return {
            success: false,
            error: `MongoDB Error: ${error.message}`,
        };
    }
}

/**
 * Execute Redis command
 */
export async function executeRedisCommand(connection: Connection, command: string) {
    try {
        const client = createClient({
            socket: {
                host: connection.host,
                port: parseInt(connection.port),
            },
            password: connection.password || undefined,
        });

        await client.connect();

        // Parse command string into array
        const parts = command.trim().split(/\s+/);
        const result = await client.sendCommand(parts);

        await client.disconnect();

        return {
            success: true,
            data: {
                columns: ['Result'],
                rows: [{ Result: typeof result === 'string' ? result : JSON.stringify(result) }],
            },
        };
    } catch (error: any) {
        return {
            success: false,
            error: `Redis Error: ${error.message}`,
        };
    }
}

/**
 * Close all connection pools
 */
export async function closeAllPools() {
    for (const key in connectionPools) {
        const pool = connectionPools[key];
        if (pool && typeof pool.end === 'function') {
            await pool.end();
        }
    }
}
