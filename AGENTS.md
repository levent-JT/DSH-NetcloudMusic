# dsh-netease-music —— 项目理解与踩坑档案

> 这份文件是给**未来的我自己**看的，不是给人看的文档。
> 目的只有一个：**同一个错不要来来回回犯**。每次动手前先扫一遍下面的「踩过的坑」。
> 最后更新：2026-10-15

---

## 0. 一句话现状

DSH 的网易云音乐插件：整页播放器页签 + 侧栏小播放器 + 沉浸式背景皮肤。
宿主（Node）+ 客户端（浏览器）两半。已上线可用，仍在迭代。

- 仓库：`C:\Users\levent.li\Desktop\临时任务\dsh-netease-music`（分支 `main`，远程 `origin`）
- 用户环境：DSH 桌面端，Web GUI 端口 19387，账号 LV10 黑胶 VIP（有 `jymaster` 母带权限）
  - **版本号我不知道**（`app.asar` 是打包的，翻不到 `package.json`）。
    能核到的是：`app.asar` 修改时间 **2026-09-29 18:34**，解包目录 `app.asar.unpacked\dsh\`。
    需要版本时**去查，不要引用这里**。同类事实（路径、版本、端口）如果核不出来就标注"未核实"。
- **用户的固定规矩**（违反会被骂）：
  - **不许自行 commit/push**。改动留在工作区，把「文件清单 + commit message 原文」给他过目，他说「提交」才提。一次同意不覆盖下一次。
  - 数据库默认只读（DQL），DDL 全局禁止。
  - 他**不看代码**，只看效果。所以「我改对了」必须用可验证的证据说话，不能靠"我读了代码觉得对"。

---

## 1. 架构：两半 + 一条零依赖构建管线

```
lib/index.js          宿主（Cordis 插件）。inject: ['webServer']
lib/client.js         客户端构建产物（DSH 只能加载一个自包含的 client 文件）
src/client/*.js       客户端源码，按顺序拼接成 lib/client.js
scripts/build-client.mjs   拼接脚本，PARTS 数组就是顺序
scripts/verify-split.mjs   多重集比对（拆源码后产物是否等价）
test/*.mjs            自测
```

**分片顺序（PARTS，就是依赖顺序）**：

```
cache.js → lyrics.js → skin/dsh.js → skin/palette.js → skin/layers.js → main.js
```

它们拼在**同一个 factory 作用域**里 —— 所以后面的分片能用前面的普通声明（`function`/`const`），
**反过来不行**。这条约束下面「踩坑 #1」会再讲一次，它炸过一次。

**分片内的写法约定**：`const X = (() => { ...; return { 显式导出 } })()`。
不要 ES module（DSH 加载的是单文件）。

### 宿主 ↔ 客户端的契约

客户端只通过 `HOST = /plugin/netease-music` 下的路径说话，宿主注册了 7 条 `kind:'exact'` 路由：

```
/api  /settings  /status  /cookie  /logout  /restart  /state
```

**四个挂载点**（id 各不相同 —— 曾经 `conversation.view` 和 `settings.section` 都用 `netease-music`，
任何按 id 索引的实现都会互相覆盖，已拆开）：

| 槽 | id | 组件 |
|---|---|---|
| `conversation.view` | `netease-music` | `MusicPage`（整页播放器页签） |
| `sidebar.footer.action` | `netease-music-player` | `SidebarPlayer`（侧栏小播放器，与用量卡片同挂点） |
| `conversation.session.header.actions` | `netease-music-view-bridge` | `ViewBridge`（只为拿到 `selectView`，不渲染） |
| `settings.section` | `netease-music-settings` | `SettingsView` |

三个渲染型组件都包在 `PluginErrorBoundary` 里（见踩坑 #13）。

**响应形状不一样，这里有坑**：

| 路径 | 形状 |
|---|---|
| `/api?method=...` | **信封** `{ status, body }`；客户端 `api()` 取 `envelope.body` |
| `/settings` `/status` `/state` | **平的**（`hostSettings()` 直接读 `res.settings`） |

写测试桩时搞错这个，会让 `store.login` 恒为 null、所有视图被 `LoginGate` 挡住 ——
**我为此白折腾了一轮**（踩坑 #6）。

`/api` 是个代理：宿主拿存着的 Cookie 去请求网易云。**所以我有现成的真实数据通道**：
```
GET http://127.0.0.1:19387/plugin/netease-music/api?method=%2Fxxx&param=...
```
**能用真实账号验证的事，永远不要靠读代码猜。**（踩坑 #4 就是这么栽的。）

---

## 2. 网易云 API 的实测结论（都是真账号跑出来的，别再重新推）

### 写操作必须走 eapi 加密

明文 `/api/` 写请求一律返回 `code=524 当前环境异常`。加密方式：

```
message = `nobody${path}use${text}md5forencrypt`
payload = `${path}-36cd479b6b5-${text}-36cd479b6b5-${md5}`
params  = AES-128-ECB(payload, 'e82ckenh8dichen8') → 大写 hex
endpoint= https://interface.music.163.com/eapi<path>
UA      = NeteaseMusic/9.5.61.260802021928(9005061);…
```

### 音质阶梯（歌曲 287398 实测）

```
standard 128k mp3 / higher 192k / exhigh 320k / lossless 901k flac
hires → 降级   jymaster 5.4M flac 192kHz   vivid/dolby → av3a（浏览器解不了，已排除）
sky → 降级为 jyeffect
AUTO_CHAIN = ['jymaster', 'exhigh', 'standard']
```

缓存策略：**缓存"档位"而不是 URL**（直链会过期）；命中档位会**插到链首**，所以过期条目能自愈；
失败不缓存；用户手动选档位时不缓存。

### 心动模式（重要，官方语义 + 接口实测）

**两代模式，别混**：

|  | 心动模式（2018，[topic 43237122](https://music.163.com/topic?id=43237122)） | 智能推荐模式（2021，[topic 53216767](https://music.163.com/topic?id=53216767)） |
|---|---|---|
| 种子 | **红心歌单** | 当前播放列表 |
| 任意歌单可用 | ✗ 只在我喜欢的音乐 | ✓ 创建/收藏歌单 |
| 播放模式可切 | ✗ 不能 | ✓ 能 |
| 推荐内容 | 红心老歌 + 新歌 | 全是新歌 |

**我们做的是第一代**。`/playmode/intelligence/list` 的实测矩阵：

```
pid=红心歌单 + 锚点=红心歌    → 200，151 首（121 推荐 + 30 红心）
pid=红心歌单 + 锚点=非红心歌  → 200，151 首   ← 锚点是不是红心，接口根本不看
pid=红心歌单 + 锚点=0        → 200           ← 连锚点都可以没有
pid=自建歌单                → 400「不支持该歌单类型」
pid=0 / 空                  → 400「歌单不存在」/「参数错误」
锚点不同 → 返回首曲不同（锚点只影响推荐风格）
```

**唯一硬性条件：`pid`（种子歌单）必须是「我喜欢的音乐」。**
它与"此刻在播哪个歌单"**完全无关**。锚点必须是正在播放的那首（官方原话：重点关注开启时正在播放的单曲）。

**用户的原话「只有我喜欢的歌单才能启动」说的就是这个 pid** —— 我一开始理解成"当前队列来源必须是红心歌单"，
于是从日推/搜索听歌时按钮是灰的、切歌就掉出循环，两个 bug 都出自这一条（踩坑 #4）。

判定函数：`canStartHeartbeat() = !!(store.login && store.likedPlaylistId)`。
心动是 `modeOptions()` 里的一档（顺序→循环→单曲→随机→心动），心动态下模式按钮变粉、不禁用。

---

## 3. DSH 皮肤机制（背景 + 玻璃）

### 令牌覆写

`AMBIENT_TOKENS` 里那 7 个 `--dsw-alias-bg-*` 被改写成带 alpha 的 rgba，让背景透出来。
读宿主原色必须读 `:root`（我们写在 `body`，不会污染读取源 → 反复应用幂等）。
**踩过一个坑**：心跳重贴时读到了自己写的值，文字越来越暗（踩坑 #7）。

DSH 的次要文字令牌是**半透明白**（如 `rgba(255,255,255,.35)`），有效亮度 ≈0.39 而不是 1.0。
所以抬亮判断必须算 `effective = alpha*colorLum + (1-alpha)*bgLum`，不能只看 RGB。

### 磨砂（nm-frost）

`frostReason(el)` 返回空串就是该磨，否则给出**具体原因**（这是后加的，原来只有 true/false，
出问题时问不出是哪道闸拦的 —— 踩坑 #8）：

```
尺寸小 (<48×28)                     → too-small
高 >= 88% 视口高                     → full-height-region（常驻版式区域：左侧栏、主对话区）
面积 > 85% 视口面积                  → full-page-area（整页级容器）
背景色不是我们改写过的令牌            → bg-not-a-rewritten-token   ← 输入框卡在这
背景色是 transparent/解析不出来       → bg-transparent-or-unparsable
```

**两道尺寸闸的由来**：`backdrop-filter` 会让元素变成**包含块**，里面的 `position:fixed` 后代
会被重新锚定到它身上 —— 实测**把整个左侧栏锚飞过**。所以整页级容器绝对不能磨。
高度闸拦常驻版式区域，面积闸兜底防锚飞。

`DshSkin.explainFrost(el)` 只读地沿祖先链给出每层的尺寸/背景色/背景图/是否已磨/被拒理由。

### 别按令牌名一刀切

曾经有 `NO_FROST_NAME_RE = /(bg-base|sidebar-fill)/i`，是防"磨了整页容器"的早期补丁。
尺寸闸到位后它只剩误伤 —— **主页面底部那个输入框就是这么丢掉磨砂的**。
已删，改由形态（尺寸）决定。

---

## 4. 踩过的坑（每次动手前扫一遍）

### #1 标识符不在作用域里 —— 最难查的一类

**症状**：整个播放器页签空白、控制台什么都没有。
**原因**：`activeLyricIndex` 被搬进 `skin/layers.js` 成了 IIFE 私有函数，而 `main.js` 的播放器视图
还在直接调它 → `ReferenceError` → React 卸载整个 root → 页面空白。
**为什么所有检查都没抓到**：它在别的分片里**确实有定义**，
所以"全仓搜一下有没有定义"这种**扁平检查永远抓不到它**。我当时就是这么检查的，一路绿灯上线。

**解决办法（已落地）**：`test/client-apply.mjs` 里装了**作用域探针** ——
把 bundle 包进 `with(proxy)` 跑，代理的 `has` 恒为 true，于是**所有自由标识符的解析都落到 `get` 上**；
`get` 收到既不在沙箱、也不在真实全局里的名字就记一笔。
回归验证过：把定义改名后测试报红并点名 `播放器: activeLyricIndex is not a function`。

**教训**：跨分片重构后，**必须跑渲染测试**，不能只跑语法检查。
"静态检查全过"和"代码能跑"是两件事。

### #2 验证路径必须覆盖风险位置 —— 这条违反过两次

第一次：改了 `apply()` 之后的数据流，但测试**只加载 factory、从不调 `apply()`** → 上线崩。
第二次：改了播放器视图，但测试**只渲染默认的 daily 视图** → `activeLyricIndex` 漏过去。

**现在的规矩**：改动之后问自己一句「**我的测试会走到我刚改的那行吗**」。
`client-apply.mjs` 会渲染**全部 8 个子页签**，就是为了堵这个。

### #3 回归验证：证明测试真的有牙齿

写完测试不算完。**把 bug 塞回去，确认它会报红** —— 不报红说明测试是纸糊的。
这条已经抓出过两次假测试：`click()` 不看 `disabled`（"点了"其实是空的）、
以及 `store.dailySongs` 是空的时候点「播放全部」根本没执行到被测代码。

### #4 先去核实官方语义，别照自己的代码模型改

心动模式那两个 bug 折腾了很久，根因是**我一直按自己读代码得出的模型在改**，
而那个模型（"当前队列来源必须是红心歌单"）**从根上就是错的**。
用户第一次描述时说的就是对的。

**规矩**：涉及外部系统行为（网易云的接口语义、官方模式定义）时，
**先上网查官方文档 / 用真实账号做接口实验**，不要从自己的代码反推。

### #5 拿着错误的前提去猜病因

心动模式"点不了"，我猜是"它藏在模式循环第 5 档" → 拆成独立按钮 ✗。
**真因是判据错**，位置本来就是对的。用户一句话把我纠正回来：「它应该是切换播放类型的一种」。

**规矩**：现象 → 机制 → 修复，中间那一步**必须有证据**。
"我觉得大概是……"不算。

### #6 测试桩的形状要和真实契约一致

我一度把**所有**接口响应都套成信封 `{status, body}`，结果 `/settings` 是平的，
`store.settings` 变 null → 设置页崩。**测试反而抓住的是我自己改坏的东西**。

### #7 读到自己写的值

心跳每 3 秒重贴令牌，而 `tokenSources()` 包含了我们自己写过的 `body` 及其后代 →
读到的是"被压暗过的值"，于是每 3 秒更暗一点（用户："几秒后变暗"）。
修法：`readTokenOriginal()` 优先读 `document.documentElement`（我们从没写过它），
读不到就在首次见到时缓存。

### #8 删了一个还没验证修好的诊断

输入框磨砂那个问题**没确认修好**，我却在"清理调试脚手架"时把它的一性诊断一起删了 ✗。
后来又得装回来。

**规矩**：删东西之前先问「**这个问题真的验证修好了吗**」。
报错**能力**（`reportClientError` + 错误边界）永远留；
报错**内容**（针对某次故障的 DOM 快照）在故障确认修复后再撤。

### #9 PowerShell 会吃参数 —— 栽过三次

```powershell
git commit -m '标题' -m '正文' -m '' -m '缓存（…）'
#                  ↑ 空参数被吃掉，后面的值被当成 pathspec → commit 失败，
#                    源码全并进了下一条 commit，message 还完全不符

node -e "console.log('  ★ x === \"5\"')"   # 转义被吃掉 → SyntaxError
```

**规矩**：
- **git 的 commit message 一律走 `-F <文件>`**，不用 `-m`。
- **多行 / 含引号 / 含反斜杠的 Node 代码，一律写成 `.mjs` 文件再跑**，不用 `node -e`。
- 命令里避免 `<` `||` `\.` 这些 PowerShell 特殊字符。

### #10 花括号配平不能天真

按"下一个 4 空格缩进的 `}`"找函数结尾 → **在函数内部就停了，把函数腰斩**，语法报错。
**规矩**：要删整块代码时，**按 `{}` 深度配平**，并且先剥掉字符串/模板里的花括号。

### #11 误判死代码

用 `(?<![.\w$])name` 找引用 → 把 `...svgProps(s)` 的展开排除掉了 → **差点删掉活代码**（它 14 处使用）。
**规矩**：查"用没用"时 `...name` 要算使用；删之前**逐个人工过一遍**。

### #12 排查用的上报会被后续上报盖掉

宿主 `/diag` 只保留最后一条。侧栏遥测在卡片挂载 2.5 秒后才发，
时间点比我早先的诊断晚，**必然把它盖掉** → 我读回来的是遥测不是诊断。
修法：诊断搭遥测的顺风车（把最近一次错误/DOM 快照塞进同一个 payload），
并用**环形数组**保留最近 8 条 —— 单槽会被后来的覆盖，崩溃现场就是这么丢的。

### #13 静默失败最贵

React 组件抛错会**卸载整个 root**，表现是"一片空白、什么都没说"。
`activeLyricIndex` 那次就是这样，查了两晚。
**现在的保险**：`PluginErrorBoundary`（包住注册的组件）、`BgErrorBoundary`（包住背景层）、
`apply` 外层 try-catch 上报、`window.onerror` / `unhandledrejection` 上报。
**背景层坏掉的正确表现是"没有背景"，不是"整页白掉"。**

### #14 CRLF

仓库里的文件全是 CRLF。脚本里做多行字符串替换时**必须把 `\n` 换成 `\r\n`**，
否则匹配静默失败（命中 0 次，什么也没改，但脚本"成功"返回）。

---

## 5. 构建与验证的工具链（照着用）

```powershell
# 构建（顺序拼接）
node scripts/build-client.mjs

# 语法（源码 + 产物 + 宿主 + 测试）
node --check <file>

# 三个测试
node test/client-smoke.mjs     # 加载 factory、导出形状、挂载点、音质常量
node test/client-apply.mjs     # 调 apply()、渲染全部 8 个子页签、作用域探针、时间线不变量
node test/heartbeat.mjs        # 心动模式端到端：点模式按钮进心动 → 查 pid → 换来源播放 → 仍挂着

# 拆源码后的等价性（多重集比对，注意它和 node --check 各有盲区，两个都要跑）
node scripts/verify-split.mjs
```

**构建确定性**：连编两次要比 SHA256 一致。

**helper 脚本放 `%TEMP%`**，不要污染仓库。仓库里只有 `test/` 和 `scripts/`。

---

## 6. 渲染与性能（已做的优化，别改回去）

**A. 时间单独一条订阅线**
`store.time` 在 `timeupdate` 里每秒变 4~5 次。原来 `emit()` 只有一个版本号，
所以 19 个 `useStore()` 组件（含 218 行的设置页、145 行的侧栏卡片）全部跟着重渲染。
现在：`emit()` 推两条线（`version` + `clock`），`emitClock()` 只推 `clock`；
只有 `LyricsBox` / `PlayerView` / `SidebarPlayer` / `PlayerBar` 用 `useClock()`。

**⚠️ 关键**：`pushSkin` 必须**两条线都挂**（`subscribe` + `subscribeClock`）。
只挂 version 的话，`timeupdate` 不推给背景层 → **背景歌词卡住不动**。
这个是自我审查时抓到的回归，测试里有不变量断言钉着。

**B. 背景只在"看得见的"变化时通知**
`SkinLayers.update()` 比较封面/是否在播/当前歌词行/量化到 1% 的进度，
没变就**不换 snapshot 引用、不通知**。原来无条件 `{...snapshot, ...next}`，
`timeupdate` 每秒 4~5 次都把 146 行的 8 层图层树整体重渲染。实测渲染次数 232 → 88。
进度量化还有第二个作用：保证 `getSnapshot` 在无变化时返回同一引用
（否则 React 会判定它在无限变化）。

**C. 定时器只有两个，都是功能性的**
`pollCommands` 1200ms（AI 指令轮询）、`applySkin` 3000ms（主题令牌兜底重贴，有 signature 去重）。

**量不出来的事**：这个 harness 没有真正的 React 调度器、也不走真实播放链路，
"每次 timeupdate 有几个组件重渲染"**量不出来**。我先后印过两个数字，**两个都是错的**
（一个量的是 harness 自己手动 walk 的次数，一个打了空事件）。所以改成钉不变量。

---

## 7. 清理掉的与必须保留的

**必须保留（安全网）**：
`reportClientError`、`clientErrors` 环、`PluginErrorBoundary`、`BgErrorBoundary`、
`apply` 的 try-catch 上报、`window.onerror` / `unhandledrejection` 监听。

**已清理（别再加回来）**：
`reportDomDiag` / `dumpDom` / `samplePresence` / `reportInputDock` / `reportSoon` /
侧栏布局遥测 useEffect（每次布局一次 `getBoundingClientRect` + 一次网络 POST）。
死图标 `IconStar`/`IconGear`/`IconExpand`/`IconClock`/`IconList`（各 0 次使用）
+ `panelTabs` 的 `icon` 字段（写 8 处、读 0 处）。

---

## 8. 待办 / 已知欠缺

- **输入框磨砂**：诊断已装（`DshSkin.explainFrost` + `/diag` 的 `input-frost:*`），
  等一次 F5 拿真实拒绝理由。最可疑是 `bg-not-a-rewritten-token`
  —— 它要求背景色"正好是我们改写过的令牌"，半透明/渐变/color-mix 的控件全都过不了这关。
- **智能推荐模式（2021）没做**：种子是当前播放列表、可自由切模式、推全新歌。接口与心动模式不同。
- **`SettingsView` 218 行**：拆分候选，但**慎动** —— 用户被我的重构炸过两次。
- **`main.js` 仍 2800+ 行**：真要拆就按视图切（SettingsView / SidebarPlayer / PlayerView 各自自洽），风险最低。
- **`conversation.session.header.actions` 桥接**：`Ctrl+Shift+M` 那条路径是死的。
- **`DATA_DIR` 在模块加载时求值**：多 profile 的配置不独立，要改得配 Cookie 迁移。

---

## 9. 我自己的行为准则（血泪版）

1. **先核实，再动手**。外部系统行为上网查 / 用真账号实验；不要从自己的代码反推语义。
2. **改完问一句「测试会走到我刚改的那行吗」**。不会就想办法让它走到。
3. **写完测试把 bug 塞回去**，确认它报红。不报红就是假测试。
4. **报错能力永远留，报错内容按需撤**。删东西前问「这个问题真验证修好了吗」。
5. **多行脚本一律写文件**，不用 `node -e`；git message 一律 `-F`。
6. **删代码按 `{}` 深度配平**，先剥字符串。
7. **能量化的就量化，量不出来就诚实说量不出来** —— 不要印一个看起来很像真的假数字。
8. **不许自行 commit**。改动留工作区，给清单 + message，等用户说「提交」。
