# 第三方代码来源与许可

本插件是「直连模式」重写版，复用了以下 MIT 许可项目的代码与接口知识。
所有上游许可原文置于 `vendor/` 目录，以符合 MIT 的「保留版权声明与许可文本」要求。

## 1. 浏览器端 UI — `lib/client.js`

- **来源**：https://github.com/JasonCHTT/dsh-netease-music
- **作者**：JasonCHTT
- **许可**：MIT（原文见 `vendor/LICENSE.dsh-netease-music-JasonCHTT`）
- **复用方式**：整文件复用，保留其原始结构与注释。
- **我们的改动**：
  1. 音质档位由 3 档扩展为 7 档（`QUALITY_LABELS` / `QUALITY_LEVELS`），
     排除 `vivid`/`dolby`（返回 `type=av3a`，浏览器 `<audio>` 无法解码）。
  2. 默认音质由 `standard` 改为 `lossless`。
  3. 「本地服务」设置项文案由「运行中 · 端口 N」改为直连模式说明
     （本插件不经 NeteaseCloudMusicApi 服务，端口概念不适用）。

## 2. 二维码编码器 — `vendor/qr.mjs`

- **来源**：https://github.com/WolfGenerals/ncm-player （`index.mjs` 内的 `qrEncode` IIFE）
- **作者**：WolfGenerals
- **许可**：MIT（原文见 `vendor/LICENSE.ncm-player-WolfGenerals`）
- **复用方式**：提取 `qrEncode` 断言式 IIFE 原文。
- **我们的改动**：新增 `qrToSvgDataUrl()` 封装，把模块矩阵渲染为
  `data:image/svg+xml;base64,...`，供扫码登录的 `<img src>` 使用（Node 端零依赖）。

## 2.5 歌词背景的技术做法 — 参考 dsh-any-background（未复制代码）

- **来源**：npm 包 `dsh-any-background` v0.3.7（作者 Tkingxiao，MIT）。
  做法分析自其发布物 `lib/client.js`；本仓库未链接其 GitHub 地址是因为该地址未经核实。
- **复用方式**：**仅参考做法，代码为本项目自写**。具体借鉴了三点：
  1. 背景图层用 `document.body.prepend()` 挂一个 `position:fixed;inset:0;z-index:-1` 的
     容器，藏到界面背后；
  2. 让界面透出来的办法不是改 DOM，而是把 `--dsw-alias-bg-base` /
     `--dsw-specific-sidebar-fill` / `--dsw-alias-bg-layer-1~3` /
     `--dsw-specific-input-major` / `--dsw-specific-menu` 这些设计令牌
     改写成带 alpha 的 `rgba(...)`，且必须带 `!important`（选择器写在 `body` 上）；
  3. 读宿主的原色要在 `:root` 上读——覆写写在 `body`，因此反复应用是幂等的。
- 本项目据此实现的函数：`ensureBgLayer` / `toRgba` / `applyAmbientTokens` /
  `clearAmbientTokens` / `AmbientBg`（均在 `lib/client.js`）。

## 2.6 背景的视觉语言 — 参考 dsh-kimino-theme（未复制代码）

- **来源**：npm 包 `dsh-kimino-theme`（★40，MIT）。
- **复用方式**：**仅参考视觉配方，CSS 为本项目自写**。借鉴了三条规则：
  1. 压暗用**带色调的竖向渐变**（`rgba(4,7,18,.x)` → `rgba(8,11,28,.x)` → `rgba(14,8,26,.x)`）
     而不是一层纯黑——纯黑会把大半径模糊后的封面压成死灰；
  2. 模糊层一律带 `saturate(130%~140%)`，否则模糊会洗掉颜色、整体发灰；
  3. 面板统一「半透明底 + `backdrop-filter` + `1px` 白边 + 圆角 + 柔影」的玻璃卡片形态，
     而不是把面板背景直接调到全透明。
- 本项目据此实现：`.nm-amb-*` / `.nm-panel-page` / `.nm-player-*` 三组样式（均在 `lib/client.js` 的 CSS 模板内）。

## 3. 接口实现知识 — 无代码复制

以下项目仅作**接口定义与参数的参考**（接口路径、参数名、枚举取值属事实性信息），
未复制其代码；但它们是本项目端点映射的依据，特此致谢：

- **Binaryify/NeteaseCloudMusicApi** — https://github.com/Binaryify/NeteaseCloudMusicApi （MIT）
  网易云接口的事实标准实现。
- **NeteaseCloudMusicApiEnhanced/api-enhanced** — https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced
  `module/song_url_v1.js` 给出了权威音质枚举（`standard / exhigh / lossless / hires /
  jyeffect(高清臻音) / vivid(臻音全景声) / jymaster(超清母带) / sky(沉浸环绕声)`），
  以及 `encodeType` 恒用 `flac` 的做法；`module/cloudsearch.js`、
  `module/login_qr_*.js`、`module/personal_fm.js` 提供了对应端点映射。

## 4. Host 半 — `lib/index.js`

本项目自行编写（直连模式），未复用上述任何项目的 Host 代码。

## 免责声明

本插件通过网易云的**非公开 Web 接口**访问音乐资源，仅供个人学习与技术研究使用。
所播放/下载内容的版权归版权方与网易云音乐平台所有。请遵守网易云音乐服务条款
与当地法律法规；因使用本插件导致的账号风控、限流或版权纠纷，由使用者自行承担。
