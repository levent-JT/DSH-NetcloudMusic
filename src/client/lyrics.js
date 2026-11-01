/**
 * 歌词工具 —— 播放页（main.js）与背景图层（skin/layers.js）都要用。
 *
 * 为什么单独成文件：它不属于"皮肤"，也不属于"播放器界面" —— 它是一条纯粹的歌词规则。
 * 上一轮把它搬进 skin/layers.js 私有化了，main.js 的播放页却还在直接调它，
 * 结果是 ReferenceError → React 卸载整个 root → 整个页签空白。
 *
 * 分片在同一个 factory 作用域里按顺序拼起来，所以这里的普通函数声明对后面所有分片可见
 * （和 el / store 的可见性完全一样）。位置必须在 skin/layers.js 与 main.js 之前。
 */

/** 当前歌词行下标：最后一个 t <= 已播秒数 的行。-1 表示还没到第一行。 */
function activeLyricIndex(lines, time) {
  let current = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t <= time) current = i;
    else break;
  }
  return current;
}

/* ── 歌词解析（2026-11-01 从 main.js 归位到这）──────────────────
   这里本来就该是歌词的家 —— 分片名叫 lyrics.js 却只有 activeLyricIndex，
   而真正的解析逻辑一直住在 main.js 里。 */
    function parseLrc(text) {
      if (!text) return [];
      const lines = [];
      const re = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
      for (const raw of String(text).split("\n")) {
        const matches = [...raw.matchAll(re)];
        if (!matches.length) continue;
        const content = raw.replace(re, "").trim();
        if (!content) continue;
        const m = matches[matches.length - 1];
        const t = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + (m[3] ? parseInt(String(m[3]).padEnd(3, "0"), 10) / 1000 : 0);
        lines.push({ t, text: content });
      }
      return lines.sort((a, b) => a.t - b.t);
    }

    /**
     * 把翻译歌词按时间戳并入原文行，给每行挂 `tr`。
     *
     * 背景：宿主 /lyric 一直返回 tlyric（翻译），但客户端此前只取 lrc.lyric 就丢了，
     * 所以面板歌词只有原文——而这次要做的背景需要中英双语。
     *
     * 容差取 0.05s：实测网易云的 tlyric 与 lrc 对同一句用的是**完全相同**的时间戳
     * （如 0.30 / 2.71 / 7.63…），只需容忍毫秒解析的浮点误差。
     * 早期版本用 0.35s 会误配——lrc 开头的「作词/作曲/编曲」元信息行在 0.00~0.20s，
     * 距首句译文（0.30s）不足 0.35s，于是三行元信息都拿到了同一句翻译。
     *
     * 双指针推进，避免 O(n²)。
     */
    function mergeTranslation(lines, tlyricText) {
      if (!lines.length || !tlyricText) return lines;
      const TOL = 0.05;
      const tr = parseLrc(tlyricText);
      if (!tr.length) return lines;
      let j = 0;
      for (const line of lines) {
        while (j < tr.length - 1 && tr[j + 1].t <= line.t) j++;
        if (Math.abs(tr[j].t - line.t) <= TOL) line.tr = tr[j].text;
      }
      return lines;
    }

    // ------------------------------------------------------------- playback

    /**
     * 「当前播放序号」。每次 playIndex 自增一次。
     *
     * 为什么需要：playIndex 里要 await 取直链（网络 100~500ms）。如果用户在这期间
     * 又点了另一首，两次请求的响应回来顺序是不保证的 —— 慢的那次会把 a.src 覆盖成
     * 上一首的地址，表现是**界面显示 B、耳朵听到 A**，而且 store.song 和 audio 脱钩。
     *
     * 用法：进函数时 const myToken = ++playToken；await 回来后
     *       if (myToken !== playToken) return;   // 已经被后来的调用接管，丢弃这次结果
     */
    // ── 进度条拖拽状态 ──────────────────────────────────────────
    // 拖动时只更新显示，松手才 seek。
    // 原来的 onChange 在拖动过程中会连续触发，每次设 currentTime
    // 都会打断解码 → 卡顿、声音断续。分开之后拖动很顺。
    //
    // 为什么用独立的订阅线而不是 emit()：进度条的拖动只影响两个组件，
    // 走主 emit 会让 19 个组件连带重渲染，拖动时反而更卡。
    let seekDragging = false;
    let seekValue = 0;
    let seekTick = 0;
    const seekListeners = [];
