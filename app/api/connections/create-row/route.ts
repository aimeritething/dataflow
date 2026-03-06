import { NextRequest, NextResponse } from 'next/server';

interface CreateRowRequest {
    type: 'mysql' | 'postgresql';
    host: string;
    port: string;
    user?: string;
    password?: string;
    database: string;
    schema?: string;
    table: string;
    rowData: Record<string, any>;
}

export async function POST(request: NextRequest) {
    try {
        const params: CreateRowRequest = await request.json();

        console.log('🔵 [API] Received create row request:', {
            database: params.database,
            schema: params.schema || '(none - will use default)',
            table: params.table,
            type: params.type,
            rowData: params.rowData
        });

        // Detailed parameter validation
        const missingParams: string[] = [];
        if (!params.type) missingParams.push('type');
        if (!params.host) missingParams.push('host');
        if (!params.port) missingParams.push('port');
        if (!params.database) missingParams.push('database');
        if (!params.table) missingParams.push('table');
        if (!params.rowData) missingParams.push('rowData');

        if (missingParams.length > 0) {
            const errorMsg = `Missing required parameters: ${missingParams.join(', ')}`;
            console.error('🔵 [API] ❌ Validation error:', errorMsg);
            return NextResponse.json(
                { error: errorMsg },
                { status: 400 }
            );
        }

        if (params.type === 'mysql') {
            const mysql = require('mysql2/promise');

            const connection = await mysql.createConnection({
                host: params.host,
                port: parseInt(params.port),
                user: params.user || 'root',
                password: params.password || '',
                database: params.database,
            });

            try {
                console.log('🔵 [API] Connected to MySQL');

                // Build INSERT query
                const columns = Object.keys(params.rowData);
                const values = Object.values(params.rowData);
                const placeholders = columns.map(() => '?').join(', ');

                const query = `INSERT INTO \`${params.table}\` (${columns.map(c => `\`${c}\``).join(', ')}) VALUES (${placeholders})`;

                console.log('🔵 [API] Executing query:', query);
                console.log('🔵 [API] With values:', values);

                const [result] = await connection.execute(query, values);

                console.log('🔵 [API] ✅ Row inserted successfully:', result);

                return NextResponse.json({
                    success: true,
                    insertId: (result as any).insertId
                });
            } catch (error: any) {
                console.error('🔵 [API] ❌ MySQL error:', error.message);
                return NextResponse.json(
                    { success: false, error: error.message },
                    { status: 500 }
                );
            } finally {
                await connection.end();
                console.log('🔵 [API] Connection closed');
            }
        } else if (params.type === 'postgresql' || params.type === 'postgres') {
            const { Client } = require('pg');

            const client = new Client({
                host: params.host,
                port: parseInt(params.port),
                user: params.user || 'postgres',
                password: params.password || '',
                database: params.database,
            });

            try {
                await client.connect();
                console.log('🔵 [API] Connected to PostgreSQL');

                // Build INSERT query
                const columns = Object.keys(params.rowData);
                const values = Object.values(params.rowData);
                const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');

                const tableName = params.schema ? `"${params.schema}"."${params.table}"` : `"${params.table}"`;
                const query = `INSERT INTO ${tableName} (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders}) RETURNING *`;

                console.log('🔵 [API] Executing query:', query);
                console.log('🔵 [API] With values:', values);

                const result = await client.query(query, values);

                console.log('🔵 [API] ✅ Row inserted successfully');

                return NextResponse.json({
                    success: true,
                    insertedRow: result.rows[0]
                });
            } catch (error: any) {
                console.error('🔵 [API] ❌ PostgreSQL error:', error.message);
                return NextResponse.json(
                    { success: false, error: error.message },
                    { status: 500 }
                );
            } finally {
                await client.end();
                console.log('🔵 [API] Connection closed');
            }
        }

        return NextResponse.json(
            { error: 'Unsupported database type' },
            { status: 400 }
        );
    } catch (error: any) {
        console.error('🔵 [API] ❌ Error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
