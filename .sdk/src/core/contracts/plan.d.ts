/**
 * Plan-tree contracts — the session-scoped dependency tree
 *
 * Part of the domain-split contracts (src/core/contracts/): each domain file
 * is owned outright by its stream — cross-domain schema changes go through
 * master. Pure types + protocol docs + tiny pure helpers; type-only imports
 * of "ai" (safe everywhere: server, client, tests). See docs/archive/vision.md.
 */
export interface PlanNode {
    /** Opaque, agent-chosen slug, stable across edits: "chain-rule-intuition". */
    id: string;
    /** Short label for the tree panel. */
    title: string;
    /** 1-2 sentences: what this node covers. */
    summary?: string;
}
export interface PlanEdge {
    /** Prerequisite node id. */
    from: string;
    /** Node that depends on `from`. */
    to: string;
}
export interface PlanTree {
    nodes: PlanNode[];
    edges: PlanEdge[];
    /** Increments on every mutation — lets the UI animate/react to changes. */
    version: number;
}
/** Derived, never stored: status of a node for the panel (vision §2). */
export type PlanNodeStatus = "current" | "visited" | "upcoming";
/** Minimal structural message slice — anything with typed parts (mirrors
 * phases.ts: pure, no runtime deps, safe on server, client, and in tests). */
interface PartsCarrier {
    parts: Array<{
        type: string;
        state?: string;
        input?: unknown;
        output?: unknown;
        pluginQuestion?: unknown;
    }>;
}
export interface DerivedPlanStatuses {
    /** The node the most recent tagged quiz call is about; null before any. */
    current: string | null;
    /** Nodes referenced by earlier tagged calls — been there, monotonic. */
    visited: ReadonlySet<string>;
}
/** Statuses of a node: the derived view the plan panel should render. */
export declare function derivedNodeStatus(statuses: DerivedPlanStatuses, nodeId: string): PlanNodeStatus;
export declare function derivePlanStatuses(tree: PlanTree, messages: readonly PartsCarrier[]): DerivedPlanStatuses;
/**
 * The plan tool result (author-once protocol, 2026-09-03): ONE server-side
 * tool, plan_init (tools/plan.ts) — a mermaid `graph TD` block canonicalized
 * into the structured tree, called once at the probe→teach seam and
 * re-callable to rewrite. The former mutation/tracking tools are gone:
 * statuses derive from check outcomes (derivePlanStatuses above), so the
 * tree carries structure, never progress. The tree panel still derives its
 * display from the LATEST plan tool output in the transcript — plus the
 * derived statuses — with no separate state channel.
 */
export interface PlanToolResult {
    ok: boolean;
    error?: string;
    /** The saved tree — SUCCESS results only (owner, context diet
     *  2026-10-09): this is the record/UI-facing `details` value. The
     *  agent-facing content never carries it — content is the validated
     *  nodeIds + reminder; failures carry just the error. The plan
     *  popup's latestTree seam reads this field. */
    tree?: PlanTree;
}
import type { LhMessage } from "../native-messages.ts";
/** The same derivation over the NATIVE record: quiz CALLS only (any state —
 *  a dangling call still moves position; results feed nothing). */
export declare function derivePlanStatusesLh(tree: PlanTree, messages: readonly LhMessage[]): DerivedPlanStatuses;
export {};
