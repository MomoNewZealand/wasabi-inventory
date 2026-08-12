/* ===========================================================
   TOKYO WASABI 資材在庫 ― スタッフ用（index.html）
   =========================================================== */
'use strict';

const state = {
  items: [],
  lines: [],
  tab: 'reorder',
  loc: 'soko',
};

let renderedKey = ''; // いま画面に並んでいるカードの並び順（変わったときだけ組み直す）
const sigs = new Map(); // row → カードの内容のハッシュ代わり
let lastLoadedAt = 0;
let loading = false;

const elLocBar = document.getElementById('locbar');
const elList = document.getElementById('list');
const elTabbar = document.getElementById('tabbar');
const elReload = document.getElementById('reload');

/* ===========================================================
   タブ
   =========================================================== */

function tabDefs() {
  const defs = [{ id: 'reorder', label: '要発注', icon: 'alert' }];
  for (const line of state.lines) {
    defs.push({ id: 'line:' + line, label: lineLabel(line), icon: lineIcon(line) });
  }
  defs.push({ id: 'stock', label: '棚卸し', icon: 'clipboard' });
  return defs;
}

function renderTabs() {
  const defs = tabDefs();
  if (!defs.some((t) => t.id === state.tab)) state.tab = 'reorder';

  elTabbar.innerHTML = defs
    .map(
      (t) =>
        '<button type="button" class="tab" role="tab" data-tab="' +
        esc(t.id) +
        '" aria-selected="' +
        (t.id === state.tab) +
        '">' +
        icon(t.icon) +
        (t.id === 'reorder' ? '<span class="badge" hidden>0</span>' : '') +
        '<span>' +
        esc(t.label) +
        '</span></button>'
    )
    .join('');
  updateBadge();
}

function updateBadge() {
  const n = state.items.filter((i) => i.status === '要発注').length;
  const b = elTabbar.querySelector('.badge');
  if (!b) return;
  b.textContent = n > 99 ? '99+' : String(n);
  b.hidden = n === 0;
}

function selectTab(id) {
  if (state.tab === id) return;
  state.tab = id;
  elTabbar.querySelectorAll('.tab').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.tab === id));
  });
  renderList(true);
  window.scrollTo({ top: 0 });
}

/* ===========================================================
   拠点の切り替え
   =========================================================== */

function renderLocBar() {
  elLocBar.innerHTML =
    '<span class="loc-label">場所</span>' +
    LOCS.map(
      (l) =>
        '<button type="button" class="loc" data-loc="' +
        l.key +
        '" aria-pressed="' +
        (l.key === state.loc) +
        '">' +
        esc(l.label) +
        '</button>'
    ).join('');
}

function selectLoc(key) {
  if (state.loc === key) return;
  state.loc = key;
  elLocBar.querySelectorAll('.loc').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.loc === key));
  });
  renderList(true);
}

/* ===========================================================
   一覧の組み立て
   =========================================================== */

function byLineThenRow(a, b) {
  const la = String(a.line || ''),
    lb = String(b.line || '');
  if (la !== lb) return la < lb ? -1 : 1;
  return (a.row || 0) - (b.row || 0);
}

/** 表示する行（セクション見出し＋カード）を組み立てる */
function buildRows() {
  const out = [];
  const tab = state.tab;

  if (tab === 'reorder') {
    const need = state.items.filter((i) => i.status === '要発注').sort(byLineThenRow);
    const sent = state.items.filter((i) => i.status === '発注済み').sort(byLineThenRow);
    if (!need.length && !sent.length) {
      out.push({ type: 'empty', title: '発注が必要なものはありません', text: '在庫は足りています。' });
      return out;
    }
    if (need.length) {
      out.push({ type: 'section', label: '発注してください', count: need.length });
      need.forEach((i) => out.push({ type: 'card', item: i }));
    }
    if (sent.length) {
      out.push({ type: 'section', label: '発注済み・入荷待ち', count: sent.length });
      sent.forEach((i) => out.push({ type: 'card', item: i }));
    }
    return out;
  }

  if (tab === 'stock') {
    const managed = state.items.filter((i) => i.managed).sort(byLineThenRow);
    if (!managed.length) {
      out.push({ type: 'empty', title: '数量で管理している品目がありません', text: '' });
      return out;
    }
    let cur = null;
    for (const i of managed) {
      if (i.line !== cur) {
        cur = i.line;
        out.push({ type: 'section', label: lineLabel(cur) });
      }
      out.push({ type: 'card', item: i, noActions: true });
    }
    return out;
  }

  // 分類タブ
  const line = tab.slice(5);
  const list = state.items.filter((i) => i.line === line).sort((a, b) => (a.row || 0) - (b.row || 0));
  if (!list.length) {
    out.push({ type: 'empty', title: 'この分類の品目はありません', text: '' });
    return out;
  }
  list.forEach((i) => out.push({ type: 'card', item: i }));
  return out;
}

/* ===========================================================
   カード
   =========================================================== */

function cardSig(it, noActions) {
  return JSON.stringify([
    it.name, it.line, it.status, it.supplier,
    it.soko, it.ken, it.jiso, it.total,
    it.qtyUnit, it.spec, it.specUnit, it.managed, it.rp,
    it.servings, it.group, it.gTotal, it.gRp,
    it.qtyUpdated, it.updated,
    !!noActions,
  ]);
}

function specText(it) {
  const s = String(it.spec || '').trim();
  if (!s) return '';
  if (String(it.name || '').includes(s)) return ''; // 品名にすでに入っているなら重ねて出さない
  const u = String(it.specUnit || '');
  return u && !s.endsWith(u) ? s + u : s;
}

function headInner(it) {
  const st = STATUS[it.status];
  let h = '<div class="card-head"><div class="card-title"><h3>' + esc(it.name);
  const sp = specText(it);
  if (sp) h += '<span class="spec">' + esc(sp) + '</span>';
  h += '</h3>';

  if (it.group) {
    const su = esc(it.specUnit || '');
    const gt = num(it.gTotal);
    const gr = num(it.gRp);
    const bits = [];
    if (gt != null) bits.push('計' + fmt(gt) + su);
    if (gr != null) bits.push('発注点' + fmt(gr) + su);
    const over = gt != null && gr != null && gt <= gr;
    h +=
      '<p class="group' + (over ? ' over' : '') + '">（' +
      esc(it.group) + (bits.length ? ' ' + bits.join(' / ') : '') + '）</p>';
  }

  if (it.servings) h += '<p class="servings">' + esc(it.servings) + '</p>';
  h += '</div>';
  if (st) h += '<span class="chip ' + st.cls + '">' + esc(it.status) + '</span>';
  h += '</div>';
  return h;
}

function metaInner(it) {
  const bits = [];
  if (it.supplier) bits.push('<span><b>発注先</b> ' + esc(it.supplier) + '</span>');
  const rp = num(it.rp);
  // グループのある品目は発注点をグループ側（規格の単位）で見ているので、
  // 品目ごとの発注点は出さない（上のグループ行に「発注点1800ml」と出る）
  if (it.managed && !it.group && rp != null) {
    bits.push('<span><b>発注点</b> ' + fmt(rp) + esc(it.qtyUnit || '') + '</span>');
  }
  const upd = it.qtyUpdated || it.updated;
  if (upd) bits.push('<span><b>更新</b> ' + esc(upd) + '</span>');
  return bits.length ? '<div class="meta">' + bits.join('') + '</div>' : '';
}

function qtyInner(it) {
  const loc = state.loc;
  const locName = LOC_NAME[loc];
  const cur = num(it[loc]);
  const stepTxt = fmt(stepFor(it));
  const unit = esc(it.qtyUnit || '');
  const rp = num(it.rp);
  const total = num(it.total);

  let h = '<div class="qty"><div class="qty-row">';
  h += '<span class="qty-loc">' + esc(locName) + '</span>';
  h +=
    '<button type="button" class="step dec" data-act="dec" aria-label="' +
    esc(locName + 'の残数を' + stepTxt + '減らす') + '">−' + stepTxt + '</button>';
  h +=
    '<input class="qty-input" type="number" step="any" min="0" inputmode="decimal" enterkeyhint="done"' +
    ' value="' + (cur == null ? '' : esc(String(cur))) + '" placeholder="—"' +
    ' aria-label="' + esc(it.name + ' ' + locName + 'の残数') + '">';
  h += '<span class="qty-unit">' + unit + '</span>';
  h +=
    '<button type="button" class="step inc" data-act="inc" aria-label="' +
    esc(locName + 'の残数を' + stepTxt + '増やす') + '">+' + stepTxt + '</button>';
  h += '</div><div class="breakdown">';
  for (const l of LOCS) {
    h +=
      '<span class="bd' + (l.key === loc ? ' on' : '') + '"><b>' + esc(l.label) + '</b>' +
      fmt(num(it[l.key])) + '</span>';
  }
  // グループのある品目の残り少なさはグループ行のほうで示すので、ここでは色を付けない
  const low = !it.group && rp != null && total != null && total <= rp;
  h += '<span class="bd total' + (low ? ' low' : '') + '"><b>計</b>' + fmt(total) + unit + '</span>';
  h += '</div></div>';
  return h;
}

function actionsInner(it, noActions) {
  if (noActions) return '';
  const st = STATUS[it.status];
  if (!st) return '';
  // 数量で管理していて在庫がある品目は、−1/+1 で回すのでボタンは出さない
  if (it.managed && it.status === '在庫あり') return '';
  return (
    '<div class="actions"><button type="button" class="btn ' + st.btn +
    '" data-act="status">' + esc(st.action) + '</button></div>'
  );
}

function cardInner(it, noActions) {
  let h = '<span class="card-spin spinner"></span>';
  h += headInner(it);
  h += metaInner(it);
  if (it.managed) h += qtyInner(it);
  h += actionsInner(it, noActions);
  return h;
}

function makeCard(r) {
  const el = document.createElement('article');
  el.className = 'card';
  el.dataset.row = String(r.item.row);
  el.innerHTML = cardInner(r.item, r.noActions);
  return el;
}

function cardEl(row) {
  return elList.querySelector('.card[data-row="' + row + '"]');
}

function getItem(row) {
  return state.items.find((i) => i.row === row) || null;
}

/* ===========================================================
   描画（並びが変わったときだけ組み直し、あとは差分更新）
   =========================================================== */

function renderList(force) {
  const rows = buildRows();
  const key =
    state.tab + '|' + state.loc + '|' +
    rows
      .map((r) =>
        r.type === 'card' ? 'c' + r.item.row + (r.noActions ? '!' : '') :
        r.type === 'section' ? 's' + r.label : 'e'
      )
      .join(',');

  if (force || key !== renderedKey) {
    const frag = document.createDocumentFragment();
    sigs.clear();
    for (const r of rows) {
      if (r.type === 'section') {
        const h = document.createElement('h2');
        h.className = 'section-head';
        h.innerHTML =
          esc(r.label) + (r.count ? '<span class="count">' + r.count + '件</span>' : '');
        frag.appendChild(h);
      } else if (r.type === 'empty') {
        const d = document.createElement('div');
        d.className = 'notice';
        d.innerHTML = '<span class="big">' + esc(r.title) + '</span>' + esc(r.text || '');
        frag.appendChild(d);
      } else {
        frag.appendChild(makeCard(r));
        sigs.set(r.item.row, cardSig(r.item, r.noActions));
      }
    }
    elList.replaceChildren(frag);
    renderedKey = key;
    return;
  }

  // 並びは同じ。中身が変わったカードだけ描き直す
  for (const r of rows) {
    if (r.type !== 'card') continue;
    const s = cardSig(r.item, r.noActions);
    if (sigs.get(r.item.row) === s) continue;
    const el = cardEl(r.item.row);
    if (el) {
      el.className = 'card';
      el.innerHTML = cardInner(r.item, r.noActions);
    }
    sigs.set(r.item.row, s);
  }
}

/** 1 枚だけ元の値に描き直す（通信失敗で入力値を戻すとき） */
function redrawCard(row) {
  const it = getItem(row);
  const el = cardEl(row);
  if (!it || !el) return;
  const r = buildRows().find((x) => x.type === 'card' && x.item.row === row);
  el.className = 'card';
  el.innerHTML = cardInner(it, r && r.noActions);
  sigs.set(row, cardSig(it, r && r.noActions));
}

/** サーバーからの返事を state に反映する */
function applyData(data) {
  if (Array.isArray(data.lines)) {
    const changed = JSON.stringify(data.lines) !== JSON.stringify(state.lines);
    state.lines = data.lines;
    if (changed) renderTabs();
  }
  if (Array.isArray(data.items)) state.items = data.items;
  updateBadge();
  renderList();
}

/* ===========================================================
   操作
   =========================================================== */

/** 1 件ぶんの書き込み。カードを操作できなくして、終わったら結果を反映する */
async function run(row, payload, onOk) {
  const el = cardEl(row);
  setBusy(el, true);
  try {
    const data = await api(payload);
    applyData(data);
    setBusy(cardEl(row), false);
    flash(cardEl(row));
    if (onOk) onOk();
  } catch (err) {
    setBusy(cardEl(row), false);
    redrawCard(row); // 入力欄をサーバー側の値に戻す
    toast(err.message || '保存できませんでした', { type: 'error', timeout: 7000 });
  }
}

async function doStatus(it) {
  const st = STATUS[it.status];
  if (!st) return;
  const from = it.status;
  const to = st.next;
  const row = it.row;
  const name = it.name;

  await run(row, { action: 'setStatus', row, status: to, isUndo: false }, () => {
    toast('「' + name + '」を「' + to + '」にしました', {
      timeout: 15000,
      action: {
        label: '元に戻す',
        onClick: () => undoStatus(row, from, name),
      },
    });
  });
}

async function undoStatus(row, to, name) {
  await run(row, { action: 'setStatus', row, status: to, isUndo: true }, () => {
    toast('「' + name + '」を「' + to + '」に戻しました');
  });
}

async function doAdjust(it, delta) {
  const cur = num(it[state.loc]);
  if (cur == null && delta < 0) {
    toast('「' + it.name + '」の' + LOC_NAME[state.loc] + 'の残数がまだ入っていません。数字を直接入れてください', {
      type: 'error',
      timeout: 6500,
    });
    redrawCard(it.row);
    return;
  }
  if (cur != null && cur + delta < 0) {
    toast('残数を 0 より少なくはできません', { type: 'error' });
    redrawCard(it.row);
    return;
  }
  await run(it.row, { action: 'adjustQty', row: it.row, loc: state.loc, delta });
}

async function doSetQty(it, input) {
  const raw = String(input.value).trim();
  const cur = num(it[state.loc]);

  if (raw === '') {
    redrawCard(it.row);
    return;
  }
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0) {
    toast('0 以上の数字を入れてください', { type: 'error' });
    redrawCard(it.row);
    return;
  }
  if (cur != null && v === cur) {
    redrawCard(it.row);
    return;
  }
  await run(it.row, { action: 'setQty', row: it.row, loc: state.loc, qty: v });
}

/* ===========================================================
   イベント
   =========================================================== */

elTabbar.addEventListener('click', (e) => {
  const b = e.target.closest('.tab');
  if (b) selectTab(b.dataset.tab);
});

elLocBar.addEventListener('click', (e) => {
  const b = e.target.closest('.loc');
  if (b) selectLoc(b.dataset.loc);
});

elList.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const card = b.closest('.card');
  if (!card) return;
  const it = getItem(Number(card.dataset.row));
  if (!it) return;

  if (b.dataset.act === 'status') doStatus(it);
  else if (b.dataset.act === 'inc') doAdjust(it, stepFor(it));
  else if (b.dataset.act === 'dec') doAdjust(it, -stepFor(it));
});

elList.addEventListener('change', (e) => {
  const input = e.target.closest('input.qty-input');
  if (!input) return;
  const card = input.closest('.card');
  if (!card) return;
  const it = getItem(Number(card.dataset.row));
  if (it) doSetQty(it, input);
});

// Enter で確定してキーボードを閉じる
elList.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('qty-input')) {
    e.preventDefault();
    e.target.blur();
  }
});

elReload.addEventListener('click', () => load(true));

// 別の端末で誰かが更新している可能性があるので、
// しばらく放置してから戻ってきたときだけ読み直す
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - lastLoadedAt > 5 * 60 * 1000) load(false);
});

/* ===========================================================
   読み込み
   =========================================================== */

function showLoading() {
  elList.innerHTML = '<div class="loading"><span class="spinner"></span>読み込み中…</div>';
  renderedKey = '';
}

function showLoadError(msg) {
  elList.innerHTML =
    '<div class="notice"><span class="big">読み込めませんでした</span>' +
    esc(msg) +
    '<br><button type="button" id="retry">もう一度読み込む</button></div>';
  renderedKey = '';
  const b = document.getElementById('retry');
  if (b) b.addEventListener('click', () => load(true));
}

async function load(showSpinner) {
  if (loading) return;
  loading = true;
  elReload.classList.add('spin');
  elReload.disabled = true;
  if (showSpinner) showLoading();
  try {
    const data = await apiLoad();
    lastLoadedAt = Date.now();
    applyData(data); // この中で renderList() まで走る
  } catch (err) {
    if (state.items.length) {
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
renderLocBar();
renderTabs();
load(true);
