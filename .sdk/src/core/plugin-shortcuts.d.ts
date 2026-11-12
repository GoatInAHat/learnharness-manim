/** Declarative action shortcuts and deterministic, browser-safe resolution. */
export interface PluginShortcutViewScope {
    readonly sessions?: readonly ("teaching" | "practice")[];
    /** View IDs always belong to the registering plugin. */
    readonly views?: readonly string[];
}
export interface PluginActionShortcut {
    readonly scope: "app" | PluginShortcutViewScope;
    /** Canonical host spelling, e.g. mod+shift+d. Omit for initially unbound. */
    readonly defaultBinding?: string;
}
export interface PluginShortcutCandidate {
    id: `plugin:${string}:${string}`;
    pluginId: string;
    actionId: string;
    pluginName: string;
    name: string;
    shortcut: PluginActionShortcut;
}
export interface ResolvedPluginShortcut extends PluginShortcutCandidate {
    binding: string;
    source: "user" | "default";
    status: "active" | "unbound" | "conflict" | "invalid";
    reason?: string;
}
export declare function pluginShortcutId(pluginId: string, actionId: string): PluginShortcutCandidate["id"];
export declare function isPluginShortcutBinding(binding: unknown): binding is string;
export declare function preparePluginShortcut(value: unknown): PluginActionShortcut;
export declare function pluginShortcutScopesOverlap(a: PluginShortcutCandidate, b: PluginShortcutCandidate): boolean;
export declare function pluginShortcutMatches(candidate: PluginShortcutCandidate, context: {
    surface: "session";
    kind: "teaching" | "practice";
} | {
    surface: "plugin-view";
    pluginId: string;
    viewId: string;
} | {
    surface: "app";
}): boolean;
export declare function resolvePluginShortcuts(candidates: readonly PluginShortcutCandidate[], overrides: Readonly<Record<string, unknown>>, core: ReadonlyMap<string, string>): ResolvedPluginShortcut[];
