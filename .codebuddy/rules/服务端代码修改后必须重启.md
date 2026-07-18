# 服务端代码修改后必须重启

## 规则

修改 `server/` 目录或 `shared/` 目录（被 server 引用的共享代码）中的**任何文件**后，必须运行 `bash restart.sh` 重启服务，否则代码不会生效。

```bash
cd /Users/sherlockguo/code/WeMonitor && bash restart.sh
```

## 为什么

- 服务端代码需要重启 Node.js 进程才能加载新代码
- restart.sh 自动清理旧进程，不会端口冲突
- 前端代码（public/、views/）不需要重启，刷新页面即可

## 不要忘记

这是项目级约束，每次编辑服务端代码后**自动执行**，不需要用户提醒。
