# ⚡ KPGreenergy Planner - Master System Blueprint & Development Dossier

> **เอกสารสรุปสถาปัตยกรรมและกฎระบบทั้งหมดสำหรับการพัฒนาเวอร์ชันสำรอง (Dev / Staging Environment)**

---

## 📌 1. ภาพรวมโปรเจกต์ (Project Overview)
- **ชื่อระบบ:** KPGreenergy Planner (ระบบติดตามความก้าวหน้าโครงการโซลาร์และคำนวณกราฟ S-Curve 2-Way แบบ Real-time)
- **ธีมสี:** Forest Dark Green (#043327) ผสมสีทอง Amber (#d97706)
- **จำนวนโครงการ:** 137 โครงการโซลาร์ (Solar Rooftop / Farm / Floating)
- **จำนวน Milestone ต่อโครงการ:** 33 รายการ (เริ่มต้นที่ *Soiling Test* สิ้นสุดที่ *Punch list* เท่านั้น)

---

## 🏗️ 2. สถาปัตยกรรมระบบ (System Architecture)
1. **Backend:** Python FastAPI (server.py, engine.py, data_cache.json, data_cache_backup.json)
   - คำนวณ S-Curve แบบสัปดาห์ (Cumulative Planned %, Cumulative Actual %, Weekly Planned %, Weekly Actual %)
   - ระบบบันทึกแบบ **Atomic Write** (data_cache.json.tmp -> data_cache.json) เพื่อป้องกันไฟล์เสียหาย 100%
   - จัดเก็บ Web App URL ส่วนกลางบนเซิร์ฟเวอร์เพื่อให้มือถือ LINE LIFF บันทึกได้อัตโนมัติ
2. **Frontend:** Single-Page Web Dashboard (static/index.html, static/app.js, TailwindCSS, ApexCharts, Lucide Icons)
   - **Tab 1:** ภาพรวมโครงการทุกล็อต (Phase Overview & KPIs)
   - **Tab 2:** รายละเอียดโครงการ + กราฟ S-Curve + ตาราง Milestone 33 รายการ + ปุ่ม Quick Update + ปุ่ม Export PDF 2 หน้า
   - **Tab 3:** กราฟแท่งเปรียบเทียบความก้าวหน้าทุกล็อต (Multi-Project Comparison) + ตาราง Delayed Watchlist
   - **Tab 4:** ระบบกล้องวงจรปิดเรียลไทม์ (CCTV 4 ช่อง)
   - **Tab 5:** ระบบเชื่อมต่อ Google Sheets 2-Way & LINE Integration
3. **LINE Mobile Integration (LIFF):** static/liff.html, static/liff.js
   - แบบฟอร์มบันทึกความคืบหน้าหน้างานผ่านมือถือในแอป LINE (1-Tap Seamless)
4. **Google Sheets 2-Way Sync:**
   - ชีตหลัก: Plan, data Progress, Weight Prj, Log_Updates
   - สคริปต์: google_apps_script.js (doPost, doGet, onEdit)

---

## 🔒 3. กฎความปลอดภัยและเงื่อนไขการทำงานเฉพาะ (Business Logic Rules)

1. **รหัสผ่านการแก้ไขข้อมูล (Security Password):**
   - รหัสผ่าน: KPGEditor (ใช้สำหรับการแก้ไขบนหน้าเว็บ)
2. **เงื่อนไขวันที่เสร็จจริง (Actual Finish Date Rule):**
   - **ระดับ Milestone:** หาก % Progress ยังไม่ถึง 100% จะแสดงเป็น - (ไม่แสดงวันที่เสร็จจริง จนกว่าจะครบ 100%)
   - **ระดับโครงการ (Project Actual Timeline):** โครงการจะแสดงวันเสร็จจริงก็ต่อเมื่อ **ทุก Milestone ที่มี Weight > 0% เสร็จครบ 100% เท่านั้น** (โดยดึงวันที่เสร็จสิ้นล่าสุดของ Milestone สุดท้ายมาใส่) หากยังไม่ครบ 100% จะแสดงเป็น วันเริ่มจริง ถึง -
3. **รายงาน PDF (Executive 2-Page Report):**
   - ล็อกขนาดตายตัว 210mm x 297mm (A4 มาตรฐาน) พอดีเป๊ะ 2 หน้าเสมอ:
     - **หน้า 1:** ข้อมูลโครงการ + การ์ด KPI + กราฟ S-Curve ความละเอียดสูง + แถบสรุปตัวเลข
     - **หน้า 2:** ตาราง Milestone ครบทั้ง 33 รายการ + กล่องลงนามวิศวกรและผู้จัดการ
