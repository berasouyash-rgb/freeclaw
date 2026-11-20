// Android release scripts — behaviour that a build depends on
//
// Both scripts edit the *generated* android/ tree that ships in the APK, so a
// bug in either one is invisible here and only shows up on a phone (a version
// that never upgrades, or a back button that quits the app). These tests run
// the real scripts against throwaway fixtures instead of mocking them, because
// what matters is the file they leave behind.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..", "..");
const VERSION_SCRIPT = join(ROOT, "scripts", "sync-android-version.mjs");
const BACK_SCRIPT = join(ROOT, "scripts", "patch-android-back-button.mjs");
const PKG_VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version as string;

const GRADLE = `android {
    defaultConfig {
        applicationId "app.voicebox"
        versionCode 3
        versionName "1.9.9"
    }
}
`;

const MAIN_ACTIVITY_MINIMAL = `package app.voicebox;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {}
`;

const MAIN_ACTIVITY_WITH_ONCREATE = `package app.voicebox;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }
}
`;

function run(script: string, androidRoot: string) {
	const result = spawnSync(process.execPath, [script, androidRoot], {
		encoding: "utf8",
		timeout: 20_000,
	});
	return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

let androidRoot: string;
let gradlePath: string;
let activityPath: string;

beforeEach(() => {
	androidRoot = mkdtempSync(join(tmpdir(), "vb-android-"));
	mkdirSync(join(androidRoot, "app"), { recursive: true });
	gradlePath = join(androidRoot, "app", "build.gradle");
	writeFileSync(gradlePath, GRADLE, "utf8");

	const javaDir = join(androidRoot, "app", "src", "main", "java", "app", "voicebox");
	mkdirSync(javaDir, { recursive: true });
	activityPath = join(javaDir, "MainActivity.java");
	writeFileSync(activityPath, MAIN_ACTIVITY_MINIMAL, "utf8");
});

afterEach(() => {
	rmSync(androidRoot, { recursive: true, force: true });
});

describe("sync-android-version.mjs", () => {
	it("adopts package.json's version and increments versionCode", () => {
		const { status } = run(VERSION_SCRIPT, androidRoot);
		expect(status).toBe(0);

		const gradle = readFileSync(gradlePath, "utf8");
		expect(gradle).toContain(`versionName "${PKG_VERSION}"`);
		expect(gradle).toContain("versionCode 4");
		// The rest of the file must be untouched.
		expect(gradle).toContain('applicationId "app.voicebox"');
	});

	it("is a no-op on a re-run, so a rebuild of the same release is identical", () => {
		run(VERSION_SCRIPT, androidRoot);
		const first = readFileSync(gradlePath, "utf8");

		const { status } = run(VERSION_SCRIPT, androidRoot);
		expect(status).toBe(0);
		expect(readFileSync(gradlePath, "utf8")).toBe(first);
		expect(first).toContain("versionCode 4");
	});

	it("never leaves versionCode below 1, so a fresh project is installable", () => {
		writeFileSync(gradlePath, GRADLE.replace("versionCode 3", "versionCode 0"), "utf8");
		expect(run(VERSION_SCRIPT, androidRoot).status).toBe(0);
		expect(readFileSync(gradlePath, "utf8")).toContain("versionCode 1");
	});

	it("fails loudly instead of guessing when the version fields are gone", () => {
		writeFileSync(gradlePath, "android { }", "utf8");
		const { status, stderr } = run(VERSION_SCRIPT, androidRoot);
		expect(status).not.toBe(0);
		expect(stderr).toContain("no versionCode/versionName");
	});

	it("fails when there is no android project at all", () => {
		const { status, stderr } = run(VERSION_SCRIPT, join(androidRoot, "nope"));
		expect(status).not.toBe(0);
		expect(stderr).toContain("no build.gradle");
	});
});

describe("patch-android-back-button.mjs", () => {
	it("teaches a minimal subclass to navigate back instead of quitting", () => {
		const { status } = run(BACK_SCRIPT, androidRoot);
		expect(status).toBe(0);

		const java = readFileSync(activityPath, "utf8");
		expect(java).toContain("voice-flow-back-button");
		expect(java).toContain("public void onBackPressed()");
		// Walk history first, and only leave after a deliberate second tap.
		expect(java).toContain("webView.canGoBack()");
		expect(java).toContain("webView.goBack()");
		expect(java).toContain("vbLastBackPress");
		expect(java).toContain("super.onBackPressed();");
		// Still a valid class: package + superclass preserved.
		expect(java).toContain("package app.voicebox;");
		expect(java).toContain("public class MainActivity extends BridgeActivity {");
	});

	it("adds the field and the override exactly once", () => {
		run(BACK_SCRIPT, androidRoot);
		const once = readFileSync(activityPath, "utf8");

		const { status } = run(BACK_SCRIPT, androidRoot);
		expect(status).toBe(0);
		expect(readFileSync(activityPath, "utf8")).toBe(once);
		expect(once.match(/public void onBackPressed\(\)/g)).toHaveLength(1);
		expect(once.match(/private long vbLastBackPress/g)).toHaveLength(1);
	});

	it("keeps an existing onCreate override intact", () => {
		writeFileSync(activityPath, MAIN_ACTIVITY_WITH_ONCREATE, "utf8");
		expect(run(BACK_SCRIPT, androidRoot).status).toBe(0);

		const java = readFileSync(activityPath, "utf8");
		expect(java).toContain("protected void onCreate(android.os.Bundle savedInstanceState)");
		expect(java).toContain("public void onBackPressed()");
		// The override lands before the class closes, not inside onCreate.
		expect(java.indexOf("onBackPressed")).toBeGreaterThan(java.indexOf("onCreate"));
		expect(java.trimEnd().endsWith("}")).toBe(true);
	});

	it("refuses an unexpected class shape rather than corrupting it", () => {
		writeFileSync(activityPath, "package app.voicebox;\npublic class NotIt {}\n", "utf8");
		const before = readFileSync(activityPath, "utf8");

		const { status, stderr } = run(BACK_SCRIPT, androidRoot);
		expect(status).not.toBe(0);
		expect(stderr).toContain("does not subclass BridgeActivity");
		expect(readFileSync(activityPath, "utf8")).toBe(before);
	});

	it("fails when there is no MainActivity to patch", () => {
		rmSync(activityPath);
		const { status, stderr } = run(BACK_SCRIPT, androidRoot);
		expect(status).not.toBe(0);
		expect(stderr).toContain("no MainActivity.java");
	});
});
