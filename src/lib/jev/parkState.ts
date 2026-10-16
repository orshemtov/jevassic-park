import { DEFAULT_PRICES } from '@/games/coaster/types/economy';
import type { GameState } from '@/games/coaster/types/game';
import { attractionName } from './decisions';

export type ParkState = {
  weather: string;
  hour: number;
  admission: number;
  activeGuests: number;
  freeHotdogs: boolean;
  attractions: { id: string; label: string; kind: 'ride' | 'food' | 'drink' | 'shop' | 'restroom';
    price: number; queue: number }[];
};

export function summarizePark(state: GameState, freeHotdogs = (state.freeHotdogsUntilTick ?? 0) > state.tick): ParkState {
  const queues = new Map<string, number>();
  for (const guest of state.guests) if (guest.state === 'queuing' && guest.queueRideId) {
    queues.set(guest.queueRideId, (queues.get(guest.queueRideId) ?? 0) + 1);
  }
  const attractions: ParkState['attractions'] = [];
  for (const row of state.grid) for (const tile of row) {
    const type = tile.building?.type ?? '';
    if (type.endsWith('_footprint')) continue;
    const kind = type.startsWith('ride_') || type.startsWith('show_') || type.startsWith('station_') ? 'ride' :
      type.startsWith('food_') || type.startsWith('snack_') || type.startsWith('cart_') ? 'food' :
      type.startsWith('drink_') ? 'drink' : type === 'restroom' ? 'restroom' :
      type.startsWith('shop_') || type.startsWith('game_') || type === 'arcade_building' ? 'shop' : null;
    if (!kind) continue;
    const id = `${kind}:${tile.x},${tile.y}`;
    attractions.push({ id, label: attractionName(type), kind,
      price: freeHotdogs && type === 'food_hotdog' ? 0 : kind === 'food' ? DEFAULT_PRICES.foodItem :
        kind === 'drink' ? DEFAULT_PRICES.drinkItem : kind === 'shop' ? DEFAULT_PRICES.shopItem : 0,
      queue: queues.get(`${tile.x},${tile.y}`) ?? 0 });
  }
  return { weather: state.weather.current, hour: state.hour, admission: state.settings.entranceFee,
    activeGuests: state.guests.length, freeHotdogs, attractions: attractions.slice(0, 64) };
}
