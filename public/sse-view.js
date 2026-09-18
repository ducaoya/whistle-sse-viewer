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
  var CONFIG_KEY = 'whistle.sse-viewer.config';
  // package.json 的 whistleConfig.inspectorConfig 作为默认值
  var DEFAULT_CONFIG = {
    previewLimit: PREVIEW_LIMIT,
    previewMode: 'tail',
    trailingSeparator: false,
    formatJson: false
  };
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
    // limit < 0（-1）：不裁剪，返回完整内容
    if (typeof limit === 'number' && limit < 0) {
      return { text: text, truncated: false, omitted: 0, mode: mode || 'tail', unlimited: true };
    }
    limit = limit > 0 ? limit : PREVIEW_LIMIT;
    if (text.length <= limit) {
      return { text: text, truncated: false, omitted: 0, mode: mode || 'tail' };
    }
    if (mode === 'head') {
      return { text: text.slice(0, limit), truncated: true, omitted: text.length - limit, mode: 'head' };
    }
    return { text: text.slice(-limit), truncated: true, omitted: text.length - limit, mode: 'tail' };
  }

  /**
   * 配置规范化：
   * - previewLimit：-1 表示不裁剪（显示完整内容），正整数为预览字符数，其余值回退默认
   * - previewMode：'tail' | 'head'
   * - trailingSeparator：boolean
   */
  function normalizeConfig(raw, defaults) {
    var base = normalizeDefaults(defaults);
    if (!raw || typeof raw !== 'object') {
      return base;
    }
    var limit = raw.previewLimit;
    if (typeof limit === 'string' && limit.trim() !== '') {
      limit = Number(limit);
    }
    if (typeof limit === 'number' && isFinite(limit) && Math.floor(limit) === limit) {
      if (limit === -1 || limit > 0) {
        base.previewLimit = limit;
      }
    }
    if (raw.previewMode === 'tail' || raw.previewMode === 'head') {
      base.previewMode = raw.previewMode;
    }
    if (typeof raw.trailingSeparator === 'boolean') {
      base.trailingSeparator = raw.trailingSeparator;
    }
    if (typeof raw.formatJson === 'boolean') {
      base.formatJson = raw.formatJson;
    }
    return base;
  }

  function normalizeDefaults(defaults) {
    var base = {
      previewLimit: DEFAULT_CONFIG.previewLimit,
      previewMode: DEFAULT_CONFIG.previewMode,
      trailingSeparator: DEFAULT_CONFIG.trailingSeparator,
      formatJson: DEFAULT_CONFIG.formatJson
    };
    if (!defaults || typeof defaults !== 'object') {
      return base;
    }
    var limit = defaults.previewLimit;
    if (typeof limit === 'string' && limit.trim() !== '') {
      limit = Number(limit);
    }
    if (typeof limit === 'number' && isFinite(limit) && Math.floor(limit) === limit && (limit === -1 || limit > 0)) {
      base.previewLimit = limit;
    }
    if (defaults.previewMode === 'tail' || defaults.previewMode === 'head') {
      base.previewMode = defaults.previewMode;
    }
    if (typeof defaults.trailingSeparator === 'boolean') {
      base.trailingSeparator = defaults.trailingSeparator;
    }
    if (typeof defaults.formatJson === 'boolean') {
      base.formatJson = defaults.formatJson;
    }
    return base;
  }

  // 从 localStorage 读取配置（不存在或解析失败时回退默认值）
  function readConfig(storage, defaults) {
    var base = normalizeDefaults(defaults);
    if (!storage || typeof storage.getItem !== 'function') {
      return base;
    }
    try {
      var raw = storage.getItem(CONFIG_KEY);
      if (!raw) {
        return base;
      }
      return normalizeConfig(JSON.parse(raw), base);
    } catch (e) {
      return base;
    }
  }

  // 写入 localStorage（返回规范化后的配置）
  function writeConfig(storage, config, defaults) {
    var normalized = normalizeConfig(config, defaults);
    if (storage && typeof storage.setItem === 'function') {
      try {
        storage.setItem(CONFIG_KEY, JSON.stringify(normalized));
      } catch (e) {
        /* 忽略写入失败（隐私模式/配额） */
      }
    }
    return normalized;
  }

  function clearConfig(storage) {
    if (storage && typeof storage.removeItem === 'function') {
      try {
        storage.removeItem(CONFIG_KEY);
      } catch (e) {
        /* 忽略 */
      }
    }
  }

  /**
   * 保存配置：写入 localStorage 并读回校验。
   * 返回 { ok, error, config }，供配置页区分“保存成功 / 保存失败”并给出提示。
   */
  function saveConfig(storage, config, defaults) {
    var normalized = normalizeConfig(config, defaults);
    if (!storage || typeof storage.setItem !== 'function') {
      return { ok: false, error: 'LOCAL_STORAGE_UNAVAILABLE', config: normalized };
    }
    try {
      storage.setItem(CONFIG_KEY, JSON.stringify(normalized));
    } catch (e) {
      return { ok: false, error: (e && e.name) || 'SET_ITEM_ERROR', config: normalized };
    }
    var readBack = readConfig(storage, defaults);
    if (JSON.stringify(readBack) !== JSON.stringify(normalized)) {
      return { ok: false, error: 'VERIFY_FAILED', config: readBack };
    }
    return { ok: true, error: null, config: readBack };
  }

  /**
   * 尝试把每个事件里 data: 后的内容格式化为多行 JSON（仅用于展示，默认关闭）。
   * - 支持同一事件内多行 data:（按 SSE 规范用 \n 拼接后再尝试解析）
   * - 解析失败（如 data: [DONE]）或数据不以 { / [ 开头时，保持原样
   * - 事件之间仍用 \n\n 分隔；event: / id: / 注释行原样保留
   */
  function formatJsonData(text) {
    if (typeof text !== 'string' || !text) {
      return typeof text === 'string' ? text : '';
    }
    return text
      .split(SSE_SEP)
      .map(function (block) {
        if (!block) {
          return block;
        }
        var out = [];
        var group = [];
        function flush() {
          if (!group.length) {
            return;
          }
          var values = group.map(function (item) {
            return item.value;
          });
          var formatted = tryFormatJson(values.join('\n'));
          if (formatted === null) {
            group.forEach(function (item) {
              out.push(item.raw);
            });
          } else {
            var formattedLines = formatted.split('\n');
            out.push('data: ' + formattedLines[0]);
            for (var i = 1; i < formattedLines.length; i++) {
              out.push(formattedLines[i]);
            }
          }
          group = [];
        }
        block.split('\n').forEach(function (line) {
          var matched = /^data:(\s?)([\s\S]*)$/.exec(line);
          if (matched) {
            group.push({ raw: line, value: matched[2] });
            return;
          }
          flush();
          out.push(line);
        });
        flush();
        return out.join('\n');
      })
      .join(SSE_SEP);
  }

  function tryFormatJson(value) {
    var trimmed = String(value == null ? '' : value).trim();
    if (!trimmed) {
      return null;
    }
    var first = trimmed.charAt(0);
    if (first !== '{' && first !== '[') {
      return null;
    }
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch (e) {
      return null;
    }
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
    CONFIG_KEY: CONFIG_KEY,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    normalizeConfig: normalizeConfig,
    normalizeDefaults: normalizeDefaults,
    readConfig: readConfig,
    writeConfig: writeConfig,
    saveConfig: saveConfig,
    clearConfig: clearConfig,
    base64ToText: base64ToText,
    bufferToText: bufferToText,
    frameToText: frameToText,
    isSseSession: isSseSession,
    getResFrames: getResFrames,
    bodyText: bodyText,
    buildFullText: buildFullText,
    formatJsonData: formatJsonData,
    buildPreview: buildPreview,
    summarize: summarize
  };
});
