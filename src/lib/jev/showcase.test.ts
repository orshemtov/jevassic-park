import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GameState } from '@/games/coaster/types/game';
import { TOOL_INFO } from '@/games/coaster/types';

const park: GameState = JSON.parse(readFileSync('public/parks/showcase.json', 'utf8'));

describe('fixed park layout', () => {
  it('connects every attraction to the entrance and keeps building footprints clear', () => {
    const reached = new Set(['30,59']);
    const queue = [{ x: 30, y: 59 }];
    for (let head = 0; head < queue.length; head++) {
      const { x, y } = queue[head];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const tile = park.grid[y + dy]?.[x + dx];
        if (tile && (tile.path || tile.queue) && !reached.has(`${tile.x},${tile.y}`)) {
          reached.add(`${tile.x},${tile.y}`);
          queue.push(tile);
        }
      }
    }
    const walkable = park.grid.flat().filter(tile => tile.path || tile.queue);
    expect(reached.size).toBe(walkable.length);
    const attractions = park.grid.flat().filter(tile => {
      const kind = tile.building.type;
      return !kind.endsWith('_footprint') &&
        (kind === 'restroom' || kind === 'first_aid' || /^(ride_|show_|station_|food_|drink_|shop_|arcade_)/.test(kind));
    });
    const rides = attractions.filter(tile => /^(ride_|show_|station_)/.test(tile.building.type));
    expect(rides.length).toBeGreaterThanOrEqual(34);
    expect(rides.filter(tile => tile.y < 22 && tile.x < 34).length).toBeGreaterThanOrEqual(9);
    for (const tile of attractions) {
      const { x, y } = tile;
      expect([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => reached.has(`${x + dx},${y + dy}`)), tile.building.type).toBe(true);
      const size = TOOL_INFO[tile.building.type as keyof typeof TOOL_INFO]?.size ?? { width: 1, height: 1 };
      for (let dy = 0; dy < size.height; dy++) for (let dx = 0; dx < size.width; dx++) {
        expect(park.grid[y + dy][x + dx].path, tile.building.type).toBe(false);
        expect(park.grid[y + dy][x + dx].queue, tile.building.type).toBe(false);
      }
    }
    expect(park.coasters).toHaveLength(3);
  });
});
