import { buildClearCookie, buildSessionCookie, signJWT, verifyPassword } from "../lib/crypto.js";
import { json, readJson, fail, currentUser } from "../lib/http.js";
import { createSession, revokeSession, alertLockout, lockedNow, verifyTurnstile, TURNSTILE_ERROR } from "../lib/auth-sessions.js";

// เข้าสู่ระบบด้วยบัญชีเดียวกับระบบบริหารโรงเรียน (ตาราง users เดียวกัน)
// ใช้กติกาล็อกบัญชีชุดเดียวกัน: ผิด 5 ครั้งใน 15 นาที → รอ 15 นาที
export async function login(request, env) {
  const body = await readJson(request);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!email || !password) fail(400, "กรุณากรอกอีเมลและรหัสผ่าน");
  if (!(await verifyTurnstile(env, body.turnstile_token, request)).ok) fail(400, TURNSTILE_ERROR);

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const throttleKey = `${email}|${ip}`.slice(0, 500);
  const throttle = await env.DB.prepare("SELECT locked_until FROM auth_login_throttles WHERE throttle_key = ?").bind(throttleKey).first();
  if (throttle?.locked_until && new Date(`${throttle.locked_until.replace(" ", "T")}Z`).getTime() > Date.now()) {
    return json({ error: "มีการลองเข้าสู่ระบบผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่" }, 429, { "Retry-After": "900" });
  }

  const user = await env.DB.prepare(
    "SELECT id, full_name, role, status, password_hash, password_salt, session_version FROM users WHERE email = ? AND deleted_at IS NULL"
  ).bind(email).first();
  if (!user || !(await verifyPassword(password, user.password_salt, user.password_hash))) {
    await recordFailure(env, throttleKey);
    if (await lockedNow(env, throttleKey)) await alertLockout(env, email, request, "publicservice");
    return json({ error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" }, 401);
  }
  if (user.status !== "active") return json({ error: "บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ" }, 403);

  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_login_throttles WHERE throttle_key = ?").bind(throttleKey),
    env.DB.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").bind(user.id),
  ]);
  const session = await createSession(env, user.id, request, "publicservice");
  const token = await signJWT({ sub: user.id, sv: Number(user.session_version || 1), sid: session.sid }, env.JWT_SECRET);
  return json({ ok: true, user: { id: user.id, full_name: user.full_name, role: user.role } }, 200, { "Set-Cookie": buildSessionCookie(token) });
}

export async function recordFailure(env, key) {
  await env.DB.prepare(`INSERT INTO auth_login_throttles (throttle_key, failure_count, first_failed_at, last_failed_at, locked_until)
    VALUES (?, 1, datetime('now'), datetime('now'), NULL)
    ON CONFLICT(throttle_key) DO UPDATE SET
      failure_count = CASE WHEN first_failed_at < datetime('now','-15 minutes') THEN 1 ELSE failure_count + 1 END,
      first_failed_at = CASE WHEN first_failed_at < datetime('now','-15 minutes') THEN datetime('now') ELSE first_failed_at END,
      last_failed_at = datetime('now'),
      locked_until = CASE WHEN (CASE WHEN first_failed_at < datetime('now','-15 minutes') THEN 1 ELSE failure_count + 1 END) >= 5
        THEN datetime('now','+15 minutes') ELSE NULL END`).bind(key).run();
}

export async function logout(request, env) {
  const user = request && env ? await currentUser(request, env).catch(() => null) : null;
  if (user?.session_id) await revokeSession(env, user.session_id, user.id, "logout").catch(() => {});
  return json({ ok: true }, 200, { "Set-Cookie": buildClearCookie() });
}
