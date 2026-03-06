
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string; database: string; collection: string }> }
) {
    try {
        const params = await context.params;
        const { id: connectionId, database, collection } = params;

        console.log('[PSEUDO-CODE] Fetching collection info for:', connectionId, database, collection);

        await new Promise(resolve => setTimeout(resolve, 200));

        const collectionInfo = {
            name: collection,
            documentCount: Math.floor(Math.random() * 50000) + 500,
            avgDocumentSize: `${(Math.random() * 5 + 0.5).toFixed(2)} KB`,
            totalSize: `${(Math.random() * 100 + 10).toFixed(2)} MB`,
            indexCount: Math.floor(Math.random() * 5) + 1,
            storageSize: `${(Math.random() * 150 + 15).toFixed(2)} MB`,
        };

        return NextResponse.json({ success: true, data: collectionInfo });
    } catch (error) {
        console.error('Get collection info error:', error);
        return NextResponse.json(
            { error: 'Failed to fetch collection info' },
            { status: 500 }
        );
    }
}
