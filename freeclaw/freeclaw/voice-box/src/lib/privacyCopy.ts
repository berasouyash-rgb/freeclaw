export const NOTIFY_PRIVACY_COPY =
	"If you turn on phone or email alerts, Voice Flow stores the phone number or email address on the server to deliver the alerts you requested. Clear either field and save to overwrite the stored value.";

export const CONTACT_PRIVACY_COPY =
	"The Contact form sends the name, email address, subject, and message you enter through the post moderation pipeline. Do not include information you do not want stored with the request.";

export const LOCAL_PROFILE_COPY =
	"Display name, avatar, bio, profile photo, bookmarks, and drafts are stored in this browser unless a control explicitly says server-side.";

export const RETENTION_COPY =
	"Solved and archived posts are purged 5 days after their last activity — a comment or reaction resets that countdown; user-deleted posts are hard-deleted with their comments and reactions after an admin-configurable window of 1–168 hours (5 hours by default); comments, reactions, activity logs, chat messages, agent conversations, and archived polls are purged after 30 days; agent runtime history is purged after 90 days. Notification contact values remain until you clear or replace them in Settings.";

export const SERVER_PII_COPY =
	"Anonymous IDs link public content. Optional alert contact values and Contact-form submissions are server-side personal data; protect exports and logs, and do not place those values in public responses.";

export const INFRASTRUCTURE_COPY =
	"The application does not intentionally store application-table IP addresses or use advertising cookies. Infrastructure providers may process request metadata under their own policies.";

export const ZERO_SIGNUP_COPY =
	"100% Zero-signup and Zero-login architecture. Each browser instance and mobile/desktop device maintains exactly 1 persistent anonymous ID bound to its local hardware storage. No passwords, accounts, or personal data are ever collected or required. Devices can be linked securely in 1 second via a 6-digit code or camera QR scan.";

export const PERFORMANCE_COPY =
	"Sub-300ms platform performance: all core routes and views are pre-warmed in memory during idle time, and cached data displays in under 50ms with instant background revalidation for lag-free page transitions.";

export const CACHE_CLEAR_COPY =
	"Clearing cached images and files never signs you out and never deletes your drafts, bookmarks, settings, posts, or votes — that data lives in separate browser storage the cache clear does not touch. Only deleting cookies and site data starts a fresh anonymous ID (your published posts stay public, but that browser can no longer manage them).";
