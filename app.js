/* ===========================================================
   TOKYO WASABI 資材在庫 ― スタッフ用（index.html）
   =========================================================== */
'use strict';

const state = {
  items: [],
  lines: [],
  tab: 'reorder',
  loc: 'soko',
  stale: false, // 前回の数字を出していて、まだ最新に入れ替わっていない
};

let renderedKey = ''; // いま画面に並んでいるカードの並び順（変わったときだけ組み直す）
const sigs = new Map(); // row → カードの内容のハッシュ代わり
let lastLoadedAt = 0;
let loading = false;

/* 「届いた」を押したあと、入荷数を入れてもらう欄を開いている品目。
   row → { loc, qty }。カードは中身が変わると描き直されるので、
   開いているかどうかと入力中の数字はここに持たせておく */
const receiving = new Map();

/* 入荷数だけ保存できて、状態を「在庫あり」にするところで失敗した品目。
   もう一度「届いた」を押したときに数量を二重に足さないための目印 */
const receivedSaved = new Map();

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
  syncLocBar();
  renderList(true);
  window.scrollTo({ top: 0 });
}

/** 要発注タブは拠点ごとの操作がないので、場所の切り替えは隠す */
function syncLocBar() {
  elLocBar.hidden = state.tab === 'reorder';
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
      need.forEach((i) => out.push({ type: 'card', item: i, mode: 'reorder' }));
    }
    if (sent.length) {
      out.push({ type: 'section', label: '発注済み・入荷待ち', count: sent.length });
      sent.forEach((i) => out.push({ type: 'card', item: i, mode: 'reorder' }));
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
      out.push({ type: 'card', item: i, mode: 'stock' });
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
  list.forEach((i) => out.push({ type: 'card', item: i, mode: 'line' }));
  return out;
}

/* ===========================================================
   カード
   =========================================================== */

function cardSig(it, mode) {
  return JSON.stringify([
    it.name, it.line, it.status, it.supplier,
    it.soko, it.ken, it.jiso, it.total,
    it.qtyUnit, it.spec, it.specUnit, it.managed, it.rp, it.lot,
    it.servings, it.group, it.gTotal, it.gRp,
    it.qtyUpdated, it.updated,
    mode,
    receiving.get(it.row) || null,
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

/**
 * タブによって出す情報を変える。
 *   reorder … 発注の判断に要るものだけ（残 / 発注点 / 発注先）
 *   line    … 出さない（数の増減に集中させる）
 *   stock   … 従来どおり（発注先 / 発注点 / 更新）
 */
function metaInner(it, mode) {
  if (mode === 'line') return '';
  const bits = [];
  const rp = num(it.rp);
  const unit = esc(it.qtyUnit || '');

  if (mode === 'reorder' && it.managed) {
    bits.push('<span class="m-total"><b>残</b> ' + fmt(num(it.total)) + unit + '</span>');
  }
  if (mode === 'stock' && it.supplier) {
    bits.push('<span><b>発注先</b> ' + esc(it.supplier) + '</span>');
  }
  // グループのある品目は発注点をグループ側（規格の単位）で見ているので、
  // 品目ごとの発注点は出さない（上のグループ行に「発注点1800ml」と出る）
  if (it.managed && !it.group && rp != null) {
    bits.push('<span><b>発注点</b> ' + fmt(rp) + unit + '</span>');
  }
  if (mode === 'reorder' && it.supplier) {
    bits.push('<span><b>発注先</b> ' + esc(it.supplier) + '</span>');
  }
  if (mode === 'stock') {
    const upd = it.qtyUpdated || it.updated;
    if (upd) bits.push('<span><b>更新</b> ' + esc(upd) + '</span>');
  }
  return bits.length ? '<div class="meta">' + bits.join('') + '</div>' : '';
}

function qtyInner(it, mode) {
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
  // 3拠点の内訳を出すのは棚卸しタブだけ。分類タブは合計だけでよい
  if (mode === 'stock') {
    for (const l of LOCS) {
      h +=
        '<span class="bd' + (l.key === loc ? ' on' : '') + '"><b>' + esc(l.label) + '</b>' +
        fmt(num(it[l.key])) + '</span>';
    }
  } else if (mode === 'line' && !it.group && rp != null) {
    // 発注点は「計」と同じ行に置く。行が増えないので縦幅は変わらない。
    // グループのある品目は発注点をグループ側（規格の単位）で見ているので出さない
    h += '<span class="bd"><b>発注点</b>' + fmt(rp) + unit + '</span>';
  }
  // グループのある品目の残り少なさはグループ行のほうで示すので、ここでは色を付けない
  const low = !it.group && rp != null && total != null && total <= rp;
  h += '<span class="bd total' + (low ? ' low' : '') + '"><b>計</b>' + fmt(total) + unit + '</span>';
  h += '</div></div>';
  return h;
}

/**
 * 「届いた」を押したあとに開く、入荷数の入力欄。
 * 数量で管理している品目だけに出る（receiving に入っている品目のみ）
 */
function receiveInner(it) {
  const r = receiving.get(it.row);
  if (!r) return '';
  const unit = esc(it.qtyUnit || '');
  const stepTxt = fmt(stepFor(it));

  let h = '<div class="recv"><p class="recv-q">いくつ届きましたか？</p>';

  h += '<div class="recv-locs">';
  for (const l of LOCS) {
    h +=
      '<button type="button" class="recv-loc" data-act="rloc" data-loc="' + esc(l.key) +
      '" aria-pressed="' + (r.loc === l.key) + '">' + esc(l.label) + '</button>';
  }
  h += '</div>';

  h += '<div class="qty-row">';
  h +=
    '<button type="button" class="step dec" data-act="rdec" aria-label="入荷数を' +
    esc(stepTxt) + '減らす">−' + stepTxt + '</button>';
  h +=
    '<input class="qty-input recv-input" type="number" step="any" min="0" inputmode="decimal"' +
    ' enterkeyhint="done" value="' + esc(r.qty) + '" placeholder="0"' +
    ' aria-label="' + esc(it.name + 'の入荷数') + '">';
  h += '<span class="qty-unit">' + unit + '</span>';
  h +=
    '<button type="button" class="step inc" data-act="rinc" aria-label="入荷数を' +
    esc(stepTxt) + '増やす">+' + stepTxt + '</button>';
  h += '</div>';

  h += '<p class="recv-preview">' + esc(recvPreview(it, r)) + '</p>';

  h +=
    '<div class="actions"><button type="button" class="btn out" data-act="rcancel">やめる</button>' +
    '<button type="button" class="btn primary" data-act="rsave">入荷を登録</button></div>';
  h +=
    '<button type="button" class="recv-skip" data-act="rskip">' +
    '数がわからない（数量はそのままで「在庫あり」にする）</button>';
  h += '</div>';
  return h;
}

/** 入荷欄の下に出す「登録すると 計◯◯」の一行 */
function recvPreview(it, r) {
  const add = num(r.qty);
  if (add == null || add <= 0) return '';
  const unit = it.qtyUnit || '';
  const total = num(it.total);
  if (total == null) return '＋' + fmt(add) + unit + ' 増やします';
  const after = total + add;
  const rp = num(it.rp);
  let t = '登録すると 計' + fmt(after) + unit;
  // グループのある品目は発注点をグループ側で見ているので、ここでは判定しない
  if (!it.group && rp != null && after <= rp) t += '（まだ発注点' + fmt(rp) + unit + '以下です）';
  return t;
}

function actionsInner(it, mode) {
  if (mode === 'stock') return ''; // 棚卸しは数を数えるだけ
  const st = STATUS[it.status];
  if (!st) return '';
  // 分類タブでは、数量管理していて在庫がある品目は −1/+1 で回すのでボタンを出さない
  if (mode === 'line' && it.managed && it.status === '在庫あり') return '';

  let h = '<div class="actions">';
  h += '<button type="button" class="btn ' + st.btn + '" data-act="status">' + esc(st.action) + '</button>';
  // ステータスは一方通行で回るので、押し間違えたときや発注点をなくしたときに
  // 「していない発注」を記録せずに戻せるようにしておく。
  // 発注済みには出さない。あちらは「届いた」から入荷数を入れる流れがあり、
  // そこを飛ばして在庫ありにすると残数が足りないままになってしまう
  // （数がわからないときは、その流れの中の「数がわからない」を使う）
  if (it.status === '要発注') {
    h += '<button type="button" class="btn out btn-narrow" data-act="reset">在庫あり</button>';
  }
  h += '</div>';
  return h;
}

function cardInner(it, mode) {
  let h = '<span class="card-spin spinner"></span>';
  h += headInner(it);
  h += metaInner(it, mode);
  // 要発注タブは残数を meta に出すので、増減の操作欄は出さない
  if (it.managed && mode !== 'reorder') h += qtyInner(it, mode);
  if (receiving.has(it.row)) h += receiveInner(it);
  else h += actionsInner(it, mode);
  return h;
}

function cardClass(mode) {
  return 'card mode-' + (mode || 'line');
}

function makeCard(r) {
  const el = document.createElement('article');
  el.className = cardClass(r.mode);
  el.dataset.row = String(r.item.row);
  el.innerHTML = cardInner(r.item, r.mode);
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
        r.type === 'card' ? 'c' + r.item.row + ':' + r.mode :
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
        sigs.set(r.item.row, cardSig(r.item, r.mode));
      }
    }
    // replaceChildren は Safari 14 より前にないので使わない（古い iPhone で真っ白になる）
    elList.innerHTML = '';
    elList.appendChild(frag);
    renderedKey = key;
    return;
  }

  // 並びは同じ。中身が変わったカードだけ描き直す
  for (const r of rows) {
    if (r.type !== 'card') continue;
    const s = cardSig(r.item, r.mode);
    if (sigs.get(r.item.row) === s) continue;
    const el = cardEl(r.item.row);
    if (el) {
      el.className = cardClass(r.mode);
      el.innerHTML = cardInner(r.item, r.mode);
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
  const mode = r ? r.mode : 'line';
  el.className = cardClass(mode);
  el.innerHTML = cardInner(it, mode);
  sigs.set(row, cardSig(it, mode));
}

/**
 * サーバーからの返事を state に反映する。
 * replaceAll を付けるのは全件読み込み（load）のときだけ。
 * 書き込みの返事は 1 件だけのことがあるので、行番号で突き合わせて上書きする。
 */
function applyData(data, replaceAll) {
  if (Array.isArray(data.lines) && data.lines.length) {
    const changed = JSON.stringify(data.lines) !== JSON.stringify(state.lines);
    state.lines = data.lines;
    if (changed) renderTabs();
  }
  if (Array.isArray(data.items)) {
    state.items = replaceAll ? data.items : mergeItems(state.items, data.items);
  }
  saveSnapshot(state.items, state.lines); // 次に開いたときすぐ出せるように残す
  updateBadge();
  renderList();
}

/* ===========================================================
   操作
   =========================================================== */

/** 1 件ぶんの書き込み。カードを操作できなくして、終わったら結果を反映する */
async function run(row, payload, onOk, opts) {
  const el = cardEl(row);
  setBusy(el, true);
  try {
    const data = await api(payload);
    applyData(data);
    setBusy(cardEl(row), false);
    flash(cardEl(row));
    if (onOk) onOk();
    return true;
  } catch (err) {
    setBusy(cardEl(row), false);
    redrawCard(row); // 入力欄をサーバー側の値に戻す
    // 続けてもう 1 通送る操作では、呼んだ側でまとめて知らせるので黙っておく
    if (!(opts && opts.quiet)) {
      toast(err.message || '保存できませんでした', { type: 'error', timeout: 7000 });
    }
    return false;
  }
}

/**
 * グループの品目（しょうゆ3サイズなど）の数を変えると、
 * 同じグループの他のサイズに出ている「計」も変わる。
 * 返ってくるのは変えた 1 件だけなので、裏でそっと全件を読み直して揃える。
 */
async function refreshGroup(item) {
  if (!item || !item.group) return;
  try {
    const data = await apiLoad();
    lastLoadedAt = Date.now();
    applyData(data, true);
  } catch (err) {
    /* 失敗しても次の読み込みで揃うので、画面には何も出さない */
  }
}

async function doStatus(it) {
  const st = STATUS[it.status];
  if (!st) return;

  // 「届いた」だけは、届いた数量を先に入れてもらう。
  // 数を入れずに「在庫あり」に戻すと残数が発注点以下のままなので、
  // すぐにまた「要発注」に戻ってしまう。
  // 入荷数だけ先に保存できている品目（receivedSaved）は、
  // もう一度数を足さないよう、そのまま状態だけ変える
  if (it.status === '発注済み' && it.managed && !receivedSaved.has(it.row)) {
    openReceive(it);
    return;
  }

  await changeStatus(it);
}

/** 状態を次に進めるだけ（入荷数の入力をはさまない従来どおりの動き） */
async function changeStatus(it) {
  const st = STATUS[it.status];
  if (!st) return;
  const from = it.status;
  const to = st.next;
  const row = it.row;
  const name = it.name;

  await run(row, { action: 'setStatus', row, status: to, isUndo: false }, () => {
    receivedSaved.delete(row);
    toast('「' + name + '」を「' + to + '」にしました', {
      timeout: 15000,
      action: {
        label: '元に戻す',
        onClick: () => undoStatus(row, from, name),
      },
    });
  });
}

/** 「要発注」を、発注を記録せずに「在庫あり」へ戻す */
async function doReset(it) {
  const from = it.status;
  const row = it.row;
  const name = it.name;

  // 残数が発注点以下のままだと、次に数を動かしたときにまた要発注に戻る。
  // 戻ってきてから悩まないよう、押した時点で断っておく
  const rp = num(it.rp);
  const total = num(it.total);
  const 戻る = it.managed && !it.group && rp != null && total != null && total <= rp;

  await run(row, { action: 'setStatus', row, status: '在庫あり', isUndo: false }, () => {
    receivedSaved.delete(row);
    toast(
      '「' + name + '」を「在庫あり」に戻しました' +
        (戻る ? '（残数が発注点以下なので、数を入れ直すとまた要発注になります）' : ''),
      {
        timeout: 15000,
        action: {
          label: '元に戻す',
          onClick: () => undoStatus(row, from, name),
        },
      }
    );
  });
}

async function undoStatus(row, to, name) {
  await run(row, { action: 'setStatus', row, status: to, isUndo: true }, () => {
    toast('「' + name + '」を「' + to + '」に戻しました');
  });
}

/* ---------- 入荷（「届いた」） ---------- */

function openReceive(it) {
  receiving.set(it.row, { loc: state.loc, qty: '' });
  redrawCard(it.row);
  const el = cardEl(it.row);
  const input = el && el.querySelector('.recv-input');
  if (input) input.focus();
}

function closeReceive(row) {
  receiving.delete(row);
  redrawCard(row);
}

/** 入荷を入れる場所（倉庫 / 牽引 / 自走）を選び直す */
function setRecvLoc(it, loc) {
  const r = receiving.get(it.row);
  if (!r || r.loc === loc) return;
  r.loc = loc;
  redrawCard(it.row);
}

/** 入荷欄の −◯◯ / +◯◯ */
function bumpRecv(it, delta) {
  const r = receiving.get(it.row);
  if (!r) return;
  const cur = num(r.qty) || 0;
  const next = Math.round((cur + delta) * 100) / 100;
  r.qty = next <= 0 ? '' : String(next);
  redrawCard(it.row);
}

/**
 * 入荷の登録。数量を足してから状態を「在庫あり」にする（2 通に分けて送る）。
 * 1 通目が失敗したときは何も変わっていないので、入力欄はそのまま残す
 */
async function doReceive(it) {
  const r = receiving.get(it.row);
  if (!r) return;
  const row = it.row;
  const name = it.name;
  const loc = r.loc;
  const qty = num(r.qty);

  if (qty == null || qty <= 0) {
    toast('届いた数量を入れてください', { type: 'error' });
    return;
  }

  if (!(await run(row, { action: 'adjustQty', row, loc, delta: qty }))) return;

  // ここから先で失敗しても数量はもう入っている。二重に足さないよう目印を残す
  receivedSaved.set(row, true);
  // 入荷欄はここで閉じる。状態の変更で失敗しても「届いた」ボタンに戻るだけで、
  // 目印が残っているので数量をもう一度足してしまうことはない
  receiving.delete(row);
  redrawCard(row);

  const ok = await run(row, { action: 'setStatus', row, status: '在庫あり', isUndo: false }, null, {
    quiet: true,
  });
  if (!ok) {
    toast(
      '数量は入りましたが、状態を「在庫あり」にできませんでした。' +
        'もう一度「届いた」を押してください（数量はもう入れなくて大丈夫です）',
      { type: 'error', timeout: 9000 }
    );
    return;
  }

  receivedSaved.delete(row);
  const after = getItem(row);
  const unit = it.qtyUnit || '';
  toast(
    '「' + name + '」に ' + fmt(qty) + unit + ' 入荷しました（' + LOC_NAME[loc] + '）。計' +
      fmt(after ? num(after.total) : null) + unit,
    {
      timeout: 15000,
      action: { label: '元に戻す', onClick: () => undoReceive(row, loc, qty, name) },
    }
  );
  refreshGroup(it);
}

/** 入荷の取り消し。足した数を引いてから「発注済み」に戻す */
async function undoReceive(row, loc, qty, name) {
  if (!(await run(row, { action: 'adjustQty', row, loc, delta: -qty }))) return;
  await run(row, { action: 'setStatus', row, status: '発注済み', isUndo: true }, () => {
    toast('「' + name + '」の入荷を取り消しました');
  });
}

async function doAdjust(it, delta) {
  const cur = num(it[state.loc]);
  if (cur == null && delta < 0) {
    // 「—」は倉庫にしか置いていない品目でも普通に出る。
    // 入れ忘れではなく「場所を間違えている」ほうが多いので、そちらを先に伝える
    const loc = LOC_NAME[state.loc];
    toast('「' + it.name + '」は' + loc + 'に置いていないようです。場所を確かめて、' + loc + 'にもあるなら数字を直接入れてください', {
      type: 'error',
      timeout: 7000,
    });
    redrawCard(it.row);
    return;
  }
  if (cur != null && cur + delta < 0) {
    toast('残数を 0 より少なくはできません', { type: 'error' });
    redrawCard(it.row);
    return;
  }
  if (await run(it.row, { action: 'adjustQty', row: it.row, loc: state.loc, delta })) refreshGroup(it);
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
  if (await run(it.row, { action: 'setQty', row: it.row, loc: state.loc, qty: v })) refreshGroup(it);
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
  if (state.stale) return; // 前回の数字が出ているあいだは触らせない
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const card = b.closest('.card');
  if (!card) return;
  const it = getItem(Number(card.dataset.row));
  if (!it) return;

  if (b.dataset.act === 'status') doStatus(it);
  else if (b.dataset.act === 'reset') doReset(it);
  else if (b.dataset.act === 'inc') doAdjust(it, stepFor(it));
  else if (b.dataset.act === 'dec') doAdjust(it, -stepFor(it));
  else if (b.dataset.act === 'rloc') setRecvLoc(it, b.dataset.loc);
  else if (b.dataset.act === 'rinc') bumpRecv(it, stepFor(it));
  else if (b.dataset.act === 'rdec') bumpRecv(it, -stepFor(it));
  else if (b.dataset.act === 'rsave') doReceive(it);
  else if (b.dataset.act === 'rcancel') closeReceive(it.row);
  else if (b.dataset.act === 'rskip') {
    closeReceive(it.row);
    changeStatus(it);
  }
});

elList.addEventListener('change', (e) => {
  if (state.stale) return; // 前回の数字が出ているあいだは触らせない
  const input = e.target.closest('input.qty-input');
  if (!input || input.classList.contains('recv-input')) return; // 入荷欄はここでは保存しない
  const card = input.closest('.card');
  if (!card) return;
  const it = getItem(Number(card.dataset.row));
  if (it) doSetQty(it, input);
});

// 入荷数は打つたびに覚えておく（読み込みが走ってカードが描き直されても消えないように）。
// 画面はプレビューの一行だけ書き換える（丸ごと描き直すと入力中の欄から指が外れてしまう）
elList.addEventListener('input', (e) => {
  const input = e.target.closest('input.recv-input');
  if (!input) return;
  const card = input.closest('.card');
  if (!card) return;
  const it = getItem(Number(card.dataset.row));
  const r = it && receiving.get(it.row);
  if (!r) return;
  r.qty = input.value;
  const prev = card.querySelector('.recv-preview');
  if (prev) prev.textContent = recvPreview(it, r);
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

/* ---- 「前回の数字です」の帯 ---- */

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
    lastLoadedAt = Date.now();
    applyData(data, true); // 全件読み込みなので丸ごと入れ替える
    clearStale();
  } catch (err) {
    if (state.stale) {
      // 前回の数字を出したまま。触らせない状態は続ける
      showStaleBar(
        '最新の数字を取れませんでした。いま出ているのは ' +
          whenText(bootCache.savedAt) + ' 時点の数字です',
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
renderLocBar();
renderTabs();
syncLocBar();

if (bootCache) {
  // 前回の数字をすぐ出す。最新に入れ替わるまでは断りを出し、数は触らせない
  state.items = bootCache.items;
  state.lines = bootCache.lines || [];
  state.stale = true;
  document.body.classList.add('stale');
  renderTabs();
  renderList(true);
  showStaleBar(
    '最新の数字を取っています… いま出ているのは ' + whenText(bootCache.savedAt) + ' 時点の数字です'
  );
}

load(!bootCache); // 前回の数字が出ているなら「読み込み中…」は出さない
