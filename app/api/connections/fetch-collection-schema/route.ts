import { NextRequest, NextResponse } from 'next/server';

interface FetchCollectionSchemaRequest {
    type: 'mongodb';
    host: string;
    port: string;
    user?: string;
    password?: string;
    databaseName: string;
    collectionName: string;
}

export async function POST(request: NextRequest) {
    try {
        const params: FetchCollectionSchemaRequest = await request.json();

        console.log('🔵 [API] Received fetch collection schema request:', {
            database: params.databaseName,
            collection: params.collectionName
        });

        if (!params.type || !params.host || !params.port || !params.databaseName || !params.collectionName) {
            return NextResponse.json(
                { error: 'Missing required connection parameters' },
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

                // Get a sample document to generate schema template
                const sampleDoc = await collection.findOne({});

                let template: any = {};

                if (sampleDoc) {
                    // Generate template from sample document
                    template = generateTemplate(sampleDoc);
                    console.log('🔵 [API] ✅ Generated template from sample document');
                } else {
                    // Return empty template if no documents exist
                    template = {
                        "field1": "",
                        "field2": ""
                    };
                    console.log('🔵 [API] ✅ No documents found, returning default template');
                }

                return NextResponse.json({
                    success: true,
                    template
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

// Helper function to generate template from a document
function generateTemplate(doc: any, depth: number = 0): any {
    const MAX_DEPTH = 3; // Prevent infinite recursion

    if (depth > MAX_DEPTH) {
        return "";
    }

    const template: any = {};

    for (const key in doc) {
        if (doc.hasOwnProperty(key)) {
            const value = doc[key];

            // Skip _id field
            if (key === '_id') {
                continue;
            }

            // Handle different types
            if (value === null) {
                template[key] = null;
            } else if (Array.isArray(value)) {
                if (value.length > 0) {
                    const firstItem = value[0];
                    if (typeof firstItem === 'object' && firstItem !== null) {
                        template[key] = [generateTemplate(firstItem, depth + 1)];
                    } else {
                        template[key] = [getDefaultValue(firstItem)];
                    }
                } else {
                    template[key] = [];
                }
            } else if (typeof value === 'object' && value !== null) {
                // Handle nested objects (but not Date, ObjectId, etc.)
                if (value.constructor.name === 'Object') {
                    template[key] = generateTemplate(value, depth + 1);
                } else {
                    template[key] = getDefaultValue(value);
                }
            } else {
                template[key] = getDefaultValue(value);
            }
        }
    }

    return template;
}

// Helper function to get default value based on type
function getDefaultValue(value: any): any {
    const type = typeof value;

    switch (type) {
        case 'string':
            return "";
        case 'number':
            return 0;
        case 'boolean':
            return false;
        case 'object':
            if (value instanceof Date) {
                return new Date().toISOString();
            }
            return null;
        default:
            return "";
    }
}
