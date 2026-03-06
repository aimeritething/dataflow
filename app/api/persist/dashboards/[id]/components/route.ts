import { NextResponse } from 'next/server';
import { query } from '../../../db';
import { v4 as uuidv4 } from 'uuid';

// POST /api/persist/dashboards/[id]/components - Add component to dashboard
export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: dashboardId } = await params;
        const body = await request.json();
        const { type, title, description, layout, data, config } = body;

        if (!type) {
            return NextResponse.json(
                { success: false, error: 'Component type is required' },
                { status: 400 }
            );
        }

        const id = uuidv4();

        await query(`
            INSERT INTO dashboard_components 
            (id, dashboard_id, type, title, description, layout_x, layout_y, layout_w, layout_h, data, config)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            id,
            dashboardId,
            type,
            title || '',
            description || '',
            layout?.x || 0,
            layout?.y || 0,
            layout?.w || 4,
            layout?.h || 4,
            data ? JSON.stringify(data) : null,
            config ? JSON.stringify(config) : null
        ]);

        // Update dashboard's updated_at
        await query(`UPDATE dashboards SET updated_at = ? WHERE id = ?`, [Date.now(), dashboardId]);

        return NextResponse.json({
            success: true,
            data: { id, type, title, description, layout, data, config }
        });
    } catch (error: any) {
        console.error('[Component POST Error]:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
