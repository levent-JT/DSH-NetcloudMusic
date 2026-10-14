// Host 半端到端自检：用桩 ctx 加载 lib/index.js，模拟客户端全部路由调用。
// 验证每个返回体是否满足 lib/client.js 的字段期望。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'

// 项目根目录从脚本自身位置推导 —— 不把开发机的绝对路径写进仓库，
// 别人 clone 下来放在任何位置都能直接跑。
const PROJ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TEST_DIR = process.env.TEMP + '/nm-host-test'
fs.mkdirSync(TEST_DIR, { recursive: true })
process.env.DSH_PROFILE_DIR = TEST_DIR.replace(/\//g, '\\')

// 登录态从插件自己的状态文件读取 —— 不把凭据写进测试脚本。
//
// 路径解析必须和 lib/index.js 里的 dataDir() 完全一致：宿主那边
// DSH_PROFILE_DIR 可能是加载插件之后才设进进程环境的，所以实际落点是
// DSH_HOME。这里如果写死 profiles/desktop 就会读到一份过期的旧配置
// （这个坑真踩过：旧文件停在更早的时间，cookie 早已轮换）。
function resolveDataDir() {
  return (
    process.env.DSH_PROFILE_DIR ||
    process.env.DSH_HOME ||
    path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh')
  )
}
const REAL_STORE = path.join(resolveDataDir(), 'netease-music.json')
const COOKIE_STR = JSON.parse(fs.readFileSync(REAL_STORE, 'utf8')).cookie

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

// 9) 未实现接口应给出明确报错而非静默失败
r = await call('/plugin/netease-music/api?method=%2Fpersonal_fm')
ok(r.body.status === 502 && /weapi/.test(r.body.body.message || ''), '/personal_fm 明确报错（含 weapi 提示）', 'status=' + r.body.status)

// 10) 扫码登录三步（只验证 key/create，不真扫）
r = await call('/plugin/netease-music/api?method=%2Flogin%2Fqr%2Fkey')
const unikey = r.body.body && r.body.body.data && r.body.body.data.unikey
ok(!!unikey, '/login/qr/key 返回 data.unikey', unikey ? unikey.slice(0, 12) + '…' : 'null')
if (unikey) {
  r = await call('/plugin/netease-music/api?method=%2Flogin%2Fqr%2Fcreate&key=' + unikey)
  const qrimg = r.body.body && r.body.body.data && r.body.body.data.qrimg
  ok(typeof qrimg === 'string' && qrimg.startsWith('data:image/svg+xml;base64,'), '/login/qr/create 返回 data.qrimg（SVG data URL）', '长度=' + (qrimg ? qrimg.length : 0))
}

// 11) 非本机来源应被拒
r = await new Promise((resolve) => {
  const req = Object.assign(Readable.from([]), {
    method: 'GET',
    url: '/plugin/netease-music/settings',
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
  })
  let status = 0
  let text = ''
  const res = { writeHead(c) { status = c; return this }, end(ch) { if (ch) text += ch } }
  pick('/plugin/netease-music/settings')(req, res).then(() => resolve({ status, text }))
})
ok(r.status === 403, '非 loopback 请求被拒 403', 'status=' + r.status)

console.log(results.join('\n'))
const fails = results.filter((x) => x.startsWith('  [FAIL]')).length
console.log('')
console.log('通过 ' + (results.length - fails) + '/' + results.length + (fails ? '  —— 有失败项' : '  —— 全部通过'))
