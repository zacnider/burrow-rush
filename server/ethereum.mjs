const MASK64 = (1n << 64n) - 1n;
const RATE = 136;
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = { x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n, y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n };

function rot(value, amount) { if (!amount) return value; const n = BigInt(amount); return ((value << n) | (value >> (64n - n))) & MASK64; }
function permutation(a) {
  for (const rc of RC) {
    const c = Array(5).fill(0n); const d = Array(5).fill(0n);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) c[x] ^= a[x + 5 * y];
    for (let x = 0; x < 5; x++) d[x] = c[(x + 4) % 5] ^ rot(c[(x + 1) % 5], 1);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) a[x + 5 * y] = (a[x + 5 * y] ^ d[x]) & MASK64;
    const b = Array(25).fill(0n);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) b[y + 5 * ((2 * x + 3 * y) % 5)] = rot(a[x + 5 * y], ROT[x + 5 * y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) a[x + 5 * y] = b[x + 5 * y] ^ ((~b[(x + 1) % 5 + 5 * y]) & b[(x + 2) % 5 + 5 * y]);
    a[0] ^= rc;
  }
}
function keccak256(bytes) {
  const paddedLength = Math.ceil((bytes.length + 1) / RATE) * RATE;
  const padded = new Uint8Array(paddedLength || RATE); padded.set(bytes); padded[bytes.length] ^= 0x01; padded[padded.length - 1] ^= 0x80;
  const state = Array(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += RATE) {
    for (let i = 0; i < RATE; i++) state[Math.floor(i / 8)] ^= BigInt(padded[offset + i]) << BigInt((i % 8) * 8);
    permutation(state);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < out.length; i++) out[i] = Number((state[Math.floor(i / 8)] >> BigInt((i % 8) * 8)) & 255n);
  return out;
}
function mod(value, modulus) { const n = value % modulus; return n < 0n ? n + modulus : n; }
function pow(base, exponent, modulus) { let result = 1n; let b = mod(base, modulus); let e = exponent; while (e > 0n) { if (e & 1n) result = result * b % modulus; b = b * b % modulus; e >>= 1n; } return result; }
function inverse(value, modulus) { return pow(mod(value, modulus), modulus - 2n, modulus); }
function add(a, b) {
  if (!a) return b; if (!b) return a;
  if (a.x === b.x && mod(a.y + b.y, P) === 0n) return null;
  const slope = a.x === b.x && a.y === b.y
    ? mod(3n * a.x * a.x * inverse(2n * a.y, P), P)
    : mod((b.y - a.y) * inverse(b.x - a.x, P), P);
  const x = mod(slope * slope - a.x - b.x, P); const y = mod(slope * (a.x - x) - a.y, P);
  return { x, y };
}
function multiply(point, scalar) { let result = null; let addend = point; let n = mod(scalar, N); while (n > 0n) { if (n & 1n) result = add(result, addend); addend = add(addend, addend); n >>= 1n; } return result; }
function bytesToBigInt(bytes) { return BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`); }

export function recoverPersonalSign(message, signature) {
  if (typeof signature !== "string" || !/^0x[0-9a-f]{130}$/i.test(signature)) throw new Error("Bad signature");
  const raw = Buffer.from(signature.slice(2), "hex"); const r = bytesToBigInt(raw.subarray(0, 32)); const s = bytesToBigInt(raw.subarray(32, 64));
  let recovery = raw[64]; if (recovery >= 27) recovery -= 27;
  if ((recovery !== 0 && recovery !== 1) || r <= 0n || r >= N || s <= 0n || s >= N) throw new Error("Invalid signature values");
  const prefix = Buffer.from(`\x19Ethereum Signed Message:\n${Buffer.byteLength(message)}`, "utf8");
  const digest = keccak256(Buffer.concat([prefix, Buffer.from(message, "utf8")])); const z = bytesToBigInt(digest);
  const x = r; if (x >= P) throw new Error("Invalid recovery point");
  const alpha = mod(x * x * x + 7n, P); let y = pow(alpha, (P + 1n) / 4n, P);
  if (y * y % P !== alpha) throw new Error("Invalid recovery point");
  if (Number(y & 1n) !== recovery) y = P - y;
  const R = { x, y }; if (multiply(R, N) !== null) throw new Error("Invalid recovery point order");
  const q = multiply(add(multiply(R, s), multiply(G, -z)), inverse(r, N));
  if (!q) throw new Error("Could not recover signer");
  const publicKey = Buffer.concat([Buffer.from(q.x.toString(16).padStart(64, "0"), "hex"), Buffer.from(q.y.toString(16).padStart(64, "0"), "hex")]);
  return `0x${Buffer.from(keccak256(publicKey)).subarray(12).toString("hex")}`;
}
