"use client";

import React, { useState } from "react";
import { Sparkles } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { AIPanel } from "../ai/AIPanel";
import { cn } from "@/lib/utils";

import { ActivityBar, ActivityTab } from "./ActivityBar";
import { AIAssistantView } from "../ai/AIAssistantView";
import { AnalysisView } from "../analysis/AnalysisView";
import { TabProvider } from "@/contexts/TabContext";
import { TabBar } from "./TabBar";
import { TabContent } from "./TabContent";

interface MainLayoutProps {
    children?: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
    const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<ActivityTab>('connections');
    const [collectionRefreshTrigger, setCollectionRefreshTrigger] = useState(0);

    // Determine if the AI Assistant button should be visible
    const showAIAssistantButton = false; // Temporarily hidden

    // Determine if the Sidebar (Database Tree) should be visible
    // Currently only for 'connections', but could be others if needed
    const showSidebar = activeTab === 'connections';

    const handleRefreshCollection = () => {
        console.log('[MainLayout] 🔄 Refresh triggered! Current counter:', collectionRefreshTrigger);
        setCollectionRefreshTrigger(prev => {
            const newValue = prev + 1;
            console.log('[MainLayout] ✅ Counter updated:', prev, '->', newValue);
            return newValue;
        });
    };

    return (
        <TabProvider>
            <div className="flex h-screen w-full overflow-hidden bg-background">
                <ActivityBar activeTab={activeTab} onTabChange={setActiveTab} />

                {showSidebar && (
                    <Sidebar
                        onRefreshCollection={handleRefreshCollection}
                    />
                )}

                <main className="flex flex-1 flex-col overflow-hidden relative">
                    {activeTab === 'connections' ? (
                        <>
                            <TabBar />
                            <TabContent refreshTrigger={collectionRefreshTrigger} />
                        </>
                    ) : activeTab === 'ai-assistant' ? (
                        <AIAssistantView />
                    ) : activeTab === 'analysis' ? (
                        <AnalysisView />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                            {activeTab === 'settings' && "Settings View (Coming Soon)"}
                        </div>
                    )}

                    {/* AI Assistant Toggle Button */}
                    {showAIAssistantButton && (
                        <button
                            onClick={() => setIsAIPanelOpen(!isAIPanelOpen)}
                            className={cn(
                                "absolute right-6 top-4 z-50 flex items-center gap-2 py-2 px-4 rounded-full border border-border/50 bg-white/80 backdrop-blur-md shadow-nebula-float hover:shadow-lg hover:bg-white transition-all duration-300 text-sm font-medium text-foreground group",
                                isAIPanelOpen && "bg-primary/5 border-primary/20 text-primary"
                            )}
                            title={isAIPanelOpen ? "Close AI Assistant" : "Open AI Assistant"}
                        >
                            <Sparkles className={cn("h-4 w-4 transition-colors", isAIPanelOpen ? "text-primary" : "text-purple-500 group-hover:text-purple-600")} />
                            <span className="bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent font-semibold">AI Assistant</span>
                        </button>
                    )}
                </main>

                <AIPanel
                    isOpen={isAIPanelOpen}
                />
            </div>
        </TabProvider>
    );
}

