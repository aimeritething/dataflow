import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import { Client as PgClient } from 'pg';
import { MongoClient } from 'mongodb';
import { createClient } from 'redis';

export async function POST(request: NextRequest) {
    try {
        const { type, host, port, user, password, database } = await request.json();

        console.log(`[DB] Listing databases for ${type} at ${host}:${port}`);

        if (type === 'mysql') {
            const connection = await mysql.createConnection({
                host,
                port,
                user,
                password,
            });

            try {
                const [rows] = await connection.query('SHOW DATABASES');
                await connection.end();
                // @ts-ignore
                const databases = rows.map((row: any) => row.Database);
                return NextResponse.json({ success: true, databases });
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
                database: 'postgres', // Connect to default database
            });

            try {
                await client.connect();
                const result = await client.query(
                    "SELECT datname FROM pg_database WHERE datistemplate = false AND datname NOT IN ('postgres')"
                );
                await client.end();
                const databases = result.rows.map((row: any) => row.datname);
                return NextResponse.json({ success: true, databases });
            } catch (error: any) {
                await client.end();
                throw error;
            }
        }

        if (type === 'mongodb') {
            // Construct URI based on whether authentication is provided
            let uri: string;
            if (user && password) {
                uri = `mongodb://${user}:${encodeURIComponent(password)}@${host}:${port}/`;
            } else {
                uri = `mongodb://${host}:${port}/`;
            }

            const client = new MongoClient(uri);

            try {
                await client.connect();
                const adminDb = client.db('admin');
                const result = await adminDb.admin().listDatabases();
                await client.close();
                const databases = result.databases.map((db: any) => db.name);
                return NextResponse.json({ success: true, databases });
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
            });

            try {
                await client.connect();
                // Redis typically has 16 databases by default (0-15)
                await client.quit();
                const dbCount = 16;
                const databases = Array.from({ length: dbCount }, (_, i) => `db${i}`);
                return NextResponse.json({ success: true, databases });
            } catch (error: any) {
                await client.quit();
                throw error;
            }
        }

        return NextResponse.json({ error: 'Unsupported database type' }, { status: 400 });
    } catch (error: any) {
        console.error('List databases error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to list databases' },
            { status: 500 }
        );
    }
}
