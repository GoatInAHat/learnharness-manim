/**
 * THEMES (theme wave, 2026-11-04): the color vocabulary the user picks,
 * imports and exports, and its translation into the shadcn tokens the
 * components already consume. Pure and browser-safe: the layout (first
 * paint), the provider, the Settings section and the themes API share it.
 *
 * A theme is 12 hex colors plus the variant it renders as (dark/light).
 * Built-in presets live here; custom ones are JSON files under
 * config.THEMES_DIR (the ThemeStore port). The settings record names the
 * active theme by id and carries per-color OVERRIDES that survive every
 * theme switch (owner ruling: losing user config is worse than an odd
 * combination).
 */
import type { AppearanceSettings } from "./settings.ts";
/** The variant on screen: the `dark`/`light` class on <html>. */
export type ThemeMode = "dark" | "light";
/** Kept for the mode-aware renderers (graph canvas, mermaid). */
export type RenderedMode = ThemeMode;
/** The 12 theme colors, in the order the Settings grid shows them. */
export declare const THEME_COLOR_KEYS: readonly ["background", "accent", "surface", "bold", "border", "italic", "text", "code", "textMuted", "error", "success", "warning"];
/** One of the twelve theme colors. */
export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];
/** A full palette: every key, each a #hex. */
export type ThemeColors = Record<ThemeColorKey, string>;
/** The keys whose override lives in `appearance.colors` — the other three
 *  keep their pre-theme homes (`background`, `mdRendering.boldColor` and
 *  `mdRendering.italicColor`). */
export declare const COLOR_OVERRIDE_KEYS: readonly ["surface", "border", "text", "textMuted", "accent", "code", "error", "success", "warning"];
/** A key whose override lives in `appearance.colors`. */
export type ColorOverrideKey = (typeof COLOR_OVERRIDE_KEYS)[number];
/** `appearance.colors`: hex wins over the theme; null/absent = the theme's color. */
export type AppearanceColorOverrides = Partial<Record<ColorOverrideKey, string | null>>;
/** The file / JSON shape (import and export). */
export interface ThemeFile {
    name: string;
    mode: ThemeMode;
    colors: ThemeColors;
}
/** A theme in the catalog: a preset (`builtin`) or an imported file,
 *  addressed by its slug id. */
export interface Theme extends ThemeFile {
    id: string;
    builtin: boolean;
}
/** The theme a record without `appearance.theme` renders. */
export declare const DEFAULT_THEME_ID = "default";
/** Validate an imported theme: `{ ok: false, error }` names the first bad
 *  field so the import card can say what is wrong. Unknown keys drop. */
export declare function parseThemeFile(raw: unknown): {
    ok: true;
    theme: ThemeFile;
} | {
    ok: false;
    error: string;
};
/** The sanitizer form: the theme, or null when anything is off. */
export declare function sanitizeThemeFile(raw: unknown): ThemeFile | null;
/** "Rosé Pine Moon" → "rose-pine-moon". Empty when nothing survives. */
export declare function themeIdFromName(name: string): string;
/** Valid theme ids: the slug grammar themeIdFromName produces. */
export declare function isThemeId(value: unknown): value is string;
/** The presets, in grid order. Default = the app's original dark palette
 *  (app/globals.css carries it as literals; tests pin the two equal).
 *  Catppuccin: base/surface0/surface1, mauve accent, lavender/pink/peach
 *  emphasis; Latte takes mantle/surface0 instead, because surface0 on a
 *  light page reads as a heavy gray slab, and Frappé's bold is flamingo
 *  (owner, 2026-11-04).
 *  Rosé Pine: base/surface/highlight-med, iris accent, iris/rose/gold
 *  emphasis. Gruvbox Dark: medium (bg0/bg0_s/bg2) with the bright
 *  accents; orange accent, blue/purple/aqua emphasis. Ivory: warm ivory
 *  page, terracotta accent, blue/green/clay emphasis. Pastel: a gray-cream
 *  page with soft green, purple and orange inks. NvChad Onedark: base46's
 *  onedark. */
export declare const BUILTIN_THEMES: readonly Theme[];
/** The app's original dark palette, and the fallback for a missing id. */
export declare const DEFAULT_THEME: Theme;
/** Preset ids are reserved: imports never take them, DELETE refuses them. */
export declare function isBuiltinThemeId(id: string): boolean;
/** The active theme: the record's id among builtins and customs, or
 *  Default when the id is absent or its file is gone. */
export declare function resolveTheme(id: string | null | undefined, customs?: readonly Theme[]): Theme;
/** The single place the two override homes merge onto the theme: the
 *  legacy keys (`background`, `mdRendering.boldColor/italicColor`) and
 *  `colors`. A null/absent override = the theme's color. */
export declare function effectiveColors(theme: ThemeFile, appearance: AppearanceSettings | undefined): ThemeColors;
/** Shift every channel by `add`, clamped to 0–255 (always #rrggbb out). */
export declare function shiftHex(hex: string, add: number): string;
/** THE adapter: 12 theme colors → the CSS variables set on <html>.
 *  `--accent` stays the shadcn HOVER surface (derived from `surface`, so
 *  hovers never turn the highlight color); the theme's accent is
 *  `--lh-accent` (ring, toggles, the selected theme card). */
export declare function themeVars(c: ThemeColors, mode: ThemeMode): Record<string, string>;
/** Export: the active theme with every override applied — importing the
 *  file back reproduces exactly what is on screen. */
export declare function exportThemeFile(theme: ThemeFile, appearance: AppearanceSettings | undefined): ThemeFile;
