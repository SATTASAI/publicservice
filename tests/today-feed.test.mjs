import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { todayFeed } from "../src/routes/behavior.js";
import { thaiToday } from "../src/lib/roster.js";

// shim D1 บน node:sqlite (in-memory) — ไม่แตะฐานจริง
function d1(db) {
  const prep = (sql) => ({ bind: (...a) => ({ all: async () => ({ results: db.prepare(sql).all(...a) }) }) });
  return { prepare: prep, batch: async (st) => Promise.all(st.map((s) => s.all())) };
}

test("todayFeed: รวมหัก/ตักเตือน/เพิ่มของวันนี้ ไม่นับยกเลิก/วันอื่น/ภาคอื่น", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT);
    CREATE TABLE ps_behavior_records (id INTEGER PRIMARY KEY, academic_year_id INT, term_number INT, student_id INT, points INT, reason TEXT, incident_date TEXT, created_by INT, created_at TEXT, cancelled_at TEXT);
    CREATE TABLE ps_behavior_warnings (id INTEGER PRIMARY KEY, academic_year_id INT, term_number INT, student_id INT, reason TEXT, incident_date TEXT, created_by INT, created_at TEXT, cancelled_at TEXT);
    INSERT INTO users VALUES (9, 'ครูเอ');`);
  const d = thaiToday();
  const ins = db.prepare("INSERT INTO ps_behavior_records (academic_year_id, term_number, student_id, points, reason, incident_date, created_by, created_at, cancelled_at) VALUES (?,?,?,?,?,?,?,?,?)");
  ins.run(1, 2, 1, -5, "หนีเรียน", d, 9, "2026-01-01 02:00:00", null);
  ins.run(1, 2, 2, 3, "ช่วยครู", d, 9, "2026-01-01 03:00:00", null);
  ins.run(1, 2, 1, -2, "ยกเลิกแล้ว", d, 9, "2026-01-01 04:00:00", "x");
  ins.run(1, 2, 1, -2, "เมื่อวาน", "2000-01-01", 9, "2026-01-01 05:00:00", null);
  ins.run(1, 1, 1, -2, "ภาคอื่น", d, 9, "2026-01-01 05:00:00", null);
  db.prepare("INSERT INTO ps_behavior_warnings (academic_year_id, term_number, student_id, reason, incident_date, created_by, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(1, 2, 2, "มาสาย", d, 9, "2026-01-01 01:00:00");
  const students = [{ id: 1, name: "ก", grade: "ป.4", room: "2", score: 95 }, { id: 2, name: "ข", grade: "ป.1", room: "1", score: 100 }, { id: 3, name: "ค", grade: "ป.1", room: "1", score: 100 }];
  const out = await todayFeed({ DB: d1(db) }, 1, 2, students);
  assert.deepEqual(out.map((x) => [x.type, x.name, x.points, x.reason]), [["add", "ข", 3, "ช่วยครู"], ["deduct", "ก", 5, "หนีเรียน"], ["warn", "ข", 0, "มาสาย"]]);
  assert.equal(out[0].by, "ครูเอ");
});

test("todayFeed: ไม่มีนักเรียน → ว่าง", async () => {
  assert.deepEqual(await todayFeed({ DB: { batch: async () => [] } }, 1, 2, []), []);
});
