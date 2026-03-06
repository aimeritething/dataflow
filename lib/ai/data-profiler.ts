/**
 * Data Profiler Module
 * 
 * Samples actual database data to discover interesting patterns,
 * distributions, and anomalies for generating better suggestions.
 */

import mysql from 'mysql2/promise';
import { Pool } from 'pg';

export interface DataProfile {
    tableName: string;
    rowCount: number;
    sampleData: Record<string, unknown>[];
    columnStats: Record<string, ColumnStats>;
    insights: DataInsight[];
}

export interface ColumnStats {
    distinctCount: number;
    nullRatio: number;
    minValue?: unknown;
    maxValue?: unknown;
    avgValue?: number;
    topValues?: Array<{ value: string; count: number }>;
    isLowCardinality: boolean;  // Good for GROUP BY
    hasTimePattern: boolean;     // Good for trend analysis
}

export interface DataInsight {
    type: 'trend' | 'distribution' | 'anomaly' | 'ranking' | 'correlation';
    description: string;
    suggestedQuery: string;
    chartType: 'bar' | 'line' | 'pie' | 'table';
    priority: number;
}

export interface ConnectionConfig {
    type: string;
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
}

/**
 * Profile a MySQL table
 */
async function profileMySQLTable(
    connection: mysql.Connection,
    tableName: string,
    columns: Array<{ name: string; type: string }>
): Promise<{ stats: Record<string, ColumnStats>; insights: DataInsight[] }> {
    const stats: Record<string, ColumnStats> = {};
    const insights: DataInsight[] = [];

    // Get row count
    const [countResult] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) as cnt FROM \`${tableName}\``
    );
    const rowCount = countResult[0]?.cnt || 0;

    if (rowCount === 0) {
        return { stats, insights };
    }

    // Analyze each column (limit to first 10 columns for performance)
    for (const col of columns.slice(0, 10)) {
        try {
            const colName = col.name;
            const colType = col.type.toLowerCase();

            // Get distinct count and null ratio
            const [basicStats] = await connection.query<mysql.RowDataPacket[]>(`
        SELECT 
          COUNT(DISTINCT \`${colName}\`) as distinct_cnt,
          SUM(CASE WHEN \`${colName}\` IS NULL THEN 1 ELSE 0 END) as null_cnt
        FROM \`${tableName}\`
      `);

            const distinctCount = basicStats[0]?.distinct_cnt || 0;
            const nullCount = basicStats[0]?.null_cnt || 0;
            const nullRatio = rowCount > 0 ? nullCount / rowCount : 0;
            const isLowCardinality = distinctCount > 0 && distinctCount <= 20 && distinctCount < rowCount * 0.1;

            const columnStat: ColumnStats = {
                distinctCount,
                nullRatio,
                isLowCardinality,
                hasTimePattern: colType.includes('date') || colType.includes('time'),
            };

            // For numeric columns, get min/max/avg
            if (colType.match(/int|decimal|float|double/)) {
                const [numStats] = await connection.query<mysql.RowDataPacket[]>(`
          SELECT MIN(\`${colName}\`) as min_val, MAX(\`${colName}\`) as max_val, AVG(\`${colName}\`) as avg_val
          FROM \`${tableName}\`
        `);
                columnStat.minValue = numStats[0]?.min_val;
                columnStat.maxValue = numStats[0]?.max_val;
                columnStat.avgValue = numStats[0]?.avg_val;

                // Generate ranking insight for numeric columns
                if (distinctCount > 5) {
                    insights.push({
                        type: 'ranking',
                        description: `${colName} 排行分析`,
                        suggestedQuery: `SELECT * FROM \`${tableName}\` ORDER BY \`${colName}\` DESC LIMIT 10`,
                        chartType: 'bar',
                        priority: 2,
                    });
                }
            }

            // For low cardinality columns, get top values (good for pie/bar charts)
            if (isLowCardinality) {
                const [topVals] = await connection.query<mysql.RowDataPacket[]>(`
          SELECT \`${colName}\` as val, COUNT(*) as cnt 
          FROM \`${tableName}\` 
          WHERE \`${colName}\` IS NOT NULL
          GROUP BY \`${colName}\` 
          ORDER BY cnt DESC 
          LIMIT 10
        `);
                columnStat.topValues = topVals.map(r => ({
                    value: String(r.val),
                    count: r.cnt
                }));

                // Generate distribution insight
                insights.push({
                    type: 'distribution',
                    description: `按 ${colName} 分布`,
                    suggestedQuery: `SELECT \`${colName}\`, COUNT(*) as count FROM \`${tableName}\` GROUP BY \`${colName}\` ORDER BY count DESC`,
                    chartType: distinctCount <= 8 ? 'pie' : 'bar',
                    priority: 1,
                });
            }

            // For date/time columns, generate trend insight
            if (columnStat.hasTimePattern) {
                insights.push({
                    type: 'trend',
                    description: `${colName} 时间趋势`,
                    suggestedQuery: `SELECT DATE(\`${colName}\`) as date, COUNT(*) as count FROM \`${tableName}\` GROUP BY DATE(\`${colName}\`) ORDER BY date DESC LIMIT 30`,
                    chartType: 'line',
                    priority: 1,
                });
            }

            stats[colName] = columnStat;
        } catch (e) {
            // Skip column if analysis fails
        }
    }

    return { stats, insights };
}

/**
 * Profile a PostgreSQL table
 */
async function profilePostgresTable(
    pool: Pool,
    tableName: string,
    columns: Array<{ name: string; type: string }>
): Promise<{ stats: Record<string, ColumnStats>; insights: DataInsight[] }> {
    const stats: Record<string, ColumnStats> = {};
    const insights: DataInsight[] = [];

    const countResult = await pool.query(`SELECT COUNT(*) as cnt FROM "${tableName}"`);
    const rowCount = parseInt(countResult.rows[0]?.cnt || '0');

    if (rowCount === 0) {
        return { stats, insights };
    }

    for (const col of columns.slice(0, 10)) {
        try {
            const colName = col.name;
            const colType = col.type.toLowerCase();

            const basicStats = await pool.query(`
        SELECT 
          COUNT(DISTINCT "${colName}") as distinct_cnt,
          SUM(CASE WHEN "${colName}" IS NULL THEN 1 ELSE 0 END) as null_cnt
        FROM "${tableName}"
      `);

            const distinctCount = parseInt(basicStats.rows[0]?.distinct_cnt || '0');
            const nullCount = parseInt(basicStats.rows[0]?.null_cnt || '0');
            const isLowCardinality = distinctCount > 0 && distinctCount <= 20;

            stats[colName] = {
                distinctCount,
                nullRatio: rowCount > 0 ? nullCount / rowCount : 0,
                isLowCardinality,
                hasTimePattern: colType.includes('date') || colType.includes('time'),
            };

            if (isLowCardinality) {
                insights.push({
                    type: 'distribution',
                    description: `按 ${colName} 分布`,
                    suggestedQuery: `SELECT "${colName}", COUNT(*) as count FROM "${tableName}" GROUP BY "${colName}" ORDER BY count DESC`,
                    chartType: distinctCount <= 8 ? 'pie' : 'bar',
                    priority: 1,
                });
            }
        } catch (e) {
            // Skip column if analysis fails
        }
    }

    return { stats, insights };
}

/**
 * Profile database tables and generate data-driven insights
 */
export async function profileDatabaseTables(
    config: ConnectionConfig,
    tables: Array<{ name: string; columns: Array<{ name: string; type: string }> }>
): Promise<{ profiles: DataProfile[]; allInsights: DataInsight[] }> {
    const profiles: DataProfile[] = [];
    const allInsights: DataInsight[] = [];

    if (config.type.toLowerCase() === 'mysql') {
        const connection = await mysql.createConnection({
            host: config.host,
            port: config.port,
            user: config.user,
            password: config.password,
            database: config.database,
        });

        try {
            // Profile up to 5 tables
            for (const table of tables.slice(0, 5)) {
                const { stats, insights } = await profileMySQLTable(connection, table.name, table.columns);

                // Get sample data
                const [sampleRows] = await connection.query<mysql.RowDataPacket[]>(
                    `SELECT * FROM \`${table.name}\` LIMIT 5`
                );

                const [countResult] = await connection.query<mysql.RowDataPacket[]>(
                    `SELECT COUNT(*) as cnt FROM \`${table.name}\``
                );

                profiles.push({
                    tableName: table.name,
                    rowCount: countResult[0]?.cnt || 0,
                    sampleData: sampleRows,
                    columnStats: stats,
                    insights,
                });

                allInsights.push(...insights);
            }
        } finally {
            await connection.end();
        }
    } else if (config.type.toLowerCase() === 'postgresql') {
        const pool = new Pool({
            host: config.host,
            port: config.port,
            user: config.user,
            password: config.password,
            database: config.database,
        });

        try {
            for (const table of tables.slice(0, 5)) {
                const { stats, insights } = await profilePostgresTable(pool, table.name, table.columns);

                const sampleResult = await pool.query(`SELECT * FROM "${table.name}" LIMIT 5`);
                const countResult = await pool.query(`SELECT COUNT(*) as cnt FROM "${table.name}"`);

                profiles.push({
                    tableName: table.name,
                    rowCount: parseInt(countResult.rows[0]?.cnt || '0'),
                    sampleData: sampleResult.rows,
                    columnStats: stats,
                    insights,
                });

                allInsights.push(...insights);
            }
        } finally {
            await pool.end();
        }
    }

    // Deduplicate and sort insights by priority
    const uniqueInsights = allInsights
        .filter((insight, index, self) =>
            self.findIndex(i => i.suggestedQuery === insight.suggestedQuery) === index
        )
        .sort((a, b) => a.priority - b.priority)
        .slice(0, 10);

    return { profiles, allInsights: uniqueInsights };
}
