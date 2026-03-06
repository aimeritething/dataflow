"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, Loader2, FileSpreadsheet, Database, ChevronDown, RefreshCw } from 'lucide-react';
import { useConnections } from '@/contexts/ConnectionContext';
import { cn } from '@/lib/utils';

interface InputAreaProps {
    onSend: (content: string) => void;
    isLoading?: boolean;
    dataSource?: {
        id: string;
        name: string;
        type: string;
        database?: string;
    };
    onDatabaseChange?: (database: string) => void;
    onInputChange?: (value: string) => void;
    // Suggestions props
    suggestions?: any[];
    suggestionsLoading?: boolean;
    suggestionsError?: string | null;
    onRefreshSuggestions?: () => void;
    onExecuteSuggestion?: (suggestion: any) => void;
    executingSuggestionId?: string | null;
}

export function InputArea({
    onSend,
    isLoading,
    dataSource,
    onDatabaseChange,
    onInputChange,
    suggestions = [],
    suggestionsLoading = false,
    suggestionsError = null,
    onRefreshSuggestions,
    onExecuteSuggestion,
    executingSuggestionId
}: InputAreaProps) {
    const { fetchDatabases } = useConnections();
    const [input, setInput] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Database selector state
    const [isDatabaseSelectorOpen, setIsDatabaseSelectorOpen] = useState(false);
    const [availableDatabases, setAvailableDatabases] = useState<string[]>([]);
    const databaseSelectorRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (dataSource?.id && onDatabaseChange) {
            fetchDatabases(dataSource.id)
                .then(setAvailableDatabases)
                .catch(() => {
                    // Silently ignore - connection may have been deleted
                    setAvailableDatabases([]);
                });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dataSource?.id]);

    // Handle click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (databaseSelectorRef.current && !databaseSelectorRef.current.contains(event.target as Node)) {
                setIsDatabaseSelectorOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSend = () => {
        if (!input.trim() || isLoading) return;
        onSend(input);
        setInput('');
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            if (e.nativeEvent.isComposing) {
                return;
            }
            e.preventDefault();
            handleSend();
        }
    };

    const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
        if (onInputChange) {
            onInputChange(e.target.value);
        }
        // Auto-resize
        e.target.style.height = 'auto';
        e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`;
    };

    return (
        <div className="border-t p-4 bg-background">
            <div className="relative rounded-xl border bg-muted/30 shadow-sm focus-within:ring-1 focus-within:ring-primary focus-within:border-primary transition-all">
                {dataSource && (
                    <div className="flex items-center gap-2 px-3 pt-3 text-xs text-muted-foreground">
                        <span>已选择数据源:</span>
                        <div className="relative" ref={databaseSelectorRef}>
                            <button
                                onClick={() => onDatabaseChange && setIsDatabaseSelectorOpen(!isDatabaseSelectorOpen)}
                                className={cn(
                                    "flex items-center gap-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-1.5 py-0.5 rounded text-[11px] transition-colors",
                                    onDatabaseChange && "hover:bg-green-200 dark:hover:bg-green-900/50 cursor-pointer"
                                )}
                                disabled={!onDatabaseChange}
                            >
                                {dataSource.type.includes('Excel') || dataSource.type.includes('CSV') ? (
                                    <FileSpreadsheet className="w-3 h-3" />
                                ) : (
                                    <Database className="w-3 h-3" />
                                )}
                                <span className="font-medium">{dataSource.name}</span>
                                {dataSource.database && (
                                    <>
                                        <span className="opacity-50">/</span>
                                        <span className="font-medium">{dataSource.database}</span>
                                    </>
                                )}
                                {onDatabaseChange && (
                                    <ChevronDown className="w-3 h-3 opacity-50 ml-1" />
                                )}
                            </button>

                            {isDatabaseSelectorOpen && onDatabaseChange && (
                                <div className="absolute bottom-full left-0 mb-1 w-48 bg-card border shadow-lg rounded-md py-1 z-50 max-h-64 overflow-y-auto">
                                    {availableDatabases.length > 0 ? (
                                        availableDatabases.map(db => (
                                            <button
                                                key={db}
                                                onClick={() => {
                                                    onDatabaseChange(db);
                                                    setIsDatabaseSelectorOpen(false);
                                                }}
                                                className={cn(
                                                    "w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors truncate",
                                                    dataSource.database === db && "bg-primary/5 text-primary font-medium"
                                                )}
                                            >
                                                {db}
                                            </button>
                                        ))
                                    ) : (
                                        <div className="px-3 py-2 text-xs text-muted-foreground">
                                            No databases found
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Suggestions Area */}
                {(suggestions.length > 0 || suggestionsLoading || suggestionsError) && (
                    <div className="px-3 pt-2 pb-1 border-b border-border/50">
                        {suggestionsLoading ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground p-1">
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                                <span>正在生成智能建议...</span>
                            </div>
                        ) : suggestionsError ? (
                            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 p-2 rounded-lg border border-red-200 w-fit">
                                <span>加载建议失败</span>
                                <button
                                    onClick={() => onRefreshSuggestions?.()}
                                    className="px-2 py-0.5 bg-red-100 hover:bg-red-200 rounded text-red-700 transition-colors flex items-center gap-1"
                                >
                                    <RefreshCw className="w-3 h-3" />
                                    重试
                                </button>
                            </div>
                        ) : (
                            <div className="flex overflow-x-auto gap-2 scrollbar-hide mask-fade-right items-center">
                                <div className="flex items-center gap-1.5 px-1 text-xs font-medium text-primary shrink-0 select-none">
                                    <Sparkles className="w-3.5 h-3.5" />
                                    <span>猜你想问</span>
                                    {onRefreshSuggestions && (
                                        <button
                                            onClick={onRefreshSuggestions}
                                            className="p-1 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground transition-colors"
                                            title="刷新建议"
                                        >
                                            <RefreshCw className="w-3 h-3" />
                                        </button>
                                    )}
                                </div>
                                {suggestions.map((q) => (
                                    <button
                                        key={q.id}
                                        onClick={() => onExecuteSuggestion?.(q)}
                                        disabled={executingSuggestionId === q.id}
                                        className="shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full bg-background hover:bg-muted text-muted-foreground hover:text-foreground text-xs transition-colors border shadow-sm flex items-center group"
                                    >
                                        {executingSuggestionId === q.id ? (
                                            <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                                        ) : (
                                            <Sparkles className="w-3 h-3 mr-1.5 text-primary/70 group-hover:text-primary transition-colors" />
                                        )}
                                        {q.text}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                <div className="flex items-end gap-2 p-2">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center text-muted-foreground">
                        <Sparkles className="h-5 w-5" />
                    </div>

                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={handleInput}
                        onKeyDown={handleKeyDown}
                        placeholder="按下 Enter 提交问题，或使用 Ctrl + Enter 换行"
                        className="flex-1 max-h-[150px] min-h-[40px] resize-none bg-transparent py-2 text-sm focus:outline-none placeholder:text-muted-foreground"
                        rows={1}
                        disabled={isLoading}
                    />

                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || isLoading}
                        className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors mb-1",
                            input.trim() && !isLoading
                                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                                : "bg-muted text-muted-foreground cursor-not-allowed"
                        )}
                    >
                        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </button>
                </div>
            </div>
            <div className="text-[10px] text-center text-muted-foreground mt-2">
                AI can make mistakes. Please verify important information.
            </div>
        </div>
    );
}
