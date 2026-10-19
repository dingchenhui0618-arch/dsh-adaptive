// 「版本内容」快照：从 DSH 官方 release notes 里逐条摘出的、和插件作者/使用者相关的变更。
//
// 只记录能在 release notes 原文里找到出处的条目，并保留版本号与日期；
// 不推断、不合并语义相近但版本不同的条目。完整原文见每条 release 的链接。
//
// 这份快照内置在包里，离线可用；它不替代 DSH 的 release notes 原文。

export const RELEASE_NOTES_BASE = 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/'

export const VERSION_CONTENT = [
  {
    version: '0.2.1-rc.2',
    date: '2026-10-17',
    changes: [
      { kind: 'feature', text: '适配 DeepSeek-V4.1-Flash-1017 上线。' },
      { kind: 'feature', text: '适配 DeepSeek Search 与 Fetch API，可在网页搜索设置中开启。' },
    ],
  },
  {
    version: '0.2.1-alpha.4',
    date: '2026-10-14',
    changes: [
      { kind: 'breaking', text: '第三方插件的版本兼容性优先按 `engines.dsh` 判断；未声明时沿用原有规则。插件作者需检查声明是否覆盖支持的 DSH 版本。' },
    ],
  },
  {
    version: '0.1.7-rc.1',
    date: '2026-09-24',
    changes: [
      { kind: 'breaking', text: '插件安装和启动会检查与当前 DSH 版本的兼容性；不兼容时说明原因，并可对确切版本授予例外。' },
      { kind: 'breaking', text: '仅保存在自定义事件中的附件不再自动读取或导出，插件需适配。' },
      { kind: 'breaking', text: '工作区文件读取统一为 `readBytes`，插件需迁移旧接口。' },
      { kind: 'breaking', text: '插件组合包支持按顺序加载多个 patch 文件，原有单文件写法仍可使用。' },
      { kind: 'breaking', text: 'Agent 预设改由插件组合包声明和安装；旧目录预设需迁移。' },
      { kind: 'breaking', text: '设置改由当前 Profile 的插件配置保存，支持声明过的实时更新字段；旧 settings.yaml 仅尝试导入一次，自定义设置插件需适配。' },
      { kind: 'feature', text: '插件可通过 locale 数据结构声明多语言标题和描述，通过 package.json 声明图标。' },
      { kind: 'feature', text: 'Session 日志升级为 V4，新增批量迁移工具，兼容部分 V3 会话缺少轮次结束记录的情况。' },
    ],
  },
  {
    version: '0.1.7-alpha.2',
    date: '2026-09-23',
    changes: [
      { kind: 'breaking', text: '自定义 `spill-policy` 配置中的 `maxInlineBytes` 需改为 `maxInlineTokens`，按 token 数重新设置预算。' },
    ],
  },
  {
    version: '0.1.7-alpha.1',
    date: '2026-09-22',
    changes: [
      { kind: 'breaking', text: '工作区文件读取统一为 `readBytes`；Remote 支持双向流与二进制结果。' },
      { kind: 'breaking', text: 'Agent 预设改由插件组合包声明和安装，旧目录预设需迁移。' },
      { kind: 'breaking', text: '设置改由当前 Profile 的插件配置保存；旧 settings.yaml 仅导入一次。' },
      { kind: 'feature', text: '插件可声明无需重载的配置字段；插件组合包可顺序加载多个 patch 文件。' },
      { kind: 'feature', text: '插件可通过 locale 声明多语言标题/描述，通过 package.json 声明图标。' },
    ],
  },
  {
    version: '0.1.6-alpha.2',
    date: '2026-09-17',
    changes: [
      { kind: 'breaking', text: '插件依赖解析模式调整为运行时解析，插件管理支持运行时卸载，请开发者检查插件加载和卸载逻辑。' },
      { kind: 'breaking', text: '客户端 Session 会话支持多实例共存，相关 API 及 slot 有变化。' },
      { kind: 'feature', text: '新增插件管理页，支持插件安装和修改配置，支持实时开启禁用插件。' },
    ],
  },
  {
    version: '0.1.6-alpha.1',
    date: '2026-09-15',
    changes: [
      { kind: 'breaking', text: '`agent/session-start` 改为异步串行的 `agent/created`，首次模型请求等待初始化完成，相关插件及注册调用需适配。' },
      { kind: 'breaking', text: '弃用 Session 的同步历史读取接口 `snapshotEvents`、`eventAt` 和 `ownEvents`。' },
      { kind: 'breaking', text: 'PTC 包名和服务名统一为 `ptc-runtime` 系列，旧名称不再兼容。' },
      { kind: 'breaking', text: '工作流执行器改为 `workflow-ptc`；Node PTC 改用独立进程，`process.env` 为空。' },
      { kind: 'breaking', text: '`SandboxProvider.confine` 和 `ShellExecutor.start` 改为可取消的异步接口；配置热更新取消事务回滚。' },
    ],
  },
]

/** release notes 原始链接。 */
export function releaseUrl(version) {
  return `${RELEASE_NOTES_BASE}dsh-v${version}`
}

/** 只看破坏性变更的扁平列表（面板的「版本内容」折叠区用）。 */
export function breakingChanges() {
  return VERSION_CONTENT.flatMap((entry) =>
    entry.changes
      .filter((change) => change.kind === 'breaking')
      .map((change) => ({ version: entry.version, date: entry.date, text: change.text })),
  )
}
