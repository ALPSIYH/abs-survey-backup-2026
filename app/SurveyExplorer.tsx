"use client";

import {
  BarChart3,
  Bot,
  Check,
  ChevronRight,
  Cloud,
  Database,
  Info,
  Languages,
  LineChart as LineChartIcon,
  MessageSquareText,
  Search,
  Send,
  Table2,
  WifiOff,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  analyzeQuestion,
  availableContexts,
  type AnalysisGroup,
  type Catalog,
  type Grouping,
  type Mode,
  type Question,
  type QuestionData,
} from "./analysis";

type Locale = "en" | "zh-Hant";
type Method = "distribution" | "summary";
type Surface = "workbench" | "conversation";

const COLORS = ["#1f6f9c", "#4e8d7c", "#9a6b49", "#6e5f7e", "#b3402a", "#6f7d39"];

const COUNTRY_ZH: Record<string, string> = {
  Japan: "日本",
  "Hong Kong": "香港",
  "South Korea": "韓國",
  "Mainland China": "中國大陸",
  Mongolia: "蒙古",
  Philippines: "菲律賓",
  Taiwan: "台灣",
  Thailand: "泰國",
  Indonesia: "印尼",
  Singapore: "新加坡",
  Vietnam: "越南",
  Cambodia: "柬埔寨",
  Malaysia: "馬來西亞",
  Myanmar: "緬甸",
  Australia: "澳洲",
  India: "印度",
  "New Zealand": "紐西蘭",
  "Timor-Leste": "東帝汶",
};

const SEARCH_ALIASES: Record<string, string> = {
  民主: "democracy democratic",
  滿意: "satisfied satisfaction",
  信任: "trust",
  政府: "government",
  國會: "parliament",
  經濟: "economic economy",
  中國: "china",
  美國: "united states america",
  影響: "influence",
  宗教: "religious religion",
  權威: "authority",
  選舉: "election vote",
  腐敗: "corruption",
  公平: "fair fairness",
  身份: "identity",
  認同: "identity support",
  參與: "participation",
  媒體: "media newspaper television internet",
};

function bi(locale: Locale, en: string, zh: string): string {
  return locale === "en" ? en : zh;
}

function countryName(locale: Locale, name: string): string {
  return locale === "en" ? name : COUNTRY_ZH[name] ?? name;
}

function formatNumber(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function normalizeSearch(query: string): string[] {
  let expanded = query.toLowerCase();
  for (const [source, target] of Object.entries(SEARCH_ALIASES)) {
    if (expanded.includes(source)) expanded += ` ${target}`;
  }
  return expanded
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 || /^q\d/.test(token));
}

function questionMatches(question: Question, query: string): number {
  const tokens = normalizeSearch(query);
  if (!tokens.length) return 1;
  const id = question.id.toLowerCase();
  const text = question.text.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (id === token) score += 30;
    else if (id.includes(token)) score += 8;
    if (text.includes(token)) score += token.length + 2;
  }
  return score;
}

function modeLabel(locale: Locale, mode: Mode): string {
  return {
    category: bi(locale, "Categorical", "類別"),
    order: bi(locale, "Ordinal", "有序"),
    continuous: bi(locale, "Continuous score", "連續分數"),
  }[mode];
}

function groupingLabel(locale: Locale, grouping: Grouping): string {
  return {
    none: bi(locale, "Combined", "合併"),
    country: bi(locale, "By country", "依國家"),
    wave: bi(locale, "By wave", "依波次"),
    country_wave: bi(locale, "Country × wave", "國家 × 波次"),
  }[grouping];
}

function recommendedGrouping(countryCount: number, waveCount: number): Grouping {
  if (countryCount > 1 && waveCount > 1) return "country_wave";
  if (countryCount > 1) return "country";
  if (waveCount > 1) return "wave";
  return "none";
}

export default function SurveyExplorer() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState("");
  const [questionData, setQuestionData] = useState<QuestionData | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState("q95");
  const [selectedCountries, setSelectedCountries] = useState<number[]>([1, 3]);
  const [selectedWaves, setSelectedWaves] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [mode, setMode] = useState<Mode>("continuous");
  const [method, setMethod] = useState<Method>("summary");
  const [grouping, setGrouping] = useState<Grouping>("country_wave");
  const [search, setSearch] = useState("");
  const [topic, setTopic] = useState("all");
  const [surface, setSurface] = useState<Surface>("workbench");
  const [locale, setLocale] = useState<Locale>("en");
  const [fontSize, setFontSize] = useState<"standard" | "large">("standard");
  const [scaleOpen, setScaleOpen] = useState(false);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantQuery, setAssistantQuery] = useState("");

  useEffect(() => {
    fetch("/data/catalog.json")
      .then((response) => {
        if (!response.ok) throw new Error("Catalog unavailable");
        return response.json() as Promise<Catalog>;
      })
      .then(setCatalog)
      .catch(() => setLoadError("The cloud dataset could not be loaded."));
  }, []);

  useEffect(() => {
    if (!selectedQuestionId) return;
    setQuestionData(null);
    fetch(`/data/questions/${selectedQuestionId}.json`)
      .then((response) => {
        if (!response.ok) throw new Error("Question unavailable");
        return response.json() as Promise<QuestionData>;
      })
      .then(setQuestionData)
      .catch(() => setLoadError("The selected question data could not be loaded."));
  }, [selectedQuestionId]);

  const selectedQuestion = useMemo(
    () => catalog?.questions.find((question) => question.id === selectedQuestionId) ?? null,
    [catalog, selectedQuestionId],
  );

  useEffect(() => {
    if (!selectedQuestion) return;
    if (!selectedQuestion.modes.includes(mode)) {
      setMode(
        selectedQuestion.modes.includes("continuous")
          ? "continuous"
          : selectedQuestion.modes.includes("order")
            ? "order"
            : "category",
      );
    }
  }, [selectedQuestion, mode]);

  useEffect(() => {
    if (mode === "category") setMethod("distribution");
  }, [mode]);

  const filteredQuestions = useMemo(() => {
    if (!catalog) return [];
    return catalog.questions
      .map((question) => ({ question, score: questionMatches(question, search) }))
      .filter(({ question, score }) => score > 0 && (topic === "all" || question.topicId === topic))
      .sort((a, b) => search ? b.score - a.score || a.question.position - b.question.position : a.question.position - b.question.position)
      .slice(0, 199)
      .map(({ question }) => question);
  }, [catalog, search, topic]);

  const contexts = useMemo(
    () => questionData ? availableContexts(questionData, mode) : new Set<string>(),
    [questionData, mode],
  );
  const missingContexts = useMemo(() => {
    if (!catalog || !questionData) return [];
    const countryMap = new Map(catalog.countries.map((country) => [country.code, country.name]));
    return selectedCountries.flatMap((countryCode) =>
      selectedWaves
        .filter((wave) => !contexts.has(`${countryCode}-${wave}`))
        .map((wave) => ({
          countryCode,
          wave,
          label: `${countryName(locale, countryMap.get(countryCode) ?? String(countryCode))} W${wave}`,
        })),
    );
  }, [catalog, questionData, selectedCountries, selectedWaves, contexts, locale]);

  const groups = useMemo(
    () => catalog && questionData
      ? analyzeQuestion(
          questionData,
          catalog.countries,
          selectedCountries,
          selectedWaves,
          mode,
          grouping,
        )
      : [],
    [catalog, questionData, selectedCountries, selectedWaves, mode, grouping],
  );

  const assistantCandidates = useMemo(() => {
    if (!catalog || !assistantQuery.trim()) return [];
    return catalog.questions
      .map((question) => ({ question, score: questionMatches(question, assistantQuery) }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || a.question.position - b.question.position)
      .slice(0, 6)
      .map((candidate) => candidate.question);
  }, [catalog, assistantQuery]);

  const selectQuestion = (question: Question) => {
    setSelectedQuestionId(question.id);
    setScaleOpen(false);
    const preferred = question.modes.includes("continuous")
      ? "continuous"
      : question.modes.includes("order")
        ? "order"
        : "category";
    setMode(preferred);
    setMethod(preferred === "category" ? "distribution" : "summary");
    setGrouping(recommendedGrouping(selectedCountries.length, selectedWaves.length));
    setSurface("workbench");
  };

  const toggleCountry = (code: number) => {
    setSelectedCountries((current) =>
      current.includes(code)
        ? current.filter((item) => item !== code)
        : [...current, code].sort((a, b) => a - b),
    );
  };
  const toggleWave = (wave: number) => {
    setSelectedWaves((current) =>
      current.includes(wave)
        ? current.filter((item) => item !== wave)
        : [...current, wave].sort(),
    );
  };
  const submitAssistant = (event: FormEvent) => {
    event.preventDefault();
    const query = assistantInput.trim();
    if (!query) return;
    setAssistantQuery(query);
    setAssistantInput("");
  };

  if (loadError) {
    return <main className="fatal-state"><Database size={28} /><strong>{loadError}</strong></main>;
  }
  if (!catalog) {
    return <main className="fatal-state"><Cloud className="pulse" size={28} /><strong>Loading cloud survey data…</strong></main>;
  }

  return (
    <div className={`app-shell font-${fontSize} surface-${surface}`}>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark"><BarChart3 size={19} /></span>
          <span>
            <strong>{bi(locale, "Asian Barometer Survey Explorer", "亞洲民主動態調查分析")}</strong>
            <small>{bi(locale, "Waves 1–6 · cloud aggregate edition", "第 1–6 波 · 雲端彙總資料版")}</small>
          </span>
        </div>
        <nav className="surface-switch" aria-label="View">
          <button className={surface === "conversation" ? "active" : ""} onClick={() => setSurface("conversation")}>
            <MessageSquareText size={14} />{bi(locale, "Question finder", "對話找題")}
          </button>
          <button className={surface === "workbench" ? "active" : ""} onClick={() => setSurface("workbench")}>
            <LineChartIcon size={14} />{bi(locale, "Analysis workbench", "分析工作台")}
          </button>
        </nav>
        <div className="top-controls">
          <div className="control-pair" aria-label="Language">
            <Languages size={14} />
            <button className={locale === "en" ? "active" : ""} onClick={() => setLocale("en")}>EN</button>
            <button className={locale === "zh-Hant" ? "active" : ""} onClick={() => setLocale("zh-Hant")}>中文</button>
          </div>
          <div className="control-pair" aria-label="Font size">
            <button className={fontSize === "standard" ? "active" : ""} onClick={() => setFontSize("standard")}>A</button>
            <button className={`large-a ${fontSize === "large" ? "active" : ""}`} onClick={() => setFontSize("large")}>A</button>
          </div>
        </div>
      </header>

      <aside className="library-panel">
        <div className="panel-heading">
          <span>{bi(locale, "Question library", "題目庫")}</span>
          <strong>{bi(locale, "Select a survey question", "選擇調查題目")}</strong>
        </div>
        <label className="search-box">
          <Search size={15} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={bi(locale, "Search question text or ID", "搜尋題目文字或題號")}
          />
        </label>
        <label className="topic-filter">
          <span>{bi(locale, "Topic", "分類")}</span>
          <select value={topic} onChange={(event) => setTopic(event.target.value)}>
            <option value="all">{bi(locale, "All research topics", "全部研究分類")}</option>
            {catalog.topics.map((item) => (
              <option key={item.id} value={item.id}>
                {locale === "en" ? item.labelEn : item.labelZh} ({item.questionCount})
              </option>
            ))}
          </select>
        </label>
        <div className="catalog-count">
          {filteredQuestions.length} {bi(locale, "questions", "題")}
        </div>
        <div className="catalog-list">
          {filteredQuestions.map((question) => (
            <button
              key={question.id}
              className={`catalog-item ${selectedQuestionId === question.id ? "selected" : ""}`}
              onClick={() => selectQuestion(question)}
            >
              <span>{question.id}</span>
              <strong>{question.text}</strong>
              <small>W{question.waves.join(", W")}</small>
              <em>{question.modes.map((item) => modeLabel(locale, item)).join(" · ")}</em>
            </button>
          ))}
        </div>
      </aside>

      <main className="workspace-panel">
        {selectedQuestion && questionData ? (
          <>
            <section className="active-question">
              <div>
                <span>{selectedQuestion.id} · W{selectedQuestion.waves.join(", W")}</span>
                <h1>{selectedQuestion.text}</h1>
                <p>{selectedQuestion.modes.map((item) => modeLabel(locale, item)).join(" · ")}</p>
              </div>
              <button className="secondary-button" onClick={() => setScaleOpen((current) => !current)}>
                <Info size={15} />
                {scaleOpen ? bi(locale, "Hide scale", "收起量表") : bi(locale, "View scale", "查看量表")}
              </button>
            </section>

            {scaleOpen && (
              <section className="scale-panel">
                <header>
                  <strong>{bi(locale, "Response scale and scoring", "回答量表與計分")}</strong>
                  <span>{questionData.scale.length} {bi(locale, "coded values", "個編碼值")}</span>
                </header>
                <div className="scale-grid">
                  {questionData.scale.map((value) => (
                    <div key={value[1]} className={value[3] === "included" ? "" : "excluded"}>
                      <code>{value[1]}</code>
                      <strong>{value[2]}</strong>
                      <small>
                        {value[4] !== null ? `${bi(locale, "Order", "順序")} ${value[4]}` : bi(locale, "No order", "不納入順序")}
                        {" · "}
                        {value[6] !== null ? `${bi(locale, "Score", "分數")} ${value[6]}` : bi(locale, "No score", "不納入計分")}
                      </small>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="analysis-controls">
              <ControlSection number="01" title={bi(locale, "Representation", "變量呈現")}>
                <div className="segmented">
                  {selectedQuestion.modes.map((item) => (
                    <button key={item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>
                      {modeLabel(locale, item)}
                    </button>
                  ))}
                </div>
              </ControlSection>
              <ControlSection number="02" title={bi(locale, "Analysis", "分析方式")}>
                <div className="method-options">
                  <button className={method === "distribution" ? "active" : ""} onClick={() => setMethod("distribution")}>
                    <BarChart3 size={17} />
                    <span><strong>{bi(locale, "Response distribution", "回答分布")}</strong><small>{bi(locale, "Counts and percentages", "各選項人數與百分比")}</small></span>
                  </button>
                  {mode !== "category" && (
                    <button className={method === "summary" ? "active" : ""} onClick={() => setMethod("summary")}>
                      <LineChartIcon size={17} />
                      <span>
                        <strong>{mode === "continuous" ? bi(locale, "Score summary", "分數摘要") : bi(locale, "Ordinal summary", "有序摘要")}</strong>
                        <small>{mode === "continuous"
                          ? bi(locale, "Mean, SD, median and quartiles", "平均數、標準差、中位數與四分位數")
                          : bi(locale, "Median response and quartiles", "中位回答與四分位數")}</small>
                      </span>
                    </button>
                  )}
                </div>
              </ControlSection>
              <ControlSection number="03" title={bi(locale, "Country and wave", "國家與波次")}>
                <div className="scope-block">
                  <div className="scope-heading">
                    <strong>{bi(locale, "Country or territory", "國家或地區")}</strong>
                    <button onClick={() => setSelectedCountries(
                      selectedCountries.length === catalog.countries.length
                        ? []
                        : catalog.countries.map((country) => country.code),
                    )}>
                      {selectedCountries.length === catalog.countries.length
                        ? bi(locale, "Clear all", "全部清除")
                        : bi(locale, "Select all", "全部選擇")}
                    </button>
                  </div>
                  <div className="chip-grid countries">
                    {catalog.countries.map((country) => {
                      const selected = selectedCountries.includes(country.code);
                      return (
                        <button key={country.code} className={selected ? "selected" : ""} onClick={() => toggleCountry(country.code)}>
                          {selected && <Check size={12} />}
                          {countryName(locale, country.name)}
                        </button>
                      );
                    })}
                  </div>
                  <div className="scope-heading wave-heading">
                    <strong>{bi(locale, "Survey wave", "調查波次")}</strong>
                    <button onClick={() => setSelectedWaves(
                      selectedWaves.length === catalog.waves.length ? [] : [...catalog.waves],
                    )}>
                      {selectedWaves.length === catalog.waves.length
                        ? bi(locale, "Clear all", "全部清除")
                        : bi(locale, "Select all", "全部選擇")}
                    </button>
                  </div>
                  <div className="chip-grid waves">
                    {catalog.waves.map((wave) => (
                      <button key={wave} className={selectedWaves.includes(wave) ? "selected" : ""} onClick={() => toggleWave(wave)}>
                        W{wave}
                      </button>
                    ))}
                  </div>
                </div>
              </ControlSection>
              <ControlSection number="04" title={bi(locale, "Split result", "結果拆分")}>
                <div className="segmented">
                  {(["none", "country", "wave", "country_wave"] as Grouping[]).map((item) => (
                    <button key={item} className={grouping === item ? "active" : ""} onClick={() => setGrouping(item)}>
                      {groupingLabel(locale, item)}
                    </button>
                  ))}
                </div>
              </ControlSection>
            </section>

            {missingContexts.length > 0 && (
              <section className="coverage-notice">
                <Info size={16} />
                <div>
                  <strong>
                    {bi(
                      locale,
                      `${missingContexts.length} selected country-wave cells have no data and are excluded.`,
                      `所選範圍中有 ${missingContexts.length} 個國家－波次組合沒有資料，結果已自動排除。`,
                    )}
                  </strong>
                  <p>{missingContexts.map((item) => item.label).join(locale === "en" ? ", " : "、")}</p>
                </div>
              </section>
            )}

            <ResultSection
              groups={groups}
              method={method}
              mode={mode}
              grouping={grouping}
              locale={locale}
              countries={catalog.countries.map((country) => ({
                code: country.code,
                name: countryName(locale, country.name),
              }))}
              hasScope={selectedCountries.length > 0 && selectedWaves.length > 0}
            />
          </>
        ) : (
          <section className="empty-state"><Cloud className="pulse" size={27} />{bi(locale, "Loading question data…", "正在載入題目資料…")}</section>
        )}
      </main>

      <aside className="assistant-panel">
        <div className="assistant-heading">
          <span><Bot size={18} /></span>
          <div>
            <strong>{bi(locale, "Question finder", "對話找題")}</strong>
            <small><Cloud size={12} />{bi(locale, "Cloud catalog connected", "雲端題庫已連線")}</small>
          </div>
        </div>
        <div className="assistant-status">
          <WifiOff size={15} />
          <p>
            <strong>{bi(locale, "Local model is not attached to this trial", "此試驗站尚未連接本機模型")}</strong>
            <span>{bi(locale, "Question discovery and all statistics below run from the cloud dataset.", "找題與下方全部統計均由雲端資料獨立執行。")}</span>
          </p>
        </div>
        <div className="assistant-thread">
          {!assistantQuery && (
            <div className="assistant-intro">
              <MessageSquareText size={24} />
              <strong>{bi(locale, "Search the survey in ordinary language", "用一般語言尋找題目")}</strong>
              <p>{bi(locale, "This first Sites build provides catalog matching without pretending that an LLM is online.", "第一版 Sites 使用題庫比對，不會假裝雲端模型已連線。")}</p>
              <div>
                {[
                  bi(locale, "Questions about China’s influence", "哪些題目與中國影響力有關？"),
                  bi(locale, "Trust in national government", "對中央政府的信任"),
                  bi(locale, "Satisfaction with democracy", "民主運作滿意度"),
                ].map((prompt) => (
                  <button key={prompt} onClick={() => setAssistantInput(prompt)}>
                    {prompt}<ChevronRight size={13} />
                  </button>
                ))}
              </div>
            </div>
          )}
          {assistantQuery && (
            <>
              <div className="chat-message user">{assistantQuery}</div>
              <div className="chat-message assistant">
                {assistantCandidates.length
                  ? bi(locale, "Select the closest survey question:", "請選擇最接近的調查題目：")
                  : bi(locale, "No matching question was found. Try a broader description.", "找不到符合的題目，請改用較廣泛的描述。")}
              </div>
              <div className="candidate-list">
                {assistantCandidates.map((question) => (
                  <button key={question.id} onClick={() => selectQuestion(question)}>
                    <strong>{question.id}</strong>
                    <span>{question.text}</span>
                    <small>W{question.waves.join(", W")}</small>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <form className="assistant-form" onSubmit={submitAssistant}>
          <textarea
            value={assistantInput}
            onChange={(event) => setAssistantInput(event.target.value)}
            placeholder={bi(locale, "Describe a topic or enter a question ID", "描述研究主題或輸入題號")}
            rows={3}
          />
          <div>
            <small>{bi(locale, "Enter to search", "Enter 搜尋")}</small>
            <button aria-label={bi(locale, "Search", "搜尋")} disabled={!assistantInput.trim()}>
              <Send size={16} />
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function ControlSection({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="control-section">
      <header><span>{number}</span><strong>{title}</strong></header>
      <div>{children}</div>
    </section>
  );
}

function ResultSection({
  groups,
  method,
  mode,
  grouping,
  locale,
  countries,
  hasScope,
}: {
  groups: AnalysisGroup[];
  method: Method;
  mode: Mode;
  grouping: Grouping;
  locale: Locale;
  countries: Array<{ code: number; name: string }>;
  hasScope: boolean;
}) {
  const [tab, setTab] = useState<"chart" | "table">("chart");
  const summaryMetric = mode === "continuous" ? "mean" : "median";
  const distributionLabels = [...new Set(groups.flatMap((group) => group.distribution.map((point) => point.label)))].slice(0, 8);
  const distributionData = groups.map((group) => {
    const row: Record<string, string | number> = { name: group.label };
    for (const label of distributionLabels) {
      row[label] = (group.distribution.find((point) => point.label === label)?.proportion ?? 0) * 100;
    }
    return row;
  });
  const countryMap = new Map(countries.map((country) => [country.code, country.name]));
  const trendCountries = [...new Set(groups.map((group) => group.countryCode).filter((code): code is number => code !== null))];
  const trendData = [...new Set(groups.map((group) => group.wave).filter((wave): wave is number => wave !== null))]
    .sort()
    .map((wave) => {
      const row: Record<string, string | number> = { name: `W${wave}` };
      for (const code of trendCountries) {
        const group = groups.find((item) => item.wave === wave && item.countryCode === code);
        row[countryMap.get(code) ?? String(code)] = summaryMetric === "mean"
          ? group?.summary.mean ?? Number.NaN
          : group?.summary.median ?? Number.NaN;
      }
      return row;
    });
  const summaryData = groups.map((group) => ({
    name: group.label,
    value: summaryMetric === "mean" ? group.summary.mean : group.summary.median,
  }));
  const totalN = groups.reduce((sum, group) => sum + group.summary.baseN, 0);

  return (
    <section className="result-section">
      <header className="result-heading">
        <div>
          <span>{bi(locale, "Analysis result", "分析結果")}</span>
          <strong>{method === "distribution"
            ? bi(locale, "Response distribution", "回答分布")
            : mode === "continuous"
              ? bi(locale, "Score summary", "分數摘要")
              : bi(locale, "Ordinal summary", "有序摘要")}</strong>
          <small>{groups.length} {bi(locale, "result groups", "組結果")} · N = {totalN.toLocaleString()}</small>
        </div>
        <nav>
          <button className={tab === "chart" ? "active" : ""} onClick={() => setTab("chart")}><BarChart3 size={14} />{bi(locale, "Chart", "圖表")}</button>
          <button className={tab === "table" ? "active" : ""} onClick={() => setTab("table")}><Table2 size={14} />{bi(locale, "Data", "資料")}</button>
        </nav>
      </header>
      {!hasScope ? (
        <div className="result-empty">{bi(locale, "Select at least one country and one wave.", "請至少選擇一個國家與一個波次。")}</div>
      ) : !groups.length ? (
        <div className="result-empty">{bi(locale, "No included observations are available in the selected scope.", "所選範圍沒有可納入的觀察值。")}</div>
      ) : tab === "chart" ? (
        <div className="chart-area">
          <ResponsiveContainer width="100%" height={Math.max(340, Math.min(620, groups.length * 38 + 230))}>
            {method === "distribution" ? (
              <BarChart data={distributionData} margin={{ top: 14, right: 24, left: 0, bottom: 26 }}>
                <CartesianGrid stroke="#e7e2d7" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={groups.length > 8 ? -25 : 0} textAnchor={groups.length > 8 ? "end" : "middle"} height={groups.length > 8 ? 70 : 36} />
                <YAxis tick={{ fontSize: 11 }} unit="%" />
                <Tooltip formatter={(value) => `${Number(value).toFixed(1)}%`} />
                <Legend />
                {distributionLabels.map((label, index) => (
                  <Bar key={label} dataKey={label} stackId="distribution" fill={COLORS[index % COLORS.length]} />
                ))}
              </BarChart>
            ) : grouping === "country_wave" ? (
              <LineChart data={trendData} margin={{ top: 14, right: 28, left: 0, bottom: 18 }}>
                <CartesianGrid stroke="#e7e2d7" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                <Tooltip formatter={(value) => formatNumber(Number(value))} />
                <Legend />
                {trendCountries.map((code, index) => {
                  const name = countryMap.get(code) ?? String(code);
                  return <Line key={code} type="monotone" dataKey={name} stroke={COLORS[index % COLORS.length]} strokeWidth={2.2} connectNulls={false} />;
                })}
              </LineChart>
            ) : (
              <BarChart data={summaryData} margin={{ top: 14, right: 24, left: 0, bottom: 34 }}>
                <CartesianGrid stroke="#e7e2d7" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={groups.length > 8 ? -25 : 0} textAnchor={groups.length > 8 ? "end" : "middle"} height={groups.length > 8 ? 70 : 36} />
                <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                <Tooltip formatter={(value) => formatNumber(Number(value))} />
                <Bar dataKey="value" name={summaryMetric === "mean" ? bi(locale, "Mean", "平均數") : bi(locale, "Median", "中位數")} fill="#1f6f9c" />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      ) : method === "distribution" ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{bi(locale, "Result group", "結果組別")}</th><th>{bi(locale, "Response", "回答")}</th><th>{bi(locale, "N", "人數")}</th><th>{bi(locale, "Percent", "百分比")}</th></tr></thead>
            <tbody>{groups.flatMap((group) => group.distribution.map((point) => (
              <tr key={`${group.key}-${point.key}`}>
                <td>{group.label}</td><td>{point.label}</td><td>{point.n.toLocaleString()}</td><td>{(point.proportion * 100).toFixed(1)}%</td>
              </tr>
            )))}</tbody>
          </table>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{bi(locale, "Result group", "結果組別")}</th><th>{bi(locale, "Valid N", "有效人數")}</th>{mode === "continuous" && <><th>{bi(locale, "Mean", "平均數")}</th><th>{bi(locale, "SD", "標準差")}</th></>}<th>{bi(locale, "Q1", "第 25 百分位")}</th><th>{bi(locale, "Median", "中位數")}</th><th>{bi(locale, "Q3", "第 75 百分位")}</th></tr></thead>
            <tbody>{groups.map((group) => (
              <tr key={group.key}>
                <td>{group.label}</td>
                <td>{group.summary.baseN.toLocaleString()}</td>
                {mode === "continuous" && <><td>{formatNumber(group.summary.mean)}</td><td>{formatNumber(group.summary.sd)}</td></>}
                <td>{group.summary.q25Label ?? formatNumber(group.summary.q25, 0)}</td>
                <td>{group.summary.medianLabel ?? formatNumber(group.summary.median, 0)}</td>
                <td>{group.summary.q75Label ?? formatNumber(group.summary.q75, 0)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
