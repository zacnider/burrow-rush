export interface NumberSlideBoard {
  seed: string;
  size: number;
  tiles: number[];
  scrambleMoves: number;
}

function seededRandom(seedText: string) {
  let seed = 2166136261;
  for (let index = 0; index < seedText.length; index++) {
    seed ^= seedText.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  let state = seed >>> 0 || 0x9e3779b9;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
}

function neighbors(index: number, size: number) {
  const x = index % size;
  const y = Math.floor(index / size);
  return [y > 0 ? index - size : -1, x < size - 1 ? index + 1 : -1, y < size - 1 ? index + size : -1, x > 0 ? index - 1 : -1].filter((next) => next >= 0);
}

export function createNumberSlide(seed: string, level: number): NumberSlideBoard {
  const size = level <= 3 ? 3 : level <= 8 ? 4 : 5;
  const random = seededRandom(`${seed}:number-slide:${level}`);
  const tiles = Array.from({ length: size * size }, (_, index) => (index + 1) % (size * size));
  let empty = tiles.indexOf(0);
  const baseScramble = size * size * 7 + level * 3;
  const scrambleMoves = baseScramble + Math.floor(random() * (size * 5));
  let previousTile = -1;

  for (let turn = 0; turn < scrambleMoves; turn++) {
    const options = neighbors(empty, size).filter((index) => tiles[index] !== previousTile);
    const picked = options[Math.floor(random() * options.length)];
    previousTile = tiles[picked];
    [tiles[empty], tiles[picked]] = [tiles[picked], tiles[empty]];
    empty = picked;
  }

  if (isNumberSlideSolved(tiles)) {
    const picked = neighbors(empty, size)[0];
    [tiles[empty], tiles[picked]] = [tiles[picked], tiles[empty]];
  }

  return { seed, size, tiles, scrambleMoves };
}

export function isNumberSlideSolved(tiles: number[]) {
  return tiles.every((tile, index) => tile === (index + 1) % tiles.length);
}

export function canSlideTile(tiles: number[], tileIndex: number, size: number) {
  const empty = tiles.indexOf(0);
  const xDistance = Math.abs((empty % size) - (tileIndex % size));
  const yDistance = Math.abs(Math.floor(empty / size) - Math.floor(tileIndex / size));
  return xDistance + yDistance === 1;
}

export function slideTile(tiles: number[], tileIndex: number) {
  const next = [...tiles];
  const empty = next.indexOf(0);
  [next[empty], next[tileIndex]] = [next[tileIndex], next[empty]];
  return next;
}
