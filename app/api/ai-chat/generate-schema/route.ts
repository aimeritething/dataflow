/**
 * AI Schema Generation API Endpoint
 * 
 * POST /api/ai-chat/generate-schema
 * 
 * Uses AI to generate a table structure from a natural language description.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAIConfig, validateAIConfig, type AIConfig } from '@/lib/ai/config';

interface RequestBody {
    prompt: string;
    databaseType?: string; // 'mysql', 'postgresql', 'mongodb'
}

interface ColumnDefinition {
    id: string;
    name: string;
    type: string;
    isPrimaryKey: boolean;
    isNullable: boolean;
}

interface GenerateSchemaResult {
    success: boolean;
    tableName?: string;
    columns?: ColumnDefinition[];
    error?: string;
}

/**
 * Call OpenAI API for schema generation
 */
async function callOpenAI(config: AIConfig, systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
            model: config.model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
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
 * Call Anthropic API for schema generation
 */
async function callAnthropic(config: AIConfig, systemPrompt: string, userPrompt: string): Promise<string> {
    const baseUrl = config.baseUrl || 'https://api.anthropic.com';
    const authHeader = config.authToken || config.apiKey;

    const response = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': authHeader || '',
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: config.model,
            max_tokens: config.maxTokens,
            system: systemPrompt,
            messages: [
                { role: 'user', content: userPrompt }
            ],
        }),
    });

    if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Anthropic API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    return data.content?.[0]?.text?.trim() || '';
}

/**
 * Call Ollama API for schema generation
 */
async function callOllama(config: AIConfig, systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await fetch(`${config.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: config.model,
            prompt: `${systemPrompt}\n\nUser: ${userPrompt}`,
            stream: false,
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
 * Generate table schema using AI
 */
async function generateSchema(prompt: string, databaseType: string = 'mysql'): Promise<GenerateSchemaResult> {
    const config = getAIConfig();
    const validation = validateAIConfig(config);

    if (!validation.valid) {
        return { success: false, error: validation.error };
    }

    const systemPrompt = `You are a database schema designer. Based on the user's description, generate a table structure.

IMPORTANT: Respond ONLY with valid JSON in this exact format, no other text:
{
  "tableName": "suggested_table_name",
  "columns": [
    {"name": "column_name", "type": "SQL_TYPE", "isPrimaryKey": true/false, "isNullable": true/false}
  ]
}

Rules:
1. Always include an 'id' column as primary key (INT or SERIAL for PostgreSQL)
2. Use appropriate SQL types for ${databaseType.toUpperCase()}: ${databaseType === 'mysql' ? 'INT, VARCHAR(255), TEXT, BOOLEAN, DATE, DATETIME, DECIMAL(10,2), FLOAT, JSON' : databaseType === 'postgresql' ? 'INTEGER, VARCHAR(255), TEXT, BOOLEAN, DATE, TIMESTAMP, NUMERIC(10,2), REAL, JSONB, SERIAL' : 'String, Number, Boolean, Date, ObjectId'}
3. Primary key columns should NOT be nullable
4. Make sensible choices for NOT NULL vs NULL based on the column purpose
5. Use snake_case for column names
6. Suggest a sensible table name in snake_case`;

    const userPrompt = `Create a table structure for: ${prompt}`;

    let response: string;

    try {
        switch (config.provider) {
            case 'openai':
                response = await callOpenAI(config, systemPrompt, userPrompt);
                break;
            case 'anthropic':
                response = await callAnthropic(config, systemPrompt, userPrompt);
                break;
            case 'ollama':
                response = await callOllama(config, systemPrompt, userPrompt);
                break;
            default:
                return { success: false, error: `Unsupported AI provider: ${config.provider}` };
        }

        // Parse JSON from response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.error('Failed to parse AI response:', response);
            return { success: false, error: 'AI response was not valid JSON' };
        }

        const parsed = JSON.parse(jsonMatch[0]);

        // Add unique IDs to each column
        const columns: ColumnDefinition[] = parsed.columns.map((col: any, index: number) => ({
            id: `ai_${Date.now()}_${index}`,
            name: col.name,
            type: col.type,
            isPrimaryKey: col.isPrimaryKey || false,
            isNullable: col.isNullable !== false, // Default to true if not specified
        }));

        return {
            success: true,
            tableName: parsed.tableName,
            columns,
        };
    } catch (error) {
        console.error('AI Schema Generation error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to generate schema',
        };
    }
}

export async function POST(request: NextRequest) {
    try {
        const body: RequestBody = await request.json();

        const { prompt, databaseType = 'mysql' } = body;

        if (!prompt || !prompt.trim()) {
            return NextResponse.json(
                { success: false, error: 'Prompt is required' },
                { status: 400 }
            );
        }

        const result = await generateSchema(prompt, databaseType);

        if (!result.success) {
            return NextResponse.json(
                { success: false, error: result.error },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            tableName: result.tableName,
            columns: result.columns,
        });

    } catch (error) {
        console.error('Generate Schema API error:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Internal server error'
            },
            { status: 500 }
        );
    }
}
