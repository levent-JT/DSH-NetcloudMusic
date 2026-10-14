/**
 * 背景图层的合成与挂载 —— 这一层是"整套 DSH 皮肤"的视觉部分。
 * 
 * 图层自下而上共 8 层（见 AmbientBg 内的编号注释）：
 *   底 → 模糊封面 → 压暗 → 主色染色 → 噪点 → 播放页主体 → 背景歌词 → 亮度封顶薄纱
 * 
 * 为什么把挂载也收进来：图层要用一个独立的 React root 渲染（不能挂成 slot 的 portal，
 * 否则 slot 没渲染时会出现"令牌改了但图层不存在"的半死状态）。这个 root 的
 * 创建/卸载与图层本身是同一件事，拆开放只会让外面多知道一个它不该知道的 bgRoot。
 * 
 * 皮肤只认「一张图 + 一行歌词 + 播放进度 + 是否在播」这四样输入，不认识"歌"。
 */
const SkinLayers = (() => {

    // --------------------------------------------------- ambient background
    /**
     * 歌词背景（氛围式）。做法参考 dsh-any-background（MIT）。
     *
     * 三个要点：
     *  1) 图层是 prepend 到 body 的 fixed div、z-index:-1 —— 藏在界面背后；
     *  2) 界面之所以挡得住它，是因为各面用不透明的 --dsw-alias-bg-* 令牌，
     *     必须把这些令牌改写成带 alpha 的 rgba，且带 !important
     *     （宿主也可能把令牌写在 body 或内联样式上）；
     *  3) 读宿主原色要在 :root 上读——我们的覆写写在 body，不会污染读取源，
     *     因此反复应用是幂等的。
     */
    let bgLayerEl = null;
    // 背景图层专用的 React root（见 apply 里的挂载说明）
    let bgRoot = null;
    function ensureBgLayer() {
      if (!bgLayerEl || !document.body.contains(bgLayerEl)) {
        bgLayerEl = document.createElement("div");
        bgLayerEl.id = "nm-ambient";
        bgLayerEl.style.cssText = "position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;";
        document.body.prepend(bgLayerEl);
      // 登记给皮肤层：「别把我们自己的背景图层也磨砂了」这条判断要用它。
      DshSkin.setBackgroundLayer(bgLayerEl);
      }
      return bgLayerEl;
    }
    // ── DSH 皮肤接缝（实现在 src/client/skin/dsh.js）────────────────────
    // 这里只留一句话的转调，不保留任何实现：
    //   皮肤的内部状态（令牌原值缓存、玻璃名单、磨砂观察器）外面一概看不到，
    //   这样"读到自己写的值""磨了整页面"这类事故就不会再从视图代码里长出来。
    // 唯一的接线是下面这行 setBackgroundLayer —— 图层要用 React 渲染，只能由外面建。

    /** 当前歌词行下标：最后一个 t <= 已播秒数 的行。 */
    function activeLyricIndex(lines, time) {
      let current = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].t <= time) current = i;
        else break;
      }
      return current;
    }

    /**
     * 播放页的「主体」装饰——对应官方播放器样式的三大方向（网易云音乐设计团队原文）。
     *
     * 官方原话是「不是设计一款虚拟的播放界面，而是具有**合理工业结构和运行规则**的
     * 实体播放器，将其虚拟化」，并给出明确规则：**唱针沿凹槽移动，角度映射播放进度**
     * （指针向外=正在向前播放，向内=正在倒带），还带轻微物理摆动。
     *
     * 原来的实现只有一个匀速空转的圆盘——不表达任何信息，这正是"旋转胶片挺突兀"的根因。
     *
     *   minimal 极简     ——官方【极简主义】"Less is more，以点线面为基础几何结构"。
     *                      落成"大圆角封面 + 呼吸感"，不放任何机械结构。
     *   classic 经典黑胶 ——官方【经典黑胶】。唱针角度随播放进度移动。
     *   color   青春彩胶 ——官方【青春彩胶】"造型简单的透明底座和指针，视觉焦点聚焦在
     *                      颜色变化上，采用半透明材质、整体氛围用封面取色"。
     *                      彩胶盘用封面主色，封面收缩成中心标签（真唱片就是这么做的）。
     *
     * 未实现：官方彩胶的「按音频高低起伏控制烟雾弥散密度」需要 Web Audio 分析音轨，
     * 而音源是网易云 CDN，取音轨数据有跨域风险，暂不做——不假装做了。
     */
    function renderDeck(style, pic, stats, progress, playing) {
      // immersive 沉浸式：**只留背景**——模糊封面 + 主色染色 + 噪点 + 居中大歌词。
      // 不放封面主体、不放唱片机，因为沉浸式的重点就是让歌词独占画面。
      // 注意：播放器页面与控制条不受任何样式影响，样式只作用于这层背景。
      if (!pic || style === "immersive") return null;
      // 唱针角度：官方规则是"向外=前进"。20° 是落针起始位置，随进度转到 36°。
      const arm = "rotate(" + (20 + progress * 16).toFixed(2) + "deg)";
      if (style === "minimal") {
        return el("div", { className: "nm-amb-disc-wrap" },
          el("div", {
            className: "nm-amb-disc" + (playing ? " breath" : ""),
            style: { backgroundImage: `url("${pic}")` },
          }));
      }
      if (style === "color") {
        const c = stats ? stats.rgb.map((v) => Math.round(v)) : [110, 130, 180];
        return el("div", { className: "nm-amb-platter nm-amb-platter-lite" },
          el("div", {
            key: "vinyl",
            className: "nm-amb-vinyl nm-amb-vinyl-color" + (playing ? " spin" : ""),
            // 半透明彩胶：主色打底 + 一圈圈唱片纹路；封面只当中心标签
            style: {
              backgroundColor: "rgb(" + c.join(",") + ")",
              backgroundImage:
                "repeating-radial-gradient(circle at 50% 50%,rgba(255,255,255,.05) 0 1px,transparent 1px 6px)," +
                "radial-gradient(circle at 50% 50%,rgba(255,255,255,.18) 0 7%,transparent 7% 100%)",
            },
          }, el("div", { key: "label", className: "nm-amb-vinyl-label", style: { backgroundImage: `url("${pic}")` } })),
          el("div", { key: "arm", className: "nm-amb-arm-lite", style: { transform: arm } }));
      }
      return el("div", { className: "nm-amb-deck" },
        el("div", { key: "platter", className: "nm-amb-platter" },
          el("div", {
            key: "vinyl",
            className: "nm-amb-vinyl" + (playing ? " spin" : ""),
            style: { backgroundImage: `url("${pic}")` },
          })),
        el("div", { key: "arm", className: "nm-amb-tonearm", style: { transform: arm } }),
        el("div", { key: "knob", className: "nm-amb-knob" }));
    }

    // ── 皮肤的输入 ────────────────────────────────────────────────
    // 皮肤**不认识"歌"**，只认下面这几样：
    //   cover    封面图 URL（就是"一张图"）
    //   lyrics   [{ t, text, tr }]
    //   time     已播秒数（定位当前歌词行用）
    //   progress 0..1（唱针角度映射到播放位置）
    //   playing  是否在播
    //   config   皮肤自己的样式配置（原 ambient 那一段）
    //
    // 为什么不是"让皮肤去订阅音乐状态"：那等于把音乐的 store 形状焊进皮肤，
    // 换一套播放器实现就得动皮肤。反过来由音乐侧推，依赖方向就只有一条。
    let snapshot = { cover: "", lyrics: [], time: 0, progress: 0, playing: false, config: {} };
    const skinListeners = new Set();
    function subscribeSnapshot(cb) {
      skinListeners.add(cb);
      return () => skinListeners.delete(cb);
    }
    function getSnapshot() {
      return snapshot;
    }
    /** 由音乐侧推入。整体换引用，useSyncExternalStore 才会认到变化。 */
    function update(next) {
      snapshot = { ...snapshot, ...(next || {}) };
      for (const cb of [...skinListeners]) cb();
    }

    function AmbientBg() {
      // 只订阅皮肤自己的输入，不订阅音乐 store
      const s = useSyncExternalStore(subscribeSnapshot, getSnapshot);
      const cfg = s.config || {};
      const mode = cfg.mode || "cover-lyrics";
      const cover = s.cover;
      const enabled = mode !== "off" && !!cover;
      const alpha = typeof cfg.panelAlpha === "number" ? cfg.panelAlpha : 0.45;
      // hooks 必须在早退出之前无条件调用；取不到统计值时下面的自适应按中间亮度兜底
      const stats = SkinPalette.useCoverStats(enabled ? cover : "");

      // 令牌覆写是副作用：关闭时立刻还原
      useEffect(() => {
        if (!enabled) {
          DshSkin.clearSkin();
          return undefined;
        }
        // frost 决定磨砂范围：layout = 只磨工具面/浮层（默认），all = 全磨，off = 不磨
        const frost = typeof cfg.frost === "string" ? cfg.frost : "layout";
        DshSkin.applySkin(alpha, { frost });
        // 宿主切换明暗主题会重写令牌，低频兜底重贴（有 signature 去重，开销极小）
        const id = setInterval(() => DshSkin.applySkin(alpha, { frost }), 3000);
        return () => {
          clearInterval(id);
          DshSkin.clearSkin();
        };
      }, [enabled, alpha, cfg.frost]);

      if (!enabled) return null;

      const lines = s.lyrics || [];
      const current = activeLyricIndex(lines, s.time);
      const blur = typeof cfg.blur === "number" ? cfg.blur : 44;
      const base = typeof cfg.dim === "number" ? cfg.dim : 0.55;
      const style = cfg.style || "immersive";
      // 播放进度 0..1（已由音乐侧算好），用于把唱针角度映射到播放位置：向外=前进
      const progress = s.progress;
      const size = typeof cfg.lyricSize === "number" ? cfg.lyricSize : 22;
      const from = Math.max(0, current - 3);
      const slice = lines.slice(from, current + 4);

      // ── 自适应（视觉效果的关键）────────────────────────────────────────
      // 封面越亮，遮罩越重：浅色封面在固定强度下会把整页冲成灰白、歌词糊掉。
      // 0.42 这个系数是让「深色封面几乎不额外压暗、浅色封面被压到 0.9+」。
      const auto = cfg.auto !== false;
      const lum = stats ? Math.min(1, Math.max(0, stats.lum)) : 0.35;
      const dim = auto ? Math.min(0.94, base + lum * 0.42) : base;

      // 亮度封顶薄纱（见图层 8 的说明）。系数含义：
      //   0.30 是底色 —— 哪怕纯黑封面也留一点，保证背景整体是"后退"的；
      //   lum × 0.26 让浅色封面再重一档，把它的峰值继续往下压。
      // 上限 0.68：再重背景就真的看不见了，那就失去了做背景的意义。
      //
      // 为什么比上一版更重：从用户截图里量出来，**背景最亮的地方不是封面，
      // 是我们自己的歌词**（峰值 0.76，而背景平均只有 0.05~0.11）。
      // 文字对比度只看最亮处，所以必须把歌词这个峰压下来。
      const veil = Math.min(0.68, 0.3 + lum * 0.26);

      // 主色染色：把封面主色压到「最亮通道 ≈ 40%」再用，否则浅色封面会把画面提亮。
      let deepRgb = "rgb(14,18,32)";
      let tintRgba = "rgba(96,120,180,.42)";
      if (stats) {
        const mx = Math.max(stats.rgb[0], stats.rgb[1], stats.rgb[2], 1);
        const k = (255 * 0.4) / mx;
        const c = stats.rgb.map((v) => Math.round(Math.min(255, v * k)));
        deepRgb = "rgb(" + c.map((v) => Math.round(v * 0.32)).join(",") + ")";
        tintRgba = "rgba(" + c.join(",") + ",.42)";
      }

      // 封面本身也按亮度压一档，避免「模糊后依旧刺眼」
      const coverFilter = "blur(" + blur + "px) saturate(" + (auto ? 118 : 140) + "%) brightness(" +
        (1 - lum * 0.32).toFixed(3) + ")";

      return el("div", { className: "nm-amb" }, [
        // 1) 底色：封面主色压暗成纯色。封面没加载出来/半透明时，露的是它而不是白。
        el("div", { key: "base", className: "nm-amb-base", style: { background: deepRgb } }),
        // 2) 模糊封面铺满（网易云的做法）
        cover
          ? el("div", {
              key: "cover",
              className: "nm-amb-cover",
              style: { backgroundImage: `url("${cover}")`, filter: coverFilter },
            })
          : null,
        // 3) 压暗层。两条渐变叠起来：
        //    竖向的负责整体基调（冷蓝 → 微紫，中点 0.62 提亮，纯黑会把封面压成死灰）；
        //    横向的专门压右侧（歌词所在），保证任何封面下歌词都有对比度。
        el("div", {
          key: "dim",
          className: "nm-amb-dim",
          style: {
            background:
              `linear-gradient(180deg,rgba(4,7,18,${dim.toFixed(3)}) 0%,rgba(8,11,28,${(dim * 0.62).toFixed(3)}) 45%,` +
              `rgba(12,8,26,${(dim * 0.92).toFixed(3)}) 100%),` +
              `linear-gradient(270deg,rgba(2,4,12,${Math.min(0.9, dim * 0.88).toFixed(3)}) 0%,` +
              `rgba(2,4,12,${(dim * 0.34).toFixed(3)}) 36%,rgba(2,4,12,0) 62%)`,
          },
        }),
        // 4) 主色光晕：让背景有「随封面变化」的色彩，而不是一片中性灰。
        //    放在压暗层之上，否则会被 0.9 的遮罩吃掉。
        el("div", {
          key: "tint",
          className: "nm-amb-tint",
          style: {
            background:
              `radial-gradient(ellipse 62% 58% at 20% 16%,${tintRgba},transparent 68%),` +
              `radial-gradient(ellipse 56% 62% at 86% 84%,${tintRgba},transparent 72%)`,
          },
        }),
        // 5) 细噪点：大面积渐变在深色下容易出现色带，噪点把它打散
        el("div", { key: "grain", className: "nm-amb-grain" }),
        // 6) 播放页主体（极简大封面 / 经典黑胶 / 青春彩胶），见 renderDeck
        cfg.deck !== false ? renderDeck(style, cover, stats, progress, s.playing) : null,
        // 7) 背景歌词。沉浸式样式下**居中放大**（对齐网易云 PC 端全屏播放页的排版：
        //    歌词居中当主角，只有一个视觉焦点），其它样式仍是右侧小字。
        //    注意：这里只动背景，播放器页面和控制条不受样式影响。
        mode === "cover-lyrics" && slice.length
          ? el("div", {
              key: "lrc",
              className: "nm-amb-lyrics" + (style === "immersive" ? " nm-amb-lyrics-c" : ""),
              // 字号内联下发：沉浸式用 clamp 跟着窗口高度走（CSS 里写会被内联覆盖）
              style: { fontSize: style === "immersive" ? "clamp(20px,3.1vh,42px)" : size + "px" },
            },
              slice.map((ln, i) =>
                el("div", { key: from + i, className: "nm-amb-line" + (from + i === current ? " on" : "") },
                  el("div", { className: "nm-amb-t" }, ln.text || "…"),
                  ln.tr && cfg.trans !== false ? el("div", { className: "nm-amb-tr" }, ln.tr) : null)))
          : null,
        // 8) 亮度封顶薄纱 —— **所有背景元素（含歌词）画完之后**再统一压一道。
        //
        // 这条是"界面清晰度"的关键，也是原设计漏掉的一层：
        // 文字对比度 = 文字 vs (背景 × (1-alpha) + 面板色 × alpha)。
        // 面板 alpha 只有 0.3 时背景要贡献 70% 的亮度，所以**背景只要出现亮区域，
        // 压在上面的文字就必然糊**。实测最惨的情况：背景歌词用纯白（L≈1.0），
        // 合成亮度 0.72，白字对比度只剩 1.4:1。
        //
        // 修法不是把面板做成不透明（那就没背景了），而是让**背景永远不亮**：
        // 把峰值得压到 0.5 以下，即使面板 alpha 保持 0.3，对比度也能回到 6:1 左右。
        // 压暗层（第 3 层）只盖住封面，压不到歌词，所以这一层必须放在最后。
        el("div", {
          key: "veil",
          className: "nm-amb-veil",
          style: { background: `rgba(5,8,18,${veil.toFixed(3)})` },
        }),
      ]);
    }

  // ── 挂载 / 卸载 ────────────────────────────────────────────
  /** 建好图层容器并用独立 root 渲染背景。失败只告警，不影响播放。 */
  function mount() {
    const layer = ensureBgLayer();
    if (!layer) return null;
    try {
      if (typeof ReactDOM.createRoot === "function") {
        bgRoot = ReactDOM.createRoot(layer);
        bgRoot.render(el(AmbientBg, {}));
      } else if (typeof ReactDOM.render === "function") {
        ReactDOM.render(el(AmbientBg, {}), layer);
        bgRoot = layer;
      }
    } catch (err) {
      console.warn("[netease] 背景图层挂载失败:", err);
    }
    return layer;
  }

  /** 先卸载 root 再摘节点：顺序反了 React 会在已脱离的节点上做清理。 */
  function unmount() {
    if (bgRoot) {
      try {
        if (typeof bgRoot.unmount === "function") bgRoot.unmount();
        else if (typeof ReactDOM.unmountComponentAtNode === "function") ReactDOM.unmountComponentAtNode(bgRoot);
      } catch (err) {
        /* 非致命 */
      }
      bgRoot = null;
    }
    if (bgLayerEl) {
      try {
        if (bgLayerEl.parentNode) bgLayerEl.parentNode.removeChild(bgLayerEl);
      } catch (err) {
        /* 非致命 */
      }
      bgLayerEl = null;
    }
  }

  // ── 对外接口 ──────────────────────────────────────────────
  return {
    mount,
    unmount,
    /** 由音乐侧推入状态。皮肤不认识"歌"，只认 cover / lyrics / time / progress / playing / config。 */
    update,
  }
})()

