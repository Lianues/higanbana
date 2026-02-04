import { getCardData } from '../card';
import { extensionBase } from '../env';
import { getSettings } from '../settings';
import { getActiveCharacter, getCharacterAvatar, getCharacterName } from '../st';
import { ensureUniquePlaceholder } from '../utils';
import { renderProjectsList } from './projectList';

export async function loadSettingsUi(): Promise<void> {
  // Avoid duplicate panels on hot reload / extension reload
  $('#higanbana_settings').remove();

  const resp = await fetch(`${extensionBase}settings.html`, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`加载 settings.html 失败: ${resp.status}`);
  const html = await resp.text();
  $('#extensions_settings').append(html);
}

export function refreshUi(): void {
  const s = getSettings();
  $('#hb_fix_root_relative').prop('checked', Boolean(s.defaultFixRootRelativeUrls));
  $('#hb_render_html_blocks').prop('checked', Boolean(s.renderHtmlCodeBlocks));
  $('#hb_render_html_blocks_blob').prop('checked', Boolean(s.renderHtmlCodeBlocksUseBlobUrl));
  $('#hb_render_html_blocks_titlebar').prop('checked', Boolean(s.renderHtmlCodeBlocksShowTitleBar));

  const $home = $('#hb_homepage');
  if ($home.length && !String($home.val() ?? '').trim()) {
    $home.val('index.html');
  }
}

export function refreshCharacterUi(): void {
  const s = getSettings();
  const active = getActiveCharacter();
  if (!active) {
    $('#hb_char_info').text('（未选中角色）');
    $('#hb_fix_root_relative').prop('checked', Boolean(s.defaultFixRootRelativeUrls));
    $('#hb_homepage').val(String($('#hb_homepage').val() ?? '').trim() || 'index.html');
    renderProjectsList([]);
    $('#hb_import_from_card').prop('disabled', true);
    $('#hb_unbind').prop('disabled', true);
    $('#hb_pick_zip_btn').prop('disabled', true);
    $('#hb_bind_zip').prop('disabled', true);
    $('#hb_bind_zip_btn').prop('disabled', true);
    $('#hb_bind_url').prop('disabled', true);
    $('#hb_bind_url_btn').prop('disabled', true);
    return;
  }

  const { chid, character } = active;
  const name = getCharacterName(character);
  const avatar = getCharacterAvatar(character);
  $('#hb_char_info').text([`名称：${name}`, `chid：${chid}`, avatar ? `avatar：${avatar}` : ''].filter(Boolean).join('\n'));

  const card = getCardData(character);
  renderProjectsList(card.projects);

  const hasProjects = card.projects.length > 0;
  $('#hb_import_from_card').prop('disabled', !card.projects.some(p => p.source === 'embedded'));
  $('#hb_unbind').prop('disabled', !hasProjects);
  $('#hb_pick_zip_btn').prop('disabled', false);
  $('#hb_bind_zip').prop('disabled', false);
  $('#hb_bind_zip_btn').prop('disabled', false);
  $('#hb_bind_url').prop('disabled', false);
  $('#hb_bind_url_btn').prop('disabled', false);

  // Defaults for new project form
  const $fix = $('#hb_fix_root_relative');
  if ($fix.length && document.activeElement !== $fix.get(0)) {
    $fix.prop('checked', Boolean(s.defaultFixRootRelativeUrls));
  }
  const $home = $('#hb_homepage');
  if ($home.length && document.activeElement !== $home.get(0) && !String($home.val() ?? '').trim()) {
    $home.val('index.html');
  }
  const $ph = $('#hb_placeholder');
  if ($ph.length && document.activeElement !== $ph.get(0) && !String($ph.val() ?? '').trim()) {
    $ph.val(ensureUniquePlaceholder(card.projects, `{{WEB_${card.projects.length + 1}}}`));
  }
}

