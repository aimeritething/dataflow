import { NextResponse } from 'next/server';
import { query } from '../db';
import { v4 as uuidv4 } from 'uuid';

interface Connection {
    id: string;
    name: string;
    type: 'MYSQL' | 'POSTGRES' | 'MONGODB' | 'REDIS';
    host: string;
    port: string;
    user: string;
    password: string;
    database: string;
    is_default: boolean;
    created_at: string;
}

// GET /api/persist/connections - Get all connections
export async function GET() {
    try {
        const rows = await query<any[]>(`
            SELECT 
                id, name, type, host, port, user, password, 
                database_name as \`database\`, is_default, created_at
            FROM db_connections
            ORDER BY is_default DESC, created_at DESC
        `);

        return NextResponse.json({
            success: true,
            data: rows
        });
    } catch (error: any) {
        console.error('[Connections GET Error]:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}

// POST /api/persist/connections - Create a new connection
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { name, type, host, port, user, password, database, is_default = false } = body;

        if (!name || !type || !host || !port) {
            return NextResponse.json(
                { success: false, error: 'Missing required fields' },
                { status: 400 }
            );
        }

        const id = uuidv4();

        await query(`
            INSERT INTO db_connections 
            (id, name, type, host, port, user, password, database_name, is_default)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, name, type, host, port, user || '', password || '', database || '', is_default]);

        return NextResponse.json({
            success: true,
            data: { id, name, type, host, port, user, password, database, is_default }
        });
    } catch (error: any) {
        console.error('[Connections POST Error]:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
