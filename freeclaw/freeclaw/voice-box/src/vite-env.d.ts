/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** Published Spline scene URL for the admin pet. Empty → SVG fallback. */
	readonly VITE_SPLINE_PET_URL?: string;
}

interface Window {
	vbDesktop?: boolean;
	vbStore?: {
		get: (key: string) => Promise<string | null>;
		set: (key: string, value: string) => Promise<boolean>;
		remove: (key: string) => Promise<boolean>;
		keys: () => Promise<string[]>;
	};
	vbNotify?: {
		show: (ping: { title: string; body?: string; tag?: string; url?: string }) => Promise<boolean>;
		isSupported: () => Promise<boolean>;
	};
}

