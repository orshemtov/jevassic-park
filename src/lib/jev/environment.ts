import type { WeatherType } from '@/games/coaster/types/economy';
import type { GameState } from '@/games/coaster/types/game';

export function watchEnvironment(world: { watchedMs: number; updatedAt: number; tick: number }, park: Pick<GameState, 'weather'>): Pick<GameState, 'hour' | 'minute' | 'weather'> {
  // Ten-minute visual days favor seven minutes of daylight, with a short night.
  const second = (Math.floor(world.updatedAt / 1000) + 120) % 600;
  const hour = second < 420 ? 7 + second * 11 / 420 : second < 480 ? 18 + (second - 420) / 20 :
    second < 540 ? 21 + (second - 480) * 8 / 60 : 5 + (second - 540) / 30;
  const minutes = hour % 24 * 60;
  const conditions: WeatherType[] = ['sunny', 'sunny', 'partly_cloudy', 'cloudy', 'rain', 'partly_cloudy'];
  const phase = Math.floor(world.watchedMs / 90000) % conditions.length;
  const temperatures = [27, 27, 25, 23, 20, 25];
  return { hour: Math.floor(minutes / 60), minute: minutes % 60, weather: { ...park.weather,
    current: conditions[phase], temperature: temperatures[phase], nextChange: world.tick + Math.ceil((90000 - world.watchedMs % 90000) / 50),
    forecast: [1, 2, 3].map(offset => conditions[(phase + offset) % conditions.length]) } };
}
