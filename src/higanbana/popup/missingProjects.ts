import type { HiganbanaProject } from '../card';
import { getCardData } from '../card';
import { allowAvatar, isAvatarAllowed } from '../avatarAllow';
import { scheduleProcessAllDisplayedMessages } from '../render/placeholders';
import { getActiveCharacter, getCharacterAvatar, getStContext } from '../st';
import { refreshCharacterUi } from '../ui/panel';
import { sha256Hex } from '../../webzip';
import { importProjectsToCacheWithPopupQueue, isProjectMissingCache } from './importQueue';

let autoWebzipCheckInFlight = false;

async function getAlertKeyForProjects(avatar: string, projects: HiganbanaProject[]): Promise<string> {
  const sig = projects
    .map(p => {
      const key = p.source === 'url' ? p.zipSha256 || p.zipUrl : p.zipSha256;
      return `${p.id}:${p.source}:${key}`;
    })
    .join('|');
  try {
    const h = await sha256Hex(new TextEncoder().encode(sig).buffer);
    return `AlertHiganbana_${avatar}_projects_${h}`;
  } catch {
    return `AlertHiganbana_${avatar}_projects_${sig.slice(0, 80)}`;
  }
}

function safePopupId(raw: string): string {
  const s = String(raw ?? '').trim() || 'x';
  // Keep it CSS-selector friendly for querySelector(`#id`)
  const cleaned = s.replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned.startsWith('hb_') ? cleaned : `hb_${cleaned}`;
}

export async function checkCharWebzipOnChatChanged(): Promise<void> {
  const ctx = getStContext();
  const active = getActiveCharacter();
  if (!ctx || !active) return;

  const card = getCardData(active.character);
  if (card.projects.length === 0) return;

  const avatar = getCharacterAvatar(active.character);
  if (!avatar) return;

  if (autoWebzipCheckInFlight) return;
  autoWebzipCheckInFlight = true;

  try {
    const alreadyAllowed = isAvatarAllowed(avatar);
    const missingProjects = card.projects.filter(p => isProjectMissingCache(p));

    const shouldPrompt = !alreadyAllowed || missingProjects.length > 0;
    if (!shouldPrompt) return;

    const checkKey = await getAlertKeyForProjects(avatar, card.projects);
    try {
      if (ctx.accountStorage?.getItem?.(checkKey)) return;
      ctx.accountStorage?.setItem?.(checkKey, 'true');
    } catch {
      // ignore storage errors
    }

    let popupResult: any = 0;
    let selected: HiganbanaProject[] = [];

    // Build confirm popup content + checkbox list
    if (ctx.callGenericPopup && ctx.POPUP_TYPE?.CONFIRM) {
      const root = document.createElement('div');
      const h1 = document.createElement('h3');
      h1.textContent = '此角色卡包含 WebZip 前端项目。';
      root.appendChild(h1);

      const h2 = document.createElement('h3');
      h2.textContent =
        missingProjects.length > 0 ? `发现 ${missingProjects.length} 个未缓存项目，是否下载并启用？` : '是否启用它们？';
      root.appendChild(h2);

      const hint = document.createElement('div');
      hint.className = 'm-b-1';
      hint.style.opacity = '0.85';
      hint.textContent = '你可以稍后在扩展栏的“彼岸花”面板里管理这些项目。';
      root.appendChild(hint);

      const inputIdToProjectId = new Map<string, string>();
      const customInputs =
        missingProjects.length > 0
          ? missingProjects.map(p => {
              const inputId = safePopupId(`miss_${p.id}`);
              inputIdToProjectId.set(inputId, p.id);
              const name = p.title || p.zipName;
              const label = `${name}  |  ${p.source === 'embedded' ? '嵌入' : 'URL'}  |  ${p.placeholder}`;
              const tooltip = p.source === 'url' ? p.zipUrl : '嵌入于角色卡';
              return { id: inputId, label, type: 'checkbox', defaultState: true, tooltip };
            })
          : null;

      const okButton = missingProjects.length > 0 ? '下载选中并启用' : '启用';
      const cancelButton = alreadyAllowed ? '取消' : '否';
      const customButtons = missingProjects.length > 0 ? ['下载全部'] : null;

      popupResult = await ctx.callGenericPopup(root, ctx.POPUP_TYPE.CONFIRM, '', {
        okButton,
        cancelButton,
        customButtons,
        customInputs,
        wide: true,
      });

      if (!popupResult) return;

      if (missingProjects.length > 0) {
        if (Number(popupResult) >= 2) {
          selected = [...missingProjects];
        } else {
          const inputResults: Map<string, any> | undefined = ctx.Popup?.util?.lastResult?.inputResults;
          const wantIds = new Set<string>();
          for (const [inputId, pid] of inputIdToProjectId) {
            const v = inputResults?.get?.(inputId);
            if (v) wantIds.add(pid);
          }
          selected = missingProjects.filter(p => wantIds.has(p.id));
        }
      }
    } else {
      // Fallback: no popup → confirm + download all missing
      const ok = window.confirm(
        missingProjects.length > 0
          ? `此角色卡包含 WebZip 项目，且有 ${missingProjects.length} 个未缓存项目。是否启用并下载全部？`
          : '此角色卡包含 WebZip 项目，是否启用？',
      );
      if (!ok) return;
      selected = [...missingProjects];
    }

    // Mark as allowed
    allowAvatar(avatar);

    try {
      if (selected.length > 0) {
        toastr.info('开始下载/导入项目，请稍候...');
        const r = await importProjectsToCacheWithPopupQueue(active.chid, selected);
        if (r.cancelled) {
          toastr.info('已取消导入');
          return;
        }
        if (r.importedCount > 0) {
          toastr.success(`已导入 ${r.importedCount} 个项目`);
        }
      }
      await ctx.reloadCurrentChat?.();
      refreshCharacterUi();
      scheduleProcessAllDisplayedMessages();
    } catch (err) {
      console.error('[Higanbana] import queue failed', err);
      toastr.error(`导入失败：${(err as any)?.message ?? err}`);
    }
  } finally {
    autoWebzipCheckInFlight = false;
  }
}

