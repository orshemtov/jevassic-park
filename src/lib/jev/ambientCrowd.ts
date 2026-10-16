import type { Tile } from '@/games/coaster/types/game';

export interface AmbientVisitor {
  x: number;
  y: number;
  nextX: number;
  nextY: number;
  phase: number;
  speed: number;
  offset: number;
  color: string;
}

export const MAX_AMBIENT_MARKS = 6000;
const COLORS = ['#f97316', '#facc15', '#22c55e', '#38bdf8', '#a78bfa', '#fb7185'];

// These are background visitors only. They have no needs, actions, or Jev requests.
export function createAmbientCrowd(grid: Tile[][], count: number, seed = 17): Map<string, AmbientVisitor[]> {
  const paths = grid.flat().filter(tile => tile.path || tile.queue);
  const byTile = new Map<string, AmbientVisitor[]>();
  if (!paths.length || count <= 0) return byTile;

  const pathSet = new Set(paths.map(tile => `${tile.x},${tile.y}`));
  let value = seed | 0;
  const random = () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 0x100000000;
  };

  for (let i = 0; i < Math.min(Math.floor(count), MAX_AMBIENT_MARKS); i++) {
    const tile = paths[Math.floor(random() * paths.length)];
    const neighbors = [
      [tile.x + 1, tile.y], [tile.x - 1, tile.y],
      [tile.x, tile.y + 1], [tile.x, tile.y - 1],
    ].filter(([x, y]) => pathSet.has(`${x},${y}`));
    const [nextX, nextY] = neighbors.length
      ? neighbors[Math.floor(random() * neighbors.length)]
      : [tile.x, tile.y];
    const visitor: AmbientVisitor = {
      x: tile.x, y: tile.y, nextX, nextY,
      phase: random() * 2, speed: 0.008 + random() * 0.008,
      offset: random() * 12 - 6, color: COLORS[Math.floor(random() * COLORS.length)],
    };
    const key = `${tile.x},${tile.y}`;
    const group = byTile.get(key);
    if (group) group.push(visitor);
    else byTile.set(key, [visitor]);
  }
  return byTile;
}

export function ambientVisitorPosition(visitor: AmbientVisitor, tick: number): { x: number; y: number } {
  const progress = 1 - Math.abs(((tick * visitor.speed + visitor.phase) % 2) - 1);
  const x = visitor.x + (visitor.nextX - visitor.x) * progress;
  const y = visitor.y + (visitor.nextY - visitor.y) * progress;
  return { x: (x - y) * 32 + 32 + visitor.offset, y: (x + y) * 19.2 + 19.2 + visitor.offset * 0.35 };
}

export function drawAmbientCrowdTile(
  ctx: CanvasRenderingContext2D,
  visitors: AmbientVisitor[] | undefined,
  tick: number,
): void {
  if (!visitors?.length) return;
  for (const visitor of visitors) {
    const { x, y } = ambientVisitorPosition(visitor, tick);
    const stride = Math.sin(tick * .35 + visitor.phase * 8) * .65;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(x - 1.3, y - 1, 1, 2 + stride);
    ctx.fillRect(x + .3, y - 1, 1, 2 - stride);
    ctx.fillStyle = visitor.color;
    ctx.fillRect(x - 1.5, y - 4, 3, 3.5);
    ctx.fillStyle = '#edc5a5';
    ctx.fillRect(x - 1, y - 6.2, 2, 2.2);
    ctx.fillStyle = '#493a32';
    ctx.fillRect(x - 1, y - 6.5, 2, .8);
  }
}
