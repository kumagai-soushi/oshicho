(() => {
'use strict';

const CFG = window.OSHI_CONFIG || {};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const okUrl = u => /^https?:\/\//i.test(String(u || ''));
const MEDIA = ['漫画', 'アニメ', '映画', 'ドラマ', '小説', 'ゲーム', '音楽', 'その他'];
const WD = '日月火水木金土';
const REFRESH_MS = 30000;

// localStorage は使えない環境もあるので必ず try/catch
const store = {
  get: k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: k => { try { localStorage.removeItem(k); } catch {} },
};

let pass = store.get('oshi.pass');
let nick = store.get('oshi.nick');
let works = [], marks = [], meta = {}, loaded = false, lastJson = '';
let filter = 'すべて', sort = 'new', editing = null, armed = null;
let busy = 0, chain = Promise.resolve();

$('#f-media').innerHTML = MEDIA.map(m => `<option>${m}</option>`).join('');

const toast = t => {
  const e = $('#toast'); e.textContent = t; e.classList.add('show');
  clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove('show'), 2200);
};
const openSheet = id => $(id).classList.add('open');
const closeSheets = () => document.querySelectorAll('.sheet').forEach(s => s.classList.remove('open'));

// ---------------------------------------------------------
// Supabase RPC（supabase-js を使わず fetch で直接呼ぶ）
// ---------------------------------------------------------
class BadPass extends Error {}

async function rpc(fn, args = {}, p = pass) {
  const res = await fetch(`${CFG.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: CFG.SUPABASE_ANON_KEY },
    body: JSON.stringify({ pass: p, ...args }),
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    if (body && body.code === '28P01') throw new BadPass();
    throw new Error((body && body.message) || `HTTP ${res.status}`);
  }
  return body;
}

// 書き込みは1本ずつ順番に。終わったら読み直す。
function write(fn, args, msg) {
  busy++;
  const p = chain.then(async () => {
    try { await rpc(fn, args); if (msg) toast(msg); return true; }
    catch (e) {
      if (e instanceof BadPass) lock('合言葉が変わったようです。もう一度入れてください。');
      else toast('保存できませんでした');
      return false;
    } finally { busy--; }
  });
  chain = p.then(() => { if (!busy) return load(true); });
  return p;
}

async function load(force) {
  if (!pass || (busy && !force)) return;
  try {
    const d = await rpc('oshi_get');
    const json = JSON.stringify(d);
    // 変化なしなら描き直さない（短冊が毎回揺れないように）。書き込み後は必ず描き直す
    if (!force && loaded && json === lastJson) return;
    lastJson = json;
    works = d.works || []; marks = d.marks || []; meta = d.meta || {};
    loaded = true; render();
  } catch (e) {
    if (e instanceof BadPass) lock('合言葉が変わったようです。もう一度入れてください。');
    else if (!loaded) $('#hw').innerHTML = '<div class="empty">データにつながりません。通信を確認して、もう一度開いてください。</div>';
  }
}

// ---------------------------------------------------------
// 入口（合言葉 → 呼び名）
// ---------------------------------------------------------
function showGate(step, err) {
  $('#gate').hidden = false;
  $('#g-pass').hidden = step !== 'pass';
  $('#g-nick').hidden = step !== 'nick';
  $('#g-pass-in').required = step === 'pass';
  $('#g-nick-in').required = step === 'nick';
  $('#g-btn').textContent = step === 'pass' ? '入る' : 'はじめる';
  $('#g-err').textContent = err || '';
  $('#fab').hidden = true;
  setTimeout(() => (step === 'pass' ? $('#g-pass-in') : $('#g-nick-in')).focus(), 50);
}

function lock(msg) {
  pass = ''; store.del('oshi.pass');
  works = []; marks = []; meta = {}; loaded = false; lastJson = '';
  closeSheets();
  showGate('pass', msg);
}

function enter() {
  if (!pass) return showGate('pass');
  if (!nick) return showGate('nick');
  $('#gate').hidden = true;
  $('#fab').hidden = $('#p-oshi').hidden;
  load();
}

$('#gateForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!$('#g-pass').hidden) {
    const p = $('#g-pass-in').value;
    if (!p) return;
    const btn = $('#g-btn'); btn.disabled = true; $('#g-err').textContent = '';
    try {
      await rpc('oshi_get', {}, p);
      pass = p; store.set('oshi.pass', p); $('#g-pass-in').value = '';
      enter();
    } catch (err) {
      $('#g-err').textContent = err instanceof BadPass ? '合言葉が違います。' : 'つながりませんでした。通信を確認してください。';
    } finally { btn.disabled = false; }
  } else {
    const n = $('#g-nick-in').value.trim();
    if (!n) return;
    nick = n; store.set('oshi.nick', n);
    enter();
  }
});

// ---------------------------------------------------------
// 描画
// ---------------------------------------------------------
const marksOf = id => marks.filter(m => m.work_id === id);
const readers = w => marksOf(w.id).filter(m => m.read).map(m => m.nick);
const hitters = w => marksOf(w.id).filter(m => m.hit).map(m => m.nick);
const mine = id => marks.find(m => m.work_id === id && m.nick === nick) || { read: false, hit: false };
const names = a => a.length ? '（' + a.map(esc).join('、') + '）' : '';

function card(w, big) {
  const r = readers(w), h = hitters(w), my = mine(w.id);
  return `<article class="card${big ? ' big' : ''}">
    <div class="ttl">${esc(w.title)}</div>
    <div class="meta"><span class="chip">${esc(w.media || 'その他')}</span>${w.by_name ? `<span>推し：${esc(w.by_name)}</span>` : ''}${w.entry ? `<span class="entry">${esc(w.entry)}</span>` : ''}</div>
    ${w.note ? `<p class="note">${esc(w.note)}</p>` : ''}
    ${okUrl(w.link) ? `<a class="link" href="${esc(w.link)}" target="_blank" rel="noopener">読める・観られる場所 ↗</a>` : ''}
    <div class="who">読んだ ${r.length}人${names(r)}／刺さった ${h.length}人${names(h)}</div>
    <div class="acts">
      <button class="btn${my.read ? ' on' : ''}" data-act="read" data-id="${w.id}">${my.read ? '読んだ ✓' : '読んだ'}</button>
      <button class="btn hit${my.hit ? ' on' : ''}" data-act="hit" data-id="${w.id}">刺さった</button>
      <button class="btn sm" data-act="hw" data-id="${w.id}">${w.homework ? '宿題から外す' : '宿題にする'}</button>
      <button class="btn sm" data-act="edit" data-id="${w.id}">編集</button>
      <button class="btn sm${armed === w.id ? ' warn' : ''}" data-act="del" data-id="${w.id}">${armed === w.id ? '本当に削除' : '削除'}</button>
    </div></article>`;
}

function renderHeader() {
  if (meta.date && /^\d{4}-\d{2}-\d{2}$/.test(meta.date)) {
    const [y, m, dd] = meta.date.split('-').map(Number);
    $('#next').textContent = `次回：${m}月${dd}日(${WD[new Date(y, m - 1, dd).getDay()]})${meta.place ? '　' + meta.place : ''}`;
    const n = Math.ceil((new Date(meta.date + 'T00:00:00+09:00') - Date.now()) / 864e5);
    $('#days').textContent = n > 0 ? `あと${n}日` : n === 0 ? '今日！' : '';
  } else {
    $('#next').textContent = '次回：未定' + (meta.place ? '　' + meta.place : '');
    $('#days').textContent = '';
  }
}

function render() {
  renderHeader();
  if (!loaded) return;
  const hw = works.filter(w => w.homework);
  $('#hw').innerHTML = hw.length ? hw.map(w => card(w, true)).join('')
    : '<div class="empty">まだ宿題はありません。品書きから「宿題にする」を押すとここに吊るされます。</div>';

  const ms = ['すべて', ...MEDIA.filter(m => works.some(w => w.media === m))];
  if (!ms.includes(filter)) filter = 'すべて';
  $('#filters').innerHTML = ms.map(m => `<button class="btn${m === filter ? ' on' : ''}" data-filter="${m}">${m}</button>`).join('');
  $('#sorts').innerHTML = [['new', '新着'], ['hit', '刺さった順'], ['unread', '自分が未読']]
    .map(([k, l]) => `<button class="btn sm${k === sort ? ' on' : ''}" data-sort="${k}">${l}</button>`).join('');

  let list = works.filter(w => filter === 'すべて' || w.media === filter);
  if (sort === 'hit') list = [...list].sort((a, b) => hitters(b).length - hitters(a).length);
  if (sort === 'unread') list = list.filter(w => !mine(w.id).read);
  $('#cards').innerHTML = list.length ? list.map(w => card(w, false)).join('')
    : `<div class="empty">${works.length ? '該当する作品はありません。' : 'まだ何も登録されていません。右下の「推す」から最初の一作をどうぞ。'}</div>`;
}

// ---------------------------------------------------------
// シート
// ---------------------------------------------------------
function openWork(w) {
  editing = w ? w.id : null;
  $('#workTitle').textContent = w ? '推しを編集' : '推しを登録';
  $('#f-title').value = w ? w.title || '' : '';
  $('#f-media').value = w ? w.media || 'その他' : '漫画';
  $('#f-by').value = w ? w.by_name || '' : nick;
  $('#f-entry').value = w ? w.entry || '' : '';
  $('#f-note').value = w ? w.note || '' : '';
  $('#f-link').value = w ? w.link || '' : '';
  openSheet('#workSheet');
}

function openSet() {
  $('#s-nick').value = nick;
  $('#s-date').value = meta.date || '';
  $('#s-place').value = meta.place || '';
  openSheet('#setSheet');
}

// ---------------------------------------------------------
// 操作
// ---------------------------------------------------------
document.addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.close !== undefined) { closeSheets(); return; }
  if (t.dataset.tab) { switchTab(t.dataset.tab); return; }
  if (t.dataset.filter) { filter = t.dataset.filter; render(); return; }
  if (t.dataset.sort) { sort = t.dataset.sort; render(); return; }

  const act = t.dataset.act, id = t.dataset.id; if (!act) return;
  const w = works.find(x => x.id === id); if (!w) return;
  if (act !== 'del') armed = null;

  if (act === 'read' || act === 'hit') {
    const my = mine(id);
    let read = my.read, hit = my.hit;
    if (act === 'read') { read = !read; if (!read) hit = false; }
    else { hit = !hit; if (hit) read = true; }
    // 先に画面へ反映してから保存
    marks = marks.filter(m => !(m.work_id === id && m.nick === nick));
    if (read || hit) marks.push({ work_id: id, nick, read, hit });
    render();
    write('oshi_mark', { p_work_id: id, p_nick: nick, p_read: read, p_hit: hit });
  } else if (act === 'hw') {
    w.homework = !w.homework; render();
    write('oshi_save_work', { p_id: id, p_homework: w.homework });
  } else if (act === 'edit') {
    openWork(w);
  } else if (act === 'del') {
    if (armed !== id) { armed = id; render(); return; }
    armed = null;
    works = works.filter(x => x.id !== id); render();
    write('oshi_delete_work', { p_id: id }, '削除しました');
  }
});

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(b => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on); b.setAttribute('aria-selected', on);
  });
  $('#p-oshi').hidden = tab !== 'oshi';
  $('#p-shun').hidden = tab !== 'shun';
  $('#fab').hidden = tab !== 'oshi' || !$('#gate').hidden;
}

$('#gear').onclick = openSet;
$('#fab').onclick = () => openWork(null);
document.querySelectorAll('.sheet').forEach(s => s.addEventListener('click', e => { if (e.target === s) closeSheets(); }));

$('#workForm').addEventListener('submit', e => {
  e.preventDefault();
  const title = $('#f-title').value.trim(); if (!title) return;
  const link = $('#f-link').value.trim();
  const args = {
    p_id: editing,
    p_title: title,
    p_media: $('#f-media').value,
    p_by_name: $('#f-by').value.trim(),
    p_entry: $('#f-entry').value.trim(),
    p_note: $('#f-note').value.trim(),
    p_link: okUrl(link) ? link : '',
  };
  if (!editing) { args.p_homework = false; args.p_added_by = nick; }
  closeSheets();
  write('oshi_save_work', args, editing ? '更新しました' : '登録しました');
});

$('#setForm').addEventListener('submit', e => {
  e.preventDefault();
  const n = $('#s-nick').value.trim();
  if (n && n !== nick) { nick = n; store.set('oshi.nick', n); render(); }
  const date = $('#s-date').value, place = $('#s-place').value.trim();
  if (date !== (meta.date || '')) write('oshi_set_meta', { p_key: 'date', p_value: date });
  if (place !== (meta.place || '')) write('oshi_set_meta', { p_key: 'place', p_value: place });
  meta = { ...meta, date, place }; renderHeader();
  closeSheets();
});

$('#logout').onclick = () => lock('合言葉を消しました。');

// 画面に戻った時・30秒ごとに読み直し
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { load(); renderHeader(); } });
window.addEventListener('pageshow', e => { if (e.persisted) load(); });
setInterval(() => { if (document.visibilityState === 'visible') load(); }, REFRESH_MS);

// ---------------------------------------------------------
// 起動
// ---------------------------------------------------------
if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY || /ここに/.test(CFG.SUPABASE_ANON_KEY)) {
  $('#gate').hidden = false;
  $('#g-pass').hidden = true; $('#g-btn').hidden = true;
  $('#g-err').textContent = 'config.js に接続先（URLとpublishableキー）が設定されていません。';
} else {
  enter();
}
})();
