
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string; database: string; key: string }> }
) {
    try {
        const params = await context.params;
        const { id: connectionId, database, key } = params;

        console.log('[PSEUDO-CODE] Fetching key info for:', connectionId, database, key);

        await new Promise(resolve => setTimeout(resolve, 150));

        const types = ['string', 'hash', 'list', 'set', 'zset'];
        const type = types[Math.floor(Math.random() * types.length)];

        const keyInfo = {
            name: key,
            type: type,
            ttl: Math.random() > 0.3 ? Math.floor(Math.random() * 86400) : -1, // -1 means no expiry
            size: `${Math.floor(Math.random() * 1024)} bytes`,
            encoding: 'raw',
            memory: `${Math.floor(Math.random() * 2048)} bytes`,
        };

        return NextResponse.json({ success: true, data: keyInfo });
    } catch (error) {
        console.error('Get key info error:', error);
        return NextResponse.json(
            { error: 'Failed to fetch key info' },
            { status: 500 }
        );
    }
}
