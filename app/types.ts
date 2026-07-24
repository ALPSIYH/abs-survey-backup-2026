export type Mode = "category" | "order" | "continuous";
export type Operation = "distribution" | "summary" | "crosstab" | "relationship" | "multi_response";
export type Grouping = "none" | "country" | "wave" | "country_wave" | "survey_variable";

export interface Country {
  country_code: number;
  display_name: string;
}

export interface Question {
  variable_id: string;
  question_text: string;
  selection_mode: "single_choice" | "multiple_choice";
  response_set_id: string | null;
  member_order: number | null;
  topic_id: string;
  topic_label: string;
  modes: Mode[];
  waves: number[];
}

export interface Context {
  country_code: number;
  wave: number;
  unweighted_n: number;
}

export interface ScaleValue {
  raw_value: number | null;
  raw_value_key: string;
  category_label: string;
  category_status: "included" | "excluded";
  order_position: number | null;
  order_status: "included" | "excluded";
  continuous_score: number | null;
  continuous_status: "included" | "excluded";
}

export interface QuestionDetail extends Question {
  scale: ScaleValue[];
  contexts: Partial<Record<Mode, Context[]>>;
}

export interface ResponseSet {
  response_set_id: string;
  label: string;
  member_count: number;
  topic_id: string;
  topic_label: string;
}

export interface ResearchTopic {
  topic_id: string;
  label: string;
  question_count: number;
}

export interface ResponseSetDetail extends ResponseSet {
  members: { variable_id: string; member_order: number; question_text: string }[];
  contexts: Context[];
  member_contexts: Record<string, Context[]>;
}

export interface AssistantStatus {
  provider: "offline" | "local" | "direct_ollama" | "bridge";
  available: boolean;
  label: string;
  detail: string;
}

export interface Bootstrap {
  dataset: {
    dataset_id: string;
    builder_version: string;
    engine_version: string;
    source_rows: number;
    question_count: number;
  };
  countries: Country[];
  waves: number[];
  topics: ResearchTopic[];
  questions: Question[];
  response_sets: ResponseSet[];
  assistant: AssistantStatus;
}

export interface CatalogSearchResponse {
  query: string;
  questions: Question[];
}

export interface Draft {
  schema_version: 2;
  target_kind: "question" | "response_set";
  target_id: string | null;
  mode: Mode | null;
  operation: Operation | null;
  countries: number[];
  waves: number[];
  grouping: Grouping;
  coverage_policy: "strict_complete" | "cellwise_available" | "unbalanced_available";
  weighted: boolean;
  secondary_id: string | null;
  secondary_mode: Mode | null;
  percentage_basis: "row" | "column" | "total";
  response_scope: "any_member" | "specific_member";
  member_order: number | null;
  origin: "manual" | "template" | "assistant";
  revision: number;
}

export interface DimensionValue {
  kind: "country" | "wave" | "survey_variable";
  variable_id: string | null;
  value_key: string;
  label: string;
  order: number | null;
}

export interface ResultMetadata {
  request_hash: string;
  dataset_id: string;
  builder_version: string;
  engine_version: string;
  request_type: Operation;
  weight_mode: "none" | "weighted";
  weight_id: string | null;
  denominator_definition: string;
  total_records_n: number;
  analysis_unweighted_n: number;
  analysis_weight_sum: number | null;
  quantile_method: string | null;
  elapsed_ms: number;
  warnings: string[];
}

export type ResultRow = Record<string, unknown> & {
  dimensions?: DimensionValue[];
  metric?: string;
  estimate?: number;
  label?: string | null;
  base_n?: number;
  estimate_base?: number;
  raw_value?: number | null;
  category_label?: string;
  order_position?: number | null;
  continuous_score?: number | null;
  unweighted_n?: number;
  estimate_n?: number;
  denominator?: number;
  proportion?: number;
  outcome_label?: string;
  group_label?: string;
  row_proportion?: number;
  column_proportion?: number;
  total_proportion?: number;
  x?: number;
  y?: number;
  option_label?: string;
};

export interface AssistantPlanPatch {
  mode?: Mode | null;
  operation?: Operation | null;
  grouping?: Grouping | null;
  country_codes?: number[] | null;
  waves?: number[] | null;
}

export interface AssistantProposal {
  base_revision: number;
  question: Question;
  patch: AssistantPlanPatch;
}

export interface AssistantClarification {
  clarification_required: true;
  detail: string;
  candidates?: Question[];
}

export type AssistantPlanResponse = AssistantProposal | AssistantClarification;

export interface AnalysisResult {
  result_type: Operation;
  metadata: ResultMetadata;
  rows: ResultRow[];
  summaries?: ResultRow[];
  percentage_basis?: "row" | "column" | "total";
}

export interface AnalysisEnvelope {
  draft: Draft;
  canonical_request: Record<string, unknown>;
  result: AnalysisResult;
  coverage?: StatisticalView["coverage"];
  statistic?: StatisticalView["statistic"];
}

export interface ConversationTurn {
  turn_id: string;
  role: "assistant" | "user";
  message: string;
  artifact_id: string | null;
  flow_id: string;
  kind: "message" | "flow_boundary" | "system_event";
}

export interface ConversationOption {
  option_id: string;
  label: string;
  value: string;
  description: string | null;
}

export interface ConversationAppliedDelta {
  question_before: string | null;
  question_after: string | null;
  countries_added: string[];
  countries_removed: string[];
  waves_added: number[];
  waves_removed: number[];
  statistic_before: string | null;
  statistic_after: string | null;
  category_keys_before: string[];
  category_keys_after: string[];
  effective_change: boolean;
  no_op_reasons: string[];
}

export type ConversationCommand =
  | { kind: "select_pending_option"; pending_id: string; option_id: string }
  | { kind: "modify_countries"; operation: "set" | "add" | "remove"; values?: string[]; selector?: "explicit" | "all_available" }
  | { kind: "modify_waves"; operation: "set" | "add" | "remove"; values?: number[]; selector: "explicit" | "all_available" | "latest" | "latest_three" | "latest_two" | "previous" }
  | { kind: "set_statistic"; statistic: StatisticalView["statistic"] }
  | { kind: "repair"; operation: "undo_last_change" | "restore_snapshot" | "cancel_pending" | "restart_question"; target_id?: string | null };

export interface ConversationSuggestion {
  action_id: string;
  label: string;
  command: ConversationCommand;
  control: "command" | "country_multiselect" | "wave_multiselect";
  choices: {
    value: string;
    label: string;
    selected: boolean;
    available?: boolean;
    description: string | null;
  }[];
  based_on_revision: number;
}

export interface EvidenceRow {
  dimensions: DimensionValue[];
  metric: string;
  estimate: number;
  label: string | null;
  order_position: number | null;
  raw_value_key: string | null;
  base_n: number;
  numerator_n: number | null;
  denominator_n: number | null;
}

export interface StatisticalView {
  question_id: string;
  question_text: string;
  statistic: "distribution" | "category_share" | "mean" | "median" | "quartiles" | "sd" | "base_n";
  representation: Mode;
  presentation_type: "metric" | "trend" | "comparison" | "country_wave" | "distribution" | "distribution_over_time" | "quartiles";
  rows: EvidenceRow[];
  metadata: ResultMetadata;
  coverage: {
    requested_contexts: { country_code: number; wave: number }[];
    available_contexts: { country_code: number; wave: number }[];
    excluded_contexts: { country_code: number; wave: number; reason: string }[];
    effective_policy: "strict_complete" | "cellwise_available";
  };
  score_direction: string | null;
}

export interface ConversationSnapshot {
  snapshot_id: string;
  draft: Draft;
  intent: Record<string, unknown>;
  canonical_request: Record<string, unknown>;
  result: AnalysisResult;
  view: StatisticalView;
}

export interface ConversationResponse {
  conversation_id: string;
  revision: number;
  status: "answered" | "needs_clarification" | "unsupported" | "tool_error";
  action: "analyzed" | "revised" | "clarified" | "acknowledged" | "discussed" | "no_op" | "unsupported" | "tool_error";
  message: string;
  turns: ConversationTurn[];
  pending: { pending_id: string; kind: string; question: string | null; missing_slots: string[] } | null;
  options: ConversationOption[];
  suggestions: ConversationSuggestion[];
  active_snapshot: ConversationSnapshot | null;
  applied_delta: ConversationAppliedDelta | null;
  no_op_reasons: string[];
}

export const EMPTY_DRAFT: Draft = {
  schema_version: 2,
  target_kind: "question",
  target_id: null,
  mode: null,
  operation: null,
  countries: [],
  waves: [],
  grouping: "none",
  coverage_policy: "cellwise_available",
  weighted: false,
  secondary_id: null,
  secondary_mode: null,
  percentage_basis: "row",
  response_scope: "any_member",
  member_order: null,
  origin: "manual",
  revision: 0,
};
