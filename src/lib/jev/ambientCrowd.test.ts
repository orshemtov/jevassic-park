import { describe, expect, it, vi } from 'vitest';
import type { Tile } from '@/games/coaster/types/game';
import { ambientVisitorPosition, createAmbientCrowd, drawAmbientCrowdTile, MAX_AMBIENT_MARKS } from './ambientCrowd';

describe('ambient crowd', () => {
  it('waves only a decorative subset during nearby shows', () => {
    const fillRect = vi.fn();
    const ctx = { fillRect } as unknown as CanvasRenderingContext2D;
    const visitor = { x: 0, y: 0, nextX: 1, nextY: 0, phase: .2, speed: .01, offset: 0, color: '#fff' };
    drawAmbientCrowdTile(ctx, [visitor], 0);
    const normal = fillRect.mock.calls.length;
    fillRect.mockClear();
    drawAmbientCrowdTile(ctx, [visitor], 0, true);
    expect(fillRect).toHaveBeenCalledTimes(normal + 2);
    fillRect.mockClear();
    drawAmbientCrowdTile(ctx, [{ ...visitor, phase: 1 }], 0, true);
    expect(fillRect).toHaveBeenCalledTimes(normal);
  });
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
