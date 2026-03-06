import { NextRequest, NextResponse } from 'next/server';

interface FetchCollectionDataRequest {
    type: 'mongodb';
    host: string;
    port: string;
    user?: string;
    password?: string;
    databaseName: string;
    collectionName: string;
    limit?: number;
    page?: number;
    searchTerm?: string;
    filter?: any; // MongoDB filter query object
}

export async function POST(request: NextRequest) {
    try {
        const params: FetchCollectionDataRequest = await request.json();

        console.log('🔵 [API] Received fetch collection data request:', {
            database: params.databaseName,
            collection: params.collectionName,
            page: params.page || 1,
            limit: params.limit || 50,
            searchTerm: params.searchTerm || 'none'
        });

        if (!params.type || !params.host || !params.port || !params.databaseName || !params.collectionName) {
            return NextResponse.json(
                { error: 'Missing required connection parameters' },
                { status: 400 }
            );
        }

        if (params.type === 'mongodb') {
            console.log('🔵 [API] MongoDB collection data request:', {
                host: params.host,
                port: params.port,
                database: params.databaseName,
                collection: params.collectionName,
                limit: params.limit || 50,
                page: params.page || 1,
                searchTerm: params.searchTerm || 'none'
            });

            const { MongoClient } = require('mongodb');

            // Construct connection string
            let connectionString = '';
            if (params.host.startsWith('mongodb')) {
                connectionString = params.host;
            } else {
                const auth = params.user && params.password ? `${encodeURIComponent(params.user)}:${encodeURIComponent(params.password)}@` : '';
                connectionString = `mongodb://${auth}${params.host}:${params.port}/${params.databaseName}?authSource=admin`;
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

                // Build search query
                let searchQuery: any = {};
                if (params.searchTerm && params.searchTerm.trim()) {
                    const { ObjectId } = require('mongodb');
                    const searchRegex = { $regex: params.searchTerm, $options: 'i' };
                    const orConditions: any[] = [];

                    // Check if search term is a valid ObjectId
                    if (ObjectId.isValid(params.searchTerm)) {
                        try {
                            orConditions.push({ _id: new ObjectId(params.searchTerm) });
                        } catch (e) {
                            // If conversion fails, skip ObjectId search
                        }
                    }

                    // Also search by _id as string (for string _id fields)
                    orConditions.push({ _id: params.searchTerm });

                    // Get a sample document to determine field names
                    const sampleDoc = await collection.findOne({});

                    if (sampleDoc) {
                        // Recursively build search conditions for all string fields
                        const buildSearchConditions = (obj: any, prefix: string = '') => {
                            for (const key in obj) {
                                if (obj.hasOwnProperty(key)) {
                                    const value = obj[key];
                                    const fieldPath = prefix ? `${prefix}.${key}` : key;

                                    // Search string fields (including nested)
                                    if (key !== '_id') {
                                        if (typeof value === 'string') {
                                            orConditions.push({ [fieldPath]: searchRegex });
                                        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
                                            // Recursively search nested objects
                                            buildSearchConditions(value, fieldPath);
                                        }
                                    }
                                }
                            }
                        };

                        buildSearchConditions(sampleDoc);
                    }

                    if (orConditions.length > 0) {
                        searchQuery = { $or: orConditions };
                    }
                }

                // Merge with filter parameter if provided
                if (params.filter && typeof params.filter === 'object' && Object.keys(params.filter).length > 0) {
                    console.log('🔵 [API] Applying filter:', JSON.stringify(params.filter));

                    // If we already have a search query, combine with $and
                    if (Object.keys(searchQuery).length > 0) {
                        searchQuery = { $and: [searchQuery, params.filter] };
                    } else {
                        searchQuery = params.filter;
                    }
                }

                console.log('🔵 [API] Final query:', JSON.stringify(searchQuery));

                // Get total count with search filter
                const total = await collection.countDocuments(searchQuery);

                // Calculate pagination
                const page = params.page || 1;
                const limit = params.limit || 50;
                const skip = (page - 1) * limit;

                console.log('🔵 [API] Fetching documents from collection:', params.collectionName, {
                    total,
                    page,
                    limit,
                    skip,
                    searchTerm: params.searchTerm || 'none'
                });

                const documents = await collection.find(searchQuery).skip(skip).limit(limit).toArray();

                console.log('🔵 [API] ✅ Documents fetched:', documents.length);

                return NextResponse.json({
                    success: true,
                    documents,
                    total,
                    page,
                    limit
                });
            } catch (error: any) {
                console.error('🔵 [API] ❌ MongoDB error:', error.message);
                throw error;
            } finally {
                await client.close();
                console.log('🔵 [API] Connection closed');
            }
        } else {
            return NextResponse.json(
                { error: 'Collection data fetching only supported for MongoDB' },
                { status: 400 }
            );
        }
    } catch (error: any) {
        console.error('💥 [API] Fetch collection data error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch collection data' },
            { status: 500 }
        );
    }
}
