module.exports = {
  apps: [
    {
      name: 'status-bot',
      script: 'index.js',
      cwd: '/home/ubuntu/status-bot',
      max_memory_restart: '150M',
      exp_backoff_restart_delay: 2000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/home/ubuntu/.pm2/logs/status-bot-error.log',
      out_file: '/home/ubuntu/.pm2/logs/status-bot-out.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
