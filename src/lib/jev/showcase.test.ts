import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GameState } from '@/games/coaster/types/game';
import { TOOL_INFO } from '@/games/coaster/types';
import { summarizePark } from './parkState';

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
    const attractions = summarizePark(park).attractions;
    expect(attractions.length).toBeGreaterThan(25);
    for (const attraction of attractions) {
      expect(attraction.label).not.toContain('footprint');
      const [x, y] = attraction.id.split(':')[1].split(',').map(Number);
      expect([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => reached.has(`${x + dx},${y + dy}`)), attraction.id).toBe(true);
      const tile = park.grid[y][x];
      const size = TOOL_INFO[tile.building.type as keyof typeof TOOL_INFO]?.size ?? { width: 1, height: 1 };
      for (let dy = 0; dy < size.height; dy++) for (let dx = 0; dx < size.width; dx++) {
        expect(park.grid[y + dy][x + dx].path, attraction.id).toBe(false);
        expect(park.grid[y + dy][x + dx].queue, attraction.id).toBe(false);
      }
    }
    expect(park.coasters).toHaveLength(3);
  });
});
