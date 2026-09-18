# 开发与发布说明

> 本文件用于仓库内部开发/发布流程，**不会发布到 npm**（`package.json` 的 `files` 为白名单，仅包含 `index.js`、`lib`、`public`、`README.md`、`LICENSE`）。

## 仓库信息

- 远程：`git@github.com:ducaoya/whistle-sse-viewer.git`（SSH）
- 主干分支：`master`（本地与远程同名）

> 若当前网络无法访问 GitHub 的 SSH（22/443 被拦截），可临时改用 HTTPS：
> `git remote set-url origin https://github.com/ducaoya/whistle-sse-viewer.git`

## 目录结构

```
whistle-sse-viewer/
├── index.js                 # 插件入口（仅导出 uiServer）
├── lib/uiServer.js          # 托管 public/ 静态资源
├── public/
│   ├── tab.html             # Response 面板的 SSE Tab 页面（含 View All / Copy All）
│   └── sse-view.js          # 纯逻辑：SSE 判定 / 帧还原 / 预览截断（无 DOM 依赖，可单测）
├── test/sse-view.test.js    # 单测（19 项）
├── docs/images/             # README 截图（通过 GitHub raw 绝对地址引用）
├── .github/workflows/       # 自动发布工作流
└── package.json             # whistleConfig.inspectorsTab.res 注册 Tab
```

## 本地开发

```bash
# 跑单测
npm test

# 装到本地 whistle（二选一）
cp -r . ~/.WhistleAppData/custom_plugins/whistle.sse-viewer && w2 restart
w2 start -A <插件目录的父目录>
```

- `uiServer` 每次请求都从磁盘读取文件，因此改 `public/` 下的页面**不需要重启**（刷新页面即可）；改 `package.json` 的 `whistleConfig`（如 `inspectorConfig`）需要 `w2 restart`。
- 调试 SSE 可用任意会推 `text/event-stream` 的服务，例如：

```bash
# 本地临时起一个 SSE 服务（仅回环）
node -e "require('http').createServer((q,s)=>{s.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8'});let i=0;setInterval(()=>{i++;s.write('data: {\"seq\":'+i+'}\n\n');if(i>=100)s.end()},1000)}).listen(39999,'127.0.0.1')"

# 经 whistle 代理发起，便于在 Network 里查看
curl -N -x http://127.0.0.1:8899 http://127.0.0.1:39999/
```

## 发布到 npm（自动）

`.github/workflows/publish.yml` 的触发条件（**两者同时满足**）：

1. 推送到 `master` 分支
2. 提交信息中包含 **【release】** 标识

```bash
# 1. 先上调 package.json 的 version（工作流不会自动 bump）
# 2. 提交信息带上【release】标识并推送
git commit -am "chore: release 1.0.1【release】"
git push origin master
```

工作流执行顺序：`npm test` → 读取 `name@version` → 检查该版本是否已在 npm（已存在则提示并跳过）→ `npm publish`。

### 发布方式：npm Trusted Publishing（OIDC，无需 token）

npm 已永久吐销全部 classic token（2025-12-09），且带直接发布能力的 granular token 也在退场，因此本仓改用 **OIDC 可信发布**：工作流用 GitHub 签发的短期凭据发布，**不需要任何 secret**。

前置（每个包在 npm 网页上配一次）：`https://www.npmjs.com/package/<包名>/access` → **Trusted Publisher** → GitHub Actions

| 字段 | 值 |
| --- | --- |
| Organization or user | `ducaoya` |
| Repository | `whistle-sse-viewer` |
| Workflow filename | `publish.yml`（只填文件名，大小写敏感） |
| Environment name | 留空 |

工作流侧需满足：

- `permissions.id-token: write`（否则 OIDC 不可用）
- npm ≥ 11.5.1（Node 22 自带 10.x，工作流里用 `npm install -g npm@latest` 提升）
- `package.json` 的 `repository.url` 必须与 GitHub 仓库一致
- 必须使用 GitHub 托管 runner（不支持自建）

> 首版例外：Trusted Publisher 只能给**已存在的包**配置，所以首个版本需要先手动发布一次：
> ```bash
> npm login   # 2FA 交互登录（会话 2 小时有效）
> npm publish # 提示 OTP 时输入验证码
> ```

> 可选替代：带人工审批的暂存发布（token 选 **Read and write (stage only)** + `npm stage publish`），但每次发版都需 2FA 审批，多包场景不推荐；且官方明确暂存发布**不支持全新包**。

### 关键细节：标记必须在 HEAD 上

工作流判断的是 `github.event.head_commit.message`，也就是**本次 push 的最后一条提交**。所以：

- 带【release】的那条提交必须是推送后的 HEAD，否则不会触发发布
- 若想先提交其它内容（例如补截图）再发布，推荐用「空提交打标记」：

```bash
# 1. 先提交普通改动
git add docs/images && git commit -m "docs: 补充界面截图"
# 2. 再用空提交把【release】标记放到 HEAD
git commit --allow-empty -m "chore: release 1.0.1【release】"
# 3. 一起推送（HEAD 带标记 -> 触发发布）
git push origin master
```

### 发布前自查（不依赖 GitHub Actions）

```bash
npm test                                            # 单测
npm pack --dry-run                                  # 查看将要发布的内容
node -p "require('./package.json').name+'@'+require('./package.json').version"
npm view <name>@<version> version                   # 有输出=该版本已存在，需先上调 version
```

## 截图维护

README 通过 `https://raw.githubusercontent.com/ducaoya/whistle-sse-viewer/master/docs/images/<name>.png` 引用图片，新增/替换截图只需覆盖同名文件：

| 文件 | 内容 |
| --- | --- |
| `docs/images/tab-overview.png` | 入口与预览：Network 选中 SSE 请求 + Response 区 `SSE` 标签 + 右上角 `View All` / `Copy All`（红框标注） |
| `docs/images/view-all.png` | `View All` 近全屏弹窗 |
