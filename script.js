/* グラスソリティア — Glass Solitaire（クロンダイク）
 * 入力: D-pad（矢印キー）とタップ（Enter）のみ。Escape は PC 確認用の補助。
 * 依存ライブラリなし。盤面は Canvas、メニュー類は DOM。
 * ?demo=1 でデモ（固定シードの配り札を自動プレイ。録画用で記録は保存しない）。?seed=N で配り札を固定。
 */
(function () {
  'use strict';

  // ==CORE== ルールとソルバー（DOM に依存しない）
  // カード: { i: 0..51, up: bool }  スート = i/13（0♠ 1♥ 2♦ 3♣）、ランク = i%13+1
  function suitOf(c) { return (c.i / 13) | 0; }
  function rankOf(c) { return c.i % 13 + 1; }
  function isRed(s) { return s === 1 || s === 2; }
  function top(a) { return a[a.length - 1]; }

  function rng(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function dealState(rand) {
    var d = [], i, k = 0;
    for (i = 0; i < 52; i++) d.push(i);
    for (i = 51; i > 0; i--) { var j = Math.floor(rand() * (i + 1)); var t = d[i]; d[i] = d[j]; d[j] = t; }
    var S = { stock: [], waste: [], found: [[], [], [], []], tab: [[], [], [], [], [], [], []], moves: 0, time: 0, won: false };
    for (var c = 0; c < 7; c++) for (var r = 0; r <= c; r++) S.tab[c].push({ i: d[k++], up: r === c });
    while (k < 52) S.stock.push({ i: d[k++], up: false });
    return S;
  }
  function cloneState(S) { return JSON.parse(JSON.stringify(S)); }

  function canTab(S, card, col) {
    var t = S.tab[col];
    if (!t.length) return rankOf(card) === 13;
    var tp = top(t);
    return tp.up && rankOf(tp) === rankOf(card) + 1 && isRed(suitOf(tp)) !== isRed(suitOf(card));
  }
  function canFound(S, card) { return S.found[suitOf(card)].length === rankOf(card) - 1; }
  // src: {t:'w'} | {t:'f', i} | {t:'t', i, d}   dst: {t:'f', i} | {t:'t', i}
  function srcCards(S, src) {
    if (src.t === 'w') return S.waste.length ? [top(S.waste)] : [];
    if (src.t === 'f') return S.found[src.i].length ? [top(S.found[src.i])] : [];
    var col = S.tab[src.i];
    if (src.d < 0 || src.d >= col.length || !col[src.d].up) return [];
    return col.slice(src.d);
  }
  function canMove(S, src, dst) {
    var cs = srcCards(S, src);
    if (!cs.length) return false;
    if (dst.t === 'f') return cs.length === 1 && src.t !== 'f' && suitOf(cs[0]) === dst.i && canFound(S, cs[0]);
    if (dst.t === 't') {
      if (src.t === 't' && src.i === dst.i) return false;
      return canTab(S, cs[0], dst.i);
    }
    return false;
  }
  function doMove(S, src, dst) {
    var cs;
    if (src.t === 'w') cs = [S.waste.pop()];
    else if (src.t === 'f') cs = [S.found[src.i].pop()];
    else cs = S.tab[src.i].splice(src.d);
    var to = dst.t === 'f' ? S.found[dst.i] : S.tab[dst.i];
    cs.forEach(function (c) { c.up = true; to.push(c); });
    if (src.t === 't' && S.tab[src.i].length) top(S.tab[src.i]).up = true;
    S.moves++;
  }
  function doDraw(S, n) {
    if (S.stock.length) {
      for (var k = 0; k < n && S.stock.length; k++) { var c = S.stock.pop(); c.up = true; S.waste.push(c); }
    } else if (S.waste.length) {
      while (S.waste.length) { var w = S.waste.pop(); w.up = false; S.stock.push(w); }
    } else return false;
    S.moves++;
    return true;
  }
  function isWon(S) { return S.found[0].length + S.found[1].length + S.found[2].length + S.found[3].length === 52; }
  function canFinish(S) {
    if (S.stock.length || S.waste.length) return false;
    for (var c = 0; c < 7; c++) for (var j = 0; j < S.tab[c].length; j++) if (!S.tab[c][j].up) return false;
    return true;
  }
  // 組札へ置けるカード（場札の一番下・捨て札）。ランクの小さいものから。
  function foundationMove(S) {
    var best = null, br = 99;
    for (var c = 0; c < 7; c++) {
      var t = S.tab[c];
      if (t.length && canFound(S, top(t)) && rankOf(top(t)) < br) {
        br = rankOf(top(t)); best = { src: { t: 't', i: c, d: t.length - 1 }, dst: { t: 'f', i: suitOf(top(t)) } };
      }
    }
    if (S.waste.length && canFound(S, top(S.waste)) && rankOf(top(S.waste)) < br) {
      best = { src: { t: 'w' }, dst: { t: 'f', i: suitOf(top(S.waste)) } };
    }
    return best;
  }
  // デモ用の貪欲ソルバー: 組札 → 裏カードをめくる列移動 → 捨て札を場へ → めくる
  function solverMove(S) {
    var m = foundationMove(S);
    if (m) return m;
    var best = null, bestDown = -1, c, j;
    for (c = 0; c < 7; c++) {
      var t = S.tab[c], k = 0;
      while (k < t.length && !t[k].up) k++;
      if (k === 0 || k >= t.length) continue; // 裏カードが出ない移動はしない（ループ防止）
      for (j = 0; j < 7; j++) {
        if (j !== c && canTab(S, t[k], j) && k > bestDown) { bestDown = k; best = { src: { t: 't', i: c, d: k }, dst: { t: 't', i: j } }; }
      }
    }
    if (best) return best;
    if (S.waste.length) {
      var w = top(S.waste);
      for (j = 0; j < 7; j++) {
        if (S.tab[j].length && canTab(S, w, j)) return { src: { t: 'w' }, dst: { t: 't', i: j } };
      }
      for (j = 0; j < 7; j++) if (canTab(S, w, j)) return { src: { t: 'w' }, dst: { t: 't', i: j } };
    }
    return null;
  }
  function solve(S0, n, maxMoves) {
    var S = cloneState(S0), plan = [], idle = 0;
    while (plan.length < maxMoves) {
      if (isWon(S)) return plan;
      var m = solverMove(S);
      if (m) { doMove(S, m.src, m.dst); plan.push(m); idle = 0; continue; }
      if (!S.stock.length && !S.waste.length) return null;
      doDraw(S, n); plan.push({ draw: true }); idle++;
      if (idle > Math.ceil((S.stock.length + S.waste.length) / n) + 2) return null;
    }
    return null;
  }
  // ==/CORE==

  if (typeof document === 'undefined') {
    module.exports = { dealState: dealState, rng: rng, solve: solve, canMove: canMove, doMove: doMove, doDraw: doDraw, isWon: isWon, canFinish: canFinish, cloneState: cloneState, foundationMove: foundationMove };
    return;
  }

  // ---------- 設定・状態 ----------
  var DEMO = /[?&]demo=1/.test(location.search);
  var DEMO_SEED = 14808;
  var seedM = /[?&]seed=(\d+)/.exec(location.search);
  var SUIT = ['♠︎', '♥︎', '♦︎', '♣︎'];
  var RANK = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var RED = '#ff5d6e', BLK = '#f2f5fa', ACC = '#7ce7ff', OK = '#7bffb0', HOLD = '#ffd166';
  var CW = 74, CH = 100, TOPY = 46, TABY = 156, BOTTOM = 566;

  var G = null;              // 盤面
  var hist = [];             // 1手もどす用スナップショット
  var drawN = 1;             // めくり枚数
  var stats = { wins: 0, played: 0, bestTime: 0, bestMoves: 0 };
  var mode = 'title';        // title / game / menu / howto
  var cur = { a: 'tab', i: 0, d: 0 };   // a: hud / top(0山札 1捨て札 2..5組札) / tab(列 i、カード d)
  var lastTop = 0;
  var held = null;           // 持ち上げ中のカードの src
  var busy = false;          // 自動で組札へ・クリア演出中
  var animDur = 200;
  var howtoBack = 'title';
  var menuIdx = 0, menuItems = [], menuEl = 'title-list';

  var el = function (id) { return document.getElementById(id); };
  var cv = el('cv'), ctx = cv.getContext('2d');

  // ---------- 保存 ----------
  var KEY = 'glass-klondike-v1';
  var saved = null;
  function save() {
    if (DEMO) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ n: drawN, s: stats, g: G && !G.won && G.moves > 0 ? G : null }));
    } catch (e) { /* 保存できなくても動作には影響しない */ }
  }
  function load() {
    if (DEMO) return;
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!s) return;
      drawN = s.n === 3 ? 3 : 1;
      if (s.s) stats = { wins: s.s.wins | 0, played: s.s.played | 0, bestTime: s.s.bestTime | 0, bestMoves: s.s.bestMoves | 0 };
      if (s.g && s.g.tab && s.g.tab.length === 7 && s.g.found && s.g.found.length === 4) saved = s.g;
    } catch (e) { /* 壊れていたら初期値のまま */ }
  }

  // ---------- 表示位置 ----------
  function colX(c) { return 17 + c * 82; }
  function topSlotX(k) { return colX(k === 0 ? 0 : k === 1 ? 1 : k + 1); }
  function tabYs(c) {
    var t = G.tab[c], fd = 0, fu = 0, j;
    for (j = 0; j < t.length; j++) { if (t[j].up) fu++; else fd++; }
    var od = 12, ou = 30, budget = BOTTOM - TABY - CH, n = Math.max(1, fu - 1);
    if (fd * od + (fu - 1) * ou > budget) {
      ou = Math.max(14, (budget - fd * od) / n);
      if (fd * od + (fu - 1) * ou > budget) { od = 6; ou = Math.max(12, (budget - fd * od) / n); }
    }
    var ys = [], y = TABY;
    for (j = 0; j < t.length; j++) { ys.push(y); y += t[j].up ? ou : od; }
    return ys;
  }
  function wasteX(j) {
    var len = G.waste.length;
    if (drawN === 1) return topSlotX(1);
    var first = Math.max(0, len - 3);
    return topSlotX(1) + Math.max(0, j - first) * 22;
  }
  function heldIds() {
    var ids = {};
    if (held) srcCards(G, held).forEach(function (c) { ids[c.i] = 1; });
    return ids;
  }
  function layout() {
    var items = [], j, c, hi = heldIds();
    G.stock.forEach(function (cd) { items.push({ c: cd, x: topSlotX(0), y: TOPY }); });
    G.waste.forEach(function (cd, k) { items.push({ c: cd, x: wasteX(k), y: TOPY }); });
    for (c = 0; c < 4; c++) G.found[c].forEach(function (cd) { items.push({ c: cd, x: topSlotX(c + 2), y: TOPY }); });
    for (c = 0; c < 7; c++) {
      var ys = tabYs(c);
      for (j = 0; j < G.tab[c].length; j++) items.push({ c: G.tab[c][j], x: colX(c), y: ys[j] });
    }
    items.forEach(function (it) { if (hi[it.c.i]) it.y -= 8; });
    return items;
  }
  // カーソル・ハイライト用の矩形
  function topRect(k) {
    if (k === 1 && G.waste.length) return { x: wasteX(G.waste.length - 1), y: TOPY, w: CW, h: CH };
    return { x: topSlotX(k), y: TOPY, w: CW, h: CH };
  }
  function tabRect(c, d, dropOnly) {
    var t = G.tab[c];
    if (!t.length) return { x: colX(c), y: TABY, w: CW, h: CH };
    var ys = tabYs(c), last = t.length - 1;
    if (dropOnly || d < 0) d = last;
    return { x: colX(c), y: ys[d], w: CW, h: ys[last] - ys[d] + CH };
  }
  function dstRect(dst) { return dst.t === 'f' ? topRect(dst.i + 2) : tabRect(dst.i, -1, true); }

  // ---------- 描画 ----------
  var disp = {};             // カードごとの表示位置（トゥイーン）
  var sparks = [];
  var winT0 = 0;
  var backPat = null;
  function makeBackPattern() {
    var p = document.createElement('canvas');
    p.width = 10; p.height = 10;
    var g = p.getContext('2d');
    g.fillStyle = '#132440'; g.fillRect(0, 0, 10, 10);
    g.strokeStyle = '#223d69'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, 10); g.lineTo(10, 0); g.moveTo(-5, 5); g.lineTo(5, -5); g.moveTo(5, 15); g.lineTo(15, 5); g.stroke();
    backPat = ctx.createPattern(p, 'repeat');
  }
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function drawCard(x, y, id, up, sx) {
    ctx.save();
    ctx.translate(x + CW / 2, y);
    ctx.scale(Math.max(0.02, sx), 1);
    ctx.translate(-CW / 2, 0);
    if (!up) {
      rr(0, 0, CW, CH, 7); ctx.fillStyle = backPat; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#3f6aae'; ctx.stroke();
      rr(6, 6, CW - 12, CH - 12, 4); ctx.lineWidth = 1.5; ctx.strokeStyle = '#2d4f86'; ctx.stroke();
      ctx.restore();
      return;
    }
    var s = (id / 13) | 0, r = id % 13 + 1, col = isRed(s) ? RED : BLK;
    rr(0, 0, CW, CH, 7); ctx.fillStyle = isRed(s) ? '#231a1f' : '#1c1f27'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = isRed(s) ? '#6b3842' : '#56607a'; ctx.stroke();
    ctx.fillStyle = col;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.font = '800 22px -apple-system, "Segoe UI", "Hiragino Sans", sans-serif';
    ctx.fillText(RANK[r], r === 10 ? 3 : 6, 4);
    ctx.textAlign = 'right';
    ctx.font = '700 22px "Segoe UI Symbol", "DejaVu Sans", sans-serif';
    ctx.fillText(SUIT[s], CW - 5, 3);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (r >= 11 || r === 1) {
      ctx.font = '800 34px -apple-system, "Segoe UI", "Hiragino Sans", sans-serif';
      ctx.fillText(RANK[r], CW / 2, 52);
      ctx.font = '700 22px "Segoe UI Symbol", "DejaVu Sans", sans-serif';
      ctx.fillText(SUIT[s], CW / 2, 82);
    } else {
      ctx.font = '700 44px "Segoe UI Symbol", "DejaVu Sans", sans-serif';
      ctx.fillText(SUIT[s], CW / 2, 64);
    }
    ctx.restore();
  }
  function slotOutline(x, y, label, color) {
    rr(x, y, CW, CH, 7);
    ctx.setLineDash([6, 5]); ctx.lineWidth = 2; ctx.strokeStyle = '#2f3542'; ctx.stroke(); ctx.setLineDash([]);
    if (label) {
      ctx.fillStyle = color || '#3a4150';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '700 34px "Segoe UI Symbol", "DejaVu Sans", sans-serif';
      ctx.fillText(label, x + CW / 2, y + CH / 2);
    }
  }
  function glowRect(r, color, width, blur) {
    ctx.save();
    rr(r.x - 3, r.y - 3, r.w + 6, r.h + 6, 9);
    ctx.lineWidth = width; ctx.strokeStyle = color;
    ctx.shadowColor = color; ctx.shadowBlur = blur;
    ctx.stroke();
    ctx.restore();
  }
  function ease(p) { return 1 - Math.pow(1 - p, 3); }

  function render(now) {
    ctx.clearRect(0, 0, 600, 600);
    if (!G) return;
    // 空きスロット
    slotOutline(topSlotX(0), TOPY, !G.stock.length && G.waste.length ? '↻' : '', '#4a5264');
    slotOutline(topSlotX(1), TOPY, '');
    for (var f = 0; f < 4; f++) {
      slotOutline(topSlotX(f + 2), TOPY, SUIT[f], isRed(f) ? 'rgba(255,93,110,0.30)' : 'rgba(242,245,250,0.22)');
    }
    for (var c = 0; c < 7; c++) if (!G.tab[c].length) slotOutline(colX(c), TABY, 'K', '#3a4150');

    // カード
    var items = layout(), moving = [];
    items.forEach(function (it) {
      var id = it.c.i, d = disp[id];
      if (!d) d = disp[id] = { x: it.x, y: it.y, fx: it.x, fy: it.y, tx: it.x, ty: it.y, t0: 0, dur: 1, up: it.c.up, flipT0: -1e9 };
      if (d.tx !== it.x || d.ty !== it.y) { d.fx = d.x; d.fy = d.y; d.tx = it.x; d.ty = it.y; d.t0 = now; d.dur = animDur; }
      if (d.up !== it.c.up) { d.up = it.c.up; d.flipT0 = Math.max(now, d.t0 + d.dur * 0.5); }
      var p = Math.min(1, Math.max(0, (now - d.t0) / d.dur)), e = ease(p);
      d.x = d.fx + (d.tx - d.fx) * e; d.y = d.fy + (d.ty - d.fy) * e;
      if (p < 1) moving.push(d); else it.d = d;
    });
    function paint(id, d) {
      var q = (now - d.flipT0) / 180, face = d.up, sx = 1;
      if (q < 0) face = !d.up;
      else if (q < 1) { sx = Math.abs(1 - 2 * q); face = q >= 0.5 ? d.up : !d.up; }
      drawCard(d.x, d.y, id, face, sx);
    }
    items.forEach(function (it) { if (it.d) paint(it.c.i, it.d); });
    items.forEach(function (it) { if (!it.d) paint(it.c.i, disp[it.c.i]); });

    // 山札の残り枚数
    if (G.stock.length) {
      ctx.fillStyle = '#cfe0ff'; ctx.font = '800 17px -apple-system, "Segoe UI", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      rr(topSlotX(0) + CW / 2 - 17, TOPY + CH / 2 - 13, 34, 26, 8); ctx.fillStyle = 'rgba(10,14,24,0.85)'; ctx.fill();
      ctx.fillStyle = '#cfe0ff'; ctx.fillText(String(G.stock.length), topSlotX(0) + CW / 2, TOPY + CH / 2 + 1);
    }

    // ハイライト
    if (mode === 'game' || mode === 'menu') {
      var pulse = 0.55 + 0.45 * Math.sin(now / 160);
      if (held) {
        [0, 1, 2, 3].forEach(function (k) { var dst = { t: 'f', i: k }; if (canMove(G, held, dst)) glowRect(dstRect(dst), 'rgba(123,255,176,' + pulse.toFixed(2) + ')', 3, 14); });
        for (var k = 0; k < 7; k++) { var dt = { t: 't', i: k }; if (canMove(G, held, dt)) glowRect(dstRect(dt), 'rgba(123,255,176,' + pulse.toFixed(2) + ')', 3, 14); }
        var hr = held.t === 'w' ? topRect(1) : held.t === 'f' ? topRect(held.i + 2) : tabRect(held.i, held.d);
        hr = { x: hr.x, y: hr.y - 8, w: hr.w, h: hr.h };
        glowRect(hr, HOLD, 3, 12);
      }
      if (!busy && cur.a !== 'hud' && !demo.fast) {
        var cr = cur.a === 'top' ? topRect(cur.i) : tabRect(cur.i, held ? -1 : cur.d, !!held);
        if (!held && cur.a === 'tab' && G.tab[cur.i].length && heldIds()[G.tab[cur.i][cur.d] && G.tab[cur.i][cur.d].i]) cr.y -= 8;
        glowRect(cr, ACC, 4, 16);
      }
    }
    // 組札の完成・クリアの光
    if (G.won || winT0) {
      var a = 0.5 + 0.5 * Math.sin(now / 200);
      for (var w = 0; w < 4; w++) glowRect(topRect(w + 2), 'rgba(123,255,176,' + a.toFixed(2) + ')', 3, 20);
    }
    // 火花
    for (var s = sparks.length - 1; s >= 0; s--) {
      var sp = sparks[s], age = (now - sp.t0) / sp.life;
      if (age >= 1) { sparks.splice(s, 1); continue; }
      if (age < 0) continue;
      var t = (now - sp.t0) / 1000;
      ctx.globalAlpha = 1 - age;
      ctx.fillStyle = sp.col;
      ctx.beginPath(); ctx.arc(sp.x + sp.vx * t, sp.y + sp.vy * t + 160 * t * t, sp.r, 0, 6.29); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  function burst(x, y, n, col, delay) {
    var now = performance.now() + (delay || 0);
    for (var k = 0; k < n; k++) {
      var a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 160;
      sparks.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, r: 2 + Math.random() * 2.5, col: col, t0: now, life: 600 + Math.random() * 500 });
    }
  }

  var lastT = performance.now(), lastSec = -1;
  function frame(now) {
    if (mode === 'game' && G && G.moves > 0 && !G.won && !busy) G.time += Math.min(100, now - lastT);
    lastT = now;
    if (mode === 'game' || mode === 'menu') render(now);
    if (G && mode === 'game') {
      var sec = Math.floor(G.time / 1000);
      if (sec !== lastSec) { lastSec = sec; paintHud(); }
    }
    requestAnimationFrame(frame);
  }

  // ---------- HUD・ヒント ----------
  function fmtTime(ms) { var s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
  function paintHud() {
    if (mode === 'title' || mode === 'howto' && howtoBack === 'title') {
      el('hud-left').textContent = '🂡 グラスソリティア';
      el('hud-right').textContent = '';
      return;
    }
    el('hud-left').innerHTML = '<span class="hud-btn' + (cur.a === 'hud' && mode === 'game' && !demo.fast ? ' cur' : '') + '" id="hud-menu">≡ メニュー</span>';
    el('hud-right').innerHTML = (DEMO ? 'デモ ・ ' : '') + drawN + '枚めくり ・ 手数 <b>' + G.moves + '</b> ・ <b>' + fmtTime(G.time) + '</b>';
  }
  function paintHint() {
    var h = '';
    if (busy) h = G && G.won ? '🎉 クリア！' : '組札へ…';
    else if (DEMO && demo.fast) h = 'デモ：自動プレイ <b>▶▶ 早送り</b>';
    else if (held) h = '<b>緑</b>の場所でタップ ・ もとの場所でタップ＝自動で置く';
    else if (cur.a === 'hud') h = 'タップでメニュー ・ <b>↓</b> 場へ';
    else if (cur.a === 'top') {
      if (cur.i === 0) h = G.stock.length ? 'タップでめくる（' + drawN + '枚）' : G.waste.length ? 'タップで山札にもどす' : '山札はからっぽ';
      else if (cur.i === 1) h = G.waste.length ? 'タップで捨て札をとる ・ <b>↑</b> メニュー' : '捨て札はまだない ・ <b>↑</b> メニュー';
      else h = G.found[cur.i - 2].length ? 'タップで組札からとる' : '組札（' + SUIT[cur.i - 2] + ' A→K）';
    } else h = G.tab[cur.i].length ? 'タップでとる ・ <b>↑↓</b> カード ・ <b>←→</b> 列' : 'あいた列（K を置ける） ・ <b>↑</b> 山札・組札へ';
    el('hint').innerHTML = h;
  }
  var toastT = 0;
  function toast(msg) {
    var t = el('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.classList.remove('on'); }, 1300);
  }
  function refresh() { normCur(); paintHud(); paintHint(); }

  // ---------- カーソル ----------
  var TOP2COL = [0, 1, 3, 4, 5, 6];
  var COL2TOP = [0, 1, 1, 2, 3, 4, 5];
  function normCur() {
    if (cur.a !== 'tab' || !G) return;
    var t = G.tab[cur.i];
    if (!t.length) { cur.d = -1; return; }
    if (cur.d < 0 || cur.d >= t.length || !t[cur.d].up) cur.d = t.length - 1;
  }
  function toCol(i) { cur = { a: 'tab', i: i, d: G.tab[i].length - 1 }; }
  function moveCursor(key) {
    if (cur.a === 'hud') {
      if (key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') cur = { a: 'top', i: lastTop };
    } else if (cur.a === 'top') {
      if (key === 'ArrowLeft') cur.i = (cur.i + 5) % 6;
      else if (key === 'ArrowRight') cur.i = (cur.i + 1) % 6;
      else if (key === 'ArrowUp') { lastTop = cur.i; cur = { a: 'hud' }; }
      else if (key === 'ArrowDown') toCol(TOP2COL[cur.i]);
    } else {
      var t = G.tab[cur.i];
      if (key === 'ArrowLeft') toCol((cur.i + 6) % 7);
      else if (key === 'ArrowRight') toCol((cur.i + 1) % 7);
      else if (key === 'ArrowUp') {
        if (!held && cur.d > 0 && t[cur.d - 1].up) cur.d--;
        else cur = { a: 'top', i: COL2TOP[cur.i] };
      } else if (key === 'ArrowDown') {
        if (!held && cur.d >= 0 && cur.d < t.length - 1) cur.d++;
      }
    }
    refresh();
  }
  function curAsSrc() {
    if (cur.a === 'top') return cur.i === 1 ? { t: 'w' } : cur.i >= 2 ? { t: 'f', i: cur.i - 2 } : null;
    if (cur.a === 'tab') return { t: 't', i: cur.i, d: cur.d };
    return null;
  }
  function curAsDst() {
    if (cur.a === 'top') return cur.i >= 2 ? { t: 'f', i: cur.i - 2 } : null;
    if (cur.a === 'tab') return { t: 't', i: cur.i };
    return null;
  }
  function sameSpot(a, b) { return a.t === b.t && (a.t === 'w' || a.i === b.i); }

  // ---------- 操作 ----------
  function pushHist() { hist.push(JSON.stringify(G)); if (hist.length > 200) hist.shift(); }
  function afterAction() {
    save();
    if (isWon(G)) { onWin(); return; }
    if (canFinish(G)) { autoFound(true); return; }
    refresh();
  }
  function actDraw() {
    if (!G.stock.length && !G.waste.length) { toast('山札はからっぽ'); return; }
    pushHist();
    doDraw(G, drawN);
    afterAction();
  }
  function actMove(src, dst) {
    var cs = srcCards(G, src);
    pushHist();
    doMove(G, src, dst);
    if (dst.t === 'f') {
      var r = topRect(dst.i + 2);
      burst(r.x + CW / 2, r.y + CH / 2, rankOf(cs[0]) === 13 ? 26 : 8, isRed(dst.i) ? RED : '#ffffff', animDur * 0.8);
    }
    afterAction();
  }
  function autoDst(src) {
    var cs = srcCards(G, src);
    if (!cs.length) return null;
    if (cs.length === 1 && src.t !== 'f') { var f = { t: 'f', i: suitOf(cs[0]) }; if (canMove(G, src, f)) return f; }
    var empty = null;
    for (var k = 0; k < 7; k++) {
      var d = { t: 't', i: k };
      if (!canMove(G, src, d)) continue;
      if (G.tab[k].length) return d;
      if (!empty && !(src.t === 't' && src.d === 0)) empty = d;
    }
    return empty;
  }
  function tap() {
    if (cur.a === 'hud') { pauseMenu(); return; }
    if (held) {
      var src = held, dst = curAsDst();
      if (cur.a === 'top' && cur.i === 0) { held = null; toast('とりけし'); refresh(); return; }
      if ((cur.a === 'top' && cur.i === 1) || (dst && sameSpot(src, dst))) {
        if (cur.a === 'top' && cur.i === 1 && src.t !== 'w') { held = null; toast('とりけし'); refresh(); return; }
        var ad = autoDst(src);
        held = null;
        if (ad) actMove(src, ad); else { toast('置ける場所がない'); refresh(); }
        return;
      }
      if (dst && canMove(G, src, dst)) { held = null; actMove(src, dst); return; }
      toast('そこには置けない');
      return;
    }
    if (cur.a === 'top' && cur.i === 0) { actDraw(); return; }
    var s = curAsSrc();
    if (!s || !srcCards(G, s).length) {
      toast(cur.a === 'tab' ? 'あいた列には K を置ける' : cur.i === 1 ? '山札をめくろう' : 'まだカードがない');
      return;
    }
    held = s;
    refresh();
  }
  function undo() {
    if (!hist.length) { toast('もどせる手がない'); return false; }
    G = JSON.parse(hist.pop());
    held = null;
    save();
    refresh();
    return true;
  }
  // 組札へ置けるカードを順に飛ばす。finish=true はクリアまでの自動仕上げ
  function autoFound(finish) {
    if (!foundationMove(G)) { if (!finish) toast('組札に置けるカードがない'); refresh(); return; }
    if (!finish) pushHist();
    busy = true; held = null;
    var dur0 = animDur;
    animDur = finish ? 150 : 180;
    paintHint();
    (function step() {
      var m = foundationMove(G);
      if (!m) {
        busy = false; animDur = dur0; save();
        if (isWon(G)) onWin();
        else if (canFinish(G)) autoFound(true);
        else refresh();
        return;
      }
      var card = srcCards(G, m.src)[0];
      doMove(G, m.src, m.dst);
      var r = topRect(m.dst.i + 2);
      burst(r.x + CW / 2, r.y + CH / 2, rankOf(card) === 13 ? 26 : 7, isRed(m.dst.i) ? RED : '#ffffff', animDur * 0.8);
      paintHud();
      setTimeout(step, finish ? 85 : 140);
    })();
  }
  function onWin() {
    G.won = true; busy = true; held = null;
    winT0 = performance.now();
    var bestT = false, bestM = false;
    if (!DEMO) {
      stats.wins++;
      if (!stats.bestTime || G.time < stats.bestTime) { stats.bestTime = Math.round(G.time); bestT = true; }
      if (!stats.bestMoves || G.moves < stats.bestMoves) { stats.bestMoves = G.moves; bestM = true; }
      saved = null;
      save();
    }
    paintHud(); paintHint();
    toast('🎉 クリア！');
    for (var f = 0; f < 4; f++) { var r = topRect(f + 2); burst(r.x + CW / 2, r.y + CH / 2, 30, f % 3 ? RED : '#ffffff', f * 120 + 250); }
    setTimeout(function () { busy = false; winMenu(bestT, bestM); }, 1900);
  }

  // ---------- 画面とメニュー ----------
  function show(id) {
    ['title', 'game', 'menu', 'howto'].forEach(function (s) { el(s).classList.toggle('hidden', s !== id && !(id === 'menu' && s === 'game')); });
  }
  function setMenu(listId, items, idx) {
    menuEl = listId; menuItems = items; menuIdx = idx || 0;
    paintMenu();
  }
  function paintMenu() {
    var list = el(menuEl);
    list.innerHTML = '';
    menuItems.forEach(function (it, i) {
      var b = document.createElement('div');
      b.className = 'rail-btn' + (i === menuIdx ? ' cur' : '') + (it.off && it.off() ? ' off' : '');
      var label = typeof it.label === 'function' ? it.label() : it.label;
      var sub = typeof it.sub === 'function' ? it.sub() : it.sub;
      b.innerHTML = '<span>' + label + '</span>' + (sub ? '<small>' + sub + '</small>' : '');
      b.addEventListener('click', function () { menuIdx = i; paintMenu(); it.act(); });
      list.appendChild(b);
    });
  }
  function drawLabel() { return 'めくり枚数　◀ ' + drawN + '枚 ▶'; }
  function toggleDraw() { drawN = drawN === 1 ? 3 : 1; save(); paintMenu(); if (G) paintHud(); }

  function goTitle() {
    mode = 'title';
    held = null;
    show('title');
    var sub = '赤黒交互に並べて、A→K を組札へ<br>勝利 <b>' + stats.wins + '</b>回 ・ プレイ ' + stats.played + '回';
    if (stats.bestTime) sub += '<br>ベスト <span class="best">' + fmtTime(stats.bestTime) + '</span> ・ <span class="best">' + stats.bestMoves + '手</span>';
    el('title-sub').innerHTML = sub;
    var items = [];
    if (G && !G.won && G.moves > 0) saved = G;
    if (saved && !DEMO) items.push({ label: '▶ つづきから', sub: '手数 ' + saved.moves + ' ・ ' + fmtTime(saved.time), act: resumeGame });
    items.push({ label: '▶ 新しいゲーム', act: newGame });
    items.push({ label: drawLabel, sub: function () { return drawN === 1 ? 'かんたん' : 'むずかしい'; }, act: toggleDraw, lr: toggleDraw });
    items.push({ label: 'つかいかた', act: function () { goHowto('title'); } });
    setMenu('title-list', items, 0);
    paintHud();
  }
  function startPlay() {
    mode = 'game';
    show('game');
    held = null; busy = false; winT0 = 0;
    refresh();
  }
  function newGame() {
    var seed = DEMO ? DEMO_SEED : seedM ? +seedM[1] : (Math.random() * 1e9) | 0;
    if (DEMO) drawN = 1;
    G = dealState(rng(seed));
    hist = [];
    saved = null;
    if (!DEMO) stats.played++;
    save();
    // 配る演出: 山札の位置から各列へ
    disp = {};
    var now = performance.now(), k = 0;
    for (var r = 0; r < 7; r++) {
      for (var c = r; c < 7; c++) {
        var cd = G.tab[c][r], ys = tabYs(c);
        disp[cd.i] = { x: topSlotX(0), y: TOPY, fx: topSlotX(0), fy: TOPY, tx: colX(c), ty: ys[r], t0: now + k * 22, dur: 260, up: cd.up, flipT0: cd.up ? now + k * 22 + 200 : -1e9 };
        k++;
      }
    }
    cur = { a: 'tab', i: 0, d: 0 };
    lastTop = 0;
    startPlay();
    if (DEMO) demoStart();
  }
  function resumeGame() {
    G = saved; saved = null; hist = [];
    disp = {};
    cur = { a: 'tab', i: 0, d: 0 };
    startPlay();
  }
  function goHowto(from) {
    howtoBack = from;
    mode = 'howto';
    show('howto');
    paintHud();
    setMenu('howto-list', [{ label: '← もどる', act: function () { if (howtoBack === 'menu') pauseMenu(); else goTitle(); } }]);
  }
  function pauseMenu() {
    if (busy) return;
    mode = 'menu';
    held = null;
    show('menu');
    el('menu-title').textContent = 'メニュー';
    el('menu-sub').innerHTML = '手数 <b>' + G.moves + '</b> ・ 時間 <b>' + fmtTime(G.time) + '</b> ・ 組札 <b>' +
      (G.found[0].length + G.found[1].length + G.found[2].length + G.found[3].length) + '</b>/52';
    setMenu('menu-list', [
      { label: '← もどる', act: backToGame },
      { label: '1手もどす', sub: function () { return hist.length ? 'あと' + hist.length + '手' : 'なし'; }, off: function () { return !hist.length; },
        act: function () { if (undo()) backToGame(); } },
      { label: '自動で組札へ', act: function () { backToGame(); autoFound(false); } },
      { label: '新しいゲーム', act: newGame },
      { label: drawLabel, sub: 'つぎのめくりから', act: toggleDraw, lr: toggleDraw },
      { label: 'つかいかた', act: function () { goHowto('menu'); } },
      { label: 'タイトルへ', act: goTitle }
    ]);
    paintHud();
  }
  function backToGame() { mode = 'game'; show('game'); refresh(); }
  function winMenu(bestT, bestM) {
    mode = 'menu';
    show('menu');
    el('menu-title').textContent = '🎉 クリア！';
    el('menu-sub').innerHTML = '手数 <b>' + G.moves + '</b>' + (bestM ? ' <span class="best">ベスト！</span>' : '') +
      ' ・ 時間 <b>' + fmtTime(G.time) + '</b>' + (bestT ? ' <span class="best">ベスト！</span>' : '') +
      '<br>' + (DEMO ? 'デモプレイ（記録は保存しません）' : '勝利 <b>' + stats.wins + '</b>回 ・ プレイ ' + stats.played + '回');
    setMenu('menu-list', [
      { label: '▶ 新しいゲーム', act: newGame },
      { label: 'タイトルへ', act: goTitle }
    ]);
  }

  // ---------- キー ----------
  function menuKey(key) {
    var it = menuItems[menuIdx];
    if (key === 'ArrowUp') { menuIdx = (menuIdx + menuItems.length - 1) % menuItems.length; paintMenu(); }
    else if (key === 'ArrowDown') { menuIdx = (menuIdx + 1) % menuItems.length; paintMenu(); }
    else if ((key === 'ArrowLeft' || key === 'ArrowRight') && it && it.lr) it.lr();
    else if (key === 'Enter' || key === ' ') { if (it) it.act(); }
    else return false;
    return true;
  }
  function gameKey(key) {
    if (busy || G.won) return true;
    if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') moveCursor(key);
    else if (key === 'Enter' || key === ' ') tap();
    else return false;
    return true;
  }
  function handleKey(key) {
    if (key === 'Escape') { // PC確認用の補助（グラスでは戻るジェスチャーが使えない）
      if (mode === 'howto') { if (howtoBack === 'menu') pauseMenu(); else goTitle(); }
      else if (mode === 'game') { if (held) { held = null; refresh(); } else pauseMenu(); }
      else if (mode === 'menu' && G && !G.won) backToGame();
      else if (mode === 'menu') goTitle();
      return true;
    }
    return mode === 'game' ? gameKey(key) : menuKey(key);
  }

  document.addEventListener('keydown', function (e) {
    if (DEMO && e.isTrusted && mode !== 'title') { e.preventDefault(); return; }
    if (e.repeat && e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') { e.preventDefault(); return; }
    if (handleKey(e.key)) e.preventDefault();
  });
  // PC確認用: クリックでカーソル移動＋タップ
  el('hud').addEventListener('click', function (e) {
    if (mode === 'game' && e.target.closest('#hud-menu')) pauseMenu();
  });
  cv.addEventListener('click', function (e) {
    if (mode !== 'game' || busy || DEMO) return;
    var b = cv.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
    var col = Math.floor((x - 13) / 82);
    if (col < 0 || col > 6) return;
    if (y >= TOPY && y < TOPY + CH) {
      if (col === 2) col = 1;
      cur = { a: 'top', i: COL2TOP[col] };
    } else if (y >= TABY) {
      var t = G.tab[col], ys = tabYs(col), d = t.length - 1;
      for (var j = t.length - 1; j >= 0; j--) { if (y >= ys[j]) { d = j; break; } }
      while (d < t.length - 1 && d >= 0 && !t[d].up) d++;
      cur = { a: 'tab', i: col, d: held ? t.length - 1 : d };
    } else return;
    normCur();
    tap();
  });

  // ---------- デモ（自動プレイ・録画用） ----------
  var SLOW = 5;
  var demo = { plan: null, step: 0, fast: false };
  function demoStart() {
    demo.plan = solve(G, drawN, 800) || [];
    demo.step = 0; demo.fast = false;
    setTimeout(demoTick, 1300);
  }
  function navKey(target, holding) {
    if (target.a === 'top') {
      if (cur.a === 'hud') return 'ArrowDown';
      if (cur.a === 'tab') return 'ArrowUp';
      if (cur.i === target.i) return null;
      return ((target.i - cur.i + 6) % 6) <= 3 ? 'ArrowRight' : 'ArrowLeft';
    }
    if (cur.a !== 'tab') return 'ArrowDown';
    if (cur.i !== target.i) return ((target.i - cur.i + 7) % 7) <= 3 ? 'ArrowRight' : 'ArrowLeft';
    if (!holding && target.d != null && cur.d !== target.d) return cur.d > target.d ? 'ArrowUp' : 'ArrowDown';
    return null;
  }
  function spotOf(p, isDst) {
    if (p.t === 'w') return { a: 'top', i: 1 };
    if (p.t === 'f') return { a: 'top', i: p.i + 2 };
    return { a: 'tab', i: p.i, d: isDst ? null : p.d };
  }
  function demoTick() {
    if (mode !== 'game' || !G || G.won) return;
    if (busy) { setTimeout(demoTick, 80); return; }
    var m = demo.plan[demo.step];
    if (!m) return;
    if (demo.step >= SLOW) {
      if (!demo.fast) { demo.fast = true; animDur = 110; cur = { a: 'hud' }; refresh(); }
      if (m.draw) actDraw(); else actMove(m.src, m.dst);
      demo.step++;
      setTimeout(demoTick, m.draw ? 55 : 95);
      return;
    }
    var target = m.draw ? { a: 'top', i: 0 } : held ? spotOf(m.dst, true) : spotOf(m.src, false);
    var k = navKey(target, !!held);
    if (k) { handleKey(k); setTimeout(demoTick, 230); return; }
    var placing = m.draw || held;
    handleKey('Enter');
    if (placing) demo.step++;
    setTimeout(demoTick, placing ? 650 : 520);
  }

  // ---------- 起動 ----------
  makeBackPattern();
  load();
  goTitle();
  requestAnimationFrame(frame);
})();
