import { formatBytes, formatPercent, formatSpeed } from '../webzip';

export function renderProgressLine(p: {
  loadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  speedBps: number | null;
}): string {
  const loaded = formatBytes(p.loadedBytes);
  const total = p.totalBytes ? formatBytes(p.totalBytes) : '?';
  const percent = p.totalBytes ? formatPercent(p.percent) : '—';
  const speed = formatSpeed(p.speedBps);
  return `下载：${loaded} / ${total}（${percent}） | 速度：${speed}`;
}

