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
