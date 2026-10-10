# Product

## Register

product

## Users

Students use Voice Flow to report problems, share suggestions, ask questions, vote in polls, and communicate with school staff without exposing their identity. Staff and administrators use the same platform to moderate content, investigate reports, respond to the community, and operate the workforce and safety tooling.

## Product Purpose

Voice Flow is an anonymous school-feedback and problem-solving platform. It exists to make it safe and easy for students to raise real concerns, help administrators understand and resolve them, and preserve a clear, trustworthy record of what happened. Success means a user can complete the task they arrived to do, understand the current state, recover from failure, and trust that the system has not silently lost or fabricated their work.

## Brand Personality

Calm, trustworthy, direct.

The interface should feel steady and humane rather than performative. It should reduce anxiety around sensitive reports, make system status explicit, and use plain language instead of vague or theatrical feedback.

## Anti-references

- No noisy dashboards that make ordinary students feel like operators.
- No gamified urgency, fear-based warnings, or decorative motion that competes with the task.
- No generic AI-product visual language: no default gradient hero treatment, interchangeable card grids, or ornamental glass effects.
- No controls that look actionable but silently fail, defer indefinitely, or hide the result of a write.
- No layouts that require a mouse, punish zoom, or hide important state behind hover-only interactions.

## Design Principles

1. **Make state legible.** Every surface should answer what is happening, what changed, and what the user can do next.
2. **One action, one honest outcome.** Prefer authoritative responses and local reconciliation over optimistic promises or silent retries.
3. **Protect attention.** Load bounded data once per visit; use explicit refreshes and purposeful motion rather than ambient churn.
4. **Keep trust visible.** Preserve user context through failures, retries, destructive actions, and moderation decisions.
5. **Design for the difficult day.** A student reporting bullying or a moderator handling a difficult case should experience clarity, dignity, and control.

## Accessibility & Inclusion

Hold the product to WCAG 2.2 AA. All primary journeys must be keyboard operable with visible focus and meaningful screen-reader semantics. Forms need explicit labels, inline validation, and recoverable errors. Loading, empty, success, and failure states must remain perceivable without relying on color or motion. Respect reduced-motion preferences, support browser zoom and reflow, maintain sufficient contrast, and avoid interactions that only work on hover or require fine pointer precision.

## Admin Operating Model

The admin home is an attention-first Action Center: human decisions, verified outcomes, freshness, and clear recovery are visible; routine automation stays in the background. A realtime event marks the current snapshot stale and offers an explicit update action; it does not trigger a full-page refetch. The primary admin navigation does not expose raw system-operations surfaces. Their backend workers, audit records, and API capabilities remain server-side and must continue to report state honestly.

