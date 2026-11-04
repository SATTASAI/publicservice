// รายชื่อห้อง/นักเรียน/ภาคเรียน — คัดลอกตรรกะจาก students-report (src/lib/data.js) ให้เลขที่และรายชื่อตรงกับระบบรายงานผลการเรียน
// ถ้าแก้ลำดับเลขที่ที่ students-report ต้องแก้ไฟล์นี้ให้ตรงกัน
import { fail } from "./http.js";

export async function listYears(env) {
  const { results } = await env.DB.prepare("SELECT id, year_be, label, status FROM academic_years ORDER BY year_be DESC").all();
  return results;
}

export async function resolveYear(env, value) {
  if (value) {
    const row = await env.DB.prepare("SELECT id, year_be, label, status FROM academic_years WHERE id = ?").bind(Number(value)).first();
    if (!row) fail(404, "ไม่พบปีการศึกษา");
    return row;
  }
  const row = await env.DB.prepare(
    "SELECT id, year_be, label, status FROM academic_years ORDER BY (status = 'active') DESC, year_be DESC LIMIT 1"
  ).first();
  if (!row) fail(404, "ยังไม่มีปีการศึกษาในระบบ — ให้ตั้งค่าที่ระบบบริหารโรงเรียนก่อน");
  return row;
}

export const thaiToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

export async function yearTerms(env, yearId) {
  const { results } = await env.DB.prepare("SELECT term_number, start_date, end_date FROM academic_terms WHERE academic_year_id = ? ORDER BY term_number").bind(yearId).all();
  return results.filter((t) => t.term_number === 1 || t.term_number === 2);
}

export function currentTerm(terms, today = thaiToday()) {
  if (!terms.length) return 1;
  const inside = terms.find((t) => today >= t.start_date && today <= t.end_date);
  if (inside) return inside.term_number;
  const next = terms.find((t) => today < t.start_date);
  return next ? next.term_number : terms.at(-1).term_number;
}

const GRADE_ORDER = ["อ.1", "อ.2", "อ.3", "ป.1", "ป.2", "ป.3", "ป.4", "ป.5", "ป.6"];
const compareGrade = (a, b) => {
  const ia = GRADE_ORDER.indexOf(a), ib = GRADE_ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || String(a).localeCompare(String(b), "th");
};
export const compareRoom = (a, b) => compareGrade(a.grade_level, b.grade_level) ||
  String(a.classroom).localeCompare(String(b.classroom), "th", { numeric: true });
// กิจกรรมเพื่อสังคมฯ อยู่ใน ปพ.6 ของชั้นประถม
export const isPrimaryGrade = (g) => /^ป\.[1-6]$/.test(g);

const ROSTER_CTE = `WITH ranked AS (
  SELECT se.student_id, se.grade_level, se.classroom, se.status,
         ROW_NUMBER() OVER (PARTITION BY se.student_id ORDER BY t.term_number DESC, se.id DESC) AS rn
    FROM student_enrollments se JOIN academic_terms t ON t.id = se.academic_term_id
   WHERE t.academic_year_id = ?)`;

export async function listRooms(env, yearId) {
  const { results } = await env.DB.prepare(
    `${ROSTER_CTE}
     SELECT grade_level, classroom, SUM(CASE WHEN status = 'enrolled' THEN 1 ELSE 0 END) AS students
       FROM ranked WHERE rn = 1 AND grade_level IS NOT NULL AND classroom IS NOT NULL
      GROUP BY grade_level, classroom`
  ).bind(yearId).all();
  return results.filter((r) => isPrimaryGrade(r.grade_level)).sort(compareRoom);
}

export const LEFT_STATUSES = ["transferred", "withdrawn"];
const LEFT_SQL = `('transferred','withdrawn')`;

async function rosterOrder(env, yearId) {
  try {
    const row = await env.DB.prepare("SELECT roster_order FROM gr_settings WHERE academic_year_id = ?").bind(yearId).first();
    return row?.roster_order || "gender";
  } catch { return "gender"; }
}

// รายชื่อนักเรียนของห้อง ณ ภาคเรียนล่าสุดของปี (เลขที่ตรงกับระบบรายงานผลการเรียน)
export async function roomRoster(env, yearId, grade, room) {
  const { results } = await env.DB.prepare(
    `${ROSTER_CTE}
     SELECT s.id, s.student_code, s.name_prefix, s.first_name, s.last_name, s.full_name, d.gender, r.status AS enrollment_status,
            (SELECT MIN(t.term_number) FROM gr_transfers t WHERE t.student_id = s.id AND t.academic_year_id = ? AND t.direction = 'in' AND t.undone_at IS NULL) AS transfer_in_term,
            (SELECT n.number FROM gr_roster_numbers n WHERE n.academic_year_id = ? AND n.student_id = s.id) AS manual_number
       FROM ranked r JOIN students s ON s.id = r.student_id
       LEFT JOIN student_details d ON d.student_id = s.id
      WHERE r.rn = 1 AND r.grade_level = ? AND r.classroom = ?
        AND (r.status NOT IN ${LEFT_SQL} OR EXISTS (SELECT 1 FROM gr_roster_numbers n WHERE n.academic_year_id = ? AND n.student_id = s.id))`
  ).bind(yearId, yearId, yearId, grade, room, yearId).all();
  return sortRoster(results, await rosterOrder(env, yearId));
}

const genderRank = (g) => (/^(ช|ชาย|M)/i.test(g || "") ? 0 : /^(ญ|หญิง|F)/i.test(g || "") ? 1 : 2);
function sortRoster(rows, order) {
  const left = (r) => LEFT_STATUSES.includes(r.enrollment_status);
  const late = (r) => (r.transfer_in_term ? 1 : 0);
  rows.sort((a, b) => left(a) - left(b) || late(a) - late(b) ||
    (order === "gender" ? genderRank(a.gender) - genderRank(b.gender) : 0) ||
    String(a.student_code).localeCompare(String(b.student_code), "th", { numeric: true }));
  const owner = new Map();
  for (const r of rows) if (!left(r) && r.manual_number && !owner.has(r.manual_number)) owner.set(r.manual_number, r);
  const fixed = new Set([...owner.keys(), ...rows.filter((r) => left(r) && r.manual_number).map((r) => r.manual_number)]);
  let n = 0;
  for (const r of rows) {
    if (left(r)) { r.number = r.manual_number || null; continue; }
    if (r.manual_number && owner.get(r.manual_number) === r) { r.number = r.manual_number; continue; }
    do n++; while (fixed.has(n));
    r.number = n;
  }
  if (fixed.size) rows.sort((a, b) => left(a) - left(b) || (a.number ?? 999) - (b.number ?? 999));
  return rows;
}

export function studentName(s) {
  if (s.first_name || s.last_name) return `${s.name_prefix || ""}${s.first_name || ""} ${s.last_name || ""}`.trim();
  return s.full_name;
}
