import { build } from 'vite';
import path from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

// Reuse the actual engine so the first paint already has reachable, moving guests.
const source = `
    import { readFileSync, writeFileSync } from 'node:fs';
    import assert from 'node:assert/strict';
    import { createWatchWorld, watchEnvironment } from '@/lib/jev/watchEngine';
    const park = JSON.parse(readFileSync('public/parks/showcase.json', 'utf8'));
    const world = createWatchWorld(park, 5000, 0, 100);
    const snapshot = { guests: world.guests, tick: world.tick, population: world.population,
      ...watchEnvironment(world, park), feed: [], mode: 'offline', decisionCount: 0 };
    assert.equal(snapshot.guests.length, 100);
    assert.equal(snapshot.population, 5000);
    assert(snapshot.guests.some(guest => guest.path.length));
    writeFileSync('public/parks/preview.json', JSON.stringify(snapshot));
  `;
const temp = await mkdtemp(path.join(tmpdir(), 'park-preview-'));
try {
  const entry = path.join(temp, 'preview.mjs');
  await writeFile(entry, source);
  const result = await build({
    configFile: false, logLevel: 'silent',
    resolve: { alias: { '@': path.resolve('src') } },
    build: { ssr: entry, write: false, minify: false },
  });
  await import(`data:text/javascript;base64,${Buffer.from(result.output[0].code).toString('base64')}`);
} finally { await rm(temp, { recursive: true, force: true }); }
console.log('Built populated park preview: 5,000 visitors, 100 detailed guests.');
