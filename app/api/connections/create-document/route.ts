import { NextRequest, NextResponse } from 'next/server';

interface CreateDocumentRequest {
    type: 'mongodb';
    host: string;
    port: string;
    user?: string;
    password?: string;
    databaseName: string;
    collectionName: string;
    document: any;
}

export async function POST(request: NextRequest) {
    try {
        const params: CreateDocumentRequest = await request.json();

        console.log('🔵 [API] Received create document request:', {
            database: params.databaseName,
            collection: params.collectionName
        });

        if (!params.type || !params.host || !params.port || !params.databaseName || !params.collectionName || !params.document) {
            return NextResponse.json(
                { error: 'Missing required parameters' },
                { status: 400 }
            );
        }

        if (params.type === 'mongodb') {
            const { MongoClient } = require('mongodb');

            // Construct connection string
            let connectionString = '';
            if (params.host.startsWith('mongodb')) {
                connectionString = params.host;
            } else {
                const auth = params.user && params.password ? `${encodeURIComponent(params.user)}:${encodeURIComponent(params.password)}@` : '';
                connectionString = `mongodb://${auth}${params.host}:${params.port}/${params.databaseName}?authSource=admin&retryWrites=false`;
            }

            console.log('🔵 [API] Connection string:', connectionString.replace(/:([^:@]+)@/, ':***@'));

            const client = new MongoClient(connectionString, {
                directConnection: true,
                serverSelectionTimeoutMS: 5000,
                connectTimeoutMS: 10000,
            });

            try {
                console.log('🔵 [API] Connecting to MongoDB...');
                await client.connect();
                console.log('🔵 [API] Connected successfully');

                const db = client.db(params.databaseName);
                const collection = db.collection(params.collectionName);

                console.log('🔵 [API] Inserting document into collection:', params.collectionName);
                const result = await collection.insertOne(params.document);

                console.log('🔵 [API] ✅ Document inserted with ID:', result.insertedId);

                return NextResponse.json({
                    success: true,
                    insertedId: result.insertedId.toString()
                });
            } catch (error: any) {
                console.error('🔵 [API] ❌ MongoDB error:', error.message);
                return NextResponse.json(
                    { success: false, error: error.message },
                    { status: 500 }
                );
            } finally {
                await client.close();
                console.log('🔵 [API] Connection closed');
            }
        }

        return NextResponse.json(
            { error: 'Unsupported database type' },
            { status: 400 }
        );
    } catch (error: any) {
        console.error('🔵 [API] ❌ Error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
