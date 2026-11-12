// 체험 예약 페이지
(async function () {
  const $ = id => document.getElementById(id);
  const esc = JM.esc;
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  const STATUS = { pending: ['접수 · 확인 대기', 'st-pending'], confirmed: ['예약 확정', 'st-confirmed'], done: ['체험 완료', 'st-done'], cancelled: ['취소됨', 'st-cancelled'] };

  let cfg;
  try { cfg = await JM.config(); } catch {
    $('programList').innerHTML = '<p class="alert alert-error">예약 정보를 불러오지 못했어요. 전화(010-2684-6073)로 예약해 주세요.</p>';
    return;
  }

  const state = { programId: null, date: null, time: null, view: null, avail: {} };
  const today = cfg.today;
  const lastDay = addDays(today, cfg.maxDaysAhead);

  function addDays(s, n) { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  const ym = s => s.slice(0, 7);
  const program = () => cfg.programs.find(p => p.id === state.programId);
  const fmtDate = s => { const d = new Date(s + 'T00:00:00Z'); return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WEEK[d.getUTCDay()]})`; };
  const people = () => (parseInt($('adults').value, 10) || 0) + (parseInt($('children').value, 10) || 0);
  const nowMonth = new Date(Date.now() + 9 * 3600e3).getUTCMonth() + 1;

  // ---------- 프로그램 ----------
  $('programList').innerHTML = cfg.programs.map(p => `
    <label class="prog-opt ${p.months.includes(nowMonth) ? '' : 'off-season'}">
      <input type="radio" name="programId" value="${esc(p.id)}">
      <img src="${esc(p.image)}" alt="">
      <span><b>${esc(p.name)}</b><small class="season">${esc(p.season)} · ${esc(p.duration)}</small></span>
    </label>`).join('');
  $('programList').addEventListener('change', e => {
    if (e.target.name !== 'programId') return;
    state.programId = e.target.value;
    // 선택한 날짜가 프로그램 운영 기간이 아니면 해제
    if (state.date && !program().months.includes(+state.date.slice(5, 7))) { state.date = null; state.time = null; }
    if (!state.date) jumpToFirstOpenMonth();
    renderCalendar(); renderSlots(); renderSummary();
  });

  // ---------- 달력 ----------
  state.view = ym(addDays(today, 1));
  async function loadAvail(month) {
    if (state.avail[month]) return state.avail[month];
    const r = await fetch(`/api/availability?month=${month}`);
    state.avail[month] = r.ok ? await r.json() : { blocked: [], booked: {}, capacityPerSlot: cfg.capacityPerSlot };
    return state.avail[month];
  }
  function remain(date, time) {
    const a = state.avail[ym(date)];
    return cfg.capacityPerSlot - ((a && a.booked[`${date} ${time}`]) || 0);
  }
  function dayStatus(date) {
    if (date <= today || date > lastDay) return 'off';
    const a = state.avail[ym(date)];
    if (a && a.blocked.includes(date)) return 'off';
    const p = program();
    if (p && !p.months.includes(+date.slice(5, 7))) return 'off';
    if (cfg.slots.every(t => remain(date, t) <= 0)) return 'full';
    return 'on';
  }
  function jumpToFirstOpenMonth() {
    const p = program(); if (!p) return;
    let m = ym(addDays(today, 1));
    for (let i = 0; i < 6; i++) {
      if (p.months.includes(+m.slice(5, 7)) && m <= ym(lastDay)) { state.view = m; return; }
      m = shiftMonth(m, 1);
    }
  }
  function shiftMonth(m, n) { const d = new Date(m + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); }

  async function renderCalendar() {
    const m = state.view;
    $('calTitle').textContent = `${+m.slice(0, 4)}년 ${+m.slice(5, 7)}월`;
    $('calPrev').disabled = m <= ym(addDays(today, 1));
    $('calNext').disabled = m >= ym(lastDay);
    await loadAvail(m);
    if (state.view !== m) return;
    const first = new Date(m + '-01T00:00:00Z');
    const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    let html = '<span class="cal-blank"></span>'.repeat(first.getUTCDay());
    for (let d = 1; d <= days; d++) {
      const date = `${m}-${String(d).padStart(2, '0')}`;
      const st = dayStatus(date);
      const cls = ['cal-day', st === 'full' ? 'full' : '', date === today ? 'today' : '', date === state.date ? 'selected' : ''].join(' ');
      const label = `${fmtDate(date)}${st === 'off' ? ' 예약 불가' : st === 'full' ? ' 마감' : ''}`;
      html += `<button type="button" class="${cls}" data-date="${date}" ${st !== 'on' ? 'disabled' : ''} aria-label="${label}" aria-pressed="${date === state.date}">${d}</button>`;
    }
    $('calDays').innerHTML = html;
  }
  $('calDays').addEventListener('click', e => {
    const b = e.target.closest('[data-date]'); if (!b || b.disabled) return;
    state.date = b.dataset.date;
    if (state.time && remain(state.date, state.time) < Math.max(1, people())) state.time = null;
    renderCalendar(); renderSlots(); renderSummary();
  });
  $('calPrev').addEventListener('click', () => { state.view = shiftMonth(state.view, -1); renderCalendar(); });
  $('calNext').addEventListener('click', () => { state.view = shiftMonth(state.view, 1); renderCalendar(); });

  // ---------- 시간 ----------
  function renderSlots() {
    if (!state.date) {
      const p = program();
      let open = !p;
      for (let m = ym(addDays(today, 1)); !open && m <= ym(lastDay); m = shiftMonth(m, 1)) open = p.months.includes(+m.slice(5, 7));
      $('slotLabel').textContent = open ? '날짜를 먼저 골라주세요'
        : `${p.name}은(는) ${p.season}에 운영해요. 예약은 체험일 ${cfg.maxDaysAhead}일 전부터 받고 있어요. 미리 문의는 전화로 주세요!`;
      $('slotList').innerHTML = '';
      return;
    }
    $('slotLabel').textContent = `${fmtDate(state.date)} 체험 시간`;
    $('slotList').innerHTML = cfg.slots.map(t => {
      const r = remain(state.date, t);
      const label = +t.slice(0, 2) < 12 ? '오전' : '오후';
      const h = +t.slice(0, 2) > 12 ? +t.slice(0, 2) - 12 : +t.slice(0, 2);
      return `<button type="button" class="slot" role="radio" data-time="${t}" aria-checked="${state.time === t}" ${r <= 0 ? 'disabled' : ''}>
        <b>${label} ${h}:${t.slice(3)}</b><span>${r <= 0 ? '마감' : `${r}명 예약 가능`}</span></button>`;
    }).join('');
  }
  $('slotList').addEventListener('click', e => {
    const b = e.target.closest('[data-time]'); if (!b || b.disabled) return;
    state.time = b.dataset.time; renderSlots(); renderSummary();
  });

  // ---------- 인원 ----------
  document.querySelectorAll('[data-step]').forEach(btn => btn.addEventListener('click', () => {
    const [id, d] = btn.dataset.step.split(':');
    const el = $(id);
    el.value = Math.min(300, Math.max(0, (parseInt(el.value, 10) || 0) + Number(d)));
    renderSummary();
  }));
  ['adults', 'children'].forEach(id => $(id).addEventListener('input', renderSummary));

  // 연락처 자동 하이픈
  function phoneFormat(el) {
    el.addEventListener('input', () => {
      const d = el.value.replace(/\D/g, '').slice(0, 11);
      el.value = d.length < 4 ? d : d.length < 8 ? `${d.slice(0, 3)}-${d.slice(3)}` : `${d.slice(0, 3)}-${d.slice(3, d.length - 4)}-${d.slice(-4)}`;
    });
  }
  phoneFormat($('phone')); phoneFormat($('lookupPhone'));

  // ---------- 요약 ----------
  function renderSummary() {
    const p = program();
    $('sumProgram').textContent = p ? p.name : '—';
    $('sumDate').textContent = state.date ? fmtDate(state.date) : '—';
    $('sumTime').textContent = state.time || '—';
    const a = parseInt($('adults').value, 10) || 0, c = parseInt($('children').value, 10) || 0;
    $('sumPeople').textContent = a + c ? `어른 ${a} · 어린이 ${c} (총 ${a + c}명)` : '—';
    $('sumPrice').textContent = p && p.price && p.price !== '체험비 문의' ? p.price : '예약 확인 전화 때 안내';
  }

  // ---------- 제출 ----------
  function showError(msg, focusEl) {
    $('formError').textContent = msg; $('formError').hidden = false;
    $('formError').scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (focusEl) setTimeout(() => focusEl.focus({ preventScroll: true }), 300);
  }
  $('reserveForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('formError').hidden = true;
    const f = e.target;
    if (!state.programId) return showError('체험 프로그램을 선택해 주세요.');
    if (!state.date) return showError('체험 날짜를 선택해 주세요.');
    if (!state.time) return showError('체험 시간을 선택해 주세요.');
    if (people() < 1) return showError('인원을 1명 이상 입력해 주세요.', $('adults'));
    if (people() > remain(state.date, state.time)) return showError(`선택하신 시간은 ${remain(state.date, state.time)}명까지 예약할 수 있어요. 더 많은 인원은 전화로 문의해 주세요.`);
    if (!$('name').value.trim()) return showError('예약자 성함을 입력해 주세요.', $('name'));
    if (!/^0\d{1,2}-?\d{3,4}-?\d{4}$/.test(f.phone.value.trim())) return showError('연락처를 정확히 입력해 주세요. (예: 010-1234-5678)', f.phone);
    if (!f.agree.checked) return showError('개인정보 수집·이용에 동의해 주세요.', f.agree);

    const btn = $('submitBtn');
    btn.disabled = true; btn.textContent = '신청하는 중…';
    try {
      const r = await fetch('/api/reservations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          programId: state.programId, date: state.date, time: state.time,
          adults: parseInt(f.adults.value, 10) || 0, children: parseInt(f.children.value, 10) || 0,
          name: $('name').value, phone: f.phone.value, groupType: f.groupType.value, groupName: f.groupName.value,
          request: f.request.value, agree: f.agree.checked, website: f.website.value,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        delete state.avail[ym(state.date)];
        await renderCalendar(); renderSlots();
        return showError(data.error || '예약 중 문제가 생겼어요. 전화로 문의해 주세요.');
      }
      $('doneNo').textContent = data.no;
      $('doneDetail').textContent = `${data.programName} · ${fmtDate(data.date)} ${data.time} · ${data.adults + data.children}명`;
      $('doneOverlay').hidden = false;
      $('doneClose').focus();
      f.reset(); state.date = null; state.time = null; state.programId = null; state.avail = {};
      renderCalendar(); renderSlots(); renderSummary();
    } catch {
      showError('네트워크 오류가 발생했어요. 잠시 후 다시 시도하거나 전화로 문의해 주세요.');
    } finally {
      btn.disabled = false; btn.textContent = '예약 신청하기';
    }
  });
  $('doneClose').addEventListener('click', () => { $('doneOverlay').hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $('doneOverlay').hidden = true; });

  // ---------- 조회 ----------
  $('lookupForm').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('lookupResult');
    out.innerHTML = '<p class="hint">조회 중…</p>';
    try {
      const r = await fetch('/api/reservations/lookup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ no: $('lookupNo').value, phone: $('lookupPhone').value }),
      });
      const d = await r.json();
      if (!r.ok) { out.innerHTML = `<p class="alert alert-error">${esc(d.error)}</p>`; return; }
      const [label, cls] = STATUS[d.status] || ['-', ''];
      out.innerHTML = `<div class="alert alert-ok"><span class="status-pill ${cls}">${label}</span>
        &nbsp; <b>${esc(d.programName)}</b> · ${fmtDate(d.date)} ${esc(d.time)} · 어른 ${d.adults} · 어린이 ${d.children} (${esc(d.name)}님)</div>`;
    } catch { out.innerHTML = '<p class="alert alert-error">조회 중 오류가 발생했어요.</p>'; }
  });

  // ---------- 초기화 ----------
  const pre = new URLSearchParams(location.search).get('program');
  const preInput = pre && document.querySelector(`input[name=programId][value="${CSS.escape(pre)}"]`);
  if (preInput) { preInput.checked = true; state.programId = pre; jumpToFirstOpenMonth(); }
  renderCalendar(); renderSlots(); renderSummary();
})();
