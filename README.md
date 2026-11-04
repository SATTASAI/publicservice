# publicservice — ระบบคะแนนพฤติกรรมนักเรียน

ตัด/เพิ่มคะแนนพฤติกรรมนักเรียน ป.1–6 โรงเรียนบ้านป่าเด็ง ผลส่งไป **กิจกรรมเพื่อสังคมและสาธารณประโยชน์** ใน ปพ.6 ของระบบรายงานผลการเรียน (students-report) อัตโนมัติ

## กติกา
- เริ่มภาคเรียนละ 100 คะแนน (นับแยกภาค 1 / ภาค 2) ตัดหรือเพิ่มได้ ไม่เกิน 100 ไม่ต่ำกว่า 0 (ไล่ตามลำดับที่บันทึก — เพิ่มตอนเต็ม 100 ไม่สะสม)
- ต่ำกว่า 50 คะแนน → กิจกรรมเพื่อสังคมฯ ภาคนั้น "มผ" (ช่องจุดประสงค์ `act_social_o1/o2`) — students-report คำนวณสดจาก `ps_behavior_records` ใน `assessmentsFor` (ไม่เขียนลง gr_assessments) ผลทั้งปีไม่ผ่านถ้าไม่ผ่านภาคใดภาคหนึ่ง
- สิทธิ์: ครูประจำชั้น (gr_homerooms ของระบบรายงานผลฯ) = ห้องของตน · ครูฝ่ายปกครอง (ps_staff_roles) และ superadmin/executive = ทุกห้อง · superadmin/executive กำหนดครูฝ่ายปกครองที่แท็บ "ครูฝ่ายปกครอง"
- ยกเลิกรายการต้องมีเหตุผล (ผู้บันทึกเอง หรือฝ่ายปกครอง/ผู้ดูแล) รายการไม่ถูกลบ ประวัติอยู่ใน ps_audit

## สถาปัตยกรรม
- Cloudflare Worker `publicservice` + static assets (`public/`), D1 `banpadeng_school_db` ร่วมกับ school-db / students-report, บัญชีจากตาราง `users`
- ตาราง `ps_*` สร้างเองเมื่อเรียก API ครั้งแรก (`src/lib/schema.js`)
- `src/lib/crypto.js`, `src/lib/auth-sessions.js` สำเนาจาก students-report · `src/lib/roster.js` คัดลอกตรรกะรายชื่อ/เลขที่จาก students-report (แก้ที่นั่นต้องแก้ที่นี่)
- สูตรคะแนน: `foldScore` (src/lib/schema.js) ต้องตรงกับ `behaviorScores` ใน students-report/src/lib/data.js

## ติดตั้ง
1. เชื่อม repo กับ Cloudflare Workers (หรือ `npx wrangler deploy`) — โดเมน `publicservice.banpadengschool.ac.th` ตั้งไว้ใน wrangler.jsonc
2. ตั้ง secret `JWT_SECRET` ให้ค่าเดียวกับ school-db/students-report (ถ้าเปิด Turnstile ให้ตั้ง `TURNSTILE_SECRET_KEY` และเพิ่มโดเมนนี้ใน widget ของ Turnstile)
3. ตรวจ `/api/health`
