/**
 * question-core — the question contract + pure grading logic. No framework
 * imports, no UI: everything here is deterministic and unit-testable.
 *
 * The TypeBox schemas below are the tool INPUT contracts (agent/tools
 * declares the tools against them); the browser validates, shuffles, and
 * grades with these functions, then sends the verdict back as the tool
 * output via addToolOutput:
 *   1. The teacher model calls the `quiz` tool (question + options +
 *      correctAnswer + explanation). No server execute → the call lands in
 *      the UI as a typed tool part in `input-available` state.
 *   2. The learner answers in the card; the client grades with this module.
 *   3. addToolOutput sends the verdict (selection + correctness + note —
 *      never the explanation, the model authored that) back to the model.
 *
 * Because the pending question IS a persisted message part, a session can be
 * exited and resumed mid-question for free.
 */
import { Type, type Static } from "typebox";
import type { PluginSubmissionImages } from "./plugin-submissions.ts";
export interface QuizOption {
    label: string;
    value: string;
    description?: string;
}
/** GLM wobble guard (owner-approved, 2026-09-26): models sometimes emit
 *  `options` as a JSON-ENCODED STRING instead of an array. Parse it before
 *  use. Shared by the tools' prepareArguments (server, pre-validation) and
 *  normalizeOptions (client — the persisted call keeps the raw string, so
 *  the dock must coerce again). Returns the input untouched when it isn't
 *  a parseable array — validation then reports honestly. */
export declare function parseOptionsIfString<T>(options: string | T[] | undefined): unknown;
/** ask options: the shared sanity, nothing more (ask is not graded). */
export declare function askOptionProblems(options: Array<{
    label: string;
    value?: string;
}>): string[];
/** The full quiz authoring contract: option sanity + correctAnswer must be
 *  gradeable. Empty result = a quiz the dock can arm and grade faithfully. */
export declare function quizInputProblems(input: {
    options: Array<{
        label: string;
        value?: string;
    }>;
    correctAnswer: string | string[];
    multiSelect?: boolean;
}): string[];
export declare const quizInputBase: Type.TObject<{
    question: Type.TString;
    options: Type.TArray<Type.TObject<{
        label: Type.TString;
        value: Type.TOptional<Type.TString>;
    }>>;
    multiSelect: Type.TOptional<Type.TBoolean>;
    explanation: Type.TString;
    correctAnswer: Type.TUnion<[Type.TString, Type.TArray<Type.TString>]>;
    details: Type.TOptional<Type.TString>;
}>;
export declare const QUIZ_QUESTION_TYPES: readonly ["predict", "check"];
export type QuizQuestionType = (typeof QUIZ_QUESTION_TYPES)[number];
/** Normalize a persisted quiz `type` (display seam): old records carry
 *  none, and unhealable wobble degrades to undefined — callers render
 *  "Quiz" and the check-style card. The debris strip (whitehead,
 *  2026-10-09) heals the recorded `"\"predict\""` wobble — a raw
 *  persisted record displays its intended role. */
export declare function normalizeQuizType(raw: unknown): QuizQuestionType | undefined;
/** The reveal law as a pure predicate (owner 2026-10-03; explain joined
 *  2026-10-09): a teach-phase CHECK collapses behind the "Check your
 *  understanding" reveal — a prediction NEVER does (it precedes the
 *  teaching and gates it; collapsing it would invert the cycle), and
 *  neither do probe/plan questions or ask. Both teach quizzing tools
 *  (quiz and explain) obey the same law. chat.tsx calls this for its
 *  pending question; the reading-thinking field mounts on the same
 *  truth. Records that predate the `type` field carry none — they render
 *  as checks, the standing default. */
export declare function questionNeedsReveal(tool: string, rawInput: unknown, phase: string): boolean;
/** The TEACH-side quiz object. The required pair leads the property
 *  order (owner, 2026-10-09): glm-5.3 dropped `type`/`nodeId` on long
 *  calls BECAUSE they trailed every content field — fields generated
 *  first get dropped least. The order is also the authoring order:
 *  commit to the node and the question's role, then write the question. */
export declare const quizInputObject: Type.TObject<{
    question: Type.TString;
    options: Type.TArray<Type.TObject<{
        label: Type.TString;
        value: Type.TOptional<Type.TString>;
    }>>;
    multiSelect: Type.TOptional<Type.TBoolean>;
    explanation: Type.TString;
    correctAnswer: Type.TUnion<[Type.TString, Type.TArray<Type.TString>]>;
    details: Type.TOptional<Type.TString>;
    type: Type.TUnion<[Type.TLiteral<"predict">, Type.TLiteral<"check">]>;
    nodeId: Type.TString;
}>;
/** The PROBE-side quiz declaration: the shared authoring contract, no
 *  nodeId and no `type` field at all — the session's map doesn't exist
 *  yet, and probing has exactly ONE question role (owner 2026-10-03: the
 *  prober keeps its own tool; the teaching cycle's types stay with the
 *  teacher, so nothing invites misuse). Structurally identical to
 *  quizInputBase (the old superRefine never reached the wire — it ran at
 *  the call boundary, where quizInputProblems runs now). */
export declare const probeQuizInputSchema: Type.TObject<{
    question: Type.TString;
    options: Type.TArray<Type.TObject<{
        label: Type.TString;
        value: Type.TOptional<Type.TString>;
    }>>;
    multiSelect: Type.TOptional<Type.TBoolean>;
    explanation: Type.TString;
    correctAnswer: Type.TUnion<[Type.TString, Type.TArray<Type.TString>]>;
    details: Type.TOptional<Type.TString>;
}>;
/** The DISPLAY parse for persisted quiz calls (tool-parts.ts): the base
 *  + `type` as an OPTIONAL plain string (old records carry none, and
 *  Value.Clean keeps a key only when the schema knows it — the dock would
 *  otherwise lose the role it renders and gates by). Normalization is
 *  normalizeQuizType at the read seam; nodeId stays stripped (unknown
 *  key). The PROBE quiz parses against the bare base — probe calls carry
 *  no type. */
export declare const quizDisplayInputSchema: Type.TObject<{
    type: Type.TOptional<Type.TString>;
    question: Type.TString;
    options: Type.TArray<Type.TObject<{
        label: Type.TString;
        value: Type.TOptional<Type.TString>;
    }>>;
    multiSelect: Type.TOptional<Type.TBoolean>;
    explanation: Type.TString;
    correctAnswer: Type.TUnion<[Type.TString, Type.TArray<Type.TString>]>;
    details: Type.TOptional<Type.TString>;
}>;
export declare const explainInputBase: Type.TObject<{
    question: Type.TString;
    correctAnswer: Type.TString;
    details: Type.TOptional<Type.TString>;
}>;
/** The TEACH-side explain object: base + the plan-position field (same
 *  semantics as the quiz's nodeId — the seam recognizes BOTH tools). */
/** The TEACH-side explain object: base + the teaching-cycle role field
 *  and the plan-position field (same semantics as the quiz's — the seam
 *  recognizes BOTH tools). The required pair leads the property order,
 *  exactly as the teach quiz's (owner, 2026-10-09). */
export declare const explainInputObject: Type.TObject<{
    question: Type.TString;
    correctAnswer: Type.TString;
    details: Type.TOptional<Type.TString>;
    type: Type.TUnion<[Type.TLiteral<"predict">, Type.TLiteral<"check">]>;
    nodeId: Type.TString;
}>;
/** The DISPLAY parse for persisted explain calls (tool-parts.ts): the
 *  base + `type` as an OPTIONAL plain string — exactly the quiz display
 *  pattern. Old records carry none; questionNeedsReveal treats them as
 *  checks (the standing default). nodeId stays stripped (unknown key).
 *  The PROBE recall parses against the bare base. */
export declare const explainDisplayInputSchema: Type.TObject<{
    type: Type.TOptional<Type.TString>;
    question: Type.TString;
    correctAnswer: Type.TString;
    details: Type.TOptional<Type.TString>;
}>;
/** The explain authoring contract: the commitment must exist. Empty
 *  result = an explain the dock can arm and the model can grade against. */
export declare function explainInputProblems(input: {
    correctAnswer: string;
}): string[];
/** The tool names that carry the quizzing mechanic — the teach seam
 *  (phases), the plan-position fold, and the pending gate all recognize
 *  whichever is armed. */
export declare const QUIZ_TOOL_NAMES: readonly ["quiz", "explain"];
/** The TEACHER's quiz declaration (base + the position field). */
export declare const quizInputSchema: Type.TObject<{
    question: Type.TString;
    options: Type.TArray<Type.TObject<{
        label: Type.TString;
        value: Type.TOptional<Type.TString>;
    }>>;
    multiSelect: Type.TOptional<Type.TBoolean>;
    explanation: Type.TString;
    correctAnswer: Type.TUnion<[Type.TString, Type.TArray<Type.TString>]>;
    details: Type.TOptional<Type.TString>;
    type: Type.TUnion<[Type.TLiteral<"predict">, Type.TLiteral<"check">]>;
    nodeId: Type.TString;
}>;
export declare const askInputSchema: Type.TObject<{
    question: Type.TString;
    details: Type.TOptional<Type.TString>;
    options: Type.TOptional<Type.TArray<Type.TObject<{
        description: Type.TOptional<Type.TString>;
        label: Type.TString;
        value: Type.TOptional<Type.TString>;
    }>>>;
    multiSelect: Type.TOptional<Type.TBoolean>;
}>;
export type QuizToolInput = Static<typeof quizInputObject>;
export type AskToolInput = Static<typeof askInputSchema>;
export type ExplainToolInput = Static<typeof explainInputObject>;
export type ProbeExplainToolInput = Static<typeof explainInputBase>;
/** A real selected answer, in the order the options were displayed. */
export interface OptionAnswer {
    label: string;
    value: string;
    index: number;
}
export type QuestionKind = "quiz" | "ask" | "explain";
export type SelectMode = "single-select" | "multi-select";
export type QuestionMode = SelectMode | "text";
/** Full question data — stored in the `lh_question` custom entry. */
export interface QuestionData {
    id: string;
    kind: QuestionKind;
    /** quiz only (teach phase, owner 2026-10-03): the question's role in
     *  the cycle — predict (before the teaching, never collapsed) or check
     *  (after it, behind the reveal). Absent on probe quizzes and old
     *  records — everything check-shaped. */
    questionType?: QuizQuestionType;
    question: string;
    context?: string;
    mode: QuestionMode;
    options: QuizOption[];
    correctIndices?: number[];
    committedAnswer?: string;
    explanation?: string;
    createdAt: string;
}
/** The learner's answer — full structured record, stored in `lh_question_answered`.
 *  NO questionId (owner, tool-result diet 2026-10-02): it was the
 *  toolCallId restated — the toolResult message already carries it. */
export interface QuestionAnswerData {
    kind: QuestionKind;
    /** The persisted call's tool NAME (owner, 2026-10-09): probe-phase
     *  calls are `probe`/`recall`, teach calls `quiz`/`explain` — the
     *  cards label by it ("Probe"/"Recall"), so the phase boundary is
     *  visible in the transcript. Absent on pre-rename records: they
     *  keep the kind-based labels. */
    tool?: string;
    /** quiz only (teach phase): the role snapshot for rendering (a
     *  prediction tucks its explanation) and later calibration splits.
     *  Absent on old records and probe answers. */
    questionType?: QuizQuestionType;
    questionText: string;
    options?: {
        index: number;
        label: string;
    }[];
    dontKnow: boolean;
    answers: OptionAnswer[];
    other?: string;
    text?: string;
    /** The learner's reasoning on the QUESTION (renamed from `note`, owner
     *  2026-10-03 — "that's what it is"). */
    thinking?: string;
    /** @deprecated the pre-rename key — never written again; old records
     *  replay through the same types, so it stays declared. Read via
     *  `thinking ?? note`. */
    note?: string;
    /** The learner's thinking WHILE READING the teaching prose (owner
     *  2026-10-03) — a separate channel from `thinking`, captured by the
     *  reading field and riding the check answer. Absent when empty. */
    readingThinking?: string;
    /** Host-owned explicit image channels; never inferred from text or paths. */
    images?: PluginSubmissionImages;
    confidence?: number;
    correct?: boolean;
    correctIndices?: number[];
    committed?: string;
    explanation?: string;
    dismissed?: boolean;
    answeredAt: string;
}
/** Client-facing question payload — deliberately omits the answer. */
export interface ClientQuestion {
    id: string;
    kind: QuestionKind;
    question: string;
    context?: string;
    mode: QuestionMode;
    options: QuizOption[];
}
/** What the server passes to the bridge when the learner answers. */
export interface AnswerRequest {
    dontKnow?: boolean;
    values?: string[];
    other?: string;
    text?: string;
    thinking?: string;
    readingThinking?: string;
    confidence?: number;
}
/** The confidence slider's snap stops (owner, 2026-10-01): raw probability
 *  that the selected answer is correct, uneven on purpose — resolution
 *  concentrates at the top where the calibration signal lives (90 vs 100
 *  separates knows from mastered). 50 is a genuine coin flip and the
 *  resting default — untouched and deliberate 50 are the same number. */
export declare const CONFIDENCE_STOPS: readonly number[];
export declare const DEFAULT_CONFIDENCE_INDEX = 2;
/** The question dock's selection state (0-based indices in display order). */
export interface DockSelection {
    selected: Set<number>;
    otherSelected: boolean;
    dontKnow: boolean;
}
export declare const emptyDockSelection: () => DockSelection;
/** In-memory submission snapshot: survives the question form's optimistic
 * unmount, never written to storage. Indices use the call's stable shuffle. */
export interface QuestionFormDraft {
    selection: DockSelection;
    thinking: string;
    other: string;
    text: string;
    confidenceIndex: number;
}
export interface QuestionDraft {
    form?: QuestionFormDraft;
    readingThinking?: string;
}
/**
 * Toggling a listed option. Single-select: the option becomes THE answer and
 * displaces "Other". Multi-select: the option toggles alongside its siblings
 * AND "Other" — selections are independent (picking options must never clear
 * a custom answer, and picking the custom row must never clear them).
 */
export declare function toggleOption(mode: SelectMode, sel: DockSelection, idx: number): DockSelection;
/**
 * Toggling the ask "Other…" row. Single-select: picking it makes it THE
 * answer, displacing the listed options (the typed text always survives).
 * Multi-select: it toggles alongside the listed selections and clears
 * nothing.
 */
export declare function toggleOther(mode: SelectMode, sel: DockSelection): DockSelection;
export declare function normalizeOptions(options: string | Array<{
    label: string;
    value?: string;
    description?: string;
}> | undefined): QuizOption[];
/** Fisher-Yates over a copy. correctAnswer is keyed by value, so display
 *  order can be shuffled safely before resolving indices. */
/** mulberry32 seeded by a string — deterministic shuffle for hydration-safe rendering. */
export declare function seededRandom(seed: string): () => number;
/**
 * Fisher–Yates with an injectable RNG. Pass `seededRandom(toolCallId)` in
 * rendered components: Math.random() shuffles differently on server vs client
 * and breaks hydration (React #418). A per-toolCallId seed keeps the order
 * stable across reloads while still varying it per question.
 */
export declare function shuffleOptions(options: QuizOption[], rand?: () => number): QuizOption[];
/** Preserve an exact option key before trying copy-syntax cleanup: a
 *  label's final period, quotes, or backticks can be CONTENT (calculus
 *  incident, 2026-10-12), not model debris. The actual option values are
 *  required so no caller can strip a valid answer before membership.
 *  Non-matches keep the existing whitehead heal (`[":parmenides"]`) and
 *  JSON-stringified multi-select coercion. Shared by boundary, display,
 *  and grading; canonical option keys are never rewritten. */
export declare function coerceCorrectAnswer(correctAnswer: string | string[], optionValues: readonly string[]): string[];
/** Resolve author-supplied value(s) to 1-based display indices. Keying by
 *  value (not position) makes a typo a hard error instead of a silent wrong
 *  grade. Must run AFTER shuffling. */
export declare function resolveCorrect(correctAnswer: string | string[] | undefined, options: QuizOption[]): {
    indices: number[];
    error?: string;
};
/** Exact-set match: same number of selections, same indices. */
export declare function isCorrect(selectedIndices: number[], correctIndices: number[]): boolean;
export declare function toClientQuestion(qd: QuestionData): ClientQuestion;
/**
 * Turn an AnswerRequest into the full answer record + the user message the
 * agent will see. Quiz answers are graded here; ask answers are not.
 */
export declare function buildAnswer(qd: QuestionData, req: AnswerRequest, tool?: string): QuestionAnswerData;
/**
 * The MODEL-VISIBLE answer record (owner, tool-result diet 2026-10-02):
 * the tool call already carries everything the model itself authored —
 * the question, every option, the correct answer, the explanation, the
 * explain commitment — so the result returns ONLY what the learner added:
 * his selection or words, the graded verdict, his stated confidence, his
 * note. The full graded QuestionAnswerData rides `details` for the record
 * and the UI; this is the JSON the agent actually reads.
 */
/** The dismissal record (ESC-abort from a pending question, owner
 *  2026-10-02): the minimum honest answer. The model sees
 *  {kind, dismissed:true} via compactAnswerForModel; the answered card
 *  renders the question text + "skipped". Rides the same answer path —
 *  the teacher acknowledges the skip in its next turn, exactly like any
 *  answer. */
export declare function dismissedAnswer(kind: QuestionKind, questionText: string): QuestionAnswerData;
export declare function compactAnswerForModel(ad: QuestionAnswerData): Record<string, unknown>;
