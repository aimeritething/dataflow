import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import { Client } from 'pg';

interface UpdateDatabaseRequest {
    type: 'mysql' | 'postgres';
    host: string;
    port: string;
    user: string;
    password: string;
    databaseName: string;
    newName?: string;
    charset?: string;
    collation?: string;
}

export async function POST(request: NextRequest) {
    try {
        const params: UpdateDatabaseRequest = await request.json();

        console.log('🔵 [API] Received update database request:', {
            database: params.databaseName,
            newName: params.newName,
            type: params.type
        });

        if (!params.type || !params.host || !params.port || !params.user || !params.databaseName) {
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
            });

            try {
                // MySQL doesn't support RENAME DATABASE easily. 
                // We only support changing charset/collation for now if newName is not provided.
                // If newName is provided, we might need to warn or implement the dump/restore (too heavy for now).

                if (params.newName && params.newName !== params.databaseName) {
                    // Check if we can rename (usually no)
                    return NextResponse.json(
                        { error: 'Renaming database is not supported in MySQL directly.' },
                        { status: 400 }
                    );
                }

                if (params.charset && params.collation) {
                    const query = `ALTER DATABASE \`${params.databaseName}\` CHARACTER SET ${params.charset} COLLATE ${params.collation}`;
                    console.log('🔍 [API] Executing query:', query);
                    await connection.query(query);
                }

                return NextResponse.json({ success: true, message: 'Database updated successfully' });
            } finally {
                await connection.end();
            }
        } else if (params.type === 'postgres') {
            const client = new Client({
                host: params.host,
                port: parseInt(params.port),
                user: params.user,
                password: params.password,
                database: 'postgres', // Connect to default DB to rename others
            });

            await client.connect();

            try {
                if (params.newName && params.newName !== params.databaseName) {
                    // Sanitize names
                    if (!/^[a-zA-Z0-9_]+$/.test(params.newName)) {
                        throw new Error('Invalid new database name');
                    }

                    // Force disconnect other users might be needed, but for now simple rename
                    const query = `ALTER DATABASE "${params.databaseName}" RENAME TO "${params.newName}"`;
                    console.log('🔍 [API] Executing query:', query);
                    await client.query(query);
                }

                return NextResponse.json({ success: true, message: 'Database updated successfully' });
            } finally {
                await client.end();
            }
        } else {
            return NextResponse.json(
                { error: 'Update database not supported for this type' },
                { status: 400 }
            );
        }
    } catch (error: any) {
        console.error('💥 [API] Update database error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to update database' },
            { status: 500 }
        );
    }
}
