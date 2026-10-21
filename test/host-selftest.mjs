// Host 半端到端自检：用桩 ctx 加载 lib/index.js，模拟客户端全部路由调用。
// 验证每个返回体是否满足 lib/client.js 的字段期望。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'

// 项目根目录从脚本自身位置推导 —— 不把开发机的绝对路径写进仓库，
// 别人 clone 下来放在任何位置都能直接跑。
const PROJ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// 登录态从插件自己的状态文件读取 —— 不把凭据写进测试脚本。
//
// **必须在覆盖 DSH_PROFILE_DIR 之前定位它**，否则读到的就是下面那个临时目录，
// 而临时文件要到更后面才写 —— 第一次在干净的 temp 里跑必然 ENOENT
// （这个 bug 一直没暴露，是因为 temp 里留着上一次跑写下的文件）。
//
// 宿主真实读哪一份？DSH_PROFILE_DIR 可能是加载插件之后才设进进程环境的，
// 那种情况下实际落点是 DSH_HOME。两份都存在时取**较新**的那份 ——
// 实测它们差了 5 天，旧的那份 cookie 早已轮换，读它会得出错误结论。
function findRealStore() {
  const bases = [
    process.env.DSH_PROFILE_DIR,
    process.env.DSH_HOME,
    path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh'),
  ]
  const found = []
  for (const base of bases) {
    if (!base) continue
    const p = path.join(base, 'netease-music.json')
    try {
      found.push({ p, m: fs.statSync(p).mtimeMs })
    } catch (err) {
      /* 这个位置没有 */
    }
  }
  if (!found.length) {
    throw new Error('找不到真实的 netease-music.json —— 先在插件里登录，再跑这个测试')
  }
  found.sort((a, b) => b.m - a.m)
  if (found.length > 1) {
    console.log('[host-selftest] 找到 ' + found.length + ' 份配置，用较新的：')
    for (const f of found) {
      console.log('    ' + (f === found[0] ? '→ ' : '  ') + f.p + '  ' + new Date(f.m).toISOString())
    }
  }
  return found[0].p
}
const REAL_STORE = findRealStore()
const COOKIE_STR = JSON.parse(fs.readFileSync(REAL_STORE, 'utf8')).cookie

// 定位完真实配置后再把宿主的数据目录指向临时目录，避免测试写到真实配置上。
const TEST_DIR = process.env.TEMP + '/nm-host-test'
fs.mkdirSync(TEST_DIR, { recursive: true })
process.env.DSH_PROFILE_DIR = TEST_DIR.replace(/\//g, '\\')

fs.writeFileSync(
  path.join(TEST_DIR, 'netease-music.json'),
  JSON.stringify({ cookie: COOKIE_STR, settings: { quality: 'lossless' } }),
)

const mod = await import('file:///' + PROJ + '/lib/index.js')
// 桩：收集全部 exact 注册，按路径分发（Host 现在是逐条 exact 而不是一条 prefix）
const routes = new Map()
const ctx = {
  effect: (fn) => fn(),
  webServer: {
    register: (o) => {
      routes.set(o.path, o.handler)
      return () => {}
    },
  },
}
await mod.apply(ctx)
if (routes.size === 0) {
  console.log('!! webServer.register 未被调用，Host 未挂载')
  process.exit(1)
}
console.log('Host 已挂载到 ' + mod.name + '，注入服务: ' + JSON.stringify(mod.inject))
console.log('已注册 ' + routes.size + ' 条 exact 路由:')
for (const p of routes.keys()) console.log('    ' + p)
console.log('')

/** 模拟 exact 匹配：忽略 query，取 pathname 精确命中 */
function pick(pathname) {
  return routes.get(pathname.split('?')[0]) || null
}

function call(pathname) {
  return new Promise((resolve) => {
    const h = pick(pathname)
    if (!h) {
      resolve({ status: 404, body: { error: 'no exact route for ' + pathname } })
      return
    }
    const req = Object.assign(Readable.from([]), {
      method: 'GET',
      url: pathname,
      socket: { remoteAddress: '127.0.0.1' },
      headers: {},
    })
    let status = 0
    let text = ''
    const res = {
      writeHead(c) { status = c; return this },
      end(chunk) { if (chunk !== undefined) text += chunk },
    }
    h(req, res).then(() => {
      let body = null
      try { body = JSON.parse(text) } catch { body = { _raw: text.slice(0, 200) } }
      resolve({ status, body })
    })
  })
}

const results = []
const ok = (cond, label, detail) => results.push((cond ? '  [OK]   ' : '  [FAIL] ') + label + (detail ? '  ' + detail : ''))

// 1) 设置与状态
let r = await call('/plugin/netease-music/settings')
ok(r.body && r.body.settings && r.body.settings.quality, 'GET /settings 返回 settings.quality', 'quality=' + (r.body.settings && r.body.settings.quality))
ok(r.body && r.body.settings && r.body.settings.modules, 'GET /settings 含 modules', JSON.stringify(r.body.settings && r.body.settings.modules))
r = await call('/plugin/netease-music/status')
ok(r.body && r.body.ready === true, 'GET /status ready=true')

// 2) 账号
r = await call('/plugin/netease-music/api?method=%2Flogin%2Fstatus')
const acctData = r.body.body && r.body.body.data
const uid = acctData && ((acctData.account && acctData.account.id) || (acctData.profile && acctData.profile.userId))
// 只断言「能取到一个数字 uid」，不写死具体账号 —— uid 是个人标识，不该进仓库
ok(uid !== undefined && uid !== null && /^\d+$/.test(String(uid)), '/login/status 能取到 uid（account.id 或 profile.userId）', '实际=' + uid + ' 有account=' + Boolean(acctData && acctData.account))

// 3) 每日推荐
r = await call('/plugin/netease-music/api?method=%2Frecommend%2Fsongs')
const daily = r.body.body && r.body.body.data && r.body.body.data.dailySongs
ok(Array.isArray(daily) && daily.length > 0, '/recommend/songs 返回 data.dailySongs', '首数=' + (daily ? daily.length : 'null'))

// 4) 歌单列表
r = await call('/plugin/netease-music/api?method=%2Fuser%2Fplaylist&uid=' + encodeURIComponent(String(uid)) + '&limit=200')
const pls = r.body.body && r.body.body.playlist
ok(Array.isArray(pls) && pls.length > 0, '/user/playlist 返回 playlist', '歌单数=' + (pls ? pls.length : 'null'))

// 5) 歌单详情。优先取「我喜欢的音乐」(specialType=5)，拿不到就退回列表第一个 ——
//    歌单 id 同样与账号绑定，不写死。
const favPl = (pls || []).find((p) => p.specialType === 5) || (pls || [])[0]
r = await call('/plugin/netease-music/api?method=%2Fplaylist%2Fdetail&id=' + (favPl ? favPl.id : '') + '&n=1000')
const plDetail = r.body.body && r.body.body.playlist
ok(plDetail && Array.isArray(plDetail.tracks) && plDetail.tracks.length > 0, '/playlist/detail 返回 playlist.tracks', '曲数=' + (plDetail && plDetail.tracks ? plDetail.tracks.length : 'null'))
ok(plDetail && plDetail.coverImgUrl !== undefined, '/playlist/detail 含 coverImgUrl')

// 6) 歌词
r = await call('/plugin/netease-music/api?method=%2Flyric&id=186016')
const lrc = r.body.body && r.body.body.lrc && r.body.body.lrc.lyric
const tlrc = r.body.body && r.body.body.tlyric && r.body.body.tlyric.lyric
ok(typeof lrc === 'string' && lrc.length > 0, '/lyric 返回 lrc.lyric', '长度=' + (lrc ? lrc.length : 0))
ok(typeof tlrc === 'string' && tlrc.length > 0, '/lyric 返回 tlyric.lyric（翻译）', '长度=' + (tlrc ? tlrc.length : 0))

// 7) 搜索（歌曲 + 歌单）
r = await call('/plugin/netease-music/api?method=%2Fcloudsearch&keywords=' + encodeURIComponent('晴天') + '&type=1&limit=5')
const sSongs = r.body.body && r.body.body.result && r.body.body.result.songs
ok(Array.isArray(sSongs) && sSongs.length > 0, '/cloudsearch type=1 返回 result.songs', '首数=' + (sSongs ? sSongs.length : 'null'))
r = await call('/plugin/netease-music/api?method=%2Fcloudsearch&keywords=' + encodeURIComponent('纯音乐') + '&type=1000&limit=5')
const sPls = r.body.body && r.body.body.result && r.body.body.result.playlists
ok(Array.isArray(sPls) && sPls.length > 0, '/cloudsearch type=1000 返回 result.playlists', '数=' + (sPls ? sPls.length : 'null'))

// 8) 音质全档位（核心需求）
console.log('  音质档位实测（曲 287398）:')
for (const lv of ['standard', 'higher', 'exhigh', 'lossless', 'hires', 'jyeffect', 'jymaster']) {
  r = await call('/plugin/netease-music/api?method=%2Fsong%2Furl%2Fv1&id=287398&level=' + lv)
  const d = r.body.body && r.body.body.data && r.body.body.data[0]
  const hasUrl = !!(d && typeof d.url === 'string' && d.url.length > 10)
  const httpsUrl = hasUrl && d.url.startsWith('https://')
  ok(hasUrl && httpsUrl, 'level=' + lv.padEnd(9) + ' br=' + String(d && d.br).padEnd(8) + ' type=' + String(d && d.type).padEnd(5) + ' sr=' + (d && d.sr), '')
}

// 9) 私人FM：以前这条断言的是"必须报 weapi 错误"，而那个结论是错的 ——
//    真账号实测明文 GET /api/v1/radio/get 返回 code=200 + 3 首完整歌曲。
//    宿主已改成真实调用，所以这里断言新行为：200 + data 是非空数组 + 字段形状
//    满足客户端 norm()（id / name / artists[] / duration 毫秒）。
r = await call('/plugin/netease-music/api?method=%2Fpersonal_fm')
{
  const b = r.body && r.body.body
  const arr = b && b.data
  const first = Array.isArray(arr) && arr[0]
  ok(
    r.body.status === 200 && b.code === 200 && Array.isArray(arr) && arr.length > 0,
    '/personal_fm 返回 code=200 且 data 非空',
    'status=' + r.body.status + ' code=' + (b && b.code) + ' n=' + (Array.isArray(arr) ? arr.length : '?')
  )
  ok(
    !!first && first.id !== undefined && typeof first.name === 'string' &&
      Array.isArray(first.artists) && typeof first.duration === 'number' && first.duration > 3600,
    '  FM 字段满足客户端 norm()（id/name/artists[]/duration 毫秒）',
    first ? 'duration=' + first.duration : '无数据'
  )
}

// 10) 扫码登录三步（只验证 key/create，不真扫）
r = await call('/plugin/netease-music/api?method=%2Flogin%2Fqr%2Fkey')
const unikey = r.body.body && r.body.body.data && r.body.body.data.unikey
ok(!!unikey, '/login/qr/key 返回 data.unikey', unikey ? unikey.slice(0, 12) + '…' : 'null')
if (unikey) {
  r = await call('/plugin/netease-music/api?method=%2Flogin%2Fqr%2Fcreate&key=' + unikey)
  const qrimg = r.body.body && r.body.body.data && r.body.body.data.qrimg
  ok(typeof qrimg === 'string' && qrimg.startsWith('data:image/svg+xml;base64,'), '/login/qr/create 返回 data.qrimg（SVG data URL）', '长度=' + (qrimg ? qrimg.length : 0))
}

// 11) 非本机来源应被拒。
//
// **这条以前一直是红的，而且红得有理 —— 是测试自己写错了，不是安全漏洞。**
// 桩里填的是 remoteAddress: '127.0.0.1'，那恰恰是本机地址，守卫按设计放行，
// 它却断言 403。名字说"非本机来源"，数据给的是本机，自相矛盾。
// （隔离验证过：把 lib/index.js 换回 HEAD 版本，这条同样红 —— 与 FM 改动无关。）
//
// 守卫在 handle() 里，而注册的 handler 会调 handle()，所以换掉 IP 就能真的测到。
// 顺带把"本机仍应放行"也钉上 —— 只测拒绝、不测放行，等于半个测试。
async function rawCall(pathname, ip) {
  return new Promise((resolve) => {
    const req = Object.assign(Readable.from([]), {
      method: 'GET',
      url: pathname,
      socket: { remoteAddress: ip },
      headers: {},
    })
    let status = 0
    let text = ''
    const res = { writeHead(c) { status = c; return this }, end(ch) { if (ch) text += ch } }
    pick(pathname)(req, res).then(() => resolve({ status, text }))
  })
}
r = await rawCall('/plugin/netease-music/settings', '203.0.113.9')
ok(r.status === 403, '非 loopback 请求被拒 403', 'status=' + r.status)
r = await rawCall('/plugin/netease-music/settings', '::ffff:127.0.0.1')
ok(r.status === 200, 'loopback（IPv6 映射形式）仍然放行', 'status=' + r.status)

// 12) AI 指令通道（/commands）。
//
// 这条路由以前**从来没在宿主实现过** —— 客户端每 1.2 秒拿到 404，异常被 catch 静默吞掉
// （档案 #13「静默失败最贵」）。客户端那半一直齐着，只差宿主。这组断言钉住：
// 能投递、能领取、领过的不重发、未知指令被拒。
async function rawFetch(pathname, opts) {
  const o = opts || {}
  const payload = o.body ? [Buffer.from(JSON.stringify(o.body), 'utf8')] : []
  return new Promise((resolve) => {
    const req = Object.assign(Readable.from(payload), {
      method: o.method || 'GET',
      url: pathname,
      socket: { remoteAddress: o.ip || '127.0.0.1' },
      headers: o.headers || {},
    })
    let status = 0
    let text = ''
    const res = { writeHead(c) { status = c; return this }, end(ch) { if (ch) text += ch } }
    pick(pathname)(req, res).then(() => {
      let body = null
      try { body = JSON.parse(text) } catch { body = { _raw: String(text).slice(0, 200) } }
      resolve({ status, body })
    })
  })
}

r = await rawFetch('/plugin/netease-music/commands', { method: 'POST', body: { type: 'toggle' } })
const postedSeq = r.body && r.body.seq
ok(r.status === 200 && r.body && r.body.ok === true && Number(postedSeq) >= 1,
  'POST /commands 投递一条指令并返回递增 seq', 'seq=' + postedSeq)

r = await rawFetch('/plugin/netease-music/commands?since=0')
const cmds = (r.body && r.body.commands) || []
ok(Array.isArray(cmds) && cmds.some((c) => c.type === 'toggle'),
  'GET /commands?since=0 能领到刚才那条', '条数=' + cmds.length)
ok(r.body && Number(r.body.since) === Number(postedSeq),
  'GET /commands 的 since 等于最新 seq', 'since=' + (r.body && r.body.since))

r = await rawFetch('/plugin/netease-music/commands?since=' + postedSeq)
ok(r.body && Array.isArray(r.body.commands) && r.body.commands.length === 0,
  'GET /commands?since=<最新> 返回空（领过的不重发）', '条数=' + (r.body && r.body.commands && r.body.commands.length))

r = await rawFetch('/plugin/netease-music/commands', { method: 'POST', body: { type: 'formatDisk' } })
ok(r.body && r.body.ok === false && /未知指令/.test(String(r.body.error)),
  'POST /commands 拒绝未知指令类型', String(r.body && r.body.error).slice(0, 60))

// 12b) /state 读写分离。
//
// 以前 GET 也会走进"上报"分支：空 body 解析成 {} 把已存状态清空，再返回 {ok:true}。
// 客户端上报的东西存进去了却读不出来，一读还抹掉。这里钉住写进去能读回来、且读不覆盖。
r = await rawFetch('/plugin/netease-music/state', {
  method: 'POST',
  body: { song: { id: '287398', name: '测试曲' }, playing: true, playMode: 'sequence', volume: 0.8 },
})
ok(r.body && r.body.ok === true, 'POST /state 存入播放状态', JSON.stringify(r.body).slice(0, 60))

r = await rawFetch('/plugin/netease-music/state')
const st = r.body && r.body.state
ok(st && st.song && String(st.song.id) === '287398' && st.playing === true,
  'GET /state 能读回刚存的播放状态', st ? 'song=' + (st.song && st.song.name) + ' playing=' + st.playing : 'state=null')

r = await rawFetch('/plugin/netease-music/state')
ok(r.body && r.body.state && r.body.state.song && String(r.body.state.song.id) === '287398',
  '再 GET 一次仍然读得到（读不覆盖）', '不应当被清空')

// 13) DNS rebinding 防护。
//
// 只校验 IP 不够：恶意域名解析到 127.0.0.1 时 remoteAddress 依然是本机，
// 但浏览器发来的 Host 是那个域名。这里钉住"带点的主机名一律拒"，
// 同时钉住 127.0.0.1 / localhost 照常放行（只测拒绝不测放行等于半个测试）。
r = await rawFetch('/plugin/netease-music/settings', { headers: { host: 'evil.example.com' } })
ok(r.status === 403, 'Host 是公网域名时被拒（DNS rebinding 防护）', 'status=' + r.status)
r = await rawFetch('/plugin/netease-music/settings', { headers: { host: 'dsh-app' } })
ok(r.status === 200, 'Host 是无点的自定义协议名时放行', 'status=' + r.status)
r = await rawFetch('/plugin/netease-music/settings', { headers: { host: '127.0.0.1:65362' } })
ok(r.status === 200, 'Host 是 127.0.0.1:port 时放行', 'status=' + r.status)
r = await rawFetch('/plugin/netease-music/settings', { headers: { host: 'localhost:65362' } })
ok(r.status === 200, 'Host 是 localhost:port 时放行', 'status=' + r.status)

console.log(results.join('\n'))
const fails = results.filter((x) => x.startsWith('  [FAIL]')).length
console.log('')
console.log('通过 ' + (results.length - fails) + '/' + results.length + (fails ? '  —— 有失败项' : '  —— 全部通过'))
