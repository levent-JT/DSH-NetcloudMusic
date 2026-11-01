/**
 * 简单图标库（2026-11-01 从 main.js 拆出）。
 *
 * 只包含"纯 SVG + 无状态"的图标；ModeIcon 留在 main.js
 * （它读 store.mode 和 modeOptions，和业务耦合）。
 *
 * el() 是 main.js 里的函数声明 —— 同一 factory 作用域内会被提升，
 * 所以这里的图标函数在运行时能调到它（和 skin/layers.js 用 el 同理）。
 */
    function svgProps(size) {
      return { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };
    }
    function IconPlay(props) {
      const p = props || {};
      return el("svg", { ...svgProps(p.size || 14), fill: "currentColor", stroke: "none" }, el("path", { d: "M8 5v14l11-7z" }));
    }
    function IconPause(props) {
      const p = props || {};
      return el("svg", { ...svgProps(p.size || 14), fill: "currentColor", stroke: "none" }, el("path", { d: "M6 5h4v14H6zM14 5h4v14h-4z" }));
    }
    function IconPrev(props) {
      const p = props || {};
      return el("svg", { ...svgProps(p.size || 14), fill: "currentColor", stroke: "none" }, el("path", { d: "M6 6h2v12H6zM20 6l-9 6 9 6z" }));
    }
    function IconNext(props) {
      const p = props || {};
      return el("svg", { ...svgProps(p.size || 14), fill: "currentColor", stroke: "none" }, el("path", { d: "M16 6h2v12h-2zM4 6l9 6-9 6z" }));
    }
    function IconMusic(props) {
      const p = props || {};
      return el("svg", { ...svgProps(p.size || 14), fill: "currentColor", stroke: "none" }, el("path", { d: "M9 18V5l12-2v13" }), el("circle", { cx: 6, cy: 18, r: 3, fill: "currentColor" }), el("circle", { cx: 18, cy: 16, r: 3, fill: "currentColor" }));
    }
    function IconClose(props) {
      const p = props || {};
      return el("svg", { ...svgProps(p.size || 14) }, el("path", { d: "M18 6L6 18M6 6l12 12" }));
    }
    function IconSearch(props) {
      const p = props || {};
      return el("svg", { ...svgProps(p.size || 14) }, el("circle", { cx: 11, cy: 11, r: 7 }), el("path", { d: "M21 21l-4.3-4.3" }));
    }
    function IconVolume(props) {
      const p = props || {};
      return el("svg", { ...svgProps(p.size || 14), fill: "currentColor", stroke: "none" }, el("path", { d: "M3 9v6h4l5 4V5L7 9H3z" }), el("path", { d: "M16 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" }));
    }
