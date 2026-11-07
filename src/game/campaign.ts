export type StageMode = "ROUTE" | "DEFENSE" | "MEMORY";

function randomFor(seedText: string) {
  let seed = 2166136261;
  for (let index = 0; index < seedText.length; index++) {
    seed ^= seedText.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

/** Every three-level chapter contains all three game modes, in a hash-derived order. */
export function stageModeFor(seed: string, level: number): StageMode {
  const chapter = Math.floor((level - 1) / 3);
  let previousLast: StageMode | null = null;
  let current: StageMode[] = [];
  for (let group = 0; group <= chapter; group++) {
    const random = randomFor(`${seed}:game-modes:${group}`);
    current = ["ROUTE", "DEFENSE", "MEMORY"];
    for (let index = current.length - 1; index > 0; index--) {
      const swap = Math.floor(random() * (index + 1));
      [current[index], current[swap]] = [current[swap], current[index]];
    }
    if (previousLast && current[0] === previousLast) {
      const swapIndex = current.findIndex((mode) => mode !== previousLast);
      [current[0], current[swapIndex]] = [current[swapIndex], current[0]];
    }
    previousLast = current[2];
  }
  return current[(level - 1) % 3];
}
