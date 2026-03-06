"use client";

import React from 'react';
import { Message } from '@/types/sqlbot';
import { cn } from '@/lib/utils';
import { Bot, User, Loader2 } from 'lucide-react';
import { ChartRenderer } from './ChartRenderer';

interface MessageBubbleProps {
    message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
    const isUser = message.role === 'user';

    return (
        <div className={cn(
            "flex w-full gap-3 mb-4",
            isUser ? "flex-row-reverse" : "flex-row"
        )}>
            {/* Avatar */}
            <div className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border shadow-sm",
                isUser ? "bg-primary text-primary-foreground" : "bg-white text-muted-foreground border-border"
            )}>
                {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
            </div>

            {/* Content Container */}
            <div className={cn(
                "flex flex-col max-w-[85%]",
                isUser ? "items-end" : "items-start"
            )}>
                {/* Bubble */}
                <div className={cn(
                    "rounded-2xl px-4 py-3 text-sm shadow-sm",
                    isUser
                        ? "bg-primary text-primary-foreground rounded-tr-sm"
                        : "bg-white border border-border/50 text-foreground rounded-tl-sm"
                )}>
                    {message.isLoading ? (
                        <div className="flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Thinking...</span>
                        </div>
                    ) : (
                        <div className="whitespace-pre-wrap leading-relaxed">
                            {/* Render markdown bold text */}
                            {message.content.split(/(\*\*[^*]+\*\*)/).map((part, i) => {
                                if (part.startsWith('**') && part.endsWith('**')) {
                                    return (
                                        <span key={i} className="font-bold text-primary">
                                            {part.slice(2, -2)}
                                        </span>
                                    );
                                }
                                return part;
                            })}
                        </div>
                    )}
                </div>

                {/* Chart (only for assistant) */}
                {!isUser && message.chart && (
                    <div className="w-full mt-3 min-w-[300px] lg:min-w-[800px] xl:min-w-[900px] bg-white rounded-xl border shadow-sm p-4 overflow-hidden">
                        <ChartRenderer data={message.chart} />
                    </div>
                )}

                <span
                    className="text-[10px] text-muted-foreground mt-1 px-1"
                    suppressHydrationWarning
                >
                    {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
            </div>
        </div>
    );
}
