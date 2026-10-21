/**
 * 一个够用的 LRU 缓存。
 *
 * 为什么抽出来：客户端原本有**三套**各自手写淘汰逻辑的缓存 —— 歌词 40 条、
 * 封面分析 300 张（宿主侧还有一个音质探测缓存 800 首），每套都重复同一段舞蹈：
 *
 *     先看命中没 → 命中就先删再塞 → 超限就从最旧的开始删
 *
 * 三份实现迟早走样（上限语义不一致、某处忘了刷新命中序），而且每加一个缓存
 * 就要再抄一遍。这里是唯一的一份。
 *
 * 对外形状刻意做成和 Map 一样（has / get / set / delete / clear / size），
 * 所以调用点几乎不用改；唯一的差别是：**get 会把命中的键刷成最新** ——
 * 这正是原来那段手写舞蹈想表达的意思。
 */
const LruCache = (() => {
  /**
   * @param {number} max 上限。超过就从头（最久未使用）淘汰。
   */
  function create(max) {
    const map = new Map();
    // 上限可变：设置页允许用户改"缓存的页面上限"，改完要立刻生效而不是等重建。
    let limit = Math.max(0, Number(max) || 0);
    const evict = () => {
      // 上限 0 表示"不缓存"：全部清掉（而不是无限增长）。
      while (map.size > limit) map.delete(map.keys().next().value);
    };
    return {
      get size() {
        return map.size;
      },
      get max() {
        return limit;
      },
      has: (k) => map.has(k),
      get(k) {
        if (!map.has(k)) return undefined;
        const v = map.get(k);
        // 命中即刷新：LRU 的"最近使用"就体现在这里
        map.delete(k);
        map.set(k, v);
        return v;
      },
      set(k, v) {
        if (limit <= 0) return; // 不缓存模式：直接丢
        if (map.has(k)) map.delete(k);
        map.set(k, v);
        evict();
      },
      delete: (k) => map.delete(k),
      clear: () => map.clear(),
      /** 改上限：调小立即淘汰最久未使用的，调大只改上限。 */
      resize(n) {
        limit = Math.max(0, Number(n) || 0);
        evict();
      },
    };
  }
  return { create };
})()
