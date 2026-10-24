# Vercel AI Gateway (AI SDK)

Runnable example: [`examples/ai-gateway/index.ts`](../examples/ai-gateway/index.ts)

```bash
npm run example:ai-gateway
```

## Setup

1. `ai` and `dotenv` are installed; `tsx` runs the TypeScript example.
2. Put the key in `.env.local`:

   ```
   AI_GATEWAY_API_KEY=<your key>
   ```

   `.env.local` is gitignored (`.gitignore` → `.env*`) and is **never** committed.
   The key is read from the environment by the Gateway provider, so it never
   appears in source. See `.env.template` for the placeholder.

3. Create a key at <https://vercel.com/ai-gateway>.

## Model

The example defaults to `nvidia/nemotron-3-super-120b-a12b` — the same Nemotron
family `api/_providers.js` already calls (`super-120b`, `ultra-550b`), so the
app has one model family rather than two. Override without editing code:

```
AI_GATEWAY_MODEL=nvidia/nemotron-3-ultra-550b-a55b
```

Other NVIDIA ids on the Gateway: `nvidia/nemotron-3-nano-30b-a3b`,
`nvidia/nemotron-3.5-lightning`, `nvidia/nemotron-nano-12b-v2-vl`,
`nvidia/nemotron-nano-9b-v2`.

Full catalog: `https://ai-gateway.vercel.sh/v1/models` (public, no key needed).

## Current status — NOT YET VERIFIED END-TO-END

The example is wired correctly and reaches Vercel's Gateway, but the call does
not yet succeed:

```
GatewayInternalServerError: AI Gateway requires a valid credit card on file
to service requests.
```

Two things must be resolved before the example returns text:

1. **`AI_GATEWAY_API_KEY` is empty** in `.env.local`. Enter it locally.
2. **The Vercel account needs a credit card on file** before AI Gateway will
   service any request — this is an account-level gate, independent of the key
   and independent of which model is selected.

Do not treat this integration as working until the example has actually printed
model output.

## Key hygiene

- Never paste the key into chat, issue trackers, logs, or source.
- If a key is ever exposed, revoke it at <https://vercel.com> and reissue.
- `AI_GATEWAY_API_KEY` must never be prefixed with `VITE_` — that would ship it
  to the browser bundle.
