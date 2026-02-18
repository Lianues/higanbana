# 彼岸花 (Higanbana)

SillyTavern 扩展「彼岸花」，提供 **Zip 前端沙盒渲染**：用户可导入前端项目压缩包（含 HTML/CSS/JS 等），在消息历史中通过占位符或 HTML 代码块进行沙盒渲染，资源由 Service Worker + Cache 复用。

---

## 功能概览

- **多项目与角色卡绑定**：将多个 WebZip 项目绑定到当前角色卡，导出角色卡时一并导出项目配置与占位符。
- **占位符渲染**：在消息正文中写入配置好的占位符（如 `{{my-app}}`），会被替换为对应项目的首页 iframe 沙盒。
- **HTML 代码块渲染**：消息中的 HTML 代码块（\`\`\`html ... \`\`\`）在设置开启时，以独立 blob URL 在 iframe 中沙盒渲染，可配置是否显示标题栏等。
- **资源复用**：同一项目在多个占位符或多次出现时，共用同一份 Cache 与 VFS 路径，由 Service Worker 统一拦截并返回 zip 内资源。
- **URL 绑定**：支持仅保存 zip 的 URL，进入聊天时再下载并显示进度，支持取消；也可在面板内重新下载并应用。
- **项目自管理 API（CRUD）**：采用同源直连模型，WebZip 页面可直接使用 `window.Higanbana.getProject / createProject / updateProject / deleteProject` 管理项目。

---

## 构建与使用

- 安装依赖：`npm install`
- 构建：`npm run build`
- 扩展入口为 `src/index.ts`，构建产物在 `dist/`（`index.js`、`sw.js`、`style.css`）；manifest 指向 `dist/index.js`。
- 将整个扩展目录放入 SillyTavern 的 `scripts/extensions/` 下即可使用。

---

## 目录结构

```
higanbana/                    # 项目根目录
├── README.md                 # 本文件
├── manifest.json
├── package.json
├── public/
│   ├── settings.html         # 设置面板
│   └── embeddedWebzip.html   # 嵌入 WebZip 确认弹窗模板
├── src/
│   ├── index.ts              # 入口（样式 + 启动 higanbana）
│   ├── style.css
│   ├── sw.ts                 # Service Worker（VFS 拦截）
│   ├── webzip.ts             # zip 解压、VFS URL、导入/下载
│   ├── global.d.ts
│   └── higanbana/            # 核心逻辑模块
│       ├── env.ts            # 环境常量（extensionBase、swUrl）
│       ├── settings.ts       # 插件设置读写与默认值
│       ├── card.ts            # 角色卡 WebZip 项目数据与读写
│       ├── cache.ts           # 已缓存项目列表
│       ├── swRegister.ts      # Service Worker 注册与激活
│       ├── st.ts              # 酒馆全局上下文
│       ├── avatarAllow.ts     # 项目头像权限
│       ├── utils.ts / progress.ts
│       ├── app.ts             # 初始化与事件绑定
│       ├── render/            # 占位符、embed、HTML 代码块、iframe 自适应
│       ├── ui/                # 面板、项目列表、状态、事件绑定
│       ├── popup/             # 缺缓存弹窗、导入队列
│       └── actions/           # 项目动作（绑定、下载、导出、删除等）
└── dist/                     # 构建输出
```

---

## 依赖关系简述

- `app.ts` 在酒馆 `APP_READY` 后执行：注册 SW → 刷新缓存 → 加载面板与设置 → 绑定消息与角色钩子。
- 占位符替换依赖当前角色项目列表与 `embed` 生成的 iframe；HTML 代码块由 `htmlBlocks` 按设置渲染。
- 项目增删改由 `actions/projects.ts` 处理，缺缓存时由 `popup/missingProjects.ts` 提示并支持下载队列。

此文档便于从项目根目录了解彼岸花的结构与构建方式。

---

## 项目内可用的管理函数（运行时注入）

主页面会直接挂全局：`window.Higanbana` / `window.higanbana`（同时可从 `SillyTavern.libs.higanbana` 访问）。

当前为**纯同源直连模型**：彼岸花注入的运行时会直接复用 `parent/top/opener` 的同源全局对象（如 `Higanbana`、`ST_API`、`SillyTavern`），
不再依赖 `postMessage/BroadcastChannel` 旧桥接。

因此在同源页面中可统一直接调用 API，不再区分“必须在 VFS 页面里才有 API”。


在由彼岸花渲染的 WebZip 页面里，可直接调用：

```js
// 1) 覆盖“当前项目”（默认按当前页面的 /vfs/<zipSha256>/... 推导目标）
await window.Higanbana.updateProject({
  title: '新标题',
  homePage: 'index.html',
  source: 'local',
  zipSha256: '新的sha256',
});

// 2) 覆盖“指定项目”（优先用 targetProjectId 精确定位）
await window.Higanbana.updateProject({
  targetProjectId: 'project-uuid',
  placeholder: '{{WEB_APP2}}',
  showTitleInChat: true,
});

// 3) 导入“新的 zip”并覆盖当前项目（推荐用于项目自更新）
const buf = await (await fetch('/update/app.zip')).arrayBuffer();
await window.Higanbana.updateProject({
  zipArrayBuffer: buf,
  zipName: 'app.zip',
  source: 'local', // 建议 local，避免把 zipBase64 写入角色卡
  preferredHomePage: 'index.html',
});

// 4) 指定项目 + zipBlob 也可（会先导入 zip，再覆盖）
await window.Higanbana.updateProject({
  targetProjectId: 'project-uuid',
  zipBlob: fileInput.files[0],
  source: 'local',
});

// 5) 纯文本场景可用 importZipBase64
await window.Higanbana.updateProject({ importZipBase64: 'UEsDB...' });
```

说明：调用后会写回当前激活角色卡的 `extensions.higanbana.projects`，并触发 UI 刷新（默认会刷新当前聊天）。`source=embedded` 时会写入 `zipBase64`，且受 20MB 上限约束。

更多 CRUD 接口与输入/输出示例见：`docs/API接口说明.md`
