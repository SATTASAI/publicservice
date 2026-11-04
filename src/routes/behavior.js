// บันทึกคะแนนพฤติกรรม: ครูประจำชั้น (ห้องของตน) · ครูฝ่ายปกครองและผู้ดูแลระบบ/ผู้บริหาร (ทุกห้อง)
import { json, readJson, fail, requireUser, requireAdmin, intParam, text } from "../lib/http.js";
import { listYears, resolveYear, yearTerms, currentTerm, listRooms, roomRoster, studentName, isPrimaryGrade, compareRoom, LEFT_STATUSES, thaiToday } from "../lib/roster.js";
import { BASE_SCORE, PASS_MIN, foldScore } from "../lib/schema.js";

async function audit(env, user, action, detail) {
  try {
    await env.DB.prepare("INSERT INTO ps_audit (user_id, action, detail) VALUES (?, ?, ?)").bind(user?.id ?? null, action, JSON.stringify(detail ?? null)).run();
  } catch { /* ไม่ให้งานหลักล้ม */ }
}

async function editableRooms(env, user, yearId) {
  if (user.is_discipline) return listRooms(env, yearId);
  const { results } = await env.DB.prepare(
    "SELECT grade_level, classroom FROM gr_homerooms WHERE academic_year_id = ? AND user_id = ?"
  ).bind(yearId, user.id).all().catch(() => ({ results: [] }));
  const all = await listRooms(env, yearId);
  return all.filter((r) => results.some((h) => h.grade_level === r.grade_level && h.classroom === r.classroom)).sort(compareRoom);
}

const termOf = (v) => { const t = Number(v); if (t !== 1 && t !== 2) fail(400, "ระบุภาคเรียน (1 หรือ 2)"); return t; };

async function pickRoom(env, user, yearId, grade, room) {
  grade = text(grade, 10); room = text(room, 10);
  if (!isPrimaryGrade(grade) || !room) fail(400, "ห้องเรียนไม่ถูกต้อง");
  const rooms = await editableRooms(env, user, yearId);
  if (!rooms.some((r) => r.grade_level === grade && r.classroom === room)) fail(403, "บันทึกได้เฉพาะห้องที่เป็นครูประจำชั้น หรือครูฝ่ายปกครอง");
  return { grade, room, roster: await roomRoster(env, yearId, grade, room) };
}

// { student_id: { score, deduct_count, add_count } } เฉพาะคนที่มีรายการ
async function scores(env, yearId, term, ids) {
  const rows = {};
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    if (!chunk.length) continue;
    const { results } = await env.DB.prepare(
      `SELECT student_id, points FROM ps_behavior_records WHERE academic_year_id = ? AND term_number = ? AND cancelled_at IS NULL
          AND student_id IN (${chunk.map(() => "?").join(",")}) ORDER BY id`
    ).bind(yearId, term, ...chunk).all();
    for (const r of results) (rows[r.student_id] ||= []).push(r.points);
  }
  return Object.fromEntries(Object.entries(rows).map(([sid, p]) => [sid, {
    score: foldScore(p), deduct_count: p.filter((x) => x < 0).length, add_count: p.filter((x) => x > 0).length }]));
}

export async function handleMe(request, env, user, url) {
  requireUser(user);
  const year = await resolveYear(env, url.searchParams.get("year"));
  const terms = await yearTerms(env, year.id);
  return json({
    user: { id: user.id, full_name: user.full_name, role: user.role, is_admin: user.is_admin, is_discipline: user.is_discipline },
    years: await listYears(env), year, terms, term: currentTerm(terms), today: thaiToday(),
    rooms: await editableRooms(env, user, year.id), base: BASE_SCORE, pass_min: PASS_MIN,
  });
}

export async function handleRoom(request, env, user, url) {
  requireUser(user);
  const year = await resolveYear(env, url.searchParams.get("year"));
  const term = termOf(url.searchParams.get("term"));
  const { grade, room, roster } = await pickRoom(env, user, year.id, url.searchParams.get("grade"), url.searchParams.get("room"));
  const s = await scores(env, year.id, term, roster.map((r) => r.id));
  return json({ year, term, grade, room, students: roster.map((r) => {
    const score = s[r.id]?.score ?? BASE_SCORE;
    return { id: r.id, number: r.number, code: r.student_code, name: studentName(r), left: LEFT_STATUSES.includes(r.enrollment_status),
      score, pass: score >= PASS_MIN, deduct_count: Number(s[r.id]?.deduct_count || 0), add_count: Number(s[r.id]?.add_count || 0) };
  }) });
}

export async function handleRecords(request, env, user, parts, method, url) {
  requireUser(user);
  // GET /api/records?year&term&grade&room&student=ID — ประวัติของนักเรียน 1 คน
  if (method === "GET" && !parts[2]) {
    const year = await resolveYear(env, url.searchParams.get("year"));
    const term = termOf(url.searchParams.get("term"));
    const sid = intParam(url.searchParams.get("student"), "รหัสนักเรียน");
    const { roster } = await pickRoom(env, user, year.id, url.searchParams.get("grade"), url.searchParams.get("room"));
    const st = roster.find((r) => r.id === sid);
    if (!st) fail(404, "ไม่พบนักเรียนในห้องนี้");
    const { results } = await env.DB.prepare(
      `SELECT r.id, r.points, r.reason, r.incident_date, r.created_at, r.created_by, u.full_name AS created_by_name,
              r.cancelled_at, r.cancel_reason, c.full_name AS cancelled_by_name
         FROM ps_behavior_records r LEFT JOIN users u ON u.id = r.created_by LEFT JOIN users c ON c.id = r.cancelled_by
        WHERE r.academic_year_id = ? AND r.term_number = ? AND r.student_id = ? ORDER BY r.id`
    ).bind(year.id, term, sid).all();
    const score = foldScore(results.filter((r) => !r.cancelled_at).map((r) => r.points));
    return json({ student: { id: sid, number: st.number, name: studentName(st) }, score,
      records: results.reverse().map((r) => ({ ...r, can_cancel: !r.cancelled_at && (user.is_discipline || r.created_by === user.id) })) });
  }

  // POST /api/records — ตัด/เพิ่มคะแนน (เลือกได้หลายคนพร้อมกัน)
  if (method === "POST" && !parts[2]) {
    const b = await readJson(request);
    const year = await resolveYear(env, b.year);
    const term = termOf(b.term);
    const { grade, room, roster } = await pickRoom(env, user, year.id, b.grade, b.room);
    const amount = Number(b.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > 100) fail(400, "จำนวนคะแนนต้องเป็นจำนวนเต็ม 1–100");
    if (b.kind !== "deduct" && b.kind !== "add") fail(400, "เลือกตัดหรือเพิ่มคะแนน");
    const reason = text(b.reason, 300);
    if (!reason) fail(400, "กรุณาระบุเหตุผล");
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.incident_date || "")) ? b.incident_date : thaiToday();
    const ids = [...new Set((Array.isArray(b.student_ids) ? b.student_ids : []).map(Number))];
    if (!ids.length) fail(400, "เลือกนักเรียนอย่างน้อย 1 คน");
    const active = new Set(roster.filter((r) => !LEFT_STATUSES.includes(r.enrollment_status)).map((r) => r.id));
    for (const id of ids) if (!active.has(id)) fail(400, "มีนักเรียนที่ไม่อยู่ในห้องนี้ หรือย้ายออกแล้ว");
    const points = b.kind === "deduct" ? -amount : amount;
    await env.DB.batch(ids.map((sid) => env.DB.prepare(
      "INSERT INTO ps_behavior_records (academic_year_id, term_number, student_id, points, reason, incident_date, created_by) VALUES (?,?,?,?,?,?,?)"
    ).bind(year.id, term, sid, points, reason, date, user.id)));
    await audit(env, user, "behavior.add", { grade, room, term, points, reason, students: ids });
    return json({ ok: true, saved: ids.length });
  }

  // POST /api/records/:id/cancel — ผู้บันทึก หรือครูฝ่ายปกครอง/ผู้ดูแล ยกเลิกได้ (ต้องมีเหตุผล)
  if (method === "POST" && parts[3] === "cancel") {
    const id = intParam(parts[2]);
    const b = await readJson(request);
    const reason = text(b.reason, 300);
    if (!reason) fail(400, "กรุณาระบุเหตุผลที่ยกเลิก");
    const rec = await env.DB.prepare("SELECT * FROM ps_behavior_records WHERE id = ?").bind(id).first();
    if (!rec) fail(404, "ไม่พบรายการ");
    if (rec.cancelled_at) fail(409, "รายการนี้ถูกยกเลิกแล้ว");
    if (!user.is_discipline && rec.created_by !== user.id) fail(403, "ยกเลิกได้เฉพาะรายการที่ตนบันทึก");
    if (!user.is_discipline) {
      // ครูประจำชั้นต้องยังเป็นครูประจำชั้นของห้องนักเรียนคนนี้
      const rooms = await editableRooms(env, user, rec.academic_year_id);
      let found = false;
      for (const r of rooms) if ((await roomRoster(env, rec.academic_year_id, r.grade_level, r.classroom)).some((s) => s.id === rec.student_id)) { found = true; break; }
      if (!found) fail(403, "นักเรียนไม่อยู่ในห้องที่ท่านดูแล");
    }
    await env.DB.prepare("UPDATE ps_behavior_records SET cancelled_at = datetime('now'), cancelled_by = ?, cancel_reason = ? WHERE id = ? AND cancelled_at IS NULL")
      .bind(user.id, reason, id).run();
    await audit(env, user, "behavior.cancel", { id, reason });
    return json({ ok: true });
  }
  fail(405, "ไม่รองรับ");
}

// ครูฝ่ายปกครอง: ผู้ดูแลระบบ/ผู้บริหารกำหนด
export async function handleStaff(request, env, user, method) {
  requireAdmin(user);
  if (method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT u.id, u.full_name, u.role, r.role AS ps_role FROM users u LEFT JOIN ps_staff_roles r ON r.user_id = u.id
        WHERE u.status = 'active' AND u.deleted_at IS NULL AND u.role IS NOT NULL ORDER BY u.full_name`
    ).all();
    return json({ users: results.map((u) => ({ id: u.id, full_name: u.full_name, role: u.role, discipline: u.ps_role === "discipline" })) });
  }
  if (method === "PUT") {
    const b = await readJson(request);
    const uid = intParam(b.user_id, "รหัสผู้ใช้");
    if (!(await env.DB.prepare("SELECT 1 FROM users WHERE id = ? AND deleted_at IS NULL").bind(uid).first())) fail(404, "ไม่พบผู้ใช้");
    if (b.discipline) {
      await env.DB.prepare("INSERT INTO ps_staff_roles (user_id, role, assigned_by) VALUES (?, 'discipline', ?) ON CONFLICT(user_id) DO UPDATE SET role = 'discipline', assigned_by = excluded.assigned_by, assigned_at = datetime('now')").bind(uid, user.id).run();
    } else {
      await env.DB.prepare("DELETE FROM ps_staff_roles WHERE user_id = ?").bind(uid).run();
    }
    await audit(env, user, "staff.update", { user_id: uid, discipline: !!b.discipline });
    return json({ ok: true });
  }
  fail(405, "ไม่รองรับ");
}
