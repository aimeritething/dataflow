"use client";

import React, { useRef, useEffect, useCallback } from 'react';
import { useSqlBotStore } from '@/stores/useSqlBotStore';
import { useConnections } from '@/contexts/ConnectionContext';
import { MessageBubble } from './MessageBubble';
import { InputArea } from './InputArea';
import { Settings, PanelLeftClose, PanelLeftOpen, Sparkles, MessageSquare, ChevronDown, ChevronUp, RefreshCw, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SuggestedQuestion, ChartData } from '@/types/sqlbot';

export function ChatWindow() {
    const {
        conversations,
        currentConversationId,
        addMessage,
        isSidebarOpen,
        toggleSidebar,
        setSuggestions,
        setSuggestionsLoading,
        setSchemaAnalysis,
        updateConversationDataSource,
        getCachedSuggestions,
        setCachedSuggestions,
        clearSuggestionCache
    } = useSqlBotStore();

    const { connections } = useConnections();
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const currentConversation = conversations.find(c => c.id === currentConversationId);
    const [isRecommendationsCollapsed, setIsRecommendationsCollapsed] = React.useState(false);
    const [executingId, setExecutingId] = React.useState<string | null>(null);
    const [hasInput, setHasInput] = React.useState(false);
    const [suggestionsError, setSuggestionsError] = React.useState<string | null>(null);

    const handleDatabaseChange = (db: string) => {
        if (currentConversationId) {
            updateConversationDataSource(currentConversationId, { database: db });
            // Clear suggestions to trigger reload for the new database
            setSuggestions(currentConversationId, undefined as any);
        }
    };

    // Track the current database for suggestion requests to prevent race conditions
    const currentSuggestionRequestRef = useRef<string | null>(null);

    // Deep suggestions fetch (separated for reuse)
    const fetchDeepSuggestions = useCallback(async (conn: any, database: string, requestId?: string) => {
        const connectionParams = {
            type: conn.type.toLowerCase(),
            host: conn.host,
            port: conn.port,
            user: conn.user,
            password: conn.password,
            database,
        };

        fetch('/api/ai-chat/analyze-schema', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(connectionParams),
        }).then(async (deepResponse) => {
            const deepData = await deepResponse.json();

            if (requestId && currentSuggestionRequestRef.current !== requestId) {
                console.log('[loadSuggestions] Ignoring stale deep response for:', database);
                return;
            }

            if (deepData.success && deepData.suggestions && currentConversationId) {
                setSuggestions(currentConversationId, deepData.suggestions);
                // Cache deep results
                setCachedSuggestions(conn.id, database, deepData.suggestions, true);

                if (deepData.tables) {
                    setSchemaAnalysis(currentConversationId, {
                        tables: deepData.tables,
                        summary: deepData.summary,
                    });
                }
            }
        }).catch(err => {
            console.log('[loadSuggestions] Deep analysis failed (non-blocking):', err);
        });
    }, [currentConversationId, setSuggestions, setCachedSuggestions, setSchemaAnalysis]);

    // 加载智能建议 (Phase 5: 分层加载 + 缓存)
    const loadSuggestions = useCallback(async () => {
        if (!currentConversation?.dataSource || !currentConversationId) return;

        const conn = connections.find(c => c.id === currentConversation.dataSource?.id);
        if (!conn) return;

        const currentDatabase = currentConversation.dataSource?.database || conn.database;

        // Check cache first
        const cached = getCachedSuggestions(conn.id, currentDatabase);
        if (cached) {
            console.log('[loadSuggestions] Using cached suggestions for:', currentDatabase);
            setSuggestions(currentConversationId, cached.suggestions);

            // If only quick cache, still fetch deep in background
            if (!cached.isDeep) {
                fetchDeepSuggestions(conn, currentDatabase);
            }
            return;
        }

        const requestId = `${currentConversationId}-${currentDatabase}-${Date.now()}`;
        currentSuggestionRequestRef.current = requestId;

        setSuggestionsLoading(currentConversationId, true);

        const connectionParams = {
            type: conn.type.toLowerCase(),
            host: conn.host,
            port: conn.port,
            user: conn.user,
            password: conn.password,
            database: currentDatabase,
        };

        try {
            // 第一阶段：快速分析 (< 500ms)
            const quickResponse = await fetch('/api/ai-chat/quick-analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(connectionParams),
            });

            const quickData = await quickResponse.json();

            if (currentSuggestionRequestRef.current !== requestId) {
                console.log('[loadSuggestions] Ignoring stale quick response for:', currentDatabase);
                return;
            }

            if (quickData.success && quickData.suggestions && quickData.suggestions.length > 0) {
                setSuggestions(currentConversationId, quickData.suggestions);
                setSuggestionsLoading(currentConversationId, false);
                setSuggestionsError(null); // Clear any previous error
                // Cache quick results
                setCachedSuggestions(conn.id, currentDatabase, quickData.suggestions, false);
            } else {
                // Quick analyze returned no suggestions or failed - still stop loading
                // Set empty array to prevent useEffect from re-triggering
                setSuggestions(currentConversationId, []);
                setSuggestionsLoading(currentConversationId, false);
                if (!quickData.success) {
                    console.log('[loadSuggestions] Quick analyze failed:', quickData.error);
                }
            }

            // 第二阶段：深度分析
            fetchDeepSuggestions(conn, currentDatabase, requestId);

        } catch (error: any) {
            console.error('Error loading suggestions:', error);
            if (currentSuggestionRequestRef.current === requestId) {
                setSuggestionsLoading(currentConversationId, false);
                setSuggestionsError(error.message || 'Failed to load suggestions');
            }
        }
    }, [currentConversation, currentConversationId, connections, setSuggestions, setSuggestionsLoading, getCachedSuggestions, setCachedSuggestions, fetchDeepSuggestions]);

    // Force refresh suggestions (clear cache and reload)
    const refreshSuggestions = useCallback(() => {
        if (!currentConversation?.dataSource) return;
        const conn = connections.find(c => c.id === currentConversation.dataSource?.id);
        if (!conn) return;

        const currentDatabase = currentConversation.dataSource?.database || conn.database;
        clearSuggestionCache(conn.id, currentDatabase);

        // Explicitly set loading state and trigger reload
        setSuggestions(currentConversationId!, undefined as any);
        setSuggestionsLoading(currentConversationId!, true);

        // Use setTimeout to allow state updates to propagate before reloading
        setTimeout(() => {
            loadSuggestions();
        }, 0);
    }, [currentConversation, currentConversationId, connections, clearSuggestionCache, setSuggestions, setSuggestionsLoading, loadSuggestions]);

    // 当对话有 dataSource 但没有 suggestions 时，自动加载建议
    // Only load suggestions if the connection still exists
    useEffect(() => {
        if (currentConversation?.dataSource &&
            !currentConversation.suggestions &&
            !currentConversation.suggestionsLoading) {
            // Check if the connection still exists before trying to load suggestions
            const conn = connections.find(c => c.id === currentConversation.dataSource?.id);
            if (conn) {
                loadSuggestions();
            }
        }
    }, [currentConversation?.id, currentConversation?.dataSource, connections, loadSuggestions]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [currentConversation?.messages]);



    // 执行建议查询
    const executeSuggestion = async (suggestion: SuggestedQuestion) => {
        if (!currentConversation?.dataSource || !currentConversationId) return;

        const conn = connections.find(c => c.id === currentConversation.dataSource?.id);
        if (!conn) return;

        setExecutingId(suggestion.id);

        // 添加用户消息
        addMessage(currentConversationId, {
            role: 'user',
            content: suggestion.text
        });

        try {
            const response = await fetch('/api/ai-chat/execute-suggestion', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: conn.type.toLowerCase(),
                    host: conn.host,
                    port: conn.port,
                    user: conn.user,
                    password: conn.password,
                    database: currentConversation.dataSource?.database || conn.database,
                    query: suggestion.query,
                    chartType: suggestion.chartType,
                }),
            });

            const data = await response.json();

            if (data.success) {
                const chart: ChartData | undefined = data.chartData ? {
                    title: suggestion.text,
                    type: suggestion.chartType,
                    xAxis: data.chartData.xAxis,
                    series: data.chartData.series,
                    sql: suggestion.query,
                    columns: data.columns,
                    rows: data.rows,
                } : {
                    title: suggestion.text,
                    type: 'table',
                    xAxis: [],
                    series: [],
                    sql: suggestion.query,
                    columns: data.columns,
                    rows: data.rows,
                };

                addMessage(currentConversationId, {
                    role: 'assistant',
                    content: `以下是"${suggestion.text}"的查询结果：`,
                    chart
                });
            } else {
                addMessage(currentConversationId, {
                    role: 'assistant',
                    content: `查询执行失败：${data.error}`
                });
            }
        } catch (error: any) {
            addMessage(currentConversationId, {
                role: 'assistant',
                content: `查询执行出错：${error.message}`
            });
        } finally {
            setExecutingId(null);
        }
    };

    const handleSend = async (content: string) => {
        if (!currentConversationId || !currentConversation?.dataSource) return;

        const conn = connections.find(c => c.id === currentConversation.dataSource?.id);
        if (!conn) return;

        // Add user message
        addMessage(currentConversationId, {
            role: 'user',
            content
        });

        // Add loading message
        addMessage(currentConversationId, {
            role: 'assistant',
            content: '',
            isLoading: true
        });

        try {
            const response = await fetch('/api/ai-chat/text-to-sql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: content,
                    connectionType: conn.type.toLowerCase(),
                    host: conn.host,
                    port: conn.port,
                    user: conn.user,
                    password: conn.password,
                    database: currentConversation.dataSource?.database || conn.database,
                }),
            });

            const data = await response.json();

            if (data.success) {
                const columns = (data.columns || []) as string[];
                const rows = (data.rows || []) as Record<string, unknown>[];
                const rowCount = rows.length;
                const colCount = columns.length;

                // Classify result display type
                let displayType: 'single_value' | 'simple_list' | 'table_only' | 'chart' | 'text_only' = 'text_only';
                let singleValue: string | number | undefined;
                let responseMessage = '';

                if (rowCount === 0) {
                    // No data
                    displayType = 'text_only';
                    responseMessage = '查询未返回任何数据。';
                } else if (rowCount === 1 && colCount === 1) {
                    // Single value result (e.g., COUNT(*), SUM(), etc.)
                    displayType = 'single_value';
                    singleValue = rows[0][columns[0]] as string | number;
                    responseMessage = `查询结果：**${singleValue}**`;
                } else if (colCount === 1 && rowCount <= 10) {
                    // Simple list - one column, few rows
                    displayType = 'simple_list';
                    const listItems = rows.map(r => String(r[columns[0]] ?? '')).join('\n• ');
                    responseMessage = `找到 ${rowCount} 条结果：\n• ${listItems}`;
                } else if (rowCount <= 5) {
                    // Small table - show inline table without chart
                    displayType = 'table_only';
                    responseMessage = `查询结果（${rowCount} 条记录）：`;
                } else {
                    // Check if data is suitable for charting
                    const hasNumericData = colCount > 1 && columns.slice(1).some(col =>
                        rows.some(row => {
                            const val = row[col];
                            return typeof val === 'number' || (typeof val === 'string' && !isNaN(parseFloat(val)));
                        })
                    );

                    if (hasNumericData && rowCount <= 50) {
                        displayType = 'chart';
                        responseMessage = `已查询到 ${rowCount} 条数据：`;
                    } else {
                        // Large dataset or no numeric data - table only
                        displayType = 'table_only';
                        responseMessage = `查询结果（共 ${rowCount} 条记录）：`;
                    }
                }

                // Generate chart data only if needed
                let xAxis: string[] = [];
                let series: { name: string; data: number[] }[] = [];
                let suggestedType: 'table' | 'bar' | 'line' | 'pie' = 'table';

                if (displayType === 'chart' && rowCount > 0 && colCount > 0) {
                    // Use first column as labels (xAxis)
                    const labelCol = columns[0];
                    xAxis = rows.map(row => String(row[labelCol] ?? ''));

                    // Try to use remaining columns as numeric series
                    const otherCols = columns.slice(1);
                    if (otherCols.length > 0) {
                        series = otherCols.map(col => ({
                            name: col,
                            data: rows.map(row => {
                                const val = row[col];
                                if (typeof val === 'number') return val;
                                if (typeof val === 'string') {
                                    const num = parseFloat(val.replace(/,/g, ''));
                                    return isNaN(num) ? 0 : num;
                                }
                                return 0;
                            })
                        })).filter(s => s.data.some(d => d !== 0));
                    }

                    // Suggest chart type
                    if (series.length > 0 && rowCount > 0) {
                        if (rowCount <= 8 && series.length === 1) {
                            suggestedType = 'pie';
                        } else {
                            suggestedType = 'bar';
                        }
                    }
                }

                // Build chart data object
                const chart: ChartData = {
                    title: content,
                    type: suggestedType,
                    xAxis,
                    series,
                    sql: data.sql,
                    columns: data.columns,
                    rows: data.rows,
                    displayType,
                    singleValue,
                };

                addMessage(currentConversationId, {
                    role: 'assistant',
                    content: responseMessage,
                    chart: displayType !== 'text_only' && displayType !== 'single_value' && displayType !== 'simple_list' ? chart : undefined
                });
            } else {
                addMessage(currentConversationId, {
                    role: 'assistant',
                    content: `查询失败：${data.error}${data.sql ? `\n\n生成的 SQL：\n\`\`\`sql\n${data.sql}\n\`\`\`` : ''}`
                });
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : '未知错误';
            addMessage(currentConversationId, {
                role: 'assistant',
                content: `请求出错：${errorMessage}`
            });
        }
    };


    if (!currentConversation) {
        return (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
                Select or create a conversation
            </div>
        );
    }

    // 获取显示的建议（动态或默认）
    const displayedQuestions = currentConversation.suggestions || [];
    const isLoadingSuggestions = currentConversation.suggestionsLoading;

    return (
        <div className="flex flex-col h-full w-full bg-background relative">
            {/* Header */}
            <div className="flex h-14 items-center justify-between border-b px-4 shrink-0 bg-background z-20">
                <div className="flex items-center gap-3">
                    <button
                        onClick={toggleSidebar}
                        className="p-1 hover:bg-muted rounded-md text-muted-foreground"
                    >
                        {isSidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
                    </button>
                    <div className="font-semibold text-sm truncate max-w-[200px] sm:max-w-md">
                        {currentConversation.title}
                    </div>
                    {currentConversation.dataSource && (() => {
                        const conn = connections.find(c => c.id === currentConversation.dataSource?.id);
                        const isDeleted = !conn;
                        const type = currentConversation.dataSource.type.toLowerCase();
                        const typeMap: Record<string, string> = {
                            'mysql': 'MySQL',
                            'redis': 'Redis',
                            'mongodb': 'MongoDB',
                            'postgres': 'PostgreSQL',
                            'postgresql': 'PostgreSQL'
                        };
                        return (
                            <span className={`text-xs px-2 py-0.5 rounded-full ml-2 flex items-center gap-1 font-mono ${isDeleted
                                ? 'bg-destructive/10 text-destructive'
                                : 'bg-primary/10 text-primary'
                                }`}>
                                <span className="font-semibold">
                                    {typeMap[type] || currentConversation.dataSource.type}
                                </span>
                                <span className="opacity-40 px-0.5">/</span>
                                <span>{isDeleted ? '已删除' : conn?.name}</span>
                            </span>
                        );
                    })()}
                </div>

            </div>



            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 pb-12">
                {currentConversation.messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center space-y-4 text-center p-8 opacity-50">
                        <MessageSquare className="w-12 h-12 text-muted-foreground/50" />
                        <p className="text-muted-foreground">
                            开始一个新的对话...
                        </p>
                        {currentConversation.schemaAnalysis && (
                            <p className="text-xs text-muted-foreground">
                                已分析 {currentConversation.schemaAnalysis.summary.tableCount} 个表，
                                共 {currentConversation.schemaAnalysis.summary.totalColumns} 个字段
                            </p>
                        )}
                    </div>
                ) : (
                    <div className="max-w-5xl mx-auto w-full space-y-4">
                        {currentConversation.messages.map((msg, idx) => (
                            !msg.isLoading && <MessageBubble key={msg.id || idx} message={msg} />
                        ))}
                        <div ref={messagesEndRef} />
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div className="max-w-5xl mx-auto w-full relative">


                <InputArea
                    onSend={handleSend}
                    isLoading={isLoadingSuggestions}
                    dataSource={currentConversation.dataSource}
                    onDatabaseChange={handleDatabaseChange}
                    onInputChange={(val) => setHasInput(!!val.trim())}
                    suggestions={displayedQuestions}
                    suggestionsLoading={isLoadingSuggestions}
                    suggestionsError={suggestionsError}
                    onRefreshSuggestions={() => { setSuggestionsError(null); refreshSuggestions(); }}
                    onExecuteSuggestion={executeSuggestion}
                    executingSuggestionId={executingId}
                />
            </div>
        </div >
    );
}
