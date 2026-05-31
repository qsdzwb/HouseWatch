require('dotenv').config();

module.exports = {
  // 数据库配置（SQLite 本地开发 / TDSQL 生产）
  db: {
    // SQLite 模式（本地开发用）
    type: process.env.DB_TYPE || 'sqlite', // 'sqlite' | 'mysql'
    sqlitePath: process.env.DB_SQLITE_PATH || './data/bj_realestate.db',

    // MySQL/TDSQL 模式（生产用）
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bj_realestate',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
  },
  crawl: {
    baseUrl: process.env.CRAWL_BASE_URL || 'http://bjjs.zjw.beijing.gov.cn',
    pageUrl: process.env.CRAWL_PAGE_URL || 'http://bjjs.zjw.beijing.gov.cn/eportal/ui',
    chromePath: process.env.CRAWL_CHROME_PATH || null,
    mode: process.env.CRAWL_MODE || 'test',
  },
  logLevel: process.env.LOG_LEVEL || 'info',

  // 样本项目列表（仅 test 模式使用，正常模式从 watched_projects 表读取）
  sampleProjects: [
    { name: '金阙华院', projectID: '8205387' },
    { name: '满和苑', projectID: '8203797' },
    { name: '铂瑞府', projectID: '8207359' },
  ],

  // 状态颜色映射
  statusColors: {
    'rgb(204, 204, 204)': '不可售',
    'rgb(51, 204, 0)': '可售',
    'rgb(255, 204, 153)': '已预订',
    'rgb(255, 0, 0)': '已签约',
    'rgb(255, 255, 0)': '已办理预售项目抵押',
    'rgb(210, 105, 30)': '网上联机备案',
    'rgb(0, 255, 255)': '资格核验中',
  },

  // 状态是否为"已售出"（不可再售）
  isSoldStatus(status) {
    return ['已签约', '网上联机备案', '已办理预售项目抵押'].includes(status);
  },
};
