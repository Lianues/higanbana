import type { HiganbanaCardData, HiganbanaProject, HiganbanaProjectEmbedded, HiganbanaProjectUrl } from '../card';
import { getCardData, writeCardData } from '../card';
import { cachedProjectIds, refreshCachedProjects } from '../cache';
import { extensionBase } from '../env';
import { popupState } from '../popup/state';
import { renderProgressLine } from '../progress';
import { getActiveCharacter, getCharacterAvatar, getStContext } from '../st';
import { getSettings, saveSettings } from '../settings';
import { refreshCharacterUi } from '../ui/panel';
import { setStatus } from '../ui/status';
import {
  downloadBlob,
  ensureUniquePlaceholder,
  generateProjectId,
  guessZipNameFromUrl,
  normalizeHttpUrl,
  normalizePlaceholderInput,
} from '../utils';
import { allowAvatar } from '../avatarAllow';
import {
  downloadAndImportUrlProjectWithPopup,
  importProjectsToCacheWithPopupQueue,
  isProjectMissingCache,
} from '../popup/importQueue';
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  buildVfsUrl,
  downloadZipArrayBufferFromUrlWithProgress,
  importZipArrayBufferToVfs,
} from '../../webzip';

let panelUrlDownloadAbortController: AbortController | null = null;

function setPanelUrlDownloadVisible(visible: boolean): void {
  const $wrap = $('#hb_url_download_wrap');
  const $cancel = $('#hb_cancel_url_download_btn');
  if (visible) {
    $wrap.show();
    $cancel.show();
  } else {
    $wrap.hide();
    $cancel.hide();
  }
}

function updatePanelUrlDownloadProgress(p: any): void {
  const $wrap = $('#hb_url_download_wrap');
  const $prog = $('#hb_url_progress');
  const $text = $('#hb_url_progress_text');
  if ($wrap.length) $wrap.show();

  try {
    $text.text(renderProgressLine(p));
  } catch {
    $text.text('正在下载...');
  }

  if (p?.totalBytes) {
    const percent = Number(p?.percent);
    if (Number.isFinite(percent)) {
      $prog.attr('max', '100');
      ($prog.get(0) as HTMLProgressElement | undefined)?.removeAttribute?.('value');
      $prog.val(Math.max(0, Math.min(100, percent)));
    }
  } else {
    // Indeterminate
    ($prog.get(0) as HTMLProgressElement | undefined)?.removeAttribute?.('value');
  }
}

export function abortPanelUrlDownload(): void {
  try {
    panelUrlDownloadAbortController?.abort();
  } catch {
    //
  }
}

export async function downloadAndApplyActiveUrlWebzipToCacheFromPanel(): Promise<void> {
  const ctx = getStContext();
  const active = getActiveCharacter();
  if (!active) throw new Error('当前不在单角色聊天/未选中角色');

  const card = getCardData(active.character);
  const urlProject = card.projects.find(p => p.source === 'url') as HiganbanaProjectUrl | undefined;
  if (!urlProject) throw new Error('当前角色卡没有 URL 项目');

  if (popupState.urlDownloadPopupInFlight) {
    throw new Error('当前已有自动下载弹窗进行中，请稍后再试');
  }

  // If a panel download is already running, abort it first.
  if (panelUrlDownloadAbortController && !panelUrlDownloadAbortController.signal.aborted) {
    panelUrlDownloadAbortController.abort();
  }

  const avatar = getCharacterAvatar(active.character);
  if (avatar) allowAvatar(avatar);

  const fixRootRelativeUrls = urlProject.fixRootRelativeUrls;
  const preferredHomePage = urlProject.homePage;

  const abortController = new AbortController();
  panelUrlDownloadAbortController = abortController;

  // Reset UI
  setPanelUrlDownloadVisible(true);
  $('#hb_url_progress').attr('max', '100');
  $('#hb_url_progress').val(0);
  $('#hb_url_progress_text').text(`准备下载：${urlProject.zipName} | ${urlProject.zipUrl}`);
  $('#hb_bind_url_btn').prop('disabled', true);
  $('#hb_download_url_btn').prop('disabled', true);

  try {
    const dl = await downloadZipArrayBufferFromUrlWithProgress(urlProject.zipUrl, {
      signal: abortController.signal,
      onProgress: updatePanelUrlDownloadProgress,
    });

    if (abortController.signal.aborted) throw new Error('已取消下载');

    setStatus('下载完成，正在解压并写入 VFS 缓存...');
    const imported = await importZipArrayBufferToVfs(extensionBase, dl.arrayBuffer, {
      fixRootRelativeUrls,
      preferredHomePage,
    });

    cachedProjectIds.add(imported.projectId);
    await refreshCachedProjects();

    const updated: HiganbanaCardData = {
      projects: card.projects.map(p =>
        p.source === 'url' ? { ...p, zipSha256: imported.projectId, homePage: imported.homePage } : p,
      ),
    };
    await writeCardData(active.chid, updated);

    setStatus(
      `已下载并导入缓存。\nprojectId(sha256)：${imported.projectId}\n入口：${imported.homePage}\n文件数：${imported.fileCount}\n\n提示：在消息中插入占位符即可渲染`,
    );

    if (ctx?.reloadCurrentChat) {
      await ctx.reloadCurrentChat();
    }
  } finally {
    if (panelUrlDownloadAbortController === abortController) {
      panelUrlDownloadAbortController = null;
    }
    setPanelUrlDownloadVisible(false);
    $('#hb_bind_url_btn').prop('disabled', false);
    $('#hb_download_url_btn').prop('disabled', false);
    refreshCharacterUi();
  }
}

export async function bindZipArrayBufferToActiveCharacter(zipName: string, zipArrayBuffer: ArrayBuffer): Promise<void> {
  const active = getActiveCharacter();
  if (!active) {
    throw new Error('当前不在单角色聊天/未选中角色');
  }

  const avatar = getCharacterAvatar(active.character);
  if (avatar) {
    allowAvatar(avatar);
  }

  const s = getSettings();
  const fixRootRelativeUrls = Boolean($('#hb_fix_root_relative').prop('checked'));
  s.defaultFixRootRelativeUrls = fixRootRelativeUrls;
  saveSettings();

  const preferredHomePage = String($('#hb_homepage').val() ?? '').trim() || undefined;

  setStatus('正在解压并写入 VFS 缓存...');
  const imported = await importZipArrayBufferToVfs(extensionBase, zipArrayBuffer, {
    fixRootRelativeUrls,
    preferredHomePage,
  });
  cachedProjectIds.add(imported.projectId);
  await refreshCachedProjects();

  setStatus('正在编码 base64 并写入角色卡扩展字段...');
  const zipBase64 = arrayBufferToBase64(zipArrayBuffer);

  const card = getCardData(active.character);
  const desiredPlaceholder = normalizePlaceholderInput($('#hb_placeholder').val());
  const placeholder = ensureUniquePlaceholder(card.projects, desiredPlaceholder);
  const userTitle = String($('#hb_new_title').val() ?? '').trim();
  const showTitleInChat = $('#hb_new_show_title').length ? Boolean($('#hb_new_show_title').prop('checked')) : false;
  const project: HiganbanaProjectEmbedded = {
    source: 'embedded',
    id: generateProjectId(),
    title: userTitle || undefined,
    placeholder,
    homePage: imported.homePage,
    showTitleInChat,
    fixRootRelativeUrls,
    zipName,
    zipSha256: imported.projectId,
    zipBase64,
  };

  const data: HiganbanaCardData = {
    projects: [...card.projects, project],
  };

  await writeCardData(active.chid, data);
  const $ph = $('#hb_placeholder');
  if ($ph.length && document.activeElement !== $ph.get(0)) {
    $ph.val('');
  }
  refreshCharacterUi();
  $('#hb_new_title').val('');
  setStatus(
    `已添加项目（嵌入模式）。\n占位符：${placeholder}\nprojectId(sha256)：${imported.projectId}\n入口：${imported.homePage}\n文件数：${imported.fileCount}\n\n提示：导出该角色卡(json/png)会包含该项目的 zipBase64`,
  );
}

export async function importActiveCardWebzipToCache({
  allow = true,
  reloadChat = true,
}: { allow?: boolean; reloadChat?: boolean } = {}): Promise<void> {
  const ctx = getStContext();
  const active = getActiveCharacter();
  if (!active) throw new Error('当前不在单角色聊天/未选中角色');

  const card = getCardData(active.character);
  const embeddedProjects = card.projects.filter(p => p.source === 'embedded') as HiganbanaProjectEmbedded[];
  if (embeddedProjects.length === 0) {
    throw new Error('当前角色卡没有可导入的嵌入项目');
  }

  const avatar = getCharacterAvatar(active.character);
  if (allow && avatar) {
    allowAvatar(avatar);
  }

  const updatedProjects = [...card.projects];
  let changed = false;

  for (const proj of embeddedProjects) {
    if (proj.zipSha256 && cachedProjectIds.has(proj.zipSha256)) continue;
    setStatus(`正在从角色卡导入：${proj.title || proj.zipName} ...`);

    const buf = base64ToArrayBuffer(proj.zipBase64);
    // eslint-disable-next-line no-await-in-loop
    const imported = await importZipArrayBufferToVfs(extensionBase, buf, {
      fixRootRelativeUrls: proj.fixRootRelativeUrls,
      preferredHomePage: proj.homePage,
    });

    cachedProjectIds.add(imported.projectId);
    // eslint-disable-next-line no-await-in-loop
    await refreshCachedProjects();

    if (imported.projectId !== proj.zipSha256) {
      console.warn('[Higanbana] zipSha256 mismatch', { embedded: proj.zipSha256, computed: imported.projectId });
      const idx = updatedProjects.findIndex(p => p.id === proj.id);
      if (idx >= 0) {
        const p0 = updatedProjects[idx];
        if (p0 && p0.source === 'embedded') {
          updatedProjects[idx] = { ...p0, zipSha256: imported.projectId, homePage: imported.homePage };
          changed = true;
        }
      }
    }
  }

  if (changed) {
    await writeCardData(active.chid, { projects: updatedProjects });
  }

  setStatus(`已导入到缓存。\n已导入项目数：${embeddedProjects.length}`);

  if (reloadChat && ctx?.reloadCurrentChat) {
    await ctx.reloadCurrentChat();
  }
}

function getActiveCardOrThrow(): { active: { chid: number; character: any }; card: HiganbanaCardData } {
  const active = getActiveCharacter();
  if (!active) throw new Error('当前不在单角色聊天/未选中角色');
  const card = getCardData(active.character);
  return { active, card };
}

function findProjectOrThrow(card: HiganbanaCardData, projectId: string): HiganbanaProject {
  const id = String(projectId ?? '').trim();
  if (!id) throw new Error('项目 id 为空');
  const proj = card.projects.find(p => p.id === id);
  if (!proj) throw new Error('找不到项目（可能已被删除）');
  return proj;
}

export function openProjectHomeInNewTab(projectId: string): void {
  const { card } = getActiveCardOrThrow();
  const proj = findProjectOrThrow(card, projectId);
  if (!proj.zipSha256) throw new Error('尚未下载/导入到本地缓存');
  if (!cachedProjectIds.has(proj.zipSha256)) throw new Error('尚未导入到本地缓存');
  const url = buildVfsUrl(extensionBase, proj.zipSha256, proj.homePage);
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function exportEmbeddedProjectZip(projectId: string): void {
  const { card } = getActiveCardOrThrow();
  const proj = findProjectOrThrow(card, projectId);
  if (proj.source !== 'embedded') throw new Error('当前项目不是嵌入模式，无法导出 zip');
  const buf = base64ToArrayBuffer(proj.zipBase64);
  const blob = new Blob([buf], { type: 'application/zip' });
  downloadBlob(blob, proj.zipName || 'webzip.zip');
}

export async function importEmbeddedProjectToCache(projectId: string): Promise<{ importedCount: number; cancelled: boolean }> {
  const { active, card } = getActiveCardOrThrow();
  const proj = findProjectOrThrow(card, projectId);
  if (proj.source !== 'embedded') throw new Error('当前项目不是嵌入模式');
  if (!isProjectMissingCache(proj)) return { importedCount: 0, cancelled: false };

  const avatar = getCharacterAvatar(active.character);
  if (avatar) allowAvatar(avatar);

  const r = await importProjectsToCacheWithPopupQueue(active.chid, [proj]);
  if (!r.cancelled) {
    await getStContext()?.reloadCurrentChat?.();
    refreshCharacterUi();
  }
  return r;
}

export async function downloadAndApplyUrlProject(projectId: string): Promise<boolean> {
  const { active, card } = getActiveCardOrThrow();
  const proj = findProjectOrThrow(card, projectId);
  if (proj.source !== 'url') throw new Error('当前项目不是 URL 模式');

  const avatar = getCharacterAvatar(active.character);
  if (avatar) allowAvatar(avatar);

  const imported = await downloadAndImportUrlProjectWithPopup(proj);
  if (!imported) return false;

  const current = getCardData(active.character);
  const updated: HiganbanaCardData = {
    projects: current.projects.map(p =>
      p.id === proj.id ? { ...p, zipSha256: imported.projectId, homePage: imported.homePage } : p,
    ),
  };
  await writeCardData(active.chid, updated);
  await getStContext()?.reloadCurrentChat?.();
  refreshCharacterUi();
  return true;
}

export async function deleteProjectFromActiveCard(projectId: string): Promise<void> {
  const ctx = getStContext();
  const { active, card } = getActiveCardOrThrow();
  const proj = findProjectOrThrow(card, projectId);
  const nextProjects = card.projects.filter(p => p.id !== proj.id);
  await writeCardData(active.chid, nextProjects.length ? { projects: nextProjects } : null);
  await ctx?.reloadCurrentChat?.();
  refreshCharacterUi();
}

export async function unbindAllProjectsFromActiveCard(): Promise<void> {
  const { active } = getActiveCardOrThrow();
  await writeCardData(active.chid, null);
  refreshCharacterUi();
}

export async function bindUrlProjectToActiveCharacter(urlInput: string): Promise<{
  zipUrl: string;
  placeholder: string;
  homePage: string;
}> {
  const active = getActiveCharacter();
  if (!active) {
    throw new Error('当前不在单角色聊天/未选中角色');
  }

  const zipUrl = normalizeHttpUrl(urlInput);
  if (!zipUrl) {
    throw new Error('请输入合法的 http/https zip URL');
  }

  const avatar = getCharacterAvatar(active.character);
  if (avatar) allowAvatar(avatar);

  const fixRootRelativeUrls = Boolean($('#hb_fix_root_relative').prop('checked'));
  const homePage = String($('#hb_homepage').val() ?? '').trim() || 'index.html';
  const zipName = guessZipNameFromUrl(zipUrl);

  const card = getCardData(active.character);
  const desiredPlaceholder = normalizePlaceholderInput($('#hb_placeholder').val());
  const placeholder = ensureUniquePlaceholder(card.projects, desiredPlaceholder);
  const userTitle = String($('#hb_new_title').val() ?? '').trim();
  const showTitleInChat = $('#hb_new_show_title').length ? Boolean($('#hb_new_show_title').prop('checked')) : false;
  const project: HiganbanaProjectUrl = {
    source: 'url',
    id: generateProjectId(),
    title: userTitle || undefined,
    placeholder,
    homePage,
    showTitleInChat,
    fixRootRelativeUrls,
    zipName,
    zipSha256: '',
    zipUrl,
  };

  const data: HiganbanaCardData = {
    projects: [...card.projects, project],
  };

  await writeCardData(active.chid, data);
  return { zipUrl, placeholder, homePage };
}

