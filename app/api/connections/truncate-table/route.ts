import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import { Client as PgClient } from 'pg';

export async function POST(request: NextRequest) {
    try {
        const { type, host, port, user, password, database, table } = await request.json();

        console.log(`[API] Truncating table ${table} in database ${database} (${type})`);

        if (type === 'mysql') {
            const connection = await mysql.createConnection({
                host,
                port: parseInt(port),
                user,
                password,
                database
            });

            try {
                await connection.query(`TRUNCATE TABLE \`${table}\``);
                await connection.end();
                return NextResponse.json({ success: true, message: 'Table truncated successfully' });
            } catch (error) {
                await connection.end();
                throw error;
            }
        } else if (type === 'postgres' || type === 'postgresql') {
            const client = new PgClient({
                host,
                port: parseInt(port),
                user,
                password,
                database
            });

            try {
                await client.connect();
                // Use double quotes for table name and RESTART IDENTITY to reset sequences
                await client.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY`);
                await client.end();
                return NextResponse.json({ success: true, message: 'Table truncated successfully' });
            } catch (error) {
                await client.end();
                throw error;
            }
        } else {
            return NextResponse.json(
                { error: 'Unsupported database type' },
                { status: 400 }
            );
        }
    } catch (error: any) {
        console.error('Truncate table error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to truncate table' },
            { status: 500 }
        );
    }
}
