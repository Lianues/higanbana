import {
  createProjectInActiveCard,
  deleteProjectInActiveCard,
  getProjectInActiveCard,
  updateProjectInActiveCard,
} from './actions/projects';

type AnyRecord = Record<string, any>;

function parseCurrentZipSha256(): string {
  try {
    const pathname = String(location.pathname || '');
    const m = pathname.match(/\/vfs\/([^/]+)\//);
    if (!m || !m[1]) return '';
    return decodeURIComponent(m[1]);
  } catch {
    return '';
  }
}

function normalizePayload<T extends AnyRecord>(params: unknown): T {
  return params && typeof params === 'object' ? ({ ...(params as AnyRecord) } as T) : ({} as T);
}

function withCurrentTargetFallback<T extends AnyRecord>(payload: T): T {
  if (!payload.targetProjectId && !payload.targetZipSha256) {
    const zipSha256 = parseCurrentZipSha256();
    if (zipSha256) payload.targetZipSha256 = zipSha256;
  }
  return payload;
}

function isArrayBufferLike(value: unknown): value is ArrayBuffer {
  if (!value || typeof value !== 'object') return false;
  if (value instanceof ArrayBuffer) return true;
  try {
    return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
  } catch {
    return false;
  }
}

function isBlobLike(value: unknown): value is Blob {
  if (!value || typeof value !== 'object') return false;
  const tag = Object.prototype.toString.call(value);
  return tag === '[object Blob]' && typeof (value as any).arrayBuffer === 'function';
}

async function toArrayBuffer(value: unknown): Promise<ArrayBuffer | null> {
  if (!value) return null;
  if (isArrayBufferLike(value)) {
    const src = new Uint8Array(value);
    const out = new Uint8Array(src.byteLength);
    out.set(src);
    return out.buffer;
  }
  if (ArrayBuffer.isView(value)) {
    const src = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const out = new Uint8Array(src.byteLength);
    out.set(src);
    return out.buffer;
  }
  if (typeof Blob !== 'undefined' && isBlobLike(value)) {
    const buf = await value.arrayBuffer();
    const src = new Uint8Array(buf);
    const out = new Uint8Array(src.byteLength);
    out.set(src);
    return out.buffer;
  }
  return null;
}

async function normalizeZipPayload(payload: AnyRecord): Promise<void> {
  if (!payload.zipArrayBuffer && payload.zipBlob) {
    payload.zipArrayBuffer = await toArrayBuffer(payload.zipBlob);
    try {
      delete payload.zipBlob;
    } catch {
      // ignore
    }
    return;
  }

  if (payload.zipArrayBuffer) {
    payload.zipArrayBuffer = await toArrayBuffer(payload.zipArrayBuffer);
  }
}

export function registerGlobalApi(): void {
  const G = globalThis as any;
  if (!G.__HB_GLOBAL_API__) G.__HB_GLOBAL_API__ = { v: 1 };

  const api = G.Higanbana && typeof G.Higanbana === 'object' ? G.Higanbana : {};

  api.getProject = async (params: unknown = {}) => {
    const payload = normalizePayload<AnyRecord>(params);
    if (!payload.includeAll) {
      withCurrentTargetFallback(payload);
    }
    return getProjectInActiveCard(payload);
  };

  api.createProject = async (params: unknown = {}) => {
    const payload = normalizePayload<AnyRecord>(params);
    await normalizeZipPayload(payload);
    return await createProjectInActiveCard(payload);
  };

  api.updateProject = async (params: unknown = {}) => {
    const payload = normalizePayload<AnyRecord>(params);
    await normalizeZipPayload(payload);
    withCurrentTargetFallback(payload);
    return await updateProjectInActiveCard(payload);
  };

  api.deleteProject = async (params: unknown = {}) => {
    const payload = normalizePayload<AnyRecord>(params);
    withCurrentTargetFallback(payload);
    return await deleteProjectInActiveCard(payload);
  };

  // 兼容旧命名
  api.getProjectConfig = api.getProject;

  G.Higanbana = api;
  G.higanbana = api;

  // 可从 SillyTavern.libs 访问
  try {
    if (G.SillyTavern && typeof G.SillyTavern === 'object') {
      if (!G.SillyTavern.libs || typeof G.SillyTavern.libs !== 'object') G.SillyTavern.libs = {};
      G.SillyTavern.libs.higanbana = api;
    }
  } catch {
    // ignore
  }
}
