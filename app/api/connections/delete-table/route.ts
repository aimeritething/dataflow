import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import { Client } from 'pg';

interface DeleteTableRequest {
    type: 'mysql' | 'postgres';
    host: string;
    port: string;
    user: string;
    password: string;
    databaseName: string;
    tableName: string;
}

export async function POST(request: NextRequest) {
    try {
        const params: DeleteTableRequest = await request.json();

        console.log('🔵 [API] Received delete table request:', {
            database: params.databaseName,
            table: params.tableName,
            type: params.type
        });

        if (!params.type || !params.host || !params.port || !params.user || !params.databaseName || !params.tableName) {
            return NextResponse.json(
                { error: 'Missing required connection parameters' },
                { status: 400 }
            );
        }

        if (params.type === 'mysql') {
            const connection = await mysql.createConnection({
                host: params.host,
                port: parseInt(params.port),
                user: params.user,
                password: params.password,
                database: params.databaseName
            });

            try {
                const query = `DROP TABLE IF EXISTS \`${params.tableName}\``;
                console.log('🔍 [API] Executing query:', query);
                await connection.query(query);

                return NextResponse.json({ success: true, message: 'Table deleted successfully' });
            } finally {
                await connection.end();
            }
        } else if (params.type === 'postgres') {
            const client = new Client({
                host: params.host,
                port: parseInt(params.port),
                user: params.user,
                password: params.password,
                database: params.databaseName,
            });

            await client.connect();

            try {
                const query = `DROP TABLE IF EXISTS "${params.tableName}"`;
                console.log('🔍 [API] Executing query:', query);
                await client.query(query);

                return NextResponse.json({ success: true, message: 'Table deleted successfully' });
            } finally {
                await client.end();
            }
        } else {
            return NextResponse.json(
                { error: 'Delete table not supported for this type' },
                { status: 400 }
            );
        }
    } catch (error: any) {
        console.error('💥 [API] Delete table error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to delete table' },
            { status: 500 }
        );
    }
}
