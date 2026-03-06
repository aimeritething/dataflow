"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { ChatSidebar } from "./sqlbot/ChatSidebar";
import { ChatWindow } from "./sqlbot/ChatWindow";
import { useSqlBotStore } from "@/stores/useSqlBotStore";

interface AIPanelProps {
    isOpen: boolean;
}

export function AIPanel({ isOpen }: AIPanelProps) {
    const { isSidebarOpen } = useSqlBotStore();

    return (
        <div
            className={cn(
                "relative border-l bg-background transition-all duration-300 ease-in-out z-20 group",
                "shadow-[-4px_0_20px_-2px_rgba(0,0,0,0.1)] dark:shadow-[-4px_0_20px_-2px_rgba(0,0,0,0.3)]",
                isOpen ? "w-[800px] max-w-[90vw]" : "w-0"
            )}
        >
            {/* Visual Separator / Resize Handle Indicator */}
            <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-[3px] w-1.5 h-16 flex flex-col justify-center items-center gap-1 z-50 pointer-events-none opacity-0 transition-opacity duration-300 delay-100 group-hover:opacity-100">
                <div className="w-1 h-1 rounded-full bg-border" />
                <div className="w-1 h-1 rounded-full bg-border" />
                <div className="w-1 h-1 rounded-full bg-border" />
            </div>

            {/* Border Highlight Line */}
            <div className={cn(
                "absolute left-0 top-0 bottom-0 w-[1px] bg-gradient-to-b from-transparent via-primary/20 to-transparent opacity-50",
                !isOpen && "hidden"
            )} />

            <div className={cn("flex h-full w-full overflow-hidden", !isOpen && "hidden")}>
                {/* Left Sidebar (History) */}
                <div
                    className={cn(
                        "transition-all duration-300 ease-in-out border-r shrink-0",
                        isSidebarOpen ? "w-[30%] min-w-[200px]" : "w-0 overflow-hidden border-none"
                    )}
                >
                    <ChatSidebar />
                </div>

                {/* Right Main Area (Chat) */}
                <div className="flex-1 min-w-0 h-full">
                    <ChatWindow />
                </div>
            </div>
        </div>
    );
}
