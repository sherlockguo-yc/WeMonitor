# WeMonitor 接入指南

如何将一个服务纳入 WeMonitor 的部署状态监控和健康检查。

## 一、部署状态监控

### 1. 添加运行目录常量

`lib/deploy/local.js` — 新增服务的运行目录（`~/.version` 文件所在目录）：

```js
const WEDOWNLOAD_DIR = path.join(os.homedir(), 'wedownload');
```

并在 `module.exports` 中导出。

### 2. 注册到 SERVICES 数组

`routes/deploy.js` — 在 `SERVICES` 数组中添加新条目：

```js
const SERVICES = [
  { id: 'wemonitor',  name: 'WeMonitor',  repo: 'sherlockguo-yc/WeMonitor',  dir: local.WEMONITOR_DIR,  port: 18990 },
  { id: 'wemusic',    name: 'WeMusic',    repo: 'sherlockguo-yc/WeMusic',    dir: local.WEMUSIC_DIR,    port: 5174 },
  { id: 'wedownload', name: 'WeDownload', repo: 'sherlockguo-yc/WeDownload', dir: local.WEDOWNLOAD_DIR, port: 8080 },
];
```

各字段含义：

| 字段 | 说明 |
|------|------|
| `id` | 唯一标识，对应 `deploy-projects.conf` 中的项目名 |
| `name` | 显示名称 |
| `repo` | GitHub 仓库 `owner/repo`，用于查询远端 Release 版本 |
| `dir` | 服务在 N150 上的运行目录（含 `.version` 文件） |
| `port` | TCP 端口，用于探测服务是否存活（`lsof -ti` 或 TCP connect） |

### 3. 状态计算逻辑

`computeSummary()` 按以下优先级判断状态：

| 优先级 | 条件 | 状态 |
|--------|------|------|
| 1 | TCP 端口不通 | `stopped` |
| 2 | 最近部署事件 status === `error` | `error` |
| 3 | 最近部署事件 status === `started` | `deploying` |
| 4 | 本地版本 == 远端版本 | `up-to-date` |
| 5 | 本地版本 ≠ 远端版本 | `update-available` |
| 6 | 无法判断 | `unknown` |

## 二、健康监控

### 方式 A：API 动态添加（推荐，无需重启）

```bash
curl -X POST https://wemonitor.sherlockguo.com/api/v1/services \
  -H "Content-Type: application/json" \
  -H "Cookie: <session>" \
  -d '{
    "name": "WeDownload",
    "scrape_url": null,
    "scrape_interval": 30,
    "health_type": "tcp",
    "health_target": "127.0.0.1:8080"
  }'
```

### 方式 B：直接写数据库

```bash
sqlite3 ~/wemonitor/data/wemonitor.db "
  INSERT OR IGNORE INTO services (name, scrape_url, scrape_interval, health_type, health_target, enabled)
  VALUES ('WeDownload', NULL, 30, 'tcp', '127.0.0.1:8080', 1);
"
```

### 方式 C：固化为默认配置

`config.js` — 在 `defaultServices` 中添加，新安装时自动注入数据库：

```js
defaultServices: [
  // ...
  {
    name: 'WeDownload',
    scrape_url: null,          // 无 metrics 端点，设为 null
    scrape_interval: 30,       // 检查间隔（秒）
    health_type: 'tcp',        // 探测方式：tcp
    health_target: '127.0.0.1:8080',  // 目标地址
    enabled: true
  }
]
```

各字段含义：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 服务名称 |
| `scrape_url` | string\|null | Prometheus metrics 端点 URL，无则为 null |
| `scrape_interval` | int | 采集间隔（秒） |
| `health_type` | string | `tcp`：TCP 端口探测；`http`：HTTP 请求 |
| `health_target` | string\|null | 探测目标地址，如 `127.0.0.1:8080` |
| `enabled` | bool | 是否启用监控 |

## 三、N150 端配置

### 1. `deploy-projects.conf`

在 `~/.deploy-projects.conf` 中添加一行：

```
wedownload|sherlockguo-yc/WeDownload|$HOME/wedownload|8080|sha|wedownload.tar.gz
```

格式：`PROJECT|REPO|DIR|PORT|TAG_MODE|FILE_NAME`

- `TAG_MODE: sha` — 按 commit SHA tag 查找 Release（`latest` 则用 latest tag）
- `PORT` 用于健康检查（lsof 检测），WeMonitor 也会用此端口做部署状态的存活探测

### 2. `restart.sh`

服务目录下必须有 `restart.sh`，`deploy-agent.sh` 部署完成后会调用它。WeDownload 的 `restart.sh` 示例：

```bash
#!/bin/bash
set -e
DIR="$HOME/wedownload"
sudo cp "$DIR/config/qbittorrent-nox.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart qbittorrent-nox
```

## 四、接入检查清单

- [ ] `lib/deploy/local.js` — 添加运行目录常量
- [ ] `routes/deploy.js` — SERVICES 数组添加新条目
- [ ] `config.js` — `defaultServices` 添加健康监控配置
- [ ] N150 `~/.deploy-projects.conf` — 添加项目行
- [ ] N150 运行目录 `~/<project>/` — 确保有 `restart.sh`
- [ ] 数据库 — 插入健康监控记录（或等下次 WeMonitor 部署时自动注入）
- [ ] 验证：访问 `https://wemonitor.sherlockguo.com/deploy` 查看部署状态
