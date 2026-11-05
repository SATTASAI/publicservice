// ตารางของระบบคะแนนพฤติกรรม (ขึ้นต้นด้วย ps_) อยู่ใน D1 เดียวกับระบบบริหารโรงเรียน/ระบบรายงานผลการเรียน
// ระบบรายงานผลการเรียน (students-report) อ่าน ps_behavior_records เพื่อสรุปผล "กิจกรรมเพื่อสังคมและสาธารณประโยชน์" ใน ปพ.6
const STATEMENTS = [
  // points: ติดลบ = ตัดคะแนน, บวก = เพิ่มคะแนน · term_number 1|2 · ยกเลิกแล้วไม่นับ (ไม่ลบแถว)
  `CREATE TABLE IF NOT EXISTS ps_behavior_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    academic_year_id INTEGER NOT NULL,
    term_number INTEGER NOT NULL CHECK (term_number IN (1, 2)),
    student_id INTEGER NOT NULL,
    points INTEGER NOT NULL CHECK (points <> 0 AND points BETWEEN -100 AND 100),
    reason TEXT NOT NULL,
    incident_date TEXT,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    cancelled_at TEXT, cancelled_by INTEGER, cancel_reason TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_ps_behavior_student ON ps_behavior_records(academic_year_id, student_id, term_number)`,
  // ครูฝ่ายปกครอง (บันทึกได้ทุกห้อง) — ผู้ดูแลระบบ/ผู้บริหารเป็นผู้กำหนด
  `CREATE TABLE IF NOT EXISTS ps_staff_roles (
    user_id INTEGER PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('discipline')),
    assigned_by INTEGER, assigned_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  // Superadmin ปิดสิทธิ์ฝ่ายปกครองอัตโนมัติของครูฝ่ายบริหารทั่วไปรายคน
  `CREATE TABLE IF NOT EXISTS ps_staff_revoked (
    user_id INTEGER PRIMARY KEY, revoked_by INTEGER, revoked_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS ps_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT NOT NULL, detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  // ตั้งค่าระบบ (key/value) เช่น เวลาเปิด-ปิดการบันทึก
  `CREATE TABLE IF NOT EXISTS ps_settings (key TEXT PRIMARY KEY, value TEXT, updated_by INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_ps_behavior_day ON ps_behavior_records(student_id, incident_date)`,
  // ตักเตือนก่อนตัดคะแนน (ไม่มีคะแนน — students-report ไม่อ่านตารางนี้) · เรื่องเดียวกันต้องเตือนครบตามที่ตั้งค่าในภาคเรียนจึงตัดได้
  `CREATE TABLE IF NOT EXISTS ps_behavior_warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    academic_year_id INTEGER NOT NULL,
    term_number INTEGER NOT NULL CHECK (term_number IN (1, 2)),
    student_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    incident_date TEXT,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    cancelled_at TEXT, cancelled_by INTEGER, cancel_reason TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_ps_warn_student ON ps_behavior_warnings(academic_year_id, student_id, term_number)`,
  `CREATE INDEX IF NOT EXISTS idx_ps_warn_day ON ps_behavior_warnings(student_id, incident_date)`,
];

const ready = new WeakMap();
export function ensureSchema(env) {
  if (ready.has(env.DB)) return ready.get(env.DB);
  const p = env.DB.batch(STATEMENTS.map((s) => env.DB.prepare(s))).catch((e) => { ready.delete(env.DB); throw e; });
  ready.set(env.DB, p);
  return p;
}

// คะแนนพฤติกรรม: เริ่ม 100 ต่อภาคเรียน ตัด/เพิ่มได้ ไม่เกิน 100 ไม่ต่ำกว่า 0 · ต่ำกว่า 50 = กิจกรรมเพื่อสังคมฯ ไม่ผ่าน
// ไล่ตามลำดับที่บันทึก (id) ทุกขณะไม่เกิน 100 — เพิ่มตอนเต็ม 100 ไม่สะสมไว้
// สูตรเดียวกับ behaviorScores ใน students-report (src/lib/data.js) — แก้ที่หนึ่งต้องแก้อีกที่
export const BASE_SCORE = 100;
export const PASS_MIN = 50;
export const foldScore = (points) => points.reduce((s, p) => Math.max(0, Math.min(BASE_SCORE, s + Number(p))), BASE_SCORE);
