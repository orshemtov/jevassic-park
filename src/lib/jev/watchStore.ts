import { randomUUID } from 'node:crypto';
import type { WatchWorld } from './watchEngine';

const key = 'jevassic:spectator:world:v1';
type SavedWorld = { world: WatchWorld; etag: string };
let cached: { value: SavedWorld | null; until: number; url: string } | undefined;

export class WatchConflictError extends Error {
  constructor() { super('Shared park changed'); this.name = 'WatchConflictError'; }
}

export function watchStorageConfigured(): boolean {
  return Boolean((process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) &&
    (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN));
}

async function command(args: (string | number)[]) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token || new URL(url).protocol !== 'https:') throw new Error('Shared park storage is not configured');
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args), cache: 'no-store', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Shared park storage returned ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error('Shared park storage command failed');
  return data.result;
}

export async function readWatchWorld(): Promise<SavedWorld | null> {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  if (cached && cached.url === url && cached.until > Date.now()) return structuredClone(cached.value);
  const raw = await command(['GET', key]);
  const value: SavedWorld | null = raw === null ? null : JSON.parse(raw);
  if (value && (!value.world || typeof value.etag !== 'string')) throw new Error('Invalid shared park state');
  cached = { value, until: Date.now() + 3000, url };
  return structuredClone(value);
}

// The revision check and replacement run atomically inside Redis, across all viewers/workers.
const compareAndSet = `local saved = redis.call('GET', KEYS[1])
if saved then
  if cjson.decode(saved).etag ~= ARGV[1] then return 0 end
elseif ARGV[1] ~= '' then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
return 1`;

export async function writeWatchWorld(world: WatchWorld, etag?: string): Promise<string> {
  const revision = randomUUID();
  const value = { world, etag: revision };
  const accepted = await command(['EVAL', compareAndSet, 1, key, etag ?? '', JSON.stringify(value)]);
  if (accepted !== 1) { cached = undefined; throw new WatchConflictError(); }
  cached = { value: structuredClone(value), until: Date.now() + 3000,
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '' };
  return revision;
}
