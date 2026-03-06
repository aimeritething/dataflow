import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import { Client } from 'pg';
import { MongoClient } from 'mongodb';

interface CreateDatabaseRequest {
    type: 'mysql' | 'postgres' | 'mongodb' | 'redis';
    host: string;
    port: string;
    user: string;
    password: string;
    databaseName: string;
    charset?: string;
    collation?: string;
}

export async function POST(request: NextRequest) {
    try {
        const params: CreateDatabaseRequest = await request.json();

        if (!params.type || !params.host || !params.port || !params.databaseName) {
            return NextResponse.json(
                { error: 'Missing required connection parameters' },
                { status: 400 }
            );
        }

        // Allow alphanumeric, underscores, and hyphens in database names
        const validDbNameRegex = /^[a-zA-Z0-9_-]+$/;

        if (params.type === 'mysql') {
            const connection = await mysql.createConnection({
                host: params.host,
                port: parseInt(params.port),
                user: params.user,
                password: params.password,
                connectTimeout: 30000, // 30 seconds connection timeout
                // Increase wait timeout for slow networks
                multipleStatements: false,
            });

            try {
                // Validate database name (allow hyphens)
                if (!validDbNameRegex.test(params.databaseName)) {
                    throw new Error('Invalid database name. Only alphanumeric, underscores, and hyphens are allowed.');
                }

                const charset = params.charset || 'utf8mb4';
                const collation = params.collation || 'utf8mb4_general_ci';

                // Use backticks to quote database name (required for names with hyphens)
                await connection.query(
                    `CREATE DATABASE \`${params.databaseName}\` CHARACTER SET ${charset} COLLATE ${collation}`
                );

                return NextResponse.json({ success: true, message: 'Database created successfully' });
            } finally {
                await connection.end();
            }
        } else if (params.type === 'postgres') {
            const client = new Client({
                host: params.host,
                port: parseInt(params.port),
                user: params.user,
                password: params.password,
                database: 'postgres', // Connect to default 'postgres' db to create new db
                connectionTimeoutMillis: 30000, // 30 seconds timeout
            });

            await client.connect();

            try {
                // Validate database name (allow hyphens)
                if (!validDbNameRegex.test(params.databaseName)) {
                    throw new Error('Invalid database name. Only alphanumeric, underscores, and hyphens are allowed.');
                }

                // Use double quotes to quote database name (required for names with hyphens)
                await client.query(`CREATE DATABASE "${params.databaseName}"`);

                return NextResponse.json({ success: true, message: 'Database created successfully' });
            } finally {
                await client.end();
            }
        } else if (params.type === 'mongodb') {
            // MongoDB creates database implicitly when you insert data
            // But we can create a placeholder collection to ensure the database exists
            const uri = `mongodb://${params.user}:${encodeURIComponent(params.password)}@${params.host}:${params.port}/?authSource=admin`;
            const client = new MongoClient(uri);

            try {
                await client.connect();

                // Validate database name
                if (!validDbNameRegex.test(params.databaseName)) {
                    throw new Error('Invalid database name. Only alphanumeric, underscores, and hyphens are allowed.');
                }

                // Create a placeholder collection to instantiate the database
                const db = client.db(params.databaseName);
                await db.createCollection('_placeholder');

                return NextResponse.json({ success: true, message: 'Database created successfully' });
            } finally {
                await client.close();
            }
        } else {
            return NextResponse.json(
                { error: 'Database creation not supported for this type' },
                { status: 400 }
            );
        }
    } catch (error: any) {
        console.error('Create database error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to create database' },
            { status: 500 }
        );
    }
}
