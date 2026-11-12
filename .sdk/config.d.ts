/** Repository root (this file is at <root>/config.ts). */
export declare const ROOT: string;
export declare const PATHS: {
    readonly root: string;
    /** Teacher system prompt — the agent's instructions (src/agent/). */
    readonly teacherPrompt: string;
    readonly data: string;
    /** Chat sessions (AI SDK UIMessage transcripts, one JSON file per chat). */
    readonly chats: string;
    readonly graph: string;
    /** Debug artifacts (env-gated): data/debug/provider-events/<chatId>.jsonl
     * raw provider stream recordings (src/agent/provider-events.ts). */
    readonly debug: string;
};
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
/** Every agent role in the app. The conversation pair (prober/teacher)
 *  resolves chat.model → strong slot; background roles resolve their own
 *  override → tier slot (core/settings-resolution.ts ROLE_SLOT). */
export type ModelRole = "prober" | "teacher" | "researcher" | "demoBuilder" | "visualMaker" | "pdfReader" | "extractor" | "auditor" | "sideQuestion";
/**
 * The LIVE graph store (src/store/graph.ts) — owned by the app's extraction
 * pipeline. Line shapes: src/core/contracts.ts. CHAINS ARE THE STORED
 * TRUTH (owner, 2026-09-30): edges are a derived view, never stored.
 */
export declare const LEDGER_FILES: {
    readonly nodes: string;
    readonly chains: string;
    readonly sessions: string;
    /** Per-message extraction coverage (contracts/graph.ts CoverageEntry;
     *  the checkpoint's replacement for chat extractions — notes keep
     *  sessions.jsonl, whole-file as they are). */
    readonly coverage: string;
};
/**
 * Notes-import bookkeeping (NOT a ledger): one JSON map, src-id → NotesSource
 * record (contracts/graph.ts) — the file path + import time + the run's usage
 * log. Read-modify-write like a chat file, not append-only like the ledgers.
 */
export declare const SOURCES_FILE: string;
/** Presentation-only source names/folder placement; never extraction identity. */
export declare const SOURCE_ORGANIZATION_FILE: string;
/** The layout ledger (read-modify-write like sources.json): nodeId →
 *  {x,y} resting positions from the incremental settle (core/layout.ts).
 *  Carries an updatedAt stamp for future live-physics conflict handling. */
export declare const POSITIONS_FILE: string;
/**
 * Graph render settings (the settings-panel controls): one small JSON blob,
 * read-modify-write. Shared shape/sanitizer: src/core/render-settings.ts.
 */
export declare const RENDER_SETTINGS_FILE: string;
/** The graph-family FORMAT STAMP sidecar (schema-versioning wave,
 *  2026-10-10): one version for the whole family — the four JSONL ledgers,
 *  sources.json, render-settings.json. LAZY v1: absent = v1; the first
 *  graph-family write creates it. positions.json is REBUILDABLE and rides
 *  along unversioned by design (owner ruling). */
export declare const GRAPH_FORMAT_FILE: string;
/**
 * THE USER SETTINGS RECORD (settings-storage wave, 2026-09-19): one
 * versioned, DELTA-shaped JSON blob at the data-dir seam holding every
 * non-secret product preference — general, agent (background
 * model/thinking overrides + tool toggles + prompt-override switches),
 * appearance, graph. Explicit user choices only: ABSENT keys resolve to the
 * factory defaults compiled into src/core/settings.ts (FACTORY_SETTINGS), so
 * a software update that adds a knob (new tool, new role, new appearance
 * field) needs no migration — old records simply lack the new keys. The
 * version field is a PRIVATE schema counter for breaking shape changes
 * only (field renamed/meaning changed), unrelated to the app release
 * version. Secrets (API keys, login tokens) NEVER live here — auth.json /
 * .env.local keep that role. (The `chat` default-settings section died
 * with per-session models, owner 2026-09-28 — sessions own their model
 * from birth, stamped from the strong slot.)
 */
export declare const SETTINGS_FILE: string;
/**
 * User prompt-override files (settings-storage wave, 2026-09-19): the
 * per-segment system-prompt overrides mirroring the SOURCE layout
 * (src/agent/prompts/) — the shared base as prompts/system-prompt.md,
 * fragments as prompts/teacher/<file> / prompts/prober/<file>. File
 * PRESENCE alone is not the override: settings.json's agent.prompts map
 * (segmentPath → boolean) is the explicit switch, so a user can keep a
 * customized file on disk but run the source default to compare. The
 * segment list itself is ALWAYS derived from source at runtime (the
 * loader in src/store/prompt-overrides.ts) — code updates that add,
 * remove, or reorder fragments adapt automatically; an override keyed to
 * a vanished segment stops composing but stays on disk.
 */
export declare const PROMPTS_OVERRIDE_DIR: string;
/**
 * Imported custom themes (theme wave, 2026-11-04): one `<id>.json` per
 * theme (core/themes.ts ThemeFile shape), written by POST /api/themes and
 * listed beside the built-in presets. The settings record names the
 * active one by id (appearance.theme).
 */
export declare const THEMES_DIR: string;
/**
 * THE AUTH/KEY STORE (auth-keys wave, 2026-09-19): BYOK provider keys in a
 * flat {VAR: value} JSON map — the SAME file the Electron app has always
 * hand-edited (owner decision: option A, zero migration). Desktop main.cjs
 * passes LH_AUTH_FILE pointing at userData/auth.json (mode 0600); in dev
 * (no Electron) the default is the repo-root auth.json (gitignored, same
 * pattern as .env.local — a worktree may symlink it to the master copy).
 * The SERVER reads/writes this file directly at call time (no restart to
 * change a key); it reflects the values into process.env at boot with
 * FILL-GAP precedence — real environment variables (incl. .env.local in
 * dev) always win (src/server/keys.ts). Hand-edits still work: the file is
 * re-read from disk on every API access. Secrets NEVER go in settings.json
 * — this file keeps that role, alongside .env.local.
 */
export declare const AUTH_FILE: string;
