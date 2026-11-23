// แจ้งเตือนมือถือผ่านระบบแจ้งเตือนกลาง school-notify (notify.banpadengschool.ac.th)
// ผู้รับ = บัญชีที่ผูกมือถือไว้จาก "บัญชีของฉัน" ในระบบบริหารโรงเรียน (ref u:<users.id> — ตาราง users เดียวกัน)
// Secret ที่ต้องตั้ง: NOTIFY_API_KEY (ค่าเดียวกับ API_KEY ของ school-notify) — ไม่ตั้ง = ไม่ส่ง (ระบบทำงานปกติ)
import { ADMIN_ROLES, GENERAL_DEPT_SQL } from "./http.js";

const NOTIFY_ORIGIN = "https://notify.banpadengschool.ac.th";
const APP_ORIGIN = "https://publicservice.banpadengschool.ac.th";
const CTX = new WeakMap();
export const bindCtx = (request, ctx) => { if (ctx) CTX.set(request, ctx); };
const cut = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

export async function sendPush(env, { title, body, tab, userIds }) {
  const ids = [...new Set((userIds || []).map(Number).filter((x) => Number.isInteger(x) && x > 0))];
  if (!env.NOTIFY_API_KEY || !ids.length) return;
  const origin = (env.NOTIFY_ORIGIN || NOTIFY_ORIGIN).replace(/\/$/, "");
  for (let i = 0; i < ids.length; i += 80) {
    try {
      const res = await fetch(origin + "/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${env.NOTIFY_API_KEY}` },
        body: JSON.stringify({ title: cut(title, 120), body: cut(body, 1000), url: `${env.APP_ORIGIN || APP_ORIGIN}/${tab ? `?tab=${tab}` : ""}`,
          roles: ["teacher"], refs: ids.slice(i, i + 80).map((id) => `u:${id}`), source: "publicservice" }),
      });
      if (!res.ok) console.error("notify failed", res.status);
    } catch (e) { console.error("notify error", String(e?.message || e)); }
  }
}

// ส่งเบื้องหลัง ไม่ให้ผู้ใช้รอ (ctx.waitUntil ของคำขอนั้น)
export function pushLater(request, env, msg) {
  const p = sendPush(env, msg);
  const ctx = CTX.get(request);
  if (ctx) ctx.waitUntil(p); else return p;
}

// ครูที่พิจารณาได้ = is_discipline (ผู้ดูแล/ผู้บริหาร · ps_staff_roles discipline · ครูฝ่ายบริหารทั่วไปที่ไม่ถูกปิดสิทธิ์)
export async function disciplineIds(env, exceptId) {
  const { results } = await env.DB.prepare(
    `SELECT u.id FROM users u LEFT JOIN ps_staff_roles r ON r.user_id = u.id
      WHERE u.deleted_at IS NULL AND u.status = 'active' AND u.id <> ?
        AND (u.role IN (${ADMIN_ROLES.map(() => "?").join(",")}) OR r.role = 'discipline'
             OR (${GENERAL_DEPT_SQL} AND NOT EXISTS (SELECT 1 FROM ps_staff_revoked x WHERE x.user_id = u.id)))`
  ).bind(Number(exceptId) || 0, ...ADMIN_ROLES).all();
  return results.map((r) => r.id);
}

// ครูประจำชั้นของห้อง (gr_homerooms ของ students-report — อ่านอย่างเดียว)
export async function homeroomIds(env, yearId, grade, room, exceptId) {
  const { results } = await env.DB.prepare(
    "SELECT user_id FROM gr_homerooms WHERE academic_year_id = ? AND grade_level = ? AND classroom = ? AND user_id <> ?"
  ).bind(yearId, grade, room, Number(exceptId) || 0).all().catch(() => ({ results: [] }));
  return results.map((r) => r.user_id);
}

// ข้อความแจ้งตัดคะแนน/ตักเตือน (บันทึกหลายคนพร้อมกัน = 1 ข้อความ)
const names3 = (a) => `${a.slice(0, 3).join(", ")}${a.length > 3 ? ` และอีก ${a.length - 3} คน` : ""}`;
export function recordMessage({ grade, room, amount, reason, by, deducted = [], warned = [] }) {
  const kind = deducted.length && warned.length ? "ตัดคะแนน/ตักเตือน" : deducted.length ? "ตัดคะแนน" : "ตักเตือน";
  const parts = [];
  if (deducted.length) parts.push(`ตัด −${amount}: ${names3(deducted)}`);
  if (warned.length) parts.push(`ตักเตือน: ${names3(warned)}`);
  return { title: `${kind} ${grade}/${room}`, body: `${parts.join(" · ")} · ${reason} · โดย ${by || ""}` };
}
