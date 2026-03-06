import { NextRequest, NextResponse } from 'next/server';
import { MongoClient, ObjectId } from 'mongodb';

interface DeleteDocumentRequest {
    type: 'mongodb';
    host: string;
    port: string;
    user?: string;
    password?: string;
    databaseName: string;
    collectionName: string;
    documentId: string; // The _id of the document to delete
}

export async function POST(request: NextRequest) {
    try {
        const params: DeleteDocumentRequest = await request.json();

        console.log('[delete-document] 🗑️ Delete request:', {
            database: params.databaseName,
            collection: params.collectionName,
            documentId: params.documentId
        });

        if (!params.type || !params.host || !params.port || !params.databaseName || !params.collectionName || !params.documentId) {
            return NextResponse.json(
                { error: 'Missing required connection parameters' },
                { status: 400 }
            );
        }

        if (params.type === 'mongodb') {
            // Construct connection string
            let connectionString = '';
            if (params.host.startsWith('mongodb')) {
                connectionString = params.host;
            } else {
                const auth = params.user && params.password ? `${encodeURIComponent(params.user)}:${encodeURIComponent(params.password)}@` : '';
                connectionString = `mongodb://${auth}${params.host}:${params.port}/${params.databaseName}?authSource=admin&retryWrites=false`;
            }

            const client = new MongoClient(connectionString, {
                directConnection: true,
                serverSelectionTimeoutMS: 5000,
                connectTimeoutMS: 10000,
            });

            try {
                await client.connect();
                const db = client.db(params.databaseName);
                const collection = db.collection(params.collectionName);

                // Convert documentId to ObjectId if possible
                let filter: any = { _id: params.documentId };
                try {
                    if (ObjectId.isValid(params.documentId)) {
                        filter = { _id: new ObjectId(params.documentId) };
                    }
                } catch (e) {
                    // Keep as string if not valid ObjectId
                }

                const result = await collection.deleteOne(filter);

                console.log('[delete-document] ✅ MongoDB delete result:', result);

                if (result.deletedCount === 0) {
                    return NextResponse.json(
                        { error: 'Document not found' },
                        { status: 404 }
                    );
                }

                return NextResponse.json({
                    success: true,
                    message: 'Document deleted successfully',
                    deletedCount: result.deletedCount
                });
            } finally {
                await client.close();
            }
        } else {
            return NextResponse.json(
                { error: 'Unsupported database type' },
                { status: 400 }
            );
        }
    } catch (error: any) {
        console.error('[delete-document] ❌ Error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to delete document' },
            { status: 500 }
        );
    }
}
