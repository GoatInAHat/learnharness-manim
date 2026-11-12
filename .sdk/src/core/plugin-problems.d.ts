/** Plugin-defined practice problems share the native problem/conclude lifecycle. */
import type { Static, TSchema } from "typebox";
import type { PluginCleanup } from "./plugins.ts";
import type { LhMessage } from "./native-messages.ts";
import { type PluginProblemSubmissionImages } from "./plugin-submissions.ts";
import { type JsonValue, type PluginQuestionEditorKey, type PluginQuestionOccurrence, type PluginQuestionValidationResult } from "./plugin-questions.ts";
export interface PluginProblemInput<Q = JsonValue> {
    statement: string;
    mode: "recall" | "discrimination" | "composition";
    target?: string[];
    modelSolution: string;
    payload: Q;
}
export interface PluginProblemValidationContext<Q = JsonValue> {
    readonly chatId: string;
    readonly contractVersion: number;
    readonly input: PluginProblemInput<Q>;
}
export interface PluginProblemSubmissionValidationContext<Q = JsonValue, S = JsonValue> extends PluginProblemValidationContext<Q> {
    readonly problemId: string;
    readonly submission: S;
}
export interface PluginProblemProcessingContext<Q = JsonValue, S = JsonValue> extends PluginProblemSubmissionValidationContext<Q, S> {
    readonly thinking: string;
    readonly images?: PluginProblemSubmissionImages;
    readonly signal: AbortSignal;
}
/** Per-submission observations, never the model's final problem assessment. */
export type PluginProblemProcessingOutcome = {
    result: JsonValue;
} | {
    error: string;
};
export interface PluginProblemTypeDefinition<Q extends TSchema = TSchema, S extends TSchema = TSchema> {
    id: string;
    label: string;
    contractVersion: number;
    incompatibleContractVersions?: number[];
    tool: {
        toolName: string;
        description: string;
    };
    problemSchema: Q;
    submissionSchema: S;
    validateProblem?: (context: PluginProblemValidationContext<Static<Q>>) => undefined | string[];
    validateSubmission?: (context: PluginProblemSubmissionValidationContext<Static<Q>, Static<S>>) => undefined | string[];
    processSubmission?: (context: PluginProblemProcessingContext<Static<Q>, Static<S>>) => JsonValue | Promise<JsonValue>;
}
export type PluginProblemSubmissionState = {
    status: "empty";
} | {
    status: "unready" | "ready";
    value: JsonValue;
};
export interface PluginProblemMountContext<Q = JsonValue> extends PluginProblemValidationContext<Q> {
    readonly problemId: string;
    readonly signal: AbortSignal;
}
export interface PluginProblemEditorProps<Q = JsonValue> extends PluginProblemMountContext<Q> {
    readonly active: boolean;
    readonly submission: PluginProblemSubmissionState;
    onChange(submission: PluginProblemSubmissionState): void;
}
export interface PluginProblemEditorHandle {
    update(props: {
        submission: PluginProblemSubmissionState;
        active: boolean;
    }): void;
    focus(): void;
    handleKeyDown?(key: PluginQuestionEditorKey): "handled" | "pass";
    appendTranscript?(text: string): void | Promise<void>;
    dispose(): void;
}
export interface PluginProblemRenderer<Q = JsonValue, S = JsonValue> {
    id: string;
    supportedContractVersions: number[];
    mountSubmissionEditor(container: HTMLElement, context: PluginProblemEditorProps<Q>): PluginProblemEditorHandle | Promise<PluginProblemEditorHandle>;
    mountSubmitted?(container: HTMLElement, context: PluginProblemMountContext<Q> & {
        readonly submission: S;
        readonly processing?: PluginProblemProcessingOutcome;
        readonly headerContainer?: HTMLElement;
        /** Generation-owned block after host submission images/thinking. */
        readonly footerContainer?: HTMLElement;
    }): void | PluginCleanup | Promise<void | PluginCleanup>;
}
/** The host persists this in the genuine pose acknowledgment, never model arguments. */
export interface PluginProblemSnapshot {
    protocolVersion: 1;
    problemId: string;
    pluginId: string;
    typeId: string;
    label: string;
    contractVersion: number;
    input: PluginProblemInput;
    problemSchema: TSchema;
    submissionSchema: TSchema;
    requiresSubmissionRefinement: boolean;
    requiresProcessing: boolean;
}
export interface PluginProblemSubmission {
    kind: "plugin-problem-submission";
    problemId: string;
    pluginId: string;
    typeId: string;
    contractVersion: number;
    submission: JsonValue;
    thinking: string;
    images?: PluginProblemSubmissionImages;
    processing?: PluginProblemProcessingOutcome;
    submittedAt: string;
}
/** Internal heterogeneous registry; public registration remains schema-generic. */
export type NativePluginProblemDefinition = Omit<PluginProblemTypeDefinition, "validateProblem" | "validateSubmission" | "processSubmission"> & {
    validateProblem?: (context: PluginProblemValidationContext<any>) => undefined | string[];
    validateSubmission?: (context: PluginProblemSubmissionValidationContext<any, any>) => undefined | string[];
    processSubmission?: (context: PluginProblemProcessingContext<any, any>) => JsonValue | Promise<JsonValue>;
};
export declare function preparePluginProblemType<Q extends TSchema, S extends TSchema>(definition: PluginProblemTypeDefinition<Q, S>): PluginProblemTypeDefinition<Q, S>;
export declare function createPluginProblemParameters(definition: PluginProblemTypeDefinition): TSchema;
export declare function validatePluginProblemInput(definition: PluginProblemTypeDefinition, context: {
    chatId: string;
    input: unknown;
}): PluginQuestionValidationResult<PluginProblemInput>;
export declare function readPluginProblemSnapshot(value: unknown): PluginProblemSnapshot | null;
export declare function validatePluginProblemSubmission(snapshot: PluginProblemSnapshot, context: {
    chatId: string;
    submission: unknown;
}, definition?: PluginProblemTypeDefinition): PluginQuestionValidationResult<JsonValue>;
export declare function readPluginProblemSubmission(value: unknown): PluginProblemSubmission | null;
export declare function pluginProblemById(messages: readonly LhMessage[], problemId: string): PluginProblemSnapshot | null;
/** Associate only the actual result batch belonging to this physical call occurrence.
 * Pose ACKs persist in practice, so no second annotation/stream-ledger protocol is needed.
 */
export declare function pluginProblemForCall(messages: readonly LhMessage[], occurrence: PluginQuestionOccurrence): PluginProblemSnapshot | null;
