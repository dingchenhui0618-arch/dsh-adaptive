# Changelog

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
