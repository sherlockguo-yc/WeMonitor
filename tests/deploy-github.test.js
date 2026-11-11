/**
 * lib/deploy/github.js —— Release 版本号提取
 *
 * 版本号是「本地是否落后」的唯一依据，取错会直接让部署页给出相反的结论：
 * body 不写就判「未发布」，tag 不是 SHA 又会把 movable tag 当版本。
 * 这里用纯函数把这些边界钉死，不必打网络。
 */
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { extractVersion } = require('../lib/deploy/github.js');

describe('extractVersion —— 从 Release 提取版本号', () => {
  it('body 里的 "Auto build <sha>" 优先', () => {
    assert.equal(
      extractVersion({ tag_name: 'v1.2.3', body: 'Auto build 1a2b3c4\n\n其他说明' }),
      '1a2b3c4'
    );
  });

  it('body 为空时回退到 SHA 形态的 tag（WeFood 这类只打 tag 不写 body 的项目）', () => {
    assert.equal(extractVersion({ tag_name: 'ac84af5', body: '' }), 'ac84af5');
    assert.equal(extractVersion({ tag_name: 'ac84af5', body: null }), 'ac84af5');
  });

  it('完整 40 位 SHA 也认', () => {
    const sha = 'ac84af57f29ead4b71e06075c57e47719af76f52';
    assert.equal(extractVersion({ tag_name: sha, body: '' }), sha);
  });

  it('非 SHA 的 tag 不会被当成版本（latest 是 movable tag）', () => {
    assert.equal(extractVersion({ tag_name: 'latest', body: '' }), null);
    assert.equal(extractVersion({ tag_name: 'v1.2.3', body: '常规发版说明' }), null);
    assert.equal(extractVersion({ tag_name: '2026-11-10', body: '' }), null);
  });

  it('过短的十六进制串不认（避免把递增编号当 SHA）', () => {
    assert.equal(extractVersion({ tag_name: '1960003', body: '' }), '1960003'); // 7 位，合法短 SHA 长度
    assert.equal(extractVersion({ tag_name: 'abc12', body: '' }), null); // 5 位，太短
  });

  it('空 release 返回 null', () => {
    assert.equal(extractVersion(null), null);
    assert.equal(extractVersion({}), null);
  });
});
