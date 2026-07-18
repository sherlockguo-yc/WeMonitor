// GitHub API 客户端 — 查询 Release 和 Actions 状态，带内存缓存
// 公开仓库无需 scope，token 仅用于提升额度（60 → 5000 req/hr）

const config = require('../../config');

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
// 注意：不用 releases/tags/latest —— 该 tag 的下载资源会被 CDN 缓存滞后，
// 导致始终拿到上一版。改用 releases?per_page=30 跳过 latest tag，
// 按 published_at 倒序取第一个 SHA-tagged release。
async function getRelease(repo) {
  return cached(`rel:${repo}`, REL_TTL, async () => {
    const arr = await ghFetch(`https://api.github.com/repos/${repo}/releases?per_page=30`);
    if (!Array.isArray(arr) || arr.length === 0) {
      return { version: null, tag: null, publishedAt: null, htmlUrl: null };
    }
    // GitHub API 默认按 created_at 倒序，不等于 published_at 倒序，
    // 需手动按 published_at 排序取真正的最新
    const sorted = arr.slice().sort((a, b) =>
      (b.published_at || '').localeCompare(a.published_at || '')
    );
    for (const r of sorted) {
      if (r.tag_name === 'latest') continue; // 跳过旧 latest tag release
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
    return { version: null, tag: null, publishedAt: null, htmlUrl: null };
  });
}

// 查询最近一次 Actions 运行
async function getCI(repo) {
  return cached(`ci:${repo}`, CI_TTL, async () => {
    const r = await ghFetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=1`);
    const run = r.workflow_runs && r.workflow_runs[0];
    if (!run) return null;
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
