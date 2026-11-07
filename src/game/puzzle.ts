export const GRID_SIZE = 6;
const NORTH = 1;
const EAST = 2;
const SOUTH = 4;
const WEST = 8;
const DIRECTIONS = [NORTH, EAST, SOUTH, WEST] as const;
const DX: Record<number, number> = { [NORTH]: 0, [EAST]: 1, [SOUTH]: 0, [WEST]: -1 };
const DY: Record<number, number> = { [NORTH]: -1, [EAST]: 0, [SOUTH]: 1, [WEST]: 0 };
const OPPOSITE: Record<number, number> = { [NORTH]: SOUTH, [EAST]: WEST, [SOUTH]: NORTH, [WEST]: EAST };

export interface Point { x: number; y: number }
export interface PuzzleTile extends Point {
  id: number;
  kind: "source" | "goal" | "pipe" | "rock";
  ports: number;
  solution: number;
  fixed: boolean;
}
export interface PuzzleRules {
  size: number;
  rockChance: number;
  fixedChance: number;
  junctionChance: number;
  hasMoveLimit: boolean;
  moveSlack: number;
  mode: "CLEAR RUN" | "DEBRIS FIELD" | "JAMMED PIPES" | "JUNCTION STORM";
}
export interface SettlementPuzzle {
  seed: string;
  size: number;
  source: Point;
  destination: Point;
  path: Point[];
  tiles: PuzzleTile[];
}

function seededRandom(seedText: string) {
  let seed = 2166136261;
  for (let index = 0; index < seedText.length; index++) {
    seed ^= seedText.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function shortestSeededPath(start: Point, destination: Point, size: number, vertical: boolean, random: () => number): Point[] {
  const queue = [start];
  const parents = new Map<string, string | null>([[`${start.x},${start.y}`, null]]);
  while (queue.length) {
    const point = queue.shift()!;
    if (point.x === destination.x && point.y === destination.y) break;
    const neighbours = shuffled(DIRECTIONS, random)
      .map((direction) => ({ x: point.x + DX[direction], y: point.y + DY[direction] }))
      .filter((next) => vertical
        ? next.y >= 1 && next.y <= size - 2 && next.x >= 0 && next.x < size
        : next.x >= 1 && next.x <= size - 2 && next.y >= 0 && next.y < size);
    for (const next of neighbours) {
      const key = `${next.x},${next.y}`;
      if (parents.has(key)) continue;
      parents.set(key, `${point.x},${point.y}`);
      queue.push(next);
    }
  }
  const path: Point[] = [];
  let key: string | null = `${destination.x},${destination.y}`;
  while (key) {
    const [x, y] = key.split(",").map(Number);
    path.push({ x, y });
    key = parents.get(key) ?? null;
  }
  return path.reverse();
}

function directionBetween(from: Point, to: Point) {
  return DIRECTIONS.find((direction) => from.x + DX[direction] === to.x && from.y + DY[direction] === to.y)!;
}

export function rotatePorts(ports: number) {
  return ((ports << 1) & 15) | ((ports >> 3) & 1);
}

export function createLevelRules(campaignSeed: string, level: number): PuzzleRules {
  const random = seededRandom(`${campaignSeed}:rules:${level}`);
  const chapter = Math.floor((level - 1) / 3);
  const size = chapter === 0 ? 6 + Number(random() > 0.72) : chapter === 1 ? 7 + Number(random() > 0.64) : chapter === 2 ? 7 + Number(random() > 0.3) : 8;
  const modeRoll = random();
  const mode = modeRoll < 0.25 ? "DEBRIS FIELD" : modeRoll < 0.5 ? "JAMMED PIPES" : modeRoll < 0.75 ? "JUNCTION STORM" : "CLEAR RUN";
  const difficulty = chapter / 3;
  return {
    size,
    mode,
    rockChance: mode === "DEBRIS FIELD" ? 0.09 + difficulty * 0.04 : 0,
    fixedChance: mode === "JAMMED PIPES" ? 0.08 + difficulty * 0.04 : 0,
    junctionChance: mode === "JUNCTION STORM" ? 0.16 + difficulty * 0.1 : 0.04,
    hasMoveLimit: level >= 4 && (mode !== "CLEAR RUN" || random() > 0.35),
    moveSlack: chapter < 2 ? 6 : 3 + Math.floor(random() * 3),
  };
}

export function createSettlementPuzzle(seedText: string, rules: PuzzleRules): SettlementPuzzle {
  const { size } = rules;
  const random = seededRandom(seedText);
  const sourceSide = Math.floor(random() * 4);
  const destinationSide = sourceSide === 0 ? 1 : sourceSide === 1 ? 0 : sourceSide === 2 ? 3 : 2;
  const vertical = sourceSide >= 2;
  const sourceOffset = Math.floor(random() * size);
  const destinationOffset = Math.floor(random() * size);
  const edgePoint = (side: number, offset: number): Point => side === 0 ? { x: 0, y: offset }
    : side === 1 ? { x: size - 1, y: offset }
      : side === 2 ? { x: offset, y: 0 } : { x: offset, y: size - 1 };
  const source = edgePoint(sourceSide, sourceOffset);
  const destination = edgePoint(destinationSide, destinationOffset);
  const innerPoint = (side: number, point: Point): Point => side === 0 ? { x: 1, y: point.y }
    : side === 1 ? { x: size - 2, y: point.y }
      : side === 2 ? { x: point.x, y: 1 } : { x: point.x, y: size - 2 };
  const middlePath = shortestSeededPath(innerPoint(sourceSide, source), innerPoint(destinationSide, destination), size, vertical, random);
  const path = [source, ...middlePath, destination];
  const solutionMasks = new Map<string, number>();
  solutionMasks.set(`${source.x},${source.y}`, directionBetween(source, path[1]));
  solutionMasks.set(`${destination.x},${destination.y}`, directionBetween(destination, path[path.length - 2]));

  for (let index = 1; index < path.length - 1; index++) {
    const point = path[index];
    const previous = path[index - 1];
    const next = path[index + 1];
    solutionMasks.set(`${point.x},${point.y}`, directionBetween(point, previous) | directionBetween(point, next));
  }

  const tiles: PuzzleTile[] = [];
  let id = 0;
  let nonzeroPathRotations = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const key = `${x},${y}`;
      const solution = solutionMasks.get(key);
      if (solution !== undefined) {
        const kind = x === source.x && y === source.y ? "source" : x === destination.x && y === destination.y ? "goal" : "pipe";
        let ports = solution;
        if (kind === "pipe") {
          const rotation = 1 + Math.floor(random() * 3);
          for (let turn = 0; turn < rotation; turn++) ports = rotatePorts(ports);
          nonzeroPathRotations++;
        }
        tiles.push({ id: id++, x, y, kind, ports, solution, fixed: false });
      } else {
        if (random() < rules.rockChance) {
          tiles.push({ id: id++, x, y, kind: "rock", ports: 0, solution: 0, fixed: true });
          continue;
        }
        const shape = random() < rules.junctionChance
          ? random() < .5 ? NORTH | EAST | SOUTH : EAST | SOUTH | WEST
          : random() > .5 ? NORTH | SOUTH : NORTH | EAST;
        let ports = shape;
        const rotation = Math.floor(random() * 4);
        for (let turn = 0; turn < rotation; turn++) ports = rotatePorts(ports);
        tiles.push({ id: id++, x, y, kind: "pipe", ports, solution: 0, fixed: random() < rules.fixedChance });
      }
    }
  }

  if (nonzeroPathRotations === 0 && tiles.length > 2) {
    const tile = tiles.find((entry) => entry.kind === "pipe" && entry.solution !== 0)!;
    tile.ports = rotatePorts(tile.ports);
  }
  return { seed: seedText, size, source, destination, path, tiles };
}

export function reachableTileIds(tiles: PuzzleTile[], source: Point) {
  const byPosition = new Map(tiles.map((tile) => [`${tile.x},${tile.y}`, tile]));
  const start = byPosition.get(`${source.x},${source.y}`);
  if (!start) return new Set<number>();
  const queue = [start];
  const visited = new Set([`${start.x},${start.y}`]);
  const reachable = new Set([start.id]);
  while (queue.length) {
    const tile = queue.shift()!;
    for (const direction of DIRECTIONS) {
      if (!(tile.ports & direction)) continue;
      const x = tile.x + DX[direction];
      const y = tile.y + DY[direction];
      const next = byPosition.get(`${x},${y}`);
      const key = `${x},${y}`;
      if (!next || visited.has(key) || !(next.ports & OPPOSITE[direction])) continue;
      visited.add(key);
      reachable.add(next.id);
      queue.push(next);
    }
  }
  return reachable;
}

export function routeIsConnected(tiles: PuzzleTile[], source: Point, destination: Point) {
  return tiles.some((tile) => tile.x === destination.x && tile.y === destination.y && reachableTileIds(tiles, source).has(tile.id));
}

export function portPath(ports: number) {
  const paths: Record<number, string> = {
    [NORTH]: "M50 50V3",
    [EAST]: "M50 50H97",
    [SOUTH]: "M50 50V97",
    [WEST]: "M50 50H3",
  };
  return DIRECTIONS.filter((direction) => ports & direction).map((direction) => paths[direction]).join(" ");
}
