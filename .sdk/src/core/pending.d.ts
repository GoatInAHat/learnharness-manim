/**
 * Wave D: these scans read VIEW messages (core/view.ts LhViewMessage — the
 * client's grouped transcript). The part shapes are the same vocabulary the
 * pre-Wave-D client dialect used; a tool part is structural: `tool-` prefix +
 * toolCallId. The server-side record scans (danglingQuestionOf over native
 * LhMessage[]) live in native-messages.ts.
 */
interface UIMessage {
    role?: string;
    parts: Array<Record<string, unknown> & {
        type: string;
    }>;
}
/**
 * The pending-question gate: an unanswered QUESTION tool part (quiz/ask)
 * blocks the composer — one question at a time, mirroring the teacher's
 * prompt contract. Derived client state; the server enforces nothing.
 *
 * Scan order: MESSAGES newest-first (a later turn's live question supersedes
 * an older dangling one), but PARTS forward within a message — the model's
 * FIRST unanswered question is the dock subject. Parallel question calls
 * (pi executes them in one batch) are thus answered in the same order they
 * were asked, saved, and rendered as cards; a backward part scan reversed
 * that order (the live modal-realism observation).
 *
 * Job tool parts (research/demo/visual) never pend client-side — the async
 * protocol resolves them server-side with an immediate ack (see
 * contracts/jobs.ts "THE ASYNC PROTOCOL"), so job tools are NOT returned
 * here. This file carries only the question gate and the shared scan helper.
 */
export interface PendingToolCall {
    toolCallId: string;
    tool: string;
    /** Tool input (quiz/ask args) — lets the composer pick note vs answer mode. */
    input: unknown;
}
/** Client-only identity: projection may group several native assistants.
 * Never persisted or sent as part of an answer event. */
export interface PendingQuestion extends PendingToolCall {
    messageId: string;
    contentIndex: number;
    /** Unique call ids stay stable across live → persisted message stamps.
     * Reused ids include their native occurrence instead. */
    key: string;
}
/** Tools that render in the question dock and gate the composer. The
 * probe-phase names join their teach twins; old records keep teach names. */
export declare const QUESTION_TOOLS: readonly ["quiz", "probe", "ask_user_question", "explain", "recall"];
/** The tool→kind map (the dock's own fold, named once — the dismissal
 *  path and the dock must never disagree on what a tool is). The probe
 *  names fold onto their teach kinds — the dock is kind-driven. */
export declare function toolQuestionKind(tool: string): "quiz" | "ask" | "explain";
/** Tools fulfilled by background sub-agent jobs (W2/W6). */
export declare const JOB_TOOLS: readonly ["research", "demo", "visual"];
/** The tools a user may toggle off in settings — THE DEFINITIVE LIST
 *  (adjudicated 2026-09-19, P2 reconciliation: the sub-agent JOB tools
 *  only — research/demo/visual/pdf). Deliberately NOT toggleable, ever:
 *  quiz + ask_user_question (the prober's flow is graded-quiz brackets →
 *  probe_done; quiz-off would collapse the assessment and teaching
 *  doctrine is built on graded verification — the wedge danger), the
 *  learner-filesystem set (user-decided 2026-09, sources v1: always-on),
 *  plan tools, and probe_done (it is how the phase ENDS — a prober that
 *  can never conclude is a lockout).
 *  The write side validates against this list (settings-body.ts: unknown
 *  key = 400 with the supported list); the read-side sanitizer stays
 *  lenient for forward-compat. The names are the MODEL-FACING tool names
 *  (research, not researcher; pdf is the PDF-reader dispatch, sources v0
 *  2026-09). */
export declare const TOGGLEABLE_TOOLS: readonly ["research", "demo", "visual", "pdf"];
/** The keys the settings WRITE side accepts in agent.tools: the plain
 *  toggleables PLUS the quizzing-mechanics switch (`explain: true` arms
 *  free-recall quizzing and drops the MC quiz — see quizMechanics in
 *  agent/tools.ts; owner 2026-09-27). `quiz` itself stays unwritable:
 *  mechanics-managed, never individually toggleable. */
export declare const WRITABLE_TOOL_KEYS: readonly ["research", "demo", "visual", "pdf", "explain"];
/** The resolved settings → factory seam shape (Platform wires chat-handler
 *  to pass this through from the settings record; storage and defaults are
 *  Platform's lane). JSON-native: a partial record keyed by tool name.
 *  Absent key / undefined = enabled — old records behave exactly as today.
 *  Any explicit `false` removes that tool from the registry, whatever its
 *  name — the machinery stays generic for future toggleables. */
export type EnabledTools = Partial<Record<string, boolean>>;
/** Drop every tool the resolved settings mark as disabled. The single
 *  filtering site every factory shares (prober/teacher). */
export declare function filterEnabledTools<T>(tools: Record<string, T>, enabled?: EnabledTools): Record<string, T>;
/** Grouped view messages lose native assistant boundaries. Native callers
 * supply the exact occurrence, not just an id: its OWN part must have cleared
 * validation. Never fall back to an older available question.
 * null means no native pending question; undefined keeps view-only callers.
 * The string overload is retained for view-only/id-filter consumers. */
export declare function findPendingToolCall(messages: UIMessage[], authority: PendingQuestion | null): PendingQuestion | null;
export declare function findPendingToolCall(messages: UIMessage[], authority?: string | null): PendingToolCall | null;
/** The activity label for ONE running tool (owner, streaming round
 *  2026-10-01): the live tool-input card carries it inline — spinner +
 *  shimmered label on the card itself, replacing the retired transcript
 *  bottom line. Question tools are excluded here: their input-streaming
 *  part renders in the dock, never a live card. */
export declare function toolActivityLabel(tool: string): string;
export declare function streamingToolActivity(messages: UIMessage[]): string | null;
export {};
