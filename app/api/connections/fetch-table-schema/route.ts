import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import { Client } from 'pg';

interface FetchTableSchemaRequest {
    type: 'mysql' | 'postgres';
    host: string;
    port: string;
    user: string;
    password: string;
    databaseName: string;
    tableName: string;
    schema?: string; // For PostgreSQL
}

interface ColumnInfo {
    name: string;
    type: string;
    isPrimaryKey: boolean;
    isNullable: boolean;
}

export async function POST(request: NextRequest) {
    try {
        const params: FetchTableSchemaRequest = await request.json();

        console.log('🔵 [API] Received fetch table schema request:', {
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
                // Fetch Columns with Comments
                const [rows] = await connection.query(
                    `SHOW FULL COLUMNS FROM \`${params.tableName}\``
                );

                const columns: ColumnInfo[] = (rows as any[]).map(row => ({
                    name: row.Field,
                    type: row.Type.toUpperCase(),
                    isPrimaryKey: row.Key === 'PRI',
                    isNullable: row.Null === 'YES',
                    comment: row.Comment || ''
                }));

                // Fetch Indexes with Comments
                const [indexRows] = await connection.query(
                    `SHOW INDEX FROM \`${params.tableName}\``
                );

                const indexMap = new Map<string, any>();
                (indexRows as any[]).forEach(row => {
                    if (!indexMap.has(row.Key_name)) {
                        indexMap.set(row.Key_name, {
                            name: row.Key_name,
                            columns: [],
                            type: row.Index_type,
                            isUnique: row.Non_unique === 0,
                            comment: row.Index_comment || ''
                        });
                    }
                    indexMap.get(row.Key_name).columns.push(row.Column_name);
                });
                const indexes = Array.from(indexMap.values());

                // Fetch Foreign Keys
                const [fkRows] = await connection.query(
                    `SELECT
                        CONSTRAINT_NAME as name,
                        COLUMN_NAME as column_name,
                        REFERENCED_TABLE_NAME as referenced_table,
                        REFERENCED_COLUMN_NAME as referenced_column
                     FROM information_schema.KEY_COLUMN_USAGE
                     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
                    [params.databaseName, params.tableName]
                );

                const foreignKeys = (fkRows as any[]).map(row => ({
                    name: row.name,
                    column: row.column_name,
                    referencedTable: row.referenced_table,
                    referencedColumn: row.referenced_column,
                    onDelete: 'RESTRICT', // Default/Placeholder as getting exact action requires another query
                    onUpdate: 'RESTRICT'
                }));

                console.log('✅ [API] Fetched table schema:', { columnsCount: columns.length, indexesCount: indexes.length, fksCount: foreignKeys.length });
                return NextResponse.json({ success: true, columns, indexes, foreignKeys });
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
                const schema = params.schema || 'public';

                // Get column information with comments
                const result = await client.query(
                    `SELECT
                        c.column_name,
                        c.data_type,
                        c.is_nullable,
                        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key,
                        pgd.description as comment
                     FROM information_schema.columns c
                     LEFT JOIN (
                         SELECT ku.column_name
                         FROM information_schema.table_constraints tc
                         JOIN information_schema.key_column_usage ku
                             ON tc.constraint_name = ku.constraint_name
                             AND tc.table_schema = ku.table_schema
                         WHERE tc.constraint_type = 'PRIMARY KEY'
                             AND tc.table_name = $1
                             AND tc.table_schema = $2
                     ) pk ON c.column_name = pk.column_name
                     LEFT JOIN pg_catalog.pg_statio_all_tables as st on c.table_schema = st.schemaname and c.table_name = st.relname
                     LEFT JOIN pg_catalog.pg_description pgd on pgd.objoid = st.relid and pgd.objsubid = c.ordinal_position
                     WHERE c.table_name = $1
                         AND c.table_schema = $2
                     ORDER BY c.ordinal_position`,
                    [params.tableName, schema]
                );

                const columns: ColumnInfo[] = result.rows.map(row => ({
                    name: row.column_name,
                    type: row.data_type.toUpperCase(),
                    isPrimaryKey: row.is_primary_key,
                    isNullable: row.is_nullable === 'YES',
                    comment: row.comment || ''
                }));

                // Fetch Indexes with Comments
                const indexResult = await client.query(
                    `SELECT
                        i.relname as indexname,
                        ix.indexdef,
                        d.description as comment
                     FROM pg_class t
                     JOIN pg_index x ON t.oid = x.indrelid
                     JOIN pg_class i ON i.oid = x.indexrelid
                     JOIN pg_indexes ix ON ix.indexname = i.relname AND ix.schemaname = $1
                     LEFT JOIN pg_description d ON d.objoid = i.oid
                     WHERE t.relname = $2 AND t.relkind = 'r'`,
                    [schema, params.tableName]
                );

                const indexes = indexResult.rows.map(row => ({
                    name: row.indexname,
                    columns: [], // Parsing columns from indexdef is complex, leaving empty for now
                    type: row.indexdef.includes('UNIQUE') ? 'UNIQUE' : 'BTREE', // Simplified
                    isUnique: row.indexdef.includes('UNIQUE'),
                    comment: row.comment || ''
                }));

                // Fetch Foreign Keys
                const fkResult = await client.query(
                    `SELECT
                        kcu.column_name, 
                        ccu.table_name AS foreign_table_name,
                        ccu.column_name AS foreign_column_name 
                    FROM 
                        information_schema.table_constraints AS tc 
                        JOIN information_schema.key_column_usage AS kcu
                          ON tc.constraint_name = kcu.constraint_name
                          AND tc.table_schema = kcu.table_schema
                        JOIN information_schema.constraint_column_usage AS ccu
                          ON ccu.constraint_name = tc.constraint_name
                          AND ccu.table_schema = tc.table_schema
                    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1 AND tc.table_schema = $2`,
                    [params.tableName, schema]
                );

                const foreignKeys = fkResult.rows.map(row => ({
                    name: row.constraint_name,
                    column: row.column_name,
                    referencedTable: row.foreign_table_name,
                    referencedColumn: row.foreign_column_name,
                    onDelete: 'RESTRICT',
                    onUpdate: 'RESTRICT'
                }));

                console.log('✅ [API] Fetched table schema:', { columnsCount: columns.length, indexesCount: indexes.length, fksCount: foreignKeys.length });
                return NextResponse.json({ success: true, columns, indexes, foreignKeys });
            } finally {
                await client.end();
            }
        } else {
            return NextResponse.json(
                { error: 'Fetch table schema not supported for this type' },
                { status: 400 }
            );
        }
    } catch (error: any) {
        console.error('💥 [API] Fetch table schema error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch table schema' },
            { status: 500 }
        );
    }
}
