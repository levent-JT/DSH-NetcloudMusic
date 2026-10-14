// 客户端 bundle 冒烟测试：在模拟 ModuleLoader 环境里加载 lib/client.js，
// 确认语法可解析、factory 可执行、导出 apply/inject 形状正确。
// 不渲染 UI（那需要真实浏览器），只验证「能否被加载」这一最低门槛。
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 路径从脚本自身位置推导 —— 不把开发机的绝对路径写进仓库
const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../lib/client.js')
const code = fs.readFileSync(FILE, 'utf8')

let captured = null
const sandbox = {
  window: {
    __ModuleLoader__: { load: (def) => { captured = def } },
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    __nmAudio: null,
  },
  document: {
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {}, id: '' }),
    head: { appendChild() {} },
    body: { appendChild() {} },
    getElementById: () => null,
    addEventListener() {},
  },
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  URLSearchParams,
  fetch: () => Promise.reject(new Error('no network in smoke test')),
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
}
sandbox.globalThis = sandbox

const results = []
const ok = (c, label, detail) => results.push((c ? '  [OK]   ' : '  [FAIL] ') + label + (detail ? '  ' + detail : ''))

// 1) 语法解析 + 执行外层，确认 ModuleLoader.load 被调用
try {
  vm.runInNewContext(code, sandbox, { filename: 'client.js' })
  ok(true, 'lib/client.js 语法解析并执行成功')
} catch (e) {
  ok(false, 'lib/client.js 加载失败', String(e && e.message))
}

ok(captured !== null, 'window.__ModuleLoader__.load 被调用')
if (captured) {
  ok(captured.id === 'dsh-netease-music', 'ModuleLoader id 与 package.json name 一致', 'id=' + captured.id)
  ok(typeof captured.factory === 'function', 'factory 是函数')

  // 2) 提供最小 react/react-dom 桩，执行 factory
  const React = {
    createElement: (...a) => ({ __el: a[0], props: a[1], children: a.slice(2) }),
    useState: (v) => [v, () => {}],
    useEffect: () => {},
    useRef: (v) => ({ current: v }),
    useMemo: (f) => f(),
    useCallback: (f) => f,
    Fragment: 'Fragment',
    createContext: () => ({ Provider: 'Provider', Consumer: 'Consumer' }),
    // Component / PureComponent 必须给：错误边界要 extends React.Component，
    // 而 class extends 是在**模块初始化阶段**求值的 —— 缺了它整个 factory 直接加载失败
    // （报 "Class extends value undefined is not a constructor"）。
    Component: class Component {
      constructor(props) { this.props = props || {}; this.state = {} }
      setState() {}
      forceUpdate() {}
    },
    PureComponent: class PureComponent {
      constructor(props) { this.props = props || {}; this.state = {} }
      setState() {}
      forceUpdate() {}
    },
  }
  const ReactDOM = { createPortal: (x) => x }
  const requireStub = (name) => {
    if (name === 'react') return React
    if (name === 'react-dom') return ReactDOM
    throw new Error('意外的 require: ' + name)
  }

  let exportsObj = null
  try {
    exportsObj = captured.factory(requireStub)
    ok(true, 'factory 执行成功（无 require 缺失 / 顶层运行错误）')
  } catch (e) {
    ok(false, 'factory 执行失败', String(e && e.message))
  }

  if (exportsObj) {
    ok(typeof exportsObj.apply === 'function', '导出 apply() 存在')
    ok(Array.isArray(exportsObj.inject), '导出 inject 是数组', JSON.stringify(exportsObj.inject))
    // 注：name 不是 DSH client 契约的必需项 —— 上游 JasonCHTT 版也只导出 apply/inject
  }

  // 3) 验证我改过的音质档位确实生效（直接解析源码常量）
  const qm = code.match(/const QUALITY_LEVELS = \[([^\]]+)\]/)
  const lm = code.match(/const QUALITY_LABELS = \{([\s\S]*?)\};/)
  if (qm) {
    const levels = qm[1].split(',').map((s) => s.trim().replace(/"/g, '')).filter(Boolean)
    ok(levels.length === 7, 'QUALITY_LEVELS 已扩展为 7 档', levels.join('/'))
    ok(!levels.includes('vivid') && !levels.includes('dolby'), '已排除浏览器无法解码的 vivid/dolby')
    ok(levels.includes('jymaster') && levels.includes('hires'), '含 jymaster(超清母带) 与 hires')
  } else {
    ok(false, '未能解析 QUALITY_LEVELS')
  }
  if (lm) {
    ok(/jymaster/.test(lm[1]) && /超清母带/.test(lm[1]), 'QUALITY_LABELS 含中文标签')
  }
  // 4) 确认默认音质已改为 lossless
  ok(/quality: "lossless"/.test(code), '默认音质为 lossless')

  // 5) 确认挂载点（页签 / 侧栏卡片 / 视图桥 / 设置页）
  //    用 slots.inject("...") 计数：register 的选项对象可能换行，正则匹配不稳
  //
  //    这里原来断言的是「3 处：顶部条 / 浮层 / 设置页」—— 早就过时了：
  //    顶部条那处随早期重构被删掉，页签与侧栏卡片后来又加上了，现在是 4 处。
  //    过时的断言比没有断言更糟：它天天报红，真出问题时反而没人看。
  const slots = [...code.matchAll(/slots\.inject\(\s*"([^"]+)"/g)].map((m) => m[1])
  const WANT_SLOTS = [
    'conversation.view', // 「网易云音乐」页签（整页播放器）
    'sidebar.footer.action', // 侧栏底部小播放器（与用量卡片同一挂点）
    'conversation.session.header.actions', // 视图桥：拿到 selectView 才能从别处跳页签
    'settings.section', // 设置页里的插件设置
  ]
  const missing = WANT_SLOTS.filter((s) => !slots.includes(s))
  ok(missing.length === 0, '四处挂载点齐全', slots.join(' | ') + (missing.length ? '  缺: ' + missing.join(',') : ''))
  ok(slots.length === WANT_SLOTS.length, '挂载点数量与预期一致（' + WANT_SLOTS.length + ' 处）', '实际 ' + slots.length + ' 处')
}

console.log(results.join('\n'))
const fails = results.filter((x) => x.startsWith('  [FAIL]')).length
console.log('')
console.log('通过 ' + (results.length - fails) + '/' + results.length + (fails ? '  —— 有失败项' : '  —— 全部通过'))
