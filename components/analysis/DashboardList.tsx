"use client";

import React, { useState } from "react";
import { useAnalysisStore } from "@/stores/useAnalysisStore";
import { Plus, Search, LayoutDashboard, MoreVertical, Trash2, Edit2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export function DashboardList() {
    const { dashboards, createDashboard, openDashboard, deleteDashboard, isDashboardNameExists } = useAnalysisStore();
    const [searchQuery, setSearchQuery] = useState("");
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [newDashboardName, setNewDashboardName] = useState("");
    const [newDashboardDesc, setNewDashboardDesc] = useState("");
    const [nameError, setNameError] = useState<string | null>(null);

    const filteredDashboards = dashboards.filter(d =>
        d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        d.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleCreate = () => {
        if (!newDashboardName.trim()) return;
        if (isDashboardNameExists(newDashboardName)) {
            setNameError('仪表板名称已存在，请使用其他名称');
            return;
        }
        createDashboard(newDashboardName, newDashboardDesc);
        setIsCreateModalOpen(false);
        setNewDashboardName("");
        setNewDashboardDesc("");
        setNameError(null);
    };

    return (
        <div className="flex flex-col h-full w-full bg-muted/5 p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Data Analysis</h1>
                    <p className="text-muted-foreground mt-1">Manage and organize your data dashboards</p>
                </div>
                <button
                    onClick={() => setIsCreateModalOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors shadow-sm"
                >
                    <Plus className="w-4 h-4" />
                    New Dashboard
                </button>
            </div>

            {/* Search */}
            <div className="relative max-w-md mb-8">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                    type="text"
                    placeholder="Search dashboards..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                />
            </div>

            {/* Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {/* Create New Card (Alternative) */}
                <button
                    onClick={() => setIsCreateModalOpen(true)}
                    className="group flex flex-col items-center justify-center h-48 rounded-xl border-2 border-dashed border-muted-foreground/25 hover:border-primary/50 hover:bg-primary/5 transition-all"
                >
                    <div className="h-12 w-12 rounded-full bg-muted group-hover:bg-primary/10 flex items-center justify-center mb-3 transition-colors">
                        <Plus className="w-6 h-6 text-muted-foreground group-hover:text-primary" />
                    </div>
                    <span className="font-medium text-muted-foreground group-hover:text-primary">Create New Dashboard</span>
                </button>

                {filteredDashboards.map(dashboard => (
                    <div
                        key={dashboard.id}
                        onClick={() => openDashboard(dashboard.id)}
                        className="group relative flex flex-col h-48 rounded-xl border bg-card hover:shadow-md transition-all cursor-pointer overflow-hidden"
                    >
                        {/* Thumbnail Placeholder */}
                        <div className="h-24 bg-muted/30 border-b flex items-center justify-center group-hover:bg-muted/50 transition-colors">
                            <LayoutDashboard className="w-8 h-8 text-muted-foreground/40" />
                        </div>

                        <div className="flex-1 p-4">
                            <div className="flex items-start justify-between">
                                <div>
                                    <h3 className="font-semibold truncate pr-2">{dashboard.name}</h3>
                                    <p className="text-xs text-muted-foreground line-clamp-1 mt-1">
                                        {dashboard.description || "No description"}
                                    </p>
                                </div>
                                <div className="relative" onClick={e => e.stopPropagation()}>
                                    <button className="p-1 hover:bg-muted rounded-md text-muted-foreground">
                                        <MoreVertical className="w-4 h-4" />
                                    </button>
                                    {/* Dropdown would go here - simplified for now */}
                                </div>
                            </div>

                            <div className="mt-auto pt-3 flex items-center text-[10px] text-muted-foreground gap-1">
                                <Clock className="w-3 h-3" />
                                <span>Updated {new Date(dashboard.updatedAt).toLocaleDateString()}</span>
                            </div>
                        </div>

                        {/* Hover Actions */}
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm('Are you sure you want to delete this dashboard?')) {
                                        deleteDashboard(dashboard.id);
                                    }
                                }}
                                className="p-1.5 bg-background/80 backdrop-blur-sm rounded-md text-destructive hover:bg-destructive/10 border shadow-sm"
                                title="Delete"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Create Modal */}
            {isCreateModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
                    <div className="w-full max-w-md bg-card border rounded-xl shadow-lg p-6 animate-in fade-in zoom-in-95">
                        <h2 className="text-lg font-semibold mb-4">Create New Dashboard</h2>
                        <div className="space-y-4">
                            <div>
                                <label className="text-sm font-medium mb-1.5 block">Name</label>
                                <input
                                    type="text"
                                    value={newDashboardName}
                                    onChange={e => { setNewDashboardName(e.target.value); setNameError(null); }}
                                    maxLength={15}
                                    className={cn(
                                        "w-full px-3 py-2 rounded-md border bg-background",
                                        nameError && "border-destructive"
                                    )}
                                    placeholder="e.g., Q3 Sales Report"
                                    autoFocus
                                />
                                {nameError && (
                                    <p className="text-xs text-destructive mt-1">{nameError}</p>
                                )}
                            </div>
                            <div>
                                <label className="text-sm font-medium mb-1.5 block">Description (Optional)</label>
                                <textarea
                                    value={newDashboardDesc}
                                    onChange={e => setNewDashboardDesc(e.target.value)}
                                    className="w-full px-3 py-2 rounded-md border bg-background resize-none h-24"
                                    placeholder="Brief description of this dashboard..."
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 mt-6">
                            <button
                                onClick={() => { setIsCreateModalOpen(false); setNameError(null); setNewDashboardName(''); setNewDashboardDesc(''); }}
                                className="px-4 py-2 text-sm font-medium hover:bg-muted rounded-md"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreate}
                                disabled={!newDashboardName.trim()}
                                className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                            >
                                Create
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
