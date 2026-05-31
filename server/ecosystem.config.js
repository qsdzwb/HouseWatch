module.exports = {
  apps: [{
    name: 'bj-realestate',
    script: 'src/index.js',
    cwd: '/opt/bj-server',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      DB_TYPE: 'sqlite',
      DB_SQLITE_PATH: '/opt/bj-server/data/bj_realestate.db',
      LOG_LEVEL: 'info',
      CRAWL_MODE: 'production'
    }
  }]
};
