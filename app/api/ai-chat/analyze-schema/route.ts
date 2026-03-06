import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import { Client as PgClient } from 'pg';
import { MongoClient } from 'mongodb';
import { createClient } from 'redis';
import { generateAISuggestions, detectBusinessDomain, getSmartCategories } from '@/lib/ai/suggestions';
import { profileDatabaseTables } from '@/lib/ai/data-profiler';

// ============================================
// 类型定义
// ============================================

interface AnalyzeSchemaRequest {
    type: string;
    host: string;
    port: string;
    user?: string;
    password?: string;
    database?: string;
}

interface ColumnInfo {
    name: string;
    type: string;
    nullable: boolean;
    isPrimaryKey?: boolean;
    isForeignKey?: boolean;
    comment?: string;
}

interface ColumnProfile {
    distinctCount: number;
    nullCount: number;
    nullRatio: number;
    minValue?: any;
    maxValue?: any;
    avgValue?: number;
    isEnum: boolean;  // 低基数，可能是枚举
    enumValues?: string[];  // 枚举值列表
    semanticType?: string;  // 语义类型
}

interface TableInfo {
    name: string;
    columns: ColumnInfo[];
    rowCount: number;
    comment?: string;
    columnProfiles?: Record<string, ColumnProfile>;
    semanticType?: string;  // 表的语义类型 (users, orders, products 等)
}

interface SuggestedQuestion {
    id: string;
    text: string;
    query: string;
    chartType: 'bar' | 'line' | 'pie' | 'table' | 'area';
    description: string;
    category: string;  // 分类：业务洞察、趋势分析、分布统计等
    priority: number;  // 优先级 1-3
}

// 外键关系
interface ForeignKeyRelation {
    fromTable: string;
    fromColumn: string;
    toTable: string;
    toColumn: string;
    relationName?: string;
}

// 表关系图
interface TableRelationship {
    table: string;
    relatedTables: {
        name: string;
        relation: 'one-to-many' | 'many-to-one' | 'many-to-many';
        joinColumn: string;
        targetColumn: string;
    }[];
}

interface SchemaAnalysisResult {
    tables: TableInfo[];
    suggestions: SuggestedQuestion[];
    relationships?: TableRelationship[];  // 表关系图
    summary: {
        tableCount: number;
        totalColumns: number;
        totalRows: number;
        hasNumericColumns: boolean;
        hasDateColumns: boolean;
        detectedDomain?: string;  // 检测到的业务领域
        relationshipCount?: number;  // 关系数量
    };
}

// ============================================
// 语义映射表
// ============================================

// 列名语义映射
const COLUMN_SEMANTIC_MAP: Record<string, { type: string; analyzeAs: string[] }> = {
    // 金额相关
    'amount': { type: 'money', analyzeAs: ['sum', 'avg', 'trend', 'ranking'] },
    'price': { type: 'money', analyzeAs: ['sum', 'avg', 'distribution'] },
    'total': { type: 'money', analyzeAs: ['sum', 'trend'] },
    'cost': { type: 'money', analyzeAs: ['sum', 'avg'] },
    'fee': { type: 'money', analyzeAs: ['sum'] },
    'revenue': { type: 'money', analyzeAs: ['sum', 'trend'] },
    'salary': { type: 'money', analyzeAs: ['avg', 'distribution'] },
    '金额': { type: 'money', analyzeAs: ['sum', 'avg', 'trend'] },
    '价格': { type: 'money', analyzeAs: ['avg', 'distribution'] },
    '总价': { type: 'money', analyzeAs: ['sum', 'trend'] },

    // 数量相关
    'count': { type: 'quantity', analyzeAs: ['sum', 'avg'] },
    'quantity': { type: 'quantity', analyzeAs: ['sum', 'avg'] },
    'num': { type: 'quantity', analyzeAs: ['sum'] },
    'qty': { type: 'quantity', analyzeAs: ['sum'] },
    'stock': { type: 'quantity', analyzeAs: ['sum', 'distribution'] },
    '数量': { type: 'quantity', analyzeAs: ['sum', 'avg'] },
    '库存': { type: 'quantity', analyzeAs: ['sum', 'distribution'] },

    // 时间相关
    'created_at': { type: 'create_time', analyzeAs: ['trend', 'distribution'] },
    'create_time': { type: 'create_time', analyzeAs: ['trend', 'distribution'] },
    'updated_at': { type: 'update_time', analyzeAs: ['trend'] },
    'update_time': { type: 'update_time', analyzeAs: ['trend'] },
    'order_date': { type: 'business_date', analyzeAs: ['trend', 'distribution'] },
    'order_time': { type: 'business_date', analyzeAs: ['trend'] },
    '创建时间': { type: 'create_time', analyzeAs: ['trend'] },
    '订单时间': { type: 'business_date', analyzeAs: ['trend'] },

    // 状态相关
    'status': { type: 'status', analyzeAs: ['distribution', 'pie'] },
    'state': { type: 'status', analyzeAs: ['distribution', 'pie'] },
    'type': { type: 'category', analyzeAs: ['distribution', 'pie'] },
    'category': { type: 'category', analyzeAs: ['distribution', 'groupby'] },
    '状态': { type: 'status', analyzeAs: ['distribution', 'pie'] },
    '类型': { type: 'category', analyzeAs: ['distribution', 'pie'] },
    '分类': { type: 'category', analyzeAs: ['distribution', 'groupby'] },

    // 评分相关
    'score': { type: 'score', analyzeAs: ['avg', 'distribution', 'ranking'] },
    'rating': { type: 'score', analyzeAs: ['avg', 'distribution'] },
    'level': { type: 'level', analyzeAs: ['distribution'] },
    '分数': { type: 'score', analyzeAs: ['avg', 'ranking'] },
    '评分': { type: 'score', analyzeAs: ['avg', 'distribution'] },
    '等级': { type: 'level', analyzeAs: ['distribution'] },

    // 地理相关
    'city': { type: 'location', analyzeAs: ['distribution', 'groupby'] },
    'province': { type: 'location', analyzeAs: ['distribution', 'groupby'] },
    'region': { type: 'location', analyzeAs: ['distribution', 'groupby'] },
    'country': { type: 'location', analyzeAs: ['distribution'] },
    '城市': { type: 'location', analyzeAs: ['distribution', 'groupby'] },
    '省份': { type: 'location', analyzeAs: ['distribution', 'groupby'] },
    '地区': { type: 'location', analyzeAs: ['distribution'] },
};

// 表名语义映射
const TABLE_SEMANTIC_MAP: Record<string, { domain: string; analysisTemplates: string[] }> = {
    // 用户相关
    'users': { domain: 'user', analysisTemplates: ['user_growth', 'user_distribution', 'user_activity'] },
    'user': { domain: 'user', analysisTemplates: ['user_growth', 'user_distribution'] },
    'customers': { domain: 'user', analysisTemplates: ['user_growth', 'user_distribution'] },
    'members': { domain: 'user', analysisTemplates: ['user_growth', 'user_level'] },
    'dim_users': { domain: 'user', analysisTemplates: ['user_growth', 'user_distribution'] },

    // 订单相关
    'orders': { domain: 'order', analysisTemplates: ['order_trend', 'order_status', 'order_amount'] },
    'order': { domain: 'order', analysisTemplates: ['order_trend', 'order_status'] },
    'fact_orders': { domain: 'order', analysisTemplates: ['order_trend', 'order_amount', 'order_region'] },
    'order_items': { domain: 'order_detail', analysisTemplates: ['product_sales', 'order_composition'] },
    'fact_order_items': { domain: 'order_detail', analysisTemplates: ['product_sales', 'order_composition'] },

    // 商品相关
    'products': { domain: 'product', analysisTemplates: ['product_ranking', 'product_category', 'product_stock'] },
    'product': { domain: 'product', analysisTemplates: ['product_ranking', 'product_category'] },
    'dim_products': { domain: 'product', analysisTemplates: ['product_ranking', 'product_category', 'product_price'] },
    'items': { domain: 'product', analysisTemplates: ['product_ranking'] },
    'goods': { domain: 'product', analysisTemplates: ['product_ranking', 'product_stock'] },

    // 支付相关
    'payments': { domain: 'payment', analysisTemplates: ['payment_method', 'payment_trend'] },
    'transactions': { domain: 'payment', analysisTemplates: ['transaction_trend', 'transaction_amount'] },

    // 地区相关
    'regions': { domain: 'dimension', analysisTemplates: ['region_distribution'] },
    'dim_regions': { domain: 'dimension', analysisTemplates: ['region_distribution'] },
    'dim_date': { domain: 'dimension', analysisTemplates: [] },

    // 流量相关
    'traffic': { domain: 'traffic', analysisTemplates: ['traffic_source', 'traffic_trend', 'device_distribution'] },
    'fact_traffic': { domain: 'traffic', analysisTemplates: ['traffic_source', 'traffic_trend', 'device_distribution'] },
    'visits': { domain: 'traffic', analysisTemplates: ['visit_trend'] },
    'page_views': { domain: 'traffic', analysisTemplates: ['pageview_trend'] },
};

// 业务分析模板
const ANALYSIS_TEMPLATES: Record<string, (table: TableInfo, allTables: TableInfo[]) => SuggestedQuestion | null> = {
    // 用户分析模板
    'user_growth': (table) => {
        const timeCol = table.columns.find(c =>
            c.name.toLowerCase().includes('creat') ||
            c.name.toLowerCase().includes('regist') ||
            c.name.includes('创建') ||
            c.name.includes('注册')
        );
        if (!timeCol) return null;
        return {
            id: `user_growth_${table.name}`,
            text: '用户增长趋势分析',
            query: `SELECT DATE(\`${timeCol.name}\`) as date, COUNT(*) as new_users FROM \`${table.name}\` GROUP BY DATE(\`${timeCol.name}\`) ORDER BY date DESC LIMIT 30`,
            chartType: 'line',
            description: '查看每日新增用户数量趋势',
            category: '用户分析',
            priority: 1
        };
    },

    'user_distribution': (table) => {
        const locationCol = table.columns.find(c =>
            ['city', 'province', 'region', '城市', '省份', '地区'].some(k => c.name.toLowerCase().includes(k))
        );
        if (!locationCol) return null;
        return {
            id: `user_dist_${table.name}`,
            text: '用户地区分布',
            query: `SELECT \`${locationCol.name}\`, COUNT(*) as user_count FROM \`${table.name}\` GROUP BY \`${locationCol.name}\` ORDER BY user_count DESC LIMIT 10`,
            chartType: 'bar',
            description: '查看用户的地区分布情况',
            category: '用户分析',
            priority: 2
        };
    },

    'user_level': (table) => {
        const levelCol = table.columns.find(c =>
            ['level', 'grade', 'tier', '等级', '级别', 'user_level'].some(k => c.name.toLowerCase().includes(k))
        );
        if (!levelCol) return null;
        return {
            id: `user_level_${table.name}`,
            text: '用户等级分布',
            query: `SELECT \`${levelCol.name}\`, COUNT(*) as count FROM \`${table.name}\` GROUP BY \`${levelCol.name}\` ORDER BY count DESC`,
            chartType: 'pie',
            description: '查看各等级用户的占比',
            category: '用户分析',
            priority: 2
        };
    },

    // 订单分析模板
    'order_trend': (table) => {
        const timeCol = table.columns.find(c =>
            c.type.toLowerCase().includes('date') || c.type.toLowerCase().includes('time')
        );
        if (!timeCol) return null;
        return {
            id: `order_trend_${table.name}`,
            text: '订单数量趋势',
            query: `SELECT DATE(\`${timeCol.name}\`) as date, COUNT(*) as order_count FROM \`${table.name}\` GROUP BY DATE(\`${timeCol.name}\`) ORDER BY date DESC LIMIT 30`,
            chartType: 'line',
            description: '查看每日订单数量变化趋势',
            category: '订单分析',
            priority: 1
        };
    },

    'order_status': (table) => {
        const statusCol = table.columns.find(c =>
            ['status', 'state', 'order_status', '状态'].some(k => c.name.toLowerCase().includes(k))
        );
        if (!statusCol) return null;
        return {
            id: `order_status_${table.name}`,
            text: '订单状态分布',
            query: `SELECT \`${statusCol.name}\`, COUNT(*) as count FROM \`${table.name}\` GROUP BY \`${statusCol.name}\``,
            chartType: 'pie',
            description: '查看各状态订单的占比',
            category: '订单分析',
            priority: 1
        };
    },

    'order_amount': (table) => {
        const amountCol = table.columns.find(c =>
            ['amount', 'total', 'price', '金额', '总价', 'total_amount'].some(k => c.name.toLowerCase().includes(k))
        );
        const timeCol = table.columns.find(c =>
            c.type.toLowerCase().includes('date') || c.type.toLowerCase().includes('time')
        );
        if (!amountCol || !timeCol) return null;
        return {
            id: `order_amount_${table.name}`,
            text: '销售额趋势分析',
            query: `SELECT DATE(\`${timeCol.name}\`) as date, SUM(\`${amountCol.name}\`) as total_amount FROM \`${table.name}\` GROUP BY DATE(\`${timeCol.name}\`) ORDER BY date DESC LIMIT 30`,
            chartType: 'area',
            description: '查看每日销售额变化趋势',
            category: '订单分析',
            priority: 1
        };
    },

    'order_region': (table, allTables) => {
        // 查找关联的地区表
        const regionTable = allTables.find(t => t.name.toLowerCase().includes('region'));
        const regionIdCol = table.columns.find(c => c.name.toLowerCase().includes('region'));
        const amountCol = table.columns.find(c =>
            ['amount', 'total', '金额', 'total_amount'].some(k => c.name.toLowerCase().includes(k))
        );
        if (!regionTable || !regionIdCol || !amountCol) return null;

        const cityCol = regionTable.columns.find(c => ['city', '城市'].some(k => c.name.toLowerCase().includes(k)));
        if (!cityCol) return null;

        return {
            id: `order_region_${table.name}`,
            text: '各地区销售额排行',
            query: `SELECT r.\`${cityCol.name}\`, SUM(o.\`${amountCol.name}\`) as total_amount FROM \`${table.name}\` o JOIN \`${regionTable.name}\` r ON o.\`${regionIdCol.name}\` = r.region_id GROUP BY r.\`${cityCol.name}\` ORDER BY total_amount DESC LIMIT 10`,
            chartType: 'bar',
            description: '查看各地区销售额排名',
            category: '订单分析',
            priority: 1
        };
    },

    // 商品分析模板
    'product_ranking': (table, allTables) => {
        // 查找订单明细表来计算销量
        const orderItemTable = allTables.find(t =>
            t.name.toLowerCase().includes('order_item') || t.name.toLowerCase().includes('fact_order_items')
        );

        const nameCol = table.columns.find(c =>
            ['name', 'title', 'product_name', '名称', '商品名'].some(k => c.name.toLowerCase().includes(k))
        );

        if (!nameCol) return null;

        if (orderItemTable) {
            const qtyCol = orderItemTable.columns.find(c =>
                ['quantity', 'qty', 'count', '数量'].some(k => c.name.toLowerCase().includes(k))
            );
            const productIdCol = orderItemTable.columns.find(c => c.name.toLowerCase().includes('product'));

            if (qtyCol && productIdCol) {
                return {
                    id: `product_ranking_${table.name}`,
                    text: '商品销量排行 TOP 10',
                    query: `SELECT p.\`${nameCol.name}\`, SUM(oi.\`${qtyCol.name}\`) as total_sold FROM \`${table.name}\` p JOIN \`${orderItemTable.name}\` oi ON p.product_id = oi.\`${productIdCol.name}\` GROUP BY p.product_id, p.\`${nameCol.name}\` ORDER BY total_sold DESC LIMIT 10`,
                    chartType: 'bar',
                    description: '查看销量最高的10个商品',
                    category: '商品分析',
                    priority: 1
                };
            }
        }

        // 如果没有订单明细表，返回简单的商品列表
        const priceCol = table.columns.find(c =>
            ['price', 'selling_price', '价格'].some(k => c.name.toLowerCase().includes(k))
        );
        if (priceCol) {
            return {
                id: `product_price_${table.name}`,
                text: '商品价格 TOP 10',
                query: `SELECT \`${nameCol.name}\`, \`${priceCol.name}\` FROM \`${table.name}\` ORDER BY \`${priceCol.name}\` DESC LIMIT 10`,
                chartType: 'bar',
                description: '查看价格最高的10个商品',
                category: '商品分析',
                priority: 2
            };
        }

        return null;
    },

    'product_category': (table) => {
        const categoryCol = table.columns.find(c =>
            ['category', 'type', 'sub_category', '分类', '类型'].some(k => c.name.toLowerCase().includes(k))
        );
        if (!categoryCol) return null;
        return {
            id: `product_cat_${table.name}`,
            text: '商品分类分布',
            query: `SELECT \`${categoryCol.name}\`, COUNT(*) as count FROM \`${table.name}\` GROUP BY \`${categoryCol.name}\` ORDER BY count DESC`,
            chartType: 'pie',
            description: '查看各分类商品数量占比',
            category: '商品分析',
            priority: 2
        };
    },

    'product_stock': (table) => {
        const stockCol = table.columns.find(c =>
            ['stock', 'quantity', 'inventory', '库存'].some(k => c.name.toLowerCase().includes(k))
        );
        const nameCol = table.columns.find(c =>
            ['name', 'title', 'product_name', '名称'].some(k => c.name.toLowerCase().includes(k))
        );
        if (!stockCol || !nameCol) return null;
        return {
            id: `product_stock_${table.name}`,
            text: '库存预警 (库存量最低的商品)',
            query: `SELECT \`${nameCol.name}\`, \`${stockCol.name}\` FROM \`${table.name}\` WHERE \`${stockCol.name}\` > 0 ORDER BY \`${stockCol.name}\` ASC LIMIT 10`,
            chartType: 'bar',
            description: '查看库存量最低的10个商品',
            category: '商品分析',
            priority: 2
        };
    },

    // 流量分析模板
    'traffic_source': (table) => {
        const sourceCol = table.columns.find(c =>
            ['source', 'traffic_source', 'channel', '来源', '渠道'].some(k => c.name.toLowerCase().includes(k))
        );
        if (!sourceCol) return null;
        return {
            id: `traffic_source_${table.name}`,
            text: '流量来源分布',
            query: `SELECT \`${sourceCol.name}\`, COUNT(*) as visit_count FROM \`${table.name}\` GROUP BY \`${sourceCol.name}\` ORDER BY visit_count DESC`,
            chartType: 'pie',
            description: '查看各渠道流量占比',
            category: '流量分析',
            priority: 1
        };
    },

    'traffic_trend': (table) => {
        const timeCol = table.columns.find(c =>
            c.type.toLowerCase().includes('date') || c.type.toLowerCase().includes('time')
        );
        if (!timeCol) return null;
        return {
            id: `traffic_trend_${table.name}`,
            text: '访问量趋势',
            query: `SELECT DATE(\`${timeCol.name}\`) as date, COUNT(*) as visits FROM \`${table.name}\` GROUP BY DATE(\`${timeCol.name}\`) ORDER BY date DESC LIMIT 30`,
            chartType: 'line',
            description: '查看每日访问量变化趋势',
            category: '流量分析',
            priority: 1
        };
    },

    'device_distribution': (table) => {
        const deviceCol = table.columns.find(c =>
            ['device', 'device_type', 'platform', '设备'].some(k => c.name.toLowerCase().includes(k))
        );
        if (!deviceCol) return null;
        return {
            id: `device_dist_${table.name}`,
            text: '设备类型分布',
            query: `SELECT \`${deviceCol.name}\`, COUNT(*) as count FROM \`${table.name}\` GROUP BY \`${deviceCol.name}\``,
            chartType: 'pie',
            description: '查看各设备类型访问占比',
            category: '流量分析',
            priority: 2
        };
    },

    // 通用模板
    'region_distribution': (table) => {
        const nameCol = table.columns.find(c =>
            ['city', 'province', 'name', '城市', '省份'].some(k => c.name.toLowerCase().includes(k))
        );
        const typeCol = table.columns.find(c =>
            ['type', 'region_type', '类型'].some(k => c.name.toLowerCase().includes(k))
        );
        if (!nameCol || !typeCol) return null;
        return {
            id: `region_type_${table.name}`,
            text: '城市等级分布',
            query: `SELECT \`${typeCol.name}\`, COUNT(*) as count FROM \`${table.name}\` GROUP BY \`${typeCol.name}\``,
            chartType: 'pie',
            description: '查看各城市等级的分布',
            category: '地区分析',
            priority: 3
        };
    },
};

// ============================================
// 辅助函数
// ============================================

// 推断列的语义类型
function inferColumnSemantics(columnName: string, columnType: string): { semanticType: string; analyzeAs: string[] } | null {
    const lowerName = columnName.toLowerCase();

    // 精确匹配
    for (const [keyword, semantic] of Object.entries(COLUMN_SEMANTIC_MAP)) {
        if (lowerName === keyword.toLowerCase() || lowerName.includes(keyword.toLowerCase())) {
            return { semanticType: semantic.type, analyzeAs: semantic.analyzeAs };
        }
    }

    // 基于类型推断
    const lowerType = columnType.toLowerCase();
    if (lowerType.includes('decimal') || lowerType.includes('float') || lowerType.includes('double')) {
        return { semanticType: 'numeric', analyzeAs: ['sum', 'avg'] };
    }
    if (lowerType.includes('date') || lowerType.includes('time')) {
        return { semanticType: 'datetime', analyzeAs: ['trend'] };
    }

    return null;
}

// 推断表的语义类型
function inferTableSemantics(tableName: string): { domain: string; templates: string[] } | null {
    const lowerName = tableName.toLowerCase();

    for (const [keyword, semantic] of Object.entries(TABLE_SEMANTIC_MAP)) {
        if (lowerName === keyword || lowerName.includes(keyword)) {
            return { domain: semantic.domain, templates: semantic.analysisTemplates };
        }
    }

    return null;
}

// ============================================
// MySQL 分析
// ============================================

async function analyzeMySQLSchema(params: AnalyzeSchemaRequest): Promise<SchemaAnalysisResult> {
    let selectedDatabase = params.database;

    // 自动选择数据库
    if (!selectedDatabase) {
        const tempConnection = await mysql.createConnection({
            host: params.host,
            port: parseInt(params.port),
            user: params.user,
            password: params.password,
        });

        try {
            const [dbRows] = await tempConnection.query('SHOW DATABASES');
            const databases = (dbRows as any[])
                .map(row => Object.values(row)[0] as string)
                .filter(db => !['information_schema', 'mysql', 'performance_schema', 'sys'].includes(db));

            if (databases.length === 0) {
                throw new Error('No user databases found');
            }
            selectedDatabase = databases[0];
        } finally {
            await tempConnection.end();
        }
    }

    const connection = await mysql.createConnection({
        host: params.host,
        port: parseInt(params.port),
        user: params.user,
        password: params.password,
        database: selectedDatabase,
    });

    try {
        // 获取所有表
        const [tablesResult] = await connection.query('SHOW TABLES');
        const tableNames = (tablesResult as any[]).map(row => Object.values(row)[0] as string);

        const tables: TableInfo[] = [];
        let totalColumns = 0;
        let totalRows = 0;
        let hasNumericColumns = false;
        let hasDateColumns = false;
        const detectedDomains = new Set<string>();

        for (const tableName of tableNames.slice(0, 15)) {
            // 获取表结构
            const [columnsResult] = await connection.query(`DESCRIBE \`${tableName}\``);
            const columns: ColumnInfo[] = (columnsResult as any[]).map(col => {
                const type = col.Type.toLowerCase();
                if (type.includes('int') || type.includes('decimal') || type.includes('float') || type.includes('double')) {
                    hasNumericColumns = true;
                }
                if (type.includes('date') || type.includes('time')) {
                    hasDateColumns = true;
                }
                return {
                    name: col.Field,
                    type: col.Type,
                    nullable: col.Null === 'YES',
                    isPrimaryKey: col.Key === 'PRI',
                };
            });

            // 获取行数
            const [countResult] = await connection.query(`SELECT COUNT(*) as count FROM \`${tableName}\``);
            const rowCount = (countResult as any[])[0]?.count || 0;
            totalRows += rowCount;

            // 推断表语义
            const tableSemantic = inferTableSemantics(tableName);
            if (tableSemantic) {
                detectedDomains.add(tableSemantic.domain);
            }

            // 数据画像 (对小表进行采样分析)
            const columnProfiles: Record<string, ColumnProfile> = {};
            if (rowCount > 0 && rowCount < 100000) {
                for (const col of columns.slice(0, 10)) {
                    try {
                        // 基数分析
                        const [distinctResult] = await connection.query(
                            `SELECT COUNT(DISTINCT \`${col.name}\`) as distinct_count, 
                                    SUM(CASE WHEN \`${col.name}\` IS NULL THEN 1 ELSE 0 END) as null_count
                             FROM \`${tableName}\``
                        );
                        const distinctCount = (distinctResult as any[])[0]?.distinct_count || 0;
                        const nullCount = (distinctResult as any[])[0]?.null_count || 0;

                        const profile: ColumnProfile = {
                            distinctCount,
                            nullCount,
                            nullRatio: rowCount > 0 ? nullCount / rowCount : 0,
                            isEnum: distinctCount > 0 && distinctCount <= 20 && distinctCount < rowCount * 0.1,
                        };

                        // 如果是枚举类型，获取枚举值
                        if (profile.isEnum && distinctCount <= 10) {
                            const [enumResult] = await connection.query(
                                `SELECT DISTINCT \`${col.name}\` as val FROM \`${tableName}\` WHERE \`${col.name}\` IS NOT NULL LIMIT 10`
                            );
                            profile.enumValues = (enumResult as any[]).map(r => String(r.val));
                        }

                        // 数值列的统计
                        if (col.type.toLowerCase().match(/int|decimal|float|double/)) {
                            const [statsResult] = await connection.query(
                                `SELECT MIN(\`${col.name}\`) as min_val, MAX(\`${col.name}\`) as max_val, AVG(\`${col.name}\`) as avg_val FROM \`${tableName}\``
                            );
                            const stats = (statsResult as any[])[0];
                            profile.minValue = stats?.min_val;
                            profile.maxValue = stats?.max_val;
                            profile.avgValue = stats?.avg_val;
                        }

                        // 语义推断
                        const semantic = inferColumnSemantics(col.name, col.type);
                        if (semantic) {
                            profile.semanticType = semantic.semanticType;
                        }

                        columnProfiles[col.name] = profile;
                    } catch (e) {
                        // 忽略单列分析错误
                    }
                }
            }

            tables.push({
                name: tableName,
                columns,
                rowCount,
                columnProfiles,
                semanticType: tableSemantic?.domain,
            });
            totalColumns += columns.length;
        }

        // ============================================
        // Phase 4: 外键关系分析
        // ============================================

        const foreignKeys: ForeignKeyRelation[] = [];
        const relationships: TableRelationship[] = [];

        try {
            // 获取所有外键关系
            const [fkResult] = await connection.query(`
                SELECT 
                    TABLE_NAME as from_table,
                    COLUMN_NAME as from_column,
                    REFERENCED_TABLE_NAME as to_table,
                    REFERENCED_COLUMN_NAME as to_column,
                    CONSTRAINT_NAME as relation_name
                FROM information_schema.KEY_COLUMN_USAGE
                WHERE REFERENCED_TABLE_NAME IS NOT NULL
                AND TABLE_SCHEMA = ?
            `, [selectedDatabase]);

            for (const fk of fkResult as any[]) {
                foreignKeys.push({
                    fromTable: fk.from_table,
                    fromColumn: fk.from_column,
                    toTable: fk.to_table,
                    toColumn: fk.to_column,
                    relationName: fk.relation_name,
                });
            }

            // 构建表关系图
            const relationMap = new Map<string, TableRelationship>();

            for (const fk of foreignKeys) {
                // 添加 from_table 的关系
                if (!relationMap.has(fk.fromTable)) {
                    relationMap.set(fk.fromTable, { table: fk.fromTable, relatedTables: [] });
                }
                relationMap.get(fk.fromTable)!.relatedTables.push({
                    name: fk.toTable,
                    relation: 'many-to-one',
                    joinColumn: fk.fromColumn,
                    targetColumn: fk.toColumn,
                });

                // 添加 to_table 的反向关系
                if (!relationMap.has(fk.toTable)) {
                    relationMap.set(fk.toTable, { table: fk.toTable, relatedTables: [] });
                }
                relationMap.get(fk.toTable)!.relatedTables.push({
                    name: fk.fromTable,
                    relation: 'one-to-many',
                    joinColumn: fk.toColumn,
                    targetColumn: fk.fromColumn,
                });
            }

            relationships.push(...relationMap.values());

        } catch (e) {
            console.log('[analyze-schema] Could not fetch foreign keys:', e);
        }

        // 生成智能建议
        const suggestions = generateEnhancedSuggestions(tables, detectedDomains);

        // 基于外键关系生成 JOIN 查询建议
        if (foreignKeys.length > 0) {
            const joinSuggestions = generateJoinSuggestions(tables, foreignKeys);
            suggestions.push(...joinSuggestions);
        }

        await connection.end();

        // 检测主要业务领域
        let detectedDomain: string | undefined;
        if (detectedDomains.has('order') && detectedDomains.has('product')) {
            detectedDomain = '电商';
        } else if (detectedDomains.has('user')) {
            detectedDomain = '用户管理';
        } else if (detectedDomains.has('traffic')) {
            detectedDomain = '流量分析';
        }

        return {
            tables,
            suggestions,
            relationships: relationships.length > 0 ? relationships : undefined,
            summary: {
                tableCount: tableNames.length,
                totalColumns,
                totalRows,
                hasNumericColumns,
                hasDateColumns,
                detectedDomain,
                relationshipCount: foreignKeys.length,
            },
        };
    } catch (error) {
        await connection.end();
        throw error;
    }
}

// ============================================
// 生成增强建议
// ============================================

// 基于外键关系生成 JOIN 查询建议
function generateJoinSuggestions(tables: TableInfo[], foreignKeys: ForeignKeyRelation[]): SuggestedQuestion[] {
    const suggestions: SuggestedQuestion[] = [];
    let id = 1;

    // 分析常见的关联模式
    for (const fk of foreignKeys.slice(0, 5)) {  // 限制处理前5个外键
        const fromTable = tables.find(t => t.name === fk.fromTable);
        const toTable = tables.find(t => t.name === fk.toTable);

        if (!fromTable || !toTable) continue;

        // 查找合适的聚合列
        const numericCol = fromTable.columns.find(c =>
            c.type.toLowerCase().match(/int|decimal|float|double/) &&
            !c.isPrimaryKey &&
            c.name !== fk.fromColumn
        );

        // 查找标签列
        const labelCol = toTable.columns.find(c =>
            c.name.toLowerCase().includes('name') ||
            c.name.includes('名') ||
            (!c.isPrimaryKey && c.name !== fk.toColumn)
        );

        if (labelCol) {
            // 生成分组统计建议
            if (numericCol) {
                suggestions.push({
                    id: `join_sum_${id++}`,
                    text: `按${toTable.name}统计${fromTable.name}的${numericCol.name}总和`,
                    query: `SELECT t2.\`${labelCol.name}\`, SUM(t1.\`${numericCol.name}\`) as total FROM \`${fromTable.name}\` t1 JOIN \`${toTable.name}\` t2 ON t1.\`${fk.fromColumn}\` = t2.\`${fk.toColumn}\` GROUP BY t2.\`${labelCol.name}\` ORDER BY total DESC LIMIT 10`,
                    chartType: 'bar',
                    description: `关联 ${toTable.name} 表统计 ${numericCol.name} 的汇总`,
                    category: '关联分析',
                    priority: 1
                });
            }

            // 生成数量统计建议
            suggestions.push({
                id: `join_count_${id++}`,
                text: `按${toTable.name}统计${fromTable.name}数量`,
                query: `SELECT t2.\`${labelCol.name}\`, COUNT(*) as count FROM \`${fromTable.name}\` t1 JOIN \`${toTable.name}\` t2 ON t1.\`${fk.fromColumn}\` = t2.\`${fk.toColumn}\` GROUP BY t2.\`${labelCol.name}\` ORDER BY count DESC LIMIT 10`,
                chartType: 'bar',
                description: `按 ${toTable.name} 分组统计 ${fromTable.name} 的数量`,
                category: '关联分析',
                priority: 2
            });
        }
    }

    // 检测可能的多表关联（如 orders -> order_items -> products）
    const orderItemFk = foreignKeys.find(fk =>
        fk.fromTable.toLowerCase().includes('order_item') ||
        fk.fromTable.toLowerCase().includes('fact_order_items')
    );

    if (orderItemFk) {
        const orderFk = foreignKeys.find(fk =>
            fk.fromTable === orderItemFk.fromTable &&
            (fk.toTable.toLowerCase().includes('order') && !fk.toTable.toLowerCase().includes('item'))
        );
        const productFk = foreignKeys.find(fk =>
            fk.fromTable === orderItemFk.fromTable &&
            fk.toTable.toLowerCase().includes('product')
        );

        if (productFk) {
            const productTable = tables.find(t => t.name === productFk.toTable);
            const itemTable = tables.find(t => t.name === orderItemFk.fromTable);

            if (productTable && itemTable) {
                const nameCol = productTable.columns.find(c =>
                    c.name.toLowerCase().includes('name') || c.name.includes('名')
                );
                const qtyCol = itemTable.columns.find(c =>
                    c.name.toLowerCase().includes('qty') ||
                    c.name.toLowerCase().includes('quantity') ||
                    c.name.includes('数量')
                );
                const amountCol = itemTable.columns.find(c =>
                    c.name.toLowerCase().includes('amount') ||
                    c.name.toLowerCase().includes('total') ||
                    c.name.includes('金额')
                );

                if (nameCol && (qtyCol || amountCol)) {
                    const valueCol = amountCol || qtyCol;
                    suggestions.push({
                        id: `product_sales_${id++}`,
                        text: '商品销售额/销量排行榜',
                        query: `SELECT p.\`${nameCol.name}\`, SUM(oi.\`${valueCol!.name}\`) as total FROM \`${itemTable.name}\` oi JOIN \`${productTable.name}\` p ON oi.\`${productFk.fromColumn}\` = p.\`${productFk.toColumn}\` GROUP BY p.\`${productFk.toColumn}\`, p.\`${nameCol.name}\` ORDER BY total DESC LIMIT 15`,
                        chartType: 'bar',
                        description: '按商品统计销售总额或销量',
                        category: '关联分析',
                        priority: 1
                    });
                }
            }
        }
    }

    return suggestions;
}

function generateEnhancedSuggestions(tables: TableInfo[], detectedDomains: Set<string>): SuggestedQuestion[] {
    const suggestions: SuggestedQuestion[] = [];
    let id = 1;

    // 1. 基于表语义应用业务模板
    for (const table of tables) {
        const semantic = inferTableSemantics(table.name);
        if (semantic) {
            for (const templateName of semantic.templates) {
                const template = ANALYSIS_TEMPLATES[templateName];
                if (template) {
                    const suggestion = template(table, tables);
                    if (suggestion) {
                        suggestions.push(suggestion);
                    }
                }
            }
        }
    }

    // 2. 基于数据画像生成建议
    for (const table of tables) {
        if (!table.columnProfiles) continue;

        for (const [colName, profile] of Object.entries(table.columnProfiles)) {
            // 枚举字段 -> 分布统计
            if (profile.isEnum && profile.enumValues && profile.enumValues.length > 1) {
                suggestions.push({
                    id: `enum_${table.name}_${colName}_${id++}`,
                    text: `${table.name} 的 ${colName} 分布`,
                    query: `SELECT \`${colName}\`, COUNT(*) as count FROM \`${table.name}\` GROUP BY \`${colName}\` ORDER BY count DESC`,
                    chartType: profile.enumValues.length <= 6 ? 'pie' : 'bar',
                    description: `查看 ${colName} 各类别的分布情况`,
                    category: '分布统计',
                    priority: 2
                });
            }

            // 数值字段 -> 排名统计
            if (profile.semanticType === 'money' || profile.semanticType === 'score') {
                const labelCol = table.columns.find(c =>
                    c.name !== colName &&
                    !c.isPrimaryKey &&
                    (c.name.toLowerCase().includes('name') || c.name.includes('名'))
                );
                if (labelCol) {
                    suggestions.push({
                        id: `ranking_${table.name}_${colName}_${id++}`,
                        text: `${table.name} ${colName} 排行榜 TOP 10`,
                        query: `SELECT \`${labelCol.name}\`, \`${colName}\` FROM \`${table.name}\` ORDER BY \`${colName}\` DESC LIMIT 10`,
                        chartType: 'bar',
                        description: `按 ${colName} 降序排列前10名`,
                        category: '排行分析',
                        priority: 2
                    });
                }
            }
        }
    }

    // 3. 通用统计建议
    if (tables.length > 1) {
        suggestions.push({
            id: `table_overview_${id++}`,
            text: '数据库表数据量概览',
            query: tables.slice(0, 10).map(t => `SELECT '${t.name}' as table_name, ${t.rowCount} as row_count`).join(' UNION ALL '),
            chartType: 'bar',
            description: '查看各表的数据量分布',
            category: '数据概览',
            priority: 3
        });
    }

    // 4. 按优先级和类别排序，去重
    const uniqueSuggestions = Array.from(
        new Map(suggestions.map(s => [s.text, s])).values()
    );

    return uniqueSuggestions
        .sort((a, b) => a.priority - b.priority)
        .slice(0, 12);
}

// ============================================
// PostgreSQL 分析 (完整版)
// ============================================

async function analyzePostgresSchema(params: AnalyzeSchemaRequest): Promise<SchemaAnalysisResult> {
    const selectedDatabase = params.database || 'postgres';

    console.log('[analyze-schema] PostgreSQL: Connecting to database:', selectedDatabase, '(params.database was:', params.database, ')');

    const client = new PgClient({
        host: params.host,
        port: parseInt(params.port),
        user: params.user,
        password: params.password,
        database: selectedDatabase,
    });

    await client.connect();

    try {
        // 获取所有表 (排除系统 schema)
        const tablesResult = await client.query(`
            SELECT table_schema, table_name 
            FROM information_schema.tables 
            WHERE table_schema NOT IN ('information_schema', 'pg_catalog') 
            AND table_type = 'BASE TABLE'
        `);
        const allTables = tablesResult.rows.map(row => ({ schema: row.table_schema, name: row.table_name }));

        console.log('[analyze-schema] PostgreSQL: Found', allTables.length, 'tables in database', selectedDatabase, ':', allTables.slice(0, 5).map(t => `${t.schema}.${t.name}`));

        const tables: TableInfo[] = [];
        let totalColumns = 0;
        let totalRows = 0;
        let hasNumericColumns = false;
        let hasDateColumns = false;
        const detectedDomains = new Set<string>();

        for (const table of allTables.slice(0, 15)) {
            const tableName = table.name;
            const schemaName = table.schema;

            // 获取列信息（包括主键）
            const columnsResult = await client.query(`
                SELECT 
                    c.column_name, 
                    c.data_type, 
                    c.is_nullable,
                    CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary
                FROM information_schema.columns c
                LEFT JOIN (
                    SELECT kcu.column_name
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu 
                        ON tc.constraint_name = kcu.constraint_name
                    WHERE tc.table_name = $1 
                        AND tc.table_schema = $2
                        AND tc.constraint_type = 'PRIMARY KEY'
                ) pk ON c.column_name = pk.column_name
                WHERE c.table_name = $1 AND c.table_schema = $2
            `, [tableName, schemaName]);

            const columns: ColumnInfo[] = columnsResult.rows.map(col => {
                const type = col.data_type.toLowerCase();
                if (type.includes('int') || type.includes('numeric') || type.includes('decimal') || type.includes('real') || type.includes('double')) {
                    hasNumericColumns = true;
                }
                if (type.includes('date') || type.includes('time')) {
                    hasDateColumns = true;
                }
                return {
                    name: col.column_name,
                    type: col.data_type,
                    nullable: col.is_nullable === 'YES',
                    isPrimaryKey: col.is_primary,
                };
            });

            // 获取行数
            const countResult = await client.query(`SELECT COUNT(*) as count FROM "${tableName}"`);
            const rowCount = parseInt(countResult.rows[0]?.count || '0');
            totalRows += rowCount;

            // 推断表语义
            const tableSemantic = inferTableSemantics(tableName);
            if (tableSemantic) {
                detectedDomains.add(tableSemantic.domain);
            }

            // 数据画像（对小表进行采样分析）
            const columnProfiles: Record<string, ColumnProfile> = {};
            if (rowCount > 0 && rowCount < 100000) {
                for (const col of columns.slice(0, 10)) {
                    try {
                        // 基数分析
                        const distinctResult = await client.query(`
                            SELECT 
                                COUNT(DISTINCT "${col.name}") as distinct_count,
                                SUM(CASE WHEN "${col.name}" IS NULL THEN 1 ELSE 0 END) as null_count
                            FROM "${tableName}"
                        `);
                        const distinctCount = parseInt(distinctResult.rows[0]?.distinct_count || '0');
                        const nullCount = parseInt(distinctResult.rows[0]?.null_count || '0');

                        const profile: ColumnProfile = {
                            distinctCount,
                            nullCount,
                            nullRatio: rowCount > 0 ? nullCount / rowCount : 0,
                            isEnum: distinctCount > 0 && distinctCount <= 20 && distinctCount < rowCount * 0.1,
                        };

                        // 如果是枚举类型，获取枚举值
                        if (profile.isEnum && distinctCount <= 10) {
                            const enumResult = await client.query(`
                                SELECT DISTINCT "${col.name}" as val 
                                FROM "${tableName}" 
                                WHERE "${col.name}" IS NOT NULL 
                                LIMIT 10
                            `);
                            profile.enumValues = enumResult.rows.map(r => String(r.val));
                        }

                        // 数值列的统计
                        if (col.type.toLowerCase().match(/int|numeric|decimal|real|double/)) {
                            const statsResult = await client.query(`
                                SELECT 
                                    MIN("${col.name}") as min_val, 
                                    MAX("${col.name}") as max_val, 
                                    AVG("${col.name}"::numeric) as avg_val 
                                FROM "${tableName}"
                            `);
                            const stats = statsResult.rows[0];
                            profile.minValue = stats?.min_val;
                            profile.maxValue = stats?.max_val;
                            profile.avgValue = parseFloat(stats?.avg_val) || undefined;
                        }

                        // 语义推断
                        const semantic = inferColumnSemantics(col.name, col.type);
                        if (semantic) {
                            profile.semanticType = semantic.semanticType;
                        }

                        columnProfiles[col.name] = profile;
                    } catch (e) {
                        // 忽略单列分析错误
                    }
                }
            }

            tables.push({
                name: tableName,
                columns,
                rowCount,
                columnProfiles,
                semanticType: tableSemantic?.domain,
            });
            totalColumns += columns.length;
        }

        // ============================================
        // PostgreSQL 外键关系分析
        // ============================================

        const foreignKeys: ForeignKeyRelation[] = [];
        const relationships: TableRelationship[] = [];

        try {
            // 从 pg_constraint 获取外键关系 (查询所有非系统 schema)
            const fkResult = await client.query(`
                SELECT
                    tc.table_name as from_table,
                    kcu.column_name as from_column,
                    ccu.table_name as to_table,
                    ccu.column_name as to_column,
                    tc.constraint_name as relation_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                    ON tc.constraint_name = kcu.constraint_name
                    AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage ccu
                    ON ccu.constraint_name = tc.constraint_name
                    AND ccu.table_schema = tc.table_schema
                WHERE tc.constraint_type = 'FOREIGN KEY'
                    AND tc.table_schema NOT IN ('information_schema', 'pg_catalog')
            `);

            for (const fk of fkResult.rows) {
                foreignKeys.push({
                    fromTable: fk.from_table,
                    fromColumn: fk.from_column,
                    toTable: fk.to_table,
                    toColumn: fk.to_column,
                    relationName: fk.relation_name,
                });
            }

            // 构建表关系图
            const relationMap = new Map<string, TableRelationship>();

            for (const fk of foreignKeys) {
                if (!relationMap.has(fk.fromTable)) {
                    relationMap.set(fk.fromTable, { table: fk.fromTable, relatedTables: [] });
                }
                relationMap.get(fk.fromTable)!.relatedTables.push({
                    name: fk.toTable,
                    relation: 'many-to-one',
                    joinColumn: fk.fromColumn,
                    targetColumn: fk.toColumn,
                });

                if (!relationMap.has(fk.toTable)) {
                    relationMap.set(fk.toTable, { table: fk.toTable, relatedTables: [] });
                }
                relationMap.get(fk.toTable)!.relatedTables.push({
                    name: fk.fromTable,
                    relation: 'one-to-many',
                    joinColumn: fk.toColumn,
                    targetColumn: fk.fromColumn,
                });
            }

            relationships.push(...relationMap.values());
        } catch (e) {
            console.log('[analyze-schema] PostgreSQL: Could not fetch foreign keys:', e);
        }

        // 生成智能建议
        const suggestions = generateEnhancedSuggestionsForPostgres(tables, detectedDomains);

        // 基于外键关系生成 JOIN 建议
        if (foreignKeys.length > 0) {
            const joinSuggestions = generatePostgresJoinSuggestions(tables, foreignKeys);
            suggestions.push(...joinSuggestions);
        }

        await client.end();

        // 检测主要业务领域
        let detectedDomain: string | undefined;
        if (detectedDomains.has('order') && detectedDomains.has('product')) {
            detectedDomain = '电商';
        } else if (detectedDomains.has('user')) {
            detectedDomain = '用户管理';
        } else if (detectedDomains.has('traffic')) {
            detectedDomain = '流量分析';
        }

        return {
            tables,
            suggestions: suggestions.slice(0, 15),
            relationships: relationships.length > 0 ? relationships : undefined,
            summary: {
                tableCount: allTables.length,
                totalColumns,
                totalRows,
                hasNumericColumns,
                hasDateColumns,
                detectedDomain,
                relationshipCount: foreignKeys.length,
            },
        };
    } catch (error) {
        await client.end();
        throw error;
    }
}

// PostgreSQL 专用建议生成
function generateEnhancedSuggestionsForPostgres(tables: TableInfo[], detectedDomains: Set<string>): SuggestedQuestion[] {
    const suggestions: SuggestedQuestion[] = [];
    let id = 1;

    // 基于表语义应用业务模板
    for (const table of tables) {
        const semantic = inferTableSemantics(table.name);
        if (semantic) {
            for (const templateName of semantic.templates) {
                // 使用 PostgreSQL 语法的模板
                const suggestion = generatePostgresTemplateQuery(table, tables, templateName, id++);
                if (suggestion) {
                    suggestions.push(suggestion);
                }
            }
        }
    }

    // 基于数据画像生成建议
    for (const table of tables) {
        if (!table.columnProfiles) continue;

        for (const [colName, profile] of Object.entries(table.columnProfiles)) {
            // 枚举字段 -> 分布统计
            if (profile.isEnum && profile.enumValues && profile.enumValues.length > 1) {
                suggestions.push({
                    id: `pg_enum_${table.name}_${colName}_${id++}`,
                    text: `${table.name} 的 ${colName} 分布`,
                    query: `SELECT "${colName}", COUNT(*) as count FROM "${table.name}" GROUP BY "${colName}" ORDER BY count DESC`,
                    chartType: profile.enumValues.length <= 6 ? 'pie' : 'bar',
                    description: `查看 ${colName} 各类别的分布情况`,
                    category: '分布统计',
                    priority: 2
                });
            }

            // 数值字段 -> 排名统计
            if (profile.semanticType === 'money' || profile.semanticType === 'score') {
                const labelCol = table.columns.find(c =>
                    c.name !== colName && !c.isPrimaryKey &&
                    (c.name.toLowerCase().includes('name') || c.name.includes('名'))
                );
                if (labelCol) {
                    suggestions.push({
                        id: `pg_ranking_${table.name}_${colName}_${id++}`,
                        text: `${table.name} ${colName} 排行榜 TOP 10`,
                        query: `SELECT "${labelCol.name}", "${colName}" FROM "${table.name}" ORDER BY "${colName}" DESC LIMIT 10`,
                        chartType: 'bar',
                        description: `按 ${colName} 降序排列前10名`,
                        category: '排行分析',
                        priority: 2
                    });
                }
            }
        }
    }

    // 3. 兜底策略：基于数据类型的通用建议
    for (const table of tables) {
        // 查找日期列生成趋势
        const dateCol = table.columns.find(c =>
            c.type.toLowerCase().includes('date') || c.type.toLowerCase().includes('time')
        );

        if (dateCol) {
            const existingTrend = suggestions.find(s => s.id.includes(`pg_trend_${table.name}`));
            if (!existingTrend) {
                suggestions.push({
                    id: `pg_trend_${table.name}_${id++}`,
                    text: `${table.name} 时间趋势`,
                    query: `SELECT DATE("${dateCol.name}") as date, COUNT(*) as count FROM "${table.name}" GROUP BY DATE("${dateCol.name}") ORDER BY date DESC LIMIT 30`,
                    chartType: 'line',
                    description: `按时间统计 ${table.name} 的记录数量`,
                    category: '趋势分析',
                    priority: 2
                });
            }
        }

        // 查找数值列生成统计
        const numericCols = table.columns.filter(c =>
            c.type.toLowerCase().match(/int|numeric|decimal|real|double/) && !c.isPrimaryKey
        );

        if (numericCols.length > 0) {
            const targetCol = numericCols[0];
            const labelCol = table.columns.find(c =>
                c.type.toLowerCase().includes('char') || c.type.toLowerCase().includes('text')
            );

            if (labelCol) {
                suggestions.push({
                    id: `pg_stats_${table.name}_${targetCol.name}_${id++}`,
                    text: `${table.name} ${targetCol.name} 统计`,
                    query: `SELECT "${labelCol.name}", "${targetCol.name}" FROM "${table.name}" ORDER BY "${targetCol.name}" DESC LIMIT 10`,
                    chartType: 'bar',
                    description: `按 ${targetCol.name} 排序的前10条记录`,
                    category: '排行分析',
                    priority: 2
                });
            }
        }
    }

    // 通用统计建议
    if (tables.length > 1) {
        suggestions.push({
            id: `pg_table_overview_${id++}`,
            text: '数据库表数据量概览',
            query: tables.slice(0, 10).map(t => `SELECT '${t.name}' as table_name, COUNT(*) as row_count FROM "${t.name}"`).join(' UNION ALL '),
            chartType: 'bar',
            description: '查看各表的数据量分布',
            category: '数据概览',
            priority: 3
        });
    }

    return suggestions;
}

// PostgreSQL 模板查询生成
function generatePostgresTemplateQuery(table: TableInfo, allTables: TableInfo[], templateName: string, id: number): SuggestedQuestion | null {
    switch (templateName) {
        case 'user_growth': {
            const timeCol = table.columns.find(c =>
                c.name.toLowerCase().includes('creat') || c.name.toLowerCase().includes('regist')
            );
            if (!timeCol) return null;
            return {
                id: `pg_${templateName}_${id}`,
                text: '用户增长趋势分析',
                query: `SELECT DATE("${timeCol.name}") as date, COUNT(*) as new_users FROM "${table.name}" GROUP BY DATE("${timeCol.name}") ORDER BY date DESC LIMIT 30`,
                chartType: 'line',
                description: '查看每日新增用户数量趋势',
                category: '用户分析',
                priority: 1
            };
        }
        case 'order_trend': {
            const timeCol = table.columns.find(c =>
                c.type.toLowerCase().includes('date') || c.type.toLowerCase().includes('time')
            );
            if (!timeCol) return null;
            return {
                id: `pg_${templateName}_${id}`,
                text: '订单数量趋势',
                query: `SELECT DATE("${timeCol.name}") as date, COUNT(*) as order_count FROM "${table.name}" GROUP BY DATE("${timeCol.name}") ORDER BY date DESC LIMIT 30`,
                chartType: 'line',
                description: '查看每日订单数量变化趋势',
                category: '订单分析',
                priority: 1
            };
        }
        case 'order_status': {
            const statusCol = table.columns.find(c =>
                ['status', 'state', 'order_status'].some(k => c.name.toLowerCase().includes(k))
            );
            if (!statusCol) return null;
            return {
                id: `pg_${templateName}_${id}`,
                text: '订单状态分布',
                query: `SELECT "${statusCol.name}", COUNT(*) as count FROM "${table.name}" GROUP BY "${statusCol.name}"`,
                chartType: 'pie',
                description: '查看各状态订单的占比',
                category: '订单分析',
                priority: 1
            };
        }
        default:
            return null;
    }
}

// PostgreSQL JOIN 建议生成
function generatePostgresJoinSuggestions(tables: TableInfo[], foreignKeys: ForeignKeyRelation[]): SuggestedQuestion[] {
    const suggestions: SuggestedQuestion[] = [];
    let id = 1;

    for (const fk of foreignKeys.slice(0, 5)) {
        const fromTable = tables.find(t => t.name === fk.fromTable);
        const toTable = tables.find(t => t.name === fk.toTable);

        if (!fromTable || !toTable) continue;

        const numericCol = fromTable.columns.find(c =>
            c.type.toLowerCase().match(/int|numeric|decimal/) && !c.isPrimaryKey && c.name !== fk.fromColumn
        );

        const labelCol = toTable.columns.find(c =>
            c.name.toLowerCase().includes('name') || (!c.isPrimaryKey && c.name !== fk.toColumn)
        );

        if (labelCol) {
            if (numericCol) {
                suggestions.push({
                    id: `pg_join_sum_${id++}`,
                    text: `按${toTable.name}统计${fromTable.name}的${numericCol.name}总和`,
                    query: `SELECT t2."${labelCol.name}", SUM(t1."${numericCol.name}") as total FROM "${fromTable.name}" t1 JOIN "${toTable.name}" t2 ON t1."${fk.fromColumn}" = t2."${fk.toColumn}" GROUP BY t2."${labelCol.name}" ORDER BY total DESC LIMIT 10`,
                    chartType: 'bar',
                    description: `关联 ${toTable.name} 表统计 ${numericCol.name} 的汇总`,
                    category: '关联分析',
                    priority: 1
                });
            }

            suggestions.push({
                id: `pg_join_count_${id++}`,
                text: `按${toTable.name}统计${fromTable.name}数量`,
                query: `SELECT t2."${labelCol.name}", COUNT(*) as count FROM "${fromTable.name}" t1 JOIN "${toTable.name}" t2 ON t1."${fk.fromColumn}" = t2."${fk.toColumn}" GROUP BY t2."${labelCol.name}" ORDER BY count DESC LIMIT 10`,
                chartType: 'bar',
                description: `按 ${toTable.name} 分组统计 ${fromTable.name} 的数量`,
                category: '关联分析',
                priority: 2
            });
        }
    }

    return suggestions;
}

// ============================================
// MongoDB 分析 (完整版)
// ============================================

async function analyzeMongoDBSchema(params: AnalyzeSchemaRequest): Promise<SchemaAnalysisResult> {
    const uri = params.user && params.password
        ? `mongodb://${params.user}:${encodeURIComponent(params.password)}@${params.host}:${params.port}`
        : `mongodb://${params.host}:${params.port}`;

    // Add connection timeout options for resilience
    const client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 5000,  // 5秒服务器选择超时
        connectTimeoutMS: 5000,           // 5秒连接超时
        socketTimeoutMS: 10000,           // 10秒 socket 超时
    });

    try {
        await client.connect();
    } catch (connectError: any) {
        console.error('[analyze-schema] MongoDB connection failed:', connectError.message);
        // Return empty result with basic MongoDB suggestions
        return {
            tables: [],
            suggestions: generateMongoDBSuggestions([], new Set<string>()),
            summary: {
                tableCount: 0,
                totalColumns: 0,
                totalRows: 0,
                hasNumericColumns: false,
                hasDateColumns: false,
                detectedDomain: 'MongoDB'
            }
        };
    }

    try {
        const db = client.db(params.database);
        const allCollections = await db.listCollections().toArray();
        // 排除系统集合
        const collections = allCollections.filter(c => !c.name.startsWith('system.'));

        const tables: TableInfo[] = [];
        let totalColumns = 0;
        let totalRows = 0;
        let hasNumericColumns = false;
        let hasDateColumns = false;
        const detectedDomains = new Set<string>();

        for (const collection of collections.slice(0, 10)) {
            const coll = db.collection(collection.name);

            // 采样多个文档来推断字段结构
            const sampleDocs = await coll.find({}).limit(10).toArray();
            const fieldMap = new Map<string, { type: string; count: number; values: Set<any> }>();

            for (const doc of sampleDocs) {
                for (const [key, value] of Object.entries(doc)) {
                    const fieldType = getMongoFieldType(value);
                    if (!fieldMap.has(key)) {
                        fieldMap.set(key, { type: fieldType, count: 0, values: new Set() });
                    }
                    const field = fieldMap.get(key)!;
                    field.count++;
                    if (field.values.size < 20) {
                        field.values.add(value);
                    }

                    // 检测特殊类型
                    if (fieldType === 'number') hasNumericColumns = true;
                    if (fieldType === 'date') hasDateColumns = true;
                }
            }

            const columns: ColumnInfo[] = [];
            const columnProfiles: Record<string, ColumnProfile> = {};

            for (const [key, fieldInfo] of fieldMap.entries()) {
                columns.push({
                    name: key,
                    type: fieldInfo.type,
                    nullable: fieldInfo.count < sampleDocs.length,
                    isPrimaryKey: key === '_id',
                });

                // 数据画像
                const profile: ColumnProfile = {
                    distinctCount: fieldInfo.values.size,
                    nullCount: sampleDocs.length - fieldInfo.count,
                    nullRatio: (sampleDocs.length - fieldInfo.count) / sampleDocs.length,
                    isEnum: fieldInfo.values.size > 1 && fieldInfo.values.size <= 10,
                };

                if (profile.isEnum) {
                    profile.enumValues = Array.from(fieldInfo.values).slice(0, 10).map(v => String(v));
                }

                // 语义推断
                const semantic = inferColumnSemantics(key, fieldInfo.type);
                if (semantic) {
                    profile.semanticType = semantic.semanticType;
                }

                columnProfiles[key] = profile;
            }

            const rowCount = await coll.countDocuments();
            totalRows += rowCount;

            // 推断集合语义
            const tableSemantic = inferTableSemantics(collection.name);
            if (tableSemantic) {
                detectedDomains.add(tableSemantic.domain);
            }

            tables.push({
                name: collection.name,
                columns,
                rowCount,
                columnProfiles,
                semanticType: tableSemantic?.domain,
            });
            totalColumns += columns.length;
        }

        // 生成 MongoDB 智能建议
        const suggestions = generateMongoDBSuggestions(tables, detectedDomains);

        await client.close();

        // 检测主要业务领域
        let detectedDomain: string | undefined;
        if (detectedDomains.has('order') && detectedDomains.has('product')) {
            detectedDomain = '电商';
        } else if (detectedDomains.has('user')) {
            detectedDomain = '用户管理';
        }

        return {
            tables,
            suggestions: suggestions.slice(0, 12),
            summary: {
                tableCount: collections.length,
                totalColumns,
                totalRows,
                hasNumericColumns,
                hasDateColumns,
                detectedDomain,
            },
        };
    } catch (error) {
        await client.close();
        throw error;
    }
}

// 获取 MongoDB 字段类型
function getMongoFieldType(value: any): string {
    if (value === null || value === undefined) return 'null';
    if (value instanceof Date) return 'date';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') return 'object';
    return typeof value;
}

// 生成 MongoDB 智能建议
function generateMongoDBSuggestions(tables: TableInfo[], detectedDomains: Set<string>): SuggestedQuestion[] {
    const suggestions: SuggestedQuestion[] = [];
    let id = 1;

    for (const table of tables) {
        // 1. 基础文档统计
        suggestions.push({
            id: `mongo_count_${id++}`,
            text: `${table.name} 文档总数`,
            query: JSON.stringify({ collection: table.name, operation: 'count' }),
            chartType: 'table',
            description: `统计 ${table.name} 集合中的文档数量`,
            category: '基础统计',
            priority: 3
        });

        // 2. 基于数据画像生成建议
        if (table.columnProfiles) {
            for (const [colName, profile] of Object.entries(table.columnProfiles)) {
                if (colName === '_id') continue;

                // 枚举字段 -> 分组统计
                if (profile.isEnum && profile.enumValues && profile.enumValues.length > 1) {
                    suggestions.push({
                        id: `mongo_group_${table.name}_${colName}_${id++}`,
                        text: `${table.name} 按 ${colName} 分组统计`,
                        query: JSON.stringify({
                            collection: table.name,
                            operation: 'aggregate',
                            pipeline: [
                                { $group: { _id: `$${colName}`, count: { $sum: 1 } } },
                                { $sort: { count: -1 } },
                                { $limit: 10 }
                            ]
                        }),
                        chartType: profile.enumValues.length <= 6 ? 'pie' : 'bar',
                        description: `按 ${colName} 分组统计文档数量`,
                        category: '分布统计',
                        priority: 2
                    });
                }

                // 数值字段 -> 聚合统计
                if (profile.semanticType === 'money' || profile.semanticType === 'quantity') {
                    suggestions.push({
                        id: `mongo_sum_${table.name}_${colName}_${id++}`,
                        text: `${table.name} ${colName} 汇总统计`,
                        query: JSON.stringify({
                            collection: table.name,
                            operation: 'aggregate',
                            pipeline: [
                                {
                                    $group: {
                                        _id: null,
                                        total: { $sum: `$${colName}` },
                                        avg: { $avg: `$${colName}` },
                                        min: { $min: `$${colName}` },
                                        max: { $max: `$${colName}` }
                                    }
                                }
                            ]
                        }),
                        chartType: 'table',
                        description: `计算 ${colName} 的总和、平均值、最大最小值`,
                        category: '聚合统计',
                        priority: 1
                    });
                }
            }
        }

        // 3. 时间字段 -> 趋势分析
        const dateCol = table.columns.find(c => c.type === 'date');
        if (dateCol) {
            suggestions.push({
                id: `mongo_trend_${table.name}_${id++}`,
                text: `${table.name} 时间趋势分析`,
                query: JSON.stringify({
                    collection: table.name,
                    operation: 'aggregate',
                    pipeline: [
                        {
                            $group: {
                                _id: { $dateToString: { format: '%Y-%m-%d', date: `$${dateCol.name}` } },
                                count: { $sum: 1 }
                            }
                        },
                        { $sort: { _id: -1 } },
                        { $limit: 30 }
                    ]
                }),
                chartType: 'line',
                description: `按日期统计 ${table.name} 的数量趋势`,
                category: '趋势分析',
                priority: 1
            });
        }

        // 4. 基于表语义生成建议
        const semantic = inferTableSemantics(table.name);
        if (semantic) {
            switch (semantic.domain) {
                case 'order': {
                    const amountCol = table.columns.find(c =>
                        c.name.toLowerCase().includes('amount') || c.name.toLowerCase().includes('total')
                    );
                    if (amountCol) {
                        suggestions.push({
                            id: `mongo_order_amount_${id++}`,
                            text: '订单金额统计',
                            query: JSON.stringify({
                                collection: table.name,
                                operation: 'aggregate',
                                pipeline: [
                                    {
                                        $group: {
                                            _id: null,
                                            totalAmount: { $sum: `$${amountCol.name}` },
                                            avgAmount: { $avg: `$${amountCol.name}` },
                                            orderCount: { $sum: 1 }
                                        }
                                    }
                                ]
                            }),
                            chartType: 'table',
                            description: '统计订单总金额、平均金额和订单数',
                            category: '订单分析',
                            priority: 1
                        });
                    }
                    break;
                }
                case 'user': {
                    suggestions.push({
                        id: `mongo_user_count_${id++}`,
                        text: '用户总数统计',
                        query: JSON.stringify({
                            collection: table.name,
                            operation: 'count'
                        }),
                        chartType: 'table',
                        description: '统计用户总数',
                        category: '用户分析',
                        priority: 1
                    });
                    break;
                }
                case 'product': {
                    const priceCol = table.columns.find(c =>
                        c.name.toLowerCase().includes('price')
                    );
                    const nameCol = table.columns.find(c =>
                        c.name.toLowerCase().includes('name')
                    );
                    if (priceCol && nameCol) {
                        suggestions.push({
                            id: `mongo_product_price_${id++}`,
                            text: '商品价格 TOP 10',
                            query: JSON.stringify({
                                collection: table.name,
                                operation: 'aggregate',
                                pipeline: [
                                    { $sort: { [priceCol.name]: -1 } },
                                    { $limit: 10 },
                                    { $project: { [nameCol.name]: 1, [priceCol.name]: 1 } }
                                ]
                            }),
                            chartType: 'bar',
                            description: '显示价格最高的10个商品',
                            category: '商品分析',
                            priority: 1
                        });
                    }
                    break;
                }
            }
        }
    }

    // 5. 集合数据量对比
    if (tables.length > 1) {
        suggestions.push({
            id: `mongo_overview_${id++}`,
            text: '各集合文档数量对比',
            query: JSON.stringify({
                operation: 'collectionStats',
                collections: tables.slice(0, 8).map(t => ({ name: t.name, count: t.rowCount }))
            }),
            chartType: 'bar',
            description: '对比各集合的文档数量',
            category: '数据概览',
            priority: 3
        });
    }

    return suggestions;
}

// ============================================
// Redis 分析
// ============================================

async function analyzeRedisSchema(params: AnalyzeSchemaRequest): Promise<SchemaAnalysisResult> {
    // Parse database number, default to 0 if not a valid number
    const dbIndex = params.database ? parseInt(params.database.replace(/\D/g, '')) || 0 : 0;

    const client = createClient({
        socket: {
            host: params.host,
            port: parseInt(params.port),
            connectTimeout: 5000,
        },
        password: params.password || undefined,
        database: dbIndex,
    });

    try {
        await client.connect();
    } catch (connectError: any) {
        console.error('[analyze-schema] Redis connection failed:', connectError.message);
        // Return empty result instead of throwing
        return {
            tables: [],
            suggestions: generateRedisSuggestions([], dbIndex),
            summary: {
                tableCount: 0,
                totalColumns: 0,
                totalRows: 0,
                hasNumericColumns: false,
                hasDateColumns: false,
                detectedDomain: 'Redis 缓存'
            }
        };
    }

    try {
        // Get database size
        const dbSize = await client.dbSize();

        // Get some sample keys to understand the data structure
        const keyTypes: Record<string, number> = {};
        let sampleKeys: string[] = [];

        try {
            const scanResult = await client.scan('0', { COUNT: 100 });
            sampleKeys = scanResult.keys;

            // Get types for sample keys
            for (const key of sampleKeys.slice(0, 20)) {
                try {
                    const keyType = await client.type(key);
                    keyTypes[keyType] = (keyTypes[keyType] || 0) + 1;
                } catch {
                    // Ignore individual key errors
                }
            }
        } catch {
            // SCAN might fail on some Redis versions
        }

        await client.quit();

        // Create a pseudo-table representation for Redis key types
        const tables: TableInfo[] = Object.entries(keyTypes).map(([type, count]) => ({
            name: `键类型: ${type}`,
            columns: [
                { name: 'key', type: 'string', nullable: false },
                { name: 'value', type: type, nullable: true }
            ],
            rowCount: count,
            semanticType: 'redis_keys'
        }));

        const suggestions = generateRedisSuggestions(tables, dbIndex, dbSize, sampleKeys);

        return {
            tables,
            suggestions,
            summary: {
                tableCount: Object.keys(keyTypes).length,
                totalColumns: 2,
                totalRows: dbSize,
                hasNumericColumns: keyTypes['string'] > 0,
                hasDateColumns: false,
                detectedDomain: 'Redis 缓存'
            }
        };

    } catch (error) {
        await client.quit();
        throw error;
    }
}

function generateRedisSuggestions(
    tables: TableInfo[],
    dbIndex: number,
    dbSize: number = 0,
    sampleKeys: string[] = []
): SuggestedQuestion[] {
    const suggestions: SuggestedQuestion[] = [];
    let id = 1;

    // Basic Redis suggestions
    suggestions.push({
        id: `redis_${id++}`,
        text: '查看数据库键数量',
        query: 'DBSIZE',
        chartType: 'table',
        description: `统计 db${dbIndex} 的键总数 (当前: ${dbSize})`,
        category: '数据概览',
        priority: 1
    });

    suggestions.push({
        id: `redis_${id++}`,
        text: '查看服务器信息',
        query: 'INFO',
        chartType: 'table',
        description: '获取 Redis 服务器状态信息',
        category: '系统信息',
        priority: 2
    });

    suggestions.push({
        id: `redis_${id++}`,
        text: '查看内存使用情况',
        query: 'INFO memory',
        chartType: 'table',
        description: '获取内存使用统计',
        category: '系统信息',
        priority: 2
    });

    suggestions.push({
        id: `redis_${id++}`,
        text: '扫描键列表',
        query: 'SCAN 0 COUNT 100',
        chartType: 'table',
        description: '列出数据库中的键',
        category: '数据浏览',
        priority: 3
    });

    // Add suggestions for sample keys if available
    if (sampleKeys.length > 0) {
        const sampleKey = sampleKeys[0];
        suggestions.push({
            id: `redis_${id++}`,
            text: `查看键 "${sampleKey.substring(0, 20)}${sampleKey.length > 20 ? '...' : ''}"`,
            query: `GET ${sampleKey}`,
            chartType: 'table',
            description: '获取指定键的值',
            category: '数据浏览',
            priority: 3
        });
    }

    suggestions.push({
        id: `redis_${id++}`,
        text: '查看慢查询日志',
        query: 'SLOWLOG GET 10',
        chartType: 'table',
        description: '获取最近的慢查询记录',
        category: '性能分析',
        priority: 2
    });

    return suggestions;
}

// ============================================
// API 入口
// ============================================

export async function POST(request: NextRequest) {
    try {
        const params: AnalyzeSchemaRequest = await request.json();

        console.log('[analyze-schema] 📊 Enhanced analysis for:', {
            type: params.type,
            host: params.host,
            database: params.database,
        });

        if (!params.type || !params.host || !params.port) {
            return NextResponse.json(
                { success: false, error: 'Missing required connection parameters' },
                { status: 400 }
            );
        }

        let result: SchemaAnalysisResult;

        switch (params.type.toLowerCase()) {
            case 'mysql':
                result = await analyzeMySQLSchema(params);
                break;
            case 'postgres':
                result = await analyzePostgresSchema(params);
                break;
            case 'mongodb':
                result = await analyzeMongoDBSchema(params);
                break;
            case 'redis':
                result = await analyzeRedisSchema(params);
                break;
            default:
                return NextResponse.json(
                    { success: false, error: 'Unsupported database type' },
                    { status: 400 }
                );
        }

        console.log('[analyze-schema] ✅ Enhanced analysis complete:', {
            tableCount: result.summary.tableCount,
            totalRows: result.summary.totalRows,
            suggestionsCount: result.suggestions.length,
            detectedDomain: result.summary.detectedDomain,
        });

        // Phase 1: Generate AI-powered suggestions (skip for Redis/MongoDB - they don't use SQL)
        if (params.type.toLowerCase() !== 'redis' && params.type.toLowerCase() !== 'mongodb') {
            try {
                const schemaForAI = result.tables.map(t => ({
                    name: t.name,
                    columns: t.columns.map(c => ({
                        name: c.name,
                        type: c.type,
                        nullable: c.nullable,
                        isPrimaryKey: c.isPrimaryKey,
                    })),
                    rowCount: t.rowCount,
                }));

                const aiResult = await generateAISuggestions({
                    schema: schemaForAI,
                    dbType: params.type,
                    dbName: params.database || 'default',
                });

                if (aiResult.suggestions.length > 0) {
                    // Merge AI suggestions with template-based ones, AI first
                    result.suggestions = [
                        ...aiResult.suggestions,
                        ...result.suggestions.filter(s =>
                            !aiResult.suggestions.some(ai => ai.query === s.query)
                        ).slice(0, 4)  // Keep top 4 template suggestions as fallback
                    ].slice(0, 10);  // Limit total to 10

                    // Update domain if AI detected one
                    if (aiResult.domain && aiResult.domain !== '通用分析') {
                        result.summary.detectedDomain = aiResult.domain;
                    }

                    console.log('[analyze-schema] 🤖 AI suggestions added:', aiResult.suggestions.length);
                }
            } catch (aiError) {
                console.log('[analyze-schema] AI suggestions failed, using templates:', aiError);
            }
        }

        // Phase 2: Data profiling for additional insights
        try {
            if (!['mongodb', 'redis'].includes(params.type.toLowerCase())) {
                const { allInsights } = await profileDatabaseTables(
                    {
                        type: params.type,
                        host: params.host,
                        port: parseInt(params.port),
                        user: params.user || '',
                        password: params.password || '',
                        database: params.database || '',
                    },
                    result.tables.slice(0, 3).map(t => ({
                        name: t.name,
                        columns: t.columns.map(c => ({ name: c.name, type: c.type })),
                    }))
                );

                // Add data-driven insights as suggestions
                const insightSuggestions = allInsights.slice(0, 3).map((insight, i) => ({
                    id: `insight_${Date.now()}_${i}`,
                    text: insight.description,
                    query: insight.suggestedQuery,
                    chartType: insight.chartType,
                    description: insight.description,
                    category: insight.type === 'trend' ? '趋势分析' :
                        insight.type === 'distribution' ? '分布统计' : '数据洞察',
                    priority: insight.priority,
                }));

                // Add insights that aren't duplicates
                for (const s of insightSuggestions) {
                    if (!result.suggestions.some(existing => existing.query === s.query)) {
                        result.suggestions.push(s);
                    }
                }

                console.log('[analyze-schema] 📊 Data insights added:', insightSuggestions.length);
            }
        } catch (profileError) {
            console.log('[analyze-schema] Data profiling failed:', profileError);
        }

        return NextResponse.json({
            success: true,
            ...result,
        });

    } catch (error: any) {
        console.error('[analyze-schema] ❌ Error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Failed to analyze schema' },
            { status: 500 }
        );
    }
}
