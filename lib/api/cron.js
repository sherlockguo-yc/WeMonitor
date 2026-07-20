const cron = require('../cron');

// GET /api/v1/cron/jobs
async function listJobs(req, res) {
  try {
    const jobs = await cron.listJobs();
    const sync = await cron.getSyncStatus(await cron.loadJobs());
    res.json({ jobs, sync });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/v1/cron/jobs
async function createJob(req, res) {
  const { name, schedule, command, enabled } = req.body;
  if (!schedule || !command) {
    return res.status(400).json({ error: 'schedule 和 command 为必填项' });
  }
  const validation = cron.validateSchedule(schedule);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }
  try {
    const job = await cron.createJob({ name, schedule, command, enabled });
    res.json({ job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// PUT /api/v1/cron/jobs/:id
async function updateJob(req, res) {
  const { id } = req.params;
  const { name, schedule, command, enabled } = req.body;
  if (schedule !== undefined) {
    const validation = cron.validateSchedule(schedule);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
  }
  try {
    const job = await cron.updateJob(id, { name, schedule, command, enabled });
    if (!job) return res.status(404).json({ error: '任务不存在' });
    res.json({ job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// DELETE /api/v1/cron/jobs/:id
async function deleteJob(req, res) {
  const { id } = req.params;
  try {
    const ok = await cron.deleteJob(id);
    if (!ok) return res.status(404).json({ error: '任务不存在' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/v1/cron/jobs/:id/toggle
async function toggleJob(req, res) {
  const { id } = req.params;
  try {
    const job = await cron.toggleJob(id);
    if (!job) return res.status(404).json({ error: '任务不存在' });
    res.json({ job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/v1/cron/jobs/:id/history?limit=50
async function getHistory(req, res) {
  const { id } = req.params;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  try {
    const history = cron.getHistory(id, limit);
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/v1/cron/sync — 强制同步到 crontab
async function forceSync(req, res) {
  try {
    const jobs = cron.loadJobs();
    await cron.syncToSystem(jobs);
    const sync = await cron.getSyncStatus(jobs);
    res.json({ synced: true, sync });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/v1/cron/sync-status
async function syncStatus(req, res) {
  try {
    const jobs = cron.loadJobs();
    const status = await cron.getSyncStatus(jobs);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listJobs, createJob, updateJob, deleteJob, toggleJob, getHistory, forceSync, syncStatus };
