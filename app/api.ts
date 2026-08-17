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
  CloudTurnContext,
  DimensionValue,
  Draft,
  Mode,
  Question,
  QuestionDetail,
  ResponseSetDetail,
  ResultMetadata,
  ResultRow,
  StatisticalView,
  TurnProgram,
} from "./types";
import { localAssistantStatus, maybeRerankQuestions } from "./question-rerank";
import {
  canRequestCloudTurnProgram,
  requestCloudTurnProgram,
} from "./cloud-turn-program";

interface StaticResponseSetCatalog {
  id: string;
  label: string;
  memberCount: number;
  topicId: string;
}

export interface StaticResponseSetData {
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

export interface CloudCatalog extends StaticCatalog {
  responseSets: StaticResponseSetCatalog[];
}

export interface StaticDataBundle {
  questions: Record<string, QuestionData>;
  responseSets: Record<string, StaticResponseSetData>;
}

type Statistic = StatisticalView["statistic"];

const STATISTIC_LABEL_ZH: Record<Statistic, string> = {
  distribution: "回答分布",
  category_share: "指定回答比例",
  mean: "平均分",
  median: "中位回答",
  quartiles: "四分位數",
  sd: "標準差",
  base_n: "有效人數",
};

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
  questionQuery: string | null;
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
let catalogReleaseFingerprint: string | null = null;
let sequence = 0;

const QUERY_ALIASES: Record<string, string> = {
  民主程度: "how much democracy democracy level rating",
  民主化程度: "how democratic democracy level rating",
  民主滿意度: "satisfied democracy works satisfaction",
  民主满意度: "satisfied democracy works satisfaction",
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

const QUESTION_MEASURE_INTENTS: Array<{
  query: RegExp;
  question: RegExp;
  boost: number;
}> = [
  {
    query: /(?:民主(?:化)?(?:的)?(?:程度|水平|評分|评分)|有多(?:麼|么)?民主|多(?:麼|么)民主|how\s+(?:much\s+of\s+a\s+)?democracy|how\s+democratic|democracy\s+(?:level|rating|score))/iu,
    question: /(?:how\s+much\s+of\s+a\s+democracy|how\s+democratic)/iu,
    boost: 900,
  },
  {
    query: /(?:民主.*(?:滿意|满意)|(?:satisfied|satisfaction).*(?:democracy|democratic)|democracy.*(?:satisfied|satisfaction))/iu,
    question: /(?:satisfied|dissatisfied).*(?:democracy|democratic)|democracy\s+works/iu,
    boost: 900,
  },
  {
    query: /(?:民主.*(?:意義|意义|含義|含义)|meaning\s+of\s+democracy)/iu,
    question: /meaning\s+of\s+democracy/iu,
    boost: 900,
  },
  {
    query: /(?:民主.*(?:最好|最佳|支持)|best\s+form\s+of\s+government|support\s+for\s+democracy)/iu,
    question: /best\s+form\s+of\s+government/iu,
    boost: 700,
  },
  {
    query: /(?:how\s+much\s+influence|influence\s+(?:amount|degree|level)|影響(?:有)?多大|影响(?:有)?多大|影響程度|影响程度)/iu,
    question: /how\s+much\s+influence/iu,
    boost: 900,
  },
  {
    query: /(?:influence.*(?:positive|negative|good|bad)|(?:positive|negative|good|bad).*influence|影響.*(?:正面|負面|负面|好|壞|坏)|影响.*(?:正面|負面|负面|好|壞|坏))/iu,
    question: /general(?:ly)?\s+speaking.*influence.*(?:is|\?)/iu,
    boost: 900,
  },
];

const ALL_COUNTRIES_PATTERN =
  /(?:\b(?:all|every|each)\s+(?:available\s+)?(?:(?:surveyed|survey|respondent)\s+)?(?:countries|country|territories|territory|regions|region|places|place)\b|(?:all|every|each)\s*(?:國家|国家|地區|地区)|(?:全部|所有|全體|全体|全|每個|每个|每一個|每一个)(?:的)?(?:國家|国家|地區|地区|受訪地區|受访地区)|(?:各國|各国|各個國家|各个国家|各地區|各地区))/iu;

const ALL_WAVES_PATTERN =
  /(?:\b(?:all|every|each|multiple)\s+(?:available\s+)?(?:survey\s+)?waves?\b|\bacross\s+(?:all\s+)?waves?\b|\b(?:by|per)\s+waves?\b|\bwave\s+by\s+wave\b|\bover\s+time\b|\btrend\b|(?:all|every|each)\s*(?:波次|波)|(?:全部|所有|每個|每个|每一個|每一个|各個|各个|多個|多个)(?:可用)?(?:調查|调查)?(?:波次|波)|(?:各波|歷次|历次|各次調查|各次调查|趨勢|趋势))/iu;

const FIRST_THREE_WAVES_PATTERN =
  /(?:\bfirst\s+(?:three|3)\s+(?:survey\s+)?waves?\b|(?:前|最早)(?:三|3)(?:個|个)?(?:調查|调查)?(?:波次|波))/iu;

const LATEST_TWO_WAVES_PATTERN =
  /(?:\b(?:latest|last|most recent)\s+(?:two|2)\s+(?:survey\s+)?waves?\b|(?:最近|最新|最後|最后)(?:兩|两|2)(?:個|个)?(?:調查|调查)?(?:波次|波))/iu;

const LATEST_THREE_WAVES_PATTERN =
  /(?:\b(?:latest|last|most recent)\s+(?:three|3)\s+(?:survey\s+)?waves?\b|(?:最近|最新|最後|最后)(?:三|3)(?:個|个)?(?:調查|调查)?(?:波次|波))/iu;

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
  [19, /(?:\bbangladesh(?:i)?\b|孟加拉(?:國|国)?(?:人)?)/iu],
  [20, /(?:\bsri\s*lanka(?:n)?\b|\bsrilanka(?:n)?\b|斯里蘭卡(?:人)?|斯里兰卡(?:人)?)/iu],
];

const FIXED_QUESTION_GEOGRAPHY_PATTERNS: RegExp[] = [
  ...COUNTRY_ALIASES.map(([, pattern]) => pattern),
  /(?:\bunited\s+states\b|\bu\.?s\.?a?\.?\b|\bamerica(?:n)?\b|美國|美国)/iu,
  /(?:\bchina\b|中國|中国)/iu,
  /(?:\bnew\s+zealand\b|紐西蘭|纽西兰|新西蘭|新西兰)/iu,
  /(?:\btimor[-\s]?leste\b|\beast\s+timor\b|東帝汶|东帝汶)/iu,
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
  [19, "Bangladesh"],
  [20, "Sri Lanka"],
]);
const COUNTRY_CODES = new Map(
  [...COUNTRY_NAMES].map(([code, name]) => [name, code]),
);

const UNSUPPORTED_RESPONDENT_COUNTRIES: Array<[string, RegExp]> = [
  [
    "United States",
    /^(?:americans?|美國人|美国人)[？?!.。]*$|(?:american|united states)\s+(?:respondents?|sample|survey data)|(?:美國|美国)(?:的)?(?:人|受訪者|受访者|樣本|样本)(?:的)?(?:數據|数据|資料|资料|樣本|样本|調查|调查)?|(?:我要看|改成|換成|换成|受訪者(?:是|改成)?|受访者(?:是|改成)?|樣本(?:是|改成)?|样本(?:是|改成)?)[^。！？!?\n]{0,16}(?:美國人|美国人)/iu,
  ],
  [
    "New Zealand",
    /^(?:new\s*zealanders?|紐西蘭人|纽西兰人|新西蘭人|新西兰人)[？?!.。]*$|(?:new\s*zealand(?:er)?)\s+(?:respondents?|sample|survey data)|(?:紐西蘭|纽西兰|新西蘭|新西兰)(?:的)?(?:人|受訪者|受访者|樣本|样本)/iu,
  ],
  [
    "Timor-Leste",
    /^(?:timorese|東帝汶人|东帝汶人)[？?!.。]*$|(?:timor[-\s]?leste|east\s+timor|timorese)\s+(?:respondents?|sample|survey data)|(?:東帝汶|东帝汶)(?:的)?(?:人|受訪者|受访者|樣本|样本)/iu,
  ],
];

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

function publicAssetUrl(relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, "");
  if (typeof document !== "undefined") {
    return new URL(clean, document.baseURI).toString();
  }
  return `/${clean}`;
}

export function seedCatalog(catalog: CloudCatalog): Bootstrap {
  const fingerprint = catalog.dataset.release?.sourceDatabase.sha256 ?? null;
  if (catalogReleaseFingerprint && fingerprint !== catalogReleaseFingerprint) {
    QUESTION_CACHE.clear();
    RESPONSE_SET_CACHE.clear();
  }
  catalogReleaseFingerprint = fingerprint;
  catalogPromise = Promise.resolve(catalog);
  return bootstrapFromCatalog(catalog);
}

export function seedDataBundle(bundle: StaticDataBundle): void {
  for (const [id, data] of Object.entries(bundle.questions)) {
    QUESTION_CACHE.set(id, Promise.resolve(data));
  }
  for (const [id, data] of Object.entries(bundle.responseSets)) {
    RESPONSE_SET_CACHE.set(id, Promise.resolve(data));
  }
}

function loadCatalog(): Promise<CloudCatalog> {
  if (!catalogPromise) {
    catalogPromise = fetch(publicAssetUrl("data/catalog.json"), { cache: "no-cache" })
      .then(async (response) => {
        if (!response.ok) throw new Error("The cloud survey catalog is unavailable.");
        const catalog = await response.json() as CloudCatalog;
        catalogReleaseFingerprint = catalog.dataset.release?.sourceDatabase.sha256 ?? null;
        return catalog;
      })
      .catch((reason) => {
        catalogPromise = null;
        catalogReleaseFingerprint = null;
        throw reason;
      });
  }
  return catalogPromise;
}

function loadQuestionData(id: string): Promise<QuestionData> {
  let request = QUESTION_CACHE.get(id);
  if (!request) {
    request = loadCatalog().then((catalog) => {
      const version = catalog.dataset.release?.sourceDatabase.sha256.slice(0, 16) ?? "unversioned";
      return fetch(
        `${publicAssetUrl(`data/questions/${encodeURIComponent(id)}.json`)}?release=${version}`,
        { cache: "force-cache" },
      ).then((response) => {
        if (!response.ok) throw new Error("The requested survey item is unavailable.");
        return response.json() as Promise<QuestionData>;
      });
    });
    request = request.catch((reason) => {
      QUESTION_CACHE.delete(id);
      throw reason;
    });
    QUESTION_CACHE.set(id, request);
  }
  return request;
}

function loadResponseSetData(id: string): Promise<StaticResponseSetData> {
  let request = RESPONSE_SET_CACHE.get(id);
  if (!request) {
    request = loadCatalog().then((catalog) => {
      const version = catalog.dataset.release?.sourceDatabase.sha256.slice(0, 16) ?? "unversioned";
      return fetch(
        `${publicAssetUrl(`data/response-sets/${encodeURIComponent(id)}.json`)}?release=${version}`,
        { cache: "force-cache" },
      ).then((response) => {
        if (!response.ok) throw new Error("The requested response set is unavailable.");
        return response.json() as Promise<StaticResponseSetData>;
      });
    });
    request = request.catch((reason) => {
      RESPONSE_SET_CACHE.delete(id);
      throw reason;
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

function baseQuestionContexts(data: QuestionData): Context[] {
  const settings = new Map(data.scale.map((item) => [rawKey(item[0]), item]));
  const counts = new Map<string, Context>();
  for (const [country, wave, value, count] of data.cells) {
    const scale = settings.get(rawKey(value));
    if (
      !scale
      || !(
        scale[3] === "included"
        || scale[5] === "included"
        || scale[7] === "included"
      )
    ) {
      continue;
    }
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

export function bootstrapFromCatalog(catalog: CloudCatalog): Bootstrap {
  const release = catalog.dataset.release;
  return {
    dataset: {
      dataset_id: DATASET_ID,
      builder_version: catalog.dataset.builderVersion,
      engine_version: ENGINE_VERSION,
      source_rows: catalog.dataset.sourceRows,
      question_count: catalog.dataset.questionCount,
      release_transaction: release?.transactionId ?? null,
      release_correction: release?.correctionVersion ?? null,
      release_fingerprint: release?.sourceDatabase.sha256 ?? null,
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

async function bootstrap(): Promise<Bootstrap> {
  return bootstrapFromCatalog(await loadCatalog());
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
    base_contexts: baseQuestionContexts(data),
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
  builderVersion: string,
  totalRecords: number,
  includedRecords: number,
  elapsedMs: number,
  warnings: string[],
): ResultMetadata {
  return {
    request_hash: hashDraft(draft),
    dataset_id: DATASET_ID,
    builder_version: builderVersion,
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
        catalog.dataset.builderVersion,
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
        catalog.dataset.builderVersion,
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
  for (const [, pattern] of COUNTRY_ALIASES) {
    const flags = [...new Set(`${pattern.flags}g`.split(""))].join("");
    expanded = expanded.replace(new RegExp(pattern.source, flags), " ");
  }
  return expanded
    .replace(
      /\b(?:mean|average|distribution|median|quartiles?|standard deviation|trend|wave|waves|country|countries|respondents?|which|what|find|show|questions?|survey|about|related|are|is|the|to|with|of)\b/giu,
      " ",
    )
    .replace(
      /(?:平均(?:分|值|數|数)?|分佈|分布|中位數?|中位回答|四分位數?|標準差|标准差|趨勢|趋势|波次|國家|国家|受訪者|受访者|哪些|什麼|什么|有關|有关|相關|相关|題目|题目|問題|问题|請找|请找|幫我找|帮我找|程度|水平)/gu,
      " ",
    )
    .replace(/(?:^|\s)(?:的|在|是|和|與|与|以及|我|想|要|看|請|请|一下|各)(?=\s|$)/gu, " ")
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .trim();
}

export function catalogMatch(questionItem: Question, query: string): {
  score: number;
  band: Question["match_band"];
  reasons: NonNullable<Question["match_reasons"]>;
} {
  const normalized = normalizeQuery(query);
  const mentionedIds = [...query.matchAll(/\bq\d+(?:\.\d+)?\b/gi)].map(
    (match) => match[0].toLowerCase(),
  );
  const tokens = normalized.split(/\s+/).filter((token) => token.length > 1);
  if (!tokens.length) return { score: 0, band: "broad", reasons: [] };
  const questionText = questionItem.question_text.normalize("NFKC").toLowerCase();
  const topicText = questionItem.topic_label.normalize("NFKC").toLowerCase();
  const idText = questionItem.variable_id.toLowerCase();
  const reasons: NonNullable<Question["match_reasons"]> = [];
  const exactIdMentioned = mentionedIds.includes(idText);
  let score = exactIdMentioned ? 1_000 : 0;
  if (exactIdMentioned) reasons.push("exact_id");
  if (normalized === idText) score += 2_000;
  if (questionText.includes(normalized)) {
    score += 500 + normalized.length * 3;
    reasons.push("question_phrase");
  }
  if (topicText.includes(normalized)) {
    score += 120 + normalized.length;
    reasons.push("topic_terms");
  }
  let matchedTokens = 0;
  let questionMatches = 0;
  let topicMatches = 0;
  for (const token of tokens) {
    if (idText === token) {
      score += 1_000;
      matchedTokens += 1;
      continue;
    }
    if (questionText.includes(token)) {
      const positionBonus = questionText.startsWith(token) ? 24 : 0;
      score += 42 + token.length * 5 + positionBonus;
      matchedTokens += 1;
      questionMatches += 1;
      continue;
    }
    if (topicText.includes(token)) {
      score += 16 + token.length * 2;
      matchedTokens += 1;
      topicMatches += 1;
    }
  }
  if (
    questionMatches
    && !reasons.includes("question_phrase")
    && !reasons.includes("question_terms")
  ) reasons.push("question_terms");
  if (topicMatches && !reasons.includes("topic_terms")) reasons.push("topic_terms");
  const coverage = matchedTokens / tokens.length;
  if (coverage === 1) score += 180;
  else if (coverage >= 0.6) score += 60;
  const requestedStatistic = parseStatistic(query);
  if (requestedStatistic) {
    score += statisticSupportedBy(questionItem, requestedStatistic) ? 320 : -320;
  }
  for (const intent of QUESTION_MEASURE_INTENTS) {
    if (intent.query.test(query) && intent.question.test(questionText)) {
      score += intent.boost;
      if (!reasons.includes("question_phrase")) reasons.unshift("question_phrase");
    }
  }
  const finalScore = score * (0.35 + coverage);
  const band = normalized === idText
      || (questionText.includes(normalized) && tokens.length >= 2)
      || (coverage === 1 && matchedTokens >= 2)
    ? "high"
    : coverage >= 0.6 ? "related" : "broad";
  return { score: finalScore, band, reasons: reasons.slice(0, 2) };
}

async function catalogSearch(query: string, limit = 199): Promise<CatalogSearchResponse> {
  const data = await bootstrap();
  const matches = data.questions
    .map((item) => ({ item, match: catalogMatch(item, query) }))
    .map(({ item, match }) => ({
      item: { ...item, match_band: match.band, match_reasons: match.reasons },
      score: match.score,
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) =>
      right.score - left.score
      || left.item.variable_id.localeCompare(right.item.variable_id, undefined, {
        numeric: true,
      }),
    );
  const questions = matches
    .slice(0, limit)
    .map(({ item }) => item);
  const requestedStatistic = parseStatistic(query);
  const compatible = requestedStatistic
    ? questions.filter((questionItem) =>
        statisticSupportedBy(questionItem, requestedStatistic),
      )
    : questions;
  const reranked = await maybeRerankQuestions(query, compatible, normalizeQuery(query));
  const compatibleIds = new Set(reranked.map((questionItem) => questionItem.variable_id));
  const merged = [
    ...reranked,
    ...questions.filter((questionItem) => !compatibleIds.has(questionItem.variable_id)),
  ];
  return { query, total: matches.length, questions: merged };
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

function statisticSupportedBy(
  questionItem: Question,
  statistic: Statistic | null,
): boolean {
  return (
    !statistic ||
    statistic === "distribution" ||
    statistic === "base_n" ||
    ((statistic === "mean" || statistic === "sd") &&
      questionItem.modes.includes("continuous")) ||
    ((statistic === "median" || statistic === "quartiles") &&
      questionItem.modes.includes("order"))
  );
}

function parseCountries(message: string): {
  values: number[];
  operation: "set" | "add" | "remove";
  all: boolean;
  unsupported: string | null;
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
  const all = ALL_COUNTRIES_PATTERN.test(normalized);
  const unsupported =
    UNSUPPORTED_RESPONDENT_COUNTRIES.find(([, pattern]) => pattern.test(normalized.trim()))?.[0] ??
    null;
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
  if (FIRST_THREE_WAVES_PATTERN.test(normalized)) values.push(1, 2, 3);
  if (LATEST_TWO_WAVES_PATTERN.test(normalized)) values.push(5, 6);
  if (LATEST_THREE_WAVES_PATTERN.test(normalized)) values.push(4, 5, 6);
  const ranges = [
    ...normalized.matchAll(
      /(?:\bwaves?\s*|\bw\s*|第\s*)?([1-6])\s*(?:-|–|—|to|through|至|到)\s*(?:\bwaves?\s*|\bw\s*|第\s*)?([1-6])(?:\s*波)?/giu,
    ),
  ];
  for (const range of ranges) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    for (let wave = low; wave <= high; wave += 1) values.push(wave);
  }
  const remove = /(?:remove|exclude|drop|without|刪除|删除|移除|排除|不要)/iu.test(
    normalized,
  );
  const add = /(?:add|include|plus|also|增加|新增|加入|加上|也看|再加)/iu.test(
    normalized,
  );
  const all = ALL_WAVES_PATTERN.test(normalized);
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
  const values: Statistic[] = ["distribution"];
  if (questionItem.modes.includes("continuous")) {
    values.push("mean", "sd");
  }
  if (questionItem.modes.includes("order")) {
    values.push("median", "quartiles");
  }
  values.push("base_n");
  return values.map((value) => ({
    option_id: nextId("option"),
    label: STATISTIC_LABEL_ZH[value],
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
          ? "改看平均分"
          : "改看回答分布",
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
      label: "調整比較國家",
      command: { kind: "modify_countries", operation: "set", selector: "explicit" },
      control: "country_multiselect",
      choices: [...COUNTRY_ALIASES].map(([code]) => ({
        value: String(code),
        label: COUNTRY_NAMES.get(code) ?? String(code),
        selected: state.plan.countries.includes(code),
        available: countries.has(code),
        description: countries.has(code) ? null : "這題沒有資料",
      })),
      based_on_revision: state.revision,
    },
    {
      action_id: nextId("suggestion"),
      label: "調整調查波次",
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
        description: waves.has(wave) ? null : "這題沒有資料",
      })),
      based_on_revision: state.revision,
    },
    {
      action_id: nextId("suggestion"),
      label: "分析另一個題目",
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
    setPending(state, "question", "請選擇調查題目。", ["question"], []);
    const message = "請先選擇題目。";
    addTurn(state, "assistant", message);
    return publicConversation(state, "needs_clarification", "clarified", message);
  }
  const requestedStatistic = state.plan.statistic;
  if (!statisticSupportedBy(questionItem, requestedStatistic)) {
    const compatible = state.questionQuery && requestedStatistic
      ? (await catalogSearch(
          `${state.questionQuery} ${STATISTIC_LABEL_ZH[requestedStatistic]}`,
        )).questions.filter(
          (candidate) =>
            candidate.variable_id !== questionItem.variable_id &&
            statisticSupportedBy(candidate, requestedStatistic),
        )
      : [];
    if (compatible.length) {
      const supportedStatistic = requestedStatistic as Statistic;
      state.previousPlan = clonePlan(state.plan);
      state.plan.questionId = null;
      const options = questionOptions(compatible);
      setPending(
        state,
        "question",
        "Choose a compatible survey question.",
        ["question"],
        options,
      );
      const message = `${questionItem.variable_id} 沒有可用的${STATISTIC_LABEL_ZH[supportedStatistic]}設定，因此不能直接計算。以下題目支援${STATISTIC_LABEL_ZH[supportedStatistic]}，請選擇最符合原意者：`;
      addTurn(state, "assistant", message);
      return publicConversation(state, "needs_clarification", "clarified", message);
    }
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
    const statistics = options.map((option) => option.label).join("、");
    const message = `已找到 ${questionItem.variable_id} · ${questionItem.question_text}。你要看哪個統計量：${statistics}？`;
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
      label: "全部國家或地區",
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
    const message = `已找到 ${questionItem.variable_id} · ${questionItem.question_text}。請選擇受訪者的國家或地區。`;
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
        label: "全部可用波次",
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
    const message = `${questionItem.variable_id} 在所選地區有多個波次；請選擇一個波次或全部可用波次。`;
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
  const message = `已完成 ${questionItem.variable_id} 的${STATISTIC_LABEL_ZH[state.plan.statistic]}分析。${excluded.length ? ` 未納入的資料範圍：${excluded.map((item) => `${data.countries.find((country) => country.country_code === item.country_code)?.display_name ?? item.country_code} W${item.wave}`).join("、")}。` : ""}`;
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
    match_band: item.match_band,
    match_reasons: item.match_reasons,
  }));
}

function replacePattern(value: string, pattern: RegExp): string {
  const flags = [...new Set(`${pattern.flags}g`.split(""))].join("");
  return value.replace(new RegExp(pattern.source, flags), " ");
}

function operationalRemainder(message: string): string {
  let normalized = message.normalize("NFKC").toLowerCase();
  normalized = replacePattern(normalized, ALL_COUNTRIES_PATTERN);
  normalized = replacePattern(normalized, ALL_WAVES_PATTERN);
  normalized = replacePattern(normalized, FIRST_THREE_WAVES_PATTERN);
  normalized = replacePattern(normalized, LATEST_TWO_WAVES_PATTERN);
  normalized = replacePattern(normalized, LATEST_THREE_WAVES_PATTERN);
  for (const [, pattern] of COUNTRY_ALIASES) {
    normalized = replacePattern(normalized, pattern);
  }
  return normalized
    .replace(
      /(?:standard deviation|\bsd\b|quartiles?|median|distribution|valid (?:n|responses?)|sample size|mean|average)/giu,
      " ",
    )
    .replace(
      /(?:標準差|标准差|四分位數?|四分位数?|中位數?|中位数?|中位回答|分佈|分布|有效人數|有效人数|樣本數|样本数|平均(?:分|值|數|数)?)/gu,
      " ",
    )
    .replace(
      /(?:\bwaves?\s*|\bw\s*|第\s*)[1-6](?:\s*(?:-|–|—|to|through|至|到)\s*(?:\bwaves?\s*|\bw\s*|第\s*)?[1-6])?(?:\s*波)?/giu,
      " ",
    )
    .replace(
      /\b(?:what|how)\s+about\b/giu,
      " ",
    )
    .replace(
      /\b(?:add|include|remove|exclude|drop|without|plus|also|switch|change|set|only|just|instead|show|view|use|data|results?|respondents?|samples?|please|then|and|or|to|from|for|in)\b/giu,
      " ",
    )
    .replace(
      /(?:增加|新增|加入|加上|再加|刪除|删除|移除|排除|不要|改看|改成|換成|换成|切換|切换|只看|僅看|仅看|也看|資料|资料|數據|数据|結果|结果|受訪者|受访者|樣本|样本|請|请|幫我|帮我|我要|我想|想看|看看|查看|那麼|那么|至於|至于|那|呢|再|並且|并且|以及|和|與|与|或|的|一下)/gu,
      " ",
    )
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .trim();
}

function operationalOnly(message: string): boolean {
  const countries = parseCountries(message);
  const waves = parseWaves(message);
  const hasOperation =
    parseStatistic(message) !== null ||
    countries.values.length > 0 ||
    countries.all ||
    waves.values.length > 0 ||
    waves.all;
  return hasOperation && operationalRemainder(message).length === 0;
}

function hasFixedQuestionGeography(context: CloudTurnContext): boolean {
  const questionText = context.current_goal?.question_text ?? "";
  if (FIXED_QUESTION_GEOGRAPHY_PATTERNS.some((pattern) => pattern.test(questionText))) {
    return true;
  }
  return (context.current_goal?.category_options ?? []).some((label) =>
    FIXED_QUESTION_GEOGRAPHY_PATTERNS.some((pattern) => pattern.test(label))
  );
}

function hasExplicitRespondentScopeMarker(message: string): boolean {
  return /(?:\brespondents?\b|\brespondent\s+(?:countries|regions|places)\b|\bsurvey\s+sample\b|\bsample\s+(?:from|in)\b|受訪(?:者|地區)|受访(?:者|地区)|樣本|样本)/iu.test(
    message,
  );
}

function guardAmbiguousCountryProgram(
  state: ConversationState,
  context: CloudTurnContext,
  message: string,
  program: TurnProgram,
): TurnProgram {
  if (
    state.activeSnapshot === null
    || context.pending !== null
    || context.current_goal?.question_id == null
    || !program.commands.some((command) => command.kind === "modify_countries")
    || !operationalOnly(message)
    || hasExplicitRespondentScopeMarker(message)
    || !hasFixedQuestionGeography(context)
  ) {
    return program;
  }
  return {
    schema_version: 1,
    relation: "unclear",
    commands: [],
    unresolved: [{
      slot: "country_role",
      detail: "這個國家名稱可能是受訪地區，也可能是題目中的評價對象或回答類別；請明確說明是否要修改受訪地區",
    }],
    source: "model",
  };
}

function forceExplicitRespondentCountryProgram(
  state: ConversationState,
  context: CloudTurnContext,
  message: string,
  program: TurnProgram,
): TurnProgram {
  const countries = parseCountries(message);
  if (
    state.activeSnapshot === null
    || context.pending !== null
    || context.current_goal?.question_id == null
    || !hasExplicitRespondentScopeMarker(message)
    || countries.all
    || countries.unsupported !== null
    || countries.values.length === 0
  ) {
    return program;
  }
  return {
    schema_version: 1,
    relation: "revise",
    commands: [{
      kind: "modify_countries",
      operation: countries.operation,
      values: countries.values
        .map((code) => COUNTRY_NAMES.get(code))
        .filter((name): name is string => Boolean(name)),
      selector: "explicit",
    }],
    unresolved: [],
    source: "model",
  };
}

function safeCountryContinuationFallback(
  state: ConversationState,
  context: CloudTurnContext,
  message: string,
  program: TurnProgram,
): TurnProgram {
  const countries = parseCountries(message);
  if (
    state.activeSnapshot === null
    || context.pending !== null
    || context.current_goal?.question_id == null
    || program.relation !== "unclear"
    || program.commands.length > 0
    || countries.all
    || countries.unsupported !== null
    || countries.values.length === 0
    || !operationalOnly(message)
    || hasFixedQuestionGeography(context)
  ) {
    return program;
  }
  return {
    schema_version: 1,
    relation: "revise",
    commands: [{
      kind: "modify_countries",
      operation: countries.operation,
      values: countries.values
        .map((code) => COUNTRY_NAMES.get(code))
        .filter((name): name is string => Boolean(name)),
      selector: "explicit",
    }],
    unresolved: [],
    source: "model",
  };
}

async function safeTopicContinuationFallback(
  state: ConversationState,
  context: CloudTurnContext,
  message: string,
  program: TurnProgram,
  data: Bootstrap,
): Promise<ConversationResponse | null> {
  const hasQuestionCommand = program.commands.some((command) =>
    command.kind === "search_questions" || command.kind === "select_question"
  );
  const hasNonModifierCommand = program.commands.some((command) =>
    ![
      "modify_countries",
      "modify_waves",
      "modify_categories",
      "set_statistic",
      "set_representation",
    ].includes(command.kind)
  );
  if (
    state.activeSnapshot === null
    || context.pending !== null
    || context.current_goal?.question_id == null
    || hasQuestionCommand
    || hasNonModifierCommand
    || operationalOnly(message)
    || hasExplicitRespondentScopeMarker(message)
  ) {
    return null;
  }
  const matches = (await catalogSearch(message)).questions;
  const hasExplicitMeasureIntent = QUESTION_MEASURE_INTENTS.some((intent) =>
    intent.query.test(message)
  );
  if (
    !hasExplicitMeasureIntent
    && !matches.some((item) => item.match_band === "high")
  ) return null;

  const countries = parseCountries(message);
  const waves = parseWaves(message);
  const statistic = parseStatistic(message);
  state.questionQuery = message;
  state.plan = {
    questionId: null,
    statistic: null,
    countries: [],
    waves: [],
  };
  applyConversationModifiers(state, countries, waves, statistic, data);
  setPending(
    state,
    "question",
    "請選擇最符合需求的調查題目。",
    ["question"],
    questionOptions(matches),
  );
  const reply = "這個說法可能對應不同的測量。請選擇題目：";
  addTurn(state, "assistant", reply);
  return publicConversation(state, "needs_clarification", "clarified", reply);
}

function applyConversationModifiers(
  state: ConversationState,
  countries: ReturnType<typeof parseCountries>,
  waves: ReturnType<typeof parseWaves>,
  statistic: Statistic | null,
  data: Bootstrap,
): void {
  if (statistic) state.plan.statistic = statistic;
  if (countries.all) {
    const allCountries = data.countries.map((item) => item.country_code);
    state.plan.countries =
      countries.operation === "remove"
        ? []
        : applyListChange(
            state.plan.countries,
            countries.operation,
            allCountries,
          );
  } else if (countries.values.length) {
    state.plan.countries = applyListChange(
      state.plan.countries,
      countries.operation,
      countries.values,
    );
  }
  if (waves.all) {
    state.plan.waves =
      waves.operation === "remove"
        ? []
        : applyListChange(state.plan.waves, waves.operation, data.waves);
  } else if (waves.values.length) {
    state.plan.waves = applyListChange(
      state.plan.waves,
      waves.operation,
      waves.values,
    );
  }
}

function normalizedChoice(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

function exactPendingOption(
  state: ConversationState,
  message: string,
): ConversationOption | null {
  if (!state.pending) return null;
  const selected = normalizedChoice(message);
  const matches = state.options.filter((option) => {
    const candidates = [option.option_id, option.value, option.label];
    return candidates.some((candidate) => normalizedChoice(candidate) === selected);
  });
  return matches.length === 1 ? matches[0] : null;
}

function representationFromStatistic(statistic: Statistic | null): Mode | null {
  if (!statistic) return null;
  if (statistic === "mean" || statistic === "sd") return "continuous";
  if (statistic === "median" || statistic === "quartiles") return "order";
  return "category";
}

async function cloudTurnContext(
  state: ConversationState,
  latestMessage: string,
  data: Bootstrap,
): Promise<CloudTurnContext> {
  const questionItem = state.plan.questionId
    ? data.questions.find((item) => item.variable_id === state.plan.questionId) ?? null
    : null;
  const detail = questionItem ? await question(questionItem.variable_id) : null;
  const categoryOptions = detail
    ? [...new Set(
        detail.scale
          .filter((item) => item.category_status === "included")
          .map((item) => item.category_label),
      )]
    : [];
  const hasGoal = Boolean(
    questionItem
    || state.plan.countries.length
    || state.plan.waves.length
    || state.plan.statistic,
  );
  const priorEffectiveChange = Boolean(
    state.previousPlan
    && (
      state.previousPlan.questionId !== state.plan.questionId
      || state.previousPlan.statistic !== state.plan.statistic
      || state.previousPlan.countries.join(",") !== state.plan.countries.join(",")
      || state.previousPlan.waves.join(",") !== state.plan.waves.join(",")
    ),
  );
  return {
    latest_message: latestMessage,
    current_goal: hasGoal
      ? {
          question_id: questionItem?.variable_id ?? null,
          question_text: questionItem?.question_text ?? null,
          respondent_countries: state.plan.countries
            .map((code) => COUNTRY_NAMES.get(code))
            .filter((name): name is string => Boolean(name)),
          country_codes: [...state.plan.countries],
          waves: [...state.plan.waves],
          statistic: state.plan.statistic,
          representation: state.activeSnapshot?.view.representation
            ?? representationFromStatistic(state.plan.statistic),
          category_options: categoryOptions,
          selected_category_labels: [],
        }
      : null,
    pending: state.pending
      ? {
          pending_id: state.pending.pending_id,
          kind: state.pending.kind,
          assistant_question: state.pending.question,
          allowed_options: state.options.map((option) => ({
            option_id: option.option_id,
            label: option.label,
            value: option.value,
            description: option.description,
          })),
        }
      : null,
    recent_exchanges: state.turns
      .slice(0, -1)
      .slice(-8)
      .map((turn) => ({ role: turn.role, content: turn.message })),
    prior_effective_change: priorEffectiveChange,
    turn_mode: state.turns.filter((turn) => turn.role === "user").length > 1
      ? "continue"
      : "start",
  };
}

function cloudProgramFailure(
  state: ConversationState,
  message = "雲端語言服務目前無法可靠判讀這句話；既有分析沒有被修改。你仍可使用畫面上的選項，或稍後重試。",
): ConversationResponse {
  addTurn(state, "assistant", message);
  return publicConversation(state, "tool_error", "tool_error", message);
}

function unresolvedProgram(
  state: ConversationState,
  program: TurnProgram,
): ConversationResponse {
  const detail = program.unresolved.map((item) => item.detail).join("；");
  const message = detail
    ? `這項調整仍有不明確之處：${detail}。既有分析沒有被修改。`
    : "這項要求目前無法安全地對應到既有分析；請再說明要改題目、國家、波次或統計量。";
  addTurn(state, "assistant", message);
  return publicConversation(state, "needs_clarification", "clarified", message);
}

function waveValuesForCommand(
  command: Extract<ConversationCommand, { kind: "modify_waves" }>,
  current: number[],
  available: number[],
): number[] {
  const sorted = [...new Set(available)].sort((a, b) => a - b);
  if (command.selector === "explicit") return command.values ?? [];
  if (command.selector === "from_wave") {
    const endpoint = command.values?.[0];
    return endpoint ? sorted.filter((wave) => wave >= endpoint) : [];
  }
  if (command.selector === "through") {
    const endpoint = command.values?.[0];
    return endpoint ? sorted.filter((wave) => wave <= endpoint) : [];
  }
  if (command.selector === "through_latest") {
    const start = current.length ? Math.min(...current) : sorted[0];
    return start ? sorted.filter((wave) => wave >= start) : [];
  }
  if (command.selector === "ensure_multiple") {
    return current.length >= 2 ? current : sorted.slice(-2);
  }
  if (command.selector === "all_available") return sorted;
  if (command.selector === "all_six") return [1, 2, 3, 4, 5, 6];
  if (command.selector === "earliest") return sorted.slice(0, 1);
  if (command.selector === "earliest_three") return sorted.slice(0, 3);
  if (command.selector === "latest") return sorted.slice(-1);
  if (command.selector === "latest_two") return sorted.slice(-2);
  if (command.selector === "latest_three") return sorted.slice(-3);
  if (command.selector === "previous") {
    const first = current.length ? Math.min(...current) : Number.POSITIVE_INFINITY;
    return sorted.filter((wave) => wave < first).slice(-1);
  }
  return [];
}

function supplementSearchScope(
  program: TurnProgram,
  message: string,
): TurnProgram {
  if (!program.commands.some((command) => command.kind === "search_questions")) {
    return program;
  }
  const commands = [...program.commands];
  const countries = parseCountries(message);
  const waves = parseWaves(message);
  const statistic = parseStatistic(message);
  if (
    !commands.some((command) => command.kind === "modify_countries")
    && (countries.all || countries.values.length)
    && commands.length < 6
  ) {
    commands.push({
      kind: "modify_countries",
      operation: countries.all ? "set" : countries.operation,
      values: countries.all
        ? []
        : countries.values
            .map((code) => COUNTRY_NAMES.get(code))
            .filter((name): name is string => Boolean(name)),
      selector: countries.all ? "all_available" : "explicit",
    });
  }
  if (
    !commands.some((command) => command.kind === "modify_waves")
    && (waves.all || waves.values.length)
    && commands.length < 6
  ) {
    commands.push({
      kind: "modify_waves",
      operation: waves.all ? "set" : waves.operation,
      values: waves.all ? [] : waves.values,
      selector: waves.all ? "all_available" : "explicit",
    });
  }
  if (
    statistic
    && !commands.some((command) => command.kind === "set_statistic")
    && commands.length < 6
  ) {
    commands.push({ kind: "set_statistic", statistic });
  }
  return { ...program, commands };
}

async function applyCloudTurnProgram(
  state: ConversationState,
  program: TurnProgram,
  data: Bootstrap,
): Promise<ConversationResponse> {
  if (program.relation === "unclear" || program.unresolved.length) {
    return unresolvedProgram(state, program);
  }
  const social = program.commands.find(
    (command): command is Extract<ConversationCommand, { kind: "social" }> => command.kind === "social",
  );
  if (social) {
    const reply = social.operation === "close"
      ? "好的，這次分析先到這裡。"
      : "不客氣。你可以繼續調整統計量、國家、波次，或提出新的調查主題。";
    addTurn(state, "assistant", reply);
    const detail = state.plan.questionId ? await question(state.plan.questionId) : null;
    return publicConversation(state, "answered", "acknowledged", reply, detail ? suggestionsFor(state, detail) : []);
  }
  const repair = program.commands.find(
    (command): command is Extract<ConversationCommand, { kind: "repair" }> => command.kind === "repair",
  );
  if (repair) {
    if (repair.operation === "restart_question") {
      state.previousPlan = clonePlan(state.plan);
      state.plan = { questionId: null, statistic: null, countries: [], waves: [] };
      state.questionQuery = null;
      state.activeSnapshot = null;
      state.pending = null;
      state.options = [];
      const reply = "已開始新問題。";
      addTurn(state, "assistant", reply, null, "flow_boundary");
      return publicConversation(state, "answered", "discussed", reply);
    }
    if (repair.operation === "cancel_pending") {
      state.pending = null;
      state.options = [];
      const reply = "已取消目前的澄清；既有分析結果沒有被修改。";
      addTurn(state, "assistant", reply);
      return publicConversation(state, "answered", "acknowledged", reply);
    }
    if (state.previousPlan) {
      const current = clonePlan(state.plan);
      state.plan = clonePlan(state.previousPlan);
      state.previousPlan = current;
      return answerPlan(state, "revised");
    }
    return unresolvedProgram(state, {
      ...program,
      commands: [],
      relation: "unclear",
      unresolved: [{ slot: "other", detail: "目前沒有可復原的上一項變更" }],
    });
  }
  const pendingSelection = program.commands.find(
    (command): command is Extract<ConversationCommand, { kind: "select_pending_option" }> => command.kind === "select_pending_option",
  );
  if (pendingSelection) {
    const option = state.options.find((candidate) => candidate.option_id === pendingSelection.option_id);
    if (!option || pendingSelection.pending_id !== state.pending?.pending_id) return cloudProgramFailure(state);
    state.previousPlan = clonePlan(state.plan);
    return selectPendingOption(state, option);
  }
  const discussion = program.commands.find(
    (command): command is Extract<ConversationCommand, { kind: "discuss_result" }> => command.kind === "discuss_result",
  );
  if (program.relation === "discuss" || discussion) {
    const reply = state.activeSnapshot
      ? "目前結果仍維持不變。圖表的未納入範圍與樣本基數可在結果说明中查看；若要改分析，请明确指定题目、国家、波次或统计量。"
      : "目前還沒有可討論的分析結果；請先指定調查題目與分析範圍。";
    addTurn(state, "assistant", reply);
    return publicConversation(state, "answered", "discussed", reply);
  }
  if (program.commands.some((command) => command.kind === "modify_categories")) {
    return cloudProgramFailure(
      state,
      "雲端備援目前不能安全修改回答類別；既有分析沒有被修改。請先使用結果頁面的類別控制項。",
    );
  }

  const original = clonePlan(state.plan);
  let next = clonePlan(state.plan);
  const searchCommand = program.commands.find(
    (command): command is Extract<ConversationCommand, { kind: "search_questions" }> => command.kind === "search_questions",
  );
  const selectQuestionCommand = program.commands.find(
    (command): command is Extract<ConversationCommand, { kind: "select_question" }> => command.kind === "select_question",
  );
  if (searchCommand) {
    next = { questionId: null, statistic: null, countries: [], waves: [] };
  } else if (program.relation === "start" && selectQuestionCommand) {
    next = { questionId: null, statistic: null, countries: [], waves: [] };
  }
  if (selectQuestionCommand) {
    const selected = data.questions.find(
      (item) => item.variable_id.toLowerCase() === selectQuestionCommand.question_id.toLowerCase(),
    );
    if (!selected) return unresolvedProgram(state, {
      ...program,
      commands: [],
      relation: "unclear",
      unresolved: [{ slot: "question", detail: "指定的題號不在目前資料版本中" }],
    });
    next.questionId = selected.variable_id;
  }
  for (const command of program.commands) {
    if (command.kind === "modify_countries") {
      const values = command.selector === "all_available"
        ? data.countries.map((country) => country.country_code)
        : (command.values ?? [])
            .map((country) => COUNTRY_CODES.get(country))
            .filter((code): code is number => typeof code === "number");
      next.countries = applyListChange(next.countries, command.operation, values);
    }
    if (command.kind === "modify_waves") {
      const available = data.questions.find(
        (item) => item.variable_id === next.questionId,
      )?.waves ?? data.waves;
      next.waves = applyListChange(
        next.waves,
        command.operation,
        waveValuesForCommand(command, next.waves, available),
      );
    }
    if (command.kind === "set_statistic") next.statistic = command.statistic;
    if (command.kind === "set_representation") {
      next.statistic = command.representation === "continuous"
        ? "mean"
        : command.representation === "order"
          ? "median"
          : "distribution";
    }
  }

  state.previousPlan = original;
  state.plan = next;
  if (searchCommand) {
    const semanticQuery = [searchCommand.query_original, searchCommand.query_en]
      .filter((value): value is string => Boolean(value?.trim()))
      .join("\n");
    state.questionQuery = semanticQuery;
    state.activeSnapshot = null;
    const matches = (await catalogSearch(semanticQuery)).questions;
    if (!matches.length) {
      const reply = "目前找不到符合這個概念的題目；請提供題號或更完整的題目文字。";
      addTurn(state, "assistant", reply);
      return publicConversation(state, "unsupported", "unsupported", reply);
    }
    setPending(
      state,
      "question",
      "請選擇最符合需求的調查題目。",
      ["question"],
      questionOptions(matches),
    );
    const reply = "這個說法可能對應不同的測量。請選擇題目：";
    addTurn(state, "assistant", reply);
    return publicConversation(state, "needs_clarification", "clarified", reply);
  }
  if (selectQuestionCommand) {
    state.questionQuery = null;
    state.pending = null;
    state.options = [];
  }
  if (!state.plan.questionId && state.pending?.kind === "question") {
    const reply = "已記錄這項分析條件；請繼續選擇最符合需求的調查題目。";
    addTurn(state, "assistant", reply);
    return publicConversation(state, "needs_clarification", "clarified", reply);
  }
  if (!state.plan.questionId) {
    const reply = "已記錄分析條件；請再說明要分析的調查主題或題目。";
    addTurn(state, "assistant", reply);
    return publicConversation(state, "needs_clarification", "clarified", reply);
  }
  return answerPlan(state, state.activeSnapshot ? "revised" : "analyzed");
}

async function sendConversationMessage(
  conversationId: string,
  message: string,
  expectedRevision: number,
): Promise<ConversationResponse> {
  const state = CONVERSATIONS.get(conversationId);
  if (!state) throw new Error("The conversation is no longer available.");
  if (expectedRevision !== state.revision) {
    throw new Error("The analysis state changed. Review the latest result before trying again.");
  }
  state.revision += 1;
  addTurn(state, "user", message);
  const trimmed = message.trim();
  const displayedOption = exactPendingOption(state, trimmed);
  if (displayedOption) {
    state.previousPlan = clonePlan(state.plan);
    return selectPendingOption(state, displayedOption);
  }
  if (canRequestCloudTurnProgram()) {
    const data = await bootstrap();
    const context = await cloudTurnContext(state, trimmed, data);
    const explicitRespondentProgram = forceExplicitRespondentCountryProgram(
      state,
      context,
      trimmed,
      {
        schema_version: 1,
        relation: "unclear",
        commands: [],
        unresolved: [],
        source: "model",
      },
    );
    if (explicitRespondentProgram.commands.length > 0) {
      return applyCloudTurnProgram(state, explicitRespondentProgram, data);
    }
    const program = await requestCloudTurnProgram(context);
    if (!program) return cloudProgramFailure(state);
    const guardedProgram = guardAmbiguousCountryProgram(
      state,
      context,
      trimmed,
      program,
    );
    const respondentProgram = forceExplicitRespondentCountryProgram(
      state,
      context,
      trimmed,
      guardedProgram,
    );
    const effectiveProgram = safeCountryContinuationFallback(
      state,
      context,
      trimmed,
      respondentProgram,
    );
    const topicFallback = await safeTopicContinuationFallback(
      state,
      context,
      trimmed,
      effectiveProgram,
      data,
    );
    if (topicFallback) return topicFallback;
    return applyCloudTurnProgram(
      state,
      supplementSearchScope(effectiveProgram, trimmed),
      data,
    );
  }
  if (/^(?:thanks?|thank you|謝謝|谢谢|好的|好)$/iu.test(trimmed)) {
    state.pending = null;
    state.options = [];
    const reply = "不客氣。你可以繼續調整統計量、國家、波次，或提出新的調查主題。";
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
    const reply = `目前的 ABS 資料沒有 ${countries.unsupported} 的受訪者樣本；目前結果未被修改。`;
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
  const hasOperationalChange =
    statistic !== null ||
    countries.values.length > 0 ||
    countries.all ||
    waves.values.length > 0 ||
    waves.all;
  const isOperationalOnly = operationalOnly(trimmed);
  const currentCanContinue =
    Boolean(state.plan.questionId) &&
    !explicitQuestion &&
    hasOperationalChange &&
    isOperationalOnly &&
    !/(?:new question|another question|換題|换题|新問題|新问题)/iu.test(trimmed);

  if (
    state.pending?.kind === "question" &&
    !explicitQuestion &&
    isOperationalOnly &&
    hasOperationalChange
  ) {
    applyConversationModifiers(state, countries, waves, statistic, data);
    if (state.questionQuery && statistic) {
      const matches = (await catalogSearch(
        `${state.questionQuery} ${STATISTIC_LABEL_ZH[statistic]}`,
      )).questions;
      state.options = questionOptions(matches);
    }
    const reply = "已記錄這項分析條件；請繼續選擇最符合需求的調查題目。";
    addTurn(state, "assistant", reply);
    return publicConversation(state, "needs_clarification", "clarified", reply);
  }

  if (!state.plan.questionId && isOperationalOnly && !explicitQuestion) {
    applyConversationModifiers(state, countries, waves, statistic, data);
    const reply = "已記錄國家、波次或統計條件；請再說明要分析的調查主題或題目。";
    addTurn(state, "assistant", reply);
    return publicConversation(state, "needs_clarification", "clarified", reply);
  }

  if (explicitQuestion || !currentCanContinue) {
    const matches = explicitQuestion
      ? [explicitQuestion]
      : (await catalogSearch(trimmed)).questions;
    if (!matches.length) {
      state.pending = null;
      state.options = [];
      const reply = "目前找不到符合這個概念的題目；請提供題號或更完整的題目文字。";
      addTurn(state, "assistant", reply);
      return publicConversation(state, "unsupported", "unsupported", reply);
    }
    if (!explicitQuestion) {
      state.questionQuery = trimmed;
      state.plan = {
        questionId: null,
        statistic: null,
        countries: [],
        waves: [],
      };
      applyConversationModifiers(state, countries, waves, statistic, data);
      setPending(
        state,
        "question",
        "請選擇最符合需求的調查題目。",
        ["question"],
        questionOptions(matches),
      );
      const reply = "這個說法可能對應不同的測量。請選擇題目：";
      addTurn(state, "assistant", reply);
      return publicConversation(state, "needs_clarification", "clarified", reply);
    }
    state.questionQuery = null;
    state.previousPlan = clonePlan(state.plan);
    state.plan.questionId = explicitQuestion.variable_id;
  }
  applyConversationModifiers(state, countries, waves, statistic, data);
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
  expectedRevision: number,
  displayLabel?: string,
): Promise<ConversationResponse> {
  const state = CONVERSATIONS.get(conversationId);
  if (!state) throw new Error("The conversation is no longer available.");
  if (expectedRevision !== state.revision) {
    throw new Error("The analysis state changed. Review the latest result before trying again.");
  }
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
      state.questionQuery = null;
      state.activeSnapshot = null;
      state.pending = null;
      state.options = [];
      const reply = "已開始新問題。";
      addTurn(state, "assistant", reply, null, "flow_boundary");
      return publicConversation(state, "answered", "discussed", reply);
    } else if (command.operation === "cancel_pending") {
      state.pending = null;
      state.options = [];
      const reply = "已取消目前的澄清；既有分析結果沒有被修改。";
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
    questionQuery: null,
    pending: null,
    options: [],
    activeSnapshot: null,
    previousPlan: null,
  };
  CONVERSATIONS.set(state.id, state);
  return publicConversation(state, "answered", "discussed");
}

function planFromConversation(response: ConversationResponse): ConversationPlan {
  const draft = response.active_snapshot?.draft;
  const plan: ConversationPlan = {
    questionId: draft?.target_kind === "question" ? draft.target_id : null,
    statistic: response.active_snapshot?.view.statistic ?? null,
    countries: [...(draft?.countries ?? [])],
    waves: [...(draft?.waves ?? [])],
  };
  if (draft) return plan;
  for (const turn of response.turns) {
    if (turn.role !== "user") continue;
    const statistic = parseStatistic(turn.message);
    const countries = parseCountries(turn.message);
    const waves = parseWaves(turn.message);
    if (statistic) plan.statistic = statistic;
    if (countries.values.length) {
      plan.countries = applyListChange(plan.countries, countries.operation, countries.values);
    }
    if (waves.values.length) {
      plan.waves = applyListChange(plan.waves, waves.operation, waves.values);
    }
    const explicitId = turn.message.match(/\bq\d+(?:\.\d+)?\b/i)?.[0]?.toLowerCase();
    if (explicitId) plan.questionId = explicitId;
  }
  return plan;
}

/**
 * Imports only the public, aggregate-safe conversation contract already held by
 * the browser.  This lets a local-started conversation continue after a bridge
 * outage without contacting the unavailable Mac or uploading respondent data.
 */
function importConversation(response: ConversationResponse): ConversationResponse {
  const existing = CONVERSATIONS.get(response.conversation_id);
  if (existing && existing.revision > response.revision) {
    return publicConversation(existing, "answered", "discussed");
  }
  const plan = planFromConversation(response);
  const state: ConversationState = {
    id: response.conversation_id,
    revision: response.revision,
    turns: response.turns.map((turn) => ({ ...turn })),
    plan,
    questionQuery: response.pending?.kind === "question"
      ? [...response.turns].reverse().find((turn) => turn.role === "user")?.message ?? null
      : null,
    pending: response.pending ? { ...response.pending } : null,
    options: response.options.map((option) => ({ ...option })),
    activeSnapshot: response.active_snapshot,
    previousPlan: null,
  };
  CONVERSATIONS.set(state.id, state);
  return { ...response, execution_mode: "cloud" };
}

async function startNewQuestion(conversationId: string): Promise<ConversationResponse> {
  const state = CONVERSATIONS.get(conversationId);
  if (!state) throw new Error("The conversation is no longer available.");
  state.revision += 1;
  state.plan = { questionId: null, statistic: null, countries: [], waves: [] };
  state.questionQuery = null;
  state.pending = null;
  state.options = [];
  state.activeSnapshot = null;
  const message = "已開始新問題。";
  addTurn(state, "assistant", message, null, "flow_boundary");
  return publicConversation(state, "answered", "discussed", message);
}

export const api = {
  bootstrap,
  catalogSearch,
  question,
  responseSet,
  assistantStatus: async (): Promise<AssistantStatus> => localAssistantStatus(),
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
    const search = await catalogSearch(prompt);
    return {
      clarification_required: true,
      detail: "Choose the survey question that best matches your request.",
      candidates: search.questions,
    };
  },
  createConversation,
  importConversation,
  sendConversationMessage,
  sendConversationCommand,
  startNewQuestion,
};
