/**
 * lib/uiServer.js 路由测试
 *
 * 重点回归：whistle 会把插件前缀去掉后再转给插件的 uiServer，
 * 因此 /plugin.sse-viewer/sse-view.js 到达 uiServer 时是 /sse-view.js（单段路径）。
 * 曾经因为“单段路径当成根 → 回退 index.html”，导致把 HTML 当 JS 返回，
 * 配置页脚本报错、输入框全空（见 test/options-page.test.js 的报错分支）。
 *
 *   node test/ui-server.test.js
 */

const assert = require('assert');
const path = require('path');
const EventEmitter = require('events');

const uiServerPath = path.join(__dirname, '..', 'lib', 'uiServer.js');
delete require.cache[require.resolve(uiServerPath)];
const uiServer = require(uiServerPath);

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ✓ ' + name);
  } catch (err) {
    console.error('  ✗ ' + name);
    console.error('    ' + (err && err.message));
    process.exitCode = 1;
  }
}

function request(url, method) {
  const server = new EventEmitter();
  uiServer(server);
  let status = 0;
  let headers = {};
  let body = '';
  const res = {
    writeHead(code, hdrs) {
      status = code;
      headers = hdrs || {};
    },
    end(chunk) {
      body = chunk == null ? '' : String(chunk);
    }
  };
  server.emit('request', { method: method || 'GET', url }, res);
  return { status, headers, body };
}

console.log('ui-server.test.js');

check('sse-view.js（去掉插件前缀的单段路径）返回 JS，而不是配置页 HTML', () => {
  const r = request('/sse-view.js');
  assert.strictEqual(r.status, 200);
  assert.ok(/javascript/.test(r.headers['Content-Type']), 'Content-Type: ' + r.headers['Content-Type']);
  assert.ok(r.body.indexOf('CONFIG_KEY') !== -1, '应返回 sse-view.js 内容');
  assert.ok(r.body.indexOf('<!DOCTYPE') === -1, '不应返回 HTML');
});

check('/public/sse-view.js 返回 JS', () => {
  const r = request('/plugin.sse-viewer/public/sse-view.js');
  assert.strictEqual(r.status, 200);
  assert.ok(/javascript/.test(r.headers['Content-Type']));
  assert.ok(r.body.indexOf('CONFIG_KEY') !== -1);
});

check('根路径返回配置页', () => {
  ['/', '/plugin.sse-viewer/', '/whistle.sse-viewer/'].forEach((url) => {
    const r = request(url);
    assert.strictEqual(r.status, 200, url);
    assert.ok(/text\/html/.test(r.headers['Content-Type']), url + ' Content-Type: ' + r.headers['Content-Type']);
    assert.ok(r.body.indexOf('whistle.sse-viewer 配置') !== -1, url);
  });
});

check('配置页引用的脚本路径可直接访问（./public/sse-view.js）', () => {
  const r = request('/public/sse-view.js');
  assert.strictEqual(r.status, 200);
  assert.ok(/javascript/.test(r.headers['Content-Type']));
});

check('/api/defaults 返回 JSON（含默认值字段）', () => {
  const r = request('/api/defaults');
  assert.strictEqual(r.status, 200);
  assert.ok(/application\/json/.test(r.headers['Content-Type']));
  const json = JSON.parse(r.body);
  assert.strictEqual(typeof json.previewLimit, 'number');
  assert.strictEqual(typeof json.previewMode, 'string');
  assert.strictEqual(typeof json.trailingSeparator, 'boolean');
  assert.strictEqual(typeof json.formatJson, 'boolean');
});

check('/plugin.sse-viewer/api/defaults 同样返回 JSON', () => {
  const r = request('/plugin.sse-viewer/api/defaults');
  assert.strictEqual(r.status, 200);
  assert.ok(/application\/json/.test(r.headers['Content-Type']));
});

check('Tab 页面可访问', () => {
  const r = request('/public/tab.html');
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.indexOf('sse-ovl-box') !== -1);
});

check('不存在的资源返回 404（不会误回退成配置页）', () => {
  ['/nope.js', '/deep/nested/x.js', '/public/nope.png', '/missing.css', '/x.json'].forEach((url) => {
    const r = request(url);
    assert.strictEqual(r.status, 404, url + ' -> ' + r.status);
  });
});

check('非 GET/HEAD 返回 405', () => {
  const r = request('/api/defaults', 'POST');
  assert.strictEqual(r.status, 405);
});

check('响应头禁止缓存，避免改动后页面不生效', () => {
  const r = request('/');
  assert.ok(/no-store/.test(r.headers['Cache-Control']), r.headers['Cache-Control']);
});

check('路径穿越被拒绝', () => {
  const r = request('/public/../../package.json');
  assert.notStrictEqual(r.status, 200);
});

console.log('\n通过 ' + passed + ' 项' + (process.exitCode ? '（存在失败）' : ''));
