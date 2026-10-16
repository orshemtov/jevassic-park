import { describe, expect, it } from 'vitest';
import { getBuildingSpriteHitboxes, guestScreenPoint, inspectBuilding, inspectBuildingSprite, screenToGrid } from './CoasterGrid';
import { createGuest } from './guests/guestSystem';
import type { Tile } from '@/games/coaster/types';

describe('park map inspection', () => {
  it('tracks the guest between tiles rather than jumping to tile centers', () => {
    const guest = { ...createGuest(10, 10, 60), tileX: 10, tileY: 10,
      targetTileX: 11, targetTileY: 10, state: 'walking' as const, progress: 0 };
    const start = guestScreenPoint(guest);
    const middle = guestScreenPoint({ ...guest, progress: .5 });
    const end = guestScreenPoint({ ...guest, progress: 1 });
    expect(middle.x - start.x).toBeCloseTo(16);
    expect(middle.y - start.y).toBeCloseTo(9.6);
    expect(end.x - start.x).toBeCloseTo(32);
    expect(end.y - start.y).toBeCloseTo(19.2);
  });
  it('maps a visible tile center and nearby points to that tile', () => {
    const x = (13 - 18) * 32 + 32;
    const y = (13 + 18) * 19.2 + 19.2;
    expect(screenToGrid(x, y, 0, 0)).toEqual({ gridX: 13, gridY: 18 });
    expect(screenToGrid(x + 12, y + 5, 0, 0)).toEqual({ gridX: 13, gridY: 18 });
  });

  it('resolves a multi-tile footprint to its named building', () => {
    const grid = Array.from({ length: 6 }, (_, y) => Array.from({ length: 6 }, (_, x) => ({
      x, y, building: { type: 'empty' },
    }))) as Tile[][];
    grid[1][1].building.type = 'ride_go_karts';
    grid[2][3].building.type = 'ride_go_karts_footprint' as Tile['building']['type'];
    expect(inspectBuilding(grid, 3, 2)).toEqual({ x: 1, y: 1, type: 'ride_go_karts' });
    expect(inspectBuilding(grid, 5, 5)).toBeNull();
  });

  it('finds a station by clicking its visible roof above the ground tile', () => {
    const grid = Array.from({ length: 5 }, (_, y) => Array.from({ length: 5 }, (_, x) => ({
      x, y, building: { type: 'empty' },
    }))) as Tile[][];
    grid[2][2].building.type = 'station_wooden_1';
    const sheet = { width: 2048, height: 2048, getContext: () => ({ getImageData: () => ({ data: [0, 0, 0, 255] }) }) } as unknown as HTMLCanvasElement;
    const boxes = getBuildingSpriteHitboxes(grid, new Map([['stations', sheet]]));
    const roofX = boxes[0].left + boxes[0].width / 2;
    const roofY = boxes[0].top + 5;
    expect(screenToGrid(roofX, roofY, 0, 0)).not.toEqual({ gridX: 2, gridY: 2 });
    expect(inspectBuildingSprite(boxes, roofX, roofY)).toEqual({ x: 2, y: 2, type: 'station_wooden_1' });
  });
});
