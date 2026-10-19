// 复刻 DSH 自己的插件兼容判据（packages/boot/app-boot/src/plugin-compatibility.ts）：
//   - 有 `engines.dsh` 时它单独决定，忽略 peerDependencies；
//   - 否则检查每一个 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` peer 的范围；
//   - peer 写 `workspace:^` / `workspace:~` / `workspace:*` 视为“当前运行时版本”；
//   - 预发布版本参与范围比较（includePrerelease）；
//   - 例外按精确 `name@version` → 允许的运行时版本列表判定。
//
// 这个模块只做判定，不读文件、不碰服务，便于单测。

import { parseVersion, satisfies } from './semver.js'

const WORKSPACE_RANGES = new Set(['workspace:^', 'workspace:~', 'workspace:*'])

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function dshPeerNames(peers) {
  return Object.keys(peers).filter((name) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
}

/**
 * 读清单里的版本约束声明，不判断是否满足。
 * @returns {{kind: 'engines'|'peers'|'none', engines?: string, peers?: Record<string,string>, requirements: Record<string,string>}}
 */
export function readDeclaration(manifest) {
  const fields = isPlainObject(manifest) ? manifest : {}
  const engines = isPlainObject(fields.engines) ? fields.engines : {}
  if (Object.hasOwn(engines, 'dsh')) {
    const range = engines.dsh
    if (typeof range !== 'string') {
      return { kind: 'engines', requirements: {}, invalid: 'engines.dsh 必须是字符串' }
    }
    return { kind: 'engines', engines: range, requirements: { 'engines.dsh': range } }
  }
  const peers = isPlainObject(fields.peerDependencies) ? fields.peerDependencies : {}
  const names = dshPeerNames(peers)
  if (names.length === 0) return { kind: 'none', requirements: {} }
  const requirements = {}
  for (const name of names) {
    const range = peers[name]
    if (typeof range !== 'string') return { kind: 'peers', requirements: {}, invalid: `peerDependencies["${name}"] 必须是字符串` }
    requirements[name] = range
  }
  return { kind: 'peers', peers: requirements, requirements }
}

/** 把每个未满足项解析成一句面向用户的说明，不猜修复方式。 */
export function explainRequirement(name, range, runtimeVersion) {
  if (range.trim() === '') return `${name} 的范围为空——DSH 不会把它当作“任意版本”`
  if (name === 'engines.dsh') {
    return `engines.dsh = "${range}" 不包含当前运行时 ${runtimeVersion}`
  }
  return `${name} 的 peer 范围 "${range}" 不包含当前运行时 ${runtimeVersion}`
}

/**
 * 判定一个插件清单与运行时版本的关系。
 * @param manifest package.json 解析结果
 * @param runtimeVersion 当前 DSH 运行时版本（如 0.2.1-rc.2）
 * @param exemptions 精确 `name@version` → 允许的运行时版本列表
 * @returns 判定结果；不抛异常，畸形清单一律返回 status=invalid。
 */
export function evaluatePlugin(manifest, runtimeVersion, exemptions = {}) {
  const declaration = readDeclaration(manifest)
  const name = isPlainObject(manifest) && typeof manifest.name === 'string' ? manifest.name : ''
  const version = isPlainObject(manifest) && typeof manifest.version === 'string' ? manifest.version : ''
  const identity = name === '' || version === '' ? '' : `${name}@${version}`

  if (declaration.invalid) {
    return {
      status: 'invalid',
      name, version, identity,
      kind: declaration.kind,
      declared: declaration,
      requirements: {},
      unmet: {},
      exempted: false,
      reasons: [declaration.invalid],
    }
  }

  if (declaration.kind === 'none') {
    return {
      status: 'unversioned',
      name, version, identity,
      kind: 'none',
      declared: declaration,
      requirements: {},
      unmet: {},
      exempted: false,
      reasons: ['清单没有声明 engines.dsh，也没有 @deepseek-ai/dsh* 的 peerDependencies'],
    }
  }

  // engines.dsh 为空串时 DSH 判为不满足（satisfies 里先判 trim() !== ''）。
  const unmet = {}
  const reasons = []
  for (const [requirement, range] of Object.entries(declaration.requirements)) {
    if (range.trim() === '') {
      unmet[requirement] = range
      reasons.push(explainRequirement(requirement, range, runtimeVersion))
      continue
    }
    const effective = WORKSPACE_RANGES.has(range) ? runtimeVersion : range
    const satisfied = satisfies(runtimeVersion, effective)
    if (satisfied !== true) {
      unmet[requirement] = range
      reasons.push(explainRequirement(requirement, range, runtimeVersion))
    }
  }

  if (Object.keys(unmet).length === 0) {
    return {
      status: 'ok',
      name, version, identity,
      kind: declaration.kind,
      declared: declaration,
      requirements: declaration.requirements,
      unmet: {},
      exempted: false,
      reasons: [],
    }
  }

  const allowed = identity !== '' && Object.hasOwn(exemptions, identity) ? exemptions[identity] : undefined
  const exempted = Array.isArray(allowed) ? allowed.includes(runtimeVersion) : false
  return {
    status: exempted ? 'exempted' : 'incompatible',
    name, version, identity,
    kind: declaration.kind,
    declared: declaration,
    requirements: declaration.requirements,
    unmet,
    exempted,
    reasons,
  }
}

/** 运行时版本字符串是否是合法 SemVer（用于拒绝把畸形版本写进报告）。 */
export function isRuntimeVersion(value) {
  return typeof value === 'string' && parseVersion(value) !== null
}
