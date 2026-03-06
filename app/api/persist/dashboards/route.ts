import { NextResponse } from 'next/server';
import { query } from '../db';
import { v4 as uuidv4 } from 'uuid';

// GET /api/persist/dashboards - Get all dashboards (without components)
export async function GET() {
    try {
        const rows = await query<any[]>(`
            SELECT id, name, description, thumbnail, created_at, updated_at
            FROM dashboards
            ORDER BY updated_at DESC
        `);

        return NextResponse.json({
            success: true,
            data: rows
        });
    } catch (error: any) {
        console.error('[Dashboards GET Error]:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}

// POST /api/persist/dashboards - Create a new dashboard
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { name, description, thumbnail } = body;

        if (!name) {
            return NextResponse.json(
                { success: false, error: 'Dashboard name is required' },
                { status: 400 }
            );
        }

        const id = uuidv4();
        const now = Date.now();

        await query(`
            INSERT INTO dashboards (id, name, description, thumbnail, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [id, name, description || '', thumbnail || '', now, now]);

        return NextResponse.json({
            success: true,
            data: { id, name, description, thumbnail, created_at: now, updated_at: now, components: [] }
        });
    } catch (error: any) {
        console.error('[Dashboards POST Error]:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
