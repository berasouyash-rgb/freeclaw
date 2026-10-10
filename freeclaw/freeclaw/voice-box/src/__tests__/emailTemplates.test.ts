/**
 * TDD Tests for Email Template System
 *
 * Proves that:
 * 1. Template interpolation replaces {{variable}} correctly
 * 2. Conditional blocks {{#var}}...{{/var}} work
 * 3. Missing variables show placeholder
 * 4. Default templates have correct structure
 * 5. Example variables match template variables
 */

import { describe, it, expect } from "vitest";
import {
  renderTemplate,
  getExampleVariables,
  getCategoryColor,
  DEFAULT_TEMPLATES,
  type EmailTemplate,
} from "../lib/emailTemplates";

describe("Email Template Rendering", () => {
  const postSolvedTemplate: EmailTemplate = DEFAULT_TEMPLATES.find(
    (t) => t.id === "post-solved",
  )!;

  it("replaces simple variables", () => {
    const result = renderTemplate(postSolvedTemplate, {
      post_title: "Broken elevator",
      post_url: "https://voicebox.app/post/123",
    });

    expect(result.subject).toContain("Broken elevator");
    expect(result.body).toContain("https://voicebox.app/post/123");
  });

  it("shows placeholder for missing variables", () => {
    const result = renderTemplate(postSolvedTemplate, {});

    expect(result.subject).toContain("{{post_title}}");
    expect(result.body).toContain("{{post_url}}");
  });

  it("renders conditional block when variable is present", () => {
    const result = renderTemplate(postSolvedTemplate, {
      post_title: "Test",
      post_url: "https://test.com",
      admin_reply: "Fixed!",
    });

    expect(result.body).toContain("Admin reply: Fixed!");
  });

  it("hides conditional block when variable is missing", () => {
    const result = renderTemplate(postSolvedTemplate, {
      post_title: "Test",
      post_url: "https://test.com",
    });

    expect(result.body).not.toContain("Admin reply:");
  });

  it("renders alert template with severity label", () => {
    const alertTemplate = DEFAULT_TEMPLATES.find((t) => t.id === "alert-critical")!;
    const result = renderTemplate(alertTemplate, {
      alert_title: "Security breach",
      alert_message: "Unauthorized access",
      alert_url: "https://voicebox.app/admin/123",
    });

    expect(result.subject).toContain("CRITICAL");
    expect(result.body).toContain("Security breach");
    expect(result.body).toContain("Unauthorized access");
    expect(result.body).toContain("https://voicebox.app/admin/123");
  });

  it("renders poll-closed template", () => {
    const pollTemplate = DEFAULT_TEMPLATES.find((t) => t.id === "poll-closed")!;
    const result = renderTemplate(pollTemplate, {
      poll_title: "Solar panels?",
      poll_url: "https://voicebox.app/post/poll1",
    });

    expect(result.subject).toContain("Solar panels?");
    expect(result.body).toContain("https://voicebox.app/post/poll1");
  });

  it("renders welcome template", () => {
    const welcomeTemplate = DEFAULT_TEMPLATES.find((t) => t.id === "welcome")!;
    const result = renderTemplate(welcomeTemplate, {
      app_url: "https://voicebox.app",
    });

    expect(result.subject).toContain("Welcome");
    expect(result.body).toContain("https://voicebox.app");
  });
});

describe("Default Templates", () => {
  it("has all required templates", () => {
    expect(DEFAULT_TEMPLATES.length).toBe(6);
    expect(DEFAULT_TEMPLATES.map((t) => t.id)).toEqual(
      expect.arrayContaining([
        "post-solved",
        "poll-closed",
        "alert-critical",
        "alert-warning",
        "alert-info",
        "welcome",
      ]),
    );
  });

  it("each template has required fields", () => {
    for (const t of DEFAULT_TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.subject).toBeTruthy();
      expect(t.body).toBeTruthy();
      expect(Array.isArray(t.variables)).toBe(true);
      expect(["notification", "alert", "marketing"]).toContain(t.category);
    }
  });

  it("variables match what templates use", () => {
    for (const t of DEFAULT_TEMPLATES) {
      // Extract all variables from subject + body
      const allText = t.subject + " " + t.body;
      const used = new Set<string>();
      const re = /\{\{#?(\w+)\}\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(allText))) {
        if (m[1]) used.add(m[1]);
      }

      // Template's declared variables should cover all used variables
      for (const v of used) {
        expect(t.variables).toContain(v);
      }
    }
  });
});

describe("Example Variables", () => {
  it("provides examples for all templates", () => {
    for (const t of DEFAULT_TEMPLATES) {
      const examples = getExampleVariables(t.id);
      expect(Object.keys(examples).length).toBeGreaterThan(0);

      // All template variables should have examples
      for (const v of t.variables) {
        expect(examples[v]).toBeTruthy();
      }
    }
  });
});

describe("Category Colors", () => {
  it("returns correct colors for each category", () => {
    const notification = getCategoryColor("notification");
    expect(notification).toContain("text-accent");

    const alert = getCategoryColor("alert");
    expect(alert).toContain("text-warn");

    const marketing = getCategoryColor("marketing");
    expect(marketing).toContain("text-good");
  });
});
