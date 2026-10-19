// 最小 SemVer 子集：只为回答一个问题——当前 DSH 运行时版本是否满足插件声明的范围。
//
// 语义对齐 npm `semver.satisfies(version, range, { includePrerelease: true })`，
// 也就是 DSH 自己在 packages/boot/app-boot/src/plugin-compatibility.ts 里用的那套判据
// （预发布版本参与所有范围比较，不做“默认排除 prerelease”的门控）。
//
// 支持的写法：`1.2.3` `=1.2.3` `^1.2.3` `~1.2.3` `>=1.2.3` `>1.2.3` `<=1.2.3` `<1.2.3`
// `1.2` `1` `1.x` `1.2.x` `*` `x` `1.2.3 - 2.3.4`（连字符范围） 以及用 `||` 取并集。
// 不支持的写法（build 元数据比较、`~>`、`latest` 等标签）会返回 undefined，
// 由调用方按“无法判定”处理，而不是猜成通过。

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/
const PARTIAL = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/

/** 解析完整版本号；不合法返回 null。 */
export function parseVersion(text) {
  if (typeof text !== 'string') return null
  const match = VERSION.exec(text.trim())
  if (!match) return null
  const core = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (core.some((part) => !Number.isSafeInteger(part))) return null
  return {
    major: core[0],
    minor: core[1],
    patch: core[2],
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
    build: match[5] === undefined ? [] : match[5].split('.'),
    text: text.trim().replace(/^v/, ''),
  }
}

function compareIdentifier(left, right) {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) {
    const a = Number(left)
    const b = Number(right)
    return a === b ? 0 : a < b ? -1 : 1
  }
  if (leftNumeric) return -1
  if (rightNumeric) return 1
  return left === right ? 0 : left < right ? -1 : 1
}

/** 比较两个已解析版本；a<b 返回 -1，相等返回 0，a>b 返回 1。 */
export function compareParsed(a, b) {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  // 无预发布标识的版本高于任何同核心号的预发布版本。
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const length = Math.min(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const result = compareIdentifier(a.prerelease[index], b.prerelease[index])
    if (result !== 0) return result
  }
  if (a.prerelease.length === b.prerelease.length) return 0
  return a.prerelease.length < b.prerelease.length ? -1 : 1
}

/** 比较两个版本字符串；任一不合法返回 undefined。 */
export function compare(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === null || b === null) return undefined
  return compareParsed(a, b)
}

function isWild(part) {
  return part === undefined || part === 'x' || part === 'X' || part === '*'
}

function partialOf(text) {
  const match = PARTIAL.exec(text.trim())
  if (!match) return null
  const parts = [match[1], match[2], match[3]]
  if (parts.every(isWild)) return { wild: true, parts, prerelease: match[4] }
  // 只允许“尾部通配”：1.x.3 这种写法 npm 也不接受。
  let seenWild = false
  for (const part of parts) {
    if (isWild(part)) seenWild = true
    else if (seenWild) return null
  }
  return {
    wild: false,
    parts,
    prerelease: match[4],
    version: {
      major: Number(parts[0]),
      minor: isWild(parts[1]) ? 0 : Number(parts[1]),
      patch: isWild(parts[2]) ? 0 : Number(parts[2]),
      prerelease: match[4] === undefined ? [] : match[4].split('.'),
      build: [],
    },
  }
}

function floor(partial) {
  return partial.version
}

function nextMajor(version) {
  return { major: version.major + 1, minor: 0, patch: 0, prerelease: [], build: [] }
}

function nextMinor(version) {
  return { major: version.major, minor: version.minor + 1, patch: 0, prerelease: [], build: [] }
}

function nextPatch(version) {
  return { major: version.major, minor: version.minor, patch: version.patch + 1, prerelease: [], build: [] }
}

function comparator(op, version) {
  return { op, version }
}

function caretRange(partial) {
  const low = floor(partial)
  const [major, minor, patch, ...rest] = partial.parts
  let high
  if (isWild(major)) return []
  if (isWild(minor)) high = nextMajor(low)
  else if (isWild(patch)) {
    high = major === '0' ? nextMinor(low) : nextMajor(low)
  } else if (Number(major) !== 0) high = nextMajor(low)
  else if (Number(minor) !== 0) high = nextMinor(low)
  else high = nextPatch(low)
  return [comparator('>=', low), comparator('<', high)]
}

function tildeRange(partial) {
  const low = floor(partial)
  const [major, minor] = partial.parts
  if (isWild(major)) return []
  const high = isWild(minor) ? nextMajor(low) : nextMinor(low)
  return [comparator('>=', low), comparator('<', high)]
}

function hyphenRange(lowText, highText) {
  const low = partialOf(lowText)
  const high = partialOf(highText)
  if (low === null || high === null || low.wild) return null
  const comparators = [comparator('>=', floor(low))]
  if (isWild(high.parts[1]) && isWild(high.parts[2])) comparators.push(comparator('<', nextMajor(floor(high))))
  else if (isWild(high.parts[2])) comparators.push(comparator('<', nextMinor(floor(high))))
  else comparators.push(comparator('<=', floor(high)))
  return comparators
}

function comparatorRange(token) {
  const match = /^(>=|<=|>|<|=|\^|~)?\s*(.*)$/.exec(token)
  if (!match) return null
  const op = match[1] === undefined ? '=' : match[1]
  const partial = partialOf(match[2])
  if (partial === null) return null
  if (op === '^') return caretRange(partial)
  if (op === '~') return tildeRange(partial)
  if (partial.wild) return op === '=' || op === '>=' ? [] : null
  const low = floor(partial)
  if (op === '=') {
    if (!isWild(partial.parts[1]) && !isWild(partial.parts[2])) return [comparator('=', low)]
    if (isWild(partial.parts[1])) return [comparator('>=', low), comparator('<', nextMajor(low))]
    return [comparator('>=', low), comparator('<', nextMinor(low))]
  }
  if (op === '>=') return [comparator('>=', low)]
  if (op === '>') {
    // `>1.2` 等价于 `>=1.3.0`，`>1` 等价于 `>=2.0.0`。
    if (isWild(partial.parts[1])) return [comparator('>=', nextMajor(low))]
    if (isWild(partial.parts[2])) return [comparator('>=', nextMinor(low))]
    return [comparator('>', low)]
  }
  if (op === '<') return [comparator('<', low)]
  // `<=1.2` 等价于 `<1.3.0`，`<=1` 等价于 `<2.0.0`。
  if (isWild(partial.parts[1])) return [comparator('<', nextMajor(low))]
  if (isWild(partial.parts[2])) return [comparator('<', nextMinor(low))]
  return [comparator('<=', low)]
}

function splitSet(text) {
  const tokens = text.trim().split(/\s+/).filter((token) => token.length > 0)
  if (tokens.length === 0) return []
  const comparators = []
  let index = 0
  while (index < tokens.length) {
    if (tokens[index + 1] === '-') {
      const hyphen = hyphenRange(tokens[index], tokens[index + 2])
      if (hyphen === null) return null
      comparators.push(...hyphen)
      index += 3
      continue
    }
    const range = comparatorRange(tokens[index])
    if (range === null) return null
    comparators.push(...range)
    index += 1
  }
  return comparators
}

/** 解析范围表达式；返回比较器集合数组（`||` 的并集），无法解析返回 null。 */
export function parseRange(range) {
  if (typeof range !== 'string') return null
  const sets = range.split('||').map(splitSet)
  if (sets.some((set) => set === null)) return null
  return sets
}

function testComparator(version, { op, version: target }) {
  const result = compareParsed(version, target)
  switch (op) {
    case '=': return result === 0
    case '>': return result > 0
    case '>=': return result >= 0
    case '<': return result < 0
    case '<=': return result <= 0
    default: return false
  }
}

/**
 * 运行时版本是否落在范围内。
 * @returns true/false，范围无法解析时返回 undefined（调用方按未满足处理）。
 */
export function satisfies(versionText, rangeText) {
  const version = parseVersion(versionText)
  const sets = parseRange(rangeText)
  if (version === null || sets === null) return undefined
  return sets.some((set) => set.every((comparator) => testComparator(version, comparator)))
}
