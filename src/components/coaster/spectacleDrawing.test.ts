import { describe, expect, it } from 'vitest';
import { routePoint } from './spectacleDrawing';

describe('parade route interpolation', () => {
  const route = [{ x: 1, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 4 }];
  it('stays on route segments and clamps both ends', () => {
    expect(routePoint(route, .25)).toEqual({ x: 2, y: 2 });
    expect(routePoint(route, .75)).toEqual({ x: 3, y: 3 });
    expect(routePoint(route, -1)).toEqual(route[0]);
    expect(routePoint(route, 2)).toEqual(route[2]);
    expect(routePoint([], .5)).toBeNull();
    expect(routePoint([{ x: 2, y: 3 }], .5)).toEqual({ x: 2, y: 3 });
  });
});
