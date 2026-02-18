import type { HiganbanaProject, HiganbanaProjectUrl } from '../card';
import { getCardData, writeCardData } from '../card';
import { cachedProjectIds, isProjectCached, refreshCachedProjects } from '../cache';
import { extensionBase } from '../env';
import { renderProgressLine } from '../progress';
import { getActiveCharacter, getStContext } from '../st';
import { setStatus } from '../ui/status';
import {
  base64ToArrayBuffer,
  downloadZipArrayBufferFromUrlWithProgress,
  formatBytes,
  importZipArrayBufferToVfs,
} from '../../webzip';
import { popupState } from './state';

export function isProjectMissingCache(project: HiganbanaProject): boolean {
  if (project.source === 'url') {
    if (!project.zipSha256) return true;
    return !isProjectCached(project.zipSha256);
  }
  return !isProjectCached(project.zipSha256);
}

function buildDownloadPopupContent(title: string): {
  root: HTMLElement;
  titleEl: HTMLHeadingElement;
  progress: HTMLProgressElement;
  text: HTMLDivElement;
} {
  const root = document.createElement('div');

  const titleEl = document.createElement('h3');
  titleEl.textContent = title;
  root.appendChild(titleEl);

  const progress = document.createElement('progress');
  progress.max = 100;
  progress.value = 0;
  progress.style.width = '100%';
  progress.style.height = '12px';
  root.appendChild(progress);

  const text = document.createElement('div');
  text.style.marginTop = '8px';
  text.style.opacity = '0.9';
  text.style.whiteSpace = 'nowrap';
  text.style.overflowX = 'auto';
  text.style.overflowY = 'hidden';
  root.appendChild(text);

  return { root, titleEl, progress, text };
}

export async function importProjectsToCacheWithPopupQueue(
  chid: number,
  queue: HiganbanaProject[],
): Promise<{ importedCount: number; cancelled: boolean }> {
  const ctx = getStContext();
  if (!ctx) throw new Error('上下文缺失');

  const toImport = queue.filter(p => isProjectMissingCache(p));
  if (toImport.length === 0) return { importedCount: 0, cancelled: false };

  // Fallback: no popup support → still import sequentially
  if (!ctx.callGenericPopup || !ctx.POPUP_TYPE) {
    let importedCount = 0;
    for (const proj of toImport) {
      const activeNow = getActiveCharacter();
      if (!activeNow || Number(activeNow.chid) !== Number(chid)) break;
      const name = proj.title || proj.zipName;
      setStatus(`正在导入：${name} ...`);

      let buf: ArrayBuffer;
      if (proj.source === 'url') {
        // eslint-disable-next-line no-await-in-loop
        const dl = await downloadZipArrayBufferFromUrlWithProgress(proj.zipUrl);
        buf = dl.arrayBuffer;
      } else if (proj.source === 'embedded') {
        buf = await base64ToArrayBuffer(proj.zipBase64);
      } else {
        setStatus(`项目“${name}”为本地缓存模式，无法自动恢复缓存，请在面板重新导入本地 zip。`);
        // eslint-disable-next-line no-continue
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const imported = await importZipArrayBufferToVfs(extensionBase, buf, {
        fixRootRelativeUrls: proj.fixRootRelativeUrls,
        preferredHomePage: proj.homePage,
      });
      cachedProjectIds.add(imported.projectId);
      // eslint-disable-next-line no-await-in-loop
      await refreshCachedProjects();

      const current = getCardData(activeNow.character);
      const nextProjects = current.projects.map(p =>
        p.id === proj.id ? { ...p, zipSha256: imported.projectId, homePage: imported.homePage } : p,
      );
      // eslint-disable-next-line no-await-in-loop
      await writeCardData(chid, { projects: nextProjects });
      importedCount++;
    }
    return { importedCount, cancelled: false };
  }

  if (popupState.urlDownloadPopupInFlight) throw new Error('当前已有下载弹窗进行中，请稍后再试');
  popupState.urlDownloadPopupInFlight = true;

  const abortController = new AbortController();
  let done = false;
  let cancelled = false;
  let importedCount = 0;

  const { root, titleEl, progress, text } = buildDownloadPopupContent('彼岸花：准备导入...');
  text.style.whiteSpace = 'pre-wrap';
  text.style.overflowX = 'hidden';

  const update = (p: any) => {
    try {
      text.textContent = renderProgressLine(p);
    } catch {
      text.textContent = '正在下载...';
    }
    if (p?.totalBytes) {
      const percent = Number(p?.percent);
      if (Number.isFinite(percent)) {
        progress.max = 100;
        progress.value = Math.max(0, Math.min(100, percent));
      }
    } else {
      progress.removeAttribute('value');
    }
  };

  try {
    await ctx.callGenericPopup(root, ctx.POPUP_TYPE.TEXT, '', {
      okButton: false,
      cancelButton: '取消',
      onClosing: () => {
        if (!done) {
          cancelled = true;
          abortController.abort();
        }
        return true;
      },
      onOpen: async (popup: any) => {
        try {
          for (let i = 0; i < toImport.length; i++) {
            const proj = toImport[i];
            if (abortController.signal.aborted) break;
            const activeNow = getActiveCharacter();
            if (!activeNow || Number(activeNow.chid) !== Number(chid)) break;

            const name = proj.title || proj.zipName;
            titleEl.textContent = `彼岸花：正在导入（${i + 1}/${toImport.length}）${name}`;

            let buf: ArrayBuffer;
            if (proj.source === 'url') {
              text.textContent = `准备下载：${proj.zipName}\n${proj.zipUrl}`;
              progress.max = 100;
              progress.value = 0;
              // eslint-disable-next-line no-await-in-loop
              const dl = await downloadZipArrayBufferFromUrlWithProgress(proj.zipUrl, {
                signal: abortController.signal,
                onProgress: update,
              });
              buf = dl.arrayBuffer;
              progress.value = 100;
              text.textContent = `下载完成（${formatBytes(buf.byteLength)}），正在解压并写入缓存...`;
            } else if (proj.source === 'embedded') {
              progress.removeAttribute('value');
              text.textContent = `正在从角色卡导入并解压：${proj.zipName}`;
              buf = await base64ToArrayBuffer(proj.zipBase64);
            } else {
              text.textContent = `项目“${name}”为本地缓存模式，无法自动恢复缓存。请在面板重新导入本地 zip。`;
              // eslint-disable-next-line no-continue
              continue;
            }

            // eslint-disable-next-line no-await-in-loop
            const imported = await importZipArrayBufferToVfs(extensionBase, buf, {
              fixRootRelativeUrls: proj.fixRootRelativeUrls,
              preferredHomePage: proj.homePage,
            });
            cachedProjectIds.add(imported.projectId);
            // eslint-disable-next-line no-await-in-loop
            await refreshCachedProjects();

            const current = getCardData(activeNow.character);
            const nextProjects = current.projects.map(p =>
              p.id === proj.id ? { ...p, zipSha256: imported.projectId, homePage: imported.homePage } : p,
            );
            // eslint-disable-next-line no-await-in-loop
            await writeCardData(chid, { projects: nextProjects });
            importedCount++;
          }

          done = true;
          try {
            await (popup as any).completeAffirmative?.();
          } catch {
            //
          }
        } catch (err) {
          done = true;
          try {
            await (popup as any).completeCancelled?.();
          } catch {
            //
          }
          throw err;
        }
      },
    });
  } finally {
    popupState.urlDownloadPopupInFlight = false;
  }

  return { importedCount, cancelled };
}

export async function downloadAndImportUrlProjectWithPopup(
  project: HiganbanaProjectUrl,
): Promise<{ projectId: string; homePage: string; fileCount: number } | null> {
  const ctx = getStContext();
  if (!ctx) return null;
  if (!ctx.callGenericPopup || !ctx.POPUP_TYPE) {
    // Fallback: no popup support
    const dl = await downloadZipArrayBufferFromUrlWithProgress(project.zipUrl);
    const imported = await importZipArrayBufferToVfs(extensionBase, dl.arrayBuffer, {
      fixRootRelativeUrls: project.fixRootRelativeUrls,
      preferredHomePage: project.homePage,
    });
    cachedProjectIds.add(imported.projectId);
    await refreshCachedProjects();
    return { projectId: imported.projectId, homePage: imported.homePage, fileCount: imported.fileCount };
  }

  if (popupState.urlDownloadPopupInFlight) return null;
  popupState.urlDownloadPopupInFlight = true;

  const abortController = new AbortController();
  let done = false;
  let result: { projectId: string; homePage: string; fileCount: number } | null = null;

  const { root, progress, text } = buildDownloadPopupContent('彼岸花：正在下载 WebZip...');
  text.textContent = `准备下载：${project.zipName} | ${project.zipUrl}`;

  const update = (p: any) => {
    // p: ZipDownloadProgress
    text.textContent = renderProgressLine(p);
    if (p.totalBytes) {
      const percent = Number(p.percent);
      if (Number.isFinite(percent)) {
        progress.max = 100;
        progress.value = Math.max(0, Math.min(100, percent));
      }
    } else {
      // Indeterminate
      progress.removeAttribute('value');
    }
  };

  try {
    await ctx.callGenericPopup(root, ctx.POPUP_TYPE.TEXT, '', {
      okButton: false,
      cancelButton: '取消下载',
      onClosing: () => {
        if (!done) abortController.abort();
        return true;
      },
      onOpen: async (popup: any) => {
        try {
          const dl = await downloadZipArrayBufferFromUrlWithProgress(project.zipUrl, {
            signal: abortController.signal,
            onProgress: update,
          });

          // Download done → import
          progress.max = 100;
          progress.value = 100;
          text.textContent = `下载完成（${formatBytes(dl.arrayBuffer.byteLength)}），正在解压并写入缓存...`;

          const imported = await importZipArrayBufferToVfs(extensionBase, dl.arrayBuffer, {
            fixRootRelativeUrls: project.fixRootRelativeUrls,
            preferredHomePage: project.homePage,
          });

          cachedProjectIds.add(imported.projectId);
          await refreshCachedProjects();
          result = { projectId: imported.projectId, homePage: imported.homePage, fileCount: imported.fileCount };
          done = true;

          try {
            await popup.completeAffirmative();
          } catch {
            //
          }
        } catch (err) {
          const aborted = abortController.signal.aborted || (err as any)?.name === 'AbortError';
          if (aborted) {
            toastr.info('已取消下载');
          } else {
            console.error('[Higanbana] url download failed', err);
            toastr.error(`下载失败：${(err as any)?.message ?? err}`);
          }
          done = true;
          try {
            await (popup as any).completeCancelled?.();
          } catch {
            //
          }
        }
      },
    });
  } finally {
    popupState.urlDownloadPopupInFlight = false;
  }

  return result;
}

