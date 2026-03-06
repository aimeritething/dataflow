import mysql from 'mysql2/promise';

// Base connection config (without database for initialization)
const baseConfig = {
    host: 'dbconn.sealosbja.site',
    port: 34868,
    user: 'root',
    password: 'hqcgq9rm',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
};

// Connection pool for the persistence database
const pool = mysql.createPool({
    ...baseConfig,
    database: 'dataflow'
});

export default pool;

// Helper function to execute queries
export async function query<T = any>(sql: string, params?: any[]): Promise<T> {
    // Use query() instead of execute() for better compatibility with string params
    const [rows] = await pool.query(sql, params);
    return rows as T;
}

// Initialize database tables
export async function initializeDatabase(): Promise<void> {
    // First, connect without specifying database to create it
    const initPool = mysql.createPool(baseConfig);
    const connection = await initPool.getConnection();

    try {
        // Create database if not exists (use query instead of execute for DDL)
        await connection.query(`CREATE DATABASE IF NOT EXISTS dataflow`);
        await connection.query(`USE dataflow`);

        // 1. Database connections table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS db_connections (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                type ENUM('MYSQL', 'POSTGRES', 'MONGODB', 'REDIS') NOT NULL,
                host VARCHAR(255) NOT NULL,
                port VARCHAR(10) NOT NULL,
                user VARCHAR(100) NOT NULL,
                password VARCHAR(255) NOT NULL,
                database_name VARCHAR(100),
                is_default BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        // 2. Dashboards table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS dashboards (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(200) NOT NULL,
                description TEXT,
                thumbnail TEXT,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL
            )
        `);

        // 3. Dashboard components table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS dashboard_components (
                id VARCHAR(36) PRIMARY KEY,
                dashboard_id VARCHAR(36) NOT NULL,
                type VARCHAR(50) NOT NULL,
                title VARCHAR(200),
                description TEXT,
                layout_x INT DEFAULT 0,
                layout_y INT DEFAULT 0,
                layout_w INT DEFAULT 4,
                layout_h INT DEFAULT 4,
                data JSON,
                config JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE
            )
        `);

        // 4. Chat conversations table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS chat_conversations (
                id VARCHAR(36) PRIMARY KEY,
                title VARCHAR(200) NOT NULL,
                timestamp BIGINT NOT NULL,
                chart_count INT DEFAULT 0,
                datasource_id VARCHAR(36),
                datasource_name VARCHAR(100),
                datasource_type VARCHAR(20),
                datasource_database VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        // 5. Chat messages table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id VARCHAR(36) PRIMARY KEY,
                conversation_id VARCHAR(36) NOT NULL,
                role ENUM('user', 'assistant') NOT NULL,
                content TEXT NOT NULL,
                timestamp BIGINT NOT NULL,
                chart_data JSON,
                FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
            )
        `);

        console.log('[DB] All tables initialized successfully');
    } finally {
        connection.release();
        await initPool.end();
    }
}
