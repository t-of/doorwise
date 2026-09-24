// node test/check.mjs — 決まりごとの見本、光が正しいか、詰みがないか、ステージの手数（自己チェック）
// 最後に README の「開発」に貼る表を出す。
import assert from 'node:assert/strict';
import * as L from '../logic.js';
import * as S from './solve.mjs';
import { STAGES } from '../stages.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`ok ${name}`); };
const lit = (s) => [...s.lit.keys()].filter((i) => s.lit[i]);

// 1. ルールの見本

test('1×5: まん中（3）→ 端（1）の 2 手でつかまえる', () => {
  const b = L.parse(['.....']);
  let s = L.open(b, L.start(b), 2);
  assert.deepEqual(lit(s), [0, 4]);
  s = L.open(b, s, 0);
  assert.deepEqual(lit(s), [4]);          // 5 は 3 の向こうなので音が届かず、とどまる
  assert.equal(L.caught(s), 4);
});

test('1×7: 3 → 5 → 1 の 3 手でつかまえる', () => {
  const b = L.parse(['.......']);
  assert.equal(L.caught(L.replay(b, [2, 4, 0])), 6);
});

test('開けた扉の向こう（道がつながっていない所）の泥棒は動かない', () => {
  const b = L.parse(['.....']);
  const s = { closed: Uint8Array.from([1, 0, 1, 1, 1]), lit: Uint8Array.from([0, 0, 0, 1, 0]) };
  assert.deepEqual(lit(L.open(b, s, 0)), [3]);    // 0 と 3 の間は開いた扉 1 で切れている
});

test('袋小路・隅の泥棒は、それより遠くへ行けないので動かない', () => {
  const b = L.parse(['...', '.#.']);             // 左下 3 と右下 5 が袋小路
  const s = { closed: Uint8Array.from([1, 1, 1, 1, 0, 1]), lit: Uint8Array.from([0, 0, 0, 1, 0, 0]) };
  assert.deepEqual(lit(L.open(b, s, 1)), [3]);    // 1 から 3 は道のり 2。となりの 0 は 1 なので近づく
});

test('光は、道のりが 1 大きいとなりの全部に広がる', () => {
  const b = L.parse(['...', '...', '...']);
  const s = { closed: new Uint8Array(9).fill(1), lit: Uint8Array.from([0, 0, 0, 0, 1, 0, 0, 0, 0]) };
  const t = L.open(b, s, 1);                     // まん中 4 は道のり 1 → 3・5・7（道のり 2）へ
  assert.deepEqual(lit(t), [3, 5, 7]);
  assert.equal(t.flows.length, 3);
});

test('開いた扉・壁・盤の外は押せない', () => {
  const b = L.parse([' .#.']);
  const s = L.open(b, L.start(b), 1);
  assert.equal(L.open(b, s, 1), null);
  assert.equal(L.open(b, s, 2), null);
  assert.equal(L.open(b, s, 0), null);
});

test('保存データ: 知らない番号・1 より小さい手数・数でない値を捨てる', () => {
  assert.deepEqual(L.cleanProgress({ v: 1, best: { 1: 3, 2: 0, 13: 5, x: 4, 3: 'a', 4: 2.5, 5: 7 } }, 12),
    { v: 1, best: { 1: 3, 5: 7 } });
  assert.deepEqual(L.cleanProgress(null, 12), { v: 1, best: {} });
  assert.equal(L.unlockedUpTo({ best: {} }, 12), 1);
  assert.equal(L.unlockedUpTo({ best: { 1: 3, 2: 4 } }, 12), 3);
  assert.equal(L.unlockedUpTo({ best: { 12: 13 } }, 12), 12);
});

test('星: 目標以内で 3、+2 手以内で 2、それより多いと 1', () => {
  assert.deepEqual([4, 5, 6, 7].map((m) => L.stars(m, 4)), [3, 2, 2, 1]);
});

// 2. 光が正しい: 本当の泥棒を置いてでたらめに動かしても、いつも光の中にいる

test('本当の泥棒は、どの局面でも光の中にいる（ステージ × はじめの場所 × 200 局）', () => {
  const rand = S.rng(42);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  for (const st of STAGES) {
    const b = L.parse(st.lines);
    const doors = S.doorsOf(b);
    for (const home of doors) {
      for (let g = 0; g < 200; g++) {
        let s = L.start(b), thief = home;
        for (;;) {
          // ずる賢い泥棒なので、開けるのは泥棒のいない扉（いる扉を開けられる局面なら、光は 2 枚以上ある）
          const d = pick(doors.filter((i) => s.closed[i] && i !== thief));
          s = L.open(b, s, d);
          const dist = L.distances(b, s.closed, d);
          const away = dist[thief] > 0 ? b.nb[thief].filter((y) => s.closed[y] && dist[y] === dist[thief] + 1) : [];
          if (away.length) thief = pick(away);
          assert.ok(s.lit[thief], `泥棒が光の外にいる: ステージ ${STAGES.indexOf(st) + 1}`);
          assert.ok(lit(s).every((i) => s.closed[i]), '光が開いた扉にある');
          assert.ok(L.count(s.lit) >= 1, '光が空になった');
          if (L.caught(s) >= 0) { assert.equal(L.caught(s), thief); break; }
        }
      }
    }
  }
});

// 3. 詰みがない

test('でたらめに開けて 1000 局、全部（扉の数 − 1）手以内に光が 1 枚になる', () => {
  const rand = S.rng(7);
  for (const st of STAGES) {
    const b = L.parse(st.lines);
    const doors = S.doorsOf(b);
    for (let g = 0; g < 1000; g++) {
      let s = L.start(b), moves = 0;
      while (L.caught(s) < 0) {
        const closed = doors.filter((i) => s.closed[i]);
        assert.ok(closed.length >= 2, '押せる扉が 2 つより少ない');
        s = L.open(b, s, closed[Math.floor(rand() * closed.length)]);
        moves++;
      }
      assert.ok(moves <= doors.length - 1);
    }
  }
});

// 4・5. 何手くらいか、遊びになっているか

const rows = STAGES.map((st, k) => {
  const b = L.parse(st.lines);
  const doors = S.doorsOf(b).length;
  const bm = S.beam(b, 3000);
  const ex = doors <= 16 ? S.exact(b) : null;
  return { no: k + 1, doors, beam: bm.moves, exact: ex && ex.moves, greedy: S.greedy(b), random: S.randomAvg(b, 500), st, b };
});

for (const r of rows) {
  test(`ステージ ${r.no}: 探索の結果とデータが合い、遊びになっている`, () => {
    if (r.exact !== null) assert.equal(r.beam, r.exact, 'ビーム探索と全部の探索で最短が違う');
    const best = r.exact ?? r.beam;
    assert.equal(r.st.target, best, `目標手数 ${r.st.target} を ${best} に直す`);
    assert.equal(r.st.solution.length, r.st.target);
    assert.ok(L.caught(L.replay(r.b, r.st.solution)) >= 0, '手順を再生してもつかまらない');
    assert.ok(best >= 2 && best <= 14, '一番よい手数が 2〜14 手でない');
    assert.ok(best <= r.random * 0.5, 'でたらめの半分より多い');
    if (r.no >= 5) assert.ok(r.greedy >= best + 1, '1 手先読みだけで目標に届く');
    if (r.no > 1) assert.ok(best >= rows[r.no - 2].st.target - 1, '1 つ前より 2 手以上減った');
    const dead = S.doorsOf(r.b).filter((i) => r.b.nb[i].length === 1).length;
    assert.ok(dead <= 2, '袋小路が 3 つ以上');
  });
}

console.log(`\n${n} 件 ok\n`);
console.log('| # | 扉 | 一番よい（ビーム） | 全部の探索 | 欲ばり | でたらめ（500 局の平均） |');
console.log('|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.no} | ${r.doors} | ${r.beam} | ${r.exact ?? '—'} | ${r.greedy} | ${r.random.toFixed(1)} |`);
}
