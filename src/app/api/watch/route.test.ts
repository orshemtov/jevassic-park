import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import type { GameState } from '@/games/coaster/types/game';
import { decide } from '@/lib/jev/decide';
import { createWatchWorld, type WatchWorld } from '@/lib/jev/watchEngine';
import { readWatchWorld, writeWatchWorld, WatchConflictError } from '@/lib/jev/watchStore';
import { GET } from './route';

vi.mock('@/lib/jev/watchStore', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/jev/watchStore')>(), readWatchWorld: vi.fn(), writeWatchWorld: vi.fn() }));
vi.mock('@/lib/jev/decide', () => ({ decide: vi.fn() }));
const park: GameState = JSON.parse(readFileSync('public/parks/showcase.json', 'utf8'));
const now = Date.UTC(2026, 9, 16, 12);
let stored: { world: WatchWorld; etag: string };
let revision = 1;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv('KV_REST_API_URL', 'https://test-store.upstash.io');
  vi.stubEnv('KV_REST_API_TOKEN', 'test-token');
  vi.stubEnv('WATCH_DAILY_BUDGET', '5');
  vi.stubEnv('DECISION_INTERVAL_MS', '5000');
  vi.stubEnv('SPECTATOR_POPULATION', '10');
  stored = { world: createWatchWorld(park, 10, now - 6000), etag: '1' };
  vi.mocked(readWatchWorld).mockImplementation(async () => structuredClone(stored));
  vi.mocked(writeWatchWorld).mockImplementation(async (world, etag) => {
    if (etag !== stored.etag) throw new WatchConflictError();
    const next = String(++revision);
    stored = { world: structuredClone(world), etag: next };
    return next;
  });
  vi.mocked(decide).mockImplementation(async payload => NextResponse.json({ mode: payload.decisionMode === 'jev' ? 'live' : 'offline',
    decisions: payload.actors.map(actor => ({ id: actor.id, action: 'wait' })), manager: undefined, usage: { inputTokens: 0 } }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe('shared watching endpoint', () => {
  it('admits one paid call when two viewers race for the same world', async () => {
    const responses = await Promise.all([GET(), GET()]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(vi.mocked(decide).mock.calls[0][0].decisionMode).toBe('jev');
    expect(stored.world.decisionCount).toBe(1);
    expect(stored.world.spent).toBeGreaterThan(0);
    expect(stored.world.leaseUntil).toBe(0);
  });

  it('advances movement without making decisions before their scheduled time', async () => {
    stored.world.nextDecisionAt = now + 10000;
    expect((await GET()).status).toBe(200);
    expect(decide).not.toHaveBeenCalled();
    expect(stored.world.tick).toBeGreaterThan(park.tick);
    expect(stored.world.spent).toBe(0);
  });

  it('serves the existing frame while another worker owns its lease', async () => {
    stored.world.leaseUntil = now + 20000;
    expect((await GET()).status).toBe(200);
    expect(writeWatchWorld).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
  });

  it('uses code after the shared daily allowance is exhausted', async () => {
    stored.world.spent = 5;
    expect((await GET()).status).toBe(200);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(vi.mocked(decide).mock.calls[0][0].decisionMode).toBe('code');
    expect(stored.world.spent).toBe(5);
    expect(stored.world.mode).toBe('offline');
  });

  it('announces exhaustion and resumes Jev on the next UTC day', async () => {
    stored.world.spent = 5;
    const exhausted = await (await GET()).json();
    expect(exhausted.budget).toEqual({ exhausted: true, resetsAt: '2026-10-17T00:00:00.000Z' });
    const tomorrow = Date.UTC(2026, 9, 17, 0, 0, 6);
    stored.world = { ...createWatchWorld(park, 10, tomorrow - 6000), day: stored.world.day, spent: 5, budgetExhausted: true };
    vi.setSystemTime(tomorrow);
    const renewed = await (await GET()).json();
    expect(renewed.budget.exhausted).toBe(false);
    expect(vi.mocked(decide).mock.calls.at(-1)?.[0].decisionMode).toBe('jev');
    expect(stored.world.spent).toBeLessThan(5);
  });

  it('stops paid retries for the day when Gateway rejects the budget', async () => {
    vi.mocked(decide).mockResolvedValueOnce(NextResponse.json({ error: 'Gateway budget exhausted' }, { status: 402 }));
    expect((await (await GET()).json()).budget.exhausted).toBe(true);
    stored.world = { ...createWatchWorld(park, 10, now + 4000), spent: stored.world.spent, budgetExhausted: true };
    vi.setSystemTime(now + 10000);
    await GET();
    expect(vi.mocked(decide).mock.calls.map(([payload]) => payload.decisionMode)).toEqual(['jev', 'code', 'code']);
  });

  it('does not call a provider when the next reservation would cross the cap', async () => {
    stored.world.spent = 4.999999;
    await GET();
    expect(stored.world.spent).toBe(4.999999);
    expect(stored.world.budgetExhausted).toBe(true);
    expect(vi.mocked(decide).mock.calls[0][0].decisionMode).toBe('code');
  });

  it('settles the conservative reservation to measured usage and preserves the configured tempo', async () => {
    vi.mocked(decide).mockImplementationOnce(async payload => NextResponse.json({ mode: 'live',
      decisions: payload.actors.map(actor => ({ id: actor.id, action: 'wait' })), manager: undefined,
      usage: { inputTokens: 1000 } }));
    expect((await GET()).status).toBe(200);
    expect(stored.world.spent).toBeCloseTo(1000 * .04 / 1e6, 12);
    expect(stored.world.nextDecisionAt).toBeGreaterThanOrEqual(now + 5000);
    expect(stored.world.nextDecisionAt).toBe(now + 5000);
  });

  it('does not reserve money or call Jev when no guest can decide', async () => {
    stored.world.guests = stored.world.guests.map(guest => ({ ...guest, state: 'riding', queueTimer: 1000 }));
    expect((await GET()).status).toBe(200);
    expect(decide).not.toHaveBeenCalled();
    expect(stored.world.spent).toBe(0);
    expect(stored.world.leaseUntil).toBe(0);
  });

  it('applies changed server population to an already saved world', async () => {
    vi.stubEnv('SPECTATOR_POPULATION', '20');
    expect((await GET()).status).toBe(200);
    expect(stored.world.population).toBe(20);
    expect(stored.world.guests).toHaveLength(20);
    vi.setSystemTime(now + 6000);
    vi.stubEnv('SPECTATOR_POPULATION', '10');
    expect((await GET()).status).toBe(200);
    expect(stored.world.population).toBe(10);
    expect(stored.world.guests).toHaveLength(10);
  });

  it('advances motion during an active model request without replaying earlier idle time', async () => {
    stored.world.updatedAt = now - 3600000;
    vi.mocked(decide).mockImplementationOnce(async payload => {
      vi.setSystemTime(now + 10000);
      return NextResponse.json({ mode: 'live', decisions: payload.actors.map(actor => ({ id: actor.id, action: 'wait' })),
        manager: undefined, usage: { inputTokens: 1000 } });
    });
    expect((await GET()).status).toBe(200);
    expect(stored.world.tick - park.tick).toBe(250);
    expect(stored.world.watchedMs).toBe(12500);
    expect(stored.world.updatedAt).toBe(now + 10000);
    expect(stored.world.nextDecisionAt).toBeGreaterThanOrEqual(now + 15000);
  });

  it('fails closed when shared storage is missing', async () => {
    vi.stubEnv('KV_REST_API_URL', '');
    vi.stubEnv('KV_REST_API_TOKEN', '');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    expect((await GET()).status).toBe(503);
    expect(readWatchWorld).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
  });
});
