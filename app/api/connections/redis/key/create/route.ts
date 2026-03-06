import { NextRequest, NextResponse } from 'next/server';

interface CreateRedisKeyRequest {
    host: string;
    port: string;
    password?: string;
    database: string;
    key: string;
    type: 'string' | 'hash' | 'list' | 'set' | 'zset';
    value: any;
    ttl?: number;
}

export async function POST(request: NextRequest) {
    try {
        const params: CreateRedisKeyRequest = await request.json();

        if (!params.host || !params.port || !params.key || !params.type) {
            return NextResponse.json(
                { error: 'Missing required parameters' },
                { status: 400 }
            );
        }

        const { createClient } = require('redis');

        // Parse database number from "db0", "db1", etc.
        const dbNumber = params.database ? parseInt(params.database.replace('db', ''), 10) : 0;

        // Build Redis URL with database number
        const redisUrl = params.password
            ? `redis://:${encodeURIComponent(params.password)}@${params.host}:${params.port}/${dbNumber}`
            : `redis://${params.host}:${params.port}/${dbNumber}`;

        const client = createClient({
            url: redisUrl,
            socket: { connectTimeout: 10000 }
        });

        let isConnected = false;
        try {
            await client.connect();
            isConnected = true;

            // Check if key already exists
            const exists = await client.exists(params.key);
            if (exists) {
                return NextResponse.json(
                    { success: false, error: `Key "${params.key}" already exists` },
                    { status: 400 }
                );
            }

            // Create key based on type
            switch (params.type) {
                case 'string':
                    await client.set(params.key, params.value || '');
                    break;
                case 'hash':
                    if (typeof params.value === 'object' && Object.keys(params.value).length > 0) {
                        await client.hSet(params.key, params.value);
                    } else {
                        return NextResponse.json(
                            { success: false, error: 'Hash requires at least one field' },
                            { status: 400 }
                        );
                    }
                    break;
                case 'list':
                    if (Array.isArray(params.value) && params.value.length > 0) {
                        await client.rPush(params.key, params.value);
                    } else {
                        return NextResponse.json(
                            { success: false, error: 'List requires at least one item' },
                            { status: 400 }
                        );
                    }
                    break;
                case 'set':
                    if (Array.isArray(params.value) && params.value.length > 0) {
                        await client.sAdd(params.key, params.value);
                    } else {
                        return NextResponse.json(
                            { success: false, error: 'Set requires at least one member' },
                            { status: 400 }
                        );
                    }
                    break;
                case 'zset':
                    if (Array.isArray(params.value) && params.value.length > 0) {
                        // zset value format: [{ score: number, value: string }, ...]
                        const members = params.value.map((item: { score: number; value: string }) => ({
                            score: item.score,
                            value: item.value
                        }));
                        await client.zAdd(params.key, members);
                    } else {
                        return NextResponse.json(
                            { success: false, error: 'Sorted set requires at least one member' },
                            { status: 400 }
                        );
                    }
                    break;
                default:
                    return NextResponse.json(
                        { success: false, error: `Unsupported type: ${params.type}` },
                        { status: 400 }
                    );
            }

            // Set TTL if provided and positive
            if (params.ttl && params.ttl > 0) {
                await client.expire(params.key, params.ttl);
            }

            console.log(`[Redis] Created key: ${params.key} (type: ${params.type})`);

            return NextResponse.json({ success: true, message: 'Key created successfully' });

        } finally {
            if (isConnected) {
                try {
                    await client.disconnect();
                } catch (e) {
                    // Ignore disconnect errors
                }
            }
        }

    } catch (error: any) {
        console.error('Create Redis key error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Failed to create key' },
            { status: 500 }
        );
    }
}
