import { create } from 'zustand';
import { SqlBotState, Conversation, Message, SuggestedQuestion } from '@/types/sqlbot';
import { v4 as uuidv4 } from 'uuid';

// Suggestion cache with 5 minute TTL
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CachedSuggestions {
    suggestions: SuggestedQuestion[];
    timestamp: number;
    isDeep: boolean; // true if from deep analysis
}

const suggestionCache = new Map<string, CachedSuggestions>();

// API helper functions
async function fetchConversationsFromAPI(): Promise<Conversation[]> {
    try {
        const response = await fetch('/api/persist/conversations');
        const data = await response.json();
        if (data.success) {
            return data.data;
        }
    } catch (error) {
        console.error('[SqlBotStore] Failed to fetch conversations:', error);
    }
    return [];
}

async function createConversationAPI(conversation: Conversation): Promise<void> {
    try {
        await fetch('/api/persist/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: conversation.title,
                dataSource: conversation.dataSource
            })
        });
    } catch (error) {
        console.error('[SqlBotStore] Failed to create conversation:', error);
    }
}

async function deleteConversationAPI(id: string): Promise<void> {
    try {
        await fetch(`/api/persist/conversations/${id}`, {
            method: 'DELETE'
        });
    } catch (error) {
        console.error('[SqlBotStore] Failed to delete conversation:', error);
    }
}

async function updateConversationAPI(id: string, updates: any): Promise<void> {
    try {
        await fetch(`/api/persist/conversations/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
    } catch (error) {
        console.error('[SqlBotStore] Failed to update conversation:', error);
    }
}

async function addMessageAPI(conversationId: string, message: Message): Promise<void> {
    try {
        await fetch(`/api/persist/conversations/${conversationId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                role: message.role,
                content: message.content,
                chart: message.chart
            })
        });
    } catch (error) {
        console.error('[SqlBotStore] Failed to add message:', error);
    }
}

// Extended state with initialization
interface ExtendedSqlBotState extends SqlBotState {
    isInitialized: boolean;
    initializeFromAPI: () => Promise<void>;
    loadConversationMessages: (id: string) => Promise<void>;
    getCachedSuggestions: (connectionId: string, database: string) => CachedSuggestions | null;
    setCachedSuggestions: (connectionId: string, database: string, suggestions: SuggestedQuestion[], isDeep: boolean) => void;
    clearSuggestionCache: (connectionId?: string, database?: string) => void;
    prefetchSuggestions: (connectionParams: { connectionId: string; type: string; host: string; port: string; user?: string; password?: string; database: string }) => void;
}

export const useSqlBotStore = create<ExtendedSqlBotState>((set, get) => ({
    conversations: [],
    currentConversationId: null,
    isSidebarOpen: true,
    isInitialized: false,

    // Load messages for a specific conversation
    loadConversationMessages: async (id: string) => {
        try {
            const response = await fetch(`/api/persist/conversations/${id}`);
            const data = await response.json();
            if (data.success && data.data) {
                set(state => ({
                    conversations: state.conversations.map(c =>
                        c.id === id ? { ...c, messages: data.data.messages || [] } : c
                    )
                }));
            }
        } catch (error) {
            console.error('[SqlBotStore] Failed to load messages:', error);
        }
    },

    initializeFromAPI: async () => {
        if (get().isInitialized) return;

        const conversations = await fetchConversationsFromAPI();
        const firstConvId = conversations.length > 0 ? conversations[0].id : null;

        set({
            conversations,
            isInitialized: true,
            currentConversationId: firstConvId
        });

        // Load messages for the first conversation
        if (firstConvId) {
            get().loadConversationMessages(firstConvId);
        }
    },

    createConversation: async (dataSource) => {
        const newConv: Conversation = {
            id: uuidv4(),
            title: dataSource ? `Analysis: ${dataSource.name}` : 'New Conversation',
            timestamp: Date.now(),
            messages: [],
            chartCount: 0,
            dataSource
        };

        // Update local state immediately
        set(state => ({
            conversations: [newConv, ...state.conversations],
            currentConversationId: newConv.id
        }));

        // Persist to API (fire and forget)
        fetch('/api/persist/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: newConv.title,
                dataSource: newConv.dataSource
            })
        }).then(async (res) => {
            const data = await res.json();
            if (data.success && data.data.id !== newConv.id) {
                // Update local ID to match server ID
                set(state => ({
                    conversations: state.conversations.map(c =>
                        c.id === newConv.id ? { ...c, id: data.data.id } : c
                    ),
                    currentConversationId: state.currentConversationId === newConv.id
                        ? data.data.id
                        : state.currentConversationId
                }));
            }
        }).catch(err => console.error('[SqlBotStore] Failed to persist conversation:', err));
    },

    selectConversation: (id) => {
        set({ currentConversationId: id });

        // Load messages if not already loaded
        const conv = get().conversations.find(c => c.id === id);
        if (conv && (!conv.messages || conv.messages.length === 0)) {
            get().loadConversationMessages(id);
        }
    },

    deleteConversation: (id) => {
        set(state => {
            const newConvs = state.conversations.filter(c => c.id !== id);
            return {
                conversations: newConvs,
                currentConversationId: state.currentConversationId === id
                    ? (newConvs.length > 0 ? newConvs[0].id : null)
                    : state.currentConversationId
            };
        });

        // Persist to API
        deleteConversationAPI(id);
    },

    updateConversationDataSource: (id: string, updates: Partial<{ database: string }>) => {
        const conv = get().conversations.find(c => c.id === id);
        if (!conv?.dataSource) return;

        const newDataSource = { ...conv.dataSource, ...updates };

        set(state => ({
            conversations: state.conversations.map(c =>
                c.id === id && c.dataSource
                    ? { ...c, dataSource: newDataSource }
                    : c
            )
        }));

        // Persist to API
        updateConversationAPI(id, { dataSource: newDataSource });
    },

    updateConversationTitle: (id, title) => {
        set(state => ({
            conversations: state.conversations.map(c =>
                c.id === id ? { ...c, title } : c
            )
        }));

        // Persist to API
        updateConversationAPI(id, { title });
    },

    addMessage: (conversationId, message) => {
        const newMessage: Message = {
            ...message,
            id: uuidv4(),
            timestamp: Date.now()
        };

        set(state => ({
            conversations: state.conversations.map(c => {
                if (c.id !== conversationId) return c;

                return {
                    ...c,
                    messages: [...c.messages, newMessage],
                    chartCount: message.chart ? c.chartCount + 1 : c.chartCount
                };
            })
        }));

        // Persist to API
        addMessageAPI(conversationId, newMessage);
    },

    toggleSidebar: () => {
        set(state => ({ isSidebarOpen: !state.isSidebarOpen }));
    },

    setSuggestions: (conversationId, suggestions) => {
        set(state => ({
            conversations: state.conversations.map(c =>
                c.id === conversationId ? { ...c, suggestions, suggestionsLoading: false } : c
            )
        }));
    },

    setSuggestionsLoading: (conversationId, loading) => {
        set(state => ({
            conversations: state.conversations.map(c =>
                c.id === conversationId ? { ...c, suggestionsLoading: loading } : c
            )
        }));
    },

    setSchemaAnalysis: (conversationId, analysis) => {
        set(state => ({
            conversations: state.conversations.map(c =>
                c.id === conversationId ? { ...c, schemaAnalysis: analysis } : c
            )
        }));
    },

    // Cache functions
    getCachedSuggestions: (connectionId: string, database: string) => {
        const key = `${connectionId}:${database}`;
        const cached = suggestionCache.get(key);

        if (!cached) return null;

        // Check if cache is still valid
        if (Date.now() - cached.timestamp > CACHE_TTL) {
            suggestionCache.delete(key);
            return null;
        }

        return cached;
    },

    setCachedSuggestions: (connectionId: string, database: string, suggestions: SuggestedQuestion[], isDeep: boolean) => {
        const key = `${connectionId}:${database}`;
        suggestionCache.set(key, {
            suggestions,
            timestamp: Date.now(),
            isDeep
        });
    },

    clearSuggestionCache: (connectionId?: string, database?: string) => {
        if (connectionId && database) {
            suggestionCache.delete(`${connectionId}:${database}`);
        } else if (connectionId) {
            // Clear all caches for this connection
            for (const key of suggestionCache.keys()) {
                if (key.startsWith(`${connectionId}:`)) {
                    suggestionCache.delete(key);
                }
            }
        } else {
            suggestionCache.clear();
        }
    },

    // Prefetch suggestions for a database (called from Sidebar on expand)
    prefetchSuggestions: (connectionParams) => {
        const { connectionId, type, host, port, user, password, database } = connectionParams;

        // Skip if already cached
        const cached = get().getCachedSuggestions(connectionId, database);
        if (cached) {
            console.log('[prefetchSuggestions] Already cached:', database);
            return;
        }

        console.log('[prefetchSuggestions] Prefetching for:', database);

        // Fire and forget - just populate cache
        fetch('/api/ai-chat/quick-analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, host, port, user, password, database }),
        }).then(async (res) => {
            const data = await res.json();
            if (data.success && data.suggestions) {
                get().setCachedSuggestions(connectionId, database, data.suggestions, false);
                console.log('[prefetchSuggestions] Cached:', database, data.suggestions.length, 'suggestions');
            }
        }).catch(err => {
            console.log('[prefetchSuggestions] Failed (non-blocking):', err);
        });
    }
}));
