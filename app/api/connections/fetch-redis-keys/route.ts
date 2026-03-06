import { NextRequest, NextResponse } from 'next/server';

interface FetchRedisKeysRequest {
    host: string;
    port: string;
    password?: string;
    database: string; // e.g., "db0"
    page: number;
    pageSize: number;
    pattern?: string;
    types?: string[];
}

export async function POST(request: NextRequest) {
    try {
        const params: FetchRedisKeysRequest = await request.json();

        if (!params.host || !params.port) {
            return NextResponse.json(
                { error: 'Missing required connection parameters' },
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

            // Use SCAN to get keys with pattern
            const pattern = params.pattern || '*';
            const typeFilter = params.types && params.types.length > 0 ? new Set(params.types.map(t => t.toLowerCase())) : null;
            let allKeys: string[] = [];

            for await (const keyOrKeys of client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
                // scanIterator may return a single key (string) or an array of keys
                if (Array.isArray(keyOrKeys)) {
                    allKeys.push(...keyOrKeys);
                } else {
                    allKeys.push(keyOrKeys);
                }
                // Limit to 2000 keys max for type filtering (we'll filter down later)
                if (allKeys.length >= 2000) break;
            }

            console.log('[Redis] Raw keys from SCAN (first 5):', allKeys.slice(0, 5));
            console.log('[Redis] Total keys before type filter:', allKeys.length);

            // Apply type filtering if specified
            if (typeFilter) {
                const keysWithTypes = await Promise.all(
                    allKeys.map(async (key) => {
                        try {
                            const keyType = await client.type(key);
                            return { key, type: keyType };
                        } catch {
                            return { key, type: 'unknown' };
                        }
                    })
                );
                allKeys = keysWithTypes
                    .filter(item => typeFilter.has(item.type))
                    .map(item => item.key);
                console.log('[Redis] Keys after type filter:', allKeys.length);
            }

            // Sort keys alphabetically
            allKeys.sort();

            // Get total count before pagination
            const total = allKeys.length;

            // Apply pagination
            const start = (params.page - 1) * params.pageSize;
            const end = start + params.pageSize;
            const paginatedKeys = allKeys.slice(start, end);

            // Fetch type, value preview, and TTL for each key
            const keysWithDetails = await Promise.all(
                paginatedKeys.map(async (key) => {
                    try {
                        const keyType = await client.type(key);
                        const ttl = await client.ttl(key);

                        // Get value preview based on type
                        let value = '';
                        switch (keyType) {
                            case 'string':
                                const strVal = await client.get(key);
                                value = strVal?.substring(0, 200) || '';
                                break;
                            case 'hash':
                                const hashVal = await client.hGetAll(key);
                                const hashEntries = Object.entries(hashVal).slice(0, 5);
                                value = `[${hashEntries.map(([k, v]) => `${k}:${v}`).join(', ')}]`;
                                break;
                            case 'list':
                                const listLen = await client.lLen(key);
                                value = `(list with ${listLen} items)`;
                                break;
                            case 'set':
                                const setLen = await client.sCard(key);
                                value = `(set with ${setLen} members)`;
                                break;
                            case 'zset':
                                const zsetLen = await client.zCard(key);
                                value = `(sorted set with ${zsetLen} members)`;
                                break;
                            case 'stream':
                                const streamLen = await client.xLen(key);
                                value = `(stream with ${streamLen} entries)`;
                                break;
                            default:
                                value = `(${keyType})`;
                        }

                        // Format TTL
                        let ttlStr = '无过期时间';
                        if (ttl > 0) {
                            if (ttl >= 86400) {
                                ttlStr = `${Math.floor(ttl / 86400)} 天`;
                            } else if (ttl >= 3600) {
                                ttlStr = `${Math.floor(ttl / 3600)} 小时`;
                            } else if (ttl >= 60) {
                                ttlStr = `${Math.floor(ttl / 60)} 分钟`;
                            } else {
                                ttlStr = `${ttl} 秒`;
                            }
                        }

                        return { key, type: keyType, value, ttl: ttlStr };
                    } catch (err) {
                        return { key, type: 'unknown', value: 'Error fetching', ttl: '-' };
                    }
                })
            );

            console.log(`[Redis] Fetched ${keysWithDetails.length} keys from db${dbNumber}`);

            return NextResponse.json({
                success: true,
                data: keysWithDetails,
                total,
                page: params.page,
                pageSize: params.pageSize
            });

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
        console.error('Fetch Redis keys error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch Redis keys' },
            { status: 500 }
        );
    }
}
