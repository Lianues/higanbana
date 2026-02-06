import { getSettings } from '../settings';
import type { RenderTarget } from './embed';
import { createEmbedNode } from './embed';
import { installIframeAutoResize } from './iframeAutoResize';
import { injectHbHtmlRuntime } from '../../hbHtmlRuntime';

function isLikelyFrontendHtml(content: string): boolean {
  const s = String(content ?? '').toLowerCase();
  return s.includes('<html') || s.includes('<head') || s.includes('<body') || s.includes('<!doctype html');
}

function normalizeHtmlDocument(html: string): string {
  const raw = String(html ?? '');
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed) return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
  if (lower.includes('<!doctype') || lower.includes('<html')) return trimmed;
  // Fragment → wrap
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body>${trimmed}</body>`;
}

function fnv1a32Hex(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function ensureHtmlBlobUrl(wrap: HTMLElement, html: string): string {
  const normalized = injectHbHtmlRuntime(normalizeHtmlDocument(html), {
    origin: window.location.origin,
    forceBaseHref: true,
  });
  const hash = fnv1a32Hex(normalized);
  const prevHash = String((wrap as any).dataset?.hbHtmlHash ?? '');
  const prevUrl = String((wrap as any).dataset?.hbHtmlBlobUrl ?? '');
  if (prevUrl && prevHash === hash) return prevUrl;
  if (prevUrl) {
    try {
      URL.revokeObjectURL(prevUrl);
    } catch {
      //
    }
  }
  const url = URL.createObjectURL(new Blob([normalized], { type: 'text/html' }));
  (wrap as any).dataset.hbHtmlHash = hash;
  (wrap as any).dataset.hbHtmlBlobUrl = url;
  return url;
}

export function renderHtmlCodeBlocksInMesText(mesTextEl: HTMLElement, messageId: number): void {
  // Cleanup / unwrap when disabled
  const settings = getSettings();
  const enabled = Boolean(settings.renderHtmlCodeBlocks);
  const useBlob = Boolean(settings.renderHtmlCodeBlocksUseBlobUrl);
  const showTitleBar = Boolean(settings.renderHtmlCodeBlocksShowTitleBar);
  const needUrl = useBlob || showTitleBar;
  const wraps = Array.from(mesTextEl.querySelectorAll<HTMLElement>('.hb-html-render'));
  if (!enabled) {
    for (const wrap of wraps) {
      const blobUrl = String((wrap as any).dataset?.hbHtmlBlobUrl ?? '');
      if (blobUrl) {
        try {
          URL.revokeObjectURL(blobUrl);
        } catch {
          //
        }
      }
      const pre = wrap.querySelector('pre');
      if (pre && wrap.parentNode) {
        pre.classList.remove('hb-html-code-hidden');
        wrap.parentNode.insertBefore(pre, wrap);
      }
      wrap.remove();
    }
    return;
  }

  const blocks = Array.from(mesTextEl.querySelectorAll('pre > code'));
  if (blocks.length === 0) return;

  // Upgrade legacy wrappers (remove old content if any)
  for (const wrap of wraps) {
    wrap.querySelectorAll('.hb-embed').forEach(el => el.remove());
    wrap.querySelectorAll('iframe.hb-html-iframe').forEach(el => el.remove());
  }

  let embedIndex = mesTextEl.querySelectorAll('.hb-embed').length;

  for (const codeEl of blocks) {
    const pre = codeEl.closest('pre') as HTMLPreElement | null;
    if (!pre) continue;
    const content = codeEl.textContent || '';
    if (!isLikelyFrontendHtml(content)) continue;

    const existingWrap = pre.closest('.hb-html-render') as HTMLElement | null;
    const wrap = existingWrap || document.createElement('div');
    if (!existingWrap) {
      wrap.className = 'hb-html-render';
      (wrap as any).dataset.hbHtmlRender = '1';
      const parent = pre.parentNode;
      if (!parent) continue;
      parent.insertBefore(wrap, pre);
      wrap.appendChild(pre);
    }

    // Hide code block (no toggle UI; disable the setting to show it)
    pre.classList.add('hb-html-code-hidden');

    // Cleanup blob url if not needed
    if (!needUrl) {
      const prevUrl = String((wrap as any).dataset?.hbHtmlBlobUrl ?? '');
      if (prevUrl) {
        try {
          URL.revokeObjectURL(prevUrl);
        } catch {
          //
        }
      }
      try {
        delete (wrap as any).dataset.hbHtmlBlobUrl;
        delete (wrap as any).dataset.hbHtmlHash;
      } catch {
        //
      }
    }

    // 仅在“以 Blob URL 渲染”开启时，才为 iframe 预先创建 blob 页面。
    // 标题栏模式下“新标签页打开”可按需创建 blob（见下方 click handler）。
    const url = useBlob ? ensureHtmlBlobUrl(wrap, content) : '';

    if (showTitleBar) {
      const injected = injectHbHtmlRuntime(normalizeHtmlDocument(content), {
        origin: window.location.origin,
        forceBaseHref: false,
      });
      const target: RenderTarget = { kind: 'iframe', src: useBlob && url ? url : 'about:blank', title: 'HTML 代码块' };
      const embed = createEmbedNode(messageId, embedIndex++, target, {
        showTitleInChat: true,
        openInNewTabUrl: useBlob && url ? url : '#',
      });
      const old = wrap.querySelector('.hb-embed');
      if (old) old.remove();
      wrap.appendChild(embed);

      // 标题栏 + 非 blob 模式：用 srcdoc 渲染，并在点击“新标签页打开”时再创建 blob 页面
      if (!useBlob) {
        const iframe = embed.querySelector('iframe.hb-iframe') as HTMLIFrameElement | null;
        if (iframe) {
          iframe.removeAttribute('src');
          iframe.srcdoc = injected;
        }

        const link = embed.querySelector('.hb-embed-actions a') as HTMLAnchorElement | null;
        if (link && String((link as any).dataset?.hbHtmlLazyOpenBound ?? '') !== '1') {
          (link as any).dataset.hbHtmlLazyOpenBound = '1';
          link.href = '#';
          link.addEventListener('click', ev => {
            try {
              ev.preventDefault();
              const u = ensureHtmlBlobUrl(wrap, content);
              window.open(u, '_blank', 'noopener,noreferrer');
            } catch {
              // ignore
            }
          });
        }
      }
      continue;
    }

    // No title bar: render directly as iframe (borderless)
    const oldEmbed = wrap.querySelector('.hb-embed');
    if (oldEmbed) oldEmbed.remove();

    let iframe = wrap.querySelector('iframe.hb-html-iframe') as HTMLIFrameElement | null;
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.className = 'hb-html-iframe';
      iframe.loading = 'lazy';
      iframe.referrerPolicy = 'no-referrer';
      iframe.name = `hb-html-${messageId}`;
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      installIframeAutoResize(iframe);
      wrap.appendChild(iframe);
    }
    if (useBlob && url) {
      iframe.removeAttribute('srcdoc');
      iframe.src = url;
    } else {
      iframe.removeAttribute('src');
      iframe.srcdoc = injectHbHtmlRuntime(normalizeHtmlDocument(content), {
        origin: window.location.origin,
        forceBaseHref: false,
      });
    }
  }
}

