import { NextResponse } from 'next/server';
import { query } from '../../db';

// GET /api/persist/conversations/[id] - Get conversation with messages
export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        // Get conversation
        const conversations = await query<any[]>(`
            SELECT 
                id, title, timestamp, chart_count,
                datasource_id, datasource_name, datasource_type, datasource_database
            FROM chat_conversations
            WHERE id = ?
        `, [id]);

        if (conversations.length === 0) {
            return NextResponse.json(
                { success: false, error: 'Conversation not found' },
                { status: 404 }
            );
        }

        // Get messages
        const messages = await query<any[]>(`
            SELECT id, role, content, timestamp, chart_data
            FROM chat_messages
            WHERE conversation_id = ?
            ORDER BY timestamp ASC
        `, [id]);

        const row = conversations[0];

        // Transform messages
        // Note: chart_data is JSON type, MySQL2 auto-parses it
        const transformedMessages = messages.map(msg => {
            let chart = undefined;
            if (msg.chart_data) {
                // If it's a string (from older data), parse it; otherwise use as-is
                chart = typeof msg.chart_data === 'string' ? JSON.parse(msg.chart_data) : msg.chart_data;
            }
            return {
                id: msg.id,
                role: msg.role,
                content: msg.content,
                timestamp: msg.timestamp,
                chart
            };
        });

        return NextResponse.json({
            success: true,
            data: {
                id: row.id,
                title: row.title,
                timestamp: row.timestamp,
                chartCount: row.chart_count,
                messages: transformedMessages,
                dataSource: row.datasource_id ? {
                    id: row.datasource_id,
                    name: row.datasource_name,
                    type: row.datasource_type,
                    database: row.datasource_database
                } : undefined
            }
        });
    } catch (error: any) {
        console.error('[Conversation GET Error]:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}

// PUT /api/persist/conversations/[id] - Update conversation
export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await request.json();
        const { title, chartCount, dataSource } = body;

        const updates: string[] = [];
        const values: any[] = [];

        if (title !== undefined) { updates.push('title = ?'); values.push(title); }
        if (chartCount !== undefined) { updates.push('chart_count = ?'); values.push(chartCount); }
        if (dataSource !== undefined) {
            updates.push('datasource_id = ?'); values.push(dataSource?.id || null);
            updates.push('datasource_name = ?'); values.push(dataSource?.name || null);
            updates.push('datasource_type = ?'); values.push(dataSource?.type || null);
            updates.push('datasource_database = ?'); values.push(dataSource?.database || null);
        }

        if (updates.length === 0) {
            return NextResponse.json(
                { success: false, error: 'No fields to update' },
                { status: 400 }
            );
        }

        values.push(id);

        await query(`
            UPDATE chat_conversations 
            SET ${updates.join(', ')}
            WHERE id = ?
        `, values);

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('[Conversation PUT Error]:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}

// DELETE /api/persist/conversations/[id] - Delete conversation
export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        // Messages will be deleted automatically due to ON DELETE CASCADE
        await query(`DELETE FROM chat_conversations WHERE id = ?`, [id]);

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('[Conversation DELETE Error]:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
