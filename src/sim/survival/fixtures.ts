import type { SurvivalMap } from './map';
import type { TerrainKind } from './types';

/** Small ASCII maps for deterministic scenario tests; pipe pairs are assigned explicitly by callers. */
export function createSurvivalFixture(rows: string[]): SurvivalMap {
  if (!rows.length || !rows[0]!.length || rows.some(row => row.length !== rows[0]!.length)) {
    throw new Error('fixture rows must form a non-empty rectangle');
  }
  const legend: Record<string, TerrainKind> = { '.': 'floor', '#': 'wall', '~': 'mud', ':': 'shadow', '=': 'metal', P: 'pipe', S: 'shelf' };
  const terrain = rows.flatMap(row => [...row].map(character => {
    const kind = legend[character];
    if (!kind) throw new Error(`unknown fixture terrain ${character}`);
    return kind;
  }));
  const first = terrain.findIndex(kind => kind !== 'wall' && kind !== 'shelf' && kind !== 'pipe');
  const width = rows[0]!.length;
  const spawn = { x: (first < 0 ? 0 : first % width) + 0.5, y: (first < 0 ? 0 : Math.floor(first / width)) + 0.5 };
  return {
    seed: 0, width, height: rows.length, terrain, rooms: [], corridors: [], shelves: [], doors: [], pipes: [],
    runnerSpawns: [{ ...spawn }], hunterSpawn: { ...spawn }, futureZoneAnchors: [{ ...spawn }],
  };
}
