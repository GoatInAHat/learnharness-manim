/**
 * The UI parse seam — parse, don't cast (the rule born of the 2026-09-12
 * live crashes).
 *
 * WHY THIS EXISTS. Validation IS first at the model-facing boundary — pi
 * validates arguments against the tool's TypeBox schema before execute,
 * and the authoring refinements run in the execute seam; a failure
 * returns to the model as an error tool result, same turn. But the same bytes have two other consumers, and there they
 * exist UNVALIDATED BY DESIGN:
 *
 *   - the live wire streams raw tool-input deltas while the model is still
 *     typing the call (validation cannot run before the call is complete);
 *   - the transcript keeps the raw input of REJECTED calls too (transcript
 *     honesty + the replay invariant: every toolCall followed by a result).
 *
 * So invalid input is always observable, and part STATES carry the verdict
 * (input-streaming = partial, input-available = validated, output-error =
 * garbage). The flaw that made the crashes possible: consumers trusted
 * those shapes via TypeScript CASTS — `part.input as X` is a compile-time
 * lie the checker believes, with no runtime check behind it.
 *
 * THE RULE (mechanical, not vigilance): model-authored INPUT is consumed
 * only through these parsers, each running the SAME TypeBox schema the model
 * faced — boundary-valid ⇔ consumer-parseable, structurally. Server- and
 * learner-authored OUTPUT stays trusted (our own code authors it: the
 * execute acks, the learner's buildAnswer). A parse failure renders the
 * quiet fallback, never a crash.
 */
import { type AskToolInput, type QuizToolInput, type ExplainToolInput } from "./question-core.ts";
import { type ProbeDoneInput } from "./contracts/probe.ts";
import { type PluginQuestionSnapshot } from "./plugin-questions.ts";
/** View metadata, not model arguments, owns plugin question role/position. */
export declare function posedPluginQuestionOfPart(part: {
    pluginQuestion?: unknown;
}): PluginQuestionSnapshot | undefined;
/**
 * Quiz parse for DISPLAY: the shared authoring base, pre-refinement.
 * Both boundaries (the prober's quizInputBase, the teacher's quizInputObject
 * over base + optional nodeId) share THE SAME quizInputBase fields, so
 * anything that passed either boundary parses here; the teacher-only
 * `nodeId` is an unknown key Value.Clean strips (zod's old strip behavior,
 * kept so the display shape stays exactly what the dock always saw). This
 * is deliberately the LENIENT common core — the strict per-agent authoring
 * checks are the boundary's job — but it runs the shared grading
 * refinement (quizInputProblems) after Convert, mirroring the boundary's
 * full chain: pi accepts `correctAnswer: 17` structurally (Convert →
 * "17") and execute's refinement is what makes it a posed-or-rejected
 * call. The display parse follows the same order so an input that could
 * never have been posed (e.g. `correctAnswer: undefined`, which Convert
 * widens to "") renders as a quiet fallback, not a broken quiz.
 */
/** Shape parsing never repairs authored text. The dock builds its answer
 * data from this source copy; recovery belongs exclusively to presentation
 * (ToolContentResponse), never option identities, grading, or snapshots. */
export declare function parseQuizInput(input: unknown): QuizToolInput | undefined;
/**
 * Ask parse for DISPLAY: the full ask schema (options optional — free-text
 * mode is the options-less shape), plus the option-sanity refinement the
 * boundary enforced (askOptionProblems — duplicate values break the dock's
 * keying, so they parse to undefined exactly like the zod seam did).
 */
export declare function parseAskInput(input: unknown): AskToolInput | undefined;
/** Explain parse for DISPLAY: the display schema (base + OPTIONAL
 *  lenient `type`, exactly the quiz pattern — teach explain calls carry
 *  the role since 2026-10-09; the commitment refinement
 *  (explainInputProblems) mirrors the boundary chain). Both explain
 *  variants share the same fields; the teacher's nodeId is an unknown
 *  key Value.Clean strips, same as the quiz seam. */
export declare function parseExplainInput(input: unknown): ExplainToolInput | undefined;
/** One display-validity decision for dock authority and recovery. Does not
 * mutate the recorded input or invent missing authoring fields. */
export declare function parseQuestionInput(tool: string, input: unknown): QuizToolInput | AskToolInput | ExplainToolInput | undefined;
/** probe_done parse — the core-owned schema the tool itself declares. */
export declare function parseProbeDoneInput(input: unknown): ProbeDoneInput | undefined;
