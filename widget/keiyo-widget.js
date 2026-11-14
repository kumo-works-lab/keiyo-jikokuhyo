// 京葉線 発車時刻ウィジェット（Scriptable用）
// ウィジェットの「Parameter」に次のどれかを入れると区間を選べます（空なら tokyo）
//   tokyo    … 稲毛海岸 → 東京
//   makuhari … 稲毛海岸 → 海浜幕張
//   back     … 海浜幕張 → 稲毛海岸
//   ltd-up   … 特急 海浜幕張 → 東京
//   ltd-down … 特急 東京 → 海浜幕張
//   auto     … 平日の朝〜昼は tokyo、15時以降は back
const URL_BASE = "https://kumo-works-lab.github.io/keiyo-jikokuhyo/";

const NAMES = { 習: "新習志野", 西: "西船橋", 府: "府中本町", 所: "東所沢", 安: "安房鴨川", 勝: "勝浦", 館: "館山", 一: "上総一ノ宮", 君: "君津", 成: "成東", 誉: "誉田", "一・成": "上総一ノ宮・成東", 幕: "海浜幕張" };
const HOL = ["2026-11-23", "2027-01-01", "2027-01-11", "2027-02-11", "2027-02-23", "2027-03-21", "2027-03-22", "2027-04-29", "2027-05-03", "2027-05-04", "2027-05-05", "2027-07-19", "2027-08-11", "2027-09-20", "2027-09-23", "2027-10-11", "2027-11-03", "2027-11-23"];
const NOT_TOKYO = ["習", "西", "府", "所"];
const ROUTES = {
  tokyo: { label: "稲毛海岸 → 東京", src: "U", def: "東京", excl: NOT_TOKYO, arr: 1 },
  makuhari: { label: "稲毛海岸 → 海浜幕張", src: "U", def: "東京", excl: [], arr: 0 },
  back: { label: "海浜幕張 → 稲毛海岸", src: "K", def: "蘇我", excl: [], arr: 0, noPass: true },
  "ltd-up": { label: "特急 海浜幕張 → 東京", src: "M", def: "東京", excl: NOT_TOKYO, arr: 0, ltd: true },
  "ltd-down": { label: "特急 東京 → 海浜幕張", src: "T", def: "蘇我", excl: [], arr: 0, ltd: true },
};

const pad = n => String(n).padStart(2, "0");
const fmt = m => Math.floor(m / 60) % 24 + ":" + pad(m % 60);
function jstParts(date) {
  const t = new Date(date.getTime() + 9 * 3600e3);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds() };
}
function addDay(y, m, d, n) { const t = new Date(Date.UTC(y, m - 1, d + n)); return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() }; }
function dayType(y, m, d) {
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 || w === 6 || HOL.includes(`${y}-${pad(m)}-${pad(d)}`) ? "hd" : "wd";
}
// 運行日(JST)の0時からm分後の Date
const toDate = (sd, m) => new Date(Date.UTC(sd.y, sd.mo - 1, sd.d) - 9 * 3600e3 + m * 60e3);

function trains(data, rt, type) {
  return (data.tables[rt.src + "_" + type] || [])
    .map(r => ({ m: r[0], kind: +r[1] || 0, d: r[2], name: r[3], x: r[4], arr: r[6] ? r[6][rt.arr] : null }))
    .filter(t => {
      if (t.d && rt.excl.includes(t.d)) return false;
      if (rt.ltd) return t.kind === 2;
      if (rt.noPass && t.x === "通過") return false;
      return t.kind !== 2;
    });
}

// 次の列車を最大n本（日付またぎも含む）
function upcoming(data, rt, now, n) {
  const p = jstParts(now);
  let sd = { y: p.y, mo: p.mo, d: p.d }, nowM = p.h * 60 + p.mi;
  if (p.h < 4) { sd = addDay(p.y, p.mo, p.d, -1); nowM += 1440; }
  const out = [];
  for (let i = 0; i < 2 && out.length < n; i++) {
    const day = i ? addDay(sd.y, sd.mo, sd.d, 1) : sd;
    for (const t of trains(data, rt, dayType(day.y, day.mo, day.d))) {
      if (i === 0 && t.m < nowM) continue;
      out.push({ ...t, date: toDate(day, t.m), arrDate: t.arr != null ? toDate(day, t.arr) : null, tomorrow: i === 1 });
      if (out.length >= n) break;
    }
  }
  return out;
}

function pickRoute(param, now) {
  const key = (param || "tokyo").trim();
  if (key === "auto") {
    const p = jstParts(now);
    return ROUTES[dayType(p.y, p.mo, p.d) === "wd" && p.h >= 4 && p.h < 15 ? "tokyo" : "back"];
  }
  return ROUTES[key] || ROUTES.tokyo;
}

// ---------- ここから Scriptable の画面 ----------
async function loadData() {
  const fm = FileManager.local();
  const path = fm.joinPath(fm.documentsDirectory(), "keiyo-data.json");
  try {
    const d = await new Request(URL_BASE + "data.json?" + Date.now()).loadJSON();
    if (d && d.tables) { fm.writeString(path, JSON.stringify(d)); return d; }
  } catch (e) {}
  return fm.fileExists(path) ? JSON.parse(fm.readString(path)) : null;
}

const C = {
  bg1: Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e")),
  bg2: Color.dynamic(new Color("#f2f2f7"), new Color("#000000")),
  text: Color.dynamic(new Color("#000000"), new Color("#ffffff")),
  sub: Color.dynamic(new Color("#3c3c43", 0.6), new Color("#ebebf5", 0.6)),
  line: Color.dynamic(new Color("#c9242f"), new Color("#ff4d5a")),
  rapid: Color.dynamic(new Color("#ff7a00"), new Color("#ff9f0a")),
  ltd: Color.dynamic(new Color("#8e44d8"), new Color("#bf7cff")),
};
const kindLabel = t => (t.kind === 2 ? "特急" : t.kind === 1 ? "快速" : "各停");
const kindColor = t => (t.kind === 2 ? C.ltd : t.kind === 1 ? C.rapid : C.sub);

function txt(st, s, font, color, opts = {}) {
  const t = st.addText(s);
  t.font = font; t.textColor = color; t.lineLimit = 1;
  if (opts.scale) t.minimumScaleFactor = opts.scale;
  return t;
}

function build(family, rt, list, data) {
  const w = new ListWidget();
  w.url = URL_BASE;
  const first = list[0];

  // ロック画面（1行）
  if (family === "accessoryInline") {
    w.addText(first ? `${fmt(first.m)} ${kindLabel(first)}${first.arr != null ? " → " + fmt(first.arr) + "着" : ""}` : "本日の運転は終了");
    return w;
  }
  // ロック画面（長方形）
  if (family === "accessoryRectangular") {
    txt(w, rt.label, Font.semiboldSystemFont(11), Color.white(), { scale: 0.7 });
    if (!first) { txt(w, "本日の運転は終了", Font.boldSystemFont(15), Color.white()); return w; }
    const r = w.addStack(); r.centerAlignContent();
    txt(r, fmt(first.m), Font.boldRoundedSystemFont(22), Color.white());
    r.addSpacer(6);
    const d = r.addDate(first.date); d.applyRelativeStyle(); d.font = Font.semiboldSystemFont(13); d.lineLimit = 1;
    const second = list[1];
    txt(w, `${kindLabel(first)}${first.arr != null ? " " + fmt(first.arr) + "着" : ""}${second ? "　次 " + fmt(second.m) : ""}`, Font.systemFont(12), Color.white(), { scale: 0.7 });
    return w;
  }

  const g = new LinearGradient();
  g.colors = [C.bg1, C.bg2]; g.locations = [0, 1];
  w.backgroundGradient = g;
  w.setPadding(14, 16, 14, 16);

  const head = w.addStack(); head.centerAlignContent();
  const bar = head.addStack(); bar.size = new Size(4, 14); bar.cornerRadius = 2; bar.backgroundColor = C.line;
  head.addSpacer(6);
  txt(head, rt.label, Font.semiboldSystemFont(12), C.sub, { scale: 0.7 });
  w.addSpacer(6);

  if (!data) { txt(w, "データを読み込めません", Font.semiboldSystemFont(14), C.sub); return w; }
  if (!first) { txt(w, rt.ltd ? "本日の特急は終了" : "本日の運転は終了", Font.boldSystemFont(16), C.text); return w; }

  const main = w.addStack(); main.bottomAlignContent();
  txt(main, fmt(first.m), Font.boldRoundedSystemFont(family === "systemSmall" ? 34 : 40), C.text, { scale: 0.6 });
  main.addSpacer(8);
  const cd = main.addStack(); cd.layoutVertically();
  const tag = cd.addStack(); tag.setPadding(1, 6, 1, 6); tag.cornerRadius = 6; tag.backgroundColor = kindColor(first);
  txt(tag, kindLabel(first), Font.boldSystemFont(10), Color.white());
  cd.addSpacer(2);
  const d = cd.addDate(first.date); d.applyTimerStyle(); d.font = Font.boldMonospacedSystemFont(14); d.textColor = C.line; d.lineLimit = 1;
  if (first.tomorrow) txt(cd, "明日", Font.systemFont(10), C.sub);

  if (first.arr != null) {
    w.addSpacer(2);
    txt(w, `→ ${fmt(first.arr)} 着（${first.arr - first.m}分）`, Font.semiboldSystemFont(13), C.text, { scale: 0.7 });
  }
  w.addSpacer();

  const more = list.slice(1, family === "systemSmall" ? 2 : family === "systemLarge" ? 8 : 3);
  for (const t of more) {
    const r = w.addStack(); r.centerAlignContent();
    txt(r, fmt(t.m), Font.semiboldMonospacedSystemFont(14), C.text);
    r.addSpacer(6);
    txt(r, kindLabel(t), Font.boldSystemFont(11), kindColor(t));
    if (t.arr != null) { r.addSpacer(6); txt(r, `→ ${fmt(t.arr)}着`, Font.systemFont(12), C.sub, { scale: 0.7 }); }
    if (family !== "systemSmall" && t.d) { r.addSpacer(6); txt(r, (NAMES[t.d] || t.d) + "行", Font.systemFont(11), C.sub, { scale: 0.7 }); }
    r.addSpacer();
  }
  return w;
}

async function run() {
  const now = new Date();
  const rt = pickRoute(args.widgetParameter, now);
  const data = await loadData();
  const list = data ? upcoming(data, rt, now, 8) : [];
  const family = config.widgetFamily || "systemMedium";
  const w = build(family, rt, list, data);
  // 次の列車が出たら更新（iOSの都合で数分遅れることがあります）
  const next = list[0] ? new Date(list[0].date.getTime() + 30e3) : new Date(now.getTime() + 30 * 60e3);
  w.refreshAfterDate = new Date(Math.min(next.getTime(), now.getTime() + 30 * 60e3));
  if (config.runsInWidget) Script.setWidget(w);
  else await w.presentMedium();
  Script.complete();
}

await run();
