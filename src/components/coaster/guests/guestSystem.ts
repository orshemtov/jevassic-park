import { guestVisualOffset } from '@/lib/jev/spectatorMotion';
/**
 * Guest System for IsoCoaster
 * Handles guest spawning, AI, pathfinding, and rendering
 */

import { Guest, GuestState, DEFAULT_PRICES, generateGuestName } from '@/games/coaster/types/economy';
import { Tile } from '@/games/coaster/types/game';

// =============================================================================
// CONSTANTS
// =============================================================================

const TILE_WIDTH = 64;
const HEIGHT_RATIO = 0.60;
const TILE_HEIGHT = TILE_WIDTH * HEIGHT_RATIO;

const GUEST_COLORS = {
  skin: ['#ffd5b4', '#f5c9a6', '#e5b898', '#d4a574', '#c49462', '#a67b5b', '#8b6b4a'],
  shirt: ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#f43f5e'],
  pants: ['#1e293b', '#475569', '#64748b', '#0f172a', '#1e3a5a', '#422006'],
  hat: ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ffffff'],
};

// =============================================================================
// GUEST CREATION
// =============================================================================

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function randomFromArray<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function createGuest(entranceX: number, entranceY: number, gridSize: number = 64): Guest {
  // Determine which edge the guest is entering from and set target direction
  // The guest should walk INTO the park (away from the edge)
  let targetX = entranceX;
  let targetY = entranceY;
  let direction: 'north' | 'south' | 'east' | 'west' = 'south';
  
  if (entranceX === 0) {
    // North edge (x=0) - walk toward south (x+1)
    targetX = entranceX + 1;
    direction = 'south';
  } else if (entranceX === gridSize - 1) {
    // South edge (x=max) - walk toward north (x-1)
    targetX = entranceX - 1;
    direction = 'north';
  } else if (entranceY === 0) {
    // East edge (y=0) - walk toward west (y+1)
    targetY = entranceY + 1;
    direction = 'west';
  } else if (entranceY === gridSize - 1) {
    // West edge (y=max) - walk toward east (y-1)
    targetY = entranceY - 1;
    direction = 'east';
  } else {
    // Fallback for non-edge spawns (shouldn't happen with new spawn logic)
    targetY = entranceY + 1;
    direction = 'south';
  }
  
  return {
    id: generateUUID(),
    name: generateGuestName(),
    
    // Position
    tileX: entranceX,
    tileY: entranceY,
    progress: 0,
    direction,
    
    // State
    state: 'entering' as GuestState,
    lastState: 'entering' as GuestState,
    targetBuildingId: null,
    targetBuildingKind: null,
    targetPurchaseKind: null,
    targetTileX: targetX,
    targetTileY: targetY,
    path: [],
    pathIndex: 0,
    
    // Queue
    queueRideId: null,
    queuePosition: 0,
    queueTimer: 0,
    decisionCooldown: 0,
    
    // Approach state
    approachProgress: 0,
    initialActivityTime: 0,
    activityStartTime: 0,
    
    // Needs (0-100)
    hunger: 10 + Math.random() * 50,
    thirst: 10 + Math.random() * 50,
    bathroom: 5 + Math.random() * 30,
    energy: 55 + Math.random() * 45,
    happiness: 70 + Math.random() * 30,
    nausea: 0,
    
    // Preferences (0-10)
    preferExcitement: 3 + Math.random() * 7,
    preferIntensity: 2 + Math.random() * 6,
    nauseaTolerance: 3 + Math.random() * 7,
    
    // Money
    cash: 80 + Math.floor(Math.random() * 101),
    totalSpent: 0,
    
    // Tracking
    ridesRidden: [],
    thoughts: [],
    timeInPark: 0,
    
    // Visual
    skinColor: randomFromArray(GUEST_COLORS.skin),
    shirtColor: randomFromArray(GUEST_COLORS.shirt),
    pantsColor: randomFromArray(GUEST_COLORS.pants),
    hasHat: Math.random() > 0.7,
    hatColor: randomFromArray(GUEST_COLORS.hat),
    walkOffset: Math.random() * Math.PI * 2,
  };
}

// =============================================================================
// GUEST RENDERING
// =============================================================================

function gridToScreen(gridX: number, gridY: number): { x: number; y: number } {
  const x = (gridX - gridY) * (TILE_WIDTH / 2);
  const y = (gridX + gridY) * (TILE_HEIGHT / 2);
  return { x, y };
}

export function drawGuest(
  ctx: CanvasRenderingContext2D,
  guest: Guest,
  tick: number
) {
  if (guest.state === 'riding') return;
  // Calculate interpolated position
  let { x: startX, y: startY } = gridToScreen(guest.tileX, guest.tileY);
  const { x: endX, y: endY } = gridToScreen(guest.targetTileX, guest.targetTileY);
  
  // For entering guests, offset start position toward outside the map (through the gate)
  // This makes them visually appear to walk in from outside
  if (guest.state === 'entering' && guest.progress < 0.5) {
    // Determine which edge they're entering from based on tile position
    // Offset toward the edge by extending the start position outward
    const offsetAmount = TILE_WIDTH * 0.6;
    
    // Calculate direction from target back to start (the direction they're coming from)
    const dx = startX - endX;
    const dy = startY - endY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist > 0) {
      // Extend start position outward (beyond the tile edge)
      startX += (dx / dist) * offsetAmount;
      startY += (dy / dist) * offsetAmount;
    }
  }
  
  let x = startX + (endX - startX) * guest.progress + TILE_WIDTH / 2;
  let y = startY + (endY - startY) * guest.progress + TILE_HEIGHT / 2;
  
  // When eating, shopping, or exiting building - animate position
  // Use real time for smooth animation independent of game tick rate
  if ((guest.state === 'shopping' || (guest.state === 'exiting_building' && (!guest.targetPurchaseKind || guest.targetPurchaseKind === 'restroom'))) && guest.targetBuildingId) {
    const parts = guest.targetBuildingId.split(',');
    if (parts.length === 2) {
      const buildingX = parseInt(parts[0], 10);
      const buildingY = parseInt(parts[1], 10);
      
      if (!isNaN(buildingX) && !isNaN(buildingY)) {
        const { x: pathX, y: pathY } = gridToScreen(guest.tileX, guest.tileY);
        const { x: buildingScreenX, y: buildingScreenY } = gridToScreen(buildingX, buildingY);
        
        // Path center and building center
        const pathCenterX = pathX + TILE_WIDTH / 2;
        const pathCenterY = pathY + TILE_HEIGHT / 2;
        const buildingCenterX = buildingScreenX + TILE_WIDTH / 2;
        const buildingCenterY = buildingScreenY + TILE_HEIGHT / 2;
        
        const walkDurationMs = 800;
        // If activityStartTime is 0 or undefined, treat as just started
        const now = Date.now();
        const startTime = guest.activityStartTime && guest.activityStartTime > 0 ? guest.activityStartTime : now;
        const elapsedMs = now - startTime;
        
        let progress: number;
        
        if (guest.state === 'exiting_building') {
          // Walking out: 1 -> 0 over 800ms
          progress = Math.max(0, 1 - elapsedMs / walkDurationMs);
        } else {
          // Walking in: 0 -> 1 over 800ms, then stay at 1
          progress = Math.min(1, elapsedMs / walkDurationMs);
        }
        
        // Apply easing for smoother movement
        const easedProgress = progress < 0.5 
          ? 2 * progress * progress 
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        
        // Walk from path center toward building center
        x = pathCenterX + (buildingCenterX - pathCenterX) * easedProgress;
        y = pathCenterY + (buildingCenterY - pathCenterY) * easedProgress;
      }
    }
  }

  const correction = guestVisualOffset(guest);
  x += correction.x; y += correction.y;

  // Stable spacing keeps large crowds visible instead of stacking every guest on one pixel.
  x += Math.cos(guest.walkOffset * 5) * (TILE_WIDTH * 0.18);
  y += Math.sin(guest.walkOffset * 7) * (TILE_HEIGHT * 0.12);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1.7, 1.7);
  x = 0;
  y = 0;
  
  // Walking animation
  const moving = guest.tileX !== guest.targetTileX || guest.tileY !== guest.targetTileY;
  const walkCycle = moving ? Math.sin((tick * 0.2 + guest.walkOffset) * 2) : 0;
  const bobY = Math.abs(walkCycle) * 0.5;
  
  // Draw shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.beginPath();
  ctx.ellipse(x + .3, y + 0.5, 1.6, 0.7, -.2, 0, Math.PI * 2);
  ctx.fill();
  
  // Draw body (simple sprite-like representation) - scaled to 25% of original
  const guestY = y - 3 - bobY;
  
  // Pants/legs
  ctx.fillStyle = guest.pantsColor;
  ctx.fillRect(x - .8 - walkCycle * .35, guestY + 1.5, .65, 1.5 + walkCycle * .25);
  ctx.fillRect(x + .2 + walkCycle * .35, guestY + 1.5, .65, 1.5 - walkCycle * .25);
  ctx.fillStyle = '#25272c';
  ctx.fillRect(x - .9 - walkCycle * .35, guestY + 2.8 + walkCycle * .25, .9, .4);
  ctx.fillRect(x + .15 + walkCycle * .35, guestY + 2.8 - walkCycle * .25, .9, .4);
  
  // Torso
  ctx.fillStyle = guest.shirtColor;
  ctx.fillRect(x - 1, guestY - 0.5, 2, 2);
  
  // Head
  ctx.fillStyle = guest.skinColor;
  ctx.beginPath();
  ctx.arc(x, guestY - 1.5, 1, 0, Math.PI * 2);
  ctx.fill();
  
  // A stable haircut gives bare-headed guests a distinct silhouette.
  ctx.fillStyle = ['#40302b', '#865b38', '#d2ac67'][Math.floor(guest.walkOffset * 10) % 3];
  ctx.fillRect(x - 1, guestY - 2.35, 2, .65);
  ctx.fillRect(x - 1, guestY - 2, .45, .9);
  // Hat
  if (guest.hasHat) {
    ctx.fillStyle = guest.hatColor;
    ctx.fillRect(x - 1.25, guestY - 2.75, 2.5, 0.75);
    ctx.fillRect(x - 0.75, guestY - 3.5, 1.5, 0.75);
  }
  
  // Arms (animated)
  const armSwing = walkCycle * 0.75;
  ctx.fillStyle = guest.shirtColor;
  ctx.fillRect(x - 1.5, guestY + armSwing, 0.5, 1.25);
  ctx.fillRect(x + 1, guestY - armSwing, 0.5, 1.25);
  ctx.fillStyle = guest.skinColor;
  ctx.fillRect(x - 1.5, guestY + armSwing + 1, .5, .5);
  ctx.fillRect(x + 1, guestY - armSwing + 1, .5, .5);
  if (guest.state === 'eating') {
    const bite = (Math.sin(tick * .12 + guest.walkOffset) + 1) / 2;
    ctx.fillStyle = guest.skinColor;
    ctx.fillRect(x + 1, guestY - bite * 1.5, 1, .5);
    const handY = guestY - bite * 1.5;
    if (guest.targetPurchaseKind === 'drink') {
      ctx.fillStyle = '#79d7eb'; ctx.fillRect(x + 1.5, handY - .5, 1.1, 1.5);
      ctx.fillStyle = '#fff0d5'; ctx.fillRect(x + 1.4, handY - .65, 1.3, .3);
      ctx.fillStyle = '#f3a2a0'; ctx.fillRect(x + 2, handY - 1.25, .25, 1);
    } else {
      ctx.fillStyle = '#e5b565'; ctx.fillRect(x + 1.2, handY - .45, 2, .8);
      ctx.fillStyle = '#a94d35'; ctx.fillRect(x + 1.3, handY - .35, 1.8, .3);
      ctx.fillStyle = '#f7dc58'; ctx.fillRect(x + 1.65, handY - .4, .6, .2);
    }
  }
  ctx.restore();
}

// Guest activity is selected by Jev; this module only advances movement and needs.

/**
 * Update guest state and position
 */
export function updateGuest(
  guest: Guest,
  grid: Tile[][],
  deltaTime: number
): Guest {
  const updatedGuest = { ...guest };
  const previousState = updatedGuest.state;
  
  // Update time in park
  updatedGuest.timeInPark += deltaTime;
  
  // Update needs over time
  updatedGuest.hunger = Math.min(100, updatedGuest.hunger + deltaTime * 0.01);
  updatedGuest.thirst = Math.min(100, updatedGuest.thirst + deltaTime * 0.015);
  updatedGuest.bathroom = Math.min(100, updatedGuest.bathroom + deltaTime * 0.008);
  updatedGuest.energy = Math.max(0, updatedGuest.energy - deltaTime * 0.005);
  
  // Update happiness based on needs
  let happinessChange = 0;
  if (updatedGuest.hunger > 70) happinessChange -= 0.002;
  if (updatedGuest.thirst > 70) happinessChange -= 0.003;
  if (updatedGuest.bathroom > 80) happinessChange -= 0.004;
  if (updatedGuest.nausea > 50) happinessChange -= 0.002;
  
  updatedGuest.happiness = Math.max(0, Math.min(100, updatedGuest.happiness + happinessChange * deltaTime));
  
  // Reduce nausea over time
  updatedGuest.nausea = Math.max(0, updatedGuest.nausea - deltaTime * 0.02);

  // Decision cooldown
  updatedGuest.decisionCooldown = Math.max(0, updatedGuest.decisionCooldown - deltaTime);

  if (updatedGuest.state === 'walking' && updatedGuest.path.length === 0 && !updatedGuest.targetBuildingId) {
    // Waiting for a decision is downtime, not a walk that exhausts the whole crowd.
    const resting = updatedGuest.decisionCooldown > 0;
    updatedGuest.energy = Math.min(100, updatedGuest.energy + deltaTime * (resting ? .12 : .03));
    if (resting) {
      updatedGuest.nausea = Math.max(0, updatedGuest.nausea - deltaTime * .08);
      updatedGuest.happiness = Math.min(100, updatedGuest.happiness + deltaTime * .005);
    }
  }

  // Handle queuing/riding
  if (updatedGuest.state === 'queuing' || updatedGuest.state === 'riding') {
    updatedGuest.queueTimer -= deltaTime;
    if (updatedGuest.queueTimer <= 0) {
      if (updatedGuest.state === 'queuing') {
        updatedGuest.state = 'riding';
        updatedGuest.queueTimer = 180 + Math.random() * 100;
        updatedGuest.happiness = Math.min(100, updatedGuest.happiness + 8);
      } else {
        updatedGuest.state = 'walking';
        if (updatedGuest.queueRideId) {
          updatedGuest.ridesRidden.push(updatedGuest.queueRideId);
        }
        updatedGuest.queueRideId = null;
        updatedGuest.targetBuildingId = null;
        updatedGuest.targetBuildingKind = null;
        updatedGuest.queueTimer = 0;
        updatedGuest.nausea = Math.min(100, updatedGuest.nausea + 5 + Math.random() * 5);
      }
    }
    updatedGuest.lastState = previousState;
    return updatedGuest;
  }

  if (updatedGuest.state === 'eating' || updatedGuest.state === 'shopping') {
    updatedGuest.queueTimer -= deltaTime;
    
    // Initialize fields if not set
    if (updatedGuest.approachProgress === undefined) {
      updatedGuest.approachProgress = 0;
    }
    if (updatedGuest.initialActivityTime === undefined || updatedGuest.initialActivityTime <= 0) {
      updatedGuest.initialActivityTime = updatedGuest.queueTimer + 1;
    }
    
    // Proportional walk animation: first 15% of time walking in, last 15% walking out
    const totalTime = updatedGuest.initialActivityTime;
    const elapsed = totalTime - updatedGuest.queueTimer;
    const remaining = updatedGuest.queueTimer;
    const walkFraction = 0.15; // 15% of activity time for walk in/out
    const walkTime = Math.max(3, totalTime * walkFraction); // At least 3 game minutes
    
    if (elapsed < walkTime) {
      // Walking in (0 -> 1)
      updatedGuest.approachProgress = elapsed / walkTime;
    } else if (remaining < walkTime && remaining > 0) {
      // Walking out (1 -> 0)
      updatedGuest.approachProgress = remaining / walkTime;
    } else if (remaining <= 0) {
      // Done - back at path
      updatedGuest.approachProgress = 0;
    } else {
      // Inside building
      updatedGuest.approachProgress = 1;
    }
    
    if (updatedGuest.queueTimer <= 0) {
      if (updatedGuest.state === 'eating') {
        updatedGuest.hunger = Math.max(0, updatedGuest.hunger - (updatedGuest.targetPurchaseKind === 'drink' ? 5 : 60));
        updatedGuest.thirst = Math.max(0, updatedGuest.thirst - (updatedGuest.targetPurchaseKind === 'drink' ? 65 : 15));
        updatedGuest.happiness = Math.min(100, updatedGuest.happiness + 6);
      } else if (updatedGuest.targetPurchaseKind === 'restroom') {
        updatedGuest.bathroom = 0;
        updatedGuest.happiness = Math.min(100, updatedGuest.happiness + 5);
      } else {
        updatedGuest.happiness = Math.min(100, updatedGuest.happiness + 4);
      }
      // Transition to exiting_building for walk-out animation
      updatedGuest.state = 'exiting_building';
      updatedGuest.activityStartTime = Date.now(); // Reset for exit animation
      updatedGuest.queueTimer = 0;
      updatedGuest.approachProgress = 1; // Start at building
    }
    updatedGuest.lastState = previousState;
    return updatedGuest;
  }
  
  // Handle exiting_building state (walk-out animation)
  if (updatedGuest.state === 'exiting_building') {
    const exitDuration = 800; // 800ms to walk out
    const elapsed = Date.now() - (updatedGuest.activityStartTime || Date.now());
    
    if (elapsed >= exitDuration) {
      // Exit animation complete, now walking
      updatedGuest.state = 'walking';
      updatedGuest.targetBuildingId = null;
      updatedGuest.targetBuildingKind = null;
      updatedGuest.targetPurchaseKind = null;
      updatedGuest.approachProgress = 0;
      updatedGuest.initialActivityTime = 0;
      updatedGuest.activityStartTime = 0;
    }
    updatedGuest.lastState = previousState;
    return updatedGuest;
  }

  // Idle guests wait here until Jev supplies a legal action.
  if (updatedGuest.state === 'walking' && updatedGuest.path.length === 0 && !updatedGuest.targetBuildingId) {
    updatedGuest.targetTileX = updatedGuest.tileX;
    updatedGuest.targetTileY = updatedGuest.tileY;
    updatedGuest.progress = 0;
    updatedGuest.lastState = previousState;
    return updatedGuest;
  }
  
  // Movement
  if (updatedGuest.state === 'walking' || updatedGuest.state === 'entering' || updatedGuest.state === 'leaving') {
    const speed = 0.02; // Progress per tick
    updatedGuest.progress += speed;
    
    if (updatedGuest.progress >= 1) {
      // Reached target tile
      updatedGuest.tileX = updatedGuest.targetTileX;
      updatedGuest.tileY = updatedGuest.targetTileY;
      updatedGuest.progress = 0;
      
      // Get next waypoint from path
      if (updatedGuest.path.length > 0 && updatedGuest.pathIndex < updatedGuest.path.length) {
        const next = updatedGuest.path[updatedGuest.pathIndex];
        updatedGuest.targetTileX = next.x;
        updatedGuest.targetTileY = next.y;
        updatedGuest.pathIndex++;
        
        // Update direction
        const dx = next.x - updatedGuest.tileX;
        const dy = next.y - updatedGuest.tileY;
        if (dx > 0) updatedGuest.direction = 'south';
        else if (dx < 0) updatedGuest.direction = 'north';
        else if (dy > 0) updatedGuest.direction = 'west';
        else if (dy < 0) updatedGuest.direction = 'east';
      } else {
        // Path complete
        if (updatedGuest.targetBuildingKind) {
          if (updatedGuest.targetBuildingKind === 'ride') {
            updatedGuest.state = 'queuing';
            updatedGuest.queueTimer = 250 + Math.random() * 150;
            updatedGuest.queuePosition = 0;
            updatedGuest.path = [];
            updatedGuest.pathIndex = 0;
            updatedGuest.targetTileX = updatedGuest.tileX;
            updatedGuest.targetTileY = updatedGuest.tileY;
            updatedGuest.lastState = previousState;
            return updatedGuest;
          }
          if (updatedGuest.targetBuildingKind === 'food') {
            updatedGuest.state = 'eating';
            const activityTime = 180 + Math.random() * 100;
            updatedGuest.queueTimer = activityTime;
            updatedGuest.initialActivityTime = activityTime;
            updatedGuest.approachProgress = 0;
            updatedGuest.activityStartTime = Date.now();
            updatedGuest.path = [];
            updatedGuest.pathIndex = 0;
            updatedGuest.lastState = previousState;
            return updatedGuest;
          }
          if (updatedGuest.targetBuildingKind === 'shop') {
            updatedGuest.state = 'shopping';
            const activityTime = 180 + Math.random() * 100;
            updatedGuest.queueTimer = activityTime;
            updatedGuest.initialActivityTime = activityTime;
            updatedGuest.approachProgress = 0;
            updatedGuest.activityStartTime = Date.now();
            updatedGuest.path = [];
            updatedGuest.pathIndex = 0;
            updatedGuest.lastState = previousState;
            return updatedGuest;
          }
        }
        
        // Wait at the decision boundary; no scripted wandering.
        if (updatedGuest.state !== 'leaving') updatedGuest.state = 'walking';
        updatedGuest.decisionCooldown = 0;
        updatedGuest.path = [];
        updatedGuest.pathIndex = 0;
        updatedGuest.targetTileX = updatedGuest.tileX;
        updatedGuest.targetTileY = updatedGuest.tileY;
      }
    }
  }
  
  updatedGuest.lastState = previousState;
  return updatedGuest;
}

export function chargeGuestForActivity(guest: Guest, payPerRide: boolean): {
  guest: Guest; category: 'ride' | 'food' | 'shop' | null; fee: number;
} {
  let category: 'ride' | 'food' | 'shop' | null = null;
  let price = 0;
  if (guest.state === 'riding' && guest.lastState === 'queuing' && payPerRide) {
    category = 'ride'; price = DEFAULT_PRICES.rideTicket;
  } else if (guest.state === 'eating' && guest.lastState !== 'eating') {
    category = 'food'; price = guest.freeHotdogVoucher ? 0 : guest.targetPurchaseKind === 'drink' ? DEFAULT_PRICES.drinkItem : DEFAULT_PRICES.foodItem;
  } else if (guest.state === 'shopping' && guest.lastState !== 'shopping' && guest.targetPurchaseKind !== 'restroom') {
    category = 'shop'; price = DEFAULT_PRICES.shopItem;
  }
  const fee = Math.min(guest.cash, price);
  return { guest: category === 'food' || fee ? { ...guest, freeHotdogVoucher: category === 'food' ? false : guest.freeHotdogVoucher,
    cash: guest.cash - fee, totalSpent: guest.totalSpent + fee } : guest,
    category, fee };
}
