export type RecordingSnapshot = {
  guests: number;
  decisions: number;
  mode: string;
  events: { text: string; icon: string }[];
  announcement?: string;
};

export function recordPark(getSnapshot: () => RecordingSnapshot) {
  const layers = Array.from(document.querySelectorAll<HTMLCanvasElement>('[aria-label="Park simulation"] canvas'));
  if (!layers.length || !window.MediaRecorder) throw new Error('Recording is unavailable in this browser');
  const canvas = document.createElement('canvas');
  canvas.width = 1920; canvas.height = 1080;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Recording canvas is unavailable');
  const stream = canvas.captureStream(30);
  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8'].find(type => MediaRecorder.isTypeSupported(type));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 6_000_000 } : undefined);
  const chunks: Blob[] = [];
  let frame = 0;
  const text = (value: string, x: number, y: number, width: number, lineHeight = 32) => {
    let line = '';
    for (const word of value.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > width && line) { ctx.fillText(line, x, y); y += lineHeight; line = word; }
      else line = next;
    }
    ctx.fillText(line, x, y);
  };
  const draw = () => {
    const snapshot = getSnapshot();
    ctx.fillStyle = '#14251e'; ctx.fillRect(0, 0, 1920, 1080);
    for (const layer of layers) if (layer.width && layer.height) ctx.drawImage(layer, 0, 96, 1460, 984);
    ctx.fillStyle = '#18251f'; ctx.fillRect(1460, 96, 460, 984);
    ctx.fillStyle = '#ffe374'; ctx.font = 'bold 42px Georgia'; ctx.fillText('JEVASSIC PARK', 36, 62);
    ctx.fillStyle = '#d7fa81'; ctx.font = 'bold 25px Georgia';
    ctx.fillText(snapshot.mode === 'live' ? 'Jev live' : 'Code', 1540, 59);
    ctx.fillStyle = '#f3eed9'; ctx.font = 'bold 26px Georgia';
    ctx.fillText(`${snapshot.guests.toLocaleString()} guests`, 1490, 148);
    ctx.font = '23px Georgia'; ctx.fillText(`${snapshot.decisions.toLocaleString()} decisions`, 1490, 190);
    snapshot.events.slice(0, 7).forEach((event, index) => {
      const y = 224 + index * 112;
      ctx.fillStyle = index === 0 ? '#3e5435' : '#253c30';
      ctx.beginPath(); ctx.roundRect(1480, y, 420, 98, 16); ctx.fill();
      ctx.strokeStyle = index === 0 ? '#d7fa81' : '#4a6653'; ctx.stroke();
      ctx.fillStyle = '#f4f0d9'; ctx.font = '25px Georgia';
      text(`${event.icon} ${event.text}`, 1500, y + 37, 378, 30);
    });
    if (snapshot.announcement) {
      ctx.fillStyle = '#ffe374'; ctx.beginPath(); ctx.roundRect(150, 120, 1160, 110, 18); ctx.fill();
      ctx.fillStyle = '#30231d'; ctx.font = 'bold 30px Georgia';
      text(`Park radio: ${snapshot.announcement}`, 185, 165, 1090, 38);
    }
    frame = requestAnimationFrame(draw);
  };
  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => reject(new Error('Video recording failed'));
    recorder.onstop = () => {
      clearTimeout(timeout); cancelAnimationFrame(frame); stream.getTracks().forEach(track => track.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType });
      if (blob.size) resolve(blob); else reject(new Error('The recording was empty'));
    };
  });
  draw(); recorder.start(1000);
  const stop = () => { if (recorder.state !== 'inactive') recorder.stop(); };
  const timeout = setTimeout(stop, 60_000);
  return { finished, stop };
}
