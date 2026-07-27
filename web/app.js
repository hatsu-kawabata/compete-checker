import { meshCentroid, primaryMeshesInBBox, circleBBox, aggregateCircle, meshCode1km } from "./mesh.js";
import { INDUSTRIES, VECTOR_WIDTH, summary, density, LEVEL_LABEL } from "./compete.js";

// S4計器: 競合レポートの事前登録フォーム。
// 業種とエリアはツール側で観測できるので、ユーザーに入力させずプレフィルで運ぶ。
// フォームで聞くのは「測れないもの」＝メールアドレスだけ（そこだけが必須）。
// プレフィル値は送信前に本人に見えるので、間違っていれば直せる。
const FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLScZXcYLxgHrnCEQT41zON-gOr7l5y5qYehxeGHTQSZAwJNFqQ/viewform";
const FORM_ENTRY = { industry: "entry.665653780", area: "entry.846617532" };

const map = L.map("map", { zoomControl: true }).setView([35.6895, 139.6917], 14);
L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>',
}).addTo(map);

const els = Object.fromEntries([
  "radius", "radiusOut", "status", "results", "perStoreDay", "est", "perStoreNight",
  "avgSize", "verdict", "breakdown", "densityLine", "industry", "indLabelA",
  "warnNote", "shareMeta", "ctaBox", "ctaLink", "addr", "addrList",
].map((id) => [id, document.getElementById(id)]));

for (const ind of INDUSTRIES) {
  if (ind.id === "all") continue; // 全産業は分母側で使うだけなので選択肢に出さない
  const o = document.createElement("option");
  o.value = ind.id;
  o.textContent = ind.label;
  els.industry.append(o);
}
els.industry.value = "food";

if (FORM_URL) els.ctaBox.hidden = false;

// 住所検索に入力があればそれを、無ければ座標を使う。半径も添える。
function ctaHref(label, r) {
  if (!FORM_URL || !center) return FORM_URL;
  const typed = els.addr.value.trim();
  const where = typed || `北緯${center.lat.toFixed(5)} 東経${center.lng.toFixed(5)}`;
  const q = new URLSearchParams({
    [FORM_ENTRY.industry]: label,
    [FORM_ENTRY.area]: `${where} から半径${(r / 1000).toFixed(1)}km`,
  });
  return `${FORM_URL}?${q}`;
}

const fmt = (n) => Math.round(n).toLocaleString("ja-JP");

// ---- データ読み込み ----
let manifest = null;
let baseline = null; // { scope, night: {id: 1店あたり人口}, day: {...} }
const meshCache = new Map();

async function loadMesh(code1) {
  if (meshCache.has(code1)) return meshCache.get(code1);
  const p = (async () => {
    if (manifest && !manifest.meshes.includes(code1)) return "missing";
    try {
      const rows = await (await fetch(`data/${code1}.json`)).json();
      return rows.map((row) => {
        const [la, lo] = meshCentroid(row[0]);
        return { la, lo, v: row.slice(1) };
      });
    } catch {
      return "missing";
    }
  })();
  meshCache.set(code1, p);
  const v = await p;
  meshCache.set(code1, v);
  return v;
}

async function aggregateAt(c, r) {
  const [latMin, latMax, lonMin, lonMax] = circleBBox(c.lat, c.lng, r);
  const codes = primaryMeshesInBBox(latMin, latMax, lonMin, lonMax);
  const loaded = await Promise.all(codes.map(loadMesh));
  const cells = loaded.filter((m) => m !== "missing").flat();
  const missing = codes.filter((_, i) => loaded[i] === "missing");
  return { agg: aggregateCircle(cells, c.lat, c.lng, r, VECTOR_WIDTH), missing };
}

// ---- 状態 ----
let center = null;
let circle = null;

const radius = () => +els.radius.value;
const industryId = () => els.industry.value;

function setCenter(latlng, opts = {}) {
  center = latlng;
  if (!circle) {
    circle = L.circle(latlng, { radius: radius(), color: "#2a78d6", weight: 2, fillOpacity: 0.08 }).addTo(map);
  } else {
    circle.setLatLng(latlng).setRadius(radius());
  }
  if (opts.pan) map.setView(latlng, opts.zoom ?? map.getZoom());
  recompute();
}

map.on("click", (e) => setCenter(e.latlng));

els.radius.addEventListener("input", () => {
  els.radiusOut.textContent = `${(radius() / 1000).toFixed(1)} km`;
  if (circle) circle.setRadius(radius());
  recompute();
});
els.industry.addEventListener("input", () => recompute());

let seq = 0;
async function recompute() {
  if (!center) return;
  const my = ++seq;
  els.status.textContent = "集計中…";
  const r = radius();
  const id = industryId();
  const { agg, missing } = await aggregateAt(center, r);
  if (my !== seq) return;

  const s = summary(agg.sum, id, {
    night: baseline?.night?.[id],
    day: baseline?.day?.[id],
  });
  const label = INDUSTRIES.find((i) => i.id === id).label;

  els.status.hidden = true;
  els.results.hidden = false;
  els.indLabelA.textContent = label;
  els.est.textContent = `${fmt(s.est)} 事業所`;
  els.perStoreDay.textContent = s.day.perStore != null ? `${fmt(s.day.perStore)} 人` : "—";
  els.perStoreNight.textContent = s.night.perStore != null ? `${fmt(s.night.perStore)} 人` : "—";
  els.avgSize.textContent = s.avgSize != null ? `${s.avgSize.toFixed(1)} 人` : "—";

  if (s.est === 0) {
    els.verdict.textContent = `半径${(r / 1000).toFixed(1)}km圏に${label}の事業所はありません。`;
  } else if (s.day.index != null) {
    const pct = (s.day.index * 100).toFixed(0);
    els.verdict.textContent =
      `${baseline.scope}平均は1店あたり ${fmt(baseline.day[id])} 人。この場所はその ${pct}% ＝ ${LEVEL_LABEL[s.day.level]}。`;
  } else {
    els.verdict.textContent = "全国平均との比較は集計中です（全国データの取り込み後に表示します）。";
  }

  els.breakdown.textContent =
    `圏内: 常住人口 ${fmt(s.pop)} 人 ／ 働く人 ${fmt(s.daytimePop - s.pop)} 人（全産業の従業者）` +
    ` ／ 昼間ベースの分母 ${fmt(s.daytimePop)} 人 ／ ${label}の従業者 ${fmt(s.emp)} 人`;

  const d = density(s.est, r);
  els.densityLine.textContent = d != null ? `密度 ${d.toFixed(1)} 事業所/km²（集計セル ${agg.cellCount} 個）` : "";

  els.warnNote.hidden = missing.length === 0;
  if (missing.length) els.warnNote.textContent = "圏内にデータ範囲外の区画があります（海上・国外など）。";

  els.ctaLink.href = ctaHref(label, r);

  track({
    industry: id,
    radius: r,
    mesh1km: meshCode1km(center.lat, center.lng),
    est: s.est,
  });
  syncUrl();
}

// ---- 計測: 何がどこで調べられたか ----
//
// 業種はユーザーが自分の答えを得るために選ぶ入力なので、聞かずに観測できる。
// 座標は1kmメッシュに丸めて送る（需要の地図は1km粒度で足り、生の座標を残す必要がない）。
// 端末には何も書かない＝cookieless。個人を特定する情報は一切送らない。
// スライダ操作の途中経過を送らないよう、操作が落ち着いてから1回だけ送る。
let trackTimer = null;
function track(payload) {
  clearTimeout(trackTimer);
  trackTimer = setTimeout(() => {
    window.va?.track?.("circle", payload);
  }, 1500);
}

function syncUrl() {
  if (!center) return;
  const q = new URLSearchParams({
    lat: center.lat.toFixed(5),
    lng: center.lng.toFixed(5),
    r: String(radius()),
    ind: industryId(),
  });
  history.replaceState(null, "", `${location.pathname}?${q}`);
  els.shareMeta.textContent = "この結果はURLで共有できます。";
}

function applyUrlState() {
  const q = new URLSearchParams(location.search);
  const lat = parseFloat(q.get("lat"));
  const lng = parseFloat(q.get("lng"));
  const r = parseInt(q.get("r") ?? "", 10);
  const ind = q.get("ind");
  if (ind && INDUSTRIES.some((i) => i.id === ind && i.id !== "all")) els.industry.value = ind;
  if (Number.isFinite(r)) {
    els.radius.value = String(r);
    els.radiusOut.textContent = `${(r / 1000).toFixed(1)} km`;
  }
  if (Number.isFinite(lat) && Number.isFinite(lng)) setCenter(L.latLng(lat, lng), { pan: true, zoom: 15 });
}

Promise.all([
  fetch("data/manifest.json").then((r) => r.json()),
  fetch("data/baseline.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
])
  .then(([m, b]) => { manifest = m; baseline = b; applyUrlState(); })
  .catch(() => { els.status.textContent = "manifest.json を読めません。scripts/build_data.py を実行してください"; });

// ---- 住所検索(地理院) ----
let addrSeq = 0;
els.addr.addEventListener("input", () => {
  const q = els.addr.value.trim();
  if (q.length < 2) { els.addrList.hidden = true; return; }
  searchAddress(q);
});
document.addEventListener("click", (e) => {
  if (!els.addrList.contains(e.target) && e.target !== els.addr) els.addrList.hidden = true;
});

async function searchAddress(q) {
  const my = ++addrSeq;
  const feats = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`)
    .then((r) => r.json())
    .catch(() => []);
  if (my !== addrSeq) return;
  els.addrList.replaceChildren();
  for (const f of feats.slice(0, 8)) {
    const [lon, lat] = f.geometry.coordinates;
    const li = document.createElement("li");
    li.textContent = f.properties.title;
    li.addEventListener("click", () => {
      els.addrList.hidden = true;
      els.addr.value = f.properties.title;
      setCenter(L.latLng(lat, lon), { pan: true, zoom: 15 });
    });
    els.addrList.append(li);
  }
  els.addrList.hidden = els.addrList.childElementCount === 0;
}
