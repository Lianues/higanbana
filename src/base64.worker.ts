type Base64WorkerRequest =
  | {
      id: number;
      type: 'arrayBufferToBase64';
      arrayBuffer: ArrayBuffer;
    }
  | {
      id: number;
      type: 'base64ToArrayBuffer';
      base64: string;
    };

type Base64WorkerResponse =
  | {
      id: number;
      ok: true;
      base64: string;
    }
  | {
      id: number;
      ok: true;
      arrayBuffer: ArrayBuffer;
    }
  | {
      id: number;
      ok: false;
      error: string;
    };

function arrayBufferToBase64(arrayBuffer: ArrayBuffer): string {
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return btoa(chunks.join(''));
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

const worker = self as DedicatedWorkerGlobalScope;

worker.onmessage = (evt: MessageEvent<Base64WorkerRequest>) => {
  const req = evt.data;
  const id = Number(req?.id);
  if (!Number.isFinite(id)) {
    return;
  }

  try {
    if (req.type === 'arrayBufferToBase64') {
      const base64 = arrayBufferToBase64(req.arrayBuffer);
      const res: Base64WorkerResponse = { id, ok: true, base64 };
      worker.postMessage(res);
      return;
    }

    if (req.type === 'base64ToArrayBuffer') {
      const arrayBuffer = base64ToArrayBuffer(req.base64);
      const res: Base64WorkerResponse = { id, ok: true, arrayBuffer };
      worker.postMessage(res, [arrayBuffer]);
      return;
    }

    const res: Base64WorkerResponse = { id, ok: false, error: `未知任务类型: ${(req as any)?.type}` };
    worker.postMessage(res);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const res: Base64WorkerResponse = { id, ok: false, error: message };
    worker.postMessage(res);
  }
};
