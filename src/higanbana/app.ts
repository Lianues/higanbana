import { refreshCachedProjects } from './cache';
import { installHbHtmlBridge } from './htmlBridge';
import { bindMessageHooks, processAllDisplayedMessages, scheduleProcessAllDisplayedMessages } from './render/placeholders';
import { registerServiceWorker } from './swRegister';
import { getStContext } from './st';
import { bindUi } from './ui/bindUi';
import { loadSettingsUi, refreshCharacterUi, refreshUi } from './ui/panel';
import { setStatus } from './ui/status';
import { checkCharWebzipOnChatChanged } from './popup/missingProjects';

let characterHooksBound = false;
function bindCharacterHooks(): void {
  if (characterHooksBound) return;
  const ctx = getStContext();
  if (!ctx?.eventSource || !ctx?.event_types) return;
  characterHooksBound = true;

  const refresh = () =>
    setTimeout(() => {
      refreshCharacterUi();
      scheduleProcessAllDisplayedMessages();
      checkCharWebzipOnChatChanged().catch(err => console.warn('[Higanbana] webzip check failed', err));
    }, 0);
  if (ctx.event_types.CHAT_CHANGED) {
    ctx.eventSource.on(ctx.event_types.CHAT_CHANGED, refresh);
  }
  if (ctx.event_types.CHARACTER_DELETED) {
    ctx.eventSource.on(ctx.event_types.CHARACTER_DELETED, refresh);
  }
}

async function init(): Promise<void> {
  // 让任意 iframe / 新标签页里的 HTML 都能通过桥接访问 CSRF token / ST_API
  installHbHtmlBridge();

  const reg = await registerServiceWorker();
  await refreshCachedProjects();
  await loadSettingsUi();
  refreshUi();
  bindUi();
  bindMessageHooks();
  bindCharacterHooks();
  refreshCharacterUi();
  processAllDisplayedMessages();
  checkCharWebzipOnChatChanged().catch(err => console.warn('[Higanbana] webzip check failed', err));
  setStatus(
    `彼岸花：已加载。\nService Worker：${reg ? '已注册' : '不可用（将无法渲染 WebZip）'}\n提示：在本面板可把 zip 绑定到当前角色卡，导出角色卡时会一并导出。`,
  );
}

function bootstrapOnce(): boolean {
  const ctx = getStContext();
  if (ctx?.eventSource && ctx?.event_types?.APP_READY) {
    ctx.eventSource.on(ctx.event_types.APP_READY, () => {
      init().catch(err => {
        console.error('[Higanbana] init failed', err);
        toastr.error(`彼岸花初始化失败：${err?.message ?? err}`);
      });
    });
    return true;
  }
  return false;
}

export function start(): void {
  jQuery(() => {
    if (bootstrapOnce()) return;
    const timer = setInterval(() => {
      if (bootstrapOnce()) clearInterval(timer);
    }, 250);
  });
}

