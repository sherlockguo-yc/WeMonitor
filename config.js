module.exports = {
  // WeMonitor 自身配置
  port: Number(process.env.WEMONITOR_PORT) || 18990,
  apiKey: process.env.WEMONITOR_API_KEY || 'wemonitor-dev-key-change-me',

  // GitHub API（用于部署监控：Release + Actions 状态查询）
  // 公开仓库不需要 scope，仅用于提升 API 额度（60→5000 req/hr）
  // 创建: GitHub → Settings → Developer settings → Personal access tokens → Generate
  githubToken: process.env.GITHUB_TOKEN || '',

  // 数据保留
  retentionDays: 7,           // 1 分钟粒度数据保留天数
  retentionHoursAgg: 30,      // 1 小时聚合数据保留天数

  // 采集配置
  systemInterval: 30,         // 系统指标采集间隔（秒）
  healthInterval: 30,         // 健康检查间隔（秒）
  scrapeInterval: 30,         // Pull scrape 间隔（秒）

  // Cloudflare Tunnel
  tunnelName: 'WeCloudflareTunnel',

  // 默认被监控服务
  defaultServices: [
    {
      name: 'WeMusic',
      scrape_url: 'http://127.0.0.1:5174/metrics',
      scrape_interval: 30,
      health_type: 'tcp',
      health_target: '127.0.0.1:5174',
      enabled: true
    },
    {
      name: 'WeDownload',
      scrape_url: null,
      scrape_interval: 30,
      health_type: 'tcp',
      health_target: '127.0.0.1:8080',
      enabled: true
    },
    {
      name: 'QuizApp',
      scrape_url: null,
      scrape_interval: 30,
      health_type: 'tcp',
      health_target: '127.0.0.1:9200',
      enabled: true
    },
    {
      // WeAuto 自 2026-10-14 起是常驻服务（自带网站与调度器），因此可以被探测。
      // 此前它是无端口 CLI，只能靠读它的 runs.jsonl 间接判断，那正是后来
      // 「永远显示存活」这个假健康信号的根源。
      // scrape_url 留空：WeAuto 提供 /healthz（JSON），不提供 Prometheus 指标，
      // 健康检查与其他服务一样走 tcp 探测。
      name: 'WeAuto',
      scrape_url: null,
      scrape_interval: 30,
      health_type: 'tcp',
      health_target: '127.0.0.1:18991',
      enabled: true
    }
  ]
};
