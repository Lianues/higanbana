export type WebzipImportOptions = {
  /** 是否尝试修复形如 `/assets/x.js` 的根路径引用为 VFS 路径 */
  fixRootRelativeUrls: boolean;
  /** 期望的入口页（若存在） */
  preferredHomePage?: string;
};

export type WebzipImportResult = {
  projectId: string; // sha256 hex
  homePage: string;
  htmlFiles: string[];
  fileCount: number;
  cacheName: string;
};

const CACHE_PREFIX = 'st-higanbana-vfs-';

function encodePathSegments(path: string): string {
  return String(path)
    .split('/')
    .map(seg => encodeURIComponent(seg))
    .join('/');
}

export function buildVfsUrl(extensionBase: string, projectId: string, innerPath: string): string {
  return `${extensionBase}vfs/${encodeURIComponent(projectId)}/${encodePathSegments(innerPath)}`;
}

export function getVfsBasePathname(extensionBase: string, projectId: string): string {
  const basePath = new URL(extensionBase).pathname; // ends with /dist/
  return `${basePath}vfs/${encodeURIComponent(projectId)}/`;
}

export function getCacheName(projectId: string): string {
  return `${CACHE_PREFIX}${projectId}`;
}

export async function isProjectCached(projectId: string): Promise<boolean> {
  const cacheName = getCacheName(projectId);
  const keys = await caches.keys();
  return keys.includes(cacheName);
}

export async function clearProjectCache(projectId: string): Promise<boolean> {
  return caches.delete(getCacheName(projectId));
}

export function guessContentTypeByPath(path: string): string {
  const lower = String(path).toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html; charset=utf-8';
  if (lower.endsWith('.css')) return 'text/css; charset=utf-8';
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'application/javascript; charset=utf-8';
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
  if (lower.endsWith('.map')) return 'application/json; charset=utf-8';
  if (lower.endsWith('.txt')) return 'text/plain; charset=utf-8';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.avif')) return 'image/avif';
  if (lower.endsWith('.ico')) return 'image/x-icon';
  if (lower.endsWith('.woff2')) return 'font/woff2';
  if (lower.endsWith('.woff')) return 'font/woff';
  if (lower.endsWith('.ttf')) return 'font/ttf';
  if (lower.endsWith('.otf')) return 'font/otf';
  if (lower.endsWith('.eot')) return 'application/vnd.ms-fontobject';
  if (lower.endsWith('.wasm')) return 'application/wasm';
  return 'application/octet-stream';
}

function isTextLike(path: string): boolean {
  const ct = guessContentTypeByPath(path);
  return ct.startsWith('text/') || ct.includes('javascript') || ct.includes('json') || ct.includes('svg+xml');
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`加载脚本失败: ${src}`));
    document.head.appendChild(el);
  });
}

async function ensureJsZip(): Promise<any> {
  const g: any = globalThis as any;
  if (g.JSZip) return g.JSZip;
  await loadScript('/lib/jszip.min.js');
  if (!g.JSZip) throw new Error('JSZip 未能加载（/lib/jszip.min.js）');
  return g.JSZip;
}

function stripSingleTopLevelFolder(paths: string[]): { prefix: string; stripped: string[] } {
  const list = paths.filter(Boolean);
  if (list.length === 0) return { prefix: '', stripped: [] };

  const firstSegs = new Set(list.map(p => p.split('/')[0]).filter(Boolean));
  if (firstSegs.size !== 1) return { prefix: '', stripped: list };

  const seg = [...firstSegs][0];
  const prefix = `${seg}/`;
  const hasNested = list.some(p => p.startsWith(prefix));
  if (!hasNested) return { prefix: '', stripped: list };

  return { prefix, stripped: list.map(p => (p.startsWith(prefix) ? p.slice(prefix.length) : p)) };
}

function normalizeZipPath(path: string): string | null {
  let p = String(path ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');

  const parts = p.split('/').filter(Boolean);
  if (parts.some(seg => seg === '..')) return null;
  p = parts.join('/');
  return p || null;
}

type ZipPathIndex = {
  fileSet: Set<string>;
  dirSet: Set<string>; // contains trailing slash, e.g. "assets/" "assets/sub/"
};

function stripQueryAndHash(path: string): string {
  return String(path).split(/[?#]/, 1)[0];
}

function buildZipPathIndex(filePaths: string[]): ZipPathIndex {
  const fileSet = new Set<string>();
  const dirSet = new Set<string>();

  for (const p of filePaths) {
    fileSet.add(p);
    const parts = p.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      dirSet.add(parts.slice(0, i).join('/') + '/');
    }
  }

  return { fileSet, dirSet };
}

function shouldRewriteRootRef(rest: string, index: ZipPathIndex): boolean {
  const pathOnly = stripQueryAndHash(rest);
  if (!pathOnly) return false;
  if (index.fileSet.has(pathOnly)) return true;
  if (index.dirSet.has(pathOnly.endsWith('/') ? pathOnly : `${pathOnly}/`)) return true;
  return false;
}

function patchRootRelativeInHtml(
  html: string,
  vfsBasePathname: string,
  fixRootRelativeUrls: boolean,
  index: ZipPathIndex,
): string {
  let out = html;

  if (!fixRootRelativeUrls) return out;

  // Fix <base href="/"> which breaks relative paths in many SPA builds
  out = out.replace(
    /<base\b([^>]*?)\bhref\s*=\s*(["'])\/\2([^>]*?)>/gi,
    (_m, a, q, b) => `<base${a}href=${q}${vfsBasePathname}${q}${b}>`,
  );

  // Rewrite root-relative src/href in resource-ish tags to VFS base
  out = out.replace(
    /(<\s*(?:script|img|source|video|audio)\b[^>]*\bsrc\s*=\s*(["']))\/(?!\/)([^"']+)\2/gi,
    (match, prefix, quote, rest) => {
      if (!shouldRewriteRootRef(rest, index)) return match;
      return `${prefix}${vfsBasePathname}${rest}${quote}`;
    },
  );
  out = out.replace(
    /(<\s*link\b[^>]*\bhref\s*=\s*(["']))\/(?!\/)([^"']+)\2/gi,
    (match, prefix, quote, rest) => {
      if (!shouldRewriteRootRef(rest, index)) return match;
      return `${prefix}${vfsBasePathname}${rest}${quote}`;
    },
  );

  return out;
}

function patchRootRelativeInCss(
  css: string,
  vfsBasePathname: string,
  fixRootRelativeUrls: boolean,
  index: ZipPathIndex,
): string {
  if (!fixRootRelativeUrls) return css;
  let out = String(css);

  // url("/path") / url(/path)
  out = out.replace(/url\(\s*(["'])?\/(?!\/)([^"')]+)\1\s*\)/gi, (match, q = '', rest) => {
    if (!shouldRewriteRootRef(rest, index)) return match;
    return `url(${q}${vfsBasePathname}${rest}${q})`;
  });

  // @import "/path" / @import url("/path") / @import url(/path)
  out = out.replace(
    /@import\s+(?:url\(\s*)?(["'])?\/(?!\/)([^"')\s]+)\1\s*\)?/gi,
    (match, q = '', rest) => {
      if (!shouldRewriteRootRef(rest, index)) return match;
      // Preserve original syntax as much as possible
      if (match.toLowerCase().includes('url(')) {
        return `@import url(${q}${vfsBasePathname}${rest}${q})`;
      }
      return `@import ${q}${vfsBasePathname}${rest}${q}`;
    },
  );

  return out;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isLikelyAssetPath(pathOnly: string): boolean {
  // Be conservative: avoid rewriting app route strings like "/chat" that may exist as folders in the zip.
  // Only rewrite when it looks like a file path ("x.js", "x.css", "x.png"...), or an explicit directory ("assets/").
  if (!pathOnly) return false;
  if (/\s/.test(pathOnly)) return false;
  if (pathOnly.endsWith('/')) return true;
  const last = pathOnly.split('/').filter(Boolean).pop() || '';
  return last.includes('.');
}

function patchRootRelativeInJs(
  js: string,
  vfsBasePathname: string,
  fixRootRelativeUrls: boolean,
  index: ZipPathIndex,
): string {
  if (!fixRootRelativeUrls) return js;
  let out = String(js);

  // Rewrite string literals that are root-relative and point to files/dirs that exist in the zip.
  // Handles: "/assets/x.js", '/assets/x.js', `/assets/x.js`, "/assets/".
  out = out.replace(/(["'`])\/(?!\/)([^"'`]*?)\1/g, (match, quote, rest) => {
    const pathOnly = stripQueryAndHash(rest);
    if (!isLikelyAssetPath(pathOnly)) return match;
    if (!shouldRewriteRootRef(rest, index)) return match;
    return `${quote}${vfsBasePathname}${rest}${quote}`;
  });

  // Webpack: public path "/"
  out = out.replace(
    /(__webpack_require__\.p\s*=\s*)(["'])\/\2/g,
    (_m, prefix, q) => `${prefix}${q}${vfsBasePathname}${q}`,
  );
  out = out.replace(
    /(__webpack_public_path__\s*=\s*)(["'])\/\2/g,
    (_m, prefix, q) => `${prefix}${q}${vfsBasePathname}${q}`,
  );

  return out;
}

function injectResizerIntoHtml(html: string): string {
  const marker = '/*__HB_RESIZER__*/';
  if (html.includes(marker)) return html;

  const script = `<script>${marker}
(() => {
  const TYPE = 'HB_IFRAME_HEIGHT';
  const iframeName = window.name || '';
  let last = 0;
  const compute = () => {
    const body = document.body;
    const doc = document.documentElement;
    const h1 = body ? body.scrollHeight : 0;
    const h2 = doc ? doc.scrollHeight : 0;
    const h3 = body ? body.offsetHeight : 0;
    const h4 = doc ? doc.offsetHeight : 0;
    return Math.max(h1, h2, h3, h4);
  };
  const post = () => {
    const h = compute();
    if (!Number.isFinite(h) || h <= 0) return;
    if (Math.abs(h - last) < 1) return;
    last = h;
    try {
      window.parent?.postMessage?.({ type: TYPE, iframeName, height: h }, '*');
    } catch {
      //
    }
  };
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => post());
    try {
      ro.observe(document.documentElement);
      if (document.body) ro.observe(document.body);
    } catch {
      //
    }
  }
  window.addEventListener('load', () => {
    post();
    setTimeout(post, 100);
  });
  setTimeout(post, 0);
})();
</script>`;

  const idx = html.search(/<\/body\s*>/i);
  if (idx !== -1) return html.slice(0, idx) + script + html.slice(idx);
  const idx2 = html.search(/<\/html\s*>/i);
  if (idx2 !== -1) return html.slice(0, idx2) + script + html.slice(idx2);
  return html + script;
}

export async function sha256Hex(arrayBuffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// 按用户需求：彻底移除 Base64 Worker，统一走主线程编解码。
function arrayBufferToBase64Sync(arrayBuffer: ArrayBuffer): string {
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    chunks.push(String.fromCharCode(...chunk));
  }
  return btoa(chunks.join(''));
}

function base64ToArrayBufferSync(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function arrayBufferToBase64(arrayBuffer: ArrayBuffer): Promise<string> {
  return arrayBufferToBase64Sync(arrayBuffer);
}

export async function base64ToArrayBuffer(base64: string): Promise<ArrayBuffer> {
  return base64ToArrayBufferSync(base64);
}

export type ZipDownloadProgress = {
  loadedBytes: number;
  totalBytes: number | null;
  /** 0-100, when totalBytes is known */
  percent: number | null;
  /** bytes per second (instant), best-effort */
  speedBps: number | null;
  elapsedMs: number;
};

export type ZipDownloadResult = {
  arrayBuffer: ArrayBuffer;
  totalBytes: number | null;
  contentType: string | null;
  finalUrl: string;
};

export type ZipDownloadOptions = {
  signal?: AbortSignal;
  onProgress?: (p: ZipDownloadProgress) => void;
  /** throttle UI updates, default 120ms */
  progressThrottleMs?: number;
};

export function formatBytes(bytes: number): string {
  const b = Number(bytes);
  if (!Number.isFinite(b) || b < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  let v = b;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const fixed = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(fixed)} ${units[i]}`;
}

export function formatSpeed(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null) return '—';
  const v = Number(bytesPerSecond);
  if (!Number.isFinite(v) || v <= 0) return '—';
  return `${formatBytes(v)}/s`;
}

export function formatPercent(percent: number | null): string {
  if (percent === null) return '—';
  const p = Number(percent);
  if (!Number.isFinite(p)) return '—';
  const clamped = Math.max(0, Math.min(p, 100));
  return `${clamped.toFixed(1)}%`;
}

function nowMs(): number {
  // perf.now is monotonic and smoother for speed calc
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

export async function downloadZipArrayBufferFromUrlWithProgress(url: string, options: ZipDownloadOptions = {}): Promise<ZipDownloadResult> {
  const throttleMs = Math.max(30, Number(options.progressThrottleMs ?? 120));
  const onProgress = options.onProgress;
  const start = nowMs();

  const resp = await fetch(url, { method: 'GET', signal: options.signal });
  if (!resp.ok) {
    throw new Error(`下载失败: ${resp.status} ${resp.statusText}`);
  }

  const contentType = resp.headers.get('content-type');
  const finalUrl = resp.url || url;

  const contentLengthHeader = resp.headers.get('content-length');
  const parsedTotal = contentLengthHeader ? Number(contentLengthHeader) : NaN;
  const totalBytes = Number.isFinite(parsedTotal) && parsedTotal > 0 ? parsedTotal : null;

  const body = resp.body;
  const reader = body?.getReader?.();
  if (!reader) {
    // Fallback: no streaming support
    const arrayBuffer = await resp.arrayBuffer();
    const elapsedMs = Math.max(0, nowMs() - start);
    const loaded = arrayBuffer.byteLength;
    const total = totalBytes ?? loaded;
    const percent = total ? (loaded / total) * 100 : null;
    const speedBps = elapsedMs > 0 ? (loaded / elapsedMs) * 1000 : null;
    onProgress?.({ loadedBytes: loaded, totalBytes: total, percent, speedBps, elapsedMs });
    return { arrayBuffer, totalBytes: total, contentType, finalUrl };
  }

  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;
  let lastEmitAt = 0;
  let lastLoadedAtEmit = 0;
  let speedBps: number | null = null;

  const emit = (force = false) => {
    if (!onProgress) return;
    const t = nowMs();
    const elapsedMs = Math.max(0, t - start);
    if (!force && lastEmitAt && t - lastEmitAt < throttleMs) return;

    if (lastEmitAt) {
      const dt = t - lastEmitAt;
      if (dt > 0) {
        speedBps = ((loadedBytes - lastLoadedAtEmit) / dt) * 1000;
      }
    }
    lastEmitAt = t;
    lastLoadedAtEmit = loadedBytes;

    const percent = totalBytes ? (loadedBytes / totalBytes) * 100 : null;
    onProgress({ loadedBytes, totalBytes, percent, speedBps, elapsedMs });
  };

  emit(true);

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loadedBytes += value.byteLength;
        emit(false);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      //
    }
  }

  emit(true);

  const out = new Uint8Array(loadedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { arrayBuffer: out.buffer, totalBytes: totalBytes ?? loadedBytes, contentType, finalUrl };
}

export async function fetchZipArrayBufferFromUrl(url: string): Promise<ArrayBuffer> {
  const res = await downloadZipArrayBufferFromUrlWithProgress(url);
  return res.arrayBuffer;
}

export async function importZipBase64ToVfs(
  extensionBase: string,
  zipBase64: string,
  options: WebzipImportOptions,
): Promise<WebzipImportResult> {
  const buf = await base64ToArrayBuffer(zipBase64);
  return importZipArrayBufferToVfs(extensionBase, buf, options);
}

export async function importZipArrayBufferToVfs(
  extensionBase: string,
  zipArrayBuffer: ArrayBuffer,
  options: WebzipImportOptions,
): Promise<WebzipImportResult> {
  const JSZip = await ensureJsZip();

  const projectId = await sha256Hex(zipArrayBuffer);
  const cacheName = getCacheName(projectId);
  const cache = await caches.open(cacheName);
  const vfsBasePathname = getVfsBasePathname(extensionBase, projectId);

  const zip = await JSZip.loadAsync(zipArrayBuffer);
  const rawEntries = Object.values(zip.files || {});
  const entries = rawEntries.filter((e: any) => e && !e.dir);
  const normalized = entries
    .map((e: any) => ({ entry: e, path: normalizeZipPath(e.name) }))
    .filter((x: any) => Boolean(x.path));

  if (normalized.length === 0) {
    throw new Error('zip 内没有可导入的文件');
  }

  const { stripped } = stripSingleTopLevelFolder(normalized.map((x: any) => x.path));
  const files = normalized
    .map((x: any, i: number) => ({ entry: x.entry, path: stripped[i] }))
    .filter((x: any) => Boolean(x.path));

  const filePaths = files.map((x: any) => String(x.path));
  const pathIndex = buildZipPathIndex(filePaths);

  const htmlFiles = files
    .map((x: any) => x.path as string)
    .filter((p: string) => /\.(html?|HTML?)$/i.test(p))
    .sort((a: string, b: string) => a.localeCompare(b));

  // Pick homepage
  const preferred = options.preferredHomePage?.trim();
  const hasPreferred = preferred ? htmlFiles.includes(preferred) : false;
  const hasIndex = htmlFiles.some(p => p.toLowerCase() === 'index.html');
  let homePage = preferred && hasPreferred ? preferred : '';
  if (!homePage) {
    if (hasIndex) homePage = htmlFiles.find(p => p.toLowerCase() === 'index.html')!;
    else if (htmlFiles.length > 0) homePage = htmlFiles[0];
    else homePage = 'index.html';
  }

  for (let i = 0; i < files.length; i++) {
    const { entry, path } = files[i] as any;
    const ct = guessContentTypeByPath(path);

    let body: BodyInit;
    if (isTextLike(path)) {
      let text = (await entry.async('string')) as string;
      if (ct.startsWith('text/html')) {
        text = patchRootRelativeInHtml(text, vfsBasePathname, options.fixRootRelativeUrls, pathIndex);
        body = text;
      } else if (ct.startsWith('text/css')) {
        body = patchRootRelativeInCss(text, vfsBasePathname, options.fixRootRelativeUrls, pathIndex);
      } else if (ct.includes('javascript')) {
        body = patchRootRelativeInJs(text, vfsBasePathname, options.fixRootRelativeUrls, pathIndex);
      } else {
        body = text;
      }
    } else {
      const u8 = (await entry.async('uint8array')) as Uint8Array<ArrayBufferLike>;
      // BlobPart 类型在 TS 中要求底层是 ArrayBuffer（而不是 SharedArrayBuffer），这里拷贝一份确保类型与运行时一致。
      const safe = new Uint8Array(u8.byteLength);
      safe.set(u8);
      body = new Blob([safe], { type: ct });
    }

    const url = buildVfsUrl(extensionBase, projectId, path);
    await cache.put(new Request(url, { method: 'GET' }), new Response(body, { headers: { 'Content-Type': ct } }));

    if (i % 75 === 0) {
      // Yield to UI thread
      // eslint-disable-next-line no-await-in-loop
      await new Promise(r => setTimeout(r, 0));
    }
  }

  return { projectId, homePage, htmlFiles, fileCount: files.length, cacheName };
}

