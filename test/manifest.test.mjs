import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { satisfies } from '../src/semver.js'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

test('清单：bundle + client 两半齐全，且声明了 engines.dsh', () => {
  assert.equal(manifest.name, 'dsh-adaptive')
  assert.equal(manifest.type, 'module')
  assert.equal(typeof manifest.dsh.bundle.patch, 'string')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.ok(Array.isArray(manifest.dsh.client.inject))
  assert.match(manifest.engines.dsh, /0\.2\.1/)
  assert.equal(satisfies('0.2.1-rc.2', manifest.engines.dsh), true)
  assert.equal(satisfies('0.3.0', manifest.engines.dsh), false)
})

test('清单：导出与 files 覆盖所有运行期需要的文件', () => {
  assert.equal(manifest.exports['.'], './index.js')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.ok(Object.keys(manifest.exports).some((key) => key === './locale/*.json'))
  for (const relative of ['index.js', 'client.js', 'icon.svg', 'cordis.patch.yml', 'locale/en.json', 'locale/zh.json']) {
    assert.ok(fs.existsSync(path.join(root, relative)), relative)
    assert.ok(fs.statSync(path.join(root, relative)).size > 0, relative)
  }
})

test('cordis.patch.yml：插入自身一行且 id/name 一致', () => {
  const patch = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /insert:/)
  assert.match(patch, /id:\s*dsh-adaptive/)
  assert.match(patch, /name:\s*dsh-adaptive/)
})

test('客户端半区：loader 格式与 slot 注册符合契约', () => {
  const client = fs.readFileSync(path.join(root, 'client.js'), 'utf8')
  assert.match(client, /__ModuleLoader__\.load\(\{/)
  assert.match(client, /id:\s*'dsh-adaptive'/)
  assert.match(client, /factory\(require\)/)
  assert.match(client, /require\('react'\)/)
  assert.match(client, /inject:\s*\['slots'\]/)
  assert.match(client, /ctx\.slots\.inject\('conversation\.view'/)
  assert.match(client, /name:\s*'conversation\.view'/)
  assert.match(client, /label:\s*'版本自适应'/)
  assert.doesNotMatch(client, /@deepseek-ai\/dsh-client-ui-primitives/, '面板自绘控件，不依赖私有 UI 包')
})

test('展示元数据：图标与中英 locale 都可用', () => {
  assert.equal(manifest.icon, './icon.svg')
  const icon = fs.readFileSync(path.join(root, 'icon.svg'), 'utf8')
  assert.match(icon, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.match(icon, /viewBox="0 0 64 64"/)
  assert.ok(Buffer.byteLength(icon, 'utf8') <= 256 * 1024, '图标不超过 256 KiB')
  for (const language of ['en', 'zh']) {
    const locale = JSON.parse(fs.readFileSync(path.join(root, 'locale', `${language}.json`), 'utf8'))
    assert.equal(typeof locale.meta.title, 'string')
    assert.ok(locale.meta.title.length > 0)
    assert.equal(typeof locale.meta.description, 'string')
    assert.ok(locale.meta.description.length > 20)
  }
})
