# WeMonitor — UFW 防火墙管理 需求文档

> 创建时间：2026-07-18
> 状态：待确认

## 1. 背景

WeMonitor 部署在 N150 上，需要开放 18990 端口才能访问。首次部署时 UFW 防火墙未放行此端口，导致页面无法打开。手动 `sudo ufw allow` 解决后，考虑到未来还会新增端口（新服务接入），需要把 UFW 管理能力做进 WeMonitor Dashboard 中。

## 2. 功能需求

在 WeMonitor 左侧菜单新增「防火墙」页面，支持：

### 2.1 查看规则

- 表格列出所有 UFW 规则：端口/协议、动作（ALLOW/DENY）、来源、描述
- 显示 UFW 整体状态（active/inactive）

### 2.2 添加规则

- 端口号（必填）
- 协议（TCP / UDP / TCP+UDP，默认 TCP）
- 来源（默认 Anywhere）
- 描述/备注

### 2.3 删除规则

- 每条规则旁有删除按钮，带二次确认

### 2.4 其他

- 显示当前已放行的 WeMonitor 相关端口（18990），以及未来新增的服务端口
- 规则变更后无需重启防火墙（ufw 即时生效）

## 3. 技术方案

### 3.1 后端：执行 sudo ufw 命令

Node.js 通过 `child_process.exec` 调用 ufw 命令：

| 操作 | 命令 |
|------|------|
| 查看状态 | `sudo ufw status verbose` |
| 添加规则 | `sudo ufw allow 8080/tcp` |
| 删除规则 | `sudo ufw delete allow 8080/tcp` |
| 获取编号 | `sudo ufw status numbered`（用于 delete） |

### 3.2 免密 sudo

在 N150 上创建 `/etc/sudoers.d/wemonitor`：

```
sherlockguo ALL=(ALL) NOPASSWD: /usr/sbin/ufw
```

### 3.3 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v1/firewall/status` | 获取 UFW 状态和所有规则 |
| `POST` | `/api/v1/firewall/rules` | 添加规则 `{ port, protocol, comment }` |
| `DELETE` | `/api/v1/firewall/rules/:number` | 按编号删除规则 |

### 3.4 前端

- 左侧菜单新增「防火墙」导航项（🔒 图标）
- 表格 + 新增表单（模态框），风格与其他页面一致

## 4. 需要创建/修改的文件

| # | 文件 | 操作 | 用途 |
|---|------|------|------|
| 1 | `lib/firewall.js` | 新增 | 封装 ufw 命令解析 |
| 2 | `lib/api/firewall.js` | 新增 | API 路由处理 |
| 3 | `views/firewall.ejs` | 新增 | 防火墙管理页面 |
| 4 | `public/js/firewall.js` | 新增 | 页面交互逻辑 |
| 5 | `views/layout.ejs` | 修改 | 新增导航项 |
| 6 | `routes/pages.js` | 修改 | 新增 `/firewall` 路由 |
| 7 | `routes/api.js` | 修改 | 新增 API 路由 |
| 8 | N150 `/etc/sudoers.d/wemonitor` | 新增 | sudo 免密 |

## 5. 依赖项

- N150 需创建 sudoers 文件（部署时通过 SSH 执行一次）
- 无需新增 npm 依赖（使用 Node.js 内置 `child_process`）

## 6. 风险

- **安全风险**：允许 Node.js 进程以 sudo 执行 ufw 存在风险。缓解措施：
  - sudoers 仅允许 `/usr/sbin/ufw`，不开放所有命令
  - API 接口需 API Key 鉴权（与现有 Push 接口一致）
  - WeMonitor 仅监听内网 18990 端口，不暴露到公网

## 7. 后续迭代

- 按服务关联展示端口（标注哪个端口属于哪个服务）
- UFW 日志查看
