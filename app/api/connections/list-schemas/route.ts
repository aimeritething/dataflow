import { NextRequest, NextResponse } from 'next/server';
import { Client as PgClient } from 'pg';

export async function POST(request: NextRequest) {
    try {
        const { type, host, port, user, password, database } = await request.json();

        console.log(`[DB] Listing schemas for ${type} database: ${database}`);

        if (type === 'postgres' || type === 'postgresql') {
            const client = new PgClient({
                host,
                port,
                user,
                password,
                database,
            });

            try {
                await client.connect();
                const result = await client.query(
                    "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')"
                );
                await client.end();
                const schemas = result.rows.map((row: any) => row.schema_name);
                return NextResponse.json({ success: true, schemas });
            } catch (error: any) {
                await client.end();
                throw error;
            }
        }

        // Other database types don't have schemas
        return NextResponse.json({ success: true, schemas: [] });
    } catch (error: any) {
        console.error('List schemas error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to list schemas' },
            { status: 500 }
        );
    }
}
