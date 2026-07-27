// 需給指標の純関数。データ列の意味づけと、1店あたり人口・需給インデックスの計算だけを持つ。
// 業種の順序は scripts/build_data.py の INDUSTRIES が正本（test.mjs が一致を固定する）。

export const INDUSTRIES = [
  { id: "all",        label: "全産業" },
  { id: "food",       label: "飲食店" },
  { id: "takeout",    label: "持ち帰り・配達飲食" },
  { id: "hotel",      label: "宿泊業" },
  { id: "grocery",    label: "飲食料品小売" },
  { id: "apparel",    label: "衣服・身の回り品小売" },
  { id: "machinery",  label: "機械器具小売" },
  { id: "retail",     label: "その他の小売" },
  { id: "beauty",     label: "洗濯・理容・美容・浴場" },
  { id: "amusement",  label: "娯楽業" },
  { id: "school",     label: "学習塾・その他の教育" },
  { id: "medical",    label: "医療業" },
  { id: "welfare",    label: "社会福祉・介護" },
  { id: "realestate", label: "不動産賃貸業・管理業" },
];

// 1メッシュの値ベクトル v = [pop, hh, est0, emp0, est1, emp1, ...]
export const POP = 0;
export const HH = 1;
export const estIndex = (k) => 2 + k * 2;
export const empIndex = (k) => 3 + k * 2;
export const VECTOR_WIDTH = 2 + INDUSTRIES.length * 2;

export function industryIndex(id) {
  const k = INDUSTRIES.findIndex((i) => i.id === id);
  if (k < 0) throw new Error(`unknown industry: ${id}`);
  return k;
}

// 集計済みベクトルから、ある業種の生の値を取り出す
export function readCircle(sum, id) {
  const k = industryIndex(id);
  return {
    pop: Math.round(sum[POP]),
    hh: Math.round(sum[HH]),
    est: Math.round(sum[estIndex(k)]),
    emp: Math.round(sum[empIndex(k)]),
  };
}

// 需給インデックスの判定境界。全国平均の何倍か。
// 1未満=1店あたり人口が全国より少ない=店が多い=過密。
export const CROWDED = 0.8;
export const SPARSE = 1.25;

export function level(index) {
  if (index == null) return null;
  if (index < CROWDED) return "crowded";
  if (index > SPARSE) return "sparse";
  return "average";
}

export const LEVEL_LABEL = {
  crowded: "競合は多め",
  average: "全国並み",
  sparse: "競合は手薄",
};

/**
 * pop            円内人口
 * est            円内の当該業種の事業所数
 * emp            円内の当該業種の従業者数
 * baselinePerStore 全国(または都道府県)の1店あたり人口。無ければ index は null
 *
 * est が 0 のときは 1店あたり人口も需給インデックスも定義できないので null を返す
 * （「店が無い＝無限に手薄」ではない。人口0の山中と、人口1万の空白地帯を混同しないため）
 */
export function metrics({ pop, est, emp, baselinePerStore }) {
  const perStore = est > 0 ? pop / est : null;
  const index = perStore != null && baselinePerStore > 0 ? perStore / baselinePerStore : null;
  const avgSize = est > 0 ? emp / est : null;
  return { perStore, index, avgSize, level: level(index) };
}

// 円の面積(km^2)あたり事業所数
export function density(est, radiusM) {
  const km2 = (Math.PI * radiusM * radiusM) / 1e6;
  return km2 > 0 ? est / km2 : null;
}

/**
 * 昼間人口の代理指標 = 常住人口 + 全産業従業者数
 *
 * 常住(夜間)人口だけを分母にすると、繁華街・オフィス街で無意味な値になる
 * （新宿駅1km圏は夜間人口24,300人に対し飲食店2,367軒＝「10人に1店」）。
 * 経済センサスの全産業従業者数はそこで働く人の数で、昼間人口の主成分にあたる。
 *
 * これは**代理指標であって昼間人口そのものではない**:
 *   - 同じセルに住み、かつ働く人を二重に数える
 *   - 就業も通学もしない来街者(買い物客・観光客)を含まない
 * 正確な昼間人口は国勢調査の従業地・通学地集計(1kmメッシュ)にあり、そちらは将来のレイヤー。
 */
export function daytimeProxy(sum) {
  const all = readCircle(sum, "all");
  return all.pop + all.emp;
}

// 1業種について、夜間人口ベースと昼間代理ベースの両方を返す。
// baselines = { night, day } はそれぞれの基準となる1店あたり人口。
export function summary(sum, id, baselines = {}) {
  const c = readCircle(sum, id);
  const daytimePop = daytimeProxy(sum);
  const night = metrics({ pop: c.pop, est: c.est, emp: c.emp, baselinePerStore: baselines.night });
  const day = metrics({ pop: daytimePop, est: c.est, emp: c.emp, baselinePerStore: baselines.day });
  return {
    ...c,
    daytimePop,
    // 平均店舗規模は分母(夜間/昼間)に依らないのでトップレベルに出す
    avgSize: night.avgSize,
    night,
    day,
  };
}
