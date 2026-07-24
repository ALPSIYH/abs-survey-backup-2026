export type Locale = "en" | "zh-Hant";

export const DEFAULT_LOCALE: Locale = "en";

const EN_COPY = {
  "brand.name": "Asian Barometer Survey Explorer",
  "brand.subtitle": "Explore survey questions, compare places and waves, and verify every result",
  "nav.conversation": "Conversation",
  "nav.workspace": "Analysis workspace",
  "nav.language": "Language",
  "nav.english": "English",
  "nav.traditionalChinese": "Traditional Chinese",
  "library.title": "Question library",
  "library.searchLabel": "Search questions",
  "library.searchPlaceholder": "Search question ID, wording, or topic",
  "library.topicLabel": "Topic",
  "library.allTopics": "All topics",
  "library.questions": "Questions",
  "library.responseSets": "Multiple-response sets",
  "library.noResults": "No matching questions",
  "library.questionCount": "{count} questions",
  "library.availableWaves": "Available waves",
  "library.availableAnalysis": "Available analysis",
  "library.completeScale": "View complete scale and scoring",
  "library.singleChoice": "Single choice",
  "library.multipleChoice": "Multiple response",
  "workspace.title": "Analysis workspace",
  "workspace.selectQuestion": "Select a question",
  "workspace.analysisType": "Analysis",
  "workspace.scope": "Data scope",
  "workspace.countries": "Countries and regions",
  "workspace.waves": "Survey waves",
  "workspace.allCountries": "Select all countries and regions",
  "workspace.allWaves": "Select all waves",
  "workspace.statistic": "Statistic",
  "workspace.grouping": "Split results",
  "workspace.update": "Update result",
  "workspace.clear": "Clear",
  "workspace.coverage": "Data coverage",
  "workspace.noSelection": "Select a question to begin",
  "workspace.missingContexts": "{count} country-wave combinations have no data and will be excluded",
  "workspace.selectedContexts": "{count} country-wave combinations selected",
  "workspace.distribution": "Response distribution",
  "workspace.summary": "Statistical summary",
  "assistant.title": "Analysis assistant",
  "assistant.connected": "Local assistant connected",
  "assistant.disconnected": "Local assistant not connected",
  "assistant.askAnyLanguage": "Ask in any language",
  "assistant.inputPlaceholder": "Ask about a question, statistic, country, or wave",
  "assistant.send": "Send",
  "assistant.newQuestion": "New question",
  "assistant.newConversation": "New conversation",
  "assistant.thinking": "Working",
  "assistant.understanding": "Interpreting your request",
  "assistant.querying": "Querying the survey data",
  "assistant.rendering": "Preparing the result",
  "assistant.resultShown": "The result is shown in the analysis area",
  "assistant.selectQuestion": "Select a question",
  "assistant.selectCountry": "Select countries and regions",
  "assistant.selectWave": "Select survey waves",
  "assistant.selectStatistic": "Select a statistic",
  "results.title": "Results",
  "results.chart": "Chart",
  "results.data": "Data",
  "results.noResult": "Run an analysis to view results",
  "results.validN": "Valid responses",
  "results.totalRecords": "Records in scope",
  "results.included": "Included",
  "results.excluded": "Excluded",
  "results.denominator": "Denominator",
  "results.loading": "Loading results",
  "results.scale": "Response scale",
  "results.scoringDirection": "Scoring direction",
  "results.missingCoverage": "Unavailable country-wave combinations",
  "results.estimate": "Estimate",
  "results.response": "Response",
  "results.percentage": "Percentage",
  "results.count": "Count",
  "error.title": "Unable to complete the request",
  "error.generic": "Something went wrong. Please try again.",
  "error.network": "The service could not be reached. Check the connection and try again.",
  "error.offline": "The local assistant is not connected. Manual analysis is still available.",
  "error.noData": "No data are available for this selection.",
  "error.validation": "Review the selected question, countries, waves, and statistic.",
  "error.staleRevision": "The analysis changed in another action. Review the latest result and try again.",
  "error.tryAgain": "Try again",
  "error.dismiss": "Dismiss",
  "journal.title": "Analysis history",
  "journal.empty": "Completed analyses will appear here",
  "journal.entry": "Analysis {number}",
  "journal.restore": "Restore analysis",
  "journal.workbench": "Created in the workspace",
  "journal.conversation": "Created in conversation",
  "journal.clear": "Clear history",
  "journal.session": "Current session",
  "font.label": "Text size",
  "font.small": "Small",
  "font.standard": "Standard",
  "font.large": "Large",
  "font.decrease": "Decrease text size",
  "font.increase": "Increase text size",
  "common.all": "All",
  "common.none": "None",
  "common.close": "Close",
  "common.back": "Back",
  "common.loading": "Loading",
} as const;

export type CopyKey = keyof typeof EN_COPY;

const ZH_COPY: Record<CopyKey, string> = {
  "brand.name": "亞洲民主動態調查分析",
  "brand.subtitle": "探索調查題目、比較國家與波次，並核對每一項結果",
  "nav.conversation": "對話分析",
  "nav.workspace": "分析工作台",
  "nav.language": "語言",
  "nav.english": "English",
  "nav.traditionalChinese": "繁體中文",
  "library.title": "題目庫",
  "library.searchLabel": "搜尋題目",
  "library.searchPlaceholder": "搜尋題號、題目文字或主題",
  "library.topicLabel": "主題",
  "library.allTopics": "全部主題",
  "library.questions": "題目",
  "library.responseSets": "多選題組",
  "library.noResults": "找不到符合的題目",
  "library.questionCount": "{count} 題",
  "library.availableWaves": "可用波次",
  "library.availableAnalysis": "可用分析",
  "library.completeScale": "查看完整量表與計分",
  "library.singleChoice": "單選",
  "library.multipleChoice": "多選",
  "workspace.title": "分析工作台",
  "workspace.selectQuestion": "選擇題目",
  "workspace.analysisType": "分析方式",
  "workspace.scope": "資料範圍",
  "workspace.countries": "國家或地區",
  "workspace.waves": "調查波次",
  "workspace.allCountries": "選擇全部國家或地區",
  "workspace.allWaves": "選擇全部波次",
  "workspace.statistic": "統計量",
  "workspace.grouping": "結果拆分",
  "workspace.update": "更新結果",
  "workspace.clear": "清除",
  "workspace.coverage": "資料涵蓋範圍",
  "workspace.noSelection": "請先選擇題目",
  "workspace.missingContexts": "{count} 個國家－波次組合沒有資料，將不納入結果",
  "workspace.selectedContexts": "已選擇 {count} 個國家－波次組合",
  "workspace.distribution": "回答分布",
  "workspace.summary": "統計摘要",
  "assistant.title": "分析助理",
  "assistant.connected": "本機已連線",
  "assistant.disconnected": "本機尚未連線",
  "assistant.askAnyLanguage": "可使用任何語言輸入",
  "assistant.inputPlaceholder": "詢問題目、統計量、國家或波次",
  "assistant.send": "送出",
  "assistant.newQuestion": "新問題",
  "assistant.newConversation": "新對話",
  "assistant.thinking": "處理中",
  "assistant.understanding": "正在理解分析需求",
  "assistant.querying": "正在查詢調查資料",
  "assistant.rendering": "正在準備結果",
  "assistant.resultShown": "結果已顯示於分析區",
  "assistant.selectQuestion": "選擇題目",
  "assistant.selectCountry": "選擇國家或地區",
  "assistant.selectWave": "選擇調查波次",
  "assistant.selectStatistic": "選擇統計量",
  "results.title": "分析結果",
  "results.chart": "圖表",
  "results.data": "資料",
  "results.noResult": "完成分析後即可查看結果",
  "results.validN": "有效人數",
  "results.totalRecords": "範圍內記錄",
  "results.included": "納入分析",
  "results.excluded": "未納入",
  "results.denominator": "計算分母",
  "results.loading": "正在載入結果",
  "results.scale": "回答量表",
  "results.scoringDirection": "計分方向",
  "results.missingCoverage": "沒有資料的國家－波次組合",
  "results.estimate": "結果",
  "results.response": "回答",
  "results.percentage": "百分比",
  "results.count": "人數",
  "error.title": "無法完成這項要求",
  "error.generic": "發生錯誤，請再試一次。",
  "error.network": "目前無法連線服務，請檢查連線後再試一次。",
  "error.offline": "本機尚未連線；仍可使用完整的手動分析。",
  "error.noData": "所選範圍沒有可用資料。",
  "error.validation": "請檢查題目、國家、波次與統計量的選擇。",
  "error.staleRevision": "分析設定已由另一項操作更新，請確認最新結果後再試一次。",
  "error.tryAgain": "再試一次",
  "error.dismiss": "關閉",
  "journal.title": "分析紀錄",
  "journal.empty": "完成的分析會顯示在這裡",
  "journal.entry": "第 {number} 則分析",
  "journal.restore": "載回分析",
  "journal.workbench": "由分析工作台建立",
  "journal.conversation": "由對話分析建立",
  "journal.clear": "清除紀錄",
  "journal.session": "目前工作階段",
  "font.label": "字體大小",
  "font.small": "小",
  "font.standard": "標準",
  "font.large": "大",
  "font.decrease": "縮小字體",
  "font.increase": "放大字體",
  "common.all": "全部",
  "common.none": "無",
  "common.close": "關閉",
  "common.back": "返回",
  "common.loading": "載入中",
};

const COPY: Record<Locale, Readonly<Record<CopyKey, string>>> = {
  en: EN_COPY,
  "zh-Hant": ZH_COPY,
};

const TOPICS: Record<string, Readonly<Record<Locale, string>>> = {
  economic_conditions: {
    en: "Economic and household conditions",
    "zh-Hant": "經濟與家庭狀況",
  },
  institutional_trust: {
    en: "Institutional and media trust",
    "zh-Hant": "制度與媒體信任",
  },
  social_capital: {
    en: "Social trust and networks",
    "zh-Hant": "社會信任與社會網絡",
  },
  elections_services: {
    en: "Elections and public services",
    "zh-Hant": "選舉與公共服務",
  },
  political_information: {
    en: "Political information and parties",
    "zh-Hant": "政治資訊與政黨",
  },
  social_values: {
    en: "Social values and authority",
    "zh-Hant": "社會價值與權威",
  },
  political_participation: {
    en: "Political participation",
    "zh-Hant": "政治參與",
  },
  regime_support: {
    en: "Regime preferences and support",
    "zh-Hant": "政體偏好與支持",
  },
  democracy_evaluation: {
    en: "Understanding and evaluating democracy",
    "zh-Hant": "民主認知與評價",
  },
  governance: {
    en: "Governance and accountability",
    "zh-Hant": "治理與問責",
  },
  country_democracy: {
    en: "Evaluations of democracy in other countries",
    "zh-Hant": "他國民主評價",
  },
  democratic_values: {
    en: "Democratic values and political attitudes",
    "zh-Hant": "民主價值與政治態度",
  },
  globalization_identity: {
    en: "Globalization, equity, and national identity",
    "zh-Hant": "全球化、公平與國家認同",
  },
  international_relations: {
    en: "International relations and regional influence",
    "zh-Hant": "國際關係與區域影響",
  },
};

const STATISTIC_ENGLISH: Record<string, string> = {
  回答分布: "response distribution",
  選項分布: "response distribution",
  指定回答比例: "selected response share",
  平均分: "mean score",
  平均值: "mean score",
  平均數: "mean score",
  中位回答: "median response",
  中位數: "median",
  四分位數: "quartiles",
  標準差: "standard deviation",
  有效人數: "valid responses",
  分數中位數: "median score",
};

const OPTION_ENGLISH: Record<string, string> = {
  全部國家或地區: "All countries and regions",
  全部國家: "All countries and regions",
  所有國家: "All countries and regions",
  全部可用波次: "All available waves",
  全部波次: "All available waves",
  所有波次: "All available waves",
  直接選擇: "Select directly",
  ...STATISTIC_ENGLISH,
};

const DESCRIPTION_ENGLISH: Record<string, string> = {
  這題沒有資料: "No data are available for this question",
  所選波次沒有資料: "No data are available for the selected waves",
  所選地區均有資料: "Data are available for every selected country or region",
  所選地區無資料: "No data are available for the selected countries or regions",
  中國在該題量尺上的位置: "China's position on this question's scale",
  中國對亞洲區域作用的利弊評價:
    "Assessment of whether China's regional role is beneficial or harmful",
  中國對本國的影響程度:
    "Extent of China's influence on the respondent's country",
  中國對本國影響的正面或負面評價:
    "Positive or negative assessment of China's influence on the respondent's country",
};

const STATIC_ASSISTANT_ENGLISH: Record<string, string> = {
  "已開始新問題。": "Started a new question.",
  "已開始新問題；先前結果仍保留在這段對話中。":
    "Started a new question. Earlier results remain in this conversation.",
  "我無法確定這是延續目前分析，還是開始新問題。請補充題目，或明確指出要修改的國家、波次或統計量。":
    "I cannot tell whether this continues the current analysis or starts a new question. Add a question, or specify the country, wave, or statistic you want to change.",
  "目前找不到符合這個概念的題目。":
    "No questions matching this concept were found.",
  "目前找不到符合這個概念的題目；請提供題號或更完整的題目文字。":
    "No questions matching this concept were found. Provide a question ID or more of the question wording.",
  "請選擇要計算比例的回答選項。":
    "Select the response option whose share you want to calculate.",
  "請輸入分析問題或要調整的內容。":
    "Enter an analysis question or describe what you want to change.",
  "這個介面操作目前無法套用。":
    "This interface action could not be applied.",
  "目前無法把這項要求轉成可執行的分析修改。":
    "This request could not be converted into an executable analysis change.",
  "已取消目前的澄清；既有分析結果沒有被修改。":
    "Canceled the current clarification. The existing result was not modified.",
  "已取消目前的澄清；现有分析结果没有被修改。":
    "Canceled the current clarification. The existing result was not modified.",
  "已取消上一個澄清；你可以直接提出新的分析需求。":
    "Canceled the previous clarification. You can enter a new analysis request.",
  "目前沒有可撤銷的分析修改。":
    "There is no analysis change to undo.",
  "結果已顯示於分析區": "The result is shown in the analysis area",
};

export function t(
  locale: Locale,
  key: CopyKey,
  params: Record<string, string | number> = {},
): string {
  return COPY[locale][key].replace(/\{([A-Za-z0-9_]+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder,
  );
}

export function topicLabel(locale: Locale, topicId: string, fallback: string): string {
  return TOPICS[topicId]?.[locale] ?? fallback;
}

export function formatNumber(locale: Locale, value: unknown, digits = 2): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const maximumFractionDigits = Math.min(20, Math.max(0, Math.trunc(digits)));
  return new Intl.NumberFormat(locale === "en" ? "en" : "zh-TW", {
    maximumFractionDigits,
  }).format(value);
}

export function cleanMarkdown(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/```(?:[A-Za-z0-9_-]+)?\n?/g, "")
    .replace(/!\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, "$1")
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^()]*\))*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-+*]\s+/gm, "• ")
    .replace(/~~([^~\n]+)~~/g, "$1")
    .replace(/(\*\*|__)([^]*?)\1/g, "$2")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/<[^>]*>/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, "").replace(/^[ \t]+/g, ""))
    .join("\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function removeInternalErrorId(text: string): string {
  return text
    .replace(/\s*錯誤編號[:：]\s*[A-Za-z0-9_-]+[。.]?/gu, "")
    .replace(/\s*Error ID[:：]\s*[A-Za-z0-9_-]+[。.]?/giu, "")
    .trim();
}

function scrubProviderIdentity(locale: Locale, text: string): string {
  const disconnected = /尚未連線|未連線|not connected|offline/iu.test(text);
  const connected = /已連線|connected/iu.test(text) && !disconnected;

  if (disconnected) {
    return locale === "en"
      ? "The local assistant is not connected. The question library and manual analysis remain available."
      : "本機尚未連線；題目庫與手動分析仍可使用。";
  }
  if (
    connected
    && /本機|local|(?:模型|model)[:：]/iu.test(text)
  ) {
    return locale === "en" ? "Local assistant connected" : "本機已連線";
  }

  return text
    .replace(/\s*[·｜|]\s*(?:模型|model)[:：]\s*[^\n；;]+/giu, "")
    .trim();
}

function englishStatistic(text: string): string {
  return STATISTIC_ENGLISH[text.trim()] ?? text.trim();
}

function englishStatisticList(text: string): string {
  return text
    .replace(/[？?]\s*$/u, "")
    .split(/[、，,]/u)
    .map((item) => englishStatistic(item))
    .join(", ");
}

function englishCoverageList(text: string): string {
  return text
    .replace(/(W\d+)、(?=W\d+)/gu, "$1, ")
    .replace(/、/gu, ", ");
}

function localizeCandidateBlock(text: string): string {
  let localized = text;
  for (const [source, translated] of Object.entries(DESCRIPTION_ENGLISH)) {
    localized = localized.replaceAll(source, translated);
  }
  return englishCoverageList(localized);
}

function localizeCompletionTail(text: string): string {
  const trimmed = text.trim();
  const detailed = trimmed.match(/^未納入的資料範圍[:：]\s*(.+?)[。.]?$/su);
  if (detailed) {
    return `Excluded because no data were available: ${englishCoverageList(detailed[1])}.`;
  }
  const count = trimmed.match(
    /^有\s*(\d+)\s*個國家[－-]波次組合未納入；結果區可查看明細[。.]?$/u,
  );
  if (count) {
    return `${count[1]} country-wave combinations were excluded; see the result details.`;
  }
  return trimmed;
}

export function localizeAssistantMessage(locale: Locale, text: string): string {
  const cleaned = removeInternalErrorId(cleanMarkdown(text));
  const providerSafe = scrubProviderIdentity(locale, cleaned);

  if (locale === "zh-Hant") {
    return providerSafe;
  }

  const staticMessage = STATIC_ASSISTANT_ENGLISH[providerSafe];
  if (staticMessage) return staticMessage;

  const ambiguousQuestionPrefix = "這個說法可能對應不同的測量。請選擇題目：";
  if (providerSafe.startsWith(ambiguousQuestionPrefix)) {
    const candidates = providerSafe.slice(ambiguousQuestionPrefix.length).trim();
    return [
      "This request could refer to more than one measure. Select a question:",
      localizeCandidateBlock(candidates),
    ].filter(Boolean).join("\n");
  }

  const discoveredPrefix = "找到以下相關題目：";
  if (providerSafe.startsWith(discoveredPrefix)) {
    const candidates = providerSafe.slice(discoveredPrefix.length).trim();
    return [
      "Related questions found:",
      localizeCandidateBlock(candidates),
    ].filter(Boolean).join("\n");
  }

  const statisticMarker = "。你要看哪個統計量：";
  if (providerSafe.startsWith("已找到 ") && providerSafe.includes(statisticMarker)) {
    const markerIndex = providerSafe.indexOf(statisticMarker);
    const subject = providerSafe.slice("已找到 ".length, markerIndex);
    const statistics = providerSafe.slice(markerIndex + statisticMarker.length);
    const punctuation = /[.?!。？！]$/u.test(subject.trim()) ? "" : ".";
    return `Found ${subject}${punctuation} Which statistic would you like to view: ${englishStatisticList(statistics)}?`;
  }

  const countryMarker = "。請選擇受訪者的國家或地區。";
  if (providerSafe.startsWith("已找到 ") && providerSafe.endsWith(countryMarker)) {
    const subject = providerSafe.slice("已找到 ".length, -countryMarker.length);
    const punctuation = /[.?!。？！]$/u.test(subject.trim()) ? "" : ".";
    return `Found ${subject}${punctuation} Select the respondents' country or region.`;
  }

  const wave = providerSafe.match(
    /^(\S+)\s+在所選地區有多個波次；請選擇一個波次或全部可用波次[。.]?$/u,
  );
  if (wave) {
    return `${wave[1]} is available in multiple waves for the selected countries or regions. Select one wave or all available waves.`;
  }

  const completion = providerSafe.match(/^已完成\s+(\S+)\s+的(.+?)分析[。.]?(?:\s+(.+))?$/su);
  if (completion) {
    const tail = completion[3] ? ` ${localizeCompletionTail(completion[3])}` : "";
    return `Completed the ${englishStatistic(completion[2])} analysis for ${completion[1]}.${tail}`;
  }

  const unsupportedRespondents = providerSafe.match(
    /^目前的 ABS 資料沒有\s+(.+?)\s+的受訪者樣本；目前結果未被修改[。.]?$/u,
  );
  if (unsupportedRespondents) {
    return `The ABS data do not include respondents from ${englishCoverageList(unsupportedRespondents[1])}. The current result was not modified.`;
  }

  const invalidWaves = providerSafe.match(
    /^資料只包含 W1[–-]W6；(.+?)\s+不在可用波次範圍內[。.]?$/u,
  );
  if (invalidWaves) {
    return `The data include W1-W6 only. ${englishCoverageList(invalidWaves[1])} is outside the available range.`;
  }

  const unavailableStatistic = providerSafe.match(
    /^(\S+)\s+無法計算(.+?)；可改看\s+(.+?)[。.]?$/u,
  );
  if (unavailableStatistic) {
    return `${unavailableStatistic[1]} cannot be analyzed using ${englishStatistic(unavailableStatistic[2])}. Available alternatives: ${englishStatisticList(unavailableStatistic[3])}.`;
  }

  const restored = providerSafe.match(/^已恢復到修改前的\s+(\S+)\s+(.+?)結果[。.]?$/u);
  if (restored) {
    return `Restored the earlier ${englishStatistic(restored[2])} result for ${restored[1]}.`;
  }

  if (providerSafe.startsWith("目前分析已經符合這項要求（")) {
    return "The current analysis already matches this request, so the data were not queried again.";
  }
  if (providerSafe.startsWith("這項修改無法直接套用：")) {
    return "This change could not be applied. The current result was not modified.";
  }
  if (providerSafe.startsWith("分析設定或資料查詢暫時無法完成；")) {
    return "The analysis could not be completed. The current result was not modified. Please try again.";
  }

  return providerSafe;
}

export function localizeOptionLabel(locale: Locale, text: string): string {
  const cleaned = scrubProviderIdentity(locale, cleanMarkdown(text));
  if (locale === "zh-Hant") return cleaned;
  return OPTION_ENGLISH[cleaned] ?? cleaned;
}

export function localizeOptionDescription(locale: Locale, text: string | null): string | null {
  if (text === null) return null;
  const cleaned = scrubProviderIdentity(locale, cleanMarkdown(text));
  if (locale === "zh-Hant") return cleaned;

  const exact = DESCRIPTION_ENGLISH[cleaned];
  if (exact) return exact;

  const selectedCoverage = cleaned.match(/^(\d+)\/(\d+)\s*個所選地區有資料$/u);
  if (selectedCoverage) {
    return `Data are available for ${selectedCoverage[1]} of ${selectedCoverage[2]} selected countries or regions`;
  }
  const coverage = cleaned.match(/^(\d+)\s*個地區有資料$/u);
  if (coverage) {
    return `Data are available for ${coverage[1]} countries or regions`;
  }

  return localizeCandidateBlock(cleaned);
}

export function localizeSuggestionLabel(locale: Locale, text: string): string {
  const cleaned = scrubProviderIdentity(locale, cleanMarkdown(text));
  if (locale === "zh-Hant") return cleaned;

  const exact: Record<string, string> = {
    調整比較國家: "Change countries and regions",
    調整調查波次: "Change survey waves",
    分析另一個題目: "Analyze another question",
    更新受訪地區: "Update countries and regions",
    更新調查波次: "Update survey waves",
    更新統計量: "Update statistic",
    更新數值呈現方式: "Update value representation",
    詢問目前結果: "Ask about this result",
    撤銷上次修改: "Undo last change",
    修正目前分析: "Revise this analysis",
    搜尋其他題目: "Search for another question",
    選擇題目: "Select a question",
    回覆分析助理: "Reply to the analysis assistant",
    更新分析設定: "Update analysis settings",
  };
  if (exact[cleaned]) return exact[cleaned];

  const statistic = cleaned.match(/^改看(.+)$/u);
  if (statistic) return `View ${englishStatistic(statistic[1])}`;

  return localizeOptionLabel(locale, cleaned);
}
