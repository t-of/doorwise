// DOORWISE の決まりごと。画面（DOM）に触らない部分をここに集める。
// main.js（ブラウザ）と test/（node）の両方から読む。乱数は使わない。
//
// 盤は文字列の行の並び。'.' = 扉、'#' = 壁（柱）、' ' = 盤の外（描かない）。マスの番号 i = r * cols + c。
// 局面は closed（閉じた扉）と lit（光っている扉 = 泥棒がいるかもしれない所）の 2 つ。どちらも 0/1 の配列。

export function parse(lines) {
  const rows = lines.length, cols = Math.max(...lines.map((s) => s.length));
  const kind = [];   // 'door' / 'wall' / 'out'
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = lines[r][c] ?? ' ';
      kind.push(ch === '.' ? 'door' : ch === '#' ? 'wall' : 'out');
    }
  }
  // 上下左右のとなり（扉のマスだけ。壁と盤の外は通れない）
  const nb = kind.map((k, i) => {
    if (k !== 'door') return [];
    const r = Math.floor(i / cols), c = i % cols, out = [];
    if (r > 0) out.push(i - cols);
    if (c > 0) out.push(i - 1);
    if (c < cols - 1) out.push(i + 1);
    if (r < rows - 1) out.push(i + cols);
    return out.filter((j) => kind[j] === 'door');
  });
  return { rows, cols, kind, nb, size: rows * cols };
}

// はじめの局面: 扉は全部閉じていて、全部光っている
export function start(board) {
  const closed = Uint8Array.from(board.kind, (k) => (k === 'door' ? 1 : 0));
  return { closed, lit: closed.slice() };
}

export const count = (a) => a.reduce((s, x) => s + x, 0);

// 開けた扉 d からの道のり（閉じた扉だけを通る歩数）。届かない所は -1。
export function distances(board, closed, d) {
  const dist = new Int16Array(board.size).fill(-1);
  dist[d] = 0;
  const q = [d];
  for (let h = 0; h < q.length; h++) {
    const x = q[h];
    for (const y of board.nb[x]) {
      if (closed[y] && dist[y] < 0) { dist[y] = dist[x] + 1; q.push(y); }
    }
  }
  return dist;
}

// 扉 d を開ける。閉じた扉でなければ null。
// 返り値: { closed, lit, flows }。flows は [光っていた扉, 逃げた先] の組（とどまった扉は入れない）。
// 泥棒は、道のりが今より 1 大きいとなりへ逃げる（どれを選ぶかは分からないので光は全部に広がる）。
// そんなとなりがなければとどまる。音の届かない所（道のり -1）の泥棒も動かない。
export function open(board, state, d) {
  if (!state.closed[d]) return null;
  const closed = state.closed.slice();
  closed[d] = 0;
  const dist = distances(board, closed, d);
  const lit = new Uint8Array(board.size);
  const flows = [];
  for (let x = 0; x < board.size; x++) {
    if (!state.lit[x] || x === d) continue;
    let moved = false;
    if (dist[x] > 0) {
      for (const y of board.nb[x]) {
        if (closed[y] && dist[y] === dist[x] + 1) { lit[y] = 1; flows.push([x, y]); moved = true; }
      }
    }
    if (!moved) lit[x] = 1;
  }
  return { closed, lit, flows };
}

// 光が 1 枚になったらつかまえる。その扉の番号を返す（まだなら -1）
export function caught(state) {
  return count(state.lit) === 1 ? state.lit.indexOf(1) : -1;
}

// 手順（扉の番号の並び）を頭から再生する。途中で押せない扉があれば null。
export function replay(board, moves) {
  let s = start(board);
  for (const d of moves) {
    s = open(board, s, d);
    if (!s) return null;
  }
  return s;
}

// 星: 目標手数以内で 3、+2 手以内で 2、それより多いと 1
export const stars = (moves, target) => (moves <= target ? 3 : moves <= target + 2 ? 2 : 1);

// ---- 保存データ（doorwise.progress）----

// { v: 1, best: { '1': 2, ... } } を読み、知らない番号・1 より小さい手数・数でない値を捨てる
export function cleanProgress(raw, stageCount) {
  const best = {};
  const src = raw && typeof raw === 'object' && raw.best && typeof raw.best === 'object' ? raw.best : {};
  for (const [k, v] of Object.entries(src)) {
    const n = Number(k);
    if (Number.isInteger(n) && n >= 1 && n <= stageCount && Number.isInteger(v) && v >= 1) best[n] = v;
  }
  return { v: 1, best };
}

// 遊べるのは「クリアした一番大きい番号 + 1」まで
export function unlockedUpTo(progress, stageCount) {
  const done = Object.keys(progress.best).map(Number);
  return Math.min(stageCount, (done.length ? Math.max(...done) : 0) + 1);
}
