/**
 * SQL Generation Prompts
 * 
 * Templates for AI-powered SQL generation, explanation, and optimization.
 */

/**
 * Main SQL generation prompt
 */
export const SQL_GENERATION_PROMPT = `你是一个 SQL 专家。根据用户问题生成 SQL 查询。

**重要：你必须只返回 SQL 语句本身，不要包含任何解释、注释或 markdown 代码块标记。**

## 数据库信息
- 数据库类型: {dbType}
- 数据库名称: {dbName}

## 可用的表结构
{schema}

## 规则
1. 只返回可直接执行的 SQL 语句
2. 不要添加任何解释文字
3. 不要使用 \`\`\` 代码块
4. 支持的命令包括：SELECT, SHOW TABLES, SHOW DATABASES, DESCRIBE 等
5. 如果用户询问有哪些表，使用 SHOW TABLES
6. 如果用户询问表结构，使用 DESCRIBE table_name

## 用户问题
{question}

## SQL（只输出 SQL，不要任何其他内容）`;

/**
 * SQL explanation prompt
 */
export const SQL_EXPLANATION_PROMPT = `请用简洁的中文解释以下 SQL 查询的含义和作用：

SQL 查询：
\`\`\`sql
{sql}
\`\`\`

请解释：
1. 这个查询做了什么
2. 查询了哪些表
3. 返回的数据是什么`;

/**
 * Query refinement prompt for when SQL execution fails
 */
export const QUERY_REFINEMENT_PROMPT = `之前的 SQL 执行失败，请修正。

**重要：只返回修正后的 SQL 语句，不要任何解释或代码块标记。**

- 数据库类型: {dbType}
- 数据库名称: {dbName}

## 表结构
{schema}

## 原始问题
{question}

## 失败的 SQL
{previousSql}

## 错误信息
{error}

## 修正后的 SQL（只输出 SQL）`;

/**
 * Schema summary prompt for generating smart suggestions
 */
export const SCHEMA_SUMMARY_PROMPT = `分析以下数据库表结构，生成 3-5 个有价值的分析问题建议。

## 表结构
{schema}

## 要求
1. 每个问题应该有实际的业务价值
2. 问题应该覆盖不同的分析角度（趋势、分布、关联等）
3. 返回 JSON 格式，每个问题包含：text（问题文本）、category（分类）、chartType（推荐图表类型）

## 示例格式
\`\`\`json
[
  {
    "text": "最近7天的订单趋势",
    "category": "趋势分析",
    "chartType": "line"
  }
]
\`\`\``;

/**
 * Format schema information for prompt
 */
export function formatSchemaForPrompt(tables: Array<{
    name: string;
    columns: Array<{ name: string; type: string; nullable?: boolean; key?: string }>;
}>): string {
    return tables.map(table => {
        const columnsStr = table.columns
            .map(col => {
                let colInfo = `  - ${col.name}: ${col.type}`;
                if (col.key === 'PRI') colInfo += ' (PRIMARY KEY)';
                if (col.key === 'MUL') colInfo += ' (INDEX)';
                if (col.nullable === false) colInfo += ' NOT NULL';
                return colInfo;
            })
            .join('\n');
        return `### ${table.name}\n${columnsStr}`;
    }).join('\n\n');
}

/**
 * Build the complete SQL generation prompt
 */
export function buildSqlGenerationPrompt(params: {
    question: string;
    schema: string;
    dbType: string;
    dbName: string;
}): string {
    return SQL_GENERATION_PROMPT
        .replace('{question}', params.question)
        .replace('{schema}', params.schema)
        .replace(/\{dbType\}/g, params.dbType)
        .replace('{dbName}', params.dbName);
}

/**
 * Build the query refinement prompt
 */
export function buildRefinementPrompt(params: {
    question: string;
    schema: string;
    dbType: string;
    dbName: string;
    previousSql: string;
    error: string;
}): string {
    return QUERY_REFINEMENT_PROMPT
        .replace('{question}', params.question)
        .replace('{schema}', params.schema)
        .replace(/\{dbType\}/g, params.dbType)
        .replace('{dbName}', params.dbName)
        .replace('{previousSql}', params.previousSql)
        .replace('{error}', params.error);
}
