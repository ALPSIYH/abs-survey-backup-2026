import {
  analyzeQuestion,
  type Catalog as StaticCatalog,
  type Grouping as StaticGrouping,
  type QuestionData,
} from "./analysis";
import type {
  AnalysisEnvelope,
  AssistantPlanResponse,
  AssistantStatus,
  Bootstrap,
  CatalogSearchResponse,
  Context,
  ConversationAppliedDelta,
  ConversationCommand,
  ConversationOption,
  ConversationResponse,
  ConversationSnapshot,
  ConversationSuggestion,
  ConversationTurn,
  DimensionValue,
  Draft,
  Mode,
  Question,
  QuestionDetail,
  ResponseSetDetail,
  ResultMetadata,
  ResultRow,
  StatisticalView,
} from "./types";

interface StaticResponseSetCatalog {
  id: string;
  label: string;
  memberCount: number;
  topicId: string;
}

interface StaticResponseSetData {
  id: string;
  label: string;
  topicId: string;
  members: Array<{
    variableId: string;
    memberOrder: number;
    questionText: string;
  }>;
  options: Array<[number, string, number]>;
  scopes: Record<
    string,
    {
      contexts: Array<[number, number, number]>;
      rows: Array<[number, number, number, number, number]>;
    }
  >;
}

interface CloudCatalog extends StaticCatalog {
  responseSets: StaticResponseSetCatalog[];
}

type Statistic = StatisticalView["statistic"];

interface ConversationPlan {
  questionId: string | null;
  statistic: Statistic | null;
  countries: number[];
  waves: number[];
}

interface ConversationState {
  id: string;
  revision: number;
  turns: ConversationTurn[];
  plan: ConversationPlan;
  pending: ConversationResponse["pending"];
  options: ConversationOption[];
  activeSnapshot: ConversationSnapshot | null;
  previousPlan: ConversationPlan | null;
}

const DATASET_ID = "abs-w1-w6-cloud-aggregate";
const ENGINE_VERSION = "sites-aggregate-v2";
const QUESTION_CACHE = new Map<string, Promise<QuestionData>>();
const RESPONSE_SET_CACHE = new Map<string, Promise<StaticResponseSetData>>();
const CONVERSATIONS = new Map<string, ConversationState>();
let catalogPromise: Promise<CloudCatalog> | null = null;
let sequence = 0;

const QUERY_ALIASES: Record<string, string> = {
  民主: "democracy democratic",
  滿意: "satisfied satisfaction",
  满意: "satisfied satisfaction",
  信任: "trust",
  政府: "government",
  國會: "parliament",
  国会: "parliament",
  經濟: "economic economy",
  经济: "economic economy",
  中國: "china",
  中国: "china",
  美國: "united states america",
  美国: "united states america",
  影響: "influence",
  影响: "influence",
  宗教: "religious religion",
  權威: "authority",
  权威: "authority",
  選舉: "election vote",
  选举: "election vote",
  腐敗: "corruption",
  腐败: "corruption",
  公平: "fair fairness",
  身份: "identity",
  認同: "identity support",
  认同: "identity support",
  參與: "participation",
  参与: "participation",
  媒體: "media newspaper television internet",
  媒体: "media newspaper television internet",
  軍隊: "army military",
  军队: "army military",
  法律: "law legal",
  貧富: "income inequality rich poor",
  贫富: "income inequality rich poor",
};

const COUNTRY_ALIASES: Array<[number, RegExp]> = [
  [1, /(?:\bjapan(?:ese)?\b|日本(?:人|民眾|民众)?)/iu],
  [2, /(?:\bhong\s*kong\b|香港(?:人)?)/iu],
  [3, /(?:\bsouth\s*korea(?:n)?\b|\bkorea(?:n)?\b|南韓|韓國(?:人)?|韩国(?:人)?)/iu],
  [4, /(?:\bmainland\s*china\b|中國大陸(?:人)?|中国大陆(?:人)?|大陸(?:人)?|大陆(?:人)?)/iu],
  [5, /(?:\bmongolia(?:n)?\b|蒙古(?:人)?)/iu],
  [6, /(?:\bphilippines?\b|\bfilipino\b|菲律賓(?:人)?|菲律宾(?:人)?)/iu],
  [7, /(?:\btaiwan(?:ese)?\b|台灣(?:人)?|台湾(?:人)?)/iu],
  [8, /(?:\bthailand\b|\bthai\b|泰國(?:人)?|泰国(?:人)?)/iu],
  [9, /(?:\bindonesia(?:n)?\b|印尼(?:人)?)/iu],
  [10, /(?:\bsingapore(?:an)?\b|新加坡(?:人)?)/iu],
  [11, /(?:\bvietnam(?:ese)?\b|越南(?:人)?)/iu],
  [12, /(?:\bcambodia(?:n)?\b|柬埔寨(?:人)?)/iu],
  [13, /(?:\bmalaysia(?:n)?\b|馬來西亞(?:人)?|马来西亚(?:人)?)/iu],
  [14, /(?:\bmyanmar\b|\bburmese\b|緬甸(?:人)?|缅甸(?:人)?)/iu],
  [15, /(?:\baustralia(?:n)?\b|澳洲(?:人)?|澳大利亞(?:人)?|澳大利亚(?:人)?)/iu],
  [18, /(?:\bindia(?:n)?\b|印度(?:人)?)/iu],
  [19, /(?:\bnew\s*zealand(?:er)?\b|紐西蘭(?:人)?|新西兰(?:人)?)/iu],
  [20, /(?:\btimor[-\s]?leste\b|東帝汶(?:人)?|东帝汶(?:人)?)/iu],
];

const COUNTRY_NAMES = new Map<number, string>([
  [1, "Japan"],
  [2, "Hong Kong"],
  [3, "South Korea"],
  [4, "Mainland China"],
  [5, "Mongolia"],
  [6, "Philippines"],
  [7, "Taiwan"],
  [8, "Thailand"],
  [9, "Indonesia"],
  [10, "Singapore"],
  [11, "Vietnam"],
  [12, "Cambodia"],
  [13, "Malaysia"],
  [14, "Myanmar"],
  [15, "Australia"],
  [18, "India"],
  [19, "New Zealand"],
  [20, "Timor-Leste"],
]);

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

function clonePlan(plan: ConversationPlan): ConversationPlan {
  return {
    questionId: plan.questionId,
    statistic: plan.statistic,
    countries: [...plan.countries],
    waves: [...plan.waves],
  };
}

function loadCatalog(): Promise<CloudCatalog> {
  if (!catalogPromise) {
    catalogPromise = fetch("/data/catalog.json").then((response) => {
      if (!response.ok) throw new Error("The cloud survey catalog is unavailable.");
      return response.json() as Promise<CloudCatalog>;
    });
  }
  return catalogPromise;
}

function loadQuestionData(id: string): Promise<QuestionData> {
  let request = QUESTION_CACHE.get(id);
  if (!request) {
    request = fetch(`/data/questions/${encodeURIComponent(id)}.json`).then((response) => {
      if (!response.ok) throw new Error("The requested survey item is unavailable.");
      return response.json() as Promise<QuestionData>;
    });
    QUESTION_CACHE.set(id, request);
  }
  return request;
}

function loadResponseSetData(id: string): Promise<StaticResponseSetData> {
  let request = RESPONSE_SET_CACHE.get(id);
  if (!request) {
    request = fetch(`/data/response-sets/${encodeURIComponent(id)}.json`).then((response) => {
      if (!response.ok) throw new Error("The requested response set is unavailable.");
      return response.json() as Promise<StaticResponseSetData>;
    });
    RESPONSE_SET_CACHE.set(id, request);
  }
  return request;
}

function topicInfo(catalog: CloudCatalog, topicId: string): {
  topic_id: string;
  topic_label: string;
} {
  const topic = catalog.topics.find((item) => item.id === topicId);
  return {
    topic_id: topicId,
    topic_label: topic?.labelEn ?? topicId,
  };
}

function toQuestion(catalog: CloudCatalog, item: CloudCatalog["questions"][number]): Question {
  return {
    variable_id: item.id,
    question_text: item.text,
    selection_mode: item.selectionMode as Question["selection_mode"],
    response_set_id: item.responseSetId,
    member_order: item.memberOrder,
    ...topicInfo(catalog, item.topicId),
    modes: item.modes,
    waves: item.waves,
  };
}

function included(scale: QuestionData["scale"][number], mode: Mode): boolean {
  if (mode === "category") return scale[3] === "included";
  if (mode === "order") return scale[5] === "included";
  return scale[7] === "included";
}

function rawKey(value: number | null): string {
  return value === null ? "__null__" : String(value);
}

function questionContexts(data: QuestionData, mode: Mode): Context[] {
  const settings = new Map(data.scale.map((item) => [rawKey(item[0]), item]));
  const counts = new Map<string, Context>();
  for (const [country, wave, value, count] of data.cells) {
    const scale = settings.get(rawKey(value));
    if (!scale || !included(scale, mode)) continue;
    const key = `${country}:${wave}`;
    const current = counts.get(key) ?? {
      country_code: country,
      wave,
      unweighted_n: 0,
    };
    current.unweighted_n += count;
    counts.set(key, current);
  }
  return [...counts.values()].sort(
    (left, right) =>
      left.country_code - right.country_code || left.wave - right.wave,
  );
}

async function bootstrap(): Promise<Bootstrap> {
  const catalog = await loadCatalog();
  return {
    dataset: {
      dataset_id: DATASET_ID,
      builder_version: catalog.dataset.builderVersion,
      engine_version: ENGINE_VERSION,
      source_rows: catalog.dataset.sourceRows,
      question_count: catalog.dataset.questionCount,
    },
    countries: catalog.countries.map((country) => ({
      country_code: country.code,
      display_name: country.name,
    })),
    waves: catalog.waves,
    topics: catalog.topics.map((topic) => ({
      topic_id: topic.id,
      label: topic.labelEn,
      question_count: topic.questionCount,
    })),
    questions: catalog.questions.map((question) => toQuestion(catalog, question)),
    response_sets: catalog.responseSets.map((responseSet) => ({
      response_set_id: responseSet.id,
      label: responseSet.label,
      member_count: responseSet.memberCount,
      ...topicInfo(catalog, responseSet.topicId),
    })),
    assistant: {
      provider: "offline",
      available: true,
      label: "Cloud catalog and statistics",
      detail: "Deterministic survey planning with aggregate cloud analysis",
    },
  };
}

async function question(id: string): Promise<QuestionDetail> {
  const [catalog, data] = await Promise.all([loadCatalog(), loadQuestionData(id)]);
  const item = catalog.questions.find((candidate) => candidate.id === id);
  if (!item) throw new Error("The requested survey item is unavailable.");
  const base = toQuestion(catalog, item);
  return {
    ...base,
    scale: data.scale.map((value) => ({
      raw_value: value[0],
      raw_value_key: value[1],
      category_label: value[2],
      category_status: value[3] as "included" | "excluded",
      order_position: value[4],
      order_status: value[5] as "included" | "excluded",
      continuous_score: value[6],
      continuous_status: value[7] as "included" | "excluded",
    })),
    contexts: Object.fromEntries(
      base.modes.map((mode) => [mode, questionContexts(data, mode)]),
    ),
  };
}

async function responseSet(id: string): Promise<ResponseSetDetail> {
  const [catalog, data] = await Promise.all([loadCatalog(), loadResponseSetData(id)]);
  const set = catalog.responseSets.find((candidate) => candidate.id === id);
  if (!set) throw new Error("The requested response set is unavailable.");
  const any = data.scopes.any?.contexts ?? [];
  return {
    response_set_id: set.id,
    label: set.label,
    member_count: set.memberCount,
    ...topicInfo(catalog, set.topicId),
    members: data.members.map((member) => ({
      variable_id: member.variableId,
      member_order: member.memberOrder,
      question_text: member.questionText,
    })),
    contexts: any.map(([country_code, wave, unweighted_n]) => ({
      country_code,
      wave,
      unweighted_n,
    })),
    member_contexts: Object.fromEntries(
      data.members.map((member) => [
        String(member.memberOrder),
        (data.scopes[String(member.memberOrder)]?.contexts ?? []).map(
          ([country_code, wave, unweighted_n]) => ({
            country_code,
            wave,
            unweighted_n,
          }),
        ),
      ]),
    ),
  };
}

function dimensionsFor(
  grouping: Draft["grouping"],
  countryCode: number | null,
  wave: number | null,
  countryNames: Map<number, string>,
): DimensionValue[] {
  const dimensions: DimensionValue[] = [];
  if ((grouping === "country" || grouping === "country_wave") && countryCode != null) {
    dimensions.push({
      kind: "country",
      variable_id: null,
      value_key: String(countryCode),
      label: countryNames.get(countryCode) ?? String(countryCode),
      order: countryCode,
    });
  }
  if ((grouping === "wave" || grouping === "country_wave") && wave != null) {
    dimensions.push({
      kind: "wave",
      variable_id: null,
      value_key: String(wave),
      label: `Wave ${wave}`,
      order: wave,
    });
  }
  return dimensions;
}

function hashDraft(draft: Draft): string {
  const text = JSON.stringify({ ...draft, revision: 0 });
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `cloud-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function metadata(
  draft: Draft,
  totalRecords: number,
  includedRecords: number,
  elapsedMs: number,
  warnings: string[],
): ResultMetadata {
  return {
    request_hash: hashDraft(draft),
    dataset_id: DATASET_ID,
    builder_version: "merged-only-cloud-1",
    engine_version: ENGINE_VERSION,
    request_type: draft.operation ?? "distribution",
    weight_mode: "none",
    weight_id: null,
    denominator_definition:
      draft.grouping === "none"
        ? "included responses within each selected context"
        : "included responses within each selected group",
    total_records_n: totalRecords,
    analysis_unweighted_n: includedRecords,
    analysis_weight_sum: null,
    quantile_method:
      draft.operation === "summary" ? "empirical inverse CDF" : null,
    elapsed_ms: elapsedMs,
    warnings,
  };
}

function selectedContext(
  country: number,
  wave: number,
  countries: Set<number>,
  waves: Set<number>,
): boolean {
  return countries.has(country) && waves.has(wave);
}

async function analyzeQuestionDraft(draft: Draft): Promise<AnalysisEnvelope> {
  if (!draft.target_id || !draft.mode || !draft.operation) {
    throw new Error("Review the selected question, countries, waves, and statistic.");
  }
  const started = Date.now();
  const [catalog, data] = await Promise.all([
    loadCatalog(),
    loadQuestionData(draft.target_id),
  ]);
  const countries = new Set(draft.countries);
  const waves = new Set(draft.waves);
  const countryNames = new Map(
    catalog.countries.map((country) => [country.code, country.name]),
  );
  const groups = analyzeQuestion(
    data,
    catalog.countries,
    draft.countries,
    draft.waves,
    draft.mode,
    draft.grouping as StaticGrouping,
  );
  const totalRecords = data.cells
    .filter((cell) => selectedContext(cell[0], cell[1], countries, waves))
    .reduce((sum, cell) => sum + cell[3], 0);
  const includedRecords = groups.reduce((sum, group) => sum + group.summary.baseN, 0);
  const rows: ResultRow[] = [];
  for (const group of groups) {
    const dimensions = dimensionsFor(
      draft.grouping,
      group.countryCode,
      group.wave,
      countryNames,
    );
    if (draft.operation === "distribution") {
      for (const point of group.distribution) {
        rows.push({
          dimensions,
          raw_value: point.rawValue,
          raw_value_key: point.key,
          category_label: point.label,
          label: point.label,
          order_position: point.orderPosition,
          continuous_score: point.continuousScore,
          unweighted_n: point.n,
          denominator: group.summary.baseN,
          proportion: point.proportion,
          base_n: group.summary.baseN,
        });
      }
      continue;
    }
    const estimates: Array<[string, number | null, string | null]> =
      draft.mode === "continuous"
        ? [
            ["base_n", group.summary.baseN, null],
            ["mean", group.summary.mean, null],
            ["sd", group.summary.sd, null],
            [
              "min",
              group.distribution.length
                ? Math.min(
                    ...group.distribution
                      .map((point) => point.continuousScore)
                      .filter((value): value is number => value != null),
                  )
                : null,
              null,
            ],
            [
              "max",
              group.distribution.length
                ? Math.max(
                    ...group.distribution
                      .map((point) => point.continuousScore)
                      .filter((value): value is number => value != null),
                  )
                : null,
              null,
            ],
            ["q25", group.summary.q25, null],
            ["median", group.summary.median, null],
            ["q75", group.summary.q75, null],
          ]
        : [
            ["base_n", group.summary.baseN, null],
            ["q25", group.summary.q25, group.summary.q25Label],
            ["median", group.summary.median, group.summary.medianLabel],
            ["q75", group.summary.q75, group.summary.q75Label],
          ];
    for (const [metric, estimate, label] of estimates) {
      if (estimate == null) continue;
      rows.push({
        dimensions,
        metric,
        estimate,
        label,
        base_n: group.summary.baseN,
        estimate_base: group.summary.baseN,
      });
    }
  }
  return {
    draft,
    canonical_request: {
      target_id: draft.target_id,
      mode: draft.mode,
      operation: draft.operation,
      countries: draft.countries,
      waves: draft.waves,
      grouping: draft.grouping,
    },
    result: {
      result_type: draft.operation,
      metadata: metadata(
        draft,
        totalRecords,
        includedRecords,
        Date.now() - started,
        [],
      ),
      rows,
    },
  };
}

function responseSetGroupKey(
  grouping: Draft["grouping"],
  country: number,
  wave: number,
): string {
  if (grouping === "country") return `c:${country}`;
  if (grouping === "wave") return `w:${wave}`;
  if (grouping === "country_wave") return `c:${country}:w:${wave}`;
  return "all";
}

async function analyzeResponseSetDraft(draft: Draft): Promise<AnalysisEnvelope> {
  if (!draft.target_id) {
    throw new Error("Review the selected response set and data scope.");
  }
  const started = Date.now();
  const [catalog, data] = await Promise.all([
    loadCatalog(),
    loadResponseSetData(draft.target_id),
  ]);
  const scope =
    draft.response_scope === "specific_member" && draft.member_order
      ? String(draft.member_order)
      : "any";
  const selected = data.scopes[scope];
  if (!selected) throw new Error("The selected response position is unavailable.");
  const countries = new Set(draft.countries);
  const waves = new Set(draft.waves);
  const countryNames = new Map(
    catalog.countries.map((country) => [country.code, country.name]),
  );
  const groupContexts = new Map<
    string,
    { country: number | null; wave: number | null; base: number }
  >();
  for (const [country, wave, base] of selected.contexts) {
    if (!selectedContext(country, wave, countries, waves)) continue;
    const key = responseSetGroupKey(draft.grouping, country, wave);
    const current = groupContexts.get(key) ?? {
      country:
        draft.grouping === "country" || draft.grouping === "country_wave"
          ? country
          : null,
      wave:
        draft.grouping === "wave" || draft.grouping === "country_wave"
          ? wave
          : null,
      base: 0,
    };
    current.base += base;
    groupContexts.set(key, current);
  }
  const counts = new Map<string, number>();
  for (const [country, wave, rawValue, , count] of selected.rows) {
    if (!selectedContext(country, wave, countries, waves)) continue;
    const groupKey = responseSetGroupKey(draft.grouping, country, wave);
    counts.set(`${groupKey}:${rawValue}`, (counts.get(`${groupKey}:${rawValue}`) ?? 0) + count);
  }
  const rows: ResultRow[] = [];
  for (const [groupKey, context] of groupContexts) {
    const dimensions = dimensionsFor(
      draft.grouping,
      context.country,
      context.wave,
      countryNames,
    );
    for (const [rawValue, label] of data.options) {
      const count = counts.get(`${groupKey}:${rawValue}`) ?? 0;
      rows.push({
        dimensions,
        raw_value: rawValue,
        option_label: label,
        label,
        member_order:
          draft.response_scope === "specific_member" ? draft.member_order : null,
        base_n: context.base,
        unweighted_n: count,
        denominator: context.base,
        proportion: context.base ? count / context.base : 0,
      });
    }
  }
  const memberOne = data.members[0]?.variableId;
  const memberData = memberOne ? await loadQuestionData(memberOne) : null;
  const totalRecords = memberData
    ? memberData.cells
        .filter((cell) => selectedContext(cell[0], cell[1], countries, waves))
        .reduce((sum, cell) => sum + cell[3], 0)
    : [...groupContexts.values()].reduce((sum, context) => sum + context.base, 0);
  const includedRecords = [...groupContexts.values()].reduce(
    (sum, context) => sum + context.base,
    0,
  );
  return {
    draft,
    canonical_request: {
      response_set_id: draft.target_id,
      scope,
      countries: draft.countries,
      waves: draft.waves,
      grouping: draft.grouping,
    },
    result: {
      result_type: "multi_response",
      metadata: metadata(
        { ...draft, operation: "multi_response" },
        totalRecords,
        includedRecords,
        Date.now() - started,
        [],
      ),
      rows,
    },
  };
}

async function analyze(draft: Draft): Promise<AnalysisEnvelope> {
  if (!draft.countries.length || !draft.waves.length) {
    throw new Error("Review the selected question, countries, waves, and statistic.");
  }
  return draft.target_kind === "response_set"
    ? analyzeResponseSetDraft(draft)
    : analyzeQuestionDraft(draft);
}

function normalizeQuery(query: string): string {
  let expanded = query.normalize("NFKC").toLowerCase();
  for (const [source, target] of Object.entries(QUERY_ALIASES)) {
    if (expanded.includes(source)) expanded += ` ${target}`;
  }
  return expanded
    .replace(
      /\b(?:mean|average|distribution|median|quartiles?|standard deviation|trend|wave|waves|country|countries|respondents?)\b/giu,
      " ",
    )
    .replace(
      /(?:平均分?|分佈|分布|中位數?|中位回答|四分位數?|標準差|标准差|趨勢|趋势|波次|國家|国家|受訪者|受访者)/gu,
      " ",
    )
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .trim();
}

function searchScore(questionItem: Question, query: string): number {
  const normalized = normalizeQuery(query);
  const exactId = query.match(/\bq\d+(?:\.\d+)?\b/i)?.[0]?.toLowerCase();
  if (exactId === questionItem.variable_id.toLowerCase()) return 10_000;
  const tokens = normalized.split(/\s+/).filter((token) => token.length > 1);
  if (!tokens.length) return 0;
  const haystack = `${questionItem.variable_id} ${questionItem.question_text} ${questionItem.topic_label}`.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += token.length + 4;
  }
  const coverage = score ? tokens.filter((token) => haystack.includes(token)).length / tokens.length : 0;
  return score * (0.45 + coverage);
}

async function catalogSearch(query: string, limit = 20): Promise<CatalogSearchResponse> {
  const data = await bootstrap();
  const questions = data.questions
    .map((item) => ({ item, score: searchScore(item, query) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ item }) => item);
  return { query, questions };
}

function parseStatistic(message: string): Statistic | null {
  const normalized = message.normalize("NFKC").toLowerCase();
  if (/standard deviation|\bsd\b|標準差|标准差/u.test(normalized)) return "sd";
  if (/quartiles?|四分位/u.test(normalized)) return "quartiles";
  if (/median|中位/u.test(normalized)) return "median";
  if (/valid (?:n|responses?)|sample size|有效人數|有效人数|樣本數|样本数/u.test(normalized)) return "base_n";
  if (/distribution|分佈|分布|各選項|各选项/u.test(normalized)) return "distribution";
  if (/mean|average|平均/u.test(normalized)) return "mean";
  return null;
}

function parseCountries(message: string): {
  values: number[];
  operation: "set" | "add" | "remove";
  all: boolean;
  unsupported: boolean;
} {
  const normalized = message.normalize("NFKC");
  const values = COUNTRY_ALIASES.filter(([, pattern]) => pattern.test(normalized)).map(
    ([code]) => code,
  );
  const remove = /(?:remove|exclude|drop|without|刪除|删除|移除|排除|不要)/iu.test(
    normalized,
  );
  const add = /(?:add|include|plus|also|增加|新增|加入|加上|也看|再加)/iu.test(
    normalized,
  );
  const all = /(?:all (?:countries|regions|places)|全部(?:國家|国家|地區|地区))/iu.test(
    normalized,
  );
  const unsupported =
    /^(?:americans?|美國人|美国人)[？?!.。]*$/iu.test(normalized.trim()) ||
    /(?:american|united states)\s+(?:respondents?|sample|survey data)|(?:美國人|美国人)(?:的)?(?:數據|数据|資料|资料|樣本|样本|調查|调查)|(?:我要看|改成|換成|换成|受訪者(?:是|改成)?|受访者(?:是|改成)?|樣本(?:是|改成)?|样本(?:是|改成)?)[^。！？!?\n]{0,16}(?:美國人|美国人)/iu.test(
      normalized,
    );
  return {
    values: [...new Set(values)],
    operation: remove ? "remove" : add ? "add" : "set",
    all,
    unsupported,
  };
}

function parseWaves(message: string): {
  values: number[];
  operation: "set" | "add" | "remove";
  all: boolean;
} {
  const normalized = message.normalize("NFKC").toLowerCase();
  const values = [
    ...normalized.matchAll(/(?:\bwave\s*|\bw\s*|第\s*)([1-6])(?:\s*波)?\b/giu),
  ].map((match) => Number(match[1]));
  const remove = /(?:remove|exclude|drop|without|刪除|删除|移除|排除|不要)/iu.test(
    normalized,
  );
  const add = /(?:add|include|plus|also|增加|新增|加入|加上|也看|再加)/iu.test(
    normalized,
  );
  const all =
    /(?:all waves|across waves|over time|trend|全部波次|所有波次|各波|趨勢|趋势)/iu.test(
      normalized,
    );
  return {
    values: [...new Set(values)].sort(),
    operation: remove ? "remove" : add ? "add" : "set",
    all,
  };
}

function applyListChange(
  current: number[],
  operation: "set" | "add" | "remove",
  values: number[],
): number[] {
  if (operation === "set") return [...new Set(values)].sort((a, b) => a - b);
  if (operation === "add") {
    return [...new Set([...current, ...values])].sort((a, b) => a - b);
  }
  const removed = new Set(values);
  return current.filter((value) => !removed.has(value));
}

function addTurn(
  state: ConversationState,
  role: ConversationTurn["role"],
  message: string,
  artifactId: string | null = null,
  kind: ConversationTurn["kind"] = "message",
): void {
  state.turns.push({
    turn_id: nextId("turn"),
    role,
    message,
    artifact_id: artifactId,
    flow_id: state.id,
    kind,
  });
}

function publicConversation(
  state: ConversationState,
  status: ConversationResponse["status"] = "needs_clarification",
  action: ConversationResponse["action"] = "clarified",
  message = "",
  suggestions: ConversationSuggestion[] = [],
  delta: ConversationAppliedDelta | null = null,
): ConversationResponse {
  return {
    conversation_id: state.id,
    revision: state.revision,
    status,
    action,
    message,
    turns: [...state.turns],
    pending: state.pending,
    options: [...state.options],
    suggestions,
    active_snapshot: state.activeSnapshot,
    applied_delta: delta,
    no_op_reasons: [],
  };
}

function setPending(
  state: ConversationState,
  kind: string,
  question: string,
  missingSlots: string[],
  options: ConversationOption[],
): void {
  state.pending = {
    pending_id: nextId("pending"),
    kind,
    question,
    missing_slots: missingSlots,
  };
  state.options = options;
}

function statisticOptions(questionItem: Question): ConversationOption[] {
  const values: Array<[Statistic, string]> = [["distribution", "Response distribution"]];
  if (questionItem.modes.includes("continuous")) {
    values.push(
      ["mean", "Mean score"],
      ["sd", "Standard deviation"],
    );
  }
  if (questionItem.modes.includes("order")) {
    values.push(
      ["median", "Median response"],
      ["quartiles", "Quartiles"],
    );
  }
  values.push(["base_n", "Valid responses"]);
  return values.map(([value, label]) => ({
    option_id: nextId("option"),
    label,
    value,
    description: null,
  }));
}

async function planDraft(plan: ConversationPlan): Promise<Draft> {
  const data = await bootstrap();
  const questionItem = data.questions.find(
    (candidate) => candidate.variable_id === plan.questionId,
  );
  if (!questionItem || !plan.statistic) {
    throw new Error("The analysis request is incomplete.");
  }
  const statistic = plan.statistic;
  const mode: Mode =
    statistic === "mean" || statistic === "sd"
      ? "continuous"
      : statistic === "median" || statistic === "quartiles"
        ? "order"
        : "category";
  const operation = statistic === "distribution" ? "distribution" : "summary";
  const grouping: Draft["grouping"] =
    plan.countries.length > 1 && plan.waves.length > 1
      ? "country_wave"
      : plan.countries.length > 1
        ? "country"
        : plan.waves.length > 1
          ? "wave"
          : "none";
  return {
    schema_version: 2,
    target_kind: "question",
    target_id: questionItem.variable_id,
    mode: questionItem.modes.includes(mode)
      ? mode
      : questionItem.modes.includes("order")
        ? "order"
        : "category",
    operation,
    countries: plan.countries,
    waves: plan.waves,
    grouping,
    coverage_policy: "cellwise_available",
    weighted: false,
    secondary_id: null,
    secondary_mode: null,
    percentage_basis: "row",
    response_scope: "any_member",
    member_order: null,
    origin: "assistant",
    revision: stateRevision(),
  };
}

function stateRevision(): number {
  return sequence + 1;
}

function viewFromEnvelope(
  envelope: AnalysisEnvelope,
  detail: QuestionDetail,
  statistic: Statistic,
): StatisticalView {
  const resultRows =
    statistic === "distribution"
      ? envelope.result.rows
      : statistic === "quartiles"
        ? envelope.result.rows.filter((row) =>
            ["q25", "median", "q75"].includes(String(row.metric)),
          )
        : envelope.result.rows.filter((row) => row.metric === statistic);
  const rows = resultRows.map((row) => ({
    dimensions: row.dimensions ?? [],
    metric: String(row.metric ?? statistic),
    estimate:
      statistic === "distribution"
        ? Number(row.proportion ?? 0)
        : Number(row.estimate ?? 0),
    label:
      statistic === "distribution"
        ? String(row.category_label ?? row.label ?? "")
        : row.label ?? null,
    order_position: row.order_position ?? null,
    raw_value_key:
      row.raw_value === null || row.raw_value === undefined
        ? null
        : String(row.raw_value),
    base_n: Number(row.base_n ?? row.denominator ?? 0),
    numerator_n:
      statistic === "distribution" ? Number(row.unweighted_n ?? 0) : null,
    denominator_n:
      statistic === "distribution" ? Number(row.denominator ?? 0) : null,
  }));
  const contexts = detail.contexts[envelope.draft.mode ?? "category"] ?? [];
  const available = new Set(contexts.map((item) => `${item.country_code}:${item.wave}`));
  const requested = envelope.draft.countries.flatMap((country_code) =>
    envelope.draft.waves.map((wave) => ({ country_code, wave })),
  );
  const scale = detail.scale.filter((item) =>
    envelope.draft.mode === "continuous"
      ? item.continuous_status === "included"
      : envelope.draft.mode === "order"
        ? item.order_status === "included"
        : item.category_status === "included",
  );
  return {
    question_id: detail.variable_id,
    question_text: detail.question_text,
    statistic,
    representation: envelope.draft.mode ?? "category",
    presentation_type:
      statistic === "distribution"
        ? envelope.draft.waves.length > 1
          ? "distribution_over_time"
          : "distribution"
        : envelope.draft.waves.length > 1
          ? "trend"
          : envelope.draft.countries.length > 1
            ? "comparison"
            : statistic === "quartiles"
              ? "quartiles"
              : "metric",
    rows,
    metadata: envelope.result.metadata,
    coverage: {
      requested_contexts: requested,
      available_contexts: requested.filter((item) =>
        available.has(`${item.country_code}:${item.wave}`),
      ),
      excluded_contexts: requested
        .filter((item) => !available.has(`${item.country_code}:${item.wave}`))
        .map((item) => ({ ...item, reason: "no data available" })),
      effective_policy: "cellwise_available",
    },
    score_direction:
      scale.length > 1
        ? `${scale[0].category_label} → ${scale.at(-1)?.category_label ?? ""}`
        : null,
  };
}

function suggestionsFor(
  state: ConversationState,
  detail: QuestionDetail,
): ConversationSuggestion[] {
  const countries = new Set(
    Object.values(detail.contexts)
      .flat()
      .map((context) => context?.country_code)
      .filter((value): value is number => typeof value === "number"),
  );
  const waves = new Set(
    Object.values(detail.contexts)
      .flat()
      .map((context) => context?.wave)
      .filter((value): value is number => typeof value === "number"),
  );
  return [
    {
      action_id: nextId("suggestion"),
      label:
        state.plan.statistic === "distribution"
          ? "View mean score"
          : "View response distribution",
      command: {
        kind: "set_statistic",
        statistic:
          state.plan.statistic === "distribution" ? "mean" : "distribution",
      },
      control: "command",
      choices: [],
      based_on_revision: state.revision,
    },
    {
      action_id: nextId("suggestion"),
      label: "Change countries and regions",
      command: { kind: "modify_countries", operation: "set", selector: "explicit" },
      control: "country_multiselect",
      choices: [...COUNTRY_ALIASES].map(([code]) => ({
        value: String(code),
        label: COUNTRY_NAMES.get(code) ?? String(code),
        selected: state.plan.countries.includes(code),
        available: countries.has(code),
        description: countries.has(code) ? null : "No data for this question",
      })),
      based_on_revision: state.revision,
    },
    {
      action_id: nextId("suggestion"),
      label: "Change survey waves",
      command: {
        kind: "modify_waves",
        operation: "set",
        selector: "explicit",
      },
      control: "wave_multiselect",
      choices: [1, 2, 3, 4, 5, 6].map((wave) => ({
        value: String(wave),
        label: `Wave ${wave}`,
        selected: state.plan.waves.includes(wave),
        available: waves.has(wave),
        description: waves.has(wave) ? null : "No data for this question",
      })),
      based_on_revision: state.revision,
    },
    {
      action_id: nextId("suggestion"),
      label: "Analyze another question",
      command: { kind: "repair", operation: "restart_question" },
      control: "command",
      choices: [],
      based_on_revision: state.revision,
    },
  ];
}

async function answerPlan(
  state: ConversationState,
  action: ConversationResponse["action"] = "analyzed",
  delta: ConversationAppliedDelta | null = null,
): Promise<ConversationResponse> {
  const data = await bootstrap();
  const questionItem = data.questions.find(
    (candidate) => candidate.variable_id === state.plan.questionId,
  );
  if (!questionItem) {
    setPending(state, "question", "Choose a survey question.", ["question"], []);
    const message = "Choose a survey question before continuing.";
    addTurn(state, "assistant", message);
    return publicConversation(state, "needs_clarification", "clarified", message);
  }
  const statisticSupported =
    !state.plan.statistic ||
    state.plan.statistic === "distribution" ||
    state.plan.statistic === "base_n" ||
    ((state.plan.statistic === "mean" || state.plan.statistic === "sd") &&
      questionItem.modes.includes("continuous")) ||
    ((state.plan.statistic === "median" ||
      state.plan.statistic === "quartiles") &&
      questionItem.modes.includes("order"));
  if (!statisticSupported) {
    state.plan.statistic = null;
  }
  if (!state.plan.statistic) {
    const options = statisticOptions(questionItem);
    setPending(
      state,
      "statistic",
      "Choose a statistic.",
      ["statistic"],
      options,
    );
    const message = `Found ${questionItem.variable_id} · ${questionItem.question_text}. Choose the statistic to display.`;
    addTurn(state, "assistant", message);
    return publicConversation(state, "needs_clarification", "clarified", message);
  }
  const detail = await question(questionItem.variable_id);
  const mode: Mode =
    state.plan.statistic === "mean" || state.plan.statistic === "sd"
      ? "continuous"
      : state.plan.statistic === "median" ||
          state.plan.statistic === "quartiles"
        ? "order"
        : "category";
  const contexts = detail.contexts[mode] ?? detail.contexts.category ?? [];
  if (!state.plan.countries.length) {
    const available = [...new Set(contexts.map((context) => context.country_code))];
    const allOption: ConversationOption = {
      option_id: nextId("option"),
      label: "All available countries and regions",
      value: "all",
      description: null,
    };
    const options = [
      allOption,
      ...data.countries
        .filter((country) => available.includes(country.country_code))
        .map((country) => ({
          option_id: nextId("option"),
          label: country.display_name,
          value: String(country.country_code),
          description: null,
        })),
    ];
    setPending(state, "country", "Choose countries or regions.", ["countries"], options);
    const message = `Found ${questionItem.variable_id} · ${questionItem.question_text}. Choose the respondent countries or regions.`;
    addTurn(state, "assistant", message);
    return publicConversation(state, "needs_clarification", "clarified", message);
  }
  if (!state.plan.waves.length) {
    const available = [
      ...new Set(
        contexts
          .filter((context) => state.plan.countries.includes(context.country_code))
          .map((context) => context.wave),
      ),
    ].sort();
    const options: ConversationOption[] = [
      {
        option_id: nextId("option"),
        label: "All available waves",
        value: "all",
        description: available.map((wave) => `W${wave}`).join(", "),
      },
      ...available.map((wave) => ({
        option_id: nextId("option"),
        label: `Wave ${wave}`,
        value: String(wave),
        description: null,
      })),
    ];
    setPending(state, "wave", "Choose survey waves.", ["waves"], options);
    const message = `${questionItem.variable_id} is available in several waves. Choose one wave or all available waves.`;
    addTurn(state, "assistant", message);
    return publicConversation(state, "needs_clarification", "clarified", message);
  }
  state.pending = null;
  state.options = [];
  const draft = await planDraft(state.plan);
  const envelope = await analyze(draft);
  const view = viewFromEnvelope(envelope, detail, state.plan.statistic);
  state.activeSnapshot = {
    snapshot_id: nextId("snapshot"),
    draft,
    intent: { statistic: state.plan.statistic },
    canonical_request: envelope.canonical_request,
    result: envelope.result,
    view,
  };
  const excluded = view.coverage.excluded_contexts;
  const message = `Completed the ${state.plan.statistic.replace("_", " ")} analysis for ${questionItem.variable_id}.${excluded.length ? ` Excluded because no data were available: ${excluded.map((item) => `${data.countries.find((country) => country.country_code === item.country_code)?.display_name ?? item.country_code} W${item.wave}`).join(", ")}.` : ""}`;
  addTurn(state, "assistant", message, state.activeSnapshot.snapshot_id);
  return publicConversation(
    state,
    "answered",
    action,
    message,
    suggestionsFor(state, detail),
    delta,
  );
}

function questionOptions(items: Question[]): ConversationOption[] {
  return items.map((item) => ({
    option_id: nextId("option"),
    label: `${item.variable_id} · ${item.question_text}`,
    value: item.variable_id,
    description: item.waves.map((wave) => `W${wave}`).join(", "),
  }));
}

function questionLikeInput(message: string): boolean {
  const normalized = message.normalize("NFKC").toLowerCase();
  const operational =
    parseStatistic(normalized) !== null ||
    parseCountries(normalized).values.length > 0 ||
    parseWaves(normalized).values.length > 0 ||
    parseWaves(normalized).all;
  const shortOperational =
    operational &&
    normalized
      .replace(/[a-z]+|\p{Script=Han}+/gu, " ")
      .trim().length === 0;
  return !shortOperational;
}

async function sendConversationMessage(
  conversationId: string,
  message: string,
  _expectedRevision: number,
): Promise<ConversationResponse> {
  const state = CONVERSATIONS.get(conversationId);
  if (!state) throw new Error("The conversation is no longer available.");
  state.revision += 1;
  addTurn(state, "user", message);
  const trimmed = message.trim();
  if (/^(?:thanks?|thank you|謝謝|谢谢|好的|好)$/iu.test(trimmed)) {
    state.pending = null;
    state.options = [];
    const reply = "You are welcome. Continue with a new statistic, country, wave, or survey topic whenever you are ready.";
    addTurn(state, "assistant", reply);
    const detail = state.plan.questionId ? await question(state.plan.questionId) : null;
    return publicConversation(
      state,
      "answered",
      "acknowledged",
      reply,
      detail ? suggestionsFor(state, detail) : [],
    );
  }
  const countries = parseCountries(trimmed);
  if (countries.unsupported) {
    state.pending = null;
    state.options = [];
    const reply =
      "The survey does not contain a United States respondent sample. You can analyze Asian Barometer respondent countries, or search for questions that ask about the United States.";
    addTurn(state, "assistant", reply);
    return publicConversation(state, "unsupported", "unsupported", reply);
  }
  const waves = parseWaves(trimmed);
  const statistic = parseStatistic(trimmed);
  const explicitId = trimmed.match(/\bq\d+(?:\.\d+)?\b/i)?.[0]?.toLowerCase() ?? null;
  const data = await bootstrap();
  const explicitQuestion = explicitId
    ? data.questions.find(
        (item) => item.variable_id.toLowerCase() === explicitId,
      )
    : null;
  const currentCanContinue =
    Boolean(state.plan.questionId) &&
    !explicitQuestion &&
    (statistic !== null ||
      countries.values.length > 0 ||
      countries.all ||
      waves.values.length > 0 ||
      waves.all) &&
    !/(?:new question|another question|換題|换题|新問題|新问题)/iu.test(trimmed);
  if (explicitQuestion || !currentCanContinue || questionLikeInput(trimmed) && !state.plan.questionId) {
    const matches = explicitQuestion
      ? [explicitQuestion]
      : (await catalogSearch(trimmed, 5)).questions;
    if (!matches.length) {
      state.pending = null;
      state.options = [];
      const reply =
        "No matching survey question was found. Try a question ID or a more specific survey topic.";
      addTurn(state, "assistant", reply);
      return publicConversation(state, "unsupported", "unsupported", reply);
    }
    if (!explicitQuestion) {
      state.plan = {
        questionId: null,
        statistic,
        countries: countries.values,
        waves: waves.all ? [] : waves.values,
      };
      if (countries.all) state.plan.countries = data.countries.map((item) => item.country_code);
      setPending(
        state,
        "question",
        "Choose the survey question that best matches your request.",
        ["question"],
        questionOptions(matches),
      );
      const reply = "Choose the survey question that best matches your request.";
      addTurn(state, "assistant", reply);
      return publicConversation(state, "needs_clarification", "clarified", reply);
    }
    state.previousPlan = clonePlan(state.plan);
    state.plan.questionId = explicitQuestion.variable_id;
  }
  if (statistic) state.plan.statistic = statistic;
  if (countries.all) {
    state.plan.countries = data.countries.map((item) => item.country_code);
  } else if (countries.values.length) {
    state.plan.countries = applyListChange(
      state.plan.countries,
      countries.operation,
      countries.values,
    );
  }
  if (waves.all) {
    state.plan.waves = data.waves;
  } else if (waves.values.length) {
    state.plan.waves = applyListChange(
      state.plan.waves,
      waves.operation,
      waves.values,
    );
  }
  return answerPlan(state, state.activeSnapshot ? "revised" : "analyzed");
}

async function selectPendingOption(
  state: ConversationState,
  option: ConversationOption,
): Promise<ConversationResponse> {
  const kind = state.pending?.kind;
  if (kind === "question") state.plan.questionId = option.value;
  if (kind === "statistic") state.plan.statistic = option.value as Statistic;
  if (kind === "country") {
    const data = await bootstrap();
    state.plan.countries =
      option.value === "all"
        ? data.countries.map((country) => country.country_code)
        : [Number(option.value)];
  }
  if (kind === "wave") {
    const data = await bootstrap();
    state.plan.waves =
      option.value === "all"
        ? data.questions.find(
            (questionItem) => questionItem.variable_id === state.plan.questionId,
          )?.waves ?? data.waves
        : [Number(option.value)];
  }
  state.pending = null;
  state.options = [];
  return answerPlan(state, state.activeSnapshot ? "revised" : "analyzed");
}

async function sendConversationCommand(
  conversationId: string,
  command: ConversationCommand,
  _expectedRevision: number,
  displayLabel?: string,
): Promise<ConversationResponse> {
  const state = CONVERSATIONS.get(conversationId);
  if (!state) throw new Error("The conversation is no longer available.");
  state.revision += 1;
  if (displayLabel) addTurn(state, "user", displayLabel);
  state.previousPlan = clonePlan(state.plan);
  if (command.kind === "select_pending_option") {
    if (command.pending_id !== state.pending?.pending_id) {
      throw new Error("The analysis state changed. Review the latest choices.");
    }
    const option = state.options.find(
      (candidate) => candidate.option_id === command.option_id,
    );
    if (!option) throw new Error("The selected option is no longer available.");
    return selectPendingOption(state, option);
  }
  if (command.kind === "modify_countries") {
    const data = await bootstrap();
    const values =
      command.selector === "all_available"
        ? data.countries.map((country) => country.country_code)
        : (command.values ?? []).map(Number).filter(Number.isFinite);
    state.plan.countries = applyListChange(
      state.plan.countries,
      command.operation,
      values,
    );
  }
  if (command.kind === "modify_waves") {
    const data = await bootstrap();
    const available =
      data.questions.find(
        (questionItem) => questionItem.variable_id === state.plan.questionId,
      )?.waves ?? data.waves;
    let values = command.values ?? [];
    if (command.selector === "all_available") values = available;
    if (command.selector === "latest") values = available.slice(-1);
    if (command.selector === "latest_two") values = available.slice(-2);
    if (command.selector === "latest_three") values = available.slice(-3);
    if (command.selector === "previous") {
      const first = Math.min(...state.plan.waves);
      values = available.filter((wave) => wave < first).slice(-1);
    }
    state.plan.waves = applyListChange(
      state.plan.waves,
      command.operation,
      values,
    );
  }
  if (command.kind === "set_statistic") state.plan.statistic = command.statistic;
  if (command.kind === "repair") {
    if (command.operation === "undo_last_change" && state.previousPlan) {
      state.plan = clonePlan(state.previousPlan);
    } else if (command.operation === "restart_question") {
      state.plan = { questionId: null, statistic: null, countries: [], waves: [] };
      state.activeSnapshot = null;
      state.pending = null;
      state.options = [];
      const reply = "Start a new question by describing the topic you want to analyze.";
      addTurn(state, "assistant", reply, null, "flow_boundary");
      return publicConversation(state, "answered", "discussed", reply);
    } else if (command.operation === "cancel_pending") {
      state.pending = null;
      state.options = [];
      const reply = "The pending choice was cancelled.";
      addTurn(state, "assistant", reply);
      return publicConversation(state, "answered", "acknowledged", reply);
    }
  }
  return answerPlan(state, "revised");
}

async function createConversation(): Promise<ConversationResponse> {
  const state: ConversationState = {
    id: nextId("conversation"),
    revision: 0,
    turns: [],
    plan: { questionId: null, statistic: null, countries: [], waves: [] },
    pending: null,
    options: [],
    activeSnapshot: null,
    previousPlan: null,
  };
  CONVERSATIONS.set(state.id, state);
  return publicConversation(state, "answered", "discussed");
}

async function startNewQuestion(conversationId: string): Promise<ConversationResponse> {
  const state = CONVERSATIONS.get(conversationId);
  if (!state) throw new Error("The conversation is no longer available.");
  state.revision += 1;
  state.plan = { questionId: null, statistic: null, countries: [], waves: [] };
  state.pending = null;
  state.options = [];
  state.activeSnapshot = null;
  const message = "New question";
  addTurn(state, "assistant", message, null, "flow_boundary");
  return publicConversation(state, "answered", "discussed", message);
}

export const api = {
  bootstrap,
  catalogSearch,
  question,
  responseSet,
  assistantStatus: async (): Promise<AssistantStatus> => ({
    provider: "offline",
    available: true,
    label: "Cloud catalog and statistics",
    detail: "Deterministic survey planning with aggregate cloud analysis",
  }),
  analyze,
  validate: async (draft: Draft) => ({
    valid: true as const,
    request: {
      target_id: draft.target_id,
      countries: draft.countries,
      waves: draft.waves,
    },
  }),
  assistantPlan: async (
    prompt: string,
    _draft: Draft,
  ): Promise<AssistantPlanResponse> => {
    const search = await catalogSearch(prompt, 5);
    return {
      clarification_required: true,
      detail: "Choose the survey question that best matches your request.",
      candidates: search.questions,
    };
  },
  createConversation,
  sendConversationMessage,
  sendConversationCommand,
  startNewQuestion,
};
