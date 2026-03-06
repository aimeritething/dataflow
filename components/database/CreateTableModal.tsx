"use client";

import React, { useState } from "react";
import { AlertModal } from "@/components/ui/AlertModal";

import { X, Table, Save, Loader2, Plus, Trash2, Sparkles, Wand2 } from "lucide-react";
import { useConnections } from "@/contexts/ConnectionContext";
import { cn } from "@/lib/utils";

interface CreateTableModalProps {
    isOpen: boolean;
    onClose: () => void;
    connectionId: string;
    databaseName: string;
    onSuccess?: () => void; // Callback to refresh tree data
}

interface ColumnDefinition {
    id: string;
    name: string;
    type: string;
    isPrimaryKey: boolean;
    isNullable: boolean;
}

const COLUMN_TYPES = [
    "INT", "VARCHAR(255)", "TEXT", "BOOLEAN", "DATE", "DATETIME", "DECIMAL", "FLOAT", "JSON"
];

export function CreateTableModal({ isOpen, onClose, connectionId, databaseName, onSuccess }: CreateTableModalProps) {
    const { createTable } = useConnections();
    const [mode, setMode] = useState<"manual" | "ai">("manual");
    const [tableName, setTableName] = useState("");
    const [columns, setColumns] = useState<ColumnDefinition[]>([
        { id: "1", name: "id", type: "INT", isPrimaryKey: true, isNullable: false }
    ]);
    const [aiPrompt, setAiPrompt] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Alert State
    const [alert, setAlert] = useState<{
        isOpen: boolean;
        type: 'success' | 'error';
        title: string;
        message: string;
    }>({
        isOpen: false,
        type: 'success', // Default
        title: '',
        message: ''
    });

    if (!isOpen) return null;

    const handleAddColumn = () => {
        setColumns([
            ...columns,
            {
                id: Math.random().toString(36).substr(2, 9),
                name: "",
                type: "VARCHAR(255)",
                isPrimaryKey: false,
                isNullable: true
            }
        ]);
    };

    const handleRemoveColumn = (id: string) => {
        setColumns(columns.filter(c => c.id !== id));
    };

    const updateColumn = (id: string, field: keyof ColumnDefinition, value: any) => {
        setColumns(columns.map(c => c.id === id ? { ...c, [field]: value } : c));
    };

    const handleAiGenerate = async () => {
        if (!aiPrompt.trim()) return;

        setIsGenerating(true);

        try {
            const response = await fetch('/api/ai-chat/generate-schema', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: aiPrompt,
                    databaseType: 'mysql', // TODO: Could be passed from parent based on connection type
                }),
            });

            const data = await response.json();

            if (data.success && data.columns) {
                setColumns(data.columns);
                if (data.tableName && !tableName) {
                    setTableName(data.tableName);
                }
                setMode("manual"); // Switch to manual to review
            } else {
                console.error('AI Schema Generation failed:', data.error);
                // Fallback to basic structure
                setColumns([
                    { id: "fallback_1", name: "id", type: "INT", isPrimaryKey: true, isNullable: false },
                    { id: "fallback_2", name: "name", type: "VARCHAR(255)", isPrimaryKey: false, isNullable: true },
                ]);
                setMode("manual");
            }
        } catch (error) {
            console.error('Error calling AI Schema API:', error);
            // Fallback to basic structure on error
            setColumns([
                { id: "error_1", name: "id", type: "INT", isPrimaryKey: true, isNullable: false },
                { id: "error_2", name: "name", type: "VARCHAR(255)", isPrimaryKey: false, isNullable: true },
            ]);
            setMode("manual");
        } finally {
            setIsGenerating(false);
        }
    };

    const handleSave = async () => {
        if (!tableName || columns.length === 0) return;

        setIsSaving(true);
        try {
            const success = await createTable(connectionId, databaseName, tableName, columns);

            if (success) {
                setAlert({
                    isOpen: true,
                    type: 'success',
                    title: 'Table Created',
                    message: `Table "${tableName}" has been successfully created.`
                });
            } else {
                throw new Error("Failed to create table");
            }
        } catch (error) {
            setAlert({
                isOpen: true,
                type: 'error',
                title: 'Creation Failed',
                message: error instanceof Error ? error.message : "An unknown error occurred while creating the table."
            });
        } finally {
            setIsSaving(false);
        }
    };

    const handleAlertClose = () => {
        setAlert(prev => ({ ...prev, isOpen: false }));
        if (alert.type === 'success') {
            if (onSuccess) onSuccess();
            onClose();
        }
    };

    return (
        <>
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                {/* ... existing modal content ... */}
                <div className="w-full max-w-4xl rounded-xl bg-background shadow-2xl border animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
                    {/* ... header ... */}
                    <div className="flex items-center justify-between border-b px-6 py-4">
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                            <Table className="h-5 w-5 text-emerald-500" />
                            Create Table
                        </h2>
                        <button onClick={onClose} className="rounded-full p-1 hover:bg-muted transition-colors">
                            <X className="h-5 w-5" />
                        </button>
                    </div>

                    {/* ... tabs ... */}
                    <div className="flex border-b">
                        <button
                            onClick={() => setMode("manual")}
                            className={cn(
                                "flex-1 px-6 py-3 text-sm font-medium transition-colors border-b-2",
                                mode === "manual" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                            )}
                        >
                            Manual Definition
                        </button>
                        <button
                            onClick={() => setMode("ai")}
                            className={cn(
                                "flex-1 px-6 py-3 text-sm font-medium transition-colors border-b-2 flex items-center justify-center gap-2",
                                mode === "ai" ? "border-purple-500 text-purple-600" : "border-transparent text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <Sparkles className="h-4 w-4" />
                            AI Generate
                        </button>
                    </div>

                    {/* ... body ... */}
                    <div className="flex-1 overflow-y-auto p-6">
                        {mode === "manual" ? (
                            <div className="space-y-6">
                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase">
                                        Table Name
                                    </label>
                                    <input
                                        type="text"
                                        value={tableName}
                                        onChange={(e) => setTableName(e.target.value)}
                                        placeholder="e.g., users"
                                        className="w-full max-w-md rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs font-medium text-muted-foreground uppercase">
                                            Columns
                                        </label>
                                        <button
                                            onClick={handleAddColumn}
                                            className="text-xs flex items-center gap-1 text-primary hover:underline"
                                        >
                                            <Plus className="h-3 w-3" />
                                            Add Column
                                        </button>
                                    </div>

                                    <div className="rounded-md border">
                                        <table className="w-full text-sm">
                                            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                                                <tr>
                                                    <th className="px-4 py-2 text-left font-medium">Name</th>
                                                    <th className="px-4 py-2 text-left font-medium">Type</th>
                                                    <th className="px-4 py-2 text-center font-medium w-20">PK</th>
                                                    <th className="px-4 py-2 text-center font-medium w-20">Null</th>
                                                    <th className="px-4 py-2 w-10"></th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y">
                                                {columns.map((col) => (
                                                    <tr key={col.id} className="group hover:bg-muted/30">
                                                        <td className="p-2">
                                                            <input
                                                                type="text"
                                                                value={col.name}
                                                                onChange={(e) => updateColumn(col.id, "name", e.target.value)}
                                                                placeholder="column_name"
                                                                className="w-full rounded border-transparent bg-transparent px-2 py-1 focus:border-primary focus:bg-background outline-none"
                                                            />
                                                        </td>
                                                        <td className="p-2">
                                                            <select
                                                                value={col.type}
                                                                onChange={(e) => updateColumn(col.id, "type", e.target.value)}
                                                                className="w-full rounded border-transparent bg-transparent px-2 py-1 focus:border-primary focus:bg-background outline-none"
                                                            >
                                                                {COLUMN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                                            </select>
                                                        </td>
                                                        <td className="p-2 text-center">
                                                            <input
                                                                type="checkbox"
                                                                checked={col.isPrimaryKey}
                                                                onChange={(e) => updateColumn(col.id, "isPrimaryKey", e.target.checked)}
                                                                className="rounded border-muted-foreground"
                                                            />
                                                        </td>
                                                        <td className="p-2 text-center">
                                                            <input
                                                                type="checkbox"
                                                                checked={col.isNullable}
                                                                onChange={(e) => updateColumn(col.id, "isNullable", e.target.checked)}
                                                                className="rounded border-muted-foreground"
                                                            />
                                                        </td>
                                                        <td className="p-2 text-center">
                                                            <button
                                                                onClick={() => handleRemoveColumn(col.id)}
                                                                className="text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col h-full items-center justify-center space-y-6 py-12">
                                <div className="bg-purple-50 p-4 rounded-full">
                                    <Wand2 className="h-8 w-8 text-purple-600" />
                                </div>
                                <div className="text-center max-w-md space-y-2">
                                    <h3 className="text-lg font-semibold">Describe your table</h3>
                                    <p className="text-sm text-muted-foreground">
                                        Describe the data you want to store, and AI will generate the table structure for you.
                                    </p>
                                </div>
                                <div className="w-full max-w-xl space-y-4">
                                    <textarea
                                        value={aiPrompt}
                                        onChange={(e) => setAiPrompt(e.target.value)}
                                        placeholder="e.g., Create a products table with name, price, stock quantity, and category..."
                                        className="w-full h-32 rounded-lg border bg-background p-4 text-sm outline-none focus:border-purple-500 resize-none shadow-sm"
                                    />
                                    <button
                                        onClick={handleAiGenerate}
                                        disabled={!aiPrompt.trim() || isGenerating}
                                        className="w-full rounded-lg bg-purple-600 py-3 text-sm font-medium text-white hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {isGenerating ? (
                                            <>
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                Generating Schema...
                                            </>
                                        ) : (
                                            <>
                                                <Sparkles className="h-4 w-4" />
                                                Generate Table Structure
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center justify-end gap-3 border-t bg-muted/5 px-6 py-4">
                        <button
                            onClick={onClose}
                            className="rounded-md px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
                        >
                            Cancel
                        </button>
                        {mode === "manual" && (
                            <button
                                onClick={handleSave}
                                disabled={!tableName || columns.length === 0 || isSaving}
                                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                            >
                                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                Create Table
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <AlertModal
                isOpen={alert.isOpen}
                onClose={handleAlertClose}
                title={alert.title}
                message={alert.message}
                type={alert.type}
            />
        </>
    );
}
