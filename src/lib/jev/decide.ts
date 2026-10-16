import { experimental_decide } from 'ai';
import { NextResponse } from 'next/server';
import { chooseOffline, chooseOfflineAnnouncement, type ActionKind } from './decisions';
import type { ParkState } from './parkState';

export type Actor = {
  id: string;
  guest: { hunger: number; thirst: number; energy: number; bathroom: number; nausea: number;
    happiness: number; cash: number; preferExcitement: number; preferIntensity: number; activity?: string; timeInPark?: number; ridesRidden?: string[] };
  actions: { id: string; kind: ActionKind; label: string; price: number; distance: number; queue: number }[];
};
export type Manager = { actions: { id: string; label: string }[] };

export async function decide(body: { park: ParkState; actors: Actor[]; manager?: Manager; announcement?: string; decisionMode?: 'jev' | 'code' }) {
  const actors = body.actors;
  const manager = body.manager;
  if (body.decisionMode === 'code' || (body.decisionMode !== 'jev' && process.env.JEV_MODE !== 'live')) {
    return NextResponse.json({ mode: 'offline', decisions: actors.map(actor => ({
      id: actor.id, action: body.announcement
        ? chooseOfflineAnnouncement(actor.guest, actor.actions, body.announcement)
        : chooseOffline({ ...actor.guest, id: actor.id }, actor.actions),
    })), manager: manager ? (body.park.admission !== 20 && manager.actions.some(action => action.id === 'fee20')
      ? 'fee20' : 'keep') : undefined,
      usage: { inputTokens: 0 } });
  }
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN && process.env.VERCEL !== '1') {
    return NextResponse.json({ error: 'Live Jev is not configured' }, { status: 503 });
  }

  const questions: Record<string, { type: 'choice'; instructions: string; criteria: Record<string, string> }> = {};
  actors.forEach((actor, index) => {
    questions[`g${index}`] = {
      type: 'choice',
      instructions: `${body.announcement ? `The park-wide announcement is ${JSON.stringify(body.announcement)}. Decide whether to keep the current plan or react to it. ` : ''}Choose this park guest's next action. Needs, activity, and cash: ${JSON.stringify(actor.guest)}. Hunger, thirst, bathroom, and nausea run from 0 (satisfied) to 100 (urgent); energy 100 means rested. Hunger/thirst below 55 and bathroom below 65 are not urgent. Favor satisfying urgent needs, affordability, and variety. Comfortable guests can enjoy attractions. An announcement is an optional opportunity, not an order. Use a restroom when needed and rest to recover energy. Avoid repeating visited rides. Consider leaving only after a reasonable visit or when unable to afford useful activities.`,
      criteria: Object.fromEntries(actor.actions.map(action => [action.id,
        `${action.label}; ${action.kind}; cost $${action.price}; ${action.distance} path tiles away; queue ${action.queue}`])),
    };
  });
  if (manager) questions.manager = { type: 'choice', instructions: 'Choose one useful, affordable park management action.',
    criteria: Object.fromEntries(manager.actions.map(action => [action.id, action.label])) };

  try {
    const result = await experimental_decide({
      model: 'typesafe-ai/jev-1.14.0',
      state: { ...body.park, ...(body.announcement ? { announcement: body.announcement } : {}) },
      questions,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(12000),
    });
    const decisions = actors.map((actor, index) => {
      const answer = result.answers[`g${index}`];
      const action = answer?.type === 'choice' ? answer.choice : undefined;
      if (!action || !actor.actions.some(option => option.id === action)) throw new Error('Invalid Jev answer');
      return { id: actor.id, action, probability: answer.probabilities?.[action] };
    });
    const managerAnswer = result.answers.manager;
    const managerChoice = managerAnswer?.type === 'choice' ? managerAnswer.choice : undefined;
    if (manager && (!managerChoice || !manager.actions.some(action => action.id === managerChoice))) throw new Error('Invalid manager answer');
    return NextResponse.json({ mode: 'live', decisions, manager: managerChoice,
      usage: { inputTokens: result.usage?.inputTokens ?? null } });
  } catch (error) {
    const status = typeof error === 'object' && error !== null && 'statusCode' in error ? Number(error.statusCode) : 503;
    console.error('Jev decision failed', { name: error instanceof Error ? error.name : 'UnknownError', status });
    if (status === 402) return NextResponse.json({ error: 'Gateway budget exhausted' }, { status });
    if (status === 429) return NextResponse.json({ error: 'Too many Jev requests' }, { status });
    return NextResponse.json({ error: 'Jev is temporarily unavailable' }, { status: 503 });
  }
}
