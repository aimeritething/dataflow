import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import { Client } from 'pg';

interface FetchTablesRequest {
    type: 'mysql' | 'postgres' | 'mongodb' | 'redis';
    host: string;
    port: string;
    user: string;
    password: string;
    database: string;
    schema?: string; // For PostgreSQL
}

export async function POST(request: NextRequest) {
    try {
        const params: FetchTablesRequest = await request.json();

        if (!params.type || !params.host || !params.port || !params.user || !params.database) {
            return NextResponse.json(
                { error: 'Missing required connection parameters' },
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
                const [rows] = await connection.query('SHOW TABLES');
                const tableKey = `Tables_in_${params.database}`;
                const tables = (rows as any[]).map(row => row[tableKey]);
                return NextResponse.json({ success: true, tables });
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
                const result = await client.query(
                    `SELECT tablename 
                     FROM pg_tables 
                     WHERE schemaname = $1
                     ORDER BY tablename`,
                    [schema]
                );
                const tables = result.rows.map(row => row.tablename);
                return NextResponse.json({ success: true, tables });
            } finally {
                await client.end();
            }
        } else if (params.type === 'mongodb') {
            console.log('[fetch-tables] 📦 MongoDB request:', {
                host: params.host,
                port: params.port,
                database: params.database,
                user: params.user
            });

            const { MongoClient } = require('mongodb');

            // Construct connection string
            let connectionString = '';
            if (params.host.startsWith('mongodb')) {
                connectionString = params.host;
            } else {
                const auth = params.user && params.password ? `${encodeURIComponent(params.user)}:${encodeURIComponent(params.password)}@` : '';
                connectionString = `mongodb://${auth}${params.host}:${params.port}/${params.database}?authSource=admin`;
            }

            console.log('[fetch-tables] 🔗 Connection string:', connectionString.replace(/:([^:@]+)@/, ':***@'));

            const client = new MongoClient(connectionString, {
                directConnection: true,
                serverSelectionTimeoutMS: 5000,
                connectTimeoutMS: 10000,
            });

            try {
                console.log('[fetch-tables] 🔌 Connecting to MongoDB...');
                await client.connect();
                console.log('[fetch-tables] ✅ Connected successfully');

                const db = client.db(params.database);
                console.log('[fetch-tables] 📋 Fetching collections from database:', params.database);

                const collections = await db.listCollections().toArray();
                const tables = collections.map((col: any) => col.name);

                console.log('[fetch-tables] ✅ Collections fetched:', tables);
                console.log('[fetch-tables] 📊 Total collections:', tables.length);

                return NextResponse.json({ success: true, tables });
            } catch (error: any) {
                console.error('[fetch-tables] ❌ MongoDB error:', error.message);
                throw error;
            } finally {
                await client.close();
                console.log('[fetch-tables] 🔌 Connection closed');
            }
        } else if (params.type === 'redis') {
            // Redis uses keys, not tables
            // Return empty array for now since keys are dynamic
            return NextResponse.json({ success: true, tables: [] });
        } else {
            return NextResponse.json(
                { error: 'Unsupported database type' },
                { status: 400 }
            );
        }
    } catch (error: any) {
        console.error('Fetch tables error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch tables' },
            { status: 500 }
        );
    }
}
