// 通过 CDP 读 DSH 渲染进程的实时 DOM。
//
// 用法（先让 DSH 带 --remote-debugging-port=9222 启动，快捷方式里已加）：
//   node scripts/cdp.mjs --list
//   node scripts/cdp.mjs document.title
//   node scripts/cdp.mjs --target 1 getComputedStyle(document.querySelector('body')).backgroundColor
//
// 为什么需要它：插件能上报的东西有限，而某个元素到底什么底色、被哪条规则命中
// 这类问题靠埋探针 + 用户 F5 来回问，效率极低。开了这个口子就能自己看。
import { argv } from 'node:process'
const PORT = Number(process.env.DSH_CDP_PORT || 9222)
const BASE = 'http://127.0.0.1:' + PORT
async function targets() {
  const res = await fetch(BASE + '/json/list', { signal: AbortSignal.timeout(3000) })
  return await res.json()
}
function pick(list, hint) {
  const pages = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!pages.length) throw new Error('没有可用的 page 目标')
  if (hint === undefined || hint === null) return pages[0]
  const n = Number(hint)
  if (Number.isFinite(n) && pages[n]) return pages[n]
  return pages.find((t) => (t.title || '').includes(String(hint))) || pages[0]
}
async function evaluate(wsUrl, expression) {
  const ws = new WebSocket(wsUrl)
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error('WebSocket 连接失败')) })
  const msg = await new Promise((ok, no) => {
    const timer = setTimeout(() => no(new Error('求值超时')), 15000)
    ws.onmessage = (ev) => { let m = null; try { m = JSON.parse(ev.data) } catch { return }
      if (m.id !== 1) return; clearTimeout(timer); ok(m) }
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true, userGesture: true } }))
  })
  ws.close()
  if (msg.error) throw new Error('CDP 错误: ' + JSON.stringify(msg.error))
  const r = msg.result || {}
  if (r.exceptionDetails) throw new Error('表达式抛错: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails))
  return r.result ? r.result.value : undefined
}
const args = argv.slice(2)
if (!args.length || args[0] === '--help' || args[0] === '-h') {
  console.log('用法: node scripts/cdp.mjs [--list] [--target <序号或标题片段>] "<表达式>"')
  process.exit(0)
}
try {
  const list = await targets()
  if (args[0] === '--list') {
    console.log('目标 ' + list.length + ' 个:')
    list.forEach((t, i) => console.log('  [' + i + '] ' + t.type + '  ' + String(t.title || '').slice(0, 50) + '  ' + String(t.url || '').slice(0, 60)))
    process.exit(0)
  }
  let hint = null, expr = args.join(' ')
  if (args[0] === '--target') { hint = args[1]; expr = args.slice(2).join(' ') }
  if (expr.startsWith('--file ')) {
    const f = expr.slice(7).trim()
    expr = (await import('node:fs')).readFileSync(f, 'utf8')
  }
  const value = await evaluate(pick(list, hint).webSocketDebuggerUrl, expr)
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
} catch (e) {
  console.error('✗ ' + String((e && e.message) || e))
  console.error('  （DSH 是否已用 --remote-debugging-port=' + PORT + ' 重启过？）')
  process.exit(1)
}
