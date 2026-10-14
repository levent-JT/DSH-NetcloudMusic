// 新功能验证：自动最高音质 / 心动模式 / 红心 / 收藏到歌单
//
// 写操作说明：本脚本会真实调用网易云的「红心」与「收藏到歌单」接口，
// 但每一步都成对执行并在 finally 中强制撤销，且结束时断言账号状态与开始时一致。
// 这是经用户明确授权的一次性实测（测完立即撤销）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'

// 项目根目录从脚本自身位置推导 —— 不把开发机的绝对路径写进仓库
const PROJ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TEST_DIR = process.env.TEMP + '/nm-feat-test'
fs.mkdirSync(TEST_DIR, { recursive: true })
process.env.DSH_PROFILE_DIR = TEST_DIR.replace(/\//g, '\\')

const REAL_STORE = path.join(process.env.USERPROFILE || '', '.dsh', 'profiles', 'desktop', 'netease-music.json')
const COOKIE_STR = JSON.parse(fs.readFileSync(REAL_STORE, 'utf8')).cookie
fs.writeFileSync(
  path.join(TEST_DIR, 'netease-music.json'),
  JSON.stringify({ cookie: COOKIE_STR, settings: { quality: 'auto' } }),
)

process.on('uncaughtException', (e) => { console.error('uncaught: ' + ((e && e.stack) || e)); process.exit(1) })

const mod = await import('file:///' + PROJ + '/lib/index.js')
const routes = new Map()
await mod.apply({
  effect: (fn) => fn(),
  webServer: { register: (o) => { routes.set(o.path, o.handler); return () => {} } },
})

function call(pathname) {
  return new Promise((resolve) => {
    const h = routes.get(pathname.split('?')[0])
    if (!h) return resolve({ status: 404, body: { error: 'no route' } })
    const req = Object.assign(Readable.from([]), {
      method: 'GET', url: pathname, socket: { remoteAddress: '127.0.0.1' }, headers: {},
    })
    let status = 0
    let text = ''
    const res = { writeHead(c) { status = c; return this }, end(ch) { if (ch !== undefined) text += ch } }
    h(req, res).then(() => {
      let body = null
      try { body = JSON.parse(text) } catch { body = { _raw: text.slice(0, 200) } }
      resolve({ status, body })
    })
  })
}

const api = (method, params) => {
  const usp = new URLSearchParams({ method })
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null) usp.set(k, String(v))
  return call('/plugin/netease-music/api?' + usp.toString())
}

const results = []
const ok = (c, label, detail) => results.push((c ? '  [OK]   ' : '  [FAIL] ') + label + (detail ? '  ' + detail : ''))

// ───────── 1) 自动最高音质 ─────────
console.log('改动4 · 自动最高音质（level=auto）')
const autoCases = [
  { id: '515453363', name: 'All Falls Down（有母带）', expectMinBr: 1000000 },
  { id: '33894312', name: '情非得已童声版（仅 mp3）', expectMinBr: 100000 },
  { id: '186016', name: '晴天（数字专辑）', expectMinBr: -1 },
]
for (const c of autoCases) {
  const r = await api('/song/url/v1', { id: c.id, level: 'auto' })
  const d = r.body.body && r.body.body.data && r.body.body.data[0]
  const br = (d && d.br) || 0
  const ty = (d && d.type) || '-'
  const lv = (d && d.level) || '-'
  const hasUrl = !!(d && d.url)
  if (c.expectMinBr < 0) {
    ok(!hasUrl || br === 0, 'auto: ' + c.name + ' 取不到链时返回空而非报错', 'br=' + br)
  } else {
    ok(hasUrl && br >= c.expectMinBr, 'auto: ' + c.name, '实际 level=' + lv + ' br=' + br + ' type=' + ty)
  }
}

// ───────── 2) 心动模式 ─────────
console.log('改动2 · 心动模式')
const liked = await api('/like/ids')
const likedIds = new Set((liked.body.body && liked.body.body.ids) || [])
const likedPid = liked.body.body && liked.body.body.playlistId
ok(likedIds.size > 0, '/like/ids 返回我喜欢曲目 id', likedIds.size + ' 首, pid=' + likedPid)

const seedSong = '515453363'
const hb = await api('/playmode/intelligence/list', { id: seedSong, pid: likedPid, count: 20 })
const hbData = (hb.body.body && hb.body.body.data) || []
ok(hbData.length > 0, '心动模式返回 data[]', hbData.length + ' 项')
const firstInfo = hbData[0] && hbData[0].songInfo
ok(!!firstInfo, '曲目嵌在 data[].songInfo（不是顶层）')
if (firstInfo) {
  const nm = firstInfo.name || ''
  const ar = (firstInfo.ar || firstInfo.artists || []).map((a) => a.name).join('/')
  ok(!!nm, 'songInfo 含歌名', nm + ' - ' + ar)
}

// ───────── 3) 写操作实测（成对，撤销保证）─────────
console.log('改动3 · 红心 / 收藏到歌单（写操作，测完撤销）')
// 挑一首不在「我喜欢」里的歌
const pick = [...hbData.map((x) => x.songInfo).filter(Boolean)].find((s) => s && !likedIds.has(s.id))
const testId = pick ? pick.id : 33894312
const testName = pick ? pick.name : '(情非得已童声版)'
console.log('  测试曲: ' + testName + ' (id=' + testId + ')  初始已红心=' + likedIds.has(testId))

let likedOk = false
let addedOk = false
try {
  // --- 先测「收藏到歌单」，再测红心 ---
  // 顺序很重要：红心本身就会把歌加进「我喜欢的音乐」，若先红心，
  // 再用 manipulate 往同一歌单加同一首，服务端会回 502 歌单内歌曲重复[1017]。
  const addRes = await api('/playlist/manipulate/tracks', { op: 'add', pid: likedPid, tids: testId })
  const addBody = addRes.body.body || {}
  addedOk = addBody.code === 200
  ok(addedOk, 'POST 收藏到歌单 /playlist/manipulate/tracks 返回 200', 'code=' + addBody.code + (addBody.message ? ' msg=' + addBody.message : ''))

  const afterAdd = await api('/like/ids')
  const sAdd = new Set((afterAdd.body.body && afterAdd.body.body.ids) || [])
  ok(sAdd.has(testId), '收藏后该曲出现在歌单', '总数 ' + likedIds.size + ' -> ' + sAdd.size)

  // --- 再测红心 ---
  const likeRes = await api('/song/like', { id: testId, like: 'true' })
  const likeBody = likeRes.body.body || {}
  likedOk = likeBody.code === 200
  ok(likedOk, 'POST 红心 /song/like 返回 200', 'code=' + likeBody.code + (likeBody.message ? ' msg=' + likeBody.message : ''))
} finally {
  // --- 强制撤销 ---
  if (likedOk) {
    const un = await api('/song/like', { id: testId, like: 'false' })
    ok((un.body.body || {}).code === 200, '撤销：取消红心', 'code=' + ((un.body.body || {}).code))
  }
  if (addedOk) {
    const delRes = await api('/playlist/manipulate/tracks', { op: 'del', pid: likedPid, tids: testId })
    ok((delRes.body.body || {}).code === 200, '撤销：从歌单移除', 'code=' + ((delRes.body.body || {}).code))
  }
  const after = await api('/like/ids')
  const s2 = new Set((after.body.body && after.body.body.ids) || [])
  ok(s2.size === likedIds.size && !s2.has(testId), '撤销后状态与开始时一致', '总数 ' + likedIds.size + ' -> ' + s2.size)
}

console.log('')
console.log(results.join('\n'))
const fails = results.filter((x) => x.startsWith('  [FAIL]')).length
console.log('')
console.log('通过 ' + (results.length - fails) + '/' + results.length + (fails ? '  —— 有失败项' : '  —— 全部通过'))
