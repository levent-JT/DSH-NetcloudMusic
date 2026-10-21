/**
 * 封面分析：取平均主色与平均亮度，供背景自适应明暗与染色使用。
 * 
 * 为什么要单独一层：原来的压暗层是固定强度，遇到浅色封面（黑白摄影那种）
 * 整页会被冲成灰白、画面上的歌词完全糊掉。网易云的播放页背景是"封面高斯模糊"，
 * 它之所以好看，是因为颜色和明暗都跟着封面走。这个模块就是那条"跟着封面走"的链路。
 * 
 * 对外只有三个出口：取统计值、看缓存大小、清缓存。
 */
const SkinPalette = (() => {

    /**
     * 分析封面：取平均主色和平均亮度。
     *
     * 为什么必须有这一步：原来的压暗层是**固定强度**，遇到浅色封面（比如黑白摄影封面）
     * 整页会被冲成灰白、画面上的歌词完全糊掉。网易云的播放页背景是「封面高斯模糊」，
     * 但它之所以好看，是因为颜色和明暗都跟着封面走。
     *
     * 两个前提都实测过：
     *   · 网易云图床返回 access-control-allow-origin: * → canvas 不会被跨域污染；
     *   · 图床支持 ?param=WxH → 48x48 缩略图只有 2 KB（原图 1.4 MB），采样成本可忽略。
     */
    // 封面分析结果只是一对数字，体积可以忽略；设个上界纯粹是防长期挂着不刷新时无界增长。
    // 淘汰逻辑走共用的 LruCache（见 src/client/cache.js）——
    // 命中刷新和超限淘汰只有一份实现，这里只声明"上限是多少"。
    const COVER_CACHE_MAX = 300;
    const coverStatsCache = LruCache.create(COVER_CACHE_MAX);
    function analyzeCover(url) {
      const key = String(url || "").replace(/\?.*$/, "");
      if (!key) return Promise.resolve(null);
      if (coverStatsCache.has(key)) return Promise.resolve(coverStatsCache.get(key));
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          let out = null;
          try {
            const N = 24; // 24x24 采样足够稳定，且几乎不耗 CPU
            const cv = document.createElement("canvas");
            cv.width = N;
            cv.height = N;
            const cx = cv.getContext("2d", { willReadFrequently: true });
            cx.drawImage(img, 0, 0, N, N);
            const d = cx.getImageData(0, 0, N, N).data;
            let r = 0, g = 0, b = 0, lum = 0, n = 0;
            for (let i = 0; i < d.length; i += 4) {
              if (d[i + 3] < 8) continue; // 跳过全透明像素
              r += d[i]; g += d[i + 1]; b += d[i + 2];
              lum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
              n++;
            }
            if (n) out = { rgb: [r / n, g / n, b / n], lum: lum / n };
          } catch (e) {
            out = null; // 画布被污染/解码失败：退回固定强度遮罩，不影响播放
          }
          coverStatsCache.set(key, out);
          resolve(out);
        };
        img.onerror = () => {
          coverStatsCache.set(key, null);
          resolve(null);
        };
        img.src = key + "?param=48y48";
      });
    }

    /**
     * 订阅当前封面的主色/亮度。null = 还在算或取不到（此时按中间值兜底）。
     *
     * 如果调用方需要区分"还没算完"和"算完但取不到"，用 useCoverStatsSettled。
     */
    function useCoverStats(url) {
      return useCoverStatsSettled(url).stats;
    }

    /**
     * 同 useCoverStats，但额外给出 settled —— "这次分析是否已经有结论"。
     *
     * 为什么必须区分：analyzeCover 在**取不到颜色时也 resolve(null)**
     * （画布被污染、图挂了、URL 为空都走这条）。所以只看 stats === null
     * 判断不了"可以开始用这个颜色了吗"：
     *   · settled=false 且 stats=null → 还在算，等
     *   · settled=true  且 stats=null → 算完了但取不到，按中间值兜底继续
     * 拿 stats===null 当"没就绪"，会在取不到颜色时变成**永久等待**
     * （和播放器门控那个坑同一个病，见 AGENTS.pitfalls.md #33）。
     *
     * 另外加了超时兜底：图片既不 load 也不 error 时（CSP 阻断、请求挂住），
     * analyzeCover 的 Promise 永远不 resolve —— 必须自己兜，否则同样永久等待。
     */
    const STATS_TIMEOUT_MS = 3000;
    function useCoverStatsSettled(url) {
      const [state, setState] = useState({ stats: null, settled: false });
      useEffect(() => {
        let alive = true;
        let timer = null;
        setState({ stats: null, settled: false });
        const settle = (v) => {
          if (!alive) return;
          alive = false;
          if (timer) clearTimeout(timer);
          setState({ stats: v, settled: true });
        };
        // 超时兜底：到点就按"取不到"处理，让调用方可以继续
        timer = setTimeout(() => settle(null), STATS_TIMEOUT_MS);
        const p = analyzeCover(url);
        if (p && typeof p.then === "function") {
          p.then(settle, () => settle(null));
        } else {
          settle(null);
        }
        return () => {
          alive = false;
          if (timer) clearTimeout(timer);
        };
      }, [url]);
      return state;
    }

  // ── 对外接口 ──────────────────────────────────────────────
  return {
    useCoverStats,
    useCoverStatsSettled,
    /** 已缓存的封面分析数（设置页展示用）。 */
    cacheSize: () => coverStatsCache.size,
    /** 改上限：设置页允许用户调"封面缓存上限"，改完立即生效。 */
    setCacheLimit: (n) => coverStatsCache.resize(n),
    /** 清空封面分析缓存。 */
    clearCache: () => coverStatsCache.clear(),
  }
})()

