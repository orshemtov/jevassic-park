import type { GameState } from '@/games/coaster/types/game';

export type ParkSpectacle = {
  kind: 'parade' | 'fireworks' | 'fountain'; startedAt: number; durationMs: number;
  center: { x: number; y: number }; route: { x: number; y: number }[];
};

export function spectacleForAnnouncement(text: string): ParkSpectacle['kind'] | undefined {
  return /parade/i.test(text) ? 'parade' : /fireworks/i.test(text) ? 'fireworks' : /fountain show/i.test(text) ? 'fountain' : undefined;
}

export function spectacleAnnouncement(kind: ParkSpectacle['kind']): string {
  return kind === 'parade' ? 'The parade is starting. Front-row enthusiasm encouraged.' :
    kind === 'fireworks' ? 'Fireworks above the castle! Come watch the sky sparkle.' :
      'The fountain show is starting. Front row may get splashed.';
}

export function findSpectacleVenue(grid: GameState['grid'], kind: ParkSpectacle['kind']) {
  const tiles = grid.flat();
  if (kind === 'fireworks') {
    const castle = tiles.find(tile => tile.building?.type === 'ride_themed_facade');
    if (castle) return castle;
  }
  return tiles.find(tile => !tile.building?.type.endsWith('_footprint') && (kind === 'parade' ? tile.building?.type === 'show_parade_float' :
    kind === 'fountain' ? tile.building?.type.startsWith('fountain_') : /castle/.test(tile.building?.type ?? '')));
}

export function createParkSpectacle(park: Pick<GameState, 'grid'>, kind: ParkSpectacle['kind'], now: number): ParkSpectacle | undefined {
  const tiles = park.grid.flat();
  const anchor = findSpectacleVenue(park.grid, kind);
  if (!anchor) return undefined;
  const center = { x: anchor.x, y: anchor.y };
  const paths = tiles.filter(tile => tile.path).sort((a, b) => Math.abs(a.x - center.x) + Math.abs(a.y - center.y) - Math.abs(b.x - center.x) - Math.abs(b.y - center.y));
  const start = paths[0];
  if (!start) return undefined;
  const route = [{ x: start.x, y: start.y }];
  if (kind === 'parade') {
    const visited = new Set([`${start.x},${start.y}`]);
    // A short connected out-and-back route keeps the procession near its gathering point.
    for (let step = 0; step < 18; step++) {
      const last = route[route.length - 1];
      const next = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([dx, dy]) => park.grid[last.y + dy]?.[last.x + dx])
        .find(tile => tile?.path && !visited.has(`${tile.x},${tile.y}`) && Math.abs(tile.x - center.x) + Math.abs(tile.y - center.y) <= 12);
      if (!next) break;
      route.push({ x: next.x, y: next.y }); visited.add(`${next.x},${next.y}`);
    }
    route.push(...route.slice(0, -1).reverse());
  }
  return { kind, startedAt: now, durationMs: kind === 'fireworks' ? 120_000 : 240_000, center, route };
}
