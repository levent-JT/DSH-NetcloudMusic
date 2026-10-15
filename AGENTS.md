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

- **输入框磨砂**：`DshSkin.explainFrost` 已能给出逐层拒绝理由（`too-small` /
  `full-height-region` / `full-page-area` / `bg-not-a-rewritten-token` …）。
  **不用再埋探针等 F5** —— 直接用 `scripts/cdp.mjs` 查，一次定位。
  最可疑仍是 `bg-not-a-rewritten-token`：它要求背景色"正好是我们改写过的令牌"。
- **智能推荐模式（2021）没做**：种子是当前播放列表、可自由切模式、推全新歌。接口与心动模式不同。
- **`SettingsView` 218 行**：拆分候选，但**慎动** —— 用户被我的重构炸过两次。
- **`main.js` 仍 2800+ 行**：真要拆就按视图切（SettingsView / SidebarPlayer / PlayerView 各自自洽），风险最低。
- **`conversation.session.header.actions` 桥接**：`Ctrl+Shift+M` 那条路径是死的。
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
