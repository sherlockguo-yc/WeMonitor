# 部署安全规范

## 规则

部署脚本（SSH 执行、cron 脚本等）中，**禁止在下载完成并校验通过前 `kill` 旧进程或 `rsync --delete` 源目录**。

错误模式：
```bash
# ❌ 危险：kill 在下载失败时服务直接不可用
kill $(lsof -ti:PORT)
curl ... -o file.tar.gz
rsync -a --delete tmp/ target/
```

正确模式：
```bash
# ✅ 安全：下载+校验全部通过后才 kill
curl ... -o file.tar.gz
file file.tar.gz | grep -q gzip  # 校验
kill $(lsof -ti:PORT)
rsync -a --delete tmp/ target/
```

## 背景

WeMonitor 部署过程中多次因「先 kill 再下载」导致下载失败后服务不可用。
