// Splits the muscle groups of the model into the parts exercises target most (deltoid heads, lats
// and upper and lower back, upper and lower chest, rectus and obliques, gluteus maximus and medius,
// gastrocnemius and soleus). Each group is made of the separate meshes of BodyParts3D, joined: a
// mesh is told apart from the others by where it sits. Groups already split are left as they are.
//
//   node scripts/body/split.mjs out/body.js [from.html] && node scripts/body/build.mjs out/body.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// From the built page, or from another one (an older build, with the groups still whole).
const html = fs.readFileSync(process.argv[3] ?? path.join(here, '../../assets/body/body.html'), 'utf8');
const raw = Buffer.from(html.match(/window\.__BODY_B64\s*=\s*"([A-Za-z0-9+/=]+)"/)[1], 'base64');
const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length);
const hl = new DataView(buf).getUint32(0, true);
const header = JSON.parse(Buffer.from(buf, 4, hl).toString());
const base = 4 + hl;
const { min, max } = header;

/** In millimetres, y up and z towards the front, as the page shows it. */
function reader(g) {
  const q = new Uint16Array(buf, base + g.pos, g.verts * 3);
  const idx = g.wide ? new Uint32Array(buf, base + g.idx, g.tris * 3) : new Uint16Array(buf, base + g.idx, g.tris * 3);
  const at = (i) => [
    min[0] + (q[i * 3] / 65535) * (max[0] - min[0]),
    min[2] + (q[i * 3 + 2] / 65535) * (max[2] - min[2]),
    -(min[1] + (q[i * 3 + 1] / 65535) * (max[1] - min[1])),
  ];
  return { q, idx, at };
}

/** The separate meshes of a group: their triangles, box and centre. */
function components(g) {
  const { idx, at } = reader(g);
  const parent = new Int32Array(g.verts).map((_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  for (let t = 0; t < g.tris; t++) {
    const a = find(idx[t * 3]);
    parent[find(idx[t * 3 + 1])] = a;
    parent[find(idx[t * 3 + 2])] = a;
  }
  const comps = new Map();
  for (let t = 0; t < g.tris; t++) {
    const root = find(idx[t * 3]);
    let c = comps.get(root);
    if (!c) comps.set(root, (c = { tris: [], min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9], sum: [0, 0, 0], n: 0 }));
    c.tris.push(t);
    for (let k = 0; k < 3; k++) {
      const p = at(idx[t * 3 + k]);
      for (let d = 0; d < 3; d++) {
        c.min[d] = Math.min(c.min[d], p[d]);
        c.max[d] = Math.max(c.max[d], p[d]);
        c.sum[d] += p[d];
      }
      c.n++;
    }
  }
  return [...comps.values()].map((c) => ({ ...c, c: c.sum.map((v) => v / c.n), w: c.max[0] - c.min[0] }));
}

/** Where each mesh of a group goes. `other` joins the muscles that count for nothing. */
const RULES = {
  shoulders: (comps) => {
    // Three heads a side: the further back, the rear one; the further forward, the front one.
    const out = new Map();
    for (const side of [1, -1]) {
      const mine = comps.filter((c) => Math.sign(c.c[0]) === side).sort((a, b) => a.c[2] - b.c[2]);
      mine.forEach((c, i) => out.set(c, i === 0 ? 'rear-delts' : i === mine.length - 1 ? 'front-delts' : 'side-delts'));
    }
    return (c) => out.get(c);
  },
  chest: () => (c) => (c.min[1] > 1240 ? 'upper-chest' : 'lower-chest'),
  // The external oblique of the model runs over the front as a sheet and draws the six-pack, with the
  // rectus under it: its middle, where the rectus is, counts as the rectus.
  abs: () => (c) => (c.w > 100 ? (p) => (Math.abs(p[0]) < 72 && p[2] > 120 ? 'rectus-abs' : 'obliques') : 'rectus-abs'),
  glutes: () => (c) => (c.min[1] > 740 ? 'glute-med' : 'glute-max'),
  // The tibialis, on the front of the shin, is in the group but is no calf: with the other muscles.
  calves: () => (c) => (c.min[2] > 50 ? 'other' : c.max[1] > 440 ? 'gastrocnemius' : 'soleus'),
  back: () => (c) => {
    const x = Math.abs(c.c[0]);
    if (c.min[1] < 950 && c.w > 150) return 'lats';
    if (c.c[1] < 1150 && x < 60) return 'lower-back';
    if (x > 110 && c.c[1] > 1150 && c.c[1] < 1270) return 'lats';
    return 'upper-back';
  },
};

// Pieces of new groups: lists of triangles of an old group.
const pieces = new Map();
const add = (name, g, tris) => {
  if (!pieces.has(name)) pieces.set(name, []);
  pieces.get(name).push({ g, tris });
};
for (const g of header.groups) {
  const rule = RULES[g.name];
  if (!rule) {
    add(g.name, g, null);
    continue;
  }
  const comps = components(g);
  const part = rule(comps);
  const counts = {};
  const { idx, at } = reader(g);
  for (const c of comps) {
    const rule = part(c);
    // A name for the whole mesh, or a rule for each of its triangles, by its centre.
    const split = new Map();
    for (const t of c.tris) {
      let name = rule;
      if (typeof rule === 'function') {
        const p = [0, 0, 0];
        for (let k = 0; k < 3; k++) at(idx[t * 3 + k]).forEach((v, d) => (p[d] += v / 3));
        name = rule(p);
      }
      if (!split.has(name)) split.set(name, []);
      split.get(name).push(t);
    }
    for (const [name, tris] of split) {
      add(name, g, tris);
      counts[name] = (counts[name] ?? 0) + tris.length;
    }
  }
  console.log(g.name, '→', counts);
}

// Written back in the same format: quantised positions, 16- or 32-bit indices, 4-byte aligned.
const groups = [];
const chunks = [];
let offset = 0;
const push = (bytes) => {
  const at = offset;
  chunks.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  offset += bytes.byteLength;
  const pad = (4 - (offset % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    offset += pad;
  }
  return at;
};
for (const [name, list] of pieces) {
  const positions = [];
  const indices = [];
  for (const { g, tris } of list) {
    const { q, idx } = reader(g);
    const map = new Map();
    const all = tris ?? Array.from({ length: g.tris }, (_, t) => t);
    for (const t of all) {
      for (let k = 0; k < 3; k++) {
        const old = idx[t * 3 + k];
        let next = map.get(old);
        if (next === undefined) {
          next = positions.length / 3;
          map.set(old, next);
          positions.push(q[old * 3], q[old * 3 + 1], q[old * 3 + 2]);
        }
        indices.push(next);
      }
    }
  }
  const verts = positions.length / 3;
  const wide = verts > 65535;
  const pos = push(new Uint16Array(positions));
  const idx = push(wide ? new Uint32Array(indices) : new Uint16Array(indices));
  groups.push({ name, verts, tris: indices.length / 3, pos, idx, wide });
}
let json = JSON.stringify({ min, max, groups });
// The data after the header starts on a multiple of 4, as typed arrays need.
while ((4 + Buffer.byteLength(json)) % 4) json += ' ';
const head = Buffer.alloc(4);
head.writeUInt32LE(Buffer.byteLength(json));
const out = Buffer.concat([head, Buffer.from(json), ...chunks]);
const file = process.argv[2] ?? path.join(here, 'body.js');
fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
fs.writeFileSync(file, `window.__BODY_B64="${out.toString('base64')}";`);
console.log(file, (out.length / 1e6).toFixed(2), 'MB,', groups.map((g) => g.name).join(' '));
