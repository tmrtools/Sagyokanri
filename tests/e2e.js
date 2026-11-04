// ブラウザ自動操作による確認用テスト
// 実行: node tests/e2e.js   （Playwright が必要）
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const URL = `file://${path.resolve(__dirname, '..', 'index.html')}`;
const KEY = 'sagyokanri:data';
const SHOT_DIR = process.env.SHOT_DIR || path.join(os.tmpdir(), 'sagyokanri-shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

let passed = 0;
let failed = 0;
const errors = [];
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail}`); }
}

(async () => {
  // Linux でロケール未設定だと日本語のファイル名が「download」になるため UTF-8 を指定
  const browser = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
  const context = await browser.newContext({ viewport: { width: 360, height: 900 }, acceptDownloads: true, locale: 'ja-JP' });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const otherFiles = new Set();
  page.on('request', (r) => { if (r.url().startsWith('file://') && !r.url().split('#')[0].endsWith('/index.html')) otherFiles.add(r.url()); });

  const getState = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  const setState = async (s) => { await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [KEY, s]); await page.reload(); };
  const gridNames = () => page.$$eval('#workGrid .work-btn .work-name', (n) => n.map((x) => x.textContent));
  const dlgClick = async (label) => { await page.locator('#dialog[open] #dialogButtons button', { hasText: label }).click(); };
  const comboOptions = (id) => page.$$eval(`#${id}-list:not([hidden]) li`, (n) => n.map((x) => x.firstChild.textContent));
  const today = await (async () => { await page.goto(URL); return page.evaluate(() => todayKey()); })();

  // ---------------------------------------------------------------
  console.log('1. 作業の切り替え');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  check('初期作業は6個', (await gridNames()).join(',') === '電話対応,資料作成,プログラム修正,会議,顧客訪問,その他');
  await page.click('#workGrid .work-btn >> nth=0');
  await page.waitForTimeout(1100);
  await page.keyboard.press('2');
  let s = await getState();
  check('記録が2件', s.records.length === 2);
  check('前の作業が終了し、時刻が途切れない', s.records[0].end === s.records[1].start && s.records[1].end === null);
  check('実行中ボタンが強調され「実行中」と表示', await page.locator('#workGrid .work-btn.is-running').innerText().then((t) => t.includes('資料作成') && t.includes('実行中')));
  await page.click('#workGrid .work-btn >> nth=1');
  s = await getState();
  check('実行中と同じボタンでは何も変わらない', s.records.length === 2);

  // ---------------------------------------------------------------
  console.log('2. 再読み込み後の計測継続');
  // 日付をまたぐと「前日の作業が計測中」の確認が出るため、今日の範囲で開始時刻をずらす
  const sinceMidnight = Date.now() - new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const [offset, hh, mm] = sinceMidnight > 3723000 + 10000 ? [3723000, '01', '02'] : [63000, '00', '01'];
  s.records[1].start = Date.now() - offset;
  await setState(s);
  const el = await page.textContent('#recElapsed');
  check('経過時間が開始時刻との差で表示される', new RegExp(`^${hh}:${mm}:0[3-5]$`).test(el), el);
  check('実行中の作業名が復元される', (await page.textContent('#recCurrentName')).includes('資料作成'));
  await page.waitForTimeout(2100);
  const el2 = await page.textContent('#recElapsed');
  check('経過時間が進む', new RegExp(`^${hh}:${mm}:0[5-8]$`).test(el2), el2);

  // ---------------------------------------------------------------
  console.log('3. 入力欄・直前の作業に戻る・休憩');
  await page.fill('#recMemo', '納期確認 1');
  s = await getState();
  check('入力欄が実行中の記録へ自動保存される', s.records[1].memo === '納期確認 1');
  await page.locator('#recMemo').press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('2行目 3');
  s = await getState();
  check('メモ欄でEnterを押すと改行になる', s.records[1].memo === '納期確認 1\n2行目 3' && s.records.length === 2, JSON.stringify(s.records[1].memo));
  const long = 'あ'.repeat(300);
  await page.fill('#recMemo', long);
  s = await getState();
  check('メモに300文字入る', s.records[1].memo === long && (await page.textContent('#recMemoCount')) === '300 / 300文字');
  const box = await page.locator('#recMemo').boundingBox();
  check('メモ欄が複数行の高さ', box.height >= 100, String(box.height));
  await page.fill('#recMemo', '納期確認 1');
  check('文字入力中の数字キーでは切り替わらない', s.records.length === 2 && s.records[1].categoryId === 'cat2');
  await page.locator('#recMemo').blur();
  await page.keyboard.press('1');
  s = await getState();
  check('入力欄の外では数字キーで切り替わる', s.records.length === 3 && s.records[2].categoryId === 'cat1');
  check('作業を切り替えると入力欄が空になる', (await page.inputValue('#recMemo')) === '');
  await page.fill('#recMemo', '折り返し');
  await page.locator('#recMemo').blur();
  await page.click('#recBreak');
  check('休憩中は入力欄を使えない', await page.locator('#recMemo').isDisabled());
  await page.click('#recResume');
  s = await getState();
  const last = s.records[s.records.length - 1];
  check('直前の作業に戻る（休憩を除き、カテゴリとメモを引き継ぐ）', last.categoryId === 'cat1' && last.memo === '折り返し' && last.end === null && s.records[s.records.length - 2].type === 'break');
  check('引き継いだメモが入力欄に入る', (await page.inputValue('#recMemo')) === '折り返し');

  // ---------------------------------------------------------------
  console.log('4. 休憩と日報テキスト');
  const base = (h, m) => page.evaluate(([k, hh, mm]) => combine(k, `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`), [today, h, m]);
  const st = await getState();
  st.records = [];
  const rec = async (sh, sm, eh, em, cat, cu = '', pr = '', me = '', type = 'work') => st.records.push({
    id: `r${st.records.length}`, start: await base(sh, sm), end: eh == null ? null : await base(eh, em), type, categoryId: type === 'break' ? null : cat, customer: cu, project: pr, memo: me,
  });
  await rec(9, 0, 9, 25, 'cat1', 'A社', '保守サポート', '納期確認');
  await rec(9, 25, 11, 30, 'cat2', 'A社', '新規提案');
  await rec(11, 30, 12, 30, null, '', '', '', 'break');
  await rec(13, 0, 14, 0, 'cat4', '社内', '定例会議');
  await rec(14, 0, 14, 12, 'cat1');
  await rec(14, 12, 15, 30, 'cat5', 'B社');
  await rec(15, 30, 16, 48, 'cat3', '', '', 'バグ修正,緊急\n2行目');
  await setState(st);
  await page.click('.tab[data-screen="report"]');
  const text = await page.inputValue('#repText');
  console.log(text.split('\n').map((l) => `      ${l}`).join('\n'));
  check('休憩が明細に含まれない', !text.includes('休憩') && !text.includes('11:30-12:30'));
  check('書式：顧客／案件 メモ', text.includes('09:00-09:25 電話対応（A社／保守サポート 納期確認）'));
  check('書式：未入力はかっこごと省く', /^14:00-14:12 電話対応$/m.test(text));
  check('書式：メモのみ', text.includes('15:30-16:48 プログラム修正（バグ修正,緊急 2行目）'));
  const lineMin = text.split('\n').filter((l) => /^\d\d:\d\d-\d\d:\d\d/.test(l)).reduce((sum, l) => {
    const [a, b] = l.slice(0, 11).split('-').map((t) => t.split(':').map(Number)).map(([h, m]) => h * 60 + m);
    return sum + (b - a);
  }, 0);
  const totalLine = text.split('\n').find((l) => l.startsWith('合計'));
  check('合計が明細と一致', totalLine.startsWith(`合計 ${(Math.round(lineMin / 6) / 10).toFixed(1)}h：`), `${lineMin}分 / ${totalLine}`);
  check('カテゴリが時間の長い順', totalLine === '合計 6.3h：資料作成 2.1h／顧客訪問 1.3h／プログラム修正 1.3h／会議 1.0h／電話対応 0.6h', totalLine);
  const bars = await page.$$eval('#repBars .bar-row .bar-label span:first-child', (n) => n.map((x) => x.textContent));
  check('横棒が長い順で休憩を含まない', bars.join(',') === '資料作成,顧客訪問,プログラム修正,会議,電話対応', bars.join(','));
  const chk = await page.locator('#repCheck').innerText();
  check('登録前の確認に未入力の記録が出る', chk.includes('顧客・案件・メモが未入力'));
  await page.screenshot({ path: path.join(SHOT_DIR, 'report-360.png'), fullPage: true });

  // 時刻重複の警告
  check('記録は1行表示（編集前は入力欄なし）', (await page.locator('#repList input').count()) === 0 && (await page.locator('#repList .rec-line').count()) === 7);
  check('確認が不要なら欄を出さない仕組み（今回は1件）', (await page.textContent('#checkHeading')).includes('1件'));
  await page.click('[data-fk="line-r4-toggle"]');
  check('「編集」で入力欄を開く', (await page.locator('#line-r4 input').count()) > 0 && (await page.locator('#repList input[type=time]').count()) === 2);
  await page.locator('[data-fk="list-r4-start"]').fill('13:50');
  await page.locator('[data-fk="list-r4-start"]').press('Enter');
  await page.waitForTimeout(50);
  check('時刻の重複を警告', (await page.locator('#repWarnSummary').isVisible()) && (await page.locator('#repList').innerText()).includes('重複'));
  await page.locator('[data-fk="list-r4-end"]').fill('13:40');
  await page.locator('[data-fk="list-r4-end"]').press('Enter');
  await page.waitForTimeout(50);
  check('終了が開始より前を警告', (await page.locator('#repList').innerText()).includes('終了時刻が開始時刻より前'));

  await page.click('#repCheck button >> nth=0');
  check('確認欄の「入力」で該当記録の顧客欄へ移動', await page.evaluate(() => document.activeElement.dataset.fk === 'list-r4-cust'));
  // コピー
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.click('#repCopy');
  await page.waitForTimeout(100);
  check('コピー後に完了表示', (await page.textContent('#repCopyStatus')).includes('コピーしました'));

  // ---------------------------------------------------------------
  console.log('5. 作業名の変更と合算');
  await setState(st);
  await goSetting(page, 'buttons');
  await page.fill('[data-fk="cat-name-cat1"]', '電話・問合せ');
  await page.locator('[data-fk="cat-name-cat1"]').press('Tab');
  await page.waitForTimeout(50);
  const s5 = await getState();
  s5.records.push({ id: 'new1', start: await base(17, 0), end: await base(17, 30), type: 'work', categoryId: 'cat1', customer: '', project: '', memo: '' });
  await setState(s5);
  await page.click('.tab[data-screen="report"]');
  const t5 = await page.inputValue('#repText');
  check('過去の記録も新しい名前で表示', t5.includes('09:00-09:25 電話・問合せ') && !t5.includes('電話対応'));
  check('新旧の記録が合算される（25+12+30=67分→1.1h）', t5.includes('電話・問合せ 1.1h'), t5.split('\n').pop());

  // 削除した作業は削除時の名前で残る
  await goSetting(page, 'buttons');
  await page.click('[data-fk="cat-del-cat5"]');
  await dlgClick('削除する');
  check('削除した作業は選択肢から外れる', !(await gridNamesOn(page, '#previewGrid')).includes('顧客訪問'));
  await page.click('.tab[data-screen="report"]');
  check('削除した作業は日報に削除時の名前で残る', (await page.inputValue('#repText')).includes('14:12-15:30 顧客訪問（B社）'));

  // ---------------------------------------------------------------
  console.log('6. 並び替えと数字キー');
  await page.evaluate((k) => localStorage.removeItem(k), KEY);
  await page.reload();
  const s6 = await getState();
  const now = Date.now();
  // 30日以内: 会議3回、その他2回、資料作成2回 / 31日前: 電話対応5回
  const mk = (cat, ago, i) => ({ id: `u${i}`, start: now - ago - 600000, end: now - ago, type: 'work', categoryId: cat, customer: '', project: '', memo: '' });
  s6.records = [mk('cat4', 1e6, 1), mk('cat4', 2e6, 2), mk('cat4', 3e6, 3), mk('cat6', 4e6, 4), mk('cat6', 5e6, 5), mk('cat2', 6e6, 6), mk('cat2', 7e6, 7)]
    .concat([1, 2, 3, 4, 5].map((i) => mk('cat1', 31 * 864e5 + i * 1e6, 10 + i)));
  await setState(s6);
  await goSetting(page, 'buttons');
  const usage = await page.$$eval('#catList .cat-usage', (n) => n.map((x) => x.textContent));
  check('過去30日の使用回数を表示', usage.join(',') === '30日：0回,30日：2回,30日：0回,30日：3回,30日：0回,30日：2回', usage.join(','));
  await page.click('[data-fk="cat-up-cat3"]');
  check('↑ボタンでプレビューに即反映', (await gridNamesOn(page, '#previewGrid')).slice(0, 3).join(',') === '電話対応,プログラム修正,資料作成');
  check('↑ボタン後もフォーカスが同じ作業に残る', await page.evaluate(() => document.activeElement.dataset.fk === 'cat-up-cat3'));
  await page.click('#catSortUsage');
  const sorted = await gridNamesOn(page, '#previewGrid');
  check('よく使う順（同数は現在の順を保つ）', sorted.join(',') === '会議,資料作成,その他,電話対応,プログラム修正,顧客訪問', sorted.join(','));
  await page.click('.tab[data-screen="record"]');
  check('記録画面の並びに反映', (await gridNames()).join(',') === sorted.join(','));
  await page.keyboard.press('3');
  let s6b = await getState();
  check('数字キー3で3番目（その他）を開始', s6b.records.at(-1).categoryId === 'cat6' && s6b.records.at(-1).end === null);

  // ---------------------------------------------------------------
  console.log('7. 8個と9個のボタン表示');
  await goSetting(page, 'buttons');
  for (const n of ['経理', '移動']) { await page.fill('#catAddName', n); await page.press('#catAddName', 'Enter'); }
  await page.click('.tab[data-screen="record"]');
  let names = await gridNames();
  check('8個のときはすべてボタン表示', names.length === 8 && !names.some((x) => x.includes('他の作業')), names.join(','));
  await goSetting(page, 'buttons');
  await page.fill('#catAddName', '研修');
  await page.press('#catAddName', 'Enter');
  check('9個のとき区切りを表示', (await page.locator('#catList .cat-sep').count()) === 1 &&
    (await page.$$eval('#catList > li', (n) => n.map((x) => x.className))).indexOf('cat-sep') === 7);
  const keys = await page.$$eval('#catList .cat-key', (n) => n.map((x) => x.textContent));
  check('「他の作業」内はキー番号の代わりに—', keys.join(',') === '1,2,3,4,5,6,7,—,—', keys.join(','));
  await page.screenshot({ path: path.join(SHOT_DIR, 'settings-360.png'), fullPage: true });
  await page.click('.tab[data-screen="record"]');
  names = await gridNames();
  check('9個のとき先頭7個＋他の作業', names.length === 8 && names[7].includes('他の作業'), names.join(','));
  await page.keyboard.press('8');
  s6b = await getState();
  check('数字キー8は割り当てなし', s6b.records.at(-1).categoryId === 'cat6');
  await page.click('#otherBtn');
  const otherItems = await page.$$eval('#otherList button', (n) => n.map((x) => x.textContent));
  check('他の作業リストに残り2個', otherItems.join(',') === '移動,研修', otherItems.join(','));
  await page.click('#otherList button >> text=研修');
  s6b = await getState();
  check('他の作業リストから開始できる', categoryName(s6b, s6b.records.at(-1).categoryId) === '研修');
  check('他の作業ボタンに実行中を表示', (await page.locator('#otherBtn').innerText()).includes('実行中：研修'));
  await page.screenshot({ path: path.join(SHOT_DIR, 'record-360-9buttons.png'), fullPage: true });
  await goSetting(page, 'buttons');
  const runDel = await page.locator('[data-fk="cat-del-' + s6b.records.at(-1).categoryId + '"]').isDisabled();
  check('実行中の作業は削除できない', runDel);

  // ---------------------------------------------------------------
  console.log('8. 顧客・案件のコンボボックス');
  await page.evaluate((k) => localStorage.removeItem(k), KEY);
  await page.reload();
  await goSetting(page, 'master');
  for (const n of ['A社', 'B社', 'Cコーポ']) { await page.fill('#custAddName', n); await page.press('#custAddName', 'Enter'); }
  await page.click('[data-fk^="cust-sel-"] >> text=A社');
  for (const n of ['保守サポート', '新規提案']) { await page.fill('#projAddName', n); await page.press('#projAddName', 'Enter'); }
  await page.click('[data-fk^="cust-sel-"] >> text=B社');
  await page.fill('#projAddName', '定例会議');
  await page.press('#projAddName', 'Enter');
  // 使用回数：B社 を多めに
  const s8 = await getState();
  const bId = s8.customers.find((c) => c.name === 'B社').id;
  s8.records = [1, 2].map((i) => ({ id: `b${i}`, start: Date.now() - i * 1e6 - 1e5, end: Date.now() - i * 1e6, type: 'work', categoryId: 'cat1', customer: 'B社', project: '定例会議', memo: '' }));
  s8.records.push({ id: 'n1', start: Date.now() - 9e6, end: Date.now() - 8e6, type: 'work', categoryId: 'cat1', customer: 'えーしゃ', project: '保守', memo: '' });
  s8.records.push({ id: 'n2', start: Date.now() - 7e6, end: Date.now() - 6.5e6, type: 'work', categoryId: 'cat1', customer: 'えーしゃ', project: '', memo: '' });
  await setState(s8);
  await page.click('.tab[data-screen="record"]');
  await page.click('#workGrid .work-btn >> nth=0');
  await page.click('#recCustomer');
  check('フォーカスで候補表示・使用回数順', (await comboOptions('recCustomer')).join(',') === 'B社,A社,Cコーポ', (await comboOptions('recCustomer')).join(','));
  await page.fill('#recCustomer', 'c');
  check('部分一致・大文字小文字を区別しない', (await comboOptions('recCustomer'))[0] === 'Cコーポ');
  await page.fill('#recCustomer', 'a');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  check('↑↓とEnterで確定', (await page.inputValue('#recCustomer')) === 'A社');
  await page.click('#recProject');
  check('顧客の案件に絞る', (await comboOptions('recProject')).join(',') === '保守サポート,新規提案', (await comboOptions('recProject')).join(','));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  check('案件の確定', (await page.inputValue('#recProject')) === '保守サポート');
  await page.click('#recCustomer');
  await page.fill('#recCustomer', 'B社');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  check('顧客を選び直すと他顧客の案件は空になる', (await page.inputValue('#recProject')) === '');
  await page.fill('#recCustomer', '');
  await page.press('#recCustomer', 'Enter');
  await page.click('#recProject');
  const allProj = await comboOptions('recProject');
  check('顧客未選択時は全案件を顧客名付きで表示', allProj.includes('定例会議（B社）') && allProj.includes('新規提案（A社）'), allProj.join(','));
  await page.fill('#recProject', '新規');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  check('案件を選ぶと顧客も自動で入る', (await page.inputValue('#recCustomer')) === 'A社' && (await page.inputValue('#recProject')) === '新規提案');
  let s8b = await getState();
  check('実行中の記録に保存される', s8b.records.at(-1).customer === 'A社' && s8b.records.at(-1).project === '新規提案');
  await page.click('#recCustomer');
  await page.fill('#recCustomer', 'D商事');
  const ex = await comboOptions('recCustomer');
  check('マスタにない名前で手入力・登録の選択肢', ex.join(',') === '『D商事』を手入力のまま使う,『D商事』をマスタに登録して使う', ex.join(','));
  await page.keyboard.press('Escape');
  check('Escで候補を閉じる', await page.locator('#recCustomer-list').isHidden());
  await page.keyboard.press('Enter');
  s8b = await getState();
  check('Enterで手入力のまま確定（マスタ未登録）', s8b.records.at(-1).customer === 'D商事' && !s8b.customers.some((c) => c.name === 'D商事'));
  await page.click('#recProject');
  await page.fill('#recProject', '');
  check('未登録顧客では案件の候補を出さない', (await comboOptions('recProject')).length === 0);
  await page.fill('#recProject', '新システム');
  const pex = await comboOptions('recProject');
  check('未登録顧客でも案件を手入力・登録できる', pex.length === 2, pex.join(','));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  s8b = await getState();
  const dc = s8b.customers.find((c) => c.name === 'D商事');
  check('案件登録時に顧客も同時登録', !!dc && s8b.projects.some((p) => p.customerId === dc.id && p.name === '新システム'));
  await page.fill('#recMemo', 'メモ');
  await page.click('#recCustomer');
  await page.fill('#recCustomer', 'E社');
  await page.click('#recMemo'); // フォーカスを外す
  s8b = await getState();
  check('フォーカスが外れたら手入力のまま確定', s8b.records.at(-1).customer === 'E社');
  // 非表示
  await goSetting(page, 'master');
  await page.click(`[data-fk="cust-hide-${s8b.customers.find((c) => c.name === 'Cコーポ').id}"]`);
  await page.click('.tab[data-screen="record"]');
  await page.fill('#recCustomer', '');
  await page.press('#recCustomer', 'Tab');
  await page.click('#recCustomer');
  check('非表示の顧客は候補に出ない', !(await comboOptions('recCustomer')).includes('Cコーポ'));
  await page.screenshot({ path: path.join(SHOT_DIR, 'record-360-combo.png'), fullPage: true });
  await page.keyboard.press('Escape');

  // ---------------------------------------------------------------
  console.log('9. 手入力名の統合とマスタ名の変更');
  await page.click('.tab[data-screen="menu"]');
  check('設定メニューに手入力の件数を表示', /^手入力 \d+件$/.test(await page.textContent('#menuManualBadge')));
  await page.screenshot({ path: path.join(SHOT_DIR, 'menu-360.png'), fullPage: true });
  await goSetting(page, 'master');
  const manual = await page.locator('#manualCustList').innerText();
  check('手入力された顧客名を使用回数付きで表示', manual.includes('えーしゃ') && manual.includes('2件'), manual);
  await page.click('[data-fk="mc-merge-えーしゃ"]');
  await page.selectOption('#mergeTarget', { label: 'A社' });
  await dlgClick('次へ');
  const msg = await page.textContent('#dialogMessage');
  check('実行前に対象件数を表示', msg.includes('2件'), msg);
  await dlgClick('2件を書き換える');
  s8b = await getState();
  check('統合で過去の記録が更新される', s8b.records.filter((r) => r.customer === 'A社' && (r.id === 'n1' || r.id === 'n2')).length === 2);
  const mp = await page.locator('#manualProjList').innerText();
  check('手入力された案件名（統合後の顧客で判定）', mp.includes('保守（A社）'), mp);
  await page.click('[data-fk="mp-merge-a社-保守"]');
  await page.selectOption('#mergeTarget', { label: 'A社／保守サポート' });
  await dlgClick('次へ');
  await dlgClick('1件を書き換える');
  s8b = await getState();
  check('案件の統合で過去の記録が更新される', s8b.records.find((r) => r.id === 'n1').project === '保守サポート');
  // マスタ名の編集を記録に反映
  const bc = s8b.customers.find((c) => c.name === 'B社');
  await page.click(`[data-fk="cust-edit-${bc.id}"]`);
  await page.fill('#dialogContent input', 'B社（新）');
  await dlgClick('保存');
  await dlgClick('記録2件にも反映');
  s8b = await getState();
  check('マスタ名の変更を過去の記録に反映', s8b.records.filter((r) => r.customer === 'B社（新）').length === 2);
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.screenshot({ path: path.join(SHOT_DIR, 'master-1200.png'), fullPage: true });
  await page.setViewportSize({ width: 360, height: 900 });
  await page.click('#screen-master .back-btn');
  check('「‹ 設定」で設定メニューに戻る', await page.locator('#screen-menu').isVisible());

  // ---------------------------------------------------------------
  console.log('10. マスタCSV（UTF-8 / Shift_JIS）');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sgk-'));
  const sjisPath = path.join(tmp, 'master_sjis.csv');
  const { execFileSync } = require('child_process');
  execFileSync('python3', ['-c', `open(${JSON.stringify(sjisPath)},'wb').write('顧客名,案件名\\r\\nＦ株式会社,"保守,運用"\\r\\nＦ株式会社,\\r\\nA社,保守サポート\\r\\nA社,新案件\\r\\n,孤立案件\\r\\n'.encode('shift_jis'))`]);
  await goSetting(page, 'master');
  await page.setInputFiles('#masterImport', sjisPath);
  await page.waitForSelector('#dialog[open]');
  const res = await page.textContent('#dialogMessage');
  await dlgClick('OK');
  console.log(`      ${res.replace(/\n/g, ' / ')}`);
  check('Shift_JISの取り込み結果', res.includes('顧客 1件、案件 2件') && res.includes('重複のため取り込まなかった行：2件') && res.includes('顧客名がない行：1件') && res.includes('Shift_JIS'));
  s8b = await getState();
  const fc = s8b.customers.find((c) => c.name === 'Ｆ株式会社');
  check('引用符内のカンマを含む案件名', !!fc && s8b.projects.some((p) => p.customerId === fc.id && p.name === '保守,運用'));
  const utfPath = path.join(tmp, 'master_utf8.csv');
  fs.writeFileSync(utfPath, '\uFEFF顧客名,案件名\nＧ社,"改行\nあり"\nＦ株式会社,"保守,運用"\n');
  await page.setInputFiles('#masterImport', utfPath);
  await page.waitForSelector('#dialog[open]');
  const res2 = await page.textContent('#dialogMessage');
  await dlgClick('OK');
  check('UTF-8（BOM付き）の取り込みと重複除外', res2.includes('顧客 1件、案件 1件') && res2.includes('取り込まなかった行：1件') && res2.includes('UTF-8'), res2);
  const [dlm] = await Promise.all([page.waitForEvent('download'), page.click('#masterExport')]);
  const mcsv = fs.readFileSync(await dlm.path(), 'utf8');
  check('マスタCSV書き出し（BOM・エスケープ）', mcsv.startsWith('\uFEFF顧客名,案件名') && mcsv.includes('Ｆ株式会社,"保守,運用"') && mcsv.includes('Ｇ社,"改行\nあり"'));

  // ---------------------------------------------------------------
  console.log('11. 記録CSVとJSONバックアップ');
  const s11 = await getState();
  s11.records.push({ id: 'csv1', start: await base(8, 0), end: await base(8, 30), type: 'work', categoryId: 'cat2', customer: 'A社', project: '新規提案', memo: 'カンマ,と"引用符"と\n改行' });
  await setState(s11);
  await goSetting(page, 'export');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#csvDay')]);
  const buf = fs.readFileSync(await dl.path());
  check('CSVはBOM付きUTF-8', buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF);
  const csv = buf.toString('utf8');
  check('CSVの列', csv.slice(1).startsWith('日付,開始,終了,分,カテゴリ,顧客,案件,メモ\r\n'));
  const parsed = await page.evaluate((t) => parseCsv(t.replace(/^\uFEFF/, '')), csv);
  const row = parsed.find((r) => r[1] === '08:00');
  check('カンマ・引用符・改行を正しくエスケープ', row && row[7] === 'カンマ,と"引用符"と\n改行' && row[3] === '30', JSON.stringify(row));
  await page.fill('#csvFrom', await page.evaluate((k) => shiftKey(k, -40), today));
  await page.fill('#csvTo', today);
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#csvRange')]);
  check('期間指定のCSV書き出し', dl2.suggestedFilename().includes('-') && (await page.textContent('#dataStatus')).includes('件の記録'), `${dl2.suggestedFilename()} / ${await page.textContent('#dataStatus')}`);

  const [dj] = await Promise.all([page.waitForEvent('download'), page.click('#jsonBackup')]);
  const jsonPath = await dj.path();
  const backup = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  check('JSONにバージョン番号', backup.version === 3);
  // データを壊してから復元
  await page.evaluate((k) => localStorage.removeItem(k), KEY);
  await page.reload();
  await goSetting(page, 'export');
  const badPath = path.join(tmp, 'bad.json');
  fs.writeFileSync(badPath, JSON.stringify({ version: 1, categories: [], records: 'x' }));
  await page.setInputFiles('#jsonRestore', badPath);
  await page.waitForSelector('#dialog[open]');
  check('不正なJSONは検証で拒否', (await page.textContent('#dialogTitle')) === '復元できません');
  await dlgClick('OK');
  const jp = path.join(tmp, 'backup.json');
  fs.copyFileSync(jsonPath, jp);
  await page.setInputFiles('#jsonRestore', jp);
  await page.waitForSelector('#dialog[open]');
  check('復元前に上書き確認（件数表示）', (await page.textContent('#dialogMessage')).includes(`記録：${backup.records.length}件`));
  await dlgClick('上書きして復元');
  const s11b = await getState();
  check('JSONバックアップを復元', s11b.records.length === backup.records.length && s11b.records.find((r) => r.id === 'csv1').memo === 'カンマ,と"引用符"と\n改行' && s11b.customers.length === backup.customers.length);

  // ---------------------------------------------------------------
  console.log('12. 前日以前の計測中の作業');
  const s12 = await getState();
  for (const r of s12.records) if (r.end == null) r.end = r.start + 60000;
  const y = await page.evaluate((k) => shiftKey(k, -1), today);
  const ys = await page.evaluate((k) => combine(k, '17:00'), y);
  s12.records.push({ id: 'stale', start: ys, end: null, type: 'work', categoryId: 'cat2', customer: '', project: '', memo: '' });
  await setState(s12);
  await page.waitForSelector('#dialog[open]');
  check('起動時に終了時刻の入力を求める', (await page.textContent('#dialogTitle')).includes('計測中'));
  await page.keyboard.press('Escape');
  check('Escでは閉じない', await page.locator('#dialog[open]').count() === 1);
  await page.fill('#staleEnd', `${y}T16:00`);
  await dlgClick('この時刻で終了');
  check('開始より前の時刻はエラー', await page.locator('#dialogError').isVisible());
  await page.fill('#staleEnd', `${y}T18:30`);
  await dlgClick('この時刻で終了');
  const s12b = await getState();
  check('入力した時刻で終了', s12b.records.find((r) => r.id === 'stale').end === await page.evaluate((k) => combine(k, '18:30'), y));

  // ---------------------------------------------------------------
  console.log('13. 業務終了・保存エラー');
  await page.click('.tab[data-screen="record"]');
  await page.click('#workGrid .work-btn >> nth=0');
  await page.click('#recEnd');
  const s13 = await getState();
  check('業務終了で作業が終了し日報画面へ', s13.records.every((r) => r.end != null) && await page.locator('#screen-report').isVisible());
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); }; });
  await page.click('.tab[data-screen="record"]');
  await page.click('#workGrid .work-btn >> nth=1');
  check('保存できない場合は画面にエラー表示', await page.locator('#storageError').isVisible());

  // 広い画面のスクリーンショット
  await page.reload();
  await setState(st);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.click('.tab[data-screen="report"]');
  await page.screenshot({ path: path.join(SHOT_DIR, 'report-1280.png'), fullPage: true });
  await goSetting(page, 'buttons');
  await page.screenshot({ path: path.join(SHOT_DIR, 'settings-1280.png'), fullPage: true });
  await page.setViewportSize({ width: 360, height: 900 });
  await page.click('.tab[data-screen="record"]');
  await page.click('#workGrid .work-btn >> nth=1');
  await page.screenshot({ path: path.join(SHOT_DIR, 'record-360.png'), fullPage: true });

  // ---------------------------------------------------------------
  console.log('14. データファイルへの自動保存');
  // ファイル選択ダイアログは自動操作できないため、実ファイルを読み書きする代替ハンドルを使う
  const fsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgk-fs-'));
  const fpath = (n) => path.join(fsDir, n);
  const readF = (n) => JSON.parse(fs.readFileSync(fpath(n), 'utf8'));
  const ctx2 = await browser.newContext({ viewport: { width: 360, height: 900 }, locale: 'ja-JP' });
  await ctx2.exposeFunction('__fsRead', (n) => (fs.existsSync(fpath(n)) ? fs.readFileSync(fpath(n), 'utf8') : ''));
  await ctx2.exposeFunction('__fsWrite', (n, t) => fs.writeFileSync(fpath(n), t));
  await ctx2.addInitScript(() => {
    class FakeHandle {
      constructor(n) { this.name = n; this.kind = 'file'; }
      async queryPermission() { return localStorage.getItem('__fakePerm') || 'granted'; }
      async requestPermission() {
        // ファイル選択に時間がかかって Chrome が確認を出せなかった状態を再現
        if (localStorage.getItem('__fakeNoActivation')) { localStorage.removeItem('__fakeNoActivation'); throw new DOMException('User activation is required to request permissions.', 'SecurityError'); }
        if (localStorage.getItem('__fakeDeny')) return 'denied';
        localStorage.removeItem('__fakePerm');
        return 'granted';
      }
      async getFile() { const t = await window.__fsRead(this.name); return { text: async () => t }; }
      async createWritable() {
        let buf = '';
        const n = this.name;
        return { write: async (d) => { buf += d; }, close: async () => { await window.__fsWrite(n, buf); } };
      }
    }
    const next = () => localStorage.getItem('__nextFile') || 'data.json';
    window.showSaveFilePicker = async () => new FakeHandle(next());
    window.showOpenFilePicker = async () => [new FakeHandle(next())];
    window.sagyoHandleStore = {
      get: async () => { const n = localStorage.getItem('__fakeHandle'); return n ? new FakeHandle(n) : null; },
      set: async (h) => localStorage.setItem('__fakeHandle', h.name),
      del: async () => localStorage.removeItem('__fakeHandle'),
    };
  });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push(e.message));
  const st2 = () => p2.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  const bar = () => p2.textContent('#fileBar');
  const fileDesc = () => p2.textContent('#menuFileDesc');
  const waitSaved = () => p2.waitForFunction(() => document.querySelector('#recSaved').textContent.includes('自動保存済み'));
  await p2.goto(URL);
  check('未設定のときは案内を表示', (await bar()).includes('データファイル未設定'));
  await p2.click('[data-fk="bar-create"]');
  await waitSaved();
  check('データファイルを作成して保存', fs.existsSync(fpath('data.json')) && readF('data.json').version === 3 && (await fileDesc()) === 'data.json に自動保存中' && (await p2.locator('#fileBar').isHidden()));
  await p2.click('#workGrid .work-btn >> nth=0');
  await p2.fill('#recMemo', 'ファイル保存');
  await p2.waitForTimeout(600);
  let fd = readF('data.json');
  check('操作がデータファイルに自動保存される', fd.records.length === 1 && fd.records[0].end === null && fd.records[0].memo === 'ファイル保存');
  await p2.reload();
  await waitSaved();
  check('再読み込み後も自動で再接続し計測を継続', (await p2.textContent('#recCurrentName')).includes('電話対応') && (await p2.inputValue('#recMemo')) === 'ファイル保存');
  await p2.evaluate(() => localStorage.setItem('__fakePerm', 'prompt'));
  await p2.reload();
  await p2.waitForTimeout(200);
  check('許可が切れていると再接続を求める', (await bar()).includes('再接続が必要'));
  await p2.click('[data-fk="bar-reconnect"]');
  await waitSaved();
  check('再接続ボタンで接続', true);
  // ファイルの方が新しい場合はファイルに合わせる
  fd = readF('data.json');
  fd.records.unshift({ id: 'fileonly', start: fd.records[0].start - 3600000, end: fd.records[0].start - 1800000, type: 'work', categoryId: 'cat2', customer: '', project: '', memo: '別PCで追加' });
  fd.savedAt = Date.now() + 1000;
  fs.writeFileSync(fpath('data.json'), JSON.stringify(fd));
  await p2.reload();
  await waitSaved();
  check('ファイルの方が新しければファイルの内容を使う', (await st2()).records.some((r) => r.id === 'fileonly'));
  // ブラウザ内の方が新しい場合（前回ファイルに書けなかった変更）はファイルへ書き込む
  await p2.evaluate((k) => {
    const d = JSON.parse(localStorage.getItem(k));
    d.records[0].memo = '未保存の変更';
    d.savedAt = Date.now() + 5000;
    localStorage.setItem(k, JSON.stringify(d));
  }, KEY);
  await p2.reload();
  await p2.waitForTimeout(500);
  check('ブラウザ内の方が新しければファイルへ書き込む', readF('data.json').records.find((r) => r.id === 'fileonly').memo === '未保存の変更');
  // 画面に戻ったとき、ほかの端末（Android）で更新されたファイルを読み込む
  fd = readF('data.json');
  fd.records.push({ id: 'phone1', start: Date.now() - 600000, end: Date.now() - 300000, type: 'work', categoryId: 'cat4', customer: '', project: '', memo: 'スマホで記録' });
  fd.savedAt = Date.now() + 60000;
  fs.writeFileSync(fpath('data.json'), JSON.stringify(fd));
  await p2.evaluate(() => window.dispatchEvent(new Event('focus')));
  await p2.waitForTimeout(300);
  check('画面に戻ると、ほかの端末で更新された内容を読み込む', (await st2()).records.some((r) => r.id === 'phone1'));
  // 既存のファイルを開く
  const other = JSON.parse(fs.readFileSync(fpath('data.json'), 'utf8'));
  other.records = [{ id: 'other1', start: Date.now() - 7200000, end: Date.now() - 3600000, type: 'work', categoryId: 'cat4', customer: 'Z社', project: '', memo: '' }];
  other.savedAt = 1;
  fs.writeFileSync(fpath('other.json'), JSON.stringify(other));
  fs.writeFileSync(fpath('bad.json'), 'これはJSONではない');
  await goSetting(p2, 'file');
  await p2.evaluate(() => localStorage.setItem('__nextFile', 'bad.json'));
  await p2.click('#fileOpen');
  await p2.waitForSelector('#dialog[open]');
  check('不正なファイルは開かない', (await p2.textContent('#dialogTitle')) === '開けません' && fs.readFileSync(fpath('bad.json'), 'utf8') === 'これはJSONではない');
  await p2.click('#dialog[open] #dialogButtons button >> text=OK');
  // 許可を拒否された場合
  await p2.evaluate(() => { localStorage.setItem('__nextFile', 'other.json'); localStorage.setItem('__fakePerm', 'prompt'); localStorage.setItem('__fakeDeny', '1'); });
  await p2.click('#fileOpen');
  await p2.waitForSelector('#dialog[open]');
  check('確認が時間切れなら「許可する」ボタンを出す', (await p2.textContent('#dialogTitle')) === '保存の許可');
  await p2.click('#dialog[open] #dialogButtons button >> text=許可する');
  await p2.waitForFunction(() => document.querySelector('#dialogTitle').textContent === '保存の許可が得られませんでした');
  check('拒否されたときは許可の方法を案内する', (await p2.textContent('#dialogMessage')).includes('サイトの設定'));
  await p2.click('#dialog[open] #dialogButtons button >> text=閉じる');
  // 時間切れのあと「許可する」で接続できる場合
  await p2.evaluate(() => { localStorage.removeItem('__fakeDeny'); localStorage.setItem('__fakeNoActivation', '1'); });
  await p2.click('#fileOpen');
  await p2.waitForSelector('#dialog[open]');
  check('時間切れのとき「保存の許可」を表示', (await p2.textContent('#dialogTitle')) === '保存の許可');
  await p2.click('#dialog[open] #dialogButtons button >> text=許可する');
  await p2.waitForFunction(() => document.querySelector('#dialogTitle').textContent === 'データファイルを開く');
  check('開く前に置き換えを確認', (await p2.textContent('#dialogMessage')).includes('記録 1件'));
  await p2.click('#dialog[open] #dialogButtons button >> text=ファイルの内容で置き換える');
  await p2.waitForTimeout(100);
  check('既存のファイルを開いて切り替え', (await st2()).records.length === 1 && (await fileDesc()).includes('other.json'));
  await p2.click('.tab[data-screen="record"]');
  await p2.click('#workGrid .work-btn >> nth=2');
  await p2.waitForTimeout(600);
  check('切り替えたファイルに保存される', readF('other.json').records.length === 2);
  await goSetting(p2, 'file');
  await p2.click('#fileDisconnect');
  await p2.click('#dialog[open] #dialogButtons button >> text=接続を解除');
  await p2.waitForTimeout(100);
  const before = fs.readFileSync(fpath('other.json'), 'utf8');
  await p2.click('.tab[data-screen="record"]');
  await p2.click('#workGrid .work-btn >> nth=3');
  await p2.waitForTimeout(600);
  check('接続を解除するとファイルに書かない', (await bar()).includes('未設定') && fs.readFileSync(fpath('other.json'), 'utf8') === before);
  await p2.screenshot({ path: path.join(SHOT_DIR, 'record-360-file.png') });
  await ctx2.close();

  // ---------------------------------------------------------------
  console.log('15. Android（ファイルへ直接保存できないブラウザ）');
  const ctx3 = await browser.newContext({ viewport: { width: 360, height: 800 }, locale: 'ja-JP', acceptDownloads: true });
  const sharedFiles = [];
  await ctx3.exposeFunction('__shared', (name, text) => { sharedFiles.push({ name, text }); });
  await ctx3.addInitScript(() => {
    delete window.showSaveFilePicker;
    delete window.showOpenFilePicker;
    // Chrome と同じく、.json は共有できない（.txt はできる）
    navigator.canShare = (d) => !!(d && d.files && d.files.length && d.files.every((f) => /\.txt$/i.test(f.name) && f.type.startsWith('text/plain')));
    navigator.share = async (d) => { for (const f of d.files) await window.__shared(f.name, await f.text()); };
  });
  const p3 = await ctx3.newPage();
  p3.on('pageerror', (e) => errors.push(e.message));
  const st3 = () => p3.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  await p3.goto(URL);
  check('手動モードの案内を表示', (await p3.textContent('#fileBar')).includes('共有して保存') && await p3.locator('#fileBar').isVisible());
  await p3.click('#workGrid .work-btn >> nth=1');
  check('未共有の変更を表示', (await p3.textContent('#recSaved')).includes('未共有'));
  await p3.click('#recEnd');
  await p3.waitForSelector('#dialog[open]');
  check('業務終了時に OneDrive への保存を案内', (await p3.textContent('#dialogTitle')) === 'OneDrive への保存');
  await p3.click('#dialog[open] #dialogButtons button >> text=共有して保存');
  await p3.waitForTimeout(200);
  check('共有でデータファイルを渡す', sharedFiles.length === 1 && sharedFiles[0].name === '作業記録データ.txt' && JSON.parse(sharedFiles[0].text).records.length === 1);
  check('共有後は案内を隠し「保存済み」表示', await p3.locator('#fileBar').isHidden() && (await p3.textContent('#recSaved')) === '📱 端末に保存済み');
  // パソコンで更新されたファイルを読み込む
  const pc = JSON.parse(sharedFiles[0].text);
  pc.records.push({ id: 'pc1', start: Date.now() - 900000, end: Date.now() - 800000, type: 'work', categoryId: 'cat2', customer: 'A社', project: '', memo: 'PCで記録' });
  pc.savedAt = Date.now() + 1000;
  const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), 'sgk-and-'));
  const pcPath = path.join(tmp3, '作業記録データ.json'); // 以前の .json も読み込める
  fs.writeFileSync(pcPath, JSON.stringify(pc));
  await goSetting(p3, 'file');
  check('設定画面に読み込み・共有のボタン', await p3.locator('#fileManual').isVisible() && await p3.locator('#fileAuto').isHidden());
  await p3.setInputFiles('#manualLoadInput', pcPath);
  await p3.waitForSelector('#dialog[open]');
  check('読み込み前に置き換えを確認', (await p3.textContent('#dialogMessage')).includes('記録 2件'));
  await p3.click('#dialog[open] #dialogButtons button >> text=ファイルの内容で置き換える');
  await p3.waitForTimeout(100);
  check('データファイルを読み込める', (await st3()).records.some((r) => r.id === 'pc1'));
  // 端末側が新しいまま古いファイルを読み込もうとすると警告
  await p3.click('.tab[data-screen="record"]');
  await p3.click('#workGrid .work-btn >> nth=3');
  const old = JSON.parse(sharedFiles[0].text);
  old.savedAt = 1;
  fs.writeFileSync(pcPath, JSON.stringify(old));
  await goSetting(p3, 'file');
  await p3.setInputFiles('#manualLoadInput', pcPath);
  await p3.waitForSelector('#dialog[open]');
  check('読み込んだ .json の名前でも .txt として共有する', await p3.evaluate(() => manualFileName()) === '作業記録データ.txt');
  check('端末の方が新しいときは警告する', (await p3.textContent('#dialogMessage')).includes('この端末のデータ'));
  await p3.click('#dialog[open] #dialogButtons button >> text=キャンセル');
  check('キャンセルすると端末のデータを残す', (await st3()).records.length === 3);
  // 共有に対応していないときはダウンロード
  // 共有に対応していないブラウザを再現（再読み込みせずにその場で外す）
  await p3.evaluate(() => { delete navigator.share; delete navigator.canShare; });
  await goSetting(p3, 'file');
  const [dl3] = await Promise.all([p3.waitForEvent('download'), p3.click('#manualShare')]);
  check('共有できないブラウザではダウンロードする', dl3.suggestedFilename() === '作業記録データ.txt');
  check('ダウンロードになった理由と次の手順を表示', (await p3.textContent('#manualStatus')).includes('アップロード'));
  await p3.screenshot({ path: path.join(SHOT_DIR, 'android-file.png'), fullPage: true });
  await ctx3.close();

  // ---------------------------------------------------------------
  console.log('16. Web上での表示（ホーム画面への追加・オフライン）');
  const { spawn } = require('child_process');
  const port = 8765 + Math.floor(Math.random() * 1000);
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: path.resolve(__dirname, '..'), stdio: 'ignore' });
  try {
    const base = `http://127.0.0.1:${port}/`;
    for (let i = 0; i < 50; i++) { try { await fetch(base); break; } catch (_) { await new Promise((r) => setTimeout(r, 100)); } }
    const ctx4 = await browser.newContext({ viewport: { width: 360, height: 800 }, locale: 'ja-JP' });
    const p4 = await ctx4.newPage();
    p4.on('pageerror', (e) => errors.push(e.message));
    await p4.goto(`${base}index.html`);
    await p4.evaluate(() => navigator.serviceWorker.ready);
    const man = await p4.evaluate(async () => {
      const href = document.querySelector('link[rel=manifest]').href;
      const m = await (await fetch(href)).json();
      const icons = await Promise.all(m.icons.map(async (i) => (await fetch(new URL(i.src, href))).ok));
      return { name: m.name, display: m.display, icons };
    });
    check('マニフェストとアイコンを読み込める', man.name === '作業記録' && man.display === 'standalone' && man.icons.every(Boolean), JSON.stringify(man));
    await p4.reload(); // サービスワーカーの管理下で読み込み直す
    await p4.click('#workGrid .work-btn >> nth=0');
    await ctx4.setOffline(true);
    await p4.reload();
    check('オフラインでも開ける', (await p4.locator('#workGrid .work-btn').count()) === 6 && (await p4.textContent('#recCurrentName')).includes('電話対応'));
    await ctx4.close();
  } finally {
    server.kill();
  }
  // ---------------------------------------------------------------
  console.log('17. Android の Chrome（ファイル選択の機能がある場合）');
  const ctx5 = await browser.newContext({
    viewport: { width: 360, height: 800 }, locale: 'ja-JP',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36',
  });
  const p5 = await ctx5.newPage();
  await p5.goto(URL);
  const hasPicker = await p5.evaluate(() => typeof window.showOpenFilePicker === 'function');
  await goSetting(p5, 'file');
  check('Android ではファイル選択の機能があっても手動モードにする', hasPicker && await p5.locator('#fileManual').isVisible() && await p5.locator('#fileAuto').isHidden());
  await ctx5.close();
  // ---------------------------------------------------------------
  console.log('18. やること（今日・これから・お知らせ）');
  const ctx6 = await browser.newContext({ viewport: { width: 360, height: 900 }, locale: 'ja-JP' });
  await ctx6.addInitScript(() => {
    window.__notes = [];
    class FakeNotification {
      constructor(title, opt) { window.__notes.push({ title, body: opt && opt.body }); }
      static requestPermission() { return Promise.resolve('granted'); }
    }
    FakeNotification.permission = 'granted';
    window.Notification = FakeNotification;
  });
  const p6 = await ctx6.newPage();
  p6.on('pageerror', (e) => errors.push(e.message));
  const st6 = () => p6.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  const set6 = async (fn, arg) => { await p6.evaluate(([f, a]) => { new Function('a', f)(a); save(); renderAll(); }, [fn, arg]); };
  await p6.goto(URL);
  // 古い版（version 2）のデータを読み込む
  const v2 = { version: 2, categories: [{ id: 'cat1', name: '電話対応' }, { id: 'cat2', name: '資料作成' }, { id: 'cat3', name: '会議' }], customers: [{ id: 'c1', name: 'A社' }], projects: [{ id: 'p1', customerId: 'c1', name: '新規提案' }], records: [], savedAt: 1 };
  await p6.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [KEY, v2]);
  await p6.reload();
  let t6 = await st6();
  check('version 2 のデータを version 3 に変換', t6.version === 3 && Array.isArray(t6.todos) && t6.settings.prevDayTime === '17:00');
  check('やることが無いときはタブに件数を出さない', await p6.locator('#todoBadge').isHidden());
  // 今日のやることを追加
  await p6.click('.tab[data-screen="todo"]');
  await p6.fill('#todoQuickTitle', '議事録の清書');
  await p6.press('#todoQuickTitle', 'Enter');
  await p6.fill('#todoQuickTitle', 'A社へ見積書を送付');
  await p6.click('#todoQuickForm button[type=submit]');
  t6 = await st6();
  check('1行で今日のやることを追加', t6.todos.length === 2 && t6.todos.every((t) => t.date === today));
  check('タブに未完了の件数を表示', (await p6.textContent('#todoBadge')) === '2');
  check('今日の一覧に表示', (await p6.locator('#todoList .todo-row').count()) === 2);
  // 記録画面の「次のやること」から開始
  await p6.click('.tab[data-screen="record"]');
  check('記録画面に次のやることを表示', (await p6.textContent('#nextTodo')).includes('議事録の清書'));
  await p6.click('[data-fk="next-start"]');
  await p6.waitForSelector('#dialog[open]');
  await p6.selectOption('#chooseCat', 'cat2');
  await p6.click('#dialog[open] #dialogButtons button >> text=開始');
  t6 = await st6();
  const runRec = t6.records.find((r) => r.end === null);
  const todo1 = t6.todos.find((t) => t.title === '議事録の清書');
  check('▶ 開始で作業の計測を始める（やることの内容をメモに入れる）', runRec && runRec.todoId === todo1.id && runRec.categoryId === 'cat2' && runRec.memo === '議事録の清書');
  check('選んだカテゴリをやることに覚える', todo1.categoryId === 'cat2');
  check('次のやることは計測中以外を表示', (await p6.textContent('#nextTodo')).includes('A社へ見積書を送付'));
  await p6.click('.tab[data-screen="todo"]');
  check('一覧で計測中と表示', (await p6.textContent(`[data-fk="todo-play-${todo1.id}"]`)) === '計測中');
  // 完了にする
  await p6.click(`[data-fk="todo-chk-${todo1.id}"]`);
  check('チェックで完了・件数が減る', (await st6()).todos.find((t) => t.id === todo1.id).done && (await p6.textContent('#todoBadge')) === '1');
  await p6.click('[data-fk="todo-fold"]');
  check('完了したものを表示できる', (await p6.locator('#todoList .todo-row.is-done').count()) === 1);

  // これから（未来のやること）
  await p6.click('[data-fk="todo-view-future"]');
  const tomorrow = await p6.evaluate(() => shiftKey(todayKey(), 1));
  check('これからの追加先は明日', (await p6.textContent('#todoQuickDate')).includes('明日'));
  await p6.fill('#todoQuickTitle', '会議資料の印刷');
  await p6.press('#todoQuickTitle', 'Enter');
  t6 = await st6();
  check('これからで追加すると明日のやること', t6.todos.find((t) => t.title === '会議資料の印刷').date === tomorrow);
  check('週の帯に件数を表示', (await p6.textContent(`[data-fk="cal-${tomorrow}"] .c`)) === '1');
  check('今日の件数は今日の分だけ', (await p6.textContent('#todoBadge')) === '1');
  // 月のカレンダー
  await p6.click('[data-fk="cal-mode-month"]');
  const later = await p6.evaluate(() => shiftKey(todayKey(), 3));
  check('月のカレンダーを表示', (await p6.locator('#todoCal .cal-wd').count()) === 7 && (await p6.locator('#todoCal .cal-day').count()) >= 28);
  if (later.slice(0, 7) !== today.slice(0, 7)) await p6.click('[data-fk="cal-next"]');
  await p6.click(`[data-fk="cal-${later}"]`);
  check('日付を選ぶとその日の一覧', (await p6.textContent('#todoList')).includes('のやることはありません'));
  await p6.fill('#todoQuickTitle', '請求書の発行');
  await p6.press('#todoQuickTitle', 'Enter');
  check('選んだ日に追加', (await st6()).todos.find((t) => t.title === '請求書の発行').date === later);
  // 詳しく設定（日付・時刻・お知らせ・優先・開始で使う内容）
  await p6.fill('#todoQuickTitle', 'B社 訪問');
  await p6.click('#todoDetailBtn');
  check('詳しく設定の画面を開く', (await p6.inputValue('#teTitle')) === 'B社 訪問' && (await p6.inputValue('#teDate')) === later);
  check('時刻がないと時刻系のお知らせは選べない', await p6.locator('[data-fk="te-notify-60"]').isDisabled());
  await p6.click('[data-fk="te-chip-明日"]');
  await p6.fill('#teTime', '13:00');
  await p6.click('[data-fk="te-notify-60"]');
  await p6.click('[data-fk="te-notify-prev"]');
  await p6.click('[data-fk="te-pri-true"]');
  await p6.selectOption('#teCat', 'cat1');
  await p6.fill('#teCust', 'A社');
  await p6.press('#teCust', 'Enter');
  await p6.fill('#teMemo', '持ち物：提案資料');
  await p6.click('#teSave');
  t6 = await st6();
  const visit = t6.todos.find((t) => t.title === 'B社 訪問');
  check('詳しい設定で保存', visit && visit.date === tomorrow && visit.time === '13:00' && visit.priority && visit.notify.includes('60') && visit.notify.includes('prev') && visit.categoryId === 'cat1' && visit.customer === 'A社' && visit.memo === '持ち物：提案資料', JSON.stringify(visit));
  check('保存後は「これから」に戻る', await p6.locator('#screen-todo').isVisible() && (await p6.getAttribute('[data-fk="todo-view-future"]', 'aria-pressed')) === 'true');
  // 前日のお知らせ時刻を設定で変える
  await goSetting(p6, 'notify');
  await p6.fill('#setPrevTime', '16:00');
  await p6.locator('#setPrevTime').press('Tab');
  const prevAt = await p6.evaluate((id) => noticeTimes(todoById(id)).find((n) => n.key === 'prev').at, visit.id);
  check('前日のお知らせ時刻を設定で変えられる', prevAt === await p6.evaluate(() => combine(todayKey(), '16:00')));
  check('設定メニューに「やること・お知らせ」', (await st6()).settings.prevDayTime === '16:00');

  // お知らせ
  await p6.click('.tab[data-screen="record"]');
  await set6(`const t0 = Date.now() + 3 * 60000; state.todos.push({ id: 'al1', title: 'B社へ折り返し電話', date: dateKey(t0), time: fmtHM(t0), priority: false, notify: ['5'], categoryId: 'cat1', customer: 'B社', project: '', memo: '', done: false, doneAt: null, createdAt: Date.now(), carriedFrom: null, notified: [], snoozeAt: null });`);
  await p6.evaluate(() => checkTodoAlerts());
  check('時刻になると画面にお知らせ', (await p6.textContent('#alertArea')).includes('まもなく「B社へ折り返し電話」'));
  check('端末の通知も出す', (await p6.evaluate(() => window.__notes.map((n) => n.title))).some((t) => t.includes('B社へ折り返し電話')));
  await p6.evaluate(() => checkTodoAlerts());
  const callAlert = p6.locator('#alertArea .alert-item', { hasText: 'B社へ折り返し電話' });
  check('同じお知らせは繰り返さない', (await p6.evaluate(() => window.__notes.filter((n) => n.title.includes('B社へ折り返し電話')).length)) === 1 && (await callAlert.count()) === 1);
  await callAlert.locator('button', { hasText: '10分後' }).click();
  check('10分後で閉じる', (await callAlert.count()) === 0 && (await st6()).todos.find((t) => t.id === 'al1').snoozeAt > Date.now());
  await p6.evaluate(() => checkTodoAlerts(Date.now() + 11 * 60000));
  check('10分後にもう一度お知らせ', (await callAlert.count()) === 1);
  await callAlert.locator('button', { hasText: '▶ 開始' }).click();
  check('お知らせから作業を開始', (await st6()).records.find((r) => r.end === null).todoId === 'al1');
  await p6.screenshot({ path: path.join(SHOT_DIR, 'todo-record.png'), fullPage: true });

  // 期限切れ・持ち越し・朝のまとめ
  await set6(`const y = shiftKey(todayKey(), -1); state.todos.push({ id: 'old1', title: '請求書の確認', date: y, time: '', priority: false, notify: [], categoryId: null, customer: 'B社', project: '', memo: '', done: false, doneAt: null, createdAt: 1, carriedFrom: null, notified: [], snoozeAt: null }); const od = Date.now() - 2 * 3600000; if (dateKey(od) === todayKey()) state.todos.push({ id: 'od1', title: '期限切れのテスト', date: dateKey(od), time: fmtHM(od), priority: false, notify: [], categoryId: null, customer: '', project: '', memo: '', done: false, doneAt: null, createdAt: 2, carriedFrom: null, notified: [], snoozeAt: null });`);
  await p6.click('.tab[data-screen="todo"]');
  await p6.click('[data-fk="todo-view-today"]');
  const listText = await p6.textContent('#todoList');
  check('過去の未完了は「持ち越し」に表示', listText.includes('持ち越し') && listText.includes('請求書の確認'));
  const hasOd = (await st6()).todos.some((t) => t.id === 'od1');
  check('時刻を過ぎたものは期限切れと表示', !hasOd || listText.includes('期限切れ（2時間過ぎ）'), listText);
  await p6.evaluate(() => localStorage.removeItem('sagyokanri:ui'));
  await p6.click('.tab[data-screen="record"]');
  check('その日に初めて開いたとき今日のやることをまとめて表示', (await p6.textContent('#morningBox')).includes('今日のやること'));
  await p6.click('[data-fk="morning-close"]');
  check('閉じると今日は出さない', (await p6.textContent('#morningBox')) === '');
  await p6.screenshot({ path: path.join(SHOT_DIR, 'todo-record2.png'), fullPage: true });
  await p6.click('.tab[data-screen="todo"]');
  await p6.screenshot({ path: path.join(SHOT_DIR, 'todo-today.png'), fullPage: true });

  // 業務終了時の確認
  await p6.click('.tab[data-screen="record"]');
  await p6.click('#recEnd');
  await p6.waitForSelector('#dialog[open]');
  check('業務終了時に未完了と明日の予定を表示', (await p6.textContent('#dialogTitle')) === '業務終了の前に' && (await p6.textContent('#dialogContent')).includes('明日') && (await p6.textContent('#dialogContent')).includes('B社 訪問'));
  const pend = (await st6()).todos.filter((t) => !t.done && t.date <= today);
  const quote = pend.find((t) => t.title === 'A社へ見積書を送付');
  const oldT = pend.find((t) => t.id === 'old1');
  await p6.click(`[data-fk="end-${quote.id}-done"]`);
  await p6.click(`[data-fk="end-${oldT.id}-pick"]`);
  const pickDate = await p6.evaluate(() => shiftKey(todayKey(), 5));
  await p6.fill(`#dialogContent input[type=date]:not([hidden])`, pickDate);
  await p6.screenshot({ path: path.join(SHOT_DIR, 'todo-end.png'), fullPage: true });
  await p6.click('#dialog[open] #dialogButtons button >> text=業務終了');
  t6 = await st6();
  check('「完了」を選ぶと完了', t6.todos.find((t) => t.id === quote.id).done);
  check('「日付を選ぶ」で別の日へ移す', t6.todos.find((t) => t.id === 'old1').date === pickDate);
  check('ほかは明日へ持ち越し', t6.todos.filter((t) => ['al1', 'od1'].includes(t.id)).every((t) => t.date === tomorrow && t.carriedFrom));
  check('確認のあと業務終了', t6.records.every((r) => r.end !== null) && await p6.locator('#screen-report').isVisible());
  await goSetting(p6, 'notify');
  await p6.screenshot({ path: path.join(SHOT_DIR, 'todo-settings.png'), fullPage: true });
  await p6.click('.tab[data-screen="todo"]');
  await p6.click('[data-fk="todo-view-future"]');
  await p6.screenshot({ path: path.join(SHOT_DIR, 'todo-future.png'), fullPage: true });
  await ctx6.close();
  // ---------------------------------------------------------------
  console.log('19. 顧客・案件別の合計');
  const ctx7 = await browser.newContext({ viewport: { width: 360, height: 900 }, locale: 'ja-JP', acceptDownloads: true });
  await ctx7.grantPermissions(['clipboard-read', 'clipboard-write']);
  const p7 = await ctx7.newPage();
  p7.on('pageerror', (e) => errors.push(e.message));
  await p7.goto(URL);
  const st7 = () => p7.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  const d7 = await st7();
  check('集計のしかたの初期値（15分・四捨五入・顧客＋案件）', d7.settings.agg.unit === 15 && d7.settings.agg.rounding === 'round' && d7.settings.agg.groupBy === 'cp' && d7.settings.agg.inReport === true);
  const at7 = (hm) => p7.evaluate(([k, t]) => combine(k, t), [today, hm]);
  d7.records = [];
  const r7 = async (id, sh, eh, cat, cu = '', pr = '', type = 'work') => d7.records.push({ id, start: await at7(sh), end: await at7(eh), type, categoryId: type === 'break' ? null : cat, customer: cu, project: pr, memo: '', todoId: null });
  await r7('a1', '09:00', '09:25', 'cat1', 'A社', '保守サポート');
  await r7('a2', '09:25', '11:15', 'cat2', 'A社', '新規提案');
  await r7('a3', '11:15', '11:30', 'cat1', 'A社', '新規提案');
  await r7('a4', '11:30', '12:30', null, '', '', 'break');
  await r7('a5', '13:00', '14:00', 'cat4', '社内', '定例会議');
  await r7('a6', '14:00', '14:12', 'cat1');
  await r7('a7', '14:12', '15:30', 'cat5', 'B社', '');
  await p7.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [KEY, d7]);
  await p7.reload();
  await p7.click('.tab[data-screen="report"]');
  const aggRows = () => p7.$$eval('#aggTable tbody tr:not(.agg-sub):not(.agg-total)', (trs) => trs.map((tr) => [tr.cells[0].textContent, tr.cells[1].textContent]));
  let rows7 = await aggRows();
  check('顧客・案件ごとに合計（長い順・なしは最後）', JSON.stringify(rows7) === JSON.stringify([['A社／新規提案', '2.00h'], ['B社／（案件なし）', '1.25h'], ['社内／定例会議', '1.00h'], ['A社／保守サポート', '0.50h'], ['⚠ 顧客・案件なし', '0.25h']]), JSON.stringify(rows7));
  check('休憩は含まない', !(await p7.textContent('#aggTable')).includes('休憩'));
  check('合計と実際の合計', (await p7.textContent('#aggTable .agg-total')).includes('5.00h') && (await p7.textContent('#aggDiff')).includes('5時間0分') && (await p7.textContent('#aggDiff')).includes('差 0分'));
  check('丸め方を表示', (await p7.textContent('#aggRule')) === '15分単位・四捨五入');
  check('作業の内訳を表示', (await p7.textContent('#aggTable .agg-sub')).includes('資料作成 1:50') && (await p7.textContent('#aggTable .agg-sub')).includes('電話対応 0:15'));
  // コピー
  await p7.click('#aggTable tbody tr >> nth=0 >> button');
  check('行のコピーは時間の数値だけ', (await p7.evaluate(() => navigator.clipboard.readText())) === '2.00');
  check('コピー済と表示', (await p7.textContent('#aggTable tbody tr >> nth=0 >> button')) === '✓ コピー済');
  await p7.click('#aggCopy');
  const tsv = await p7.evaluate(() => navigator.clipboard.readText());
  check('表のコピーはタブ区切り（顧客・案件・時間）', tsv === 'A社\t新規提案\t2.00\r\nB社\t\t1.25\r\n社内\t定例会議\t1.00\r\nA社\t保守サポート\t0.50\r\n\t\t0.25\r\n', JSON.stringify(tsv));
  // 日報テキスト
  const txt7 = await p7.inputValue('#repText');
  check('日報テキストに顧客・案件別の合計', txt7.includes('■顧客・案件別\nA社／新規提案　2.00h\nB社　1.25h\n社内／定例会議　1.00h\nA社／保守サポート　0.50h\n（顧客・案件なし）　0.25h\n合計　5.00h'), txt7);
  check('これまでの合計の行は変わらない', txt7.includes('合計 5.0h：資料作成 1.8h／顧客訪問 1.3h／会議 1.0h／電話対応 0.9h'));
  // 顧客・案件なしの記録へ入力
  await p7.click('#aggTable tr.is-empty button');
  check('「入力」でその記録の顧客欄へ', await p7.evaluate(() => document.activeElement.dataset.fk === 'list-a6-cust'));
  await p7.screenshot({ path: path.join(SHOT_DIR, 'agg-report.png'), fullPage: true });

  // 設定の変更
  await goSetting(p7, 'agg');
  await p7.screenshot({ path: path.join(SHOT_DIR, 'agg-settings.png'), fullPage: true });
  await p7.click('[data-fk="agg-set-aggUnit-30"]');
  await p7.click('.tab[data-screen="report"]');
  rows7 = await aggRows();
  check('0.5h単位・合計を丸める', rows7[0][1] === '2.0h' && rows7[1][1] === '1.5h', JSON.stringify(rows7));
  await goSetting(p7, 'agg');
  await p7.click('[data-fk="agg-set-aggRoundPer-record"]');
  await p7.click('.tab[data-screen="report"]');
  check('記録1件ごとに丸める（110分→2.0h・15分→0.5h で 2.5h）', (await aggRows())[0][1] === '2.5h');
  await goSetting(p7, 'agg');
  await p7.click('[data-fk="agg-set-aggRoundPer-group"]');
  await p7.click('[data-fk="agg-set-aggUnit-10"]');
  await p7.click('[data-fk="agg-set-aggRounding-floor"]');
  await p7.click('[data-fk="agg-set-aggFormat-hm"]');
  await p7.click('.tab[data-screen="report"]');
  rows7 = await aggRows();
  check('10分単位・切り捨て・2:15形式', rows7[0][1] === '2:00' && rows7[1][1] === '1:10' && (await p7.textContent('#aggRule')) === '10分単位・切り捨て', JSON.stringify(rows7));
  await goSetting(p7, 'agg');
  await p7.click('[data-fk="agg-set-aggUnit-15"]');
  await p7.click('[data-fk="agg-set-aggRounding-round"]');
  await p7.click('[data-fk="agg-set-aggFormat-hours"]');
  await p7.click('[data-fk="agg-set-aggGroupBy-cpc"]');
  await p7.click('.tab[data-screen="report"]');
  rows7 = await aggRows();
  check('顧客＋案件＋作業でまとめる', rows7.length === 6 && rows7.some((r) => r[0] === 'A社／新規提案（資料作成）'), JSON.stringify(rows7));
  await p7.click('#aggCopy');
  check('作業ありの表は4列', (await p7.evaluate(() => navigator.clipboard.readText())).split('\r\n')[0].split('\t').length === 4);
  await goSetting(p7, 'agg');
  await p7.click('[data-fk="agg-set-aggGroupBy-cp"]');
  await p7.uncheck('#aggInReport');
  await p7.click('.tab[data-screen="report"]');
  check('日報テキストに入れない設定', !(await p7.inputValue('#repText')).includes('■顧客・案件別'));
  // 期間のCSV
  await goSetting(p7, 'export');
  await p7.fill('#aggFrom', today);
  await p7.fill('#aggTo', today);
  const [dl7] = await Promise.all([p7.waitForEvent('download'), p7.click('#aggCsv')]);
  const csv7 = fs.readFileSync(await dl7.path(), 'utf8');
  check('顧客・案件別のCSV（日ごと）', csv7.startsWith('﻿日付,顧客,案件,時間,分\r\n') && csv7.includes(`${today},A社,新規提案,2.00,125`), csv7);
  await p7.click('#aggModeTotal');
  const [dl7b] = await Promise.all([p7.waitForEvent('download'), p7.click('#aggCsv')]);
  const csv7b = fs.readFileSync(await dl7b.path(), 'utf8');
  check('顧客・案件別のCSV（期間の合計）', csv7b.startsWith('﻿顧客,案件,時間,分\r\n') && csv7b.includes('B社,,1.25,78'), csv7b);
  await ctx7.close();
  // ---------------------------------------------------------------
  console.log('20. 日報システム用の Excel（ひな形に書き込む）');
  const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgk-xl-'));
  const tplPath = path.join(tdir, 'work_data_template.xlsx');
  // 受け取ったサンプルと同じ形のひな形を作る（work_data・コード一覧（非表示）・勤務時間）
  execFileSync('python3', ['-I', '-c', `
import sys, openpyxl
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.styles import Font, PatternFill
import datetime
wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'work_data'
heads = ['顧客コード','顧客名(選択)','業務コード','業務名(選択)','工程区分','作業工程','作業時間','移動時間','備考']
for i, h in enumerate(heads, 1):
    c = ws.cell(1, i, h); c.font = Font(bold=True); c.fill = PatternFill('solid', fgColor='DDEEDD')
ws.append([2070, 'サンプル商事', 1058, '販売管理システム（2026保守）', 9, 80, datetime.time(2, 0), None, '見本の行'])
for r in range(2, 32):
    if r > 2:
        ws.cell(r, 1, f'=IFERROR(INDEX(コード一覧!$B:$B,MATCH(B{r},コード一覧!$D:$D,0)),"")')
        ws.cell(r, 3, f'=IFERROR(INDEX(コード一覧!$C:$C,MATCH(B{r}&"|"&D{r},コード一覧!$A:$A,0)),"")')
    ws.cell(r, 7).number_format = 'h:mm'; ws.cell(r, 8).number_format = 'h:mm'
ws.freeze_panes = 'A2'
dv1 = DataValidation(type='list', formula1='=コード一覧!$G$2:$G$5', allow_blank=True); dv1.add('B2:B31'); ws.add_data_validation(dv1)
dv2 = DataValidation(type='list', formula1='=OFFSET(コード一覧!$E$1,MATCH($B2,コード一覧!$D:$D,0)-1,0,COUNTIF(コード一覧!$D:$D,$B2),1)', allow_blank=True); dv2.add('D2:D31'); ws.add_data_validation(dv2)
cs = wb.create_sheet('コード一覧'); cs.sheet_state = 'hidden'
cs.append(['結合キー','顧客コード','業務コード','顧客名','業務名',None,'顧客名一覧'])
rows = [('その他（社内）','社内業務支援（2026）',99999,1371),('サンプル商事','在庫システム改修',2070,1102),('サンプル商事','販売管理システム（2026保守）',2070,1058),('ダミー物流','配送管理（2026保守）',4200,2105),('テスト工業','生産管理システム構築',3100,2001)]
names = ['その他（社内）','サンプル商事','ダミー物流','テスト工業']
for i, (cn, pn, cc, pc) in enumerate(rows):
    cs.append([cn + '|' + pn, cc, pc, cn, pn, None, names[i] if i < len(names) else None])
kt = wb.create_sheet('勤務時間'); kt.append(['項目','値']); kt.append(['開始時間', datetime.time(8, 30)]); kt.append(['活動日', '2026/11/04'])
wb.save(sys.argv[1])
`, tplPath]);
  const ctx8 = await browser.newContext({ viewport: { width: 360, height: 900 }, locale: 'ja-JP', acceptDownloads: true });
  const p8 = await ctx8.newPage();
  p8.on('pageerror', (e) => errors.push(e.message));
  await p8.goto(URL);
  const st8 = () => p8.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  // ひな形を設定し、コード一覧を顧客・案件に登録
  await goSetting(p8, 'agg');
  await p8.setInputFiles('#tplInput', tplPath);
  await p8.waitForSelector('#dialog[open]');
  check('ひな形のコード一覧の件数を表示', (await p8.textContent('#dialogMessage')).includes('5 件'));
  await p8.click('#dialog[open] #dialogButtons button >> text=登録する');
  await p8.waitForTimeout(100);
  let d8 = await st8();
  const sc = d8.customers.find((c) => c.name === 'サンプル商事');
  check('コード一覧を顧客・案件に登録（コード付き）', d8.customers.length === 4 && sc && sc.code === '2070' && d8.projects.find((x) => x.name === '在庫システム改修').code === '1102');
  check('ひな形の設定を表示', (await p8.textContent('#tplInfo')).includes('work_data_template.xlsx'));
  // 作業ボタンに工程を設定（1件は画面から）
  await goSetting(p8, 'buttons');
  await p8.click('[data-fk="cat-code-cat1"]');
  await p8.fill('#codeKubun', '9');
  await p8.fill('#codeSagyo', '80');
  await p8.click('#dialog[open] #dialogButtons button >> text=保存');
  check('作業ボタンに工程区分・作業工程を設定', (await p8.textContent('[data-fk="cat-code-cat1"]')) === '工程 9-80');
  await p8.fill('#catAddName', '移動');
  await p8.press('#catAddName', 'Enter');
  d8 = await st8();
  const mv = d8.categories.find((c) => c.name === '移動');
  check('「移動」の作業は移動時間として扱う', mv && mv.travel === true);
  const set = (id, k, sgy) => { const c = d8.categories.find((x) => x.id === id); c.kubun = k; c.sagyo = sgy; };
  set('cat2', '1', '11'); set('cat3', '3', '20'); set('cat4', '1', '10'); set(mv.id, '9', '90');
  const at8 = (hm) => p8.evaluate(([k, t]) => combine(k, t), [today, hm]);
  const rec8 = async (id, s1, e1, cat, cu, pr, memo) => ({ id, start: await at8(s1), end: await at8(e1), type: 'work', categoryId: cat, customer: cu, project: pr, memo, todoId: null });
  d8.records = [
    await rec8('x1', '09:00', '10:00', 'cat1', 'サンプル商事', '販売管理システム（2026保守）', '問合せ対応'),
    await rec8('x2', '10:00', '10:58', 'cat1', 'サンプル商事', '販売管理システム（2026保守）', '問合せ対応'),
    await rec8('x3', '11:00', '13:25', 'cat3', 'サンプル商事', '在庫システム改修', ''),
    await rec8('x4', '13:30', '14:30', mv.id, 'テスト工業', '生産管理システム構築', ''),
    await rec8('x5', '14:30', '16:00', 'cat4', 'テスト工業', '生産管理システム構築', '定例会議'),
    await rec8('x6', '16:00', '17:00', 'cat2', '', '', '週報作成'),
    await rec8('x7', '17:00', '17:30', 'cat1', 'Z社', '', '新規の問合せ\n折り返し'),
    { id: 'x8', start: await at8('12:00'), end: await at8('13:00'), type: 'break', categoryId: null, customer: '', project: '', memo: '', todoId: null },
  ];
  await p8.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [KEY, d8]);
  await p8.reload();
  await p8.click('.tab[data-screen="report"]');
  await p8.click('#sysExport');
  await p8.waitForSelector('#dialog[open]');
  const warn8 = await p8.textContent('#dialogMessage');
  check('コード一覧にない顧客を確認', warn8.includes('Z社'));
  const [dl8] = await Promise.all([p8.waitForEvent('download'), p8.click('#dialog[open] #dialogButtons button >> text=このまま書き出す')]);
  check('ファイル名は work_data＋日付', dl8.suggestedFilename() === `work_data${today.replace(/-/g, '')}.xlsx`, dl8.suggestedFilename());
  const outPath = path.join(tdir, 'out.xlsx');
  await dl8.saveAs(outPath);
  const res8 = JSON.parse(execFileSync('python3', ['-I', '-c', `
import sys, json, openpyxl
wb = openpyxl.load_workbook(sys.argv[1])
ws = wb['work_data']
def v(c):
    x = c.value
    if hasattr(x, 'hour'): return f'{x.hour}:{x.minute:02d}'
    return x
rows = [[v(ws.cell(r, c)) for c in range(1, 10)] for r in range(2, 9)]
print(json.dumps({
  'sheets': wb.sheetnames, 'hidden': wb['コード一覧'].sheet_state, 'rows': rows,
  'fmt': ws['G2'].number_format, 'fmtH': ws['H4'].number_format,
  'a10': ws['A10'].value, 'c10': ws['C10'].value,
  'dv': [str(d.sqref) for d in ws.data_validations.dataValidation],
  'kintai': wb['勤務時間']['B3'].value, 'head': [ws.cell(1, c).value for c in range(1, 10)],
}, ensure_ascii=False, default=str))
`, outPath]).toString());
  console.log(`      ${JSON.stringify(res8.rows)}`);
  const R = res8.rows;
  check('ひな形のシート・見出しを保つ', res8.sheets.join(',') === 'work_data,コード一覧,勤務時間' && res8.hidden === 'hidden' && res8.head[1] === '顧客名(選択)');
  check('1行目：顧客＋業務＋工程で合計（15分単位で丸め、メモは備考）', JSON.stringify(R[0]) === JSON.stringify([2070, 'サンプル商事', 1058, '販売管理システム（2026保守）', 9, 80, '2:00', null, '問合せ対応']), JSON.stringify(R[0]));
  check('同じ顧客の別の業務は別の行（2:25→2:30）', JSON.stringify(R[1]) === JSON.stringify([2070, 'サンプル商事', 1102, '在庫システム改修', 3, 20, '2:30', null, null]), JSON.stringify(R[1]));
  check('移動時間は同じ顧客・業務の行に入る', JSON.stringify(R[2]) === JSON.stringify([3100, 'テスト工業', 2001, '生産管理システム構築', 1, 10, '1:30', '1:00', '定例会議']), JSON.stringify(R[2]));
  check('コード一覧にない顧客はコードを式で引く', typeof R[3][0] === 'string' && R[3][0].startsWith('=IFERROR') && R[3][1] === 'Z社' && R[3][6] === '0:30' && R[3][8] === '新規の問合せ 折り返し', JSON.stringify(R[3]));
  check('顧客・業務なしの行は最後', JSON.stringify(R[4]) === JSON.stringify([null, null, null, null, 1, 11, '1:00', null, '週報作成']) || (String(R[4][0]).startsWith('=IFERROR') && R[4][1] === null && R[4][4] === 1 && R[4][6] === '1:00' && R[4][8] === '週報作成'), JSON.stringify(R[4]));
  check('休憩は書き出さない・見本の行は消える', R[5][1] == null && R[5][6] == null && !JSON.stringify(R).includes('見本の行'));
  check('時間の書式（h:mm）を保つ', res8.fmt === 'h:mm' && res8.fmtH === 'h:mm', `${res8.fmt} ${res8.fmtH}`);
  check('使わない行の式を保つ', String(res8.a10).startsWith('=IFERROR(INDEX(コード一覧!$B:$B,MATCH(B10,') && String(res8.c10).includes('B10&"|"&D10'));
  check('選択リストを保つ', res8.dv.includes('B2:B31') && res8.dv.includes('D2:D31'), res8.dv.join(','));
  check('勤務時間シートはそのまま', res8.kintai === '2026/11/04');
  // 30分単位にすると丸めが変わる
  await goSetting(p8, 'agg');
  await p8.click('[data-fk="agg-set-aggUnit-30"]');
  const rows8 = await p8.evaluate(() => buildSystemRows(reportDate, []).rows.map((r) => r.workMin));
  check('時間の単位の設定がExcelにも効く（30分単位）', JSON.stringify(rows8) === JSON.stringify([120, 150, 90, 30, 60]), JSON.stringify(rows8));
  await p8.screenshot({ path: path.join(SHOT_DIR, 'sys-settings.png'), fullPage: true });
  await goSetting(p8, 'buttons');
  await p8.screenshot({ path: path.join(SHOT_DIR, 'sys-buttons.png'), fullPage: true });
  await ctx8.close();
  check('index.html 以外のファイルを読み込んでいない', otherFiles.size === 0, [...otherFiles].join(', '));
  check('ページでJavaScriptエラーが発生していない', errors.length === 0, errors.join(' | '));
  console.log(`\n結果: ${passed} 件成功 / ${failed} 件失敗（スクリーンショット: ${SHOT_DIR}）`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

async function goSetting(page, name) {
  await page.click('.tab[data-screen="menu"]');
  await page.click(`.menu-item[data-go="${name}"]`);
}
function gridNamesOn(page, sel) {
  return page.$$eval(`${sel} .work-btn .work-name`, (n) => n.map((x) => x.textContent));
}
function categoryName(s, id) {
  const c = s.categories.find((x) => x.id === id);
  return c ? c.name : null;
}
