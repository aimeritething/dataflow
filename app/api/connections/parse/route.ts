import { NextRequest, NextResponse } from 'next/server';

interface ParsedConnection {
    type: 'mysql' | 'postgres' | 'mongodb' | 'redis';
    host: string;
    port: string;
    user: string;
    password: string;
    database: string;
}

export async function POST(request: NextRequest) {
    try {
        const { uri } = await request.json();

        if (!uri || typeof uri !== 'string') {
            return NextResponse.json(
                { error: 'Connection URI is required' },
                { status: 400 }
            );
        }

        // Parse connection string
        const parsed = parseConnectionString(uri);

        if (!parsed) {
            return NextResponse.json(
                { error: 'Invalid connection string format' },
                { status: 400 }
            );
        }

        return NextResponse.json({ success: true, data: parsed });
    } catch (error) {
        console.error('Parse connection error:', error);
        return NextResponse.json(
            { error: 'Failed to parse connection string' },
            { status: 500 }
        );
    }
}

function parseConnectionString(uri: string): ParsedConnection | null {
    try {
        // Remove leading/trailing whitespace
        uri = uri.trim();

        // Determine the type based on the protocol
        let type: ParsedConnection['type'] | null = null;

        if (uri.startsWith('mysql://')) {
            type = 'mysql';
        } else if (uri.startsWith('postgres://') || uri.startsWith('postgresql://')) {
            type = 'postgres';
        } else if (uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://')) {
            type = 'mongodb';
        } else if (uri.startsWith('redis://') || uri.startsWith('rediss://')) {
            type = 'redis';
        }

        if (!type) {
            return null;
        }

        // Normalize protocol for URL parsing
        let normalizedUri = uri;
        if (uri.startsWith('postgresql://')) {
            normalizedUri = uri.replace('postgresql://', 'postgres://');
        }
        if (uri.startsWith('mongodb+srv://')) {
            normalizedUri = uri.replace('mongodb+srv://', 'mongodb://');
        }
        if (uri.startsWith('rediss://')) {
            normalizedUri = uri.replace('rediss://', 'redis://');
        }

        // Use URL API for parsing (treat as HTTP for parsing purposes)
        const fakeHttpUrl = normalizedUri.replace(/^(mysql|postgres|mongodb|redis):\/\//, 'http://');

        let parsedUrl: URL;
        try {
            parsedUrl = new URL(fakeHttpUrl);
        } catch {
            // Fallback to regex parsing if URL parsing fails
            return parseWithRegex(uri, type);
        }

        const host = parsedUrl.hostname;
        const port = parsedUrl.port || getDefaultPort(type);
        const user = parsedUrl.username ? decodeURIComponent(parsedUrl.username) : '';
        const password = parsedUrl.password ? decodeURIComponent(parsedUrl.password) : '';

        // Extract database from pathname (remove leading slash)
        let database = parsedUrl.pathname.slice(1);
        // Remove any query string that might have been included
        if (database.includes('?')) {
            database = database.split('?')[0];
        }

        // For Redis, if username is 'default', treat it as empty (common Redis pattern)
        const finalUser = type === 'redis' && user === 'default' ? '' : user;

        return {
            type,
            host,
            port,
            user: finalUser,
            password,
            database: database || '',
        };
    } catch (error) {
        console.error('Parse error:', error);
        return null;
    }
}

function getDefaultPort(type: ParsedConnection['type']): string {
    switch (type) {
        case 'mysql': return '3306';
        case 'postgres': return '5432';
        case 'mongodb': return '27017';
        case 'redis': return '6379';
        default: return '';
    }
}

function parseWithRegex(uri: string, type: ParsedConnection['type']): ParsedConnection | null {
    try {
        // MySQL: mysql://user:password@host:port[/database]
        if (type === 'mysql') {
            const mysqlRegex = /^mysql:\/\/([^:]+):([^@]+)@([^:\/]+):(\d+)(?:\/([^?]*))?/;
            const match = uri.match(mysqlRegex);
            if (match) {
                return {
                    type: 'mysql',
                    user: decodeURIComponent(match[1]),
                    password: decodeURIComponent(match[2]),
                    host: match[3],
                    port: match[4],
                    database: match[5] ? decodeURIComponent(match[5]) : '',
                };
            }
        }

        // PostgreSQL: postgres[ql]://user:password@host:port[/database][?options]
        if (type === 'postgres') {
            const postgresRegex = /^(?:postgres|postgresql):\/\/([^:]+):([^@]+)@([^:\/]+):(\d+)(?:\/([^?]*))?/;
            const match = uri.match(postgresRegex);
            if (match) {
                return {
                    type: 'postgres',
                    user: decodeURIComponent(match[1]),
                    password: decodeURIComponent(match[2]),
                    host: match[3],
                    port: match[4],
                    database: match[5] ? decodeURIComponent(match[5]) : '',
                };
            }
        }

        // MongoDB: mongodb[+srv]://user:password@host:port[/database][?options]
        if (type === 'mongodb') {
            const mongoRegex = /^mongodb(?:\+srv)?:\/\/([^:]+):([^@]+)@([^:\/]+):?(\d*)(?:\/([^?]*))?/;
            const match = uri.match(mongoRegex);
            if (match) {
                return {
                    type: 'mongodb',
                    user: decodeURIComponent(match[1]),
                    password: decodeURIComponent(match[2]),
                    host: match[3],
                    port: match[4] || '27017',
                    database: match[5] ? decodeURIComponent(match[5]) : '',
                };
            }
        }

        // Redis: redis[s]://[user:password@]host:port[/db]
        if (type === 'redis') {
            // Pattern 1: redis://user:password@host:port
            const redisWithCredentials = /^rediss?:\/\/([^:]+):([^@]+)@([^:\/]+):(\d+)(?:\/(\d+))?/;
            const match1 = uri.match(redisWithCredentials);
            if (match1) {
                const user = match1[1] === 'default' ? '' : decodeURIComponent(match1[1]);
                return {
                    type: 'redis',
                    user,
                    password: decodeURIComponent(match1[2]),
                    host: match1[3],
                    port: match1[4],
                    database: match1[5] || '0',
                };
            }

            // Pattern 2: redis://:password@host:port (password only)
            const redisPasswordOnly = /^rediss?:\/\/:([^@]+)@([^:\/]+):(\d+)(?:\/(\d+))?/;
            const match2 = uri.match(redisPasswordOnly);
            if (match2) {
                return {
                    type: 'redis',
                    user: '',
                    password: decodeURIComponent(match2[1]),
                    host: match2[2],
                    port: match2[3],
                    database: match2[4] || '0',
                };
            }

            // Pattern 3: redis://host:port (no auth)
            const redisNoAuth = /^rediss?:\/\/([^:\/]+):(\d+)(?:\/(\d+))?/;
            const match3 = uri.match(redisNoAuth);
            if (match3) {
                return {
                    type: 'redis',
                    user: '',
                    password: '',
                    host: match3[1],
                    port: match3[2],
                    database: match3[3] || '0',
                };
            }
        }

        return null;
    } catch (error) {
        console.error('Regex parse error:', error);
        return null;
    }
}
