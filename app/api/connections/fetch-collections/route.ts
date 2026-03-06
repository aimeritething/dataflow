import { NextRequest, NextResponse } from 'next/server';

interface FetchCollectionsRequest {
    type: 'mongodb';
    host: string;
    port: string;
    user: string;
    password: string;
    database: string;
}

export async function POST(request: NextRequest) {
    try {
        const params: FetchCollectionsRequest = await request.json();

        if (!params.type || !params.host || !params.port || !params.database) {
            return NextResponse.json(
                { error: 'Missing required connection parameters' },
                { status: 400 }
            );
        }

        if (params.type === 'mongodb') {
            console.log('[fetch-collections] 📦 MongoDB request:', {
                host: params.host,
                port: params.port,
                database: params.database,
                user: params.user
            });

            const { MongoClient } = require('mongodb');

            // Construct connection string
            let connectionString = '';
            if (params.host.startsWith('mongodb')) {
                connectionString = params.host;
            } else {
                const auth = params.user && params.password ? `${encodeURIComponent(params.user)}:${encodeURIComponent(params.password)}@` : '';
                connectionString = `mongodb://${auth}${params.host}:${params.port}/${params.database}?authSource=admin`;
            }

            console.log('[fetch-collections] 🔗 Connection string:', connectionString.replace(/:([^:@]+)@/, ':***@'));

            const client = new MongoClient(connectionString, {
                directConnection: true,
                serverSelectionTimeoutMS: 5000,
                connectTimeoutMS: 10000,
            });

            try {
                console.log('[fetch-collections] 🔌 Connecting to MongoDB...');
                await client.connect();
                console.log('[fetch-collections] ✅ Connected successfully');

                const db = client.db(params.database);
                console.log('[fetch-collections] 📋 Fetching collections from database:', params.database);

                const collectionsArray = await db.listCollections().toArray();
                const collections = collectionsArray.map((col: any) => col.name);

                console.log('[fetch-collections] ✅ Collections fetched:', collections);
                console.log('[fetch-collections] 📊 Total collections:', collections.length);

                return NextResponse.json({ success: true, collections });
            } catch (error: any) {
                console.error('[fetch-collections] ❌ MongoDB error:', error.message);
                throw error;
            } finally {
                await client.close();
                console.log('[fetch-collections] 🔌 Connection closed');
            }
        } else {
            return NextResponse.json(
                { error: 'Collections are only supported for MongoDB' },
                { status: 400 }
            );
        }
    } catch (error: any) {
        console.error('Fetch collections error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch collections' },
            { status: 500 }
        );
    }
}
