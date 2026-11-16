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
  // ส่งต่อฝ่ายปกครองพิจารณา: หัก ≥ refer_min (ค่าเริ่มต้น 10) ส่งต่ออัตโนมัติ หรือครูกดส่งต่อเอง
  // ยังไม่หักคะแนนจนกว่าครูฝ่ายปกครองกด (record_id/warning_id = รายการที่เกิดขึ้น · decided_by = ครูฝ่ายปกครองที่กด)
  `CREATE TABLE IF NOT EXISTS ps_referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    academic_year_id INTEGER NOT NULL,
    term_number INTEGER NOT NULL CHECK (term_number IN (1, 2)),
    student_id INTEGER NOT NULL, grade_level TEXT, classroom TEXT,
    points INTEGER NOT NULL CHECK (points BETWEEN 1 AND 100),
    reason TEXT NOT NULL, incident_date TEXT, note TEXT, auto INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'deducted', 'warned', 'rejected', 'cancelled')),
    referred_by INTEGER NOT NULL, referred_at TEXT NOT NULL DEFAULT (datetime('now')),
    decided_by INTEGER, decided_at TEXT, decision_note TEXT, record_id INTEGER, warning_id INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_ps_ref_status ON ps_referrals(status, academic_year_id, term_number)`,
  `CREATE INDEX IF NOT EXISTS idx_ps_ref_day ON ps_referrals(student_id, incident_date)`,
  `CREATE INDEX IF NOT EXISTS idx_ps_ref_record ON ps_referrals(record_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ps_ref_warning ON ps_referrals(warning_id)`,
  // บันทึกความดี — ตารางของระบบบริหารโรงเรียน (system, src/routes/student-merit.js) ใช้ร่วมกันสองทาง · โครงสร้างต้องตรงกับที่นั่น
  // ps_record_id = รายการเพิ่มคะแนนที่ฝ่ายปกครองอนุมัติ
  `CREATE TABLE IF NOT EXISTS good_deeds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    deed_date TEXT NOT NULL, category TEXT NOT NULL, detail TEXT,
    academic_year INTEGER NOT NULL, term INTEGER NOT NULL,
    ps_record_id INTEGER, created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_good_deeds_year ON good_deeds(academic_year, term, student_id)`,
  // ผลพิจารณาความดีของฝ่ายปกครอง: approved (เพิ่มคะแนนตามประเภท) | rejected (ไม่เพิ่ม แต่ยังเป็นบันทึกความดี) · ไม่มีแถว = รอพิจารณา
  `CREATE TABLE IF NOT EXISTS ps_merit_reviews (
    deed_id INTEGER PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('approved', 'rejected')),
    points INTEGER, record_id INTEGER, decided_by INTEGER NOT NULL, decided_at TEXT NOT NULL DEFAULT (datetime('now')), note TEXT)`,
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
