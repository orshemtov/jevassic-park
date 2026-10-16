import { expect, it, vi } from 'vitest';
import { detailedGuest, drawGuestIncident } from './guestEffects';

it('keeps followed and responding guests detailed at distant and mobile zooms', () => {
  expect(detailedGuest(.4, false, false)).toBe(false);
  expect(detailedGuest(.7, true, false)).toBe(false);
  expect(detailedGuest(.7, false, false)).toBe(true);
  expect(detailedGuest(.2, true, true)).toBe(true);
});
it('does not paint an expired incident', () => {
  const ctx = { save: vi.fn() } as unknown as CanvasRenderingContext2D;
  drawGuestIncident(ctx, { kind: 'hat', at: 0, expiresAt: 1000 }, { x: 0, y: 0 }, 1000, false);
  expect(ctx.save).not.toHaveBeenCalled();
});

it('caps incidental captions and removes them after seven seconds', () => {
  const ctx = { save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), fillRect: vi.fn(),
    beginPath: vi.fn(), roundRect: vi.fn(), fill: vi.fn(), stroke: vi.fn(), fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 1000 })) } as unknown as CanvasRenderingContext2D;
  const incident = { kind: 'hat' as const, at: 0, expiresAt: 12000, text: 'x'.repeat(200) };
  drawGuestIncident(ctx, incident, { x: 10, y: 20 }, 3000, false);
  expect(ctx.fillText).toHaveBeenCalledWith('x'.repeat(56), 0, -35, 278);
  vi.mocked(ctx.fillText).mockClear();
  drawGuestIncident(ctx, incident, { x: 10, y: 20 }, 7000, false);
  expect(ctx.fillText).not.toHaveBeenCalled();
});
