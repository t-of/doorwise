// DOORWISE の画面。決まりごとは logic.js、ステージは stages.js。
import * as L from './logic.js';
import { STAGES } from './stages.js';

// localStorage はほかのアプリと共有される（同じ t-of.github.io のため）。
// キーは必ず 'doorwise.' で始める。
const STORE = 'doorwise.';

function load(key, fallback) {
  try {
    const v = localStorage.getItem(STORE + key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* 保存できなくても遊べる */ }
}

WebAppKit.init({ title: 'DOORWISE', text: '光っている扉のどれかに泥棒が隠れている。扉を開けて追いこみ、光を最後の 1 枚まで減らす。' });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// 音を使うときは、鳴らす前と音の設定を切り替えたときにこれを呼ぶ（RULES.md §5「音」）。
function setAudioSession(soundOn) {
  try { if (navigator.audioSession) navigator.audioSession.type = soundOn ? 'playback' : 'auto'; } catch { /* 対応していない */ }
}

// ---- 保存 ----

const settings = { v: 1, sound: true };
{
  const s = load('settings', null);
  if (s && typeof s.sound === 'boolean') settings.sound = s.sound;
}
const progress = L.cleanProgress(load('progress', null), STAGES.length);

// ---- 効果音（Web Audio で作る。音声ファイルは使わない） ----

let ctx = null;
function audio() {
  if (!settings.sound) return null;
  setAudioSession(true);
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
// 1 音: 周波数 f から f2 へ、dur 秒、音量 gain、at 秒後
function tone(f, dur, { f2 = f, type = 'sine', gain = 0.12, at = 0 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2 !== f) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}
const sfx = {
  ui: () => tone(1200, 0.025, { type: 'triangle', gain: 0.05 }),
  open: () => { tone(1900, 0.015, { type: 'square', gain: 0.04 }); tone(420, 0.1, { f2: 250, type: 'triangle', gain: 0.14 }); },
  fewer: (k) => tone(700, Math.min(0.15, 0.05 + 0.015 * k), { f2: 430, gain: 0.1, at: 0.08 }),
  spread: () => tone(140, 0.08, { type: 'triangle', gain: 0.1, at: 0.08 }),
  dull: () => tone(110, 0.05, { type: 'triangle', gain: 0.05 }),
  undo: () => tone(260, 0.08, { f2: 430, type: 'triangle', gain: 0.1 }),
  caught: (star3) => {
    [523, 659, 784].forEach((f, i) => tone(f, 0.16, { type: 'triangle', gain: 0.13, at: i * 0.12 }));
    if (star3) tone(1319, 0.22, { gain: 0.08, at: 0.42 });
  },
  allClear: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.26, { type: 'triangle', gain: 0.12, at: i * 0.18 })),
};

// ---- 画面の部品 ----

const $ = (id) => document.getElementById(id);
const titleEl = $('title'), playEl = $('play'), boardEl = $('board'), clearEl = $('clear'), helpEl = $('help');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

// 自作の泥棒（毛糸の帽子と目かくし）
const THIEF_SVG = `<svg viewBox="0 0 40 40" aria-hidden="true">
  <path d="M8 38c0-9 5-14 12-14s12 5 12 14z" fill="#33424a"/>
  <path d="M14 26l6 5 6-5" fill="none" stroke="#e9efe9" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="20" cy="16" r="9" fill="#e6cfb0"/>
  <path d="M11 13a9 9 0 0 1 18 0z" fill="#33424a"/>
  <rect x="10.5" y="14" width="19" height="5" rx="2.5" fill="#101614"/>
  <circle cx="16.5" cy="16.5" r="1.4" fill="#fff"/><circle cx="23.5" cy="16.5" r="1.4" fill="#fff"/>
</svg>`;

// 盤を作る。interactive なら押せるボタン、見本なら飾り
function buildBoard(el, board, interactive) {
  el.style.setProperty('--cols', board.cols);
  el.replaceChildren(...board.kind.map((k, i) => {
    const b = document.createElement(interactive ? 'button' : 'span');
    b.className = `cell cell--${k === 'door' ? 'door' : k}`;
    if (interactive) {
      b.type = 'button';
      b.dataset.i = i;
      if (k !== 'door') b.tabIndex = -1;
      b.setAttribute('aria-label', k === 'door' ? `扉 ${Math.floor(i / board.cols) + 1} 行 ${i % board.cols + 1} 列` : '壁');
    }
    return b;
  }));
}
function paintBoard(el, board, s, caughtAt = -1) {
  [...el.children].forEach((c, i) => {
    if (board.kind[i] !== 'door') return;
    const open = !s.closed[i] || i === caughtAt;
    c.classList.toggle('cell--door', !open);
    c.classList.toggle('cell--open', open && i !== caughtAt);
    c.classList.toggle('cell--lit', !open && !!s.lit[i]);
    c.classList.toggle('cell--caught', i === caughtAt);
    c.innerHTML = i === caughtAt ? THIEF_SVG : '';
  });
}

// 見本（タイトル）: 2×5 の家。まん中を開けたあとの光
{
  const b = L.parse(['.....', '..#..']);
  buildBoard($('sample'), b, false);
  paintBoard($('sample'), b, L.open(b, L.start(b), 2));
}

// 盤のマスの大きさを画面に合わせる（48〜56px。狭い画面ではそれより小さく）
function fitBoard(board) {
  const w = Math.min(window.innerWidth, 520) - 32 - 12;
  const h = window.innerHeight - 340;
  const cell = Math.floor(Math.min(56, (w - 3 * (board.cols - 1)) / board.cols, (h - 3 * (board.rows - 1)) / board.rows));
  boardEl.style.setProperty('--cell', `${Math.max(34, cell)}px`);
}

// ---- タイトル ----

function starsOf(no) {
  const best = progress.best[no];
  return best ? L.stars(best, STAGES[no - 1].target) : 0;
}
const starText = (k) => `<span class="on">${'★'.repeat(k)}</span>${'★'.repeat(3 - k)}`;
function firstUncleared() {
  for (let no = 1; no <= STAGES.length; no++) if (!progress.best[no]) return no;
  return 0;
}

function showTitle() {
  const open = L.unlockedUpTo(progress, STAGES.length), next = firstUncleared();
  $('stages').replaceChildren(...STAGES.map((st, k) => {
    const no = k + 1, best = progress.best[no];
    const b = document.createElement('button');
    b.className = 'stage-btn' + (no === next ? ' stage-btn--next' : '');
    b.disabled = no > open;
    b.innerHTML = `<span class="stage-btn__no">${no}</span><span class="stage-btn__sub">${
      no > open ? 'まだ' : best ? `${starText(starsOf(no))} ${best}手` : `目標 ${st.target}手`}</span>`;
    b.setAttribute('aria-label', `ステージ ${no}${no > open ? '（まだ遊べない）' : best ? `、${best} 手でクリア` : ''}`);
    b.addEventListener('click', () => { sfx.ui(); startStage(no); });
    return b;
  }));
  $('continue-btn').textContent = next ? (next === 1 ? 'ステージ 1 から' : `つづきから（ステージ ${next}）`) : 'ステージ 1 から';
  playEl.hidden = true;
  clearEl.hidden = true;
  titleEl.hidden = false;
  window.scrollTo(0, 0);
}
$('continue-btn').addEventListener('click', () => { sfx.ui(); startStage(firstUncleared() || 1); });

function paintSound() {
  $('sound-btn').textContent = settings.sound ? '音 オン' : '音 オフ';
  $('sound-btn').setAttribute('aria-pressed', String(settings.sound));
}
$('sound-btn').addEventListener('click', () => {
  settings.sound = !settings.sound;
  setAudioSession(settings.sound);
  save('settings', settings);
  paintSound();
  sfx.ui();
});
paintSound();

// ---- 遊ぶ ----

let helpShown = false;
const game = { no: 1, board: null, s: null, history: [], phase: 'play', timer: 0 };

function startStage(no) {
  const st = STAGES[no - 1];
  clearTimeout(game.timer);
  Object.assign(game, { no, board: L.parse(st.lines), history: [], phase: 'play' });
  game.s = L.start(game.board);
  $('stage-name').textContent = `ステージ ${no}`;
  $('target').textContent = st.target;
  $('hint').textContent = st.hint;
  buildBoard(boardEl, game.board, true);
  fitBoard(game.board);
  titleEl.hidden = true;
  clearEl.hidden = true;
  playEl.classList.remove('play--clear');
  playEl.hidden = false;
  paint();
  window.scrollTo(0, 0);
  // はじめて遊ぶ人には、ステージ 1 のはじめに遊び方を出す
  if (no === 1 && !progress.best[1] && !helpShown) {
    helpShown = true;
    helpEl.hidden = false;
  }
}

function paint(caughtAt = -1) {
  paintBoard(boardEl, game.board, game.s, caughtAt);
  $('moves').textContent = game.history.length;
  $('lit').textContent = L.count(game.s.lit);
  $('undo-btn').disabled = !game.history.length || game.phase !== 'play';
  $('reset-btn').disabled = !game.history.length || game.phase !== 'play';
}

function clearTrails() {
  boardEl.querySelectorAll('.trail').forEach((t) => t.remove());
}
// 光っていた扉から逃げた先へ、光の粒を流す（0.4 秒）
function showFlows(flows) {
  clearTrails();
  if (reduced.matches) return;
  const center = (i) => {
    const c = boardEl.children[i];
    return [c.offsetLeft + c.offsetWidth / 2, c.offsetTop + c.offsetHeight / 2];
  };
  for (const [from, to] of flows) {
    const [x0, y0] = center(from), [x1, y1] = center(to);
    const dot = document.createElement('span');
    dot.className = 'trail';
    boardEl.append(dot);
    const a = dot.animate([
      { transform: `translate(${x0}px, ${y0}px)`, opacity: 0.9 },
      { transform: `translate(${x1}px, ${y1}px)`, opacity: 0.2 },
    ], { duration: 400, easing: 'ease-out' });
    a.onfinish = () => dot.remove();
  }
}

let toastTimer = 0;
function toast() {
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 1100);
}

function shake(el) {
  el.classList.remove('cell--shake');
  void el.offsetWidth;
  el.classList.add('cell--shake');
}

function press(i) {
  if (game.phase !== 'play') return;
  const t = L.open(game.board, game.s, i);
  if (!t) { sfx.dull(); shake(boardEl.children[i]); return; }
  const before = L.count(game.s.lit), after = L.count(t.lit);
  game.history.push(game.s);
  game.s = t;
  sfx.open();
  if (after < before) sfx.fewer(before - after);
  else if (after > before) { sfx.spread(); toast(); }
  showFlows(t.flows);
  paint();
  const at = L.caught(t);
  if (at >= 0) {
    game.phase = 'caught';
    paint();
    game.timer = setTimeout(() => catchThief(at), reduced.matches ? 150 : 450);
  }
}

boardEl.addEventListener('click', (e) => {
  const c = e.target.closest('.cell');
  if (c && c.dataset.i != null && game.board.kind[c.dataset.i] !== 'out') press(Number(c.dataset.i));
});

function undo() {
  if (game.phase !== 'play' || !game.history.length) return;
  clearTrails();
  game.s = game.history.pop();
  sfx.undo();
  paint();
}
function restart() {
  if (game.phase !== 'play' || !game.history.length) return;
  clearTrails();
  game.s = game.history[0];
  game.history = [];
  sfx.undo();
  paint();
}
$('undo-btn').addEventListener('click', undo);
$('reset-btn').addEventListener('click', restart);
$('back-btn').addEventListener('click', () => { sfx.ui(); clearTimeout(game.timer); showTitle(); });
$('help-btn').addEventListener('click', () => { sfx.ui(); helpEl.hidden = false; });
$('help-close').addEventListener('click', () => { sfx.ui(); helpEl.hidden = true; });
helpEl.addEventListener('click', (e) => { if (e.target === helpEl) helpEl.hidden = true; });

document.addEventListener('keydown', (e) => {
  if (playEl.hidden || !helpEl.hidden || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') { e.preventDefault(); undo(); }
  else if (e.key === 'r' || e.key === 'R') restart();
});

// ---- つかまえた ----

function catchThief(at) {
  const no = game.no, st = STAGES[no - 1], moves = game.history.length;
  clearTrails();
  paint(at);
  const prev = progress.best[no];
  const record = !prev || moves < prev;
  if (record) {
    progress.best[no] = moves;
    save('progress', progress);
  }
  const stars = L.stars(moves, st.target);
  const all = no === STAGES.length;
  if (all) sfx.allClear(); else sfx.caught(stars === 3);

  $('clear-title').textContent = all ? '全部つかまえた' : 'つかまえた';
  $('clear-stars').innerHTML = starText(stars);
  $('clear-stars').setAttribute('aria-label', `星 ${stars} つ`);
  $('clear-moves').textContent = moves;
  $('clear-target').textContent = st.target;
  $('clear-record').hidden = !(record && prev);
  $('next-btn').textContent = all ? 'ステージ一覧' : '次へ';
  $('list-btn').hidden = all;
  clearEl.hidden = false;
  playEl.classList.add('play--clear');
  // 出た直後の押しまちがいを防ぐ
  const btns = clearEl.querySelectorAll('button');
  btns.forEach((b) => { b.disabled = true; });
  game.timer = setTimeout(() => btns.forEach((b) => { b.disabled = false; }), 400);
}

$('next-btn').addEventListener('click', () => {
  sfx.ui();
  if (game.no === STAGES.length) showTitle(); else startStage(game.no + 1);
});
$('again-btn').addEventListener('click', () => { sfx.ui(); startStage(game.no); });
$('list-btn').addEventListener('click', () => { sfx.ui(); showTitle(); });
$('share-btn').addEventListener('click', () => {
  const st = STAGES[game.no - 1], k = game.history.length;
  const text = game.no === STAGES.length && Object.keys(progress.best).length === STAGES.length
    ? 'DOORWISE 全 12 ステージの泥棒をつかまえた'
    : `DOORWISE ステージ ${game.no} を ${k} 手で追いつめた（目標 ${st.target} 手 ${'★'.repeat(L.stars(k, st.target))}）`;
  WebAppKit.share({ text });
});

window.addEventListener('resize', () => { if (!playEl.hidden) fitBoard(game.board); });

showTitle();
