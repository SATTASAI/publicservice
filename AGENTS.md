# AGENTS.md — ระบบฝ่ายปกครอง — คะแนนพฤติกรรมนักเรียน (publicservice)

ตัด/เพิ่มคะแนนพฤติกรรมนักเรียน ป.1–6 ผลส่งไปกิจกรรมเพื่อสังคมฯ ใน ปพ.6 ของ students-report · https://publicservice.banpadengschool.ac.th

## ข้อมูลระบบ

- Cloudflare Worker `publicservice` + `public/` (แอปมือถือ/PWA)
- D1 `DB` = `banpadeng_school_db` · cron ทุก 5 นาที (ตรวจความดีรออนุมัติ → แจ้งเตือน)
- ยังไม่มี test อัตโนมัติ — งานที่เปลี่ยน logic ต้องเพิ่ม test ด้วย `node:test` (สร้าง `tests/*.test.mjs` และเพิ่ม script `test`)

## วิธีทำงานในรีโปนี้ (สำหรับ agent)

1. อ่านไฟล์นี้, `README.md` และเอกสารใน `docs/` (ถ้ามี) ก่อนแก้ทุกครั้ง
2. ทำเฉพาะขอบเขตที่ได้รับมอบหมาย ไม่ refactor, ไม่เปลี่ยนชื่อไฟล์/ตาราง/endpoint และไม่อัปเกรด dependency ถ้าไม่ได้สั่ง
3. ถ้างานกระทบข้อมูลจริง สิทธิ์ผู้ใช้ เงิน หรือระบบอื่น ให้หยุดถามก่อนลงมือ
4. แก้ให้น้อยที่สุดที่ทำให้งานสำเร็จ และเขียน/ปรับ test ที่ครอบคลุมพฤติกรรมที่เปลี่ยน
5. รันคำสั่งตรวจในหัวข้อ "คำสั่ง" ให้ผ่านทั้งหมดก่อน commit
6. ตอบผู้ใช้เป็นภาษาไทย กระชับ ข้อความ UI ทั้งหมดเป็นภาษาไทย

## คำสั่ง

```sh
npm ci
node --check src/index.js && for f in src/routes/*.js src/lib/*.js; do node --check "$f"; done
npx wrangler dev        # ใช้ --local เท่านั้น ห้ามต่อฐานจริงเพื่อทดสอบ
```

## โครงสร้างไฟล์

```
src/index.js          → router + scheduled()
src/routes/           → auth, behavior, passkeys, sso
src/lib/schema.js     → สร้างตาราง ps_* อัตโนมัติ
src/lib/crypto.js, auth-sessions.js → สำเนาจาก students-report
src/lib/roster.js     → สำเนาตรรกะรายชื่อจาก students-report
src/lib/notify.js     → ส่งแจ้งเตือนผ่าน school-notify
public/               → index.html, js/, app.css, manifest
```

## ฐานข้อมูลกลาง `banpadeng_school_db` (ใช้ร่วมหลายระบบ)

ฐาน D1 นี้ใช้ร่วมกับ banpadeng-school-db (system), students-report, publicservice, bpdactivity,
teaching-media, evaluatesystem และ school-cooperative ความผิดพลาดที่นี่กระทบทุกระบบ

- เขียนได้เฉพาะตารางของรีโปนี้: `ps_*`, `good_deeds` (ใช้ร่วมกับ system — ซิงค์สองทาง), `auth_sessions`, `security_notifications`
- ตารางของระบบอื่นอ่านอย่างเดียว: `users`, `students`, `student_details`, `student_enrollments`, `academic_years`, `academic_terms`, `personnel_records` และตารางอื่นของ system, `gr_homerooms`
- ตาราง passkey กลาง (`auth_passkeys`, `auth_passkey_users`, `auth_passkey_challenges`, `auth_passkey_rates`) ใช้ร่วมทุกระบบ ห้ามเปลี่ยนโครงสร้าง
- schema สร้างอัตโนมัติด้วย `CREATE TABLE IF NOT EXISTS`/เพิ่มคอลัมน์แบบตรวจก่อน ห้าม `DROP`, `RENAME`, ลบคอลัมน์ หรือเปลี่ยนชนิดข้อมูล
- ห้ามรันคำสั่งเขียน/ลบบนฐานจริง (`--remote`) เพื่อทดสอบ; ใช้ฐาน local/shim หรือ fixture
- ระวังโควต้า D1: query ต้องใช้ index, จำกัดจำนวนแถว, ไม่ scan ทั้งตารางใน cron

## กติกาเฉพาะของระบบ (business rules)

- เริ่มภาคละ 100 คะแนน ไม่เกิน 100 ไม่ต่ำกว่า 0 · < 50 = กิจกรรมเพื่อสังคมฯ มผ
- เรื่องเดียวกัน (เหตุผลเดียวกัน) ตัด/ตักเตือนได้วันละครั้งต่อนักเรียน นับรวมทุกครู ตามวันที่เกิดเหตุเวลาไทย
- โซนเล็กน้อยต้องตักเตือนครบ N ครั้ง (`ps_settings.warn_count`, ค่าเริ่มต้น 2) · โซนปานกลางขึ้นไปครูเลือกเอง
- ครูทั่วไปตัด ≥ `refer_min` (10) → ส่งต่อฝ่ายปกครอง (`ps_referrals`) ยังไม่หักจนกว่าฝ่ายปกครองตัดสิน
- เพิ่มคะแนนได้เฉพาะครูฝ่ายปกครอง; ความดีจากครูประจำชั้นรออนุมัติ
- บันทึกได้เฉพาะ จ.–ศ. ในเวลาที่ตั้ง (08:30–16:30) · ยกเลิกต้องมีเหตุผล ไม่ลบแถว ประวัติใน `ps_audit`
- สิทธิ์: ครูประจำชั้นเห็นเฉพาะห้องตน · ครูฝ่ายปกครอง = ฝ่ายบริหารทั่วไป (`general`) + `ps_staff_roles` + superadmin/executive
- การตั้งค่าใน `ps_settings` แก้ได้เฉพาะผู้ดูแลระบบ/ผู้บริหาร

## ข้อตกลงการเขียนโค้ด

- เวลาและวันที่อิงเวลาไทย `Asia/Bangkok` (UTC+7) ทุกจุด ทั้งการคำนวณวัน ตัดรอบ และ cron; แสดงปีเป็น พ.ศ. แต่เก็บเป็น ISO/ค.ศ.
- SQL ใช้ prepared statement + `.bind()` เท่านั้น ห้ามต่อสตริงจากค่าที่ผู้ใช้ส่งมา
- ตรวจสิทธิ์ฝั่งเซิร์ฟเวอร์ทุก endpoint (role/status/session ปัจจุบันจากฐาน) อย่าเชื่อค่าจากหน้าเว็บ
- งานที่เขียนหลายแถวต้องเป็น atomic (`db.batch()`) และกันกดซ้ำ (idempotency key) เมื่อเป็นรายการเงินหรือรายการสำคัญ
- การลบข้อมูลสำคัญใช้ soft delete/ยกเลิกพร้อมเหตุผล และบันทึก audit แทนการลบแถว
- หน้าเว็บต้องใช้ได้บนมือถือ (iPhone Safari/PWA) และจอกว้าง ใช้ฟอนต์และสไตล์เดิมของรีโป
- escape ข้อความก่อนใส่ลง HTML เสมอ (กัน XSS) และอย่าเพิ่ม CDN/สคริปต์ภายนอกใหม่ถ้าไม่จำเป็น

## ความปลอดภัยและ secrets

- `JWT_SECRET` ต้องตรงกับ Worker `banpadeng-school-db` ทุกตัวอักษร (ใช้ session/บัญชีร่วม) ห้ามหมุนค่าในรีโปเดียว
- `NOTIFY_API_KEY` = `API_KEY` ของ school-notify
- ห้าม commit secret, token, รหัสผ่าน, `.env`, `.dev.vars`, ไฟล์สำรองฐานข้อมูล หรือข้อมูลนักเรียน/บุคลากรจริงลง Git
- secret ตั้งผ่าน Cloudflare dashboard หรือ `wrangler secret put` เท่านั้น (`keep_vars: true` ทำให้ค่าที่ตั้งใน dashboard ไม่ถูกทับ)
- ข้อมูลนักเรียนเป็นข้อมูลส่วนบุคคลของผู้เยาว์: ห้าม log ชื่อ เลขประจำตัว ที่อยู่ หรือข้อมูลผู้ปกครองลง console/observability
- ห้ามปิดหรือผ่อนการตรวจสิทธิ์ การจำกัดความถี่ล็อกอิน Turnstile หรือ passkey เพื่อให้ทดสอบง่าย

## ห้ามแตะ / ต้องระวังเป็นพิเศษ

- สูตรคะแนน/วันละครั้ง/ตักเตือนใน `src/routes/behavior.js` (กระทบผล ปพ.6)
- โครงสร้าง `ps_behavior_records` — students-report อ่านไปคำนวณ
- `good_deeds` — system ใช้ตารางเดียวกัน
- ไฟล์ที่คัดลอกมาจาก students-report: แก้แล้วต้องให้สองฝั่งตรงกัน

## ระบบที่เชื่อมกัน

- banpadeng-school-db: SSO จากเมนู ฝ่ายทั่วไป › รายงานพฤติกรรม (`publicservice_sso_codes`, ใช้ครั้งเดียว 60 วินาที)
- students-report: อ่านผลไปออก ปพ.6 · school-notify: แจ้งเตือนส่งต่อ/อนุมัติ

## Deploy

- Cloudflare Workers Builds เชื่อม `main`: merge = ขึ้นจริง

## เลขเวอร์ชันกลาง (แพทช์ข้ามรีโป)

รีโปนี้เชื่อมกับระบบบริหารโรงเรียน (D1 กลาง, `JWT_SECRET` ร่วม, SSO จาก system) จึงอยู่ในขอบเขตแพทช์กลาง:

- ทุกชุดการแก้ไขที่ merge/push เข้า `main` ต้องออกเลขแพทช์ใหม่ใน
  [`SATTASAI/banpadeng-school-db/CHANGELOG.md`](https://github.com/SATTASAI/banpadeng-school-db/blob/main/CHANGELOG.md) รวมงานเอกสาร
- อ่านเลขล่าสุดจาก CHANGELOG นั้นก่อนเสมอ ห้ามนับเลขแยกในรีโปนี้
- งานเล็ก/กลางเพิ่มเลขส่วนที่สาม งานใหญ่เพิ่มเลขส่วนที่สอง งานหลายรีโปในชุดเดียวใช้เลขเดียวและลิงก์ PR ทุกรีโป
- รายละเอียดกติกาอยู่ใน `README.md` ของ banpadeng-school-db หัวข้อ "เวอร์ชันและบันทึก Patch Update"

## Checklist ก่อนเปิด PR / merge

- [ ] test และ syntax check ทั้งหมดผ่าน
- [ ] ไม่มี secret/ข้อมูลจริงใน diff (`git diff --cached` ตรวจก่อน commit)
- [ ] ไม่แก้ `database_id`, `routes`, `services` และชื่อ Worker ใน wrangler config โดยไม่ได้สั่ง
- [ ] schema เปลี่ยนแบบเพิ่มเท่านั้น (add table/column) และรันซ้ำได้ ไม่ทำให้ข้อมูลเดิมหรือระบบอื่นพัง
- [ ] อัปเดต `README.md`/`docs/` เมื่อพฤติกรรมหรือขั้นตอนติดตั้งเปลี่ยน และบันทึกการตัดสินใจถาวรของผู้ใช้ลงไฟล์นี้
- [ ] commit/PR อธิบายเป็นภาษาไทยว่าเปลี่ยนอะไร เพราะอะไร และทดสอบอย่างไร
