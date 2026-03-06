"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { ChatSidebar } from "./sqlbot/ChatSidebar";
import { ChatWindow } from "./sqlbot/ChatWindow";
import { useSqlBotStore } from "@/stores/useSqlBotStore";

export function AIAssistantView() {
    const { isSidebarOpen } = useSqlBotStore();

    return (
        <div className="flex h-full w-full overflow-hidden bg-background">
            {/* Left Sidebar (History) */}
            <div
                className={cn(
                    "transition-all duration-300 ease-in-out border-r shrink-0",
                    isSidebarOpen ? "w-64" : "w-0 overflow-hidden border-none"
                )}
            >
                <ChatSidebar />
            </div>

            {/* Right Main Area (Chat) */}
            <div className="flex-1 min-w-0 h-full">
                <ChatWindow />
            </div>
        </div>
    );
}
