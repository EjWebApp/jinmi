// 관리자 > 작업 노트: 노션식 페이지 + 문단 댓글
(function () {
  const $ = id => document.getElementById(id);
  const esc = JM.esc;
  const { api, toast } = window.JMA;
  const state = { list: [], me: null, note: null, comments: [], openAnchor: null, editing: null };

  const ICON_COMMENT = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M4 4h12a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 14h-6l-4 3v-3H4a1.5 1.5 0 0 1-1.5-1.5v-7A1.5 1.5 0 0 1 4 4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';

  // ---------- 마크다운 → 블록 ----------
  // 지원: # ## ###, - 목록, 1. 번호, - [ ] 체크, > 인용, ---, **굵게**, `코드`, [글](주소)
  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }
  function parse(md) {
    const blocks = [], seen = {};
    let para = [];
    const push = (type, text, extra = {}) => {
      const key = type + ':' + text.trim();
      seen[key] = (seen[key] || 0) + 1;
      blocks.push({ type, text, anchor: hash(key + '#' + seen[key]), ...extra });
    };
    const flush = () => { if (para.length) { push('p', para.join('\n')); para = []; } };
    for (const line of String(md || '').split(/\r?\n/)) {
      let m;
      if (!line.trim()) { flush(); continue; }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flush(); blocks.push({ type: 'hr' }); continue; }
      if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { flush(); push('h' + m[1].length, m[2]); continue; }
      if ((m = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/))) { flush(); push('todo', m[2], { checked: m[1] !== ' ' }); continue; }
      if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { flush(); push('ul', m[1]); continue; }
      if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)$/))) { flush(); push('ol', m[2], { n: +m[1] }); continue; }
      if ((m = line.match(/^>\s?(.*)$/))) { flush(); push('quote', m[1]); continue; }
      para.push(line);
    }
    flush();
    return blocks;
  }
  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\n/g, '<br>');
  }

  // 블록들을 HTML 로 (commentable=true 면 댓글 버튼·스레드 포함)
  function renderBlocks(blocks, commentable) {
    let html = '', listType = null;
    const closeList = () => { if (listType) { html += listType === 'ol' ? '</ol>' : '</ul>'; listType = null; } };
    for (const b of blocks) {
      const isLi = b.type === 'ul' || b.type === 'ol' || b.type === 'todo';
      const lt = b.type === 'ol' ? 'ol' : b.type === 'todo' ? 'todo' : 'ul';
      if (!isLi || lt !== listType) {
        closeList();
        if (isLi) {
          html += lt === 'ol' ? `<ol start="${b.n || 1}">` : `<ul class="${lt === 'todo' ? 'todo-list' : ''}">`;
          listType = lt;
        }
      }
      if (b.type === 'hr') { html += '<hr>'; continue; }
      const inner = b.type === 'todo'
        ? `<span class="todo-box ${b.checked ? 'on' : ''}" aria-hidden="true"></span><span class="${b.checked ? 'todo-done' : ''}">${inline(b.text)}</span>`
        : inline(b.text);
      const tag = isLi ? 'li' : b.type === 'quote' ? 'blockquote' : b.type;
      html += commentable ? blockWithComments(tag, b, inner) : `<${tag}>${inner}</${tag}>`;
    }
    closeList();
    return html;
  }
  function threadOf(anchor) { return state.comments.filter(c => c.anchor === anchor); }
  function blockWithComments(tag, b, inner) {
    const th = threadOf(b.anchor);
    const open = th.filter(c => !c.resolved).length;
    const cls = ['nb', open ? 'has-c' : '', state.openAnchor === b.anchor ? 'is-open' : ''].join(' ');
    return `<${tag} class="${cls}" data-anchor="${b.anchor}">
      <div class="nb-row"><div class="nb-text">${inner}</div>
        <button type="button" class="nb-cbtn ${open ? 'on' : ''}" data-act="thread" aria-label="이 문단에 댓글${open ? ` ${open}개` : ''}" title="댓글">${ICON_COMMENT}${open ? `<span>${open}</span>` : ''}</button>
      </div>
      ${state.openAnchor === b.anchor ? threadCard(b.anchor, th, b.text) : ''}
    </${tag}>`;
  }

  // ---------- 댓글 ----------
  function when(s) {
    const t = new Date(s.replace(' ', 'T') + '+09:00').getTime(), d = (Date.now() - t) / 60000;
    if (d < 1) return '방금';
    if (d < 60) return `${Math.floor(d)}분 전`;
    if (d < 60 * 24) return `${Math.floor(d / 60)}시간 전`;
    return s.slice(5, 16).replace('-', '/');
  }
  function commentItem(c) {
    return `<li class="cm ${c.resolved ? 'resolved' : ''}">
      <span class="cm-av" aria-hidden="true">${esc(c.author.slice(0, 1).toUpperCase())}</span>
      <div class="cm-main">
        <div class="cm-head"><b>${esc(c.author)}</b><time>${esc(when(c.createdAt))}</time>
          ${c.adminId === state.me ? `<button type="button" class="link-btn danger" data-act="del-comment" data-id="${c.id}">삭제</button>` : ''}</div>
        <div class="cm-body">${esc(c.body)}</div>
      </div></li>`;
  }
  function composer(anchor, quote, placeholder) {
    return `<form class="cm-form" data-anchor="${anchor}" data-quote="${esc(quote || '')}">
      <textarea rows="1" maxlength="2000" placeholder="${placeholder}" aria-label="댓글 입력"></textarea>
      <button class="btn btn-primary btn-sm" type="submit">보내기</button></form>`;
  }
  function threadCard(anchor, th, quote) {
    const allResolved = th.length && th.every(c => c.resolved);
    return `<div class="thread" data-anchor="${anchor}">
      ${th.length ? `<div class="thread-head"><span>${allResolved ? '해결된 댓글' : '댓글'} ${th.length}</span>
        <button type="button" class="link-btn" data-act="resolve" data-resolved="${allResolved ? 0 : 1}">${allResolved ? '다시 열기' : '해결'}</button></div>` : ''}
      <ul class="cm-list">${th.map(commentItem).join('')}</ul>
      ${composer(anchor, quote, th.length ? '답글 달기…' : '이 문단에 댓글 달기…')}
    </div>`;
  }

  // ---------- 목록 ----------
  function renderList() {
    $('noteList').innerHTML = state.list.length ? state.list.map(n => `
      <li><button type="button" class="note-item ${state.note && state.note.id === n.id ? 'active' : ''}" data-id="${n.id}">
        <span class="ni-title">${esc(n.title)}</span>
        <span class="ni-meta">${esc(n.date)}${n.author ? ' · ' + esc(n.author) : ''}
          ${n.openComments ? `<span class="ni-c">${ICON_COMMENT}${n.openComments}</span>` : ''}</span>
      </button></li>`).join('')
      : '<li class="hint" style="padding:12px">아직 페이지가 없어요.</li>';
  }
  function refreshBadge() {
    api('/api/admin/notes').then(d => {
      state.list = d.notes; state.me = d.me;
      const n = d.notes.reduce((s, x) => s + x.openComments, 0);
      $('notesBadge').textContent = n; $('notesBadge').hidden = !n;
    }).catch(() => {});
  }
  async function load() {
    const want = Number((location.hash.match(/^#notes\/(\d+)/) || [])[1]);
    try {
      const d = await api('/api/admin/notes');
      state.list = d.notes; state.me = d.me;
      renderList(); updateBadge();
      const id = want || (state.note && state.note.id) || (window.innerWidth > 860 && state.list[0] && state.list[0].id);
      if (id && state.list.some(n => n.id === id)) openNote(id);
    } catch (err) { toast(err.message); }
  }
  function updateBadge() {
    const n = state.list.reduce((s, x) => s + x.openComments, 0);
    $('notesBadge').textContent = n; $('notesBadge').hidden = !n;
  }

  // ---------- 페이지 보기 ----------
  async function openNote(id, keepThread) {
    try {
      const d = await api(`/api/admin/notes/${id}`);
      if (!keepThread) state.openAnchor = null;
      state.note = d.note; state.comments = d.comments; state.me = d.me;
      const li = state.list.find(n => n.id === id);
      if (li) { li.comments = d.comments.length; li.openComments = d.comments.filter(c => !c.resolved).length; }
      showEditor(false); renderPage(); renderList(); updateBadge();
      document.querySelector('.notes').classList.add('has-open');
      history.replaceState(null, '', '#notes/' + id);
    } catch (err) { toast(err.message); }
  }
  function renderPage() {
    const n = state.note;
    const blocks = parse(n.body);
    const anchors = new Set(blocks.map(b => b.anchor));
    const pageCs = threadOf('');
    // 내용이 바뀌어 원래 문단을 잃은 댓글
    const orphans = state.comments.filter(c => c.anchor && !anchors.has(c.anchor));
    $('notePage').innerHTML = `
      <button type="button" class="link-btn back-btn" data-act="back">← 목록</button>
      <header class="np-head">
        <h1>${esc(n.title)}</h1>
        <div class="np-meta">
          <span>${esc(n.date)}</span>${n.author ? `<span>${esc(n.author)}</span>` : ''}
          ${n.source === 'file' ? '<span class="chip grape" title="저장소의 notes 폴더에서 자동으로 올라온 페이지">자동 등록</span>' : ''}
        </div>
        <div class="np-actions">
          <button type="button" class="btn btn-outline btn-sm" data-act="copy-notion" title="복사한 뒤 노션 빈 페이지에 붙여넣으면 제목·목록이 그대로 들어가요">노션용 복사</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="download">.md 받기</button>
          ${n.source === 'admin' ? `<button type="button" class="btn btn-ghost btn-sm" data-act="edit">편집</button>
            <button type="button" class="link-btn danger" data-act="delete">삭제</button>` : ''}
        </div>
      </header>
      <p class="np-tip hint">문단에 마우스를 올리거나 오른쪽 말풍선을 누르면 그 문단에 댓글을 달 수 있어요.</p>
      <div class="note-body">${renderBlocks(blocks, true) || '<p class="hint">내용이 없어요.</p>'}</div>
      ${orphans.length ? `<section class="np-orphans"><h3>내용이 바뀐 문단의 댓글</h3>
        ${[...new Set(orphans.map(c => c.anchor))].map(a => {
          const th = threadOf(a); const q = th[0].quote;
          return `<div class="orphan">${q ? `<blockquote class="orphan-q">${esc(q)}</blockquote>` : ''}${threadCard(a, th, q)}</div>`;
        }).join('')}</section>` : ''}
      <section class="np-comments">
        <h3>댓글 <small>${pageCs.length || ''}</small></h3>
        <ul class="cm-list">${pageCs.map(commentItem).join('')}</ul>
        ${composer('', '', '페이지에 댓글 남기기…')}
      </section>`;
    autoGrowAll();
  }
  function autoGrowAll() {
    document.querySelectorAll('.cm-form textarea').forEach(t => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; });
  }

  // 클릭 동작
  $('notePage').addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const act = btn.dataset.act, n = state.note;
    if (act === 'thread') {
      const a = btn.closest('.nb').dataset.anchor;
      state.openAnchor = state.openAnchor === a ? null : a;
      renderPage();
      if (state.openAnchor) { const t = document.querySelector(`.thread[data-anchor="${a}"] textarea`); if (t) t.focus(); }
    }
    if (act === 'resolve') {
      const a = btn.closest('.thread').dataset.anchor, resolved = btn.dataset.resolved === '1';
      try {
        await api(`/api/admin/notes/${n.id}/threads`, { method: 'PATCH', body: { anchor: a, resolved } });
        if (resolved) state.openAnchor = null;
        await openNote(n.id, true); toast(resolved ? '해결로 표시했어요.' : '다시 열었어요.');
      } catch (err) { toast(err.message); }
    }
    if (act === 'del-comment') {
      if (!confirm('이 댓글을 지울까요?')) return;
      try { await api(`/api/admin/comments/${btn.dataset.id}`, { method: 'DELETE' }); await openNote(n.id, true); } catch (err) { toast(err.message); }
    }
    if (act === 'copy-notion') copyText(`# ${n.title}\n\n${n.body}\n`);
    if (act === 'download') {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([`# ${n.title}\n\n${n.body}\n`], { type: 'text/markdown;charset=utf-8' }));
      a.download = `${n.date}_${n.title.replace(/[\\/:*?"<>|]/g, '')}.md`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    if (act === 'edit') startEdit(n);
    if (act === 'delete') {
      if (!confirm(`'${n.title}' 페이지를 삭제할까요?\n댓글도 함께 지워지고 되돌릴 수 없어요.`)) return;
      try {
        await api(`/api/admin/notes/${n.id}`, { method: 'DELETE' });
        state.note = null; history.replaceState(null, '', '#notes');
        $('notePage').innerHTML = '<div class="empty-state">삭제했어요.</div>';
        document.querySelector('.notes').classList.remove('has-open');
        load(); toast('삭제했어요.');
      } catch (err) { toast(err.message); }
    }
    if (act === 'back') {
      document.querySelector('.notes').classList.remove('has-open');
      history.replaceState(null, '', '#notes');
    }
  });

  // 댓글 보내기 (Enter 보내기, Shift+Enter 줄바꿈)
  $('notePage').addEventListener('submit', async e => {
    const f = e.target.closest('.cm-form'); if (!f) return;
    e.preventDefault();
    const ta = f.querySelector('textarea'), body = ta.value.trim();
    if (!body) return ta.focus();
    const btn = f.querySelector('button'); btn.disabled = true;
    try {
      await api(`/api/admin/notes/${state.note.id}/comments`, { method: 'POST', body: { body, anchor: f.dataset.anchor, quote: f.dataset.quote.slice(0, 200) } });
      await openNote(state.note.id, true);
      const again = document.querySelector(`.cm-form[data-anchor="${f.dataset.anchor}"] textarea`);
      if (again && f.dataset.anchor) again.focus();
    } catch (err) { toast(err.message); btn.disabled = false; }
  });
  $('notePage').addEventListener('keydown', e => {
    if (e.target.matches('.cm-form textarea') && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault(); e.target.form.requestSubmit();
    }
  });
  $('notePage').addEventListener('input', e => {
    if (e.target.matches('.cm-form textarea')) { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }
  });

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
      document.execCommand('copy'); t.remove();
    }
    toast('복사했어요. 노션 빈 페이지에 붙여넣으세요.');
  }

  // ---------- 쓰기 / 편집 ----------
  function showEditor(on) {
    $('noteEditor').hidden = !on; $('notePage').hidden = on;
  }
  function setEdMode(mode) {
    document.querySelectorAll('[data-ed]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ed === mode)));
    $('edBody').hidden = mode !== 'write'; $('edPreview').hidden = mode !== 'preview';
    if (mode === 'preview') $('edPreview').innerHTML = renderBlocks(parse($('edBody').value), false) || '<p class="hint">내용이 없어요.</p>';
  }
  function startEdit(note) {
    state.editing = note ? note.id : null;
    $('edTitle').value = note ? note.title : '';
    $('edDate').value = note ? note.date : new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    $('edBody').value = note ? note.body : '';
    setEdMode('write'); showEditor(true);
    document.querySelector('.notes').classList.add('has-open');
    $('edTitle').focus();
  }
  document.querySelectorAll('[data-ed]').forEach(b => b.addEventListener('click', () => setEdMode(b.dataset.ed)));
  $('noteNewBtn').addEventListener('click', () => startEdit(null));
  $('edCancel').addEventListener('click', () => {
    showEditor(false);
    if (!state.note) document.querySelector('.notes').classList.remove('has-open');
  });
  $('noteEditor').addEventListener('submit', async e => {
    e.preventDefault();
    const body = { title: $('edTitle').value.trim(), date: $('edDate').value, body: $('edBody').value };
    if (!body.title) { toast('제목을 입력해 주세요.'); return $('edTitle').focus(); }
    try {
      let id = state.editing;
      if (id) await api(`/api/admin/notes/${id}`, { method: 'PATCH', body });
      else id = (await api('/api/admin/notes', { method: 'POST', body })).id;
      history.replaceState(null, '', '#notes/' + id);
      await load(); toast('저장했어요.');
    } catch (err) { toast(err.message); }
  });

  // 목록 클릭
  $('noteList').addEventListener('click', e => {
    const b = e.target.closest('.note-item'); if (b) openNote(Number(b.dataset.id));
  });

  window.JMNotes = { load, refreshBadge };
})();
