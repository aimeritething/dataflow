import { NextRequest, NextResponse } from 'next/server';

interface FetchKeyValueRequest {
    type: 'redis';
    host: string;
    port: string;
    password?: string;
    database?: string; // e.g., "db0", "db1", etc.
    key: string;
}

export async function POST(request: NextRequest) {
    try {
        const params: FetchKeyValueRequest = await request.json();

        console.log('🔵 [API] Received fetch key value request:', {
            key: params.key,
            database: params.database
        });

        if (!params.type || !params.host || !params.port || !params.key) {
            return NextResponse.json(
                { error: 'Missing required connection parameters' },
                { status: 400 }
            );
        }

        if (params.type === 'redis') {
            const { createClient } = require('redis');

            // Parse database number from "db0", "db1", etc.
            const dbNumber = params.database ? parseInt(params.database.replace('db', ''), 10) : 0;

            // Build Redis URL with database number
            const redisUrl = params.password
                ? `redis://:${encodeURIComponent(params.password)}@${params.host}:${params.port}/${dbNumber}`
                : `redis://${params.host}:${params.port}/${dbNumber}`;

            const client = createClient({ url: redisUrl });

            try {
                await client.connect();

                // Get key type
                const keyType = await client.type(params.key);

                if (keyType === 'none') {
                    return NextResponse.json(
                        { error: 'Key does not exist' },
                        { status: 404 }
                    );
                }

                // Get TTL
                const ttl = await client.ttl(params.key);

                // Get value based on type
                let value: any;

                switch (keyType) {
                    case 'string':
                        value = await client.get(params.key);
                        break;
                    case 'list':
                        // Get first 100 elements
                        value = await client.lRange(params.key, 0, 99);
                        break;
                    case 'set':
                        // Get all members (up to 100)
                        value = await client.sMembers(params.key);
                        if (value.length > 100) value = value.slice(0, 100);
                        break;
                    case 'zset':
                        // Get all members with scores (up to 100)
                        value = await client.zRangeWithScores(params.key, 0, 99);
                        break;
                    case 'hash':
                        // Get all hash fields
                        value = await client.hGetAll(params.key);
                        break;
                    case 'stream':
                        // Get first 100 stream entries
                        value = await client.xRange(params.key, '-', '+', { COUNT: 100 });
                        break;
                    default:
                        value = `Unsupported type: ${keyType}`;
                }

                console.log(`[Redis] Fetched key "${params.key}" (type: ${keyType})`);

                return NextResponse.json({
                    success: true,
                    data: {
                        key: params.key,
                        type: keyType,
                        value,
                        ttl, // -1 means no expiration, -2 means key doesn't exist
                        database: dbNumber
                    }
                });
            } finally {
                await client.disconnect();
            }
        } else {
            return NextResponse.json(
                { error: 'Key value fetching only supported for Redis' },
                { status: 400 }
            );
        }
    } catch (error: any) {
        console.error('💥 [API] Fetch key value error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch key value' },
            { status: 500 }
        );
    }
}
