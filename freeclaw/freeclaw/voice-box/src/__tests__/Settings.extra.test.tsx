// Settings extra coverage — tabs, toggles, saving, profile, channels, pairing
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Settings from "../pages/Settings";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  refreshIdentity: vi.fn(),
  setDisplayName: vi.fn(),
  setTheme: vi.fn(),
  setDisplayPrefs: vi.fn(),
  setProfile: vi.fn((p: Record<string, string>) => ({ ...p })),
  get: vi.fn(async () => ({})),
  post: vi.fn(async () => ({})),
  sendEmail: vi.fn(async () => ({ success: true })),
  resetTutorial: vi.fn(),
  notifyPermission: vi.fn(() => "unsupported" as const),
  showNotification: vi.fn(() => true),
  requestPermission: vi.fn(async () => "granted" as const),
  getDisplayName: vi.fn(() => ""),
  createLinkCode: vi.fn(() => "VF-TEST-CODE"),
}));

vi.mock("../lib/api", () => ({
  api: { get: mocks.get, post: mocks.post },
  isSessionDeadError: () => false,
}));

vi.mock("../contexts/AppContext", () => ({
  useApp: () => ({
    anonId: "anon-test",
    toast: mocks.toast,
    refreshIdentity: mocks.refreshIdentity,
    setDisplayName: mocks.setDisplayName,
    theme: "system",
    setTheme: mocks.setTheme,
    displayPrefs: {
      compactMode: false,
      showAvatars: true,
      animationsEnabled: true,
      glassEnabled: false,
      uiScale: 100,
    },
    setDisplayPrefs: mocks.setDisplayPrefs,
    profile: { avatar: "", bio: "", photo: "" },
    setProfile: mocks.setProfile,
    notifications: [],
    bookmarks: [],
    recentlyViewed: [],
  }),
}));

vi.mock("../lib/email", () => ({
  sendNotificationEmail: mocks.sendEmail,
}));

vi.mock("../lib/identity", () => ({
  adoptIdentityById: vi.fn(() => null),
  createLinkCode: mocks.createLinkCode,
  getDisplayName: mocks.getDisplayName,
  resetAnonId: vi.fn(() => "anon_new123"),
}));

vi.mock("../lib/browserNotify", () => ({
  browserNotifyPermission: mocks.notifyPermission,
  requestBrowserNotifyPermission: mocks.requestPermission,
  showBrowserNotification: mocks.showNotification,
}));

vi.mock("../components/Tutorial", () => ({
  resetTutorial: mocks.resetTutorial,
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>,
  );
}

function openTab(name: string) {
  fireEvent.click(screen.getByRole("button", { name: name }));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.get.mockImplementation(async () => ({}));
  mocks.post.mockImplementation(async () => ({}));
  mocks.sendEmail.mockImplementation(async () => ({ success: true }));
  mocks.getDisplayName.mockReturnValue("");
});

describe("Settings extra — header and tabs", () => {
  it("should render the Settings heading with notifications tab by default", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.getByText("Notification Preferences")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Push notifications" })).toBeTruthy();
  });

  it("should switch to the Display tab", () => {
    renderPage();
    openTab("Display & Feel");
    expect(screen.getByRole("heading", { name: "Display & Feel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "System" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Glass morphism" })).toBeTruthy();
  });

  it("should switch to the Account tab", () => {
    renderPage();
    openTab("Account");
    expect(screen.getByText("Account Settings")).toBeTruthy();
    expect(screen.getByText("Anonymous Identity")).toBeTruthy();
    expect(screen.getByLabelText("Display name")).toBeTruthy();
  });

  it("should switch to the Privacy tab", () => {
    renderPage();
    openTab("Privacy");
    expect(screen.getByText("Privacy Settings")).toBeTruthy();
    expect(screen.getByText("Anonymous by Design")).toBeTruthy();
    expect(screen.getByText("Data Retention")).toBeTruthy();
  });
});

describe("Settings extra — notification toggles save", () => {
  it("should persist push toggle to localStorage and toast", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Push notifications" }));
    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith("Notification preferences saved", "ok");
    });
    const saved = JSON.parse(localStorage.getItem("vb:notif-prefs") || "{}");
    expect(saved.push).toBe(false);
  });

  it("should toggle sound alerts off", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Sound alerts" }));
    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith("Notification preferences saved", "ok");
    });
    const saved = JSON.parse(localStorage.getItem("vb:notif-prefs") || "{}");
    expect(saved.sound).toBe(false);
  });
});

describe("Settings extra — alert channels", () => {
  it("should save phone and email channels to the server", async () => {
    mocks.post.mockResolvedValueOnce({
      phone: "+15551234567",
      email: "me@example.com",
      sms_enabled: true,
      email_enabled: true,
      browser_enabled: true,
      status_updates: true,
    });
    renderPage();
    fireEvent.change(screen.getByPlaceholderText("+1 555 123 4567"), {
      target: { value: "+15551234567" },
    });
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "me@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save alert channels" }));
    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith(
        "/api/notify-prefs",
        expect.objectContaining({ phone: "+15551234567", email: "me@example.com" }),
      );
    });
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.stringMatching(/Alert channels saved/i),
      "ok",
    );
  });

  it("should toast an error when saving channels fails", async () => {
    mocks.post.mockRejectedValueOnce(new Error("network down"));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Save alert channels" }));
    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith("network down", "err");
    });
  });

  it("should send a welcome email when an address is added", async () => {
    mocks.post.mockResolvedValueOnce({
      phone: "",
      email: "new@example.com",
      sms_enabled: false,
      email_enabled: true,
      browser_enabled: true,
      status_updates: true,
    });
    renderPage();
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save alert channels" }));
    await waitFor(() => {
      expect(mocks.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to_email: "new@example.com" }),
      );
    });
  });
});

describe("Settings extra — display prefs", () => {
  it("should apply the dark theme with a toast", () => {
    renderPage();
    openTab("Display & Feel");
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(mocks.setTheme).toHaveBeenCalledWith("dark");
    expect(mocks.toast).toHaveBeenCalledWith("Theme set to Dark", "ok");
  });

  it("should toggle glass morphism through setDisplayPrefs", () => {
    renderPage();
    openTab("Display & Feel");
    fireEvent.click(screen.getByRole("button", { name: "Glass morphism" }));
    expect(mocks.setDisplayPrefs).toHaveBeenCalledWith(
      expect.objectContaining({ glassEnabled: true }),
    );
  });

  it("should change UI scale when a scale button is pressed", () => {
    renderPage();
    openTab("Display & Feel");
    fireEvent.click(screen.getByRole("button", { name: "110%" }));
    expect(mocks.setDisplayPrefs).toHaveBeenCalledWith(
      expect.objectContaining({ uiScale: 110 }),
    );
  });
});

describe("Settings extra — profile inputs", () => {
  it("should save a display name", () => {
    renderPage();
    openTab("Account");
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Curious Cat" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.setDisplayName).toHaveBeenCalledWith("Curious Cat");
    expect(mocks.toast).toHaveBeenCalledWith("Display name saved", "ok");
  });

  it("should fall back to the anonymous ID when the name is blank", () => {
    mocks.getDisplayName.mockReturnValue("");
    renderPage();
    openTab("Account");
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.toast).toHaveBeenCalledWith("Using your anonymous ID", "ok");
  });

  it("should save avatar and bio through setProfile", () => {
    renderPage();
    openTab("Account");
    fireEvent.click(screen.getByRole("button", { name: "Avatar 🦊" }));
    fireEvent.change(screen.getByLabelText("Bio"), { target: { value: "Hello there" } });
    fireEvent.click(screen.getByRole("button", { name: /Save profile/i }));
    expect(mocks.setProfile).toHaveBeenCalledWith(
      expect.objectContaining({ avatar: "🦊", bio: "Hello there" }),
    );
    expect(mocks.toast).toHaveBeenCalledWith("Profile updated", "ok");
  });

  it("should reject an oversized profile photo", () => {
    renderPage();
    openTab("Account");
    const file = new File(["x"], "big.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: 3 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText("Upload profile photo"), {
      target: { files: [file] },
    });
    expect(mocks.toast).toHaveBeenCalledWith("Photo must be under 2 MB", "err");
  });

  it("should reject a non-image profile photo", () => {
    renderPage();
    openTab("Account");
    const file = new File(["x"], "notes.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Upload profile photo"), {
      target: { files: [file] },
    });
    expect(mocks.toast).toHaveBeenCalledWith("Only PNG, JPG, GIF or WebP images", "err");
  });
});

describe("Settings extra — export, tutorial, pairing", () => {
  it("should export on-device settings as JSON", async () => {
    const createURL = vi.fn(() => "blob:fake");
    const revokeURL = vi.fn();
    (globalThis.URL as unknown as Record<string, unknown>).createObjectURL = createURL;
    (globalThis.URL as unknown as Record<string, unknown>).revokeObjectURL = revokeURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderPage();
    openTab("Account");
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => {
      expect(createURL).toHaveBeenCalled();
    });
    expect(mocks.toast).toHaveBeenCalledWith("Data exported", "ok");
    clickSpy.mockRestore();
  });

  it("should reset the tutorial after confirmation", () => {
    renderPage();
    openTab("Account");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    const confirms = screen.getAllByRole("button", { name: "Reset" });
    fireEvent.click(confirms[confirms.length - 1]!);
    expect(mocks.resetTutorial).toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith("Tutorial will show again on next visit", "ok");
  });

  it("should mint a pairing code on demand", async () => {
    mocks.post.mockResolvedValueOnce({ code: "482913" });
    renderPage();
    openTab("Account");
    fireEvent.click(screen.getByRole("button", { name: "Show my pairing code" }));
    expect(await screen.findByLabelText("Your pairing code")).toHaveTextContent("482913");
    expect(screen.getByText(/Valid for 5 minutes/i)).toBeTruthy();
  });

  it("should reject a mistyped pairing code without a server call", async () => {
    renderPage();
    openTab("Account");
    fireEvent.change(screen.getByLabelText("Pairing code"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Pair this device" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/6 digits/i);
    expect(mocks.post).not.toHaveBeenCalledWith(
      "/api/identity-link",
      expect.objectContaining({ action: "redeem" }),
    );
  });
});
