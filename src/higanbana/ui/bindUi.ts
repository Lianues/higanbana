import type { HiganbanaProjectEmbedded } from '../card';
import { getCardData, writeCardData } from '../card';
import {
  abortPanelUrlDownload,
  bindUrlProjectToActiveCharacter,
  bindZipArrayBufferToActiveCharacter,
  bindZipArrayBufferToActiveCharacterLocalOnly,
  deleteProjectFromActiveCard,
  downloadAndApplyActiveUrlWebzipToCacheFromPanel,
  downloadAndApplyUrlProject,
  exportEmbeddedProjectZip,
  importActiveCardWebzipToCache,
  importEmbeddedProjectToCache,
  migrateEmbeddedProjectsToLocalInActiveCard,
  openProjectHomeInNewTab,
  unbindAllProjectsFromActiveCard,
} from '../actions/projects';
import { DEFAULT_SETTINGS, getSettings, saveSettings } from '../settings';
import { getActiveCharacter, getCharacterAvatar, getStContext } from '../st';
import { scheduleProcessAllDisplayedMessages } from '../render/placeholders';
import { updateEmbedTitleVisibilityForProject } from '../render/embed';
import { buildCardWebzipInfo, downloadBlob } from '../utils';
import { base64ToArrayBuffer, buildVfsUrl } from '../../webzip';
import { extensionBase } from '../env';
import { refreshCharacterUi } from './panel';
import { bindCocktailLikeSubpanels } from './subpanels';
import { setStatus } from './status';

export function bindUi(): void {
  bindCocktailLikeSubpanels();
  const ctx = getStContext();

  $('#hb_pick_zip_btn').on('click', () => {
    const el = document.getElementById('hb_bind_zip') as HTMLInputElement | null;
    el?.click();
  });

  $('#hb_bind_zip').on('change', () => {
    const file = (document.getElementById('hb_bind_zip') as HTMLInputElement | null)?.files?.[0];
    $('#hb_bind_zip_name').text(file ? file.name : '（未选择文件）');
  });

  $('#hb_fix_root_relative').on('change', () => {
    const s = getSettings();
    s.defaultFixRootRelativeUrls = Boolean($('#hb_fix_root_relative').prop('checked'));
    saveSettings();
  });

  $('#hb_render_html_blocks').on('change', () => {
    const s = getSettings();
    s.renderHtmlCodeBlocks = Boolean($('#hb_render_html_blocks').prop('checked'));
    saveSettings();
    scheduleProcessAllDisplayedMessages();
  });

  $('#hb_render_html_blocks_blob').on('change', () => {
    const s = getSettings();
    s.renderHtmlCodeBlocksUseBlobUrl = Boolean($('#hb_render_html_blocks_blob').prop('checked'));
    saveSettings();
    scheduleProcessAllDisplayedMessages();
  });

  $('#hb_render_html_blocks_titlebar').on('change', () => {
    const s = getSettings();
    s.renderHtmlCodeBlocksShowTitleBar = Boolean($('#hb_render_html_blocks_titlebar').prop('checked'));
    saveSettings();
    scheduleProcessAllDisplayedMessages();
  });

  $('#hb_placeholder').on('input', () => {
    const s = getSettings();
    s.placeholder = String($('#hb_placeholder').val() ?? '').trim() || DEFAULT_SETTINGS.placeholder;
    saveSettings();
  });

  $('#hb_copy_placeholder').on('click', async () => {
    const ph = String($('#hb_placeholder').val() ?? '').trim();
    if (!ph) {
      toastr.error('占位符为空');
      return;
    }
    try {
      await navigator.clipboard.writeText(ph);
      toastr.success('已复制占位符');
    } catch (e) {
      console.warn('[Higanbana] copy failed', e);
      toastr.error('复制失败：浏览器未授予剪贴板权限');
    }
  });

  $('#hb_insert_placeholder').on('click', () => {
    const ph = String($('#hb_placeholder').val() ?? '').trim();
    if (!ph) {
      toastr.error('占位符为空');
      return;
    }
    const $ta = $('#send_textarea');
    if ($ta.length === 0) {
      toastr.error('找不到输入框');
      return;
    }
    const old = String($ta.val() ?? '');
    $ta.val(old ? `${old}\n${ph}` : ph);
    $ta.trigger('input');
    toastr.success('已插入占位符');
  });

  // Project list actions & auto-save (delegated)
  const projectTimers = new Map<string, number>();
  const projectInFlight = new Set<string>();

  const scheduleSave = (projectId: string, delayMs = 400) => {
    const prev = projectTimers.get(projectId);
    if (prev) clearTimeout(prev);
    const t = window.setTimeout(() => {
      projectTimers.delete(projectId);
      autoSaveProject(projectId).catch(err => console.warn('[Higanbana] project auto save failed', err));
    }, Math.max(0, delayMs));
    projectTimers.set(projectId, t);
  };

  const autoSaveProject = async (projectId: string): Promise<void> => {
    if (projectInFlight.has(projectId)) return;
    projectInFlight.add(projectId);
    try {
      const active = getActiveCharacter();
      if (!active) return;
      const card = getCardData(active.character);
      const idx = card.projects.findIndex(p => p.id === projectId);
      if (idx < 0) return;

      const root = document.getElementById('hb_projects_list');
      if (!root) return;
      // 用于属性选择器的安全转义（id 目前是 uuid，但这里仍做最小转义避免引号/反斜杠破坏选择器）
      const esc = String(projectId).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

      const titleEl = root.querySelector<HTMLInputElement>(`.hb-proj-title[data-project-id="${esc}"]`);
      const phEl = root.querySelector<HTMLInputElement>(`.hb-proj-placeholder[data-project-id="${esc}"]`);
      const homeEl = root.querySelector<HTMLInputElement>(`.hb-proj-home[data-project-id="${esc}"]`);
      const fixEl = root.querySelector<HTMLInputElement>(`.hb-proj-fix[data-project-id="${esc}"]`);
      const showTitleEl = root.querySelector<HTMLInputElement>(`.hb-proj-show-title[data-project-id="${esc}"]`);

      const cur = card.projects[idx];
      const nextTitleRaw = String(titleEl?.value ?? '').trim();
      const nextTitle = nextTitleRaw ? nextTitleRaw : undefined;
      const nextPlaceholder = String(phEl?.value ?? '').trim();
      const nextHome = String(homeEl?.value ?? '').trim();
      const nextFix = Boolean(fixEl?.checked);
      const nextShowTitle = showTitleEl ? Boolean(showTitleEl.checked) : Boolean(cur.showTitleInChat);

      if (!nextPlaceholder) return;
      if (!nextHome) return;

      const dup = card.projects.some(p => p.id !== projectId && p.placeholder === nextPlaceholder);
      if (dup) {
        toastr.error('占位符重复，请为每个项目设置不同的占位符');
        if (phEl) phEl.value = cur.placeholder;
        return;
      }

      const changed =
        cur.title !== nextTitle ||
        cur.placeholder !== nextPlaceholder ||
        cur.homePage !== nextHome ||
        cur.fixRootRelativeUrls !== nextFix ||
        cur.showTitleInChat !== nextShowTitle;
      if (!changed) return;

      const nextProjects = card.projects.map(p =>
        p.id === projectId
          ? {
              ...p,
              title: nextTitle,
              placeholder: nextPlaceholder,
              homePage: nextHome,
              fixRootRelativeUrls: nextFix,
              showTitleInChat: nextShowTitle,
            }
          : p,
      );
      await writeCardData(active.chid, { projects: nextProjects });
      if (cur.showTitleInChat !== nextShowTitle) {
        updateEmbedTitleVisibilityForProject(projectId, nextShowTitle);
      }
      const headerTitle = root.querySelector<HTMLElement>(`.hb-project[data-project-id="${esc}"] .hb-subpanel-title`);
      if (headerTitle) {
        headerTitle.textContent = `${nextTitle || cur.zipName}  ${nextPlaceholder}`;
      }
      setStatus(`已保存项目设置：${nextTitle || cur.zipName}`);
      scheduleProcessAllDisplayedMessages();
    } finally {
      projectInFlight.delete(projectId);
    }
  };

  $('#hb_projects_list').on('input', '.hb-proj-title, .hb-proj-placeholder, .hb-proj-home', (e: any) => {
    const id = String((e.target as HTMLElement | null)?.getAttribute?.('data-project-id') ?? '').trim();
    if (!id) return;
    scheduleSave(id, 500);
  });
  $('#hb_projects_list').on('change', '.hb-proj-fix, .hb-proj-show-title', (e: any) => {
    const id = String((e.target as HTMLElement | null)?.getAttribute?.('data-project-id') ?? '').trim();
    if (!id) return;
    scheduleSave(id, 0);
  });

  $('#hb_projects_list').on('click', '[data-hb-action="copy_placeholder"]', async (e: any) => {
    const id = String((e.currentTarget as HTMLElement | null)?.getAttribute?.('data-project-id') ?? '').trim();
    if (!id) return;
    const active = getActiveCharacter();
    if (!active) return;
    const card = getCardData(active.character);
    const proj = card.projects.find(p => p.id === id);
    if (!proj) return;
    try {
      await navigator.clipboard.writeText(proj.placeholder);
      toastr.success('已复制占位符');
    } catch (err) {
      console.warn('[Higanbana] copy placeholder failed', err);
      toastr.error('复制失败：浏览器未授予剪贴板权限');
    }
  });

  $('#hb_projects_list').on('click', '[data-hb-action="copy_project_id"]', async (e: any) => {
    const id = String((e.currentTarget as HTMLElement | null)?.getAttribute?.('data-project-id') ?? '').trim();
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      toastr.success('已复制项目 ID');
    } catch (err) {
      console.warn('[Higanbana] copy project id failed', err);
      // 最小兜底：弹窗显示，便于手动复制
      try {
        window.prompt('复制失败，请手动复制项目 ID：', id);
      } catch {
        //
      }
      toastr.error('复制失败：浏览器未授予剪贴板权限');
    }
  });

  $('#hb_projects_list').on('click', '[data-hb-action="insert_placeholder"]', (e: any) => {
    const id = String((e.currentTarget as HTMLElement | null)?.getAttribute?.('data-project-id') ?? '').trim();
    if (!id) return;
    const active = getActiveCharacter();
    if (!active) return;
    const card = getCardData(active.character);
    const proj = card.projects.find(p => p.id === id);
    if (!proj) return;
    const $ta = $('#send_textarea');
    if ($ta.length === 0) {
      toastr.error('找不到输入框');
      return;
    }
    const old = String($ta.val() ?? '');
    $ta.val(old ? `${old}\n${proj.placeholder}` : proj.placeholder);
    $ta.trigger('input');
    toastr.success('已插入占位符');
  });

  $('#hb_projects_list').on('click', '[data-hb-action="open_home"]', (e: any) => {
    const id = String((e.currentTarget as HTMLElement | null)?.getAttribute?.('data-project-id') ?? '').trim();
    if (!id) return;
    try {
      openProjectHomeInNewTab(id);
    } catch (err) {
      toastr.error((err as any)?.message ?? err);
    }
  });

  $('#hb_projects_list').on('click', '[data-hb-action="export_zip"]', async (e: any) => {
    const id = String((e.currentTarget as HTMLElement | null)?.getAttribute?.('data-project-id') ?? '').trim();
    if (!id) return;
    try {
      await exportEmbeddedProjectZip(id);
    } catch (err) {
      console.error('[Higanbana] export zip failed', err);
      toastr.error(`导出失败：${(err as any)?.message ?? err}`);
    }
  });

  $('#hb_projects_list').on('click', '[data-hb-action="import_cache"]', async (e: any) => {
    const id = String((e.currentTarget as HTMLElement | null)?.getAttribute?.('data-project-id') ?? '').trim();
    if (!id) return;

    try {
      const r = await importEmbeddedProjectToCache(id);
      if (r.cancelled) {
        toastr.info('已取消导入');
        return;
      }
      if (r.importedCount > 0) toastr.success('已导入到本地缓存');
      else toastr.info('该项目已在本地缓存');
      scheduleProcessAllDisplayedMessages();
    } catch (err) {
      console.error('[Higanbana] import cache failed', err);
      toastr.error(`导入失败：${(err as any)?.message ?? err}`);
    }
  });

  $('#hb_projects_list').on('click', '[data-hb-action="download_apply"]', async (e: any) => {
    const id = String((e.currentTarget as HTMLElement | null)?.getAttribute?.('data-project-id') ?? '').trim();
    if (!id) return;

    try {
      const applied = await downloadAndApplyUrlProject(id);
      if (!applied) return;
      scheduleProcessAllDisplayedMessages();
      toastr.success('已下载并应用');
    } catch (err) {
      console.error('[Higanbana] download apply failed', err);
      toastr.error(`操作失败：${(err as any)?.message ?? err}`);
    }
  });

  $('#hb_projects_list').on('click', '[data-hb-action="delete_project"]', async (e: any) => {
    const id = String((e.currentTarget as HTMLElement | null)?.getAttribute?.('data-project-id') ?? '').trim();
    if (!id) return;
    const active = getActiveCharacter();
    if (!active) return;
    const card = getCardData(active.character);
    const proj = card.projects.find(p => p.id === id);
    if (!proj) return;

    const name = proj.title || proj.zipName;
    let ok = false;
    try {
      if (ctx?.Popup?.show?.confirm) ok = await ctx.Popup.show.confirm('彼岸花', `确定删除项目：${name}？`);
      else ok = window.confirm(`确定删除项目：${name}？`);
    } catch {
      ok = window.confirm(`确定删除项目：${name}？`);
    }
    if (!ok) return;

    try {
      await deleteProjectFromActiveCard(id);
      scheduleProcessAllDisplayedMessages();
      toastr.success('已删除项目');
    } catch (err) {
      console.error('[Higanbana] delete project failed', err);
      toastr.error(`删除失败：${(err as any)?.message ?? err}`);
    }
  });

  $('#hb_import_from_card').on('click', async () => {
    try {
      toastr.info('开始导入，请稍候...');
      await importActiveCardWebzipToCache({ allow: true, reloadChat: true });
      toastr.success('已导入并启用（可在消息中渲染占位符）');
      refreshCharacterUi();
    } catch (err) {
      console.error('[Higanbana] import from card failed', err);
      toastr.error(`导入失败：${(err as any)?.message ?? err}`);
    }
  });

  $('#hb_migrate_embedded_to_local').on('click', async () => {
    const active = getActiveCharacter();
    if (!active) return;

    const card = getCardData(active.character);
    const embeddedCount = card.projects.filter(p => p.source === 'embedded').length;
    if (embeddedCount === 0) {
      toastr.info('当前角色卡没有可迁移的嵌入项目');
      return;
    }

    const msg =
      `确定将当前角色卡中的 ${embeddedCount} 个“嵌入项目”迁移为“本地缓存模式”吗？\n\n` +
      '迁移后：\n' +
      '1) 角色卡将不再保存 zipBase64（体积会明显下降）\n' +
      '2) 若当前浏览器缓存被清理，需要在本机重新导入 zip\n' +
      '3) 迁移前会先尝试把未缓存项目导入到本地缓存\n';

    let ok = false;
    try {
      if (ctx?.Popup?.show?.confirm) ok = await ctx.Popup.show.confirm('彼岸花', msg);
      else ok = window.confirm(msg);
    } catch {
      ok = window.confirm(msg);
    }
    if (!ok) return;

    try {
      const r = await migrateEmbeddedProjectsToLocalInActiveCard({ allow: true, ensureCached: true, reloadChat: true });
      if (r.cancelled) {
        toastr.info('已取消迁移（未修改角色卡）');
        return;
      }
      toastr.success(`迁移完成：${r.migrated}/${r.totalEmbedded}，预导入缓存：${r.importedCount}`);
    } catch (err) {
      console.error('[Higanbana] migrate embedded->local failed', err);
      toastr.error(`迁移失败：${(err as any)?.message ?? err}`);
    }
  });

  $('#hb_open_home').on('click', () => {
    const active = getActiveCharacter();
    if (!active) return;
    const card = getCardData(active.character);
    const project = card.projects[0];
    if (!project) {
      toastr.error('当前角色卡未绑定任何 WebZip 项目');
      return;
    }
    if (!project.zipSha256) {
      toastr.error('尚未下载/导入 WebZip 到本地缓存');
      return;
    }
    const url = buildVfsUrl(extensionBase, project.zipSha256, project.homePage);
    window.open(url, '_blank', 'noopener,noreferrer');
  });

  $('#hb_export_zip').on('click', async () => {
    const active = getActiveCharacter();
    if (!active) return;
    const card = getCardData(active.character);
    const project = card.projects.find(p => p.source === 'embedded') as HiganbanaProjectEmbedded | undefined;
    if (!project) {
      toastr.error('当前角色卡没有可导出的嵌入项目');
      return;
    }
    try {
      const buf = await base64ToArrayBuffer(project.zipBase64);
      const blob = new Blob([buf], { type: 'application/zip' });
      downloadBlob(blob, project.zipName || 'webzip.zip');
    } catch (err) {
      console.error('[Higanbana] export zip failed', err);
      toastr.error(`导出失败：${(err as any)?.message ?? err}`);
    }
  });

  $('#hb_unbind').on('click', async () => {
    const ctx2 = getStContext();
    const active = getActiveCharacter();
    if (!active) return;
    const card = getCardData(active.character);
    if (card.projects.length === 0) return;

    const msg = `确定解绑当前角色的所有 WebZip 项目？\n\n${buildCardWebzipInfo(card)}`;
    let ok = false;
    try {
      if (ctx2?.Popup?.show?.confirm) ok = await ctx2.Popup.show.confirm('彼岸花', msg);
      else ok = window.confirm(msg);
    } catch {
      ok = window.confirm(msg);
    }
    if (!ok) return;

    try {
      await unbindAllProjectsFromActiveCard();
      toastr.success('已解绑');
      refreshCharacterUi();
    } catch (err) {
      console.error('[Higanbana] unbind failed', err);
      toastr.error(`解绑失败：${(err as any)?.message ?? err}`);
    }
  });

  $('#hb_bind_zip_btn').on('click', async () => {
    const active = getActiveCharacter();
    if (!active) {
      toastr.error('当前不在单角色聊天/未选中角色');
      return;
    }
    const file = ($('#hb_bind_zip').get(0) as HTMLInputElement | undefined)?.files?.[0];
    if (!file) {
      toastr.error('请先选择 zip 文件');
      return;
    }
    try {
      await bindZipArrayBufferToActiveCharacter(file.name, await file.arrayBuffer());
      // allow re-select same file
      ($('#hb_bind_zip').get(0) as HTMLInputElement).value = '';
      $('#hb_bind_zip_name').text('（未选择文件）');
    } catch (err) {
      console.error('[Higanbana] bind zip failed', err);
      toastr.error(`绑定失败：${(err as any)?.message ?? err}`);
    }
  });

  $('#hb_bind_zip_local_btn').on('click', async () => {
    const active = getActiveCharacter();
    if (!active) {
      toastr.error('当前不在单角色聊天/未选中角色');
      return;
    }
    const file = ($('#hb_bind_zip').get(0) as HTMLInputElement | undefined)?.files?.[0];
    if (!file) {
      toastr.error('请先选择 zip 文件');
      return;
    }
    try {
      await bindZipArrayBufferToActiveCharacterLocalOnly(file.name, await file.arrayBuffer());
      // allow re-select same file
      ($('#hb_bind_zip').get(0) as HTMLInputElement).value = '';
      $('#hb_bind_zip_name').text('（未选择文件）');
    } catch (err) {
      console.error('[Higanbana] bind local zip failed', err);
      toastr.error(`绑定失败：${(err as any)?.message ?? err}`);
    }
  });

  $('#hb_bind_url_btn').on('click', async () => {
    const active = getActiveCharacter();
    if (!active) {
      toastr.error('当前不在单角色聊天/未选中角色');
      return;
    }
    const urlInput = String($('#hb_bind_url').val() ?? '').trim();
    try {
      const { zipUrl, placeholder, homePage } = await bindUrlProjectToActiveCharacter(urlInput);
      const $ph = $('#hb_placeholder');
      if ($ph.length && document.activeElement !== $ph.get(0)) {
        $ph.val('');
      }
      refreshCharacterUi();
      $('#hb_new_title').val('');
      setStatus(`已添加项目（URL 模式）。\n占位符：${placeholder}\nURL：${zipUrl}\n入口：${homePage}\n提示：进入聊天时会提示下载并导入缓存`);
      toastr.success('已添加 URL 项目');
    } catch (err) {
      console.error('[Higanbana] bind url failed', err);
      toastr.error(`绑定失败：${(err as any)?.message ?? err}`);
    }
  });

  $('#hb_download_url_btn').on('click', async () => {
    try {
      await downloadAndApplyActiveUrlWebzipToCacheFromPanel();
    } catch (err) {
      console.error('[Higanbana] download url apply failed', err);
      toastr.error(`操作失败：${(err as any)?.message ?? err}`);
    }
  });

  $('#hb_cancel_url_download_btn').on('click', () => {
    try {
      abortPanelUrlDownload();
    } catch {
      //
    }
  });
}

