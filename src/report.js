// 把扫描结果渲染成一段可以直接贴进 issue / 群聊的 Markdown。
// 只写报告里已有的事实；启发式命中一律标注「启发式」，不写成结论。

const STATUS_TEXT = {
  ok: '兼容',
  unversioned: '未声明版本约束',
  incompatible: '不兼容',
  exempted: '已授权例外',
  invalid: '清单无法判定',
  unreadable: '读不到',
}

export function statusText(status) {
  return STATUS_TEXT[status] ?? status
}

function declarationText(plugin) {
  const entries = Object.entries(plugin.requirements ?? {})
  if (entries.length === 0) return '（无）'
  return entries.map(([name, range]) => `${name} = ${range}`).join('<br>')
}

function escapeCell(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

/** @param {ReturnType<import('./scan.js').scanProfile>} report */
export function renderMarkdown(report) {
  const lines = []
  lines.push('# 版本自适应 · DSH 插件兼容报告')
  lines.push('')
  lines.push(`- 运行时版本：**${report.runtimeVersion ?? '未识别'}**${report.runtimeVersionSource ? `（来源：${report.runtimeVersionSource}）` : ''}`)
  lines.push(`- Profile：\`${report.profileDir ?? '未知'}\`${report.profileDirSource ? `（来源：${report.profileDirSource}）` : ''}`)
  lines.push(`- 生成时间：${report.generatedAt}（扫描耗时 ${report.scanMs} ms）`)
  const summary = report.summary
  lines.push(`- 覆盖：${summary.total} 个依赖 · 兼容 ${summary.ok} · 未声明 ${summary.unversioned} · 不兼容 ${summary.incompatible} · 已授权例外 ${summary.exempted} · 无法判定 ${summary.invalid} · 读不到 ${summary.unreadable} · 迁移提示 ${summary.hints}`)
  lines.push('')
  lines.push('## 兼容矩阵')
  lines.push('')
  lines.push('| 插件 | 版本 | 声明 | 状态 | 迁移提示 |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const plugin of report.plugins) {
    lines.push(`| ${escapeCell(plugin.name)} | ${escapeCell(plugin.version || '—')} | ${escapeCell(declarationText(plugin))} | ${statusText(plugin.status)} | ${plugin.hints.length} |`)
  }
  lines.push('')

  const problems = report.plugins.filter((plugin) => plugin.status === 'incompatible' || plugin.status === 'invalid')
  if (problems.length > 0) {
    lines.push('## 需要处理')
    lines.push('')
    for (const plugin of problems) {
      lines.push(`### ${plugin.name}${plugin.version ? `@${plugin.version}` : ''}`)
      for (const reason of plugin.reasons) lines.push(`- ${reason}`)
      if (plugin.status === 'incompatible') {
        lines.push(`- 处理方式：升级到与该运行时兼容的插件版本；确认风险后，也可对精确版本 \`${plugin.name}@${plugin.version}\` 在 ${report.runtimeVersion} 上授权例外（\`dsh plugin allow-version\` 或插件管理页）。`)
      }
      lines.push('')
    }
  }

  const unversioned = report.plugins.filter((plugin) => plugin.status === 'unversioned')
  if (unversioned.length > 0) {
    lines.push('## 未声明版本约束（DSH 当前按兼容处理）')
    lines.push('')
    lines.push('这些插件没有 `engines.dsh`，也没有 `@deepseek-ai/dsh*` 的 peerDependencies。DSH 不会拒绝它们，但升级后没有任何判据能提示风险。')
    lines.push('')
    for (const plugin of unversioned) lines.push(`- ${plugin.name}${plugin.version ? `@${plugin.version}` : ''}`)
    lines.push('')
  }

  const withHints = report.plugins.filter((plugin) => plugin.hints.length > 0)
  if (withHints.length > 0) {
    lines.push('## 迁移提示（启发式静态扫描）')
    lines.push('')
    lines.push('命中只说明源码里出现了该版本已经变更或弃用的接口名，不等于一定坏；没命中也不等于一定好。')
    lines.push('')
    for (const plugin of withHints) {
      lines.push(`### ${plugin.name}${plugin.version ? `@${plugin.version}` : ''}`)
      for (const hint of plugin.hints) {
        lines.push(`- **${hint.title}**（自 ${hint.since} 起）`)
        lines.push(`  - 位置：\`${hint.hits[0].path}:${hint.hits[0].line}\``)
        lines.push(`  - 建议：${hint.advice}`)
      }
      lines.push('')
    }
  }

  const advisories = report.plugins.filter((plugin) => (plugin.advisories ?? []).length > 0)
  if (advisories.length > 0) {
    lines.push('## 展示元数据建议')
    lines.push('')
    for (const plugin of advisories) {
      for (const advisory of plugin.advisories) lines.push(`- ${plugin.name}：${advisory}`)
    }
    lines.push('')
  }

  lines.push('---')
  lines.push('')
  lines.push('规则来源：DeepSeek Harness 官方 release notes 的 v0.1.6-alpha.1 → v0.2.1-rc.2 变更条目（PTC 改名、agent/created、Session V4、readBytes、maxInlineTokens、设置与预设迁移、版本兼容检查等）。')
  lines.push('兼容判定复刻 DSH 自己的规则：有 `engines.dsh` 时它单独决定，否则检查 `@deepseek-ai/dsh*` peer 范围，预发布参与比较，例外按精确 `name@version` → 运行时版本匹配。')
  lines.push('本报告只读：不修改任何插件、不安装、不联网。')
  return lines.join('\n') + '\n'
}
