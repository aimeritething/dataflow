import { NextResponse } from 'next/server';
import { query } from '../db';
import { v4 as uuidv4 } from 'uuid';

// GET /api/persist/conversations - Get all conversations (without messages)
export async function GET() {
    try {
        const rows = await query<any[]>(`
            SELECT 
                id, title, timestamp, chart_count,
                datasource_id, datasource_name, datasource_type, datasource_database,
                created_at, updated_at
            FROM chat_conversations
            ORDER BY timestamp DESC
        `);

        // Transform to match frontend format
        const conversations = rows.map(row => ({
            id: row.id,
            title: row.title,
            timestamp: row.timestamp,
            chartCount: row.chart_count,
            messages: [], // Will be loaded separately
            dataSource: row.datasource_id ? {
                id: row.datasource_id,
                name: row.datasource_name,
                type: row.datasource_type,
                database: row.datasource_database
            } : undefined
        }));

        return NextResponse.json({
            success: true,
            data: conversations
        });
    } catch (error: any) {
        console.error('[Conversations GET Error]:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}

// POST /api/persist/conversations - Create a new conversation
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { title, dataSource } = body;

        const id = uuidv4();
        const timestamp = Date.now();

        await query(`
            INSERT INTO chat_conversations 
            (id, title, timestamp, chart_count, datasource_id, datasource_name, datasource_type, datasource_database)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            id,
            title || 'New Conversation',
            timestamp,
            0,
            dataSource?.id || null,
            dataSource?.name || null,
            dataSource?.type || null,
            dataSource?.database || null
        ]);

        return NextResponse.json({
            success: true,
            data: {
                id,
                title: title || 'New Conversation',
                timestamp,
                chartCount: 0,
                messages: [],
                dataSource
            }
        });
    } catch (error: any) {
        console.error('[Conversations POST Error]:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
