#!/usr/bin/env node
/**
 * 构建 lib/client.js。
 *
 * 为什么需要构建：DSH 的客户端半边只能是一个自包含文件（__ModuleLoader__.load 的
 * 工厂函数体），所以"源码拆模块"和"产物是单文件"必须同时满足 —— 这就是构建步骤的职责。
 *
 * 为什么不用打包器：本插件是零第三方依赖的，引一个 Rollup/esbuild 只为顺序拼接
 * 不划算，而且给用户装插件时多一层前置条件。这里就是有序拼接，行为完全可预测。
 *
 * 模块约定（重要）：每个 src/client/*.js 都是**工厂体的一段**，不是 ES module。
 * 需要对外暴露东西的一律写成显式的命名空间对象，例如
 *
 *     const Ambient = (() => {
 *       // 私有实现
 *       return { mount, unmount }   // 显式出口，只有这些能被别的分片看到
 *     })()
 *
 * 不要靠"大家共享同一个闭包"隐式传值 —— 之前几轮事故（读到自己写的值、
 * 把整页面磨砂）根因都是没有边界，拆文件的同时必须把边界一起立起来。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src', 'client')
const OUT = path.join(ROOT, 'lib', 'client.js')

/**
 * 拼接顺序 = 依赖顺序：后面的分片可以使用前面分片定义的命名空间。
 * 顺序写死在这里，不用 readdir —— 目录顺序不可控，而加载顺序是有语义的。
 */
const PARTS = ['skin/dsh.js', 'main.js']

const HEADER = "window.__ModuleLoader__.load({\r\n  id: \"dsh-netease-music\",\r\n  factory: (require) => {\r\n    var module = { exports: {} };\r\n    var exports = module.exports;\r\n    Object.defineProperty(exports, Symbol.toStringTag, { value: \"Module\" });\r\n    var React = require(\"react\");\r\n    var ReactDOM = require(\"react-dom\");\r\n\r\n"
// 尾部开头必须是**一个空行**：分片末尾的换行会在拼接前被裁掉，
// 所以这里补两个换行，才能还原成 "…}" + 空行 + "exports.apply = apply;"。
const FOOTER = "\r\n\r\n    exports.apply = apply;\r\n    exports.inject = inject;\r\n    return module.exports;\r\n  },\r\n});\r\n"

const chunks = []
for (const name of PARTS) {
  const file = path.join(SRC, name)
  if (!fs.existsSync(file)) throw new Error('缺少源分片: ' + file)
  const text = fs.readFileSync(file, 'utf8').replace(/[\s\r\n]+$/, '')
  chunks.push(text)
}

const out = HEADER + chunks.join('\n\n') + FOOTER
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, out, 'utf8')
console.log(
  '[build-client] ' + PARTS.length + ' 个分片 → ' + path.relative(ROOT, OUT).replace(/\\/g, '/') +
    '  (' + out.split('\n').length + ' 行, ' + out.length + ' 字符)'
)
