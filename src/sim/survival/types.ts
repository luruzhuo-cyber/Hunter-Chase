export type Vec2 = { x: number; y: number };

export type KinematicState = {
  position: Vec2;
  velocity: Vec2;
  heading: number;
};

export type SkillId =
  | 'beacon'
  | 'silent-step'
  | 'wall-phase'
  | 'door-override'
  | 'sound-projection'
  | 'adrenaline'
  | 'scout'
  | 'danger-sense';

export type TerrainKind = 'floor' | 'mud' | 'shadow' | 'metal' | 'wall' | 'pipe' | 'shelf';

export type SurvivalActor = {
  id: string;
  kind: 'runner' | 'hunter';
  kinematics: KinematicState;
  skill?: SkillId;
  skillUsed: boolean;
  active: boolean;
};

export function length(vector: Vec2): number {
  return Math.hypot(vector.x, vector.y);
}

export function normalize(vector: Vec2): Vec2 {
  const magnitude = length(vector);
  if (magnitude === 0) return { x: 0, y: 0 };
  return { x: vector.x / magnitude, y: vector.y / magnitude };
}

export function scale(vector: Vec2, factor: number): Vec2 {
  return { x: vector.x * factor, y: vector.y * factor };
}

export function add(left: Vec2, right: Vec2): Vec2 {
  return { x: left.x + right.x, y: left.y + right.y };
}

export function clampMagnitude(vector: Vec2, maxMagnitude: number): Vec2 {
  const magnitude = length(vector);
  if (magnitude <= maxMagnitude || magnitude === 0) return vector;
  return scale(vector, maxMagnitude / magnitude);
}
