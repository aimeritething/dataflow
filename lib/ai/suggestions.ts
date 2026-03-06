/**
 * AI-Powered Suggestions Generator
 * 
 * Uses LLM to generate intelligent data analysis questions based on database schema.
 * Provides smart categorization based on detected business domain.
 */

import { getAIConfig, validateAIConfig, type AIConfig } from './config';
import type { TableSchema } from './sql-agent';

export interface SuggestedQuestion {
    id: string;
    text: string;
    query: string;
    chartType: 'bar' | 'line' | 'pie' | 'table' | 'area';
    description: string;
    category: string;
    priority: number;
}

export interface GenerateSuggestionsParams {
    schema: TableSchema[];
    dbType: string;
    dbName: string;
    relationships?: Array<{
        fromTable: string;
        fromColumn: string;
        toTable: string;
        toColumn: string;
    }>;
}

// Business domain detection keywords
const DOMAIN_KEYWORDS: Record<string, string[]> = {
    '电商分析': ['order', 'product', 'cart', 'payment', 'customer', '订单', '商品', '购物车'],
    '用户分析': ['user', 'member', 'account', 'login', 'register', '用户', '会员', '账户'],
    '内容分析': ['article', 'post', 'comment', 'like', 'view', '文章', '帖子', '评论'],
    '财务分析': ['transaction', 'balance', 'account', 'payment', 'invoice', '交易', '余额', '发票'],
    '库存分析': ['inventory', 'stock', 'warehouse', 'supplier', '库存', '仓库', '供应商'],
    '流量分析': ['traffic', 'visit', 'pageview', 'session', 'click', '访问', '流量', '点击'],
};

// Smart category templates based on domain
const CATEGORY_TEMPLATES: Record<string, string[]> = {
    '电商分析': ['销售趋势', '商品排行', '客户分析', '订单状态', '地区分布'],
    '用户分析': ['增长趋势', '用户画像', '活跃度分析', '留存分析', '等级分布'],
    '内容分析': ['内容热度', '互动分析', '发布趋势', '作者排行', '分类分布'],
    '财务分析': ['收支趋势', '交易分析', '账户概览', '异常检测'],
    '库存分析': ['库存预警', '周转分析', '供应商分析', '入库趋势'],
    '流量分析': ['流量趋势', '来源分布', '页面热度', '设备分析', '转化分析'],
    '通用分析': ['数据概览', '趋势分析', '排行榜', '分布统计'],
};

/**
 * Detect business domain from schema
 */
export function detectBusinessDomain(schema: TableSchema[]): string {
    const tableNames = schema.map(t => t.name.toLowerCase());
    const allColumnNames = schema.flatMap(t => t.columns.map(c => c.name.toLowerCase()));
    const allNames = [...tableNames, ...allColumnNames];

    const domainScores: Record<string, number> = {};

    for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
        domainScores[domain] = keywords.filter(keyword =>
            allNames.some(name => name.includes(keyword.toLowerCase()))
        ).length;
    }

    const topDomain = Object.entries(domainScores)
        .sort((a, b) => b[1] - a[1])
        .find(([, score]) => score > 0);

    return topDomain ? topDomain[0] : '通用分析';
}

/**
 * Get smart categories for a domain
 */
export function getSmartCategories(domain: string): string[] {
    return CATEGORY_TEMPLATES[domain] || CATEGORY_TEMPLATES['通用分析'];
}

/**
 * Format schema for AI prompt
 */
function formatSchemaForAI(schema: TableSchema[]): string {
    return schema.slice(0, 10).map(table => {
        const cols = table.columns.slice(0, 15).map(c =>
            `  - ${c.name} (${c.type})${c.isPrimaryKey ? ' PK' : ''}`
        ).join('\n');
        return `表: ${table.name} (${table.rowCount || '?'} 行)\n${cols}`;
    }).join('\n\n');
}

/**
 * Call AI to generate suggestions
 */
async function callAIForSuggestions(
    config: AIConfig,
    schema: string,
    dbType: string,
    domain: string,
    categories: string[]
): Promise<SuggestedQuestion[]> {
    const prompt = `你是数据分析专家。根据以下数据库结构，生成 6-8 个有价值的分析问题。

数据库类型: ${dbType}
检测到的业务领域: ${domain}
推荐分类: ${categories.join(', ')}

表结构:
${schema}

要求:
1. 返回 JSON 数组，每个对象包含: text(问题), query(SQL), chartType(bar/line/pie/table), category(分类), priority(1-3)
2. 问题要贴合业务场景，使用口语化表达
3. SQL 要正确可执行，适配 ${dbType}
4. 优先生成跨表分析和趋势分析
5. 只返回 JSON，不要其他内容

示例格式:
[{"text":"近30天销售额趋势","query":"SELECT DATE(created_at) as date, SUM(amount) as total FROM orders GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 30","chartType":"line","category":"销售趋势","priority":1}]`;

    const baseUrl = config.baseUrl || 'https://api.anthropic.com';
    const authHeader = config.authToken || config.apiKey;

    const response = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': authHeader!,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: config.model,
            max_tokens: 2048,
            messages: [{ role: 'user', content: prompt }],
        }),
    });

    if (!response.ok) {
        throw new Error(`AI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.content[0]?.text?.trim() || '';

    // Parse JSON from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
        throw new Error('No valid JSON in AI response');
    }

    const suggestions = JSON.parse(jsonMatch[0]) as Array<{
        text: string;
        query: string;
        chartType: string;
        category: string;
        priority: number;
    }>;

    return suggestions.map((s, i) => ({
        id: `ai_${Date.now()}_${i}`,
        text: s.text,
        query: s.query,
        chartType: (s.chartType as 'bar' | 'line' | 'pie' | 'table' | 'area') || 'table',
        description: s.text,
        category: s.category || '数据分析',
        priority: s.priority || 2,
    }));
}

/**
 * Generate AI-powered suggestions
 */
export async function generateAISuggestions(
    params: GenerateSuggestionsParams
): Promise<{ suggestions: SuggestedQuestion[]; domain: string; categories: string[] }> {
    const config = getAIConfig();
    const validation = validateAIConfig(config);

    if (!validation.valid) {
        // Fallback: return empty, let the template-based suggestions handle it
        return { suggestions: [], domain: '通用分析', categories: [] };
    }

    try {
        // Detect business domain
        const domain = detectBusinessDomain(params.schema);
        const categories = getSmartCategories(domain);

        // Format schema for AI
        const schemaStr = formatSchemaForAI(params.schema);

        // Call AI
        const suggestions = await callAIForSuggestions(
            config,
            schemaStr,
            params.dbType,
            domain,
            categories
        );

        return { suggestions, domain, categories };
    } catch (error) {
        console.error('[AI Suggestions] Error:', error);
        return { suggestions: [], domain: '通用分析', categories: [] };
    }
}
