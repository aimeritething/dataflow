import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'pg';

interface FetchSchemasRequest {
    type: 'postgres';
    host: string;
    port: string;
    user: string;
    password: string;
    database: string;
}

export async function POST(request: NextRequest) {
    try {
        const params: FetchSchemasRequest = await request.json();

        if (!params.type || !params.host || !params.port || !params.user || !params.database) {
            return NextResponse.json(
                { error: 'Missing required connection parameters' },
                { status: 400 }
            );
        }

        if (params.type === 'postgres') {
            const client = new Client({
                host: params.host,
                port: parseInt(params.port),
                user: params.user,
                password: params.password,
                database: params.database,
            });

            await client.connect();

            try {
                const result = await client.query(
                    `SELECT schema_name 
                     FROM information_schema.schemata 
                     WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                     ORDER BY schema_name`
                );
                const schemas = result.rows.map(row => row.schema_name);
                return NextResponse.json({ success: true, schemas });
            } finally {
                await client.end();
            }
        } else {
            return NextResponse.json(
                { error: 'Schemas are only supported for PostgreSQL' },
                { status: 400 }
            );
        }
    } catch (error: any) {
        console.error('Fetch schemas error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch schemas' },
            { status: 500 }
        );
    }
}
