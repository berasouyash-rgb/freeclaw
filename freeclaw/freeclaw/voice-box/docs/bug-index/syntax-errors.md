# 3. Syntax Errors
Mistakes in code syntax that prevent successful compilation or execution. Every entry names the mechanism, the failure mode, and the detection surface. Includes compile-time syntax, runtime parse/shape errors, and module-system failures — the class of "syntax" that surfaces at runtime in dynamic/interpreted environments.

### BUG-SYNTAX-001 — Unclosed parenthesis in call expression
- **Category:** Syntax Error · bracket-mismatch
- **Description:** A function call opens `(` and never closes it, e.g. `run(input, opts`. The parser reaches end-of-file still expecting the closing token and aborts the entire file: tsc reports "')' expected", V8 reports "SyntaxError: missing ) after argument list". No module in the file evaluates; the build log's single error is the detection surface.
- **Real-world example:** Bracket-mismatch is the most common single-line parse failure in generated code — a truncated write or an AI edit dropping the closing token fails the whole build with one error pointing at the last line.

### BUG-SYNTAX-002 — Unclosed curly brace in nested blocks
- **Category:** Syntax Error · bracket-mismatch
- **Description:** An `if`, `for`, or function body opens `{` and one nesting level's closing `}` is missing. The parser absorbs subsequent declarations into the unclosed block and fails at end-of-file ("SyntaxError: Unexpected end of input") or at the first token it cannot absorb (tsc: "'}' expected" or "Declaration or statement expected"). The reported line lands far from the dropped brace.
- **Real-world example:** Nested-block mismatches are the classic failure of multi-line edits — editor bracket matchers and Prettier's parse failure are the practical detectors, and the deeper the nesting the farther the reported line lands from the fault.

### BUG-SYNTAX-003 — Unterminated string literal
- **Category:** Syntax Error · string-literal
- **Description:** A double- or single-quoted string opens with its quote and never closes, e.g. `const s = "abc`. The lexer fails the whole file: tsc reports "Unterminated string literal", V8 reports "SyntaxError: Invalid or unexpected token". The build error names the line, so nothing downstream parses.
- **Real-world example:** Unterminated strings are the signature failure of truncated file writes and copy-paste across editors that strip the closing quote — the error surface makes the truncation immediately visible in the build log.

### BUG-SYNTAX-004 — Unterminated template literal
- **Category:** Syntax Error · template-literal
- **Description:** A template literal opens with a backtick and the closing backtick is missing. Because template literals legally span newlines, the parser absorbs every following line as template text and fails only at end-of-file: tsc "Unterminated template literal", V8 "SyntaxError: Invalid or unexpected token". Everything between is silently swallowed.
- **Real-world example:** The multiline legality makes this class expensive — the reported error lands far from the dropped backtick, and the first symptom is often wrong output on nearby lines before the parse failure appears.

### BUG-SYNTAX-005 — Unescaped newline inside a regular string
- **Category:** Syntax Error · string-literal
- **Description:** A literal line break sits inside a normal quoted string (`"abc` followed by a newline before the closing quote). Regular strings cannot span newlines, so the lexer fails at the break: tsc "Unterminated string literal", V8 "SyntaxError: Invalid or unexpected token". Template literals are the intended fix.
- **Real-world example:** This recurs in machine-generated multi-line messages built by naive string concatenation — the pattern fires whenever a template literal was intended but a quoted string was emitted.

### BUG-SYNTAX-006 — Reserved word used as identifier
- **Category:** Syntax Error · reserved-word
- **Description:** A syntax-reserved word is used as a variable, function, or parameter name, e.g. `const class = 1` or `function delete() {}`. The parser rejects the token: V8 "SyntaxError: Unexpected token", tsc "Identifier expected" or "'class' is a reserved word". Property-name positions are exempt since ES5 (`obj.class` is legal).
- **Real-world example:** The recurring pattern is generated or migrated code that names variables after the concepts they hold — `const enum`, `const new`, `const in` all parse-fail at compile time before any runtime work.

### BUG-SYNTAX-007 — Duplicate block-scoped declaration
- **Category:** Syntax Error · duplicate-declaration
- **Description:** `let` or `const` declares the same binding name twice in one scope, e.g. `let x; let x;`. The parser rejects it: V8 "SyntaxError: Identifier 'x' has already been declared", tsc "Cannot redeclare block-scoped variable 'x'". The file fails at compile time.
- **Real-world example:** The recurring form is a merge or AI edit adding a second `const config = ...` line into a scope that already has one — tsc and ESLint's no-redeclare both catch it deterministically at lint/build time.

### BUG-SYNTAX-008 — Lexical declaration colliding with a function parameter
- **Category:** Syntax Error · duplicate-declaration
- **Description:** A `let`/`const` inside a function body redeclares the function's parameter name (`function f(a) { let a; }`), or `var` and `let` declare the same name in one scope (`var x; let x;`). Both are parse-time redeclaration errors: V8 "SyntaxError: Identifier 'a' has already been declared", tsc "Duplicate identifier". The file fails at compile time.
- **Real-world example:** This recurs when a refactor renames a parameter without renaming the local, or when a generated body declares a `let` shadowing a destructured parameter — tsc's Duplicate identifier diagnostic catches it at build.

### BUG-SYNTAX-009 — Octal literal in strict mode
- **Category:** Syntax Error · strict-mode
- **Description:** Legacy octal syntax `0755` (leading zero) appears in strict-mode code; ES modules are always strict. The parser rejects it at parse time: "SyntaxError: Octal literals are not allowed in strict mode" from V8 and the identical message from tsc. `0o755` is the modern form.
- **Real-world example:** The recurring case is ported shell/file-mode code computing permissions as `0755`-style literals — every ES module import of that file fails at parse time until the `0o` prefix is applied.

### BUG-SYNTAX-010 — Duplicate parameter names in strict mode
- **Category:** Syntax Error · strict-mode
- **Description:** A non-arrow function declares the same parameter name twice, e.g. `function f(a, a) {}`, in strict-mode code. Strict mode forbids duplicate parameter names, so the parser rejects it: V8 "SyntaxError: Duplicate parameter name not allowed in this context", tsc a duplicate-identifier error naming the parameter. All ES modules are strict, so this fails at parse time in any module.
- **Real-world example:** The duplicate-param class recurs in generated callback bodies declaring two identically-named handlers — tsc and the V8 parser both name the offending parameter, making the fix a one-line rename.

### BUG-SYNTAX-011 — `with` statement in strict mode
- **Category:** Syntax Error · strict-mode
- **Description:** A `with (obj) { ... }` block appears in strict-mode code. Strict mode prohibits `with` entirely, so the parser rejects it at parse time: V8 "SyntaxError: Strict mode code may not include a with statement", tsc "'with' statements are not allowed in strict mode." All ES modules are strict.
- **Real-world example:** This recurs when legacy CJS-era utility code is migrated into an ES module — the `with`-based scope shortcut fails at parse time, and the fix is explicit property destructuring.

### BUG-SYNTAX-012 — Missing comma in a multi-line object literal
- **Category:** Syntax Error · missing-comma
- **Description:** A property pair in a multi-line object literal lacks its trailing comma, e.g. `{ a: 1` newline `b: 2 }`. The parser treats the next line as a continuation and fails at the unexpected token: V8 "SyntaxError: Unexpected identifier" or a missing-semicolon variant; tsc "',' expected" or "';' expected" at the first token of the following line.
- **Real-world example:** The most common trigger is an AI-generated or hand-edited insertion into an existing literal where the previous line's comma was dropped — Prettier's parse failure and tsc's "',' expected" both point at the following line.

### BUG-SYNTAX-013 — Missing comma in a multi-line array literal
- **Category:** Syntax Error · missing-comma
- **Description:** Two adjacent elements in an array literal lack a separating comma, e.g. `[1, 2` newline `3]`. The parser fails at the second element with an unexpected-token error; tsc reports "',' expected" at the exact element boundary.
- **Real-world example:** The recurring form is a list literal extended by appending a new element after an element whose comma was omitted — the build error names the element, so the fix is a single-character insertion.

### BUG-SYNTAX-014 — Arrow function block body without return
- **Category:** Syntax Error · arrow-return-confusion
- **Description:** An arrow function uses a block body `{ ... }` but omits `return`, e.g. `const f = () => { compute(); };`. The function is syntactically valid but returns `undefined` instead of the computed value; every downstream property read on the result is `undefined`. This is a silent runtime failure, not a parse error.
- **Real-world example:** The missing-return arrow class recurs wherever a concise expression-bodied arrow (`=> value`) is rewritten into a block body without re-adding `return` — TypeScript return-type annotations on the callback and ESLint's consistent-return are the deterministic detectors.

### BUG-SYNTAX-015 — Arrow function object literal parsed as a labeled block
- **Category:** Syntax Error · arrow-return-confusion
- **Description:** An arrow function intends to return an object literal but writes `const f = () => { key: value };` without wrapping parentheses. The `{` is parsed as a block body, `key:` as a label statement, and the function returns `undefined`; TypeScript types it `() => void` and errors when the result is used as an object.
- **Real-world example:** This is the canonical reason for the `() => ({ ... })` idiom — the recurring failure is a reducer or map callback written as `=> { ... }` that silently returns `undefined`, caught by React's "Reducer must not return undefined" or a failing type check against the expected object shape.

### BUG-SYNTAX-016 — Implicit `any` on an untyped callback parameter
- **Category:** Syntax Error · implicit-any
- **Description:** A callback's parameter has no annotation and no contextual type from the calling signature. Under `noImplicitAny` tsc errors "Parameter 'x' implicitly has an 'any' type"; with the flag off the parameter is silently `any` and every downstream use type-checks clean regardless of the actual runtime shape.
- **Real-world example:** The implicit-any class is the classic way API shape changes slip through TypeScript — the parameter's real shape changes server-side, the `any` binding keeps compiling, and the first failure is a runtime undefined read. @typescript-eslint/no-unsafe-* and explicit parameter annotations are the detection surface.

### BUG-SYNTAX-017 — `as` cast hiding a wrong shape
- **Category:** Syntax Error · ts-cast-misuse
- **Description:** A value is force-typed with `const cfg = res as Config` when its runtime shape is a different object entirely (commonly an error object or a raw response). TypeScript trusts the assertion and stops checking; the compile passes and the first property read on the mis-shaped value returns `undefined` at runtime.
- **Real-world example:** The `as`-cast class is the recognized way type errors are silenced — an API response's shape changes, the `as Config` assertion keeps the build green, and the first symptom is downstream `undefined`. @typescript-eslint/consistent-type-assertions and runtime schema validation (zod) are the detection surface.

### BUG-SYNTAX-018 — `as unknown as` double-cast bypassing all type checking
- **Category:** Syntax Error · ts-cast-misuse
- **Description:** A value is cast through `unknown` to an unrelated type with `obj as unknown as Foo`. The intermediate `unknown` defeats every assignability check, so the expression compiles no matter how unrelated `obj` and `Foo` are — a deliberate, total type-system bypass at the cast site.
- **Real-world example:** The `as unknown as` class is a recognized review smell: no compiler or standard lint rule catches it (no-unnecessary-type-assertion does not apply), so detection is grep/code review at the cast site plus runtime schema validation of the resulting value.

### BUG-SYNTAX-019 — Non-null assertion on a possibly-null value
- **Category:** Syntax Error · non-null-assertion
- **Description:** A nullable value is dereferenced with `user!.name`, removing `null`/`undefined` from the type at the assertion site. TypeScript stops checking that access; when the value is null at runtime the access throws "TypeError: Cannot read properties of null (reading 'name')".
- **Real-world example:** The non-null-assertion class is the recognized way nullable API values explode at runtime — the assertion silences the check the author was sure about, and the first production null hits the exact line. @typescript-eslint/no-non-null-assertion and null-path unit tests are the detection surface.

### BUG-SYNTAX-020 — Type imported without `import type` breaking ESM module link
- **Category:** Syntax Error · type-only-import
- **Description:** A type-only export is imported as a value import (`import { MyInterface } from './types'`) without the `type` keyword. Under `verbatimModuleSyntax` (or esbuild/babel transpilation) the import is left in the emitted JavaScript, and loading the emitted ESM fails at module link: "The requested module does not provide an export named 'MyInterface'".
- **Real-world example:** This is the standard failure when a codebase enables `verbatimModuleSyntax` or moves from tsc to esbuild — every consumer of a types barrel fails at import time until the type-only imports are marked. tsc with verbatimModuleSyntax names each offending import at build.

### BUG-SYNTAX-021 — Type-position value import erased at runtime
- **Category:** Syntax Error · type-erasure
- **Description:** A real value (a class, a config module with side effects) is imported but used only in type annotations, so TypeScript elides the import from the emitted output. The module never loads at runtime, and any side effects it performed — environment validation, prototype patching, registration — silently never run.
- **Real-world example:** The erased-import class is a recognized silent module failure — a side-effect module imported "for its types" never executes, and the first symptom is missing registration downstream. `verbatimModuleSyntax`/`importsNotUsedAsValues` and runtime tests asserting the side effect are the detection surface.

### BUG-SYNTAX-022 — String enum member compared to a plain string literal
- **Category:** Syntax Error · enum-string-literal
- **Description:** A string enum member is compared or assigned where a plain string literal is expected, e.g. `if (dir === 'up')` with `dir: Direction`. The member type is nominal in TypeScript, so assigning `const x: 'up' = Direction.Up` is a compile error, and the runtime comparison against a raw literal silently never matches when the two spellings differ.
- **Real-world example:** The enum-vs-literal class recurs when an API returns raw strings where an enum was defined — TS catches the assignment direction with a not-assignable error naming both types, but the comparison direction is silent, detected by exhaustive unit tests over the enum's members.

### BUG-SYNTAX-023 — `Record<string, any>` erasing object structure
- **Category:** Syntax Error · type-erasure
- **Description:** An object is typed as `Record<string, any>`, which makes every property access return `any`. Typos, missing fields, and renamed keys all type-check clean; the first failure is a runtime `undefined` read or a silent no-op where a field was expected.
- **Real-world example:** The `Record<string, any>` class is the recognized structure-erasure pattern — config objects typed this way accept any shape, and the drift is only caught by runtime schema validation (zod) or @typescript-eslint/no-unsafe-member-access flagging the `any` reads.

### BUG-SYNTAX-024 — Stale .tsbuildinfo making `tsc -b` skip real errors
- **Category:** Syntax Error · ts-buildinfo
- **Description:** With composite/incremental builds (`tsc -b`), the `.tsbuildinfo` file records which inputs were checked. A stale info file — after a git branch switch, a timestamp collision, or a partial write — makes the build conclude nothing changed, skip rechecking, and exit green while real syntax and type errors sit in the tree.
- **Real-world example:** The stale-buildinfo class is a recognized tsc incremental-build failure — CI caches a `.tsbuildinfo`, a branch switch changes file contents without changing the recorded state, and the build passes over broken files. Deleting the info file or `tsc -b --force` is the verification surface.

### BUG-SYNTAX-025 — tsconfig path aliases misconfigured between compile and runtime
- **Category:** Syntax Error · tsconfig-paths
- **Description:** A `paths` alias (`"@/*": ["./src/*"]`) resolves for tsc but is not registered in the runtime — Jest's `moduleNameMapper`, Vite's `resolve.alias`, or webpack's resolve config. The compile passes, and at runtime every import through the alias fails with "Cannot find module '@/utils/x'".
- **Real-world example:** The path-alias class is the classic compile-green/runtime-red split — TypeScript's `paths` is a compile-time-only mapping and each runtime needs its own registration. The failing test or the runtime "Cannot find module" error names the alias.

### BUG-SYNTAX-026 — Generics mis-instantiated by inference
- **Category:** Syntax Error · generics-misuse
- **Description:** A generic's type parameter is inferred from the wrong contextual type or left empty — `useState()` inferring `undefined`, `new Map()` inferring `Map<any, any>`, or a helper typed `<T extends object>` called with a primitive. Violated constraints are compile errors naming the constraint; the empty-inference variant compiles clean and the collection is typed wrong for every downstream operation.
- **Real-world example:** The empty-type-parameter class recurs in React state (`useState<T[]>()` giving `T[] | undefined`) — the first `.map` on the value is the runtime failure, caught by strict null checks at compile or the type error when the inferred shape is used against an expected one.

### BUG-SYNTAX-027 — Class field ordering breaking initialization
- **Category:** Syntax Error · class-field-order
- **Description:** A field initializer references another field declared later in the class, or a constructor calls a method that reads a field assigned later in the constructor body. Field initializers run in declaration order, so the earlier reference reads `undefined` and throws "TypeError: Cannot read properties of undefined (reading 'x')" at construction.
- **Real-world example:** The class-field-order class sharpened with `useDefineForClassFields: true` — the ES2022 semantics change reordered initialization relative to parameter properties, breaking subclasses that relied on the old assignment order. tsc flags same-class initializer order; constructor-order issues are caught by construction-time unit tests.

### BUG-SYNTAX-028 — TypeScript-only syntax in a `.js` file
- **Category:** Syntax Error · ts-in-js
- **Description:** TS-only constructs — an `interface` declaration, an enum, or type annotations like `x: number` — appear in a file loaded as JavaScript (a `.js` file, or a `.ts` file excluded from tsc and passed through esbuild with the js loader). The JS parser rejects the tokens: "SyntaxError: Unexpected identifier" for `interface Foo`, "Unexpected token ':'" for annotations.
- **Real-world example:** The TS-in-JS class recurs in mixed toolchains where a file's extension or its tsconfig `include`/`exclude` membership silently changes which parser handles it — the build error names the first TS-only token, and the fix is renaming the file or correcting the compile graph.

### BUG-SYNTAX-029 — Assignment to a `const` binding
- **Category:** Syntax Error · const-reassignment
- **Description:** A `const` binding is reassigned, e.g. `const x = 1; x = 2;`. tsc errors "Cannot assign to 'x' because it is a constant" at compile; with the check bypassed the runtime throws "TypeError: Assignment to constant variable". Mutating properties of a const object is legal — only the binding itself is protected.
- **Real-world example:** The const-reassignment class recurs in refactors that change `let` to `const` without checking every assignment path — ESLint's no-const-assign and tsc both name the binding, making the failure a deterministic compile/lint error.

### BUG-SYNTAX-030 — `this` binding lost in a callback
- **Category:** Syntax Error · this-binding
- **Description:** A method that reads `this` is passed as a bare callback (e.g. `setTimeout(obj.greet, 100)` or `arr.map(obj.render)`), detaching it from its receiver. In strict mode (all modules) `this` is `undefined`, so `this.name` throws "TypeError: Cannot read properties of undefined (reading 'name')" or returns `undefined`.
- **Real-world example:** The unbound-method class is the recognized React class-component failure — a handler passed as a prop loses its receiver and the first interaction throws. @typescript-eslint/unbound-method and interaction tests are the detection surface.

### BUG-SYNTAX-031 — `var` hoisting reading before declaration
- **Category:** Syntax Error · hoisting
- **Description:** A `var` declaration is read before its declaration line (`console.log(x); var x = 1;`). Hoisting moves the binding but not the assignment, so the read yields `undefined` with no error — the silent half of the hoisting class. The `let`/`const` variant is the loud half: the same read order throws "ReferenceError: Cannot access 'x' before initialization" (temporal dead zone).
- **Real-world example:** The var-before-declaration class recurs in migrated code where a declaration was pushed below its first use — ESLint's no-use-before-define and tsc's block-scoped declaration check are the detection surface; the runtime symptom is `undefined` flowing downstream.

### BUG-SYNTAX-032 — Switch fallthrough without `break`
- **Category:** Syntax Error · switch-fallthrough
- **Description:** A `case` clause omits `break` (or `return`/`throw`), so execution falls through into the next case's body — case 1 runs case 2's statements. The extra statements execute unintentionally at runtime, a silent logic failure rather than an error.
- **Real-world example:** The fallthrough class recurs when a new case is inserted above an existing one without a terminator — ESLint's no-fallthrough and tsc's `noFallthroughCasesInSwitch` flag every non-empty fallthrough, and unit tests asserting per-case behavior catch the silent execution.

### BUG-SYNTAX-033 — Getter/setter mismatch
- **Category:** Syntax Error · getter-setter
- **Description:** A class defines a setter without a getter, or a getter whose type is not assignable to its setter type. Reading a setter-only property returns `undefined` at runtime (a silent no-op); mismatched accessor types are a compile error — since TS 4.3 the getter type must be assignable to the setter type, and duplicate same-named accessors are rejected outright.
- **Real-world example:** The accessor-mismatch class recurs when a getter's return type is widened or a setter is added without a getter — tsc names the mismatched accessor at build, and property-read unit tests catch the setter-only `undefined` read.

### BUG-SYNTAX-034 — Assignment in a conditional (`=` vs `===`)
- **Category:** Syntax Error · assignment-in-condition
- **Description:** A condition uses `=` instead of `===`, e.g. `if (x = getValue())`. The assignment executes, the condition tests the assigned value's truthiness, and the intended comparison never happens — the variable is clobbered and the branch is chosen by accident, with no exception raised.
- **Real-world example:** The assignment-in-condition class recurs wherever a comparison was intended but a single `=` was emitted — ESLint's no-cond-assign flags every assignment in an `if`/`while` condition, and unit tests asserting both branch directions catch the wrong selection.

### BUG-SYNTAX-035 — ASI hazard: `return` followed by a newline
- **Category:** Syntax Error · asi-hazard
- **Description:** A `return` statement is followed by a newline before its value (`return` newline `{ ok: true };`). Automatic semicolon insertion terminates the return, the object literal below becomes unreachable dead code, and the function returns `undefined` — valid syntax, silent wrong result.
- **Real-world example:** The return-ASI class is the canonical reason style guides require values on the same line as `return` — ESLint's no-unreachable flags the dead code, and a return-type annotation on the function makes the `undefined` return a compile error.

### BUG-SYNTAX-036 — Circular import: one side of an A→B→A cycle is undefined at load
- **Category:** Syntax Error · circular-import
- **Description:** Module A imports B and B imports A. Whichever module the loader enters first is still mid-evaluation when the other asks for it, so one side receives an incomplete binding: in CommonJS a partial `exports` object, in ESM a binding still in its temporal dead zone. Top-level `class extends` against the undefined side throws "Class extends value undefined"; top-level const reads throw a ReferenceError.
- **Real-world example:** The circular-import class is a recognized Node/Jest failure — circularly-dependent classes fail with "Class extends value undefined" or "Super expression must either be null or a function", and the cycle is only visible via madge, ESLint's import/no-cycle, or the loader's own error.

### BUG-SYNTAX-037 — Barrel-file re-export cycle
- **Category:** Syntax Error · barrel-cycle
- **Description:** A barrel `index.ts` re-exports from `a.ts` and `b.ts` while `a.ts` imports from `index.ts`, closing a cycle through the barrel. Load order decides which binding is undefined, so the failure is order-dependent and often reproducible only in one entry path (a specific test file or SSR route) while other paths work.
- **Real-world example:** The barrel-cycle class is a recognized Next.js/Vite failure — re-export cycles through index barrels cause "Cannot access 'X' before initialization" during SSR or specific test entry paths. ESLint's import/no-cycle with the barrel included and madge are the detection surface.

### BUG-SYNTAX-038 — Default vs named import mismatch
- **Category:** Syntax Error · import-mismatch
- **Description:** A module exports a named binding (`export const foo`) and the consumer writes `import foo from './mod'`. Under TypeScript's esModuleInterop tsc errors "Module has no default export"; in native Node ESM the link fails with "does not provide an export named 'default'"; under Babel interop the default binding is silently `undefined` and the first `foo()` call throws "TypeError: foo is not a function".
- **Real-world example:** The default-vs-named class recurs when a module migrates from a default export to named exports (or vice versa) — babel-interop consumers fail silently with `undefined`, caught only by ESLint's import/default or the downstream TypeError in tests.

### BUG-SYNTAX-039 — CJS default import applied wrongly
- **Category:** Syntax Error · cjs-esm-interop
- **Description:** A CommonJS package with no default export is consumed with `import x from 'pkg'` while `esModuleInterop` is off — tsc errors "Module can only be default-imported using the 'esModuleInterop' flag" and native Node ESM fails the link with "does not provide an export named 'default'". The reverse direction (`require('esm-pkg')`) returns the module namespace object instead of the default export.
- **Real-world example:** The CJS/ESM interop class is a recognized migration failure — packages like `moment` only default-import cleanly with esModuleInterop/allowSyntheticDefaultImports, and TS's Node16 module resolution tightened the interop rules, surfacing previously-silent mismatches at build.

### BUG-SYNTAX-040 — Dynamic import path that doesn't resolve
- **Category:** Syntax Error · dynamic-import
- **Description:** `await import(someVar)` uses a path the bundler cannot statically analyze, or the resolved specifier does not exist at runtime. Vite warns "dynamic import cannot be analyzed" at build and the runtime import rejects with "Failed to fetch dynamically imported module"; Node reports "Cannot find module". The importing code path fails at first execution, not at build.
- **Real-world example:** The dynamic-import class is a recognized post-deploy failure — Vite/webpack chunk hash changes leave stale cached HTML referencing old chunks, and the first navigation after deploy rejects with "Failed to fetch dynamically imported module". Bundler warnings and runtime error monitoring (Sentry) are the detection surface.

### BUG-SYNTAX-041 — Missing export on a mocked module — vitest mock proxy throw
- **Category:** Syntax Error · mock-proxy-throw
- **Description:** `vi.mock('./worker')` without a factory auto-mocks the module with a proxy whose export surface is a snapshot of the mocked module. When the production module gains a new export and code under test destructures or accesses it, the proxy throws `No "X" export is defined on the mock` at the access line — every test mocking that module fails at the same point.
- **Real-world example:** An upgraded worker destructured a newly-added export from a mocked module whose factory didn't define it, throwing at the destructuring line and failing every test mocking that module. The vitest error names the missing export, making the fix a one-line addition to the mock factory.

### BUG-SYNTAX-042 — vi.mock factory hoisting into the temporal dead zone
- **Category:** Syntax Error · mock-hoisting
- **Description:** `vi.mock` calls are hoisted above all imports and variable declarations in the test file. A factory referencing an outer variable declared below (e.g. `const mockData = ...` after the `vi.mock` call) executes before the variable is initialized and throws `ReferenceError: Cannot access 'mockData' before initialization` at module evaluation — every test in the file fails before any assertion runs.
- **Real-world example:** The mock-hoisting class is a recognized vitest/jest failure — vitest documents the hoisting behavior, and Jest's babel-plugin-jest-hoist rejects out-of-scope references at compile time with "The module factory of jest.mock() is not allowed to reference any out-of-scope variables". `vi.hoisted` is the sanctioned fix.

### BUG-SYNTAX-043 — Spreading a non-iterable (object) into an array literal
- **Category:** Syntax Error · spread-misuse
- **Description:** An array literal spreads a plain object (`const arr = [...options]`), but array spread requires `[Symbol.iterator]`, which plain objects lack. The runtime throws "TypeError: object is not iterable (cannot read property Symbol(Symbol.iterator))" at the spread — and when the throw is wrapped in a broad try/catch the feature that depended on the array is silently disabled instead.
- **Real-world example:** An options object was passed where an array was expected and the error was silently caught, disabling an AI feature — the classic shape of this class: the spread site is syntactically correct, the value's shape is wrong, and the catch hides the TypeError. TypeScript catches it at compile when the types are known ("Type 'X' must have a '[Symbol.iterator]()' method").

### BUG-SYNTAX-044 — Spreading null/undefined into an array literal
- **Category:** Syntax Error · spread-misuse
- **Description:** An array literal spreads a nullable value (`[...maybeList]`) that is null or undefined at runtime. Array spread throws "TypeError: undefined is not iterable" (or the null variant) at the spread site. The object-spread counterpart (`{ ...undefined }`) is legal and yields `{}`, so the same call-site pattern fails only in the array direction.
- **Real-world example:** The nullish-spread class recurs where an optional-chained value (`res?.data?.items`) is spread directly — the chain silently produces `undefined` and the spread is the first throw. TypeScript catches it at compile when the nullable type is known; runtime null-path tests are the other surface.

### BUG-SYNTAX-045 — Spreading a non-iterable into function call arguments
- **Category:** Syntax Error · spread-misuse
- **Description:** A function call spreads a plain object or nullish value into its argument list, e.g. `Math.max(...limits)` where `limits` is an object. The spread requires an iterator, so the runtime throws "TypeError: object is not iterable" at the call and the function never executes.
- **Real-world example:** The spread-into-args class recurs with variadic builtins (`Math.max`, `console.log`) and spread calls fed by API values whose shape changed — TypeScript catches it at compile when the type is known, and the runtime TypeError names the spread call site.

### BUG-SYNTAX-046 — Spreading a Map into an array yields entry pairs, not values
- **Category:** Syntax Error · spread-misuse
- **Description:** An array literal spreads a Map (`[...map]`), which iterates its `[key, value]` entry pairs, not its values. Code expecting an array of values receives tuples instead; downstream field reads on the tuples (e.g. `item.name`) return `undefined` at runtime with no exception.
- **Real-world example:** The Map-spread class recurs wherever a Map is converted "for free" with spread — the sanctioned conversions are `Array.from(map.values())` or `[...map.values()]`. TypeScript catches it at compile when types are known (a `[K, V][]` is not assignable to `V[]`), and unit tests over the converted output catch the silent tuple shape.

### BUG-SYNTAX-047 — Calling a non-function
- **Category:** Syntax Error · not-a-function
- **Description:** A value that is not a function is invoked — `handler()` where `handler` is a string from a config map, or `res.body.forEach(...)` where the body is an object. The runtime throws "TypeError: handler is not a function" naming the expression at the call site; the surrounding code path never executes.
- **Real-world example:** The not-a-function class is the classic "x.forEach is not a function" failure — an API returns an object or NodeList where an array was expected and the method call is the first throw. TypeScript catches it at compile when the type is known; the circular-import variant surfaces as "router.get is not a function" when a binding is undefined at load.

### BUG-SYNTAX-048 — Destructuring undefined from an unchecked API response
- **Category:** Syntax Error · destructuring-nullish
- **Description:** A response value is destructured (`const { user } = response`) without a guard, and `response` is `undefined` at runtime — commonly because a fetch wrapper returned `undefined` on its error path. The destructuring throws "TypeError: Cannot destructure property 'user' of 'undefined' as it is undefined" at the line.
- **Real-world example:** The unchecked-response class recurs where a wrapper returns `undefined` instead of throwing on failure — the first destructuring of the result is the throw. TypeScript's strict null checks catch it at compile when the return type is `T | undefined`; runtime schema validation (zod) is the other surface.

### BUG-SYNTAX-049 — Destructuring a nested missing field from an API response
- **Category:** Syntax Error · destructuring-nullish
- **Description:** A nested path is destructured (`const { profile: { email } } = user`) where the intermediate object (`profile`) is missing or undefined. Destructuring the inner field throws "TypeError: Cannot destructure property 'email' of 'undefined'" at the line even though the outer object exists.
- **Real-world example:** The nested-destructuring class recurs with optional API/GraphQL response shapes — the sanctioned fixes are default-destructuring (`{ profile: { email } = {} }`) or optional chaining before destructuring. TypeScript's strict null checks catch it at compile when the nested type is optional.

### BUG-SYNTAX-050 — Accessing a property on null with a guard that never dereferences
- **Category:** Syntax Error · property-on-null
- **Description:** A rate-limit check compared the whole limits object to null (`limits === null`) and never read its fields (`limits.remaining`), so the comparison never matched and the limiting branch never executed — abusive traffic was never limited. The underlying shape — a property read on a possibly-null object whose guard tests the container instead of the field — also throws "TypeError: Cannot read properties of null (reading 'x')" the moment the object is actually null and a field is read.
- **Real-world example:** The property-on-null class is a recognized silent-logic failure: the exception never fires because the wrong guard short-circuits, so the first signal is the missing enforcement, not an error. Unit tests asserting the limit branch executes, mutation testing, and runtime error monitoring are the detection surface.

### BUG-SYNTAX-051 — Missing await — a Promise passed where the resolved value is expected
- **Category:** Syntax Error · missing-await
- **Description:** An async function's return value is consumed without `await` (`const user = getUser(); if (user.id) ...`). The binding holds a Promise, every property read on it returns `undefined`, and the guarded logic silently no-ops — no exception is raised at the consumption site. An unhandled rejection can surface later from the ignored Promise.
- **Real-world example:** The missing-await class is the recognized way async results silently become `undefined` — the classic form is a helper awaited in one call site and forgotten in another, so the feature works in tests and no-ops in production. @typescript-eslint/no-misused-promises, no-floating-promises, and `Promise`-typed return annotations are the detection surface.

### BUG-SYNTAX-052 — Map keyed by object identity instead of value equality
- **Category:** Syntax Error · map-set-misuse
- **Description:** A Map uses objects as keys (`map.set(userObj, value)`) and is later read with a structurally-equal new object (`map.get({ id: userObj.id })`). Map keys compare by reference identity, so the new object is a different key and the lookup returns `undefined` with no exception.
- **Real-world example:** The Map-identity class recurs where framework re-renders or deserialization create fresh object instances per lookup — the sanctioned pattern is keying by a primitive (`map.set(user.id, value)`). Unit tests over the lookup path are the detection surface; TypeScript does not flag identity semantics.

### BUG-SYNTAX-053 — Set does not dedupe by value
- **Category:** Syntax Error · map-set-misuse
- **Description:** A Set is used to deduplicate objects (`new Set([{ id: 1 }, { id: 1 }])`), but Set membership compares by reference identity, so structurally-equal objects are distinct members and `.size` is 2. The code expecting value dedupe passes duplicates downstream with no exception.
- **Real-world example:** The Set-dedupe class recurs where API results are deduplicated by object — the sanctioned pattern is a Set of primitives (`new Set(items.map(i => i.id))`) or a Map keyed by the value. Unit tests asserting the deduped count are the detection surface.

### BUG-SYNTAX-054 — JSON.parse on empty input
- **Category:** Syntax Error · json-parse
- **Description:** `JSON.parse('')` is called on an empty string — commonly an empty cache file, an unset localStorage key, or a zero-byte response body. The parser throws "SyntaxError: Unexpected end of JSON input" at the call; module evaluation or the calling function aborts at that line.
- **Real-world example:** The empty-JSON class recurs where a cache read assumes the key was written — the first boot or a cleared storage hits the empty string. The sanctioned pattern is a length guard before parse; try/catch and the SyntaxError itself are the detection surface.

### BUG-SYNTAX-055 — JSON.parse on malformed input
- **Category:** Syntax Error · json-parse
- **Description:** `JSON.parse` is called on input that is not valid JSON — a truncated payload, a proxy's HTML error page, or a hand-written fixture. The parser throws "SyntaxError: Unexpected token" at the offending byte; with `res.json()` the rejection carries the same SyntaxError and the calling code path aborts.
- **Real-world example:** The malformed-JSON class is a recognized proxy-failure symptom — a gateway returns an HTML 502 page and the client's `res.json()` throws "Unexpected token '<', '<html>...' is not valid JSON". try/catch at the parse boundary and runtime error monitoring are the detection surface.

### BUG-SYNTAX-056 — JSON.parse on an already-parsed object
- **Category:** Syntax Error · json-parse
- **Description:** `JSON.parse(body)` is called where `body` is already an object (a framework or middleware already parsed it). The input is coerced to the string "[object Object]" and the parser throws "SyntaxError: Unexpected token 'o', \"[object Object]\" is not valid JSON" at the call.
- **Real-world example:** The double-parse class recurs in middleware chains where a body parser runs twice or a cached value is re-parsed on a second read path — the SyntaxError names "[object Object]", which identifies the coercion. Unit tests over the second read path are the detection surface.

### BUG-SYNTAX-057 — BigInt/Number arithmetic mixing
- **Category:** Syntax Error · bigint-mixing
- **Description:** A BigInt operand is mixed with a Number in arithmetic, e.g. `1n + 1`. The runtime throws "TypeError: Cannot mix BigInt and other types, use explicit conversions" at the expression and the computation aborts.
- **Real-world example:** The BigInt-mixing class recurs where a database driver or crypto library returns BigInt (token wei amounts, snowflake IDs) and the value flows into JS-number arithmetic — TypeScript catches it at compile ("Operator '+' cannot be applied to types 'bigint' and 'number'"), and explicit conversion (`Number(x)` or `BigInt(x)`) is the fix.

### BUG-SYNTAX-058 — Array.isArray misrouting array-like and typed-array values
- **Category:** Syntax Error · array-isarray
- **Description:** Code branches on `Array.isArray(value)` and sends the false path to object handling, but the value is an array-like (`{ length: 2, 0: 'a', 1: 'b' }`) or a typed array (`new Uint8Array(2)`) — both return `false` despite being iterable/indexable. The object path misreads the value (e.g. `Object.keys` on a typed array yields index strings) and the logic silently misroutes.
- **Real-world example:** The Array.isArray class recurs where a response parser branches between array and object handling — typed arrays from binary endpoints and array-likes from custom APIs land on the object path. Unit tests over both value shapes are the detection surface; TypeScript does not flag the semantic distinction.

### BUG-SYNTAX-059 — Prototype method calls on primitives
- **Category:** Syntax Error · prototype-primitive
- **Description:** A method is called on a value that is a primitive — `value.trim()` where `value` is a number or null, or `null.toString()`. Numbers and strings auto-box for their own prototype methods, but there is no boxing for null/undefined and no method from the wrong prototype: the runtime throws "TypeError: value.trim is not a function" or "TypeError: Cannot read properties of null (reading 'toString')".
- **Real-world example:** The primitive-method class recurs where an API returns a number where a string was expected (or vice versa) — the first string/number method call on the value is the throw. TypeScript catches it at compile when the type is known; runtime schema validation (zod) is the other surface.

### BUG-SYNTAX-060 — Array methods called on array-like objects without conversion
- **Category:** Syntax Error · array-like
- **Description:** An Array.prototype method is called directly on an array-like value — `arguments.slice(0)` inside a function, or `document.querySelectorAll('a').map(...)` on a NodeList. Array-likes have `length` and indices but lack most Array.prototype methods (NodeList has `forEach` but not `map`/`slice`), so the runtime throws "TypeError: arguments.slice is not a function" at the call.
- **Real-world example:** The array-like class recurs with `arguments`, NodeList, and custom collection objects — the sanctioned fix is `Array.from(x)` or spreading into an array literal before the method call. Unit tests over the collection path and the runtime TypeError are the detection surface.

### BUG-SYNTAX-061 — for...of over a plain object
- **Category:** Syntax Error · for-of-iterable
- **Description:** A `for (const v of obj)` loop iterates a plain object, which lacks `[Symbol.iterator]`. The runtime throws "TypeError: obj is not iterable (cannot read property Symbol(Symbol.iterator))" at the loop head; TypeScript catches it at compile with the identical "[Symbol.iterator]()' method" requirement.
- **Real-world example:** The for-of class recurs where a config or record object is iterated as if it were a Map or array — the sanctioned patterns are `Object.entries(obj)`/`Object.values(obj)` or storing the data in a Map. Unit tests over the iteration path are the detection surface.

### BUG-SYNTAX-062 — `export` statement in a CommonJS/legacy script
- **Category:** Syntax Error · module-syntax
- **Description:** An ESM `export const x = 1` appears in a file loaded as CommonJS — a `.cjs` file, a `.js` file in a package without `"type": "module"`, or a non-module `<script>`. The CommonJS parser rejects the token at parse time: "SyntaxError: Unexpected token 'export'"; the whole file fails to load.
- **Real-world example:** The export-in-CJS class recurs when a file is migrated to ESM syntax without flipping the package's `"type"` field or renaming to `.mjs` — Node's runtime SyntaxError names the token, and the fix is aligning the file's module system with its loader.

### BUG-SYNTAX-063 — `require()` in an ES module
- **Category:** Syntax Error · module-syntax
- **Description:** `const x = require('./mod')` appears in an ES module (a `.mjs` file or a `.js` file with `"type": "module"`). Native ESM has no `require`, so the runtime throws "ReferenceError: require is not defined" at the call; bundlers and Babel shim `require`, so the failure only appears when the loader's module system is actually ESM.
- **Real-world example:** The require-in-ESM class recurs when a codebase migrates to `"type": "module"` — code that worked under bundler shims throws at first execution in Node-native ESM. The sanctioned fix is `import` or `createRequire`; ESLint's import/no-commonjs flags the pattern.

### BUG-SYNTAX-064 — Load-time parse failure propagating through an ESM import graph
- **Category:** Syntax Error · module-syntax
- **Description:** A syntax error inside an imported module surfaces at import time in the consuming module: the loader parses the dependency during module resolution, the parse error propagates as the importing file's failure, and the entire import graph from that edge never evaluates. The reported error points at the dependency's original syntax fault, not at the importer.
- **Real-world example:** The load-time-parse class recurs when one file in a barrel or shared module contains TS-only or truncated syntax — every importer fails at build or first load with the same underlying error. Bundler builds and test runners surface it at the first import edge; import tracing identifies the shared file.

### BUG-SYNTAX-065 — JSON.stringify on a circular structure
- **Category:** Syntax Error · json-circular
- **Description:** `JSON.stringify(obj)` is called on a structure that references itself — a class instance holding a parent pointer, a DOM node, or two objects referencing each other. The serializer throws "TypeError: Converting circular structure to JSON" at the call and the calling code path aborts at that line.
- **Real-world example:** The circular-serialize class recurs where runtime objects (request contexts, class instances with back-references) are serialized for logging or caching — the sanctioned fixes are a cycle-safe serializer (safe-stable-stringify) or `util.inspect` for logs. try/catch at the serialization boundary and the TypeError itself are the detection surface.
