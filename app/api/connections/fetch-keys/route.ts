import { NextRequest, NextResponse } from 'next/server';

interface FetchKeysRequest {
    type: 'redis';
    host: string;
    port: string;
    password?: string;
    database?: string; // e.g., "db0", "db1", etc.
    pattern?: string;  // Optional pattern for filtering keys, default "*"
}

export async function POST(request: NextRequest) {
    try {
        const params: FetchKeysRequest = await request.json();

        if (!params.type || !params.host || !params.port) {
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
            let redisUrl = params.password
                ? `redis://:${encodeURIComponent(params.password)}@${params.host}:${params.port}/${dbNumber}`
                : `redis://${params.host}:${params.port}/${dbNumber}`;

            const client = createClient({ url: redisUrl });

            try {
                await client.connect();

                // Use SCAN to get keys (better than KEYS for large datasets)
                const pattern = params.pattern || '*';
                const keys: string[] = [];

                // Scan with a reasonable count limit
                for await (const key of client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
                    keys.push(key);
                    // Limit to 500 keys to prevent overwhelming the UI
                    if (keys.length >= 500) break;
                }

                // Sort keys alphabetically
                keys.sort();

                console.log(`[Redis] Fetched ${keys.length} keys from db${dbNumber}`);

                return NextResponse.json({
                    success: true,
                    keys,
                    database: dbNumber,
                    truncated: keys.length >= 500
                });
            } finally {
                await client.disconnect();
            }
        } else {
            return NextResponse.json(
                { error: 'Keys are only supported for Redis' },
                { status: 400 }
            );
        }
    } catch (error: any) {
        console.error('Fetch keys error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch keys' },
            { status: 500 }
        );
    }
}
