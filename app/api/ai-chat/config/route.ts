/**
 * AI Config API Endpoint
 * 
 * GET /api/ai-chat/config
 * 
 * Returns current AI configuration status (without sensitive data).
 */

import { NextResponse } from 'next/server';
import { getAIConfigStatus } from '@/lib/ai';

export async function GET() {
    try {
        const status = getAIConfigStatus();

        return NextResponse.json({
            success: true,
            ...status,
        });
    } catch (error) {
        console.error('AI config error:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to get AI config'
            },
            { status: 500 }
        );
    }
}
