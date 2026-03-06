import { NextRequest, NextResponse } from 'next/server';

interface UpdateRedisKeyRequest {
    host: string;
    port: string;
    password?: string;
    database: string;
    originalKey?: string; // Original key name for rename support
    key: string;
    type?: string; // New type (for type change)
    value: any;
    ttl?: number;
}

export async function POST(request: NextRequest) {
    try {
        const params: UpdateRedisKeyRequest = await request.json();

        if (!params.host || !params.port || !params.key) {
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

            // Use originalKey if provided (for rename), otherwise use key
            const sourceKey = params.originalKey || params.key;
            const targetKey = params.key;
            const isRenaming = sourceKey !== targetKey;

            // Check if source key exists
            const exists = await client.exists(sourceKey);
            if (!exists) {
                return NextResponse.json(
                    { success: false, error: `Key "${sourceKey}" does not exist` },
                    { status: 404 }
                );
            }

            // Get current key type
            const currentType = await client.type(sourceKey);
            const newType = params.type || currentType;

            // If renaming or changing type, delete old key and create new
            if (isRenaming || newType !== currentType) {
                // Delete the old key
                await client.del(sourceKey);

                // Create new key with new name/type
                switch (newType) {
                    case 'string':
                        await client.set(targetKey, params.value || '');
                        break;
                    case 'hash':
                        if (typeof params.value === 'object' && Object.keys(params.value).length > 0) {
                            await client.hSet(targetKey, params.value);
                        }
                        break;
                    case 'list':
                        if (Array.isArray(params.value) && params.value.length > 0) {
                            await client.rPush(targetKey, params.value);
                        }
                        break;
                    case 'set':
                        if (Array.isArray(params.value) && params.value.length > 0) {
                            await client.sAdd(targetKey, params.value);
                        }
                        break;
                    case 'zset':
                        if (Array.isArray(params.value) && params.value.length > 0) {
                            const members = params.value.map((item: { score: number; value: string }) => ({
                                score: item.score,
                                value: item.value
                            }));
                            await client.zAdd(targetKey, members);
                        }
                        break;
                    default:
                        return NextResponse.json(
                            { success: false, error: `Unsupported type: ${newType}` },
                            { status: 400 }
                        );
                }
            } else {
                // Same key, same type - just update value
                switch (currentType) {
                    case 'string':
                        await client.set(targetKey, params.value || '');
                        break;
                    case 'hash':
                        await client.del(targetKey);
                        if (typeof params.value === 'object' && Object.keys(params.value).length > 0) {
                            await client.hSet(targetKey, params.value);
                        }
                        break;
                    case 'list':
                        await client.del(targetKey);
                        if (Array.isArray(params.value) && params.value.length > 0) {
                            await client.rPush(targetKey, params.value);
                        }
                        break;
                    case 'set':
                        await client.del(targetKey);
                        if (Array.isArray(params.value) && params.value.length > 0) {
                            await client.sAdd(targetKey, params.value);
                        }
                        break;
                    case 'zset':
                        await client.del(targetKey);
                        if (Array.isArray(params.value) && params.value.length > 0) {
                            const members = params.value.map((item: { score: number; value: string }) => ({
                                score: item.score,
                                value: item.value
                            }));
                            await client.zAdd(targetKey, members);
                        }
                        break;
                    default:
                        return NextResponse.json(
                            { success: false, error: `Unsupported type: ${currentType}` },
                            { status: 400 }
                        );
                }
            }

            // Update TTL on the target key
            if (params.ttl !== undefined) {
                if (params.ttl > 0) {
                    await client.expire(targetKey, params.ttl);
                } else if (params.ttl === -1) {
                    // Remove TTL (persist key)
                    await client.persist(targetKey);
                }
            }

            const action = isRenaming ? 'renamed and updated' : 'updated';
            console.log(`[Redis] Key ${action}: ${sourceKey} -> ${targetKey}`);

            return NextResponse.json({ success: true, message: `Key ${action} successfully` });

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
        console.error('Update Redis key error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Failed to update key' },
            { status: 500 }
        );
    }
}
