import { NextResponse } from 'next/server';
import { query } from '../../../db';
import { v4 as uuidv4 } from 'uuid';

// POST /api/persist/conversations/[id]/messages - Add message to conversation
export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: conversationId } = await params;
        const body = await request.json();
        const { role, content, chart } = body;

        if (!role || !content) {
            return NextResponse.json(
                { success: false, error: 'Role and content are required' },
                { status: 400 }
            );
        }

        const id = uuidv4();
        const timestamp = Date.now();

        await query(`
            INSERT INTO chat_messages (id, conversation_id, role, content, timestamp, chart_data)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            id,
            conversationId,
            role,
            content,
            timestamp,
            chart ? JSON.stringify(chart) : null
        ]);

        // Update chart_count if this message has a chart
        if (chart) {
            await query(`
                UPDATE chat_conversations 
                SET chart_count = chart_count + 1 
                WHERE id = ?
            `, [conversationId]);
        }

        return NextResponse.json({
            success: true,
            data: { id, role, content, timestamp, chart }
        });
    } catch (error: any) {
        console.error('[Message POST Error]:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
