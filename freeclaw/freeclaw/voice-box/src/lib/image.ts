/**
 * Client-side image downscale before upload.
 *
 * WHY: uploads ride as base64 JSON through a 4 MB server body cap into
 * metered Supabase storage + egress. A 3 MB phone photo becomes ~4 MB on
 * the wire and bills full-size forever. Downscaling to a 1280px JPEG
 * typically cuts uploads 5–10× with zero visible loss on a feed card —
 * the single highest-value free-tier optimization: less storage, less
 * bandwidth, no more flirting with the body cap. Never throws: any failure
 * (old browser, canvas blocked, animated GIF, SVG) falls back to the
 * original file bytes.
 */

export interface DownscaledImage {
	/** Full data: URL for preview. */
	dataUrl: string;
	/** Raw base64 (no prefix) for the upload payload. */
	base64: string;
	/** MIME type of the payload (image/jpeg after downscale). */
	type: string;
	/** True when the pixels were actually re-encoded smaller. */
	downscaled: boolean;
}

const MAX_DIM = 1280;
const JPEG_QUALITY = 0.82;

/** Types the uploader must never re-encode (animation / vector). */
function passthroughType(type: string): boolean {
	return type === "image/gif" || type === "image/svg+xml";
}

function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		try {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result ?? ""));
			reader.onerror = () => reject(reader.error ?? new Error("read failed"));
			reader.readAsDataURL(blob);
		} catch (err) {
			reject(err);
		}
	});
}

function dataUrlToPayload(dataUrl: string, type: string): DownscaledImage {
	return {
		dataUrl,
		base64: dataUrl.split(",")[1] ?? "",
		type,
		downscaled: false,
	};
}

interface BitmapLike {
	width: number;
	height: number;
	close?: () => void;
}

async function loadBitmap(file: Blob): Promise<BitmapLike | null> {
	// Path 1: createImageBitmap (all modern browsers, worker-safe).
	try {
		const cib = (globalThis as unknown as {
			createImageBitmap?: (b: Blob) => Promise<BitmapLike>;
		}).createImageBitmap;
		if (typeof cib === "function") {
			const bmp = await cib.call(globalThis, file);
			if (bmp && bmp.width > 0 && bmp.height > 0) return bmp;
		}
	} catch {
		/* fall through */
	}
	// Path 2: <img> element (older browsers without createImageBitmap).
	try {
		if (typeof document === "undefined" || typeof Image === "undefined")
			return null;
		const url = URL.createObjectURL(file);
		try {
			// Bounded decode: a corrupt file must fail, never hang the picker.
			const img = await new Promise<HTMLImageElement>((resolve, reject) => {
				const el = new Image();
				const to = setTimeout(
					() => reject(new Error("image decode timed out")),
					10000,
				);
				el.onload = () => {
					clearTimeout(to);
					resolve(el);
				};
				el.onerror = () => {
					clearTimeout(to);
					reject(new Error("image decode failed"));
				};
				el.src = url;
			});
			if (img.naturalWidth > 0 && img.naturalHeight > 0)
				return {
					width: img.naturalWidth,
					height: img.naturalHeight,
				};
			return null;
		} finally {
			URL.revokeObjectURL(url);
		}
	} catch {
		return null;
	}
}

function canvasToJpeg(
	source: BitmapLike,
	w: number,
	h: number,
): Promise<Blob | null> {
	return new Promise((resolve) => {
		try {
			const canvas = document.createElement("canvas");
			canvas.width = w;
			canvas.height = h;
			const ctx = canvas.getContext("2d");
			if (!ctx) {
				resolve(null);
				return;
			}
			ctx.drawImage(
				source as unknown as CanvasImageSource,
				0,
				0,
				w,
				h,
			);
			if (typeof canvas.toBlob !== "function") {
				resolve(null);
				return;
			}
			canvas.toBlob(
				(b) => resolve(b),
				"image/jpeg",
				JPEG_QUALITY,
			);
		} catch {
			resolve(null);
		}
	});
}

export async function downscaleImage(
	file: Blob & { type?: string },
	maxDim: number = MAX_DIM,
): Promise<DownscaledImage> {
	const type = typeof file.type === "string" ? file.type : "";
	try {
		// Never re-encode animation or vectors; still normalize the payload.
		if (passthroughType(type)) {
			return dataUrlToPayload(await blobToDataUrl(file), type);
		}
		const bmp = await loadBitmap(file);
		if (!bmp) return dataUrlToPayload(await blobToDataUrl(file), type);
		try {
			const scale = Math.min(
				1,
				maxDim / Math.max(bmp.width, bmp.height),
			);
			// Already small enough: keep original bytes (no quality loss at all).
			if (scale >= 1) {
				return dataUrlToPayload(await blobToDataUrl(file), type);
			}
			const w = Math.max(1, Math.round(bmp.width * scale));
			const h = Math.max(1, Math.round(bmp.height * scale));
			const out = await canvasToJpeg(bmp, w, h);
			if (!out) return dataUrlToPayload(await blobToDataUrl(file), type);
			const dataUrl = await blobToDataUrl(out);
			return {
				dataUrl,
				base64: dataUrl.split(",")[1] ?? "",
				type: "image/jpeg",
				downscaled: true,
			};
		} finally {
			try {
				bmp.close?.();
			} catch {
				/* noop */
			}
		}
	} catch {
		// Total fallback: original bytes, original type. Upload may still
		// succeed; the server enforces its own cap with an honest error.
		try {
			return dataUrlToPayload(await blobToDataUrl(file), type);
		} catch {
			return { dataUrl: "", base64: "", type, downscaled: false };
		}
	}
}
