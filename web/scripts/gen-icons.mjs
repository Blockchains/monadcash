// Generates the PWA icons as PNGs at build time (no binary files in git, no deps: raw RGBA + zlib).
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(w, h, px) { const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); }
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > y) !== (P[j][1] > y) && x < ((P[j][0] - P[i][0]) * (y - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
const segDist = (x, y, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy))); return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy); };
function icon(S, maskable) {
  const px = Buffer.alloc(S * S * 4); const R = S / 2 - S * (maskable ? 0.0 : 0.06); const s = S * (maskable ? 0.27 : 0.32), cx = S / 2, cy = S / 2;
  const shield = [[cx - s * 0.8, cy - s * 0.75], [cx, cy - s], [cx + s * 0.8, cy - s * 0.75], [cx + s * 0.75, cy + s * 0.15], [cx, cy + s], [cx - s * 0.75, cy + s * 0.15]];
  const ck = [[cx - s * 0.38, cy], [cx - s * 0.08, cy + s * 0.32], [cx + s * 0.42, cy - s * 0.3]]; const lw = S * 0.035;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4; let r = 9, g = 9, b = 11, a = 255; const d = Math.hypot(x - cx, y - cy);
    if (maskable || d <= R) { const t = Math.min(1, d / (S * 0.7)); r = 131 * (1 - t) + 50 * t; g = 110 * (1 - t) + 35 * t; b = 249 * (1 - t) + 130 * t; }
    if (inPoly(x, y, shield)) { r = 250; g = 250; b = 255; }
    if (segDist(x, y, ck[0], ck[1]) < lw || segDist(x, y, ck[1], ck[2]) < lw) { r = 131; g = 110; b = 249; }
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  }
  return png(S, S, px);
}
mkdirSync('public', { recursive: true });
for (const n of [192, 512]) { writeFileSync(`public/icon-${n}.png`, icon(n, false)); writeFileSync(`public/icon-maskable-${n}.png`, icon(n, true)); }
writeFileSync('public/apple-touch-icon.png', icon(180, true)); writeFileSync('public/favicon.png', icon(64, false));
console.log('icons generated');
