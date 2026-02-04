const CACHE_PREFIX = 'st-higanbana-vfs-';

export const cachedProjectIds = new Set<string>();

export async function refreshCachedProjects(): Promise<void> {
  try {
    const keys = await caches.keys();
    cachedProjectIds.clear();
    for (const key of keys) {
      if (key.startsWith(CACHE_PREFIX)) {
        cachedProjectIds.add(key.slice(CACHE_PREFIX.length));
      }
    }
  } catch (err) {
    console.warn('[Higanbana] caches.keys failed', err);
  }
}

export function isProjectCached(projectId: string): boolean {
  return Boolean(projectId) && cachedProjectIds.has(projectId);
}

