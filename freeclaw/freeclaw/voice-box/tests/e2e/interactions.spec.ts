/**
 * E2E: cross-cutting interaction contract.
 *
 * These are the behaviours every page inherits from the design system and
 * cannot be proven in jsdom: real focus-visible outlines, real keyboard
 * arrow navigation, real reduced-motion media queries, and a real popover
 * that closes on Escape. No test writes data.
 */

import { test, expect } from "@playwright/test";

// The first-run tutorial is a modal that traps focus; suppressing it here keeps
// these tests about the global interaction contract rather than onboarding.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("vb:tutorialDone", JSON.stringify(true));
    } catch {
      /* storage unavailable */
    }
  });
});

test.describe("keyboard and focus", () => {
  test("the skip link is the first tab stop and becomes visible", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return { cls: el?.className ?? "", text: (el?.textContent ?? "").trim() };
    });
    expect(focused.cls).toContain("skip-to-content");
    expect(focused.text.length).toBeGreaterThan(0);
  });

  test("keyboard focus shows a visible outline", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const link = page.getByRole("link", { name: /^Feed$/i }).first();
    await link.focus();
    const outline = await link.evaluate((el) => {
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: s.outlineWidth };
    });
    expect(outline.style).not.toBe("none");
    expect(parseFloat(outline.width)).toBeGreaterThan(0);
  });

  test("header icon-only controls all have accessible names", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const unnamed = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("header button"));
      return buttons
        .filter((b) => {
          const el = b as HTMLElement;
          const name =
            el.getAttribute("aria-label") ||
            el.getAttribute("title") ||
            (el.textContent ?? "").trim();
          return !name;
        })
        .map((b) => (b as HTMLElement).className);
    });
    expect(unnamed).toEqual([]);
  });
});

test.describe("tab strips", () => {
  test("feed sort tabs move focus with ArrowRight and keep selection", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
    const tablist = page.locator('[role="tablist"][aria-label="Sort feed"]');
    await expect(tablist).toBeVisible();
    const tabs = tablist.getByRole("tab");
    const first = tabs.first();
    await first.focus();
    const before = await first.getAttribute("aria-selected");
    await page.keyboard.press("ArrowRight");
    const focusedIsTab = await page.evaluate(() =>
      (document.activeElement as HTMLElement)?.getAttribute("role") === "tab",
    );
    expect(focusedIsTab).toBe(true);
    // Roving focus is manual-activation: arrow keys must not change selection.
    expect(await first.getAttribute("aria-selected")).toBe(before);
  });

  test("submit content-type tabs activate with Enter", async ({ page }) => {
    await page.goto("/submit");
    await page.waitForLoadState("networkidle");
    const tablist = page.locator('[role="tablist"][aria-label="Content type selection"]');
    const tabs = tablist.getByRole("tab");
    const first = tabs.first();
    await first.focus();
    await page.keyboard.press("ArrowRight");
    const second = tabs.nth(1);
    await expect(second).toBeFocused();
    await page.keyboard.press("Enter");
    expect(await second.getAttribute("aria-selected")).toBe("true");
  });
});

test.describe("popovers and dialogs", () => {
  test("notification panel opens, closes on Escape, and reports expansion", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const bell = page.getByRole("button", { name: /^Notifications,/i });
    await bell.click();
    await expect(bell).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("region", { name: "Notifications" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(bell).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("region", { name: "Notifications" })).toHaveCount(0);
  });

  test("command palette traps Tab and restores focus on Escape", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const trigger = page.getByRole("button", { name: "Open command palette" }).first();
    await trigger.waitFor({ state: "visible" });
    await trigger.focus();
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => {
        const dialogEl = document.querySelector('[role="dialog"][aria-label="Command palette"]');
        return dialogEl?.contains(document.activeElement) ?? false;
      }),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});

test.describe("search and toasts", () => {
  test("search field clears with the clear button", async ({ page }) => {
    await page.goto("/search");
    await page.waitForLoadState("networkidle");
    const input = page.getByRole("textbox", { name: "Search everything" });
    await expect(input).toBeVisible();
    await input.fill("bullying");
    const clear = page.getByRole("button", { name: "Clear search" }).first();
    await expect(clear).toBeVisible();
    await clear.click();
    await expect(input).toHaveValue("");
  });

  test("reduced motion removes entrance animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const hero = page.locator(".vb-rise").first();
    await expect(hero).toBeVisible();
    const animation = await hero.evaluate((el) => {
      const s = getComputedStyle(el);
      return { name: s.animationName, duration: s.animationDuration, transform: s.transform };
    });
    expect(animation.name).toBe("none");
    expect(animation.transform === "none" || animation.transform === "matrix(1, 0, 0, 1, 0, 0)").toBe(true);
  });
});
