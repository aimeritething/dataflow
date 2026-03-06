import { NextResponse } from 'next/server';
import { query } from '../../../db';

// PUT /api/persist/dashboards/components/[id] - Update a component
export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await request.json();
        const { type, title, description, layout, data, config } = body;

        const updates: string[] = [];
        const values: any[] = [];

        if (type !== undefined) { updates.push('type = ?'); values.push(type); }
        if (title !== undefined) { updates.push('title = ?'); values.push(title); }
        if (description !== undefined) { updates.push('description = ?'); values.push(description); }
        if (layout !== undefined) {
            if (layout.x !== undefined) { updates.push('layout_x = ?'); values.push(layout.x); }
            if (layout.y !== undefined) { updates.push('layout_y = ?'); values.push(layout.y); }
            if (layout.w !== undefined) { updates.push('layout_w = ?'); values.push(layout.w); }
            if (layout.h !== undefined) { updates.push('layout_h = ?'); values.push(layout.h); }
        }
        if (data !== undefined) { updates.push('data = ?'); values.push(JSON.stringify(data)); }
        if (config !== undefined) { updates.push('config = ?'); values.push(JSON.stringify(config)); }

        if (updates.length === 0) {
            return NextResponse.json(
                { success: false, error: 'No fields to update' },
                { status: 400 }
            );
        }

        values.push(id);

        await query(`
            UPDATE dashboard_components 
            SET ${updates.join(', ')}
            WHERE id = ?
        `, values);

        // Update parent dashboard's updated_at
        await query(`
            UPDATE dashboards d
            INNER JOIN dashboard_components c ON c.dashboard_id = d.id
            SET d.updated_at = ?
            WHERE c.id = ?
        `, [Date.now(), id]);

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('[Component PUT Error]:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}

// DELETE /api/persist/dashboards/components/[id] - Delete a component
export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        // Get dashboard_id before deleting
        const components = await query<any[]>(
            `SELECT dashboard_id FROM dashboard_components WHERE id = ?`,
            [id]
        );

        await query(`DELETE FROM dashboard_components WHERE id = ?`, [id]);

        // Update parent dashboard's updated_at
        if (components.length > 0) {
            await query(`UPDATE dashboards SET updated_at = ? WHERE id = ?`,
                [Date.now(), components[0].dashboard_id]);
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('[Component DELETE Error]:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
