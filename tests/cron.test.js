/**
 * lib/cron.js 单元测试 —— crontab 的生成、解析与「不破坏用户手写内容」
 *
 * 这是 WeMonitor 里唯一会重写系统 crontab 的代码，也是唯一能损坏服务器配置的代码：
 * 生成时少写一段、解析时吞掉标记块之外的手写条目，用户都不会立刻察觉 ——
 * 直到某天发现「我的备份任务怎么不跑了」。
 *
 * 所以这里测的不是「代码能跑」，而是「用户的东西一个字都没被弄丢」。
 */
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  extractNonWmLines,
  generateCrontab,
  parseCrontab,
  validateSchedule,
} = require('../lib/cron.js');

const MARKER_BEGIN = '# === WeMonitor BEGIN ===';
const MARKER_END = '# === WeMonitor END ===';

const job = (over = {}) => ({
  id: 'abc1234567',
  name: '测试任务',
  schedule: '*/5 * * * *',
  command: '/bin/echo hi',
  enabled: true,
  ...over,
});

describe('generateCrontab', () => {
  it('输出被 BEGIN/END 标记包裹，且带回 id 与 name 元信息', () => {
    const out = generateCrontab([job()]);
    assert.ok(out.startsWith(MARKER_BEGIN));
    assert.ok(out.trimEnd().endsWith(MARKER_END));
    assert.ok(out.includes('# id: abc1234567 | name: 测试任务'));
  });

  it('条目把用户命令交给 cron-runner 包装（否则不会记录运行历史）', () => {
    const out = generateCrontab([job()]);
    const line = out.split('\n').find((l) => l.startsWith('*/5 * * * *'));
    assert.ok(line, '应有一行以调度表达式开头');
    assert.ok(line.includes('cron-runner.js'), '必须经过 cron-runner.js');
    assert.ok(line.includes('abc1234567'), '必须带上 jobId');
    assert.ok(line.endsWith('/bin/echo hi'), '用户命令应在末尾原样保留');
  });

  it('禁用的任务写成注释行并加 DISABLED 前缀', () => {
    const out = generateCrontab([job({ enabled: false })]);
    assert.ok(out.includes('# DISABLED: */5 * * * *'));
  });

  it('没有任务时写出空标记块而不是空字符串', () => {
    assert.equal(generateCrontab([]), `${MARKER_BEGIN}\n# No jobs configured\n${MARKER_END}\n`);
  });
});

describe('parseCrontab', () => {
  it('生成 → 解析可无损往返（jobs.json 丢失时可从 crontab 重建）', () => {
    const jobs = [
      job({ id: 'aaaa111111', name: '备份任务', schedule: '0 3 * * *', command: '/bin/bash /backup.sh' }),
      job({ id: 'bbbb222222', name: '带 # 井号的名字', command: '/bin/echo hi' }),
    ];
    const entries = parseCrontab(generateCrontab(jobs));

    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((e) => e.id), ['aaaa111111', 'bbbb222222']);
    assert.deepEqual(entries.map((e) => e.name), ['备份任务', '带 # 井号的名字']);
    assert.deepEqual(entries.map((e) => e.schedule), ['0 3 * * *', '*/5 * * * *']);
    assert.deepEqual(entries.map((e) => e.command), ['/bin/bash /backup.sh', '/bin/echo hi']);
    assert.ok(entries.every((e) => e.isWeMonitor), '应识别为自己托管的条目');
    assert.ok(entries.every((e) => e.enabled));
  });

  it('禁用的条目解析回 enabled=false', () => {
    const [entry] = parseCrontab(generateCrontab([job({ enabled: false })]));
    assert.equal(entry.enabled, false);
    assert.equal(entry.id, 'abc1234567');
  });

  it('解析用户手写条目：上方注释作为任务名', () => {
    const [entry] = parseCrontab('# 我的备份\n0 3 * * * /bin/bash /backup.sh');
    assert.equal(entry.name, '我的备份');
    assert.equal(entry.command, '/bin/bash /backup.sh');
    assert.equal(entry.schedule, '0 3 * * *');
    assert.equal(entry.enabled, true);
    assert.equal(entry.isWeMonitor, false, '未经包装的不是自己托管的');
  });

  it('用户手写条目没有注释时，用命令串兜底作名（不产生空名）', () => {
    const [entry] = parseCrontab('*/10 * * * * /bin/ping -c 1 1.1.1.1');
    assert.equal(entry.name, '/bin/ping -c 1 1.1.1.1');
  });

  it('忽略环境变量行与标记行自身', () => {
    const text = [
      'PATH=/usr/bin:/bin',
      'SHELL=/bin/bash',
      MARKER_BEGIN,
      '*/5 * * * * /bin/echo hi',
      MARKER_END,
    ].join('\n');
    const entries = parseCrontab(text);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].command, '/bin/echo hi');
  });

  it('两个手写条目之间的注释不会串到下一个条目上', () => {
    const text = ['# 第一条', '0 1 * * * /bin/first', '', '*/5 * * * * /bin/second'].join('\n');
    const entries = parseCrontab(text);
    assert.equal(entries[0].name, '第一条');
    assert.notEqual(entries[1].name, '第一条');
  });
});

describe('extractNonWmLines（保住用户手写内容的最后一道防线）', () => {
  const mixed = [
    '# 我的备份',
    '0 3 * * * /bin/bash /backup.sh',
    MARKER_BEGIN,
    '*/5 * * * * node runner x',
    MARKER_END,
    '# 尾巴注释',
    '0 4 * * * /bin/other.sh',
  ].join('\n');

  it('标记块之前与之后的手写内容全部保留', () => {
    const kept = extractNonWmLines(mixed);
    assert.ok(kept.includes('/backup.sh'), '块前内容不能丢');
    assert.ok(kept.includes('# 尾巴注释'), '块后注释不能丢');
    assert.ok(kept.includes('/bin/other.sh'), '块后内容不能丢');
  });

  it('标记块内部的内容被剔除（即将被重新生成）', () => {
    const kept = extractNonWmLines(mixed);
    assert.ok(!kept.includes('runner x'));
    assert.ok(!kept.includes(MARKER_BEGIN));
    assert.ok(!kept.includes(MARKER_END));
  });

  it('没有标记块时整体返回（首次接入的机器上不应该丢任何东西）', () => {
    const plain = '0 3 * * * /bin/bash /backup.sh';
    assert.equal(extractNonWmLines(plain), plain);
  });
});

describe('validateSchedule', () => {
  it('接受常见写法', () => {
    for (const s of ['* * * * *', '*/5 9 * * *', '0 3 * * *', '0 0 1 * *', '15,45 * * * *', '0 9-18 * * 1-5']) {
      assert.equal(validateSchedule(s).valid, true, `应接受 ${s}`);
    }
  });

  it('拒绝字段数不是 5 的表达式', () => {
    for (const s of ['* * * *', '* * * * * *', '', '   ']) {
      assert.equal(validateSchedule(s).valid, false, `应拒绝 ${JSON.stringify(s)}`);
    }
  });

  it('拒绝越界的数值', () => {
    assert.equal(validateSchedule('60 * * * *').valid, false, '分 0-59');
    assert.equal(validateSchedule('* 24 * * *').valid, false, '时 0-23');
    assert.equal(validateSchedule('* * 0 * *').valid, false, '日 1-31');
    assert.equal(validateSchedule('* * * 13 *').valid, false, '月 1-12');
    assert.equal(validateSchedule('* * * * 8').valid, false, '周 0-7');
  });

  it('拒绝无法识别的格式与零步长', () => {
    assert.equal(validateSchedule('a * * * *').valid, false);
    assert.equal(validateSchedule('*/0 * * * *').valid, false);
    assert.equal(validateSchedule('1- * * * *').valid, false);
  });
});
