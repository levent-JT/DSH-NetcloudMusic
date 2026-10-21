// dsh-netease-music — Host 半
//
// 本文件是「直连模式」重写版：不走本地 NeteaseCloudMusicApi 服务，
// 而是直接调用 music.163.com 的明文 /api/ 端点（零第三方依赖、零加密）。
//
// 客户端 lib/client.js 复用自 JasonCHTT/dsh-netease-music（MIT），
// 它只认下面这套宿主路由契约，因此客户端无需改动：
//   GET  /plugin/netease-music/api?method=<名称>&<参数>   -> { status, body }
//   GET  /plugin/netease-music/settings                   -> { settings }
//   POST /plugin/netease-music/settings   (patch)         -> { ok, settings }
//   POST /plugin/netease-music/cookie     { cookie }      -> { ok }
//   POST /plugin/netease-music/logout                     -> { ok }
//   GET  /plugin/netease-music/status                     -> { ready, port }
//   POST /plugin/netease-music/restart                    -> { ok }
//   POST /plugin/netease-music/state      (播放状态上报)   -> { ok }
//
// 端点映射与坑点均经实测确认，逐条标注见下。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { qrToSvgDataUrl } from '../vendor/qr.mjs'

export const name = 'dsh-netease-music'
export const inject = ['webServer']

const ROUTE = '/plugin/netease-music'
const BASE = 'https://music.163.com'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// 状态文件放在 profile 目录（与 DSH 的 profile 数据同级），而不是 home 根
const DATA_DIR =
  process.env.DSH_PROFILE_DIR || process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const STORE_FILE = path.join(DATA_DIR, 'netease-music.json')

/** 客户端布局自检的最近一次回传（见 callNetease 的 /diag 分支）。 */
let lastClientDiag = ''

// ---- AI 指令通道 ----
//
// 客户端每 1.2 秒轮询 GET /commands?since=<seq>，取 seq 较大的指令逐条执行；
// runCommand 支持 playSong / pause / toggle / next / previous / setMode / volume /
// playDaily / playPlaylist 九种。外部（AI、脚本、curl）用 POST /commands 投一条。
//
// **这条路由以前从来没实现过** —— 客户端每 1.2 秒拿到 404，异常被 catch 静默吞掉
// （档案 #13「静默失败最贵」）。客户端那半一直是齐的，只差宿主这半。
const COMMAND_TYPES = new Set([
  'playSong', 'pause', 'toggle', 'next', 'previous',
  'setMode', 'volume', 'playDaily', 'playPlaylist',
])
/** 待领取的指令。只留最近 50 条且不超过 5 分钟 —— 这是实时通道，不是消息队列。 */
let commandQueue = []
let commandSeq = 0

/**
 * 「自动最高」的探测链。
 *
 * 实测（黑胶VIP）：请求 jymaster 时网易云**自己会降级**——有母带的给母带
 * （5.6Mbps/192kHz），只有 mp3 的降级成 320k。所以绝大多数情况第一个就命中。
 * 这条链只为「jymaster 完全取不到」兜底：实测数字专辑（如 晴天 186016）
 * 在任何档位都返回 404，此时需要逐级下探确认；按失败代价从低到高排列。
 */
const AUTO_CHAIN = ['jymaster', 'exhigh', 'standard']

/** 默认设置。modules.fm 控制「私人FM」页签是否出现（接口实测明文可用，见 /personal_fm）。 */
const DEFAULT_SETTINGS = {
  quality: 'auto',
  playMode: 'sequence',
  volume: 0.8,
  modules: { daily: true, playlist: true, fm: true, lyrics: true, history: true, volume: true },
  // 播放页背景（氛围式）：mode = off | cover | cover-lyrics
  // panelAlpha 是界面面板的 alpha：越小背景越透，但文字越难读。
  // 0.30 是折中值，用户可在设置页四个滑杆里现场调。
  //
  // style = 播放页样式，对应官方「播放器样式」的设计方向：
  //   immersive 沉浸式（歌词居中当主角 + 底部极简控制条，对齐 PC 端全屏播放页）
  //   minimal   极简（【极简主义】Less is more，大封面、无机械结构）
  //   classic   经典黑胶（唱针角度随播放进度移动）
  //   color     青春彩胶（半透明彩胶盘，整体氛围用封面取色）
  ambient: {
    // DSH 皮肤总开关：关掉只影响"给 DSH 换皮"，听歌功能一行不少。
    enabled: true,
    mode: 'cover-lyrics',
    style: 'immersive',
    deck: true,
    dim: 0.55,
    blur: 44,
    lyricSize: 22,
    panelAlpha: 0.45,
    // 磨砂范围：layout = 只磨工具面/浮层，常驻版式区域（主对话区、左侧栏）保持完全透明。
    // all = 所有透明面都磨；off = 不磨。审美取舍，交给用户。
    frost: 'layout',
    trans: true,
    auto: true,
    /**
     * 启动渲染动画：每次 DSH 启动时播一次（封面 → 加滤镜变背景 → 歌词 → 主界面分条揭开）。
     *
     * 为什么挂在 ambient 下：它和背景用的是同一套素材（封面/歌词/配色），
     * 用户关掉 DSH 皮肤时通常也不想看这个动画。但它**独立生效** —— 单独关掉 ambient.enabled
     * 不会关掉动画，两者互不依赖（动画全部用自己的 DOM，不碰皮肤那条链）。
     */
    boot: true,
  },
  // 缓存。刻意和宿主自己的配置文件分开：
  //   · 配置（cookie / settings）是"必须有、且很小"的东西，写在 DATA_DIR；
  //   · 缓存是"可丢、会长大"的东西，写到用户指定的目录，随时删掉都不影响使用。
  // 混在一起的话，缓存膨胀会连带把凭据文件撑大，清理时也容易误伤配置。
  cache: {
    // 缓存文件所在目录。留空 = 与配置文件同目录。
    dir: '',
    // 音质探测缓存最多记多少首（宿主侧，按时间淘汰）。0 = 不限制（不推荐）。
    max: 800,
    /**
     * 客户端三套缓存的条目上限（用户可在设置页调）。
     * 放在宿主默认值里，客户端从 /settings 读 —— "默认值"只有一份，
     * 不会出现客户端写 12、宿主写 20 的不一致。
     *
     * 0 表示不缓存（会立即清空并停止写入）。
     */
    clientLimits: { url: 12, lyric: 40, cover: 300 },
    },
}

const store = {
  cookie: '',
  settings: { ...DEFAULT_SETTINGS, modules: { ...DEFAULT_SETTINGS.modules } },
  state: null,
  // 音质探测缓存：songId -> { level, at }
  //
  // 为什么值得缓存：AUTO_CHAIN 是「先试 jymaster，取不到才降到 exhigh、standard」。
  // 一首只有 320k 的歌，每次播放都要白试一次母带请求。记住探测结果后同一首歌
  // 第二次起直接命中，省 1~2 次请求。
  //
  // 只缓存的「档位」而不是 URL —— 网易云的直链有有效期，缓存 URL 会拿到过期的。
  // 缓存的档位万一失效（歌曲下架等），下面会自动落回完整探测链，不会卡死。
  qualityCache: {},
}

/** 缓存文件的默认位置：与配置文件同目录。设置里 cache.dir 非空时以设置为准。 */
function cacheDir() {
  const dir = (store.settings.cache && store.settings.cache.dir) || ''
  return dir ? path.resolve(dir) : DATA_DIR
}
function cacheFilePath() {
  return path.join(cacheDir(), 'netease-music-cache.json')
}
/** 当前生效的缓存上限。0 或负数表示不限制。 */
function cacheMax() {
  const n = Number(store.settings.cache && store.settings.cache.max)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

let cacheSaveTimer = null
/**
 * 探测缓存变化后延迟落盘：播放切歌很频繁，不值得每次都写文件。
 * 注意写的是**缓存文件**，不是配置文件 —— 缓存丢了不影响使用，配置丢了要重新登录。
 */
function saveCacheSoon() {
  if (cacheSaveTimer) clearTimeout(cacheSaveTimer)
  cacheSaveTimer = setTimeout(() => {
    cacheSaveTimer = null
    saveCache()
  }, 1500)
}

function saveCache() {
  try {
    const file = cacheFilePath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 1, quality: store.qualityCache }, null, 0),
      'utf8',
    )
  } catch (e) {
    console.error('[netease] 缓存写入失败: ' + String(e && e.message) + '（不影响播放）')
  }
}

function loadCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFilePath(), 'utf8'))
    if (raw && raw.quality && typeof raw.quality === 'object') store.qualityCache = raw.quality
    console.log('[netease] 已加载音质探测缓存 — ' + Object.keys(store.qualityCache).length + ' 首')
  } catch {
    // 没有缓存文件是完全正常的情况（首次运行 / 用户删过），不打印错误
  }
}

function rememberQuality(songId, level) {
  if (!songId) return
  const hit = store.qualityCache[songId]
  if (hit && hit.level === level) {
    hit.at = Date.now()
    return
  }
  store.qualityCache[songId] = { level, at: Date.now() }
  const max = cacheMax()
  if (max > 0) {
    const keys = Object.keys(store.qualityCache)
    if (keys.length > max) {
      keys.sort((a, b) => (store.qualityCache[a].at || 0) - (store.qualityCache[b].at || 0))
      for (const k of keys.slice(0, keys.length - max)) delete store.qualityCache[k]
    }
  }
  saveCacheSoon()
}

/**
 * 设置默认值升级。
 *
 * 逐键合并（DEFAULT_SETTINGS ← 用户配置）意味着**改了默认值对老用户不生效** ——
 * 旧默认值早就存进配置文件了，用户配置那份会赢。所以默认值有实质改动时，
 * 必须在这里做一次性迁移，并且只搬「还停在旧默认值」的项：
 * 用户手动调过的值一律不碰。
 */
function migrateSettings() {
  const marks = (store.settings.migrations = store.settings.migrations || {})
  const amb = store.settings.ambient
  // v1：界面透明度 0.30 → 0.45。
  // 背景峰值亮度被封顶（见客户端第 8 层薄纱）之后，界面可以再透一点仍然清晰。
  if (!marks.panelAlpha && amb.panelAlpha === 0.3) {
    amb.panelAlpha = 0.45
    marks.panelAlpha = true
    saveStore()
    console.log('[netease] 设置迁移：界面透明度 0.30 → 0.45（背景峰值已被封顶，可以更透）')
  }
  // v2：私人FM 页签默认打开。
  // 旧默认值是 false —— 当时以为"FM 需要 weapi、本插件做不到"，所以默认藏起来。
  // 实测明文 GET /api/v1/radio/get 就能用，所以这个 false 不是用户的选择，
  // 是我们替他做的一个基于错误结论的决定，该还回去。
  // 只搬"还停在旧默认值 false"的：用户如果后来自己关过，就尊重他。
  if (!marks.fmModule && store.settings.modules.fm === false) {
    store.settings.modules.fm = true
    marks.fmModule = true
    saveStore()
    console.log('[netease] 设置迁移：私人FM 页签默认打开（接口实测明文可用）')
  }
}

function loadStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'))
    if (typeof raw.cookie === 'string') store.cookie = raw.cookie
    if (raw.settings && typeof raw.settings === 'object') {
      store.settings = {
        ...DEFAULT_SETTINGS,
        ...raw.settings,
        modules: { ...DEFAULT_SETTINGS.modules, ...(raw.settings.modules || {}) },
        // 逐键合并：旧配置文件里没有某个字段时不能整块丢失默认值
        ambient: { ...DEFAULT_SETTINGS.ambient, ...(raw.settings.ambient || {}) },
        cache: { ...DEFAULT_SETTINGS.cache, ...(raw.settings.cache || {}) },
      }
    }
    console.log(
      '[netease] 已加载设置 — 登录态: ' + (store.cookie ? '有' : '无') + ' | 音质: ' + store.settings.quality,
    )
    // 早期版本把探测缓存塞在配置文件里。读到就搬走，之后配置文件不再写缓存。
    if (raw.qualityCache && typeof raw.qualityCache === 'object' && !Object.keys(store.qualityCache).length) {
      store.qualityCache = raw.qualityCache
      console.log('[netease] 从旧配置文件迁移了 ' + Object.keys(store.qualityCache).length + ' 首探测缓存')
    }
  } catch {
    console.log('[netease] 无既有配置，使用默认设置')
  }
}

function saveStore() {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true })
    // 0600：文件含 MUSIC_U 登录凭据。
    // 这里**只写配置和凭据**，不写缓存 —— 缓存走独立的文件（cacheFilePath），
    // 免得缓存膨胀把凭据文件撑大，也免得清理缓存时误伤配置。
    fs.writeFileSync(
      STORE_FILE,
      JSON.stringify({ cookie: store.cookie, settings: store.settings }, null, 2),
      { encoding: 'utf8', mode: 0o600 },
    )
  } catch (e) {
    console.error('[netease] 配置写入失败: ' + String(e && e.message))
  }
}

// ── 网易云调用 ────────────────────────────────────────────────────────────

/** os/appver 是接口必需的环境标记；MUSIC_U/__csrf 才是账号态。 */
function cookieHeader() {
  const parts = ['os=pc', 'appver=8.9.70']
  const m = store.cookie.match(/MUSIC_U=([^;\s]+)/i)
  const c = store.cookie.match(/__csrf=([^;\s]+)/i)
  if (m) parts.push('MUSIC_U=' + m[1])
  if (c) parts.push('__csrf=' + c[1])
  return parts.join('; ')
}

async function netease(pathname, { method = 'GET', form } = {}) {
  const init = {
    method,
    headers: {
      'User-Agent': UA,
      Referer: BASE + '/',
      Cookie: cookieHeader(),
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  }
  if (form) {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded'
    init.body = new URLSearchParams(form).toString()
  }
  const res = await fetch(BASE + pathname, init)
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('网易云返回了非 JSON 内容（可能被风控）')
  }
}

const encIds = (v) => encodeURIComponent('[' + v + ']')

// ── eapi 加密通道 ────────────────────────────────────────────────────────
//
// 为什么需要它：**写操作走明文 /api/ 一律被网易云风控拒绝**，返回
// `code=524 当前环境异常`。实测排除了以下原因（都不是）：
//   csrf_token 缺失 / 环境 cookie（NMTID、WNMCID、_ntes_nuid）/
//   易盾反作弊 token（X-antiCheatToken，动态与静态都试过）/
//   伪造中国 IP 头（X-Real-IP、X-Forwarded-For）/ MUSIC_A 匿名 token
// 真正的分界是通道：api-enhanced 的 request.js 里
//   `if (crypto === '') crypto = APP_CONF.encrypt ? 'eapi' : 'api'`
// 而它的 config.json 是 `encrypt: true`，所以那些看起来传了 crypto='' 的写模块
// （如 song_like.js）其实全部走 eapi。改走 eapi 后写操作立刻 code=200。
//
// eapi 比 weapi 简单得多：AES-128-ECB + MD5，不需要 RSA。
//   message = `nobody${path}use${text}md5forencrypt`
//   payload = `${path}-36cd479b6b5-${text}-36cd479b6b5-${md5(message)}`
//   params  = AES-128-ECB(payload, 'e82ckenh8dichen8') → HEX 大写
const EAPI_KEY = Buffer.from('e82ckenh8dichen8')
const EAPI_DOMAIN = 'https://interface.music.163.com'
const UA_ANDROID =
  'NeteaseMusic/9.5.61.260802021928(9005061);Dalvik/2.1.0 (Linux; U; Android 12; HBN-AL00 Build/cd737a2.0)'

function eapiParams(pathname, data) {
  const text = JSON.stringify(data)
  const digest = crypto.createHash('md5').update('nobody' + pathname + 'use' + text + 'md5forencrypt').digest('hex')
  const payload = pathname + '-36cd479b6b5-' + text + '-36cd479b6b5-' + digest
  const cipher = crypto.createCipheriv('aes-128-ecb', EAPI_KEY, null)
  return Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]).toString('hex').toUpperCase()
}

/** eapi 用移动端环境标记——实测写操作在此环境下通过，与 os=pc 不同。 */
function eapiCookieHeader() {
  const parts = ['os=android', 'appver=9.5.61']
  const m = store.cookie.match(/MUSIC_U=([^;\s]+)/i)
  const c = store.cookie.match(/__csrf=([^;\s]+)/i)
  if (m) parts.push('MUSIC_U=' + m[1])
  if (c) parts.push('__csrf=' + c[1])
  return parts.join('; ')
}

/** 通过 eapi 通道 POST。用于所有写操作。 */
async function eapiCall(pathname, data) {
  const params = eapiParams(pathname, data)
  const res = await fetch(EAPI_DOMAIN + '/eapi' + pathname, {
    method: 'POST',
    headers: {
      'User-Agent': UA_ANDROID,
      Referer: BASE + '/',
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: eapiCookieHeader(),
    },
    body: 'params=' + encodeURIComponent(params),
    signal: AbortSignal.timeout(20000),
  })
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('eapi 返回了非 JSON 内容（可能被风控）')
  }
}

// ── 账号相关的惰性缓存 ────────────────────────────────────────────────────
// uid 与「我喜欢的音乐」歌单 id 在一次会话里是稳定的，缓存避免每次红心都多打两次请求。
// 注意：Cookie 变更时必须清掉（见 /cookie 与 /logout 处理）。
let cachedUid = 0
let cachedLikedPid = 0

function resetAccountCache() {
  cachedUid = 0
  cachedLikedPid = 0
}

async function currentUid() {
  if (cachedUid) return cachedUid
  const acct = await netease('/api/nuser/account/get')
  if (acct && acct.profile && acct.profile.userId) cachedUid = acct.profile.userId
  if (!cachedUid) throw new Error('未登录：拿不到 uid，请先在设置页填写 Cookie')
  return cachedUid
}

/** 找「我喜欢的音乐」（specialType=5）的歌单 id。 */
async function likedPlaylistId() {
  if (cachedLikedPid) return cachedLikedPid
  const uid = await currentUid()
  const j = await netease('/api/user/playlist?uid=' + uid + '&limit=1000&offset=0')
  const found = (Array.isArray(j.playlist) ? j.playlist : []).find((p) => p.specialType === 5)
  if (!found) throw new Error('找不到「我喜欢的音乐」歌单（账号可能未初始化该歌单）')
  cachedLikedPid = found.id
  return cachedLikedPid
}

/**
 * method -> 真实端点映射。
 * 每个 case 的注释都标注了实测结论/坑点。
 */
async function callNetease(method, q) {
  // 客户端布局自检回传通道（仅本地调试用，不碰网易云）。
  // 为什么需要它：侧栏卡片的排版依赖 DSH 内部容器的 flex 行为，靠截图量像素
  // 既不准又慢。客户端把 getBoundingClientRect 的实测值回传到这里，
  // 我直接 GET 同一个 method 就能读到数字。
  //   写：/plugin/netease-music/api?method=/diag&data=<encodeURIComponent(json)>
  //   读：/plugin/netease-music/api?method=/diag
  if (method === '/diag') {
    if (typeof q.data === 'string' && q.data) {
      lastClientDiag = q.data.slice(0, 8000)
      return { code: 200, ok: true, bytes: lastClientDiag.length }
    }
    return { code: 200, report: lastClientDiag || '(客户端尚未回传)' }
  }

  // 缓存管理（同样是本地 op，不碰网易云）。客户端缓存由客户端自己报数，
  // 这里只负责宿主侧的音质探测缓存。
  if (method === '/cache/stats') {
    const entries = Object.values(store.qualityCache)
    const byLevel = {}
    for (const e of entries) {
      if (e && e.level) byLevel[e.level] = (byLevel[e.level] || 0) + 1
    }
    // 只报内存里的数字 + 几个纯字符串计算的路径。
    // **不 stat / 不读任何文件** —— 缓存落在哪由配置决定，宿主不去翻盘。
    return {
      code: 200,
      quality: entries.length,
      qualityByLevel: byLevel,
      cacheDir: cacheDir(),
      cacheFile: cacheFilePath(),
      cacheDirIsDefault: !(store.settings.cache && store.settings.cache.dir),
      // 只是把算好的路径字符串报出来，不做任何文件访问
      configFile: STORE_FILE,
    }
  }
  if (method === '/cache/clear') {
    const scope = q.scope || 'all'
    const before = Object.keys(store.qualityCache).length
    if (scope === 'all' || scope === 'quality') {
      store.qualityCache = {}
      if (cacheSaveTimer) {
        clearTimeout(cacheSaveTimer)
        cacheSaveTimer = null
      }
      saveCache()
    }
    return { code: 200, ok: true, cleared: before }
  }

  switch (method) {
    // 账号信息。返回里同时有 profile.userId 与 account.id。
    // 关键：客户端读的是 `status.data.account.id / status.data.profile.userId`
    // （NeteaseCloudMusicApi 的 /login/status 形状），而原始响应是
    // {code, account, profile} 平铺的 —— 必须补一层 data 包装，
    // 否则 uid 取不到，「我的歌单」会报「未登录」。
    case '/login/status': {
      const j = await netease('/api/nuser/account/get')
      return { ...j, data: { profile: j.profile || null, account: j.account || null } }
    }

    // 每日推荐。坑：/api/discovery/recommend/songs（不带 v1）会返回
    // code=200 但 dailySongs=0 —— 成功码配空数据，必须用 v1。
    case '/recommend/songs':
      return netease('/api/v1/discovery/recommend/songs')

    case '/user/playlist':
      return netease('/api/user/playlist?uid=' + q.uid + '&limit=1000&offset=0')

    case '/playlist/detail':
      return netease('/api/v6/playlist/detail?id=' + q.id + '&n=' + (q.n || 1000) + '&s=8')

    case '/song/detail':
      return netease('/api/song/detail?ids=' + encIds(String(q.ids || '')))

    // 歌词：无歌词/无翻译时返回空字符串而非报错。
    case '/lyric':
      return netease('/api/song/lyric?id=' + q.id + '&lv=-1&kv=-1&tv=-1&rv=-1')

    // 搜索。走 cloudsearch/pc 而非旧 search/get，才能同时拿到歌单（type=1000）。
    // 注意：实测该端点返回 code=0（不是 200），客户端只读 result.*，故不受影响。
    case '/cloudsearch':
      return netease('/api/cloudsearch/pc', {
        method: 'POST',
        form: {
          s: q.keywords || '',
          type: q.type || 1,
          limit: q.limit || 30,
          offset: q.offset || 0,
          total: 'true',
        },
      })

    // 心动模式：以一首歌为种子，从指定歌单出发生成相似推荐。
    // 坑：曲目嵌在 data[].songInfo 里，不是 data[] 顶层（顶层只有 id/alg/recommended），
    //     直接按顶层归一化会得到一堆无名歌曲。
    case '/playmode/intelligence/list':
      return netease('/api/playmode/intelligence/list', {
        method: 'POST',
        form: {
          songId: q.id,
          type: 'fromPlayOne',
          playlistId: q.pid || '',
          startMusicId: q.sid || q.id,
          count: q.count || 20,
        },
      })

    // 红心 / 取消红心。
    // 必须走 eapi（明文 /api/song/like 会被风控 524，见 EAPI_KEY 处的说明）。
    case '/song/like':
      return eapiCall('/api/song/like', {
        trackId: q.id,
        userid: await currentUid(),
        like: String(q.like) === 'false' ? 'false' : 'true',
        csrf_token: (store.cookie.match(/__csrf=([^;\s]+)/i) || [])[1] || '',
      })

    // 「我喜欢的音乐」里的曲目 id 列表（前端据此判断红心状态）。
    // n=0 只取 trackIds，不拉曲目详情，响应体积小很多。
    case '/like/ids': {
      const pid = await likedPlaylistId()
      const j = await netease('/api/v6/playlist/detail?id=' + pid + '&n=0&s=8')
      const ids = ((j.playlist && j.playlist.trackIds) || []).map((t) => t.id)
      return { code: 200, ids, playlistId: pid }
    }

    // 收藏到歌单 / 从歌单移除。同样必须走 eapi。
    case '/playlist/manipulate/tracks':
      return eapiCall('/api/playlist/manipulate/tracks', {
        op: String(q.op) === 'del' ? 'del' : 'add',
        pid: String(q.pid),
        trackIds: JSON.stringify(String(q.tids || q.id || '').split(',')),
        imme: 'true',
        csrf_token: (store.cookie.match(/__csrf=([^;\s]+)/i) || [])[1] || '',
      })

    // 播放直链。
    //  encodeType 恒用 flac —— 这是上游 api-enhanced 的做法，实测低档位
    //  （standard/higher/exhigh）依然正确返回 mp3 128/192/320。
    //  网易云会按账号权限静默降级，真实档位以返回的 br/type 为准。
    //  vivid/dolby（type=av3a）浏览器无法解码，客户端已不提供这些选项。
    case '/song/url/v1': {
      const want = q.level || store.settings.quality || 'auto'
      const songId = String(q.id || '')

      // 「自动最高」：实测网易云在请求 jymaster 时会自己降级到该曲实际最高档
      // （有母带给母带，只有 mp3 给 320k），所以绝大多数情况一个请求就够。
      // AUTO_CHAIN 只为「完全取不到链」兜底，见其定义处的注释。
      //
      // 命中探测缓存时把它排到最前面：既省掉重复的白试，又保留了兜底 ——
      // 万一缓存档位已经失效，后面几档照常会试。
      let chain = want === 'auto' ? AUTO_CHAIN : [want]
      if (want === 'auto' && songId && store.qualityCache[songId]) {
        const cached = store.qualityCache[songId].level
        chain = [cached].concat(AUTO_CHAIN.filter((lv) => lv !== cached))
      }

      let last = null
      let j = null
      let used = null
      for (const lv of chain) {
        const r = await netease(
          '/api/song/enhance/player/url/v1?ids=' + encIds(q.id) + '&level=' + lv + '&encodeType=flac',
        )
        last = r
        const d = Array.isArray(r.data) ? r.data[0] : null
        if (d && typeof d.url === 'string' && d.url.length > 10) {
          j = r
          used = lv
          break
        }
      }
      if (!j) j = last || { data: [] }
      // 只在「自动」模式下记，用户手动选了档位就尊重用户的选择，不要污染缓存。
      // 也只在真的拿到链时记 —— 取不到就缓存空值的话，一次网络抖动会被永久记住。
      if (want === 'auto' && used) rememberQuality(songId, used)
      // 关键：网易云返回的直链是 http:// 开头。DSH 页面运行在 https 下，
      // 浏览器会把 http 音频判为混合内容（mixed content）直接拦截，表现为
      // 「点了播放没反应」。同一 CDN 支持 https，必须就地改写。
      if (Array.isArray(j.data)) {
        for (const d of j.data) {
          if (typeof d.url === 'string' && d.url.startsWith('http://')) {
            d.url = 'https://' + d.url.slice('http://'.length)
          }
        }
      }
      return j
    }

    // 扫码登录三步。key/check 用 type=3（与上游一致）。
    case '/login/qr/key': {
      const j = await netease('/api/login/qrcode/unikey', { method: 'POST', form: { type: 3 } })
      return { code: 200, data: { unikey: j.unikey } }
    }

    // 本步不打网易云：上游也是本地生成二维码。
    case '/login/qr/create': {
      if (!q.key) return { code: 400, message: 'missing key' }
      const qrurl = 'https://music.163.com/login?codekey=' + q.key
      return { code: 200, data: { qrurl, qrimg: qrToSvgDataUrl(qrurl) } }
    }

    case '/login/qr/check': {
      const j = await netease('/api/login/qrcode/client/login', {
        method: 'POST',
        form: { key: q.key, type: 3 },
      })
      // 803 = 授权成功。此时把 Set-Cookie 拼成字符串交给客户端，
      // 客户端会把它 POST 回 /cookie 完成登录。
      let cookie = ''
      if (j.code === 803) {
        const codes = j.__setCookie || []
        cookie = codes.join('; ')
      }
      return { ...j, cookie: cookie || j.cookie || '' }
    }

    // 私人FM。
    //
    // **档案/注释以前写着"需要 weapi 加密，明文直连不支持"—— 那个结论是错的。**
    // 真账号实测：GET /api/v1/radio/get 带 os=pc;appver 环境标记就返回 code=200
    // 和 3 首完整歌曲（连打三次一致），不需要 weapi。
    // 返回形状 {code, data:[...]} 正是客户端 loadFm() 期望的；
    // duration 是毫秒、没有 dt，客户端 norm() 里那句 "values > 3600 are ms" 就是为它写的。
    // 一次只给 3 首是接口本身的行为，界面上的「换一批」再拉一次即可。
    case '/personal_fm':
      return netease('/api/v1/radio/get')

    default:
      throw new Error('未实现的接口: ' + method)
  }
}

// ── 扫码登录：需要截获 Set-Cookie ──────────────────────────────────────────
// 上面 netease() 只返回解析后的 body，拿不到响应头。
// 这里为 qr/check 单独实现一次请求，把 Set-Cookie 取出来。
async function qrCheck(key) {
  const res = await fetch(BASE + '/api/login/qrcode/client/login', {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Referer: BASE + '/',
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(),
    },
    body: new URLSearchParams({ key, type: 3 }).toString(),
    signal: AbortSignal.timeout(20000),
  })
  const text = await res.text()
  let body = {}
  try {
    body = JSON.parse(text)
  } catch {
    /* 保持空对象 */
  }
  let setCookies = []
  try {
    setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  } catch {
    setCookies = []
  }
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ')
  return { ...body, cookie }
}

// ── HTTP 处理 ────────────────────────────────────────────────────────────

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })

const sendJson = (res, obj, code = 200) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}

/**
 * 只响应本机请求：这些路由能读写登录凭据。
 *
 * 光校验 IP 不够 —— **DNS rebinding** 可以让一个恶意域名的请求也落在 127.0.0.1 上，
 * 此时 req.socket.remoteAddress 依然是 127.0.0.1，但浏览器发来的 Host 是那个域名。
 * 攻击者因此能读到我们不该给的响应（比如 /api?method=... 的返回）。
 *
 * 所以再校验 Host：带点的域名一律拒绝。白名单之外**不放行任何带 "点" 的主机名**，
 * 而 127.0.0.1 / localhost / ::1 / 无点的自定义协议名（DSH 的渲染进程就是 dsh-app）
 * 都照常放行 —— 这样既能拦住 rebinding，又不会误伤本地用法。
 */
function isLoopback(req) {
  const ip = req.socket && req.socket.remoteAddress
  if (!(ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1')) return false
  return !isRebindHost(req)
}

/** Host 头看起来像"被 rebinding 利用的公网域名"吗？ */
function isRebindHost(req) {
  const raw = String((req.headers && req.headers.host) || '').toLowerCase()
  if (!raw) return false                                   // 非浏览器请求没有 Host，放行
  const name = raw.replace(/:\d+$/, '')                    // 去掉端口
  if (name === 'localhost' || name === 'app' || name === 'dsh-app') return false
  if (name === '[::1]' || name === '::1') return false
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name)) return false   // IPv4 字面量
  return name.includes('.')                                // 其余带点的都当公网域名
}

async function handle(req, res) {
  const url = new URL(req.url || '/', 'http://localhost')
  const sub = url.pathname.slice(ROUTE.length) || '/'
  const method = req.method || 'GET'

  if (!isLoopback(req)) return sendJson(res, { error: 'loopback only' }, 403)

  // ---- 接口代理 ----
  if (sub === '/api') {
    const m = url.searchParams.get('method') || ''
    const q = Object.fromEntries(url.searchParams.entries())
    try {
      let body
      if (m === '/login/qr/check') body = await qrCheck(q.key)
      else body = await callNetease(m, q)
      return sendJson(res, { status: 200, body })
    } catch (e) {
      // 返回非 2xx，让客户端的 api() 抛错并展示 message
      return sendJson(res, { status: 502, body: { code: -1, message: String(e && e.message) } })
    }
  }

  // ---- 设置 ----
  if (sub === '/settings') {
    if (method === 'POST') {
      let patch = {}
      try {
        patch = JSON.parse((await readBody(req)) || '{}')
      } catch {
        /* 忽略 */
      }
      const next = { ...store.settings, ...patch }
      if (patch.modules) next.modules = { ...store.settings.modules, ...patch.modules }
      store.settings = next
      saveStore()
      return sendJson(res, { ok: true, settings: store.settings })
    }
    return sendJson(res, { settings: store.settings })
  }

  // ---- 连接状态。直连模式没有独立服务，恒为 ready ----
  if (sub === '/status') {
    return sendJson(res, { ready: true, port: 0, mode: 'direct', loggedIn: Boolean(store.cookie) })
  }

  // ---- 登录：接收整串 Cookie 并即时校验 ----
  if (sub === '/cookie') {
    let payload = {}
    try {
      payload = JSON.parse((await readBody(req)) || '{}')
    } catch {
      /* 忽略 */
    }
    const raw = String(payload.cookie || '')
    const m = raw.match(/MUSIC_U=([^;\s]+)/i) || raw.match(/^([0-9A-F]{100,})$/i)
    if (!m) return sendJson(res, { ok: false, error: '没找到 MUSIC_U，请粘贴完整 Cookie' })
    const prev = store.cookie
    store.cookie = /MUSIC_U=/i.test(raw) ? raw : 'MUSIC_U=' + m[1]
    try {
      const acct = await netease('/api/nuser/account/get')
      if (acct.code !== 200 || !acct.profile) throw new Error('登录态校验未通过，请重新获取 Cookie')
      saveStore()
      resetAccountCache()
      console.log('[netease] 登录成功: ' + acct.profile.nickname + ' (uid=' + acct.profile.userId + ')')
      return sendJson(res, { ok: true, profile: { nickname: acct.profile.nickname, uid: acct.profile.userId } })
    } catch (e) {
      store.cookie = prev
      return sendJson(res, { ok: false, error: String(e && e.message) })
    }
  }

  if (sub === '/logout') {
    store.cookie = ''
    resetAccountCache()
    saveStore()
    return sendJson(res, { ok: true })
  }

  // 客户端设置页有个「重启本地服务」按钮；直连模式无需重启，直接应答成功
  if (sub === '/restart') return sendJson(res, { ok: true, ready: true, port: 0 })

  // ---- AI 指令通道 ----
  if (sub === '/commands') {
    if (method === 'POST') {
      let payload = {}
      try {
        payload = JSON.parse((await readBody(req)) || '{}')
      } catch {
        /* 忽略 */
      }
      const type = String(payload.type || '')
      if (!COMMAND_TYPES.has(type)) {
        return sendJson(res, {
          ok: false,
          error: '未知指令: ' + (type || '(空)') + '；可用: ' + [...COMMAND_TYPES].join(', '),
        })
      }
      commandSeq += 1
      commandQueue.push({
        seq: commandSeq,
        at: Date.now(),
        type,
        payload: payload.payload && typeof payload.payload === 'object' ? payload.payload : {},
      })
      // 实时通道：太老的、太多的一律丢掉，避免内存无限增长
      const cutoff = Date.now() - 5 * 60 * 1000
      while (commandQueue.length && (commandQueue.length > 50 || commandQueue[0].at < cutoff)) {
        commandQueue.shift()
      }
      return sendJson(res, { ok: true, seq: commandSeq })
    }
    // GET：返回 since 之后还没被领走的
    const since = Number(url.searchParams.get('since')) || 0
    return sendJson(res, {
      since: commandSeq,
      commands: commandQueue.filter((c) => c.seq > since),
    })
  }

  // 播放状态：客户端 POST 上报，外部 GET 读取。
  //
  // 以前只有写没有读 —— 而且 GET 也会走进"上报"分支：空 body 解析成 {}，
  // **把已存的状态清空**，再返回 {ok:true}。等于存了读不出、一读就抹掉。
  // 现在按方法分开：POST 写，GET 读。
  if (sub === '/state') {
    if (method === 'GET') return sendJson(res, { ok: true, state: store.state })
    try {
      store.state = JSON.parse((await readBody(req)) || '{}')
    } catch {
      /* 忽略 */
    }
    return sendJson(res, { ok: true })
  }

  return sendJson(res, { error: 'not found: ' + sub }, 404)
}

/**
 * 逐条 exact 注册，而不是一条 prefix。
 *
 * 原因：`kind: 'prefix'` 的写法我是从 0.1.x 时代的插件抄来的，在当前宿主
 * （0.2.0-rc.2）上无法直接证实仍然受支持；而 `kind: 'exact'` 有直接证据——
 * dshmarket 自身 46 处注册全用 exact，且 /dsh-market/status 实测可访问。
 * 在需要用户手动重启的场景下，不值得赌一个未经证实的 API 形状。
 */
const ROUTE_PATHS = ['/api', '/settings', '/status', '/cookie', '/logout', '/restart', '/state', '/commands']

export async function apply(ctx) {
  // 先读配置（缓存目录由配置决定），再迁移默认值，最后读缓存
  loadStore()
  migrateSettings()
  loadCache()

  ctx.effect(() => {
    const disposers = ROUTE_PATHS.map((p) =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE + p,
        handler: async (req, res) => {
          try {
            await handle(req, res)
          } catch (e) {
            try {
              sendJson(res, { error: String((e && e.message) || e) }, 500)
            } catch {
              /* 响应已发出 */
            }
          }
        },
      }),
    )
    return () => {
      for (const d of disposers) {
        try {
          if (typeof d === 'function') d()
        } catch {
          /* 清理失败不影响卸载 */
        }
      }
    }
  })

  // 启动自检：有登录态就确认接口仍可用（失败只告警，不阻断启动）
  if (store.cookie) {
    try {
      const acct = await netease('/api/nuser/account/get')
      console.log(
        '[netease] 自检 OK — ' +
          (acct.profile ? acct.profile.nickname + ' (uid=' + acct.profile.userId + ')' : 'code=' + acct.code),
      )
    } catch (e) {
      console.error('[netease] 自检失败（不影响启动）: ' + String(e && e.message))
    }
  }
}
