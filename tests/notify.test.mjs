import test from "node:test";
import assert from "node:assert/strict";
import { recordMessage, homeroomIds } from "../src/lib/notify.js";

test("ตัดคะแนนอย่างเดียว", () => {
  const m = recordMessage({ grade: "ป.3", room: "1", amount: 5, reason: "มาสาย", by: "ครู ก", deducted: ["ด.ช.เอ"] });
  assert.equal(m.title, "ตัดคะแนน ป.3/1");
  assert.equal(m.body, "ตัด −5: ด.ช.เอ · มาสาย · โดย ครู ก");
});

test("ตักเตือนอย่างเดียว และรวมชื่อเกิน 3 คน", () => {
  const m = recordMessage({ grade: "ป.1", room: "2", amount: 2, reason: "คุยในห้อง", by: "ครู ข", warned: ["a", "b", "c", "d", "e"] });
  assert.equal(m.title, "ตักเตือน ป.1/2");
  assert.equal(m.body, "ตักเตือน: a, b, c และอีก 2 คน · คุยในห้อง · โดย ครู ข");
});

test("ตัดและตักเตือนในครั้งเดียว", () => {
  const m = recordMessage({ grade: "ป.6", room: "1", amount: 3, reason: "ไม่ส่งงาน", by: "ครู ค", deducted: ["a"], warned: ["b"] });
  assert.equal(m.title, "ตัดคะแนน/ตักเตือน ป.6/1");
  assert.equal(m.body, "ตัด −3: a · ตักเตือน: b · ไม่ส่งงาน · โดย ครู ค");
});

test("homeroomIds กรองห้องและไม่รวมผู้บันทึก", async () => {
  let bound;
  const env = { DB: { prepare: (sql) => ({ bind: (...a) => { bound = { sql, a }; return { all: async () => ({ results: [{ user_id: 7 }] }) }; } }) } };
  assert.deepEqual(await homeroomIds(env, 3, "ป.2", "1", 9), [7]);
  assert.deepEqual(bound.a, [3, "ป.2", "1", 9]);
  assert.match(bound.sql, /gr_homerooms/);
});
