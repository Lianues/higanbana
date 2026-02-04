import { getSettings, saveSettings } from './settings';

export function isAvatarAllowed(avatar: string): boolean {
  return getSettings().allowedCharacterAvatars.includes(avatar);
}

export function allowAvatar(avatar: string): void {
  const s = getSettings();
  if (!s.allowedCharacterAvatars.includes(avatar)) {
    s.allowedCharacterAvatars.push(avatar);
    saveSettings();
  }
}

