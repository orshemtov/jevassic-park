import type { Guest } from '@/games/coaster/types/economy';

export function guestVisualOffset(guest: Guest, now = Date.now()): { x: number; y: number } {
  const correction = guest.visualCorrection;
  if (!correction) return { x: 0, y: 0 };
  const remaining = Math.max(0, 1 - (now - correction.at) / 1000);
  return { x: correction.x * remaining * remaining, y: correction.y * remaining * remaining };
}

export function reconcileSpectatorGuests(previous: Guest[], incoming: Guest[], now: number): Guest[] {
  const before = new Map(previous.map(guest => [guest.id, guest]));
  return incoming.map(guest => {
    const old = before.get(guest.id);
    // Activity entry/exit keeps its existing building approach animation.
    if (!old || old.state !== 'walking' || guest.state !== 'walking') return guest;
    const oldX = old.tileX + (old.targetTileX - old.tileX) * old.progress;
    const oldY = old.tileY + (old.targetTileY - old.tileY) * old.progress;
    const nextX = guest.tileX + (guest.targetTileX - guest.tileX) * guest.progress;
    const nextY = guest.tileY + (guest.targetTileY - guest.tileY) * guest.progress;
    const dx = oldX - nextX, dy = oldY - nextY;
    const offset = guestVisualOffset(old, now);
    return { ...guest, visualCorrection: { x: (dx - dy) * 32 + offset.x,
      y: (dx + dy) * 19.2 + offset.y, at: now } };
  });
}
