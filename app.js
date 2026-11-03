'use strict';

/* =====================================================================
 * 作業記録ツール
 *  - 外部ライブラリなし / localStorage 保存
 *  - 日報の書式は formatDailyReport() だけを差し替えれば変更できる
 * ===================================================================== */

const STORAGE_KEY = 'sagyokanri:data';
const DATA_VERSION = 1;
const DEFAULT_CATEGORY_NAMES = ['電話対応', '資料作成', 'プログラム修正', '会議', '顧客訪問', 'その他'];
const MAX_VISIBLE_BUTTONS = 8;   // これ以下ならすべてボタン表示
const BUTTONS_WITH_OTHERS = 7;   // 9個以上のときにボタン表示する数
const BREAK_VALUE = '__break__';
const USAGE_DAYS = 30;

/* =====================================================================
 * 日報の書式（★書式を変更するときはこの関数だけを書き換える）
 *
 * report = {
 *   date: 'YYYY-MM-DD',
 *   lines: [{ start: 'HH:MM', end: 'HH:MM', running: boolean,
 *             category, customer, project, memo, minutes }],   // 開始時刻順。休憩は含まない
 *   totalMinutes: number,                                      // 丸める前の合計分
 *   categories: [{ name, minutes }],                           // 分の多い順
 * }
 * ===================================================================== */
function formatDailyReport(report) {
  const [, m, d] = report.date.split('-').map(Number);
  const out = [`【${m}/${d} 業務内容】`];
  if (report.lines.length === 0) {
    out.push('（記録なし）');
    return out.join('\n');
  }
  for (const l of report.lines) {
    const who = [l.customer, l.project].filter(Boolean).join('／');
    const detail = [who, l.memo].filter(Boolean).join(' ');
    const end = l.running ? '計測中' : l.end;
    out.push(`${l.start}-${end} ${l.category}${detail ? `（${detail}）` : ''}`);
  }
  out.push('');
  const cats = report.categories.map((c) => `${c.name} ${toHours(c.minutes)}h`).join('／');
  out.push(`合計 ${toHours(report.totalMinutes)}h：${cats}`);
  return out.join('\n');
}

/** 分 → 0.1h 単位に四捨五入した文字列 */
function toHours(minutes) {
  return (Math.round(minutes / 6) / 10).toFixed(1);
}

/* =====================================================================
 * ユーティリティ
 * ===================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const pad2 = (n) => String(n).padStart(2, '0');
const norm = (s) => String(s || '').trim().toLowerCase();
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function dateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function todayKey() { return dateKey(Date.now()); }
function keyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function shiftKey(key, days) {
  const d = keyToDate(key);
  d.setDate(d.getDate() + days);
  return dateKey(d.getTime());
}
function combine(key, hm) {
  const [h, mi] = hm.split(':').map(Number);
  const d = keyToDate(key);
  d.setHours(h, mi, 0, 0);
  return d.getTime();
}
function fmtHM(ts) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fmtHMS(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
}
function fmtDuration(min) {
  const h = Math.floor(min / 60);
  return h > 0 ? `${h}時間${min % 60}分` : `${min}分`;
}
function fmtDateJa(key) {
  const d = keyToDate(key);
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEK[d.getDay()]}）`;
}
function fmtDatetimeLocal(ts) {
  return `${dateKey(ts)}T${fmtHM(ts)}`;
}
function parseDatetimeLocal(v) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(v || '');
  return m ? combine(m[1], m[2]) : null;
}
/** 記録の分数（表示する HH:MM どうしの差。明細と合計が一致するよう分単位で切る） */
function recordMinutes(r, now = Date.now()) {
  const end = r.end == null ? now : r.end;
  return Math.max(0, Math.floor(end / 60000) - Math.floor(r.start / 60000));
}
function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}
function button(label, onClick, className = 'btn') {
  const b = el('button', className, label);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

/* =====================================================================
 * データ（保存・読み込み・検証・移行）
 * ===================================================================== */
function defaultState() {
  return {
    version: DATA_VERSION,
    categories: DEFAULT_CATEGORY_NAMES.map((name, i) => ({ id: `cat${i + 1}`, name, deleted: false })),
    customers: [],
    projects: [],
    records: [],
    draft: { customer: '', project: '', memo: '' },
  };
}

/**
 * 古い版のデータを最新の形に変換する。
 * 項目を追加したときは DATA_VERSION を上げ、ここに変換処理を追加する。
 *   例) if (d.version === 1) { d.records.forEach(r => r.tags = []); d.version = 2; }
 */
function migrate(raw) {
  const d = JSON.parse(JSON.stringify(raw));
  // （現在は version 1 のみ）
  // 省略された項目を補う
  const str = (v) => (typeof v === 'string' ? v : '');
  d.categories = (d.categories || []).map((c) => ({ id: c.id, name: str(c.name), deleted: !!c.deleted }));
  d.customers = (d.customers || []).map((c) => ({ id: c.id, name: str(c.name), hidden: !!c.hidden }));
  d.projects = (d.projects || []).map((p) => ({ id: p.id, customerId: p.customerId, name: str(p.name), hidden: !!p.hidden }));
  d.records = (d.records || []).map((r) => ({
    id: r.id,
    start: r.start,
    end: r.end == null ? null : r.end,
    type: r.type === 'break' ? 'break' : 'work',
    categoryId: r.type === 'break' ? null : r.categoryId,
    customer: str(r.customer),
    project: str(r.project),
    memo: str(r.memo),
  }));
  d.draft = { customer: str(d.draft && d.draft.customer), project: str(d.draft && d.draft.project), memo: str(d.draft && d.draft.memo) };
  return d;
}

/** 検証。問題があればエラーメッセージ、なければ null */
function validateData(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return 'データの形式が正しくありません。';
  if (typeof d.version !== 'number') return 'バージョン番号がありません。';
  if (d.version > DATA_VERSION) return `新しい版（version ${d.version}）のデータのため読み込めません。`;
  for (const k of ['categories', 'customers', 'projects', 'records']) {
    if (!Array.isArray(d[k])) return `「${k}」がありません。`;
  }
  const isStr = (v) => typeof v === 'string' && v !== '';
  const catIds = new Set();
  for (const c of d.categories) {
    if (!c || !isStr(c.id) || typeof c.name !== 'string') return '作業（カテゴリ）のデータが正しくありません。';
    catIds.add(c.id);
  }
  const custIds = new Set();
  for (const c of d.customers) {
    if (!c || !isStr(c.id) || typeof c.name !== 'string') return '顧客のデータが正しくありません。';
    custIds.add(c.id);
  }
  for (const p of d.projects) {
    if (!p || !isStr(p.id) || typeof p.name !== 'string' || !custIds.has(p.customerId)) return '案件のデータが正しくありません。';
  }
  let running = 0;
  for (const r of d.records) {
    if (!r || !isStr(r.id) || !Number.isFinite(r.start)) return '記録のデータが正しくありません。';
    if (r.end != null && !Number.isFinite(r.end)) return '記録の終了時刻が正しくありません。';
    if (r.end == null) running++;
    if (r.type !== 'break' && !catIds.has(r.categoryId)) return '記録の作業（カテゴリ）が見つかりません。';
  }
  if (running > 1) return '計測中の記録が複数あります。';
  if (!d.categories.some((c) => !c.deleted)) return '作業（カテゴリ）が1つもありません。';
  return null;
}

function parseStored(text) {
  const raw = JSON.parse(text);
  if (!raw || typeof raw.version !== 'number') throw new Error('バージョン番号がありません。');
  if (raw.version > DATA_VERSION) throw new Error(`新しい版（version ${raw.version}）のデータのため読み込めません。`);
  for (const k of ['categories', 'customers', 'projects', 'records']) {
    if (!Array.isArray(raw[k])) throw new Error(`「${k}」の形式が正しくありません。`);
  }
  if (raw.records.some((r) => !r || typeof r !== 'object')) throw new Error('記録のデータが正しくありません。');
  const d = migrate(raw);
  delete d.exportedAt;
  d.version = DATA_VERSION;
  const err = validateData(d);
  if (err) throw new Error(err);
  return d;
}

let storageOk = true;
function loadState() {
  let text = null;
  try {
    text = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    storageOk = false;
    showStorageError('ブラウザの保存領域（localStorage）を利用できません。このままでは記録が保存されません。ブラウザの設定を確認してください。');
    return defaultState();
  }
  if (!text) return defaultState();
  try {
    return parseStored(text);
  } catch (e) {
    try { localStorage.setItem(`${STORAGE_KEY}:broken:${Date.now()}`, text); } catch (_) { /* 退避できなくても続行 */ }
    showStorageError(`保存データを読み込めなかったため初期状態で開きました（元のデータは別名で退避しました）。理由：${e.message}`);
    return defaultState();
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (!storageOk) { storageOk = true; hideStorageError(); }
    return true;
  } catch (e) {
    storageOk = false;
    showStorageError('データを保存できませんでした。ブラウザの保存領域の設定や空き容量を確認してください。必要なら「全データをJSONでバックアップ」で書き出してください。');
    return false;
  }
}
function showStorageError(msg) {
  const box = $('#storageError');
  box.textContent = `⚠ ${msg}`;
  box.hidden = false;
}
function hideStorageError() { $('#storageError').hidden = true; }

let state = loadState();

/* =====================================================================
 * データ操作
 * ===================================================================== */
const activeCategories = () => state.categories.filter((c) => !c.deleted);
const categoryById = (id) => state.categories.find((c) => c.id === id) || null;
function categoryLabel(r) {
  if (r.type === 'break') return '休憩';
  const c = categoryById(r.categoryId);
  return c ? c.name : '（不明な作業）';
}
const getRunning = () => state.records.find((r) => r.end == null) || null;
function recordsOfDate(key) {
  return state.records.filter((r) => dateKey(r.start) === key).sort((a, b) => a.start - b.start || (a.end ?? Infinity) - (b.end ?? Infinity));
}
function buttonLayout() {
  const cats = activeCategories();
  if (cats.length <= MAX_VISIBLE_BUTTONS) return { buttons: cats, others: [] };
  return { buttons: cats.slice(0, BUTTONS_WITH_OTHERS), others: cats.slice(BUTTONS_WITH_OTHERS) };
}

const findCustomer = (name) => (norm(name) ? state.customers.find((c) => norm(c.name) === norm(name)) || null : null);
const projectsOf = (customerId) => state.projects.filter((p) => p.customerId === customerId);
const customerById = (id) => state.customers.find((c) => c.id === id) || null;

/** マスタの案件か（顧客が空なら、どこかの顧客の案件名と一致すればマスタ扱い） */
function isMasterProject(cust, proj) {
  if (!norm(proj)) return true;
  if (!norm(cust)) return state.projects.some((p) => norm(p.name) === norm(proj));
  const c = findCustomer(cust);
  return !!c && projectsOf(c.id).some((p) => norm(p.name) === norm(proj));
}
/** 顧客を選び直したとき案件を残すか（マスタ顧客の場合のみ判定） */
function shouldClearProject(cust, proj) {
  const c = findCustomer(cust);
  if (!c || !norm(proj)) return false;
  return !projectsOf(c.id).some((p) => norm(p.name) === norm(proj));
}

function addCustomer(name) {
  const n = name.trim();
  if (!n) return null;
  const exist = findCustomer(n);
  if (exist) return exist;
  const c = { id: uid(), name: n, hidden: false };
  state.customers.push(c);
  return c;
}
function addProject(customerName, name) {
  const n = name.trim();
  if (!n || !customerName.trim()) return null;
  const c = addCustomer(customerName);
  const exist = projectsOf(c.id).find((p) => norm(p.name) === norm(n));
  if (exist) return exist;
  const p = { id: uid(), customerId: c.id, name: n, hidden: false };
  state.projects.push(p);
  return p;
}

function customerUsage() {
  const m = new Map();
  for (const r of state.records) if (norm(r.customer)) m.set(norm(r.customer), (m.get(norm(r.customer)) || 0) + 1);
  return m;
}
function projectUsage() {
  const m = new Map();
  for (const r of state.records) {
    if (!norm(r.project)) continue;
    const k = `${norm(r.customer)}\u0000${norm(r.project)}`;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}
function categoryUsage30() {
  const from = keyToDate(shiftKey(todayKey(), -(USAGE_DAYS - 1))).getTime();
  const m = new Map();
  for (const r of state.records) {
    if (r.type === 'work' && r.start >= from) m.set(r.categoryId, (m.get(r.categoryId) || 0) + 1);
  }
  return m;
}

/* ----- 計測 ----- */
function startWork(categoryId, fields) {
  const run = getRunning();
  if (!fields && run && run.type === 'work' && run.categoryId === categoryId) return; // 同じボタンは何もしない
  const now = Date.now();
  let f = fields;
  if (!f) f = run ? { customer: '', project: '', memo: '' } : { ...state.draft };
  if (run) run.end = now;
  state.records.push({
    id: uid(), start: now, end: null, type: 'work', categoryId,
    customer: f.customer || '', project: f.project || '', memo: f.memo || '',
  });
  state.draft = { customer: '', project: '', memo: '' };
  save();
  closeOtherList();
  renderAll();
}
function startBreak() {
  const run = getRunning();
  if (run && run.type === 'break') return;
  const now = Date.now();
  if (run) run.end = now;
  state.records.push({ id: uid(), start: now, end: null, type: 'break', categoryId: null, customer: '', project: '', memo: '' });
  save();
  renderAll();
}
function endWork() {
  const run = getRunning();
  if (run) { run.end = Date.now(); save(); }
  reportDate = todayKey();
  showScreen('report');
}
/** 直前の作業（実行中を除く最新の作業記録。休憩は除く） */
function previousWork() {
  const run = getRunning();
  const list = state.records.filter((r) => r.type === 'work' && r !== run && r.end != null);
  list.sort((a, b) => b.end - a.end || b.start - a.start);
  return list[0] || null;
}
function resumePrevious() {
  const p = previousWork();
  if (!p) return;
  const c = categoryById(p.categoryId);
  if (!c || c.deleted) return;
  startWork(p.categoryId, { customer: p.customer, project: p.project, memo: p.memo });
}

/* =====================================================================
 * ダイアログ
 * ===================================================================== */
let dialogBusy = Promise.resolve();
function openDialog({ title, message = '', content = null, buttons, cancelValue = null, dismissable = true, initialFocus = null }) {
  const run = () => new Promise((resolve) => {
    const dlg = $('#dialog');
    $('#dialogTitle').textContent = title;
    $('#dialogMessage').textContent = message;
    $('#dialogMessage').hidden = !message;
    const box = $('#dialogContent');
    box.innerHTML = '';
    if (content) box.append(content);
    const err = $('#dialogError');
    err.hidden = true;
    const btns = $('#dialogButtons');
    btns.innerHTML = '';
    let primaryBtn = null;
    let finished = false;
    const done = (v) => {
      finished = true;
      dlg.oncancel = null;
      dlg.onclose = null;
      dlg.onkeydown = null;
      dlg.close();
      resolve(v);
    };
    for (const b of buttons) {
      const n = button(b.label, () => {
        if (b.validate) {
          const msg = b.validate();
          if (msg) { err.textContent = `⚠ ${msg}`; err.hidden = false; return; }
        }
        done(b.value);
      }, `btn${b.primary ? ' btn-primary' : ''}${b.danger ? ' btn-danger' : ''}`);
      btns.append(n);
      if (b.primary) primaryBtn = n;
    }
    dlg.oncancel = (e) => {
      e.preventDefault();
      if (dismissable) done(cancelValue);
    };
    dlg.onkeydown = (e) => { if (e.key === 'Escape' && !dismissable) e.preventDefault(); };
    // ブラウザによっては Esc の cancel を止められないため、閉じられたら開き直す
    dlg.onclose = () => {
      if (finished || dlg.open) return; // 前のダイアログの close イベントは無視
      if (dismissable) { finished = true; resolve(cancelValue); return; }
      dlg.showModal();
    };
    $('#dialogForm').onsubmit = (e) => {
      e.preventDefault();
      if (primaryBtn) primaryBtn.click();
    };
    dlg.showModal();
    const f = initialFocus || box.querySelector('input,select') || primaryBtn || btns.querySelector('button');
    if (f) f.focus();
  });
  dialogBusy = dialogBusy.then(run, run);
  return dialogBusy;
}
function confirmDialog(title, message, okLabel = 'OK', danger = false) {
  return openDialog({
    title, message, cancelValue: false,
    buttons: [{ label: 'キャンセル', value: false }, { label: okLabel, value: true, primary: !danger, danger }],
  });
}
function alertDialog(title, message) {
  return openDialog({ title, message, buttons: [{ label: 'OK', value: true, primary: true }], cancelValue: true });
}
async function promptDialog(title, label, initial = '') {
  const wrap = el('div');
  const id = `prompt${uid()}`;
  const lab = el('label', null, label);
  lab.htmlFor = id;
  const input = el('input');
  input.type = 'text';
  input.id = id;
  input.value = initial;
  input.autocomplete = 'off';
  wrap.append(lab, input);
  const ok = await openDialog({
    title, content: wrap, cancelValue: false,
    buttons: [
      { label: 'キャンセル', value: false },
      { label: '保存', value: true, primary: true, validate: () => (input.value.trim() ? null : '名前を入力してください。') },
    ],
  });
  return ok ? input.value.trim() : null;
}
const isDialogOpen = () => $('#dialog').open;

/* =====================================================================
 * コンボボックス（顧客・案件）
 * ===================================================================== */
let comboSeq = 0;
let suppressComboOpen = false;

/**
 * kind: 'customer' | 'project'
 * 候補 { type: 'master'|'manual'|'register', value, label, sub, customer? }
 */
function getCandidates(kind, raw, custRaw) {
  const q = raw.trim();
  const ql = q.toLowerCase();
  let masters = [];
  let exact = false;
  let allowRegister = true;
  if (kind === 'customer') {
    const use = customerUsage();
    exact = !!q && state.customers.some((c) => norm(c.name) === ql);
    masters = state.customers
      .map((c, i) => ({ c, i, n: use.get(norm(c.name)) || 0 }))
      .filter(({ c }) => !c.hidden && (!ql || c.name.toLowerCase().includes(ql)))
      .sort((a, b) => b.n - a.n || a.i - b.i)
      .map(({ c, n }) => ({ type: 'master', value: c.name, label: c.name, sub: n ? `${n}回` : '' }));
  } else {
    const use = projectUsage();
    const cust = (custRaw || '').trim();
    if (!cust) {
      allowRegister = false;
      exact = !!q && state.projects.some((p) => norm(p.name) === ql);
      masters = state.projects
        .map((p, i) => ({ p, i, c: customerById(p.customerId) }))
        .filter(({ p, c }) => c && !p.hidden && !c.hidden &&
          (!ql || p.name.toLowerCase().includes(ql) || c.name.toLowerCase().includes(ql)))
        .map((o) => ({ ...o, n: use.get(`${norm(o.c.name)}\u0000${norm(o.p.name)}`) || 0 }))
        .sort((a, b) => b.n - a.n || a.i - b.i)
        .map(({ p, c, n }) => ({ type: 'master', value: p.name, label: `${p.name}（${c.name}）`, customer: c.name, sub: n ? `${n}回` : '' }));
    } else {
      const c = findCustomer(cust);
      if (c) {
        const list = projectsOf(c.id);
        exact = !!q && list.some((p) => norm(p.name) === ql);
        masters = list
          .map((p, i) => ({ p, i, n: use.get(`${norm(c.name)}\u0000${norm(p.name)}`) || 0 }))
          .filter(({ p }) => !p.hidden && (!ql || p.name.toLowerCase().includes(ql)))
          .sort((a, b) => b.n - a.n || a.i - b.i)
          .map(({ p, n }) => ({ type: 'master', value: p.name, label: p.name, sub: n ? `${n}回` : '' }));
      }
      // 未登録の顧客のときは候補を出さない（手入力・登録のみ）
    }
  }
  const extras = [];
  if (q && !exact) {
    extras.push({ type: 'manual', value: q, label: `『${q}』を手入力のまま使う` });
    if (allowRegister) extras.push({ type: 'register', value: q, label: `『${q}』をマスタに登録して使う` });
  }
  return masters.concat(extras);
}

function createCombo({ kind, id, value = '', fk, label, getCustomer, onInput, onCommit, onSetCustomer }) {
  const wrap = el('div', 'combo');
  const cid = id || `combo${++comboSeq}`;
  const input = el('input');
  input.type = 'text';
  input.id = cid;
  input.value = value;
  input.autocomplete = 'off';
  input.placeholder = '任意（選択または入力）';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', `${cid}-list`);
  if (label) input.setAttribute('aria-label', label);
  if (fk) input.dataset.fk = fk;
  const list = el('ul', 'combo-list');
  list.id = `${cid}-list`;
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  wrap.append(input, list);

  let items = [];
  let active = -1;
  let committed = value;

  function draw() {
    list.innerHTML = '';
    items.forEach((it, i) => {
      const li = el('li', `combo-opt${it.type !== 'master' ? ' is-extra' : ''}${i === active ? ' is-active' : ''}`);
      li.id = `${cid}-o${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === active));
      li.append(el('span', null, it.label));
      if (it.sub) li.append(el('span', 'opt-sub', it.sub));
      li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(i); });
      list.append(li);
    });
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', `${cid}-o${active}`);
      const n = list.children[active];
      if (n && n.scrollIntoView) n.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }
  function open() {
    items = getCandidates(kind, input.value, getCustomer ? getCustomer() : '');
    active = -1;
    draw();
    list.hidden = items.length === 0;
    input.setAttribute('aria-expanded', String(!list.hidden));
  }
  function close() {
    list.hidden = true;
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }
  function commit(v, force) {
    input.value = v;
    const changed = v !== committed;
    committed = v;
    close();
    if ((changed || force) && onCommit) onCommit(v, changed);
  }
  function choose(i) {
    const it = items[i];
    if (!it) return;
    if (it.type === 'register') {
      if (kind === 'customer') addCustomer(it.value);
      else addProject(getCustomer ? getCustomer() : '', it.value);
      save();
      commit(it.value, true);
      return;
    }
    if (it.type === 'master' && it.customer != null && onSetCustomer) onSetCustomer(it.customer);
    commit(it.value, it.type === 'master' && it.customer != null);
  }

  input.addEventListener('focus', () => { if (!suppressComboOpen) open(); });
  input.addEventListener('input', () => {
    if (onInput) onInput(input.value);
    open();
  });
  input.addEventListener('blur', () => {
    const v = input.value.trim();
    if (v !== committed || !list.hidden) commit(v, false);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (list.hidden) { open(); if (items.length) { active = 0; draw(); } return; }
      active = Math.min(active + 1, items.length - 1);
      draw();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) return;
      active = Math.max(active - 1, 0);
      draw();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!list.hidden && active >= 0) choose(active);
      else commit(input.value.trim(), false);
    } else if (e.key === 'Escape') {
      if (!list.hidden) { e.preventDefault(); e.stopPropagation(); close(); }
    }
  });

  wrap.input = input;
  wrap.setValue = (v) => { input.value = v; committed = v; close(); };
  return wrap;
}

/* =====================================================================
 * 画面切り替え・再描画
 * ===================================================================== */
const SCREENS = ['record', 'report', 'master', 'settings'];
let currentScreen = 'record';
let reportDate = todayKey();

function showScreen(name) {
  if (!SCREENS.includes(name)) name = 'record';
  currentScreen = name;
  for (const s of SCREENS) $(`#screen-${s}`).hidden = s !== name;
  document.querySelectorAll('.tab').forEach((t) => {
    if (t.dataset.screen === name) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  renderAll();
  window.scrollTo(0, 0);
}

/** 再描画しても、フォーカスしていた操作対象（data-fk）にフォーカスを戻す */
function withFocusRestore(fn) {
  const a = document.activeElement;
  const key = a && a.dataset ? a.dataset.fk : null;
  let sel = null;
  try { if (a && typeof a.selectionStart === 'number') sel = [a.selectionStart, a.selectionEnd]; } catch (_) { /* 未対応 */ }
  fn();
  if (!key) return;
  const n = document.querySelector(`[data-fk="${CSS.escape(key)}"]`);
  if (n && n !== a && !n.disabled) {
    suppressComboOpen = true;
    n.focus();
    suppressComboOpen = false;
    if (sel && n.setSelectionRange) { try { n.setSelectionRange(sel[0], sel[1]); } catch (_) { /* 未対応 */ } }
  }
}

function renderAll() {
  withFocusRestore(() => {
    renderRecord();
    if (currentScreen === 'report') renderReport();
    if (currentScreen === 'master') renderMaster();
    if (currentScreen === 'settings') renderSettings();
  });
}
let renderTimer = null;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderAll, 0);
}

/* =====================================================================
 * 記録画面
 * ===================================================================== */
let recCustomerCombo;
let recProjectCombo;
let shownFieldsKey = null;
let otherListOpen = false;

/** 入力欄の保存先（計測中の作業 / 未計測なら下書き / 休憩中は null） */
function currentFieldTarget() {
  const r = getRunning();
  if (!r) return state.draft;
  return r.type === 'work' ? r : null;
}
function setRecordField(k, v) {
  const t = currentFieldTarget();
  if (!t) return;
  t[k] = v;
  save();
}

function initRecordScreen() {
  recCustomerCombo = createCombo({
    kind: 'customer', id: 'recCustomer',
    onInput: (v) => setRecordField('customer', v),
    onCommit: (v, changed) => {
      setRecordField('customer', v);
      const t = currentFieldTarget();
      if (changed && t && shouldClearProject(v, t.project)) {
        setRecordField('project', '');
        recProjectCombo.setValue('');
      }
    },
  });
  recProjectCombo = createCombo({
    kind: 'project', id: 'recProject',
    getCustomer: () => recCustomerCombo.input.value,
    onInput: (v) => setRecordField('project', v),
    onCommit: (v) => setRecordField('project', v),
    onSetCustomer: (name) => {
      setRecordField('customer', name);
      recCustomerCombo.setValue(name);
    },
  });
  $('#recCustomerSlot').append(recCustomerCombo);
  $('#recProjectSlot').append(recProjectCombo);
  $('#recMemo').addEventListener('input', (e) => setRecordField('memo', e.target.value));

  $('#recToReport').addEventListener('click', () => { reportDate = todayKey(); showScreen('report'); });
  $('#recResume').addEventListener('click', resumePrevious);
  $('#recBreak').addEventListener('click', startBreak);
  $('#recEnd').addEventListener('click', endWork);
}

function buildWorkGrid(container, preview) {
  container.innerHTML = '';
  const run = getRunning();
  const runCat = run && run.type === 'work' ? run.categoryId : null;
  const { buttons, others } = buttonLayout();
  buttons.forEach((c, i) => {
    const running = c.id === runCat;
    const b = el(preview ? 'div' : 'button', `work-btn${running ? ' is-running' : ''}`);
    const key = el('span', 'work-key', String(i + 1));
    key.setAttribute('aria-hidden', 'true');
    b.append(key, el('span', 'work-name', c.name));
    if (running) b.append(el('span', 'work-state', '● 実行中'));
    if (!preview) {
      b.type = 'button';
      b.dataset.fk = `work-${c.id}`;
      b.setAttribute('aria-pressed', String(running));
      b.setAttribute('aria-keyshortcuts', String(i + 1));
      b.addEventListener('click', () => startWork(c.id));
    }
    container.append(b);
  });
  if (others.length) {
    const runOther = others.find((c) => c.id === runCat);
    const b = el(preview ? 'div' : 'button', `work-btn${runOther ? ' is-running' : ''}`);
    const key = el('span', 'work-key', '…');
    key.setAttribute('aria-hidden', 'true');
    b.append(key, el('span', 'work-name', '他の作業 ▾'));
    if (runOther) b.append(el('span', 'work-state', `● 実行中：${runOther.name}`));
    if (!preview) {
      b.type = 'button';
      b.id = 'otherBtn';
      b.dataset.fk = 'work-other';
      b.setAttribute('aria-expanded', String(otherListOpen));
      b.setAttribute('aria-controls', 'otherList');
      b.addEventListener('click', () => { otherListOpen = !otherListOpen; renderRecord(); if (otherListOpen) { const f = $('#otherList button'); if (f) f.focus(); } });
    }
    container.append(b);
  }
  return { others, runCat };
}

function closeOtherList() { otherListOpen = false; }

function renderRecord() {
  const now = Date.now();
  const run = getRunning();
  const { others, runCat } = buildWorkGrid($('#workGrid'), false);

  // 他の作業リスト
  const ol = $('#otherList');
  ol.innerHTML = '';
  if (!others.length) otherListOpen = false;
  ol.hidden = !otherListOpen;
  if (otherListOpen) {
    others.forEach((c) => {
      const b = button(c.id === runCat ? `${c.name}（実行中）` : c.name, () => startWork(c.id));
      b.setAttribute('aria-pressed', String(c.id === runCat));
      b.dataset.fk = `other-${c.id}`;
      ol.append(b);
    });
  }

  // 入力欄（記録が切り替わったときだけ値を入れ直す）
  const target = currentFieldTarget();
  const key = run ? run.id : 'draft';
  if (key !== shownFieldsKey) {
    shownFieldsKey = key;
    recCustomerCombo.setValue(target ? target.customer : '');
    recProjectCombo.setValue(target ? target.project : '');
    $('#recMemo').value = target ? target.memo : '';
  }
  const onBreak = !!run && run.type === 'break';
  recCustomerCombo.input.disabled = onBreak;
  recProjectCombo.input.disabled = onBreak;
  $('#recMemo').disabled = onBreak;
  const note = $('#recFieldsNote');
  note.hidden = !(onBreak || !run);
  note.textContent = onBreak ? '休憩中は入力できません。' : '入力した内容は、次に開始する作業に使います。';

  // 直前の作業に戻る
  const prev = previousWork();
  const rb = $('#recResume');
  const prevCat = prev && categoryById(prev.categoryId);
  if (prev && prevCat && !prevCat.deleted) {
    const who = [prev.customer, prev.project].filter(Boolean).join('／');
    rb.textContent = `↩ 直前の作業に戻る（${prevCat.name}${who ? `：${who}` : ''}）`;
    rb.disabled = false;
  } else {
    rb.textContent = '↩ 直前の作業に戻る（なし）';
    rb.disabled = true;
  }

  // 直近3件
  const recent = state.records.filter((r) => r.end != null && dateKey(r.start) === todayKey())
    .sort((a, b) => b.end - a.end).slice(0, 3);
  const ul = $('#recRecent');
  ul.innerHTML = '';
  if (!recent.length) ul.append(el('li', 'empty', '本日の記録はまだありません'));
  for (const r of recent) {
    const li = el('li');
    li.append(el('span', 'time', `${fmtHM(r.start)}-${fmtHM(r.end)}`));
    const who = [r.customer, r.project].filter(Boolean).join('／');
    li.append(document.createTextNode(`${categoryLabel(r)}${who ? `（${who}）` : ''}`));
    ul.append(li);
  }

  const bb = $('#recBreak');
  bb.textContent = onBreak ? '休憩中' : '休憩';
  bb.setAttribute('aria-pressed', String(onBreak));
  $('#recEnd').disabled = !run;

  tickRecord(now);
}

function tickRecord(now = Date.now()) {
  const run = getRunning();
  $('#recDate').textContent = fmtDateJa(todayKey());
  const total = recordsOfDate(todayKey()).filter((r) => r.type === 'work').reduce((s, r) => s + recordMinutes(r, now), 0);
  $('#recTotal').textContent = fmtDuration(total);
  const box = $('.rec-current');
  if (run) {
    $('#recCurrentName').textContent = run.type === 'break' ? '休憩中' : `実行中：${categoryLabel(run)}`;
    $('#recElapsed').textContent = fmtHMS(now - run.start);
    $('#recStart').textContent = `開始 ${dateKey(run.start) === todayKey() ? '' : `${fmtDateJa(dateKey(run.start))} `}${fmtHM(run.start)}`;
    box.classList.toggle('is-active', run.type === 'work');
  } else {
    $('#recCurrentName').textContent = '作業していません';
    $('#recElapsed').textContent = '00:00:00';
    $('#recStart').textContent = '作業ボタンを押すと計測を開始します';
    box.classList.remove('is-active');
  }
}

/** 数字キーで作業を切り替える */
function onGlobalKeydown(e) {
  if (e.key === 'Escape' && otherListOpen && currentScreen === 'record' && !isDialogOpen()) {
    otherListOpen = false;
    renderRecord();
    const b = $('#otherBtn');
    if (b) b.focus();
    return;
  }
  if (currentScreen !== 'record' || isDialogOpen()) return;
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  const t = e.target;
  if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
  if (!/^[1-9]$/.test(e.key)) return;
  const { buttons } = buttonLayout();
  const c = buttons[Number(e.key) - 1];
  if (!c) return;
  e.preventDefault();
  startWork(c.id);
}

/** 前日以前の計測中の作業が残っていたら終了時刻を入力してもらう */
async function checkStaleRunning() {
  const r = getRunning();
  if (!r || dateKey(r.start) >= todayKey()) return;
  const wrap = el('div');
  const lab = el('label', null, '終了時刻');
  lab.htmlFor = 'staleEnd';
  const input = el('input');
  input.type = 'datetime-local';
  input.id = 'staleEnd';
  const def = Math.max(combine(dateKey(r.start), '18:00'), r.start + 60000);
  input.value = fmtDatetimeLocal(def);
  input.min = fmtDatetimeLocal(r.start);
  wrap.append(lab, input);
  await openDialog({
    title: '前日以前の作業が計測中です',
    message: `${fmtDateJa(dateKey(r.start))} ${fmtHM(r.start)} から「${categoryLabel(r)}」が計測中のままです。終了時刻を入力してください。`,
    content: wrap,
    dismissable: false,
    buttons: [{
      label: 'この時刻で終了', value: true, primary: true,
      validate: () => {
        const t = parseDatetimeLocal(input.value);
        if (t == null) return '終了時刻を入力してください。';
        if (t <= r.start) return '開始時刻より後の時刻を入力してください。';
        if (t > Date.now()) return '現在より後の時刻は入力できません。';
        return null;
      },
    }],
  });
  r.end = parseDatetimeLocal(input.value);
  save();
  renderAll();
}

/* =====================================================================
 * 日報画面
 * ===================================================================== */
function buildReportData(key, now = Date.now()) {
  const recs = recordsOfDate(key).filter((r) => r.type === 'work');
  const clean = (s) => String(s || '').replace(/\s*[\r\n]+\s*/g, ' ').trim();
  const lines = recs.map((r) => ({
    start: fmtHM(r.start),
    end: r.end == null ? '' : fmtHM(r.end),
    running: r.end == null,
    category: categoryLabel(r),
    customer: clean(r.customer),
    project: clean(r.project),
    memo: clean(r.memo),
    minutes: recordMinutes(r, now),
  }));
  const byCat = new Map();
  recs.forEach((r, i) => {
    const m = byCat.get(r.categoryId) || { name: categoryLabel(r), minutes: 0, first: i };
    m.minutes += lines[i].minutes;
    byCat.set(r.categoryId, m);
  });
  const categories = [...byCat.values()].sort((a, b) => b.minutes - a.minutes || a.first - b.first)
    .map(({ name, minutes }) => ({ name, minutes }));
  const totalMinutes = lines.reduce((s, l) => s + l.minutes, 0);
  return { date: key, lines, totalMinutes, categories };
}

function recordWarnings(list) {
  const w = new Map();
  const add = (r, msg) => { if (!w.has(r.id)) w.set(r.id, []); w.get(r.id).push(msg); };
  const now = Date.now();
  list.forEach((r, i) => {
    const end = r.end == null ? now : r.end;
    if (r.end != null && r.end < r.start) add(r, '終了時刻が開始時刻より前です');
    for (let j = 0; j < list.length; j++) {
      if (j === i) continue;
      const o = list[j];
      const oe = o.end == null ? now : o.end;
      if (r.start < oe && o.start < end) {
        add(r, `${fmtHM(o.start)}からの「${categoryLabel(o)}」と時刻が重複しています`);
      }
    }
  });
  return w;
}

function categoryOptions(r) {
  const opts = activeCategories().map((c) => ({ value: c.id, label: c.name }));
  if (r.type === 'work') {
    const c = categoryById(r.categoryId);
    if (c && c.deleted) opts.push({ value: c.id, label: `${c.name}（削除済み）` });
  }
  opts.push({ value: BREAK_VALUE, label: '休憩' });
  return opts;
}

function labeled(text, control, className) {
  const box = el('div', className);
  const lab = el('label', 'field-label', text);
  const input = control.input || control;
  if (!input.id) input.id = `f${uid()}`;
  lab.htmlFor = input.id;
  box.append(lab, control);
  return box;
}

function applyTime(r, field, v) {
  if (!/^\d{2}:\d{2}$/.test(v)) return false;
  const ts = combine(dateKey(r.start), v);
  if (field === 'start') {
    if (ts === r.start) return false;
    r.start = ts;
  } else {
    if (ts === r.end) return false;
    r.end = ts;
  }
  return true;
}

function buildRecordRow(r, prefix, warnings) {
  const warn = warnings.get(r.id) || [];
  const row = el('div', `rec-row${warn.length ? ' has-warn' : ''}${r.type === 'break' ? ' is-break' : ''}`);
  const meta = el('div', 'row-meta');
  meta.textContent = `${fmtHM(r.start)}-${r.end == null ? '計測中' : fmtHM(r.end)}（${recordMinutes(r)}分）`;
  if (r.end == null) meta.append(el('span', 'badge', '● 計測中'));
  row.append(meta);
  const grid = el('div', 'rec-row-grid');

  const timeInput = (field) => {
    const i = el('input');
    i.type = 'time';
    i.dataset.fk = `${prefix}-${r.id}-${field}`;
    const val = field === 'start' ? r.start : r.end;
    i.value = val == null ? '' : fmtHM(val);
    const apply = () => {
      if (!i.value) { i.value = val == null ? '' : fmtHM(val); return; }
      if (applyTime(r, field, i.value)) { save(); scheduleRender(); }
    };
    i.addEventListener('blur', apply);
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
    return i;
  };
  grid.append(labeled('開始', timeInput('start'), 'col-start'));
  const endBox = labeled(r.end == null ? '終了（計測中）' : '終了', timeInput('end'), 'col-end');
  grid.append(endBox);

  const sel = el('select');
  sel.dataset.fk = `${prefix}-${r.id}-cat`;
  for (const o of categoryOptions(r)) {
    const op = el('option', null, o.label);
    op.value = o.value;
    sel.append(op);
  }
  sel.value = r.type === 'break' ? BREAK_VALUE : r.categoryId;
  sel.addEventListener('change', () => {
    if (sel.value === BREAK_VALUE) { r.type = 'break'; r.categoryId = null; } else { r.type = 'work'; r.categoryId = sel.value; }
    save();
    scheduleRender();
  });
  grid.append(labeled('カテゴリ', sel, 'col-cat'));

  let projCombo;
  const custCombo = createCombo({
    kind: 'customer', value: r.customer, fk: `${prefix}-${r.id}-cust`,
    onCommit: (v, changed) => {
      r.customer = v;
      if (changed && shouldClearProject(v, r.project)) r.project = '';
      save();
      scheduleRender();
    },
  });
  projCombo = createCombo({
    kind: 'project', value: r.project, fk: `${prefix}-${r.id}-proj`,
    getCustomer: () => custCombo.input.value,
    onCommit: (v) => { r.project = v; save(); scheduleRender(); },
    onSetCustomer: (name) => { r.customer = name; custCombo.setValue(name); },
  });
  grid.append(labeled('顧客', custCombo, 'col-cust'));
  grid.append(labeled('案件', projCombo, 'col-proj'));

  const memo = el('input');
  memo.type = 'text';
  memo.value = r.memo;
  memo.autocomplete = 'off';
  memo.placeholder = '任意';
  memo.dataset.fk = `${prefix}-${r.id}-memo`;
  memo.addEventListener('change', () => { r.memo = memo.value; save(); scheduleRender(); });
  grid.append(labeled('メモ', memo, 'col-memo'));

  const actions = el('div', 'col-actions');
  if (r.end == null) {
    const stop = button('今の時刻で終了', () => { r.end = Math.max(Date.now(), r.start); save(); renderAll(); }, 'btn btn-small');
    stop.dataset.fk = `${prefix}-${r.id}-stop`;
    actions.append(stop);
  }
  const del = button('削除', async () => {
    const ok = await confirmDialog('記録の削除', `${fmtHM(r.start)}-${r.end == null ? '計測中' : fmtHM(r.end)}「${categoryLabel(r)}」を削除しますか？`, '削除する', true);
    if (!ok) return;
    state.records = state.records.filter((x) => x !== r);
    save();
    renderAll();
  }, 'btn btn-small btn-danger');
  del.dataset.fk = `${prefix}-${r.id}-del`;
  actions.append(del);
  grid.append(actions);
  row.append(grid);
  for (const m of warn) row.append(el('p', 'warn row-warn', `⚠ ${m}`));
  return row;
}

function renderReport() {
  const key = reportDate;
  $('#repDate').value = key;
  const list = recordsOfDate(key);
  const warnings = recordWarnings(list);

  const box = $('#repList');
  box.innerHTML = '';
  if (!list.length) box.append(el('p', 'note', 'この日の記録はありません。'));
  for (const r of list) box.append(buildRecordRow(r, 'list', warnings));
  const ws = $('#repWarnSummary');
  ws.hidden = warnings.size === 0;
  ws.textContent = `⚠ 時刻に問題のある記録が${warnings.size}件あります。`;

  // 登録前の確認
  const chk = $('#repCheck');
  chk.innerHTML = '';
  const targets = list.filter((r) => r.end == null || (r.type === 'work' && !norm(r.customer) && !norm(r.project) && !norm(r.memo)));
  if (!targets.length) chk.append(el('p', 'note', '✓ 確認が必要な記録はありません。'));
  for (const r of targets) {
    const reason = r.end == null ? '計測中の記録' : '顧客・案件・メモが未入力';
    chk.append(el('p', 'warn', `⚠ ${reason}`));
    chk.append(buildRecordRow(r, 'chk', warnings));
  }

  // 合計バー
  const data = buildReportData(key);
  const bars = $('#repBars');
  bars.innerHTML = '';
  if (!data.categories.length) bars.append(el('p', 'note', '集計する記録がありません。'));
  const max = Math.max(1, ...data.categories.map((c) => c.minutes));
  for (const c of data.categories) {
    const row = el('div', 'bar-row');
    const lab = el('div', 'bar-label');
    lab.append(el('span', null, c.name), el('span', 'num', `${toHours(c.minutes)}h（${c.minutes}分）`));
    const track = el('div', 'bar-track');
    track.setAttribute('aria-hidden', 'true');
    const fill = el('div', 'bar-fill');
    fill.style.width = `${(c.minutes / max) * 100}%`;
    track.append(fill);
    row.append(lab, track);
    bars.append(row);
  }
  if (data.categories.length) {
    const t = el('div', 'bar-label bars-total');
    t.append(el('span', null, '合計'), el('span', 'num', `${toHours(data.totalMinutes)}h（${data.totalMinutes}分）`));
    bars.append(t);
  }

  $('#repText').value = formatDailyReport(data);
  if (!$('#csvFrom').value) $('#csvFrom').value = key;
  if (!$('#csvTo').value) $('#csvTo').value = key;
}

function addRecordOnReport() {
  const key = reportDate;
  const list = recordsOfDate(key).filter((r) => r.end != null);
  let start = list.length ? Math.max(...list.map((r) => r.end)) : combine(key, '09:00');
  if (dateKey(start) !== key) start = combine(key, '09:00');
  const cats = activeCategories();
  const r = { id: uid(), start, end: start + 30 * 60000, type: 'work', categoryId: cats[0].id, customer: '', project: '', memo: '' };
  state.records.push(r);
  save();
  renderAll();
  const f = document.querySelector(`[data-fk="list-${r.id}-start"]`);
  if (f) f.focus();
}

async function copyReport() {
  const text = $('#repText').value;
  const status = $('#repCopyStatus');
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch (_) { ok = false; }
  if (!ok) {
    const ta = $('#repText');
    ta.focus();
    ta.select();
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    $('#repCopy').focus();
  }
  status.textContent = ok ? '✓ コピーしました' : '⚠ コピーできませんでした。テキストを選択してコピーしてください。';
  clearTimeout(copyReport.t);
  copyReport.t = setTimeout(() => { status.textContent = ''; }, 4000);
}

/* ----- CSV / JSON ----- */
function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows) {
  return `﻿${rows.map((r) => r.map(csvEscape).join(',')).join('\r\n')}\r\n`;
}
/** RFC 4180 形式の CSV を解析する（引用符内のカンマ・改行に対応） */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function recordsCsv(records) {
  const rows = [['日付', '開始', '終了', '分', 'カテゴリ', '顧客', '案件', 'メモ']];
  for (const r of records) {
    rows.push([dateKey(r.start), fmtHM(r.start), r.end == null ? '' : fmtHM(r.end), recordMinutes(r), categoryLabel(r), r.customer, r.project, r.memo]);
  }
  return toCsv(rows);
}
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const compactKey = (k) => k.replace(/-/g, '');

function exportCsvRange(from, to) {
  if (!from || !to) { $('#dataStatus').textContent = '⚠ 開始日と終了日を指定してください。'; return; }
  if (from > to) [from, to] = [to, from];
  const recs = state.records.filter((r) => { const k = dateKey(r.start); return k >= from && k <= to; })
    .sort((a, b) => a.start - b.start);
  const name = from === to ? `作業記録_${compactKey(from)}.csv` : `作業記録_${compactKey(from)}-${compactKey(to)}.csv`;
  download(name, recordsCsv(recs), 'text/csv;charset=utf-8');
  $('#dataStatus').textContent = `✓ ${recs.length}件の記録を書き出しました（${name}）。`;
}
function exportJson() {
  const name = `sagyokanri_backup_${compactKey(todayKey())}.json`;
  download(name, JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2), 'application/json');
  $('#dataStatus').textContent = `✓ バックアップを書き出しました（${name}）。`;
}
async function restoreJson(file) {
  let d;
  try {
    const text = await file.text();
    d = parseStored(text.replace(/^﻿/, ''));
  } catch (e) {
    await alertDialog('復元できません', `バックアップファイルの内容が正しくありません。\n理由：${e instanceof SyntaxError ? 'JSONとして読み込めません。' : e.message}`);
    return;
  }
  const ok = await confirmDialog('バックアップから復元',
    `次の内容で現在のデータをすべて上書きします。よろしいですか？\n\n記録：${d.records.length}件\n顧客：${d.customers.length}件\n案件：${d.projects.length}件\n作業：${d.categories.filter((c) => !c.deleted).length}件`,
    '上書きして復元', true);
  if (!ok) return;
  state = d;
  shownFieldsKey = null;
  save();
  renderAll();
  $('#dataStatus').textContent = `✓ 復元しました（記録 ${d.records.length}件）。`;
  checkStaleRunning();
}

function initReportScreen() {
  $('#repPrev').addEventListener('click', () => { reportDate = shiftKey(reportDate, -1); renderAll(); });
  $('#repNext').addEventListener('click', () => { reportDate = shiftKey(reportDate, 1); renderAll(); });
  $('#repToday').addEventListener('click', () => { reportDate = todayKey(); renderAll(); });
  $('#repDate').addEventListener('change', (e) => { if (e.target.value) { reportDate = e.target.value; renderAll(); } });
  $('#repAdd').addEventListener('click', addRecordOnReport);
  $('#repCopy').addEventListener('click', copyReport);
  $('#csvDay').addEventListener('click', () => exportCsvRange(reportDate, reportDate));
  $('#csvRange').addEventListener('click', () => exportCsvRange($('#csvFrom').value, $('#csvTo').value));
  $('#jsonBackup').addEventListener('click', exportJson);
  $('#jsonRestore').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) await restoreJson(f);
  });
}

/* =====================================================================
 * マスタ管理画面
 * ===================================================================== */
let selectedCustomerId = null;

function moveInArray(arr, item, sameGroup, dir) {
  const idx = arr.indexOf(item);
  let j = idx + dir;
  while (j >= 0 && j < arr.length && !sameGroup(arr[j])) j += dir;
  if (j < 0 || j >= arr.length) return false;
  [arr[idx], arr[j]] = [arr[j], arr[idx]];
  return true;
}

function countCustomerRecords(name) { return state.records.filter((r) => norm(r.customer) === norm(name)).length; }
function countProjectRecords(custName, projName) {
  return state.records.filter((r) => norm(r.customer) === norm(custName) && norm(r.project) === norm(projName)).length;
}

async function renameCustomer(c) {
  const name = await promptDialog('顧客名の編集', '顧客名', c.name);
  if (name == null || name === c.name) return;
  const dup = findCustomer(name);
  if (dup && dup !== c) { await alertDialog('編集できません', `『${name}』はすでに登録されています。`); return; }
  const n = countCustomerRecords(c.name);
  let reflect = false;
  if (n > 0) {
    const v = await openDialog({
      title: '過去の記録への反映',
      message: `『${c.name}』を使っている過去の記録が${n}件あります。新しい名前『${name}』に書き換えますか？`,
      cancelValue: 'cancel',
      buttons: [{ label: 'キャンセル', value: 'cancel' }, { label: 'マスタだけ変更', value: 'master' }, { label: `記録${n}件にも反映`, value: 'all', primary: true }],
    });
    if (v === 'cancel') return;
    reflect = v === 'all';
  }
  if (reflect) for (const r of state.records) if (norm(r.customer) === norm(c.name)) r.customer = name;
  if (norm(state.draft.customer) === norm(c.name) && reflect) state.draft.customer = name;
  c.name = name;
  save();
  shownFieldsKey = null;
  renderAll();
}
async function renameProject(p) {
  const c = customerById(p.customerId);
  const name = await promptDialog('案件名の編集', `案件名（${c.name}）`, p.name);
  if (name == null || name === p.name) return;
  const dup = projectsOf(c.id).find((x) => norm(x.name) === norm(name));
  if (dup && dup !== p) { await alertDialog('編集できません', `『${name}』はすでに登録されています。`); return; }
  const n = countProjectRecords(c.name, p.name);
  let reflect = false;
  if (n > 0) {
    const v = await openDialog({
      title: '過去の記録への反映',
      message: `『${c.name}／${p.name}』を使っている過去の記録が${n}件あります。新しい名前『${name}』に書き換えますか？`,
      cancelValue: 'cancel',
      buttons: [{ label: 'キャンセル', value: 'cancel' }, { label: 'マスタだけ変更', value: 'master' }, { label: `記録${n}件にも反映`, value: 'all', primary: true }],
    });
    if (v === 'cancel') return;
    reflect = v === 'all';
  }
  if (reflect) for (const r of state.records) if (norm(r.customer) === norm(c.name) && norm(r.project) === norm(p.name)) r.project = name;
  p.name = name;
  save();
  shownFieldsKey = null;
  renderAll();
}

function masterItem({ item, label, group, arr, selectable, fkp, onEdit }) {
  const li = el('li', `master-item${item.hidden ? ' is-hidden' : ''}`);
  if (selectable) {
    const b = button(label, () => { selectedCustomerId = item.id; renderAll(); }, 'btn master-name');
    b.setAttribute('aria-pressed', String(selectedCustomerId === item.id));
    b.dataset.fk = `${fkp}-sel-${item.id}`;
    li.append(b);
  } else {
    li.append(el('span', 'label-text', label));
  }
  if (selectable && selectedCustomerId === item.id) li.append(el('span', 'tag', '選択中'));
  if (item.hidden) li.append(el('span', 'tag', '非表示'));
  const up = button('↑', () => { if (moveInArray(arr, item, group, -1)) { save(); renderAll(); } }, 'btn btn-icon');
  up.setAttribute('aria-label', `${item.name}を上へ`);
  up.dataset.fk = `${fkp}-up-${item.id}`;
  const down = button('↓', () => { if (moveInArray(arr, item, group, 1)) { save(); renderAll(); } }, 'btn btn-icon');
  down.setAttribute('aria-label', `${item.name}を下へ`);
  down.dataset.fk = `${fkp}-down-${item.id}`;
  const edit = button('編集', onEdit, 'btn btn-small');
  edit.dataset.fk = `${fkp}-edit-${item.id}`;
  const hide = button(item.hidden ? '再表示' : '非表示', () => { item.hidden = !item.hidden; save(); renderAll(); }, 'btn btn-small');
  hide.dataset.fk = `${fkp}-hide-${item.id}`;
  li.append(up, down, edit, hide);
  return li;
}

function manualNames() {
  const cust = new Map();
  const proj = new Map();
  for (const r of state.records) {
    const c = r.customer.trim();
    const p = r.project.trim();
    if (c && !findCustomer(c)) {
      const k = norm(c);
      const e = cust.get(k) || { name: c, count: 0 };
      e.count++;
      cust.set(k, e);
    }
    if (p && !isMasterProject(c, p)) {
      const k = `${norm(c)}\u0000${norm(p)}`;
      const e = proj.get(k) || { customer: c, name: p, count: 0 };
      e.count++;
      proj.set(k, e);
    }
  }
  const sort = (m) => [...m.values()].sort((a, b) => b.count - a.count);
  return { customers: sort(cust), projects: sort(proj) };
}

async function mergeCustomer(entry) {
  if (!state.customers.length) { await alertDialog('まとめられません', 'マスタに顧客が登録されていません。'); return; }
  const wrap = el('div');
  const lab = el('label', null, 'まとめ先の顧客');
  lab.htmlFor = 'mergeTarget';
  const sel = el('select');
  sel.id = 'mergeTarget';
  for (const c of state.customers) {
    const o = el('option', null, c.hidden ? `${c.name}（非表示）` : c.name);
    o.value = c.id;
    sel.append(o);
  }
  wrap.append(lab, sel);
  const ok = await openDialog({ title: `『${entry.name}』を既存にまとめる`, content: wrap, cancelValue: false, buttons: [{ label: 'キャンセル', value: false }, { label: '次へ', value: true, primary: true }] });
  if (!ok) return;
  const target = customerById(sel.value);
  const targets = state.records.filter((r) => norm(r.customer) === norm(entry.name));
  const ok2 = await confirmDialog('名前をまとめる', `${targets.length}件の記録の顧客名を『${entry.name}』から『${target.name}』に書き換えます。よろしいですか？`, `${targets.length}件を書き換える`);
  if (!ok2) return;
  for (const r of targets) r.customer = target.name;
  save();
  shownFieldsKey = null;
  renderAll();
  $('#masterStatus').textContent = `✓ ${targets.length}件の記録を『${target.name}』にまとめました。`;
}
async function mergeProject(entry) {
  const own = findCustomer(entry.customer);
  const list = state.projects.map((p) => ({ p, c: customerById(p.customerId) })).filter((x) => x.c);
  if (!list.length) { await alertDialog('まとめられません', 'マスタに案件が登録されていません。'); return; }
  list.sort((a, b) => (own && b.c.id === own.id ? 1 : 0) - (own && a.c.id === own.id ? 1 : 0));
  const wrap = el('div');
  const lab = el('label', null, 'まとめ先の案件（顧客／案件）');
  lab.htmlFor = 'mergeTarget';
  const sel = el('select');
  sel.id = 'mergeTarget';
  for (const { p, c } of list) {
    const o = el('option', null, `${c.name}／${p.name}${p.hidden || c.hidden ? '（非表示）' : ''}`);
    o.value = p.id;
    sel.append(o);
  }
  wrap.append(lab, sel);
  const ok = await openDialog({ title: `『${entry.customer ? `${entry.customer}／` : ''}${entry.name}』を既存にまとめる`, content: wrap, cancelValue: false, buttons: [{ label: 'キャンセル', value: false }, { label: '次へ', value: true, primary: true }] });
  if (!ok) return;
  const tp = state.projects.find((p) => p.id === sel.value);
  const tc = customerById(tp.customerId);
  const targets = state.records.filter((r) => norm(r.customer) === norm(entry.customer) && norm(r.project) === norm(entry.name));
  const ok2 = await confirmDialog('名前をまとめる', `${targets.length}件の記録の顧客・案件を『${tc.name}／${tp.name}』に書き換えます。よろしいですか？`, `${targets.length}件を書き換える`);
  if (!ok2) return;
  for (const r of targets) { r.customer = tc.name; r.project = tp.name; }
  save();
  shownFieldsKey = null;
  renderAll();
  $('#masterStatus').textContent = `✓ ${targets.length}件の記録を『${tc.name}／${tp.name}』にまとめました。`;
}

function renderMaster() {
  if (selectedCustomerId && !customerById(selectedCustomerId)) selectedCustomerId = null;
  if (!selectedCustomerId && state.customers.length) selectedCustomerId = state.customers[0].id;

  const cl = $('#custList');
  cl.innerHTML = '';
  if (!state.customers.length) cl.append(el('li', 'master-empty', '顧客はまだ登録されていません。'));
  for (const c of state.customers) {
    cl.append(masterItem({ item: c, label: c.name, arr: state.customers, group: () => true, selectable: true, fkp: 'cust', onEdit: () => renameCustomer(c) }));
  }

  const sc = customerById(selectedCustomerId);
  $('#projHeading').textContent = sc ? `案件（${sc.name}）` : '案件';
  $('#projAddName').disabled = !sc;
  $('#projAddForm button').disabled = !sc;
  const pl = $('#projList');
  pl.innerHTML = '';
  if (!sc) pl.append(el('li', 'master-empty', '左の一覧から顧客を選択してください。'));
  else {
    const ps = projectsOf(sc.id);
    if (!ps.length) pl.append(el('li', 'master-empty', 'この顧客の案件はまだ登録されていません。'));
    for (const p of ps) {
      pl.append(masterItem({ item: p, label: p.name, arr: state.projects, group: (x) => x.customerId === sc.id, selectable: false, fkp: 'proj', onEdit: () => renameProject(p) }));
    }
  }

  const { customers, projects } = manualNames();
  const mc = $('#manualCustList');
  mc.innerHTML = '';
  if (!customers.length) mc.append(el('li', 'master-empty', 'ありません。'));
  for (const e of customers) {
    const li = el('li', 'master-item');
    li.append(el('span', 'label-text', e.name), el('span', 'count', `${e.count}件`));
    const reg = button('マスタに登録', () => { addCustomer(e.name); save(); renderAll(); $('#masterStatus').textContent = `✓ 『${e.name}』を顧客に登録しました。`; }, 'btn btn-small');
    reg.dataset.fk = `mc-reg-${norm(e.name)}`;
    const mg = button('既存にまとめる', () => mergeCustomer(e), 'btn btn-small');
    mg.dataset.fk = `mc-merge-${norm(e.name)}`;
    li.append(reg, mg);
    mc.append(li);
  }
  const mp = $('#manualProjList');
  mp.innerHTML = '';
  if (!projects.length) mp.append(el('li', 'master-empty', 'ありません。'));
  for (const e of projects) {
    const li = el('li', 'master-item');
    li.append(el('span', 'label-text', `${e.name}（${e.customer || '顧客なし'}）`), el('span', 'count', `${e.count}件`));
    const reg = button(e.customer ? 'マスタに登録' : '登録不可（顧客なし）', () => {
      addProject(e.customer, e.name); save(); renderAll();
      $('#masterStatus').textContent = `✓ 『${e.customer}／${e.name}』を案件に登録しました。`;
    }, 'btn btn-small');
    reg.disabled = !e.customer;
    reg.dataset.fk = `mp-reg-${norm(e.customer)}-${norm(e.name)}`;
    const mg = button('既存にまとめる', () => mergeProject(e), 'btn btn-small');
    mg.dataset.fk = `mp-merge-${norm(e.customer)}-${norm(e.name)}`;
    li.append(reg, mg);
    mp.append(li);
  }
}

function decodeCsvBuffer(buf) {
  const bytes = new Uint8Array(buf);
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''), enc: 'UTF-8' };
  } catch (_) {
    return { text: new TextDecoder('shift_jis').decode(bytes), enc: 'Shift_JIS' };
  }
}
function importMasterCsv(text) {
  const rows = parseCsv(text);
  const res = { customers: 0, projects: 0, dup: 0, invalid: 0 };
  rows.forEach((row, i) => {
    const cust = (row[0] || '').trim();
    const proj = (row[1] || '').trim();
    if (i === 0 && cust === '顧客名') return; // 見出し行
    if (!cust && !proj) return; // 空行
    if (!cust) { res.invalid++; return; }
    let c = findCustomer(cust);
    if (!c) { c = addCustomer(cust); res.customers++; } else if (!proj) res.dup++;
    if (proj) {
      if (projectsOf(c.id).some((p) => norm(p.name) === norm(proj))) res.dup++;
      else { addProject(c.name, proj); res.projects++; }
    }
  });
  return res;
}
function exportMasterCsv() {
  const rows = [['顧客名', '案件名']];
  for (const c of state.customers) {
    if (c.hidden) continue;
    const ps = projectsOf(c.id).filter((p) => !p.hidden);
    if (!ps.length) rows.push([c.name, '']);
    for (const p of ps) rows.push([c.name, p.name]);
  }
  const name = `顧客案件マスタ_${compactKey(todayKey())}.csv`;
  download(name, toCsv(rows), 'text/csv;charset=utf-8');
  $('#masterStatus').textContent = `✓ ${rows.length - 1}行を書き出しました（${name}）。非表示の項目は含みません。`;
}

function initMasterScreen() {
  $('#custAddForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#custAddName');
    const n = input.value.trim();
    if (!n) return;
    if (findCustomer(n)) { await alertDialog('追加できません', `『${n}』はすでに登録されています。`); return; }
    const c = addCustomer(n);
    selectedCustomerId = c.id;
    input.value = '';
    save();
    renderAll();
    input.focus();
  });
  $('#projAddForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const sc = customerById(selectedCustomerId);
    const input = $('#projAddName');
    const n = input.value.trim();
    if (!sc || !n) return;
    if (projectsOf(sc.id).some((p) => norm(p.name) === norm(n))) { await alertDialog('追加できません', `『${n}』はすでに登録されています。`); return; }
    addProject(sc.name, n);
    input.value = '';
    save();
    renderAll();
    input.focus();
  });
  $('#masterExport').addEventListener('click', exportMasterCsv);
  $('#masterImport').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const { text, enc } = decodeCsvBuffer(await f.arrayBuffer());
    const res = importMasterCsv(text);
    save();
    renderAll();
    const msg = `顧客 ${res.customers}件、案件 ${res.projects}件を追加しました。\n重複のため取り込まなかった行：${res.dup}件\n顧客名がない行：${res.invalid}件\n（文字コード：${enc}）`;
    $('#masterStatus').textContent = `✓ ${msg.replace(/\n/g, ' ')}`;
    await alertDialog('CSVの取り込み結果', msg);
  });
}

/* =====================================================================
 * 作業ボタン設定画面
 * ===================================================================== */
function moveCategory(c, dir) {
  if (moveInArray(state.categories, c, (x) => !x.deleted, dir)) { save(); renderAll(); }
}
function sortCategoriesByUsage() {
  const use = categoryUsage30();
  const act = activeCategories().map((c, i) => ({ c, i, n: use.get(c.id) || 0 }));
  act.sort((a, b) => b.n - a.n || a.i - b.i); // 同数は現在の順を保つ
  state.categories = act.map((x) => x.c).concat(state.categories.filter((c) => c.deleted));
  save();
  renderAll();
}
async function deleteCategory(c) {
  const run = getRunning();
  if (run && run.categoryId === c.id) return;
  if (activeCategories().length <= 1) { await alertDialog('削除できません', '作業は1つ以上必要です。'); return; }
  const ok = await confirmDialog('作業の削除', `『${c.name}』を削除しますか？\n過去の記録と日報には『${c.name}』のまま残ります。`, '削除する', true);
  if (!ok) return;
  c.deleted = true;
  save();
  renderAll();
}

function renderSettings() {
  const use = categoryUsage30();
  const run = getRunning();
  const cats = activeCategories();
  const { buttons } = buttonLayout();
  const list = $('#catList');
  list.innerHTML = '';
  cats.forEach((c, i) => {
    if (cats.length > MAX_VISIBLE_BUTTONS && i === BUTTONS_WITH_OTHERS) {
      const sep = el('li', 'cat-sep', 'ここから下は『他の作業』のリストから選択します');
      sep.setAttribute('role', 'separator');
      list.append(sep);
    }
    const li = el('li', 'cat-item');
    const keyLabel = i < buttons.length ? String(i + 1) : '—';
    const k = el('span', 'cat-key', keyLabel);
    k.title = i < buttons.length ? `数字キー ${keyLabel}` : '数字キーなし';
    k.setAttribute('aria-label', i < buttons.length ? `数字キー${keyLabel}` : '数字キーなし');
    const name = el('input');
    name.type = 'text';
    name.value = c.name;
    name.autocomplete = 'off';
    name.setAttribute('aria-label', `作業名（${i + 1}番目）`);
    name.dataset.fk = `cat-name-${c.id}`;
    name.addEventListener('change', async () => {
      const v = name.value.trim();
      if (!v) { name.value = c.name; return; }
      if (activeCategories().some((x) => x !== c && norm(x.name) === norm(v))) {
        await alertDialog('変更できません', `『${v}』はすでにあります。`);
        name.value = c.name;
        return;
      }
      c.name = v;
      save();
      scheduleRender();
    });
    const nameBox = el('div');
    nameBox.append(name);
    const running = run && run.type === 'work' && run.categoryId === c.id;
    if (running) nameBox.append(el('span', 'cat-running', '● 実行中のため削除できません'));
    const usage = el('span', 'cat-usage', `30日：${use.get(c.id) || 0}回`);
    const up = button('↑', () => moveCategory(c, -1), 'btn btn-icon');
    up.setAttribute('aria-label', `${c.name}を上へ`);
    up.disabled = i === 0;
    up.dataset.fk = `cat-up-${c.id}`;
    const down = button('↓', () => moveCategory(c, 1), 'btn btn-icon');
    down.setAttribute('aria-label', `${c.name}を下へ`);
    down.disabled = i === cats.length - 1;
    down.dataset.fk = `cat-down-${c.id}`;
    const del = button('削除', () => deleteCategory(c), 'btn btn-small btn-danger');
    del.disabled = !!running;
    del.dataset.fk = `cat-del-${c.id}`;
    li.append(k, nameBox, usage, up, down, del);
    list.append(li);
  });

  const { others } = buildWorkGrid($('#previewGrid'), true);
  const po = $('#previewOthers');
  po.innerHTML = '';
  if (others.length) {
    po.append(el('div', null, '「他の作業」のリスト：'));
    const ul = el('ul');
    for (const c of others) ul.append(el('li', null, c.name));
    po.append(ul);
  } else {
    po.append(el('div', null, `すべての作業をボタンで表示しています（${cats.length}個）。`));
  }
}

function initSettingsScreen() {
  $('#catSortUsage').addEventListener('click', sortCategoriesByUsage);
  $('#catAddForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#catAddName');
    const n = input.value.trim();
    if (!n) return;
    if (activeCategories().some((c) => norm(c.name) === norm(n))) { await alertDialog('追加できません', `『${n}』はすでにあります。`); return; }
    state.categories.push({ id: uid(), name: n, deleted: false });
    input.value = '';
    save();
    renderAll();
    input.focus();
  });
}

/* =====================================================================
 * 起動
 * ===================================================================== */
function init() {
  initRecordScreen();
  initReportScreen();
  initMasterScreen();
  initSettingsScreen();
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showScreen(t.dataset.screen)));
  window.addEventListener('hashchange', () => showScreen(location.hash.slice(1)));
  document.addEventListener('keydown', onGlobalKeydown);
  // 別タブで更新されたら読み直す
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try { state = parseStored(e.newValue); shownFieldsKey = null; renderAll(); } catch (_) { /* 無視 */ }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tickRecord(); });
  setInterval(() => { if (currentScreen === 'record') tickRecord(); }, 1000);
  showScreen(location.hash.slice(1) || 'record');
  if (storageOk) save(); // 初回起動時に初期データを保存（保存可否の確認も兼ねる）
  checkStaleRunning();
}

init();
