# WeMonitor 需求文档

> 2026-07-18 · N150 小主机服务器监控系统 · **已实现**

---

## 一、项目概述

WeMonitor 是一个轻量级 Node.js 监控系统，运行在 N150 小主机上，监控系统资源、服务健康状态和自定义应用指标，通过 Web Dashboard 可视化展示，支持 UFW 防火墙管理，通过 Cloudflare Tunnel 提供域名访问。

### 核心原则

- 单进程运行，内存占用 < 200MB，无外部组件依赖
- EJS 服务端渲染 + Chart.js CDN + Lucide CDN（defer 加载，不阻塞数据）
- 全自动部署（git push → GitHub Actions → N150 cron → 自动更新）
- 脚本加载顺序：`common.js`（defer，head）→ 页面 JS（defer，body），确保依赖正确

---

## 二、监控能力

### 2.1 系统指标（自动采集）

| 类别 | 指标 | 频率 |
|------|------|------|
| CPU | 使用率 | 30s |
| 内存 | 总量 / 已用 / 使用率 | 30s |
| 磁盘 | 各分区总量 / 已用 / 使用率 | 60s |
| 网络 | 入站 / 出站流量 | 60s |
| 其他 | 系统负载、CPU 温度、运行时间 | 60s |

### 2.2 服务健康检查

- TCP 端口探测（如 `127.0.0.1:5174` = WeMusic）
- 状态：`healthy` / `degraded` / `unhealthy`

### 2.3 应用指标

| 模式 | 触发方 | 接口 |
|------|--------|------|
| **Pull** | WeMonitor → WeMusic | 定时 scrape `GET /metrics`（Prometheus 格式） |
| **Push** | 外部服务 → WeMonitor | `POST /api/v1/metrics`（批量 JSON，API Key 鉴权） |

**Push 数据格式**：
```json
{
  "service": "backup-script",
  "metrics": [
    { "name": "duration_seconds", "value": 42.3, "labels": { "target": "db" } }
  ]
}
```

---

## 三、Web Dashboard

后台管理风格：左侧导航菜单 + 右侧内容区。

| 页面 | 内容 |
|------|------|
| **概览** | 系统资源实时卡片 + 趋势图（支持 1h/6h/24h/7d 切换） + 服务健康状态列表 |
| **系统资源** | CPU / 内存 / 磁盘 / 网络的 1h/6h/24h/7d 趋势图，支持图表切换 |
| **服务状态** | 服务列表 + 健康检查历史（按服务查看，柱状图展示延迟） |
| **服务管理** | 注册/编辑/启用/禁用/删除被监控服务，Toggle Switch 开关 |
| **防火墙** | UFW 规则查看、添加、删除 |

---

## 四、UFW 防火墙管理

### 4.1 功能

- 表格列出所有 UFW 规则（端口、协议、动作、来源）
- 添加规则：端口 + 协议（TCP/UDP/两者）+ 描述
- 删除规则：按编号删除，二次确认

### 4.2 技术实现

- Node.js 通过 `child_process` 执行 `sudo ufw` 命令
- N150 配置 sudoers 免密：`sherlockguo ALL=(ALL) NOPASSWD: /usr/sbin/ufw`

### 4.3 API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v1/firewall/status` | UFW 状态 + 规则列表 |
| `POST` | `/api/v1/firewall/rules` | 添加规则 |
| `DELETE` | `/api/v1/firewall/rules/:number` | 删除规则 |

---

## 五、技术栈

| 层面 | 选型 |
|------|------|
| 运行时 | Node.js 20+ |
| 框架 | Express |
| 数据库 | SQLite（better-sqlite3） |
| 系统指标 | systeminformation |
| 模板引擎 | EJS + express-ejs-layouts |
| 图表 | Chart.js CDN |
| 图标 | Lucide CDN |
| 样式 | 纯 CSS（CSS 变量体系） |

---

## 六、部署架构

### 6.1 自动更新流水线

```
git push master
    ↓
GitHub Actions（ubuntu-latest）
    npm ci → 打包 wemonitor.tar.gz → 发布为 GitHub Release（tag=latest）
    ↓
N150 cron 每分钟运行 ~/wemonitor-update.sh
    查询最新 Release → 比对版本 → 下载（8 次重试应对 GFW）→ 解压 → restart
    ↓
N150 ~/wemonitor/
    ├── server.js / lib/ / routes/ / views/ / public/
    ├── node_modules/（CI 预编译，N150 零编译）
    ├── restart.sh（nohup 启动，端口 18990）
    ├── data/（SQLite，rsync --exclude 保护）
    └── .version
```

### 6.2 网络访问

| 访问方式 | 地址 | 说明 |
|----------|------|------|
| 内网 | `http://192.168.31.102:18990` | N150 内网 IP，UFW 已放行 18990 |
| 公网域名 | `https://wemonitor.sherlockguo.com` | Cloudflare Tunnel → localhost:18990 |

**域名架构**：
```
用户 → https://wemonitor.sherlockguo.com (443)
  → Cloudflare DNS CNAME → 8d17217c-... .cfargotunnel.com
  → CF Tunnel 出站加密隧道
  → N150:18990 (WeMonitor)
```

Tunnel 配置（`/etc/cloudflared/config.yml`）：
```yaml
ingress:
  - hostname: wemusic.sherlockguo.com
    service: http://localhost:80
  - hostname: wemonitor.sherlockguo.com
    service: http://localhost:18990
  - service: http_status:404
```

cloudflared 由 systemd 管理（开机自启），UFW 端口 18990 已放行。

---

## 七、告警（Phase 2 规划）

- 阈值告警（CPU > 80%、磁盘 > 85%、服务不可达）
- 企微机器人通知
- 告警规则管理页面

---

## 八、已完成 vs 后续规划

### Phase 1（已实现）

- [x] 系统指标采集（CPU/内存/磁盘/网络/温度/负载）
- [x] 服务健康检查（TCP 探测）
- [x] Pull + Push 应用指标采集
- [x] Web Dashboard（5 个页面，趋势图支持 1h/6h/24h/7d）
- [x] UFW 防火墙管理
- [x] GitHub Actions 自动构建 + N150 cron 自动部署
- [x] Cloudflare Tunnel 域名访问（`wemonitor.sherlockguo.com`）
- [x] sudo 免密配置（UFW）
- [x] 更新脚本 GFW 重试逻辑（8 次）

### Phase 2（后续）

- [ ] 告警通知（企微机器人）
- [ ] 告警规则管理页面
- [ ] 多租户架构
- [ ] 日志 / 链路追踪
- [ ] 用户认证与权限
- [ ] Grafana 集成
- [ ] 数据导出
