// 从 DSH 真实 release notes 里摘出来的「插件会踩到的破坏性变更」，加上可执行的静态检测。
//
// 每条的 since 是 release notes 里出现该变更的版本（不是我的推测）：
//   - v0.1.6-alpha.1   PTC 包名/服务名统一、agent/session-start→agent/created、
//                      Session 同步历史接口弃用、Node PTC 独立进程（process.env 为空）
//   - v0.1.6-alpha.2   插件依赖运行时解析、可运行时卸载（要写拆除逻辑）
//   - v0.1.7-alpha.1   Session 日志 V4、工作区读取改 readBytes、Agent 预设改由插件包声明、
//                      设置改存 Profile 插件配置、locale/icon 进包、插件组合包可多 patch
//   - v0.1.7-alpha.2   spill-policy 的 maxInlineBytes→maxInlineTokens
//   - v0.1.7-rc.1      安装/启动检查插件与 DSH 版本兼容性，可按精确版本授权例外
//
// 检测是**启发式静态扫描**：命中只说明源码里出现了该版本已经变更或弃用的接口名，
// 不等于一定坏；没命中也不等于一定好。报告里的措辞必须保留这个边界。

export const BREAKING_CHANGES = [
  {
    id: 'agent-session-start',
    since: '0.1.6-alpha.1',
    kind: 'api',
    title: 'agent/session-start 改为异步串行的 agent/created',
    advice: '改听 `agent/created`；首次模型请求会等待初始化完成，注册逻辑要能处理异步。',
    patterns: [/['"`]agent\/session-start['"`]/],
  },
  {
    id: 'session-sync-history',
    since: '0.1.6-alpha.1',
    kind: 'api',
    title: 'Session 同步历史读取接口已弃用',
    advice: '`snapshotEvents` / `eventAt` / `ownEvents` 已弃用；改用投影（sessionProjections）或会话查询服务。',
    patterns: [/\.(snapshotEvents|eventAt|ownEvents)\s*\(/],
  },
  {
    id: 'ptc-package-rename',
    since: '0.1.6-alpha.1',
    kind: 'api',
    title: 'PTC 包名与服务名统一为 ptc-runtime 系列',
    advice: '旧 PTC 包名/服务名不再兼容；换成 `ptc-runtime` 系列的名字。',
    patterns: [/@deepseek-ai\/dsh-ptc-(?!runtime)/, /\bdsh-ptc-(?!runtime)[a-z-]*/],
  },
  {
    id: 'workflow-executor-rename',
    since: '0.1.6-alpha.1',
    kind: 'config',
    title: '工作流执行器改为 workflow-ptc',
    advice: '自定义配置里的工作流执行器名称要改；旧名不生效，Python PTC 暂不支持。',
    patterns: [/['"`]workflow-engine['"`]/, /['"`]workflow-executor['"`]/],
  },
  {
    id: 'settings-yaml',
    since: '0.1.7-alpha.1',
    kind: 'config',
    title: '设置改存当前 Profile 的插件配置',
    advice: '`settings.yaml` 只在升级时导入一次；自定义设置插件改用 Profile 插件配置与可免重载字段。',
    patterns: [/settings\.yaml/],
  },
  {
    id: 'legacy-agent-presets',
    since: '0.1.7-alpha.1',
    kind: 'config',
    title: 'Agent 预设改由插件组合包声明',
    advice: '旧的目录式 Agent 预设需要迁移成插件组合包声明。',
    patterns: [/\.agent-presets/, /agent-presets\//],
  },
  {
    id: 'workspace-read-text',
    since: '0.1.7-alpha.1',
    kind: 'api',
    title: '工作区文件读取统一为 readBytes',
    advice: '旧文本读取接口按字节读取；读文本请自行解码，并处理非 UTF-8 内容。',
    patterns: [/\.readText\s*\(/],
  },
  {
    id: 'spill-max-inline-bytes',
    since: '0.1.7-alpha.2',
    kind: 'config',
    title: 'spill-policy 的 maxInlineBytes 改为 maxInlineTokens',
    advice: '旧字段被忽略；改成 `maxInlineTokens`，预算单位是 token。',
    patterns: [/maxInlineBytes/],
  },
  {
    id: 'append-plugin-record',
    since: '0.1.7-alpha.1',
    kind: 'api',
    title: 'plugin: 记录只做尽力保留',
    advice: '`appendPluginRecord()` 写入的 `plugin:` 记录在会话格式迁移时只做尽力保留；关键状态不要只存在这里。',
    patterns: [/appendPluginRecord\s*\(/],
  },
  {
    id: 'deepseek-protocol',
    since: '0.1.6-alpha.1',
    kind: 'config',
    title: '官方 DeepSeek 适配器只用 Messages API',
    advice: '旧的 `protocol` 配置和 Chat Completions 根地址需要迁移；自定义 API 地址不受影响。',
    patterns: [/['"`]protocol['"`]\s*:\s*['"`](chat|completions|openai)['"`]/, /chat\/completions/, /api\.deepseek\.com\/v1\/chat/],
  },
]

const SCANNED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.yml', '.yaml'])
const SKIPPED_DIRECTORIES = new Set([
  'node_modules', '.git', '.github', 'test', 'tests', '__tests__', 'coverage',
  'dist', 'build', 'tmp', '_tmp', '.tmp', '.cache', 'debug', 'out',
])

/** 判断相对路径是否属于要扫描的插件源码/配置。 */
export function isScannable(relativePath) {
  const lower = relativePath.toLowerCase()
  if (lower.split('/').some((segment) => SKIPPED_DIRECTORIES.has(segment))) return false
  const dot = lower.lastIndexOf('.')
  return dot !== -1 && SCANNED_EXTENSIONS.has(lower.slice(dot))
}

/**
 * 在一段文本里找命中。
 * @param relativePath 报告里展示的路径（包内相对路径）
 * @returns {{id:string, since:string, kind:string, title:string, advice:string, path:string, line:number, snippet:string}[]}
 */
export function scanText(relativePath, text) {
  const hints = []
  if (typeof text !== 'string' || text.length === 0) return hints
  const lines = text.split('\n')
  for (const rule of BREAKING_CHANGES) {
    let matched = false
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (!rule.patterns.some((pattern) => pattern.test(line))) continue
      // 同一规则同一文件只报第一处，避免一个 import 出现十行。
      if (matched) break
      matched = true
      hints.push({
        id: rule.id,
        since: rule.since,
        kind: rule.kind,
        title: rule.title,
        advice: rule.advice,
        path: relativePath,
        line: index + 1,
        snippet: line.trim().slice(0, 180),
      })
    }
  }
  return hints
}

/**
 * 扫描一个插件的多个文件。
 * @param files {{path:string, text:string}[]}
 */
export function scanFiles(files) {
  const hints = []
  for (const file of files) {
    if (!isScannable(file.path)) continue
    hints.push(...scanText(file.path, file.text))
  }
  return hints
}

/** 汇总命中，给面板用：每条规则出现在多少个文件、哪些版本变更。 */
export function summarizeHints(hints) {
  const byRule = new Map()
  for (const hint of hints) {
    const entry = byRule.get(hint.id) ?? {
      id: hint.id,
      since: hint.since,
      kind: hint.kind,
      title: hint.title,
      advice: hint.advice,
      hits: [],
    }
    entry.hits.push({ path: hint.path, line: hint.line, snippet: hint.snippet })
    byRule.set(hint.id, entry)
  }
  return [...byRule.values()]
}
