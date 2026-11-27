// Types for the CI Android WebView cookie patch script (see the .mjs).
// Kept as a sibling declaration file so tsc accepts the .mjs import
// without compiling the script itself.
export declare const MARKER: string;
export declare function patchMainActivity(source: string): string;
