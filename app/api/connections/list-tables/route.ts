import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import { Client as PgClient } from 'pg';
import { MongoClient } from 'mongodb';
import { createClient } from 'redis';

export async function POST(request: NextRequest) {
    try {
        const { type, host, port, user, password, database, schema } = await request.json();

        console.log(`[DB] Listing tables for ${type} database: ${database}, schema: ${schema || 'N/A'}`);

        if (type === 'mysql') {
            const connection = await mysql.createConnection({
                host,
                port,
                user,
                password,
                database,
            });

            try {
                const [rows] = await connection.query('SHOW TABLES');
                await connection.end();
                const tables = (rows as any[]).map((row: any) => Object.values(row)[0]);
                return NextResponse.json({ success: true, tables });
            } catch (error: any) {
                await connection.end();
                throw error;
            }
        }

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
                const schemaFilter = schema || 'public';
                const result = await client.query(
                    "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = $1",
                    [schemaFilter]
                );
                await client.end();
                const tables = result.rows.map((row: any) => row.tablename);
                return NextResponse.json({ success: true, tables });
            } catch (error: any) {
                await client.end();
                throw error;
            }
        }

        if (type === 'mongodb') {
            // Construct URI based on whether authentication is provided
            let uri: string;
            if (user && password) {
                uri = `mongodb://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
            } else {
                uri = `mongodb://${host}:${port}/${database}`;
            }

            const client = new MongoClient(uri);

            try {
                await client.connect();
                const db = client.db(database);
                const collections = await db.listCollections().toArray();
                await client.close();
                const tables = collections.map((col: any) => col.name);
                return NextResponse.json({ success: true, tables });
            } catch (error: any) {
                try {
                    await client.close();
                } catch (closeError) {
                    // Ignore close errors
                }
                throw error;
            }
        }

        if (type === 'redis') {
            const client = createClient({
                socket: { host, port },
                password: password || undefined,
                database: database ? parseInt(database.replace('db', '')) : 0,
            });

            try {
                await client.connect();
                const keys = await client.keys('*');
                await client.quit();
                // Group keys by pattern prefix
                const uniquePrefixes = new Set<string>();
                keys.forEach(key => {
                    const prefix = key.split(':')[0];
                    uniquePrefixes.add(prefix + ':*');
                });
                return NextResponse.json({ success: true, tables: Array.from(uniquePrefixes) });
            } catch (error: any) {
                await client.quit();
                throw error;
            }
        }

        return NextResponse.json({ error: 'Unsupported database type' }, { status: 400 });
    } catch (error: any) {
        console.error('List tables error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to list tables' },
            { status: 500 }
        );
    }
}
