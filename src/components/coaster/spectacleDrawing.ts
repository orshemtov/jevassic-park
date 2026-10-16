import type { ParkSpectacle } from '@/lib/jev/spectacles';
import type { Guest } from '@/games/coaster/types';

const colors = ['#ffe575', '#f591bf', '#8ae6ee', '#c8fa86'];
const project = (x: number, y: number) => ({ x: (x - y) * 32 + 32, y: (x + y) * 19.2 + 19.2 });

export function routePoint(route: { x: number; y: number }[], progress: number) {
  if (!route.length) return null;
  const position = Math.max(0, Math.min(1, progress)) * (route.length - 1);
  const index = Math.floor(position), next = route[Math.min(index + 1, route.length - 1)];
  return { x: route[index].x + (next.x - route[index].x) * (position - index),
    y: route[index].y + (next.y - route[index].y) * (position - index) };
}

export function drawParadeTile(ctx: CanvasRenderingContext2D, show: ParkSpectacle, now: number, tileX: number, tileY: number, reducedMotion: boolean) {
  if (show.kind !== 'parade' || now < show.startedAt || now > show.startedAt + show.durationMs) return;
  const progress = reducedMotion ? .5 : (now - show.startedAt) / show.durationMs;
  for (let float = 0; float < 3; float++) {
    if (progress - float * .07 < 0) continue;
    const point = routePoint(show.route, progress - float * .07);
    if (!point || Math.floor(point.x) !== tileX || Math.floor(point.y) !== tileY) continue;
    const p = project(point.x, point.y);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = '#1a332e';
    ctx.beginPath(); ctx.ellipse(0, 2, 29, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = colors[float];
    ctx.beginPath(); ctx.roundRect(-27, -14, 54, 18, 5); ctx.fill();
    ctx.fillStyle = '#fff3cc';
    ctx.beginPath(); ctx.moveTo(-20, -14); ctx.lineTo(0, -45); ctx.lineTo(20, -14); ctx.closePath(); ctx.fill();
    ctx.fillStyle = colors[(float + 1) % colors.length];
    ctx.beginPath(); ctx.arc(0, -30, 10, 0, Math.PI * 2); ctx.fill();
    ctx.font = '17px system-ui'; ctx.textAlign = 'center'; ctx.fillText(['★', '♫', '♥'][float], 0, -24);
    for (let n = 0; n < 6; n++) {
      ctx.fillStyle = colors[n % colors.length];
      const phase = reducedMotion ? .5 : ((now / 1000 + n * .31) % 2) / 2;
      ctx.fillRect(Math.sin(n * 4 + phase * 2) * 36, -50 + phase * 50, 2, 3);
    }
    ctx.restore();
  }
}

export function drawSpectacleSky(ctx: CanvasRenderingContext2D, show: ParkSpectacle, now: number, reducedMotion: boolean) {
  const elapsed = (now - show.startedAt) / 1000;
  if (elapsed < 0 || elapsed * 1000 > show.durationMs || show.kind === 'parade') return;
  const p = project(show.center.x, show.center.y);
  ctx.save(); ctx.translate(p.x, p.y);
  if (show.kind === 'fireworks') {
    for (let burst = 0; burst < 3; burst++) {
      const phase = reducedMotion ? .55 : (elapsed * .35 + burst * .33) % 1;
      const radius = 12 + phase * 105;
      const cx = (burst - 1) * 100, cy = -180 - (burst % 2) * 75;
      ctx.globalAlpha = (1 - phase) * .9;
      ctx.strokeStyle = colors[(Math.floor(elapsed / 3) + burst) % colors.length];
      ctx.lineWidth = 2;
      for (let ray = 0; ray < 24; ray++) {
        const angle = ray * Math.PI / 12;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(angle) * radius * .78, cy + Math.sin(angle) * radius * .78 + phase * phase * 35);
        ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius + phase * phase * 35); ctx.stroke();
      }
    }
  } else {
    for (let jet = 0; jet < 9; jet++) {
      const wave = reducedMotion ? .7 : .65 + Math.sin(elapsed * 2.3 + jet * .6) * .3;
      ctx.strokeStyle = colors[Math.floor(elapsed / 3 + jet) % colors.length];
      ctx.globalAlpha = .75; ctx.lineWidth = 2.5;
      const x = (jet - 4) * 9;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.quadraticCurveTo(x * 1.3, -95 * wave, x * 1.6, 3); ctx.stroke();
      ctx.fillStyle = '#e1fbff'; ctx.beginPath(); ctx.ellipse(x * 1.6, 3, 5, 2, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

export function drawGuestCelebration(ctx: CanvasRenderingContext2D, guest: Guest, point: {x:number;y:number}, show: ParkSpectacle | undefined, now: number, reducedMotion: boolean) {
  if (guest.state === 'riding' || guest.state === 'leaving') return;
  const seed = guest.id.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0);
  const nearby = show && now >= show.startedAt && now < show.startedAt + show.durationMs &&
    Math.hypot(guest.tileX - show.center.x, guest.tileY - show.center.y) < 9;
  const watching = nearby && guest.state === 'watching';
  const excited = guest.state === 'exiting_ride' && guest.happiness > 65;
  const balloon = guest.happiness > 60 && seed % 17 === 0;
  if (!watching && !excited && !balloon) return;
  ctx.save(); ctx.translate(point.x, point.y);
  const wave = reducedMotion ? 0 : Math.sin(now / 170 + seed) * 2;
  if (balloon) {
    ctx.strokeStyle = '#fff4ce'; ctx.lineWidth = .65; ctx.beginPath(); ctx.moveTo(3, -5); ctx.lineTo(5 + wave, -21); ctx.stroke();
    ctx.fillStyle = colors[seed % colors.length]; ctx.beginPath(); ctx.ellipse(5 + wave, -25, 4, 5, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (watching || excited) {
    ctx.strokeStyle = '#ffe3bc'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-2, -6); ctx.lineTo(-6, -11 + wave); ctx.moveTo(2, -6); ctx.lineTo(6, -11 - wave); ctx.stroke();
    if (seed % 4 === 0) { ctx.font = 'bold 8px system-ui'; ctx.fillStyle = '#fff1b7'; ctx.textAlign = 'center'; ctx.fillText(watching ? (show?.kind === 'fountain' ? '💦' : '♪') : '!', 0, -17); }
  }
  ctx.restore();
}
