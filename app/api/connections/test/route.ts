import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import { Client } from 'pg';

interface TestConnectionRequest {
    type: 'mysql' | 'postgres' | 'mongodb' | 'redis';
    host: string;
    port: string;
    user: string;
    password: string;
    database: string;
}

export async function POST(request: NextRequest) {
    const startTime = Date.now();

    try {
        const params: TestConnectionRequest = await request.json();

        // Validate required fields
        if (!params.type || !params.host || !params.port) {
            return NextResponse.json(
                { error: 'Missing required connection parameters' },
                { status: 400 }
            );
        }

        console.log('[Test Connection] Testing:', {
            type: params.type,
            host: params.host,
            port: params.port,
        });

        if (params.type === 'mysql') {
            const connection = await mysql.createConnection({
                host: params.host,
                port: parseInt(params.port),
                user: params.user,
                password: params.password,
                database: params.database || undefined,
                connectTimeout: 10000,
            });

            await connection.ping();
            await connection.end();

            const latency = Date.now() - startTime;
            return NextResponse.json({
                success: true,
                message: 'MySQL connection successful',
                latency: `${latency}ms`,
            });

        } else if (params.type === 'postgres') {
            const client = new Client({
                host: params.host,
                port: parseInt(params.port),
                user: params.user,
                password: params.password,
                database: params.database || 'postgres',
                connectionTimeoutMillis: 10000,
            });

            await client.connect();
            await client.query('SELECT 1');
            await client.end();

            const latency = Date.now() - startTime;
            return NextResponse.json({
                success: true,
                message: 'PostgreSQL connection successful',
                latency: `${latency}ms`,
            });

        } else if (params.type === 'mongodb') {
            const { MongoClient } = require('mongodb');

            let connectionString = '';
            if (params.host.startsWith('mongodb')) {
                connectionString = params.host;
            } else {
                const auth = params.user && params.password
                    ? `${encodeURIComponent(params.user)}:${encodeURIComponent(params.password)}@`
                    : '';
                connectionString = `mongodb://${auth}${params.host}:${params.port}/?authSource=admin`;
            }

            const client = new MongoClient(connectionString, {
                directConnection: true,
                serverSelectionTimeoutMS: 5000,
                connectTimeoutMS: 10000,
            });

            await client.connect();
            await client.db('admin').admin().ping();
            await client.close();

            const latency = Date.now() - startTime;
            return NextResponse.json({
                success: true,
                message: 'MongoDB connection successful',
                latency: `${latency}ms`,
            });

        } else if (params.type === 'redis') {
            const { createClient } = require('redis');

            // Build Redis URL
            const redisUrl = params.password
                ? `redis://:${encodeURIComponent(params.password)}@${params.host}:${params.port}`
                : `redis://${params.host}:${params.port}`;

            const client = createClient({
                url: redisUrl,
                socket: {
                    connectTimeout: 10000,
                }
            });

            await client.connect();
            const pong = await client.ping();
            await client.disconnect();

            if (pong !== 'PONG') {
                throw new Error('Redis PING did not return PONG');
            }

            const latency = Date.now() - startTime;
            return NextResponse.json({
                success: true,
                message: 'Redis connection successful',
                latency: `${latency}ms`,
            });

        } else {
            return NextResponse.json(
                { error: `Unsupported database type: ${params.type}` },
                { status: 400 }
            );
        }

    } catch (error: any) {
        console.error('[Test Connection] Error:', error);
        return NextResponse.json(
            {
                success: false,
                error: error.message || 'Failed to connect to database'
            },
            { status: 400 }
        );
    }
}
