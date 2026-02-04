import { getStContext } from './st';
import type { HiganbanaCardData } from './card';

export function generateProjectId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && typeof (crypto as any).randomUUID === 'function') {
      return (crypto as any).randomUUID();
    }
  } catch {
    //
  }
  const ctx = getStContext();
  try {
    const uuidv4 = ctx?.uuidv4;
    if (typeof uuidv4 === 'function') return String(uuidv4());
  } catch {
    //
  }
  // Fallback: not RFC4122, but stable enough for local ids
  return `hb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizePlaceholderInput(value: unknown): string {
  return String(value ?? '').trim();
}

export function ensureUniquePlaceholder(existingProjects: Array<{ placeholder: string }>, desired: string): string {
  const existing = new Set(existingProjects.map(p => p.placeholder));
  let base = normalizePlaceholderInput(desired);
  if (!base) {
    // Default: {{WEB_1}}, {{WEB_2}}...
    base = `{{WEB_${existingProjects.length + 1}}}`;
  }
  if (!existing.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const suffix = `_${i}`;
    const candidate = base.endsWith('}}') ? base.slice(0, -2) + suffix + '}}' : base + suffix;
    if (!existing.has(candidate)) return candidate;
  }
  return base;
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.setAttribute('download', filename);
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(a.href);
  document.body.removeChild(a);
}

export function normalizeHttpUrl(url: string): string | null {
  const raw = String(url ?? '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function guessZipNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() || 'webzip.zip';
    return last.endsWith('.zip') ? last : `${last}.zip`;
  } catch {
    return 'webzip.zip';
  }
}

export function buildCardWebzipInfo(card: HiganbanaCardData | null): string {
  const projects = card?.projects ?? [];
  if (projects.length === 0) return '（无）';
  const names = projects
    .slice(0, 3)
    .map(p => p.title || p.zipName)
    .filter(Boolean);
  const more = projects.length > names.length ? ` +${projects.length - names.length}` : '';
  return `项目数：${projects.length}${names.length ? ` | ${names.join(' / ')}${more}` : ''}`;
}

