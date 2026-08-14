export type Mode = "category" | "order" | "continuous";
export type Grouping = "none" | "country" | "wave" | "country_wave";

export interface Country {
  code: number;
  name: string;
}

export interface Topic {
  id: string;
  labelEn: string;
  labelZh: string;
  questionCount: number;
}

export interface Question {
  id: string;
  position: number;
  text: string;
  selectionMode: string;
  responseSetId: string | null;
  memberOrder: number | null;
  topicId: string;
  modes: Mode[];
  waves: number[];
}

export interface Catalog {
  dataset: {
    sourceRows: number;
    questionCount: number;
    builderVersion: string;
    exportedAt: string;
    dataMode: string;
    release?: {
      schemaVersion: string;
      transactionId: string;
      correctionVersion: string;
      activeManifestSha256: string;
      promotionReceiptSha256: string;
      sourceDatabase: {
        path: string;
        bytes: number;
        sha256: string;
      };
    };
  };
  countries: Country[];
  waves: number[];
  topics: Topic[];
  questions: Question[];
}

export type ScaleTuple = [
  rawValue: number | null,
  rawValueKey: string,
  categoryLabel: string,
  categoryStatus: string,
  orderPosition: number | null,
  orderStatus: string,
  continuousScore: number | null,
  continuousStatus: string,
];

export type CellTuple = [
  countryCode: number,
  wave: number,
  rawValue: number | null,
  unweightedN: number,
];

export interface QuestionData {
  id: string;
  scale: ScaleTuple[];
  cells: CellTuple[];
}

export interface DistributionPoint {
  key: string;
  label: string;
  rawValue: number | null;
  orderPosition: number | null;
  continuousScore: number | null;
  n: number;
  proportion: number;
}

export interface Summary {
  baseN: number;
  mean: number | null;
  sd: number | null;
  q25: number | null;
  median: number | null;
  q75: number | null;
  q25Label: string | null;
  medianLabel: string | null;
  q75Label: string | null;
}

export interface AnalysisGroup {
  key: string;
  label: string;
  countryCode: number | null;
  wave: number | null;
  distribution: DistributionPoint[];
  summary: Summary;
}

function valueKey(value: number | null): string {
  return value === null ? "__null__" : String(value);
}

function isIncluded(scale: ScaleTuple, mode: Mode): boolean {
  return (
    (mode === "category" && scale[3] === "included") ||
    (mode === "order" && scale[5] === "included") ||
    (mode === "continuous" && scale[7] === "included")
  );
}

function quantile(
  points: Array<{ value: number; mass: number; label: string }>,
  probability: number,
): { value: number; label: string } | null {
  const ordered = [...points].sort((a, b) => a.value - b.value);
  const total = ordered.reduce((sum, point) => sum + point.mass, 0);
  if (!total) return null;
  const threshold = probability * total;
  let cumulative = 0;
  for (const point of ordered) {
    cumulative += point.mass;
    if (cumulative + 1e-12 >= threshold) return point;
  }
  return ordered.at(-1) ?? null;
}

export function analyzeQuestion(
  questionData: QuestionData,
  countries: Country[],
  selectedCountries: number[],
  selectedWaves: number[],
  mode: Mode,
  grouping: Grouping,
): AnalysisGroup[] {
  const countryNames = new Map(countries.map((country) => [country.code, country.name]));
  const scaleByValue = new Map(
    questionData.scale.map((scale) => [valueKey(scale[0]), scale]),
  );
  const selectedCountrySet = new Set(selectedCountries);
  const selectedWaveSet = new Set(selectedWaves);
  const grouped = new Map<string, CellTuple[]>();

  for (const cell of questionData.cells) {
    if (!selectedCountrySet.has(cell[0]) || !selectedWaveSet.has(cell[1])) continue;
    const scale = scaleByValue.get(valueKey(cell[2]));
    if (!scale || !isIncluded(scale, mode)) continue;
    const key = grouping === "country"
      ? `c:${cell[0]}`
      : grouping === "wave"
        ? `w:${cell[1]}`
        : grouping === "country_wave"
          ? `c:${cell[0]}:w:${cell[1]}`
          : "all";
    const rows = grouped.get(key) ?? [];
    rows.push(cell);
    grouped.set(key, rows);
  }

  const output: AnalysisGroup[] = [];
  for (const [key, cells] of grouped) {
    const counts = new Map<string, number>();
    for (const cell of cells) {
      const rawKey = valueKey(cell[2]);
      counts.set(rawKey, (counts.get(rawKey) ?? 0) + cell[3]);
    }
    const baseN = [...counts.values()].reduce((sum, count) => sum + count, 0);
    const distribution = [...counts.entries()]
      .map(([rawKey, n]) => {
        const scale = scaleByValue.get(rawKey);
        if (!scale) return null;
        return {
          key: scale[1],
          label: scale[2],
          rawValue: scale[0],
          orderPosition: scale[4],
          continuousScore: scale[6],
          n,
          proportion: baseN ? n / baseN : 0,
        };
      })
      .filter((point): point is DistributionPoint => point !== null)
      .sort((a, b) => {
        const aOrder = a.orderPosition ?? Number.POSITIVE_INFINITY;
        const bOrder = b.orderPosition ?? Number.POSITIVE_INFINITY;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return (a.rawValue ?? Number.POSITIVE_INFINITY) - (b.rawValue ?? Number.POSITIVE_INFINITY);
      });

    const scorePoints = distribution
      .map((point) => ({
        value: mode === "continuous"
          ? point.continuousScore
          : mode === "order"
            ? point.orderPosition
            : null,
        mass: point.n,
        label: point.label,
      }))
      .filter((point): point is { value: number; mass: number; label: string } => point.value !== null);
    const scoreBase = scorePoints.reduce((sum, point) => sum + point.mass, 0);
    const mean = mode === "continuous" && scoreBase
      ? scorePoints.reduce((sum, point) => sum + point.value * point.mass, 0) / scoreBase
      : null;
    const variance = mean !== null && scoreBase > 1
      ? scorePoints.reduce(
          (sum, point) => sum + point.mass * (point.value - mean) ** 2,
          0,
        ) / (scoreBase - 1)
      : null;
    const q25 = quantile(scorePoints, 0.25);
    const median = quantile(scorePoints, 0.5);
    const q75 = quantile(scorePoints, 0.75);

    const countryCode = grouping === "country" || grouping === "country_wave"
      ? cells[0][0]
      : null;
    const wave = grouping === "wave" || grouping === "country_wave"
      ? cells[0][1]
      : null;
    const label = grouping === "country"
      ? countryNames.get(countryCode ?? -1) ?? "Unknown"
      : grouping === "wave"
        ? `Wave ${wave}`
        : grouping === "country_wave"
          ? `${countryNames.get(countryCode ?? -1) ?? "Unknown"} · W${wave}`
          : "Combined";
    output.push({
      key,
      label,
      countryCode,
      wave,
      distribution,
      summary: {
        baseN,
        mean,
        sd: variance === null ? null : Math.sqrt(Math.max(variance, 0)),
        q25: q25?.value ?? null,
        median: median?.value ?? null,
        q75: q75?.value ?? null,
        q25Label: mode === "order" ? q25?.label ?? null : null,
        medianLabel: mode === "order" ? median?.label ?? null : null,
        q75Label: mode === "order" ? q75?.label ?? null : null,
      },
    });
  }

  return output.sort((a, b) => {
    if ((a.countryCode ?? 0) !== (b.countryCode ?? 0)) {
      return (a.countryCode ?? 0) - (b.countryCode ?? 0);
    }
    return (a.wave ?? 0) - (b.wave ?? 0);
  });
}

export function availableContexts(
  questionData: QuestionData,
  mode: Mode,
): Set<string> {
  const scaleByValue = new Map(
    questionData.scale.map((scale) => [valueKey(scale[0]), scale]),
  );
  return new Set(
    questionData.cells
      .filter((cell) => {
        const scale = scaleByValue.get(valueKey(cell[2]));
        return Boolean(scale && isIncluded(scale, mode) && cell[3] > 0);
      })
      .map((cell) => `${cell[0]}-${cell[1]}`),
  );
}
