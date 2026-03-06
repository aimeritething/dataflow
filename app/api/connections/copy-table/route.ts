import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import { Client as PgClient } from 'pg';

export async function POST(request: NextRequest) {
    try {
        const { type, host, port, user, password, database, sourceTable, targetTable, copyData } = await request.json();

        console.log(`[API] Copying table ${sourceTable} to ${targetTable} in database ${database} (${type})`);
        console.log(`[API] Copy data: ${copyData}`);

        if (type === 'mysql') {
            const connection = await mysql.createConnection({
                host,
                port: parseInt(port),
                user,
                password,
                database
            });

            try {
                // 1. Copy structure
                await connection.query(`CREATE TABLE \`${targetTable}\` LIKE \`${sourceTable}\``);

                // 2. Copy data if requested
                if (copyData) {
                    await connection.query(`INSERT INTO \`${targetTable}\` SELECT * FROM \`${sourceTable}\``);
                }

                await connection.end();
                return NextResponse.json({ success: true, message: 'Table copied successfully' });
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

                // 1. Copy structure (including constraints/indexes is complex in PG with simple SQL, 
                // but CREATE TABLE AS ... WITH NO DATA copies column definitions)
                // To copy structure exactly like MySQL's LIKE is harder, but this is a good approximation for now.
                // Better approach for PG: CREATE TABLE target (LIKE source INCLUDING ALL);
                await client.query(`CREATE TABLE "${targetTable}" (LIKE "${sourceTable}" INCLUDING ALL)`);

                // 2. Copy data if requested
                if (copyData) {
                    await client.query(`INSERT INTO "${targetTable}" SELECT * FROM "${sourceTable}"`);
                }

                await client.end();
                return NextResponse.json({ success: true, message: 'Table copied successfully' });
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
        console.error('Copy table error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to copy table' },
            { status: 500 }
        );
    }
}
