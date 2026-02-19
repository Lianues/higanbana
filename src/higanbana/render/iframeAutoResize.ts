const iframeAutoResizeState = new WeakMap<
  HTMLIFrameElement,
  {
    ro?: ResizeObserver;
  }
>();

function measureIframeDocumentHeight(iframe: HTMLIFrameElement): number | null {
  try {
    const doc = iframe.contentDocument;
    if (!doc) return null;
    const body = doc.body;
    const html = doc.documentElement;
    if (!body || !html) return null;

    const h1 = body.scrollHeight || 0;
    const h2 = html.scrollHeight || 0;
    const h3 = body.offsetHeight || 0;
    const h4 = html.offsetHeight || 0;
    const h = Math.max(h1, h2, h3, h4);
    if (!Number.isFinite(h) || h <= 0) return null;
    return h;
  } catch {
    return null;
  }
}

function updateIframeHeight(iframe: HTMLIFrameElement): void {
  const h = measureIframeDocumentHeight(iframe);
  if (!h) return;
  iframe.style.height = `${h}px`;
}

export function installIframeAutoResize(iframe: HTMLIFrameElement): void {
  // Replace any previous observer
  const prev = iframeAutoResizeState.get(iframe);
  prev?.ro?.disconnect?.();

  const state: { ro?: ResizeObserver } = {};
  iframeAutoResizeState.set(iframe, state);

  const attach = () => {
    updateIframeHeight(iframe);
    setTimeout(() => updateIframeHeight(iframe), 50);
    setTimeout(() => updateIframeHeight(iframe), 250);

    try {
      const doc = iframe.contentDocument;
      if (!doc?.documentElement) return;
      const ro = new ResizeObserver(() => updateIframeHeight(iframe));
      ro.observe(doc.documentElement);
      if (doc.body) ro.observe(doc.body);
      state.ro = ro;
    } catch {
      //
    }
  };

  // Run now (in case already loaded), and on future loads (navigation)
  attach();
  iframe.addEventListener('load', attach);
}

