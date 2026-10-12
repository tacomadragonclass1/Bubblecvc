// -------------------------------------------------------------------- physics
// Hand-rolled, not cannon/rapier. The behaviour wanted here is specific and
// mostly non-physical - dice get MAGNETISED toward their target as they near it
// - and that is far easier to tune directly than to coax out of a solver. It
// also keeps the vendor payload to three.js alone.
//
// The feel the spec asks for, in order of importance:
//   * A weak flick falls short and comes home. Failure is gentle, never a buzz.
//   * Aim matters A LITTLE. You must throw up and roughly inward, but you do
//     not have to hit the bubble - the capture zone is generous and there is a
//     magnet inside it. A five-year-old's aim on a 75" panel is not precise.
//   * A hard, wild throw ricochets off the walls, and a ricochet that happens
//     to come back through the cluster SHOULD score. That accident is the most
//     delightful thing in the game and it must not be designed away.

import * as THREE from '../vendor/three.module.js';

export const GRAVITY = -17.0;
const DRAG = 0.42;            // per second, velocity-proportional
const RESTITUTION = 0.74;     // wall bounciness
const MAX_FLIGHT = 7.0;       // seconds before we give up and send it home
const MAX_SPEED = 46;

// Below this upward speed the throw is treated as a drop, not a flick, and the
// die simply settles back. Keeps a clumsy drag from launching anything.
export const MIN_LAUNCH_SPEED = 7.5;

// Magnet: inside this multiple of the capture radius the die is pulled toward
// the target. This is the whole "aim matters a little" dial.
const MAGNET_RANGE = 3.4;
const MAGNET_FORCE = 54;

export function launch(die, vx, vy) {
  const u = die.userData;
  const speed = Math.hypot(vx, vy);
  const k = speed > MAX_SPEED ? MAX_SPEED / speed : 1;
  u.vel = new THREE.Vector3(vx * k, vy * k, 0);
  u.state = 'flying';
  u.flightT = 0;
  u.wobbleScale = 1.35;      // a touch livelier in the air, still clamped
  u.bounces = 0;
  return Math.min(1, speed / 26);
}

/**
 * Advance one flying die.
 * @returns null | {type:'captured', bubble} | {type:'missed'} | {type:'wall', speed}
 */
export function stepFlight(die, dt, ctx) {
  const { bounds, bayTop, bubbles, targetSlot } = ctx;
  const u = die.userData;
  const p = die.position;
  const v = u.vel;

  u.flightT += dt;

  // Magnet toward the slot this letter is destined for. Only the target slot
  // pulls - a `c` drifting past the vowel bubble must not be swallowed by it.
  const target = bubbles.find(b => b.index === targetSlot && !b.die && b.popping <= 0);
  let event = null;

  if (target) {
    const tx = target.mesh.position.x, ty = target.mesh.position.y;
    const dx = tx - p.x, dy = ty - p.y;
    const dist = Math.hypot(dx, dy);
    const range = target.captureR * MAGNET_RANGE;

    if (dist < range) {
      // Falls off with distance, so a die skimming the edge of the zone gets a
      // nudge while one heading straight in gets scooped.
      const pull = MAGNET_FORCE * (1 - dist / range) ** 1.6;
      v.x += (dx / (dist || 1)) * pull * dt;
      v.y += (dy / (dist || 1)) * pull * dt;
    }

    if (dist < target.captureR) {
      return { type: 'captured', bubble: target };
    }
  }

  // Integrate. Semi-implicit Euler is plenty at these speeds and is stable.
  v.y += GRAVITY * dt;
  v.multiplyScalar(Math.max(0, 1 - DRAG * dt));
  p.x += v.x * dt;
  p.y += v.y * dt;

  // Walls. The play box is the visible area; the top is a lid so a monster
  // flick comes back down into play rather than sailing away forever.
  const half = 0.5;
  if (p.x < -bounds.x + half && v.x < 0) {
    p.x = -bounds.x + half; v.x = -v.x * RESTITUTION; u.bounces++;
    event = { type: 'wall', speed: Math.abs(v.x) };
  } else if (p.x > bounds.x - half && v.x > 0) {
    p.x = bounds.x - half; v.x = -v.x * RESTITUTION; u.bounces++;
    event = { type: 'wall', speed: Math.abs(v.x) };
  }
  if (p.y > bounds.y - half && v.y > 0) {
    p.y = bounds.y - half; v.y = -v.y * RESTITUTION; u.bounces++;
    event = { type: 'wall', speed: Math.abs(v.y) };
  }

  // Fell back to the bay, or ran out of patience.
  if ((p.y < bayTop && v.y < 0) || u.flightT > MAX_FLIGHT) {
    return { type: 'missed' };
  }
  return event;
}

/** Begin the trip home. Eased, and slow enough to watch - it is not a punishment. */
export function sendHome(die) {
  const u = die.userData;
  u.state = 'returning';
  u.returnT = 0;
  u.returnFrom = die.position.clone();
  u.returnDur = 0.42 + Math.min(0.3, die.position.distanceTo(u.home) * 0.012);
  u.wobbleScale = 1;
  u.vel = null;
}

export function stepReturn(die, dt) {
  const u = die.userData;
  u.returnT += dt;
  const k = Math.min(1, u.returnT / u.returnDur);
  // easeOutBack, very mild: a small overshoot reads as the die dropping into
  // its slot rather than sliding to a stop.
  const c1 = 1.18, c3 = c1 + 1;
  const e = 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2;
  die.position.lerpVectors(u.returnFrom, u.home, e);
  if (k >= 1) {
    die.position.copy(u.home);
    u.state = 'bay';
    return true;
  }
  return false;
}

/** Suck-in animation once a bubble has claimed a die. */
export function startCapture(die, bubble) {
  const u = die.userData;
  u.state = 'capturing';
  u.capT = 0;
  u.capFrom = die.position.clone();
  u.capBubble = bubble;
  u.vel = null;
}

export function stepCapture(die, dt) {
  const u = die.userData;
  u.capT += dt;
  const k = Math.min(1, u.capT / 0.26);
  const e = 1 - (1 - k) ** 3;
  const b = u.capBubble;
  die.position.lerpVectors(u.capFrom, new THREE.Vector3(b.mesh.position.x, b.mesh.position.y, 0.08), e);
  // Shrink a hair on the way in, then settle - reads as passing through a film.
  const s = 1 - Math.sin(k * Math.PI) * 0.16;
  die.scale.setScalar(s);
  u.wobbleScale = 1 - e;
  if (k >= 1) {
    die.scale.setScalar(1);
    return true;
  }
  return false;
}

/**
 * Turn a pointer gesture into a launch velocity. Samples are {x, y, t} in world
 * units and seconds; we use only the tail of the gesture so a slow drag that
 * ends in a quick snap still reads as a flick.
 */
export function velocityFromGesture(samples, now) {
  if (samples.length < 2) return { vx: 0, vy: 0 };
  const WINDOW = 0.09;
  let i = samples.length - 1;
  while (i > 0 && now - samples[i].t < WINDOW) i--;
  const a = samples[i], b = samples[samples.length - 1];
  const dt = Math.max(1e-3, b.t - a.t);
  // Gain: a finger flick across a 75" panel covers a lot of world units, but a
  // mouse flick covers few. The multiplier keeps both feeling throwable.
  const GAIN = 1.25;
  return { vx: ((b.x - a.x) / dt) * GAIN, vy: ((b.y - a.y) / dt) * GAIN };
}
