const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const thDate = (iso) => iso ? new Date(String(iso).replace(" ", "T") + (iso.length > 10 ? "Z" : "T00:00:00+07:00")).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit" }) : "";

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `เกิดข้อผิดพลาด (${res.status})`); e.status = res.status; throw e; }
  return data;
}
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2500); }

const PRESETS = {
  deduct: [["มาสาย", 5], ["แต่งกายไม่ถูกระเบียบ", 5], ["ไม่ทำเวรทำความสะอาด", 5], ["พูดจาไม่สุภาพ", 5], ["ไม่เข้าแถว/ไม่ร่วมกิจกรรม", 5], ["ทำลายทรัพย์สินโรงเรียน", 10], ["ทะเลาะวิวาท", 10], ["หนีเรียน", 10]],
  add: [["จิตอาสาช่วยงานโรงเรียน", 5], ["ช่วยเหลือเพื่อน/ครู", 5], ["ทำความดี เก็บของได้คืนเจ้าของ", 10], ["บำเพ็ญประโยชน์ต่อชุมชน", 10]],
};

const S = { me: null, room: null, students: [], sel: new Set(), kind: null };

async function boot() {
  try { S.me = await api("/api/me"); } catch (e) { if (e.status === 401) return showLogin(); return showLogin(e.message); }
  $("login").hidden = true; $("app").hidden = false;
  $("who").textContent = `${S.me.user.full_name}${S.me.user.is_discipline && !S.me.user.is_admin ? " · ฝ่ายปกครอง" : ""}`;
  $("tabStaff").hidden = !S.me.user.is_admin;
  $("base").textContent = S.me.base; $("passmin").textContent = S.me.pass_min;
  $("year").innerHTML = S.me.years.map((y) => `<option value="${y.id}" ${y.id === S.me.year.id ? "selected" : ""}>${esc(y.label || y.year_be)}</option>`).join("");
  $("term").value = String(S.me.term);
  fillRooms();
  await loadRoom();
}

function fillRooms() {
  const saved = localStorage.getItem("ps-room");
  $("room").innerHTML = S.me.rooms.map((r) => { const k = `${r.grade_level}/${r.classroom}`; return `<option value="${esc(k)}" ${k === saved ? "selected" : ""}>${esc(k)} (${r.students} คน)</option>`; }).join("");
}

function showLogin(msg) {
  $("app").hidden = true; $("login").hidden = false;
  if (msg) { $("lerr").textContent = msg; $("lerr").hidden = false; }
}

$("lf").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("lgo").disabled = true; $("lerr").hidden = true;
  try {
    await api("/api/auth/login", { method: "POST", body: { ...Object.fromEntries(new FormData($("lf"))), turnstile_token: window.SchoolTurnstile?.token() || "" } });
    await boot();
  } catch (ex) { $("lerr").textContent = ex.message; $("lerr").hidden = false; window.SchoolTurnstile?.reset(); }
  $("lgo").disabled = false;
});
$("logout").onclick = async () => { await api("/api/auth/logout", { method: "POST" }).catch(() => {}); location.reload(); };

document.querySelectorAll("#tabs button").forEach((b) => b.onclick = () => {
  document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("on", x === b));
  $("score").hidden = b.dataset.tab !== "score"; $("staff").hidden = b.dataset.tab !== "staff";
  if (b.dataset.tab === "staff") loadStaff();
});

$("year").onchange = async () => {
  S.me = await api(`/api/me?year=${$("year").value}`);
  $("term").value = String(S.me.term); fillRooms(); loadRoom();
};
$("term").onchange = loadRoom;
$("room").onchange = () => { localStorage.setItem("ps-room", $("room").value); loadRoom(); };
$("q").oninput = render;

async function loadRoom() {
  S.sel.clear(); S.students = [];
  const v = $("room").value;
  if (!v) { $("list").innerHTML = ""; $("stats").innerHTML = ""; $("empty").hidden = false; $("empty").textContent = "ยังไม่มีห้องที่บันทึกได้ — ครูประจำชั้นต้องได้รับมอบหมายห้องที่ระบบรายงานผลการเรียน หรือให้ผู้ดูแลกำหนดเป็นครูฝ่ายปกครอง"; return; }
  const [grade, room] = v.split("/");
  S.room = { grade, room };
  try {
    const d = await api(`/api/room?year=${$("year").value}&term=${$("term").value}&grade=${encodeURIComponent(grade)}&room=${encodeURIComponent(room)}`);
    S.students = d.students;
  } catch (e) { toast(e.message); }
  render();
}

function render() {
  const q = $("q").value.trim();
  const list = S.students.filter((s) => !q || s.name.includes(q) || String(s.code).includes(q));
  $("empty").hidden = list.length > 0; $("empty").textContent = "ไม่พบนักเรียน";
  const act = S.students.filter((s) => !s.left);
  const fails = act.filter((s) => !s.pass).length;
  const avg = act.length ? (act.reduce((a, s) => a + s.score, 0) / act.length).toFixed(1) : "-";
  $("stats").innerHTML = `<div class="stat"><span class="muted">นักเรียน</span><b>${act.length}</b></div>
    <div class="stat"><span class="muted">ผ่าน</span><b class="good">${act.length - fails}</b></div>
    <div class="stat"><span class="muted">ไม่ผ่าน</span><b class="bad">${fails}</b></div>
    <div class="stat"><span class="muted">คะแนนเฉลี่ย</span><b>${avg}</b></div>`;
  $("list").innerHTML = list.map((s) => `<div class="row ${s.pass ? "" : "fail"} ${s.left ? "left" : ""}" data-id="${s.id}">
      <input type="checkbox" ${s.left ? "disabled" : ""} ${S.sel.has(s.id) ? "checked" : ""} aria-label="เลือก ${esc(s.name)}">
      <span class="no">${s.number ?? ""}</span>
      <span class="nm"><a href="#" data-h="${s.id}">${esc(s.name)}</a><small>${esc(s.code)}${s.left ? " · ย้ายออก" : ""}${s.deduct_count ? ` · ตัด ${s.deduct_count} ครั้ง` : ""}${s.add_count ? ` · เพิ่ม ${s.add_count} ครั้ง` : ""}</small>
        <div class="meter"><i style="width:${s.score}%"></i></div></span>
      <span class="badge ${s.pass ? "ok" : "no"}">${s.pass ? "ผ่าน" : "ไม่ผ่าน"}</span>
      <span class="score ${s.pass ? "" : "bad"}">${s.score}</span>
    </div>`).join("");
  const selectable = list.filter((s) => !s.left);
  $("all").checked = selectable.length > 0 && selectable.every((s) => S.sel.has(s.id));
  updateSel();
}

$("list").addEventListener("change", (e) => {
  if (e.target.type !== "checkbox") return;
  const id = Number(e.target.closest(".row").dataset.id);
  e.target.checked ? S.sel.add(id) : S.sel.delete(id); updateSel();
});
$("list").addEventListener("click", (e) => {
  const a = e.target.closest("[data-h]"); if (!a) return;
  e.preventDefault(); openHist(Number(a.dataset.h));
});
$("all").onchange = () => {
  const q = $("q").value.trim();
  for (const s of S.students) if (!s.left && (!q || s.name.includes(q) || String(s.code).includes(q))) $("all").checked ? S.sel.add(s.id) : S.sel.delete(s.id);
  render();
};
function updateSel() {
  const n = S.sel.size;
  $("bDeduct").disabled = $("bAdd").disabled = !n;
  $("selCount").textContent = n ? `เลือก ${n} คน` : "";
}

$("bDeduct").onclick = () => openDlg("deduct");
$("bAdd").onclick = () => openDlg("add");
function openDlg(kind) {
  S.kind = kind;
  const names = S.students.filter((s) => S.sel.has(s.id)).map((s) => s.name);
  $("dTitle").textContent = kind === "deduct" ? "ตัดคะแนนพฤติกรรม" : "เพิ่มคะแนนพฤติกรรม";
  $("dTitle").className = kind === "deduct" ? "bad" : "good";
  $("dWho").textContent = names.length > 3 ? `${names.slice(0, 3).join(", ")} และอีก ${names.length - 3} คน` : names.join(", ");
  $("dPresets").innerHTML = PRESETS[kind].map(([r, p]) => `<button type="button" data-r="${esc(r)}" data-p="${p}">${esc(r)} (${kind === "deduct" ? "−" : "+"}${p})</button>`).join("");
  $("dReason").value = ""; $("dAmount").value = "5"; $("dDate").value = S.me.today; $("derr").hidden = true;
  $("dOk").className = `btn ${kind === "deduct" ? "danger" : "good"}`;
  $("dlg").showModal();
}
$("dPresets").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; $("dReason").value = b.dataset.r; $("dAmount").value = b.dataset.p; };
$("df").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "ok") return;
  e.preventDefault();
  $("dOk").disabled = true;
  try {
    await api("/api/records", { method: "POST", body: { year: $("year").value, term: $("term").value, grade: S.room.grade, room: S.room.room,
      kind: S.kind, amount: Number($("dAmount").value), reason: $("dReason").value, incident_date: $("dDate").value, student_ids: [...S.sel] } });
    $("dlg").close(); toast("บันทึกแล้ว"); await loadRoom();
  } catch (ex) { $("derr").textContent = ex.message; $("derr").hidden = false; }
  $("dOk").disabled = false;
});

async function openHist(id) {
  const qs = `year=${$("year").value}&term=${$("term").value}&grade=${encodeURIComponent(S.room.grade)}&room=${encodeURIComponent(S.room.room)}&student=${id}`;
  let d;
  try { d = await api(`/api/records?${qs}`); } catch (e) { return toast(e.message); }
  $("hTitle").innerHTML = `${esc(d.student.name)} — <span class="${d.score < S.me.pass_min ? "bad" : "good"}">${d.score} คะแนน</span>`;
  $("hBody").innerHTML = d.records.length ? d.records.map((r) => `<div class="rec ${r.cancelled_at ? "cx" : ""}">
      <span class="pt ${r.points < 0 ? "bad" : "good"}">${r.points > 0 ? "+" : ""}${r.points}</span>
      <span><span class="rs">${esc(r.reason)}</span><br><small class="muted">${thDate(r.incident_date)} · ${esc(r.created_by_name || "")}${r.cancelled_at ? ` · ยกเลิกโดย ${esc(r.cancelled_by_name || "")}: ${esc(r.cancel_reason)}` : ""}</small></span>
      ${r.can_cancel ? `<button class="btn ghost sm" data-cx="${r.id}">ยกเลิก</button>` : "<span></span>"}
    </div>`).join("") : `<p class="muted">ภาคเรียนนี้ยังไม่มีรายการ (${S.me.base} คะแนน)</p>`;
  $("hBody").onclick = async (e) => {
    const b = e.target.closest("[data-cx]"); if (!b) return;
    const reason = prompt("เหตุผลที่ยกเลิกรายการนี้"); if (!reason) return;
    try { await api(`/api/records/${b.dataset.cx}/cancel`, { method: "POST", body: { reason } }); toast("ยกเลิกแล้ว"); await loadRoom(); openHist(id); }
    catch (ex) { toast(ex.message); }
  };
  if (!$("hist").open) $("hist").showModal();
}
$("hClose").onclick = () => $("hist").close();

let staff = [];
async function loadStaff() {
  try { staff = (await api("/api/staff")).users; } catch (e) { return toast(e.message); }
  renderStaff();
}
function renderStaff() {
  const q = $("sq").value.trim();
  $("staffList").innerHTML = staff.filter((u) => !q || u.full_name.includes(q)).map((u) => `<label class="srow"><span>${esc(u.full_name)} <small class="muted">${esc(u.role)}</small></span>
    <input type="checkbox" data-u="${u.id}" ${u.discipline ? "checked" : ""} ${["superadmin", "executive"].includes(u.role) ? "disabled title=\"ผู้ดูแลระบบ/ผู้บริหารบันทึกได้ทุกห้องอยู่แล้ว\"" : ""}></label>`).join("");
}
$("sq").oninput = renderStaff;
$("staffList").addEventListener("change", async (e) => {
  const id = Number(e.target.dataset.u); if (!id) return;
  try { await api("/api/staff", { method: "PUT", body: { user_id: id, discipline: e.target.checked } }); staff.find((u) => u.id === id).discipline = e.target.checked; toast("บันทึกแล้ว"); }
  catch (ex) { e.target.checked = !e.target.checked; toast(ex.message); }
});

boot();
