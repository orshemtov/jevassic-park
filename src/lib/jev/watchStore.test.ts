import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WatchWorld } from './watchEngine';
let saved: string | null;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('KV_REST_API_URL', 'https://test.upstash.io');
  vi.stubEnv('KV_REST_API_TOKEN', 'test-only');
  saved = null;
  fetchMock = vi.fn(async (_url, options: RequestInit) => {
    const args = JSON.parse(options.body as string);
    if (args[0] === 'GET') return Response.json({ result: saved });
    const previous = saved === null ? null : JSON.parse(saved);
    const allowed = previous ? previous.etag === args[4] : args[4] === '';
    if (allowed) saved = args[5];
    return Response.json({ result: allowed ? 1 : 0 });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('initializes once and rejects a stale writer with an atomic revision comparison', async () => {
  const { readWatchWorld, writeWatchWorld, WatchConflictError } = await import('./watchStore');
  const world = { tick: 1 } as WatchWorld;
  const first = await writeWatchWorld(world);
  expect(await readWatchWorld()).toEqual({ world, etag: first });
  const second = await writeWatchWorld({ ...world, tick: 2 }, first);
  await expect(writeWatchWorld({ ...world, tick: 3 }, first)).rejects.toBeInstanceOf(WatchConflictError);
  expect(await readWatchWorld()).toEqual({ world: { tick: 2 }, etag: second });
  await expect(writeWatchWorld(world)).rejects.toBeInstanceOf(WatchConflictError);
  const args = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(args[0]).toBe('EVAL');
  expect(args[1]).toContain("redis.call('GET', KEYS[1])");
  expect(args[1]).toContain("redis.call('SET', KEYS[1], ARGV[2])");
});

it('caches short reads without exposing mutable cached state', async () => {
  const { readWatchWorld, writeWatchWorld } = await import('./watchStore');
  await writeWatchWorld({ tick: 1 } as WatchWorld);
  const first = await readWatchWorld();
  first!.world.tick = 99;
  expect((await readWatchWorld())!.world.tick).toBe(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('rejects insecure credentials and fails closed on storage errors', async () => {
  const { readWatchWorld } = await import('./watchStore');
  vi.stubEnv('KV_REST_API_URL', 'http://test.upstash.io');
  await expect(readWatchWorld()).rejects.toThrow('not configured');
  expect(fetchMock).not.toHaveBeenCalled();
  vi.stubEnv('KV_REST_API_URL', 'https://test.upstash.io');
  fetchMock.mockResolvedValueOnce(Response.json({ error: 'quota' }, { status: 429 }));
  await expect(readWatchWorld()).rejects.toThrow('returned 429');
});
