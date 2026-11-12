import type { TSchema } from "typebox";
import type { PluginInferenceOptions } from "./plugins.ts";
/** Preserve native schema objects/extensions; reject obvious malformed known
 * shapes, then compile exactly as the SDK does. Literal/annotation DATA (const,
 * enum members, default, examples, unknown extensions) is never schema-walked. */
export declare function validatePluginSchema(schema: unknown): import("typebox/compile").Validator<{}, TSchema, unknown, unknown>;
export declare function preparePluginSchema(schema: unknown): void;
export declare function checkPluginSchema(schema: unknown, value: unknown): boolean;
export declare function validatePluginInferenceOptions(value: PluginInferenceOptions | undefined): PluginInferenceOptions;
