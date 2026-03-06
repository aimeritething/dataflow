"use client";

import React, { useState, useEffect } from 'react';
import { Search, X, Database, Loader2, ChevronRight, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useConnections, Connection } from '@/contexts/ConnectionContext';

interface DataSource {
    id: string;
    name: string;
    type: string;
    database?: string;  // 具体选择的数据库
    databaseCount: number;
    tableCount: number;
}

// 根据数据库类型返回对应的样式
const getTypeStyle = (type: string): { color: string; bgColor: string } => {
    switch (type.toUpperCase()) {
        case 'MYSQL':
            return { color: 'text-blue-600', bgColor: 'bg-blue-100 dark:bg-blue-900/30' };
        case 'POSTGRES':
            return { color: 'text-indigo-600', bgColor: 'bg-indigo-100 dark:bg-indigo-900/30' };
        case 'MONGODB':
            return { color: 'text-green-600', bgColor: 'bg-green-100 dark:bg-green-900/30' };
        case 'REDIS':
            return { color: 'text-red-600', bgColor: 'bg-red-100 dark:bg-red-900/30' };
        default:
            return { color: 'text-gray-600', bgColor: 'bg-gray-100 dark:bg-gray-900/30' };
    }
};

// 获取数据库类型的显示名称
const getTypeName = (type: string): string => {
    switch (type.toUpperCase()) {
        case 'MYSQL':
            return 'MySQL';
        case 'POSTGRES':
            return 'PostgreSQL';
        case 'MONGODB':
            return 'MongoDB';
        case 'REDIS':
            return 'Redis';
        default:
            return type;
    }
};

interface DataSourceSelectorProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (selectedSource: DataSource) => void;
}

export function DataSourceSelector({ isOpen, onClose, onConfirm }: DataSourceSelectorProps) {
    const { connections, fetchDatabases, fetchTables } = useConnections();
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
    const [selectedDatabase, setSelectedDatabase] = useState<string | null>(null);
    const [dataSources, setDataSources] = useState<DataSource[]>([]);
    const [databases, setDatabases] = useState<string[]>([]);
    const [databaseTableCounts, setDatabaseTableCounts] = useState<Record<string, number>>({});
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingDatabases, setIsLoadingDatabases] = useState(false);
    const [step, setStep] = useState<'connection' | 'database'>('connection');

    // 当弹窗打开时，加载数据源信息
    useEffect(() => {
        if (isOpen && connections.length > 0) {
            loadDataSources();
            // 重置状态
            setStep('connection');
            setSelectedConnectionId(null);
            setSelectedDatabase(null);
            setDatabases([]);
        }
    }, [isOpen, connections]);

    const loadDataSources = async () => {
        setIsLoading(true);
        try {
            const sources: DataSource[] = await Promise.all(
                connections.map(async (conn: Connection) => {
                    let databaseCount = 0;
                    let tableCount = 0;

                    try {
                        const dbs = await fetchDatabases(conn.id);
                        databaseCount = dbs.length;

                        // 用第一个数据库的表数量作为预览
                        if (dbs.length > 0) {
                            const tables = await fetchTables(conn.id, dbs[0]);
                            tableCount = tables.length;
                        }
                    } catch (error) {
                        console.error(`Error loading data for connection ${conn.name}:`, error);
                    }

                    return {
                        id: conn.id,
                        name: conn.name,
                        type: conn.type,
                        databaseCount,
                        tableCount
                    };
                })
            );
            setDataSources(sources);
        } catch (error) {
            console.error('Error loading data sources:', error);
        } finally {
            setIsLoading(false);
        }
    };

    // 加载选中连接的数据库列表
    const loadDatabases = async (connectionId: string) => {
        setIsLoadingDatabases(true);
        try {
            const dbs = await fetchDatabases(connectionId);
            setDatabases(dbs);

            // 并行获取每个数据库的表数量
            const tableCounts: Record<string, number> = {};
            await Promise.all(
                dbs.slice(0, 10).map(async (db) => {
                    try {
                        const tables = await fetchTables(connectionId, db);
                        tableCounts[db] = tables.length;
                    } catch {
                        tableCounts[db] = 0;
                    }
                })
            );
            setDatabaseTableCounts(tableCounts);
        } catch (error) {
            console.error('Error loading databases:', error);
        } finally {
            setIsLoadingDatabases(false);
        }
    };

    const handleSelectConnection = async (connectionId: string) => {
        setSelectedConnectionId(connectionId);
        setStep('database');
        await loadDatabases(connectionId);
    };

    const handleBack = () => {
        setStep('connection');
        setSelectedConnectionId(null);
        setSelectedDatabase(null);
        setDatabases([]);
    };

    const handleConfirm = () => {
        if (selectedConnectionId && selectedDatabase) {
            const source = dataSources.find(s => s.id === selectedConnectionId);
            if (source) {
                onConfirm({
                    ...source,
                    database: selectedDatabase,
                    tableCount: databaseTableCounts[selectedDatabase] || 0
                });
            }
        }
    };

    if (!isOpen) return null;

    const filteredSources = dataSources.filter(source =>
        source.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        source.type.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const filteredDatabases = databases.filter(db =>
        db.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const selectedConnection = dataSources.find(s => s.id === selectedConnectionId);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-4xl bg-card border shadow-lg rounded-xl flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b">
                    <div className="flex items-center gap-2">
                        {step === 'database' && (
                            <button
                                onClick={handleBack}
                                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <ArrowLeft className="w-4 h-4" />
                            </button>
                        )}
                        <h2 className="text-lg font-semibold">
                            {step === 'connection' ? '选择数据源' : `选择数据库 - ${selectedConnection?.name}`}
                        </h2>
                    </div>
                    <div className="relative w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="搜索"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full h-9 pl-9 pr-4 rounded-md border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 bg-muted/5">
                    {step === 'connection' ? (
                        // 第一步：选择连接
                        isLoading ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                                <span className="ml-2 text-muted-foreground">加载数据源...</span>
                            </div>
                        ) : connections.length === 0 ? (
                            <div className="text-center py-12 text-muted-foreground">
                                <Database className="w-12 h-12 mx-auto mb-4 opacity-50" />
                                <p>暂无数据库连接</p>
                                <p className="text-xs mt-2">请先在"数据库连接"中添加连接</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {filteredSources.map((source) => {
                                    const typeStyle = getTypeStyle(source.type);
                                    return (
                                        <div
                                            key={source.id}
                                            onClick={() => handleSelectConnection(source.id)}
                                            className="relative flex flex-col p-4 rounded-lg border-2 cursor-pointer transition-all hover:shadow-md bg-card border-transparent hover:border-primary/30"
                                        >
                                            <div className="flex items-start gap-3 mb-4">
                                                <div className={cn("p-2 rounded-lg", typeStyle.bgColor, typeStyle.color)}>
                                                    <Database className="w-6 h-6" />
                                                </div>
                                                <div className="flex-1">
                                                    <h3 className="font-medium text-sm">{source.name}</h3>
                                                    <p className="text-xs text-muted-foreground mt-0.5">{getTypeName(source.type)}</p>
                                                </div>
                                                <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                            </div>
                                            <div className="mt-auto flex items-center gap-4 text-xs text-muted-foreground">
                                                <div className="flex items-center gap-1">
                                                    <Database className="w-3 h-3" />
                                                    <span>{source.databaseCount} 数据库</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )
                    ) : (
                        // 第二步：选择数据库
                        isLoadingDatabases ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                                <span className="ml-2 text-muted-foreground">加载数据库列表...</span>
                            </div>
                        ) : databases.length === 0 ? (
                            <div className="text-center py-12 text-muted-foreground">
                                <Database className="w-12 h-12 mx-auto mb-4 opacity-50" />
                                <p>该连接下没有可用的数据库</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {filteredDatabases.map((db) => {
                                    const typeStyle = selectedConnection ? getTypeStyle(selectedConnection.type) : { color: 'text-gray-600', bgColor: 'bg-gray-100' };
                                    const tableCount = databaseTableCounts[db] || 0;
                                    return (
                                        <div
                                            key={db}
                                            onClick={() => setSelectedDatabase(db)}
                                            className={cn(
                                                "relative flex flex-col p-4 rounded-lg border-2 cursor-pointer transition-all hover:shadow-md bg-card",
                                                selectedDatabase === db
                                                    ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
                                                    : "border-transparent hover:border-border"
                                            )}
                                        >
                                            <div className="flex items-start gap-3 mb-2">
                                                <div className={cn("p-2 rounded-lg", typeStyle.bgColor, typeStyle.color)}>
                                                    <Database className="w-5 h-5" />
                                                </div>
                                                <div className="flex-1">
                                                    <h3 className="font-medium text-sm">{db}</h3>
                                                    <p className="text-xs text-muted-foreground mt-1">
                                                        {tableCount} 个表
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )
                    )}

                    {!isLoading && connections.length > 0 && step === 'connection' && filteredSources.length === 0 && (
                        <div className="text-center py-12 text-muted-foreground">
                            未找到匹配的数据源
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t flex justify-end gap-3 bg-card rounded-b-xl">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium border rounded-md hover:bg-muted transition-colors"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={step !== 'database' || !selectedDatabase}
                        className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        确定
                    </button>
                </div>
            </div>
        </div>
    );
}
