#!/usr/bin/env node
// scripts/analyze-board.mjs
//
// 把当前 PCB 的全部铜皮（焊盘 / 走线 / 过孔）从 EDA 拉到本地，做两件事：
//   1) 网络连通性：每个网络的所有焊盘是否落在同一块铜皮上（是否有孤立引脚）
//   2) 异网间距：不同网络、同层、几何最近距离是否小于安全间距（默认 6 mil）
//
// 这是 DRC 引擎的轻量替代方案：DRC 在板面较复杂时可能耗时数十秒甚至内部报错，
// 本地几何分析通常在 1 秒内完成，适合进 CI / 批量自检。
//
// 注意: 本分析不读取铺铜(Pour)形状，因此 GND 等依靠大面积铺铜连通的网络会被
//       判定为"多簇"。这是分析器的已知局限，不是 PCB 的缺陷。如需严格判定请用 EDA 自带 DRC。
//
// 用法: node scripts/analyze-board.mjs [clearance_mil]

import fs from 'node:fs';
import { findBridge, execOnEda } from './_bridge.mjs';

const CLEARANCE = Number(process.argv[2]) || 6; // mil

// ---------- 几何：所有铜皮离散化为"圆链" ----------
function makeCircles(s) {
  const out = [];
  if (s.kind === 'circle') { out.push({ x: s.cx, y: s.cy, r: s.r }); return out; }
  if (s.kind === 'seg') {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const len = Math.hypot(dx, dy);
    const r = Math.max(s.hw, 0.1);
    const n = Math.max(1, Math.ceil(len / (r * 1.6)));
    for (let i = 0; i <= n; i++) {
      const t = n === 0 ? 0 : i / n;
      out.push({ x: s.x1 + dx * t, y: s.y1 + dy * t, r });
    }
    return out;
  }
  if (s.kind === 'rect') {
    const longX = s.hw >= s.hh;
    const full = (longX ? s.hw : s.hh) * 2;
    const thru = (longX ? s.hh : s.hw) * 2;
    const r = thru / 2;
    const n = Math.max(1, Math.ceil(full / Math.max(r * 1.6, 0.2)));
    for (let i = 0; i <= n; i++) {
      const t = n === 0 ? 0.5 : i / n;
      const along = -full / 2 + full * t;
      out.push({ x: s.cx + (longX ? along : 0), y: s.cy + (longX ? 0 : along), r });
    }
    return out;
  }
  return out;
}

function shapeDist(a, b) {
  let best = Infinity;
  for (const ca of a.circles) {
    for (const cb of b.circles) {
      const d = Math.hypot(ca.x - cb.x, ca.y - cb.y) - ca.r - cb.r;
      if (d < best) best = d;
      if (best <= 0) return best;
    }
  }
  return best;
}

(async () => {
  const b = await findBridge();
  if (!b) { console.error('未找到 Bridge Server。'); process.exit(1); }
  const port = b.port;
  const win = b.activeWindowId;

  const data = await execOnEda(port, `
    const pads = await eda.pcb_PrimitivePad.getAll();
    const lines = await eda.pcb_PrimitiveLine.getAll();
    const vias = await eda.pcb_PrimitiveVia.getAll();
    const comps = await eda.pcb_PrimitiveComponent.getAll();
    const id2des = {};
    for (const c of comps) for (const p of c.pads) id2des[c.primitiveId + p.primitiveId] = c.designator + '.' + p.padNumber;
    return {
      pads: pads.map(p => ({ id: p.primitiveId, x: p.x, y: p.y, net: p.net, layer: p.layer,
                             pad: Array.isArray(p.pad) ? p.pad.slice(0, 12) : p.pad,
                             hole: p.hole, rot: p.rotation, des: id2des[p.primitiveId] || '' })),
      lines: lines.map(l => ({ id: l.primitiveId, x1: l.startX, y1: l.startY, x2: l.endX, y2: l.endY,
                               net: l.net, layer: l.layer, w: l.lineWidth })),
      vias: vias.map(v => ({ id: v.primitiveId, x: v.x, y: v.y, net: v.net, d: v.diameter })),
    };
  `, win, 60000);

  const shapes = [];
  for (const p of data.pads) {
    if (!p.net) continue;
    const arr = Array.isArray(p.pad) ? p.pad : [];
    const t = String(arr[0] || '').toUpperCase();
    let w = Number(arr[1]) || 0, h = Number(arr[2]) || 0;
    if (t === 'CIRCLE' || t === 'ROUND') h = h || w;
    const rot = Math.abs(((p.rot || 0) % 180));
    if (rot > 45 && rot < 135) { const tmp = w; w = h; h = tmp; }
    if (w <= 0 && h <= 0) continue;
    const layers = p.hole ? [1, 2] : [p.layer];
    for (const L of layers) {
      shapes.push({ kind: 'rect', net: p.net, layer: L, cx: p.x, cy: p.y,
                    hw: Math.max(w, 0.1) / 2, hh: Math.max(h, w) / 2, type: 'PAD', ref: p.des });
    }
  }
  for (const l of data.lines) {
    if (!l.net || l.net === '') continue;
    shapes.push({ kind: 'seg', net: l.net, layer: l.layer,
                  x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, hw: Math.max(l.w, 0.1) / 2, type: 'TRACK', ref: l.id });
  }
  for (const v of data.vias) {
    if (!v.net) continue;
    for (const L of [1, 2]) {
      shapes.push({ kind: 'circle', net: v.net, layer: L, cx: v.x, cy: v.y, r: v.d / 2, type: 'VIA', ref: v.id });
    }
  }
  for (const s of shapes) s.circles = makeCircles(s);

  const out = [];
  const say = (s) => out.push(s);
  say(`铜皮数量: pad=${data.pads.length} track=${data.lines.filter(l => l.net).length} via=${data.vias.length} -> 形状总数 ${shapes.length}`);

  // 1) 同网络连通性（并查集）
  const parent = new Map();
  const find = (i) => { while (parent.get(i) !== i) { parent.set(i, parent.get(parent.get(i))); i = parent.get(i); } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  shapes.forEach((_, i) => parent.set(i, i));
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i], b = shapes[j];
      if (a.layer !== b.layer || a.net !== b.net) continue;
      if (shapeDist(a, b) <= 0.05) union(i, j);
    }
  }
  const netRoots = new Map();
  shapes.forEach((s, i) => {
    if (s.type !== 'PAD') return;
    if (!netRoots.has(s.net)) netRoots.set(s.net, new Set());
    netRoots.get(s.net).add(find(i));
  });

  say('');
  say('=== 网络连通性（不含铺铜，GND 等会偏保守）===');
  const broken = [];
  let okNets = 0;
  for (const [net, roots] of [...netRoots.entries()].sort()) {
    const padCount = shapes.filter(s => s.type === 'PAD' && s.net === net).length;
    if (roots.size === 1) { okNets++; say(`  OK    ${net.padEnd(12)} 焊盘 ${padCount} -> 单一铜皮簇`); }
    else { broken.push({ net, clusters: roots.size, padCount }); say(`  X     ${net.padEnd(12)} 焊盘 ${padCount} -> ${roots.size} 个孤立铜皮簇`); }
  }
  say(`连通网络 ${okNets} / 未完全连通 ${broken.length}`);

  // 2) 异网间距
  say('');
  say(`=== 异网最小间距（阈值 ${CLEARANCE} mil，不含铺铜）===`);
  const viol = [];
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i], b = shapes[j];
      if (a.layer !== b.layer || a.net === b.net) continue;
      if (a.net === 'BOARDEDGE' || b.net === 'BOARDEDGE') continue;
      const d = shapeDist(a, b);
      if (d < CLEARANCE) viol.push({ a: `${a.net}/${a.type}`, b: `${b.net}/${b.type}`, layer: a.layer, d: +d.toFixed(2) });
    }
  }
  viol.sort((x, y) => x.d - y.d);
  say(`潜在违规对数: ${viol.length}`);
  for (const v of viol.slice(0, 25)) {
    say(`  L${v.layer}  ${v.a.padEnd(30)} vs ${v.b.padEnd(30)} d=${v.d} mil`);
  }

  const nets = [...new Set(shapes.map(s => s.net))].filter(Boolean);
  const routed = new Set(shapes.filter(s => s.type === 'TRACK').map(s => s.net));
  say('');
  say(`=== 统计 ===`);
  say(`网络总数: ${nets.length}`);
  say(`有走线的网络: ${routed.size}`);

  if (process.argv.includes('--print')) console.log(out.join('\n'));
  else console.log(out.join('\n'));
})();
