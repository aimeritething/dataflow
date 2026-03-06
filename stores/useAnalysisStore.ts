import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

export type ComponentType = 'chart' | 'text' | 'image' | 'stats' | 'filter' | 'table';

export interface DashboardComponent {
    id: string;
    type: ComponentType;
    title: string;
    description?: string;
    layout: {
        i: string;
        x: number;
        y: number;
        w: number;
        h: number;
    };
    data?: any;
    config?: any;
}

export interface Dashboard {
    id: string;
    name: string;
    description?: string;
    thumbnail?: string;
    createdAt: number;
    updatedAt: number;
    components: DashboardComponent[];
}

// API helper functions
async function fetchDashboardsFromAPI(): Promise<Dashboard[]> {
    try {
        const response = await fetch('/api/persist/dashboards');
        const data = await response.json();
        if (data.success) {
            return data.data.map((d: any) => ({
                ...d,
                createdAt: d.created_at,
                updatedAt: d.updated_at,
                components: d.components || []
            }));
        }
    } catch (error) {
        console.error('[AnalysisStore] Failed to fetch dashboards:', error);
    }
    return [];
}

async function fetchDashboardWithComponents(id: string): Promise<Dashboard | null> {
    try {
        const response = await fetch(`/api/persist/dashboards/${id}`);
        const data = await response.json();
        if (data.success) {
            return {
                ...data.data,
                createdAt: data.data.created_at,
                updatedAt: data.data.updated_at,
                components: data.data.components || []
            };
        }
    } catch (error) {
        console.error('[AnalysisStore] Failed to fetch dashboard:', error);
    }
    return null;
}

async function createDashboardAPI(dashboard: Dashboard): Promise<string | null> {
    try {
        const response = await fetch('/api/persist/dashboards', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: dashboard.name,
                description: dashboard.description
            })
        });
        const data = await response.json();
        if (data.success) {
            return data.data.id;
        }
    } catch (error) {
        console.error('[AnalysisStore] Failed to create dashboard:', error);
    }
    return null;
}

async function updateDashboardAPI(id: string, dashboard: Dashboard): Promise<void> {
    try {
        await fetch(`/api/persist/dashboards/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: dashboard.name,
                description: dashboard.description,
                components: dashboard.components
            })
        });
    } catch (error) {
        console.error('[AnalysisStore] Failed to update dashboard:', error);
    }
}

async function deleteDashboardAPI(id: string): Promise<void> {
    try {
        await fetch(`/api/persist/dashboards/${id}`, {
            method: 'DELETE'
        });
    } catch (error) {
        console.error('[AnalysisStore] Failed to delete dashboard:', error);
    }
}

interface AnalysisState {
    dashboards: Dashboard[];
    activeDashboardId: string | null;
    selectedComponentId: string | null;
    isEditorMode: boolean;
    isInitialized: boolean;

    // Actions
    initializeFromAPI: () => Promise<void>;
    createDashboard: (name: string, description?: string) => void;
    deleteDashboard: (id: string) => void;
    openDashboard: (id: string) => void;
    closeDashboard: () => void;
    updateDashboard: (id: string, updates: Partial<Dashboard>) => void;

    addComponent: (type: ComponentType, config?: any) => void;
    removeComponent: (id: string) => void;
    updateComponent: (id: string, updates: Partial<DashboardComponent>) => void;
    updateLayout: (layout: any[]) => void;
    selectComponent: (id: string | null) => void;
    toggleEditorMode: () => void;

    // Modal State
    isChartModalOpen: boolean;
    toggleChartModal: (isOpen: boolean) => void;

    // Helper
    isDashboardNameExists: (name: string, excludeId?: string) => boolean;
}

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
    dashboards: [],
    activeDashboardId: null,
    selectedComponentId: null,
    isEditorMode: false,
    isInitialized: false,

    initializeFromAPI: async () => {
        if (get().isInitialized) return;

        const dashboards = await fetchDashboardsFromAPI();
        set({ dashboards, isInitialized: true });
    },

    createDashboard: async (name, description) => {
        const tempId = uuidv4();
        const newDashboard: Dashboard = {
            id: tempId,
            name,
            description,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            components: []
        };

        // Optimistic update
        set(state => ({
            dashboards: [newDashboard, ...state.dashboards],
            activeDashboardId: tempId,
            isEditorMode: true
        }));

        // Persist to API and update ID
        const serverId = await createDashboardAPI(newDashboard);
        if (serverId && serverId !== tempId) {
            set(state => ({
                dashboards: state.dashboards.map(d =>
                    d.id === tempId ? { ...d, id: serverId } : d
                ),
                activeDashboardId: state.activeDashboardId === tempId ? serverId : state.activeDashboardId
            }));
        }
    },

    deleteDashboard: (id) => {
        set(state => ({
            dashboards: state.dashboards.filter(d => d.id !== id),
            activeDashboardId: state.activeDashboardId === id ? null : state.activeDashboardId
        }));
        // API Call
        fetch(`/api/persist/dashboards/${id}`, { method: 'DELETE' }).catch(err => {
            console.error('[AnalysisStore] Failed to delete dashboard:', err);
        });
    },

    createDemoDashboard: () => {
        const id = uuidv4();
        const now = Date.now();

        // Mock Data Generation
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        // 1. Sales Trend (Line)
        const salesTrend = {
            id: uuidv4(),
            type: 'chart' as ComponentType,
            title: '2025 Annual Sales Trend',
            layout: { i: uuidv4(), x: 0, y: 0, w: 8, h: 6 },
            config: {
                type: 'line',
                xAxis: months,
                series: [
                    { name: 'Revenue', data: [120, 132, 101, 134, 90, 230, 210, 250, 280, 270, 310, 350] },
                    { name: 'Profit', data: [60, 72, 71, 74, 60, 130, 110, 150, 150, 140, 180, 190], type: 'line', areaStyle: { opacity: 0.1 } }
                ]
            }
        };

        // 2. Category Distribution (Pie)
        const categoryDist = {
            id: uuidv4(),
            type: 'chart' as ComponentType,
            title: 'Sales by Category',
            layout: { i: uuidv4(), x: 8, y: 0, w: 4, h: 6 },
            config: {
                type: 'pie',
                xAxis: ['Electronics', 'Clothing', 'Home', 'Books', 'Other'],
                series: [
                    {
                        name: 'Sales',
                        type: 'pie',
                        radius: ['40%', '70%'],
                        data: [
                            { value: 1048, name: 'Electronics' },
                            { value: 735, name: 'Clothing' },
                            { value: 580, name: 'Home' },
                            { value: 484, name: 'Books' },
                            { value: 300, name: 'Other' }
                        ]
                    }
                ]
            }
        };

        // 3. Regional Performance (Bar)
        const regionalPerf = {
            id: uuidv4(),
            type: 'chart' as ComponentType,
            title: 'Regional Performance',
            layout: { i: uuidv4(), x: 0, y: 6, w: 6, h: 6 },
            config: {
                type: 'bar',
                xAxis: ['North', 'South', 'East', 'West', 'Central'],
                series: [
                    { name: 'Q1', data: [320, 332, 301, 334, 390] },
                    { name: 'Q2', data: [220, 182, 191, 234, 290] }
                ]
            }
        };

        // 4. Top Products (Horizontal Bar)
        const topProducts = {
            id: uuidv4(),
            type: 'chart' as ComponentType,
            title: 'Top 5 Products',
            layout: { i: uuidv4(), x: 6, y: 6, w: 6, h: 6 },
            config: {
                type: 'bar',
                direction: 'horizontal',
                xAxis: ['Product A', 'Product B', 'Product C', 'Product D', 'Product E'],
                series: [
                    { name: 'Sales', data: [1200, 980, 850, 600, 450] }
                ]
            }
        };

        const newDashboard: Dashboard = {
            id,
            name: 'Sales Demo Dashboard',
            createdAt: now,
            updatedAt: now,
            components: [salesTrend, categoryDist, regionalPerf, topProducts]
        };

        set(state => ({
            dashboards: [newDashboard, ...state.dashboards],
            activeDashboardId: id,
            isEditorMode: true
        }));

        createDashboardAPI(newDashboard).then(() => {
            // After creation, also save components
            updateDashboardAPI(id, newDashboard);
        });
    },

    openDashboard: async (id) => {
        set({ activeDashboardId: id, isEditorMode: false, selectedComponentId: null });

        // Load full dashboard with components if not already loaded
        const dashboard = get().dashboards.find(d => d.id === id);
        if (dashboard && (!dashboard.components || dashboard.components.length === 0)) {
            const fullDashboard = await fetchDashboardWithComponents(id);
            if (fullDashboard) {
                set(state => ({
                    dashboards: state.dashboards.map(d =>
                        d.id === id ? fullDashboard : d
                    )
                }));
            }
        }
    },

    closeDashboard: () => {
        // Save current dashboard before closing
        const { activeDashboardId, dashboards } = get();
        if (activeDashboardId) {
            const dashboard = dashboards.find(d => d.id === activeDashboardId);
            if (dashboard) {
                updateDashboardAPI(activeDashboardId, dashboard);
            }
        }
        set({ activeDashboardId: null, selectedComponentId: null });
    },

    updateDashboard: (id, updates) => {
        set(state => ({
            dashboards: state.dashboards.map(d =>
                d.id === id ? { ...d, ...updates, updatedAt: Date.now() } : d
            )
        }));

        // Debounced save would be better, but for now save immediately
        const dashboard = get().dashboards.find(d => d.id === id);
        if (dashboard) {
            updateDashboardAPI(id, dashboard);
        }
    },

    addComponent: (type, config: any = {}) => {
        const { activeDashboardId, dashboards } = get();
        if (!activeDashboardId) return;

        const dashboard = dashboards.find(d => d.id === activeDashboardId);
        if (!dashboard) return;

        // Calculate next position
        // Default width is 4 (1/3 of 12 columns) for 3 charts per row
        const w = 4;
        const h = 6;
        let x = 0;
        let y = 0;

        const components = dashboard.components || [];
        if (components.length > 0) {
            // Find the last component by position (visual order)
            // Sort by y then x
            // Treat Infinity as a very large number for sorting, but we need to handle it carefully
            const sorted = [...components].sort((a, b) => {
                const ay = a.layout.y === Infinity ? 999999 : a.layout.y;
                const by = b.layout.y === Infinity ? 999999 : b.layout.y;
                if (ay !== by) return ay - by;
                return a.layout.x - b.layout.x;
            });
            const last = sorted[sorted.length - 1];

            // Calculate maxY of all components to know where the "bottom" is
            const maxY = components.reduce((max, c) => {
                // If a component has Infinity y, we can't really trust it for height calc, 
                // but if we are moving away from Infinity, we assume existing ones are fixed.
                // If we encounter Infinity, it's problematic. Let's ignore it for maxY calc 
                // and assume we append after the known content.
                if (c.layout.y === Infinity) return max;
                return Math.max(max, c.layout.y + c.layout.h);
            }, 0);

            // Check if there's space on the right of the last component
            // We use the last component's explicit Y if available, otherwise maxY
            const lastY = last.layout.y === Infinity ? maxY : last.layout.y;

            // If the last component is essentially "at the bottom" (its y is near maxY - h), 
            // we try to append to it. 
            // Actually, simplest logic:
            // If last component row has space, append.
            // Component row is defined by last.y

            // If last.y is Infinity, it means it was just added with the old logic. 
            // We should try to place this new one at x=0, y=maxY (start new row) 
            // OR if the prev one was x=0, y=Infinity, we place this one at x=4, y=Infinity? 
            // No, we want to stop using Infinity.

            // Safe logic:
            if (last.layout.x + last.layout.w + w <= 12) {
                // Fits on the same row as the last element
                x = last.layout.x + last.layout.w;
                y = lastY;
            } else {
                // Start a new row
                x = 0;
                // Place at the bottom
                // If the last element was at maxY row, we need to go below it.
                // Actually maxY is the bottom coordinate. So y = maxY is correct for new row.
                // But wait, if last element is at y=0, h=4. maxY is 4. New row at y=4. Correct.
                y = maxY;
            }

            // Edge case: what if 'last' was Infinity? 
            // 'lastY' became 'maxY'.
            // If 'last' was (0, Inf), w=4. Map to (0, maxY).
            // Space check: 0+4+4 <= 12. True.
            // x = 4. y = maxY.
            // So we effectively place it next to the previous one, assuming previous one is at maxY.
            // This works even if previous one is theoretically "floating" at bottom.
        }

        // Debug: log the calculated layout
        console.log('[addComponent] Creating component with layout:', { type, w, h, x, y, configHasLayout: !!config.layout });

        const newComponent: DashboardComponent = {
            id: uuidv4(),
            type,
            title: config.title || `New ${type}`,
            ...config,  // Spread config first
            layout: { i: uuidv4(), x, y, w, h },  // Then set layout to ensure it's not overwritten
        };

        console.log('[addComponent] Final component layout:', newComponent.layout);

        set(state => ({
            dashboards: state.dashboards.map(d =>
                d.id === activeDashboardId
                    ? { ...d, components: [...d.components, newComponent], updatedAt: Date.now() }
                    : d
            ),
            selectedComponentId: newComponent.id
        }));

        // Auto-save
        const updatedDashboard = get().dashboards.find(d => d.id === activeDashboardId);
        if (updatedDashboard) {
            updateDashboardAPI(activeDashboardId, updatedDashboard);
        }
    },

    removeComponent: (id) => {
        const { activeDashboardId } = get();
        if (!activeDashboardId) return;

        set(state => ({
            dashboards: state.dashboards.map(d =>
                d.id === activeDashboardId
                    ? { ...d, components: d.components.filter(c => c.id !== id), updatedAt: Date.now() }
                    : d
            ),
            selectedComponentId: null
        }));

        // Auto-save
        const dashboard = get().dashboards.find(d => d.id === activeDashboardId);
        if (dashboard) {
            updateDashboardAPI(activeDashboardId, dashboard);
        }
    },

    updateComponent: (id, updates) => {
        const { activeDashboardId } = get();
        if (!activeDashboardId) return;

        set(state => ({
            dashboards: state.dashboards.map(d =>
                d.id === activeDashboardId
                    ? {
                        ...d,
                        components: d.components.map(c => c.id === id ? { ...c, ...updates } : c),
                        updatedAt: Date.now()
                    }
                    : d
            )
        }));
    },

    updateLayout: (layout) => {
        const { activeDashboardId } = get();
        if (!activeDashboardId) return;

        set(state => ({
            dashboards: state.dashboards.map(d =>
                d.id === activeDashboardId
                    ? {
                        ...d,
                        components: d.components.map(c => {
                            const layoutItem = layout.find((l: any) => l.i === c.layout.i);
                            if (layoutItem) {
                                return {
                                    ...c,
                                    layout: {
                                        ...c.layout,
                                        x: layoutItem.x,
                                        y: layoutItem.y,
                                        w: layoutItem.w,
                                        h: layoutItem.h
                                    }
                                };
                            }
                            return c;
                        }),
                        updatedAt: Date.now()
                    }
                    : d
            )
        }));
    },

    selectComponent: (id) => set({ selectedComponentId: id }),
    toggleEditorMode: () => set(state => ({ isEditorMode: !state.isEditorMode })),

    isChartModalOpen: false,
    toggleChartModal: (isOpen) => set({ isChartModalOpen: isOpen }),

    isDashboardNameExists: (name, excludeId) => {
        const { dashboards } = get();
        const normalizedName = name.trim().toLowerCase();
        return dashboards.some(d =>
            d.name.trim().toLowerCase() === normalizedName && d.id !== excludeId
        );
    }
}));
