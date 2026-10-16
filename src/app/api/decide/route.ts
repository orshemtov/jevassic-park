import { NextRequest, NextResponse } from 'next/server';
import { decide, type Actor, type Manager } from '@/lib/jev/decide';
import { isAdminMode } from '@/lib/jev/config';
import type { ParkState } from '@/lib/jev/parkState';

export const runtime = 'nodejs';

function validNumber(value: unknown, max = 100): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
}

function validActor(actor: unknown): actor is Actor {
  if (!actor || typeof actor !== 'object') return false;
  const a = actor as Actor;
  if (typeof a.id !== 'string' || !/^[a-zA-Z0-9-]{1,50}$/.test(a.id) || !a.guest ||
      !Array.isArray(a.actions) || a.actions.length < 1 || a.actions.length > 10) return false;
  const g = a.guest;
  if (!validNumber(g.hunger) || !validNumber(g.thirst) || !validNumber(g.energy) ||
      !validNumber(g.bathroom) || !validNumber(g.nausea) || !validNumber(g.happiness) ||
      !validNumber(g.cash, 10000) || !validNumber(g.preferExcitement, 10) || !validNumber(g.preferIntensity, 10)) return false;
  if (g.activity !== undefined && (typeof g.activity !== 'string' || g.activity.length > 80)) return false;
  if (g.timeInPark !== undefined && !validNumber(g.timeInPark, 10000000)) return false;
  if (g.ridesRidden !== undefined && (!Array.isArray(g.ridesRidden) || g.ridesRidden.length > 32 ||
      !g.ridesRidden.every(id => typeof id === 'string' && /^\d{1,3},\d{1,3}$/.test(id)))) return false;
  const seen = new Set<string>();
  return a.actions.every(action => {
    if (!action || typeof action.id !== 'string' || !/^(ride|food|drink|shop|restroom):\d{1,3},\d{1,3}$|^(wait|leave|continue)$/.test(action.id) ||
        seen.has(action.id) || !['ride', 'food', 'drink', 'shop', 'restroom', 'wait', 'leave', 'continue'].includes(action.kind) ||
        action.id.split(':')[0] !== action.kind ||
        typeof action.label !== 'string' || !/^[a-zA-Z0-9 _-]{1,80}$/.test(action.label) ||
        !validNumber(action.price, 1000) || !validNumber(action.distance, 500) || !validNumber(action.queue, 1000)) return false;
    seen.add(action.id);
    return true;
  });
}

export async function POST(request: NextRequest) {
  if (!isAdminMode()) return NextResponse.json({ error: 'Spectator mode' }, { status: 403 });
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 48 * 1024) return NextResponse.json({ error: 'Decision batch too large' }, { status: 413 });
  let body: { park?: ParkState; actors?: unknown;
    manager?: Manager; announcement?: string; decisionMode?: 'jev' | 'code' };
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > 48 * 1024) return NextResponse.json({ error: 'Decision batch too large' }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const actors = body?.actors;
  if ((body?.decisionMode !== undefined && !['jev', 'code'].includes(body.decisionMode)) ||
      !Array.isArray(actors) || actors.length > 32 || (actors.length === 0 && !body.manager) ||
      !actors.every(validActor) || new Set(actors.map(actor => actor.id)).size !== actors.length ||
      !body.park || typeof body.park.weather !== 'string' || !/^[a-z_]{1,24}$/.test(body.park.weather) ||
      !validNumber(body.park.hour, 24) || !validNumber(body.park.admission, 1000) ||
      !Number.isInteger(body.park.activeGuests) || !validNumber(body.park.activeGuests, 10000) ||
      typeof body.park.freeHotdogs !== 'boolean' || !Array.isArray(body.park.attractions) ||
      body.park.attractions.length > 64 || !body.park.attractions.every(item => item &&
        typeof item.id === 'string' && /^(ride|food|drink|shop|restroom):\d{1,3},\d{1,3}$/.test(item.id) &&
        typeof item.label === 'string' && /^[a-zA-Z0-9 _-]{1,80}$/.test(item.label) &&
        ['ride', 'food', 'drink', 'shop', 'restroom'].includes(item.kind) && item.id.split(':')[0] === item.kind &&
        validNumber(item.price, 1000) && validNumber(item.queue, 1000)) ||
      new Set(body.park.attractions.map(item => item.id)).size !== body.park.attractions.length ||
      (body.announcement !== undefined && (typeof body.announcement !== 'string' ||
        body.announcement.trim().length < 1 || body.announcement.length > 160 || /[\x00-\x1f]/.test(body.announcement))) ||
      (body.announcement && !actors.every(actor => actor.actions.some((action: Actor['actions'][number]) => action.id === 'continue'))) ||
      (body.manager && (!Array.isArray(body.manager.actions) || body.manager.actions.length < 1 || body.manager.actions.length > 5 ||
        !body.manager.actions.every(action => typeof action.id === 'string' && /^(keep|fee20|fee35|fee50)$/.test(action.id) &&
          typeof action.label === 'string' && /^[a-zA-Z0-9 $-]{1,80}$/.test(action.label))))) {
    return NextResponse.json({ error: 'Invalid decision batch' }, { status: 400 });
  }

  return decide({ ...body, park: body.park, actors });
}
