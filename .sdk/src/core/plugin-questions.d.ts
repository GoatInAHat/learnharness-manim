/** Bounded plugin-question contracts and browser-safe saved-authority helpers. */
import type { Static, TSchema } from "typebox";
import type { PluginCleanup } from "./plugins.ts";
import { type PluginSubmissionImages } from "./plugin-submissions.ts";
export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue;
};
export type PluginQuestionVariant = "probe" | "teach";
export type PluginQuestionInput<Q = JsonValue> = {
    question: string;
    payload: Q;
} & ({
    type?: never;
    nodeId?: never;
} | {
    type: "predict" | "check";
    nodeId: string;
});
export interface PluginQuestionValidationContext<Q = JsonValue> {
    readonly chatId: string;
    readonly variant: PluginQuestionVariant;
    readonly contractVersion: number;
    readonly input: PluginQuestionInput<Q>;
}
export interface PluginQuestionAnswerValidationContext<Q = JsonValue, A = JsonValue> extends PluginQuestionValidationContext<Q> {
    readonly questionId: string;
    readonly answer: A;
}
export interface PluginQuestionGradingContext<Q = JsonValue, A = JsonValue> extends PluginQuestionAnswerValidationContext<Q, A> {
    readonly signal: AbortSignal;
}
export type PluginQuestionGradingOutcome = {
    result: JsonValue;
} | {
    error: string;
};
export interface PluginQuestionTypeDefinition<Q extends TSchema = TSchema, A extends TSchema = TSchema> {
    id: string;
    label: string;
    contractVersion: number;
    incompatibleContractVersions?: number[];
    showThinking: boolean;
    questionSchema: Q;
    answerSchema: A;
    probe?: {
        toolName: string;
        description: string;
    };
    teach?: {
        toolName: string;
        description: string;
    };
    validateQuestion?: (context: PluginQuestionValidationContext<Static<Q>>) => undefined | string[];
    validateAnswer?: (context: PluginQuestionAnswerValidationContext<Static<Q>, Static<A>>) => undefined | string[];
    gradeAnswer?: (context: PluginQuestionGradingContext<Static<Q>, Static<A>>) => JsonValue | Promise<JsonValue>;
}
export type PluginQuestionAnswerState = {
    status: "empty";
} | {
    status: "unready" | "ready";
    value: JsonValue;
};
export interface PluginQuestionMountContext<Q = JsonValue> {
    readonly input: PluginQuestionInput<Q>;
    readonly chatId: string;
    readonly questionId: string;
    readonly contractVersion: number;
    readonly variant: PluginQuestionVariant;
    readonly signal: AbortSignal;
}
export interface PluginQuestionEditorProps<Q = JsonValue> extends PluginQuestionMountContext<Q> {
    readonly active: boolean;
    readonly answer: PluginQuestionAnswerState;
    /** Synchronous publication; stale mount publications are ignored by the host. */
    onChange(answer: PluginQuestionAnswerState): void;
}
export type PluginQuestionEditorKey = "Tab" | "Enter" | "Shift+Enter" | "Escape";
export interface PluginQuestionEditorHandle {
    update(props: {
        answer: PluginQuestionAnswerState;
        active: boolean;
    }): void;
    focus(): void;
    /** Optional editing override. Omission or "pass" uses host defaults:
     * Enter submits, Shift+Enter keeps native newline editing, Tab cycles fields.
     * Unhandled Escape moves to the next host field, or blurs an editor-only chain.
     * Meta/Ctrl+Enter remains reserved host submission. */
    handleKeyDown?(key: PluginQuestionEditorKey): "handled" | "pass";
    appendTranscript?(text: string): void | Promise<void>;
    dispose(): void;
}
export interface PluginQuestionRenderer<Q = JsonValue, A = JsonValue> {
    id: string;
    supportedContractVersions: number[];
    mountQuestion?(container: HTMLElement, context: PluginQuestionMountContext<Q>): void | PluginCleanup | Promise<void | PluginCleanup>;
    mountAnswerEditor(container: HTMLElement, context: PluginQuestionEditorProps<Q>): PluginQuestionEditorHandle | Promise<PluginQuestionEditorHandle>;
    mountAnswered?(container: HTMLElement, context: PluginQuestionMountContext<Q> & {
        readonly answer: A;
        readonly grading?: PluginQuestionGradingOutcome;
        readonly headerContainer?: HTMLElement;
        readonly footerContainer?: HTMLElement;
    }): void | PluginCleanup | Promise<void | PluginCleanup>;
}
export interface PluginQuestionOccurrence {
    messageId: string;
    contentIndex: number;
    toolCallId: string;
    toolName: string;
}
/** Visibility only: an unsuccessful attempt never grants pending authority. */
export interface PluginQuestionAttempt {
    protocolVersion: 1 | 2;
    /** Protocol v2 freezes grading at pose time; historical v1 omits this field. */
    requiresGrading?: true;
    pluginId: string;
    typeId: string;
    label: string;
    variant: PluginQuestionVariant;
}
export interface PluginQuestionSnapshot extends PluginQuestionAttempt {
    questionId: string;
    occurrence: PluginQuestionOccurrence;
    contractVersion: number;
    input: PluginQuestionInput;
    questionSchema: TSchema;
    answerSchema: TSchema;
    showThinking: boolean;
    requiresAnswerRefinement: boolean;
}
export type PluginQuestionOccurrenceMap = Record<string, PluginQuestionAttempt | PluginQuestionSnapshot>;
export interface PluginQuestionAnswer {
    kind: "plugin-question";
    questionId: string;
    pluginId: string;
    typeId: string;
    contractVersion: number;
    answer: JsonValue;
    grading?: PluginQuestionGradingOutcome;
    thinking?: string;
    readingThinking?: string;
    images?: PluginSubmissionImages;
    answeredAt: string;
}
/** Unreadable annotations remain classified as questions: never expose raw input. */
export type PluginQuestionAnnotationRead = {
    status: "absent";
} | {
    status: "attempt";
    attempt: PluginQuestionAttempt;
} | {
    status: "posed";
    snapshot: PluginQuestionSnapshot;
} | {
    status: "unreadable";
    identity?: {
        questionId: string;
        occurrence: PluginQuestionOccurrence;
        pluginId: string;
        typeId: string;
        contractVersion: number;
    };
    /** Only available after matching a supplied canonical native occurrence. */
    binding?: {
        occurrence: PluginQuestionOccurrence;
        questionId?: string;
    };
};
export type PluginQuestionValidationResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    problems: string[];
};
export interface PluginQuestionCancellation {
    kind: "plugin-question-cancelled";
    /** Omitted only when the question is unreadable: explicit dismissal or protocol cancellation, with an exact occurrence binding. */
    questionId?: string;
    occurrence: PluginQuestionOccurrence;
    reason: "dismissed" | "incompatible" | "unreadable-protocol";
}
export declare function preparePluginQuestionType<Q extends TSchema, A extends TSchema>(definition: PluginQuestionTypeDefinition<Q, A>): PluginQuestionTypeDefinition<Q, A>;
export declare function createPluginQuestionParameters(definition: PluginQuestionTypeDefinition, variant: PluginQuestionVariant): TSchema;
export declare function validatePluginQuestionInput(definition: PluginQuestionTypeDefinition, context: {
    chatId: string;
    variant: PluginQuestionVariant;
    input: unknown;
}): PluginQuestionValidationResult<PluginQuestionInput>;
export declare function validatePluginQuestionAnswer(snapshot: PluginQuestionSnapshot, context: {
    chatId: string;
    answer: unknown;
}, definition?: PluginQuestionTypeDefinition): PluginQuestionValidationResult<JsonValue>;
export declare function readPluginQuestionAnnotation(value: unknown, expectedOccurrence?: PluginQuestionOccurrence): PluginQuestionAnnotationRead;
export declare function readPluginQuestionMessageAnnotation(message: unknown, contentIndex: number): PluginQuestionAnnotationRead;
export declare function readPluginQuestionSnapshot(value: unknown, expectedOccurrence?: PluginQuestionOccurrence): PluginQuestionSnapshot | null;
export declare function readPluginQuestionAnswer(value: unknown, snapshot?: PluginQuestionSnapshot): PluginQuestionAnswer | null;
export declare function readPluginQuestionCancellation(value: unknown, snapshot?: PluginQuestionSnapshot): PluginQuestionCancellation | null;
export declare function pluginQuestionOccurrenceKey(occurrence: PluginQuestionOccurrence): string;
export declare function samePluginQuestionOccurrence(left: PluginQuestionOccurrence, right: PluginQuestionOccurrence): boolean;
/** Copy only finite JSON, without invoking getters, toJSON, or coercion. */
export declare function clonePluginQuestionJson(value: unknown): JsonValue;
export declare function isPluginQuestionJson(value: unknown): value is JsonValue;
/** Freeze owned copies, never plugin-owned input objects. */
export declare function freezePluginQuestionValue<T>(value: T): T;
export declare function preparePluginQuestionSchema(schema: unknown): TSchema;
