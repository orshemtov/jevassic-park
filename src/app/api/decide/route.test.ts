import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { experimental_decide } from 'ai';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('ai', () => ({ experimental_decide: vi.fn() }));
beforeEach(() => vi.stubEnv('ADMIN_MODE', '1'));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetAllMocks(); });

function request(body: unknown) {
  return new NextRequest('http://localhost/api/decide', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

const park = { weather: 'sunny', hour: 12, admission: 35, activeGuests: 1,
  freeHotdogs: false, attractions: [{ id: 'drink:2,1', label: 'drink soda', kind: 'drink', price: 2, queue: 0 }] };
const actor = { id: 'guest-1', guest: { hunger: 20, thirst: 90, energy: 80, bathroom: 20, nausea: 0,
    happiness: 75, cash: 30, preferExcitement: 5, preferIntensity: 5 },
  actions: [
    { id: 'drink:2,1', kind: 'drink', label: 'drink soda', price: 5, distance: 2, queue: 0 },
    { id: 'wait', kind: 'wait', label: 'Rest here', price: 0, distance: 0, queue: 0 },
  ] };

describe('/api/decide', () => {
  it('blocks public paid writes even if a visitor requests live mode', async () => {
    vi.stubEnv('ADMIN_MODE', '0');
    const response = await POST(request({ decisionMode: 'jev', park, actors: [actor] }));
    expect(response.status).toBe(403);
    expect(experimental_decide).not.toHaveBeenCalled();
  });
  it('allows Vercel runtime identity without a copied API key', async () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    vi.stubEnv('VERCEL_OIDC_TOKEN', '');
    vi.mocked(experimental_decide).mockResolvedValue({ answers: {
      g0: { type: 'choice', choice: 'drink:2,1' },
    } } as never);
    const response = await POST(request({ decisionMode: 'jev', park, actors: [actor] }));
    expect(response.status).toBe(200);
    expect((await response.json()).mode).toBe('live');
  });
  it('keeps deterministic runs free even when a live key is configured', async () => {
    vi.stubEnv('JEV_MODE', 'live');
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test-only');
    const response = await POST(request({ decisionMode: 'code', park, actors: [actor] }));
    expect(response.status).toBe(200);
    expect(experimental_decide).not.toHaveBeenCalled();
  });
  it('returns a legal offline choice without a Gateway key', async () => {
    vi.stubEnv('JEV_MODE', 'offline');
    const response = await POST(request({ park, actors: [actor], manager: { actions: [
      { id: 'keep', label: 'Keep park settings' }, { id: 'fee20', label: 'Set admission to $20' },
    ] } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mode: 'offline',
      decisions: [{ id: 'guest-1', action: 'drink:2,1' }], manager: 'fee20' });
  });

  it('rejects oversized actor batches and invalid choices', async () => {
    expect((await POST(request({ park, actors: Array.from({ length: 33 }, () => actor) }))).status).toBe(400);
    expect((await POST(request({ park, actors: [{ ...actor, actions: [{ ...actor.actions[0], id: 'admin:0,0' }] }] }))).status).toBe(400);
  });

  it('keeps the fixed park after the initial price change', async () => {
    vi.stubEnv('JEV_MODE', 'offline');
    const response = await POST(request({ park: { ...park, admission: 20 }, actors: [],
      manager: { actions: [{ id: 'keep', label: 'Keep park settings' }, { id: 'fee35', label: 'Set admission to $35' }] } }));
    expect((await response.json()).manager).toBe('keep');
  });

  it('broadcasts one shared announcement with continue as a legal option', async () => {
    vi.stubEnv('JEV_MODE', 'offline');
    const response = await POST(request({ park, announcement: 'The hotdog stand is giving away free hot dogs!',
      actors: [{ ...actor, guest: { ...actor.guest, hunger: 90 }, actions: [
        { id: 'continue', kind: 'continue', label: 'Keep walking', price: 0, distance: 0, queue: 0 },
        { id: 'food:3,1', kind: 'food', label: 'food hotdog', price: 0, distance: 3, queue: 0 },
      ] }] }));
    expect((await response.json()).decisions).toEqual([{ id: 'guest-1', action: 'food:3,1' }]);
    expect((await POST(request({ park, announcement: 'Surprise!', actors: [actor] }))).status).toBe(400);
  });

  it('gives every announced guest the same park state and their own choice', async () => {
    vi.stubEnv('JEV_MODE', 'live');
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test-only');
    vi.mocked(experimental_decide).mockResolvedValue({ answers: {
      g0: { type: 'choice', choice: 'continue' },
      g1: { type: 'choice', choice: 'food:3,1' },
    } } as never);
    const actions = [
      { id: 'continue', kind: 'continue', label: 'Keep walking', price: 0, distance: 0, queue: 0 },
      { id: 'food:3,1', kind: 'food', label: 'food hotdog', price: 0, distance: 3, queue: 0 },
    ];
    const actors = [
      { ...actor, guest: { ...actor.guest, hunger: 10 }, actions },
      { ...actor, id: 'guest-2', guest: { ...actor.guest, hunger: 90 }, actions },
    ];
    const announcement = 'Free hotdogs!';
    const response = await POST(request({ park, announcement, actors }));

    expect(response.status).toBe(200);
    expect((await response.json()).decisions).toEqual([
      { id: 'guest-1', action: 'continue' }, { id: 'guest-2', action: 'food:3,1' },
    ]);
    expect(experimental_decide).toHaveBeenCalledTimes(1);
    expect(experimental_decide).toHaveBeenCalledWith(expect.objectContaining({
      state: { ...park, announcement },
      questions: expect.objectContaining({ g0: expect.objectContaining({ instructions: expect.stringContaining('"hunger":10') }),
        g1: expect.objectContaining({ instructions: expect.stringContaining('"hunger":90') }) }),
    }));
  });

  it('sends one choice question per actor and accepts only a legal live answer', async () => {
    vi.stubEnv('JEV_MODE', 'live');
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test-only');
    vi.mocked(experimental_decide).mockResolvedValue({ answers: {
      g0: { type: 'choice', choice: 'drink:2,1', probabilities: { 'drink:2,1': .8 } },
    }, usage: { inputTokens: 123 } } as never);
    const response = await POST(request({ park, actors: [actor] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mode: 'live',
      decisions: [{ id: 'guest-1', action: 'drink:2,1', probability: .8 }],
      usage: { inputTokens: 123 } });
    expect(experimental_decide).toHaveBeenCalledWith(expect.objectContaining({
      model: 'typesafe-ai/jev-1.14.0', maxRetries: 0,
      state: expect.objectContaining({ attractions: park.attractions, activeGuests: 1 }),
      questions: { g0: expect.objectContaining({ type: 'choice', criteria: expect.objectContaining({
        'drink:2,1': expect.any(String), wait: expect.any(String),
      }) }) },
    }));
    const sentState = vi.mocked(experimental_decide).mock.calls[0][0].state;
    expect(JSON.parse(JSON.stringify(sentState))).toEqual(sentState);

    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(experimental_decide).mockResolvedValue({ answers: {
      g0: { type: 'choice', choice: 'ride:999,999' },
    } } as never);
    expect((await POST(request({ park, actors: [actor] }))).status).toBe(503);
  });

  it('returns a budget error without exposing provider details', async () => {
    vi.stubEnv('JEV_MODE', 'live');
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test-only');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(experimental_decide).mockRejectedValue(Object.assign(new Error('private provider text'), { statusCode: 402 }));
    const response = await POST(request({ park, actors: [actor] }));
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ error: 'Gateway budget exhausted' });
  });
});

it('accepts a reachable restroom option and rejects unbounded visit history', async () => {
  const restroom = { id: 'restroom:2,1', label: 'Restroom', kind: 'restroom', price: 0, distance: 2, queue: 0 };
  const visiting = { ...actor, guest: { ...actor.guest, bathroom: 95, timeInPark: 3000, ridesRidden: ['1,1'] },
    actions: [restroom, actor.actions[1]] };
  const state = { ...park, attractions: [restroom] };
  const response = await POST(request({ decisionMode: 'code', park: state, actors: [visiting] }));
  expect(response.status).toBe(200);
  expect((await response.json()).decisions[0].action).toBe('restroom:2,1');
  expect((await POST(request({ decisionMode: 'code', park: state,
    actors: [{ ...visiting, guest: { ...visiting.guest, ridesRidden: Array(33).fill('1,1') } }] }))).status).toBe(400);
});

it('honors only legal Code personality choices without calling Jev', async () => {
  const response = await POST(request({ decisionMode: 'code', park,
    actors: [{ ...actor, codeChoice: 'wait', guest: { ...actor.guest, personality: 'Cautious', friends: ['Ada Park'], destination: '2,1', groupId: 'friends:ada' } }] }));
  expect(response.status).toBe(200);
  expect((await response.json()).decisions[0].action).toBe('wait');
  expect(experimental_decide).not.toHaveBeenCalled();
  expect((await POST(request({ decisionMode: 'code', park, actors: [{ ...actor, codeChoice: 'ride:999,999' }] }))).status).toBe(400);
  expect((await POST(request({ decisionMode: 'code', park, actors: [{ ...actor, guest: { ...actor.guest, friends: Array(4).fill('Ada') } }] }))).status).toBe(400);
});
