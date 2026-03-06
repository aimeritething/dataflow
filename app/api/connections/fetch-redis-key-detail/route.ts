import { NextRequest, NextResponse } from 'next/server';

interface FetchRedisKeyDetailRequest {
    host: string;
    port: string;
    password?: string;
    database: string;
    key: string;
}

export async function POST(request: NextRequest) {
    try {
        const params: FetchRedisKeyDetailRequest = await request.json();

        if (!params.host || !params.port || !params.key) {
            return NextResponse.json(
                { error: 'Missing required parameters' },
                { status: 400 }
            );
        }

        const { createClient } = require('redis');

        // Parse database number
        const dbNumber = params.database ? parseInt(params.database.replace('db', ''), 10) : 0;

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

            const type = await client.type(params.key);
            const ttl = await client.ttl(params.key);
            let value: any = null;

            switch (type) {
                case 'string':
                    value = await client.get(params.key);
                    break;
                case 'hash':
                    value = await client.hGetAll(params.key);
                    break;
                case 'list':
                    // Get all list items
                    value = await client.lRange(params.key, 0, -1);
                    break;
                case 'set':
                    // Get all set members
                    value = await client.sMembers(params.key);
                    break;
                case 'zset':
                    // Get all zset members with scores
                    // zRangeWithScores returns { value: string, score: number }[]
                    value = await client.zRangeWithScores(params.key, 0, -1);
                    break;
                default:
                    value = 'Unsupported type or key does not exist';
            }

            return NextResponse.json({
                success: true,
                data: {
                    key: params.key,
                    type,
                    ttl,
                    value
                }
            });

        } finally {
            if (isConnected) {
                await client.disconnect();
            }
        }

    } catch (error: any) {
        console.error('Fetch Redis key detail error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch Redis key details' },
            { status: 500 }
        );
    }
}
