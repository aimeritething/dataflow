"use client";

import React from "react";
import { useAnalysisStore, ComponentType } from "@/stores/useAnalysisStore";
import { BarChart, Type, Image as ImageIcon, Activity, Filter, Table, GripVertical } from "lucide-react";

const components: { type: ComponentType; icon: React.ElementType; label: string }[] = [
    { type: 'chart', icon: BarChart, label: 'Chart' },
    { type: 'stats', icon: Activity, label: 'Statistic' },
    { type: 'table', icon: Table, label: 'Data Table' },
    { type: 'text', icon: Type, label: 'Text / Markdown' },
    { type: 'filter', icon: Filter, label: 'Filter Control' },
    { type: 'image', icon: ImageIcon, label: 'Image' },
];

export function ComponentPanel() {
    const { addComponent } = useAnalysisStore();

    const handleDragStart = (e: React.DragEvent, type: ComponentType) => {
        e.dataTransfer.setData("application/react-grid-layout", type);
        e.dataTransfer.effectAllowed = "copy";
    };

    return (
        <div className="flex flex-col h-full">
            <div className="p-4 border-b">
                <h2 className="font-semibold text-sm">Components</h2>
                <p className="text-xs text-muted-foreground">Drag to add to dashboard</p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {components.map((comp) => (
                    <div
                        key={comp.type}
                        draggable
                        onDragStart={(e) => handleDragStart(e, comp.type)}
                        onClick={() => addComponent(comp.type)} // Click to add as fallback
                        className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:border-primary/50 hover:shadow-sm cursor-grab active:cursor-grabbing transition-all group"
                    >
                        <div className="p-2 rounded-md bg-muted group-hover:bg-primary/10 text-muted-foreground group-hover:text-primary transition-colors">
                            <comp.icon className="w-4 h-4" />
                        </div>
                        <span className="text-sm font-medium">{comp.label}</span>
                        <GripVertical className="w-4 h-4 text-muted-foreground/30 ml-auto opacity-0 group-hover:opacity-100" />
                    </div>
                ))}
            </div>
        </div>
    );
}
