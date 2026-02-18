import { HB_HTML_BRIDGE_CHANNEL } from '../hbHtmlRuntime';
import {
  createProjectInActiveCard,
  deleteProjectInActiveCard,
  getProjectInActiveCard,
  updateProjectInActiveCard,
} from './actions/projects';
import { getStContext } from './st';

type HbBridgeReq = {
  __hb: 'higanbana';
  v: 1;
  kind: 'req';
  id: string;
  op: 'getCsrfToken' | 'callSTAPI' | 'getProject' | 'createProject' | 'updateProject' | 'deleteProject';
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

function parseZipSha256FromVfsLikeUrl(urlLike: string): string {
  const text = String(urlLike ?? '').trim();
  if (!text) return '';
  try {
    const u = new URL(text, window.location.origin);
    const m = u.pathname.match(/\/vfs\/([^/]+)\//);
    return m?.[1] ? decodeURIComponent(m[1]) : '';
  } catch {
    return '';
  }
}

function resolveProjectHintFromSourceWindow(sourceWindow?: Window | null): { projectId: string; zipSha256: string } {
  if (!sourceWindow) return { projectId: '', zipSha256: '' };

  try {
    const iframes = document.querySelectorAll('iframe.hb-iframe');
    for (const el of iframes) {
      const iframe = el as HTMLIFrameElement;
      if (iframe.contentWindow !== sourceWindow) continue;

      const embed = iframe.closest('.hb-embed') as HTMLElement | null;
      const projectId = String((embed as any)?.dataset?.hbProjectId ?? '').trim();
      const vfsHomeUrl = String((iframe as any)?.dataset?.hbVfsHomeUrl ?? iframe.src ?? '').trim();
      const zipSha256 = parseZipSha256FromVfsLikeUrl(vfsHomeUrl);
      return { projectId, zipSha256 };
    }
  } catch {
    //
  }

  try {
    // 新标签页直接打开 VFS 时，没有外层 hb-iframe，可尝试从来源窗口 URL 推导 zipSha256。
    const href = String((sourceWindow as any)?.location?.href ?? '');
    const zipSha256 = parseZipSha256FromVfsLikeUrl(href);
    return { projectId: '', zipSha256 };
  } catch {
    return { projectId: '', zipSha256: '' };
  }
}

async function handleReq(req: HbBridgeReq, sourceWindow?: Window | null): Promise<HbBridgeRes> {
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

  if (req.op === 'getProject') {
    try {
      const payload = req?.payload && typeof req.payload === 'object' ? req.payload : {};
      const hint = resolveProjectHintFromSourceWindow(sourceWindow);

      const includeAll = Boolean((payload as any).includeAll);
      const targetProjectIdRaw = String((payload as any).targetProjectId ?? '').trim();
      const targetZipSha256Raw = String((payload as any).targetZipSha256 ?? '').trim();

      const result = getProjectInActiveCard({
        ...(payload as any),
        includeAll,
        targetProjectId: includeAll ? targetProjectIdRaw || undefined : targetProjectIdRaw || hint.projectId || undefined,
        targetZipSha256: includeAll ? targetZipSha256Raw || undefined : targetZipSha256Raw || hint.zipSha256 || undefined,
      });

      return {
        ...base,
        ok: true,
        data: result,
      };
    } catch (e: any) {
      return { ...base, error: e?.message ? String(e.message) : String(e) };
    }
  }

  if (req.op === 'createProject') {
    try {
      const payload = req?.payload && typeof req.payload === 'object' ? req.payload : {};
      const result = await createProjectInActiveCard(payload as any);
      return {
        ...base,
        ok: true,
        data: result,
      };
    } catch (e: any) {
      return { ...base, error: e?.message ? String(e.message) : String(e) };
    }
  }

  if (req.op === 'deleteProject') {
    try {
      const payload = req?.payload && typeof req.payload === 'object' ? req.payload : {};
      const hint = resolveProjectHintFromSourceWindow(sourceWindow);

      const targetProjectIdRaw = String((payload as any).targetProjectId ?? '').trim();
      const targetZipSha256Raw = String((payload as any).targetZipSha256 ?? '').trim();

      const result = await deleteProjectInActiveCard({
        ...(payload as any),
        targetProjectId: targetProjectIdRaw || hint.projectId || undefined,
        targetZipSha256: targetZipSha256Raw || hint.zipSha256 || undefined,
      });

      return {
        ...base,
        ok: true,
        data: result,
      };
    } catch (e: any) {
      return { ...base, error: e?.message ? String(e.message) : String(e) };
    }
  }

  if (req.op === 'updateProject') {
    try {
      const payload = req?.payload && typeof req.payload === 'object' ? req.payload : {};
      const hint = resolveProjectHintFromSourceWindow(sourceWindow);

      const targetProjectIdRaw = String((payload as any).targetProjectId ?? '').trim();
      const targetZipSha256Raw = String((payload as any).targetZipSha256 ?? '').trim();

      const result = await updateProjectInActiveCard({
        ...(payload as any),
        targetProjectId: targetProjectIdRaw || hint.projectId || undefined,
        targetZipSha256: targetZipSha256Raw || hint.zipSha256 || undefined,
      });

      return {
        ...base,
        ok: true,
        data: result,
      };
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

  const handledReqIds = new Map<string, number>();
  const HANDLED_REQ_TTL_MS = 5 * 60 * 1000;

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
    const reqId = String(req.id || '');

    if ((req.op === 'updateProject' || req.op === 'deleteProject') && !sourceWindow) {
      const payload = req?.payload && typeof req.payload === 'object' ? req.payload : {};
      const targetProjectId = String((payload as any).targetProjectId ?? '').trim();
      const targetZipSha256 = String((payload as any).targetZipSha256 ?? '').trim();
      const allowBcZipTarget = Boolean((payload as any).__hbAllowBroadcastZipTarget);
      // BroadcastChannel 分支无法可靠推断“当前项目”；优先等待 postMessage 分支（它有 sourceWindow，可反查 projectId）。
      // 若仅在 BroadcastChannel 可通信（如 noopener 新标签页），允许按 targetZipSha256 继续处理。
      if (!targetProjectId && !(allowBcZipTarget && targetZipSha256)) {
        return;
      }
    }

    if (!reqId) return;

    // 同一个请求会同时走 BroadcastChannel + postMessage，避免重复执行有副作用的操作（如覆盖项目）。
    const now = Date.now();
    for (const [k, t] of handledReqIds) {
      if (now - t > HANDLED_REQ_TTL_MS) handledReqIds.delete(k);
    }
    if (handledReqIds.has(reqId)) {
      return;
    }
    handledReqIds.set(reqId, now);

    const res = await handleReq(req, sourceWindow ?? null);

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

