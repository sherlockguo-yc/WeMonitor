const { db, stmts } = require('./db');
const fs = require('fs');
const path = require('path');
const os = require('os');

const RETENTION_MS = require('../config').retentionDays * 86400000;
const RETENTION_HOURLY_MS = require('../config').retentionHoursAgg * 86400000;

/** 裁剪部署事件文件，只保留最后 N 行 */
function trimEventsFile(filePath, maxLines = 1000) {
  try {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    if (lines.length <= maxLines) return;
    fs.writeFileSync(filePath, lines.slice(-maxLines).join('\n') + '\n');
    console.log(`[cleaner] trimmed ${filePath}: ${lines.length} → ${maxLines} lines`);
  } catch (err) {
    console.error(`[cleaner] trim events error: ${err.message}`);
  }
}

function run() {
  const now = Date.now();
  const cutoffMs = now - RETENTION_MS;
  const cutoffHourlyMs = now - RETENTION_HOURLY_MS;

  // 1. 聚合 1 分钟数据到 1 小时粒度（聚合 2 小时前到 1 小时前的数据）
  // 窗口对齐到整点，避免跨整点边界导致同 hour_ts 在不同 cleaner 调用中重复插入
  const aggEnd = Math.floor((now - 3600000) / 3600000) * 3600000;   // 对齐到整点：1 小时前
  const aggStart = aggEnd - 3600000;                                 // 前一个整点：2 小时前

  const r1 = stmts.aggregateMetrics.run(aggEnd, aggStart);
  const aggCount = r1.changes;
  const r2 = stmts.deleteAggregated.run(aggEnd, aggStart);
  const delCount = r2.changes;

  // 2. 删除过期 1 分钟数据
  const r3 = stmts.deleteOldMetrics.run(cutoffMs);
  const oldDeleted = r3.changes;

  // 3. 删除过期 1 小时聚合数据（hour_ts 是毫秒，不需要除以 1000）
  const r4 = stmts.deleteOldHourly.run(cutoffHourlyMs);
  const oldHourlyDeleted = r4.changes;

  // 4. 裁剪部署事件日志（防止无限增长）
  const HOME = os.homedir();
  trimEventsFile(path.join(HOME, 'wemonitor', 'data', 'deploy-events.jsonl'));
  trimEventsFile(path.join(HOME, 'wemusic', 'data', 'deploy-events.jsonl'));

  console.log(`[cleaner] aggregated=${aggCount} deleted_1m=${delCount} cleaned_1m=${oldDeleted} cleaned_hourly=${oldHourlyDeleted}`);
}

module.exports = { run };
