// เข้าจากเมนู system (ฝ่ายทั่วไป › รายงานพฤติกรรม) โดยไม่ต้องล็อกอินซ้ำ
// system ออกรหัสใช้ครั้งเดียว อายุ 60 วินาที ใน publicservice_sso_codes (D1 ร่วม) → แลกเป็น session ของ publicservice
import { buildSessionCookie, signJWT } from "../lib/crypto.js";
import { createSession, applySecurityHeaders } from "../lib/auth-sessions.js";

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handleSso(request, env, url) {
  const home = new URL("/", url).toString();
  const go = (headers = {}) => applySecurityHeaders(new Response(null, { status: 302, headers: { Location: home, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", ...headers } }));
  const code = String(url.searchParams.get("code") || "");
  if (!env.JWT_SECRET || !/^[0-9a-f]{64}$/.test(code)) return go();
  try {
    const hash = await sha256Hex(code);
    const now = Math.floor(Date.now() / 1000);
    const row = await env.DB.prepare("DELETE FROM publicservice_sso_codes WHERE code_hash = ? RETURNING user_id, session_version, expires_at").bind(hash).first();
    if (!row || Number(row.expires_at) < now) return go();
    const user = await env.DB.prepare("SELECT id, status, session_version FROM users WHERE id = ? AND deleted_at IS NULL").bind(row.user_id).first();
    if (!user || user.status !== "active" || Number(user.session_version || 1) !== Number(row.session_version)) return go();
    await env.DB.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").bind(user.id).run();
    const session = await createSession(env, user.id, request, "publicservice");
    const token = await signJWT({ sub: user.id, sv: Number(user.session_version || 1), sid: session.sid }, env.JWT_SECRET);
    return go({ "Set-Cookie": buildSessionCookie(token) });
  } catch (err) {
    console.error("sso", String(err?.message || err));
    return go();
  }
}
