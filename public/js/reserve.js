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
      <span><b>${esc(p.name)}</b><small class="season">${esc(p.season)} · ${esc(p.duration)}${p.target ? ' · ' + esc(p.target) : ''}${p.price ? ' · ' + esc(p.price) : ''}</small></span>
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
    $('mCtaText').textContent = p ? p.name : '프로그램을 골라주세요';
    $('sumDate').textContent = state.date ? fmtDate(state.date) : '—';
    $('sumTime').textContent = state.time || '—';
    const a = parseInt($('adults').value, 10) || 0, c = parseInt($('children').value, 10) || 0;
    $('sumPeople').textContent = a + c ? `어른 ${a} · 어린이 ${c} (총 ${a + c}명)` : '—';
    $('sumPrice').textContent = p && p.price && p.price !== '체험비 문의' ? p.price : '예약 확인 전화 때 안내';
  }

  // ---------- 단계별 팝업 (2 날짜·시간 → 3 예약자 → 4 동의) ----------
  const wiz = $('wizard');
  const steps = [...document.querySelectorAll('.wiz-step')];
  let cur = 0, lastFocus = null;
  const wizOpen = () => !wiz.hidden;

  function renderWizSum() {
    const p = program();
    $('wizTitle').textContent = p ? p.name : '체험 예약';
    const bits = [];
    if (state.date) bits.push(fmtDate(state.date) + (state.time ? ' ' + state.time : ''));
    if (cur >= 1 && people()) bits.push(`${people()}명`);
    $('wizSum').textContent = bits.join(' · ');
  }
  function goStep(i) {
    cur = i;
    steps.forEach((el, k) => { el.hidden = k !== i; });
    document.querySelectorAll('.wiz-progress li').forEach((li, k) => {
      li.classList.toggle('active', k === i); li.classList.toggle('done', k < i);
      if (k === i) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    $('wizPrev').hidden = i === 0;
    $('submitBtn').textContent = i === steps.length - 1 ? '예약 신청하기' : '다음';
    $('wizError').hidden = true;
    $('wizBody').scrollTop = 0;
    renderWizSum();
    const first = steps[i].querySelector('.cal-day.selected, .slot[aria-checked="true"], input:not([type=hidden]):not([tabindex="-1"]), button:not(:disabled)');
    if (first && matchMedia('(pointer:fine)').matches) first.focus({ preventScroll: true });
  }
  function openWizard() {
    $('formError').hidden = true;
    if (!state.programId) {
      $('formError').textContent = '먼저 체험 프로그램을 골라주세요.'; $('formError').hidden = false;
      $('formError').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    lastFocus = document.activeElement;
    wiz.hidden = false;
    document.documentElement.classList.add('wiz-lock');
    goStep(state.date && state.time ? Math.min(cur, steps.length - 1) : 0);
  }
  function closeWizard() {
    wiz.hidden = true;
    document.documentElement.classList.remove('wiz-lock');
    if (lastFocus) lastFocus.focus({ preventScroll: true });
  }
  $('openWizard').addEventListener('click', openWizard);
  $('mCtaBtn').addEventListener('click', openWizard);
  $('wizClose').addEventListener('click', closeWizard);
  $('wizPrev').addEventListener('click', () => goStep(Math.max(0, cur - 1)));
  // 입력을 고치기 시작하면 오류 문구는 숨김
  wiz.addEventListener('input', () => { $('wizError').hidden = true; });
  wiz.addEventListener('change', () => { $('wizError').hidden = true; });
  wiz.addEventListener('mousedown', e => { if (e.target === wiz) closeWizard(); });
  // 날짜·시간·인원이 바뀌면 팝업 아래쪽 요약도 갱신
  ['calDays', 'slotList'].forEach(id => $(id).addEventListener('click', () => setTimeout(renderWizSum)));
  ['adults', 'children'].forEach(id => $(id).addEventListener('input', renderWizSum));
  document.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', renderWizSum));
  // 탭 키가 팝업 밖으로 나가지 않게
  wiz.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const f = [...wiz.querySelectorAll('button, input, select, textarea, a[href]')].filter(el => !el.disabled && el.offsetParent !== null && el.tabIndex >= 0);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });

  // ---------- 검사 · 제출 ----------
  function showError(msg, focusEl) {
    const box = wizOpen() ? $('wizError') : $('formError');
    box.textContent = msg; box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (focusEl) setTimeout(() => focusEl.focus({ preventScroll: true }), 300);
  }
  function checkStep(i) {
    const f = $('reserveForm');
    if (i === 0) {
      if (!state.date) return showError('체험 날짜를 골라주세요.'), false;
      if (!state.time) return showError('체험 시간을 골라주세요.'), false;
    }
    if (i === 1) {
      if (people() < 1) return showError('인원을 1명 이상 입력해 주세요.', $('adults')), false;
      if (people() > remain(state.date, state.time)) return showError(`선택하신 시간은 ${remain(state.date, state.time)}명까지 예약할 수 있어요. 더 많은 인원은 전화로 문의해 주세요.`, $('adults')), false;
      if (!$('name').value.trim()) return showError('예약자 성함을 입력해 주세요.', $('name')), false;
      if (!/^0\d{1,2}-?\d{3,4}-?\d{4}$/.test(f.phone.value.trim())) return showError('연락처를 정확히 입력해 주세요. (예: 010-1234-5678)', f.phone), false;
    }
    if (i === 2 && !f.agree.checked) return showError('개인정보 수집·이용에 동의해 주세요.', f.agree), false;
    return true;
  }

  $('reserveForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!wizOpen()) return openWizard();
    $('wizError').hidden = true;
    if (!checkStep(cur)) return;
    if (cur < steps.length - 1) return goStep(cur + 1);
    for (let i = 0; i < steps.length; i++) if (!checkStep(i)) return goStep(i), checkStep(i);

    const f = e.target;
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
        // 자리가 찼거나 날짜 문제면 날짜 단계로 돌아가서 다시 고르게
        if (r.status === 409 || /자리|마감|날짜|시간/.test(data.error || '')) goStep(0);
        return showError(data.error || '예약 중 문제가 생겼어요. 전화로 문의해 주세요.');
      }
      $('doneNo').textContent = data.no;
      $('doneDetail').textContent = `${data.programName} · ${fmtDate(data.date)} ${data.time} · ${data.adults + data.children}명`;
      closeWizard();
      $('doneOverlay').hidden = false;
      $('doneClose').focus();
      f.reset(); state.date = null; state.time = null; state.programId = null; state.avail = {}; cur = 0;
      renderCalendar(); renderSlots(); renderSummary();
    } catch {
      showError('네트워크 오류가 발생했어요. 잠시 후 다시 시도하거나 전화로 문의해 주세요.');
    } finally {
      btn.disabled = false; btn.textContent = cur === steps.length - 1 ? '예약 신청하기' : '다음';
    }
  });
  $('doneClose').addEventListener('click', () => { $('doneOverlay').hidden = true; });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('doneOverlay').hidden) $('doneOverlay').hidden = true;
    else if (wizOpen()) closeWizard();
  });

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
