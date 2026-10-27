# Changelog

## [Unreleased]

### 文档与工程

- 新增 [SECURITY.md](SECURITY.md)：扫描读哪些文件与上限（300 文件 / 单文件 400 KB / 合计 2 MB）、
  `link:` 依赖经 `realpath` 读到真实仓库、子目录符号链接不跟随、**五条路由都没有鉴权**
  并且 `/dispatch` 会把一条任务 queue 进你已有的会话（写入口）、以及「只读」到底指什么。
- 新增 `.github/workflows/ci.yml`：ubuntu + windows × node 22/24 跑 `npm test`（36 个用例）。
- 新增 `screenshots.json`（`docs/panel.png`，真实渲染的面板截图），市场卡片可以直接读到封面。
- README 顶部补 CI / license 两个 badge 与一句 star 引导。
- 不改运行逻辑、不升版本。

## 0.2.0

「版本自适应」从只读报告变成可派发：面板只诊断，改动交给插件自己的会话。

- **本地 / 外部之分**：扫描结果带上依赖声明原文与真实目录。`link:` 安装的插件标成「本地」并带仓库路径，
  外部包（版本号 / tarball）标为外部。未声明的统计也拆成 `local` / `external` / `localUndeclared`。
- **派发**：面板每行加「适配到当前版本」。点它把一条结构化任务（运行时版本、判定、每条迁移提示的
  `文件:行号`、要补的 `engines.dsh`、收尾要求）投进**该插件自己的会话**——`sessionController.prompt(...)`，
  `mode: 'queue'`，冷会话先 resume。不新建会话，也不在当前对话里改代码。
- **怎么认「对应会话」**：工作目录精确匹配 → 会话标题匹配（`dsh-in-hand` ↔ `dsh-in hand`）→ 上级工作目录；
  都不中时返回候选让用户点一次（`ECHOOSE`），选择记在 `localStorage`，之后一键直达。
- 新增路由 `GET /dsh-adaptive/sessions`、`POST /dsh-adaptive/dispatch`；新增 2 个回归测试（共 36 个）。
- 实机复核：18 个依赖里 16 个兼容、2 个未声明（都是外部 npm 包）、3 条迁移提示；
  本机 12 个自研插件已统一补上 `engines.dsh: >=0.2.1-rc.2 <0.3.0`。

## 0.1.1

修复面板报 `Failed to execute 'json' on 'Response': Unexpected end of JSON input`（2026-10-21 实测）。

- **根因**：DSH 不保证 `webServer` / `tools` 在本插件之前激活。旧实现用 `ctx.effect()` 读一次
  `ctx.get()`，读到 `undefined` 就跳过注册且不再重试——插件状态仍是 `active`，路由却从未挂上，
  面板拿到空响应（HTTP 404、0 字节），`response.json()` 于是抛 `Unexpected end of JSON input`。
  `self.toolRegistered` 同时为 `undefined`，等于两个入口一起消失。
- **修复**：改用 cordis 的 `ctx.inject(deps, cb)`，依赖就绪后才注册路由与工具，并随作用域自动清理；
  没有该 API 的旧环境退化成原来的行为。
- 自检新增 `self.registration`（`ctx.inject` / `ctx.effect`），面板页脚显示路由是靠哪种方式挂上的。
- 面板错误态不再直接抛 JSON 解析异常：空响应显示「HTTP 404，空响应——宿主的 /dsh-adaptive 路由没挂上」。
- 新增回归测试：激活那一刻服务还没就绪 → 就绪回调后路由与工具都在（共 34 个测试）。

### 面板重排

- 表格改成固定列宽的三列（插件与版本声明 / 状态 / 说明），版本约束内联在插件名下方，
  超过两条截断、悬停看全部，不再把整段声明塞进一列里挤坏排版。
- 展开内容改成独占一整行的第二行（`colSpan=3`），不再挤在「说明」单元格里；
  展开状态由 React 控制，可同时展开多行。
- 右侧参考栏用分隔线切成「版本内容 / 判定规则 / 提示怎么来的 / 插件自检」四段，
  长文本限制在 74ch 内。
- 面板留 16px 左右内边距、底部 160px 给宿主输入框让位，适配窄窗口（≤1100px 单列）。
- README 增加 `docs/panel.png` 实机截图（desktop Profile、`0.2.1-rc.2`、18 个依赖）。

## 0.1.0

首个可用版本。

- 运行时版本识别：`pluginManager.listBundles()` → installation 来源的 `@deepseek-ai/dsh-base` 版本；
  退路解析 `@deepseek-ai/dsh-app-boot/package.json`。
- Profile 定位：显式配置 → `DSH_PROFILE_DIR` → `profileContext.packageManager.env` →
  `$DSH_HOME/profiles/*` 中「装了本插件」的目录（宿主进程本身没有 `DSH_PROFILE_DIR`）；来源会写进报告。
- 兼容矩阵：复刻 DSH `plugin-compatibility.ts` 的判据（`engines.dsh` 优先、`@deepseek-ai/dsh*` peer、
  `workspace:` 协议、`includePrerelease`、精确版本例外），逐插件给出状态与未满足项。
- 迁移提示：release notes `v0.1.6-alpha.1 → v0.2.1-rc.2` 的 10 条规则，命中带 `文件:行号` 与建议，
  明确标注启发式边界。
- 版本内容快照：7 个版本的破坏性/功能性变更，带发布日期与 release 链接。
- 会话视图标签页「版本自适应」：运行时版本与来源、Profile、状态计数、逐插件明细、版本内容、重新扫描、复制 Markdown。
- agent 工具 `adaptive_report`（`refresh` / `format` / `includeHints`）。
- HTTP：`GET /dsh-adaptive/state`、`POST /dsh-adaptive/scan`、`GET /dsh-adaptive/report.md`。
- 展示元数据：`icon.svg`、`locale/en.json`、`locale/zh.json`，`package.json` 声明 `icon` 字段。
- 自检：`/state` 返回 `self.toolRegistered`，面板页脚显示本插件的 agent 工具是否注册成功。
- 33 个单测覆盖 semver 子集、DSH 判据复刻、只读扫描、HTTP/工具注册、Profile 定位与清单契约。
