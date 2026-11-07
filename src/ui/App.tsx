import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronRight, CircleHelp, Crown, Leaf, Radio, ShieldCheck, Sparkles, Users, Volume2, VolumeX, Wallet, Wheat } from "lucide-react";
import { useSqueekchain } from "../hooks/useSqueekchain";
import { useWallet } from "../hooks/useWallet";

type Food = { id: number; x: number; y: number; kind: number; eventRound?: string | null };
type RoundEvent = { name: string; foodKind: number; description: string; round: string };
type Page = "home" | "play" | "leaderboard" | "how-to";
function pageFromPath(path: string): Page { if (path === "/play") return "play"; if (path === "/leaderboard") return "leaderboard"; if (path === "/how-to") return "how-to"; return "home"; }
type Player = { id: string; name: string; x: number; y: number; radius: number; size: number; angle: number; moveX: number; moveY: number; color: string; coat: number; score: number; popupSeeds?: number; popupUntil?: number; xp?: number; walletLinked?: boolean; savedSize?: number; isYou?: boolean; squeek?: boolean; squeekLevel?: number; protected?: boolean; notice?: string; noticeUntil?: number };
type SavedScore = { address: string; name: string; xp: number; seedsBanked: number; savedSize: number; updatedAt: string };
type ArenaState = { type: "state"; players: Player[]; food: Food[]; wheel: { state: string; rpm: number; round: string; work: string; fresh: boolean; roundConfirmed: boolean; event: RoundEvent | null }; count: number; arenaId?: number; receivedAt?: number };
const WS_URL = import.meta.env.VITE_ARENA_WS_URL || (import.meta.env.DEV
  ? `ws://${location.hostname}:8787/arena`
  : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/arena`);
const LEADERBOARD_URL = WS_URL.replace(/^ws/, "http").replace(/\/arena$/, "/leaderboard");
const COLORS = ["#ffca68", "#87dfb0", "#9db7ff", "#f59c9d", "#d4a7ff", "#84d6e8", "#ffc0dc"];
const COATS = ["Golden", "Silver", "Calico"];
const HAMSTER_SHEETS = ["golden", "silver", "calico"].map((coat) => { const image = new Image(); image.src = `/arena/sheets/${coat}-walk.png`; return image; });

const GROUND_TEXTURE_SIZE = 768;
const GROUND_TILE_SIZE = 1024;
const GROUND_TILE_OVERLAP = 64;
const GROUND_DRAW_SIZE = GROUND_TILE_SIZE + GROUND_TILE_OVERLAP * 2;
const groundTileCache = new Map<string, HTMLCanvasElement>();
function createGroundTile(tileX: number, tileY: number) {
  const tile = document.createElement("canvas"); tile.width = GROUND_TEXTURE_SIZE; tile.height = GROUND_TEXTURE_SIZE;
  const ctx = tile.getContext("2d")!;
  let seed = (Math.imul(tileX, 73856093) ^ Math.imul(tileY, 19349663) ^ 0x5f3759df) >>> 0;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const size = GROUND_TEXTURE_SIZE;
  // Broad, soft-edged moss and damp-earth islands establish depth without
  // using the bright yellow-green that competes with the golden hamster.
  const groundColors = ["rgba(77,102,72,.31)", "rgba(24,48,48,.43)", "rgba(93,105,76,.18)", "rgba(48,76,68,.42)", "rgba(71,77,60,.20)"];
  for (let patch = 0; patch < 23; patch++) {
    const x = rand() * size; const y = rand() * size; const rx = 38 + rand() * 110; const ry = 24 + rand() * 78; const turn = rand() * Math.PI;
    ctx.save(); ctx.translate(x, y); ctx.rotate(turn); ctx.scale(1, ry / rx); ctx.shadowColor = groundColors[patch % groundColors.length]; ctx.shadowBlur = 25 + rand() * 26;
    ctx.beginPath();
    const points = 13; const phase = rand() * Math.PI * 2;
    for (let point = 0; point <= points; point++) { const a = point / points * Math.PI * 2; const wobble = .78 + .2 * Math.sin(a * 3 + phase) + rand() * .15; const px = Math.cos(a) * rx * wobble; const py = Math.sin(a) * rx * wobble; if (!point) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
    ctx.closePath(); ctx.fillStyle = groundColors[patch % groundColors.length]; ctx.fill(); ctx.restore();
  }

  // Fine soil grain is sparse and low-contrast, keeping the moving sprites
  // and collectible food as the clearest shapes on screen.
  for (let speck = 0; speck < 1050; speck++) {
    const x = rand() * size; const y = rand() * size; const r = .45 + rand() * 1.05;
    ctx.fillStyle = speck % 3 ? "rgba(11,24,26,.19)" : "rgba(178,190,154,.10)";
    ctx.beginPath(); ctx.ellipse(x, y, r * (1.1 + rand()), r, rand() * Math.PI, 0, Math.PI * 2); ctx.fill();
  }

  // Irregular clumps of grass are separated by open ground, so the field reads
  // as a traversable space instead of a uniform carpet of repeated marks.
  for (let tuft = 0; tuft < 31; tuft++) {
    const x = rand() * size; const y = rand() * size; const blades = 4 + Math.floor(rand() * 5); const height = 12 + rand() * 24; const rotation = rand() * Math.PI * 2;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rotation); ctx.lineCap = "round";
    for (let blade = 0; blade < blades; blade++) {
      const side = blade - (blades - 1) / 2; const bend = (rand() - .5) * 14; const h = height * (.62 + rand() * .5);
      ctx.strokeStyle = blade % 3 ? "rgba(111,145,91,.52)" : "rgba(156,166,117,.43)"; ctx.lineWidth = 1.2 + rand() * 1.5;
      ctx.beginPath(); ctx.moveTo(side * 2, 4); ctx.quadraticCurveTo(side * 4 + bend, -h * .48, side * 6 + bend, -h); ctx.stroke();
    }
    ctx.restore();
  }

  // Larger, varied clover silhouettes replace the tiny repeated leaf icons.
  for (let clump = 0; clump < 8; clump++) {
    const x = 25 + rand() * (size - 50); const y = 25 + rand() * (size - 50); const leafCount = 3 + Math.floor(rand() * 3); const leafSize = 8 + rand() * 9; const rotation = rand() * Math.PI * 2;
    const leafColor = ["#66885d", "#789267", "#587b5c", "#788566"][Math.floor(rand() * 4)];
    ctx.save(); ctx.translate(x, y); ctx.rotate(rotation);
    for (let leaf = 0; leaf < leafCount; leaf++) {
      const angle = leaf / leafCount * Math.PI * 2; const lx = Math.cos(angle) * leafSize * .84; const ly = Math.sin(angle) * leafSize * .72;
      ctx.strokeStyle = "rgba(190,207,160,.25)"; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(0, 2); ctx.quadraticCurveTo(lx * .45, ly * .55, lx, ly); ctx.stroke();
      ctx.fillStyle = leafColor; ctx.beginPath(); ctx.ellipse(lx, ly, leafSize * .62, leafSize * .44, angle, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(196,211,164,.34)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(lx * .58, ly * .58); ctx.lineTo(lx * .92, ly * .92); ctx.stroke();
    }
    ctx.fillStyle = "#a2a47a"; ctx.beginPath(); ctx.arc(0, 1, 2.1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }

  // Small wildflowers use cool ivory, lavender and muted coral accents.
  for (let bed = 0; bed < 5; bed++) {
    const x = 28 + rand() * (size - 56); const y = 28 + rand() * (size - 56); const blooms = 3 + Math.floor(rand() * 5); const hue = ["#d3c9dc", "#d8d7bd", "#d49a91"][Math.floor(rand() * 3)];
    for (let bloom = 0; bloom < blooms; bloom++) {
      const bx = x + (rand() - .5) * 44; const by = y + (rand() - .5) * 42; const petals = 5 + Math.floor(rand() * 3); const petalR = 2.1 + rand() * 1.5; const orbit = 3.2 + rand() * 1.8;
      ctx.fillStyle = "rgba(19,31,29,.32)"; ctx.beginPath(); ctx.arc(bx + 1, by + 2, 6, 0, Math.PI * 2); ctx.fill();
      for (let petal = 0; petal < petals; petal++) { const a = petal / petals * Math.PI * 2; ctx.fillStyle = hue; ctx.beginPath(); ctx.ellipse(bx + Math.cos(a) * orbit, by + Math.sin(a) * orbit, petalR, petalR * .72, a, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = "#b79b68"; ctx.beginPath(); ctx.arc(bx, by, 2.2, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Pebbles and a few curled leaves provide scale cues without making food-like
  // bright spots or a repeating path through the play area.
  for (let stone = 0; stone < 5; stone++) {
    const x = 24 + rand() * (size - 48); const y = 24 + rand() * (size - 48); const rx = 5 + rand() * 10; const ry = 3 + rand() * 6; const angle = rand() * Math.PI;
    ctx.fillStyle = "rgba(10,20,20,.36)"; ctx.beginPath(); ctx.ellipse(x + 2, y + 4, rx * 1.18, ry * 1.3, angle, 0, Math.PI * 2); ctx.fill();
    const rock = ctx.createLinearGradient(x - rx, y - ry, x + rx, y + ry); rock.addColorStop(0, "#859084"); rock.addColorStop(.48, "#626f65"); rock.addColorStop(1, "#414f4b");
    ctx.fillStyle = rock; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(202,210,189,.25)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(x - rx * .18, y - ry * .18, rx * .42, ry * .28, angle, Math.PI, Math.PI * 1.75); ctx.stroke();
  }
  for (let leaf = 0; leaf < 13; leaf++) {
    const x = rand() * size; const y = rand() * size; const angle = rand() * Math.PI * 2; const length = 7 + rand() * 12;
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.fillStyle = leaf % 2 ? "rgba(128,91,78,.48)" : "rgba(122,126,83,.47)";
    ctx.beginPath(); ctx.moveTo(-length / 2, 0); ctx.quadraticCurveTo(-length * .12, -4 - rand() * 3, length / 2, 0); ctx.quadraticCurveTo(0, 3 + rand() * 2, -length / 2, 0); ctx.fill();
    ctx.strokeStyle = "rgba(211,188,145,.24)"; ctx.lineWidth = .8; ctx.beginPath(); ctx.moveTo(-length / 2, 0); ctx.lineTo(length / 2, 0); ctx.stroke(); ctx.restore();
  }

  // Cross-fade the outer rim of each detail tile. Neighboring tiles overlap
  // by 128 world units, hiding the square grid while keeping the base ground
  // continuous underneath all of them.
  const edgeFade = (horizontal: boolean) => {
    const fadePixels = Math.round(size * GROUND_TILE_OVERLAP * 2 / GROUND_DRAW_SIZE);
    const gradient = horizontal ? ctx.createLinearGradient(0, 0, size, 0) : ctx.createLinearGradient(0, 0, 0, size);
    gradient.addColorStop(0, "rgba(255,255,255,0)");
    gradient.addColorStop(fadePixels / size, "rgba(255,255,255,1)");
    gradient.addColorStop(1 - fadePixels / size, "rgba(255,255,255,1)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, size, size);
  };
  edgeFade(true); edgeFade(false); ctx.globalCompositeOperation = "source-over";
  return tile;
}
function drawInfiniteGround(ctx: CanvasRenderingContext2D, left: number, top: number, right: number, bottom: number) {
  ctx.save(); ctx.fillStyle = "#30413b"; ctx.fillRect(left, top, right - left, bottom - top);
  const firstX = Math.floor((left - GROUND_TILE_OVERLAP) / GROUND_TILE_SIZE); const lastX = Math.floor((right + GROUND_TILE_OVERLAP) / GROUND_TILE_SIZE);
  const firstY = Math.floor((top - GROUND_TILE_OVERLAP) / GROUND_TILE_SIZE); const lastY = Math.floor((bottom + GROUND_TILE_OVERLAP) / GROUND_TILE_SIZE);
  for (let tileY = firstY; tileY <= lastY; tileY++) for (let tileX = firstX; tileX <= lastX; tileX++) {
    const key = `${tileX},${tileY}`; let tile = groundTileCache.get(key);
    if (!tile) { tile = createGroundTile(tileX, tileY); groundTileCache.set(key, tile); if (groundTileCache.size > 16) groundTileCache.delete(groundTileCache.keys().next().value!); }
    ctx.drawImage(tile, tileX * GROUND_TILE_SIZE - GROUND_TILE_OVERLAP, tileY * GROUND_TILE_SIZE - GROUND_TILE_OVERLAP, GROUND_DRAW_SIZE, GROUND_DRAW_SIZE);
  }
  ctx.restore();
}
function drawFood(ctx: CanvasRenderingContext2D, food: Food, time: number) {
  const bob = Math.sin(time * .004 + food.id * 1.71) * 1.5;
  ctx.save(); ctx.translate(food.x, food.y + bob); ctx.rotate(Math.sin(food.id * 3.17) * .24);
  ctx.fillStyle = "rgba(40,48,29,.23)"; ctx.beginPath(); ctx.ellipse(1, 8, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
  if (food.kind % 4 === 0) {
    ctx.save(); ctx.rotate(-.35); ctx.fillStyle = "#72533a"; ctx.beginPath(); ctx.ellipse(0, 0, 10, 5.7, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#e3bb73"; ctx.beginPath(); ctx.ellipse(0, -1, 8.6, 4.3, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = "#f6dfa0"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-5, 0); ctx.quadraticCurveTo(0, -3, 5, 0); ctx.stroke(); ctx.restore();
  } else if (food.kind % 4 === 1) {
    ctx.fillStyle = "#617d41"; ctx.beginPath(); ctx.moveTo(-7, -8); ctx.quadraticCurveTo(-15, -15, -16, -8); ctx.quadraticCurveTo(-10, -3, -5, -4); ctx.fill(); ctx.beginPath(); ctx.moveTo(5, -8); ctx.quadraticCurveTo(11, -17, 15, -11); ctx.quadraticCurveTo(11, -5, 6, -4); ctx.fill(); ctx.fillStyle = "#efc54d"; ctx.strokeStyle = "#bc8838"; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.roundRect(-6.5, -10, 13, 22, 6); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#fff0a2"; for (let row = 0; row < 4; row++) for (let col = 0; col < 2; col++) { ctx.beginPath(); ctx.arc(-2.8 + col * 5, -6 + row * 4.5, 1.15, 0, Math.PI * 2); ctx.fill(); }
  } else if (food.kind % 4 === 2) {
    ctx.fillStyle = "#537d48"; ctx.beginPath(); ctx.moveTo(0, -4); ctx.quadraticCurveTo(-13, -17, -13, -8); ctx.quadraticCurveTo(-7, -3, 0, -3); ctx.moveTo(1, -4); ctx.quadraticCurveTo(6, -18, 12, -12); ctx.quadraticCurveTo(10, -5, 1, -3); ctx.fill();
    for (const [x, y] of [[-5, 2], [2, 0], [7, 5], [-1, 8]] as const) { ctx.fillStyle = "#7e3f91"; ctx.beginPath(); ctx.arc(x + 1, y + 1, 5.2, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#cf73cf"; ctx.beginPath(); ctx.arc(x - 1, y - 1, 3.4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#f7c4e8"; ctx.beginPath(); ctx.arc(x - 2, y - 2, 1.1, 0, Math.PI * 2); ctx.fill(); }
  } else {
    ctx.fillStyle = "#598044"; ctx.beginPath(); ctx.moveTo(-2, -7); ctx.quadraticCurveTo(-13, -16, -14, -9); ctx.quadraticCurveTo(-9, -5, -2, -4); ctx.moveTo(1, -7); ctx.quadraticCurveTo(9, -18, 15, -12); ctx.quadraticCurveTo(11, -6, 2, -4); ctx.fill(); ctx.fillStyle = "#dc7046"; ctx.strokeStyle = "#a84c38"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-7, -6); ctx.quadraticCurveTo(0, -9, 7, -6); ctx.lineTo(1, 13); ctx.quadraticCurveTo(0, 16, -1, 13); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.strokeStyle = "#f6a15f"; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(-3, -2); ctx.lineTo(-1, 4); ctx.moveTo(3, -3); ctx.lineTo(1, 5); ctx.stroke();
  }
  ctx.restore();
}

function pretty(value?: string | null) { if (!value) return "—"; try { return BigInt(value).toLocaleString("en-US"); } catch { return value; } }
function makeName() { return `Nibble-${Math.floor(100 + Math.random() * 900)}`; }

function Arena({ walletAddress, walletWrongNetwork, page }: { walletAddress: string | null; walletWrongNetwork: boolean; page: Page }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const stateRef = useRef<ArenaState | null>(null);
  const guestModeRef = useRef(false);
  const walletAddressRef = useRef(walletAddress);
  walletAddressRef.current = walletAddress;
  const inputRef = useRef({ x: 0, y: 0 });
  const keysRef = useRef(new Set<string>());
  const touchStickRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [spectating, setSpectating] = useState(false);
  const [inGame, setInGame] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [arenaReady, setArenaReady] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [showGuestOption, setShowGuestOption] = useState(false);
  const [name, setName] = useState(makeName);
  const [coat, setCoat] = useState(0);
  const [stick, setStick] = useState({ x: 0, y: 0 });
  const [arenaState, setArenaState] = useState<ArenaState | null>(null);
  const [savedRankings, setSavedRankings] = useState<SavedScore[]>([]);
  const [leaderboardMode, setLeaderboardMode] = useState<"xp" | "live">("xp");
  const [bankMessage, setBankMessage] = useState("");
  const [checkingNft, setCheckingNft] = useState(false);
  const [nftMessage, setNftMessage] = useState("Connect a Sepolia wallet to check Squeek ownership.");

  useEffect(() => {
    let stopped = false; let timer = 0;
    const healthUrl = WS_URL.replace(/^ws/, "http").replace(/\/arena$/, "/health");
    const check = async () => {
      try { const response = await fetch(healthUrl, { signal: AbortSignal.timeout(2000), cache: "no-store" }); if (!stopped) setArenaReady(response.ok); }
      catch { if (!stopped) setArenaReady(false); }
      if (!stopped) timer = window.setTimeout(check, 5000);
    };
    void check(); return () => { stopped = true; window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (page !== "leaderboard" || inGame) return;
    let active = true;
    setConnecting(true); setError("");
    const socket = new WebSocket(WS_URL); socketRef.current = socket;
    socket.onopen = () => { if (active) setConnected(true); };
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === "challenge") { socket.send(JSON.stringify({ type: "watch" })); return; }
        if (message.type === "watch-ready") { if (active) { setSpectating(true); setConnecting(false); } return; }
        if (message.type === "state") { const timed = { ...message, receivedAt: performance.now() } as ArenaState; stateRef.current = timed; if (active) { setArenaState(timed); setSpectating(true); setConnecting(false); } }
        if (message.type === "error" && active) { setError(message.message || "Could not open the live leaderboard."); setConnecting(false); }
      } catch { /* ignore malformed packets */ }
    };
    socket.onerror = () => { if (active) { setError("Arena connection failed. The live leaderboard is unavailable."); setConnecting(false); } };
    socket.onclose = () => { if (active) { setConnected(false); setSpectating(false); setConnecting(false); } };
    return () => {
      active = false;
      if (socketRef.current === socket) { socketRef.current = null; socket.close(); setConnected(false); setSpectating(false); setConnecting(false); setArenaState(null); stateRef.current = null; }
    };
  }, [page, inGame]);

  useEffect(() => {
    if (page !== "leaderboard") return;
    let stopped = false;
    const refresh = async () => {
      try { const response = await fetch(LEADERBOARD_URL, { cache: "no-store", signal: AbortSignal.timeout(3500) }); if (!response.ok) throw new Error("Leaderboard unavailable"); const result = await response.json(); if (!stopped) setSavedRankings(Array.isArray(result.players) ? result.players : []); }
      catch { if (!stopped) setSavedRankings([]); }
    };
    void refresh(); const timer = window.setInterval(refresh, 15000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [page]);

  const leave = useCallback(() => {
    socketRef.current?.close(); socketRef.current = null;
    stateRef.current = null; setArenaState(null); setInGame(false); setConnected(false); setSpectating(false); setConnecting(false); setBankMessage("");
  }, []);
  useEffect(() => () => socketRef.current?.close(), []);

  const join = useCallback((asGuest = false) => {
    if (connecting || inGame) return;
    if (walletWrongNetwork && !asGuest) { setError("Your wallet is on another network. Switch to Sepolia to verify it, or choose Play as Guest."); setShowGuestOption(true); return; }
    guestModeRef.current = asGuest || !walletAddressRef.current;
    setShowGuestOption(false);
    setError(""); setBankMessage(""); setConnecting(true); inputRef.current = { x: 0, y: 0 }; keysRef.current.clear();
    const socket = new WebSocket(WS_URL); socketRef.current = socket;
    socket.onopen = () => {
      setConnected(true);
    };
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === "challenge") {
          const signingAddress = walletAddressRef.current;
          if (guestModeRef.current) { socket.send(JSON.stringify({ type: "guest" })); return; }
          if (!signingAddress || !window.ethereum) { setError("Wallet unavailable. Reconnect it, or choose Play as Guest."); setShowGuestOption(true); setConnecting(false); socket.close(); return; }
          setCheckingNft(true); setNftMessage("Sign a free wallet message to check Squeek ownership.");
          const text = `Burrow Rush Sepolia sign-in\nNonce: ${message.nonce}`;
          void window.ethereum.request({ method: "personal_sign", params: [text, signingAddress] })
            .then((signature) => socket.send(JSON.stringify({ type: "auth", address: signingAddress, signature })))
            .catch((reason) => { setCheckingNft(false); setError(reason && typeof reason === "object" && "code" in reason && Number(reason.code) === 4001 ? "Wallet signature was rejected. Retry, or choose Play as Guest." : "Wallet sign-in failed. Retry, or choose Play as Guest."); setShowGuestOption(true); setConnecting(false); socket.close(); });
          return;
        }
        if (message.type === "auth-result") {
          setCheckingNft(false); setNftMessage(message.message || "Playing as a guest.");
          if (message.linkedExisting) { setBankMessage(message.authenticated ? "Wallet verified. You can now save your size and bank seeds." : message.message || "Wallet link was not completed."); return; }
          if (!message.authenticated && !guestModeRef.current) { setError(message.message || "Wallet verification failed. Retry, or choose Play as Guest."); setShowGuestOption(true); setConnecting(false); socket.close(); return; }
          socket.send(JSON.stringify({ type: "join", name: name.trim().slice(0, 16) || makeName(), color: COLORS[Math.floor(Math.random() * COLORS.length)], coat }));
          return;
        }
        if (message.type === "bank-result") { setBankMessage(message.message || (message.ok ? "Progress saved." : "Could not save progress.")); return; }
        if (message.type === "state") { const timed = { ...message, receivedAt: performance.now() } as ArenaState; stateRef.current = timed; setArenaState(timed); setInGame(true); setConnecting(false); }
        if (message.type === "error") { setError(message.message || "Could not join the arena."); leave(); }
      } catch { /* ignore malformed packets */ }
    };
    socket.onerror = () => { setError("Arena connection failed. Start the multiplayer server, then reconnect."); setConnecting(false); };
    socket.onclose = () => { setConnected(false); setInGame(false); setConnecting(false); };
  }, [coat, connecting, inGame, leave, name, walletAddress, walletWrongNetwork]);

  useEffect(() => {
    if (!inGame) return;
    const timer = window.setInterval(() => {
      if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: "input", x: inputRef.current.x, y: inputRef.current.y }));
    }, 50);
    return () => window.clearInterval(timer);
  }, [inGame]);

  useEffect(() => {
    if (!inGame) return;
    const axes = { x: 0, y: 0 };
    const updateKeys = () => {
      const keys = keysRef.current;
      axes.x = Number(keys.has("ArrowRight") || keys.has("d") || keys.has("D")) - Number(keys.has("ArrowLeft") || keys.has("a") || keys.has("A"));
      axes.y = Number(keys.has("ArrowDown") || keys.has("s") || keys.has("S")) - Number(keys.has("ArrowUp") || keys.has("w") || keys.has("W"));
      if (axes.x || axes.y) { const length = Math.hypot(axes.x, axes.y); inputRef.current = { x: axes.x / length, y: axes.y / length }; }
      else if (!touchStickRef.current) inputRef.current = { x: 0, y: 0 };
    };
    const onDown = (event: KeyboardEvent) => { if (["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "w", "a", "s", "d", "W", "A", "S", "D"].includes(event.key)) { event.preventDefault(); keysRef.current.add(event.key); updateKeys(); } };
    const onUp = (event: KeyboardEvent) => { keysRef.current.delete(event.key); updateKeys(); };
    const onBlur = () => { keysRef.current.clear(); touchStickRef.current = false; setStick({ x: 0, y: 0 }); inputRef.current = { x: 0, y: 0 }; };
    window.addEventListener("keydown", onDown); window.addEventListener("keyup", onUp); window.addEventListener("blur", onBlur);
    return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); window.removeEventListener("blur", onBlur); keysRef.current.clear(); };
  }, [inGame]);

  useEffect(() => {
    if (page !== "play") return;
    const canvas = canvasRef.current; const ctx = canvas?.getContext("2d"); if (!canvas || !ctx) return;
    let raf = 0; let width = 0; let height = 0;
    const resize = () => { const rect = canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2); width = rect.width; height = rect.height; canvas.width = Math.floor(width * dpr); canvas.height = Math.floor(height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize(); const observer = new ResizeObserver(resize); observer.observe(canvas);
    const draw = () => {
      ctx.clearRect(0, 0, width, height); ctx.fillStyle = "#111b1c"; ctx.fillRect(0, 0, width, height);
      const state = stateRef.current; const players = state?.players ?? []; const me = players.find((p) => p.isYou);
      const predict = (p: Player) => { const age = Math.min(0.11, Math.max(0, (performance.now() - (state?.receivedAt ?? performance.now())) / 1000)); const speed = Math.max(108, 212 - p.radius * 1.3); return { x: p.x + p.moveX * speed * age, y: p.y + p.moveY * speed * age }; };
      const meAt = me ? predict(me) : null;
      if (me && meAt) {
        const scale = Math.min(width / 1050, height / 650, 1.15);
        const cameraX = width / 2 - meAt.x * scale; const cameraY = height / 2 - meAt.y * scale;
        ctx.save(); ctx.translate(cameraX, cameraY); ctx.scale(scale, scale);
        const halfW = width / (2 * scale); const halfH = height / (2 * scale);
        drawInfiniteGround(ctx, meAt.x - halfW - GROUND_TILE_SIZE, meAt.y - halfH - GROUND_TILE_SIZE, meAt.x + halfW + GROUND_TILE_SIZE, meAt.y + halfH + GROUND_TILE_SIZE);
        const sceneTime = performance.now();
        for (const food of state?.food ?? []) {
          drawFood(ctx, food, sceneTime);
        }
        const ordered = [...players].sort((a, b) => a.size - b.size);
        for (const p of ordered) {
          const at = predict(p);
          ctx.globalAlpha = 1;
          if (p.protected) { ctx.save(); ctx.strokeStyle = "rgba(222,244,154,.82)"; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(at.x, at.y, p.radius * 1.55, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.restore(); }
          ctx.save(); ctx.translate(at.x, at.y); ctx.rotate(p.angle + Math.PI / 2);
          const hamster = HAMSTER_SHEETS[p.coat] ?? HAMSTER_SHEETS[0];
          if (hamster.complete && hamster.naturalWidth) {
            const moving = Math.hypot(p.moveX, p.moveY) > .08;
            const frame = moving ? Math.floor(performance.now() / 110) % 4 : 0;
            const cellW = hamster.naturalWidth / 2; const cellH = hamster.naturalHeight / 2;
            const sx = frame % 2 * cellW; const sy = Math.floor(frame / 2) * cellH;
            const bob = moving ? Math.sin(performance.now() / 80 + p.id.charCodeAt(0)) * Math.min(.7, p.radius * .02) : Math.sin(performance.now() / 520 + p.id.charCodeAt(0)) * .25;
            ctx.translate(0, bob); ctx.shadowColor = "#281a11a8"; ctx.shadowBlur = p.radius * .3;
            ctx.drawImage(hamster, sx, sy, cellW, cellH, -p.radius * 1.65, -p.radius * 1.65, p.radius * 3.3, p.radius * 3.3);
          } else {
            ctx.rotate(-Math.PI / 2); ctx.fillStyle = p.color; ctx.beginPath(); ctx.ellipse(0, 0, p.radius * 1.2, p.radius * .88, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "#f4b6b7"; ctx.beginPath(); ctx.arc(p.radius * .45, -p.radius * .72, p.radius * .27, 0, Math.PI * 2); ctx.arc(p.radius * .45, p.radius * .72, p.radius * .27, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "#fff3d8"; ctx.beginPath(); ctx.arc(p.radius * .54, -p.radius * .29, p.radius * .14, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#252c28"; ctx.beginPath(); ctx.arc(p.radius * .59, -p.radius * .29, p.radius * .065, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "#de837e"; ctx.beginPath(); ctx.arc(p.radius * 1.07, 0, p.radius * .15, 0, Math.PI * 2); ctx.fill();
          }
          ctx.restore();
          ctx.textAlign = "center"; let labelY = at.y - p.radius - 13;
          ctx.font = "600 15px 'DM Mono', monospace"; ctx.fillStyle = "#fffbe8"; ctx.lineWidth = 3; ctx.strokeStyle = "#253023"; ctx.strokeText(p.name, at.x, labelY); ctx.fillText(p.name, at.x, labelY);
          if (p.protected) { labelY -= 13; ctx.font = "700 8px 'DM Mono', monospace"; ctx.fillStyle = "#e2f49a"; ctx.fillText("SAFE", at.x, labelY); }
          else if (p.squeek) { labelY -= 15; ctx.fillStyle = "#d9ef64"; ctx.font = "11px 'DM Mono', monospace"; ctx.fillText(`SQUEEK LV.${p.squeekLevel ?? 1}`, at.x, labelY); }
          if (p.notice && (p.noticeUntil ?? 0) > Date.now()) { labelY -= 15; ctx.font = "800 10px 'DM Mono', monospace"; ctx.lineWidth = 3; ctx.strokeStyle = "#202a20"; ctx.strokeText(p.notice, at.x, labelY); ctx.fillStyle = p.notice.startsWith("+") ? "#c8f484" : "#ffad82"; ctx.fillText(p.notice, at.x, labelY); }
          if (p.isYou && (p.popupUntil ?? 0) > Date.now() && (p.popupSeeds ?? 0) > 0) { labelY -= 18; const popup = `+${p.popupSeeds} ${p.popupSeeds === 1 ? "SEED" : "SEEDS"}`; ctx.font = "900 15px 'DM Mono', monospace"; ctx.lineWidth = 4; ctx.strokeStyle = "#253023"; ctx.strokeText(popup, at.x, labelY); ctx.fillStyle = "#e8f77b"; ctx.fillText(popup, at.x, labelY); }
        }
        ctx.restore();
        const miniW = Math.min(150, Math.max(112, width * .27)); const miniH = miniW; const miniX = width - miniW - 13; const miniY = 76; const range = 760;
        ctx.save(); ctx.globalAlpha = .97; ctx.fillStyle = "#0b1411e8"; ctx.fillRect(miniX - 5, miniY - 23, miniW + 10, miniH + 49); ctx.fillStyle = "#29402c"; ctx.fillRect(miniX - 2, miniY - 2, miniW + 4, miniH + 4); ctx.fillStyle = "#a5b97c"; ctx.fillRect(miniX, miniY, miniW, miniH);
        for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) { const hash = (x * 17 + y * 31) % 5; ctx.fillStyle = hash === 0 ? "rgba(57,101,61,.22)" : "rgba(236,220,152,.14)"; ctx.beginPath(); ctx.arc(miniX + x * miniW / 11, miniY + y * miniH / 11, 2 + hash, 0, Math.PI * 2); ctx.fill(); }
        ctx.beginPath(); ctx.rect(miniX, miniY, miniW, miniH); ctx.clip();
        for (const food of state?.food ?? []) { const dx = food.x - meAt.x; const dy = food.y - meAt.y; if (Math.abs(dx) > range || Math.abs(dy) > range) continue; ctx.fillStyle = "#ffe184"; ctx.beginPath(); ctx.arc(miniX + (dx / range + 1) * miniW / 2, miniY + (dy / range + 1) * miniH / 2, 1.1, 0, Math.PI * 2); ctx.fill(); }
        for (const p of players) {
          const point = predict(p); const dx = point.x - meAt.x; const dy = point.y - meAt.y; const nx = dx / range; const ny = dy / range; const distance = Math.hypot(nx, ny); const px = miniX + (Math.max(-1, Math.min(1, nx)) + 1) * miniW / 2; const py = miniY + (Math.max(-1, Math.min(1, ny)) + 1) * miniH / 2;
          if (p.isYou) { ctx.fillStyle = "#fff5a0"; ctx.strokeStyle = "#243221"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
          else if (distance > 1) { const angle = Math.atan2(ny, nx); const edge = 5; const ex = Math.max(miniX + edge, Math.min(miniX + miniW - edge, px)); const ey = Math.max(miniY + edge, Math.min(miniY + miniH - edge, py)); ctx.save(); ctx.translate(ex, ey); ctx.rotate(angle); ctx.fillStyle = p.color; ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-3.5, -3.2); ctx.lineTo(-3.5, 3.2); ctx.closePath(); ctx.fill(); ctx.restore(); }
          else { ctx.fillStyle = p.color; ctx.strokeStyle = "#142019"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(px, py, 3.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
        }
        ctx.strokeStyle = "#e9f3c8a8"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(miniX + miniW / 2, miniY); ctx.lineTo(miniX + miniW / 2, miniY + miniH); ctx.moveTo(miniX, miniY + miniH / 2); ctx.lineTo(miniX + miniW, miniY + miniH / 2); ctx.stroke();
        ctx.textAlign = "left"; ctx.fillStyle = "#e5eddb"; ctx.font = "700 9px 'DM Mono', monospace"; ctx.fillText("BURROW MAP", miniX, miniY - 10); ctx.textAlign = "left"; ctx.fillStyle = "#fff5a0"; ctx.beginPath(); ctx.arc(miniX + 4, miniY + miniH + 12, 3, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#dbe4d5"; ctx.font = "7px 'DM Mono', monospace"; ctx.fillText("YOU", miniX + 10, miniY + miniH + 14); ctx.fillStyle = "#cbd4c5"; ctx.beginPath(); ctx.arc(miniX + 49, miniY + miniH + 12, 2.7, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#dbe4d5"; ctx.fillText("HAMSTERS", miniX + 55, miniY + miniH + 14); ctx.fillStyle = "#cbd4c5"; ctx.beginPath(); ctx.moveTo(miniX + miniW - 5, miniY + miniH + 12); ctx.lineTo(miniX + miniW - 10, miniY + miniH + 9); ctx.lineTo(miniX + miniW - 10, miniY + miniH + 15); ctx.closePath(); ctx.fill();
        ctx.restore();
      } else {
        drawInfiniteGround(ctx, 0, 0, width, height);
        ctx.fillStyle = "rgba(10,16,12,.46)"; ctx.fillRect(0, 0, width, height);
        ctx.textAlign = "center"; ctx.fillStyle = "#b6c4ae"; ctx.font = "500 20px 'Space Grotesk', sans-serif"; ctx.fillText(inGame ? "Finding your burrow…" : "YOUR BURROW STARTS HERE", width / 2, height / 2 - 6);
        ctx.fillStyle = "#7f9382"; ctx.font = "11px 'DM Mono', monospace"; ctx.fillText("JOIN THE LIVE ARENA TO MEET OTHER HAMSTERS", width / 2, height / 2 + 20);
      }
      raf = requestAnimationFrame(draw);
    };
    draw(); return () => { cancelAnimationFrame(raf); observer.disconnect(); };
  }, [inGame, page]);

  const pointInput = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!inGame || event.pointerType !== "mouse" || keysRef.current.size || touchStickRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect(); const dx = (event.clientX - rect.left - rect.width / 2) / (rect.width * .26); const dy = (event.clientY - rect.top - rect.height / 2) / (rect.height * .26); const length = Math.hypot(dx, dy);
    inputRef.current = length > 1 ? { x: dx / length, y: dy / length } : { x: dx, y: dy };
  };
  const stopMouse = (event: PointerEvent<HTMLCanvasElement>) => { if (event.pointerType === "mouse" && !keysRef.current.size && !touchStickRef.current) inputRef.current = { x: 0, y: 0 }; };
  const steerJoystick = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect(); const range = rect.width * .3; const dx = event.clientX - (rect.left + rect.width / 2); const dy = event.clientY - (rect.top + rect.height / 2); const length = Math.hypot(dx, dy); const factor = length > range ? range / length : 1;
    setStick({ x: dx * factor, y: dy * factor }); inputRef.current = length > 0 ? { x: dx / length * Math.min(1, length / range), y: dy / length * Math.min(1, length / range) } : { x: 0, y: 0 };
  };
  const releaseJoystick = () => { touchStickRef.current = false; setStick({ x: 0, y: 0 }); if (!keysRef.current.size) inputRef.current = { x: 0, y: 0 }; };
  const me = arenaState?.players.find((p) => p.isYou);
  const sortedRankings = [...(arenaState?.players ?? [])].sort((a, b) => b.score - a.score);
  const rankings = sortedRankings.slice(0, 5);
  const saveProgress = () => {
    if (!me?.walletLinked) {
      if (!walletAddressRef.current) { setBankMessage("Connect a wallet and switch it to Sepolia, then press save again to link it."); return; }
      if (socketRef.current?.readyState === WebSocket.OPEN) { setBankMessage("Sign a free message to link your wallet to this run…"); socketRef.current.send(JSON.stringify({ type: "link-wallet" })); }
      return;
    }
    if (socketRef.current?.readyState === WebSocket.OPEN) { setBankMessage("Saving your seeds and size…"); socketRef.current.send(JSON.stringify({ type: "bank" })); }
  };

  if (page === "leaderboard") {
    const xpRankings = savedRankings;
    return <section className="content-page leaderboard-page"><div className="content-page-heading"><div><div className="eyebrow"><span /> THE LIVE BURROW</div><h1>Burrow <em>leaderboard.</em></h1><p>Bank seeds during a run to earn permanent XP. Live scores show the current arena; all-time XP stays on your wallet profile.</p></div><div className={`arena-connection ${connected || arenaReady ? "online" : ""}`}><i />{spectating ? "LIVE FEED CONNECTED" : connecting ? "CONNECTING TO ARENA" : arenaReady === false ? "ARENA SERVER OFFLINE" : "WAITING FOR ARENA"}</div></div><div className="leaderboard-tabs"><button className={leaderboardMode === "xp" ? "selected" : ""} onClick={() => setLeaderboardMode("xp")}>ALL-TIME XP</button><button className={leaderboardMode === "live" ? "selected" : ""} onClick={() => setLeaderboardMode("live")}>LIVE ARENA</button></div><div className="leaderboard-panel"><div className="leaderboard-panel-head"><span><Crown size={15}/> {leaderboardMode === "xp" ? "BANKED XP · ALL TIME" : `BURROW ${arenaState?.arenaId ?? 1} · CURRENT RUNS`}</span><span>{leaderboardMode === "xp" ? `${xpRankings.length} PLAYERS` : `${arenaState?.count ?? 0} / 24 PLAYERS · LIVE`}</span></div>{leaderboardMode === "xp" ? xpRankings.length ? <ol className="full-rival-list">{xpRankings.map((p, index) => <li key={p.address}><span className={`rank rank-${index + 1}`}>{String(index + 1).padStart(2, "0")}</span><span className="rival-dot" style={{ background: "#d9ef64" }} /><b>{p.name || p.address}</b><span className="leaderboard-size">{p.address}</span><strong>{p.xp.toLocaleString()}<small> XP</small></strong></li>)}</ol> : <div className="leaderboard-empty"><Users size={26}/><h2>No banked XP yet.</h2><p>Connect and verify a Sepolia wallet, collect seeds, then use “Save &amp; Bank Seeds” in the arena. Each banked seed adds 10 XP.</p></div> : sortedRankings.length ? <ol className="full-rival-list">{sortedRankings.map((p, index) => <li key={p.id}><span className={`rank rank-${index + 1}`}>{String(index + 1).padStart(2, "0")}</span><span className="rival-dot" style={{ background: p.color }} /><b>{p.name}{p.isYou ? " · YOU" : ""}</b><span className="leaderboard-size">SIZE {p.size.toFixed(1)}</span><strong>{p.score}<small> SEEDS</small></strong></li>)}</ol> : <div className="leaderboard-empty"><Users size={26}/><h2>{connecting ? "Finding the live burrow…" : "The burrow is quiet."}</h2><p>{error || "Join an arena to appear on the live run board. Each arena holds up to 24 players."}</p></div>}</div><div className="leaderboard-foot"><span><i className="live-pulse"/> {leaderboardMode === "xp" ? "XP is saved to a verified wallet profile." : "Scores update live while players are connected."}</span><span>{leaderboardMode === "xp" ? "10 XP PER BANKED SEED · NO TOKEN REWARDS" : "SESSION SCORES · CLEARED WHEN THE ARENA RESTARTS"}</span></div></section>;
  }
  if (page !== "play") return null;

  return <section className="burrow-play" id="play">
    <div className="arena-title-row"><div><div className="eyebrow"><span /> THE LIVE BURROW</div><h2>Eat. Grow. <em>Outrun.</em></h2></div><div className={`arena-connection ${connected || arenaReady ? "online" : ""}`}><i />{connected ? "CONNECTED TO ARENA" : arenaReady ? "ARENA SERVER READY" : arenaReady === false ? "ARENA SERVER OFFLINE" : "CHECKING ARENA"}</div></div>
    <div className="arena-grid">
      <div className="arena-machine">
        <div className="arena-topline"><span><i className="live-pulse" /> BURROW {String(arenaState?.arenaId ?? 1).padStart(2, "0")} <b>·</b> SEPOLIA</span><span>{arenaState?.count ?? 0} / 24 PLAYERS</span></div>
        <div className="arena-canvas-wrap"><canvas ref={canvasRef} onPointerMove={pointInput} onPointerDown={pointInput} onPointerLeave={stopMouse} aria-label="Multiplayer hamster arena" />
          {!inGame && <div className="arena-gate"><div className="gate-icon"><Wheat size={24} /></div><span className="gate-kicker">A REAL-TIME MULTIPLAYER GAME</span><h3>Make your mark<br />in the burrow.</h3><p>Gather seeds, grow your hamster, and watch out for the bigger ones.</p><div className="coat-picker" aria-label="Choose your hamster">{COATS.map((coatName, index) => <button key={coatName} className={coat === index ? "selected" : ""} onClick={() => setCoat(index)}><img src={`/arena/hamster-${["gold", "silver", "calico"][index]}.png`} alt=""/><span>{coatName}</span></button>)}</div><label className="player-name-label">YOUR HAMSTER NAME<input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} /></label><button className="join-button" onClick={() => join(false)} disabled={connecting || checkingNft || arenaReady === false || walletWrongNetwork}>{connecting ? "CONNECTING…" : arenaReady === false ? "ARENA SERVER OFFLINE" : walletWrongNetwork ? "SWITCH TO SEPOLIA FIRST" : "ENTER THE BURROW"}<ChevronRight size={17} /></button>{(walletWrongNetwork || showGuestOption) && <button className="join-button guest-join-button" onClick={() => join(true)} disabled={connecting || arenaReady === false}>PLAY AS GUEST</button>}{error && <small className="arena-error">{error}</small>}<small className="join-note">Play free as a guest. Connect and verify a Sepolia wallet to save your size and bank seeds for XP.</small></div>}
          {inGame && <><div className="game-hud"><div><small>SIZE</small><b>{me ? me.size.toFixed(2) : "—"}</b></div><div><small>SEEDS THIS RUN</small><b>{me?.score ?? 0}</b></div><div><small>BANKED XP</small><b>{me?.xp?.toLocaleString() ?? 0}</b></div><div className="hud-hint">BUMP SMALLER HAMSTERS TO STEAL · AVOID BIGGER ONES</div><button className="bank-seeds-button" onClick={saveProgress} disabled={!me}>SAVE SIZE / BANK SEEDS</button><button onClick={leave}>LEAVE</button></div>{bankMessage && <div className="bank-toast" role="status">{bankMessage}<button onClick={() => setBankMessage("")} aria-label="Dismiss">×</button></div>}<div className="touch-joystick" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); touchStickRef.current = true; steerJoystick(event); }} onPointerMove={(event) => { if (touchStickRef.current) steerJoystick(event); }} onPointerUp={releaseJoystick} onPointerCancel={releaseJoystick} aria-label="Touch joystick"><span className="stick-north">▲</span><span className="stick-east">▶</span><span className="stick-south">▼</span><span className="stick-west">◀</span><i style={{ transform: `translate(${stick.x}px, ${stick.y}px)` }} /></div></>}
        </div>
        <div className="arena-controls"><span><b>CURSOR / WASD</b> DIRECT MOVEMENT · RELEASE TO STOP</span><span><i>✦</i> SEEDS · CORN · BERRIES · CARROTS</span><span>GROW TO OUTSIZE A RIVAL</span></div>
      </div>
      <aside className="arena-aside">
        <div className="side-card rival-card"><div className="side-card-head"><span><Crown size={14} /> BURROW LEADERS</span><span>LIVE</span></div>{rankings.length ? <ol className="rival-list">{rankings.map((p, index) => <li key={p.id}><span className={`rank rank-${index + 1}`}>0{index + 1}</span><span className="rival-dot" style={{ background: p.color }} /><b>{p.name}{p.isYou ? " · YOU" : ""}</b><small>{p.score} SEEDS</small></li>)}</ol> : <div className="empty-rivals"><Users size={19} /><span>Join the burrow to<br />start the leaderboard.</span></div>}<div className="side-card-foot">LIVE RUNS RESET · BANK SEEDS FOR ALL-TIME XP</div></div>
        <div className="side-card profile-card"><div className="side-card-head"><span><ShieldCheck size={14} /> YOUR SQUEEK ID</span><span>OPTIONAL</span></div><div className="nft-status"><div className={`nft-emblem ${nftMessage.startsWith("Squeek ownership verified") ? "is-owned" : ""}`}><span>sq</span>{nftMessage.startsWith("Squeek ownership verified") && <i>✓</i>}</div><div><b>{walletAddress ? (nftMessage.startsWith("Squeek ownership verified") ? "SQUEEK FOUND" : "WALLET CONNECTED") : "CONNECT YOUR WALLET"}</b><small>{checkingNft ? "Checking on Sepolia…" : nftMessage}</small></div></div><div className="tier-track"><span>SQUEEK OWNERSHIP</span><b>{nftMessage.startsWith("Squeek ownership verified") ? "CONFIRMED" : walletAddress ? "VERIFYING ON SEPOLIA" : "NOT LINKED"}</b></div><p className="tier-note">Squeek owners receive a larger starting hamster based on their highest confirmed NFT level. Ownership is checked against safe Sepolia account data.</p></div>
        <div className="wheel-card"><div className="wheel-card-head"><span><Radio size={13} /> SQUEEKTOSHI'S WHEEL</span><span>{arenaState?.wheel.fresh ? "LIVE" : "SYNCING"}</span></div><div className="wheel-reading"><div className={`wheel-glyph ${(arenaState?.wheel.rpm ?? 0) > 0.5 ? "spinning" : ""}`} style={{ animationDuration: `${Math.max(0.6, 60 / Math.max(0.1, arenaState?.wheel.rpm ?? 60))}s` }}><span>sq</span></div><div><b>{arenaState?.wheel.rpm?.toFixed(1) ?? "—"}<small> RPM</small></b><span>{arenaState?.wheel.state === "COUNTER_FAULT" ? "COUNTER FAULT" : arenaState?.wheel.state === "ACTIVE" ? "ACTIVE" : arenaState?.wheel.state === "IDLE" ? (arenaState.wheel.rpm > 0.5 ? "IDLE · RPM REPORTED" : "IDLE") : "READING LIVE DATA"}</span></div></div><div className="settled-round-event"><span>CONFIRMED ROUND {arenaState?.wheel.round ?? "—"} · {arenaState?.wheel.roundConfirmed ? "ON SEPOLIA" : "READING CHAIN"}</span><b>{arenaState?.wheel.event?.name ?? "WAITING FOR SETTLEMENT"}</b><small>{arenaState?.wheel.event?.description ?? "The arena event changes only after SqueekCore confirms a round."}</small></div><div className="wheel-card-foot"><span>SETTLED ROUND <b>{arenaState?.wheel.round ?? "—"}</b></span><span>WORK <b>{pretty(arenaState?.wheel.work)}</b></span></div></div>
      </aside>
    </div>
  </section>;
}

export default function App() {
  const chain = useSqueekchain(); const wallet = useWallet(); const telemetry = chain.measurement?.measurement;
  const musicRef = useRef<HTMLAudioElement>(null);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname));
  useEffect(() => { const onPopState = () => setPage(pageFromPath(window.location.pathname)); window.addEventListener("popstate", onPopState); return () => window.removeEventListener("popstate", onPopState); }, []);
  useEffect(() => { const names: Record<Page, string> = { home: "Burrow Rush — Eat. Grow. Outrun.", play: "Play — Burrow Rush", leaderboard: "Leaderboard — Burrow Rush", "how-to": "How to Play — Burrow Rush" }; document.title = names[page]; const description = document.querySelector<HTMLMetaElement>('meta[name="description"]'); if (description) description.content = page === "how-to" ? "Learn Burrow Rush controls, food, hamster growth and seed stealing in the endless Squeekchain-powered arena." : page === "leaderboard" ? "Compare wallet-linked XP and live seed scores from the Burrow Rush multiplayer hamster arena." : page === "play" ? "Enter the endless Burrow Rush multiplayer hamster arena and gather food with live Squeekchain data." : "An endless multiplayer hamster arena. Gather food, grow, and outplay the burrow with live Squeekchain data."; }, [page]);
  const navigate = (event: ReactMouseEvent<HTMLAnchorElement>, target: Page) => { event.preventDefault(); const path = target === "home" ? "/" : target === "how-to" ? "/how-to" : `/${target}`; if (window.location.pathname !== path) window.history.pushState(null, "", path); setPage(target); window.scrollTo(0, 0); };
  const pageLink = (target: Page, label: string) => <a className={page === target ? "active" : ""} href={target === "home" ? "/" : target === "how-to" ? "/how-to" : `/${target}`} onClick={(event) => navigate(event, target)}>{label}</a>;
  const arenaWallet = wallet.address && wallet.chainId === "0xaa36a7" ? wallet.address : null;
  const toggleMusic = async () => {
    const audio = musicRef.current;
    if (!audio) return;
    if (musicPlaying) { audio.pause(); setMusicPlaying(false); return; }
    try { audio.volume = 0.28; await audio.play(); setMusicPlaying(true); }
    catch { setMusicPlaying(false); }
  };
  return <div className="burrow-app">
    <audio ref={musicRef} src="/background-music.m4a" loop preload="none" onPause={() => setMusicPlaying(false)} onPlay={() => setMusicPlaying(true)} />
    <header className="burrow-header"><a className="burrow-logo" href="/" onClick={(event) => navigate(event, "home")}><span className="logo-mark">b.</span><span>BURROW<span className="logo-soft">RUSH</span></span></a><nav>{pageLink("home", "HOME")}{pageLink("play", "PLAY")}{pageLink("leaderboard", "LEADERBOARD")}{pageLink("how-to", "HOW TO") }<span className="net-pill"><i /> SEPOLIA TESTNET</span><button className={`music-toggle${musicPlaying ? " is-playing" : ""}`} onClick={toggleMusic} aria-label={musicPlaying ? "Pause background music" : "Play background music"} aria-pressed={musicPlaying} title="Background music">{musicPlaying ? <Volume2 size={14} /> : <VolumeX size={14} />}<span>MUSIC {musicPlaying ? "ON" : "OFF"}</span></button>{wallet.address ? wallet.chainId !== "0xaa36a7" ? <button className="wallet-pill" onClick={wallet.switchToSepolia} disabled={wallet.pending}>{wallet.pending ? "SWITCHING…" : "SWITCH TO SEPOLIA"}</button> : <button className="wallet-pill" title={wallet.address}>{wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}</button> : <button className="wallet-pill" onClick={wallet.connect} disabled={wallet.pending}><Wallet size={14} />{wallet.pending ? "CONNECTING" : "CONNECT WALLET"}</button>}</nav></header>
    {wallet.error && <div className="burrow-wallet-error">{wallet.error}<button onClick={wallet.clearError}>×</button></div>}
    <main id="top">
      {page === "home" && <>
        <section className="burrow-hero"><div className="hero-bloom bloom-a"/><div className="hero-bloom bloom-b"/><div className="hero-copy"><div className="eyebrow"><span /> A LIVE MULTIPLAYER BURROW</div><h1>Small paws.<br /><em>Big burrow.</em></h1><p>Scavenge seeds. Grow your hamster. Outrun the ones who got bigger first.</p><div className="hero-actions"><a className="hero-cta" href="/play" onClick={(event) => navigate(event, "play")}>PLAY THE ARENA <ArrowDownRight size={16} /></a><span>REAL PLAYERS · LIVE SQUEEKCHAIN DATA</span></div><div className="hero-facts"><div><b><Users size={15} /> REAL PLAYERS</b><span>24 players per arena</span></div><div><b><Leaf size={15} /> EAT TO GROW</b><span>Seeds, corn & berries</span></div><div><b><Sparkles size={15} /> NO WAGERS</b><span>Just play and survive</span></div></div></div>
          <div className="burrow-art burrow-art-image"><img src="/og-burrow-rush.png" alt="Burrow Rush: a golden hamster and a smaller silver hamster racing to gather food in the burrow."/><span className="hero-art-live"><i/> LIVE BURROW · SEPOLIA</span></div>
        </section>
        <section className="chain-strip"><div className="chain-strip-title" title={chain.error ?? "Reading official Squeekchain Sepolia data."}><i className={chain.core ? "" : "offline"}/><span>{chain.core ? "SQUEEKCHAIN CONNECTED" : chain.error ? "SQUEEKCHAIN DATA UNAVAILABLE" : "SYNCING SQUEEKCHAIN DATA"}</span></div><div><small>WHEEL</small><b>{telemetry?.coreStatus ?? "—"}</b></div><div><small>RPM</small><b>{telemetry ? (telemetry.rpmMilli / 1000).toFixed(1) : "—"}</b></div><div><small>SETTLED ROUND</small><b>{pretty(chain.core?.core.settledThroughRound)}</b></div><div><small>SQUEEK BLOCK</small><b>{pretty(chain.core?.core.blockHeight)}</b></div><a href="https://docs.squeekchain.com/developers/api/" target="_blank" rel="noreferrer">DATA SOURCE <ArrowUpRight size={12}/></a></section>
        <section className="home-pages"><div className="home-pages-heading"><div className="eyebrow"><span/> FIND YOUR WAY</div><h2>One burrow.<br/><em>Four ways in.</em></h2></div><div className="home-pages-grid"><a href="/play" onClick={(event) => navigate(event, "play")}><span>01 / PLAY</span><b>Enter the arena <ArrowUpRight size={17}/></b><small>Collect food, grow, and try to take seeds from smaller rivals.</small></a><a href="/leaderboard" onClick={(event) => navigate(event, "leaderboard")}><span>02 / LEADERBOARD</span><b>See who is growing <ArrowUpRight size={17}/></b><small>Compare live runs and permanent wallet-linked XP.</small></a><a href="/how-to" onClick={(event) => navigate(event, "how-to")}><span>03 / HOW TO</span><b>Learn the burrow <ArrowUpRight size={17}/></b><small>Controls, food, stealing rules, and the Squeekchain connection.</small></a></div></section>
      </>}
      {(page === "play" || page === "leaderboard") && <Arena page={page} walletAddress={arenaWallet} walletWrongNetwork={Boolean(wallet.address && wallet.chainId !== "0xaa36a7")}/>}
      {page === "how-to" && <section className="content-page how-to-page"><div className="content-page-heading"><div><div className="eyebrow"><span /> START HERE</div><h1>How to <em>play.</em></h1><p>Endless numbered arenas, up to 24 players each. Find food, get bigger, and choose your fights.</p></div><a className="hero-cta" href="/play" onClick={(event) => navigate(event, "play")}>ENTER THE BURROW <ArrowDownRight size={16}/></a></div><div className="how-cards"><article><span>01 / SCAVENGE</span><div className="how-icon seed-icon">✦</div><h3>Find the food</h3><p>Seeds, corn, berries and carrots appear around the live players. Eat them to gain seeds and grow.</p></article><article><span>02 / GROW</span><div className="how-icon grow-icon"><ArrowUpRight size={22}/></div><h3>Steer your hamster</h3><p>Use your cursor or WASD/arrow keys on desktop. On touch screens, drag the on-screen joystick. Release to stop.</p></article><article><span>03 / SURVIVE</span><div className="how-icon survive-icon"><CircleHelp size={22}/></div><h3>Pick your fights</h3><p>A hamster at least 5% larger can steal seeds on contact. With carried seeds, the smaller hamster loses seeds and shrinks while the larger one grows. After banking, bigger rivals can still bump a seedless hamster smaller, but cannot steal banked seeds.</p></article></div><div className="how-extra-grid"><article><span>SAFE START</span><h3>Three seconds to get moving</h3><p>A dashed ring and SAFE label protect each new arrival briefly. After that, size and contact determine who can steal.</p></article><article><span>SQUEEKCHAIN DATA</span><h3>The wheel feeds the burrow</h3><p>Burrow Rush reads public wheel status and SqueekCore's safely confirmed settled round. Each confirmed round selects a shared food event; matching food gives two seeds and double growth until the next round settles. Save your size and bank seeds any time with a verified wallet. Each saved seed becomes 10 XP on the all-time leaderboard. Banking resets your run seed count, while your current size stays for this run and is restored next time. XP has no token value.</p></article><article><span>WALLETS ARE OPTIONAL</span><h3>Play without a transaction</h3><p>A Sepolia wallet can sign a message (no transaction) to save your hamster size and bank seeds for XP. Guest play remains available, but guest progress is not stored.</p></article></div></section>}
    </main>
    <footer className="burrow-footer"><a className="burrow-logo" href="/" onClick={(event) => navigate(event, "home")}><span className="logo-mark">b.</span><span>BURROW<span className="logo-soft">RUSH</span></span></a><span>AN INDEPENDENT COMMUNITY GAME · SEPOLIA TESTNET</span><a href="https://squeekchain.com/genesis/code" target="_blank" rel="noreferrer">SQUEEKCHAIN GENESIS <ArrowUpRight size={12}/></a></footer>
  </div>;
}
