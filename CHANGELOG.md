# Changelog

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
