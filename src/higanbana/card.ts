import { getStContext } from './st';

export type HiganbanaProjectBase = {
  id: string;
  title?: string;
  placeholder: string;
  homePage: string;
  /** 是否在消息列表的 iframe 上方显示标题栏文本 */
  showTitleInChat: boolean;
  fixRootRelativeUrls: boolean;
  zipName: string;
  /** sha256 hex (projectId). URL 项目首次绑定时允许为空，下载导入后写回以便复用缓存。 */
  zipSha256: string;
};

export type HiganbanaProjectEmbedded = HiganbanaProjectBase & {
  source: 'embedded';
  zipBase64: string;
};

export type HiganbanaProjectUrl = HiganbanaProjectBase & {
  source: 'url';
  zipUrl: string;
};

export type HiganbanaProjectLocal = HiganbanaProjectBase & {
  /** 仅依赖当前前端缓存，不在角色卡里保存 zip 内容或下载 URL */
  source: 'local';
};

export type HiganbanaProject = HiganbanaProjectEmbedded | HiganbanaProjectUrl | HiganbanaProjectLocal;

export type HiganbanaCardData = {
  projects: HiganbanaProject[];
};

export function getCardData(character: any): HiganbanaCardData {
  const empty: HiganbanaCardData = { projects: [] };
  const raw = character?.data?.extensions?.higanbana;
  if (!raw || typeof raw !== 'object') return empty;

  const projectsRaw = (raw as any).projects;
  if (!Array.isArray(projectsRaw)) return empty;

  const projects: HiganbanaProject[] = [];
  for (const p of projectsRaw) {
    if (!p || typeof p !== 'object') continue;
    const source = String((p as any).source ?? '').trim();
    const id = String((p as any).id ?? '').trim();
    const title = String((p as any).title ?? '').trim() || undefined;
    const placeholder = String((p as any).placeholder ?? '').trim();
    const homePage = String((p as any).homePage ?? '').trim();
    const showTitleInChat = typeof (p as any).showTitleInChat === 'boolean' ? Boolean((p as any).showTitleInChat) : false;
    const fixRootRelativeUrls = Boolean((p as any).fixRootRelativeUrls);
    const zipName = String((p as any).zipName ?? '').trim();
    const zipSha256 = String((p as any).zipSha256 ?? '').trim();

    if (!id || !placeholder || !homePage || !zipName) continue;

    if (source === 'embedded') {
      const zipBase64 = String((p as any).zipBase64 ?? '').trim();
      if (!zipBase64 || !zipSha256) continue;
      projects.push({
        source: 'embedded',
        id,
        title,
        placeholder,
        homePage,
        showTitleInChat,
        fixRootRelativeUrls,
        zipName,
        zipSha256,
        zipBase64,
      });
      continue;
    }

    if (source === 'local') {
      if (!zipSha256) continue;
      projects.push({
        source: 'local',
        id,
        title,
        placeholder,
        homePage,
        showTitleInChat,
        fixRootRelativeUrls,
        zipName,
        zipSha256,
      });
      continue;
    }

    if (source === 'url') {
      const zipUrl = String((p as any).zipUrl ?? '').trim();
      if (!zipUrl) continue;
      projects.push({
        source: 'url',
        id,
        title,
        placeholder,
        homePage,
        showTitleInChat,
        fixRootRelativeUrls,
        zipName,
        zipSha256: zipSha256 || '',
        zipUrl,
      });
    }
  }

  return { projects };
}

export async function writeCardData(chid: number, data: HiganbanaCardData | null): Promise<void> {
  const ctx = getStContext();
  if (!ctx?.writeExtensionField) {
    throw new Error('writeExtensionField 不可用（酒馆版本过旧或上下文缺失）');
  }
  await ctx.writeExtensionField(chid, 'higanbana', data);
}

