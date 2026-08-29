/**
 * TDD Tests for Email Notification Integration
 *
 * Proves that:
 * 1. sendPostSolvedEmail formats the email correctly
 * 2. sendPollClosedEmail formats the email correctly
 * 3. sendAlertEmail formats emails with correct severity labels
 * 4. All email functions are fire-and-forget (don't throw)
 * 5. Email functions handle missing configuration gracefully
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock EmailJS — must use vi.hoisted for vi.mock factory
const { mockSend, mockInit } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockInit: vi.fn(),
}));

vi.mock("@emailjs/browser", () => ({
  default: {
    init: mockInit,
    send: mockSend,
  },
}));

vi.stubEnv("VITE_EMAILJS_PUBLIC_KEY", "test-key");
vi.stubEnv("VITE_EMAILJS_SERVICE_ID", "test-service");
vi.stubEnv("VITE_EMAILJS_TEMPLATE_ID", "test-template");

import {
  sendEmail,
  sendReportEmail,
  sendAlertEmail,
  sendNotificationEmail,
  isEmailConfigured,
} from "../lib/email";

describe("Email Notification Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({ status: 200 });
  });

  afterEach(() => {
    vi.stubEnv("VITE_EMAILJS_PUBLIC_KEY", "test-key");
    vi.stubEnv("VITE_EMAILJS_SERVICE_ID", "test-service");
    vi.stubEnv("VITE_EMAILJS_TEMPLATE_ID", "test-template");
  });

  describe("post-solved notification", () => {
    it("sends email with correct subject containing post title", async () => {
      await sendReportEmail({
        to_email: "user@voicebox.local",
        report_title: "Broken Elevator",
        report_category: "Facilities",
        report_status: "Solved",
        report_url: "https://voicebox.app/post/abc123",
      });

      expect(mockSend).toHaveBeenCalledWith(
        "test-service",
        "test-template",
        expect.objectContaining({
          subject: expect.stringContaining("Broken Elevator"),
        }),
      );
    });

    it("includes post URL in message body", async () => {
      await sendReportEmail({
        to_email: "user@voicebox.local",
        report_title: "Test",
        report_category: "General",
        report_status: "Solved",
        report_url: "https://voicebox.app/post/xyz789",
      });

      const call = mockSend.mock.calls[0][2];
      expect(call.message).toContain("https://voicebox.app/post/xyz789");
    });

    it("includes solved status in subject", async () => {
      await sendReportEmail({
        to_email: "user@voicebox.local",
        report_title: "Issue",
        report_category: "General",
        report_status: "Solved",
        report_url: "https://voicebox.app/post/123",
      });

      const call = mockSend.mock.calls[0][2];
      expect(call.subject).toContain("Solved");
    });
  });

  describe("poll-closed notification", () => {
    it("sends email with poll title in subject", async () => {
      await sendNotificationEmail({
        to_email: "creator@voicebox.local",
        notification_title: "Your poll \"Solar Panels\" has closed",
        notification_body: "Results are in!",
        notification_url: "https://voicebox.app/post/poll123",
      });

      expect(mockSend).toHaveBeenCalledWith(
        "test-service",
        "test-template",
        expect.objectContaining({
          subject: expect.stringContaining("Solar Panels"),
        }),
      );
    });

    it("includes poll URL in message", async () => {
      await sendNotificationEmail({
        to_email: "creator@voicebox.local",
        notification_title: "Poll closed",
        notification_body: "Results are in!",
        notification_url: "https://voicebox.app/post/poll456",
      });

      const call = mockSend.mock.calls[0][2];
      expect(call.message).toContain("https://voicebox.app/post/poll456");
    });
  });

  describe("alert notification", () => {
    it("sends critical alert with CRITICAL label", async () => {
      await sendAlertEmail({
        to_email: "admin@voicebox.local",
        alert_title: "Security breach detected",
        alert_severity: "critical",
        alert_message: "Unauthorized access attempt",
      });

      const call = mockSend.mock.calls[0][2];
      expect(call.subject).toContain("CRITICAL");
      expect(call.message).toContain("Security breach detected");
    });

    it("sends warning alert with WARNING label", async () => {
      await sendAlertEmail({
        to_email: "admin@voicebox.local",
        alert_title: "High error rate",
        alert_severity: "warning",
        alert_message: "Error rate exceeded threshold",
      });

      const call = mockSend.mock.calls[0][2];
      expect(call.subject).toContain("WARNING");
    });

    it("sends info alert with INFO label", async () => {
      await sendAlertEmail({
        to_email: "admin@voicebox.local",
        alert_title: "Scheduled maintenance",
        alert_severity: "info",
        alert_message: "System update at 2am",
      });

      const call = mockSend.mock.calls[0][2];
      expect(call.subject).toContain("INFO");
    });

    it("includes alert URL when provided", async () => {
      await sendAlertEmail({
        to_email: "admin@voicebox.local",
        alert_title: "Alert",
        alert_severity: "warning",
        alert_message: "Something happened",
        alert_url: "https://voicebox.app/admin/alerts/123",
      });

      const call = mockSend.mock.calls[0][2];
      expect(call.message).toContain("https://voicebox.app/admin/alerts/123");
    });
  });

  describe("graceful degradation", () => {
    it("returns error when email not configured", async () => {
      vi.stubEnv("VITE_EMAILJS_PUBLIC_KEY", "");

      const result = await sendEmail({
        to_email: "test@test.com",
        subject: "Test",
        message: "Test",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("EmailJS not configured");
    });

    it("handles send failure gracefully", async () => {
      mockSend.mockRejectedValue(new Error("Network error"));

      const result = await sendEmail({
        to_email: "test@test.com",
        subject: "Test",
        message: "Test",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network error");
    });

    it("isEmailConfigured returns correct status", () => {
      expect(isEmailConfigured()).toBe(true);
    });
  });
});
