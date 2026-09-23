/* ===========================================================
   TOKYO WASABI 資材在庫 ― 共通部品
   index.html / admin.html の両方から読み込む
   =========================================================== */
'use strict';

/* Apps Script のウェブアプリ URL（JSON API） */
const ENDPOINT =
  'https://script.google.com/macros/s/AKfycbwaJlUIpU4orf7L5mrt-AcSE8dL-gfjy8lHs2ZOXh2xUK0dINYv7Lsp5TNe3lZiyV3cFw/exec';

/* 拠点。画面ではどこでも「倉庫 / 牽引 / 自走」の短い呼び方で通す */
const LOCS = [
  { key: 'soko', label: '倉庫' },
  { key: 'ken', label: '牽引' },
  { key: 'jiso', label: '自走' },
];

/** soko / ken / jiso から表示名を引く */
const LOC_NAME = LOCS.reduce((m, l) => ((m[l.key] = l.label), m), {});

/* ステータスの遷移と見た目
   在庫あり →（なくなった）→ 要発注 →（発注した）→ 発注済み →（届いた）→ 在庫あり

   数量で管理している品目の「届いた」だけは、押してすぐ在庫ありにはせず、
   届いた数量を入れてもらってから残数を増やす（app.js の receiveInner / doReceive）。
   数を増やさずに在庫ありへ戻すと、残数が発注点以下のままなので
   すぐにまた要発注に戻ってしまうため */
const STATUS = {
  在庫あり: { cls: 'ok', next: '要発注', action: 'なくなった', btn: 'out' },
  要発注: { cls: 'warn', next: '発注済み', action: '発注した', btn: 'warn' },
  発注済み: { cls: 'sent', next: '在庫あり', action: '届いた', btn: 'primary' },
};

/* ---------- 小道具 ---------- */

function esc(v) {
  return String(v == null ? '' : v).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/** 空文字・null を null に、それ以外は数値に。数値にできなければ null */
function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 表示用。null は「—」、小数は 2 桁まで */
function fmt(n) {
  if (n == null) return '—';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** "1 止まる" → "止まる"（先頭の数字を表示時だけ落とす） */
function lineLabel(line) {
  const s = String(line == null ? '' : line);
  return s.replace(/^\s*\d+[.．、\s　]*/, '').trim() || s;
}

/**
 * −1 / +1 の刻みを決める。
 * 1. lot に値があればそれを使う（袋やケース単位でしか動かない品目）
 * 2. なければ 1
 *
 * 以前は「単位が kg・L なら 0.5 刻み」という決めうちも入れていたが、やめた。
 * lot という決める場所ができたあとでは、こちらが勝手に決めた数が出るだけで
 * 「5 にしたはずなのに 0.5 になる」という混乱のもとになるため。
 * 0.5 刻みにしたい品目は、lot に 0.5 と入れれば同じことができる。
 */
function stepFor(item) {
  const lot = num(item && item.lot);
  if (lot != null && lot > 0) return lot;
  return 1;
}

/* ---------- アイコン（インライン SVG の線画） ---------- */

const ICON_PATHS = {
  alert: '<path d="M12 3.6 21.2 19.4H2.8L12 3.6Z"/><path d="M12 9.6v4.1"/><path d="M12 16.5h.01"/>',
  stop: '<path d="M8.1 3h7.8L21 8.1v7.8L15.9 21H8.1L3 15.9V8.1L8.1 3Z"/><path d="M9.3 9.3l5.4 5.4"/>',
  clock: '<circle cx="12" cy="12" r="8.7"/><path d="M12 6.8v5.4l3.4 2"/>',
  drop: '<path d="M12 3.2c3.5 4.1 5.6 6.8 5.6 9.6a5.6 5.6 0 1 1-11.2 0c0-2.8 2.1-5.5 5.6-9.6Z"/><path d="M9.4 14.4a2.9 2.9 0 0 0 2.6 2.7"/>',
  box: '<path d="M12 3 20.4 7.4v9.2L12 21l-8.4-4.4V7.4L12 3Z"/><path d="M3.6 7.4 12 11.8l8.4-4.4"/><path d="M12 11.8V21"/>',
  bowl: '<path d="M3.4 10.9h17.2c0 4.4-3.5 7.9-7.8 7.9h-1.6c-4.3 0-7.8-3.5-7.8-7.9Z"/><path d="M4.4 20.6h15.2"/><path d="M9.7 7.9c.9-.9.9-2 0-2.9"/><path d="M14.3 7.9c.9-.9.9-2 0-2.9"/>',
  clipboard:
    '<path d="M9.2 4.3H7.4A1.4 1.4 0 0 0 6 5.7v12.9A1.4 1.4 0 0 0 7.4 20h9.2a1.4 1.4 0 0 0 1.4-1.4V5.7a1.4 1.4 0 0 0-1.4-1.4h-1.8"/><rect x="9" y="2.7" width="6" height="3.2" rx="1.1"/><path d="M9.3 12.7l2 2 3.5-3.9"/>',
  refresh:
    '<path d="M20.2 12a8.2 8.2 0 1 1-2.4-5.8"/><path d="M20.4 4.4v4.4H16"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  gear: '<circle cx="12" cy="12" r="3.1"/><path d="M12 2.8v2.4M12 18.8v2.4M4.5 4.5l1.7 1.7M17.8 17.8l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.5 19.5l1.7-1.7M17.8 6.2l1.7-1.7"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
};

function icon(name) {
  const d = ICON_PATHS[name] || ICON_PATHS.box;
  return (
    '<svg class="svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    d +
    '</svg>'
  );
}

/** 分類名からアイコンを推測する（未知の分類は箱アイコン） */
function lineIcon(line) {
  const s = String(line || '');
  if (/容器|包装|資材/.test(s)) return 'box';
  if (/食材|食品|材料/.test(s)) return 'bowl';
  if (/衛生|清掃|消毒/.test(s)) return 'drop';
  // 以前の分類名（スプレッドシートを戻したときのため）
  if (/止ま|停止|ストップ/.test(s)) return 'stop';
  if (/手配|時間|納期/.test(s)) return 'clock';
  return 'box';
}

/* ---------- 通信 ---------- */

/** 電波・GAS 側の一時的な不調が原因のエラーに印をつける */
function tempError(message) {
  const e = new Error(message);
  e.temporary = true;
  return e;
}

async function readJson(res) {
  // GAS は script.googleusercontent.com に転送されるとき、たまに 404 を返す。
  // 中身が壊れているわけではないので、こういうものは「一時的」として再試行する
  if (!res.ok) throw tempError('サーバーエラー（' + res.status + '）');
  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw tempError('サーバーの応答を読み取れませんでした');
  }
  // GAS が ok:false を返したときは、内容の問題なので何度送っても同じ。再試行しない
  if (!data || data.ok !== true) {
    throw new Error((data && data.error) || '処理に失敗しました');
  }
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 一時的な失敗のときだけ、少し待って送り直す */
async function withRetry(send, tries) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await send();
    } catch (err) {
      last = err;
      if (!err.temporary || i === tries - 1) throw err;
      await sleep(400 + i * 900);
    }
  }
  throw last;
}

/** 起動時の全件読み込み。読むだけなので何度でも送り直してよい */
async function apiLoad() {
  return withRetry(async () => {
    let res;
    try {
      res = await fetch(ENDPOINT + '?action=load', { method: 'GET' });
    } catch (e) {
      throw tempError('通信できませんでした。電波の状態を確認してください');
    }
    return readJson(res);
  }, 3);
}

/* 同じ内容を 2 回送っても結果が変わらない操作。ここだけ自動で送り直す。
   adjustQty（加減算）と addItem（追加）は、送り直すと二重に効いてしまう
   ことがあるので、失敗したら画面を元に戻してユーザーに押し直してもらう。 */
const RESENDABLE = { setQty: true, setStatus: true, updateField: true };

/** 書き込み。CORS のプリフライトを避けるため text/plain + JSON 文字列 */
async function api(payload) {
  const tries = RESENDABLE[payload && payload.action] ? 3 : 1;
  return withRetry(async () => {
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      throw tempError('通信できませんでした。電波の状態を確認してください');
    }
    return readJson(res);
  }, tries);
}

/* ---------- トースト ---------- */

let toastRoot = null;

/**
 * toast('保存しました')
 * toast('失敗しました', { type: 'error' })
 * toast('...', { timeout: 15000, action: { label: '元に戻す', onClick } })
 */
function toast(message, opts) {
  opts = opts || {};
  if (!toastRoot) {
    toastRoot = document.createElement('div');
    toastRoot.className = 'toasts';
    toastRoot.setAttribute('role', 'status');
    toastRoot.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastRoot);
  }

  const el = document.createElement('div');
  el.className = 'toast' + (opts.type === 'error' ? ' toast-error' : '');

  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message;
  el.appendChild(text);

  let timer = null;
  const close = () => {
    if (timer) clearTimeout(timer);
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  };

  if (opts.action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-action';
    b.textContent = opts.action.label;
    b.addEventListener('click', () => {
      close();
      opts.action.onClick();
    });
    el.appendChild(b);
  }

  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'toast-close';
  x.setAttribute('aria-label', '閉じる');
  x.innerHTML = icon('x');
  x.addEventListener('click', close);
  el.appendChild(x);

  toastRoot.appendChild(el);
  timer = setTimeout(close, opts.timeout || 4500);
  return close;
}

/* ---------- 返ってきた品目を手元のデータに反映する ---------- */

/**
 * GAS は action によって返す件数が違う。
 *   updateField … 全件（39件）
 *   adjustQty / setQty … 変えた 1 件だけ
 * 丸ごと入れ替えると他の品目が消えてしまうので、行番号で突き合わせて上書きする。
 * 知らない行番号（品目の追加）は末尾に足したうえで行番号順に並べ直す。
 */
function mergeItems(current, incoming) {
  if (!Array.isArray(incoming) || !incoming.length) return current;
  const byRow = new Map(current.map((i) => [i.row, i]));
  let added = false;
  for (const it of incoming) {
    if (!byRow.has(it.row)) added = true;
    byRow.set(it.row, it);
  }
  const list = Array.from(byRow.values());
  if (added) list.sort((a, b) => (a.row || 0) - (b.row || 0));
  return list;
}

/* ---------- カードの通信中表示 ---------- */

function setBusy(el, on) {
  if (!el) return;
  el.classList.toggle('busy', !!on);
  el.querySelectorAll('button, input, select').forEach((c) => {
    c.disabled = !!on;
  });
}

/** 保存できたことを緑の枠で一瞬示す */
function flash(el) {
  if (!el) return;
  el.classList.remove('saved');
  void el.offsetWidth; // アニメーションをやり直させる
  el.classList.add('saved');
  setTimeout(() => el.classList.remove('saved'), 1300);
}

/* ---------- 何かで落ちたときに、原因を画面に出す ---------- */

/* 端末によっては、こちらで再現できない理由で止まることがある
   （古い Safari に無い書き方を使っていた、など）。
   そのとき画面が真っ白になると「エラーになった」以上のことが分からないので、
   赤い帯で中身を出し、撮って送ってもらえるようにしておく。 */

function showFatal(message, where) {
  try {
    const put = function () {
      if (document.getElementById('fatal')) return; // 最初の1件だけ出す
      const d = document.createElement('div');
      d.id = 'fatal';
      d.className = 'fatal';
      const t = document.createElement('b');
      t.textContent = 'アプリでエラーが起きました';
      const p = document.createElement('p');
      p.textContent = 'この画面を撮って Momo に送ってください。';
      const c = document.createElement('code');
      c.textContent = String(message || '不明なエラー') + (where ? '\n' + where : '');
      d.appendChild(t);
      d.appendChild(p);
      d.appendChild(c);
      document.body.appendChild(d);
    };
    if (document.body) put();
    else document.addEventListener('DOMContentLoaded', put);
  } catch (e) {
    /* ここで失敗したら打つ手がない */
  }
}

window.addEventListener('error', function (e) {
  // 画像などの読み込み失敗ではなく、スクリプトが止まったときだけ出す
  if (!e || !e.message) return;
  const file = String(e.filename || '').split('/').pop();
  showFatal(e.message, file ? file + ' ' + e.lineno + '行目' : '');
});

/* ---------- 前回の数字を覚えておく ---------- */

/* GAS の応答に 2 秒前後かかり、その間まっ白で待たされるのが長い。
   そこで前回の数字を端末に残しておき、開いた瞬間に出す。
   ただし古い数字を見て発注を判断してしまうと事故になるので、
   最新に入れ替わるまでは画面上部に断りを出し、
   −1 / +1 / 直接入力 / ステータスのボタンは押せないようにしている。 */

const SNAPSHOT_KEY = 'wasabi-inventory:snapshot:v1';
const SNAPSHOT_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // これより古ければ使わない

function saveSnapshot(items, lines) {
  try {
    localStorage.setItem(
      SNAPSHOT_KEY,
      JSON.stringify({ savedAt: Date.now(), items: items, lines: lines })
    );
  } catch (e) {
    /* 保存できない設定の端末でも、アプリは今までどおり動く */
  }
}

function readSnapshot() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !Array.isArray(s.items) || !s.items.length) return null;
    if (!s.savedAt || Date.now() - s.savedAt > SNAPSHOT_MAX_AGE) return null;
    return s;
  } catch (e) {
    return null;
  }
}

/** 「8/13 0:09」のような表示に */
function whenText(ms) {
  const d = new Date(ms);
  return d.getMonth() + 1 + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
}

/* 同期で読む。await を挟まないので、画面はすぐ組み立てられる */
const bootCache = readSnapshot();

/* ---------- 起動をできるだけ早くする ---------- */

/* GAS の応答に 2 秒前後かかるので、待ち時間を少しでも削るために
   画面を組み立てるコード（app.js / admin.js）の解析を待たず、
   このファイルが読み込まれた時点で読み込みを始めてしまう。
   そのため index.html / admin.html では common.js を <head> に置いている。
   結果は bootLoad に入れておき、app.js / admin.js が受け取る。 */
const bootLoad = apiLoad().catch((err) => ({ __error: err }));

/* ---------- ホーム画面に追加できるようにする ---------- */

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* 登録できなくてもアプリは普通に動くので、何も知らせない */
    });
  });
}
