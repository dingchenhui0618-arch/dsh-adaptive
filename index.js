// dsh-adaptive 的宿主半区：识别运行时版本、读取 Profile 的版本例外、扫描插件兼容性，
// 提供 HTTP 面板入口与 agent 工具。全程只读：不改插件、不安装、不联网。
//
// 服务一律软读（ctx.get），这样在没有 webServer / tools / pluginManager 的环境里插件
// 依然能激活，只是少一个入口，而不是把整个 Profile 拖下水。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { isRuntimeVersion } from './src/compat.js'
import { renderMarkdown, statusText } from './src/report.js'
import { scanProfile } from './src/scan.js'
import { breakingChanges, VERSION_CONTENT } from './src/changelog.js'

export const inject = []

const TOOL_NAME = 'adaptive_report'
const ROUTE_PREFIX = '/dsh-adaptive'

const DEFAULT_CACHE_SECONDS = 15

function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function asSeconds(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 && number <= 3600 ? number : fallback
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  if (typeof res.setHeader === 'function') {
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
  }
  if (typeof res.writeHead === 'function') res.writeHead(status)
  res.end(body)
}

/** 从 pluginManager 的 bundle 列表里读“安装提供的”核心包版本。 */
async function detectRuntimeVersion(ctx) {
  const pluginManager = typeof ctx.get === 'function' ? ctx.get('pluginManager') : undefined
  if (pluginManager !== undefined && pluginManager !== null && typeof pluginManager.listBundles === 'function') {
    try {
      const bundles = await pluginManager.listBundles()
      const installed = (Array.isArray(bundles) ? bundles : []).filter(
        (bundle) => bundle !== null && typeof bundle === 'object' && bundle.availability === 'installation' && isRuntimeVersion(bundle.version),
      )
      const core =
        installed.find((bundle) => bundle.name === '@deepseek-ai/dsh-base') ??
        installed.find((bundle) => bundle.name === '@deepseek-ai/dsh-web-app') ??
        installed[0]
      if (core !== undefined) {
        return { version: core.version, source: `pluginManager.listBundles · ${core.name}` }
      }
    } catch {
      // 读不到就换下一条路径，不把异常抛给面板。
    }
  }
  // 退路：DSH 自己的运行时版本就是 app-boot 包的版本（见 app-boot/src/plugin-compatibility.ts）。
  try {
    const require = createRequire(import.meta.url)
    const entry = require.resolve('@deepseek-ai/dsh-app-boot')
    let directory = path.dirname(entry)
    for (let depth = 0; depth < 6; depth += 1) {
      const manifestPath = path.join(directory, 'package.json')
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
        if (manifest !== null && typeof manifest === 'object' && manifest.name === '@deepseek-ai/dsh-app-boot' && isRuntimeVersion(manifest.version)) {
          return { version: manifest.version, source: '@deepseek-ai/dsh-app-boot/package.json' }
        }
      } catch {
        // 继续向上找
      }
      const parent = path.dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  } catch {
    // 没有 app-boot 可解析（例如非桌面发行版），最终返回未识别。
  }
  return { version: undefined, source: undefined }
}

/**
 * 定位当前 Profile 目录。
 *
 * 宿主进程本身没有 `DSH_PROFILE_DIR`（那是给 shell 调用注入的），所以按可信度依次尝试：
 * 显式配置 → 环境变量 → `profileContext.packageManager.env` → `$DSH_HOME/profiles/*` 里
 * **装了本插件**的那个目录。最后一条是自证：能被加载，说明本插件就在那个 Profile 的
 * `node_modules` 里；多个都装了时按 `cordis.patch.yml` 的修改时间取最新，并在报告里注明来源。
 *
 * @returns {{directory?: string, source?: string, candidates?: string[]}}
 */
export function detectProfileDir(ctx, configured) {
  if (typeof configured === 'string' && configured.trim() !== '') {
    return { directory: path.resolve(configured), source: '插件配置 profileDir' }
  }
  const fromEnv = process.env.DSH_PROFILE_DIR
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return { directory: path.resolve(fromEnv), source: '环境变量 DSH_PROFILE_DIR' }
  }
  const profileContext = typeof ctx.get === 'function' ? ctx.get('profileContext') : undefined
  const fromContext = profileContext !== null && profileContext !== undefined && typeof profileContext === 'object'
    ? profileContext.packageManager?.env?.DSH_PROFILE_DIR
    : undefined
  if (typeof fromContext === 'string' && fromContext.trim() !== '') {
    return { directory: path.resolve(fromContext), source: 'profileContext.packageManager.env' }
  }

  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== '' ? process.env.DSH_HOME.trim() : path.join(os.homedir(), '.dsh')
  const profilesRoot = path.join(home, 'profiles')
  let entries = []
  try {
    entries = fs.readdirSync(profilesRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return {}
  }
  const candidates = []
  for (const name of entries) {
    const directory = path.join(profilesRoot, name)
    if (!fs.existsSync(path.join(directory, 'package.json'))) continue
    if (!fs.existsSync(path.join(directory, 'node_modules', 'dsh-adaptive', 'package.json'))) continue
    let mtime = 0
    for (const relative of ['cordis.patch.yml', 'package.json']) {
      try {
        mtime = Math.max(mtime, fs.statSync(path.join(directory, relative)).mtimeMs)
      } catch {
        // 缺文件不影响判定
      }
    }
    candidates.push({ directory, name, mtime })
  }
  if (candidates.length === 0) {
    const named = process.env.DSH_PROFILE
    if (typeof named === 'string' && named.trim() !== '') {
      const directory = path.join(profilesRoot, named.trim())
      if (fs.existsSync(path.join(directory, 'package.json'))) {
        return { directory, source: '环境变量 DSH_PROFILE（未在该 Profile 里找到本插件）' }
      }
    }
    return {}
  }
  candidates.sort((left, right) => right.mtime - left.mtime)
  const chosen = candidates[0]
  return {
    directory: chosen.directory,
    source: candidates.length === 1 ? '唯一安装本插件的 Profile' : `安装本插件的 Profile 中最近修改的一个（共 ${candidates.length} 个候选：${candidates.map((candidate) => candidate.name).join('、')}）`,
    candidates: candidates.map((candidate) => candidate.name),
  }
}

async function readExemptions(ctx) {
  const pluginManager = typeof ctx.get === 'function' ? ctx.get('pluginManager') : undefined
  if (pluginManager === undefined || pluginManager === null || typeof pluginManager.listVersionExemptions !== 'function') {
    return { available: false, exemptions: {}, warnings: [] }
  }
  try {
    const result = await pluginManager.listVersionExemptions()
    const exemptions = result !== null && typeof result === 'object' && typeof result.exemptions === 'object' && result.exemptions !== null ? result.exemptions : {}
    const warnings = result !== null && typeof result === 'object' && Array.isArray(result.warnings) ? result.warnings : []
    return { available: true, exemptions, warnings }
  } catch (error) {
    return { available: false, exemptions: {}, warnings: [String((error && error.message) || error)] }
  }
}

export function apply(ctx, config) {
  const settings = config !== null && typeof config === 'object' ? config : {}
  const configuredProfileDir = asNonEmptyString(settings.profileDir)
  const cacheSeconds = asSeconds(settings.cacheSeconds, DEFAULT_CACHE_SECONDS)
  const includeSources = settings.includeSources !== false

  const state = {
    report: null,
    at: 0,
    runtimeVersion: undefined,
    runtimeVersionSource: undefined,
    exemptions: { available: false, exemptions: {}, warnings: [] },
    pending: null,
    scans: 0,
    lastError: undefined,
  }

  // 服务就绪后用的上下文：比插件自己的 ctx 更晚就位，能读到 pluginManager 等服务。
  let runtimeCtx = ctx

  async function runScan() {
    const located = detectProfileDir(runtimeCtx, configuredProfileDir)
    if (located.directory === undefined) {
      throw new Error('定位不到当前 Profile 目录：没有配置 profileDir，没有 DSH_PROFILE_DIR，$DSH_HOME/profiles 下也找不到装了本插件的 Profile')
    }
    const runtime = await detectRuntimeVersion(runtimeCtx)
    const exceptions = await readExemptions(runtimeCtx)
    const report = scanProfile({
      profileDir: located.directory,
      runtimeVersion: runtime.version,
      exemptions: exceptions.exemptions,
      includeSources,
    })
    report.runtimeVersionSource = runtime.source
    report.profileDirSource = located.source
    report.exemptions = { available: exceptions.available, warnings: exceptions.warnings }
    state.report = report
    state.at = Date.now()
    state.runtimeVersion = runtime.version
    state.runtimeVersionSource = runtime.source
    state.exemptions = exceptions
    return report
  }

  /** 读报告；缓存过期或 force 时重扫。并发调用共享同一次扫描。 */
  async function getReport(force = false) {
    const fresh = state.report !== null && Date.now() - state.at < cacheSeconds * 1000
    if (fresh && !force) return state.report
    if (state.pending !== null) return state.pending
    state.pending = runScan()
      .then((report) => {
        state.scans += 1
        state.lastError = undefined
        return report
      })
      .catch((error) => {
        state.lastError = String((error && error.message) || error)
        throw error
      })
      .finally(() => {
        state.pending = null
      })
    return state.pending
  }

  // 自检：本插件自己的两个入口是否真的挂上了（面板页脚也显示这一条）。
  function selfCheck() {
    const tools = typeof runtimeCtx.get === 'function' ? runtimeCtx.get('tools') : undefined
    const toolRegistered = tools !== null && tools !== undefined && typeof tools.get === 'function' ? Boolean(tools.get(TOOL_NAME)) : undefined
    // 注册方式写进自检：一眼能看出「路由是等依赖就绪后挂上的」还是退化成旧的一次性读取。
    const registration = typeof ctx.inject === 'function' ? 'ctx.inject' : 'ctx.effect'
    return { toolRegistered, registration }
  }

  function payload(report) {
    return {
      ok: true,
      self: selfCheck(),
      runtimeVersion: report.runtimeVersion,
      runtimeVersionSource: report.runtimeVersionSource,
      profileDir: report.profileDir,
      profileDirSource: report.profileDirSource,
      generatedAt: report.generatedAt,
      scanMs: report.scanMs,
      summary: report.summary,
      plugins: report.plugins,
      exemptions: report.exemptions,
      versions: VERSION_CONTENT,
      breakingChanges: breakingChanges(),
      markdown: renderMarkdown(report),
    }
  }

  function compactReport(report, format, includeHints) {
    const plugins = report.plugins.map((plugin) => ({
      name: plugin.name,
      version: plugin.version,
      status: plugin.status,
      kind: plugin.kind,
      requirements: plugin.requirements,
      unmet: plugin.unmet,
      exempted: plugin.exempted,
      reasons: plugin.reasons,
      hints: includeHints ? plugin.hints : [],
    }))
    return {
      runtimeVersion: report.runtimeVersion,
      runtimeVersionSource: report.runtimeVersionSource,
      profileDir: report.profileDir,
      profileDirSource: report.profileDirSource,
      generatedAt: report.generatedAt,
      summary: report.summary,
      plugins,
      exemptions: report.exemptions,
    }
  }

  /**
   * 服务就绪后再注册。
   *
   * DSH 不保证 `webServer` / `tools` 在本插件之前激活：早期实现用 `ctx.effect()` 读一次
   * `ctx.get()`，读到 undefined 就直接跳过，之后再也不会重试——插件状态还是 active，
   * 面板却 404、工具也消失，从外面完全看不出原因（2026-10-21 在 0.2.1-rc.2 上实测踩到）。
   *
   * 现在改用 cordis 的 `ctx.inject(deps, cb)`：依赖就绪才执行，且随作用域自动清理。
   * 没有该 API 的旧环境退化成原来的一次性读取，行为不变。
   */
  function onService(names, register) {
    if (typeof ctx.inject === 'function') {
      ctx.inject(names, (scoped) => {
        runtimeCtx = scoped
        if (typeof scoped.effect === 'function') scoped.effect(() => register(scoped))
        else register(scoped)
      })
      return
    }
    ctx.effect(() => register(ctx))
  }

  // ---- 派发：把「适配到当前运行时」交给插件自己的会话 -------------------------
  // 面板只做诊断与派发，不在宿主里改代码：任务被送进「以该插件仓库为工作目录」的那个会话，
  // 由那个会话的 agent 自己去改、跑测试、提交。找不到对应会话就不新建（用户明确要求）。
  function adaptationTask(plugin, runtimeVersion) {
    const lines = [
      `把插件 \`${plugin.name}\`（${plugin.dir}）适配到当前 DSH 运行时 \`${runtimeVersion}\`。`,
      '',
      '## 当前判定',
      `- 状态：${plugin.status}${plugin.kind === 'none' ? '（未声明 engines.dsh / @deepseek-ai/dsh* peer）' : `（${plugin.kind}）`}`,
      `- 声明：${Object.keys(plugin.requirements || {}).length === 0 ? '无' : JSON.stringify(plugin.requirements)}`,
    ]
    if (Array.isArray(plugin.hints) && plugin.hints.length > 0) {
      lines.push('', '## 迁移提示（源码里仍在使用已变更接口）')
      for (const hint of plugin.hints) {
        lines.push(`- ${hint.title || hint.id}：${hint.advice || ''}`)
        for (const hit of hint.hits || []) lines.push(`  - \`${hit.path}:${hit.line}\` \`${hit.snippet || ''}\``)
      }
    }
    lines.push(
      '',
      '## 请做',
      '1. 对照 DSH 的 release notes 判断这个插件用到的接口有没有行为或签名变化（版本号对得上不等于能跑）。',
      '2. 按上面的提示逐处改代码，改完确认没有残留的弃用调用。',
      '3. 若 package.json 还没有 `engines.dsh`，补上 `>=0.2.1-rc.2 <0.3.0`，让宿主以后升级时能自己判定。',
      '4. 跑仓库里的测试，全部通过再提交。',
      '5. 提交并推送，最后用一句话汇报改了什么、测试结果、commit。',
    )
    return lines.join('\n')
  }

  const normalizePath = (value) => String(value ?? '').replace(/[\\/]+/g, '\\').replace(/\\+$/, '').toLowerCase()

  /**
   * 找出可能的「对应会话」。
   *
   * 你的会话大多挂在工作区根目录（例如 D:\\Projects），而不是每个仓库一个工作目录，
   * 所以先按精确 cwd 匹配，没有就退到「cwd 是插件目录的祖先」这一档，交给用户第一次点选一次，
   * 之后按选择记住（前端 localStorage）。不猜、不新建。
   */
  // 会话标题和插件名对得上，就是「这个插件自己的会话」——你的会话大多是这么命名的。
  const normalizeTitle = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')

  function candidateSessions(listed, dir, name) {
    const wanted = normalizePath(dir)
    const byName = normalizeTitle(name)
    const byDir = normalizeTitle(String(dir ?? '').split(/[\\/]/).pop())
    const bases = [byName, byDir].filter((value) => value !== '')
    const exact = []
    const titled = []
    const ancestor = []
    for (const item of listed.items || []) {
      if (item.origin === 'subagent' || item.parentSessionId !== undefined) continue
      if (typeof item.cwd !== 'string' || item.cwd === '') continue
      const cwd = normalizePath(item.cwd)
      const projectTitle = item.projections && item.projections.values ? item.projections.values.title : undefined
      const summary = {
        sessionId: item.sessionId,
        title: typeof projectTitle === 'string' ? projectTitle : (typeof item.title === 'string' ? item.title : ''),
        cwd: item.cwd,
        running: item.running === true,
        updatedAt: item.updatedAt || 0,
        blank: item.blank === true,
      }
      const title = normalizeTitle(summary.title)
      const named = title !== '' && bases.some((base) => title === base || title.includes(base))
      if (cwd === wanted) exact.push({ ...summary, exact: true, titleMatch: false })
      else if (named) titled.push({ ...summary, exact: false, titleMatch: true })
      else if (wanted.startsWith(cwd + '\\')) ancestor.push({ ...summary, exact: false, titleMatch: false })
    }
    const byActivity = (left, right) => (right.updatedAt || 0) - (left.updatedAt || 0)
    return exact.sort(byActivity).concat(titled.sort(byActivity), ancestor.sort(byActivity)).slice(0, 12)
  }

  async function listCandidateSessions(dir, name) {
    const controller = typeof runtimeCtx.get === 'function' ? runtimeCtx.get('sessionController') : undefined
    if (controller === undefined || controller === null || typeof controller.list !== 'function') {
      return { ok: false, error: { code: 'ENOSERVICE', message: '宿主没有暴露 sessionController，读不到会话列表' } }
    }
    const listed = await controller.list({}, new AbortController().signal)
    return { ok: true, dir, sessions: candidateSessions(listed, dir, name) }
  }

  async function dispatchAdaptation(name, sessionId) {
    const controller = typeof runtimeCtx.get === 'function' ? runtimeCtx.get('sessionController') : undefined
    if (controller === undefined || controller === null || typeof controller.prompt !== 'function') {
      return { ok: false, error: { code: 'ENOSERVICE', message: '宿主没有暴露 sessionController，无法把任务送进会话' } }
    }
    const report = await getReport(false)
    const plugin = report.plugins.find((item) => item.name === name)
    if (plugin === undefined) return { ok: false, error: { code: 'ENOTFOUND', message: `没有这个依赖：${name}` } }
    if (plugin.local !== true) {
      return { ok: false, error: { code: 'EEXTERNAL', message: `${name} 不是本机源码（link:）安装的，改不到它的源码` } }
    }
    const listed = await controller.list({}, new AbortController().signal)
    const candidates = candidateSessions(listed, plugin.dir, plugin.name)
    if (candidates.length === 0) {
      return { ok: false, error: { code: 'ESESSION', message: `没有以 ${plugin.dir}（或其上级目录）为工作目录的会话` } }
    }
    let target
    if (typeof sessionId === 'string' && sessionId !== '') {
      target = candidates.find((item) => item.sessionId === sessionId)
      if (target === undefined) {
        return { ok: false, error: { code: 'ESESSION', message: `会话 ${sessionId} 不在候选里（可能已归档）`, sessions: candidates } }
      }
    } else {
      target = candidates.find((item) => item.exact === true) ?? candidates.find((item) => item.titleMatch === true)
      if (target === undefined) {
        // 没有精确匹配：不擅自挑一个别的会话发任务，把候选交回去让用户点一次。
        return { ok: false, error: { code: 'ECHOOSE', message: '没有正好以这个仓库为工作目录的会话，选一个：', sessions: candidates } }
      }
    }
    const task = adaptationTask(plugin, report.runtimeVersion)
    await controller.prompt(
      {
        requestId: `adaptive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sessionId: target.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: task }],
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      new AbortController().signal,
    )
    return { ok: true, sessionId: target.sessionId, wasRunning: target.running === true, task }
  }

  // ---- HTTP：面板读写 -----------------------------------------------------
  onService(['webServer'], (scoped) => {
    const webServer = scoped.webServer ?? (typeof scoped.get === 'function' ? scoped.get('webServer') : undefined)
    if (webServer === undefined || webServer === null || typeof webServer.register !== 'function') return () => {}

    let disposeRoute
    try {
      disposeRoute = webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req, res) => {
          try {
            const url = new URL(req.url ?? '/', 'http://dsh.local')
            const suffix = url.pathname.slice(ROUTE_PREFIX.length).replace(/\/+$/, '') || '/'
            if (suffix === '/state' && (req.method === 'GET' || req.method === 'HEAD')) {
              const report = await getReport(url.searchParams.get('refresh') === '1')
              sendJson(res, 200, payload(report))
              return
            }
            if (suffix === '/scan' && req.method === 'POST') {
              const report = await getReport(true)
              sendJson(res, 200, payload(report))
              return
            }
            if (suffix === '/report.md' || suffix === '/report') {
              const report = await getReport(url.searchParams.get('refresh') === '1')
              const body = renderMarkdown(report)
              if (typeof res.setHeader === 'function') res.setHeader('content-type', 'text/markdown; charset=utf-8')
              if (typeof res.writeHead === 'function') res.writeHead(200)
              res.end(body)
              return
            }
            if (suffix === '/sessions' && (req.method === 'GET' || req.method === 'HEAD')) {
              const result = await listCandidateSessions(url.searchParams.get('dir') ?? '', url.searchParams.get('name') ?? '')
              sendJson(res, result.ok === true ? 200 : 400, result)
              return
            }
            if (suffix === '/dispatch' && req.method === 'POST') {
              const name = url.searchParams.get('name') ?? ''
              const session = url.searchParams.get('session') ?? ''
              const result = await dispatchAdaptation(name, session)
              sendJson(res, result.ok === true ? 200 : 400, result)
              return
            }
            sendJson(res, 404, { ok: false, error: { code: 'ENOTFOUND', message: `只提供 GET ${ROUTE_PREFIX}/state、POST ${ROUTE_PREFIX}/scan、POST ${ROUTE_PREFIX}/dispatch?name=<包名> 与 GET ${ROUTE_PREFIX}/report.md` } })
          } catch (error) {
            sendJson(res, 500, { ok: false, error: { code: 'EINTERNAL', message: String((error && error.message) || error) } })
          }
        },
      })
    } catch {
      disposeRoute = undefined
    }
    return () => {
      if (typeof disposeRoute === 'function') disposeRoute()
    }
  })

  // ---- agent 工具 --------------------------------------------------------
  onService(['tools'], (scoped) => {
    const tools = scoped.tools ?? (typeof scoped.get === 'function' ? scoped.get('tools') : undefined)
    if (tools === undefined || tools === null || typeof tools.register !== 'function') return () => {}

    let disposeTool
    try {
      disposeTool = tools.register({
        name: TOOL_NAME,
        description: [
          '自检当前 DSH 运行时版本，并扫描当前 Profile 里已安装插件的版本兼容性：',
          '按 DSH 自己的规则（engines.dsh 优先，否则检查 @deepseek-ai/dsh* peer，预发布参与比较）逐条判定，',
          '带上 Profile 里已授权的精确版本例外；同时用 release notes 摘出的规则做启发式静态扫描，指出源码里仍在使用已变更接口的位置。',
          '只读：不改插件、不安装、不联网。',
        ].join(''),
        parameters: {
          type: 'object',
          properties: {
            refresh: { type: 'boolean', description: '忽略缓存重新扫描，默认 false。' },
            format: { type: 'string', enum: ['json', 'markdown'], description: '返回结构化结果还是 Markdown 报告，默认 json。' },
            includeHints: { type: 'boolean', description: '是否包含迁移提示明细，默认 true。' },
          },
          required: [],
          additionalProperties: false,
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              runtimeVersion: { type: 'string' },
              runtimeVersionSource: { type: 'string' },
              profileDir: { type: 'string' },
              summary: { type: 'object' },
              plugins: { type: 'array' },
              markdown: { type: 'string' },
            },
          },
          render: (args, value) => {
            const result = value !== null && typeof value === 'object' ? value : {}
            const summary = result.summary !== null && typeof result.summary === 'object' ? result.summary : {}
            const head = [
              `运行时 ${String(result.runtimeVersion ?? '未识别')}${result.runtimeVersionSource ? `（${result.runtimeVersionSource}）` : ''}`,
              `${summary.total ?? 0} 个依赖 · 兼容 ${summary.ok ?? 0} · 未声明 ${summary.unversioned ?? 0} · 不兼容 ${summary.incompatible ?? 0} · 例外 ${summary.exempted ?? 0}`,
            ].join('\n')
            const lines = [head]
            for (const plugin of Array.isArray(result.plugins) ? result.plugins : []) {
              if (plugin.status !== 'incompatible' && plugin.status !== 'invalid') continue
              lines.push(`- ${plugin.name}${plugin.version ? `@${plugin.version}` : ''}：${statusText(plugin.status)} —— ${(plugin.reasons ?? []).join('；')}`)
            }
            if (result.markdown) lines.push('', String(result.markdown))
            return [{ type: 'text', text: lines.join('\n') }]
          },
        },
        timeoutMs: 60000,
        isConcurrencySafe: () => true,
        execute: async (args) => {
          const input = args !== null && typeof args === 'object' ? args : {}
          const report = await getReport(input.refresh === true)
          const includeHints = input.includeHints !== false
          const format = input.format === 'markdown' ? 'markdown' : 'json'
          // 工具返回值必须是无损 JSON：markdown 只在需要时挂上，不要留 undefined 字段。
          const result = compactReport(report, format, includeHints)
          if (format === 'markdown') result.markdown = renderMarkdown(report)
          return result
        },
      })
    } catch {
      disposeTool = undefined
    }
    return () => {
      if (typeof disposeTool === 'function') disposeTool()
    }
  })

  // 启动时预热一次：面板打开时通常已经能直接读到结果。
  getReport(false).catch(() => {
    // 预热失败不阻塞激活：面板与工具会各自报错。
  })
}
