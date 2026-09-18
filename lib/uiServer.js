/**
 * 托管 public/ 目录下的静态资源（Tab 页面、脚本、样式、图标）。
 *
 * whistle 会把插件 UI 的请求原样转给本 server（见 whistle/lib/plugins/load-plugin.js
 * 中的 `uiServer.emit('request', req, res)`），路径形态可能是：
 *   /plugin.whistle.sse-viewer/public/tab.html
 *   /whistle.sse-viewer/public/tab.html
 *   /public/tab.html
 *   /tab.html
 * 所以这里按 "public/ 之后的相对路径" 解析，取不到则退回最后一段文件名。
 */

const path = require('path');
const fs = require('fs');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon'
};

function getPathname(url) {
  try {
    return decodeURIComponent(String(url || '/').split('?')[0].split('#')[0]);
  } catch (e) {
    return '';
  }
}

// 解析出 public 目录下的绝对路径；越界返回 null
function resolveFile(pathname) {
  const marker = '/public/';
  const index = pathname.lastIndexOf(marker);
  let relative = index !== -1 ? pathname.slice(index + marker.length) : pathname;
  relative = relative.replace(/^\/+/, '');
  if (index === -1) {
    // 没有 public 前缀时只允许文件名，避免误访问插件其它文件
    relative = relative.split('/').pop() || '';
  }
  if (!relative) {
    return null;
  }
  const target = path.resolve(PUBLIC_DIR, relative);
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + path.sep)) {
    return null;
  }
  return target;
}

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache'
  });
  res.end(body);
}

const INFO_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>whistle.sse-viewer</title></head>
<body style="font: 13px/1.8 -apple-system, 'Segoe UI', sans-serif; padding: 24px;">
  <h3 style="margin: 0 0 8px;">whistle.sse-viewer</h3>
  <p>该插件用于查看 SSE 流内容：选中一个 SSE 请求后，在 <b>Response</b> 面板点击 <b>SSE</b> 标签即可。</p>
  <p style="color: #888;">插件本身无需配置。</p>
</body>
</html>`;

// 默认值来自 package.json 的 whistleConfig.inspectorConfig（每次请求读取，改完刷新即生效）
function getDefaultConfig() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const conf = (pkg.whistleConfig || {}).inspectorConfig || {};
    return {
      previewLimit: conf.previewLimit,
      previewMode: conf.previewMode,
      trailingSeparator: conf.trailingSeparator,
      formatJson: conf.formatJson
    };
  } catch (e) {
    return {};
  }
}

module.exports = (server) => {
  server.on('request', (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'Method Not Allowed');
    }
    const pathname = getPathname(req.url);
    // 配置页用于读取 package.json 里的默认值
    if (/\/api\/defaults\/?$/.test(pathname)) {
      return send(res, 200, JSON.stringify(getDefaultConfig()), MIME_TYPES['.json']);
    }
    if (!pathname || pathname === '/' || /^\/[^/]+\/?$/.test(pathname)) {
      const indexFile = path.join(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(indexFile)) {
        return send(res, 200, fs.readFileSync(indexFile), MIME_TYPES['.html']);
      }
      return send(res, 200, INFO_PAGE, MIME_TYPES['.html']);
    }
    const file = resolveFile(pathname);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return send(res, 404, 'Not Found: ' + pathname);
    }
    const type = MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    send(res, 200, fs.readFileSync(file), type);
  });
};
