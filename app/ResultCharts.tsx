"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import type { Locale } from "./i18n";
import type {
  AnalysisEnvelope,
  Grouping,
  Mode,
  QuestionDetail,
  ResultRow,
} from "./types";

type ChartMetric = "mean" | "median" | "quartiles" | "sd" | "base_n";
type ChartLayout = "country" | "wave";
type AdaptiveChartKind = "line" | "bar" | "distribution" | "scatter";
type ResultDetails = { primary: QuestionDetail | null; secondary: QuestionDetail | null };

const COLORS = [
  "#1F6F9C", "#3C4858", "#4E8D7C", "#8C6D5E", "#7A9EAE", "#6E5F7E",
  "#B05A4F", "#547A3A", "#9A6A16", "#75558A", "#2E7C83", "#A84D72",
  "#4C6494", "#7E7440", "#536E67", "#8E5C45", "#4E789A", "#68724D",
];

const STATISTIC_LABELS: Record<Locale, Record<string, string>> = {
  en: {
    distribution: "Response distribution",
    category_share: "Selected-response share",
    mean: "Mean score",
    median: "Median response",
    quartiles: "Quartiles",
    sd: "Standard deviation",
    base_n: "Valid N",
  },
  "zh-Hant": {
    distribution: "回答分布",
    category_share: "指定回答比例",
    mean: "平均分",
    median: "中位回答",
    quartiles: "四分位數",
    sd: "標準差",
    base_n: "有效人數",
  },
};

const METRIC_LABELS: Record<Locale, Record<string, string>> = {
  en: {
    mean: "Mean",
    sd: "Standard deviation",
    median: "Median",
    q25: "25th percentile",
    q75: "75th percentile",
    min: "Minimum",
    max: "Maximum",
    base_n: "Valid N",
  },
  "zh-Hant": {
    mean: "平均值",
    sd: "標準差",
    median: "中位數",
    q25: "第 25 百分位",
    q75: "第 75 百分位",
    min: "最小值",
    max: "最大值",
    base_n: "有效人數",
  },
};

function bi(locale: Locale, english: string, traditionalChinese: string): string {
  return locale === "en" ? english : traditionalChinese;
}

function formatNumber(value: unknown, digits = 2, locale: Locale): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat(locale === "en" ? "en" : "zh-TW", {
    maximumFractionDigits: digits,
  }).format(value);
}

function dimensionLabel(row: ResultRow, locale: Locale): string {
  return row.dimensions?.map((item) => item.label).join(" · ")
    || bi(locale, "All respondents", "全部樣本");
}

function dimensionValue(row: ResultRow, kind: "country" | "wave"): string | null {
  return row.dimensions?.find((item) => item.kind === kind)?.label ?? null;
}

function chartHeight(
  kind: AdaptiveChartKind,
  itemCount: number,
  seriesCount = 1,
): number {
  if (kind === "line") return Math.max(360, 300 + Math.ceil(Math.max(seriesCount, 1) / 4) * 28);
  if (kind === "bar") return Math.max(300, Math.max(itemCount, 1) * 38 + 72);
  if (kind === "distribution") {
    const legendRows = Math.ceil(Math.max(seriesCount, 1) / 4);
    return Math.max(280, Math.max(itemCount, 1) * 40 + 64)
      + Math.max(legendRows - 1, 0) * 24;
  }
  return 420;
}

function scoreDomain(
  detail: QuestionDetail | null,
  mode: Mode | null,
): [number, number] | undefined {
  if (!detail || !mode || mode === "category") return undefined;
  const values = detail.scale.flatMap((item) => {
    if (
      mode === "continuous"
      && item.continuous_status === "included"
      && item.continuous_score != null
    ) return [item.continuous_score];
    if (
      mode === "order"
      && item.order_status === "included"
      && item.order_position != null
    ) return [item.order_position];
    return [];
  });
  return values.length ? [Math.min(...values), Math.max(...values)] : undefined;
}

function categoryAxisWidth(labels: unknown[]): number {
  const longest = labels.reduce<number>(
    (length, label) => Math.max(length, String(label ?? "").length),
    0,
  );
  return Math.min(280, Math.max(140, Math.round(longest * 5.8)));
}

function summaryMetricRows(rows: ResultRow[], metric: ChartMetric): ResultRow[] {
  if (metric !== "base_n") return rows.filter((row) => row.metric === metric);
  const explicit = rows.filter((row) => row.metric === "base_n");
  if (explicit.length) return explicit;
  const contexts = new Map<string, ResultRow>();
  rows.forEach((row) => {
    const key = JSON.stringify(row.dimensions ?? []);
    if (!contexts.has(key) && row.base_n != null) {
      contexts.set(key, { ...row, metric: "base_n", estimate: Number(row.base_n) });
    }
  });
  return [...contexts.values()];
}

function QuartileRangeChart({
  rows,
  detail,
  mode,
  grouping,
  layout,
  locale,
}: {
  rows: ResultRow[];
  detail: QuestionDetail | null;
  mode: Mode | null;
  grouping: Grouping;
  layout: ChartLayout;
  locale: Locale;
}) {
  type QuartileItem = {
    label: string;
    country: string | null;
    wave: string | null;
    q25?: number;
    median?: number;
    q75?: number;
    q25Label?: string;
    medianLabel?: string;
    q75Label?: string;
  };
  const contexts = new Map<string, QuartileItem>();
  rows.forEach((row) => {
    if (!["q25", "median", "q75"].includes(String(row.metric))) return;
    const label = dimensionLabel(row, locale);
    const key = JSON.stringify(row.dimensions ?? []);
    const item = contexts.get(key) ?? {
      label,
      country: dimensionValue(row, "country"),
      wave: dimensionValue(row, "wave"),
    };
    const metric = String(row.metric) as "q25" | "median" | "q75";
    item[metric] = Number(row.estimate);
    if (row.label) item[`${metric}Label`] = String(row.label);
    contexts.set(key, item);
  });
  const items = [...contexts.values()].filter(
    (item) => item.q25 != null && item.median != null && item.q75 != null,
  );
  if (!items.length) {
    return <div className="chart-empty">{bi(locale, "Quartiles are not available for this result.", "這份結果沒有可呈現的四分位數。")}</div>;
  }
  const definedDomain = scoreDomain(detail, mode);
  const values = items.flatMap((item) => [item.q25, item.median, item.q75]).filter(
    (value): value is number => value != null && Number.isFinite(value),
  );
  const minimum = definedDomain?.[0] ?? Math.min(...values);
  const maximum = definedDomain?.[1] ?? Math.max(...values);
  const span = Math.max(maximum - minimum, 1);
  const facetKind = grouping === "country_wave"
    ? (layout === "country" ? "country" : "wave")
    : null;
  const groupedItems = new Map<string, QuartileItem[]>();
  items.forEach((item) => {
    const facet = facetKind ? item[facetKind] ?? bi(locale, "Other", "其他") : "";
    groupedItems.set(facet, [...(groupedItems.get(facet) ?? []), item]);
  });
  const displayValue = (value: number | undefined, label: string | undefined) =>
    `${formatNumber(value, 2, locale)}${mode === "order" && label ? ` · ${label}` : ""}`;
  return (
    <div className="quartile-chart">
      <div className="quartile-legend">
        <span><i className="range" />{bi(locale, "25th–75th percentile", "第 25–75 百分位")}</span>
        <span><i className="median" />{bi(locale, "Median", "中位數")}</span>
      </div>
      <div className="quartile-axis"><span>{formatNumber(minimum, 2, locale)}</span><span>{formatNumber(maximum, 2, locale)}</span></div>
      {[...groupedItems.entries()].map(([facet, groupItems]) => (
        <section className="quartile-facet" key={facet || "all"}>
          {facet && <header><strong>{facet}</strong><span>{layout === "country" ? bi(locale, "Waves listed below", "下列各波次") : bi(locale, "Countries listed below", "下列各國家")}</span></header>}
          {groupItems.map((item) => {
            const left = ((Number(item.q25) - minimum) / span) * 100;
            const width = ((Number(item.q75) - Number(item.q25)) / span) * 100;
            const median = ((Number(item.median) - minimum) / span) * 100;
            const rowLabel = facetKind === "country" ? item.wave ?? item.label
              : facetKind === "wave" ? item.country ?? item.label : item.label;
            return (
              <div className="quartile-row" key={item.label}>
                <strong>{rowLabel}</strong>
                <div className="quartile-rail">
                  <span className="quartile-range" style={{ left: `${left}%`, width: `${Math.max(width, 1)}%` }} />
                  <span className="quartile-median" style={{ left: `${median}%` }} title={`${bi(locale, "Median", "中位數")}: ${displayValue(item.median, item.medianLabel)}`} />
                </div>
                <small>{displayValue(item.q25, item.q25Label)}<br />{displayValue(item.median, item.medianLabel)}<br />{displayValue(item.q75, item.q75Label)}</small>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function StatisticGrid({ rows, locale }: { rows: ResultRow[]; locale: Locale }) {
  return <div className="stat-grid">{rows.map((row, index) => <div key={`${row.metric}-${index}`}><span>{METRIC_LABELS[locale][String(row.metric)] ?? bi(locale, "Statistic", "統計量")}</span><strong>{formatNumber(row.estimate, row.metric === "base_n" ? 0 : 2, locale)}</strong><small>{row.label ?? dimensionLabel(row, locale)}{row.metric !== "base_n" && row.base_n != null ? ` · n=${formatNumber(row.base_n, 0, locale)}` : ""}</small></div>)}</div>;
}

function CrosstabMatrix({ envelope, details, locale }: { envelope: AnalysisEnvelope; details: ResultDetails; locale: Locale }) {
  const basis = envelope.result.percentage_basis ?? "row";
  const key = `${basis}_proportion`;
  const contexts = [...new Set(envelope.result.rows.map((row) => dimensionLabel(row, locale)))];
  return <div className="matrix-list">{contexts.map((context) => {
    const rows = envelope.result.rows.filter((row) => dimensionLabel(row, locale) === context);
    const rowLabels = [...new Set(rows.map((row) => String(row.outcome_label ?? "—")))];
    const columns = [...new Set(rows.map((row) => String(row.group_label ?? "—")))];
    return <section key={context} className="matrix-block"><header><strong>{context}</strong><span>{basis === "row" ? bi(locale, "Each row totals 100%", "每一列合計 100%") : basis === "column" ? bi(locale, "Each column totals 100%", "每一欄合計 100%") : bi(locale, "All cells total 100%", "全部儲存格合計 100%")}</span></header><div className="table-wrap"><table className="crosstab-matrix"><thead><tr><th>{details.primary?.variable_id ?? envelope.draft.target_id} {bi(locale, "row responses", "列回答")}</th>{columns.map((column) => <th key={column}>{column}</th>)}</tr><tr className="matrix-axis-row"><th /><th colSpan={Math.max(columns.length, 1)}>{details.secondary?.variable_id ?? envelope.draft.secondary_id} {bi(locale, "column responses", "欄回答")}</th></tr></thead><tbody>{rowLabels.map((rowLabel) => <tr key={rowLabel}><th>{rowLabel}</th>{columns.map((column) => { const cell = rows.find((row) => row.outcome_label === rowLabel && row.group_label === column); const value = Number(cell?.[key] ?? 0) * 100; return <td key={column} style={{ backgroundColor: `rgba(31,111,156,${Math.min(0.08 + value / 125, 0.82)})` }}><strong>{formatNumber(value, 2, locale)}%</strong><small>n={formatNumber(cell?.unweighted_n, 0, locale)}</small></td>; })}</tr>)}</tbody></table></div></section>;
  })}</div>;
}

export interface ResultChartProps {
  envelope: AnalysisEnvelope;
  details: ResultDetails;
  metric: ChartMetric;
  layout: ChartLayout;
  locale: Locale;
}

export default function ResultChart({ envelope, details, metric, layout, locale }: ResultChartProps) {
  const { result, draft } = envelope;
  if (!result.rows.length) return <div className="chart-empty">{bi(locale, "There is no result to display for this scope.", "目前設定沒有可呈現的結果。")}</div>;
  if (result.result_type === "summary") {
    if (metric === "quartiles") {
      return <QuartileRangeChart rows={result.rows} detail={details.primary} mode={draft.mode} grouping={draft.grouping} layout={layout} locale={locale} />;
    }
    const rows = summaryMetricRows(result.rows, metric);
    if (draft.grouping === "none" || rows.length <= 1) return <StatisticGrid rows={rows} locale={locale} />;
    const domain = ["mean", "median"].includes(metric) ? scoreDomain(details.primary, draft.mode) : undefined;
    const xKind: "country" | "wave" | null = draft.grouping === "country_wave"
      ? (layout === "country" ? "wave" : "country")
      : draft.grouping === "wave" ? "wave" : draft.grouping === "country" ? "country" : null;
    const seriesKind: "country" | "wave" | null = draft.grouping === "country_wave"
      ? (layout === "country" ? "country" : "wave")
      : null;
    if (xKind) {
      const contexts = [...new Set(rows.map((row) => dimensionValue(row, xKind) ?? dimensionLabel(row, locale)))];
      const series = seriesKind
        ? [...new Set(rows.map((row) => dimensionValue(row, seriesKind) ?? bi(locale, "Result", "結果")))]
        : [STATISTIC_LABELS[locale][metric]];
      const data = contexts.map((context) => {
        const item: Record<string, string | number> = { context };
        rows.filter((row) => (dimensionValue(row, xKind) ?? dimensionLabel(row, locale)) === context).forEach((row) => {
          item[seriesKind ? dimensionValue(row, seriesKind) ?? bi(locale, "Result", "結果") : series[0]] = Number(row.estimate);
        });
        return item;
      });
      if (xKind === "wave") {
        return <><div className="chart-note">{bi(locale, "Each wave is a separate cross-sectional sample; lines only help show change over time.", "各波次為不同的橫截面樣本；連線僅用於協助觀察變化。")}</div><div className="chart-wrap" style={{ height: chartHeight("line", data.length, series.length) }}><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 14, right: 28, bottom: 18, left: 8 }}><CartesianGrid stroke="#E4E0D6" vertical={false} /><XAxis dataKey="context" /><YAxis domain={domain} tickFormatter={(value) => formatNumber(value, metric === "base_n" ? 0 : 1, locale)} /><Tooltip formatter={(value) => formatNumber(value, metric === "base_n" ? 0 : 2, locale)} /><Legend />{series.map((name, index) => <Line key={name} type="linear" dataKey={name} stroke={COLORS[index % COLORS.length]} strokeWidth={2.4} dot={{ r: 4 }} connectNulls={false} />)}</LineChart></ResponsiveContainer></div></>;
      }
      return <div className="chart-wrap" style={{ height: chartHeight("bar", data.length, series.length) }}><ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{ top: 12, right: 26, bottom: 12, left: 22 }}><CartesianGrid stroke="#E4E0D6" horizontal={false} /><XAxis type="number" domain={domain} tickFormatter={(value) => formatNumber(value, metric === "base_n" ? 0 : 1, locale)} /><YAxis type="category" dataKey="context" width={categoryAxisWidth(data.map((item) => item.context))} /><Tooltip formatter={(value) => formatNumber(value, metric === "base_n" ? 0 : 2, locale)} /><Legend />{series.map((name, index) => <Bar key={name} dataKey={name} fill={COLORS[index % COLORS.length]} maxBarSize={23} />)}</BarChart></ResponsiveContainer></div>;
    }
    const data = rows.map((row) => ({ context: row.label ? `${dimensionLabel(row, locale)} · ${row.label}` : dimensionLabel(row, locale), value: Number(row.estimate) }));
    return <div className="chart-wrap" style={{ height: chartHeight("bar", data.length) }}><ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{ top: 12, right: 26, bottom: 12, left: 22 }}><CartesianGrid stroke="#E4E0D6" horizontal={false} /><XAxis type="number" domain={domain} /><YAxis type="category" dataKey="context" width={categoryAxisWidth(data.map((item) => item.context))} /><Tooltip formatter={(value) => formatNumber(value, metric === "base_n" ? 0 : 2, locale)} /><Bar dataKey="value" name={STATISTIC_LABELS[locale][metric]} fill="#1F6F9C" maxBarSize={25} /></BarChart></ResponsiveContainer></div>;
  }
  if (result.result_type === "distribution" || result.result_type === "multi_response") {
    const distributionData = (rows: ResultRow[], context: (row: ResultRow) => string) => {
      const grouped = new Map<string, Record<string, string | number>>();
      rows.forEach((row) => {
        const label = String(row.label ?? row.option_label ?? row.raw_value ?? "—");
        const seriesName = context(row);
        const item = grouped.get(label) ?? { label };
        item[seriesName] = Number(row.proportion ?? 0) * 100;
        grouped.set(label, item);
      });
      return [...grouped.values()];
    };
    const totalsByContext = new Map<string, number>();
    if (result.result_type === "multi_response") {
      result.rows.forEach((row) => {
        const context = dimensionLabel(row, locale);
        totalsByContext.set(context, (totalsByContext.get(context) ?? 0) + Number(row.proportion ?? 0) * 100);
      });
    }
    const largestTotal = totalsByContext.size ? Math.max(...totalsByContext.values()) : null;
    const note = largestTotal != null && largestTotal > 100.01
      ? <div className="chart-note">{bi(locale, `This is a multiple-response question. Respondents may select more than one option, so percentages within a scope can exceed 100% (largest total: ${formatNumber(largestTotal, 2, locale)}%).`, `這是多選題；同一受訪者可選擇多個選項，因此單一範圍內的比例合計可能超過 100%（最高合計 ${formatNumber(largestTotal, 2, locale)}%）。`)}</div>
      : null;
    if (draft.grouping === "country_wave") {
      const facetKind = layout === "country" ? "country" : "wave";
      const seriesKind = layout === "country" ? "wave" : "country";
      const facets = [...new Set(result.rows.map((row) => dimensionValue(row, facetKind)).filter((value): value is string => Boolean(value)))];
      return <>{note}<div className="distribution-facets">{facets.map((facet) => {
        const rows = result.rows.filter((row) => dimensionValue(row, facetKind) === facet);
        const series = [...new Set(rows.map((row) => dimensionValue(row, seriesKind) ?? bi(locale, "Result", "結果")))];
        const data = distributionData(rows, (row) => dimensionValue(row, seriesKind) ?? bi(locale, "Result", "結果"));
        return <section className="distribution-facet" key={facet}><header><strong>{facet}</strong><span>{layout === "country" ? bi(locale, "Waves shown separately", "各波次分別呈現") : bi(locale, "Countries shown separately", "各國家分別呈現")}</span></header><div className="chart-wrap distribution" style={{ height: chartHeight("distribution", data.length, series.length) }}><ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{ top: 10, right: 24, bottom: 10, left: 20 }}><CartesianGrid stroke="#E4E0D6" horizontal={false} /><XAxis type="number" domain={[0, 100]} tickFormatter={(value) => `${value}%`} /><YAxis type="category" dataKey="label" width={categoryAxisWidth(data.map((item) => item.label))} interval={0} /><Tooltip formatter={(value) => `${formatNumber(value, 2, locale)}%`} /><Legend />{series.map((name, index) => <Bar key={name} dataKey={name} fill={COLORS[index % COLORS.length]} maxBarSize={23} />)}</BarChart></ResponsiveContainer></div></section>;
      })}</div></>;
    }
    const data = distributionData(result.rows, (row) => dimensionLabel(row, locale));
    const series = [...new Set(result.rows.map((row) => dimensionLabel(row, locale)))];
    return <>{note}<div className="chart-wrap distribution" style={{ height: chartHeight("distribution", data.length, series.length) }}><ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{ top: 10, right: 24, bottom: 10, left: 20 }}><CartesianGrid stroke="#E4E0D6" horizontal={false} /><XAxis type="number" domain={[0, 100]} tickFormatter={(value) => `${value}%`} /><YAxis type="category" dataKey="label" width={categoryAxisWidth(data.map((item) => item.label))} interval={0} /><Tooltip formatter={(value) => `${formatNumber(value, 2, locale)}%`} /><Legend />{series.map((name, index) => <Bar key={name} dataKey={name} fill={COLORS[index % COLORS.length]} maxBarSize={23} />)}</BarChart></ResponsiveContainer></div></>;
  }
  if (result.result_type === "crosstab") return <CrosstabMatrix envelope={envelope} details={details} locale={locale} />;
  if (result.result_type === "relationship") {
    const xDomain = scoreDomain(details.primary, "continuous");
    const yDomain = scoreDomain(details.secondary, "continuous");
    const data = result.rows.map((row) => ({ x: row.x, y: row.y, z: row.estimate_n ?? row.unweighted_n ?? 1 }));
    return <><div className="chart-note">{bi(locale, `Larger points represent more responses. The x-axis is ${details.primary?.variable_id ?? envelope.draft.target_id}; the y-axis is ${details.secondary?.variable_id ?? envelope.draft.secondary_id}. This is a joint distribution, not a correlation or regression estimate.`, `圓點越大，代表該分數組合的回答越多；橫軸為 ${details.primary?.variable_id ?? envelope.draft.target_id}，縱軸為 ${details.secondary?.variable_id ?? envelope.draft.secondary_id}。此圖呈現聯合分布，不代表相關或迴歸。`)}</div><div className="chart-wrap" style={{ height: chartHeight("scatter", data.length) }}><ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{ top: 18, right: 24, bottom: 22, left: 12 }}><CartesianGrid stroke="#E4E0D6" /><XAxis type="number" dataKey="x" name={details.primary ? `${details.primary.variable_id} · ${details.primary.question_text}` : envelope.draft.target_id ?? "X"} domain={xDomain} /><YAxis type="number" dataKey="y" name={details.secondary ? `${details.secondary.variable_id} · ${details.secondary.question_text}` : envelope.draft.secondary_id ?? "Y"} domain={yDomain} /><ZAxis type="number" dataKey="z" range={[45, 520]} /><Tooltip cursor={{ strokeDasharray: "3 3" }} /><Scatter data={data} fill="#1F6F9C" fillOpacity={0.72} /></ScatterChart></ResponsiveContainer></div></>;
  }
  return null;
}
