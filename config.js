module.exports = {
  // WeMonitor 自身配置
  port: Number(process.env.WEMONITOR_PORT) || 18990,
  apiKey: process.env.WEMONITOR_API_KEY || 'wemonitor-dev-key-change-me',

  // 数据保留
  retentionDays: 7,           // 1 分钟粒度数据保留天数
  retentionHoursAgg: 30,      // 1 小时聚合数据保留天数

  // 采集配置
  systemInterval: 30,         // 系统指标采集间隔（秒）
  healthInterval: 30,         // 健康检查间隔（秒）
  scrapeInterval: 30,         // Pull scrape 间隔（秒）

  // 默认被监控服务
  defaultServices: [
    {
      name: 'WeMusic',
      scrape_url: 'http://127.0.0.1:5174/metrics',
      scrape_interval: 30,
      health_type: 'tcp',
      health_target: '127.0.0.1:5174',
      enabled: true
    }
  ]
};
