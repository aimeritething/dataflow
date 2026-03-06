import { NextRequest, NextResponse } from 'next/server';

interface DeleteRedisKeyRequest {
    host: string;
    port: string;
    password?: string;
    database: string;
    key: string;
}

export async function POST(request: NextRequest) {
    try {
        const params: DeleteRedisKeyRequest = await request.json();

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

            // Check if key exists
            const exists = await client.exists(params.key);
            if (!exists) {
                return NextResponse.json(
                    { success: false, error: `Key "${params.key}" does not exist` },
                    { status: 404 }
                );
            }

            // Delete the key
            await client.del(params.key);

            console.log(`[Redis] Deleted key: ${params.key}`);

            return NextResponse.json({ success: true, message: 'Key deleted successfully' });

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
        console.error('Delete Redis key error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Failed to delete key' },
            { status: 500 }
        );
    }
}
