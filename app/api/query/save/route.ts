import { NextRequest, NextResponse } from 'next/server';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

// 保存的查询文件路径
const DATA_DIR = path.join(process.cwd(), 'data');
const SAVED_QUERIES_FILE = path.join(DATA_DIR, 'saved-queries.json');

// 查询接口定义
interface SavedQuery {
    id: string;
    name: string;
    sql: string;
    connectionId: string;
    databaseName?: string;
    schemaName?: string;
    createdAt: string;
    updatedAt: string;
}

/**
 * 确保数据目录存在
 */
async function ensureDataDir() {
    if (!existsSync(DATA_DIR)) {
        await mkdir(DATA_DIR, { recursive: true });
    }
}

/**
 * 读取已保存的查询列表
 */
async function getSavedQueries(): Promise<SavedQuery[]> {
    try {
        await ensureDataDir();
        if (!existsSync(SAVED_QUERIES_FILE)) {
            return [];
        }
        const content = await readFile(SAVED_QUERIES_FILE, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        console.error('Error reading saved queries:', error);
        return [];
    }
}

/**
 * 保存查询列表到文件
 */
async function saveQueriesToFile(queries: SavedQuery[]) {
    await ensureDataDir();
    await writeFile(SAVED_QUERIES_FILE, JSON.stringify(queries, null, 2), 'utf-8');
}

/**
 * 生成唯一ID
 */
function generateId(): string {
    return `query_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// GET - 获取已保存的查询列表
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const connectionId = searchParams.get('connectionId');

        let queries = await getSavedQueries();

        // 按连接ID过滤
        if (connectionId) {
            queries = queries.filter(q => q.connectionId === connectionId);
        }

        // 按更新时间倒序排列
        queries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

        return NextResponse.json({
            success: true,
            queries,
        });
    } catch (error: any) {
        console.error('Failed to get saved queries:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Failed to get saved queries' },
            { status: 500 }
        );
    }
}

// POST - 保存新查询或更新现有查询
export async function POST(request: NextRequest) {
    try {
        const { id, name, sql, connectionId, databaseName, schemaName } = await request.json();

        if (!name || !sql) {
            return NextResponse.json(
                { success: false, error: 'Name and SQL are required' },
                { status: 400 }
            );
        }

        const queries = await getSavedQueries();
        const now = new Date().toISOString();

        if (id) {
            // 更新现有查询
            const index = queries.findIndex(q => q.id === id);
            if (index === -1) {
                return NextResponse.json(
                    { success: false, error: 'Query not found' },
                    { status: 404 }
                );
            }
            queries[index] = {
                ...queries[index],
                name,
                sql,
                databaseName,
                schemaName,
                updatedAt: now,
            };
        } else {
            // 创建新查询
            const newQuery: SavedQuery = {
                id: generateId(),
                name,
                sql,
                connectionId: connectionId || '',
                databaseName,
                schemaName,
                createdAt: now,
                updatedAt: now,
            };
            queries.push(newQuery);
        }

        await saveQueriesToFile(queries);

        return NextResponse.json({
            success: true,
            message: id ? 'Query updated successfully' : 'Query saved successfully',
        });
    } catch (error: any) {
        console.error('Failed to save query:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Failed to save query' },
            { status: 500 }
        );
    }
}

// DELETE - 删除查询
export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json(
                { success: false, error: 'Query ID is required' },
                { status: 400 }
            );
        }

        const queries = await getSavedQueries();
        const index = queries.findIndex(q => q.id === id);

        if (index === -1) {
            return NextResponse.json(
                { success: false, error: 'Query not found' },
                { status: 404 }
            );
        }

        queries.splice(index, 1);
        await saveQueriesToFile(queries);

        return NextResponse.json({
            success: true,
            message: 'Query deleted successfully',
        });
    } catch (error: any) {
        console.error('Failed to delete query:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Failed to delete query' },
            { status: 500 }
        );
    }
}
