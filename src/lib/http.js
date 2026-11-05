import { AUTH_COOKIE_NAME, verifyJWT } from "./crypto.js";
import { sessionIsActive } from "./auth-sessions.js";

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

export const fail = (status, message) => { throw new HttpError(status, message); };

export async function readJson(request) {
  try { return await request.json(); } catch { fail(400, "รูปแบบข้อมูลไม่ถูกต้อง"); }
}

function parseCookies(request) {
  const out = {};
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const ADMIN_ROLES = ["superadmin", "executive"];

// ครูฝ่ายบริหารทั่วไป (ช่อง "ฝ่าย" ในข้อมูลบุคลากรของระบบบริหารโรงเรียนมี general) = ครูฝ่ายปกครองอัตโนมัติ
export const GENERAL_DEPT_SQL = `EXISTS (SELECT 1 FROM personnel_records p WHERE p.user_id = u.id AND p.status = 'active'
  AND COALESCE(p.employment_status, 'working') = 'working' AND (',' || REPLACE(COALESCE(p.departments, ''), ' ', '') || ',') LIKE '%,general,%')`;

// อ่านผู้ใช้จาก token แล้วยืนยันกับตาราง users ทุกครั้ง (ระงับบัญชี/เปลี่ยนรหัสมีผลทันที)
// is_admin = ผู้ดูแลระบบ/ผู้บริหาร (ทุกห้อง + กำหนดครูฝ่ายปกครอง) · is_discipline = ครูฝ่ายปกครอง (ทุกห้อง)
// ครูฝ่ายปกครอง = กำหนดเองใน ps_staff_roles หรือเป็นครูฝ่ายบริหารทั่วไป (เว้นแต่ Superadmin ปิดไว้ใน ps_staff_revoked)
export async function currentUser(request, env) {
  const token = parseCookies(request)[AUTH_COOKIE_NAME];
  if (!token || !env.JWT_SECRET) return null;
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload?.sub) return null;
  const user = await env.DB.prepare(
    `SELECT u.id, u.email, u.full_name, u.role, u.status, u.session_version, r.role AS ps_role,
            ${GENERAL_DEPT_SQL} AS in_general, EXISTS (SELECT 1 FROM ps_staff_revoked x WHERE x.user_id = u.id) AS revoked
       FROM users u LEFT JOIN ps_staff_roles r ON r.user_id = u.id
      WHERE u.id = ? AND u.deleted_at IS NULL`
  ).bind(payload.sub).first();
  if (!user || user.status !== "active" || !user.role) return null;
  if (user.session_version != null && Number(payload.sv || 1) !== Number(user.session_version)) return null;
  if (!await sessionIsActive(env, payload)) return null;
  Object.defineProperty(user, "session_id", { value: payload.sid || null, enumerable: false });
  user.is_admin = ADMIN_ROLES.includes(user.role);
  user.is_superadmin = user.role === "superadmin";
  user.is_general = Number(user.in_general) === 1 && Number(user.revoked) !== 1;
  delete user.in_general; delete user.revoked;
  user.is_discipline = user.is_admin || user.ps_role === "discipline" || user.is_general;
  return user;
}

export function requireUser(user) {
  if (!user) fail(401, "กรุณาเข้าสู่ระบบ");
  return user;
}

export function requireAdmin(user) {
  requireUser(user);
  if (!user.is_admin) fail(403, "เฉพาะผู้ดูแลระบบและผู้บริหารเท่านั้น");
  return user;
}

export function intParam(value, label = "รหัส") {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) fail(400, `${label}ไม่ถูกต้อง`);
  return n;
}

export function text(value, max = 300) {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, max);
}
