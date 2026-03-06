import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import { Client as PgClient } from 'pg';
import { MongoClient } from 'mongodb';
import { createClient } from 'redis';

/**
 * Phase 5: 快速分析 API
 * 返回基础建议（< 500ms），供前端快速展示
 * 深度分析由 analyze-schema API 处理
 */

interface QuickAnalyzeRequest {
    type: string;
    host: string;
    port: string;
    user?: string;
    password?: string;
    database?: string;
}

interface QuickSuggestion {
    id: string;
    text: string;
    query: string;
    chartType: 'bar' | 'line' | 'pie' | 'table';
    description: string;
    category: string;
    priority: number;
}

// 快速 MySQL 分析
async function quickAnalyzeMySQL(params: QuickAnalyzeRequest): Promise<{
    suggestions: QuickSuggestion[];
    tableCount: number;
    database: string;
}> {
    let selectedDatabase = params.database;

    const tempConnection = await mysql.createConnection({
        host: params.host,
        port: parseInt(params.port),
        user: params.user,
        password: params.password,
        connectTimeout: 5000,  // 5秒连接超时
    });

    try {
        // 如果没有指定数据库，获取第一个用户数据库
        if (!selectedDatabase) {
            const [dbRows] = await tempConnection.query('SHOW DATABASES');
            const databases = (dbRows as any[])
                .map(row => Object.values(row)[0] as string)
                .filter(db => !['information_schema', 'mysql', 'performance_schema', 'sys'].includes(db));

            if (databases.length === 0) {
                throw new Error('No user databases found');
            }
            selectedDatabase = databases[0];
        }

        // 切换到目标数据库
        await tempConnection.changeUser({ database: selectedDatabase });

        // 快速获取表列表
        const [tablesResult] = await tempConnection.query('SHOW TABLES');
        const tableNames = (tablesResult as any[]).map(row => Object.values(row)[0] as string);

        const suggestions: QuickSuggestion[] = [];
        let id = 1;

        // 只分析前3个表，快速生成建议
        for (const tableName of tableNames.slice(0, 3)) {
            // 获取表结构
            const [columnsResult] = await tempConnection.query(`DESCRIBE \`${tableName}\``);
            const columns = columnsResult as any[];

            // 1. 基础统计
            suggestions.push({
                id: `quick_${id++}`,
                text: `查看 ${tableName} 数据总量`,
                query: `SELECT COUNT(*) as total FROM \`${tableName}\``,
                chartType: 'table',
                description: `统计 ${tableName} 表的记录数`,
                category: '数据概览',
                priority: 2
            });

            // 2. 查找数值列生成 TOP N
            const numericCol = columns.find((c: any) =>
                c.Type.toLowerCase().match(/int|decimal|float|double/) && c.Key !== 'PRI'
            );
            const labelCol = columns.find((c: any) =>
                c.Key !== 'PRI' && (!numericCol || c.Field !== numericCol.Field)
            );

            if (numericCol && labelCol) {
                suggestions.push({
                    id: `quick_${id++}`,
                    text: `${tableName} 的 ${numericCol.Field} 排行 TOP 10`,
                    query: `SELECT \`${labelCol.Field}\`, \`${numericCol.Field}\` FROM \`${tableName}\` ORDER BY \`${numericCol.Field}\` DESC LIMIT 10`,
                    chartType: 'bar',
                    description: `按 ${numericCol.Field} 降序显示前10条`,
                    category: '排行分析',
                    priority: 1
                });
            }

            // 3. 查找日期列生成趋势
            const dateCol = columns.find((c: any) =>
                c.Type.toLowerCase().includes('date') || c.Type.toLowerCase().includes('time')
            );

            if (dateCol) {
                suggestions.push({
                    id: `quick_${id++}`,
                    text: `${tableName} 数据时间趋势`,
                    query: `SELECT DATE(\`${dateCol.Field}\`) as date, COUNT(*) as count FROM \`${tableName}\` GROUP BY DATE(\`${dateCol.Field}\`) ORDER BY date DESC LIMIT 30`,
                    chartType: 'line',
                    description: `按日期统计 ${tableName} 的记录数量`,
                    category: '趋势分析',
                    priority: 1
                });
            }
        }

        // 4. 表数据量对比
        if (tableNames.length > 1) {
            suggestions.push({
                id: `quick_${id++}`,
                text: '各表数据量概览',
                query: tableNames.slice(0, 8).map(t => `SELECT '${t}' as table_name, COUNT(*) as count FROM \`${t}\``).join(' UNION ALL '),
                chartType: 'bar',
                description: '对比各表的数据量',
                category: '数据概览',
                priority: 2
            });
        }

        await tempConnection.end();

        return {
            suggestions: suggestions.slice(0, 6),  // 最多6个快速建议
            tableCount: tableNames.length,
            database: selectedDatabase!
        };

    } catch (error) {
        await tempConnection.end();
        throw error;
    }
}

// 快速 PostgreSQL 分析
async function quickAnalyzePostgres(params: QuickAnalyzeRequest): Promise<{
    suggestions: QuickSuggestion[];
    tableCount: number;
    database: string;
}> {
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
        // 获取表列表 (排除系统 schema)
        const tablesResult = await client.query(`
            SELECT table_schema, table_name 
            FROM information_schema.tables 
            WHERE table_schema NOT IN ('information_schema', 'pg_catalog') 
            AND table_type = 'BASE TABLE'
        `);
        const allTables = tablesResult.rows.map(row => ({ schema: row.table_schema, name: row.table_name }));

        const suggestions: QuickSuggestion[] = [];
        let id = 1;

        for (const table of allTables.slice(0, 3)) {
            suggestions.push({
                id: `quick_${id++}`,
                text: `查看 ${table.name} 数据总量`,
                query: `SELECT COUNT(*) as total FROM "${table.name}"`,
                chartType: 'table',
                description: `统计 ${table.name} 表的记录数`,
                category: '数据概览',
                priority: 2
            });
        }

        if (allTables.length > 1) {
            suggestions.push({
                id: `quick_${id++}`,
                text: '各表数据量概览',
                query: allTables.slice(0, 8).map(t => `SELECT '${t.name}' as table_name, COUNT(*) as count FROM "${t.name}"`).join(' UNION ALL '),
                chartType: 'bar',
                description: '对比各表的数据量',
                category: '数据概览',
                priority: 2
            });
        }

        await client.end();

        return {
            suggestions: suggestions.slice(0, 6),
            tableCount: allTables.length,
            database: selectedDatabase
        };

    } catch (error) {
        await client.end();
        throw error;
    }
}

// 快速 MongoDB 分析
async function quickAnalyzeMongoDB(params: QuickAnalyzeRequest): Promise<{
    suggestions: QuickSuggestion[];
    tableCount: number;
    database: string;
}> {
    const uri = params.user && params.password
        ? `mongodb://${params.user}:${encodeURIComponent(params.password)}@${params.host}:${params.port}`
        : `mongodb://${params.host}:${params.port}`;

    // Add connection timeout options for resilience
    const client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 5000,  // 5秒服务器选择超时
        connectTimeoutMS: 5000,           // 5秒连接超时
        socketTimeoutMS: 10000,           // 10秒 socket 超时
    });

    try {
        await client.connect();
    } catch (connectError: any) {
        console.error('[quick-analyze] MongoDB connection failed:', connectError.message);
        // Return empty suggestions instead of throwing, so the UI can still load
        return {
            suggestions: [],
            tableCount: 0,
            database: params.database || 'unknown'
        };
    }

    try {
        const db = client.db(params.database);
        const allCollections = await db.listCollections().toArray();
        // 排除系统集合
        const collections = allCollections.filter(c => !c.name.startsWith('system.'));

        const suggestions: QuickSuggestion[] = collections.slice(0, 5).map((c, i) => ({
            id: `quick_mongo_${i + 1}`,
            text: `查看 ${c.name} 集合文档数`,
            query: JSON.stringify({ collection: c.name, operation: 'count' }),
            chartType: 'table' as const,
            description: `统计 ${c.name} 的文档数量`,
            category: '数据概览',
            priority: 2
        }));

        await client.close();

        return {
            suggestions,
            tableCount: collections.length,
            database: params.database || 'default'
        };

    } catch (error) {
        await client.close();
        throw error;
    }
}

// 快速 Redis 分析
async function quickAnalyzeRedis(params: QuickAnalyzeRequest): Promise<{
    suggestions: QuickSuggestion[];
    tableCount: number;
    database: string;
}> {
    // Parse database number, default to 0 if not a valid number
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

    try {
        await client.connect();
    } catch (connectError: any) {
        console.error('[quick-analyze] Redis connection failed:', connectError.message);
        return {
            suggestions: [],
            tableCount: 0,
            database: params.database || '0'
        };
    }

    try {
        // Get database size
        const dbSize = await client.dbSize();

        // 生成 Redis 基本建议
        const suggestions: QuickSuggestion[] = [
            {
                id: 'quick_redis_1',
                text: '查看数据库键数量',
                query: 'DBSIZE',
                chartType: 'table' as const,
                description: '统计当前数据库的键总数',
                category: '数据概览',
                priority: 1
            },
            {
                id: 'quick_redis_2',
                text: '查看服务器信息',
                query: 'INFO',
                chartType: 'table' as const,
                description: '获取 Redis 服务器状态信息',
                category: '系统信息',
                priority: 2
            },
            {
                id: 'quick_redis_3',
                text: '查看内存使用情况',
                query: 'INFO memory',
                chartType: 'table' as const,
                description: '获取内存使用统计',
                category: '系统信息',
                priority: 2
            },
            {
                id: 'quick_redis_4',
                text: '扫描键列表 (前100个)',
                query: 'SCAN 0 COUNT 100',
                chartType: 'table' as const,
                description: '列出数据库中的键',
                category: '数据浏览',
                priority: 3
            }
        ];

        await client.quit();

        return {
            suggestions,
            tableCount: dbSize,
            database: params.database || '0'
        };

    } catch (error) {
        await client.quit();
        throw error;
    }
}

export async function POST(request: NextRequest) {
    try {
        const params: QuickAnalyzeRequest = await request.json();

        console.log('[quick-analyze] ⚡ Quick analysis for:', {
            type: params.type,
            host: params.host,
            database: params.database,
        });

        if (!params.type || !params.host || !params.port) {
            return NextResponse.json(
                { success: false, error: 'Missing required connection parameters' },
                { status: 400 }
            );
        }

        let result: { suggestions: QuickSuggestion[]; tableCount: number; database: string };

        switch (params.type.toLowerCase()) {
            case 'mysql':
                result = await quickAnalyzeMySQL(params);
                break;
            case 'postgres':
                result = await quickAnalyzePostgres(params);
                break;
            case 'mongodb':
                result = await quickAnalyzeMongoDB(params);
                break;
            case 'redis':
                result = await quickAnalyzeRedis(params);
                break;
            default:
                return NextResponse.json(
                    { success: false, error: 'Unsupported database type' },
                    { status: 400 }
                );
        }

        console.log('[quick-analyze] ✅ Quick analysis complete:', {
            suggestionCount: result.suggestions.length,
            tableCount: result.tableCount,
        });

        return NextResponse.json({
            success: true,
            isQuick: true,  // 标识这是快速分析结果
            ...result,
        });

    } catch (error: any) {
        console.error('[quick-analyze] ❌ Error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Quick analysis failed' },
            { status: 500 }
        );
    }
}
