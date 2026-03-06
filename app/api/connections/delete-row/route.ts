import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import { Client } from 'pg';

interface DeleteRowRequest {
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
}

export async function POST(request: NextRequest) {
    try {
        const params: DeleteRowRequest = await request.json();

        console.log('[delete-row] 🗑️ Delete request:', {
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

        if (params.type === 'mysql') {
            const connection = await mysql.createConnection({
                host: params.host,
                port: parseInt(params.port),
                user: params.user,
                password: params.password,
                database: params.database,
            });

            try {
                const query = `DELETE FROM \`${params.table}\` WHERE \`${params.primaryKey}\` = ?`;

                console.log('[delete-row] 🔍 MySQL query:', query);
                console.log('[delete-row] 📊 Value:', params.primaryKeyValue);

                const [result] = await connection.execute(query, [params.primaryKeyValue]);

                console.log('[delete-row] ✅ MySQL delete successful:', result);

                return NextResponse.json({
                    success: true,
                    message: 'Row deleted successfully',
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
                const query = `DELETE FROM ${tableName} WHERE "${params.primaryKey}" = $1`;

                console.log('[delete-row] 🔍 PostgreSQL query:', query);
                console.log('[delete-row] 📊 Value:', params.primaryKeyValue);

                const result = await client.query(query, [params.primaryKeyValue]);

                console.log('[delete-row] ✅ PostgreSQL delete successful:', result);

                return NextResponse.json({
                    success: true,
                    message: 'Row deleted successfully',
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
        console.error('[delete-row] ❌ Error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to delete row' },
            { status: 500 }
        );
    }
}
