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
