import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import { Client as PgClient } from 'pg';
import { MongoClient } from 'mongodb';
import { createClient } from 'redis';

interface FilterCondition {
    column: string;
    operator: string;
    value: string;
}

// Build MySQL filter conditions
function buildMySQLFilterClause(filters: FilterCondition[]): { clause: string; params: any[] } {
    if (!filters || filters.length === 0) {
        return { clause: '', params: [] };
    }

    const conditions: string[] = [];
    const params: any[] = [];

    for (const filter of filters) {
        const column = `\`${filter.column}\``;
        const op = filter.operator.toUpperCase();

        switch (op) {
            case 'IS NULL':
                conditions.push(`${column} IS NULL`);
                break;
            case 'IS NOT NULL':
                conditions.push(`${column} IS NOT NULL`);
                break;
            case 'LIKE':
                conditions.push(`${column} LIKE ?`);
                params.push(`%${filter.value}%`);
                break;
            case 'NOT LIKE':
                conditions.push(`${column} NOT LIKE ?`);
                params.push(`%${filter.value}%`);
                break;
            case 'IN':
                // Parse comma-separated values
                const inValues = filter.value.split(',').map(v => v.trim());
                const placeholders = inValues.map(() => '?').join(', ');
                conditions.push(`${column} IN (${placeholders})`);
                params.push(...inValues);
                break;
            case '=':
            case '!=':
            case '>':
            case '>=':
            case '<':
            case '<=':
                conditions.push(`${column} ${op} ?`);
                params.push(filter.value);
                break;
            default:
                // Default to equals
                conditions.push(`${column} = ?`);
                params.push(filter.value);
        }
    }

    return {
        clause: conditions.length > 0 ? conditions.join(' AND ') : '',
        params
    };
}

// Build PostgreSQL filter conditions
function buildPostgresFilterClause(filters: FilterCondition[], startIndex: number): { clause: string; params: any[]; nextIndex: number } {
    if (!filters || filters.length === 0) {
        return { clause: '', params: [], nextIndex: startIndex };
    }

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = startIndex;

    for (const filter of filters) {
        const column = `"${filter.column}"`;
        const op = filter.operator.toUpperCase();

        switch (op) {
            case 'IS NULL':
                conditions.push(`${column} IS NULL`);
                break;
            case 'IS NOT NULL':
                conditions.push(`${column} IS NOT NULL`);
                break;
            case 'LIKE':
                conditions.push(`${column}::text ILIKE $${paramIndex++}`);
                params.push(`%${filter.value}%`);
                break;
            case 'NOT LIKE':
                conditions.push(`${column}::text NOT ILIKE $${paramIndex++}`);
                params.push(`%${filter.value}%`);
                break;
            case 'IN':
                // Parse comma-separated values
                const inValues = filter.value.split(',').map(v => v.trim());
                const placeholders = inValues.map(() => `$${paramIndex++}`).join(', ');
                conditions.push(`${column} IN (${placeholders})`);
                params.push(...inValues);
                break;
            case '=':
            case '!=':
            case '>':
            case '>=':
            case '<':
            case '<=':
                conditions.push(`${column} ${op} $${paramIndex++}`);
                params.push(filter.value);
                break;
            default:
                // Default to equals
                conditions.push(`${column} = $${paramIndex++}`);
                params.push(filter.value);
        }
    }

    return {
        clause: conditions.length > 0 ? conditions.join(' AND ') : '',
        params,
        nextIndex: paramIndex
    };
}

export async function POST(request: NextRequest) {
    try {
        const {
            type,
            host,
            port,
            user,
            password,
            database: databaseName, // Map database to databaseName if needed, or just use database
            schema,
            table, // The frontend sends 'table'
            page = 1,
            limit = 50,
            searchTerm,
            sortColumn,
            sortDirection,
            filters,
            selectedColumns
        } = await request.json();

        // Map for backward compatibility if needed, or just use the variables as they are
        const database = databaseName;
        const tableName = table;

        console.log(`[API] Fetching data for ${databaseName}.${tableName} (Page ${page})`);
        if (sortColumn) console.log(`[API] Sorting by ${sortColumn} ${sortDirection}`);
        if (filters?.length > 0) console.log(`[API] Filters:`, JSON.stringify(filters));
        if (selectedColumns?.length > 0) console.log(`[API] Selected columns:`, JSON.stringify(selectedColumns));

        const offset = (page - 1) * limit;

        if (type === 'mysql') {
            const connection = await mysql.createConnection({
                host,
                port,
                user,
                password,
                database,
            });

            try {
                // Get columns and primary key first
                const [columnsResult] = await connection.query(`SHOW COLUMNS FROM \`${table}\``);
                const columnsData = columnsResult as any[];
                const columnNames = columnsData.map((col: any) => col.Field);
                const columnTypes: Record<string, string> = {};
                columnsData.forEach((col: any) => {
                    columnTypes[col.Field] = col.Type;
                });
                const primaryKey = columnsData.find((col: any) => col.Key === 'PRI')?.Field;

                // Get foreign key columns
                const [fkResult] = await connection.query(
                    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
                     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? 
                     AND REFERENCED_TABLE_NAME IS NOT NULL`,
                    [database, table]
                );
                const foreignKeyColumns = (fkResult as any[]).map((fk: any) => fk.COLUMN_NAME);

                // Build WHERE clause combining search and filters
                let whereConditions: string[] = [];
                let queryParams: any[] = [];

                // Search term conditions
                if (searchTerm && searchTerm.trim()) {
                    const searchConditions = columnsData
                        .filter((col: any) => {
                            const colType = col.Type.toLowerCase();
                            return colType.includes('char') || colType.includes('text') || colType.includes('varchar');
                        })
                        .map((col: any) => `\`${col.Field}\` LIKE ?`);

                    if (searchConditions.length > 0) {
                        whereConditions.push(`(${searchConditions.join(' OR ')})`);
                        queryParams.push(...new Array(searchConditions.length).fill(`%${searchTerm}%`));
                    }
                }

                // Filter conditions
                const filterResult = buildMySQLFilterClause(filters);
                if (filterResult.clause) {
                    whereConditions.push(filterResult.clause);
                    queryParams.push(...filterResult.params);
                }

                const whereClause = whereConditions.length > 0 ? ` WHERE ${whereConditions.join(' AND ')}` : '';

                // Build SELECT columns
                const selectColumns = selectedColumns && selectedColumns.length > 0
                    ? selectedColumns.map((col: string) => `\`${col}\``).join(', ')
                    : '*';

                console.log(`[DB] MySQL query: SELECT ${selectColumns} FROM \`${table}\`${whereClause} LIMIT ${limit} OFFSET ${offset}`);
                console.log(`[DB] MySQL params:`, queryParams);

                // Get total count with filters
                const countQuery = `SELECT COUNT(*) as total FROM \`${table}\`${whereClause}`;
                const [countRows] = await connection.query(countQuery, queryParams);
                const total = (countRows as any[])[0].total;

                // Get data with filters and sorting
                let orderByClause = '';
                if (sortColumn && sortDirection) {
                    orderByClause = ` ORDER BY \`${sortColumn}\` ${sortDirection.toUpperCase()}`;
                }
                const dataQuery = `SELECT ${selectColumns} FROM \`${table}\`${whereClause}${orderByClause} LIMIT ${limit} OFFSET ${offset}`;
                const [rows] = await connection.query(dataQuery, queryParams);

                await connection.end();

                return NextResponse.json({
                    success: true,
                    data: {
                        columns: columnNames,
                        columnTypes,
                        primaryKey,
                        foreignKeyColumns,
                        rows: rows,
                        total,
                        page,
                        limit,
                    },
                });
            } catch (error: any) {
                await connection.end();
                throw error;
            }
        }

        if (type === 'postgres' || type === 'postgresql') {
            const client = new PgClient({
                host,
                port,
                user,
                password,
                database,
            });

            try {
                await client.connect();
                const schemaName = schema || 'public';

                // Get text-based columns for dynamic search first
                const colTypeResult = await client.query(
                    `SELECT column_name, data_type 
                     FROM information_schema.columns 
                     WHERE table_schema = $1 AND table_name = $2 
                     ORDER BY ordinal_position`,
                    [schemaName, table]
                );

                // Build WHERE clause combining search and filters
                let whereConditions: string[] = [];
                let queryParams: any[] = [];
                let paramIndex = 1;

                // Search term conditions
                if (searchTerm && searchTerm.trim()) {
                    const searchConditions = colTypeResult.rows
                        .filter((col: any) => {
                            const colType = col.data_type.toLowerCase();
                            return colType.includes('char') || colType.includes('text');
                        })
                        .map((col: any) => {
                            const condition = `"${col.column_name}"::text ILIKE $${paramIndex++}`;
                            queryParams.push(`%${searchTerm}%`);
                            return condition;
                        });

                    if (searchConditions.length > 0) {
                        whereConditions.push(`(${searchConditions.join(' OR ')})`);
                    }
                }

                // Filter conditions
                const filterResult = buildPostgresFilterClause(filters, paramIndex);
                if (filterResult.clause) {
                    whereConditions.push(filterResult.clause);
                    queryParams.push(...filterResult.params);
                    paramIndex = filterResult.nextIndex;
                }

                const whereClause = whereConditions.length > 0 ? ` WHERE ${whereConditions.join(' AND ')}` : '';

                // Build SELECT columns
                const selectColumns = selectedColumns && selectedColumns.length > 0
                    ? selectedColumns.map((col: string) => `"${col}"`).join(', ')
                    : '*';

                console.log(`[DB] PostgreSQL query: SELECT ${selectColumns} FROM "${schemaName}"."${table}"${whereClause} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`);
                console.log(`[DB] PostgreSQL params:`, [...queryParams, limit, offset]);

                // Get total count with filters
                const countQuery = `SELECT COUNT(*) as total FROM "${schemaName}"."${table}"${whereClause}`;
                const countResult = await client.query(countQuery, queryParams);
                const total = parseInt(countResult.rows[0].total);

                // Get columns with types
                const columns = colTypeResult.rows.map((row: any) => row.column_name);
                const columnTypes: Record<string, string> = {};
                colTypeResult.rows.forEach((row: any) => {
                    columnTypes[row.column_name] = row.data_type;
                });

                // Get Primary Key
                const pkResult = await client.query(
                    `SELECT ccu.column_name
                     FROM information_schema.table_constraints tc 
                     JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name 
                     AND tc.table_schema = ccu.table_schema 
                     WHERE tc.constraint_type = 'PRIMARY KEY' 
                     AND tc.table_name = $1
                     AND tc.table_schema = $2`,
                    [table, schemaName]
                );
                const primaryKey = pkResult.rows[0]?.column_name;

                // Get foreign key columns
                const fkResult = await client.query(
                    `SELECT kcu.column_name
                     FROM information_schema.table_constraints tc
                     JOIN information_schema.key_column_usage kcu
                         ON tc.constraint_name = kcu.constraint_name
                         AND tc.table_schema = kcu.table_schema
                     WHERE tc.constraint_type = 'FOREIGN KEY'
                     AND tc.table_name = $1
                     AND tc.table_schema = $2`,
                    [table, schemaName]
                );
                const foreignKeyColumns = fkResult.rows.map((row: any) => row.column_name);

                // Get data with filters and sorting
                let orderByClause = '';
                if (sortColumn && sortDirection) {
                    orderByClause = ` ORDER BY "${sortColumn}" ${sortDirection.toUpperCase()}`;
                }
                const allParams = [...queryParams, limit, offset];
                const dataQuery = `SELECT ${selectColumns} FROM "${schemaName}"."${table}"${whereClause}${orderByClause} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
                const dataResult = await client.query(dataQuery, allParams);

                await client.end();

                return NextResponse.json({
                    success: true,
                    data: {
                        columns,
                        columnTypes,
                        primaryKey,
                        foreignKeyColumns,
                        rows: dataResult.rows,
                        total,
                        page,
                        limit,
                    },
                });
            } catch (error: any) {
                await client.end();
                throw error;
            }
        }

        if (type === 'mongodb') {
            // Construct URI based on whether authentication is provided
            let uri: string;
            if (user && password) {
                uri = `mongodb://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
            } else {
                uri = `mongodb://${host}:${port}/${database}`;
            }

            const client = new MongoClient(uri);

            try {
                await client.connect();
                const db = client.db(database);
                const collection = db.collection(table);

                const total = await collection.countDocuments();
                const documents = await collection.find().skip(offset).limit(limit).toArray();

                await client.close();

                // Get all unique keys from documents
                const allKeys = new Set<string>();
                documents.forEach(doc => {
                    Object.keys(doc).forEach(key => allKeys.add(key));
                });
                const columns = Array.from(allKeys);

                return NextResponse.json({
                    success: true,
                    data: {
                        columns,
                        rows: documents,
                        total,
                        page,
                        limit,
                    },
                });
            } catch (error: any) {
                try {
                    await client.close();
                } catch (closeError) {
                    // Ignore close errors
                }
                throw error;
            }
        }

        if (type === 'redis') {
            const client = createClient({
                socket: { host, port },
                password: password || undefined,
                database: database ? parseInt(database.replace('db', '')) : 0,
            });

            try {
                await client.connect();

                // Extract pattern from table (e.g., "session:*")
                const pattern = table.replace('*', '*');
                const keys = await client.keys(pattern);
                const total = keys.length;

                // Paginate keys
                const paginatedKeys = keys.slice(offset, offset + limit);

                // Fetch key data
                const rows = await Promise.all(
                    paginatedKeys.map(async (key) => {
                        const type = await client.type(key);
                        const ttl = await client.ttl(key);
                        let value = '';

                        if (type === 'string') {
                            value = await client.get(key) || '';
                        } else if (type === 'hash') {
                            value = JSON.stringify(await client.hGetAll(key));
                        } else if (type === 'list') {
                            value = JSON.stringify(await client.lRange(key, 0, -1));
                        } else if (type === 'set') {
                            value = JSON.stringify(await client.sMembers(key));
                        } else if (type === 'zset') {
                            value = JSON.stringify(await client.zRange(key, 0, -1));
                        }

                        return { key, type, ttl, value: value.substring(0, 100) + (value.length > 100 ? '...' : '') };
                    })
                );

                await client.quit();

                return NextResponse.json({
                    success: true,
                    data: {
                        columns: ['key', 'type', 'ttl', 'value'],
                        rows,
                        total,
                        page,
                        limit,
                    },
                });
            } catch (error: any) {
                await client.quit();
                throw error;
            }
        }

        return NextResponse.json({ error: 'Unsupported database type' }, { status: 400 });
    } catch (error: any) {
        console.error('Fetch table data error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch table data' },
            { status: 500 }
        );
    }
}
