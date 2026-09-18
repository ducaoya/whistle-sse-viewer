# whistle.sse-viewer

Whistle 插件：在 **Response 面板**新增一个 **SSE** Tab，用于查看并复制完整的 SSE（`text/event-stream`）流内容。

- **实时**：数据来自 whistle 已抓取的帧，请求进行中即可看到内容持续追加，**无需配置任何抓包规则**
- **预览**：内容区默认展示尾部 3000 字符，流式过程中自动滚动到底部
- **View All**：弹出**近全屏**弹窗展示完整内容（覆盖整个 Whistle 界面，可滚动、可全选，`Esc` / 遮罩 / 关闭按钮退出）
- **Copy All**：一键把完整内容复制到剪贴板
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

## 配置（可选）

在插件 `package.json` 的 `whistleConfig.inspectorConfig` 中调整，改完执行 `w2 restart` 生效：

```json
{
  "whistleConfig": {
    "inspectorConfig": {
      "previewLimit": 3000,
      "previewMode": "tail",
      "trailingSeparator": false
    }
  }
}
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `previewLimit` | `3000` | 预览区展示的字符数 |
| `previewMode` | `tail` | `tail` 取尾部（推荐，流式内容最新部分最有价值），`head` 取头部 |
| `trailingSeparator` | `false` | 是否在结尾补 `\n\n` |

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
