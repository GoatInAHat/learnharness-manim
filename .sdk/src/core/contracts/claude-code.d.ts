export declare const CLAUDE_CODE_PROVIDER = "claude-code";
/** Installation/version only. Never an authentication, quota, or billing verdict. */
export interface ClaudeCodeStatus {
    state: "not-found" | "meets-minimum" | "update-required" | "version-unchecked";
    version: string | null;
    minimumVersion: string;
}
export declare const CLAUDE_CODE_MINIMUM_VERSION = "2.1.259";
