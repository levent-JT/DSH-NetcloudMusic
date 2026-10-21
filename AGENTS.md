# dsh-netease-music —— 项目理解与踩坑档案

> 这份文件是给**未来的我自己**看的，不是给人看的文档。
> 目的只有一个：**同一个错不要来来回回犯**。每次动手前先扫一遍下面的「踩过的坑」。
> **踩坑史已拆到 [`AGENTS.pitfalls.md`](AGENTS.pitfalls.md)** —— 动手前先扫一遍那份。

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

客户端只通过 `HOST = /plugin/netease-music` 下的路径说话，宿主注册了 8 条 `kind:'exact'` 路由：

```
/api  /settings  /status  /cookie  /logout  /restart  /state  /commands
```

**AI 指令通道（/commands）**：这条路由**长期不存在**，2026-10-17 补上（见踩坑 #22）。

- `POST /commands` `{type, payload}` → 投递一条指令，返回 `{ok, seq}`；
  可用类型见宿主的 `COMMAND_TYPES`（playSong / pause / toggle / next / previous /
  setMode / volume / playDaily / playPlaylist），未知类型直接拒。
- `GET /commands?since=<seq>` → `{since, commands[]}`，只返回 seq 更大的。
- 客户端 `pollCommands`（1.2 秒一次，页面不可见时降到约 6 秒）领走后交给 `runCommand`。
- 队列只留最近 50 条且不超过 5 分钟 —— 这是**实时通道，不是消息队列**。

**`/state` 现在真的能用了**：客户端 `emit()` 会调 `scheduleReport()`（1.5 秒节流）
把播放状态 POST 给宿主，宿主存在内存里。
原先客户端的 `report()` **从来没被调用过** —— 宿主早就注册了路由并且会存，但没人喂它，
于是"AI 能查播放状态"这个能力实际不存在。现在接上了。


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

### 私人FM：明文可用（推翻旧结论）

**旧结论「私人FM 需要 weapi 加密，本插件明文直连做不到」是错的。**
真账号实测（连打三次一致）：

```
GET https://music.163.com/api/v1/radio/get
  → code=200, data[3]，字段 name/id/artists[]/album.picUrl/duration(毫秒)
```

带 `os=pc; appver=8.9.70` + MUSIC_U/__csrf 就够，不需要 weapi。
返回形状 `{code, data:[...]}` 正是客户端 `loadFm()` 期望的，
`norm()` 里那句 "FM tracks carry duration in ms without dt" 本来就是为它写的 ——
**整套客户端 FM 功能（loadFm / FmView / 页签 / 开关 / 时长适配）一直是齐的，
只是被宿主一句 throw 挡在门外。**

**教训**：一个"做不到"的结论如果没留下实测记录，就该当成可疑 ✓
它可能只是当年某次没试对。**下结论时把用的端点和返回码一起写进注释**，
后人（和未来的我）才有复核的对象。

### 音质阶梯（歌曲 287398 实测）

```
standard 128k mp3 / higher 192k / exhigh 320k / lossless 901k flac
hires → 降级   jymaster 5.4M flac 192kHz   vivid/dolby → av3a（浏览器解不了，已排除）
sky → 降级为 jyeffect
AUTO_CHAIN = ['jymaster', 'exhigh', 'standard']
```

缓存策略：**缓存"档位"而不是 URL**（直链会过期）；命中档位会**插到链首**，所以过期条目能自愈；
失败不缓存；用户手动选档位时不缓存。

### 自动档到底降到哪一档（86 首榜单抽样实测）

设置里的「自动」请求的是**最高档 jymaster**。问题是：没有母带的歌会怎样？
2026-10-16 拿真账号从四个榜单（新歌/热歌/原创/飙升）抽 86 首，逐首请求 `level=jymaster`：

```
jymaster   82 首  95%    ← 有母带给母带（3708~6053k）
hires       2 首   2%    ← 无母带、有 Hi-Res → 降到 hires（1688~1867k）
higher      1 首   1%    ← 只有 192k 的老歌 → 降到 higher
取不到链      1 首   1%    ← 版权/下架
```

**⇒ 网易云在第一档就自己降到"该曲实际最高档"了，而且逐档智能降，不是一刀切。**

所以 `AUTO_CHAIN = ['jymaster','exhigh','standard']` 中间那几档**真的只是兜底** ——
第一档覆盖了所有情况，不需要补 lossless/hires。（这条以前只是注释里的说法，
现在有 86 首数据支撑了。）

顺带实测到的两个反直觉现象：
- 请求 `hires` 时，没有 Hi-Res 的歌会返回 **lossless**（不是 320k）—— 降级是逐档的。
- 首页那种"只有 192k"的歌，请求 jymaster 会返回 `higher` 的链。代码判断的是"有没有 url"，
  有就用，所以拿到 192k，行为正确；只是 `rememberQuality` 会把它记成 jymaster，
  **缓存里的档位名和实际档位不一致**（纯记录问题，不影响播放）。

### 音质徽标（2026-10-16 加）

既然「自动」的实际结果是猜不到的，就把**实际拿到的那一档**显示出来。
实现在 `QualityBadge`（main.js），**同时挂在两处**：

- `PlayerView` 的 `.nm-player-artist`（整页播放器的「播放器」子页签）
- `PlayerBar` 的 `.nm-pb-artist`（非整页模式）

数据来源：`fetchUrl` 改成返回 `{ url, level, br }`，level/br 直接读网易云返回里的
`data[0].level` / `data[0].br`（实测这两个字段就在那儿），存进 `store.actualQuality`。

两个 CSS 细节（不这么做徽标会不见）：
- `.nm-pb-artist` 原来是 `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`，
  徽标作为行内元素会被**一起省略掉** → 改成 flex，文本包一层 `.nm-pb-artist-text` 自己省略，
  徽标 `flex:none`。
- `.nm-player-artist` 没有 nowrap/overflow，直接内联是安全的。


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
背景色不是我们改写过的令牌            → bg-not-a-rewritten-token   ← 曾经的输入框（§8 已销账）
背景色是 transparent/解析不出来       → bg-transparent-or-unparsable
```

**两道尺寸闸的由来**：`backdrop-filter` 会让元素变成**包含块**，里面的 `position:fixed` 后代
会被重新锚定到它身上 —— 实测**把整个左侧栏锚飞过**。所以整页级容器绝对不能磨。
高度闸拦常驻版式区域，面积闸兜底防锚飞。

`DshSkin.explainFrost(el)` 只读地沿祖先链给出每层的尺寸/背景色/背景图/是否已磨/被拒理由。

### 压暗"写死的浅色面"（DARK_SURFACE_CSS）—— 用户认可的方案

**用户定的设计规则（2026-10-15 当天改过一次，以最新为准）：**

- **第一版**：「只有【被选中】的元素可以是白的，其余一律压暗。」
- **修正版（几小时后）**：「新会话」那个**暗底 + 极淡白描边**的框更好看，**不再用大白框表示选中**。
- **最终版（同日再次澄清）—— 这是设计系统的角色定义，比"选中态用不用白"更根本：**
  - **白 = 高重要性（文件级）**，例如「已编辑 AGENTS.md +43 −0」那种文件变更卡片。
    **必须突兀、明显** —— 这是它存在的意义，**不要动它**。
  - **其余一律暗底 + 1px 淡描边**（代码块、消息气泡、按钮、加载更早…）。

**⇒ 判断标准不是"是不是选中态"，而是"这条信息重不重要、需不需要跳出来"。**
**改动前先问：这算不算"文件级重要项"？算就别碰。**

**⇒ 结论：默认质感是「暗底 + 1px 淡描边」；白只保留给文件级重要项。**

**它是怎么来的（别以为是我设计的）**：DSH 那个按钮**本来就有一条 1px 描边**
（`border-width: 1px`，圆角 `var(--dsw-radius-md)`=12px，padding `8px 12px` 也都是它自己的），
只是原来的描边颜色是白的、压在白底上看不见。我们只改了两行：

```css
[class*="newSession"] {
  background-color: rgba(28, 32, 44, .58) !important;   /* 暗灰蓝 */
  border-color: rgba(255, 255, 255, .14) !important;    /* 把那条本来就有的描边点亮 */
}
```

**⇒ 真正的功劳是「给一条本来就存在的描边上了个能看见的颜色」。**
以后做同类质感，先查 `getComputedStyle` 是不是已经有 border/radius，别再自己画一套。

**DSH 自己的设计本来是「浅色块」**：`[data-platform="darwin"] ._2H3hWW_newSession{background:rgba(255,255,255,.55)}`
——Windows 上那个纯白是同一套逻辑的另一份。我们做的是**把它拉到与沉浸背景一致的暗色**。

**为什么不能用改令牌的办法**：CDP 实测（`scripts/cdp.mjs`）——那些白块全是**写死的颜色**：

| 元素 | 类名 | 原底色 |
|---|---|---|
| 代码块三件套 | `_block_7gxqk_4` / `_banner_7gxqk_24` / `_plain_7gxqk_103` | `rgb(249,250,251)` |
| 消息气泡 | `cJsG2q_bubble` | `rgb(237,243,254)` |
| 主按钮「新会话」 | `_2H3hWW_newSession` | `rgb(255,255,255)` |
| 「加载更早」 | *(无类名，靠父层 `xz4KEq_older` 锚)* | `rgb(241,243,245)` |

**不是 CSS 变量** ⇒ 补多少令牌名单都碰不到它们。我为这条错路白试了两轮。

**做法**：`DARK_SURFACE_CSS` 用**属性包含选择器**匹配类名里那截稳定的 hash 后缀
（`[class*="_block_7gxqk"]`），只针对这几种**具体形态**，**不碰通用容器类** ——
所以 **文件卡片这类内容型元素不会被误伤**。
（**选中态后来也压暗了** —— 用户看过实物后选了"一起压暗"，见下面的完整规则清单。）

叠加顺序有讲究：`_block_` 是外层容器（给 `.72` 暗底），`_banner_` / `_plain_` 是内层
（设成 `transparent`）—— 否则三层各压 0.72，叠出来是死黑。

**效果实测**：不透明亮底元素 `30 → 2`，剩下的两个**都是有意保留/已处理的**：
- `kuvljq_header`（「已编辑 xxx」文件卡片）—— 按用户规则**该白，不碰**；
- `xz4KEq_toBottom`（回到底部悬浮按钮，滚动时才出现）—— 已按规则压暗。

**DARK_SURFACE_CSS 的完整规则清单**（判断标准：白只给文件级/内容型，其余压暗；
描边一律用 `box-shadow: inset 0 0 0 1px`，因为这些元素原本 `border-width:0`，加真 border 会抖布局）：

| 选择器 | 底色 | 覆盖什么 |
|---|---|---|
| `[class*="_banner_7gxqk"]` `[class*="_plain_7gxqk"]` | `transparent` | 代码块内层（避免三层叠加变死黑） |
| `[class*="_block_7gxqk"]` `[class*="code-block"]` | `rgba(18,20,26,.72)` | 代码块外层 |
| `pre,code` | `transparent` | 行内代码 |
| `[class*="bubble"]` | `rgba(28,32,44,.58)` | 消息气泡 |
| `[class*="newSession"]` | `rgba(28,32,44,.58)` | 「新会话」主按钮 |
| `[class*="xz4KEq_older"] button` | `rgba(28,32,44,.58)` | 「加载更早」 |
| `[class*="xz4KEq_toBottom"]` | `rgba(28,32,44,.58)` | 回到底部悬浮按钮 |
| `[class*="navCell"][class*="active"]` | `rgba(56,64,82,.72)` | 设置弹窗里**选中的导航项** |
| `[class*="_selector"]` | `rgba(28,32,44,.58)` | 下拉/选择控件（工作区内修改、中文…） |
| `[class*="stepper"]` | `rgba(28,32,44,.5)` | 数字步进器 |
| `[class*="RotMhW_switcher"]` | `rgba(28,32,44,.58)` | 模式状态条（标准模式） |
| `[class*="_tag_"]` | `rgba(28,32,44,.55)` | 状态标签（已停用…） |

**明确保留白的**：
- `kuvljq_header`（「已编辑 xxx」文件卡片）—— 文件级，用户要求必须突兀；
- `v01cdW_themeCube`（主题预览块）—— **内容型**，它的颜色就是在预览主题，压暗即失去意义。
**hash 会随 DSH 版本变** ⇒ 升级 DSH 后要重跑一次 CDP 查询确认选择器还匹配得上。

### DSH 皮肤总开关（settings.ambient.enabled）

**用户需求**：能让用户关掉**所有 DSH 皮肤相关的东西**，只留听歌功能。

**为什么只要一行**：整条皮肤链只有两个 `DshSkin.applySkin` 调用点，且都在
`layers.js` 的 `AmbientBg` 那个 `useEffect` 里。那里本来就有 `enabled`：

```js
const skinOn = cfg.enabled !== false;              // ← 总开关
const enabled = skinOn && mode !== "off" && !!cover;
```

`enabled` 为假时：早退不渲染背景 ✓ `clearSkin()` 还原令牌 ✓ `removeAllFrost()` 摘磨砂 ✓
`removeSurfaceStyle()` 撤压暗规则 ✓ 3 秒兜底轮询不启动 ✓ —— **全都自动成立**。
所以设置里原本就有的「背景 → 关闭」其实早就走通了这条路径，总开关只是**或**进那个判断。

**关掉之后**：DSH 回到原生外观（面板不透明、文字原色、无磨砂、无背景图），
而插件自己的面板照常可用。**听歌功能一行不受影响。**
播放页自己的背景样式（nm-amb-*）属于我们自己的页面，不在这个开关范围内。

**⚠️ 一个必须记住的坑**：静态 CSS（`injectCss()` 注入的那份）里有规则会**绕过**总开关。
典型是弹窗遮罩那条 `div[role=presentation]:has(>div[aria-hidden=true]:first-child)` ——
它不需要我们的类名就能命中。**凡是"不依赖我们加的类名"的规则，都必须放进
`DARK_SURFACE_CSS`**（那份由 applySkin 注入、clearSkin 摘除，跟着开关走）。
以后再往静态 CSS 里加东西，先问一句：关掉皮肤它还会生效吗？

**生效时机**：宿主那半（`lib/index.js` 的默认值）要 **DSH 重启**；客户端那半要 **F5**。
老配置里没有这个键，靠 `ambient: { ...DEFAULT_SETTINGS.ambient, ...(raw.settings.ambient || {}) }`
的逐键合并补上（所以改默认值对老用户生效 —— 注意这条与文件顶部"改了默认值对老用户不生效"
的迁移注释是两回事：那条说的是有专门迁移代码的地方）。

### 用户亲手定的视觉参数 —— 量过，但**不要动**

有些数值拿"通用规范"去衡量会显得偏小，但它们是用户定的，提议改动会被明确拒绝。
**做 UI 审计前先看这一节，别把它们当待整改项。**

**侧栏播放器卡片（`.nm-side`，2026-10-19）**

用户原话：「这个卡片我觉得没什么问题，是我亲自操刀设计的，大小和功能都是刚好的。」

我当时做了一次 UI 审计，量到的数据（**留档供核对，不是整改清单**）：

```
卡片        256×66   padding 10px 14px   圆角 12px
封面        61×61
标题        11.5px   副标题 10px
控制按钮    ♡ 18×20 / 上一首 21×19 / 暂停 21×19 / 下一首 21×19 / 模式 21×19
按钮内图标  8×9
宽度账      封面右缘 73 → 第一个按钮 147，可用 67px，标题实际用 52px
```

我按"点击区 ≥28px"的通用阈值提了三种改法（放大按钮 / 改两行布局 / 精简控件），
**被明确拒绝**。理由：紧凑就是这个卡的设计意图，侧栏只有 256px 宽。

**⇒ 规矩：256px 宽的侧栏卡片，"通用最小点击尺寸"不适用。**
以后做 UI 审计，`.nm-side` 的尺寸与字号**不要出现在建议清单里** ——
它是已达成的设计基线，不是缺陷。

**同一轮审计里还有两处"量出来偏低，但决定不改"**：

- 背景歌词行 `.nm-amb-tr`：`rgba(255,255,255,.44)`、15.25px、实测对比度 4.37:1
  （WCAG AA 要 4.5）。它是有意做淡的装饰层，**不改**。
- DSH 自己的蓝色强调色（`dcs-effort-text` 4.25:1、激活页签 4.35:1）：
  那是 DSH 的品牌色，我们改了会破坏它的一致性，**不动**。

**这轮审计唯一"确认没问题"的三条**：亮底元素 **0 个**（"白色只给文件级"的规则守住了）、
被截断文字 **0 处**、我们注入的 CSS 规则 195 条（没失控）。

### 别按令牌名一刀切

曾经有 `NO_FROST_NAME_RE = /(bg-base|sidebar-fill)/i`，是防"磨了整页容器"的早期补丁。
尺寸闸到位后它只剩误伤 —— **主页面底部那个输入框就是这么丢掉磨砂的**。
已删，改由形态（尺寸）决定。

---

## 4. 踩过的坑（索引）

**完整内容在 [`AGENTS.pitfalls.md`](AGENTS.pitfalls.md) —— 动手前先扫一遍。**

这里只列标题，方便你判断该去看哪几条：

- #1 标识符不在作用域里 —— 最难查的一类
- #2 验证路径必须覆盖风险位置 —— 这条违反过两次
- #3 回归验证：证明测试真的有牙齿
- #4 先去核实官方语义，别照自己的代码模型改
- #5 拿着错误的前提去猜病因
- #6 测试桩的形状要和真实契约一致
- #7 读到自己写的值
- #8 删了一个还没验证修好的诊断
- #9 PowerShell 会吃参数 —— 栽过三次
- #10 花括号配平不能天真
- #11 误判死代码
- #12 排查用的上报会被后续上报盖掉
- #13 静默失败最贵
- #14 换行符：仓库按 LF 存，工作区是混的 —— 这条原来写反了
- #15 静默失败的字符串替换 —— 今天犯了两次
- #16 共用一把闸 + 提前记账 = 静默永不执行
- #17 测试掉了断言数，比测试失败更危险
- #18 DSH 的视图容器是 flex-shrink:0 —— height:100% 会参照错的父高
- #19 产物非原子写 → DSH 热重载读到半截 → "插件加载失败"
- #20 组件放错地方 —— 加了 UI 却永远不出现
- #21 样式注入不幂等 —— 热重载每来一次就多一份
- #22 半个功能：宿主那条路由从来没写过
- #23 过期响应覆盖 —— 异步返回后没确认"我还是不是当前的"
- #24 「改了但没生效」—— 在旧代码上验证新代码
- #25 别在用户正在用的页面上主动 reload
- #26 长生命周期页面里的"按天"数据永远不会自己失效
- #27 测试读自己的临时文件当凭据 —— 只在"上次跑过"时能通过
- #28 播放器页改版：一个"看起来是审美、其实是布局"的 bug

## 5. 构建与验证的工具链（照着用）

```powershell
# 构建（顺序拼接）
node scripts/build-client.mjs

# 语法（源码 + 产物 + 宿主 + 测试）
node --check <file>

# 测试（5 个文件，共 132 条断言）
node test/host-selftest.mjs    # 宿主 37 条：全部路由 + AI 指令通道 + /state 读写 + DNS rebinding 防护
node test/ambient-selftest.mjs # 背景/皮肤 21 条
node test/client-smoke.mjs     # 加载 factory、导出形状、挂载点、音质常量
node test/client-apply.mjs     # 调 apply()、渲染全部 8 个子页签、作用域探针、时间线不变量
node test/heartbeat.mjs        # 心动模式端到端：点模式按钮进心动 → 查 pid → 换来源播放 → 仍挂着

# 拆源码后的等价性（多重集比对，注意它和 node --check 各有盲区，两个都要跑）
node scripts/verify-split.mjs
```

**构建确定性**：连编两次要比 SHA256 一致。

**helper 脚本放 `%TEMP%`**，不要污染仓库。仓库里只有 `test/` 和 `scripts/`。

### ★ 实时 DOM 通道（CDP）—— 别再只会"埋探针 + 等用户 F5"

DSH 的快捷方式已加 `--remote-debugging-port=9222`（在快捷方式的「目标」参数里，清空即还原）。
**有了它就能直接读渲染进程的实时 DOM**，不用再让用户 F5、也不用再猜：

```powershell
node scripts/cdp.mjs --list                    # 看页面目标
node scripts/cdp.mjs "document.title"          # 读任意表达式
node scripts/cdp.mjs --file <表达式文件>         # 表达式从文件读 —— **首选**
```

**`--file` 是首选**：Windows PowerShell 会吃内联命令里的引号和反斜杠（踩坑 #9）。
表达式写成文件时用 PowerShell 的 `@'...'@` 单引号 here-string（字面量，最安全）。

**★ `--shot` 是"改完自己看"的关键**：

```powershell
node scripts/cdp.mjs --shot out.png            # 截图（窗口在后台也能拍）
```

不用再让用户截图转述。做法：先 `--shot before.png`，改完再 `--shot after.png`，两张对着看。

**做 A/B 对比时务必确认两次截图之间画面没变** —— 我第一次对比就翻车了：
两张图中间**歌换了**，背景跟着换，根本不能比，白白得出一个假结论。
**A/B 要在同一状态下反复开关来拍**（比如反复增删那段试探 CSS），不要在两次改动的间隔里拍。

要**量化**差异而不是靠眼睛时，可以用 System.Drawing 逐像素算平均通道差与差异像素占比。
实测一个视觉上几乎不可见的改动是 0.305/255、差异明显像素 0.48%。

能干的活：查类名与计算后样式、算对比度、点按钮、读任意 JS 变量、**注入一段 CSS 试效果**。

**"注入试效果再落地"这个打法特别值**：先用 CDP 插一个 `<style id="__probe_xxx">` 看效果，
确认后再写进插件源码。比"改源码 → 构建 → 用户 F5 → 说不对"快一个数量级，
**而且改错了不用回滚源码**（删掉那个 style 标签就行）。

DSH 自己也有 F12（分离的 DevTools，见 app.asar 里的 `before-input-event`）
和 `DSH_DESKTOP_OPEN_DEVTOOLS` 环境变量 —— **但那个窗口我看不见，对排查没帮助。**

> 背景：为了搞清"白块"和"文字对比度"，我让用户 F5 了近十次、猜错三轮（全部失败）。
> 开了 CDP 之后，**一次查询**就拿到结论：那些白块全是**写死的颜色**（`rgb(249,250,251)` 等），
> **根本不是 CSS 变量** —— 所以"补令牌名单"那条路从根上就不可能 work。

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

**B2. 磨砂按面积降 blur（实测过的性能改动，别改回去）**

```js
function blurForArea(area) {
  if (area > 120000) return "8px";     // 1000×221 那两块 → 8px
  if (area > 40000)  return "12px";
  return "18px";
}
```

依据：`backdrop-filter` 的合成代价与**面积**近似成正比，而不是与 blur 半径成正比；
大面板本来就要被磨成一片均匀的底，18px 和 8px 目视差别很小。

CDP 量到：33 个磨砂元素总面积 1.15M px²，**最大的两块 1000×221 占了 38%**。
改动后分布 18px×39 / 12px×1 / 8px×2。同曲 A/B 逐像素：平均 0.305/255、
差异明显像素 0.48% —— 肉眼不可分辨。

配套：磨砂尺寸下限从 48×28 提到 **80×36**（更小的看不出磨砂，却各占一个合成层）；
`frostScan` 的面积必须在**读**那一趟量好（写的时候再读 rect 会强制重排）。

**评估过但没做**：把全屏 `nm-amb-cover` 的 `filter` 换成叠加层。
我原先说它"每帧走一次滤镜 pass"是**错的** —— 静态层会被合成器缓存，只在内容变化时栅格化。
实际收益只是省一个全屏 GPU 层，收益小、视觉风险却在，所以不动。

**C. 定时器只有两个，都是功能性的**
`pollCommands` 1200ms（AI 指令轮询）、`applySkin` 3000ms（主题令牌兜底重贴，有 signature 去重）。

**C2. 样式注入幂等（2026-10-17 修，别再改回去）**

`DshSkin` 的 `surfaceStyleEl` / `ambientStyleEl` 原来是模块级变量 + 无条件 createElement，
热重载后旧份留在 DOM 里 → 实测攒到 4 份。现在注入前按 `data-plugin` 清旧份，
**4 份 → 1 份，连编两次仍然 1 份**。机制见踩坑 #21。

**D. 撤掉常驻诊断（2026-10-17）**

删掉了 3 个自动诊断定时器（15/30/60 秒）与 4 个诊断函数。它们每次跑都要
`getComputedStyle` 扫全文档，而句柄不存、teardown 取消不掉 —— 热重载一次就留一批。
诊断能力改按需：`window.__nmDiag`。

**E. 轮询降频**

`pollCommands` 原来无条件每 1.2 秒一次。现在页面不可见时降到 1/5（约 6 秒一次）——
保留而不是完全停，是为了后台时 AI 指令仍能收到（最多延迟 6 秒）。


**F. 磨砂类丢失自愈（2026-10-19 修，别再改回去）**

**症状**（用户报的）："输入框磨砂有的时候会失效"。间歇性，看不出规律。

**实测确认的机制**：把 `RlGAzG_card` 的 `nm-frost` 手动抹掉，等 10 秒（跨过 3 个 applySkin tick）
→ **仍然没有磨砂**。也就是**磨砂类一旦丢失就永久丢失**，两层原因：

1. `applySkin` 有签名去重（`sig === ambientSig` 就直接 return），而"补磨砂"在去重之后；
2. 磨砂观察器只监听 `childList` —— **React 重写 className 属于属性变更，唤不醒它**。

所以只要 React 某次整体重写了那个卡的 `className`，我们加的类就被静默抹掉、永不恢复。

**修法（认领制 + 属性监听）**：
- `frostedBlur`：一个 Map(element → blur)，记住"哪些元素是我们磨的、该用多大 blur"；
- 观察器加 `attributes: true, attributeFilter: ["class"]`，回调只处理
  "在认领表里、但类没了"的元素 —— 状态栏那种频繁改类的元素不会被误处理；
- `applySkin` 在**签名去重之前**调一次 `reassertFrost()` 兜底（O(认领表)，不做任何
  getComputedStyle / getBoundingClientRect）；
- `removeAllFrost()` 清空认领表 + `frostObserver.takeRecords()` 丢弃自己产生的记录 ——
  否则属性观察器会把刚摘的又挂回去，和"判据变了要整体重扫"打架。

**实测**：抹掉 → **1 个微任务后恢复** ✓；连续三轮都恢复 ✓；
2 秒内 0 次 class 变更（没和 React 打架）✓；跨过 tick 后仍保持 ✓。


**G. 播放器页的就绪门控与预取（2026-10-21）**

**症状**（用户报的）：网络不好时，打开播放器页会"卡在渲染中间"。

**门控只等两样**（都是排版本身需要的）：
- 封面解码（`new Image()` + onload/onerror，**8 秒兜底**，失败也放行）
- 歌词请求落定（`store.lyrics !== null`，成功/失败都算 —— 纯音乐永远没歌词，不能死等）

**绝不等音频地址**：`/song/url` 是整条链最慢的一环，等它页面就真卡住了。

**骨架态**：封面位置给呼吸占位、歌词位置给微光占位条，
但**模式/传输/喜欢/添加歌单照常渲染**（踩坑 #30：等待期也要能操作）。

**预取下一首**：
- `peekNext()` 按播放模式算下一首；**随机模式不预取**（猜谁都是浪费一次请求）
- 切歌后延迟 800ms 再发，避免和当前这首的 `/song/url` 抢连接
- `urlCache`（LRU 12 条）缓存 songId→url；直链过期时 `forgetUrl(id)` 重取

**为什么用 em 而不是百分比做逐字位移**：
`translateY(112%)` 的位移跟字高走，**短歌名（1-3 字）时视觉幅度小到看不出在动**。
改成 `translateY(1em)` —— 不管标题多长，位移都是一个字高。

**G2. 门控的落定语义与硬超时（2026-10-21，踩坑 #33/#34）**

**症状**：第一次打开播放器页（尤其从侧栏小播放器点进去）卡在骨架永不渲染。

**根因**：门控判的是 `store.lyrics !== null`，而 `restoreSession()` 恢复会话时
**只赋 song、从不请求歌词** —— 那个条件永远不成立。

**现在的规则（两条都必须有）**：
- **落定语义**：`store.lyricSong === songKey && store.lyricState === "done"`。
  `lyricState` 由 `settleLyric(id)` 置 done，**四个出口都要调**：
  拿到 / 缓存命中 / 请求失败 / 歌词模块关闭。
- **硬超时兜底**：`GATE_TIMEOUT_MS = 1200`，到点 `gateTimedOut(songKey)` 强制放行。
  这条是把"永久白屏"降级成"最多慢 1.2 秒"的唯一保险。

**换屏判定用的快照**（`shownRef`）只在"就绪"时更新，所以显示上一屏期间
页面数据一个字段都不变；超时放行时也一样走正式排版。

**H. 切歌不跳屏 + 客户端缓存上限（2026-10-21）**

**切歌不跳屏**：新歌的封面/歌词没就绪时，**继续渲染上一屏的完整快照**，
就绪后一次性换过去并播 `song` 档入场。
快照冻结的是算好的值（含 `current`/`slice`/`dur`），不是引用 —— 原因见踩坑 #31。
只有"第一次进播放器就点歌"（没有上一屏）才退化成骨架。

**客户端缓存上限可配**：`settings.cache.clientLimits = { url, lyric, cover }`
（默认 12 / 40 / 300）。设置页三个输入框，改完**立即生效**（`LruCache.resize`）。
`0` = 不缓存（立即清空并停止写入）。

`LruCache` 新增三个能力：`resize(n)`、`get max`、上限 0 时不写入。

**默认值放在宿主 `DEFAULT_SETTINGS` 里**，客户端从 `/settings` 读，
避免"客户端写 12、宿主写 20"两份默认值不一致。

**I. 背景封面交叉淡化（2026-10-21）**

**用户要求**：切歌时旧封面渐隐、新封面渐显（800~1200ms，取 1000ms）。

**实现**：`.nm-amb-cover` 从单层变成**双层轮换**（`slot.urls` 最多两个元素），
过渡时旧层跑 `nmAmbFadeOut`、新层跑 `nmAmbFadeIn`（含 scale 1.26→1.22 的缓推），
1000+140ms 后收尾，回到单层静态。

**为什么用 CSS 动画而不是 JS 改 opacity**：React 18 的 setState 批处理会让
"opacity:0 那一帧"根本不进 DOM，transition 无事可做（我栽了两次，见踩坑 #35）。

**三条就绪条件**（用户特别提醒的"缓存问题"）：
1. 新封面 URL 有
2. 解码完成 —— `ensureCoverDecoded()`，2.5 秒超时兜底
3. 取色落定 —— `useCoverStatsSettled()`，3 秒超时兜底（见踩坑 #36）

全齐才动；不齐时画面**完全静止**，不会闪。这是不闪的唯一办法。

**其余 5 层（base / dim / tint / grain / veil）一行没动** ——
所以静止状态下的视觉与改动前逐像素一致。

**测量注意**：页面在后台时动画时钟冻结（`currentTime` 恒 0、rAF 不触发），
只能验结构不能验插值 —— 验证动画前先看 `document.visibilityState`。

**J. 启动渲染动画（boot.js，2026-10-21）**

**用户需求**：每次 DSH 启动播一次分层渲染动画 ——
① 高清封面 → ② 原地加滤镜变成背景 + 歌词 → ③ 主界面分层出现。
明确要求：**不要放大缩小**（用户看过样例后否掉了形变方案）。

**时间轴**（用户从四个样例里选了"先压暗"那版）：

```
260ms   高清封面停留（锐利、全屏、无任何形变）
+0ms    压暗 + 亮度封顶淡入（380ms，"光先沉下去"）
+240ms  模糊推进 blur(0→44px) + 染色（1250ms）
620ms   歌词淡入
1400ms  主界面分条揭开（10 条，每条错开 90ms，每条 420ms）
2800ms  收尾（total）
3600ms  硬上限（hardCap，无论如何强制清理）
```

**架构：独立分片，与皮肤/React 零耦合**（用户要求"把握不好就解耦，宁可重复造轮子"）

- 自己建 DOM、自己管定时器、连工具函数都重写一份
- 不引用 `store` / `SkinLayers` / `DshSkin` / `SkinPalette` / `ctx.slots`
- 唯一依赖 `reportClientError`（main.js 定义），且加了 `typeof` 守卫 —— 它不存在就退回 `console.warn`，因为**错误处理本身不能抛错**
- PARTS 里放**最后**（它要用 main.js 的东西）

**为什么不碰 DSH 元素（这是"不崩"的核心）**

「主界面分层出现」不是去改 DSH 元素的 opacity —— DSH 重渲染会冲掉我们加的类，
任何一处漏恢复就是元素永久不可见。这里改成：整屏切 10 条遮罩条带，逐条淡出。
遮罩下面是完整渲染好的界面，**DSH 元素一个字节都没被改过**。
最坏情况只是遮罩没擦完（有硬超时兜底），而不是白屏。

**三层保险**

1. `later()` 里所有定时器回调统一 `try/catch → fail()`
2. `fail() → stop()` 一定移除本层；`stop()` 自己整体包 `try/catch` 且幂等
3. `hardCap` 到点强制收尾；`dispose()` 后 `start()` 直接返回 false

**根层 `pointer-events:none`**：即使动画卡住，界面照样能点。

**开关**：`settings.ambient.boot`（默认 true）。用 `sessionStorage` 保证
"每次启动播一次、同一次启动内刷新不重播"（热重载也不会重播）。

**实测**（CDP，前台）：条带覆盖 830px ≥ 视口 820px 无缝隙 ✓
0.3s 时前三条 opacity 分别为 0.09 / 0.27 / 0.71（证明真的在错开淡出）✓
1.9s 后全部归零、层已移除、无残留 ✓

**量不出来的**：动画的视觉流畅度（后台时浏览器冻结动画时钟，只能验结构）。

**量不出来的事**：这个 harness 没有真正的 React 调度器、也不走真实播放链路，
"每次 timeupdate 有几个组件重渲染"**量不出来**。我先后印过两个数字，**两个都是错的**
（一个量的是 harness 自己手动 walk 的次数，一个打了空事件）。所以改成钉不变量。

---

## 7. 清理掉的与必须保留的

**必须保留（安全网）**：
`reportClientError`、`clientErrors` 环、`PluginErrorBoundary`、`BgErrorBoundary`、
`apply` 的 try-catch 上报、`window.onerror` / `unhandledrejection` 监听。

**已清理（别再加回来）**：

**2026-10-17 又清掉一批**（一次性 DOM 诊断，它们定位过的故障都已修）：
`reportInputDockFrost` / `reportTextDiag` / `reportBrightSurfaces` / `reportDiagAll`，
以及 `[15000, 30000, 60000].forEach(setTimeout(reportDiagAll))` 那三个自动定时器。
**为什么要删那三个定时器**：句柄没存，teardown 取消不掉 —— DSH 每次热重载都留一批在后台
15~60 秒后醒来，各做一次**全量 DOM 扫描**（`getComputedStyle` 扫全部元素）。
**诊断能力没丢**：改成按需可用，`window.__nmDiag = DshSkin`，
需要时在 CDP 里调 `__nmDiag.explainFrost(el)` / `__nmDiag.findBrightSurfaces(10)`。

`reportDomDiag` / `dumpDom` / `samplePresence` / `reportInputDock` / `reportSoon` /
侧栏布局遥测 useEffect（每次布局一次 `getBoundingClientRect` + 一次网络 POST）。
死图标 `IconStar`/`IconGear`/`IconExpand`/`IconClock`/`IconList`（各 0 次使用）
+ `panelTabs` 的 `icon` 字段（写 8 处、读 0 处）。

---

## 8. 待办 / 已知欠缺

- ~~**输入框磨砂**~~ **已验证修好（2026-10-16，CDP 现场）**：输入卡
  `RlGAzG_card` 现在带着 `nm-frost`，底色 `rgba(255,255,255,0)` 正是改写后的
  `--dsw-alias-bg-base`，三道闸（尺寸/高度/面积）全过，还按面积拿到了 12px blur。
  根因是当年按令牌名一刀切的 `NO_FROST_NAME_RE`，`7cec71c` 删掉它时就治好了 ——
  只是这条一直挂着没销账。**教训：验证一个"疑似已修"的问题，成本是一次 CDP 查询；
  让它躺在待办里才是浪费。** `explainFrost` 的诊断能力保留。
  **2026-10-19 又发现第二种成因**（用户报"有的时候会失效"）：磨砂类被 React 重写
  className 抹掉后永不恢复。已修，见 §6 F 与踩坑 #24/#25。
- **`SettingsView` 218 行**：拆分候选，但**慎动** —— 用户被我的重构炸过两次。
- **`main.js` 仍 3149 行**（CSS 模板串 377 行、纯 JS 约 2770 行）：真要拆就按视图切（SettingsView / SidebarPlayer / PlayerView 各自自洽），风险最低；CSS 外移是最无痛的一步（零风险），但会动构建管线。
- **`DATA_DIR` 在模块加载时求值**：多 profile 的配置不独立，要改得配 Cookie 迁移。

## 9. 我自己的行为准则（血泪版）

1. **先核实，再动手**。外部系统行为上网查 / 用真账号实验；不要从自己的代码反推语义。
2. **改完问一句「测试会走到我刚改的那行吗」**。不会就想办法让它走到。
3. **写完测试把 bug 塞回去**，确认它报红。不报红就是假测试。
4. **报错能力永远留，报错内容按需撤**。删东西前问「这个问题真验证修好了吗」。
5. **多行脚本一律写文件**，不用 `node -e`；git message 一律 `-F`。
6. **删代码按 `{}` 深度配平**，先剥字符串。
7. **能量化的就量化，量不出来就诚实说量不出来** —— 不要印一个看起来很像真的假数字。
8. **不许自行 commit**。改动留工作区，给清单 + message，等用户说「提交」。
9. **★ 写进 commit message 的经验教训，必须同时写进这份 AGENTS.md。**
   commit message 不会进我的上下文，**写在那儿等于没写**。
   实测漏过两次：`cdp.mjs --shot`（加了能力却没记）和"磨砂按面积降 blur"
   （做了优化却没记进 §6）—— 都是因为只写了 commit message。
   判断标准：**这条信息，未来的我在动手前需要看到吗？** 需要 → 写进这里。
   每轮结束前自检一遍：这轮新学到的、新做的、改了主意的，都落进这份文件了吗？
