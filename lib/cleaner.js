const { db, stmts } = require('./db');

const RETENTION_MS = require('../config').retentionDays * 86400000;
const RETENTION_HOURLY_MS = require('../config').retentionHoursAgg * 86400000;

function run() {
  const now = Date.now();
  const cutoffMs = now - RETENTION_MS;
  const cutoffHourlyMs = now - RETENTION_HOURLY_MS;

  // 1. 聚合 1 分钟数据到 1 小时粒度（聚合 2 小时前到 1 小时前的数据）
  const aggEnd = now - 3600000;        // 1 小时前
  const aggStart = aggEnd - 3600000;   // 2 小时前

  stmts.aggregateMetrics.run(aggEnd, aggStart);
  const aggCount = db.changes;
  stmts.deleteAggregated.run(aggEnd, aggStart);
  const delCount = db.changes;

  // 2. 删除过期 1 分钟数据
  stmts.deleteOldMetrics.run(cutoffMs);
  const oldDeleted = db.changes;

  // 3. 删除过期 1 小时聚合数据
  stmts.deleteOldHourly.run(Math.floor(cutoffHourlyMs / 1000));
  const oldHourlyDeleted = db.changes;

  console.log(`[cleaner] aggregated=${aggCount} deleted_1m=${delCount} cleaned_1m=${oldDeleted} cleaned_hourly=${oldHourlyDeleted}`);
}

module.exports = { run };
