import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply, detectProfileDir, inject } from '../index.js'

function makeProfile() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-adaptive-host-'))
  const directory = path.join(root, 'node_modules', 'plugin-bad')
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'plugin-bad', version: '0.9.0', engines: { dsh: '^0.1.5-rc.1' } }))
  fs.writeFileSync(path.join(directory, 'index.js'), "ctx.on('agent/session-start', () => {})\n")
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'profile', dependencies: { 'plugin-bad': '*' } }))
  return root
}

function createContext(services) {
  const cleanups = []
  return {
    cleanups,
    get(name) {
      return services[name]
    },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') cleanups.push(dispose)
      return dispose
    },
  }
}

function createResponse() {
  const output = { status: 0, body: '', headers: {} }
  return {
    output,
    setHeader(name, value) { output.headers[name] = value },
    writeHead(status) { output.status = status },
    end(body) { output.body = body },
  }
}

function createServices(profileDir) {
  const webServer = {
    routes: [],
    register(route) {
      webServer.routes.push(route)
      return () => { route.disposed = true }
    },
  }
  const tools = {
    definitions: [],
    register(definition) {
      tools.definitions.push(definition)
      return () => { definition.disposed = true }
    },
  }
  const pluginManager = {
    async listBundles() {
      return [
        { name: 'some-third-party', availability: 'dependency', version: '9.9.9' },
        { name: '@deepseek-ai/dsh-base', availability: 'installation', version: '0.2.1-rc.2' },
      ]
    },
    async listVersionExemptions() {
      return { exemptions: { 'plugin-bad@0.9.0': ['0.1.5'] }, warnings: [] }
    },
  }
  const sessionController = {
    prompts: [],
    sessions: [],
    async list() {
      return { items: sessionController.sessions }
    },
    async prompt(request) {
      sessionController.prompts.push(request)
      return { accepted: true }
    },
  }
  return { webServer, tools, pluginManager, sessionController, profileDir }
}

test('宿主半区：注册路由与工具，并在面板接口上返回真实扫描结果', async () => {
  const profileDir = makeProfile()
  const previous = process.env.DSH_PROFILE_DIR
  process.env.DSH_PROFILE_DIR = profileDir
  try {
    const services = createServices(profileDir)
    const ctx = createContext(services)
    apply(ctx, {})

    assert.deepEqual(inject, [])
    assert.equal(services.webServer.routes.length, 1)
    assert.equal(services.webServer.routes[0].kind, 'prefix')
    assert.equal(services.webServer.routes[0].path, '/dsh-adaptive')
    assert.equal(services.tools.definitions.length, 1)
    assert.equal(services.tools.definitions[0].name, 'adaptive_report')

    const stateResponse = createResponse()
    await services.webServer.routes[0].handler({ method: 'GET', url: '/dsh-adaptive/state' }, stateResponse)
    assert.equal(stateResponse.output.status, 200)
    const state = JSON.parse(stateResponse.output.body)
    assert.equal(state.ok, true)
    assert.equal(state.runtimeVersion, '0.2.1-rc.2')
    assert.match(state.runtimeVersionSource, /pluginManager\.listBundles/)
    assert.equal(state.summary.total, 1)
    assert.equal(state.summary.incompatible, 1)
    assert.equal(state.plugins[0].status, 'incompatible')
    assert.match(state.markdown, /版本自适应 · DSH 插件兼容报告/)
    assert.ok(Array.isArray(state.versions) && state.versions.length > 0)

    const unknown = createResponse()
    await services.webServer.routes[0].handler({ method: 'GET', url: '/dsh-adaptive/nope' }, unknown)
    assert.equal(unknown.output.status, 404)

    const markdownResponse = createResponse()
    await services.webServer.routes[0].handler({ method: 'GET', url: '/dsh-adaptive/report.md' }, markdownResponse)
    assert.equal(markdownResponse.output.status, 200)
    assert.match(markdownResponse.output.body, /兼容矩阵/)

    const tool = services.tools.definitions[0]
    const result = await tool.execute({ format: 'markdown', includeHints: true })
    assert.equal(result.runtimeVersion, '0.2.1-rc.2')
    assert.match(result.markdown, /不兼容/)
    const rendered = tool.output.render({ format: 'markdown' }, result)
    assert.equal(rendered[0].type, 'text')
    assert.match(rendered[0].text, /运行时 0\.2\.1-rc\.2/)

    for (const cleanup of ctx.cleanups) cleanup()
    assert.equal(services.webServer.routes[0].disposed, true)
    assert.equal(services.tools.definitions[0].disposed, true)
  } finally {
    if (previous === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = previous
    fs.rmSync(profileDir, { recursive: true, force: true })
  }
})

test('宿主半区：服务晚于本插件就绪时，靠 ctx.inject 在就绪后补注册（2026-10-21 回归）', async () => {
  const profileDir = makeProfile()
  const previous = process.env.DSH_PROFILE_DIR
  process.env.DSH_PROFILE_DIR = profileDir
  try {
    const services = createServices(profileDir)
    const pending = []
    const cleanups = []
    const ctx = {
      // 关键：激活那一刻两个服务都还没就绪，旧实现读一次 ctx.get 就永远放弃。
      get: () => undefined,
      effect(fn) {
        const dispose = fn()
        if (typeof dispose === 'function') cleanups.push(dispose)
      },
      inject(deps, callback) {
        pending.push({ deps, callback })
      },
    }
    apply(ctx, {})
    assert.equal(services.webServer.routes.length, 0)
    assert.equal(services.tools.definitions.length, 0)
    assert.equal(pending.length, 2)

    const scoped = {
      webServer: services.webServer,
      tools: services.tools,
      get(name) {
        return services[name]
      },
      effect(fn) {
        const dispose = fn()
        if (typeof dispose === 'function') cleanups.push(dispose)
      },
    }
    for (const entry of pending) entry.callback(scoped)

    assert.equal(services.webServer.routes.length, 1)
    assert.equal(services.webServer.routes[0].path, '/dsh-adaptive')
    assert.equal(services.tools.definitions.length, 1)

    const response = createResponse()
    await services.webServer.routes[0].handler({ method: 'GET', url: '/dsh-adaptive/state' }, response)
    assert.equal(response.output.status, 200)
    const state = JSON.parse(response.output.body)
    assert.equal(state.ok, true)
    assert.equal(state.self.registration, 'ctx.inject')
    assert.equal(state.summary.total, 1)

    for (const cleanup of cleanups) cleanup()
    assert.equal(services.webServer.routes[0].disposed, true)
    assert.equal(services.tools.definitions[0].disposed, true)
  } finally {
    if (previous === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = previous
    fs.rmSync(profileDir, { recursive: true, force: true })
  }
})

test('宿主半区：派发把适配任务送进「以插件仓库为工作目录」的会话（2026-10-21）', async () => {
  const profileDir = makeProfile()
  const previous = process.env.DSH_PROFILE_DIR
  process.env.DSH_PROFILE_DIR = profileDir
  try {
    const pluginDir = path.join(profileDir, 'node_modules', 'plugin-bad')
    // link: 安装 = 本机源码，才允许把任务派回去。
    fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({ name: 'profile', dependencies: { 'plugin-bad': 'link:' + pluginDir } }))
    const services = createServices(profileDir)
    services.sessionController.sessions = [
      { sessionId: 'sess-other', cwd: 'D:\\elsewhere', updatedAt: 9, running: false },
      { sessionId: 'sess-target', cwd: pluginDir, updatedAt: 5, running: false },
    ]
    const ctx = createContext(services)
    apply(ctx, {})
    const route = services.webServer.routes[0]

    const response = createResponse()
    await route.handler({ method: 'POST', url: '/dsh-adaptive/dispatch?name=plugin-bad' }, response)
    assert.equal(response.output.status, 200)
    const body = JSON.parse(response.output.body)
    assert.equal(body.ok, true)
    assert.equal(body.sessionId, 'sess-target')
    assert.equal(services.sessionController.prompts.length, 1)
    const sent = services.sessionController.prompts[0]
    assert.equal(sent.sessionId, 'sess-target')
    assert.equal(sent.mode, 'queue')
    assert.equal(sent.content[0].type, 'text')
    assert.match(sent.content[0].text, /plugin-bad/)
    assert.match(sent.content[0].text, /engines\.dsh/)
    assert.match(sent.content[0].text, /0\.2\.1-rc\.2/)

    // 没有以该目录为工作目录的会话：不新建，直接报错让用户先去开会话。
    services.sessionController.sessions = [{ sessionId: 'sess-other', cwd: 'D:\\elsewhere', updatedAt: 9 }]
    const missing = createResponse()
    await route.handler({ method: 'POST', url: '/dsh-adaptive/dispatch?name=plugin-bad' }, missing)
    assert.equal(missing.output.status, 400)
    assert.equal(JSON.parse(missing.output.body).error.code, 'ESESSION')

    // 外部包（不是 link:）不能派发。
    fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({ name: 'profile', dependencies: { 'plugin-bad': '^0.9.0' } }))
    const rescan = createResponse()
    await route.handler({ method: 'POST', url: '/dsh-adaptive/scan' }, rescan)
    const external = createResponse()
    await route.handler({ method: 'POST', url: '/dsh-adaptive/dispatch?name=plugin-bad' }, external)
    assert.equal(external.output.status, 400)
    assert.equal(JSON.parse(external.output.body).error.code, 'EEXTERNAL')
  } finally {
    if (previous === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = previous
    fs.rmSync(profileDir, { recursive: true, force: true })
  }
})

test('宿主半区：没有精确匹配的会话时不擅自派发，把候选交回去由用户点选（2026-10-21）', async () => {
  const profileDir = makeProfile()
  const previous = process.env.DSH_PROFILE_DIR
  process.env.DSH_PROFILE_DIR = profileDir
  try {
    const pluginDir = path.join(profileDir, 'node_modules', 'plugin-bad')
    fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({ name: 'profile', dependencies: { 'plugin-bad': 'link:' + pluginDir } }))
    const services = createServices(profileDir)
    services.sessionController.sessions = [
      { sessionId: 'sess-recent', cwd: profileDir, updatedAt: 8 },
      { sessionId: 'sess-older', cwd: profileDir, updatedAt: 3 },
      { sessionId: 'sess-elsewhere', cwd: 'D:\\Other', updatedAt: 9 },
    ]
    const ctx = createContext(services)
    apply(ctx, {})
    const route = services.webServer.routes[0]

    // 候选：只有「上级目录」这一档，按活跃度排序，精确匹配为空。
    const listed = createResponse()
    await route.handler({ method: 'GET', url: '/dsh-adaptive/sessions?dir=' + encodeURIComponent(pluginDir) }, listed)
    assert.equal(listed.output.status, 200)
    const candidates = JSON.parse(listed.output.body).sessions
    assert.deepEqual(candidates.map((item) => item.sessionId), ['sess-recent', 'sess-older'])
    assert.equal(candidates[0].exact, false)

    // 不带 session 直接派发：拒绝并附候选，不写进任何会话。
    const choose = createResponse()
    await route.handler({ method: 'POST', url: '/dsh-adaptive/dispatch?name=plugin-bad' }, choose)
    assert.equal(choose.output.status, 400)
    const chooseBody = JSON.parse(choose.output.body)
    assert.equal(chooseBody.error.code, 'ECHOOSE')
    assert.equal(chooseBody.error.sessions.length, 2)
    assert.equal(services.sessionController.prompts.length, 0)

    // 指定 session 之后才真正入队。
    const sent = createResponse()
    await route.handler({ method: 'POST', url: '/dsh-adaptive/dispatch?name=plugin-bad&session=sess-older' }, sent)
    assert.equal(sent.output.status, 200)
    assert.equal(JSON.parse(sent.output.body).sessionId, 'sess-older')
    assert.equal(services.sessionController.prompts.length, 1)
    assert.equal(services.sessionController.prompts[0].sessionId, 'sess-older')
  } finally {
    if (previous === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = previous
    fs.rmSync(profileDir, { recursive: true, force: true })
  }
})

test('宿主半区：没有 webServer / tools 时仍能激活（软依赖）', async () => {
  const profileDir = makeProfile()
  const previous = process.env.DSH_PROFILE_DIR
  process.env.DSH_PROFILE_DIR = profileDir
  try {
    const ctx = createContext({})
    apply(ctx, {})
    assert.equal(ctx.cleanups.length, 2)
    for (const cleanup of ctx.cleanups) cleanup()
  } finally {
    if (previous === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = previous
    fs.rmSync(profileDir, { recursive: true, force: true })
  }
})

test('宿主半区：定位不到 Profile 时 /state 返回 500 而不是把插件拖崩', async () => {
  const previousProfile = process.env.DSH_PROFILE_DIR
  const previousProfileName = process.env.DSH_PROFILE
  const previousHome = process.env.DSH_HOME
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-adaptive-empty-home-'))
  delete process.env.DSH_PROFILE_DIR
  delete process.env.DSH_PROFILE
  process.env.DSH_HOME = emptyHome
  try {
    const services = createServices(undefined)
    const ctx = createContext(services)
    apply(ctx, {})
    const response = createResponse()
    await services.webServer.routes[0].handler({ method: 'GET', url: '/dsh-adaptive/state' }, response)
    assert.equal(response.output.status, 500)
    const body = JSON.parse(response.output.body)
    assert.equal(body.ok, false)
    assert.match(body.error.message, /Profile/)
  } finally {
    if (previousProfile !== undefined) process.env.DSH_PROFILE_DIR = previousProfile
    if (previousProfileName !== undefined) process.env.DSH_PROFILE = previousProfileName
    if (previousHome !== undefined) process.env.DSH_HOME = previousHome
    fs.rmSync(emptyHome, { recursive: true, force: true })
  }
})

test('detectProfileDir：显式配置与 DSH_PROFILE_DIR 优先', () => {
  const previousProfile = process.env.DSH_PROFILE_DIR
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-adaptive-home-'))
  try {
    assert.deepEqual(detectProfileDir({ get: () => undefined }, 'D:\\explicit'), {
      directory: path.resolve('D:\\explicit'),
      source: '插件配置 profileDir',
    })
    process.env.DSH_PROFILE_DIR = path.join(process.env.DSH_HOME, 'somewhere')
    assert.equal(detectProfileDir({ get: () => undefined }).source, '环境变量 DSH_PROFILE_DIR')
  } finally {
    if (previousProfile === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = previousProfile
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
})

test('detectProfileDir：宿主没有 DSH_PROFILE_DIR 时，靠「本插件装在哪个 Profile」自证', () => {
  const previousProfile = process.env.DSH_PROFILE_DIR
  const previousProfileName = process.env.DSH_PROFILE
  const previousHome = process.env.DSH_HOME
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-adaptive-home-'))
  const profilesRoot = path.join(home, 'profiles')
  for (const name of ['alpha', 'beta']) {
    fs.mkdirSync(path.join(profilesRoot, name), { recursive: true })
    fs.writeFileSync(path.join(profilesRoot, name, 'package.json'), JSON.stringify({ name: 'p', dependencies: {} }))
  }
  const betaModule = path.join(profilesRoot, 'beta', 'node_modules', 'dsh-adaptive')
  fs.mkdirSync(betaModule, { recursive: true })
  fs.writeFileSync(path.join(betaModule, 'package.json'), JSON.stringify({ name: 'dsh-adaptive', version: '0.1.0' }))
  delete process.env.DSH_PROFILE_DIR
  delete process.env.DSH_PROFILE
  process.env.DSH_HOME = home
  try {
    const located = detectProfileDir({ get: () => undefined })
    assert.equal(located.directory, path.join(profilesRoot, 'beta'))
    assert.match(located.source, /唯一安装本插件/)
    assert.deepEqual(located.candidates, ['beta'])
  } finally {
    if (previousProfile !== undefined) process.env.DSH_PROFILE_DIR = previousProfile
    if (previousProfileName !== undefined) process.env.DSH_PROFILE = previousProfileName
    if (previousHome !== undefined) process.env.DSH_HOME = previousHome
    fs.rmSync(home, { recursive: true, force: true })
  }
})
