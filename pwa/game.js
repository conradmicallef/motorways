(() => {
'use strict';

// ---------- tuning ----------
const COLORS = ['#e8705b', '#4d94d6', '#efb23b', '#55b079', '#9d7bd0', '#e985ad', '#3db6ae'];
const PIN_CAP = 8;          // pins at which a destination starts to overflow
const OVERFLOW_LIMIT = 25;  // seconds of overflow before game over
const WEEK_LEN = 60;        // seconds per week
const CAR_SPEED = 2.4;      // cells per second
const HOUSE_CARS = 2;       // cars each house owns
const START_ROADS = 30;     // road tiles at the start
const WEEK_ROADS = 20;      // road tiles granted every week
const BRIDGE_MAX = 5;       // widest stretch of water a bridge can span
const MWAY_SPEED = 2.2;     // motorway speed multiplier
const MWAY_MAX = 14;        // longest motorway (cells)
const GAP = 0.36;           // minimum distance between queued cars (cells)

const LAND = '#f7f2e6', LAND_OUT = '#e7dfcb', PAGE = '#ebe4d1';
const WATER = '#9fcfdc', SHORE = '#cfe5e3', ROAD = '#5b6068', MWAY = '#4a4f57';

const $ = id => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d');

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = n >> 8 & 255, b = n & 255;
  if (f < 1) { r *= f; g *= f; b *= f; } else { const t = f - 1; r += (255 - r) * t; g += (255 - g) * t; b += (255 - b) * t; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
const DARK = COLORS.map(c => shade(c, 0.82));
const LIGHT = COLORS.map(c => shade(c, 1.62));

let W = 32, H = 20, cs = 30, ox = 0, oy = 0, dpr = 1;
let S = null;
let started = false;
let tool = 'road';          // road | erase | mway | rabout

const idx = (x, y) => y * W + x;
const cx = i => i % W;
const cy = i => Math.floor(i / W);
const rnd = (a, b) => a + Math.random() * (b - a);
const rint = n => Math.floor(Math.random() * n);
const pick = a => a[rint(a.length)];
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rint(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const inB = (x, y) => x >= S.bx0 && y >= S.by0 && x < S.bx1 && y < S.by1;
const inBi = i => i >= 0 && inB(cx(i), cy(i));
const key = (a, b) => a < b ? a * 65536 + b : b * 65536 + a;
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const easeOutBack = t => { const u = t - 1; return 1 + 2.70158 * u * u * u + 1.70158 * u * u; };

function best() { try { return +localStorage.getItem('miniroads.best') || 0; } catch (e) { return 0; } }
function saveBest(v) { try { localStorage.setItem('miniroads.best', v); } catch (e) {} }

// ---------- setup ----------
function newGame() {
  const portrait = innerHeight > innerWidth;
  W = portrait ? 20 : 32;
  H = portrait ? 32 : 20;
  const bw = portrait ? 10 : 16, bh = portrait ? 15 : 10;
  for (let tries = 0; tries < 30; tries++) {
    S = {
      water: new Set(),
      bridges: new Map(),    // water cell -> bridge
      adj: new Map(),        // node -> Set(neighbour)   (the road graph)
      paid: new Set(),       // nodes that cost a road tile
      bmap: new Map(),       // footprint cell -> building
      doors: new Set(),      // driveway cells
      mkeys: new Set(),      // motorway edge keys
      rabouts: new Set(),    // roundabout nodes
      res: new Map(),        // junction node -> car holding it
      houses: [], dests: [], cars: [], fx: [],
      colors: 0, carId: 0,
      score: 0, week: 1, weekT: 0, roads: START_ROADS,
      inv: { bridge: 0, mway: 0, rabout: 0 },
      spawnT: 12, dispT: 0,
      t: 0, over: false, paused: false, choosing: false, failed: null,
    };
    S.bx0 = (W - bw) >> 1; S.bx1 = S.bx0 + bw;
    S.by0 = (H - bh) >> 1; S.by1 = S.by0 + bh;
    genTerrain();
    let wet = 0;
    for (const i of S.water) if (inBi(i)) wet++;
    if (wet <= bw * bh * 0.2) break;
  }
  S.vb = { x0: S.bx0, y0: S.by0, x1: S.bx1, y1: S.by1 };
  if (waterInBounds()) S.inv.bridge = 2;
  addPair();
  for (const b of S.bmap.values()) b.born = -1;
  setTool('road');
  fit(true);
  updateHud();
}

function waterInBounds() { for (const i of S.water) if (inBi(i)) return true; return false; }

function genTerrain() {
  const land = W >= H;                         // river runs across the short axis
  const along = land ? H : W, across = land ? W : H;
  const put = (a, b) => { if (a >= 0 && b >= 0 && a < across && b < along) S.water.add(land ? idx(a, b) : idx(b, a)); };
  const blob = (x, y, n) => {
    for (let k = 0; k < n; k++) {
      S.water.add(idx(x, y));
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && Math.random() < 0.45) S.water.add(idx(nx, ny));
      }
      const d = pick(DIRS4);
      x = Math.min(W - 1, Math.max(0, x + d[0]));
      y = Math.min(H - 1, Math.max(0, y + d[1]));
    }
  };
  const r = Math.random();
  if (r < 0.7) {
    let p = Math.round(across * rnd(0.3, 0.7)), prev = p;
    const w = Math.random() < 0.55 ? 1 : 2;
    for (let t = 0; t < along; t++) {
      for (let a = Math.min(p, prev); a <= Math.max(p, prev) + w - 1; a++) put(a, t);
      prev = p;
      if (Math.random() < 0.3) p = Math.min(across - 3, Math.max(2, p + (Math.random() < 0.5 ? -1 : 1)));
    }
    blob(rint(W), rint(H), 6 + rint(8));
  } else if (r < 0.9) {
    for (let k = 0; k < 2 + rint(2); k++) blob(rint(W), rint(H), 6 + rint(12));
  }
  // else: dry map
}

// ---------- buildings ----------
function freeFoot(x, y) {
  if (!inB(x, y)) return false;
  const i = idx(x, y);
  return !S.water.has(i) && !S.adj.has(i) && !S.bmap.has(i) && !S.doors.has(i);
}
function okDoor(x, y) {
  if (!inB(x, y)) return false;
  const i = idx(x, y);
  return !S.water.has(i) && !S.bmap.has(i);
}
function nearDest(x, y) {
  for (const d of S.dests) for (const k of d.cells) if (Math.abs(cx(k) - x) <= 1 && Math.abs(cy(k) - y) <= 1) return true;
  return false;
}
function fitBuilding(type, x, y) {
  if (!freeFoot(x, y) || nearDest(x, y)) return null;
  const i = idx(x, y);
  if (type === 'h') {
    for (const [dx, dy] of shuffle(DIRS4.slice()))
      if (okDoor(x + dx, y + dy)) return { i, cells: [i], bc: i, door: idx(x + dx, y + dy), dir: [dx, dy] };
    return null;
  }
  // destination: a parking lot (the node cars drive to) plus the building next to it
  for (const [ex, ey] of shuffle(DIRS4.slice())) {
    const bx = x + ex, by = y + ey;
    if (!freeFoot(bx, by) || nearDest(bx, by)) continue;
    for (const [dx, dy] of shuffle(DIRS4.slice())) {
      if (dx === ex && dy === ey) continue;
      if (okDoor(x + dx, y + dy)) return { i, cells: [i, idx(bx, by)], bc: idx(bx, by), door: idx(x + dx, y + dy), dir: [dx, dy] };
    }
  }
  return null;
}
function create(type, c, p) {
  const b = { type, c, i: p.i, cells: p.cells, bc: p.bc, door: p.door, dir: p.dir, born: S.t,
    pins: 0, en: 0, timer: 0, cd: 0, next: rnd(5, 10), free: HOUSE_CARS, pinT: -9, pulse: -9 };
  for (const k of p.cells) S.bmap.set(k, b);
  S.doors.add(p.door);
  link(b.i, b.door);               // the driveway comes free with the building
  (type === 'h' ? S.houses : S.dests).push(b);
  return b;
}
function addDest(c) {
  let bestP = null, bestS = -1;
  const bw = S.bx1 - S.bx0, bh = S.by1 - S.by0;
  for (let k = 0; k < 60; k++) {
    const x = S.bx0 + 1 + rint(bw - 2), y = S.by0 + 1 + rint(bh - 2);
    const p = fitBuilding('d', x, y);
    if (!p) continue;
    let md = 9;
    for (const o of S.bmap.values()) md = Math.min(md, Math.hypot(cx(o.i) - x, cy(o.i) - y) * (o.type === 'd' ? 0.6 : 1.5));
    const sc = md + Math.random() * 2;
    if (sc > bestS) { bestS = sc; bestP = p; }
  }
  return bestP ? create('d', c, bestP) : null;
}
function addHouse(c, near, rmin = 1, rmax = 3.5) {
  const bw = S.bx1 - S.bx0, bh = S.by1 - S.by0;
  for (let k = 0; k < 300; k++) {
    let x, y;
    if (near && k < 220) {
      const r = rnd(rmin, rmax + k / 40), a = Math.random() * Math.PI * 2;
      x = Math.round(cx(near.i) + Math.cos(a) * r);
      y = Math.round(cy(near.i) + Math.sin(a) * r);
    } else { x = S.bx0 + rint(bw); y = S.by0 + rint(bh); }
    const p = fitBuilding('h', x, y);
    if (p) return create('h', c, p);
  }
  return null;
}
function addPair() {
  if (S.colors >= COLORS.length) return false;
  const c = S.colors;
  const d = addDest(c);
  if (!d) return false;
  S.colors++;
  addHouse(c, d, 3, 6);
  addHouse(c, d, 3, 6);
  return true;
}
const colorsFor = w => Math.min(COLORS.length, 1 + Math.floor(w * 0.6));

function spawn() {
  if (S.colors < colorsFor(S.week) && addPair()) { hint('A new destination has appeared'); return; }
  for (let c = 0; c < S.colors; c++) {
    const hs = S.houses.filter(h => h.c === c).length, ds = S.dests.filter(d => d.c === c).length;
    if (hs >= 6 * ds && addDest(c)) return;
  }
  const c = rint(S.colors);
  const same = S.houses.filter(b => b.c === c);
  addHouse(c, same.length ? pick(same) : S.dests.find(d => d.c === c), 1, 3);
}

function growBounds() {
  const portrait = H > W;
  if (S.bx0 > 0) S.bx0--;
  if (S.bx1 < W) S.bx1++;
  if (!portrait || S.week % 2) { if (S.by0 > 0) S.by0--; if (S.by1 < H) S.by1++; }
  if (portrait && S.week % 2 === 0) { if (S.by0 > 0) S.by0--; if (S.by1 < H) S.by1++; }
  if (!portrait && S.week % 2 === 0) { if (S.bx0 > 0) S.bx0--; if (S.bx1 < W) S.bx1++; }
  fitTarget();
}

// ---------- road graph ----------
const hasEdge = (a, b) => { const s = S.adj.get(a); return !!s && s.has(b); };
const edgeLen = (a, b) => Math.hypot(cx(a) - cx(b), cy(a) - cy(b));
const isMway = (a, b) => S.mkeys.has(key(a, b));
const edgeCost = (a, b) => edgeLen(a, b) / (isMway(a, b) ? MWAY_SPEED : 1);

function link(a, b) {
  for (const [p, q] of [[a, b], [b, a]]) {
    let s = S.adj.get(p);
    if (!s) S.adj.set(p, s = new Set());
    s.add(q);
  }
}
function unlink(a, b) {
  for (const [p, q] of [[a, b], [b, a]]) {
    const s = S.adj.get(p);
    if (!s) continue;
    s.delete(q);
    if (!s.size) dropNode(p);
  }
}
function dropNode(n) {
  S.adj.delete(n);
  if (S.paid.delete(n)) S.roads++;
  if (S.rabouts.delete(n)) S.inv.rabout++;
}
function newCost(cells) {
  let n = 0;
  for (const i of new Set(cells)) if (!S.adj.has(i) && !S.water.has(i)) n++;
  return n;
}
function pay(cells) {
  for (const i of new Set(cells)) if (!S.adj.has(i) && !S.water.has(i)) { S.paid.add(i); S.roads--; }
}

// a plain road segment between 8-neighbours
function addEdge(a, b) {
  if (hasEdge(a, b)) return true;
  if (!inBi(a) || !inBi(b)) return false;
  if (S.bmap.has(a) || S.bmap.has(b)) return false;      // buildings connect only via their driveway
  if (S.water.has(a) || S.water.has(b)) return false;    // water needs a bridge
  const ax = cx(a), ay = cy(a), dx = cx(b) - ax, dy = cy(b) - ay;
  if (dx && dy) {
    const c1 = idx(ax + dx, ay), c2 = idx(ax, ay + dy);
    if (S.water.has(c1) || S.water.has(c2)) return false;
    if (hasEdge(c1, c2)) return false;                    // would cross another diagonal
  }
  if (newCost([a, b]) > S.roads) { flashRoads(); return false; }
  pay([a, b]);
  link(a, b);
  return true;
}

function buildBridge(a, dx, dy) {
  if (S.water.has(a) || S.bmap.has(a)) return -1;
  const cells = [];
  let x = cx(a) + dx, y = cy(a) + dy;
  while (inB(x, y) && S.water.has(idx(x, y))) {
    const i = idx(x, y);
    if (S.bridges.has(i)) return -1;
    cells.push(i);
    x += dx; y += dy;
    if (cells.length > BRIDGE_MAX) { hint('Too wide to bridge'); return -1; }
  }
  if (!inB(x, y) || !cells.length) return -1;
  const e = idx(x, y);
  if (S.bmap.has(e)) return -1;
  if (S.inv.bridge <= 0) { hint('No bridges left – pick one as a weekly upgrade'); return -1; }
  if (newCost([a, e]) > S.roads) { flashRoads(); return -1; }
  pay([a, e]);
  S.inv.bridge--;
  const br = { cells, chain: [a, ...cells, e], dx, dy };
  for (const i of cells) S.bridges.set(i, br);
  for (let k = 0; k < br.chain.length - 1; k++) link(br.chain[k], br.chain[k + 1]);
  updateHud();
  return e;
}
function removeBridge(br) {
  for (const i of br.cells) S.bridges.delete(i);
  for (let k = 0; k < br.chain.length - 1; k++) unlink(br.chain[k], br.chain[k + 1]);
  S.inv.bridge++;
}

const mwayOK = i => inBi(i) && !S.water.has(i) && !S.bmap.has(i);
function addMway(a, b) {
  if (a < 0 || b < 0 || a === b) return false;
  if (!mwayOK(a) || !mwayOK(b)) { hint('Motorways join two land tiles'); return false; }
  const L = edgeLen(a, b);
  if (L < 2) { hint('Drag further to build a motorway'); return false; }
  if (L > MWAY_MAX) { hint('Motorway too long'); return false; }
  if (S.inv.mway <= 0 || hasEdge(a, b)) return false;
  if (newCost([a, b]) > S.roads) { flashRoads(); return false; }
  pay([a, b]);
  link(a, b);
  S.mkeys.add(key(a, b));
  S.inv.mway--;
  return true;
}
function removeMway(a, b) {
  S.mkeys.delete(key(a, b));
  unlink(a, b);
  S.inv.mway++;
}
function placeRabout(n) {
  if (n < 0 || !S.adj.has(n) || S.bmap.has(n) || S.bridges.has(n)) { hint('Tap a road junction'); return; }
  if (S.rabouts.has(n) || S.inv.rabout <= 0) return;
  S.rabouts.add(n);
  S.inv.rabout--;
  if (!S.inv.rabout) setTool('road');
  updateHud();
}

function eraseNode(n) {
  if (n < 0 || S.bmap.has(n)) return;
  const br = S.bridges.get(n);
  if (br) removeBridge(br);
  else {
    const s = S.adj.get(n);
    if (!s) return;
    if (S.rabouts.delete(n)) S.inv.rabout++;
    for (const m of [...s]) {
      const b = S.bmap.get(m);
      if (b && b.door === n) continue;                  // keep driveways
      if (S.bridges.has(m)) continue;                   // bridges are erased from the water
      if (isMway(n, m)) removeMway(n, m); else unlink(n, m);
    }
  }
  revalidateCars();
  updateHud();
}

// ---------- path finding (Dijkstra; buildings are dead ends) ----------
function hpush(h, d, n) {
  h.push([d, n]);
  for (let i = h.length - 1; i > 0;) {
    const p = (i - 1) >> 1;
    if (h[p][0] <= h[i][0]) break;
    [h[p], h[i]] = [h[i], h[p]]; i = p;
  }
}
function hpop(h) {
  const top = h[0], last = h.pop();
  if (h.length) {
    h[0] = last;
    for (let i = 0; ;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]]; i = m;
    }
  }
  return top;
}
function search(start, isGoal) {
  const dist = new Map([[start, 0]]), prev = new Map();
  const h = [];
  hpush(h, 0, start);
  while (h.length) {
    const [d, n] = hpop(h);
    if (d > dist.get(n)) continue;
    if (n !== start && isGoal(n)) {
      const p = [n];
      for (let q = n; q !== start;) { q = prev.get(q); p.push(q); }
      return p.reverse();
    }
    if (n !== start && S.bmap.has(n)) continue;
    const s = S.adj.get(n);
    if (!s) continue;
    for (const m of s) {
      const nd = d + edgeCost(n, m) + (S.rabouts.has(m) ? 0 : (s.size > 2 ? 0.05 : 0));
      if (nd < (dist.has(m) ? dist.get(m) : Infinity)) { dist.set(m, nd); prev.set(m, n); hpush(h, nd, m); }
    }
  }
  return null;
}

// ---------- cars ----------
function dispatch() {
  for (const d of S.dests) {
    let need = d.pins - d.en;
    while (need-- > 0) {
      const p = search(d.i, n => { const h = S.bmap.get(n); return h && h.type === 'h' && h.c === d.c && h.free > 0 && h.cd <= 0; });
      if (!p) break;
      p.reverse();
      const h = S.bmap.get(p[0]);
      S.cars.push({ id: S.carId++, path: p, i: 0, s: 0, v: 0, c: d.c, dest: d, home: h, phase: 'go',
        wait: 0, res: -1, ang: null, pt: 0 });
      d.en++;
      h.free--;
      h.cd = 0.8;
    }
  }
}
function release(c) {
  if (c.res >= 0 && S.res.get(c.res) === c) S.res.delete(c.res);
  c.res = -1;
}
function removeCar(k) {
  const c = S.cars[k];
  if (c.phase === 'go') c.dest.en--;
  c.home.free++;
  release(c);
  c.dead = true;
  S.cars.splice(k, 1);
}
function revalidateCars() {
  for (let k = S.cars.length - 1; k >= 0; k--) {
    const c = S.cars[k];
    if (c.phase === 'park') continue;
    let ok = true;
    for (let j = c.i; j < c.path.length - 1; j++) if (!hasEdge(c.path[j], c.path[j + 1])) { ok = false; break; }
    if (ok) continue;
    const cur = c.path[c.i], nxt = c.path[c.i + 1], T = c.phase === 'go' ? c.dest.i : c.home.i;
    let np = null;
    if (hasEdge(cur, nxt)) {
      np = nxt === T ? [nxt] : search(nxt, n => n === T);
      if (np) np = [cur, ...np];
    } else if (S.adj.has(cur)) {
      np = search(cur, n => n === T);
      if (np) c.s = 0;
    }
    if (np) { c.path = np; c.i = 0; release(c); } else removeCar(k);
  }
}
const junction = n => { const s = S.adj.get(n); return s && s.size > 2 && !S.rabouts.has(n) && !S.bmap.has(n); };

function blocked(c, a, b, L) {
  for (const o of S.cars) {
    if (o === c || o.phase === 'park') continue;
    const of = o.path[o.i], ot = o.path[o.i + 1];
    if (of === a && ot === b) {
      const d = o.s - c.s;
      if (d > 0 && d < GAP) return true;
      if (d === 0 && o.id < c.id) return true;
    } else if (of === b && ot !== a) {
      if (L - c.s + o.s < GAP) return true;
    }
  }
  return false;
}

function arrive(c, k) {
  release(c);
  if (c.phase === 'go') {
    const d = c.dest;
    d.pins = Math.max(0, d.pins - 1);
    d.en--;
    d.pulse = S.t;
    S.score++;
    S.fx.push({ i: d.bc, t: S.t, c: d.c });
    c.phase = 'park'; c.pt = 0.7; c.v = 0;
  } else {
    c.home.free++;
    c.home.pulse = S.t;
    c.dead = true;
    S.cars.splice(k, 1);
  }
}
function goHome(c, k) {
  const p = search(c.dest.i, n => n === c.home.i);
  if (p) { c.path = p; c.i = 0; c.s = 0; c.v = 0; c.phase = 'back'; return; }
  c.pt = 1;
  if ((c.stuck = (c.stuck || 0) + 1) > 5) { c.home.free++; c.dead = true; S.cars.splice(k, 1); }
}

function moveCars(dt) {
  for (let k = S.cars.length - 1; k >= 0; k--) {
    const c = S.cars[k];
    if (c.phase === 'park') { if ((c.pt -= dt) <= 0) goHome(c, k); continue; }
    const a = c.path[c.i], b = c.path[c.i + 1], L = edgeLen(a, b);
    const vmax = CAR_SPEED * (isMway(a, b) ? MWAY_SPEED : 1);
    let stop = blocked(c, a, b, L);
    // junctions let one car through at a time (roundabouts don't need to)
    if (!stop && L - c.s < 0.55 && c.res !== b && junction(b)) {
      const h = S.res.get(b);
      if (h && h !== c && !h.dead) { c.wait += dt; if (c.wait < 3) stop = true; }
      if (!stop) { release(c); S.res.set(b, c); c.res = b; c.wait = 0; }
    }
    c.v = stop ? 0 : Math.min(vmax, c.v + dt * CAR_SPEED * 4);
    c.s += c.v * dt;
    while (c.i < c.path.length - 1) {
      const l = edgeLen(c.path[c.i], c.path[c.i + 1]);
      if (c.s < l) break;
      c.s -= l; c.i++;
    }
    if (c.res >= 0 && c.path[c.i + 1] !== c.res && !(c.path[c.i] === c.res && c.s < 0.4)) release(c);
    if (c.i >= c.path.length - 1) arrive(c, k);
  }
}

// ---------- update ----------
function update(dt) {
  S.t += dt;

  // demand: every house keeps asking for trips to a destination of its colour
  const rate = Math.max(10, 25 - S.week * 1.1);
  for (const h of S.houses) {
    h.cd -= dt;
    if ((h.next -= dt) <= 0) {
      h.next = rate * rnd(0.75, 1.25);
      // demand goes to the nearest destination of the house's colour
      let d = null, bd = Infinity;
      for (const q of S.dests) {
        if (q.c !== h.c) continue;
        const e = edgeLen(q.i, h.i) + Math.random() * 3;
        if (e < bd) { bd = e; d = q; }
      }
      if (d) { d.pins++; d.pinT = S.t; }
    }
  }

  if ((S.dispT -= dt) <= 0) { S.dispT = 0.25; dispatch(); }
  moveCars(dt);

  for (const d of S.dests) {
    if (d.pins >= PIN_CAP) d.timer += dt; else d.timer = Math.max(0, d.timer - dt);
    if (d.timer >= OVERFLOW_LIMIT) { gameOver(d); return; }
  }

  if ((S.spawnT -= dt) <= 0) {
    S.spawnT = Math.max(9, 19 - S.week * 0.9) * rnd(0.8, 1.2);
    spawn();
  }

  if ((S.weekT += dt) >= WEEK_LEN) {
    S.weekT -= WEEK_LEN;
    S.week++;
    S.roads += WEEK_ROADS;
    growBounds();
    offerReward();
  }
  updateHud();
}

// ---------- weekly upgrades ----------
const ICON = {
  road: '<svg viewBox="0 0 24 24"><path d="M4 19 L10 12 L20 12" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  erase: '<svg viewBox="0 0 24 24"><path d="M5 15l8-9 6 5-8 9H8z" fill="currentColor" opacity=".85"/><path d="M4 21h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  bridge: '<svg viewBox="0 0 24 24"><path d="M2 17h20" stroke="#9fcfdc" stroke-width="5" stroke-linecap="round"/><path d="M3 11h18" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/><path d="M4 15q8-8 16 0" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  mway: '<svg viewBox="0 0 24 24"><path d="M3 19L21 5" stroke="currentColor" stroke-width="6" stroke-linecap="round"/><path d="M6 16.7L18 7.3" stroke="#fff" stroke-width="1.4" stroke-dasharray="2.5 2.2"/></svg>',
  rabout: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="3.6"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" stroke="currentColor" stroke-width="3.2"/></svg>',
  roads: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="2" fill="currentColor"/><rect x="13" y="3" width="8" height="8" rx="2" fill="currentColor" opacity=".7"/><rect x="3" y="13" width="8" height="8" rx="2" fill="currentColor" opacity=".7"/><rect x="13" y="13" width="8" height="8" rx="2" fill="currentColor" opacity=".45"/></svg>',
};
const REWARDS = {
  bridge: { name: 'Bridge', desc: `Crosses up to ${BRIDGE_MAX} tiles of water`, give: () => { S.inv.bridge++; } },
  mway: { name: 'Motorway', desc: 'A fast link over anything', give: () => { S.inv.mway++; } },
  rabout: { name: '2 Roundabouts', desc: 'Junctions stop queueing', give: () => { S.inv.rabout += 2; } },
  roads: { name: '+15 Roads', desc: 'Extra road tiles', give: () => { S.roads += 15; } },
};
function offerReward() {
  const pool = ['mway', 'rabout', 'roads'];
  if (waterInBounds()) pool.push('bridge', 'bridge');
  shuffle(pool);
  const a = pool[0], b = pool.find(k => k !== a);
  S.choosing = true;
  $('rweek').textContent = S.week;
  $('rroads').textContent = WEEK_ROADS;
  [a, b].forEach((k, n) => {
    const el = $('ch' + n), r = REWARDS[k];
    el.innerHTML = `${ICON[k]}<b>${r.name}</b><span>${r.desc}</span>`;
    el.onclick = () => {
      r.give();
      S.choosing = false;
      $('reward').classList.remove('show');
      updateHud();
    };
  });
  $('reward').classList.add('show');
}

function gameOver(d) {
  S.over = true;
  S.failed = d;
  S.overT = performance.now();
  const b = best();
  if (S.score > b) saveBest(S.score);
  $('finalscore').textContent = S.score;
  $('best').textContent = Math.max(b, S.score);
  $('weeks').textContent = S.week;
  $('newbest').style.display = S.score > b && S.score > 0 ? '' : 'none';
  setTool('road');
  zoom = 1; bcs = cs; box = ox; boy = oy;         // ease back out to the whole map
  setTimeout(() => { if (S && S.over) $('over').classList.add('show'); }, 1600);
}

// ---------- drawing ----------
function addRR(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function rr(x, y, w, h, r) { ctx.beginPath(); addRR(x, y, w, h, r); }
const px = i => ox + (cx(i) + 0.5) * cs;
const py = i => oy + (cy(i) + 0.5) * cs;
function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }

function draw(rdt) {
  const w = innerWidth, h = innerHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = PAGE;
  ctx.fillRect(0, 0, w, h);
  if (!S) return;

  // animate the visible play area towards the real bounds
  const vb = S.vb, k = 1 - Math.exp(-rdt * 3);
  vb.x0 += (S.bx0 - vb.x0) * k; vb.x1 += (S.bx1 - vb.x1) * k;
  vb.y0 += (S.by0 - vb.y0) * k; vb.y1 += (S.by1 - vb.y1) * k;
  const VX = x => ox + x * cs, VY = y => oy + y * cs;

  ctx.fillStyle = LAND_OUT;
  rr(VX(0), VY(0), W * cs, H * cs, cs * 0.5); ctx.fill();
  ctx.save();
  ctx.shadowColor = 'rgba(90,70,30,.18)'; ctx.shadowBlur = cs * 0.8; ctx.shadowOffsetY = cs * 0.1;
  ctx.fillStyle = LAND;
  rr(VX(vb.x0), VY(vb.y0), (vb.x1 - vb.x0) * cs, (vb.y1 - vb.y0) * cs, cs * 0.45); ctx.fill();
  ctx.restore();

  drawWater();

  // fade everything outside the play area
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  addRR(VX(vb.x0), VY(vb.y0), (vb.x1 - vb.x0) * cs, (vb.y1 - vb.y0) * cs, cs * 0.45);
  ctx.fillStyle = 'rgba(231,223,203,.62)';
  ctx.fill('evenodd');

  drawRoads();
  drawHint();
  for (const b of S.dests) drawDest(b);
  for (const b of S.houses) drawHouse(b);

  const high = [];
  for (const c of S.cars) {
    if (c.phase !== 'park' && isMway(c.path[c.i], c.path[c.i + 1])) high.push(c); else drawCar(c, rdt);
  }
  drawMways();
  for (const c of high) drawCar(c, rdt);

  drawFx();
  for (const d of S.dests) drawPins(d);
  if (tool === 'rabout') drawJunctionMarks();
  if (drag && drag.mode === 'mway') drawMwayPreview();
  if (S.failed) drawFailed();
}

function drawWater() {
  if (!S.water.size) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(ox, oy, W * cs, H * cs); ctx.clip();
  ctx.lineCap = 'round';
  for (const [col, lw] of [[SHORE, 1.3], [WATER, 1.0]]) {
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = cs * lw;
    ctx.beginPath();
    for (const i of S.water) {
      const x = cx(i), y = cy(i), X = px(i), Y = py(i);
      ctx.moveTo(X, Y);
      ctx.lineTo(x + 1 < W && S.water.has(i + 1) ? X + cs : X + 0.01, Y);
      if (y + 1 < H && S.water.has(i + W)) { ctx.moveTo(X, Y); ctx.lineTo(X, Y + cs); }
      if (x === 0) { ctx.moveTo(X, Y); ctx.lineTo(X - cs, Y); }
      if (x === W - 1) { ctx.moveTo(X, Y); ctx.lineTo(X + cs, Y); }
      if (y === 0) { ctx.moveTo(X, Y); ctx.lineTo(X, Y - cs); }
      if (y === H - 1) { ctx.moveTo(X, Y); ctx.lineTo(X, Y + cs); }
    }
    ctx.stroke();
    ctx.beginPath();
    for (const i of S.water) {
      if (cx(i) + 1 < W && cy(i) + 1 < H && S.water.has(i + 1) && S.water.has(i + W) && S.water.has(i + W + 1))
        ctx.rect(px(i), py(i), cs, cs);
    }
    ctx.fill();
  }
  // gentle ripples
  ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = Math.max(1, cs * 0.04);
  ctx.beginPath();
  const t = S.t * 0.6;
  for (const i of S.water) {
    if ((i * 7919) % 5) continue;
    const ph = (t + (i % 13) * 0.37) % 3;
    if (ph > 1.2 || S.bridges.has(i)) continue;
    const X = px(i) + ((i * 31) % 7 - 3) * cs * 0.05, Y = py(i) + ((i * 17) % 5 - 2) * cs * 0.06;
    const len = cs * 0.18 * Math.sin(ph / 1.2 * Math.PI);
    ctx.moveTo(X - len, Y); ctx.lineTo(X + len, Y);
  }
  ctx.stroke();
  ctx.restore();
}

function strokeEdges(list, color, width, offY = 0) {
  if (!list.length) return;
  ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.beginPath();
  for (const [a, b] of list) { ctx.moveTo(px(a), py(a) + offY); ctx.lineTo(px(b), py(b) + offY); }
  ctx.stroke();
}

let mwayList = [];
function drawRoads() {
  const ground = [], mw = [], stubs = [];
  for (const [a, s] of S.adj) for (const b of s) if (a < b) {
    if (isMway(a, b)) { mw.push([a, b]); continue; }
    // an unconnected driveway is drawn as a short stub rather than a full road tile
    const home = S.bmap.has(a) ? a : S.bmap.has(b) ? b : -1, door = home === a ? b : a;
    if (home >= 0 && S.adj.get(door).size === 1) stubs.push([home, door]);
    else ground.push([a, b]);
  }
  mwayList = mw;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // bridge decks: railings over the water, with a shadow on it
  const brs = new Set(S.bridges.values());
  for (const br of brs) {
    const a = br.chain[0], e = br.chain[br.chain.length - 1];
    const x0 = px(a) + br.dx * cs * 0.42, y0 = py(a) + br.dy * cs * 0.42;
    const x1 = px(e) - br.dx * cs * 0.42, y1 = py(e) - br.dy * cs * 0.42;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(40,80,100,.2)'; ctx.lineWidth = cs * 0.74;
    ctx.beginPath(); ctx.moveTo(x0, y0 + cs * 0.14); ctx.lineTo(x1, y1 + cs * 0.14); ctx.stroke();
    ctx.strokeStyle = '#fdfaf3'; ctx.lineWidth = cs * 0.72;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.lineCap = 'round';
  }

  strokeEdges(ground, 'rgba(90,70,30,.12)', cs * 0.56, cs * 0.07);
  strokeEdges(ground, ROAD, cs * 0.48);
  if (stubs.length) {
    ctx.strokeStyle = ROAD; ctx.lineWidth = cs * 0.34;
    ctx.beginPath();
    for (const [h, d] of stubs) {
      const x = px(h), y = py(h);
      ctx.moveTo(x, y); ctx.lineTo(x + (px(d) - x) * 0.6, y + (py(d) - y) * 0.6);
    }
    ctx.stroke();
  }

  for (const n of S.rabouts) {
    const x = px(n), y = py(n);
    ctx.fillStyle = 'rgba(90,70,30,.12)'; circle(x, y + cs * 0.07, cs * 0.44); ctx.fill();
    ctx.fillStyle = ROAD; circle(x, y, cs * 0.42); ctx.fill();
    ctx.fillStyle = '#a9cf8f'; circle(x, y, cs * 0.17); ctx.fill();
    ctx.strokeStyle = '#fdfaf3'; ctx.lineWidth = cs * 0.04; circle(x, y, cs * 0.17); ctx.stroke();
  }
}

function drawMways() {
  if (!mwayList.length) return;
  ctx.lineCap = 'round';
  strokeEdges(mwayList, 'rgba(70,55,25,.16)', cs * 0.62, cs * 0.3);
  strokeEdges(mwayList, '#fdfaf3', cs * 0.68);
  strokeEdges(mwayList, MWAY, cs * 0.54);
  ctx.setLineDash([cs * 0.22, cs * 0.2]);
  strokeEdges(mwayList, 'rgba(255,255,255,.75)', Math.max(1, cs * 0.045));
  ctx.setLineDash([]);
}

function pop(b) {
  if (b.born < 0) return 1;
  const t = Math.min(1, (S.t - b.born) / 0.5);
  return Math.max(0, easeOutBack(t));
}
function bump(t0, dur = 0.3, amt = 0.12) {
  const e = S.t - t0;
  return e >= 0 && e < dur ? 1 + amt * Math.sin(e / dur * Math.PI) : 1;
}

function roofHalf(x, y, s, dir) {
  const [dx, dy] = dir;
  if (dx) ctx.fillRect(dx > 0 ? x - s / 2 : x, y - s / 2, s / 2, s);
  else ctx.fillRect(x - s / 2, dy > 0 ? y - s / 2 : y, s, s / 2);
}

function drawHouse(b) {
  const x = px(b.i), y = py(b.i), k = pop(b) * bump(b.pulse, 0.25, 0.1);
  if (k <= 0) return;
  const s = cs * 0.64, r = cs * 0.13;
  ctx.save();
  ctx.translate(x, y); ctx.scale(k, k); ctx.translate(-x, -y);
  ctx.fillStyle = 'rgba(90,70,30,.2)'; rr(x - s / 2, y - s / 2 + cs * 0.08, s, s, r); ctx.fill();
  ctx.fillStyle = COLORS[b.c]; rr(x - s / 2, y - s / 2, s, s, r); ctx.fill();
  ctx.save(); ctx.clip();
  ctx.fillStyle = DARK[b.c]; roofHalf(x, y, s, b.dir);
  ctx.restore();
  // parked cars waiting at home
  for (let n = 0; n < b.free && n < 2; n++) {
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    const [dx, dy] = b.dir, o = (n ? 1 : -1) * cs * 0.13;
    circle(x + dx * cs * 0.18 - dy * o, y + dy * cs * 0.18 + dx * o, cs * 0.045); ctx.fill();
  }
  ctx.restore();
}

function drawDest(b) {
  const k = pop(b);
  if (k <= 0) return;
  const lx = px(b.i), ly = py(b.i), bx = px(b.bc), by = py(b.bc);
  const mx = (lx + bx) / 2, my = (ly + by) / 2;
  ctx.save();
  ctx.translate(mx, my); ctx.scale(k, k); ctx.translate(-mx, -my);
  // parking lot
  const s = cs * 0.86;
  ctx.fillStyle = 'rgba(90,70,30,.14)'; rr(lx - s / 2, ly - s / 2 + cs * 0.06, s, s, cs * 0.14); ctx.fill();
  ctx.fillStyle = LIGHT[b.c]; rr(lx - s / 2, ly - s / 2, s, s, cs * 0.14); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = Math.max(1, cs * 0.035);
  const [dx, dy] = b.dir;
  ctx.beginPath();
  for (const o of [-0.13, 0.13]) {
    const qx = lx - dy * o * cs, qy = ly + dx * o * cs;
    ctx.moveTo(qx - dx * cs * 0.3, qy - dy * cs * 0.3); ctx.lineTo(qx - dx * cs * 0.08, qy - dy * cs * 0.08);
  }
  ctx.stroke();
  // building
  const pk = bump(b.pulse, 0.3, 0.08), bs = cs * 0.94 * pk;
  ctx.fillStyle = 'rgba(90,70,30,.22)'; rr(bx - bs / 2, by - bs / 2 + cs * 0.1, bs, bs, cs * 0.17); ctx.fill();
  ctx.fillStyle = COLORS[b.c]; rr(bx - bs / 2, by - bs / 2, bs, bs, cs * 0.17); ctx.fill();
  ctx.save(); ctx.clip();
  ctx.fillStyle = DARK[b.c];
  roofHalf(bx, by, bs, [Math.sign(bx - lx), Math.sign(by - ly)].map(v => -v));
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,.92)'; circle(bx, by, cs * 0.17); ctx.fill();
  ctx.fillStyle = COLORS[b.c]; circle(bx, by, cs * 0.08); ctx.fill();
  ctx.restore();
}

function drawPins(d) {
  if (pop(d) < 1) return;
  const lx = px(d.i), ly = py(d.i), bx = px(d.bc), by = py(d.bc);
  const mx = (lx + bx) / 2, my = (ly + by) / 2;
  const over = d.pins >= PIN_CAP;
  if (d.timer > 0) {
    const f = Math.min(1, d.timer / OVERFLOW_LIMIT), R = cs * (Math.abs(lx - bx) + Math.abs(ly - by) > 0 ? 1.2 : 0.9);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(214,69,69,.16)'; ctx.lineWidth = cs * 0.13;
    circle(mx, my, R); ctx.stroke();
    ctx.strokeStyle = '#df5048';
    ctx.beginPath(); ctx.arc(mx, my, R, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); ctx.stroke();
  }
  const n = Math.min(d.pins, PIN_CAP);
  if (!n) return;
  const top = Math.min(ly, by) - cs * 0.78;
  const r = cs * 0.095, g = cs * 0.25, wdt = (n - 1) * g + cs * 0.36, hh = cs * 0.36;
  const shake = over ? Math.sin(S.t * 28) * cs * 0.03 : 0;
  const x0 = mx + shake;
  ctx.save();
  ctx.shadowColor = 'rgba(80,60,20,.2)'; ctx.shadowBlur = cs * 0.2; ctx.shadowOffsetY = cs * 0.05;
  ctx.fillStyle = over ? '#fff1ee' : '#fffdf8';
  rr(x0 - wdt / 2, top - hh / 2, wdt, hh, hh / 2); ctx.fill();
  ctx.restore();
  // little tail pointing at the building
  ctx.fillStyle = over ? '#fff1ee' : '#fffdf8';
  ctx.beginPath(); ctx.moveTo(x0 - cs * 0.07, top + hh / 2 - 1); ctx.lineTo(x0 + cs * 0.07, top + hh / 2 - 1); ctx.lineTo(x0, top + hh / 2 + cs * 0.09); ctx.fill();
  for (let k = 0; k < n; k++) {
    const pk = k === n - 1 ? Math.max(0, easeOutBack(Math.min(1, (S.t - d.pinT) / 0.35))) : 1;
    ctx.fillStyle = COLORS[d.c];
    circle(x0 - (n - 1) * g / 2 + k * g, top, r * pk); ctx.fill();
  }
}

function carPose(c) {
  if (c.phase === 'park') {
    const d = c.dest, [dx, dy] = d.dir, o = ((c.id % 3) - 1) * cs * 0.2;
    return { x: px(d.i) - dy * o - dx * cs * 0.05, y: py(d.i) + dx * o - dy * cs * 0.05, a: Math.atan2(dy, dx) };
  }
  const a = c.path[c.i], b = c.path[c.i + 1], L = edgeLen(a, b), t = c.s / L;
  const ax = px(a), ay = py(a), bx = px(b), by = py(b);
  const ux = (bx - ax) / (L * cs), uy = (by - ay) / (L * cs), off = cs * 0.11;
  return { x: ax + (bx - ax) * t - uy * off, y: ay + (by - ay) * t + ux * off, a: Math.atan2(uy, ux) };
}
function drawCar(c, rdt) {
  const p = carPose(c);
  if (c.ang === null) c.ang = p.a;
  let da = p.a - c.ang;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  c.ang += da * Math.min(1, rdt * 14);
  ctx.save();
  ctx.translate(p.x, p.y); ctx.rotate(c.ang);
  ctx.fillStyle = 'rgba(0,0,0,.18)'; rr(-cs * 0.15, -cs * 0.07, cs * 0.3, cs * 0.17, cs * 0.06); ctx.fill();
  ctx.fillStyle = COLORS[c.c]; rr(-cs * 0.155, -cs * 0.09, cs * 0.31, cs * 0.18, cs * 0.06); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.6)'; rr(cs * 0.02, -cs * 0.065, cs * 0.07, cs * 0.13, cs * 0.02); ctx.fill();
  ctx.restore();
}

function drawFx() {
  S.fx = S.fx.filter(f => S.t - f.t < 0.6);
  for (const f of S.fx) {
    const e = (S.t - f.t) / 0.6;
    ctx.strokeStyle = COLORS[f.c]; ctx.globalAlpha = 1 - e; ctx.lineWidth = cs * 0.06;
    circle(px(f.i), py(f.i), cs * (0.5 + e * 0.5)); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawHint() {
  if (S.paid.size || !S.houses.length || !S.dests.length) return;
  const h = S.houses[0], d = S.dests.find(q => q.c === h.c);
  if (!d) return;
  ctx.save();
  ctx.globalAlpha = 0.35 + 0.25 * Math.sin(performance.now() / 300);
  ctx.strokeStyle = COLORS[h.c]; ctx.lineWidth = cs * 0.12; ctx.lineCap = 'round';
  ctx.setLineDash([cs * 0.05, cs * 0.28]); ctx.lineDashOffset = -performance.now() / 40;
  ctx.beginPath(); ctx.moveTo(px(h.door), py(h.door)); ctx.lineTo(px(d.door), py(d.door)); ctx.stroke();
  ctx.restore();
}
function drawJunctionMarks() {
  ctx.strokeStyle = 'rgba(46,134,222,.6)'; ctx.lineWidth = cs * 0.05;
  const r = cs * (0.45 + 0.05 * Math.sin(performance.now() / 200));
  for (const [n, s] of S.adj) if (s.size > 2 && !S.rabouts.has(n) && !S.bmap.has(n) && !S.bridges.has(n)) { circle(px(n), py(n), r); ctx.stroke(); }
}
function drawMwayPreview() {
  if (drag.a < 0 || drag.b < 0 || drag.a === drag.b) return;
  const L = edgeLen(drag.a, drag.b), ok = mwayOK(drag.a) && mwayOK(drag.b) && L >= 2 && L <= MWAY_MAX;
  ctx.save();
  ctx.globalAlpha = 0.6; ctx.lineCap = 'round';
  ctx.strokeStyle = ok ? MWAY : '#df5048'; ctx.lineWidth = cs * 0.54;
  ctx.beginPath(); ctx.moveTo(px(drag.a), py(drag.a)); ctx.lineTo(px(drag.b), py(drag.b)); ctx.stroke();
  ctx.restore();
}
function drawFailed() {
  const d = S.failed, x = (px(d.i) + px(d.bc)) / 2, y = (py(d.i) + py(d.bc)) / 2;
  const e = (performance.now() / 900) % 1;
  ctx.strokeStyle = `rgba(223,80,72,${1 - e})`; ctx.lineWidth = cs * 0.12;
  circle(x, y, cs * (1.2 + e * 1.6)); ctx.stroke();
}

// ---------- layout / camera ----------
let bcs = 30, box = 0, boy = 0, zoom = 1;          // animated fit-to-play-area layout + user zoom
let tcs = 30, tbox = 0, tboy = 0;                  // target fit layout
const INS = { top: 62, bot: 70 };
const MAX_ZOOM = 4;
function fitTarget() {
  if (!S) return;
  INS.top = $('hud').getBoundingClientRect().bottom + 6;
  INS.bot = innerHeight - $('tools').getBoundingClientRect().top + 8;
  const pad = 12, aw = innerWidth - pad * 2, ah = innerHeight - INS.top - INS.bot;
  const bw = S.bx1 - S.bx0, bh = S.by1 - S.by0;
  tcs = Math.max(4, Math.min(aw / bw, ah / bh));
  tbox = (innerWidth - tcs * bw) / 2 - S.bx0 * tcs;
  tboy = INS.top + (ah - tcs * bh) / 2 - S.by0 * tcs;
}
function fit(snap) {
  dpr = Math.min(devicePixelRatio || 1, 3);
  cv.width = Math.round(innerWidth * dpr);
  cv.height = Math.round(innerHeight * dpr);
  fitTarget();
  if (snap) { bcs = tcs; box = tbox; boy = tboy; zoom = 1; cs = bcs; ox = box; oy = boy; }
}
function animView(dt) {
  const k = 1 - Math.exp(-dt * 3.5);
  bcs += (tcs - bcs) * k; box += (tbox - box) * k; boy += (tboy - boy) * k;
  if (zoom <= 1.001) { cs = bcs; ox = box; oy = boy; return; }
  // zoomed in: keep the world point under the screen centre fixed while the base scale changes
  const mx = innerWidth / 2, my = innerHeight / 2, wx = (mx - ox) / cs, wy = (my - oy) / cs;
  cs = bcs * zoom; ox = mx - wx * cs; oy = my - wy * cs;
  clampView();
}
function resetView() { zoom = 1; bcs = cs; box = ox; boy = oy; }
function clampView() {
  if (zoom <= 1.001) { resetView(); return; }
  const m = 16, vw = innerWidth, top = INS.top, bot = innerHeight - INS.bot;
  const L = S.bx0 * cs, R = S.bx1 * cs, T = S.by0 * cs, B = S.by1 * cs;
  ox = R - L > vw - 2 * m ? Math.min(m - L, Math.max(vw - m - R, ox)) : (vw - (R - L)) / 2 - L;
  oy = B - T > bot - top - m ? Math.min(top - T, Math.max(bot - m - B, oy)) : top + (bot - top - (B - T)) / 2 - T;
}
function zoomAt(x, y, f) {
  const nz = Math.min(MAX_ZOOM, Math.max(1, zoom * f));
  const r = nz / zoom;
  ox = x - (x - ox) * r; oy = y - (y - oy) * r;
  zoom = nz; cs = bcs * zoom;
  clampView();
}
addEventListener('resize', () => fit(false));

// ---------- input ----------
let drag = null;
function ptCell(e) {
  const fx = (e.clientX - ox) / cs, fy = (e.clientY - oy) / cs;
  const x = Math.floor(fx), y = Math.floor(fy);
  if (!S || !inB(x, y)) return null;
  return { i: idx(x, y), x, y, d: Math.hypot(fx - x - 0.5, fy - y - 0.5) };
}
function active() { return S && started && !S.over && !S.paused && !S.choosing; }

// one step of road drawing from `a` in direction (dx,dy); returns the new head or -1
function tryStep(a, dx, dy) {
  const x = cx(a) + dx, y = cy(a) + dy;
  if (!inB(x, y)) return -1;
  const n = idx(x, y);
  if (S.bmap.has(n)) return -1;
  if (S.water.has(n) && !S.bridges.has(n)) return dx && dy ? -1 : buildBridge(a, dx, dy);
  if (S.bridges.has(n) || S.bridges.has(a)) return hasEdge(a, n) ? n : -1;   // walk along an existing bridge
  return addEdge(a, n) ? n : -1;
}
function stepTo(target) {
  const tx = cx(target), ty = cy(target);
  for (let guard = 0; drag.last !== target && guard < 80; guard++) {
    const lx = cx(drag.last), ly = cy(drag.last), dx = tx - lx, dy = ty - ly;
    const sx = Math.sign(dx), sy = Math.sign(dy), adx = Math.abs(dx), ady = Math.abs(dy);
    let cands;
    if (adx && ady) {
      if (adx > 2 * ady) cands = [[sx, 0], [sx, sy], [0, sy]];
      else if (ady > 2 * adx) cands = [[0, sy], [sx, sy], [sx, 0]];
      else cands = [[sx, sy], [sx, 0], [0, sy]];
    } else cands = [[sx, sy]];
    let moved = false;
    for (const [ax, ay] of cands) {
      const r = tryStep(drag.last, ax, ay);
      if (r >= 0) { drag.last = r; moved = true; break; }
    }
    if (!moved) break;
  }
  updateHud();
}
function startCell(pc) {
  if (!pc) return -1;
  const b = S.bmap.get(pc.i);
  return b ? b.door : pc.i;
}

cv.addEventListener('contextmenu', e => e.preventDefault());
const ptrs = new Map();   // active pointers, for two-finger pinch/pan
let pinch = null;
const pinchState = () => {
  const [p, q] = [...ptrs.values()];
  return { d: Math.hypot(p.x - q.x, p.y - q.y) || 1, x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
};
cv.addEventListener('pointerdown', e => {
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 2) { drag = null; pinch = pinchState(); return; }
  if (ptrs.size > 2 || !active()) return;
  cv.setPointerCapture(e.pointerId);
  const pc = ptCell(e);
  const erase = tool === 'erase' || e.button === 2;
  if (erase) { drag = { mode: 'erase' }; if (pc) eraseNode(pc.i); return; }
  if (tool === 'rabout') { placeRabout(pc ? pc.i : -1); return; }
  if (tool === 'mway') { const a = pc ? pc.i : -1; drag = { mode: 'mway', a, b: a }; return; }
  drag = { mode: 'road', last: startCell(pc) };
});
cv.addEventListener('wheel', e => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });
cv.addEventListener('pointermove', e => {
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && ptrs.size >= 2) {
    const n = pinchState();
    zoomAt(n.x, n.y, n.d / pinch.d);
    if (zoom > 1) { ox += n.x - pinch.x; oy += n.y - pinch.y; clampView(); }
    pinch = n;
    return;
  }
  if (!drag || !active()) return;
  const pc = ptCell(e);
  if (!pc) return;
  if (drag.mode === 'erase') { eraseNode(pc.i); return; }
  if (drag.mode === 'mway') { drag.b = pc.i; if (drag.a < 0) drag.a = pc.i; return; }
  if (drag.last < 0) { drag.last = startCell(pc); return; }
  if (pc.i === drag.last) return;
  // wait until the pointer is near a neighbour's centre, so diagonal strokes come out diagonal
  const near = Math.max(Math.abs(pc.x - cx(drag.last)), Math.abs(pc.y - cy(drag.last))) === 1;
  if (near && pc.d > 0.5) return;
  if (S.bmap.has(pc.i)) return;
  stepTo(pc.i);
});
const endDrag = e => {
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinch = null;
  if (drag && drag.mode === 'mway' && e.type === 'pointerup' && active()) {
    if (addMway(drag.a, drag.b)) { revalidateCars(); if (!S.inv.mway) setTool('road'); }
    updateHud();
  }
  drag = null;
};
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);

// ---------- HUD ----------
let lastToast = 0, lastHint = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(lastToast);
  lastToast = setTimeout(() => t.classList.remove('show'), 2200);
}
function hint(msg) {
  const now = performance.now();
  if (now - lastHint < 900) return;
  lastHint = now;
  toast(msg);
}
function flashRoads() {
  const r = $('roads');
  r.classList.add('flash');
  setTimeout(() => r.classList.remove('flash'), 500);
  hint('Out of road tiles – more arrive each week');
}
function updateHud() {
  if (!S) return;
  $('score').textContent = S.score;
  $('week').textContent = S.week;
  $('roadn').textContent = S.roads;
  $('roads').classList.toggle('low', S.roads <= 5);
  $('weekfill').style.width = (S.weekT / WEEK_LEN * 100) + '%';
  for (const k of ['bridge', 'mway', 'rabout']) {
    $('n-' + k).textContent = S.inv[k];
    $('t-' + k).classList.toggle('empty', !S.inv[k]);
  }
}
function setTool(t) {
  if (S && (t === 'mway' || t === 'rabout') && !S.inv[t]) {
    hint(t === 'mway' ? 'No motorways yet – pick one as a weekly upgrade' : 'No roundabouts yet – pick them as a weekly upgrade');
    t = 'road';
  }
  tool = t;
  for (const k of ['road', 'erase', 'mway', 'rabout']) $('t-' + k).classList.toggle('on', k === t);
}
function setPause(v) {
  if (!S || S.over || !started || S.choosing) return;
  S.paused = v;
  $('paused').classList.toggle('show', v);
  $('pause').textContent = v ? 'Resume' : 'Pause';
}
function restart() {
  for (const id of ['over', 'paused', 'reward']) $(id).classList.remove('show');
  $('pause').textContent = 'Pause';
  newGame();
  started = true;
}

for (const k of ['road', 'erase', 'mway', 'rabout', 'bridge']) {
  const el = $('t-' + k);
  el.insertAdjacentHTML('afterbegin', ICON[k]);
  if (k !== 'bridge') el.onclick = () => setTool(tool === k && k !== 'road' ? 'road' : k);
}
$('t-bridge').onclick = () => hint(S.inv.bridge ? 'Draw a road straight across water to build a bridge' : 'No bridges left – pick one as a weekly upgrade');
$('fit').onclick = resetView;
$('pause').onclick = () => setPause(!S.paused);
$('resume').onclick = () => setPause(false);
$('restart').onclick = restart;
$('play').onclick = () => { $('start').classList.remove('show'); started = true; };
$('again').onclick = restart;
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'e') setTool(tool === 'erase' ? 'road' : 'erase');
  else if (k === 'm') setTool(tool === 'mway' ? 'road' : 'mway');
  else if (k === 'r') setTool(tool === 'rabout' ? 'road' : 'rabout');
  else if (k === 'd' || k === 'escape') setTool('road');
  else if (k === '0') resetView();
  else if (k === 'p' || k === ' ') { e.preventDefault(); if (started) setPause(!S.paused); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) setPause(true); });

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  const rdt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (active()) update(Math.min(0.05, rdt));
  animView(rdt);
  draw(rdt);
  requestAnimationFrame(frame);
}

newGame();
requestAnimationFrame(frame);

// small hook for automated testing
window.__miniroads = { get S() { return S; }, update, addEdge, stepTo: (a, b) => { drag = { mode: 'road', last: a }; stepTo(b); drag = null; },
  eraseNode, idx, px, py, get cs() { return cs; }, offerReward, setTool };
})();
