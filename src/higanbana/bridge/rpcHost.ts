const HB_RPC_CHANNEL = 'hb_higanbana_rpc_v1';
const HB_RPC_REQ = 'HB_BRIDGE_RPC_REQ';
const HB_RPC_RES = 'HB_BRIDGE_RPC_RES';

type RpcReqMessage = {
  type: typeof HB_RPC_REQ;
  id: string;
  clientId?: string;
  root: string;
  path: string[];
  args?: unknown[];
};

type RpcResMessage = {
  type: typeof HB_RPC_RES;
  id: string;
  clientId?: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

let installed = false;
let channel: BroadcastChannel | null = null;

function isSafePath(path: unknown): path is string[] {
  if (!Array.isArray(path)) return false;
  for (const seg of path) {
    if (typeof seg !== 'string') return false;
    if (!seg) return false;
    if (seg === '__proto__' || seg === 'prototype' || seg === 'constructor') return false;
  }
  return true;
}

function listBridgeGlobalKeys(): string[] {
  const G = globalThis as any;
  const out = new Set<string>();

  try {
    for (const k of Object.getOwnPropertyNames(G)) {
      if (typeof k === 'string' && k.trim()) out.add(k);
    }
  } catch {
    // ignore
  }

  try {
    const proto = Object.getPrototypeOf(G);
    if (proto) {
      for (const k of Object.getOwnPropertyNames(proto)) {
        if (typeof k === 'string' && k.trim()) out.add(k);
      }
    }
  } catch {
    // ignore
  }

  return [...out];
}

function getBridgeInternalApi(): Record<string, (...args: unknown[]) => unknown> {
  return {
    listGlobals: () => listBridgeGlobalKeys(),
    hasGlobal: (key: unknown) => {
      const G = globalThis as any;
      const k = String(key ?? '').trim();
      if (!k) return false;
      return k in G;
    },
  };
}

function getAllowedRoot(root: string): any {
  const G = globalThis as any;
  if (root === 'ST_API') return G.ST_API;
  if (root === 'Higanbana') return G.Higanbana ?? G.higanbana;
  if (root === 'higanbana') return G.higanbana ?? G.Higanbana;
  if (root === 'SillyTavern') return G.SillyTavern;
  if (root === '__HB_GLOBAL__') return G;
  if (root === '__HB_INTERNAL__') return getBridgeInternalApi();
  return undefined;
}

function canDirectReturnValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return true;
  if (t === 'bigint') return true;
  if (t === 'object') {
    if (Array.isArray(value)) return true;
    if (Object.prototype.toString.call(value) === '[object Object]') return true;
  }
  return false;
}

async function invokeTarget(root: string, path: string[], args: unknown[]): Promise<unknown> {
  const base = getAllowedRoot(root);
  if (base === undefined || base === null) {
    throw new Error(`RPC root 不存在：${root}`);
  }

  let holder: any = null;
  let target: any = base;
  for (const seg of path) {
    holder = target;
    if (target === null || target === undefined) {
      throw new Error(`RPC 路径不存在：${root}.${path.join('.')}`);
    }
    target = target[seg];
  }

  if (typeof target === 'function') {
    return await target.apply(holder, args);
  }

  if (args.length > 0) {
    throw new Error(`RPC 目标不是函数：${root}.${path.join('.')}`);
  }

  return target;
}

function normalizeRpcResult(root: string, path: string[], result: unknown): unknown {
  if (canDirectReturnValue(result)) return result;
  if (typeof result === 'function') return { __hb_rpc_function__: true, root, path };
  return { __hb_rpc_object__: true, root, path };
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err ?? 'Unknown error');
}

function postResponse(msg: RpcResMessage): void {
  if (!channel) return;
  try {
    channel.postMessage(msg);
  } catch (err) {
    const fallback: RpcResMessage = {
      type: HB_RPC_RES,
      id: msg.id,
      clientId: msg.clientId,
      ok: false,
      error: `RPC 响应序列化失败：${formatError(err)}`,
    };
    try {
      channel.postMessage(fallback);
    } catch {
      // ignore
    }
  }
}

async function onMessage(evt: MessageEvent<RpcReqMessage>): Promise<void> {
  const data = evt?.data;
  if (!data || data.type !== HB_RPC_REQ) return;

  const id = String(data.id || '').trim();
  const root = String(data.root || '').trim();
  const path = data.path;
  const args = Array.isArray(data.args) ? data.args : [];

  if (!id || !root || !isSafePath(path)) {
    postResponse({
      type: HB_RPC_RES,
      id: id || 'invalid',
      clientId: data.clientId,
      ok: false,
      error: 'RPC 请求参数非法',
    });
    return;
  }

  try {
    const result = await invokeTarget(root, path, args);
    postResponse({
      type: HB_RPC_RES,
      id,
      clientId: data.clientId,
      ok: true,
      result: normalizeRpcResult(root, path, result),
    });
  } catch (err) {
    postResponse({
      type: HB_RPC_RES,
      id,
      clientId: data.clientId,
      ok: false,
      error: formatError(err),
    });
  }
}

export function installRpcBridgeHost(): void {
  if (installed) return;
  installed = true;

  try {
    channel = new BroadcastChannel(HB_RPC_CHANNEL);
    channel.addEventListener('message', evt => {
      void onMessage(evt as MessageEvent<RpcReqMessage>);
    });
  } catch (err) {
    installed = false;
    channel = null;
    console.warn('[Higanbana] RPC 桥接主端初始化失败', err);
  }
}
