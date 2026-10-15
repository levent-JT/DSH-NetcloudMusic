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

    let ambientStyleEl = null;
    function ensureAmbientStyle() {
      if (ambientStyleEl && ambientStyleEl.isConnected) return ambientStyleEl;
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
      if (r.width < 48 || r.height < 28) return 'too-small'; // 太小不值得磨砂，省掉大量无用合成层
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

    function frostScan(root) {
      if (!injectedKeys.size || !document.body) return 0;
      const hits = [];
      const self = root && root.nodeType === 1 ? root : null;
      if (self && frostMatches(self)) hits.push(self);
      const scope = self || document.body;
      if (scope.querySelectorAll) {
        for (const el of scope.querySelectorAll("*")) {
          if (frostMatches(el)) hits.push(el);
        }
      }
      // 读和写分两趟：frostMatches 里要读 getBoundingClientRect，
      // 而加 class 会让布局失效 —— 边读边写的话，每个元素都会强制重排一次
      // （几千个节点就是几千次重排）。先收集、后写，整趟只排一次。
      for (const el of hits) el.classList.add(FROST_CLASS);
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
          for (const node of rec.addedNodes) {
            if (!node || node.nodeType !== 1) continue;
            budget -= frostScan(node);
            if (budget <= 0) return;
          }
        }
      });
      frostObserver.observe(document.body, { childList: true, subtree: true });
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

    /** 假定的底：DSH 深色面板的亮度。用来把 alpha 折算成"看起来多亮"。 */
    const ASSUMED_BG_LUM = 0.06;

    /**
     * 把一个文字令牌抬到有效亮度不低于 floorLum。
     *
     * 有效亮度 = alpha × 颜色亮度 + (1 - alpha) × 底色亮度，也就是"看起来多亮"。
     * 两条路：
     *   · 颜色本身不够亮 → 朝白插值把颜色抬上去；
     *   · 颜色够亮但 alpha 太低（DSH 的常见写法）→ **抬 alpha**，色相不动。
     * 后者才是这里真正起作用的那条，而且保住了令牌"半透明文字"的语义。
     */
    function liftTextToken(raw, floorLum) {
      const c = parseCssColor(raw);
      if (!c) return null;
      const colorLum = luminanceOf([c.r, c.g, c.b]);
      const effLum = c.a * colorLum + (1 - c.a) * ASSUMED_BG_LUM;
      if (effLum >= floorLum) return null;
      let a = (floorLum - ASSUMED_BG_LUM) / (colorLum - ASSUMED_BG_LUM);
      if (!Number.isFinite(a) || a >= 1) {
        // 光靠 alpha 到不了目标（颜色本身太暗）→ 先抬颜色，再全不透明
        return liftToLuminance([c.r, c.g, c.b], floorLum);
      }
      a = Math.max(c.a, a);
      return "rgba(" + Math.round(c.r) + "," + Math.round(c.g) + "," + Math.round(c.b) + "," + a.toFixed(3) + ")";
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
      const floor = Math.min(0.9, Math.max(primaryEffective, 0.62) * 0.92);
      const lifts = [];
      for (const name of TEXT_LIFT_TOKENS) {
        const raw = readTokenOriginal(name);
        if (!raw) continue;
        const lifted = liftTextToken(raw, floor);
        if (lifted) {
          decls.push(name + ":" + lifted + "!important");
          lifts.push(name + "=" + raw + "→" + lifted);
        }
      }
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
      for (const el of document.querySelectorAll("." + FROST_CLASS)) el.classList.remove(FROST_CLASS);
    }

    function clearAmbientTokens() {
      ambientSig = "";
      // 原始值缓存也一起清掉：清空样式之后 DSH 的令牌回到原值，
      // 下次 apply 必须重新采一遍，否则主题切换后会一直用旧主题的缓存。
      origTokenCache = null;
      clearFrost();
      if (ambientStyleEl) ambientStyleEl.textContent = "";
    }

  // ── 对外接口 ──────────────────────────────────────────────────────
  return {
    /**
     * 诊断用：从某元素沿祖先链给出"该不该磨砂 + 为什么 + 关键样式"。
     * 只读。它存在的理由：输入框磨砂那件事猜了两轮都没中，
     * 而原先的 frostMatches 只回 true/false，问不出是哪一道闸拦的。
     */
    explainFrost,
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
