import { NextResponse } from 'next/server';
import { query } from '../../db';

// GET /api/persist/dashboards/[id] - Get dashboard with components
export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        // Get dashboard
        const dashboards = await query<any[]>(`
            SELECT id, name, description, thumbnail, created_at, updated_at
            FROM dashboards
            WHERE id = ?
        `, [id]);

        if (dashboards.length === 0) {
            return NextResponse.json(
                { success: false, error: 'Dashboard not found' },
                { status: 404 }
            );
        }

        // Get components
        const components = await query<any[]>(`
            SELECT 
                id, dashboard_id, type, title, description,
                layout_x, layout_y, layout_w, layout_h,
                data, config, created_at
            FROM dashboard_components
            WHERE dashboard_id = ?
            ORDER BY layout_y, layout_x
        `, [id]);

        // Transform components to match frontend format
        // Note: data and config are JSON type columns, MySQL2 auto-parses them
        const transformedComponents = components.map(comp => {
            // Handle data field
            let data = undefined;
            if (comp.data) {
                data = typeof comp.data === 'string' ? JSON.parse(comp.data) : comp.data;
            }
            // Handle config field
            let config = undefined;
            if (comp.config) {
                config = typeof comp.config === 'string' ? JSON.parse(comp.config) : comp.config;
            }

            return {
                id: comp.id,
                type: comp.type,
                title: comp.title,
                description: comp.description,
                layout: {
                    i: comp.id,
                    x: comp.layout_x,
                    y: comp.layout_y,
                    w: comp.layout_w,
                    h: comp.layout_h
                },
                data,
                config
            };
        });

        return NextResponse.json({
            success: true,
            data: {
                ...dashboards[0],
                components: transformedComponents
            }
        });
    } catch (error: any) {
        console.error('[Dashboard GET Error]:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}

// PUT /api/persist/dashboards/[id] - Update dashboard
export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await request.json();
        const { name, description, thumbnail, components } = body;

        // Update dashboard info
        const updates: string[] = [];
        const values: any[] = [];

        if (name !== undefined) { updates.push('name = ?'); values.push(name); }
        if (description !== undefined) { updates.push('description = ?'); values.push(description); }
        if (thumbnail !== undefined) { updates.push('thumbnail = ?'); values.push(thumbnail); }
        updates.push('updated_at = ?'); values.push(Date.now());

        values.push(id);

        await query(`
            UPDATE dashboards 
            SET ${updates.join(', ')}
            WHERE id = ?
        `, values);

        // If components are provided, update them
        if (components && Array.isArray(components)) {
            // Delete existing components first
            await query(`DELETE FROM dashboard_components WHERE dashboard_id = ?`, [id]);

            // Insert new components using REPLACE INTO to handle any race conditions
            for (const comp of components) {
                await query(`
                    REPLACE INTO dashboard_components 
                    (id, dashboard_id, type, title, description, layout_x, layout_y, layout_w, layout_h, data, config)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    comp.id,
                    id,
                    comp.type,
                    comp.title || '',
                    comp.description || '',
                    comp.layout?.x || 0,
                    comp.layout?.y || 0,
                    comp.layout?.w || 6,
                    comp.layout?.h || 6,
                    comp.data ? JSON.stringify(comp.data) : null,
                    comp.config ? JSON.stringify(comp.config) : null
                ]);
            }
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('[Dashboard PUT Error]:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}

// DELETE /api/persist/dashboards/[id] - Delete dashboard
export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        // Components will be deleted automatically due to ON DELETE CASCADE
        await query(`DELETE FROM dashboards WHERE id = ?`, [id]);

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('[Dashboard DELETE Error]:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
