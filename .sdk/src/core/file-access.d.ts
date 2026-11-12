/** Non-secret, user-wide learner-source preferences. Absence means OFF;
 * an explicitly restricted empty list means no learner-source access. */
export interface FileAccessSettings {
    restricted: boolean;
    folders: string[];
}
/** Portable syntax for the editor/parser. The server additionally checks
 * whether a path is absolute on ITS filesystem before enforcing it. */
export declare function isFileAccessFolder(folder: string): boolean;
export type FileAccessSettingsResult = {
    ok: true;
    settings: FileAccessSettings;
} | {
    ok: false;
    error: string;
};
/** Security-sensitive preferences use the SAME strict read/write parser:
 * malformed policy must not disappear into a default-unrestricted value. */
export declare function parseFileAccessSettings(raw: unknown): FileAccessSettingsResult;
