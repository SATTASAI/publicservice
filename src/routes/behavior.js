// บันทึกคะแนนพฤติกรรม: ครูประจำชั้น (ห้องของตน) · ครูฝ่ายปกครองและผู้ดูแลระบบ/ผู้บริหาร (ทุกห้อง)
import { json, readJson, fail, requireUser, requireAdmin, intParam, text, GENERAL_DEPT_SQL, ADMIN_ROLES } from "../lib/http.js";
import { listYears, resolveYear, yearTerms, currentTerm, listRooms, roomRoster, studentName, isPrimaryGrade, compareRoom, LEFT_STATUSES, thaiToday } from "../lib/roster.js";
import { BASE_SCORE, PASS_MIN, foldScore } from "../lib/schema.js";

// ---------- เวลาเปิด-ปิดการบันทึก (เวลาราชการ จ.–ศ. ตามเวลาไทย) ----------
const HOURS_DEFAULT = { start: "08:30", end: "16:30" };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
async function getHours(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM ps_settings WHERE key IN ('hours_start','hours_end')").all().catch(() => ({ results: [] }));
  const m = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return { start: HHMM.test(m.hours_start || "") ? m.hours_start : HOURS_DEFAULT.start, end: HHMM.test(m.hours_end || "") ? m.hours_end : HOURS_DEFAULT.end };
}
// โซนความรุนแรงตามคะแนนที่หักต่อครั้ง: < mid เล็กน้อย · < high ปานกลาง · < severe รุนแรง · ≥ severe รุนแรงมาก
// โซนรุนแรงขึ้นไป (≥ high) ตัดได้ทันที ไม่ต้องตักเตือน
const ZONES_DEFAULT = { mid: 6, high: 10, severe: 16 };
const validZones = (z) => z && [z.mid, z.high, z.severe].every((v) => Number.isInteger(v) && v >= 2 && v <= 100) && z.mid < z.high && z.high < z.severe;
async function getZones(env) {
  const r = await env.DB.prepare("SELECT value FROM ps_settings WHERE key = 'zones'").first().catch(() => null);
  let z = null; try { z = JSON.parse(r?.value || "null"); } catch { /* */ }
  return validZones(z) ? { mid: z.mid, high: z.high, severe: z.severe } : { ...ZONES_DEFAULT };
}
// จำนวนครั้งที่ต้องตักเตือน (เรื่องเดียวกัน ในภาคเรียน) ก่อนตัดคะแนนได้ · 0 = ตัดได้ทันที
const WARN_DEFAULT = 2, WARN_MAX = 10;
async function getWarnN(env) {
  const r = await env.DB.prepare("SELECT value FROM ps_settings WHERE key = 'warn_count'").first().catch(() => null);
  const n = Number(r?.value);
  return Number.isInteger(n) && n >= 0 && n <= WARN_MAX ? n : WARN_DEFAULT;
}
function hoursState(h) {
  const th = new Date(Date.now() + 7 * 3600e3);
  const day = th.getUTCDay(), now = th.toISOString().slice(11, 16);
  const weekday = day >= 1 && day <= 5;
  return { ...h, open: weekday && now >= h.start && now < h.end, now, weekday };
}
async function requireOpen(env) {
  const st = hoursState(await getHours(env));
  if (!st.open) fail(403, `ระบบเปิดบันทึกเฉพาะวันจันทร์–ศุกร์ เวลา ${st.start}–${st.end} น.`);
}

// { student_id: [เรื่องที่ถูกตัดแล้ว / ตักเตือนแล้ว ในวันที่ date] }
async function reasonsOn(env, ids, date, warn) {
  const out = {};
  const sql = warn
    ? "SELECT student_id, reason FROM ps_behavior_warnings WHERE incident_date = ? AND cancelled_at IS NULL"
    : "SELECT student_id, reason FROM ps_behavior_records WHERE incident_date = ? AND points < 0 AND cancelled_at IS NULL";
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    if (!chunk.length) continue;
    const { results } = await env.DB.prepare(`${sql} AND student_id IN (${chunk.map(() => "?").join(",")})`).bind(date, ...chunk).all();
    for (const r of results) { const a = (out[r.student_id] ||= []); if (!a.includes(r.reason)) a.push(r.reason); }
  }
  return out;
}
const deductedOn = (env, ids, date) => reasonsOn(env, ids, date, false);
const warnedOn = (env, ids, date) => reasonsOn(env, ids, date, true);

// { student_id: จำนวนครั้งที่ถูกตักเตือนเรื่อง reason ในภาคเรียน } (reason ว่าง = ทุกเรื่อง)
async function warnCounts(env, yearId, term, ids, reason) {
  const out = {};
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    if (!chunk.length) continue;
    const { results } = await env.DB.prepare(
      `SELECT student_id, COUNT(*) AS n FROM ps_behavior_warnings WHERE academic_year_id = ? AND term_number = ? AND cancelled_at IS NULL
          ${reason ? "AND reason = ?" : ""} AND student_id IN (${chunk.map(() => "?").join(",")}) GROUP BY student_id`
    ).bind(yearId, term, ...(reason ? [reason] : []), ...chunk).all();
    for (const r of results) out[r.student_id] = Number(r.n);
  }
  return out;
}

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
    user: { id: user.id, full_name: user.full_name, role: user.role, is_admin: user.is_admin, is_discipline: user.is_discipline, is_general: user.is_general },
    years: await listYears(env), year, terms, term: currentTerm(terms), today: thaiToday(),
    rooms: await editableRooms(env, user, year.id), base: BASE_SCORE, pass_min: PASS_MIN,
    hours: hoursState(await getHours(env)), warn_n: await getWarnN(env), zones: await getZones(env),
  });
}

export async function handleRoom(request, env, user, url) {
  requireUser(user);
  const year = await resolveYear(env, url.searchParams.get("year"));
  const term = termOf(url.searchParams.get("term"));
  const { grade, room, roster } = await pickRoom(env, user, year.id, url.searchParams.get("grade"), url.searchParams.get("room"));
  const s = await scores(env, year.id, term, roster.map((r) => r.id));
  const ids = roster.map((r) => r.id);
  const today = await deductedOn(env, ids, thaiToday());
  const todayW = await warnedOn(env, ids, thaiToday());
  const wc = await warnCounts(env, year.id, term, ids);
  return json({ year, term, grade, room, students: roster.map((r) => {
    const score = s[r.id]?.score ?? BASE_SCORE;
    return { id: r.id, number: r.number, code: r.student_code, name: studentName(r), left: LEFT_STATUSES.includes(r.enrollment_status),
      score, pass: score >= PASS_MIN, deduct_count: Number(s[r.id]?.deduct_count || 0), add_count: Number(s[r.id]?.add_count || 0),
      warn_count: wc[r.id] || 0, today_deducted: today[r.id] || [], today_warned: todayW[r.id] || [] };
  }) });
}

// GET /api/overview?year&term — ภาพรวมทั้งโรงเรียน (ครูฝ่ายปกครอง/ผู้ดูแล)
export async function handleOverview(request, env, user, url) {
  requireUser(user);
  if (!user.is_discipline) fail(403, "เฉพาะครูฝ่ายปกครองและผู้ดูแลระบบ");
  const year = await resolveYear(env, url.searchParams.get("year"));
  const term = termOf(url.searchParams.get("term"));
  const rooms = await listRooms(env, year.id);
  const rosters = await Promise.all(rooms.map((r) => roomRoster(env, year.id, r.grade_level, r.classroom)));
  const all = [];
  rooms.forEach((r, i) => { for (const st of rosters[i]) if (!LEFT_STATUSES.includes(st.enrollment_status)) all.push({ st, grade: r.grade_level, room: r.classroom }); });
  const s = await scores(env, year.id, term, all.map((x) => x.st.id));
  const students = all.map(({ st, grade, room }) => {
    const score = s[st.id]?.score ?? BASE_SCORE;
    return { id: st.id, number: st.number, code: st.student_code, name: studentName(st), grade, room, score, pass: score >= PASS_MIN,
      deduct_count: Number(s[st.id]?.deduct_count || 0), add_count: Number(s[st.id]?.add_count || 0) };
  });
  const summary = rooms.map((r) => {
    const list = students.filter((x) => x.grade === r.grade_level && x.room === r.classroom);
    return { grade: r.grade_level, room: r.classroom, students: list.length, fails: list.filter((x) => !x.pass).length,
      avg: list.length ? Math.round((list.reduce((a, x) => a + x.score, 0) / list.length) * 10) / 10 : null };
  });
  return json({ year, term, rooms: summary, students });
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
    const { results: warns } = await env.DB.prepare(
      `SELECT w.id, 0 AS points, w.reason, w.incident_date, w.created_at, w.created_by, u.full_name AS created_by_name,
              w.cancelled_at, w.cancel_reason, c.full_name AS cancelled_by_name
         FROM ps_behavior_warnings w LEFT JOIN users u ON u.id = w.created_by LEFT JOIN users c ON c.id = w.cancelled_by
        WHERE w.academic_year_id = ? AND w.term_number = ? AND w.student_id = ?`
    ).bind(year.id, term, sid).all();
    const all = [...results, ...warns.map((w) => ({ ...w, warn: true }))]
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id);
    return json({ student: { id: sid, number: st.number, name: studentName(st) }, score, warn_n: await getWarnN(env),
      records: all.map((r) => ({ ...r, can_cancel: !r.cancelled_at && (user.is_discipline || r.created_by === user.id) })) });
  }

  // POST /api/records — ตัด/เพิ่มคะแนน (เลือกได้หลายคนพร้อมกัน)
  if (method === "POST" && !parts[2]) {
    await requireOpen(env);
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
    if (date > thaiToday()) fail(400, "วันที่ต้องไม่เกินวันนี้");
    let ids = [...new Set((Array.isArray(b.student_ids) ? b.student_ids : []).map(Number))];
    if (!ids.length) fail(400, "เลือกนักเรียนอย่างน้อย 1 คน");
    const active = new Set(roster.filter((r) => !LEFT_STATUSES.includes(r.enrollment_status)).map((r) => r.id));
    for (const id of ids) if (!active.has(id)) fail(400, "มีนักเรียนที่ไม่อยู่ในห้องนี้ หรือย้ายออกแล้ว");
    const points = b.kind === "deduct" ? -amount : amount;
    // ตัด/ตักเตือนเรื่องเดียวกันได้วันละครั้ง (นับรวมทุกครู) · ยกเลิกรายการแล้วบันทึกใหม่ได้
    let skipped = [], warnIds = [];
    if (points < 0) {
      const done = await deductedOn(env, ids, date), warned = await warnedOn(env, ids, date);
      const skipIds = ids.filter((id) => (done[id] || []).includes(reason) || (warned[id] || []).includes(reason));
      if (skipIds.length) {
        const names = roster.filter((r) => skipIds.includes(r.id)).map(studentName);
        if (skipIds.length === ids.length) fail(409, `ถูกตัดคะแนน/ตักเตือนเรื่อง "${reason}" ในวันนี้แล้ว: ${names.join(", ")}`);
        ids = ids.filter((id) => !skipIds.includes(id));
        skipped = names;
      }
      // ยังตักเตือนเรื่องนี้ไม่ครบตามที่ตั้งค่า → บันทึกเป็นตักเตือน (ไม่ตัดคะแนน) · โซนรุนแรงขึ้นไปตัดได้ทันที
      const n = await getWarnN(env);
      if (n > 0 && amount < (await getZones(env)).high) {
        const wc = await warnCounts(env, year.id, term, ids, reason);
        warnIds = ids.filter((id) => (wc[id] || 0) < n);
        ids = ids.filter((id) => !warnIds.includes(id));
      }
    }
    await env.DB.batch([
      ...ids.map((sid) => env.DB.prepare(
        "INSERT INTO ps_behavior_records (academic_year_id, term_number, student_id, points, reason, incident_date, created_by) VALUES (?,?,?,?,?,?,?)"
      ).bind(year.id, term, sid, points, reason, date, user.id)),
      ...warnIds.map((sid) => env.DB.prepare(
        "INSERT INTO ps_behavior_warnings (academic_year_id, term_number, student_id, reason, incident_date, created_by) VALUES (?,?,?,?,?,?)"
      ).bind(year.id, term, sid, reason, date, user.id)),
    ]);
    if (ids.length) await audit(env, user, "behavior.add", { grade, room, term, points, reason, students: ids });
    if (warnIds.length) await audit(env, user, "behavior.warn", { grade, room, term, reason, students: warnIds });
    return json({ ok: true, saved: ids.length, warned: warnIds.length, skipped });
  }

  // POST /api/records/:id/cancel — ผู้บันทึก หรือครูฝ่ายปกครอง/ผู้ดูแล ยกเลิกได้ (ต้องมีเหตุผล)
  if (method === "POST" && parts[3] === "cancel") {
    const id = intParam(parts[2]);
    const b = await readJson(request);
    const reason = text(b.reason, 300);
    if (!reason) fail(400, "กรุณาระบุเหตุผลที่ยกเลิก");
    const table = b.warn ? "ps_behavior_warnings" : "ps_behavior_records";
    const rec = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
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
    await env.DB.prepare(`UPDATE ${table} SET cancelled_at = datetime('now'), cancelled_by = ?, cancel_reason = ? WHERE id = ? AND cancelled_at IS NULL`)
      .bind(user.id, reason, id).run();
    await audit(env, user, b.warn ? "warn.cancel" : "behavior.cancel", { id, reason });
    return json({ ok: true });
  }
  fail(405, "ไม่รองรับ");
}

// GET/PUT /api/settings — เวลาเปิด-ปิดการบันทึก · แก้ได้เฉพาะครูฝ่ายปกครอง/ผู้ดูแล
export async function handleSettings(request, env, user, method) {
  requireUser(user);
  if (method === "GET") return json({ hours: hoursState(await getHours(env)), warn_n: await getWarnN(env), zones: await getZones(env) });
  if (method === "PUT") {
    if (!user.is_discipline) fail(403, "เฉพาะครูฝ่ายปกครองและผู้ดูแลระบบ");
    const b = await readJson(request);
    // PUT { zones: { mid, high, severe } } — เกณฑ์โซนความรุนแรง (คะแนนที่หักต่อครั้ง)
    if (b.zones !== undefined) {
      const z = { mid: Number(b.zones?.mid), high: Number(b.zones?.high), severe: Number(b.zones?.severe) };
      if (!validZones(z)) fail(400, "เกณฑ์โซนต้องเป็นจำนวนเต็ม 2–100 และเรียงจากน้อยไปมาก");
      await env.DB.prepare("INSERT INTO ps_settings (key, value, updated_by) VALUES ('zones', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')")
        .bind(JSON.stringify(z), user.id).run();
      await audit(env, user, "settings.zones", z);
      return json({ ok: true, zones: z });
    }
    // PUT { warn_count } — จำนวนครั้งที่ต้องตักเตือนก่อนตัดคะแนน
    if (b.warn_count !== undefined) {
      const n = Number(b.warn_count);
      if (!Number.isInteger(n) || n < 0 || n > WARN_MAX) fail(400, `จำนวนครั้งตักเตือนต้องเป็น 0–${WARN_MAX}`);
      await env.DB.prepare("INSERT INTO ps_settings (key, value, updated_by) VALUES ('warn_count', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')")
        .bind(String(n), user.id).run();
      await audit(env, user, "settings.warn", { warn_count: n });
      return json({ ok: true, warn_n: n });
    }
    const start = String(b.start || ""), end = String(b.end || "");
    if (!HHMM.test(start) || !HHMM.test(end)) fail(400, "รูปแบบเวลาไม่ถูกต้อง (HH:MM)");
    if (start >= end) fail(400, "เวลาเปิดต้องก่อนเวลาปิด");
    await env.DB.batch([["hours_start", start], ["hours_end", end]].map(([k, v]) => env.DB.prepare(
      "INSERT INTO ps_settings (key, value, updated_by) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')"
    ).bind(k, v, user.id)));
    await audit(env, user, "settings.hours", { start, end });
    return json({ ok: true, hours: hoursState({ start, end }) });
  }
  fail(405, "ไม่รองรับ");
}

// ครูฝ่ายปกครอง: ผู้ดูแลระบบ/ผู้บริหารกำหนด · ครูฝ่ายบริหารทั่วไป (อัตโนมัติ) แก้ได้เฉพาะ Superadmin
export async function handleStaff(request, env, user, method) {
  requireAdmin(user);
  if (method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT u.id, u.full_name, u.role, r.role AS ps_role, ${GENERAL_DEPT_SQL} AS in_general,
              EXISTS (SELECT 1 FROM ps_staff_revoked x WHERE x.user_id = u.id) AS revoked
         FROM users u LEFT JOIN ps_staff_roles r ON r.user_id = u.id
        WHERE u.status = 'active' AND u.deleted_at IS NULL AND u.role IS NOT NULL ORDER BY u.full_name`
    ).all();
    return json({ can_override: user.is_superadmin, users: results.map((u) => ({ id: u.id, full_name: u.full_name, role: u.role,
      discipline: u.ps_role === "discipline", general: Number(u.in_general) === 1, revoked: Number(u.revoked) === 1 })) });
  }
  if (method === "PUT") {
    const b = await readJson(request);
    const uid = intParam(b.user_id, "รหัสผู้ใช้");
    const target = await env.DB.prepare(`SELECT u.id, u.role, ${GENERAL_DEPT_SQL} AS in_general FROM users u WHERE u.id = ? AND u.deleted_at IS NULL`).bind(uid).first();
    if (!target) fail(404, "ไม่พบผู้ใช้");
    if (ADMIN_ROLES.includes(target.role)) fail(400, "ผู้ดูแลระบบ/ผู้บริหารเห็นทุกห้องอยู่แล้ว");
    if (Number(target.in_general) === 1) {
      // ครูฝ่ายบริหารทั่วไป: สิทธิ์อัตโนมัติ — เฉพาะ Superadmin ปิด/เปิดได้
      if (!user.is_superadmin) fail(403, "เฉพาะ Superadmin แก้สิทธิ์ครูฝ่ายบริหารทั่วไปได้");
      await env.DB.batch(b.discipline
        ? [env.DB.prepare("DELETE FROM ps_staff_revoked WHERE user_id = ?").bind(uid)]
        : [env.DB.prepare("DELETE FROM ps_staff_roles WHERE user_id = ?").bind(uid),
           env.DB.prepare("INSERT INTO ps_staff_revoked (user_id, revoked_by) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET revoked_by = excluded.revoked_by, revoked_at = datetime('now')").bind(uid, user.id)]);
    } else if (b.discipline) {
      await env.DB.prepare("INSERT INTO ps_staff_roles (user_id, role, assigned_by) VALUES (?, 'discipline', ?) ON CONFLICT(user_id) DO UPDATE SET role = 'discipline', assigned_by = excluded.assigned_by, assigned_at = datetime('now')").bind(uid, user.id).run();
    } else {
      await env.DB.prepare("DELETE FROM ps_staff_roles WHERE user_id = ?").bind(uid).run();
    }
    await audit(env, user, "staff.update", { user_id: uid, discipline: !!b.discipline });
    return json({ ok: true });
  }
  fail(405, "ไม่รองรับ");
}
