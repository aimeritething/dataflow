"use client";

import React from "react";
import { useConnections } from "@/contexts/ConnectionContext";
import { TableDetailView } from "./TableDetailView";
import { CollectionDetailView } from "./CollectionDetailView";
import { KeyDetailView } from "./KeyDetailView";
import { Database } from "lucide-react";

interface DetailViewContainerProps {
    refreshTrigger?: number;
}

export function DetailViewContainer({ refreshTrigger }: DetailViewContainerProps) {
    const { selectedItem } = useConnections();

    if (!selectedItem) {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="text-center">
                    <Database className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No Item Selected</h3>
                    <p className="text-sm text-muted-foreground">
                        Select a table, collection, or key from the sidebar to view details
                    </p>
                </div>
            </div>
        );
    }

    // Render appropriate detail view based on item type
    if (selectedItem.type === 'table') {
        return (
            <TableDetailView
                connectionId={selectedItem.connectionId || ''}
                databaseName={selectedItem.metadata?.database || ''}
                tableName={selectedItem.name}
                schema={selectedItem.metadata?.schema}
            />
        );
    }

    if (selectedItem.type === 'collection') {
        return (
            <CollectionDetailView
                connectionId={selectedItem.connectionId || ''}
                databaseName={selectedItem.metadata?.database || ''}
                collectionName={selectedItem.name}
                refreshTrigger={refreshTrigger}
            />
        );
    }

    if (selectedItem.type === 'key') {
        return (
            <KeyDetailView
                connectionId={selectedItem.connectionId || ''}
                databaseName={selectedItem.metadata?.database || ''}
                keyName={selectedItem.name}
            />
        );
    }

    // For other types (connection, database, schema), show a placeholder
    return (
        <div className="flex h-full items-center justify-center">
            <div className="text-center">
                <Database className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">{selectedItem.name}</h3>
                <p className="text-sm text-muted-foreground">
                    {selectedItem.type === 'connection' && 'Connection details'}
                    {selectedItem.type === 'database' && 'Database overview'}
                    {selectedItem.type === 'schema' && 'Schema overview'}
                </p>
            </div>
        </div>
    );
}
