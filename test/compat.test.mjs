import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluatePlugin, readDeclaration, isRuntimeVersion } from '../src/compat.js'

const RUNTIME = '0.2.1-rc.2'

test('有 engines.dsh 时它单独决定，peerDependencies 被忽略', () => {
  const manifest = {
    name: 'a',
    version: '1.0.0',
    engines: { dsh: '^0.1.0' },
    peerDependencies: { '@deepseek-ai/dsh-base': '^0.2.0' },
  }
  const result = evaluatePlugin(manifest, RUNTIME)
  assert.equal(result.status, 'incompatible')
  assert.deepEqual(Object.keys(result.unmet), ['engines.dsh'])
})

test('engines.dsh 满足时即使 peer 不满足也算兼容', () => {
  const manifest = {
    name: 'a',
    version: '1.0.0',
    engines: { dsh: '>=0.2.1-rc.2 <0.3.0' },
    peerDependencies: { '@deepseek-ai/dsh-base': '^0.1.0' },
  }
  assert.equal(evaluatePlugin(manifest, RUNTIME).status, 'ok')
})

test('没有 engines 时逐个检查 @deepseek-ai/dsh* peer', () => {
  const ok = evaluatePlugin({
    name: 'a',
    version: '1.0.0',
    peerDependencies: {
      '@deepseek-ai/dsh-base': '^0.2.1-rc.2',
      '@deepseek-ai/dsh-session': 'workspace:^',
      react: '^18.0.0',
    },
  }, RUNTIME)
  assert.equal(ok.status, 'ok', '非 dsh 的 peer 不参与判定')
  assert.deepEqual(Object.keys(ok.requirements).sort(), ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-session'])

  const bad = evaluatePlugin({
    name: 'a',
    version: '1.0.0',
    peerDependencies: {
      '@deepseek-ai/dsh-base': '^0.1.0',
      '@deepseek-ai/dsh-session': '^0.1.5-rc.1',
    },
  }, RUNTIME)
  assert.equal(bad.status, 'incompatible')
  assert.deepEqual(Object.keys(bad.unmet).sort(), ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-session'])
})

test('peer 用 workspace: 协议时指向当前运行时', () => {
  for (const range of ['workspace:^', 'workspace:~', 'workspace:*']) {
    const result = evaluatePlugin({ name: 'a', version: '1.0.0', peerDependencies: { '@deepseek-ai/dsh': range } }, RUNTIME)
    assert.equal(result.status, 'ok', range)
  }
})

test('没有声明任何版本约束时标为 unversioned，而不是不兼容', () => {
  const result = evaluatePlugin({ name: 'a', version: '1.0.0' }, RUNTIME)
  assert.equal(result.status, 'unversioned')
  assert.equal(result.kind, 'none')
})

test('精确版本例外只在匹配的运行时上生效', () => {
  const manifest = { name: 'a', version: '0.0.9', engines: { dsh: '^0.1.0' } }
  const active = evaluatePlugin(manifest, RUNTIME, { 'a@0.0.9': [RUNTIME] })
  assert.equal(active.status, 'exempted')
  assert.equal(active.exempted, true)
  const otherRuntime = evaluatePlugin(manifest, RUNTIME, { 'a@0.0.9': ['0.1.6-alpha.1'] })
  assert.equal(otherRuntime.status, 'incompatible')
})

test('空 engines.dsh 在 DSH 里判为未满足', () => {
  const result = evaluatePlugin({ name: 'a', version: '1.0.0', engines: { dsh: ' ' } }, RUNTIME)
  assert.equal(result.status, 'incompatible')
  assert.deepEqual(result.unmet, { 'engines.dsh': ' ' })
})

test('畸形清单返回 invalid 而不是抛异常', () => {
  const badEngines = evaluatePlugin({ name: 'a', version: '1.0.0', engines: { dsh: 7 } }, RUNTIME)
  assert.equal(badEngines.status, 'invalid')
  const badPeers = evaluatePlugin({ name: 'a', version: '1.0.0', peerDependencies: { '@deepseek-ai/dsh-base': 3 } }, RUNTIME)
  assert.equal(badPeers.status, 'invalid')
  const entries = evaluatePlugin({ name: 'a' }, RUNTIME)
  assert.equal(entries.status, 'unversioned')
})

test('readDeclaration 只挑 dsh 的 peer 名字', () => {
  const declaration = readDeclaration({
    name: 'a',
    version: '1.0.0',
    peerDependencies: { react: '^18', '@deepseek-ai/dsh-base': '^0.2.0', '@deepseek-ai/other': '^1' },
  })
  assert.equal(declaration.kind, 'peers')
  assert.deepEqual(Object.keys(declaration.requirements), ['@deepseek-ai/dsh-base'])
})

test('运行时版本合法性判定', () => {
  assert.equal(isRuntimeVersion('0.2.1-rc.2'), true)
  assert.equal(isRuntimeVersion('0.2'), false)
  assert.equal(isRuntimeVersion(undefined), false)
})
