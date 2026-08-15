import type {
  CloudTurnContext,
  ConversationCommand,
  TurnProgram,
  TurnProgramUnresolvedReference,
} from "./types";

export const CANONICAL_RESPONDENT_COUNTRIES = [
  "Japan",
  "Hong Kong",
  "South Korea",
  "Mainland China",
  "Mongolia",
  "Philippines",
  "Taiwan",
  "Thailand",
  "Indonesia",
  "Singapore",
  "Vietnam",
  "Cambodia",
  "Malaysia",
  "Myanmar",
  "Australia",
  "India",
  "Bangladesh",
  "Sri Lanka",
] as const;

const COUNTRY_SET = new Set<string>(CANONICAL_RESPONDENT_COUNTRIES);
const RELATIONS = new Set([
  "start",
  "revise",
  "answer_pending",
  "discover",
  "discuss",
  "repair",
  "social",
  "unclear",
]);
const STATISTICS = new Set([
  "distribution",
  "category_share",
  "mean",
  "median",
  "quartiles",
  "sd",
  "base_n",
]);
const WAVE_SELECTORS = new Set([
  "explicit",
  "from_wave",
  "through",
  "through_latest",
  "ensure_multiple",
  "all_available",
  "all_six",
  "earliest",
  "earliest_three",
  "latest",
  "latest_three",
  "latest_two",
  "previous",
]);
const UNRESOLVED_SLOTS = new Set([
  "relation",
  "question",
  "country_role",
  "wave",
  "statistic",
  "other",
]);
const EXPLICIT_NEGATION = /(?:\b(?:do\s+not|don't|dont|never|not)\b|不要|不用|不必|先別|先别|別|别|不可|不能|勿)/iu;
const ADD_EVIDENCE = /(?:\b(?:add|also|include|plus)\b|再|也|還要|还要|加入|加上|納入|纳入|新增|增加)/iu;
const REMOVE_EVIDENCE = /(?:\b(?:remove|exclude|drop|without|except)\b|刪除|删除|移除|排除|不要|剔除)/iu;
const ALL_COUNTRY_EVIDENCE = /(?:\b(?:all|every|each)\s+(?:available\s+)?(?:respondent\s+)?(?:countries|regions|places)\b|全部(?:國家|国家|地區|地区)|所有(?:國家|国家|地區|地区)|各國|各国|各地區|各地区)/iu;
const COUNTRY_EVIDENCE: Record<string, RegExp> = {
  Japan: /(?:\bjapan(?:ese)?\b|日本|日韓|日韩)/iu,
  "Hong Kong": /(?:\bhong\s*kong\b|香港)/iu,
  "South Korea": /(?:\bsouth\s*korea(?:n)?\b|\bkorea(?:n)?\b|韓國|韩国|南韓|南韩|日韓|日韩)/iu,
  "Mainland China": /(?:\bmainland\s*china\b|中國大陸|中国大陆|大陸|大陆)/iu,
  Mongolia: /(?:\bmongolia(?:n)?\b|蒙古)/iu,
  Philippines: /(?:\bphilippines?\b|\bfilipino\b|菲律賓|菲律宾)/iu,
  Taiwan: /(?:\btaiwan(?:ese)?\b|台灣|台湾)/iu,
  Thailand: /(?:\bthailand\b|\bthai\b|泰國|泰国)/iu,
  Indonesia: /(?:\bindonesia(?:n)?\b|印尼)/iu,
  Singapore: /(?:\bsingapore(?:an)?\b|新加坡)/iu,
  Vietnam: /(?:\bvietnam(?:ese)?\b|越南)/iu,
  Cambodia: /(?:\bcambodia(?:n)?\b|柬埔寨)/iu,
  Malaysia: /(?:\bmalaysia(?:n)?\b|馬來西亞|马来西亚)/iu,
  Myanmar: /(?:\bmyanmar\b|\bburmese\b|緬甸|缅甸)/iu,
  Australia: /(?:\baustralia(?:n)?\b|澳洲|澳大利亞|澳大利亚)/iu,
  India: /(?:\bindia(?:n)?\b|印度)/iu,
  Bangladesh: /(?:\bbangladesh(?:i)?\b|孟加拉)/iu,
  "Sri Lanka": /(?:\bsri\s*lanka(?:n)?\b|斯里蘭卡|斯里兰卡)/iu,
};
const STATISTIC_EVIDENCE: Record<string, RegExp> = {
  distribution: /(?:\bdistribution\b|回答分[佈布]|各選項|各选项)/iu,
  category_share: /(?:\b(?:share|proportion|percentage)\b|比例|百分比)/iu,
  mean: /(?:\b(?:mean|average)\b|平均)/iu,
  median: /(?:\bmedian\b|中位)/iu,
  quartiles: /(?:\bquartiles?\b|四分位)/iu,
  sd: /(?:\b(?:sd|standard deviation)\b|標準差|标准差)/iu,
  base_n: /(?:\b(?:valid n|sample size|base n)\b|有效人數|有效人数|樣本數|样本数)/iu,
};

function pendingOptionGrounded(
  command: Extract<ConversationCommand, { kind: "select_pending_option" }>,
  context: CloudTurnContext,
): boolean {
  const options = context.pending?.allowed_options ?? [];
  const selected = options.find((option) => option.option_id === command.option_id);
  if (!selected) return false;
  const message = context.latest_message.normalize("NFKC").trim().toLowerCase();
  if ([selected.label, selected.value].some((value) =>
    message.includes(value.normalize("NFKC").trim().toLowerCase()),
  )) return true;
  const ordinal = message.match(/(?:\boption\s*|第\s*)(\d+)(?:\s*(?:個|个|項|项))?/iu);
  return Boolean(ordinal && options.indexOf(selected) === Number(ordinal[1]) - 1);
}

function waveCommandGrounded(
  command: Extract<ConversationCommand, { kind: "modify_waves" }>,
  message: string,
): boolean {
  const selectorEvidence: Record<string, RegExp> = {
    explicit: /(?:\b(?:wave|w)\s*[1-6]\b|第\s*[一二三四五六1-6]\s*波|[1-6]\s*(?:-|–|—|to|through|至|到)\s*[1-6])/iu,
    from_wave: /(?:\bfrom\s+(?:wave|w)?\s*[1-6]|從\s*第?\s*[一二三四五六1-6]\s*波|从\s*第?\s*[一二三四五六1-6]\s*波)/iu,
    through: /(?:\b(?:through|until|up to)\s+(?:wave|w)?\s*[1-6]|(?:到|至)\s*第?\s*[一二三四五六1-6]\s*波)/iu,
    through_latest: /(?:\bthrough\s+(?:the\s+)?latest\b|直到最新|到最新)/iu,
    ensure_multiple: /(?:\bmultiple\s+waves?\b|至少[兩两二2](?:個|个)?波|多個波次|多个波次)/iu,
    all_available: /(?:\b(?:all|every|each)\s+(?:available\s+)?waves?\b|\bacross\s+(?:all\s+)?waves?\b|\bby\s+waves?\b|各波|歷次|历次|全部(?:可用)?波次|所有(?:可用)?波次)/iu,
    all_six: /(?:\ball\s+six\s+waves?\b|全部六波|六個波次|六个波次)/iu,
    earliest: /(?:\bearliest\s+wave\b|最早一波|第一波)/iu,
    earliest_three: /(?:\b(?:earliest|first)\s+(?:three|3)\s+waves?\b|最早三波|前三波)/iu,
    latest: /(?:\b(?:latest|most recent|last)\s+wave\b|最新一波|最近一波|最後一波|最后一波)/iu,
    latest_three: /(?:\b(?:latest|most recent|last)\s+(?:three|3)\s+waves?\b|最新三波|最近三波|最後三波|最后三波)/iu,
    latest_two: /(?:\b(?:latest|most recent|last)\s+(?:two|2)\s+waves?\b|最新[兩两二2]波|最近[兩两二2]波|最後[兩两二2]波|最后[兩两二2]波)/iu,
    previous: /(?:\bprevious\s+wave\b|上一波|前一波)/iu,
  };
  return Boolean(selectorEvidence[command.selector]?.test(message));
}

function commandGrounded(
  command: ConversationCommand,
  context: CloudTurnContext,
): boolean {
  const message = context.latest_message;
  if (command.kind === "search_questions") return command.query_original === message;
  if (command.kind === "select_question") {
    return new RegExp(`\\b${command.question_id.replace(".", "\\.")}\\b`, "iu").test(message);
  }
  if (command.kind === "select_pending_option") return pendingOptionGrounded(command, context);
  if (command.kind === "modify_countries") {
    if (command.selector === "all_available") return ALL_COUNTRY_EVIDENCE.test(message);
    if (!(command.values ?? []).every((country) => COUNTRY_EVIDENCE[country]?.test(message))) return false;
    if (command.operation === "add") return ADD_EVIDENCE.test(message);
    if (command.operation === "remove") return REMOVE_EVIDENCE.test(message);
    return true;
  }
  if (command.kind === "modify_waves") return waveCommandGrounded(command, message);
  if (command.kind === "set_statistic") return Boolean(STATISTIC_EVIDENCE[command.statistic]?.test(message));
  if (command.kind === "set_representation") {
    const evidence: Record<string, RegExp> = {
      category: /(?:\bcategor(?:y|ical)\b|類別|类别)/iu,
      order: /(?:\bordin(?:al|ality)\b|次序|順序|顺序)/iu,
      continuous: /(?:\bcontinuous\b|連續|连续)/iu,
    };
    return evidence[command.representation].test(message);
  }
  if (command.kind === "modify_categories") {
    return command.values.every((category) =>
      message.normalize("NFKC").includes(category.normalize("NFKC")),
    );
  }
  if (command.kind === "repair") {
    return /(?:\b(?:undo|restore|cancel|restart|start over)\b|撤銷|撤销|復原|复原|取消|重新開始|重新开始|新問題|新问题)/iu.test(message);
  }
  if (command.kind === "social") {
    return /(?:\b(?:thanks?|thank you|ok(?:ay)?|bye|close)\b|謝謝|谢谢|好的|好|再見|再见|結束|结束)/iu.test(message.trim());
  }
  if (command.kind === "discuss_result") return true;
  return false;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function strings(value: unknown, maximum: number): string[] | null {
  if (
    !Array.isArray(value)
    || value.length > maximum
    || value.some((item) => typeof item !== "string")
  ) return null;
  return value.map(String);
}

function waves(value: unknown): number[] | null {
  if (
    !Array.isArray(value)
    || value.length > 6
    || value.some((item) => !Number.isInteger(item) || Number(item) < 1 || Number(item) > 6)
  ) return null;
  return value.map(Number);
}

function validateUnresolved(value: unknown): TurnProgramUnresolvedReference | null {
  const item = record(value);
  if (
    !item
    || !UNRESOLVED_SLOTS.has(String(item.slot))
    || typeof item.detail !== "string"
    || !item.detail.trim()
    || item.detail.length > 300
  ) return null;
  return {
    slot: item.slot as TurnProgramUnresolvedReference["slot"],
    detail: item.detail.trim(),
  };
}

function validateCommand(
  value: unknown,
  context: CloudTurnContext,
): ConversationCommand | null {
  const item = record(value);
  if (!item || typeof item.kind !== "string") return null;
  const kind = item.kind;
  if (kind === "select_question") {
    if (typeof item.question_id !== "string" || !/^q\d+(?:\.\d+)?$/iu.test(item.question_id)) return null;
    return { kind, question_id: item.question_id.toLowerCase() };
  }
  if (kind === "search_questions") {
    const entities = strings(item.object_entities ?? [], 8);
    if (
      !["analyze", "discover"].includes(String(item.purpose))
      || item.query_original !== context.latest_message
      || (item.query_en !== null && item.query_en !== undefined && typeof item.query_en !== "string")
      || (typeof item.query_en === "string" && item.query_en.length > 500)
      || !entities
      || entities.some((entity) => !entity.trim() || entity.length > 120)
    ) return null;
    return {
      kind,
      purpose: item.purpose as "analyze" | "discover",
      query_original: context.latest_message,
      query_en: typeof item.query_en === "string" ? item.query_en : null,
      object_entities: entities.map((entity) => entity.trim()),
    };
  }
  if (kind === "select_pending_option") {
    if (
      !context.pending
      || item.pending_id !== context.pending.pending_id
      || typeof item.option_id !== "string"
      || !context.pending.allowed_options.some((option) => option.option_id === item.option_id)
    ) return null;
    return { kind, pending_id: context.pending.pending_id, option_id: item.option_id };
  }
  if (kind === "modify_countries") {
    const values = strings(item.values ?? [], 20);
    const selector = String(item.selector);
    if (
      !["set", "add", "remove"].includes(String(item.operation))
      || !["explicit", "all_available"].includes(selector)
      || !values
      || values.some((country) => !COUNTRY_SET.has(country))
      || (selector === "explicit" && values.length === 0)
      || (selector === "all_available" && values.length !== 0)
    ) return null;
    return {
      kind,
      operation: item.operation as "set" | "add" | "remove",
      values,
      selector: selector as "explicit" | "all_available",
    };
  }
  if (kind === "modify_waves") {
    const values = waves(item.values ?? []);
    const selector = String(item.selector);
    const selectorsWithValues = new Set(["explicit", "from_wave", "through"]);
    if (
      !["set", "add", "remove"].includes(String(item.operation))
      || !WAVE_SELECTORS.has(selector)
      || !values
      || (selectorsWithValues.has(selector) && values.length === 0)
      || (!selectorsWithValues.has(selector) && values.length !== 0)
      || (["from_wave", "through"].includes(selector) && values.length !== 1)
    ) return null;
    return {
      kind,
      operation: item.operation as "set" | "add" | "remove",
      values,
      selector: selector as Extract<ConversationCommand, { kind: "modify_waves" }>["selector"],
    };
  }
  if (kind === "modify_categories") {
    const values = strings(item.values, 12);
    const allowed = new Set(context.current_goal?.category_options ?? []);
    if (
      !["set", "add", "remove"].includes(String(item.operation))
      || !values
      || values.length === 0
      || values.some((category) => !allowed.has(category))
    ) return null;
    return {
      kind,
      operation: item.operation as "set" | "add" | "remove",
      values,
    };
  }
  if (kind === "set_statistic") {
    if (!STATISTICS.has(String(item.statistic))) return null;
    return { kind, statistic: item.statistic as Extract<ConversationCommand, { kind: "set_statistic" }>["statistic"] };
  }
  if (kind === "set_representation") {
    if (!["category", "order", "continuous"].includes(String(item.representation))) return null;
    return {
      kind,
      representation: item.representation as "category" | "order" | "continuous",
    };
  }
  if (kind === "discuss_result") {
    if (!["interpretation", "coverage", "direction", "causality", "other"].includes(String(item.topic))) return null;
    return {
      kind,
      topic: item.topic as Extract<ConversationCommand, { kind: "discuss_result" }>["topic"],
    };
  }
  if (kind === "repair") {
    if (
      !["undo_last_change", "restore_snapshot", "cancel_pending", "restart_question"].includes(String(item.operation))
      || (item.target_id !== null && item.target_id !== undefined && typeof item.target_id !== "string")
    ) return null;
    if (["undo_last_change", "restore_snapshot"].includes(String(item.operation)) && !context.prior_effective_change) return null;
    if (item.operation === "cancel_pending" && !context.pending) return null;
    return {
      kind,
      operation: item.operation as Extract<ConversationCommand, { kind: "repair" }>["operation"],
      target_id: typeof item.target_id === "string" ? item.target_id : null,
    };
  }
  if (kind === "social") {
    if (!["thanks", "acknowledge", "close"].includes(String(item.operation))) return null;
    return {
      kind,
      operation: item.operation as "thanks" | "acknowledge" | "close",
    };
  }
  return null;
}

export function validateTurnProgram(
  value: unknown,
  context: CloudTurnContext,
): TurnProgram | null {
  const item = record(value);
  if (
    !item
    || item.schema_version !== 1
    || item.source !== "model"
    || !RELATIONS.has(String(item.relation))
    || !Array.isArray(item.commands)
    || item.commands.length > 6
    || !Array.isArray(item.unresolved)
    || item.unresolved.length > 4
  ) return null;
  const commands = item.commands.map((command) => validateCommand(command, context));
  const unresolved = item.unresolved.map(validateUnresolved);
  if (commands.some((command) => !command) || unresolved.some((reference) => !reference)) return null;
  const relation = item.relation as TurnProgram["relation"];
  if (commands.length > 0 && unresolved.length > 0) return null;
  if (commands.length === 0 && !["discuss", "unclear"].includes(relation)) return null;
  const repairs = commands.filter((command) => command?.kind === "repair");
  const socials = commands.filter((command) => command?.kind === "social");
  const pendingSelections = commands.filter(
    (command) => command?.kind === "select_pending_option",
  );
  if (repairs.length && (repairs.length !== 1 || commands.length !== 1 || relation !== "repair")) return null;
  if (socials.length && (socials.length !== 1 || commands.length !== 1 || relation !== "social")) return null;
  if (relation === "repair" && repairs.length !== 1) return null;
  if (relation === "social" && socials.length !== 1) return null;
  if (
    pendingSelections.length
    && (
      pendingSelections.length !== 1
      || commands.length !== 1
      || relation !== "answer_pending"
    )
  ) return null;
  if (
    EXPLICIT_NEGATION.test(context.latest_message)
    && commands.some((command) =>
      command
      && !["discuss_result", "social"].includes(command.kind),
    )
  ) {
    const first = commands[0];
    const slot: TurnProgramUnresolvedReference["slot"] = first?.kind === "modify_countries"
      ? "country_role"
      : first?.kind === "modify_waves"
        ? "wave"
        : first?.kind === "set_statistic"
          ? "statistic"
          : first?.kind === "select_question" || first?.kind === "search_questions"
            ? "question"
            : "other";
    return {
      schema_version: 1,
      relation: "unclear",
      commands: [],
      unresolved: [{
        slot,
        detail: "The requested edit is negated or cancellation intent is ambiguous.",
      }],
      source: "model",
    };
  }
  const groundedCommands = (commands as ConversationCommand[]).filter((command) =>
    commandGrounded(command, context),
  );
  if (groundedCommands.length === 0 && commands.length > 0) {
    return {
      schema_version: 1,
      relation: "unclear",
      commands: [],
      unresolved: [{
        slot: "other",
        detail: "The proposed state edit was not explicitly grounded in the latest message.",
      }],
      source: "model",
    };
  }
  return {
    schema_version: 1,
    relation,
    commands: groundedCommands,
    unresolved: unresolved as TurnProgramUnresolvedReference[],
    source: "model",
  };
}
