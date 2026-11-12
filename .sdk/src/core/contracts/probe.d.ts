/**
 * Probe-phase contracts (the probe→teach split, docs/archive/probe-teach-split.md).
 *
 * The prober concludes its phase with `probe_done` — a server-side tool
 * whose INPUT is the learner assessment (authored by the model, streamed to
 * the learner live, durable in the transcript by the tool result itself).
 * The first `probe_done` in the transcript is the probe→planning seam: the
 * teacher agent is constructed from that point on, and the tool's execute
 * queues the handoff steer through the wake pipeline so the teacher starts
 * immediately after the prober's turn ends (auto-wake, user-decided).
 *
 * Assessment shape (v1 — refine later): the probe was a binary search per
 * dependency strand; the assessment formalizes exactly that. A list of the
 * strands the lesson will depend on, each with a free-form read of where
 * the learner's edge sits.
 */
import { Type, type Static } from "typebox";
/** One dependency strand the planned lesson will rest on. */
export interface ProbeStrand {
    /** Name/description of the strand (e.g. "the derivative as a limit"). */
    strand: string;
    /** Free-form: where the learner's edge sits on this strand — floor,
     *  ceiling, misconceptions found, what to build from. */
    assessment: string;
}
/** The prober's read of the learner, carried by probe_done. */
export interface ProbeAssessment {
    strands: ProbeStrand[];
    /** Optional overall synthesis: the learner's apparent goal and edge. */
    summary?: string;
}
/** probe_done tool input (the assessment the prober authors). */
export interface ProbeDoneInput {
    assessment: ProbeAssessment;
}
export declare const probeDoneInputSchema: Type.TObject<{
    assessment: Type.TObject<{
        strands: Type.TArray<Type.TObject<{
            strand: Type.TString;
            assessment: Type.TString;
        }>>;
        summary: Type.TOptional<Type.TString>;
    }>;
}>;
/** Schema ↔ interface lock (the old `satisfies z.ZodType` guarantee): the
 *  declaration and ProbeDoneInput can never drift apart — this only compiles
 *  when the schema's static shape IS the interface. */
export declare const probeDoneSchemaLock: (v: Static<typeof probeDoneInputSchema>) => ProbeDoneInput;
/** probe_done tool output. */
export interface ProbeDoneResult {
    ok: boolean;
    /** Refusal reason when ok === false (open question, already concluded). */
    error?: string;
}
/** The probe_done ack's model-facing text (owner, context diet
 *  2026-10-09): the assessment is the CALL's arguments — durable in the
 *  transcript, streamed to the learner — so echoing it back in the
 *  result would duplicate the probe phase's largest payload in every
 *  future context. The agent sees this fixed line instead; `details`
 *  carries only {ok:true} for the record/UI. Same doctrine as
 *  CONCLUDE_ACK_TEXT. */
export declare const PROBE_DONE_ACK_TEXT = "Assessment recorded \u2014 it is shown to the learner now and the teacher plans from it. Say your closing sentence and end your turn; the teaching phase takes over from here.";
