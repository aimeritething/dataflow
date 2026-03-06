import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import { Client } from 'pg';

interface DeleteDatabaseRequest {
    type: 'mysql' | 'postgres' | 'mongodb';
    host: string;
    port: string;
    user?: string;
    password?: string;
    databaseName: string;
}

export async function POST(request: NextRequest) {
    try {
        const params: DeleteDatabaseRequest = await request.json();

        console.log('🔵 [API] Received delete database request:', {
            database: params.databaseName,
            type: params.type
        });

        if (!params.type || !params.host || !params.port || !params.databaseName) {
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
            });

            try {
                const query = `DROP DATABASE IF EXISTS \`${params.databaseName}\``;
                console.log('🔍 [API] Executing query:', query);
                await connection.query(query);

                return NextResponse.json({ success: true, message: 'Database deleted successfully' });
            } finally {
                await connection.end();
            }
        } else if (params.type === 'postgres') {
            const client = new Client({
                host: params.host,
                port: parseInt(params.port),
                user: params.user,
                password: params.password,
                database: 'postgres',
            });

            await client.connect();

            try {
                const query = `DROP DATABASE IF EXISTS "${params.databaseName}"`;
                console.log('🔍 [API] Executing query:', query);
                await client.query(query);

                return NextResponse.json({ success: true, message: 'Database deleted successfully' });
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
                const auth = params.user && params.password
                    ? `${encodeURIComponent(params.user)}:${encodeURIComponent(params.password)}@`
                    : '';
                connectionString = `mongodb://${auth}${params.host}:${params.port}/${params.databaseName}?authSource=admin`;
            }

            console.log('🔵 [API] Connecting to MongoDB...');

            const client = new MongoClient(connectionString, {
                directConnection: true,
                serverSelectionTimeoutMS: 5000,
                connectTimeoutMS: 10000,
            });

            try {
                await client.connect();
                console.log('🔵 [API] Connected successfully');

                const db = client.db(params.databaseName);
                await db.dropDatabase();

                console.log(`🔵 [API] ✅ Database "${params.databaseName}" dropped successfully`);

                return NextResponse.json({
                    success: true,
                    message: `Database "${params.databaseName}" deleted successfully`
                });
            } finally {
                await client.close();
                console.log('🔵 [API] Connection closed');
            }
        } else {
            return NextResponse.json(
                { error: 'Delete database not supported for this type' },
                { status: 400 }
            );
        }
    } catch (error: any) {
        console.error('💥 [API] Delete database error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to delete database' },
            { status: 500 }
        );
    }
}
