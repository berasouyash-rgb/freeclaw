# 2. Hardcoded Issues
Values fixed in code that should be dynamically assigned. Every entry names the mechanism, the failure mode, and the detection surface.

### BUG-HARDCODE-001 — Vite dev-server origin hardcoded in the client bundle
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** A shared constants module exports `API_BASE_URL = 'http://localhost:5173'` and every fetch in the frontend derives its target from it instead of reading `import.meta.env.VITE_API_URL` or `window.location.origin`. Any deployment served from a non-local host sends every request to the developer machine, so the UI renders while no data ever loads. A CI grep for `localhost:` under `src/**` (excluding tests) plus a deployed-URL E2E smoke test that asserts a non-empty first fetch catches it before release.
- **Real-world example:** The twelve-factor methodology requires configuration through the environment; the classic Express/Next.js production failure — a hardcoded `http://localhost:3000` API origin behind a reverse proxy — breaks deployments identically and is a fixture of every production-readiness checklist.

### BUG-HARDCODE-002 — Vite's default port 5173 assumed as the API port
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** The backend client module defaults its base URL to port 5173 — Vite's dev-server port — instead of reading an `API_PORT` variable from the environment. The app only works when the API coincidentally listens on 5173; against a production port (3000, 8080) every call is refused, and because the errors are caught and logged rather than surfaced, the failure looks like a dead backend. A config-schema test that asserts required connection values are present at boot, plus a startup health check that probes the configured port, catches the mismatch immediately.
- **Real-world example:** PaaS platforms such as Heroku and Fly.io inject the listen port through the environment and document that hardcoding it breaks healthchecks; the same class of failure appears in every docker-compose port-mapping guide.

### BUG-HARDCODE-003 — API base URL read from env with no fail-fast validation
- **Category:** Hardcoded Issue · env-assumed
- **Description:** The client builds its base URL as `process.env.API_URL || ''`, so an unset variable silently produces an empty-string base and requests are issued against the current origin. The app then 404s on `/api/*` while the errors surface as a generic "failed to fetch" far from the root cause, costing a debugging session. A zod-style environment schema parsed once at startup that throws and lists missing required variables, plus a CI test that boots the app with a stripped environment, catches it at boot rather than at first user request.
- **Real-world example:** The empty-required-env-var class is a recognized production failure mode in Next.js and Vite deployments; both frameworks' own docs recommend validating `process.env` at module load precisely because unset variables fail silently.

### BUG-HARDCODE-004 — Relative fetch path in server-side code
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** A server-side route handler calls `fetch('/api/voice-notes')` without an absolute URL, assuming the browser's relative-URL resolution applies. Node's `fetch` throws "Failed to parse URL" at runtime, or in proxied setups resolves against an internal host that has no such route, so the handler 500s only in production. An integration test that invokes the route handler directly outside a browser, plus a lint rule banning relative paths in `fetch` calls inside server-only modules, catches it before deploy.
- **Real-world example:** Node.js's WHATWG fetch implementation requires absolute URLs and throws otherwise — a documented behavior that breaks identical server-side code in every framework, and the reason Next.js/Remix docs require absolute URLs in server-side data fetching.

### BUG-HARDCODE-005 — CORS allowed origin hardcoded to one production domain
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** The server sets `Access-Control-Allow-Origin: 'https://app.example.com'` as a literal instead of echoing the request origin against an environment-derived allowlist. Staging and preview deployments (random subdomains) and localhost development are all blocked, so teams disable CORS entirely or ship per-environment forks that drift. A contract test that issues a cross-origin fetch from a preview URL and asserts the response is permitted, plus a lint check on the CORS configuration module, catches the single-domain pin.
- **Real-world example:** CORS misconfiguration is OWASP API category 1 security-misconfiguration territory; the reflect-one-origin-with-credentials pattern and its single-domain variant are documented in the OWASP CORS misconfiguration and PortSwigger CORS research.

### BUG-HARDCODE-006 — WebSocket URL hardcoded to ws://localhost
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** The client constructs `new WebSocket('ws://localhost:8080/voice')` as a literal instead of deriving the scheme (`wss` when the page is https) and host from `window.location`. In production the upgrade request goes to the developer machine, and browsers additionally block the insecure `ws://` on an `https://` page as mixed content, so the socket never opens in either case. A grep for `ws://` literals in frontend source, plus an E2E test that loads the deployed URL and asserts the socket reaches the open state, catches both halves.
- **Real-world example:** Mixed-content blocking of `ws://` from `https://` pages is enforced by every major browser and documented in the MDN mixed-content and WebSocket secure-transport guidance; hardcoded localhost sockets are a fixture of the WebSocket security literature.

### BUG-HARDCODE-007 — Sitemap base URL hardcoded to localhost
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** The sitemap generator writes `<loc>http://localhost:3000/voice/123</loc>` entries from a literal base instead of the deploy-time canonical host. Search engines that fetch the production sitemap index localhost URLs that they can never crawl, so the affected pages are silently dropped from the index and SEO traffic never arrives. A snapshot test on the generated sitemap asserting every `loc` starts with the production canonical URL, plus an SEO audit that fetches `/sitemap.xml` from the deployed host and validates each entry resolves, catches it.
- **Real-world example:** The localhost-sitemap class is a recognized SEO failure documented in Google Search Central's sitemap guidance, which requires absolute, crawlable URLs; production sitemaps pointing at localhost are a repeatable pattern in SPA/static-site audits.

### BUG-HARDCODE-008 — robots.txt sitemap pointer hardcoded to localhost
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** The generated `robots.txt` contains `Sitemap: http://localhost:3000/sitemap.xml` from a literal instead of the canonical host from the environment or request. Crawlers on the production deployment follow the localhost pointer, never discover the real sitemap, and indexation silently breaks while the site itself works. A build-time test that asserts `robots.txt` embeds the deploy-time canonical URL, plus a runtime check that fetches `/robots.txt` from production and asserts a non-localhost sitemap line, catches it.
- **Real-world example:** The robots.txt-to-sitemap pointer chain is documented in RFC 9309 (Robots Exclusion Protocol), which requires the sitemap directive to reference an absolute, fetchable URL; localhost pointers breaking crawls are a repeatable audit finding.

### BUG-HARDCODE-009 — OAuth redirect URI hardcoded to the dev callback
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** The OAuth client configuration sets `redirect_uri` to `http://localhost:3000/callback` as a literal instead of deriving it from the environment. Production logins are rejected by the provider with `redirect_uri_mismatch` (the registered URI doesn't match), or worse, redirect the user's browser back to localhost where the code is lost, so no one can sign in. A unit test on the auth-config builder asserting the redirect derives from `APP_URL`, plus a staging login smoke test that completes the full OAuth round trip, catches it.
- **Real-world example:** `redirect_uri_mismatch` is the most common OAuth integration failure and is documented in the OAuth 2.0 spec (RFC 6749 §3.1.2.3) and in every major provider's integration guide (Google, Auth0, GitHub), which require exact match with the registered callback.

### BUG-HARDCODE-010 — Webhook callback URL hardcoded to a dev tunnel
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** An integration registers `https://abc123.ngrok.io/webhooks/voice` as its callback at boot from a literal instead of deriving it from `APP_URL`. When the tunnel dies or another developer's tunnel replaces it, the provider posts events to a dead URL and orders or messages are silently lost — there is no error in the app because the app never sees the events. A startup assertion that the registered webhook host matches the configured `APP_URL`, plus provider-side delivery-failure monitoring, catches the mismatch.
- **Real-world example:** The dead-tunnel webhook class is a documented failure mode in Stripe and Twilio integration guides, which warn that ngrok-style development tunnels must never ship to production and that missed webhook deliveries are silent.

### BUG-HARDCODE-011 — CDN asset base URL hardcoded in frontend source
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** Image and logo URLs are built from a literal `cdn.example.com` string embedded in frontend modules instead of a `NEXT_PUBLIC_CDN_URL` environment value. Switching CDN providers, moving to a staging mirror, or deploying to a new region serves 404s for every asset while the page renders with broken images and missing icons. A CI grep for the literal host under `src/**`, plus a visual smoke test that asserts zero failed image/network requests on the deployed URL, catches the pin.
- **Real-world example:** Hardcoded asset hosts breaking after a CDN migration are a repeatable pattern in frontend audits; asset URLs are supposed to flow from build-time environment variables per the Next.js and Vite static-asset documentation.

### BUG-HARDCODE-012 — Upload preview URL built from a localhost literal
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** After a successful upload the component builds the preview `src` as `http://localhost:5173${path}` from a literal instead of using the storage layer's public-URL builder. Uploads succeed but every preview breaks for other users and other deployments, and because the upload path is fine, the bug is attributed to the browser. A component test asserting the preview `src` equals the storage layer's public URL for a fixture path, plus an E2E upload flow on staging, catches it.
- **Real-world example:** Storage backends (S3, Supabase Storage, Cloudflare R2) expose signed or public URLs through their SDKs; building preview URLs by hand from a literal is a documented anti-pattern in the Supabase Storage and AWS S3 presigned-URL guidance.

### BUG-HARDCODE-013 — Auth emulator endpoint hardcoded to port 4010
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** The client's auth configuration points at `http://127.0.0.1:4010` — the local auth-emulator port — unconditionally instead of only when a dev/test flag is set. Local development works while every deployed environment fails token issuance, so the auth bug appears only in production where it is most expensive to debug. A config test asserting the emulator endpoint is set only under `NODE_ENV=test|development`, plus a production login E2E against the deployed environment, catches it.
- **Real-world example:** Supabase documents port 4010 as the local auth-emulator port and instructs that `SUPABASE_AUTH` emulator settings must be conditional on the environment; shipping emulator endpoints unconditionally is a documented anti-pattern in the Supabase local-development guide.

### BUG-HARDCODE-014 — Provider project URL hardcoded from a local .env into committed source
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** A `createClient('https://abcdefghij.supabase.co', ...)` call with a URL pasted from one developer's local project is committed to the repository instead of reading `SUPABASE_URL` from the environment. Every other environment silently reads and writes that one developer's database, so staging data appears in prod or vanishes, and the wrong-project attribution is invisible until someone inspects the rows. A grep for `supabase.co` literals in committed source, plus an env-schema test requiring `SUPABASE_URL` to be present, catches it.
- **Real-world example:** Committing provider URLs alongside keys is part of the hardcoded-secret class tracked by GitGuardian's annual State of Secrets Sprawl reports; the Supabase docs explicitly instruct deriving the client from environment variables to avoid cross-environment drift.

### BUG-HARDCODE-015 — Email verification link hardcoded to the dev domain
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** The mailer template builds the verification link as `http://localhost:3000/verify?token=...` from a literal instead of the deploy-time `APP_URL`. Every verification email sent in production links to localhost, so users cannot confirm accounts, signup conversion collapses, and support absorbs the blame. A template snapshot test asserting the link host equals `APP_URL`, plus an E2E test that completes signup against a staging send and clicks the emailed link, catches it.
- **Real-world example:** Verification and password-reset links pointing at localhost are a classic production failure documented in the OWASP Authentication Cheat Sheet, which requires all links in transactional email to derive from the canonical application URL.

### BUG-HARDCODE-016 — Payment gateway endpoint hardcoded to the sandbox host
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** The gateway client targets the sandbox URL literal in production code instead of deriving the endpoint from a `PAYMENT_ENV`/provider-mode setting. Live charges route to the test gateway or fail outright, and reconciliation between app state and the real provider diverges with every transaction. A config test asserting the endpoint derives from the provider-mode setting, plus a prod smoke charge in the provider's test mode against the live host, catches the sandbox pin.
- **Real-world example:** Stripe and PayPal document separate test/live API hosts and warn that hardcoding the test host is the most common sandbox-in-production failure; the pattern is a fixture of payment-integration checklists.

### BUG-HARDCODE-017 — https scheme hardcoded onto a plaintext local service
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** A client builds `https://localhost:9901/...` for an internal analytics service that only serves plaintext http, because every other service in the same module uses https. Every local call fails the TLS handshake, and the developer concludes the service is down rather than inspecting the scheme. A config schema with per-service scheme validation, plus a smoke test that issues a request with the configured scheme and asserts a response, catches the wrong scheme.
- **Real-world example:** The plaintext-internal-service class is documented in gRPC and local-service deployment guides where the shipped binary serves `InsecureServerCredentials()` only; assuming https for it is a repeatable integration failure.

### BUG-HARDCODE-018 — Mobile deep-link scheme hardcoded to one app id
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** Push and email templates hardcode `myapp://voice/new` for one bundle identifier instead of deriving the scheme from the build's bundle-id configuration. Rebranded or white-label builds open the wrong app or nothing at all, and attribution for the tap is lost. A build-time test asserting the scheme derives from the bundle-id config, plus a device smoke test that taps the link in the rebranded build, catches it.
- **Real-world example:** Custom URL schemes are registered per bundle identifier per the Apple and Android platform documentation; hardcoded schemes breaking after rebrand are a recognized mobile-release failure documented in both platforms' deep-linking guides.

### BUG-HARDCODE-019 — API version prefix /v1 hardcoded in the client
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** Client request paths hardcode `/v1/...` while the server migrates to `/v2`, so the version is fixed in one place that the server no longer controls. When the server deprecates `/v1` at the announced cutover date, the client keeps calling it and fails with 404/410 across every endpoint simultaneously. A contract test comparing the client's path constants against the OpenAPI server/version enums, plus a deprecation audit on the client before each cutover, catches the drift.
- **Real-world example:** API version deprecation is OWASP API9 (Improper Inventory Management); the shadow-API class where a client's hardcoded version trails the server's is documented in the OWASP API Security Top 10 and in versioned-API migration guides.

### BUG-HARDCODE-020 — Health-check path hardcoded mismatching the server route
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** The load balancer or compose healthcheck polls `/health` while the server exposes `/healthz`, because the path is fixed in the manifest and the server route table evolved independently. The container is marked unhealthy and restarted forever despite a working application, producing flapping deploys. A manifest lint that compares the healthcheck path with the server's route table, plus a deploy smoke test asserting healthy status after boot, catches the mismatch.
- **Real-world example:** The healthcheck-path-mismatch class is documented in the Docker Compose and Kubernetes probe documentation, where a probe pointed at the wrong path produces exactly the restart-loop failure.

### BUG-HARDCODE-021 — OpenAPI server URL pinned to staging
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** The OpenAPI spec's `servers` array pins `https://staging-api.example.com` as a literal instead of listing production and allowing an environment override. Generated SDK clients default to the staging host in production builds, so writes land in the wrong environment and the divergence is invisible until data is compared across environments. A spec lint asserting the servers list contains production and is overridable, plus a generated-client smoke test against the configured host, catches the pin.
- **Real-world example:** The OpenAPI `servers` field is documented in the OpenAPI Specification 3.x as the mechanism for environment-specific base URLs; pinning a single environment host is a recognized spec-lint finding in API governance tooling.

### BUG-HARDCODE-022 — In-cluster service DNS name hardcoded across namespaces
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** A client hardcodes `http://voice-api.default.svc.cluster.local` instead of deriving the namespace from the deployment context or a service-discovery variable. Deploying to another namespace or a staging cluster resolves nothing, producing DNS failure loops that look like a dead service. A manifest lint banning hardcoded `svc.cluster.local` in favor of env-based discovery, plus a helm/kustomize template test rendering the namespace per environment, catches it.
- **Real-world example:** Kubernetes service DNS names include the namespace by construction (documented in the Kubernetes DNS for Services and Pods guide); hardcoding the namespace across environments is a recognized helm-template failure.

### BUG-HARDCODE-023 — Docker service hostname hardcoded breaking host runs
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** The app connects to `http://redis:6379` — the compose service name — even when run directly on the host, because the connection string is fixed in code. Host runs fail DNS resolution, and developers work around it by editing `/etc/hosts`, accumulating local-only hacks that never ship. An env-schema test defaulting `REDIS_HOST` to localhost outside compose, plus an integration test that runs the app without compose, catches it.
- **Real-world example:** Docker Compose resolves service names only inside the compose network (documented in the Compose networking guide); using the service name from host processes is the classic local-development failure the guide warns about.

### BUG-HARDCODE-024 — Trailing-slash mismatch on the hardcoded base URL
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** The base URL `https://api.example.com` is joined with paths inconsistently — one module produces `/voice`, another `//voice` — because the join logic assumes a base without a trailing slash while the configured base has one. Strict routers reject the double-slash form with 404s, while local development against a lenient dev server masks the difference. A unit test on the URL joiner covering both base forms, plus a contract test against the production router, catches the mismatch.
- **Real-world example:** Trailing-slash handling differences between routers (Express, FastAPI, Next.js) are documented in each framework's routing guide; the double-slash 404 from naive URL concatenation is a recognized contract-testing finding.

### BUG-HARDCODE-025 — Dev proxy target hardcoded to 127.0.0.1 and shipped to CI
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** The vite.config.ts dev proxy targets `http://127.0.0.1:3000` unconditionally instead of reading the target from the environment. CI and E2E runs against a remote API route through localhost and fail, while local development works, so the config drift is invisible to the developer. A config test asserting the proxy target reads the environment, plus a CI E2E run configured with a remote API base, catches it.
- **Real-world example:** The Vite dev-server proxy is documented in the Vite configuration guide as expecting an environment-derived target; hardcoded 127.0.0.1 targets breaking CI are a repeatable pattern in frontend CI audits.

### BUG-HARDCODE-026 — GraphQL endpoint hardcoded diverging from the codegen introspection URL
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** The client hardcodes `/graphql` on one host while the code-generation step introspects the schema on another, so the two URLs are fixed independently and drift. Generated types match a different schema, and runtime field mismatches surface as `undefined` at render time rather than a build error. A CI codegen-freshness check diffing the schema hash against the endpoint the client uses, plus a runtime test asserting no required fields are undefined, catches the divergence.
- **Real-world example:** GraphQL Code Generator documents endpoint configuration as a single source for both introspection and runtime; divergent endpoints producing undefined-at-render are a recognized codegen-freshness failure in the GraphQL tooling literature.

### BUG-HARDCODE-027 — RSS/Atom feed links hardcoded to localhost
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** The feed generator writes `<link>` and `<atom:link href>` values from a localhost literal instead of the canonical host. Feed readers and podcast clients on the production deployment point at localhost, so subscriptions break silently and the feed appears healthy from the app's perspective. A snapshot test on the feed XML asserting canonical https URLs, plus a feed-validator run in CI against the deployed host, catches it.
- **Real-world example:** The RSS 2.0 and Atom (RFC 4287) specifications require absolute, resolvable URLs in link elements; localhost feed links are a recognized podcast/rss-audit finding documented in feed-validator tooling.

### BUG-HARDCODE-028 — Analytics ingest endpoint hardcoded to one region
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** The client posts analytics events to a literal region-specific ingest host instead of deriving the host from the user's region configuration. Users in other regions are blocked by data-residency rules or suffer high-latency cross-region sends, and events are dropped without any client-side error surfaced to monitoring. A config test asserting the ingest host per region, plus a client-side delivery-failure counter that alerts when drops exceed a threshold, catches it.
- **Real-world example:** Data-residency-aware ingest endpoints are documented in analytics-platform deployment guides (Segment, Amplitude regional endpoints); hardcoded single-region hosts breaking residency compliance are a recognized pattern in privacy audits.

### BUG-HARDCODE-029 — Binary download mirror URL hardcoded without fallbacks
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** The installer or updater downloads binaries from one literal mirror URL instead of a configurable mirror list with fallbacks. A mirror outage or geo-block breaks all installs and upgrades, and because the failure is in the download loop, users see a hung installer with no actionable error. A build test asserting the mirror list comes from config with at least one fallback, plus a CI download smoke test against each mirror, catches the single-mirror pin.
- **Real-world example:** Multi-mirror download strategies are documented in package-manager and updater guides (Homebrew, VS Code update infrastructure); single-mirror pins causing fleet-wide update failures are a recognized supply-chain availability pattern.

### BUG-HARDCODE-030 — OG-image URL hardcoded to the dev origin
- **Category:** Hardcoded Issue · hardcoded-url
- **Description:** The metadata builder sets `og:image` to `http://localhost:3000/og.png` from a literal instead of an absolute https URL derived from the canonical host. Link previews on production show broken images or nothing, and social click-through drops without any error in the app itself. A metadata snapshot test asserting absolute https URLs for all `og:` tags, plus a crawler-simulation check (an OpenGraph validator in CI fetching the deployed page), catches it.
- **Real-world example:** The OpenGraph protocol requires absolute URLs for image tags (documented in the OGP specification); localhost og:image URLs breaking link previews are a recognized SEO/social-audit finding in crawler tooling.

### BUG-HARDCODE-031 — Required env var read without fail-fast validation
- **Category:** Hardcoded Issue · env-assumed
- **Description:** Code reads `process.env.VOICE_API_KEY` at each call site with no startup schema validation, so an unset variable silently produces `undefined` in request headers and 401 responses that surface far from boot. The root cause costs a debugging session because nothing fails at startup. A zod-style env schema parsed once at boot that throws listing every missing required variable, plus a CI test that boots the app with a stripped environment, catches it at startup.
- **Real-world example:** The unset-required-env-var class is a recognized Next.js/Vite production failure; both frameworks' docs recommend validating `process.env` at module load precisely because unset variables fail silently downstream.

### BUG-HARDCODE-032 — Database connection string committed to the repo
- **Category:** Hardcoded Issue · hardcoded-secret
- **Description:** A `postgres://user:password@host` credential literal is pasted into a config file committed to git instead of reading `DATABASE_URL` from the environment. Anyone with repo access — or anyone who obtains a leaked fork — holds live credentials, and rotation requires a code change plus redeploy. A secret scanner (gitleaks/trufflehog) wired into pre-commit and CI, plus a grep for credential-bearing connection strings in committed source, catches it before merge.
- **Real-world example:** Secrets committed to public repositories are tracked at scale by GitGuardian's State of Secrets Sprawl reports (over 10 million new secrets detected on GitHub in 2022 alone); the Uber 2016 incident began with a hardcoded AWS credential in a public repo.

### BUG-HARDCODE-033 — Secret API key hardcoded in the client bundle
- **Category:** Hardcoded Issue · hardcoded-secret
- **Description:** A secret key literal is embedded in frontend source and shipped inside the JS bundle to every visitor. Anyone can read the key from DevTools, and abuse or quota drain is billed to the account with no per-user attribution. A bundle audit scanning built assets for key-shaped patterns, plus a contract test proving client calls never carry the secret (it stays behind a server proxy), catches it before release.
- **Real-world example:** The client-bundle-key class is documented in the OWASP API Security Top 10 (API8/keys in client code) and in Stripe's integration guide, which requires secret keys to stay server-side while only publishable keys ship to the browser.

### BUG-HARDCODE-034 — JWT signing secret hardcoded in source
- **Category:** Hardcoded Issue · hardcoded-secret
- **Description:** An HS256 signing secret literal sits in a constants file and is used to both sign and verify tokens. Token forgery becomes possible for anyone with the source, and rotating the secret requires a redeploy that invalidates every active session at once. A secret scanner in CI, plus a unit test asserting the secret is read from the environment at boot with fail-fast validation, catches the literal.
- **Real-world example:** Hardcoded JWT secrets enabling token forgery are a documented failure class in the OWASP JWT Cheat Sheet and in the jsonwebtoken library's guidance, which requires secrets from environment configuration.

### BUG-HARDCODE-035 — Feature flag hardcoded on
- **Category:** Hardcoded Issue · flag-assumed
- **Description:** `const ENABLE_NEW_VOICE = true` sits in source instead of a flag service or environment value. Rollout cannot be paused without a redeploy, incident response is slowed to deploy speed, and staging/prod parity is assumed rather than controlled. A lint rule banning boolean constants named `ENABLE_*`/`DISABLE_*` outside the config module, plus a CI grep, catches the literal.
- **Real-world example:** Feature-flag systems (LaunchDarkly, Unleash) exist precisely because hardcoded flags cannot be toggled without a deploy; the pattern is documented in Martin Fowler's feature-toggles guidance as an anti-pattern when left in code after release.

### BUG-HARDCODE-036 — Feature flag hardcoded off during debugging and left behind
- **Category:** Hardcoded Issue · flag-assumed
- **Description:** A `false` literal is left in place of a flag after a debugging session, so the gated feature never ships in any environment. QA sees dead code paths that tests still cover, and behavior drifts between what is tested and what runs in production. A coverage report showing tested-but-unreachable branches, plus a grep for `= false` adjacent to feature names, catches the dead flag.
- **Real-world example:** The leftover-false-flag class is a recognized code-review failure documented in Fowler's feature-toggles guidance, which requires removing or activating flags before the feature is considered shipped.

### BUG-HARDCODE-037 — HTTP client timeout hardcoded at 30000 ms
- **Category:** Hardcoded Issue · magic-number
- **Description:** `timeout: 30000` is a literal on a shared fetch wrapper applied to every endpoint. Slow operations (voice synthesis, LLM streaming) are aborted at 30 seconds in production while development responds fast, so the error rate spikes only under real latency. A unit test parametrizing the timeout per client, plus a config test asserting the wrapper reads per-endpoint timeout budgets, catches the single-value pin.
- **Real-world example:** Per-endpoint timeout budgets are standard practice in API gateway design (AWS API Gateway, Envoy per-route timeouts); a single global timeout aborting slow endpoints is a recognized reliability-antipattern in the Google SRE book's timeout chapter.

### BUG-HARDCODE-038 — Database connection pool size hardcoded
- **Category:** Hardcoded Issue · magic-number
- **Description:** `pool: { max: 10 }` is a literal in the ORM config applied identically to every deployment topology. Serverless and many-instance deployments exhaust Postgres `max_connections`, and "too many connections" errors appear only at scale where they are most expensive. A config test asserting the pool size derives from the environment, plus a connection-count monitor alerting near the database limit, catches the literal.
- **Real-world example:** Connection-pool sizing is documented in Supabase's connection-pooler and Prisma's connection-pool guides, which require per-instance sizing because each instance multiplies the pool against a fixed server limit.

### BUG-HARDCODE-039 — Retry attempts hardcoded at 3
- **Category:** Hardcoded Issue · magic-number
- **Description:** A retry wrapper loops `for (let i = 0; i < 3; i++)` with the count fixed for every operation class. Transient provider hiccups (429/503) fail after three tries for idempotent long jobs that need more, while non-idempotent operations retry pointlessly and risk duplicates. A unit test asserting retry counts per operation class from config, plus an integration test simulating four consecutive failures, catches the fixed count.
- **Real-world example:** Per-operation retry budgets are documented in the Google SRE book's and AWS SDK's retry guidance; a single hardcoded count failing under real provider rate limits is a recognized reliability pattern.

### BUG-HARDCODE-040 — Exponential backoff hardcoded without jitter
- **Category:** Hardcoded Issue · magic-number
- **Description:** Backoff is computed as `2 ** attempt * 1000` with no jitter and no configuration, so every client instance retries on the same schedule. Synchronized retries create a thundering herd that the provider rate-limits as a block, turning a transient hiccup into an outage window. A unit test asserting jitter is present in the computed delay, plus a load test showing a smoothed retry distribution, catches the missing jitter.
- **Real-world example:** Exponential backoff with jitter is the documented requirement in the AWS Architecture Blog's and Google SRE's retry guidance; synchronized retries without jitter are the recognized thundering-herd failure mode both sources describe.

### BUG-HARDCODE-041 — Page-size clamp mismatch between admin setter and server reader
- **Category:** Hardcoded Issue · magic-number
- **Description:** The admin UI setter accepts `page_size` values 5–100 while the server-side reader clamps the same parameter to 5–50, because the two bounds are fixed independently in code. An admin picking 100 rows per page silently gets 50 back, and "next" links compute wrong offsets — the mismatch is invisible until someone counts the returned rows. A contract test asserting the setter's maximum equals the reader's clamp, plus an integration test that requests the setter's maximum and counts returned rows, catches the drift.
- **Real-world example:** The setter-clamps-wider-than-reader class is a recognized pagination contract failure: an admin picking 100 rows per page received 50 because the reader clamped to 5–50 while the setter allowed 5–100 — the exact mismatch pattern pagination contract tests exist to catch.

### BUG-HARDCODE-042 — PORT env default mismatching the platform-injected port
- **Category:** Hardcoded Issue · env-assumed
- **Description:** The server binds `PORT ?? 8080` while the platform injects a different port and the proxy/healthcheck configuration assumes it. An unset variable silently binds the wrong port, healthchecks point elsewhere, and deploys flap between healthy and restarting. A config schema test asserting the port is required (not defaulted) in production, plus a boot log assertion printing the bound port, catches the mismatch.
- **Real-world example:** Heroku and Fly.io inject the listen port through the environment and document that a fallback to a different default breaks healthchecks and routing; the pattern is a fixture of PaaS deployment guides.

### BUG-HARDCODE-043 — Log level hardcoded to debug in production
- **Category:** Hardcoded Issue · env-assumed
- **Description:** `logLevel: 'debug'` is a literal shipped to production instead of deriving from the environment with a production-safe default. Request bodies containing PII are written to logs, log volume and cost spike, and real errors are buried in noise. A config test asserting the level derives from the environment with `info` as the production default, plus a log-redaction scan on a production-like run, catches the debug pin.
- **Real-world example:** PII leakage through debug logging is a documented compliance failure in the OWASP Logging Cheat Sheet, which requires log levels to be environment-configurable and sensitive fields redacted.

### BUG-HARDCODE-044 — NODE_ENV assumed rather than explicitly set per deploy path
- **Category:** Hardcoded Issue · env-assumed
- **Description:** Code branches on `process.env.NODE_ENV === 'production'` while only some deploy paths (Docker builds) set it and others (serverless, bare node) don't. Caching, compression, and error-detail behavior flip between environments, and framework error pages leak internals on the path that never sets the variable. An integration test running each deploy path asserting the effective environment, plus a config test requiring an explicit `APP_ENV`, catches the assumption.
- **Real-world example:** The NODE_ENV assumption class is documented in the Next.js and Express documentation, which warn that serverless and non-Docker paths don't set it and that framework error pages leak when the check fails open.

### BUG-HARDCODE-045 — Redis TTL hardcoded at 3600 seconds for all keys
- **Category:** Hardcoded Issue · magic-number
- **Description:** Cache writes use an `EX 3600` literal for every key class instead of deriving the TTL from a per-key-type configuration. Voice transcripts are cached for an hour where staleness tolerance is minutes, and users receive stale data with no error anywhere. A unit test asserting the TTL per key class from config, plus a cache-staleness integration test that writes and reads across the tolerance boundary, catches the single-value pin.
- **Real-world example:** Per-key TTL policies are documented in Redis's own caching patterns guide; a single hardcoded TTL serving stale data is a recognized cache-design failure mode in the Redis documentation.

### BUG-HARDCODE-046 — Webhook signing secret committed to the repo
- **Category:** Hardcoded Issue · hardcoded-secret
- **Description:** A provider signing secret literal sits in source and is used to verify webhook HMAC signatures. Attackers who obtain the source can forge webhook events such as fake payment confirmations, and rotation requires a redeploy. A secret scanner in CI, plus a unit test asserting the secret loads from the environment and that verification rejects unsigned events, catches the literal.
- **Real-world example:** Forged webhook events via leaked signing secrets are a documented attack class in Stripe's webhook guide, which requires signature verification with a secret stored outside the codebase.

### BUG-HARDCODE-047 — Encryption IV hardcoded and reused across records
- **Category:** Hardcoded Issue · hardcoded-secret
- **Description:** A fixed IV literal is reused for AES-GCM encryption of stored voice data instead of generating a random IV per encryption. IV reuse in GCM breaks confidentiality guarantees, making ciphertexts malleable and potentially decryptable across records. A crypto unit test asserting a distinct random IV per encryption, plus static analysis for literal IVs in source, catches the reuse.
- **Real-world example:** IV reuse in AES-GCM is a documented catastrophic failure mode in NIST SP 800-38D and in the OWASP Cryptographic Storage Cheat Sheet; theNonce-reuse class has broken production systems in multiple disclosed incidents.

### BUG-HARDCODE-048 — Default admin credentials seeded at boot
- **Category:** Hardcoded Issue · hardcoded-secret
- **Description:** A seed script inserts `admin@example.com` with a fixed password literal at boot instead of deriving initial credentials from the environment or requiring setup. Production deployments ship with known credentials, enabling full account takeover on day one. A seed-script lint banning literal passwords, plus a boot check that refuses to start in production with default credentials present, catches it.
- **Real-world example:** Default credentials are OWASP A07 (Identification and Authentication Failures) territory; the default-password class is documented in the OWASP Deployment Cheat Sheet, which requires removing seeded credentials before production release.

### BUG-HARDCODE-049 — Session lifetime hardcoded at 24 hours
- **Category:** Hardcoded Issue · magic-number
- **Description:** `maxAge: 24 * 60 * 60 * 1000` is a literal on the session cookie instead of deriving from per-client policy. Enterprise SSO deployments that need shorter lifetimes and mobile clients that need longer cannot be configured, and "log out everywhere" cannot shorten active sessions. A config test asserting the lifetime derives from environment or client policy, plus an auth integration test with a shortened policy, catches the literal.
- **Real-world example:** Session-lifetime policy per client class is documented in the OWASP Session Management Cheat Sheet, which requires configurable lifetimes; a fixed 24-hour cookie is a recognized finding in security reviews.

### BUG-HARDCODE-050 — Cloud provider region hardcoded to us-east-1
- **Category:** Hardcoded Issue · env-assumed
- **Description:** The boto3/SDK client is created without a region argument or with a literal `us-east-1` instead of reading the region from the environment. Data-residency requirements for EU users are violated, cross-region latency degrades every request, and deploys to other regions fail quota checks. A config test asserting the region derives from the environment, plus a residency audit listing where stored data physically lands, catches the pin.
- **Real-world example:** GDPR data-residency requirements make region selection a compliance control; hardcoded us-east-1 regions breaking EU deployments are a recognized cloud-audit finding documented in AWS and GCP residency guidance.

### BUG-HARDCODE-051 — Debug/BYPASS flag left true after a fix
- **Category:** Hardcoded Issue · flag-assumed
- **Description:** A `DEBUG_MODE = true` literal is used to bypass a validation step during a debugging session and left in place. The validation never runs in production, malformed data is accepted, and the bypass survives review because it reads like configuration rather than a code change. A grep for `DEBUG`/`BYPASS`/`SKIP` boolean literals outside the config module, plus a review-checklist item on changed flags, catches the dead bypass.
- **Real-world example:** The debug-bypass-left-behind class is a recognized code-review failure mode; bypass flags that look like config are the documented reason review checklists require flag diffs on every change.

### BUG-HARDCODE-052 — Cron interval env default mismatching the prod schedule
- **Category:** Hardcoded Issue · env-assumed
- **Description:** The scheduler reads `CRON_INTERVAL ?? '*/5 * * * *'` while production expects an hourly schedule, so an unset variable silently runs the job every five minutes. Duplicate sends, quota drain, and cost spikes follow, with nothing in the logs explaining the changed cadence. A config test asserting the schedule is required (not defaulted) in production, plus a dry-run smoke test printing the effective schedule at boot, catches the mismatch.
- **Real-world example:** Cron-default mismatches are a recognized cost-spike failure documented in job-scheduler guides (node-cron, pg_cron), which require explicit schedules per environment because defaults silently change job frequency.

### BUG-HARDCODE-053 — Service-account keyfile path hardcoded to a repo-relative default
- **Category:** Hardcoded Issue · env-assumed
- **Description:** The credentials path is a literal like `./secrets/sa.json` instead of reading `GOOGLE_APPLICATION_CREDENTIALS` from the environment. Deploys with a different secret layout fail auth at runtime, and the literal leaks repository structure into production paths. A config test asserting the path comes from the environment with an existence check at boot, plus a boot smoke test, catches the literal.
- **Real-world example:** The service-account-keyfile class is documented in Google Cloud's authentication guide, which requires the path via `GOOGLE_APPLICATION_CREDENTIALS` and warns that repo-relative defaults break in every non-local deployment.

### BUG-HARDCODE-054 — SMTP credentials hardcoded in the mailer config
- **Category:** Hardcoded Issue · hardcoded-secret
- **Description:** The mailer config embeds SMTP user and password literals instead of reading them from the environment. The mail account is compromised through repo access, send-as abuse becomes possible, and rotation requires a redeploy. A secret scanner in CI, plus a config test asserting credentials load from the environment with fail-fast validation, catches the literals.
- **Real-world example:** Compromised SMTP credentials enabling spoofed sends are a documented attack class in the OWASP Email Security guidance; SPF/DKIM send-as abuse via leaked mailer credentials is a recognized secrets-sprawl pattern.

### BUG-HARDCODE-055 — OAuth client secret committed to the repo
- **Category:** Hardcoded Issue · hardcoded-secret
- **Description:** An OAuth `client_secret` literal sits in a config file that ships to the repository (not just the bundle). Token exchange becomes forgeable by anyone with repo access, and recovery requires revoking the client at the provider. A secret scanner in CI, plus a config test asserting the secret loads from the environment, catches the literal.
- **Real-world example:** Leaked OAuth client secrets are a documented failure class in the OAuth 2.0 Threat Model (RFC 6819) and in provider integration guides (Auth0, Google), which require secrets from environment configuration.

### BUG-HARDCODE-056 — Third-party SDK key embedded in the mobile binary
- **Category:** Hardcoded Issue · hardcoded-secret
- **Description:** An API key literal sits in native/mobile code and is compiled into the shipped APK/IPA. Keys are extracted from the binary via apktool or class-dump, and quota abuse is billed to the account with no device attribution. A binary scan of built artifacts for key-shaped patterns, plus a proxy test proving device calls route through a server that holds the secret, catches the embedded key.
- **Real-world example:** Keys extracted from mobile binaries are a documented attack class in the OWASP Mobile Top 10 (M8/M9) and in mobile-recon tooling (apk-redteam pipelines recover hardcoded keys and endpoints from decompiled APKs as a standard step).

### BUG-HARDCODE-057 — Config file path hardcoded relative to the CWD
- **Category:** Hardcoded Issue · env-assumed
- **Description:** The app loads `./config/voice.yaml` relative to the current working directory instead of resolving from an environment variable. Runs from a different CWD (systemd units, Docker WORKDIR mismatch) silently use defaults or crash with ENOENT, and the failure mode differs by launch method. An integration test launching the app from a different CWD, plus a config test asserting absolute path resolution from the environment, catches it.
- **Real-world example:** CWD-relative config paths breaking under systemd and Docker are a documented failure class in the systemd.exec and Docker WORKDIR documentation; the pattern is a recognized deployment-audit finding.

### BUG-HARDCODE-058 — Canary rollout percentage hardcoded in code
- **Category:** Hardcoded Issue · flag-assumed
- **Description:** A canary gate uses `if (hash(userId) % 100 < 10)` with the 10% fixed in code instead of reading the percentage from a flag service. The canary percentage cannot be adjusted during an incident, and the in-code hash function differs from the flag service's, splitting users inconsistently between systems. A unit test asserting the percentage comes from config, plus a flag-service parity test comparing assignment for a sample of user ids, catches the drift.
- **Real-world example:** Canary rollout percentages are standard config in progressive-delivery systems (Argo Rollouts, LaunchDarkly); hardcoded percentages that cannot be adjusted mid-incident are a recognized reliability-antipattern in progressive-delivery guides.

### BUG-HARDCODE-059 — Per-request LLM token budget hardcoded
- **Category:** Hardcoded Issue · magic-number
- **Description:** LLM calls cap `max_tokens: 512` for every endpoint instead of deriving the budget per endpoint from config. Long voice-structuring outputs are truncated mid-JSON and parse errors surface downstream, while short endpoints waste quota. A unit test asserting the budget per endpoint from config, plus a contract test asserting full JSON parse on the longest sample input, catches the single-value pin.
- **Real-world example:** Per-endpoint token budgets are standard practice in LLM API design (OpenAI and Anthropic docs recommend budget per use case); a single hardcoded `max_tokens` truncating structured output is a recognized LLM-integration failure.

### BUG-HARDCODE-060 — Job-queue worker concurrency hardcoded
- **Category:** Hardcoded Issue · magic-number
- **Description:** The worker bootstrap sets `concurrency: 4` as a literal instead of deriving it from `os.cpus()` or an environment variable. Small CI machines thrash while large production machines idle, and the effective concurrency is the same everywhere despite different hardware. An integration test asserting concurrency derives from the CPU count or environment, plus a load test on both small and large runners, catches the literal.
- **Real-world example:** Hardware-derived worker concurrency is documented in BullMQ's and PM2's scaling guides, which require deriving concurrency from the machine; a single hardcoded count thrashing small runners is a recognized CI-performance failure.

### BUG-HARDCODE-061 — Role string trusted from the client request body
- **Category:** Hardcoded Issue · role-assumed
- **Description:** The handler authorizes privileged actions by comparing `req.body.role === 'admin'` instead of deriving the role from the session or JWT. Any client can POST `role=admin` and escalate, and the authenticated session is ignored entirely. A security test POSTing `role=admin` without a privileged session and asserting 403, plus a lint rule banning body-derived role checks in authorization paths, catches it.
- **Real-world example:** Role strings trusted from the client body are a documented mass-assignment failure (OWASP API3); sending `{is_admin:true, role:admin}` on profile and account endpoints and having the server blindly apply it is the recognized exploitation pattern.

### BUG-HARDCODE-062 — Caller identity derived from the client body instead of a trusted header
- **Category:** Hardcoded Issue · role-assumed
- **Description:** The handler trusts `req.body.userId` to identify the caller instead of the `x-anon-id` header set by the edge/auth layer. Users can act as other users by posting a different id, write to someone else's voice box, and the audit trail records the forged identity. A security test posting a mismatched body userId and asserting the header identity wins, plus an integration test asserting audit rows use the header identity, catches it.
- **Real-world example:** The identity-from-header pattern is a recognized P0 fix class: production code derives the caller identity from the `x-anon-id` header set by the edge rather than trusting the client body, because body-trusted identity enables user impersonation and lying audit trails.

### BUG-HARDCODE-063 — Role strings compared case-sensitively across sources
- **Category:** Hardcoded Issue · role-assumed
- **Description:** The auth layer compares `req.user.role === 'ADMIN'` while the database seed stores `'admin'`, because the two sources fix the string independently. Every admin check fails (or an inverted case-insensitive compare over-grants), and the drift is invisible until a role check fails in production. A shared-constant unit test comparing the auth module's role strings with the DB seed's values, plus an integration test exercising each role, catches the drift.
- **Real-world example:** Case-sensitivity drift between role sources is a recognized access-control failure documented in the OWASP Authorization Cheat Sheet, which requires a single source of truth for role identifiers.

### BUG-HARDCODE-064 — Ownership check hardcoded to one author id
- **Category:** Hardcoded Issue · role-assumed
- **Description:** A middleware allows edits only when `record.authorId === 'user_123'`, with the literal id fixed in code from a test seed. Every other legitimate owner is blocked, and the id from a test fixture leaks into production behavior. An integration test with a second owner asserting access, plus a grep for string-literal user ids in `src/**`, catches the literal.
- **Real-world example:** Ownership checks hardcoded to a single id are a recognized broken-object-level-authorization failure (OWASP API1/BOLA); test-seed ids leaking into production code paths are a repeatable pattern in access-control audits.

### BUG-HARDCODE-065 — 'anonymous' hardcoded as the user id masking attribution
- **Category:** Hardcoded Issue · role-assumed
- **Description:** Telemetry and logging stamp `userId: 'anonymous'` when the session is missing instead of a distinct `null`/unauthenticated marker. Real unauthenticated abuse is attributed to every anonymous user collectively, and per-user rate limits misfire against the shared label. A telemetry schema test asserting `null` versus `'anonymous'` semantics, plus a log audit comparing session state with the stamped id, catches the masking.
- **Real-world example:** The anonymous-id-masking class is a recognized attribution failure: production code stamps `'anonymous'` for unauthenticated requests, and a P0 fix derives the real identity from the `x-anon-id` header rather than collapsing all anonymous traffic under one label.

### BUG-HARDCODE-066 — Test user ids hardcoded in production code paths
- **Category:** Hardcoded Issue · role-assumed
- **Description:** Seed fixtures insert `id: 'test-user-1'` and production code paths (a welcome flow, a default assignment) reference the same literal. Production creates records owned by a nonexistent test user, orphaning rows and breaking ownership checks. A grep for test-id literals in `src/**`, plus an integration test asserting the welcome flow uses the real session user, catches the leak.
- **Real-world example:** Test data leaking into production code paths is a recognized data-hygiene failure; hardcoded test ids creating orphaned production records are a repeatable pattern in seed-fixture audits.

### BUG-HARDCODE-067 — Admin allowlist hardcoded in source
- **Category:** Hardcoded Issue · role-assumed
- **Description:** `const ADMINS = ['a@x.com', 'b@x.com']` gates the admin UI instead of deriving the allowlist from the environment or database. Onboarding and offboarding require a code deploy, and ex-employees retain access until the deploy ships. A config test asserting the allowlist comes from the environment or DB, plus an offboarding integration test that revokes access without a code change, catches the literal.
- **Real-world example:** Hardcoded admin allowlists delaying offboarding are a recognized access-governance failure documented in the OWASP Access Control guidance, which requires identity and access decisions to be data-driven.

### BUG-HARDCODE-068 — Tenant id hardcoded as the default in multi-tenant resolution
- **Category:** Hardcoded Issue · role-assumed
- **Description:** The multi-tenant resolver returns a literal `'tenant-default'` when the tenant header is missing instead of rejecting the request. Cross-tenant data leaks into the default tenant, and tenant-scoped queries silently mix rows from multiple tenants. A multi-tenant integration test with two tenants asserting isolation, plus a lint rule banning default-tenant literals in the resolver, catches it.
- **Real-world example:** Missing tenant isolation is OWASP API1 (BOLA) territory in multi-tenant systems; a hardcoded default tenant that absorbs unscoped requests is a recognized cross-tenant-leak pattern in SaaS security audits.

### BUG-HARDCODE-069 — OAuth scope strings hardcoded per handler
- **Category:** Hardcoded Issue · role-assumed
- **Description:** Authorization checks compare `scope === 'voice:write'` literals scattered across individual handlers instead of importing from a shared constants module. Renaming a scope at the token issuer breaks every handler independently, and some handlers miss the rename and keep enforcing the old string. A shared-scope constant test diffing the issuer's scopes with handler usage, plus an integration test exercising each scope, catches the drift.
- **Real-world example:** Scope-identifier drift between issuer and enforcement points is a recognized OAuth failure documented in RFC 6749 §3.3 and in the OAuth 2.0 Threat Model, which require a single scope registry.

### BUG-HARDCODE-070 — Session-cookie name hardcoded mismatching the auth library
- **Category:** Hardcoded Issue · role-assumed
- **Description:** Middleware reads a literal cookie name `'session'` while the auth library sets `__Secure-session` in production, so the two names are fixed independently. Every production request arrives unauthenticated, producing a login loop where the session is set but never read. An integration test asserting the cookie name matches the auth library's configured name, plus a production login E2E, catches the mismatch.
- **Real-world example:** Cookie-name mismatches between set and read paths are a recognized session-management failure documented in the OWASP Session Management Cheat Sheet; the `__Secure-` prefix convention (per the Cookies RFC draft) changes names between environments and breaks literal comparisons.

### BUG-HARDCODE-071 — Bearer-token prefix parsing hardcoded
- **Category:** Hardcoded Issue · role-assumed
- **Description:** The parser strips the scheme with `Authorization.replace('Bearer ', '')`, assuming exact casing and a single space. A lowercase `bearer` or double space yields the scheme characters left inside the token, and valid clients receive 401s. A unit test on the parser covering casing and spacing variants, plus an integration test sending a lowercase bearer header, catches the strict parsing.
- **Real-world example:** The Authorization scheme is case-insensitive per RFC 7235 §2.1 and RFC 6750 §2.1; strict `Bearer `-prefix parsing rejecting valid lowercase schemes is a recognized interop failure documented in both specs.

### BUG-HARDCODE-072 — Permission bit values hardcoded without named constants
- **Category:** Hardcoded Issue · role-assumed
- **Description:** The authz layer checks raw bitmask literals such as `if (perms & 0b100)` with no named constants. Adding a permission shifts bits silently, over- or under-granting, and two modules interpret the same bits differently. A named-constant unit test, plus a property test asserting each permission maps to a unique bit, catches the literal masks.
- **Real-world example:** Bitmask permission literals without named constants are a recognized maintainability and security failure documented in the C++ Core Guidelines and in the OWASP Authorization Cheat Sheet's privilege-management section.

### BUG-HARDCODE-073 — Role hierarchy ladders duplicated per module
- **Category:** Hardcoded Issue · role-assumed
- **Description:** Each module defines its own admin>editor>viewer ladder in code instead of importing from a central hierarchy. The ladders drift, and a viewer in module A outranks an editor in module B, making access reviews inconsistent across the product. A central-hierarchy unit test diffing module ladders against the shared definition, plus an access-review script comparing effective permissions across modules, catches the drift.
- **Real-world example:** Duplicated role hierarchies producing inconsistent effective permissions are a recognized access-governance failure documented in the OWASP Access Control Cheat Sheet, which requires a single authorization model.

### BUG-HARDCODE-074 — Impersonation guard hardcoded to one superuser id
- **Category:** Hardcoded Issue · role-assumed
- **Description:** Support tooling allows impersonation only when `actor.id === 'su_1'`, with the literal id fixed in code. Only that id can impersonate, rotation and offboarding break the tooling, and the id is committed to the repository. An integration test with a second superuser asserting access, plus a grep for `su_` literals in source, catches the literal.
- **Real-world example:** Impersonation gated by a single hardcoded identity is a recognized access-control failure; support tooling tied to one literal id breaking on rotation is a repeatable pattern in internal-tooling audits.

### BUG-HARDCODE-075 — CSRF check trusting a hardcoded referer
- **Category:** Hardcoded Issue · role-assumed
- **Description:** Middleware validates the request by comparing `req.headers.referer === 'https://app.example.com'` instead of verifying a CSRF token. The referer may be absent (privacy settings, referrer-policy headers) or stripped by proxies, so valid requests are blocked, while crafted referers bypass the check. A security test with absent and mismatched referers asserting the token-based check still holds, plus a unit test on the CSRF validation, catches the referer trust.
- **Real-world example:** Referer-based CSRF protection is a documented anti-pattern in the OWASP CSRF Prevention Cheat Sheet, which requires synchronizer tokens because the Referer header is client-controlled and frequently absent.

### BUG-HARDCODE-076 — Webhook auth via a secret embedded in the URL path
- **Category:** Hardcoded Issue · role-assumed
- **Description:** The webhook endpoint is authenticated by a shared secret embedded as a URL path segment (`/webhooks/voice/SECRET123`) instead of a signature header. The secret leaks into access logs and browser history, and rotating it changes the URL, breaking the provider's registration. A security review flagging secrets-in-path, plus a log scan for the secret value, and a header-signature unit test as the fix surface, catch it.
- **Real-world example:** Secrets in URL paths are a documented anti-pattern in the OWASP Logging Cheat Sheet (URLs are logged everywhere) and in provider webhook guides (Stripe, Twilio), which require HMAC signature headers rather than path secrets.

### BUG-HARDCODE-077 — Timestamps formatted in UTC for all viewers
- **Category:** Hardcoded Issue · locale-assumed
- **Description:** The UI formats timestamps with `toISOString()`/UTC getters instead of the viewer's timezone, so the time display is fixed to UTC. A 23:30 UTC event shows as the wrong day for users in UTC+9, and date-filtered queries silently miss boundary records. A component test with a fixed non-UTC timezone asserting local rendering, plus an integration test around a UTC-midnight boundary, catches it.
- **Real-world example:** The UTC-vs-local date display class is a recognized UX failure documented in the MDN Date guide and in the "falsehoods programmers believe about time" literature; timezone-assumed formatting showing the wrong day is its canonical example.

### BUG-HARDCODE-078 — Timezone hardcoded to America/New_York in server code
- **Category:** Hardcoded Issue · locale-assumed
- **Description:** Cron jobs and report code format dates with a literal `America/New_York` instead of deriving the timezone from tenant settings. Tenants in other zones see shifted dates, and scheduled sends land at the wrong local hour. A config test asserting the timezone comes from tenant settings, plus an integration test with two tenants in different zones, catches the literal.
- **Real-world example:** Server-side timezone hardcoding breaking multi-tenant scheduling is a recognized failure documented in the "falsehoods programmers believe about time" literature and in cron/report tooling guides that require per-tenant timezones.

### BUG-HARDCODE-079 — Currency hardcoded to USD without Intl.NumberFormat
- **Category:** Hardcoded Issue · locale-assumed
- **Description:** The pricing UI renders amounts as `$${amount}` with no `Intl.NumberFormat` call, fixing both the symbol and the decimal placement. EU users see dollar amounts with the wrong symbol and `1234.5` instead of `1.234,50`, and amounts are misread. A component test with a de-DE locale asserting `Intl.NumberFormat` output, plus a lint rule banning template-literal currency rendering, catches it.
- **Real-world example:** Locale-sensitive currency formatting via `Intl.NumberFormat` is the documented standard (ECMA-402); hardcoded `$`-prefix rendering showing wrong symbols and decimal placement for non-USD locales is the recognized violation of that standard.

### BUG-HARDCODE-080 — Output language hardcoded to English regardless of input language
- **Category:** Hardcoded Issue · locale-assumed
- **Description:** A voice-structuring prompt instructs "translate to English" for every recording instead of deriving the output language from the input or an explicit language flag. Spanish, Mandarin, and other content is force-translated, losing source fidelity, while the product claims multilingual support the pipeline does not honor. A pipeline test feeding non-English audio/text and asserting the output language matches the input (or the explicit flag) catches the forced translation.
- **Real-world example:** A voice-structuring prompt instructing translation to English regardless of input language is a recognized multilingual-pipeline failure; language-assumed output ignoring the content's language is the documented violation of locale-aware processing guidance.

### BUG-HARDCODE-081 — Date format hardcoded to MM/DD/YYYY in exports
- **Category:** Hardcoded Issue · locale-assumed
- **Description:** Export and report code writes dates as MM/DD/YYYY strings instead of ISO-8601 or a locale-derived format. DD/MM jurisdictions misread 03/04 as April 3, and lexicographic string sorts on the date column break entirely. A unit test asserting ISO-8601 output, plus an export snapshot test with a non-US locale, catches the fixed format.
- **Real-world example:** The MM/DD-vs-DD/MM ambiguity is a recognized data-exchange failure documented in ISO 8601's rationale; Safari's date parser additionally rejects the format outright, making hardcoded MM/DD/YYYY strings a cross-platform failure class.

### BUG-HARDCODE-082 — Number formatting rendered without locale separators
- **Category:** Hardcoded Issue · locale-assumed
- **Description:** Counts and percentages are rendered with `toFixed(2)` and no locale separators, fixing the decimal point and group separators. `12345.678` renders as "12345.68" instead of "12,345.68" for US users or "12.345,68" for German users, who read the former as a different number. A component test asserting `Intl.NumberFormat` output in two locales, plus a visual snapshot test, catches the fixed formatting.
- **Real-world example:** Locale-sensitive number formatting via `Intl.NumberFormat` is the documented standard (ECMA-402); `toFixed`-based rendering that German users misread is a recognized violation of that standard in dashboard audits.

### BUG-HARDCODE-083 — Locale-sensitive case folding via toUpperCase
- **Category:** Hardcoded Issue · locale-assumed
- **Description:** Code uppercases user input with `toUpperCase()` before comparison, fixing the case-folding locale to the runtime's default. In tr-TR, `'i'.toUpperCase()` yields `'İ'`, so `'istanbul'` never matches `'ISTANBUL'` and keyword filters silently fail for Turkish users. A unit test with the tr-TR locale asserting locale-insensitive comparison (explicit folding or `toLocaleUpperCase('en-US')`) catches it.
- **Real-world example:** The Turkish-I problem (`'i'.toUpperCase()` yielding `'İ'` in tr-TR) is the canonical locale-bug example documented in the ECMA-402 spec, the MDN toUpperCase guide, and the "falsehoods programmers believe about names" literature.

### BUG-HARDCODE-084 — RTL layouts not handled
- **Category:** Hardcoded Issue · locale-assumed
- **Description:** Layouts assume left-to-right direction and never set `dir` for Arabic or Hebrew content. RTL text renders with reversed alignment, truncation on the wrong side, and mirrored icon placement, producing overlapping text in dense UI. A component test with `dir='rtl'` asserting layout classes flip, plus a visual snapshot test in an RTL locale, catches the LTR assumption.
- **Real-world example:** RTL mirroring is a documented WCAG 2.2 and MDN internationalization requirement; LTR-assumed layouts breaking Arabic/Hebrew rendering are a recognized i18n-audit finding in both sources.

### BUG-HARDCODE-085 — Pluralization rules hardcoded to English
- **Category:** Hardcoded Issue · locale-assumed
- **Description:** UI code picks strings with `count === 1 ? 'item' : 'items'` instead of `Intl.PluralRules` or i18n plural keys. Languages with zero/one/few/many categories (Polish, Arabic, Russian) render ungrammatical strings, and a count of 0 shows "1 item" in some translations. An i18n test enumerating `Intl.PluralRules` categories for each supported locale and asserting a key exists per category catches it.
- **Real-world example:** `Intl.PluralRules` (ECMA-402) defines per-language plural categories; hardcoded English singular/plural pairs producing ungrammatical strings in Polish and Arabic are the recognized violation of that standard in i18n audits.

### BUG-HARDCODE-086 — First day of week hardcoded to Sunday
- **Category:** Hardcoded Issue · locale-assumed
- **Description:** Calendar components and week aggregation start weeks on Sunday instead of deriving the first day from locale or tenant config. ISO-8601 (Monday-start) jurisdictions aggregate across week boundaries, shifting weekly analytics by one day. A unit test asserting the week start from locale/tenant config, plus an aggregation test around a Monday boundary, catches the fixed start day.
- **Real-world example:** ISO 8601 defines Monday as the first day of the week while US convention uses Sunday; hardcoded Sunday-start weeks shifting ISO-jurisdiction analytics are a recognized date-handling failure documented in calendar-library guides (date-fns, Luxon).

### BUG-HARDCODE-087 — Decimal separator assumed in input parsing
- **Category:** Hardcoded Issue · locale-assumed
- **Description:** Form inputs are parsed with `parseFloat` semantics that treat `'1,5'` as `1`, fixing the decimal separator to the dot. European users entering comma decimals get wrong values stored silently, corrupting prices and quantities. A form test with `'1,5'` input asserting the correct parse per locale, plus validation rejecting ambiguous input with a clear message, catches it.
- **Real-world example:** Comma-decimal input corruption is a recognized form-handling failure documented in the MDN parseFloat guide and in ECMA-402's number-parsing guidance, which requires locale-aware parsing for user-entered numbers.

### BUG-HARDCODE-088 — Phone-number formatting hardcoded to one country
- **Category:** Hardcoded Issue · locale-assumed
- **Description:** The contact UI formats numbers as `(555) 123-4567` with a fixed US pattern instead of using libphonenumber per region. International numbers render unformatted or flagged invalid, and validation rejects valid non-US numbers at entry. A unit test running libphonenumber across regions, plus a form test accepting E.164 input, catches the fixed pattern.
- **Real-world example:** libphonenumber is the documented standard for per-region phone formatting and validation (maintained by Google); hardcoded US-format rendering rejecting valid international numbers is a recognized i18n-audit finding.

<!-- APPEND -->
