import { readFileSync } from 'node:fs';
import { NextResponse } from 'next/server';
import type { GameState } from '@/games/coaster/types/game';
import { decide } from '@/lib/jev/decide';
import { watchConfig } from '@/lib/jev/config';
import { advanceWatchWorld, applyWatchDecisions, buildWatchBatch, createWatchWorld, watchEnvironment, type WatchWorld } from '@/lib/jev/watchEngine';
import { readWatchWorld, writeWatchWorld, WatchConflictError, watchStorageConfigured } from '@/lib/jev/watchStore';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

let park: GameState;
const getPark = () => park ??= JSON.parse(readFileSync(`${process.cwd()}/public/parks/showcase.json`, 'utf8'));

function response(world: WatchWorld) {
  return NextResponse.json({ guests: world.guests, tick: world.tick, population: world.population, ...watchEnvironment(world, getPark()),
    ...(world.spectacle ? { spectacle: world.spectacle } : {}),
    incidents: world.incidents ?? [], rhythm: world.rhythm,
    mode: world.mode, decisionCount: world.decisionCount,
    budget: { exhausted: Boolean(world.budgetExhausted), resetsAt: new Date(Date.parse(`${world.day}T00:00:00Z`) + 86_400_000).toISOString() },
    feed: world.feed.map(entry => ({ ...entry, time: new Date(entry.time).toLocaleTimeString('en-GB') })),
    ...(world.announcement ? { announcement: { id: world.announcement.id, text: world.announcement.text, at: world.announcement.at,
      total: world.announcement.total, processed: world.announcement.processed, changed: world.announcement.changed, stayed: world.announcement.stayed, responded: world.announcement.responded ?? 0, responders: world.announcement.responders ?? [],
      status: world.announcement.pending.length ? 'deciding' : 'done' } } : {}),
  }, { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=1', 'X-Content-Type-Options': 'nosniff' } });
}

export async function GET() {
  if (!watchStorageConfigured()) {
    return NextResponse.json({ error: 'Shared park storage is not configured' }, { status: 503 });
  }
  let stage = 'read';
  try {
    const config = watchConfig();
    const now = Date.now();
    let saved = await readWatchWorld();
    if (!saved) {
      const initial = createWatchWorld(getPark(), config.population, now, config.detailedGuests);
      try { saved = { world: initial, etag: await writeWatchWorld(initial) }; }
      catch { saved = await readWatchWorld(); if (!saved) throw new Error('Park initialization failed'); }
    }
    if (saved.world.leaseUntil > now || now - saved.world.updatedAt < 5000) return response(saved.world);
    let world = advanceWatchWorld({ ...saved.world, population: config.population, detailedGuests: config.detailedGuests }, getPark(), now);
    const batch = now >= world.nextDecisionAt ? buildWatchBatch(world, getPark(), now) : null;
    const payload = batch?.actors.length ? { ...batch, actors: batch.actors.map(actor => ({ ...actor,
      actions: actor.actions.map(({ id, kind, label, price, distance, queue }) => ({ id, kind, label, price, distance, queue })),
    })), decisionMode: 'jev' as 'jev' | 'code' } : null;
    // Reserve before calling Jev; a failed worker cannot refund an uncertain provider charge.
    const reserve = payload ? (Buffer.byteLength(JSON.stringify(payload)) * 2 + 2048) * .04 / 1e6 : 0;
    if (payload && config.dailyBudget > 0 && world.spent + reserve > config.dailyBudget) world.budgetExhausted = true;
    const useJev = Boolean(payload && config.dailyBudget > 0 && !world.budgetExhausted);
    world = { ...world, leaseUntil: now + 30_000, spent: world.spent + (useJev ? reserve : 0) };
    stage = 'reserve';
    let lease: string;
    try { lease = await writeWatchWorld(world, saved.etag); }
    catch (error) {
      if (error instanceof WatchConflictError) return response(saved.world);
      throw error;
    }
    let charged = reserve;
    if (payload && batch?.actors.length) {
      payload.decisionMode = useJev ? 'jev' : 'code';
      try {
        stage = 'decide';
        const result = await decide(payload);
        if (result.ok) {
          const choices = await result.json();
          if (useJev && Number.isFinite(choices.usage?.inputTokens) && choices.usage.inputTokens > 0) {
            charged = choices.usage.inputTokens * .04 / 1e6;
            world.spent += charged - reserve;
          }
          world = applyWatchDecisions(world, batch.actors, choices.decisions, choices.mode, now);
        } else {
          if (useJev && result.status === 402) world.budgetExhausted = true;
          // Keep the show moving when the provider or its project budget is unavailable.
          const fallback = await decide({ ...payload, decisionMode: 'code' });
          const choices = await fallback.json();
          world = applyWatchDecisions(world, batch.actors, choices.decisions, 'offline', now);
        }
      } catch {
        const fallback = await decide({ ...payload, decisionMode: 'code' });
        const choices = await fallback.json();
        world = applyWatchDecisions(world, batch.actors, choices.decisions, 'offline', now);
      }
      // Pace the allowance over a full day of watching, with no missed-call backlog.
      world.nextDecisionAt = Date.now() + Math.max(config.decisionIntervalMs,
        useJev ? Math.ceil(charged * 86_400_000 / config.dailyBudget) : 0);
    }
    // Complete motion during this bounded provider request, without replaying unattended time.
    world = advanceWatchWorld(world, getPark(), Date.now(), 15_000);
    world.leaseUntil = 0;
    stage = 'save';
    await writeWatchWorld(world, lease);
    return response(world);
  } catch (error) {
    console.error('Shared park unavailable', { stage, name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message.slice(0, 160) : 'Unknown failure' });
    return NextResponse.json({ error: 'Park reconnecting' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
