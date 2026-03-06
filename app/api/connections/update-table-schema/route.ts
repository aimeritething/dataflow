import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import { Client } from 'pg';

interface UpdateTableSchemaRequest {
    type: 'mysql' | 'postgres';
    host: string;
    port: string;
    user: string;
    password: string;
    databaseName: string;
    tableName: string;
    schema?: string; // For PostgreSQL
    operation: 'addColumn' | 'modifyColumn' | 'dropColumn' |
    'addIndex' | 'dropIndex' |
    'addForeignKey' | 'dropForeignKey';
    payload: {
        // For columns
        columnName?: string;
        columnType?: string;
        isNullable?: boolean;
        isPrimaryKey?: boolean;
        comment?: string;
        oldColumnName?: string; // For modify/rename

        // For indexes
        indexName?: string;
        indexColumns?: string[];
        indexType?: string;
        isUnique?: boolean;
        indexComment?: string;

        // For foreign keys
        fkName?: string;
        fkColumn?: string;
        referencedTable?: string;
        referencedColumn?: string;
        onDelete?: string;
        onUpdate?: string;
    };
}

export async function POST(request: NextRequest) {
    try {
        const params: UpdateTableSchemaRequest = await request.json();

        console.log('🔵 [API] Received update table schema request:', {
            database: params.databaseName,
            table: params.tableName,
            type: params.type,
            operation: params.operation
        });

        if (!params.type || !params.host || !params.port || !params.user || !params.databaseName || !params.tableName || !params.operation) {
            return NextResponse.json(
                { success: false, error: 'Missing required parameters' },
                { status: 400 }
            );
        }

        let sql = '';
        let result: any;

        if (params.type === 'mysql') {
            const connection = await mysql.createConnection({
                host: params.host,
                port: parseInt(params.port),
                user: params.user,
                password: params.password,
                database: params.databaseName
            });

            try {
                sql = buildMySQLStatement(params);
                console.log('🔵 [API] Executing MySQL:', sql);

                await connection.query(sql);

                result = { success: true, message: `Operation '${params.operation}' completed successfully`, executedSql: sql };
            } catch (error: any) {
                console.error('💥 [API] MySQL error:', error);
                result = { success: false, error: error.message, executedSql: sql };
            } finally {
                await connection.end();
            }
        } else if (params.type === 'postgres') {
            const client = new Client({
                host: params.host,
                port: parseInt(params.port),
                user: params.user,
                password: params.password,
                database: params.databaseName,
            });

            await client.connect();

            try {
                const schema = params.schema || 'public';
                sql = buildPostgreSQLStatement(params, schema);
                console.log('🔵 [API] Executing PostgreSQL:', sql);

                await client.query(sql);

                result = { success: true, message: `Operation '${params.operation}' completed successfully`, executedSql: sql };
            } catch (error: any) {
                console.error('💥 [API] PostgreSQL error:', error);
                result = { success: false, error: error.message, executedSql: sql };
            } finally {
                await client.end();
            }
        } else {
            return NextResponse.json(
                { success: false, error: 'Unsupported database type' },
                { status: 400 }
            );
        }

        console.log('✅ [API] Update table schema result:', result);
        return NextResponse.json(result);

    } catch (error: any) {
        console.error('💥 [API] Update table schema error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Failed to update table schema' },
            { status: 500 }
        );
    }
}

function buildMySQLStatement(params: UpdateTableSchemaRequest): string {
    const { tableName, operation, payload } = params;
    const escTable = `\`${tableName}\``;

    switch (operation) {
        case 'addColumn': {
            const colName = `\`${payload.columnName}\``;
            const colType = payload.columnType || 'VARCHAR(255)';
            const nullClause = payload.isNullable ? 'NULL' : 'NOT NULL';
            const commentClause = payload.comment ? `COMMENT '${payload.comment.replace(/'/g, "''")}'` : '';
            return `ALTER TABLE ${escTable} ADD COLUMN ${colName} ${colType} ${nullClause} ${commentClause}`.trim();
        }
        case 'modifyColumn': {
            const colName = `\`${payload.columnName}\``;
            const colType = payload.columnType || 'VARCHAR(255)';
            const nullClause = payload.isNullable ? 'NULL' : 'NOT NULL';
            const commentClause = payload.comment ? `COMMENT '${payload.comment.replace(/'/g, "''")}'` : '';
            return `ALTER TABLE ${escTable} MODIFY COLUMN ${colName} ${colType} ${nullClause} ${commentClause}`.trim();
        }
        case 'dropColumn': {
            const colName = `\`${payload.columnName}\``;
            return `ALTER TABLE ${escTable} DROP COLUMN ${colName}`;
        }
        case 'addIndex': {
            const idxName = `\`${payload.indexName}\``;
            const columns = payload.indexColumns?.map(c => `\`${c}\``).join(', ') || '';
            const uniqueClause = payload.isUnique ? 'UNIQUE' : '';
            const typeClause = payload.indexType && payload.indexType !== 'BTREE' ? `USING ${payload.indexType}` : '';
            const commentClause = payload.indexComment ? `COMMENT '${payload.indexComment.replace(/'/g, "''")}'` : '';
            return `CREATE ${uniqueClause} INDEX ${idxName} ON ${escTable} (${columns}) ${typeClause} ${commentClause}`.trim().replace(/\s+/g, ' ');
        }
        case 'dropIndex': {
            const idxName = `\`${payload.indexName}\``;
            return `DROP INDEX ${idxName} ON ${escTable}`;
        }
        case 'addForeignKey': {
            const fkName = `\`${payload.fkName}\``;
            const fkCol = `\`${payload.fkColumn}\``;
            const refTable = `\`${payload.referencedTable}\``;
            const refCol = `\`${payload.referencedColumn}\``;
            const onDelete = payload.onDelete || 'RESTRICT';
            const onUpdate = payload.onUpdate || 'RESTRICT';
            return `ALTER TABLE ${escTable} ADD CONSTRAINT ${fkName} FOREIGN KEY (${fkCol}) REFERENCES ${refTable}(${refCol}) ON DELETE ${onDelete} ON UPDATE ${onUpdate}`;
        }
        case 'dropForeignKey': {
            const fkName = `\`${payload.fkName}\``;
            return `ALTER TABLE ${escTable} DROP FOREIGN KEY ${fkName}`;
        }
        default:
            throw new Error(`Unsupported operation: ${operation}`);
    }
}

function buildPostgreSQLStatement(params: UpdateTableSchemaRequest, schema: string): string {
    const { tableName, operation, payload } = params;
    const escTable = `"${schema}"."${tableName}"`;

    switch (operation) {
        case 'addColumn': {
            const colName = `"${payload.columnName}"`;
            const colType = mapToPostgresType(payload.columnType || 'VARCHAR(255)');
            const nullClause = payload.isNullable ? '' : 'NOT NULL';
            // PostgreSQL doesn't support COMMENT in ADD COLUMN, need separate COMMENT ON
            let sql = `ALTER TABLE ${escTable} ADD COLUMN ${colName} ${colType} ${nullClause}`.trim();
            if (payload.comment) {
                sql += `; COMMENT ON COLUMN ${escTable}.${colName} IS '${payload.comment.replace(/'/g, "''")}'`;
            }
            return sql;
        }
        case 'modifyColumn': {
            const colName = `"${payload.columnName}"`;
            const colType = mapToPostgresType(payload.columnType || 'VARCHAR(255)');
            let sql = `ALTER TABLE ${escTable} ALTER COLUMN ${colName} TYPE ${colType}`;
            if (payload.isNullable !== undefined) {
                sql += `; ALTER TABLE ${escTable} ALTER COLUMN ${colName} ${payload.isNullable ? 'DROP NOT NULL' : 'SET NOT NULL'}`;
            }
            if (payload.comment) {
                sql += `; COMMENT ON COLUMN ${escTable}.${colName} IS '${payload.comment.replace(/'/g, "''")}'`;
            }
            return sql;
        }
        case 'dropColumn': {
            const colName = `"${payload.columnName}"`;
            return `ALTER TABLE ${escTable} DROP COLUMN ${colName}`;
        }
        case 'addIndex': {
            const idxName = `"${payload.indexName}"`;
            const columns = payload.indexColumns?.map(c => `"${c}"`).join(', ') || '';
            const uniqueClause = payload.isUnique ? 'UNIQUE' : '';
            // PostgreSQL uses USING for index type (btree, hash, gin, gist)
            const typeClause = payload.indexType ? `USING ${payload.indexType.toLowerCase()}` : '';
            let sql = `CREATE ${uniqueClause} INDEX ${idxName} ON ${escTable} ${typeClause} (${columns})`.trim().replace(/\s+/g, ' ');
            if (payload.indexComment) {
                sql += `; COMMENT ON INDEX "${schema}".${idxName} IS '${payload.indexComment.replace(/'/g, "''")}'`;
            }
            return sql;
        }
        case 'dropIndex': {
            const idxName = `"${schema}"."${payload.indexName}"`;
            return `DROP INDEX ${idxName}`;
        }
        case 'addForeignKey': {
            const fkName = `"${payload.fkName}"`;
            const fkCol = `"${payload.fkColumn}"`;
            const refTable = `"${payload.referencedTable}"`;
            const refCol = `"${payload.referencedColumn}"`;
            const onDelete = payload.onDelete || 'RESTRICT';
            const onUpdate = payload.onUpdate || 'RESTRICT';
            return `ALTER TABLE ${escTable} ADD CONSTRAINT ${fkName} FOREIGN KEY (${fkCol}) REFERENCES ${refTable}(${refCol}) ON DELETE ${onDelete} ON UPDATE ${onUpdate}`;
        }
        case 'dropForeignKey': {
            const fkName = `"${payload.fkName}"`;
            return `ALTER TABLE ${escTable} DROP CONSTRAINT ${fkName}`;
        }
        default:
            throw new Error(`Unsupported operation: ${operation}`);
    }
}

function mapToPostgresType(mysqlType: string): string {
    // Map common MySQL types to PostgreSQL equivalents
    const upperType = mysqlType.toUpperCase();

    if (upperType.startsWith('VARCHAR')) return mysqlType.toLowerCase();
    if (upperType === 'INT') return 'INTEGER';
    if (upperType === 'TINYINT') return 'SMALLINT';
    if (upperType === 'DATETIME') return 'TIMESTAMP';
    if (upperType === 'DOUBLE') return 'DOUBLE PRECISION';
    if (upperType === 'BLOB') return 'BYTEA';
    if (upperType === 'LONGTEXT') return 'TEXT';
    if (upperType === 'MEDIUMTEXT') return 'TEXT';

    return mysqlType.toLowerCase();
}
