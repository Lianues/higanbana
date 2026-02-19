# Higanbana API 接口说明（CRUD）

> 适用范围：由彼岸花渲染的 WebZip 页面（`/vfs/<zipSha256>/...`）及其同源子页面（运行时会直连复用上层同源全局）。

---

## 1) 可用接口总览

当前可用的项目管理 API：

- `window.Higanbana.getProject(payload?)`  （Read）
- `window.Higanbana.createProject(payload)`      （Create）
- `window.Higanbana.updateProject(payload)`      （Update）
- `window.Higanbana.deleteProject(payload?)`     （Delete）

同样也可用小写别名对象：`window.higanbana.xxx(...)`。

另外在主页面会直接注册全局：

- `window.Higanbana`
- `window.higanbana`
- `SillyTavern.libs.higanbana`

这样在酒馆主页面脚本里可以统一直接调用，不需要区分入口。

运行模型说明：

- 当前为**插件内桥接模型（BroadcastChannel RPC）**。
- WebZip 页面中的 `window.Higanbana / window.higanbana / window.ST_API` 为桥接代理对象。
- 新标签页场景不依赖 `opener` 直连。

> ⚠ 注意：请不要在项目页里手动执行类似 `window.Higanbana = top.Higanbana`、`window.ST_API = top.ST_API` 的覆盖逻辑。
> 这会绕过桥接代理，导致“当前项目自动推断”失效，进而出现 `缺少目标项目标识` 报错。

---

## 注意事项（强烈建议）

1. **不要手动覆盖桥接全局对象**：避免 `window.Higanbana = top.Higanbana` / `window.ST_API = top.ST_API`。
2. **在项目页执行更新/删除更稳**：即 URL 形如 `/vfs/<zipSha256>/...`，可自动推断当前目标。
3. **跨页调用时显式传目标**：请传 `targetProjectId` 或 `targetZipSha256`，不要依赖自动推断。

---

## 2) 通用规则

### 2.1 目标项目定位（用于 Read/Update/Delete）

可通过以下任一方式指定目标：

- `targetProjectId`（推荐，精确）
- `targetZipSha256`

若都不传：

- 在 `/vfs/<zipSha256>/...` 页面中，会自动尝试按“当前页面 zipSha256”匹配当前项目。
- 若无法推断：`getProject` 默认返回全部项目；`update/delete` 会报缺少目标错误。

### 2.2 刷新行为

`create/update/delete` 成功后默认会：

1. 写回角色卡 `extensions.higanbana.projects`
2. 默认刷新当前聊天（`reloadChat !== false`）
3. 刷新项目列表 UI
4. 重新处理消息渲染

---

## 3) 类型速览

```ts
type SourceType = 'embedded' | 'url' | 'local';

type HiganbanaProjectManagePayload = {
  targetProjectId?: string;
  targetZipSha256?: string;

  source?: SourceType;
  title?: string;
  placeholder?: string;
  homePage?: string;
  showTitleInChat?: boolean;
  fixRootRelativeUrls?: boolean;

  zipName?: string;
  zipSha256?: string;
  zipUrl?: string;
  zipBase64?: string;

  // 导入新 zip 用（推荐）
  importZipBase64?: string;
  zipArrayBuffer?: ArrayBuffer | Uint8Array;
  zipBlob?: Blob;

  preferredHomePage?: string;
  persistEmbeddedToCard?: boolean;
  reloadChat?: boolean;
};

type HiganbanaProjectQueryPayload = {
  targetProjectId?: string;
  targetZipSha256?: string;
  includeAll?: boolean;
};
```

---

## 4) Read：获取项目配置

## `getProject(payload?)`

### 入参

```ts
type GetProjectPayload = {
  targetProjectId?: string;
  targetZipSha256?: string;
  includeAll?: boolean; // true 时返回全部项目
};
```

### 返回

```ts
type GetProjectResult = {
  projects: HiganbanaProject[];
  project?: HiganbanaProject; // 指定目标时返回
};
```

### 示例

#### 读取“当前项目”（自动推断）
```js
const r = await window.Higanbana.getProject();
console.log(r.project || r.projects[0]);
```

#### 读取全部项目
```js
const r = await window.Higanbana.getProject({ includeAll: true });
console.log(r.projects);
```

#### 读取指定项目
```js
const r = await window.Higanbana.getProject({
  targetProjectId: 'a3f3f2b6-2f9f-4e4a-9e85-4c0f8ac6d233',
});
console.log(r.project);
```

---

## 5) Create：创建新项目

## `createProject(payload)`

### 入参（核心）

```ts
type CreateProjectPayload = {
  source?: 'embedded' | 'url' | 'local';
  title?: string;
  placeholder?: string;          // 不传会自动生成并保证唯一
  homePage?: string;             // 不传默认 index.html
  showTitleInChat?: boolean;
  fixRootRelativeUrls?: boolean;

  zipName?: string;
  zipSha256?: string;            // source=local 且不导入 zip 时必填
  zipUrl?: string;               // source=url 时必填
  zipBase64?: string;            // source=embedded 且不导入 zip 时必填

  importZipBase64?: string;      // 导入 zip（三选一）
  zipArrayBuffer?: ArrayBuffer | Uint8Array;
  zipBlob?: Blob;

  preferredHomePage?: string;
  persistEmbeddedToCard?: boolean;
  reloadChat?: boolean;
};
```

### 返回

```ts
type CreateProjectResult = {
  project: HiganbanaProject;
  imported?: {
    projectId: string;
    homePage: string;
    fileCount: number;
    cacheName: string;
  };
};
```

### 示例

#### A. 推荐：导入 zip 并创建 local 项目
```js
const buf = await (await fetch('/update/app.zip')).arrayBuffer();

const r = await window.Higanbana.createProject({
  source: 'local',
  zipArrayBuffer: buf,
  zipName: 'app.zip',
  title: '我的应用',
  placeholder: '{{MY_APP}}',
  preferredHomePage: 'index.html',
});

console.log(r.project.id, r.imported?.projectId);
```

#### B. 创建 URL 项目
```js
const r = await window.Higanbana.createProject({
  source: 'url',
  zipUrl: 'https://example.com/app.zip',
  title: '远程项目',
  placeholder: '{{REMOTE_APP}}',
  homePage: 'index.html',
});
```

#### C. 创建 embedded 项目（不推荐大包）
```js
const r = await window.Higanbana.createProject({
  source: 'embedded',
  zipArrayBuffer: myZipBuffer, // 推荐传 buffer，让系统自动算 zipSha256/homePage
  zipName: 'embed.zip',
  title: '嵌入项目',
});
```

> `embedded` 模式仍受 20MB 限制。

---

## 6) Update：更新项目

## `updateProject(payload)`

通用更新入口：

- 只传普通字段：更新配置
- 传 `zipArrayBuffer / zipBlob / importZipBase64`：先导入新 zip，再覆盖旧项目

### 示例

#### 更新指定项目配置
```js
await window.Higanbana.updateProject({
  targetProjectId: 'a3f3f2b6-2f9f-4e4a-9e85-4c0f8ac6d233',
  title: '新标题',
  placeholder: '{{TOOLBOX}}',
});
```

#### 导入新 zip 并覆盖当前项目
```js
const buf = await (await fetch('/update/app.zip')).arrayBuffer();

const r = await window.Higanbana.updateProject({
  zipArrayBuffer: buf,
  zipName: 'app.zip',
  source: 'local',
  preferredHomePage: 'index.html',
});

console.log(r.imported?.projectId);
```

---

## 7) Delete：删除项目

## `deleteProject(payload?)`

### 入参

```ts
type DeleteProjectPayload = {
  targetProjectId?: string;
  targetZipSha256?: string;
  reloadChat?: boolean;
};
```

### 返回

```ts
type DeleteProjectResult = {
  deletedProjectId: string;
  deletedProject: HiganbanaProject;
  remainingCount: number;
};
```

### 示例

#### 删除指定项目
```js
await window.Higanbana.deleteProject({
  targetProjectId: 'a3f3f2b6-2f9f-4e4a-9e85-4c0f8ac6d233',
});
```

#### 删除当前项目（自动推断）
```js
await window.Higanbana.deleteProject();
```

---

## 8) 常见报错

| 报错 | 原因 |
|---|---|
| `缺少目标项目标识，请提供 targetProjectId 或 targetZipSha256` | update/delete 没传目标，且当前页面无法推断目标项目。 |
| `找不到目标项目：...` | 传入的 `targetProjectId` 不存在。 |
| `占位符已被其它项目占用：...` | update 时 placeholder 与其他项目冲突。 |
| `source=url 时 zipUrl 不能为空` | 创建或更新为 URL 模式时未提供 `zipUrl`。 |
| `source=local 时 zipSha256 不能为空...` | local 模式未提供 zipSha256，也未提供可导入 zip 数据。 |
| `当前 zip 大小为 ...，超过嵌入上限（20 MB）` | embedded 模式超过上限。 |

---

## 9) 最小封装建议

```js
function getHbApi() {
  const api = window.Higanbana || window.higanbana;
  if (!api) throw new Error('Higanbana API 不可用');
  return api;
}

async function hbCrudDemo() {
  const api = getHbApi();

  const all = await api.getProject({ includeAll: true });
  console.log('all projects', all.projects);

  const created = await api.createProject({ source: 'url', zipUrl: 'https://example.com/app.zip' });
  console.log('created', created.project.id);

  await api.updateProject({ targetProjectId: created.project.id, title: 'Updated title' });

  await api.deleteProject({ targetProjectId: created.project.id });
}
```
