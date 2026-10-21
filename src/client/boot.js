/**
 * 启动渲染动画（boot.js）—— 独立分片，与背景层/皮肤层**零耦合**。
 *
 * ── 设计约束（用户明确要求）──────────────────────────────────────────
 * 1. 这是插件的一部分，必须能一键卸载、有开关。所以：
 *    · 自己建 DOM、自己管定时器、自己清自己 —— 不依赖任何其他分片
 *    · 对外只暴露 BootFx.start() / BootFx.stop()，stop() 必须幂等且清干净
 * 2. 宁可重复造轮子，也不要跟背景层纠缠：
 *    · 这里**不复用** SkinLayers / DshSkin，连工具函数都自己写一份
 *    · 动画只作用于**我们自己加的遮罩层**，从不改 DSH 元素的任何样式
 * 3. 绝不能把 DSH 拖崩。三层保险：
 *    ① 每个阶段都包在 try/catch 里，单段失败不影响其余
 *    ② 硬超时：无论发生什么，DURATION 之后强制收尾并移除本层
 *    ③ 任何异常 → 立刻跳过动画（移除本层），绝不让界面停在被遮住的状态
 *
 * ── 遮罩反推（为什么敢说不碰 DSH）─────────────────────────────────────
 * 「主界面分层出现」这个效果，**不是**去控制 DSH 元素的 opacity —— 那才是真风险
 * （DSH 重渲染会冲掉我们加的 class，任何一处漏恢复就是元素永久不可见）。
 *
 * 这里的做法是：整屏盖一块不透明的遮罩，然后按"主界面各区域的真实位置"
 * 用 clip-path 挖出若干条带，逐条擦除。看起来像元素分层浮现，
 * 但遮罩下面的 DSH 元素**一个字节都没被改过** —— 最坏情况只是遮罩没擦完（有超时兜底），
 * 而不是白屏。
 */
const BootFx = (() => {
  // ── 常量（只在本分片内可见）──────────────────────────────────────────
  const LAYER_ID = "nm-bootfx";
  const Z = 2147482000; // 低于 jt-startup 的 canvas(2147483000)，高于所有正常界面

  // 时间轴（ms）。用户选定的是"先压暗"那版滤镜，主界面用"快门"揭开。
  const T = {
    hold: 260,        // 高清封面停留
    filter: 1250,     // 滤镜推进（模糊 + 压暗 + 染色 + 亮度封顶）
    lyricAt: 620,     // 歌词开始淡入
    shutterAt: 1400,  // 主界面开始揭开
    band: 90,         // 每条带的错开（10 条 → 810ms）
    bandDur: 420,     // 单条带的擦除时长
    // total 必须晚于「最后一条带开始 + bandDur」：1400 + 9*90 + 420 ≈ 2630
    total: 2800,      // 全部结束
    hardCap: 3600,    // 硬上限：到点无条件清掉这一层
  };

  // ── 状态 ──────────────────────────────────────────────────────────────
  let layer = null;      // 根层
  let heroEl = null;     // 封面
  let dimEl = null;      // 压暗
  let tintEl = null;     // 染色
  let veilEl = null;     // 亮度封顶
  let lyrEl = null;      // 歌词
  let maskEl = null;     // 擦除遮罩
  let timers = [];
  let running = false;
  let disposed = false;

  function now() { return Date.now(); }

  function clearTimers() {
    for (const id of timers) {
      try { clearTimeout(id); } catch (err) { /* 忽略 */ }
    }
    timers = [];
  }

  function later(ms, fn) {
    const id = setTimeout(function () {
      try { fn(); } catch (err) { fail("stage", err); }
    }, ms);
    timers.push(id);
    return id;
  }

  /** 出任何问题都走这里：立刻收尾并移除本层，绝不让界面停在被遮住的状态。 */
  function fail(where, err) {
    try {
      // ⚠️ 这层 typeof 判断是**故意的**：reportClientError 由 main.js 定义，
      // 本分片靠 PARTS 顺序拿到它。但那是个隐式依赖 —— 万一将来顺序变了、
      // 或有人单独复用这个文件，这里就会 ReferenceError。
      // 而 fail() 是错误处理路径，它自己抛错会打断收尾（界面就停在被遮住的状态）。
      // 所以宁可写这一行冗余判断。
      if (typeof reportClientError === "function") {
        reportClientError("bootfx." + where, err instanceof Error ? err : new Error(String(err)));
      } else if (typeof console !== "undefined" && console.warn) {
        console.warn("[nm-bootfx] " + where + ": " + (err && err.message ? err.message : err));
      }
    } catch (e) { /* 上报失败也不能影响收尾 */ }
    try { stop(); } catch (e) { /* 同上 */ }
  }

  // ── 建层 ──────────────────────────────────────────────────────────────
  function build(cover, opts) {
    const root = document.createElement("div");
    root.id = LAYER_ID;
    // 关键：pointer-events:none —— 动画期间用户也能点（避免"卡住不能操作"的观感），
    // 以及万一我们挂了，界面仍然可用。
    root.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:" + Z,
      "pointer-events:none",
      "overflow:hidden",
      "background:#05060a",
      "opacity:1",
      "transition:none",
    ].join(";");

    // ① 封面：全屏、出血、**不做任何缩放**（用户明确要求）
    //    inset:-12% 是出血：blur 的边缘会发虚，出血让虚边落到裁切框外。
    //
    //    没有封面时用**纯渐变**兜底（和皮肤同一套冷蓝→微紫配色）。
    //    渐变同样有"锐利 → 模糊"的推进，观感一致，只是内容不是照片。
    const hero = document.createElement("div");
    const heroBase = [
      "position:absolute",
      "inset:-12%",
      "background-size:cover",
      "background-position:center center",
      "filter:none",
      "will-change:filter",
    ];
    if (cover) {
      heroBase.push("background-image:url(\"" + String(cover).replace(/"/g, "") + "\")");
    } else {
      heroBase.push(
        "background:linear-gradient(155deg,#0a1020 0%,#131a33 32%,#1d1b3a 58%,#0c0a18 100%)"
      );
    }
    hero.style.cssText = heroBase.join(";");

    // ② 压暗（两条渐变，和背景层同款参数）
    const dim = document.createElement("div");
    dim.style.cssText = "position:absolute;inset:0;opacity:0;will-change:opacity";
    dim.style.background =
      "linear-gradient(180deg,rgba(4,7,18,.72) 0%,rgba(8,11,28,.45) 45%,rgba(12,8,26,.66) 100%)," +
      "linear-gradient(270deg,rgba(2,4,12,.62) 0%,rgba(2,4,12,.24) 36%,rgba(2,4,12,0) 62%)";

    // ③ 主色染色
    const tint = document.createElement("div");
    tint.style.cssText = "position:absolute;inset:0;opacity:0;will-change:opacity";
    const tintColor = opts.tint || "rgba(96,120,180,.42)";
    tint.style.background =
      "radial-gradient(ellipse 62% 58% at 20% 16%," + tintColor + ",transparent 68%)," +
      "radial-gradient(ellipse 56% 62% at 86% 84%," + tintColor + ",transparent 72%)";

    // ④ 亮度封顶
    const veil = document.createElement("div");
    veil.style.cssText = "position:absolute;inset:0;opacity:0;will-change:opacity";
    veil.style.background = "rgba(4,6,12," + (opts.veil || 0.3) + ")";

    // ④.5 没封面时（新用户）在渐变上叠一行说明，避免"一片灰不知道在干嘛"
    if (!cover) {
      const hint = document.createElement("div");
      hint.style.cssText = [
        "position:absolute",
        "left:0",
        "right:0",
        "top:0",
        "bottom:0",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "flex-direction:column",
        "gap:10px",
        "text-align:center",
      ].join(";");
      const t1 = document.createElement("div");
      t1.style.cssText = "font-size:13px;letter-spacing:3px;color:rgba(255,255,255,.5);text-transform:uppercase";
      t1.textContent = "DeepSeek Harness";
      const t2 = document.createElement("div");
      t2.style.cssText = "font-size:11.5px;letter-spacing:1px;color:rgba(255,255,255,.3)";
      t2.textContent = "放一首歌，这里就会变成封面";
      hint.appendChild(t1);
      hint.appendChild(t2);
      root.appendChild(hint);
    }

    // ⑤ 歌词（有歌才有）
    let lyr = null;
    if (opts.lines && opts.lines.length) {
      lyr = document.createElement("div");
      lyr.style.cssText = [
        "position:absolute",
        "inset:0",
        "display:flex",
        "flex-direction:column",
        "justify-content:center",
        "align-items:center",
        "gap:9px",
        "padding:0 40px",
        "opacity:0",
        "will-change:opacity",
      ].join(";");
      const cap = document.createElement("div");
      cap.style.cssText = "font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,.42);margin-bottom:10px";
      cap.textContent = (opts.title || "") + (opts.artist ? " · " + opts.artist : "");
      lyr.appendChild(cap);
      const mid = Math.min(opts.lines.length - 1, Math.floor(opts.lines.length / 2));
      for (let i = 0; i < opts.lines.length; i++) {
        const ln = document.createElement("div");
        const on = i === mid;
        ln.style.cssText = [
          "font-size:" + (on ? 21 : 18) + "px",
          "font-weight:600",
          "color:" + (on ? "#fff" : "rgba(255,255,255,.2)"),
          "text-shadow:0 2px 20px rgba(0,0,0,.5)",
          "white-space:nowrap",
        ].join(";");
        ln.textContent = opts.lines[i] || "…";
        lyr.appendChild(ln);
      }
    }

    // ⑥ 擦除遮罩：负责"主界面分层浮现"。
    //
    // ⚠️ 这里的设计容易写错，先说清楚：
    //   遮罩**本体必须从一开始就透明**，只由若干"条带"负责遮挡。
    //   如果本体是不透明的黑、条带再淡出，那么条带位置露出来的也是黑底 ——
    //   「逐条揭示」根本看不见，只有最后整体淡出才有效果。
    //
    // 所以：本体 opacity:0（不遮），条带各自 opacity:1（各遮一块）。
    // 每条带淡出 = 那一块区域浮现。
    const mask = document.createElement("div");
    mask.style.cssText = "position:absolute;inset:0;pointer-events:none;opacity:0";

    root.appendChild(hero);
    root.appendChild(dim);
    root.appendChild(tint);
    root.appendChild(veil);
    if (lyr) root.appendChild(lyr);
    root.appendChild(mask);

    return { root, hero, dim, tint, veil, lyr, mask };
  }

  /**
   * 把整屏切成若干横条，每条自己遮一块。
   *
   * 为什么按整屏切而不是只遮几个元素区域：
   * 只遮 3 个区域的话，其余地方（消息列表、空白）从一开始就露着 ——
   * 「分层浮现」的效果就没了，看起来只是三块地方亮了。
   * 整屏切片才能做到"从上到下逐条拉开"。
   *
   * 切片用**元素**而不是 clip-path：每条是一个绝对定位的 div，
   * 独立做 opacity 过渡，彼此不干扰，也不依赖复杂的几何计算。
   */
  function makeBands(mask, count) {
    const h = window.innerHeight || 800;
    const n = Math.max(3, Math.min(14, count | 0));
    const bandH = Math.ceil(h / n) + 1; // +1 避免相邻条之间有 1px 缝
    const bands = [];
    for (let i = 0; i < n; i++) {
      const b = document.createElement("div");
      b.style.cssText = [
        "position:absolute",
        "left:0",
        "width:100%",
        "top:" + (i * (bandH - 1)) + "px",
        "height:" + bandH + "px",
        "background:#05060a",
        "opacity:1",
        "will-change:opacity",
      ].join(";");
      mask.appendChild(b);
      bands.push(b);
    }
    return bands;
  }

  // ── 对外：开始 ────────────────────────────────────────────────────────
  /**
   * @param {Object} opts
   * @param {string} opts.cover   封面 URL（必须）
   * @param {number} [opts.lum]   封面亮度 0..1（缺省 0.35）
   * @param {string} [opts.tint]  染色色值
   * @param {string} opts.title   曲名
   * @param {string} opts.artist  歌手
   * @param {string[]} opts.lines 歌词行
   */
  function start(opts) {
    if (disposed || running) return false;
    const o = opts || {};
    // 注意：**没有封面也播** —— 用渐变兜底。
    // 全新安装的用户 localStorage 里没有续播信息，拿不到封面；
    // 如果这里直接 return，这个功能对他们等于不存在。
    const hasCover = !!o.cover;

    try {
      // 清理可能残留的上一份（比如上一次异常退出）
      removeLayer();

      const built = build(o.cover, o);
      layer = built.root;
      heroEl = built.hero;
      dimEl = built.dim;
      tintEl = built.tint;
      veilEl = built.veil;
      lyrEl = built.lyr;
      maskEl = built.mask;

      document.body.appendChild(layer);
      running = true;

      // 计算终态滤镜（这就是"我们的材质"）
      const lum = typeof o.lum === "number" ? Math.min(1, Math.max(0, o.lum)) : 0.35;
      // 有封面：标准滤镜（和背景层同一套参数）
      // 没封面（渐变兜底）：模糊轻一些 —— 纯色大范围模糊会糊成一片死灰，看不出层次
      const finalFilter = hasCover
        ? "blur(44px) saturate(118%) brightness(" + (1 - lum * 0.32).toFixed(3) + ")"
        : "blur(18px) saturate(110%) brightness(.92)";

      // ── 阶段 1：高清封面停留（什么都不做，让它保持锐利）──
      // ── 阶段 2：先压暗 → 再模糊（用户选的这一版）──
      later(T.hold, function () {
        // 亮度先落
        dimEl.style.transition = "opacity 380ms cubic-bezier(.4,0,.2,1)";
        veilEl.style.transition = "opacity 380ms cubic-bezier(.4,0,.2,1)";
        dimEl.style.opacity = "1";
        veilEl.style.opacity = "1";
      });
      later(T.hold + 240, function () {
        // 模糊随后跟上
        heroEl.style.transition = "filter " + T.filter + "ms cubic-bezier(.22,.61,.36,1)";
        heroEl.style.filter = finalFilter;
        tintEl.style.transition = "opacity 900ms cubic-bezier(.22,.61,.36,1)";
        tintEl.style.opacity = "1";
      });
      if (lyrEl) {
        later(T.lyricAt, function () {
          lyrEl.style.transition = "opacity 700ms cubic-bezier(.4,0,.2,1)";
          lyrEl.style.opacity = "1";
        });
      }

      // ── 阶段 3：快门揭开（只动我们自己的遮罩，从不碰 DSH 元素）──
      later(T.shutterAt, function () {
        // 整屏切成 10 条，从上到下逐条淡出 = "快门拉开"
        const bands = makeBands(maskEl, 10);
        for (let i = 0; i < bands.length; i++) {
          (function (b, d) {
            later(d, function () {
              b.style.transition = "opacity " + T.bandDur + "ms cubic-bezier(.3,.8,.3,1)";
              b.style.opacity = "0";
            });
          })(bands[i], i * T.band);
        }
      });

      // ── 收尾 ──
      later(T.total, function () { stop(); });

      // ── 保险 3：硬上限，无论如何都清掉 ──
      later(T.hardCap, function () {
        if (running) fail("hardcap", new Error("启动动画超过硬上限，强制收尾"));
      });

      return true;
    } catch (err) {
      fail("start", err);
      return false;
    }
  }

  // ── 对外：停止 / 清理 ────────────────────────────────────────────────
  function removeLayer() {
    // 按 id 清理**所有**残留（不只 layer 变量指向的那个）——
    // 上次异常退出、或热重载都可能在 body 上留下孤儿
    try {
      const all = document.querySelectorAll("#" + LAYER_ID);
      for (let i = 0; i < all.length; i++) {
        const n = all[i];
        if (n.parentNode) n.parentNode.removeChild(n);
      }
    } catch (err) { /* 清不掉也不能抛 */ }
    layer = null;
    heroEl = dimEl = tintEl = veilEl = lyrEl = maskEl = null;
  }

  /**
   * 停止并清理。**幂等**：重复调用、未开始时调用都安全。
   *
   * 注意别在这里顺手调 removeLayer() —— 它会按 id 删掉**所有**残留，
   * 包括我们正在淡出的那一层，那样淡出就没意义了。
   * 所以顺序是：先把当前层摘出来单独淡出，再清理**其它**孤儿层。
   */
  function stop() {
    running = false;
    clearTimers();
    try {
      const el = layer;
      layer = null;
      heroEl = dimEl = tintEl = veilEl = lyrEl = maskEl = null;

      if (el && el.parentNode) {
        // 先淡出再移除，避免"啪"一下消失。
        // 用独立的定时器（不进 timers 数组，避免被下一次 clearTimers 掐掉）。
        try {
          el.style.transition = "opacity 220ms ease";
          el.style.opacity = "0";
        } catch (e) { /* 设不了样式就直接删 */ }
        setTimeout(function () {
          try { if (el.parentNode) el.parentNode.removeChild(el); } catch (e) { /* 忽略 */ }
        }, 240);
      }

      // 清理**其它**残留（上次异常退出 / 热重载留下的），跳过正在淡出的 el
      try {
        const all = document.querySelectorAll("#" + LAYER_ID);
        for (let i = 0; i < all.length; i++) {
          const n = all[i];
          if (n === el) continue;
          if (n.parentNode) n.parentNode.removeChild(n);
        }
      } catch (err) { /* 清不掉也不能抛 */ }
    } catch (err) { /* stop 绝不能抛 */ }
  }

  /** 插件卸载时调用：停止并标记为已废弃，之后 start 直接返回 false。 */
  function dispose() {
    disposed = true;
    stop();
  }

  return {
    start,
    stop,
    dispose,
    /** 供设置页显示 / 调试用 */
    isRunning: function () { return running; },
  };
})();
