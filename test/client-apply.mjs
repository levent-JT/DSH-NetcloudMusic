// 客户端 apply() + 背景图层渲染测试。
//
// 为什么需要它：原来的 client-smoke.mjs 只验证「factory 能被执行」，从不调用 apply()；
// 而插件真正的失败点几乎都在 apply() 之后的路径上（注册 slot、挂载背景图层、
// 接线皮肤输入、以及**拿到封面后渲染那 8 层**）。
//
// 这一版的关键改进：不是空壳 React。它会
//   1) 真的调用函数组件（组件里的 undefined / TDZ 会当场暴露）；
//   2) 模拟 useSyncExternalStore 的订阅 → 收到通知后重新渲染整个 root；
//   3) 通过 stub 的 /state 接口把一首歌灌进去 —— 这样才会走到
//      「有封面」的那条分支（没封面时 AmbientBg 直接 return null，测不到东西）。
import fs from 'node:fs'
// 说明：这里刻意不用 vm —— 作用域探针需要 with()，而 with 只在
// new Function 出来的非严格函数体里可用（vm.runInContext 也不行）。
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../lib/client.js')
const code = fs.readFileSync(FILE, 'utf8')

const results = []
const ok = (c, label, detail) => results.push((c ? '  [OK]   ' : '  [FAIL] ') + label + (detail ? '  ' + detail : ''))
const note = (s) => results.push('  [..]   ' + s)

// ── DOM ──────────────────────────────────────────────────────────────
function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    style: { cssText: '', setProperty() {}, getPropertyValue: () => '' },
    dataset: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c) },
      remove(c) { this._s.delete(c) },
      contains(c) { return this._s.has(c) },
    },
    children: [],
    parentNode: null,
    id: '',
    textContent: '',
    isConnected: true,
    className: '',
    appendChild(c) { c.parentNode = el; el.children.push(c); return c },
    prepend(c) { c.parentNode = el; el.children.unshift(c); return c },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); c.parentNode = null; return c },
    remove() { if (el.parentNode) el.parentNode.removeChild(el) },
    contains(n) { if (n === el) return true; return el.children.some((c) => c.contains && c.contains(n)) },
    setAttribute() {},
    removeAttribute() {},
    getAttribute: () => null,
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 100, top: 0, left: 0 }),
    getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }) }),
    toDataURL: () => 'data:,',
    focus() {},
    blur() {},
  }
  return el
}
const head = makeEl('head')
const body = makeEl('body')
const documentElement = makeEl('html')
const document = {
  documentElement,
  head,
  body,
  createElement: (t) => makeEl(t),
  createTextNode: (t) => ({ nodeType: 3, textContent: t }),
  getElementById: (id) => (id === 'nm-ambient' ? body.children.find((c) => c.id === id) || null : null),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
}

// ── React：真的调用函数组件 + 支持订阅重渲染 ──────────────────────────
let hookIndex = 0
const hookState = []
let currentRerender = null
const React = {
  Fragment: Symbol('Fragment'),
  // React.Component 是真实存在的；stub 里缺了它，class 继承会在**模块初始化阶段**
  // 就抛 "Class extends value undefined" —— 整个 factory 直接加载失败。
  Component: class Component {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState() {}
    forceUpdate() {}
  },
  PureComponent: class PureComponent {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState() {}
    forceUpdate() {}
  },
  createElement(type, props, ...children) {
    return { $$typeof: 'el', type, props: { ...(props || {}), children: children.length <= 1 ? children[0] : children } }
  },
  useState(init) {
    const i = hookIndex++
    if (hookState[i] === undefined) hookState[i] = typeof init === 'function' ? init() : init
    return [hookState[i], () => {}]
  },
  useEffect(fn) { hookIndex++; if (typeof fn === 'function') fn() },
  useLayoutEffect(fn) { hookIndex++; if (typeof fn === 'function') fn() },
  useMemo(fn) { hookIndex++; return fn() },
  useCallback(fn) { hookIndex++; return fn },
  useRef(v) { hookIndex++; return { current: v } },
  useContext() { hookIndex++; return {} },
  useReducer(r, init) { hookIndex++; return [init, () => {}] },
  useSyncExternalStore(subscribe, getSnapshot) {
    hookIndex++
    // 按"订阅线"登记一次即可（subscribe/subscribeClock 都是稳定函数，正好当 key）。
    // 这样能回答真正的问题：一次 timeupdate 会不会惊动订阅全局版本号的那条线。
    try {
      if (!lineSubs.has(subscribe)) {
        lineSubs.set(subscribe, { fired: 0, labels: 0 })
        subscribe(() => {
          lineSubs.get(subscribe).fired += 1
          if (currentRerender) currentRerender()
        })
      }
      lineSubs.get(subscribe).labels += 1
    } catch {
      /* ignore */
    }
    return getSnapshot()
  },
  createContext: (v) => ({ Provider: 'P', _v: v, Consumer: 'C' }),
  memo: (c) => c,
  forwardRef: (c) => c,
  isValidElement: () => true,
  Children: { map: (c, f) => (Array.isArray(c) ? c.map(f) : c ? [f(c)] : []) },
}

let declaredHooks = 0
const ReactProxy = new Proxy(React, {
  get(t, k) {
    if (k in t) return t[k]
    // 未知 hook：计数但不抛，便于在报告里指出
    declaredHooks++
    return () => undefined
  },
})

let rendered = 0
/** 订阅线 -> { fired: 被唤醒次数, labels: 有几个组件订阅了它 } */
const lineSubs = new Map()
let renderError = null

/** class 组件（错误边界就是 class）必须 new 出来再调 render()，不能当函数调。 */
function isClassFn(fn) {
  return typeof fn === 'function' && /^class[\s{]/.test(Function.prototype.toString.call(fn))
}
function renderClass(Cmp, props) {
  const inst = new Cmp(props || {})
  return inst.render ? inst.render() : null
}

/** 本次渲染途中造出来的所有元素节点（用来找到 .nm-tab 子页签按钮并点它）。 */
let seenNodes = []

function walk(node, depth = 0) {
  if (node == null || depth > 40) return
  if (Array.isArray(node)) { node.forEach((n) => walk(n, depth + 1)); return }
  if (isClassFn(node)) { walk(renderClass(node, {}), depth + 1); return }
  if (typeof node === 'function') { walk(node({}), depth + 1); return }
  if (node.$$typeof === 'el') {
    rendered++
    hookIndex = 0
    seenNodes.push(node)
    if (isClassFn(node.type)) { walk(renderClass(node.type, node.props), depth + 1); return }
    if (typeof node.type === 'function') { walk(node.type(node.props || {}), depth + 1); return }
    if (typeof node.type === 'symbol') return
    if (node.props && node.props.children !== undefined) walk(node.props.children, depth + 1)
  }
}

const ReactDOM = {
  createRoot(layer) {
    const root = {
      _node: null,
      render(node) {
        root._node = node
        currentRerender = () => {
          try { walk(root._node) } catch (e) { renderError = renderError || e }
        }
        try { walk(node) } catch (e) { renderError = e }
      },
      unmount() { currentRerender = null },
    }
    return root
  },
  render(node, layer) {
    try { walk(node) } catch (e) { renderError = e }
  },
  unmountComponentAtNode() {},
  flushSync(fn) { fn() },
}

// ── fetch stub：把一首歌通过 /state 灌进去 ────────────────────────────
const SONG = { id: 12345, name: '测试歌曲', pic: 'https://example.com/cover.jpg', duration: 200000, ar: [{ name: '测试歌手' }] }

// ★ 关键：真实用户打开页面时，store 里的歌是 restoreSession() 从 localStorage
// 的 "nm-resume" 恢复出来的（不是靠接口拉的）。之前这里返回 null，
// 于是 store 里永远没有歌 → AmbientBg 永远走 return null 早退 →
// 「有封面时渲染那 8 层」这条真实路径一次都没被跑到，测试全绿但什么都没测。
const RESUME = {
  queue: [SONG],
  index: 0,
  position: 42,
  mode: 'sequence',
}
const storage = {
  getItem: (k) => (k === 'nm-resume' ? JSON.stringify(RESUME) : null),
  setItem() {},
  removeItem() {},
}

const fetchCalls = []
function fakeFetch(url) {
  const u = String(url)
  fetchCalls.push(u)
  let body = { code: 200 }
  if (u.includes('method=%2Fstate') || u.includes('method=/state')) {
    body = { code: 200, state: { song: SONG, queue: [SONG], index: 0, time: 42000, playing: false, mode: 'sequence', volume: 0.8 } }
  } else if (u.includes('/settings')) {
    body = { code: 200, settings: { quality: 'auto', modules: { daily: true, playlist: true, fm: false, lyrics: true, history: true, volume: true }, ambient: { mode: 'cover-lyrics', style: 'immersive', deck: true, dim: 0.55, blur: 44, lyricSize: 22, panelAlpha: 0.45, trans: true, auto: true, frost: 'layout' } } }
  } else if (u.includes('/status')) {
    // ★ 必须是「已登录」—— 之前这里返回 login:null，客户端就认为未登录、
    // 不去拉 /state，store 里永远没有歌，AmbientBg 永远走 return null 早退。
    // 结果就是：测试全绿，而真实使用（登录状态）的那条路径一次都没跑到。
    body = { code: 200, login: { profile: { userId: 1, nickname: '测试用户' } }, uid: 1 }
  } else if (u.includes('/like/ids')) {
    body = { code: 200, ids: [SONG.id] }
  } else if (u.includes('method=%2Fdiag') || u.includes('method=/diag')) {
    body = { code: 200, ok: true }
  }
  // 信封：宿主返回 { status, body }，客户端 api() 取 envelope.body。
  // 直接给 payload 会让 api() 拿到 undefined（这个坑在 heartbeat 测试里踩过一次）。
  // ★ 只有 /api 是信封 { status, body }；本地 op（/settings、/status）是平的。
  const isApi = u.indexOf('/api?') >= 0
  const payload = isApi ? { status: 200, body } : body
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(JSON.stringify(payload)),
  })
}

// ── Audio 桩：用来驱动 timeupdate，量「时间单独一条订阅线」的效果 ──────
const audioStub = {
  paused: true, currentTime: 0, duration: 200, volume: 0.8, src: '', preload: '',
  _l: {},
  addEventListener(k, f) { (this._l[k] = this._l[k] || []).push(f) },
  removeEventListener() {},
  play() { this.paused = false; (this._l.play || []).forEach((f) => f()) },
  pause() { this.paused = true; (this._l.pause || []).forEach((f) => f()) },
  load() {},
  removeAttribute() {},
  fire(k) { (this._l[k] || []).forEach((f) => f()) },
}

// ── 沙箱 ─────────────────────────────────────────────────────────────
let captured = null
const timers = []
const sandbox = {
  window: {
    __ModuleLoader__: { load: (def) => { captured = def } },
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    localStorage: storage,
    __nmAudio: null,
    innerWidth: 1280,
    innerHeight: 820,
  },
  document,
  console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
  setTimeout: (fn) => { timers.push(fn); return timers.length },
  clearTimeout() {},
  setInterval: () => 0,
  clearInterval() {},
  URLSearchParams,
  Uint8ClampedArray,
  Image: function () { this.crossOrigin = ''; this.src = '' },
  Audio: function () { return audioStub },
  MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {} },
  AbortSignal: { timeout: () => ({}) },
  fetch: fakeFetch,
  localStorage: storage,
  getComputedStyle: () => ({
    getPropertyValue: () => '',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    position: 'static',
  }),
  requestAnimationFrame: (fn) => { timers.push(fn); return 0 },
  cancelAnimationFrame() {},
}
sandbox.globalThis = sandbox

const registered = []
const registeredCmp = new Map()
const ctx = {
  effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
  slots: {
    inject(name, fn) { fn() },
    register(def, cmp) {
      registered.push(def.id)
      // ★ 关键：把注册的组件留下来，最后真的渲染一遍。
      // 之前这里只记 id，等于把「标签本身能不能渲染」这条最重要的路径漏掉了。
      // 按「挂载点 + id」索引：只按 id 会被同 id 的另一处注册覆盖
      // （settings.section 与 conversation.view 曾经都叫 netease-music，
      //  结果测试里拿到的是设置页组件，页签一个都点不出来）。
      if (typeof cmp === 'function') registeredCmp.set(String(def.name) + '|' + String(def.id), cmp)
      return () => {}
    },
  },
  on() {},
  off() {},
}

const flush = async (rounds = 12) => {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve()
    const batch = timers.splice(0, timers.length)
    for (const fn of batch) {
      try { fn() } catch (e) { renderError = renderError || e }
    }
  }
}

// ── 跑 ───────────────────────────────────────────────────────────────
try {
  const ctxObj = {
    ...sandbox,
    require: (id) => {
      if (id === 'react') return ReactProxy
      if (id === 'react-dom') return ReactDOM
      if (id === 'react-dom/client') return ReactDOM
      throw new Error('未 stub 的依赖: ' + id)
    },
  }
  ctxObj.globalThis = ctxObj

  // ── 作用域探针 ────────────────────────────────────────────────────────
  // with(scope) 让所有自由标识符都走 scope 的 get。get 收到不在真实全局里的
  // 名字 = 一次「用了但不在作用域里」的引用（activeLyricIndex 就是这么漏过去的）。
  const freeRefs = new Map() // 名字 -> 出现次数
  const scope = new Proxy(ctxObj, {
    has() {
      return true
    },
    get(target, key) {
      if (key === Symbol.unscopables) return undefined
      if (key in target) return target[key]
      // 回落真实全局：Object / Math / JSON / Promise 这些本来就不在沙箱里
      if (key in globalThis) return globalThis[key]
      // 沙箱和真实全局都没有 → 这个名字不在当前作用域里
      freeRefs.set(String(key), (freeRefs.get(String(key)) || 0) + 1)
      return undefined
    },
  })

  const runner = new Function('__scope', 'with(__scope){\n' + code + '\n}')
  runner(scope)
  if (!captured) throw new Error('ModuleLoader.load 没有被调用')

  const mod = captured.factory((id) => {
    if (id === 'react') return ReactProxy
    if (id === 'react-dom') return ReactDOM
    throw new Error('未 stub 的依赖: ' + id)
  })
  ok(typeof mod.apply === 'function', '导出 apply()')

  let applyError = null
  try { mod.apply(ctx) } catch (e) { applyError = e }
  ok(!applyError, 'apply() 执行成功', applyError ? applyError.message : '')
  if (applyError) {
    console.log('\n  ── apply() 报错 ──')
    String(applyError.stack || '').split('\n').slice(0, 10).forEach((l) => console.log('     ' + l.trim()))
  }
  ok(registered.length > 0, 'apply() 注册了 slot', registered.join(', '))

  await flush()
  ok(fetchCalls.length > 0, '发起了宿主请求', fetchCalls.length + ' 次')
  // 歌不是靠接口拉的：是 restoreSession() 从 localStorage 的 "nm-resume" 读出来的。
  // （原来这里断言"请求里有 /state"，方向就是错的 —— 客户端只 POST /state 存进度，
  //  读取走 localStorage。断言写错方向，就会永远报红，等于没测。）
  ok(storage.getItem('nm-resume') !== null, 'localStorage 里有存档（用它把一首歌灌进 store）')
  note('实际请求: ' + fetchCalls.map((u) => (u.match(/method=([^&]+)/) || ['', u])[1]).join(', '))

  const beforeRendered = rendered
  await flush()
  note('累计调用元素/组件 ' + rendered + ' 次（灌歌前 ' + beforeRendered + '）')

  // 判据：灌歌之后必须真的渲染过图层（颜色样式的 div 会被 createElement 造出来）
  const layerCount = rendered
  ok(layerCount > 5, '拿到封面后确实渲染了背景图层', '累计 ' + layerCount + ' 次（只渲染 1 次说明走的还是 return null 那条早退分支）')

  if (renderError) {
    ok(false, '渲染过程无抛错')
    console.log('\n  ── 渲染报错 ──')
    console.log('     ' + renderError.message)
    String(renderError.stack || '').split('\n').slice(0, 14).forEach((l) => console.log('     ' + l.trim()))
  } else {
    ok(true, '渲染过程无抛错（背景图层）')
  }
  if (declaredHooks) note('用到了 ' + declaredHooks + ' 次未 stub 的 React API')

  // ── 自由引用报告：这就是「用了但不在作用域里」的清单 ──────────────────
  const notReal = [...freeRefs.entries()]
  ok(
    notReal.length === 0,
    '没有「用了但不在作用域里」的标识符',
    notReal.length ? notReal.map(([k, n]) => k + '×' + n).join(', ') : '（探针跑完全程，一个都没有）',
  )
  if (notReal.length) {
    console.log('')
    console.log('  ── 不在作用域里却被引用的名字 ──')
    for (const [k, n] of notReal) console.log('     ' + k.padEnd(28) + '引用 ' + n + ' 次')
  }

  // ── 逐个点开每个子页签并渲染 ──────────────────────────────────────────
  // 这一步是这次事故的照妖镜：只在某个视图里用到的符号没定义，
  // 只渲染默认视图是发现不了的（activeLyricIndex 就是这么漏过去的）。
  const pageCmp = registeredCmp.get('conversation.view|netease-music')
  if (pageCmp) {
    const tabNodes = () => seenNodes.filter((n) => String((n.props && n.props.className) || '').indexOf('nm-tab') >= 0)
    const viewErrors = []
    seenNodes = []
    hookIndex = 0
    try {
      walk(React.createElement(pageCmp, {}))
    } catch (e) {
      viewErrors.push({ label: '(默认视图)', err: e })
    }
    const tabs = tabNodes().length
    for (let i = 0; i < tabs; i++) {
      const btn = tabNodes()[i]
      const label = typeof btn.props.children === 'string' ? btn.props.children : 'tab' + i
      try {
        if (typeof btn.props.onClick === 'function') btn.props.onClick()
        seenNodes = []
        hookIndex = 0
        walk(React.createElement(pageCmp, {}))
      } catch (e) {
        viewErrors.push({ label, err: e })
      }
    }
    ok(tabs > 0, '子页签按钮可见', tabs + ' 个')
    ok(
      viewErrors.length === 0,
      '每个子页签都能渲染',
      viewErrors.length ? viewErrors.map((v) => v.label + ': ' + v.err.message).join(' | ') : tabs + ' 个视图全过',
    )
    for (const v of viewErrors) {
      console.log('')
      console.log('  ── 子页签「' + v.label + '」渲染报错 ──')
      console.log('     ' + v.err.message)
      String(v.err.stack || '').split('\n').slice(0, 10).forEach((l) => console.log('     ' + l.trim()))
    }
  }

  // ── 时间订阅线的不变量 ────────────────────────────────────────────────
  // 说明：这个 harness 没有真正的 React 调度器，也不走真实播放链路，
  // 所以"每次 timeupdate 有几个组件重渲染"量不出来。与其印一个误导的数字，
  // 不如把不变量钉死 —— 它们是这次性能改动真正的内容。
  {
    const raw = fs.readFileSync(FILE, 'utf8')

    // ── 背景封面交叉淡化（2026-10-21）──────────────────────────────────
    //
    // 用户要求：切歌时旧封面渐隐、新封面渐显（800~1200ms），
    // 而且"没缓存好之前不许动" —— 这条要钉住三个就绪条件 + 两个 keyframes。
    // ⚠️ 只查 "@keyframes nmAmbFadeIn" 出现过同样是假断言：把名字改成
    // nmAmbFadeInREMOVED 它照样匹配。必须查"关键帧里真的有透明度端点"。
    ok(/@keyframes nmAmbFadeIn\{from\{opacity:0/.test(raw) &&
       /@keyframes nmAmbFadeOut\{[\s\S]{0,140}?to\{opacity:0/.test(raw),
      '两个 keyframes 都真的定义了透明度端点（不是只有名字）')
    // ⚠️ 为什么必须是 CSS 动画而不是 JS 改 opacity：
    // React 18 会把连续 setState 批处理成一次渲染，DOM 里不出现 opacity:0 那一帧，
    // 浏览器只看到最终值 → transition 无事可做。我在这上面栽了两次（实测都是硬切）。
    // ⚠️ 只查 COVER_DECODE_TIMEOUT_MS 出现过是**假断言**（我第一版就这么写，把 setTimeout
    // 那行删掉、常量留着，它照样通过）。必须查"超时真的接在 setTimeout 上"。
    ok(/function ensureCoverDecoded\(url\)/.test(raw) &&
       /const timer = setTimeout\(\(\) => finish\(false\), COVER_DECODE_TIMEOUT_MS\)/.test(raw) &&
       /clearTimeout\(timer\)/.test(raw),
      '封面解码有真实超时兜底（setTimeout 与 clearTimeout 都接上了）')
    ok(/coverDecoded\.has\(cover\) && statsSettled|!coverDecoded\.has\(cover\) \|\| !statsSettled/.test(raw),
      '就绪条件：解码完成 + 取色落定，缺一不动')
    ok(/function useCoverStatsSettled\(url\)/.test(raw) && /STATS_TIMEOUT_MS/.test(raw),
      '取色有 settled 语义（区分「还在算」和「算完但取不到」）+ 超时兜底')
    ok(/\.nm-amb-covers\{position:absolute/.test(raw),
      '双层封面有独立容器（裁切出血）')

    // ── 门控不会永久卡在骨架（2026-10-21，踩坑 #33）─────────────────────
    //
    // 事故：restoreSession() 恢复会话时只赋 store.song，**从不请求歌词**。
    // 门控当时判的是 store.lyrics !== null，于是"上次退出时在听歌 → 这次打开播放器页"
    // 永久停在骨架，永远不渲染（用户截图报的）。
    //
    // 教训不是"忘了调 loadLyric"，而是**门控依赖了一个可能永远不变的状态**。
    // 三层一起钉住，缺一层都可能重演：
    //   ① 判据改成"落定(done)"，不是"非 null"
    //   ② 每个出口都要落定（含请求失败、歌词模块关闭）
    //   ③ 硬超时兜底 —— 将来冒出新路径，最坏也只是慢 1.2 秒，不会白屏
    ok(/store\.lyricState === "done"/.test(raw) && /store\.lyrics !== null \|\|/.test(raw),
      '门控判据是"歌词已落定"，不是"歌词非 null"')
    ok(/function settleLyric\(id\)/.test(raw),
      '有 settleLyric：拿到 / 失败 / 关模块都要落定')
    if (true) {
      const outs = [
        /if \(!store\.modules\.lyrics\) \{ settleLyric\(id\); return; \}/,
        /store\.lyrics = hit; settleLyric\(id\);/,
        /store\.lyrics = entry; settleLyric\(id\);/,
        /store\.lyrics = null; settleLyric\(id\);/,
      ]
      const miss = outs.filter((re) => !re.test(raw)).length
      ok(miss === 0, 'loadLyric 的 4 个出口都会落定', miss ? '缺 ' + miss + ' 处' : '齐全')
    }
      ok(/const GATE_TIMEOUT_MS = \d+;/.test(raw) && /function gateTimedOut\(songKey\)/.test(raw),
        '有硬超时兜底的常量与判断函数')
      // ⚠️ 上面那条只证明"东西存在"，不证明"它真的被用了" —— 我第一版就写成这样，
      // 结果把 gateTimedOut 从 ready 判定里整个删掉，测试照样全绿（假测试）。
      // 下面这条才是真正钉住兜底的：
      ok(/const ready = \(coverOk && lyricDone\) \|\| gateTimedOut\(songKey\);/.test(raw),
        '★ 硬超时兜底真的用在 ready 判定里（不是定义了却没用）')
      ok(/function restoreSession\(\)[\s\S]{0,1200}?loadLyric\(store\.song\.id\);/.test(raw),
        '恢复会话时也会请求歌词（本次事故的直接根因）')
    ok(/function emitClock()/.test(raw), '存在轻量时间线 emitClock')
    ok(/function useClock()/.test(raw), '存在 useClock')

    // emitClock 绝不能惊动版本线的监听者
    const em = raw.slice(raw.indexOf('function emitClock()'))
    const body = em.slice(0, em.indexOf('\n    }'))
    ok(!/for \(const listener of \[\.\.\.listeners\]\)/.test(body), 'emitClock 不碰 version 线的监听者')
    ok(/clockListeners/.test(body), 'emitClock 只推 clock 线')

    // timeupdate 必须走轻量线
    const tu = raw.slice(raw.indexOf('addEventListener("timeupdate"'))
    const tuBody = tu.slice(0, tu.indexOf('});'))
    ok(/emitClock\(\)/.test(tuBody), 'timeupdate 走的是 emitClock（不是 emit）')
    ok(!/[^k]emit\(\)/.test(tuBody.replace('emitClock', '')), 'timeupdate 里没有调用全量 emit')

    // 皮肤必须两条线都挂 —— 这是自我审查抓到的那个回归
    ok(/skinUnsub = subscribe\(pushSkin\)/.test(raw), 'pushSkin 挂在 version 线')
    ok(/skinClockUnsub = subscribeClock\(pushSkin\)/.test(raw), '★ pushSkin 也挂在 clock 线（否则背景歌词卡住不动）')
    ok(/skinClockUnsub\(\)/.test(raw), 'teardown 里解绑了 clock 线')

    // 只有真的显示时间/进度的组件订阅时钟
    const clockUsers = (raw.match(/useClock\(\)/g) || []).length
    ok(clockUsers >= 4 && clockUsers <= 6, '订阅时钟的组件数量收敛（4~6 个，不是全部）', '实测 ' + clockUsers + ' 个（含定义 1 处）')
    // ── 每日推荐「换天刷新」的结构约束（方案 A：只在进推荐页时检查）──
    //
    // 为什么用静态断言而不是驱动行为：判据 dailyFetchedDay 是 factory 内部变量，
    // 从沙箱外面驱动不了（要驱动就得为测试开口子，反而更脏）。
    // 这一组钉"结构还在"，配合线上验证用。
    ok(/function todayIndex\(\)/.test(raw), '有本地日期工具 todayIndex')
    ok(/function refreshDailyIfStale\(\)/.test(raw), '有换天检查函数 refreshDailyIfStale')
    ok(/refreshDailyIfStale\(\);/.test(raw), '进推荐页时会调用它（不再是"列表非空就永不刷新"）')
    ok(/dailyFetchedDay = todayIndex\(\)/.test(raw), '成功拿到日推后记住是哪一天')
    ok(/const before = store\.dailySongs\.map/.test(raw), '静默刷新会比较新旧列表内容')
    ok(/DAILY_RETRY_MAX/.test(raw), '被共用闸挡住时有界重试，不会静默丢一次刷新')
    ok(/clearTimeout\(dailyRetryTimer\)/.test(raw), 'teardown 里清掉了重试闹钟')
    // ── 播放器页改版的结构约束（2026-10-20）──
    //
    // 这里钉的是那次"排版 bug"的修法：老版本把模式按钮和传输控制放进同一个 flex 行，
    // 整组 align-items:center 之后播放键被顶偏约 20px。新布局用 grid 的
    // 1fr auto 1fr —— 中列永远是正中。**这一条如果被改回 flex，断言必须报红。**
    ok(/\.nm-pl-ctl\{display:grid;grid-template-columns:1fr auto 1fr/.test(raw),
      '播放键永远在正中（三分格中列，不是 flex 整组居中）')
    ok(/\.nm-pl-side\.nm-pl-left/.test(raw) || /nm-pl-side nm-pl-left/.test(raw),
      '左侧区块单独成列（模式按钮不再挤进传输行）')
    {
      // 用户明确要求：**每次打开播放器都要完整走一遍入场**。
      // 所以现在只有两档：挂载 → full；换歌 → song。
      // 这条断言钉的是"别再冒出第三档（light）把入场悄悄关掉"。
      ok(raw.indexOf('.nm-ent-full') > 0 && raw.indexOf('.nm-ent-song') > 0,
        '两档入场都有 CSS（每次挂载 full / 换歌 song）')
      ok(raw.indexOf('nm-ent-light') < 0, '没有 light 档（用户要求每次打开都完整播放）')
      ok(raw.indexOf('playerAnimSong') > 0, '换歌判据用内存标记 playerAnimSong')
      ok(/changingSong\s*\?\s*"nm-ent-song"\s*:\s*"nm-ent-full"/.test(raw),
        '档位判据：换歌走 song，其余（含切页签回来）走 full')
    }
    ok(/prefers-reduced-motion/.test(raw), '尊重系统"减少动态效果"设置')
    ok(/shownRef/.test(raw) && /const view = shownRef\.current/.test(raw),
      '切歌时保留上一屏（新歌没就绪就继续画旧快照，画面不跳）')
    ok(/function snapshot\(s\)/.test(raw) && /current: cur0/.test(raw),
      '快照冻结了歌词当前行（否则切歌后旧歌词会跳回第一行）')
    ok(/const ctlSong = vs \|\| song/.test(raw),
      '控件跟画面那一首走（避免"看到 A 却收藏了 B"）')
    ok(/function applyCacheLimits\(\)/.test(raw) && /urlCache\.resize/.test(raw) && /lyricCache\.resize/.test(raw),
      '三套客户端缓存的上限可由设置控制')
    ok(/setClientLimit/.test(raw), '设置页能改缓存上限且立即生效')

    ok(/nm-pl-ch/.test(raw) && /overflow:hidden/.test(raw), '标题逐字用裁切窗口实现')

    {
      // bundle 里本来就有 2 个定时器：applySkin 的 3 秒兜底重贴、pollCommands 的 1.2 秒轮询。
      // 换天刷新**一个都不许加**（用户明确要求"对性能影响最小"）。
      const timers = (raw.match(/setInterval\(/g) || []).length
      ok(timers === 2, '定时器仍是已知的 2 个，换天刷新没新增', '实际 ' + timers + ' 处')
      const seg = raw.slice(raw.indexOf('function refreshDailyIfStale'), raw.indexOf('async function loadDaily'))
      ok(seg.length > 100 && !/setInterval/.test(seg), '换天刷新那段里没有任何 setInterval', '段长 ' + seg.length)
      ok(!/addEventListener/.test(seg), '换天刷新那段里没有任何 addEventListener')
      ok(/setTimeout/.test(seg), '被共用闸挡住时用 setTimeout 有界重试')
    }
  }

  // ── 渲染每个注册的组件（播放器标签、侧栏卡片、设置页）──────────────
  // 这一步才是「标签会不会崩」的直接检验：组件里任何一个引用错名字 /
  // 调用不存在的函数，都会在这里抛出来。
  note('注册的组件: ' + [...registeredCmp.keys()].join(', '))
  for (const [id, cmp] of registeredCmp) {
    void id;
    let err = null
    const before = rendered
    try {
      hookIndex = 0
      walk(React.createElement(cmp, {}))
    } catch (e) {
      err = e
    }
    ok(!err, '渲染组件 ' + id, err ? err.message : '调用 ' + (rendered - before) + ' 个元素')
    if (err) {
      console.log('\n  ── ' + id + ' 报错 ──')
      console.log('     ' + err.message)
      String(err.stack || '').split('\n').slice(0, 14).forEach((l) => console.log('     ' + l.trim()))
      console.log('')
    }
  }
} catch (e) {
  ok(false, '加载/执行阶段抛错', e.message)
  console.log('')
  String(e.stack || '').split('\n').slice(0, 12).forEach((l) => console.log('  ' + l.trim()))
}

console.log('')
results.forEach((r) => console.log(r))
const failed = results.filter((r) => r.startsWith('  [FAIL]')).length
console.log('')
console.log('通过 ' + (results.length - failed) + '/' + results.length + (failed ? '  —— 有失败项' : '  —— 全部通过'))
process.exit(failed ? 1 : 0)
