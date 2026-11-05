const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const thDate = (iso) => iso ? new Date(String(iso).replace(" ", "T") + (iso.length > 10 ? "Z" : "T00:00:00+07:00")).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit" }) : "";
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } } };

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `เกิดข้อผิดพลาด (${res.status})`); e.status = res.status; throw e; }
  return data;
}
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2500); }
function closeOnBackdrop(d) { d.addEventListener("click", (e) => { if (e.target === d) d.close(); }); }
["periodDlg", "dlg", "hist", "cxDlg"].forEach((id) => closeOnBackdrop($(id)));

const PRESETS = {
  add: [["จิตอาสาช่วยงานโรงเรียน", 5], ["ช่วยเหลือเพื่อน/ครู", 5], ["ทำความดี เก็บของได้คืนเจ้าของ", 10], ["บำเพ็ญประโยชน์ต่อชุมชน", 10]],
};
// โซนความรุนแรงตามคะแนนที่หักต่อครั้ง (เกณฑ์จาก /api/me)
const ZONE_NAMES = ["เล็กน้อย", "ปานกลาง", "รุนแรง", "รุนแรงมาก"];
function zoneOf(p) { const z = S.me?.zones || { mid: 6, high: 10, severe: 16 }; p = Math.abs(p); return p >= z.severe ? 3 : p >= z.high ? 2 : p >= z.mid ? 1 : 0; }
const zoneTag = (p) => { const i = zoneOf(p); return `<span class="tag z${i}">${ZONE_NAMES[i]}</span>`; };
const TITLES = { overview: "ภาพรวมโรงเรียน", room: "ห้องเรียน", staff: "ครูฝ่ายปกครอง", me: "บัญชี" };

const S = { me: null, year: null, term: 1, tab: null, room: null, students: [], sel: new Set(), ov: null, action: null, hist: null };
const ringCls = (score) => (score < (S.me?.pass_min ?? 50) ? "low" : score < 70 ? "mid" : "");
const ring = (score) => `<div class="ring ${ringCls(score)}" style="--p:${score}"><span>${score}</span></div>`;
// เวลาเปิดบันทึก: จ.–ศ. ตามเวลาไทย (ตรวจซ้ำที่เซิร์ฟเวอร์)
function isOpen() {
  const h = S.me?.hours; if (!h) return true;
  const th = new Date(Date.now() + 7 * 3600e3), d = th.getUTCDay(), now = th.toISOString().slice(11, 16);
  return d >= 1 && d <= 5 && now >= h.start && now < h.end;
}
const closedMsg = () => `ปิดบันทึก · เปิดเฉพาะ จ.–ศ. ${S.me.hours.start}–${S.me.hours.end} น.`;
function paintOpen() {
  const open = isOpen();
  $("closedNote").hidden = open; $("closedNote").textContent = `🔒 ${closedMsg()} (ดูข้อมูลได้ตามปกติ)`;
  $("bDeduct").disabled = $("bAdd").disabled = !open;
}
setInterval(() => S.me && paintOpen(), 30000);
const roleLabel = (u) => u.is_admin ? "ผู้ดูแลระบบ/ผู้บริหาร" : u.is_general ? "ครูฝ่ายบริหารทั่วไป · ฝ่ายปกครอง" : u.is_discipline ? "ครูฝ่ายปกครอง" : "ครูประจำชั้น";

// ---------- เริ่มต้น ----------
async function boot() {
  try { S.me = await api("/api/me"); } catch (e) { return showLogin(e.status === 401 ? "" : e.message); }
  $("login").hidden = true; $("app").hidden = false;
  S.year = S.me.year.id; S.term = S.me.term;
  const u = S.me.user;
  $("navOverview").hidden = !u.is_discipline;
  $("navStaff").hidden = !u.is_admin;
  $("base").textContent = S.me.base; $("passmin").textContent = S.me.pass_min;
  $("profile").innerHTML = `<div class="av">${esc((u.full_name || "?").replace(/^(นาย|นางสาว|นาง)\s*/, "").charAt(0))}</div><div><b>${esc(u.full_name)}</b><span class="muted">${roleLabel(u)}</span></div>`;
  fillYears(); paintPeriod(); paintHours(); paintPresets();
  go(u.is_discipline ? "overview" : "room");
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

// ---------- นำทาง ----------
document.querySelectorAll("#nav button").forEach((b) => (b.onclick = () => go(b.dataset.tab)));
function go(tab) {
  S.tab = tab;
  document.querySelectorAll("#nav button").forEach((x) => x.classList.toggle("on", x.dataset.tab === tab));
  for (const id of ["overview", "room", "staff", "me"]) $(id).hidden = id !== tab;
  $("pageTitle").textContent = TITLES[tab];
  clearSel();
  window.scrollTo(0, 0);
  if (tab === "overview") loadOverview();
  if (tab === "room") { fillRoomChips(); loadRoom(); }
  if (tab === "staff") loadStaff();
  paintPeriod(); paintOpen();
}

// ---------- ปี/ภาค ----------
function fillYears() { $("year").innerHTML = S.me.years.map((y) => `<option value="${y.id}" ${y.id === S.year ? "selected" : ""}>${esc(y.label || y.year_be)}</option>`).join(""); }
function yearLabel() { const y = S.me.years.find((x) => x.id === S.year) || S.me.year; return y.year_be || y.label; }
function paintPeriod() {
  const t = `ภาค ${S.term}/${yearLabel()}`;
  $("period").textContent = t; $("mePeriod").textContent = `ภาคเรียนที่ ${S.term} ปีการศึกษา ${yearLabel()}`;
  $("pageSub").textContent = S.tab === "room" && S.room ? `ชั้น ${S.room.grade}/${S.room.room} · ${t}` : S.tab === "overview" ? `ป.1–ป.6 · ${t}` : "โรงเรียนบ้านป่าเด็ง";
}
const openPeriod = () => { fillYears(); paintSeg(); $("periodDlg").showModal(); };
$("period").onclick = openPeriod; $("openPeriod").onclick = openPeriod;
function paintSeg() { document.querySelectorAll("#termSeg button").forEach((b) => b.classList.toggle("on", Number(b.dataset.t) === S.term)); }
$("termSeg").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; S.term = Number(b.dataset.t); paintSeg(); };
$("periodOk").onclick = async () => {
  const y = Number($("year").value);
  if (y !== S.year) {
    try { S.me = await api(`/api/me?year=${y}`); S.year = y; } catch (e) { return toast(e.message); }
  }
  $("periodDlg").close(); go(S.tab);
};

// ---------- ภาพรวม ----------
async function loadOverview() {
  $("oHero").innerHTML = `<div class="lbl">กำลังโหลด…</div>`;
  try { S.ov = await api(`/api/overview?year=${S.year}&term=${S.term}`); } catch (e) { $("oHero").innerHTML = `<div class="lbl">${esc(e.message)}</div>`; return; }
  const st = S.ov.students, fails = st.filter((s) => !s.pass);
  const avg = st.length ? (st.reduce((a, s) => a + s.score, 0) / st.length).toFixed(1) : "-";
  $("oHero").innerHTML = `<div class="lbl">ผ่านกิจกรรมเพื่อสังคมฯ ทั้งโรงเรียน</div>
    <div class="big">${st.length - fails.length}<small> / ${st.length} คน</small></div>
    <div class="grid"><div><b>${fails.length}</b><span>ไม่ผ่าน</span></div><div><b>${avg}</b><span>คะแนนเฉลี่ย</span></div><div><b>${S.ov.rooms.length}</b><span>ห้องเรียน</span></div></div>`;
  const watch = st.filter((s) => s.score < 70).sort((a, b) => a.score - b.score);
  $("oFailCount").textContent = watch.length ? `${watch.length} คน (ต่ำกว่า 70)` : "";
  $("oFails").innerHTML = watch.length ? watch.slice(0, 30).map((s) => card(s, { room: true, nosel: true })).join("") : `<div class="empty">🎉 ไม่มีนักเรียนที่ต้องติดตาม</div>`;
  $("oRooms").innerHTML = S.ov.rooms.map((r) => {
    const pct = r.avg ?? 100;
    return `<button class="rm" data-g="${esc(r.grade)}" data-r="${esc(r.room)}"><b>${esc(r.grade)}/${esc(r.room)}</b><span class="meta">${r.students} คน · เฉลี่ย ${r.avg ?? "-"}</span>
      <div class="bar"><i class="${ringCls(pct)}" style="width:${pct}%"></i></div>
      <span class="f ${r.fails ? "bad" : "good"}">${r.fails ? `ไม่ผ่าน ${r.fails} คน` : "ผ่านทุกคน"}</span></button>`;
  }).join("");
  renderOSearch();
}
$("oRooms").onclick = (e) => { const b = e.target.closest(".rm"); if (!b) return; setRoom(b.dataset.g, b.dataset.r); go("room"); };
$("oq").oninput = renderOSearch;
function renderOSearch() {
  const q = $("oq").value.trim();
  $("oSearch").hidden = !q; $("oMain").hidden = !!q;
  if (!q || !S.ov) return;
  const hit = S.ov.students.filter((s) => s.name.includes(q) || String(s.code).includes(q)).slice(0, 40);
  $("oResults").innerHTML = hit.length ? hit.map((s) => card(s, { room: true, nosel: true })).join("") : `<div class="empty">ไม่พบนักเรียน</div>`;
}
for (const id of ["oFails", "oResults"]) $(id).onclick = (e) => {
  const c = e.target.closest(".st"); if (!c) return;
  openHist({ id: Number(c.dataset.id), grade: c.dataset.g, room: c.dataset.r });
};

// ---------- ห้องเรียน ----------
function setRoom(grade, room) { S.room = { grade, room }; store.set("ps-room", `${grade}/${room}`); }
function fillRoomChips() {
  const rooms = S.me.rooms;
  if (!S.room || !rooms.some((r) => r.grade_level === S.room.grade && r.classroom === S.room.room)) {
    const saved = store.get("ps-room");
    const pick = rooms.find((r) => `${r.grade_level}/${r.classroom}` === saved) || rooms[0];
    S.room = pick ? { grade: pick.grade_level, room: pick.classroom } : null;
  }
  $("roomChips").hidden = rooms.length < 2;
  $("roomChips").innerHTML = rooms.map((r) => `<button data-g="${esc(r.grade_level)}" data-r="${esc(r.classroom)}" class="${S.room && r.grade_level === S.room.grade && r.classroom === S.room.room ? "on" : ""}">${esc(r.grade_level)}/${esc(r.classroom)}</button>`).join("");
  $("roomChips").querySelector(".on")?.scrollIntoView({ inline: "center", block: "nearest" });
}
$("roomChips").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; setRoom(b.dataset.g, b.dataset.r); fillRoomChips(); clearSel(); loadRoom(); };

async function loadRoom() {
  S.students = []; paintPeriod();
  if (!S.room) {
    $("rHero").hidden = true; $("list").innerHTML = ""; $("listInfo").textContent = "";
    $("empty").hidden = false; $("empty").textContent = "ยังไม่มีห้องที่ท่านดูแล — ครูประจำชั้นต้องได้รับมอบหมายห้องที่ระบบรายงานผลการเรียน";
    return;
  }
  $("rHero").hidden = false;
  try {
    const d = await api(`/api/room?year=${S.year}&term=${S.term}&grade=${encodeURIComponent(S.room.grade)}&room=${encodeURIComponent(S.room.room)}`);
    S.students = d.students;
  } catch (e) { toast(e.message); }
  render();
}

function card(s, { room = false, nosel = false } = {}) {
  const sel = S.sel.has(s.id);
  return `<div class="st ${s.pass ? "" : "fail"} ${s.left ? "left" : ""} ${sel ? "sel" : ""}" data-id="${s.id}" data-g="${esc(s.grade || S.room?.grade || "")}" data-r="${esc(s.room || S.room?.room || "")}">
    ${nosel || s.left ? "" : `<span class="chk" data-chk>${sel ? "✓" : ""}</span>`}
    <div class="av">${s.number ?? "–"}</div>
    <div class="nm"><b>${esc(s.name)}</b><small>${room ? `<span class="tag room">${esc(s.grade)}/${esc(s.room)}</span> ` : ""}${esc(s.code)}${s.left ? " · ย้ายออก" : ""}${s.deduct_count ? ` · ตัด ${s.deduct_count}` : ""}${s.add_count ? ` · เพิ่ม ${s.add_count}` : ""}${s.warn_count ? ` · เตือน ${s.warn_count}` : ""}${s.pass ? "" : ' <span class="tag no">ไม่ผ่าน</span>'}</small>${(s.today_deducted || []).length ? `<small class="today">⚠ วันนี้ถูกตัดแล้ว: ${s.today_deducted.map(esc).join(", ")}</small>` : ""}${(s.today_warned || []).length ? `<small class="today">⚠ วันนี้ตักเตือนแล้ว: ${s.today_warned.map(esc).join(", ")}</small>` : ""}</div>
    ${ring(s.score)}
  </div>`;
}

function render() {
  const q = $("q").value.trim();
  const list = S.students.filter((s) => !q || s.name.includes(q) || String(s.code).includes(q));
  const act = S.students.filter((s) => !s.left), fails = act.filter((s) => !s.pass).length;
  const avg = act.length ? (act.reduce((a, s) => a + s.score, 0) / act.length).toFixed(1) : "-";
  $("rHero").innerHTML = `<div class="lbl">ชั้น ${esc(S.room.grade)}/${esc(S.room.room)} · ผ่านกิจกรรมเพื่อสังคมฯ</div>
    <div class="big">${act.length - fails}<small> / ${act.length} คน</small></div>
    <div class="grid"><div><b>${fails}</b><span>ไม่ผ่าน</span></div><div><b>${avg}</b><span>คะแนนเฉลี่ย</span></div><div><b>${act.reduce((a, s) => a + s.deduct_count, 0)}</b><span>ครั้งที่ตัด</span></div></div>`;
  $("empty").hidden = list.length > 0; $("empty").textContent = "ไม่พบนักเรียน";
  $("listInfo").textContent = `${list.length} คน · แตะวงกลมเพื่อเลือกหลายคน`;
  $("list").innerHTML = list.map((s) => card(s)).join("");
  const selectable = list.filter((s) => !s.left);
  $("selAll").textContent = selectable.length && selectable.every((s) => S.sel.has(s.id)) ? "ไม่เลือก" : "เลือกทั้งหมด";
  updateSel();
}
$("q").oninput = render;
$("list").onclick = (e) => {
  const c = e.target.closest(".st"); if (!c) return;
  const id = Number(c.dataset.id), s = S.students.find((x) => x.id === id);
  if (!s) return;
  if (!s.left && (e.target.closest("[data-chk]") || S.sel.size)) { S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); render(); return; }
  openHist({ id, grade: S.room.grade, room: S.room.room });
};
$("selAll").onclick = () => {
  const q = $("q").value.trim();
  const ids = S.students.filter((s) => !s.left && (!q || s.name.includes(q) || String(s.code).includes(q))).map((s) => s.id);
  const all = ids.length && ids.every((id) => S.sel.has(id));
  ids.forEach((id) => (all ? S.sel.delete(id) : S.sel.add(id)));
  render();
};
function clearSel() { S.sel.clear(); updateSel(); }
$("selClear").onclick = () => { S.sel.clear(); render(); };
function updateSel() {
  const n = S.sel.size;
  $("selBar").hidden = !n || S.tab !== "room";
  $("selCount").textContent = `เลือก ${n} คน`;
}
const selTarget = () => { const st = S.students.filter((s) => S.sel.has(s.id)); return { ids: st.map((s) => s.id), grade: S.room.grade, room: S.room.room, names: st.map((s) => s.name), today: st.map((s) => [...(s.today_deducted || []), ...(s.today_warned || [])]) }; };
$("bDeduct").onclick = () => openAction("deduct", selTarget());
$("bAdd").onclick = () => openAction("add", selTarget());

// ---------- ตัด/เพิ่มคะแนน ----------
function openAction(kind, target) {
  if (!isOpen()) return toast(closedMsg());
  S.action = { kind, ...target };
  const names = target.names;
  $("dTitle").textContent = kind === "deduct" ? "ตัดคะแนนพฤติกรรม" : "เพิ่มคะแนนพฤติกรรม";
  $("dTitle").className = kind === "deduct" ? "bad" : "good";
  $("dWho").textContent = `${target.grade}/${target.room} · ` + (names.length > 3 ? `${names.slice(0, 3).join(", ")} และอีก ${names.length - 3} คน` : names.join(", "));
  const wn = S.me.warn_n;
  $("dWarn").hidden = kind !== "deduct" || !wn;
  $("dWarn").textContent = `โซนเล็กน้อย: เรื่องเดียวกันต้องตักเตือนครบ ${wn} ครั้งในภาคเรียนก่อน จึงตัดคะแนนได้ (ยังไม่ครบ ระบบบันทึกเป็น "ตักเตือน") · โซนปานกลางขึ้นไป (หัก ${S.me.zones.mid} ขึ้นไป) เลือกเองว่าจะตักเตือนหรือตัดคะแนนเลย`;
  // ตัด/ตักเตือนเรื่องเดียวกันได้วันละครั้ง — บอกจำนวนคนที่บันทึกเรื่องนั้นวันนี้แล้ว
  const doneN = (r) => kind === "deduct" ? (target.today || []).filter((t) => t.includes(r)).length : 0;
  S.action.doneN = doneN; S.action.cat = ""; $("pq").value = "";
  // แท็บหมวด + ค้นหา (เฉพาะตัดคะแนน)
  const cats = kind === "deduct" ? [...new Set(S.me.presets_deduct.map((x) => x.cat || "อื่น ๆ"))] : [];
  $("pPick").hidden = !cats.length;
  $("pCats").innerHTML = cats.length ? [`<button type="button" data-c="" class="on">ทั้งหมด</button>`, ...cats.map((c) => `<button type="button" data-c="${esc(c)}">${esc(c)}</button>`)].join("") : "";
  $("dReason").value = "";
  paintPresetBtns(); $("dAmount").value = "5"; lockAmount(); paintZone(); $("dDate").value = S.me.today; $("dDate").max = S.me.today; $("derr").hidden = true;
  $("dOk").className = `btn lg ${kind === "deduct" ? "danger" : "good"}`;
  $("dlg").showModal();
}
function paintPresetBtns() {
  const a = S.action, kind = a.kind, q = $("pq").value.trim();
  let list = kind === "deduct" ? S.me.presets_deduct.map((x) => [x.reason, x.points, x.cat || "อื่น ๆ"]) : PRESETS.add.map(([r, p]) => [r, p, ""]);
  if (q) list = list.filter(([r]) => r.includes(q));
  else if (a.cat) list = list.filter((x) => x[2] === a.cat);
  const cur = $("dReason").value;
  $("dPresets").innerHTML = list.map(([r, p, c]) => { const n = a.doneN(r), all = n && n === a.ids.length;
    return `<button type="button" data-r="${esc(r)}" data-p="${p}" ${all ? "disabled" : ""} class="${n ? "done" : ""} ${r === cur ? "on" : ""}">${esc(r)}<b class="${kind === "deduct" ? "bad" : "good"}">${kind === "deduct" ? "−" : "+"}${p}</b>${kind === "deduct" ? zoneTag(p) : ""}${q && c ? `<small class="cat">${esc(c)}</small>` : ""}${n ? `<small>${all ? "บันทึกแล้ววันนี้" : `บันทึกแล้ว ${n} คน`}</small>` : ""}</button>`; }).join("") || `<div class="muted">ไม่พบข้อพฤติกรรม — พิมพ์เหตุผลเองด้านล่างได้</div>`;
}
$("pCats").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  S.action.cat = b.dataset.c; $("pq").value = "";
  $("pCats").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
  paintPresetBtns();
};
$("pq").oninput = () => paintPresetBtns();
$("pq").onkeydown = (e) => { if (e.key === "Enter") e.preventDefault(); };
$("dPresets").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  $("dPresets").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
  $("dReason").value = b.dataset.r; $("dAmount").value = b.dataset.p; lockAmount(); paintZone();
};
// ข้อพฤติกรรมที่กำหนดไว้ (ตัดคะแนน) ล็อกคะแนนตายตัว · พิมพ์เหตุผลเองจึงปรับคะแนนได้
function presetOf(reason) { return S.action?.kind === "deduct" ? S.me.presets_deduct.find((x) => x.reason === reason.trim()) : null; }
function lockAmount() {
  const pr = presetOf($("dReason").value), lock = !!pr;
  if (pr) $("dAmount").value = pr.points;
  $("dAmount").readOnly = lock;
  document.querySelectorAll("[data-step]").forEach((b) => (b.disabled = lock));
  $("dAmount").closest(".stepper").classList.toggle("locked", lock);
}
$("dReason").addEventListener("input", () => { lockAmount(); paintZone(); paintPresetBtns(); });
document.querySelectorAll("[data-step]").forEach((b) => (b.onclick = () => {
  const v = Math.min(100, Math.max(1, (Number($("dAmount").value) || 0) + Number(b.dataset.step)));
  $("dAmount").value = v; paintZone();
}));
function paintZone() {
  const show = S.action?.kind === "deduct", p = Number($("dAmount").value) || 0;
  $("dZone").hidden = !show || p < 1;
  if (show && p >= 1) $("dZone").innerHTML = `โซน ${zoneTag(p)}`;
  // โซนปานกลางขึ้นไป: เลือกเองว่าจะตักเตือนหรือตัดคะแนนเลย (ไม่มีค่าเริ่มต้น)
  const choose = show && p >= S.me.zones.mid;
  $("dModeBox").hidden = !choose;
  if (!choose) S.action && (S.action.mode = null);
  $("dMode").querySelectorAll("button").forEach((b) => b.classList.toggle("on", !!S.action && b.dataset.m === S.action.mode));
}
$("dMode").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; S.action.mode = b.dataset.m; paintZone(); };
$("dAmount").oninput = paintZone;
$("df").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "ok") return;
  e.preventDefault();
  const a = S.action;
  if (!$("dModeBox").hidden && !a.mode) { $("derr").textContent = "เลือก ตักเตือน หรือ ตัดคะแนนเลย"; $("derr").hidden = false; return; }
  $("dOk").disabled = true;
  try {
    const res = await api("/api/records", { method: "POST", body: { year: S.year, term: S.term, grade: a.grade, room: a.room,
      kind: a.kind, amount: Number($("dAmount").value), reason: $("dReason").value, mode: a.mode || undefined, incident_date: $("dDate").value, student_ids: a.ids } });
    const msg = [res.saved ? `${a.kind === "deduct" ? "ตัดคะแนน" : "บันทึกแล้ว"} ${res.saved} คน` : "", res.warned ? `ตักเตือน ${res.warned} คน` : "",
      res.skipped?.length ? `ข้าม ${res.skipped.length} คนที่บันทึกเรื่องนี้วันนี้แล้ว` : ""].filter(Boolean).join(" · ");
    $("dlg").close(); toast(msg);
    S.sel.clear(); await refresh();
  } catch (ex) { $("derr").textContent = ex.message; $("derr").hidden = false; }
  $("dOk").disabled = false;
});
async function refresh() {
  if (S.tab === "room") await loadRoom();
  if (S.tab === "overview") await loadOverview();
  if (S.hist && $("hist").open) await openHist(S.hist);
}

// ---------- ประวัติ ----------
async function openHist(t) {
  S.hist = t;
  const qs = `year=${S.year}&term=${S.term}&grade=${encodeURIComponent(t.grade)}&room=${encodeURIComponent(t.room)}&student=${t.id}`;
  let d;
  try { d = await api(`/api/records?${qs}`); } catch (e) { return toast(e.message); }
  const pass = d.score >= S.me.pass_min;
  $("hHead").innerHTML = `${ring(d.score)}<div><b>${esc(d.student.name)}</b><span class="muted">${esc(t.grade)}/${esc(t.room)} · เลขที่ ${d.student.number ?? "-"} · <span class="${pass ? "good" : "bad"}">${pass ? "ผ่าน" : "ไม่ผ่าน"}</span></span></div>`;
  const today = [...new Set(d.records.filter((r) => !r.cancelled_at && (r.points < 0 || r.warn) && r.incident_date === S.me.today).map((r) => r.reason))];
  const dis = isOpen() ? "" : "disabled";
  $("hAct").innerHTML = `${today.length ? `<div class="today">⚠ วันนี้ถูกตัด/ตักเตือนแล้ว: ${today.map(esc).join(", ")}</div>` : ""}${dis ? `<div class="today">🔒 ${closedMsg()}</div>` : ""}<button class="btn danger" data-k="deduct" ${dis}>− ตัดคะแนน</button><button class="btn good" data-k="add" ${dis}>+ เพิ่มคะแนน</button>`;
  $("hAct").onclick = (e) => { const b = e.target.closest("[data-k]"); if (!b) return; openAction(b.dataset.k, { ids: [t.id], grade: t.grade, room: t.room, names: [d.student.name], today: [today] }); };
  $("hBody").innerHTML = d.records.length ? d.records.map((r) => `<div class="rec ${r.cancelled_at ? "cx" : ""}">
      ${r.warn ? `<span class="pt warn">เตือน</span>` : `<span class="pt ${r.points < 0 ? "bad" : "good"}">${r.points > 0 ? "+" : ""}${r.points}</span>`}
      <span class="tx"><span class="rs">${esc(r.reason)}${r.points < 0 ? zoneTag(r.points) : ""}</span><small>${thDate(r.incident_date)} · ${esc(r.created_by_name || "")}${r.cancelled_at ? ` · ยกเลิกโดย ${esc(r.cancelled_by_name || "")}: ${esc(r.cancel_reason)}` : ""}</small></span>
      ${r.can_cancel ? `<button class="btn ghost" data-cx="${r.id}" data-warn="${r.warn ? 1 : ""}" data-what="${esc(r.warn ? `ตักเตือน: ${r.reason}` : `${r.points > 0 ? "+" : ""}${r.points} ${r.reason}`)}">ยกเลิก</button>` : ""}
    </div>`).join("") : `<div class="empty">ภาคเรียนนี้ยังไม่มีรายการ (${S.me.base} คะแนน)</div>`;
  if (!$("hist").open) $("hist").showModal();
}
$("hBody").onclick = (e) => {
  const b = e.target.closest("[data-cx]"); if (!b) return;
  S.cancelId = b.dataset.cx; S.cancelWarn = !!b.dataset.warn; $("cxWhat").textContent = b.dataset.what; $("cxReason").value = ""; $("cxerr").hidden = true;
  $("cxDlg").showModal();
};
$("cxf").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "ok") return;
  e.preventDefault();
  $("cxOk").disabled = true;
  try { await api(`/api/records/${S.cancelId}/cancel`, { method: "POST", body: { reason: $("cxReason").value, warn: S.cancelWarn } }); $("cxDlg").close(); toast("ยกเลิกแล้ว"); await refresh(); }
  catch (ex) { $("cxerr").textContent = ex.message; $("cxerr").hidden = false; }
  $("cxOk").disabled = false;
});
$("hClose").onclick = () => $("hist").close();

// ---------- ครูฝ่ายปกครอง ----------
let staff = [], canOverride = false;
async function loadStaff() {
  try { ({ users: staff, can_override: canOverride } = await api("/api/staff")); } catch (e) { return toast(e.message); }
  renderStaff();
}
function renderStaff() {
  const q = $("sq").value.trim();
  const admin = (u) => ["superadmin", "executive"].includes(u.role);
  const on = (u) => admin(u) || (u.general && !u.revoked) || (!u.general && u.discipline);
  const list = staff.filter((u) => !q || u.full_name.includes(q))
    .sort((a, b) => on(b) - on(a) || a.full_name.localeCompare(b.full_name, "th"));
  $("staffList").innerHTML = list.map((u) => {
    const locked = admin(u) || (u.general && !canOverride);
    const note = admin(u) ? "ผู้ดูแลระบบ/ผู้บริหาร · ทุกห้องอยู่แล้ว" : u.general ? (u.revoked ? "ฝ่ายบริหารทั่วไป · Superadmin ปิดสิทธิ์" : "ฝ่ายบริหารทั่วไป · อัตโนมัติ")
      : u.discipline ? "กำหนดเอง" : "ครูประจำชั้น (เฉพาะห้องของตน)";
    return `<div class="item"><span class="who"><b>${esc(u.full_name)}</b><small>${note}</small></span>
      <label class="switch"><input type="checkbox" data-u="${u.id}" ${on(u) ? "checked" : ""} ${locked ? "disabled" : ""} aria-label="ฝ่ายปกครอง ${esc(u.full_name)}"><i></i></label></div>`;
  }).join("") || `<div class="item muted">ไม่พบ</div>`;
}
$("sq").oninput = renderStaff;
$("staffList").addEventListener("change", async (e) => {
  const id = Number(e.target.dataset.u); if (!id) return;
  try { await api("/api/staff", { method: "PUT", body: { user_id: id, discipline: e.target.checked } }); const u = staff.find((x) => x.id === id); if (u.general) u.revoked = !e.target.checked; else u.discipline = e.target.checked; toast("บันทึกแล้ว"); renderStaff(); }
  catch (ex) { e.target.checked = !e.target.checked; toast(ex.message); }
});

// ---------- เวลาเปิดบันทึก ----------
function paintHours() {
  const h = S.me.hours, edit = S.me.user.is_admin;
  $("hoursTxt").textContent = `จ.–ศ. ${h.start}–${h.end} น.`;
  $("hoursEdit").hidden = !edit;
  if (edit) { $("hStart").value = h.start; $("hEnd").value = h.end; $("wN").value = S.me.warn_n; }
  $("warnTxt").textContent = S.me.warn_n ? `${S.me.warn_n} ครั้ง (เรื่องเดียวกัน/ภาคเรียน)` : "ไม่ต้องตักเตือน";
  $("warnEdit").hidden = !edit;
  const z = S.me.zones;
  $("zoneTxt").textContent = `เล็กน้อย 1–${z.mid - 1} · ปานกลาง ${z.mid}–${z.high - 1} · รุนแรง ${z.high}–${z.severe - 1} · รุนแรงมาก ${z.severe}+`;
  $("zoneEdit").hidden = !edit;
  if (edit) { $("zMid").value = z.mid; $("zHigh").value = z.high; $("zSev").value = z.severe; }
}
function paintPresets() {
  const edit = S.me.user.is_admin;
  $("presetSec").hidden = !edit;
  if (!edit) return;
  const list = S.me.presets_deduct, cats = [...new Set(list.map((x) => x.cat || "อื่น ๆ"))];
  $("presetList").innerHTML = cats.map((c) => `<div class="item grp">${esc(c)}</div>` + list.map((x, i) => [x, i]).filter(([x]) => (x.cat || "อื่น ๆ") === c)
    .map(([x, i]) => `<div class="item"><span class="who"><b>${esc(x.reason)}</b><small>−${x.points} ${zoneTag(x.points)}</small></span><button class="btn ghost" data-del="${i}">ลบ</button></div>`).join("")).join("") || `<div class="item muted">ยังไม่มีข้อพฤติกรรม</div>`;
  $("pCatList").innerHTML = cats.map((c) => `<option value="${esc(c)}">`).join("");
}
async function savePresets(list) {
  try { const d = await api("/api/settings", { method: "PUT", body: { presets_deduct: list } }); S.me.presets_deduct = d.presets_deduct; paintPresets(); toast("บันทึกแล้ว"); return true; }
  catch (e) { toast(e.message); return false; }
}
$("presetList").onclick = (e) => {
  const b = e.target.closest("[data-del]"); if (!b) return;
  const x = S.me.presets_deduct[Number(b.dataset.del)];
  if (!confirm(`ลบ "${x.reason}"?`)) return;
  savePresets(S.me.presets_deduct.filter((_, i) => i !== Number(b.dataset.del)));
};
$("pAdd").onclick = async () => {
  const reason = $("pReason").value.trim(), points = Number($("pPoints").value), cat = $("pCat").value.trim() || "อื่น ๆ";
  if (!reason) return toast("ระบุข้อพฤติกรรม");
  const cur = S.me.presets_deduct, list = cur.some((x) => x.reason === reason) ? cur.map((x) => (x.reason === reason ? { reason, points, cat } : x)) : cur.concat({ reason, points, cat });
  if (await savePresets(list)) { $("pReason").value = ""; $("pPoints").value = "5"; }
};
$("zoneSave").onclick = async () => {
  try { const d = await api("/api/settings", { method: "PUT", body: { zones: { mid: Number($("zMid").value), high: Number($("zHigh").value), severe: Number($("zSev").value) } } }); S.me.zones = d.zones; paintHours(); paintPresets(); toast("บันทึกแล้ว"); }
  catch (e) { toast(e.message); }
};
$("warnSave").onclick = async () => {
  try { const d = await api("/api/settings", { method: "PUT", body: { warn_count: Number($("wN").value) } }); S.me.warn_n = d.warn_n; paintHours(); toast("บันทึกแล้ว"); }
  catch (e) { toast(e.message); }
};
$("hoursSave").onclick = async () => {
  try { const d = await api("/api/settings", { method: "PUT", body: { start: $("hStart").value, end: $("hEnd").value } }); S.me.hours = d.hours; paintHours(); paintOpen(); toast("บันทึกเวลาแล้ว"); }
  catch (e) { toast(e.message); }
};

boot();
