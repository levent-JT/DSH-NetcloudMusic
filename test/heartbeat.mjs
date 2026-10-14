// 由 nm-heartbeat-test 生成：心动模式端到端行为测试
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../lib/client.js')
const code = fs.readFileSync(FILE, 'utf8')
const results = []
const ok = (c, label, detail) => results.push((c ? '  [OK]   ' : '  [FAIL] ') + label + (detail ? '  ' + detail : ''))
const note = (s) => results.push('  [..]   ' + s)

// ── DOM ─────────────────────────────────────────────────────────────
function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(), nodeType: 1,
    style: { cssText: '', setProperty() {}, getPropertyValue: () => '' },
    dataset: {}, classList: { _s: new Set(), add(c){this._s.add(c)}, remove(c){this._s.delete(c)}, contains(c){return this._s.has(c)} },
    children: [], parentNode: null, id: '', textContent: '', isConnected: true, className: '',
    appendChild(c){c.parentNode=el;el.children.push(c);return c}, prepend(c){c.parentNode=el;el.children.unshift(c);return c},
    removeChild(c){const i=el.children.indexOf(c);if(i>=0)el.children.splice(i,1);c.parentNode=null;return c},
    remove(){if(el.parentNode)el.parentNode.removeChild(el)},
    contains(n){if(n===el)return true;return el.children.some(c=>c.contains&&c.contains(n))},
    setAttribute(){}, removeAttribute(){}, getAttribute:()=>null, addEventListener(){}, removeEventListener(){},
    querySelector:()=>null, querySelectorAll:()=>[], closest:()=>null,
    getBoundingClientRect:()=>({width:100,height:100,top:0,left:0}),
    getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(4)})}),
    toDataURL:()=>'data:,', focus(){}, blur(){},
  }
  return el
}
const head = makeEl('head'), body = makeEl('body'), documentElement = makeEl('html')
const document = { documentElement, head, body, createElement:(t)=>makeEl(t), createTextNode:(t)=>({nodeType:3,textContent:t}),
  getElementById:()=>null, querySelector:()=>null, querySelectorAll:()=>[], addEventListener(){}, removeEventListener(){} }

// ── React（真调组件 + 订阅重渲染 + class 支持）───────────────────────
let hookIndex = 0
const hookState = []
let currentRerender = null
let seenNodes = []
let rendered = 0
function isClassFn(fn){ return typeof fn === 'function' && /^class[\s{]/.test(Function.prototype.toString.call(fn)) }
function renderClass(Cmp, props){ const i = new Cmp(props||{}); return i.render ? i.render() : null }
function walk(node, depth = 0) {
  if (node == null || depth > 60) return
  if (Array.isArray(node)) { node.forEach((n)=>walk(n,depth+1)); return }
  if (isClassFn(node)) { walk(renderClass(node,{}),depth+1); return }
  if (typeof node === 'function') { walk(node({}),depth+1); return }
  if (node.$$typeof === 'el') {
    rendered++; hookIndex = 0; seenNodes.push(node)
    if (isClassFn(node.type)) { walk(renderClass(node.type,node.props),depth+1); return }
    if (typeof node.type === 'function') { walk(node.type(node.props||{}),depth+1); return }
    if (typeof node.type === 'symbol') return
    if (node.props && node.props.children !== undefined) walk(node.props.children,depth+1)
  }
}
const React = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) { return { $$typeof:'el', type, props:{...(props||{}), children: children.length<=1?children[0]:children} } },
  useState(init){ const i=hookIndex++; if(hookState[i]===undefined) hookState[i]=typeof init==='function'?init():init; return [hookState[i],()=>{}] },
  useEffect(fn){ hookIndex++; if(typeof fn==='function') fn() },
  useLayoutEffect(fn){ hookIndex++; if(typeof fn==='function') fn() },
  useMemo(fn){ hookIndex++; return fn() },
  useCallback(fn){ hookIndex++; return fn },
  useRef(v){ hookIndex++; return {current:v} },
  useContext(){ hookIndex++; return {} },
  useReducer(r,init){ hookIndex++; return [init,()=>{}] },
  // 不要在这里自动重渲染：emit() 触发很频繁，配合 ReactDOM 的 rerender 会无限递归 OOM。
  // 这个测试本来就是手动 re-walk 的，订阅回调留空即可。
  useSyncExternalStore(subscribe, getSnapshot){ hookIndex++; try{ subscribe(()=>{}) }catch{} return getSnapshot() },
  createContext:(v)=>({Provider:'P',_v:v,Consumer:'C'}),
  memo:(c)=>c, forwardRef:(c)=>c, isValidElement:()=>true,
  Children:{ map:(c,f)=>(Array.isArray(c)?c.map(f):c?[f(c)]:[]) },
  Component: class Component { constructor(p){this.props=p||{};this.state={}} setState(){} forceUpdate(){} },
  PureComponent: class PureComponent { constructor(p){this.props=p||{};this.state={}} setState(){} forceUpdate(){} },
}
const ReactProxy = new Proxy(React, { get(t,k){ return k in t ? t[k] : (()=>undefined) } })
const ReactDOM = {
  createRoot(){ const root={ _node:null, render(node){ root._node=node; currentRerender=()=>{ try{ walk(root._node) }catch{} }; try{ walk(node) }catch{} }, unmount(){ currentRerender=null } }; return root },
  render(node){ try{ walk(node) }catch{} }, unmountComponentAtNode(){}, flushSync(fn){ fn() },
}

// ── 接口桩：把「我喜欢的音乐」和心动队列都答出来 ─────────────────────
const LIKED_PID = '723109341'
const PL = { id: LIKED_PID, name: '凌清-喜欢的音乐', specialType: 5, coverImgUrl: '', trackCount: 3 }
const TRACKS = [1,2,3].map((i)=>({ id: 900+i, name: '红心歌'+i, pic: 'https://x/c.jpg', duration: 200000, ar:[{name:'歌手'}], artist:'歌手', album:'专辑' }))
const DAILY = [1,2].map((i)=>({ id: 800+i, name: '每日'+i, pic: 'https://x/d.jpg', duration: 180000, ar:[{name:'歌手'}], artist:'歌手', album:'专辑' }))
const HBQ = [1,2,3,4].map((i)=>({ id: 700+i, name: '心动'+i, pic: 'https://x/h.jpg', duration: 190000, ar:[{name:'歌手'}], artist:'歌手', album:'专辑' }))
const calls = []
function fakeFetch(url){
  const u = String(url); calls.push(u)
  const has = (s) => u.indexOf(s) >= 0
  let body = { code: 200 }
  if (has(encodeURIComponent('/user/playlist')) || has('/user/playlist')) body = { code: 200, playlist: [PL] }
  else if (has(encodeURIComponent('/playlist/detail')) || has('/playlist/detail')) body = { code: 200, playlist: { ...PL, tracks: TRACKS } }
  else if (has(encodeURIComponent('/playmode/intelligence/list'))) body = { code: 200, data: HBQ.map((s)=>({ id: s.id, recommended: false, songInfo: { id: s.id, name: s.name, dt: s.duration, ar: s.ar, al: { name: s.album, picUrl: s.pic } } })) }
  else if (has(encodeURIComponent('/like/ids'))) body = { code: 200, ids: [], playlistId: LIKED_PID }
  else if (has(encodeURIComponent('/recommend/songs'))) body = { code: 200, data: { dailySongs: DAILY } }
  else if (has(encodeURIComponent('/song/url'))) body = { code: 200, data: [{ url: 'blob:test', br: 999000, level: 'lossless' }] }
  else if (has(encodeURIComponent('/lyric'))) body = { code: 200, lrc: { lyric: '[00:00.00]测试歌词' }, tlyric: { lyric: '' } }
  else if (has(encodeURIComponent('/login/status'))) body = { code: 200, data: { profile: { userId: 1, nickname: 'tester' } } }
  else if (has(encodeURIComponent('/diag'))) body = { code: 200, ok: true }
  else if (has(encodeURIComponent('/settings'))) body = { settings: { quality: 'lossless', modules: { daily: true, playlist: true, fm: true, lyrics: true, history: true, volume: true }, ambient: { mode: 'cover-lyrics', style: 'immersive', panelAlpha: 0.45, frost: 'layout' }, cache: { dir: '', max: 800 }, volume: 0.8, playMode: 'sequence' } }
  else if (has(encodeURIComponent('/status'))) body = { ready: true, port: 0, mode: 'direct', loggedIn: true }
  // 宿主返回的是信封 { status, body }；客户端 api() 取 envelope.body。
  // 直接返回 payload 会让 api() 一律拿到 undefined —— store.login 恒为 null，
  // 所有视图都被 LoginGate 挡住（这个坑白折腾了一轮）。
  // ★ 只有 /api 是信封 { status, body }（api() 取 envelope.body）；
  //   /settings、/status、/state 这些本地 op 是**平的**（hostSettings 直接读 res.settings）。
  const isApi = u.indexOf('/api?') >= 0
  const payload = isApi ? { status: 200, body } : body
  return Promise.resolve({ ok:true, status:200, json:()=>Promise.resolve(payload), text:()=>Promise.resolve(JSON.stringify(payload)) })
}

let captured = null
const timers = []
const storage = { getItem:(k)=> k==='nm-resume' ? JSON.stringify({ queue:[DAILY[0]], index:0, position:0, mode:'sequence' }) : null, setItem(){}, removeItem(){} }
const sandbox = {
  window: { __ModuleLoader__:{ load:(d)=>{captured=d} }, addEventListener(){}, removeEventListener(){},
    matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}), localStorage: storage, __nmAudio:null, innerWidth:1280, innerHeight:820 },
  document, console: { log(){}, warn(){}, error(){}, info(){}, debug(){} },
  setTimeout:(fn)=>{timers.push(fn);return timers.length}, clearTimeout(){}, setInterval:()=>0, clearInterval(){},
  URLSearchParams, Uint8ClampedArray, Image: function(){ this.crossOrigin=''; this.src='' },
  MutationObserver: function(){ this.observe=()=>{}; this.disconnect=()=>{} },
  AbortSignal: { timeout:()=>({}) }, fetch: fakeFetch, localStorage: storage,
  getComputedStyle: ()=>({ getPropertyValue:()=>'', backgroundColor:'rgba(0,0,0,0)', position:'static' }),
  requestAnimationFrame:(fn)=>{timers.push(fn);return 0}, cancelAnimationFrame(){},
  performance: { now: () => Date.now() },
}
sandbox.globalThis = sandbox

const registeredCmp = new Map()
const ctx = { effect(fn){ const d=fn(); return typeof d==='function'?d:()=>{} },
  slots: { inject(n,f){ f() }, register(def,cmp){ if(typeof cmp==='function') registeredCmp.set(String(def.name)+'|'+String(def.id), cmp); return ()=>{} } }, on(){}, off(){} }

const flush = async (rounds=25) => { for(let i=0;i<rounds;i++){ await Promise.resolve(); const b=timers.splice(0,timers.length); for(const fn of b){ try{ fn() }catch(e){} } } }

// ── 驱动 ────────────────────────────────────────────────────────────
const findByTitle = (frag) => seenNodes.find((n)=> typeof (n.props&&n.props.title)==='string' && n.props.title.indexOf(frag)>=0)
/** 心动按钮专用：它的 title 只有这三个前缀，别的按钮不会命中。
 *  用 indexOf('心动模式') 会误抓"播放模式"按钮 —— 它锁定时的 title 是
 *  「心动模式开启时不能切换播放模式」，同样含这四个字。 */
const HB_TITLES = ['开启心动模式', '心动模式已开启', '心动模式只能']
const findHeartbeat = () => seenNodes.find((n)=> typeof (n.props&&n.props.title)==='string' && HB_TITLES.some((t)=> n.props.title.indexOf(t)===0))
const findByText = (txt) => seenNodes.find((n)=> (n.props&&n.props.children)===txt)
/**
 * 点击。**disabled 的一律拒绝** —— 这是测试的诚实性底线：
 * Btn 渲染出的 onClick 在 disabled 时依然存在，直接调用等于"点了用户点不动的按钮"，
 * 被测逻辑根本没执行，却会记为通过（回归 B 就是这么漏过去的）。
 */
const click = (node) => {
  if (!node || typeof node.props.onClick !== 'function') return false
  if (node.props.disabled === true) return false
  node.props.onClick()
  return true
}

try {
  const c = { ...sandbox, require:(id)=> id==='react'?ReactProxy:id==='react-dom'?ReactDOM:(()=>{throw new Error('未 stub: '+id)})() }
  c.globalThis = c
  vm.createContext(c)
  vm.runInContext(code, c, { filename:'lib/client.js' })
  const mod = captured.factory((id)=> id==='react'?ReactProxy:id==='react-dom'?ReactDOM:(()=>{throw new Error('未 stub: '+id)})())
  mod.apply(ctx)
  await flush()

  const pageCmp = registeredCmp.get('conversation.view|netease-music')
  ok(!!pageCmp, '拿到页签组件')

  const render = () => { seenNodes = []; hookIndex = 0; walk(React.createElement(pageCmp, {})) }
  render()

  // ── A) 登录了就能开：不需要先把队列切到「我喜欢的音乐」 ──────────
  // 官方：pid（种子歌单）必须是红心歌单，这一点由插件用 likedPlaylistId 保证；
  // 与"此刻在播哪个歌单"无关。锚点只影响推荐风格（实测锚点不同、首曲不同）。
  // 初始状态是每日推荐（playSongs 不带 source），正好覆盖用户报的那个场景。
  render()
  ok(click(findByText('播放器')), '进「播放器」子页签')
  await flush(); render()
  const hb0 = findHeartbeat()
  ok(!!hb0, '播放器页里有心动开关按钮')
  ok(!!hb0 && hb0.props.disabled !== true, '★ 未进红心歌单也能点（旧实现这里必然是灰的）', hb0 ? 'title=' + hb0.props.title : '')

  // ── B) 打开心动 ─────────────────────────────────────────────
  const hbClick = findHeartbeat()
  ok(click(hbClick), '点下心动开关')
  await flush(); render()
  const hb2 = findHeartbeat()
  const onNow = !!hb2 && String(hb2.props.className || '').indexOf('nm-heartbeat-on') >= 0
  ok(onNow, '★ 心动模式已开启（按钮进入开启态）', hb2 ? 'className=' + String(hb2.props.className) : '')

  const hbCall = calls.find((u) => u.indexOf('intelligence') >= 0)
  ok(!!hbCall, '确实调用了 /playmode/intelligence/list')
  // 核心：pid 必须是红心歌单（官方唯一硬性条件），与在播歌单无关
  const pidHit = !!hbCall && hbCall.indexOf(encodeURIComponent(LIKED_PID)) >= 0
  ok(pidHit, '★★ 种子歌单(pid)传的是「我喜欢的音乐」' + LIKED_PID, hbCall ? decodeURIComponent(hbCall).slice(-120) : '')

  // ── D) 播放模式锁定（官方：心动开启时播放模式无法自由切换）─────
  const mb = findByTitle('播放模式')
  ok(!!mb && mb.props.disabled === true, '心动开启时播放模式按钮被锁定')

  // ── E) ★ 从别的入口（每日推荐，不传 source）开始播放，心动必须还在 ★
  render()
  ok(click(findByText('推荐')), '切到「推荐」子页签（每日推荐）')
  await flush(); render()

  // 每日推荐要先真的加载出来，否则「播放全部」是 disabled 的，click 会（也应该）失败。
  const loadDaily = seenNodes.find((n) => (n.props && n.props.children) === '点击加载每日推荐' && typeof n.props.onClick === 'function')
  if (loadDaily) {
    ok(click(loadDaily), '先加载每日推荐')
    await flush(); render()
  }
  const playAll = seenNodes.find((n) => (n.props && n.props.children) === '播放全部' && typeof n.props.onClick === 'function')
  ok(!!playAll, '每日推荐里有「播放全部」')
  ok(!!playAll && playAll.props.disabled !== true, '「播放全部」是可点的（不是 disabled）')
  ok(click(playAll), '点「播放全部」（这条路径不传 source）')
  await flush(); render()

  ok(click(findByText('播放器')), '切回「播放器」子页签')
  await flush(); render()
  const hb3 = findHeartbeat()
  const stillOn = !!hb3 && String(hb3.props.className || '').indexOf('nm-heartbeat-on') >= 0
  ok(stillOn, '★★ 从别的来源开始播放后，心动模式仍然挂着（这就是旧版的 bug）', hb3 ? 'className=' + String(hb3.props.className) : '')

  // ── F) 关闭 ─────────────────────────────────────────────────
  const hbOff = findHeartbeat()
  ok(click(hbOff), '再点一次关闭心动')
  await flush(); render()
  const hb4 = findHeartbeat()
  ok(!!hb4 && String(hb4.props.className||'').indexOf('nm-heartbeat-on')<0, '心动已关闭')
  const mb2 = findByTitle('播放模式')
  ok(!!mb2 && mb2.props.disabled !== true, '关闭后播放模式按钮解锁')
} catch (e) {
  ok(false, '执行抛错', e.message)
  console.log('')
  String(e.stack||'').split('\n').slice(0,12).forEach((l)=>console.log('  ' + l.trim()))
}

console.log('')
results.forEach((r)=>console.log(r))
const fails = results.filter((r)=>r.startsWith('  [FAIL]')).length
console.log('')
console.log('通过 ' + (results.length-fails) + '/' + results.length + (fails ? '  —— 有失败项' : '  —— 全部通过'))
process.exit(fails ? 1 : 0)
