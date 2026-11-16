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
["periodDlg", "dlg", "hist", "cxDlg", "rdDlg", "mdDlg"].forEach((id) => closeOnBackdrop($(id)));

// โซนความรุนแรงตามคะแนนที่หักต่อครั้ง (เกณฑ์จาก /api/me)
const ZONE_NAMES = ["เล็กน้อย", "ปานกลาง", "รุนแรง", "รุนแรงมาก"];
function zoneOf(p) { const z = S.me?.zones || { mid: 6, high: 10, severe: 16 }; p = Math.abs(p); return p >= z.severe ? 3 : p >= z.high ? 2 : p >= z.mid ? 1 : 0; }
const zoneTag = (p) => { const i = zoneOf(p); return `<span class="tag z${i}">${ZONE_NAMES[i]}</span>`; };
const TITLES = { overview: "ภาพรวมโรงเรียน", room: "ห้องเรียน", refer: "ส่งต่อฝ่ายปกครอง", stats: "สถิติคะแนน", staff: "ครูฝ่ายปกครอง", me: "บัญชี" };

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
  paintBadge();
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
  for (const id of ["overview", "room", "refer", "stats", "staff", "me"]) $(id).hidden = id !== tab;
  $("pageTitle").textContent = TITLES[tab];
  clearSel();
  document.querySelector(".content").scrollTo(0, 0);
  if (tab === "overview") loadOverview();
  if (tab === "room") { fillRoomChips(); loadRoom(); }
  if (tab === "stats") { fillStatRooms(); loadStats(); }
  if (tab === "staff") loadStaff();
  if (tab === "refer") loadRefer();
  paintPeriod(); paintOpen();
}

// ---------- ปี/ภาค ----------
function fillYears() { $("year").innerHTML = S.me.years.map((y) => `<option value="${y.id}" ${y.id === S.year ? "selected" : ""}>${esc(y.label || y.year_be)}</option>`).join(""); }
function yearLabel() { const y = S.me.years.find((x) => x.id === S.year) || S.me.year; return y.year_be || y.label; }
function paintPeriod() {
  const t = `ภาค ${S.term}/${yearLabel()}`;
  $("period").textContent = t; $("mePeriod").textContent = `ภาคเรียนที่ ${S.term} ปีการศึกษา ${yearLabel()}`;
  $("pageSub").textContent = S.tab === "room" && S.room ? `ชั้น ${S.room.grade}/${S.room.room} · ${t}` : S.tab === "overview" ? `ป.1–ป.6 · ${t}` : S.tab === "refer" ? `${S.me.user.is_discipline ? "ทั้งโรงเรียน" : "ที่ท่านส่งต่อ"} · ${t}` : S.tab === "stats" ? `${S.stRoom ? `ชั้น ${S.stRoom}` : S.me.user.is_discipline ? "ทั้งโรงเรียน" : "ห้องที่ดูแล"} · ${t}` : "โรงเรียนบ้านป่าเด็ง";
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
    <div class="nm"><b>${esc(s.name)}</b><small>${room ? `<span class="tag room">${esc(s.grade)}/${esc(s.room)}</span> ` : ""}${esc(s.code)}${s.left ? " · ย้ายออก" : ""}${s.deduct_count ? ` · ตัด ${s.deduct_count}` : ""}${s.add_count ? ` · เพิ่ม ${s.add_count}` : ""}${s.warn_count ? ` · เตือน ${s.warn_count}` : ""}${s.pass ? "" : ' <span class="tag no">ไม่ผ่าน</span>'}</small>${(s.today_deducted || []).length ? `<small class="today">⚠ วันนี้ถูกตัดแล้ว: ${s.today_deducted.map(esc).join(", ")}</small>` : ""}${(s.today_warned || []).length ? `<small class="today">⚠ วันนี้ตักเตือนแล้ว: ${s.today_warned.map(esc).join(", ")}</small>` : ""}${(s.today_referred || []).length ? `<small class="today ref">⏳ รอฝ่ายปกครอง: ${s.today_referred.map(esc).join(", ")}</small>` : ""}</div>
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
const selTarget = () => { const st = S.students.filter((s) => S.sel.has(s.id)); return { ids: st.map((s) => s.id), grade: S.room.grade, room: S.room.room, names: st.map((s) => s.name), today: st.map((s) => [...(s.today_deducted || []), ...(s.today_warned || []), ...(s.today_referred || [])]) }; };
$("bDeduct").onclick = () => openAction("deduct", selTarget());
$("bAdd").onclick = () => openAction("add", selTarget());

// ---------- ตัด/เพิ่มคะแนน ----------
function openAction(kind, target) {
  if (!isOpen()) return toast(closedMsg());
  S.action = { kind, ...target };
  const names = target.names;
  const disc = S.me.user.is_discipline;
  $("dTitle").textContent = kind === "deduct" ? "ตัดคะแนนพฤติกรรม" : disc ? "บันทึกความดี + เพิ่มคะแนน" : "บันทึกความดี (ให้ฝ่ายปกครองอนุมัติ)";
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
  $("dReason").value = ""; $("dDetail").value = "";
  $("dReasonBox").hidden = kind === "add"; $("dDetailBox").hidden = kind !== "add";
  $("dMerit").hidden = kind !== "add";
  $("dMerit").textContent = disc ? "ครูฝ่ายปกครองบันทึก = เพิ่มคะแนนทันทีตามประเภทความดี · ซิงค์ไปบันทึกความดีในระบบบริหารโรงเรียน"
    : "ยังไม่เพิ่มคะแนนจนกว่าครูฝ่ายปกครองอนุมัติ (คะแนนตามประเภทความดี) · ซิงค์ไปบันทึกความดีในระบบบริหารโรงเรียน";
  paintPresetBtns(); $("dAmount").value = "5"; lockAmount(); paintZone(); $("dDate").value = S.me.today; $("dDate").max = S.me.today; $("derr").hidden = true;
  S.action.refer = false; $("dNote").value = "";
  $("dReferBox").hidden = kind !== "deduct" || S.me.user.is_discipline;
  paintZone();
  $("dlg").showModal();
}
function paintPresetBtns() {
  const a = S.action, kind = a.kind, q = $("pq").value.trim();
  let list = kind === "deduct" ? S.me.presets_deduct.map((x) => [x.reason, x.points, x.cat || "อื่น ๆ"]) : S.me.merit_points.map((x) => [x.cat, x.points, ""]);
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
function presetOf(reason) { return S.action?.kind === "deduct" ? S.me.presets_deduct.find((x) => x.reason === reason.trim()) : S.action?.kind === "add" ? { points: (S.me.merit_points.find((x) => x.cat === reason) || {}).points ?? 0 } : null; }
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
  // ส่งต่อฝ่ายปกครอง: หัก ≥ refer_min ส่งต่ออัตโนมัติ (ครูที่ไม่ใช่ฝ่ายปกครอง) · ต่ำกว่านั้นเลือกเองได้
  const canRefer = show && !S.me.user.is_discipline, auto = canRefer && p >= S.me.refer_min;
  const refer = canRefer && (auto || !!S.action?.refer);
  $("dRefer").checked = refer; $("dRefer").disabled = auto;
  $("dReferHint").textContent = auto ? `หัก ${S.me.refer_min} คะแนนขึ้นไป ระบบส่งต่อฝ่ายปกครองอัตโนมัติ — ยังไม่หักคะแนนจนกว่าฝ่ายปกครองพิจารณา` : "ฝ่ายปกครองเป็นผู้พิจารณาและกดหักคะแนน (ยังไม่หักทันที)";
  $("dNoteBox").hidden = !refer;
  $("dWarn").hidden = !show || !S.me.warn_n || refer;
  $("dOk").textContent = refer ? "ส่งต่อฝ่ายปกครอง" : S.action?.kind === "add" && !S.me.user.is_discipline ? "ส่งให้ฝ่ายปกครองอนุมัติ" : "บันทึก";
  $("dOk").className = `btn lg ${refer ? "primary" : S.action?.kind === "add" ? "good" : "danger"}`;
  $("dZone").hidden = !show || p < 1;
  if (show && p >= 1) $("dZone").innerHTML = `โซน ${zoneTag(p)}`;
  // โซนปานกลางขึ้นไป: เลือกเองว่าจะตักเตือนหรือตัดคะแนนเลย (ไม่มีค่าเริ่มต้น)
  const choose = show && !refer && p >= S.me.zones.mid;
  $("dModeBox").hidden = !choose;
  if (!choose) S.action && (S.action.mode = null);
  $("dMode").querySelectorAll("button").forEach((b) => b.classList.toggle("on", !!S.action && b.dataset.m === S.action.mode));
}
$("dRefer").onchange = () => { S.action.refer = $("dRefer").checked; paintZone(); };
$("dMode").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; S.action.mode = b.dataset.m; paintZone(); };
$("dAmount").oninput = paintZone;
$("df").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "ok") return;
  e.preventDefault();
  const a = S.action;
  if (a.kind === "add") {
    if (!S.me.merit_points.some((x) => x.cat === $("dReason").value)) { $("derr").textContent = "เลือกประเภทความดี"; $("derr").hidden = false; return; }
    $("dOk").disabled = true;
    try {
      const res = await api("/api/merits", { method: "POST", body: { year: S.year, term: S.term, grade: a.grade, room: a.room, category: $("dReason").value, detail: $("dDetail").value, incident_date: $("dDate").value, student_ids: a.ids } });
      $("dlg").close(); toast(res.approved ? `บันทึกความดีและเพิ่มคะแนน ${res.approved} คน` : `บันทึกความดี ${res.saved} คน · รอฝ่ายปกครองอนุมัติ`);
      S.sel.clear(); await refresh();
    } catch (ex) { $("derr").textContent = ex.message; $("derr").hidden = false; }
    $("dOk").disabled = false;
    return;
  }
  if (!$("dModeBox").hidden && !a.mode) { $("derr").textContent = "เลือก ตักเตือน หรือ ตัดคะแนนเลย"; $("derr").hidden = false; return; }
  $("dOk").disabled = true;
  try {
    const res = await api("/api/records", { method: "POST", body: { year: S.year, term: S.term, grade: a.grade, room: a.room,
      kind: a.kind, amount: Number($("dAmount").value), reason: $("dReason").value, mode: a.mode || undefined, incident_date: $("dDate").value, student_ids: a.ids,
      refer: a.kind === "deduct" && $("dRefer").checked || undefined, note: $("dNote").value || undefined } });
    const msg = [res.referred ? `ส่งต่อฝ่ายปกครอง ${res.referred} คน${res.auto ? " (อัตโนมัติ)" : ""}` : "",res.saved ? `${a.kind === "deduct" ? "ตัดคะแนน" : "บันทึกแล้ว"} ${res.saved} คน` : "", res.warned ? `ตักเตือน ${res.warned} คน` : "",
      res.skipped?.length ? `ข้าม ${res.skipped.length} คนที่บันทึกเรื่องนี้วันนี้แล้ว` : ""].filter(Boolean).join(" · ");
    $("dlg").close(); toast(msg);
    S.sel.clear(); await refresh();
  } catch (ex) { $("derr").textContent = ex.message; $("derr").hidden = false; }
  $("dOk").disabled = false;
});
async function refresh() {
  if (S.tab === "room") await loadRoom();
  if (S.tab === "overview") await loadOverview();
  if (S.tab === "stats") await loadStats();
  if (S.tab === "refer") await loadRefer();
  refreshBadge();
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
  const today = [...new Set(d.records.filter((r) => (r.referral ? r.status === "pending" : !r.cancelled_at && (r.points < 0 || r.warn)) && r.incident_date === S.me.today).map((r) => r.reason))];
  const dis = isOpen() ? "" : "disabled";
  $("hAct").innerHTML = `${today.length ? `<div class="today">⚠ วันนี้ถูกตัด/ตักเตือนแล้ว: ${today.map(esc).join(", ")}</div>` : ""}${dis ? `<div class="today">🔒 ${closedMsg()}</div>` : ""}<button class="btn danger" data-k="deduct" ${dis}>− ตัดคะแนน</button><button class="btn good" data-k="add" ${dis}>+ บันทึกความดี</button>`;
  $("hAct").onclick = (e) => { const b = e.target.closest("[data-k]"); if (!b) return; openAction(b.dataset.k, { ids: [t.id], grade: t.grade, room: t.room, names: [d.student.name], today: [today] }); };
  S.histRecs = d.records;
  $("hBody").innerHTML = d.records.length ? d.records.map((r) => r.merit ? meritRec(r) : r.referral ? refRec(r) : `<div class="rec ${r.cancelled_at ? "cx" : ""}">
      ${r.warn ? `<span class="pt warn">เตือน</span>` : `<span class="pt ${r.points < 0 ? "bad" : "good"}">${r.points > 0 ? "+" : ""}${r.points}</span>`}
      <span class="tx"><span class="rs">${esc(r.reason)}${r.points < 0 ? zoneTag(r.points) : ""}</span><small>${thDate(r.incident_date)} · ${r.referred_by_name ? `ส่งต่อโดย ${esc(r.referred_by_name)} · หักโดย ${esc(r.created_by_name || "")} (ฝ่ายปกครอง)` : esc(r.created_by_name || "")}${r.cancelled_at ? ` · ยกเลิกโดย ${esc(r.cancelled_by_name || "")}: ${esc(r.cancel_reason)}` : ""}</small></span>
      ${r.can_cancel ? `<button class="btn ghost" data-cx="${r.id}" data-warn="${r.warn ? 1 : ""}" data-what="${esc(r.warn ? `ตักเตือน: ${r.reason}` : `${r.points > 0 ? "+" : ""}${r.points} ${r.reason}`)}">ยกเลิก</button>` : ""}
    </div>`).join("") : `<div class="empty">ภาคเรียนนี้ยังไม่มีรายการ (${S.me.base} คะแนน)</div>`;
  if (!$("hist").open) $("hist").showModal();
}
const REF_ST = { pending: "รอพิจารณา", deducted: "หักคะแนนแล้ว", warned: "ตักเตือนแล้ว", rejected: "ไม่ดำเนินการ", cancelled: "ยกเลิกการส่งต่อ" };
function refRec(r) {
  return `<div class="rec ref ${r.status}">
    <span class="pt refer">−${r.points}<small>ส่งต่อ</small></span>
    <span class="tx"><span class="rs">${esc(r.reason)}${zoneTag(r.points)} <span class="tag st-${r.status}">${REF_ST[r.status]}</span></span><small>${thDate(r.incident_date)} · ส่งต่อโดย ${esc(r.created_by_name || "")}${r.auto ? " (อัตโนมัติ)" : ""}${r.note ? ` · ${esc(r.note)}` : ""}${r.decided_by_name ? ` · ${r.status === "rejected" ? "พิจารณาโดย" : "โดย"} ${esc(r.decided_by_name)}${r.decision_note ? `: ${esc(r.decision_note)}` : ""}` : ""}</small></span>
    ${r.can_decide ? `<button class="btn primary" data-rd="${r.id}">พิจารณา</button>` : r.can_cancel ? `<button class="btn ghost" data-cx="${r.id}" data-ref="1" data-what="${esc(`ส่งต่อฝ่ายปกครอง: −${r.points} ${r.reason}`)}">ยกเลิก</button>` : ""}
  </div>`;
}
const MER_ST = { pending: "รอฝ่ายปกครองอนุมัติ", approved: "อนุมัติแล้ว", rejected: "ไม่อนุมัติ (เก็บเป็นบันทึกความดี)" };
function meritRec(r) {
  return `<div class="rec ref merit ${r.status}">
    <span class="pt good">+${r.points}<small>ความดี</small></span>
    <span class="tx"><span class="rs">${esc(r.reason)} <span class="tag mst-${r.status}">${MER_ST[r.status]}</span></span><small>${thDate(r.incident_date)} · บันทึกโดย ${esc(r.created_by_name || "")}${r.detail ? ` · ${esc(r.detail)}` : ""}${r.decided_by_name ? ` · โดย ${esc(r.decided_by_name)}${r.decision_note ? `: ${esc(r.decision_note)}` : ""}` : ""}</small></span>
    ${r.can_decide ? `<button class="btn primary" data-md="${r.id}">พิจารณา</button>` : ""}
  </div>`;
}
$("hBody").onclick = (e) => {
  const md = e.target.closest("[data-md]");
  if (md) { const r = S.histRecs.find((x) => x.merit && x.id === Number(md.dataset.md)); return r && openMerit({ ...r, category: r.reason, date: r.incident_date, name: $("hHead").querySelector("b")?.textContent || "", grade: S.hist.grade, room: S.hist.room }); }
  const rd = e.target.closest("[data-rd]");
  if (rd) { const r = S.histRecs.find((x) => x.referral && x.id === Number(rd.dataset.rd)); return r && openDecide({ ...r, name: $("hHead").querySelector("b")?.textContent || "", grade: S.hist.grade, room: S.hist.room, referred_by_name: r.created_by_name }); }
  const b = e.target.closest("[data-cx]"); if (!b) return;
  S.cancelId = b.dataset.cx; S.cancelWarn = !!b.dataset.warn; S.cancelRef = !!b.dataset.ref; $("cxWhat").textContent = b.dataset.what; $("cxReason").value = ""; $("cxerr").hidden = true;
  $("cxDlg").showModal();
};
$("cxf").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "ok") return;
  e.preventDefault();
  $("cxOk").disabled = true;
  try { await api(S.cancelRef ? `/api/referrals/${S.cancelId}/cancel` : `/api/records/${S.cancelId}/cancel`, { method: "POST", body: { reason: $("cxReason").value, warn: S.cancelWarn } }); $("cxDlg").close(); toast("ยกเลิกแล้ว"); await refresh(); }
  catch (ex) { $("cxerr").textContent = ex.message; $("cxerr").hidden = false; }
  $("cxOk").disabled = false;
});
$("hClose").onclick = () => $("hist").close();

// ---------- สถิติ ----------
S.stRoom = "";
function fillStatRooms() {
  const rooms = S.me.rooms;
  if (S.stRoom && !rooms.some((r) => `${r.grade_level}/${r.classroom}` === S.stRoom)) S.stRoom = "";
  $("tRooms").hidden = rooms.length < 2;
  $("tRooms").innerHTML = [`<button data-k="" class="${S.stRoom ? "" : "on"}">${S.me.user.is_discipline ? "ทั้งโรงเรียน" : "ทุกห้อง"}</button>`,
    ...rooms.map((r) => { const k = `${r.grade_level}/${r.classroom}`; return `<button data-k="${esc(k)}" class="${k === S.stRoom ? "on" : ""}">${esc(k)}</button>`; })].join("");
}
$("tRooms").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; S.stRoom = b.dataset.k; fillStatRooms(); paintPeriod(); loadStats(); };
$("tFrom").onchange = $("tTo").onchange = () => loadStats();
$("tClear").onclick = () => { $("tFrom").value = $("tTo").value = ""; loadStats(); };
function statQS() {
  const p = new URLSearchParams({ year: S.year, term: S.term });
  if ($("tFrom").value) p.set("from", $("tFrom").value);
  if ($("tTo").value) p.set("to", $("tTo").value);
  if (S.stRoom) { const [g, r] = S.stRoom.split("/"); p.set("grade", g); p.set("room", r); }
  return p.toString();
}
$("tCsv").onclick = () => { const a = document.createElement("a"); a.href = `/api/stats?${statQS()}&format=csv`; a.download = ""; document.body.appendChild(a); a.click(); a.remove(); };
const statRows = (list, fmt, color, empty = "ไม่มีข้อมูล") => {
  const max = Math.max(1, ...list.map((x) => x.v));
  return list.length ? list.map((x) => `<div class="item statrow"><span class="who"><b>${x.label}</b>${x.sub ? `<small>${x.sub}</small>` : ""}</span><span class="num ${color}">${fmt(x)}</span><span class="sbar"><i style="width:${(x.v / max) * 100}%;background:var(--${color})"></i></span></div>`).join("")
    : `<div class="item muted">${empty}</div>`;
};
async function loadStats() {
  $("tHero").innerHTML = `<div class="lbl">กำลังโหลด…</div>`;
  let d;
  try { d = await api(`/api/stats?${statQS()}`); } catch (e) { $("tHero").innerHTML = `<div class="lbl">${esc(e.message)}</div>`; return; }
  const m = d.summary, range = d.from || d.to ? `${d.from ? thDate(d.from) : "ต้นภาค"} – ${d.to ? thDate(d.to) : "ปัจจุบัน"}` : "ทั้งภาคเรียน";
  $("tHero").innerHTML = `<div class="lbl">${S.stRoom ? `ชั้น ${esc(S.stRoom)}` : d.scope.school ? "ทั้งโรงเรียน" : "ห้องที่ดูแล"} · ${range} · ${d.scope.students} คน</div>
    <div class="big">−${m.deduct_points}<small> คะแนน · +${m.add_points} คะแนน</small></div>
    <div class="grid"><div><b>${m.deduct_n}</b><span>ครั้งที่ตัด (${m.deduct_students} คน)</span></div><div><b>${m.add_n}</b><span>ครั้งที่เพิ่ม (${m.add_students} คน)</span></div><div><b>${m.warn_n}</b><span>ตักเตือน</span></div></div>`;
  // แนวโน้ม: ≤ 31 วัน รายวัน · มากกว่านั้น รายสัปดาห์ (เริ่มวันจันทร์)
  let t = d.trend.filter((x) => x.date);
  const weekly = t.length > 1 && (new Date(t[t.length - 1].date) - new Date(t[0].date)) / 864e5 > 31;
  if (weekly) {
    const m2 = new Map();
    for (const x of t) { const dt = new Date(x.date + "T00:00:00Z"); dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)); const k = dt.toISOString().slice(0, 10);
      const o = m2.get(k) || { date: k, deduct: 0, add: 0, warn: 0 }; o.deduct += x.deduct; o.add += x.add; o.warn += x.warn; m2.set(k, o); }
    t = [...m2.values()];
  }
  $("tTrendLbl").textContent = t.length ? (weekly ? "(รายสัปดาห์)" : "(รายวัน)") : "";
  const tmax = Math.max(1, ...t.map((x) => x.deduct + x.add + x.warn));
  $("tTrend").innerHTML = t.length ? `<div class="trend">${t.map((x) => `<div class="col" title="${thDate(x.date)}${weekly ? " (สัปดาห์)" : ""} · ตัด ${x.deduct} · เพิ่ม ${x.add} · เตือน ${x.warn}">
      <i class="w" style="height:${(x.warn / tmax) * 100}%"></i><i class="a" style="height:${(x.add / tmax) * 100}%"></i><i class="d" style="height:${(x.deduct / tmax) * 100}%"></i></div>`).join("")}</div>
    <div class="trend-x"><span>${thDate(t[0].date)}</span><span>${thDate(t[t.length - 1].date)}</span></div>
    <div class="legend"><span><i class="d" style="background:var(--bad)"></i>คะแนนที่ตัด</span><span><i style="background:var(--good)"></i>คะแนนที่เพิ่ม</span><span><i style="background:var(--warn)"></i>ครั้งที่ตักเตือน</span></div>`
    : `<div class="muted">ไม่มีข้อมูลในช่วงนี้</div>`;
  const rs = (list) => list.map((x) => ({ label: esc(x.reason), sub: `${x.students} คน`, v: x.n, n: x.n, points: x.points }));
  $("tReasonD").innerHTML = statRows(rs(d.by_reason_deduct).map((x) => ({ ...x, label: x.label + zoneTag(x.points / x.n) })), (x) => `${x.n} ครั้ง · −${x.points}`, "bad");
  $("tReasonW").innerHTML = statRows(rs(d.by_reason_warn), (x) => `${x.n} ครั้ง`, "warn");
  $("tReasonA").innerHTML = statRows(rs(d.by_reason_add), (x) => `${x.n} ครั้ง · +${x.points}`, "good");
  $("tRoomSec").hidden = d.by_room.length < 2;
  $("tByRoom").innerHTML = statRows(d.by_room.map((r) => ({ label: `${esc(r.grade)}/${esc(r.room)}`, sub: `ตัด ${r.deduct_n} ครั้ง · เพิ่ม ${r.add_n} ครั้ง (+${r.add_points}) · เตือน ${r.warn_n}`, v: r.deduct_points, r })), (x) => `−${x.r.deduct_points}`, "bad");
  const stu = (list, key) => list.map((s) => ({ label: `${esc(s.name)}`, sub: `${esc(s.grade)}/${esc(s.room)} · เลขที่ ${s.number ?? "-"} · ตัด ${s.deduct_n} · เพิ่ม ${s.add_n} · เตือน ${s.warn_n}`, v: s[key], s }));
  $("tTopD").innerHTML = statRows(stu(d.top_deduct, "deduct_points"), (x) => `−${x.s.deduct_points}`, "bad");
  $("tTopA").innerHTML = statRows(stu(d.top_add, "add_points"), (x) => `+${x.s.add_points}`, "good");
}

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
  $("meritSec").hidden = !edit;
  if (edit) $("meritList").innerHTML = S.me.merit_points.map((x) => `<div class="item"><span>${esc(x.cat)}</span><span class="hours">+<input type="number" min="1" max="100" inputmode="numeric" data-mc="${esc(x.cat)}" value="${x.points}" aria-label="คะแนน ${esc(x.cat)}"></span></div>`).join("");
  $("referTxt").textContent = `หักตั้งแต่ ${S.me.refer_min} คะแนนขึ้นไป`;
  $("referEdit").hidden = !edit;
  if (edit) $("rMin").value = S.me.refer_min;
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
$("referSave").onclick = async () => {
  try { const d = await api("/api/settings", { method: "PUT", body: { refer_min: Number($("rMin").value) } }); S.me.refer_min = d.refer_min; paintHours(); toast("บันทึกแล้ว"); }
  catch (e) { toast(e.message); }
};
$("meritSave").onclick = async () => {
  const m = Object.fromEntries([...document.querySelectorAll("[data-mc]")].map((i) => [i.dataset.mc, Number(i.value)]));
  try { const d = await api("/api/settings", { method: "PUT", body: { merit_points: m } }); S.me.merit_points = d.merit_points; paintHours(); toast("บันทึกแล้ว"); }
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

// ---------- ส่งต่อฝ่ายปกครอง ----------
S.refSt = "pending"; S.refKind = "deduct";
function paintBadge() {
  const n = S.me.user.is_discipline ? (S.me.pending_referrals || 0) + (S.me.pending_merits || 0) : 0;
  $("refBadge").hidden = !n; $("refBadge").textContent = n > 99 ? "99+" : n;
}
async function refreshBadge() {
  if (!S.me.user.is_discipline) return;
  try {
    const [a, b] = await Promise.all([api(`/api/referrals?year=${S.year}&term=${S.term}&status=pending`), api(`/api/merits?year=${S.year}&term=${S.term}&status=pending`)]);
    S.me.pending_referrals = a.referrals.length; S.me.pending_merits = b.merits.length; paintBadge();
  } catch { /* */ }
}
document.querySelectorAll("#refSeg button").forEach((b) => (b.onclick = () => { S.refSt = b.dataset.s; loadRefer(); }));
document.querySelectorAll("#refKind button").forEach((b) => (b.onclick = () => { S.refKind = b.dataset.k; loadRefer(); }));
async function loadRefer() {
  document.querySelectorAll("#refSeg button").forEach((b) => b.classList.toggle("on", b.dataset.s === S.refSt));
  document.querySelectorAll("#refKind button").forEach((b) => b.classList.toggle("on", b.dataset.k === S.refKind));
  $("refKind").querySelector("[data-k=deduct] em").textContent = S.me.user.is_discipline && S.me.pending_referrals ? S.me.pending_referrals : "";
  $("refKind").querySelector("[data-k=merit] em").textContent = S.me.user.is_discipline && S.me.pending_merits ? S.me.pending_merits : "";
  if (S.refKind === "merit") return loadMerits();
  $("refInfo").textContent = S.me.user.is_discipline
    ? `หัก ${S.me.refer_min} คะแนนขึ้นไปส่งต่ออัตโนมัติ · ครูส่งต่อเองได้ · ท่านพิจารณาแล้วกดหัก/ตักเตือน ระบบบันทึกชื่อผู้ส่งและผู้หัก (กติกาเดิม: วันละครั้ง · โซนเล็กน้อยต้องตักเตือนครบ ${S.me.warn_n} ครั้งก่อน)`
    : `พฤติกรรมที่หัก ${S.me.refer_min} คะแนนขึ้นไปส่งต่อฝ่ายปกครองอัตโนมัติ ยังไม่หักคะแนนจนกว่าฝ่ายปกครองพิจารณา`;
  $("refList").innerHTML = `<div class="empty">กำลังโหลด…</div>`;
  let d;
  try { d = await api(`/api/referrals?year=${S.year}&term=${S.term}&status=${S.refSt}`); } catch (e) { $("refList").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  S.refs = d.referrals;
  if (S.refSt === "pending" && S.me.user.is_discipline) { S.me.pending_referrals = d.referrals.length; paintBadge(); }
  $("refList").innerHTML = d.referrals.length ? d.referrals.map((r) => `<div class="refcard ${r.status}" data-id="${r.id}">
      <div class="rc-top"><span class="tag room">${esc(r.grade)}/${esc(r.room)}</span><b>${esc(r.name)}</b><span class="pts">−${r.points}</span></div>
      <div class="rc-why">${esc(r.reason)} ${zoneTag(r.points)}</div>
      <div class="rc-meta">${thDate(r.incident_date)} · ส่งต่อโดย <b>${esc(r.referred_by_name || "")}</b>${r.auto ? ' <span class="tag auto">อัตโนมัติ</span>' : ""}${r.note ? `<br>“${esc(r.note)}”` : ""}</div>
      ${r.status !== "pending" ? `<div class="rc-res"><span class="tag st-${r.status}">${REF_ST[r.status]}</span> ${r.decided_by_name ? `โดย ${esc(r.decided_by_name)}` : ""}${r.decision_note ? ` · ${esc(r.decision_note)}` : ""}</div>` : ""}
      ${r.can_decide || r.can_cancel ? `<div class="rc-act">${r.can_cancel ? `<button class="btn ghost" data-a="cancel">ยกเลิกการส่งต่อ</button>` : ""}${r.can_decide ? `<button class="btn primary" data-a="decide">พิจารณา</button>` : ""}</div>` : ""}
    </div>`).join("") : `<div class="empty">${S.refSt === "pending" ? "✓ ไม่มีรายการรอพิจารณา" : "ยังไม่มีรายการ"}</div>`;
}
$("refList").onclick = (e) => {
  const c = e.target.closest(".refcard"); if (!c) return;
  if (c.dataset.m) {
    const m = S.merits.find((x) => x.id === Number(c.dataset.m)); if (!m) return;
    if (e.target.closest("[data-a=decide]")) return openMerit(m);
    return openHist({ id: m.student_id, grade: m.grade, room: m.room });
  }
  const r = S.refs.find((x) => x.id === Number(c.dataset.id)); if (!r) return;
  const a = e.target.closest("[data-a]")?.dataset.a;
  if (a === "decide") return openDecide(r);
  if (a === "cancel") { S.cancelId = r.id; S.cancelWarn = false; S.cancelRef = true; $("cxWhat").textContent = `ส่งต่อฝ่ายปกครอง: ${r.name} −${r.points} ${r.reason}`; $("cxReason").value = ""; $("cxerr").hidden = true; return $("cxDlg").showModal(); }
  openHist({ id: r.student_id, grade: r.grade, room: r.room });
};
function openDecide(r) {
  if (!isOpen()) return toast(closedMsg());
  S.decide = { r, action: null };
  const minor = r.points < S.me.zones.mid, wn = S.me.warn_n;
  $("rdWho").innerHTML = `<b>${esc(r.name)}</b> · ${esc(r.grade)}/${esc(r.room)}<br><span class="muted">${esc(r.reason)} ${zoneTag(r.points)} · −${r.points} · ${thDate(r.incident_date)}<br>ส่งต่อโดย ${esc(r.referred_by_name || "")}${r.note ? ` · “${esc(r.note)}”` : ""}</span>`;
  $("rdRule").hidden = !(minor && wn);
  $("rdRule").textContent = `โซนเล็กน้อย: เรื่องนี้ต้องตักเตือนครบ ${wn} ครั้งก่อน${r.warn_count != null ? ` (ตักเตือนในภาคแล้ว ${r.warn_count} ครั้ง)` : ""} — ยังไม่ครบ ระบบบันทึกเป็นตักเตือน`;
  $("rdNote").value = ""; $("rderr").hidden = true; paintDecide();
  $("rdDlg").showModal();
}
function paintDecide() {
  const a = S.decide.action;
  $("rdSeg").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.a === a));
  $("rdNoteLbl").firstChild.textContent = a === "reject" ? "เหตุผลที่ไม่ดำเนินการ (จำเป็น)" : "หมายเหตุ (ถ้ามี)";
  $("rdOk").textContent = a === "deduct" ? `หัก ${S.decide.r.points} คะแนน` : a === "warn" ? "ตักเตือน" : a === "reject" ? "ไม่ดำเนินการ" : "ยืนยัน";
  $("rdOk").className = `btn lg ${a === "deduct" ? "danger" : a === "warn" ? "warnb" : a === "reject" ? "ghost" : "primary"}`;
  $("rdOk").disabled = !a;
}
$("rdSeg").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; S.decide.action = b.dataset.a; paintDecide(); };
$("rdf").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "ok") return;
  e.preventDefault();
  const { r, action } = S.decide;
  if (!action) return;
  $("rdOk").disabled = true;
  try {
    const res = await api(`/api/referrals/${r.id}/decide`, { method: "POST", body: { action, note: $("rdNote").value } });
    $("rdDlg").close();
    toast(res.result === "deducted" ? `หัก ${r.points} คะแนนแล้ว` : res.result === "warned" ? (res.forced ? "ยังตักเตือนไม่ครบ — บันทึกเป็นตักเตือน" : "บันทึกตักเตือนแล้ว") : "บันทึกไม่ดำเนินการแล้ว");
    await refresh();
  } catch (ex) { $("rderr").textContent = ex.message; $("rderr").hidden = false; }
  $("rdOk").disabled = false;
});

// ---------- ความดีรออนุมัติ ----------
async function loadMerits() {
  $("refInfo").textContent = S.me.user.is_discipline
    ? "บันทึกความดีจากครูประจำชั้น (ทั้งที่นี่และระบบบริหารโรงเรียน) · อนุมัติ = เพิ่มคะแนนตามประเภทความดี · ไม่อนุมัติ = ยังเก็บเป็นบันทึกความดี ระบบบันทึกชื่อผู้บันทึกและผู้อนุมัติ"
    : "ครูประจำชั้นบันทึกความดีได้ แต่เพิ่มคะแนนได้เฉพาะครูฝ่ายปกครองเมื่ออนุมัติ";
  $("refList").innerHTML = `<div class="empty">กำลังโหลด…</div>`;
  let d;
  try { d = await api(`/api/merits?year=${S.year}&term=${S.term}&status=${S.refSt}`); } catch (e) { $("refList").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  S.merits = d.merits;
  if (S.refSt === "pending" && S.me.user.is_discipline) { S.me.pending_merits = d.merits.length; paintBadge(); $("refKind").querySelector("[data-k=merit] em").textContent = d.merits.length || ""; }
  $("refList").innerHTML = d.merits.length ? d.merits.map((m) => `<div class="refcard merit ${m.status}" data-m="${m.id}">
      <div class="rc-top"><span class="tag room">${esc(m.grade)}/${esc(m.room)}</span><b>${esc(m.name)}</b><span class="pts good">+${m.points}</span></div>
      <div class="rc-why">${esc(m.category)}${m.detail ? ` <span class="muted">— ${esc(m.detail)}</span>` : ""}</div>
      <div class="rc-meta">${thDate(m.date)} · บันทึกโดย <b>${esc(m.created_by_name || "")}</b></div>
      ${m.status !== "pending" ? `<div class="rc-res"><span class="tag mst-${m.status}">${MER_ST[m.status]}</span> ${m.decided_by_name ? `โดย ${esc(m.decided_by_name)}` : ""}${m.note ? ` · ${esc(m.note)}` : ""}</div>` : ""}
      ${m.can_decide ? `<div class="rc-act"><button class="btn primary" data-a="decide">พิจารณา</button></div>` : ""}
    </div>`).join("") : `<div class="empty">${S.refSt === "pending" ? "✓ ไม่มีความดีรออนุมัติ" : "ยังไม่มีรายการ"}</div>`;
}
function openMerit(m) {
  if (!isOpen()) return toast(closedMsg());
  S.merit = { m, action: null };
  $("mdWho").innerHTML = `<b>${esc(m.name)}</b> · ${esc(m.grade)}/${esc(m.room)}<br><span class="muted">${esc(m.category)}${m.detail ? ` — ${esc(m.detail)}` : ""} · ${thDate(m.date)}<br>บันทึกโดย ${esc(m.created_by_name || "")}</span>`;
  $("mdNote").value = ""; $("mderr").hidden = true; paintMerit();
  $("mdDlg").showModal();
}
function paintMerit() {
  const a = S.merit.action;
  $("mdSeg").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.a === a));
  $("mdSeg").querySelector("[data-a=approve]").textContent = `อนุมัติ +${S.merit.m.points}`;
  $("mdNoteLbl").firstChild.textContent = a === "reject" ? "เหตุผลที่ไม่อนุมัติ (จำเป็น)" : "หมายเหตุ (ถ้ามี)";
  $("mdOk").textContent = a === "approve" ? `เพิ่ม ${S.merit.m.points} คะแนน` : a === "reject" ? "ไม่อนุมัติ" : "ยืนยัน";
  $("mdOk").className = `btn lg ${a === "approve" ? "good" : a === "reject" ? "ghost" : "primary"}`;
  $("mdOk").disabled = !a;
}
$("mdSeg").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; S.merit.action = b.dataset.a; paintMerit(); };
$("mdf").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "ok") return;
  e.preventDefault();
  const { m, action } = S.merit; if (!action) return;
  $("mdOk").disabled = true;
  try {
    const res = await api(`/api/merits/${m.id}/decide`, { method: "POST", body: { action, note: $("mdNote").value } });
    $("mdDlg").close(); toast(res.result === "approved" ? `เพิ่ม ${res.points} คะแนนแล้ว` : "บันทึกไม่อนุมัติแล้ว (ยังเป็นบันทึกความดี)");
    await refresh();
  } catch (ex) { $("mderr").textContent = ex.message; $("mderr").hidden = false; }
  $("mdOk").disabled = false;
});

boot();
