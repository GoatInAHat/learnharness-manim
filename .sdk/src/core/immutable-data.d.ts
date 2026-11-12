/** Detach host history at ingress, preserving undefined, sparse/malformed data
 * and TypeBox metadata for the existing parsers to judge. Never invoke getters
 * or freeze a caller's objects. Already owned subtrees retain their identity. */
export declare function copyImmutableData<T>(value: T): T;
/** Internal identity cache for reads of host-owned immutable data. One context
 * per weak key, with no strong history retention, global content keys or capacity
 * policy. Unowned inputs/contexts always take the original validation path. */
export declare class ImmutableReadCache<T> {
    private entries;
    read(input: unknown, context: unknown, compute: () => T): T;
    seed(input: object, context: unknown, value: T): void;
}
