export type MissionLength = "short" | "medium" | "long";

export const MISSION_LENGTHS: Record<MissionLength, { label: string; caption: string; units: bigint }> = {
  short: { label: "Short hop", caption: "¼ Squeek block", units: 250_000_000n },
  medium: { label: "Moon run", caption: "½ Squeek block", units: 500_000_000n },
  long: { label: "Long haul", caption: "1 full Squeek block", units: 1_000_000_000n },
};

export interface Mission {
  startedAtUnits: bigint;
  requiredUnits: bigint;
  length: MissionLength;
  score: number;
}

export function missionProgress(mission: Mission, currentUnits: bigint) {
  const gained = currentUnits > mission.startedAtUnits ? currentUnits - mission.startedAtUnits : 0n;
  const counted = gained > mission.requiredUnits ? mission.requiredUnits : gained;
  const percent = Number((counted * 10_000n) / mission.requiredUnits) / 100;
  return { gained, counted, percent, complete: gained >= mission.requiredUnits };
}
