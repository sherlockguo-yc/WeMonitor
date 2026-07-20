#!/usr/bin/env node
/**
 * Cron job wrapper — captures stdout/stderr & exit code, writes to history log.
 *
 * Called by cron entries in the format:
 *   node /path/to/cron-runner.js <jobId> <command...>
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const [, , jobId, ...cmdParts] = process.argv;
const cmd = cmdParts.join(' ');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'cron-history.jsonl');
const dir = path.dirname(HISTORY_FILE);

const start = Date.now();
let exitCode = 0;
let output = '';

try {
  output = execSync(cmd, {
    encoding: 'utf8',
    timeout: 600000,       // 10 min max
    maxBuffer: 1024 * 1024, // 1 MB
    env: process.env,
    shell: '/bin/bash',
  });
} catch (e) {
  exitCode = e.status || 1;
  output = (e.stdout || '') + '\n' + (e.stderr || '');
}

const dur = Math.round((Date.now() - start) / 1000);

const entry = {
  jobId,
  ts: Math.floor(start / 1000),
  dur,
  exit: exitCode,
  out: output.slice(0, 4096),
};

// Ensure directory exists (cron may run before WeMonitor starts)
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
fs.appendFileSync(HISTORY_FILE, JSON.stringify(entry) + '\n');

// Also print output so cron sends it via MAILTO / syslog if configured
if (output) process.stdout.write(output);
