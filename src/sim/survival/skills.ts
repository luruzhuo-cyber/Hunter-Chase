import { canHunterSee, hasLineOfSight } from './observation';
import { isTraversable, positionCell, reachableCells } from './pathing';
import { sampleTerrain } from './map';
import { normalize } from './types';
import type { ObservationModifiers, SensoryClue } from './observation';
import type { SkillId, Vec2 } from './types';
import type { SurvivalWorld, SurvivalWorldActor, SurvivalAction, SurvivalActions } from './world';

export type SkillEvent = { id: string; tick: number; actorId: string; type: 'effective-skill'; skill: SkillId; effectiveness: number };
export type SkillEffect = { actorId: string; skill: SkillId; createdTick: number; expiresTick: number; position: Vec2; direction: Vec2 };
export type SurvivalSkillState = { effects: SkillEffect[]; clues: SensoryClue[]; updatedTick: number };
export type SkillResult = { ok: true; event: SkillEvent } | { ok: false; reason: string };
export const createSkillState = (): SurvivalSkillState => ({ effects: [], clues: [], updatedTick: -1 });

const finite = (point: Vec2) => Number.isFinite(point.x) && Number.isFinite(point.y);
const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const direction = (actor: SurvivalWorldActor, intent: SurvivalAction): Vec2 => intent.skillTarget
  ? normalize({ x: intent.skillTarget.x - actor.kinematics.position.x, y: intent.skillTarget.y - actor.kinematics.position.y })
  : { x: Math.cos(actor.kinematics.heading), y: Math.sin(actor.kinematics.heading) };
const activeEffects = (world: SurvivalWorld) => world.skills.effects.filter(effect => effect.createdTick <= world.tick && effect.expiresTick > world.tick);
const effectFor = (world: SurvivalWorld, actor: SurvivalWorldActor, skill: SkillId) => activeEffects(world).find(effect => effect.actorId === actor.id && effect.skill === skill);

function phaseLanding(world: SurvivalWorld, actor: SurvivalWorldActor, intent: SurvivalAction): Vec2 | undefined {
  const from = actor.kinematics.position, heading = actor.kinematics.heading;
  const to = intent.skillTarget ?? { x: from.x + 2.5 * Math.cos(heading), y: from.y + 2.5 * Math.sin(heading) };
  const dx = to.x - from.x, dy = to.y - from.y, forward = dx * Math.cos(heading) + dy * Math.sin(heading);
  if (!finite(to) || !Number.isFinite(heading) || distance(from, to) > 2.5 + 1e-9 || forward <= 0
    || Math.abs(dx * Math.sin(heading) - dy * Math.cos(heading)) > 1e-6) return;
  const cell = positionCell(world.map, to);
  if (!isTraversable(world.map, cell, 'runner') || world.map.doors.some(door => door.lockedUntil > world.tick && positionCell(world.map, door.position) === cell)) return;
  // A phase may cross solid terrain, but may not strand the runner in an isolated pocket.
  if (!reachableCells(world.map, world.map.runnerSpawns[0]!, 'runner').has(cell)) return;
  let crossedWall = false;
  for (let t = 0; t <= 100; t++) {
    const terrain = sampleTerrain(world.map, { x: from.x + dx * t / 100, y: from.y + dy * t / 100 });
    if (terrain === 'wall' || terrain === 'shelf') crossedWall = true;
  }
  return crossedWall ? { ...to } : undefined;
}

function securityDoor(world: SurvivalWorld, actor: SurvivalWorldActor, intent: SurvivalAction) {
  return world.map.doors.find(door => door.id === intent.interact && door.kind === 'security'
    && door.lockedUntil < world.tick + 32
    && distance(actor.kinematics.position, door.position) <= 1.5
    && hasLineOfSight({ ...world.map, doors: world.map.doors.filter(other => other.id !== door.id) }, actor.kinematics.position, door.position, world.tick));
}

function invalidReason(world: SurvivalWorld, actor: SurvivalWorldActor, intent: SurvivalAction): string | undefined {
  if (world.phase !== 'running') return 'finished';
  if (!world.runners.includes(actor) || actor.kind !== 'runner' || !actor.active || !actor.skill) return 'unavailable';
  if (actor.skillUsed) return 'already-used';
  if (!finite(actor.kinematics.position) || !Number.isFinite(actor.kinematics.heading)) return 'invalid-intent';
  if (actor.skill === 'wall-phase') return phaseLanding(world, actor, intent) ? undefined : 'invalid-landing';
  if (intent.skillTarget && !finite(intent.skillTarget)) return 'invalid-intent';
  if (actor.skill === 'door-override' && !securityDoor(world, actor, intent)) return 'invalid-door';
  if (actor.skill === 'sound-projection' && distance(direction(actor, intent), { x: 0, y: 0 }) === 0) return 'invalid-direction';
  if (actor.skill === 'adrenaline' && (distance(actor.kinematics.position, world.hunter.kinematics.position) > 10
    || !canHunterSee(world.hunter, actor.kinematics.position, world.map, world.tick))) return 'no-direct-threat';
  return undefined;
}

/** Validation is read-only; rejected intents neither consume a skill nor emit an event. */
export function canUseSkill(world: SurvivalWorld, actor: SurvivalWorldActor, intent: SurvivalAction): boolean {
  return invalidReason(world, actor, intent) === undefined;
}

export function resolveSkill(world: SurvivalWorld, actor: SurvivalWorldActor, intent: SurvivalAction): SkillResult {
  const reason = invalidReason(world, actor, intent);
  if (reason) return { ok: false, reason };
  const skill = actor.skill!;
  const durations: Record<SkillId, number> = { beacon: 12, 'silent-step': 40, 'wall-phase': 1, 'door-override': 32,
    'sound-projection': 48, adrenaline: 24, scout: 20, 'danger-sense': world.maxTicks - world.tick + 1 };
  const effect: SkillEffect = { actorId: actor.id, skill, createdTick: world.tick, expiresTick: world.tick + durations[skill],
    position: { ...actor.kinematics.position }, direction: direction(actor, intent) };
  if (skill === 'wall-phase') {
    actor.kinematics.position = phaseLanding(world, actor, intent)!;
    actor.kinematics.velocity = { x: 0, y: 0 };
  } else if (skill === 'door-override') securityDoor(world, actor, intent)!.lockedUntil = effect.expiresTick;
  world.skills.effects.push(effect);
  actor.skillUsed = true;
  const event: SkillEvent = { id: `skill:${actor.id}:${world.tick}`, tick: world.tick, actorId: actor.id, type: 'effective-skill', skill, effectiveness: 1 };
  world.skillEvents.push(event);
  return { ok: true, event };
}

export function acousticStrength(world: SurvivalWorld, actor: SurvivalWorldActor, base: number): number {
  return Math.max(0, base) * (effectFor(world, actor, 'silent-step') ? .3 : 1);
}

export function skillSpeedMultiplier(world: SurvivalWorld, actor: SurvivalWorldActor): number {
  return effectFor(world, actor, 'adrenaline') ? 1.35 : 1;
}

export function skillObservationModifiers(world: SurvivalWorld, actor: SurvivalWorldActor): ObservationModifiers {
  const clues: SensoryClue[] = world.skills.clues.filter(clue => clue.expiresTick > world.tick).map(clue => ({ ...clue, position: { ...clue.position } }));
  for (const effect of activeEffects(world)) {
    if (effect.skill !== 'beacon' && effect.skill !== 'sound-projection') continue;
    clues.push({ id: `skill-clue:${effect.actorId}:${effect.createdTick}`, kind: effect.skill === 'beacon' ? 'beacon' : 'sound',
      position: { ...effect.position }, createdTick: effect.createdTick, expiresTick: effect.expiresTick, strength: effect.skill === 'beacon' ? 1 : .6 });
  }
  return { clues, scoutUntilTick: effectFor(world, actor, 'scout')?.expiresTick,
    dangerSenseRange: actor.active && effectFor(world, actor, 'danger-sense') ? 10 : undefined };
}

/** A recognized visible chase outranks investigation; beacon gaze remains a short distraction. */
export function hunterSkillAttention(world: SurvivalWorld, chasing = false): { investigationTarget?: Vec2; gazeTarget?: Vec2 } {
  const beacons = activeEffects(world).filter(effect => effect.skill === 'beacon').sort((a, b) => b.createdTick - a.createdTick || a.actorId.localeCompare(b.actorId));
  const beacon = beacons[0];
  if (beacon) return { ...(!chasing ? { investigationTarget: { ...beacon.position } } : {}),
    ...(world.tick < beacon.createdTick + 4 ? { gazeTarget: { ...beacon.position } } : {}) };
  const echo = activeEffects(world).find(effect => effect.skill === 'sound-projection');
  return echo && !chasing ? { investigationTarget: { ...echo.position } } : {};
}

/** Called in the world's skills slot. Repeated calls in a tick cannot advance decoys twice. */
export function resolveWorldSkills(world: SurvivalWorld, actions: SurvivalActions): void {
  const previousTick = world.skills.updatedTick;
  // Echo must complete its last interval before expiry. Keep its terminal snapshot
  // for this tick only; activeEffects/modifiers already hide the expired source.
  world.skills.effects = world.skills.effects.filter(effect => effect.createdTick <= world.tick
    && (effect.expiresTick > world.tick || effect.skill === 'sound-projection' && effect.expiresTick === world.tick));
  world.skills.clues = world.skills.clues.filter(clue => clue.expiresTick > world.tick);
  if (previousTick !== world.tick) {
    for (const effect of world.skills.effects) {
      if (effect.skill !== 'sound-projection') continue;
      const ticks = Math.min(world.tick, effect.expiresTick) - Math.max(previousTick, effect.createdTick);
      for (let step = 0; step < ticks; step++) {
        const position = { x: effect.position.x + effect.direction.x * 2.8 * world.dt, y: effect.position.y + effect.direction.y * 2.8 * world.dt };
        if (!isTraversable(world.map, positionCell(world.map, position), 'runner') || !hasLineOfSight(world.map, effect.position, position, world.tick)) break;
        effect.position = position;
      }
    }
  }
  for (const actor of [...world.runners].sort((a, b) => a.id.localeCompare(b.id))) if (actions[actor.id]?.useSkill === true) resolveSkill(world, actor, actions[actor.id]!);
  if (previousTick !== world.tick) for (const actor of world.runners) {
    if (!actor.active || Math.hypot(actor.kinematics.velocity.x, actor.kinematics.velocity.y) < .1) continue;
    const strength = acousticStrength(world, actor, sampleTerrain(world.map, actor.kinematics.position) === 'metal' ? 1 : .5);
    for (const kind of ['sound', 'footprint'] as const) world.skills.clues.push({ id: `${kind}:${actor.id}:${world.tick}`, kind, position: { ...actor.kinematics.position },
      createdTick: world.tick, expiresTick: world.tick + (kind === 'sound' ? 4 : 8), strength });
  }
  world.skills.updatedTick = world.tick;
}
