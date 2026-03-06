import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import { Client } from 'pg';

interface FetchDatabasesRequest {
    type: 'mysql' | 'postgres' | 'mongodb' | 'redis';
    host: string;
    port: string;
    user: string;
    password: string;
}

export async function POST(request: NextRequest) {
    try {
        const params: FetchDatabasesRequest = await request.json();

        if (!params.type || !params.host || !params.port) {
            return NextResponse.json(
                { error: 'Missing required connection parameters' },
                { status: 400 }
            );
        }

        // MySQL and PostgreSQL require user, Redis and MongoDB may not
        if ((params.type === 'mysql' || params.type === 'postgres') && !params.user) {
            return NextResponse.json(
                { error: 'Missing required user parameter' },
                { status: 400 }
            );
        }

        if (params.type === 'mysql') {
            const connection = await mysql.createConnection({
                host: params.host,
                port: parseInt(params.port),
                user: params.user,
                password: params.password,
            });

            try {
                const [rows] = await connection.query('SHOW DATABASES');
                const databases = (rows as any[]).map(row => row.Database);
                return NextResponse.json({ success: true, databases });
            } finally {
                await connection.end();
            }
        } else if (params.type === 'postgres') {
            const client = new Client({
                host: params.host,
                port: parseInt(params.port),
                user: params.user,
                password: params.password,
                database: 'postgres', // Connect to default database
            });

            await client.connect();

            try {
                const result = await client.query(
                    `SELECT datname FROM pg_database WHERE datistemplate = false`
                );
                const databases = result.rows.map(row => row.datname);
                return NextResponse.json({ success: true, databases });
            } finally {
                await client.end();
            }
        } else if (params.type === 'mongodb') {
            const { MongoClient } = require('mongodb');

            // Construct connection string
            let connectionString = '';
            if (params.host.startsWith('mongodb')) {
                connectionString = params.host;
            } else {
                const auth = params.user && params.password ? `${encodeURIComponent(params.user)}:${encodeURIComponent(params.password)}@` : '';
                connectionString = `mongodb://${auth}${params.host}:${params.port}/?authSource=admin`;
            }

            const client = new MongoClient(connectionString, {
                directConnection: true,
                serverSelectionTimeoutMS: 5000,
                connectTimeoutMS: 10000,
            });

            try {
                await client.connect();
                const adminDb = client.db('admin');
                const result = await adminDb.admin().listDatabases();
                const databases = result.databases.map((db: any) => db.name);
                return NextResponse.json({ success: true, databases });
            } finally {
                await client.close();
            }
        } else if (params.type === 'redis') {
            // Real Redis implementation
            const { createClient } = require('redis');

            // Build Redis URL
            const redisUrl = params.password
                ? `redis://:${encodeURIComponent(params.password)}@${params.host}:${params.port}`
                : `redis://${params.host}:${params.port}`;

            const client = createClient({
                url: redisUrl,
                socket: {
                    connectTimeout: 5000,
                }
            });

            let isConnected = false;
            try {
                await client.connect();
                isConnected = true;

                // Try to get the number of databases from config
                let dbCount = 16; // Default Redis database count
                try {
                    const configResult = await client.configGet('databases');
                    if (configResult && configResult.databases) {
                        dbCount = parseInt(configResult.databases, 10);
                    }
                } catch (configError) {
                    // Some Redis instances don't allow CONFIG command, use default
                    console.log('[Redis] Could not get database count from config, using default 16');
                }

                // Generate database list
                const databases = Array.from({ length: dbCount }, (_, i) => `db${i}`);

                return NextResponse.json({ success: true, databases });
            } catch (connectionError: any) {
                // If connection fails, return default database list
                console.error('[Redis] Connection failed, returning default list:', connectionError.message);
                const databases = Array.from({ length: 16 }, (_, i) => `db${i}`);
                return NextResponse.json({ success: true, databases, note: 'Using default list (connection failed)' });
            } finally {
                if (isConnected) {
                    try {
                        await client.disconnect();
                    } catch (e) {
                        // Ignore disconnect errors
                    }
                }
            }
        } else {
            return NextResponse.json(
                { error: 'Unsupported database type' },
                { status: 400 }
            );
        }
    } catch (error: any) {
        console.error('Fetch databases error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch databases' },
            { status: 500 }
        );
    }
}
