import type { HiganbanaCardData, HiganbanaProject, HiganbanaProjectEmbedded, HiganbanaProjectLocal, HiganbanaProjectUrl } from '../card';
import { getCardData, writeCardData } from '../card';
import { cachedProjectIds, refreshCachedProjects } from '../cache';
import { extensionBase } from '../env';
import { popupState } from '../popup/state';
import { renderProgressLine } from '../progress';
import { getActiveCharacter, getCharacterAvatar, getStContext } from '../st';
import { getSettings, saveSettings } from '../settings';
import { refreshCharacterUi } from '../ui/panel';
import { scheduleProcessAllDisplayedMessages } from '../render/placeholders';
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
  formatBytes,
  importZipArrayBufferToVfs,
} from '../../webzip';

let panelUrlDownloadAbortController: AbortController | null = null;
const EMBEDDED_ZIP_MAX_BYTES = 20 * 1024 * 1024;

function assertEmbeddableZipSize(zipArrayBuffer: ArrayBuffer): void {
  const size = Number(zipArrayBuffer?.byteLength ?? 0);
  if (!Number.isFinite(size) || size <= EMBEDDED_ZIP_MAX_BYTES) {
    return;
  }
  const limitMb = Math.round(EMBEDDED_ZIP_MAX_BYTES / 1024 / 1024);
  throw new Error(
    `当前 zip 大小为 ${formatBytes(size)}，超过嵌入上限（${limitMb} MB）。请改用“添加本地缓存项目（不嵌入）”或 URL 模式。`,
  );
}

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

  assertEmbeddableZipSize(zipArrayBuffer);

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
  const zipBase64 = await arrayBufferToBase64(zipArrayBuffer);

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

export async function bindZipArrayBufferToActiveCharacterLocalOnly(
  zipName: string,
  zipArrayBuffer: ArrayBuffer,
): Promise<void> {
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

  const card = getCardData(active.character);
  const desiredPlaceholder = normalizePlaceholderInput($('#hb_placeholder').val());
  const placeholder = ensureUniquePlaceholder(card.projects, desiredPlaceholder);
  const userTitle = String($('#hb_new_title').val() ?? '').trim();
  const showTitleInChat = $('#hb_new_show_title').length ? Boolean($('#hb_new_show_title').prop('checked')) : false;
  const project: HiganbanaProjectLocal = {
    source: 'local',
    id: generateProjectId(),
    title: userTitle || undefined,
    placeholder,
    homePage: imported.homePage,
    showTitleInChat,
    fixRootRelativeUrls,
    zipName,
    zipSha256: imported.projectId,
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
    `已添加项目（本地缓存模式，不嵌入角色卡）。\n占位符：${placeholder}\nprojectId(sha256)：${imported.projectId}\n入口：${imported.homePage}\n文件数：${imported.fileCount}\n\n提示：导出角色卡时不会包含该 zip；若浏览器缓存被清理，需要在本机重新导入 zip。`,
  );
}

export async function migrateEmbeddedProjectsToLocalInActiveCard({
  allow = true,
  ensureCached = true,
  reloadChat = true,
}: {
  allow?: boolean;
  ensureCached?: boolean;
  reloadChat?: boolean;
} = {}): Promise<{ totalEmbedded: number; migrated: number; importedCount: number; cancelled: boolean }> {
  const ctx = getStContext();
  const active = getActiveCharacter();
  if (!active) throw new Error('当前不在单角色聊天/未选中角色');

  const avatar = getCharacterAvatar(active.character);
  if (allow && avatar) {
    allowAvatar(avatar);
  }

  const card = getCardData(active.character);
  const embeddedProjects = card.projects.filter(p => p.source === 'embedded') as HiganbanaProjectEmbedded[];
  const totalEmbedded = embeddedProjects.length;
  if (totalEmbedded === 0) {
    return { totalEmbedded: 0, migrated: 0, importedCount: 0, cancelled: false };
  }

  let importedCount = 0;
  let cancelled = false;

  if (ensureCached) {
    const missingEmbedded = embeddedProjects.filter(p => isProjectMissingCache(p));
    if (missingEmbedded.length > 0) {
      setStatus(`发现 ${missingEmbedded.length} 个嵌入项目未缓存，正在导入缓存...`);
      const r = await importProjectsToCacheWithPopupQueue(active.chid, missingEmbedded);
      importedCount = r.importedCount;
      cancelled = r.cancelled;
      if (cancelled) {
        setStatus('已取消迁移（未修改角色卡）');
        return { totalEmbedded, migrated: 0, importedCount, cancelled: true };
      }
    }
  }

  // 重新读取，确保拿到导入缓存后可能被修正过 zipSha256/homePage 的最新项目数据
  const latest = getCardData(active.character);
  let migrated = 0;
  const nextProjects = latest.projects.map(p => {
    if (p.source !== 'embedded') return p;
    migrated++;
    const localProj: HiganbanaProjectLocal = {
      source: 'local',
      id: p.id,
      title: p.title,
      placeholder: p.placeholder,
      homePage: p.homePage,
      showTitleInChat: p.showTitleInChat,
      fixRootRelativeUrls: p.fixRootRelativeUrls,
      zipName: p.zipName,
      zipSha256: p.zipSha256,
    };
    return localProj;
  });

  await writeCardData(active.chid, { projects: nextProjects });
  if (reloadChat && ctx?.reloadCurrentChat) {
    await ctx.reloadCurrentChat();
  }
  refreshCharacterUi();
  return { totalEmbedded, migrated, importedCount, cancelled: false };
}

function resolveTargetProjectIndex(
  projects: HiganbanaProject[],
  targetProjectIdInput?: string,
  targetZipSha256Input?: string,
): number {
  const targetProjectId = String(targetProjectIdInput ?? '').trim();
  const targetZipSha256 = String(targetZipSha256Input ?? '').trim();

  if (targetProjectId) {
    const idx = projects.findIndex(p => p.id === targetProjectId);
    if (idx < 0) throw new Error(`找不到目标项目：${targetProjectId}`);
    return idx;
  }

  if (targetZipSha256) {
    const indexes: number[] = [];
    for (let i = 0; i < projects.length; i++) {
      if (projects[i]?.zipSha256 === targetZipSha256) indexes.push(i);
    }
    if (indexes.length === 0) throw new Error(`找不到使用该 zipSha256 的项目：${targetZipSha256}`);
    if (indexes.length > 1) {
      throw new Error('存在多个项目使用相同 zipSha256，请传入 targetProjectId 精确指定目标项目');
    }
    return indexes[0];
  }

  throw new Error('缺少目标项目标识，请提供 targetProjectId 或 targetZipSha256');
}

export type OverwriteProjectInActiveCardInput = {
  /** 优先使用项目 id 精确匹配 */
  targetProjectId?: string;
  /** 未指定 targetProjectId 时，可按 zipSha256 匹配（若命中多个会报错） */
  targetZipSha256?: string;
  /** 若不传则沿用原 source */
  source?: HiganbanaProject['source'];
  title?: string;
  placeholder?: string;
  homePage?: string;
  showTitleInChat?: boolean;
  fixRootRelativeUrls?: boolean;
  zipName?: string;
  zipSha256?: string;
  zipUrl?: string;
  zipBase64?: string;
  reloadChat?: boolean;
};

export type OverwriteProjectInActiveCardResult = {
  targetProjectId: string;
  project: HiganbanaProject;
};

export async function overwriteProjectInActiveCard(
  input: OverwriteProjectInActiveCardInput,
): Promise<OverwriteProjectInActiveCardResult> {
  const ctx = getStContext();
  const { active, card } = getActiveCardOrThrow();

  const targetIndex = resolveTargetProjectIndex(card.projects, input?.targetProjectId, input?.targetZipSha256);

  const current = card.projects[targetIndex] as HiganbanaProject;
  const sourceRaw = String(input?.source ?? current.source).trim();
  const source = (sourceRaw === 'embedded' || sourceRaw === 'url' || sourceRaw === 'local' ? sourceRaw : '') as HiganbanaProject['source'];
  if (!source) throw new Error(`非法 source：${sourceRaw}`);

  const nextTitle = input?.title !== undefined ? String(input.title ?? '').trim() || undefined : current.title;
  const nextPlaceholder = input?.placeholder !== undefined ? String(input.placeholder ?? '').trim() : current.placeholder;
  const nextHomePage = input?.homePage !== undefined ? String(input.homePage ?? '').trim() : current.homePage;
  const nextShowTitleInChat =
    typeof input?.showTitleInChat === 'boolean' ? Boolean(input.showTitleInChat) : Boolean(current.showTitleInChat);
  const nextFixRootRelativeUrls =
    typeof input?.fixRootRelativeUrls === 'boolean' ? Boolean(input.fixRootRelativeUrls) : Boolean(current.fixRootRelativeUrls);
  const nextZipName = input?.zipName !== undefined ? String(input.zipName ?? '').trim() : current.zipName;
  const nextZipSha256 = input?.zipSha256 !== undefined ? String(input.zipSha256 ?? '').trim() : String(current.zipSha256 ?? '').trim();

  if (!nextPlaceholder) throw new Error('placeholder 不能为空');
  if (!nextHomePage) throw new Error('homePage 不能为空');
  if (!nextZipName) throw new Error('zipName 不能为空');

  const duplicatedPlaceholder = card.projects.some((p, i) => i !== targetIndex && p.placeholder === nextPlaceholder);
  if (duplicatedPlaceholder) {
    throw new Error(`占位符已被其它项目占用：${nextPlaceholder}`);
  }

  let nextProject: HiganbanaProject;
  if (source === 'url') {
    const nextZipUrl = input?.zipUrl !== undefined ? String(input.zipUrl ?? '').trim() : current.source === 'url' ? current.zipUrl : '';
    if (!nextZipUrl) throw new Error('source=url 时 zipUrl 不能为空');
    nextProject = {
      source: 'url',
      id: current.id,
      title: nextTitle,
      placeholder: nextPlaceholder,
      homePage: nextHomePage,
      showTitleInChat: nextShowTitleInChat,
      fixRootRelativeUrls: nextFixRootRelativeUrls,
      zipName: nextZipName,
      zipSha256: nextZipSha256 || '',
      zipUrl: nextZipUrl,
    };
  } else if (source === 'embedded') {
    const nextZipBase64 =
      input?.zipBase64 !== undefined ? String(input.zipBase64 ?? '').trim() : current.source === 'embedded' ? current.zipBase64 : '';
    if (!nextZipBase64) throw new Error('source=embedded 时 zipBase64 不能为空');
    if (!nextZipSha256) throw new Error('source=embedded 时 zipSha256 不能为空');
    if (input?.zipBase64 !== undefined) {
      const buf = await base64ToArrayBuffer(nextZipBase64);
      assertEmbeddableZipSize(buf);
    }
    nextProject = {
      source: 'embedded',
      id: current.id,
      title: nextTitle,
      placeholder: nextPlaceholder,
      homePage: nextHomePage,
      showTitleInChat: nextShowTitleInChat,
      fixRootRelativeUrls: nextFixRootRelativeUrls,
      zipName: nextZipName,
      zipSha256: nextZipSha256,
      zipBase64: nextZipBase64,
    };
  } else {
    if (!nextZipSha256) throw new Error('source=local 时 zipSha256 不能为空');
    nextProject = {
      source: 'local',
      id: current.id,
      title: nextTitle,
      placeholder: nextPlaceholder,
      homePage: nextHomePage,
      showTitleInChat: nextShowTitleInChat,
      fixRootRelativeUrls: nextFixRootRelativeUrls,
      zipName: nextZipName,
      zipSha256: nextZipSha256,
    };
  }

  const nextProjects = [...card.projects];
  nextProjects[targetIndex] = nextProject;
  await writeCardData(active.chid, { projects: nextProjects });

  if (input?.reloadChat !== false && ctx?.reloadCurrentChat) {
    await ctx.reloadCurrentChat();
  }
  refreshCharacterUi();
  scheduleProcessAllDisplayedMessages();
  return { targetProjectId: current.id, project: nextProject };
}

export type ImportZipAndOverwriteProjectInActiveCardInput = {
  targetProjectId?: string;
  targetZipSha256?: string;
  /** zip 二进制，推荐传 ArrayBuffer；也支持 Uint8Array */
  zipArrayBuffer?: ArrayBuffer | Uint8Array;
  /** 若未提供 zipArrayBuffer，可传 zip 的 base64 字符串（兼容字段） */
  zipBase64?: string;
  /** 推荐：明确表示“这是要导入的新 zip base64”，避免与覆盖 embedded.zipBase64 语义混淆 */
  importZipBase64?: string;
  zipName?: string;
  preferredHomePage?: string;
  homePage?: string;
  fixRootRelativeUrls?: boolean;
  /** 若不传则沿用原 source */
  source?: HiganbanaProject['source'];
  /** source=url 且从非 url 项目切换时需要提供 */
  zipUrl?: string;
  /** source=embedded 时，默认会把新 zip 写回角色卡（zipBase64） */
  persistEmbeddedToCard?: boolean;
  reloadChat?: boolean;
};

export type ImportZipAndOverwriteProjectInActiveCardResult = {
  targetProjectId: string;
  project: HiganbanaProject;
  imported: {
    projectId: string;
    homePage: string;
    fileCount: number;
    cacheName: string;
  };
};

function toSafeArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof Uint8Array) {
    const out = new Uint8Array(data.byteLength);
    out.set(data);
    return out.buffer;
  }
  const src = new Uint8Array(data);
  const out = new Uint8Array(src.byteLength);
  out.set(src);
  return out.buffer;
}

async function normalizeZipInputToArrayBuffer(input: ImportZipAndOverwriteProjectInActiveCardInput): Promise<ArrayBuffer> {
  if (input?.zipArrayBuffer instanceof ArrayBuffer || input?.zipArrayBuffer instanceof Uint8Array) {
    return toSafeArrayBuffer(input.zipArrayBuffer);
  }
  const zipBase64 = String(input?.importZipBase64 ?? input?.zipBase64 ?? '').trim();
  if (zipBase64) {
    return await base64ToArrayBuffer(zipBase64);
  }
  throw new Error('缺少 zip 数据，请提供 zipArrayBuffer 或 zipBase64');
}

export async function importZipAndOverwriteProjectInActiveCard(
  input: ImportZipAndOverwriteProjectInActiveCardInput,
): Promise<ImportZipAndOverwriteProjectInActiveCardResult> {
  const { card } = getActiveCardOrThrow();
  const targetIndex = resolveTargetProjectIndex(card.projects, input?.targetProjectId, input?.targetZipSha256);
  const current = card.projects[targetIndex] as HiganbanaProject;

  const zipArrayBuffer = await normalizeZipInputToArrayBuffer(input);
  const fixRootRelativeUrls =
    typeof input?.fixRootRelativeUrls === 'boolean' ? Boolean(input.fixRootRelativeUrls) : Boolean(current.fixRootRelativeUrls);
  const preferredHomePage = String(input?.preferredHomePage ?? input?.homePage ?? current.homePage ?? '').trim() || undefined;

  setStatus('正在导入新 zip 并写入 VFS 缓存...');
  const imported = await importZipArrayBufferToVfs(extensionBase, zipArrayBuffer, {
    fixRootRelativeUrls,
    preferredHomePage,
  });
  cachedProjectIds.add(imported.projectId);
  await refreshCachedProjects();

  const sourceRaw = String(input?.source ?? current.source).trim();
  const source = (sourceRaw === 'embedded' || sourceRaw === 'url' || sourceRaw === 'local' ? sourceRaw : '') as HiganbanaProject['source'];
  if (!source) throw new Error(`非法 source：${sourceRaw}`);

  const overwriteInput: OverwriteProjectInActiveCardInput = {
    targetProjectId: current.id,
    source,
    zipName: input?.zipName !== undefined ? String(input.zipName ?? '').trim() : current.zipName,
    homePage: imported.homePage,
    zipSha256: imported.projectId,
    fixRootRelativeUrls,
    reloadChat: input?.reloadChat,
  };

  if (source === 'url' && input?.zipUrl !== undefined) {
    overwriteInput.zipUrl = String(input.zipUrl ?? '').trim();
  }

  if (source === 'embedded') {
    const persistEmbeddedToCard = input?.persistEmbeddedToCard !== false;
    if (!persistEmbeddedToCard) {
      throw new Error('source=embedded 时必须写入 zipBase64；若不希望写入角色卡，请将 source 设为 local');
    }
    assertEmbeddableZipSize(zipArrayBuffer);
    overwriteInput.zipBase64 = input?.zipBase64 !== undefined ? String(input.zipBase64 ?? '').trim() : await arrayBufferToBase64(zipArrayBuffer);
  }

  const overwritten = await overwriteProjectInActiveCard(overwriteInput);
  setStatus(
    `已覆盖项目 zip。\n项目：${overwritten.project.title || overwritten.project.zipName}\nprojectId(sha256)：${imported.projectId}\n入口：${imported.homePage}\n文件数：${imported.fileCount}`,
  );
  return { targetProjectId: overwritten.targetProjectId, project: overwritten.project, imported };
}

export type UpdateProjectInActiveCardInput = OverwriteProjectInActiveCardInput & {
  /** 若提供 zip 数据，则会先导入新 zip 并覆盖项目的 zipSha256/homePage */
  zipArrayBuffer?: ArrayBuffer | Uint8Array;
  /** 推荐字段：导入 zip 的 base64。存在时会触发“导入 + 覆盖”流程 */
  importZipBase64?: string;
  preferredHomePage?: string;
  persistEmbeddedToCard?: boolean;
};

export type UpdateProjectInActiveCardResult = {
  targetProjectId: string;
  project: HiganbanaProject;
  imported?: {
    projectId: string;
    homePage: string;
    fileCount: number;
    cacheName: string;
  };
};

export async function updateProjectInActiveCard(input: UpdateProjectInActiveCardInput): Promise<UpdateProjectInActiveCardResult> {
  const hasZipArrayBuffer = input?.zipArrayBuffer instanceof ArrayBuffer || input?.zipArrayBuffer instanceof Uint8Array;
  const hasImportZipBase64 = String(input?.importZipBase64 ?? '').trim().length > 0;
  if (hasZipArrayBuffer || hasImportZipBase64) {
    return await importZipAndOverwriteProjectInActiveCard({ ...(input as any), zipBase64: undefined });
  }
  return await overwriteProjectInActiveCard(input);
}

function cloneProject(project: HiganbanaProject): HiganbanaProject {
  if (project.source === 'embedded') {
    return { ...project, source: 'embedded', zipBase64: String(project.zipBase64 ?? '') };
  }
  if (project.source === 'url') {
    return { ...project, source: 'url', zipUrl: String(project.zipUrl ?? '') };
  }
  return { ...project, source: 'local' };
}

export type GetProjectInActiveCardInput = {
  targetProjectId?: string;
  targetZipSha256?: string;
  /** true 时返回全部项目（忽略 target） */
  includeAll?: boolean;
};

export type GetProjectInActiveCardResult = {
  projects: HiganbanaProject[];
  project?: HiganbanaProject;
};

export function getProjectInActiveCard(input: GetProjectInActiveCardInput = {}): GetProjectInActiveCardResult {
  const { card } = getActiveCardOrThrow();
  const projects = card.projects.map(cloneProject);

  const includeAll = Boolean(input?.includeAll);
  const targetProjectId = String(input?.targetProjectId ?? '').trim();
  const targetZipSha256 = String(input?.targetZipSha256 ?? '').trim();
  if (includeAll || (!targetProjectId && !targetZipSha256)) {
    return { projects };
  }

  const idx = resolveTargetProjectIndex(card.projects, targetProjectId, targetZipSha256);
  return {
    projects,
    project: cloneProject(card.projects[idx] as HiganbanaProject),
  };
}

export type DeleteProjectInActiveCardInput = {
  targetProjectId?: string;
  targetZipSha256?: string;
  reloadChat?: boolean;
};

export type DeleteProjectInActiveCardResult = {
  deletedProjectId: string;
  deletedProject: HiganbanaProject;
  remainingCount: number;
};

export async function deleteProjectInActiveCard(input: DeleteProjectInActiveCardInput): Promise<DeleteProjectInActiveCardResult> {
  const ctx = getStContext();
  const { active, card } = getActiveCardOrThrow();
  const targetIndex = resolveTargetProjectIndex(card.projects, input?.targetProjectId, input?.targetZipSha256);
  const deletedProject = card.projects[targetIndex] as HiganbanaProject;

  const nextProjects = card.projects.filter((_p, idx) => idx !== targetIndex);
  await writeCardData(active.chid, { projects: nextProjects });

  if (input?.reloadChat !== false && ctx?.reloadCurrentChat) {
    await ctx.reloadCurrentChat();
  }
  refreshCharacterUi();
  scheduleProcessAllDisplayedMessages();
  setStatus(`已删除项目：${deletedProject.title || deletedProject.zipName}`);

  return {
    deletedProjectId: deletedProject.id,
    deletedProject: cloneProject(deletedProject),
    remainingCount: nextProjects.length,
  };
}

export type CreateProjectInActiveCardInput = {
  source?: HiganbanaProject['source'];
  title?: string;
  placeholder?: string;
  homePage?: string;
  showTitleInChat?: boolean;
  fixRootRelativeUrls?: boolean;
  zipName?: string;
  zipSha256?: string;
  zipUrl?: string;
  zipBase64?: string;
  zipArrayBuffer?: ArrayBuffer | Uint8Array;
  importZipBase64?: string;
  preferredHomePage?: string;
  persistEmbeddedToCard?: boolean;
  reloadChat?: boolean;
};

export type CreateProjectInActiveCardResult = {
  project: HiganbanaProject;
  imported?: {
    projectId: string;
    homePage: string;
    fileCount: number;
    cacheName: string;
  };
};

export async function createProjectInActiveCard(input: CreateProjectInActiveCardInput): Promise<CreateProjectInActiveCardResult> {
  const ctx = getStContext();
  const { active, card } = getActiveCardOrThrow();
  const settings = getSettings();

  const hasZipArrayBuffer = input?.zipArrayBuffer instanceof ArrayBuffer || input?.zipArrayBuffer instanceof Uint8Array;
  const hasImportZipBase64 = String(input?.importZipBase64 ?? '').trim().length > 0;
  const hasImportZip = hasZipArrayBuffer || hasImportZipBase64;

  const inferredSource = hasImportZip
    ? 'local'
    : String(input?.zipUrl ?? '').trim()
      ? 'url'
      : String(input?.zipBase64 ?? '').trim()
        ? 'embedded'
        : 'local';
  const sourceRaw = String(input?.source ?? inferredSource).trim();
  const source = (sourceRaw === 'embedded' || sourceRaw === 'url' || sourceRaw === 'local' ? sourceRaw : '') as HiganbanaProject['source'];
  if (!source) throw new Error(`非法 source：${sourceRaw}`);

  const desiredPlaceholder = normalizePlaceholderInput(input?.placeholder ?? '');
  const placeholderBase = desiredPlaceholder || settings.placeholder;
  const placeholder = ensureUniquePlaceholder(card.projects, placeholderBase);

  let projectId = generateProjectId();
  while (card.projects.some(p => p.id === projectId)) {
    projectId = generateProjectId();
  }

  const title = String(input?.title ?? '').trim() || undefined;
  const showTitleInChat = typeof input?.showTitleInChat === 'boolean' ? Boolean(input.showTitleInChat) : false;
  const fixRootRelativeUrls =
    typeof input?.fixRootRelativeUrls === 'boolean' ? Boolean(input.fixRootRelativeUrls) : Boolean(settings.defaultFixRootRelativeUrls);

  const zipUrl = String(input?.zipUrl ?? '').trim();
  let zipName = String(input?.zipName ?? '').trim();
  let homePage = String(input?.homePage ?? '').trim();
  let zipSha256 = String(input?.zipSha256 ?? '').trim();
  let embeddedZipBase64 = String(input?.zipBase64 ?? '').trim();
  let imported: CreateProjectInActiveCardResult['imported'] | undefined;

  if (hasImportZip) {
    const zipArrayBuffer = await normalizeZipInputToArrayBuffer(input as ImportZipAndOverwriteProjectInActiveCardInput);
    const preferredHomePage = String(input?.preferredHomePage ?? input?.homePage ?? '').trim() || undefined;
    setStatus('正在导入新 zip 并创建项目...');
    const importedResult = await importZipArrayBufferToVfs(extensionBase, zipArrayBuffer, {
      fixRootRelativeUrls,
      preferredHomePage,
    });
    cachedProjectIds.add(importedResult.projectId);
    await refreshCachedProjects();

    imported = {
      projectId: importedResult.projectId,
      homePage: importedResult.homePage,
      fileCount: importedResult.fileCount,
      cacheName: importedResult.cacheName,
    };
    zipSha256 = importedResult.projectId;
    homePage = importedResult.homePage;

    if (source === 'embedded') {
      const persistEmbeddedToCard = input?.persistEmbeddedToCard !== false;
      if (!persistEmbeddedToCard) {
        throw new Error('source=embedded 时必须写入 zipBase64；若不希望写入角色卡，请将 source 设为 local');
      }
      assertEmbeddableZipSize(zipArrayBuffer);
      if (!embeddedZipBase64) {
        embeddedZipBase64 = await arrayBufferToBase64(zipArrayBuffer);
      }
    }
  }

  if (source === 'url' && !zipUrl) {
    throw new Error('source=url 时 zipUrl 不能为空');
  }

  if (!zipName) {
    if (source === 'url') {
      zipName = zipUrl ? guessZipNameFromUrl(zipUrl) : 'webzip.zip';
    } else {
      zipName = 'webzip.zip';
    }
  }
  if (!homePage) homePage = 'index.html';

  let project: HiganbanaProject;
  if (source === 'embedded') {
    if (!embeddedZipBase64) {
      throw new Error('source=embedded 时 zipBase64 不能为空（可改传 zipArrayBuffer/importZipBase64 自动导入）');
    }
    if (!zipSha256) {
      throw new Error('source=embedded 时 zipSha256 不能为空（可改传 zipArrayBuffer/importZipBase64 自动生成）');
    }
    if (!hasImportZip) {
      const buf = await base64ToArrayBuffer(embeddedZipBase64);
      assertEmbeddableZipSize(buf);
    }
    project = {
      source: 'embedded',
      id: projectId,
      title,
      placeholder,
      homePage,
      showTitleInChat,
      fixRootRelativeUrls,
      zipName,
      zipSha256,
      zipBase64: embeddedZipBase64,
    };
  } else if (source === 'url') {
    project = {
      source: 'url',
      id: projectId,
      title,
      placeholder,
      homePage,
      showTitleInChat,
      fixRootRelativeUrls,
      zipName,
      zipSha256: zipSha256 || '',
      zipUrl,
    };
  } else {
    if (!zipSha256) {
      throw new Error('source=local 时 zipSha256 不能为空（可改传 zipArrayBuffer/importZipBase64 自动导入）');
    }
    project = {
      source: 'local',
      id: projectId,
      title,
      placeholder,
      homePage,
      showTitleInChat,
      fixRootRelativeUrls,
      zipName,
      zipSha256,
    };
  }

  const nextProjects = [...card.projects, project];
  await writeCardData(active.chid, { projects: nextProjects });

  if (input?.reloadChat !== false && ctx?.reloadCurrentChat) {
    await ctx.reloadCurrentChat();
  }
  refreshCharacterUi();
  scheduleProcessAllDisplayedMessages();
  setStatus(`已创建项目：${project.title || project.zipName}\n项目ID：${project.id}\n占位符：${project.placeholder}`);

  return { project: cloneProject(project), imported };
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

    const buf = await base64ToArrayBuffer(proj.zipBase64);
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

export async function exportEmbeddedProjectZip(projectId: string): Promise<void> {
  const { card } = getActiveCardOrThrow();
  const proj = findProjectOrThrow(card, projectId);
  if (proj.source !== 'embedded') throw new Error('当前项目不是嵌入模式，无法导出 zip');
  const buf = await base64ToArrayBuffer(proj.zipBase64);
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

