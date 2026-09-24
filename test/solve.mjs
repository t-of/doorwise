// 手数を調べる探索（test/check.mjs とステージ作りで使う。ゲームの画面では使わない）。
import * as L from '../logic.js';

const doorsOf = (board) => board.kind.flatMap((k, i) => (k === 'door' ? [i] : []));
const keyOf = (doors, s) => String.fromCharCode(...doors.map((i) => 48 + s.closed[i] + 2 * s.lit[i]));

// 光を囲む四角の広さ（ビーム探索で、光の数が同じときの比べ方）
function litBox(board, lit) {
  let r0 = 99, r1 = -1, c0 = 99, c1 = -1;
  lit.forEach((v, i) => {
    if (!v) return;
    const r = Math.floor(i / board.cols), c = i % board.cols;
    r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c);
  });
  return (r1 - r0 + 1) * (c1 - c0 + 1);
}

function children(board, doors, s) {
  const out = [];
  for (const d of doors) if (s.closed[d]) out.push([d, L.open(board, s, d)]);
  return out;
}

// ビーム探索。返り値 { moves, path }（見つからなければ null）
export function beam(board, width = 3000) {
  const doors = doorsOf(board);
  let layer = [{ s: L.start(board), path: [] }];
  for (let depth = 1; depth <= doors.length; depth++) {
    const seen = new Map();
    for (const { s, path } of layer) {
      for (const [d, t] of children(board, doors, s)) {
        if (L.caught(t) >= 0) return { moves: depth, path: [...path, d] };
        const k = keyOf(doors, t);
        if (!seen.has(k)) seen.set(k, { s: t, path: [...path, d], n: L.count(t.lit), box: litBox(board, t.lit) });
      }
    }
    layer = [...seen.values()].sort((a, b) => a.n - b.n || a.box - b.box).slice(0, width);
  }
  return null;
}

// 全部の手を調べる幅優先探索（同じ局面は二度調べない）。最短の手数。limit 局面を超えたら null
// 局面は keyOf の文字列で覚え、手順は「ひとつ前の局面と押した扉」をたどって作る（メモリを節約するため）。
export function exact(board, limit = 3e6) {
  const doors = doorsOf(board);
  const decode = (k) => {
    const closed = new Uint8Array(board.size), lit = new Uint8Array(board.size);
    doors.forEach((i, j) => { const v = k.charCodeAt(j) - 48; closed[i] = v & 1; lit[i] = v >> 1; });
    return { closed, lit };
  };
  const k0 = keyOf(doors, L.start(board));
  const from = new Map([[k0, null]]);
  const pathTo = (k, d) => {
    const out = [d];
    for (let p = from.get(k); p; p = from.get(p[0])) out.push(p[1]);
    return out.reverse();
  };
  let layer = [k0];
  for (let depth = 1; layer.length; depth++) {
    const next = [];
    for (const k of layer) {
      for (const [d, t] of children(board, doors, decode(k))) {
        if (L.caught(t) >= 0) return { moves: depth, path: pathTo(k, d) };
        const kt = keyOf(doors, t);
        if (from.has(kt)) continue;
        from.set(kt, [k, d]);
        if (from.size > limit) return null;
        next.push(kt);
      }
    }
    layer = next;
  }
  return null;
}

// 欲ばり: 毎手「1 手先で光が一番少なくなる扉」（同じなら番号の小さい = 左上から）
export function greedy(board) {
  const doors = doorsOf(board);
  let s = L.start(board), moves = 0;
  for (;;) {
    let best = null;
    for (const [d, t] of children(board, doors, s)) {
      const n = L.count(t.lit);
      if (!best || n < best.n) best = { n, t };
    }
    s = best.t; moves++;
    if (L.caught(s) >= 0) return moves;
  }
}

// 決まった種から同じ列を返す乱数
export function rng(seed) {
  let x = seed >>> 0;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// でたらめに開けた games 局の平均手数
export function randomAvg(board, games = 500, seed = 1) {
  const doors = doorsOf(board), rand = rng(seed);
  let total = 0;
  for (let g = 0; g < games; g++) {
    let s = L.start(board);
    for (;;) {
      const closed = doors.filter((i) => s.closed[i]);
      s = L.open(board, s, closed[Math.floor(rand() * closed.length)]);
      total++;
      if (L.caught(s) >= 0) break;
    }
  }
  return total / games;
}

export { doorsOf };
