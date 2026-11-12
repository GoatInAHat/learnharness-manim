/**
 * Sub-agent job contracts — the async ack-and-steer protocol
 *
 * Part of the domain-split contracts (src/core/contracts/): each domain file
 * is owned outright by its stream — cross-domain schema changes go through
 * master. Pure types + protocol docs + tiny pure helpers; type-only imports
 * of "ai" (safe everywhere: server, client, tests). See docs/archive/vision.md.
 */
import type { CallUsage } from "./chat.ts";
import type { PluginBackgroundResult } from "../plugin-workers.ts";
import type { LhMessage, LhMarkerMessage } from "../native-messages.ts";
export type BuiltinJobKind = "research" | "demo" | "visual" | "pdf";
export type JobKind = BuiltinJobKind | "plugin";
export declare function isBuiltinJobKind(kind: JobKind): kind is BuiltinJobKind;
/** Host-owned durable linkage. Never contains filesystem paths. */
export interface PluginJobMetadata {
    pluginId: string;
    toolName: string;
    workerId: string;
    requestId: string;
    taskId?: string;
    input?: unknown;
    label?: string;
}
export type JobResult = ResearchResult | DemoResult | VisualResult | PdfResult | PluginBackgroundResult;
export type JobStatus = "running" | "done" | "error";
export interface JobRecord {
    id: string;
    kind: JobKind;
    chatId: string;
    /** The tool part this job fulfills. */
    toolCallId: string;
    /** Dispatch-time arguments, saved before spawn. Older jobs resolve from history. */
    input?: unknown;
    /** Session-owned delivery, independent of the worker's terminal outcome.
     * A failure notice uses error text, never an invented result or learner abort.
     * Absent on legacy records: old terminal jobs must never be replayed. */
    delivery?: {
        kind: "result" | "abort" | "failure";
        status: "pending" | "delivered";
    };
    /** Worker computation only; a pending delivery does not keep it running. */
    status: JobStatus;
    /** Latest human-readable activity line, e.g. `web_search: "sigma.js v3"`. */
    activity: string;
    createdAt: string;
    updatedAt: string;
    /** The sub-agent's result (steer-artifact payload). */
    result?: unknown;
    error?: string;
    /** Money channel (observability, 2026-09): accumulated token usage of
     * the sub-agent's run, written by the runner as steps complete. Cost is
     * inferred at read time (core/prices.ts). Absent on pre-2026-09 jobs and
     * until the runner's capture lands — renderers show "—", never zero. */
    usage?: JobUsage;
    plugin?: PluginJobMetadata;
}
/** Accumulated model usage for one worker run: token totals plus a call
 * count, with optional per-call accounting. As with CallUsage, a token field
 * no call reported remains undefined; missing usage must not imply zero cost. */
export interface JobUsage {
    /** Provider-qualified model identity (provider:id) for catalog lookup. */
    model: string;
    /** Running totals summed over the run's model calls so far. */
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    cacheReadTokens: number | undefined;
    cacheWriteTokens: number | undefined;
    reasoningTokens: number | undefined;
    cacheWrite1hTokens?: number;
    /** Individual calls for current-catalog per-call tier pricing. Absent on
     * older jobs; never backfill them from cumulative totals. */
    calls?: CallUsage[];
    /** How many model calls the run has made (each bills separately). */
    steps: number;
    /** Most recent completed model call's accounting, used for current context
     * usage rather than cumulative totals. Absent until a call completes;
     * unreported provider fields remain undefined. */
    lastStep?: CallUsage;
}
/** The per-model-call usage shape we fold into JobUsage — the SDK's
 * LanguageModelUsage narrowed structurally (no runtime "ai" import: any
 * object with these fields folds, including the real thing and test fakes). */
export interface UsageStepLike {
    inputTokens?: number | undefined;
    inputTokenDetails?: {
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        cacheWrite1hTokens?: number;
    } | undefined;
    outputTokens?: number | undefined;
    outputTokenDetails?: {
        reasoningTokens?: number;
    } | undefined;
}
/** pi-ai's Usage shape (input/output/cacheRead/cacheWrite/reasoning?) →
 * UsageStepLike. Structural — no pi import here; the engine band maps at
 * its boundaries. */
export declare function piUsageToStep(usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cacheWrite1h?: number;
    reasoning?: number;
}): UsageStepLike;
/** Fold one model call's usage into the run's running total (pure). A
 * field neither the total nor the step reported stays undefined; once
 * reported, later unreported calls contribute 0. The `steps` counter is
 * the billing count: one per model call, reported or not. */
export declare function accumulateJobUsage(total: JobUsage | undefined, model: string, step: UsageStepLike): JobUsage;
/**
 * THE ASYNC PROTOCOL — "ack now, steer later" (the pi sub-agents model,
 * vision §2.5):
 *
 *  1. Job tools (research / demo / visual / pdf) are SERVER-EXECUTED. The model
 *     calls one MID-TURN; execute creates the job record, fires the
 *     background runner, and resolves IMMEDIATELY with an acknowledgement
 *     ("dispatched — continue your turn"). The teacher's turn does NOT end
 *     at the call: it keeps teaching, may dispatch other independent jobs
 *     (full parallelism), and ends whenever it ends. The tool part's output
 *     is the ack, forever.
 *
 *  2. The background runner (src/agent/subagents/runner.ts) runs the kind's
 *     sub-agent loop — isolated context, modelFor(role), the
 *     verify-never-one-shot doctrine (headless-tested demos, looked-at SVGs,
 *     sourced briefs) — tracking a live activity line in the job record.
 *     ONE central client poll of GET /api/jobs?chatId=… (in Chat) drives every
 *     job surface: the transcript dispatch cards (live activity by
 *     toolCallId, quiet one-liner after worker completion), the sub-agents sidebar
 *     panel, and the single re-sync when a job settles.
 *
 *  3. Dispatch saves input on the job before spawn. On completion the
 *     runner saves result + terminal worker status + pending delivery in
 *     one job update, then queues buildSubagentSteer WITHOUT waiting for
 *     delivery. The native custom marker's content is model-facing text;
 *     details carry the full artifact payload for the UI. Worker resources
 *     are released even if a question keeps the result pending indefinitely.
 *     Only computing workers appear in Background agents or accept abort.
 *
 *  4. Session delivery owns one registry entry per deterministic steer ID,
 *     including while a wake is in flight or a 409/403 returns its cargo.
 *     A live agent takes it via pi steering; registration restores saved
 *     pending jobs before the answer run's first poll. Otherwise the idle
 *     wake uses the normal turn composition and respects pending questions,
 *     dismissal, and background consent. A saved transcript marker completes
 *     delivery; HTTP 200 or streamed visibility alone does not.
 *
 *     Failed starts remain quietly pending until a learner run or restart
 *     recovery, without new timers, visible delivery errors, or worker-status
 *     changes. Existing 409 backoff and consent deferral remain. Accepted
 *     turns are never automatically replayed. Legacy running records with a
 *     result become finished/pending; legacy terminal records with no
 *     delivery metadata remain untouched. Session deletion discards pending
 *     deliveries rather than treating them as running work.
 *
 *  5. No pending job parts ever exist, so the composer never gates on jobs
 *     (the learner can interject mid-job; the steer queues behind their
 *     turn) and job tool outputs never trigger the client-side
 *     sendAutomatically continuation — that mechanism stays quiz/ask-only.
 */
export interface ResearchToolInput {
    question: string;
    /** What the teacher needs it for — focuses the research brief. */
    context?: string;
}
export interface ResearchResult {
    brief: string;
    /** Rendered as links, so only http(s) URLs belong here (isWebSourceUrl).
     *  Records saved before that rule may still hold other schemes. */
    sources: {
        title: string;
        url: string;
    }[];
}
/** True for http(s) URLs: the only research sources that become links. */
export declare function isWebSourceUrl(url: string): boolean;
export interface DemoToolInput {
    title: string;
    /** Precise brief: concept, parameters/interactions, visual style. */
    brief: string;
}
export interface DemoResult {
    title: string;
    /** Self-contained single-file HTML/JS document (sandboxed-iframe ready). */
    html: string;
    /** The builder sub-agent headlessly executed the demo before delivery. */
    tested: true;
    notes?: string;
}
export interface VisualToolInput {
    /** Precise brief for ONE visual (what it must show, exactly). */
    brief: string;
    /** A learner image file to annotate (issue #363): the maker draws its
     *  marks on top of it instead of authoring a figure from scratch. */
    image?: string;
}
export interface VisualResult {
    /** Complete SVG markup (verified by the maker looking at the render).
     *  Annotation SVGs retain a learner-image placeholder; image identifies the session snapshot. */
    svg: string;
    notes?: string;
    /** Present when the figure annotates a learner image: its absolute
     *  path. Photos never invert, so the card hides the switch. */
    image?: {
        path: string;
        snapshotId: string;
    };
}
/** The pdf-reader (sources v0, 2026-09): reads a learner-provided PDF on
 *  the teacher's behalf — triage, targeted extraction, look-at-the-page
 *  renders inside its own loop — and returns a text brief with page
 *  citations (user-decided: rendered images never leave the sub-agent's
 *  context; the teacher gets text). */
export interface PdfToolInput {
    /** Path to the learner's PDF (relative or absolute). */
    path: string;
    /** What the teacher needs from the document — focuses the brief. */
    question: string;
}
export interface PdfResult {
    path: string;
    question: string;
    /** The distilled brief. Page citations inside the text point at
     *  pagesConsulted. Failure shape: /^PDF failed:/i (mirrors research). */
    brief: string;
    /** Pages the reader actually READ — extract or render output entered the
     *  loop (the honest count for the UI badge; search-hit snippets don't
     *  count — sources v1 split, 2026-09-19, after the "78 pages consulted"
     *  overstatement on a long-book search-first read). */
    pagesRead: number[];
    /** Every page whose content entered the loop, search-hit context lines
     *  included — the full audit set (the brief's citations may point here). */
    pagesConsulted: number[];
}
/** Message metadata marking a sub-agent steer (contracts.ts §3). */
export interface SubagentResultMeta {
    jobId: string;
    kind: JobKind;
    toolCallId: string;
    /** Present only on an abort steer (2026-09 abort semantics): the
     * learner aborted the job (it lands as error "Aborted by learner");
     * the teacher is told so its promise of a result doesn't hang
     * silently in the lesson. */
    aborted?: true;
    /** Delivery/recovery failure, not a learner abort or fabricated task outcome. */
    failure?: string;
}
/** The data-subagent-artifact part payload: what the UI renders. */
export interface SubagentArtifactData {
    kind: JobKind;
    result: JobResult;
    /** The learner's pinned UI state (invert switch) riding the record. */
    ui?: {
        inverted?: boolean;
    };
}
/** A result steer's marker details: the UI's meta + artifact in one
 *  payload (the projection splits it into metadata + data part). */
export interface SteerDetails extends SubagentResultMeta {
    result: JobResult;
    /** LEARNER UI state pinned onto the artifact (owner, 2026-10-07): the
     *  invert switch's position, persisted so navigating away and back (or
     *  restarting) keeps it. A VIEW preference — never enters the teacher's
     *  context, never exports (the markdown engine reads `result` only). */
    ui?: {
        inverted?: boolean;
    };
}
/** Set a steer message's ui.inverted (pure): returns a NEW message array
 *  with the target's details updated — no-op (same array) when the message
 *  is missing or not an invertible artifact steer. The silent route's
 *  whole body. */
export declare function setSteerUiInverted(messages: readonly LhMessage[], messageId: string, inverted: boolean): LhMessage[];
/** Anything the wake pipeline may queue and deliver — a native marker. */
export type SteerMessage = LhMarkerMessage;
/** Whether a result is the failure shape (html/svg empty, failure brief). */
export declare function isSubagentFailure(kind: JobKind, result: JobResult): boolean;
/**
 * Build the steer message for a finished job (pure — shared by the runner,
 * the wake pipeline, and tests). Deterministic id per job makes re-delivery
 * idempotent.
 */
export declare function buildSubagentSteer(job: Pick<JobRecord, "id" | "kind" | "toolCallId">, result: JobResult): SteerMessage;
/** Build the abort steer for an aborted job (pure — shared by the
 * abort path in src/server/jobs.ts and tests). Same id space as the result
 * steer (same id space — exactly one delivers). */
export declare function buildAbortSteer(job: Pick<JobRecord, "id" | "kind" | "toolCallId">): SteerMessage;
/** Honest pipeline failure: same deterministic marker id, no invented task result. */
export declare function buildJobFailureSteer(job: Pick<JobRecord, "id" | "kind" | "toolCallId">, failure: string): SteerMessage;
export declare function buildProbeHandoffSteer(chatId: string): SteerMessage;
/** True when the transcript already carries this steer — idempotent
 *  delivery for ANY steer kind: every steer id is deterministic per its
 *  event (steer_<jobId> for jobs, steer_probe_<chatId> for the handoff). */
export declare function steerDelivered(messages: LhMessage[], steerId: string): boolean;
