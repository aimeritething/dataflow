import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';

interface RenameModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (newName: string) => void;
    currentName: string;
    title?: string;
}

export function RenameModal({ isOpen, onClose, onConfirm, currentName, title = "重命名" }: RenameModalProps) {
    const [name, setName] = useState(currentName);

    useEffect(() => {
        if (isOpen) {
            setName(currentName);
        }
    }, [isOpen, currentName]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-background w-full max-w-md rounded-xl shadow-2xl border animate-in fade-in zoom-in-95 duration-200">
                <div className="p-6 space-y-6">
                    <h3 className="text-lg font-semibold">{title}</h3>
                    <input
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-medium"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                onConfirm(name);
                                onClose();
                            }
                        }}
                    />
                    <div className="flex justify-end gap-3">
                        <Button variant="ghost" onClick={onClose} className="hover:bg-muted">取消</Button>
                        <Button
                            onClick={() => { onConfirm(name); onClose(); }}
                            className="bg-primary text-primary-foreground hover:bg-primary/90"
                        >
                            确认
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
