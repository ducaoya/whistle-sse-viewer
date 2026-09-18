/**
 * sse-view.js 纯逻辑单测（无依赖，直接 node 运行）
 *   node test/sse-view.test.js
 */

const assert = require('assert');
const path = require('path');
const SseView = require(path.join(__dirname, '..', 'public', 'sse-view.js'));

let passed = 0;
function test(name, fn) {
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

const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
const frame = (text) => ({ frameId: '1-1', isClient: false, length: text.length, base64: b64(text) });

console.log('sse-view.test.js');

test('isSseSession: whistle 的 isSse 标记', () => {
  assert.strictEqual(SseView.isSseSession({ isSse: true }), true);
});

test('isSseSession: content-type 带 charset 也算 SSE', () => {
  const session = { res: { headers: { 'content-type': 'text/event-stream; charset=utf-8' } } };
  assert.strictEqual(SseView.isSseSession(session), true);
});

test('isSseSession: content-type 大小写不敏感', () => {
  const session = { res: { headers: { 'Content-Type': 'TEXT/EVENT-STREAM' } } };
  assert.strictEqual(SseView.isSseSession(session), true);
});

test('isSseSession: 普通 JSON 响应为 false', () => {
  const session = { res: { headers: { 'content-type': 'application/json; charset=utf-8' } } };
  assert.strictEqual(SseView.isSseSession(session), false);
});

test('isSseSession: 空会话为 false', () => {
  assert.strictEqual(SseView.isSseSession(null), false);
  assert.strictEqual(SseView.isSseSession({}), false);
});

test('buildFullText: 多帧用 \\n\\n 还原（含中文，UTF-8 解码正确）', () => {
  const session = {
    isSse: true,
    frames: [frame('data: {"content":"你好"}'), frame('data: {"content":"世界"}'), frame('data: [DONE]')]
  };
  assert.strictEqual(
    SseView.buildFullText(session),
    'data: {"content":"你好"}\n\ndata: {"content":"世界"}\n\ndata: [DONE]'
  );
});

test('buildFullText: 忽略客户端方向（isClient）的帧', () => {
  const session = {
    frames: [frame('data: a'), { frameId: '1-2', isClient: true, base64: b64('should-be-ignored') }, frame('data: b')]
  };
  assert.strictEqual(SseView.buildFullText(session), 'data: a\n\ndata: b');
});

test('buildFullText: 无帧时回退到响应体 base64', () => {
  const session = { res: { base64: b64('data: fallback\n\n') } };
  assert.strictEqual(SseView.buildFullText(session), 'data: fallback\n\n');
});

test('buildFullText: 无帧时回退到响应体字符串', () => {
  const session = { res: { body: 'data: plain\n\n' } };
  assert.strictEqual(SseView.buildFullText(session), 'data: plain\n\n');
});

test('frameToText: 支持 bin(Uint8Array) 帧', () => {
  const text = 'data: 二进制帧';
  const session = { frames: [{ isClient: false, bin: new Uint8Array(Buffer.from(text, 'utf8')) }] };
  assert.strictEqual(SseView.buildFullText(session), text);
});

test('buildFullText: 默认不额外补结尾分隔符（忠实于 whistle 帧）', () => {
  const session = { endTime: 1, frames: [frame('data: a'), frame('data: b')] };
  assert.strictEqual(SseView.buildFullText(session), 'data: a\n\ndata: b');
});

test('buildFullText: trailingSeparator=true 时补齐结尾空行', () => {
  const session = { endTime: 1, frames: [frame('data: a'), frame('data: b')] };
  assert.strictEqual(SseView.buildFullText(session, { trailingSeparator: true }), 'data: a\n\ndata: b\n\n');
});

test('buildFullText: 未结束时即使开启 trailingSeparator 也不补', () => {
  const session = { frames: [frame('data: a')] };
  assert.strictEqual(SseView.buildFullText(session, { trailingSeparator: true }), 'data: a');
});

test('buildPreview: 不超长时原样返回', () => {
  const result = SseView.buildPreview('abcdef', 10);
  assert.deepStrictEqual(result, { text: 'abcdef', truncated: false, omitted: 0, mode: 'tail' });
});

test('buildPreview: 默认取尾部并给出省略字符数', () => {
  const result = SseView.buildPreview('0123456789', 4);
  assert.strictEqual(result.text, '6789');
  assert.strictEqual(result.truncated, true);
  assert.strictEqual(result.omitted, 6);
});

test('buildPreview: head 模式取头部', () => {
  const result = SseView.buildPreview('0123456789', 4, 'head');
  assert.strictEqual(result.text, '0123');
  assert.strictEqual(result.omitted, 6);
});

test('summarize: 统计帧数/字符数/流式状态', () => {
  const session = {
    isSse: true,
    frames: [frame('data: 1'), frame('data: 2')],
    res: { statusCode: 200, headers: { 'content-type': 'text/event-stream' } }
  };
  const info = SseView.summarize(session, SseView.buildFullText(session));
  assert.strictEqual(info.frameCount, 2);
  assert.strictEqual(info.charCount, 'data: 1\n\ndata: 2'.length);
  assert.strictEqual(info.streaming, true);
  assert.strictEqual(info.statusCode, 200);
});

test('summarize: 已结束的会话 streaming=false', () => {
  const info = SseView.summarize({ endTime: 123, frames: [] }, '');
  assert.strictEqual(info.streaming, false);
});

test('getResFrames: frames 非数组时安全返回空数组', () => {
  assert.deepStrictEqual(SseView.getResFrames({ frames: null }), []);
  assert.deepStrictEqual(SseView.getResFrames({}), []);
});

/* ---------- 配置（Options 页 / localStorage） ---------- */

function createStorage(initial) {
  const map = Object.assign({}, initial);
  return {
    getItem: (key) => (key in map ? map[key] : null),
    setItem: (key, value) => {
      map[key] = String(value);
    },
    removeItem: (key) => {
      delete map[key];
    }
  };
}

test('normalizeConfig: 空值返回内置默认', () => {
  assert.deepStrictEqual(SseView.normalizeConfig(null), {
    previewLimit: 3000,
    previewMode: 'tail',
    trailingSeparator: false
  });
});

test('normalizeConfig: previewLimit=-1 保留（表示不裁剪）', () => {
  assert.strictEqual(SseView.normalizeConfig({ previewLimit: -1 }).previewLimit, -1);
});

test('normalizeConfig: 非法 previewLimit 回退默认', () => {
  [-5, 0, 1.5, NaN, Infinity, 'abc'].forEach((bad) => {
    assert.strictEqual(SseView.normalizeConfig({ previewLimit: bad }).previewLimit, 3000, 'bad=' + bad);
  });
});

test('normalizeConfig: 字符串数字可被接受', () => {
  assert.strictEqual(SseView.normalizeConfig({ previewLimit: '5000' }).previewLimit, 5000);
  assert.strictEqual(SseView.normalizeConfig({ previewLimit: '-1' }).previewLimit, -1);
});

test('normalizeConfig: previewMode / trailingSeparator 校验', () => {
  assert.strictEqual(SseView.normalizeConfig({ previewMode: 'head' }).previewMode, 'head');
  assert.strictEqual(SseView.normalizeConfig({ previewMode: 'x' }).previewMode, 'tail');
  assert.strictEqual(SseView.normalizeConfig({ trailingSeparator: true }).trailingSeparator, true);
  assert.strictEqual(SseView.normalizeConfig({ trailingSeparator: 'yes' }).trailingSeparator, false);
});

test('normalizeConfig: 自定义默认值生效并作为回退', () => {
  const defaults = { previewLimit: 800, previewMode: 'head', trailingSeparator: true };
  assert.deepStrictEqual(SseView.normalizeConfig(null, defaults), defaults);
  assert.deepStrictEqual(SseView.normalizeConfig({ previewLimit: 'bad' }, defaults), defaults);
  assert.strictEqual(SseView.normalizeConfig({ previewLimit: 100 }, defaults).previewMode, 'head');
});

test('readConfig: 无存储时返回默认值', () => {
  assert.deepStrictEqual(SseView.readConfig(null), SseView.DEFAULT_CONFIG);
  assert.deepStrictEqual(SseView.readConfig(createStorage()), SseView.DEFAULT_CONFIG);
});

test('readConfig: 读取 localStorage 并覆盖默认值', () => {
  const storage = createStorage({
    [SseView.CONFIG_KEY]: JSON.stringify({ previewLimit: -1, previewMode: 'head', trailingSeparator: true })
  });
  assert.deepStrictEqual(SseView.readConfig(storage), {
    previewLimit: -1,
    previewMode: 'head',
    trailingSeparator: true
  });
});

test('readConfig: JSON 损坏时回退默认值', () => {
  const storage = createStorage({ [SseView.CONFIG_KEY]: '{not-json' });
  assert.deepStrictEqual(SseView.readConfig(storage), SseView.DEFAULT_CONFIG);
});

test('writeConfig / readConfig 往返一致，clearConfig 后回退默认', () => {
  const storage = createStorage();
  const saved = SseView.writeConfig(storage, { previewLimit: 100, previewMode: 'head', trailingSeparator: true });
  assert.strictEqual(saved.previewLimit, 100);
  assert.strictEqual(SseView.readConfig(storage).previewLimit, 100);
  SseView.clearConfig(storage);
  assert.deepStrictEqual(SseView.readConfig(storage), SseView.DEFAULT_CONFIG);
});

test('buildPreview: limit=-1 不裁剪，返回完整内容', () => {
  const long = 'x'.repeat(9000);
  const result = SseView.buildPreview(long, -1);
  assert.strictEqual(result.truncated, false);
  assert.strictEqual(result.unlimited, true);
  assert.strictEqual(result.text.length, 9000);
  assert.strictEqual(result.omitted, 0);
});

console.log('\n通过 ' + passed + ' 项' + (process.exitCode ? '（存在失败）' : ''));
