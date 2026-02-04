export function getStContext(): any | null {
  const st = (globalThis as any).SillyTavern;
  if (!st?.getContext) return null;
  return st.getContext();
}

export function getActiveCharacter(): { chid: number; character: any } | null {
  const ctx = getStContext();
  if (!ctx) return null;

  const chid = Number(ctx.characterId);
  if (!Number.isFinite(chid) || chid < 0) return null;
  const character = ctx.characters?.[chid];
  if (!character) return null;
  return { chid, character };
}

export function getCharacterName(character: any): string {
  return String(character?.name ?? character?.data?.name ?? '').trim() || '(未命名角色)';
}

export function getCharacterAvatar(character: any): string {
  return String(character?.avatar ?? '').trim();
}

