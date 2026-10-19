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

### #15 静默失败的字符串替换 —— 今天犯了两次

**症状**：脚本打印"✓ 已插入"，但代码里根本没有。表现是作用域探针报
`xxx×5` —— 用了但不在作用域里，因为**定义压根没插进去**。

**两种翻车姿势**：
1. `.replace(from, to)` 的 `from` 没匹配上（锚点因为前一轮改动变了）→ 静默无操作；
2. `if (idx < 0) { ...插入... }` —— 锚点**找得到**时什么都不做，也不报错。

**规矩**：任何改源码的脚本，**替换前后都要校验**：
- 替换前：断言锚点命中次数（`s.split(from).length - 1 === expect`），不对就 throw；
- 替换后：**回读文件**，确认关键标识符真的在位，把结果打印出来。

**第三种翻车姿势（补记，2026-10-16）—— 最阴的一种**：
脚本写成"改内存变量 → 最后统一 `fs.writeFileSync`"，中途某一步 throw →
**前面已经打印过 ✓ 的步骤全部丢失**，可打印的 ✓ 让我以为已经写进去了。

这次的真实案例：改 8 处，第 3 处的锚点没匹配上就抛了 → 前两处只存在于内存 →
但我看到"✓ 已落盘"的输出，于是完全没意识到。后来靠"回读文件核对关键标识符"
才发现少了两处。

**规矩**：**改源码的脚本要"一步一落盘"** —— 每一步命中就立刻 writeFileSync，
后面失败不影响前面已经写进去的。**打印 ✓ 不等于落盘**，
只有**回读文件**才能证明写进去了。

**删整段也要按边界**：我删一条待办时"从某句删到下一个换行"—— 结果跨过了两三行，
留下半句碎片（`过两次。`）。**要删/改一整段，就按【标题到标题】或【明确的起止标记】切**，
不要用"大概到哪一句结束"。这和函数腰斩（#10）是同一个病。
**探针是最后一道防线**：作用域探针（`client-apply.mjs`）今天拦住两次会直接炸浏览器的错误。
写代码的脚本不校验，就得靠它兜底 —— 但它只在你跑测试时兜，别指望它。

### #16 共用一把闸 + 提前记账 = 静默永不执行

**场景**：所有加载函数开头都有 `if (store.loadingView) return;`（同一把闸）。
我给"我的歌单"加了自动加载，`autoLoadOnce` 会**同步**把该视图标记成"已尝试"。

**结果**：用户手快，切到歌单页签时"每日推荐"的加载还在飞 →
`loadingView` 被占 → `loadUserPlaylists` 第一行就返回、一个请求都没发 →
**但 autoLoadOnce 已经记了账** → 永远不会再试 → 界面永远停在"正在加载歌单…"。

**规矩**：**"尝试过"要在真正发出请求之后才记账**。

**✅ 已修（第二天这轮）。真正的根因有两个，第一个才是要害：**

1. **"等 effect 重跑"是死路。** 我第一版写的是"忙就直接返回、不记账，
   把 `store.loadingView` 放进 effect 依赖，等它空了 effect 自然会再进来" ——
   **但如果那个占着闸的加载一直不结束，effect 就永远不会再触发**，等于死等。
   表现就是界面永远停在"正在加载歌单…"。
   **正解：被挡住时自己定个闹钟回来**，而不是指望别人来叫醒我：

   ```js
   if (store.loadingView) {
     const n = (autoLoadRetry.get(key) || 0) + 1;
     if (n > AUTO_RETRY_MAX) return;              // 约 10 秒还不排上就放弃，退回手动"点击加载"
     autoLoadRetry.set(key, n);
     setTimeout(() => autoLoadOnce(view, fn), 400);
     return;
   }
   ```

2. **测试要等真实时间。** 重试用的是 400ms 定时器，而 `flush()` 只推微任务
   （`await Promise.resolve()`）——**光 flush 永远等不到它**。
   测试里必须 `await new Promise((r) => setTimeout(r, 700))`。
   我第一版测试就是漏了这步，于是"代码明明对、测试却红"，
   误判成功能有问题给回退了。**"测试红"要先分清是代码错还是测试错。**

**教训（比这条坑本身重要）**：**回退不是终点，是待办。**
回退时说"下一轮修"就必须真的有一轮去修；否则用户看到的就是"这个功能没做"。

### #17 测试掉了断言数，比测试失败更危险

**症状**：`heartbeat.mjs` 从 24 条变 23 条，**全绿**，没有任何提示。
**原因**：那里写的是 `const btn = find(...); if (btn) { ok(click(btn), ...) }` ——
**一个没有 else 的 if**。我改了按钮文案，它从此整段静默跳过。

**规矩**：
- 测试里**不许有"找不到就跳过"的分支** —— 那是假测试的标准形态（同 #3）。
- **断言总数是一个信号**：数字变了就要问为什么。这次是 24→23，我差点当成"改文案的正常代价"。
- 断言失败时**把现场打出来**（比如"实际发出的请求列表"），不要只说"没找到"。
  这次就是靠打印实际调用列表，才看出请求根本没发出去。

### #18 DSH 的视图容器是 flex-shrink:0 —— height:100% 会参照错的父高

**症状**（用户报的）："点开网易云音乐，很容易直接滚动条拉到底"。
而且**是我这轮加完自动加载之后才明显** —— 以前进来列表是空的，现在一进来就有内容。

**CDP 实测的断链点**（不是猜的）：

```
Dc7zOa_scrollBody   flex/column  高704  scroll1696  overflow:auto   ← 真正的滚动容器（聊天用的）
Dc7zOa_viewArea     flex: 1 0 auto            高1568                ← ★ flex-shrink:0，拒绝收缩
nm-page-root        height:100% → 1545px（跟着内容走）
nm-panel-body       client == scroll   →  overflow-y:auto 永不触发
```

`flex: 1 0 auto` 意味着 `flex-shrink: 0`：视图容器**长到内容高度**而不是缩进滚动容器。
我们 `.nm-page-root { height: 100% }` 参照的是那个被撑高的 1545px，
于是 `.nm-panel-body` 自己的滚动条永远不动，整页滚动被丢给外层的 `scrollBody` ——
**而那个容器是聊天用的、默认就停在底部**，所以点开就落在页面最底。

**修法**（两行 CSS，已在 `main.js` 的 `.nm-page-root` 上方）：

```css
[class*="_viewArea"]:has(.nm-page-root){flex-shrink:1 !important;min-height:0 !important}
.nm-page-root{...;overflow:hidden}
```

`:has(.nm-page-root)` 是刻意的 —— **只命中"里面装着我们"的那个 viewArea，别的视图一个都不受影响**。
DSH 升级后 hash 变了会失配：**失配只是退回旧行为（页面能滚），不会坏**。

**实测对比**（刷新后、纯源码生效）：

```
修前  外层 scrollBody top=992  max=992   面板体 max=0      viewArea高 1568
修后  外层 scrollBody top=0    max=0     面板体 max=1037   viewArea高 576
```

**教训**：插件视图的"高度 100%"不能想当然。**先量祖先链，确认"确定高度"在哪一层断掉**，
再决定修哪一层 —— 我一开始只盯着自己的 CSS 看，什么问题都看不出来。

### #19 产物非原子写 → DSH 热重载读到半截 → "插件加载失败"

**症状**（用户报的）："插件加载失败"，**重启 DSH 就好了**。

**根因**：DSH 会**监听 `lib/client.js` 并自动热重载**客户端插件（我们在 CDP 里能直接
观察到脚本 URL 的 `rev=` 变了：`2b8612bd` → `36020476` → `b958d6a2`，
而**没有手动刷新**）。而构建脚本原来是：

```js
fs.writeFileSync(OUT, out, 'utf8')     // ← 先截断、再写入，中间文件只剩半截
```

**我在构建、文件正处于"半截"状态的那一瞬间，DSH 的一个热重载读到了它** →
拿半截 JS 去解析 → 插件加载失败。重启时文件早就写完了，所以重启就好。

**⇒ 修法：原子写。**

```js
fs.writeFileSync(TMP, out, 'utf8')      // TMP 以 .tmp 结尾（不是 .js，免得被 *.js 通配的监听盯上）
fs.renameSync(TMP, OUT)                 // 同目录改名是原子的：读者只见旧或见新，没有中间态
```

Windows 上目标被占用会抛 `EPERM`/`EBUSY`，所以重试若干次（同步脚本里用
`Atomics.wait` 做同步等待），仍失败才退化为直接写并**打印警告**。

写盘前还加了产物自检：必须以 HEADER 开头、以 FOOTER 结尾、含 `exports.apply`，
缺任何一段就 throw —— **宁可构建失败，也不要写半成品出去**。

**教训（比这条坑更通用）**：**任何"被别的进程监听/读取"的产物，都必须原子写。**
判断标准：这个文件会不会在我写它的时候被别人读？会 → 先写临时文件再改名。

### #20 组件放错地方 —— 加了 UI 却永远不出现

**症状**：音质徽标写好了、构建过了、四个测试全绿，**但界面上什么都看不见**。

**原因**：徽标加进了 `PlayerBar`，而 `PlayerBar` 只在**非整页模式**下渲染：

```js
page ? null : el(PlayerBar, {})      // ← main.js:2300，整页模式下直接 null
```

用户看的整页播放器走的是 `PlayerView`（`renderView()` 里 `case "player"`），
**根本不经过 PlayerBar**。

**为什么测试没抓到**：测试渲染了全部 8 个子页签 ✓ —— 但徽标在
`store.actualQuality` 为空时**直接 return null**，所以那两个测试都走了"不渲染"的分支。
**"渲染了那个视图"不等于"渲染了我加的那个东西"。**

**规矩**：
- 给某个视图加 UI 前，先确认**那个组件在你加的模式下真的会被渲染** ——
  整页 / 非整页两条路径的组件树不一样（本次就是唯一一处 `page ? null : …`）。
- 组件有"数据没到就 return null"的早退分支时，**测试必须把数据灌进去**，
  否则测的是早退分支（同 #2「测试会走到我刚改的那行吗」）。

**验证方式（本次用的）**：CDP 里真实点一首歌 → `playIndex` → `fetchUrl` →
写 `store.actualQuality` → 读 DOM 确认 `.nm-quality-badge` 出现且文本正确。
实测结果：`NaCho · 破浪` + `超清母带 4750k` ✓


### #21 样式注入不幂等 —— 热重载每来一次就多一份

**症状**：审查时用 CDP 数样式，发现我们自己的两份样式被注入了 **4 份**：

```
dsh-netease-ambient ×4    dsh-netease-surfaces ×4    nm-style ×1（这个没问题）
```

**根因**：`DshSkin` 里 `surfaceStyleEl` / `ambientStyleEl` 是**模块级变量**。
DSH 热重载后新实例里它们是 `null`，而 DOM 里上一份 `<style>` 还在 ——
**DSH 不会可靠地调用旧实例的 disposer**。于是 `if (!el) createElement` 又建一个。
那天我构建了二十几次，攒到 4 份（有些被正常的 clearSkin 清掉了）。

**为什么值得修**：每多一份，压暗/磨砂那几十条规则就被重复匹配一次。
放进交互路径里就是样式重算变慢 —— 而这是"越用越卡"型的问题，不会自己好。

**修法**：注入前按 `data-plugin` 把 DOM 里的旧份全摘掉，让注入幂等。

```js
function removeStylesByPlugin(name) {
  for (const el of document.querySelectorAll('style[data-plugin="' + name + '"]')) {
    try { el.remove() } catch (err) { /* 非致命 */ }
  }
}
```

**实测效果**：4 份 → 1 份，而且**再连编两次仍然 1 份**（幂等性证明）。

**对照**：`injectCss()` 一直是幂等的（先找 `#nm-style` 再复用），所以只有这两个漏了。
**⇒ 规矩：任何往 head 里塞节点的代码，都应该按"能重复调"来写，而不是靠调用方保证只调一次。**
在会热重载的环境里，"只调一次"这个假设一定不成立。

**⚠️ 我差点在这里炸掉一次（同一天，第二轮）**：

修完泄漏后我"顺手"把 `removeSurfaceStyle()` 也改成按属性删全部（想让 clearSkin 更彻底），
结果**皮肤整片消失**：`surfaces` 0 份、`nm-frost` 0 个，而设置里 `ambient.enabled` 明明还是 `true`。

**根因是热重载的时序**：

```
① 新实例挂载 → applySkin → ensureSurfaceStyle 建好 S1
② 旧实例 unmount → 清理 → clearSkin → removeSurfaceStyle
   ↑ 这里若"删全部"，就把刚建好的 S1 一起删了
③ 新实例的 applySkin 有 signature 去重，认为自己已经应用过 → 不会再补
⇒ 皮肤永久缺失，直到下一次状态变化
```

**正确分工（现在就是这样）**：
- `ensureSurfaceStyle` / `ensureAmbientStyle`：注入前清旧份 —— **安全**，因为它是"先删后建"
- `removeSurfaceStyle`：**只删自己手里这一份** —— 别人建的不归它管

**⇒ 规矩：在"可能同时存在两个实例"的环境里，**清理逻辑只能管自己**，
去重/清理别人的职责要放在"建立之前"（先删后建），不能放在"销毁之时"。**

**⇒ 还有一个更通用的教训**：五个测试（126 条断言）**全绿**，但皮肤是没的 ——
因为测试里 `AmbientBg` 的挂载/卸载时序和真实热重载不一样。
**这次是靠 CDP 查线上 DOM 抓到的**（`磨砂: 0` 而 `enabled: true`）。
改这种"跨实例生命周期"的东西，**必须去线上看一眼**，测试覆盖不到。

### #22 半个功能：宿主那条路由从来没写过

**症状**：审查时做契约核对（客户端调用的 method ↔ 宿主实现的 method），
发现客户端每 1.2 秒 GET `/commands?since=N`，而宿主**一处都没有 "commands" 这个字**，
`ROUTE_PATHS` 里也没有。实测 `GET /plugin/netease-music/commands` → **HTTP 404**。

**后果三连**：
1. **AI 控制播放器整套能力不存在** —— 客户端的 `runCommand` 写得很全（9 种指令），
   但那是死代码，永远不会被执行。
2. **每秒 0.83 次 404，一天约 7.2 万次**；`hostGet` 非 2xx 会 `throw new Error(...)`，
   每次都要构造一个带堆栈的异常然后再被 catch 掉。
3. **完全静默** —— `pollCommands` 的 catch 是空的（`/* host restarting etc. */`）。

**这和「私人FM」是同一个病**：客户端那半齐了，宿主少一半。
FM 是被一句 `throw` 挡住；这个是**压根没写**。

**⇒ 规矩：做契约核对，别只看"客户端有没有调"。**
把「客户端调用的 method 集合」和「宿主实现的 method 集合」做差集，一次就能看出缺口。
（注意宿主有 `case '/x':` 和 `if (method === '/x')` 两种写法，
**只匹配 case 会漏掉一半** —— 我第一次跑就误报了 3 个，实测算术都对。）

### #23 过期响应覆盖 —— 异步返回后没确认"我还是不是当前的"

**症状**（用户可感知）：快速点两首歌，**界面显示 B、耳朵听到 A**；
切歌快时**歌词是上一首的**。

**根因**：两个函数都是"await 完直接写全局状态"，没有确认当前请求是否已经过期。

```js
// playIndex
const got = await fetchUrl(song.id, store.quality);   // 网络 100~500ms
store.actualQuality = { songId: song.id, ... };       // ← 无条件覆盖
a.src = url;                                          // ← 无条件覆盖

// loadLyric
const body = await api("/lyric", { id });
store.lyrics = entry;                                 // ← 不检查当前歌还是不是 id
```

**两次请求的响应顺序是不保证的**：慢的那次回来会把新的盖掉。
而 `store.song` 是在 await **之前**同步写好的 —— 于是 store 和 audio 脱钩。

**修法**（各 3 行）：

```js
// playIndex：进函数取一个一次性令牌
const myToken = ++playToken;
const got = await fetchUrl(...);
if (myToken !== playToken) return;      // 这期间用户已经点走了，丢弃这次结果

// loadLyric：直接比对当前歌
if (!store.song || String(store.song.id) !== key) return;
```

**⇒ 规矩：凡是 `await` 之后要写全局状态的地方，先问一句
「我回来的时候，世界还是我出发时的样子吗」。** 播放器、搜索、自动加载都在这一类里。


### #24 「改了但没生效」—— 在旧代码上验证新代码

**症状**：修好一个 bug、构建通过、五个测试全绿，然后在线上验证 —— 结果是"没修好"。
差点据此回滚。

**真相**：**线上跑的还是旧代码。**
DSH 确实会热重载 `lib/client.js`（观察过 `rev=` 变化），但**不保证每次都触发** ——
那天页面已经连续存活 32 小时，我的一次构建没有引起热重载。
于是我在旧代码上做实验、拿旧代码的结果否定了新代码。

**怎么发现的**：把同一段抹掉实验重跑一遍 —— 抹掉 → 1 个微任务 → 恢复 ✓。
两次唯一的差别是：中间 DSH 断了一次、**整页重新加载过**。

**⇒ 修法：给产物加构建指纹。**

`scripts/build-client.mjs` 把"拼接结果的哈希"写进产物（`window.__nmBuild = "<10位hex>"`），
任何探针读一下就能回答"线上跑的是不是磁盘上这份"。
注意它**不是产物文件自身的哈希**（替换占位符后内容会变），而是拼接结果的稳定标识，
所以"连编两次 SHA256 一致"这条确定性检查照样成立。

**⇒ 规矩：改客户端代码后，先核实线上是不是新代码，再谈"修复有没有生效"。**
1. 读 `window.__nmBuild`，和构建脚本打印的 `build=…` 比对；
2. 不一致 → 让 DSH 重启，**别急着怀疑代码**，更别自己刷页面（见 #25）。

### #25 别在用户正在用的页面上主动 reload

**症状**：我用 `location.reload()` 想让插件加载新代码，结果 **DSH 整个断了** ——
Web GUI 端口都变了（64946 → 57811），用户看到"断气"。

**为什么**：renderer 被强制重载后没接回原来的宿主进程，整个应用重启了。

**⇒ 规矩：不要替用户刷新页面。**
需要重新加载客户端代码时：
- 优先：改完就停手，让下次自然重启带上；
- 其次：**问用户**能不能重启 DSH；
- 绝不：自己发 `location.reload()`。

（这条和 #19 是一对：#19 说我写产物时不能让别人读到半截，
#25 说我不能替别人决定"什么时候重新读"。）


### #14 换行符：仓库按 LF 存，工作区是混的 —— 这条原来写反了

**原文写着「仓库里的文件全是 CRLF」，是反的。** 实测普查（33 个被追踪文件）：

```
LF     24 个   ← 大多数（README / main.js / lib/index.js / 全部 test/ …）
CRLF    2 个   scripts/cdp.mjs、src/client/skin/dsh.js
混合    3 个   AGENTS.md(281/467)、lib/client.js(865/3645)、vendor/qr.mjs(1/80)
binary  4 个   4 张截图
```

而 `.gitattributes` 写的是 `* text=auto eol=lf` —— **仓库的约定是 LF。**
工作区之所以是混的：git 提交时会把 CRLF 归一成 LF（每次 commit 都在警告
「CRLF will be replaced by LF the next time Git touches it」），
但本地工具/脚本写进工作区的 CRLF 会留着，于是同一份文件里两种混在一起。

**⇒ 规矩**：
- **不要假设任何一种换行符。** 写替换脚本时，锚点先按原样找，找不到就换成另一种 EOL
  再试一次 —— 两种都找不到才报错，而不是赌一种。
- 旧规矩「必须把 `\n` 换成 `\r\n`」正是这个赌，而且它赌反了：
  照它做，在 LF 文件上必然匹配失败。
- **断言命中数（见 #15）仍然是最后防线**：赌错了会抛，不会静默改坏文件。
- 新建文件一律用 LF。

参考写法（两种 EOL 都试）：

```js
function swap(s, from, to) {
  for (const eol of ["\n", "\r\n"]) {
    const a = from.replace(/\n/g, eol)
    if (s.includes(a)) return s.split(a).join(to.replace(/\n/g, eol))
  }
  throw new Error("两种 EOL 都没匹配上：" + from.slice(0, 60))
}
```

---

### 上架到 DSH 插件市场（2026-10-15 起，未完成）

**现状：仓库这一侧全部就绪，剩下三步只有账号主人能做。**
用户的态度是"你自己看着操作，我忙着呢，反正免费的插件，爱用不用"——
**所以别催，也别因为没做完就焦虑：不做这三步完全不影响他自己用。**
规范原话：「发不发布都不影响收录，插件照样能从 GitHub 安装」。

**已做（都提交推送了）**
- `package.json`：去掉 `private`；补 `repository`/`homepage`/`bugs`/`keywords`/`author`；
  加 `engines.dsh`。`dsh.bundle.patch` + `dsh.client` 本来就有。
- `screenshots.json`（package.json 旁边）：声明 4 张截图，相对路径，1-8 张。
- `README.md` 加「截图」一节；图片在 `docs/screenshots/`（不进 npm 包）。
- `npm pack` 干跑：9 个文件 145 KB，干净。
- 条目 YAML 写在仓库外的 `临时任务/nm-market-entry.yml`（不是本仓库的文件）。

**剩下三步（都需要账号，我做不到）**
```powershell
cd C:\Users\levent.li\Desktop\临时任务\dsh-netease-music
npm login   --registry=https://registry.npmjs.org/
npm publish --registry=https://registry.npmjs.org/
```
- **两个 --registry 都必须带**：这台机器的 npm 指向 `registry.npmmirror.com`（淘宝镜像），
  **镜像不接受发布**，不带就失败。
- 给 https://github.com/levent-JT/DSH-NetcloudMusic/settings 加 topic **`dsh-plugin`**（CI 硬查）。
- fork `awesome-dsh-plugin/awesome-dsh-plugin`，新建**一个文件**
  `data/plugins/levent-JT__DSH-NetcloudMusic.yml`，内容复制上面那份，开 PR。

**市场机制（查过一次就别再查）**
- 市场本体 `dshmarket` 只是客户端；列表来自精选仓库 `awesome-dsh-plugin/awesome-dsh-plugin`，
  CI 每天刷成 `https://awesome-dsh-plugin.com/plugins.json`（4671 条）。
- **一个插件一个 YAML 文件**（`data/plugins/<owner>__<repo>.yml`），两个 README 由脚本生成，
  **严禁手工编辑**。这正是它不冲突的原因：条目文件永不相撞，README 行才相撞。
- 条目字段：`url`（必须与仓库一字不差）/ `name`（owner/repo）/ `category` / `description.en`
  （必填、句号结尾、**不含营销词、会被拿去和代码逐条核对**）/ 可选 `zh` / 可选 `tarball`。
- **禁止手写 `npm:` 字段——会被校验直接拒绝。** npm 映射从 registry 自动采集，
  前提是包的 `repository` 字段指回收录的那个仓库。
- 分类：播放器类都在 **`ui`**（816 条）。**`theme` 是纯主题，会自动进市场的主题 Tab**，不是我们。
- 硬要求四条：`dsh.bundle` manifest（**规范点名"最常见拒因是只声明 `dsh.client`"**）、
  仓库根有 `cordis.patch.yml`、仓库满 1 天、有真实代码。**我们四条都过。**
- 截图走自己仓库的 `screenshots.json`（1-8 张、相对路径、不能 `/` 开头或含 `..`）。
  不声明也行，市场会从 README 抽。

**克隆前先看一眼的同类插件**：ncm-player（3★ 浮窗）、dsh-music-player（17★ 本地音乐+朗读）、
SinglePlayer（2★ AI 聚合）、dsh-MusicPlayer（4★ 悬浮窗）。我们的差异是整页页签 + 沉浸式
背景皮肤 + 心动模式（2018 官方语义）+ 音质阶梯 + 侧栏播放器，以及唯一的「DSH 皮肤总开关」。

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
