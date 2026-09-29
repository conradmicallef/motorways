(() => {
'use strict';

const COLORS = ['#e4572e', '#2e86de', '#f2b134', '#3aaf6b', '#9b59b6', '#e67e9a'];
const HUD_H = 56;
const PIN_CAP = 8;          // pins at which a building starts to overflow
const OVERFLOW_LIMIT = 30;  // seconds of overflow before game over
const WEEK_LEN = 60;        // seconds per week
const CAR_SPEED = 2.4;      // cells per second

const $ = id => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d');

let W = 22, H = 14, cs = 30, ox = 0, oy = 0, dpr = 1;
let S = null;
let started = false;
let eraseMode = false;

const idx = (x, y) => y * W + x;
const cx = i => i % W;
const cy = i => Math.floor(i / W);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];

function best() { try { return +localStorage.getItem('miniroads.best') || 0; } catch (e) { return 0; } }
function saveBest(v) { try { localStorage.setItem('miniroads.best', v); } catch (e) {} }

// ---------- setup ----------
function newGame() {
  const portrait = innerHeight > innerWidth;
  W = portrait ? 14 : 22;
  H = portrait ? 22 : 14;
  S = {
    water: new Set(),
    adj: new Map(),        // node -> Set(neighbour)
    bmap: new Map(),       // node -> building
    houses: [], dests: [],
    cars: [],
    colors: 0,
    score: 0, week: 1, weekT: 0, roads: 40,
    spawnT: 25, dispT: 0,
    t: 0, over: false, paused: false,
  };
  genWater();
  addPair();
  fit();
  updateHud();
}

function genWater() {
  const blobs = 3 + Math.floor(Math.random() * 2);
  for (let b = 0; b < blobs; b++) {
    let x = 2 + Math.floor(Math.random() * (W - 4));
    let y = 2 + Math.floor(Math.random() * (H - 4));
    const n = 8 + Math.floor(Math.random() * 16);
    for (let k = 0; k < n; k++) {
      S.water.add(idx(x, y));
      const d = pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
      x = Math.min(W - 2, Math.max(1, x + d[0]));
      y = Math.min(H - 2, Math.max(1, y + d[1]));
    }
  }
}

function freeCell(minX0 = 1) {
  for (let tries = 0; tries < 300; tries++) {
    const x = minX0 + Math.floor(Math.random() * (W - 2 * minX0));
    const y = minX0 + Math.floor(Math.random() * (H - 2 * minX0));
    const i = idx(x, y);
    if (S.water.has(i) || S.adj.has(i)) continue;
    let ok = true;
    for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = idx(nx, ny);
      if (S.bmap.has(j)) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}

function addBuilding(type, c) {
  let i = freeCell();
  if (i < 0) return null;
  const b = { i, type, c, pins: 0, en: 0, timer: 0, cd: 0, next: rnd(6, 12), born: S.t };
  S.bmap.set(i, b);
  (type === 'h' ? S.houses : S.dests).push(b);
  return b;
}

function addPair() {
  if (S.colors >= COLORS.length) return;
  const c = S.colors++;
  const d = addBuilding('d', c);
  // keep house a reasonable distance from its destination
  for (let k = 0; k < 20; k++) {
    const h = addBuilding('h', c);
    if (!h) break;
    if (!d || Math.abs(cx(h.i) - cx(d.i)) + Math.abs(cy(h.i) - cy(d.i)) >= 6) return;
    S.bmap.delete(h.i); S.houses.pop();
  }
  addBuilding('h', c);
}

function addHouse() {
  addBuilding('h', Math.floor(Math.random() * S.colors));
}

// ---------- roads ----------
const hasEdge = (a, b) => { const s = S.adj.get(a); return !!s && s.has(b); };

function addEdge(a, b) {
  if (S.water.has(a) || S.water.has(b)) return false;
  if (hasEdge(a, b)) return true;
  if (S.roads <= 0) { flashRoads(); return false; }
  if (!S.adj.has(a)) S.adj.set(a, new Set());
  if (!S.adj.has(b)) S.adj.set(b, new Set());
  S.adj.get(a).add(b); S.adj.get(b).add(a);
  S.roads--;
  return true;
}

function eraseNode(n) {
  const s = S.adj.get(n);
  if (!s) return;
  for (const m of s) {
    const t = S.adj.get(m);
    t.delete(n);
    if (!t.size) S.adj.delete(m);
    S.roads++;
  }
  S.adj.delete(n);
  revalidateCars();
  updateHud();
}

function bfs(start, goal) {
  const prev = new Map([[start, -1]]);
  const q = [start];
  for (let h = 0; h < q.length; h++) {
    const n = q[h];
    if (n === goal) {
      const path = [];
      for (let p = n; p !== -1; p = prev.get(p)) path.push(p);
      return path.reverse();
    }
    const s = S.adj.get(n);
    if (!s) continue;
    for (const m of s) {
      if (prev.has(m)) continue;
      if (S.bmap.has(m) && m !== goal) continue; // buildings are dead ends
      prev.set(m, n);
      q.push(m);
    }
  }
  return null;
}

// ---------- cars ----------
function spawnCar(house, dest, path) {
  S.cars.push({ path, i: 0, s: 0, c: house.c, dest });
  dest.en++;
  house.cd = 1.6;
}

function dispatch() {
  for (const d of S.dests) {
    while (d.pins - d.en > 0) {
      let sent = false;
      for (const h of S.houses) {
        if (h.c !== d.c || h.cd > 0) continue;
        const p = bfs(h.i, d.i);
        if (p) { spawnCar(h, d, p); sent = true; break; }
      }
      if (!sent) break;
    }
  }
}

function revalidateCars() {
  for (let k = S.cars.length - 1; k >= 0; k--) {
    const c = S.cars[k];
    let ok = true;
    for (let j = c.i; j < c.path.length - 1; j++) if (!hasEdge(c.path[j], c.path[j + 1])) { ok = false; break; }
    if (ok) continue;
    const cur = c.path[c.i], nxt = c.path[c.i + 1];
    let np = null;
    if (hasEdge(cur, nxt)) np = bfs(nxt, c.dest.i);
    if (np) c.path = [cur, ...np];
    else { c.dest.en--; S.cars.splice(k, 1); }
  }
}

function blocked(a) {
  const f = a.path[a.i], t = a.path[a.i + 1];
  for (const b of S.cars) {
    if (b === a) continue;
    const bf = b.path[b.i], bt = b.path[b.i + 1];
    if (bf === f && bt === t) {
      const d = b.s - a.s;
      if (d > 0 && d < 0.32) return true;
    } else if (bf === t && bt !== f) {
      if (1 - a.s + b.s < 0.32) return true;
    }
  }
  return false;
}

// ---------- update ----------
function update(dt) {
  S.t += dt;
  S.weekT += dt;
  if (S.weekT >= WEEK_LEN) {
    S.weekT = 0; S.week++;
    const bonus = 20 + Math.min(S.week, 10);
    S.roads += bonus;
    toast(`Week ${S.week} · +${bonus} roads`);
    if (S.colors < Math.min(COLORS.length, 1 + Math.floor(S.week / 2))) addPair();
  }

  S.spawnT -= dt;
  if (S.spawnT <= 0) {
    S.spawnT = Math.max(16, 32 - S.week * 1.2) * rnd(0.8, 1.2);
    if (S.colors < COLORS.length && Math.random() < 0.2) addPair(); else addHouse();
  }

  // demand
  const rate = Math.max(11, 24 - S.week * 0.9);
  for (const h of S.houses) {
    h.cd -= dt;
    h.next -= dt;
    if (h.next <= 0) {
      h.next = rate * rnd(0.75, 1.25);
      const ds = S.dests.filter(d => d.c === h.c);
      if (ds.length) pick(ds).pins++;
    }
  }

  S.dispT -= dt;
  if (S.dispT <= 0) { S.dispT = 0.25; dispatch(); }

  // cars
  for (let k = S.cars.length - 1; k >= 0; k--) {
    const c = S.cars[k];
    if (!blocked(c)) c.s += CAR_SPEED * dt / 1;
    while (c.s >= 1) {
      c.s -= 1; c.i++;
      if (c.i >= c.path.length - 1) break;
    }
    if (c.i >= c.path.length - 1) {
      c.dest.pins = Math.max(0, c.dest.pins - 1);
      c.dest.en--;
      c.dest.pulse = S.t;
      S.score++;
      S.cars.splice(k, 1);
    }
  }

  // overflow
  for (const d of S.dests) {
    if (d.pins >= PIN_CAP) d.timer += dt; else d.timer = Math.max(0, d.timer - dt * 2);
    if (d.timer >= OVERFLOW_LIMIT) { gameOver(); return; }
  }
  updateHud();
}

function gameOver() {
  S.over = true;
  const b = best();
  if (S.score > b) saveBest(S.score);
  $('finalscore').textContent = S.score;
  $('best').textContent = Math.max(b, S.score);
  $('over').classList.add('show');
}

// ---------- drawing ----------
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
const px = i => ox + (cx(i) + 0.5) * cs;
const py = i => oy + (cy(i) + 0.5) * cs;

function draw() {
  const w = innerWidth, h = innerHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!S) return;

  // board
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.14)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#f8f4ea';
  rr(ox - 6, oy - 6, W * cs + 12, H * cs + 12, 16); ctx.fill();
  ctx.restore();

  // water
  ctx.fillStyle = '#a8d5e2';
  for (const i of S.water) {
    const x = ox + cx(i) * cs, y = oy + cy(i) * cs;
    rr(x - 0.5, y - 0.5, cs + 1, cs + 1, cs * 0.28); ctx.fill();
  }

  // roads
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const pass of [0, 1]) {
    ctx.strokeStyle = pass ? '#5a616b' : '#d3cbb9';
    ctx.lineWidth = cs * (pass ? 0.34 : 0.46);
    ctx.beginPath();
    for (const [a, s] of S.adj) for (const b of s) if (a < b) {
      ctx.moveTo(px(a), py(a)); ctx.lineTo(px(b), py(b));
    }
    ctx.stroke();
  }

  // buildings
  for (const b of S.bmap.values()) drawBuilding(b);

  // cars
  for (const c of S.cars) {
    const a = c.path[c.i], b = c.path[c.i + 1];
    const dx = cx(b) - cx(a), dy = cy(b) - cy(a);
    const off = cs * 0.09;
    const x = px(a) + dx * cs * c.s - dy * off;
    const y = py(a) + dy * cs * c.s + dx * off;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(Math.atan2(dy, dx));
    ctx.fillStyle = COLORS[c.c];
    rr(-cs * 0.15, -cs * 0.085, cs * 0.3, cs * 0.17, cs * 0.05); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.fillRect(cs * 0.02, -cs * 0.06, cs * 0.06, cs * 0.12);
    ctx.restore();
  }

  // pins & overflow rings (on top)
  for (const d of S.dests) drawPins(d);
}

function drawBuilding(b) {
  const x = px(b.i), y = py(b.i);
  const age = Math.min(1, (S.t - b.born) / 0.4 + (b.born === 0 ? 1 : 0));
  const k = 0.5 - 0.5 * Math.cos(age * Math.PI);
  ctx.save();
  ctx.translate(x, y); ctx.scale(k, k);
  const col = COLORS[b.c];
  if (b.type === 'h') {
    const s = cs * 0.62;
    ctx.fillStyle = col; rr(-s / 2, -s / 2, s, s, cs * 0.12); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.18)'; rr(-s / 2, -s / 2, s, s * 0.36, cs * 0.12); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(-cs * 0.05, cs * 0.04, cs * 0.1, cs * 0.17);
  } else {
    const pulse = b.pulse && S.t - b.pulse < 0.25 ? 1 + 0.1 * (1 - (S.t - b.pulse) / 0.25) : 1;
    ctx.scale(pulse, pulse);
    const s = cs * 0.88;
    ctx.fillStyle = col; rr(-s / 2, -s / 2, s, s, cs * 0.16); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.beginPath(); ctx.arc(0, 0, cs * 0.24, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(0, 0, cs * 0.12, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawPins(d) {
  const x = px(d.i), y = py(d.i);
  const n = Math.min(d.pins, 12);
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 + k * (Math.PI * 2 / 12);
    const r = cs * 0.66;
    ctx.fillStyle = COLORS[d.c];
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, cs * 0.04);
    ctx.beginPath(); ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, cs * 0.085, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }
  if (d.timer > 0) {
    const f = d.timer / OVERFLOW_LIMIT;
    ctx.strokeStyle = 'rgba(214,69,69,.9)'; ctx.lineWidth = cs * 0.09; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(x, y, cs * 0.8, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); ctx.stroke();
  }
}

// ---------- layout ----------
function fit() {
  dpr = Math.min(devicePixelRatio || 1, 3);
  cv.width = Math.round(innerWidth * dpr);
  cv.height = Math.round(innerHeight * dpr);
  const top = HUD_H + 6, pad = 12;
  const aw = innerWidth - pad * 2, ah = innerHeight - top - pad;
  cs = Math.floor(Math.min(aw / W, ah / H));
  ox = Math.round((innerWidth - cs * W) / 2);
  oy = Math.round(top + (ah - cs * H) / 2);
}
addEventListener('resize', fit);

// ---------- input ----------
let drag = null;
function cellAt(e) {
  const x = Math.floor((e.clientX - ox) / cs), y = Math.floor((e.clientY - oy) / cs);
  return x < 0 || y < 0 || x >= W || y >= H ? -1 : idx(x, y);
}
function active() { return S && started && !S.over && !S.paused; }

cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('pointerdown', e => {
  if (!active()) return;
  cv.setPointerCapture(e.pointerId);
  const c = cellAt(e);
  drag = { erase: eraseMode || e.button === 2, last: c };
  if (drag.erase && c >= 0) eraseNode(c);
});
cv.addEventListener('pointermove', e => {
  if (!drag || !active()) return;
  const c = cellAt(e);
  if (c < 0 || c === drag.last && !drag.erase) return;
  if (drag.erase) { eraseNode(c); return; }
  if (drag.last < 0) { drag.last = c; return; }
  // step cell by cell (4-connected) towards the pointer
  let guard = 0;
  while (drag.last !== c && drag.last >= 0 && guard++ < 60) {
    const lx = cx(drag.last), ly = cy(drag.last), tx = cx(c), ty = cy(c);
    const dx = tx - lx, dy = ty - ly;
    const nxt = Math.abs(dx) >= Math.abs(dy) ? idx(lx + Math.sign(dx), ly) : idx(lx, ly + Math.sign(dy));
    if (!addEdge(drag.last, nxt)) { drag.last = -1; break; }
    drag.last = S.bmap.has(nxt) ? -1 : nxt; // a road ends when it reaches a building
  }
  updateHud();
});
const endDrag = () => { drag = null; };
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);

// ---------- HUD ----------
let lastToast = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(lastToast);
  lastToast = setTimeout(() => t.classList.remove('show'), 2200);
}
function flashRoads() {
  const r = $('roads');
  r.classList.add('low');
  setTimeout(() => r.classList.remove('low'), 500);
}
function updateHud() {
  if (!S) return;
  $('score').textContent = S.score;
  $('week').textContent = S.week;
  $('roadn').textContent = S.roads;
  $('roads').classList.toggle('low', S.roads <= 5);
  $('weekfill').style.width = (S.weekT / WEEK_LEN * 100) + '%';
}

function setErase(v) {
  eraseMode = v;
  $('erase').classList.toggle('on', v);
}
function setPause(v) {
  if (!S || S.over || !started) return;
  S.paused = v;
  $('paused').classList.toggle('show', v);
  $('pause').textContent = v ? 'Resume' : 'Pause';
}

$('erase').onclick = () => setErase(!eraseMode);
$('pause').onclick = () => setPause(!S.paused);
$('resume').onclick = () => setPause(false);
$('play').onclick = () => { $('start').classList.remove('show'); started = true; };
$('again').onclick = () => { $('over').classList.remove('show'); newGame(); };
addEventListener('keydown', e => {
  if (e.key === 'e' || e.key === 'E') setErase(!eraseMode);
  else if (e.key === 'p' || e.key === 'P' || e.key === ' ') { e.preventDefault(); if (started) setPause(!S.paused); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) setPause(true); });

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (active()) update(dt);
  draw();
  requestAnimationFrame(frame);
}

newGame();
requestAnimationFrame(frame);
})();
