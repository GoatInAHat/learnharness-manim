/**
 * THE NATIVE MESSAGE RECORD (Wave B, owner-approved 2026-09-26): chat
 * records store pi's own message shapes — the exact history the agent
 * loop builds — instead of AI-SDK UIMessages. Provider, model, usage,
 * stopReason, and thinking signatures are stamped by pi itself; replay is
 * `state.messages = record.messages` + `continue()` — the record IS the
 * agent state.
 *
 * WHY pi MESSAGES LACK OUR `id`: pi's session format gives every ENTRY an
 * id, never the message. This app needs a per-message id for client
 * identity (React keys, append-only adoption, the continuation seam), so
 * every record message carries ONE extra field — `id` — alongside the
 * native shape. `toLlmMessages` strips it at the wire: the provider never
 * sees it (verified single site, below).
 *
 * UI-ONLY CONTENT (owner ruling, fork 1 + the plan's custom-message
 * taxonomy): the probe→teach handoff, sub-agent steers,
 * and plan blocks are LhMarkerMessage — this app's declaration-merged
 * member of pi-agent-core's CustomAgentMessages extension point, shaped
 * exactly like pi's own CustomMessage ({role:"custom", customType,
 * content, display, details}). ONE seam — toLlmMessages, wired as the
 * agent's convertToLlm — owns every model-facing decision: markers
 * flatten to their canonical user text (single-sourced in
 * core/contracts), plan blocks are UI-only and filtered, and dangling
 * tool calls (an aborted turn) get the interrupted-result synthesis the
 * provider protocol demands.
 *
 * Answers (fork 1, owner 2026-09-26): the learner's answer IS the tool
 * call's ToolResultMessage — appended natively at answer time. The
 * synthetic "question posed" placeholder is an in-memory loop device
 * (Wave A's terminate) and is never persisted: the record ends at the
 * unanswered call in the pose→answer window, where no turn can run (the
 * question gate holds steers; a POST would 409).
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ImageContent, Message, TextContent, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import type { PluginSubmissionImages, PluginSubmissionOccurrence } from "./plugin-submissions.ts";
import { type PendingQuestion } from "./pending.ts";
import { type PluginProblemSnapshot } from "./plugin-problems.ts";
import { type PluginQuestionAnnotationRead, type PluginQuestionOccurrence, type PluginQuestionOccurrenceMap, type PluginQuestionSnapshot } from "./plugin-questions.ts";
/** The hard-invariant wording for an aborted turn's unanswered calls —
 *  carried over verbatim from the pre-native era so the model's view
 *  never drifted. */
export declare const INTERRUPTED_TEXT = "The question was interrupted \u2014 the learner never answered; continue without holding a result for it.";
/**
 * The app's custom message (declaration-merged into pi-agent-core's
 * CustomAgentMessages below). Shaped like pi's own CustomMessage —
 * `content` is the MODEL-facing text (single-sourced in core/contracts,
 * never fake human speech), `details` is the UI payload (never
 * model-visible), `display` marks messages the UI renders (our projection
 * keys rendering on customType; the flag documents intent).
 */
export interface LhMarkerMessage {
    /** Record identity (pi messages carry no id — see the file header). */
    id: string;
    role: "custom";
    customType: "graph-context" | "probe-handoff" | "subagent-steer" | "subagent-abort" | "plan-block" | "practice-thinking" | "plugin-problem-submission" | "practice-next" | "problem-dismissed" | "compaction" | "side-question" | "side-question-told";
    /** The model-facing text ("" for plan blocks — UI-only). */
    content: string;
    display: boolean;
    /** Per-customType UI payload. Practice-thinking images also project to
     * native model blocks; its content string remains the text authority. */
    details: unknown;
    timestamp: number;
}
declare module "@earendil-works/pi-agent-core" {
    interface CustomAgentMessages {
        lhMarker: LhMarkerMessage;
    }
}
/** A record message: a native pi message (or our marker) plus the record id. */
export type LhMessage = (UserMessage | AssistantMessage | ToolResultMessage | LhMarkerMessage) & {
    id: string;
    /** CLI-reported effective context budget, not a catalog model maximum.
     * App-only metadata: never transmitted as provider/model message content. */
    cliContextWindow?: number;
    /** Host-owned occurrence annotations, never model input. */
    lhQuestions?: PluginQuestionOccurrenceMap;
    /** Exact binding for genuine plugin-question results (details stays public envelope). */
    lhQuestionOccurrence?: PluginQuestionOccurrence;
};
/** Latest response only: never borrow an older process/model's window when
 * a fresh response has no metadata. Compaction invalidates the old report. */
export declare function cliContextWindowOf(messages: readonly LhMessage[]): {
    model: string;
    tokens: number;
} | null;
/** A record message list is assignable to the agent's context — that IS
 *  the replay (ui-stream/chat-handler assign it to initialState.messages). */
export declare function asAgentMessages(messages: readonly LhMessage[]): AgentMessage[];
/** Side-question markers (#16) never change what the record's tail
 *  means: a closed side thread leaves a dismissal pause, a Retry, a
 *  recovery, or an owed continuation exactly as it found them. */
export declare function isSideQuestionMarker(m: LhMessage | AgentMessage | undefined): boolean;
export declare const SEND_TO_USER_TOOL = "send_to_user";
/** Read the output tool's message without changing the native call. Also
 * accepts partial arguments while streaming; malformed/empty inputs carry
 * no prose. This projection is independent of the currently selected model. */
export declare function sendToUserText(block: unknown): string | undefined;
/** Learner-facing prose, in content order. Only the explicit output tool
 * joins ordinary text here — thinking and all other tool inputs stay out.
 * Shared by coverage/extraction and Markdown; native history stays intact. */
export declare function userFacingTextOf(content: unknown, failedOutputCalls?: ReadonlySet<string>): string[];
/** Failed output calls remain retry context, not delivered teaching.
 * Truncated calls can have valid-looking partial arguments. Failed/aborted
 * generations do not execute their calls at all, so may have no result. */
export declare function failedOutputCallIds(messages: readonly LhMessage[]): ReadonlySet<string>;
/** The app-wide message id shape (same as the UIMessage-era mint). */
export declare function newMessageId(): string;
/** A learner-authored user message (text input, verdict note). */
/** Keep legacy text-only storage unchanged; explicit images become native blocks. */
export declare function nativeInlineImageContent(text: string, images?: readonly ImageContent[]): string | (TextContent | ImageContent)[];
/** Compact answer text is the sole text authority; labels identify image channels. */
export declare function nativeAnswerContent(answerText: string, images?: PluginSubmissionImages): ToolResultMessage["content"];
export declare function newUserMessage(text: string, images?: readonly ImageContent[]): LhMessage & UserMessage;
/** A steered user message (mid-turn composer steering, owner 2026-10-03):
 *  a plain user message with the CLIENT-minted steer id — the same object
 *  rides agent.steer(), the live stream's message events, and the settled
 *  record, so the optimistic queued indicator and the transcript card
 *  upsert by one identity. */
export declare function newUserSteer(text: string, id: string, images?: readonly ImageContent[]): LhMessage & UserMessage;
/** The learner's answer — the question call's tool result (fork 1).
 *  TWO AUDIENCES (owner, tool-result diet 2026-10-02): the MODEL sees the
 *  compact learner-only record (compactAnswerForModel — the call's own
 *  arguments already carry the question/options/explanation/commitment;
 *  restating them doubled every answer's tokens), while `details` keeps
 *  the FULL graded QuestionAnswerData for the record and the UI. */
export declare function newAnswerResult(toolCallId: string, toolName: string, answer: unknown): LhMessage & ToolResultMessage;
/** The probe→teach handoff wake: scaffolding, not speech — the model reads
 *  HANDOFF_TEXT, the UI renders the quiet system line. */
export declare function newHandoffMessage(chatId: string): LhMarkerMessage;
/** The plan presentation block: pure UI history (a frozen snapshot), no
 *  model face — toLlmMessages filters it. `planCallId` keys idempotent
 *  emission (one block per successful plan_init call). */
export declare function newPlanBlockMessage(planCallId: string, block: unknown): LhMarkerMessage;
/** The practice agent's two tools (the conclude-before-next-problem gate's
 *  vocabulary — the tool-execute layer owns the tools themselves). */
export declare const PRACTICE_PROBLEM_TOOL = "problem";
export declare const PRACTICE_CONCLUDE_TOOL = "conclude";
/** One picked proposition of the graph-context marker (the learner's map
 *  pick — name + statement as the learner SAW them at pick time). */
export interface GraphContextPick {
    id: string;
    name: string;
    statement: string;
}
/** The session's map context (owner, 2026-10-04): a SEPARATE custom
 *  message BEFORE the learner's first user message — the picked
 *  propositions plus the reasoning chains among them (pre-formatted
 *  lines, formatChainLine shape). The model reads `content` (flattened
 *  to a user message by toLlmMessages like every marker); `details`
 *  feeds the transcript's collapsible GraphContextCard. No more seed
 *  text glued into the first prompt. */
export declare function newGraphContextMessage(picks: readonly GraphContextPick[], chains: readonly string[]): LhMarkerMessage;
/** The learner's thinking submission (ONE send lane, owner round
 *  2026-10-05): the register is no longer declared by a button — the
 *  model READS the text to tell working traces from claimed answers. The
 *  content label is the single "Your thinking"; `details` keeps the raw
 *  payload for the transcript card. One problem may carry many
 *  submissions. */
export declare function newThinkingMessage(problemCallId: string, text: string, images?: readonly ImageContent[]): LhMarkerMessage;
/** The learner's explicit move-on signal (owner round 16): appended by
 *  the next input (the composer band's chip, or Enter on an empty
 *  composer during the between-problems pause). The content is the
 *  single-sourced NEXT_PROBLEM_TEXT — the model's unambiguous go-ahead;
 *  the transcript renders its own compact line off the marker (never
 *  the content). */
export declare function newNextMessage(): LhMarkerMessage;
/** The problem-dismissal marker (ask-style discard, owner 2026-10-04):
 *  UI-ONLY — toLlmMessages filters it. The model's face arrives later, at
 *  the user's next input, as the synthesized conclude pair
 *  (concludedByDismissalPair below) — the agent sees the dismissal as a
 *  conclude call it "made" with outcome "dismissed", so the slot-freed
 *  state and the dismissal read through the one vocabulary it owns. */
export declare function newProblemDismissedMarker(problemCallId: string): LhMarkerMessage;
/** The dismissal's deferred conclude (owner ruling 2026-10-04): the pair
 *  prepended to the user's NEXT input — a synthetic assistant message
 *  carrying a conclude call (outcome "dismissed") plus its ack result, so
 *  both the record and the model context read the problem as concluded
 *  by dismissal, slot freed. Pure; ids are deterministic off the problem
 *  call id (idempotent shape — the pending-dismissal gate guarantees the
 *  pair appends at most once per marker). */
export declare function concludedByDismissalPair(problemCallId: string): [LhMessage & AssistantMessage, LhMessage & ToolResultMessage];
/** Common practice pose recognition, independent of the currently enabled plugins. */
export declare function practiceProblemForCall(messages: readonly LhMessage[], occurrence: PluginSubmissionOccurrence): {
    input: unknown;
    pluginProblem?: PluginProblemSnapshot;
} | null;
/** The conclusion reveals the solution committed by the newest clean pose
 * BEFORE this physical conclude call, never a later pose in the same batch.
 * Legacy conclude-only solutionReveal fallback remains owned by the card. */
export declare function modelSolutionForConclude(messages: readonly LhMessage[], concludeCallId: string): string | undefined;
/** The full pose-side fold (owner round 17, 2026-10-06 — observability):
 * EVERYTHING the agent filled into the problem call — mode, target ids,
 * statement, the committed solution — joined onto the conclude part so
 * the card's collapsible "agent's data" drawer renders pure. Same walk
 * and refusal law as the reveal: a pose the record never acked (a
 * refused call) folds nothing. */
export declare function problemInputForConclude(messages: readonly LhMessage[], concludeCallId: string): {
    statement?: unknown;
    mode?: unknown;
    target?: unknown;
    modelSolution?: unknown;
} | undefined;
export declare function activeProblemOf(messages: readonly LhMessage[]): {
    toolCallId: string;
    input: unknown;
    pluginProblem?: PluginProblemSnapshot;
} | null;
/** Exact source of the same clean activation selected by activeProblemOf. */
export declare function activeProblemOccurrenceOf(messages: readonly LhMessage[]): PluginSubmissionOccurrence | null;
/** Is a problem-dismissal marker waiting for its conclude synthesis? The
 *  text/continue appends read this: the pair rides the user's next input
 *  (input-events). Newest-marker-wins scan: the first dismissal marker or
 *  conclude call from the end decides. */
export declare function pendingProblemDismissalOf(messages: readonly LhMessage[]): string | null;
/**
 * AgentMessage[] → the provider wire (the agent's convertToLlm — required
 * by pi-agent-core's loop config, the ONE place model-facing decisions
 * live):
 *
 * - user / assistant / toolResult pass through VERBATIM — signatures,
 *   usage, provider stamps all native — minus our record-`id` field.
 * - markers flatten to a user message carrying their content (the
 *   canonical text single-sourced in core/contracts); plan blocks are
 *   UI-only and filtered.
 * - dangling calls from successfully generated assistant messages (for
 *   example, an unanswered question) get a synthesized interrupted result.
 *   Error/aborted generations do not: Pi drops those assistant messages,
 *   so manufacturing their results would leave orphan results on the wire.
 *
 * Contract (pi-agent-core): never throws — an unknown shape passes
 * through untouched rather than killing the loop.
 */
export declare function toLlmMessages(messages: readonly AgentMessage[]): Message[];
/** Match host results to the exact occurrence. Neither a reused native id,
 * a temporary ack nor an arbitrary result grants answer authority. */
export declare function pluginQuestionResultMatches(message: LhMessage, occurrence: PluginQuestionOccurrence, annotation: PluginQuestionAnnotationRead): boolean;
export interface PluginQuestionCall {
    occurrence: PluginQuestionOccurrence;
    annotation: Exclude<PluginQuestionAnnotationRead, {
        status: "absent";
    }>;
    status: "answerable" | "unreadable" | "attempt" | "failed" | "streaming";
    /** Present only when canonical saved authority parsed successfully. */
    snapshot?: PluginQuestionSnapshot;
}
export declare function pluginQuestionCallsOf(messages: readonly LhMessage[]): PluginQuestionCall[];
/** Saved authority only; no current registry/tool-name lookup or live ack. */
export declare function pendingPluginQuestionOf(messages: readonly LhMessage[]): PluginQuestionSnapshot | undefined;
export declare const danglingPluginQuestionOf: typeof pendingPluginQuestionOf;
/** The pending-question gate (findPendingToolCall's native twin): the
 *  NEWEST assistant message's FIRST answerable question-tool call with no
 *  result in the tail — never a failed generation or malformed fragment. */
export declare function danglingQuestionOf(messages: readonly LhMessage[]): {
    toolCallId: string;
    tool: string;
    input: unknown;
} | null;
/** The same authority, retaining native boundaries for the client dock.
 * Unique call ids are stable even when a live message's local id is replaced
 * by its persisted stamp. Only colliding ids need an occurrence-qualified
 * draft/reset key; this never changes stored ids or the answer wire. */
export declare function pendingQuestionOf(messages: readonly LhMessage[]): PendingQuestion | null;
export interface QuestionCall extends Omit<PendingQuestion, "key"> {
    status: "streaming" | "answerable" | "malformed" | "failed";
}
/** Newest native assistant only; siblings remain in call order. No result
 * alone is NOT proof of a posed question: failed generations never execute
 * their calls, and older records can contain truncated/unvalidated inputs. */
export declare function questionCallsOf(messages: readonly LhMessage[]): QuestionCall[];
/** Background wakes must still wait for an explicit learner action when a
 * question is unusable. Releasing the composer is not permission to retry. */
export declare function hasUnresolvedQuestion(messages: readonly LhMessage[]): boolean;
/** Client placeholders are loop acknowledgements, not learner answers. */
export declare function malformedQuestionsOf(messages: readonly LhMessage[]): QuestionCall[];
/** Successful probe_done result MESSAGE ids, in transcript order. A call
 *  from a failed/aborted generation grants no completion authority. Its
 *  later result must match both call id and tool name, must not be an
 *  error, and must not explicitly refuse with details.ok:false. Older
 *  clean acknowledgments without ok:true still count. No history changes. */
export declare function probeDoneResultIds(messages: readonly LhMessage[]): Set<string>;
/** The probe→teach construction seam (chat-handler and the tool guard):
 *  only a concluded call plus a matching successful result means teach. */
export declare function hasProbeDone(messages: readonly LhMessage[]): boolean;
/** Every toolResult id in the record — answer-event validation (the call
 *  must be a DANGLING question call, not an already-answered one). */
export declare function answeredCallIds(messages: readonly LhMessage[]): Set<string>;
/** The dismissal pause (owner design 2026-10-03, "A2"): the record ends
 *  in user dismissal — the session waits for the USER. While paused,
 *  nothing auto-wakes: the continuation fold demands nothing (below) and
 *  the wake pipeline holds job deliveries in the steer queue until the
 *  next send. Derived from the tail — no latch to persist or clear; any
 *  user message flips it off by changing the record. */
export declare function endsInDismissal(record: readonly LhMessage[]): boolean;
/** The recovery click authorizes its immediate replacement turn, not an
 * automatic restart if only the write-ahead error results survived. No new
 * stored latch: explicit input or replacement output changes this tail. */
export declare function endsInQuestionRecovery(record: readonly LhMessage[]): boolean;
export type RequestCause = "foreground" | "background";
export type ReconstructedCause = RequestCause | "ambiguous";
export type NativeInputCause = "learner" | "automatic" | "neutral" | "unrecognizable";
/** Native causes only: flattened user roles, IDs' prefixes and prose confer no permission. */
export declare function nativeInputCause(message: AgentMessage, history: readonly AgentMessage[]): NativeInputCause;
/** Full persisted native record, including pre-compaction causes. Never guessed foreground. */
export declare function reconstructRequestCause(messages: readonly LhMessage[]): ReconstructedCause;
export declare function needsContinuation(record: readonly LhMessage[]): boolean;
