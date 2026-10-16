import type { Guest } from '@/games/coaster/types';

export function detailedGuest(zoom: number, mobile: boolean, emphasized: boolean): boolean {
  return emphasized || zoom >= (mobile ? .85 : .6);
}

export function drawDistantGuest(ctx: CanvasRenderingContext2D, guest: Guest, point: {x:number;y:number}) {
  if (guest.state === 'riding') return;
  ctx.fillStyle = guest.pantsColor;
  ctx.fillRect(point.x - 1.5, point.y - 3, 3, 3);
  ctx.fillStyle = guest.shirtColor;
  ctx.fillRect(point.x - 2, point.y - 7, 4, 4);
  ctx.fillStyle = guest.skinColor;
  ctx.fillRect(point.x - 1.5, point.y - 10, 3, 3);
}

export function drawRadioResponse(ctx: CanvasRenderingContext2D, point: {x:number;y:number}, now: number, reducedMotion: boolean) {
  const pulse = reducedMotion ? .7 : .65 + Math.sin(now / 350) * .2;
  ctx.save(); ctx.translate(point.x, point.y);
  ctx.strokeStyle = `rgba(255,221,104,${pulse})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(0, 0, 8, 3, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#ffe78c'; ctx.font = '10px system-ui'; ctx.textAlign = 'center'; ctx.fillText('♫', 0, -22);
  ctx.restore();
}

type Incident = { kind: 'hat'|'balloon'|'mascot'|'photo'|'wobble'|'soaked'; at:number; expiresAt:number; text?:string };
export function drawGuestIncident(ctx: CanvasRenderingContext2D, incident: Incident, point: {x:number;y:number}, now: number, reducedMotion: boolean) {
  if (now < incident.at || now >= incident.expiresAt) return;
  const age = Math.max(0, (now - incident.at) / 1000);
  const progress = reducedMotion ? .5 : Math.min(1, age / 4);
  ctx.save(); ctx.translate(point.x, point.y);
  ctx.globalAlpha = Math.min(1, (incident.expiresAt - now) / 1000);
  ctx.save();
  if (incident.kind === 'hat') {
    ctx.translate(progress * 35, -22 - Math.sin(progress * Math.PI) * 20);
    if (!reducedMotion) ctx.rotate(progress * 3);
    ctx.fillStyle = '#efb66f'; ctx.fillRect(-5, -3, 10, 3); ctx.fillRect(-3, -7, 6, 5);
  } else if (incident.kind === 'balloon') {
    ctx.translate(8 + Math.sin(age) * (reducedMotion ? 0 : 5), -18 - progress * 45);
    ctx.strokeStyle = '#fff3c5'; ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(0, 17); ctx.stroke();
    ctx.fillStyle = '#f6a0c2'; ctx.beginPath(); ctx.ellipse(0, 0, 5, 6, 0, 0, Math.PI * 2); ctx.fill();
  } else if (incident.kind === 'photo') {
    ctx.fillStyle = '#2d4250'; ctx.fillRect(4, -15, 9, 6);
    ctx.fillStyle = '#dff9ff'; ctx.beginPath(); ctx.arc(8.5, -12, 2, 0, Math.PI * 2); ctx.fill();
    if (reducedMotion || age % 2 < .16) { ctx.strokeStyle = '#fff3b0'; ctx.beginPath(); ctx.moveTo(15,-20);ctx.lineTo(19,-25);ctx.moveTo(18,-15);ctx.lineTo(24,-15);ctx.stroke(); }
  } else if (incident.kind === 'mascot') {
    ctx.translate(18, -5);
    ctx.fillStyle = '#ffdc69'; ctx.beginPath();ctx.ellipse(0, -5, 7, 10, 0, 0, Math.PI*2);ctx.fill();
    ctx.fillStyle = '#df8c32';ctx.beginPath();ctx.ellipse(4,-12,6,2,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle = '#27382f';ctx.fillRect(-2,-15,1.5,2);ctx.fillRect(2,-15,1.5,2);
    ctx.strokeStyle = '#ffdc69';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-4,-7);ctx.lineTo(-10,-12 + (reducedMotion ? 0 : Math.sin(age*5)*3));ctx.stroke();
  } else if (incident.kind === 'soaked') {
    ctx.strokeStyle = '#91dafa';ctx.lineWidth=1.5;ctx.beginPath();
    for(let drop=0;drop<4;drop++){const x=(drop-1.5)*5;const y=-17+(reducedMotion?4:(age*15+drop*4)%14);ctx.moveTo(x,y);ctx.lineTo(x-1,y+3);}ctx.stroke();
  } else {
    ctx.strokeStyle = '#b8e183';ctx.lineWidth=1.3;ctx.beginPath();ctx.ellipse(0,-21,8,3,0,0,Math.PI*2);ctx.stroke();
    ctx.font='10px system-ui';ctx.fillStyle='#ffe691';ctx.textAlign='center';ctx.fillText('✦',reducedMotion?0:Math.sin(age*4)*7,-21);
  }
  ctx.restore();
  if (incident.text && age < 7 && !['wobble', 'soaked'].includes(incident.kind)) {
    const text = incident.text.slice(0, 56);
    ctx.globalAlpha = Math.min(1, (7 - age) / 1.2);
    ctx.font = 'bold 9px system-ui';
    ctx.textAlign = 'center';
    const width = Math.min(290, ctx.measureText(text).width + 14);
    ctx.fillStyle = '#fff0b9';
    ctx.strokeStyle = '#b78537';
    ctx.lineWidth = 1;
    ctx.beginPath();ctx.roundRect(-width / 2, -48, width, 19, 7);ctx.fill();ctx.stroke();
    ctx.fillStyle = '#302719';ctx.fillText(text, 0, -35, width - 12);
  }
  ctx.restore();
}
