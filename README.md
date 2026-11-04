# publicservice — ระบบคะแนนพฤติกรรมนักเรียน

ตัด/เพิ่มคะแนนพฤติกรรมนักเรียน ป.1–6 โรงเรียนบ้านป่าเด็ง ผลส่งไป **กิจกรรมเพื่อสังคมและสาธารณประโยชน์** ใน ปพ.6 ของระบบรายงานผลการเรียน (students-report) อัตโนมัติ

## กติกา
- เริ่มภาคเรียนละ 100 คะแนน (นับแยกภาค 1 / ภาค 2) ตัดหรือเพิ่มได้ ไม่เกิน 100 ไม่ต่ำกว่า 0 (ไล่ตามลำดับที่บันทึก — เพิ่มตอนเต็ม 100 ไม่สะสม)
- ต่ำกว่า 50 คะแนน → กิจกรรมเพื่อสังคมฯ ภาคนั้น "มผ" (ช่องจุดประสงค์ `act_social_o1/o2`) — students-report คำนวณสดจาก `ps_behavior_records` ใน `assessmentsFor` (ไม่เขียนลง gr_assessments) ผลทั้งปีไม่ผ่านถ้าไม่ผ่านภาคใดภาคหนึ่ง
- สิทธิ์: ครูประจำชั้น (gr_homerooms ของระบบรายงานผลฯ) = เห็น/บันทึกเฉพาะห้องของตน · ครูฝ่ายปกครอง = ทุกห้อง + หน้าภาพรวมทั้งโรงเรียน (`/api/overview`)
- ครูฝ่ายปกครอง = ครูฝ่ายบริหารทั่วไปทุกคนอัตโนมัติ (`personnel_records.departments` มี `general`, status active, ยังปฏิบัติงาน) + ที่ superadmin/executive กำหนดเพิ่มใน ps_staff_roles + superadmin/executive
- เข้าจาก system เมนู ฝ่ายทั่วไป › รายงานพฤติกรรม ได้โดยไม่ต้องล็อกอินซ้ำ: system `/api/publicservice-sso` ออกรหัสใช้ครั้งเดียว 60 วินาที (`publicservice_sso_codes`) → `/sso?code=` ที่นี่แลกเป็น session
- หน้าเว็บเป็นแอปมือถือ (แถบนำทางล่าง, bottom sheet, ติดตั้งเป็น PWA ได้ผ่าน manifest.webmanifest) จอกว้างเปลี่ยนเป็นแถบนำทางซ้าย
- ยกเลิกรายการต้องมีเหตุผล (ผู้บันทึกเอง หรือฝ่ายปกครอง/ผู้ดูแล) รายการไม่ถูกลบ ประวัติอยู่ใน ps_audit
- ตัดคะแนนเรื่องเดียวกัน (เหตุผลเดียวกัน) ได้วันละครั้งต่อนักเรียน นับรวมทุกครู ตามวันที่เกิดเหตุ (เวลาไทย) · ยกเลิกรายการแล้วตัดใหม่ได้ · การเพิ่มคะแนนไม่จำกัด
- บันทึก (ตัด/เพิ่ม) ได้เฉพาะ จ.–ศ. ในเวลาที่ตั้งไว้ (ค่าเริ่มต้น 08:30–16:30 น.) ครูฝ่ายปกครอง/ผู้ดูแลแก้ได้ที่หน้าบัญชี (`ps_settings`)

## สถาปัตยกรรม
- Cloudflare Worker `publicservice` + static assets (`public/`), D1 `banpadeng_school_db` ร่วมกับ school-db / students-report, บัญชีจากตาราง `users`
- ตาราง `ps_*` สร้างเองเมื่อเรียก API ครั้งแรก (`src/lib/schema.js`)
- `src/lib/crypto.js`, `src/lib/auth-sessions.js` สำเนาจาก students-report · `src/lib/roster.js` คัดลอกตรรกะรายชื่อ/เลขที่จาก students-report (แก้ที่นั่นต้องแก้ที่นี่)
- สูตรคะแนน: `foldScore` (src/lib/schema.js) ต้องตรงกับ `behaviorScores` ใน students-report/src/lib/data.js

## ติดตั้ง
1. เชื่อม repo กับ Cloudflare Workers (หรือ `npx wrangler deploy`) — โดเมน `publicservice.banpadengschool.ac.th` ตั้งไว้ใน wrangler.jsonc
2. ตั้ง secret `JWT_SECRET` ให้ค่าเดียวกับ school-db/students-report (ถ้าเปิด Turnstile ให้ตั้ง `TURNSTILE_SECRET_KEY` และเพิ่มโดเมนนี้ใน widget ของ Turnstile)
3. ตรวจ `/api/health`
