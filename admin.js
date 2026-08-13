/* ===========================================================
   TOKYO WASABI 資材在庫 ― 管理用（admin.html）
   ももさん専用。index.html からはリンクしていない。
   =========================================================== */
'use strict';

const state = { items: [], lines: [], stale: false };

let renderedKey = '';
let loading = false;

/* 編集できる項目。field は API に渡す名前、prop は item の中の名前 */
const FIELDS = [
  { field: 'rp', prop: 'rp', label: '発注点', type: 'number', ph: '例 5' },
  { field: 'unit', prop: 'qtyUnit', label: '単位', type: 'text', ph: '個 / 本 / kg' },
  { field: 'spec', prop: 'spec', label: '規格', type: 'text', ph: '700ml' },
  { field: 'supplier', prop: 'supplier', label: '発注先', type: 'text', ph: 'シモジマ' },
  { field: 'line', prop: 'line', label: '分類', type: 'select', wide: true },
];

const FIELD_BY_NAME = FIELDS.reduce((m, f) => ((m[f.field] = f), m), {});

const elList = document.getElementById('list');
const elAdd = document.getElementById('add');
const elSearch = document.getElementById('search');
const elReload = document.getElementById('reload');

/* ===========================================================
   小道具
   =========================================================== */

function getItem(row) {
  return state.items.find((i) => i.row === row) || null;
}

function cardEl(row) {
  return elList.querySelector('.card[data-row="' + row + '"]');
}

function fieldEl(row, field) {
  const c = cardEl(row);
  return c ? c.querySelector('[data-field="' + field + '"]') : null;
}

function valueOf(item, field) {
  const def = FIELD_BY_NAME[field];
  if (!def) return '';
  const v = item[def.prop];
  return v == null ? '' : String(v);
}

function lineOptions(selected) {
  const list = state.lines.slice();
  if (selected && !list.includes(selected)) list.push(selected);
  return list
    .map(
      (l) =>
        '<option value="' + esc(l) + '"' + (l === selected ? ' selected' : '') + '>' +
        esc(lineLabel(l)) + '</option>'
    )
    .join('');
}

/* ===========================================================
   描画
   =========================================================== */

function visibleItems() {
  const q = elSearch.value.trim().toLowerCase();
  const list = state.items.slice().sort((a, b) => {
    const la = String(a.line || ''),
      lb = String(b.line || '');
    if (la !== lb) return la < lb ? -1 : 1;
    return (a.row || 0) - (b.row || 0);
  });
  if (!q) return list;
  return list.filter((i) =>
    [i.name, i.supplier, i.line, i.group, i.spec]
      .map((v) => String(v || '').toLowerCase())
      .some((v) => v.includes(q))
  );
}

function fieldHTML(it, def) {
  const id = 'f-' + it.row + '-' + def.field;
  let control;
  if (def.type === 'select') {
    control =
      '<select id="' + id + '" data-field="line">' + lineOptions(it.line) + '</select>';
  } else if (def.type === 'number') {
    control =
      '<input id="' + id + '" data-field="' + def.field + '" type="number" step="any" min="0"' +
      ' inputmode="decimal" placeholder="' + esc(def.ph || '') + '"' +
      ' value="' + esc(valueOf(it, def.field)) + '">';
  } else {
    control =
      '<input id="' + id + '" data-field="' + def.field + '" type="text"' +
      ' placeholder="' + esc(def.ph || '') + '"' +
      ' value="' + esc(valueOf(it, def.field)) + '">';
  }
  return (
    '<label class="field' + (def.wide ? ' wide' : '') + '" for="' + id + '">' +
    '<span>' + esc(def.label) + '</span>' + control + '</label>'
  );
}

function subtitle(it) {
  const bits = [it.managed ? '数量管理' : 'ボタン運用'];
  if (it.group) bits.push('グループ ' + it.group);
  if (it.status) bits.push(it.status);
  return bits.join(' ・ ');
}

function cardInner(it) {
  let h = '<span class="card-spin spinner"></span>';
  h += '<div class="card-head"><div class="card-title"><h3>' + esc(it.name) + '</h3>';
  h += '<p class="group">' + esc(subtitle(it)) + '</p>';
  h += '</div><span class="row-tag">' + esc(it.row) + '行目</span></div>';
  h += '<div class="fields">' + FIELDS.map((d) => fieldHTML(it, d)).join('') + '</div>';
  return h;
}

function render(force) {
  const list = visibleItems();
  const key = list.map((i) => i.row).join(',') + '|' + state.lines.join(',');

  if (force || key !== renderedKey) {
    const frag = document.createDocumentFragment();
    if (!list.length) {
      const d = document.createElement('div');
      d.className = 'notice';
      d.innerHTML = '<span class="big">該当する品目がありません</span>絞り込みの言葉を変えてみてください。';
      frag.appendChild(d);
    }
    for (const it of list) {
      const el = document.createElement('article');
      el.className = 'card admin-card';
      el.dataset.row = String(it.row);
      el.innerHTML = cardInner(it);
      frag.appendChild(el);
    }
    elList.replaceChildren(frag);
    renderedKey = key;
    return;
  }

  // 並びは同じ。入力中のところを壊さないよう、値だけそっと合わせる
  for (const it of list) {
    const card = cardEl(it.row);
    if (!card) continue;
    const h3 = card.querySelector('h3');
    if (h3 && h3.textContent !== it.name) h3.textContent = it.name;
    const sub = card.querySelector('.group');
    if (sub && sub.textContent !== subtitle(it)) sub.textContent = subtitle(it);
    card.querySelectorAll('[data-field]').forEach((el) => {
      if (el === document.activeElement) return;
      if (el.classList.contains('dirty')) return; // 入力中
      if (el.classList.contains('saving')) return; // 保存の順番待ち。まだサーバーに届いていない
      const v = valueOf(it, el.dataset.field);
      if (el.value !== v) el.value = v;
    });
  }
}

/**
 * replaceAll を付けるのは全件読み込み（load）のときだけ。
 * 書き込みの返事は 1 件だけのことがあるので、行番号で突き合わせて上書きする。
 */
function applyData(data, replaceAll) {
  if (Array.isArray(data.lines) && data.lines.length) state.lines = data.lines;
  if (Array.isArray(data.items)) {
    state.items = replaceAll ? data.items : mergeItems(state.items, data.items);
  }
  saveSnapshot(state.items, state.lines); // 次に開いたときすぐ出せるように残す
  syncAddLines();
  render();
}

/* ===========================================================
   1 項目の保存
   =========================================================== */

function revert(el, prev, message) {
  el.value = prev;
  el.classList.remove('dirty');
  toast(message, { type: 'error', timeout: 9000 });
}

function markDone(row, field) {
  const el = fieldEl(row, field);
  if (!el) return;
  el.classList.add('done');
  setTimeout(() => el.classList.remove('done'), 1500);
}

/* 保存は 1 件ずつ順番に送る。
   同じ品目の 2 か所を続けて直したとき、返事の前後が入れ替わって
   直したはずの値が戻ってしまうのを防ぐため。
   待っている間も他の入力欄は普通に使える。 */
let queue = Promise.resolve();

function enqueue(fn) {
  queue = queue.then(fn, fn);
  return queue;
}

function saveField(row, el) {
  const it = getItem(row);
  if (!it) return;

  const field = el.dataset.field;
  const def = FIELD_BY_NAME[field];
  const prev = valueOf(it, field);
  let value = String(el.value).trim();

  if (field === 'rp' && value !== '') {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      revert(el, prev, '発注点は数字で入れてください');
      return;
    }
    if (n === 0) {
      // 0 だと合計が発注点を下回ることがなく、永久に「要発注」にならない
      revert(
        el,
        prev,
        '発注点を 0 にすると、いつまでも「要発注」になりません。1 以上にするか、空欄にしてください'
      );
      return;
    }
    if (n < 0) {
      revert(el, prev, '発注点にマイナスは入れられません');
      return;
    }
    value = n;
  }

  if (String(value) === prev) {
    el.classList.remove('dirty');
    return;
  }

  // 直した欄だけを保存中にする。カード全体は止めないので、
  // 返事を待たずに次の欄へ進める
  el.classList.remove('dirty');
  el.classList.add('saving');
  el.disabled = true;

  enqueue(async () => {
    try {
      const data = await api({ action: 'updateField', row, field, value });
      applyData(data);
      const back = fieldEl(row, field);
      if (back) {
        back.disabled = false;
        back.classList.remove('saving');
        const saved = getItem(row);
        if (saved) back.value = valueOf(saved, field); // サーバーが整えた値に合わせる
      }
      markDone(row, field);
      toast('「' + it.name + '」の' + def.label + 'を保存しました');
    } catch (err) {
      const back = fieldEl(row, field);
      if (back) {
        back.disabled = false;
        back.classList.remove('saving');
        back.value = prev;
      }
      toast(err.message || '保存できませんでした', { type: 'error', timeout: 7000 });
    }
  });
}

/* ===========================================================
   品目の追加
   =========================================================== */

const addName = document.getElementById('a-name');
const addLine = document.getElementById('a-line');
const addUnit = document.getElementById('a-unit');
const addRp = document.getElementById('a-rp');
const addBtn = document.getElementById('a-btn');

function syncAddLines() {
  const want = state.lines.join('\n');
  if (addLine.dataset.lines === want) return; // 選択中のものを消さないよう、変わったときだけ作り直す
  addLine.dataset.lines = want;
  const cur = addLine.value;
  addLine.innerHTML = lineOptions(state.lines.includes(cur) ? cur : state.lines[0]);
}

async function addItem() {
  if (state.stale) return;
  const name = addName.value.trim();
  if (!name) {
    toast('品名を入れてください', { type: 'error' });
    addName.focus();
    return;
  }
  const line = addLine.value;
  const unit = addUnit.value.trim();

  let rp = '';
  const rpRaw = addRp.value.trim();
  if (rpRaw !== '') {
    const n = Number(rpRaw);
    if (!Number.isFinite(n) || n < 0) {
      toast('発注点は 1 以上の数字か、空欄にしてください', { type: 'error' });
      return;
    }
    if (n === 0) {
      toast(
        '発注点を 0 にすると、いつまでも「要発注」になりません。1 以上にするか、空欄にしてください',
        { type: 'error', timeout: 9000 }
      );
      return;
    }
    rp = n;
  }

  const before = new Set(state.items.map((i) => i.row));
  setBusy(elAdd, true);
  try {
    const data = await api({ action: 'addItem', name, line, unit, rp });
    applyData(data);
    setBusy(elAdd, false);
    addName.value = '';
    addUnit.value = '';
    addRp.value = '';
    elSearch.value = '';
    render(true);

    const added = state.items.find((i) => !before.has(i.row));
    if (added) {
      const c = cardEl(added.row);
      if (c) {
        c.scrollIntoView({ block: 'center', behavior: 'smooth' });
        flash(c);
      }
    }
    toast('「' + name + '」を追加しました');
  } catch (err) {
    setBusy(elAdd, false);
    toast(err.message || '追加できませんでした', { type: 'error', timeout: 7000 });
  }
}

/* ===========================================================
   イベント
   =========================================================== */

elList.addEventListener('input', (e) => {
  if (state.stale) return;
  const el = e.target.closest('[data-field]');
  if (el) el.classList.add('dirty');
});

elList.addEventListener('change', (e) => {
  if (state.stale) return; // 前回の値が出ているあいだは保存させない
  const el = e.target.closest('[data-field]');
  if (!el) return;
  const card = el.closest('.card');
  if (card) saveField(Number(card.dataset.row), el);
});

elList.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('input[data-field]')) {
    e.preventDefault();
    e.target.blur();
  }
});

elSearch.addEventListener('input', () => render());
addBtn.addEventListener('click', addItem);
elReload.addEventListener('click', () => load(true));

/* ===========================================================
   読み込み
   =========================================================== */

function showLoading() {
  elList.innerHTML = '<div class="loading"><span class="spinner"></span>読み込み中…</div>';
  renderedKey = '';
}

/* ---- 「前回の内容です」の帯 ---- */

const elStaleBar = document.getElementById('stalebar');
const elStaleMsg = document.getElementById('stalemsg');
const elStaleSpin = document.getElementById('stalespin');
const elStaleRetry = document.getElementById('staleretry');

function showStaleBar(message, failed) {
  elStaleMsg.textContent = message;
  elStaleSpin.hidden = !!failed;
  elStaleRetry.hidden = !failed;
  elStaleBar.hidden = false;
}

function clearStale() {
  state.stale = false;
  document.body.classList.remove('stale');
  elStaleBar.hidden = true;
}

elStaleRetry.addEventListener('click', () => {
  showStaleBar(elStaleMsg.textContent, false);
  load(false);
});

function showLoadError(msg) {
  elList.innerHTML =
    '<div class="notice"><span class="big">読み込めませんでした</span>' +
    esc(msg) +
    '<br><button type="button" id="retry">もう一度読み込む</button></div>';
  renderedKey = '';
  const b = document.getElementById('retry');
  if (b) b.addEventListener('click', () => load(true));
}

let firstLoad = true;

async function load(showSpinner) {
  if (loading) return;
  loading = true;
  elReload.classList.add('spin');
  elReload.disabled = true;
  if (showSpinner) showLoading();
  try {
    // 起動時は common.js が先に始めておいた読み込みを受け取る
    const data = firstLoad ? await bootLoad : await apiLoad();
    firstLoad = false;
    if (data && data.__error) throw data.__error;
    applyData(data, true); // 全件読み込みなので丸ごと入れ替える
    clearStale();
  } catch (err) {
    if (state.stale) {
      showStaleBar(
        '最新の内容を取れませんでした。いま出ているのは ' +
          whenText(bootCache.savedAt) + ' 時点の内容です',
        true
      );
    } else if (state.items.length) {
      toast(err.message || '読み込めませんでした', { type: 'error', timeout: 7000 });
    } else {
      showLoadError(err.message || '');
    }
  } finally {
    loading = false;
    elReload.classList.remove('spin');
    elReload.disabled = false;
  }
}

/* 起動 */
elReload.innerHTML = icon('refresh');

if (bootCache) {
  // 前回の内容をすぐ出す。最新に入れ替わるまでは断りを出し、編集させない
  state.items = bootCache.items;
  state.lines = bootCache.lines || [];
  state.stale = true;
  document.body.classList.add('stale');
  syncAddLines();
  render(true);
  showStaleBar(
    '最新の内容を取っています… いま出ているのは ' + whenText(bootCache.savedAt) + ' 時点の内容です'
  );
}

load(!bootCache); // 前回の内容が出ているなら「読み込み中…」は出さない
