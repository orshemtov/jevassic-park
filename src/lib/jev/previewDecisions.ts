import type { GameState } from '@/games/coaster/types/game';
import { companionAction, personalityAction } from './guestPersonality';
import { chooseOffline, chooseOfflineAnnouncement, getGuestActions, isDecisionBoundary } from './decisions';

export function previewDecisions(park: GameState) {
  return park.guests.filter(isDecisionBoundary).slice(0, 8).flatMap(guest => {
    const actions = getGuestActions(park.grid, guest, (park.freeHotdogsUntilTick ?? 0) > park.tick, '', park.guests);
    const choice = companionAction(guest, park.guests, actions) ?? personalityAction(guest, actions) ?? chooseOffline(guest, actions);
    const action = actions.find(action => action.id === choice);
    return action ? [{ guest, action, label: action.kind === 'leave' ? 'Headed for the exit' :
      action.kind === 'wait' ? 'Took a break' : `Chose ${action.label}` }] : [];
  });
}

export function previewAnnouncementDecisions(park: GameState, text: string, remainingMs = Infinity) {
  return park.guests.map(guest => {
    const keep = { id: 'continue', kind: 'continue' as const, label: 'Keep current plan', price: 0, distance: 0, queue: 0, path: [] };
    const actions = ['walking', 'entering', 'queuing', 'leaving'].includes(guest.state)
      ? [keep, ...getGuestActions(park.grid, guest, /free hot dogs/i.test(text), text, park.guests).filter(action => action.distance * 2500 + 20_000 <= remainingMs)] : [keep];
    const action = actions.find(option => option.id === chooseOfflineAnnouncement(guest, actions, text)) ?? keep;
    return { guest, action, label: action.kind === 'continue' ? 'Kept their plan' : `Chose ${action.label}` };
  });
}
