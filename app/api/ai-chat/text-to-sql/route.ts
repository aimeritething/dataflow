/**
 * Text-to-SQL API Endpoint
 * 
 * POST /api/ai-chat/text-to-sql
 * 
 * Converts natural language questions to SQL queries using AI,
 * then executes the query and returns results.
 */

import { NextRequest, NextResponse } from 'next/server';
import { textToSQL, refineSql, type TableSchema } from '@/lib/ai';
import mysql from 'mysql2/promise';
import { Pool } from 'pg';
import { MongoClient } from 'mongodb';

interface RequestBody {
    question: string;
    connectionType: string;
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
}

interface QueryResult {
    columns: string[];
    rows: Record<string, unknown>[];
}

/**
 * Get database schema
 */
async function getSchema(params: RequestBody): Promise<TableSchema[]> {
    const { connectionType, host, port, user, password, database } = params;

    if (connectionType === 'mysql') {
        const connection = await mysql.createConnection({
            host,
            port,
            user,
            password,
            database,
        });

        try {
            // Get all tables
            const [tables] = await connection.query<mysql.RowDataPacket[]>(
                `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?`,
                [database]
            );

            const schema: TableSchema[] = [];

            for (const table of tables) {
                const tableName = table.TABLE_NAME;

                // Get columns for each table
                const [columns] = await connection.query<mysql.RowDataPacket[]>(
                    `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY 
           FROM INFORMATION_SCHEMA.COLUMNS 
           WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
                    [database, tableName]
                );

                schema.push({
                    name: tableName,
                    columns: columns.map(col => ({
                        name: col.COLUMN_NAME,
                        type: col.DATA_TYPE,
                        nullable: col.IS_NULLABLE === 'YES',
                        key: col.COLUMN_KEY,
                    })),
                });
            }

            return schema;
        } finally {
            await connection.end();
        }
    }

    if (connectionType === 'postgresql') {
        const pool = new Pool({
            host,
            port,
            user,
            password,
            database,
        });

        try {
            // Get all tables
            const tablesResult = await pool.query(
                `SELECT table_name FROM information_schema.tables 
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
            );

            const schema: TableSchema[] = [];

            for (const table of tablesResult.rows) {
                const tableName = table.table_name;

                // Get columns for each table
                const columnsResult = await pool.query(
                    `SELECT column_name, data_type, is_nullable 
           FROM information_schema.columns 
           WHERE table_schema = 'public' AND table_name = $1`,
                    [tableName]
                );

                schema.push({
                    name: tableName,
                    columns: columnsResult.rows.map(col => ({
                        name: col.column_name,
                        type: col.data_type,
                        nullable: col.is_nullable === 'YES',
                    })),
                });
            }

            return schema;
        } finally {
            await pool.end();
        }
    }

    // MongoDB - return collection info
    if (connectionType === 'mongodb') {
        const client = new MongoClient(`mongodb://${user}:${password}@${host}:${port}/${database}`);

        try {
            await client.connect();
            const db = client.db(database);
            const collections = await db.listCollections().toArray();

            return collections.map(col => ({
                name: col.name,
                columns: [{ name: '_id', type: 'ObjectId' }],
            }));
        } finally {
            await client.close();
        }
    }

    throw new Error(`Unsupported database type: ${connectionType}`);
}

/**
 * Execute SQL query
 */
async function executeQuery(params: RequestBody, sql: string): Promise<QueryResult> {
    const { connectionType, host, port, user, password, database } = params;

    if (connectionType === 'mysql') {
        const connection = await mysql.createConnection({
            host,
            port,
            user,
            password,
            database,
        });

        try {
            const [rows] = await connection.query<mysql.RowDataPacket[]>(sql);

            if (!Array.isArray(rows) || rows.length === 0) {
                return { columns: [], rows: [] };
            }

            const columns = Object.keys(rows[0]);
            return { columns, rows };
        } finally {
            await connection.end();
        }
    }

    if (connectionType === 'postgresql') {
        const pool = new Pool({
            host,
            port,
            user,
            password,
            database,
        });

        try {
            const result = await pool.query(sql);

            if (!result.rows || result.rows.length === 0) {
                return { columns: [], rows: [] };
            }

            const columns = result.fields.map(f => f.name);
            return { columns, rows: result.rows };
        } finally {
            await pool.end();
        }
    }

    throw new Error(`SQL execution not supported for: ${connectionType}`);
}

export async function POST(request: NextRequest) {
    try {
        const body: RequestBody = await request.json();

        const { question, connectionType, database } = body;

        if (!question || !connectionType || !database) {
            return NextResponse.json(
                { success: false, error: 'Missing required parameters' },
                { status: 400 }
            );
        }

        // Get database schema
        const schema = await getSchema(body);

        if (schema.length === 0) {
            return NextResponse.json(
                { success: false, error: 'No tables found in database' },
                { status: 400 }
            );
        }

        // Generate SQL from question
        const sqlResult = await textToSQL({
            question,
            schema,
            dbType: connectionType,
            dbName: database,
        });

        if (!sqlResult.success || !sqlResult.sql) {
            return NextResponse.json(
                { success: false, error: sqlResult.error || 'Failed to generate SQL' },
                { status: 500 }
            );
        }

        // Try to execute the SQL
        let queryResult: QueryResult;
        let finalSql = sqlResult.sql;

        try {
            queryResult = await executeQuery(body, finalSql);
        } catch (execError) {
            // If execution fails, try to refine the SQL
            const refinedResult = await refineSql({
                question,
                schema,
                dbType: connectionType,
                dbName: database,
                previousSql: finalSql,
                error: execError instanceof Error ? execError.message : String(execError),
            });

            if (!refinedResult.success || !refinedResult.sql) {
                return NextResponse.json({
                    success: false,
                    sql: finalSql,
                    error: `SQL execution failed: ${execError instanceof Error ? execError.message : String(execError)}`,
                });
            }

            // Try refined SQL
            finalSql = refinedResult.sql;
            try {
                queryResult = await executeQuery(body, finalSql);
            } catch (refinedExecError) {
                return NextResponse.json({
                    success: false,
                    sql: finalSql,
                    error: `Refined SQL also failed: ${refinedExecError instanceof Error ? refinedExecError.message : String(refinedExecError)}`,
                });
            }
        }

        return NextResponse.json({
            success: true,
            sql: finalSql,
            columns: queryResult.columns,
            rows: queryResult.rows,
            rowCount: queryResult.rows.length,
        });

    } catch (error) {
        console.error('Text-to-SQL error:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Internal server error'
            },
            { status: 500 }
        );
    }
}
