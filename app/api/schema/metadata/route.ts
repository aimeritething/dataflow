import { NextRequest, NextResponse } from 'next/server';
import { Pool as PgPool } from 'pg';
import mysql from 'mysql2/promise';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const connectionId = searchParams.get('connectionId');
        const database = searchParams.get('database');
        const schema = searchParams.get('schema');
        const connectionStr = searchParams.get('connection');

        if (!connectionId) {
            return NextResponse.json(
                { success: false, error: 'Missing connectionId parameter' },
                { status: 400 }
            );
        }

        // Parse connection from query params or use stored connection
        // For now, we need the connection details to be passed
        // In production, fetch from secure storage by connectionId

        // Try to get connection info from the request body or fallback to mock
        const connectionInfo = connectionStr ? JSON.parse(connectionStr) : null;

        if (!connectionInfo) {
            // Return empty tables if no connection info
            return NextResponse.json({ tables: [] });
        }

        let tables: any[] = [];

        if (connectionInfo.type === 'POSTGRES') {
            const pool = new PgPool({
                host: connectionInfo.host,
                port: parseInt(connectionInfo.port),
                database: database || connectionInfo.database,
                user: connectionInfo.user,
                password: connectionInfo.password,
                max: 5,
                idleTimeoutMillis: 10000,
                connectionTimeoutMillis: 5000,
            });

            try {
                // Get tables for the specified schema, or all non-system schemas
                const schemaFilter = schema
                    ? `AND table_schema = '${schema}'`
                    : `AND table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_toast')`;

                const tableResult = await pool.query(`
                    SELECT table_schema, table_name 
                    FROM information_schema.tables 
                    WHERE table_type = 'BASE TABLE' ${schemaFilter}
                    ORDER BY table_schema, table_name
                    LIMIT 50
                `);

                tables = tableResult.rows.map(row => ({
                    name: row.table_name,
                    schema: row.table_schema,
                }));
            } finally {
                await pool.end();
            }
        } else if (connectionInfo.type === 'MYSQL') {
            const connection = await mysql.createConnection({
                host: connectionInfo.host,
                port: parseInt(connectionInfo.port),
                user: connectionInfo.user,
                password: connectionInfo.password,
                database: database || connectionInfo.database,
            });

            try {
                const [rows] = await connection.execute(`
                    SELECT table_name 
                    FROM information_schema.tables 
                    WHERE table_schema = ? AND table_type = 'BASE TABLE'
                    ORDER BY table_name
                    LIMIT 50
                `, [database || connectionInfo.database]);

                tables = (rows as any[]).map(row => ({
                    name: row.table_name || row.TABLE_NAME,
                }));
            } finally {
                await connection.end();
            }
        }

        return NextResponse.json({ tables });
    } catch (error: any) {
        console.error('Schema metadata error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Internal server error', tables: [] },
            { status: 500 }
        );
    }
}

