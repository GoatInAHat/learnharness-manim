/**
 * Teaching-session phases derived sequentially from transcript events,
 * not from plan-tree occupancy or an explicit plan-acceptance flag:
 *
 * - probe: until probe_done has a successful tool result.
 * - plan: after probe completion, until a node-tagged teaching question call.
 * - teach: from that first call onward, without waiting for its answer.
 *
 * Native quiz/explain calls and supported plugin teaching-question annotations
 * supply the teaching boundary. Native-record summaries and projected-view
 * dividers use the same event boundaries; presenting a plan alone does not
 * advance the displayed phase to teach.
 */
/** The three phases of a session, as the picker / header / dividers see them. */
export type Phase3 = "probe" | "plan" | "teach";
/**
 * Minimal structural slice of a UI message for the phase scan: parts with
 * a state, an input (a tool call's parsed arguments), and (for concluded
 * calls) an output.
 */
export interface PhaseMessage {
    parts: ReadonlyArray<{
        type: string;
        state?: string;
        input?: unknown;
        output?: unknown;
        pluginQuestion?: unknown;
    }>;
}
/** The phase at `upToIndex` (inclusive; default: the last message). */
export declare function phaseAt3(messages: readonly PhaseMessage[], upToIndex?: number): Phase3;
/**
 * WHERE inside the flipping message teaching begins (owner round 8,
 * 2026-10-05 — the stacked-dividers bug): plan→teach flips at the first
 * tagged quiz/explain CALL, but the plan PRESENTATION often lives in the
 * same assistant message — an earlier provider STEP than the quiz call.
 * A message-level seam therefore drew the Teaching divider before the
 * plan presentation too (Planning and Teaching stacked back-to-back).
 * This returns the part index of the STEP BOUNDARY governing the flip
 * call: -1 when the call sits in the message's FIRST step (the divider
 * belongs before the whole message), else the index of the step-start
 * part whose generation contains the call — the divider renders there,
 * between the plan presentation and the teaching block.
 */
export declare function teachStepIndex(parts: PhaseMessage["parts"]): number;
/**
 * The phase at EVERY message index, in one forward fold — the transcript
 * dividers render one per boundary, so phaseAt3(m, i) per index would rescan
 * 0..i each time (quadratic); this is the same derivation, linear.
 * out[i] === phaseAt3(messages, i) for every i.
 */
export declare function phaseTimeline(messages: readonly PhaseMessage[]): Phase3[];
import { type LhMessage } from "./native-messages.ts";
/** The phase at `upToIndex` (inclusive; default: the last message) of a
 *  NATIVE record. probe→plan advances at the probe_done call's clean
 *  toolResult; plan→teach at the assistant message carrying the first
 *  nodeId-tagged quiz CALL (mirrors the view fold — same seam, native
 *  shape). */
export declare function phaseAt3Lh(messages: readonly LhMessage[], upToIndex?: number): Phase3;
