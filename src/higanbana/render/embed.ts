import { buildVfsUrl } from '../../webzip';
import type { HiganbanaProject } from '../card';
import { isProjectCached } from '../cache';
import { extensionBase } from '../env';
import { isAvatarAllowed } from '../avatarAllow';
import { getActiveCharacter, getCharacterAvatar } from '../st';
import { installIframeAutoResize } from './iframeAutoResize';

export type RenderTarget =
  | { kind: 'iframe'; src: string; title: string }
  | { kind: 'stub'; title: string; reason: string };

export function resolveProjectRenderTarget(project: HiganbanaProject): RenderTarget {
  const active = getActiveCharacter();
  if (!active) {
    return { kind: 'stub', title: '彼岸花：无法渲染', reason: '当前不在单角色聊天/未选中角色。' };
  }

  const name = project.title || project.zipName;
  const avatar = getCharacterAvatar(active.character);
  if (avatar && !isAvatarAllowed(avatar)) {
    return {
      kind: 'stub',
      title: `彼岸花：未启用（${name}）`,
      reason:
        project.source === 'url'
          ? '该角色卡绑定了 WebZip URL，但尚未允许/下载。切换到该角色时会弹窗询问，或在面板/弹窗中下载并导入缓存。'
          : '该角色卡包含嵌入 WebZip，但尚未允许/导入。切换到该角色时会弹窗询问，或在面板点“导入所有嵌入项目到本地缓存”。',
    };
  }

  const projectId = project.zipSha256;
  if (!projectId) {
    return {
      kind: 'stub',
      title: `彼岸花：未下载（${name}）`,
      reason: project.source === 'url' ? '请在面板/弹窗中下载并导入缓存后即可渲染。' : '缺少 projectId，无法渲染。',
    };
  }
  if (!isProjectCached(projectId)) {
    return {
      kind: 'stub',
      title: `彼岸花：未导入缓存（${name}）`,
      reason: project.source === 'url' ? '请下载并导入缓存后即可渲染。' : '请先导入到本地缓存（面板中可操作），再刷新聊天即可渲染。',
    };
  }

  const src = buildVfsUrl(extensionBase, projectId, project.homePage);
  return { kind: 'iframe', src, title: `彼岸花：${name} · ${project.homePage}` };
}

export function createEmbedNode(
  messageId: number,
  index: number,
  target: RenderTarget,
  opts: { projectId?: string; showTitleInChat?: boolean } = {},
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'hb-embed';
  wrapper.dataset.hbEmbed = '1';
  wrapper.classList.add(target.kind === 'stub' ? 'hb-embed-stub' : 'hb-embed-iframe');
  if (opts.projectId) wrapper.dataset.hbProjectId = opts.projectId;
  const showTitleInChat = opts.showTitleInChat === true;
  if (!showTitleInChat) wrapper.classList.add('hb-embed-no-title');

  const header = document.createElement('div');
  header.className = 'hb-embed-header';

  const left = document.createElement('div');
  left.className = 'hb-embed-title';
  left.textContent = target.title;

  const right = document.createElement('div');
  right.className = 'hb-embed-actions';
  if (target.kind === 'iframe') {
    const link = document.createElement('a');
    link.href = target.src;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = '新标签页打开';
    right.appendChild(link);
  }

  header.appendChild(left);
  header.appendChild(right);
  wrapper.appendChild(header);

  const body = document.createElement('div');
  body.className = 'hb-embed-body';

  if (target.kind === 'stub') {
    const tip = document.createElement('div');
    tip.style.padding = '10px';
    tip.style.opacity = '0.9';
    tip.textContent = target.reason;
    body.appendChild(tip);
    wrapper.appendChild(body);
    return wrapper;
  }

  const iframe = document.createElement('iframe');
  iframe.className = 'hb-iframe';
  iframe.loading = 'lazy';
  iframe.referrerPolicy = 'no-referrer';
  iframe.name = `hb-${messageId}-${index}`;
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  iframe.src = target.src;
  installIframeAutoResize(iframe);
  body.appendChild(iframe);
  wrapper.appendChild(body);
  return wrapper;
}

export function updateEmbedTitleVisibilityForProject(projectId: string, showTitleInChat: boolean): void {
  if (!projectId) return;
  const list = document.querySelectorAll<HTMLElement>('.hb-embed[data-hb-project-id]');
  for (const el of list) {
    if (String((el as any).dataset?.hbProjectId ?? '') !== projectId) continue;
    if (showTitleInChat) el.classList.remove('hb-embed-no-title');
    else el.classList.add('hb-embed-no-title');
  }
}

