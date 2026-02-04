import { extensionBase, swUrl } from './env';

function waitForServiceWorkerActivated(reg: ServiceWorkerRegistration, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;

    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      cleanup();
      err ? reject(err) : resolve();
    };

    const timer = setTimeout(() => {
      finish(new Error('Service Worker 激活超时（可能是非安全上下文或被浏览器策略禁止）'));
    }, timeoutMs);

    const unsubs: Array<() => void> = [];
    const cleanup = () => {
      clearTimeout(timer);
      for (const unsub of unsubs) {
        try {
          unsub();
        } catch {
          //
        }
      }
    };

    const maybeSkipWaiting = () => {
      try {
        reg.waiting?.postMessage?.({ type: 'HB_SKIP_WAITING' });
      } catch {
        //
      }
    };

    const checkActivated = () => {
      try {
        if (reg.active?.state === 'activated') finish();
      } catch {
        //
      }
    };

    const track = (sw?: ServiceWorker | null) => {
      if (!sw) return;
      if (sw.state === 'activated') {
        finish();
        return;
      }
      const onState = () => {
        maybeSkipWaiting();
        if (sw.state === 'activated') finish();
      };
      sw.addEventListener('statechange', onState);
      unsubs.push(() => sw.removeEventListener('statechange', onState));
    };

    const onUpdateFound = () => {
      maybeSkipWaiting();
      track(reg.installing);
      checkActivated();
    };
    reg.addEventListener('updatefound', onUpdateFound);
    unsubs.push(() => reg.removeEventListener('updatefound', onUpdateFound));

    maybeSkipWaiting();
    track(reg.installing || reg.waiting || reg.active);
    checkActivated();
  });
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    console.warn('[Higanbana] Service Worker not supported');
    return null;
  }

  try {
    const reg = await navigator.serviceWorker.register(swUrl, { scope: extensionBase });
    reg.update().catch(() => {});
    await waitForServiceWorkerActivated(reg);
    return reg;
  } catch (err) {
    console.warn('[Higanbana] sw register failed', err);
    return null;
  }
}

