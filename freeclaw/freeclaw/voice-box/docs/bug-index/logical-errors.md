# 1. Logical Errors
Bugs in code logic that produce incorrect outcomes. Every entry names the mechanism, the failure mode, and the detection surface.

### BUG-LOGIC-001 — Inverted error-branch guard
- **Category:** Logical Error · inverted-condition
- **Description:** An error-handling block is gated by a condition with the negation on the wrong side, e.g. `if (!err) { logFailure(); }` where `if (err)` was intended. At runtime the success path runs the failure handler while the genuine failure path falls through and returns success, so downstream systems record operations as completed that never ran. Detection: a unit test that forces an error (rejects the dependency, throws from the mock) and asserts the failure branch's side effects executes them on the success input instead.
- **Real-world example:** The inverted-guard class is a standing item in code-review checklists (Google and JetBrains style guides flag negated error checks); the 1999 Mars Polar Lander sensor logic that treated a spurious touchdown signal as "landed" is the canonical inverted-semantics incident.

### BUG-LOGIC-002 — Assignment-in-condition truthiness
- **Category:** Logical Error · assignment-in-condition
- **Description:** A comparison is written with a single `=` (`if (user = findUser(id))`), assigning inside the condition. The assignment always evaluates to the assigned value, so the branch is taken whenever the lookup returns a truthy object — and `user` is silently overwritten, destroying its previous value for all code after the condition. Detection: a debugger watch on `user` changing value at the condition line, or a compiler warning (`-Wparentheses`, `possible-assignment`) and a unit test asserting the original variable survives.
- **Real-world example:** CWE-481 (assigning instead of comparing) and the "Yoda conditions" convention (`if (null == x)`) both exist specifically because this class has shipped in C, PHP, and JavaScript for decades.

### BUG-LOGIC-003 — Loose equality type coercion
- **Category:** Logical Error · loose-equality
- **Description:** A value check uses `==` instead of `===`, so JavaScript's abstract equality coerces operands before comparing: `0 == ""` is true, `null == undefined` is true, and `"1" == 1` is true. A whitelist check like `if (status == 0)` therefore matches unexpected inputs such as empty strings, letting invalid data pass a gate meant to reject it. Detection: a table-driven test feeding coerced variants (`""`, `"0"`, `false`, `[]`) into the check and asserting they are rejected.
- **Real-world example:** PHP's "magic hash" weakness — `"240610708" == "QNKCDZO"` evaluates true because both md5 to a `0e…` string — was exploited for authentication bypasses and motivated the `===` recommendation across the ecosystem.

### BUG-LOGIC-004 — null-vs-undefined conflation
- **Category:** Logical Error · null-undefined-conflation
- **Description:** A missing-value check uses `=== undefined` while the API layer returns `null` for absent fields (or vice versa). The comparison never matches, so the fallback branch is unreachable and `null` flows into code that calls methods on it. Detection: log the raw payload at the boundary and assert the exact sentinel the serializer emits; a unit test mocking the API's real serialization catches the mismatch immediately.
- **Real-world example:** The `null == undefined` coercion in `==` is why the distinction went unnoticed for years; REST serializers (Jackson, JSON.stringify) treat absent-vs-null differently, and the mismatch class is documented in every major JSON library's migration guide.

### BUG-LOGIC-005 — Float equality after arithmetic
- **Category:** Logical Error · float-equality
- **Description:** A total is computed with floating-point arithmetic and then compared with `===` to an exact literal (`if (0.1 + 0.2 === 0.3)` or `if (cart.total === 19.99)`). IEEE 754 rounding makes the sum `0.30000000000000004`, so the comparison is always false and the "equal" branch — a discount, a reconciliation, a completeness check — never executes. Detection: print the raw float (`total.toPrecision(17)`) or assert with an epsilon (`Math.abs(a - b) < 1e-9`) in tests.
- **Real-world example:** The `0.1 + 0.2 !== 0.3` class is a documented IEEE 754 behavior (see the 0.30000000000000004.com breakdown) and appears in virtually every language's float-handling guide.

### BUG-LOGIC-006 — String-numeric lexicographic comparison
- **Category:** Logical Error · string-number-comparison
- **Description:** Numeric values stored or received as strings are compared with relational operators, which compare UTF-16 code units lexicographically: `"10" < "9"` is true and `"100" < "20"` is true. A limit check like `if (userInput < maxValue)` therefore admits values above the cap whenever the digit count differs, defeating the boundary. Detection: assert the comparison with `Number()`-parsed operands in tests, or log `typeof value` at the boundary where the wrong ordering first appears.
- **Real-world example:** The lexicographic-vs-numeric comparison class is a standing bug class in form validation and API limit checks; GitHub's API pagination docs explicitly warn that page numbers must be compared numerically, not as strings.

### BUG-LOGIC-007 — Truthy empty-array check
- **Category:** Logical Error · truthy-falsy
- **Description:** A "has items" guard tests the container reference (`if (results)`) instead of its length (`if (results.length > 0)`). An empty array is truthy in JavaScript, so the guarded block — a summary renderer, a batch processor — executes against zero elements and produces an empty report labeled as complete. Detection: a unit test that mocks the data source returning `[]` and asserts the empty-state branch runs instead of the main branch.
- **Real-world example:** The empty-container truthiness class is a documented JS gotcha (empty arrays, objects, and even `new Boolean(false)` are truthy) and a recurring source of "blank page rendered successfully" defects in SPA codebases.

### BUG-LOGIC-008 — Falsy-zero default fallback
- **Category:** Logical Error · truthy-falsy
- **Description:** A default is applied with `||` (`const retries = config.retries || 3`), which treats `0` — a meaningful configured value — as missing. A caller that explicitly sets `retries: 0` silently gets 3 retries, so "disable retry" configurations never take effect. Detection: assert the exact configured value survives initialization in a test; log the post-default value at startup and compare against the raw config.
- **Real-world example:** The `||`-versus-`??` class is why TypeScript and ES2020 added the nullish coalescing operator; it is a documented migration item in every major TS codebase's lint rules (`no-unnecessary-condition`/`@typescript-eslint` guides).

### BUG-LOGIC-009 — Optional-chaining masking a failed lookup
- **Category:** Logical Error · optional-chaining-masking
- **Description:** A validation path reads deeply nested fields with optional chaining (`if (res?.data?.user?.email)`), so a missing user record short-circuits to `undefined` and the whole condition is false without any error. The code takes the "invalid email" branch instead of surfacing "user not found", and the missing record is never logged or retried. Detection: break the chain deliberately in a test (return `null` at each level) and assert which branch executes; a debugger breakpoint on the chain shows the short-circuit value.
- **Real-world example:** The optional-chaining-hides-failures debate is a documented pattern discussion (MDN notes short-circuiting returns `undefined`); the "silently missing record" class appears in API-client wrappers where `res?.body?.items?.length` gates success checks.

### BUG-LOGIC-010 — Meaningful-falsy boolean conflation
- **Category:** Logical Error · meaningful-falsy
- **Description:** A boolean-returning function whose `false` carries distinct meaning (e.g. `isBanned(user)`) is consumed through a fallback (`const status = isBanned(user) || guestStatus`), merging "banned" with "guest". Banned users receive guest treatment instead of being blocked, so the access-control intent is silently inverted. Detection: a test asserting the three-way outcome (banned/guest/active) exposes the collapsed branch; a debugger step-through shows the `false` short-circuit into the fallback.
- **Real-world example:** The boolean-collapse class is a standing item in API-design guidance ("booleans that lie"): three-state outcomes collapsed into two-state booleans are the classic cause of "deleted vs never-existed" and "banned vs inactive" bugs.

### BUG-LOGIC-011 — NaN equality comparison
- **Category:** Logical Error · float-equality
- **Description:** A sentinel check tests for NaN with equality (`if (result === NaN)` or `if (result == NaN)`). IEEE 754 defines NaN as unequal to everything including itself, so the branch is unreachable and NaN propagates into arithmetic, sorting, and persistence downstream. Detection: `Number.isNaN(result)` in an assertion, or a test that feeds `undefined`/invalid input into the computation and asserts the guard fires.
- **Real-world example:** The `NaN !== NaN` class is a documented IEEE 754 property and the reason `Number.isNaN` and `Object.is` exist; it is a standing item in every numeric-parsing code review.

### BUG-LOGIC-012 — De Morgan negation error
- **Category:** Logical Error · inverted-condition
- **Description:** A compound guard is written as `if (!(a && b))` where `if (!a && !b)` was intended (or the reverse). The condition admits half-invalid states — one required field present, the other missing — so validation passes on records that should be rejected and downstream code dereferences the missing field. Detection: a truth-table unit test enumerating the four combinations of `a`/`b` and asserting acceptance per combination.
- **Real-world example:** The De Morgan inversion class is a documented logic error in validation chains; truth-table-driven tests are the standard detection method recommended in property-based testing guides (fast-check, Hypothesis docs).

### BUG-LOGIC-013 — Object-literal null comparison
- **Category:** Logical Error · null-undefined-conflation
- **Description:** A missing-record check compares a result object to `null` (`if (rateLimitResult == null)`) when the lookup returns an empty object `{}` or a result wrapper, never a bare `null`. The comparison never matches, so the guard is dead code and the unchecked object flows into field reads that return `undefined`. Detection: log the shape at the lookup boundary (`Object.keys(result)`) and assert the exact sentinel; a type-level test (`satisfies`/`typeof`) catches the wrapper-vs-null mismatch.
- **Real-world example:** The wrapper-object-vs-null class is a standing bug pattern in SDK clients that return `{ data, error }` envelopes — the "checked the envelope, not the payload" review comment appears in every major client library's issue tracker.

### BUG-LOGIC-014 — Ternary precedence mis-grouping
- **Category:** Logical Error · operator-precedence
- **Description:** A ternary is combined with a logical operator without parentheses (`a ? b : c || d`), which JavaScript parses as `a ? b : (c || d)` rather than the intended `(a ? b : c) || d`. When the intent was "use b if a, otherwise c, with d as last resort", the `d` fallback becomes unreachable whenever `c` is falsy-but-present, or conversely the fallback fires in the success branch. Detection: a table-driven test over the truthiness combinations and asserting the selected value; a formatter (Prettier) rendering the parenthesization makes the grouping visible in review.
- **Real-world example:** The mixed-ternary-precedence class is flagged by linters (`no-nested-ternary`, ESLint's `no-mixed-operators`) precisely because it has produced silent fallback-swap bugs in production config resolution.

### BUG-LOGIC-015 — typeof-array check
- **Category:** Logical Error · type-coercion
- **Description:** A collection check uses `typeof value === "array"`, which is never true in JavaScript — arrays report `"object"`. The array branch is unreachable, so array inputs fall into the object-handling path where `Object.keys(value)` returns index strings and iteration yields different results than intended. Detection: `Array.isArray(value)` in the assertion, or a unit test passing an array and asserting which branch executes.
- **Real-world example:** The `typeof`-array class is a documented JS gotcha (MDN's typeof table lists arrays under "object"); it is the reason `Array.isArray` and `Object.prototype.toString.call` exist as the recommended checks.

### BUG-LOGIC-016 — parseInt without radix
- **Category:** Logical Error · string-number-comparison
- **Description:** String parsing uses `parseInt(value)` without an explicit radix, so leading-zero strings were parsed as octal in legacy engines (`"010"` → 8) and `"0x1F"` is parsed as hex in all engines. IDs, ZIP codes, and date components with leading zeros therefore parse to the wrong number, silently corrupting lookups and comparisons downstream. Detection: a table-driven test over leading-zero and hex-prefixed inputs asserting the parsed value; ESLint's `radix` rule flags the construct at review time.
- **Real-world example:** The parseInt-octal class was a documented ES3-era behavior (removed in ES5, but the `radix` lint rule persists across every major style guide because hex prefixes still parse).

### BUG-LOGIC-017 — Strict-equality against API null
- **Category:** Logical Error · null-undefined-conflation
- **Description:** A TypeScript-annotated optional field is checked with `=== undefined` (`if (user.avatar === undefined)`) while the backend serializes absent avatars as `null`. The "use default avatar" branch is unreachable for every real response, so the fallback path never runs — or conversely, `null` is dereferenced by the branch that assumed it impossible. Detection: assert the serialized shape in an integration test (snapshot the JSON payload) and check the branch for both `null` and `undefined` inputs.
- **Real-world example:** The null-vs-absent field class is a documented schema-design issue in GraphQL/OpenAPI migration guides (`nullable` vs optional), and a recurring source of "field is always null in production" bug reports.

### BUG-LOGIC-018 — filter callback returning non-boolean
- **Category:** Logical Error · truthy-falsy
- **Description:** A filter callback returns a value coerced to boolean (`items.filter(item => item.count)`), so items with `count: 0` — a legitimate value — are dropped from the result. Downstream aggregation then under-counts, and zero-quantity line items disappear from invoices or reports instead of being rendered as zero. Detection: a unit test seeding items with `count: 0` and asserting they survive the filter; a linter rule (`no-truthy-falsy`-style) catches the coercion at lint time.
- **Real-world example:** The truthy-filter class is a documented JS gotcha (Array.prototype.filter coerces the callback's return via ToBoolean) and a recurring source of missing-zero-row bugs in reporting pipelines.

### BUG-LOGIC-019 — Case-sensitive default ordering
- **Category:** Logical Error · string-number-comparison
- **Description:** A sorted list relies on the default string comparison (`items.sort()`), which orders by UTF-16 code unit: all uppercase letters sort before all lowercase (`"Z" < "a"`). Mixed-case names, IDs, and keys therefore appear in an order no user expects, and binary-search lookups over the same ordering miss entries. Detection: a unit test seeding mixed-case entries and asserting the expected case-insensitive order; `localeCompare` with sensitivity options is the fix visible in the diff.
- **Real-world example:** The default-sort ordering class is a documented JS behavior (MDN notes the default sort is by code units) and a recurring bug in user-facing lists that "look shuffled" in QA.

### BUG-LOGIC-020 — Loose equality with boolean literal
- **Category:** Logical Error · loose-equality
- **Description:** A truth check compares against the boolean literal with `==` (`if (flag == true)`), which also matches `1`, `"1"`, and `[1]` via coercion. A feature gate therefore opens for unexpected truthy inputs, and conversely `flag == false` matches `0` and `""`, letting unset flags behave as explicitly disabled. Detection: a table-driven test feeding coerced variants and asserting the gate's open/closed state.
- **Real-world example:** The `== true`/`== false` class is flagged by ESLint's `eqeqeq` rule with the `smart` option off, precisely because it has produced feature-flag inversion bugs documented in launch-tooling postmortems.

### BUG-LOGIC-021 — Negative-zero comparison
- **Category:** Logical Error · float-equality
- **Description:** Signed-direction logic compares against zero with `===` (`if (delta === 0) keepSign()`), but IEEE 754 defines `-0 === 0` as true, so the negative-zero case — produced by `-1 * 0` or `Math.round(-0.4)` — collapses into the positive branch. Direction-dependent rendering or sorting then loses the sign, and accumulation that relies on preserving `-0` produces wrong downstream deltas. Detection: `Object.is(delta, -0)` in an assertion, or a test that feeds `-1 * 0` through the branch and asserts the sign.
- **Real-world example:** The negative-zero class is a documented IEEE 754 property (`Object.is` exists specifically to distinguish `-0` from `0`) and a standing item in numeric-signaling code reviews.

### BUG-LOGIC-022 — Switch coercion mismatch
- **Category:** Logical Error · loose-equality
- **Description:** A switch statement compares a string-typed value against numeric case labels (or vice versa). Switch uses strict equality, so `switch ("1")` never matches `case 1:`; the default branch runs instead, and the intended branch — a specific handler, a discount tier — is unreachable for every string-typed input. Detection: a unit test passing the value in its real wire type and asserting which branch executes; TypeScript's exhaustiveness checking surfaces the type mismatch at compile time when cases are typed.
- **Real-world example:** The switch-coercion class is a documented JS behavior (MDN notes switch uses `===`) and a recurring source of "default always runs" bugs at API boundaries where form data arrives as strings.

### BUG-LOGIC-023 — Date-object reference equality
- **Category:** Logical Error · reference-equality
- **Description:** Two `Date` instances wrapping the same instant are compared with `===` (`if (new Date(a) === new Date(b))`). Objects are compared by reference, so the comparison is always false regardless of the instants, and the "same day" branch — a dedupe check, a cache key, a completeness assertion — never executes. Detection: compare with `.getTime()` or on the primitive in an assertion; a debugger watch showing two distinct object identities at the same timestamp exposes it immediately.
- **Real-world example:** The object-reference-equality class is a documented JS gotcha (MDN: objects compare by reference) and the reason date libraries (date-fns, Luxon) provide `isEqualTo`/`hasSame` comparators.

### BUG-LOGIC-024 — Array reference change detection
- **Category:** Logical Error · reference-equality
- **Description:** A change-detection guard compares two array references (`if (newList === oldList)`) after the new list was produced by `map`, `filter`, or slice. Those methods always allocate a new array, so the comparison is always false and the "unchanged, skip work" branch never executes — every render or poll re-runs the expensive work, or a memoization cache never hits. Detection: log the allocation result in a test with identical content and assert the intended branch; React's memo/profiler warnings surface the re-render class.
- **Real-world example:** The reference-inequality change-detection class is a documented React performance pattern (Vercel's React best practices flag reference-comparison misuse) and the reason structural sharing libraries (Immer) exist.

### BUG-LOGIC-025 — Tautological compound condition
- **Category:** Logical Error · tautological-condition
- **Description:** A guard is written so one operand subsumes the other (`if (x === null || x !== null)`, or `if (!user || user)`), making the condition always true regardless of state. The validation or reset branch therefore runs on every call — including the success path — silently resetting state or double-applying work that was meant to run only on failure. Detection: a static analyzer (TS `no-constant-condition`, SonarQube's tautology rules) flags the construct; a unit test asserting the branch does not run on the success path exposes the effect.
- **Real-world example:** The tautological-condition class is flagged by every major static analyzer (SonarQube, Coverity, ESLint) because it typically results from a merge or refactor that silently discarded one half of an intended pair of guards.

### BUG-LOGIC-026 — Logical-AND/OR precedence mis-grouping
- **Category:** Logical Error · operator-precedence
- **Description:** A compound guard mixes `&&` and `||` without parentheses (`if (user && user.name || user.email)`), which JavaScript parses as `(user && user.name) || user.email`. When `user` is undefined and the intent was "require user, then check name or email", the right operand `user.email` is evaluated on the undefined object and throws a TypeError instead of returning false. Detection: a truth-table test enumerating the operand combinations including the undefined case; ESLint's `no-mixed-operators` rule renders the grouping in review.
- **Real-world example:** The &&/|| precedence class is a documented JS behavior (MDN precedence table: `&&` binds tighter than `||`) and a recurring source of null-dereference crashes in validation chains.

### BUG-LOGIC-027 — Off-by-one array index iteration
- **Category:** Logical Error · off-by-one
- **Description:** An index loop uses `<=` instead of `<` (`for (let i = 0; i <= arr.length; i++)`). The final iteration reads `arr[arr.length]`, which is `undefined`, so the loop body processes a phantom element — a NaN sum, a null render, or a crash on property access. Detection: assert the loop's processed count in a unit test, or log each visited index; the off-by-one shows up as an extra iteration with an undefined value.
- **Real-world example:** The off-by-one iteration class is a standing bug class in every language (documented in CWE-193) and the reason many style guides recommend `for...of` or `forEach` over manual index loops.

### BUG-LOGIC-028 — Off-by-one page-index math
- **Category:** Logical Error · off-by-one
- **Description:** Pagination math computes the slice offset as `page * pageSize` where the client's page is 1-based, instead of `(page - 1) * pageSize`. Page 1 therefore returns rows `pageSize..2*pageSize-1` and the first `pageSize` rows are never served, so consumers silently miss the first page of data. Detection: an integration test requesting page 1 with a seeded dataset and asserting the first row's ID exposes the skip immediately.
- **Real-world example:** The off-by-one pagination class is a recognized repeatable pattern (every major REST API's pagination guide documents the 0-based vs 1-based page trap; GitHub's API docs call it out explicitly).

### BUG-LOGIC-029 — Mutating a collection while iterating
- **Category:** Logical Error · iterate-mutation
- **Description:** Elements are removed with `splice` (or pushed) inside a forward `for` loop over the same array. Each removal shifts subsequent elements down one index while the loop counter advances, so the element immediately after each removed one is skipped and never examined. Detection: a unit test seeding adjacent to-be-removed elements and asserting all are processed; a debugger watch on the array length inside the loop shows the shift per iteration.
- **Real-world example:** The mutate-while-iterating class is a documented bug class in every language; the standard fix pattern (iterate backwards, or collect then filter) appears in every style guide because adjacent-element skips are so common in cleanup loops.

### BUG-LOGIC-030 — var-in-loop closure capture
- **Category:** Logical Error · var-in-closure
- **Description:** Callbacks scheduled inside a loop capture a `var`-declared loop variable (`for (var i = 0; i < n; i++) setTimeout(() => use(i), 0)`). `var` is function-scoped, so every closure references the same binding and reads its final value `n` when it fires. All delayed work then processes the same out-of-range index instead of its own. Detection: a unit test with `n = 3` asserting three distinct values arrive; replacing `var` with `let` in the diff changes behavior, which the test proves.
- **Real-world example:** The var-in-loop closure class is a documented pre-ES2015 gotcha (MDN's closure guide uses it as the canonical example) and the reason `let` in for-loops creates a per-iteration binding.

### BUG-LOGIC-031 — break exits the wrong construct
- **Category:** Logical Error · break-misuse
- **Description:** A `break` statement inside a `switch` nested in a `do...while` loop exits the switch (or the loop, depending on placement) instead of the intended construct. In the AT&T form, a `break` intended for the switch instead terminated the do-while's first iteration, so the loop body executed once instead of its normal path — every subsequent call to the function failed and the switch cascade crashed the switching centers. Detection: a unit test asserting the loop's iteration count and the switch's fallthrough state; labeled breaks (`outer:`) make the target construct explicit in review.
- **Real-world example:** The January 15, 1990 AT&T long-distance network outage was traced to a misplaced `break` in a C switch inside a do-while loop — a single misplaced statement brought down the US long-distance network for 9 hours.

### BUG-LOGIC-032 — return inside forEach intending to break
- **Category:** Logical Error · break-misuse
- **Description:** A `return` statement is used inside an `Array.prototype.forEach` callback intending to stop the whole iteration (or the enclosing function). `return` only ends the current callback invocation, so forEach continues over every remaining element and the enclosing function's post-loop code runs regardless. Detection: a unit test seeding an early-match case and asserting how many elements are visited; replacing forEach with `for...of` + `break` (or `some`/`every`) changes the visited count.
- **Real-world example:** The forEach-return class is a documented JS gotcha (MDN: "there is no way to stop or break a forEach loop") and a recurring source of wasted-work and wrong-post-loop-state bugs flagged in code review.

### BUG-LOGIC-033 — Infinite loop from missing increment
- **Category:** Logical Error · infinite-loop
- **Description:** A loop's update expression computes but does not assign (`for (let i = 0; i < n; i + 1)`), so the counter never changes. The loop body runs forever on the same index, pinning the event loop or CPU and hanging the process; in a browser the tab freezes. Detection: a test timeout around the function call, or a debugger watch on the counter showing it stuck at the initial value.
- **Real-world example:** The non-increment loop class is a standing hang class (documented in Node.js event-loop-blocking guides); CI timeouts and watchdog timers are the standard detection surfaces.

### BUG-LOGIC-034 — Infinite loop waiting on an unsignaled flag
- **Category:** Logical Error · infinite-loop
- **Description:** A `while (!ready)` spin loop waits for a flag that the completing code path never sets (typo in the setter name, wrong object, or the setter runs in another module's scope). The loop spins forever, burning CPU while the work it waits on has already finished or failed elsewhere. Detection: log the flag's identity and value at both the spin site and the setter site; a debugger conditional breakpoint on the flag, or a watchdog that dumps the stack after N iterations, shows the mismatch.
- **Real-world example:** The spin-wait class is a documented anti-pattern (busy-waiting without a timeout); watchdog-driven stack dumps are the recognized detection method in production incident response.

### BUG-LOGIC-035 — for-in over an array
- **Category:** Logical Error · for-in
- **Description:** An array is iterated with `for...in`, which enumerates string keys (including any custom properties added to the array) rather than elements. The loop body receives index strings, so arithmetic on the "element" produces string concatenation (`"0" + 1` → `"01"`) and order is not guaranteed. Detection: a unit test asserting numeric element values arrive; replacing with `for...of` or `forEach` changes the type of the loop variable, which the test proves.
- **Real-world example:** The for-in-over-array class is a documented JS gotcha (MDN explicitly recommends against for...in for arrays); it is the reason ESLint's `no-for-in`-style rules exist across major codebases.

### BUG-LOGIC-036 — for-in prototype-chain keys
- **Category:** Logical Error · for-in
- **Description:** An object is iterated with `for...in` while inherited enumerable properties from its prototype chain (or polluted prototypes) are enumerated too. The loop processes keys the object does not own, so configuration merging or serialization picks up foreign values — and prototype-pollution attacks inject keys that this loop faithfully copies into every serialized payload. Detection: `Object.prototype.hasOwnProperty.call(obj, key)` inside the loop (or `Object.keys`/`Object.entries`) and a test seeding an inherited property to assert it is skipped.
- **Real-world example:** The for-in-prototype class is a documented JS behavior and a recognized amplifier for prototype-pollution vulnerabilities (CWE-1321) — polluted keys are enumerated by for...in and copied into downstream data.

### BUG-LOGIC-037 — for-of over a non-iterable object
- **Category:** Logical Error · iteration-type
- **Description:** A plain object is iterated with `for...of`, which requires an iterable and throws `TypeError: obj is not iterable`. The loop never runs and the enclosing function rejects, so any data transformation it performs fails for every call with a plain object. Detection: the thrown TypeError in the test or log; converting with `Object.entries(obj)` before iterating fixes it, which the test proves.
- **Real-world example:** The for-of-on-object class is a documented JS gotcha (MDN: for...of requires `[Symbol.iterator]`); it is a recurring crash class when refactoring between object and array shapes.

### BUG-LOGIC-038 — map with async callbacks not awaited
- **Category:** Logical Error · async-in-loop
- **Description:** Async work is launched with `items.map(async item => ...)` and the returned array of promises is never awaited. The surrounding function resolves immediately with an array of pending promises, so downstream code reads `undefined` for every result that has not settled and treats the batch as complete. Detection: `await Promise.all(...)` around the map result and a unit test asserting the settled values; logging `results[0] instanceof Promise` exposes the unawaited array.
- **Real-world example:** The map-without-await class is a documented JS gotcha (MDN: Array.prototype.map with async callbacks returns promises) and a recurring source of "empty results but no error" bugs in batch pipelines.

### BUG-LOGIC-039 — forEach with async callback not awaited
- **Category:** Logical Error · async-in-loop
- **Description:** An async callback is passed to `forEach`, which does not await it, so the loop completes before any of the async work finishes. The enclosing function returns while writes, uploads, or API calls are still in flight; errors from those calls surface as unhandled rejections later, decoupled from the operation that launched them. Detection: a unit test asserting the side effects have landed when the function resolves; replacing with `for...of` + `await` (or `Promise.all` over map) makes the ordering testable.
- **Real-world example:** The forEach-async class is a documented JS gotcha (MDN: forEach does not wait for promises) and a recurring cause of "function returned before the write happened" bugs in Node.js services.

### BUG-LOGIC-040 — Parallel launch where serial intended
- **Category:** Logical Error · async-in-loop
- **Description:** Requests to a rate-limited or order-sensitive API are launched with `Promise.all(items.map(...))` where the protocol requires sequential calls. All requests fire simultaneously, the API returns 429s or processes writes out of order, and the batch partially fails with no retry ordering. Detection: a unit test asserting the call count and concurrency (mock the API and count in-flight requests); a rate-limiter mock that rejects parallel calls exposes the mismatch.
- **Real-world example:** The unbounded-parallel-launch class is a recognized pattern (API rate-limit guides, e.g. GitHub's secondary rate limits) and the reason p-limit and Semaphore-style concurrency primitives exist.

### BUG-LOGIC-041 — Decrement loop starting out of bounds
- **Category:** Logical Error · off-by-one
- **Description:** A reverse loop starts at `arr.length` and indexes `arr[i]` before decrementing (`for (let i = arr.length; i > 0; i--) use(arr[i])`). The first iteration reads the out-of-bounds index and the last iteration reads index 1, so element 0 is never processed and a phantom `undefined` is processed first. Detection: a unit test asserting the processed element set; logging visited indices shows the out-of-bounds start and the missing first element.
- **Real-world example:** The reverse-loop off-by-one class is a documented variant of CWE-193 and a recurring bug in cleanup loops that iterate backwards specifically to avoid mutation-during-iteration skips.

### BUG-LOGIC-042 — Livelock from self-re-enqueueing work
- **Category:** Logical Error · infinite-loop
- **Description:** A `while (queue.length)` drain loop processes items that re-enqueue themselves (or each other) on every pass. The queue never empties, so the loop spins indefinitely — the process appears busy but no progress is made, and no completion event ever fires. Detection: log the queue length per iteration and assert it trends to zero in a test with a self-re-enqueueing item; a bounded-iterations watchdog catches the livelock in production.
- **Real-world example:** The re-enqueue livelock class is a recognized queue-processing failure mode (job-queue guides document "poison pill" items that re-enqueue on failure); bounded-retry counters are the standard mitigation.

### BUG-LOGIC-043 — Matrix index swap
- **Category:** Logical Error · index-swap
- **Description:** A nested loop over a 2D structure reads `matrix[j][i]` where `matrix[i][j]` was intended (or vice versa). The operation — a transpose, a comparison, a diagonal sum — reads the transposed element, so results are wrong for every non-square position while square positions accidentally agree, hiding the bug in smoke tests. Detection: a unit test over a deliberately asymmetric matrix asserting per-cell results; property-based tests with random non-square matrices catch it reliably.
- **Real-world example:** The index-swap class is a standing bug class in matrix code (documented in numerical-computing checklists); asymmetric test matrices are the standard detection method recommended in numerical-testing guides.

### BUG-LOGIC-044 — Loop variable shadowing
- **Category:** Logical Error · shadowing
- **Description:** An inner loop redeclares the outer loop's variable (`for (let i...) { for (let i...) }` where the inner was meant to use a different name, or an inner `const i` shadows a needed outer binding). The outer loop's condition or body reads the inner binding after the inner loop finishes, so the outer loop terminates early or processes wrong indices. Detection: a unit test asserting the outer loop's iteration count; linters (`no-shadow`, `no-loop-func`) flag the construct at review time.
- **Real-world example:** The shadowing-in-loop class is flagged by ESLint's `no-shadow` rule across major style guides because silently reused names inside nested loops are a recurring source of early-termination bugs.

### BUG-LOGIC-045 — Sparse array holes skipped by forEach
- **Category:** Logical Error · sparse-array
- **Description:** A sparse array (holes from `delete` or literal gaps) is iterated with `forEach`, which skips empty slots entirely, while `for...of` would yield `undefined` for them. Element positions shift relative to the consumer's expectations, so index-based bookkeeping (counts, positions, joins) desynchronizes from the data. Detection: a unit test seeding a sparse array and asserting how many positions are visited; `Array.from(arr)` (which materializes holes as undefined) makes the count explicit.
- **Real-world example:** The sparse-array iteration class is a documented JS behavior (MDN: forEach does not visit holes); it is a recurring desync bug when data crosses from index-based stores (SQL rows, protobuf repeated fields) into JS arrays.

### BUG-LOGIC-046 — map used for side effects with result discarded
- **Category:** Logical Error · side-effect-misuse
- **Description:** `items.map(item => { mutate(item); })` is used expecting in-place mutation, but the map's return value (a new array of transformed elements) is discarded or the callback returns nothing. When the callback builds new objects instead of mutating, the caller's original list is unchanged and downstream code processes stale elements. Detection: a unit test asserting the caller's list contents after the call; replacing with `forEach` (pure side effects) or assigning the map result makes the intent explicit and testable.
- **Real-world example:** The map-for-side-effects class is flagged by ESLint's `array-callback-return`-adjacent rules and is a recurring source of "my list didn't change" bugs when refactoring between immutable and mutable styles.

### BUG-LOGIC-047 — reduce with wrong accumulator
- **Category:** Logical Error · reduce-misuse
- **Description:** A reduce callback returns the wrong expression — the current item instead of the accumulated value (`arr.reduce((acc, item) => item)`), or accumulates into a variable outside the callback. The reduce result collapses to the last element (or a stale partial), so aggregations, groupings, and object builds silently produce the wrong shape. Detection: a unit test asserting the reduced result for a multi-element input; logging the accumulator per step exposes the collapse.
- **Real-world example:** The reduce-accumulator class is a documented JS gotcha (MDN's reduce examples show returning the accumulator) and a recurring source of "reduce returned the last item" bugs flagged in code review.

### BUG-LOGIC-048 — reduce with missing or wrong initial value
- **Category:** Logical Error · reduce-misuse
- **Description:** `reduce` is called without an initial value on an array that may be empty (throwing `TypeError: Reduce of empty array with no initial value`), or with an initial value of the wrong type (0 for string concatenation, `[]` for an object build). Empty inputs crash the pipeline or produce wrong-shaped results that pass silently. Detection: a unit test over the empty array and a single-element array asserting the result; the missing-initial-value TypeError is the direct crash signature.
- **Real-world example:** The reduce-initial-value class is a documented JS gotcha (MDN: calling reduce on an empty array without an initial value throws) and a recurring crash class in aggregation pipelines.

### BUG-LOGIC-049 — Integer-like key iteration order
- **Category:** Logical Error · iteration-order
- **Description:** Code assumes object keys iterate in insertion order, but integer-like keys ("0", "1", "2") are enumerated in ascending numeric order first, before any string keys. Serialization and merging therefore reorder fields, and consumers that expect the original order (array-indexed lookups, positional protocols) desynchronize. Detection: a unit test seeding mixed integer-like and string keys and asserting the iteration order; the reordering is visible in a serialized snapshot.
- **Real-world example:** The integer-key ordering class is a documented ECMAScript property (OwnPropertyKeys ordering: integer-like keys first in ascending order) and a recurring desync bug when object-keyed data crosses into positional protocols.

### BUG-LOGIC-050 — Recursion missing base case
- **Category:** Logical Error · recursion-base-case
- **Description:** A recursive walk lacks a base case for the terminating shape (a leaf node, an empty structure, a cycle guard), so recursion continues until the call stack overflows. The walk crashes with `RangeError: Maximum call stack size exceeded` instead of producing its result, and cyclic data structures (parent pointers, linked references) recurse forever even with a correct base case. Detection: the RangeError in the test or log; a cycle guard (`visited` set) and a depth counter are the standard fixes, provable with a cyclic test fixture.
- **Real-world example:** The missing-base-case class is a standing bug class in tree/graph walks (documented in every algorithms text); stack-overflow RangeErrors are the direct detection signature in JS runtimes.

### BUG-LOGIC-051 — do-while executing once when condition already false
- **Category:** Logical Error · do-while
- **Description:** A `do...while` loop is used where a plain `while` was intended, so the body executes once even when the condition is false from the start. One unwanted processing pass runs — a poll, a write, a send — before the loop condition ever gates it. Detection: a unit test with a false initial condition asserting the body does not run; converting to `while` changes the behavior, which the test proves.
- **Real-world example:** The do-while-first-pass class is a documented control-flow gotcha (MDN: do...while executes the body at least once) and a recurring source of single-extra-write bugs in retry/poll loops.

### BUG-LOGIC-052 — continue skipping the manual increment
- **Category:** Logical Error · continue-misuse
- **Description:** A `while` loop with a manually updated counter places the increment after a `continue` statement, so `continue` jumps back to the condition without incrementing. The loop spins forever on the same value, hanging the process with a full CPU. Detection: a test timeout around the function call; moving the increment before the continue (or using a for loop) fixes it, provable with the same test.
- **Real-world example:** The continue-skips-increment class is a documented control-flow gotcha in while-loops (the reason for-loops are preferred when a counter is involved); test timeouts and watchdogs are the standard detection surfaces.

### BUG-LOGIC-053 — Read-modify-write lost update
- **Category:** Logical Error · lost-update
- **Description:** A counter or balance is read, modified in application code, and written back without a transaction or atomic operation (`user.credits = user.credits + amount`). Two concurrent requests both read the same baseline, both write their own result, and the second write silently discards the first — one credit grant or deduction is lost. Detection: a concurrent integration test (two parallel requests against a seeded row) asserting the final value equals both amounts applied; database-level atomic updates (`UPDATE ... SET x = x + ?`) or `SELECT ... FOR UPDATE` are the fix visible in the diff.
- **Real-world example:** The read-modify-write lost-update class is CWE-362/366 and the canonical concurrency bug in banking and inventory systems; atomic SQL updates are the standard fix pattern.

### BUG-LOGIC-054 — Check-then-act TOCTOU
- **Category:** Logical Error · toctou
- **Description:** An existence check and the subsequent action are separate operations with no locking between them (`if (!(await db.findUser(email))) await db.createUser(email)`). Two concurrent registrations both see "not found" and both create, producing duplicate accounts; the same class applies to file writes, cache fills, and rate-limit checks. Detection: a concurrent integration test issuing two parallel registrations and asserting one account exists; unique constraints or upserts (`INSERT ... ON CONFLICT`) are the fix.
- **Real-world example:** The check-then-act class is CWE-367 (TOCTOU race condition) and a standing bug class in provisioning and registration flows; unique indexes and atomic upserts are the recognized mitigation.

### BUG-LOGIC-055 — Out-of-order async response race
- **Category:** Logical Error · response-race
- **Description:** Successive async requests write their responses to shared state without checking whether the response is still the newest (`setResults(await fetch(q))` on every keystroke). A slow earlier response can settle after a faster newer one, so the UI or cache displays results for a query the user has already abandoned. Detection: a test that delays the first mock response beyond the second and asserts the rendered state matches the newest query; a request-generation counter or AbortController per request is the fix.
- **Real-world example:** The AJAX race class is a recognized industry pattern (search-as-you-type implementations without request cancellation) and the reason AbortController and request-generation guards are standard in frontend data-fetching guides.

### BUG-LOGIC-056 — Serverless module-level shared state
- **Category:** Logical Error · shared-state
- **Description:** Per-request state (user context, locale, tenant) is stored in a module-level variable that persists across invocations because the serverless container is reused. A request's state leaks into the next request in the same warm container, so responses are rendered for the wrong user or tenant intermittently. Detection: a test that invokes the handler twice with different users and asserts the second response carries only the second user's data; request-scoped context (AsyncLocalStorage, handler parameters) is the fix.
- **Real-world example:** The warm-container state class is documented in AWS Lambda's execution-environment guide (module-level state persists across invocations) and is a recurring cross-tenant leakage bug class in serverless codebases.

### BUG-LOGIC-057 — Stale closure capturing old state
- **Category:** Logical Error · stale-closure
- **Description:** A React event handler or effect reads state from the closure (`setCount(count + 1)`) instead of the functional update (`setCount(c => c + 1)`). When the handler fires twice before re-render (or inside a batch), both invocations read the same stale `count` and the second update overwrites the first. Detection: a test firing the handler twice synchronously and asserting the final count; React's functional-update pattern is the fix visible in the diff.
- **Real-world example:** The stale-closure class is a documented React pattern (React docs' "queueing a series of state updates" section) and a recurring source of lost-update bugs in rapid-interaction UIs.

### BUG-LOGIC-058 — Unguarded double submission
- **Category:** Logical Error · double-submit
- **Description:** A submit handler issues the write request without disabling the button, ignoring in-flight state, or sending an idempotency key. A double-click (or double-tap, or retry on a slow network) issues two identical requests and the backend creates two records — duplicate orders, duplicate charges, duplicate signups. Detection: a test issuing two rapid submits and asserting one record; a disabled/in-flight guard plus a server-side idempotency key is the fix visible in the diff.
- **Real-world example:** The double-submission class is a recognized e-commerce and payments bug pattern (duplicate charges from double-clicks); Stripe's idempotency keys are the industry-standard mitigation.

### BUG-LOGIC-059 — Optimistic update without revert
- **Category:** Logical Error · optimistic-update
- **Description:** The UI applies the change immediately (increment a counter, remove an item) and issues the write, but the error path never restores the previous state. When the request fails, the UI shows the change that never persisted until the next refetch, and cached state diverges from the server. Detection: a test failing the mock request and asserting the UI state is restored; TanStack Query's rollback-on-error pattern (or explicit revert in the catch) is the fix.
- **Real-world example:** The optimistic-update-without-rollback class is a recognized data-fetching bug pattern (TanStack Query and SWR docs document optimistic update with rollback as the required pattern).

### BUG-LOGIC-060 — Stale cache after write
- **Category:** Logical Error · cache-invalidation
- **Description:** A write path updates the database but never invalidates or updates the read cache, so subsequent reads serve the pre-write value until TTL expiry. The user sees their change "not saved" (or sees stale data others have already updated) for the cache's remaining lifetime. Detection: a test performing a write then an immediate read and asserting the new value; write-through or explicit invalidation (`cache.del(key)` / query invalidation) is the fix.
- **Real-world example:** The stale-cache-after-write class is a recognized cache-aside failure mode (cache invalidation guides document write-through or invalidation-on-write as the required pattern).

### BUG-LOGIC-061 — localStorage last-writer-wins across tabs
- **Category:** Logical Error · shared-storage
- **Description:** Two tabs edit the same localStorage-backed document, and each write replaces the entire value without merging or conflict detection. The last writer silently discards the other tab's edits, and neither tab is notified of the loss. Detection: a test simulating two writers with interleaved edits and asserting the merged outcome; the `storage` event plus version/merge logic is the fix visible in the diff.
- **Real-world example:** The last-writer-wins class is a recognized shared-document failure mode (collaborative-editing guides document CRDT/merge or version checks as the required pattern for multi-client storage).

### BUG-LOGIC-062 — Duplicate listener after remount
- **Category:** Logical Error · duplicate-listener
- **Description:** An event listener is registered in a mount path (or module scope) without removing it in the unmount/cleanup path, so a remounted component registers the same listener again. Each event now fires the handler twice, doubling state changes — a counter increments by two, a toggle flips twice per click. Detection: a test emitting the event once after remount and asserting the handler ran once; React's cleanup return in useEffect (or `removeEventListener` in the teardown) is the fix.
- **Real-world example:** The duplicate-listener class is a documented React leak/state bug (React docs' useEffect cleanup section) and Node's MaxListenersExceededWarning flags the same class on the server side.

### BUG-LOGIC-063 — Lock released across await
- **Category:** Logical Error · lock-across-await
- **Description:** A mutex or flag-based lock is acquired, then released before the async work completes (or the lock's scope ends at the first await), so a second caller acquires the lock mid-operation. Two writers interleave inside the "protected" section and the invariant the lock was meant to hold is violated. Detection: a test with a second caller entering during the first's in-flight window and asserting the interleaving is prevented; scoped locks that hold across the awaited operation (or per-resource queues) are the fix.
- **Real-world example:** The lock-across-await class is a recognized async-concurrency failure mode (async-mutex guides document holding the lock across the awaited operation as the required pattern).

### BUG-LOGIC-064 — Non-atomic global counter
- **Category:** Logical Error · non-atomic
- **Description:** A shared metric or rate counter is incremented with a read-modify-write in multiple workers (Node cluster workers, browser tabs) without an atomic primitive. Increments race and the count under-reports — a rate limiter using the counter admits excess traffic and a quota meter under-bills. Detection: a load test with concurrent increments asserting the final count; atomic primitives (database sequences, Redis INCR, SharedArrayBuffer atomics) are the fix.
- **Real-world example:** The non-atomic counter class is a recognized concurrency failure mode (Redis INCR, database sequences, and atomic SharedArrayBuffer operations exist for this reason).

### BUG-LOGIC-065 — State-transition applied twice
- **Category:** Logical Error · idempotency
- **Description:** A state-machine transition handler does not check whether the transition has already been applied, so a retried event (webhook replay, message redelivery) applies it twice. A "shipped" order is marked shipped twice and side effects (notifications, inventory decrements) fire twice. Detection: a test replaying the same event and asserting the state and side effects are unchanged on the second delivery; an idempotency key or transition-table guard is the fix.
- **Real-world example:** The non-idempotent-transition class is a recognized event-processing failure mode (message-queue guides document at-least-once delivery requiring idempotent handlers).

### BUG-LOGIC-066 — Initialization race
- **Category:** Logical Error · init-race
- **Description:** A lazy initialization path (`if (!instance) instance = await init()`) is entered by two concurrent callers, both see the unset instance, and both run the full initialization — double DB migrations, double client construction, double cache warm-up. Detection: a test issuing two parallel first-calls and asserting one initialization ran; a promise-cached singleton (storing the promise, not the resolved value) is the fix.
- **Real-world example:** The initialization-race class is a recognized lazy-singleton failure mode (promise-cached initialization is the standard pattern in Node.js service guides).

### BUG-LOGIC-067 — Shared config mutated at runtime
- **Category:** Logical Error · shared-mutation
- **Description:** A request handler mutates a module-level config object (adds a per-request flag, rewrites a field), so the mutation is visible to every subsequent request in the same process. Config values drift from what was loaded at startup and behavior becomes request-order-dependent. Detection: a test issuing a mutating request then a read request and asserting the config is unchanged; freezing the config (`Object.freeze`) or scoping mutations to a per-request copy is the fix.
- **Real-world example:** The shared-config-mutation class is a recognized serverless-hostile pattern (module-level mutable state persists across invocations, documented in AWS Lambda's execution-environment guide).

### BUG-LOGIC-068 — Cross-user session leakage in-process
- **Category:** Logical Error · shared-state
- **Description:** Session or user-scoped data is stored in a module-level variable (or a Map keyed by nothing user-specific) in a long-lived server process. A second user's request reads the first user's data — responses, drafts, or authorization state leak across users within the same process. Detection: a test issuing interleaved requests from two users and asserting each response carries only its own data; request-scoped context (AsyncLocalStorage) is the fix.
- **Real-world example:** The cross-user in-process leakage class is a recognized Node.js failure mode (AsyncLocalStorage exists for request-scoped state precisely because module-level storage leaks across requests).

### BUG-LOGIC-069 — WebSocket-before-HTTP order inversion
- **Category:** Logical Error · message-race
- **Description:** A realtime push (WebSocket/SSE message) carrying the new state arrives before the slower HTTP response carrying older state, and the HTTP handler writes last, overwriting the push. The UI shows stale data despite having received the update. Detection: a test delaying the HTTP mock beyond the push and asserting the rendered state matches the push; a sequence/last-write-wins guard comparing timestamps or versions is the fix.
- **Real-world example:** The push-before-pull inversion class is a recognized realtime-app failure mode (sequence/epoch guards are the standard pattern in realtime UI guides).

### BUG-LOGIC-070 — Concurrent log append interleave
- **Category:** Logical Error · concurrent-append
- **Description:** Two writers append to the same log file (or stream) with separate `fs.appendFile` calls without a shared queue or lock. Interleaved partial lines corrupt the log — a JSON-lines file becomes unparseable mid-record. Detection: a load test with concurrent writers asserting every line parses; a single serialized writer (pino, a queue) is the fix.
- **Real-world example:** The interleaved-append class is a recognized logging failure mode (structured-logging guides document single-writer serialization as the required pattern for JSON-lines files).

### BUG-LOGIC-071 — Token-bucket read-check-update race
- **Category:** Logical Error · toctou
- **Description:** A rate limiter reads the bucket count, checks it against the limit, and decrements in separate steps without an atomic primitive. Concurrent requests all read the same pre-decrement count and all pass the check, so the limiter admits a burst above the configured rate. Detection: a load test at the configured rate plus one and asserting the excess is rejected; atomic operations (Redis INCR with expiry, Lua scripts) are the fix.
- **Real-world example:** The token-bucket race class is a recognized rate-limiter failure mode (Redis-based limiter guides document atomic INCR/Lua as the required pattern).

### BUG-LOGIC-072 — Feature-flag localStorage TOCTOU
- **Category:** Logical Error · toctou
- **Description:** Two tabs read the same localStorage flag, both see it unset, and both write their own value — the second write silently replaces the first, and per-tab flag state diverges from what any single writer set. Detection: a test simulating two concurrent flag writers and asserting the stored value; the `storage` event or a single-writer pattern is the fix.
- **Real-world example:** The storage TOCTOU class is a recognized client-storage failure mode (localStorage's last-writer-wins semantics are documented in web-storage guides).

### BUG-LOGIC-073 — Weak idempotency key generation
- **Category:** Logical Error · dedupe-race
- **Description:** An idempotency or dedupe key is generated client-side with `Math.random()` or a timestamp without entropy, so two rapid submissions produce the same key and the dedupe layer collapses them — or conversely, the key differs across retries of the same logical operation, so the dedupe layer never matches and duplicates pass. Detection: a test issuing two rapid submissions and two retries and asserting the key's stability and uniqueness; a UUID/ULID generator plus server-side scoping is the fix.
- **Real-world example:** The weak-key class is a recognized payments failure mode (Stripe's idempotency-key docs require a stable key per logical operation, and Math.random is documented as unsuitable for identifiers).

### BUG-LOGIC-074 — Props-derived state mutation
- **Category:** Logical Error · derived-state
- **Description:** A React component copies props into state during render (or mutates the props object directly), so the copied state goes stale when the parent re-renders with new props. The component renders old data until a key change forces remount, and direct prop mutation corrupts the parent's data for siblings. Detection: a test re-rendering with new props and asserting the component shows them; the render-time-copy and key-reset patterns are the documented fixes.
- **Real-world example:** The derived-state anti-pattern is a documented React bug class ("you might not need derived state" in React docs) — render-time prop copies going stale is the canonical failure mode.

### BUG-LOGIC-075 — Cleanup race clearing an in-flight flag
- **Category:** Logical Error · cleanup-race
- **Description:** A completion/cleanup path clears a module-level in-flight flag while another request is mid-operation and still relies on it, so the second request's guard reads "idle" and double-fires or skips its own bookkeeping. Detection: a test with an overlapping request whose cleanup fires during the second's in-flight window; per-operation state (request-scoped, not module-level) is the fix.
- **Real-world example:** The cleanup-race class is a recognized shared-state failure mode in long-lived processes; request-scoped state (AsyncLocalStorage, per-request objects) is the standard mitigation.

### BUG-LOGIC-076 — Queue double-processing without visibility timeout
- **Category:** Logical Error · double-processing
- **Description:** Two workers consume from the same queue (or the same worker re-polls before acknowledging) without a visibility timeout or lease, so both process the same job. Side effects fire twice — duplicate emails, duplicate charges, double inventory decrements. Detection: a test with two concurrent consumers asserting one processing per job; visibility timeouts, leases, or idempotent handlers are the fix.
- **Real-world example:** The double-processing class is a recognized job-queue failure mode (SQS's visibility timeout exists precisely because unguarded consumption processes jobs twice).

### BUG-LOGIC-077 — Interval callback stale data
- **Category:** Logical Error · stale-closure
- **Description:** A `setInterval` (or a long-lived event callback) closes over data captured at registration time, so every tick processes the registration-time snapshot instead of the current state. Polling, retries, and refreshes act on stale inputs indefinitely. Detection: a test mutating the underlying state and asserting the next tick sees the new value; a ref-based read (or re-registering the interval on state change) is the fix.
- **Real-world example:** The interval-stale-closure class is a documented React pattern (React docs' "synchronizing with effects" section) and a recurring cause of polls acting on stale inputs.

### BUG-LOGIC-078 — Version check skipped in update
- **Category:** Logical Error · optimistic-locking
- **Description:** An update path accepts the record's version/etag field but never includes it in the write's WHERE clause (or never verifies it), so a concurrent writer's change is silently overwritten. The last writer wins and the user whose edit was lost sees their change disappear on refetch. Detection: a test with two concurrent writers asserting the second is rejected with a conflict; `WHERE version = ?` (or If-Match precondition) is the fix.
- **Real-world example:** The skipped-version-check class is a recognized optimistic-locking failure mode (ETag/If-Match preconditions and version-column WHERE clauses are the standard patterns).

### BUG-LOGIC-079 — Silent-catch fallback to heuristic
- **Category:** Logical Error · silent-catch
- **Description:** An async analysis/AI call is wrapped in a try/catch whose catch block falls back to a local heuristic (a keyword match, a default score) instead of propagating the failure. The feature is dead in production — every call fails, every call "succeeds" with the heuristic — while dashboards report 100% success because the fallback shape matches the success contract. Detection: assert the fallback is unreachable (inject a failing dependency and assert the error propagates), or count fallback-path executions in telemetry and alert when it is the majority.
- **Real-world example:** The silent-catch fallback class is a recognized fail-open failure mode (the AI-analysis-call-swallowed-and-fell-back-to-a-heuristic pattern); SRE practice distinguishes fail-open from fail-closed and requires telemetry on fallback-path execution.

### BUG-LOGIC-080 — Whole-object null comparison
- **Category:** Logical Error · result-object-comparison
- **Description:** A rate-limit (or policy) check compares the entire result object to null (`if (rateLimitResult == null)`) instead of reading the field that carries the decision (`rateLimitResult.limited`). The lookup returns a populated object for every call — including "you are limited" — so the comparison never matches, the guard is dead code, and abusive traffic is never limited. Detection: log the object's shape at the check boundary and assert the exact field; a unit test that mocks a "limited" result and asserts the rejection exposes the dead guard immediately.
- **Real-world example:** The envelope-vs-field comparison class is a recognized SDK bug pattern (clients returning `{ data, error }` envelopes; the "compared the envelope to null" bug class is documented in rate-limiting postmortems).

### BUG-LOGIC-081 — Catch-and-rethrow losing the stack
- **Category:** Logical Error · stack-loss
- **Description:** A catch block wraps the error in a new `Error` with only a message (`throw new Error("failed to process")`) or rethrows after destructive transformation, discarding the original stack and cause. The production stack trace points at the rethrow site, and the original failure's file and line are unrecoverable. Detection: assert `error.cause` (or the preserved original) in tests; `throw new Error(msg, { cause: err })` or bare `throw err` preserves the chain and is the fix visible in the diff.
- **Real-world example:** The stack-loss class is a recognized error-handling anti-pattern (ES2022's `cause` option exists specifically to preserve error chains; Java's chained exceptions are the same pattern).

### BUG-LOGIC-082 — Error-object-vs-string confusion
- **Category:** Logical Error · error-type-confusion
- **Description:** A catch handler compares the caught value against a string (`catch (e) { if (e === "timeout") ... }`) while the runtime throws Error objects, or checks `error.message` against a full message that has since changed. The intended recovery branch is unreachable, so every failure takes the generic path and retry/cancel-specific handling never fires. Detection: log `typeof e` and `e.constructor.name` at the catch boundary; a unit test asserting the branch fires for the real error shape catches the mismatch.
- **Real-world example:** The error-type confusion class is a standing item in error-handling guides (typed error hierarchies, e.g. domain-error classes with `instanceof` checks, exist for this reason).

### BUG-LOGIC-083 — Floating promise without rejection handling
- **Category:** Logical Error · unhandled-rejection
- **Description:** An async call is made without `await` and without `.catch` (`void doWrite()` or a bare `doWrite()`), so its rejection is unhandled. The write fails silently at first; in Node 15+ the unhandled rejection crashes the process later, decoupled from the operation that launched it. Detection: `process.on('unhandledRejection')` telemetry and lint rules (`no-floating-promises` in typescript-eslint) flag the construct.
- **Real-world example:** The floating-promise class is a recognized Node.js failure mode (typescript-eslint's `no-floating-promises` rule exists for it, and Node 15+ changed unhandled rejections from a warning to a crash).

### BUG-LOGIC-084 — try/catch around the wrong statement
- **Category:** Logical Error · misplaced-try
- **Description:** A try block wraps the await call but the error is thrown by an earlier synchronous statement outside the try (a JSON.parse, a property access on config, a validation throw), so the error escapes the handler entirely. The operation fails with an unhandled rejection instead of the intended error path. Detection: move the entire body into the try (or hoist the throwing statement) and assert with a test that forces the early throw; the unhandled-rejection log shows the escape.
- **Real-world example:** The misplaced-try class is a standing error-handling bug (the "try around the await, not the body" pattern appears in error-handling guides and code-review checklists).

### BUG-LOGIC-085 — Empty catch block
- **Category:** Logical Error · silent-catch
- **Description:** A `catch {}` (or `catch (e) {}`) swallows every error without logging, rethrowing, or falling back deliberately. Failures — network errors, validation throws, permission denials — vanish, and the operation reports success while producing no effect. Detection: linters (`no-empty` with `allowEmptyCatch: false`) flag the construct; a unit test that forces each error class and asserts it surfaces exposes the swallow.
- **Real-world example:** The empty-catch class is a recognized anti-pattern (ESLint's `no-empty` rule exists for it and every major style guide flags it); "insufficient error handling" appears in the CWE lesser-known list.

### BUG-LOGIC-086 — Message-string-only error matching
- **Category:** Logical Error · error-type-confusion
- **Description:** A catch handler branches on `error.message.includes("...")` against a substring of a library's message text. Library upgrades reword messages, so the branch becomes unreachable and the intended recovery (retry, fallback, user-facing copy) silently stops firing. Detection: assert against the error's code/type (`error.code`, `instanceof`) in tests; typed error hierarchies or error-code constants are the fix visible in the diff.
- **Real-world example:** The message-matching class is a recognized error-handling bug (library message texts are not APIs; typed error codes and `instanceof` hierarchies are the standard pattern).

### BUG-LOGIC-087 — Return in finally swallowing exceptions
- **Category:** Logical Error · finally-return
- **Description:** A `finally` block contains a `return` (or `break`/`continue`), which discards any in-flight exception or pending return value from the try block. Failures inside the try vanish — the function returns the finally's value as if the try had succeeded. Detection: a unit test that throws from the try body and asserts the exception propagates; linters (`no-unsafe-finally`) flag the construct.
- **Real-world example:** The return-in-finally class is a documented language behavior (JavaScript and Java both define finally-return as discarding in-flight exceptions; ESLint's `no-unsafe-finally` rule exists for it).

### BUG-LOGIC-088 — Catch returning success-shaped fallback
- **Category:** Logical Error · silent-catch
- **Description:** A `.catch(err => ({ items: [], ok: true }))` (or an equivalent catch block returning a success-shaped object) converts failure into a valid-looking response. Callers cannot distinguish the failure from a genuinely empty result, so the failure is invisible in metrics and downstream logic proceeds on fabricated data. Detection: a unit test with a failing dependency asserting the error propagates, or tagging fallback responses in telemetry and alerting when fallback volume is nonzero.
- **Real-world example:** The catch-returns-success class is a recognized fail-open pattern (SRE guidance distinguishes fail-open from fail-closed; monitoring fallback-path volume is the standard detection method).

### BUG-LOGIC-089 — allSettled results treated as all-fulfilled
- **Category:** Logical Error · result-object-comparison
- **Description:** A `Promise.allSettled` result is consumed as if every item fulfilled (`results.forEach(r => process(r.value))`), but rejected items have `reason` and no `value`, so `r.value` is `undefined` for each rejection. Processing continues on undefined inputs, silently dropping failed operations from the batch instead of surfacing them. Detection: a unit test that rejects one input and asserts the failure is surfaced (or that rejected items are branched on `r.status`); logging `r.status` per item exposes the conflation.
- **Real-world example:** The allSettled-shape conflation class is a documented JS gotcha (MDN: allSettled returns `{status, value}` or `{status, reason}`) and the reason `r.status` branching is the standard consumption pattern.

### BUG-LOGIC-090 — Async event handler errors lost
- **Category:** Logical Error · unhandled-rejection
- **Description:** An async function is passed as an event listener (or as a callback to a sync-only API), so its rejection is never observed by the event system. Failures inside the handler vanish; the emitter or DOM keeps dispatching, and the error surfaces only as an unhandledRejection log (or not at all in older browsers). Detection: wrap handler bodies or attach `.catch` to the returned promise; a unit test that makes the handler throw and asserts the error surfaces exposes the loss.
- **Real-world example:** The async-listener class is a documented JS gotcha (EventEmitter and DOM APIs do not await listener promises; Node's unhandledRejection and the browser's `unhandledrejection` event are the detection surfaces).

### BUG-LOGIC-091 — Fail-open validation
- **Category:** Logical Error · fail-open
- **Description:** A validation path catches schema errors and logs them but continues processing the invalid data (returns the input unchanged). Invalid records flow into storage and downstream logic — duplicates, missing fields, type errors — while logs show a growing stream of "validation failed" lines that nobody treats as a failure. Detection: a unit test feeding an invalid record and asserting it is rejected (or quarantined); alerting on validation-failure volume is the operational detection surface.
- **Real-world example:** The fail-open validation class is a recognized data-pipeline failure mode (SRE guidance distinguishes fail-open from fail-closed; schema-enforcement guides — e.g. Protobuf/Avro pipeline guides — require rejecting or quarantining invalid records).

### BUG-LOGIC-092 — Silent default after retries exhausted
- **Category:** Logical Error · silent-fallback
- **Description:** A retry loop returns a default value when all attempts fail, without propagating the final error or marking the result as degraded. Callers receive the default as if it were real data — a zero balance, an empty list, a fallback config — and downstream decisions run on fabricated values. Detection: a unit test exhausting the retries and asserting the error (or a degraded flag) surfaces; telemetry on default-path execution is the operational surface.
- **Real-world example:** The silent-default-after-retries class is a recognized fail-open pattern (retry guides document propagating the final error or marking degraded results as the required pattern).

### BUG-LOGIC-093 — uncaughtException handler without exit
- **Category:** Logical Error · uncaught-exception
- **Description:** A `process.on('uncaughtException')` handler logs and returns without exiting the process. After an uncaught exception the process is in an undefined state (corrupted invariants, half-completed writes), and it continues serving requests on that state indefinitely. Detection: assert `process.exit` is called (or the handler rethrows) in a test; the recommended pattern is to clean up and exit, letting a supervisor restart the process.
- **Real-world example:** The non-exiting-uncaughtException class is documented in Node.js's official error-handling guidance ("correct use of 'uncaughtException'... restart the process") — continuing on an undefined state is the documented failure mode.

### BUG-LOGIC-094 — Error-first callback convention violated
- **Category:** Logical Error · error-first-convention
- **Description:** A callback-style function passes errors as a second argument (or omits them), while consumers check the first argument for the error. The consumer's `if (err)` branch fires on success results (or never fires on failure), and the success data is treated as an error object. Detection: a unit test asserting the callback's argument order and shape; TypeScript's callback type signatures surface the mismatch at compile time.
- **Real-world example:** The error-first-convention class is a documented Node.js convention (Node's callback-style APIs define errors as the first callback argument; violations are flagged in code review and typed signatures).

### BUG-LOGIC-095 — Assert disabled by wrong NODE_ENV check
- **Category:** Logical Error · assert-disabled
- **Description:** An invariant check is gated by `if (process.env.NODE_ENV === "production") return` (or an equivalent) with the comparison inverted, so assertions run in production and are skipped in development — or the assert library is stubbed out by a build-time check that misfires. Invariants that would have caught corruption in dev are silently skipped, and production crashes on the corruption instead. Detection: a test asserting the invariant fires in dev and is skipped in prod (or vice versa per intent); logging the assert library's active state at startup exposes the misfire.
- **Real-world example:** The misfired-env-gate class is a recognized build-config failure mode (Node's NODE_ENV semantics and Vite/webpack's mode checks are documented; the "assert disabled in prod" bug class appears in bundler migration guides).

### BUG-LOGIC-096 — setTimeout throw escapes try
- **Category:** Logical Error · async-throw-escape
- **Description:** A `setTimeout` (or other macrotask callback) is registered inside a try block, and the callback throws. The try/catch has already exited by the time the callback fires, so the error escapes as an uncaught exception and the intended error path never fires. Detection: a test that makes the callback throw and asserts the error surfaces through the intended handler; the uncaughtException log shows the escape.
- **Real-world example:** The async-throw-escape class is a documented JS behavior (try/catch is synchronous; MDN's try...catch guide and error-handling guides document it) and a recurring source of unhandled crashes in timer-driven logic.

### BUG-LOGIC-097 — Catch variable shadowing
- **Category:** Logical Error · shadowing
- **Description:** A nested try/catch redeclares the catch variable with the same name (`catch (e)` inside a `catch (e)`), or the catch variable shadows an outer error being rethrown. The inner handler inspects or rethrows the wrong error object, so the outer failure's details are lost and the wrong recovery branch fires. Detection: a unit test asserting which error object arrives at the outer handler; linters (`no-shadow`) flag the construct at review time.
- **Real-world example:** The catch-shadowing class is flagged by ESLint's `no-shadow` rule and is a recurring source of lost-error-detail bugs in nested cleanup and retry chains.

### BUG-LOGIC-098 — Cancellation treated as failure
- **Category:** Logical Error · cancellation-confusion
- **Description:** A user-initiated cancel (AbortError, an HTTP client's cancel exception) is thrown as an error and the catch handler treats it identically to a real failure — an error toast is shown, a retry is scheduled, and an incident is logged for a cancellation the user requested. Detection: branch on the error's name/code (`err.name === "AbortError"`) in tests; a unit test asserting the cancel path shows no error UI and no retry exposes the conflation.
- **Real-world example:** The cancellation-as-failure class is a recognized frontend bug pattern (AbortController and fetch's AbortError; retry libraries — e.g. axios-retry — document ignoring abort errors as the required pattern).

### BUG-LOGIC-099 — Error boundary misses async effect errors
- **Category:** Logical Error · error-boundary
- **Description:** A React error boundary is relied on to catch errors thrown inside `useEffect` (or event handlers), but React error boundaries only catch errors during rendering, lifecycle methods, and constructors. Errors thrown in async effects and event handlers escape the boundary, so the app continues in a broken state (or the whole tree unmounts via re-throw). Detection: a test that throws inside an effect and asserts whether the boundary catches; wrapping the async body or attaching `.catch` to state-carrying promises is the fix.
- **Real-world example:** The error-boundary-misses-async class is a documented React behavior (React docs: "Error boundaries do not catch errors in event handlers or async code").

### BUG-LOGIC-100 — Catch attached to wrong promise in chain
- **Category:** Logical Error · misplaced-catch
- **Description:** A `.catch` is attached to an inner promise in a chain while the outer promise's rejection goes unobserved (`Promise.all([a.catch(...), b]).then(...)` — b's rejection is unhandled). The intended recovery fires for one branch while the other branch's rejection surfaces as an unhandled rejection or crashes the process. Detection: a unit test failing each branch independently and asserting the error surfaces; `Promise.allSettled` or a catch on the outermost promise is the fix.
- **Real-world example:** The misplaced-catch class is a recognized promise-chain failure mode (the "catch on the outermost promise" pattern appears in promise guides; unhandled rejections in Node 15+ crash the process).

### BUG-LOGIC-101 — res.ok conflated with network failure
- **Category:** Logical Error · status-conflation
- **Description:** An HTTP client checks only `res.ok` (or `res.status === 200`) and treats every non-ok response as a network/transient failure, retrying 4xx responses (validation errors, auth failures) that will fail identically on every retry. The retry loop hammers the endpoint with doomed requests and the user waits through retries for an error that is permanent. Detection: branch on status ranges (`res.status >= 500` for retry) in tests; a unit test asserting 4xx responses are not retried exposes the conflation.
- **Real-world example:** The retry-4xx class is a recognized HTTP-client failure mode (retry guides — e.g. AWS SDK's retry strategy — document retrying only 5xx and 429, not 4xx).

### BUG-LOGIC-102 — JSON.parse error treated as empty object
- **Category:** Logical Error · silent-catch
- **Description:** A `JSON.parse` call is wrapped in a try/catch whose catch returns `{}` (or `[]`), converting a corrupt payload into an empty-but-valid object. Downstream code proceeds on the empty object — a config reset, an empty user profile, a skipped migration — while the corruption is invisible in metrics. Detection: a unit test feeding a corrupt payload and asserting the error (or a parse-failure flag) surfaces; tagging parse failures in telemetry is the operational surface.
- **Real-world example:** The parse-error-to-empty class is a recognized fail-open pattern (config and cache loaders that swallow parse errors reset user state silently — a recurring bug class in JSON-lines and localStorage-backed configs).

### BUG-LOGIC-103 — Cleanup error masks original error
- **Category:** Logical Error · cleanup-masking
- **Description:** An error is thrown inside a `finally` block (or in a close/rollback path) while the try block's original exception is still in flight. The cleanup error replaces the original, so the production stack trace points at the cleanup path and the real failure's cause is lost. Detection: a unit test that throws in both the try and the finally and asserts which error propagates; aggregating errors (or suppressing cleanup errors into logs) is the fix.
- **Real-world example:** The cleanup-masking class is a documented language behavior (a finally throw replaces the in-flight exception) and a recurring source of lost-root-cause bugs in resource-cleanup chains.

### BUG-LOGIC-104 — Promise.race loser rejection unhandled
- **Category:** Logical Error · unhandled-rejection
- **Description:** `Promise.race` is used to implement a timeout, but the losing promise's rejection is never observed. When the timed-out operation rejects after the race has settled, the rejection is unhandled and crashes the process (Node 15+) or surfaces as an unhandledRejection log. Detection: attach `.catch` to the losing promise (or use an AbortController to cancel it) and assert with a test that makes the timed-out operation reject after the timeout; the unhandledRejection log shows the escape.
- **Real-world example:** The race-loser-rejection class is a recognized timeout-implementation failure mode (Promise.race timeout guides document cancelling the loser or attaching a catch as the required pattern).

### BUG-LOGIC-105 — Integer division truncation
- **Category:** Logical Error · integer-division
- **Description:** Two integers are divided with the language's native division operator in a statically typed language (Java, C#, Go, Rust), which truncates toward zero: `7 / 2` is 3, not 3.5. Averaging, scaling, and progress-percentage math silently lose the fraction, and accumulated truncation drifts the result far from the true value. Detection: assert the division result against the exact expected value in a unit test; promoting one operand to float (`7.0 / 2` or `(double) a / b`) is the fix visible in the diff.
- **Real-world example:** The integer-division class is a documented language behavior in every statically typed language and a standing bug class in averaging and percentage math flagged in code review.

### BUG-LOGIC-106 — Floating-point money math
- **Category:** Logical Error · float-money
- **Description:** Monetary amounts are represented and accumulated in binary floating point (`0.1 + 0.2`), which cannot represent most decimal fractions exactly. Totals drift by fractions of a cent, comparisons against exact amounts fail, and reconciliation against an external ledger mismatches by tiny amounts that compound over volume. Detection: assert totals with an epsilon or compare integer minor units (cents) in tests; integer minor units or a decimal library (decimal.js, Java BigDecimal) is the fix.
- **Real-world example:** The float-money class is a recognized bug pattern (Vancouver Stock Exchange 1982-83: an index truncated to 3 decimals at each step lost roughly half its value over 16 months — the canonical truncation incident); integer minor units and BigDecimal are the standard fixes.

### BUG-LOGIC-107 — Timezone-naive date math
- **Category:** Logical Error · timezone
- **Description:** Calendar math subtracts dates or adds days using naive local-time arithmetic without a timezone, so transitions across DST (or between timezones) shift results by an hour — or a day. A "next billing date" computed as +30 days lands on the wrong date after a DST transition, and duration math across the boundary is off by an hour. Detection: assert the computed date across a DST boundary (seed the test with dates around the transition) in a unit test; timezone-aware libraries (date-fns-tz, Luxon, java.time) are the fix.
- **Real-world example:** The timezone-naive class is a recognized date-math bug class (the 2007 US DST rule change shifted calendar appointments by an hour in Outlook/Exchange deployments until patched); timezone-aware libraries are the standard fix.

### BUG-LOGIC-108 — Date.now() vs Date object comparison
- **Category:** Logical Error · date-ms
- **Description:** A timestamp from `Date.now()` (a number of milliseconds) is compared against a `Date` object (or vice versa) with relational operators. `Date` coerces to its numeric value in relational comparisons but not in `===`, so equality checks against `Date.now()` never match and ordering checks behave inconsistently. Detection: normalize both operands to the same type (`.getTime()` or `Date.now()`) and assert with a unit test; TypeScript's type checker surfaces the mismatch when types are annotated.
- **Real-world example:** The Date.now-vs-Date class is a documented JS gotcha (MDN: Date's valueOf is numeric but equality is reference-based) and a recurring source of token-expiry and cache-TTL comparison bugs.

### BUG-LOGIC-109 — Milliseconds vs seconds in setTimeout
- **Category:** Logical Error · unit-mismatch
- **Description:** A duration in seconds is passed to `setTimeout` (which expects milliseconds) or an API expecting seconds receives milliseconds. A 30-second delay becomes 30ms (firing immediately) or 30000ms becomes 30000s (never firing), so timers and deadlines are off by a factor of 1000. Detection: assert the timer's actual fire time in a unit test with a short duration; a named-constant unit conversion (`SECONDS * 1000`) or a duration library is the fix.
- **Real-world example:** The ms-vs-seconds class is a recognized unit bug class in timer and deadline code (Mars Climate Orbiter 1999: lbf-sec vs N-sec unit mismatch — the canonical unit-mismatch incident); named conversions and duration types are the standard fixes.

### BUG-LOGIC-110 — Percentage rounding drift
- **Category:** Logical Error · percentage-rounding
- **Description:** A set of shares is rounded to whole percentages individually, and the rounded values are summed or presented as a total. The rounded sum does not equal 100 (33.3/33.3/33.3 rounds to 33/33/33 = 99), so dashboards show totals that contradict their parts and downstream allocation math based on the rounded shares under-allocates. Detection: assert the rounded sum equals the expected total in a unit test; largest-remainder (Hare quota) allocation is the standard fix.
- **Real-world example:** The percentage-rounding class is a recognized allocation bug (the Alabama paradox in US congressional apportionment — rounding shares individually changes seat counts non-monotonically); largest-remainder methods are the standard fix.

### BUG-LOGIC-111 — Date-range inclusive/exclusive boundary
- **Category:** Logical Error · date-boundary
- **Description:** A date-range filter uses `<` (exclusive end) where the business intent was inclusive (`<=`), or vice versa. Events on the boundary date are silently excluded from reports, invoices, and analytics — end-of-month billing, quarter-close data, or daily rollups lose the boundary day's rows. Detection: assert the boundary date's inclusion in a unit test seeded with rows exactly at the boundary; the half-open interval convention `[start, end)` documented in the API contract is the fix.
- **Real-world example:** The inclusive/exclusive date-boundary class is a recognized reporting bug class (every analytics warehouse's date-range guide documents the half-open interval convention precisely because boundary days are silently lost).

### BUG-LOGIC-112 — Negative-index array access
- **Category:** Logical Error · negative-index
- **Description:** Code written with Python's negative-indexing semantics (`arr[-1]` for the last element) runs in JavaScript, where `arr[-1]` is a property lookup on the "-1" key and returns `undefined`. The "last element" is undefined, so downstream logic processes `undefined` instead of the real last item. Detection: `arr[arr.length - 1]` or `.at(-1)` in the assertion; a unit test asserting the last element's value catches it immediately.
- **Real-world example:** The negative-index class is a documented cross-language gotcha (MDN: Array.prototype.at exists for negative indexing in JS; Python's negative indices are the source of the confusion).

### BUG-LOGIC-113 — Modulo on negative numbers
- **Category:** Logical Error · modulo-negative
- **Description:** A modulo operation is used on a negative operand assuming Python's semantics (sign follows the divisor), but JavaScript/C/Java return the sign of the dividend: `-7 % 3` is -1 in JS, 2 in Python. A wrap-around index or bucket calculation therefore produces a negative result and indexes an out-of-range bucket or slot. Detection: assert the modulo result for negative operands in a unit test; a normalization step (`((x % n) + n) % n`) is the fix visible in the diff.
- **Real-world example:** The negative-modulo class is a documented cross-language behavior difference and a recurring bug in ring buffers, hash buckets, and wrap-around indexing flagged in code review.

### BUG-LOGIC-114 — Percent as 0-1 vs 0-100
- **Category:** Logical Error · unit-mismatch
- **Description:** A progress or confidence value in the 0-1 range is rendered or compared as if it were 0-100 (or vice versa). A 0.85 confidence displays as "0.85%" or an 85% threshold never fires against a 0-1 value, so thresholds, progress bars, and confidence gates are off by a factor of 100. Detection: assert the value's range at the boundary in a unit test; a named type (`Ratio` vs `Percent`) or a conversion constant is the fix.
- **Real-world example:** The 0-1-vs-0-100 class is a recognized unit bug class in ML confidence thresholds and progress UIs (ML evaluation guides document ratio-vs-percent mismatches as a standing bug class).

### BUG-LOGIC-115 — Floating-point accumulation in a loop
- **Category:** Logical Error · float-accumulation
- **Description:** A running total accumulates a binary-fraction step (`sum += 0.1`) over many iterations, and IEEE 754 rounding errors compound with each addition. The final total drifts from the true value (0.1 added 1000 times is 99.9999999999986), so comparisons against an exact total and reconciliation against an external ledger mismatch. Detection: assert the accumulated total against the true value with an epsilon in a unit test; integer minor units or Kahan summation is the fix.
- **Real-world example:** The float-accumulation class is a recognized numerical bug class (the Patriot missile system's 1991 Gulf War failure: 0.1-second clock ticks accumulated 0.34 seconds of drift over 100 hours, and the interceptor missed its target — the canonical accumulation incident).

### BUG-LOGIC-116 — Seconds-vs-ms timestamp in expiry checks
- **Category:** Logical Error · unit-mismatch
- **Description:** A token or session expiry field in seconds (JWT `exp`, OAuth expires_in) is compared against `Date.now()` (milliseconds) without conversion. The comparison is off by a factor of 1000 — tokens appear expired immediately (or valid for 1000× their lifetime), so sessions are rejected or over-extended. Detection: assert the comparison against a fixed clock in a unit test; a named conversion (`exp * 1000` vs `Date.now()`) or a duration library is the fix.
- **Real-world example:** The seconds-vs-ms expiry class is a recognized auth bug class (JWT `exp` is in seconds per RFC 7519; every JWT library's guide documents the seconds-vs-ms conversion trap).

### BUG-LOGIC-117 — Leap year calculation
- **Category:** Logical Error · leap-year
- **Description:** A leap-year check uses `year % 4 === 0` only, missing the century rule (divisible by 100 but not 400 are not leap years). 1900 and 2100 are treated as leap years, so date math around those years is off by a day — a long-lived schedule or archival calculation drifts. Detection: assert the leap-year result for 1900, 2000, and 2100 in a unit test; a standard calendar library or the full rule (`% 4 === 0 && (% 100 !== 0 || % 400 === 0)`) is the fix.
- **Real-world example:** The leap-year class is a documented calendar bug class (the century rule is the standing trap in every date-math implementation; the Y2K-adjacent 1900/2100 class appears in archival and long-schedule systems).

### BUG-LOGIC-118 — Month index 0-based in Date constructor
- **Category:** Logical Error · month-index
- **Description:** A `Date` is constructed with a 1-based month number (`new Date(2024, 12, 1)`), but JavaScript's month index is 0-based. Month 12 becomes January of the next year, so "December 1, 2024" silently becomes "January 1, 2025" and all derived dates, schedules, and reports are off by a month. Detection: assert the constructed date's month in a unit test; a named-constant conversion (`month - 1`) or a date library is the fix visible in the diff.
- **Real-world example:** The 0-based-month class is a documented JS gotcha (MDN: month values are 0-based in the Date constructor) and a recurring source of off-by-one-month bugs in scheduling code.

### BUG-LOGIC-119 — Average over an empty array
- **Category:** Logical Error · division-by-zero
- **Description:** An average is computed as `sum / values.length` without guarding the empty case. On an empty array the result is `NaN` in JavaScript (0/0) or a division-by-zero exception in statically typed runtimes, and the NaN propagates into comparisons, sorting, and persistence downstream. Detection: a unit test over the empty input asserting the guard (return 0, null, or throw per contract); a length guard before the division is the fix.
- **Real-world example:** The empty-average class is a recognized aggregation bug class (NaN propagation through aggregation pipelines is documented in numerical-computing guides; a length guard is the standard fix).

### BUG-LOGIC-120 — Bytes vs bits confusion
- **Category:** Logical Error · unit-mismatch
- **Description:** A bandwidth or storage calculation mixes bytes and bits (MB vs Mb), which differ by a factor of 8. A 100 Mbps link is treated as 100 MB/s (8× too fast) or a 100 MB file is treated as 100 Mb (8× too small), so capacity planning, transfer-time estimates, and rate limits are off by 8×. Detection: assert the calculation against a known reference in a unit test; named unit types (Bytes vs Bits) or conversion constants are the fix.
- **Real-world example:** The bytes-vs-bits class is a recognized unit bug class in networking code (ISP marketing uses bits while file sizes use bytes; the 8× mismatch is a standing trap in capacity planning).

### BUG-LOGIC-121 — Floor instead of ceil for page count
- **Category:** Logical Error · rounding-direction
- **Description:** A total page count is computed with `Math.floor(total / pageSize)` instead of `Math.ceil`. A dataset of 101 rows with pageSize 100 reports 1 page, so the last row is unreachable — consumers never fetch page 2 and the final rows are silently lost. Detection: assert the page count for a non-divisible dataset in a unit test; `Math.ceil` (or integer division with an adjustment) is the fix.
- **Real-world example:** The floor-vs-ceil class is a recognized pagination bug class (every pagination guide documents the ceil requirement precisely because non-divisible datasets lose their last page).

### BUG-LOGIC-122 — Rounding at the wrong stage
- **Category:** Logical Error · rounding-stage
- **Description:** Monetary amounts are rounded at each intermediate step (per-line-item, per-conversion) instead of once at the final aggregation. Rounding errors accumulate across steps, and the final total mismatches the external ledger by more than the tolerance — or line items sum to a different total than the invoice. Detection: assert the final total against the ledger in an integration test; rounding once at the final step is the fix visible in the diff.
- **Real-world example:** The rounding-stage class is a recognized accounting bug class (double-entry accounting guides document rounding once at the final step; per-step rounding drift is a recurring reconciliation failure).

### BUG-LOGIC-123 — Duration stored in the wrong unit
- **Category:** Logical Error · unit-mismatch
- **Description:** A duration computed from date subtraction (milliseconds) is stored in a field consumed as seconds (or vice versa) without conversion. Downstream code reads a duration 1000× too large or too small, so SLA checks, timeouts, and analytics thresholds are off by 1000×. Detection: assert the stored value's unit at the write boundary in a unit test; a named type (`Duration` vs `Millisecond`) or a conversion constant is the fix.
- **Real-world example:** The duration-unit class is a recognized bug class in SLA and analytics code (Mars Climate Orbiter is the canonical unit-mismatch incident; named duration types are the standard fix).

### BUG-LOGIC-124 — Tax computed on the wrong base
- **Category:** Logical Error · order-of-operations
- **Description:** Tax is computed on the pre-discount subtotal when the jurisdiction's policy says post-discount (or vice versa), or a discount is applied after tax was already added. The final total differs from the policy-correct amount, and invoices or checkout totals are systematically wrong for every order. Detection: an integration test asserting the final total against a policy-correct worked example; the order-of-operations contract documented in the billing spec is the fix.
- **Real-world example:** The tax-base class is a recognized billing bug class (sales-tax guides document tax-base rules per jurisdiction; the order-of-operations trap is a recurring checkout bug).

### BUG-LOGIC-125 — Integer overflow on ID generation
- **Category:** Logical Error · overflow
- **Description:** A generated identifier based on `Date.now()` (or a counter) is stored or serialized into a 32-bit integer context (a bitwise operation, a protobuf int32, a database INT column), truncating the value. Two IDs collide after truncation, so lookups, dedupe keys, and references resolve to the wrong record. Detection: assert the ID survives a round-trip through the narrow type in a unit test; 64-bit or string IDs (and avoiding bitwise truncation) are the fix.
- **Real-world example:** The truncation-collision class is a recognized ID-generation bug class (Ariane 5 Flight 501 1996: a 64-bit float converted to a 16-bit integer overflowed and crashed the launcher — the canonical overflow incident); 64-bit/string IDs are the standard fix.

### BUG-LOGIC-126 — NaN propagation through arithmetic
- **Category:** Logical Error · nan-propagation
- **Description:** An undefined or missing operand enters arithmetic (`undefined * 2`, `null + 1`), producing NaN silently. The NaN propagates through sums, comparisons (all false), and persistence (stored as NaN/NULL), and downstream logic branches on comparisons that never match. Detection: assert intermediate values with `Number.isNaN` in a unit test; input validation at the boundary (or a NaN guard before persistence) is the fix.
- **Real-world example:** The NaN-propagation class is a recognized numerical bug class (NaN's absorbing property in arithmetic is documented in IEEE 754 guides; input validation at the boundary is the standard fix).

### BUG-LOGIC-127 — Locale decimal separator parsing
- **Category:** Logical Error · locale-parsing
- **Description:** A numeric string with a comma decimal separator ("1,5") is parsed with `parseFloat` or `Number`, which expect a dot: "1,5" parses as 1 (stopping at the comma) or 15 (after a comma strip). Amounts from locale-formatted inputs are off by 10× or truncated, so payments and measurements are systematically wrong. Detection: assert the parsed value for comma-decimal inputs in a unit test; `Intl.NumberFormat` parsing or explicit locale handling is the fix.
- **Real-world example:** The locale-decimal class is a recognized parsing bug class (European decimal commas vs US dots; `Intl.NumberFormat` and locale-aware parsing are the standard fixes).

### BUG-LOGIC-128 — Local-epoch vs UTC epoch
- **Category:** Logical Error · epoch-offset
- **Description:** A timestamp is computed as "seconds since 1970 in local time" (subtracting a local-time epoch or using a naive epoch constant) instead of the UTC epoch. The timestamp is offset by the timezone's UTC offset, so comparisons against other systems' timestamps and expiry checks are off by hours. Detection: assert the computed timestamp against `Date.now()` (UTC epoch) in a unit test; `Date.now()`/`getTime()` (UTC-based) is the fix visible in the diff.
- **Real-world example:** The epoch-offset class is a recognized timestamp bug class (Unix epoch is UTC per POSIX; local-epoch arithmetic is a recurring bug in hand-rolled timestamp code).

### BUG-LOGIC-129 — Rounding mode mismatch in money
- **Category:** Logical Error · rounding-mode
- **Description:** A rounding operation uses half-up rounding (JavaScript's `Math.round`) where the accounting contract requires banker's rounding (half-to-even, as in Java's `RoundingMode.HALF_EVEN`), or vice versa. Amounts ending in exactly .5 differ from the ledger by one minor unit, and reconciliation mismatches appear at volume. Detection: assert the rounding result for exact-half inputs in a unit test; the rounding-mode contract documented in the accounting spec is the fix.
- **Real-world example:** The rounding-mode class is a recognized accounting bug class (banker's rounding exists specifically because half-up drifts at volume; Java's RoundingMode and decimal libraries expose the mode explicitly).

### BUG-LOGIC-130 — Math.max/min with a NaN argument
- **Category:** Logical Error · nan-propagation
- **Description:** `Math.max` or `Math.min` is called with an operand that can be NaN (from a failed parse or missing field). NaN is returned for any NaN operand, so the max/min result is NaN and downstream comparisons, thresholds, and persistence receive NaN instead of the real extremum. Detection: assert the max/min result with a NaN operand in a unit test; filtering NaN operands before the call is the fix.
- **Real-world example:** The NaN-in-max class is a documented JS behavior (MDN: Math.max returns NaN if any argument is NaN) and a recurring source of NaN thresholds in metrics and analytics code.

### BUG-LOGIC-131 — Optional chaining masks a failed fetch
- **Category:** Logical Error · optional-chaining-masking
- **Description:** A data path reads the response with optional chaining and a default (`return res?.data?.items ?? []`), so a failed or empty API response short-circuits to an empty array. The caller receives a "successful" empty result indistinguishable from a genuine empty dataset, and the failure is invisible in metrics and logs. Detection: a unit test that makes the API fail and asserts the error (or a failure flag) propagates; distinguishing failure from empty (a result envelope with an error field) is the fix.
- **Real-world example:** The optional-chaining-hides-failure class is a recognized API-client bug pattern (result envelopes with explicit error fields — e.g. `{ data, error }` — exist for this reason).

### BUG-LOGIC-132 — Optional chaining masks an empty array index
- **Category:** Logical Error · optional-chaining-masking
- **Description:** An element is read with `arr?.[0]` and the result is used as if it were a valid element. Optional chaining guards against null/undefined arrays but not against an empty array, so the expression yields `undefined` for any empty array and downstream code dereferences it. Detection: a unit test with an empty array asserting the guard fires; `arr?.[0] ?? default` or an explicit length check is the fix.
- **Real-world example:** The empty-array-index class is a recognized bug pattern (optional chaining guards nullish, not empty; the "first element of an empty list" class is a standing review item).

### BUG-LOGIC-133 — Optional chaining masks a missing method in a chain
- **Category:** Logical Error · optional-chaining-masking
- **Description:** A chain makes one call optional (`res?.json().then(...)`) while the rest of the chain assumes it succeeded. When `res` is nullish the optional call short-circuits to undefined, and the subsequent `.then` on undefined throws a TypeError — or, when the method itself is missing, the chain silently produces undefined. Detection: a unit test that makes each link in the chain fail and asserts the error surfaces; making the entire chain optional (`res?.json()?.then(...)`) or guarding the result is the fix.
- **Real-world example:** The partial-optional-chain class is a documented JS gotcha (MDN: optional chaining short-circuits the entire chain only when written consistently; `obj?.a.b()` throws when obj is nullish) and a recurring source of TypeErrors at API boundaries.

### BUG-LOGIC-134 — Partial optional chain on the container
- **Category:** Logical Error · partial-optional-chain
- **Description:** A method on a possibly-nullish object is made optional (`obj.fn?.()`) without making the container optional (`obj?.fn?.()`). When `obj` itself is nullish, the expression throws a TypeError on the property read, so the "optional" call is not optional at all and the null path crashes. Detection: a unit test passing null for the container and asserting no throw; `obj?.fn?.()` makes the whole path optional and is the fix visible in the diff.
- **Real-world example:** The partial-optional-chain class is a documented JS behavior (MDN: `obj.fn?.()` throws when obj is nullish; `obj?.fn?.()` handles both) and a recurring source of crashes in defensive code.

### BUG-LOGIC-135 — Null-dereference from an unchecked API response
- **Category:** Logical Error · null-dereference
- **Description:** A field is read directly off an API response without checking the response or envelope (`res.data.user.id`), and the API returns null/undefined for the missing record. The property read throws a TypeError, so the operation crashes instead of taking the "not found" path. Detection: a unit test mocking the missing-record response and asserting the not-found path; optional chaining with an explicit guard (or a typed envelope) is the fix.
- **Real-world example:** The unchecked-response class is a recognized API-client bug pattern (typed envelopes and result objects exist for this reason; the "checked the envelope" class is a standing review item).

### BUG-LOGIC-136 — Destructuring undefined or null
- **Category:** Logical Error · destructuring
- **Description:** A destructuring assignment is applied to a possibly-nullish value (`const { a, b } = response`), and the response is null or undefined. Destructuring nullish throws `TypeError: Cannot destructure property 'a' of 'undefined'`, so the operation crashes instead of taking a fallback path. Detection: a unit test passing null/undefined and asserting the fallback; default destructuring (`const { a, b } = response ?? {}`) or an explicit guard is the fix.
- **Real-world example:** The destructuring-nullish class is a recognized bug pattern (default destructuring and `?? {}` are the standard fixes; the TypeError is the direct crash signature).

### BUG-LOGIC-137 — Default parameter not applied for null
- **Category:** Logical Error · null-default-gap
- **Description:** A default parameter value is relied on to handle missing input (`function f(options = {})`), but the caller passes `null` explicitly. Default parameters apply only to `undefined`, so null flows through and the function dereferences it (`options.x` throws). Detection: a unit test passing null explicitly and asserting the default applies (or the null is guarded); `options ?? {}` inside the body or a runtime guard is the fix.
- **Real-world example:** The null-default-gap class is a documented JS behavior (MDN: default parameters apply only to undefined, not null) and a recurring source of crashes in defensive APIs.

### BUG-LOGIC-138 — Shallow destructuring default
- **Category:** Logical Error · shallow-default
- **Description:** A default in destructuring is applied at the top level only (`const { a: { b } = {} } = response`), and the nested property path is missing in the data. The nested destructuring throws when `a` is present but `b` is absent, or the default applies when `a` is absent — leaving the nested path unguarded in half the cases. Detection: a unit test seeding each partial shape (a present/b absent, a absent) and asserting the fallback; nested defaults at each level or a runtime guard is the fix.
- **Real-world example:** The shallow-default class is a documented JS gotcha (defaults in destructuring apply per-level, not recursively) and a recurring source of TypeErrors in config and API parsing.

### BUG-LOGIC-139 — Array-object length confusion
- **Category:** Logical Error · array-object-confusion
- **Description:** A `.length` check is applied to a plain object (`if (results.length > 0)`) where `Object.keys(results).length` was intended. Plain objects have no `length`, so the condition is always false and the "has items" branch never executes — empty-state handling runs for every result. Detection: a unit test with a populated plain object asserting the has-items branch runs; `Object.keys(...)` (or `Array.isArray` first) is the fix.
- **Real-world example:** The array-object confusion class is a recognized bug pattern (checking `length` on objects vs arrays; `Array.isArray` guards and `Object.keys` are the standard fixes).

### BUG-LOGIC-140 — Object.keys vs Array.isArray on a non-array
- **Category:** Logical Error · array-object-confusion
- **Description:** A collection check uses `Object.keys(value).length` on a value that can be an array or a plain object, and arrays pass differently than intended (or vice versa). An array passed to an object-handling path returns index strings as keys, so iteration and length behave inconsistently across the two shapes. Detection: a unit test passing both shapes and asserting the handling; `Array.isArray` first (or a discriminated shape in the contract) is the fix.
- **Real-world example:** The shape-conflation class is a recognized bug pattern (APIs returning arrays-or-objects; discriminated unions and `Array.isArray` guards are the standard fixes).

### BUG-LOGIC-141 — Missing element after filter
- **Category:** Logical Error · missing-element
- **Description:** A list is filtered and the first element is accessed without checking the result (`items.filter(x => x.type === "primary")[0]`). When no element matches, the index access yields `undefined` and downstream code dereferences it (a TypeError) or treats undefined as a valid element. Detection: a unit test with no matching element asserting the fallback path; an explicit empty check or `?? default` is the fix.
- **Real-world example:** The filter-then-index class is a recognized bug pattern (the "first match of a filtered list" class; `find` with an explicit undefined check or `?? default` is the standard fix).

### BUG-LOGIC-142 — find() undefined treated as found
- **Category:** Logical Error · find-undefined
- **Description:** An `Array.prototype.find` result is used as if it were always a valid element (`users.find(u => u.id === id).name`). When no user matches, find returns `undefined` and the property read throws a TypeError, or the undefined flows into logic that treats it as a real record. Detection: a unit test with a non-matching id asserting the not-found path; `?? {}` or an explicit undefined check is the fix.
- **Real-world example:** The find-undefined class is a recognized bug pattern (MDN: find returns undefined when no element matches; the "found vs not-found" class is a standing review item).

### BUG-LOGIC-143 — Stringified undefined in a template literal
- **Category:** Logical Error · stringified-undefined
- **Description:** A possibly-undefined value is interpolated into a template literal (`Hello, ${user?.name}`) without a fallback. When the value is undefined the literal renders the text "undefined", so UI text, emails, and logs contain literal "undefined" strings. Detection: a unit test with a missing value asserting the rendered text; `?? ""` or `?? "N/A"` fallbacks (or guarding before render) is the fix.
- **Real-world example:** The stringified-undefined class is a recognized UI bug pattern (literal "undefined" in rendered text; `?? ""` fallbacks and null-guard components are the standard fixes).

### BUG-LOGIC-144 — Stringified null in SQL or CSV concatenation
- **Category:** Logical Error · stringified-nullish
- **Description:** A possibly-null value is concatenated into a SQL string or CSV row (`"INSERT ... VALUES (" + value + ")"`). Null becomes the literal text "null" (JS), corrupting the query or producing a "null" string in a CSV cell that consumers parse as text. Detection: a unit test with a null value asserting the produced SQL/CSV; parameterized queries and explicit null handling in serializers are the fix.
- **Real-world example:** The stringified-null class is a recognized serialization bug pattern (CSV exports producing literal "null" strings; parameterized queries and typed serializers are the standard fixes).

### BUG-LOGIC-145 — JSON.stringify drops undefined fields
- **Category:** Logical Error · json-dropping
- **Description:** A payload is serialized with `JSON.stringify` and fields whose value is `undefined` are silently dropped from the output. The receiving schema expects the field (nullable or optional), so validation fails or the field's absence is misinterpreted as a different semantic (absent vs explicitly unset). Detection: snapshot the serialized output in a unit test and assert the field's presence; replacing undefined with null before serialization (or a typed serializer) is the fix.
- **Real-world example:** The undefined-dropping class is a documented JS behavior (MDN: JSON.stringify omits undefined properties and array slots) and a recurring source of schema-validation failures in API payloads.

### BUG-LOGIC-146 — JSON.parse('null') treated as an object
- **Category:** Logical Error · json-dropping
- **Description:** A parsed JSON payload is used as if it were always an object (`JSON.parse(raw).field`), and the raw text is the literal "null" (a cached null value, an empty Redis entry). JSON.parse("null") returns null, and the property read throws a TypeError or the null flows into logic expecting an object. Detection: a unit test with a "null" raw payload asserting the guard; `?? {}` after parse or an explicit null check is the fix.
- **Real-world example:** The parse-null class is a recognized cache-loader bug pattern (Redis/JSON caches storing literal "null"; `?? {}` guards and typed deserializers are the standard fixes).

### BUG-LOGIC-147 — Spread of null silently producing no merge
- **Category:** Logical Error · spread-null
- **Description:** A possibly-nullish value is spread into an object literal (`{ ...defaults, ...userConfig }`), and userConfig is null or undefined. Spread of nullish silently produces nothing (no error, no merge), so the caller believes the config was merged when only the defaults applied — a silently ignored override. Detection: a unit test passing null for the override and asserting the merge outcome; an explicit guard or a merge function that rejects nullish is the fix.
- **Real-world example:** The silent-spread class is a documented JS behavior (MDN: spreading null/undefined produces no effect) and a recurring source of silently-ignored-override bugs in config merging.

### BUG-LOGIC-148 — Null elements in a mapped collection
- **Category:** Logical Error · null-in-collection
- **Description:** A list is mapped with a callback that returns nullish for some elements (`items.map(i => lookup(i)?.id)`), so the mapped array contains null slots. Downstream code iterates or aggregates assuming every element is valid, and null slots produce TypeErrors or corrupt aggregates. Detection: a unit test seeding non-matching lookups and asserting the mapped array's contents; `flatMap` with empty arrays, or filtering nullish after map, is the fix.
- **Real-world example:** The null-in-mapped-array class is a recognized bug pattern (map with optional lookups producing null slots; `flatMap` and nullish filtering are the standard fixes).

### BUG-LOGIC-149 — undefined in sort coercion
- **Category:** Logical Error · sort-with-undefined
- **Description:** A sort comparator operates on a list containing undefined elements, and the comparison coerces undefined to NaN — making comparisons unpredictable (undefined can sort before or after depending on the comparator). Sorted output is non-deterministic and binary-search lookups over the same ordering miss entries. Detection: a unit test seeding undefined elements and asserting the sorted order; filtering nullish before sorting (or a comparator that handles undefined explicitly) is the fix.
- **Real-world example:** The undefined-in-sort class is a documented JS behavior (ECMAScript: the comparator must return a consistent sign; undefined coerced to NaN breaks the contract) and a recurring non-determinism bug in sorted pipelines.

### BUG-LOGIC-150 — Dynamic key access without validation
- **Category:** Logical Error · dynamic-key-access
- **Description:** A property is read from a map using user input (`config[section][userInput]`) without validating the key exists. A missing key returns `undefined`, which flows into logic that dereferences it or treats it as a valid value — and the "section not found" path never runs. Detection: a unit test with an unknown key asserting the fallback; `?? default`, `Object.hasOwn` checks, or a schema-validated lookup is the fix.
- **Real-world example:** The dynamic-key class is a recognized bug pattern (dictionary lookups with user input; `Object.hasOwn` and schema-validated lookups are the standard fixes).

### BUG-LOGIC-151 — Nullish coalescing passes NaN through
- **Category:** Logical Error · nullish-vs-nan
- **Description:** A default is applied with `??` (`const timeout = config.timeout ?? 5000`), and config.timeout is NaN (from a failed parse). `??` only replaces null/undefined, so NaN passes through and the timeout is NaN — `setTimeout(fn, NaN)` fires immediately (coerced to 0), defeating the intended default. Detection: a unit test feeding a NaN-parsed config and asserting the default applies; `Number.isNaN` checks (or validating at parse time) is the fix.
- **Real-world example:** The nullish-vs-NaN class is a documented JS behavior (`??` replaces only null/undefined, not NaN) and a recurring source of config-resolution bugs where failed parses slip through defaults.

### BUG-LOGIC-152 — Short-circuit assignment skipping
- **Category:** Logical Error · short-circuit-assignment
- **Description:** An update is gated with a short-circuit (`user && (user.name = value)`), and the container is null. The short-circuit silently skips the assignment without an error or a log, so the "set name" operation reports success while nothing changed. Detection: a unit test passing null and asserting the outcome is surfaced (error, log, or return value); an explicit guard that reports the skipped case is the fix.
- **Real-world example:** The short-circuit-skip class is a recognized bug pattern (gating mutations with `&&`; explicit guards that surface skipped operations are the standard fixes).

### BUG-LOGIC-153 — Null vs absent field conflation
- **Category:** Logical Error · null-vs-absent
- **Description:** A TypeScript optional field (`user.nickname?: string`) conflates "field present with null value" with "field absent", and the backend distinguishes them. A patch endpoint sending `nickname: null` (clearing the field) is treated the same as omitting it, so clears never take effect — or the reverse, an omission clears data. Detection: snapshot both request shapes (field-null vs field-omitted) in an integration test and assert the outcomes; `exactOptionalPropertyTypes` in TS and explicit null-handling in the API contract are the fixes.
- **Real-world example:** The null-vs-absent class is a documented schema-design issue (TypeScript's `exactOptionalPropertyTypes` flag exists for it; OpenAPI/JSON merge-patch semantics distinguish null from absent).

### BUG-LOGIC-154 — Prototype-less object method missing
- **Category:** Logical Error · prototype-less-object
- **Description:** A dictionary built with `Object.create(null)` (to avoid prototype pollution) is passed to code that calls inherited methods on it (`dict.hasOwnProperty(key)`, `dict.toString()`). Prototype-less objects have no inherited methods, so the call throws a TypeError and the code that works for normal objects crashes for the dictionary. Detection: a unit test passing a prototype-less object and asserting no throw; `Object.prototype.hasOwnProperty.call` (or `Object.hasOwn`) is the fix.
- **Real-world example:** The prototype-less class is a recognized bug pattern (Object.create(null) dictionaries breaking inherited-method calls; `Object.hasOwn` and static calls are the standard fixes).

### BUG-LOGIC-155 — DB write stores undefined as NULL
- **Category:** Logical Error · db-null-write
- **Description:** An ORM write passes fields whose value is `undefined`, and the ORM (or a custom serializer) stores them as SQL NULL instead of skipping the column (or vice versa). An "update only provided fields" operation overwrites unprovided fields with NULL, wiping data the caller did not intend to change. Detection: an integration test with a partial update asserting unprovided fields are unchanged; `omitUndefined` (or the ORM's patch semantics) is the fix visible in the diff.
- **Real-world example:** The undefined-as-NULL class is a recognized ORM bug pattern (Mongoose's `omitUndefined`, Prisma's undefined-vs-null semantics; the "partial update wiped my fields" class is a standing bug report).

### BUG-LOGIC-156 — SQL COALESCE empty-string semantics
- **Category:** Logical Error · sql-null-semantics
- **Description:** A query uses `COALESCE(field, 'default')` expecting it to also catch empty strings, but SQL's COALESCE only replaces NULL — an empty string is a value. Records with empty-string fields keep '' instead of the default, so reports and joins treat them as populated and the intended default never applies. Detection: a unit test seeding empty-string records and asserting the default applies; `NULLIF(field, '')` wrapped in COALESCE is the fix.
- **Real-world example:** The COALESCE-empty-string class is a recognized SQL bug pattern (NULLIF wrapping is the standard fix; the "empty string is not NULL" distinction is documented in every SQL guide).

### BUG-LOGIC-157 — Percentage/discount applied twice
- **Category:** Logical Error · double-discount
- **Description:** A discount function multiplies the already-discounted subtotal again (`applyDiscount(applyDiscount(total, 10), 10)`) because the caller and the pricing pipeline each apply the same promotion. The final price is lower than policy allows (10% twice = 19% off), so every affected order under-charges. Detection: an integration test asserting the final price against a policy-correct worked example; idempotent pricing (apply-once markers) is the fix.
- **Real-world example:** The discount-stacking class is a recognized e-commerce bug pattern (coupon plus promotion stacking; documented in checkout postmortems and payment-engineering guides).

### BUG-LOGIC-158 — Duplicate-submission creating duplicate records
- **Category:** Logical Error · duplicate-submission
- **Description:** A backend write endpoint creates a record on every request without an idempotency key or dedupe constraint, and a client retry (network timeout, proxy replay) resends the same logical write. Two records exist for one user action — duplicate orders, duplicate support tickets, duplicate ledger entries. Detection: an integration test replaying the same request twice and asserting one record; idempotency keys or unique constraints are the fix.
- **Real-world example:** The duplicate-write class is a recognized payments failure mode (Stripe's idempotency keys exist because client retries can duplicate writes; documented in payment-engineering guides).

### BUG-LOGIC-159 — Status-transition allowing illegal transitions
- **Category:** Logical Error · illegal-transition
- **Description:** A status-update endpoint sets any status from any other status (`order.status = req.body.status`) without a transition table or guard. An order can move from "refunded" back to "shipped" or from "cancelled" to "delivered", and side effects (refunds, notifications) fire for transitions the workflow never intended. Detection: a table-driven test enumerating every from/to pair and asserting acceptance matches the documented state machine; a transition table (allowed map) is the fix.
- **Real-world example:** The illegal-transition class is a recognized workflow bug class (state-machine guides document allowed-transition maps; the "refunded order re-shipped" class appears in order-management postmortems).

### BUG-LOGIC-160 — Dedupe keys that don't match across writers
- **Category:** Logical Error · dedupe-key-mismatch
- **Description:** Two write paths compute a dedupe key with different normalization (one lowercases the email, one doesn't; one trims, one doesn't). The same logical record hashes to two different keys, so the dedupe layer never matches and duplicates are created despite the check. Detection: an integration test writing the same logical record through both paths and asserting one record exists; a shared normalization function used by every writer is the fix.
- **Real-world example:** The dedupe-key-mismatch class is a recognized data-pipeline failure mode (identity-resolution guides document shared normalization as the required pattern; email-case mismatch is the canonical example).

### BUG-LOGIC-161 — Sort comparator unstable or reversed
- **Category:** Logical Error · sort-comparator
- **Description:** A sort comparator returns the wrong sign (`(a, b) => a < b`) or is inconsistent for equal elements. The sort either reverses the intended order or — when the comparator violates its contract — the runtime's sort produces implementation-defined order that can differ between engines or inputs of different sizes. Detection: a unit test asserting the sorted order for a multi-element input including ties; Java's TimSort throws "Comparison method violates its general contract" for contract-violating comparators (JDK-7075600).
- **Real-world example:** The comparator-contract class is a recognized bug pattern (Java's TimSort IllegalArgumentException JDK-7075600 is the canonical incident; comparator tests with ties are the standard detection method).

### BUG-LOGIC-162 — Pagination cursor that skips or repeats items
- **Category:** Logical Error · pagination-cursor
- **Description:** A cursor is built from a non-unique column (`WHERE created_at > last_seen`), so rows sharing the same timestamp as the cursor value are skipped — or, with `>=`, served twice. Consumers silently lose or duplicate rows at every timestamp boundary. Detection: an integration test seeding rows with identical timestamps and asserting each is served exactly once; tiebreaker columns (`ORDER BY created_at, id`) are the fix.
- **Real-world example:** The cursor-boundary class is a recognized keyset-pagination bug (keyset pagination guides document tiebreaker columns as the required pattern precisely because non-unique cursors skip or repeat rows).

### BUG-LOGIC-163 — Authorization trusting client-provided fields
- **Category:** Logical Error · client-trust
- **Description:** An access check trusts an identity or ownership field from the request body (`if (req.body.userId === resource.ownerId)`) instead of the authenticated session's identity. Any caller can pass the owner's userId and pass the check, so the authorization gate is bypassable by input alone. Detection: a test issuing a request with a forged userId and asserting rejection; reading identity from the verified session/token (never the body) is the fix.
- **Real-world example:** The client-trust class is IDOR-adjacent and a standing bug class in OWASP API guidance (API4/API5 Broken Object Level/Function Level Authorization; identity must come from the verified session, never client input).

### BUG-LOGIC-164 — Cart total computed before quantity update
- **Category:** Logical Error · computation-order
- **Description:** An order pipeline computes the cart total from the cart's line items before (or in parallel with) the quantity update, so the total reflects stale quantities. Every affected order charges the pre-update amount — under-charging when quantities were increased, over-charging when decreased. Detection: an integration test updating a quantity and asserting the charged total matches the updated cart; sequencing the total computation after the mutation is the fix.
- **Real-world example:** The computation-order class is a recognized checkout bug pattern (pricing pipelines must recompute after every mutation; the "stale total" class appears in cart postmortems).

### BUG-LOGIC-165 — Refund exceeding original payment
- **Category:** Logical Error · refund-overdraft
- **Description:** A refund path processes each refund request against the original payment amount without summing prior partial refunds (`refund(min(amount, payment.total))` instead of `payment.total - refundedSoFar`). Repeated partial refunds exceed the original charge, so the merchant refunds more than was paid and the payment processor rejects or the ledger goes negative. Detection: an integration test issuing repeated partial refunds and asserting the cumulative refund never exceeds the original; tracking `refundedSoFar` in the refund calculation is the fix.
- **Real-world example:** The refund-overdraft class is a recognized payments bug pattern (Stripe's refunds API reports `amount_refunded` precisely because partial-refund accumulation must be checked by the caller).

### BUG-LOGIC-166 — Inventory decrement allowing negative stock
- **Category:** Logical Error · negative-stock
- **Description:** An inventory decrement applies a deduction without a floor check under concurrency (`UPDATE stock SET qty = qty - ?` without `WHERE qty >= ?`), so two concurrent orders both decrement and stock goes negative. Overselling follows — orders are accepted for items that no longer exist. Detection: a concurrent integration test overselling a unit of stock and asserting the decrement is rejected at zero; a conditional update (`WHERE qty >= ?`) or a reservation system is the fix.
- **Real-world example:** The oversell class is a recognized inventory bug (conditional updates and reservations are the standard fix; documented in inventory-system guides and flash-sale postmortems).

### BUG-LOGIC-167 — Subscription renewal from the wrong anchor date
- **Category:** Logical Error · billing-cycle
- **Description:** A renewal date is computed from the last payment date (`lastPayment + 30 days`) instead of the period start (or vice versa). After a mid-cycle upgrade or a retried payment, the anchor shifts and the billing cycle drifts — users are billed on different dates each period, and proration mismatches the period. Detection: an integration test with a mid-cycle upgrade asserting the next renewal date matches the documented anchor; computing renewal from the period start (or a documented anchor) is the fix.
- **Real-world example:** The billing-cycle anchor class is a recognized subscription bug pattern (Stripe Billing's `current_period_end` exists as the anchor precisely because last-payment-date math drifts after mid-cycle changes and retries).

### BUG-LOGIC-168 — Tier/pricing lookup boundary operator
- **Category:** Logical Error · boundary-condition
- **Description:** A tier lookup uses `>` where `>=` was documented (or vice versa) against a threshold column (`if (usage > 1000) tier = "pro"`). A user at exactly 1000 gets the wrong tier, so pricing, quotas, and feature gates are wrong for every boundary case. Detection: a unit test asserting the tier for usage exactly at the threshold; the documented operator (`>=` vs `>`) matched to the pricing spec is the fix.
- **Real-world example:** The boundary-operator class is a recognized bug class in tiered pricing (pricing-table specs document the boundary semantics; boundary tests are the standard detection method).

### BUG-LOGIC-169 — Feature flag cached globally
- **Category:** Logical Error · flag-cache-scope
- **Description:** A per-user feature flag is evaluated and cached in a global (module-level or shared) cache keyed without the user id. The first user's flag value applies to every subsequent user in the same process, so the feature rolls out to all-or-none instead of per-user. Detection: a test issuing requests from two users with different flags and asserting each gets its own value; keying the cache with the user id (or a request-scoped evaluation) is the fix.
- **Real-world example:** The flag-cache-scope class is a recognized launch-tooling failure mode (feature-flag guides document per-user cache keys; the "flag applied to everyone" class appears in rollout postmortems).

### BUG-LOGIC-170 — Free-tier limit checked after usage increment
- **Category:** Logical Error · metering-order
- **Description:** A usage meter increments the counter first and then checks it against the free-tier limit, so the request that crosses the limit is fully served before being blocked. Every request consumes quota before the gate evaluates, and off-by-one overages accumulate at every boundary. Detection: an integration test at the limit boundary asserting the crossing request is rejected (or partially served per contract); check-then-increment ordering is the fix.
- **Real-world example:** The metering-order class is a recognized billing bug class (usage-based billing guides document check-before-increment ordering; the "one extra request served" class appears in quota postmortems).

### BUG-LOGIC-171 — A/B assignment with different salts per service
- **Category:** Logical Error · ab-assignment
- **Description:** An A/B test assigns users by hashing the user id with a salt (`hash(userId + salt) % 2`), and each service uses a different salt (or different hash function). The same user lands in different variants in different services, so experiment results are inconsistent and cross-service funnels mix variants. Detection: an integration test asserting the same user's variant across services; a shared assignment service (or shared salt/hash constants) is the fix.
- **Real-world example:** The assignment-inconsistency class is a recognized experimentation failure mode (A/B testing guides document a shared assignment service; inconsistent hashing is the canonical variant-mixing bug).

### BUG-LOGIC-172 — Exchange rate applied twice
- **Category:** Logical Error · double-conversion
- **Description:** A currency conversion multiplies the already-converted amount again because the display layer and the pricing pipeline each apply the exchange rate. The displayed price is double-converted (dollars multiplied twice), so international customers see systematically wrong amounts. Detection: an integration test asserting the displayed amount against a policy-correct worked example; applying the conversion once (a marker or a single conversion point) is the fix.
- **Real-world example:** The double-conversion class is a recognized internationalization bug pattern (currency pipelines must apply conversion at a single point; the "double-converted price" class appears in i18n postmortems).

### BUG-LOGIC-173 — Webhook processing not idempotent
- **Category:** Logical Error · webhook-idempotency
- **Description:** A payment webhook handler applies side effects (charges, credits, state changes) on every delivery without checking an event id or a processed marker. Payment processors deliver webhooks more than once (retries on timeout), so the same event is applied twice — duplicate charges or double credits. Detection: an integration test replaying the same webhook event and asserting the state and side effects are unchanged on the second delivery; an event-id dedupe table is the fix.
- **Real-world example:** The non-idempotent-webhook class is a recognized payments failure mode (Stripe's webhook docs explicitly warn that events may be delivered more than once and handlers must be idempotent).

### BUG-LOGIC-174 — Grace-period boundary operator
- **Category:** Logical Error · boundary-condition
- **Description:** A subscription-liveness check uses `now > expiry` (or `>=`) against the documented grace-period semantics, so expired-but-graceful users are blocked — or genuinely expired users retain access. The boundary case (access exactly at expiry) lands on the wrong side. Detection: a unit test with a fixed clock set exactly at expiry and at expiry-plus-grace asserting the expected state; the documented operator matched to the grace spec is the fix.
- **Real-world example:** The grace-period class is a recognized billing bug class (subscription guides document grace-period semantics; the "expired users blocked" class appears in billing postmortems).

### BUG-LOGIC-175 — Sort by date stored as string
- **Category:** Logical Error · sort-type
- **Description:** Records are sorted by a date stored in a non-ISO string format ("1/2/2024", "12-Jan-2024"), so lexicographic ordering differs from chronological ordering (all January entries sort before all February regardless of year, or "1/10" sorts before "1/2"). Timelines, reports, and "latest event" lookups return the wrong record. Detection: a unit test seeding dates across month/year boundaries and asserting chronological order; ISO-8601 storage (`YYYY-MM-DD`) or a parsed-date sort is the fix.
- **Real-world example:** The string-date-sort class is a recognized bug class (ISO-8601 exists precisely because locale-formatted date strings sort incorrectly; the "wrong latest record" class appears in timeline code).

### BUG-LOGIC-176 — Negative page size returning all rows
- **Category:** Logical Error · input-validation-logic
- **Description:** A pagination endpoint applies `LIMIT req.query.limit` without validating it is positive, so a negative or zero limit returns all rows (or a driver error). A client requesting `limit=-1` silently bypasses the pagination cap, and unbounded responses exhaust memory on large tables. Detection: an integration test with a negative limit asserting rejection (or a documented sentinel like 0 = unlimited); clamping to a positive maximum is the fix.
- **Real-world example:** The negative-limit class is a recognized API bug class (pagination guides document clamping limit to a positive maximum; the "limit=-1 returns everything" class is a standing bug report in paginated APIs).

### BUG-LOGIC-177 — Role check on stale session role
- **Category:** Logical Error · stale-authorization
- **Description:** An authorization check reads the role from a long-lived session/token issued at login, and a role revocation (admin demoted, employee offboarded) never propagates to the session. The revoked user retains elevated access until the token expires, so revocation is not effective. Detection: an integration test revoking a role and asserting the next request is denied; short-lived tokens, revocation lists, or per-request role reads are the fix.
- **Real-world example:** The stale-authorization class is a recognized auth failure mode (session-management guides document short-lived tokens and revocation lists; the "revoked admin retained access" class appears in offboarding postmortems).

### BUG-LOGIC-178 — OAuth callback race duplicating accounts
- **Category:** Logical Error · oauth-dedupe
- **Description:** An OAuth callback creates an account keyed by email without an upsert or unique constraint, and a double-fired callback (retry, duplicate redirect) creates two accounts for one identity. Sessions, profiles, and subscriptions then split across two account rows. Detection: an integration test replaying the OAuth callback twice and asserting one account; an upsert (`ON CONFLICT`) or a unique email constraint is the fix.
- **Real-world example:** The OAuth-dedupe class is a recognized SSO failure mode (identity providers can deliver callbacks more than once; upserts and unique constraints are the standard fix pattern).

### BUG-LOGIC-179 — Event ordering ties by timestamp
- **Category:** Logical Error · event-ordering
- **Description:** An order status (or a state machine) is derived from the latest event by timestamp (`ORDER BY occurred_at DESC LIMIT 1`), and two events share the same second. The tie is broken arbitrarily (or by insert order), so the wrong event is treated as latest and the derived state contradicts the event log. Detection: an integration test seeding same-second events in a documented order and asserting the derived state; tiebreaker columns (`occurred_at, id` or a sequence number) are the fix.
- **Real-world example:** The timestamp-tie class is a recognized event-sourcing bug (event-sourcing guides document sequence/tiebreaker columns as the required ordering key precisely because same-second events order arbitrarily).

### BUG-LOGIC-180 — Promotion threshold before discounts
- **Category:** Logical Error · computation-order
- **Description:** A free-shipping (or gift) threshold check uses the cart subtotal before discounts are applied, while the documented policy says post-discount. Carts that qualify pre-discount but not post-discount receive the promotion, so every affected order under-charges or over-awards. Detection: an integration test with a discounted cart at the threshold asserting the promotion outcome; checking the threshold after discounts is the fix.
- **Real-world example:** The threshold-before-discount class is a recognized checkout bug pattern (promotion guides document post-discount thresholds; the "free shipping on discounted carts" class appears in checkout postmortems).

### BUG-LOGIC-181 — Quota reset at UTC vs local midnight
- **Category:** Logical Error · quota-reset-timezone
- **Description:** A daily quota reset is computed as "midnight" without a timezone (or in UTC) while users span timezones up to +14. Users in far-east timezones get their quota reset at the wrong local time (or their previous day's usage counts against the new day), so limits are wrong for part of every day. Detection: an integration test with a fixed clock in a far-east timezone asserting the reset time; timezone-aware reset computation (or a documented UTC contract) is the fix.
- **Real-world example:** The quota-reset-timezone class is a recognized billing bug class (usage-based billing guides document timezone-aware reset computation; the "wrong reset time" class appears in quota postmortems).

### BUG-LOGIC-182 — Self-referral credit applied to both parties
- **Category:** Logical Error · self-referral
- **Description:** A referral path grants credit to the referrer and referee without checking that they are the same account (same user id, same email after normalization). A user self-refers (two accounts, one identity) and collects credit on both sides, so the referral program is drained by self-referrals. Detection: an integration test with a self-referral (same normalized identity) asserting rejection; a same-identity check (normalized email or account id) is the fix.
- **Real-world example:** The self-referral class is a recognized referral-program bug (referral guides document same-identity checks; the "self-referral drain" class appears in growth postmortems).

### BUG-LOGIC-183 — Case-sensitive matching where case-insensitive intended
- **Category:** Logical Error · case-sensitivity
- **Description:** An email lookup (or any user-facing identifier) is matched with a case-sensitive operator (`WHERE email = $1` in a case-sensitive collation, or `===` in JS). "User@Example.com" fails to match the stored "user@example.com", so lookups miss existing records and the code takes the "not found" path — creating duplicates or denying access. Detection: a unit test seeding a mixed-case identifier and asserting the match; case-insensitive collations (`citext`, `LOWER(email) = LOWER($1)`) or normalized storage is the fix.
- **Real-world example:** The case-sensitive-lookup class is a recognized bug pattern (identity guides document normalized or citext storage; the "email not found but exists" class is a standing bug report).

### BUG-LOGIC-184 — Whole-word vs substring matching
- **Category:** Logical Error · substring-match
- **Description:** A word-boundary check is implemented as a substring test (`title.includes("test")` or a regex without word boundaries), so legitimate titles containing the substring ("latest", "contest", "attest") match the filter. A blocklist or moderation filter flags content that merely contains the word as a substring, and search filters return wrong results. Detection: a unit test seeding titles containing the substring inside longer words and asserting they are excluded; `\b` word boundaries or tokenizer-based matching is the fix.
- **Real-world example:** The substring-vs-word class is a recognized moderation and search bug pattern (blocklist guides document word-boundary matching; the "latest flagged for test" class is a standing false-positive source).

### BUG-LOGIC-185 — UTF-8 read as cp1252
- **Category:** Logical Error · encoding-corruption
- **Description:** A UTF-8 file (or stream) is decoded with a legacy single-byte encoding (cp1252/latin-1), so multibyte sequences decode as multiple garbage characters ("é" becomes "Ã©" — mojibake). The corruption is stored and re-encoded, so it propagates through exports, logs, and downstream systems and is unrecoverable after re-encoding. Detection: compare the decoded text against the source bytes in a test (assert `Buffer.from(text).equals(original)`); explicit encoding parameters (`fs.readFile(path, 'utf8')`, `Charset.forName("UTF-8")`) are the fix.
- **Real-world example:** The mojibake class is a recognized encoding bug (UTF-8 read as cp1252 is the canonical example; explicit encodings are the standard fix, documented in every i18n guide).

### BUG-LOGIC-186 — Regex special chars unescaped in user input
- **Category:** Logical Error · regex-unescaped
- **Description:** User input is interpolated into a `RegExp` constructor (`new RegExp(userInput)`) without escaping metacharacters. A "." matches every character, "(" unbalances the regex and throws, and crafted input ("(.+)+") triggers catastrophic backtracking (ReDoS). Search and filter features built on user-controlled regexes match everything or hang. Detection: a unit test feeding metacharacter input and asserting the matched set; `RegExp.escape`-style escaping (or escaping each metachar manually) is the fix.
- **Real-world example:** The unescaped-regex class is a recognized injection bug (CWE-185/CWE-624; ReDoS from crafted input is a documented DoS class; escaping user input in RegExp constructors is the standard fix).

### BUG-LOGIC-187 — Locale-sensitive toLowerCase (Turkish i)
- **Category:** Logical Error · locale-lowercase
- **Description:** Case normalization uses the default `toLowerCase`/`toUpperCase` in a Turkish-locale environment, where "I" lowercases to dotless "ı" and "i" uppercases to dotted "İ". Identifiers containing "i"/"I" (emails, URLs, API keys) fail to match after normalization, so auth and lookup logic breaks only on Turkish-locale hosts. Detection: a unit test forcing the Turkish locale (`Intl`/`Locale` override) and asserting the match; explicit locale-insensitive normalization (`toLowerCase("en")`, or ASCII-only folding) is the fix.
- **Real-world example:** The Turkish-I class is a recognized i18n bug (documented as the "Turkish I problem"; Java's `String.toLowerCase` in Turkish locale breaking URLs and identifiers is the canonical example — ASCII-only folding is the standard fix).

### BUG-LOGIC-188 — Slice cutting multibyte characters
- **Category:** Logical Error · multibyte-slice
- **Description:** A string range slice (`str.substr(0, n)` or `slice(0, n)`) cuts at a UTF-16 code-unit boundary that falls inside a surrogate pair (emoji, CJK extension characters). The truncated string ends with an unpaired surrogate, which renders as a replacement character and corrupts downstream comparisons and storage. Detection: a unit test seeding emoji at the slice boundary and asserting the output is valid (no unpaired surrogates); `Array.from(str).slice(0, n).join("")` (code-point-based) or `Intl.Segmenter` (grapheme-based) is the fix.
- **Real-world example:** The surrogate-split class is a documented JS gotcha (UTF-16 code units vs code points; `Array.from` and `Intl.Segmenter` exist for this reason) and a recurring corruption bug in truncation and preview code.

### BUG-LOGIC-189 — Locale sort for accented characters
- **Category:** Logical Error · locale-sort
- **Description:** A user-facing list is sorted with the default string comparison, which orders by UTF-16 code units: accented characters (Ö, é, ñ) sort after all ASCII letters ("Ö" after "Z"). Names and titles in non-English locales appear in an order no user expects, and lookups over the same ordering miss entries. Detection: a unit test seeding accented entries and asserting the locale-expected order; `localeCompare` (or Intl.Collator with sensitivity) is the fix.
- **Real-world example:** The locale-sort class is a recognized i18n bug pattern (Intl.Collator exists for locale-aware ordering; the "Ö after Z" class is a standing bug in international lists).

### BUG-LOGIC-190 — Path join missing separator
- **Category:** Logical Error · path-join
- **Description:** A path is built by string concatenation (`"/var/log" + fileName`) instead of a path-join function, and the base lacks a trailing separator. The result is "/var/logapp.log", so the file is written (or read) at the wrong path and the operation silently targets a nonexistent location. Detection: a unit test asserting the joined path; `path.join` (Node), `filepath.Join` (Go), or `os.path.join` (Python) is the fix.
- **Real-world example:** The manual-path-join class is a recognized bug pattern (path-join functions exist for this reason; the "missing separator" class is a standing bug in file-path code).

### BUG-LOGIC-191 — Version numbers compared as strings
- **Category:** Logical Error · version-compare
- **Description:** Version strings are compared with relational operators or string equality ("10.0" < "9.0" lexicographically, "1.0.0" !== "1.0" semantically). Compatibility checks, update prompts, and feature gates compare versions incorrectly, so upgrades are prompted for older versions or skipped for newer ones. Detection: a unit test comparing multi-digit versions and asserting the expected ordering; a semver comparison function (or semver library) is the fix.
- **Real-world example:** The version-compare class is a recognized bug pattern (SemVer's comparison rules exist precisely because string comparison fails for multi-digit components; semver libraries are the standard fix).

### BUG-LOGIC-192 — split on empty separator
- **Category:** Logical Error · split-misuse
- **Description:** A string is split with an empty separator (`str.split("")`), which splits into individual UTF-16 code units instead of words or fields. Character-level splitting on multibyte input also breaks surrogate pairs, and word-level processing receives single characters. Detection: a unit test asserting the split output for word-level input; splitting on the intended delimiter (",", " ") or `Intl.Segmenter` for grapheme-level splitting is the fix.
- **Real-world example:** The empty-separator class is a documented JS behavior (MDN: `split("")` splits into code units) and a recurring bug in tokenization and field-parsing code.

### BUG-LOGIC-193 — includes on empty string always true
- **Category:** Logical Error · includes-empty
- **Description:** A containment check uses `haystack.includes(needle)` where the needle can be an empty string (an unset filter, an empty search term). `"".includes("")` and `"anything".includes("")` are both true, so an empty filter matches everything and the "no filter" branch never runs. Detection: a unit test with an empty needle asserting the no-filter branch; a length guard (`needle.length > 0 && ...`) is the fix.
- **Real-world example:** The empty-needle class is a documented JS behavior (ECMAScript: includes with an empty string returns true) and a recurring bug in search and filter UIs where empty terms match everything.

### BUG-LOGIC-194 — JSON string equality comparison
- **Category:** Logical Error · json-compare
- **Description:** Two JSON documents are compared with string equality (`serializedA === serializedB`) to detect changes. Key order and whitespace differences make the strings differ even when the documents are semantically identical, so "unchanged, skip write" branches never fire — every check re-runs the write, or a cache never hits. Detection: compare with a structural deep-equal (`JSON.parse` + deep equality, or a fast-deep-equal library) in tests; structural comparison is the fix.
- **Real-world example:** The JSON-string-equality class is a recognized bug pattern (structural deep-equality libraries exist for this reason; the "semantically equal, string different" class is a standing cache/check bug).

### BUG-LOGIC-195 — Base64 with URL-unsafe characters
- **Category:** Logical Error · base64-url
- **Description:** A token or identifier is encoded with standard base64, whose alphabet includes "+", "/", and "=". Placed in a URL query or path, "+" is decoded as a space and "/" breaks path parsing, so the token is corrupted in transit and validation fails. Detection: a unit test round-tripping the token through a URL (query param) and asserting the decoded value; base64url encoding (`-`/`_` alphabet, no padding) is the fix.
- **Real-world example:** The base64-URL class is a recognized bug pattern (JWTs use base64url per RFC 7519 precisely because standard base64 breaks in URLs; base64url is the standard fix).

### BUG-LOGIC-196 — Regex greedy matching capturing too much
- **Category:** Logical Error · regex-greedy
- **Description:** An extraction pattern uses a greedy quantifier (`<div>(.*)</div>` or `"(.*)"`), which matches as much as possible across the intended delimiters. On input containing multiple delimiter pairs, the capture spans from the first opening delimiter to the last closing one — extracting the entire middle instead of one field. Detection: a unit test seeding multiple delimiter pairs and asserting the captured span; lazy quantifiers (`.*?`) or negated classes (`[^"]*`) are the fix.
- **Real-world example:** The greedy-capture class is a recognized regex bug pattern (lazy quantifiers and negated classes are the standard fix; the "captured everything between the outer delimiters" class is a standing extraction bug).

### BUG-LOGIC-197 — Unicode normalization missing
- **Category:** Logical Error · unicode-normalization
- **Description:** Two strings representing the same text are compared without Unicode normalization: "é" as a single code point (NFC) vs "e" + combining acute accent (NFD) are different byte sequences but identical to a reader. Equality checks, dedupe keys, and lookups miss the match — macOS NFD filenames vs NFC web uploads is the canonical case. Detection: a unit test seeding both NFC and NFD forms and asserting the match; `str.normalize("NFC")` (or NFD) on both sides is the fix.
- **Real-world example:** The NFC/NFD class is a recognized i18n bug (macOS HFS+ stores filenames in NFD while most web systems use NFC; Unicode normalization is the standard fix).

### BUG-LOGIC-198 — Null rendered as text in CSV export
- **Category:** Logical Error · csv-null
- **Description:** A CSV export serializes null values via string concatenation or a default `toString()`, producing the literal text "null" in a cell. Consumers parsing the CSV treat "null" as a string value instead of an empty field, so imports and analytics see fabricated values. Detection: a unit test with a null field asserting the cell is empty (or a documented sentinel); explicit null handling in the serializer (empty cell or quoted sentinel) is the fix.
- **Real-world example:** The CSV-null class is a recognized data-export bug pattern (CSV guides document explicit null handling; the "null" string in cells is a standing import bug).

### BUG-LOGIC-199 — String replace only replacing first occurrence
- **Category:** Logical Error · replace-first
- **Description:** A replacement uses `str.replace(oldStr, newStr)` with a string argument, which replaces only the first occurrence. Subsequent occurrences survive, so sanitization (stripping a token, normalizing a separator) is incomplete — a sanitizer that strips "password=" once leaves the rest intact. Detection: a unit test seeding multiple occurrences and asserting all are replaced; `replaceAll` (ES2021) or a global regex (`/.../g`) is the fix.
- **Real-world example:** The replace-first class is a documented JS behavior (MDN: string arguments replace only the first match) and a recurring incomplete-sanitization bug class.

### BUG-LOGIC-200 — Split/join round-trip lossy
- **Category:** Logical Error · round-trip-loss
- **Description:** A list is serialized with `join(",")` and deserialized with `split(",")`, and the data contains the delimiter (a comma inside a note or title). The round-trip splits one field into two, so deserialized lists have more elements than the original and positional bookkeeping desynchronizes. Detection: a round-trip unit test seeding delimiter-containing data and asserting the list survives; a proper serializer (JSON, TSV with escaping) is the fix.
- **Real-world example:** The lossy-round-trip class is a recognized serialization bug pattern (CSV/TSV escaping rules exist for this reason; the "comma inside a field" class is a standing serialization bug).

### BUG-LOGIC-201 — Phone normalization inconsistent across writers
- **Category:** Logical Error · normalization-mismatch
- **Description:** Two write paths normalize phone numbers differently (one strips formatting characters, one keeps "+1 (555)" as stored). The same phone hashes to two different keys, so dedupe and lookup layers miss matches and duplicate contacts are created. Detection: an integration test writing the same phone through both paths and asserting one record; a shared E.164 normalizer (libphonenumber) used by every writer is the fix.
- **Real-world example:** The phone-normalization class is a recognized identity bug pattern (E.164 normalization and libphonenumber exist for this reason; the "same phone, two contacts" class is a standing dedupe bug).

### BUG-LOGIC-202 — Regex anchoring on the wrong branch
- **Category:** Logical Error · regex-anchoring
- **Description:** An anchored pattern applies `^` only to the first branch of an alternation (`^a|b` matches "b" anywhere, not only at the start). A validation regex intending "must start with a or b" accepts strings that merely contain "b" anywhere, so invalid inputs pass the gate. Detection: a unit test seeding strings with the second branch in the middle/end and asserting rejection; grouping the anchors (`^(a|b)$`) is the fix.
- **Real-world example:** The anchoring class is a recognized regex bug pattern (the `^a|b` precedence trap is documented in regex guides; grouping anchors is the standard fix).

### BUG-LOGIC-203 — String length in UTF-16 units vs user-perceived chars
- **Category:** Logical Error · length-units
- **Description:** A character-limit check measures `str.length`, which counts UTF-16 code units: emoji and astral-plane characters count as 2, and combining sequences count as multiple units. A 140-char limit counting emoji as 2 rejects valid input (or accepts input that renders as more chars than the limit), and stored lengths disagree with user-perceived counts. Detection: a unit test seeding emoji and combining sequences and asserting the counted length; `Intl.Segmenter` grapheme counting (or `Array.from(str).length`) is the fix.
- **Real-world example:** The length-units class is a recognized bug pattern (Twitter's 140-character limit counting emoji as 2 UTF-16 units is the canonical example; `Intl.Segmenter` and code-point counting are the standard fixes).

### BUG-LOGIC-204 — HTML entity decoding missing
- **Category:** Logical Error · entity-decoding
- **Description:** Data containing HTML entities ("&", "<") is stored or compared without decoding, so comparisons against decoded text miss matches and dedupe keys hash differently for entity-encoded vs raw forms. Search and dedupe layers treat "&" as different from "&", producing duplicates and missed matches. Detection: a unit test seeding entity-encoded and raw forms and asserting the match; decoding entities before storage/comparison (or normalizing at the boundary) is the fix.
- **Real-world example:** The entity-decoding class is a recognized bug pattern (HTML entities must be decoded before comparison; the "& vs &" mismatch class is a standing dedupe/search bug).

### BUG-LOGIC-205 — URL query param plus-as-space
- **Category:** Logical Error · url-decode
- **Description:** A query parameter is decoded with `decodeURIComponent` alone (or not decoded), but `application/x-www-form-urlencoded` semantics decode "+" as a space. A token or search term containing "+" arrives as a space, so validation fails or search returns wrong results. Detection: a round-trip unit test with a "+"-containing value asserting the decoded text; URLSearchParams (or decoding with `+`→space handling) is the fix.
- **Real-world example:** The plus-as-space class is a recognized URL-parsing bug (application/x-www-form-urlencoded vs RFC 3986 semantics differ on "+"; URLSearchParams and explicit handling are the standard fixes).

### BUG-LOGIC-206 — Trailing newline in file-read comparison
- **Category:** Logical Error · line-ending
- **Description:** A file read into a string (or split into lines) retains a trailing newline (or CRLF from Windows-authored files), and the value is compared with equality (`content === expected`). The comparison fails because of the trailing "\n" or "\r", so validation and dedupe branches never fire. Detection: a unit test reading a CRLF-authored file and asserting the match; `.trim()`/`.trimEnd()` before comparison, or normalizing line endings at read time, is the fix.
- **Real-world example:** The line-ending class is a recognized bug pattern (git's autocrlf and Windows-authored CRLF files; the "trailing newline breaks equality" class is a standing fixture/comparison bug).

### BUG-LOGIC-207 — Stateful regex lastIndex persisting across calls
- **Category:** Logical Error · regex-stateful
- **Description:** A regex with the global (`g`) flag is reused across calls with `.test()` or `.exec()`, which advance the regex's `lastIndex`. The second call starts where the first stopped, so validation results alternate (true, false, true...) for identical input — a validator accepts then rejects the same string. Detection: a unit test calling `.test()` twice on the same input and asserting consistent results; non-global regexes for test (or resetting `lastIndex`) is the fix.
- **Real-world example:** The stateful-regex class is a documented JS gotcha (MDN: `g`-flagged regexes carry `lastIndex` across test/exec calls; non-global regexes are the standard fix for validation).

### BUG-LOGIC-208 — Charcode arithmetic wrapping past the alphabet
- **Category:** Logical Error · charcode-arithmetic
- **Description:** A letter-shifting cipher or index calculation adds offsets to char codes (`String.fromCharCode(code + shift)`), and the result wraps past 'z'/'Z' into non-letter characters ({, |, DEL). Output characters are not letters, so downstream validation and rendering receive garbage instead of the wrapped-around letter. Detection: a unit test asserting the output for shifts that wrap past the alphabet; modulo-wrapping within the alphabet (`(code - base + shift) % 26 + base`) is the fix.
- **Real-world example:** The charcode-wrap class is a recognized bug pattern (Caesar-cipher implementations must wrap within the alphabet; modulo-wrapping is the standard fix).

### BUG-LOGIC-209 — setTimeout-driven fake success
- **Category:** Logical Error · fake-success
- **Description:** A UI or API reports success on a timer (`setTimeout(() => setLoading(false), 3000)`) instead of on operation completion. The success state appears after a fixed delay regardless of whether the write succeeded, so failures render as success and slow successes render as failure until the timer fires. Detection: a test that fails the mock request and asserts the UI state; driving state from the operation's completion (promise resolution) is the fix.
- **Real-world example:** The timer-driven-success class is a recognized anti-pattern (state must be driven from operation completion; the "spinner hides a failed write" class is a standing QA finding).

### BUG-LOGIC-210 — Race between a timeout and a completion
- **Category:** Logical Error · timeout-race
- **Description:** A timeout fires and marks the operation failed, then the real result arrives and is written anyway — or conversely, the result arrives first and a late timeout overwrites it with a failure. The final state contradicts the actual outcome of the operation. Detection: a test that delays the completion beyond the timeout and asserts the final state; guarding writes with an operation-generation or cancelled flag (and clearing the timer on completion) is the fix.
- **Real-world example:** The timeout-race class is a recognized async bug pattern (the AJAX timeout class; generation guards and timer cleanup are the standard fixes).

### BUG-LOGIC-211 — Debounced handler firing after unmount
- **Category:** Logical Error · debounce-unmount
- **Description:** A debounced callback schedules state updates (`setTimeout(() => setState(v), 300)`) and the component unmounts before the timer fires. The callback runs on an unmounted component, so the state update throws (React) or leaks (state written to a dead component's closure). Detection: a test unmounting the component before the timer fires and asserting no update/error; clearing the timer in the cleanup path (useEffect return) is the fix.
- **Real-world example:** The debounce-unmount class is a documented React bug (React's "setState on unmounted component" warning; timer cleanup in useEffect's return is the standard fix).

### BUG-LOGIC-212 — Retry storms without backoff
- **Category:** Logical Error · retry-storm
- **Description:** A failure path retries immediately in a tight loop (or with a negligible delay) without exponential backoff. A failing dependency is hammered by retries — the retry loop multiplies the load on an already-failing service and turns a partial outage into a full one. Detection: a test asserting the retry count and delays against a failing mock; exponential backoff with a max attempts cap is the fix.
- **Real-world example:** The retry-storm class is a recognized failure mode (Google SRE Book Ch. 22 documents retry amplification — each frontend retry multiplies backend load; exponential backoff with caps is the standard fix).

### BUG-LOGIC-213 — TTL cache expiring mid-request
- **Category:** Logical Error · ttl-midrequest
- **Description:** A request checks the cache at the start, and the cached entry's TTL expires before the request finishes (or before a dependent read). A read that relied on the cache entry receives an expired value (or a cache miss mid-flight), so the request operates on data that is no longer valid. Detection: a test with a TTL shorter than the request duration and asserting the outcome; reading the cache once and passing the value through (or refreshing mid-flight) is the fix.
- **Real-world example:** The TTL-mid-request class is a recognized cache-aside failure mode (cache guides document reading once per request and passing values through; TTL-expiry races are a standing cache bug).

### BUG-LOGIC-214 — Clock-skew comparison against client clocks
- **Category:** Logical Error · clock-skew
- **Description:** A validity check compares timestamps against the client's clock (`Date.now()` in the browser vs the server's `exp`) without skew tolerance. Client clocks off by minutes (common in laptops, VMs) reject valid tokens or accept expired ones, so sessions fail intermittently for specific users. Detection: a test with a skewed client clock asserting the outcome; server-side validation with documented skew tolerance (Kerberos uses a 5-minute window) is the fix.
- **Real-world example:** The clock-skew class is a recognized auth bug class (Kerberos's 5-minute clock skew window is the canonical tolerance pattern; server-side validation is the standard fix).

### BUG-LOGIC-215 — Interval without clear on unmount
- **Category:** Logical Error · timer-leak
- **Description:** A `setInterval` is registered in a mount path without clearing it in the unmount/cleanup path. The interval keeps firing on the unmounted component (or accumulates on every remount), doubling or tripling the poll rate and updating dead state. Detection: a test unmounting and remounting with fake timers, asserting the number of live intervals; clearing the interval in the cleanup return is the fix.
- **Real-world example:** The unmount-interval class is a documented React bug (React docs' useEffect cleanup section; fake timers asserting interval counts are the standard detection method).

### BUG-LOGIC-216 — Promise.race timeout that doesn't cancel the loser
- **Category:** Logical Error · race-no-cancel
- **Description:** A timeout is implemented with `Promise.race([operation, timeoutPromise])`, but the losing operation continues running after the race settles. Work continues past the deadline (writes still land, connections stay open), and resources the operation held are never released. Detection: a test that resolves the timeout first and asserts the operation is aborted (in-flight request count drops); AbortController-per-operation is the fix.
- **Real-world example:** The race-no-cancel class is a recognized timeout failure mode (AbortController and timeout guides document cancelling the losing operation; the "write lands after the deadline" class is a standing bug).

### BUG-LOGIC-217 — Async init used before completion
- **Category:** Logical Error · init-order
- **Description:** A service method is called before its async initialization completes (`db.query()` before `await db.connect()` resolves, or a module exported before its init promise settles). The call fails with a "not connected" error or operates on an uninitialized client, so every cold-start request fails. Detection: a test calling the method immediately after construction and asserting the outcome; awaiting the init promise in the method (or a ready-gate) is the fix.
- **Real-world example:** The init-order class is a recognized startup failure mode (service guides document ready-gates and awaited initialization; the "not connected on cold start" class is a standing bug).

### BUG-LOGIC-218 — Sleep-based synchronization
- **Category:** Logical Error · sleep-sync
- **Description:** Code waits for an event by sleeping a fixed duration (`await new Promise(r => setTimeout(r, 2000))` before reading the result) instead of awaiting the event itself. The sleep is too short on slow environments (the event hasn't fired) or wasted when the event fires early, so tests flake and production code reads incomplete results. Detection: a flaky test on a slow CI runner; awaiting the actual event (promise, callback, poll-with-condition) is the fix.
- **Real-world example:** The sleep-based-sync class is a recognized test-flakiness pattern (testing guides document awaiting the actual event; the "sleep 2s then assert" class is the canonical flaky test).

### BUG-LOGIC-219 — Fire-and-forget without error handling
- **Category:** Logical Error · fire-and-forget
- **Description:** A background task is launched without awaiting it or attaching error handling (`void processJob()`), so its rejection is unobserved. The task fails silently; in Node 15+ the unhandled rejection crashes the process later, decoupled from the operation that launched it. Detection: `process.on('unhandledRejection')` telemetry and lint rules (`no-floating-promises`); attaching `.catch` (or a task queue with error handling) is the fix.
- **Real-world example:** The fire-and-forget class is a recognized Node.js failure mode (typescript-eslint's `no-floating-promises` exists for it; Node 15+ crashes on unhandled rejections).

### BUG-LOGIC-220 — Throttle implemented as debounce
- **Category:** Logical Error · throttle-confusion
- **Description:** A rate-limiting handler intended to throttle (fire at most once per interval, leading edge) is implemented as a debounce (fire only after activity stops). The leading-edge update never fires during continuous activity — a live position tracker updates only at the end, or a resize handler skips intermediate updates. Detection: a test driving continuous events and asserting the update count and timing; a leading-edge throttle (or trailing-edge per documented intent) is the fix.
- **Real-world example:** The throttle-vs-debounce class is a recognized frontend bug pattern (throttle/debounce guides document leading vs trailing edge; the "updates only at the end" class is a standing bug).

### BUG-LOGIC-221 — Timer ID mismatch on clear
- **Category:** Logical Error · timer-id-mismatch
- **Description:** A cleanup path clears the wrong timer ID (`clearTimeout(id)` where `id` was reassigned by a newer registration). The intended timer keeps running while the newer one is cleared, so the stale timer fires and processes outdated work. Detection: a test registering two timers and asserting the intended one fires; capturing each timer's ID at registration and clearing the correct one is the fix.
- **Real-world example:** The timer-ID class is a recognized bug pattern (timer cleanup guides document capturing IDs at registration; the "wrong timer cleared" class is a standing cleanup bug).

### BUG-LOGIC-222 — Listener added after the event fired
- **Category:** Logical Error · event-order
- **Description:** An event listener is registered after the code path that emits the event has already run, so the listener never receives the event it waits for. The waiting code blocks (or times out) while the event it needs was dispatched before registration. Detection: a test asserting the listener fires for an event emitted in the documented order; registering listeners before triggering the emitter (or an event-buffer/replay pattern) is the fix.
- **Real-world example:** The listener-registration-order class is a recognized eventing bug (event-emitter guides document registering before emitting; the "listener never fires" class is a standing bug).

### BUG-LOGIC-223 — Poll checking before the first delay
- **Category:** Logical Error · polling-order
- **Description:** A polling loop checks the condition immediately and then waits, so the first poll fires before the operation it polls has had any time to complete. The immediate check wastes a call (or consumes a rate-limited request) and the loop's first iteration is always a miss. Detection: a test asserting the first poll's timing relative to the operation start; waiting before the first check (or checking after the first delay) is the fix.
- **Real-world example:** The polling-order class is a recognized bug pattern (polling guides document delay-before-first-check; the "immediate wasted poll" class is a standing bug in rate-limited polling).

### BUG-LOGIC-224 — Macrotask after microtask ordering assumption
- **Category:** Logical Error · task-order
- **Description:** Code assumes `setTimeout(fn, 0)` runs before promise continuations (or vice versa), but the event loop drains all microtasks (promise callbacks) before the next macrotask. The continuation runs first, so the callback observes state the continuation already changed — or the code waits for a macrotask that will never be reached. Detection: a test asserting the execution order of a timer and a resolved promise; the microtask-before-macrotask order is documented (HTML spec event loop) and the fix is explicit ordering (await, or queueMicrotask).
- **Real-world example:** The task-ordering class is a documented JS behavior (the event loop drains microtasks before macrotasks; MDN and the HTML spec document it) and a recurring order-assumption bug in timer/promise mixes.

### BUG-LOGIC-225 — Cache stampede on concurrent expiry
- **Category:** Logical Error · cache-stampede
- **Description:** A hot cache entry expires and many concurrent requests all miss simultaneously, each recomputing the expensive value (a DB query, a report) in parallel. The backend is hit by a thundering herd — load spikes by the concurrency factor on every expiry of a hot key. Detection: a load test expiring a hot key and asserting the recompute count is one; single-flight locking (a promise-cached recompute) or stale-while-revalidate is the fix.
- **Real-world example:** The cache-stampede class is a recognized failure mode (thundering herd; single-flight and stale-while-revalidate are the standard fixes documented in caching guides).

### BUG-LOGIC-226 — Backoff without jitter
- **Category:** Logical Error · backoff-jitter
- **Description:** Exponential backoff retries with a fixed delay schedule and no jitter, so many clients that failed at the same moment retry at the same moment (synchronized waves). The recovering service is hit by retry waves that keep it from stabilizing. Detection: a load test with many concurrent failing clients asserting the retry timing distribution; full or equal jitter (randomized within the backoff window, as AWS SDKs document) is the fix.
- **Real-world example:** The synchronized-retry class is a recognized failure mode (AWS SDK guides document full jitter as the required backoff strategy precisely because fixed schedules synchronize retry waves).

### BUG-LOGIC-227 — Timer drift in long-running intervals
- **Category:** Logical Error · timer-drift
- **Description:** A schedule is implemented with `setInterval(fn, 60000)` assuming fixed cadence, but setInterval drifts (each tick starts a fixed delay after the previous one ended, accumulating delay from work time). A "every minute" job drifts by the accumulated work time and drifts further over hours — schedules no longer align with wall-clock boundaries. Detection: a test comparing tick timestamps against wall-clock boundaries over many ticks; self-correcting scheduling (setTimeout with the next boundary time) is the fix.
- **Real-world example:** The timer-drift class is a recognized scheduling bug pattern (self-correcting setTimeout scheduling is the standard fix; the "job drifts past its boundary" class is a standing cron/poll bug).

### BUG-LOGIC-228 — Last-writer-wins on a shared key
- **Category:** Logical Error · write-race
- **Description:** Two async writes target the same key (a config value, a counter, a document) and each write replaces the entire value. The last writer silently discards the first writer's change, and neither is notified — a merged or incremented value is lost. Detection: a test with two overlapping writes asserting the merged outcome; version checks, read-modify-write in a transaction, or per-key queues are the fix.
- **Real-world example:** The last-writer-wins class is a recognized shared-state failure mode (version checks and atomic read-modify-write are the standard fixes; the "lost increment" class is a standing bug).

### BUG-LOGIC-229 — Async results scrambled from input order
- **Category:** Logical Error · result-order
- **Description:** Async work pushes results into an array as each completes (`items.forEach(async i => results.push(await f(i)))`), so the result order reflects completion order, not input order. Consumers that index results positionally (`results[i]` for `items[i]`) read the wrong element whenever completion order differs. Detection: a test with deliberately varied completion times asserting positional alignment; `Promise.all(items.map(...))` (which preserves order) is the fix.
- **Real-world example:** The completion-order class is a recognized async bug pattern (Promise.all preserves input order; manual push-on-complete scrambles it — documented in promise guides).

### BUG-LOGIC-230 — Timeout timer started late
- **Category:** Logical Error · timer-start-late
- **Description:** A request deadline is started after an earlier await resolves (`await connect(); const t = setTimeout(fail, 5000)`), so the deadline excludes the connect time. Slow connects (a cold pool, a TLS handshake) push total latency past the intended deadline while the timer never fires, and the operation hangs past its SLA. Detection: a test with a slow connect asserting the total latency against the deadline; starting the timer before the first await (or a total-deadline wrapper) is the fix.
- **Real-world example:** The late-timer class is a recognized deadline bug pattern (deadline guides document starting the timer before the first await; the "hangs past the SLA" class is a standing bug).

### BUG-LOGIC-231 — Cancellation token not checked inside the loop
- **Category:** Logical Error · cancellation-check
- **Description:** A long-running loop processes items without checking a cancellation token inside the iteration, so work continues after cancellation is requested. The cancelled operation keeps consuming resources (API calls, CPU) and its results are written even though the caller cancelled. Detection: a test cancelling mid-loop and asserting the loop stops and no further writes land; a token check per iteration (or per batch) is the fix.
- **Real-world example:** The cancellation-check class is a recognized bug pattern (cancellation-token guides document checking per iteration; the "work continues after cancel" class is a standing bug).

### BUG-LOGIC-232 — Backoff counter reset in the wrong scope
- **Category:** Logical Error · backoff-reset
- **Description:** A retry loop's attempt counter (or backoff exponent) is reset inside the retry iteration (or on each schedule), so the backoff never grows. The retry loop retries at a constant short delay indefinitely — or grows without bound when the reset fires on the wrong path. Detection: a test asserting the retry delays grow per attempt against a failing mock; the counter scoped outside the iteration (reset only on success) is the fix.
- **Real-world example:** The backoff-reset class is a recognized retry bug pattern (retry guides document scoping the attempt counter outside the iteration; the "constant delay forever" class is a standing bug).

### BUG-LOGIC-233 — Async validation racing form submission
- **Category:** Logical Error · validation-race
- **Description:** A form triggers async validation (availability check, server-side validation) and the submit handler fires without awaiting the validation result. Submission proceeds on an unresolved validation — the form submits while the validation is still in flight, and invalid submissions pass the gate. Detection: a test submitting before validation resolves and asserting the gate; awaiting the validation in the submit handler (or blocking submission until settled) is the fix.
- **Real-world example:** The validation-race class is a recognized form bug pattern (form guides document awaiting async validation before submission; the "submits while validating" class is a standing bug).

### BUG-LOGIC-234 — Timer delay overflow past 2^31
- **Category:** Logical Error · timer-overflow
- **Description:** A timer delay is computed by multiplication (`ms * 60 * 60 * 1000` for hours) and exceeds 2^31-1 (2147483647 ms, ~24.8 days). Per the HTML spec, delays above the 32-bit signed maximum are clamped (to 1ms in older implementations), so a "run in 30 days" timer fires immediately (or never as intended). Detection: a test computing the delay and asserting it is within the 2^31-1 bound; chained timers (or splitting long delays into repeated short ones) is the fix.
- **Real-world example:** The timer-overflow class is a documented behavior (the HTML spec clamps setTimeout delays above 2147483647; Node and browsers implement the clamp) and a standing bug in long-schedule timer code.

### BUG-LOGIC-235 — Unbounded in-memory cache growth
- **Category:** Logical Error · unbounded-growth
- **Description:** An in-memory cache (a module-level Map, an array of results) stores every entry without eviction or a size cap. The collection grows with every unique request until the heap is exhausted, and the process crashes with an OOM after days of traffic. Detection: a load test with many unique keys asserting the collection size stays bounded (or monitoring heap growth in production); an LRU eviction policy or a size cap is the fix.
- **Real-world example:** The unbounded-cache class is a recognized memory-leak failure mode (LRU eviction and size caps are the standard fixes; the "OOM after days" class is a standing production leak).

### BUG-LOGIC-236 — Client created per-request without close
- **Category:** Logical Error · connection-leak
- **Description:** A request handler constructs a new database/HTTP client per request (`const client = new Pool()` inside the handler) without closing it. Each request leaks a connection (or a socket), and the pool/database exhausts its connection limit under sustained traffic — new requests fail with "too many connections". Detection: a load test asserting the open-connection count stays flat; a module-level shared pool (or closing the client in a finally) is the fix.
- **Real-world example:** The per-request-client class is a recognized connection-leak failure mode (connection-pool guides document shared module-level pools; the "too many connections" class is a standing production bug).

### BUG-LOGIC-237 — File descriptors exhausted in a loop
- **Category:** Logical Error · fd-exhaustion
- **Description:** A loop opens files (or sockets) without closing them, so the process accumulates file descriptors until the OS limit (ulimit) is reached. The open call fails with EMFILE/ENFILE and the loop crashes — or the process runs out of descriptors for every subsequent operation. Detection: a load test asserting the open-fd count stays flat (or monitoring fd count in production); closing in a finally (or a limit-batched loop) is the fix.
- **Real-world example:** The fd-exhaustion class is a recognized Node.js failure mode (EMFILE errors under load; the fs `ulimit` trap is documented in Node's production guides; close-in-finally is the standard fix).

### BUG-LOGIC-238 — Event emitter listener accumulation
- **Category:** Logical Error · listener-leak
- **Description:** Listeners are registered on a shared emitter (a module-level EventEmitter, the process object) per request without removal. The emitter accumulates listeners until Node's default limit (10) warns, and each event fires every accumulated listener — the handler runs N times for N registrations. Detection: Node's MaxListenersExceededWarning, or a test asserting the listener count stays flat; removing listeners in the teardown (or a scoped emitter) is the fix.
- **Real-world example:** The listener-accumulation class is a recognized Node.js leak (MaxListenersExceededWarning exists for it; the "handler fires N times" class is a standing production bug).

### BUG-LOGIC-239 — setInterval without unref keeping the process alive
- **Category:** Logical Error · interval-unref
- **Description:** A background `setInterval` (a metrics poll, a cleanup job) is never `unref()`'d, so the event loop never empties and a graceful shutdown (SIGTERM → process exit after in-flight work) never completes — the process must be killed. Detection: a test sending SIGTERM and asserting the process exits; `timer.unref()` (or clearing the interval in the shutdown path) is the fix.
- **Real-world example:** The unref class is a documented Node.js behavior (MDN/Node docs: unref'd timers don't keep the event loop alive; graceful-shutdown guides require unref or clearing background timers).

### BUG-LOGIC-240 — Stream backpressure not handled
- **Category:** Logical Error · backpressure
- **Description:** A readable stream is consumed by writing each chunk without checking `write()`'s return value or pausing the stream, so the internal buffer grows unboundedly when the consumer is slower than the producer. Memory spikes (or exhausts) on fast producers, and the process OOMs on large inputs. Detection: a load test with a slow consumer asserting the buffered size stays bounded; pausing on `write() === false` (or `pipe`/`pipeline` handling backpressure) is the fix.
- **Real-world example:** The backpressure class is a recognized Node.js stream failure mode (stream guides document `pipe`/`pipeline` and pause/resume as the required backpressure handling; the "OOM on fast producer" class is a standing leak).

### BUG-LOGIC-241 — Temp files never cleaned
- **Category:** Logical Error · temp-file-leak
- **Description:** A pipeline writes temp files (uploads, exports, scratch data) to a temp directory without a cleanup step, so files accumulate until the disk fills. Writes start failing with ENOSPC and the pipeline crashes — or the disk-full state breaks every other service on the same volume. Detection: a test asserting the temp directory is empty after the operation; a cleanup step (finally block, a TTL sweeper) is the fix.
- **Real-world example:** The temp-file class is a recognized disk-fill failure mode (cleanup steps and TTL sweepers are the standard fixes; the "ENOSPC after weeks" class is a standing production leak).

### BUG-LOGIC-242 — Pending promises retaining closures
- **Category:** Logical Error · closure-retention
- **Description:** Long-lived structures (an array of pending promises, a retry queue) hold references to closures that capture large data (request bodies, buffers, parsed documents). The data is retained as long as the promise is pending (or the queue holds it), so garbage collection cannot reclaim it and memory grows with every pending operation. Detection: a heap snapshot showing retained request data; releasing references on completion (or bounding the queue) is the fix.
- **Real-world example:** The closure-retention class is a recognized memory-leak failure mode (heap snapshots are the standard detection method; the "request data retained by pending promises" class is a standing leak).

### BUG-LOGIC-243 — Pool connection not released after query
- **Category:** Logical Error · pool-exhaustion
- **Description:** A query acquires a pooled connection and never releases it (the release call is on the success path only, or omitted), so the connection is never returned to the pool. The pool exhausts under sustained traffic and every subsequent query waits for a connection that never returns. Detection: a load test asserting the pool's idle count recovers; releasing in a finally (or the pool's `withConnection` wrapper) is the fix.
- **Real-world example:** The unreleased-connection class is a recognized pool failure mode (pool guides document releasing in a finally; the "pool exhausts" class is a standing production bug).

### BUG-LOGIC-244 — Large object retained in a global cache
- **Category:** Logical Error · cache-retention
- **Description:** A large object (a parsed document, a buffer, a model) is stored in a global cache after use and never cleared, so the object is retained for the process lifetime. Memory grows by the object's size on every cache fill that is never evicted, and the process OOMs. Detection: a heap snapshot showing the retained object; evicting after use (or an LRU policy with a memory bound) is the fix.
- **Real-world example:** The large-object-retention class is a recognized memory-leak failure mode (LRU with memory bounds are the standard fix; the "parsed documents never evicted" class is a standing leak).

### BUG-LOGIC-245 — Worker threads not terminated after task
- **Category:** Logical Error · thread-leak
- **Description:** A worker thread (or a subprocess pool worker) is spawned per task and never terminated after the task completes. Threads accumulate — each holds its own stack, event loop, and memory — and the process exhausts its thread/memory budget under sustained load. Detection: a load test asserting the live-thread count stays flat; terminating the worker (`worker.terminate()`) in a finally (or a persistent worker pool) is the fix.
- **Real-world example:** The thread-leak class is a recognized failure mode (worker-pool guides document persistent pools or terminating workers; the "thread accumulation" class is a standing production leak).

### BUG-LOGIC-246 — Write after stream destroy
- **Category:** Logical Error · stream-after-destroy
- **Description:** A consumer continues writing to a stream after it has been destroyed (or has errored/ended). The write fails with ERR_STREAM_WRITE_AFTER_END (or is silently dropped), and the consumer's error handling treats the failure as a data error instead of a destroyed-stream condition. Detection: the ERR_STREAM_WRITE_AFTER_END in the log; checking `destroyed`/`writableEnded` before writing (or handling the destroy event) is the fix.
- **Real-world example:** The write-after-destroy class is a recognized Node.js stream failure mode (Node's stream errors: ERR_STREAM_WRITE_AFTER_END / ERR_STREAM_DESTROYED; checking stream state before writing is the standard fix).

### BUG-LOGIC-247 — Timers preventing GC of large closures
- **Category:** Logical Error · timer-gc
- **Description:** A long-lived `setInterval` (or a persistent callback) closes over large data captured at registration time, so the data is retained as long as the timer lives. Memory grows by the captured size on every registration that is never cleared, and GC cannot reclaim it. Detection: a heap snapshot showing retained data referenced by the timer; clearing the timer (or a ref-based read instead of a captured closure) is the fix.
- **Real-world example:** The timer-GC class is a recognized memory-leak failure mode (heap snapshots showing timer-referenced data are the standard detection method; clearing timers and ref-based reads are the fixes).

### BUG-LOGIC-248 — Zombie subprocesses
- **Category:** Logical Error · zombie-process
- **Description:** A subprocess is spawned per task without waiting for it (or without handling its exit), so finished child processes are never reaped. Zombie processes accumulate (each holding a PID table entry), and the process exhausts its PID budget or the OS fills its process table. Detection: monitoring the process table for defunct entries; waiting for exit (`child_process`'s exit event / await) or detaching properly is the fix.
- **Real-world example:** The zombie-process class is a recognized OS failure mode (defunct entries fill the process table; waiting for exit or reaping is the standard fix).

### BUG-LOGIC-249 — Unbounded concurrent operations
- **Category:** Logical Error · unbounded-concurrency
- **Description:** A batch launches every operation in parallel (`Promise.all(items.map(...))` over thousands of items) without a concurrency limit. Memory (buffers, promises) and connections spike by the batch size, and the process OOMs or the downstream service exhausts its connection pool. Detection: a load test with a large batch asserting peak in-flight count and memory; a concurrency limiter (p-limit, Semaphore) is the fix.
- **Real-world example:** The unbounded-parallelism class is a recognized resource-exhaustion failure mode (p-limit and Semaphore-style primitives exist for it; the "OOM on a large batch" class is a standing production bug).

### BUG-LOGIC-250 — Socket not closed on the error path
- **Category:** Logical Error · error-path-leak
- **Description:** A handler opens a socket (or a file, a connection) and closes it only on the success path, so an error thrown between open and close leaks the resource. Errors are common in production, so leaked resources accumulate until the limit is reached. Detection: a test forcing an error between open and close and asserting the resource is released; try/finally around the resource (or a with-resource wrapper) is the fix.
- **Real-world example:** The error-path-leak class is a recognized resource failure mode (try/finally and with-resource wrappers are the standard fixes; the "leaked on error" class is a standing production leak).

### BUG-LOGIC-251 — LRU eviction never triggered
- **Category:** Logical Error · eviction-bug
- **Description:** A cache has an LRU policy but the size check compares the wrong unit (items vs bytes) or never runs (the check is on the success path only), so eviction never triggers. The cache grows past its bound until memory is exhausted — the LRU exists on paper but never evicts. Detection: a load test exceeding the bound and asserting eviction fires; the size check on every insert with matching units is the fix.
- **Real-world example:** The never-evicting-LRU class is a recognized cache failure mode (LRU guides document the size check on every insert; the "LRU on paper" class is a standing leak).

### BUG-LOGIC-252 — Full-file memory load
- **Category:** Logical Error · full-file-load
- **Description:** A large file is read entirely into memory (`fs.readFile`, `readFileSync`, or `fetch` without streaming) before processing, so memory spikes by the file size. Large inputs (multi-GB exports, videos) exhaust the heap and the process OOMs. Detection: a load test with a large file asserting peak memory; streaming processing (createReadStream, stream pipelines) is the fix.
- **Real-world example:** The full-file-load class is a recognized memory failure mode (streaming is the standard fix; the "OOM on a multi-GB file" class is a standing production bug).

### BUG-LOGIC-253 — AbortController never aborted
- **Category:** Logical Error · abort-leak
- **Description:** An AbortController is created per operation but never aborted after the operation completes (or fails), so in-flight requests (or their resources) are never released when the caller abandons them. Abandoned operations continue consuming connections and server resources. Detection: a test abandoning an operation and asserting the in-flight request count drops; aborting in a finally (or a timeout hook on the controller) is the fix.
- **Real-world example:** The never-aborted class is a recognized failure mode (AbortController guides document aborting on completion/abandonment; the "abandoned requests keep running" class is a standing leak).

### BUG-LOGIC-254 — Stale connection reused from the pool
- **Category:** Logical Error · stale-connection
- **Description:** A pooled connection that has been closed by the server (idle timeout, restart) is reused by the pool without a liveness check. The query fails with a "connection closed" error on the first use after the idle period, so requests fail intermittently after quiet periods. Detection: a test simulating a server-side close and asserting the pool recovers (or the query retries); liveness checks (`SELECT 1`), keepalives, or retry-on-first-use is the fix.
- **Real-world example:** The stale-connection class is a recognized pool failure mode (pool guides document liveness checks and keepalives; the "fails after idle" class is a standing production bug).

### BUG-LOGIC-255 — Module Map keyed by request never evicted
- **Category:** Logical Error · map-leak
- **Description:** A module-level Map is keyed by request objects (or request-scoped ids) and entries are never deleted, so every request adds an entry that is retained for the process lifetime. Memory grows linearly with traffic and the process OOMs after sustained load. Detection: a load test asserting the map size stays flat (or monitoring its size in production); WeakMap for object keys, or an eviction policy, is the fix.
- **Real-world example:** The keyed-Map leak class is a recognized Node.js failure mode (WeakMap exists for object-keyed retention; the "Map keyed by request" class is a standing leak documented in Node memory guides).

### BUG-LOGIC-256 — In-memory retry queue unbounded
- **Category:** Logical Error · retry-queue-leak
- **Description:** Failed jobs are pushed into an in-memory retry array (or queue) that is never bounded or drained to persistent storage. The queue grows with every failure, retaining the jobs' payloads in memory, and the process OOMs during extended outages — exactly when retries accumulate fastest. Detection: a test during a simulated outage asserting the queue stays bounded; a bounded queue with persistence (or a dead-letter store) is the fix.
- **Real-world example:** The in-memory-retry-queue class is a recognized failure mode (job-queue guides document bounded queues and dead-letter stores; the "OOM during the outage" class is a standing production bug).

### BUG-LOGIC-257 — fs.watch accumulation
- **Category:** Logical Error · watcher-leak
- **Description:** A `fs.watch` (or a file-watcher library) is registered per file (or per request) without closing previous watchers, so watchers accumulate. Each watcher holds an OS-level handle and fires on every change — the callback runs N times for N registrations on the same file. Detection: a test registering N watchers and asserting the callback fires once per change; closing watchers in the teardown (or one watcher with a shared handler) is the fix.
- **Real-world example:** The watcher-accumulation class is a recognized file-watching failure mode (fs.watch guides document closing watchers; the "callback fires N times" class is a standing leak).

### BUG-LOGIC-258 — WebSocket not closed on navigation
- **Category:** Logical Error · ws-leak
- **Description:** A client opens a WebSocket connection without closing it on page navigation (or component unmount), so every navigation leaks a server-side connection. The server accumulates connections per client session until its connection limit is reached, and stale connections keep receiving pushes. Detection: a test navigating repeatedly and asserting the server's connection count; closing the socket in the teardown (or a beforeunload/unmount hook) is the fix.
- **Real-world example:** The WebSocket-leak class is a recognized realtime-app failure mode (WebSocket guides document closing on unmount/navigation; the "server connection accumulation" class is a standing production bug).

### BUG-LOGIC-259 — Transaction not committed or rolled back
- **Category:** Logical Error · transaction-leak
- **Description:** A database transaction is begun and the code path returns (or throws) without committing or rolling back, so the connection holds an open transaction. The connection is never returned to the pool cleanly, locks are held, and other queries block until the transaction times out. Detection: monitoring for idle-in-transaction connections; try/finally around the transaction (commit/rollback in the finally) is the fix.
- **Real-world example:** The idle-in-transaction class is a recognized database failure mode (PostgreSQL's idle-in-transaction timeout exists for it; try/finally with commit/rollback is the standard fix).

### BUG-LOGIC-260 — Nested interval multiplication
- **Category:** Logical Error · interval-multiplication
- **Description:** A retry/refresh path registers a new `setInterval` inside the interval callback (or on every re-registration), so intervals multiply — 1 becomes 2 becomes 4. The callback fires at an exponentially growing rate, pinning the CPU and exhausting memory. Detection: a test asserting the interval count stays flat over many re-registrations; a single persistent interval (or clearing before re-registering) is the fix.
- **Real-world example:** The interval-multiplication class is a recognized timer bug (timer guides document clearing before re-registering; the "exponentially growing callback rate" class is a standing leak).

### BUG-LOGIC-261 — Shutdown handler timer killed before firing
- **Category:** Logical Error · shutdown-timer
- **Description:** A shutdown path schedules cleanup work with a timer (`setTimeout(finishShutdown, 5000)`) but the orchestrator (Kubernetes, systemd) kills the process before the timer fires. Cleanup work (flushing buffers, closing connections) never runs, and in-flight state is lost on every restart. Detection: a test sending SIGTERM with a short grace period and asserting the cleanup ran; performing cleanup synchronously (or within the grace period) is the fix.
- **Real-world example:** The shutdown-timer class is a recognized graceful-shutdown failure mode (Kubernetes's terminationGracePeriodSeconds exists for it; cleanup within the grace period is the standard fix).

### BUG-LOGIC-262 — Resource pool created per-request
- **Category:** Logical Error · pool-per-request
- **Description:** A connection pool (or a client with internal pooling) is constructed per request instead of shared at module level, so pooling is defeated — each request creates and destroys its own pool with its own connections. Connection churn (TLS handshakes, auth) adds latency to every request and the database sees connection storms. Detection: a load test asserting the pool instance count and connection churn; a module-level shared pool is the fix.
- **Real-world example:** The pool-per-request class is a recognized failure mode (pool guides document module-level shared pools; the "connection storm per request" class is a standing production bug — a superset of per-request clients that defeats pooling itself).
