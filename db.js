// MySQL / MariaDB / TiDB Cloud 연결 + 테이블 자동 생성
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const CONN = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  charset: 'utf8mb4',
  timezone: '+09:00',
  dateStrings: true,
  // TiDB Cloud 같은 외부 DB는 암호화 연결 필수 → DB_SSL=true
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
};
const DB_NAME = String(process.env.DB_NAME || '').replace(/`/g, '');

const pool = mysql.createPool({ ...CONN, database: DB_NAME, connectionLimit: 5, waitForConnections: true });
// DB 서버 시간대(TiDB는 UTC)와 상관없이 NOW() 가 한국 시간이 되도록
pool.pool.on('connection', conn => conn.query("SET time_zone = '+09:00'"));

// DB가 없으면 만든다 (TiDB Cloud 는 처음에 test DB 만 있음)
async function ensureDatabase() {
  const conn = await mysql.createConnection(CONN);
  try {
    await conn.query('CREATE DATABASE IF NOT EXISTS `' + DB_NAME + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  } catch (e) {
    // DB 생성 권한이 없는 계정이면 건너뜀 (이미 DB가 있는 경우). 진짜 문제면 다음 접속에서 드러남
    if (!/denied/i.test(e.message)) throw e;
  } finally { await conn.end(); }
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(40) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    must_change TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at DATETIME NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash CHAR(64) PRIMARY KEY,
    admin_id INT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_admin (admin_id),
    CONSTRAINT fk_session_admin FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS reservations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    reservation_no VARCHAR(20) NOT NULL UNIQUE,
    program_id VARCHAR(30) NOT NULL,
    program_name VARCHAR(60) NOT NULL,
    visit_date DATE NOT NULL,
    visit_time VARCHAR(5) NOT NULL,
    adults SMALLINT NOT NULL DEFAULT 0,
    children SMALLINT NOT NULL DEFAULT 0,
    name VARCHAR(30) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    group_type VARCHAR(20) NOT NULL,
    group_name VARCHAR(50) NOT NULL DEFAULT '',
    request TEXT NULL,
    status ENUM('pending','confirmed','done','cancelled') NOT NULL DEFAULT 'pending',
    admin_memo TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_slot (visit_date, visit_time, status),
    INDEX idx_phone (phone)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS slot_locks (
    slot_key VARCHAR(20) PRIMARY KEY
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS blocked_dates (
    blocked_date DATE PRIMARY KEY,
    reason VARCHAR(100) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

// 비밀번호 해시: scrypt (Node 내장) — 형식 scrypt$salt$hash
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
async function verifyPassword(pw, stored) {
  const [alg, saltHex, keyHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = await scrypt(pw, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(keyHex, 'hex');
  return expected.length === key.length && crypto.timingSafeEqual(expected, key);
}

async function migrate() {
  for (const sql of SCHEMA) await pool.query(sql);
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM admins');
  if (n === 0) {
    const id = process.env.INITIAL_ADMIN_ID || 'admin';
    const pw = process.env.INITIAL_ADMIN_PASSWORD;
    if (!pw) throw new Error('관리자 계정이 없습니다. .env 에 INITIAL_ADMIN_PASSWORD 를 지정해 주세요.');
    await pool.query('INSERT INTO admins (username, password_hash, must_change) VALUES (?, ?, 1)', [id, await hashPassword(pw)]);
    console.log(`[초기 설정] 관리자 계정 '${id}' 을(를) 만들었습니다. 첫 로그인 후 비밀번호를 바꿔주세요.`);
  }
  await pool.query('DELETE FROM admin_sessions WHERE expires_at < NOW()');
}

async function waitForDb(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try { await ensureDatabase(); await pool.query('SELECT 1'); return; } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

module.exports = { pool, migrate, waitForDb, hashPassword, verifyPassword };
