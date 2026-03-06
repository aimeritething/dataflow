import { NextRequest, NextResponse } from 'next/server';
import { executePostgresQuery, executeMySQLQuery, executeMongoDBQuery, executeRedisCommand } from '@/lib/database/connections';

export async function POST(request: NextRequest) {
    try {
        const { connectionId, database, schema, query, connection } = await request.json();

        if (!connectionId || !query) {
            return NextResponse.json(
                { success: false, error: 'Missing required parameters' },
                { status: 400 }
            );
        }

        // In production, fetch connection from database by connectionId
        // For now, we expect the connection object to be passed from frontend
        if (!connection) {
            return NextResponse.json(
                { success: false, error: 'Connection details not provided' },
                { status: 400 }
            );
        }

        let result: any;

        switch (connection.type) {
            case 'POSTGRES':
                result = await executePostgresQuery(connection, query, database);
                break;

            case 'MYSQL':
                result = await executeMySQLQuery(connection, query, database);
                break;

            case 'MONGODB':
                result = await executeMongoDBQuery(connection, query, database);
                break;

            case 'REDIS':
                result = await executeRedisCommand(connection, query);
                break;

            default:
                result = {
                    success: false,
                    error: 'Unsupported database type',
                };
        }

        return NextResponse.json(result);
    } catch (error: any) {
        console.error('Query execution error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
