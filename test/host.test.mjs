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
  return { webServer, tools, pluginManager, profileDir }
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
