/**
 * 设置页 v2（2026-11-01 重设计）—— Linear/Vercel 风格。
 *
 * 设计原则：
 *   · 深色 + hairline 细线 + 方角开关（非 iOS 圆形）
 *   · 左 140px 分区导航 + 右内容区（sticky nav）
 *   · 模块开关用 2 列网格压缩（省一半纵向空间）
 *   · 滑块带当前值实时显示（tabular-nums）
 *
 * 性能约束：
 *   · 只做 transform/opacity/bg-color 过渡（无 layout 属性动画）
 *   · 无 backdrop-filter
 *   · nav 高亮用 IntersectionObserver（无 scroll 监听）
 *   · 所有本地 helper 走函数声明（同一 factory 作用域提升，不依赖 PARTS 顺序）
 *
 * PARTS 位置：在 main.js 之前（它消费 store/saveSettings 等函数声明，
 * 函数声明在同一作用域内提升，所以顺序无关；但习惯上视图类分片放在 main.js 前）。
 */

/** 方角开关（非 iOS）。视觉纯 CSS，JS 只管 aria-pressed + onChange。 */
function SetToggle(props) {
  return el("button", {
    className: "nm-set2-tg" + (props.checked ? " nm-set2-tg-on" : ""),
    "aria-pressed": String(!!props.checked),
    "aria-label": props.label || "",
    onClick: () => props.onChange(!props.checked),
  }, el("span", { className: "nm-set2-tg-thumb" }));
}

/** 滑块行：label + 滑轨 + 实时值。值在 onChange 里由父组件维护。 */
function SetSlider(props) {
  const pct = ((props.value - props.min) / (props.max - props.min)) * 100;
  return el("div", { className: "nm-set2-row" },
    el("div", { className: "nm-set2-lab" }, props.label),
    el("div", { className: "nm-set2-slider" },
      el("input", {
        type: "range",
        className: "nm-set2-range",
        min: props.min, max: props.max, step: props.step || 1,
        value: props.value,
        style: { "--nm-fill": Math.round(pct) + "%" },
        onChange: (e) => props.onChange(Number(e.target.value)),
      })),
    el("span", { className: "nm-set2-val" }, props.display != null ? props.display : props.value));
}

/** 通用行：label + 右侧控件槽。 */
function SetRow(props) {
  return el("div", { className: "nm-set2-row" },
    el("div", { className: "nm-set2-lab" }, props.label),
    props.children || null,
    props.value != null ? el("span", { className: "nm-set2-val" }, props.value) : null);
}

/** 分区卡片：标题 + 圆点 + 内容。 */
function SetSection(props) {
  return el("section", { className: "nm-set2-sec", id: "nm-set2-" + props.id },
    el("div", { className: "nm-set2-head" },
      el("span", { className: "nm-set2-head-dot" }),
      el("span", { className: "nm-set2-head-t" }, props.title)),
    props.children);
}

/** 下拉（统一风格）。 */
function SetSelect(props) {
  return el("select", {
    className: "nm-set2-select",
    value: props.value,
    onChange: (e) => props.onChange(e.target.value),
  }, props.options.map((o) =>
    typeof o === "string"
      ? el("option", { key: o, value: o }, o)
      : el("option", { key: o.value, value: o.value }, o.label)));
}

/** 模块网格单元。 */
function SetCell(props) {
  return el("div", { className: "nm-set2-cell" },
    el("span", { className: "nm-set2-cell-lab" }, props.label),
    el(SetToggle, { checked: props.checked, onChange: props.onChange, label: props.label }));
}

/** 分区定义（导航顺序 = 内容顺序）。 */
const SET2_SECTIONS = [
  { id: "appearance", label: "外观" },
  { id: "playback", label: "播放" },
  { id: "modules", label: "模块" },
  { id: "storage", label: "存储" },
  { id: "account", label: "账号" },
];

function SettingsView() {
  useStore();
  const [activeSec, setActiveSec] = useState("appearance");
  const navRef = useRef(null);

  // ── IntersectionObserver：滚动到哪个分区，nav 高亮哪个 ──
  useEffect(function () {
    const obs = new IntersectionObserver(function (entries) {
      for (const ent of entries) {
        if (ent.isIntersecting) {
          const id = ent.target.id.replace("nm-set2-", "");
          setActiveSec(id);
        }
      }
    }, { rootMargin: "-20% 0px -60% 0px", threshold: 0 });
    for (const s of SET2_SECTIONS) {
      const el_ = document.getElementById("nm-set2-" + s.id);
      if (el_) obs.observe(el_);
    }
    return function () { obs.disconnect(); };
  }, []);

  // ── 本地 helper（和原版一致，只是搬了个家）──
  const mods = store.modules || {};
  const toggleModule = (key, value) => {
    store.modules = { ...mods, [key]: value };
    emit();
    saveSettingsDebounced({ modules: { [key]: value } });
  };
  const setAmb = (patch) => {
    const next = { ...((store.settings && store.settings.ambient) || {}), ...patch };
    store.settings = { ...store.settings, ambient: next };
    emit();
    saveSettingsDebounced({ ambient: next });
  };
  const amb = (store.settings && store.settings.ambient) || {};
  const ambNum = (k, dft) => (typeof amb[k] === "number" ? amb[k] : dft);

  const cache = store.cacheStats || {};
  const cacheCfg = (store.settings && store.settings.cache) || {};
  const cacheMax = typeof cacheCfg.max === "number" ? cacheCfg.max : 800;
  const clientLimits = cacheCfg.clientLimits || { url: 12, lyric: 40, cover: 300 };
  const setClientLimit = (k, raw) => {
    const v = Math.max(0, Math.floor(Number(raw) || 0));
    const next = Object.assign({}, clientLimits, { [k]: v });
    store.settings = { ...store.settings, cache: { ...cacheCfg, clientLimits: next } };
    applyCacheLimits();
    setCache({ clientLimits: next });
  };
  const refreshCacheStats = (force) => {
    if (!force && store.cacheStats) return;
    api("/cache/stats", {}).then((res) => { store.cacheStats = res || {}; emit(); })
      .catch(() => { store.cacheStats = { quality: 0 }; emit(); });
  };
  const setCache = (patch) => {
    const next = { ...cacheCfg, ...patch };
    store.settings = { ...store.settings, cache: next };
    applyCacheLimits();
    emit();
    saveSettingsDebounced({ cache: next });
    refreshCacheStats(true);
  };
  const loginName = store.login && store.login.profile ? store.login.profile.nickname : null;
  useEffect(function () { refreshCacheStats(false); }, []);

  return el("div", { className: "nm-view nm-set2" },
    // ── 左导航 ──
    el("nav", { className: "nm-set2-nav", ref: navRef },
      SET2_SECTIONS.map((s) =>
        el("button", {
          key: s.id,
          className: "nm-set2-nav-item" + (activeSec === s.id ? " nm-set2-nav-on" : ""),
          onClick: function () {
            const target = document.getElementById("nm-set2-" + s.id);
            if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
          },
        }, s.label))),

    // ── 右内容 ──
    el("div", { className: "nm-set2-body" },

      // ═══ 外观 ═══
      el(SetSection, { id: "appearance", title: "外观" },
        el(SetRow, { label: "DSH 皮肤（半透明 / 磨砂 / 文字提亮）" },
          el(SetToggle, { checked: amb.enabled !== false, onChange: (v) => setAmb({ enabled: v }), label: "DSH 皮肤" })),
        el("div", { className: "nm-set2-hint" },
          "关闭后 DSH 恢复原样（面板不透明、无磨砂）。听歌功能不受影响。"),
        el(SetRow, { label: "播放页样式" },
          el(SetSelect, {
            value: amb.style || "immersive",
            onChange: (v) => setAmb({ style: v }),
            options: [
              { value: "immersive", label: "沉浸式" },
              { value: "minimal", label: "极简" },
              { value: "classic", label: "经典黑胶" },
              { value: "color", label: "青春彩胶" },
            ],
          })),
        el(SetRow, { label: "背景" },
          el(SetSelect, {
            value: amb.mode || "cover-lyrics",
            onChange: (v) => setAmb({ mode: v }),
            options: [
              { value: "cover-lyrics", label: "封面 + 歌词" },
              { value: "cover", label: "仅模糊封面" },
              { value: "off", label: "关闭" },
            ],
          })),
        el(SetRow, { label: "自适应封面明暗与主色" },
          el(SetToggle, { checked: amb.auto !== false, onChange: (v) => setAmb({ auto: v }), label: "自适应" })),
        el(SetRow, { label: "显示黑胶唱片机" },
          el(SetToggle, { checked: amb.deck !== false, onChange: (v) => setAmb({ deck: v }), label: "唱片机" })),
        el(SetSlider, { label: "暗化基线", min: 0, max: 90, value: Math.round(ambNum("dim", 0.55) * 100),
          display: Math.round(ambNum("dim", 0.55) * 100) + "%",
          onChange: (v) => setAmb({ dim: v / 100 }) }),
        el(SetSlider, { label: "封面模糊", min: 0, max: 90, value: ambNum("blur", 44),
          display: ambNum("blur", 44) + "px",
          onChange: (v) => setAmb({ blur: v }) }),
        el(SetSlider, { label: "歌词字号", min: 14, max: 46, value: ambNum("lyricSize", 22),
          display: ambNum("lyricSize", 22) + "px",
          onChange: (v) => setAmb({ lyricSize: v }) }),
        el(SetSlider, { label: "界面不透明度", min: 0, max: 80, value: Math.round(ambNum("panelAlpha", 0.45) * 100),
          display: Math.round(ambNum("panelAlpha", 0.45) * 100) + "%",
          onChange: (v) => setAmb({ panelAlpha: v / 100 }) }),
        el(SetRow, { label: "磨砂范围" },
          el(SetSelect, {
            value: typeof amb.frost === "string" ? amb.frost : "layout",
            onChange: (v) => setAmb({ frost: v }),
            options: [
              { value: "layout", label: "工具面" },
              { value: "all", label: "全部" },
              { value: "off", label: "关闭" },
            ],
          })),
        el("div", { className: "nm-set2-hint" },
          "工具面＝只给菜单/抽屉这类浮层加毛玻璃。暗化基线是自适应的起点，封面越亮压得越重。"),
        el(SetRow, { label: "背景歌词显示译文" },
          el(SetToggle, { checked: amb.trans !== false, onChange: (v) => setAmb({ trans: v }), label: "译文" }))),

      // ═══ 播放 ═══
      el(SetSection, { id: "playback", title: "播放" },
        el(SetRow, { label: "音质" },
          el(SetSelect, {
            value: store.quality,
            onChange: (v) => { store.quality = v; emit(); saveSettings({ quality: v }); },
            options: QUALITY_LEVELS.map((q) => ({ value: q, label: QUALITY_LABELS[q] })),
          })),
        el(SetRow, { label: "播放模式" },
          el("div", { className: "nm-set2-slider" },
            el(SetSelect, {
              value: store.mode,
              onChange: (v) => setMode(v, true),
              options: modeOptions().map((m) => ({ value: m, label: MODE_LABELS[m] })),
            })))),

      // ═══ 模块 ═══
      el(SetSection, { id: "modules", title: "模块" },
        el("div", { className: "nm-set2-grid" },
          el(SetCell, { label: "每日推荐", checked: mods.daily !== false, onChange: (v) => toggleModule("daily", v) }),
          el(SetCell, { label: "歌单", checked: mods.playlist !== false, onChange: (v) => toggleModule("playlist", v) }),
          el(SetCell, { label: "私人FM", checked: mods.fm !== false, onChange: (v) => toggleModule("fm", v) }),
          el(SetCell, { label: "歌词", checked: mods.lyrics !== false, onChange: (v) => toggleModule("lyrics", v) }),
          el(SetCell, { label: "播放历史", checked: mods.history !== false, onChange: (v) => toggleModule("history", v) }),
          el(SetCell, { label: "音量调节", checked: mods.volume !== false, onChange: (v) => toggleModule("volume", v) }))),

      // ═══ 存储 ═══
      el(SetSection, { id: "storage", title: "存储" },
        el(SetRow, { label: "播放地址缓存", value: clientLimits.url + " 条" },
          el("input", { type: "number", className: "nm-set2-num", min: 0, max: 500, step: 4,
            value: clientLimits.url, title: "0 = 不缓存",
            onChange: (e) => setClientLimit("url", e.target.value) })),
        el(SetRow, { label: "歌词缓存", value: clientLimits.lyric + " 首" },
          el("input", { type: "number", className: "nm-set2-num", min: 0, max: 5000, step: 20,
            value: clientLimits.lyric, title: "0 = 不缓存",
            onChange: (e) => setClientLimit("lyric", e.target.value) })),
        el(SetRow, { label: "封面分析缓存", value: clientLimits.cover + " 张" },
          el("input", { type: "number", className: "nm-set2-num", min: 0, max: 5000, step: 100,
            value: clientLimits.cover, title: "0 = 不缓存",
            onChange: (e) => setClientLimit("cover", e.target.value) })),
        el(SetRow, { label: "音质探测（宿主）", value: (cache.quality === undefined ? "—" : cache.quality + " 首 / " + cacheMax) }),
        el(SetRow, { label: "缓存目录" },
          el("input", { type: "text", className: "nm-set2-text",
            value: (store.settings.cache && store.settings.cache.dir) || "",
            placeholder: "留空 = 与配置文件同目录",
            onChange: (e) => setCache({ dir: e.target.value.trim() }) })),
        el("div", { className: "nm-set2-hint" },
          "配置文件：" + (cache.configFile || "（未连接宿主）") + " · 缓存文件：" + (cache.cacheFile || "（未连接宿主）")),
        el("div", { className: "nm-set2-actions" },
          el("button", { className: "nm-set2-btn nm-set2-btn-ghost", onClick: () => refreshCacheStats(true) }, "刷新统计"),
          el("button", {
            className: "nm-set2-btn nm-set2-btn-ghost",
            onClick: async function () {
              try {
                const res = await api("/cache/clear", { scope: "quality" });
                setNotice("已清理音质探测缓存：" + ((res && res.cleared) || 0) + " 首");
              } catch (err) { setNotice("清理失败：" + (err && err.message ? err.message : err)); }
              refreshCacheStats(true);
            },
          }, "清理探测缓存"),
          el("button", {
            className: "nm-set2-btn nm-set2-btn-ghost",
            onClick: function () {
              const n = lyricCache.size + SkinPalette.cacheSize();
              lyricCache.clear(); SkinPalette.clearCache();
              setNotice("已清理本页缓存：" + n + " 项"); emit();
            },
          }, "清理本页缓存"))),

      // ═══ 账号 ═══
      el(SetSection, { id: "account", title: "账号" },
        el(SetRow, { label: "状态", value: loginName ? "已登录：" + loginName : "未登录" }),
        store.qr && store.qr.img
          ? el("div", { className: "nm-set2-hint" }, el("img", { className: "nm-qr nm-qr-sm", src: store.qr.img, alt: "登录二维码" }))
          : null,
        store.qr && !store.qr.img ? el("div", { className: "nm-set2-hint" }, store.qr.message || "") : null,
        el("div", { className: "nm-set2-actions" },
          loginName ? null : el("button", {
            className: "nm-set2-btn nm-set2-btn-accent",
            onClick: startQrLogin,
          }, store.qr && store.qr.state === "waiting" ? "重新生成二维码" : "扫码登录"),
          loginName ? el("button", { className: "nm-set2-btn nm-set2-btn-danger", onClick: doLogout }, "退出登录") : null),
        el(SetRow, { label: "直连 music.163.com", value: store.api.ready ? "已启用" : "未就绪" }),
        el("div", { className: "nm-set2-actions" },
          el("button", {
            className: "nm-set2-btn nm-set2-btn-ghost",
            onClick: async function () {
              const res = await hostPost("/restart", {});
              store.api = { ready: res.ok === true, port: 0 };
              emit(); setNotice("直连模式：无需重启本地服务");
            },
          }, "自检连接")))));
}
