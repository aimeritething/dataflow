import { NextResponse } from 'next/server';
import { initializeDatabase } from '../db';

// POST /api/persist/init - Initialize database tables
export async function POST() {
    try {
        await initializeDatabase();
        return NextResponse.json({
            success: true,
            message: 'Database initialized successfully'
        });
    } catch (error: any) {
        console.error('[DB Init Error]:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}

// GET /api/persist/init - Check database status
export async function GET() {
    try {
        const { default: pool } = await import('../db');
        const [rows] = await pool.execute('SELECT 1');
        return NextResponse.json({
            success: true,
            message: 'Database connection OK'
        });
    } catch (error: any) {
        console.error('[DB Check Error]:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
