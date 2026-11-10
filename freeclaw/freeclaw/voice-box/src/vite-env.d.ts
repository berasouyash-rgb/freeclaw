/// <reference types="vite/client" />

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

