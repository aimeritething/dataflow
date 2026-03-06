import { NextRequest, NextResponse } from 'next/server';

// SQL关键字列表，用于格式化时大写化
const SQL_KEYWORDS = [
    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'EXISTS',
    'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'FULL', 'CROSS', 'ON',
    'GROUP', 'BY', 'HAVING', 'ORDER', 'ASC', 'DESC', 'LIMIT', 'OFFSET',
    'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
    'CREATE', 'TABLE', 'DROP', 'ALTER', 'ADD', 'COLUMN', 'INDEX',
    'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE', 'DEFAULT',
    'NULL', 'IS', 'AS', 'DISTINCT', 'ALL', 'BETWEEN', 'LIKE', 'ILIKE',
    'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'CAST', 'COALESCE',
    'UNION', 'INTERSECT', 'EXCEPT', 'WITH', 'RECURSIVE',
    'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'CONCAT', 'SUBSTRING',
    'UPPER', 'LOWER', 'TRIM', 'LENGTH', 'NOW', 'CURRENT_DATE', 'CURRENT_TIMESTAMP',
];

// 需要在其前面换行的关键字
const NEWLINE_BEFORE_KEYWORDS = [
    'FROM', 'WHERE', 'AND', 'OR', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN',
    'FULL JOIN', 'CROSS JOIN', 'ON', 'GROUP BY', 'HAVING', 'ORDER BY',
    'LIMIT', 'OFFSET', 'UNION', 'INTERSECT', 'EXCEPT',
];

/**
 * 格式化SQL语句
 */
function formatSQL(sql: string): string {
    if (!sql || typeof sql !== 'string') {
        return sql;
    }

    let formatted = sql.trim();

    // 1. 将多个空白字符替换为单个空格
    formatted = formatted.replace(/\s+/g, ' ');

    // 2. 关键字大写化（使用边界匹配避免替换部分单词）
    SQL_KEYWORDS.forEach((keyword) => {
        const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
        formatted = formatted.replace(regex, keyword);
    });

    // 3. 在特定关键字前添加换行
    NEWLINE_BEFORE_KEYWORDS.forEach((keyword) => {
        // 检查组合关键字如 "INNER JOIN"
        const regex = new RegExp(`\\s+${keyword}\\b`, 'gi');
        formatted = formatted.replace(regex, `\n${keyword}`);
    });

    // 4. 处理逗号后添加空格（如果没有）
    formatted = formatted.replace(/,(?!\s)/g, ', ');

    // 5. 处理括号周围的空格
    formatted = formatted.replace(/\(\s+/g, '(');
    formatted = formatted.replace(/\s+\)/g, ')');

    // 6. 处理运算符周围的空格
    formatted = formatted.replace(/\s*=\s*/g, ' = ');
    formatted = formatted.replace(/\s*<>\s*/g, ' <> ');
    formatted = formatted.replace(/\s*!=\s*/g, ' != ');
    formatted = formatted.replace(/\s*>=\s*/g, ' >= ');
    formatted = formatted.replace(/\s*<=\s*/g, ' <= ');
    formatted = formatted.replace(/\s*>\s*/g, ' > ');
    formatted = formatted.replace(/\s*<\s*/g, ' < ');

    // 7. 添加适当的缩进
    const lines = formatted.split('\n');
    const indentedLines = lines.map((line, index) => {
        const trimmedLine = line.trim();
        // 第一行不缩进，其他行根据关键字添加缩进
        if (index === 0) {
            return trimmedLine;
        }
        // AND/OR 缩进两级
        if (/^(AND|OR)\b/i.test(trimmedLine)) {
            return '    ' + trimmedLine;
        }
        // ON 缩进两级
        if (/^ON\b/i.test(trimmedLine)) {
            return '    ' + trimmedLine;
        }
        // 其他关键字缩进一级
        return '  ' + trimmedLine;
    });

    formatted = indentedLines.join('\n');

    // 8. 清理多余的空行
    formatted = formatted.replace(/\n{3,}/g, '\n\n');

    return formatted;
}

export async function POST(request: NextRequest) {
    try {
        const { sql } = await request.json();

        if (!sql || typeof sql !== 'string') {
            return NextResponse.json(
                { success: false, error: 'SQL content is required' },
                { status: 400 }
            );
        }

        const formattedSql = formatSQL(sql);

        return NextResponse.json({
            success: true,
            formattedSql,
        });
    } catch (error: any) {
        console.error('SQL format error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Failed to format SQL' },
            { status: 500 }
        );
    }
}
