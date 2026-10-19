/**
 * DSH 皮肤接缝 —— 整个插件里**唯一**允许读写 DSH 全局的地方。
 *
 * 为什么单独成层：这个插件本质上是"一套 DSH 皮肤 + 一个音乐播放器"。
 * 皮肤认的是「一张图 + 一行歌词 + 播放进度」，不认识"歌"；音乐侧只是数据源。
 * 所以皮肤必须能独立演进，也必须有一个明确的边界 —— 前两轮事故
 * （文字几秒后变暗、左侧栏被锚飞）根因都是这一层没有边界。
 *
 * 对外只有 4 个出口。内部状态（令牌原值缓存、玻璃名单、MutationObserver）
 * 外面一概拿不到 —— 这正是抽这一层的全部目的。
 */
const DshSkin = (() => {

  /** 背景图层由外面创建，这里只登记引用 */
  let backgroundLayerEl = null

    /**
     * 需要变透明的界面令牌。
     *
     * 早先只留了"结构层"两个，因为把菜单/面板也透掉之后设置抽屉读不清。但那是
     * **缺了玻璃化**导致的 —— 补上 backdrop-filter（见下面 frost 那一段）之后，
     * 这些面可以放心透明：背后被磨砂成一片均匀的底，文字照样清楚，
     * 而且不会有"白框太扎眼、把背景挡掉"的问题。
     */
    const AMBIENT_TOKENS = [
      "--dsw-alias-bg-base",
      "--dsw-specific-sidebar-fill",
      "--dsw-alias-bg-layer-1",
      "--dsw-alias-bg-layer-2",
      "--dsw-alias-bg-layer-3",
      "--dsw-specific-input-major",
      "--dsw-specific-menu",
    ];


    /** 我们注入过的文字令牌值（诊断用，只读）。 */
    const injectedTextDecls = {};

    /**
     * 「写死的浅色面」压暗规则。
     *
     * CDP 实测（scripts/cdp.mjs）：代码块三件套 _block_7gxqk_4 / _banner_7gxqk_24 /
     * _plain_7gxqk_103 共用 hash 后缀 7gxqk，底色写死 rgb(249,250,251)；消息气泡
     * cJsG2q_bubble 是 rgb(237,243,254)；主按钮 _2H3hWW_newSession 是纯白。
     * **这些都不是 CSS 变量** —— 所以改令牌名单永远碰不到它们。
     *
     * hash 会随 DSH 版本变，所以匹配用"后缀里的稳定片段 + 属性包含选择器"，
     * 并且只针对这几种**具体形态**，不碰通用容器类 —— 这样"被选中的元素"
     * （设置菜单里那个白 pill）不会被误伤，符合"只有选中的可以是白的"。
     *
     * 唯一没覆盖的是「加载更早」那个按钮：它没有类名，属性选择器选不中。
     */
    const DARK_SURFACE_CSS = [
      // 弹窗的整屏遮罩 —— 这一条才是"弹层明显更高"的观感来源，做法照抄
      // @kenz1117/dsh-ui-usage-billing：DSH 弹窗结构是 div[role=presentation] >
      // div[aria-hidden=true]，遮罩是它的首个子元素。磨遮罩 = 背后整体糊掉 + 弹窗跳出来。
      // **它用的是 :has()，不需要我们的类名，所以必须放在这份"跟着开关走"的样式里**，
      // 留在静态 CSS 里的话，关掉皮肤它照样生效。
      'div[role="presentation"]:has(>div[aria-hidden="true"]:first-child)>div[aria-hidden="true"]:first-child{backdrop-filter:blur(10px) saturate(1.25);-webkit-backdrop-filter:blur(10px) saturate(1.25)}',
      '[class*="_banner_7gxqk"], [class*="_plain_7gxqk"]{background-color:transparent!important}',
      '[class*="_block_7gxqk"], [class*="code-block"]{background-color:rgba(18,20,26,.72)!important;border-color:rgba(255,255,255,.10)!important}',
      "pre,code{background-color:transparent!important}",
      '[class*="bubble"]{background-color:rgba(28,32,44,.58)!important}',
      '[class*="newSession"]{background-color:rgba(28,32,44,.58)!important;border-color:rgba(255,255,255,.14)!important}',
      // 「加载更早」：不是文件级重要项，按规则也该压暗（它自己没有类名，靠父层 xz4KEq_older 锚）
      '[class*="xz4KEq_older"] button{background-color:rgba(28,32,44,.58)!important;border-color:rgba(255,255,255,.14)!important}',
      // 「回到底部」悬浮按钮：同样不是文件级重要项
      '[class*="xz4KEq_toBottom"]{background-color:rgba(28,32,44,.58)!important;border-color:rgba(255,255,255,.14)!important}',
      // 设置弹窗：选中态的导航项、下拉控件、步进器 —— 都不是文件级内容，一律压暗。
      // 描边用 box-shadow inset 而不是 border：这些元素原本 border-width 是 0，
      // 加真 border 会让它们各长 2px，整个弹窗布局会抖。
      '[class*="navCell"][class*="active"]{background-color:rgba(56,64,82,.72)!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18)!important}',
      '[class*="_selector"]{background-color:rgba(28,32,44,.58)!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)!important}',
      '[class*="stepper"]{background-color:rgba(28,32,44,.5)!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)!important}',
      // 注意：**不要**压暗 [class*="themeCube"]（主题预览块）。
      // 它的白色是内容（在预览"主题长什么样"），压暗了预览就失去意义 ——
      // 同 §3 的原则：判断标准是"是不是内容/重不重要"，不是"它白不白"。
      // 状态标签也要压暗（用户选 A：严格执行"白只给文件级"）。
      // 注意 _tag_ 用的是"类名前缀"匹配 —— 标签永远不是内容，放宽一点没风险。
      '[class*="RotMhW_switcher"]{background-color:rgba(28,32,44,.58)!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)!important}',
      '[class*="_tag_"]{background-color:rgba(28,32,44,.55)!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)!important}',
      // ★ 唯一保留白的【非文件】元素：主题预览块 themeCube —— 它的白是内容（在预览主题），
      //   压暗了预览就没意义。判断标准始终是"是不是内容/重不重要"，不是"它白不白"。
    ].join("\n");

    /**
     * 摘掉 DOM 里所有带指定 data-plugin 的 <style>。
     *
     * 为什么需要：模块级变量（surfaceStyleEl / ambientStyleEl）在 DSH 热重载后是 null，
     * 而上一份 <style> 还留在 head 里 —— 旧实例的 disposer 不会被可靠调用。
     * 实测每重载一次就多一份，攒到过 4 份（等于我们的压暗/磨砂规则被重复匹配 4 次）。
     * 所以注入前先按属性清干净，让注入变成幂等的。
     */
    function removeStylesByPlugin(name) {
      let n = 0;
      try {
        const list = document.querySelectorAll('style[data-plugin="' + name + '"]');
        for (const el of list) {
          try {
            el.remove();
            n += 1;
          } catch (err) {
            /* 非致命 */
          }
        }
      } catch (err) {
        /* 非致命 */
      }
      return n;
    }

    let surfaceStyleEl = null;
    function ensureSurfaceStyle() {
      if (surfaceStyleEl && surfaceStyleEl.isConnected) return surfaceStyleEl;
      removeStylesByPlugin("dsh-netease-surfaces");   // 清掉热重载留下的旧份
      surfaceStyleEl = document.createElement("style");
      surfaceStyleEl.dataset.plugin = "dsh-netease-surfaces";
      surfaceStyleEl.textContent = DARK_SURFACE_CSS;
      document.head.appendChild(surfaceStyleEl);
      return surfaceStyleEl;
    }
    function removeSurfaceStyle() {
      // **只删自己手里这一份。**
      //
      // 曾经在这里改成"按属性删全部"，结果热重载时把新实例刚建好的那份也删了：
      // 时序是新实例先挂载并注入、旧实例的 unmount 清理后跑 —— 于是删完就没人补
      // （applySkin 有 signature 去重，认为自己已经应用过）。表现为皮肤整片消失。
      // 清旧份的职责在 ensureSurfaceStyle（先删后建，天然安全），不在这里。
      if (surfaceStyleEl) {
        try {
          surfaceStyleEl.remove();
        } catch (err) {
          /* 非致命 */
        }
        surfaceStyleEl = null;
      }
    }

    let ambientStyleEl = null;
    function ensureAmbientStyle() {
      if (ambientStyleEl && ambientStyleEl.isConnected) return ambientStyleEl;
      removeStylesByPlugin("dsh-netease-ambient");     // 清掉热重载留下的旧份
      ambientStyleEl = document.createElement("style");
      ambientStyleEl.dataset.plugin = "dsh-netease-ambient";
      document.head.appendChild(ambientStyleEl);
      return ambientStyleEl;
    }

    /**
     * 任意 CSS 颜色 → 带 alpha 的 rgba()。
     * 用探针元素让浏览器自己归一化，于是 #hex / rgb() / hsl() / var() 都能吃下。
     */
    function toRgba(cssColor, alpha) {
      try {
        const probe = document.createElement("div");
        probe.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:0;height:0;color:" + cssColor;
        document.body.appendChild(probe);
        const norm = getComputedStyle(probe).color;
        probe.remove();
        const m = norm.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const parts = m[1].split(",").map((s) => parseFloat(s));
        if (parts.length < 3) return null;
        return "rgba(" + parts[0] + "," + parts[1] + "," + parts[2] + "," + alpha + ")";
      } catch (e) {
        return null;
      }
    }

    /**
     * 令牌在不同 DSH 版本 / 主题下不一定定义在 :root。
     * 实测本机 :root 上读不到 --dsw-alias-bg-base（自检显示「令牌 base=」为空），
     * 所以依次往下找第一个有值的节点。
     */
    function tokenSources() {
      const list = [document.documentElement, document.body];
      try {
        if (document.body) {
          const extra = document.body.querySelectorAll(
            "#root, #app, #dsh-root, main, [class*='app'], [class*='shell'], [class*='layout']"
          );
          for (const node of extra) list.push(node);
        }
      } catch (err) {
        /* 选择器不支持时忽略 */
      }
      return list.filter(Boolean);
    }

    function readToken(name) {
      for (const node of tokenSources()) {
        const value = getComputedStyle(node).getPropertyValue(name).trim();
        if (value) return value;
      }
      return "";
    }

    const BG_NAME_RE = /(bg|background|surface|fill|layer|panel|menu|card|base|sidebar|input)/i;
    const NOT_BG_NAME_RE = /(fg|text|font|border|shadow|stroke|icon|radius|size|weight|height|width|gap|pad|duration|z-|opacity)/i;

    /**
     * 扫描兜底时排除的名字。
     *
     * 玻璃化会兜住可读性，所以这些面**允许**变透明；这里只排除两种明显不该动的：
     * tooltip / dialog —— 面积小或本就是最高层模态，磨砂反而更糊。
     */
    const OVERLAY_NAME_RE = /(tooltip|dialog)/i;

    /** 值是否为「不透明纯色」——透明的本来就不挡图层，改它没意义还掉帧。 */
    function isOpaqueColor(value) {
      if (!value) return false;
      if (/^#[0-9a-f]{6}$/i.test(value)) return true;
      if (/^#[0-9a-f]{8}$/i.test(value)) return !/00$/i.test(value);
      if (/^rgb\(/i.test(value)) return true;
      const m = value.match(/^rgba\([^)]*,\s*([\d.]+)\s*\)$/i);
      if (m) return Number(m[1]) >= 1;
      return false;
    }

    /**
     * 兜底：硬编码的 7 个令牌一个都读不到时（DSH 换了命名），
     * 扫描页面上真实存在、且「看起来是不透明背景色」的自定义属性。
     */
    function discoverBgTokens(limit) {
      const found = [];
      const seen = new Set();
      for (const node of tokenSources()) {
        const cs = getComputedStyle(node);
        for (let i = 0; i < cs.length; i++) {
          const name = cs[i];
          if (typeof name !== "string" || name.indexOf("--") !== 0) continue;
          if (seen.has(name)) continue;
          if (!BG_NAME_RE.test(name) || NOT_BG_NAME_RE.test(name)) continue;
          const value = cs.getPropertyValue(name).trim();
          if (!isOpaqueColor(value)) continue;
          seen.add(name);
          found.push(name);
          if (limit && found.length >= limit) return found;
        }
      }
      return found;
    }

    let ambientSig = "";
    let ambientFoundTokens = 0;
    let ambientFallback = false;
    let ambientLiftedText = 0;

    /**
     * 读 DSH 的**原始值**，绝不读到自己写的覆写。
     *
     * 这是踩过的坑，现象很迷惑：界面一开始是好的，几秒后突然又变暗。
     * 根因是 3 秒一次的兜底重贴会触发第二轮 apply，而第二轮读到的
     * **是我们自己刚写上去的值** —— 于是"已经够亮、不用改"成立，抬亮被丢掉。
     * 同一段代码一轮生效一轮失效，看着就像"随机变暗"。
     *
     * 两道保险：
     *   1) 优先从 document.documentElement 读。我们只往
     *      body / #root / #app / #dsh-root 写覆写，**不碰 html**，所以这里
     *      读到的永远是 DSH 的原值，哪怕我们的样式早就生效了；
     *   2) :root 上没有这个令牌时（本机实测部分令牌确实不在 :root），
     *      退回"第一次读到的值"—— 第一次必然发生在写之前，是干净的。
     *      主题切换时 clearAmbientTokens 会把这个缓存清掉，不会读到旧主题。
     */
    let origTokenCache = null;
    function readTokenOriginal(name) {
      const fromRoot = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      if (fromRoot) return fromRoot;
      if (!origTokenCache) origTokenCache = {};
      if (origTokenCache[name] === undefined) origTokenCache[name] = readToken(name) || "";
      return origTokenCache[name];
    }

    // ── 玻璃化（backdrop-filter）────────────────────────────────────────────
    //
    // 把 DSH 的面板改成半透明之后，**必须由我们补上背景幕模糊**：那些面本来是不透明的，
    // 压根不需要 backdrop-filter。这是"既透明又清晰"的关键一层，依据都是成熟做法：
    //   · web.dev《使用背景幕滤镜制作操作系统风格的背景》：玻璃面板 = 半透明底 + backdrop-filter；
    //   · Josh Comeau《Next-level frosted glass with backdrop-filter》：只有把背后磨砂掉，
    //     局部对比度才会消失，"透明"和"可读"才能同时成立；
    //   · Discourse 的一个实际案例和我们的现象一模一样：背景透明生效、文字糊，
    //     补上 backdrop-filter 之后 sidebar / 面板 / 下拉全部清晰。
    //
    // 怎么定位它们（这是关键）：DSH 内部类名是哈希的，逐个枚举既漏又脆。
    // 但**背景色是我们自己注入的 rgba** —— 所以按"计算出的 background-color
    // 命中我们注入的值"来认领，一次覆盖所有面板、菜单、抽屉、输入框，
    // 而且新弹出的浮层也会被 MutationObserver 扫到，不用列举、不会漏。
    const FROST_CLASS = "nm-frost";

    /** 把颜色规范化成 "r,g,b,a" 作为比对键 —— 浏览器的 computed 值带空格，直接比字符串会漏。 */
    function rgbaKey(css) {
      const m = String(css || "").match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(",").map((s) => parseFloat(s));
      if (p.length < 3 || !Number.isFinite(p[0])) return null;
      const a = p.length >= 4 ? Math.round(p[3] * 1000) / 1000 : 1;
      return p[0] + "," + p[1] + "," + p[2] + "," + a;
    }

    let injectedKeys = new Set();
    let frostObserver = null;
    let frostTimer = null;
    let frostPending = null;

    /**
     * 该不该磨砂**由形态决定，不由令牌名决定**（见 frostMatches 的说明）。
     *
     * 令牌这一层只做一件事：把 bg-base / sidebar-fill 这类整页级底排除掉 ——
     * 它们连"布局树内"检查都不用走，本来就不该有磨砂。
     *
     * 另一道硬闸在 frostMatches 里（面积 > 半个视口不磨）：`backdrop-filter`
     * 会把元素变成**包含块与层叠上下文**，里面的 `position: fixed` 后代会被重新
     * 锚定到它身上而不是视口 —— 实测把整页级容器磨上之后**整个左侧栏直接消失**。
     */
    /**
 * 不再按令牌名排除任何底。
 *
 * 这里曾经写着 /(bg-base|sidebar-fill)/i —— 那是早期为了防"磨了整页容器导致
 * 侧栏整个飞走"打的补丁。但那个问题的正解是**尺寸闸门**（见 frostMatches：
 * 高度 ≥88% 视口、或面积 >85% 视口 一律不磨），闸门到位后按名字的一刀切就成了
 * 残留：任何用 --dsw-alias-bg-base 画的**小**控件都会被误伤 ——
 * 主页面底部那个输入框就是这么丢掉磨砂的。
 *
 * 现在只由形态（尺寸）决定，与令牌叫什么名字无关。
 */

    /**
     * 磨砂范围。由外面通过 applySkin 传进来（默认 layout）。
     *   layout —— 只磨"工具面/浮层"，常驻版式区域（主对话区、左侧栏）保持完全透明；
     *   all    —— 所有被我们改透明的面都磨；
     *   off    —— 完全不磨（只保留透明与文字抬亮）。
     * 做成可配是因为"哪块该磨"本质是审美取舍，不该每次都回来改代码。
     */
    let frostMode = 'layout'
    function isFrostWorthyToken(name) {
      return true; // 交给 frostMatches 的尺寸闸门判断
    }

    /**
     * 判定一个元素该不该磨砂，**并说明拒绝的理由**。
     *
     * 为什么要有理由：原来只有 true/false，出问题（比如"输入框没磨砂"）时
     * 只能猜是四道闸里的哪一道拦的 —— 猜了两轮都没猜中。
     * 现在返回空串表示通过，否则返回具体原因，诊断可以直接把它报回来。
     */
    function frostReason(el) {
      if (!el || el.nodeType !== 1 || !el.classList) return 'not-element';
      if (el.classList.contains(FROST_CLASS)) return 'already-frosted';
      // 别动我们自己的背景层和插件界面
      if (backgroundLayerEl && (el === backgroundLayerEl || backgroundLayerEl.contains(el))) return 'our-bg-layer';
      if (el.closest && el.closest("[data-plugin^='dsh-netease']")) return 'our-plugin';
      if (frostMode === 'off') return 'mode-off';
      const r = el.getBoundingClientRect();
      // 下限 80×36：再小的元素本来也看不出磨砂，却各占一个合成层。
      // （原来 48×28，实测多出来的都是这种小不点。）
      if (r.width < 80 || r.height < 36) return 'too-small';
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      let tall = false;
      let big = false;
      if (frostMode === 'layout') {
        // 判据：**常驻版式区域不磨，工具面/浮层才磨**。
        //
        // 为什么用"纵向铺满"：主对话区和左侧栏都是铺满整个视口高度的常驻区域，
        // 而右侧边栏、下侧边栏、抽屉、菜单只占一部分。这个特征既能分开它们，
        // 又不依赖令牌名（令牌名是混用的 —— bg-layer-* 主对话区和浮层都在用，
        // 照名字放行会把主对话区也磨了），也不依赖 DOM 归属（右侧边栏同样在布局树里，
        // 按"在不在 #root 里"会把它一起排除，这正是上一版排太狠的原因）。
        if (r.height >= vh * 0.88) { tall = true; }
        // 面积闸（第二道）：只拦**整页级容器**。backdrop-filter 会把元素变成包含块，
        // 里面的 position:fixed 后代会被重新锚定到它身上（实测把左侧栏锚飞过）。
        //
        // 阈值从 0.5 提到 0.85 的教训：0.5 会连设置抽屉（约 58% 视口）一起拦掉，
        // 而抽屉纵向只占 86%、不是常驻版式区域，本该磨砂 —— 用户看到的现象就是
        // "只磨了抽屉里的组件、抽屉本身没磨"。两闸职责要分清：
        //   高度闸 >=88% 视口高 → 常驻版式区域（左侧栏、主对话区）；
        //   面积闸 >=85% 视口面积 → 整页级容器（兜底，防锚飞）。
        if (r.width * r.height > vw * vh * 0.85) { big = true; }
      }
      if (tall && big) return 'page-container';
      if (tall) return 'full-height-region';
      if (big) return 'full-page-area';
      const cs2 = getComputedStyle(el);
      const key = rgbaKey(cs2.backgroundColor);
      if (!key) return 'bg-transparent-or-unparsable';
      if (!injectedKeys.has(key)) return 'bg-not-a-rewritten-token';
      return '';
    }

    /** 兼容旧签名：只要理由为空串就是该磨。 */
    function frostMatches(el) {
      return frostReason(el) === '';
    }

    /**
     * 诊断：从某元素沿祖先链逐层给出"该不该磨 + 为什么 + 关键样式"。
     * 只读，不做任何写操作。
     */
    function explainFrost(el, levels) {
      const out = [];
      let node = el;
      let i = 0;
      while (node && node !== document.body && i++ < (levels || 6)) {
        const cs = getComputedStyle(node);
        const r = node.getBoundingClientRect();
        out.push({
          tag: (node.tagName || "?").toLowerCase(),
          cls: String(node.className || "").slice(0, 60),
          w: Math.round(r.width),
          h: Math.round(r.height),
          bg: cs.backgroundColor,
          bgImage: String(cs.backgroundImage || "none").slice(0, 90),
          filter: cs.backdropFilter || cs.webkitBackdropFilter || "none",
          radius: cs.borderRadius,
          frosted: node.classList.contains(FROST_CLASS),
          reason: frostReason(node) || "ok",
        });
        node = node.parentElement;
      }
      return { injectedCount: injectedKeys.size, levels: out };
    }

    /**
     * 诊断：把文字相关的真实数值取回来。
     *
     * 为什么必须这样：文字对比度这件事我猜了两轮都猜错方向
     * （先改 alpha、再改框），每次都在"我觉得"的基础上动手。
     * 这个函数只读，把下面三样东西一次报清楚：
     *   · 7 个文字令牌在 :root 上的**原始值**（宿主自己写的）
     *   · 我们**注入的值**（抬色之后的）
     *   · 若干真实文字节点的**计算后颜色与背景色**（浏览器最终算出来的）
     */
    function explainText(sampleEl) {
      const tokens = TEXT_LIFT_TOKENS.map((name) => ({
        name,
        original: readTokenOriginal(name),
        injected: injectedTextDecls[name] || null,
      }));
      const nodes = [];
      const pick = (el) => {
        if (!el) return;
        const cs = getComputedStyle(el);
        nodes.push({
          cls: String(el.className || "").slice(0, 44),
          color: cs.color,
          bg: cs.backgroundColor,
          opacity: cs.opacity,
          w: Math.round(el.getBoundingClientRect().width),
          h: Math.round(el.getBoundingClientRect().height),
        });
      };
      pick(sampleEl);
      // 再抓几个"最像正文"的节点：有文字、且尺寸不大
      if (document.body) {
        let n = 0;
        for (const el of document.body.querySelectorAll("span,p,div,button,label")) {
          if (n >= 8) break;
          const t = (el.textContent || "").trim();
          if (!t || t.length > 40) continue;
          if (el.childElementCount > 0) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 10 || r.height < 8) continue;
          pick(el);
          n++;
        }
      }
      return { bodyBg: document.body ? getComputedStyle(document.body).backgroundColor : null, tokens, nodes };
    }

    /**
     * 诊断：找出页面上**不透明的亮底**元素。
     *
     * 为什么需要它：DSH 本来是浅色主题，面板本来是白的。皮肤把大部分面改成半透明后，
     * 整体变暗了 —— 但有些元素用的令牌没被我们覆盖，它们**还留着原来的白底**，
     * 于是在暗下来的界面里显得像"突然多出来的白块"。用户就是这么看到的
     * （侧栏的「新会话」按钮、会话里的卡片）。
     *
     * 这个函数只读：把亮底元素的类名、底色、尺寸、以及它引用的 CSS 变量报回来，
     * 就能知道该补哪些令牌。
     */
    function findBrightSurfaces(limit) {
      const out = [];
      if (!document.body) return out;
      const cap = limit || 24;
      for (const el of document.body.querySelectorAll("*")) {
        if (out.length >= cap) break;
        const cs = getComputedStyle(el);
        const c = parseCssColor(cs.backgroundColor);
        if (!c || c.a < 0.5) continue; // 半透明的不算"白块"
        const lum = luminanceOf([c.r, c.g, c.b]);
        if (lum < 0.6) continue; // 只挑亮的
        const r = el.getBoundingClientRect();
        if (r.width * r.height < 1600) continue; // 太小的忽略
        out.push({
          tag: (el.tagName || "?").toLowerCase(),
          cls: String(el.className || "").slice(0, 64).replace(/\s+/g, " "),
          bg: cs.backgroundColor,
          lum: Number(lum.toFixed(3)),
          w: Math.round(r.width),
          h: Math.round(r.height),
          // 它自己引用的背景令牌（如果有）
          bgVar: ["--dsw-alias-bg-base", "--dsw-alias-bg-layer-1", "--dsw-alias-bg-layer-2",
                  "--dsw-alias-bg-layer-3", "--dsw-specific-menu", "--dsw-specific-input-major"]
            .filter((v) => cs.getPropertyValue(v).trim())
            .map((v) => v.replace("--dsw-", "") + "=" + cs.getPropertyValue(v).trim())
            .join(" "),
        });
      }
      return out;
    }

    /**
     * 按面积决定模糊幅度。
     *
     * 依据：backdrop-filter 的合成代价与**面积**近似成正比（不是与 blur 半径成正比），
     * 而目视上 18px 和 8px 在大面板上的差别很小 —— 大面板本来就要被磨成一片均匀的底。
     * 实测最大的两块是 1000×221，占全部磨砂面积的 38%。
     */
    function blurForArea(area) {
      if (area > 120000) return "8px";
      if (area > 40000) return "12px";
      return "18px";
    }

    /**
     * 认领表：我们磨过的元素 → 当初算出来的 blur 值。
     *
     * 为什么需要：React 重写 className 会把我们加的 nm-frost 静默抹掉。
     * 有了这张表才能**只针对"被抹掉的"元素**补回来（O(k)，k 约 40），
     * 而不是每次都重扫全文档（那是 getComputedStyle 扫全部元素，很贵）。
     */
    const frostedBlur = new Map()

    /**
     * 极廉价的补挂：只看认领表里的元素是否丢了 nm-frost，不做任何样式查询。
     * 顺带清理已经脱离文档的元素，避免表越积越大。
     */
    function reassertFrost() {
      if (!frostedBlur.size) return 0;
      let n = 0;
      for (const [el, blur] of frostedBlur) {
        if (!el.isConnected) {
          frostedBlur.delete(el);
          continue;
        }
        if (!el.classList.contains(FROST_CLASS)) {
          el.classList.add(FROST_CLASS);
          el.style.setProperty("--nm-blur", blur);
          n += 1;
        }
      }
      return n;
    }

    function frostScan(root) {
      if (!injectedKeys.size || !document.body) return 0;
      // 收 {el, area} 而不是只收 el —— 面积在**读**这一趟就量好，
      // 写那一趟直接拿来用。否则写的时候再读 rect 会强制重排（原来注释里那条教训）。
      const hits = [];
      const self = root && root.nodeType === 1 ? root : null;
      if (self && frostMatches(self)) {
        const r0 = self.getBoundingClientRect();
        hits.push({ el: self, area: r0.width * r0.height });
      }
      const scope = self || document.body;
      if (scope.querySelectorAll) {
        for (const el of scope.querySelectorAll("*")) {
          if (frostMatches(el)) {
            const r1 = el.getBoundingClientRect();
            hits.push({ el, area: r1.width * r1.height });
          }
        }
      }
      // 读和写分两趟：frostMatches 里要读 getBoundingClientRect，
      // 而加 class 会让布局失效 —— 边读边写的话，每个元素都会强制重排一次
      // （几千个节点就是几千次重排）。先收集、后写，整趟只排一次。
      for (const hit of hits) {
        const blur = blurForArea(hit.area);
        hit.el.classList.add(FROST_CLASS);
        hit.el.style.setProperty("--nm-blur", blur);
        // 登记，供 reassertFrost / 属性观察器补挂
        frostedBlur.set(hit.el, blur);
      }
      return hits.length;
    }

    /** 批量重扫（首屏 / 判定变化时用）。增量变更走 MutationObserver 同步路径，不走这里。 */
    function scheduleFrostScan(root) {
      if (!injectedKeys.size) return;
      if (!frostPending) frostPending = [];
      if (root && frostPending.length < 40) frostPending.push(root);
      if (frostTimer) return;
      frostTimer = setTimeout(() => {
        frostTimer = null;
        const targets = frostPending || [];
        frostPending = null;
        if (targets.length) {
          for (const t of targets) frostScan(t);
        } else {
          frostScan(document.body);
        }
      }, 50);
    }

    function ensureFrostObserver() {
      if (frostObserver || typeof MutationObserver === "undefined" || !document.body) return;

      /**
       * 同步扫，**不进定时器**。
       *
       * 这里踩过一个坑，现象是"点开设置之后，面板会有一个变化的渲染过程"：
       * 原来走 350ms 去抖，抽屉打开到被磨砂之间有一段空窗，用户就先看到没磨砂的样子、
       * 再看到磨砂后的样子，观感上就是二次渲染。
       *
       * MutationObserver 的回调在**下一帧绘制之前**执行，所以在这里同步加 class，
       * 浏览器根本没机会画出中间态 —— 这才是"打开即最终形态"。
       *
       * 代价是回调里要干活，所以留了预算上限：一次插入过多节点时适可而止，
       * 剩下的交给下一次变更或定时兜底，避免长任务卡住主线程。
       */
      const BUDGET = 600;
      frostObserver = new MutationObserver((records) => {
        let budget = BUDGET;
        for (const rec of records) {
          // ── 属性变更：只处理"我们磨过、但类被抹掉了"这一种 ──
          //
          // 为什么必须听这个：React 更新时可能整体重写 className，把我们加的
          // nm-frost 连同它自己的类一起写掉。那是**属性**变更，原来的观察器
          // 只听 childList，永远唤不醒 —— 实测抹掉后等 10 秒也不恢复。
          //
          // 只认 frostBlur 里的元素，所以状态栏那种频繁改类的元素不会被误处理。
          if (rec.type === "attributes") {
            const el = rec.target;
            if (el && el.nodeType === 1 && !el.classList.contains(FROST_CLASS)) {
              const blur = frostedBlur.get(el);
              if (blur !== undefined) {
                el.classList.add(FROST_CLASS);
                el.style.setProperty("--nm-blur", blur);
              }
            }
            continue;
          }
          for (const node of rec.addedNodes) {
            if (!node || node.nodeType !== 1) continue;
            budget -= frostScan(node);
            if (budget <= 0) return;
          }
        }
      });
      frostObserver.observe(document.body, {
        childList: true,
        subtree: true,
        // 只监听 class：className 被重写是唯一会"偷走"我们标记的途径
        attributes: true,
        attributeFilter: ["class"],
      });
    }

    function clearFrost() {
      if (frostObserver) {
        frostObserver.disconnect();
        frostObserver = null;
      }
      if (frostTimer) {
        clearTimeout(frostTimer);
        frostTimer = null;
      }
      frostPending = null;
      injectedKeys = new Set();
      removeAllFrost();
    }

    /**
     * 应用令牌覆写。
     *
     * 这里有三件事**必须解耦**——早期版本把它们耦在一起，直接导致
     * 「界面确实透明了，但背景被不透明白底整个盖住」这种自相矛盾的现象：
     *   1) 令牌不一定在 :root 上 → 多节点查找（readToken）；
     *   2) 令牌一个都读不到时**绝不能提前返回** → body 透明那条规则必须照写；
     *   3) 全读不到就退化为扫描真实存在的背景类变量，避免 DSH 改名即整体失效。
     */
    /**
     * 需要抬亮的文字令牌。名字是从 DSH 的 app.asar 里挖出来的（出现频次：
     * primary 385 / tertiary 367 / secondary 281 / caption 102 / dimmed 14 / quaternary 2）。
     *
     * 为什么要抬文字、而不是继续压背景：把用户截图逐像素量过 —— 背景**平均亮度只有
     * 0.05~0.11**，已经很暗了；真正读不清的是 DSH 的次级灰字（L≈0.55），它在
     * 「面板 alpha 0.45 + 背景最亮处」上的对比度只有 2.8:1，远低于 AA 的 4.5:1。
     *
     * 抬文字比把面板做成不透明更"省背景"：文字变亮就能达标，背景可以继续透。
     * 硬约束是**保持原有明暗次序**（primary > secondary > tertiary > caption），
     * 只抬高地板、且不越过 primary —— 否则层级会塌成一坨同亮度的字。
     */
    const TEXT_LIFT_TOKENS = [
      // primary 也一起抬：它通常最亮、抬了也不变；但如果它本身偏暗（说明这套主题
      // 的整条文字梯子都低），那它就是最该被抬的那个。这是给整套梯子兜底。
      "--dsw-alias-label-primary",
      "--dsw-alias-label-primary-dimmed",
      "--dsw-alias-label-secondary",
      "--dsw-alias-label-tertiary",
      "--dsw-alias-label-quaternary",
      "--dsw-alias-label-caption",
      "--dsw-alias-label-dimmed",
    ];

    /**
     * 解析 CSS 颜色，**保留原始 alpha**。
     *
     * 这一步是整段逻辑的关键，也是第一版的失败原因：
     * DSH 的次级文字令牌很可能是**带 alpha 的白色**（如 rgba(255,255,255,.35)）。
     * 这种写法颜色的 RGB 亮度是 1.0，但实际渲染出来只有 0.35。
     * 第一版按 RGB 判亮度，于是判定"已经够亮、无需处理"，一点没改 —— 现象就是
     * 正文（不带 alpha 的令牌）被修好了，侧栏那几项纹丝不动。
     */
    function parseCssColor(cssColor) {
      try {
        const probe = document.createElement("div");
        probe.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:0;height:0;color:" + cssColor;
        document.body.appendChild(probe);
        const norm = getComputedStyle(probe).color;
        probe.remove();
        const m = norm.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const p = m[1].split(",").map((s) => parseFloat(s));
        if (p.length < 3) return null;
        return { r: p[0], g: p[1], b: p[2], a: p.length >= 4 ? p[3] : 1 };
      } catch (e) {
        return null;
      }
    }

    function luminanceOf(rgb) {
      return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    }

    /** 朝白色插值把颜色提到目标亮度（保持色相）。已经够亮就返回 null。 */
    function liftToLuminance(rgb, targetLum) {
      const lum = luminanceOf(rgb);
      if (lum >= targetLum) return null;
      const t = (targetLum - lum) / (1 - lum);
      const out = rgb.map((v) => Math.round(v + (255 - v) * t));
      return "rgb(" + out.join(",") + ")";
    }

    /**
     * 假定的底：文字底下那层"看起来多亮"。
     *
     * 原来是 0.06（DSH 深色面板）。**加了沉浸背景之后这个假定不成立了** ——
     * 面板被改成半透明，底下是模糊封面，亮的地方能到 0.7 左右。
     * 按 0.06 折算，会把"其实很淡的字"算成"够亮了"，于是不抬。
     * 现在取一个"半透明面板压在模糊封面上"的现实量级。
     */
    const ASSUMED_BG_LUM = 0.26;

    /**
     * 把一个文字令牌抬到"不透明 + 亮度不低于 floorLum"。
     *
     * 有效亮度 = alpha × 颜色亮度 + (1 - alpha) × 底色亮度，也就是"看起来多亮"。
     *
     * **为什么不再靠抬 alpha**：DSH 的次级文字常写成 rgba(255,255,255,.35) 这种半透明白。
     * 在固定底色上抬 alpha 确实够用，但我们的面板是半透明的、底下是**模糊封面** ——
     * 背景亮度是变量。半透明浅字压在亮处会直接消失，抬多少 alpha 都救不了
     * （白字压白底，alpha 再高也是白）。所以一律输出**不透明**色：
     * 层级改由颜色的亮度区分（primary 最亮、caption 最暗），不再靠透明度。
     *
     * 目标亮度取"原本看起来的有效亮度"与地板里的大者，因此原有的明暗次序不会被压平。
     */
    /**
     * 暗底可读区间：主文字最亮，caption 最暗，但都在"暗底上看得清"的范围里。
     *
     * 实测宿主这套是**浅色主题**：文字原色从 #0f1115(近黑) 一路到 #e1e5ee(近白)。
     * 加了沉浸背景之后，承载文字的面变成暗的 —— 那条"越主越黑"的梯子必须**整体翻过来**。
     *
     * 踩过的坑：原逻辑是"亮度不足地板的一律抬到地板"，结果 primary/secondary/tertiary/
     * caption 全被抬到 ~0.70（实测 rgb 178/176/174/176），**层级塌成一坨同亮度的字**。
     * 所以这里不做阈值，做**保序映射**：原亮度越小（越主）→ 目标越亮。
     */
    const DARK_TEXT_TOP = 0.88; // 最主文字的目标亮度（近白）
    const DARK_TEXT_SPAN = 0.42; // 从最主到最次的落差

    function liftTextToken(raw, floorLum) {
      void floorLum; // 保留参数以免改动调用点；新逻辑不再用统一地板
      const c = parseCssColor(raw);
      if (!c) return null;
      const colorLum = luminanceOf([c.r, c.g, c.b]);
      const effLum = c.a * colorLum + (1 - c.a) * ASSUMED_BG_LUM;
      const solid = "rgb(" + Math.round(c.r) + "," + Math.round(c.g) + "," + Math.round(c.b) + ")";
      // 目标：把"原本看起来多亮"翻到暗底区间。原亮度 0.07(近黑) → 0.85；0.89(近白) → 0.51
      const target = DARK_TEXT_TOP - DARK_TEXT_SPAN * Math.min(1, Math.max(0, effLum));
      // 已经不透明、且和目标接近（差 < 0.04）→ 不动，避免每轮都重写
      if (c.a >= 0.999 && Math.abs(colorLum - target) < 0.04) return null;
      return liftToLuminance([c.r, c.g, c.b], target) || solid;
    }

    function applyAmbientTokens(alpha, opts) {
      frostMode = (opts && opts.frost) || 'layout'
      // 一律用 readTokenOriginal：读自己写出去的值会让第二轮 apply 把第一轮的成果丢掉
      const raws = AMBIENT_TOKENS.map((name) => [name, readTokenOriginal(name)]);
      const decls = [];
      // 变透明：全部 7 个令牌都参与
      const injected = new Set();
      // 磨砂：**只有值得磨的那些**参与（见 isFrostWorthyToken）。
      // 两个集合刻意分开 —— 页面底/侧栏要透明但不要磨砂。
      const frosty = new Set();
      for (const pair of raws) {
        if (!pair[1]) continue;
        // 一视同仁：所有面用同一个 alpha。
        // （曾经试过"承载文字的层更实一点"，结果面板变成灰白 milky、反而更难看，
        //   文字也并没救回来 —— 用户明确说框和磨砂都没问题，要改的是文字颜色。）
        const rgba = toRgba(pair[1], alpha);
        if (rgba) {
          decls.push(pair[0] + ":" + rgba + "!important");
          const k = rgbaKey(rgba);
          if (k) {
            injected.add(k);
            if (isFrostWorthyToken(pair[0])) frosty.add(k);
          }
        }
      }
      let usedFallback = false;
      if (!decls.length) {
        for (const name of discoverBgTokens(24)) {
          if (OVERLAY_NAME_RE.test(name)) continue;
          const rgba = toRgba(readTokenOriginal(name), alpha);
          if (rgba) {
            decls.push(name + ":" + rgba + "!important");
            const k = rgbaKey(rgba);
            if (k) {
              injected.add(k);
              // 兜底路径同样只磨值得磨的：结构层不磨
              if (isFrostWorthyToken(name)) frosty.add(k);
            }
          }
        }
        usedFallback = decls.length > 0;
      }
      // 文字抬亮。这里也必须用 readTokenOriginal —— 用 readToken 会读到上一轮
      // 自己写的"已抬亮"值，于是判定"不用改"，把抬亮整个丢掉（就是"几秒后变暗"）。
      const primary = parseCssColor(readTokenOriginal("--dsw-alias-label-primary"));
      // primary 也可能带 alpha，同样要折算成"看起来多亮"；它自己偏暗也一起抬，
      // 这样整条梯子的地板才有意义（否则一套暗主题会把地板一起拖下去）。
      const primaryEffective = primary
        ? primary.a * luminanceOf([primary.r, primary.g, primary.b]) + (1 - primary.a) * ASSUMED_BG_LUM
        : 0.9;
      // 地板：0.62 是"底色假定 0.06"那版留下的数，在"半透明面板 + 模糊封面"下太低 ——
      // 0.57 的亮度压在封面亮处（≈0.7）上仍然读不清。抬到 0.76（乘 0.92 后约 0.70），
      // 同时与 primary 保持约 0.2 的亮度差，明暗层级不会被压平。
      const floor = Math.min(0.92, Math.max(primaryEffective, 0.76) * 0.92);
      const lifts = [];
      for (const name of TEXT_LIFT_TOKENS) {
        const raw = readTokenOriginal(name);
        if (!raw) continue;
        const lifted = liftTextToken(raw, floor);
      if (lifted) injectedTextDecls[name] = { raw, floor: Number(floor.toFixed(3)), lifted };
        if (lifted) {
          decls.push(name + ":" + lifted + "!important");
          lifts.push(name + "=" + raw + "→" + lifted);
        }
      }
      // 兜底补挂：签名没变也要做，否则"类被抹掉"这件事永远等不到修复。
      // 成本是 O(认领表大小)，不做任何 getComputedStyle / getBoundingClientRect。
      reassertFrost();
      const sig =
        alpha + "|" + raws.map((p) => p[1]).join("|") + "|" + decls.length +
        (usedFallback ? "|fb" : "") + "|" + lifts.join(",");
      if (sig === ambientSig) return;
      ambientSig = sig;
      ambientFoundTokens = decls.length;
      ambientFallback = usedFallback;
      ambientLiftedText = lifts.length;
      // 最后一条 background-color:transparent 是所有情况的保命项：
      // 图层是 z-index:-1，按 CSS 绘制顺序会被 body 自身的不透明背景整个盖住
      // （本机实测 body 背景 = rgb(255,255,255)，纯白）。
      ensureAmbientStyle().textContent =
        "body,#root,#app,#dsh-root{" + decls.join(";") + (decls.length ? ";" : "") + "background-color:transparent!important}";
      // 令牌生效后再做玻璃化：扫描靠"算出来的 background-color 命中注入值"，
      // 必须等样式应用完再扫，否则读到的还是 DSH 原来的不透明色。
      injectedKeys = frosty;
      // 压暗那些"写死的浅色面"（代码块 / 气泡 / 主按钮）—— 它们不是变量，只能靠规则覆盖
      ensureSurfaceStyle();
      // 判据变了（调了透明度滑杆 / 换了主题）就得把旧的磨砂全部撤下来重扫 ——
      // 只加不减的话，上一轮误磨的面会一直挂着，正是"侧栏被锚飞"那种事故的温床。
      removeAllFrost();
      if (frosty.size) {
        ensureFrostObserver();
        scheduleFrostScan(document.body);
      }
    }

    /** 只撤 class，不动观察器（判据更新时用）。 */
    function removeAllFrost() {
      if (!document.body) return;
      for (const el of document.querySelectorAll("." + FROST_CLASS)) {
        el.classList.remove(FROST_CLASS);
        el.style.removeProperty("--nm-blur");
      }
      // 不再"认领"这些元素：判据变了就该整体重扫，不能靠补挂把旧结论捡回来
      frostedBlur.clear();
      // 丢弃我们自己这批摘 class 产生的 mutation 记录 ——
      // 否则属性观察器会在下一拍把它们又挂回去，和"判据变了要重扫"打架。
      if (frostObserver) {
        try {
          frostObserver.takeRecords();
        } catch (err) {
          /* 非致命 */
        }
      }
    }

    function clearAmbientTokens() {
      ambientSig = "";
      // 原始值缓存也一起清掉：清空样式之后 DSH 的令牌回到原值，
      // 下次 apply 必须重新采一遍，否则主题切换后会一直用旧主题的缓存。
      origTokenCache = null;
      clearFrost();
      if (ambientStyleEl) ambientStyleEl.textContent = "";
      removeSurfaceStyle();
    }

  // ── 对外接口 ──────────────────────────────────────────────────────
  return {
    /**
     * 诊断用：从某元素沿祖先链给出"该不该磨砂 + 为什么 + 关键样式"。
     * 只读。它存在的理由：输入框磨砂那件事猜了两轮都没中，
     * 而原先的 frostMatches 只回 true/false，问不出是哪一道闸拦的。
     */
    explainFrost,
    /** 诊断用：列出页面上不透明的亮底元素。只读。 */
    findBrightSurfaces,
    /** 诊断用：文字令牌的原值/注入值 + 若干真实文字节点的计算后颜色。只读。 */
    explainText,
    /**
     * 登记背景图层。它由外面创建（要用 React 渲染），这里只记住它，
     * 用途是"别把我们自己的图层也磨砂了"这条判断。
     */
    setBackgroundLayer(el) {
      backgroundLayerEl = el
    },
    /** 应用皮肤：DSH 面板改半透明 + 抬亮偏暗文字 + 给浮层加玻璃。 */
    applySkin: applyAmbientTokens,
    /** 撤销皮肤：令牌还原、文字还原、玻璃全部摘掉。 */
    clearSkin: clearAmbientTokens,
    /** 卸载时把注入的样式节点也摘掉（teardown 用）。 */
    disposeStyle() {
      if (ambientStyleEl) {
        try {
          ambientStyleEl.remove()
        } catch (err) {
          /* 非致命 */
        }
        ambientStyleEl = null
      }
    },
  }
})()
