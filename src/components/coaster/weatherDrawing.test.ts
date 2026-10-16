import { describe, expect, it, vi } from 'vitest';
import { drawParkWeather, rainDrops } from './weatherDrawing';

describe('park weather coverage', () => {
  it('distributes bounded rain across the entire viewport', () => {
    const drops = rainDrops(1920, 1080, 0, false);
    expect(drops.length).toBeLessThanOrEqual(240);
    expect(drops.some(drop => drop.x > 1700 && drop.y > 900)).toBe(true);
    expect(drops.some(drop => drop.x < 200 && drop.y < 150)).toBe(true);
    expect(rainDrops(8000, 4000, 0, true)).toHaveLength(240);
    expect(rainDrops(1920, 1080, 1, false)[0]).not.toEqual(drops[0]);
  });
  it('uses only a full viewport tint with reduced motion', () => {
    const ctx = { save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn() } as unknown as CanvasRenderingContext2D;
    drawParkWeather(ctx, 'rain', 1200, 800, 1, 2, true);
    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1200, 800);
    expect(ctx.beginPath).not.toHaveBeenCalled();
  });
});
