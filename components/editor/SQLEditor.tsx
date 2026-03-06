"use client";

import React from "react";
import { Play, Save, Eraser, Copy } from "lucide-react";

export function SQLEditor() {
    return (
        <div className="flex h-full flex-col">
            {/* Toolbar */}
            <div className="flex h-12 items-center justify-between border-b px-4">
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1 text-sm">
                        <span className="text-muted-foreground">Connection:</span>
                        <span className="font-medium">production_connection</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1 text-sm">
                        <span className="text-muted-foreground">Database:</span>
                        <span className="font-medium">production_db</span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button className="flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 transition-colors">
                        <Play className="h-4 w-4" />
                        Run
                    </button>
                    <div className="h-6 w-px bg-border mx-1" />
                    <button className="p-2 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted">
                        <Save className="h-4 w-4" />
                    </button>
                    <button className="p-2 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted">
                        <Eraser className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* Editor Area */}
            <div className="flex-1 bg-background p-4 font-mono text-sm relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-12 bg-muted/10 border-r flex flex-col items-end pr-2 pt-4 text-muted-foreground select-none">
                    <div>1</div>
                    <div>2</div>
                    <div>3</div>
                </div>
                <div className="pl-14 pt-0 h-full outline-none" contentEditable spellCheck={false} suppressContentEditableWarning={true}>
                    <span className="text-purple-600 font-bold">SELECT</span> * <span className="text-purple-600 font-bold">FROM</span> users <span className="text-purple-600 font-bold">LIMIT</span> 100;
                </div>
            </div>
        </div>
    );
}
