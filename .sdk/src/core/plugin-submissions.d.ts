/** Browser-safe learner submission contracts and immutable preparation boundaries. */
import type { ImageContent } from "@earendil-works/pi-ai";
import type { LhMessage } from "./native-messages.ts";
import type { PluginQuestionOccurrence, PluginQuestionSnapshot } from "./plugin-questions.ts";
import type { PluginProblemSnapshot } from "./plugin-problems.ts";
import type { AnswerRequest, ClientQuestion, QuestionData, QuizQuestionType } from "./question-core.ts";
import type { PluginSurfaceTarget } from "./plugin-ui.ts";
type Immutable<T> = T extends (...args: never[]) => unknown ? T : T extends object ? {
    readonly [K in keyof T]: Immutable<T[K]>;
} : T;
type ImmutableJson = null | boolean | number | string | ImmutableJsonArray | ImmutableJsonObject;
interface ImmutableJsonArray extends ReadonlyArray<ImmutableJson> {
}
interface ImmutableJsonObject {
    readonly [key: string]: ImmutableJson;
}
/** Exact native tool occurrence, never merely a potentially reused tool-call ID. */
export type PluginSubmissionOccurrence = Readonly<PluginQuestionOccurrence>;
export type PluginSubmissionChannel = "content" | "answer" | "submission" | "thinking" | "readingThinking";
export interface PluginSubmissionContent {
    readonly text: string;
    readonly images: readonly Readonly<ImageContent>[];
}
/** Optional native image channels alongside the existing text authorities. */
export interface PluginSubmissionImages {
    readonly answer?: readonly Readonly<ImageContent>[];
    readonly thinking?: readonly Readonly<ImageContent>[];
    readonly readingThinking?: readonly Readonly<ImageContent>[];
}
export interface PluginProblemSubmissionImages {
    readonly submission?: readonly Readonly<ImageContent>[];
    readonly thinking?: readonly Readonly<ImageContent>[];
}
export interface PluginBuiltinSubmissionAnswer {
    readonly dontKnow?: boolean;
    readonly values?: readonly string[];
    readonly other?: string;
    readonly text?: string;
    readonly confidence?: number;
    readonly images: readonly Readonly<ImageContent>[];
}
export type PluginSubmission = {
    readonly type: "text";
    readonly content: PluginSubmissionContent;
} | {
    readonly type: "thinking";
    readonly content: PluginSubmissionContent;
} | {
    readonly type: "answer";
    readonly answer: PluginBuiltinSubmissionAnswer;
    readonly thinking: PluginSubmissionContent;
    readonly readingThinking: PluginSubmissionContent;
} | {
    readonly type: "plugin-problem-submission";
    readonly submission: ImmutableJson;
    readonly submissionImages: readonly Readonly<ImageContent>[];
    readonly thinking: PluginSubmissionContent;
} | {
    readonly type: "plugin-question-answer";
    readonly answer: ImmutableJson;
    readonly answerImages: readonly Readonly<ImageContent>[];
    readonly thinking: PluginSubmissionContent;
    readonly readingThinking: PluginSubmissionContent;
};
type SubmissionTargetBase = {
    readonly sessionId: string;
    readonly sessionKind: "teaching" | "practice";
    readonly surfaceTarget: PluginSurfaceTarget;
};
export type PluginSubmissionTarget = SubmissionTargetBase & ({
    readonly type: "text";
    readonly channels: readonly ["content"];
} | {
    readonly type: "thinking";
    readonly channels: readonly ["content"];
    readonly problem: {
        readonly occurrence: PluginSubmissionOccurrence;
        readonly statement: string;
    };
} | {
    readonly type: "answer";
    readonly channels: readonly PluginSubmissionChannel[];
    readonly question: Immutable<ClientQuestion & {
        occurrence: PluginSubmissionOccurrence;
        questionType?: QuizQuestionType;
    }>;
} | {
    readonly type: "plugin-problem-submission";
    readonly channels: readonly ["submission", "thinking"];
    readonly problem: Immutable<Pick<PluginProblemSnapshot, "problemId" | "pluginId" | "typeId" | "contractVersion" | "label"> & {
        occurrence: PluginSubmissionOccurrence;
        statement: string;
    }>;
} | {
    readonly type: "plugin-question-answer";
    readonly channels: readonly PluginSubmissionChannel[];
    readonly question: Immutable<Pick<PluginQuestionSnapshot, "questionId" | "occurrence" | "pluginId" | "typeId" | "contractVersion" | "label" | "variant" | "showThinking">>;
});
export type PluginSubmissionContext = PluginSubmissionTarget & {
    /** Detached current browser history, including potentially streamed content. */
    readonly messages: readonly Immutable<LhMessage>[];
    readonly signal: AbortSignal;
    /** Live, best-effort acknowledgment notification; not a durable event. */
    onAccepted(callback: () => void | Promise<void>): void;
};
export interface PluginSubmissionInterceptor {
    id: string;
    priority?: number;
    hasPendingInput?(target: PluginSubmissionTarget): boolean;
    intercept(input: PluginSubmission, context: PluginSubmissionContext): PluginSubmission | null | void | Promise<PluginSubmission | null | void>;
}
/** Structural browser validation only. Byte sniffing/normalization belongs to server admission. */
export declare function preparePluginSubmissionImage(value: unknown): Readonly<ImageContent>;
/** Detached transport array; structural validation only, with server byte processing still required. */
export declare function validatePluginSubmissionImageArray(value: unknown): ImageContent[];
export declare function validatePluginSubmissionImages(value: unknown): PluginSubmissionImages;
/** Validate optional transport channels and omit empty image arrays on write. */
export declare function preparePluginSubmissionImages(value: unknown): PluginSubmissionImages;
export declare function preparePluginProblemSubmissionImages(value: unknown): PluginProblemSubmissionImages;
/** Strictly detach and freeze each hook's output; identity can never be returned as input. */
export declare function preparePluginSubmission(input: unknown, target: PluginSubmissionTarget): PluginSubmission;
/** Validate raw fields against the private rendered question; buildAnswer remains the only grader. */
export declare function validatePluginBuiltinSubmissionAnswer(question: QuestionData, answer: PluginBuiltinSubmissionAnswer): AnswerRequest;
/** Capture validated callbacks and priority without freezing a plugin-owned definition. */
export declare function preparePluginSubmissionInterceptor(definition: PluginSubmissionInterceptor): Readonly<PluginSubmissionInterceptor>;
export declare function comparePluginSubmissionInterceptors(left: {
    pluginId: string;
    definition: PluginSubmissionInterceptor;
}, right: {
    pluginId: string;
    definition: PluginSubmissionInterceptor;
}): number;
/** Preserve the opaque host reference, never clone/freeze the target token itself. */
export declare function copyPluginSubmissionTarget(target: PluginSubmissionTarget): PluginSubmissionTarget;
/** Current native history is host-owned and may contain explicit undefined fields. */
export declare function copyPluginSubmissionHistory(messages: readonly LhMessage[]): PluginSubmissionContext["messages"];
export {};
