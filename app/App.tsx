"use client";

import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BarChart3,
  Bot,
  ChevronRight,
  CircleHelp,
  Database,
  Eye,
  FileQuestion,
  ListFilter,
  LoaderCircle,
  MessageSquarePlus,
  MessageSquareText,
  Search,
  Send,
  Table2,
  X,
} from "lucide-react";
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
import { api, catalogMatch } from "./api";
import { missingScopeCells } from "./coverage";
import {
  DEFAULT_LOCALE,
  cleanMarkdown,
  localizeAssistantMessage,
  localizeOptionDescription,
  localizeOptionLabel,
  localizeSuggestionLabel,
  topicLabel,
  type Locale,
} from "./i18n";
import type {
  AnalysisEnvelope,
  Bootstrap,
  ConversationCommand,
  ConversationOption,
  ConversationResponse,
  ConversationSnapshot,
  ConversationSuggestion,
  Context,
  Country,
  Draft,
  Grouping,
  Mode,
  Operation,
  Question,
  QuestionDetail,
  ResponseSet,
  ResponseSetDetail,
  ResultRow,
} from "./types";
import { EMPTY_DRAFT } from "./types";

const MODE_LABELS: Record<Locale, Record<Mode, string>> = {
  en: {
    category: "Categorical",
    order: "Ordinal",
    continuous: "Continuous score",
  },
  "zh-Hant": {
    category: "類別",
    order: "有序",
    continuous: "連續分數",
  },
};

const MODE_EXPLANATIONS: Record<Locale, Record<Mode, string>> = {
  en: {
    category: "View counts and percentages for each response.",
    order: "Calculate median and quartiles using the scale order.",
    continuous: "Calculate means, standard deviations, and trends using the defined score.",
  },
  "zh-Hant": {
    category: "查看各回答選項的人數與百分比。",
    order: "依量表順序計算中位回答與四分位數。",
    continuous: "依既定計分計算平均值、標準差與趨勢。",
  },
};

const OPERATION_LABELS: Record<Locale, Record<Operation, string>> = {
  en: {
    distribution: "Response distribution",
    summary: "Statistical summary",
    crosstab: "Two-question crosstab",
    relationship: "Score relationship",
    multi_response: "Multiple-response selection rate",
  },
  "zh-Hant": {
    distribution: "回答分布",
    summary: "統計摘要",
    crosstab: "兩題交叉",
    relationship: "分數關係",
    multi_response: "多選題選擇率",
  },
};

const OPERATION_EXPLANATIONS: Record<Locale, Record<Operation, string>> = {
  en: {
    distribution: "Counts, percentages, and scale positions for each response.",
    summary: "Valid N, mean, median, standard deviation, and quartiles.",
    crosstab: "Use the first question as rows and the second as columns.",
    relationship: "Show the joint distribution of two defined scores.",
    multi_response: "Calculate the share of respondents mentioning each option.",
  },
  "zh-Hant": {
    distribution: "各選項的人數、百分比與量表位置。",
    summary: "有效人數、平均值、中位數、標準差與四分位數。",
    crosstab: "第一題作為表格列，第二題作為表格欄。",
    relationship: "顯示兩個既定分數的聯合分布。",
    multi_response: "計算每個選項被提及的受訪者比例。",
  },
};

const GROUPING_LABELS: Record<Locale, Record<Grouping, string>> = {
  en: {
    none: "Combined",
    country: "By country or territory",
    wave: "By survey wave",
    country_wave: "Country × wave",
    survey_variable: "By another response",
  },
  "zh-Hant": {
    none: "合併",
    country: "依國家或地區",
    wave: "依調查波次",
    country_wave: "國家 × 波次",
    survey_variable: "依另一題回答",
  },
};

const GROUPING_EXPLANATIONS: Record<Locale, Record<Grouping, string>> = {
  en: {
    none: "Combine all selected samples.",
    country: "Present each country or territory separately.",
    wave: "Present each wave separately.",
    country_wave: "Present each country-wave cell separately.",
    survey_variable: "Group by responses to another question.",
  },
  "zh-Hant": {
    none: "將所選樣本合併計算。",
    country: "每個國家或地區分別呈現。",
    wave: "每個波次分別呈現。",
    country_wave: "每個國家與波次組合分別呈現。",
    survey_variable: "依另一題的回答分組。",
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

const CHART_COLORS = [
  "#1F6F9C", "#3C4858", "#4E8D7C", "#8C6D5E", "#7A9EAE", "#6E5F7E",
  "#B05A4F", "#547A3A", "#9A6A16", "#75558A", "#2E7C83", "#A84D72",
  "#4C6494", "#7E7440", "#536E67", "#8E5C45", "#4E789A", "#68724D",
];

/** Conversation-view statistic ids → analysis-record citation vocabulary. */
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

type JournalOrigin = "workbench" | "conversation";

interface JournalEntry {
  /** Monotonic 第 N 則 number; never shifts (no eviction in the desk). */
  number: number;
  origin: JournalOrigin;
  envelope: AnalysisEnvelope;
  statistic: string;
}

type ResultTab = "chart" | "table";
type ChartMetric = "mean" | "median" | "quartiles" | "sd" | "base_n";
type ChartLayout = "country" | "wave";
type CatalogKind = "questions" | "response_sets";
type ResultDetails = { primary: QuestionDetail | null; secondary: QuestionDetail | null };
type WorkspaceSurface = "workbench" | "conversation";
type AssistantPhase = "idle" | "submitting" | "interpreting" | "updating" | "rendering";
type AdaptiveChartKind = "line" | "bar" | "distribution" | "scatter";
type PrimaryAnalysisOption = {
  id: "distribution" | "summary";
  mode: Mode;
  operation: "distribution" | "summary";
  label: string;
  description: string;
};

type FontSize = "small" | "standard" | "large";

function bi(locale: Locale, english: string, traditionalChinese: string): string {
  return locale === "en" ? english : traditionalChinese;
}

export function isQuestionListMessage(message: string): boolean {
  const cleaned = cleanMarkdown(message);
  const questionIds = cleaned.match(/\bq\d+(?:\.\d+)?\b/gi) ?? [];
  return questionIds.length > 0 && (
    /找到以下相關題目|請選擇題目|可能對應不同的測量/.test(cleaned)
    || /matching survey questions|choose (?:a|the) survey question/i.test(cleaned)
  );
}

function questionOptionParts(
  option: ConversationOption,
  questions: Question[],
  locale: Locale,
): {
  questionId: string;
  questionText: string;
  topic: string;
  waves: string;
  matchBand: Question["match_band"];
  matchReasons: string[];
} {
  const cleaned = cleanMarkdown(option.label);
  const match = cleaned.match(/^\s*(q[\d.]+)\s*[·:]\s*(.+)$/i);
  const questionId = match?.[1] ?? option.value;
  const describedWaves = cleanMarkdown(option.description ?? "").replace(
    /、/g,
    locale === "en" ? ", " : "、",
  );
  const question = questions.find((item) => item.variable_id === questionId);
  const metadataWaves = question?.waves.length
    ? question.waves.map((wave) => `W${wave}`).join(locale === "en" ? ", " : "、")
    : "";
  return {
    questionId,
    questionText: match?.[2] ?? cleaned,
    topic: question ? topicLabel(locale, question.topic_id, question.topic_label) : "",
    waves: describedWaves || metadataWaves,
    matchBand: option.match_band ?? question?.match_band,
    matchReasons: (option.match_reasons ?? question?.match_reasons ?? []).map((reason) => {
      const labels = {
        exact_id: bi(locale, "Exact question ID", "題號完全相符"),
        question_phrase: bi(locale, "Question wording", "題目文字相符"),
        question_terms: bi(locale, "Question keywords", "題目關鍵詞相符"),
        topic_terms: bi(locale, "Research topic", "研究主題相符"),
      };
      return labels[reason];
    }),
  };
}

function matchBandLabel(
  band: Question["match_band"],
  locale: Locale,
): string {
  if (band === "high") return bi(locale, "High match", "高度相關");
  if (band === "related") return bi(locale, "Related", "相關");
  return bi(locale, "Broad match", "延伸相關");
}

export function operationsFor(mode: Mode | null): Operation[] {
  if (mode === "category") return ["distribution", "crosstab"];
  if (mode === "order") return ["distribution", "summary", "crosstab"];
  if (mode === "continuous") return ["distribution", "summary", "relationship"];
  return [];
}

function primaryAnalysisOptions(question: Question | null, locale: Locale): PrimaryAnalysisOption[] {
  if (!question) return [];
  const options: PrimaryAnalysisOption[] = [];
  if (question.modes.includes("category")) {
    options.push({
      id: "distribution",
      mode: "category",
      operation: "distribution",
      label: bi(locale, "Response distribution", "回答分布"),
      description: bi(locale, "Counts and percentages for each response", "各選項的人數與百分比"),
    });
  }
  const summaryMode = question.modes.includes("continuous")
    ? "continuous"
    : question.modes.includes("order") ? "order" : null;
  if (summaryMode) {
    options.push({
      id: "summary",
      mode: summaryMode,
      operation: "summary",
      label: bi(locale, "Statistical summary", "統計摘要"),
      description: summaryMode === "continuous"
        ? bi(locale, "Mean, median, standard deviation, and quartiles", "平均值、中位數、標準差與四分位數")
        : bi(locale, "Median response and quartiles", "中位回答與四分位數"),
    });
  }
  return options;
}

export function questionMatchScore(question: Question, query: string): number {
  if (!query.trim()) return 1;
  return catalogMatch(question, query).score;
}

export function matchesQuestion(question: Question, query: string): boolean {
  return questionMatchScore(question, query) > 0;
}

export function needsSemanticCatalogSearch(query: string): boolean {
  return /[^\u0000-\u007f]/u.test(query.normalize("NFKC"));
}

export function commonAvailableWaves(
  contexts: { country_code: number; wave: number }[],
  countries: number[],
  waves: number[],
): number[] {
  return waves.filter((wave) =>
    countries.length
      ? countries.every((country) =>
        contexts.some((item) => item.country_code === country && item.wave === wave),
      )
      : contexts.some((item) => item.wave === wave),
  );
}

export function resultChartHeight(
  kind: AdaptiveChartKind,
  itemCount: number,
  seriesCount = 1,
): number {
  if (kind === "line") {
    return Math.max(360, 300 + Math.ceil(Math.max(seriesCount, 1) / 4) * 28);
  }
  if (kind === "bar") {
    return Math.max(300, Math.max(itemCount, 1) * 38 + 72);
  }
  if (kind === "distribution") {
    const legendRows = Math.ceil(Math.max(seriesCount, 1) / 4);
    return Math.max(280, Math.max(itemCount, 1) * 40 + 64)
      + Math.max(legendRows - 1, 0) * 24;
  }
  return 420;
}

export function conversationEnvelope(snapshot: ConversationSnapshot): AnalysisEnvelope {
  const view = snapshot.view;
  if (!view.rows.length) {
    return {
      draft: snapshot.draft,
      canonical_request: snapshot.canonical_request,
      result: snapshot.result,
      coverage: view.coverage,
      statistic: view.statistic,
    };
  }
  const distribution = ["distribution", "category_share"].includes(view.statistic);
  const rows: ResultRow[] = view.rows.map((row) => ({
    dimensions: row.dimensions,
    metric: row.metric,
    estimate: row.estimate,
    label: row.label,
    order_position: row.order_position,
    base_n: row.base_n,
    ...(distribution
      ? {
          category_label: row.label ?? undefined,
          unweighted_n: row.numerator_n ?? undefined,
          denominator: row.denominator_n ?? undefined,
          proportion: row.estimate,
        }
      : {}),
  }));
  return {
    draft: snapshot.draft,
    canonical_request: snapshot.canonical_request,
    result: {
      result_type: distribution
        ? snapshot.result.result_type === "multi_response"
          ? "multi_response"
          : "distribution"
        : "summary",
      metadata: view.metadata,
      rows,
      percentage_basis: snapshot.result.percentage_basis,
    },
    coverage: view.coverage,
    statistic: view.statistic,
  };
}

function formatNumber(value: unknown, digits = 2, locale: Locale = DEFAULT_LOCALE): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat(locale === "en" ? "en" : "zh-TW", {
    maximumFractionDigits: digits,
  }).format(value);
}

function denominatorLabel(value: string, locale: Locale): string {
  const fixed: Record<string, [string, string]> = {
    "included responses within each selected context": ["Included responses in each selected context", "各選定範圍內納入目前分析的回答"],
    "included responses within each selected group": ["Included responses in each selected group", "各組內納入目前分析的回答"],
    "row crosstab base": ["Valid paired responses within each row", "每個列回答內，兩題皆可用的回答"],
    "column crosstab base": ["Valid paired responses within each column", "每個欄回答內，兩題皆可用的回答"],
    "total crosstab base": ["All responses valid on both questions", "兩題皆可用的全部回答"],
    "respondents with both continuous scores included": ["Respondents with both scores available", "兩題皆有數值分數的回答"],
    "respondents with at least one included response-set value": ["Respondents with at least one valid response-set value", "至少一個回答順位含有效選項的受訪者"],
  };
  const member = value.match(/^respondents with an included value in response member (\d+)$/);
  if (member) {
    return bi(
      locale,
      `Respondents with a valid option in response position ${member[1]}`,
      `第 ${member[1]} 回答順位含有效題組選項的受訪者`,
    );
  }
  const label = fixed[value];
  return label ? bi(locale, label[0], label[1]) : bi(locale, "Valid responses for this analysis", "本次分析的有效回答");
}

function dimensionLabel(row: ResultRow, locale: Locale = DEFAULT_LOCALE): string {
  return row.dimensions?.map((item) => item.label).join(" · ")
    || bi(locale, "All respondents", "全部樣本");
}

function dimensionValue(row: ResultRow, kind: "country" | "wave"): string | null {
  return row.dimensions?.find((item) => item.kind === kind)?.label ?? null;
}

function contextKey(context: Pick<Context, "country_code" | "wave">): string {
  return `${context.country_code}:${context.wave}`;
}

function patchDraft(draft: Draft, changes: Partial<Draft>): Draft {
  const next = { ...draft, ...changes };
  const comparable = (value: Draft) => JSON.stringify({ ...value, revision: 0 });
  return comparable(draft) === comparable(next)
    ? draft
    : { ...next, revision: draft.revision + 1 };
}

function analysisRequestKey(draft: Draft): string {
  return JSON.stringify({
    target_kind: draft.target_kind,
    target_id: draft.target_id,
    mode: draft.mode,
    operation: draft.operation,
    countries: draft.countries,
    waves: draft.waves,
    grouping: draft.grouping,
    coverage_policy: draft.coverage_policy,
    weighted: draft.weighted,
    secondary_id: draft.secondary_id,
    secondary_mode: draft.secondary_mode,
    percentage_basis: draft.percentage_basis,
    response_scope: draft.response_scope,
    member_order: draft.member_order,
  });
}

function responseSetMatches(responseSet: ResponseSet, query: string): boolean {
  if (!query.trim()) return true;
  const haystack = `${responseSet.response_set_id} ${responseSet.label}`.toLowerCase();
  return query.toLowerCase().replace("多選", "").trim().split(/\s+/).every((term) => haystack.includes(term));
}

function validGroupingOptions(draft: Draft): Grouping[] {
  if (draft.operation === "relationship") return ["none"];
  if (draft.operation === "crosstab") return ["none", "country", "wave"];
  if (draft.operation === "summary") return ["none", "country", "wave", "country_wave", "survey_variable"];
  return ["none", "country", "wave", "country_wave"];
}

function needsSecondary(draft: Draft): boolean {
  return draft.operation === "crosstab"
    || draft.operation === "relationship"
    || (draft.operation === "summary" && draft.grouping === "survey_variable");
}

function secondaryModes(draft: Draft): Mode[] {
  if (draft.operation === "relationship") return ["continuous"];
  if (draft.operation === "crosstab") return ["category", "order"];
  return ["category", "order", "continuous"];
}

function contextSummary(draft: Draft, countries: Country[], locale: Locale): string {
  const countryLabels = draft.countries
    .map((code) => countries.find((country) => country.country_code === code)?.display_name ?? String(code))
    .join(locale === "en" ? ", " : "、");
  const waves = draft.waves.map((wave) => `W${wave}`).join(locale === "en" ? ", " : "、");
  return `${countryLabels || bi(locale, "No country selected", "未選國家")} · ${waves || bi(locale, "No wave selected", "未選波次")}`;
}

function compactContextSummary(draft: Draft, countries: Country[], locale: Locale): string {
  const country = draft.countries.length === 1
    ? countries.find((item) => item.country_code === draft.countries[0])?.display_name ?? String(draft.countries[0])
    : bi(locale, `${draft.countries.length} countries or territories`, `${draft.countries.length} 個國家或地區`);
  const wave = draft.waves.length === 1
    ? `W${draft.waves[0]}`
    : bi(locale, `${draft.waves.length} waves`, `${draft.waves.length} 個波次`);
  return `${country} · ${wave}`;
}

export function analysisContract(
  draft: Draft,
  bootstrap: Bootstrap,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const target = bootstrap.questions.find((question) => question.variable_id === draft.target_id);
  const responseSet = bootstrap.response_sets.find((item) => item.response_set_id === draft.target_id);
  const subject = target
    ? `${target.variable_id} "${target.question_text}"`
    : responseSet?.label ?? bi(locale, "No variable selected", "未選變量");
  const interpretation = draft.target_kind === "response_set"
    ? (draft.response_scope === "any_member"
      ? bi(locale, "Selection rate in any response position", "任一回答順位選擇率")
      : bi(locale, `Selection rate in response position ${draft.member_order ?? "?"}`, `第 ${draft.member_order ?? "?"} 回答順位選擇率`))
    : draft.mode
      ? MODE_LABELS[locale][draft.mode]
      : bi(locale, "No interpretation selected", "未選擇分析設定");
  const operation = draft.operation
    ? OPERATION_LABELS[locale][draft.operation]
    : bi(locale, "No analysis selected", "未選擇分析");
  const grouping = GROUPING_LABELS[locale][draft.grouping];
  const secondary = needsSecondary(draft) && draft.secondary_id
    ? bootstrap.questions.find((question) => question.variable_id === draft.secondary_id)
    : null;
  const secondaryClause = secondary
    ? bi(
      locale,
      `; the second variable is ${secondary.variable_id} "${secondary.question_text}" (${draft.secondary_mode ? MODE_LABELS[locale][draft.secondary_mode] : "no interpretation selected"})`,
      `，第二變量為 ${secondary.variable_id}「${secondary.question_text}」（${draft.secondary_mode ? MODE_LABELS[locale][draft.secondary_mode] : "未選擇分析設定"}）`,
    )
    : "";
  return bi(
    locale,
    `${subject}; ${operation} using ${interpretation}${secondaryClause}; scope: ${contextSummary(draft, bootstrap.countries, locale)}; ${grouping}.`,
    `${subject}；以「${interpretation}」進行「${operation}」${secondaryClause}；資料範圍為 ${contextSummary(draft, bootstrap.countries, locale)}，${grouping}。`,
  );
}

function App() {
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof window === "undefined") return DEFAULT_LOCALE;
    const stored = window.localStorage.getItem("abs-public-locale");
    return stored === "zh-Hant" ? "zh-Hant" : DEFAULT_LOCALE;
  });
  const [fontSize, setFontSize] = useState<FontSize>(() => {
    if (typeof window === "undefined") return "standard";
    const stored = window.localStorage.getItem("abs-public-font-size");
    return stored === "small" || stored === "large" ? stored : "standard";
  });
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [draft, commitDraftState] = useState<Draft>(EMPTY_DRAFT);
  const [detail, setDetail] = useState<QuestionDetail | null>(null);
  const [responseSetDetail, setResponseSetDetail] = useState<ResponseSetDetail | null>(null);
  const [secondaryDetail, setSecondaryDetail] = useState<QuestionDetail | null>(null);
  const [result, setResult] = useState<AnalysisEnvelope | null>(null);
  const [resultDetails, setResultDetails] = useState<ResultDetails>({ primary: null, secondary: null });
  const [resultTab, setResultTab] = useState<ResultTab>("chart");
  const [catalogKind, setCatalogKind] = useState<CatalogKind>("questions");
  const [query, setQuery] = useState("");
  const [semanticSearchQuery, setSemanticSearchQuery] = useState("");
  const [semanticQuestionIds, setSemanticQuestionIds] = useState<string[] | null>(null);
  const [semanticSearchBusy, setSemanticSearchBusy] = useState(false);
  const [semanticSearchError, setSemanticSearchError] = useState<string | null>(null);
  const [topicFilter, setTopicFilter] = useState("all");
  const [secondaryQuery, setSecondaryQuery] = useState("");
  const [comparisonChosen, setComparisonChosen] = useState(false);
  const [groupingManual, setGroupingManual] = useState(false);
  const [basisChosen, setBasisChosen] = useState(true);
  const [showScale, setShowScale] = useState(false);
  const [showMissingContexts, setShowMissingContexts] = useState(false);
  const [surface, setSurface] = useState<WorkspaceSurface>(() => {
    if (typeof window === "undefined") return "conversation";
    const requested = new URLSearchParams(window.location.search).get("view");
    return requested === "workbench" ? "workbench" : "conversation";
  });
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantPhase, setAssistantPhase] = useState<AssistantPhase>("idle");
  const [showAssistantProgress, setShowAssistantProgress] = useState(false);
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null);
  const [assistantQueued, setAssistantQueued] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationResponse | null>(null);
  const [candidateVisibleCount, setCandidateVisibleCount] = useState(10);
  const [openSuggestionEditor, setOpenSuggestionEditor] = useState<string | null>(null);
  const [suggestionValues, setSuggestionValues] = useState<string[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [journalNotice, setJournalNotice] = useState<string | null>(null);
  const detailCache = useRef(new Map<string, QuestionDetail>());
  const selectionSequence = useRef(0);
  const draftRef = useRef(draft);
  const conversationSnapshotRef = useRef<string | null>(null);
  const assistantComposingRef = useRef(false);
  const journalCounter = useRef(0);
  const journalHashes = useRef(new Set<string>());
  const lastFailedAction = useRef<(() => void) | null>(null);
  const semanticSearchSequence = useRef(0);
  const semanticSearchCache = useRef(new Map<string, string[]>());
  const analysisSequence = useRef(0);
  const lastAutomaticAnalysisKey = useRef<string | null>(null);

  function setDraft(update: Draft | ((current: Draft) => Draft)): void {
    const current = draftRef.current;
    const next = typeof update === "function" ? update(current) : update;
    if (next === current) return;
    draftRef.current = next;
    analysisSequence.current += 1;
    setRunning(false);
    commitDraftState(next);
  }

  useEffect(() => {
    document.documentElement.lang = locale === "en" ? "en" : "zh-Hant";
    document.title = bi(locale, "Asian Barometer Survey Explorer", "亞洲民主動態調查分析");
    window.localStorage.setItem("abs-public-locale", locale);
  }, [locale]);

  useEffect(() => {
    window.localStorage.setItem("abs-public-font-size", fontSize);
  }, [fontSize]);

  useEffect(() => {
    setOpenSuggestionEditor(null);
    setSuggestionValues([]);
  }, [conversation?.revision]);

  useEffect(() => {
    setCandidateVisibleCount(10);
  }, [conversation?.pending?.pending_id]);

  useEffect(() => {
    if (!assistantBusy) {
      setShowAssistantProgress(false);
      return;
    }
    const timer = window.setTimeout(() => setShowAssistantProgress(true), 250);
    return () => window.clearTimeout(timer);
  }, [assistantBusy]);

  useEffect(() => {
    api.bootstrap()
      .then((data) => {
        setBootstrap(data);
        api.assistantStatus()
          .then((assistant) => setBootstrap((current) => current ? { ...current, assistant } : current))
          .catch(() => undefined);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
    api.createConversation()
      .then(setConversation)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const search = query.trim();
    const sequence = ++semanticSearchSequence.current;
    if (
      catalogKind !== "questions"
      || !search
      || !needsSemanticCatalogSearch(search)
    ) {
      setSemanticSearchQuery("");
      setSemanticQuestionIds(null);
      setSemanticSearchBusy(false);
      setSemanticSearchError(null);
      return;
    }
    const cached = semanticSearchCache.current.get(search);
    if (cached) {
      setSemanticSearchQuery(search);
      setSemanticQuestionIds(cached);
      setSemanticSearchBusy(false);
      setSemanticSearchError(null);
      return;
    }
    setSemanticSearchQuery(search);
    setSemanticQuestionIds(null);
    setSemanticSearchBusy(true);
    setSemanticSearchError(null);
    const timer = window.setTimeout(() => {
      api.catalogSearch(search)
        .then((response) => {
          if (semanticSearchSequence.current !== sequence) return;
          const ids = response.questions.map((question) => question.variable_id);
          semanticSearchCache.current.set(search, ids);
          setSemanticQuestionIds(ids);
        })
        .catch(() => {
          if (semanticSearchSequence.current !== sequence) return;
          setSemanticSearchError(bi(locale, "Semantic search is temporarily unavailable", "語意搜尋暫時無法使用"));
          setSemanticQuestionIds([]);
        })
        .finally(() => {
          if (semanticSearchSequence.current === sequence) setSemanticSearchBusy(false);
        });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [catalogKind, query, locale]);

  async function loadQuestion(id: string): Promise<QuestionDetail> {
    const cached = detailCache.current.get(id);
    if (cached) return cached;
    const loaded = await api.question(id);
    detailCache.current.set(id, loaded);
    return loaded;
  }

  const questions = useMemo(() => {
    if (!bootstrap) return [];
    const search = query.trim();
    if (
      search
      && needsSemanticCatalogSearch(search)
      && semanticSearchQuery === search
    ) {
      if (semanticQuestionIds === null) return [];
      const rank = new Map(semanticQuestionIds.map((id, index) => [id, index]));
      return bootstrap.questions
        .filter((question) =>
          rank.has(question.variable_id)
          && (topicFilter === "all" || question.topic_id === topicFilter),
        )
        .sort((left, right) =>
          (rank.get(left.variable_id) ?? Number.MAX_SAFE_INTEGER)
          - (rank.get(right.variable_id) ?? Number.MAX_SAFE_INTEGER),
        );
    }
    return bootstrap.questions
      .map((question, position) => ({
        question,
        position,
        score: questionMatchScore(question, query),
      }))
      .filter(({ question, score }) =>
        score > 0
        && (topicFilter === "all" || question.topic_id === topicFilter),
      )
      .sort((left, right) =>
        search
          ? right.score - left.score || left.position - right.position
          : left.position - right.position,
      )
      .map(({ question }) => question);
  }, [
    bootstrap,
    query,
    semanticQuestionIds,
    semanticSearchQuery,
    topicFilter,
  ]);

  const responseSets = useMemo(
    () => bootstrap?.response_sets.filter((item) =>
      responseSetMatches(item, query)
      && (topicFilter === "all" || item.topic_id === topicFilter),
    ) ?? [],
    [bootstrap, query, topicFilter],
  );

  const selectedQuestion = bootstrap?.questions.find((question) => question.variable_id === draft.target_id) ?? null;
  const selectedResponseSet = bootstrap?.response_sets.find((item) => item.response_set_id === draft.target_id) ?? null;

  useEffect(() => {
    if (
      groupingManual
      || needsSecondary(draft)
      || !draft.countries.length
      || !draft.waves.length
    ) {
      return;
    }
    const inferred: Grouping = draft.countries.length > 1 && draft.waves.length > 1
      ? "country_wave"
      : draft.countries.length > 1
        ? "country"
        : draft.waves.length > 1 ? "wave" : "none";
    setComparisonChosen(true);
    if (draft.grouping !== inferred) {
      setDraft((current) => patchDraft(current, { grouping: inferred }));
    }
  }, [
    draft.operation,
    draft.countries.length,
    draft.waves.length,
    draft.grouping,
    groupingManual,
  ]);

  async function selectQuestion(question: Question): Promise<void> {
    const sequence = ++selectionSequence.current;
    setError(null);
    setDetail(detailCache.current.get(question.variable_id) ?? null);
    setResponseSetDetail(null);
    setSecondaryDetail(null);
    setShowScale(false);
    setShowMissingContexts(false);
    setComparisonChosen(false);
    setGroupingManual(false);
    setBasisChosen(true);
    setDraft({
      ...EMPTY_DRAFT,
      target_id: question.variable_id,
      revision: draftRef.current.revision + 1,
    });
    setResult(null);
    try {
      const loaded = await loadQuestion(question.variable_id);
      if (sequence !== selectionSequence.current) return;
      setDetail(loaded);
    } catch (reason) {
      if (sequence === selectionSequence.current) {
        setError(reason instanceof Error ? reason.message : bi(locale, "Unable to load the question.", "無法載入題目"));
      }
    }
  }

  async function selectResponseSet(responseSet: ResponseSet): Promise<void> {
    const sequence = ++selectionSequence.current;
    setError(null);
    setResponseSetDetail(null);
    setDetail(null);
    setSecondaryDetail(null);
    setShowMissingContexts(false);
    setComparisonChosen(true);
    setGroupingManual(false);
    setBasisChosen(true);
    setDraft({
      ...EMPTY_DRAFT,
      target_kind: "response_set",
      target_id: responseSet.response_set_id,
      operation: "multi_response",
      revision: draftRef.current.revision + 1,
    });
    setResult(null);
    try {
      const loaded = await api.responseSet(responseSet.response_set_id);
      if (sequence !== selectionSequence.current) return;
      setResponseSetDetail(loaded);
    } catch (reason) {
      if (sequence === selectionSequence.current) {
        setError(reason instanceof Error ? reason.message : bi(locale, "Unable to load the multiple-response set.", "無法載入多選題組"));
      }
    }
  }

  function chooseMode(mode: Mode): void {
    setComparisonChosen(false);
    setBasisChosen(true);
    setSecondaryDetail(null);
    setDraft((current) => patchDraft(current, {
      mode,
      operation: null,
      grouping: "none",
      secondary_id: null,
      secondary_mode: null,
      origin: "manual",
    }));
  }

  function choosePrimaryAnalysis(option: PrimaryAnalysisOption): void {
    setComparisonChosen(true);
    setBasisChosen(true);
    setSecondaryDetail(null);
    setResult(null);
    setDraft((current) => patchDraft(current, {
      mode: option.mode,
      operation: option.operation,
      secondary_id: null,
      secondary_mode: null,
      weighted: false,
      origin: "manual",
    }));
  }

  function chooseOperation(operation: Operation): void {
    const forcedComparison = operation === "relationship";
    setComparisonChosen(forcedComparison);
    setBasisChosen(operation !== "crosstab");
    setSecondaryDetail(null);
    setDraft((current) => patchDraft(current, {
      operation,
      grouping: "none",
      secondary_id: null,
      secondary_mode: null,
      percentage_basis: "row",
      origin: "manual",
    }));
  }

  function chooseGrouping(grouping: Grouping): void {
    setComparisonChosen(true);
    setGroupingManual(true);
    setDraft((current) => patchDraft(current, {
      grouping,
      secondary_id: grouping === "survey_variable" ? current.secondary_id : (
        current.operation === "crosstab" || current.operation === "relationship"
          ? current.secondary_id
          : null
      ),
      secondary_mode: grouping === "survey_variable" ? current.secondary_mode : (
        current.operation === "crosstab" || current.operation === "relationship"
          ? current.secondary_mode
          : null
      ),
      origin: "manual",
    }));
  }

  function chooseResponsePosition(
    responseScope: Draft["response_scope"],
    memberOrder: number | null,
  ): void {
    setDraft((current) => patchDraft(current, {
      response_scope: responseScope,
      member_order: responseScope === "specific_member" ? memberOrder ?? 1 : null,
      origin: "manual",
    }));
  }

  async function chooseSecondary(question: Question): Promise<void> {
    try {
      const loaded = await loadQuestion(question.variable_id);
      const allowed = secondaryModes(draftRef.current).filter((mode) => question.modes.includes(mode));
      const mode = draftRef.current.operation === "relationship"
        ? "continuous"
        : allowed.length === 1 ? allowed[0] : null;
      setSecondaryDetail(loaded);
      setDraft((current) => patchDraft(current, {
        secondary_id: question.variable_id,
        secondary_mode: mode,
        origin: "manual",
      }));
      setSecondaryQuery("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : bi(locale, "Unable to load the second question.", "無法載入第二題"));
    }
  }

  const primaryContexts = useMemo(() => {
    if (draft.target_kind === "response_set" && responseSetDetail) {
      return draft.response_scope === "specific_member" && draft.member_order
        ? responseSetDetail.member_contexts[String(draft.member_order)] ?? []
        : responseSetDetail.contexts;
    }
    if (!detail) return [];
    return draft.mode ? detail.contexts[draft.mode] ?? [] : detail.base_contexts;
  }, [draft.target_kind, draft.response_scope, draft.member_order, draft.mode, detail, responseSetDetail]);

  const commonContexts = useMemo(() => {
    if (!needsSecondary(draft) || !secondaryDetail || !draft.secondary_mode) return primaryContexts;
    const secondary = secondaryDetail.contexts[draft.secondary_mode] ?? [];
    const secondaryKeys = new Set(secondary.map(contextKey));
    return primaryContexts.filter((context) => secondaryKeys.has(contextKey(context)));
  }, [draft, primaryContexts, secondaryDetail]);

  const availableCountries = useMemo(() => {
    if (!bootstrap) return [];
    return bootstrap.countries;
  }, [bootstrap]);

  const compatibleCountryCodes = useMemo(() => new Set(
    availableCountries
      .filter((country) => draft.waves.length
        ? draft.waves.every((wave) => commonContexts.some((context) => context.country_code === country.country_code && context.wave === wave))
        : commonContexts.some((context) => context.country_code === country.country_code))
      .map((country) => country.country_code),
  ), [availableCountries, commonContexts, draft.waves]);

  const selectableCountryCodes = useMemo(
    () => availableCountries.map((country) => country.country_code).sort((a, b) => a - b),
    [availableCountries],
  );

  const availableWaves = useMemo(() => {
    if (!bootstrap) return [];
    return commonAvailableWaves(commonContexts, draft.countries, bootstrap.waves);
  }, [bootstrap, commonContexts, draft.countries]);

  const selectableWaves = useMemo(
    () => bootstrap?.waves ?? [],
    [bootstrap],
  );

  const missingContexts = useMemo(
    () => missingScopeCells(commonContexts, draft.countries, draft.waves),
    [commonContexts, draft.countries, draft.waves],
  );
  const availableContextCount = Math.max(
    draft.countries.length * draft.waves.length - missingContexts.length,
    0,
  );
  const missingContextLabels = useMemo(() => {
    if (!bootstrap) return [];
    return missingContexts.map(({ country, wave }) => {
      const name = bootstrap.countries.find(
        (item) => item.country_code === country,
      )?.display_name ?? String(country);
      return `${name} W${wave}`;
    });
  }, [bootstrap, missingContexts]);

  const readinessIssues = useMemo(() => {
    const issues: string[] = [];
    if (!draft.target_id) issues.push(bi(locale, "Choose a question or response set.", "請先選擇題目或多選題組。"));
    if (draft.target_kind === "question" && (!draft.mode || !draft.operation)) issues.push(bi(locale, "Choose an analysis.", "請選擇分析內容。"));
    if (draft.target_kind === "response_set" && !draft.operation) issues.push(bi(locale, "Choose an analysis.", "請選擇分析內容。"));
    if (needsSecondary(draft) && !draft.secondary_id) issues.push(bi(locale, "Choose a second question.", "請選擇第二個題目。"));
    if (needsSecondary(draft) && draft.secondary_id && !draft.secondary_mode) issues.push(bi(locale, "Choose how to interpret the second question.", "請選擇第二題的分析設定。"));
    if (!draft.countries.length) issues.push(bi(locale, "Choose at least one country or territory.", "請至少選擇一個國家或地區。"));
    if (!draft.waves.length) issues.push(bi(locale, "Choose at least one survey wave.", "請至少選擇一個調查波次。"));
    if (!comparisonChosen && draft.operation) issues.push(bi(locale, "Choose how to split the result.", "請選擇結果拆分方式。"));
    if (draft.operation === "crosstab" && !basisChosen) issues.push(bi(locale, "Choose a percentage base for the crosstab.", "請選擇交叉表的百分比分母。"));
    if (draft.grouping === "country" && draft.countries.length < 2) issues.push(bi(locale, "Country grouping requires at least two countries.", "依國家拆分至少需要兩個國家。"));
    if (draft.grouping === "wave" && draft.waves.length < 2) issues.push(bi(locale, "Wave grouping requires at least two waves.", "依波次拆分至少需要兩個波次。"));
    if (draft.grouping === "country_wave" && draft.countries.length < 2 && draft.waves.length < 2) {
      issues.push(bi(locale, "Country × wave requires at least two comparable contexts.", "國家 × 波次至少需要兩個可比較情境。"));
    }
    if (
      draft.countries.length
      && draft.waves.length
      && availableContextCount === 0
    ) {
      issues.push(bi(locale, "The selected country-wave scope has no analyzable data.", "所選國家與波次沒有可計算資料。"));
    }
    if (draft.response_scope === "specific_member" && !draft.member_order) issues.push(bi(locale, "Choose a response position.", "請選擇回答順位。"));
    return issues;
  }, [draft, comparisonChosen, basisChosen, availableContextCount, locale]);
  const analysisKey = useMemo(() => analysisRequestKey(draft), [draft]);

  const secondaryOptions = useMemo(() => {
    if (!bootstrap || !needsSecondary(draft)) return [];
    const allowed = secondaryModes(draft);
    return bootstrap.questions
      .filter((question) => question.variable_id !== draft.target_id)
      .filter((question) => allowed.some((mode) => question.modes.includes(mode)))
      .filter((question) => matchesQuestion(question, secondaryQuery))
      .slice(0, secondaryQuery.trim() ? 30 : 12);
  }, [bootstrap, draft, secondaryQuery]);

  function recordJournalEntry(
    envelope: AnalysisEnvelope,
    origin: JournalOrigin,
    statistic: string,
  ): void {
    const hash = envelope.result.metadata.request_hash;
    if (journalHashes.current.has(hash)) {
      setJournalNotice("duplicate");
      return;
    }
    journalHashes.current.add(hash);
    setJournalNotice(null);
    journalCounter.current += 1;
    setJournal((current) => [
      ...current,
      { number: journalCounter.current, origin, envelope, statistic },
    ]);
  }

  async function restoreJournalEntry(entry: JournalEntry): Promise<void> {
    setError(null);
    setShowMissingContexts(false);
    chooseSurface("workbench");
    setResultTab("chart");
    setComparisonChosen(true);
    setGroupingManual(true);
    const targetId = entry.envelope.draft.target_id;
    if (entry.envelope.draft.target_kind === "response_set" && targetId) {
      const loaded = await api.responseSet(targetId).catch(() => null);
      setResponseSetDetail(loaded);
      setDetail(null);
      setResultDetails({ primary: null, secondary: null });
    } else {
      const primary = targetId ? await loadQuestion(targetId).catch(() => null) : null;
      setDetail(primary);
      setResponseSetDetail(null);
      setResultDetails({ primary, secondary: null });
    }
    setSecondaryDetail(null);
    lastAutomaticAnalysisKey.current = analysisRequestKey(entry.envelope.draft);
    setDraft(entry.envelope.draft);
    setResult(entry.envelope);
  }

  async function runAnalysis(expectedKey = analysisRequestKey(draftRef.current)): Promise<void> {
    if (readinessIssues.length) return;
    const requestDraft = draftRef.current;
    const requestSequence = ++analysisSequence.current;
    setRunning(true);
    setError(null);
    try {
      const envelope = await api.analyze(requestDraft);
      if (
        requestSequence !== analysisSequence.current
        || analysisRequestKey(draftRef.current) !== expectedKey
      ) return;
      lastAutomaticAnalysisKey.current = expectedKey;
      setResult(envelope);
      setResultDetails({ primary: detail, secondary: secondaryDetail });
      recordJournalEntry(envelope, "workbench", OPERATION_LABELS[locale][envelope.result.result_type]);
    } catch (reason) {
      if (requestSequence !== analysisSequence.current) return;
      lastFailedAction.current = () => runAnalysis(expectedKey);
      setError(reason instanceof Error ? reason.message : bi(locale, "Analysis failed.", "分析失敗"));
    } finally {
      if (requestSequence === analysisSequence.current) setRunning(false);
    }
  }

  useEffect(() => {
    if (
      surface !== "workbench"
      || readinessIssues.length
      || lastAutomaticAnalysisKey.current === analysisKey
    ) return;
    const timer = window.setTimeout(() => {
      if (
        lastAutomaticAnalysisKey.current === analysisKey
        || analysisRequestKey(draftRef.current) !== analysisKey
      ) return;
      void runAnalysis(analysisKey);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [analysisKey, readinessIssues.length, surface]);

  async function applyConversationSnapshot(snapshot: ConversationSnapshot | null): Promise<void> {
    if (!snapshot || conversationSnapshotRef.current === snapshot.snapshot_id) return;
    setShowMissingContexts(false);
    conversationSnapshotRef.current = snapshot.snapshot_id;
    const primary = snapshot.draft.target_id
      ? await loadQuestion(snapshot.draft.target_id)
      : null;
    setDetail(primary);
    setResponseSetDetail(null);
    setSecondaryDetail(null);
    setComparisonChosen(true);
    setGroupingManual(true);
    lastAutomaticAnalysisKey.current = analysisRequestKey(snapshot.draft);
    setDraft(snapshot.draft);
    setResult(conversationEnvelope(snapshot));
    setResultDetails({ primary, secondary: null });
    setResultTab("chart");
  }

  async function applyConversationResponse(response: ConversationResponse): Promise<void> {
    setConversation(response);
    const isNewSnapshot = Boolean(
      response.active_snapshot
      && conversationSnapshotRef.current !== response.active_snapshot.snapshot_id,
    );
    await applyConversationSnapshot(response.active_snapshot);
    const snapshot = response.active_snapshot;
    if (snapshot && isNewSnapshot) {
      recordJournalEntry(
        conversationEnvelope(snapshot),
        "conversation",
        STATISTIC_LABELS[locale][snapshot.view.statistic] ?? bi(locale, "Analysis", "分析"),
      );
    }
  }

  async function submitAssistantPrompt(prompt: string): Promise<void> {
    const message = prompt.trim();
    if (!message || assistantBusy) return;
    setAssistantInput("");
    setAssistantQueued(message);
    setAssistantBusy(true);
    setAssistantPhase("submitting");
    setError(null);
    try {
      let active = conversation;
      if (!active) {
        active = await api.createConversation();
        setConversation(active);
      }
      setAssistantPhase("interpreting");
      const response = await api.sendConversationMessage(
        active.conversation_id,
        message,
        active.revision,
      );
      setAssistantPhase("rendering");
      await applyConversationResponse(response);
    } catch (reason) {
      lastFailedAction.current = () => submitAssistantPrompt(message);
      setError(reason instanceof Error ? reason.message : "分析助理暫時無法回應");
    } finally {
      setAssistantQueued(null);
      setAssistantBusy(false);
      setAssistantPhase("idle");
    }
  }

  async function submitAssistantCommand(
    command: ConversationCommand,
    label: string,
    expectedRevision?: number,
  ): Promise<void> {
    if (!conversation || assistantBusy) return;
    setAssistantQueued(label);
    setAssistantBusy(true);
    setAssistantPhase("updating");
    setError(null);
    try {
      const response = await api.sendConversationCommand(
        conversation.conversation_id,
        command,
        expectedRevision ?? conversation.revision,
        label,
      );
      setAssistantPhase("rendering");
      await applyConversationResponse(response);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "分析助理暫時無法回應");
    } finally {
      setAssistantQueued(null);
      setAssistantBusy(false);
      setAssistantPhase("idle");
    }
  }

  function activateSuggestion(suggestion: ConversationSuggestion): void {
    if (suggestion.control === "command") {
      void submitAssistantCommand(
        suggestion.command,
        localizeSuggestionLabel(locale, suggestion.label),
        suggestion.based_on_revision,
      );
      return;
    }
    if (openSuggestionEditor === suggestion.action_id) {
      setOpenSuggestionEditor(null);
      setSuggestionValues([]);
      return;
    }
    setOpenSuggestionEditor(suggestion.action_id);
    setSuggestionValues(
      suggestion.choices
        .filter((choice) => choice.selected)
        .map((choice) => choice.value),
    );
  }

  function toggleSuggestionValue(value: string): void {
    setSuggestionValues((current) => (
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    ));
  }

  function toggleAllSuggestionValues(suggestion: ConversationSuggestion): void {
    const available = suggestion.choices
      .filter((choice) => choice.available !== false)
      .map((choice) => choice.value);
    setSuggestionValues((current) => (
      available.length && available.every((value) => current.includes(value))
        ? []
        : available
    ));
  }

  async function applySuggestionSelection(
    suggestion: ConversationSuggestion,
  ): Promise<void> {
    const selected = suggestion.choices
      .filter((choice) => (
        choice.available !== false
        && suggestionValues.includes(choice.value)
      ))
      .map((choice) => choice.value);
    if (!selected.length) return;
    setOpenSuggestionEditor(null);
    setSuggestionValues([]);
    if (suggestion.control === "country_multiselect") {
      await submitAssistantCommand(
        {
          kind: "modify_countries",
          operation: "set",
          values: selected,
        },
        bi(
          locale,
          `Update countries: ${selected.join(", ")}`,
          `更新國家範圍：${selected.join("、")}`,
        ),
        suggestion.based_on_revision,
      );
      return;
    }
    await submitAssistantCommand(
      {
        kind: "modify_waves",
        operation: "set",
        selector: "explicit",
        values: selected.map(Number),
      },
      bi(
        locale,
        `Update waves: ${selected.map((value) => `W${value}`).join(", ")}`,
        `更新波次範圍：${selected.map((value) => `W${value}`).join("、")}`,
      ),
      suggestion.based_on_revision,
    );
  }

  async function submitClarificationOption(option: ConversationOption): Promise<void> {
    if (!conversation?.pending) return;
    const displayLabel = conversation.pending.kind === "question"
      ? cleanMarkdown(option.label)
      : localizeOptionLabel(locale, option.label);
    setPendingOptionId(option.option_id);
    try {
      await submitAssistantCommand(
        {
          kind: "select_pending_option",
          pending_id: conversation.pending.pending_id,
          option_id: option.option_id,
        },
        displayLabel,
      );
    } finally {
      setPendingOptionId(null);
    }
  }

  async function sendAssistant(event: FormEvent): Promise<void> {
    event.preventDefault();
    await submitAssistantPrompt(assistantInput);
  }

  async function handleAssistantKeyDown(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ): Promise<void> {
    if (event.key !== "Enter") return;
    if (event.ctrlKey || event.shiftKey || event.metaKey || event.altKey) return;
    const nativeEvent = event.nativeEvent as KeyboardEvent;
    if (
      assistantComposingRef.current
      || nativeEvent.isComposing
      || nativeEvent.keyCode === 229
    ) {
      return;
    }
    event.preventDefault();
    await submitAssistantPrompt(assistantInput);
  }

  function chooseSurface(next: WorkspaceSurface): void {
    setSurface(next);
    const url = new URL(window.location.href);
    if (next === "conversation") {
      url.searchParams.delete("view");
    } else {
      url.searchParams.set("view", next);
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  async function beginNewQuestion(): Promise<void> {
    if (!conversation || assistantBusy) return;
    try {
      const response = await api.startNewQuestion(conversation.conversation_id);
      setConversation(response);
      conversationSnapshotRef.current = null;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : bi(locale, "Unable to start a new question.", "無法開始新問題"));
    }
  }

  async function beginNewConversation(): Promise<void> {
    if (assistantBusy) return;
    try {
      const response = await api.createConversation();
      setConversation(response);
      conversationSnapshotRef.current = null;
      setResult(null);
      setAssistantInput("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : bi(locale, "Unable to start a new conversation.", "無法開始新對話"));
    }
  }

  const analysisOptions = primaryAnalysisOptions(selectedQuestion, locale);
  const displayGroupingOptions: Grouping[] = [
    "none",
    ...(draft.countries.length > 1 ? ["country" as const] : []),
    ...(draft.waves.length > 1 ? ["wave" as const] : []),
    ...(draft.countries.length > 1 && draft.waves.length > 1
      ? ["country_wave" as const]
      : []),
  ];
  const assistantPhaseCopy: Record<AssistantPhase, { title: string; detail: string }> = {
    idle: { title: "", detail: "" },
    submitting: {
      title: bi(locale, "Sending your request", "正在送出問題"),
      detail: bi(locale, "Keeping the current settings and result", "保留目前設定與結果"),
    },
    interpreting: {
      title: bi(locale, "Interpreting the request and checking questions", "正在理解需求並確認題目"),
      detail: bi(locale, "Scope and statistics will be verified against the survey data", "資料範圍與統計數字將由資料庫驗證"),
    },
    updating: {
      title: bi(locale, "Updating the analysis settings", "正在更新分析設定"),
      detail: bi(locale, "Applying your selection", "正在套用你的選擇"),
    },
    rendering: {
      title: bi(locale, "Preparing the result", "正在整理結果"),
      detail: bi(locale, "The calculation is complete; updating the chart and data", "計算已完成，正在更新圖表與資料表"),
    },
  };
  const currentSuggestions = conversation?.suggestions
    .filter((suggestion) => suggestion.based_on_revision === conversation.revision)
    ?? [];
  const lastConversationTurn = conversation?.turns[conversation.turns.length - 1] ?? null;
  const atNewQuestionBoundary = (
    lastConversationTurn?.kind === "flow_boundary"
    && !conversation?.pending
    && !conversation?.active_snapshot
  );
  const activeScopeSuggestion = currentSuggestions.find(
    (suggestion) => (
      suggestion.action_id === openSuggestionEditor
      && suggestion.control !== "command"
    ),
  ) ?? null;
  const initialSuggestionValues = activeScopeSuggestion?.choices
    .filter((choice) => choice.selected)
    .map((choice) => choice.value) ?? [];
  const availableSuggestionValues = activeScopeSuggestion?.choices
    .filter((choice) => choice.available !== false)
    .map((choice) => choice.value) ?? [];
  const allSuggestionValuesSelected = (
    availableSuggestionValues.length > 0
    && availableSuggestionValues.every((value) => suggestionValues.includes(value))
  );
  const suggestionSelectionChanged = (
    [...suggestionValues].sort().join("\u0000")
    !== [...initialSuggestionValues].sort().join("\u0000")
  );

  if (loading) {
    return <div className="app-loading"><LoaderCircle className="spin" />{bi(locale, "Loading questions and analysis settings…", "正在載入題庫與分析設定…")}</div>;
  }
  if (!bootstrap) {
    return <div className="app-loading error-state">{bi(locale, "Unable to load the workspace.", "無法載入工作區。")}</div>;
  }

  return (
    <div
      className={`app-shell surface-${surface}`}
      data-font-size={fontSize}
    >
      <header className="topbar">
        <div className="brand-lockup"><span className="brand-mark"><BarChart3 size={19} /></span><div><strong>{bi(locale, "Asian Barometer Survey Explorer", "亞洲民主動態調查分析")}</strong><small>{bi(locale, "Conversation and workspace share the same verified result", "對話查詢與完整分析共用同一份結果")}</small></div></div>
        <nav className="surface-switch" aria-label={bi(locale, "Workspace mode", "工作模式")}>
          <button className={surface === "conversation" ? "active" : ""} onClick={() => chooseSurface("conversation")}>{bi(locale, "Conversation", "對話分析")}</button>
          <button className={surface === "workbench" ? "active" : ""} onClick={() => chooseSurface("workbench")}>{bi(locale, "Workspace", "分析工作台")}</button>
        </nav>
        <div className="public-controls">
          <div className="language-control" role="group" aria-label={bi(locale, "Language", "語言")}>
            <button className={locale === "en" ? "active" : ""} onClick={() => setLocale("en")}>EN</button>
            <button className={locale === "zh-Hant" ? "active" : ""} onClick={() => setLocale("zh-Hant")}>中文</button>
          </div>
          <div className="font-control" role="group" aria-label={bi(locale, "Text size", "字體大小")}>
            {(["small", "standard", "large"] as const).map((size, index) => (
              <button
                key={size}
                className={fontSize === size ? "active" : ""}
                aria-label={bi(
                  locale,
                  `${["Small", "Standard", "Large"][index]} text`,
                  `${["小", "標準", "大"][index]}字體`,
                )}
                title={bi(
                  locale,
                  `${["Small", "Standard", "Large"][index]} text`,
                  `${["小", "標準", "大"][index]}字體`,
                )}
                onClick={() => setFontSize(size)}
              >
                <span aria-hidden="true">{["A−", "A", "A+"][index]}</span>
              </button>
            ))}
          </div>
        </div>
      </header>

      {surface === "workbench" && <aside className="library-panel">
        <div className="panel-title"><span>{bi(locale, "Question library", "題庫")}</span><strong>{bi(locale, "Choose a survey question", "選擇分析題目")}</strong></div>
        <div className="catalog-tabs">
          <button className={catalogKind === "questions" ? "active" : ""} onClick={() => { setCatalogKind("questions"); setQuery(""); }}>{bi(locale, "Questions", "單題")}</button>
          <button className={catalogKind === "response_sets" ? "active" : ""} onClick={() => { setCatalogKind("response_sets"); setQuery(""); }}>{bi(locale, "Response sets", "多選題組")}</button>
        </div>
        <label className="search-box">{semanticSearchBusy ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />}<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={bi(locale, "Search questions or topics", "搜尋題號、題目或主題")} />{query && <button aria-label={bi(locale, "Clear search", "清除搜尋")} title={bi(locale, "Clear search", "清除搜尋")} onClick={() => setQuery("")}><X size={14} /></button>}</label>
        <label className="topic-filter">
          <ListFilter size={15} />
          <span>{bi(locale, "Topic", "主題")}</span>
          <select aria-label={bi(locale, "Research topic", "研究主題")} value={topicFilter} onChange={(event) => setTopicFilter(event.target.value)}>
            <option value="all">{bi(locale, "All topics", "全部主題")}</option>
            {bootstrap.topics.map((topic) => <option key={topic.topic_id} value={topic.topic_id}>{topicLabel(locale, topic.topic_id, topic.label)} · {topic.question_count}</option>)}
          </select>
        </label>
        <div className="catalog-count">{semanticSearchError ?? (catalogKind === "questions" ? `${questions.length} / ${bootstrap.questions.length} ${bi(locale, "questions", "題")}` : `${responseSets.length} ${bi(locale, "response sets", "個題組")}`)}</div>
        <div className="catalog-list">
          {catalogKind === "questions" && questions.map((question) => <button key={question.variable_id} className={`catalog-item ${draft.target_id === question.variable_id ? "selected" : ""}`} onClick={() => selectQuestion(question)}>
            <span className="variable-id">{question.variable_id}</span><strong>{question.question_text}</strong><small>{topicLabel(locale, question.topic_id, question.topic_label)} · {question.waves.map((wave) => `W${wave}`).join(" · ")}</small><span className="mode-tags">{question.modes.map((mode) => <em key={mode}>{MODE_LABELS[locale][mode]}</em>)}</span>
          </button>)}
          {catalogKind === "response_sets" && responseSets.map((set) => <button key={set.response_set_id} className={`catalog-item response-set ${draft.target_id === set.response_set_id ? "selected" : ""}`} onClick={() => selectResponseSet(set)}><Database size={17} /><strong>{set.label}</strong><small>{topicLabel(locale, set.topic_id, set.topic_label)} · {set.member_count} {bi(locale, "response positions", "個回答槽")}</small></button>)}
        </div>
      </aside>}

      <main className="workspace-panel">
        {error && (
          <RecoverableError
            message={error}
            locale={locale}
            onRetry={() => {
              setError(null);
              lastFailedAction.current?.();
            }}
            onDismiss={() => setError(null)}
          />
        )}
        {surface === "conversation" && !result ? <ConversationWorkspaceEmpty locale={locale} /> : !draft.target_id ? <EmptyWorkspace locale={locale} /> : <>
          <div className="active-variable">
            <div><span className="section-kicker">{draft.target_id} · {bi(locale, "Current question", "目前分析題目")}</span><h1>{selectedQuestion?.question_text ?? selectedResponseSet?.label}</h1><p>{selectedQuestion ? `${bi(locale, "Available waves", "可用波次")} ${selectedQuestion.waves.map((wave) => `W${wave}`).join(locale === "en" ? ", " : "、")}` : `${responseSetDetail?.member_count ?? 0} ${bi(locale, "response positions", "個回答槽")}`}</p></div>
            {detail && (
              <button
                type="button"
                className="quiet-button"
                aria-expanded={showScale}
                onClick={() => setShowScale((open) => !open)}
              >
                <Eye size={16} />
                <span>{showScale ? bi(locale, "Hide scale", "收起量表") : bi(locale, "View scale", "完整量表")}</span>
              </button>
            )}
          </div>

          {showScale && detail && <ScalePanel detail={detail} locale={locale} />}

          {surface === "workbench" && <section className="analysis-setup">
            <header className="setup-heading"><div><span className="section-kicker">{bi(locale, "Analysis settings", "分析設定")}</span><h2>{bi(locale, "Build a descriptive analysis", "建立描述性分析")}</h2></div><span className={readinessIssues.length ? "setup-state pending" : "setup-state ready"}>{readinessIssues.length ? `${readinessIssues.length} ${bi(locale, "items remaining", "項待完成")}` : bi(locale, "Ready", "可產生結果")}</span></header>

            <section className="setup-row">
              <div className="setup-label"><span>01</span><strong>{bi(locale, "Data scope", "資料範圍")}</strong></div>
              <div className="setup-control scope-control">
                {(!detail && draft.target_kind === "question") || (!responseSetDetail && draft.target_kind === "response_set") ? <p className="setup-placeholder">{bi(locale, "Loading the data coverage for this question…", "正在載入這個題目的資料涵蓋範圍…")}</p> : <>
                  <div>
                    <label>{bi(locale, "Country or territory", "國家或地區")}</label>
                    <div className="chip-grid">
                      <button
                        type="button"
                        className={`scope-all ${selectableCountryCodes.length > 0 && selectableCountryCodes.every((code) => draft.countries.includes(code)) ? "active" : ""}`}
                        aria-pressed={selectableCountryCodes.length > 0 && selectableCountryCodes.every((code) => draft.countries.includes(code))}
                        disabled={!selectableCountryCodes.length}
                        onClick={() => {
                          const allSelected = selectableCountryCodes.every((code) => draft.countries.includes(code));
                          setShowMissingContexts(false);
                          setGroupingManual(false);
                          setDraft((current) => patchDraft(current, {
                            countries: allSelected ? [] : selectableCountryCodes,
                          }));
                        }}
                      >
                        {bi(locale, "Select all", "全部國家或地區")}
                      </button>
                      {availableCountries.map((country) => {
                        const selected = draft.countries.includes(country.country_code);
                        const compatible = compatibleCountryCodes.has(country.country_code);
                        return (
                          <button
                            key={country.country_code}
                            type="button"
                            title={!compatible && draft.waves.length
                                ? bi(locale, "Some selected waves have no data; available cells will still be included", "部分所選波次沒有資料，仍可納入")
                                : undefined}
                            className={`${selected ? "active" : ""}${!compatible ? " partial-coverage" : ""}`}
                            onClick={() => {
                              setShowMissingContexts(false);
                              setGroupingManual(false);
                              setDraft((current) => patchDraft(current, {
                                countries: selected
                                  ? current.countries.filter((code) => code !== country.country_code)
                                  : [...current.countries, country.country_code].sort((a, b) => a - b),
                              }));
                            }}
                          >
                            {country.display_name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <label>{bi(locale, "Survey wave", "調查波次")}</label>
                    <div className="wave-grid">
                      <button
                        type="button"
                        className={`scope-all ${selectableWaves.length > 0 && selectableWaves.every((wave) => draft.waves.includes(wave)) ? "active" : ""}`}
                        aria-pressed={selectableWaves.length > 0 && selectableWaves.every((wave) => draft.waves.includes(wave))}
                        disabled={!selectableWaves.length}
                        onClick={() => {
                          const allSelected = selectableWaves.every((wave) => draft.waves.includes(wave));
                          setShowMissingContexts(false);
                          setGroupingManual(false);
                          setDraft((current) => patchDraft(current, {
                            waves: allSelected ? [] : selectableWaves,
                          }));
                        }}
                      >
                        {bi(locale, "Select all", "全部波次")}
                      </button>
                      {bootstrap.waves.map((wave) => {
                        const available = availableWaves.includes(wave);
                        const selected = draft.waves.includes(wave);
                        return (
                          <button
                            key={wave}
                            type="button"
                            title={!available && draft.countries.length
                                ? bi(locale, "Some selected countries have no data; available cells will still be included", "部分所選國家沒有資料，仍可納入")
                                : undefined}
                            className={`${selected ? "active" : ""}${!available ? " partial-coverage" : ""}`}
                            onClick={() => {
                              setShowMissingContexts(false);
                              setGroupingManual(false);
                              setDraft((current) => patchDraft(current, {
                                waves: selected
                                  ? current.waves.filter((item) => item !== wave)
                                  : [...current.waves, wave].sort(),
                              }));
                            }}
                          >
                            W{wave}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <p className="scope-summary">{draft.countries.length && draft.waves.length
                    ? bi(
                      locale,
                      `${draft.countries.length * draft.waves.length - missingContexts.length} available country-wave cells${missingContexts.length ? `; ${missingContexts.length} unavailable cells excluded` : ""}`,
                      `${draft.countries.length * draft.waves.length - missingContexts.length} 個可用國家－波次組合${missingContexts.length ? `；${missingContexts.length} 個無資料組合未納入` : ""}`,
                    )
                    : bi(locale, "Data scope is not complete", "尚未完成資料範圍")}</p>
                  {missingContexts.length > 0 && (
                    <div className="notice warn">
                      <strong>{bi(locale, `${missingContexts.length} country-wave cells have no data and will be excluded`, `${missingContexts.length} 個國家－波次組合沒有資料，將不納入結果`)}</strong>
                      <div className="notice-action">
                        <button onClick={() => setShowMissingContexts((visible) => !visible)}>
                          {showMissingContexts
                            ? bi(locale, "Hide unavailable scopes", "收起無資料範圍")
                            : bi(locale, "View unavailable scopes", "查看無資料範圍")}
                        </button>
                      </div>
                      {showMissingContexts && <p className="missing-context-list">{missingContextLabels.join(locale === "en" ? ", " : "、")}</p>}
                    </div>
                  )}
                </>}
              </div>
            </section>

            <section className="setup-row">
              <div className="setup-label"><span>02</span><strong>{bi(locale, "Analysis", "分析內容")}</strong></div>
              <div className="setup-control">
                {draft.target_kind === "response_set" ? <button className="analysis-option active"><strong>{bi(locale, "Multiple-response selection rate", "多選題選擇率")}</strong><small>{bi(locale, "Share of respondents mentioning each option", "每個選項被提及的受訪者比例")}</small></button> : <div className="analysis-options">{analysisOptions.map((option) => <button key={option.id} className={`analysis-option ${draft.mode === option.mode && draft.operation === option.operation ? "active" : ""}`} onClick={() => choosePrimaryAnalysis(option)}><strong>{option.label}</strong><small>{option.description}</small></button>)}</div>}
              </div>
            </section>

            <section className="setup-row compact-row">
              <div className="setup-label"><span>03</span><strong>{bi(locale, "Result layout", "結果呈現")}</strong></div>
              <div className="setup-control presentation-settings">
                <div className="presentation-setting">
                  <span className="control-label">{bi(locale, "Split result", "拆分方式")}</span>
                  <div className="grouping-options">{displayGroupingOptions.map((grouping) => <button key={grouping} className={draft.grouping === grouping ? "active" : ""} onClick={() => chooseGrouping(grouping)}>{GROUPING_LABELS[locale][grouping]}</button>)}</div>
                  <small className="automatic-note">{bi(locale, "Selected from the current scope; you can adjust it.", "依目前範圍選擇，可自行調整。")}</small>
                </div>
              </div>
            </section>

            {(readinessIssues.length > 0 || running) && (
              <footer className="setup-footer">
                {readinessIssues.length > 0 && <div className="issue-list">{readinessIssues.map((issue) => <span key={issue}><CircleHelp size={14} />{issue}</span>)}</div>}
                {running && <div className="auto-result-state updating" role="status"><LoaderCircle className="spin" size={16} /><strong>{bi(locale, "Updating result…", "正在更新結果…")}</strong></div>}
              </footer>
            )}
          </section>
          }

          {result && <ResultWorkspace
            key={`${result.draft.target_id ?? "none"}:${result.statistic ?? result.result.result_type}`}
            envelope={result}
            details={resultDetails}
            bootstrap={bootstrap}
            currentRevision={draft.revision}
            currentResponseScope={draft.response_scope}
            currentMemberOrder={draft.member_order}
            onResponsePosition={chooseResponsePosition}
            tab={resultTab}
            onTab={setResultTab}
            locale={locale}
          />}
        </>}
        {surface === "workbench" && (
          <JournalFeed
            entries={journal}
            notice={journalNotice}
            bootstrap={bootstrap}
            onRestore={restoreJournalEntry}
            locale={locale}
          />
        )}
      </main>

      <aside className="assistant-panel" aria-busy={assistantBusy}>
        <div className="assistant-heading">
          <div><Bot size={19} /><span><strong>{bi(locale, "Analysis assistant", "分析助理")}</strong><small>{bootstrap.assistant.available ? bi(locale, "Cloud catalog and statistics connected", "雲端題庫與統計已連線") : bi(locale, "Manual analysis remains available", "仍可使用手動分析")}</small></span></div>
          <div className="assistant-actions">
            <i className={bootstrap.assistant.available ? "online" : "offline"} />
            {surface === "conversation" ? (
              <>
                <button
                  className="labeled"
                  title={bi(locale, "Start another question and keep this conversation", "保留對話內容並開始另一個問題")}
                  disabled={!conversation?.turns.length || atNewQuestionBoundary}
                  onClick={beginNewQuestion}
                >
                  <FileQuestion size={15} />
                  <span>{bi(locale, "New question", "新問題")}</span>
                </button>
                <button
                  className="labeled"
                  title={bi(locale, "Start a new conversation and clear current messages", "建立新對話並清除目前訊息")}
                  disabled={!conversation?.turns.length}
                  onClick={beginNewConversation}
                >
                  <MessageSquarePlus size={15} />
                  <span>{bi(locale, "New conversation", "新對話")}</span>
                </button>
              </>
            ) : (
              <button
                title={bi(locale, "Open conversation analysis", "前往對話分析")}
                aria-label={bi(locale, "Open conversation analysis", "前往對話分析")}
                onClick={() => chooseSurface("conversation")}
              >
                <MessageSquareText size={16} />
              </button>
            )}
          </div>
        </div>
        <div className="assistant-messages">
          {!conversation?.turns.length && <div className="assistant-intro"><strong>{bi(locale, "Ask about the survey data", "直接詢問調查資料")}</strong><p>{bi(locale, "Describe the analysis you need. Questions, scope, and statistics are verified against the survey data.", "描述分析需求後，系統會依調查資料確認題目、範圍與統計數字。")}</p></div>}
          {conversation?.turns.map((turn, index) => {
            const isCurrentQuestionPrompt = (
              turn.role === "assistant"
              && index === conversation.turns.length - 1
              && conversation.pending?.kind === "question"
              && conversation.options.length > 0
            );
            const isArchivedQuestionList = (
              turn.role === "assistant"
              && !isCurrentQuestionPrompt
              && isQuestionListMessage(turn.message)
            );
            const message = turn.role === "user"
              ? turn.message
              : isCurrentQuestionPrompt
                ? bi(locale, "Choose the survey question that best matches your request.", "請選擇最符合需求的調查題目。")
                : isArchivedQuestionList
                  ? bi(locale, "Matching survey questions were shown.", "已顯示符合的調查題目。")
                : localizeAssistantMessage(locale, turn.message);
            return turn.kind === "flow_boundary"
              ? <div key={turn.turn_id} className="flow-boundary"><span>{localizeAssistantMessage(locale, turn.message)}</span></div>
              : <div key={turn.turn_id} className={`assistant-message ${turn.role}`}>{turn.role === "assistant" && <Bot size={14} />}<div><p>{message}</p>{turn.artifact_id && <button className="artifact-link" onClick={() => chooseSurface("conversation")}><BarChart3 size={13} />{bi(locale, "View result", "查看結果")}</button>}</div></div>;
          })}
          {assistantQueued && <div className="assistant-message user pending"><div><p>{assistantQueued}</p></div></div>}
          {assistantBusy && showAssistantProgress && (
            <div className="assistant-message assistant assistant-progress" role="status">
              <LoaderCircle className="spin" size={14} />
              <div>
                <p>
                  {assistantPhaseCopy[assistantPhase].title}
                  <span className="progress-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                </p>
                <small>{assistantPhaseCopy[assistantPhase].detail}</small>
              </div>
            </div>
          )}
        </div>
        {conversation?.applied_delta && (conversation.applied_delta.effective_change || conversation.action === "no_op") ? (
          <div className={`conversation-delta ${conversation.action === "no_op" ? "no-op" : ""}`}>
            <span>
              {conversation.action === "no_op"
                ? bi(locale, "Settings unchanged", "設定未變更")
                : [
                    conversation.applied_delta.countries_added.length ? `${bi(locale, "Added", "新增")} ${conversation.applied_delta.countries_added.join(locale === "en" ? ", " : "、")}` : "",
                    conversation.applied_delta.countries_removed.length ? `${bi(locale, "Removed", "移除")} ${conversation.applied_delta.countries_removed.join(locale === "en" ? ", " : "、")}` : "",
                    conversation.applied_delta.waves_added.length ? `${bi(locale, "Added", "新增")} W${conversation.applied_delta.waves_added.join(locale === "en" ? ", W" : "、W")}` : "",
                    conversation.applied_delta.waves_removed.length ? `${bi(locale, "Removed", "移除")} W${conversation.applied_delta.waves_removed.join(locale === "en" ? ", W" : "、W")}` : "",
                    conversation.applied_delta.statistic_before !== conversation.applied_delta.statistic_after && conversation.applied_delta.statistic_after
                      ? `${bi(locale, "Statistic", "統計量改為")} ${STATISTIC_LABELS[locale][conversation.applied_delta.statistic_after] ?? bi(locale, "Updated", "已更新")}`
                      : "",
                  ].filter(Boolean).join(" · ")}
            </span>
            {conversation.action === "revised" && (
              <button onClick={() => submitAssistantCommand({ kind: "repair", operation: "undo_last_change" }, bi(locale, "Undo last change", "撤銷上次修改"))}>{bi(locale, "Undo", "撤銷")}</button>
            )}
          </div>
        ) : null}
        {conversation?.options.length && !pendingOptionId ? (
          conversation.pending?.kind === "question"
            ? <div className="question-candidate-panel">
                <div className="candidate-heading">
                  <strong>{bi(locale, "Matching survey questions", "符合的調查題目")}</strong>
                  <span>{conversation.options.length}</span>
                </div>
                <div className="candidate-question-list" role="table" aria-label={bi(locale, "Candidate questions", "候選題目")}>
                  <div className="candidate-question-header" role="row">
                    <span role="columnheader">{bi(locale, "ID", "題號")}</span>
                    <span role="columnheader">{bi(locale, "Question and match", "題目與相關性")}</span>
                    <span role="columnheader">{bi(locale, "Waves", "波次")}</span>
                  </div>
                  {conversation.options.slice(0, candidateVisibleCount).map((option) => {
                    const parts = questionOptionParts(option, bootstrap.questions, locale);
                    return (
                      <button
                        key={option.option_id}
                        className="candidate-question-row"
                        role="row"
                        disabled={assistantBusy}
                        onClick={() => submitClarificationOption(option)}
                      >
                        <strong className="candidate-question-id" role="cell">{parts.questionId}</strong>
                        <span className="candidate-question-text" role="cell">
                          <span>{parts.questionText}</span>
                          <small>
                            {parts.topic}
                            {parts.matchBand && <><em className={`match-band ${parts.matchBand}`}>{matchBandLabel(parts.matchBand, locale)}</em>{parts.matchReasons.length > 0 && <span className="match-reasons">{parts.matchReasons.join(locale === "en" ? " · " : "、")}</span>}</>}
                          </small>
                        </span>
                        <small className="candidate-question-waves" role="cell">{parts.waves || "—"}</small>
                      </button>
                    );
                  })}
                </div>
                {conversation.options.length > 10 && (
                  <div className="candidate-footer">
                    <span>{bi(locale, `Showing ${candidateVisibleCount} of ${conversation.options.length}`, `顯示 ${candidateVisibleCount} / ${conversation.options.length} 題`)}</span>
                    <div>
                      {candidateVisibleCount > 10 && <button onClick={() => setCandidateVisibleCount(10)}>{bi(locale, "Collapse", "收起")}</button>}
                      {candidateVisibleCount < conversation.options.length && <button onClick={() => setCandidateVisibleCount((count) => Math.min(count + 10, conversation.options.length))}>{bi(locale, "Show 10 more", "再顯示 10 題")}</button>}
                      {candidateVisibleCount < conversation.options.length && <button onClick={() => setCandidateVisibleCount(conversation.options.length)}>{bi(locale, "Show all", "顯示全部")}</button>}
                    </div>
                  </div>
                )}
              </div>
            : <div className="clarification-options"><span>{bi(locale, "Choose directly", "直接選擇")}</span>{conversation.options.map((option) => <button key={option.option_id} disabled={assistantBusy} onClick={() => submitClarificationOption(option)}><strong>{localizeOptionLabel(locale, option.label)}</strong>{option.description && <small>{localizeOptionDescription(locale, option.description)}</small>}</button>)}</div>
        ) : null}
        {conversation?.suggestions?.length && !conversation.options.length && !assistantBusy ? (
          <div className="followup-actions">
            <span>{bi(locale, "Next", "接著可以")}</span>
            <div className="followup-action-list">
              {currentSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.action_id}
                    className={openSuggestionEditor === suggestion.action_id ? "active" : ""}
                    aria-expanded={suggestion.control !== "command"
                      ? openSuggestionEditor === suggestion.action_id
                      : undefined}
                    onClick={() => activateSuggestion(suggestion)}
                  >
                    {localizeSuggestionLabel(locale, suggestion.label)}
                    <ChevronRight size={12} />
                  </button>
                ))}
            </div>
            {activeScopeSuggestion && (
              <div className="scope-suggestion-editor">
                <header>
                  <strong>
                    {activeScopeSuggestion.control === "country_multiselect"
                      ? bi(locale, "Country or territory", "國家或地區")
                      : bi(locale, "Survey wave", "調查波次")}
                  </strong>
                  <span>{bi(locale, "Add and remove in one update", "可同時新增與移除")}</span>
                </header>
                <div className={`scope-suggestion-grid ${activeScopeSuggestion.control === "wave_multiselect" ? "waves" : ""}`}>
                  <button
                    type="button"
                    className={`select-all ${allSuggestionValuesSelected ? "selected" : ""}`}
                    aria-pressed={allSuggestionValuesSelected}
                    disabled={!availableSuggestionValues.length}
                    onClick={() => toggleAllSuggestionValues(activeScopeSuggestion)}
                  >
                    <strong>
                      {activeScopeSuggestion.control === "country_multiselect"
                        ? bi(locale, "Select all countries or territories", "全部國家或地區")
                        : bi(locale, "Select all waves", "全部波次")}
                    </strong>
                    <small>{availableSuggestionValues.length} {bi(locale, "available", "個可選")}</small>
                  </button>
                  {activeScopeSuggestion.choices.map((choice) => {
                    const selected = suggestionValues.includes(choice.value);
                    const available = choice.available !== false;
                    return (
                      <button
                        type="button"
                        key={choice.value}
                        className={`${selected ? "selected" : ""}${!available ? " unavailable" : ""}`}
                        aria-pressed={selected}
                        disabled={!available && !selected}
                        title={!available ? localizeOptionDescription(locale, choice.description) ?? bi(locale, "No data in the current scope", "目前分析範圍沒有資料") : undefined}
                        onClick={() => toggleSuggestionValue(choice.value)}
                      >
                        <strong>{localizeOptionLabel(locale, choice.label)}</strong>
                        {choice.description && <small>{localizeOptionDescription(locale, choice.description)}</small>}
                      </button>
                    );
                  })}
                </div>
                <footer>
                  <span>{suggestionValues.length} {bi(locale, "selected", "個已選")}</span>
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenSuggestionEditor(null);
                        setSuggestionValues([]);
                      }}
                    >
                      {bi(locale, "Cancel", "取消")}
                    </button>
                    <button
                      type="button"
                      className="primary"
                      disabled={!suggestionValues.length || !suggestionSelectionChanged}
                      onClick={() => void applySuggestionSelection(activeScopeSuggestion)}
                    >
                      {activeScopeSuggestion.control === "country_multiselect"
                        ? bi(locale, "Update country scope", "更新國家範圍")
                        : bi(locale, "Update wave scope", "更新波次範圍")}
                    </button>
                  </div>
                </footer>
              </div>
            )}
          </div>
        ) : null}
        {!conversation?.turns.length && <div className="prompt-templates"><span>{bi(locale, "Try asking", "可直接詢問")}</span>{(locale === "en"
          ? ["Mean democracy rating in Japan across waves", "Distribution of satisfaction with democracy in South Korea", "Which questions are about China's influence?"]
          : ["日本的民主程度在各波平均值", "韓國對民主運作滿意度的回答分布", "哪些題目與中國影響力有關？"]
        ).map((prompt) => <button key={prompt} onClick={() => setAssistantInput(prompt)}>{prompt}<ChevronRight size={14} /></button>)}</div>}
        <form className="assistant-form" onSubmit={sendAssistant}>
          <textarea
            value={assistantInput}
            onChange={(event) => setAssistantInput(event.target.value)}
            onKeyDown={handleAssistantKeyDown}
            onCompositionStart={() => { assistantComposingRef.current = true; }}
            onCompositionEnd={() => { assistantComposingRef.current = false; }}
            placeholder={bi(locale, "Ask in any language about a question, statistic, country, or wave", "可使用任何語言詢問題目、統計量、國家或波次")}
            rows={surface === "conversation" ? 4 : 3}
          />
          <div>
            <span className="assistant-form-meta">
              <small>{conversation?.active_snapshot
                ? `${conversation.active_snapshot.view.question_id} · ${STATISTIC_LABELS[locale][conversation.active_snapshot.view.statistic] ?? bi(locale, "Analysis", "分析")}`
                : bi(locale, "A verifiable result is created when the request is complete", "需求完整後直接建立可驗證結果")}</small>
              <small className="keyboard-hint">{bi(locale, "Enter to send · Ctrl+Enter for a new line", "Enter 送出 · Ctrl+Enter 換行")}</small>
            </span>
            <button aria-label={bi(locale, "Send", "送出")} title={bi(locale, "Send", "送出")} disabled={!assistantInput.trim() || assistantBusy}><Send size={17} /></button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function EmptyWorkspace({ locale }: { locale: Locale }) {
  return <div className="workspace-empty"><div className="empty-mark"><BarChart3 size={27} /></div><span className="section-kicker">{bi(locale, "Analysis workspace", "分析工作台")}</span><h1>{bi(locale, "No question selected", "尚未選擇題目")}</h1><p>{bi(locale, "Choose a question from the library to configure and view an analysis.", "從左側題庫選擇一題後，分析設定與結果會在此處展開。")}</p></div>;
}

function ConversationWorkspaceEmpty({ locale }: { locale: Locale }) {
  return <div className="workspace-empty conversation-empty"><div className="empty-mark"><MessageSquareText size={26} /></div><span className="section-kicker">{bi(locale, "Conversation", "對話")}</span><h1>{bi(locale, "Your result will appear here", "結果會在這裡展開")}</h1><p>{bi(locale, "Ask for an analysis on the right. When a question or scope is ambiguous, the assistant will show clear choices.", "在右側提出分析問題；若題意或範圍不明確，助理會先列出可選項。")}</p></div>;
}

type ErrorKind = "missing_cells" | "offline" | "network" | "generic";

export function classifyError(message: string): ErrorKind {
  if (message.includes("情境不可用") || message.includes("沒有資料")) return "missing_cells";
  if (message.includes("尚未連線") || message.includes("not connected")) return "offline";
  if (message.includes("Failed to fetch") || message.includes("NetworkError")) return "network";
  return "generic";
}

function RecoverableError({ message, locale, onRetry, onDismiss }: {
  message: string;
  locale: Locale;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const kind = classifyError(message);
  const parts = {
    missing_cells: {
      event: bi(locale, "Some selected cells have no data", "資料範圍含有沒有資料的組合"),
      impact: bi(locale, "Unavailable cells will be excluded", "這些組合不會進入分析"),
      action: bi(locale, "Adjust the scope to change the result", "可移除缺失組合或調整範圍"),
    },
    offline: {
      event: bi(locale, "The analysis assistant is temporarily unavailable", "分析助理暫時不可用"),
      impact: bi(locale, "Manual analysis is still available", "手動分析不受影響"),
      action: bi(locale, "Continue with the question library and workspace", "可繼續使用題庫與手動設定"),
    },
    network: {
      event: bi(locale, "Connection failed", "連線失敗"),
      impact: bi(locale, "No result was produced", "本次沒有產生結果"),
      action: bi(locale, "Check your network connection and try again", "請檢查網路連線後重試"),
    },
    generic: {
      event: bi(locale, "The action could not be completed", "操作沒有完成"),
      impact: bi(locale, "The current settings were not changed", "目前設定沒有改變"),
      action: bi(locale, "Review the request and try again", "請調整後重試"),
    },
  }[kind];
  return (
    <div className="error-panel" role="alert">
      <h3>{parts.event}</h3>
      <p>{parts.impact} · {parts.action}</p>
      <div className="notice-action">
        {kind === "network" && <button onClick={onRetry}>{bi(locale, "Retry", "重試")}</button>}
        <button onClick={onDismiss}>{bi(locale, "Dismiss", "關閉")}</button>
      </div>
    </div>
  );
}

function JournalFeed({ entries, notice, bootstrap, onRestore, locale }: {
  entries: JournalEntry[];
  notice: string | null;
  bootstrap: Bootstrap;
  onRestore: (entry: JournalEntry) => void;
  locale: Locale;
}) {
  return (
    <section className="journal-feed">
      <header className="journal-heading">
        <h2>{bi(locale, "Analysis history", "分析紀錄")}</h2>
        <span>{entries.length ? bi(locale, `${entries.length} results in this session`, `本次工作階段 ${entries.length} 則`) : ""}</span>
      </header>
      {notice && (
        <div className="notice info">
          <strong>{bi(locale, "This result is already in the analysis history", "這項結果已在分析紀錄中")}</strong>{` · ${bi(locale, "Change a setting to create a new result", "調整設定可產生新的結果")}`}
        </div>
      )}
      {!entries.length ? (
        <div className="journal-empty">
          <span className="serif">{bi(locale, "No saved results yet.", "還沒有任何記錄。")}</span>
          <small>{bi(locale, "Each completed calculation will appear here for review.", "每次完成的計算都會留在這裡供查閱。")}</small>
        </div>
      ) : (
        [...entries].reverse().map((entry) => (
          <JournalEntryRow key={entry.number} entry={entry} bootstrap={bootstrap} onRestore={onRestore} locale={locale} />
        ))
      )}
    </section>
  );
}

function JournalEntryRow({ entry, bootstrap, onRestore, locale }: {
  entry: JournalEntry;
  bootstrap: Bootstrap;
  onRestore: (entry: JournalEntry) => void;
  locale: Locale;
}) {
  const { envelope } = entry;
  const { draft } = envelope;
  const metadata = envelope.result.metadata;
  const question = bootstrap.questions.find((item) => item.variable_id === draft.target_id);
  const responseSet = bootstrap.response_sets.find((item) => item.response_set_id === draft.target_id);
  const title = question?.question_text ?? responseSet?.label ?? draft.target_id ?? "";
  const weight = metadata.weight_mode === "none"
    ? bi(locale, "Unweighted", "未加權")
    : bi(locale, "Weighted", "加權");
  return (
    <article className="journal-entry">
      <div className="journal-entry-meta">
        <span>
          {bi(locale, `Result ${entry.number}`, `第 ${entry.number} 則`)}
          {entry.origin === "conversation" && <span className="journal-origin">{bi(locale, "From conversation", "來自對話")}</span>}
        </span>
      </div>
      <h3 className="journal-entry-title">
        {title}
        {draft.target_id && <span className="qid">{draft.target_id}</span>}
      </h3>
      <div className="journal-cite">
        {entry.statistic} · {bi(locale, "Scope", "範圍")} {draft.countries.length} {bi(locale, "countries", "國")} × {draft.waves.length} {bi(locale, "waves", "波")}
        · {bi(locale, "Valid N", "有效 N")} {formatNumber(metadata.analysis_unweighted_n, 0, locale)}/{formatNumber(metadata.total_records_n, 0, locale)}
        · {weight}
      </div>
      <div className="journal-actions">
        <button onClick={() => onRestore(entry)}>{bi(locale, "Restore", "載回")}</button>
      </div>
    </article>
  );
}

function ScalePanel({ detail, locale }: { detail: QuestionDetail; locale: Locale }) {
  return <section className="scale-panel"><header><div><span className="section-kicker">{bi(locale, "Response scale", "完整量表")}</span><strong>{bi(locale, `Value settings for ${detail.variable_id}`, `${detail.variable_id} 的數值設定`)}</strong></div><span>{detail.scale.length} {bi(locale, "raw values", "個原始值")}</span></header><div className="table-wrap"><table><thead><tr><th>{bi(locale, "Raw value", "原始值")}</th><th>{bi(locale, "Response label", "回答標籤")}</th><th>{bi(locale, "Ordinal position", "順序位置")}</th><th>{bi(locale, "Continuous score", "連續分數")}</th></tr></thead><tbody>{detail.scale.map((value) => <tr key={value.raw_value_key} className={value.category_status === "excluded" ? "excluded" : ""}><td>{value.raw_value_key}</td><td>{value.category_label}</td><td>{value.order_status === "included" ? value.order_position : "—"}</td><td>{value.continuous_status === "included" ? formatNumber(value.continuous_score, 2, locale) : "—"}</td></tr>)}</tbody></table></div></section>;
}

const ResultWorkspace = memo(function ResultWorkspace({
  envelope,
  details,
  bootstrap,
  currentRevision,
  currentResponseScope,
  currentMemberOrder,
  onResponsePosition,
  tab,
  onTab,
  locale,
}: {
  envelope: AnalysisEnvelope;
  details: ResultDetails;
  bootstrap: Bootstrap;
  currentRevision: number;
  currentResponseScope: Draft["response_scope"];
  currentMemberOrder: number | null;
  onResponsePosition: (responseScope: Draft["response_scope"], memberOrder: number | null) => void;
  tab: ResultTab;
  onTab: (tab: ResultTab) => void;
  locale: Locale;
}) {
  const draft = envelope.draft;
  const question = bootstrap.questions.find((item) => item.variable_id === draft.target_id);
  const responseSet = bootstrap.response_sets.find((item) => item.response_set_id === draft.target_id);
  const secondary = bootstrap.questions.find((item) => item.variable_id === draft.secondary_id);
  const metric = envelope.statistic
    ? STATISTIC_LABELS[locale][envelope.statistic]
    : envelope.result.result_type === "summary"
      ? (draft.mode === "continuous"
          ? bi(locale, "Mean, median, standard deviation, and quartiles", "平均值、中位數、標準差與四分位數")
          : bi(locale, "Median and quartiles", "中位數與四分位數"))
      : OPERATION_LABELS[locale][envelope.result.result_type];
  const stale = draft.revision !== currentRevision;
  const availableMetrics = useMemo(() => {
    if (envelope.result.result_type !== "summary") return [];
    const rowMetrics = new Set(envelope.result.rows.map((row) => String(row.metric)));
    const metrics: ChartMetric[] = [];
    if (rowMetrics.has("mean")) metrics.push("mean");
    if (rowMetrics.has("median")) metrics.push("median");
    if (rowMetrics.has("q25") && rowMetrics.has("q75")) metrics.push("quartiles");
    if (rowMetrics.has("sd")) metrics.push("sd");
    if (rowMetrics.has("base_n") || envelope.result.rows.some((row) => row.base_n != null)) metrics.push("base_n");
    return metrics;
  }, [envelope.result]);
  const initialMetric = (
    envelope.statistic
    && ["mean", "median", "quartiles", "sd", "base_n"].includes(envelope.statistic)
    && availableMetrics.includes(envelope.statistic as ChartMetric)
  )
    ? envelope.statistic as ChartMetric
    : availableMetrics[0] ?? "mean";
  const [chartMetric, setChartMetric] = useState<ChartMetric>(initialMetric);
  const [chartLayout, setChartLayout] = useState<ChartLayout>("country");
  const canRotateLayout = draft.grouping === "country_wave"
    && draft.countries.length > 1
    && draft.waves.length > 1;
  const layoutUsesFacets = ["distribution", "multi_response"].includes(
    envelope.result.result_type,
  ) || chartMetric === "quartiles";
  return (
    <section className="result-workspace">
      <header className="result-title">
        <div>
          <span className="section-kicker">
            {bi(locale, "Analysis result", "分析結果")} {stale ? bi(locale, "· Settings have changed", "· 目前設定已變更") : ""}
          </span>
          <h2>{question ? `${question.variable_id} · ${question.question_text}` : responseSet?.label}</h2>
          {secondary && (
            <div className="result-secondary">
              <span>{bi(locale, "Second variable", "第二變量")}</span>
              <strong>{secondary.variable_id} · {secondary.question_text}</strong>
              <small>{draft.secondary_mode ? MODE_LABELS[locale][draft.secondary_mode] : ""}</small>
            </div>
          )}
          <p>{metric} · {compactContextSummary(draft, bootstrap.countries, locale)} · {GROUPING_LABELS[locale][draft.grouping]}</p>
        </div>
        <span className="result-badge">{bi(locale, "Descriptive result", "描述性結果")}</span>
      </header>
      <ResultEvidence envelope={envelope} locale={locale} />
      <div className="result-tabs">
        <button className={tab === "chart" ? "active" : ""} onClick={() => onTab("chart")}><BarChart3 size={16} />{bi(locale, "Chart", "圖表")}</button>
        <button className={tab === "table" ? "active" : ""} onClick={() => onTab("table")}><Table2 size={16} />{bi(locale, "Data", "資料")}</button>
      </div>
      {tab === "chart" && (availableMetrics.length > 1 || canRotateLayout || responseSet) && (
        <div className="chart-controls">
          {availableMetrics.length > 1 && (
            <div>
              <span>{bi(locale, "Chart metric", "圖表指標")}</span>
              <div className="chart-control-buttons">
                {availableMetrics.map((item) => <button key={item} className={chartMetric === item ? "active" : ""} onClick={() => setChartMetric(item)}>{STATISTIC_LABELS[locale][item]}</button>)}
              </div>
            </div>
          )}
          {responseSet && (
            <div>
              <span>{bi(locale, "Response position", "回答順位")}</span>
              <div className="chart-control-buttons">
                <button
                  className={currentResponseScope === "any_member" ? "active" : ""}
                  onClick={() => onResponsePosition("any_member", null)}
                >
                  {bi(locale, "Any response position", "任一回答順位")}
                </button>
                <button
                  className={currentResponseScope === "specific_member" ? "active" : ""}
                  onClick={() => onResponsePosition("specific_member", currentMemberOrder ?? 1)}
                >
                  {bi(locale, "Specific response position", "指定回答順位")}
                </button>
                {currentResponseScope === "specific_member" && (
                  <select
                    aria-label={bi(locale, "Choose response position", "選擇回答順位")}
                    value={currentMemberOrder ?? 1}
                    onChange={(event) => onResponsePosition("specific_member", Number(event.target.value))}
                  >
                    {Array.from({ length: responseSet.member_count }, (_, index) => index + 1).map((memberOrder) => (
                      <option key={memberOrder} value={memberOrder}>
                        {bi(locale, `Response ${memberOrder}`, `第 ${memberOrder} 回答`)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )}
          {canRotateLayout && (
            <div>
              <span>{bi(locale, "Presentation", "呈現方式")}</span>
              <div className="chart-control-buttons">
                <button className={chartLayout === "country" ? "active" : ""} onClick={() => setChartLayout("country")}>
                  {layoutUsesFacets ? bi(locale, "Facet by country", "依國家分面") : bi(locale, "Countries as series", "國家作為系列")}
                </button>
                <button className={chartLayout === "wave" ? "active" : ""} onClick={() => setChartLayout("wave")}>
                  {layoutUsesFacets ? bi(locale, "Facet by wave", "依波次分面") : bi(locale, "Waves as series", "波次作為系列")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <div className={`result-body result-body-${tab}`}>
        {tab === "chart" && <ResultChart envelope={envelope} details={details} metric={chartMetric} layout={chartLayout} locale={locale} />}
        {tab === "table" && <ResultTable envelope={envelope} details={details} locale={locale} />}
      </div>
    </section>
  );
});

function ResultEvidence({ envelope, locale }: { envelope: AnalysisEnvelope; locale: Locale }) {
  const metadata = envelope.result.metadata;
  const excluded = Math.max(metadata.total_records_n - metadata.analysis_unweighted_n, 0);
  return <div className="evidence-strip"><div><span>{bi(locale, "Records in scope", "範圍內記錄")}</span><strong>{formatNumber(metadata.total_records_n, 0, locale)}</strong></div><div><span>{bi(locale, "Included", "納入分析")}</span><strong>{formatNumber(metadata.analysis_unweighted_n, 0, locale)}</strong></div><div><span>{bi(locale, "Excluded", "未納入")}</span><strong>{formatNumber(excluded, 0, locale)}</strong></div><div><span>{bi(locale, "Denominator", "計算分母")}</span><strong>{denominatorLabel(metadata.denominator_definition, locale)}</strong></div></div>;
}

function scoreDomain(detail: QuestionDetail | null, mode: Mode | null): [number, number] | undefined {
  if (!detail || !mode || mode === "category") return undefined;
  const values = detail.scale.flatMap((item) => {
    if (mode === "continuous" && item.continuous_status === "included" && item.continuous_score != null) return [item.continuous_score];
    if (mode === "order" && item.order_status === "included" && item.order_position != null) return [item.order_position];
    return [];
  });
  if (!values.length) return undefined;
  return [Math.min(...values), Math.max(...values)];
}

function categoryAxisWidth(labels: unknown[]): number {
  const longest = labels.reduce(
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
  const definedDomain = scoreDomain(detail, mode);
  const values = items.flatMap((item) => [item.q25, item.median, item.q75]).filter(
    (value): value is number => value != null && Number.isFinite(value),
  );
  const minimum = definedDomain?.[0] ?? Math.min(...values);
  const maximum = definedDomain?.[1] ?? Math.max(...values);
  const span = Math.max(maximum - minimum, 1);
  if (!items.length) {
    return <div className="chart-empty">{bi(locale, "Quartiles are not available for this result.", "這份結果沒有可呈現的四分位數。")}</div>;
  }
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

function ResultChart({ envelope, details, metric, layout, locale }: { envelope: AnalysisEnvelope; details: ResultDetails; metric: ChartMetric; layout: ChartLayout; locale: Locale }) {
  const { result, draft } = envelope;
  if (!result.rows.length) return <div className="chart-empty">{bi(locale, "There is no result to display for this scope.", "目前設定沒有可呈現的結果。")}</div>;
  if (result.result_type === "summary") {
    if (metric === "quartiles") {
      return <QuartileRangeChart rows={result.rows} detail={details.primary} mode={draft.mode} grouping={draft.grouping} layout={layout} locale={locale} />;
    }
    const rows = summaryMetricRows(result.rows, metric);
    if (draft.grouping === "none" || rows.length <= 1) return <StatisticGrid rows={rows} locale={locale} />;
    const domain = ["mean", "median"].includes(metric)
      ? scoreDomain(details.primary, draft.mode)
      : undefined;
    const xKind: "country" | "wave" | null = draft.grouping === "country_wave"
      ? (layout === "country" ? "wave" : "country")
      : draft.grouping === "wave" ? "wave"
        : draft.grouping === "country" ? "country" : null;
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
        return <><div className="chart-note">{bi(locale, "Each wave is a separate cross-sectional sample; lines only help show change over time.", "各波次為不同的橫截面樣本；連線僅用於協助觀察變化。")}</div><div className="chart-wrap" style={{ height: resultChartHeight("line", data.length, series.length) }}><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 14, right: 28, bottom: 18, left: 8 }}><CartesianGrid stroke="#E4E0D6" vertical={false} /><XAxis dataKey="context" /><YAxis domain={domain} tickFormatter={(value) => formatNumber(value, metric === "base_n" ? 0 : 1, locale)} /><Tooltip formatter={(value) => formatNumber(value, metric === "base_n" ? 0 : 2, locale)} /><Legend />{series.map((name, index) => <Line key={name} type="linear" dataKey={name} stroke={CHART_COLORS[index % CHART_COLORS.length]} strokeWidth={2.4} dot={{ r: 4 }} connectNulls={false} />)}</LineChart></ResponsiveContainer></div></>;
      }
      return <div className="chart-wrap" style={{ height: resultChartHeight("bar", data.length, series.length) }}><ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{ top: 12, right: 26, bottom: 12, left: 22 }}><CartesianGrid stroke="#E4E0D6" horizontal={false} /><XAxis type="number" domain={domain} tickFormatter={(value) => formatNumber(value, metric === "base_n" ? 0 : 1, locale)} /><YAxis type="category" dataKey="context" width={categoryAxisWidth(data.map((item) => item.context))} /><Tooltip formatter={(value) => formatNumber(value, metric === "base_n" ? 0 : 2, locale)} /><Legend />{series.map((name, index) => <Bar key={name} dataKey={name} fill={CHART_COLORS[index % CHART_COLORS.length]} maxBarSize={23} />)}</BarChart></ResponsiveContainer></div>;
    }
    const data = rows.map((row) => ({ context: row.label ? `${dimensionLabel(row, locale)} · ${row.label}` : dimensionLabel(row, locale), value: Number(row.estimate), n: row.base_n }));
    return <div className="chart-wrap" style={{ height: resultChartHeight("bar", data.length) }}><ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{ top: 12, right: 26, bottom: 12, left: 22 }}><CartesianGrid stroke="#E4E0D6" horizontal={false} /><XAxis type="number" domain={domain} /><YAxis type="category" dataKey="context" width={categoryAxisWidth(data.map((item) => item.context))} /><Tooltip formatter={(value) => formatNumber(value, metric === "base_n" ? 0 : 2, locale)} /><Bar dataKey="value" name={STATISTIC_LABELS[locale][metric]} fill="#1F6F9C" maxBarSize={25} /></BarChart></ResponsiveContainer></div>;
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
        return <section className="distribution-facet" key={facet}><header><strong>{facet}</strong><span>{layout === "country" ? bi(locale, "Waves shown separately", "各波次分別呈現") : bi(locale, "Countries shown separately", "各國家分別呈現")}</span></header><div className="chart-wrap distribution" style={{ height: resultChartHeight("distribution", data.length, series.length) }}><ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{ top: 10, right: 24, bottom: 10, left: 20 }}><CartesianGrid stroke="#E4E0D6" horizontal={false} /><XAxis type="number" domain={[0, 100]} tickFormatter={(value) => `${value}%`} /><YAxis type="category" dataKey="label" width={categoryAxisWidth(data.map((item) => item.label))} interval={0} /><Tooltip formatter={(value) => `${formatNumber(value, 2, locale)}%`} /><Legend />{series.map((name, index) => <Bar key={name} dataKey={name} fill={CHART_COLORS[index % CHART_COLORS.length]} maxBarSize={23} />)}</BarChart></ResponsiveContainer></div></section>;
      })}</div></>;
    }
    const data = distributionData(result.rows, (row) => dimensionLabel(row, locale));
    const series = [...new Set(result.rows.map((row) => dimensionLabel(row, locale)))];
    return <>{note}<div className="chart-wrap distribution" style={{ height: resultChartHeight("distribution", data.length, series.length) }}><ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{ top: 10, right: 24, bottom: 10, left: 20 }}><CartesianGrid stroke="#E4E0D6" horizontal={false} /><XAxis type="number" domain={[0, 100]} tickFormatter={(value) => `${value}%`} /><YAxis type="category" dataKey="label" width={categoryAxisWidth(data.map((item) => item.label))} interval={0} /><Tooltip formatter={(value) => `${formatNumber(value, 2, locale)}%`} /><Legend />{series.map((name, index) => <Bar key={name} dataKey={name} fill={CHART_COLORS[index % CHART_COLORS.length]} maxBarSize={23} />)}</BarChart></ResponsiveContainer></div></>;
  }
  if (result.result_type === "crosstab") return <CrosstabMatrix envelope={envelope} details={details} locale={locale} />;
  if (result.result_type === "relationship") {
    const xDomain = scoreDomain(details.primary, "continuous");
    const yDomain = scoreDomain(details.secondary, "continuous");
    const data = result.rows.map((row) => ({ x: row.x, y: row.y, z: row.estimate_n ?? row.unweighted_n ?? 1 }));
    return <><div className="chart-note">{bi(locale, `Larger points represent more responses. The x-axis is ${details.primary?.variable_id ?? envelope.draft.target_id}; the y-axis is ${details.secondary?.variable_id ?? envelope.draft.secondary_id}. This is a joint distribution, not a correlation or regression estimate.`, `圓點越大，代表該分數組合的回答越多；橫軸為 ${details.primary?.variable_id ?? envelope.draft.target_id}，縱軸為 ${details.secondary?.variable_id ?? envelope.draft.secondary_id}。此圖呈現聯合分布，不代表相關或迴歸。`)}</div><div className="chart-wrap" style={{ height: resultChartHeight("scatter", data.length) }}><ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{ top: 18, right: 24, bottom: 22, left: 12 }}><CartesianGrid stroke="#E4E0D6" /><XAxis type="number" dataKey="x" name={details.primary ? `${details.primary.variable_id} · ${details.primary.question_text}` : envelope.draft.target_id ?? "X"} domain={xDomain} /><YAxis type="number" dataKey="y" name={details.secondary ? `${details.secondary.variable_id} · ${details.secondary.question_text}` : envelope.draft.secondary_id ?? "Y"} domain={yDomain} /><ZAxis type="number" dataKey="z" range={[45, 520]} /><Tooltip cursor={{ strokeDasharray: "3 3" }} /><Scatter data={data} fill="#1F6F9C" fillOpacity={0.72} /></ScatterChart></ResponsiveContainer></div></>;
  }
  return null;
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

function StatisticGrid({ rows, locale }: { rows: ResultRow[]; locale: Locale }) {
  return <div className="stat-grid">{rows.map((row, index) => <div key={`${row.metric}-${index}`}><span>{METRIC_LABELS[locale][String(row.metric)] ?? bi(locale, "Statistic", "統計量")}</span><strong>{formatNumber(row.estimate, row.metric === "base_n" ? 0 : 2, locale)}</strong><small>{row.label ?? dimensionLabel(row, locale)}{row.metric !== "base_n" && row.base_n != null ? ` · n=${formatNumber(row.base_n, 0, locale)}` : ""}</small></div>)}</div>;
}

function flattenRow(row: ResultRow, locale: Locale): Record<string, unknown> {
  const flat: Record<string, unknown> = { context: dimensionLabel(row, locale) };
  Object.entries(row).forEach(([key, value]) => {
    if (key !== "dimensions" && (typeof value !== "object" || value === null)) flat[key] = value;
  });
  return flat;
}

function ResultTable({ envelope, details, locale }: { envelope: AnalysisEnvelope; details: ResultDetails; locale: Locale }) {
  if (envelope.result.result_type === "summary") {
    const metricOrder = ["mean", "median", "sd", "q25", "q75", "min", "max", "base_n"];
    const contexts = new Map<string, Record<string, unknown>>();
    envelope.result.rows.forEach((row) => {
      const context = dimensionLabel(row, locale);
      const item = contexts.get(context) ?? { context };
      if (row.metric) item[row.metric] = row.estimate;
      if (row.metric && row.label) item[`${row.metric}_label`] = row.label;
      if (item.base_n == null && row.base_n != null) item.base_n = row.base_n;
      contexts.set(context, item);
    });
    const rows = [...contexts.values()];
    const metrics = metricOrder.filter((metric) =>
      rows.some((row) => row[metric] !== null && row[metric] !== undefined),
    );
    return (
      <div className="table-wrap result-table summary-result-table">
        <table>
          <thead><tr><th>{bi(locale, "Analysis scope", "分析範圍")}</th>{metrics.map((metric) => <th key={metric}>{METRIC_LABELS[locale][metric]}</th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr key={String(row.context)}><td>{String(row.context)}</td>{metrics.map((metric) => <td key={metric}>{formatNumber(row[metric], metric === "base_n" ? 0 : 2, locale)}{row[`${metric}_label`] ? ` · ${String(row[`${metric}_label`])}` : ""}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }
  const rows = envelope.result.rows.map((row) => flattenRow(row, locale));
  const redundantRawValueKey = rows.every((row) =>
    row.raw_value_key === undefined
    || row.raw_value === undefined
    || String(row.raw_value_key) === String(row.raw_value),
  );
  const redundantCategoryLabel = rows.every((row) =>
    row.category_label === undefined
    || String(row.category_label) === String(row.label),
  );
  const redundantDenominator = rows.every((row) =>
    row.denominator === undefined
    || row.base_n === undefined
    || Number(row.denominator) === Number(row.base_n),
  );
  const hiddenHeaders = new Set([
    "outcome_raw_value",
    "group_raw_value",
    "estimate_n",
    ...(redundantRawValueKey ? ["raw_value_key"] : []),
    ...(redundantCategoryLabel ? ["category_label"] : []),
    ...(redundantDenominator ? ["denominator"] : []),
  ]);
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((header) => {
    if (hiddenHeaders.has(header)) return false;
    return rows.some((row) => row[header] !== null && row[header] !== undefined && row[header] !== "");
  });
  const primary = details.primary?.variable_id ?? envelope.draft.target_id ?? bi(locale, "First question", "第一題");
  const secondary = details.secondary?.variable_id ?? envelope.draft.secondary_id ?? bi(locale, "Second question", "第二題");
  const labels: Record<string, string> = locale === "en"
    ? { context: "Analysis scope", metric: "Statistic", estimate: "Result", label: "Response", category_label: "Response label", raw_value: "Raw value", raw_value_key: "Value code", continuous_score: "Numeric score", order_position: "Ordinal position", base_n: "Valid N", estimate_base: "Analysis base", unweighted_n: "Count", denominator: "Denominator", proportion: "Percentage", row_proportion: "Row percentage", column_proportion: "Column percentage", total_proportion: "Total percentage", outcome_label: `${primary} row response`, outcome_order: "Row order", group_label: `${secondary} column response`, group_order: "Column order", x: `${primary} score`, y: `${secondary} score`, option_label: "Option", member_order: "Response position" }
    : { context: "分析範圍", metric: "統計量", estimate: "結果", label: "回答", category_label: "回答標籤", raw_value: "原始值", raw_value_key: "數值代碼", continuous_score: "連續分數", order_position: "順序位置", base_n: "有效人數", estimate_base: "計算基數", unweighted_n: "人數", denominator: "人數分母", proportion: "比例", row_proportion: "列百分比", column_proportion: "欄百分比", total_proportion: "總體百分比", outcome_label: `${primary} 列回答`, outcome_order: "列回答順序", group_label: `${secondary} 欄回答`, group_order: "欄回答順序", x: `${primary} 分數`, y: `${secondary} 分數`, option_label: "選項", member_order: "回答順位" };
  const value = (header: string, item: unknown) => header.includes("proportion") && typeof item === "number" ? `${formatNumber(item * 100, 2, locale)}%` : header === "metric" ? METRIC_LABELS[locale][String(item)] ?? bi(locale, "Statistic", "統計量") : typeof item === "number" ? formatNumber(item, 2, locale) : String(item ?? "—");
  return <div className="table-wrap result-table"><table><thead><tr>{headers.map((header) => <th key={header}>{labels[header] ?? bi(locale, "Value", "數值")}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{headers.map((header) => <td key={header}>{value(header, row[header])}</td>)}</tr>)}</tbody></table></div>;
}

export default App;
