#!/usr/bin/env node
/**
 * 拆分校验器：证明"拆文件没有丢代码、没有多代码"。
 *
 * 为什么不用子序列校验（第一版就是这么写的，结果误报上千行）：
 * 拆分必然会改变**线性顺序** —— 原来是 [前缀][被拆块][后缀] 一整条，
 * 拆完变成"被拆块独立成文件、前缀+后缀留在原文件"，中间那块换位置了。
 * 顺序敏感的比对在这里从原理上就不成立。
 *
 * 真正该保证的不变量是**多重集合相等**：
 *   · 原始体里的每一行，在新源码里出现的次数不能变少（丢了就是丢代码）；
 *   · 也不能变多（多了就是复制粘贴事故）。
 * 这个判据对"换位置"免疫，对"丢/重"敏感 —— 正是拆分需要的。
 *
 * 用法：
 *   node scripts/verify-split.mjs <拆分前的工厂体快照> <新源码目录>
 */
import fs from 'node:fs'
import path from 'node:path'

const [, , argBefore, argDir] = process.argv
if (!argBefore || !argDir) {
  console.error('用法: node scripts/verify-split.mjs <拆分前的工厂体快照> <新源码目录>')
  process.exit(2)
}

/**
 * 有意的重命名：登记"改动前 → 改动后"，两侧都归一，避免把改名误报成丢代码。
 * 拆分时经常要把"原来靠共享闭包自由取用的变量"改成显式注入，名字会变。
 */
const RENAMES = [
  [/\bbgLayerEl\b/g, 'backgroundLayerEl'], // 背景图层改为经 setBackgroundLayer 注入
]

/**
 * 有意的改写：拆分时把调用点改成走新接口，原来的行会被替换掉或搬走。
 * 登记在这里之后，"这些行少了"算正常；没登记的行少了就是真丢代码。
 * 这份清单本身也是文档 —— 它记录了这次拆分到底改动了哪些调用点。
 */
const REWRITES = [
  'clearAmbientTokens();', // → DshSkin.clearSkin()
  'applyAmbientTokens(alpha);', // → DshSkin.applySkin(alpha)
  'const id = setInterval(() => applyAmbientTokens(alpha), 3000);', // 同上
  'ambientStyleEl.remove();', // 搬进了 dsh.js 的 disposeStyle()
  'ambientStyleEl = null;', // 同上

  // ── 第四轮：磨砂判据从"在不在布局树里"改成"是不是常驻版式区域" ──
  // 旧判据把右侧边栏/下侧边栏一起排除了（它们也在 #root 里），排得太狠。
  'const NO_FROST_NAME_RE = /(bg-base|sidebar)/i;', // 收紧为 sidebar-fill
  'const rootEl = layoutRoot();',
  'if (rootEl && rootEl.contains(el)) return false;',
  'const pos = getComputedStyle(el).position;',
  'if (pos !== "fixed" && pos !== "absolute" && pos !== "sticky") return false;',
  // layoutRoot 本身随旧判据一起删除（死代码：判据没了就没有调用方了）
  'let layoutRootEl = null;',
  'function layoutRoot() {',
  'if (layoutRootEl && layoutRootEl.isConnected) return layoutRootEl;',
  'layoutRootEl = document.getElementById("root") || document.getElementById("app") ||',
  'document.getElementById("dsh-root") || null;',
  'return layoutRootEl;',
  // 签名加 opts（磨砂范围由外面传进来，不再靠共享闭包读 store）
  'function applyAmbientTokens(alpha) {',
  '}, [enabled, alpha]);',

  // ── 第四轮续：面积闸 0.5 → 0.85 ──
  // 0.5 会把设置抽屉（约 58% 视口）一起拦掉，而抽屉纵向只占 86%，
  // 不是常驻版式区域，本该磨砂 —— 用户看到的现象是"只磨了抽屉里的组件"。
  'if (r.width * r.height > vw * vh * 0.5) return false;',

  // ── 第五轮：磨砂改成 MutationObserver 里同步加 ──
  // 原来走 350ms 去抖，用户看到的是"打开设置后有一个变化的渲染过程"：
  // 抽屉先以未磨砂的样子出现，350ms 后才被磨砂。
  // MutationObserver 回调在下一帧绘制之前执行，同步加 class 就没有中间态了。
  'if (node && node.nodeType === 1) scheduleFrostScan(node);',
  '}, 350);',
]

/** 纯括号/逗号行：拆分时加一层包装就会多出来，属于结构性噪音，不计入误复制。 */
const STRUCTURAL = /^[}\]);,]+$/

/**
 * 拆分时有意新增的结构行。多包一层 IIFE、多一个返回接口，就会让这类短行多一个 ——
 * 和 REWRITES 同理，登记在这里是"我确认这个增长是有意的"，也是给未来的自己留证据。
 */
const GROWTH_OK = new Set([
  'return {', // dsh.js 的对外接口对象
  // 第四轮：新增"磨砂范围"设置项，多了一行设置行 + 一行说明
  'el("div", { className: "nm-settings-row" },',
  'el("div", { className: "nm-settings-hint" },',
])

/** 规范化：登记过的改名先归一，再 trim；丢掉空行与纯注释行。 */
function normalizeLines(text) {
  return text
    .split(/\r?\n/)
    .map((l) => {
      let out = l
      for (const [re, to] of RENAMES) out = out.replace(re, to)
      return out.trim()
    })
    .filter((l) => l !== '' && !l.startsWith('//') && !l.startsWith('/*') && !l.startsWith('*'))
}

/** 往上找构建脚本，用它的 PARTS 清单确定分片顺序（和真实拼接一致）。 */
function collectSources(srcDir) {
  let dir = srcDir
  let buildFile = ''
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, 'scripts', 'build-client.mjs')
    if (fs.existsSync(candidate)) {
      buildFile = candidate
      break
    }
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  if (!buildFile) throw new Error('往上 4 级都没找到 scripts/build-client.mjs（从 ' + srcDir + ' 起）')
  const build = fs.readFileSync(buildFile, 'utf8')
  const m = build.match(/const PARTS = \[([^\]]*)\]/)
  if (!m) throw new Error('构建脚本里没有 PARTS 清单')
  const names = m[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
  const missing = names.filter((n) => !fs.existsSync(path.join(srcDir, n)))
  if (missing.length) throw new Error('构建清单里的分片不存在: ' + missing.join(', '))
  return names.map((n) => path.join(srcDir, n))
}

function count(lines) {
  const map = new Map()
  for (const l of lines) map.set(l, (map.get(l) || 0) + 1)
  return map
}

const before = normalizeLines(fs.readFileSync(argBefore, 'utf8'))
const files = collectSources(argDir)
const afterLines = []
for (const f of files) afterLines.push(...normalizeLines(fs.readFileSync(f, 'utf8')))

const beforeCount = count(before)
const afterCount = count(afterLines)

console.log('  拆分前工厂体: ' + before.length + ' 行（已规范化，去空行与纯注释）')
console.log('  新源码      : ' + files.length + ' 个分片 / ' + afterLines.length + ' 行')
files.forEach((f) => console.log('      ' + path.relative(path.dirname(path.dirname(f)), f).replace(/\\/g, '/')))
console.log('')

// ── 丢：原始体有的，新源码里出现次数变少（登记过的改写除外）──────────
const rewritten = new Set(REWRITES)
const lost = []
for (const [line, n] of beforeCount) {
  if (rewritten.has(line)) continue
  const now = afterCount.get(line) || 0
  if (now < n) lost.push({ line, was: n, now })
}

// ── 多：新源码里出现次数超过原始体（原本没有的 = 新增包装，单独列）──
const added = []
const grown = []
for (const [line, n] of afterCount) {
  if (STRUCTURAL.test(line) || GROWTH_OK.has(line)) continue
  const was = beforeCount.get(line) || 0
  if (was === 0) added.push({ line, now: n })
  else if (n > was) grown.push({ line, was, now: n })
}

let failed = false

if (lost.length) {
  failed = true
  console.log('  ✗ 丢代码 ' + lost.length + ' 类行：')
  for (const r of lost.slice(0, 25)) {
    console.log('      原本 x' + r.was + ' → 现在 x' + r.now + '   ' + r.line.slice(0, 88))
  }
  if (lost.length > 25) console.log('      …还有 ' + (lost.length - 25) + ' 类')
} else {
  console.log('  ✓ 没有丢代码：原始体的每一行在新源码里都还在（次数不减）')
}

if (grown.length) {
  failed = true
  console.log('  ✗ 疑似误复制 ' + grown.length + ' 类行：')
  for (const r of grown.slice(0, 25)) {
    console.log('      原本 x' + r.was + ' → 现在 x' + r.now + '   ' + r.line.slice(0, 88))
  }
  if (grown.length > 25) console.log('      …还有 ' + (grown.length - 25) + ' 类')
} else {
  console.log('  ✓ 没有误复制：没有哪一行凭空变多')
}

console.log('')
console.log('  · 新增 ' + added.length + ' 类行（拆分引入的包装/适配/注释，属正常）：')
for (const r of added.slice(0, 10)) console.log('      x' + r.now + '  ' + r.line.slice(0, 88))
if (added.length > 10) console.log('      …还有 ' + (added.length - 10) + ' 类')

console.log('')
console.log(failed ? '  >>> 校验失败' : '  >>> 校验通过（无丢代码、无误复制）')
process.exit(failed ? 1 : 0)
