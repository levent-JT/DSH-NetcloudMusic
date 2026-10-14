// 新增功能的针对性验证
//  1) 双语歌词合并：用真实歌曲数据跑 parseLrc + mergeTranslation
//  2) CSS 类名交叉检查：JS 里引用的 class 必须在 CSS 里定义（防手写拼错）
import fs from 'node:fs'
import nodePath from 'node:path'
import { fileURLToPath } from 'node:url'

// 任何异常都要打出来，否则静默退出很难查（ESM 里没有 require）
process.on('uncaughtException', (e) => {
  console.error('uncaught: ' + ((e && e.stack) || e))
  process.exit(1)
})
process.on('unhandledRejection', (e) => {
  console.error('unhandled rejection: ' + ((e && e.stack) || e))
  process.exit(1)
})

// 项目根目录从脚本自身位置推导 —— 不把开发机的绝对路径写进仓库
const PROJ = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..')
const src = fs.readFileSync(PROJ + '/lib/client.js', 'utf8')

/** 按花括号配对从源码里抠出一个函数（比正则可靠） */
function extractFunction(text, name) {
  const start = text.indexOf('function ' + name + '(')
  if (start < 0) return null
  let i = text.indexOf('{', start)
  if (i < 0) return null
  let depth = 0
  let inStr = null
  for (; i < text.length; i++) {
    const ch = text[i]
    const prev = text[i - 1]
    if (inStr) {
      if (ch === inStr && prev !== '\\') inStr = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

const results = []
const ok = (c, label, detail) => results.push((c ? '  [OK]   ' : '  [FAIL] ') + label + (detail ? '  ' + detail : ''))

// ─────────── 1) 双语合并 ───────────
const parseSrc = extractFunction(src, 'parseLrc')
const mergeSrc = extractFunction(src, 'mergeTranslation')
ok(!!parseSrc, '从源码抠出 parseLrc')
ok(!!mergeSrc, '从源码抠出 mergeTranslation')
if (!parseSrc || !mergeSrc) {
  console.log(results.join('\n'))
  process.exit(1)
}
const parseLrc = new Function('return ' + parseSrc)()
const mergeTranslation = new Function('parseLrc', 'return ' + mergeSrc)(parseLrc)

// 真实数据：读 profile 状态文件里的 cookie，打真实 /lyric
const REAL_STORE = nodePath.join(process.env.USERPROFILE || '', '.dsh', 'profiles', 'desktop', 'netease-music.json')
const cookie = JSON.parse(fs.readFileSync(REAL_STORE, 'utf8')).cookie
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function fetchLyric(id) {
  const res = await fetch('https://music.163.com/api/song/lyric?id=' + id + '&lv=-1&kv=-1&tv=-1&rv=-1', {
    headers: { 'User-Agent': UA, Referer: 'https://music.163.com/', Cookie: 'os=pc; appver=8.9.70; ' + cookie },
    signal: AbortSignal.timeout(20000),
  })
  return res.json()
}

// 用截图里那首 All Falls Down 找 id
async function searchId(kw) {
  const res = await fetch(
    'https://music.163.com/api/cloudsearch/pc',
    {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        Referer: 'https://music.163.com/',
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: 'os=pc; appver=8.9.70; ' + cookie,
      },
      body: new URLSearchParams({ s: kw, type: '1', limit: '5', total: 'true' }).toString(),
      signal: AbortSignal.timeout(20000),
    },
  )
  const j = await res.json()
  const songs = (j.result && j.result.songs) || []
  return songs.map((s) => ({ id: s.id, name: s.name, artist: (s.ar || []).map((a) => a.name).join('/') }))
}

console.log('真实数据 · All Falls Down 候选:')
const cands = await searchId('All Falls Down Alan Walker')
for (const c of cands.slice(0, 5)) console.log('   id=' + c.id + '  ' + c.name + ' / ' + c.artist)
console.log('')

const target = cands.find((c) => /all falls down/i.test(c.name)) || cands[0]
if (target) {
  const lyr = await fetchLyric(target.id)
  const lrc = (lyr.lrc && lyr.lrc.lyric) || ''
  const tlrc = (lyr.tlyric && lyr.tlyric.lyric) || ''
  console.log('用曲 id=' + target.id + ' (' + target.name + ') 验证：')
  console.log('   lrc 字节=' + lrc.length + '  tlyric 字节=' + tlrc.length)

  const plain = parseLrc(lrc)
  const merged = mergeTranslation(parseLrc(lrc), tlrc)
  const withTr = merged.filter((x) => x.tr)
  ok(plain.length > 0, 'parseLrc 解析出原文行', '行数=' + plain.length)
  ok(merged.length === plain.length, '合并不改变行数', plain.length + ' -> ' + merged.length)
  ok(withTr.length > 0, 'mergeTranslation 挂上了译文', '有译文 ' + withTr.length + '/' + merged.length + ' 行')

  // 回归守卫：早期 0.35s 容差会把 lrc 开头的「作词/作曲/编曲」元信息行
  // 误配成首句译文（它们离首句译文不足 0.35s）。此处锁死该行为。
  const isMeta = (s) => /^(作词|作曲|编曲|制作人|吉他|贝斯|鼓|混音|录音)/.test(String(s).trim())
  const metaLines = merged.filter((x) => isMeta(x.text))
  const misMatched = metaLines.filter((x) => x.tr)
  ok(metaLines.length > 0, '该曲含元信息行（可作回归样本）', metaLines.length + ' 行')
  ok(misMatched.length === 0, '元信息行未被误配译文', '误配 ' + misMatched.length + ' 行' + (misMatched.length ? ' 例: ' + misMatched[0].text + ' -> ' + misMatched[0].tr : ''))
  const realLines = merged.filter((x) => !isMeta(x.text) && String(x.text).trim())
  const realWithTr = realLines.filter((x) => x.tr)
  ok(realWithTr.length >= Math.floor(realLines.length * 0.8), '真实歌词行绝大多数挂上译文', realWithTr.length + '/' + realLines.length)
  if (withTr.length) {
    console.log('   样本（原文 / 译文）:')
    for (const x of withTr.slice(0, 3)) console.log('     [' + x.t.toFixed(2) + 's] ' + x.text + '  ||  ' + x.tr)
  }
  // 边界：无翻译时不应破坏结构
  const noTr = mergeTranslation(parseLrc(lrc), '')
  ok(noTr.length === plain.length && noTr.every((x) => x.tr === undefined), '无翻译时不挂 tr 且行数不变')
  // 边界：空输入
  ok(mergeTranslation([], 'x').length === 0, '空行数组安全')
  ok(parseLrc(undefined).length === 0, 'parseLrc(undefined) 安全')
}

// ─────────── 2) CSS 类名交叉检查 ───────────
console.log('')
const cssStart = src.indexOf('const CSS = `')
const cssEnd = src.indexOf('`;', cssStart)
const css = src.slice(cssStart, cssEnd)
const defined = new Set()
for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) defined.add(m[1])

// JS 里 className: "..." 里用到的类（含拼接的静态片段）
const used = new Set()
for (const m of src.matchAll(/className:\s*"([^"]+)"/g)) {
  for (const c of m[1].split(/\s+/)) if (c && !c.includes('$') && !c.includes('{')) used.add(c)
}
for (const m of src.matchAll(/className:\s*"([^"]*)"\s*\+/g)) {
  for (const c of m[1].split(/\s+/)) if (c) used.add(c)
}

const missing = [...used].filter((c) => !defined.has(c)).sort()
ok(missing.length === 0, 'JS 引用的 class 都在 CSS 里定义了', missing.length ? '缺: ' + missing.join(', ') : '共 ' + used.size + ' 个')

// 反向：新增的背景类是否都被用上（防止写了 CSS 忘了用）
const newCls = ['nm-amb', 'nm-amb-cover', 'nm-amb-dim', 'nm-amb-lyrics', 'nm-amb-line', 'nm-amb-t', 'nm-amb-tr', 'nm-lyric-tr']
for (const c of newCls) {
  ok(defined.has(c), 'CSS 定义了 .' + c)
}
const ambUsed = [...used].filter((c) => c.startsWith('nm-amb'))
ok(ambUsed.length >= 6, 'JS 里确实引用了背景类', ambUsed.join(', '))

console.log(results.join('\n'))
const fails = results.filter((x) => x.startsWith('  [FAIL]')).length
console.log('')
console.log('通过 ' + (results.length - fails) + '/' + results.length + (fails ? '  —— 有失败项' : '  —— 全部通过'))
