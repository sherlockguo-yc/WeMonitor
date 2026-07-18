const { stmts } = require('../db');

async function scrape(serviceConfig) {
  const { id, name, scrape_url } = serviceConfig;
  if (!scrape_url) return []; // Push 模式，跳过

  const now = Date.now();

  try {
    const res = await fetch(scrape_url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      console.warn(`[scraper] ${name} scrape failed: HTTP ${res.status}`);
      return [];
    }

    const text = await res.text();
    return parsePrometheusText(text, name, now);
  } catch (err) {
    console.warn(`[scraper] ${name} scrape error: ${err.message}`);
    return [];
  }
}

function parsePrometheusText(text, service, timestamp) {
  const rows = [];
  const lines = text.split('\n');

  for (const line of lines) {
    // 跳过注释和空行
    if (!line || line.startsWith('#')) continue;

    // 格式：metric_name{labels} value [timestamp]
    const match = line.match(/^(\w+)\s*(\{[^}]*\})?\s*([0-9eE.+\-]+)/);
    if (!match) continue;

    const metricName = match[1];
    const labels = match[2] || '{}';
    const value = parseFloat(match[3]);
    if (isNaN(value)) continue;

    rows.push({
      service,
      metric_name: metricName,
      labels,
      value,
      timestamp
    });
  }

  // 批量写入
  if (rows.length > 0) {
    stmts.insertMetrics(rows);
  }

  return rows;
}

async function scrapeAll() {
  const services = stmts.getAllServices.all();
  const results = [];

  for (const svc of services) {
    if (!svc.enabled) continue;
    const rows = await scrape(svc);
    results.push({ service: svc.name, count: rows.length });
  }

  return results;
}

module.exports = { scrapeAll, scrape, parsePrometheusText };
