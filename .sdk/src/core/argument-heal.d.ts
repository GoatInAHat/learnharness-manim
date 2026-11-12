/**
 * THE WEAK-MODEL ARGUMENT HEAL — the pure core (owner, 2026-10-09 —
 * generalize the 2026-10-04 practice heal; see agent/tools/heal.ts for
 * the registry-wide wiring story). Lives in core because BOTH seams need
 * it (the tool-parts law: display parses mirror boundary coercion or a
 * healed-at-boundary call whose record keeps the RAW arguments renders
 * as an invisible pending quiz):
 *
 *   - the agent boundary: pi's prepareArguments seam, BEFORE TypeBox
 *     validation (withArgumentHeal / healToolRecord);
 *   - the display parse: tool-parts' parseQuizInput, before
 *     boundaryParse — the persisted record keeps raw arguments, so the
 *     same wobble heals on read.
 *
 * Born of the GLM incident (owner, 2026-10-04): 19 consecutive rejected
 * `problem` calls, every one carrying `"mode": "\"recall\""` — a
 * JSON-string-encoded enum — while TypeBox's error text `must be equal
 * to constant` never named the expected values, so the model re-emitted
 * the identical payload each time; the 2026-10-09 whitehead session ran
 * the same loop on quiz `type` for ten turns. A STRING value where the
 * schema expects a literal union / boolean / null / number / array is
 * JSON.parse-d and kept when the parsed value satisfies the expectation.
 * Well-formed args pass through UNTOUCHED (same reference); unhealable
 * values stay for validation to reject honestly.
 */
/** One property schema of a TypeBox object (the shapes this fork emits:
 * literal unions carry anyOf[{const}], scalars carry type). */
type PropSchema = {
    type?: string;
    const?: unknown;
    anyOf?: PropSchema[];
};
export declare function healEncodedArguments(args: unknown, schema: {
    properties?: Record<string, PropSchema>;
}): unknown;
export {};
