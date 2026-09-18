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

console.log('\n通过 ' + passed + ' 项' + (process.exitCode ? '（存在失败）' : ''));
