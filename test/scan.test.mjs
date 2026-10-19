import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scanProfile, resolveProfileDir, readDependencyNames } from '../src/scan.js'
import { renderMarkdown } from '../src/report.js'
import { isScannable, scanText, scanFiles, summarizeHints } from '../src/rules.js'

function makeProfile(entries) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-adaptive-'))
  const dependencies = {}
  for (const entry of entries) {
    dependencies[entry.name] = '*'
    if (entry.unreadable) continue
    const directory = path.join(root, 'node_modules', ...entry.name.split('/'))
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(entry.manifest ?? { name: entry.name, version: '1.0.0' }))
    for (const [relative, content] of Object.entries(entry.files ?? {})) {
      const target = path.join(directory, relative)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, content)
    }
  }
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'profile', dependencies }))
  return root
}

test('扫描 Profile：兼容 / 不兼容 / 未声明 / 读不到 各归各位', () => {
  const profileDir = makeProfile([
    {
      name: 'plugin-ok',
      manifest: { name: 'plugin-ok', version: '1.2.0', engines: { dsh: '>=0.2.1-rc.2 <0.3.0' } },
      files: { 'index.js': 'export function apply() {}\n' },
    },
    {
      name: 'plugin-bad',
      manifest: { name: 'plugin-bad', version: '0.9.0', engines: { dsh: '^0.1.5-rc.1' } },
      files: { 'index.js': "ctx.on('agent/session-start', () => {})\n" },
    },
    {
      name: 'plugin-bare',
      manifest: { name: 'plugin-bare', version: '2.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } },
    },
    { name: 'plugin-missing', unreadable: true },
  ])

  const report = scanProfile({ profileDir, runtimeVersion: '0.2.1-rc.2' })
  assert.equal(report.runtimeVersion, '0.2.1-rc.2')
  assert.equal(report.summary.total, 4)
  assert.equal(report.summary.ok, 1)
  assert.equal(report.summary.incompatible, 1)
  assert.equal(report.summary.unversioned, 1)
  assert.equal(report.summary.unreadable, 1)
  assert.ok(report.scanMs >= 0)

  const bad = report.plugins.find((plugin) => plugin.name === 'plugin-bad')
  assert.equal(bad.status, 'incompatible')
  assert.deepEqual(Object.keys(bad.unmet), ['engines.dsh'])
  assert.equal(bad.hints.length, 1, '应识别出 agent/session-start')
  assert.equal(bad.hints[0].id, 'agent-session-start')

  const ok = report.plugins.find((plugin) => plugin.name === 'plugin-ok')
  assert.equal(ok.status, 'ok')
  assert.deepEqual(ok.hints, [])

  const bare = report.plugins.find((plugin) => plugin.name === 'plugin-bare')
  assert.equal(bare.status, 'unversioned')
  assert.ok(bare.advisories.length >= 1, '未导出图标/locale 时应给出展示元数据建议')

  fs.rmSync(profileDir, { recursive: true, force: true })
})

test('例外从调用方传入，按精确 name@version 生效', () => {
  const profileDir = makeProfile([
    { name: 'plugin-bad', manifest: { name: 'plugin-bad', version: '0.9.0', engines: { dsh: '^0.1.5-rc.1' } } },
  ])
  const without = scanProfile({ profileDir, runtimeVersion: '0.2.1-rc.2' })
  assert.equal(without.summary.exempted, 0)
  assert.equal(without.summary.incompatible, 1)
  const withExemption = scanProfile({ profileDir, runtimeVersion: '0.2.1-rc.2', exemptions: { 'plugin-bad@0.9.0': ['0.2.1-rc.2'] } })
  assert.equal(withExemption.summary.exempted, 1)
  assert.equal(withExemption.summary.incompatible, 0)
  fs.rmSync(profileDir, { recursive: true, force: true })
})

test('includeSources=false 时不读源码，也没有迁移提示', () => {
  const profileDir = makeProfile([
    { name: 'p', manifest: { name: 'p', version: '1.0.0' }, files: { 'index.js': 'maxInlineBytes: 1000\n' } },
  ])
  const report = scanProfile({ profileDir, runtimeVersion: '0.2.1-rc.2', includeSources: false })
  assert.equal(report.summary.hints, 0)
  assert.deepEqual(report.plugins[0].hints, [])
  fs.rmSync(profileDir, { recursive: true, force: true })
})

test('Profile 目录解析：显式配置优先于环境变量', () => {
  assert.equal(resolveProfileDir('D:\\x'), path.resolve('D:\\x'))
  assert.deepEqual(readDependencyNames(path.join(os.tmpdir(), 'no-such-profile-dir')), [])
})

test('Markdown 报告包含关键段落，并如实标注启发式', () => {
  const profileDir = makeProfile([
    { name: 'plugin-bad', manifest: { name: 'plugin-bad', version: '0.9.0', engines: { dsh: '^0.1.5-rc.1' } }, files: { 'index.js': 'maxInlineBytes\n' } },
    { name: 'plugin-bare', manifest: { name: 'plugin-bare', version: '2.0.0' } },
  ])
  const report = scanProfile({ profileDir, runtimeVersion: '0.2.1-rc.2' })
  const markdown = renderMarkdown(report)
  assert.match(markdown, /兼容矩阵/)
  assert.match(markdown, /需要处理/)
  assert.match(markdown, /未声明版本约束/)
  assert.match(markdown, /启发式静态扫描/)
  assert.match(markdown, /maxInlineBytes/)
  assert.doesNotMatch(markdown, /undefined/)

  const cleanReport = scanProfile({ profileDir, runtimeVersion: '0.2.1-rc.2', includeSources: false })
  assert.doesNotMatch(renderMarkdown(cleanReport), /迁移提示（启发式静态扫描）/)
  fs.rmSync(profileDir, { recursive: true, force: true })
})

test('规则扫描：可扫描的扩展名与目录过滤', () => {
  assert.equal(isScannable('index.js'), true)
  assert.equal(isScannable('cordis.patch.yml'), true)
  assert.equal(isScannable('node_modules/x/index.js'), false)
  assert.equal(isScannable('test/foo.test.mjs'), false)
  assert.equal(isScannable('icon.svg'), false)
})

test('规则命中：同一条规则同一文件只报一处，并带行号与代码片段', () => {
  const hints = scanText('index.js', [
    "import x from 'y'",
    "ctx.on('agent/session-start', () => {})",
    "ctx.on('agent/session-start', () => {})",
  ].join('\n'))
  assert.equal(hints.length, 1)
  assert.equal(hints[0].line, 2)
  assert.equal(hints[0].snippet, "ctx.on('agent/session-start', () => {})")

  const summarized = summarizeHints(scanFiles([{ path: 'a.js', text: 'const x = { maxInlineBytes: 1 }\n' }, { path: 'b.js', text: '.snapshotEvents()\n' }]))
  assert.deepEqual(summarized.map((entry) => entry.id).sort(), ['session-sync-history', 'spill-max-inline-bytes'])
  assert.equal(summarized.find((entry) => entry.id === 'spill-max-inline-bytes').since, '0.1.7-alpha.2')
})
