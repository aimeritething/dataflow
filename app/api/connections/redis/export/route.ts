import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

interface ExportRedisRequest {
    host: string;
    port: string;
    password?: string;
    database: string;
    pattern?: string;
    types?: string[];
    format: 'csv' | 'json';
}

export async function POST(req: NextRequest) {
    try {
        const body: ExportRedisRequest = await req.json();
        const { host, port, password, database, pattern, types, format } = body;

        if (!host || !port || !database) {
            return NextResponse.json(
                { error: 'Missing required parameters' },
                { status: 400 }
            );
        }

        console.log('[Redis Export API] Received request:', { database, pattern, types, format });

        // Create a TransformStream for streaming response
        const encoder = new TextEncoder();
        const stream = new TransformStream();
        const writer = stream.writable.getWriter();

        // Start async export process
        (async () => {
            try {
                const { createClient } = require('redis');

                // Parse database number from "db0", "db1", etc.
                const dbNumber = database ? parseInt(database.replace('db', ''), 10) : 0;

                // Build Redis URL with database number
                const redisUrl = password
                    ? `redis://:${encodeURIComponent(password)}@${host}:${port}/${dbNumber}`
                    : `redis://${host}:${port}/${dbNumber}`;

                await sendProgress(writer, encoder, 10, 'Connecting to Redis...');

                const client = createClient({
                    url: redisUrl,
                    socket: { connectTimeout: 10000 }
                });

                await client.connect();

                await sendProgress(writer, encoder, 20, 'Scanning keys...');

                // Use SCAN to get keys with pattern
                const scanPattern = pattern || '*';
                const typeFilter = types && types.length > 0 ? new Set(types.map(t => t.toLowerCase())) : null;
                let allKeys: string[] = [];

                for await (const keyOrKeys of client.scanIterator({ MATCH: scanPattern, COUNT: 100 })) {
                    if (Array.isArray(keyOrKeys)) {
                        allKeys.push(...keyOrKeys);
                    } else {
                        allKeys.push(keyOrKeys);
                    }
                    // Limit to 10000 keys max for export
                    if (allKeys.length >= 10000) break;
                }

                await sendProgress(writer, encoder, 40, `Found ${allKeys.length} keys...`);

                // Apply type filtering if specified
                if (typeFilter) {
                    const keysWithTypes = await Promise.all(
                        allKeys.map(async (key) => {
                            try {
                                const keyType = await client.type(key);
                                return { key, type: keyType };
                            } catch {
                                return { key, type: 'unknown' };
                            }
                        })
                    );
                    allKeys = keysWithTypes
                        .filter(item => typeFilter.has(item.type))
                        .map(item => item.key);
                }

                await sendProgress(writer, encoder, 50, `Fetching data for ${allKeys.length} keys...`);

                // Fetch full data for each key
                const exportData: any[] = [];

                for (let i = 0; i < allKeys.length; i++) {
                    const key = allKeys[i];
                    try {
                        const keyType = await client.type(key);
                        const ttl = await client.ttl(key);

                        let value: any = null;
                        switch (keyType) {
                            case 'string':
                                value = await client.get(key);
                                break;
                            case 'hash':
                                value = await client.hGetAll(key);
                                break;
                            case 'list':
                                value = await client.lRange(key, 0, -1);
                                break;
                            case 'set':
                                value = await client.sMembers(key);
                                break;
                            case 'zset':
                                value = await client.zRangeWithScores(key, 0, -1);
                                break;
                            case 'stream':
                                value = await client.xRange(key, '-', '+', { COUNT: 100 });
                                break;
                            default:
                                value = `(unsupported type: ${keyType})`;
                        }

                        exportData.push({
                            key,
                            type: keyType,
                            value,
                            ttl: ttl > 0 ? ttl : -1
                        });
                    } catch (err: any) {
                        exportData.push({
                            key,
                            type: 'error',
                            value: err.message,
                            ttl: -1
                        });
                    }

                    // Update progress every 100 keys
                    if (i % 100 === 0) {
                        const progress = 50 + Math.floor((i / allKeys.length) * 30);
                        await sendProgress(writer, encoder, progress, `Fetching data... (${i}/${allKeys.length})`);
                    }
                }

                await client.disconnect();

                await sendProgress(writer, encoder, 85, 'Generating export file...');

                // Generate file based on format
                let fileContent: string;
                let fileName: string;
                let mimeType: string;

                if (format === 'json') {
                    fileContent = JSON.stringify(exportData, null, 2);
                    fileName = `redis_${database}_export.json`;
                    mimeType = 'application/json';
                } else {
                    // CSV format
                    fileContent = generateCSV(exportData);
                    fileName = `redis_${database}_export.csv`;
                    mimeType = 'text/csv';
                }

                await sendProgress(writer, encoder, 95, 'Saving file...');

                // Save file to temp directory
                const tempFilePath = join(tmpdir(), fileName);
                await writeFile(tempFilePath, fileContent, 'utf-8');

                // Encode the data as base64 and return it as data URL
                const base64Data = Buffer.from(fileContent, 'utf-8').toString('base64');
                const dataUrl = `data:${mimeType};base64,${base64Data}`;

                await sendProgress(writer, encoder, 100, 'Export complete!', dataUrl);

            } catch (error: any) {
                console.error('[Redis Export API] Error:', error);
                const errorData = JSON.stringify({ error: error.message });
                await writer.write(encoder.encode(`data: ${errorData}\n\n`));
            } finally {
                await writer.close();
            }
        })();

        return new NextResponse(stream.readable, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });

    } catch (error: any) {
        console.error('[Redis Export API] Request error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

async function sendProgress(
    writer: WritableStreamDefaultWriter,
    encoder: TextEncoder,
    progress: number,
    message: string,
    downloadUrl?: string
) {
    const data = JSON.stringify({
        progress,
        message,
        ...(downloadUrl && { downloadUrl })
    });
    await writer.write(encoder.encode(`data: ${data}\n\n`));
}

function generateCSV(data: any[]): string {
    const escapeCSV = (value: any): string => {
        if (value === null || value === undefined) return '';
        let str: string;
        if (typeof value === 'object') {
            str = JSON.stringify(value);
        } else {
            str = String(value);
        }
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    // Header row
    const header = 'key,type,value,ttl';

    // Data rows
    const rows = data.map(row =>
        [
            escapeCSV(row.key),
            escapeCSV(row.type),
            escapeCSV(row.value),
            escapeCSV(row.ttl)
        ].join(',')
    );

    return [header, ...rows].join('\n');
}
