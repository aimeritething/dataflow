"use client";

import React, { useState, useEffect } from "react";
import {
    Search,
    Filter,
    RefreshCw,
    Download,
    Wand2,
    Maximize2,
    ChevronLeft,
    ChevronRight,
    Edit2,
    Trash2,
    Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SelectedItem, useConnections } from "@/contexts/ConnectionContext";

interface TableDetailProps {
    item: SelectedItem;
}

export function TableDetail({ item }: TableDetailProps) {
    const { connections } = useConnections();
    const [isLoading, setIsLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [searchTerm, setSearchTerm] = useState("");
    const [tableData, setTableData] = useState<{
        columns: string[];
        rows: any[];
        total: number;
    }>({ columns: [], rows: [], total: 0 });

    const connection = connections.find(c => c.id === item.connectionId);

    useEffect(() => {
        if (connection) {
            fetchTableData(page);
        }
    }, [connection, item, page]);

    const fetchTableData = async (currentPage: number) => {
        if (!connection) return;

        setIsLoading(true);
        try {
            const response = await fetch('/api/connections/fetch-table-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: connection.type.toLowerCase(),
                    host: connection.host,
                    port: parseInt(connection.port),
                    user: connection.user,
                    password: connection.password,
                    database: item.metadata?.database,
                    schema: item.metadata?.schema,
                    table: item.name,
                    page: currentPage,
                    limit: 50,
                }),
            });

            const result = await response.json();

            if (result.success) {
                setTableData(result.data);
            } else {
                console.error('Failed to fetch table data:', result.error);
                setTableData({ columns: [], rows: [], total: 0 });
            }
        } catch (error) {
            console.error('Error fetching table data:', error);
            setTableData({ columns: [], rows: [], total: 0 });
        } finally {
            setIsLoading(false);
        }
    };

    const handleRefresh = () => {
        fetchTableData(page);
    };

    const handlePageChange = (newPage: number) => {
        setPage(newPage);
    };

    const totalPages = Math.ceil(tableData.total / 50);

    return (
        <div className="flex h-full flex-col bg-background">
            {/* Header */}
            <div className="flex items-center justify-between border-b px-6 py-4">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                        <Table className="h-5 w-5" />
                    </div>
                    <div>
                        <h1 className="text-lg font-semibold flex items-center gap-2">
                            {item.metadata?.database && <span className="text-muted-foreground">{item.metadata.database}.</span>}
                            {item.name}
                        </h1>
                        <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
                            {item.type === 'collection' ? 'Collection View' : item.type === 'key' ? 'Key View' : 'Table View'}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 border border-emerald-100">
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Connected
                    </div>
                    <button className="flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors">
                        <Wand2 className="h-4 w-4" />
                        AI Assistant
                    </button>
                    <button className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted text-muted-foreground transition-colors">
                        <Maximize2 className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* Toolbar */}
            <div className="flex items-center justify-between border-b px-6 py-3 bg-muted/5">
                <div className="flex items-center gap-4">
                    <div className="relative w-64">
                        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search data..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="h-9 w-full rounded-md border bg-background pl-9 pr-4 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                        />
                    </div>
                    <div className="h-4 w-px bg-border" />
                    <span className="text-sm text-muted-foreground">{tableData.total} rows</span>
                </div>
                <div className="flex items-center gap-2">
                    <button className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted text-muted-foreground transition-colors" title="Filter">
                        <Filter className="h-4 w-4" />
                    </button>
                    <button
                        className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted text-muted-foreground transition-colors"
                        title="Refresh"
                        onClick={handleRefresh}
                        disabled={isLoading}
                    >
                        <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                    </button>
                    <button className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted text-muted-foreground transition-colors" title="Download">
                        <Download className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* Data Grid */}
            <div className="flex-1 overflow-auto">
                {isLoading && tableData.rows.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <table className="w-full text-left text-sm">
                        <thead className="bg-muted/30 sticky top-0 z-10">
                            <tr>
                                {tableData.columns.map((col) => (
                                    <th key={col} className="border-b px-6 py-3 font-medium text-muted-foreground uppercase text-xs tracking-wider">
                                        {col}
                                    </th>
                                ))}
                                <th className="border-b px-6 py-3 font-medium text-muted-foreground uppercase text-xs tracking-wider text-right">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {tableData.rows.map((row, idx) => (
                                <tr key={idx} className="hover:bg-muted/20 transition-colors group">
                                    {tableData.columns.map((col) => (
                                        <td key={col} className="px-6 py-3 whitespace-nowrap font-mono text-xs">
                                            {typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col] ?? '')}
                                        </td>
                                    ))}
                                    <td className="px-6 py-3 whitespace-nowrap text-right">
                                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground">
                                                <Edit2 className="h-3.5 w-3.5" />
                                            </button>
                                            <button className="p-1 hover:bg-red-50 rounded text-muted-foreground hover:text-red-600">
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Pagination Footer */}
            <div className="flex items-center justify-between border-t px-6 py-3 bg-muted/5 text-sm text-muted-foreground">
                <div>
                    Showing <span className="font-medium text-foreground">{((page - 1) * 50) + 1}</span> to <span className="font-medium text-foreground">{Math.min(page * 50, tableData.total)}</span> of <span className="font-medium text-foreground">{tableData.total}</span> results
                </div>
                <div className="flex items-center gap-2">
                    <button
                        className="p-1 hover:bg-muted rounded disabled:opacity-50"
                        disabled={page === 1}
                        onClick={() => handlePageChange(page - 1)}
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="text-foreground font-medium">Page {page} of {totalPages || 1}</span>
                    <button
                        className="p-1 hover:bg-muted rounded disabled:opacity-50"
                        disabled={page >= totalPages}
                        onClick={() => handlePageChange(page + 1)}
                    >
                        <ChevronRight className="h-4 w-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}

function Table({ className }: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            <path d="M12 3v18" />
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M3 9h18" />
            <path d="M3 15h18" />
        </svg>
    );
}
