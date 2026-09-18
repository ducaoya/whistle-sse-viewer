/**
 * whistle.sse-viewer
 *
 * Response 面板的「SSE」Tab：展示 SSE 流内容预览，并提供 View All / Copy All。
 *
 * 数据来源：whistle UI 已抓取的 frames（SSE 被 whistle 按 \n\n 拆分后的帧），
 * 因此不需要任何抓包规则，也不需要 server 钩子。
 */

// uiServer：托管 public/ 下的 Tab 页面及其静态资源
exports.uiServer = require('./lib/uiServer');
