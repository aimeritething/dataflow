/**
 * SQL Agent Service
 * 
 * Core implementation for text-to-SQL conversion using LLM models.
 * Supports OpenAI, Anthropic, and Ollama providers.
 */

import { getAIConfig, validateAIConfig, type AIConfig } from './config';
import { buildSqlGenerationPrompt, buildRefinementPrompt, formatSchemaForPrompt } from './prompts';

export interface TableSchema {
    name: string;
    columns: Array<{
        name: string;
        type: string;
        nullable?: boolean;
        key?: string;
        isPrimaryKey?: boolean;
    }>;
    rowCount?: number;
}

export interface TextToSQLParams {
    question: string;
    schema: TableSchema[];
    dbType: string;
    dbName: string;
}

export interface TextToSQLResult {
    success: boolean;
    sql?: string;
    explanation?: string;
    error?: string;
}

/**
 * Call OpenAI API
 */
async function callOpenAI(config: AIConfig, prompt: string): Promise<string> {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
            model: config.model,
            messages: [
                {
                    role: 'system',
                    content: 'You are a SQL expert. Always respond with only the SQL query, no explanations or markdown code blocks.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: config.temperature,
            max_tokens: config.maxTokens,
        }),
    });

    if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content?.trim() || '';
}

/**
 * Call Anthropic API
 */
async function callAnthropic(config: AIConfig, prompt: string): Promise<string> {
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
            max_tokens: config.maxTokens,
            messages: [
                {
                    role: 'user',
                    content: prompt
                }
            ],
        }),
    });

    if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Anthropic API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    return data.content[0]?.text?.trim() || '';
}

/**
 * Call Ollama API (local)
 */
async function callOllama(config: AIConfig, prompt: string): Promise<string> {
    const response = await fetch(`${config.baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: config.model,
            prompt: prompt,
            stream: false,
            options: {
                temperature: config.temperature,
                num_predict: config.maxTokens,
            },
        }),
    });

    if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Ollama API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    return data.response?.trim() || '';
}

/**
 * Call the appropriate AI provider
 */
async function callAI(config: AIConfig, prompt: string): Promise<string> {
    switch (config.provider) {
        case 'openai':
            return callOpenAI(config, prompt);
        case 'anthropic':
            return callAnthropic(config, prompt);
        case 'ollama':
            return callOllama(config, prompt);
        default:
            throw new Error(`Unknown AI provider: ${config.provider}`);
    }
}

/**
 * Clean SQL response from AI
 * Extracts valid SQL from potentially mixed text responses
 */
function cleanSqlResponse(response: string): string {
    // Remove markdown code blocks
    let text = response.replace(/```sql\n?/gi, '').replace(/```\n?/g, '');
    text = text.trim();

    // SQL command patterns to look for
    const sqlPatterns = [
        /^(SELECT\s+.+)/im,
        /^(SHOW\s+TABLES\s*.*)$/im,
        /^(SHOW\s+DATABASES\s*.*)$/im,
        /^(SHOW\s+CREATE\s+.+)/im,
        /^(DESCRIBE\s+\w+)/im,
        /^(DESC\s+\w+)/im,
        /^(EXPLAIN\s+.+)/im,
    ];

    // Try to find a SQL command in the response
    for (const pattern of sqlPatterns) {
        const match = text.match(pattern);
        if (match) {
            let sql = match[1].trim();
            // For multi-line SELECT, get everything until we hit explanatory text
            if (sql.toUpperCase().startsWith('SELECT')) {
                // Find where explanatory text might start (Chinese chars or common transition words)
                const lines = text.split('\n');
                const sqlLines: string[] = [];
                let inSql = false;
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!inSql && trimmed.toUpperCase().startsWith('SELECT')) {
                        inSql = true;
                    }
                    if (inSql) {
                        // Stop if we hit explanatory text (Chinese or starts with common words)
                        if (/^[\u4e00-\u9fa5]/.test(trimmed) || /^(这|以上|注意|说明|解释)/i.test(trimmed)) {
                            break;
                        }
                        // Stop if line doesn't look like SQL continuation
                        if (trimmed && !/^(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|GROUP|ORDER|HAVING|LIMIT|OFFSET|AS|,|\(|\)|;)/i.test(trimmed) && sqlLines.length > 0) {
                            // Check if it's part of a value or identifier
                            if (!/^\w+|^\d+|^'.*'|^".*"/.test(trimmed)) {
                                break;
                            }
                        }
                        sqlLines.push(trimmed);
                    }
                }
                sql = sqlLines.join(' ').replace(/\s+/g, ' ').trim();
            }
            // Remove trailing semicolon issues and clean up
            sql = sql.replace(/;+$/, '').trim();
            if (sql) return sql;
        }
    }

    // Fallback: if response looks like pure SQL, use it
    const firstLine = text.split('\n')[0].trim().toUpperCase();
    if (firstLine.startsWith('SELECT') || firstLine.startsWith('SHOW') ||
        firstLine.startsWith('DESCRIBE') || firstLine.startsWith('DESC')) {
        // Take just the first SQL statement
        const lines = text.split('\n');
        const sqlLines: string[] = [];
        for (const line of lines) {
            const trimmed = line.trim();
            // Stop at empty line or explanatory text
            if (!trimmed || /^[\u4e00-\u9fa5]/.test(trimmed)) break;
            sqlLines.push(trimmed);
        }
        return sqlLines.join(' ').replace(/;+$/, '').trim();
    }

    // Last resort: return empty if no valid SQL found
    return '';
}

/**
 * Generate SQL from natural language question
 */
export async function textToSQL(params: TextToSQLParams): Promise<TextToSQLResult> {
    const config = getAIConfig();

    // Validate configuration
    const validation = validateAIConfig(config);
    if (!validation.valid) {
        return {
            success: false,
            error: validation.error,
        };
    }

    try {
        // Format schema for prompt
        const schemaStr = formatSchemaForPrompt(params.schema);

        // Build prompt
        const prompt = buildSqlGenerationPrompt({
            question: params.question,
            schema: schemaStr,
            dbType: params.dbType,
            dbName: params.dbName,
        });

        // Call AI
        const response = await callAI(config, prompt);

        // Clean SQL response
        const sql = cleanSqlResponse(response);

        if (!sql) {
            return {
                success: false,
                error: 'AI returned empty response',
            };
        }

        return {
            success: true,
            sql,
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
    }
}

/**
 * Refine SQL when execution fails
 */
export async function refineSql(params: TextToSQLParams & {
    previousSql: string;
    error: string;
}): Promise<TextToSQLResult> {
    const config = getAIConfig();

    const validation = validateAIConfig(config);
    if (!validation.valid) {
        return {
            success: false,
            error: validation.error,
        };
    }

    try {
        const schemaStr = formatSchemaForPrompt(params.schema);

        const prompt = buildRefinementPrompt({
            question: params.question,
            schema: schemaStr,
            dbType: params.dbType,
            dbName: params.dbName,
            previousSql: params.previousSql,
            error: params.error,
        });

        const response = await callAI(config, prompt);
        const sql = cleanSqlResponse(response);

        if (!sql) {
            return {
                success: false,
                error: 'AI returned empty response during refinement',
            };
        }

        return {
            success: true,
            sql,
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
    }
}
