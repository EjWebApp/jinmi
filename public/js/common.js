// 공통: 로고 SVG 주입, 모바일 메뉴, 설정 로드
(function () {
  const LEAF = 'M0 0 Q-22 8 -46 -8 Q-34 -18 -26 -28 Q-48 -34 -42 -52 Q-26 -50 -14 -56 Q-14 -78 4 -88 Q20 -76 20 -56 Q34 -64 48 -60 Q46 -40 30 -28 Q46 -26 54 -12 Q30 8 0 0 Z';
  const BERRIES = [[-27,0,1],[-9,0,0],[9,0,1],[27,0,0],[-18,15.5,0],[0,15.5,1],[18,15.5,0],[-9,31,1],[9,31,0],[0,46,1]]
    .map(([x, y, d]) => `<circle cx="${x}" cy="${y}" r="9" fill="${d ? '#4B2A57' : '#6A3E78'}"/>`).join('');
  const CLUSTER = `<path d="M10 -9 C17 -10 22 -16 25 -22 C28 -28 34 -28 35 -24 C36 -20 32 -18 30 -21" stroke="#9AA35A" stroke-width="1.6" fill="none" stroke-linecap="round"/>`
    + `<path transform="translate(6,-4) rotate(22) scale(.42)" d="${LEAF}" fill="#6E7B3B"/>` + BERRIES;

  // 헤더용 작은 배지 (이중 원 + 포도송이)
  const MARK = `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="#F5F0E6" stroke="#6E7B3B" stroke-width="3"/><circle cx="50" cy="50" r="41" fill="none" stroke="#6E7B3B" stroke-width="1"/><g transform="translate(50,38) scale(.72)">${CLUSTER}</g></svg>`;

  // 1f 원형 배지 전체
  let uid = 0;
  function badge() {
    const id = 'arc' + (++uid);
    return `<svg viewBox="0 0 300 300" role="img" aria-label="진미농원 Jin-mi Farm 로고">
      <defs><path id="${id}" d="M58,150 A92,92 0 0,1 242,150"/></defs>
      <circle cx="150" cy="150" r="146" fill="#F5F0E6"/>
      <circle cx="150" cy="150" r="138" fill="none" stroke="#6E7B3B" stroke-width="3"/>
      <circle cx="150" cy="150" r="130" fill="none" stroke="#6E7B3B" stroke-width="1"/>
      <path d="M40 186 C80 208 120 172 150 190 S220 206 260 184" stroke="#6E7B3B" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path transform="translate(88,191) rotate(-40) scale(.3)" d="${LEAF}" fill="#6E7B3B"/>
      <path transform="translate(212,198) rotate(140) scale(.28)" d="${LEAF}" fill="#9AA35A"/>
      <path d="M172 194 c4 -14 20 -12 18 -2 c-2 7 -10 6 -9 0" stroke="#6E7B3B" stroke-width="2" fill="none" stroke-linecap="round"/>
      <text font-family="Caveat, cursive" font-weight="700" font-size="26" fill="#6E7B3B" text-anchor="middle"><textPath href="#${id}" startOffset="50%">Organic Farming</textPath></text>
      <g transform="translate(150,96) scale(.62)">${CLUSTER}</g>
      <text x="150" y="172" text-anchor="middle" font-family="'East Sea Dokdo', serif" font-size="64" fill="#4B2A57">진미농원</text>
      <text x="150" y="236" text-anchor="middle" font-family="Caveat, cursive" font-weight="500" font-size="22" fill="#4B2A57">Jin-mi Farm</text>
    </svg>`;
  }

  document.querySelectorAll('[data-logo="mark"]').forEach(el => { el.innerHTML = MARK; });
  document.querySelectorAll('[data-logo="badge"]').forEach(el => { el.innerHTML = badge(); });

  // 모바일 메뉴
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => nav.classList.remove('open')));
  }

  const y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();

  window.JM = {
    esc(s) {
      return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
    async config() {
      if (!this._cfg) this._cfg = fetch('/api/config').then(r => r.json());
      return this._cfg;
    },
  };
})();
