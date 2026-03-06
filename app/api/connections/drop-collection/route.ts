import { NextRequest, NextResponse } from 'next/server';

interface DropCollectionRequest {
    type: string;
    host: string;
    port: string;
    user?: string;
    password?: string;
    databaseName: string;
    collectionName: string;
}

export async function POST(request: NextRequest) {
    try {
        const params: DropCollectionRequest = await request.json();

        console.log('🔵 [API] Received drop collection request:', {
            type: params.type,
            host: params.host,
            databaseName: params.databaseName,
            collectionName: params.collectionName
        });

        if (!params.type || !params.host || !params.port || !params.databaseName || !params.collectionName) {
            return NextResponse.json(
                { success: false, error: 'Missing required parameters' },
                { status: 400 }
            );
        }

        if (params.type !== 'mongodb') {
            return NextResponse.json(
                { success: false, error: 'Drop collection only supported for MongoDB' },
                { status: 400 }
            );
        }

        const { MongoClient } = require('mongodb');

        // Construct connection string
        let connectionString = '';
        if (params.host.startsWith('mongodb')) {
            connectionString = params.host;
        } else {
            const auth = params.user && params.password
                ? `${encodeURIComponent(params.user)}:${encodeURIComponent(params.password)}@`
                : '';
            connectionString = `mongodb://${auth}${params.host}:${params.port}/${params.databaseName}?authSource=admin`;
        }

        console.log('🔵 [API] Connecting to MongoDB...');

        const client = new MongoClient(connectionString, {
            directConnection: true,
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 10000,
        });

        try {
            await client.connect();
            console.log('🔵 [API] Connected successfully');

            const db = client.db(params.databaseName);

            // Drop the collection
            await db.collection(params.collectionName).drop();

            console.log(`🔵 [API] ✅ Collection "${params.collectionName}" dropped successfully`);

            return NextResponse.json({
                success: true,
                message: `Collection "${params.collectionName}" dropped successfully`
            });

        } catch (mongoError: any) {
            // Handle case where collection doesn't exist
            if (mongoError.code === 26 || mongoError.codeName === 'NamespaceNotFound') {
                return NextResponse.json({
                    success: false,
                    error: `Collection "${params.collectionName}" does not exist`
                }, { status: 404 });
            }
            throw mongoError;
        } finally {
            await client.close();
            console.log('🔵 [API] Connection closed');
        }

    } catch (error: any) {
        console.error('💥 [API] Drop collection error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Failed to drop collection' },
            { status: 500 }
        );
    }
}
