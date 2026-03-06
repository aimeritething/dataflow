"use client";

import React, { useState, useMemo } from 'react';
import { NativeECharts } from '@/components/ui/NativeECharts';
import { ChartData, ChartType } from '@/types/sqlbot';
import { Code, BarChart, LineChart, PieChart, Table as TableIcon, Activity, ScatterChart, Maximize2, X, Download, Copy, Check, Sparkles, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';

interface ChartRendererProps {
    data: ChartData;
}

export function ChartRenderer({ data }: ChartRendererProps) {
    const [activeTab, setActiveTab] = useState<'chart' | 'sql'>('chart');
    // For table_only display type, always use table; otherwise use given type
    const isTableOnly = data.displayType === 'table_only';
    const [currentType, setCurrentType] = useState<ChartType>(isTableOnly ? 'table' : data.type);
    const [isCopied, setIsCopied] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisResult, setAnalysisResult] = useState<string | null>(null);

    // Pagination state for table view
    const [currentPage, setCurrentPage] = useState(1);
    const pageSize = 50;

    // Generate table data from chart data if not provided
    const tableData = useMemo(() => {
        if (data.rows && data.columns) {
            return { columns: data.columns, rows: data.rows };
        }

        // Convert chart data to table format
        const columns = [data.xAxisName || 'Category', ...data.series.map(s => s.name)];
        const rows = data.xAxis.map((x, i) => {
            const row: any = { [columns[0]]: x };
            data.series.forEach(s => {
                row[s.name] = s.data[i];
            });
            return row;
        });

        return { columns, rows };
    }, [data]);

    // Paginated rows for table view
    const totalRows = tableData.rows.length;
    const totalPages = Math.ceil(totalRows / pageSize);
    const paginatedRows = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return tableData.rows.slice(start, start + pageSize);
    }, [tableData.rows, currentPage, pageSize]);

    const handleExport = () => {
        // In a real backend scenario, you might call an API like:
        // await api.exportData(data.id, 'excel');

        // For frontend demo, we generate Excel directly using xlsx
        try {
            const worksheet = XLSX.utils.json_to_sheet(tableData.rows);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Data");

            // Generate filename based on title or timestamp
            const filename = `${data.title.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;

            XLSX.writeFile(workbook, filename);
        } catch (error) {
            console.error("Export failed:", error);
            alert("Failed to export data");
        }
    };

    const handleCopySQL = () => {
        if (!data.sql) return;
        navigator.clipboard.writeText(data.sql);
        setIsCopied(true);
        toast.success('SQL copied to clipboard');
        setTimeout(() => setIsCopied(false), 2000);
    };

    const handleAnalyze = async () => {
        if (analysisResult) return; // Already analyzed

        setIsAnalyzing(true);
        // Simulate backend API call
        // await api.analyzeChartData(data);

        setTimeout(() => {
            const mockAnalysis = `**数据趋势分析：**
1. **总体增长**：从数据来看，整体呈现上升趋势，特别是在最近一个季度增长明显。
2. **峰值识别**：${data.xAxis[data.xAxis.length - 1] || '最近'} 达到了最高值，这可能与近期的市场活动有关。
3. **异常点**：数据波动在正常范围内，未发现显著异常。

**业务建议：**
建议继续保持当前的推广策略，并重点关注高增长区域的用户反馈，以进一步优化产品体验。`;

            setAnalysisResult(mockAnalysis);
            setIsAnalyzing(false);
        }, 1500);
    };

    const getOption = () => {
        const baseOption = {
            tooltip: {
                trigger: currentType === 'pie' || currentType === 'scatter' ? 'item' : 'axis',
            },
            legend: {
                data: data.series.map(s => s.name),
                bottom: 0
            },
            grid: {
                left: '3%',
                right: '4%',
                bottom: '10%',
                containLabel: true
            },
            toolbox: {
                feature: {
                    saveAsImage: {}
                }
            }
        };

        if (currentType === 'pie') {
            return {
                ...baseOption,
                series: data.series.map(s => ({
                    name: s.name,
                    type: 'pie',
                    radius: '50%',
                    data: s.data.map((d, i) => ({ value: d, name: data.xAxis[i] })),
                    emphasis: {
                        itemStyle: {
                            shadowBlur: 10,
                            shadowOffsetX: 0,
                            shadowColor: 'rgba(0, 0, 0, 0.5)'
                        }
                    }
                }))
            };
        }

        if (currentType === 'scatter') {
            return {
                ...baseOption,
                xAxis: {
                    type: 'category',
                    data: data.xAxis
                },
                yAxis: {
                    type: 'value'
                },
                series: data.series.map(s => ({
                    name: s.name,
                    type: 'scatter',
                    data: s.data,
                    symbolSize: 10
                }))
            };
        }

        return {
            ...baseOption,
            xAxis: {
                type: 'category',
                boundaryGap: currentType === 'bar',
                data: data.xAxis
            },
            yAxis: {
                type: 'value'
            },
            series: data.series.map(s => ({
                name: s.name,
                type: currentType === 'area' ? 'line' : currentType,
                data: s.data,
                smooth: currentType === 'line' || currentType === 'area',
                areaStyle: currentType === 'area' ? { opacity: 0.3 } : undefined,
                stack: currentType === 'area' ? 'total' : undefined
            }))
        };
    };

    const [isExpanded, setIsExpanded] = useState(false);

    const chartTypes: { type: ChartType; icon: React.ElementType; label: string }[] = [
        { type: 'bar', icon: BarChart, label: 'Bar' },
        { type: 'line', icon: LineChart, label: 'Line' },
        { type: 'area', icon: Activity, label: 'Area' },
        { type: 'pie', icon: PieChart, label: 'Pie' },
        { type: 'scatter', icon: ScatterChart, label: 'Scatter' },
        { type: 'table', icon: TableIcon, label: 'Table' },
    ];

    const renderChartContent = (height: string) => (
        <div className="w-full">
            <div className="grid w-full grid-cols-2 h-8 mb-2 bg-muted p-1 rounded-md">
                <button
                    onClick={() => setActiveTab('chart')}
                    className={cn(
                        "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-xs font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
                        activeTab === 'chart' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/50"
                    )}
                >
                    <BarChart className="w-3 h-3 mr-1" /> View
                </button>
                <button
                    onClick={() => setActiveTab('sql')}
                    className={cn(
                        "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-xs font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
                        activeTab === 'sql' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/50"
                    )}
                >
                    <Code className="w-3 h-3 mr-1" /> SQL
                </button>
            </div>

            {activeTab === 'chart' && (
                <div style={{ minHeight: height }}>
                    {currentType === 'table' ? (
                        <div className="flex flex-col">
                            <div className="overflow-auto border rounded-md" style={{ maxHeight: isExpanded ? 'calc(90vh - 200px)' : '340px' }}>
                                <table className="w-full text-sm text-left">
                                    <thead className="text-xs text-muted-foreground uppercase bg-muted sticky top-0 z-10">
                                        <tr>
                                            {tableData.columns.map((col, i) => (
                                                <th key={i} className="px-4 py-2 font-medium">{col}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {paginatedRows.map((row, i) => (
                                            <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                                                {tableData.columns.map((col, j) => (
                                                    <td key={j} className="px-4 py-2 whitespace-nowrap">
                                                        {row[col] === null ? <span className="text-muted-foreground italic">NULL</span> : String(row[col])}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {/* Pagination Controls */}
                            {totalRows > pageSize && (
                                <div className="flex items-center justify-between px-2 py-2 border-t bg-muted/30 rounded-b-md text-xs">
                                    <span className="text-muted-foreground">
                                        显示 {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, totalRows)} 共 {totalRows} 条
                                    </span>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => setCurrentPage(1)}
                                            disabled={currentPage === 1}
                                            className="px-2 py-1 rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            首页
                                        </button>
                                        <button
                                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                            disabled={currentPage === 1}
                                            className="px-2 py-1 rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            上一页
                                        </button>
                                        <span className="px-2">
                                            <input
                                                type="number"
                                                min={1}
                                                max={totalPages}
                                                value={currentPage}
                                                onChange={(e) => {
                                                    const val = parseInt(e.target.value);
                                                    if (!isNaN(val) && val >= 1 && val <= totalPages) {
                                                        setCurrentPage(val);
                                                    }
                                                }}
                                                className="w-12 text-center border rounded px-1 py-0.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            />
                                            <span className="text-muted-foreground ml-1">/ {totalPages}</span>
                                        </span>
                                        <button
                                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                            disabled={currentPage === totalPages}
                                            className="px-2 py-1 rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            下一页
                                        </button>
                                        <button
                                            onClick={() => setCurrentPage(totalPages)}
                                            disabled={currentPage === totalPages}
                                            className="px-2 py-1 rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            末页
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <NativeECharts
                            option={getOption()}
                            style={{ height: height, width: '100%' }}
                        />
                    )}
                </div>
            )}

            {activeTab === 'sql' && (
                <div className="relative bg-muted p-3 rounded-md overflow-x-auto group" style={{ minHeight: height, maxHeight: isExpanded ? 'calc(90vh - 150px)' : 'none' }}>
                    <button
                        onClick={handleCopySQL}
                        className="absolute right-2 top-2 p-1.5 rounded-md bg-background/50 hover:bg-background text-muted-foreground hover:text-foreground transition-all opacity-0 group-hover:opacity-100"
                        title="Copy SQL"
                    >
                        {isCopied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                    </button>
                    <code className="text-xs font-mono text-muted-foreground whitespace-pre-wrap block pt-1">
                        {data.sql || '-- No SQL available'}
                    </code>
                </div>
            )}

            {/* AI Analysis Section */}
            <div className="mt-4 border-t pt-3">
                {!analysisResult && !isAnalyzing && (
                    <button
                        onClick={handleAnalyze}
                        className="flex items-center gap-2 text-sm text-primary hover:text-primary/80 font-medium transition-colors"
                    >
                        <Sparkles className="w-4 h-4" />
                        智能数据分析
                    </button>
                )}

                {isAnalyzing && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        正在分析数据趋势...
                    </div>
                )}

                {analysisResult && (
                    <div className="bg-primary/5 rounded-md p-3 text-sm animate-in fade-in slide-in-from-top-2">
                        <div className="flex items-center gap-2 font-medium text-primary mb-2">
                            <Sparkles className="w-4 h-4" />
                            AI 分析报告
                        </div>
                        <div className="text-muted-foreground whitespace-pre-wrap leading-relaxed">
                            {analysisResult}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <>
            <div className="w-full mt-2 border border-border/50 shadow-sm rounded-lg bg-card text-card-foreground">
                <div className="p-4 pb-2 border-b">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <h3 className="text-sm font-medium leading-none tracking-tight">{data.title}</h3>

                        <div className="flex items-center gap-2">
                            {/* Chart Type Switcher - hidden for table_only display */}
                            {!isTableOnly && (
                                <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-md overflow-x-auto no-scrollbar">
                                    {chartTypes.map((t) => (
                                        <button
                                            key={t.type}
                                            onClick={() => setCurrentType(t.type)}
                                            title={t.label}
                                            className={cn(
                                                "p-1.5 rounded-sm transition-all hover:bg-background hover:shadow-sm focus:outline-none",
                                                currentType === t.type
                                                    ? "bg-background text-primary shadow-sm ring-1 ring-border"
                                                    : "text-muted-foreground"
                                            )}
                                        >
                                            <t.icon className="w-4 h-4" />
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Export Button */}
                            <button
                                onClick={handleExport}
                                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                title="Export to Excel"
                            >
                                <Download className="w-4 h-4" />
                            </button>

                            {/* Maximize Button */}
                            <button
                                onClick={() => setIsExpanded(true)}
                                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                title="Maximize"
                            >
                                <Maximize2 className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
                <div className="p-4 pt-2">
                    {renderChartContent('390px')}
                </div>
            </div>

            {/* Full Screen Modal */}
            {isExpanded && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 sm:p-8">
                    <div className="w-full max-w-6xl h-[90vh] bg-card border shadow-2xl rounded-xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between p-4 border-b">
                            <h2 className="text-lg font-semibold">{data.title}</h2>
                            <div className="flex items-center gap-2">
                                {!isTableOnly && (
                                    <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-md">
                                        {chartTypes.map((t) => (
                                            <button
                                                key={t.type}
                                                onClick={() => setCurrentType(t.type)}
                                                title={t.label}
                                                className={cn(
                                                    "p-1.5 rounded-sm transition-all hover:bg-background hover:shadow-sm focus:outline-none",
                                                    currentType === t.type
                                                        ? "bg-background text-primary shadow-sm ring-1 ring-border"
                                                        : "text-muted-foreground"
                                                )}
                                            >
                                                <t.icon className="w-4 h-4" />
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <button
                                    onClick={handleExport}
                                    className="p-2 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                    title="Export to Excel"
                                >
                                    <Download className="w-5 h-5" />
                                </button>
                                <button
                                    onClick={() => setIsExpanded(false)}
                                    className="p-2 rounded-md hover:bg-destructive/10 hover:text-destructive transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 p-6 overflow-hidden">
                            {renderChartContent('calc(90vh - 150px)')}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
