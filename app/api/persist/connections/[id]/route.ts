import { NextResponse } from 'next/server';
import { query } from '../../db';

// PUT /api/persist/connections/[id] - Update a connection
export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await request.json();
        const { name, type, host, port, user, password, database, is_default } = body;

        // Build dynamic update query
        const updates: string[] = [];
        const values: any[] = [];

        if (name !== undefined) { updates.push('name = ?'); values.push(name); }
        if (type !== undefined) { updates.push('type = ?'); values.push(type); }
        if (host !== undefined) { updates.push('host = ?'); values.push(host); }
        if (port !== undefined) { updates.push('port = ?'); values.push(port); }
        if (user !== undefined) { updates.push('user = ?'); values.push(user); }
        if (password !== undefined) { updates.push('password = ?'); values.push(password); }
        if (database !== undefined) { updates.push('database_name = ?'); values.push(database); }
        if (is_default !== undefined) { updates.push('is_default = ?'); values.push(is_default); }

        if (updates.length === 0) {
            return NextResponse.json(
                { success: false, error: 'No fields to update' },
                { status: 400 }
            );
        }

        values.push(id);

        await query(`
            UPDATE db_connections 
            SET ${updates.join(', ')}
            WHERE id = ?
        `, values);

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('[Connections PUT Error]:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}

// DELETE /api/persist/connections/[id] - Delete a connection
export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        await query(`DELETE FROM db_connections WHERE id = ?`, [id]);

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('[Connections DELETE Error]:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}

// GET /api/persist/connections/[id] - Get a single connection
export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        const rows = await query<any[]>(`
            SELECT 
                id, name, type, host, port, user, password, 
                database_name as \`database\`, is_default, created_at
            FROM db_connections
            WHERE id = ?
        `, [id]);

        if (rows.length === 0) {
            return NextResponse.json(
                { success: false, error: 'Connection not found' },
                { status: 404 }
            );
        }

        return NextResponse.json({ success: true, data: rows[0] });
    } catch (error: any) {
        console.error('[Connections GET Error]:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
