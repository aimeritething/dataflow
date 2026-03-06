/**
 * AI Data Generator Module
 * 
 * Generates test data using AI based on table schema and user instructions.
 * Supports OpenAI, Anthropic, and Ollama providers.
 */

import { getAIConfig, validateAIConfig, type AIConfig } from './config';

export interface ColumnInfo {
    name: string;
    type: string;
    nullable?: boolean;
    isAutoIncrement?: boolean;
}

export interface GenerateDataParams {
    columns: ColumnInfo[];
    rowCount: number;
    aiInstructions: string;
    tableName: string;
    databaseType: string;
}

export interface GenerateDataResult {
    success: boolean;
    data?: Record<string, any>[];
    error?: string;
}

/**
 * Build prompt for AI test data generation
 */
function buildDataGenerationPrompt(params: GenerateDataParams): string {
    const { columns, rowCount, aiInstructions, tableName, databaseType } = params;

    // Filter out auto-increment columns
    const insertableColumns = columns.filter(col => !col.isAutoIncrement);

    const schemaDescription = insertableColumns.map(col =>
        `  - ${col.name} (${col.type}${col.nullable ? ', nullable' : ''})`
    ).join('\n');

    // Limit batch size for AI to handle
    const batchSize = Math.min(rowCount, 100);

    return `你是一个测试数据生成专家。请根据以下表结构和用户要求，生成 ${batchSize} 条测试数据。

## 表信息
- 表名: ${tableName}
- 数据库类型: ${databaseType}

## 表字段
${schemaDescription}

## 用户要求
${aiInstructions}

## 输出要求
1. 严格按照 JSON 数组格式输出
2. 每个对象包含所有字段
3. 数据类型要与字段类型匹配
4. 生成的数据要符合用户的描述要求
5. 只输出 JSON 数组，不要添加任何解释或 markdown 标记

## 输出格式示例
[
  {"field1": "value1", "field2": 123},
  {"field1": "value2", "field2": 456}
]

请生成 ${batchSize} 条数据：`;
}

/**
 * Call OpenAI API for data generation
 */
async function callOpenAIForData(config: AIConfig, prompt: string): Promise<string> {
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
                    content: 'You are a test data generator. Always respond with only valid JSON array, no explanations or markdown code blocks.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.7, // Higher temperature for more varied data
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
 * Call Anthropic API for data generation
 */
async function callAnthropicForData(config: AIConfig, prompt: string): Promise<string> {
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
 * Call Ollama API for data generation
 */
async function callOllamaForData(config: AIConfig, prompt: string): Promise<string> {
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
                temperature: 0.7,
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
 * Call the appropriate AI provider for data generation
 */
async function callAIForData(config: AIConfig, prompt: string): Promise<string> {
    switch (config.provider) {
        case 'openai':
            return callOpenAIForData(config, prompt);
        case 'anthropic':
            return callAnthropicForData(config, prompt);
        case 'ollama':
            return callOllamaForData(config, prompt);
        default:
            throw new Error(`Unknown AI provider: ${config.provider}`);
    }
}

/**
 * Clean and parse AI response as JSON array
 */
function parseAIResponse(response: string): Record<string, any>[] {
    // Remove markdown code blocks if present
    let text = response.replace(/```json\n?/gi, '').replace(/```\n?/g, '');
    text = text.trim();

    // Try to find JSON array in the response
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (!arrayMatch) {
        throw new Error('AI response does not contain a valid JSON array');
    }

    const jsonStr = arrayMatch[0];

    try {
        const data = JSON.parse(jsonStr);
        if (!Array.isArray(data)) {
            throw new Error('Parsed data is not an array');
        }
        return data;
    } catch (e) {
        throw new Error(`Failed to parse AI response as JSON: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
}

/**
 * Generate test data using AI
 * Returns array of row objects with field values
 */
export async function generateTestDataWithAI(params: GenerateDataParams): Promise<GenerateDataResult> {
    console.log('[AI Data Generator] 🚀 Starting AI-powered data generation');
    console.log('[AI Data Generator] 📋 Columns:', params.columns.filter(c => !c.isAutoIncrement).map(c => c.name));
    console.log('[AI Data Generator] 📝 Instructions:', params.aiInstructions);

    const config = getAIConfig();

    // Validate configuration
    const validation = validateAIConfig(config);
    if (!validation.valid) {
        console.error('[AI Data Generator] ❌ AI not configured:', validation.error);
        return {
            success: false,
            error: validation.error,
        };
    }

    console.log('[AI Data Generator] 🔧 Using provider:', config.provider, 'model:', config.model);

    try {
        const allData: Record<string, any>[] = [];
        const batchSize = 100; // AI generates 100 rows per call
        const totalBatches = Math.ceil(params.rowCount / batchSize);

        console.log(`[AI Data Generator] 📊 Will generate ${params.rowCount} rows in ${totalBatches} batches`);

        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
            const remainingRows = params.rowCount - allData.length;
            const currentBatchSize = Math.min(batchSize, remainingRows);

            console.log(`[AI Data Generator] 🔄 Generating batch ${batchIndex + 1}/${totalBatches} (${currentBatchSize} rows)`);

            // Build prompt for this batch
            const prompt = buildDataGenerationPrompt({
                ...params,
                rowCount: currentBatchSize,
            });

            // Call AI
            const response = await callAIForData(config, prompt);
            console.log('[AI Data Generator] 📥 AI response length:', response.length);

            // Parse response
            const batchData = parseAIResponse(response);
            console.log(`[AI Data Generator] ✅ Parsed ${batchData.length} rows from AI response`);

            allData.push(...batchData);

            // Small delay between batches to avoid rate limiting
            if (batchIndex < totalBatches - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        console.log(`[AI Data Generator] 🎉 Total generated: ${allData.length} rows`);

        return {
            success: true,
            data: allData.slice(0, params.rowCount), // Ensure exact count
        };

    } catch (error) {
        console.error('[AI Data Generator] ❌ Error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
    }
}
