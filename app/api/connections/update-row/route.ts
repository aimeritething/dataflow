import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import { Client } from 'pg';

interface UpdateRowRequest {
    type: 'mysql' | 'postgres';
    host: string;
    port: string;
    user: string;
    password: string;
    database: string;
    schema?: string; // For PostgreSQL
    table: string;
    primaryKey: string; // Primary key column name
    primaryKeyValue: any; // Primary key value to identify the row
    updates: Record<string, any>; // Column name -> new value
}

export async function POST(request: NextRequest) {
    try {
        const params: UpdateRowRequest = await request.json();

        console.log('[update-row] 📝 Update request:', {
            type: params.type,
            database: params.database,
            table: params.table,
            primaryKey: params.primaryKey,
            primaryKeyValue: params.primaryKeyValue
        });

        if (!params.type || !params.host || !params.port || !params.user || !params.database || !params.table) {
            return NextResponse.json(
                { error: 'Missing required connection parameters' },
                { status: 400 }
            );
        }

        if (!params.primaryKey || params.primaryKeyValue === undefined) {
            return NextResponse.json(
                { error: 'Primary key and value are required' },
                { status: 400 }
            );
        }

        if (!params.updates || Object.keys(params.updates).length === 0) {
            return NextResponse.json(
                { error: 'No updates provided' },
                { status: 400 }
            );
        }

        if (params.type === 'mysql') {
            const connection = await mysql.createConnection({
                host: params.host,
                port: parseInt(params.port),
                user: params.user,
                password: params.password,
                database: params.database,
            });

            try {
                // Build UPDATE query
                const setClauses = Object.keys(params.updates).map(col => `\`${col}\` = ?`);
                const values = Object.values(params.updates);
                values.push(params.primaryKeyValue);

                const query = `UPDATE \`${params.table}\` SET ${setClauses.join(', ')} WHERE \`${params.primaryKey}\` = ?`;

                console.log('[update-row] 🔍 MySQL query:', query);
                console.log('[update-row] 📊 Values:', values);

                const [result] = await connection.execute(query, values);

                console.log('[update-row] ✅ MySQL update successful:', result);

                return NextResponse.json({
                    success: true,
                    message: 'Row updated successfully',
                    affectedRows: (result as any).affectedRows
                });
            } finally {
                await connection.end();
            }
        } else if (params.type === 'postgres') {
            const client = new Client({
                host: params.host,
                port: parseInt(params.port),
                user: params.user,
                password: params.password,
                database: params.database,
            });

            await client.connect();

            try {
                const schema = params.schema || 'public';
                const tableName = `"${schema}"."${params.table}"`;

                // Build UPDATE query with parameterized values
                const setClauses = Object.keys(params.updates).map((col, idx) => `"${col}" = $${idx + 1}`);
                const values = Object.values(params.updates);
                values.push(params.primaryKeyValue);

                const query = `UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE "${params.primaryKey}" = $${values.length}`;

                console.log('[update-row] 🔍 PostgreSQL query:', query);
                console.log('[update-row] 📊 Values:', values);

                const result = await client.query(query, values);

                console.log('[update-row] ✅ PostgreSQL update successful:', result);

                return NextResponse.json({
                    success: true,
                    message: 'Row updated successfully',
                    rowCount: result.rowCount
                });
            } finally {
                await client.end();
            }
        } else {
            return NextResponse.json(
                { error: 'Unsupported database type' },
                { status: 400 }
            );
        }
    } catch (error: any) {
        console.error('[update-row] ❌ Error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to update row' },
            { status: 500 }
        );
    }
}
