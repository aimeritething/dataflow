-- =============================================
-- 电商 BI 数据库 - 完整 SQL 脚本
-- =============================================

-- 创建数据库
CREATE DATABASE IF NOT EXISTS ecommerce_bi DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ecommerce_bi;

-- =============================================
-- 1. 维度表 (Dimension Tables)
-- =============================================

-- 用户维度表
CREATE TABLE dim_users (
    user_id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL,
    email VARCHAR(100),
    gender ENUM('M', 'F', 'Other'),
    age INT,
    city VARCHAR(50),
    province VARCHAR(50),
    registration_date DATE,
    user_level ENUM('Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 商品维度表
CREATE TABLE dim_products (
    product_id INT PRIMARY KEY AUTO_INCREMENT,
    product_name VARCHAR(200) NOT NULL,
    category VARCHAR(50),
    sub_category VARCHAR(50),
    brand VARCHAR(50),
    cost_price DECIMAL(10, 2),
    selling_price DECIMAL(10, 2),
    stock_quantity INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 时间维度表
CREATE TABLE dim_date (
    date_id INT PRIMARY KEY,
    date DATE NOT NULL,
    year INT,
    quarter INT,
    month INT,
    week INT,
    day INT,
    weekday VARCHAR(10),
    is_weekend BOOLEAN,
    is_holiday BOOLEAN
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 地区维度表
CREATE TABLE dim_regions (
    region_id INT PRIMARY KEY AUTO_INCREMENT,
    province VARCHAR(50),
    city VARCHAR(50),
    district VARCHAR(50),
    region_type ENUM('一线城市', '二线城市', '三线城市', '四线城市')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================
-- 2. 事实表 (Fact Tables)
-- =============================================

-- 订单事实表
CREATE TABLE fact_orders (
    order_id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id INT,
    order_date DATE,
    order_time TIMESTAMP,
    total_amount DECIMAL(12, 2),
    discount_amount DECIMAL(10, 2),
    shipping_fee DECIMAL(8, 2),
    payment_method ENUM('支付宝', '微信', '信用卡', '货到付款'),
    order_status ENUM('待支付', '已支付', '已发货', '已完成', '已取消', '退款中', '已退款'),
    region_id INT,
    FOREIGN KEY (user_id) REFERENCES dim_users(user_id),
    FOREIGN KEY (region_id) REFERENCES dim_regions(region_id),
    INDEX idx_order_date (order_date),
    INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 订单明细事实表
CREATE TABLE fact_order_items (
    order_item_id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_id BIGINT,
    product_id INT,
    quantity INT,
    unit_price DECIMAL(10, 2),
    discount_rate DECIMAL(5, 2),
    subtotal DECIMAL(12, 2),
    FOREIGN KEY (order_id) REFERENCES fact_orders(order_id),
    FOREIGN KEY (product_id) REFERENCES dim_products(product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 流量事实表
CREATE TABLE fact_traffic (
    traffic_id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id INT,
    visit_date DATE,
    visit_time TIMESTAMP,
    page_views INT,
    session_duration INT COMMENT '停留时间(秒)',
    bounce_rate DECIMAL(5, 2),
    traffic_source ENUM('直接访问', '搜索引擎', '社交媒体', '广告', '邮件'),
    device_type ENUM('PC', 'Mobile', 'Tablet'),
    FOREIGN KEY (user_id) REFERENCES dim_users(user_id),
    INDEX idx_visit_date (visit_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================
-- 3. 插入模拟数据
-- =============================================

-- 插入地区数据
INSERT INTO dim_regions (province, city, district, region_type) VALUES
('广东省', '广州市', '天河区', '一线城市'),
('广东省', '深圳市', '南山区', '一线城市'),
('上海市', '上海市', '浦东新区', '一线城市'),
('北京市', '北京市', '朝阳区', '一线城市'),
('浙江省', '杭州市', '西湖区', '二线城市'),
('江苏省', '南京市', '鼓楼区', '二线城市'),
('四川省', '成都市', '武侯区', '二线城市'),
('湖北省', '武汉市', '武昌区', '二线城市'),
('福建省', '厦门市', '思明区', '二线城市'),
('山东省', '青岛市', '市南区', '二线城市');

-- 插入用户数据 (100个用户)
INSERT INTO dim_users (username, email, gender, age, city, province, registration_date, user_level) VALUES
('张伟', 'zhangwei@email.com', 'M', 28, '广州市', '广东省', '2023-01-15', 'Gold'),
('李娜', 'lina@email.com', 'F', 25, '深圳市', '广东省', '2023-02-20', 'Silver'),
('王强', 'wangqiang@email.com', 'M', 32, '上海市', '上海市', '2023-03-10', 'Platinum'),
('刘芳', 'liufang@email.com', 'F', 29, '北京市', '北京市', '2023-01-25', 'Diamond'),
('陈明', 'chenming@email.com', 'M', 35, '杭州市', '浙江省', '2023-04-05', 'Gold'),
('赵丽', 'zhaoli@email.com', 'F', 27, '南京市', '江苏省', '2023-02-15', 'Silver'),
('孙涛', 'suntao@email.com', 'M', 30, '成都市', '四川省', '2023-05-20', 'Bronze'),
('周敏', 'zhoumin@email.com', 'F', 26, '武汉市', '湖北省', '2023-03-30', 'Gold'),
('吴磊', 'wulei@email.com', 'M', 33, '厦门市', '福建省', '2023-06-10', 'Platinum'),
('郑霞', 'zhengxia@email.com', 'F', 24, '青岛市', '山东省', '2023-04-25', 'Silver'),
('黄勇', 'huangyong@email.com', 'M', 31, '广州市', '广东省', '2023-07-15', 'Gold'),
('徐静', 'xujing@email.com', 'F', 28, '深圳市', '广东省', '2023-05-05', 'Diamond'),
('朱杰', 'zhujie@email.com', 'M', 29, '上海市', '上海市', '2023-08-20', 'Platinum'),
('林琳', 'linlin@email.com', 'F', 26, '北京市', '北京市', '2023-06-30', 'Gold'),
('何鹏', 'hepeng@email.com', 'M', 34, '杭州市', '浙江省', '2023-09-10', 'Silver'),
('高梅', 'gaomei@email.com', 'F', 27, '南京市', '江苏省', '2023-07-25', 'Bronze'),
('罗斌', 'luobin@email.com', 'M', 30, '成都市', '四川省', '2023-10-15', 'Gold'),
('宋婷', 'songting@email.com', 'F', 25, '武汉市', '湖北省', '2023-08-05', 'Silver'),
('韩超', 'hanchao@email.com', 'M', 32, '厦门市', '福建省', '2023-11-20', 'Platinum'),
('邓丹', 'dengdan@email.com', 'F', 28, '青岛市', '山东省', '2023-09-30', 'Gold');

-- 插入商品数据 (50个商品)
INSERT INTO dim_products (product_name, category, sub_category, brand, cost_price, selling_price, stock_quantity) VALUES
('iPhone 15 Pro', '电子产品', '手机', 'Apple', 6500.00, 7999.00, 150),
('华为 Mate 60', '电子产品', '手机', '华为', 5000.00, 6499.00, 200),
('小米 14', '电子产品', '手机', '小米', 3000.00, 3999.00, 300),
('MacBook Pro 14', '电子产品', '笔记本', 'Apple', 12000.00, 15999.00, 80),
('ThinkPad X1', '电子产品', '笔记本', '联想', 7000.00, 9999.00, 120),
('AirPods Pro', '电子产品', '耳机', 'Apple', 1200.00, 1999.00, 500),
('索尼 WH-1000XM5', '电子产品', '耳机', '索尼', 1500.00, 2399.00, 200),
('Nike Air Max', '服装鞋帽', '运动鞋', 'Nike', 400.00, 899.00, 400),
('Adidas Ultra Boost', '服装鞋帽', '运动鞋', 'Adidas', 450.00, 999.00, 350),
('优衣库羽绒服', '服装鞋帽', '外套', '优衣库', 300.00, 599.00, 600),
('海澜之家衬衫', '服装鞋帽', '衬衫', '海澜之家', 150.00, 299.00, 800),
('雅诗兰黛面霜', '美妆个护', '护肤', '雅诗兰黛', 400.00, 799.00, 300),
('兰蔻粉底液', '美妆个护', '彩妆', '兰蔻', 300.00, 599.00, 250),
('SK-II神仙水', '美妆个护', '护肤', 'SK-II', 800.00, 1599.00, 150),
('戴森吹风机', '家用电器', '个护电器', '戴森', 1800.00, 2990.00, 100),
('美的空调', '家用电器', '大家电', '美的', 2000.00, 3299.00, 200),
('格力空调', '家用电器', '大家电', '格力', 2200.00, 3599.00, 180),
('海尔冰箱', '家用电器', '大家电', '海尔', 2500.00, 3999.00, 150),
('小米电视 65寸', '家用电器', '电视', '小米', 2000.00, 2999.00, 120),
('索尼电视 75寸', '家用电器', '电视', '索尼', 8000.00, 12999.00, 50);

-- 插入时间维度数据 (2024年全年)
INSERT INTO dim_date (date_id, date, year, quarter, month, week, day, weekday, is_weekend, is_holiday)
SELECT 
    CAST(DATE_FORMAT(date, '%Y%m%d') AS UNSIGNED) as date_id,
    date,
    YEAR(date) as year,
    QUARTER(date) as quarter,
    MONTH(date) as month,
    WEEK(date) as week,
    DAY(date) as day,
    DAYNAME(date) as weekday,
    CASE WHEN DAYOFWEEK(date) IN (1, 7) THEN TRUE ELSE FALSE END as is_weekend,
    CASE 
        WHEN DATE_FORMAT(date, '%m-%d') IN ('01-01', '05-01', '10-01') THEN TRUE
        ELSE FALSE 
    END as is_holiday
FROM (
    SELECT DATE('2024-01-01') + INTERVAL (a.a + (10 * b.a) + (100 * c.a)) DAY as date
    FROM 
        (SELECT 0 AS a UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) AS a
        CROSS JOIN (SELECT 0 AS a UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) AS b
        CROSS JOIN (SELECT 0 AS a UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3) AS c
    WHERE DATE('2024-01-01') + INTERVAL (a.a + (10 * b.a) + (100 * c.a)) DAY <= '2024-12-31'
) dates;

-- 插入订单数据 (500个订单)
INSERT INTO fact_orders (user_id, order_date, order_time, total_amount, discount_amount, shipping_fee, payment_method, order_status, region_id)
SELECT 
    FLOOR(1 + RAND() * 20) as user_id,
    DATE('2024-01-01') + INTERVAL FLOOR(RAND() * 365) DAY as order_date,
    TIMESTAMP(DATE('2024-01-01') + INTERVAL FLOOR(RAND() * 365) DAY, SEC_TO_TIME(FLOOR(RAND() * 86400))) as order_time,
    ROUND(100 + RAND() * 9900, 2) as total_amount,
    ROUND(RAND() * 500, 2) as discount_amount,
    CASE 
        WHEN RAND() > 0.3 THEN 0 
        ELSE ROUND(10 + RAND() * 20, 2) 
    END as shipping_fee,
    ELT(FLOOR(1 + RAND() * 4), '支付宝', '微信', '信用卡', '货到付款') as payment_method,
    ELT(FLOOR(1 + RAND() * 7), '待支付', '已支付', '已发货', '已完成', '已取消', '退款中', '已退款') as order_status,
    FLOOR(1 + RAND() * 10) as region_id
FROM 
    (SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION SELECT 10) t1,
    (SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION SELECT 10) t2,
    (SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5) t3
LIMIT 500;

-- 插入订单明细数据 (每个订单1-3个商品)
INSERT INTO fact_order_items (order_id, product_id, quantity, unit_price, discount_rate, subtotal)
SELECT 
    o.order_id,
    FLOOR(1 + RAND() * 20) as product_id,
    FLOOR(1 + RAND() * 3) as quantity,
    p.selling_price as unit_price,
    ROUND(RAND() * 20, 2) as discount_rate,
    ROUND(p.selling_price * FLOOR(1 + RAND() * 3) * (1 - RAND() * 0.2), 2) as subtotal
FROM 
    fact_orders o
    CROSS JOIN (SELECT 1 UNION SELECT 2 UNION SELECT 3) items
    JOIN dim_products p ON p.product_id = FLOOR(1 + RAND() * 20)
LIMIT 1500;

-- 插入流量数据 (每天100条记录)
INSERT INTO fact_traffic (user_id, visit_date, visit_time, page_views, session_duration, bounce_rate, traffic_source, device_type)
SELECT 
    FLOOR(1 + RAND() * 20) as user_id,
    DATE('2024-01-01') + INTERVAL FLOOR(RAND() * 365) DAY as visit_date,
    TIMESTAMP(DATE('2024-01-01') + INTERVAL FLOOR(RAND() * 365) DAY, SEC_TO_TIME(FLOOR(RAND() * 86400))) as visit_time,
    FLOOR(1 + RAND() * 50) as page_views,
    FLOOR(30 + RAND() * 1800) as session_duration,
    ROUND(RAND() * 80, 2) as bounce_rate,
    ELT(FLOOR(1 + RAND() * 5), '直接访问', '搜索引擎', '社交媒体', '广告', '邮件') as traffic_source,
    ELT(FLOOR(1 + RAND() * 3), 'PC', 'Mobile', 'Tablet') as device_type
FROM 
    (SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION SELECT 10) t1,
    (SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION SELECT 10) t2,
    (SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION SELECT 10) t3
LIMIT 10000;

-- =============================================
-- 4. 常用 BI 分析查询示例
-- =============================================

-- 查询1: 月度销售趋势
SELECT 
    DATE_FORMAT(order_date, '%Y-%m') as month,
    COUNT(DISTINCT order_id) as order_count,
    COUNT(DISTINCT user_id) as customer_count,
    SUM(total_amount) as total_revenue,
    ROUND(AVG(total_amount), 2) as avg_order_value
FROM fact_orders
WHERE order_status IN ('已支付', '已发货', '已完成')
GROUP BY month
ORDER BY month;

-- 查询2: 商品销售排行
SELECT 
    p.product_name,
    p.category,
    p.brand,
    SUM(oi.quantity) as total_sold,
    SUM(oi.subtotal) as total_revenue,
    COUNT(DISTINCT oi.order_id) as order_count
FROM fact_order_items oi
JOIN dim_products p ON oi.product_id = p.product_id
GROUP BY p.product_id, p.product_name, p.category, p.brand
ORDER BY total_revenue DESC
LIMIT 20;

-- 查询3: 用户消费分析
SELECT 
    u.user_id,
    u.username,
    u.user_level,
    u.city,
    COUNT(DISTINCT o.order_id) as order_count,
    SUM(o.total_amount) as total_spent,
    ROUND(AVG(o.total_amount), 2) as avg_order_value,
    MAX(o.order_date) as last_order_date
FROM dim_users u
LEFT JOIN fact_orders o ON u.user_id = o.user_id
WHERE o.order_status IN ('已支付', '已发货', '已完成')
GROUP BY u.user_id, u.username, u.user_level, u.city
ORDER BY total_spent DESC
LIMIT 20;

-- 查询4: 地区销售分布
SELECT 
    r.province,
    r.city,
    r.region_type,
    COUNT(DISTINCT o.order_id) as order_count,
    SUM(o.total_amount) as total_revenue,
    COUNT(DISTINCT o.user_id) as customer_count
FROM fact_orders o
JOIN dim_regions r ON o.region_id = r.region_id
WHERE o.order_status IN ('已支付', '已发货', '已完成')
GROUP BY r.province, r.city, r.region_type
ORDER BY total_revenue DESC;

-- 查询5: 流量来源分析
SELECT 
    traffic_source,
    device_type,
    COUNT(*) as visit_count,
    SUM(page_views) as total_pageviews,
    ROUND(AVG(page_views), 2) as avg_pageviews,
    ROUND(AVG(session_duration), 2) as avg_duration_seconds,
    ROUND(AVG(bounce_rate), 2) as avg_bounce_rate
FROM fact_traffic
GROUP BY traffic_source, device_type
ORDER BY visit_count DESC;

-- =============================================
-- 完成
-- =============================================
SELECT '数据库创建完成！' as status, 
       (SELECT COUNT(*) FROM dim_users) as users,
       (SELECT COUNT(*) FROM dim_products) as products,
       (SELECT COUNT(*) FROM fact_orders) as orders,
       (SELECT COUNT(*) FROM fact_order_items) as order_items,
       (SELECT COUNT(*) FROM fact_traffic) as traffic_records;