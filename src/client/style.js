/**
 * 全部插件样式（2026-11-01 从 main.js 拆出）。
 *
 * 为什么独立成片：CSS 有 540+ 行，是 main.js 里最大的一块。
 * 拆出来之后改样式只碰这个文件，不碰业务代码；
 * 而且 CSS 语法错误在这里就能肉眼发现，不用在 4000 行 JS 里找。
 *
 * ⚠️ PARTS 顺序：本分片必须在 main.js **之前** ——
 * `const CSS` 不是函数声明（不会被提升），main.js 的 injectCss() 执行时它必须已初始化。
 */
    const CSS = `
.nm-panel{position:fixed;top:56px;right:16px;width:396px;max-width:calc(100vw - 32px);height:600px;max-height:calc(100vh - 76px);z-index:2147483000;display:flex;flex-direction:column;background:var(--color-bg1,#121826);border:1px solid var(--color-border,#ffffff14);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.45);pointer-events:auto;color:var(--color-fg1,#e6e9ef);font-size:13px;overflow:hidden;font-family:inherit}
.nm-panel-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-bottom:1px solid var(--color-border,#ffffff14);flex:none}
.nm-tabs{display:flex;gap:2px;flex-wrap:wrap}
.nm-tab{border:none;background:transparent;color:var(--color-fg3,#7c8698);font-size:12.5px;padding:5px 10px;border-radius:8px;cursor:pointer}
.nm-tab:hover{color:var(--color-fg1,#e6e9ef);background:var(--color-bg2,#181d28)}
.nm-tab-on{color:var(--color-fg1,#e6e9ef);background:var(--color-bg2,#181d28);font-weight:600}
.nm-panel-body{flex:1;min-height:0;overflow-y:auto;padding:10px}
.nm-view{display:flex;flex-direction:column;gap:8px}
.nm-view-header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:2px}
.nm-view-title{font-size:14px;font-weight:700}
.nm-hint{color:var(--color-fg3,#7c8698);font-size:12.5px;padding:16px 8px;text-align:center}
.nm-clickable{cursor:pointer}
.nm-clickable:hover{color:var(--color-fg1,#e6e9ef)}
.nm-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;background:transparent;color:var(--color-fg2,#dbe2ee);border:1px solid transparent;border-radius:7px;padding:4px 7px;font-size:12px;cursor:pointer;transition:background .15s,color .15s;line-height:1}
.nm-btn:hover{background:var(--color-bg3,#2e3750);color:var(--color-fg1,#eef1f7)}
.nm-btn:disabled{opacity:.4;cursor:default}
.nm-btn-accent{background:linear-gradient(90deg,#3d6bff,#7a4dff);border:none;color:#fff}
.nm-btn-accent:hover{filter:brightness(1.12);color:#fff}
.nm-btn-lg{padding:7px 9px}
.nm-btn-active{background:var(--color-bg3,#2e3750);color:var(--color-fg1,#eef1f7)}
.nm-cover{border-radius:8px;overflow:hidden;background:var(--color-bg3,#232a3a);display:flex;align-items:center;justify-content:center;flex:none}
.nm-cover img{width:100%;height:100%;object-fit:cover;display:block}
.nm-cover-fallback{color:var(--color-fg3,#5d6676);display:flex}
.nm-songlist{display:flex;flex-direction:column;gap:2px}
.nm-songrow{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:10px;cursor:pointer}
.nm-songrow:hover{background:var(--color-bg2,#181d28)}
.nm-songrow-current{background:var(--color-bg2,#181d28)}
.nm-songrow-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.nm-songrow-name{font-size:12.5px;color:var(--color-fg1,#e6e9ef);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nm-songrow-artist{font-size:11px;color:var(--color-fg3,#7c8698);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nm-songrow-dur{font-size:11px;color:var(--color-fg3,#5d6676)}
.nm-songrow-play{opacity:0;padding:4px}
.nm-songrow:hover .nm-songrow-play{opacity:1}
.nm-searchbox{display:flex;gap:6px;align-items:center;padding:2px}
.nm-input{flex:1;background:var(--color-bg2,#181d28);border:1px solid var(--color-border,#ffffff14);border-radius:8px;padding:7px 10px;font-size:13px;color:var(--color-fg1,#e6e9ef);outline:none}
.nm-input:focus{border-color:rgba(93,140,255,.55)}
.nm-playerbar{flex:none;border-top:1px solid var(--color-border,#ffffff14);padding:8px 10px;background:var(--color-bg2,#141a26);display:flex;flex-direction:column;gap:6px}
.nm-playerbar-empty{justify-content:center}
.nm-playerbar-main{display:flex;align-items:center;gap:8px}
.nm-playerbar-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
/* 实际音质徽标。跟着 fg 色阶走，不另立风格；比设置档位低时换成告警色。 */
.nm-quality-badge{display:inline-flex;align-items:baseline;margin-left:6px;padding:1px 6px;border-radius:999px;font-size:10px;line-height:1.5;color:var(--color-fg2,#b9c0cd);background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1px rgba(255,255,255,.10);white-space:nowrap;vertical-align:middle;flex:none}
.nm-quality-badge-lower{color:#e8b46a;background:rgba(232,180,106,.12);box-shadow:inset 0 0 0 1px rgba(232,180,106,.28)}
.nm-quality-br{opacity:.62}
.nm-pb-title{font-size:13px;font-weight:600;color:var(--color-fg1,#eef1f7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* 改成 flex 行：文本自己省略，徽标 flex:none 永不被裁。原来整行 nowrap+ellipsis，
       徽标作为行内元素会被一起截掉，所以必须拆开。 */
.nm-pb-artist{display:flex;align-items:center;font-size:11px;color:var(--color-fg3,#7c8698)}
.nm-pb-artist-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nm-playerbar-progress{display:flex;align-items:center;gap:8px}
.nm-playerbar-volume{display:flex;align-items:center;gap:6px;color:var(--color-fg3,#7c8698)}
.nm-time{font-size:10.5px;color:var(--color-fg3,#7c8698);min-width:32px;text-align:center}
.nm-range{flex:1;accent-color:#3d6bff;height:4px;cursor:pointer}
.nm-lyrics{max-height:132px;overflow-y:auto;border-top:1px dashed var(--color-border,#ffffff14);padding-top:6px;display:flex;flex-direction:column;gap:3px;scroll-behavior:smooth}
.nm-lyric{font-size:12px;color:var(--color-fg3,#7c8698);text-align:center;line-height:1.45}
.nm-lyric-on{color:var(--color-fg1,#eef1f7);font-weight:600}
.nm-notice{position:absolute;left:12px;right:12px;bottom:96px;background:var(--color-bg3,#2e3750);border:1px solid var(--color-border,#ffffff14);color:var(--color-fg1,#eef1f7);border-radius:10px;padding:8px 12px;font-size:12px;box-shadow:0 8px 30px rgba(0,0,0,.35);pointer-events:none}
.nm-section{font-size:11.5px;font-weight:700;color:var(--color-fg3,#7c8698);padding:6px 2px 0;border-top:1px dashed var(--color-border,#ffffff14);margin-top:2px}
.nm-playlist-grid{display:flex;flex-direction:column;gap:2px}
.nm-playlist-card{display:flex;align-items:center;gap:10px;padding:6px;border-radius:10px;cursor:pointer}
.nm-playlist-card:hover{background:var(--color-bg2,#181d28)}
.nm-playlist-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.nm-playlist-name{font-size:12.5px;color:var(--color-fg1,#e6e9ef);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nm-playlist-sub{font-size:11px;color:var(--color-fg3,#7c8698)}
.nm-back{font-size:12px;color:var(--color-fg3,#7c8698);cursor:pointer;padding:2px 0}
.nm-back:hover{color:var(--color-fg1,#e6e9ef)}
/* ── 侧栏底部小播放器（sidebar.footer.action）────────────────────
   与 usage-billing 的「今日消耗金额」同一个挂点。侧栏约 250px 宽、竖向空间充足，
   故用卡片式竖向布局。

   ⚠ 两层结构是必需的，不是多余嵌套：
   sidebar.footer.action 是 flex 容器，子元素是 flex item。只写单层卡片时，
   它会收缩成「内容宽」并被挤到容器右侧（实测表现为卡片右移、文字被压窄换行）。
   billing 组件同样用两层解决——它的 triggerWrap 就是这一层
   （flex:auto; width:100%; min-width:96px; max-width:100%）。
   这里照抄该结构：外层负责在 flex 里占满宽度，内层负责画卡片。

   注意：本段 CSS 整体包在模板字符串里，注释中**绝对不能出现反引号**，
   否则会直接截断模板、导致整份 client.js 语法错误（这个坑已经踩过一次）。

   原顶部条时代的 nm-mini 系列横向样式与那段魔改 DSH 内部类名
   （.wSkVaW_headerActions）的 hack 一并移除——它们只服务于已废弃的挂载点。 */
/* flex:0 0 auto —— 不伸不缩。
   早先照抄 billing 的 flex:auto（= flex:1 1 auto），但那是它作为**唯一子元素**时的写法；
   我们加进来之后两个 flex:auto 的兄弟在抢空间：它被压成一条、我们的卡片文字被压没。
   不伸不缩后，我们的卡片保持自身尺寸，也不会去挤压用量卡片。 */
.nm-side-wrap{flex:0 0 auto;width:100%;min-width:0;max-width:100%;display:block;position:relative}
/* 与用量卡片同名同值：padding 10px 14px、gap 12px、圆角 12px。
   内容高度由 44px 的封面撑起（对齐用量卡片那条 45px 的文字列），
   于是两张卡片都是 10+44+10 = 64px —— 实测用量卡片正是 253x64。

   背景与边框也照抄它的做法：用 DSH 自己的 layer-2 / border-l1 令牌。
   它之所以"比侧栏底色略深、和背景区分清晰"，就是因为 layer-2 比底色深一档。
   注意 var() 必须带兜底：令牌缺失时整条声明会失效（计算值无效），
   不会回退到上一条同属性声明——所以不能靠"写两遍"来兜底。 */
.nm-side{position:relative;width:100%;min-width:0;box-sizing:border-box;
  display:flex;align-items:center;gap:12px;padding:10px 14px;
  border-radius:12px;
  cursor:pointer;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,rgba(0,0,0,.30)) 78%,transparent);
  border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));
  backdrop-filter:blur(14px) saturate(1.2);-webkit-backdrop-filter:blur(14px) saturate(1.2);
  box-shadow:0 1px 2px #0000000a;
  transition:border-color .16s cubic-bezier(.2,.8,.2,1),transform .16s cubic-bezier(.2,.8,.2,1),box-shadow .16s cubic-bezier(.2,.8,.2,1)}
/* 悬浮反馈，数值同样照抄用量卡片：边框加强 + 蓝色辉光 + 上浮 1px */
.nm-side:hover{
  border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.28));
  box-shadow:0 6px 18px -8px color-mix(in srgb,#4f8cff 45%,transparent);
  transform:translateY(-1px)}
/* min-width 而不是 0：卡片被压窄时宁可省略号，也不要把歌名整行压没。
   控制键有 5 个（红心/上一首/播放/下一首/模式），留给文字约 45px。 */
.nm-side-meta{flex:1;min-width:44px;display:flex;flex-direction:column;gap:1px;line-height:1.25;cursor:pointer}
.nm-side-title{font-size:11.5px;font-weight:600;color:rgba(255,255,255,.95);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nm-side-sub{font-size:10px;color:rgba(255,255,255,.52);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nm-side-cover{flex:none;cursor:pointer;display:flex;border-radius:50%;overflow:hidden;
  box-shadow:0 2px 8px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.14)}
.nm-side-cover .nm-cover{border-radius:50%}
.nm-side-disc{display:flex}
.nm-side-disc.spin{animation:nm-spin 24s linear infinite}
/* 5 个控制键必须压到最小，否则文字被挤没 */
.nm-side-ctl{display:flex;align-items:center;gap:1px;flex:none}
.nm-side-ctl .nm-btn{padding:2px 3px;flex:none;line-height:1}
/* 进度线绝对定位在底部内边距里，不占高度 */
.nm-side-progress{position:absolute;left:14px;right:14px;bottom:3px;width:auto;height:4px;margin:0;padding:0;
  -webkit-appearance:none;appearance:none;background:rgba(255,255,255,.16);border-radius:2px;cursor:pointer;outline:none}
.nm-side-progress::-webkit-slider-thumb{-webkit-appearance:none;width:8px;height:8px;border-radius:50%;background:#fff;box-shadow:0 0 5px rgba(0,0,0,.5)}
.nm-side-progress::-moz-range-thumb{width:8px;height:8px;border:none;border-radius:50%;background:#fff}
.nm-side-progress:disabled{opacity:.35;cursor:default}
.nm-login{display:flex;align-items:center;justify-content:center;padding-top:18px}
.nm-login-card{display:flex;flex-direction:column;gap:10px;align-items:center;background:var(--color-bg2,#181d28);border:1px solid var(--color-border,#ffffff14);border-radius:14px;padding:22px;width:100%;max-width:260px}
.nm-login-title{font-size:15px;font-weight:700}
.nm-login-sub{font-size:11.5px;color:var(--color-fg3,#7c8698);text-align:center;line-height:1.5}
.nm-qr{width:180px;height:180px;border-radius:10px;background:#fff;padding:6px}
.nm-qr-sm{width:132px;height:132px;align-self:center}
.nm-login-msg{font-size:12px;color:var(--color-fg2,#dbe2ee);text-align:center;min-height:16px}
.nm-settings{display:flex;flex-direction:column;gap:10px;
  /* 限宽：不限宽时面板会铺满整个窗口，space-between 会把标签和它的控件
     推到相隔近千像素的两端，眼睛要横跨整屏才能建立"这行是什么"的联系。 */
  max-width:680px}
.nm-settings-group{background:var(--color-bg2,#181d28);border:1px solid var(--color-border,#ffffff14);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.nm-settings-title{font-size:12px;font-weight:700;color:var(--color-fg2,#dbe2ee)}
.nm-toggle-row{display:flex;align-items:center;justify-content:space-between;font-size:12.5px;color:var(--color-fg1,#e6e9ef);cursor:pointer}
.nm-toggle-row input{accent-color:#3d6bff;width:15px;height:15px;cursor:pointer}
.nm-settings-row{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12.5px;color:var(--color-fg1,#e6e9ef)}
.nm-settings-value{color:var(--color-fg3,#7c8698);font-size:12px}
.nm-settings-hint{font-size:11px;line-height:1.55;color:var(--color-fg3,#7c8698);padding:2px 0 4px}
.nm-settings-actions{display:flex;gap:6px;flex-wrap:wrap}
/* 原生 select 的弹层（option 列表）在 Windows 上默认是白底。
   我们给 select 设了浅色文字，选项压在白底上就等于隐形——只剩被选中的那项
   因为有高亮底色才看得见。必须显式给 option 上色，并声明 color-scheme
   让 Chromium 用深色渲染弹层外框，与面板一致。 */
.nm-select{background:var(--color-bg3,#232a3a);color:var(--color-fg1,#e6e9ef);border:1px solid var(--color-border,#ffffff14);border-radius:7px;padding:4px 8px;font-size:12px;outline:none;
  color-scheme:dark;max-width:100%}
.nm-select option{background:#232a3a;color:#e6e9ef}
/* 数字 / 文本输入框（缓存上限、缓存目录）。和 select 用同一套配色。 */
.nm-input{background:var(--color-bg3,#232a3a);color:var(--color-fg1,#e6e9ef);border:1px solid var(--color-border,#ffffff14);border-radius:7px;padding:4px 8px;font-size:12px;outline:none;width:96px;font-family:inherit}
.nm-input-wide{width:min(340px,100%);text-align:left}
.nm-input:focus{border-color:var(--color-accent,#4f8cff)}
.nm-input::placeholder{color:var(--color-fg3,#7c8698)}
.nm-mode-picker{display:flex;gap:4px;flex-wrap:wrap}
.nm-mode-btn{font-size:11px;padding:3px 8px}
.nm-lyric-text{white-space:pre-wrap}
.nm-lyric-tr{font-size:11px;color:var(--color-fg3,#8b93a5);margin-top:2px}
.nm-lyric-on .nm-lyric-tr{color:var(--color-fg2,#b9c1d1)}
/* ── 歌词背景（氛围式）────────────────────────────────────────────
   图层挂在 body 最前、z-index:-1 的容器里（见 SkinLayers.mount），
   再覆写令牌让界面面板半透明，背景才透得出来。
   具体的封面 / 压暗 / 唱片机 / 歌词样式统一在下面「视觉语言」那一节定义，
   这里只保留图层根节点。 */
.nm-amb{position:absolute;inset:0;overflow:hidden}
/* ══════════════════════════════════════════════════════════════════════
   视觉语言：参考 dsh-kimino-theme（★40，MIT）的玻璃拟态配方。三个要点：
     1) 压暗用「带色调的渐变」而不是纯黑——纯黑会把模糊封面压成死灰；
     2) 模糊层一律带 saturate(130~140%)，否则模糊后颜色会发灰；
     3) 面板统一「半透明底 + backdrop-filter + 1px 白边 + 圆角 + 柔影」。
   ══════════════════════════════════════════════════════════════════════ */

/* 本插件组件消费的是 --color-* 这套令牌（不是 DSH 的 --dsw-*）。
   它们原本不存在 → 组件全部落到硬编码的深色兜底值上，所以界面又黑又不透。
   在这里就地定义成玻璃值，整个音乐 UI 一次变透。

   2026-10-29 可读性修正（实测依据）：
   - fg3 .48 → .62：fg3 是页签/歌手名/时间/说明文字的统一样式，
     挂了十几处类。48% 白在深蓝底 + 封面透出时读不清（用户实测反馈
     "设置页还有不少显示问题，主要是字体颜色"）。62% 是辅助文字
     在 .84 深蓝底上的可读下限，同时与 fg1(.95) 保留明显层级。
   - fg2 .72 → .78：分组标题微调，保持 fg1 > fg2 > fg3 的梯子不塌。 */
.nm-panel,.nm-page-root,.nm-pl{
  --color-bg1:rgba(13,17,23,.45);
  --color-bg2:rgba(255,255,255,.06);
  --color-bg3:rgba(255,255,255,.11);
  --color-border:rgba(255,255,255,.12);
  --color-fg1:rgba(255,255,255,.95);
  --color-fg2:rgba(255,255,255,.78);
  --color-fg3:rgba(255,255,255,.62);
}

/* ── 背景层 ─────────────────────────────────────────────────────── */
/* 图层顺序（下 → 上）：底色 → 模糊封面 → 压暗 → 主色光晕 → 噪点 → 唱片机 → 歌词。
   底色是「封面主色压暗」的纯色，这样封面没加载出来/半透明时露的是它而不是白。 */
.nm-amb-base{position:absolute;inset:0}
/* 封面双层容器：铺满并裁切，两块画布各自 absolute 到它上面。
   overflow:hidden 是必须的 —— 每层有 inset:-14% 的出血，不裁会盖到别的层上。 */
/* 背景封面交叉淡化：旧层淡出、新层淡入，同时新层从 1.26 缓推到 1.22。
   用 CSS 动画而不是 JS 改 opacity —— React 会批处理连续 setState，
   DOM 里不出现中间帧，transition 无事可做（实测两次都变成硬切）。
   缩放放在同一个动画里，避免两层 scale 不同步导致的"画面拉一下"。 */
@keyframes nmAmbFadeIn{from{opacity:0;transform:scale(1.26)}to{opacity:1;transform:scale(1.22)}}
@keyframes nmAmbFadeOut{from{opacity:1;transform:scale(1.22)}to{opacity:0;transform:scale(1.19)}}
/* 2026-11-01 撤掉 @media(prefers-reduced-motion:reduce){.nm-amb-cover{animation:none!important}}：
   用户系统开着"减少动态效果"，这条把切歌交叉淡化整个杀了。
   本插件的动画是核心体验的一部分，不再跟系统这个偏好走。 */
.nm-amb-covers{position:absolute;inset:0;overflow:hidden}
.nm-amb-cover{position:absolute;inset:-14%;background-size:cover;background-position:center center;transform:scale(1.22);will-change:transform}
.nm-amb-dim{position:absolute;inset:0}
/* 亮度封顶薄纱：盖在所有背景元素（含歌词）之上。
   它不追求"把背景压暗"，而是把背景的**峰值亮度**压到不会跟正文抢对比度的水平。 */
.nm-amb-veil{position:absolute;inset:0;pointer-events:none}
/* 玻璃化：这个类由 JS 动态加到 DSH 自己的面板上 —— 判据是"它的背景色等于我们注入的
   rgba"，所以不依赖 DSH 的哈希类名，菜单/抽屉/输入框/新弹出的浮层都能覆盖到。
   毛玻璃把背后的内容磨成一片均匀的底，于是"面板透明"和"文字清楚"可以同时成立。 */
/* blur 幅度由 JS 按**元素面积**写进 --nm-blur：
   backdrop-filter 的合成代价与面积近似成正比，而大面板上 18px 和 8px 的观感差别很小。
   实测最大的两块是 1000×221（占全部磨砂面积的 38%），它们从 18px 降到 8px。 */
.nm-frost{
  backdrop-filter:blur(var(--nm-blur,18px)) saturate(150%);
  -webkit-backdrop-filter:blur(var(--nm-blur,18px)) saturate(150%)}
/* 注意：弹窗遮罩那条 :has() 规则**不在这里** —— 它不需要我们的类名就能命中，
   放在静态 CSS 里会绕过"DSH 皮肤"总开关。它已挪进 DshSkin 的 DARK_SURFACE_CSS
   （那份由 applySkin 注入、clearSkin 摘除，跟着开关走）。 */
/* 主色光晕：screen 让它在压暗层之上"发光"而不是盖一层色块，
   这正是"背景色随封面变化"的来源（网易云的核心观感）。 */
.nm-amb-tint{position:absolute;inset:0;mix-blend-mode:screen}
/* 细噪点：深色大面积渐变容易出色带，噪点把它打散。
   用内联 SVG feTurbulence，不引入任何资源文件。 */
.nm-amb-grain{position:absolute;inset:0;opacity:.3;mix-blend-mode:overlay;pointer-events:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size:160px 160px}

/* ── 黑胶唱片机 ─────────────────────────────────────────────────── */
.nm-amb-deck{position:absolute;left:6%;top:50%;transform:translateY(-50%);width:min(30vw,380px);aspect-ratio:1;border-radius:28px;
  background:linear-gradient(150deg,rgba(255,255,255,.30),rgba(255,255,255,.07));
  border:1px solid rgba(255,255,255,.30);
  backdrop-filter:blur(10px) saturate(140%);-webkit-backdrop-filter:blur(10px) saturate(140%);
  box-shadow:0 30px 80px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.45);
  display:flex;align-items:center;justify-content:center}
.nm-amb-platter{position:relative;width:82%;aspect-ratio:1;border-radius:50%;
  background:radial-gradient(circle,#09090c 0 33%,#131318 33% 63%,#202028 63% 100%);
  display:flex;align-items:center;justify-content:center;
  box-shadow:inset 0 8px 30px rgba(0,0,0,.9),inset 0 -6px 20px rgba(255,255,255,.05),0 10px 30px rgba(0,0,0,.35)}
.nm-amb-platter::after{content:"";position:absolute;inset:7%;border-radius:50%;border:1px solid rgba(255,255,255,.07)}
.nm-amb-vinyl{position:relative;width:68%;aspect-ratio:1;border-radius:50%;background-size:cover;background-position:center center;
  box-shadow:0 0 0 4px rgba(0,0,0,.6),0 0 0 5px rgba(255,255,255,.10),0 8px 26px rgba(0,0,0,.55)}
.nm-amb-vinyl.spin{animation:nm-spin 24s linear infinite}
@keyframes nm-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
.nm-amb-tonearm{position:absolute;right:8%;top:7%;width:6px;height:44%;border-radius:6px;transform-origin:50% 0;transform:rotate(30deg);
  background:linear-gradient(180deg,rgba(255,255,255,.95),rgba(180,190,205,.75));
  box-shadow:0 4px 16px rgba(0,0,0,.5)}
.nm-amb-tonearm::after{content:"";position:absolute;left:50%;bottom:-13px;width:20px;height:15px;margin-left:-10px;border-radius:4px;background:linear-gradient(180deg,rgba(255,255,255,.9),rgba(190,200,214,.8))}
.nm-amb-knob{position:absolute;right:8%;bottom:8%;width:14px;height:14px;border-radius:50%;background:#34d399;box-shadow:0 0 12px rgba(52,211,153,.9)}

/* ── 播放页样式 · 极简 ─────────────────────────────────────────────
   官方【极简主义】："Less is more，以点线面为基础几何结构"。
   这里只留封面本体：一个圆角方 + 一层投影 + 一层极淡外发光，
   不放底座/唱针/旋钮——机械结构正是"看着突兀"的来源。
   播放时用极慢的呼吸浮动代替旋转，有生命感但不抢注意力。 */
.nm-amb-disc-wrap{position:absolute;left:7%;top:50%;transform:translateY(-50%);display:flex;align-items:center;justify-content:center}
.nm-amb-disc{width:min(40vh,340px);aspect-ratio:1;border-radius:22px;background-size:cover;background-position:center center;
  box-shadow:0 32px 80px rgba(0,0,0,.62),0 2px 10px rgba(0,0,0,.4),
    0 0 0 1px rgba(255,255,255,.16),0 0 110px rgba(255,255,255,.07)}
.nm-amb-disc.breath{animation:nm-breathe 11s ease-in-out infinite}
@keyframes nm-breathe{
  0%,100%{transform:translateY(0) scale(1)}
  50%{transform:translateY(-7px) scale(1.014)}
}

/* ── 列表逐条渐入 ─────────────────────────────────────────────────
   从一开始就只动 opacity 和 transform —— 这两个属性走合成层，不会触发布局/重绘。
   延迟由行内样式写进来的 --nm-i 决定（序号在 JS 侧已封顶，见 riseProps）。
   尊重系统的"减少动态效果"。 */
@keyframes nm-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.nm-rise{animation:nm-rise .34s cubic-bezier(.22,.61,.36,1) both;animation-delay:calc(var(--nm-i,0) * 26ms)}
/* 同上：撤掉 reduced-motion 的杀手规则，歌单逐行入场不受系统偏好影响 */

/* ── 播放页样式 · 青春彩胶 ─────────────────────────────────────────
   官方【青春彩胶】："造型简单的透明底座和指针，让视觉焦点更聚焦在颜色变化上；
   采用可塑性强的半透明材质、整体氛围用封面取色"。
   所以这里去掉了厚重的底座，只留一个半透明彩胶盘 + 一根细指针，
   封面收缩成中心标签——真唱片就是这样的。 */
.nm-amb-platter-lite{width:min(30vw,360px);border-radius:0;background:none;border:none;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none}
.nm-amb-vinyl-color{width:88%;opacity:.9;
  box-shadow:0 0 0 1px rgba(255,255,255,.22),0 26px 64px rgba(0,0,0,.55),inset 0 0 70px rgba(255,255,255,.13);
  display:flex;align-items:center;justify-content:center}
.nm-amb-vinyl-label{width:42%;aspect-ratio:1;border-radius:50%;background-size:cover;background-position:center center;
  box-shadow:0 0 0 2px rgba(0,0,0,.35),0 4px 16px rgba(0,0,0,.5)}
.nm-amb-arm-lite{position:absolute;right:5%;top:4%;width:3px;height:42%;border-radius:3px;transform-origin:50% 0;
  background:linear-gradient(180deg,rgba(255,255,255,.8),rgba(255,255,255,.16));
  box-shadow:0 4px 16px rgba(0,0,0,.45)}

/* ── 播放页样式 · 沉浸式（只改背景，播放器页与控制条完全不动）─────────
   对齐网易云 PC 端全屏播放页的背景排版：歌词**居中放大当主角**，
   当前行最大最亮，相邻行按距离淡出——单栏、只有一个视觉焦点。
   原来的歌词是右侧小字，与左侧主体构成两栏，视线要来回跳，"排列不好看"就是这个原因。
   字号由 SkinLayers 的 AmbientBg 内联下发（沉浸式用 clamp 跟窗口高度走）。 */
/* 沉浸式样式的排版微调。
   ⚠️ **不要在这里写 position/left/right/top/bottom/transform/margin** ——
   基础规则 .nm-amb-lyrics 定义在本条之后、优先级相同，所以基础类会赢，
   这里写了也不会生效，反而容易让人误以为"沉浸式是居中的"。
   实测过一次：把它改成居中+flex，确实居中了，但那是**改掉了用户一直看到的靠右**。
   所以这里只管字号/行距/对齐这类真正生效的东西。 */
.nm-amb-lyrics-c{width:min(74vw,960px);max-height:70vh;overflow:hidden}
.nm-amb-lyrics-c .nm-amb-line{margin:9px 0}
/* 沉浸式的当前行是整层背景的最亮点（实测峰值 0.76），而文字对比度只看最亮处，
   所以它必须比其他元素更克制 —— 降到 .62 之后峰值落到 ~0.36，
   配上薄纱再回到 0.3 以下，面板 alpha 就能保持在 0.45 还读得清。 */
.nm-amb-lyrics-c .nm-amb-line.on{color:rgba(255,255,255,.62);font-size:1.32em;
  text-shadow:0 2px 6px rgba(0,0,0,.85),0 6px 34px rgba(0,0,0,.72)}

/* ── 背景歌词：上下渐隐，滚出边界时不生硬切断 ───────────────────── */
.nm-amb-lyrics{position:absolute;right:5%;top:50%;transform:translateY(-50%);width:min(36vw,440px);text-align:right;line-height:1.42;font-weight:600;pointer-events:none;
  -webkit-mask-image:linear-gradient(to bottom,transparent 0%,#000 14%,#000 86%,transparent 100%);
  mask-image:linear-gradient(to bottom,transparent 0%,#000 14%,#000 86%,transparent 100%)}
/* 歌词本身的对比度保障：除了右侧那道压暗渐变，再叠描边式阴影。
   实测浅色封面下只靠遮罩是不够的——字幕会糊成一片。 */
/* 歌词的峰值亮度刻意压在 1.0 以下。
   纯白歌词会形成"白色空洞"：面板 alpha 只有 0.3~0.45 时背景要贡献一大半亮度，
   白歌词叠上来，压在上面的正文对比度直接掉到 2:1 以下。
   这里是背景装饰，不需要抢眼，读得出来就够了。 */
.nm-amb-line{color:rgba(255,255,255,.24);transition:color .35s ease;margin:8px 0;
  text-shadow:0 1px 2px rgba(0,0,0,.85),0 2px 14px rgba(0,0,0,.72),0 0 34px rgba(0,0,0,.55)}
.nm-amb-line.on{color:rgba(255,255,255,.62);text-shadow:0 1px 3px rgba(0,0,0,.9),0 2px 18px rgba(0,0,0,.8),0 0 40px rgba(0,0,0,.6)}
.nm-amb-t,.nm-amb-tr{white-space:pre-wrap}
.nm-amb-tr{font-size:.6em;font-weight:400;color:rgba(255,255,255,.44);margin-top:2px}
.nm-amb-line.on .nm-amb-tr{color:rgba(255,255,255,.62)}

/* ── 整页：玻璃卡片浮在背景上 ───────────────────────────────────── */
/* ⚠️ 别删这两条。它们修的是"点开网易云音乐直接滚到底"。
   根因：DSH 的视图容器是 flex:1 0 auto（flex-shrink:0，拒绝收缩），
   于是它长到我们内容的高度而不是缩进滚动容器，height:100% 就参照了错的值，
   内层 overflow-y:auto 永不触发，滚动被丢给外层那个"聊天用、默认停在底部"的容器。
   让装着我们的那个 viewArea 允许收缩（min-height:0 配套），滚动才会落回面板自己。
   :has(.nm-page-root) 是刻意的：别的视图一个都不受影响。
   DSH 升级后 hash 变了会失配 —— 那时的表现只是退回旧行为（页面能滚），不会坏。 */
[class*="_viewArea"]:has(.nm-page-root){flex-shrink:1 !important;min-height:0 !important}
.nm-page-root{height:100%;min-height:0;display:flex;flex-direction:column;padding:10px 12px 12px;overflow:hidden}
.nm-heartbeat-on{color:#ff6b81 !important;border-color:rgba(255,107,129,.55) !important;background:rgba(255,107,129,.14) !important}
.nm-heartbeat-on:hover{background:rgba(255,107,129,.22) !important}
.nm-crash{margin:20px;padding:16px 18px;border-radius:12px;background:rgba(220,60,60,.14);border:1px solid rgba(220,60,60,.45);color:#ffd9d9;font-size:13px;line-height:1.6;word-break:break-all}
.nm-panel-page{position:relative;top:auto;right:auto;width:100%;max-width:none;height:100%;max-height:none;z-index:auto;
  background:rgba(13,17,23,.45);
  border:1px solid rgba(255,255,255,.12);
  border-radius:20px;
  box-shadow:0 10px 30px rgba(0,0,0,.3);
  backdrop-filter:blur(20px) saturate(130%);-webkit-backdrop-filter:blur(20px) saturate(130%);
  overflow:hidden}
.nm-panel-page .nm-panel-body{padding:16px 20px 6px}
.nm-panel-page .nm-panel-header{padding:12px 20px}

/* ── 歌曲行的红心 / 收藏按钮 ─────────────────────────────────── */
.nm-songrow-act{flex:none;width:22px;height:22px;border:none;background:transparent;color:var(--color-fg3);border-radius:6px;cursor:pointer;font-size:13px;line-height:1;display:flex;align-items:center;justify-content:center;padding:0}
.nm-songrow-act:hover{background:var(--color-bg3);color:var(--color-fg1)}
.nm-like{font-size:14px;line-height:1}
.nm-like-on{color:#f43f5e}
/* 传输控制容器的三处用法（共用 TransportControls，只有排布差异） */
.nm-transport{display:flex;align-items:center;gap:4px}
.nm-playerbar-transport{display:flex;align-items:center;gap:4px;flex:none}
.nm-side-transport{display:flex;align-items:center;gap:1px;flex:none}
.nm-like-on:hover{color:#fb7185}

/* ── 收藏到歌单浮层 ───────────────────────────────────────────── */
.nm-picker-mask{position:fixed;inset:0;z-index:2147483200;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center}
.nm-picker{width:min(360px,90vw);max-height:70vh;display:flex;flex-direction:column;
  background:rgba(13,17,23,.82);border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:12px;
  box-shadow:0 24px 60px rgba(0,0,0,.55);backdrop-filter:blur(24px) saturate(130%);-webkit-backdrop-filter:blur(24px) saturate(130%)}
.nm-picker-title{font-size:13px;font-weight:600;color:#fff}
.nm-picker-sub{font-size:11.5px;color:rgba(255,255,255,.5);margin:2px 0 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nm-picker-list{flex:1;min-height:60px;overflow-y:auto;display:flex;flex-direction:column;gap:2px}
.nm-picker-item{text-align:left;padding:7px 9px;border-radius:8px;border:none;background:transparent;color:rgba(255,255,255,.92);font-size:12.5px;cursor:pointer}
.nm-picker-item:hover{background:rgba(255,255,255,.11)}
.nm-picker-foot{display:flex;justify-content:flex-end;padding-top:8px}

/* ── 「播放器」子页签：杂志排版（2026-10-20 改版）─────────────────
   层次：封面出血 → 大标题 → 手绘线 → 元信息 → 进度 → 三分格控制 → 歌词三行
   入场分三档（full / song / light），全部只动 transform·opacity·clip-path。 */

/* 整体：左 46% 封面 + 右 54% 内容。窄屏（<760px）会自动堆叠。 */
.nm-pl{position:relative;display:grid;grid-template-columns:minmax(0,46%) minmax(0,54%);
  min-height:100%;overflow:hidden}

/* ── 左：封面出血 + 向右渐隐 ──
   用 mask 而不是叠一层深色渐变 —— 这样背景是什么颜色都自然，皮肤开关关掉也对。 */
.nm-pl-art{position:relative;overflow:hidden;min-height:200px;
  -webkit-mask-image:linear-gradient(90deg,#000 56%,transparent 97%);
  mask-image:linear-gradient(90deg,#000 56%,transparent 97%)}
.nm-pl-img{position:absolute;inset:-2%;background-size:cover;background-position:center center}
.nm-pl-img-none{background:linear-gradient(150deg,#1a2030,#0d1119)}
.nm-pl-stamp{position:absolute;left:18px;bottom:16px;font-size:10px;letter-spacing:.16em;
  text-transform:uppercase;color:rgba(255,255,255,.46);max-width:80%;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ── 右：内容列 ── */
.nm-pl-col{display:flex;flex-direction:column;justify-content:center;
  padding:18px 22px 18px 6px;min-width:0}

/* 眉标：一根短横线 + 小字 */
.nm-pl-eyebrow{display:flex;align-items:center;gap:9px;font-size:10px;letter-spacing:.18em;
  text-transform:uppercase;color:var(--color-fg3,#7c8698)}
.nm-pl-eyebrow .nm-pl-rule{display:block;width:24px;height:1px;background:#8aa8ff;opacity:.85;
  transform-origin:left}

/* 大标题：每个字一个裁切窗口，字从里面升起来 */
.nm-pl-title{margin:10px 0 0;font-size:clamp(26px,3.6vw,46px);font-weight:800;
  letter-spacing:-1.2px;line-height:1.12;color:var(--color-fg1,#eef1f7);
  display:flex;flex-wrap:wrap;align-items:flex-end;
  /* 短歌名（1~3 个字）也要有足够的行高，否则逐字位移看不出幅度 */
  min-height:1.12em}
.nm-pl-ch{display:inline-block;overflow:hidden;vertical-align:bottom;
  /* 裁切窗口给足高度，字往下探 1em 也不会漏出别的行 */
  padding-bottom:.06em}
.nm-pl-ch > i{display:inline-block;font-style:normal}

/* 手绘下划线：SVG 描边自己画出来 */
.nm-pl-flourish{display:block;width:min(210px,60%);height:11px;margin:6px 0 0;overflow:visible}
.nm-pl-flourish path{fill:none;stroke:#8aa8ff;stroke-width:1.5;stroke-linecap:round;opacity:.7;
  stroke-dasharray:260;stroke-dashoffset:260}

/* 歌手 · 专辑 · 音质徽标 */
.nm-pl-by{display:flex;align-items:center;gap:9px;margin-top:12px;min-width:0;flex-wrap:wrap}
.nm-pl-who{font-size:14px;font-weight:600;color:var(--color-fg1,#eef1f7);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60%}
.nm-pl-sep{width:3px;height:3px;border-radius:50%;background:var(--color-fg3,#7c8698);flex:none}
.nm-pl-what{font-size:11.5px;color:var(--color-fg3,#7c8698);min-width:0;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* 进度 */
.nm-pl-prog{margin-top:20px;max-width:520px}
.nm-pl-trackwrap{display:flex;align-items:center}
.nm-pl-range{width:100%;height:3px}
.nm-pl-times{display:flex;justify-content:space-between;margin-top:5px;
  font-size:10.5px;color:var(--color-fg3,#7c8698);font-variant-numeric:tabular-nums}

/* ── 控制：三分格 ──
   ★ 这就是那个排版 bug 的修法：中列 auto，左右各 1fr，
     所以传输控制永远在正中，左边放模式按钮也不会把它顶偏。 */
.nm-pl-ctl{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;
  gap:8px;margin-top:16px;max-width:520px}
.nm-pl-side{display:flex;align-items:center;gap:6px;min-width:0}
.nm-pl-left{justify-content:flex-start}
.nm-pl-right{justify-content:flex-end}
.nm-pl-center{display:flex;align-items:center;gap:10px;justify-content:center}
.nm-pl-play{width:46px;height:46px;border-radius:50%;padding:0}

/* 音量（单独一行，小一号） */
.nm-pl-vol{display:flex;align-items:center;gap:8px;margin-top:12px;max-width:200px;
  color:var(--color-fg3,#7c8698)}
.nm-pl-vol .nm-range{flex:1;height:3px}

/* 歌词：三行，当前行更亮；换行时用 clip-path 擦开（"书写"感） */
.nm-pl-lyr{margin-top:16px;padding-top:12px;border-top:1px solid var(--color-border,rgba(255,255,255,.08));
  max-width:560px;min-height:0;overflow:hidden}
.nm-pl-l{display:flex;flex-direction:column;gap:1px;font-size:12.5px;line-height:1.65;
  color:var(--color-fg3,#7c8698);transition:color .32s ease}
.nm-pl-l-on{color:var(--color-fg1,#eef1f7);font-weight:600}
.nm-pl-lt{white-space:pre-wrap;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nm-pl-ltr{font-size:10.5px;color:var(--color-fg3,#7c8698);white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.nm-pl-l-on .nm-pl-ltr{color:var(--color-fg2,#b9c1d1)}
.nm-pl-none{margin-top:14px}

/* 正在显示"上一屏"（新歌还没就绪）：不播入场、不做任何动画，画面完全静止 */
.nm-pl-hold{animation:none}

/* ── 骨架态（封面/歌词还没就绪）────────────────────────────────
   目标不是"好看"，而是"看起来还活着"：真数据照常显示，只有封面与歌词位置是占位。
   占位沿用"暗底 + 淡描边"的规则，不引入新颜色。 */
.nm-pl-wait{animation:nmPlFade .2s ease both}
.nm-pl-img-wait{background:linear-gradient(150deg,#161b26,#0d1119);
  animation:nmPlBreathe 1.6s ease-in-out infinite}
@keyframes nmPlBreathe{0%,100%{opacity:.55}50%{opacity:.9}}
.nm-pl-skel{display:flex;flex-direction:column;gap:8px;margin-top:22px;max-width:320px}
.nm-pl-skel-line{height:10px;border-radius:6px;
  background:linear-gradient(90deg,rgba(255,255,255,.05),rgba(255,255,255,.11),rgba(255,255,255,.05));
  background-size:200% 100%;animation:nmPlShimmer 1.4s linear infinite}
.nm-pl-skel-short{width:56%}
@keyframes nmPlShimmer{to{background-position:-200% 0}}
.nm-pl-wait-hint{margin-top:14px;font-size:11.5px;color:var(--color-fg3,#7c8698)}

/* ══════════ 入场编排（两档：每次挂载 full / 换歌 song）══════════
   full  : 封面擦开 → 眉标线 → 标题逐字 → 手绘线 → 元信息 → 进度 → 按钮 → 歌词
   song  : 只重播跟"这首歌"有关的三件（封面 / 标题 / 进度）
   light : 只淡入，什么编排都不跑
   全部只动 transform / opacity / clip-path / stroke-dashoffset。 */

/* 默认状态：元素先"藏起来"，等档位对应的 @keyframes 把它们放出来 */
.nm-ent-full .nm-pl-img{clip-path:inset(0 100% 0 0);animation:nmPlWipe .8s cubic-bezier(.22,.61,.36,1) .04s both}
.nm-ent-full .nm-pl-stamp{opacity:0;animation:nmPlFade .5s ease 1.05s both}
.nm-ent-full .nm-pl-rule{transform:scaleX(0);animation:nmPlDraw .5s cubic-bezier(.22,.61,.36,1) .16s both}
.nm-ent-full .nm-pl-eyebrow > span{opacity:0;animation:nmPlFade .42s ease .40s both}
/* 位移用 em（跟字号走）而不是百分比 —— 短歌名时 112% 只有半个字高，看不出在动。
   1em 保证不管标题多长，位移都是"一整个字高"，视觉幅度一致。 */
.nm-ent-full .nm-pl-ch > i{transform:translateY(1em);animation:nmPlRise .64s cubic-bezier(.22,.61,.36,1) both}
.nm-ent-full .nm-pl-flourish path{animation:nmPlStroke 1.05s cubic-bezier(.22,.61,.36,1) .7s both}
.nm-ent-full .nm-pl-by{opacity:0;transform:translateY(10px);animation:nmPlUp .55s cubic-bezier(.22,.61,.36,1) .9s both}
.nm-ent-full .nm-pl-prog{opacity:0;transform:translateY(10px);animation:nmPlUp .5s cubic-bezier(.22,.61,.36,1) 1.02s both}
.nm-ent-full .nm-pl-ctl{opacity:0;transform:translateY(10px);animation:nmPlUp .5s cubic-bezier(.22,.61,.36,1) 1.14s both}
.nm-ent-full .nm-pl-vol{opacity:0;animation:nmPlFade .5s ease 1.3s both}
.nm-ent-full .nm-pl-l{opacity:0;transform:translateY(8px);animation:nmPlUp .5s cubic-bezier(.22,.61,.36,1) both}
.nm-ent-full .nm-pl-l:nth-child(1){animation-delay:1.36s}
.nm-ent-full .nm-pl-l:nth-child(2){animation-delay:1.44s}
.nm-ent-full .nm-pl-l:nth-child(3){animation-delay:1.52s}
.nm-ent-full .nm-pl-l:nth-child(4){animation-delay:1.6s}

/* 换歌：只播跟歌有关的三件，其余直接呈现 */
.nm-ent-song .nm-pl-img{clip-path:inset(0 100% 0 0);animation:nmPlWipe .62s cubic-bezier(.22,.61,.36,1) both}
.nm-ent-song .nm-pl-ch > i{transform:translateY(1em);animation:nmPlRise .5s cubic-bezier(.22,.61,.36,1) both}
.nm-ent-song .nm-pl-prog{opacity:0;animation:nmPlFade .4s ease .18s both}

/* 切页签：只淡入 */
@keyframes nmPlWipe{to{clip-path:inset(0 0 0 0)}}
@keyframes nmPlFade{to{opacity:1}}
@keyframes nmPlDraw{to{transform:scaleX(1)}}
@keyframes nmPlRise{to{transform:translateY(0)}}
@keyframes nmPlUp{to{opacity:1;transform:translateY(0)}}
@keyframes nmPlStroke{to{stroke-dashoffset:0}}

/* 2026-11-01 撤掉整个 @media(prefers-reduced-motion:reduce) 块：
   原来是"尊重系统减少动态"，但它把播放器页的全部入场动画
   （nmPlWipe/nmPlRise/nmPlUp/nmPlDraw/nmPlStroke）一刀切关掉了。
   用户的系统恰好开着这个偏好 → 打开播放器页什么都不动，"逐步渲染"消失。 */

/* 窄屏：左右堆叠，封面缩成顶部一块 */
/* 窄屏：左右堆叠，封面缩成顶部一块 */
@media (max-width:760px){
  .nm-pl{grid-template-columns:1fr;grid-template-rows:auto 1fr}
  .nm-pl-art{min-height:150px;max-height:34vh;
    -webkit-mask-image:linear-gradient(180deg,#000 60%,transparent 100%);
    mask-image:linear-gradient(180deg,#000 60%,transparent 100%)}
  .nm-pl-col{padding:14px 16px 18px}
  .nm-pl-title{font-size:clamp(24px,7vw,34px)}
  .nm-pl-ctl,.nm-pl-prog{max-width:none}
}

/* ═══ 设置页 v2（2026-11-01 重设计 · Linear/Vercel 风格）══════════════
   设计语言：深色 + hairline 细线 + 方角开关（非 iOS 圆形）+ tabular-nums。
   性能约束：只做 transform/opacity/bg 过渡；无 backdrop-filter；nav 用
   IntersectionObserver 不绑 scroll。

   布局：左 140px 分区导航 + 右内容区（独立滚动）。 */

/* 根容器：双栏 grid */
.nm-set2{display:grid;grid-template-columns:140px 1fr;gap:16px;align-items:start;min-height:100%}
/* 左导航 */
.nm-set2-nav{position:sticky;top:8px;display:flex;flex-direction:column;gap:2px}
.nm-set2-nav-item{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:6px;
  border:none;background:transparent;color:rgba(255,255,255,.48);font-size:12.5px;
  cursor:pointer;text-align:left;transition:color .15s ease,background-color .15s ease;position:relative}
.nm-set2-nav-item::before{content:'';width:2px;height:14px;border-radius:1px;background:transparent;
  transition:background-color .15s ease}
.nm-set2-nav-item:hover{color:rgba(255,255,255,.75)}
.nm-set2-nav-on{color:rgb(120,160,255);background:rgba(77,118,230,.12)}
.nm-set2-nav-on::before{background:rgb(90,140,255)}
/* 右内容区 */
.nm-set2-body{display:flex;flex-direction:column;gap:20px;min-width:0}
/* 分区卡片 */
.nm-set2-sec{background:rgba(14,23,43,.72);border-radius:12px;
  box-shadow:inset 0 0 0 1px rgba(185,204,246,.08);overflow:hidden;
  scroll-margin-top:8px}
.nm-set2-head{display:flex;align-items:center;gap:8px;padding:14px 16px 10px;
  border-bottom:1px solid rgba(255,255,255,.04)}
.nm-set2-head-dot{width:5px;height:5px;border-radius:2px;background:rgb(90,140,255);flex:none}
.nm-set2-head-t{font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;
  color:rgba(255,255,255,.42)}
/* 行 */
.nm-set2-row{display:flex;align-items:center;justify-content:space-between;gap:12px;
  min-height:42px;padding:9px 16px;border-bottom:1px solid rgba(255,255,255,.03);
  transition:background-color .12s ease}
.nm-set2-row:last-child,.nm-set2-row:last-of-type{border-bottom:none}
.nm-set2-row:hover{background:rgba(255,255,255,.02)}
.nm-set2-lab{font-size:13px;color:rgba(255,255,255,.90);flex:1;min-width:0;
  display:flex;align-items:center}
.nm-set2-val{font-size:12px;color:rgba(255,255,255,.50);
  font-variant-numeric:tabular-nums;white-space:nowrap;flex:none}
.nm-set2-hint{padding:6px 16px 12px;font-size:11.5px;line-height:1.55;
  color:rgba(255,255,255,.42)}
.nm-set2-hint:last-child{padding-bottom:14px}
/* 模块网格（2 列） */
.nm-set2-grid{display:grid;grid-template-columns:1fr 1fr}
.nm-set2-cell{display:flex;align-items:center;justify-content:space-between;gap:8px;
  padding:9px 16px;border-bottom:1px solid rgba(255,255,255,.03);min-height:40px;
  transition:background-color .12s ease}
.nm-set2-cell:hover{background:rgba(255,255,255,.02)}
.nm-set2-cell:nth-child(odd){border-right:1px solid rgba(255,255,255,.03)}
.nm-set2-cell:nth-last-child(1):nth-child(odd),
.nm-set2-cell:nth-last-child(2):nth-child(even){border-bottom:none}
.nm-set2-cell:nth-last-child(1):nth-child(even){border-bottom:none}
.nm-set2-cell-lab{font-size:12.5px;color:rgba(255,255,255,.85)}
/* 方角开关（非 iOS） */
.nm-set2-tg{position:relative;width:34px;height:18px;border-radius:3px;flex:none;
  border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.05);
  cursor:pointer;transition:background-color .16s ease,border-color .16s ease;padding:0}
.nm-set2-tg-thumb{position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:2px;
  background:rgba(255,255,255,.35);transition:transform .16s cubic-bezier(.4,0,.2,1),background-color .16s ease}
.nm-set2-tg-on{background:rgba(77,118,230,.85);border-color:transparent}
.nm-set2-tg-on .nm-set2-tg-thumb{transform:translateX(16px);background:#fff}
/* 滑块行 */
.nm-set2-slider{display:flex;align-items:center;gap:12px;flex:1;max-width:200px}
.nm-set2-range{-webkit-appearance:none;appearance:none;flex:1;height:2px;border-radius:1px;
  background:linear-gradient(to right,rgb(90,140,255) 0%,rgb(90,140,255) var(--nm-fill,50%),rgba(255,255,255,.10) var(--nm-fill,50%));
  outline:none;cursor:pointer;margin:0}
.nm-set2-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:12px;height:12px;
  border-radius:50%;background:#fff;border:none;box-shadow:0 1px 4px rgba(0,0,0,.3);
  cursor:grab;transition:transform .12s ease}
.nm-set2-range::-webkit-slider-thumb:hover{transform:scale(1.15)}
.nm-set2-range::-webkit-slider-thumb:active{cursor:grabbing;transform:scale(1.25)}
/* 下拉 */
.nm-set2-select{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10);
  border-radius:6px;color:rgba(255,255,255,.90);font-size:12.5px;
  padding:5px 26px 5px 10px;cursor:pointer;outline:none;appearance:none;-webkit-appearance:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='rgba(255,255,255,.40)'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 8px center;
  transition:border-color .15s ease,box-shadow .15s ease}
.nm-set2-select:hover{border-color:rgba(255,255,255,.18)}
.nm-set2-select:focus{border-color:rgba(77,118,230,.60);box-shadow:0 0 0 2px rgba(77,118,230,.12)}
.nm-set2-select option{background:rgb(14,23,43);color:rgba(255,255,255,.90)}
/* 数字输入 */
.nm-set2-num{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10);
  border-radius:6px;color:rgba(255,255,255,.90);font-size:12.5px;
  padding:5px 8px;width:72px;text-align:right;outline:none;
  font-variant-numeric:tabular-nums;
  transition:border-color .15s ease,box-shadow .15s ease}
.nm-set2-num:hover{border-color:rgba(255,255,255,.18)}
.nm-set2-num:focus{border-color:rgba(77,118,230,.60);box-shadow:0 0 0 2px rgba(77,118,230,.12)}
/* 文本输入 */
.nm-set2-text{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10);
  border-radius:6px;color:rgba(255,255,255,.90);font-size:12px;
  padding:5px 8px;flex:1;min-width:0;outline:none;
  transition:border-color .15s ease,box-shadow .15s ease}
.nm-set2-text:focus{border-color:rgba(77,118,230,.60);box-shadow:0 0 0 2px rgba(77,118,230,.12)}
.nm-set2-text::placeholder{color:rgba(255,255,255,.30)}
/* 操作按钮行 */
.nm-set2-actions{display:flex;gap:6px;flex-wrap:wrap;padding:10px 16px 14px}
.nm-set2-btn{border:none;border-radius:6px;font-size:12px;padding:6px 12px;
  cursor:pointer;transition:background-color .12s ease,color .12s ease}
.nm-set2-btn-ghost{background:rgba(255,255,255,.05);color:rgba(255,255,255,.70)}
.nm-set2-btn-ghost:hover{background:rgba(255,255,255,.09);color:rgba(255,255,255,.90)}
.nm-set2-btn-accent{background:rgba(77,118,230,.75);color:#fff}
.nm-set2-btn-accent:hover{background:rgba(77,118,230,.95)}
.nm-set2-btn-danger{background:rgba(220,60,60,.12);color:rgb(255,120,120)}
.nm-set2-btn-danger:hover{background:rgba(220,60,60,.22)}
/* 窄屏：导航变横条 */
@media (max-width:560px){
  .nm-set2{grid-template-columns:1fr;gap:10px}
  .nm-set2-nav{position:static;flex-direction:row;flex-wrap:wrap;gap:4px}
  .nm-set2-nav-item::before{display:none}
}
`;
