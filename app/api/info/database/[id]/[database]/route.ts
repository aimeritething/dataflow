
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string; database: string }> }
) {
    try {
        const params = await context.params;
        const { id: connectionId, database } = params;

        // PSEUDO-CODE: Fetch database info
        console.log('[PSEUDO-CODE] Fetching database info for:', connectionId, database);

        await new Promise(resolve => setTimeout(resolve, 150));

        // Mock database info
        const databaseInfo = {
            name: database,
            size: `${(Math.random() * 500 + 50).toFixed(2)} MB`,
            tableCount: Math.floor(Math.random() * 50) + 10,
            characterSet: 'utf8mb4',
            collation: 'utf8mb4_unicode_ci',
            created: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString(),
        };

        return NextResponse.json({ success: true, data: databaseInfo });
    } catch (error) {
        console.error('Get database info error:', error);
        return NextResponse.json(
            { error: 'Failed to fetch database info' },
            { status: 500 }
        );
    }
}
