module.exports = {
  apps: [
    {
      name: 'status-bot',
      script: 'index.js',
      cwd: '/home/ubuntu/status-bot',
      node_args: '--max-old-space-size=200 --expose-gc',
      max_memory_restart: '220M',
      kill_timeout: 8000,
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
