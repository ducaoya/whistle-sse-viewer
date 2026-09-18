# whistle.sse-viewer

Whistle 插件：在 **Response 面板**新增一个 **SSE** Tab，用于查看并复制完整的 SSE（`text/event-stream`）流内容。

- **实时**：数据来自 whistle 已抓取的帧，请求进行中即可看到内容持续追加，**无需配置任何抓包规则**
- **预览**：内容区默认展示尾部 3000 字符，流式过程中自动滚动到底部
- **View All**：弹出**近全屏**弹窗展示完整内容（覆盖整个 Whistle 界面，可滚动、可全选，`Esc` / 遮罩 / 关闭按钮退出）
- **Copy All**：一键把完整内容复制到剪贴板
- **可配置**：`Plugins → whistle.sse-viewer → Option` 可调整预览字符数（`-1` 表示不裁剪）、预览段落、结尾补空行、`data:` JSON 格式化，保存后立即生效
- **非 SSE 请求**：显示空态提示，不展示任何内容

## 界面

选中 SSE 请求后，在 **Response** 区域点击 `SSE` 标签：内容区实时追加流内容（超出预览上限时提示“已省略前 N 个字符”），右上角提供 `View All`（近全屏弹窗查看完整内容）与 `Copy All`（一键复制）。

![SSE Tab 入口与内容预览](https://raw.githubusercontent.com/ducaoya/whistle-sse-viewer/master/docs/images/tab-overview.png)

![View All 近全屏弹窗](https://raw.githubusercontent.com/ducaoya/whistle-sse-viewer/master/docs/images/view-all.png)

## 安装

```bash
w2 install whistle.sse-viewer
w2 restart
```

> 需要 whistle **2.10.9+**（该版本起带 charset 的 `text/event-stream; charset=utf-8` 也会被识别为 SSE），可用 `w2 -V` 查看当前版本。

### 更新 / 卸载

```bash
w2 install whistle.sse-viewer    # 重新安装即更新到最新版
w2 uninstall whistle.sse-viewer  # 卸载
w2 restart
```

### 从源码 / 本地目录安装

```bash
# 方式一：放进 whistle 的 custom_plugins（会自动扫描其中的 whistle.* 插件）
cp -r whistle-sse-viewer ~/.WhistleAppData/custom_plugins/whistle.sse-viewer
w2 restart

# 方式二：启动时用 -A 指定插件目录的父目录
w2 start -A /path/to/plugins-root     # plugins-root/whistle.sse-viewer/package.json
```

## 使用

1. 在 Whistle 管理界面抓到一个 SSE 请求（响应头为 `text/event-stream`，例如 `https://example.com/api/chat`）
2. 选中该请求，切到右侧详情面板的 **Response** 区域
3. 点击 **SSE** 标签（本插件是当前唯一注册的 Response Tab，按钮直接显示为 `SSE`；若同时装了其它同类插件，则位于 `Plugins` 标签内）
4. 流式过程中内容持续追加；`View All` 查看全量，`Copy All` 直接复制

## 配置

在 Whistle 里打开 **Plugins → whistle.sse-viewer → Option**，即可在配置页里调整；配置保存在本机浏览器的 **localStorage**（键名 `whistle.sse-viewer.config`），**保存后立即生效**，无需重启 Whistle，也无需修改 `package.json`。

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| 预览字符数 `previewLimit` | `3000` | 内容区最多展示多少字符；**填 `-1` 表示不裁剪，直接显示完整内容** |
| 预览区取哪一段 `previewMode` | `tail` | 下拉选择：`tail` 尾部（推荐，流式场景最新内容优先）/ `head` 头部 |
| 结尾补空行 `trailingSeparator` | `false` | 下拉选择：`true` 时在结尾补 `\n\n`，与原始流字节完全一致 |
| data 内容 JSON 格式化 `formatJson` | `false` | 下拉选择：开启后会尝试把 `data:` 后的 JSON 格式化成多行展示（解析失败如 `data: [DONE]` 保持原样）；**预览 / View All / Copy All 均使用格式化后的内容** |

补充说明：

- 配置按**浏览器**保存（换浏览器 / 隐身窗口会回到默认值）；`View All` 弹窗始终展示完整内容，不受 `previewLimit` 影响
- 预览区与 `View All` 弹窗内的**长行会自动换行**（仅显示层换行，不改变内容）
- `previewLimit` 留空时按默认值处理，输入框失焦会自动填回默认值
- `package.json` 的 `whistleConfig.inspectorConfig` 仅作为**默认值**（配置页会展示它）；需要改默认值时改它并 `w2 restart`
- 配置页里点 **恢复默认** 会清除 localStorage 中的配置
- 保存成功/失败会在右上角给出提示；输入非法、浏览器禁用存储（隐身模式）或写入失败时不会写入配置

## 主题适配

插件界面会**跟随 Whistle 的皮肤（浅色 / 深色）**：`public/theme.js` 读取宿主页面的 CSS 变量（`--b-default`、`--b-bar`、`--c-border`、`--v-border`、`--h-field`、`--c-link` 等）并同步到插件页。

与 Whistle 自身的机制配合：Whistle 会周期性地给插件 iframe 设置 `data-theme` 并调用 `window.onWhistleThemeChange(theme)`（它只推送主题名，不推送其它变量），插件监听该钩子后立即重新同步全部变量；同时用 MutationObserver + 定时轮询兜底，因此在旧版本 Whistle 或钩子未触发时同样能跟随，Whistle 换肤或自定义主题也会自动跟随。

无法访问宿主页面时（例如单独打开插件页），回退到内置的浅/深两套调色板并跟随系统偏好（`prefers-color-scheme`）。

## 工作原理

SSE 响应会被 Whistle 按 `\n\n` 拆分成帧（Frames 面板里能看到同样的数据），本插件把这些帧按 `\n\n` 重新拼回完整文本，因此：

- 不需要写任何规则，也不影响请求本身的转发（纯读取抓包数据）
- 请求进行中即可看到内容，与是否结束无关

## 常见问题

**Q：Tab 里没有内容？**

- 确认响应头是 `text/event-stream`（响应被 `content-encoding: gzip/br` 压缩时 Whistle 不做流式抓取，可用 `disable://gzip` 规避）
- 确认 Whistle 版本 ≥ 2.10.9（`w2 -V`）
- 提示"没有捕获到 SSE 内容"通常意味着流尚未产生数据，或帧已被缓存上限裁剪（见下方限制）

**Q：为什么普通请求也能看到这个 Tab？**

Whistle 的插件 Tab 是插件级静态注册，官方没有"按请求隐藏 Tab"的能力，因此非 SSE 请求下会显示空态提示。

**Q：消息条数比实际少？**

受 Whistle 的帧缓存上限约束（默认 600 条），可用 `w2 restart -F 20000` 调大。

**Q：复制的文本比原始流少了最后一行空行？**

Whistle 拆分帧时会去掉 `\n\n` 分隔符，还原时末尾的空行默认不补；需要与原始流完全一致时把 `trailingSeparator` 设为 `true`。

**Q：配置页输入框没显示默认值 / 页面像是没生效？**

先按 `Ctrl+F5` 硬刷新一次（插件更新后浏览器可能仍持有旧页面）。若仍异常，按 `F12` 看 Console：依赖脚本加载失败时页面顶部会显示红色报错。

## 已知限制

1. **Tab 对所有请求可见**：非 SSE 请求显示空态提示（官方扩展点不支持按请求条件隐藏）。
2. **内容受 Whistle 帧缓存约束**：
   - 帧条数：默认 600（`w2 restart -F 20000` 可调大，小于 720 的值会被重置为 600）
   - 单帧大小：1MB，超出会被切片
   - 界面每轮轮询最多取 16 帧
   - 超长/超大流建议配合落盘规则：`<pattern> resWrite:///path/to/sse.txt`
3. **压缩响应不抓流**：响应带 `content-encoding: gzip/br` 时没有帧数据，可用 `disable://gzip` 规避。
4. **弹窗层级**：`View All` 默认覆盖整个 Whistle 界面；极少数情况下（无法访问宿主页面）会退回到标签页内的全屏弹窗。

## License

[MIT](./LICENSE)
