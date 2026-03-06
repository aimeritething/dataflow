"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface Connection {
    id: string;
    name: string;
    type: 'MYSQL' | 'POSTGRES' | 'MONGODB' | 'REDIS';
    host: string;
    port: string;
    user: string;
    password: string;
    database: string;
    createdAt: string;
}

export type SelectedItemType = 'connection' | 'database' | 'schema' | 'table' | 'collection' | 'key' | 'redis_keys_list' | null;

export interface SelectedItem {
    type: SelectedItemType;
    id: string;
    name: string;
    parentId?: string;
    connectionId?: string;
    metadata?: any;
}

interface ConnectionContextType {
    connections: Connection[];
    selectedItem: SelectedItem | null;
    addConnection: (connection: Omit<Connection, 'id' | 'createdAt'>) => void;
    removeConnection: (id: string) => void;
    updateConnection: (id: string, updates: Partial<Connection>) => void;
    editConnection: (id: string, updates: Partial<Connection>) => void;
    createDatabase: (connectionId: string, databaseName: string, charset: string, collation: string) => Promise<boolean>;
    updateDatabase: (connectionId: string, databaseName: string, newName: string) => Promise<boolean>;
    deleteDatabase: (connectionId: string, databaseName: string) => Promise<boolean>;
    createTable: (connectionId: string, databaseName: string, tableName: string, columns: any[]) => Promise<boolean>;
    updateTable: (connectionId: string, databaseName: string, tableName: string, columns: any[]) => Promise<boolean>;
    deleteTable: (connectionId: string, databaseName: string, tableName: string) => Promise<boolean>;
    selectItem: (item: SelectedItem | null) => void;
    fetchDatabases: (connectionId: string) => Promise<string[]>;
    fetchSchemas: (connectionId: string, database: string) => Promise<string[]>;
    fetchTables: (connectionId: string, database: string, schema?: string) => Promise<string[]>;
}

const ConnectionContext = createContext<ConnectionContextType | undefined>(undefined);

export function ConnectionProvider({ children }: { children: ReactNode }) {
    const [connections, setConnections] = useState<Connection[]>([]);
    const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);

    // Default connections
    const defaultConnections: Connection[] = [
        {
            id: 'default-mysql',
            name: 'mysql',
            type: 'MYSQL',
            host: 'dbconn.sealosbja.site',
            port: '43555',
            user: 'root',
            password: 'jm8bwh44',
            database: '',
            createdAt: new Date().toISOString(),
        },
        {
            id: 'default-pg',
            name: 'pg',
            type: 'POSTGRES',
            host: 'dbconn.sealosbja.site',
            port: '40057',
            user: 'postgres',
            password: 'zhn22hdq',
            database: '',
            createdAt: new Date().toISOString(),
        },
        {
            id: 'default-mongo',
            name: 'mongo',
            type: 'MONGODB',
            host: 'dbconn.sealosbja.site',
            port: '43859',
            user: 'root',
            password: '692hsvlp',
            database: '',
            createdAt: new Date().toISOString(),
        },
        {
            id: 'default-redis',
            name: 'redis',
            type: 'REDIS',
            host: 'dbconn.sealosbja.site',
            port: '49606',
            user: 'default',
            password: 'fgg7pww5',
            database: '',
            createdAt: new Date().toISOString(),
        },
    ];

    // Load connections from localStorage on mount
    useEffect(() => {
        const stored = localStorage.getItem('dataflow_connections');
        let userConnections: Connection[] = [];

        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                // Filter out connections that are not default ones (user-added connections)
                userConnections = parsed.filter((c: Connection) =>
                    !['default-mysql', 'default-pg', 'default-mongo', 'default-redis'].includes(c.id)
                );
            } catch (error) {
                console.error('Failed to parse stored connections:', error);
            }
        }

        // Always include default connections first, then user connections
        setConnections([...defaultConnections, ...userConnections]);
        setIsLoaded(true);
    }, []);

    // Save connections to localStorage whenever they change
    useEffect(() => {
        if (isLoaded) {
            // Only save non-default connections to localStorage
            const userConnections = connections.filter(c =>
                !['default-mysql', 'default-pg', 'default-mongo', 'default-redis'].includes(c.id)
            );
            localStorage.setItem('dataflow_connections', JSON.stringify(userConnections));
        }
    }, [connections, isLoaded]);

    const addConnection = (connection: Omit<Connection, 'id' | 'createdAt'>) => {
        const newConnection: Connection = {
            ...connection,
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
        };
        setConnections((prev) => [...prev, newConnection]);
    };

    const removeConnection = (id: string) => {
        setConnections((prev) => prev.filter((c) => c.id !== id));
        if (selectedItem?.id === id || selectedItem?.connectionId === id) {
            setSelectedItem(null);
        }
    };

    const updateConnection = (id: string, updates: Partial<Connection>) => {
        setConnections((prev) =>
            prev.map((c) => (c.id === id ? { ...c, ...updates } : c))
        );
    };

    const editConnection = (id: string, updates: Partial<Connection>) => {
        updateConnection(id, updates);
    };

    const createDatabase = async (connectionId: string, databaseName: string, charset: string, collation: string): Promise<boolean> => {
        const conn = connections.find(c => c.id === connectionId);
        if (!conn) return false;

        try {
            const response = await fetch('/api/connections/create-database', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: conn.type.toLowerCase(),
                    host: conn.host,
                    port: conn.port,
                    user: conn.user,
                    password: conn.password,
                    databaseName,
                    charset,
                    collation
                }),
            });

            const data = await response.json();

            if (data.success) {
                return true;
            } else {
                console.error('Failed to create database:', data.error);
                return false;
            }
        } catch (error) {
            console.error('Error creating database:', error);
            return false;
        }
    };

    const updateDatabase = async (connectionId: string, databaseName: string, newName: string): Promise<boolean> => {
        const conn = connections.find(c => c.id === connectionId);
        if (!conn) return false;

        try {
            const response = await fetch('/api/connections/update-database', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: conn.type.toLowerCase(),
                    host: conn.host,
                    port: conn.port,
                    user: conn.user,
                    password: conn.password,
                    databaseName,
                    newName
                }),
            });

            const data = await response.json();
            if (data.success) {
                return true;
            } else {
                console.error('Failed to update database:', data.error);
                return false;
            }
        } catch (error) {
            console.error('Error updating database:', error);
            return false;
        }
    };

    const deleteDatabase = async (connectionId: string, databaseName: string): Promise<boolean> => {
        const conn = connections.find(c => c.id === connectionId);
        if (!conn) return false;

        try {
            const response = await fetch('/api/connections/delete-database', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: conn.type.toLowerCase(),
                    host: conn.host,
                    port: conn.port,
                    user: conn.user,
                    password: conn.password,
                    databaseName
                }),
            });

            const data = await response.json();
            if (data.success) {
                return true;
            } else {
                console.error('Failed to delete database:', data.error);
                return false;
            }
        } catch (error) {
            console.error('Error deleting database:', error);
            return false;
        }
    };

    const createTable = async (connectionId: string, databaseName: string, tableName: string, columns: any[]): Promise<boolean> => {
        console.log('🚀 [CREATE TABLE] Starting table creation...');
        console.log('📋 Parameters:', {
            connectionId,
            databaseName,
            tableName,
            columnsCount: columns.length
        });
        console.log('📊 Columns:', columns);

        const conn = connections.find(c => c.id === connectionId);
        if (!conn) {
            console.error('❌ [CREATE TABLE] Connection not found:', connectionId);
            return false;
        }

        console.log('🔌 [CREATE TABLE] Connection found:', {
            name: conn.name,
            type: conn.type,
            host: conn.host
        });

        try {
            const requestBody = {
                type: conn.type.toLowerCase(),
                host: conn.host,
                port: conn.port,
                user: conn.user,
                password: conn.password,
                databaseName,
                tableName,
                columns
            };

            console.log('📤 [CREATE TABLE] Sending request to /api/connections/create-table');
            console.log('📦 Request body:', JSON.stringify(requestBody, null, 2));

            const response = await fetch('/api/connections/create-table', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });

            console.log('📥 [CREATE TABLE] Response status:', response.status, response.statusText);

            const data = await response.json();
            console.log('📋 [CREATE TABLE] Response data:', data);

            if (data.success) {
                console.log('✅ [CREATE TABLE] Table created successfully!');
                return true;
            } else {
                console.error('❌ [CREATE TABLE] Failed to create table:', data.error);
                return false;
            }
        } catch (error) {
            console.error('💥 [CREATE TABLE] Error:', error);
            return false;
        }
    };

    const updateTable = async (connectionId: string, databaseName: string, tableName: string, columns: any[]): Promise<boolean> => {
        const conn = connections.find(c => c.id === connectionId);
        if (!conn) return false;

        try {
            const response = await fetch('/api/connections/update-table', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: conn.type.toLowerCase(),
                    host: conn.host,
                    port: conn.port,
                    user: conn.user,
                    password: conn.password,
                    databaseName,
                    tableName,
                    columns
                }),
            });

            const data = await response.json();
            if (data.success) {
                return true;
            } else {
                console.error('Failed to update table:', data.error);
                return false;
            }
        } catch (error) {
            console.error('Error updating table:', error);
            return false;
        }
    };

    const deleteTable = async (connectionId: string, databaseName: string, tableName: string): Promise<boolean> => {
        const conn = connections.find(c => c.id === connectionId);
        if (!conn) return false;

        try {
            const response = await fetch('/api/connections/delete-table', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: conn.type.toLowerCase(),
                    host: conn.host,
                    port: conn.port,
                    user: conn.user,
                    password: conn.password,
                    databaseName,
                    tableName
                }),
            });

            const data = await response.json();
            if (data.success) {
                return true;
            } else {
                console.error('Failed to delete table:', data.error);
                return false;
            }
        } catch (error) {
            console.error('Error deleting table:', error);
            return false;
        }
    };


    const selectItem = (item: SelectedItem | null) => {
        setSelectedItem(item);
    };

    // Real data fetchers
    const fetchDatabases = async (connectionId: string): Promise<string[]> => {
        const conn = connections.find(c => c.id === connectionId);
        if (!conn) {
            // Connection was deleted, return empty array silently
            return [];
        }

        const response = await fetch('/api/connections/fetch-databases', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: conn.type.toLowerCase(),
                host: conn.host,
                port: conn.port,
                user: conn.user,
                password: conn.password
            }),
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Failed to connect to database');
        }

        return data.databases || [];
    };

    const fetchSchemas = async (connectionId: string, database: string): Promise<string[]> => {
        const conn = connections.find(c => c.id === connectionId);
        if (!conn || conn.type !== 'POSTGRES') return [];

        try {
            const response = await fetch('/api/connections/fetch-schemas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: conn.type.toLowerCase(),
                    host: conn.host,
                    port: conn.port,
                    user: conn.user,
                    password: conn.password,
                    database
                }),
            });

            const data = await response.json();
            return data.success ? data.schemas : [];
        } catch (error) {
            console.error('Error fetching schemas:', error);
            return [];
        }
    };

    const fetchTables = async (connectionId: string, database: string, schema?: string): Promise<string[]> => {
        const conn = connections.find(c => c.id === connectionId);
        if (!conn) return [];

        try {
            if (conn.type === 'MONGODB') {
                const response = await fetch('/api/connections/fetch-collections', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: conn.type.toLowerCase(),
                        host: conn.host,
                        port: conn.port,
                        user: conn.user,
                        password: conn.password,
                        database
                    }),
                });
                const data = await response.json();
                return data.success ? data.collections : [];
            } else if (conn.type === 'REDIS') {
                const response = await fetch('/api/connections/fetch-keys', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: conn.type.toLowerCase(),
                        host: conn.host,
                        port: conn.port,
                        password: conn.password,
                        database
                    }),
                });
                const data = await response.json();
                return data.success ? data.keys : [];
            } else {
                const response = await fetch('/api/connections/fetch-tables', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: conn.type.toLowerCase(),
                        host: conn.host,
                        port: conn.port,
                        user: conn.user,
                        password: conn.password,
                        database,
                        schema
                    }),
                });
                const data = await response.json();
                return data.success ? data.tables : [];
            }
        } catch (error) {
            console.error('Error fetching tables:', error);
            return [];
        }
    };

    return (
        <ConnectionContext.Provider
            value={{
                connections,
                selectedItem,
                addConnection,
                removeConnection,
                updateConnection,
                editConnection,
                createDatabase,
                updateDatabase,
                deleteDatabase,
                createTable,
                updateTable,
                deleteTable,
                selectItem,
                fetchDatabases,
                fetchSchemas,
                fetchTables
            }}
        >
            {children}
        </ConnectionContext.Provider>
    );
}

export function useConnections() {
    const context = useContext(ConnectionContext);
    if (context === undefined) {
        throw new Error('useConnections must be used within a ConnectionProvider');
    }
    return context;
}
