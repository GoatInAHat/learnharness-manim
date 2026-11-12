/**
 * THE USER SETTINGS RECORD's shape + sanitizer (settings-storage wave,
 * 2026-09-19): one versioned, DELTA-shaped record at the data-dir seam
 * (config.SETTINGS_FILE) holding every non-secret product preference.
 *
 * DELTA SEMANTICS (owner decision, 2026-09-19): the record stores EXPLICIT
 * user choices only — ABSENT keys resolve to the factory defaults compiled
 * into this module (FACTORY_SETTINGS). MODELS are the exception (owner,
 * 2026-09-22 — BYOK all the way down): no factory pins exist, so an absent
 * model key resolves to EMPTY and the per-need gates refuse honestly. A
 * software update that ADDS a knob (new
 * tool, new role, new appearance field) therefore needs no migration: old
 * records simply lack the new keys. `version` is a PRIVATE schema counter
 * for BREAKING shape changes only (field renamed / meaning changed) —
 * unrelated to the app release version. Migrations live in the adapter
 * (src/store/settings.ts), not here.
 *
 * Sanitizer contract (mirrors render-settings.ts discipline): whatever
 * arrives from disk or the network passes through sanitizeUserSettings
 * before use — never trusted raw. Strict on known fields, PRESERVES
 * unknown keys verbatim (a newer record must never be destroyed by an
 * older app reading it). Invalid known values degrade gracefully:
 * out-of-range numbers CLAMP, wrong-typed/invalid fields DROP (resolve to
 * factory default), never throw. File-access policy is the exception:
 * malformed policy stays restricted/empty, never default-unrestricted.
 *
 * Browser-safe: pure logic + types only, no node imports. The resolved
 * (fully concrete) view lives in settings-resolution.ts.
 */
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { CacheRetention } from "@earendil-works/pi-ai";
import type { ModelRole } from "../../config.ts";
import { type SearchEngineId } from "./search.ts";
import { type DictationLanguage } from "./dictation.ts";
import { type FileAccessSettings } from "./file-access.ts";
import { type AppearanceColorOverrides } from "./themes.ts";
/** The schema version this code understands. Bump ONLY for breaking shape
 *  changes (a field renamed/meaning changed); pure additions never bump. */
export declare const CURRENT_SETTINGS_VERSION = 1;
/** The background-agent roles whose models the Agent settings expose.
 *  The conversation pair (prober/teacher) stays out — chat-controlled via
 *  the strong slot (one controller, the model picker). Tests pin the set. */
export declare const BACKGROUND_MODEL_ROLES: readonly ["researcher", "demoBuilder", "visualMaker", "extractor", "auditor", "sideQuestion"];
export type BackgroundModelRole = (typeof BACKGROUND_MODEL_ROLES)[number];
/** A per-role model/thinking override — every field independent (absent
 *  field = that aspect falls back to config.ts's pin for the role). */
export interface RoleModelOverride {
    /** The model swap: both coordinates or neither (mirrors ChatSettings.model). */
    model?: {
        provider: string;
        id: string;
    };
    /** The thinking budget swap. */
    thinkingLevel?: ThinkingLevel;
}
/** The capability tiers a user can pin models into (owner-settled mapping):
 *  strong = prober + teacher (also the per-session default-teacher
 *  starting point); cheap = researcher, demo-builder, extractor, auditor,
; vision = visual-maker + pdf-reader. Resolution per role:
 *  ROLE OVERRIDE → slot → factory pin. */
export declare const MODEL_SLOTS: readonly ["strong", "cheap", "vision"];
export type ModelSlotName = (typeof MODEL_SLOTS)[number];
/** The DEFAULT thinking level for UNSET levels only (owner, 2026-09-22):
 *  a slot/override/chat that names a model but no thinking level resolves
 *  to the FIRST entry in this order that the model supports
 *  (getSupportedThinkingLevels); a non-reasoning model resolves "off"
 *  regardless (pi reports exactly ["off"]). EXPLICITLY set levels never
 *  consult this list — they clamp nearest via pi's native
 *  clampThinkingLevel on model switches.
 *
 *  Client surface (interlude, 2026-09-22): this constant lives in the CORE
 *  BARREL — the UI imports it to auto-populate a thinking level on a FRESH
 *  model pick (one source of truth, AUTH_KEYS precedent; per-model
 *  supportedLevels already reach the client via the catalog). The ordering
 *  has NO other client role: legacy unset records keep the runtime
 *  defaultThinkingLevel fallback at engine build. */
export declare const DEFAULT_THINKING_ORDER: readonly ["medium", "low", "high", "minimal", "xhigh", "max"];
/** The machine-readable NOT-CONFIGURED refusal envelope (owner, 2026-09-22):
 *  every per-need gate — the turn gate in chat-handler, a job spawn, a
 *  notes import — refuses with this exact shape. HTTP callers get 503 +
 *  this JSON; in-band consumers (the job record's error field) carry the
 *  human `error` line. `missing` names the slot TIER(S) the refused
 *  action needs and found unset. */
export declare const MODELS_NOT_CONFIGURED_CODE: "models_not_configured";
export interface ModelsNotConfigured {
    /** Human-readable — safe to render as-is. */
    error: string;
    /** The machine discriminator the client switches on. */
    code: typeof MODELS_NOT_CONFIGURED_CODE;
    /** Which slot tiers the refused action needs ("strong" | "cheap" | "vision"). */
    missing: ModelSlotName[];
}
export declare function modelsNotConfigured(missing: ModelSlotName[]): ModelsNotConfigured;
/** The refusal error text (BYOK, 2026-09-22): job/turn surfaces compose the
 *  record wording around this prefix; UI consumers detect refused work by
 *  it (info tone, not scary-error) — the envelope's home module owns the
 *  string so the writer and the matcher can never drift. */
export declare function isModelsRefusal(error: string | undefined): boolean;
/** The typed throw for in-process seams (extraction pipeline): callers
 *  catch it to skip honestly (trigger) or surface the 503 envelope
 *  (routes) instead of logging a failure. */
export declare class ModelsNotConfiguredError extends Error {
    readonly envelope: ModelsNotConfigured;
    constructor(missing: ModelSlotName[]);
}
/** The key-presence refusal (provider-key interlude, owner, 2026-09-25):
 * a PINNED model is not enough — its provider's key must be present, or
 * the action dies mid-stream masked to a generic error. Same envelope
 * family as modelsNotConfigured: HTTP callers get 503 + this JSON;
 * in-band consumers (the job record's error field) carry the human
 * `error` line. `provider` names whose key is gone; `slots` names the
 * slot tier(s) the refused action resolves to that provider. */
export declare const PROVIDER_KEY_MISSING_CODE: "provider_key_missing";
export interface ProviderKeyMissing {
    /** Human-readable — safe to render as-is. */
    error: string;
    /** The machine discriminator the client switches on. */
    code: typeof PROVIDER_KEY_MISSING_CODE;
    /** The provider whose key is gone, e.g. "openrouter". */
    provider: string;
    /** Which slot tiers the refused action resolves to that provider. */
    slots: ModelSlotName[];
}
export declare function providerKeyMissing(provider: string, slots: ModelSlotName[]): ProviderKeyMissing;
/** The refusal error text (same discipline as isModelsRefusal): UI
 * consumers detect key-refused work by the wording (info tone, not
 * scary-error) — the envelope's home module owns the string so the
 * writer and the matcher can never drift. */
export declare function isProviderKeyRefusal(error: string | undefined): boolean;
/** The typed throw for in-process seams (extraction pipeline) — the
 * ProviderKeyMissing sibling of ModelsNotConfiguredError: callers catch
 * it to skip honestly (trigger) or surface the 503 envelope (routes). */
export declare class ProviderKeyMissingError extends Error {
    readonly envelope: ProviderKeyMissing;
    constructor(provider: string, slots: ModelSlotName[]);
}
export declare const CACHE_RETENTIONS: readonly ["none", "short", "long"];
/** Stored model-slot preferences. A slot is configured only when model is
 * present; sanitized level-only records can be retained but resolve as unset.
 * A thinking level alone does not select an implicit fallback model. */
export interface ModelSlot {
    /** Native Pi preference. Absent leaves Pi/environment behavior unchanged. */
    cacheRetention?: CacheRetention;
    /** Configured model coordinates; provider and id must be supplied together. */
    model?: {
        provider: string;
        id: string;
    };
    /** Optional thinking level used with this slot's configured model. */
    thinkingLevel?: ThinkingLevel;
}
/** The `models` settings section (owner decision 2026-09-20: a dedicated
 *  section — slots are engine-level choices, not one session's). All slots
 *  optional: an absent slot means every role of its tier runs whatever the
 *  deeper tiers of the chain resolve to (per-role override → factory pin). */
export interface ModelsSettings {
    strong?: ModelSlot;
    cheap?: ModelSlot;
    vision?: ModelSlot;
}
/** Budget fallbacks only; custom endpoint pricing is unknown. */
export declare const CUSTOM_MODEL_DEFAULT_CONTEXT_WINDOW = 8192;
export declare const CUSTOM_MODEL_DEFAULT_MAX_TOKENS = 4096;
/** Custom budgets accept every positive integer, including small output caps. */
export declare const CUSTOM_MODEL_PIN_FLOOR = 1;
/** One discovered custom model. `image`/`reasoning`/`context`/`maxTokens` are
 *  detected from the endpoint's /models metadata; anything it omits falls back
 *  to a default. */
export interface CustomModel {
    id: string;
    /** Accepts image input (Vision-capable). Default false (text-only). */
    image?: boolean;
    /** Accepts a reasoning effort (thinking). Default false → the only
     *  thinking level is "off", exactly like a non-reasoning built-in. */
    reasoning?: boolean;
    /** Context window in tokens, from the endpoint. Absent → the default. */
    context?: number;
    /** Max output tokens, from the endpoint. Absent → the default. */
    maxTokens?: number;
}
/** A user pin for one custom model: it beats what the endpoint publishes
 *  (owner ruling — explicit user intent wins; a local server's number is
 *  often wrong or absent). Absent field = no pin. `reasoning` is tri-state:
 *  true declares reasoning support, false removes that declaration, absent
 *  uses discovery. This is NOT a backend execution/disable switch. */
export interface CustomModelOverride {
    context?: number;
    maxTokens?: number;
    reasoning?: boolean;
}
/** The single custom endpoint's stored config (delta section). */
export interface CustomProviderSettings {
    /** Server-owned random authorization nonce; never a credential hash. */
    credentialBindingId?: string;
    /** Explicit authentication intent; never inferred from a saved key. */
    authMode?: "keyless" | "apiKey";
    /** Normalized base URL (see normalizeBaseUrl). Empty/absent = not configured. */
    baseUrl?: string;
    /** Models this endpoint offers: advertised ids merged with the typed
     *  manual ones (rewritten on connect; a failed probe keeps the same
     *  endpoint's last snapshot). */
    models?: CustomModel[];
    /** User pins keyed by model id — pure user intent, never rewritten by
     *  discovery, pruned on connect to the ids that connect offers. */
    overrides?: Record<string, CustomModelOverride>;
    /** Model ids the user typed by hand, for an endpoint that publishes no
     *  usable /models list. Kept apart from the snapshot so a reconnect can
     *  re-merge them after discovery refreshes. */
    manualModels?: string[];
}
export declare function parseModelIds(raw: unknown): string[];
/** Canonical base-URL form (single source): trims, requires absolute http(s),
 *  drops trailing slashes. Returns "" for anything invalid ("not configured"). */
export declare function normalizeBaseUrl(raw: string): string;
/** THE single source of "is the custom endpoint usable?": a non-empty base URL.
 *  Key presence is deliberately excluded (keyless local servers are allowed). */
export declare function customProviderUsable(cp: CustomProviderSettings | undefined): cp is CustomProviderSettings & {
    baseUrl: string;
};
/** First-run gate (model-slots wave, owner 2026-09-20): the app refuses
 *  to start chats until the user has actively picked all three slots —
 *  there ARE no defaults for 33 providers; a configured app is one whose
 *  models section carries a model in every slot. Thinking levels stay
 *  optional (absent = the resolved tier's budget). */
export declare function slotsConfigured(models: ModelsSettings | undefined): boolean;
/** Which slot a role draws from (model slots wave, 2026-09-20). Includes the
 *  conversation pair and pdfReader (not BackgroundModelRoles — the slot
 *  tier spans every role; only background roles surface per-role overrides). */
export declare const ROLE_SLOT: Readonly<Record<ModelRole, ModelSlotName>>;
/** General settings — app-level behavior. Version DISPLAY and plans login
 *  live outside the record (package.json / auth.json) by owner decision. */
export interface GeneralSettings {
    /** Automatic startup/24h update checks (default ON). Manual checks bypass this. */
    autoUpdate?: boolean;
}
/** One app-wide dictation preference, shared by every composer. */
export interface DictationSettings {
    language?: DictationLanguage;
}
/** Agent settings — everything about the non-conversation machinery. */
export interface AgentSettings {
    /** Maximum simultaneous background-worker model requests (default 8).
     *  Direct conversations bypass this limit. Positive safe integers only:
     *  no arbitrary ceiling, rounding, or clamping. */
    workerRequestConcurrency?: number;
    /** Background-role model/thinking overrides (absent role = config pin). */
    models?: Partial<Record<BackgroundModelRole, RoleModelOverride>>;
    /** Tool toggles keyed by tool id (absent key = enabled). User-level
     *  only — no per-chat override (owner decision 2026-09-19). */
    tools?: Record<string, boolean>;
    /** Search-engine preference (search wave, 2026-09-20). OPTIONAL by
     *  owner decision: setting a key auto-activates its engine — the user
     *  never chooses an engine to make search work. An explicit choice only
     *  pins the preference (e.g. when BOTH keys are present); the chosen
     *  engine must still have its key, else search is honestly unavailable.
     *  Absent + no key = unavailable (no silent fallback, no default). */
    search?: {
        engine?: SearchEngineId;
    };
    /** Prober graph tools (wave 7, owner ruling 2026-09-23): read-only
     *  knowledge-graph views for the prober agent — a session list +
     *  per-session propositions with understanding levels. Its SUBJECT
     *  is the graph but its MECHANISM is agent capability (tool
     *  registration), so it lives here in its OWN subsection, not in the
     *  tool-toggles map. Absent = enabled (the toggle discipline); the
     *  effective gate composes graph.enabled AND this switch. */
    graphTools?: {
        enabled?: boolean;
    };
    /** System-prompt override SWITCHES keyed by segment path (absent key =
     *  off). Switch-on requires the override file to exist (enforced by the
     *  route); the switch is explicit so users keep a file on disk but run
     *  the source default to compare (owner decision 2026-09-19). */
    prompts?: Record<string, boolean>;
    /** Optional learner-source boundary, OFF when absent. ON with no folders
     *  refuses all learner-source reads. Paths are absolute or ~/ anchored;
     *  the current policy is read per new tool call/job start. Existing
     *  sensitive-location/credential denials always win, not a whole-data ban. */
    fileAccess?: FileAccessSettings;
}
/** Markdown-rendering knobs — the bare-bones set (owner decision). */
export interface MdRenderingSettings {
    /** Heading font weight (100–900, default 900). CSS resolves the nearest
     *  available weight of the chosen font — no font introspection needed. */
    headingWeight?: number;
    /** Color for **bold** spans (default #ffffff). */
    boldColor?: string | null;
    /** Color for *italic* spans (default #ffffff). */
    italicColor?: string | null;
}
/** Appearance settings — theme, color overrides, type, markdown emphasis. */
export interface AppearanceSettings {
    /** The active theme id (core/themes.ts presets or a custom file under
     *  THEMES_DIR). Absent or gone = "default". The theme declares the
     *  mode (dark/light) — the old `mode`/`lightBackground` keys are no
     *  longer read (theme wave, 2026-11-04). */
    theme?: string;
    /** The background override (null = the theme's). Kept at its pre-theme
     *  key so existing records keep their color. */
    background?: string | null;
    /** Per-color overrides on top of the theme (null/absent = the theme's).
     *  Preserved across theme switches. Bold/italic live in mdRendering. */
    colors?: AppearanceColorOverrides;
    /** The main reading font (everything that is Source Sans 3 today), by
     *  name — user-chosen from installed fonts. null = Source Sans 3. */
    fontFamily?: string | null;
    /** Reading font size in px (12–24, default 16). Headings render as
     *  multiples of this, so one knob scales the document coherently. */
    proseFontSize?: number;
    /** Permit normal font ligatures in code (including inline code and code editors). Default false; prose is unaffected. */
    codeLigatures?: boolean;
    /** Session names in CMU Serif (default true — today's look). */
    sessionNameSerif?: boolean;
    mdRendering?: MdRenderingSettings;
}
/** Knowledge-graph settings — a strict dependency ladder (owner decision
 *  2026-09-19): graph → embedding → clustering → labeling, each rung only
 *  meaningful when its parent is on (the UI grays dependents out; stored
 *  values persist but resolve inert). All default true. */
export interface GraphSettings {
    /** MASTER (and, since wave 7, ONLY): off = no extraction, no auditor.
     *  The wave-7 collapse (owner ruling 2026-09-23) deleted the three
     *  subordinate rungs — embedding/clustering/labeling — and the BYOK
     *  embeddingModel: clustering is the free birth-session partition
     *  derived on read (core/session-clusters.ts), labels ARE session
     *  names, and the prober graph tools read the ledgers directly — there
     *  is nothing left to configure. Data stays stored either way. */
    enabled?: boolean;
    /** GRAPH RENDERING (owner, 2026-10-06 — the release graph-controls
     *  round): gates ONLY the home's main view. Off = the home shows the
     *  chains view instead of the canvas; the ledgers, the extraction
     *  pipeline, and every write path are untouched — this is a display
     *  switch, not a data switch (the extraction master above is the
     *  data switch). Default on. */
    rendering?: boolean;
    /** The chunk budget (extraction-UX redesign, owner 2026-09-24): the
     *  transcript-token share of the extractor's context — a run fires
     *  when a chat's UNCOVERED tokens reach it, and the run batches the
     *  oldest uncovered messages into runs of ≤ this many tokens. It
     *  bounds both cost and chunk size (the extractor prompt also
     *  carries the whole graph + instructions, so a smaller budget means
     *  more, smaller runs — each paying that fixed overhead).
     *
     *  FACTORY DEFAULT 4096 (owner, 2026-10-13: halved back from the
     *  digest-era 8192 — the labeled passages + message anchors made
     *  smaller batches worth their overhead again; the pre-setting
     *  constant was 4096, vision-extraction-coverage.md, 2026-09-15).
     *  Only the FACTORY moves: an explicit user value always wins.
     *
     *  FLOOR 500 (EXTRACTION_CHUNK_TOKENS_FLOOR, the implementer's call
     *  per the owner's dispatch): every run pays the graph-carrying
     *  prompt overhead out of the write channel's money — a budget below
     *  ~500 tokens would fire penny-batches that cost more per extracted
     *  token than the content is worth, so the sanitizer clamps and the
     *  PUT rejects below it. NO CEILING on purpose: a large budget just
     *  delays extraction — the user's stated cost/thoroughness tradeoff,
     *  not a misconfiguration to police. */
    extractionChunkTokens?: number;
}
/**
 * COMPACTION (owner round 14, 2026-10-05): the context-fitting mechanic's
 * user-facing controls: the trigger threshold and opt-in reasoning accounting.
 * The effective trigger is min(this, model contextWindow − 16k reserve)
 * (owner ruling: on big models the setting rules; on small ones the
 * window rules before the provider overflows).
 *
 * FACTORY DEFAULT 150_000 (owner ruling).
 *
 * FLOOR 32_000 (implementer's call, the chunk-budget discipline): below
 * the kept tail (20k) + a summary the chat would re-compact every turn —
 * a burn, not a preference. NO CEILING: a huge threshold just means "fit
 * everything" until the window rule binds.
 */
export interface CompactionSettings {
    thresholdTokens?: number;
    /** Use saved output usage for replayable same-model Responses reasoning.
     *  Absent = false: preserve the original readable-content heuristic. */
    includeReasoning?: boolean;
}
/** THE record. Every section optional (delta); unknown top-level keys are
 *  preserved verbatim by the sanitizer (forward-compat with newer records). */
export interface UserSettings {
    version: number;
    general?: GeneralSettings;
    dictation?: DictationSettings;
    /** Explicit app-wide opt-in; absent/invalid is off, including older records. */
    claudeCode?: {
        enabled?: boolean;
    };
    agent?: AgentSettings;
    /** The strong/cheap/vision model slots (model slots wave, 2026-09-20). */
    models?: ModelsSettings;
    /** The custom OpenAI-compatible endpoint (non-secret config only). */
    customProvider?: CustomProviderSettings;
    appearance?: AppearanceSettings;
    graph?: GraphSettings;
    compaction?: CompactionSettings;
    [key: string]: unknown;
}
/** Factory defaults for everything core can pin (owner decisions
 *  2026-09-19). NO factory models exist anywhere (owner, 2026-09-22 — BYOK
 *  all the way down): the chat section and every slot stay empty until the
 *  user picks, and the per-need gates refuse honestly; tools default on;
 *  prompts default off — hence their absence here. */
export interface FactorySettings {
    version: number;
    agent: Required<Pick<AgentSettings, "workerRequestConcurrency">>;
    general: Required<GeneralSettings>;
    dictation: Required<DictationSettings>;
    appearance: {
        theme: string;
        background: string | null;
        colors: AppearanceColorOverrides;
        fontFamily: string | null;
        proseFontSize: number;
        codeLigatures: boolean;
        sessionNameSerif: boolean;
        mdRendering: {
            headingWeight: number;
            boldColor: string | null;
            italicColor: string | null;
        };
    };
    graph: Required<GraphSettings>;
    compaction: Required<CompactionSettings>;
}
export declare const FACTORY_SETTINGS: FactorySettings;
/** The chunk budget's validated floor (GraphSettings.extractionChunkTokens
 *  — see its doc for the penny-batch rationale; the settings PUT names this
 *  in its rejection, the sanitizer clamps to it). */
export declare const EXTRACTION_CHUNK_TOKENS_FLOOR = 500;
/** #rgb / #rrggbb (case-insensitive) — the only color format we accept. */
export declare function isHexColor(value: string): boolean;
/** THE pins map + THE prune law: well-formed entries only, ids trimmed, and
 *  when `liveIds` is given every entry for a model the endpoint no longer
 *  advertises drops. POST passes the discovered ids, PATCH the stored list. */
export declare function sanitizeCustomModelOverrides(raw: unknown, liveIds?: Iterable<string>): Record<string, CustomModelOverride>;
/** clamp-never-reject (the sanitizer's discipline): a finite positive
 *  number floors to COMPACTION_THRESHOLD_FLOOR, anything else drops (the
 *  factory default resolves at read time). Exported for the PUT parser's
 *  reject-with-rationale (the graph chunk-budget precedent). */
export declare const COMPACTION_THRESHOLD_FLOOR = 32000;
/**
 * Coerce arbitrary JSON (disk file, network body) into a valid delta record:
 * known fields validated strictly (invalid ones drop/clamp per module doc),
 * UNKNOWN KEYS PRESERVED VERBATIM (a newer record must survive an older
 * app). Never throws. Non-objects → null.
 */
export declare function sanitizeUserSettings(raw: unknown): UserSettings | null;
