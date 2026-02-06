// Service Worker for Higanbana VFS
// NOTE: 由于主 tsconfig 包含 DOM lib，这里使用类型断言避免 self 类型冲突

import { injectHbHtmlRuntime } from './hbHtmlRuntime';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_PREFIX = 'st-higanbana-vfs-';

function getVfsBasePath(): string {
  // registration.scope ends with trailing slash
  return new URL('vfs/', sw.registration.scope).pathname;
}

function parseVfsRequest(url: URL): { projectId: string; innerPath: string; vfsBasePath: string } | null {
  const vfsBasePath = getVfsBasePath();
  const pathname = url.pathname;
  if (!pathname.startsWith(vfsBasePath)) return null;

  const rest = pathname.slice(vfsBasePath.length); // "<projectId>/<pathInside>"
  const idx = rest.indexOf('/');
  if (idx <= 0) return null;

  const projectId = decodeURIComponent(rest.slice(0, idx));
  const innerPath = rest.slice(idx + 1);
  if (!projectId || !innerPath) return null;

  return { projectId, innerPath, vfsBasePath };
}

sw.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(sw.skipWaiting());
});

sw.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(sw.clients.claim());
});

sw.addEventListener('message', event => {
  const data = event.data;
  if (data?.type === 'HB_SKIP_WAITING') {
    sw.skipWaiting();
  }
});

sw.addEventListener('fetch', (event: FetchEvent) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const vfsInfo = parseVfsRequest(url);
  if (!vfsInfo) return;

  const cacheName = `${CACHE_PREFIX}${vfsInfo.projectId}`;
  event.respondWith(
    (async () => {
      const cache = await caches.open(cacheName);
      const cached = await cache.match(request);
      if (cached) {
        // 给 VFS 的 HTML 页面注入运行时兼容层：
        // - 自动处理 CSRF（新标签页打开时不会 403）
        // - 提供 ST_API 代理（可选；若主页面有 ST_API）
        // - 提供跨域测高上报（父页面可选监听）
        try {
          const ct = String(cached.headers.get('content-type') || '').toLowerCase();
          const accept = String(request.headers.get('accept') || '').toLowerCase();
          const dest = (request as any).destination as string | undefined;
          const isDocument = request.mode === 'navigate' || dest === 'document';
          const isHtml = ct.includes('text/html') || accept.includes('text/html');
          // 只注入“文档导航”的 HTML，避免用户在页面内 fetch('template.html') 时意外被注入脚本
          if (!isDocument) return cached;
          if (!isHtml) return cached;

          const raw = await cached.clone().text();
          const patched = injectHbHtmlRuntime(raw, { origin: url.origin, forceBaseHref: false });

          // Preserve original headers as much as possible
          const headers = new Headers(cached.headers);
          if (!headers.get('content-type')) {
            headers.set('content-type', 'text/html; charset=utf-8');
          }
          return new Response(patched, { status: cached.status, statusText: cached.statusText, headers });
        } catch {
          return cached;
        }
      }

      // 404 fallback (do not fall back to network; the VFS only exists in cache)
      const accept = request.headers.get('accept') || '';
      const isHtml = request.mode === 'navigate' || accept.includes('text/html');
      if (isHtml) {
        return new Response(
          `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>彼岸花 VFS 404</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;line-height:1.4;margin:20px}
  code{background:rgba(127,127,127,.15);padding:2px 6px;border-radius:6px}
</style>
<h2>资源未找到（VFS）</h2>
<p>请求的文件不在缓存中：<code>${url.pathname}</code></p>
<p>请回到酒馆页面重新导入/允许该角色的 WebZip，或确认入口页引用资源路径是否正确（建议使用相对路径）。</p>`,
          { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        );
      }
      return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })(),
  );
});

