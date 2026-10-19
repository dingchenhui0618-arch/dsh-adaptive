import test from 'node:test'
import assert from 'node:assert/strict'
import { compare, parseVersion, satisfies } from '../src/semver.js'

test('解析版本号与预发布标识', () => {
  const parsed = parseVersion('v0.2.1-rc.2+build.7')
  assert.equal(parsed.major, 0)
  assert.equal(parsed.minor, 2)
  assert.equal(parsed.patch, 1)
  assert.deepEqual(parsed.prerelease, ['rc', '2'])
  assert.deepEqual(parsed.build, ['build', '7'])
  assert.equal(parseVersion('0.2'), null)
  assert.equal(parseVersion('latest'), null)
})

test('预发布版本排序遵循 semver', () => {
  assert.equal(compare('0.2.1-rc.2', '0.2.1'), -1)
  assert.equal(compare('0.2.1-rc.10', '0.2.1-rc.2'), 1)
  assert.equal(compare('0.2.1-alpha.1', '0.2.1-rc.1'), -1)
  assert.equal(compare('0.2.1-rc.1', '0.2.1-rc.1'), 0)
  assert.equal(compare('1.0.0', '0.9.9'), 1)
  assert.equal(compare('bad', '1.0.0'), undefined)
})

test('caret 范围按 DSH 的 includePrerelease 语义参与比较', () => {
  assert.equal(satisfies('0.2.1-rc.2', '^0.2.1-rc.2'), true)
  assert.equal(satisfies('0.2.1', '^0.2.1-rc.2'), true)
  assert.equal(satisfies('0.2.1-rc.2', '^0.2.0'), true, '预发布版本不被门控掉')
  assert.equal(satisfies('0.2.1-rc.2', '^0.1.5-rc.1'), false)
  assert.equal(satisfies('0.3.0', '^0.2.1-rc.2'), false)
  assert.equal(satisfies('1.4.0', '^1.2.3'), true)
  assert.equal(satisfies('2.0.0', '^1.2.3'), false)
  assert.equal(satisfies('0.0.4', '^0.0.3'), false)
  assert.equal(satisfies('0.0.3', '^0.0.3'), true)
})

test('复杂范围：比较器、连字符、并集与通配', () => {
  assert.equal(satisfies('0.2.1-rc.2', '>=0.2.1-rc.2 <0.3.0'), true)
  assert.equal(satisfies('0.2.0-rc.2', '>=0.2.1-rc.2 <0.3.0'), false)
  assert.equal(satisfies('0.2.9', '>=0.2.1-rc.2 <0.3.0'), true)
  assert.equal(satisfies('0.3.0', '>=0.2.1-rc.2 <0.3.0'), false)
  assert.equal(satisfies('0.1.9', '0.1.6 - 0.2.1'), true)
  assert.equal(satisfies('0.2.1', '0.1.6 - 0.2.1'), true)
  assert.equal(satisfies('0.2.2', '0.1.6 - 0.2.1'), false)
  assert.equal(satisfies('0.2.1-rc.2', '^0.1.0 || ^0.2.0'), true)
  assert.equal(satisfies('0.4.0', '^0.1.0 || ^0.2.0'), false)
  assert.equal(satisfies('0.2.1-rc.2', '*'), true)
  assert.equal(satisfies('0.2.1-rc.2', 'x'), true)
  assert.equal(satisfies('0.2.1-rc.2', '0.2.x'), true)
  assert.equal(satisfies('0.3.0', '0.2.x'), false)
})

test('tilde 与关系比较器', () => {
  assert.equal(satisfies('0.2.1', '~0.2.1'), true)
  assert.equal(satisfies('0.2.9', '~0.2.1'), true)
  assert.equal(satisfies('0.3.0', '~0.2.1'), false)
  assert.equal(satisfies('0.2.0', '~0.2'), true)
  assert.equal(satisfies('0.2.1', '>=0.2'), true)
  assert.equal(satisfies('1.3.0', '>1.2'), true)
  assert.equal(satisfies('1.2.3', '>1.2'), false)
  assert.equal(satisfies('1.2.3', '<=1.2'), true)
  assert.equal(satisfies('1.3.0', '<=1.2'), false)
  assert.equal(satisfies('1.2.3', '<1.3'), true)
})

test('无法解析的范围返回 undefined 而不是猜成通过', () => {
  assert.equal(satisfies('0.2.1-rc.2', 'latest'), undefined)
  assert.equal(satisfies('0.2.1-rc.2', 'not-a-range'), undefined)
  assert.equal(satisfies('bad-version', '^0.2.0'), undefined)
})
