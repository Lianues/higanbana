import { getStContext } from './st';

export type HiganbanaSettings = {
  placeholder: string;
  defaultFixRootRelativeUrls: boolean;

  /** 将消息中的 HTML 代码块渲染为 iframe */
  renderHtmlCodeBlocks: boolean;
  /** HTML 代码块渲染：使用 blob url（分配页面） */
  renderHtmlCodeBlocksUseBlobUrl: boolean;
  /** HTML 代码块渲染：显示标题栏（并提供新标签页打开） */
  renderHtmlCodeBlocksShowTitleBar: boolean;

  allowedCharacterAvatars: string[];
};

const MODULE_NAME = 'higanbana';

export const DEFAULT_SETTINGS: Readonly<HiganbanaSettings> = Object.freeze({
  placeholder: '{{WEB_HOME}}',
  defaultFixRootRelativeUrls: true,

  renderHtmlCodeBlocks: false,
  renderHtmlCodeBlocksUseBlobUrl: false,
  renderHtmlCodeBlocksShowTitleBar: false,

  allowedCharacterAvatars: [],
});

export function getSettings(): HiganbanaSettings {
  const ctx = getStContext();
  if (!ctx) return structuredClone(DEFAULT_SETTINGS);

  ctx.extensionSettings[MODULE_NAME] = ctx.extensionSettings[MODULE_NAME] || {};
  const s = ctx.extensionSettings[MODULE_NAME] as Partial<HiganbanaSettings>;

  if (typeof s.placeholder !== 'string' || !s.placeholder.trim()) {
    s.placeholder = DEFAULT_SETTINGS.placeholder;
  }
  if (typeof s.defaultFixRootRelativeUrls !== 'boolean') {
    s.defaultFixRootRelativeUrls = DEFAULT_SETTINGS.defaultFixRootRelativeUrls;
  }
  if (typeof s.renderHtmlCodeBlocks !== 'boolean') {
    s.renderHtmlCodeBlocks = DEFAULT_SETTINGS.renderHtmlCodeBlocks;
  }
  if (typeof s.renderHtmlCodeBlocksUseBlobUrl !== 'boolean') {
    s.renderHtmlCodeBlocksUseBlobUrl = DEFAULT_SETTINGS.renderHtmlCodeBlocksUseBlobUrl;
  }
  if (typeof s.renderHtmlCodeBlocksShowTitleBar !== 'boolean') {
    s.renderHtmlCodeBlocksShowTitleBar = DEFAULT_SETTINGS.renderHtmlCodeBlocksShowTitleBar;
  }

  if (!Array.isArray(s.allowedCharacterAvatars)) {
    s.allowedCharacterAvatars = [];
  } else {
    s.allowedCharacterAvatars = s.allowedCharacterAvatars
      .map(x => String(x).trim())
      .filter(x => x.length > 0);
  }

  return s as HiganbanaSettings;
}

export function saveSettings(): void {
  const ctx = getStContext();
  ctx?.saveSettingsDebounced?.();
}

