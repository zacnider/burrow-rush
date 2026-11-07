import { createServer } from "node:http";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { recoverPersonalSign } from "./ethereum.mjs";

const PORT = Number(process.env.PORT || process.env.ARENA_PORT || 8787);
const MAX_PLAYERS = 24;
const MAX_RADIUS = 70;
const SQUEEK_CORE_ADDRESS = "0xfd6c166d4b8e2962e65746a13e5a0797cd4de0c4";
const ROUND_EVENTS = [
  { name: "SEED RUSH", foodKind: 0, description: "Sunflower seeds from the settled round are worth 2 seeds." },
  { name: "CORN FEAST", foodKind: 1, description: "Corn from the settled round is worth 2 seeds." },
  { name: "BERRY BLOOM", foodKind: 2, description: "Berries from the settled round are worth 2 seeds." },
  { name: "CARROT TRAIL", foodKind: 3, description: "Carrots from the settled round are worth 2 seeds." },
];
const PROFILE_FILE = resolve(process.env.ARENA_DATA_FILE || join(process.cwd(), "server", "data", "profiles.json"));
const configuredOrigins = process.env.ARENA_ORIGINS;
const allowedOrigins = new Set((configuredOrigins || "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173").split(",").map((origin) => origin.trim()).filter(Boolean));
function isAllowedOrigin(origin) {
  if (allowedOrigins.has(origin)) return true;
  if (configuredOrigins) return false;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch { return false; }
}
const peers = new Map();
const players = new Map();
const profiles = new Map();
let food = [];
let currentArena = 1;
const arenaCounts = new Map();
let latestWheel = { state: "UNKNOWN", rpm: 0, round: "—", work: "—", fresh: false, roundConfirmed: false, event: null };
let previousRound = null;
let lastFoodId = 1;
let lastFoodCleanup = 0;
let profileWriteQueue = Promise.resolve();

await mkdir(dirname(PROFILE_FILE), { recursive: true });
try {
  const stored = JSON.parse(await readFile(PROFILE_FILE, "utf8"));
  for (const item of Array.isArray(stored) ? stored : []) {
    if (!/^0x[a-f\d]{40}$/i.test(item?.address ?? "")) continue;
    profiles.set(item.address.toLowerCase(), { address: item.address.toLowerCase(), name: String(item.name || "Nibble").slice(0, 16), xp: Math.max(0, Number(item.xp) || 0), seedsBanked: Math.max(0, Number(item.seedsBanked) || 0), savedRadius: Math.min(MAX_RADIUS, Math.max(14, Number(item.savedRadius) || 14)), updatedAt: String(item.updatedAt || "") });
  }
} catch (error) { if (error?.code !== "ENOENT") console.error("Could not load player profiles:", error); }

function persistProfiles() {
  const snapshot = JSON.stringify([...profiles.values()], null, 2);
  const task = profileWriteQueue.catch(() => {}).then(async () => {
    const temporary = `${PROFILE_FILE}.${process.pid}.tmp`;
    await writeFile(temporary, snapshot, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, PROFILE_FILE);
  });
  profileWriteQueue = task;
  return task;
}

function roundEvent(round) {
  if (!/^\d+$/.test(String(round))) return null;
  const roundNumber = BigInt(round);
  const index = Number((roundNumber === 0n ? 0n : roundNumber - 1n) % BigInt(ROUND_EVENTS.length));
  return { ...ROUND_EVENTS[index], round: String(round) };
}

function randomFood(x, y, kind = null, arenaId = null) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    const anchors = [...players.values()].filter((player) => arenaId == null || player.arenaId === arenaId); const anchor = anchors.length ? anchors[Math.floor(Math.random() * anchors.length)] : { x: arenaId ? arenaId * 100000 : 0, y: 0 };
    const angle = Math.random() * Math.PI * 2; const distance = 100 + Math.sqrt(Math.random()) * 820;
    x = anchor.x + Math.cos(angle) * distance; y = anchor.y + Math.sin(angle) * distance;
  }
  const event = latestWheel.event;
  const selectedKind = Number.isInteger(kind) ? kind : event && Math.random() < .42 ? event.foodKind : Math.floor(Math.random() * 4);
  return { id: lastFoodId++, x, y, kind: selectedKind, arenaId: arenaId ?? 1, eventRound: event && selectedKind === event.foodKind ? event.round : null };
}
function randomFoodNear(x, y, radius = 560, arenaId = 1) {
  const angle = Math.random() * Math.PI * 2; const distance = 85 + Math.sqrt(Math.random()) * (radius - 85);
  return randomFood(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, null, arenaId);
}
function findSpawn(radius = 18, arenaId = 1) {
  const anchors = [...players.values()].filter((player) => player.arenaId === arenaId); const center = anchors.length ? anchors[Math.floor(Math.random() * anchors.length)] : { x: arenaId * 100000, y: 0 };
  for (let attempt = 0; attempt < 100; attempt++) {
    const x = center.x + (Math.random() - .5) * 850; const y = center.y + (Math.random() - .5) * 850;
    if (anchors.every((player) => Math.hypot(x - player.x, y - player.y) > radius * 3)) return { x, y };
  }
  return { x: center.x + 180, y: center.y + 180 };
}

function frame(opcode, payload = Buffer.alloc(0)) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let header;
  if (body.length < 126) header = Buffer.from([0x80 | opcode, body.length]);
  else if (body.length <= 65535) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(body.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(body.length), 2); }
  return Buffer.concat([header, body]);
}

function send(peer, value) {
  if (peer.destroyed) return;
  try { peer.write(frame(1, JSON.stringify(value))); } catch { peer.destroy(); }
}

function readFrames(peer, chunk) {
  peer.buffer = Buffer.concat([peer.buffer ?? Buffer.alloc(0), chunk]);
  while (peer.buffer.length >= 2) {
    const b0 = peer.buffer[0]; const b1 = peer.buffer[1]; const opcode = b0 & 0x0f; const masked = (b1 & 0x80) !== 0;
    let length = b1 & 0x7f; let offset = 2;
    if (length === 126) { if (peer.buffer.length < 4) return; length = peer.buffer.readUInt16BE(2); offset = 4; }
    else if (length === 127) { if (peer.buffer.length < 10) return; const bigLength = peer.buffer.readBigUInt64BE(2); if (bigLength > 65536n) { peer.destroy(); return; } length = Number(bigLength); offset = 10; }
    const maskOffset = offset;
    if (masked) offset += 4;
    if (peer.buffer.length < offset + length) return;
    let payload = peer.buffer.subarray(offset, offset + length);
    if (masked) { const key = peer.buffer.subarray(maskOffset, maskOffset + 4); payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= key[i % 4]; }
    peer.buffer = peer.buffer.subarray(offset + length);
    if (opcode === 8) { peer.end(frame(8)); return; }
    if (opcode === 9) { peer.write(frame(10, payload)); continue; }
    if (opcode !== 1) continue;
    try { handleMessage(peer, JSON.parse(payload.toString("utf8"))); }
    catch { send(peer, { type: "error", message: "Invalid message. Reconnect and try again." }); }
  }
}

function profileFor(address, hasSqueek, squeekLevel) {
  const key = address?.toLowerCase();
  if (!key) return null;
  let profile = profiles.get(key);
  if (!profile) {
    profile = { address: key, name: "Nibble", xp: 0, seedsBanked: 0, savedRadius: hasSqueek ? 14 + Math.min(6, Math.max(1, squeekLevel)) : 14, updatedAt: "" };
    profiles.set(key, profile);
  }
  return profile;
}

function spawnPlayer(name, color, socket, hasSqueek, squeekLevel = 0, coat = 0, profile = null, arenaId = 1) {
  const id = randomUUID().slice(0, 8);
  const holderRadius = hasSqueek ? 14 + Math.min(6, Math.max(1, squeekLevel)) : 14;
  const radius = Math.min(MAX_RADIUS, Math.max(holderRadius, Number(profile?.savedRadius) || 14));
  const spawn = findSpawn(radius, arenaId);
  const player = { id, name, color, coat, ...spawn, arenaId, angle: -Math.PI / 2, moveX: 0, moveY: 0, radius, score: 0, popupSeeds: 0, popupUntil: 0, socket, squeek: hasSqueek, squeekLevel, profile, walletLinked: Boolean(profile), xp: profile?.xp ?? 0, lastInput: 0, lastStealAt: 0, lastFoodRefresh: 0, lastStealNotice: "", lastStealNoticeUntil: 0, shieldUntil: Date.now() + 3000 };
  players.set(id, player);
  const nearbyFood = food.filter((item) => item.arenaId === arenaId && Math.abs(item.x - player.x) < 650 && Math.abs(item.y - player.y) < 650).length;
  for (let i = nearbyFood < 95 ? 125 - nearbyFood : 0; i > 0; i--) randomFoodNear(player.x, player.y, 560, arenaId);
  return player;
}

function walletLoginMessage(nonce) { return `Burrow Rush Sepolia sign-in\nNonce: ${nonce}`; }

async function authenticateWallet(address, signature, nonce) {
  if (!/^0x[a-f\d]{40}$/i.test(address)) throw new Error("Connect a valid Sepolia wallet first.");
  const recovered = recoverPersonalSign(walletLoginMessage(nonce), signature);
  if (recovered.toLowerCase() !== address.toLowerCase()) throw new Error("The wallet signature did not match the connected address.");
  const response = await fetch(`https://api.squeekchain.com/v1/accounts/${address}?limit=100`, { signal: AbortSignal.timeout(4500), headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("Squeekchain ownership lookup is temporarily unavailable.");
  const account = await response.json();
  if (account?.schemaVersion !== 3 || account?.status !== "available" || account?.account?.toLowerCase() !== address.toLowerCase()) throw new Error("Squeekchain could not confirm this account right now.");
  const count = Number(account.tokenCounts?.wallet ?? 0) + Number(account.tokenCounts?.staking ?? 0);
  const hasSqueek = Number.isFinite(count) && count > 0;
  const squeekLevel = hasSqueek && Array.isArray(account.tokens) ? Math.max(1, ...account.tokens.map((token) => Number(token.level) || 0)) : 0;
  return { address: address.toLowerCase(), hasSqueek, squeekLevel };
}

function removePlayer(peer) {
  const id = peer.playerId;
  if (id) {
    const player = players.get(id);
    if (player) arenaCounts.set(player.arenaId, Math.max(0, (arenaCounts.get(player.arenaId) ?? 1) - 1));
    players.delete(id);
  }
  peers.delete(peer);
}

async function bankSeeds(peer) {
  const player = players.get(peer.playerId);
  if (!player) return;
  if (!peer.walletAddress || !peer.profile) { send(peer, { type: "bank-result", ok: false, message: "Connect and verify a Sepolia wallet, then re-enter the arena to save XP." }); return; }
  if (player.bankPending) return;
  player.bankPending = true;
  const profile = peer.profile; const previous = { ...profile }; const banked = player.score; const xpEarned = banked * 10;
  profile.name = player.name; profile.xp += xpEarned; profile.seedsBanked += banked; profile.savedRadius = player.radius; profile.updatedAt = new Date().toISOString();
  player.score = 0; player.xp = profile.xp;
  try {
    await persistProfiles();
    send(peer, { type: "bank-result", ok: true, banked, xpEarned, xp: profile.xp, savedSize: profile.savedRadius / 14, message: banked ? `Saved ${banked} seeds · +${xpEarned} XP. Your size is saved for next time.` : "Your current hamster size is saved for next time." });
  } catch (error) {
    Object.assign(profile, previous); player.score += banked; player.xp = profile.xp;
    send(peer, { type: "bank-result", ok: false, message: "Could not save your progress to the arena storage. Please try again." });
    console.error("Could not persist player progress:", error);
  } finally { player.bankPending = false; }
}

function handleMessage(peer, msg) {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "watch" && !peer.playerId) {
    peer.spectator = true;
    send(peer, { type: "watch-ready" });
    return;
  }
  if (msg.type === "guest" && !peer.authDone) {
    peer.authDone = true; peer.hasSqueek = false;
    send(peer, { type: "auth-result", authenticated: false, linkedExisting: Boolean(peer.playerId), hasSqueek: false, message: peer.playerId ? "Wallet linking was skipped; you are still playing as a guest." : "Playing as a guest." });
    return;
  }
  if (msg.type === "auth" && !peer.authDone && typeof msg.signature === "string" && typeof msg.address === "string") {
    const nonce = peer.nonce; peer.nonce = null; peer.authDone = true; peer.authPending = true;
    void authenticateWallet(msg.address, msg.signature, nonce).then((result) => {
      peer.walletAddress = result.address; peer.hasSqueek = result.hasSqueek; peer.squeekLevel = result.squeekLevel;
      peer.profile = profileFor(result.address, result.hasSqueek, result.squeekLevel);
      if (peer.playerId) { const player = players.get(peer.playerId); if (player) { player.profile = peer.profile; player.walletLinked = true; player.xp = peer.profile.xp; player.squeek = result.hasSqueek; player.squeekLevel = result.squeekLevel; player.radius = Math.min(MAX_RADIUS, Math.max(player.radius, peer.profile.savedRadius, result.hasSqueek ? 14 + Math.min(6, Math.max(1, result.squeekLevel)) : 14)); } }
      peer.authPending = false;
      send(peer, { type: "auth-result", authenticated: true, linkedExisting: Boolean(peer.playerId), hasSqueek: result.hasSqueek, squeekLevel: result.squeekLevel, xp: peer.profile.xp, savedSize: peer.profile.savedRadius / 14, message: result.hasSqueek ? `Squeek ownership verified · highest level ${result.squeekLevel}.` : "Wallet verified · progress saving enabled." });
    }).catch((error) => {
      peer.hasSqueek = false; peer.authPending = false; peer.authDone = false;
      send(peer, { type: "auth-result", authenticated: false, linkedExisting: Boolean(peer.playerId), hasSqueek: false, message: error instanceof Error ? error.message : "Wallet verification failed." });
    });
    return;
  }
  if (msg.type === "link-wallet" && peer.playerId && !peer.authPending) {
    peer.authDone = false; peer.nonce = randomBytes(24).toString("hex");
    send(peer, { type: "challenge", nonce: peer.nonce, purpose: "link-wallet" });
    return;
  }
  if (msg.type === "join") {
    if (peer.playerId) return;
    if (!peer.authDone || peer.authPending) { send(peer, { type: "error", message: "Finish wallet verification or continue as a guest first." }); return; }
    if ((arenaCounts.get(currentArena) ?? 0) >= MAX_PLAYERS) currentArena++;
    const name = typeof msg.name === "string" ? msg.name.replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 16) : "Nibble";
    const colors = new Set(["#ffca68", "#87dfb0", "#9db7ff", "#f59c9d", "#d4a7ff", "#84d6e8", "#ffc0dc"]);
    const color = colors.has(msg.color) ? msg.color : "#ffca68";
    const coat = Number.isInteger(msg.coat) && msg.coat >= 0 && msg.coat <= 2 ? msg.coat : Math.floor(Math.random() * 3);
    const profile = peer.walletAddress ? (peer.profile ?? profileFor(peer.walletAddress, peer.hasSqueek === true, peer.squeekLevel ?? 0)) : null;
    if (profile) profile.name = name || "Nibble";
    const arenaId = currentArena;
    const player = spawnPlayer(name || "Nibble", color, peer, peer.hasSqueek === true, peer.squeekLevel ?? 0, coat, profile, arenaId);
    arenaCounts.set(arenaId, (arenaCounts.get(arenaId) ?? 0) + 1);
    peer.playerId = player.id;
    peer.arenaId = arenaId;
    return;
  }
  if (msg.type === "bank" && peer.playerId) { void bankSeeds(peer); return; }
  if (msg.type === "input" && peer.playerId) {
    const player = players.get(peer.playerId); let moveX = Number(msg.x); let moveY = Number(msg.y);
    if (player && Number.isFinite(moveX) && Number.isFinite(moveY) && Date.now() - player.lastInput >= 30) {
      const magnitude = Math.hypot(moveX, moveY); if (magnitude > 1) { moveX /= magnitude; moveY /= magnitude; }
      player.moveX = moveX; player.moveY = moveY;
      if (Math.hypot(moveX, moveY) > 0.08) player.angle = Math.atan2(moveY, moveX);
      player.lastInput = Date.now();
    }
  }
}

const WEB_ROOT = resolve(process.env.WEB_ROOT || join(process.cwd(), "dist"));
const MIME_TYPES = { ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".ico": "image/x-icon", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".mp3": "audio/mpeg", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".woff2": "font/woff2" };

async function serveWeb(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
  catch { res.writeHead(400); res.end("Bad request"); return; }
  const relative = pathname.replace(/^\/+/, "");
  let file = resolve(WEB_ROOT, relative || "index.html");
  if (file !== WEB_ROOT && !file.startsWith(`${WEB_ROOT}/`)) { res.writeHead(403); res.end("Forbidden"); return; }
  try {
    let content = await readFile(file);
    const extension = file.slice(file.lastIndexOf(".")).toLowerCase();
    const cacheControl = extension === ".html" ? "no-cache" : pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600";
    res.writeHead(200, { "content-type": MIME_TYPES[extension] || "application/octet-stream", "cache-control": cacheControl });
    res.end(content);
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "EISDIR") { res.writeHead(500); res.end("Internal server error"); return; }
    if (pathname.startsWith("/api/") || pathname.startsWith("/arena/")) { res.writeHead(404); res.end("Not found"); return; }
    try { res.writeHead(200, { "content-type": MIME_TYPES[".html"], "cache-control": "no-cache" }); res.end(await readFile(join(WEB_ROOT, "index.html"))); }
    catch { res.writeHead(503, { "content-type": "text/plain; charset=utf-8" }); res.end("Site assets are not built yet. Run npm run build."); }
  }
}

const server = createServer((req, res) => {
  if (req.url === "/health") { res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(JSON.stringify({ ok: true, players: [...players.values()].filter((p) => p.arenaId === currentArena).length, maxPlayers: MAX_PLAYERS, arena: currentArena })); return; }
  if (req.url?.split("?")[0] === "/leaderboard") {
    const ranked = [...profiles.values()].filter((profile) => profile.xp > 0).sort((a, b) => b.xp - a.xp || b.seedsBanked - a.seedsBanked).slice(0, 100).map((profile) => ({ address: `${profile.address.slice(0, 6)}…${profile.address.slice(-4)}`, name: profile.name, xp: profile.xp, seedsBanked: profile.seedsBanked, savedSize: Number((profile.savedRadius / 14).toFixed(2)), updatedAt: profile.updatedAt }));
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" }); res.end(JSON.stringify({ players: ranked })); return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end("Method not allowed"); return; }
  void serveWeb(req, res);
});

server.on("upgrade", (req, socket) => {
  const origin = req.headers.origin;
  if (req.url !== "/arena" || !req.headers["sec-websocket-key"] || (origin && !isAllowedOrigin(origin))) { socket.destroy(); return; }
  const accept = createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`, "\r\n"].join("\r\n"));
  socket.buffer = Buffer.alloc(0); peers.set(socket, true);
  socket.nonce = randomBytes(24).toString("hex");
  send(socket, { type: "challenge", nonce: socket.nonce });
  socket.on("data", (chunk) => readFrames(socket, chunk));
  socket.on("error", () => removePlayer(socket));
  socket.on("close", () => removePlayer(socket));
  socket.on("end", () => removePlayer(socket));
});

function tick() {
  const wheelRate = latestWheel.fresh && latestWheel.state === "ACTIVE" ? 1.65 : 1;
  const now = Date.now();
  for (const player of players.values()) {
    const speed = Math.max(108, 212 - player.radius * 1.3);
    player.x += player.moveX * speed * 0.05;
    player.y += player.moveY * speed * 0.05;
    if (player.popupUntil && now > player.popupUntil) player.popupSeeds = 0;
    for (let i = food.length - 1; i >= 0; i--) {
      const pellet = food[i]; const fx = player.x - pellet.x; const fy = player.y - pellet.y;
      if (pellet.arenaId === player.arenaId && fx * fx + fy * fy < (player.radius + 14) ** 2) {
        food.splice(i, 1);
        const roundBonus = pellet.eventRound === latestWheel.event?.round && pellet.kind === latestWheel.event.foodKind ? 2 : 1;
        player.score += roundBonus; player.popupSeeds += roundBonus; player.popupUntil = now + 850;
        player.radius = Math.min(MAX_RADIUS, player.radius + 0.48 * roundBonus);
      }
    }
    if (now - player.lastFoodRefresh > 1200) {
      const localCount = food.filter((item) => item.arenaId === player.arenaId && Math.abs(item.x - player.x) < 620 && Math.abs(item.y - player.y) < 620).length;
      if (localCount < 85) for (let i = 0; i < Math.min(18, 100 - localCount); i++) randomFoodNear(player.x, player.y, 560, player.arenaId);
      player.lastFoodRefresh = now;
    }
  }
  const list = [...players.values()];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i]; const b = list[j];
    if (a.arenaId !== b.arenaId) continue;
    if (now < a.shieldUntil || now < b.shieldUntil) continue;
    // Sprite art extends past the logical radius. Match its visible body overlap
    // so players do not need to drive their hamsters nearly on top of each other.
    if (Math.hypot(a.x - b.x, a.y - b.y) > (a.radius + b.radius) * 1.2) continue;
    let hunter = null; let smaller = null;
    if (a.radius > b.radius * 1.05) { hunter = a; smaller = b; }
    else if (b.radius > a.radius * 1.05) { hunter = b; smaller = a; }
    if (!hunter || now - hunter.lastStealAt < 500) continue;
    const minRadius = smaller.squeek ? 14 + Math.min(6, Math.max(1, smaller.squeekLevel)) : 14;
    if (smaller.score > 0) {
      const stolen = Math.min(5, smaller.score, Math.max(1, Math.floor((hunter.radius - smaller.radius) * .65) + 1));
      smaller.score -= stolen; smaller.radius = Math.max(minRadius, smaller.radius - stolen * .48);
      hunter.score += stolen; hunter.radius = Math.min(MAX_RADIUS, hunter.radius + stolen * .48);
      hunter.lastStealNotice = `+${stolen} SEEDS`; hunter.lastStealNoticeUntil = now + 1350;
      smaller.lastStealNotice = `-${stolen} SEEDS`; smaller.lastStealNoticeUntil = now + 1350;
    } else {
      // Banking turns carried seeds into permanent XP, but does not make a
      // seedless large hamster immune to being pushed back down in size.
      smaller.radius = Math.max(minRadius, smaller.radius - .48);
      hunter.lastStealNotice = "NO SEEDS"; hunter.lastStealNoticeUntil = now + 1100;
      smaller.lastStealNotice = "-SIZE"; smaller.lastStealNoticeUntil = now + 1350;
    }
    hunter.lastStealAt = now;
  }
  if (now - lastFoodCleanup > 10000) {
    const activePlayers = [...players.values()];
    if (activePlayers.length) food = food.filter((item) => activePlayers.some((player) => player.arenaId === item.arenaId && Math.abs(item.x - player.x) < 1800 && Math.abs(item.y - player.y) < 1800));
    for (const arenaId of new Set(food.map((item) => item.arenaId))) {
      const arenaFood = food.filter((item) => item.arenaId === arenaId);
      if (arenaFood.length > 2600) { const keep = new Set(arenaFood.slice(-2200).map((item) => item.id)); food = food.filter((item) => item.arenaId !== arenaId || keep.has(item.id)); }
    }
    lastFoodCleanup = now;
  }
  for (const arenaId of new Set([...players.values()].map((player) => player.arenaId))) {
    const count = [...players.values()].filter((player) => player.arenaId === arenaId).length;
    const desiredFood = 150 + Math.min(90, count * 4) + (latestWheel.fresh && latestWheel.state === "ACTIVE" ? 35 : 0);
    if (food.filter((item) => item.arenaId === arenaId).length < desiredFood && Math.random() < 0.07 * wheelRate) food.push(randomFood(undefined, undefined, null, arenaId));
  }
}

function broadcast() {
  const playerState = [...players.values()].map((p) => ({ id: p.id, name: p.name, x: p.x, y: p.y, radius: p.radius, size: p.radius / 14, angle: p.angle, moveX: p.moveX, moveY: p.moveY, color: p.color, coat: p.coat, score: p.score, popupSeeds: p.popupSeeds, popupUntil: p.popupUntil, squeek: p.squeek, squeekLevel: p.squeekLevel, walletLinked: p.walletLinked, xp: p.xp, savedSize: p.profile?.savedRadius ? p.profile.savedRadius / 14 : 1, protected: Date.now() < p.shieldUntil, notice: p.lastStealNotice, noticeUntil: p.lastStealNoticeUntil, arenaId: p.arenaId }));
  for (const peer of peers.keys()) {
    if (!peer.playerId && !peer.spectator) continue;
    const arenaId = peer.arenaId ?? currentArena;
    const inArena = playerState.filter((p) => p.arenaId === arenaId);
    const packetPlayers = inArena.map((p) => p.id === peer.playerId ? { ...p, isYou: true } : { ...p, isYou: false });
    const packetFood = food.filter((item) => item.arenaId === arenaId);
    send(peer, { type: "state", count: inArena.length, arenaId, players: packetPlayers, food: packetFood, wheel: latestWheel });
  }
}

async function pollSqueek() {
  try {
    const response = await fetch("https://api.squeekchain.com/v1/status", { signal: AbortSignal.timeout(3500), headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const data = await response.json(); const m = data.measurement;
    latestWheel = { ...latestWheel, state: m?.coreStatus ?? "UNKNOWN", rpm: Number(m?.rpmMilli ?? 0) / 1000, work: String(m?.cumulativeWorkUnits ?? "—"), fresh: m?.freshness === "online" };
  } catch { latestWheel = { ...latestWheel, fresh: false }; }
  try {
    const response = await fetch("https://api.squeekchain.com/v1/core", { signal: AbortSignal.timeout(4500), headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`core status ${response.status}`);
    const data = await response.json();
    const round = String(data?.core?.settledThroughRound ?? "");
    const safeBlock = String(data?.chain?.safeThroughBlock ?? "");
    if (data?.schemaVersion !== 1 || data?.status !== "available" || data?.identities?.core?.toLowerCase() !== SQUEEK_CORE_ADDRESS || !/^\d+$/.test(round) || !/^\d+$/.test(safeBlock)) throw new Error("SqueekCore deployment or confirmed state could not be verified.");
    if (previousRound !== null && BigInt(round) < BigInt(previousRound)) throw new Error("Confirmed round moved backwards.");
    const event = roundEvent(round);
    latestWheel = { ...latestWheel, round, roundConfirmed: true, event };
    if (previousRound !== null && BigInt(round) > BigInt(previousRound)) {
      const arenas = new Set([...players.values()].map((player) => player.arenaId));
      for (const arenaId of arenas) for (let i = 0; i < 48; i++) food.push(randomFood(undefined, undefined, event.foodKind, arenaId));
    }
    previousRound = round;
  } catch { latestWheel = { ...latestWheel, roundConfirmed: false }; }
}

server.listen(PORT, "0.0.0.0", () => console.log(`Burrow Rush arena listening on :${PORT}`));
setInterval(tick, 50); setInterval(broadcast, 100); void pollSqueek(); setInterval(pollSqueek, 5000);

process.on("SIGINT", () => { server.close(); for (const peer of peers.keys()) peer.destroy(); process.exit(0); });
process.on("SIGTERM", () => { server.close(); for (const peer of peers.keys()) peer.destroy(); process.exit(0); });
