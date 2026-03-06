import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import { Client as PgClient } from 'pg';
import { MongoClient } from 'mongodb';
import { createClient } from 'redis';

interface ExecuteSuggestionRequest {
    type: string;
    host: string;
    port: string;
    user?: string;
    password?: string;
    database?: string;
    query: string;
    chartType: 'bar' | 'line' | 'pie' | 'table';
}

interface QueryResult {
    columns: string[];
    rows: any[];
    chartData?: {
        xAxis: string[];
        series: { name: string; data: number[] }[];
    };
}

// 执行 MySQL 查询
async function executeMySQLQuery(params: ExecuteSuggestionRequest): Promise<QueryResult> {
    // 如果没有指定数据库，先获取第一个可用的用户数据库
    let selectedDatabase = params.database;

    if (!selectedDatabase) {
        const tempConnection = await mysql.createConnection({
            host: params.host,
            port: parseInt(params.port),
            user: params.user,
            password: params.password,
        });

        try {
            const [dbRows] = await tempConnection.query('SHOW DATABASES');
            const databases = (dbRows as any[])
                .map(row => Object.values(row)[0] as string)
                .filter(db => !['information_schema', 'mysql', 'performance_schema', 'sys'].includes(db));

            if (databases.length === 0) {
                await tempConnection.end();
                throw new Error('No user databases found');
            }

            selectedDatabase = databases[0];
        } finally {
            await tempConnection.end();
        }
    }

    const connection = await mysql.createConnection({
        host: params.host,
        port: parseInt(params.port),
        user: params.user,
        password: params.password,
        database: selectedDatabase,
    });

    try {
        const [rows, fields] = await connection.query(params.query);
        await connection.end();

        const columns = (fields as any[]).map(f => f.name);
        const rowsArray = rows as any[];

        // 生成图表数据
        const chartData = generateChartData(columns, rowsArray, params.chartType);

        return {
            columns,
            rows: rowsArray,
            chartData,
        };
    } catch (error) {
        await connection.end();
        throw error;
    }
}

// 执行 PostgreSQL 查询
async function executePostgresQuery(params: ExecuteSuggestionRequest): Promise<QueryResult> {
    const selectedDatabase = params.database || 'postgres';

    const client = new PgClient({
        host: params.host,
        port: parseInt(params.port),
        user: params.user,
        password: params.password,
        database: selectedDatabase,
    });

    await client.connect();

    try {
        const result = await client.query(params.query);
        await client.end();

        const columns = result.fields.map(f => f.name);
        const rows = result.rows;

        const chartData = generateChartData(columns, rows, params.chartType);

        return {
            columns,
            rows,
            chartData,
        };
    } catch (error) {
        await client.end();
        throw error;
    }
}

// 执行 MongoDB 查询
async function executeMongoDBQuery(params: ExecuteSuggestionRequest): Promise<QueryResult> {
    const uri = params.user && params.password
        ? `mongodb://${params.user}:${encodeURIComponent(params.password)}@${params.host}:${params.port}`
        : `mongodb://${params.host}:${params.port}`;

    const client = new MongoClient(uri);
    await client.connect();

    try {
        const db = client.db(params.database);
        const queryObj = JSON.parse(params.query);

        let rows: any[] = [];

        if (queryObj.operation === 'count') {
            const count = await db.collection(queryObj.collection).countDocuments();
            rows = [{ count }];
        } else if (queryObj.operation === 'aggregate') {
            rows = await db.collection(queryObj.collection).aggregate(queryObj.pipeline).toArray();
        } else if (queryObj.operation === 'find') {
            rows = await db.collection(queryObj.collection).find(queryObj.filter || {}).limit(100).toArray();
        }

        await client.close();

        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        const chartData = generateChartData(columns, rows, params.chartType);

        return {
            columns,
            rows,
            chartData,
        };
    } catch (error) {
        await client.close();
        throw error;
    }
}

// 执行 Redis 命令
async function executeRedisQuery(params: ExecuteSuggestionRequest): Promise<QueryResult> {
    // Parse database number from 'db6' format
    const dbIndex = params.database ? parseInt(params.database.replace(/\D/g, '')) || 0 : 0;

    const client = createClient({
        socket: {
            host: params.host,
            port: parseInt(params.port),
            connectTimeout: 5000,
        },
        password: params.password || undefined,
        database: dbIndex,
    });

    await client.connect();

    try {
        const query = params.query.trim();
        const parts = query.split(/\s+/);
        const command = parts[0].toUpperCase();
        const args = parts.slice(1);

        let rows: any[] = [];
        let columns: string[] = [];

        switch (command) {
            case 'DBSIZE': {
                const size = await client.dbSize();
                rows = [{ '键数量': size }];
                columns = ['键数量'];
                break;
            }
            case 'INFO': {
                const section = args[0] || undefined;
                const info = await client.info(section);
                // Parse INFO output into key-value pairs
                const lines = info.split('\n').filter(line => line && !line.startsWith('#'));
                rows = lines.map(line => {
                    const [key, value] = line.split(':');
                    return { '属性': key?.trim(), '值': value?.trim() };
                }).filter(r => r['属性']);
                columns = ['属性', '值'];
                break;
            }
            case 'SCAN': {
                const cursor = args[0] || '0';
                const countArg = args.indexOf('COUNT');
                const count = countArg >= 0 ? parseInt(args[countArg + 1]) || 100 : 100;
                const scanResult = await client.scan(cursor, { COUNT: count });
                rows = scanResult.keys.map((key, i) => ({ '序号': i + 1, '键名': key }));
                columns = ['序号', '键名'];
                break;
            }
            case 'GET': {
                const key = args[0];
                if (key) {
                    const value = await client.get(key);
                    rows = [{ '键': key, '值': value || '(nil)' }];
                    columns = ['键', '值'];
                }
                break;
            }
            case 'KEYS': {
                const pattern = args[0] || '*';
                const keys = await client.keys(pattern);
                rows = keys.slice(0, 100).map((key, i) => ({ '序号': i + 1, '键名': key }));
                columns = ['序号', '键名'];
                break;
            }
            case 'SLOWLOG': {
                // SLOWLOG GET [count]
                const count = args[1] ? parseInt(args[1]) : 10;
                const slowlog = await client.slowLog('GET', count);
                if (slowlog && Array.isArray(slowlog)) {
                    rows = slowlog.map((entry: any, i: number) => ({
                        '序号': i + 1,
                        'ID': entry.id,
                        '执行时间(微秒)': entry.durationMicros,
                        '命令': entry.command?.join(' '),
                        '客户端': entry.clientAddress || '',
                    }));
                    columns = ['序号', 'ID', '执行时间(微秒)', '命令', '客户端'];
                } else {
                    rows = [{ '信息': '无慢查询记录' }];
                    columns = ['信息'];
                }
                break;
            }
            default: {
                // Try to execute as raw command
                try {
                    const result = await client.sendCommand([command, ...args]);
                    if (typeof result === 'string' || typeof result === 'number') {
                        rows = [{ '结果': result }];
                        columns = ['结果'];
                    } else if (Array.isArray(result)) {
                        rows = result.map((item, i) => ({ '序号': i + 1, '值': String(item) }));
                        columns = ['序号', '值'];
                    } else {
                        rows = [{ '结果': JSON.stringify(result) }];
                        columns = ['结果'];
                    }
                } catch {
                    rows = [{ '错误': `不支持的命令: ${command}` }];
                    columns = ['错误'];
                }
            }
        }

        await client.quit();

        return {
            columns,
            rows,
            chartData: undefined, // Redis commands typically return table data
        };
    } catch (error) {
        await client.quit();
        throw error;
    }
}

// 生成图表数据
function generateChartData(
    columns: string[],
    rows: any[],
    chartType: 'bar' | 'line' | 'pie' | 'table'
): { xAxis: string[]; series: { name: string; data: number[] }[] } | undefined {
    if (chartType === 'table' || rows.length === 0 || columns.length < 1) {
        return undefined;
    }

    // 假设第一列是标签，其余列是数值
    const labelColumn = columns[0];
    const valueColumns = columns.slice(1).filter(col => {
        // 检查是否是数值列
        return rows.some(row => typeof row[col] === 'number' || !isNaN(parseFloat(row[col])));
    });

    if (valueColumns.length === 0) {
        // 如果没有数值列，尝试使用所有列
        return undefined;
    }

    const xAxis = rows.map(row => String(row[labelColumn] || ''));
    const series = valueColumns.map(col => ({
        name: col,
        data: rows.map(row => {
            const val = row[col];
            return typeof val === 'number' ? val : parseFloat(val) || 0;
        }),
    }));

    return { xAxis, series };
}

export async function POST(request: NextRequest) {
    try {
        const params: ExecuteSuggestionRequest = await request.json();

        console.log('[execute-suggestion] 🚀 Executing query:', {
            type: params.type,
            database: params.database,
            chartType: params.chartType,
            queryPreview: params.query.substring(0, 100),
        });

        if (!params.type || !params.host || !params.port || !params.query) {
            return NextResponse.json(
                { success: false, error: 'Missing required parameters' },
                { status: 400 }
            );
        }

        let result: QueryResult;

        switch (params.type.toLowerCase()) {
            case 'mysql':
                result = await executeMySQLQuery(params);
                break;
            case 'postgres':
                result = await executePostgresQuery(params);
                break;
            case 'mongodb':
                result = await executeMongoDBQuery(params);
                break;
            case 'redis':
                result = await executeRedisQuery(params);
                break;
            default:
                return NextResponse.json(
                    { success: false, error: 'Unsupported database type' },
                    { status: 400 }
                );
        }

        console.log('[execute-suggestion] ✅ Query executed:', {
            rowCount: result.rows.length,
            hasChartData: !!result.chartData,
        });

        return NextResponse.json({
            success: true,
            ...result,
        });

    } catch (error: any) {
        console.error('[execute-suggestion] ❌ Error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Failed to execute query' },
            { status: 500 }
        );
    }
}
