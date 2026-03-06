
const FETCH_BASE_URL = 'http://localhost:3000';

async function createDashboard(name, description, components) {
    console.log(`Creating dashboard: ${name}...`);
    try {
        // 1. Create Dashboard
        const createRes = await fetch(`${FETCH_BASE_URL}/api/persist/dashboards`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description })
        });
        const createData = await createRes.json();

        if (!createData.success) {
            console.error(`Failed to create dashboard ${name}:`, createData);
            return;
        }

        const id = createData.data.id;
        console.log(`Dashboard created with ID: ${id}`);

        // 2. Add Components
        const updateRes = await fetch(`${FETCH_BASE_URL}/api/persist/dashboards/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                description,
                components
            })
        });

        if (updateRes.ok) {
            console.log(`Successfully added components to ${name}`);
        } else {
            console.error(`Failed to update dashboard ${name}`);
        }

    } catch (e) {
        console.error(`Error processing ${name}:`, e);
    }
}

// Helper to generate IDs
function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

const dashboards = [
    // 1. Retail Dashboard
    {
        name: '零售销售看板 (Retail Sales)',
        description: 'Sales performance, trends, and category analysis',
        components: [
            {
                id: uuid(), type: 'chart', title: '月度销售趋势 (Monthly Trend)',
                layout: { i: uuid(), x: 0, y: 0, w: 8, h: 6 },
                config: {
                    type: 'line',
                    xAxis: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
                    series: [
                        { name: 'Revenue', data: [12000, 13200, 10100, 13400, 9000, 23000, 21000, 25000, 28000, 27000, 31000, 35000] },
                        { name: 'Cost', data: [8000, 8200, 7100, 8400, 6000, 15000, 14000, 16000, 18000, 19000, 21000, 24000], type: 'line', areaStyle: { opacity: 0.1 } }
                    ]
                }
            },
            {
                id: uuid(), type: 'chart', title: '品类占比 (Category Share)',
                layout: { i: uuid(), x: 8, y: 0, w: 4, h: 6 },
                config: {
                    type: 'pie',
                    xAxis: ['Electronics', 'Clothing', 'Home', 'Books', 'Beauty'],
                    series: [{
                        name: 'Sales', type: 'pie', radius: ['40%', '70%'],
                        data: [
                            { value: 45000, name: 'Electronics' },
                            { value: 32000, name: 'Clothing' },
                            { value: 25000, name: 'Home' },
                            { value: 15000, name: 'Books' },
                            { value: 12000, name: 'Beauty' }
                        ]
                    }]
                }
            },
            {
                id: uuid(), type: 'chart', title: '区域销售排行 (Regional Sales)',
                layout: { i: uuid(), x: 0, y: 6, w: 6, h: 6 },
                config: {
                    type: 'bar',
                    xAxis: ['Shanghai', 'Beijing', 'Guangzhou', 'Shenzhen', 'Hangzhou'],
                    series: [{ name: 'Sales', data: [85000, 82000, 78000, 75000, 65000], itemStyle: { color: '#3b82f6' } }]
                }
            },
            {
                id: uuid(), type: 'chart', title: '热销商品 Top 5',
                layout: { i: uuid(), x: 6, y: 6, w: 6, h: 6 },
                config: {
                    type: 'bar', direction: 'horizontal',
                    xAxis: ['iPhone 15', 'Nike Air', 'Dyson V12', 'Kindle', 'Sony WH-1000'],
                    series: [{ name: 'Units', data: [1200, 950, 880, 600, 540] }]
                }
            }
        ]
    },

    // 2. Healthcare Dashboard
    {
        name: '医疗运营看板 (Healthcare Ops)',
        description: 'Patient admissions, department efficiency, and costs',
        components: [
            {
                id: uuid(), type: 'chart', title: '科室接诊量对比 (Dept Visits)',
                layout: { i: uuid(), x: 0, y: 0, w: 6, h: 6 },
                config: {
                    type: 'bar',
                    xAxis: ['Internal Med', 'Surgery', 'Pediatrics', 'ENT', 'Cardiology'],
                    series: [{ name: 'Visits', data: [450, 320, 280, 150, 120] }]
                }
            },
            {
                id: uuid(), type: 'chart', title: '住院患者分布 (Inpatient Dist)',
                layout: { i: uuid(), x: 6, y: 0, w: 6, h: 6 },
                config: {
                    type: 'pie',
                    xAxis: ['General Ward', 'ICU', 'VIP Ward', 'Emergency'],
                    series: [{
                        name: 'Patients', type: 'pie', radius: '60%',
                        data: [
                            { value: 300, name: 'General Ward' },
                            { value: 45, name: 'ICU' },
                            { value: 20, name: 'VIP Ward' },
                            { value: 80, name: 'Emergency' }
                        ]
                    }]
                }
            },
            {
                id: uuid(), type: 'chart', title: '平均住院天数趋势 (Avg LoS)',
                layout: { i: uuid(), x: 0, y: 6, w: 8, h: 6 },
                config: {
                    type: 'line',
                    xAxis: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                    series: [
                        { name: 'Surgery', data: [5.2, 5.0, 4.8, 4.9, 5.1, 5.3, 5.2] },
                        { name: 'Internal Med', data: [3.5, 3.2, 3.0, 3.1, 3.4, 3.6, 3.5] }
                    ]
                }
            },
            {
                id: uuid(), type: 'chart', title: '平均治疗费用 (Avg Cost)',
                layout: { i: uuid(), x: 8, y: 6, w: 4, h: 6 },
                config: {
                    type: 'bar',
                    xAxis: ['Surgery', 'Cardio', 'Neuro', 'Ortho'],
                    series: [{ name: 'Cost ($)', data: [15000, 12000, 11000, 9000] }]
                }
            }
        ]
    },

    // 3. Financial Dashboard
    {
        name: '企业财务看板 (Financial Overview)',
        description: 'Financial health, expenses, and profit margins',
        components: [
            {
                id: uuid(), type: 'chart', title: '收入支出利润流 (Finance Stream)',
                layout: { i: uuid(), x: 0, y: 0, w: 12, h: 6 },
                config: {
                    type: 'line',
                    xAxis: ['Q1', 'Q2', 'Q3', 'Q4'],
                    series: [
                        { name: 'Revenue', data: [100, 120, 140, 160], type: 'bar' },
                        { name: 'Expenses', data: [80, 90, 95, 110], type: 'bar' },
                        { name: 'Net Profit', data: [20, 30, 45, 50], type: 'line', yAxisIndex: 1 }
                    ]
                }
            },
            {
                id: uuid(), type: 'chart', title: '支出构成 (Expense Breakdown)',
                layout: { i: uuid(), x: 0, y: 6, w: 4, h: 6 },
                config: {
                    type: 'pie',
                    xAxis: ['Salaries', 'Rent', 'Marketing', 'R&D', 'Utils'],
                    series: [{
                        name: 'Expenses', type: 'pie', radius: ['40%', '70%'],
                        data: [
                            { value: 45, name: 'Salaries' },
                            { value: 15, name: 'Rent' },
                            { value: 20, name: 'Marketing' },
                            { value: 15, name: 'R&D' },
                            { value: 5, name: 'Utils' }
                        ]
                    }]
                }
            },
            {
                id: uuid(), type: 'chart', title: '现金流趋势 (Cash Flow)',
                layout: { i: uuid(), x: 4, y: 6, w: 8, h: 6 },
                config: {
                    type: 'area',
                    xAxis: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
                    series: [{ name: 'Net Cash Flow', data: [50, 60, 40, 70, 80, 90], areaStyle: {} }]
                }
            }
        ]
    }
];

async function run() {
    for (const dashboard of dashboards) {
        await createDashboard(dashboard.name, dashboard.description, dashboard.components);
    }
    console.log('All demo dashboards created!');
}

run();
