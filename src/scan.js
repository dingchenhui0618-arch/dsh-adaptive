// 只读扫描：读当前 Profile 的依赖清单、每个插件的 package.json 与源码，
// 产出「版本 + 兼容矩阵 + 迁移提示」报告。不联网、不写文件、不改插件状态。
//
// 判定用 src/compat.js（复刻 DSH 自己的规则）；提示用 src/rules.js（release notes 摘出来的启发式）。

import fs from 'node:fs'
import path from 'node:path'
import { evaluatePlugin } from './compat.js'
import { scanFiles, summarizeHints } from './rules.js'

const MAX_FILES_PER_PLUGIN = 300
const MAX_BYTES_PER_PLUGIN = 2_000_000
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '.github', 'test', 'tests', '__tests__', 'coverage', 'dist', 'build', 'tmp', '_tmp', '.tmp', '.cache', 'debug', 'out'])
// 本插件自己：规则表里就写着这些接口名，扫自己只会自伤，跳过迁移提示。
const SELF_NAME = 'dsh-adaptive'

function readJson(filename) {
  try {
    return JSON.parse(fs.readFileSync(filename, 'utf8'))
  } catch {
    return undefined
  }
}

/** 解析 Profile 目录：优先显式配置，其次 DSH_PROFILE_DIR，最后按 DSH_HOME 推。 */
export function resolveProfileDir(explicit) {
  if (typeof explicit === 'string' && explicit.trim() !== '') return path.resolve(explicit)
  const fromEnv = process.env.DSH_PROFILE_DIR
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return path.resolve(fromEnv)
  const home = process.env.DSH_HOME
  if (typeof home === 'string' && home.trim() !== '') {
    const profile = process.env.DSH_PROFILE || 'desktop'
    return path.join(home, 'profiles', profile)
  }
  return undefined
}

/** 读 Profile 的 package.json 里的依赖名（保持顺序）。 */
export function readDependencyNames(profileDir) {
  const manifest = readJson(path.join(profileDir, 'package.json'))
  if (manifest === undefined || typeof manifest.dependencies !== 'object' || manifest.dependencies === null) return []
  return Object.keys(manifest.dependencies)
}

function listFiles(root, limits) {
  const found = []
  const queue = ['']
  while (queue.length > 0 && found.length < limits.files && limits.bytes < MAX_BYTES_PER_PLUGIN) {
    const relative = queue.shift()
    const absolute = relative === '' ? root : path.join(root, relative)
    let entries
    try {
      entries = fs.readdirSync(absolute, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue
        queue.push(childRelative)
        continue
      }
      if (!entry.isFile()) continue
      if (found.length >= limits.files || limits.bytes >= MAX_BYTES_PER_PLUGIN) break
      found.push(childRelative)
    }
  }
  return found
}

/** 读一个插件包的源码文件（有大小与数量上限），返回 [{path, text}]。 */
export function readPluginSources(packageDir) {
  const limits = { files: MAX_FILES_PER_PLUGIN, bytes: 0 }
  const files = []
  for (const relative of listFiles(packageDir, limits)) {
    if (!/\.(js|mjs|cjs|ts|tsx|jsx|json|yml|yaml)$/i.test(relative)) continue
    const absolute = path.join(packageDir, relative)
    let text
    try {
      const stat = fs.statSync(absolute)
      if (!stat.isFile() || stat.size > 400_000) continue
      limits.bytes += stat.size
      text = fs.readFileSync(absolute, 'utf8')
    } catch {
      continue
    }
    files.push({ path: relative, text })
  }
  return files
}

function packagingAdvisories(manifest) {
  const advisories = []
  const exportsField = manifest !== null && typeof manifest === 'object' && typeof manifest.exports === 'object' ? manifest.exports : {}
  const dsh = manifest !== null && typeof manifest === 'object' && typeof manifest.dsh === 'object' ? manifest.dsh : {}
  const hasIcon = typeof manifest?.icon === 'string' || Object.hasOwn(exportsField, './icon')
  const declaresLocale = Object.keys(exportsField).some((key) => key.startsWith('./locale/'))
  if (dsh?.bundle !== undefined && !hasIcon) advisories.push('没有导出图标（`icon` 字段或 `./icon`）：插件管理页会用默认图。')
  if (dsh?.bundle !== undefined && !declaresLocale) advisories.push('没有导出 `locale/*.json`：插件管理页拿不到本地化的标题与描述。')
  return advisories
}

/** 解析一个依赖在 Profile 里的真实包目录（`link:` 会解析到真实路径）。 */
export function resolvePackageDir(profileDir, name) {
  const candidate = path.join(profileDir, 'node_modules', ...name.split('/'))
  try {
    return fs.realpathSync(candidate)
  } catch {
    return undefined
  }
}

/**
 * 扫描整个 Profile。
 * @param {{profileDir:string, runtimeVersion:string, exemptions:Record<string,string[]>, includeSources?:boolean}} options
 */
export function scanProfile(options) {
  const { profileDir, runtimeVersion, exemptions = {}, includeSources = true } = options
  const startedAt = Date.now()
  const plugins = []
  let unreadable = 0

  for (const name of readDependencyNames(profileDir)) {
    const packageDir = resolvePackageDir(profileDir, name)
    const manifest = packageDir === undefined ? undefined : readJson(path.join(packageDir, 'package.json'))
    if (manifest === undefined) {
      unreadable += 1
      plugins.push({
        name,
        version: '',
        status: 'unreadable',
        kind: 'none',
        requirements: {},
        unmet: {},
        exempted: false,
        reasons: ['读不到 node_modules 里的 package.json（依赖没装或链接失效）'],
        advisories: [],
        hints: [],
      })
      continue
    }
    const evaluation = evaluatePlugin(manifest, runtimeVersion, exemptions)
    const advisories = packagingAdvisories(manifest)
    const hints = includeSources && evaluation.name !== SELF_NAME ? summarizeHints(scanFiles(readPluginSources(packageDir))) : []
    plugins.push({
      name: evaluation.name || name,
      version: evaluation.version || '',
      status: evaluation.status,
      kind: evaluation.kind,
      requirements: evaluation.requirements,
      unmet: evaluation.unmet,
      exempted: evaluation.exempted,
      reasons: evaluation.reasons,
      advisories,
      hints,
    })
  }

  plugins.sort((left, right) => {
    const order = { incompatible: 0, invalid: 1, exempted: 2, unversioned: 3, ok: 4, unreadable: 5 }
    const difference = (order[left.status] ?? 9) - (order[right.status] ?? 9)
    return difference !== 0 ? difference : left.name.localeCompare(right.name)
  })

  const summary = {
    total: plugins.length,
    ok: plugins.filter((plugin) => plugin.status === 'ok').length,
    unversioned: plugins.filter((plugin) => plugin.status === 'unversioned').length,
    incompatible: plugins.filter((plugin) => plugin.status === 'incompatible').length,
    exempted: plugins.filter((plugin) => plugin.status === 'exempted').length,
    invalid: plugins.filter((plugin) => plugin.status === 'invalid').length,
    unreadable,
    hints: plugins.reduce((total, plugin) => total + plugin.hints.length, 0),
  }

  return {
    generatedAt: new Date().toISOString(),
    runtimeVersion,
    profileDir,
    summary,
    plugins,
    scanMs: Date.now() - startedAt,
    scope: {
      includeSources,
      maxFilesPerPlugin: MAX_FILES_PER_PLUGIN,
    },
  }
}
