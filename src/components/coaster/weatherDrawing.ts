import type { WeatherType } from '@/games/coaster/types/economy';

// Screen-space rain covers the whole viewport at every pan, zoom and pixel density.
export function rainDrops(width: number, height: number, time: number, storm: boolean, mobile = false) {
  const count = Math.min(mobile ? 90 : 240, Math.max(40, Math.ceil(width * height / (storm ? 6500 : 10000))));
  const columns = Math.ceil(Math.sqrt(count * width / Math.max(1, height)));
  const rows = Math.ceil(count / columns);
  return Array.from({ length: count }, (_, index) => {
    const depth = .5 + (index % 3) * .25;
    const x = ((index % columns + .5) / columns * width + time * (storm ? 105 : 45) * depth) % (width + 30) - 15;
    const y = ((Math.floor(index / columns) + .5) / rows * height + time * (storm ? 650 : 420) * depth) % (height + 30) - 15;
    return { x, y, depth };
  });
}

export function drawParkWeather(ctx: CanvasRenderingContext2D, weather: WeatherType, width: number, height: number, time: number, dpr: number, reducedMotion: boolean, mobile = false) {
  if (width <= 0 || height <= 0) return;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const atmosphere: Partial<Record<WeatherType, string>> = {
    rain: '#536e8c20', storm: '#273c5c3b', cloudy: '#82929d12', cold: '#9dddf51a', hot: '#ffd4730c',
  };
  if (atmosphere[weather]) {
    ctx.fillStyle = atmosphere[weather]!;
    ctx.fillRect(0, 0, width, height);
  }
  if ((weather === 'rain' || weather === 'storm') && !reducedMotion) {
    const storm = weather === 'storm';
    const drops = rainDrops(width, height, time, storm, mobile);
    ctx.strokeStyle = storm ? '#d7eaff8c' : '#d7edff75';
    ctx.lineWidth = storm ? 1.2 : .9;
    ctx.beginPath();
    for (const drop of drops) {
      const length = (storm ? 20 : 13) * drop.depth;
      ctx.moveTo(drop.x, drop.y);
      ctx.lineTo(drop.x - length * .3, drop.y + length);
    }
    ctx.stroke();
    ctx.strokeStyle = '#d8efff47';
    ctx.lineWidth = .7;
    ctx.beginPath();
    for (let index = 0; index < Math.min(18, drops.length); index++) {
      const drop = drops[index * 2];
      const phase = (time * 1.6 + index * .37) % 1;
      ctx.moveTo(drop.x + phase * 5, drop.y);
      ctx.ellipse(drop.x, drop.y, Math.max(.1, phase * 5), Math.max(.1, phase * 1.6), 0, 0, Math.PI * 2);
    }
    ctx.stroke();
  }
  ctx.restore();
}
