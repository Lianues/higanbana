import { HB_HTML_BRIDGE_CHANNEL } from '../hbHtmlRuntime';
import { getStContext } from './st';

type HbBridgeReq = {
  __hb: 'higanbana';
  v: 1;
  kind: 'req';
  id: string;
  op: 'getCsrfToken' | 'callSTAPI';
  payload?: any;
};

type HbBridgeRes = {
  __hb: 'higanbana';
  v: 1;
  kind: 'res';
  id: string;
  ok: boolean;
  data?: any;
  error?: string;
};

function extractCsrfTokenFromHeadersObj(obj: any): string {
  try {
    if (!obj || typeof obj !== 'object') return '';
    for (const k of Object.keys(obj)) {
      if (String(k).toLowerCase() === 'x-csrf-token') {
        const v = (obj as any)[k];
        return typeof v === 'string' ? v : String(v || '');
      }
    }
  } catch {
    //
  }
  return '';
}

function clampHeight(h: number): number {
  if (!Number.isFinite(h)) return 0;
  return Math.max(80, Math.min(h, 10000));
}

function applyIframeHeightByName(iframeName: string, height: number): void {
  const name = String(iframeName || '').trim();
  if (!name) return;
  const clamped = clampHeight(Number(height));
  if (!clamped) return;
  const iframes = document.querySelectorAll('iframe');
  for (const el of iframes) {
    const iframe = el as HTMLIFrameElement;
    if (iframe?.name !== name) continue;
    iframe.style.height = `${clamped}px`;
  }
}

async function handleReq(req: HbBridgeReq): Promise<HbBridgeRes> {
  const id = String(req?.id || '');
  const base: HbBridgeRes = { __hb: 'higanbana', v: 1, kind: 'res', id, ok: false };

  if (!id) return { ...base, error: 'Missing id' };

  if (req.op === 'getCsrfToken') {
    try {
      const ctx = getStContext();
      const headersObj = ctx?.getRequestHeaders?.();
      const token = extractCsrfTokenFromHeadersObj(headersObj);
      if (token) return { ...base, ok: true, data: token };

      // Fallback: call /csrf-token (rare; e.g. ctx not ready yet)
      const resp = await fetch('/csrf-token', { method: 'GET', credentials: 'include' });
      const data = await resp.json().catch(() => null);
      const t = data && typeof data === 'object' ? String((data as any).token || '') : '';
      return { ...base, ok: true, data: t };
    } catch (e: any) {
      return { ...base, error: e?.message ? String(e.message) : String(e) };
    }
  }

  if (req.op === 'callSTAPI') {
    const endpoint = String(req?.payload?.endpoint || '');
    const params = req?.payload?.params ?? {};
    if (!endpoint || !endpoint.includes('.')) return { ...base, error: 'Invalid endpoint' };

    const api: any = (globalThis as any).ST_API;
    if (!api) return { ...base, error: 'ST_API not available' };

    const parts = endpoint.split('.');
    if (parts.length !== 2) return { ...base, error: 'Invalid endpoint format' };
    const [ns, method] = parts;
    const fn = api?.[ns]?.[method];
    if (typeof fn !== 'function') return { ...base, error: `ST_API.${ns}.${method} is not available` };

    try {
      const result = await fn(params);
      return { ...base, ok: true, data: result };
    } catch (e: any) {
      return { ...base, error: e?.message ? String(e.message) : String(e) };
    }
  }

  return { ...base, error: `Unsupported op: ${String((req as any)?.op || '')}` };
}

export function installHbHtmlBridge(): void {
  const G: any = globalThis as any;
  if (G.__HB_HTML_BRIDGE_SERVER__) return;
  G.__HB_HTML_BRIDGE_SERVER__ = { v: 1 };

  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel(HB_HTML_BRIDGE_CHANNEL);
  } catch {
    bc = null;
  }

  const postToBc = (msg: HbBridgeRes) => {
    try {
      bc?.postMessage(msg);
    } catch {
      //
    }
  };

  const onReqData = async (data: any, sourceWindow?: Window | null, sourceOrigin?: string | null) => {
    if (!data || typeof data !== 'object') return;

    // iframe auto-resize message
    if (data.type === 'HB_IFRAME_HEIGHT') {
      applyIframeHeightByName(String(data.iframeName || ''), Number(data.height));
      return;
    }

    // bridge RPC
    if (data.__hb !== 'higanbana' || data.v !== 1 || data.kind !== 'req') return;
    const req = data as HbBridgeReq;
    const res = await handleReq(req);

    // Reply via BroadcastChannel (works for new tabs) and also back to direct sender (works for iframes)
    postToBc(res);
    if (sourceWindow && typeof (sourceWindow as any).postMessage === 'function') {
      try {
        const targetOrigin = sourceOrigin && sourceOrigin !== 'null' ? sourceOrigin : '*';
        sourceWindow.postMessage(res, targetOrigin);
      } catch {
        //
      }
    }
  };

  try {
    bc && (bc.onmessage = ev => void onReqData(ev.data));
  } catch {
    //
  }
  try {
    window.addEventListener('message', ev => void onReqData(ev.data, ev.source as any, ev.origin));
  } catch {
    //
  }
}

