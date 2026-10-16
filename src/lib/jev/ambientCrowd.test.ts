import { describe, expect, it } from 'vitest';
import type { Tile } from '@/games/coaster/types/game';
import { ambientVisitorPosition, createAmbientCrowd, MAX_AMBIENT_MARKS } from './ambientCrowd';

describe('ambient crowd', () => {
  it('seeds moving visitors only on paths and caps work for large crowds', () => {
    const tile = (x: number, y: number, path: boolean) => ({ x, y, path, queue: false }) as Tile;
    const grid = [[tile(0, 0, true), tile(0, 1, true)], [tile(1, 0, false), tile(1, 1, false)]];
    const crowd = createAmbientCrowd(grid, 10000);
    const visitors = [...crowd.values()].flat();

    expect(visitors).toHaveLength(MAX_AMBIENT_MARKS);
    expect([...crowd.keys()].sort()).toEqual(['0,0', '0,1']);
    expect(createAmbientCrowd(grid, 3)).toEqual(createAmbientCrowd(grid, 3));
    expect(ambientVisitorPosition(visitors[0], 0)).not.toEqual(ambientVisitorPosition(visitors[0], 20));
    expect(createAmbientCrowd([[tile(0, 0, false)]], 100).size).toBe(0);
  });
});
