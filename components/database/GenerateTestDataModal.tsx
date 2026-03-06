
"use client";

import React, { useState, useEffect } from "react";
import { X, Sparkles, Loader2, Database, Play, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConnections } from "@/contexts/ConnectionContext";

interface GenerateTestDataModalProps {
    isOpen: boolean;
    onClose: () => void;
    connectionId: string;
    databaseName: string;
    schema?: string | null;
    tableName: string;
    isCollection?: boolean;
    onSuccess?: () => void;
}

export function GenerateTestDataModal({
    isOpen,
    onClose,
    connectionId,
    databaseName,
    schema,
    tableName,
    isCollection = false,
    onSuccess
}: GenerateTestDataModalProps) {
    const [rowCount, setRowCount] = useState(100);
    const [aiInstructions, setAiInstructions] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);
    const [progress, setProgress] = useState(0);
    const [statusMessage, setStatusMessage] = useState("");
    const [isSuccess, setIsSuccess] = useState(false);
    const [detectedSchema, setDetectedSchema] = useState<string | null>(null);

    // Reset state when modal opens
    useEffect(() => {
        if (isOpen) {
            setRowCount(100);
            setAiInstructions("");
            setIsGenerating(false);
            setProgress(0);
            setStatusMessage("");
            setIsSuccess(false);
            setDetectedSchema(null);
        }
    }, [isOpen]);

    // Import useConnections to get connection details
    const { connections } = useConnections();

    if (!isOpen) return null;

    const handleGenerate = async () => {
        console.log('[Frontend] 🚀 Generate button clicked');
        setIsGenerating(true);
        setProgress(0);
        setStatusMessage("Initializing generation...");
        setIsSuccess(false);

        try {
            // Get connection details from context
            const conn = connections.find(c => c.id === connectionId);
            console.log('[Frontend] 🔍 Connection lookup:', { connectionId, found: !!conn });
            if (!conn) {
                throw new Error('Connection not found');
            }

            const requestBody = {
                type: conn.type.toLowerCase(),
                host: conn.host,
                port: conn.port,
                user: conn.user,
                password: conn.password,
                database: databaseName,
                schema: schema || null,
                table: tableName,
                rowCount,
                aiInstructions,
                isCollection
            };

            console.log('[Frontend] 📤 Sending request to API:', {
                ...requestBody,
                password: '***HIDDEN***'
            });

            const response = await fetch('/api/connections/generate-test-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });

            console.log('[Frontend] 📥 Response received:', {
                status: response.status,
                ok: response.ok,
                statusText: response.statusText
            });

            if (!response.ok) {
                throw new Error('Failed to start test data generation');
            }

            // Read streaming response
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (!reader) {
                console.error('[Frontend] ❌ No response body found');
                throw new Error('No response body');
            }

            console.log('[Frontend] 📖 Starting to read stream...');

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = JSON.parse(line.slice(6));
                        console.log('[Frontend] 📊 Progress update:', data);

                        // Check if this is a schema message
                        if (data.message && data.message.startsWith('schema:')) {
                            const schemaName = data.message.substring(7); // Remove 'schema:' prefix
                            setDetectedSchema(schemaName);
                            console.log('[Frontend] 🔍 Detected schema:', schemaName);
                        } else {
                            setProgress(data.progress);
                            setStatusMessage(data.message);
                        }
                    }
                }
            }

            console.log('[Frontend] ✅ Stream reading complete');

            // Generation complete - show success
            console.log('[Frontend] 🎉 Generation complete!');
            setIsSuccess(true);
            setStatusMessage("Test data generated successfully!");

            // Call global refresh function if available
            if (typeof (window as any).__refreshTableDetailView === 'function') {
                console.log('[Frontend] 🔄 Calling table refresh function');
                (window as any).__refreshTableDetailView();
            } else {
                console.warn('[Frontend] ⚠️ Table refresh function not found');
            }

            setIsGenerating(false);
            if (onSuccess) onSuccess();

        } catch (error: any) {
            console.error('[Frontend] ❌ Error generating test data:', error);
            console.error('[Frontend] Error stack:', error.stack);
            setStatusMessage(`Error: ${error.message} `);
            setIsGenerating(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-background rounded-lg shadow-lg w-full max-w-md flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-primary/10 rounded-lg">
                            <Sparkles className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold">Generate Test Data</h2>
                            <p className="text-xs text-muted-foreground">
                                For {isCollection ? 'collection' : 'table'}: <span className="font-medium text-foreground">{tableName}</span>
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-full p-1 hover:bg-muted transition-colors"
                        disabled={isGenerating}
                    >
                        <X className="h-4 w-4 text-muted-foreground" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-6">
                    {isSuccess ? (
                        <div className="flex flex-col items-center justify-center py-4 space-y-3 animate-in fade-in zoom-in duration-300">
                            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                                <CheckCircle className="h-8 w-8 text-green-600" />
                            </div>
                            <h3 className="text-lg font-medium text-green-700">Generation Complete</h3>
                            <p className="text-sm text-muted-foreground text-center">
                                Successfully generated {rowCount} rows of test data.<br />
                                The table view will refresh automatically.
                            </p>
                        </div>
                    ) : (
                        <>
                            {/* Row Count Input */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                    Number of Rows
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    max="10000"
                                    value={rowCount}
                                    onChange={(e) => setRowCount(parseInt(e.target.value) || 0)}
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    disabled={isGenerating}
                                />
                                <p className="text-xs text-muted-foreground">
                                    How many records do you want to generate?
                                </p>
                            </div>

                            {/* AI Instructions Input */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2">
                                    AI Instructions <span className="text-xs font-normal text-muted-foreground">(Optional)</span>
                                </label>
                                <textarea
                                    value={aiInstructions}
                                    onChange={(e) => setAiInstructions(e.target.value)}
                                    placeholder="E.g., Generate users with realistic US addresses and gmail.com emails. Ensure 'status' is mostly 'active'."
                                    className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                                    disabled={isGenerating}
                                />
                                <p className="text-xs text-muted-foreground">
                                    Describe specific patterns or constraints for the data.
                                </p>
                            </div>

                            {/* Progress Bar */}
                            {isGenerating && (
                                <div className="space-y-2 pt-2 animate-in fade-in slide-in-from-bottom-2">
                                    <div className="flex justify-between text-xs text-muted-foreground">
                                        <span>{statusMessage}</span>
                                        <span>{Math.round(progress)}%</span>
                                    </div>
                                    <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                                        <div
                                            className="h-full bg-purple-600 transition-all duration-300 ease-in-out"
                                            style={{ width: `${progress}% ` }}
                                        />
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="border-t px-6 py-4 flex justify-end gap-3 bg-muted/5">
                    {isSuccess ? (
                        <button
                            onClick={onClose}
                            className="px-4 py-2 rounded-md bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 transition-colors shadow-sm"
                        >
                            Close
                        </button>
                    ) : (
                        <>
                            <button
                                onClick={onClose}
                                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                                disabled={isGenerating}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleGenerate}
                                disabled={isGenerating || rowCount <= 0}
                                className="flex items-center gap-2 px-4 py-2 rounded-md bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                            >
                                {isGenerating ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Generating...
                                    </>
                                ) : (
                                    <>
                                        <Play className="h-4 w-4 fill-current" />
                                        Generate Data
                                    </>
                                )}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

