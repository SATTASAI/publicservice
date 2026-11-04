// ระบบคะแนนพฤติกรรมนักเรียน (กิจกรรมเพื่อสังคมและสาธารณประโยชน์) โรงเรียนบ้านป่าเด็ง
// Worker + static assets · ใช้ D1 และบัญชีผู้ใช้ร่วมกับระบบบริหารโรงเรียน/ระบบรายงานผลการเรียน
import { json, HttpError, currentUser } from "./lib/http.js";
import { ensureSchema } from "./lib/schema.js";
import { applySecurityHeaders } from "./lib/auth-sessions.js";
import { login, logout } from "./routes/auth.js";
import { handleMe, handleRoom, handleRecords, handleStaff } from "./routes/behavior.js";

async function routeApi(request, env, url) {
  const method = request.method.toUpperCase();
  const parts = url.pathname.split("/").filter(Boolean);
  if (method !== "GET" && method !== "HEAD") {
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return json({ error: "คำขอไม่ได้มาจากหน้าเว็บของระบบ" }, 403);
  }
  if (parts[1] === "auth" && parts[2] === "login" && method === "POST") return login(request, env);
  if (parts[1] === "auth" && parts[2] === "logout" && method === "POST") return logout(request, env);
  const user = await currentUser(request, env);
  switch (parts[1]) {
    case "me": return handleMe(request, env, user, url);
    case "room": return handleRoom(request, env, user, url);
    case "records": return handleRecords(request, env, user, parts, method, url);
    case "staff": return handleStaff(request, env, user, method);
    default: return json({ error: "ไม่พบเส้นทาง API" }, 404);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return applySecurityHeaders(await env.ASSETS.fetch(request));
    if (url.pathname === "/api/health") return json({ ok: !!env.JWT_SECRET && !!env.DB, jwt_secret_set: !!env.JWT_SECRET, database_bound: !!env.DB });
    try {
      if (!env.JWT_SECRET) return json({ error: "ยังไม่ได้ตั้งค่า JWT_SECRET ของ Worker" }, 500);
      await ensureSchema(env);
      return applySecurityHeaders(await routeApi(request, env, url));
    } catch (err) {
      if (err instanceof HttpError) return applySecurityHeaders(json({ error: err.message }, err.status));
      console.error("API error", url.pathname, String(err?.message || err));
      return json({ error: "เกิดข้อผิดพลาดภายในระบบ" }, 500);
    }
  },
};
