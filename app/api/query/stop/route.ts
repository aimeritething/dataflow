import { NextRequest, NextResponse } from 'next/server';

// 用于存储正在运行的查询的AbortController
// 在生产环境中，这应该使用Redis或其他分布式存储
const runningQueries: Map<string, AbortController> = new Map();

/**
 * 注册一个新的查询
 */
export function registerQuery(queryId: string): AbortController {
    const controller = new AbortController();
    runningQueries.set(queryId, controller);
    return controller;
}

/**
 * 取消注册查询
 */
export function unregisterQuery(queryId: string) {
    runningQueries.delete(queryId);
}

/**
 * 获取查询的AbortController
 */
export function getQueryController(queryId: string): AbortController | undefined {
    return runningQueries.get(queryId);
}

// POST - 停止正在运行的查询
export async function POST(request: NextRequest) {
    try {
        const { queryId } = await request.json();

        if (!queryId) {
            return NextResponse.json(
                { success: false, error: 'Query ID is required' },
                { status: 400 }
            );
        }

        const controller = runningQueries.get(queryId);

        if (!controller) {
            return NextResponse.json(
                { success: false, error: 'Query not found or already completed' },
                { status: 404 }
            );
        }

        // 发送取消信号
        controller.abort();
        runningQueries.delete(queryId);

        return NextResponse.json({
            success: true,
            message: 'Query cancellation requested',
        });
    } catch (error: any) {
        console.error('Failed to stop query:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Failed to stop query' },
            { status: 500 }
        );
    }
}
