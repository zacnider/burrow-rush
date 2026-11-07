export const API_BASE = "https://api.squeekchain.com/v1";
export const BLOCK_UNITS = 1_000_000_000n;

export interface CoreSnapshot {
  status: "available";
  chain: { target: string; chainId: string; safeThroughBlock: string; confirmations: string };
  identities: { core: string };
  core: {
    blockHeight: string;
    blockProgress: string;
    cumulativeBlockUnits: string;
    cumulativeWork: string;
    settledThroughRound: string;
    paused: boolean;
  };
  source: { transactionHash: string; blockNumber: string; blockTimestamp: string };
}

export interface MeasurementSnapshot {
  builder: { status: "available" | "unavailable"; anchor?: { cumulativeBlockUnits: string; blockHeight: string } };
  measurement: null | {
    freshness: "online" | "stale";
    coreStatus: "IDLE" | "ACTIVE" | "COUNTER_FAULT";
    provenance: "hardware" | "simulated" | "replay" | "derived";
    rpmMilli: number;
    cumulativeWorkUnits: string;
    observedAt: string;
  };
}

interface EconomySnapshot {
  status: "available";
  chain: { target: string; chainId: string };
  identities?: { core?: string };
  deployment?: { components?: { core?: { address?: string } } };
}

export interface ChainState {
  core: CoreSnapshot | null;
  measurement: MeasurementSnapshot | null;
  checkedAt: number | null;
  error: string | null;
}

async function fetchJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    signal,
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Squeekchain API returned ${response.status}`);
  return response.json() as Promise<T>;
}

function isCoreSnapshot(value: unknown): value is CoreSnapshot {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<CoreSnapshot>;
  return data.status === "available"
    && data.chain?.target === "sepolia"
    && data.chain?.chainId === "11155111"
    && /^0x[a-f\d]{40}$/i.test(data.identities?.core ?? "")
    && typeof data.core?.cumulativeBlockUnits === "string"
    && typeof data.core?.blockHeight === "string"
    && typeof data.core?.settledThroughRound === "string"
    && typeof data.source?.transactionHash === "string";
}

function isEconomySnapshot(value: unknown): value is EconomySnapshot {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<EconomySnapshot>;
  const coreAddress = data.identities?.core ?? data.deployment?.components?.core?.address ?? "";
  return data.status === "available"
    && data.chain?.target === "sepolia"
    && data.chain?.chainId === "11155111"
    && /^0x[a-f\d]{40}$/i.test(coreAddress);
}

function economyCoreAddress(data: EconomySnapshot): string | null {
  return data.identities?.core ?? data.deployment?.components?.core?.address ?? null;
}

function isMeasurementSnapshot(value: unknown): value is MeasurementSnapshot {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<MeasurementSnapshot>;
  return "measurement" in data
    && typeof data.builder === "object"
    && (data.builder?.status === "available" || data.builder?.status === "unavailable");
}

export async function readChain(signal: AbortSignal): Promise<ChainState> {
  const [coreResult, measurementResult, economyResult] = await Promise.allSettled([
    fetchJson<unknown>("/core", signal),
    fetchJson<unknown>("/status", signal),
    fetchJson<unknown>("/economy/state", signal),
  ]);

  let core: CoreSnapshot | null = null;
  let error: string | null = null;
  const economy = economyResult.status === "fulfilled" && isEconomySnapshot(economyResult.value)
    ? economyResult.value
    : null;
  if (coreResult.status === "fulfilled" && isCoreSnapshot(coreResult.value) && economy
    && coreResult.value.identities.core.toLowerCase() === economyCoreAddress(economy)?.toLowerCase()) {
    core = coreResult.value;
  } else if (coreResult.status === "fulfilled") {
    const data = coreResult.value as { status?: string; reason?: string; chain?: { target?: string }; identities?: { core?: string } };
    if (data.status === "unavailable") error = `Squeekchain data unavailable${data.reason ? `: ${data.reason}` : "."}`;
    else if (data.chain?.target && data.chain.target !== "sepolia") error = `Unexpected network: ${data.chain.target}.`;
    else if (!economy) error = "Squeekchain deployment identity is unavailable; chain data could not be verified.";
    else if (data.identities?.core && economy && data.identities.core.toLowerCase() !== economyCoreAddress(economy)?.toLowerCase()) error = "Squeekchain API sources disagree about the active deployment.";
    else error = "Squeekchain returned an incomplete or unexpected chain snapshot.";
  } else if (!signal.aborted) {
    error = coreResult.reason instanceof Error ? coreResult.reason.message : "Could not read confirmed chain state.";
  }

  const measurement = measurementResult.status === "fulfilled" && isMeasurementSnapshot(measurementResult.value)
    ? measurementResult.value
    : null;

  return { core, measurement, checkedAt: core ? Date.now() : null, error };
}
