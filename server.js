// 진미농원 홈페이지 서버 — Node.js 내장 http + MySQL/MariaDB(mysql2)
// 실행: npm start   (설정은 .env 파일)
const fs = require('fs');
const path = require('path');
// .env 읽기 (구버전 Node 호환을 위해 직접 파싱, 이미 있는 환경변수는 덮어쓰지 않음)
const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const { pool, migrate, waitForDb, hashPassword, verifyPassword } = require('./db');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const SESSION_HOURS = 12;
const COOKIE = 'jm_admin';
const STATUSES = ['pending', 'confirmed', 'done', 'cancelled'];
const GROUP_TYPES = ['가족·개인', '어린이집·유치원', '학교', '기관·단체', '기타'];

// ---------- 공통 유틸 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8',
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
};
function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && body !== null && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 50_000) { reject(new HttpError(413, '요청이 너무 큽니다.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new HttpError(400, '요청 형식이 올바르지 않습니다.')); }
    });
    req.on('error', reject);
  });
}
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v, min, max) => {
  const n = typeof v === 'number' ? v : Number.parseInt(v, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const todayKST = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function normalizePhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (/^01\d{8,9}$/.test(d)) return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (/^0\d{8,10}$/.test(d)) return d.startsWith('02')
    ? `02-${d.slice(2, d.length - 4)}-${d.slice(-4)}`
    : `${d.slice(0, 3)}-${d.slice(3, d.length - 4)}-${d.slice(-4)}`;
  return null;
}
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const isHttps = req => req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
function rowToReservation(r) {
  return {
    id: r.id, no: r.reservation_no, programId: r.program_id, programName: r.program_name,
    date: r.visit_date, time: r.visit_time, adults: r.adults, children: r.children,
    name: r.name, phone: r.phone, groupType: r.group_type, groupName: r.group_name,
    request: r.request || '', status: r.status, adminMemo: r.admin_memo || '',
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// ---------- 로그인 시도 제한 (메모리) ----------
const loginAttempts = new Map();
function checkRateLimit(key) {
  const a = loginAttempts.get(key);
  if (a && a.until > Date.now()) fail(429, '로그인 시도가 너무 많습니다. 10분 후 다시 시도해 주세요.');
}
function recordFailure(key) {
  const a = loginAttempts.get(key) || { count: 0, until: 0 };
  a.count += 1;
  if (a.count >= 5) { a.count = 0; a.until = Date.now() + 10 * 60e3; }
  loginAttempts.set(key, a);
}

// ---------- 인증 ----------
async function currentAdmin(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const [rows] = await pool.query(
    `SELECT a.id, a.username, a.must_change FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
     WHERE s.token_hash = ? AND s.expires_at > NOW()`, [sha256(token)]);
  return rows[0] ? { id: rows[0].id, username: rows[0].username, mustChange: !!rows[0].must_change } : null;
}
function sessionCookie(req, token, maxAgeSec) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${isHttps(req) ? '; Secure' : ''}`;
}

// ---------- 예약 검증 ----------
async function validateDate(date, program) {
  if (!isDate(date)) fail(400, '날짜 형식이 올바르지 않습니다.');
  const today = todayKST();
  if (date <= today) fail(400, '예약은 내일 이후 날짜만 가능합니다.');
  if (date > addDays(today, config.maxDaysAhead)) fail(400, `예약은 ${config.maxDaysAhead}일 이내 날짜만 가능합니다.`);
  const [b] = await pool.query('SELECT 1 FROM blocked_dates WHERE blocked_date = ?', [date]);
  if (b.length) fail(400, '선택하신 날짜는 농원 휴무일입니다. 다른 날짜를 골라주세요.');
  if (!program.months.includes(Number(date.slice(5, 7)))) fail(400, `${program.name}은(는) ${program.season}에만 운영합니다.`);
}
async function newReservationNo(conn) {
  const d = todayKST().replace(/-/g, '').slice(2);
  for (;;) {
    const no = `JM${d}-${crypto.randomInt(1000, 10000)}`;
    const [r] = await conn.query('SELECT 1 FROM reservations WHERE reservation_no = ?', [no]);
    if (!r.length) return no;
  }
}

// ---------- 공개 API ----------
async function apiPublic(req, res, url) {
  const p = url.pathname, m = req.method;

  if (p === '/api/config' && m === 'GET') {
    return send(res, 200, {
      farm: config.farm, slots: config.slots, capacityPerSlot: config.capacityPerSlot,
      maxDaysAhead: config.maxDaysAhead, programs: config.programs, today: todayKST(),
    });
  }

  if (p === '/api/availability' && m === 'GET') {
    const month = url.searchParams.get('month') || '';
    if (!/^\d{4}-\d{2}$/.test(month)) fail(400, 'month=YYYY-MM 형식이 필요합니다.');
    const from = `${month}-01`, to = addDays(addDays(from, 31).slice(0, 8) + '01', -1);
    const [rows] = await pool.query(
      `SELECT visit_date AS d, visit_time AS t, SUM(adults + children) AS n FROM reservations
       WHERE visit_date BETWEEN ? AND ? AND status <> 'cancelled' GROUP BY visit_date, visit_time`, [from, to]);
    const [blocked] = await pool.query('SELECT blocked_date AS d FROM blocked_dates WHERE blocked_date BETWEEN ? AND ?', [from, to]);
    const booked = {};
    for (const r of rows) booked[`${r.d} ${r.t}`] = Number(r.n);
    return send(res, 200, { blocked: blocked.map(b => b.d), booked, capacityPerSlot: config.capacityPerSlot });
  }

  if (p === '/api/reservations' && m === 'POST') {
    const b = await readBody(req);
    if (str(b.website, 100)) return send(res, 201, { no: 'OK' }); // 스팸봇 함정 필드
    const program = config.programs.find(x => x.id === b.programId);
    const name = str(b.name, 30);
    const phone = normalizePhone(b.phone);
    const date = str(b.date, 10);
    const time = str(b.time, 5);
    const adults = int(b.adults, 0, 300);
    const children = int(b.children, 0, 300);
    const groupType = GROUP_TYPES.includes(b.groupType) ? b.groupType : '기타';
    const groupName = str(b.groupName, 50);
    const request = str(b.request, 1000);

    if (!program) fail(400, '체험 프로그램을 선택해 주세요.');
    if (!name) fail(400, '예약자 성함을 입력해 주세요.');
    if (!phone) fail(400, '연락처를 정확히 입력해 주세요. (예: 010-1234-5678)');
    if (!config.slots.includes(time)) fail(400, '체험 시간을 선택해 주세요.');
    if (adults === null || children === null || adults + children < 1) fail(400, '인원을 1명 이상 입력해 주세요.');
    if (b.agree !== true) fail(400, '개인정보 수집·이용에 동의해 주세요.');
    await validateDate(date, program);

    // 같은 날짜·시간 동시 예약 시 정원 초과를 막기 위해 슬롯 단위 잠금
    const conn = await pool.getConnection();
    const lockName = `jinmi:${date}:${time}`;
    try {
      const [[lock]] = await conn.query('SELECT GET_LOCK(?, 10) AS ok', [lockName]);
      if (!lock.ok) fail(503, '예약이 몰리고 있어요. 잠시 후 다시 시도해 주세요.');
      const [[{ n }]] = await conn.query(
        `SELECT COALESCE(SUM(adults + children), 0) AS n FROM reservations
         WHERE visit_date = ? AND visit_time = ? AND status <> 'cancelled'`, [date, time]);
      const remain = config.capacityPerSlot - Number(n);
      if (adults + children > remain) {
        fail(409, remain > 0
          ? `해당 시간은 ${remain}명까지만 예약할 수 있어요. 더 많은 인원은 전화(${config.farm.phone})로 문의해 주세요.`
          : '해당 시간은 예약이 마감되었습니다. 다른 시간을 선택해 주세요.');
      }
      const no = await newReservationNo(conn);
      await conn.query(
        `INSERT INTO reservations (reservation_no, program_id, program_name, visit_date, visit_time,
          adults, children, name, phone, group_type, group_name, request)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [no, program.id, program.name, date, time, adults, children, name, phone, groupType, groupName, request]);
      return send(res, 201, { no, date, time, programName: program.name, adults, children });
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
      conn.release();
    }
  }

  // 예약 조회 (예약번호 + 연락처)
  if (p === '/api/reservations/lookup' && m === 'POST') {
    const b = await readBody(req);
    const key = 'lookup:' + (req.socket.remoteAddress || '');
    checkRateLimit(key);
    const no = str(b.no, 20).toUpperCase();
    const phone = normalizePhone(b.phone);
    const [rows] = phone
      ? await pool.query('SELECT * FROM reservations WHERE reservation_no = ? AND phone = ?', [no, phone])
      : [[]];
    if (!rows.length) { recordFailure(key); fail(404, '일치하는 예약을 찾지 못했어요. 예약번호와 연락처를 확인해 주세요.'); }
    const r = rowToReservation(rows[0]);
    return send(res, 200, {
      no: r.no, programName: r.programName, date: r.date, time: r.time,
      adults: r.adults, children: r.children, name: r.name, status: r.status,
    });
  }

  fail(404, 'Not found');
}

// ---------- 관리자 API ----------
async function apiAdmin(req, res, url) {
  const p = url.pathname, m = req.method;

  // 변경 요청은 JSON 으로만 받음 (단순 폼 기반 CSRF 차단)
  if (m !== 'GET' && !(req.headers['content-type'] || '').startsWith('application/json')) {
    fail(415, 'JSON 요청만 허용됩니다.');
  }

  if (p === '/api/admin/login' && m === 'POST') {
    const key = 'login:' + (req.socket.remoteAddress || '');
    checkRateLimit(key);
    const b = await readBody(req);
    const username = str(b.username, 40);
    const password = typeof b.password === 'string' ? b.password : '';
    const [rows] = await pool.query('SELECT * FROM admins WHERE username = ?', [username]);
    const ok = rows[0] && await verifyPassword(password, rows[0].password_hash);
    if (!ok) { recordFailure(key); fail(401, '아이디 또는 비밀번호가 올바르지 않습니다.'); }
    loginAttempts.delete(key);
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query('INSERT INTO admin_sessions (token_hash, admin_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))',
      [sha256(token), rows[0].id, SESSION_HOURS]);
    await pool.query('UPDATE admins SET last_login_at = NOW() WHERE id = ?', [rows[0].id]);
    return send(res, 200, { username: rows[0].username, mustChange: !!rows[0].must_change },
      { 'Set-Cookie': sessionCookie(req, token, SESSION_HOURS * 3600) });
  }

  const admin = await currentAdmin(req);
  if (!admin) fail(401, '로그인이 필요합니다.');

  if (p === '/api/admin/logout' && m === 'POST') {
    const token = parseCookies(req)[COOKIE];
    await pool.query('DELETE FROM admin_sessions WHERE token_hash = ?', [sha256(token)]);
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }
  if (p === '/api/admin/me' && m === 'GET') return send(res, 200, admin);

  if (p === '/api/admin/password' && m === 'POST') {
    const b = await readBody(req);
    const next = typeof b.next === 'string' ? b.next : '';
    const [[row]] = await pool.query('SELECT password_hash FROM admins WHERE id = ?', [admin.id]);
    if (!await verifyPassword(typeof b.current === 'string' ? b.current : '', row.password_hash)) fail(400, '현재 비밀번호가 올바르지 않습니다.');
    if (next.length < 8) fail(400, '새 비밀번호는 8자 이상이어야 합니다.');
    if (next === b.current) fail(400, '새 비밀번호가 현재 비밀번호와 같습니다.');
    await pool.query('UPDATE admins SET password_hash = ?, must_change = 0 WHERE id = ?', [await hashPassword(next), admin.id]);
    // 다른 기기의 세션은 모두 종료
    await pool.query('DELETE FROM admin_sessions WHERE admin_id = ? AND token_hash <> ?', [admin.id, sha256(parseCookies(req)[COOKIE])]);
    return send(res, 200, { ok: true });
  }

  if (admin.mustChange) fail(403, '처음 로그인하셨어요. 비밀번호를 먼저 변경해 주세요.');

  // --- 예약 관리 ---
  if (p === '/api/admin/reservations' && m === 'GET') {
    const [rows] = await pool.query('SELECT * FROM reservations ORDER BY visit_date, visit_time, created_at');
    return send(res, 200, { reservations: rows.map(rowToReservation), today: todayKST(), capacityPerSlot: config.capacityPerSlot });
  }
  const one = p.match(/^\/api\/admin\/reservations\/(\d+)$/);
  if (one) {
    const id = Number(one[1]);
    const [rows] = await pool.query('SELECT * FROM reservations WHERE id = ?', [id]);
    if (!rows.length) fail(404, '예약을 찾을 수 없습니다.');
    if (m === 'PATCH') {
      const b = await readBody(req);
      const sets = [], vals = [];
      if (b.status !== undefined) {
        if (!STATUSES.includes(b.status)) fail(400, '상태 값이 올바르지 않습니다.');
        sets.push('status = ?'); vals.push(b.status);
      }
      if (b.adminMemo !== undefined) { sets.push('admin_memo = ?'); vals.push(str(b.adminMemo, 2000)); }
      if (b.date !== undefined || b.time !== undefined) {
        const date = b.date !== undefined ? str(b.date, 10) : rows[0].visit_date;
        const time = b.time !== undefined ? str(b.time, 5) : rows[0].visit_time;
        if (!isDate(date)) fail(400, '날짜 형식이 올바르지 않습니다.');
        if (!config.slots.includes(time)) fail(400, '시간 값이 올바르지 않습니다.');
        sets.push('visit_date = ?', 'visit_time = ?'); vals.push(date, time);
      }
      if (!sets.length) fail(400, '변경할 내용이 없습니다.');
      await pool.query(`UPDATE reservations SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
      const [[r]] = await pool.query('SELECT * FROM reservations WHERE id = ?', [id]);
      return send(res, 200, rowToReservation(r));
    }
    if (m === 'DELETE') {
      await pool.query('DELETE FROM reservations WHERE id = ?', [id]);
      return send(res, 200, { ok: true });
    }
  }

  // --- 휴무일 ---
  if (p === '/api/admin/blocked-dates') {
    if (m === 'POST' || m === 'DELETE') {
      const b = await readBody(req);
      const date = str(b.date, 10);
      if (!isDate(date)) fail(400, '날짜 형식이 올바르지 않습니다.');
      if (m === 'POST') {
        await pool.query('INSERT INTO blocked_dates (blocked_date, reason) VALUES (?, ?) ON DUPLICATE KEY UPDATE reason = VALUES(reason)',
          [date, str(b.reason, 100)]);
      } else {
        await pool.query('DELETE FROM blocked_dates WHERE blocked_date = ?', [date]);
      }
    } else if (m !== 'GET') fail(405, 'Method not allowed');
    const [rows] = await pool.query('SELECT blocked_date AS date, reason FROM blocked_dates WHERE blocked_date >= ? ORDER BY blocked_date', [addDays(todayKST(), -30)]);
    return send(res, 200, { blockedDates: rows });
  }

  // --- 관리자 계정 ---
  if (p === '/api/admin/accounts' && m === 'GET') {
    const [rows] = await pool.query('SELECT id, username, created_at AS createdAt, last_login_at AS lastLoginAt FROM admins ORDER BY id');
    return send(res, 200, { accounts: rows, me: admin.id });
  }
  if (p === '/api/admin/accounts' && m === 'POST') {
    const b = await readBody(req);
    const username = str(b.username, 40);
    const password = typeof b.password === 'string' ? b.password : '';
    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) fail(400, '아이디는 영문·숫자 3자 이상으로 입력해 주세요.');
    if (password.length < 8) fail(400, '비밀번호는 8자 이상이어야 합니다.');
    const [dup] = await pool.query('SELECT 1 FROM admins WHERE username = ?', [username]);
    if (dup.length) fail(409, '이미 있는 아이디입니다.');
    await pool.query('INSERT INTO admins (username, password_hash, must_change) VALUES (?, ?, 1)', [username, await hashPassword(password)]);
    return send(res, 201, { ok: true });
  }
  const acc = p.match(/^\/api\/admin\/accounts\/(\d+)$/);
  if (acc && m === 'DELETE') {
    const id = Number(acc[1]);
    if (id === admin.id) fail(400, '현재 로그인한 계정은 삭제할 수 없습니다.');
    await pool.query('DELETE FROM admins WHERE id = ?', [id]);
    return send(res, 200, { ok: true });
  }

  fail(404, 'Not found');
}

// ---------- 정적 파일 ----------
function serveStatic(req, res, url) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'Bad request'); }
  if (rel === '/') rel = '/index.html';
  if (['/reserve', '/admin'].includes(rel)) rel += '.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      return fs.readFile(path.join(PUBLIC_DIR, '404.html'), (e, buf) =>
        e ? send(res, 404, 'Not found') : send(res, 404, buf, { 'Content-Type': MIME['.html'] }));
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
      ...SECURITY_HEADERS,
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// ---------- 시작 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/admin/')) return await apiAdmin(req, res, url);
    if (url.pathname.startsWith('/api/')) return await apiPublic(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

(async () => {
  try {
    await waitForDb();
    await migrate();
  } catch (e) {
    console.error('데이터베이스 연결/초기화 실패:', e.message);
    process.exit(1);
  }
  server.listen(PORT, () => {
    console.log(`진미농원 홈페이지: http://localhost:${PORT}`);
    console.log(`관리자 페이지:     http://localhost:${PORT}/admin`);
  });
})();

module.exports = server;
