/**
 * SSE Tab 的纯逻辑部分（无 DOM 依赖，可直接在 Node 中单测）。
 *
 * 数据来源：whistle 抓包数据里的 frames。SSE 响应会被 whistle 按 `\n\n` 拆分，
 * 分隔符本身不会出现在帧内容里，因此还原完整流时用 `\n\n` 重新拼接。
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = mod;
  }
  if (root && typeof root === 'object') {
    root.SseView = mod;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PREVIEW_LIMIT = 3000;
  var SSE_SEP = '\n\n';
  var textDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { fatal: false }) : null;

  function bytesToText(bytes) {
    if (!bytes || !bytes.length) {
      return '';
    }
    if (textDecoder) {
      try {
        return textDecoder.decode(bytes);
      } catch (e) {
        /* 继续走下面的兜底逻辑 */
      }
    }
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      out += String.fromCharCode(bytes[i]);
    }
    return out;
  }

  function base64ToText(b64) {
    if (!b64 || typeof b64 !== 'string') {
      return '';
    }
    try {
      var bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
      var len = bin.length;
      var bytes = new Uint8Array(len);
      for (var i = 0; i < len; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      return bytesToText(bytes);
    } catch (e) {
      return '';
    }
  }

  function bufferToText(buf) {
    if (!buf) {
      return '';
    }
    if (typeof buf === 'string') {
      return buf;
    }
    if (buf instanceof Uint8Array) {
      return bytesToText(buf);
    }
    if (typeof ArrayBuffer !== 'undefined' && buf instanceof ArrayBuffer) {
      return bytesToText(new Uint8Array(buf));
    }
    if (Array.isArray(buf)) {
      return bytesToText(new Uint8Array(buf));
    }
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(buf)) {
      return bytesToText(new Uint8Array(buf));
    }
    return '';
  }

  // 单帧 -> 文本
  function frameToText(frame) {
    if (frame == null) {
      return '';
    }
    if (typeof frame === 'string') {
      return frame;
    }
    if (typeof frame.base64 === 'string' && frame.base64) {
      return base64ToText(frame.base64);
    }
    if (frame.bin) {
      return bufferToText(frame.bin);
    }
    if (frame.data) {
      return bufferToText(frame.data);
    }
    if (typeof frame.body === 'string') {
      return frame.body;
    }
    return '';
  }

  function getHeader(session, name) {
    var headers = (session && session.res && session.res.headers) || {};
    var key = Object.keys(headers).filter(function (k) {
      return k.toLowerCase() === name;
    })[0];
    return key ? headers[key] : '';
  }

  // 是否 SSE 请求：whistle 的 isSse 标记，或响应头 content-type 判断（两者取其一）
  function isSseSession(session) {
    if (!session) {
      return false;
    }
    if (session.isSse) {
      return true;
    }
    var type = String(getHeader(session, 'content-type') || '');
    return /^\s*text\/event-stream\s*(;|$)/i.test(type);
  }

  // 响应方向的数据帧（排除客户端发出的帧）
  function getResFrames(session) {
    var frames = (session && session.frames) || [];
    if (!Array.isArray(frames)) {
      return [];
    }
    return frames.filter(function (frame) {
      return frame && !frame.isClient;
    });
  }

  // 兜底：某些情况下内容在响应体上（如规则禁用了流式抓取）
  function bodyText(session) {
    var res = (session && session.res) || {};
    if (typeof res.base64 === 'string' && res.base64) {
      return base64ToText(res.base64);
    }
    if (typeof res.body === 'string') {
      return res.body;
    }
    return '';
  }

  // 还原完整 SSE 内容
  // options.trailingSeparator：为 true 时，若原始流以 \n\n 结尾则补齐（whistle 的帧不含分隔符）
  function buildFullText(session, options) {
    var frames = getResFrames(session);
    var text;
    if (frames.length) {
      text = frames
        .map(frameToText)
        .filter(function (item) {
          return item !== '';
        })
        .join(SSE_SEP);
    } else {
      text = bodyText(session);
    }
    if (
      options &&
      options.trailingSeparator &&
      text &&
      !/\n\n$/.test(text) &&
      session &&
      session.endTime
    ) {
      text += SSE_SEP;
    }
    return text;
  }

  /**
   * 预览：默认取尾部（流式内容最新部分最有价值），超长时截断并返回省略字符数
   */
  function buildPreview(text, limit, mode) {
    text = typeof text === 'string' ? text : '';
    limit = limit > 0 ? limit : PREVIEW_LIMIT;
    if (text.length <= limit) {
      return { text: text, truncated: false, omitted: 0, mode: mode || 'tail' };
    }
    if (mode === 'head') {
      return { text: text.slice(0, limit), truncated: true, omitted: text.length - limit, mode: 'head' };
    }
    return { text: text.slice(-limit), truncated: true, omitted: text.length - limit, mode: 'tail' };
  }

  function summarize(session, text) {
    var frames = getResFrames(session);
    var res = (session && session.res) || {};
    return {
      frameCount: frames.length,
      charCount: typeof text === 'string' ? text.length : 0,
      streaming: !!(session && !session.endTime && !session.lost),
      statusCode: res.statusCode,
      contentType: String(getHeader(session, 'content-type') || '')
    };
  }

  return {
    PREVIEW_LIMIT: PREVIEW_LIMIT,
    SSE_SEP: SSE_SEP,
    base64ToText: base64ToText,
    bufferToText: bufferToText,
    frameToText: frameToText,
    isSseSession: isSseSession,
    getResFrames: getResFrames,
    bodyText: bodyText,
    buildFullText: buildFullText,
    buildPreview: buildPreview,
    summarize: summarize
  };
});
