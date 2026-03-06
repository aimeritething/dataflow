"use client";

import React from "react";
import { CheckCircle2, FileText } from "lucide-react";

export function ResultGrid() {
    return (
        <div className="flex h-full flex-col border-t bg-background">
            {/* Tabs */}
            <div className="flex items-center border-b bg-muted/20">
                <button className="flex items-center gap-2 border-b-2 border-primary bg-background px-4 py-2 text-sm font-medium text-primary">
                    <FileText className="h-4 w-4" />
                    Result Grid
                </button>
                <button className="flex items-center gap-2 border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
                    <CheckCircle2 className="h-4 w-4" />
                    Messages
                </button>
            </div>

            {/* Grid Content */}
            <div className="flex-1 overflow-auto p-0">
                <table className="w-full min-w-max text-left text-sm">
                    <thead className="bg-muted/50 text-muted-foreground">
                        <tr>
                            <th className="border-b px-4 py-2 font-medium">id</th>
                            <th className="border-b px-4 py-2 font-medium">first_name</th>
                            <th className="border-b px-4 py-2 font-medium">last_name</th>
                            <th className="border-b px-4 py-2 font-medium">email</th>
                            <th className="border-b px-4 py-2 font-medium">role</th>
                            <th className="border-b px-4 py-2 font-medium">status</th>
                            <th className="border-b px-4 py-2 font-medium">created_at</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {Array.from({ length: 10 }).map((_, i) => (
                            <tr key={i} className="hover:bg-muted/30">
                                <td className="px-4 py-2 font-mono text-muted-foreground">{i + 1}</td>
                                <td className="px-4 py-2">James</td>
                                <td className="px-4 py-2">Wilson</td>
                                <td className="px-4 py-2 text-blue-600">james.w@{i}example.com</td>
                                <td className="px-4 py-2">
                                    <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                                        Admin
                                    </span>
                                </td>
                                <td className="px-4 py-2">
                                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                                        Active
                                    </span>
                                </td>
                                <td className="px-4 py-2 text-muted-foreground">2023-11-26 10:30:00</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t bg-muted/20 px-4 py-1 text-xs text-muted-foreground">
                <div>10 rows in set</div>
                <div>Query took 0.045s</div>
            </div>
        </div>
    );
}
