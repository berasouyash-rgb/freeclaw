// ═══════════════════════════════════════════════════════════════════
// image.ts — client-side downscale before upload
// ═══════════════════════════════════════════════════════════════════
// Guarantees: never throws, never destroys animation/vectors, never
// upscales, always returns usable payload bytes (or empty with a reason).
// ═══════════════════════════════════════════════════════════════════

import { afterEach, describe, expect, it, vi } from "vitest";
import { downscaleImage } from "../lib/image";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function pngFile(size = 100): File {
  return new File([new Uint8Array(size)], "photo.png", { type: "image/png" });
}

describe("downscaleImage", () => {
  it("passes GIFs through untouched (animation preserved)", async () => {
    const gif = new File([new Uint8Array(200)], "a.gif", {
      type: "image/gif",
    });
    const out = await downscaleImage(gif);
    expect(out.type).toBe("image/gif");
    expect(out.downscaled).toBe(false);
    expect(out.base64.length).toBeGreaterThan(0);
    expect(out.dataUrl.startsWith("data:image/gif;base64,")).toBe(true);
  });

  it("passes SVGs through untouched", async () => {
    const svg = new File(["<svg></svg>"], "a.svg", {
      type: "image/svg+xml",
    });
    const out = await downscaleImage(svg);
    expect(out.type).toBe("image/svg+xml");
    expect(out.downscaled).toBe(false);
  });

  it("downscales a large photo to JPEG within bounds", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      async () => ({ width: 2000, height: 1000, close: vi.fn() }),
    );
    let canvasW = 0;
    let canvasH = 0;
    const drawImage = vi.fn();
    const fakeCanvas = {
      set width(v: number) {
        canvasW = v;
      },
      set height(v: number) {
        canvasH = v;
      },
      getContext: () => ({ drawImage }),
      toBlob: (cb: (b: Blob | null) => void) =>
        cb(new Blob(["jpegbytes"], { type: "image/jpeg" })),
    };
    vi.spyOn(document, "createElement").mockReturnValue(
      fakeCanvas as unknown as HTMLCanvasElement,
    );
    const out = await downscaleImage(pngFile());
    expect(out.type).toBe("image/jpeg");
    expect(out.downscaled).toBe(true);
    expect(canvasW).toBe(1280);
    expect(canvasH).toBe(640);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(out.base64.length).toBeGreaterThan(0);
  });

  it("keeps small photos at original bytes (no pointless re-encode)", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      async () => ({ width: 800, height: 600, close: vi.fn() }),
    );
    const createElement = vi.spyOn(document, "createElement");
    const out = await downscaleImage(pngFile());
    expect(out.type).toBe("image/png");
    expect(out.downscaled).toBe(false);
    // No canvas work happened at all.
    expect(
      createElement.mock.calls.some(([tag]) => tag === "canvas"),
    ).toBe(false);
  });

  it("falls back to the original when canvas is unavailable", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      async () => ({ width: 2000, height: 1000, close: vi.fn() }),
    );
    vi.spyOn(document, "createElement").mockReturnValue({
      getContext: () => null,
    } as unknown as HTMLCanvasElement);
    const out = await downscaleImage(pngFile());
    expect(out.type).toBe("image/png");
    expect(out.downscaled).toBe(false);
    expect(out.base64.length).toBeGreaterThan(0);
  });

  it("falls back to the original when decoding fails entirely", async () => {
    vi.stubGlobal("createImageBitmap", async () => {
      throw new Error("decode failed");
    });
    // jsdom Image never settles on its own: fail fast like a corrupt file.
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_: string) {
        setTimeout(() => this.onerror?.(), 0);
      }
    }
    vi.stubGlobal("Image", FakeImage);
    const out = await downscaleImage(pngFile());
    expect(out.downscaled).toBe(false);
    expect(out.base64.length).toBeGreaterThan(0);
  });
});
