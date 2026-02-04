import { getCardData } from '../card';
import type { HiganbanaProject } from '../card';
import { getActiveCharacter, getStContext } from '../st';
import type { RenderTarget } from './embed';
import { createEmbedNode, resolveProjectRenderTarget } from './embed';
import { renderHtmlCodeBlocksInMesText } from './htmlBlocks';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function replacePlaceholdersInMesText(mesTextEl: HTMLElement, messageId: number): void {
  const active = getActiveCharacter();
  if (!active) return;
  const card = getCardData(active.character);
  if (card.projects.length === 0) return;

  const placeholderToProject = new Map<string, HiganbanaProject>();
  for (const p of card.projects) {
    const ph = String(p.placeholder ?? '').trim();
    if (!ph) continue;
    if (placeholderToProject.has(ph)) continue; // ignore duplicates
    placeholderToProject.set(ph, p);
  }

  const placeholders = Array.from(placeholderToProject.keys());
  if (placeholders.length === 0) return;

  const fullText = mesTextEl.textContent || '';
  let maybeHasAny = false;
  for (const ph of placeholders) {
    if (fullText.includes(ph)) {
      maybeHasAny = true;
      break;
    }
  }
  if (!maybeHasAny) return;

  placeholders.sort((a, b) => b.length - a.length);
  const union = placeholders.map(escapeRegExp).join('|');
  const re = new RegExp(union, 'g');
  const reTest = new RegExp(union);

  const targetByPlaceholder = new Map<string, RenderTarget>();
  for (const ph of placeholders) {
    const proj = placeholderToProject.get(ph);
    if (!proj) continue;
    targetByPlaceholder.set(ph, resolveProjectRenderTarget(proj));
  }

  let embedIndex = 0;
  const walker = document.createTreeWalker(mesTextEl, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node?.nodeValue || '';
      if (!text || !reTest.test(text)) return NodeFilter.FILTER_REJECT;

      // Skip inside code blocks
      let p: Node | null = node.parentNode;
      while (p && p !== mesTextEl) {
        if (p.nodeType === 1) {
          const tag = (p as HTMLElement).tagName;
          if (tag === 'CODE' || tag === 'PRE' || tag === 'TEXTAREA') return NodeFilter.FILTER_REJECT;
        }
        p = p.parentNode;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const text = node.nodeValue || '';
    if (!reTest.test(text)) continue;

    re.lastIndex = 0;
    let lastIndex = 0;
    const frag = document.createDocumentFragment();
    for (const m of text.matchAll(re)) {
      const start = Number(m.index ?? 0);
      const match = String(m[0] ?? '');
      if (start > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, start)));
      }
      const proj = placeholderToProject.get(match);
      const target = targetByPlaceholder.get(match);
      if (target) {
        frag.appendChild(
          createEmbedNode(messageId, embedIndex++, target, {
            projectId: proj?.id,
            showTitleInChat: proj?.showTitleInChat,
          }),
        );
      } else {
        frag.appendChild(document.createTextNode(match));
      }
      lastIndex = start + match.length;
    }
    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    node.parentNode?.replaceChild(frag, node);
  }
}

function processMessageById(messageId: any): void {
  const id = Number(messageId);
  if (!Number.isFinite(id)) return;
  const $mes = $(`#chat .mes[mesid="${id}"]`);
  if ($mes.length === 0) return;
  const el = $mes.find('.mes_text').get(0) as HTMLElement | undefined;
  if (!el) return;
  replacePlaceholdersInMesText(el, id);
  renderHtmlCodeBlocksInMesText(el, id);
}

export function processAllDisplayedMessages(): void {
  const list = document.querySelectorAll('#chat .mes[mesid]');
  for (const mes of list) {
    const idAttr = (mes as HTMLElement).getAttribute('mesid');
    const id = Number(idAttr);
    if (!Number.isFinite(id)) continue;
    const el = (mes as HTMLElement).querySelector('.mes_text') as HTMLElement | null;
    if (!el) continue;
    replacePlaceholdersInMesText(el, id);
    renderHtmlCodeBlocksInMesText(el, id);
  }
}

let processAllScheduled = false;
export function scheduleProcessAllDisplayedMessages(): void {
  if (processAllScheduled) return;
  processAllScheduled = true;
  setTimeout(() => {
    processAllScheduled = false;
    processAllDisplayedMessages();
  }, 0);
}

let messageHooksBound = false;
export function bindMessageHooks(): void {
  if (messageHooksBound) return;
  const ctx = getStContext();
  if (!ctx?.eventSource || !ctx?.event_types) return;
  messageHooksBound = true;

  const { eventSource, event_types } = ctx;
  const onRendered = (...args: any[]) => processMessageById(args?.[0]);
  const onMessageChanged = (...args: any[]) => {
    // “编辑消息保存后占位符变回文字”的根因：编辑会让酒馆重新渲染 mes_text，
    // 我们需要在渲染完成后再次替换占位符。
    // 不做短 TTL 过滤：用户可能编辑很久（>10s），过滤会漏掉渲染。
    const id = Number(args?.[0]);
    if (!Number.isFinite(id)) return;
    // 等待一帧，确保 DOM 已更新
    setTimeout(() => processMessageById(id), 0);
    setTimeout(() => processMessageById(id), 50);
  };

  eventSource.on(event_types.USER_MESSAGE_RENDERED, onRendered);
  eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onRendered);
  if (event_types.MESSAGE_EDITED) {
    eventSource.on(event_types.MESSAGE_EDITED, onMessageChanged);
  }
  if (event_types.MESSAGE_UPDATED) {
    eventSource.on(event_types.MESSAGE_UPDATED, onMessageChanged);
  }

  if (event_types.MORE_MESSAGES_LOADED) {
    eventSource.on(event_types.MORE_MESSAGES_LOADED, () => scheduleProcessAllDisplayedMessages());
  }
  if (event_types.CHAT_CHANGED) {
    eventSource.on(event_types.CHAT_CHANGED, () => scheduleProcessAllDisplayedMessages());
  }
}

