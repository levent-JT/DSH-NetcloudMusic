/**
 * 启动渲染动画（boot.js）—— 独立分片，与背景层/皮肤层零耦合。
 *
 * ── 用户在 2026-10-21 晚期纠正的核心认知（这段最重要，别删）──────────
 *
 * 我前面几版全错在同一个地方：**自己另做了一套渲染**。
 *   · 自己画封面层、自己调暗度/模糊、自己画居中歌词
 *   · 然后要"甩掉"这一层才能露出真实界面 → 衔接必然跳
 *
 * 用户原话："我们的目标是渲染出整个主页面，本质流程是一点点渲染主页面的
 * 不同组件，目标是在视觉上保持一致。"
 *
 * ⇒ 正确做法（本文件实现的）：
 *   1. **直接驱动真实的 `.nm-amb` 背景层** —— 它本来就是最终状态。
 *      启动时把它的 blur 从 0 动画回 44、dim/tint/veil 从 0 动画回 1、
 *      真实歌词从透明到可见。**不新建任何背景**，所以不存在"衔接"问题。
 *   2. **直接给真实 UI 元素做轻量动画**：只设 opacity + transform，
 *      每个元素独立、带 delay，逐个浮现。
 *   3. 动画结束 / 卸载 / 超时 / 异常 → **逐个还原**成原值。
 *
 * ── 关于"这是插件，不是重构 DSH"（用户明确要求）──────────────────────
 *
 * 所有对 DSH 的接触都是**可撤销的临时内联样式覆盖**：
 *   · 只设 style.opacity / style.transform / style.transition 三个属性
 *   · 动之前先把原值记在元素的 __nmBoot 上（实测 DSH 这些元素原本没有
 *     inline opacity/transform，所以"还原"= 恢复空串）
 *   · 动画结束逐个还原；dispose() 立刻全量还原；另有硬兜底强制还原
 *   · 不改 class、不改结构、不加全局 CSS、不绑死 hash 类名（用 [class*=] 模糊匹配）
 *   · 找不到元素就跳过那一项，绝不因为 DSH 版本差异崩掉
 */
const BootFx = (() => {
  const CURTAIN_ID = "nm-bootfx-curtain";
  const Z = 2147482000;

  // ── 时间轴 ──
  const T = {
    hold: 300,          // ① 高清封面停留（背景层 blur=0、无暗层）
    settleAt: 300,      // ② 压暗+模糊同时开始
    settleDur: 600,    //    同时长、同时结束（用户："直接下降到日常暗度"）
    lyricAt: 900,      // ③ 歌词开始淡入（压暗快结束时开始，衔接自然）
    lyricDur: 500,
    compAt: 1400,       // ④ 歌词演完，开始逐组件
    compStep: 260,      //    每个组件间隔
    compDur: 990,       //    单组件动画时长
    compRise: 10,       //    位移幅度（px），轻微上浮
    compSlide: 26,      // 左右滑入幅度（px）—— 侧边栏"从两边往中间"用
    tailAt: 4800,       // 收尾（还原一切）
    hardCap: 6000,      // 硬上限
  };

  let curtainEl = null;
  let dimEl = null, tintEl = null, veilEl = null, lyrEl = null;
  let touched = [];          // 记录我们动过的 DSH 元素
  let ambBackup = null;      // 背景层原始内联值
  let timers = [];
  let running = false;
  let disposed = false;

  function clearTimers() {
    for (const id of timers) { try { clearTimeout(id); } catch (e) {} }
    timers = [];
  }
  function later(ms, fn) {
    const id = setTimeout(function () {
      try { fn(); } catch (err) { fail("stage", err); }
    }, ms);
    timers.push(id);
    return id;
  }
  /**
   * 下一帧执行。**这是动画能不能看见的关键**。
   *
   * 同一个 JS 帧里同时设 transition 和 opacity/transform，浏览器会把它们
   * 合并成一次样式变更 —— 过渡不触发，直接跳到终值。
   * 表现就是"时间轴明明 6 秒，但看起来唰一下就完了"（踩坑 #35 同一个病）。
   */
  function nextFrame(fn) {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(function () { try { fn() } catch (e) { fail("frame", e) } });
    } else {
      setTimeout(function () { try { fn() } catch (e) { fail("frame", e) } }, 16);
    }
  }

  function fail(where, err) {
    try {
      if (typeof reportClientError === "function") {
        reportClientError("bootfx." + where, err instanceof Error ? err : new Error(String(err)));
      } else if (typeof console !== "undefined" && console.warn) {
        console.warn("[nm-bootfx] " + where + ": " + (err && err.message ? err.message : err));
      }
    } catch (e) {}
    try { stop(); } catch (e) {}
  }

  function sel(s) { try { return document.querySelector(s) } catch (e) { return null } }
  function boxOf(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) return null;
    if (r.top > window.innerHeight || r.bottom < 0) return null;
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  // ── 记录 / 还原（"插件不是重构"的核心保障）──
  /** 记下元素原本的内联值。重复调用不会覆盖第一次的记录。 */
  function remember(el) {
    if (!el || el.__nmBoot) return;
    el.__nmBoot = {
      opacity: el.style.opacity,       // "" 表示没有内联值
      transform: el.style.transform,
      transition: el.style.transition,
      transitionDelay: el.style.transitionDelay,
    };
    touched.push(el);
  }
  function restoreOne(el) {
    if (!el || !el.__nmBoot) return;
    try {
      el.style.opacity = el.__nmBoot.opacity;
      el.style.transform = el.__nmBoot.transform;
      el.style.transition = el.__nmBoot.transition;
      el.style.transitionDelay = el.__nmBoot.transitionDelay;
    } catch (e) {}
    try { delete el.__nmBoot; } catch (e) { el.__nmBoot = null; }
  }
  /** 还原所有动过的元素。**幂等**。 */
  function restoreAll() {
    const list = touched.slice();
    touched = [];
    for (let i = 0; i < list.length; i++) restoreOne(list[i]);
  }

  // ── 背景层：直接驱动真实的 #nm-ambient ──
  /**
   * 找到真实背景层的各子层，把它们的"动画起点"设成：
   *   covers 的 filter: blur(0)（高清）
   *   dim / tint / veil: opacity 0
   *   歌词: opacity 0
   * 然后由 start() 逐阶段推到原值。
   *
   * 这些是**我们插件自己的层**，不是 DSH 的，但仍记录原值、收尾还原。
   */
  function prepareAmbient() {
    const amb = document.getElementById("nm-ambient");
    if (!amb) return false;
    const root = amb.querySelector(".nm-amb");
    if (!root) return false;

    const coversEl = root.querySelector(".nm-amb-covers");
    if (!coversEl) return false;
    dimEl = root.querySelector(".nm-amb-dim");
    tintEl = root.querySelector(".nm-amb-tint");
    veilEl = root.querySelector(".nm-amb-veil");
    lyrEl = root.querySelector(".nm-amb-lyrics");

    const coverImgs = Array.from(root.querySelectorAll(".nm-amb-cover"));
    if (!coverImgs.length) return false;

    ambBackup = {
      covers: coverImgs.map((c) => ({ el: c, f: c.style.filter, t: c.style.transition })),
      dim: dimEl ? { o: dimEl.style.opacity, t: dimEl.style.transition } : null,
      tint: tintEl ? { o: tintEl.style.opacity, t: tintEl.style.transition } : null,
      veil: veilEl ? { o: veilEl.style.opacity, t: veilEl.style.transition } : null,
      lyr: lyrEl ? { o: lyrEl.style.opacity, t: lyrEl.style.transition } : null,
    };

    // 起点：封面清晰、暗层透明、歌词透明
    for (const b of ambBackup.covers) {
      b.el.style.transition = "none";
      const f = b.f || "blur(44px) saturate(118%)";
      b.el.style.filter = /blur\(/.test(f) ? f.replace(/blur\([^)]*\)/g, "blur(0px)") : ("blur(0px) " + f);
    }
    if (dimEl) { dimEl.style.transition = "none"; dimEl.style.opacity = "0"; }
    if (tintEl) { tintEl.style.transition = "none"; tintEl.style.opacity = "0"; }
    if (veilEl) { veilEl.style.transition = "none"; veilEl.style.opacity = "0"; }
    if (lyrEl) { lyrEl.style.transition = "none"; lyrEl.style.opacity = "0"; }

    return true;
  }

  function restoreAmbient() {
    if (!ambBackup) return;
    try {
      for (const b of ambBackup.covers) { b.el.style.filter = b.f; b.el.style.transition = b.t; }
      if (dimEl && ambBackup.dim) { dimEl.style.opacity = ambBackup.dim.o; dimEl.style.transition = ambBackup.dim.t; }
      if (tintEl && ambBackup.tint) { tintEl.style.opacity = ambBackup.tint.o; tintEl.style.transition = ambBackup.tint.t; }
      if (veilEl && ambBackup.veil) { veilEl.style.opacity = ambBackup.veil.o; veilEl.style.transition = ambBackup.veil.t; }
      if (lyrEl && ambBackup.lyr) { lyrEl.style.opacity = ambBackup.lyr.o; lyrEl.style.transition = ambBackup.lyr.t; }
    } catch (e) {}
    ambBackup = null;
    dimEl = tintEl = veilEl = lyrEl = null;
  }

  /**
   * 收集要逐个做动画的组件，**按用户指定的顺序**返回。
   *
   * 顺序（用户原话）：
   *   最下层用户头像id → 顶层系统栏 → 用户主输入框 → 左右侧边栏 → 主对话框历史会话记录
   *
   * 另外要求"左右侧边栏从两边往中间" —— 实测这个布局没有右侧栏，
   * 只有左栏(280宽,全高) + 主区。所以落地方案是：
   *   · 左栏整块从**左边**滑入（translateX 负 → 0）
   *   · 主区整块从**右边**滑入（translateX 正 → 0）
   *   两者向中间合拢，视觉上就是"从两边往中间"。
   *   而不是左栏内部从上到下逐个。
   *
   * 返回 { el, dir } 数组：dir 决定位移动画的方向
   *   "up"   从上浮起（默认）
   *   "left" 从左侧滑入
   *   "right" 从右侧滑入
   */
  function collectComponents() {
    const list = [];
    const push = (el, dir) => { if (el && boxOf(el)) list.push({ el, dir: dir || "up" }) };
    const sel1 = (q) => { try { return document.querySelector(q) } catch (e) { return null } };

    // ① 用户头像（最下层）
    push(sel1('img[class*="image"]'), "up");

    // ② 顶层系统栏：面包屑 + 标签栏
    push(sel1('[class*="crumbSeg"]'), "up");
    push(sel1('[class*="tabs"]'), "up");

    // ③ 用户主输入框
    push(sel1('[class*="RlGAzG_card"]'), "up");

    // ④ 左右侧边栏 —— 从两边往中间
    //    左栏：找品牌行所在的那一列（宽约 280、接近全高），整块从左侧滑入
    try {
      const brandRow = sel1('[class*="logoRow"]');
      let leftCol = brandRow;
      for (let k = 0; k < 6 && leftCol; k++) {
        const r = leftCol.getBoundingClientRect();
        if (r.width > 200 && r.height > window.innerHeight * 0.8) break;
        leftCol = leftCol.parentElement;
      }
      if (leftCol) push(leftCol, "left");
    } catch (e) {}

    //    主对话区（= 右侧"栏"）：输入卡往上找最宽的那个容器，整块从右侧滑入
    try {
      const inputCard = sel1('[class*="RlGAzG_card"]');
      let chatCol = inputCard ? inputCard.parentElement : null;
      for (let k = 0; k < 8 && chatCol; k++) {
        const r = chatCol.getBoundingClientRect();
        if (r.width > window.innerWidth * 0.55 && r.height > window.innerHeight * 0.5) break;
        chatCol = chatCol.parentElement;
      }
      // 避免把 body/html 也当目标（那会把整个页面滑进来）
      if (chatCol && chatCol !== document.body && chatCol !== document.documentElement) {
        push(chatCol, "right");
      }
    } catch (e) {}

    // ⑤ 主对话历史会话记录（最后）：只取视口内可见的那几条
    try {
      const flows = Array.from(document.querySelectorAll('[class*="flowItem"]'))
        .map((e) => ({ e, r: e.getBoundingClientRect() }))
        .filter((x) => x.r.width > 200 && x.r.height > 12 &&
          x.r.top < window.innerHeight - 40 && x.r.bottom > 60)
        .sort((a, b) => a.r.top - b.r.top)
        .slice(-4);   // 取最靠下的 4 条（最近的消息）
      for (const f of flows) push(f.e, "up");
    } catch (e) {}

    return list;
  }

  function buildCurtain() {
    const c = document.createElement("div");
    c.id = CURTAIN_ID;
    c.style.cssText = "position:fixed;inset:0;z-index:" + Z + ";pointer-events:none;background:#05060a;opacity:1";
    return c;
  }

  // ── 对外：开始 ──
  function start(opts) {
    if (disposed || running) return false;
    void opts;

    try {
      restoreAll();
      removeCurtain();

      // 背景层驱动不起来（没有封面 / 还没挂载）就安静地不播
      if (!prepareAmbient()) return false;

      // 遮罩先盖上，避免"高清封面"阶段之前界面闪一下；随即淡掉
      curtainEl = buildCurtain();
      document.body.appendChild(curtainEl);
      later(20, function () {
        if (!curtainEl) return;
        curtainEl.style.transition = "opacity 320ms ease";
        curtainEl.style.opacity = "0";
      });

      running = true;

      // 先把所有组件设成不可见 + 下移（歌词阶段它们必须不出现）
      const comps = collectComponents();
      // 起点：按 dir 决定从哪个方向滑入
      const startOffset = function (dir) {
        if (dir === "left") return "translateX(-" + T.compSlide + "px)";
        if (dir === "right") return "translateX(" + T.compSlide + "px)";
        return "translateY(" + T.compRise + "px)";
      };
      for (const c of comps) {
        const el = c.el;
        remember(el);
        el.style.transition = "none";
        el.style.opacity = "0";
        el.style.transform = startOffset(c.dir);
      }

      // ② 暗度下降 + 同时模糊（用户指定 600ms，从 300ms 开始）
      later(T.settleAt, function () {
        // 第一步：只设 transition（不设值）
        if (ambBackup) {
          for (const b of ambBackup.covers) {
            b.el.style.transition = "filter " + T.settleDur + "ms cubic-bezier(.4,0,.2,1)";
          }
        }
        if (dimEl) dimEl.style.transition = "opacity " + T.settleDur + "ms cubic-bezier(.4,0,.2,1)";
        if (tintEl) tintEl.style.transition = "opacity " + T.settleDur + "ms cubic-bezier(.4,0,.2,1)";
        if (veilEl) veilEl.style.transition = "opacity " + T.settleDur + "ms cubic-bezier(.4,0,.2,1)";
        // 第二步：下一帧再设值 —— 这样浏览器才会真的做过渡
        nextFrame(function () {
          if (ambBackup) {
            for (const b of ambBackup.covers) b.el.style.filter = b.f;
          }
          if (dimEl) dimEl.style.opacity = "1";
          if (tintEl) tintEl.style.opacity = "1";
          if (veilEl) veilEl.style.opacity = "1";
        });
      });

      // ③ 只渲染歌词（真实歌词层淡入）
      later(T.lyricAt, function () {
        if (!lyrEl) return;
        lyrEl.style.transition = "opacity " + T.lyricDur + "ms cubic-bezier(.4,0,.2,1)";
        nextFrame(function () {
          if (lyrEl) lyrEl.style.opacity = "1";
        });
      });

      // ④ 歌词演完，逐组件浮现
      later(T.compAt, function () {
        // 第一步：只设 transition 与 delay
        for (let i = 0; i < comps.length; i++) {
          const el = comps[i].el;
          if (!el || !el.__nmBoot) continue;
          el.style.transition =
            "opacity " + T.compDur + "ms cubic-bezier(.32,.72,.28,1), transform " + T.compDur + "ms cubic-bezier(.32,.72,.28,1)";
          el.style.transitionDelay = (i * T.compStep) + "ms";
        }
        // 第二步：下一帧再设目标值 —— 否则全部瞬间到位
        nextFrame(function () {
          for (let i = 0; i < comps.length; i++) {
            const el = comps[i].el;
            if (!el || !el.__nmBoot) continue;
            el.style.opacity = el.__nmBoot.opacity || "1";
            el.style.transform = el.__nmBoot.transform;
          }
        });
      });

      // 收尾：还原一切
      later(T.tailAt, function () { stop(); });
      later(T.hardCap, function () {
        if (running) fail("hardcap", new Error("启动动画超过硬上限，强制收尾"));
      });

      return true;
    } catch (err) {
      fail("start", err);
      return false;
    }
  }

  function removeCurtain() {
    try {
      const list = document.querySelectorAll("#" + CURTAIN_ID);
      for (let i = 0; i < list.length; i++) {
        if (list[i].parentNode) list[i].parentNode.removeChild(list[i]);
      }
    } catch (e) {}
    curtainEl = null;
  }

  /**
   * 停止并**还原所有改动**。幂等。
   * 插件卸载 / 热重载 / 正常结束 / 异常，都走这里。
   */
  function stop() {
    running = false;
    clearTimers();
    try {
      // 最重要：把 DSH 元素还原成原值
      restoreAll();
      // 背景层还原
      restoreAmbient();
      // 移除我们自己的遮罩
      if (curtainEl && curtainEl.parentNode) {
        const c = curtainEl;
        curtainEl = null;
        try { c.style.transition = "opacity 200ms ease"; c.style.opacity = "0"; } catch (e) {}
        setTimeout(function () {
          try { if (c.parentNode) c.parentNode.removeChild(c); } catch (e) {}
        }, 220);
      }
      removeCurtain();
    } catch (e) {}
  }

  /** 插件卸载：立刻还原，之后 start 直接返回 false。 */
  function dispose() {
    disposed = true;
    stop();
  }

  return {
    start, stop, dispose,
    isRunning: function () { return running; },
    /** 供测试 / 排查：当前动过多少个 DSH 元素 */
    touchedCount: function () { return touched.length; },
  };
})();
