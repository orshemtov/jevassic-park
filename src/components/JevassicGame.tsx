'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CoasterProvider, useCoaster } from '@/context/CoasterContext';
import { CoasterGrid } from '@/components/coaster/CoasterGrid';
import { getGuestActions, isDecisionBoundary, attractionName, announcedAttraction, type ActionKind } from '@/lib/jev/decisions';
import { watchEnvironment } from '@/lib/jev/environment';
import { previewAnnouncementDecisions, previewDecisions } from '@/lib/jev/previewDecisions';
import { summarizePark, type ParkState } from '@/lib/jev/parkState';
import type { GameState } from '@/games/coaster/types/game';
import type { Guest } from '@/games/coaster/types/economy';
import { announcementDelay, nextParkAnnouncement, isCurrentRadioReaction, type RadioReaction } from '@/lib/jev/announcements';
import { announcementImpact } from '@/lib/jev/announcementImpact';
import { attractionActivity, activityLabels, emptyActivity } from '@/lib/jev/attractionActivity';
import type { ParkMusicState } from '@/lib/jev/parkMusic';
import { createParkSpectacle, spectacleForAnnouncement, type ParkSpectacle } from '@/lib/jev/spectacles';
import { detectGuestStories, connectGuestStory, type GuestStory } from '@/lib/jev/guestStories';
import { chooseDirectorShot, DIRECTOR_HOLD_MS } from '@/lib/jev/cameraDirector';
import { guestPersonality, guestSocialContext, companionAction, personalityAction } from '@/lib/jev/guestPersonality';
import { parkRhythm, guestIncident, rideIncident, type ParkIncident } from '@/lib/jev/parkEvents';
import { connectParkAudio } from '@/lib/jev/parkAudio';
import { recordPark, type RecordingSnapshot } from '@/lib/recordPark';

const PRESETS = [10, 100, 1000, 5000, 10000];
type Decision = { id: string; action: string; probability?: number };
type DecisionResponse = { mode: 'live' | 'offline'; decisions: Decision[]; manager?: string; error?: string; usage?: { inputTokens?: number | null } };
type FeedEntry = { id?: number; action: string; mode: string; time: string; guestId?: string; name?: string; kind?: ActionKind; probability?: number; broadcast?: boolean; radio?: RadioReaction };
type ReactionMark = { id: string; icon: string; at: number };
type Announcement = { id: number; text: string; total: number; processed: number;
  changed: number; stayed: number; responded?: number; responders?: string[]; status: 'deciding' | 'done'; park: ParkState; budgetNotice?: boolean };
const ANNOUNCEMENTS = [
  'The hotdog stand is giving away free hot dogs!',
  'The parade is starting.',
  'The fountain show is starting.',
  'Fireworks above the castle!',
];
const actionIcon: Record<ActionKind, string> = { ride: '🎢', food: '🌭', drink: '🥤', shop: '🎁',
  wait: '🪑', leave: '🏃', continue: '😎', restroom: '🚻' };
const weatherIcon: Record<string, string> = { sunny: '☀️', partly_cloudy: '🌤️', hot: '🥵',
  cloudy: '☁️', rain: '🌧️', storm: '⛈️', cold: '🧣' };

type GameOptions = { adminMode: boolean; decisionIntervalMs: number; spectatorPopulation: number };
type WatchSnapshot = Pick<GameState, 'hour' | 'minute' | 'weather'> & { guests: Guest[]; tick: number; feed: FeedEntry[]; mode: 'live' | 'offline';
  decisionCount: number; population: number; spectacle?: ParkSpectacle; incidents?: ParkIncident[]; budget?: { exhausted: boolean; resetsAt: string };
  announcement?: { id: number; text: string; at: number; total: number; processed: number; changed: number; stayed: number; responded?: number; responders?: string[]; status: 'deciding' | 'done' } };

function Park({ adminMode, decisionIntervalMs: initialDecisionIntervalMs, spectatorPopulation }: GameOptions) {
  const { state, latestStateRef, isStateReady, setSpeed, setGuestTarget, applyGuestChoice,
    setParkSettings, startHotdogGiveaway, clearGuests, applySpectatorSnapshot } = useCoaster();
  const [feedExpanded, setFeedExpanded] = useState(false);
  const [target, setTarget] = useState(adminMode ? 10 : 100);
  const [population, setPopulation] = useState(adminMode ? 10 : spectatorPopulation);
  const [decisionIntervalMs, setDecisionIntervalMs] = useState(initialDecisionIntervalMs);
  const lastWatchAnnouncement = useRef<number | null>(null);
  const lastBudgetReset = useRef<string | null>(null);
  const [decisionMode, setDecisionMode] = useState<'jev' | 'code'>('code');
  const [budget, setBudget] = useState(.1);
  const [jevSpent, setJevSpent] = useState(0);
  const budgetUsed = useRef(0);
  const budgetSession = useRef(0);
  const budgetNotice = useRef(false);
  const [running, setRunning] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundPlaying, setSoundPlaying] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const parkAudio = useRef<HTMLAudioElement>(null);
  const parkMusic = useRef<ParkMusicState>({ track: 0, remaining: [], cue: null, resumeAt: 0, lastEventAt: 0 });
  const lastMusicAnnouncement = useRef<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordedClip, setRecordedClip] = useState<string | null>(null);
  const recorder = useRef<ReturnType<typeof recordPark> | null>(null);
  const recordingSnapshot = useRef<RecordingSnapshot>({ guests: 0, decisions: 0, mode: 'ready', events: [] });
  const [mode, setMode] = useState<'live' | 'offline' | 'ready'>('ready');
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);
  const [followingGuestId, setFollowingGuestId] = useState<string | null>(null);
  const stopFollowing = useCallback(() => setFollowingGuestId(null), []);
  const [selectedBuilding, setSelectedBuilding] = useState<{ x: number; y: number; type: string } | null>(null);
  const [selectedTile, setSelectedTile] = useState<{ x: number; y: number } | null>(null);
  const [navigationTarget, setNavigationTarget] = useState<{ x: number; y: number; zoom?: number; smooth?: boolean } | null>(null);
  const [directorEnabled, setDirectorEnabled] = useState(!adminMode);
  const [directorCaption, setDirectorCaption] = useState<string | null>(null);
  const [spectacle, setSpectacle] = useState<ParkSpectacle>();
  const spectacleRef = useRef<ParkSpectacle | undefined>(undefined);
  const [guestStory, setGuestStory] = useState<GuestStory | null>(null);
  const storyRef = useRef<GuestStory | null>(null);
  const storyHistory = useRef(new Map<string, { at: number; steps: string[] }>());
  const recentShots = useRef<string[]>([]);
  const [incidents, setIncidents] = useState<ParkIncident[]>([]);
  const lastLocalIncident = useRef(0);
  const previousStoryGuests = useRef<Guest[]>([]);
  const storyCooldowns = useRef(new Map<string, number>());
  const lastStoryAt = useRef(0);
  const lastDirectorShot = useRef(0);
  const lastDirectorKey = useRef('');
  const stopDirector = useCallback(() => {
    setDirectorEnabled(false); setDirectorCaption(null); setFollowingGuestId(null); setNavigationTarget(null);
  }, []);
  const navigationComplete = useCallback(() => setNavigationTarget(null), []);
  useEffect(() => { spectacleRef.current = spectacle; }, [spectacle]);
  const spectacleStart = spectacle?.startedAt;
  useEffect(() => { if (spectacleStart != null) lastDirectorShot.current = 0; }, [spectacleStart]);
  const spectacleDuration = spectacle?.durationMs;
  useEffect(() => {
    if (spectacleStart == null || spectacleDuration == null) return;
    const timer = setTimeout(() => setSpectacle(undefined), Math.max(0, spectacleStart + spectacleDuration - Date.now()));
    return () => clearTimeout(timer);
  }, [spectacleStart, spectacleDuration]);
  useEffect(() => { if (guestStory) storyRef.current = guestStory; }, [guestStory]);
  useEffect(() => {
    lastDirectorShot.current = Date.now() - 10_000;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => { if (query.matches) setDirectorEnabled(false); };
    const frame = requestAnimationFrame(sync);
    query.addEventListener('change', sync);
    return () => { cancelAnimationFrame(frame); query.removeEventListener('change', sync); };
  }, []);
  useEffect(() => {
    const now = Date.now();
    if (adminMode && running) {
      const completed = state.guests.flatMap(guest => {
        const before = previousStoryGuests.current.find(old => old.id === guest.id);
        const event = before && rideIncident(before, guest, state, now);
        return event ? [event] : [];
      });
      const walker = state.guests.find(guest => guest.state === 'walking' && guest.path.length > 0);
      if (walker && now - lastLocalIncident.current > 24_000) {
        const kind = (['photo', 'balloon', 'mascot', 'photo'] as const)[Math.floor(now / 24000) % 4];
        completed.push(guestIncident(walker, kind, now));
        lastLocalIncident.current = now;
      }
      if (completed.length) setIncidents(previous => [...previous.filter(event => event.expiresAt > now), ...completed].slice(-8));
    }
    const candidates = detectGuestStories(previousStoryGuests.current, state.guests, now, state.grid).map(story => connectGuestStory(story, storyHistory.current));
    // Preserve completed-ride history before the next simulation update mutates it.
    previousStoryGuests.current = state.guests.map(guest => ({ ...guest, ridesRidden: [...guest.ridesRidden] }));
    if (!running || now - lastStoryAt.current < 20_000) return;
    const next = candidates.find(story => story.guestId === storyRef.current?.guestId || now - (storyCooldowns.current.get(story.guestId) ?? 0) > 120_000);
    if (!next) return;
    for (const [id, at] of storyCooldowns.current) if (now - at > 300_000) storyCooldowns.current.delete(id);
    storyCooldowns.current.set(next.guestId, now);
    lastStoryAt.current = now;
    setGuestStory(next);
  }, [state.guests, state.grid, running, adminMode, state]);
  useEffect(() => {
    if (!guestStory) return;
    const timeout = setTimeout(() => setGuestStory(null), 10_000);
    return () => clearTimeout(timeout);
  }, [guestStory]);
  useEffect(() => {
    if (!directorEnabled || !running || !isStateReady) return;
    const timer = setInterval(() => {
      const now = Date.now();
      if (document.hidden || now - lastDirectorShot.current < DIRECTOR_HOLD_MS) return;
      const shot = chooseDirectorShot(latestStateRef.current, spectacleRef.current, storyRef.current, lastDirectorKey.current, now, recentShots.current);
      if (!shot) return;
      lastDirectorShot.current = now; lastDirectorKey.current = shot.key;
      recentShots.current = [...recentShots.current, shot.key].slice(-3);
      setSelectedGuestId(null); setSelectedBuilding(null); setSelectedTile(null);
      setFollowingGuestId(shot.guestId ?? null);
      setDirectorCaption(shot.label);
      setNavigationTarget({ x: shot.x, y: shot.y, zoom: shot.zoom, smooth: true });
    }, 1000);
    return () => clearInterval(timer);
  }, [directorEnabled, running, isStateReady, latestStateRef]);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const feedSequence = useRef(0);
  const [lastChoices, setLastChoices] = useState<Record<string, { action: string; probability?: number }>>({});
  const [rideChoices, setRideChoices] = useState(0);
  const [announcementDraft, setAnnouncementDraft] = useState(ANNOUNCEMENTS[0]);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [reactionMarks, setReactionMarks] = useState<ReactionMark[]>([]);
  const [specialEvent, setSpecialEvent] = useState<{ icon: string; text: string } | null>(null);
  const [decisionCount, setDecisionCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const controlsDialog = useRef<HTMLDialogElement>(null);
  const radioDialog = useRef<HTMLDialogElement>(null);
  const crowdDialog = useRef<HTMLDialogElement>(null);
  const queue = useRef<string[]>([]);
  const announcementQueue = useRef<string[]>([]);
  const announcementRef = useRef<Announcement | null>(null);
  const announcementNumber = useRef(0);
  const deferredChoices = useRef(new Map<string, { action: string; announcement: string }>());
  const pending = useRef(new Set<string>());
  const inFlightIds = useRef(new Set<string>());
  const decidedOnce = useRef(new Set<string>());
  const inFlight = useRef(0);
  const nextRequestAt = useRef(0);
  const managerPending = useRef(false);
  const managerDay = useRef('');
  const runId = useRef(0);
  const lastAdmission = useRef(0);
  const retryAt = useRef(0);
  const lastWeather = useRef<string | null>(null);
  const lastRideMilestone = useRef(0);

  useEffect(() => {
    recordingSnapshot.current = { guests: state.guests.length + Math.max(0, population - target),
      decisions: decisionCount, mode, events: feed.map(entry => ({ text: entry.name ? `${entry.name}: ${entry.action}` : entry.action, icon: entry.mode === 'broadcast' ? '📣' : actionIcon[entry.kind ?? 'wait'] })),
      announcement: showAnnouncement ? announcement?.text : undefined };
  }, [state.guests.length, population, target, decisionCount, mode, feed, announcement, showAnnouncement]);
  useEffect(() => () => recorder.current?.stop(), []);

  const startRecording = async () => {
    if (!adminMode || recorder.current) return;
    try {
      controlsDialog.current?.close();
      recorder.current = recordPark(() => recordingSnapshot.current);
      setRecording(true);
      const blob = await recorder.current.finished;
      const url = URL.createObjectURL(blob);
      setRecordedClip(url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Recording failed'); }
    finally { recorder.current = null; setRecording(false); }
  };

  useEffect(() => () => { if (recordedClip) URL.revokeObjectURL(recordedClip); }, [recordedClip]);

  const start = () => {
    crowdDialog.current?.close();
    runId.current++;
    managerPending.current = true;
    setError(null);
    setRunning(true);
    setSpeed(1);
  };
  const pause = () => {
    runId.current++;
    setRunning(false);
    setSpeed(0);
  };

  const broadcast = () => {
    const text = announcementDraft.trim();
    if (!running || !text || text.length > 160 || announcementRef.current) return;
    const ids = latestStateRef.current.guests.map(guest => guest.id);
    if (!ids.length) return;
    const isFreeHotdogs = /free\s+hot\s*dogs?/i.test(text);
    const next: Announcement = { id: ++announcementNumber.current, text, total: ids.length,
      processed: 0, changed: 0, stayed: 0, status: 'deciding',
      park: { ...summarizePark(latestStateRef.current, isFreeHotdogs || (latestStateRef.current.freeHotdogsUntilTick ?? 0) > latestStateRef.current.tick),
        activeGuests: ids.length + Math.max(0, population - target) } };
    announcementRef.current = next;
    announcementQueue.current = ids;
    queue.current = [];
    pending.current.clear();
    if (isFreeHotdogs) startHotdogGiveaway();
    const scene = spectacleForAnnouncement(text);
    if (scene) setSpectacle(createParkSpectacle(latestStateRef.current, scene, Date.now()));
    radioDialog.current?.close();
    setAnnouncement(next);
    setShowAnnouncement(true);
    setFeed(previous => [{ id: ++feedSequence.current, action: text, mode: 'broadcast',
      time: new Date().toLocaleTimeString() }, ...previous].slice(0, 50));
  };

  const recordAnnouncementProgress = useCallback((event: Announcement, processed: number, changed: number, stayed: number, responded = 0, responders: string[] = []) => {
    const current = announcementRef.current;
    if (current?.id !== event.id) return;
    const next: Announcement = { ...current, processed: current.processed + processed,
      changed: current.changed + changed, stayed: current.stayed + stayed, responded: (current.responded ?? 0) + responded, responders: [...new Set([...(current.responders ?? []), ...responders])],
      status: current.processed + processed >= current.total ? 'done' : 'deciding' };
    announcementRef.current = next.status === 'done' ? null : next;
    setAnnouncement(next);
    if (next.status === 'done' && next.changed >= 10) {
      setSpecialEvent({ icon: '🎉', text: `${next.changed} guests changed course after one announcement` });
    }
  }, []);

  const requestBatch = useCallback(async (ids: string[], includeManager: boolean, event?: Announcement) => {
    const session = runId.current;
    try {
    const snapshot = latestStateRef.current;
    const queueCounts = new Map<string, number>();
    snapshot.guests.forEach(guest => {
      if (guest.state === 'queuing' && guest.queueRideId) {
        queueCounts.set(guest.queueRideId, (queueCounts.get(guest.queueRideId) ?? 0) + 1);
      }
    });
    const currentScene = spectacleRef.current;
    const remainingShowMs = event && currentScene && spectacleForAnnouncement(event.text) === currentScene.kind
      ? Math.max(0, currentScene.startedAt + currentScene.durationMs - Date.now()) : Infinity;
    const actors = ids.flatMap(id => {
      const guest = snapshot.guests.find(item => item.id === id);
      if (!guest || (!event && !isDecisionBoundary(guest))) return [];
      const actions = getGuestActions(snapshot.grid, guest,
        (snapshot.freeHotdogsUntilTick ?? 0) > snapshot.tick, event?.text, snapshot.guests).filter(action => action.distance * 2500 + 20_000 <= remainingShowMs).map(({ id: actionId, kind, label, price, distance, buildingId }) =>
        ({ id: actionId, kind, label, price, distance, queue: kind === 'ride' && buildingId ? queueCounts.get(buildingId) ?? 0 : 0 }));
      if (event) actions.unshift({ id: 'continue', kind: 'continue', label: `Keep ${guest.state} as planned`,
        price: 0, distance: 0, queue: 0 });
      return [{ id, ...(!event ? { codeChoice: companionAction(guest, snapshot.guests, actions) ?? personalityAction(guest, actions) } : {}), guest: { hunger: guest.hunger, thirst: guest.thirst, energy: guest.energy,
        bathroom: guest.bathroom, nausea: guest.nausea, happiness: guest.happiness, cash: guest.cash,
        preferExcitement: guest.preferExcitement, preferIntensity: guest.preferIntensity,
        ...guestSocialContext(guest, snapshot.guests), activity: guest.state, timeInPark: guest.timeInPark, ridesRidden: guest.ridesRidden.slice(-32) }, actions }];
    });
    const manager = includeManager ? { actions: [
      { id: 'keep', label: 'Keep park settings' },
      { id: 'fee20', label: 'Set admission to $20 to attract guests' },
      { id: 'fee35', label: 'Set admission to $35' },
      { id: 'fee50', label: 'Set admission to $50 for more revenue' },
    ] } : undefined;
    if (!actors.length && !manager) {
      if (event) recordAnnouncementProgress(event, ids.length, 0, ids.length);
      return;
    }
    const sharedPark = event?.park ?? { ...summarizePark(snapshot), activeGuests: snapshot.guests.length + Math.max(0, population - target) };
    const payload = { park: sharedPark, actors, manager, announcement: event?.text, decisionMode };
    // shortcut: conservative browser-local allowance; a Gateway key budget is the account-wide cap.
    const reservedCost = (new TextEncoder().encode(JSON.stringify(payload)).length * 2 + 2048) * .04 / 1e6;
    const useJev = decisionMode === 'jev' && budgetUsed.current + reservedCost <= budget;
    const budgetEpoch = budgetSession.current;
    payload.decisionMode = useJev ? 'jev' : 'code';
    if (useJev) budgetUsed.current += reservedCost;
    if (decisionMode === 'jev' && !useJev && !budgetNotice.current) {
      budgetNotice.current = true;
      setSpecialEvent({ icon: '🧠', text: 'Jev budget reached. Code takes over.' });
    }
      const response = await fetch('/api/decide', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000) });
      const result: DecisionResponse = await response.json();
      if (useJev && response.ok && budgetEpoch === budgetSession.current) {
        const cost = result.usage?.inputTokens != null ? result.usage.inputTokens * .04 / 1e6 : reservedCost;
        budgetUsed.current += cost - reservedCost;
        setJevSpent(budgetUsed.current);
      }
      if (!response.ok) {
        if (response.status === 402 || response.status === 429) { setRunning(false); setSpeed(0); }
        throw new Error(result.error || `Jev request failed (${response.status})`);
      }
      if (session !== runId.current) {
        if (event && announcementRef.current?.id === event.id) announcementQueue.current.unshift(...ids);
        return;
      }
      if (event ? announcementRef.current?.id !== event.id : !!announcementRef.current) return;
      setMode(result.mode);
      setDecisionCount(previous => previous + result.decisions.length + (result.manager ? 1 : 0));
      const entries: FeedEntry[] = [];
      const choicePatch: Record<string, { action: string; probability?: number }> = {};
      let newRideChoices = 0;
      let responded = 0;
      let changed = 0, stayed = event ? ids.length - result.decisions.length : 0;
      const newMarks: ReactionMark[] = [];
      for (const decision of result.decisions) {
        const guest = latestStateRef.current.guests.find(item => item.id === decision.id);
        const keep = decision.action === 'continue';
        const busy = guest && ['riding', 'eating', 'shopping', 'exiting_building'].includes(guest.state);
        const accepted = event ? keep || (busy ? (deferredChoices.current.set(decision.id, { action: decision.action, announcement: event.text }), true)
          : applyGuestChoice(decision.id, decision.action, true, event.text)) : applyGuestChoice(decision.id, decision.action);
        if (event && !accepted) {
          stayed++;
          entries.push({ guestId: decision.id, name: guest?.name, kind: 'continue', action: 'Kept their current plan',
            mode: result.mode, probability: result.mode === 'live' ? decision.probability : undefined, time: new Date().toLocaleTimeString() });
          continue;
        }
        if (accepted) {
          decidedOnce.current.add(decision.id);
          const selected = actors.find(actor => actor.id === decision.id)?.actions.find(action => action.id === decision.action);
          const related = event && selected && announcedAttraction(event.text, selected.label);
          if (related) responded++;
          const description = event && keep ? 'Kept their plan' :
            event && selected?.kind === 'food' && selected.price === 0 ? 'Free hot dogs!' :
            event && selected ? `New plan: ${selected.label}` :
            selected?.kind === 'ride' ? `Going to ${selected.label}` :
            selected?.kind === 'food' ? `Getting ${selected.label}` :
            selected?.kind === 'drink' ? `Getting ${selected.label}` :
            selected?.kind === 'leave' ? 'left the park' :
            selected?.kind === 'wait' ? 'took a breather' :
            selected ? `chose ${selected.label}` : decision.action;
          const sentence = description[0].toUpperCase() + description.slice(1);
          if (event) { if (keep) stayed++; else changed++; }
          if (event && newMarks.length < 8) newMarks.push({ id: decision.id,
            icon: keep ? '😎' : selected?.kind === 'food' ? '🌭' : selected?.kind === 'leave' ? '🏃' : '🤯', at: Date.now() });
          if (selected?.kind === 'ride') newRideChoices++;
          choicePatch[decision.id] = { action: sentence, probability: decision.probability };
          entries.push({ guestId: decision.id, name: guest?.name, kind: selected?.kind, action: sentence, broadcast: Boolean(event), ...(related ? { radio: { id: event.id, text: event.text, at: Date.now() } } : {}),
            mode: result.mode, probability: result.mode === 'live' ? decision.probability : undefined, time: new Date().toLocaleTimeString() });
        }
      }
      if (event) recordAnnouncementProgress(event, ids.length, changed, stayed, responded, entries.filter(entry => entry.radio).flatMap(entry => entry.guestId ? [entry.guestId] : []));
      if (newMarks.length) setReactionMarks(previous => [...previous.filter(mark => Date.now() - mark.at < 5000), ...newMarks].slice(-24));
      if (Object.keys(choicePatch).length) {
        const active = new Set(latestStateRef.current.guests.map(guest => guest.id));
        setLastChoices(previous => ({ ...Object.fromEntries(Object.entries(previous).filter(([id]) => active.has(id))), ...choicePatch }));
      }
      if (newRideChoices) setRideChoices(previous => previous + newRideChoices);
      if (result.manager) {
        if (result.manager.startsWith('fee')) setParkSettings({ entranceFee: Number(result.manager.slice(3)) });
        entries.push({ action: `Manager set admission to ${result.manager.startsWith('fee') ? `$${result.manager.slice(3)}` : 'stay the same'}`,
          mode: result.mode,
          time: new Date().toLocaleTimeString() });
      }
      if (entries.length) {
        const messages = entries.filter(entry => entry.kind !== 'continue').reverse().map(entry => ({ ...entry, id: ++feedSequence.current }));
        setFeed(previous => [...messages, ...previous].slice(0, 50));
      }
      setError(null);
    } catch (cause) {
      if (session !== runId.current) {
        if (event && announcementRef.current?.id === event.id) announcementQueue.current.unshift(...ids);
        return;
      }
      const message = cause instanceof Error ? cause.message : 'Jev is unavailable';
      setError(message);
      retryAt.current = Date.now() + 5000;
      if (includeManager) managerPending.current = true;
      if (event && announcementRef.current?.id === event.id) announcementQueue.current.unshift(...ids);
    } finally {
      for (const id of ids) pending.current.delete(id);
      for (const id of ids) inFlightIds.current.delete(id);
      inFlight.current--;
    }
  }, [applyGuestChoice, latestStateRef, recordAnnouncementProgress, setParkSettings, setSpeed, decisionMode, budget, population, target]);

  useEffect(() => {
    if (!adminMode || !running || !isStateReady) return;
    const timer = setInterval(() => {
      const now = Date.now();
      const snapshot = latestStateRef.current;
      const day = `${snapshot.year}-${snapshot.month}-${snapshot.day}`;
      if (managerDay.current !== day) { managerDay.current = day; managerPending.current = true; }
      const activeIds = new Set(snapshot.guests.map(guest => guest.id));
      for (const id of decidedOnce.current) if (!activeIds.has(id)) decidedOnce.current.delete(id);
      for (const guest of snapshot.guests) {
        const deferred = deferredChoices.current.get(guest.id);
        if (deferred && isDecisionBoundary(guest)) {
          deferredChoices.current.delete(guest.id);
          if (applyGuestChoice(guest.id, deferred.action, false, deferred.announcement)) {
            continue;
          }
        }
        if (!announcementRef.current && isDecisionBoundary(guest) && !pending.current.has(guest.id)) {
          pending.current.add(guest.id);
          queue.current.push(guest.id);
        }
      }
      for (const id of deferredChoices.current.keys()) if (!activeIds.has(id)) deferredChoices.current.delete(id);
      queue.current = queue.current.filter(id => activeIds.has(id));
      const firstDecisionBacklog = queue.current.filter(id => !decidedOnce.current.has(id)).length;
      if (!announcementRef.current && now - lastAdmission.current >= 1000 && firstDecisionBacklog < 128) {
        setGuestTarget(target, 20);
        lastAdmission.current = now;
      }
      if (now < retryAt.current || now < nextRequestAt.current || inFlight.current >= 2) return;
      const event = announcementRef.current;
      if (event) {
        const ids = announcementQueue.current.splice(0, 32);
        if (!ids.length) return;
        inFlight.current++;
        ids.forEach(id => inFlightIds.current.add(id));
        nextRequestAt.current = now + decisionIntervalMs;
        void requestBatch(ids, false, event);
        return;
      }
      queue.current.sort((a, b) => Number(decidedOnce.current.has(a)) - Number(decidedOnce.current.has(b)));
      const ids = queue.current.splice(0, 32).filter(id => activeIds.has(id));
      const manager = managerPending.current;
      managerPending.current = false;
      if (!ids.length && !manager) return;
      inFlight.current++;
      ids.forEach(id => inFlightIds.current.add(id));
      nextRequestAt.current = now + decisionIntervalMs;
      void requestBatch(ids, manager);
    }, Math.min(250, decisionIntervalMs));
    return () => clearInterval(timer);
  }, [adminMode, running, isStateReady, latestStateRef, requestBatch, applyGuestChoice, setGuestTarget, setSpeed, target, decisionIntervalMs]);

  useEffect(() => {
    if (adminMode && !running && isStateReady) setGuestTarget(target, 0);
  }, [adminMode, target, running, isStateReady, setGuestTarget]);

  useEffect(() => {
    if (adminMode || !isStateReady) return;
    let disposed = false;
    let pollGeneration = 0;
    let lastFrame = '';
    let previewLoaded = false;
    let previewTarget = 100;
    let liveAvailable = false;
    let lastLiveAt = 0;
    let lastAcceptedTick = -1;
    let lastAcceptedDecisionCount = -1;
    let fallbackSequence = 0;
    let pollFailures = 0;
    const previewStarted = Date.now();
    let previewWatchedMs = 0;
    let nextPreviewAnnouncement = announcementDelay(true);
    let previousAnnouncement = '';
    let previewBroadcast = 0;
    const fallbackTimer = setInterval(() => {
      if (disposed || document.hidden || !previewLoaded || (liveAvailable && Date.now() - lastLiveAt < 15_000)) return;
      const snapshot = latestStateRef.current;
      if (snapshot.guests.length < previewTarget) setGuestTarget(previewTarget, 5);
      previewWatchedMs += 1000;
      let broadcastText: string | undefined;
      let previewScene: ParkSpectacle | undefined;
      if (previewWatchedMs >= nextPreviewAnnouncement) {
        broadcastText = nextParkAnnouncement(previousAnnouncement, snapshot.hour, !spectacleRef.current || Date.now() >= spectacleRef.current.startedAt + spectacleRef.current.durationMs);
        previousAnnouncement = broadcastText;
        const scene = spectacleForAnnouncement(broadcastText);
        if (scene) { previewScene = createParkSpectacle(snapshot, scene, Date.now()); setSpectacle(previewScene); }
        nextPreviewAnnouncement = previewWatchedMs + announcementDelay();
        if (/free hot dogs/i.test(broadcastText)) startHotdogGiveaway();
      }
      applySpectatorSnapshot(watchEnvironment({ updatedAt: Date.now(), watchedMs: Date.now() - previewStarted, tick: snapshot.tick }, snapshot));
      const entries: FeedEntry[] = [];
      const choices: Record<string, { action: string }> = {};
      let changed = 0, responded = 0;
      const radio: RadioReaction | undefined = broadcastText ? { id: previewBroadcast - 1, text: broadcastText, at: Date.now() } : undefined;
      const decisions = broadcastText ? previewAnnouncementDecisions(snapshot, broadcastText, previewScene?.durationMs) : previewDecisions(snapshot);
      for (const { guest, action, label } of decisions) {
        if (action.kind !== 'continue' && !applyGuestChoice(guest.id, action.id, Boolean(broadcastText), broadcastText)) continue;
        if (action.kind !== 'continue') changed++;
        const related = broadcastText && announcedAttraction(broadcastText, action.label);
        if (related) responded++;
        entries.push({ id: --fallbackSequence, guestId: guest.id, name: guest.name,
          kind: action.kind, action: label, broadcast: Boolean(broadcastText), ...(related ? { radio } : {}), mode: 'offline', time: new Date().toLocaleTimeString() });
        choices[guest.id] = { action: label };
      }
      if (broadcastText) {
        setAnnouncement({ id: --previewBroadcast, text: broadcastText, total: snapshot.guests.length,
          processed: entries.length, changed, stayed: entries.length - changed, responded, responders: entries.filter(entry => entry.radio).flatMap(entry => entry.guestId ? [entry.guestId] : []), status: 'done',
          park: summarizePark(snapshot, /free hot dogs/i.test(broadcastText)) });
        setShowAnnouncement(true);
      }
      if (!entries.length) return;
      setMode('offline');
      setFeed(previous => [...entries.reverse(), ...previous].filter(entry => entry.kind !== 'continue').slice(0, 50));
      setDecisionCount(previous => previous + entries.length);
      setLastChoices(previous => ({ ...previous, ...choices }));
    }, 1000);
    const previewController = new AbortController();
    void fetch('/parks/preview.json', { signal: previewController.signal }).then(async response => {
      if (!response.ok) return;
      const preview: WatchSnapshot = await response.json();
      if (disposed || lastFrame) return;
      applySpectatorSnapshot({ guests: preview.guests, tick: preview.tick, hour: preview.hour, minute: preview.minute, weather: preview.weather });
      previewLoaded = true;
      previewTarget = preview.guests.length;
      setPopulation(preview.population);
      setTarget(preview.guests.length);
      setFeed(preview.feed.filter(entry => entry.kind !== 'continue'));
      setMode('offline');
      setDecisionCount(preview.decisionCount);
      setLastChoices(Object.fromEntries(preview.feed.filter(entry => entry.guestId).toReversed().map(entry => [entry.guestId!, { action: entry.action, probability: entry.probability }])));
    }).catch(() => {});
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (disposed || document.hidden) return;
      const generation = ++pollGeneration;
      controller = new AbortController();
      try {
        const response = await fetch('/api/watch', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]), cache: 'no-store' });
        if (!response.ok) throw new Error('Park reconnecting…');
        const snapshot: WatchSnapshot = await response.json();
        if (disposed || document.hidden || generation !== pollGeneration) return;
        const receivedAt = Date.now();
        if (receivedAt - lastLiveAt < 15_000 && (snapshot.tick < lastAcceptedTick || snapshot.decisionCount < lastAcceptedDecisionCount)) return;
        lastAcceptedTick = snapshot.tick;
        lastAcceptedDecisionCount = snapshot.decisionCount;
        liveAvailable = true;
        pollFailures = 0;
        lastLiveAt = receivedAt;
        previewLoaded = true;
        previewTarget = snapshot.guests.length;
        const frame = `${snapshot.tick}:${snapshot.decisionCount}`;
        if (lastFrame !== frame) {
          applySpectatorSnapshot({ guests: snapshot.guests, tick: snapshot.tick, hour: snapshot.hour, minute: snapshot.minute, weather: snapshot.weather });
          lastFrame = frame;
        }
        setSpectacle(snapshot.spectacle && Date.now() < snapshot.spectacle.startedAt + snapshot.spectacle.durationMs ? snapshot.spectacle : undefined);
        setIncidents(snapshot.incidents ?? []);
        setPopulation(snapshot.population);
        setTarget(snapshot.guests.length);
        setFeed(snapshot.feed.filter(entry => entry.kind !== 'continue'));
        setMode(snapshot.mode);
        setDecisionCount(snapshot.decisionCount);
        setLastChoices(Object.fromEntries(snapshot.feed.filter(entry => entry.guestId)
          .toReversed().map(entry => [entry.guestId!, { action: entry.action, probability: entry.probability }])));
        const event = snapshot.announcement;
        if (event && event.id !== lastWatchAnnouncement.current && Date.now() - event.at < 45_000) {
          lastWatchAnnouncement.current = event.id;
          setAnnouncement({ id: event.id, text: event.text, total: event.total,
            processed: event.processed, changed: event.changed, stayed: event.stayed, responded: event.responded ?? 0, responders: event.responders, status: event.status,
            park: summarizePark(latestStateRef.current) });
          setShowAnnouncement(true);
        } else if (event && event.id === lastWatchAnnouncement.current) {
          setAnnouncement(previous => previous?.id === event.id ? { ...previous, total: event.total, processed: event.processed, changed: event.changed, stayed: event.stayed, responded: event.responded ?? 0, responders: event.responders, status: event.status } : previous);
        }
        if (snapshot.budget?.exhausted && snapshot.budget.resetsAt !== lastBudgetReset.current) {
          lastBudgetReset.current = snapshot.budget.resetsAt;
          setAnnouncement({ id: -Date.parse(snapshot.budget.resetsAt), budgetNotice: true,
            text: 'Jev’s daily budget is used up. Back tomorrow. Deterministic code keeps the park running.',
            total: 0, processed: 0, changed: 0, stayed: 0, status: 'done',
            park: summarizePark(latestStateRef.current) });
          setShowAnnouncement(true);
        } else if (snapshot.budget && !snapshot.budget.exhausted) {
          setAnnouncement(previous => previous?.budgetNotice ? null : previous);
        }
        setError(null);
      } catch (cause) {
        if (!disposed && !document.hidden && generation === pollGeneration && !(cause instanceof DOMException && cause.name === 'AbortError')) {
          liveAvailable = false;
          pollFailures = Math.min(4, pollFailures + 1);
          setMode('offline');
          setError('Live decisions unavailable');
        }
      } finally {
        if (generation === pollGeneration) {
          controller = null;
          if (!disposed && !document.hidden) timer = setTimeout(() => void poll(), Math.min(30_000, 2000 * 2 ** pollFailures));
        }
      }
    };
    const syncVisibility = () => {
      clearTimeout(timer);
      pollGeneration++;
      controller?.abort();
      setRunning(!document.hidden);
      setSpeed(document.hidden ? 0 : 1);
      if (!document.hidden) void poll();
    };
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    return () => { disposed = true; clearInterval(fallbackTimer); previewController.abort(); clearTimeout(timer); controller?.abort(); document.removeEventListener('visibilitychange', syncVisibility); };
  }, [adminMode, isStateReady, applySpectatorSnapshot, applyGuestChoice, latestStateRef, setSpeed, setGuestTarget, startHotdogGiveaway]);

  useEffect(() => {
    const audio = parkAudio.current;
    if (!audio) return;
    return connectParkAudio(audio, soundEnabled, running, setSoundPlaying, setSoundBlocked, () => setSoundEnabled(false), parkMusic.current);
  }, [soundEnabled, running, isStateReady]);

  const selectedActivity = selectedBuilding ? attractionActivity(state.guests).get(`${selectedBuilding.x},${selectedBuilding.y}`) ?? emptyActivity() : null;
  const selectedIsService = selectedBuilding && /^(ride_|station_|food_|drink_|shop_|service_|show_|fountain_|castle|restroom$|first_aid$|lockers$|stroller_rental$|atm$)/.test(selectedBuilding.type);

  const toggleSound = () => {
    if (soundPlaying) { parkAudio.current?.pause(); setSoundEnabled(false); return; }
    setSoundEnabled(true);
    // An autoplay-blocked session is already enabled, so its effect will not rerun.
    if (soundEnabled && parkAudio.current) {
      const audio = parkAudio.current;
      void audio.play().then(() => { setSoundBlocked(false); setSoundPlaying(!audio.paused && !audio.muted); })
        .catch(() => setSoundBlocked(true));
    }
  };

  useEffect(() => {
    if (!isStateReady) return;
    if (lastWeather.current && lastWeather.current !== state.weather.current) {
      setSpecialEvent({ icon: weatherIcon[state.weather.current] ?? '🌦️',
        text: `Weather changed to ${state.weather.current.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase())}. Plans may change.` });
    }
    lastWeather.current = state.weather.current;
  }, [state.weather, isStateReady]);

  useEffect(() => {
    const milestone = Math.floor(rideChoices / 50);
    if (milestone > lastRideMilestone.current) {
      setSpecialEvent({ icon: '🎢', text: `${milestone * 50} attraction choices. The park is buzzing.` });
    }
    lastRideMilestone.current = milestone;
  }, [rideChoices]);

  useEffect(() => {
    if (!specialEvent) return;
    const timeout = setTimeout(() => setSpecialEvent(null), 8000);
    return () => clearTimeout(timeout);
  }, [specialEvent]);

  const announcementId = announcement?.id;
  const announcementText = announcement?.text;
  useEffect(() => {
    if (announcementId == null || announcementId === lastMusicAnnouncement.current || !showAnnouncement) return;
    lastMusicAnnouncement.current = announcementId;
    if (soundEnabled && soundPlaying && running) {
      parkAudio.current?.dispatchEvent(new CustomEvent('park-music-event', { detail: announcementText }));
    }
  }, [announcementId, announcementText, showAnnouncement, soundEnabled, soundPlaying, running]);
  useEffect(() => {
    if (announcementId == null) return;
    const timeout = setTimeout(() => setShowAnnouncement(false), 45_000);
    return () => clearTimeout(timeout);
  }, [announcementId]);

  const selectedGuest: Guest | undefined = state.guests.find(guest => guest.id === selectedGuestId);
  const selectedVenue = (selectedGuest?.queueRideId ?? selectedGuest?.targetBuildingId)?.split(',').map(Number);
  const selectedIsAudience = selectedGuest?.state === 'riding' && selectedVenue && /show_parade|fountain|castle/.test(state.grid[selectedVenue[1]]?.[selectedVenue[0]]?.building.type ?? '');
  const ambientCount = (running || state.guests.length > 0) ? Math.max(0, population - target) : 0;
  const focusGuest = (id: string, zoom = 1.6) => {
    setFeedExpanded(false);
    stopDirector();
    const guest = latestStateRef.current.guests.find(item => item.id === id);
    if (!guest) return;
    setSelectedBuilding(null);
    setSelectedGuestId(id);
    setFollowingGuestId(id);
    setSelectedTile(null);
    setNavigationTarget({ x: guest.tileX, y: guest.tileY, zoom });
  };
  const reset = () => {
    pause(); clearGuests(); setSpectacle(undefined); setGuestStory(null); queue.current = []; pending.current.clear();
    announcementQueue.current = []; announcementRef.current = null; deferredChoices.current.clear();
    decidedOnce.current.clear();
    setSelectedGuestId(null); setFollowingGuestId(null);
    setIncidents([]); storyHistory.current.clear(); storyRef.current = null; recentShots.current = [];
    setAnnouncement(null); setShowAnnouncement(false); setReactionMarks([]); setFeed([]); setLastChoices({});
    setRideChoices(0); setDecisionCount(0); budgetSession.current++; budgetNotice.current = false;
    budgetUsed.current = 0; setJevSpent(0); setMode('ready');
    crowdDialog.current?.close();
  };

  if (!isStateReady) return <main className="h-screen grid place-items-center bg-[#080f12] text-[#d7fa81]">Loading Jevassic Park…</main>;

  const radioImpact = announcementImpact(state.guests, state.grid, announcement);
  return (
    <main className="jevassic-shell h-dvh w-screen bg-[#080f12] text-[#e9f2ed] flex flex-col overflow-hidden">
      <audio ref={parkAudio} preload="none" />
      <header className="park-header h-16 shrink-0 border-b border-[#675044] bg-[#1d2021] flex items-center justify-between px-5 gap-4">
        <h1 className="text-xl md:text-2xl font-black tracking-tight text-[#ffe374]">🎢 JEVASSIC PARK</h1>
        <div className="flex items-center gap-3 text-xs md:text-sm"><span className="text-[#9bb5ad]">Guests <b className="text-white">{(state.guests.length + ambientCount).toLocaleString()}</b></span>
          {adminMode && <span className="hidden md:block text-[#9bb5ad]">Cash <b className="text-white">${Math.round(state.finances.cash).toLocaleString()}</b></span>}
          <span title={!adminMode && error ? 'Code preview. Live Jev decisions unavailable.' : mode === 'live' ? 'Live Jev decisions' : 'Deterministic decisions'} className={`rounded-full px-3 py-1 font-bold ${mode === 'live' ? 'bg-[#d7fa81] text-[#15231c]' : 'bg-[#314b4c] text-[#d8e9dd]'}`}>
            {mode === 'live' ? '● Jev' : !adminMode && error ? '◆ Code preview' : mode === 'offline' ? '◆ Code' : adminMode ? '◇ Ready' : '◆ Code'}</span>
          </div>
      </header>
      <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
        <section className="relative flex-1 min-h-0 bg-[#142526]" aria-label="Park simulation">
          {isStateReady ? <CoasterGrid selectedTile={selectedTile} reactionMarks={reactionMarks} ambientVisitors={ambientCount}
            followGuestId={followingGuestId} onFollowStop={stopFollowing} onManualCameraMove={stopDirector} spectacle={spectacle} incidents={incidents}
            broadcastResponders={showAnnouncement ? radioImpact.ids : []}
            guestPopup={selectedGuest ? { guestId: selectedGuest.id, content: <>
              <button type="button" aria-label="Close guest details" onClick={() => { setSelectedGuestId(null); setFollowingGuestId(null); }} className="float-right -mr-1 -mt-1 grid h-7 w-7 place-items-center rounded-full text-xl text-[#c6d5ca] hover:bg-[#40533b]">×</button>
              <p className="pr-7 text-base font-bold text-[#ffe374]">{selectedGuest.name}</p>
              <div className="mt-2 flex flex-wrap gap-1"><span className="rounded-full border border-[#789572] px-2 py-0.5 text-[11px]">{guestPersonality(selectedGuest).icon} {guestPersonality(selectedGuest).label}</span>{selectedGuest.groupId && <span title={guestSocialContext(selectedGuest, state.guests).friends.join(', ')} className="rounded-full border border-[#789572] px-2 py-0.5 text-[11px]">👥 With friends</span>}</div>
              <p className="mt-1 text-xs text-[#c6d5ca]">{(selectedGuest.targetPurchaseKind === 'restroom' && selectedGuest.state === 'shopping' ? 'Using the restroom' : selectedGuest.state === 'walking' && selectedGuest.decisionCooldown > 0 && !selectedGuest.path.length ? 'Resting' : selectedGuest.state === 'eating' && selectedGuest.targetPurchaseKind === 'drink' ? 'Drinking' : selectedIsAudience ? 'Watching' : selectedGuest.state.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase()))}</p>
              <p className="mt-2 text-sm font-semibold">{lastChoices[selectedGuest.id]?.action ?? (selectedGuest.targetPurchaseKind === 'restroom' && selectedGuest.state === 'shopping' ? 'Using the restroom' : selectedGuest.state === 'walking' && selectedGuest.decisionCooldown > 0 && !selectedGuest.path.length ? 'Resting' : selectedGuest.state === 'eating' && selectedGuest.targetPurchaseKind === 'drink' ? 'Drinking' : selectedIsAudience ? 'Watching' : selectedGuest.state.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase()))}</p>
              {guestStory?.guestId === selectedGuest.id && (guestStory.steps?.length ?? 0) > 1 && <p className="mt-2 text-[11px] leading-relaxed text-[#a8c3aa]">{guestStory!.steps!.join(' → ')}</p>}
              <dl className="mt-3 grid grid-cols-3 gap-3 text-xs text-[#c6d5ca]">
                <div><dt>Hunger</dt><dd className="mt-1 font-bold text-[#f5f2df]">{Math.round(selectedGuest.hunger)}%</dd></div>
                <div><dt>Thirst</dt><dd className="mt-1 font-bold text-[#f5f2df]">{Math.round(selectedGuest.thirst)}%</dd></div>
                <div><dt>Energy</dt><dd className="mt-1 font-bold text-[#f5f2df]">{Math.round(selectedGuest.energy)}%</dd></div>
              </dl>
              <div className="mt-3 flex items-center justify-between text-xs"><span>${Math.round(selectedGuest.cash)} left</span><span className="rounded-full bg-[#40533b] px-2 py-1">{followingGuestId === selectedGuest.id ? 'Following' : 'Selected'}</span></div>
            </> } : undefined}
            onGuestClick={id => focusGuest(id, 1.4)}
            onBuildingClick={building => { stopDirector(); setSelectedGuestId(null); setFollowingGuestId(null); setSelectedBuilding(building);
              setSelectedTile({ x: building.x, y: building.y }); }}
            navigationTarget={navigationTarget} onNavigationComplete={navigationComplete} /> :
            <div className="h-full grid place-items-center text-[#b7d2c6]">Loading the park…</div>}
          <div className="map-toolbar absolute top-4 left-4 flex items-center gap-2">
          <button type="button" onClick={() => controlsDialog.current?.showModal()}
            className=" rounded-lg border border-[#638374] bg-[#102321ed] px-3 py-2 text-sm font-bold text-[#e9f2d5] shadow-lg hover:bg-[#25443a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffe374]">⌨ Controls</button>
          <button type="button" aria-label="Auto camera" aria-pressed={directorEnabled} title={directorEnabled ? 'Pause automatic camera. Dragging also takes over.' : 'Follow park highlights automatically'}
            onClick={() => { if (directorEnabled) stopDirector(); else { lastDirectorShot.current = 0; setDirectorEnabled(true); } }}
            className={`rounded-full border px-3 py-2 text-sm font-bold shadow-lg ${directorEnabled ? 'border-[#d7fa81] bg-[#d7fa81] text-[#18281b]' : 'border-[#638374] bg-[#102321ed] text-[#e9f2d5]'}`}>🎬 Auto camera</button>
          </div>
          {directorEnabled && directorCaption && !showAnnouncement && <div className="pointer-events-none absolute top-16 left-4 max-w-[260px] truncate rounded-full border border-[#64755d] bg-[#14251ee8] px-3 py-1 text-xs text-[#ecf4d1]">{directorCaption}</div>}
          {guestStory && !selectedBuilding && !selectedGuest && <div role="status" className="absolute bottom-20 right-4 w-[min(300px,85%)] rounded-xl border border-[#d7b966] bg-[#20372ff2] p-4 text-[#f3edcf] shadow-2xl">
            <button type="button" aria-label="Dismiss guest story" onClick={() => setGuestStory(null)} className="float-right -mt-1 ml-2 text-xl text-[#bdcdbb]">×</button>
            <p className="text-xs font-bold text-[#d7fa81]">{guestStory.icon} {guestStory.name}</p>
            <p className="mt-1 text-sm font-semibold">{guestStory.text}</p>
            {(guestStory.steps?.length ?? 0) > 1 && <ol className="mt-2 space-y-1 text-xs text-[#baceb9]">{guestStory.steps!.slice(0, -1).map((step, index) => <li key={index}>↳ {step}</li>)}</ol>}
            <button type="button" title="Follow this developing story" aria-label="Follow story guest" onClick={() => focusGuest(guestStory.guestId)} className="mt-3 rounded-full border border-[#789572] bg-[#334c38] px-3 py-1 text-sm">Follow story ↗</button>
          </div>}
          <dialog ref={controlsDialog} aria-labelledby="controls-title" onClick={event => { if (event.target === controlsDialog.current) controlsDialog.current.close(); }}
            className="max-h-[90dvh] overflow-y-auto w-[min(92vw,420px)] rounded-2xl border-2 border-[#ffe374] bg-[#1c2926] p-0 text-[#f5f2df] shadow-2xl backdrop:bg-[#071210b8]">
            <div className="border-b border-[#496055] bg-[#283b31] px-5 py-4 flex items-center justify-between gap-4">
              <h2 id="controls-title" className="text-xl font-black text-[#ffe374]">Controls</h2>
              <button type="button" onClick={() => controlsDialog.current?.close()} aria-label="Close controls" className="text-2xl leading-none hover:text-[#ffe374]">×</button>
            </div>
            <div className="space-y-3 px-5 py-5 text-sm">
              <p className="flex justify-between gap-4 lg:hidden"><span>Move</span><b>Drag with one finger</b></p>
              <p className="flex justify-between gap-4 lg:hidden"><span>Zoom</span><b>Pinch with two fingers</b></p>
              <p className="hidden justify-between gap-4 lg:flex"><span>Move around</span><b className="text-right">Drag with left or middle mouse</b></p>
              <p className="hidden justify-between gap-4 lg:flex"><span>Move up and down</span><b className="text-right">Mouse wheel</b></p>
              <p className="hidden justify-between gap-4 lg:flex"><span>Move left and right</span><b className="text-right">Shift + wheel</b></p>
              <p className="hidden justify-between gap-4 lg:flex"><span>Zoom</span><b className="text-right">Ctrl/Cmd + wheel</b></p>
              <p className="border-t border-[#496055] pt-3 text-[#bcd1c3]">Click a guest or attraction for details. Click a decision to follow its guest.</p>
              {adminMode && <button type="button" disabled={recording} onClick={() => void startRecording()} className="w-full rounded-full bg-[#d7fa81] px-4 py-3 font-bold text-[#18281b] disabled:opacity-50">{recording ? 'Recording…' : 'Record 60-second clip'}</button>}
            </div>
          </dialog>
          {specialEvent && <div role="status" className="pointer-events-none absolute top-16 right-4 max-w-[260px] rounded-xl border border-[#ffcf82] bg-[#402c27] px-4 py-2 text-sm font-bold text-[#fff0d1] shadow-xl">
            <span className="mr-1 text-xl">{specialEvent.icon}</span>{specialEvent.text}</div>}
          {announcement && showAnnouncement && <div aria-live="polite" className="park-announcement radio-pop absolute top-16 left-1/2 w-[min(88%,540px)] -translate-x-1/2 rounded-xl border-2 border-[#593126] bg-[#ffe374] px-5 py-3 text-center text-[#321d1e] shadow-[0_8px_0_#4e3028]">
            <button type="button" onClick={() => setShowAnnouncement(false)} aria-label="Dismiss announcement" className="absolute right-2 top-1 rounded-full px-2 py-1 text-xl leading-none hover:bg-[#c9984c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#321d1e]">×</button>
            <div className="text-[11px] font-black tracking-[.2em]">📣 PARK RADIO{!announcement.budgetNotice && <> · BROADCAST #{announcement.id}</>}</div>
            <p className="mt-1 text-lg font-black leading-tight">{announcement.text}</p>
            {!announcement.budgetNotice && radioImpact.heading > 0 && <p className="mt-1 text-xs">{radioImpact.heading} on the way</p>}
            {!announcement.budgetNotice && <p className="mt-1 text-xs font-bold">{announcement.processed.toLocaleString()} / {announcement.total.toLocaleString()} heard · {announcement.responded ?? 0} joining</p>}
          </div>}
          {selectedBuilding && <div className="absolute bottom-20 right-4 w-[min(300px,88%)] rounded-xl border-2 border-[#ffe374] bg-[#202725] p-4 text-[#f5f2df] shadow-2xl">
            <button type="button" aria-label="Close map details" onClick={() => { setSelectedBuilding(null); setSelectedTile(null); }} className="float-right text-xl text-[#e8d6b5]">×</button>
            <p className="pr-5 text-lg font-black">{attractionName(selectedBuilding.type)}</p>
            {selectedIsService && selectedActivity && <div className="mt-3 flex flex-wrap gap-2" title="Live counts of tracked guests. Background crowd figures are not included.">
              {Object.entries(selectedActivity).filter(([, count]) => count > 0).map(([kind, count]) =>
                <span key={kind} className="rounded-full border border-[#63816d] bg-[#314738] px-3 py-1 text-sm"><b className="text-[#e5ffab]">{count}</b> {activityLabels[kind as keyof typeof selectedActivity]}</span>)}
              {!Object.values(selectedActivity).some(Boolean) && <span className="rounded-full border border-[#496055] px-3 py-1 text-sm text-[#c0cdbb]">No guests right now</span>}
            </div>}
            {selectedBuilding.type === 'food_hotdog' && (state.freeHotdogsUntilTick ?? 0) > state.tick && <p className="mt-2 font-bold text-[#ffe374]">🌭 Free hot dogs right now</p>}
          </div>}
          <div className="park-hud absolute left-4 right-4 bottom-4 flex flex-wrap items-center gap-1.5 rounded-xl border border-[#506058] bg-[#101d1bf0] px-3 py-2 text-sm font-bold text-[#f3edce] shadow-xl sm:right-auto">
            <button type="button" onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onClick={toggleSound} aria-label={soundPlaying ? 'Mute park sound' : 'Enable park sound'} aria-pressed={soundPlaying} title={soundPlaying ? 'Mute' : 'Enable sound'} className="rounded-full border border-[#617654] px-2 py-1 hover:bg-[#40533b]">{soundPlaying ? '🔊' : '🔇'}{soundBlocked && soundEnabled && <span className="ml-1 text-xs">Enable sound</span>}</button>
            {adminMode && recording && <button type="button" onClick={() => recorder.current?.stop()} className="rounded-full bg-[#a84437] px-3 py-1 text-white" title="Stop and download clip">● Stop recording</button>}
            {adminMode && recordedClip && <a href={recordedClip} download="jevassic-park.webm" className="rounded-full border border-[#d7fa81] px-3 py-1 text-[#d7fa81]">↓ Download clip</a>}
            <span title={running ? 'Simulation is running' : 'Simulation is paused'} aria-label={running ? 'Running' : 'Paused'} className="rounded-md bg-[#314738] px-2 py-1">{running ? '▶ Running' : '⏸ Paused'}</span>
            <span title={`Weather: ${state.weather.current}`} aria-label={`Weather ${state.weather.current}`} className="rounded-md px-2 py-1">{weatherIcon[state.weather.current] ?? '🌤️'} {state.weather.current.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase())}</span>
            <span title="In-game park time" aria-label={`Park time ${Math.floor(state.hour)}:${String(Math.floor(state.minute)).padStart(2, '0')}`} className="rounded-md px-2 py-1">🕒 {Math.floor(state.hour)}:{String(Math.floor(state.minute)).padStart(2, '0')}</span>
            {!spectacle && <span title={`Next show at ${parkRhythm(state.hour).nextShow.hour}:00`} className="hidden rounded-full border border-[#4d6a58] px-2.5 py-1 text-xs sm:inline-flex">Next: {parkRhythm(state.hour).nextShow.label}</span>}
            {spectacle && <button type="button" title="Show this event" onClick={() => { stopDirector(); setSelectedGuestId(null); setSelectedBuilding(null); setNavigationTarget({ ...spectacle.center, zoom: spectacle.kind === 'fireworks' ? .75 : 1.1, smooth: true }); }}
              className="rounded-full border border-[#c4aa65] bg-[#4b4128] px-2.5 py-1 text-[#ffe3a0]">{spectacle.kind === 'parade' ? '🎉 Parade' : spectacle.kind === 'fireworks' ? '🎆 Fireworks' : '⛲ Fountain show'}</button>}
            {(state.freeHotdogsUntilTick ?? 0) > state.tick && <span title="The hotdog giveaway is active" className="rounded-md bg-[#85482e] px-2 py-1">🌭 FREE</span>}
          </div>
        </section>
        <aside data-expanded={feedExpanded} className="decision-sheet flex min-h-0 w-full shrink-0 flex-col overflow-hidden border-t border-[#254d49] bg-[#171f20] lg:h-auto lg:w-[360px] lg:border-l lg:border-t-0 xl:w-[410px]">
          <button type="button" aria-expanded={feedExpanded} aria-controls="decision-sheet-content" aria-label={feedExpanded ? 'Collapse decisions' : 'Expand decisions'} onClick={() => setFeedExpanded(value => !value)} className="decision-sheet-toggle flex min-h-14 w-full shrink-0 items-center justify-between gap-3 px-4 py-2 text-left lg:hidden">
            <span className="min-w-0"><span className="block text-sm font-bold text-[#f6edbd]">Decisions <span className="ml-1 rounded-full bg-[#d7fa81] px-2 py-0.5 text-xs text-[#16241b]">{decisionCount.toLocaleString()}</span></span>
              {!feedExpanded && <span className="mt-1 block truncate text-xs text-[#b3c7b5]">{feed[0] ? `${feed[0].name ? `${feed[0].name}: ` : ''}${feed[0].action}` : adminMode ? 'Simulation controls' : 'Making plans…'}</span>}</span>
            <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#496654] text-xl text-[#d7fa81]">{feedExpanded ? '⌄' : '⌃'}</span>
          </button>
          <div id="decision-sheet-content" className="decision-sheet-content min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-3 lg:flex lg:pt-3">
          {adminMode && <><div className="flex shrink-0 gap-2">
            <button type="button" onClick={running ? pause : () => crowdDialog.current?.showModal()} className="flex-1 rounded-xl border border-[#efffb0] bg-[#d7fa81] px-4 py-3.5 text-base font-bold text-[#18281b] shadow-[0_3px_0_#6d8d43] transition hover:bg-[#e5ffab] active:translate-y-0.5 active:shadow-none">{running ? '⏸ Pause' : state.guests.length ? '▶ Resume' : '▶ Start simulation'}</button>
            {running && <button type="button" onClick={() => { pause(); crowdDialog.current?.showModal(); }} title="Options" aria-label="Options" className="rounded-xl border border-[#63816d] bg-[#294435] px-4 text-xl">⚙</button>}
          </div>
          {(running || state.guests.length > 0) && <button type="button" onClick={() => radioDialog.current?.showModal()}
            className="shrink-0 rounded-xl border-2 border-[#e79058] bg-[#efac70] px-4 py-2.5 text-left text-[#2c1e1d] shadow-[3px_3px_0_#563729] hover:bg-[#ffc58b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffe374]">
            <span className="block text-lg font-bold">📣 Announce →</span>
          </button>}
          <dialog ref={radioDialog} aria-labelledby="radio-title" onClick={event => { if (event.target === radioDialog.current) radioDialog.current.close(); }}
            className="max-h-[90dvh] w-[min(92vw,450px)] overflow-y-auto rounded-2xl border-2 border-[#e79058] bg-[#efac70] p-0 text-[#2c1e1d] shadow-2xl backdrop:bg-[#071210b8]">
          <section className="p-5" aria-label="Park-wide announcement">
            <button type="button" onClick={() => radioDialog.current?.close()} aria-label="Close park radio" className="float-right text-2xl leading-none">×</button>
            <div className="flex items-start justify-between gap-2"><div><p className="text-[11px] font-black uppercase tracking-[.18em]">📣 Park radio</p>
              <h2 id="radio-title" className="mt-1 text-xl font-black leading-tight">Make a scene.</h2></div></div>
            <p className="mt-2 text-xs leading-snug">One announcement reaches everyone. Each guest chooses whether to change plans.</p>
            <div className="mt-3 flex flex-wrap gap-1.5">{ANNOUNCEMENTS.map((preset, index) => <button key={preset} type="button" onClick={() => setAnnouncementDraft(preset)}
              className="rounded-full border border-[#78452d] bg-[#ffe0ae] px-2.5 py-1 text-[11px] font-bold hover:bg-[#fff0cc]">{['🌭 Free hot dogs', '🎉 Parade', '⛲ Fountain show', '🎆 Fireworks'][index]}</button>)}</div>
            <label htmlFor="park-announcement" className="mt-3 block text-[11px] font-black uppercase tracking-wide">Your announcement</label>
            <textarea id="park-announcement" value={announcementDraft} onChange={event => setAnnouncementDraft(event.target.value)} maxLength={160} rows={2}
              className="mt-1 w-full resize-none rounded-lg border border-[#915b39] bg-[#fff2d6] px-3 py-2 text-sm font-semibold text-[#30211d] outline-none focus:ring-2 focus:ring-[#462c26]" />
            <button type="button" onClick={broadcast} disabled={!running || !state.guests.length || !announcementDraft.trim() || announcement?.status === 'deciding'}
              className="mt-2 w-full rounded-lg bg-[#292120] px-3 py-2.5 text-sm font-black uppercase tracking-wide text-[#ffe374] hover:bg-[#44302a] disabled:cursor-not-allowed disabled:opacity-50">{announcement?.status === 'deciding' ? `Guests deciding ${announcement.processed}/${announcement.total}` : 'Broadcast to the whole park →'}</button>
            <p className="mt-2 text-[11px]">{running ? 'Guests choose whether to join.' : 'Start the simulation first.'}</p>
          </section>
          </dialog>
          <dialog ref={crowdDialog} aria-labelledby="crowd-title" onClick={event => { if (event.target === crowdDialog.current) crowdDialog.current.close(); }}
            className="simulation-options max-h-[90dvh] w-[min(92vw,480px)] overflow-y-auto rounded-2xl border-2 border-[#d7fa81] bg-[#1c2926] p-0 text-[#f5f2df] shadow-2xl backdrop:bg-[#071210b8]">
            <div className="flex items-center justify-between border-b border-[#496055] px-6 py-5"><h2 id="crowd-title" className="text-2xl font-bold text-[#e5f4b8]">Simulation options</h2>
              <button type="button" onClick={() => crowdDialog.current?.close()} aria-label="Close crowd settings" className="text-2xl leading-none">×</button></div>
          <div className="space-y-6 p-6 sm:p-7">
            <fieldset><legend className="mb-2 text-sm font-bold text-[#c7d7ba]">Decisions</legend><div className="grid grid-cols-2 gap-2">{(['code', 'jev'] as const).map(value => <button key={value} type="button" onClick={() => setDecisionMode(value)} aria-pressed={decisionMode === value}
              className={`rounded-xl border px-4 py-3 font-bold ${decisionMode === value ? 'border-[#d7fa81] bg-[#d7fa81] text-[#18281b]' : 'border-[#526b59] bg-[#294034] text-[#e4ead9]'}`}>{value === 'jev' ? 'Jev' : 'Deterministic'}</button>)}</div></fieldset>
            <fieldset><legend className="text-sm font-bold text-[#c7d7ba]">Crowd</legend>
            <div className="flex gap-1.5 mt-3">{PRESETS.map(preset => <button key={preset} type="button"
              className={`flex-1 rounded-full py-2 text-sm font-bold ${population === preset ? 'bg-[#d7fa81] text-[#13231b]' : 'bg-[#294034] text-[#d2e3c5] hover:bg-[#3c5745]'}`} onClick={() => { setPopulation(preset); setTarget(Math.min(preset, 1000)); }}>{preset >= 1000 ? `${preset / 1000}k` : preset}</button>)}</div>
            <p className="mt-2 text-xs text-[#aebfa8]">{target.toLocaleString()} individual guests{population > target ? ` · ${(population - target).toLocaleString()} background visitors` : ''}</p></fieldset>
            <label className="block text-sm font-bold text-[#c7d7ba]">Decision interval
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-[#526b59] bg-[#14291e] px-4 focus-within:ring-2 focus-within:ring-[#d7fa81]"><input aria-label="Decision interval in milliseconds" type="number" min="100" max="60000" step="100" value={decisionIntervalMs} onChange={event => setDecisionIntervalMs(Math.max(100, Math.min(60000, Number(event.target.value) || 100)))} className="min-w-0 w-full py-3.5 text-lg text-[#f0f5df]" /><span>ms</span></div>
              <span className="mt-2 block text-xs font-normal text-[#aebfa8]">Between batches · Jev response time varies</span></label>
            {decisionMode === 'jev' && <label className="block text-sm font-bold text-[#c7d7ba]">Jev budget <span title="Estimated per browser session. Use a Gateway key budget for an account-wide limit." className="cursor-help">ⓘ</span>
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-[#526b59] bg-[#14291e] px-4 focus-within:ring-2 focus-within:ring-[#d7fa81]"><span>$</span><input aria-label="Jev budget in dollars" type="number" min="0.01" max="100" step="0.1" value={budget} onChange={event => setBudget(Math.max(.01, Math.min(100, Number(event.target.value) || .01)))} className="min-w-0 w-full py-3.5 text-lg text-[#f0f5df]" /></div>
              <span className="mt-2 block text-xs font-normal leading-relaxed text-[#aebfa8]">Spent ${jevSpent.toFixed(4)} · Code continues at the limit</span></label>}
            <button type="button" onClick={start} className="w-full rounded-xl bg-[#d7fa81] py-3.5 text-base font-bold text-[#18281b] shadow-[0_3px_0_#6d8d43] hover:bg-[#e5ffab]">{state.guests.length ? 'Resume' : 'Start simulation'} →</button>
            {state.guests.length > 0 && <button type="button" onClick={reset} className="w-full text-sm text-[#bfceaf] underline">Reset park</button>}
          </div>
          </dialog>
          </>}
          {adminMode && error && <p role="alert" className="shrink-0 rounded-md bg-[#562b28] px-3 py-2 text-sm text-[#ffded9]">{error}</p>}
          <div className="flex min-h-0 flex-1 flex-col border-t border-[#345046] pt-3"><div className="flex shrink-0 items-center justify-between gap-2"><h2 className="text-base font-black text-[#f6edbd]">🎬 Decisions</h2>
              <span className="rounded-full bg-[#d7fa81] px-2.5 py-0.5 text-sm font-black text-[#16241b]" aria-label={`${decisionCount} total decisions`}>{decisionCount.toLocaleString()}</span></div>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1 pt-2" aria-label="Decision feed">{feed.length === 0 && <p className="text-sm text-[#90aaa1]">{adminMode ? 'Start the park to watch guest choices.' : 'Making plans…'}</p>}
              {feed.map((entry, index) => {
                const canFollow = !!entry.guestId && state.guests.some(guest => guest.id === entry.guestId);
                return <article key={entry.id} style={{ opacity: Math.max(.55, 1 - index * .025) }}
                  className="decision-message flex w-full items-center gap-3 rounded-xl border border-[#446252] bg-[#223633] px-3 py-3 text-left text-sm text-[#edf1db]">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#142c23] text-xl">{entry.mode === 'broadcast' ? '📣' : entry.guestId ? actionIcon[entry.kind ?? 'wait'] : '🎟️'}</span>
                  <span className="min-w-0 flex-1">{entry.name && <span className="mb-1 block text-xs font-bold text-[#d7fa81]">{entry.name}</span>}<span className="block font-semibold">{entry.action}</span>
                    {entry.mode === 'live' && entry.probability != null && Number.isFinite(entry.probability) && <span title="Probability Jev assigned to this choice. This is not a written explanation." className="mt-1 inline-flex rounded-full border border-[#496956] px-2 py-0.5 text-[11px] text-[#bad0bd]">Jev · {Math.round(entry.probability * 100)}%</span>}
                    {isCurrentRadioReaction(entry.radio, announcement, showAnnouncement) && <span title={entry.radio?.text} className="mt-1.5 inline-flex rounded-full border border-[#c6a760] bg-[#4b4024] px-2 py-0.5 text-[11px] text-[#ffdfa2]">📣 Radio</span>}
                    {(!canFollow || !entry.guestId) && <span className="mt-1.5 inline-flex rounded-full border border-[#567264] bg-[#183129] px-2 py-0.5 text-[11px] text-[#cce4ce]">{entry.mode === 'broadcast' ? 'Broadcast' : entry.guestId ? 'Departed' : 'Manager'}</span>}</span>
                  {canFollow && <button type="button" onClick={() => entry.guestId && focusGuest(entry.guestId, 1.8)} title="Follow guest" aria-label="Follow guest"
                    className="grid h-11 w-11 lg:h-9 lg:w-9 shrink-0 place-items-center rounded-full border border-[#6a8a71] bg-[#31543b] text-lg text-[#e7ffc4] transition-colors hover:bg-[#507547] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffe374]">↗</button>}
                </article>;
              })}</div></div>
          <div className="shrink-0 border-t border-[#264541] pt-2 text-xs text-[#91aaa2]">Based on <a href="https://github.com/amilich/isometric-city" className="underline">IsoCoaster</a></div>
          </div>
        </aside>
      </div>
    </main>
  );
}

export default function JevassicGame(options: GameOptions) {
  return <CoasterProvider showcaseOnly><Park {...options} /></CoasterProvider>;
}
