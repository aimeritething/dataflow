"use client";

import React, { useState, useEffect } from 'react';
import { useSqlBotStore } from '@/stores/useSqlBotStore';
import { cn } from '@/lib/utils';
import { Search, MessageSquare, Trash2, Edit2, PlusCircle } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { ContextMenu } from '@/components/ui/ContextMenu';
import { RenameModal } from './RenameModal';
import { ConfirmationModal } from '@/components/ui/ConfirmationModal';

import { DataSourceSelector } from './DataSourceSelector';

export function ChatSidebar() {
    const {
        conversations,
        currentConversationId,
        selectConversation,
        createConversation,
        deleteConversation,
        updateConversationTitle,
        initializeFromAPI,
        isInitialized
    } = useSqlBotStore();

    const [searchTerm, setSearchTerm] = useState('');
    const [isSelectorOpen, setIsSelectorOpen] = useState(false);

    // Modals State
    const [renameModal, setRenameModal] = useState({ isOpen: false, id: '', name: '' });
    const [deleteModal, setDeleteModal] = useState({ isOpen: false, id: '', name: '' });

    // Context Menu State
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string; title: string } | null>(null);

    // Initialize conversations from API on mount
    useEffect(() => {
        if (!isInitialized) {
            initializeFromAPI();
        }
    }, [isInitialized, initializeFromAPI]);

    // Close context menu on click outside
    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, []);

    const filteredConversations = conversations.filter(c =>
        c.title.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleCreateChat = () => {
        setIsSelectorOpen(true);
    };

    const handleConfirmSource = (source: any) => {
        createConversation(source);
        setIsSelectorOpen(false);
    };

    const handleContextMenu = (e: React.MouseEvent, conv: any) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, id: conv.id, title: conv.title });
    };

    const handleRenameConfirm = (newName: string) => {
        if (renameModal.id && newName.trim()) {
            updateConversationTitle(renameModal.id, newName);
        }
        setRenameModal({ ...renameModal, isOpen: false });
    };

    const handleDeleteConfirm = () => {
        if (deleteModal.id) {
            deleteConversation(deleteModal.id);
        }
        setDeleteModal({ ...deleteModal, isOpen: false });
    };

    return (
        <>
            <div className="flex flex-col h-full border-r bg-background">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b h-14 shrink-0">
                    <h2 className="font-semibold text-sm">AI 对话</h2>
                    <button
                        onClick={handleCreateChat}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title="新对话"
                    >
                        <PlusCircle className="h-5 w-5" />
                    </button>
                </div>

                {/* Search */}
                <div className="p-3 border-b">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                        <Input
                            type="text"
                            placeholder="搜索历史..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-8 pr-3 py-1.5 h-8 rounded-md border bg-muted/20 text-xs focus:outline-none focus:ring-1 focus:ring-primary/20"
                        />
                    </div>
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {filteredConversations.length === 0 ? (
                        <div className="text-center text-muted-foreground text-xs py-8">
                            No conversations found
                        </div>
                    ) : (
                        filteredConversations.map(conv => (
                            <div
                                key={conv.id}
                                onClick={() => selectConversation(conv.id)}
                                onContextMenu={(e) => handleContextMenu(e, conv)}
                                className={cn(
                                    "group flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors text-sm",
                                    currentConversationId === conv.id
                                        ? "bg-primary/10 text-primary font-medium"
                                        : "hover:bg-muted text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <MessageSquare className="h-4 w-4 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="truncate font-medium">{conv.title}</div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            <DataSourceSelector
                isOpen={isSelectorOpen}
                onClose={() => setIsSelectorOpen(false)}
                onConfirm={handleConfirmSource}
            />

            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={() => setContextMenu(null)}
                    items={[
                        {
                            label: '重命名',
                            icon: <Edit2 className="h-4 w-4" />,
                            onClick: () => {
                                setRenameModal({ isOpen: true, id: contextMenu.id, name: contextMenu.title });
                            }
                        },
                        { separator: true },
                        {
                            label: '删除',
                            icon: <Trash2 className="h-4 w-4" />,
                            danger: true,
                            onClick: () => {
                                setDeleteModal({ isOpen: true, id: contextMenu.id, name: contextMenu.title });
                            }
                        }
                    ]}
                />
            )}

            <RenameModal
                isOpen={renameModal.isOpen}
                onClose={() => setRenameModal({ ...renameModal, isOpen: false })}
                onConfirm={handleRenameConfirm}
                currentName={renameModal.name}
                title="重命名对话"
            />

            <ConfirmationModal
                isOpen={deleteModal.isOpen}
                onClose={() => setDeleteModal({ ...deleteModal, isOpen: false })}
                onConfirm={handleDeleteConfirm}
                title="删除对话"
                message={`确定要删除 "${deleteModal.name}" 吗？此操作无法撤销。`}
                confirmText="删除"
                cancelText="取消"
                isDestructive={true}
            />
        </>
    );
}
