/**
 * TDD Tests for Email Service
 *
 * Proves that:
 * 1. EmailJS initialization works
 * 2. sendEmail sends with correct parameters
 * 3. sendEmail handles missing config gracefully
 * 4. sendEmail handles send failures gracefully
 * 5. sendReportEmail formats report notification correctly
 * 6. sendAlertEmail formats alert correctly
 * 7. sendNotificationEmail formats notification correctly
 * 8. sendBatchEmails sends to multiple recipients
 * 9. isEmailConfigured returns correct status
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

// Set env vars — module reads these at call time so vi.stubEnv works
vi.stubEnv("VITE_EMAILJS_PUBLIC_KEY", "test-public-key");
vi.stubEnv("VITE_EMAILJS_SERVICE_ID", "test-service-id");
vi.stubEnv("VITE_EMAILJS_TEMPLATE_ID", "test-template-id");

import {
  initEmailJS,
  sendEmail,
  sendReportEmail,
  sendAlertEmail,
  sendNotificationEmail,
  sendBatchEmails,
  isEmailConfigured,
} from "../lib/email";

describe("Email Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({ status: 200 });
  });

  // Restore env vars after any test that modifies them
  afterEach(() => {
    vi.stubEnv("VITE_EMAILJS_PUBLIC_KEY", "test-public-key");
    vi.stubEnv("VITE_EMAILJS_SERVICE_ID", "test-service-id");
    vi.stubEnv("VITE_EMAILJS_TEMPLATE_ID", "test-template-id");
  });

  describe("initEmailJS", () => {
    it("initializes EmailJS with public key", () => {
      initEmailJS();
      expect(mockInit).toHaveBeenCalledWith("test-public-key");
    });
  });

  describe("sendEmail", () => {
    it("sends email with correct parameters", async () => {
      const result = await sendEmail({
        to_email: "user@example.com",
        subject: "Test Subject",
        message: "Test message",
      });

      expect(result.success).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(
        "test-service-id",
        "test-template-id",
        expect.objectContaining({
          to_email: "user@example.com",
          subject: "Test Subject",
          message: "Test message",
          from_name: "Voice Flow",
        }),
      );
    });

    it("returns error when EmailJS not configured", async () => {
      vi.stubEnv("VITE_EMAILJS_PUBLIC_KEY", "");

      const result = await sendEmail({
        to_email: "user@example.com",
        subject: "Test",
        message: "Test",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("EmailJS not configured");
    });

    it("handles send failure gracefully", async () => {
      mockSend.mockRejectedValue(new Error("Network error"));

      const result = await sendEmail({
        to_email: "user@example.com",
        subject: "Test",
        message: "Test",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network error");
    });

    it("uses custom from_name when provided", async () => {
      await sendEmail({
        to_email: "user@example.com",
        subject: "Test",
        message: "Test",
        from_name: "Custom Sender",
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ from_name: "Custom Sender" }),
      );
    });

    it("uses reply_to from params when provided", async () => {
      await sendEmail({
        to_email: "user@example.com",
        subject: "Test",
        message: "Test",
        reply_to: "reply@example.com",
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ reply_to: "reply@example.com" }),
      );
    });

    it("returns success false for non-200 status", async () => {
      mockSend.mockResolvedValue({ status: 500 });

      const result = await sendEmail({
        to_email: "user@example.com",
        subject: "Test",
        message: "Test",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("sendReportEmail", () => {
    it("formats report notification correctly", async () => {
      await sendReportEmail({
        to_email: "user@example.com",
        report_title: "Broken AC",
        report_category: "Facilities",
        report_status: "In Progress",
        report_url: "https://voicebox.app/post/123",
      });

      expect(mockSend).toHaveBeenCalledWith(
        "test-service-id",
        "test-template-id",
        expect.objectContaining({
          to_email: "user@example.com",
          subject: expect.stringContaining("Broken AC"),
          message: expect.stringContaining("In Progress"),
        }),
      );
    });

    it("includes report URL in message body", async () => {
      await sendReportEmail({
        to_email: "user@example.com",
        report_title: "Bug",
        report_category: "Tech",
        report_status: "Open",
        report_url: "https://example.com/report/42",
      });

      const call = mockSend.mock.calls[0]?.[2] as { message: string } | undefined;
      expect(call?.message).toContain("https://example.com/report/42");
    });
  });

  describe("sendAlertEmail", () => {
    it("formats critical alert correctly", async () => {
      await sendAlertEmail({
        to_email: "admin@example.com",
        alert_title: "Security breach",
        alert_severity: "critical",
        alert_message: "Unauthorized access detected",
      });

      expect(mockSend).toHaveBeenCalledWith(
        "test-service-id",
        "test-template-id",
        expect.objectContaining({
          subject: expect.stringContaining("CRITICAL"),
          message: expect.stringContaining("Unauthorized access"),
        }),
      );
    });

    it("formats warning alert correctly", async () => {
      await sendAlertEmail({
        to_email: "admin@example.com",
        alert_title: "High latency",
        alert_severity: "warning",
        alert_message: "API latency increased",
      });

      const call = mockSend.mock.calls[0]?.[2] as { subject: string } | undefined;
      expect(call?.subject).toContain("WARNING");
    });

    it("formats info alert correctly", async () => {
      await sendAlertEmail({
        to_email: "admin@example.com",
        alert_title: "Scheduled maintenance",
        alert_severity: "info",
        alert_message: "System update at 2am",
      });

      const call = mockSend.mock.calls[0]?.[2] as { subject: string } | undefined;
      expect(call?.subject).toContain("INFO");
    });

    it("includes alert URL when provided", async () => {
      await sendAlertEmail({
        to_email: "admin@example.com",
        alert_title: "Alert",
        alert_severity: "warning",
        alert_message: "Something happened",
        alert_url: "https://example.com/alert/1",
      });

      const call = mockSend.mock.calls[0]?.[2] as { message: string } | undefined;
      expect(call?.message).toContain("https://example.com/alert/1");
    });

    it("omits alert URL when not provided", async () => {
      await sendAlertEmail({
        to_email: "admin@example.com",
        alert_title: "Alert",
        alert_severity: "info",
        alert_message: "Something happened",
      });

      const call = mockSend.mock.calls[0]?.[2] as { message: string } | undefined;
      expect(call?.message).not.toContain("View details");
    });
  });

  describe("sendNotificationEmail", () => {
    it("formats notification correctly", async () => {
      await sendNotificationEmail({
        to_email: "user@example.com",
        notification_title: "Your post was solved",
        notification_body: "Great news! Your report has been resolved.",
        notification_url: "https://voicebox.app/post/456",
      });

      expect(mockSend).toHaveBeenCalledWith(
        "test-service-id",
        "test-template-id",
        expect.objectContaining({
          subject: expect.stringContaining("Your post was solved"),
          message: expect.stringContaining("resolved"),
        }),
      );
    });

    it("omits View line when no URL", async () => {
      await sendNotificationEmail({
        to_email: "user@example.com",
        notification_title: "Update",
        notification_body: "Something changed.",
      });

      const call = mockSend.mock.calls[0]?.[2] as { message: string } | undefined;
      expect(call?.message).not.toContain("View:");
    });
  });

  describe("sendBatchEmails", () => {
    it("sends to multiple recipients", async () => {
      const result = await sendBatchEmails(
        ["a@test.com", "b@test.com", "c@test.com"],
        { subject: "Batch", message: "Hello" },
      );

      expect(result.sent).toBe(3);
      expect(result.failed).toBe(0);
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it("handles partial failures", async () => {
      mockSend
        .mockResolvedValueOnce({ status: 200 })
        .mockRejectedValueOnce(new Error("Fail"))
        .mockResolvedValueOnce({ status: 200 });

      const result = await sendBatchEmails(
        ["a@test.com", "b@test.com", "c@test.com"],
        { subject: "Batch", message: "Hello" },
      );

      expect(result.sent).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
    });

    it("handles all failures", async () => {
      mockSend.mockRejectedValue(new Error("Down"));

      const result = await sendBatchEmails(
        ["a@test.com", "b@test.com"],
        { subject: "Batch", message: "Hello" },
      );

      expect(result.sent).toBe(0);
      expect(result.failed).toBe(2);
      expect(result.errors).toHaveLength(2);
    });

    it("handles empty recipients list", async () => {
      const result = await sendBatchEmails([], {
        subject: "Batch",
        message: "Hello",
      });

      expect(result.sent).toBe(0);
      expect(result.failed).toBe(0);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe("isEmailConfigured", () => {
    it("returns true when all env vars are set", () => {
      expect(isEmailConfigured()).toBe(true);
    });

    it("returns false when public key is missing", () => {
      vi.stubEnv("VITE_EMAILJS_PUBLIC_KEY", "");
      expect(isEmailConfigured()).toBe(false);
    });

    it("returns false when service ID is missing", () => {
      vi.stubEnv("VITE_EMAILJS_SERVICE_ID", "");
      expect(isEmailConfigured()).toBe(false);
    });

    it("returns false when template ID is missing", () => {
      vi.stubEnv("VITE_EMAILJS_TEMPLATE_ID", "");
      expect(isEmailConfigured()).toBe(false);
    });
  });
});
