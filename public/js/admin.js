// 관리자 페이지
(function () {
  const $ = id => document.getElementById(id);
  const esc = JM.esc;
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  const STATUS = { pending: '확인 대기', confirmed: '확정', done: '체험 완료', cancelled: '취소' };
  const state = { list: [], today: '', range: 'upcoming', me: null };

  async function api(path, opts = {}) {
    const method = opts.method || 'GET';
    const body = method === 'GET' ? undefined : JSON.stringify(opts.body || {});
    const r = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body,
      credentials: 'same-origin',
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== '/api/admin/login') { show('login'); throw new Error(data.error || '로그인이 필요합니다.'); }
    if (r.status === 403 && /비밀번호를 먼저/.test(data.error || '')) { show('change'); throw new Error(data.error); }
    if (!r.ok) throw new Error(data.error || '요청을 처리하지 못했습니다.');
    return data;
  }
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2200);
  }
  function show(view) {
    $('loginView').hidden = view !== 'login';
    $('changeView').hidden = view !== 'change';
    $('appView').hidden = view !== 'app';
    if (view === 'login') setTimeout(() => $('loginId').focus(), 0);
  }
  function msg(el, text, ok) { el.textContent = text; el.className = 'alert ' + (ok ? 'alert-ok' : 'alert-error'); el.hidden = !text; }
  const fmtDate = s => { const d = new Date(s + 'T00:00:00Z'); return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WEEK[d.getUTCDay()]})`; };
  function addDays(s, n) { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

  // ---------- 로그인 ----------
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('loginError').hidden = true;
    try {
      const d = await api('/api/admin/login', { method: 'POST', body: { username: $('loginId').value.trim(), password: $('loginPw').value } });
      $('loginPw').value = '';
      state.me = d;
      if (d.mustChange) show('change'); else enterApp();
    } catch (err) { msg($('loginError'), err.message); }
  });
  $('firstPwForm').addEventListener('submit', async e => {
    e.preventDefault();
    const next = $('fpNext').value;
    if (next.length < 8) return msg($('firstPwError'), '새 비밀번호는 8자 이상이어야 합니다.');
    if (next !== $('fpNext2').value) return msg($('firstPwError'), '새 비밀번호 확인이 일치하지 않습니다.');
    try {
      await api('/api/admin/password', { method: 'POST', body: { current: $('fpCurrent').value, next } });
      e.target.reset(); toast('비밀번호를 변경했어요.'); enterApp();
    } catch (err) { msg($('firstPwError'), err.message); }
  });
  $('logoutBtn').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST', body: {} }).catch(() => {});
    show('login');
  });

  async function enterApp() {
    const me = await api('/api/admin/me');
    if (me.mustChange) return show('change');
    state.me = me;
    $('whoName').textContent = `${me.username} 님`;
    show('app');
    loadReservations();
  }

  // ---------- 탭 ----------
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', String(x === t)));
    document.querySelectorAll('.tab-panel').forEach(p => { p.hidden = p.id !== 'tab-' + t.dataset.tab; });
    if (t.dataset.tab === 'reservations') loadReservations();
    if (t.dataset.tab === 'blocked') loadBlocked();
    if (t.dataset.tab === 'accounts') loadAccounts();
  }));

  // ---------- 예약 ----------
  async function loadReservations() {
    try {
      const d = await api('/api/admin/reservations');
      state.list = d.reservations; state.today = d.today;
      renderStats(); renderList();
    } catch (err) { if (!$('appView').hidden) toast(err.message); }
  }
  function renderStats() {
    const t = state.today, week = addDays(t, 7), year = t.slice(0, 4);
    const live = state.list.filter(r => r.status !== 'cancelled');
    const ppl = arr => arr.reduce((s, r) => s + r.adults + r.children, 0);
    const today = live.filter(r => r.date === t);
    $('stToday').textContent = `${today.length}건`;
    $('stTodayPeople').textContent = today.length ? `${ppl(today)}명` : '';
    $('stPending').textContent = `${state.list.filter(r => r.status === 'pending' && r.date >= t).length}건`;
    const wk = live.filter(r => r.status === 'confirmed' && r.date >= t && r.date <= week);
    $('stWeek').textContent = `${wk.length}건`;
    $('stWeekPeople').textContent = wk.length ? `${ppl(wk)}명` : '';
    $('stYear').textContent = `${ppl(live.filter(r => r.date.startsWith(year)))}명`;
  }
  function filtered() {
    const st = $('fStatus').value, q = $('fSearch').value.trim().toLowerCase(), t = state.today;
    let list = state.list.filter(r =>
      (state.range === 'all' || (state.range === 'upcoming' ? r.date >= t : r.date < t)) &&
      (!st || r.status === st) &&
      (!q || [r.name, r.phone, r.phone.replace(/-/g, ''), r.no, r.groupName, r.programName].some(v => String(v).toLowerCase().includes(q))));
    if (state.range !== 'upcoming') list = list.slice().reverse();
    return list;
  }
  function renderList() {
    const list = filtered();
    if (!list.length) {
      $('resList').innerHTML = `<div class="empty-state">${state.list.length ? '조건에 맞는 예약이 없어요.' : '아직 들어온 예약이 없어요. 🍇'}</div>`;
      return;
    }
    const groups = new Map();
    for (const r of list) { if (!groups.has(r.date)) groups.set(r.date, []); groups.get(r.date).push(r); }
    $('resList').innerHTML = [...groups].map(([date, items]) => {
      const total = items.filter(r => r.status !== 'cancelled').reduce((s, r) => s + r.adults + r.children, 0);
      return `<div class="day-group ${date === state.today ? 'is-today' : ''}">
        <h3>${fmtDate(date)} <small>${items.length}건 · ${total}명</small></h3>
        <div class="res-items">${items.map(resCard).join('')}</div></div>`;
    }).join('');
  }
  function resCard(r) {
    const h = +r.time.slice(0, 2);
    return `<article class="res s-${r.status}" data-id="${r.id}">
      <div class="res-time">${esc(r.time)}<small>${h < 12 ? '오전' : '오후'}</small></div>
      <div class="res-main">
        <b>${esc(r.name)}</b> <span class="meta">· 어른 ${r.adults} · 어린이 ${r.children} (총 ${r.adults + r.children}명)</span><br>
        <a href="tel:${esc(r.phone)}">${esc(r.phone)}</a><br>
        <span class="meta">${esc(r.programName)} · ${esc(r.groupType)}${r.groupName ? ' · ' + esc(r.groupName) : ''}</span><br>
        <span class="meta">${esc(r.no)} · 신청 ${esc(r.createdAt.slice(0, 16))}</span>
      </div>
      <div class="res-req ${r.request ? '' : 'empty'}">${r.request ? esc(r.request) : '요청사항 없음'}</div>
      <div class="res-actions">
        <select data-act="status" aria-label="예약 상태">
          ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <textarea data-act="memo" placeholder="관리자 메모 (손님에게 안 보여요)" aria-label="관리자 메모">${esc(r.adminMemo)}</textarea>
        <div class="row"><button class="link-btn" data-act="save-memo">메모 저장</button><button class="link-btn danger" data-act="delete">삭제</button></div>
      </div>
    </article>`;
  }
  $('resList').addEventListener('change', async e => {
    if (e.target.dataset.act !== 'status') return;
    const id = e.target.closest('.res').dataset.id;
    try {
      const r = await api(`/api/admin/reservations/${id}`, { method: 'PATCH', body: { status: e.target.value } });
      Object.assign(state.list.find(x => String(x.id) === id), r);
      renderStats(); renderList(); toast(`‘${STATUS[r.status]}’(으)로 바꿨어요.`);
    } catch (err) { toast(err.message); loadReservations(); }
  });
  $('resList').addEventListener('click', async e => {
    const act = e.target.dataset.act; if (!act) return;
    const card = e.target.closest('.res'); const id = card.dataset.id;
    const item = state.list.find(x => String(x.id) === id);
    if (act === 'save-memo') {
      try {
        const r = await api(`/api/admin/reservations/${id}`, { method: 'PATCH', body: { adminMemo: card.querySelector('[data-act=memo]').value } });
        Object.assign(item, r); toast('메모를 저장했어요.');
      } catch (err) { toast(err.message); }
    }
    if (act === 'delete') {
      if (!confirm(`${item.name}님(${fmtDate(item.date)} ${item.time}) 예약을 완전히 삭제할까요?\n삭제하면 되돌릴 수 없어요. 취소 처리만 하려면 상태를 ‘취소’로 바꿔주세요.`)) return;
      try {
        await api(`/api/admin/reservations/${id}`, { method: 'DELETE' });
        state.list = state.list.filter(x => x !== item); renderStats(); renderList(); toast('삭제했어요.');
      } catch (err) { toast(err.message); }
    }
  });
  document.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
    state.range = b.dataset.range;
    document.querySelectorAll('.seg-btn').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    renderList();
  }));
  $('fStatus').addEventListener('change', renderList);
  $('fSearch').addEventListener('input', renderList);
  $('refreshBtn').addEventListener('click', () => { loadReservations(); toast('새로 불러왔어요.'); });
  $('csvBtn').addEventListener('click', () => {
    const rows = filtered();
    const head = ['예약번호', '체험일', '시간', '프로그램', '어른', '어린이', '총인원', '예약자', '연락처', '방문유형', '단체명', '요청사항', '상태', '관리자메모', '신청일시'];
    const cell = v => {
      let s = String(v ?? '');
      if (/^[=+\-@]/.test(s)) s = "'" + s; // 엑셀 수식 주입 방지
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = [head, ...rows.map(r => [r.no, r.date, r.time, r.programName, r.adults, r.children, r.adults + r.children,
      r.name, r.phone, r.groupType, r.groupName, r.request, STATUS[r.status], r.adminMemo, r.createdAt])].map(l => l.map(cell).join(','));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `진미농원_예약_${state.today}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // ---------- 휴무일 ----------
  async function loadBlocked() {
    try {
      const d = await api('/api/admin/blocked-dates');
      renderBlocked(d.blockedDates);
    } catch (err) { toast(err.message); }
  }
  function renderBlocked(list) {
    $('blockList').innerHTML = list.length
      ? list.map(b => `<li><span>${fmtDate(b.date)}${b.reason ? `<small>${esc(b.reason)}</small>` : ''}</span><button class="link-btn danger" data-date="${b.date}">해제</button></li>`).join('')
      : '<li><span class="hint">지정된 휴무일이 없어요.</span></li>';
  }
  $('blockForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!$('blockDate').value) return toast('날짜를 골라주세요.');
    try {
      const d = await api('/api/admin/blocked-dates', { method: 'POST', body: { date: $('blockDate').value, reason: $('blockReason').value } });
      renderBlocked(d.blockedDates); e.target.reset(); toast('휴무일을 추가했어요.');
    } catch (err) { toast(err.message); }
  });
  $('blockList').addEventListener('click', async e => {
    const date = e.target.dataset.date; if (!date) return;
    try {
      const d = await api('/api/admin/blocked-dates', { method: 'DELETE', body: { date } });
      renderBlocked(d.blockedDates); toast('휴무일을 해제했어요.');
    } catch (err) { toast(err.message); }
  });

  // ---------- 계정 ----------
  async function loadAccounts() {
    try {
      const d = await api('/api/admin/accounts');
      $('accList').innerHTML = d.accounts.map(a => `<li><span><b>${esc(a.username)}</b>${a.id === d.me ? '<small>(나)</small>' : ''}<small>최근 로그인 ${a.lastLoginAt ? esc(a.lastLoginAt.slice(0, 16)) : '없음'}</small></span>
        ${a.id === d.me ? '' : `<button class="link-btn danger" data-id="${a.id}" data-name="${esc(a.username)}">삭제</button>`}</li>`).join('');
    } catch (err) { toast(err.message); }
  }
  $('accList').addEventListener('click', async e => {
    const id = e.target.dataset.id; if (!id) return;
    if (!confirm(`관리자 '${e.target.dataset.name}' 계정을 삭제할까요?`)) return;
    try { await api(`/api/admin/accounts/${id}`, { method: 'DELETE' }); loadAccounts(); toast('삭제했어요.'); } catch (err) { toast(err.message); }
  });
  $('accForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('/api/admin/accounts', { method: 'POST', body: { username: $('accId').value.trim(), password: $('accPw').value } });
      e.target.reset(); msg($('accMsg'), '관리자를 추가했어요.', true); loadAccounts();
    } catch (err) { msg($('accMsg'), err.message); }
  });
  $('pwForm').addEventListener('submit', async e => {
    e.preventDefault();
    const next = $('pwNext').value;
    if (next.length < 8) return msg($('pwMsg'), '새 비밀번호는 8자 이상이어야 합니다.');
    if (next !== $('pwNext2').value) return msg($('pwMsg'), '새 비밀번호 확인이 일치하지 않습니다.');
    try {
      await api('/api/admin/password', { method: 'POST', body: { current: $('pwCurrent').value, next } });
      e.target.reset(); msg($('pwMsg'), '비밀번호를 변경했어요. 다른 기기의 로그인은 모두 해제됐어요.', true);
    } catch (err) { msg($('pwMsg'), err.message); }
  });

  // ---------- 시작 ----------
  (async () => {
    try {
      const me = await fetch('/api/admin/me', { credentials: 'same-origin' });
      if (me.status === 401) return show('login');
      const d = await me.json();
      if (d.mustChange) return show('change');
      enterApp();
    } catch { show('login'); }
  })();
})();
