// GitHub API 客户端 — 查询 Release 和 Actions 状态，带内存缓存
// 公开仓库无需 scope，token 仅用于提升额度（60 → 5000 req/hr）

const config = require('../../config');

const PER_PAGE = 100;   // GitHub API 最大 per_page，与 deploy-agent.sh 保持一致
const REL_TTL = 60000; // Release 缓存 60s
const CI_TTL = 30000;  // CI 状态缓存 30s

// key -> { data, exp }
const cache = new Map();

function headers() {
  const h = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'WeMonitor',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (config.githubToken) h['Authorization'] = `Bearer ${config.githubToken}`;
  return h;
}

async function ghFetch(url) {
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`GitHub ${res.status} ${res.statusText}`);
  return res.json();
}

// 带 TTL 的缓存包装；请求失败时回退到旧缓存（stale），彻底无缓存则返回 null
async function cached(key, ttl, fn) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.exp > now) return hit.data;
  try {
    const data = await fn();
    cache.set(key, { data, exp: now + ttl });
    return data;
  } catch (err) {
    console.error(`[deploy/github] ${key} error: ${err.message}`);
    if (hit) return hit.data; // stale fallback
    return null;
  }
}

// 查询最新 release（含 prerelease），从 body "Auto build <sha>" 提取版本
// 策略：优先取非 latest tag 的 SHA-tagged release（无 CDN 缓存滞后）；
//       如果没有，fallback 取 latest tag release（兼容只用 latest 模式的项目）。
async function getRelease(repo) {
  return cached(`rel:${repo}`, REL_TTL, async () => {
    // 分页循环拉取全部 release，避免 per_page 截断 + API 非 published_at 默认排序导致漏查最新
    const all = [];
    const MAX_PAGES = 100;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const arr = await ghFetch(
        `https://api.github.com/repos/${repo}/releases?per_page=${PER_PAGE}&page=${page}`
      );
      if (!Array.isArray(arr) || arr.length === 0) break;
      all.push(...arr);
      if (arr.length < PER_PAGE) break; // 最后一页
    }
    if (all.length === 0) {
      return { version: null, tag: null, publishedAt: null, htmlUrl: null };
    }
    // 手动按 published_at 倒序排序取真正最新
    const sorted = all.sort((a, b) =>
      (b.published_at || '').localeCompare(a.published_at || '')
    );
    let latestRelease = null;
    for (const r of sorted) {
      if (r.tag_name === 'latest') {
        if (!latestRelease) latestRelease = r;
        continue; // 跳过 latest tag（优先找 SHA-tagged release）
      }
      const m = (r.body || '').match(/Auto build ([a-f0-9]+)/);
      if (m) {
        return {
          version: m[1],
          tag: r.tag_name,
          publishedAt: r.published_at,
          htmlUrl: r.html_url,
        };
      }
    }
    // fallback：没有非 latest 的 release，取 latest tag release
    if (latestRelease) {
      const m = (latestRelease.body || '').match(/Auto build ([a-f0-9]+)/);
      if (m) {
        return {
          version: m[1],
          tag: latestRelease.tag_name,
          publishedAt: latestRelease.published_at,
          htmlUrl: latestRelease.html_url,
        };
      }
    }
    return { version: null, tag: null, publishedAt: null, htmlUrl: null };
  });
}

// 查询最近一次 Build 工作流运行（跳过 Test/Lint 等非构建 workflow）
async function getCI(repo) {
  return cached(`ci:${repo}`, CI_TTL, async () => {
    const r = await ghFetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=${PER_PAGE}`);
    const runs = r.workflow_runs;
    if (!runs || runs.length === 0) return null;
    // 优先取 Build workflow（构建 + 打包 + 发 Release），
    // 避免被同名 push 触发的 Test workflow 顶替展示
    const run = runs.find(r => r.name === 'Build') || runs[0];
    return {
      name: run.name || 'CI',
      status: run.status,           // queued | in_progress | completed
      conclusion: run.conclusion,   // success | failure | cancelled | ...
      updatedAt: run.updated_at,
      htmlUrl: run.html_url,
      headSha: run.head_sha ? run.head_sha.substring(0, 7) : null,
    };
  });
}

// 聚合远端状态
async function getRemoteState(repo) {
  const [release, ci] = await Promise.all([getRelease(repo), getCI(repo)]);
  return { release, ci };
}

module.exports = { getRemoteState, getRelease, getCI };
