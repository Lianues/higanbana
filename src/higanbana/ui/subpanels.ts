function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v === '1';
  } catch {
    return fallback;
  }
}

function writeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    //
  }
}

export function bindCocktailLikeSubpanels(): void {
  const root = document.getElementById('higanbana_settings');
  if (!root) return;
  const panels = Array.from(root.querySelectorAll<HTMLElement>('.hb-subpanel'));
  for (const panel of panels) {
    const id = String(panel.dataset.id ?? '').trim();
    if (!id) continue;

    const header = panel.querySelector<HTMLButtonElement>('.hb-subpanel-header');
    const indicator = panel.querySelector<HTMLElement>('.hb-subpanel-indicator');
    const body = panel.querySelector<HTMLElement>('.hb-subpanel-body');
    if (!header || !indicator || !body) continue;

    if ((header as any).dataset?.hbBound === '1') continue;
    (header as any).dataset.hbBound = '1';

    const key = `higanbana.subpanel.open.${id}`;
    const defaultOpen = header.getAttribute('aria-expanded') === 'true';

    const apply = (open: boolean) => {
      header.setAttribute('aria-expanded', open ? 'true' : 'false');
      indicator.textContent = open ? '−' : '+';
      body.style.display = open ? 'block' : 'none';
    };

    apply(readBool(key, defaultOpen));

    header.addEventListener('click', () => {
      const open = header.getAttribute('aria-expanded') === 'true';
      const next = !open;
      apply(next);
      writeBool(key, next);
    });
  }
}

