# 调用外部 HTTP API 前，必须在终端手动验证返回格式和行为

## 规则

编写任何服务端调用 **外部 HTTP API**（GitHub API、第三方服务等）的代码前，**必须**先在终端用 `curl` 手动调用、确认返回的 JSON 格式和排序行为，再写入代码。

## 流程

1. 用 `curl` 构造与代码完全一致的请求（相同 URL、相同 params、相同 header）
2. 用 `python3 -c "import json,sys; ..."` 或 `jq` 解析关键字段
3. 验证：
   - **默认排序是什么？**（`per_page=1` 返回的第一条是否就是你期望的那条？）
   - **关键字段前 5 条**的值（tag_name、body、published_at 等）是否正确
   - **边界情况**（空结果、多页、token 过期）
4. **用真实 token 验证**（不是 `curl -s` 无鉴权的结果——401/403 时有不同的行为）
5. 以上全部通过后，再写 `fetch` / `ghFetch` 调用

## 禁止

- ❌ 假设 `?per_page=1` 按 `published_at` 排序 → 实际是 `created_at`
- ❌ 假设 API 返回的数组已经是排序好的 → 实际 GitHub releases 不保证
- ❌ 假设 "latest" tag 的 release 不会被 `per_page=1` 返回 → 实际它排在第一位

## 背景

2026-07-19 两次跳进同一个坑：
1. `deploy-agent.sh` 的 `releases?per_page=1` 永远返回 `latest` tag → N150 不更新
2. `lib/deploy/github.js` 同样写法 → 部署页面远端 commitid 永远显示错误

如果在写代码前用 `curl` 手动请求一次 API 看返回结果，两个 bug 都不会发生。
