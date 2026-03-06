import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import { Client } from 'pg';

interface ColumnDefinition {
    name: string;
    type: string;
    isPrimaryKey: boolean;
    isNullable: boolean;
}

interface CreateTableRequest {
    type: 'mysql' | 'postgres' | 'mongodb' | 'redis';
    host: string;
    port: string;
    user: string;
    password: string;
    databaseName: string;
    tableName: string;
    columns: ColumnDefinition[];
}

export async function POST(request: NextRequest) {
    try {
        const params: CreateTableRequest = await request.json();

        console.log('🔵 [API] Received create table request:', {
            database: params.databaseName,
            table: params.tableName,
            type: params.type
        });

        if (!params.type || !params.host || !params.port || !params.user || !params.databaseName || !params.tableName || !params.columns) {
            console.error('❌ [API] Missing required parameters');
            return NextResponse.json(
                { error: 'Missing required connection parameters' },
                { status: 400 }
            );
        }

        // Map column types based on database type
        const mapColumnType = (type: string, dbType: string): string => {
            if (dbType === 'postgres') {
                const typeMap: Record<string, string> = {
                    'DATETIME': 'TIMESTAMP',
                    'INT': 'INTEGER',
                    'FLOAT': 'REAL',
                    'DOUBLE': 'DOUBLE PRECISION',
                    'TINYINT': 'SMALLINT',
                    'MEDIUMINT': 'INTEGER',
                    'BIGINT': 'BIGINT',
                };
                // Check for exact match first
                const upperType = type.toUpperCase();
                if (typeMap[upperType]) {
                    return typeMap[upperType];
                }
                // Check for VARCHAR with length - PG supports this
                return type;
            }
            return type;
        };

        const columnDefinitions = params.columns.map(col => {
            const mappedType = mapColumnType(col.type, params.type);
            let def = `${col.name} ${mappedType}`;
            if (!col.isNullable) {
                def += ' NOT NULL';
            }
            if (col.isPrimaryKey) {
                def += ' PRIMARY KEY';
            }
            return def;
        }).join(', ');

        console.log('📝 [API] Column definitions:', columnDefinitions);

        if (params.type === 'mysql') {
            console.log('🔌 [API] Connecting to MySQL...');
            const connection = await mysql.createConnection({
                host: params.host,
                port: parseInt(params.port),
                user: params.user,
                password: params.password,
                database: params.databaseName
            });

            try {
                // Sanitize table name (basic)
                if (!/^[a-zA-Z0-9_]+$/.test(params.tableName)) {
                    throw new Error('Invalid table name');
                }

                const query = `CREATE TABLE \`${params.tableName}\` (${columnDefinitions})`;
                console.log('🔍 [API] Executing query:', query);

                await connection.query(query);
                console.log('✅ [API] Table created successfully');

                return NextResponse.json({ success: true, message: 'Table created successfully' });
            } finally {
                await connection.end();
            }
        } else if (params.type === 'postgres') {
            console.log('🔌 [API] Connecting to PostgreSQL...');
            const client = new Client({
                host: params.host,
                port: parseInt(params.port),
                user: params.user,
                password: params.password,
                database: params.databaseName,
            });

            await client.connect();

            try {
                // Sanitize table name
                if (!/^[a-zA-Z0-9_]+$/.test(params.tableName)) {
                    throw new Error('Invalid table name');
                }

                const query = `CREATE TABLE "${params.tableName}" (${columnDefinitions})`;
                console.log('🔍 [API] Executing query:', query);

                await client.query(query);
                console.log('✅ [API] Table created successfully');

                return NextResponse.json({ success: true, message: 'Table created successfully' });
            } finally {
                await client.end();
            }
        } else {
            return NextResponse.json(
                { error: 'Table creation not supported for this type' },
                { status: 400 }
            );
        }
    } catch (error: any) {
        console.error('💥 [API] Create table error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to create table' },
            { status: 500 }
        );
    }
}
