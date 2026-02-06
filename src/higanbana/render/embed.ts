import { buildVfsUrl } from '../../webzip';
import type { HiganbanaProject } from '../card';
import { isProjectCached } from '../cache';
import { extensionBase } from '../env';
import { isAvatarAllowed } from '../avatarAllow';
import { getActiveCharacter, getCharacterAvatar } from '../st';
import { installIframeAutoResize } from './iframeAutoResize';

export type RenderTarget =
  | { kind: 'iframe'; src: string; title: string }
  | { kind: 'stub'; title: string; reason: string };

export function resolveProjectRenderTarget(project: HiganbanaProject): RenderTarget {
  const active = getActiveCharacter();
  if (!active) {
    return { kind: 'stub', title: '彼岸花：无法渲染', reason: '当前不在单角色聊天/未选中角色。' };
  }

  const name = project.title || project.zipName;
  const avatar = getCharacterAvatar(active.character);
  if (avatar && !isAvatarAllowed(avatar)) {
    return {
      kind: 'stub',
      title: `彼岸花：未启用（${name}）`,
      reason:
        project.source === 'url'
          ? '该角色卡绑定了 WebZip URL，但尚未允许/下载。切换到该角色时会弹窗询问，或在面板/弹窗中下载并导入缓存。'
          : '该角色卡包含嵌入 WebZip，但尚未允许/导入。切换到该角色时会弹窗询问，或在面板点“导入所有嵌入项目到本地缓存”。',
    };
  }

  const projectId = project.zipSha256;
  if (!projectId) {
    return {
      kind: 'stub',
      title: `彼岸花：未下载（${name}）`,
      reason: project.source === 'url' ? '请在面板/弹窗中下载并导入缓存后即可渲染。' : '缺少 projectId，无法渲染。',
    };
  }
  if (!isProjectCached(projectId)) {
    return {
      kind: 'stub',
      title: `彼岸花：未导入缓存（${name}）`,
      reason: project.source === 'url' ? '请下载并导入缓存后即可渲染。' : '请先导入到本地缓存（面板中可操作），再刷新聊天即可渲染。',
    };
  }

  const src = buildVfsUrl(extensionBase, projectId, project.homePage);
  return { kind: 'iframe', src, title: `彼岸花：${name} · ${project.homePage}` };
}

export function createEmbedNode(
  messageId: number,
  index: number,
  target: RenderTarget,
  opts: {
    projectId?: string;
    showTitleInChat?: boolean;
    /** 打开到新标签页的 URL（可与 iframe 实际 src 不同，例如 blob 渲染时仍打开 VFS URL） */
    openInNewTabUrl?: string;
    /** 是否以 Blob URL 渲染（分配页面）。仅影响 RenderTarget.kind === 'iframe' */
    useBlobUrlInChat?: boolean;
  } = {},
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'hb-embed';
  wrapper.dataset.hbEmbed = '1';
  wrapper.classList.add(target.kind === 'stub' ? 'hb-embed-stub' : 'hb-embed-iframe');
  if (opts.projectId) wrapper.dataset.hbProjectId = opts.projectId;
  const showTitleInChat = opts.showTitleInChat === true;
  if (!showTitleInChat) wrapper.classList.add('hb-embed-no-title');

  const header = document.createElement('div');
  header.className = 'hb-embed-header';

  const left = document.createElement('div');
  left.className = 'hb-embed-title';
  left.textContent = target.title;

  const right = document.createElement('div');
  right.className = 'hb-embed-actions';
  if (target.kind === 'iframe') {
    const link = document.createElement('a');
    link.href = opts.openInNewTabUrl || target.src;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = '新标签页打开';
    right.appendChild(link);
  }

  header.appendChild(left);
  header.appendChild(right);
  wrapper.appendChild(header);

  const body = document.createElement('div');
  body.className = 'hb-embed-body';

  if (target.kind === 'stub') {
    const tip = document.createElement('div');
    tip.style.padding = '10px';
    tip.style.opacity = '0.9';
    tip.textContent = target.reason;
    body.appendChild(tip);
    wrapper.appendChild(body);
    return wrapper;
  }

  const iframe = document.createElement('iframe');
  iframe.className = 'hb-iframe';
  iframe.loading = 'lazy';
  iframe.referrerPolicy = 'no-referrer';
  iframe.name = `hb-${messageId}-${index}`;
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  // 记录该 iframe 的“原始 VFS 入口”和渲染模式，方便后续在不重渲染消息的情况下切换模式
  //（例如在面板里开关“Blob 分配页面”）
  const useBlob = Boolean(opts.projectId) || opts.useBlobUrlInChat === true;
  try {
    (iframe as any).dataset = (iframe as any).dataset || {};
    (iframe as any).dataset.hbVfsHomeUrl = target.src;
    (iframe as any).dataset.hbUseBlobUrl = useBlob ? '1' : '0';
  } catch {
    //
  }
  if (useBlob) {
    // 先渲染一个轻量 loading 页面，避免重复加载 VFS（blob 生成成功后再切换）
    iframe.removeAttribute('src');
    iframe.srcdoc = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;margin:16px;opacity:.85}</style><div>正在加载…</div>`;
    void applyProjectBlobUrlToIframe(iframe, target.src);
  } else {
    iframe.removeAttribute('srcdoc');
    iframe.src = target.src;
  }
  installIframeAutoResize(iframe);
  body.appendChild(iframe);
  wrapper.appendChild(body);
  return wrapper;
}

type BlobCacheEntry = {
  promise: Promise<string>;
  url?: string;
};

// key: vfsHomeUrl
const projectHomeBlobCache = new Map<string, BlobCacheEntry>();

function buildProjectBlobWrapperHtml(vfsHomeUrl: string): string {
  const vfsUrl = String(vfsHomeUrl ?? '').trim();
  const safeUrl = JSON.stringify(vfsUrl);
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      *{box-sizing:border-box}
      html,body{margin:0;padding:0;width:100%}
      #inner{display:block;width:100%;border:0;height:260px}
      .loading{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;margin:12px;opacity:.85}
    </style>
  </head>
  <body>
    <div class="loading" id="loading">正在加载…</div>
    <iframe id="inner" sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer"></iframe>
    <script>
      const VFS_URL = ${safeUrl};
      const inner = document.getElementById('inner');
      const loading = document.getElementById('loading');
      const clamp = (h) => Math.max(80, Math.min(Number(h) || 0, 10000));
      const setHeight = (h) => {
        const px = clamp(h);
        if (!px) return;
        inner.style.height = px + 'px';
      };

      try { inner.name = String(window.name || ''); } catch {}
      try { inner.src = VFS_URL; } catch {}

      inner.addEventListener('load', () => {
        try { if (loading) loading.style.display = 'none'; } catch {}
      });

      window.addEventListener('message', (ev) => {
        const data = ev && ev.data;
        if (!data || typeof data !== 'object') return;

        // Height message from inner
        if (ev.source === inner.contentWindow && data.type === 'HB_IFRAME_HEIGHT') {
          setHeight(data.height);
          return;
        }

        // Bridge messages between inner <-> parent (for ST_API / CSRF proxy)
        if (data.__hb === 'higanbana' && data.v === 1) {
          try {
            if (ev.source === inner.contentWindow) {
              window.parent && window.parent.postMessage(data, '*');
              return;
            }
            if (ev.source === window.parent) {
              inner.contentWindow && inner.contentWindow.postMessage(data, '*');
            }
          } catch {
            // ignore
          }
        }
      });
    </script>
  </body>
</html>`;
}

async function getProjectHomeBlobUrl(vfsHomeUrl: string): Promise<string> {
  const key = String(vfsHomeUrl ?? '').trim();
  if (!key) throw new Error('vfsHomeUrl is required');
  const cached = projectHomeBlobCache.get(key);
  if (cached) return await cached.promise;

  const entry: BlobCacheEntry = {
    promise: (async () => {
      const html = buildProjectBlobWrapperHtml(key);
      const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      entry.url = blobUrl;
      return blobUrl;
    })(),
  };
  projectHomeBlobCache.set(key, entry);
  return await entry.promise;
}

async function applyProjectBlobUrlToIframe(iframe: HTMLIFrameElement, vfsHomeUrl: string): Promise<void> {
  try {
    const expected = String(vfsHomeUrl ?? '').trim();
    if (!expected) return;
    (iframe as any).dataset = (iframe as any).dataset || {};
    (iframe as any).dataset.hbVfsHomeUrl = expected;
    (iframe as any).dataset.hbUseBlobUrl = '1';

    const blobUrl = await getProjectHomeBlobUrl(expected);
    // 期间可能被移除/切换项目/关闭 blob 模式
    if (!iframe.isConnected) return;
    const curExpected = String((iframe as any).dataset?.hbVfsHomeUrl ?? '');
    const curUseBlob = String((iframe as any).dataset?.hbUseBlobUrl ?? '') === '1';
    if (!curUseBlob || curExpected !== expected) return;

    iframe.removeAttribute('srcdoc');
    iframe.src = blobUrl;
  } catch (err) {
    console.warn('[Higanbana] blob render failed, fallback to VFS', { vfsHomeUrl, err });
    // Fallback to VFS url
    try {
      if (!iframe.isConnected) return;
      iframe.removeAttribute('srcdoc');
      iframe.src = String(vfsHomeUrl ?? '');
    } catch {
      //
    }
  }
}

export function updateEmbedTitleVisibilityForProject(projectId: string, showTitleInChat: boolean): void {
  if (!projectId) return;
  const list = document.querySelectorAll<HTMLElement>('.hb-embed[data-hb-project-id]');
  for (const el of list) {
    if (String((el as any).dataset?.hbProjectId ?? '') !== projectId) continue;
    if (showTitleInChat) el.classList.remove('hb-embed-no-title');
    else el.classList.add('hb-embed-no-title');
  }
}

/**
 * 项目渲染策略：一律使用 Blob URL。
 * - 新渲染的项目 embed 会直接走 blob
 * - 旧版本遗留的 VFS 直连 embed，在重新处理消息时会被“升级”为 blob
 */
export function ensureProjectEmbedsUseBlob(): void {
  const list = document.querySelectorAll<HTMLElement>('.hb-embed.hb-embed-iframe[data-hb-project-id]');
  for (const el of list) {
    const iframe = el.querySelector<HTMLIFrameElement>('iframe.hb-iframe');
    if (!iframe) continue;
    const curSrc = String(iframe.src || '');
    if (curSrc.startsWith('blob:')) continue;

    const link = el.querySelector<HTMLAnchorElement>('.hb-embed-actions a');
    const vfsUrl = String(link?.href || (iframe as any).dataset?.hbVfsHomeUrl || curSrc || '').trim();
    if (!vfsUrl) continue;

    // quick loading page then switch to blob wrapper
    iframe.removeAttribute('src');
    iframe.srcdoc = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;margin:16px;opacity:.85}</style><div>正在加载…</div>`;
    void applyProjectBlobUrlToIframe(iframe, vfsUrl);
  }
}
