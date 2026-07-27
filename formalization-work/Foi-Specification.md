# Foi Semantic Specification

**Version:** draft (design phase)
**Status:** In Progress

This document is the specification for the Foi language. It backs `Foi-Guide.md` (user-facing tutorial) and incorporates the grammar files: `Lexical-Grammar.md` (token-level grammar) and `Syntactic-Grammar.md` (production-level grammar). Here is described **how Foi programs behave** at the level of an abstract machine: evaluation order, scope rules, frame contents, lookup semantics, and the operational meaning of each construct.

---

## §0 Preliminaries

### §0.1 Abstract machine register

A Foi program is described as evaluation against an abstract machine. The machine is built from a small number of structures:

A **value** is anything a Foi expression evaluates to. The value categories are:

- **Primitives:** `empty`, booleans (`true`, `false`), numbers (integers and floats), strings.
- **Records** and **Tuples**: the two forms of composite value (§1).
- **Functions:** first-class function values, including anonymous forms.
- **Namespace instances:** values constructed via a namespace's `@`-marked constructor, carrying that namespace as their identity for hook dispatch (§3.10.9). Includes stdlib monadic instances (`Id`, `Maybe`, `Left`, `Right`, `Either`, `Promise`, `IO`, `Channel`, `PushStream`, `PullStream`), iterator instances (`Iter`), and user-declared namespace instances.
- **Effect kinds:** `Effect.`-prefixed names declared via `deft` (§6.1). An effect kind is a namespace-shaped value that participates in perform-site dispatch (§6.2) and handler-scope narrowing (§6.3.1).
- **Perform-event objects:** the value bound to a handler arm's head parameter (`eff` in `Effect.Ask ~<* (eff:: comp) { .. }`), carrying the performed effect's kind and payload (§6.3.2).
- **Sentinels:** `Done@` (§6.4) and other marker-application values whose behavior arises at consumer sites that inspect for them.
- **Suspended computations, userland-visible:** `Lazy@`-produced thunks (§2.2), carrying deferred evaluation of an expression with a scope-locality discipline. Thunks flow through record fields, tuple slots, closure captures, and call arguments like any other value; they resolve at end-of-section per §2.2.5.
- **Suspended computations, internal:** the intermediate representations used by generator reification (§6.6) and effect handling (§6.1). Not directly surfaced as userland values.

Values are immutable at the language level; the only mutability in Foi is reassignment of the binding slots that hold values.

A **slot** is a mutable cell holding a value. Slots exist so that reassignment (`:=`) has somewhere to write. Each binding introduces a slot.

**Slot sharing.** Slots are per-binding, not per-value. Two names bound to the same value hold two distinct slots; mutating one does not affect the other. Closures capture slots, not values: a nested function that references an outer binding shares the slot with the outer scope, which is how `:over`-declared closure mutation (§3) makes an outer-scope reassignment visible to the closure and vice versa. Destructure-into-name (§2.13) introduces fresh slots holding copies of the extracted values; the destructure source's slots are not shared.

A **frame** is a mapping from names to slots, plus a link to a parent frame. Frames form a chain along the lexical scope hierarchy. Looking up a name (Syntactic-Grammar `IdentifierRef`) walks the chain from innermost frame outward until the name resolves; if no frame holds the name, the program is ill-formed.

**Frame-creating constructs.** A fresh frame is created on entry to: a function call body, a block-defs clause's block body (via `::`), a match-arm consequent block, a guard-consequent block, an effect-handler-arm block body, and a comprehension iteration body. Nested blocks under any of the above create nested frames. Bare-expression positions and function-body statements not enclosed by a nested block do not create frames on their own; they evaluate in the enclosing frame.

An **environment** at a point in execution is the current innermost frame; via its parent links it implicitly references the full chain. Every expression evaluates in some environment.

A **call stack** is a stack of **call frames**, one per active function invocation. Each call frame carries: an environment (per above), the function being executed, the arguments bound at call entry, and a link to the caller's call frame. A function call pushes a new call frame; a function return pops it. Universal proper tail calls (§3.4) is the discipline under which a call at a tail position replaces the current call frame rather than pushing a new one.

A **handler chain** is a chain of **handler-scope frames**, one per active effect-handler scope established by a `~<*` invocation (§6.3). Each handler-scope frame carries: a caught-set (the effect-kind narrowing per §6.3.1), an arm dispatch table (per §6.3.2), the call frame in which the `~<*` was invoked, and a link to the next outer handler-scope frame. Entering a `~<*` scope pushes a handler-scope frame; exiting -- whether by natural completion, by an arm returning `Done@` (§6.4.1), or by an uncaught effect propagating past -- pops it. When a perform site executes (§6.2), the runtime walks the handler chain from innermost outward looking for the first handler-scope frame whose caught-set includes the performed effect's kind (§6.1.2); this walk is orthogonal to but temporally interleaved with the call stack.

### §0.2 Notation

Where this document describes the abstract execution of a construct, it does so as numbered steps. Steps are sequential unless explicitly stated otherwise. The notation is informal pseudocode and does not commit to a specific interpreter representation.

When the spec needs to refer to fresh internal names (temporaries the interpreter must allocate but the user cannot see), it uses the prefix `__`; e.g., `__t0`, `__src`. These names are illustrative; an interpreter is free to use different mechanisms (registers, SSA names, anonymous slots) as long as the observable behavior matches.

When this document shows a JS lowering, it reflects what the bootstrap transpiler emits. JS lowerings are illustrative of the operational meaning but are not normative: a future native interpreter is free to implement the same semantics differently.

**Foi code examples are illustrative; the prose that accompanies an example is normative.** A code example demonstrates a behavior; the prose (or numbered abstract-execution steps) stating that behavior is what the spec commits to. Where an example shows a result via inline comment (`// Right{25}`, `// Left{"Complete"}`), the result reflects what the accompanying prose specifies. If a behavior is demonstrated only by an example and not stated in prose, that is a spec gap, not a settled point.

### §0.3 Conventions for open territory

A region of the spec is **settled** when its operational behavior is fixed by the language design as stated in this document. The bootstrap transpiler and its oracle suites are useful evidence of design-behavior alignment during the design phase but are not themselves part of the settled definition; the spec is the authoritative record.

A region is **open** when at least one of the following holds: the design has multiple candidate semantics under active consideration; the construct depends on a yet-to-be-decided cross-cutting feature (type-system lifecycle, module semantics, or hook-dispatch runtime-table finalization per §3.10.9).

Open regions appear inline under an **Open** heading within the relevant section.

### §0.4 Document scope

Sections are organized by semantic category, not by grammar production. Current TOC:

- §1 Values *(done)*
- §2 Bindings & Data Access *(done)*
- §3 Functions *(done)*
- §4 Decisions and Guards *(done)*
- §5 Pattern Matching *(done)*
- §6 Suspension and Evaluation Control *(done)*
- §7 Loops and Comprehensions *(done)*
- §8 Modules *(planned)*
- §9 Type system *(planned)*

---

## §1 Values

This section catalogues the value categories a Foi program manipulates. It specifies their literal forms and construction semantics -- what an expression produces -- without yet describing what binds those values or how they are accessed (§2 covers both).

### §1.1 The `empty` value

`empty` (Lexical-Grammar `EmptyLit`) is a first-class value denoting "no value." It is a reserved keyword; it cannot be used as a binding name, parameter name, record field name, or any other identifier site.

```java
def age: empty;         // age's slot holds the empty value
empty;                  // the empty value
log(empty);             // doesn't print anything
```

`empty` is Foi's bottom value: it is what a Foi program produces wherever a value is needed and no other value has been specified. It can be assigned explicitly, and it is the value implicit contexts fall back to. Non-exhaustive examples of contexts that produce `empty`:

- A failed guard expression (§4).
- A function parameter (with no default value) whose call omits an argument at that position.
- An implicit initializer at a defs-init clause without an explicit value (§2.9.2).
- Property reads against a missing slot (§2.12), including any intermediate missing slot along an access path.
- A destructure entry (§2.13) whose source slot is missing and which carries no `:? default`.
- The value of a `~<*` handler expression that exits via a `Done@`-returning arm (§6.4.1) or by an effect propagating past uncaught (§6.3.3).

### §1.2 Booleans

`true` and `false` (Lexical-Grammar `BooleanLit`) are reserved keywords denoting the two boolean values. All decision making forms (guards, pattern matching, etc) expect these boolean values.

```java
def str: "Hello";
def num: 0;

?[!empty str]: log(str);    // allowed
?[str != ""]: log(str);     // allowed
?[num ?> 0]: log(num);      // allowed
```

No implicit coercion exists, at the language level, from any other value type to boolean. Coercion must be explicit.

```java
?[str ?as bool]: log(str);  // allowed
?[num ?as bool]: log(num);  // allowed

?[str]: log(str);           // disallowed
?[num]: log(num);           // disallowed
```

Explicit boolean coercion from other value types is available via the unary `?` and `!` operators (§3.9): `?x` produces the boolean coercion of `x`; `!x` produces its negation (or predicate inversion in the case of function values). These are the only routes from a non-boolean value to a boolean, and they must be written explicitly.

### §1.3 Numbers

Foi numeric literals (Lexical-Grammar `NumberLit`) cover integers (`42`, `-3`) and decimals (`3.14`, `-0.001`). They may also be expressed in typed radixes: octal (`\o755`, `\o-755`), hexadecimal (`\hA3`, `\h-ff`), and binary (`\b01011101`, `\b-1100`). All typed-radix forms admit an optional leading sign inside the escape body.

**Negative zero.** Foi preserves IEEE-754 negative zero as a value distinct from positive zero. `0 / -3` produces `-0`; `0 ?= -0` is `false`. Structural equality treats `0` and `-0` as unequal; arithmetic identities that produce `-0` in IEEE-754 produce `-0` in Foi.

Numeric literals may also carry underscore separators for readability, but only via an explicit `\` escape:

- `\5_000`: separator-bearing positive integer
- `\-1_000`: separator-bearing signed integer
- `\100_000.25`: separator-bearing decimal

Bare top-level integers and decimals do not admit separators; `100_000` written without the leading `\` is not a numeric literal.

A further escape form `\@<digits>` (hex-digit alphabet, with optional sign, separators, and fractional part; e.g. `\@FFFF`, `\@-FF_FF.AA`) is the **monadic** numeric literal. Unlike the other escape forms, this does not construct a primitive number; it constructs a monadic-wrapped numeric value, conceptually arbitrary-precision. The bootstrap stubs this form; full semantics are deferred to the monad story.

Arithmetic operations (`+`, `/`, etc) produce numeric values.

**Open:** the precise numeric tower -- distinct integer/float types vs. unified Number, arbitrary-precision integers, rational extensions, and the exact runtime contract of `\@`-monadic literals -- is not yet settled. The bootstrap inherits JS's unified number type.

### §1.4 Strings

Foi strings have two major characteristics that define their various forms: interpolation (or not) and whitespace preserving (or collapsing). The four combinations correspond to four lexical productions: `PlainStr`, `InterpStr`, and their space-collapsing counterparts (Lexical-Grammar; §1.4.3 covers the space-collapsing forms).

For the first characteristic:

```java
def plain: "hello world";           // "hello world"
def interp: `"hello `name`!";       // "hello Kyle"
```

A plain string (`PlainStr`) has no special content parsing. It's delimited on either end by `"` double-quote characters.

An interpolated string (`InterpStr`; structured interleaving of values) parses the content to replace delimited expressions with their evaluated values. This literal form opens with backtick+quote `` `" ``, closes with a bare quote `"`, and embeds interpolated expressions in the string contents delimited by pairs of backticks (`` `expr` ``).

**Abstract execution of an interpolated string:**

1. For each segment, in source order:
    1. If the segment is literal text, append it to the result.
    2. If the segment is an interpolated expression, evaluate it in the current environment and append the result as a string.
2. The completed string is the value of the literal.

**Open:** the coercion rule for non-string values embedded in interpolations is not yet locked. The bootstrap relies on JS's stringification, which carries the same footgun as §2.12.4's computed-key issue.

#### §1.4.1 Delimiter Escaping

If a string (either type) includes a sequence of two adjacent `"` characters (`""`), this is escaped as a single raw `"` value inside the string, rather than the end delimiter of the string literal:

```java
"My favorite word is ""yes""!";
// My favorite word is "yes"!
```

In interpolated strings, a double ``` `` ``` backtick is escaped as a single raw `` ` `` inside the string, rather than an empty interpolated expression:

```java
`"In `langName`, an interpolated string is prefixed with a single `` character."
// In Foi, an interpolated string is prefixed with a single ` character.
```

#### §1.4.2 Unicode Escape Sequences

To include a Unicode escape sequence (one or more characters), an interpolated string expression can contain a single `\u..` expression:

```java
`"Hello `\u263A`!";
// Hello ☺!
```

After the `\u`, any number of hexadecimal digits specify the codepoint of the Unicode character. `\u263a` (`"☺"` smiley face) is the character at codepoint `263a` (hexadecimal), which is 9786 in decimal base-10.

Unicode's code-point range is currently `\u0000` to `\u10FFFF` (six hexadecimal digits). Foi does not limit how many digits you can specify at the lexical level, but a value not recognized by Unicode, or outside this range, is ill-formed and rejected at parse. The digits are static in the source (the `\u` escape does not admit computed expressions), so the check is decidable without evaluation.

Foi does not accept typical escape sequences like `\n`, `\r`, and `\t`. Their equivalents can be specified with Unicode though:

```java
`"This continues`\uA`on a new line";
// This continues
// on a new line

`"Here's a `\u8` tab";
// Here's a      tab
```

**NOTE:** The `\u..` escape sequence is *only* valid as the sole expression in an interpolated string literal expression slot; it **cannot** appear standalone in other expression positions throughout the language.

#### §1.4.3 Space-Collapsing Escaped Strings

The second characteristic of Foi strings is whether they preserve space or collapse it (similar to how HTML whitespace collapse works).

Strings (plain or interpolated) can span multiple lines. By default, all whitespace (including the inherent newlines/carriage-returns when spanning lines of code) are *preserved* in the string contents.

Prefixing the string literal (plain or interpolated) with `\` causes all contiguous sequences of any recognized whitespace *in the resolved, post-computed string contents* to instead collapse to a single `" "` space:

```java
\"This
    is a string

  with lots of    whitespace";
// This is a string with lots of whitespace

\`"In `langName`, interpolation
    and space-collapse escaping are
combined  `\u8`
        like this.";
// In Foi, interpolation and space-collapse escaping are combined like this.
```

**NOTE:** Whitespace collapsing spans both string literal and interpolated expressions (after evaluation). In the above example, the `` `\u8` `` (interpolated tab character via Unicode escape sequence), together with surrounding literal whitespace, is collapsed to a single `" "`.

#### §1.4.4 Nested Interpolation

Nesting interpolated string literals inside other interpolated expressions is not common, but it can be necessary in some circumstances.

Consider this (broken) example:

```java
`"My current book: `uppercase(`"*`title`* by `author`")`.";
// throws parser error at the ` to the right of the (
```

The `` `" `` at the start of the first argument to the `uppercase(..)` call is ambiguous grammatically; it could be delimiting the end of the expression (albeit an invalid expression) and then the end of the string literal itself, or it could be starting a nested interpolated string literal as the function-call argument.

To avoid such ambiguity, `InterpStr`'s slot production (Lexical-Grammar) rejects a bare `` `" `` opener inside an interpolated expression slot; the space-collapsing opener `` \`" `` is admitted since it is unambiguous.

By contrast, `` \`" `` is unambiguously the beginning of an interpolated (and space-collapsing escaped) string literal; so that's the form nested interpolated strings must take:

```java
`"My current book: `uppercase(\`"*`title`* by `author`")`.";
// My current book: *1984* BY GEORGE ORWELL.
```

The only other option is to lift the inner interpolated string literal out to its own variable, and interpolate that variable instead:

```java
def bookTitle: `"*`title`* by `author`";
`"My current book: `uppercase(bookTitle)`.";
// My current book: *1984* BY GEORGE ORWELL.
```

### §1.5 Structured Values: Tuples and Records

Foi has two structured value categories -- Tuples and Records -- that share a single literal syntax (Syntactic-Grammar `RecordTupleLit`). The form is an angle-bracketed comma-separated list of entries:

```java
< entry, entry, ..., entry >
```

Each entry is either:

- A **positional entry**: a bare expression with no name.
- A **named entry**: explicit `name: expr`, concise `:name`, or computed `%expr: value`.
- A **spread entry**: `&src`, lifting entries from `src` into this structure. Also, `&` spread entries support a subset of the "pick" syntax, such as `&src.[1..3]` and `&src.<x,y>`.

#### §1.5.1 Tuple/Record Literal Construction

Tuple/Record literals are constructed (recursively, if necessary) by the `DefineStructure()` algorithm.

----

The `DefineStructure(structure)` steps are:

1. Let `[entries, _, hasKeyed]` be the result of `GetEntries(structure,0)`

2. If `Length(entries)` is `0`: return the result of `AllocateStructure("Empty")`

3. If `hasKeyed` is `true`: return the result of `AllocateStructure("Record",entries)`

4. Return the result of `AllocateStructure("Tuple",entries)`

----

The `GetEntries(structure,startIndex)` algorithm are:

1. Let `entries` be an empty list

2. Let `i` be `startIndex`

3. Let `hasKeyed` be `false`

4. For each entry `e` in the `structure`:

    - If `isNull(e.key)`: let `key` be `i`; let `value` be `ResolveStructureValue(e)`; let `i` be `i + 1`

    - If `isComputed(e.key)`: let `key` be the result of `computeKey(e.key)`; let `value` be the result of `ResolveStructureValue(e.value)`

    - If `isSpread(e.value)`:

        * If `HasPick(e.value)`: let `spreadValue` be the result of `ComputePick(ResolveStructureValue(e.value))`

        * Otherwise: let `spreadValue` be `ResolveStructureValue(e.value)`

        * Let `[spreadEntries, spreadNextIndex, spreadHasKeyed]` be the result of `GetEntries(spreadValue,i)`

        * Let `entries` be the concatenation of `entries` and `spreadEntries`

        * Let `i` be `spreadNextIndex`

        * Let `hasKeyed` be `hasKeyed or spreadHasKeyed`

        * Continue (4)

    - If `isConcise(e)`: let `key` be `e.name`; let `value` be the result of `ResolveStructureValue(e.value)`

    - Otherwise: let `key` be `e.key`; let `value` be `ResolveStructureValue(e.value)`

    - If `key` is not a positive integer: let `hasKeyed` be `true`

    - Append `[ key, value ]` to `entries`

5. Return `[entries, i, hasKeyed]`

----

The `ResolveStructureValue(value)` steps are:

1. If `IsStructure(value)`: return the result of `DefineStructure(value)`

2. Return `value`

----

`AllocateStructure("Record", entries)` reduces the entries list to a Record value applying rightmost-wins deduplication on colliding named keys per §1.5.3: each named key retains the value of its last-appearing entry in the input list, and positional keys are preserved by their integer identity. `AllocateStructure("Tuple", entries)` retains all entries in input order without deduplication.

#### §1.5.2 Tuple-Form Literals

When non-keyed entries are the only entries in a structure, it's interpreted as a Tuple:

```java
def coords: < 10, 20 >;
def empties: < empty, empty, empty >;
def nested: < < 1, 2 >, < 3, 4 > >;
def single: < 42 >;
```

Commas delimit entry positions. A position with no explicit entry -- between two commas, between `<` and the first comma, or between the last comma and `>` -- holds `empty`. A single terminating comma immediately before `>` is a permissive terminator and does not open an additional position; a second (or subsequent) trailing comma each opens an `empty` position. This rule applies uniformly at both Tuple-form and Record-form literals.

```java
< , 1, 2 >;         // < empty, 1, 2 >
< 1, , 2 >;         // < 1, empty, 2 >
< 1, 2, >;          // < 1, 2 >
< 1, 2, , >;        // < 1, 2, empty >
```

The comma rules here are applied irrespective of trivia (whitespace, comments, etc).

#### §1.5.3 Record-Form Literals

If there are any entries with non-positive-integer keys present, the structure is interpreted as a Record. Positional and positive-integer-keyed entries in an otherwise Record retain their integer-index identity (as in Tuples).

```java
def point: < x: 10, y: 20 >;
def order: < id: 123, items: < < price: 29.97 > > >;
```

**Entry forms** for named entries:

- `name: expr`: explicit name, explicit value.
- `:name`: concise form. The entry name is `name` (a string), and its value is the result of evaluating the identifier `name` in the current environment (i.e., `<:name>` is shorthand for `<name: name>`). To name an entry from a chained source, use `&` spread instead: `<&name.path>` (see §1.5.4).
- `%expr: value`: computed entry key (evaluating `expr`). If `expr` evaluates to a positive integer, the entry occupies that positional slot without forcing Record type; any other key value forces Record type.

Records are **unordered** by name: the result Record exposes its entries by name, not by source position. Named-entry source order is irrelevant for value identity (two Records with the same name→value pairs in different source orders are equal). Positional entries within a Record do retain their integer-index identity (a `0` entry is the same slot regardless of source position).

Later entries with a name colliding with an earlier entry **replace** the earlier entry's value. The final Record reflects the rightmost binding for each name.

#### §1.5.4 Spread Entries

A spread entry `&src` lifts entries from `src` into the enclosing structure. The source admits the full set of pick forms:

```java
< &other >;         // spread all of other's entries
< &rec.x >;         // pick only rec.x
< &rec.<a, b> >;    // pick rec.a and rec.b
< &rec.[0..3] >;    // pick rec's four indexed positions (0-3, inclusive)
< 10, &more, 20 >;  // spread interleaved positionally
```

**NOTE:** Spread's effect on the enclosing structure's type follows §1.5.1: spreading a Record's named entries forces the enclosing structure to be a Record; spreading only positional content into an otherwise-positional structure preserves Tuple type.

#### §1.5.5 The Empty Angle-Bracket Form

`< >` is a single literal whose value is the empty structured value. It is typed as **both Record and Tuple**: it satisfies any type slot that admits either, and it admits both pick forms (`.< .. >` and `.[ .. ]`), though such picks are moot on an empty structure.

When spread into another structure, `< >` contributes nothing regardless of the enclosing context's type. The empty Record and empty Tuple are the same value at the literal level; the type system does not need to disambiguate at the empty case.

**Open:** whether `< >`'s polymorphism is internally represented as a union type, a structural any-of-either, or a single distinguished empty value is a type-system question (§9). The operational semantic -- admits both pick forms, behaves correctly under either spread -- is settled.

### §1.6 Functions As Values

A function is a value. Function literals are introduced with the `defn` keyword:

```java
// named function declaration (binding form);
// `add` is in enclosing scope
defn add(x, y) ^ x + y;

// named function expression; `add2` is in
// enclosing scope; `add` is only in the
// function's own scope for self-reference
def add2: defn add(x,y) ^ x + y;

// anonymous function expression, `add3` is
// in enclosing scope, no self-reference name
// in function scope
def add3: defn(x, y) ^ x + y;
```

In the declaration form, `defn` is a binding statement (§2.8); the required bound name is `add`.

Function expressions can *optionally* have a name, and it's bound to the function's own scope only (for self-reference, such as recursion).

In the anonymous form, `defn(params) ^body` is an expression producing a function value, with no name binding in any scope.

Function values are first-class: they may be stored in slots, passed as arguments, returned from other functions, and embedded in Records and Tuples. A function value carries the environment in which it was created (its closure); call-time semantics are specified in §2.11. The full surface area of function definition forms -- parameter modifiers, defaults, preconditions, named arguments, operator-as-function, curry/uncurry -- is specified in §3.

### §1.7 Other Value Categories

§0.1 catalogues the full value universe. The non-primitive categories Foi programs manipulate -- namespace instances (`Id`, `None`, `Maybe`, `Either`, `List`, `Promise`, `IO`, `Iter`, `Channel`, `PushStream`, `PullStream`, and user-declared namespaces), effect kinds (`Effect.`-prefixed), perform-event objects, sentinels (`Done@`), and userland-visible suspended computations (`Lazy@` thunks) -- are enumerated there.

Their construction, extraction, and operations are specified in later sections:

- Bindings, forward references, and thunk lifecycle: §2 (including `Lazy@` in §2.2).
- Suspension, effects, generators, and pause-able types: §6.
- `Done@` sentinel and comprehension lifecycle: §6.4 and §7.
- Monadic-value constructors and the runtime contract for hook dispatch: §3.10.9 and §7.

For §2's purposes it suffices that all of these are values: they can be stored in slots, bound to names, picked from Records, and passed around like any other value.

## §2 Bindings & Data Access

This section specifies how names come into existence, how they are reassigned, how blocks introduce nested scopes, how function values capture their environment, and how Record and Tuple contents are accessed via picks and destructured into bindings.

### §2.1 The `def` Statement

A `def` statement (Syntactic-Grammar `DefVarStmt`) introduces a new name in the current frame, allocates a slot for it, and initializes the slot with a value:

```java
def age: 42;
```

**Abstract execution:**

1. Allocate a fresh slot in the current frame, associated with the name `age`.
2. Evaluate the initializer expression `42` in the current environment.
3. Store the resulting value into the slot.

A `def` slot persists for the lifetime of its frame. When the frame is exited, the slot is no longer reachable except via closures captured before exit (§2.11).

#### §2.1.1 `def` Placement: Top Of Scope

`def` statements must appear at the top of their scope. Specifically: within any scope (module, function body, or block), `def` statements must precede all other statements except other definitional forms (`defn`, `deft`) which may interleave freely with `def` at the top.

This contiguous top-of-scope run of definitional statements is the scope's **`def` section**. §2.2's `Lazy@` resolution operates within this region; references to "the section" throughout §2.2 refer to it.

**Do-comprehension blocks are exempt.** Inside a `~<<` or `~<*` block (§7), each statement conceptually acts as its own `~<` chain step, and thus its own scope (nested in the scope ahead of it). As such, single-colon `def x: expr` statements may appear anywhere; they introduce a local binding but do not participate in the block's monadic composition. §7 specifies do-block statement categories and placement rules in full.

```java
def x: 1;
def y: 2;
defn helper(v) ^v + 1;
log(x + y);                 // first non-definitional statement
helper(10);
def z: 99;                  // ill-formed: def below a non-def statement
```

**Rationale:** `def` bindings allow reassignment via `:=` (§2.4); whether any given `def` is actually reassigned is determined by lexical inspection of its scope (§2.3). Constraining `def` to the top of the scope makes the linear top-to-bottom reading of a scope tractable: every potentially-reassigned name is introduced at the top, and the body of the scope is a sequence of statements that may read or reassign them. There is no risk of a binding being introduced mid-body and changing what subsequent reads of the same name resolve to.

`defn` does not share this constraint; see §2.5.

#### §2.1.2 Required Initializer

A `def` statement, in any scope's statement position, requires an initializer expression:

```java
def x: 42;                  // ok
def x;                      // ill-formed
def x: empty;               // ok; explicit `empty` initializer
```

The escape hatch is `empty`: when no useful initial value is available, the binding is initialized to `empty` explicitly.

A different rule applies inside a defs-init clause: see §2.9.2.

#### §2.1.3 `def` Statement Completion Value

A statement completion value is the equivalent of an expression result; indeed, a standalone expression-as-statement has a completion value equal to the expression value itself.

The `def` statement completion value is the final resolved value that is assigned to the slot.

```java
def x: 1 + 3;       // statement completion value: 4
```

Syntactically, statements like `def` cannot necessarily be used in expression positions. However, block expressions *implicitly* adopt the final statement's completion value; a `def` statement in the final position exposes its assigned value as its completion value, and thus the same value is adopted as the block expression result.

Consider this degenerate, uncommon example:

```java
def x: {
    def y: 42;
};
```

You'd rarely have a block with only `def` statement(s) in it and no evaluated statements/expressions below them. But in this example, the `def y: 42` statement has `42` as a completion value, and that same `42` value is adopted by the `{ }` block expression per §2.9.1's block-completion rule. Then, the same `42` value is assigned to `x`. Finally, this also means the completion value of `def x: ..` is also `42`.

**Do-comprehension exception.** Inside a `~<<` or `~<*` block (§7), a single-colon `def x: expr` statement is a local binding whose completion value does not participate in the block's monadic composition; it is neither `~<`-chained nor collected as a terminal value. To bind a name to a monadic step's unwrapped result, use the double-colon form `def x:: expr` instead. See §7 for the do-block's statement categories in full.

### §2.2 The `Lazy@` Construct

A `Lazy@` expression (Syntactic-Grammar `AtCallExpr` against the `Lazy` name, with compile-time-privileged semantics) defers the resolution of one or more identifier references until those identifiers have been bound in the current scope's `def` section.

```java
def life: <
    meaning: defn(x, y) ^x + y,
    answer: Lazy@ life.meaning(2, 40)
>;
```

The field `answer` references `life`, the very binding being constructed. At the point `answer`'s initializer is evaluated, `life` does not yet hold a value; the record literal is mid-construction. `Lazy@` makes the reference legal and defers its resolution until the binding completes.

Formally speaking, `Lazy@` is intended for forward-reference without requiring manual source-reordering (which in some cases, as above, is not even sufficient).

So the above example, deconstructed into two `def`s, illustrates the lazy-forward-reference semantic:

```java
def answer: Lazy@ life.meaning(2, 40);
def life: <
    meaning: defn(x, y) ^x + y,
>;
```

At the moment `answer` is being defined, `life` has not yet been defined. Instead of re-ordering to define `life` before `answer`, `Lazy@` allows this lazily-resolved forward reference containing expression.

#### §2.2.1 Motivation

Immutable records cannot be modified after construction. A record field that references the record itself, another field of the same record, or a sibling binding defined later in the same `def` statement(s) section, cannot be written directly:

```java
def life: <
    meaning: defn(x, y) ^x + y,
    answer: life.meaning(2, 40)    // `life` not yet bound
>;
```

Without `Lazy@`, the only alternative is to construct an incomplete record first and reassign the binding to a corrected version:

```java
def life: <
    meaning: defn(x, y) ^x + y
>;
life := <
    &life,
    answer: life.meaning(2, 40)
>;
```

This pattern produces an intermediate record that exists only as a scaffold for the corrected version. Beyond the wasted construction, the `:=` introduces consequences that the program did not actually intend: the binding becomes reassignable, any enclosing function must declare `:over (life)` (§3.6) to acknowledge the non-constancy, and local reasoning about `life` weakens because the name now refers to different values at different points in the scope. None of these costs reflect the program's intent, which was to construct a single value with a self-referential field.

`Lazy@` expresses the construction directly. The binding is defined exactly once, no intermediate value is produced, no reassignability is implied, and no `:over` annotation is required. The construct exists so that ordinary self-referential and mutually-referential value construction does not require mutability-flavored workarounds.

#### §2.2.2 Abstract Execution

A `Lazy@ expr` construct is evaluated against the binding state of the enclosing scope at the moment of construction.

1. Identify the free identifiers in `expr`: those names that are referenced but not bound by `expr` itself.

2. For each free identifier, attempt resolution in this order:
    - If the identifier is already bound in the directly enclosing scope (i.e., an earlier `def` in the same section, or a hoisted `defn`/`deft`), substitute its value into the residual expression (constant folding).
    - Otherwise, if the identifier appears as a later `def` in the same section, register a listener on the section. The listener fires at the moment that `def` is reached, contributing the new binding's value to the residual expression.
    - Otherwise, resolve via ordinary lexical lookup against outer scopes. A successful lookup substitutes the value as constant folding. A lookup that finds no binding anywhere is reported as an unresolved forward reference (§2.2.8).

3. If, after step 2, no free identifiers remain unresolved, the residual expression is fully constant and reduces to its value. The `Lazy@` construct produces this value with no runtime artifact.

4. If unresolved identifiers remain, a thunk is produced: a runtime value that holds the residual expression and the set of pending identifiers. The thunk participates in further evaluation as described in §2.2.3 and §2.2.4.

The construct's completion value, in cases where the residual fully resolves at construction, is the value of the residual expression. In cases where unresolved identifiers remain, the completion value is the thunk; the thunk's eventual resolved value becomes observable to the rest of the program through the mechanisms described below.

#### §2.2.3 Carry and Force

A thunk produced by `Lazy@` is a first-class value. It may flow through expressions, into containers, and through function calls, on the same terms as any other value. Operations on the thunk divide into two classes:

**Structural operations** move the thunk into a position without inspecting its value. Placing a thunk in a record field, in a tuple slot, or as a function-call argument falls in this class. A structural operation receives a thunk and produces a value that holds the thunk in some position. The thunk's reference cell is shared with all such positions; resolution of the cell is visible at every position simultaneously.

**Consuming operations** read into the thunk's value. Arithmetic, comparison, logical operators, conditional tests, pattern matches against value patterns, computed record keys, spread (`&thunk`), pick (`thunk.name`), slice (`thunk.[a..b]`), destructure-and-rebind against a thunk source, and explicit `%` forcing all fall in this class. A consuming operation requires the thunk's resolved value at the moment of the operation. If the thunk is resolved, the value is read cheaply. If the thunk is unresolved, the consuming operation cannot complete; instead, the surrounding initializer's evaluation is itself deferred, and the binding being defined adopts a derived thunk pending on the same identifiers.

The class of an operation is determined by the operation, not by user annotation. The user writes ordinary expressions; the language carries thunks through positions that store them and forces them at positions that read them. The distinction is invisible to the program text and consistent with the natural reading of each operation.

#### §2.2.4 Propagation and Deferral Through the Section

Within a `def` statement(s) section, a consuming operation that encounters an unresolved thunk does not immediately fail. The operation cannot complete, but the section may still introduce a `def` that resolves the pending identifier(s). The surrounding initializer's evaluation defers, and the binding being defined adopts a derived thunk whose pending set is the transitive closure of the original thunk's pending identifiers.

1. The deferred initializer is recorded with the residual expression and its pending identifiers.
2. Listeners are registered on the section for each pending identifier.
3. As each pending identifier's `def` is reached, its listener fires; the pending set shrinks.
4. When the pending set is empty, the deferred initializer is re-evaluated against the now-resolved environment. The derived thunk's reference cell updates to the resolved value, and every reference to it sees the resolution transparently.

A derived thunk participates in subsequent expressions on the same terms as a `Lazy@`-produced thunk: structural operations carry it forward, consuming operations may further defer if it remains unresolved.

```java
// computed key forces `label`; `life` becomes
// a derived thunk pending {label}
def life: < %(Lazy@ label): 42 >;

// `label` now resolves to "meaning"; life's
// deferred initializer re-evaluates
def label: "meaning";

life.meaning;   // 42
```

Carry operations during the section do not force their thunk operands. A thunk may flow into a record field, a tuple slot, a closure capture, or a function call argument, and remain unresolved within that position for the duration of the section, provided its referenced identifier(s) are eventually defined later in the same section.

#### §2.2.5 End-of-Section Force and Resolution

At the moment the `def` statement(s) section completes, the runtime performs a final resolution pass over every binding in the scope:

1. Every binding's value is structurally walked.
2. Every thunk encountered -- held directly by a binding, or carried inside a structural value (record field, tuple slot, captured closure variable, container element) -- is forced.
3. A thunk whose pending set is empty resolves cheaply (its referenced identifiers all became bound during the section).
4. A thunk whose pending set is non-empty at end-of-section cannot resolve; this is reported as a resolution failure.

This pass is the point at which carried thunks become forced. During the section, carry operations defer the question of whether a thunk's value is needed; at end-of-section, that question is answered for every thunk in scope. Anything still pending is reported.

After this pass, no thunks remain in any value reachable from the scope. The scope's bindings, and all values reachable through them, contain only resolved values from end-of-section onward. Code in the surrounding scope, in the statement-block, in escaped values, and in any future continuation of execution interacts only with values.

Subsequent reassignment (`:=`) of identifiers in the section has no effect on already-resolved thunks. The thunks' resolution captured the binding state at the moment of resolution and produced values; the values carry no surviving dependency on the identifier names.

A `Lazy@` expression whose identifiers are all already bound at construction resolves immediately and produces no thunk. The construct is permitted in such positions but has no effect beyond evaluating its expression.

#### §2.2.6 Scope Locality

A `Lazy@` participates only in the `def` statement(s) section of its directly enclosing scope. Identifiers from outer scopes contribute their already-bound values via ordinary lexical lookup at construction. Identifiers from inner scopes are not reachable; they have not been constructed at the point the outer-scope `Lazy@` resolves.

A `Lazy@` written inside a nested block (function body's `def` statement(s) section, nested block expression's `def` statement(s) section, or any inner scope) belongs to that inner scope's section and resolves under that scope's rules. It is invisible to the outer scope's resolution and does not interact with the enclosing scope's section timing.

**Do-comprehension blocks: `Lazy@` prohibited.** `Lazy@` is not permitted inside a `~<<` or `~<*` block (§7). Each do-block statement is its own single-statement scope (§2.1.1); there are no sibling `def` bindings within a statement scope for `Lazy@` to forward-reference, so the construct has no valid role. A `Lazy@` appearing at any position inside a do-block is rejected at the semantic-check layer.

#### §2.2.7 Cross-Scope Restriction

A `Lazy@`-produced thunk may be forced only within the scope in which it was constructed. While the thunk remains unresolved, a force attempt from a different scope is reported as an error at the force point.

This restriction applies regardless of how the thunk crossed the boundary: as a function argument, via a closure-captured name, or as part of a structural value flowing into another scope's execution. A thunk that has already resolved (its referenced identifiers all bound, its value cached) is then a concrete value (no longer a thunk) and may be read from any scope; the restriction applies only to unresolved thunks.

A function closure that references a `Lazy@`-defined name is safe in itself. The closure captures the name, not a snapshot of its current state; the body reads the name's current value at each call. If the name has resolved by the time the function is called, the body reads a value and proceeds normally. The cross-scope restriction triggers only when the body actually executes a force on the still-pending thunk during a call.

This example is well-formed (`seed` is fully resolved before needed by `compute()`):

```java
def seed: Lazy@ 7 * scale;
def compute: defn() ^seed * 2;
def scale: 3;                    // `seed` resolves here (`21`)
def answer: compute();           // 42
```

But, this example is broken (the laziness of `seed` crosses the scope boundary into `compute()`):

```java
def seed: Lazy@ 7 * scale;
def compute: defn() ^seed * 2;
def answer: compute();           // error: `seed` is not resolved yet
def scale: 3;
```

The language does not commit to compile-time detection of cross-scope thunk escape; the error is reported at the force point, inside the other scope's executing body at the unresolved name (in this example, `seed` inside `seed * 2`). The function body is attempting to force a thunk from a scope it doesn't own, which is not permitted. An implementation is free to detect some escape cases earlier via static analysis, but is not required to.

**NOTE:** This rhymes with the temporal dead zone (TDZ) semantics that other languages apply to bindings accessed before their declared scope state allows.

Two means of avoiding the error:

1. Order the relevant `def` statements so that the `Lazy@` resolves before the cross-scope use
2. Restructure so that the thunk is only consumed within its immediate enclosing scope.

`:over` annotations are a compile-time enforcement, and do not resolve this kind of error.

This restriction reflects a broader language commitment: Foi does not implicitly suspend function execution. `Lazy@`'s deferral mechanism operates within a single scope's `def` statement(s) section because the section is the well-defined unit of arrangement. Allowing a thunk to be forced from a different scope would require pausing the executing function, returning to the construction scope to make further progress, and resuming the function later: an implicit continuation. The language has no implicit continuations; deferral does not cross scope boundaries.

Compare the above broken code to this form, which works fine:

```java
def seed: Lazy@ 7 * scale;  // explicitly deferred
def answer: seed * 2;       // implicitly deferred
def scale: 3;               // now `seed` resolved, `answer` resolved
answer;                     // 42
```

There is no scope boundary being crossed here, so the deferred resolution of `seed` and `answer` works as expected.

#### §2.2.8 Resolution Failures

A `Lazy@` construct fails to resolve, in its proper immediately enclosing scope, in two cases. Both are detected after all `def`s have been processed.

1. **Unresolved forward reference.** A thunk's pending set contains identifiers that were not defined anywhere in this section. The error is reported at the construction site, naming the unresolved identifier(s).

2. **Value-shaped cycle.** A set of thunks transitively requires each other's values through consuming operations (e.g., `def x: Lazy@ z; def z: x + 1`). At end-of-section, none of the participants have resolved; the error is reported as a cyclic resolution failure, naming the participants and the path of the cycle.

Reference-shaped cycles -- where identifiers reference each other through structural operations that carry thunks without forcing -- are not failures. Each cycle participant's referenced identifier resolves through the section, the listener mechanism updates each thunk's reference cell to its resolved value, and the cycle in the value graph is preserved. The end-of-section force pass walks these values, finds all thunks resolved, and produces no error.

#### §2.2.9 The `%` Effector Operator and `Lazy@`

Conceptually, a `Lazy@` thunk is a syntactically-simplified deferred value (e.g., IO, State).

The `%` effector operator dispatches to the LHS's `_percent` hook (§3.10.9). Applying `%` to a value whose namespace defines no `_percent` hook is a type error.

The `Lazy@` namespace defines a `_percent` hook that is identity: `x%` for a `Lazy@`-bound name resolves to the same value a bare `x` read produces. Resolution of the deferred reference is performed exclusively by the carry-and-force machinery (§2.2.3 through §2.2.5), which is not user-callable; the identity hook exists so that `%` remains well-typed on a `Lazy@`-bound name without introducing a special-cased resolution path.

`%` may be useful stylistically as a marker on a thunk-bound name, to create a visual "compute this result" connection back to the `Lazy@` deferral, even though it has no operational effect.

This is analogous to how a program might null out a reference to signal participation in garbage collection: the act doesn't trigger or alter the collector, which runs on its own schedule, but it communicates intent about the value's lifecycle to a reader.

#### §2.2.10 Other Examples

**Mutual reference between sibling bindings.**

```java
def alice: < name: "Alice", friends: < Lazy@ bob > >;
def bob:   < name: "Bob",   friends: < alice > >;
alice.friends;          // < bob >
bob.friends;            // < alice >
```

**Cyclic structure (state machine).**

```java
def red:    < color: "red",    next: Lazy@ green >;
def green:  < color: "green",  next: Lazy@ yellow >;
def yellow: < color: "yellow", next: red >;
// red.next = green
// green.next = yellow
// yellow.next = red
```

**Mixed backward and forward references (partial constant folding).**

```java
def base: 100;
def offset: Lazy@ base + delta;
def delta: 7;           // 107
```

**Computed key resolved through propagation.**

```java
def life: < %(Lazy@ label): 42 >;
def label: "meaning";
life.meaning;           // 42
```

**Reassignment after resolution does not affect the thunk's value.**

```java
def x: Lazy@ y;
def y: 42;
y := 99;
x;                      // 42
```

#### §2.2.11 Implementation Notes

The carry-and-force model admits aggressive compile-time optimization. A `Lazy@` whose dependencies are statically traceable through the `def` statement(s) section compiles to ordinary eager evaluation with bindings reordered to satisfy dependencies. No runtime thunk is produced in such cases. The runtime thunk mechanism is required only when the dependency path passes through opaque carriers (function calls returning compound values, library-provided constructors, or any operation whose internal use of the thunk is not visible to the compiler).

The "no thunk past end of `def` statement(s) section" guarantee holds at both compile time and runtime. Compile-time folding may eliminate the thunk entirely; runtime resolution settles any thunk that survives compilation before the section exits. Code outside the section -- including the surrounding scope's statement-block, the body of any enclosing function, and any escaped value -- interacts only with resolved values.

### §2.3 Constancy

A `def` binding that is never reassigned within its scope is **observably constant**; the slot's value at every point after its initialization is the value the initializer produced.

```java
def pi: 3.14159;
log(pi * 2);
log(pi * pi);
// pi is never reassigned; it is constant for the scope's lifetime.
```

Observably-constant bindings need no `:over` annotation on functions that close over them (§3.6). The language treats such bindings as candidates for optimizations that depend on immutability, and their constancy may be carried through inferred types, though `:over` itself is a closure-capture declaration, not a type annotation.

A `def` binding with any reassignment (§2.4) in scope is **mutable**:

```java
def counter: 0;

// anywhere else, in same or any nested scope:
counter := counter + 1;     // counter is mutable
```

Mutability is determined by lexical inspection of the entire scope chain a binding is visible to. The presence of *any* `:=` reassignment to the binding's name makes it mutable, regardless of whether that assignment actually executes at runtime -- for example, appearing inside a conditional, loop, etc.

This rule applies to the implicit-`empty` form as well. The following two scopes are semantically equivalent: both introduce a mutable `x` with the same lifecycle:

```java
def x: empty;
x := 42;
```

```java
def (x) {       // implied: `x: empty`
    x := 42;
};
```

In the second form, `def (x)` implies `x: empty` (§2.9.2); the subsequent `:=` makes `x` mutable. The presence of the assignment is what determines mutability, not the explicitness of the initializer.

#### §2.3.1 Enforced Constancy

`defn` bindings (§2.5) are structurally constant; they cannot be reassigned via `:=` at all, so they are unconditionally constant.

```java
defn birthday(age) ^ age + 1;

// reassignment disallowed:
birthday := (+);
```

The name `birthday`, created by `defn`, is enforced-constant, meaning re-assignment is disallowed at compile time.

`deft` type definitions (§9) are structurally constant; they cannot be reassigned via another `deft` (of the same name) or `:=` at all.

### §2.4 Reassignment With `:=`

The `:=` operator (Syntactic-Grammar `AssignmentExpr`) reassigns the slot of an existing binding:

```java
def age: 41;
age := 42;
```

A `:=` whose LHS resolves to no visible binding in any enclosing scope is statically rejected.

```java
y := 42;            // ill-formed: y is not bound in any visible scope
```

For a well-formed `:=`, the abstract execution of `name := expr` is:

1. Resolve `name` to its slot in the lexically enclosing environment (walk the frame chain to find the slot bound to `name`).
2. Evaluate `expr` in the current environment.
3. Store the resulting value into the slot.
4. The reassignment expression evaluates to the assigned value (observable in chained reassignment).

`:=` reassignments may appear anywhere in a scope after the corresponding `def`, including in nested blocks (where the lookup walks outward to find the slot).

#### §2.4.1 Chained Reassignment

`:=` is right-associative and value-bearing:

```java
x := y := z := 0;
```

**Abstract execution:**

1. Evaluate the rightmost initializer `0`.
2. Store `0` into `z`'s slot. The expression `z := 0` evaluates to `0`.
3. Store `0` into `y`'s slot. The expression `y := (z := 0)` evaluates to `0`.
4. Store `0` into `x`'s slot.

All three names must have been previously bound (in a visible scope) by `def`.

#### §2.4.2 Record/Tuple Content Reassignment Disallowed

The `:=` LHS may carry an access tail at the grammar level (e.g., `rec.x`, `rec[0]`, `rec.0`), but any such form is statically rejected. Records and Tuples are immutable; their slots cannot be reassigned in place.

```java
def rec: < x: 1, y: 2 >;

rec.x := 10;            // ill-formed: cannot reassign into a Record
```

The only option is to reassign the binding to a new Record that overrides the field:

```java
rec := < &rec, x: 10 >;
```

### §2.5 The Hoisting Model

Foi splits binding forms into two categories: those that hoist throughout the enclosing scope (`defn`, `deft`) and those that become visible only after their declaration point (`def`). The split is on a single axis: whether the binding form admits reassignment.

**`defn` (function definition) hoists.** A `defn` binding is visible throughout its enclosing scope, including before its position in the source. `defn` may appear anywhere in a scope: at the top, in the middle, or at the bottom.

```java
log(double(21));            // 42; `double()` is hoisted

defn double(v) ^ v * 2;
```

Mutual recursion between `defn` bindings works for the same reason:

```java
defn isEven(n) ?[n ?= 0]: true ^isOdd(n - 1);

defn isOdd(n) ?[n ?= 0]: false ^isEven(n - 1);
```

`deft` (type definitions, §9) also hoists by the same rule.

**`def` (variable binding) does not hoist.** A `def` binding becomes visible *after* its `def` statement. Forward references between `def` bindings -- including between two `def`s at the top of the same scope -- are rejected:

```java
def x: y;                   // ill-formed: y is not yet bound
def y: 42;
```

When the initializer of `def x: y` is evaluated, the `def y` statement below it has not yet established the binding for `y`. The lookup fails.

**NOTE:** This motivates `Lazy@` (§2.2) as a forward-reference mechanism for `def`.

**Why the asymmetry between `defn` and `def`?** Reassignable bindings need linear traceability: a reader scanning the scope top to bottom should be able to identify every point at which a name might receive a new value. Constraining `def` to the top of the scope, and rejecting forward references between `def`s, means the reader can scan in linear time. `defn` is structurally constant -- it cannot be reassigned, so its position in the source does not affect what value it ever holds -- and so it is safe to hoist and to appear anywhere.

#### §2.5.1 Stylistic note

The hoisting model admits a style where executable code appears at the top of a scope and helper functions appear at the bottom:

```java
helper(42);
other();

defn helper(v) ^ v * 2;
defn other() ^ log("hello");
```

This is permitted at module scope and inside function bodies, and is a style the language is designed to make ergonomic.

### §2.6 The single-slot rule

A name has at most one binding slot per scope. `def` and `defn` share a single lexical identifier namespace; a name may only be declared once in the same scope, regardless of using `def` or `defn`.

**NOTE:** `deft` has its own types namespace and does not overlap with the lexical identifier namespace. No type annotation references a lexical identifier. `:as` / `?as` *only* target the type namespace, never the lexical identifier namespace.

Because `defn` hoists (§2.5), collision errors between a `defn` and a `def` of the same name are always attributed to the `def`, regardless of source order:

```java
// ill-formed: defn foo hoists to scope-top
def foo: 42;

defn foo() ^1;
```

```java
defn foo() ^1;

// ill-formed: defn foo is already bound at scope-top
def foo: 42;
```

```java
def foo: 42;

// ill-formed: foo already bound in this scope
def foo: 99;
```

```java
defn foo() ^1;

// ill-formed: foo already bound (both hoist)
defn foo() ^2;
```

The rule is one slot per name per scope, period. There is no overload, no shadow-within-scope, no last-wins resolution.

**Shadowing across nested scopes is permitted.** A `def` in a nested block introduces a fresh slot in the inner frame; the outer name remains unchanged and is restored when the inner scope exits:

```java
def x: 1;
{
    def x: 2;
    log(x);                 // 2
}
log(x);                     // 1
```

The inner `x` and outer `x` are distinct slots in distinct frames. Inner-frame lookup finds the inner slot first; outer-frame code never sees the inner.

### §2.7 `deft` (see §9)

`deft` (Syntactic-Grammar `DefTypeStmt`) introduces a named type:

```java
deft Age: int;
```

`deft` hoists by the same kind of rule as `defn`. Type names declared with `deft` are visible throughout their enclosing scope. Detailed semantics are specified in §9.

### §2.8 `defn` (see §3)

`defn` (Syntactic-Grammar `DefFuncExpr`) introduces a named function binding:

```java
defn double(v) ^v * 2;
```

The function value `defn(v) ^v * 2` is bound to the name `double`. Per §2.5, `defn` hoists and the binding is structurally constant. Detailed semantics -- parameter modifiers, body forms, preconditions, named arguments, operator-as-function, curry and uncurry -- are specified in §3.

For §2's purposes only: `defn` introduces a binding (like `def` does), it hoists, and it cannot be reassigned with `:=`.

### §2.9 Block Scoping

Foi has four syntactic block forms. They all introduce a new frame whose parent is the enclosing environment.

#### §2.9.1 Bare Block Expression: `{ stmts }`

A bare block expression (Syntactic-Grammar `BareBlockExpr`) introduces a new frame and evaluates its statements in sequence.

```java
{
    def tmp: 42;
    log(tmp);
}
```

**Abstract execution:**

1. Allocate a fresh frame, parent-linked to the current environment.
2. Evaluate each statement in source order, in the new frame.
3. The block expression's result value is the completion value of its final statement.

Bare blocks appear at statement position and at every implicit-input expression position (comprehension RHS, pipeline RHS, pipeline-bodied function body, match consequent). At an expression position, the block's final expression value is its final statement's completion value.

Within a bare block, the same `def`-at-top rule applies (§2.1.1).

#### §2.9.2 Def-Block Statement: `def (defs) { body }`

```java
def (tmp: 42) {
    tmp := 43;
    log(tmp);
};
```

This is the `DefBlockStmt` form (Syntactic-Grammar §11). The leading `def` keyword anchors the binding region; the parenthesized clause lists the bindings that exist in the block's frame from the top of `body`.

**Abstract execution:**

1. Allocate a fresh frame, parent-linked to the current environment.
2. For each entry in the defs clause, in source order:
    1. `name: expr`: allocate the slot, evaluate `expr` in the new frame, store the value.
    2. `name` (no initializer): allocate the slot and store the value `empty`. This is semantically equivalent to `name: empty`.
    3. Destructure target `<...>: source`: see §2.13.
3. Evaluate `body`'s statements in the new frame, in source order.

The Identifier-no-initializer form is settled convenience: the language reads it as "implicit `: empty`."

The defs-init clause uses the **strict-optional** binding form: Identifier entries may omit their initializer (implicit `: empty` as above), but destructure-target entries require their initializer explicitly. There is no implicit source at this position for a destructure to bind against.

**Why this form exists alongside the bare block:** `def` statements inside a bare block must each appear as their own statement at the top of the block. `def (defs) { body }` groups the bindings into a single clause, separates them visually from the body, and reads as "introduce these names, then run this body." It is the preferred form when more than one local is needed.

#### §2.9.3 Def-Block Expression (no implicit input): `(defs) { body }`

```java
?[x ?< 3]: (y: 3) { log(x + y); };
```

This construct (`(..) { .. }`) is the `BlockExprStrict` form (Syntactic-Grammar §11).

It looks like the §2.9.2 form, minus the `def` keyword. As such, it's dependent on, and must be attached to, other constructs: pattern matching clause (match consequent) and guard expression consequent (as above).

Destructuring is allowed in the defs clause, but since there's no implicit input to the expression, each destructuring position must have an explicit initializer:

```java
?[x ?< 3]: (< :name, :title >: rec) {
    // ..
};
```

Aside from destructuring, any definition in the defs clause may omit the initializer value (defaults to `: empty`):

```java
?[x ?< 3]: (y) {        // `y: empty`
    y := 3;
    log(x + y);
};
```

**Abstract execution:**

1. Allocate a fresh frame, parent-linked to the current environment.
2. For each entry in the defs clause, in source order:
    1. Identifier `name: expr`: allocate the slot, evaluate `expr` in the new frame, store the value.
    2. Identifier `name` (no initializer): allocate the slot and store the value `empty`. This is semantically equivalent to `name: empty`.
    3. Destructure target `<...>: source`: evaluate `source` and destructure per §2.13.
3. Evaluate `body`'s statements in the new frame, in source order.
4. The block's value is the value of its final value-bearing expression.

The defs-init clause uses the **strict-optional** binding form: Identifier entries may omit their initializer (defaults to `: empty` since this position supplies no implicit input), but destructure-target entries require their initializer explicitly; there is no implicit source at this position for a destructure to bind against. The corresponding implicit-input form is §2.9.4.

#### §2.9.4 Def-Block Expression (implicit input): `(defs) { body }`

```java
people ~each (< :name, :title >) {
    log(`"`name` has role: `title`");
};
```

This construct (`(..) { .. }`) is the `BlockExpr` form (Syntactic-Grammar §11), which appears only at **implicit-input positions**: comprehension RHS and pipeline RHS. The enclosing context supplies an implicit input value.

It looks like §2.9.3, but every entry's binding participates with the implicit input rather than ignoring it. A no-init entry takes its value from the implicit input directly. An init-bearing entry uses the `:?` sigil (§3.2.2), which reads the implicit input first and evaluates the init expression only when the implicit input is empty, overriding it.

How many implicit inputs the context supplies, and which entries they correspond to, depends on the host construct: a comprehension like `~each` or `~map` supplies one (each element); `~fold` supplies more than one; a pipeline `#>` supplies the topic.

The `:?` sigil is used here instead of the unconditional `:` sigil (§2.9.2, §2.9.3) because this position has an external source -- the implicit input -- that may be empty; the sigil marks the override-on-empty decision explicitly at the surface, matching the parameter default form.

```java
xs ~map (v:? 0) { v * 2 };          // v = 0 for empty elements
```

**Abstract execution:**

1. The enclosing context provides an implicit input value `__input` for each entry.
2. Allocate a fresh frame, parent-linked to the current environment.
3. For each entry in the defs clause, in source order:
    1. Identifier `name:? expr`: allocate the slot. If the entry's implicit input is non-empty, bind that input; otherwise evaluate `expr` in the new frame and store the value, overriding the empty implicit input.
    2. Identifier `name` (no initializer): allocate the slot. If the context supplies an implicit input for this entry, bind that input; otherwise store `empty`.
    3. Destructure target `<...> :? source`: if the entry's implicit input is non-empty, use it as the destructure source; otherwise evaluate `source` in the new frame and use its value as the destructure source, overriding the empty implicit input. Destructure per §2.13.
    4. Destructure target `<...>` (no initializer): destructure the context's implicit input for this entry as the source, per §2.13.7.
4. Evaluate `body`'s statements in the new frame, in source order.
5. The block's value is the value of its final value-bearing expression.

**Implicit-or-override default:** at this position, an entry's primary binding source is the implicit input from the enclosing context. A no-init entry uses that input directly, falling back to `empty` when the context supplies none. A `:?`-init entry uses that input when non-empty and evaluates its init expression only when the input is empty, overriding it. At positions where no implicit input is provided (§2.9.2, §2.9.3), the unconditional `:` sigil is used instead: an Identifier-no-init resolves to `empty`, an Identifier-`:`-init evaluates its expression unconditionally, and a destructure-no-init is rejected as having no source.

**Why four block forms:** the grammar distinguishes (a) bare block, no bindings clause (§2.9.1); (b) `def`-prefixed bindings statement, no implicit source (§2.9.2); (c) bindings expression with no implicit source, host-attached to guards and match consequents (§2.9.3); and (d) bindings expression with an implicit source from the enclosing context, at comprehension RHS or pipeline RHS.

### §2.10 Module scope

The outermost scope of a module has an unmarked (implicit) **`def` section** at its top (§2.1.1): `def`, `defn`, and `deft` may interleave with no enclosing syntactic delimiter, and general statements follow. The module's frame is the root of the frame chain for all expressions evaluated within the module.

Modules additionally admit `import` -- which appears only as an initializer value on a top-of-scope `def` (e.g., `def Std: import "#Std";`) -- and `export` -- a statement form unique to module scope. Both are detailed in §8.

### §2.11 Closure Capture

A function value carries a reference to the environment in which it was created. When the function is later called, the call's body is evaluated in a frame whose parent is the captured environment.

```java
defn make(n) ^defn(x) ^x + n;

def addTen: make(10);

addTen(5);                  // 15
```

**Abstract execution:**

1. `make(10)` evaluates `make`'s body in a frame where `n` is bound to `10`.
2. The body returns a function value `defn(x) ^x + n`. The function captures the frame in which it was created (the frame with `n: 10`).
3. `addTen(5)` calls the captured function, allocating a new frame where `x` is bound to `5`, with the captured frame as parent.
4. The body `x + n` resolves `x` in the local frame and `n` in the parent (captured) frame.

**Captured frames are live, not snapshots:** the closure references the frame itself; subsequent `:=` reassignments to bindings in that frame are observable through the closure on its next call.

```java
def x: 1;

def f: defn() ^x;

x := 2;

f();     // 2
```

#### §2.11.1 Per-Iteration Freshness

Inside loop blocks (`~each` and the comprehension family, §7), each iteration allocates a **fresh** frame for its locals. Closures captured during one iteration close over that iteration's frame, not over a shared mutable variable:

```java
def fs: < >;

0..3 ~each (i) {
    fs := < &fs, @|i| >;
};

fs.0();                     // 0
fs.1();                     // 1
fs.2();                     // 2
fs.3();                     // 3
```

**NOTE:** `&fs` is pick-spreading (§2.12.6) the existing `fs` Tuple into the new re-assigned Tuple. `@` is the identity function (§3.8.1), and `| .. |` is partial application (§3.11) to *capture* the per-iteration `i` via closure.

Each closure captures the frame in which its iteration ran; that frame is distinct for each iteration. This rule is non-negotiable for Foi's loop semantics; it is what makes `~each` compose correctly with closure-bearing bodies.

### §2.12 Pick Expressions

A pick reads one or more values from a Record or Tuple. The single-access forms (Syntactic-Grammar `SingleAccessExpr` / `MultiAccessExpr` at §6, with segment productions `DotIdentifier`, `BracketExpr`, `DotBracketExpr`, `DotAngleExpr`) produce one value; the multi-pick forms produce a new Record containing the picked entries.

#### §2.12.1 Single Property Access: `.name`

```java
rec.x;
```

**Abstract execution:**

1. Evaluate the base expression.
2. Read the slot named `x` from the resulting Record.
3. The value of the slot is the result.

If the slot does not exist, the result is `empty`. There is no exception raised at the language level for missing fields.

#### §2.12.2 Indexed/Keyed Access: `.0`, `.-1`, `[expr]`

Positive integer access `.0`, `.1`, ... reads by position. Negative integer access `.-N` reads from the end of the positional sequence: `.-1` is the last positional entry, `.-2` the second-to-last, and so on. On a Record with no positional entries, there is no "end" to count back from; `.-N` returns `empty` per the missing-slot rule (§2.12.1). Computed access `[expr]` evaluates `expr` to an index or key.

```java
// items: < 10, 20, 30, 40, 50 >

items.0;                    // 10
items.-1;                   // 50
def idx: 3;
items[idx];                 // 40

// rec: < x: 1, y: 2, z: 3 >
def field: "y";
rec[field];                 // 2
```

Negative indexing (relative from end) is only available in `.-N` form. In `[ ]` contexts, a negative integer is a literal key lookup; since record property names are positive integers only (per §17 grammar), no such slot can exist and `rec[-N]` returns `empty` per the missing-slot rule.

**Abstract execution:**

1. Evaluate the base expression to a source value.
2. Resolve the access form:
    1. `.K` with positive integer `K`: read the slot at positional index `K`.
    2. `.-N`: count back `N - 1` positions from the source's last positional index. If the source has no positional entries, the result is `empty`.
    3. `[expr]`: evaluate `expr` to a key value. A positive integer key resolves to a positional index; a string key resolves to a named slot; other key types are subject to §2.14.4.
3. Return the value at the resolved slot. A missing slot resolves to `empty`.

#### §2.12.3 Range Access: `.[N..M]`

For Tuples (or Records with numerically indexed elements), `.[N..M]` *picks* a range of values from the structure:

```java
// items: < 10, 20, 30, 40, 50 >

items.[0..3];               // < 10, 20, 30, 40 >
```

A range access reads a contiguous run of integer-indexed entries from the source and returns them as a Tuple. The endpoints `N` (start) and `M` (end) are inclusive, and each may be any expression that evaluates to an integer index, including a bare number literal.

```java
// items: < 10, 20, 30, 40, 50 >

def start: 2;
def end: 3;

items.[start..end];         // < 30, 40 >
```

A range can be left open-ended on either side (but not both). If the start of the range is omitted, the default is `0`. If the end of the range is omitted, the default is the last positional index in the structure:

```java
// items: < 10, 20, 30, 40, 50 >

items.[..2];        // < 10, 20, 30 >
items.[3..];        // < 40, 50 >
```

**NOTE:** The canonical way to select a range that's a whole slice of the Tuple structure (regardless of its size) -- filtering out non-positionally indexed values (if any) -- is with `.[0..]`. Structure values are immutable and structurally equal; if the original is truly a Tuple (consisting only of positionally indexed entries), the result of `.[0..]` is indistinguishable from the original structure value.

Out-of-range explicit endpoints are clipped to those same bounds: an explicit `N` less than `0` is treated as `0`, and an explicit `M` past the last positional index is treated as the last positional index. The clip is silent; there is no error or `empty` result for an over-reaching endpoint.

```java
// items: < 10, 20, 30, 40, 50 >

items.[-2..2];      // < 10, 20, 30 >          (N clipped to 0)
items.[3..99];      // < 40, 50 >              (M clipped to 4)
items.[-5..99];     // < 10, 20, 30, 40, 50 >  (both clipped)
```

**Abstract execution:**

1. Evaluate the base expression to a source value.
2. Compute the effective start `S`:
    1. If `N` is omitted, `S = 0`.
    2. Otherwise, evaluate `N` to an integer and clip: `S = max(N, 0)`.
3. Compute the effective end `E`:
    1. If `M` is omitted, `E` is the source's last positional index.
    2. Otherwise, evaluate `M` to an integer and clip: `E = min(M, last positional index)`.
4. Read the positional entries at indices `S, S+1, ..., E` from the source in order.
5. The resulting Tuple is the value of the expression.

If `S > E` after clipping, or the source has no positional entries, the result is the empty Tuple `< >`.

#### §2.12.4 Multi-Pick: `.<a, b>`

A multi-pick produces a new Record whose entries are the selected names or positional indices paired with their corresponding values from the source. Each entry slot may be a bare identifier (named slot), a positive integer literal (positional slot), a `%expr` computed key (§2.12.5), or a `&src` spread (§2.12.6); it's the same entry forms available inside Record/Tuple literals.

```java
// rec: < x: 1, y: 2, z: 3 >

rec.<x, y>;                 // < x: 1, y: 2 >
```

When every entry is a positive integer, the multi-pick selects positional entries and produces a Tuple. The `.[N..M]` range form (§2.12.3) is a shorthand for a contiguous positive-integer multi-pick: `items.[2..5]` is equivalent to `items.<2, 3, 4, 5>`.

```java
// items: < 10, 20, 30, 40, 50 >

items.<0, 2, 4>;            // < 10, 30, 50 >
items.<1, 3>;               // < 20, 40 >
```

**Abstract execution:**

1. Evaluate the base expression to a source value.
2. For each entry in the pick list, in source order:
    1. For a bare identifier or positive integer, read the source's slot of that name and add it to the result under the same name.
    2. For `%expr` (computed name), see §2.12.5.
    3. For `&src` (spread), see §2.12.6.
3. The completed Record is the value of the expression.

#### §2.12.5 Computed-Name Pick: `.< %expr >`

```java
// rec: < x: 1, y: 2, z: 3 >

def k: "x";
rec.<%k>;                   // < x: 1 >
```

**Abstract execution:**

1. Evaluate the base expression to a source value.
2. Evaluate `expr` to a name value `__k`.
3. Read the source's `__k` slot.
4. Construct a Record with one entry: name `__k`, value as read.

#### §2.12.6 Spread Pick: `.< &src >`

```java
// rec: < x: 1, y: 2, z: 3 >

def keys: < "x", "y" >;
rec.<&keys>;                // < x: 1, y: 2 >
```

The spread source may be any expression whose value satisfies the contract below. Common shapes include bare identifier, property access, indexed access, range access, and nested spread:

```java
// rec: < x: 1, y: 2, z: 3 >
// keys: < "x", "y", "z" >

rec.<&keys.0>;          // < x: 1 >
rec.<&keys.[1..]>;      // < y: 2, z: 3 >
```

**Abstract execution:**

1. Evaluate the base expression to a source value.
2. Evaluate `src` to a Tuple of name values `__s`.
3. For each name `__n` in `__s`, in order:
    1. Read the source's `__n` slot.
    2. Add an entry to the result with name `__n` and that value.
4. The completed Record is the value of the expression.

**Contract on `src`:** the value produced must be a Tuple whose entries are name values (strings or string-coercible). The contract is enforced at runtime, not by the grammar; `src` may be any expression syntactically, and a value-shape mismatch produces a runtime failure when the spread is evaluated. A multi-pick source (e.g., `&src.<x, y>`) is therefore grammatically admissible but always fails: multi-pick produces a Record of name-value pairs, never a Tuple of names.

#### §2.12.7 Mixed Multi-Pick

Static names, positional indices, computed names, and spreads may all appear in a single multi-pick. Entries are evaluated in source order -- relevant for side effects in `%expr` computed entries and for evaluation of `&src` spread sources -- but the resulting Record follows the unordered-identity rule (§1.5): two entries that resolve to the same slot name produce one entry in the result, since the source is read once per multi-pick and each entry reads the same underlying slot.

```java
// rec: < x: 1, y: 2, z: 3 >
// extras: < "y", "z" >

rec.<x, &extras>;           // < x: 1, y: 2, z: 3 >
```

### §2.13 Destructured Bindings

A destructured binding (Syntactic-Grammar `DestructureTarget` at §4) extracts one or more values from a Record or Tuple and binds them to names in the current frame. Destructure targets appear at four positions: `def` statements, the defs-init clause of `def (...) {...}` and `(...) {...}` blocks, function parameter lists, and pattern-match clauses (§5).

Destructure operates in one of two **modes**:

- **Record-mode** (§2.13.1–§2.13.5) reads slots by name.
- **Tuple-mode** (§2.13.6) reads slots by position.

A single target commits to one mode; the two modes do not mix. Mode is selected at the grammar level by the first non-capture entry: a `:name` or `name:` opener commits to record-mode; a bare identifier or leading comma commits to tuple-mode. The `#name` capture form is admitted in both modes; an all-capture target (`< #whole >`) is semantically identical under either mode and resolves as record-mode by grammar ordering.

The record-mode target shapes are:

- `:name`: concise (i.e., `name: name`)
- `:source.name`: concise-tail (i.e., `name: source.name`)
- `name: source.other`: renamed
- `#name`: full-context capture
- `name: [sourceExpr]`: computed source

The tuple-mode target shapes are:

- `name`: positional entry, binds the source at the entry's list position
- (empty comma position): skip slot, consumes a position without binding
- `#name`: full-context capture

Any non-capture form additionally admits an optional `:? default` tail: if the entry's extraction resolves to `empty`, the `default` expression is evaluated and its value overrides the empty read. Default expressions may reference names bound by earlier entries in the same destructure.

#### §2.13.1 Concise Form

```java
def <
    :orderID,
    :items.0.price
>: getOrder(123);
```

The concise form `:path` denotes a destructure entry whose bound name is taken from the terminal segment of `path`. With no path tail (`:orderID`), the entry name and the slot read from the source are the same. With a path tail (`:items.0.price`), the entry reads through the path and binds the terminal segment's name (`price`).

An optional `:? default` tail overrides an empty extraction:

```java
def < :count :? 0 >: getOrder(123);
```

If the source has no `count` slot (per §2.12.1, a missing slot resolves to `empty`), the entry binds `count` to `0`. When the extraction is non-empty, the default is not evaluated.

**Per-entry abstract execution** (against the destructure source `__src` established by §2.13.5):

1. Let `name` be the terminal segment of `path` (a static identifier; see Constraint below).
2. Read the value at the slot path `path` from `__src`. Per §2.12.1, any missing slot along the path resolves to `empty`, which propagates as the read value.
3. If the read value is `empty` and a `:? default` tail is present, evaluate `default` in the current environment; the resulting value overrides the empty read.
4. Allocate a slot in the current frame for `name` and store the value into it.

Constraint: the final path segment of a concise entry must be a static identifier; not an integer, not a computed expression. `:items.0` is rejected because `0` is not a valid identifier for the bound name.

#### §2.13.2 Renamed Form

```java
def < firstItem: items.0 >: getOrder(123);
```

The renamed form `name: path` decouples the bound name from the source path. The bound name is `name`, explicitly given. The source path is `path`. This form is **required** whenever the path's terminal segment fails the concise-form constraint -- an integer (`items.0`), computed expression, or any non-identifier terminal -- and is **available** whenever a bound name different from the path's terminal segment is preferred.

An optional `:? default` tail overrides an empty extraction:

```java
def < firstItem: items.0:? <> >: getOrder(123);
```

If `items` is missing or `items.0` resolves to `empty`, the entry binds `firstItem` to the default (`<>` here). When the extraction is non-empty, the default is not evaluated.

**Per-entry abstract execution** (against the destructure source `__src` established by §2.13.5):

1. Read the value at the slot path `path` from `__src`. Per §2.12.1, any missing slot along the path resolves to `empty`, which propagates as the read value.
2. If the read value is `empty` and a `:? default` tail is present, evaluate `default` in the current environment; the resulting value overrides the empty read.
3. Allocate a slot in the current frame for `name` and store the value into it.

#### §2.13.3 Full-Context Capture Form

```java
def < :orderID, #order >: getOrder(123);
```

The full-context capture form `#name` binds the entire source value to `name`, in addition to any other entries in the same destructure that may extract substructures.

**Per-entry abstract execution** (against the destructure source `__src` established by §2.13.5):

1. Allocate a slot in the current frame for `name` and store `__src` directly.

Multiple `#`-entries in the same destructure are permitted but produce aliases of `__src`; they all hold the same source value. The form is useful for retaining the source alongside extracted substructures (the example above binds both `orderID` from the source and `order` as the whole).

#### §2.13.4 Computed Source Form

```java
def < lastItem: [size(items) - 1] >: items;
```

The computed source form `name: [expr]` reads the source at a dynamically computed slot. The `[expr]` evaluates to an integer index or string key, which is then used to read from `__src`. The form is **rename-only**: the bound name must be given explicitly, since `[expr]` has no terminal identifier to derive a concise-form name from.

An optional `:? default` tail overrides an empty extraction:

```java
def < lastItem: [size(items) - 1] :? <> >: items;
```

If the computed slot resolves to `empty`, the entry binds `lastItem` to the default. When the extraction is non-empty, the default is not evaluated.

**Per-entry abstract execution** (against the destructure source `__src` established by §2.13.5):

1. Evaluate `expr` in the current environment to a key value `__k` (an integer index or string slot name).
2. Read the value at slot `__k` from `__src`. Per §2.12.1, a missing slot resolves to `empty`.
3. If the read value is `empty` and a `:? default` tail is present, evaluate `default` in the current environment; the resulting value overrides the empty read.
4. Allocate a slot in the current frame for `name` and store the value into it.

The `[expr]` may also appear as the *root* of a longer path: `def < deepest: [k].sub.0 >: items;` evaluates `k`, picks `[k]` from the source, then reads through `.sub.0`. See §2.13's target shapes list and the grammar's `DestructureNamedDef` base-of-`BracketExpr` option.

#### §2.13.5 Mixed Record-Mode Destructure

A record-mode destructure target may mix any combination of the entry forms from §2.13.1 through §2.13.4:

```java
def <
    :orderID,
    :items.0.price,
    firstItem: items.0,
    #order,
    name: [OrderFields.customerName]
>: getOrder(123);
```

**Abstract execution** (the umbrella procedure that the per-entry subsections defer to):

1. Evaluate the source expression once and bind the result to an interpreter-internal temporary `__src`.
2. For each entry in the destructure, in source order, dispatch to the per-entry procedure for the entry's form:
    1. Concise: §2.13.1.
    2. Renamed: §2.13.2.
    3. Full-context capture: §2.13.3.
    4. Computed source: §2.13.4.
    Each per-entry procedure reads from `__src` and binds into the current frame.

The single-evaluation of the source is important: a side-effecting source is observed exactly once regardless of how many entries extract from it, and all entries see a consistent snapshot of the source (immutable Records and Tuples make "consistent snapshot" trivial in practice, but the rule holds regardless).

#### §2.13.6 Tuple-Mode Destructure

A tuple-mode destructure target binds by position. Entries open with a bare identifier (positional), an empty comma position (skip slot), or `#name` (full-context capture).

```java
def < first, second, third >: coords;
```

Each positional entry reads the source at the entry's list position: `first` binds `coords.0`, `second` binds `coords.1`, `third` binds `coords.2`. Comma rules mirror §1.5.2 tuple-form literal counting.

##### Skip Slots

Empty comma positions consume a source position without binding:

```java
def < , second, third >: coords;    // second binds coords.1, third binds coords.2
def < first, , third >: coords;     // first binds coords.0, third binds coords.2
def < , , third >: coords;          // third binds coords.2
```

Leading and interior empty positions consume a slot per §1.5.2. Trailing empty positions have no effect: an unbound trailing slot performs no read and no binding, and is treated as a no-op.

##### Capture in Tuple-Mode

The capture form `#name` binds the entire source value and is **position-neutral**: its placement in the entries list does not affect other entries' position counting:

```java
def < a, #whole, b >: coords;       // a binds coords.0, whole binds coords, b binds coords.1
def < #whole, a, b >: coords;       // whole binds coords, a binds coords.0, b binds coords.1
def < a, b, #whole >: coords;       // a binds coords.0, b binds coords.1, whole binds coords
```

All three targets above bind identical values. Multiple `#`-entries are permitted and produce aliases of the source.

##### Per-Entry Defaults

Positional entries admit the `:? default` tail. Semantics parallel §2.13.1:

```java
def < a:? 0, b:? 1, c:? 2 >: coords;
```

If `coords.0` resolves to `empty`, `a` binds to `0`; likewise for `b` and `c`. Capture entries do not admit defaults (a destructure against an empty source errors before per-entry procedures proceed, so a capture-with-default is unreachable per §2.13.3).

##### Per-Entry Abstract Execution

For a tuple-mode destructure (against the destructure source `__src` established per the source-binding step of §2.13.5, which applies uniformly to both modes):

1. Initialize an interpreter-internal position counter `__pos` to 0.
2. For each entry in source order:
    1. **Positional entry** (`name`):
        1. Read the value at slot `__pos` from `__src`. Per §2.12.1, a missing slot resolves to `empty`.
        2. If the read value is `empty` and a `:? default` tail is present, evaluate `default` in the current environment; the resulting value overrides the empty read.
        3. Allocate a slot in the current frame for `name` and store the value into it.
        4. Increment `__pos`.
    2. **Skip slot** (empty comma position): increment `__pos` without binding.
    3. **Capture entry** (`#name`): allocate a slot in the current frame for `name` and store `__src` directly. Do not increment `__pos`.

#### §2.13.7 Implicit Source

At certain positions, a destructure target appears without its `: source` tail. The enclosing context supplies the source implicitly. The three positions admitting this form:

1. The defs-init clause of an implicit-input `(defs) { body }` block expression (§2.9.4): the comprehension element, pipeline topic, or function positional argument is the source.
2. A function parameter position: the call-site positional argument bound to that parameter is the source.
3. A pattern-match clause with implicit topic: the match topic is the source.

```java
people ~each (< :name, :age >) {
    log(name, age);
};
```

The `~each` block receives each element of `people` as its implicit input; the destructure binds `name` and `age` from that element.

**Abstract execution:** identical to the umbrella procedure of the target's mode (§2.13.5 for record-mode, §2.13.6 for tuple-mode), except that step 1 is supplied by the enclosing context rather than evaluated from a `: source` tail. The implicit input takes the role of `__src`; per-entry dispatch proceeds against it.

### §2.14 Open extensions

#### §2.14.1 The `:as` type annotation

A `def` binding (and many other expressions) may carry a `:as` tail (Syntactic-Grammar `AsExpr` / `AsAnnotationExpr` at §5) specifying a type:

```java
def age: 42 :as int;
```

Settled: the annotation is part of the parsed AST and does not change the value the expression evaluates to.

Open: whether the annotation is checked at parse time, at a separate elaboration pass, lazily at use, or at runtime; the failure mode when the value does not satisfy the type; how `:as` participates in inference. Covered in §9.

#### §2.14.2 `:over` and constancy

Per §2.3, the operational condition for constancy is "no `:=` reassignment in scope." The `:over` operational semantics -- when it must appear on a function that closes over a mutable binding, and its interaction with nested closures -- are specified in §3.6. Its interaction with type inference (whether inferred types carry `:over`-derived constancy metadata, cross-module re-export behavior) is covered in §9.

#### §2.14.3 Effect tracking on bindings

Effect tracking on function signatures is settled and mandatory per §6.13. For `def` bindings specifically: effects performed by a binding's initializer contribute to the enclosing scope's effect-coverage obligation per §6.13.4. Whether the elaborated AST represents this by tagging the `def` node with an explicit effect-metadata slot, or by deriving the initializer's effect set on demand during coverage-check traversal, is an implementation choice for the type-elaboration layer and is not further constrained here.

#### §2.14.4 Computed-key dispatch

Per §2.12.5, the intended Foi semantic for computed-name picks with non-string keys is structural-equality keyed dispatch. Implementation lives at the runtime layer; the native backend's dispatch table shape for structural-equality Map dispatch is pending native-backend design and is not further constrained here.

#### §2.14.5 Empty `< >` typing

Per §1.5.5, the polymorphism of `< >` between Record and Tuple slots may need formal type-system treatment (union, structural any-of-either, distinguished empty). Operational semantics settled; type-level representation open. Covered in §9.

## §3 Functions

This section specifies function values: how they are introduced, what their parameter shapes mean, how their bodies execute, and how a call binds arguments to parameters and produces a result.

§1.6 established that a function is a value, introduced via `defn`, first-class in every value position. §2.8 established that `defn` is a binding form that hoists and is structurally constant. §2.11 specified the closure-frame mechanics: that a function value carries the lexical frame in which it was created, and that frame is live (not a snapshot). This section assumes both and cross-refs them where relevant; it does not re-derive them.

### §3.1 Function Literal Forms

A function literal (Syntactic-Grammar `DefFuncExpr` at §13) has three surface forms. All produce a function value; they differ in what name (if any) is bound, and where.

#### §3.1.1 Declaration Form

```java
defn add(x, y) ^x + y;
```

The required name (`add`) is bound in the enclosing scope as a structurally constant `defn` binding (§2.8). Through lexical scope lookup, the name is available to the function body for self-reference (recursion).

A declaration `defn` is a statement, not an expression: it cannot appear in operand position. To produce a function value at expression position with the binding effect, use a `def`-binding with a named-expression form (§3.1.2).

##### §3.1.1.1 `@`-Suffix Declaration Form

A function literal may be declared with a `@` marker at the end of its name (Syntactic-Grammar `DefHookDecl` at §13; this production covers §3.1.1.1, §3.1.1.2, and §3.1.1.3):

```java
defn Nothing@() ^empty;
defn Identity@(v) ^v;
```

**NOTE:** These are commonly referred to as "unit constructors". Foi has a number of them built in, such as `Left@`, `Done@`, `IO.of@`, etc.

The `@` marker is **not part of the function's name as a binding**; `Nothing` is the bound name in the enclosing scope; the `@` marker is a separate AST-recorded flag on the function value. `Nothing` and `Nothing@` cannot coexist as separate bindings in the same scope.

`@`-marked functions may only have zero parameters, or one parameter; that single parameter (if any) may *not* be a gather parameter.

The marker opts the function value into the `@`-call operator (§3.8) at call sites: a no-paren single-argument call form. A `defn` may only carry the `@` marker if its outermost parameter list declares zero or one parameters; `@` on a multi-parameter `defn` is rejected at compile time.

Call shapes for `@`-marked functions (all equivalent; trivia-tolerant on both sides of `@`):

```java
Id@42;        // call: passes 42
Id @ 42;
Id@ 42;
Id @42;
Id@(42);      // ( ) is expression grouping, not arg list
```

A function defined *without* the `@` marker cannot be invoked via the `@`-call operator; `Nothing@ x` is a semantic error against a `Nothing` that was not declared `@`-callable. The marker is the function value's opt-in.

The full `@`-call dispatch mechanism is specified in §3.8.

##### §3.1.1.2 `%`-Suffix Declaration Form

A function literal may declare itself with a `%` marker at the end of its name:

```java
// pre-requisite:
defn Task@(fn) ^< :fn >;

defn Task%(tInst,env) ^tInst.fn(env);
```

Like `@`, the `%` marker is **not part of the function's name as a binding**; `Task` is the bound name in the enclosing scope, and the `%` marker is a separate AST-recorded flag on the function value. A `%`-marked `defn` does not introduce a binding distinct from `Task` or `Task@`; it installs an effector hook on the same `Task` namespace that an accompanying `defn Task@(..)` constructs against. `Task`, `Task@`, and `Task%` are three syntactic forms over a single binding slot.

A `defn Name%(..)` declaration is well-formed only when accompanied in the same scope by a `defn Name@(..)` of the same name; the `%` hook installs against the namespace introduced by the `@` hook. A `%`-only declaration is rejected at compile time.

The `%` hook receives an instance as its first parameter and an optional effector argument as its second. The outermost parameter list of a `%`-marked `defn` must declare exactly one or two parameters, neither of which may be a gather parameter; `%` on a parameter list shape outside this range is rejected at compile time. When the hook declares two parameters and the `%`-call form supplies none (`inst%`), the second parameter binds to `empty` per §3.10.1.

The marker opts the function value into the `%`-call operator (§3.9) at call sites: a postfix effector form invoked against an instance constructed through the same-named `@` hook. Call shapes for `%`-marked functions (all equivalent; trivia-tolerant on both sides of `%`):

```java
inst%;             // call: passes inst alone
inst %;
inst % env;        // call: passes inst and env
inst%env;
inst%(env);        // ( ) is expression grouping, not arg list
```

A function defined *without* the `%` marker cannot be invoked via the `%`-call operator; `regular%` is a semantic error against a `regular` that was not declared `%`-callable. The marker is the function value's opt-in.

The full `%`-call dispatch mechanism -- how `inst%` routes to its owning namespace's `%` hook, and the no-hook rejection rule when no `%` hook is declared -- is specified in §3.9.

##### §3.1.1.3 Comprehension-Suffix Declaration Form

A function literal may declare itself with a comprehension marker at the end of its name:

```java
// pre-requisite:
defn Container@(v) ^< value: v >;

defn Container~map(inst, fn) ^Container@ fn(inst.value);
defn Container~<(inst, fn) ^fn(inst.value);
```

Like `@` and `%`, a comprehension marker is **not part of the function's name as a binding**; the identifier before the marker is the bound namespace name in the enclosing scope. `Container`, `Container@`, `Container%`, `Container~map`, `Container~<`, and any other comprehension-suffix form on the same identifier are syntactic forms over a single typeclass namespace (`Container`).

A comprehension-marked `defn` installs a comprehension hook on the namespace named by the identifier. At a comprehension call site, the LHS's owning namespace is inspected for the corresponding hook; if present, the hook is invoked with the LHS instance as its first argument, followed by the operands the comprehension supplies.

A comprehension-marked `defn` is well-formed only when accompanied in the same scope by a `defn Name@(..)` of the same name; a comprehension-only declaration is rejected at compile time. This mirrors the `%` hook requirement (§3.1.1.2).

**Admitted markers.** The comprehension markers admitted at declaration position fall into three categories:

- **Tier 1** (no language-provided default): `~<`, `~each`
- **Tier 2** (language-provided default composition at call sites): `~map`, `~ap`, `~filter`, `~fold`, `~cata`, `~foldR`
- **Do-comprehension** (per-namespace override of the do-block compilation): `~<<`, `~<*`

All three categories use identical declaration syntax. Tier 1 and Tier 2 markers install hooks dispatched by their same-name comprehension-call operators; do-comprehension markers install hooks that override the do-block compilation for LHS instances in the declaring namespace.

**Do-comprehension calling convention.** The `~<<` and `~<*` markers install hooks of signature `(comp, ty)`:

- `comp` is the compiled effect-performing form of the do-block body, invoked as a unary callable whose parameter is discarded at the outermost invocation and filled by the resumption callable's argument at each subsequent invocation from within an arm body. Full mechanism at §3.10.9.4.
- `ty` is the dispatch-type introspection value per §3.10.9.7; hooks that do not specialize on compound-LHS shape may omit this trailing parameter (surplus-argument-discard rule of §3.10.1 drops it silently).

The composite marker forms are `Tilde OpenAngle OpenAngle` (`~<<`) and `Tilde OpenAngle Star` (`~<*`); strict no-trivia between the composing tokens, matching the composite-operator adjacency rule at call sites (§10).

**Canonical markers.** The `~<` (bind) hook has surface aliases at call sites: `~chain`, `~bind`, `~flatMap`. At declaration position, only the canonical `~<` form is admitted. `defn Foo~chain(..)`, `defn Foo~bind(..)`, and `defn Foo~flatMap(..)` are rejected at compile time with a message directing the author to declare the hook as `defn Foo~<(..)`. All four spellings continue to dispatch to the `~<` hook at call sites (§3.10.9).

**Adjacency.** Strict no-trivia between the identifier and the marker, mirroring `Foo@` and `Foo%` at their declaration positions. Trivia is admitted between the marker and the first paren-set (mirrors normal `defn` paren spacing).

**Missing hook at call site.** Tier 1 markers (`~<`, `~each`) have no default; a comprehension expression against a namespace that has not declared the corresponding hook is rejected at compile time. Tier 2 markers have language-provided defaults; missing-hook call sites expand to a composition over the namespace's declared primitives (§3.10.9). Do-comprehension markers (`~<<`, `~<*`) fall through to the default compilation route specified at §3.10.9.4 when the hook is absent.

**Multi-decl uniqueness.** At most one hook per marker per namespace per scope; multiple declarations of the same marker on the same namespace are rejected at compile time.

**Parameter constraints.** The outermost parameter list must declare the fixed shape for the hook's operation. Gather parameters are not admitted in the outermost list. Subsequent (curried) parameter lists are unconstrained.

The full comprehension-dispatch mechanism -- how a comprehension call site routes to its LHS's owning namespace's hook, how alias spellings normalize to canonical, how Tier 2 defaults expand, and the semantic error taxonomy -- is specified in §3.10.9.

##### §3.1.1.4 Operator-Suffix Declaration Form

A function literal may include an arithmetic or equality operator marker at the end of its name:

```java
// pre-requisite:
defn Vector@(v) ^v;

defn Vector+(a, b) ^Vector@ < x: a.x + b.x, y: a.y + b.y >;
defn Vector-(a, b) ^Vector@ < x: a.x - b.x, y: a.y - b.y >;
defn Vector*(a, k) ^Vector@ < x: a.x * k, y: a.y * k >;
defn Vector?=(a, b) ^a.x ?= b.x ?and a.y ?= b.y;
```

Like `@`, `%`, and the comprehension markers, an operator marker is **not part of the function's name as a binding**; the identifier before the marker is the bound namespace name in the enclosing scope. `Vector`, `Vector@`, `Vector+`, `Vector*`, `Vector?=`, and any other operator-suffix form on the same identifier are syntactic forms over a single typeclass namespace (`Vector`).

An operator-marked `defn` installs a hook on the namespace named by the identifier. At the corresponding binary call site (`a + b`, `a ?= b`, etc.) whose LHS is an instance of the declaring namespace, the LHS's owning namespace is inspected for the hook; if present, the hook is invoked with the LHS instance as its first argument and the RHS operand as its second. Dispatch follows the LHS-wins rule shared with the rest of the namespace-attached operator family (§3.8): the LHS's namespace identity drives operator selection; the RHS is data supplied to the hook, and the hook body may inspect its shape (via `?as`, `?(rhs)`, etc.) if the operation is not symmetric across operand shapes.

An operator-marked `defn` is well-formed only when accompanied in the same scope by a `defn Name@(..)` of the same name; an operator-only declaration is rejected at compile time. This mirrors the `%` and comprehension hook requirements (§3.1.1.2, §3.1.1.3).

**Admitted markers.** The operator markers admitted at declaration position fall into two categories:

- **Arithmetic** (`+`, `-`, `*`, `/`): binary operators over instances of the declaring namespace.
- **Equality** (`?=`): equality dispatch over instances of the declaring namespace. The hook returns a boolean.

Each admitted marker installs a hook of signature `(inst, rhs)` where `inst` is the LHS instance and `rhs` is the RHS operand.

**Canonical `?=`; `!=` derives.** The `!=` operator at call sites cannot be independently attached; its behavior against an instance whose namespace declares `?=` is the boolean negation of the `?=` hook's result. `defn Foo!=(..)` parses at declaration position but is rejected at compile time with a directive to declare `defn Foo?=(..)` instead. Parallels the alias-normalization rule for `~<` (§3.1.1.3).

**Ordering operators.** The ordering markers (`?<`, `?>`, `?<=`, `?>=`, `?<=>`, `?<>`) are not admitted at declaration position and cannot be attached per-namespace. Their behavior against namespaced instances is not dispatched through the namespace; ordering follows the language-level primitive rules from §9. Ordering operators may internally consult a namespace's `?=` hook where the comparison collapses to equality, but the ordering operators themselves are not intercepted.

**Adjacency.** Strict no-trivia between the identifier and the marker, mirroring `Foo@`, `Foo%`, and `Foo~<glyph>` at their declaration positions. For the two-token `?=` and `!=` composites, strict no-trivia between the composing tokens, matching the composite-operator adjacency rule at call sites (§10). Trivia is admitted between the marker and the first paren-set (mirrors normal `defn` paren spacing).

**Parameter constraints.** Exactly one parameter list (multi-tier / curried is not admitted; the binary call site `a + b` has no natural currying surface). The parameter list declares exactly two parameters, neither of which may be a gather parameter. The first parameter binds to the LHS instance; the second binds to the RHS operand. Any other shape is rejected at compile time.

**Missing hook at call site.** When the LHS at a binary call site is a namespaced instance and the namespace has not declared the corresponding hook, the expression is rejected at compile time. There is no primitive fallback for user namespaces: an instance of a user namespace declaring `+` but not `-` does not silently fall through to numeric arithmetic on `-`.

Primitive dispatch on non-namespaced operands is unaffected. `2 + 3`, `"a" + "b"`, and other non-instance operands continue to route through their language-level operator semantics per §1.3 and the corresponding tier in §9. Only LHS values carrying a namespace identity (per §3.8) engage the hook-dispatch route.

**Multi-decl uniqueness.** At most one hook per marker per namespace per scope; multiple declarations of the same marker on the same namespace are rejected at compile time.

**Interaction with fold comprehensions.** When a namespace declares `+` but does not declare `~fold` (respectively `~foldR`), fold call sites over instances of the namespace default to composing the `+` hook: the initial value seeds the accumulator, and `+` is applied left-to-right (or right-to-left for `~foldR`). An explicit `~fold` / `~foldR` hook, when declared, takes precedence over this default.

#### §3.1.2 Named Expression Form

```java
def double: defn double(v) ^v * 2;
```

The `defn name(params) body` syntax in expression position produces a function value. The name is in scope **only inside the function body**; it exists for self-reference. The enclosing scope sees no `double` binding from the function literal itself; only the `def double:` outside introduces a binding there. The two `double` names happen to coincide in this example by convention; they are distinct bindings in distinct frames.

The inner and outer names need not match:

```java
def f: defn double(v) ^v * 2;
```

Here `f` is in the enclosing scope; `double` is in the function body's scope only. Outside the function, `double` is not defined.

#### §3.1.3 Anonymous Expression Form

```java
def double: defn(v) ^v * 2;
```

`defn(params) body` produces a function value with no name binding in any scope. There is no self-owned self-reference name; recursion would rely on a name binding in the enclosing scope:

```java
def factorial: defn(n) {
    ^?{
        [n ?= 0]: 1;
        [n ?<= 2]: n;
        : n * factorial(n - 1)       // recursive call
    };
};
```

**NOTE:** Relying on a non-local name for recursion may stylistically be considered a "layering" violation to be avoided where possible.

### §3.2 Parameter Lists

A parameter list (Syntactic-Grammar `ParameterList` and `GatherParameter` at §13) is a comma-separated sequence of parameter entries enclosed in `( )`. A function literal carries one or more parameter lists; multiple lists indicate a multi-tier (curried) shape (§3.2.5).

A parameter entry may take one of the following shapes:

- **Identifier parameter** (§3.2.1): `x`
- **Default-valued parameter** (§3.2.2): `x:? expr`
- **Destructure parameter** (§3.2.3): `<:a, :b>` (with contextually required `: source` tail, where source is otherwise not receivable)
- **Gather parameter** (§3.2.4): `*args` (single parameter list)

#### §3.2.1 Identifier parameters

```java
defn add(x, y) ^x + y;
```

At call time, the parameter list opens a fresh frame (§2.11); each identifier parameter is bound to one positional argument value from the call site, by source position. If the call omits an argument at that position, the parameter is bound to `empty` (§1.1, §3.10.1).

#### §3.2.2 Default Parameter Values

A parameter may carry a default expression, introduced by the `:?` sigil:

```java
defn add(x:? 0, y:? 0) ^x + y;
```

The `:?` sigil reads as **conditional definition**: `:` marks the value that binds, and the trailing `?` marks that the binding is a conditional override that fires only when the positional argument at this slot is empty. This joins the family of `:`-anchored sigils -- `:` defines, `:=` re-defines, `:?` conditionally-defines -- with the trailing character marking the role modifier. `:?` is distinct from the unconditional `:` sigil used at `def` statements and other no-external-source binding positions (§2.9.2, §2.9.3, §3.5), where no override decision is meaningful.

**Abstract execution at call time:**

1. For each parameter in source order:
    1. If the call site supplied a non-empty positional argument value at this position, bind the parameter to that value; the default expression is not evaluated.
    2. Otherwise, evaluate the default expression **in the frame of the in-progress call** (parameters bound earlier in the same list are visible); its value overrides the empty positional and binds to the parameter.

Default expressions can reference parameters that appear earlier in the same parameter list:

```java
defn rect(width, height:? width) ^width * height;

rect(5);                            // 25
rect(5, 3);                         // 15
```

A default expression that references a later parameter is a forward reference: the later parameter has not yet been defined, and this results in an error. However, as with forward references in `def` statements, `Lazy@` (§2.2) can be used to create a deferred resolution:

```java
defn rect(width:? Lazy@ height, height) ^width * height;

rect(5);                            // 25
rect(5, 3);                         // 15
```

#### §3.2.3 Destructure Parameters

A destructure parameter takes the form of a destructure target (§2.13), optionally with an explicit `: source` tail:

```java
defn area(<:width, :height>) ^width * height;

area(< width: 5, height: 3 >);      // 15
```

**Abstract execution at call time:**

1. Bind the positional argument value at this parameter's position to an internal slot.
2. Apply the destructure target to that internal slot per §2.13, introducing the named bindings into the call frame.

If the parameter carries an explicit `: source` tail, the source expression is evaluated in the call frame (parameters earlier in the list visible) and that value becomes the destructure source, overriding the positional. The positional value at this slot is then unused.

A destructure parameter without a positional argument receives `empty` as its source value; destructure against `empty` results in an error. A destructure parameter with a default structure value avoids this error:

```java
defn area(<:width, :height>: <>) ^width * height;

area(< width: 5, height: 3 >);      // 15
```

**Open:** Decide if destructuring should provide a mechanism for defaulting each assignment, such as `< :foo = 2 >`.
```

### Replace with

```
#### §3.2.3 Destructure Parameters

A destructure parameter takes the form of a destructure target (§2.13), optionally with an explicit `:? source` fallback tail:

```java
defn area(<:width, :height>) ^width * height;

area(< width: 5, height: 3 >);      // 15
```

**Abstract execution at call time:**

1. Bind the positional argument value at this parameter's position to an internal slot.
2. Apply the destructure target to that internal slot per §2.13, introducing the named bindings into the call frame.

If the parameter carries an explicit `:? source` fallback tail, the source expression is evaluated in the call frame (parameters earlier in the list visible) only when the positional argument at this slot is empty; its value then overrides the empty positional and becomes the destructure source. When the positional argument is non-empty, the source expression is not evaluated and the positional value is used directly as the destructure source. The `:?` sigil is the same conditional-definition sigil used at simple parameter defaults (§3.2.2), applied here to the destructure source instead of a scalar binding.

A destructure parameter without a positional argument receives `empty` as its source value; destructure against `empty` results in an error. A destructure parameter with a `:?` fallback tail avoids this error:

```java
defn area(<:width, :height> :? <>) ^width * height;

area(< width: 5, height: 3 >);      // 15
```

#### §3.2.4 Gather Parameter

A variadic function (accepting a varying number of inputs) is defined with a single gather parameter, with the `*` sigil prefixing the parameter name:

```java
defn allFlags(*flags) ^(?and)(...flags);

allFlags(true, true, false);        // false
```

At call time, all positional arguments are collected into a Tuple value and bound to the gather identifier. If no arguments are passed, the binding is the empty Tuple `< >`.

The gather parameter cannot define a default value.

#### §3.2.5 Multiple Parameter Sets

A function literal may carry multiple parameter-list groups:

```java
defn buildURL(origin)(path)(query)
    ^`"`origin``path`?`query`";
```

This declares what's traditionally recognized as a **curried** function value: each tier is called separately, and each call returns either a function expecting the next tier (when more tiers remain) or the final body result (when the innermost tier has just been called).

The more verbose equivalent:

```java
defn buildURL(origin) ^defn(path) ^defn(query)
    ^`"`origin``path`?`query`";
```

**Important: Foi's curried defn is one logical parameter list.** Paren-grouping designates call-shape tiers; it is *not* a closure-scoping boundary in the user's mental model. The bodies of all tiers share a single frame at call completion: parameters from outer tiers are visible inside the body alongside parameters from inner tiers.

**Abstract execution at call time:**

1. Calling the outer-tier-bearing function value with the outer-tier arguments produces a function value over the next tier, with the outer-tier parameters bound in its closure frame.
2. Each successive call accumulates bindings until the innermost tier is called.
3. After the innermost call, the body executes in the accumulated frame.

A curried `defn` will not automatically "spread" a call with multiple arguments across the separate curried calls. To call a multi-tier function with a single multi-argument list, uncurry it at the call site with the `\/` uncurry operator (§3.12.3):

```java
buildURL\/("https://my.site", "/api/find", "name=getify");
```

Tier-shape constraints:
- A gather parameter `*args` may appear only in a single-tier `defn`. Grammar admits the multi-tier-with-gather shape (`defn f(x)(*args) ^..`); rejection lives at the semantic layer's shape-check pass, not at the grammar layer.
- Destructure parameters may appear at any tier.
- Defaults may appear at any tier.

### §3.3 Function Body Forms

A function body (Syntactic-Grammar `FuncBody` at §13) has one of three surface shapes. All three produce a single return value; multi-exit selection is expressed by pattern matching inside the body, not by multiple return statements (see §3.4 for the single-`^` rule).

#### §3.3.1 Concise return: `^expr`

```java
defn double(v) ^v * 2;
```

**Abstract execution at call time** (after parameter binding per §3.2):

1. Evaluate `expr` in the call frame.
2. The function's return value is the result.

The concise body admits five inner shapes: a do-comprehension (`~<<` bind or `~<*` loop), a match expression (`?{...}` or `?(x){...}`), any expression at the `OrDispatch` tier or narrower (arithmetic, compare, boolean, unary, chain access, calls, literals), or a `(...)`-wrapped escape hatch. Formally: `DoComprExpr | DoLoopComprExpr | MatchExpr | OrDispatch | GroupedExpr` (§13 grammar).

```java
defn foo(x)(y)(z) ^x * y * z;

defn drain(ch) ^Channel ~<* (v:: ch) { v };

defn classify(n) ^?{
    [n ?< 0]: "negative";
    [n ?= 0]: "zero";
    : "positive";
};
```

Forms whose leading tokens would extend rightward without an unambiguous visual close -- arbitrary `FlowBinExpr` chains (`x ~map f ~map g`, `x #> f #> g`, `f +> g`), `:as`-tailed inners (collides visually with the function's own `:as`), guard expressions (`?[c]: body`), assignments (`x := 5`), inner `defn` definitions -- are not admitted at the terse position. Each requires paren-wrap through `GroupedExpr`:

```java
defn withMap(xs) ^(xs ~map inc);
defn typed(x) ^(x :as int);
defn guarded(x) ^(?[x ?> 0]: 1);
defn withInner() ^(defn(y) ^y + 1);
```

Bare `^{...}` is also a parse error; the `{` sitting directly against `^` visually collides with the block body form (§3.3.2). To return a bare block value, paren-wrap: `^({ x; y })`.

This narrowing is the **visual-runway principle**: the tokens between `^` and any inner `{` must signal the body's shape unambiguously (an operator like `~<<`, a sigil like `?`, or a paren mark). At small function-body distances the eye should never need to look ahead to disambiguate the return value's scope from the surrounding function's clauses. Explicit paren-wrapping restores the runway for any form that would otherwise blur it.

#### §3.3.2 Block body: `{ stmts; ^expr; }`

```java
defn process(v) {
    def doubled: v * 2;
    ^doubled + 1;
};
```

**Abstract execution at call time** (after parameter binding):

1. Allocate the body's frame (parent: the call frame; see §2.9.1).
2. Evaluate each statement in source order.
3. If a `^expr;` statement executes, evaluate `expr` and immediately return that value as the function's return value.
4. If the block completes without executing any `^`, the function returns `empty` (§3.10.11).

**Single-`^` Rule:** A block body may contain **at most one** `^` return statement, and if present it must be the body's final statement (aside from `defn` function declaration statements or `deft` type annotations). Alternate exit values are expressed by placing a pattern match or guard inside that single `^`:

```java
defn classify(n) {
    ^?{
        [n ?< 0]: "negative";
        [n ?= 0]: "zero";
        : "positive";
    }
};
```

This rule is what makes Foi's tail-position analysis a structural property of the AST rather than a control-flow analysis (§3.4).

#### §3.3.3 Pipeline body: `#> stage #> stage ...`

```java
defn compute(x) #> add(1) #> triple #> half;
```

This function body is sugar for `^(x #> add(1) #> triple #> half)`, where `x` is the outermost tier's first positional parameter.

**Abstract execution at call time** (after parameter binding):

1. The seed value is the binding held by **the outermost parameter list's first positional parameter**, regardless of how many tiers the function declares.
2. The pipeline chain is evaluated per §3.10.12 with the seed as initial topic.
3. The function's return value is the chain's final stage result.

**Outermost-seeds rule rationale.** A multi-tier function like `defn f(x)(y) #> stage` seeds the chain with `x`, not `y`. Paren-grouping designates only call shape; the function still presents one logical parameter list, and "the first positional" means the first positional.

**Constraints on pipeline-body parameter shapes:**
- The seed parameter must be an Identifier or a DestructureTarget (named binding or destructure binding).
- If the seed is a DestructureTarget, the **whole positional value** flows into the chain as seed, not any destructured name. Destructured names are in scope and reachable, but the stage-1 input is the positional value itself.
- A gather parameter as the seed is single-tier only.

### §3.4 Proper Tail Calls

Foi ensures **proper tail calls (PTC)**: evaluation of a chain of tail calls consumes O(1) frames beyond the entry frame, regardless of chain length. This is a normative semantic property; implementation strategy (frame reuse, trampolining, native call rewriting, CPS lowering, etc.) is not constrained. A host that cannot deliver constant stack space across tail-call chains is non-conformant on this aspect.

**Tail calls are not limited to recursion.** Any function call in a tail position consumes O(1) stack against the next call's entry. This applies to mutual recursion, indirect dispatch, and calls to unrelated functions equally.

#### §3.4.1 Tail-Position Eligibility

A position in a function body is **tail-position-eligible** if the expression at that position is a function call whose result value can flow out of the enclosing function without further computation. This applies to *any* function call at such a position -- not only self-recursive calls. Mutual recursion, indirect dispatch, and calls to unrelated functions all qualify equally. For example, `n * fact(n - 1)` is NOT a tail call (the `*` operator consumes the call's result before it can flow out); `fact(n - 1, curTotal)` at a return position is a tail call.

Eligible positions (presuming the expression itself is a function call), defined structurally:

1. **Function Body Return:** With `^e` inside a function body block, `e` is eligible. Recurse into `e`'s structure for further eligible sub-positions per the rules below.
2. **Concise Function Return:** Same as (1), for `^e` as a concise function body.
3. **Independent Match Consequents:** In an eligible `?{ [c1]: e1; [c2]: e2; : e_else; }`, each consequent `e1`, `e2`, `e_else` inherits eligibility from the match position.
4. **Dependent Match Consequents:** Same as (3), for `?(match){ ... }` dependent match form.
5. **Guard Consequent:** In an eligible `?[c]: e` (or `![c]: e`), the consequent `e` inherits eligibility from the guard position. (The guard-fail path returns `empty`, which is a value-leaf, not a call site.)
6. **`:as` Annotation:** In an eligible `e :as T`, the position of `e` is eligible, if and only if the `:as T` is (per compiler analysis and/or configuration) resolvable or erasable, and thus not deferred for runtime assertion.
7. **Pipeline Expression:** In an eligible pipeline expression `x #> e1 #> e2 #> e3`, the final expression position `e3` inherits eligibility. Intermediate stages have their results consumed by the next stage's dispatch; intermediate calls are not tail calls. (Implementations are nonetheless free to evaluate the pipeline with constant stack regardless of tail-position labeling, because each stage's value is fully resolved before the next stage runs; no frame is held by the dispatch itself.)
8. **Pipeline Function Body:** Same as (7), for `defn f(x) #> e1 #> e2 #> e3`, only `e3` inherits eligibility.

##### §3.4.1.1 Non-Eligible Positions

These positions are generally *NOT* tail-call eligible:

- Operator operands: `^f(x) + 1`.
- Call arguments: `^h(f(x))`: `f(x)` is consumed as an argument; `h(..)` itself is eligible as the tail call.

    **NOTE:** This is the same reasoning as `x #> f #> h`, which makes `h(..)` eligible but not `f(..)`.
- Statement-level positions: In `{ f(x); ^42; }`, the value of `f(x)` is not in a return position.
- Binding initializers: In `{ def y: f(x); ^y; }`, `f(x)` is consumed by the binding, not the return. See §3.4.1.2.
- Inside a bare block expression used as `^`'s operand: In `^{ stmts; lastExpr; }`, `lastExpr` is the bare block's completion value (§2.9.1), not a return path -- the block itself is in the return path. See §3.4.1.2.

##### §3.4.1.2 Position Transformation

Non-normative: the Foi compiler may statically analyze other constructs besides the explicitly eligible list, for expanded tail-call eligibility; if it can statically guarantee a transformation to one of those forms, the function call may adopt apply tail-call behavior.

For example:

```java
defn recur(n) {
    // ..

    def res: recur(n - 1);      // not tail call eligible

    ^res;                       // not a function call
};
```

The Foi compiler may determine it can safely fold the last two lines of that function body into:

```java
^recur(n - 1);      // now, tail call eligible
```

The compiler may or may not apply such transformations, depending on conditions in the code and compiler configuration.

#### §3.4.2 Tail calls

A **tail call** is a function call whose call-expression is itself the entire content of an eligible position -- meaning the call's result is the function's result. An expression like `f(x) + 1` at an eligible position contains a call to `f`, but the call is not a tail call because `+` consumes the call result after it returns.

Tail calls require the return expression to, as its last operation, invoke a function call.

Examples:

```java
defn loop(state) ^?{
    [done(state)]: result(state);      // tail call
    : loop(step(state));               // tail call (recursive)
};

defn check(x) ^?[x ?> 0]: process(x);  // tail call (guard consequent)

defn pipeline(x) #> stageA #> stageB #> stageC;
// Only `stageC` invocation at chain end is a tail call.

defn add1(x) ^f(x) + 1;       // NOT a tail call (operator consumes)

defn nested(x) ^h(f(x));      // f is NOT tail; h IS tail
```

#### §3.4.3 Single-`^` and PTC

The single-`^` rule (§3.3.2) is what allows tail-position eligibility to be a purely structural property of the AST. Because a function has at most one explicit return statement, multiple exit *values* must come from pattern-matching or guarding inside that one return; those constructs propagate eligibility to their consequents per §3.4.1. This is the design choice that lets PTC be specified without control-flow analysis.

### §3.5 Preconditions

A function definition may carry one or more **preconditions** (Syntactic-Grammar `FuncPrecondList` at §13) between the parameter lists and the body:

```java
defn safeDiv(x, y)
    ?[y != 0]: empty        // precondition
    ^x / y;

defn clamp(x)
    ?[x ?< 0]: 0            // precondition
    ?[x ?> 100]: 100        // precondition
    ^x;
```

A precondition is syntactically the same as a guard-expression: `?[cond]: consequent` or `![cond]: consequent`.

**Preconditions are call-site guards, not part of function body proper.** They are evaluated *after* the arguments have been resolved and name-bound, but *before* the function itself is invoked. Preconditions may reference formal parameters and any binding closure-captured from the callable's defining scope; bindings from the function body's own scope are not visible (the body has not been entered).

**Abstract execution at call time:**

1. Bind parameters per §3.2 in a fresh, provisional frame (no body heap allocation yet).
2. Evaluate each precondition in source order. For each:
    1. Evaluate the CondClause `[cond]` (or `![cond]`); see §4 for full guard semantics.
    2. If the clause matches:
        1. Evaluate `consequent` in the call frame.
        2. The function's return value is the consequent value; subsequent preconditions and the body are not evaluated.
        3. **The call is complete.** The body is not entered.
    3. If the clause does not match, proceed to the next precondition.
3. If no precondition matches, execute the body per §3.3.

**Runtime dispatch.** A callable declaring one or more preconditions carries a `pcheck` slot alongside its body. The `pcheck` value is a callable compiled from the precondition chain, closing over the same defining scope as the body. At each call site, the compiler emits a dispatch shape: if the callee carries a `pcheck`, `pcheck` is invoked first with the argument list; a matching precondition short-circuits to the matched consequent value, which occupies the call site's return position; no-match tail-calls the body with the same arguments. Callables without preconditions carry no `pcheck` slot; call sites at those callees skip the dispatch and invoke the body directly. This dispatch is uniformly emitted at every call site, so first-class function values and higher-order dispatch inherit the pcheck-carrying property transparently.

**No effect perform-sites in preconditions.** A precondition's guard expression and its consequent expression may not syntactically contain the `%` effect-perform operator (or its `<::` sugar); the compiler statically rejects any perform-site inside a `FuncPrecondList` clause. Effects reached indirectly through called functions follow standard §6.13 tracking against the outer callable's call site.

### §3.5.1 Multi-Parameter Function Preconditions

For multi-parameter (curried) function definitions with preconditions, the compiler will lift each precondition to the earliest tier at which all *parameter* references in the precondition -- both those in the guard and those in the consequent -- are bound. Closure-captured references from the defining scope are reachable at every tier (they are bound before any tier fires) and do not gate lifting; only parameter references do.

Consider these two function definitions:

```java
defn add(x)(y)(z)
    ?[x ?< 0]: Left@ "Undefined"
    ?[y ?< 0]: Left@ "Undefined"
    ?[z ?< 0]: Left@ "Undefined"
    ^x + y + z;

defn mult(x)(y)(z)
    ?[(?or)(x ?< 0,y ?< 0,z ?< 0)]: Left@ "Undefined"
    ^x * y * z;
```

Now consider these call-sites:

```java
add(2)(-3)(4);      // Left<"Undefined">
add(-5);            // Left<"Undefined">

mult(2)(-3)(4);     // Left<"Undefined">
mult(-5);           // defn(y)(z)
```

Conceptually, preconditions guard the initial function call. That's why the `add(-5)` fails eagerly, instead of returning a function to defer the check until later. The verbose granularity of the pre-conditions on `add()` allows for that early failure.

But since the precondition on `mult()` requires all three parameters to be evaluated, the precondition must wait for the final function call (as in `mult(2)(-3)(4)` to evaluate the precondition, rather than failing at `mult(2)(-3)` or at `mult(-5)`).

### §3.5.2 Precondition Tail Calls

Function preconditions operate as guard expressions; if the function call itself is already tail-eligible (§3.4), and a matching precondition contains a tail-eligible function call in its consequent, then *this* consequent function call is eligible to operate as a tail-call.

For example:

```java
// only valid
defn factorial(n,res:? 1)
    ?[n ?< 0]: Left@ "Undefined"
    ?[n ?> 1]: factorial(n - 1,n * res)
    ^res;
```

In this example, both the `Left@` call and the `factorial(..)` recursive call are tail-call eligible.

### §3.6 Mutable Closure-Capture Declaration: `:over`

A function literal may carry a `:over (name, name, ...)` clause (Syntactic-Grammar `FuncOverClause` at §13) between the function's preconditions (if any) and its body (but before any `:as`):

```java
defn lookup(id) :over (cache) {
    cache := cacheAppend(cache,lookupRemote(id));
    ^cache;
};
```

**Mutability and closure-capture rule.** A binding (`def`) is internally flagged as **mutable** if it is the target of any `:=` reassignment anywhere in a scope it's accessible within (§2.3). A function literal that closes over a mutable binding from its enclosing scope **MUST** list that binding in its `:over` clause.

**Direct closure only.** `:over` declares **direct** closure references within the function itself.

If a nested function closes over a mutable variable, that nested function requires an `:over()` annotation for the mutable variable; but the parent function does not need an `:over()` unless it makes its own reference to a mutable closure.

```java
def counter: 0;

// no direct reference to `counter`, so no need
// for an `:over` here
defn incTwice() {
    inc();
    ^inc();

    // directly references `counter`, which is
    // mutable; `:over(counter)` required
    defn inc() :over(counter) {
        counter := counter + 1;
    };
};
```

**Constant bindings need no `:over`:**

```java
def pi: \3.14159;                        // never reassigned → constant

defn area(r) ^pi * r * r;               // no :over needed
```

### §3.7 Type Annotation: `:as`

A function literal may carry a `:as Type` clause (Syntactic-Grammar `FuncAsClause` at §13):

```java
// deft AddFunc (int,int) ^int

defn add(x, y) :as AddFunc ^x + y;
```

`:as` on a function always references a function type (§9). For §3's purposes:

- `:as Type` is transparent at runtime; it imposes no behavior beyond what §9 specifies.
- `:as` appears once, after any `:over` clause and before the body.
- The type slot admits only a bare `Identifier`, not the broader `NamedType` production used in `AsAnnotationExpr` (§5). This narrowing is intentional: the `defn` declaration grammar is already substantially complex, and confining `FuncAsClause` to an identifier reference to a `deft`-declared function type keeps the function-signature surface tractable. To annotate with a compound type expression, declare a `deft` binding for that type and reference it by name.

### §3.8 The `@`-Call Operator

The `@` operator (Syntactic-Grammar `AtCallExpr` at §7 for the call form; `AtRefTail` at §7 for the reference-extraction form `Foo.@`) is Foi's constructor dispatch. Foi has a family of operators that dispatch through user-declared bindings.

Each operator's behavior against a value is not fixed at the language level; it is delegated to the binding that value was constructed through.`@` is the first and most fundamental member of this family.

It invokes a **type namespace**: a binding whose name serves as a type identity, a constructor when invoked, and a dispatch target when values constructed through it appear in an operator position. A single binding slot (e.g., `Maybe`, `IO`, `List`, `Vector`) plays all three roles. `?as Maybe` and `:as Maybe` check namespace identity; `Maybe@x` invokes the namespace's constructor hook; `inst%` (§3.9) dispatches an effector hook on the same namespace.

The family's operators split by where they read their dispatch target. `@` reads it from the LHS namespace handle directly: `Foo@x` looks up `Foo`'s constructor hook. Operators that act on constructed values -- `%` in the next section, and eventually others -- read the dispatch target from the value itself, which carries a runtime tag identifying its owning type namespace. Both routes converge on the same rule: the operator's behavior against a value is the behavior the value's type namespace declared for that operator.

The result is a namespace-attached operator system that behaves as a typeclass in the ad-hoc-polymorphism sense: a type namespace's set of declared hooks IS the set of operations that admit its instances. The namespace is the main entity; there is no separate class abstraction, no external instance declarations, no orphan installations. A hook is well-defined only against the namespace that declared it; a hook is invoked only against values that identify with that namespace.

The family's operator vocabulary is closed. Additional dispatch operators are added only from the existing language operator set: arithmetic, comparison, comprehension, and shape-transform operators are candidates; flow operators (`#>`, `+>`, `<+`), partial-application brackets, and access operators are not. No user-defined operator symbols, and no changes to an operator's precedence, arity, or operand contract when dispatched through a namespace. Each dispatch operator's behavior against namespaced values is a language-level extension of that operator's existing semantics, not a replacement of them.

`@` is the constructor-side member of the family. The symbol `@` is a unary call operator with an optional left-hand callee. With a callee, it dispatches a call to that function (subject to an opt-in marker on the function's definition). Without a callee, it has nothing to dispatch to, and the operator passes its right-hand value through unchanged.

This single mechanism underlies both `@`'s call-position use and its value-position use as the unary value-identity function; the latter is the former with the callee slot empty.

#### §3.8.1 `@` Used Without a Callee

When `@` is used with no left-hand callee, it's the "identity function"; it has nothing to dispatch to and passes its right-hand value through unchanged. `@v` evaluates to `v`.

```java
def x: @42;                              // 42
def y: @(1 + 2);                         // 3
```

To reference the `@` operator as a first-class function value, use the standard operator-as-function lift form `(@)`. This matches the rule applied to every other operator: bare-operator-in-value-position is not admitted; `( )` is required to lift an operator up to a value (e.g., `(+)`, `(?and)`, `(@)`). The LHS-less *use* form `@v` is a special-case of the operator being applied with no callee, not the operator referenced as a value.

`(@)` is **arity-polymorphic:** it dispatches at call time on the number of arguments supplied, mirroring the `@`-call operator's LHS-presence dispatch at the lifted-function layer:

- **0-arg:** returns `empty`:

    ```java
    (@)();      // empty
    ```

- **1-arg:** returns the argument unchanged. This is the **unary value-identity function**, equivalent in effect to `@v` at the operator-use level.

    ```java
    (@)(7);       // 7
    ```

- **2-arg:** treats the first argument as a callee (must have been opted into the `@`-call syntax; §3.1.1.1) and the second as the call-time argument; semantically equivalent to invoking the first against the second.

    ```java
    // assumes:
    // defn double@(v) ^v*2;

    (@)(double, 7);    // 14 :: double@(7)
    ```

The `@` operator returns a runtime error if called with 3+ arguments.

The prime form `(@')` reverses argument order for the 2-argument arity: swaps to `(arg, callee)` order -- semantically equivalent to invoking the second against the first.

#### §3.8.2 Reference Extraction Via `.@`

`Foo@` alone is uniformly a call form regardless of the constructor's declared arity (§3.10.7): with an argument trail (`Foo@x`) or without (`Foo@`), the `@`-call form dispatches the constructor. There is no arity-based ref-vs-call distinction on the `Foo@` shape.

To extract the constructor as a first-class function value, use the reference form `Foo.@`:

```java
def doub: Double.@;       // reference to Double's constructor
```

The extracted value is a **marker-preserving function reference**: it carries the `@`-marker flag through to the binding it lands in. Calling the extracted reference re-enters the `@`-call dispatch machinery via the binding's name:

```java
doub@ 42;                 // 84
```

Passing the extracted reference as a callback works the same way: the marker travels with the value, and any receiver that dispatches through it does so via the `@`-call form.

**Adjacency.** The `.@` form is strict no-trivia on both sides: `Foo. @`, `Foo .@`, and `Foo . @` are all parse errors. This stricter rule (versus the trivia-tolerant `Foo@`) matches the form's chain-terminator semantics; there should be no variance around where the access chain ends.

**No trailing forms.** `Foo.@` admits no chained tail. `Foo.@(x)`, `Foo.@%`, `Foo.@'`, and `Foo.@.bar` are all rejected. To use the extracted reference in any of those roles, first bind it into a name:

```java
def cons: Foo.@;
cons@x;                                  // call the extracted reference
```

**Operator-as-function alternative.** For the specific case of two-argument application `(callee, arg)`, the operator-as-function form `(@)(Foo, x)` (§3.8.1, §3.13) is available. Where `Foo.@` extracts the reference into a value, `(@)` lifts the operator into a callable that performs the dispatch inline.

#### §3.8.3 The Two Roles Are One Operator

The value-position and call-position uses of `@` are not two separate facts but one operational rule applied with different LHS conditions:

> `@` is the unary call operator with an optional LHS callee. With a callee, it dispatches the call (subject to the `@`-marker contract on the callee's definition). Without a callee, it passes the RHS through unchanged.

The value-identity behavior in value position is what the operator does when there is no callee to call. The call behavior in call position is what the operator does when there is one. The marker requirement on `@`-marked function definitions is a contract on the callee side; it does not affect the LHS-less use form `@v`, which always behaves as identity.

#### §3.8.4 Namespace-Value Identity

A namespace name is a first-class value (per §3.8's four-way collapse: identity, constructor, dispatch target, plus value-position use). At value position, a namespace value participates in `?=` structural-equality comparison with identity semantics: two namespace values are `?=`-equal exactly when they name the same namespace.

```java
List ?= List;                    // true
List ?= Maybe;                   // false
Maybe ?= Either;                 // false
```

The comparison is between **namespace values themselves**, not between instances constructed through those namespaces. `?as`/`:as` (§5) already handle namespace-identity checks *on instances*; `?=` on namespace values handles namespace-identity checks *on the namespaces as values*. The two mechanisms are distinct and non-overlapping.

Namespace values are equal to themselves only. They are not `?=`-equal to any non-namespace value, regardless of coincidental shape: a namespace value is never `?=`-equal to a Record, Tuple, function value, or any primitive.

**Use in Tuple literals.** Because namespace values are first-class, a Tuple literal may hold namespace values as entries, and pattern-match `?=` atoms may test against such Tuple literals:

```java
def ty: < List, Promise >;

?(ty){
    [< List, Promise >]:    // matches: both entries ?=-equal
        "list of promises";
    [< Maybe, Either >]:    // does not match
        "unreachable here";
    :
        "other shape";
};
```

**NOTE:** The dependent match atoms in the above snippet rely on implicit `?=` -- matching `ty` to `< List, Promise >`, for example -- but `?=` could have been explicitly added: `[?= < List, Promise >]`.

The primary consumer of this mechanism is the dispatch-type introspection surface (§3.10.9.7), where hooks receive a Tuple of namespace values reflecting compound-LHS shape and dispatch on it via pattern match.

### §3.9 The `%` Effector Call Operator

The symbol `%` (Syntactic-Grammar `EffectorTail` at §7) is an effector call operator against an instance value, with an optional right-hand environment operand.

It dispatches an effector call through the instance's owning namespace, subject to an opt-in `%`-marked hook (§3.1.1.2) on that namespace. If the namespace declares no such hook, the `%`-call is a type error. Value-like namespaces that want their instances to admit `%` calls without an effect declare an explicit identity `%` hook (per the `Lazy@` pattern at §2.2.9; see §3.9.1).

Where `@` invokes a namespace as a constructor (§3.8), `%` invokes an instance's namespace as an effector. An instance carries its namespace identity as a runtime contract, established at construction; `%` reads that identity to route dispatch.

The full dispatch routing is specified with the call form in §3.10.8.

#### §3.9.1 No-Hook Rejection

If the instance's owning namespace declares no `%` hook, the `%`-call form is a type error:

- `inst%` where `inst`'s namespace defines no `%` hook is rejected.
- `inst % env` where `inst`'s namespace defines no `%` hook is rejected.

The rejection is **normative**. `%` requires a `%` hook to dispatch to.

Value-like namespaces (`Lazy@`, `Id@`, `None@`, etc.) that carry no effect but want to admit `%` calls MUST declare an explicit identity `%` hook:

```java
defn Identity@(v) ^v;

defn Identity%(inst) ^inst;      // explicit identity hook
```

This is the pattern established for `Lazy@` at §2.2.9. The identity hook exists so that `%` remains well-typed on the namespace's instances without requiring a language-level special case for value-like namespaces.

Note that this rejection is distinct from the rejection of `%` against a value with no namespace identity at all (e.g., a bare primitive `42%`); that case is diagnosed at §3.9's "`%` requires an instance whose namespace has been established through an `@`-marked construction" rule, not at the "no hook declared" rule here.

#### §3.9.2 Uniformly a Call Form

`%` admits no reference-extraction form. Unlike `@`, which supports `Foo.@` to extract the constructor as a first-class function value (§3.8), there is no `inst.%` form. Every syntactic use of `%` against an instance LHS is a call: it either dispatches to the effector hook, or is a type error if the instance's namespace declares no `%` hook (§3.9.1).

`%` also admits no LHS-less use form. `%v` is not a valid expression; `%` requires an instance LHS.

To reference the `%` operator as a first-class function value, use the operator-as-function lift form `(%)` (§3.9.3).

#### §3.9.3 `(%)` As A Function Value

The `%` operator lifts to a function value via the standard operator-as-function form (§3.13). `(%)` is a callable function whose application performs the `%`-call.

`(%)` is arity-polymorphic. It dispatches at call time on the number of arguments supplied, mirroring the `%`-call operator's LHS+RHS shape at the lifted-function layer:

- **1-arg:** `(%)(inst)` is semantically equivalent to `inst%`. If `inst`'s owning namespace declares a `%` hook, dispatch fires with `inst` as the sole argument; otherwise the call is a type error per §3.9.1.

    ```java
    (%)(taskInst);           // taskInst%
    ```

- **2-arg:** `(%)(inst, env)` is semantically equivalent to `inst % env`. If dispatch fires, the hook receives `(inst, env)`; otherwise the call is a type error per §3.9.1.

    ```java
    (%)(taskInst, myEnv);    // taskInst % myEnv
    ```

The `%` operator returns a runtime error if `(%)` is called with zero arguments or with 3+ arguments.

The prime form `(%')` reverses the 2-argument order to `(env, inst)`; semantically equivalent to `(%)(inst, env)` with arguments swapped.

### §3.10 Call Semantics

This section specifies what happens when a function value is invoked (Syntactic-Grammar `PrefixCallSuffix`, `AtCallExpr`, `EffectorTail` at §7). It covers the regular `foo(..)` call form and the alternate `@`-call and `%`-call forms.

#### §3.10.1 Argument Binding

A parameter tier (§3.2) takes one of exactly two shapes: zero or more positional non-gather parameters, or exactly one `*gather` parameter. The two shapes cannot mix within a tier.

**Abstract execution:**

1. Let `argumentExpressions` be a list holding, for each call-site argument slot in source order, either the source text of the argument expression or the distinguished marker `skip` for an empty slot (§3.10.4). Spread arguments are first expanded per §3.10.5.
2. Evaluate the callee `f` to a function value.
3. Let `arguments` be an empty list. For each entry in `argumentExpressions`:
    - If the entry is `skip`, append `skip` to `arguments`.
    - Otherwise, evaluate the expression in the **caller's** environment and append the value to `arguments`.
4. Allocate a fresh frame parented to the function value's captured frame.
5. Bind the outermost parameter tier of `f` per §3.2 against `arguments`:
    - **If the tier is all-positional non-gather** with parameters `p1, p2, ..., pK`: for each `pi` in order, bind to the value at position `i` of `arguments`. If position `i` is absent, is `skip`, or evaluates to `empty`, the parameter's default expression (§3.10.2) is evaluated if present; otherwise the parameter is bound to `empty`. Surplus arguments beyond position `K` are discarded.
    - **If the tier is a single `*gather` parameter**: bind the gather to a Tuple containing all values from `arguments`. Skip slots contribute `empty` entries. If `arguments` is empty, the gather binds the empty Tuple.
6. Evaluate preconditions per §3.5. If one matches, its evaluated consequent is the result of the function call expression; the function body is not evaluated.
7. Evaluate the body per §3.3.
8. The function return value (the value of the `^` expression that executed, or `empty` if no `^` executed) is the result of the function call expression.

#### §3.10.2 Parameter Default Evaluation

A parameter's default expression is evaluated only when the call provides no value at that parameter's position, the call provides a `skip` slot at that position (§3.10.4), or the call provides an expression that evaluates to `empty`.

Defaults evaluate in the **callee's** frame, after all preceding parameters in the same tier have been bound. A default expression may reference any earlier-bound parameter in the same tier, or any parameter from an outer (already-bound) tier:

```java
defn f(x, y:? x + 1) ^< :x, :y >;

f(5);                                    // < x: 5, y: 6 >
f(5, 10);                                // < x: 5, y: 10 >
f(5, empty);                             // < x: 5, y: 6 >
f(5, );                                  // < x: 5, y: 6 >

defn g(x)(y:? x * 2) ^< :x, :y >;

g(3)();                                  // < x: 3, y: 6 >
g(3)(10);                                // < x: 3, y: 10 >
```

Tiers act like nested frames: an inner-tier default resolves names by walking outward through already-bound tiers, exactly as the body would.

A default expression may not reference a later parameter in the same tier, nor a parameter in a not-yet-bound (inner) tier.

#### §3.10.3 Gather Binding

A `*gather` parameter takes the place of an entire tier; a tier is either all-positional non-gather (§3.10.1) or a single `*gather`. The two shapes do not mix within a tier.

The gather binds all positional arguments at that tier as a Tuple (§3.2.4). Skip slots contribute `empty` entries. If the tier receives no arguments, the gather binds the empty Tuple.

```java
defn collect(*nums) ^nums;

collect(1, 2, 3);                        // < 1, 2, 3 >
collect();                               // <>
collect(1, , 3);                         // < 1, empty, 3 >
```

A function that needs both leading fixed parameters and a gather expresses the gather as its own tier:

```java
defn tagged(label)(*items) ^< :label, :items >;

tagged("primes")(2, 3, 5);               // < label: "primes", items: < 2, 3, 5 > >
```

#### §3.10.4 Skip Slots

The call syntax permits empty slots:

```java
defn xyz(x, y, z) ^log(`"x: `x`, y: `y`, z: `z`");

xyz(1, , 3);                             // x: 1, y: empty, z: 3
```

A skip slot is recorded as the distinguished `skip` marker in `argumentExpressions` (§3.10.1) and contributes no evaluated expression. At binding time, a parameter that receives `skip` evaluates its default expression if present; otherwise it binds `empty`.

Skip slots are also admitted in partial application (§3.11).

#### §3.10.5 Spread Arguments

The call syntax admits `...expr` arguments in positional argument lists. Spread is evaluated and expanded before parameter binding.

**Abstract execution:**

1. Evaluate `expr` in the caller's environment. The result must be a Tuple, a List, or another iterable positional sequence.
2. Each element of the iterable contributes one entry to `argumentExpressions` at the position of the spread.

Spread may be combined with positional arguments and skip slots:

```java
def mid: < 4, 5, 6 >;

f(1, ...mid, 9);                         // 1, 4, 5, 6, 9
f(1, , ...mid);                          // 1, skip, 4, 5, 6
```

Tuple / List spread is positional-only: it is not admitted in a named-argument call (§3.10.6).

**Record spread as named-argument expansion.** A `...expr` slot whose `expr` evaluates to a Record with named slots expands each named entry `name: val` as a named-argument binding at the call site. Named-argument calls are subject to §3.10.6's rules for parameter-name resolution.

```java
def mid: < x: 4 >;

f(z: 6, ...mid, y: 5);            // x: 4, y: 5, z: 6
```

The all-positional-or-all-named non-mixing rule extends uniformly: a call whose argument list contains a Record spread is a named-argument call, and cannot contain positional arguments, skip slots, or Tuple / List spreads. A call whose argument list contains positional arguments, skip slots, or Tuple / List spreads is a positional call, and cannot contain named arguments or Record spreads. The two shapes remain disjoint within a single call.

#### §3.10.6 Named Arguments

A regular function call (not `@` or `%`) may bind arguments by parameter name instead of position:

```java
defn add(x:? 0, y) ^x + y;

add(x: 3, y: 4);                         // 7
add(y: 5);                               // 5 -- x defaults to 0
```

A single call must use either positional arguments (with optional skip slots and spread, per §§3.10.4 and 3.10.5) or named arguments; the two forms cannot be mixed within a single call.

**Abstract execution:**

1. Each named argument is bound to its corresponding parameter by name.
2. Parameters with no named argument evaluate their default expression if present, otherwise bind `empty`.

A named argument referencing a non-existent parameter is rejected at compile time.

In a multi-tier function (§3.10.9), the named-argument form applies to one tier at a time: each tier's call binds named arguments against that tier's parameter list only.

#### §3.10.7 `@`-Call Form

A function declared with `@`-suffix (§3.1.1.1) is invoked with the `@`-call form, **not** the parenthesized form. For an `@`-marked namespace `Foo`:

- `Foo@x` invokes the constructor hook with argument `x`.
- `Foo@` (no operand) invokes the constructor hook with `empty` as the argument; the parameter's default expression (§3.10.2) resolves if present.
- `Foo(x)` is rejected. Bare `Foo` is a namespace handle (§3.8), not a callable.

Whitespace around `@` is optional: `Foo@x`, `Foo @ x`, `Foo@ x`, and `Foo @x` are all valid call forms; `Foo@` and `Foo @` are both valid zero-operand forms.

The `@`-call form admits exactly zero or one operand. Spread arguments and named arguments are not part of this form.

**NOTE:** Parentheses following `@` are not call syntax; they are expression-grouping for the operand. `Foo@(x + 1)` is `Foo` applied to the value of `x + 1`, not a parenthesized argument list.

To reference the constructor hook as a function value, use `Foo.@` (§3.8). To invoke the operator-function form, use `(@)(Foo, x)` (§3.13).

The `@` operator, including how `Foo.@` resolves at call time and how the resulting instance carries its owning namespace identity, is specified in full in §3.8.

#### §3.10.8 The `%`-Call Form

An instance constructed through an `@`-marked namespace that also declares a `%`-suffix hook (§3.1.1.2) is invoked with the `%`-call form:

- `inst%` invokes the effector hook with `inst` as the sole argument.
- `inst % env` invokes the effector hook with `inst` and `env` as arguments.

Dispatch resolves the effector hook through the instance's owning namespace, carried as a runtime contract on the instance. Whitespace around `%` is optional.

If the instance's owning namespace declares no `%` hook, the `%`-call form is a type error per §3.9.1.

The `%`-call form admits exactly zero or one operand. Spread arguments and named arguments are not part of this form.

To invoke the operator-function form, use `(%)(inst)` or `(%)(inst, env)` (§3.9.3).

The `%` operator is specified in full in §3.9.

#### §3.10.9 The Comprehension-Call Form

An instance constructed through an `@`-marked namespace that also declares one or more comprehension-suffix hooks (§3.1.1.3) is invoked with a **comprehension-call form**:

```java
inst ~< fn;
inst ~map fn;
inst ~fold init fn;
```

The general shape is `LHS ~<glyph> operands...`, where `~<glyph>` is one of the comprehension markers admitted at §3.1.1.3 -- Tier 1 (`~<`, `~each`), Tier 2 (`~map`, `~ap`, `~filter`, `~fold`, `~cata`, `~foldR`), Do-comprehension (`~<<`, `~<*`), or one of the `~<` surface aliases (`~chain`, `~bind`, `~flatMap`).

Dispatch resolves the corresponding hook through the LHS's owning namespace, carried as a runtime contract on the instance (same mechanism as the `%`-call form, §3.10.8). The hook is invoked with the LHS as its first argument, followed by the operands the comprehension supplies (§3.10.9.2 fixes the operand shape per marker).

If the LHS carries no owning-namespace identity, the comprehension-call form is rejected: comprehension dispatch requires an instance whose namespace was established through an `@`-marked construction. `42 ~< fn` is rejected because `42` is not a namespaced instance.

##### §3.10.9.1 Alias Normalization

The `~<` bind hook has surface aliases at call sites: `~chain`, `~bind`, `~flatMap`. All four spellings normalize to the canonical `~<` marker at dispatch time:

```java
inst ~< fn;         // dispatches to ~< hook
inst ~chain fn;     // dispatches to ~< hook (alias)
inst ~bind fn;      // dispatches to ~< hook (alias)
inst ~flatMap fn;   // dispatches to ~< hook (alias)
```

Aliases resolve at the call site's dispatch step; a namespace's hook table carries only the canonical `~<` key, per §3.1.1.3's canonical-declaration rule.

No other comprehension marker has aliases. Every other marker is its own canonical spelling at both declaration and call sites.

##### §3.10.9.2 Operand Shape Per Marker

Each comprehension marker fixes the operand shape supplied at call time and threaded to the hook. The hook receives the LHS as its first parameter, followed by the operands in source order:

- `~<` (and aliases): one operand, a function of value-of-inst returning an inst of the same namespace. Hook signature: `(inst, fn)`.
- `~map`: one operand, a function of value-of-inst returning any value. Hook signature: `(inst, fn)`.
- `~ap`: one operand, an inst holding a value. Hook signature: `(fnInst, valInst)` -- LHS holds the function.
- `~each`: one operand, a function of value-of-inst returning either a value or a `Done@`-wrapped early-exit sentinel. Hook signature: `(inst, fn)`.
- `~filter`: one operand, a predicate function. Hook signature: `(inst, pred)`.
- `~fold`: two operands, an initial value and a folding function of `(accumulator, value)`. Hook signature: `(inst, init, fn)`.
- `~cata`: two operands, an initial-value thunk and a folding function of `(accumulator, value)`. Hook signature: `(inst, initThunk, fn)`.
- `~foldR`: two operands, an initial value and a folding function of `( accumulator, value)`. Hook signature: `(inst, init, fn)`.
- `~<<` and `~<*`: block operands per §16's do-comprehension grammar. Operand shape is fixed by the grammar; user override of the composition mechanism is via namespace-declared `~<<` or `~<*` hook per §3.10.9.4, with declaration-position admittance specified at §3.1.1.3.

##### §3.10.9.3 Missing-Hook Behavior

**Tier 1** (`~<`, `~each`): no language-provided default. A comprehension expression against a namespace that has not declared the corresponding hook is rejected at compile time.

**Tier 2** (`~map`, `~ap`, `~filter`, `~fold`, `~cata`, `~foldR`): the language provides defaults that compose over the namespace's declared primitives.

The `~fold` and `~cata` markers form a **mutual-defaulting pair**: they express the same catamorphism, differing only in the None-branch handler's representation (eager value vs. thunk). Missing-hook dispatch routes through the other member of the pair:

- `~fold` missing, `~cata` present: `(~fold)(inst, init, fn)` dispatches to the `~cata` hook with `() -> init` thunk-wrap.
- `~cata` missing, `~fold` present: `(~cata)(inst, initThunk, fn)` dispatches to the `~fold` hook with `initThunk()` evaluated eagerly (forfeits laziness -- the cost of not declaring `~cata`).
- Both missing: rejected at compile time.

For the remaining Tier 2 markers (`~map`, `~ap`, `~filter`, `~foldR`), the default composition expands over the namespace's declared `~<` primitive and its `@` constructor hook. Where the composition's structural precondition does not fit the namespace's shape (e.g., `~foldR` on an infinite structure; `~filter` on a namespace without an "empty of shape"), the expansion is rejected at compile time. Exact per-marker default-composition formulas are specified at each marker's §7 subsection.

##### §3.10.9.4 The `~<<` and `~<*` Do-Block Compilation Split

Do-block comprehensions (`~<<` consumer-do, `~<*` producer-do) compile via one of two routes at each call site, selected by whether the LHS's owning type-class namespace has declared a `~<<` hook.

**Default route (no `~<<` hook declared).** The do-block body expands at compile time to a nested `~<` / `~map` composition over the namespace's declared primitives, per §16's do-comprehension semantics. Each `def x:: expr` statement lowers to a `~<` bind; a bare mid-block statement lowers to `~<` with the produced value discarded; the terminal expression lowers to `~map` (or, for a `$`-prefixed terminal, to `~<`). No effect is performed at compile-time-expanded sites; the expansion is direct composition.

**Override route (namespace declares a `~<<` hook).** The do-block
body compiles to an **effect-performing form** -- a computation that
performs designated per-namespace effect kinds at each block
statement, dispatched to a `~<*` handler scope installed by the hook.
The hook receives the effect-performing form as its first argument
and walks it under handler control, one statement at a time.

The hook signature is:

```java
defn Name~<<(comp, ty) { .. };
```

- `comp` is the compiled effect-performing form of the do-block body
(below).
- `ty` is the dispatch-type introspection value per §3.10.9.7; hooks
that do not specialize on compound-LHS shape may omit this trailing
parameter (the surplus-argument-discard rule of §3.10.1 drops it
silently).

**Compilation of the do-block body.** The block body is lowered
statement-by-statement to a unary callable `defn(_) { <lowered-body> }`,
where the leading parameter is discarded (uniform-shape convention;
see below). Each statement lowers per this table:

- `def x:: expr` -> `def x: Effect.Host.Do.Bind% expr` (perform
`Effect.Host.Do.Bind` with `expr` as payload; the resume-value binds into
`x`).
- Mid-block `$expr;` -> `Effect.Host.Do.Bind% expr` (perform Bind
non-receivingly; no slot receives the resume-value).
- Mid-block bare statement (non-`::`, non-`$`) -> executed as raw code
inside `comp`; no perform is emitted.
- Bare terminal expression `expr` -> `Effect.Host.Do.Map% expr` (perform
`Effect.Host.Do.Map` with `expr` as payload; signals a raw-to-wrapped lift
to the hook).
- Terminal `$expr` -> `def _r: Effect.Host.Do.Bind% expr; Effect.Host.Do.Map% _r`
(compiler-synthesized receiver and Map tail; Bind first, then lift).
The synthesis satisfies the compilation contract that every full path
through `comp` reach a Map arm.

The lowering is uniform: every `::` binding and every `$` sigil in
source becomes an `Effect.Host.Do.Bind%` perform, and exactly one
`Effect.Host.Do.Map%` perform fires per full-path completion (either
directly at a bare terminal, or synthesized at a `$`-terminal's Map
tail).

**Scope discipline for receiving-bind shadowing.** Each `def x:: expr`
statement opens a fresh nested block scope for the remainder of the
body, mirroring the default route's lambda-parameter nesting. The
statement's lowered form and every subsequent statement live inside
that nested scope:

```java
// source:
Name ~<< {
    def x:: e1;
    def x:: e2;   // shadows prior x
    x + 1;
};

// lowered comp body:
def x: Effect.Host.Do.Bind% e1;
{
    def x: Effect.Host.Do.Bind% e2;
    Effect.Host.Do.Map% (x + 1);
}
```

Successive `def x:: expr` occurrences with the same name are legal
under this shape; each occurrence binds in its own nested scope and
shadows the outer. This matches the shadowing semantic the default
route delivers naturally via lambda-parameter nesting. The nesting is
purely lexical within `comp`; the hook's `~<*` walker sees each Bind
perform at the same dispatch level regardless of nesting depth. Non-
receiving `$expr;` and mid-block bare statements do not open new
scopes -- they introduce no name that could collide with a subsequent
occurrence.

**The two internal effect kinds** (`Effect.Host.Do.Bind`,
`Effect.Host.Do.Map`) are a closed language-provided set, not
user-declarable. They exist as the compilation contract between the
do-block-body lowering and the `~<<` hook's handler scope; they carry
no admissible signature for `deft` declaration and cannot appear in
user-authored `:Effects(...)` narrowings.

**Discarded first parameter of `comp`.** `comp` is invoked as a unary
callable; its parameter is discarded at the outermost invocation and
filled by the resumption callable's argument (`ret`, §6.3.2) at each
subsequent invocation from within an arm body. The uniform-shape rule
keeps the hook's dispatch surface consistent across the initial call
and all recursive resumptions.

**Hook body pattern.** The hook opens a `~<*` scope narrowed to the
`Effect.Host.Do` prefix (per §6.1.4 hierarchical namespaces and §6.3.1
prefix-match narrowing; catches `Effect.Host.Do.Bind` and `Effect.Host.Do.Map`),
running `comp(v)` where `v` is the value driving the current
iteration:

```java
Effect.Host.Do ~<* (eff:: comp(v), ret) {
    ?(eff){
        [?as Effect.Host.Do.Bind]: /* handle Bind: gather sub-scopes over ret; Done@ accumulated */;
        [?as Effect.Host.Do.Map]:  /* handle Map: Done@ (#.value lifted into namespace shape) */;
    };
};
```

The arms dispatch by sub-effect kind. Payload is accessed as `#.value`
per §6.3.2 (the arm-head `#` is the perform-event object, not the
payload directly).

- The **Bind** arm's payload `#.value` is the bound expression's
  value. To drive cartesian iteration, the arm typically opens a fresh
  `~<*` scope over `ret(v')` for each `v'` drawn from `#.value`, and
  gathers each sub-scope's terminal via that sub-scope's own handler-
  expression Promise (§6.3.3). Ret is fire-and-forget per §6.3.2; the
  Bind arm does not observe ret's return -- state communication with
  sub-scopes flows through the sub-scope handler-expression Promises,
  not through ret. The Bind arm's arm-terminal is `Done@ accumulated`,
  where `accumulated` is the gathered result across sub-scopes;
  §6.4.1 natural pass-through resolves the enclosing scope's handler
  expression to that payload.
- The **Map** arm's payload is a raw terminal value; the arm-terminal
  is `Done@ (payload lifted into the namespace's canonical wrap
  shape)`, resolving the enclosing scope's handler expression per
  §6.4.1.

Both arms terminate the scope via `Done@` (§6.4). Arm terminals
without `Done@` would leave the scope live per §6.3.2's arm-without-
ret semantic; the do-block-compilation contract requires each
full-path completion of `comp` to reach the Map arm whose `Done@`
resolves the handler expression.

Concrete realization of this pattern for `List~<<` is worked out at
§7.2.

**Effect-tracking surface.** The two internal effect kinds are
performed inside `comp` and caught by the hook's own `~<*` scope,
satisfying §6.13's tracking rule at the hook boundary. They do not
appear in the do-block expression's effect signature exposed to the
caller: the compiler emits them at lowering time and the hook consumes
them at dispatch time, so the round-trip is opaque to the surrounding
effect surface. User effects performed by mid-block statements (from
called functions' `:Effects(...)` clauses, or from explicit
`%`-performs on other effect kinds) propagate past the hook per
§6.3.1's non-narrowed-effect rule and are tracked normally.

Effect-tracking cost applies only when the override route is
selected; namespaces that do not declare a `~<<` hook incur no effect
surface from do-block usage.

The choice between routes is made at compile time from the presence or absence of a `~<<` hook declaration on the LHS's owning namespace. Both routes produce identical observable results at the do-block-expression level; the override route is available for namespaces that need per-step control (e.g., short-circuiting, resource management, non-default sequencing) that the default nested composition cannot express.

Declaration-position admittance of `~<<` and `~<*` as hook markers is specified at §3.1.1.3; the calling convention there matches this section's `(comp, ty)` shape.

##### §3.10.9.5 Semantic Error Taxonomy

The following comprehension-call errors are reported at compile time:

1. **No owning namespace:** the LHS carries no runtime namespace identity. Comprehension dispatch requires an instance whose namespace was established through an `@`-marked construction.
2. **Tier 1 missing hook:** the LHS's owning namespace has not declared the invoked Tier 1 hook. `container ~< fn` where `Container` has no `~<` hook is rejected.
3. **Tier 2 mutual-pair both-missing:** for `~fold` / `~cata`, both members are absent. `(~fold)(container, init, fn)` where `Container` has neither `~fold` nor `~cata` is rejected. The two-operand infix form `container ~fold fn` is rejected on the same grounds.
4. **Tier 2 structural non-fit:** a Tier 2 default's composition precondition does not structurally match the namespace shape (e.g., `~foldR` on an infinite structure; `~filter` on a namespace without an available "empty of shape").
5. **Operand-shape mismatch:** the operands supplied at the call site do not match the operand shape for the invoked marker (arity, type constraints). Diagnosed per §3.10.1's argument-binding rules applied to the hook's declared parameter list.
6. **Alias at declaration:** a `~<` alias (`~chain`, `~bind`, `~flatMap`) appears at declaration position (§3.1.1.3). Diagnostic directs the author to declare the hook as `defn Name~<(..)`.

##### §3.10.9.6 Comprehension Operators As Function Values

Each comprehension operator lifts to a function value via the standard operator-as-function paren-wrap form (§3.13):

```java
(~<)     (~chain)   (~bind)   (~flatMap)     // all lift to canonical ~< dispatch
(~each)  (~map)     (~ap)     (~filter)
(~fold)  (~cata)    (~foldR)
```

The lifted function dispatches at call time on the LHS argument's owning namespace, exactly as the corresponding infix comprehension-call form does. Alias spellings (`~chain`, `~bind`, `~flatMap`) normalize to the canonical `~<` marker at lift time; a namespace's hook table sees only the canonical key (§3.10.9.1).

The `~<<` and `~<*` comprehensions do not lift to function values in this specification revision. Their RHS is a block (§16), not a value expression; there is no first-class function-call shape that supplies a block operand.

**Arity.** Each lifted comprehension has a fixed arity matching the operand shape declared at §3.10.9.2:

- Binary (`(~<)`, `(~each)`, `(~map)`, `(~ap)`, `(~filter)`): exactly two arguments -- the LHS instance and one operand.
- Ternary (`(~fold)`, `(~cata)`, `(~foldR)`): exactly three arguments -- the LHS instance, the initial value (or initial-value thunk, for `~cata`), and the folding function.

Calls with an arity outside this range produce a runtime error. To supply fewer arguments than the arity, use partial application (§3.11) to fix a subset and close over the rest at a later call.

**Ternary invocation is lift-only.** The infix comprehension-call form supplies at most one RHS operand; ternary comprehensions therefore have no inline form that supplies all three operands. The lifted-function form is the primary way to invoke them with an initial value:

```java
def defaultMsg: (@)|"Default!"|;

def m: MaybeFrom@ 42;                    // Id{42}
def g: MaybeFrom@ empty;                 // None

(~fold)(m, defaultMsg(), (@));           // 42
(~cata)(g, defaultMsg,   (@));           // "Default!"

defn sub(x,y) ^x - y;

(~fold)(1..5, 100, sub);                 // 85  -- (100 - 1 - 2 - 3 - 4 - 5)
```

The two-operand inline forms of `~fold` / `~foldR` on Tuples (`xs ~fold fn` with no initial value; see §7, pending) remain available for the initial-value-omitted case; the lifted-function form is required only when the initial-value operand is supplied.

**Prime forms.** The prime form of a lifted comprehension follows the semantic-inversion rule established for primed operators (§3.12.1, §3.12.4): prime is the natural inverse along whatever axis is meaningful for the operator. For the comprehension family, the meaningful axis is **direction of traversal** -- the axis that unifies the family's identity (`~fold` / `~foldR` being the canonical example).

Argument-order-swap prime, admitted for other Foi binary operators without a direction axis (`.`, `%`, `?<=>`, `?in`), is **not** admitted for comprehension operators. Mixing arg-swap prime with direction-reversal prime within the same operator family would impose a per-marker cognitive load users would have to memorize; unifying prime on the direction axis, and requiring partial application or explicit lambda for argument reordering, keeps the family coherent.

Comprehension primes fall into three categories:

- **Direction-reversal (admitted).** The fold family carries a direction axis. `(~fold')` dispatches to the `~foldR` hook; `(~foldR')` dispatches to the `~fold` hook (inverse-of-inverse per §3.12.1). At declaration position, `~fold` and `~foldR` remain separate canonical markers with independent hook slots on the namespace; the prime is a call-site alias linking them. A namespace that declares `~fold` but not `~foldR` (or vice versa) is subject to the missing-hook rules of §3.10.9.3; the prime resolves at dispatch, then the standard Tier 2 default expansion applies to the resolved hook.

- **Reserved (semantic-reject; future activation possible).** `(~each')`, `(~map')`, and `(~cata')` parse at the grammar layer (universal-prime path per §3.13) and reject at the semantic layer with a diagnostic. Each carries a plausible direction axis whose semantics await commitment: `~each'` for right-to-left iteration on ordered containers; `~map'` for direction-observable mapping where hooks carry effects; `~cata'` for direction-reversed catamorphism on ordered-container `~cata` shapes. Reserving the surface spelling -- rather than silently accepting it as a no-op or admitting arg-swap semantics -- preserves the option to activate these primes with direction semantics in a future revision without breaking existing code.

- **Rejected (permanent; no direction axis).** `(~<')`, `(~ap')`, and `(~filter')` reject at the semantic layer with a diagnostic. These operators have no direction axis; the only inversion available on them at the operator layer is argument-order-swap. Argument-order-swap is not admitted for the comprehension family per the family-coherence rule above -- and, independently, is redundant with partial application (§3.11): a fixed operand with the instance flowing in later is expressed as `(~<glyph>)|, operand|`, which is what arg-swap prime would have served anyway. The diagnostic directs the author to this pattern.

**Infix does not admit prime.** The ComprOp production (§10) admits only `Comprehension` or `Tilde OpenAngle` markers; prime is not part of infix comprehension syntax. `xs ~fold' fn` is a parse error. Prime forms are reachable only through the operator-as-function paren-wrap: `(~fold')(xs, init, fn)`. To invoke a direction-reversed fold in infix position, use the direct spelling `xs ~foldR fn`.

**Semantic errors.** The error taxonomy of §3.10.9.5 applies uniformly to lifted-function-form calls, with dispatch resolution and hook lookup performed against the LHS argument at call time rather than against the LHS operand at parse time. In addition, the arity-mismatch error described above is diagnosed at call time. Two errors specific to primed comprehensions:

- **Reserved prime form**: `(~each')`, `(~map')`, or `(~cata')` appears in an expression. Diagnostic directs the author to use the base marker pending semantic definition of the prime form in a future spec revision.
- **Prime not admitted**: `(~<')`, `(~ap')`, or `(~filter')` appears in an expression. These markers carry no direction axis, and arg-swap prime is not part of the comprehension family. Diagnostic directs the author to partial application (§3.11) for the operand-fixed, instance-flows-through pattern arg-swap would have served: `(~filter)|, pred|`, `(~<)|, fn|`, `(~ap)|, valInst|`.

##### §3.10.9.7 Dispatch-Type Introspection

Every hook invocation receives, as its trailing positional argument, a value that describes the dispatch type against which the hook was invoked. This value (`ty`) is emitted at every call site across all hook markers: constructor `@` (§3.8), effector `%` (§3.9), and every comprehension marker (§3.10.9). A hook that does not specialize on `ty` declares no parameter for it; the surplus-argument-discard rule (§3.10.1) drops the trailing value silently at hook-body entry.

**`ty` shape.** The dispatch-type value is a Tuple of namespace values reflecting the compound-LHS nesting depth of the LHS at the call site:

- Plain-LHS: `xs ~map fn`, where `xs` is a `List` instance, emits `< List >` (a 1-tuple).
- Single-level compound: `List{Promise} ~<< {..}` emits `< List, Promise >` (a 2-tuple).
- Nested compound: `List{Promise{Int}} ~<< {..}` emits `< List, < Promise, Int > >` (the second entry is itself a 2-tuple).

The tuple's length signals nesting depth; the shape is always a tuple, uniformly, including at plain-LHS sites. Entries are namespace values themselves; per §3.8's four-way collapse, a namespace name is a first-class value, and namespace-value identity comparison via `?=` is specified at §3.8.

**Emission source.** For static-LHS call sites (a bare namespace name or a compound-LHS type expression at the LHS position, as in `Foo@ x` per §3.10.7, `List ~<< {..}` per §7.2, or `List{Promise} ~<<` per §6.8.3), `ty` is a compile-time literal tuple built directly from the LHS type expression. For instance-LHS call sites (an instance value at the LHS position, as in `inst%` per §3.10.8 or `xs ~map fn` per §3.10.9), `ty` is read at dispatch time from the instance's owning-namespace tag; the tag was established at the instance's `@`-marked construction (§3.8). The depth carried by an instance tag reflects the construction path and is not inferred from the instance's contents.

**Hook declaration.** A hook that specializes on `ty` declares a trailing parameter to receive it:

```java
defn Foo~map(inst, fn, ty) {
    // hook body may inspect `ty` for compound-LHS specialization
};
```

A hook that does not specialize declares only its operand parameters:

```java
defn Maybe~map(inst, fn) {
    // `ty` is emitted at the call site; discarded silently per §3.10.1
};
```

Both declarations are well-formed under identical call-site emission (`Name~map(inst, fn, ty)`). The surplus-argument-discard rule (§3.10.1) drops the trailing `ty` at any hook declaration that does not receive it. Stdlib migration to `ty`-receiving forms is opt-in per hook; existing declarations remain valid without change.

**Runtime specialization.** A hook body that specializes uses dependent pattern-match with `?=` atoms against Tuple literals of namespace values:

```java
defn Foo~map(inst, fn, ty) {
    ?(ty){
        [?= < Foo, Bar >]:
            fooBarMap(inst, fn);
        [?= < Foo, < Bar, Int > >]:
            fooBarIntMap(inst, fn);
        :
            fooPlainMap(inst, fn);
    }
};
```

Each arm matches a specific compound-LHS shape; the tuple's structural equality resolves the branch.

Wildcard or partial-shape matching uses destructure-then-match:

```java
defn Foo~map(inst, fn, ty) {
    def < outer, inner >: ty;
    ?{
        [outer ?= Foo ?and ?empty inner]:
            fooPlainMap(inst, fn);
        :
            fooCompoundMap(inst, fn, inner);
    };
};
```

Both idioms rely on namespace-value `?=` identity equality per §3.8.

**No parallel declaration surfaces.** A namespace declares at most one hook per operator (§3.1.1). Compound-LHS specialization is entirely a runtime-reflection concern inside the hook body: dispatch on `ty` inside the single declared hook.

**Rationale.** A single hook declaration with runtime `ty` dispatch collapses what would otherwise be an N-fold surface (one hook per compound-LHS shape) into one hook that self-hosts its own specialization. This is the same collapse pattern as the four-way namespace collapse at §3.8, applied to the specialization axis: what appear to be N distinct hooks are one hook plus a dispatch value. The primary consumer of this mechanism is the `~<<` override route (§3.10.9.4); `List{Promise} ~<<` (§7.2's eager-async-iteration form) is self-hosted as a compound-LHS specialization arm of the single `List~<<` hook, via `?(ty)` dispatch inside the hook body.

#### §3.10.10 Multi-Tier Function Call

A call against a function value with multiple parameter tiers binds the outermost tier per §3.10.1. The body of a non-innermost tier evaluates to a function value over the next tier; that value is the result of the tier call.

```java
defn add(x)(y) ^x + y;

add(3);            // function value over `x` (still waiting on `y`)
add(3)(4);         // 7
```

Each subsequent tier call evaluates per §3.10.1 against that tier's parameter list.

Per §3.2.5, loose-curry is not provided: each tier call must satisfy that tier's parameters with its own call. To flatten the tier shape into a single argument list, use `\/` (§3.12.3).

Tiers act like nested frames for name resolution: an inner-tier body, and any default expression in an inner tier (§3.10.2), can reference parameters from outer tiers.

Preconditions are hoisted to the highest/earliest tier at which their references can be satisfied by that tier's parameters (§3.5).

#### §3.10.11 The `empty` Completion Fallthrough

A function call evaluates to `empty` when:

1. The body is a concise return `^expr` and `expr` evaluates to `empty`; `empty` flows out normally.
2. The body is a block body and no `^` statement executed; the block completed without an explicit return.
3. A precondition matched with `empty` as its consequent (e.g., `?[bad]: empty`).

This is consistent with §1.1's enumeration of `empty`-producing positions. Callers that need to distinguish "no return path taken" from "explicit `empty` return" must wrap the return at the function's signature level with `Maybe`, `Either`, or a comparable monadic carrier.

#### §3.10.12 The Pipeline-Call Form

The pipeline-call form `topic #> stage #> stage ...` (Syntactic-Grammar `PipelineOp` at §10) evaluates a seed topic, then threads it left-to-right through a sequence of stages: each stage's evaluated value becomes the topic delivered to the next stage.

```java
defn inc(v) ^v + 1;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

11 #> inc #> triple #> half;             // 18
```

Left-associative at the Flow tier (§9): `a #> f #> g` is `(a #> f) #> g`.

**Abstract execution:**

1. Evaluate the leftmost operand (the seed) in the caller's environment; let `topic` be its value.
2. For each stage in source order, evaluate the stage per the stage-shape rules below with `topic` as its implicit input, then rebind `topic` to the stage's evaluated value.
3. The pipeline-call's value is `topic` after the final stage.

**Stage shapes.** The PipelineOp RHS admits three shapes (Syntactic-Grammar `<FlowRHSImplIn>` at §9):

- **Expression stage** (`OrDispatch` arm). A value-expression evaluated in the caller's environment, with one of two topic-delivery rules selected by whether the expression contains the topic-reference sigil `#` (Syntactic-Grammar `PipelineTopic` at §6):

    - **Explicit topic (expression contains `#`).** Each `#` reference within the expression evaluates to `topic`. The expression's evaluated value is the stage's result; the topic is not additionally appended.

        ```java
        defn add(x, y) ^x + y;

        11 #> add(1, #);
        // add(1, 11) → 12
        ```

    - **Implicit topic (expression contains no `#`).** The expression's value must be a function value; it is called with `topic` as its sole positional argument, and the call's result is the stage's result.

        ```java
        11 #> inc #> triple #> half;
        // inc(11) → 12 → triple(12) → 36 → half(36) → 18
        ```

    An expression stage whose expression contains no `#` and does not evaluate to a callable is a type error at that stage.

    Multi-tier callables (§3.10.10) at implicit-topic expression stages bind only the outermost tier; a curried callable's outer-tier result becomes the new topic:

    ```java
    defn add(x)(y) ^x + y;
    11 #> add(1) #> triple #> half;
    // (add(1))(11) → 12 → ...
    ```

- **Def-block stage** (`BlockExpr` arm). A `(defs) { body }` form (§2.9.4) whose defs-init clause binds against `topic` as its implicit input. The topic is destructured or bound per §2.9.4's abstract execution; the body evaluates in the resulting frame; the block's final value-bearing expression is the stage's result.

    ```java
    person #> (< :name, :title >) {
        log(`"`name` is our `title`");
    };
    ```

- **Bare-block stage** (`BareBlockExpr` arm). A `{ body }` form with no defs-init clause. The topic is not implicitly bound to any name; reference it via `#` within the body. The block's final value-bearing expression is the stage's result.

    ```java
    person #> { log("visiting"); # };
    ```

Def-block and bare-block stages do not admit the implicit-topic behavior of expression stages: their form is a block, not a value-expression evaluating to a callable. Topic delivery is via the defs-init clause (def-block) or explicit `#` references (bare-block).

**Operator-as-function form.** `(#>)` lifts to a variadic function value per §3.13; the first argument is the seed topic and subsequent arguments are stages:

```java
(#>)(11, inc, triple, half);              // 18
```

The primed form `(#>')` reverses the argument order per §3.12.1 semantics (stages first, seed last):

```java
(#>')(half, triple, inc, 11);             // 18
```

Both lifted forms require at least two arguments (seed + at least one stage). The lifted form treats every stage argument as an implicit-topic stage (each stage argument is called with the current topic); the `#`-in-stage explicit-topic rule of the infix form has no analogue in the lifted form. To thread a topic through a `#`-substitution position with a lifted-form composition, wrap that step in a curried callable and pass the curried value as a stage argument.

**Function-body sugar.** A function declared with a `#>`-prefixed body (§3.3.3) is sugar for `^ x #> ...`, where `x` is the outermost parameter tier's first positional parameter. See §3.3.3 for the parameter-shape constraints on that form.

**Chain-mixing with other Flow-tier operators.** The pipeline operator lives at the Flow tier alongside comprehension operators (§3.10.9) and compose operators (§3.10.13); a single Flow-tier chain may mix these operators without parenthesization. Chain evaluation proceeds left-to-right per the tier's left-associativity; there is no operator-precedence relationship among `#>`, `~<glyph>`, `+>`, and `<+` inside the same tier.

#### §3.10.13 The Compose-Call Form

The compose-call form `f +> g +> h` (and its reverse-order sibling `f <+ g <+ h`) produces a unary function value that runs its operand functions in a fixed order (Syntactic-Grammar `ComposeOp` at §10):

- `+>` compose-left-to-right: the leftmost operand runs first / innermost.
- `<+` compose-right-to-left: the leftmost operand runs last / outermost.

```java
defn inc(v) ^v + 1;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

def compute1: inc +> triple +> half;      // half(triple(inc(v)))
def compute2: half <+ triple <+ inc;      // half(triple(inc(v)))

compute1(11);                             // 18
compute2(11);                             // 18
```

Left-associative at the Flow tier (§9): `f +> g +> h` is `(f +> g) +> h`.

**Abstract execution at compose time:**

1. Evaluate each operand in source order in the caller's environment. Each operand must evaluate to a function value; a non-callable operand is a type error at compose time.
2. Allocate a new unary function value whose call-time behavior is defined below.
3. The compose expression's value is the allocated function.

**Abstract execution at call to the composed function (`+>` form):**

1. Bind `x` to the first positional argument of the call; discard all other arguments.
2. Apply the first operand to `x`; feed each operand's result as input to the next operand in source order.
3. The final operand's result is the call's return value.

**Abstract execution at call to the composed function (`<+` form):** as `+>` above but with the operand chain traversed right-to-left.

`<+` is equivalent to `+>` with reversed operand order, and further equivalent to `(+>')` per §3.12.1's semantic-reverse rule:

```
f <+ g <+ h   ≡   h +> g +> f   ≡   (+>')(f, g, h)
```

**Unary result.** The composed function's signature is fixed to `(x) -> result`; additional positional arguments at call time are discarded, regardless of the first operand's declared arity. To thread more than one value through a composition, wrap the values in a Tuple or Record at the composition's entry point.

**Operand shape.** Compose operands must be function-value expressions. The ComposeOp RHS narrowing (Syntactic-Grammar `<FlowRHSStrict>` at §9) excludes block-body arms: unlike pipeline stages (§3.10.12), compose operands are lifted at compose time from function-valued expressions and receive no runtime topic to consume; a block operand would have no source to bind an implicit input against. Any operand whose behavior depends on a topic must be wrapped in a function value first.

Compose operands compose freely with §3.11 partial application and §3.12 shape transforms; the operand slot is a general function-value expression:

```java
def add10:   (+)|10|;
def compute: add10 +> triple +> half;
```

**Operator-as-function form.** `(+>)` and `(<+)` lift to variadic function values per §3.13; each operand argument must be a callable, and the result is a unary composed function:

```java
def compute1: (+>)(inc, triple, half);    // half(triple(inc(v)))
def compute2: (<+)(half, triple, inc);    // half(triple(inc(v)))
```

Zero-operand and single-operand calls to the lifted forms are type errors: composition requires at least two operands.

The prime forms `(+>')` and `(<+')` reverse the operand list per §3.12.1: `(+>')(f, g, h)` is equivalent to `(+>)(h, g, f)`, and analogously for `(<+')`. These are semantic reversals of the operand list, not new directions of composition.

**Chain-mixing with other Flow-tier operators.** Compose lives at the Flow tier alongside pipeline (§3.10.12) and comprehension operators (§3.10.9); mixing within a single Flow-tier chain is admitted per §3.10.12's chain-mixing note.

## §3.11 Partial Application: `f|arg,arg,..|`

The `f|arg,arg,..|` form (Syntactic-Grammar `PartialCallSuffix` at §7) produces a partially-applied function value:

```java
def add6: (+)|6|;

add6(12);                                // 18
```

Partial application is an ahead-of-time argument collection process. It does not invoke `f`'s preconditions, does not validate arguments against `f`'s parameters, and does not allocate a call frame. All of that happens only at the final application, when the collected args meet the rest-args from the final call.

#### §3.11.1 Capture and Combination

**Abstract execution at partial-application time:**

1. Evaluate the callee `f` to a function value.
2. Process each supplied arg slot in source order:
    - A positional argument expression is evaluated in the caller's environment; its value is captured.
    - A `skip` slot is captured as the `skip` marker (§3.10.4).
    - A spread `...expr` is evaluated in the caller's environment and its elements are captured in order (§3.10.5).
    - A named argument `name: expr` evaluates `expr` in the caller's environment; the captured entry binds `name` to that value.
3. Allocate a new function value whose application logic, when later called with final-call args, performs the combination step (below) and invokes `f` with the combined argument list.
4. No call to `f` occurs at partial-application time.

**Combination step at final call time:**

1. Final-call args are processed per §3.10.5 (spread expansion) into an ordered argument list.
2. The captured args from partial-application time are walked left-to-right:
    - A non-`skip` captured arg occupies that position directly.
    - A `skip` captured arg consumes the next final-call arg in order; if none remains, the slot stays `skip`.
3. Any final-call args not consumed by skip slots append at the end of the captured list.
4. The combined argument list is passed to `f` per §3.10.1; at this point, parameter binding, default evaluation, skip-to-`empty` binding (§3.10.4), surplus discard, and precondition evaluation occur normally.

#### §3.11.2 Arity Independence

Partial application is independent of `f`'s arity; capture is syntactic, and arity reconciliation happens at the final call:

```java
def add37: (+)|6, 12, 19|;

add37(5);                                // 42
```

`(+)`'s operator-as-function lift is variadic; the partial captures three values, the final call appends `5`, and `(+)` receives four operands.

#### §3.11.3 Skip Slots in Captured Args

```java
defn xyz(x, y, z) ^log(`"x: `x`, y: `y`, z: `z`");

def fn: xyz|3, , 7|;

fn(5);                                   // x: 3, y: 5, z: 7
fn();                                    // x: 3, y: empty, z: 7
```

`fn(5)` consumes the `5` into the skip-slot at position 1. `fn()` provides no rest-args; the skip-slot stays `skip` and binds to `empty` per §3.10.4.

#### §3.11.4 Spread in Partial Application

```java
def nums: < 9, 8, 7 >;

def fn: xyz|...nums|;

fn();                                    // x: 9, y: 8, z: 7
```

Spread sources are evaluated and captured at partial-application time. This preserves "arguments are remembered for later" semantics even when the spread source is itself effectful (e.g., a generator yielding values).

#### §3.11.5 Partial Application of Primed Function

```java
def sub1: (-')|1|;

sub1(6);                                 // 5 :: 6 - 1
```

The prime `'` reverses the *expected argument order* for final application (§3.12.1); the partial then captures the supplied arg in the post-reversal first position. `(-')|1|` captures `1` as the subtrahend; `sub1(6)` supplies `6` as the minuend.

#### §3.11.6 Named Arguments in Partial Application

```java
defn add(x, y) ^x + y;

add|x: 4|(y: 5);                         // 9
```

Captured named args and final-call named args resolve against `f`'s parameter list as the union of both, per §3.10.6.

The all-positional-or-all-named rule (§3.10.6) is enforced on the *combined* argument list at final-call time, not on either side independently. If the combined list contains a mix of positional and named entries -- even when each side is internally uniform -- `f` rejects the call:

```java
add|x: 4|(5);             // ERROR; combined: < x: 4 > and 5 (mixed)
add|3|(y: 5);             // ERROR; combined: 3 and < y: 5 > (mixed)
```

#### §3.11.7 Multi-Tier Callees

Partial application captures against a single tier of function application: the outermost tier of `f`. On final call, the outermost tier is bound per §3.10.1 using the combined argument list; the result is whatever the outermost tier would return: the body result for a single-tier `f`, or the next-tier function value for a multi-tier `f`.

```java
defn add(x)(y) ^x + y;

def addOuter: add|3|;

// function value over (y)
// outer tier completes with x = 3
addOuter();

addOuter()(4);        // 7
```

To partially apply against a deeper tier, complete the outer tiers first and partially apply the resulting function value: `(add(3))|4|`.

#### §3.11.8 `@`-Marked and `%`-Dispatched Functions

Partial application is exclusive to standard call-form functions; a namespace declared via `defn Foo@(..)` (§3.1.1.1), or a hook declared via `defn Foo%(..)` (§3.1.1.2), opts out of this `f(args)` call surface.

`Foo|x|` and `Foo.@|x|` raise runtime errors; likewise, if `inst` is an instance of `Foo@` with an accompanying `Foo%`, `inst|x|` is rejected.

### §3.12 Function-Shape Transforms

Foi provides four operator-shape transforms on function values: prime `'` (reverse), mountain `/\` (curry), valley `\/` (uncurry), and the primed-inverse forms of each. All four are postfix operators on the function value's grammar position (Syntactic-Grammar `PostfixCallTail` at §7). All four can also appear as operator-as-function (`(/\)`, `(\/)`, `(/\')`, `(\/')`, `(')`); see §3.13.

#### §3.12.1 Reverse: `f'`

The prime operator `'` produces a function value that reverses its argument order at call time:

```java
defn sub(x, y) ^ x - y;
def rsub: sub';
rsub(2, 5);                              // 3 :: 5 - 2
```

**Abstract execution at call to `f'`:**

1. Collect the call's arguments into a sequence.
2. Reverse the sequence.
3. Apply `f` to the reversed sequence.

The reverse is **semantic, not syntactic**: `f'` is a function value carrying a reverse-then-apply behavior, applicable at any later call. The reversal applies to the complete argument sequence delivered at the final call, including when composed with partial application (§3.11) or pipeline topic placement.

`f'` preserves `f`'s arity (the language guarantees that arity-introspecting transforms like `/\` and `\/` see `f`'s declared arity through the prime wrapper).

#### §3.12.2 Curry: `f/\`

The mountain operator `/\` produces a curried function value:

```java
defn buildURL(origin, path, query) ^ `"`origin``path`?`query`";
def parts: buildURL/\;

parts("https://my.site")("/api/find")("name=getify");
```

**Abstract execution at call to `f/\`:**

1. Accumulate arguments across call sites.
2. At each call, if total accumulated arguments meet or exceed `f`'s declared arity, apply `f` to the accumulated arguments and produce the result.
3. Otherwise, return a function value that continues accumulation.

`/\` operates on `f`'s declared arity (the count of its outermost-tier parameters), not on multi-tier curry shape. For a function already declared with multi-tier curry shape, `/\` is idempotent; the wrapper just passes arguments through.

**Loose-curry compatibility.** Supplying all arguments at once short-circuits the accumulation:

```java
parts("https://my.site", "/api/find", "name=getify");
```

#### §3.12.3 Uncurry: `f\/`

The valley operator `\/` produces a flat-argument function value over a curry-shaped function:

```java
def flat: parts\/;
flat("https://my.site", "/api/find", "name=getify");
```

**Abstract execution at call to `f\/`:**

1. Receive a flat positional argument sequence.
2. Walk `f`'s tier chain at apply time: at each tier, consume that tier's arity from the front of the sequence and apply, advancing through the chain.
3. The final tier's body result is the call's value.

`\/` respects multi-tier shape: a `defn foo(x)(y, z)(w) ^ ...` uncurried takes its tier arities sequentially from the flat list.

`\/` is the canonical way to call a multi-tier `defn` with a flat argument list (§3.2.5). Loose-curry is not a language feature; `\/` is the explicit form.

#### §3.12.4 Primed inverses

`/\` and `\/` are each other's inverses; `'` is its own inverse. So each transform admits a primed-inverse form expressing the other:

```java
def uncurry: (/\');
def curry: (\/');
```

The primed forms exist for language consistency (every operator admits a primed form) but the recommended style is to use the named operator directly: `\/` rather than `/\'`, `/\` rather than `\/'`.

### §3.13 Operator-as-Function

Any operator can be lifted to a function value by parenthesizing it (Syntactic-Grammar `OpFuncExpr` at §7): `(+)`, `(?and)`, `(.)`, `(.<a, b>)`. The `@` operator lifts the same way: `(@)` evaluates to the unary value-identity function (the `@`-call operator with no LHS callee; see §3.8.1).

The lifted value is a callable function whose application invokes the operator on the supplied arguments. The prime form `(+')` produces the reverse of the lifted operator (§3.12.1).

The per-operator argument arity, argument types, and semantic behavior of each lifted operator is specified in the section that owns that operator (e.g., `(+)` per §1.3 numeric arithmetic; `(.)` per §2.12 indexed access; `(.<a, b>)` per §2.12 multi-pick; etc.). §3 specifies only the lifting mechanism:

1. The parenthesized operator-symbol expression produces a function value.
2. Calling that function value evaluates the operator against the supplied arguments.
3. The prime `'` form applies §3.12.1 reverse semantics to the lifted function value.
4. Operator-as-function values compose freely with `|args|` (§3.11), `/\` (§3.12.2), `\/` (§3.12.3), `+>` (composition, §3.10.13), and `#>` (pipelines, §3.10.12).

## §4 Decisions and Guards

This section specifies the standalone **guard expression** form, `?[cond]: consequent` (and its `![cond]: consequent` negated form), together with its shared **CondClause** primitive.

A guard expression produces a value based on a single boolean test. If the test's polarity-adjusted result is `true`, the guard **matches** and the consequent is evaluated to produce the guard's value. If the guard does not match, the consequent is not evaluated and the guard's value is `empty` (§1.1).

The CondClause primitive introduced here is also the atomic decision form embedded in function preconditions (§3.5), the independent form of pattern matching (§5), and the conditional-form of the `~each` loop comprehension (§7). Pattern matching (§5) extends the single-clause shape defined here to a multi-clause first-match-wins cascade, with optional topic dispatch and an optional else clause; the forms share the `?[cond]:` clause syntax and the `?/!` polarity vocabulary, and diverge on how many clauses combine and on whether a shared topic threads through them. A single-clause independent-match expression is semantically equivalent to the guard expression form here; the standalone guard is the shorter surface.

### §4.1 The CondClause Primitive

A **CondClause** is a polarity sigil (`?` or `!`) followed adjacently by a bracket-delimited test expression:

```
CondClause := (Qmark | Exmark) BracketExpr
```

No trivia is admitted between the polarity sigil and the opening `[`; the two must be lexically adjacent.

Examples:

```java
?[x ?> 0]
![y ?= empty]
?[(?and)(isReady, isValid)]
```

**Abstract execution:**

1. Evaluate the test expression in the current environment. The test is evaluated **exactly once** per arrival at the clause; a test containing a perform site (§6.2) produces exactly one perform per arrival.
2. The test must produce a boolean value (`true` or `false`). Non-boolean values are ill-typed per §1.2; the language provides no implicit coercion to boolean at this position. This is a **compile-time** obligation discharged under §9: a test whose static type is not the boolean type is rejected at compile time. No runtime coercion and no runtime type-failure path exists at this position, consistent with §6.1.1.
3. Apply the polarity:
    1. If polarity is `?`, the clause **matches** when the test is `true`.
    2. If polarity is `!`, the clause **matches** when the test is `false`.
4. If the clause matches, its enclosing form (guard expression, precondition, or pattern-matching arm) proceeds to evaluate the corresponding consequent. If it does not match, the enclosing form takes its non-match path.

The `!` polarity negates the *test's truth relative to matching*, not the value of the test. This is distinct from the unary `!` operator's function-complement / boolean-flip semantics; a `!` at the head of a CondClause is a polarity sigil, not application of the `!` operator to the test.

**Reachability.** A CondClause is not a standalone form. It appears only embedded:

- In a guard expression (§4.2): `CondClause _ Colon _ consequent`.
- In a function precondition (§3.5): syntactically the same shape at the position between the parameter list and the body, with a slightly narrower consequent grammar.
- In an independent pattern-matching arm (§5), via the **IndepCondClause** variant -- the same shape with the polarity sigil optionally elided (bare `[test]` reads as implicit `?[test]`).
- In a conditional `~each` loop comprehension, where the conditional determines whether the next loop iteration is executed or the loop concludes.

Dependent pattern matching (§5) uses a distinct **DepCondClause** with richer internal structure supporting operator-led boolean sub-expressions and `?as` type arms; that form appears only within dependent-match expressions.

### §4.2 Guard Expression

A **guard expression** attaches a consequent to a CondClause via a colon:

```
GuardedExpr := CondClause _ Colon _ (BlockExprStrict | Expr)
```

Examples:

```java
?[x ?> 0]: log(x);
![y ?= empty]: process(y);
```

**Abstract execution:**

1. Evaluate the CondClause per §4.1.
2. If the CondClause matches:
    1. Evaluate the consequent in the current environment.
    2. The guard expression's value is the consequent value.
3. If the CondClause does not match:
    1. The consequent is not evaluated.
    2. The guard expression's value is `empty`.

The empty result on non-match is the source of §1.1's "A failed guard expression" bullet.

**Static type.** A guard expression's type is the union of its consequent's type and `empty`. A guard is never total on its own: the `empty` arm is unconditional and cannot be discharged by any property of the test. Code requiring a total result composes the guard with a fallback, or uses a two-clause independent match (§5.1) instead. See §9 for the union type's treatment.

**Tail position.** When a guard expression occupies a tail position, its consequent occupies a tail position. The non-match path produces the `empty` literal with no call and is trivially tail-safe. A guard is therefore proper-tail-call transparent, in the same sense as a precondition consequent (§3.5).

**Nested guards.** A guard's consequent may itself be a guard: `?[a]: ?[b]: x`. The inner guard is evaluated only when the outer matches; the composite's value is `x` when both match and `empty` otherwise. The two non-match paths are **not distinguishable** at the composite's value -- outer-failed and inner-failed both produce `empty`. Where the distinction matters, use an independent match (§5.1) with explicit clauses rather than nesting guards.

**`:as` precedence.** The consequent slot is greedy and consumes a trailing `:as` annotation. Annotating the guard expression itself requires explicit parens:

```java
?[c]: y :as int;            // annotates y
(?[c]: y) :as int;          // annotates the guard
```

The two forms differ in which type must hold: the consequent's type in the first, the guard's `consequent-type | empty` union in the second.

### §4.3 Consequent Forms

The consequent slot admits three shapes: an expression consequent, a block consequent, and an assignment consequent. The consequent's shape determines what value the guard produces on match, but the match/no-match semantic of §4.2 is uniform across all three.

#### §4.3.1 Expression Consequent

Any expression is admitted. On match, the expression evaluates in the current environment; its value is the guard's value.

```java
?[x ?> 0]: log(x);
?[x ?< 0]: Left@ "negative";
?[isReady]: task ~< process;
```

**Abstract execution when the guard matches:**

1. Evaluate the consequent expression in the current environment. The expression consequent introduces no frame; the block forms (§4.3.2) do.
2. The guard expression's value is the consequent's value.

**Abstract execution when the guard does not match:**

1. The consequent expression is not evaluated. No sub-expression of it is evaluated, including any perform site (§6.2) it contains.
2. The guard expression's value is `empty`.

#### §4.3.2 Block Consequent

The consequent may be a block expression in either of two forms: a **bare block** with no bindings clause, or a **def-block** with a leading bindings clause.

**Bare block:**

```java
?[isReady]: {
    log("starting");
    initialize();
    status
};
```

**Def-block:**

```java
?[x ?< 3]: (y: 3) {
    log(x + y);
    y * 2
};
```

The bare block reaches the consequent as an ordinary expression; its execution semantics are the bare-block rules of §2.9.1. The def-block form is the **BlockExprStrict** variant of §2.9.3, host-attached to the guard's colon-led body slot. Two properties are important at the def-block position:

- The def-block form is *host-attached*, admitted only at the colon-led body slots of guards (this section) and match consequents (§5). A bare `(defs) { body }` at a value-expression slot (for example, a `def x:` initializer) is a parse error.
- The def-block form uses the **strict-optional** defs-init inner: Identifier entries may omit their initializer (defaulting to `: empty`), but destructure-target entries require an explicit initializer, because a guard consequent has no implicit input to bind against.

**Abstract execution when the guard matches:**

1. Allocate a fresh frame, parent-linked to the current environment.
2. For the def-block form only: evaluate the defs-init clause's entries in source order into the new frame, per §2.9.3. The bare-block form has no defs-init clause and skips this step.
3. Evaluate the body's statements in the new frame, in source order.
4. The guard expression's value is the block's value -- the completion value of its final statement (§2.9.1).

**Abstract execution when the guard does not match:**

1. No frame is allocated.
2. The defs-init clause is not evaluated. This is the same conditional-evaluation property the assignment consequent carries (§4.3.3): a defs-init initializer with a side effect fires only on match.
3. The body is not evaluated.
4. The guard expression's value is `empty`.

#### §4.3.3 Assignment Consequent

The consequent may be an assignment expression:

```java
?[shouldLog]: lastLog := currentTime;
?[valid]: counter := counter + 1;
```

This form has an important property that the other consequent shapes do not carry as directly:

**The assignment evaluates only when the guard matches.** When the CondClause does not match, no part of the assignment expression is evaluated and no slot is mutated. The guard expression's value is `empty` (per §4.2), unchanged from any other non-match outcome.

**When the guard matches, the guard's value is the assigned value** -- the value written to the target's slot. This follows compositionally from three properties: the guard's value on match is the consequent value (§4.2); an assignment expression's value is the assigned RHS; and the consequent slot receives the assignment expression directly.

**Abstract execution when the guard matches:**

1. Evaluate the assignment expression in the current environment, in full, per §2's assignment semantics. Where the target is an access path (`base.field := v`, `base[k] := v`), this includes evaluating the target's base and any computed key; §2 fixes the order of those evaluations relative to the RHS. The assignment expression's value is the assigned value `v`.
2. The guard expression's value is `v`.

**Abstract execution when the guard does not match:**

1. No part of the assignment expression is evaluated -- not the RHS, not the target's base, not any computed key. The conditional-evaluation property covers the whole expression, not the RHS alone; a perform site (§6.2) anywhere within it does not fire.
2. No slot is mutated.
3. The guard expression's value is `empty`.

The conditional-mutation property is intentional: `?[cond]: target := value` is the canonical form for "mutate this slot only when this condition holds", without needing to wrap the mutation in a block. It is the shortest expression of a guarded re-assignment side effect in Foi.

### §4.4 Composition

Guard expressions compose in two modes: as **statements** (side-effect application, value discarded) and as **value-bearing expressions**.

**As statement:** the guard's `empty` on non-match is discarded; the form reads as a conditional side effect.

```java
?[isLoggingEnabled]: log(currentEvent);
```

**As value-bearing expression:** the guard's value is captured, and the surrounding form must accommodate both the evaluated-consequent value and the `empty` on non-match.

```java
def maybeResult: ?[x ?> 0]: compute(x);
// maybeResult is either the compute result, or empty
```

**As a block's final statement.** A guard at statement position discards its value, and the examples throughout §4.3 are written that way. A guard appearing as the *final* statement of a block is not discarded: its completion value is adopted as the block-expression's value and propagates up the evaluation chain, carrying the `empty` non-match arm with it. This applies uniformly across all three consequent shapes of §4.3.

**Normative desugaring.** A guard expression is *defined* as the single-clause, else-less independent pattern match (§5.1) over the same CondClause and consequent:

```
?[c]: e        ==        ?{ ?[c]: e }
![c]: e        ==        ?{ ![c]: e }
```

The equivalence is total, not approximate. The two forms share the CondClause primitive (§4.1), and their consequent slots are the same grammar (`BlockExprStrict | Expr`), so every consequent shape of §4.3 -- expression, bare block, def-block, assignment -- transfers unchanged. Match/no-match, the `empty` non-match value, conditional evaluation of the consequent, static type, tail position, and frame allocation all follow from §5.1 applied to a one-clause cascade.

An implementation may therefore lower `GuardedExpr` to `IndepMatchExpr` at any stage after parsing and share a single evaluation path for both. The guard is a surface abbreviation, not an independent semantic construct; §4.2 and §4.3 describe its behavior directly because it is the form a reader meets first, not because it carries semantics §5 lacks.

**Related forms.**

- **Function preconditions (§3.5)** are CondClause-headed forms occupying the position between a function's parameter list and its body. They share the `?[cond]:` clause syntax and polarity vocabulary defined here, with two differences: the consequent grammar is narrower (`ExprNoBlock` rather than `BlockExprStrict | Expr`), and matching shortcircuits the function body rather than producing the guard's value in place. See §3.5 for precondition semantics and §3.5.1 for the multi-parameter tier-lifting rule.

- **Pattern matching (§5)** extends this single-clause form to multi-clause cascades. An independent-match expression (`?{ ?[c1]: e1; ?[c2]: e2; ?: else }`) is a first-match-wins ordering of clauses that reuse the CondClause primitive defined here; a single-clause independent match is semantically equivalent to a guard expression. A dependent-match expression (`?(topic){ ... }`) additionally threads a shared topic through its clauses via the DepCondClause form, which has no counterpart in the guard-expression surface.

## §5 Pattern Matching

**Pattern matching** extends the single-clause guard expression form of §4 to multi-clause **cascades**. A pattern-match expression is a sequence of clauses, each a CondClause-headed decision paired with a consequent, evaluated in source order with **first-match-wins** semantics. An optional trailing else clause supplies a default consequent when no pattern clause matches; if no clause matches and there is no else, the expression's value is `empty` (§1.1).

A match without an else clause can leave a *pattern-match coverage gap* -- a value that falls through every clause and yields `empty`. Whether the compiler diagnoses such a gap is a configurable, non-normative check; see §5.5 for its specification and its dependence on §9.

Two forms are available:

- **Independent** pattern matching (`?{ ... }`): each clause carries its own CondClause, evaluated independently. The clauses share no common subject; each is a self-contained boolean test.

- **Dependent** pattern matching (`?(topic){ ... }`): a topic expression is evaluated once at match entry, then threaded as the implicit left-hand side of each clause. Each clause tests the (single, shared) topic against one or more atom expressions.

Both forms are value-bearing expressions: the matching clause's consequent value is the match expression's value. Both share the same consequent grammar and the same else-clause form; the two forms differ only in how their clauses read the input.

### §5.1 Independent Pattern Matching

An **independent pattern-match expression** is a brace-delimited sequence of clauses opened with `?{`:

```
IndepMatchExpr         := Qmark OpenBrace _ IndepMatchStmts _ CloseBrace
IndepPatternStmt       := IndepCondClause _ MatchConsequent (_ Semicolon)*
IndepPatternStmtNoSemi := IndepCondClause _ MatchConsequentNoSemi
IndepCondClause        := (Qmark | Exmark)? BracketExpr

<IndepMatchStmts>      := ((IndepPatternStmt _)+ (ElseStmt | IndepPatternStmtNoSemi)?)
                        | IndepPatternStmtNoSemi
                        | ElseStmt
```

No trivia is admitted between the opening `?` and the `{`; the two must be lexically adjacent, as with the CondClause sigil and its `[` (§4.1). `? { ... }` is a parse error.

Each clause consists of a CondClause (with optionally-elided positive `?` polarity; see below) followed by a match consequent (§5.3). Clauses are separated by semicolons.

**Clause-list shape.** `IndepMatchStmts` admits three arms. The general arm is one or more semicolon-terminated `IndepPatternStmt` clauses, optionally followed by either an else clause (§5.4) or a final clause whose consequent drops its semicolon (`IndepPatternStmtNoSemi`, §5.3). The two remaining arms cover the degenerate single-statement bodies: a lone no-semicolon clause, and a lone else clause. An empty body `?{ }` matches no arm and is a parse error.

The trailing `(ElseStmt | IndepPatternStmtNoSemi)` is an exclusive choice: a body may end with a semicolon-less final pattern clause *or* with an else, not both. An else clause always terminates the body.

Example:

```java
def myName: "Kyle";

def greeting: ?{
    ?[myName ?= "Kyle"]: "Hello!";
    ![myName ?= "Kyle"]: "Goodbye!"
};

greeting;                   // "Hello!"
```

**Abstract execution:**

1. For each clause in source order:
    1. Evaluate the clause's CondClause per §4.1.
    2. If the clause matches:
        1. Evaluate the consequent in the current environment.
        2. The match expression's value is the consequent value; no further clauses are evaluated.
    3. If the clause does not match, proceed to the next clause.
2. If no clause matches:
    1. If a trailing else clause is present (§5.4), evaluate its consequent; the match expression's value is the else consequent value.
    2. Otherwise, the match expression's value is `empty`.

**Implicit-`?` polarity.** Within an independent pattern-match clause, the positive polarity sigil is *optional*. A bare `[test]` reads as implicit `?[test]`. The `!` polarity, when desired, must be written explicitly. This differs from §4.1's standalone CondClause, where the polarity is required.

```java
?{
    [isLoggedIn()]:   showDashboard();       // implicit `?`
    ![isRegistered()]: showRegistration()    // explicit `!`
}
```

**Equivalence to guard expression.** A single-clause independent match with no else clause is *exactly* a guard expression (§4.2): the consequent value on match, `empty` on non-match. §4.4 states the equivalence normatively, in the direction that matters for implementation -- the guard is defined as this form, and may be lowered to it.

The equivalence is total, including under the optional coverage-gap configuration (§5.5). That diagnostic is keyed on the **surface form** a program was written in, not on the desugared shape: a guard expression is partial by design (§4.2 -- its `empty` arm is unconditional and cannot be discharged), so a guard lowered to a one-clause match does not become a coverage gap by virtue of the lowering. Writing `?{ [c]: e }` directly does expose the clause to the diagnostic, because at that surface the missing else is a plausible omission rather than a stated intent.

The standalone `?[c]: e` form is the shorter surface for the single-clause case; the `?{ [c]: e }` form is preferred only when a second clause or an else is anticipated.

### §5.2 Dependent Pattern Matching

A **dependent pattern-match expression** evaluates a topic expression once, then threads the resulting value through each clause as the implicit left-hand side of the clause's tests:

```
DepMatchExpr         := Qmark OpenParen _ ExprNoBlock _ CloseParen
                         OpenBrace _ DepMatchStmts _ CloseBrace
DepPatternStmt       := DepCondClause _ MatchConsequent (_ Semicolon)*
DepPatternStmtNoSemi := DepCondClause _ MatchConsequentNoSemi

<DepMatchStmts>      := ((DepPatternStmt _)+ (ElseStmt | DepPatternStmtNoSemi)?)
                      | DepPatternStmtNoSemi
                      | ElseStmt
```

No trivia is admitted at either of the form's two lexical joins: between the opening `?` and the `(`, and between the topic's closing `)` and the `{`. `? (x){ .. }` and `?(x) { .. }` are both parse errors. Trivia *within* the topic parens and within the brace body is unrestricted.

**Clause-list shape.** `DepMatchStmts` has the same three arms as its independent counterpart (§5.1), with `DepPatternStmt` in place of `IndepPatternStmt`: a general arm of one or more semicolon-terminated clauses optionally followed by either an else clause (§5.4) or a semicolon-less final clause, plus the two degenerate single-statement arms. The trailing choice is exclusive -- a body ends with a semicolon-less final pattern clause or with an else, never both. An empty body `?(x){ }` matches no arm and is a parse error.

Example:

```java
def myName: "Kyle";

def greeting: ?(myName){
    ?["Kyle"]:   "Hello!";
    !["Kyle"]:   "Goodbye!"
};

greeting;                   // "Hello!"
```

**Abstract execution:**

1. Evaluate the topic expression in the current environment, producing a value `T`. `T` is bound once at match entry and is *not* re-evaluated for subsequent clauses.
2. For each clause in source order:
    1. Evaluate the clause's DepCondClause against `T` per §5.2.1.
    2. If the clause matches:
        1. Evaluate the consequent in the current environment, with `T` available at the topic reference position `#` (§5.2.2).
        2. The match expression's value is the consequent value; no further clauses are evaluated.
    3. If the clause does not match, proceed to the next clause.
3. If no clause matches:
    1. If a trailing else clause is present (§5.4), evaluate its consequent (with `T` still available at `#`); the match expression's value is the else consequent value.
    2. Otherwise, the match expression's value is `empty`.

The topic expression's single-evaluation property is important: dependent-match reads once, tests many. Side-effecting topic expressions therefore fire exactly once per match entry, regardless of the number of clauses.

#### §5.2.1 DepCondClause and Its Atoms

A **DepCondClause** is a bracketed list of one or more **atoms**, with optional polarity sigil:

```
DepCondClause   := (Qmark | Exmark)? OpenBracket _ DepCondExprList _ CloseBracket
DepCondExprList := DepCondExprAtom (_ Comma _ DepCondExprAtom)* (_ Comma)?
DepCondExprAtom := DepCondBoolExpr | ExprNoBlock
DepCondBoolExpr := AsTypeOp _ (BraceNarrowing | NamedType)
                 | DepCondBoolOp _ CompareDispatch
                 | NamedUnaryOp
                 | OpenParen _ DepCondBoolExpr _ CloseParen
DepCondBoolOp   := CompareOp | AndOp | OrOp
```

Each atom is a **boolean test against the topic** `T`. A DepCondClause matches when *any* of its atoms match (OR-semantics), further adjusted by clause polarity.

**Atom kinds.** Four shapes of atom are admitted:

1. **Bare expression atom** (`ExprNoBlock`). Evaluates to a value `V`; matches when `T ?= V` (equality against topic). Example: `?["Kyle"]` matches when `T ?= "Kyle"`.

2. **Operator-led atom** (`DepCondBoolExpr`, `DepCondBoolOp` arm). A comparison, boolean-logic, containment, or membership operator with the topic as implicit left operand and a written right operand. The operator is one of the CompareOp / AndOp / OrOp families. Examples:

    ```java
    ?(something){
        [?>= 18]: ...;                // matches when T ?>= 18
        [?< 0]: ...;                  // matches when T ?< 0
        [?in <1, 2, 3>]: ...;         // matches when T ?in <1, 2, 3>
        [?has "key"]: ...;            // matches when T ?has "key"
    };
    ```

    Negated forms (`!<`, `!<=`, `!>`, `!>=`, `!in`, `!has`, `!=`, `!<>`) use their inverted meaning at the atom position; the atom matches iff the negated comparison holds against `T`.

3. **Type-check atom** (`DepCondBoolExpr`, `AsTypeOp` arm). A `?as` or `!as` operator followed by either a named type or a brace narrowing; matches when the topic's type satisfies the annotation. Semantics for `?as` / `!as` and named types are specified in §9.

    The named-type form takes a bare or dotted type name:

    ```java
    ?(x){
        [?as int]: ...;               // matches when T is an int
        [?as Maybe]: ...;             // matches against a namespace
    };
    ```

    The brace-narrowing form is §6.3.1's `Effect.<A, B>` surface admitted at the atom position, carrying the same OR-union-over-prefix-subtrees semantic it carries at handler narrowing. It is what effect-handler arms are written in (§6.3.2):

    ```java
    ?(eff){
        // single subtree
        [?as Effect.<User.Ask>]: ...;

        // union of two subtrees
        [?as Effect.<User.Ask, User.Retry>]: ...;

        // dotted entries admitted
        [?as Effect.<User.Ask, Sys.Log>]: ...;
    };
    ```

    Both forms take the clause polarity (`![?as Effect.<Ask>]`) and both compose inside a multi-atom OR-list alongside atoms of other kinds. Because brace narrowing is itself prefix-matching, arm order matters where subtrees nest -- see §6.3.2.

4. **Paren-grouped atom** (`DepCondBoolExpr`, paren-recursive arm). A parenthesized `DepCondBoolExpr` for annotation reachability or precedence disambiguation. Example: `?[?and (x :as int)]`. Without the parens, `:as` is unreachable inside the operator-led arm because that arm reaches `CompareDispatch` directly rather than through `OperandExpr`; the paren-recursive form is the annotation escape hatch.

5. **Unary-operator atom** (`DepCondBoolExpr`, unary-op arm). A `NamedUnaryOp` (`?empty` or `!empty`) applied to the implicit topic with no written operand. Matches when the topic satisfies the unary test. Extends the "topic is the implicit operand" principle from binary atoms (topic as LHS) to the unary case (topic as sole operand).

    ```java
        ?(user){
            [?empty]: "no user";
            [!empty]: `"Hello, `#`"
        };
    ```

    The `?empty` and `!empty` operators here are the same operators specified as prefix unary boolean tests in §1.2. At dep-match atom position they carry no written operand; the topic supplies it.

**Implicit-`?` polarity.** As in §5.1, a bare `[atoms]` reads as implicit `?[atoms]`. The `!` polarity must be written explicitly.

The bare-expression atom form `?[expr]` and the fully-explicit form `?[?= expr]` are semantically equivalent; the bare form is the idiomatic surface.

**Multi-atom OR-list.** A DepCondClause may list several atoms separated by commas; the clause matches if any atom matches:

```java
def name: "Kyle";

?(name){
    ["Kyle", "Fred", "Joe"]: "Hello!";
    : "Goodbye"
};
```

##### §5.2.1.1 DepCondClause Abstract Execution

Abstract execution of a DepCondClause against topic `T`:

1. Evaluate atoms in source order against `T`, stopping at the first atom that matches; atoms after it are not evaluated. Each atom matches according to its kind:
    1. Bare expression atom: evaluate to `V`; the atom matches iff `T ?= V`.
    2. Operator-led atom: evaluate the RHS operand; the atom matches iff `T <op> RHS` holds.
    3. Type-check atom: the atom matches iff `T` satisfies the named type per §9.
    4. Unary-operator atom: the atom matches iff `<op> T` holds (the unary operator applied to the topic per §1.2).
2. Apply the clause polarity:
    1. If polarity is `?` (or absent, implicit `?`), the clause matches iff any atom matched.
    2. If polarity is `!`, the clause matches iff no atom matched.

Atom-level short-circuit avoids evaluating the tail of the OR-list once a match is established; this parallels the `?or` boolean-logic operator's short-circuit semantic. Clause polarity applies to the whole OR-list result: `![a, b, c]` matches when none of `a`, `b`, `c` match against `T`.

**Shared consequent.** All atoms of a clause share a single consequent, evaluated at most once when the clause matches. Splitting a multi-atom clause into separate clauses with duplicated consequents is *not* equivalent when the consequent has side effects; the OR-list form guarantees single-consequent evaluation.

#### §5.2.2 The Topic Reference `#`

Within a dependent match consequent, the symbol `#` refers to the topic value `T` bound at match entry. It is the same `T` regardless of which clause matched.

```java
def myName: "Kyle";

?(myName){
    ?["Kyle"]:  `"Hello, `#`!";       // "Hello, Kyle!"
    ?: `"Goodbye, `#`."
};
```

`#` at this position is a *value reference*, not a fresh evaluation of the topic expression. The topic's single-evaluation property (per §5.2's abstract execution) guarantees that side effects in the topic expression fire once, and every consequent's `#` observes the same value.

**Resolution.** `#` is a single reference resolving against one namespace, shared by every construct that binds a topic -- currently the dependent match (this section) and the `#>` pipeline (§3.10.12). It resolves to the **innermost enclosing binder** at the reference's position.

Only constructs that actually bind a topic participate. An independent match binds none, so nesting one inside a dependent match's consequent does not shadow: a `#` written inside the independent match still reaches the enclosing dependent match's topic. Nesting is not what shadows; binding is.

Where no enclosing binder exists, `#` is an unresolved reference and is rejected at compile time (§5.2.2.1).

The subsections that follow are instances of this rule rather than separate rules. §5.2.2.1 fixes the *extent* of a dependent match's binding -- its consequents, but not its topic expression or its atoms -- which determines where an inner match stops shadowing an outer one. §5.2.2.2 covers the ordinary nesting case, where an inner match's consequents do shadow.

##### §5.2.2.1 Binding Extent of the Topic

A dependent match binds `#` over its **consequents only** -- the pattern-clause consequents and the else consequent. Two positions sit inside the match syntactically but outside that binding:

- The **topic expression**. It is evaluated to produce `T` (§5.2, step 1); until it completes there is no topic to bind, so the match's own `#` is not available to it.
- The **DepCondClause atoms**. The topic is already each atom's implicit left operand (§5.2.1), so no named reference is needed and none is provided.

A `#` at either position therefore does not refer to the match's own topic. It resolves outward by §5.2.2's rule -- to the innermost *enclosing* binder, which may be an enclosing dependent match's topic or an enclosing `#>` pipeline's topic (§3.10.12), whichever is nearer. Only when no enclosing binder exists at all is the reference unresolved, and it is then **rejected at compile time**, like any other unresolved reference. There is no runtime fallback and no `empty` default, consistent with §6.1.1's guarantee that no ambient runtime error path exists.

```java
?(x){
    [?= true]: {
        ?(y[#]){                              // # is x -- topic expr,
                                              //   inner topic not yet bound
            [?= (?{ [x ?= #]: x; : # })]:     // both # are x -- atom position;
                                              //   the ?{ } binds nothing
                log(#)                        // # is y[x] -- consequent
        }
    }
};
```

Three of the four `#` above reach the outer topic and the fourth reaches the inner one, across two adjacent lines. The narrow binding extent is what makes this legal, and it is a genuine readability hazard: prefer capturing a topic into a named binding whenever a `#` would otherwise cross a match boundary.

##### §5.2.2.2 Nested Dependent Match

A dependent match nested inside another dependent match's consequent establishes its own topic binding. Within the inner match's **consequents**, `#` refers to the inner topic, and the outer topic is not reachable through `#`; capture it into a named binding at the outer scope if the inner consequents need it.

The shadowing is confined to that extent. At the inner match's topic expression and at its atoms, the inner binding is not yet in force (§5.2.2.1), so a `#` written there reaches the outer topic. Shadowing begins at the inner match's first consequent, not at its `?(`.

```java
?(outerName){
    ?["Kyle"]: ?(innerAge){
        ?[?>= 18]: `"Adult `#`";     // # is innerAge
        ?: `"Minor `#`"              // -same-
    };
    ?: "Unknown"
};
```

### §5.3 Match Consequents

Match consequents share the guard consequent forms of §4.3, with the addition that the final match consequent can omit the otherwise required `;` terminator.

```
<MatchConsequent>       := Colon _ (BlockExprStrict | Expr) _ Semicolon
<MatchConsequentNoSemi> := Colon _ (BlockExprStrict | Expr)
```

**Terminator counts.** The two forms differ only in whether a `;` is consumed, and the surrounding statement productions add a trailing `(_ Semicolon)*` on top. The resulting rule, per clause kind:

- A **non-final pattern clause** uses `MatchConsequent`: exactly one `;` is required, and further `;` are absorbed as empty statements.
- A **final pattern clause** may use either form. With `MatchConsequent` it keeps its `;`; with `MatchConsequentNoSemi` (`IndepPatternStmtNoSemi` / `DepPatternStmtNoSemi`) it drops it. Both parse; the drop is the idiomatic surface.
- An **else clause** always uses `MatchConsequentNoSemi` plus `(_ Semicolon)*`, so its terminator is optional at any count including zero. An else is always final (§5.4), so no clause follows it to disambiguate.

**Topic availability.** In a dependent match, every consequent -- pattern clauses and else alike -- evaluates with the topic `T` bound at `#` (§5.2.2). Independent-match consequents have no topic and no `#` binding from the match; a `#` written there resolves by the ordinary rules, per §5.2.2.1.

Consequent shapes: the same three sub-shapes as guard consequents (§4.3): expression consequent (§4.3.1), block consequent (§4.3.2, both bare and def-block forms), and assignment consequent (§4.3.3). Semantics are identical to their guard counterparts.

```java
?(myName){
    ["Kyle"]: log("hi");                 // expression
    ["Kyle"]: (y: 3) { log(y); y * 2 };  // def-block (BlockExprStrict)
    ["Kyle"]: { log("hi"); };            // bare block
    ["Kyle"]: myName := "KYLE!";         // assignment
};
```

As with guard consequents (§4.3), the block does not carry an implicit input at this position, so destructure targets in a def-block's defs clause require explicit initializers.

### §5.4 The Else Clause

Both independent and dependent match expressions admit an optional trailing **else clause**:

```
ElseStmt := Qmark? MatchConsequentNoSemi (_ Semicolon)*
```

The else clause consists of an optional leading `?` sigil followed by a match consequent. When no preceding pattern clause matches, the else clause's consequent is evaluated to produce the match expression's value.

No trivia is admitted between the `?` and the `:`. The pair cuddles as `?:`, consistent with `?[` (§4.1), `?{` (§5.1), and `?(` (§5.2) -- every `?`-led form in the language binds its sigil to the delimiter that follows it.

**Placement is structural.** A match body admits at most one else clause, and only in final position. Neither is a semantic check: `IndepMatchStmts` and `DepMatchStmts` (§5.1, §5.2) reach `ElseStmt` only through the single trailing `optional(...)` slot, so a second else, or an else followed by a pattern clause, fails to parse rather than being diagnosed later. An implementation gets both rules from the grammar and needs no separate pass to enforce them.

The trailing slot is an exclusive choice between an else clause and a semicolon-less final pattern clause, so a body ending in an else must terminate its last pattern clause with a `;`.

Two surface forms are semantically equivalent:

```java
?(name){
    ?["Kyle"]: "hi";
    ?: "hello"                        // explicit ?: form
};

?(name){
    ?["Kyle"]: "hi";
    : "hello"                         // abbreviated: no leading ?
};
```

The leading `?` on the else clause is a stylistic marker; it may be omitted for brevity or included for visual consistency when the match's pattern clauses use explicit polarity sigils.

**Semantic.** If any preceding pattern clause matches, the else clause is not evaluated. If no preceding clause matches, the else consequent is evaluated in the current environment (with the topic `T` available at `#` in the dependent form); its value is the match expression's value.

The else clause is the only way to give a match expression a total return semantic. Without an else, the match expression's value on non-match is `empty` (§1.1).

### §5.5 Composition and Value

Match expressions compose in the same two modes as guard expressions (§4.4):

- **As value-bearing expression:** the matching clause's consequent value (or the else consequent value, when applicable) is the match's value. On no match with no else, the value is `empty`.

    ```java
    def result: ?(status){
        ["ready"]:   compute();
        ["pending"]: waitFor();
        :            defaultValue
    };
    ```

- **As statement:** the match's value is discarded; clauses apply their side effects.

    ```java
    ?(event){
        ?["click"]: handleClick();
        ?["hover"]: handleHover()
    };
    ```

**Static type.** A match expression's type is the union of its clause consequents' types, taken across every clause including the else. When no else clause is present, `empty` joins the union unconditionally -- the no-match path is always reachable from the type's perspective, and no property of the clauses discharges it. This is the multi-clause generalization of §4.2's guard typing; a one-clause else-less match yields exactly `consequent-type | empty`, consistent with the desugaring of §4.4.

An else clause does not by itself collapse the union: `?(x){ [1]: "a"; : 0 }` has type `string | int`. What the else removes is the `empty` arm, not the multiplicity. See §9 for the union type's treatment.

**Tail position.** When a match expression occupies a tail position, every clause consequent occupies a tail position, including the else consequent. This is §3.4.1's eligibility propagation, and it is the mechanism §3.4.3 relies on: because a function has at most one `^`, multiple exit values come from a match or guard inside that one return, and PTC eligibility reaches them structurally rather than through control-flow analysis. The no-match path of an else-less match produces the `empty` literal with no call and is trivially tail-safe.

**Determinacy.** A match expression is *determinate* when its clauses cover all possible topic values (dependent form) or when the disjunction of clause conditions is a tautology (independent form). A match with an else clause (§5.4) is determinate unconditionally; it is the only construct in §4--§5 that can be.

**Runtime semantics do not depend on determinacy.** A non-determinate match's value on no match is `empty`, per the abstract execution of §5.1 and §5.2. That is the whole of the language semantic; determinacy adds no runtime behavior.

**The coverage-gap diagnostic is optional and §9-gated.** Whether the compiler rejects a non-determinate match is a compiler configuration, not a language rule. The analysis it would perform is not specified here and cannot be until §9 lands: deciding coverage of a dependent match requires enumerating a type's inhabitants, and deciding tautology over independent clause conditions requires reasoning about the conditions' types. A conforming implementation may omit the check entirely; one that implements it must not change the value any program produces, only whether that program compiles.

The diagnostic is keyed on **surface form**. A guard expression lowered to a one-clause match (§4.4) is not a coverage gap -- its partiality is stated intent (§4.2), not an omission. The same shape written directly as `?{ [c]: e }` is exposed to the check.

**Related forms.**

- **Guard expressions (§4.2)** are the single-clause degenerate case of independent pattern matching, and are *defined* as it: §4.4 states the desugaring normatively, and an implementation may share one evaluation path for both. See the surface-form keying above for how that lowering interacts with the coverage-gap check.

- **Function preconditions (§3.5)** share the `?[cond]:` clause syntax but compose as a shortcircuit sequence at call entry rather than as a value-bearing cascade. See §3.5.1 for the multi-parameter tier-lifting rule that governs their evaluation ordering.

- **Comprehension conditionals** (§7) reuse the CondClause primitive to gate `~each` loop-iteration continuation; see §4.1's reachability list.

## §6 Suspension and Evaluation Control

Foi programs express suspension and control-flow through three interlocking mechanisms -- **effects**, **handlers**, and **generators** -- plus a small set of sentinel forms (`Done@`, source-position `Left@` in Either-typed streams) that let loop-like constructs terminate cleanly.

Effects and handlers are the substrate; generators are a specialized surface built on the same substrate. All three mechanisms share a common shape: a *computation* runs, some position in that computation *suspends* the current work and hands a value to an outer scope, and the outer scope decides what value flows back in as the suspension's result.

The mechanisms differ in **who observes the suspension**. Effects performed inside a handler resume via the arm's `ret(...)` invocation invisibly. From userland's point of view, the perform site is an ordinary expression that produces a value; no userland code between perform and resume can run. Generators are the opposite: each yield is a perform whose resume waits until *some external agent calls `.next()`*, which means arbitrary userland code can execute between suspend and resume. Generators are the sole userland-observable pause point; every other effect is asynchronous only in the invisible-to-userland sense.

This observability distinction motivates why generators (and only generators) receive dedicated surface sugar (`<::` for Yield). Every other effect uses the general perform form because there is no ergonomic pull toward a shortened perform-site: userland cannot observe the pause, so no idiom needs to make it visually terse.

The remaining pieces this section specifies:

- Effects: what an effect kind is, how it is declared, how it is performed. (§6.1, §6.2)
- Handlers: the operators that establish a handler scope and dispatch perform-events to arms. (§6.3)
- Sentinel: `Done@` as universal loop-escape. (§6.4)
- Generators: the compiler-privileged reification transform for functions typed as `deft Gen.`-prefixed, and the `%`-driven iterator surface. (§6.6)
- Deferred type (State §6.7).
- Self-hosted pause-able types (Promise §6.8, Channel §6.9, Streams §6.10-§6.11, IO §6.12).
- Effect signatures in types. (§6.13)

**NOTE:** Effects, handlers, and their signatures reuse existing Foi surface: `deft` (with `Effect.` prefix), the `%` effector operator, `~<*` handler ops, and `:Effects(...)` narrowing. No new operators or keywords are introduced by this section; the mechanisms below specify what compiler-privileged behavior existing surface acquires when the LHS carries effect-kindedness.

**Composition axis (framing for §6.5 onward).** Every type introduced from §6.5 onward composes via one of two do-comprehension operators, distinguished by *who drives the composition*:

- **`~<<`**: the consumer drives. The block body binds successive values from the LHS wrapper; the composition terminates on the wrapper's own signal (exhaustion for iterating outers like `List`, `Iter`, `PullStream`; intrinsic single-shot for composing outers like `IO`, `State`, `Promise`).

- **`~<*`**: an external producer drives. The block body observes emissions that arrive from a source outside the block's control; the composition terminates when the source closes. Applies to `PushStream`, `Channel`, and the effect handler scopes established by §6.3.

Both operators require a *type* on the LHS -- either a bare type name (`Promise`) or a compound type expression (e.g., `List{Promise}`, per §18). A value on the LHS is a static error. Type-LHS resolves the composition's dispatch to a specific hook at compile time, consistent with Foi's other static-first commitments (universal proper tail calls §3.4, mandatory effect tracking §6.13, compile-time precondition dispatch §3.5).

Compound-LHS carries semantic meaning on `~<<`: an inner `Promise` annotation on an iterating outer triggers per-element awaiting behavior (each element is awaited before the block body executes for it); on the composing outer `IO`, the optional `IO{Promise}` annotation documents the native Promise-transformer behavior specified in §6.12.5. Compound-LHS is not admitted on `~<*`; the observer-of-emissions form has no auto-lift semantics.

Per-type behavior for both operators -- which arm applies, what the loop-variable receives per iteration, what terminates the composition -- is specified in each type's subsection.

### §6.1 Effects

An **effect** is a suspension point that yields control to whatever handler dynamically encloses it, along with a payload value. The handler decides what value the perform-site expression evaluates to.

Effects have three moving parts:

- An **effect kind**: a namespace declaring an operation's payload and resume shape. `Effect.Ask`, `Effect.IO`, and any user-declared effect kind are namespaces of this variety.
- A **perform site**: a source position where an effect of some kind is signaled. The perform site's expression value is set by the handler's `ret` invocation (§6.3.2).
- A **handler scope**: established by `~<*` applied to an effect kind or set of kinds (§6.3), containing arms that inspect the perform payload and may resume the perform site via `ret` (§6.3.2).

An effect kind may be performed anywhere reachable from a handler scope of that kind. If no handler scope for the kind is in effect at the perform site (dynamic through the call stack, not lexical), the perform is ill-formed under the effect-tracking discipline of §6.13; every reachable perform must be either declared upward in the caller's effect signature or caught by an enclosing handler.

#### §6.1.1 Contrast with Try/Catch

Effects superficially resemble exceptions: perform suspends the current computation and hands control up the call stack, just as `throw` does. The critical differences:

- **The computation is resumed, not abandoned.** An effect handler's
arm may invoke `ret(v)` to resume with `v` as the value of the
original perform-site expression; the computation continues from the
perform point with the arm-supplied result. Exceptions unwind the
stack; effects do not.
- **Effects are tracked in the type signature.** A function that
performs some effect declares that fact in its `:Effects(...)` clause
(§6.13). A function that raises exceptions carries no such surface
commitment. This makes effects composable in the FP sense. The type
of a computation records what suspension points it exposes to its
caller, just as a monadic return type records what structure wraps
its result.
- **The suspension does not escape.** An unhandled `throw` propagates
until something catches it or crashes the program; an unhandled perform
is rejected at compile time under §6.13. There is no ambient runtime
error path.

Effects therefore combine the *shape* of exception-driven control flow
(nonlocal transfer at a perform site) with the *discipline* of monadic
FP (types record what a computation does). The handler operators of §6.3
are the surface that keeps that discipline visible.

#### §6.1.2 Handler Scope: Lexical Establishment, Dynamic Lookup

A handler is established at a specific point in the source: where a
`~<*` handler-op invocation appears (§6.3). That establishment is
**lexical**: the handler's scope is bounded by the block containing
the handler-op invocation.

When a perform site executes, the runtime searches for a matching
handler by walking the call stack outward from the perform site until
it finds a handler scope whose caught-set (§6.3.1) includes the
performed effect kind. That search is **dynamic**: the handler need
not be in the perform-site's lexical enclosing scope; it need only be
somewhere in the chain of function calls leading to the perform.

This split parallels how exception handlers work in most languages: a
`try/catch` establishes lexically, but a `throw` inside a callee frames
deep is caught by the innermost matching `try` that encloses around the
`throw`. Effect handlers use the same discipline, and for the same
reason: the useful default is that a computation's effect suspensions
are handled by whichever caller wraps that computation, not by wherever
in the source the caller's `defn` happens to live.

#### §6.1.3 Effect Declaration

Effect kinds are declared with `deft`, using Foi's existing
function-type expression shape (§18) and a required `Effect.` name
prefix that signals effect-kindedness to the compiler:

```java
deft Effect.User.Ask(string) ^string;
deft Effect.User.Retry(<attempt: int, cause: string>) ^bool;
```

The parameter position declares the **payload type**: the shape of the
value a perform-site supplies. Inside a handler arm, this payload is
accessed as `.value` on the perform-event object (§6.3.2). The return
position declares the **resume type**: the shape of the value the
handler's `ret` invocation supplies and the perform-site expression
evaluates to. `empty` in return position marks a fire-and-forget
effect (perform-site expression is `empty`).

The `Effect.` prefix is normative. A `deft` whose name lacks the prefix
is a plain type alias (§18), not an effect kind: its name cannot appear
on the LHS of a `%` perform-site (§6.2), on the LHS of a `~<*` handler
operator (§6.3), or in `:Effects(...)` narrowing (§6.13). The prefix
carries no runtime cost; it is a compile-time discriminator only.

Dotted-name at the `deft` name position is admitted specifically for
effect declaration. Non-effect `deft` retains the single-Identifier form.

Effect kinds live under a three-root hierarchy specified in §6.1.4.
User declarations resolve under `Effect.User.*`, and dotted
sub-namespaces of any depth are admissible under that root, such as
`Effect.User.MyModule.CustomOp`.

A shorthand form omitting the `User` segment is admitted at every
effect site. §6.1.4's **Implicit-User rewrite** specifies it, and is
the sole site in this specification that demonstrates it; every other
section writes fully-qualified paths.

#### §6.1.4 Namespace Hierarchy

Effect kinds form a hierarchy via dot-separated identifiers. §6.1.3
admits any-depth dotted names at the `deft` name position; each dotted
segment introduces a level of the hierarchy.

**Prefix-match discipline.** Every effect-kind name that appears in a
handler-narrowing (§6.3.1), an arm pattern (§6.3.2), or an effect
declaration (§6.13.1) is a **prefix**. Naming `Effect.Foo` catches or
declares `Effect.Foo` and every declared kind whose fully-qualified
name begins with `Effect.Foo.` -- direct children and all descendants.
The match rule is a prefix-check on the effect kind's namespace path:
the tested kind's segment list must start with the named prefix's
segment list.

For an effect kind with no declared sub-namespaces, prefix-check
reduces to exact-check. Single-kind names (`Effect.User.Ask`, when no
`Effect.User.Ask.*` is declared) behave as exact matches in practice --
the wildcarding surface is invisible until sub-kinds are introduced.

There is no exact-match-only mechanism. To narrow beyond a broad
prefix, name more-specific paths: `Effect.User.IO.Read` narrows further
than `Effect.User.IO`. To catch a set of disjoint subtrees in one
handler, use brace form (§6.3.1) to enumerate multiple prefix roots.

**Arm-level `?as`.** Inside handler-arm patterns (§6.3.2), `?as
Effect.Kind` applies the same prefix-check. `[?as Effect.User.IO]`
matches any perform-event whose kind is `Effect.User.IO` or under it;
`[?as Effect.User.IO.Read]` matches only the `Read` subtree. When arms
have a parent/child prefix relationship, order matters: match dispatch
is first-match-wins (§5), so list child arms before their parent arms
if you want the child to fire specifically rather than being subsumed
by the parent.

**Reserved roots.** Three top-level roots under `Effect.` are
language-reserved and structure the entire effect namespace:

| Root | Role | User source rules |
|---|---|---|
| `Effect.User.*` | Userland effect kinds | User-declarable; sub-partitions below |
| `Effect.Host.*` | Compiler and runtime machinery | All four effect sites rejected |
| `Effect.Sys.*` | User-facing host services | Declaration rejected; perform, handler, and `:Effects(...)` reference admitted |

Any other top-level segment under `Effect.` is not a reserved root.
User source may write `Effect.<X>` (where `X` is not `User`, `Host`,
or `Sys`); the compiler treats it as shorthand for `Effect.User.<X>`
per **Implicit-User rewrite** below.

`Effect.Host.*` sub-partitions:

- **`Effect.Host.Gen.*`** -- generator substrate.
  `Effect.Host.Gen.Yield` is the perform site of the `<::` sugar
  (§6.2.2) inside `Gen.`-prefixed bodies (§6.6);
  `Effect.Host.Gen.Return` is a compiler-injected perform at tail
  positions of `Gen.`-prefixed bodies (§6.6.7).
- **`Effect.Host.Do.*`** -- do-comprehension substrate.
  `Effect.Host.Do.Bind` and `Effect.Host.Do.Map` are the perform sites
  of the do-block-body lowering under a `~<<` hook's OVERRIDE route
  (§3.10.9.4).
- **`Effect.Host.Slot.*`** -- host-internal per-instance slot access,
  used by runtime bookkeeping (namespace projection, sentinel
  comparison, effect-signature runtime state). Compiler-emitted only.
  Specified in §6.1.5.
- **`Effect.Host.<Trace, Coverage, ...>`** -- compiler-inserted
  instrumentation kinds, source-position-carrying and
  compile-option-gated. Emitted natively during compilation passes;
  not admitted in user source at any of the four effect sites.
  Compiler-authored diagnostics addressed to the programmer rather
  than to tooling -- deprecation notices and the like -- perform
  `Effect.Sys.Warn` instead, since their audience and delivery are
  those of a host service (§6.13.5).

`Effect.User.*` sub-partitions:

- **`Effect.User.Slot.*`** -- language-provided per-instance slot
  access surface for user-declared namespace hooks (specified in
  §6.1.5). User source can install a `~<*` handler scope over
  `Effect.User.Slot.<Read, Write>` for interception (mocking,
  tracing), but `deft` declaration into `Effect.User.Slot.*` is a
  compile error -- the sub-partition is language-provided.
- **`Effect.User.<anything else>`** -- user-declarable effect kinds.
  All four effect sites admitted.

`Effect.Sys.*` sub-partitions:

- **`Effect.Sys.<Log, Warn, Random, CurrentTime>`** -- ambient host
  services, specified in §6.13.5. User source may perform
  (`Effect.Sys.Log% ...`) or handle (`Effect.Sys.Log ~<* ...`) these
  kinds explicitly, or reference them in `:Effects(...)`; declaration
  is rejected because the ambient set is fixed by the runtime.

**Reserved-root leaf rejection.** `deft Effect.User`, `deft
Effect.Host`, and `deft Effect.Sys` (bare top segment, no further
dots) are compile errors -- the reserved roots are not declarable as
leaf effect kinds. User declarations must go at least one segment
deeper into the user root.

**Implicit-User rewrite.** Bare `Effect.<X>` at any of the four effect
sites (`deft`, `%` perform, `~<*` handler-narrowing, `:Effects(...)`),
where `X` is any first segment other than the three reserved roots
`User`, `Host`, or `Sys`, is treated as shorthand for
`Effect.User.<X>`. Dotted forms carry through: `Effect.MyModule.Sub`
is shorthand for `Effect.User.MyModule.Sub`. The rewrite is applied at
parse time; the fully-qualified form after rewrite is what appears in
all subsequent semantic layers:

```java
deft Effect.Ask(string) ^string;              // ≡ Effect.User.Ask
deft Effect.MyModule.CustomOp(int) ^bool;     // ≡ Effect.User.MyModule.CustomOp

Effect.Ask% "prompt";                         // ≡ Effect.User.Ask% "prompt"
Effect.Ask ~<* (eff:: comp, ret) { ... };     // ≡ Effect.User.Ask ~<* (..)
```

Explicit reserved-root paths (`Effect.User.Ask`, `Effect.Sys.Log`) are
always valid at the sites where their partition admits them. Explicit
paths do not rewrite -- a name that already begins with a reserved
root resolves as written.

The `:Effects(...)` clause has its own last-segment-shorthand form
described in §6.13.1; that form composes with implicit-User rewrite.

**Compiler-emission at rejected sites.** The compiler emits into
`Effect.Host.*` and `Effect.Sys.*` natively during lowering and
runtime handler installation; user source is guaranteed
partition-clean by parser construction. The rejection applies only to
user source: compiler-generated code that establishes handler scopes
for these partitions (e.g., the stdlib `Gen.runner@` handler at
§6.6.7, the `~<<` hook body compiled from a user's `Name~<<`
declaration at §3.10.9.4, or the runtime top-level handler for
ambients at §6.13.5) is a compiler-authored code path, not user
source.

##### §6.1.4.1 Admission Procedure

Given a written effect path `P` and an effect site `S`, where `S` is
one of `deft` (declaration), `%` (perform, including the `<::` sugar
of §6.2.2), `~<*` (handler narrowing, including arm `?as` patterns),
or `:Effects` (signature reference), admission is decided by the
following procedure. Steps are sequential; the first step that
rejects terminates the procedure.

1. **Provenance.** If the code under compilation is a
   compiler-authored path (lowering output, stdlib hook bodies
   compiled from user declarations, runtime handler installation),
   admit `P` unconditionally and stop. Every remaining step applies
   to user source only.

2. **Site-local shorthand.** If `S` is `:Effects`, apply §6.13.1's
   entry normalization: if `P`'s leftmost segment is not exactly
   `Effect`, prefix `Effect.` to `P`. At the other three sites, no
   site-local expansion applies.

3. **Effect-kindedness.** If `P`'s leftmost segment is not exactly
   `Effect`, reject: `P` names a plain type, not an effect kind
   (§6.1.3). Because step 2 precedes this one, a `:Effects` entry
   written in last-segment shorthand has already acquired the prefix
   and passes here.

4. **Implicit-User rewrite.** Let `R` be `P`'s first segment after
   `Effect`. If `R` is not one of `User`, `Host`, `Sys`, replace `P`
   with `Effect.User.` followed by everything after `Effect.`, and
   set `R` to `User`. Otherwise leave `P` unchanged. `P` is now
   fully-qualified, and every subsequent step reads the rewritten
   form.

5. **Partition admission.** Dispatch on `R` and, under `User`, on
   whether `P` falls in the `Slot` sub-partition:

   | Partition | `deft` | `%` | `~<*` | `:Effects` |
   |---|---|---|---|---|
   | `Effect.Host.*` | reject | reject | reject | reject |
   | `Effect.Sys.*` | reject | admit | admit | admit |
   | `Effect.User.Slot.*` | reject | admit | admit | admit |
   | `Effect.User.*` (other) | admit | admit | admit | admit |

   The two rejected-at-`deft` partitions are language-provided:
   `Effect.Sys.*` membership is fixed by the runtime (§6.13.5), and
   `Effect.User.Slot.*` is the language's own slot surface (§6.1.5).
   Reserved-root leaf rejection at `deft` (this section, above)
   applies independently at that site.

6. **Resolution.** If `S` is `%`, `P` resolves by exact name: the
   perform site names one declared effect kind, whose declared
   payload and resume types (§6.1.3) type the perform expression.
   Prefix-matching does not apply here. A `P` naming no declared
   kind is an undeclared-name error like any other; no rule specific
   to reserved roots or to prefixes is involved. Implicit-User
   shorthand is admitted, having been resolved at step 4, though
   spec examples write perform sites fully-qualified.

   If `S` is `~<*` or `:Effects`, `P` is a **prefix** per this
   section's prefix-match discipline, and an empty subtree under `P`
   is not an error -- a handler or signature written against a
   subtree that later grows sub-kinds remains well-formed.

Admission is decided independently of whether a matching handler
exists at runtime; coverage is a separate obligation specified at
§6.13.4.

**Worked traces.**

```java
:Effects(Ask)              // step 2: -> Effect.Ask
                           // step 4: -> Effect.User.Ask
                           // step 5: User (other), :Effects -> admit

Effect.Sys.Log% "hi"       // step 2: n/a
                           // step 4: R = Sys, no rewrite
                           // step 5: Sys, % -> admit
                           // step 6: Sys.Log declared -> resolves

deft Effect.Sys.Custom(int) ^int;
                           // step 5: Sys, deft -> reject

Effect.Host.Gen.Yield% 1   // step 5: Host, % -> reject
                           // (`<::` is the admitted surface, §6.2.2)

Effect.MyMod.Op% x         // step 4: -> Effect.User.MyMod.Op
                           // step 5: User (other), % -> admit
                           // step 6: resolves if declared

Effect.User% 42            // step 5: User (other), % -> admit
                           // step 6: `Effect.User` names no declared
                           //         kind -> undeclared-name error

Effect.User ~<* (..)       // step 5: User (other), ~<* -> admit
                           // step 6: prefix; catches every declared
                           //         kind under the user root,
                           //         including Effect.User.Slot.*
```

#### §6.1.5 Per-Instance Slots

Every value in Foi has a **per-namespace slot**: a single storage
cell, per `(namespace, value)` pair, whose read and write are
mediated by the language-provided `Effect.User.Slot.<Read, Write>`
effect kinds. Slots are Foi's substrate for per-instance state
inside namespace-declared hooks (§3.1.1). Where `:over` mutable
closures (§2.11) provide per-function-value state, slots provide
per-instance state scoped to a namespace's own hooks.

The slot exists **implicitly**. No declaration clause on `deft`
introduces it; whatever a namespace's hooks write is what its hooks
read. A namespace that stores multiple fields per instance keeps a
compound (Tuple or record) in the slot.

##### §6.1.5.1 Storage

Slot storage is a runtime side-table primitive keyed on the
composite `(namespace-identity, value-identity)`. The specific
representation is implementation-transparent: on-instance storage
where the value's shape permits it (owned instance shapes,
`@`-constructed under a namespace Foi controls) and side-table
entries for primitives, literal-constructed values, and shapes Foi
does not own.

An unwritten slot resolves to `empty` on read. Namespaces that
require initialized state may either check `empty` on first read
and lazily initialize, or initialize eagerly inside the namespace's
`@` constructor hook.

##### §6.1.5.2 Access Effects

Slot access is performed through two effect kinds under
`Effect.User.Slot.*` (§6.1.4):

- **`Effect.User.Slot.Read`** -- payload: the instance whose slot
  to read. Resume type: the slot's current value (or `empty` if
  unwritten).

- **`Effect.User.Slot.Write`** -- payload: a Tuple `<inst, value>`
  binding the instance and the value to write. Resume type:
  `empty` (fire-and-forget; the write is complete when the
  perform-site expression evaluates).

**Slot kinds are not ambient.** The runtime installs a slot-access
handler at every outermost `%` invocation, so **coverage** (§6.13.4)
is pre-satisfied and no user-side `~<*` is ever required. The
**emit-edge rule** (§6.13.2) applies in full: a hook whose body
performs slot access declares it, exactly as it would any other
tracked effect. The ambient category (§6.13.5) is the four
`Effect.Sys.*` kinds and nothing else; slots are pre-covered, not
exempt from declaration. A namespace's statefulness is visible at
its declared surface.

Spell the declaration entry at the granularity the hook uses: name
the `Effect.User.Slot` prefix when the hook both reads and writes,
and the specific leaf (`Effect.User.Slot.Read`) when it does only
one. Entries prefix-match per §6.1.4, so the prefix form covers
both leaves.

A namespace `Tally` whose instances track a compounding count
alongside a tag:

```java
deft TallyStep(Tally, string) :Effects(Effect.User.Slot) ^int;

defn Tally@(initTag) ^< tag: initTag >;

defn Tally%(inst, newTag) :as TallyStep {
    def current: Effect.User.Slot.Read% inst;
    def prevCount: ?{ [current ?= empty]: 0; : current.count };
    def next: < count: prevCount + 1, tag: newTag >;
    Effect.User.Slot.Write% <inst, next>;
    ^next.count;
};
```

At the call site:

```java
def c: Tally@ "session-1";

c% "click";      // 1
c% "click";      // 2
c% "submit";     // 3
```

The `Tally%` hook body reads the current slot value, computes the
next value, writes it back, and returns a projection to the caller.
The instance `c` itself is unchanged by the writes -- the slot
storage is orthogonal to the constructed value's shape. The `@`
constructor performs no slot access and so carries no declaration;
only the hooks that actually touch the slot do.

##### §6.1.5.3 Namespace Identity is Compile-Time Lexical

The runtime handler resolves each slot access against the namespace
identity of the hook that **lexically encloses** the perform site.
The lexical namespace is established at compile time from the
enclosing hook's declaration form (`defn Tally@`, `defn Tally%`,
`defn Tally~<`, `defn Tally+`, etc.) and injected at the
perform-site emit; the effect payload never carries the namespace
identity as runtime data.

A consequence: a free function declared outside the namespace does
not inherit its caller's namespace context. If a `Tally` hook
calls a free-standing helper function, `Effect.User.Slot.Read%`
performed inside that helper resolves against the helper's own
lexical namespace context (typically none, or a different
namespace), not `Tally`'s. Slot-touching logic that needs to be
factored out of a hook body must stay inside a namespace-marked
hook declaration -- shared logic across hooks composes as inline
`def`s inside those hooks or passes slot values through parameters.

Cross-namespace slot access is structurally impossible: no key
value exists that could be passed between namespaces, because
namespace identity is a compile-time lexical property, not
runtime data.

##### §6.1.5.4 Interception via User Handlers

`Effect.User.Slot.*` is user-**handleable** but not
user-**declarable**:

- User source may install a `~<*` handler over
  `Effect.User.Slot.<Read, Write>` for the purposes of mocking,
  test-time capture, tracing, or other debugging cooperation.
  Standard dynamic lookup (§6.1.2) finds the user's handler before
  the runtime's slot-access handler, giving the user handler an
  opportunity to intercept slot access within a bounded scope.

- User source may not declare into `Effect.User.Slot.*` via
  `deft`; the sub-partition is language-provided (§6.1.4).
  Attempting `deft Effect.User.Slot.<X>` (or `deft Effect.Slot.<X>`
  under the implicit-User rewrite) is a compile error.

##### §6.1.5.5 Host-Side Slot Access

Compiler-emitted runtime bookkeeping (namespace-identity
projection, sentinel comparison, effect-signature state, and other
runtime machinery) uses a parallel `Effect.Host.Slot.<Read, Write>`
kind with the same payload shape but a sealed partition per §6.1.4.
User source cannot perform, handle, narrow against, or name
`Effect.Host.Slot.*` in `:Effects(...)` -- all four effect sites are
rejected per §6.1.4's `Effect.Host.*` partition rule. The
`:Effects(Effect.Host.Slot)` spelling is therefore reachable only
from compiler-authored stdlib code paths, never from user source.
The partition exists to give the runtime the same slot-storage
discipline as user code without user-observable side effects.

##### §6.1.5.6 Reference Identity

Slot storage keys on a **runtime substrate identity** that is
distinct from user-observable equality. Three layers separate the
concerns:

1. **Substrate identity** -- a cheap, stable, unforgeable
   per-value identity used internally by slot-storage keying,
   sentinel comparison, namespace-identity projection, and garbage
   collection. The substrate identity never surfaces as a user
   operator or predicate.

2. **Namespace-declared equality** -- the user-facing `?=` operator
   (§3.1.1.4), dispatched through the LHS namespace's `?=` hook.
   Absence of a `?=` hook on an `@`-constructed instance's
   namespace makes `?=` on that instance a compile error; presence
   of a hook makes `?=` behave as the namespace author declares.

3. **Slot storage** -- keyed on substrate identity internally; not
   exposed to userland. The user surface for slot storage is the
   `Effect.User.Slot.*` effect kinds above.

By value category, the user-facing rules are:

- **`@`-constructed instances** (State, Promise, Channel, IO,
  Writer, user-defined types): substrate identity at Layer 1; `?=`
  at Layer 2 requires the namespace to declare a `?=` hook, else
  compile error. The runtime is free to intern or not intern
  identical instances -- there is no user operator to observe the
  choice.

- **Literal-constructed values** (Tuples, records, ranges):
  structural at Layer 1 (slot-storage keying is via structural
  hash) and Layer 2 (language-provided structural `?=`).

- **Primitives** (numbers, strings, `empty`, booleans): value-
  identity at Layer 1; language-provided value-`?=` at Layer 2.

- **Namespace handles** (`List`, `Maybe`, etc.): identity at both
  layers; language-provided identity-`?=` special-cased since
  namespace handles are one-per-declaration.

Reference identity is **bounded, not eliminated**. General
userland has no operator to observe it, and cross-namespace
observation is structurally impossible per the compile-time
lexical property of namespace identity established above. Within
a namespace's own hooks, reference identity of the namespace's
own instances is intrinsically observable -- that is what
per-instance state requires, and slot access via
`Effect.User.Slot.*` is the surface Foi provides for it.
Namespaces may also expose reference-identity-derived semantics
through their public `?=` hook as an explicit design decision;
the resulting behavior is visible in the namespace's own
declaration, not a language-level leak.

##### §6.1.5.7 Coupling Hygiene, Not Adversarial Defense

The mechanisms in this section are **abstraction hygiene**, not
adversarial defense. Foi assumes cooperating users; a user
determined to subvert the mechanism forks the compiler, and Foi
does not pretend to prevent that.

The specific hygiene properties:

- **Cross-namespace access impossibility** prevents user code from
  accidentally depending on another namespace's internal state
  representation. No key value exists to pass, because namespace
  identity is compile-time lexical, not runtime data.

- **`Effect.Host.Slot.*` sealing** prevents user code from naming
  runtime-owned slot access, since those identifiers may change
  across compiler versions.

- **Reference-identity non-exposure** prevents user code from
  depending on runtime interning decisions, since userland has no
  operator to observe those decisions.

Explicit named cross-namespace grants (e.g., "namespace A may
access namespace B's slots") are not admitted in the current
design.

### §6.2 Performing Effects

A **perform site** signals that the enclosing computation is producing
an effect of some kind. Two surface forms serve as perform sites: the
general `%` effector operator applied to an effect-kinded LHS, and the
`<::` sugar specific to `Effect.Host.Gen.Yield` (in a Generator). Both are
value-bearing expressions; the value the perform-site expression
evaluates to is set by the handler that catches the perform.

**Abstract execution:**

1. Evaluate the payload expression in the current environment (when a
payload is supplied); when no payload is supplied, the payload is
`empty`.
2. Suspend the current computation at the perform site.
3. Walk the dynamic call stack outward from the perform site to locate
the innermost handler scope whose caught-set (§6.3.1) includes the
perform's effect kind. Per §6.1, an unhandled perform is rejected at
compile time under §6.13; no runtime search failure path exists.
4. Deliver the payload value to the located handler's arm (§6.3),
wrapped in a perform-event object (§6.3.2) with the payload at
`.value`.
5. The arm evaluates in its own scope. If the arm invokes `ret(v)`,
the suspended computation resumes at the perform site with `v` as the
perform-site expression's value, running forward until natural
completion or its next perform under the same handler scope. If the
arm never invokes `ret` and does not produce a `Done@` arm-terminal
(§6.4.1), the perform site remains suspended; a captured `ret`
(§6.3.2) may resume it later from a different dynamic context.
6. Handler-scope termination and the value of the enclosing `~<*`
expression are specified in §6.3.3; the handler expression evaluates
to a `Promise` that resolves at scope termination.

The suspension is not visible in the perform-site's source form. From
the perform-site expression's point of view, `Effect.Ask% "prompt"` is
a plain expression that produces a string; the runtime mechanism that
connects perform to handler is orthogonal to how the expression is read
locally.

#### §6.2.1 The `%` Perform Form

The general perform form is the `%` effector operator (§3.9) applied to
an effect-kinded LHS:

```java
Effect.User.Ask% "What's your name?";
Effect.Sys.Log% "starting up";
Effect.User.Retry% <attempt: 3, cause: "timeout">;
```

Whitespace rules follow §3.9: `Effect.User.Ask%"prompt"`,
`Effect.User.Ask% "prompt"`, and `Effect.User.Ask % "prompt"` all
parse to the same perform site.

**Compiler-privileged behavior.** When `%` is applied to a LHS carrying
the normative `Effect.`-prefix effect-kindedness (§6.1.3), the `%`
operator dispatches to the privileged, compiler-defined `_percent` hook,
which performs the effect: suspending the current frame, walking the
call stack for a matching handler, delivering the payload, and receiving
a resume-value per §6.2's abstract execution. The effect-kindedness of
the `%` LHS is the signal that selects this special behavior.

**Type check.** The payload expression's type must match the effect
kind's declared payload type (§6.1.3). The perform-site expression's
type is the effect kind's declared resume type. Both are compile-time
obligations of §6.13's effect-tracking discipline.

#### §6.2.2 The `<::` Sugar for `Effect.Host.Gen.Yield`

The composite token `<::` is surface sugar for a compiler-emitted
`Effect.Host.Gen.Yield` perform:

```java
<:: 42;                     // sugar; compiles to `Effect.Host.Gen.Yield% 42`
<:: someValue;              // sugar; compiles to `Effect.Host.Gen.Yield% someValue`
```

`Effect.Host.Gen.*` is a compiler-privileged partition per §6.1.4; user
source cannot write `Effect.Host.Gen.Yield%` directly, and `<::` is the sole
surface admitted for this perform. This is the only effect kind with a
syntactic shorthand form. A generator yield is Foi's sole
userland-observable pause point (§6 opener); yield-heavy producer code
reads cleanly with the reduced notation.

The sugar is syntactic only. `<:: expr` and its compiled
`Effect.Host.Gen.Yield% expr` are handled by the same call-stack walk
described in §6.2's abstract execution.

### §6.3 The Handler Operator

The `~<*` operator establishes a **handler scope**: a lexical region
within which effect performs of specified kinds are caught by
user-supplied arms. Each perform of a caught kind (not merely the
first) is dispatched to a matching arm; the arm may resume the perform
site by invoking a **resumption callable** bound in the handler head,
or may terminate the scope by finishing without resuming.

The general handler form:

```java
Effect.User.KindA ~<* (eff:: comp, ret) { .. };
```

- The **LHS** is an effect-kind narrowing (§6.3.1): the set of kinds
this handler catches.
- The **head parens** bind `eff` to each perform-event dispatched to
this handler, specify `comp` as the computation to run in the handler
scope, and bind `ret` as the resumption callable available inside arm
bodies (§6.3.2).
- The **body block** contains **arms**: pattern-match clauses over
`eff` (§6.3.2). Each arm's body may invoke `ret(v)` to resume with `v`
as the perform-site expression's value.
- The whole form's value is determined by how `comp` terminates
(§6.3.3).

Effect kinds *not matching* the LHS's narrowed set propagate past the
handler and continue up the dynamic call stack per §6.1.2, subject to
§6.13's effect-tracking discipline.

**NOTE:** `~<*` is the sole Effect handler-establishing form; the
single-shot `~<<` do-comprehension (§7) does not participate in effect
handling, as only handling the first effect performed would be a
rare/unlikely approach.

#### §6.3.1 Effect-Kind Narrowing

The LHS of `~<*` is an **effect-kind narrowing expression** that names
the set of effect kinds this handler is responsible for catching. Two
shapes are admitted; both prefix-match per §6.1.4:

```java
Effect.User.IO            // bare form: one prefix root
                          // (Effect.User.IO and all Effect.User.IO.*)
Effect.User.<Ask, Retry>  // brace form: multiple prefix roots
                          // (Effect.User.Ask.* & Effect.User.Retry.*)
```

- **Bare form**: `Effect.Name` catches performs of `Effect.Name` and
  every declared kind under `Effect.Name.*`.
- **Brace form**: `Prefix.<A, B, ...>` catches the union of the named
  prefix subtrees. Each entry is resolved **relative to the written
  prefix**: `Effect.User.<Ask, Retry>` names `Effect.User.Ask` and
  `Effect.User.Retry`. Entries may themselves be dotted, extending
  the prefix further (`Effect.User.<IO.Read, IO.Write>`).

The narrowing is closed: exactly the kinds admitted by the DSL are
handled, and nothing else. Any perform of a kind outside every named
prefix propagates past the handler.

Use bare form to catch a single subtree. Use brace form to catch a
union of disjoint subtrees. To catch a narrower slice than an
available parent prefix, name more-specific children instead of the
parent.

**Cross-uses.** The prefix-match rule of §6.1.4 applies wherever an
effect-kind path is named: handler narrowings here, `?as` patterns
inside handler arms (§6.3.2), standalone `?as`/`!as` binary
expressions (§9's TypeCompareBinExpr), and `:Effects(...)`
type-signature declarations (§6.13.1). At every one of those sites, a
named path denotes a prefix subtree.

The **brace form** is narrower. It is admitted at the first three --
handler narrowing, arm patterns, and `?as`/`!as` -- all of which carry
OR-union semantics ("any of these subtrees"). It is **not** admitted
in `:Effects(...)`, whose list carries AND semantics (the function
declares it may perform every entry). The two lists share no grammar
production; a `:Effects(...)` entry naming several subtrees spells
each one separately.

#### §6.3.2 Arms

The body of a `~<*` handler installed over an effect-kind narrowing is
a **discrimination block against `eff`**: a sequence of statements
that dispatches per perform-event on the bound perform-event object,
resumes the perform site via `ret`, or terminates the scope via
`Done@`. Do-block terminology (Bind/Map lowering, terminal unwrap)
does not apply at Effect-handler sites -- monadic-`~<*` (LHS =
`PushStream`, `Channel`, or other monadic structure per §6.9, §6.10)
has genuine do-block semantics; the Effect-handler form syntactically
appropriates the same body grammar but does not perform lowering, and
sigils like `::` and `$` are semantically inert at Effect-handler
body sites. Each perform-event dispatched to this handler fires the
body top-to-bottom; the arms inspect the event and the matched arm's
body handles it -- typically by invoking `ret(v)` to resume the
suspended computation with `v` as the perform-site expression's
value. Idiomatically, all arms are consolidated in a single dependent
match on `eff` at the body's top level; multiple dependent matches
would parse and dispatch correctly but there is no reason to split
arms across separate matches.

The handler scope is not per-dispatch: it persists across many
dispatches from the same `comp`, terminating only when `comp` completes
(§6.3.3). An arm that never invokes `ret` handles its event to
completion but does not itself terminate the scope; its terminal
expression is discarded. Scope termination via a `Done@`-shaped arm
terminal is a separate mechanism (§6.4.1).

The canonical arm shape is a dependent match against `eff` as a bare
statement in the handler body:

```java
Effect.<User.Ask, Sys.Log> ~<* (eff:: producer(), ret) {
    ?(eff){
        [?as Effect.User.Ask]: ret(readLine(#.value));
        [?as Effect.Sys.Log]: ret(log(#.value));
    };
};
```

The value bound to `eff` at the handler head, and reachable as `#`
inside a dependent match's arm bodies via the topic-of-dispatch
convention, is the **perform-event object**: a first-class value
carrying the performed effect's kind and payload. Its shape is:

- `.value` -- the payload the perform-site supplied, typed per the
  effect kind's declared payload type (§6.1.3).
- `.pos` -- reserved for source-position metadata (compiler-emitted,
  used by stack traces and instrumentation).
- `.siteId` -- reserved for per-site identity metadata
  (compiler-emitted).

Payload access from within an arm body is `#.value` (or `eff.value`
at the handler-head scope). Bare `#` is the perform-event object
itself; treating it as the payload directly is a shape mismatch.

**Head parens.** The `(eff:: producer(), ret)` clause is a
DoBlockDefsInit-shaped head (§16). It binds `eff` to each perform-event
object dispatched to this handler, specifies `producer()` as the
computation whose performs are caught, and binds `ret` to a fresh
resumption callable per perform-event.

**Resumption callable `ret`.** `ret` is a **delimited one-shot continuation** callable bound freshly per perform-event. Invoking `ret(v)` resumes the suspended computation at the perform site with `v` as the perform-site expression's value, driving the computation forward until it reaches its next boundary.

**Control flow across `ret`.** Three boundaries can be reached: (a) a next perform caught by this same handler, (b) a perform that escapes this handler (an effect kind not narrowed by this handler's LHS; §6.3.1), (c) natural completion of `comp`. In case (a), `ret` returns synchronously to its caller; arm code after the `ret` call runs before the arm's terminal expression, and the newly-queued perform dispatches to a fresh arm firing. In case (b), the outer enclosing handler owns the resume schedule; a delimited continuation from `ret`'s call site captures the arm-post-`ret` code, this scope's remaining logic, and everything downstream to the outer handler. On resume, the captured stack runs synchronously from the escape point; `ret` blocks its caller across the escape. In case (c), `ret` returns after `comp`'s natural completion; the arm continues past `ret` to its terminal.

**Return-value opacity.** Under well-formed usage, `ret`'s return value carries no meaningful information: state communication between arm and callee flows exclusively through the payload (callee→handler) and `ret`'s argument (handler→callee), and mid-body arm terminals are discarded (a `Done@`-shaped arm terminal is a separate scope-termination mechanism, §6.4.1).

A `ret` value is one-shot. The first invocation resumes the
computation. A second invocation of an already-spent `ret` returns
`Left@ "Continuation Unavailable"`, does not resume the computation, and
has no side effects. This is a state descriptor, not an error path;
the returning `Left@` is inspectable, mirroring the "Iterator
Exhausted" idiom (§6.5.2).

A captured `ret` remains a valid delimited continuation across the
arm's syntactic completion. Storing `ret` into an enclosing
(mutable-`:over`) scope and invoking it from a later dynamic context
is admissible; the compiler-emitted `Gen.runner@` runner (§6.6.7)
uses this pattern to convert per-perform events into stepper
interactions.

**Final unwrap `?(eff){ ... }`.** The do-block's final unwrap
position (§16), evaluated per dispatch. Its value is discarded unless
it is a `Done@`-shaped value, which terminates the scope (§6.4.1); see
§6.3.3 for how the handler expression's value is determined.

**Arms.** The dependent-match clauses of `?(eff){ ... }`. Each arm's
pattern is `?as Effect.KindName`, prefix-matching the perform-event's
effect kind per §6.1.4. Arm order is first-match-wins (§5): when arms
have a parent/child prefix relationship, list child arms before parent
arms so the child fires specifically rather than being subsumed. The
arm's consequent runs for its side effects (typically invoking `ret`);
its terminal expression is discarded unless it is a `Done@`-shaped
value (§6.4.1).

**Type check on `ret` argument.** Each `ret(v)` invocation must supply
a value of the matched effect kind's declared resume type.
`Effect.User.Ask` declares `^string`; a `ret(v)` inside its arm must
supply a `string`. `Effect.Sys.Log` declares `^empty`; a `ret(v)`
inside its arm must supply `empty`. Compile-time obligation of §6.13.

**Arm terminal type.** The arm terminal type contributes to the handler
expression's return type at scope termination; see §6.3.3.

**Exhaustiveness.** The arms must cover every effect kind admitted by
the LHS narrowing. `Effect.User.<Ask, Log>` requires arms covering
both the Ask and Log subtrees; a single `[?as Effect.User.Ask]` arm
exhausts the Ask side (since it prefix-matches all
`Effect.User.Ask.*`). A default `?:` arm (§5.4) catches
otherwise-unmatched kinds, useful when a broad prefix subtree may
grow new sub-kinds later.

This is a **mandatory** compile-time check, and it is distinct from
§5.5's coverage-gap diagnostic. §5.5's check is optional, §9-gated,
and keyed on the surface form of an ordinary dependent match; it does
not govern here even though the handler body is written as one. The
handler-arm check is keyed on the `~<*` LHS narrowing and is not
configurable.

The two differ because their failure modes differ. An ordinary
dependent match whose topic matches no clause yields `empty`, a
well-defined value the surrounding code proceeds with. A handler
dispatch matching no arm resumes nothing: the `ret` bound for that
perform-event becomes unreachable when the body finishes, no arm
produced a `Done@` terminal, and the perform site inside `comp` is
left suspended with no surviving route to resume it. The handler
expression's Promise is then permanently pending. This is not the
well-formed pending state of §6.3.3 -- that state presupposes a
captured `ret` still able to drive `comp` forward, and an unmatched
dispatch captures nothing.

**Scope of the check.** Coverage is verified against the effect kinds
**declared** at compile time that fall under the LHS narrowing's
prefixes. A prefix subtree that later grows a new sub-kind does not
retroactively invalidate a handler compiled before that declaration;
recompilation surfaces the new gap. A `?:` default arm satisfies the
check unconditionally and is the recommended shape for handlers over
broad prefixes.

#### §6.3.3 Handler Expression Value

A `~<*` handler expression evaluates to a **`Promise` instance**
(§6.8) that resolves when the handler scope terminates. Under Foi's
synchronous execution model, a Promise whose backing scope completes
synchronously is immediately resolved; `.resolved()` (§6.8) tests
whether that has happened, and the resolved value is reached by
composing with `~<` / `~map` or by binding the promise under
`Promise ~<<`.

Scope termination -- and thus Promise resolution -- occurs in two
shapes:

**Natural completion of `comp`.** `comp` runs off the end of its body
or reaches an explicit `^` return. The Promise resolves with `comp`'s
natural return value. Each perform-event dispatched during `comp`'s
execution had its own arm handling; when arms invoked `ret`, those
resumes drove `comp` forward toward this completion. The Promise's
resolved value is `comp`'s eventual return, independent of arm
terminals along the way. A `Done@`-typed return from `comp` is comp's
return value like any other; the Promise resolves with the `Done@`
value itself, unwrapped by nothing and interpreted by nothing. This
differs from the `Done@` arm-terminal shape below, which does unwrap
to the payload -- the arm terminal is a position that inspects for
`Done@` (§6.4), and comp's return is not.

**`Done@` arm-terminal.** A matched arm evaluates its consequent to a
`Done@`-shaped value at the arm's terminal position without having
invoked `ret` on the current dispatch. The handler scope terminates
immediately and the Promise resolves with the `Done@` payload. The
perform site inside `comp` that triggered this dispatch does not
receive a resume-value; `comp` is abandoned at that perform point.
See §6.4.1.

If neither shape fires -- `comp` never completes naturally, no arm
ever produces a `Done@` terminal, and no captured `ret` (§6.3.2) is
invoked from outside the handler -- the Promise remains pending. This
is a well-formed state: a captured `ret` may still be invoked from a
later dynamic context to drive `comp` toward completion, at which
point the Promise resolves.

**Mid-body arm terminals discarded.** Except when an arm's terminal
is `Done@`-shaped, arm terminals contribute nothing to the Promise.
Whether an arm invokes `ret` at its terminal position, invokes `ret`
early and then runs to some other final expression, or never invokes
`ret` at all, the arm's terminal value is discarded. The state
channel between arm and callee is the payload / `ret`-argument pair
(§6.3.2), not the arm terminal.

**Either branch.** Both termination shapes resolve the `Right`
branch. Natural completion is not a failure, and a `Done@` arm
terminal is a deliberate early exit rather than an error; neither
carries failure semantics for the handler to signal. A `Left`
appears in the resolved payload only when `comp` returns one as an
ordinary value, in which case it arrives as `Promise{Right{Left{..}}}`
-- the inner `Left` is comp's data, not the handler's outcome, and it
does not short-circuit downstream composition (§6.8).

**Type.** The handler expression's static type is `Promise{T}`, where
`T` is the union of `comp`'s declared return type and the `Done@`
payload types of any `Done@`-producing arms in the handler body. Per
§6.8's invariant-branch note, `Promise{T}` observes as a single layer
-- the `Right` discriminator is not a separate unwrap step.

**Example.**

```java
def result: Effect.User.Ask ~<* (eff:: greetUser(), ret) {
    ?(eff){
        [?as Effect.User.Ask]: ret("Kyle");
    };
};
// Promise{Right{..greetUser()'s return value..}}

result ~map (v) {
    log(`"greeted: `v`");
};
```

`greetUser()` performs `Effect.User.Ask` some number of times; each
dispatch fires the arm, which invokes `ret("Kyle")` to resume. When
`greetUser` naturally returns, the `~<*` expression's Promise
resolves with that return value. Because the whole scope completes
synchronously here, the promise is already resolved when `~map` is
composed against it and the block fires immediately -- but the
composition is written the same way regardless.

### §6.4 The `Done@` Sentinel

`Done@` is a tagged sentinel value used to signal early termination of a
suspending scope. It is Foi's universal early-exit signal across loop-like
and handler-like constructs: comprehensions (§7) and effect-handler arms
(§6.3) recognize a `Done@`-shaped return from their per-iteration or
per-arm body as a request to end the scope before natural completion.

**Shape.** `Done@` is constructed via the `@` marker-application form
with a payload:

```java
Done@ empty;                    // no meaningful payload
Done@ 1;                        // integer payload
Done@ < result: 42 >;           // record payload
```

The payload is a value of any shape. `Done@` is a first-class value:
it may be stored, passed, returned, and inspected structurally like
any other tagged value.

**Not intrinsically an effect.** `Done@` is an ordinary tagged value;
its early-exit behavior arises entirely at consumer sites that inspect
for it. In ordinary positions -- function returns, variable bindings,
expression slots not owned by a comprehension or handler -- `Done@` is
treated as any other value with no special interpretation.

Three classes of position inspect a return value for `Done@`:

- **Comprehension iteration return** (§7): `~each`, `~map`, `~fold`,
  `~foldR`, and other comprehension forms treat a per-iteration `Done@`
  return as a request to terminate after the current iteration. The
  payload's interpretation is comprehension-specific: `~each` discards
  it; `~map` treats it as the terminal element; `~fold` treats it as the
  terminal accumulator. Full per-primitive semantics are specified in §7.

- **Handler arm terminal** (§6.3): a `~<*` arm may evaluate to
  `Done@` as its terminal expression; the arm does not invoke `ret`
  at that path, the handler scope terminates, and the handler
  expression's Promise (§6.3.3) resolves with the `Done@` payload.
  See §6.4.1.

- **Wrapped computation natural return** (§6.3.3): a `Done@` returned
  by `comp` at natural completion is `comp`'s natural return value
  like any other; the handler expression's Promise resolves with the
  `Done@` value itself. No special interpretation applies at this
  position -- the sentinel behavior is at consumer sites, not at
  `comp`'s return, so no unwrapping to the payload occurs.

#### §6.4.1 `Done@` in a `~<*` Arm

An arm whose terminal expression is a `Done@`-shaped value terminates
the handler scope: the arm does not invoke `ret` on the current
dispatch, and the scope-termination path fires with the `Done@`
payload as the resolved value of the handler expression's Promise
(§6.3.3).

```java
Effect.User.<Ask, Cancel> ~<* (eff:: producer(), ret) {
    ?(eff){
        [?as Effect.User.Cancel]: Done@ empty;
        [?as Effect.User.Ask]:    ret(getResponse(#.value));
    };
};
```

If `producer()` performs `Effect.User.Cancel`, that arm's terminal is
`Done@ empty`; the arm does not invoke `ret`, the handler scope
terminates, and the `~<*` expression's Promise resolves with `empty`
-- the `Done@` payload, not the `Done@` wrapper. The arm terminal is
a position that inspects for `Done@` (§6.4), so the unwrap happens
here; contrast §6.3.3's natural-completion path, where a `Done@`
returned by `comp` passes through intact.

If `producer()` performs `Effect.User.Ask`, the arm invokes
`ret(getResponse(#.value))` to resume `producer`; that resume drives
`producer()` forward until it eventually completes naturally or hits
another perform. The arm's terminal in the Ask case is `ret(...)`'s
return value, which is fire-and-forget (§6.3.2) and discarded.

The perform site inside `comp` that triggered the `Effect.User.Cancel`
dispatch does not receive a resume-value; `producer()` is abandoned
at that perform point. This is intentional: `Done@` in the arm
terminal is the mechanism by which a handler signals: 'stop resuming
this computation, and take my payload as the scope's result.'

**Discard of the paused computation.** When `Done@` terminates the
handler scope, `comp`'s suspended state at the triggering perform
site -- frames, environments, closures -- is released by the handler
machinery. Any `ret` values captured under this scope (§6.3.2) become
effectively spent: subsequent invocation returns `Left@ "Continuation
Unavailable"` and does not resume `comp`. The runtime reclaims the
suspended state once no external reference holds it. `Done@`
termination is complete: `comp` is not resumable through any
subsequent action.

**NOTE:** Runner layers built on top of `~<*` (§6.6, §6.12) may
inspect the `Done@` payload for their own value-shaping (e.g., a
`Gen.runner@` may treat `Done@ payload` from an arm as the terminal
value of its stepper surface). Such inspection reads the handler
expression's Promise's resolved value under natural pass-through
semantic; no runner-layer machinery is required to extract the
payload from a special exit path.

### §6.5 Iterators

An **iterator** is a stateful protocol for one-at-a-time value delivery. Unlike `Promise` (single resolution), `Channel` (single-consumer handoff), or the streams (§6.10, §6.11, subscribed sources), an iterator delivers values by direct request from its holder: each step advances the source by one position and returns the next value, or a sticky terminal marker when the source has no more to give.

Foi provides two peer iterator namespaces:

- **`Iter`** (§6.5.1) delivers step results as bare `Right@` / `Left@` values synchronously. Its source is a Tuple or another Iter; execution is sync-honest.
- **`IterP`** (§6.5.4) delivers step results as `Promise{Right@ ..}` / `Promise{Left@ ..}` values. Its source is a `List{Promise}` or another IterP; the Promise envelope carries any transport-layer asynchrony that arises when generator bodies (§6.6) perform effects whose handlers introduce it.

The two are distinct types; neither is a subtype or specialization of the other. `IterP.of@` (§6.5.4) lifts an `Iter` to an `IterP`; there is no reverse lift.

**NOTE:** Neither `Iter` nor `IterP` is monadic. Neither `~<` nor `~map` is defined on either; both participate in the composition axis (§6 opener) only via `~<<` as an iterating outer -- consumer-driven walking to exhaustion, per §6.5.3 and §6.5.6 respectively. `PullStream` (§6.11) is the observable-monad type for consumer-timed reads from an *external* producer via a stdlib-mediated buffer; it is not a wrapper over either iterator type and cannot be constructed from an iterator source. Consumers wanting monadic-style transformation over a known-source iterator compose the per-value work inside a `~<<` block body; consumers needing a monadic observable over decoupled read/write heads use `PullStream` directly.

**NOTE:** An iterator is produced by two paths:

- **Explicit construction** via `Iter@` (§6.5.1) or `IterP@` (§6.5.4) over a compatible source shape, or via `IterP.of@` (§6.5.4) as a lift from an existing `Iter`.
- **Generator invocation** (§6.6), which produces an `IterP` driven by the generator body via the stdlib runner `Gen.runner@` (§6.6.7).

Both paths share the base stepping interface -- unary `%` for advance, sticky terminal on exhaustion (§6.5.2 for `Iter`, §6.5.5 for `IterP`). Generator-produced iterators additionally support the binary-`%` resume-value channel per §6.6.4.

The userland surface is:

- `Iter@ source` / `IterP@ source`: constructors (§6.5.1 / §6.5.4). Return an `Iter` or `IterP` respectively.
- `IterP.of@ iter`: natural-transformation lift from `Iter` to `IterP` (§6.5.4).
- Unary `%`: `it%` steps the iterator once, returning `Right@ payload` mid-stream or a sticky `Left@ terminal` once the source has been exhausted -- bare envelopes per §6.5.2 for `Iter`, Promise-wrapped envelopes per §6.5.5 for `IterP`.
- Binary `%`: `it% v` steps a generator-produced iterator delivering `v` as the resume-value for a waiting `<::` perform site (§6.6.4). Ill-formed on iterators constructed via `Iter@` or `IterP@`.
- `~<<`: do-comprehension drainage form; consumes the iterator to its terminal (§6.5.3 for `Iter`, §6.5.6 for `IterP`, with distinct terminal-shape contracts per each).

**NOTE:** Neither `Iter` nor `IterP` has an explicit close operation or closed-state observation. An iterator is either mid-stream (`Right@` on step) or terminal (`Left@` on step, sticky); consumers detect terminal state via return-value pattern-match. Generator iterators whose sources never complete are abandoned by dropping references, or by the author passing in a value via `%` to signal the generator to stop itself.

#### §6.5.1 Iter Construction

The `Iter@` constructor takes one argument and produces an Iter over the supplied source. Two source shapes are accepted:

**Tuple source:**

```java
def it: Iter@ < 1, 2, 3 >;
```

The tuple's elements become the value sequence, delivered in tuple order. A range literal, which evaluates to a Tuple, works here as well:

```java
def it: Iter@ (1..5);
```

**Iter source (identity):**

```java
def existing: Iter@ < 10, 20, 30 >;
def same: Iter@ existing;    // same is existing, no new instance
```

`Iter@` applied to an existing Iter returns *the same instance* -- no new state, no allocation, no wrapper. This form exists to let generic consumers normalize any iterable input to Iter without penalizing callers who already hold an Iter.

Any argument other than a Tuple or Iter is ill-formed at the userland construction surface.

Two Iters constructed from the same source expression have independent state:

```java
def nums: < 1, 2, 3 >;
def a: Iter@ nums;
def b: Iter@ nums;

a%;    // Right{1}
a%;    // Right{2}
b%;    // Right{1}     -- independent
```

The identity form is the sole exception: passing an existing Iter to `Iter@` yields the same shared-state instance.

**Sentinel field.** Every `Iter@` construction mints a unique opaque runtime value at construction and writes it into Iter's per-instance slot (§6.1.5); the sentinel surfaces at userland via the instance's `.sentinel` projection. The value is unforgeable at userland (no primitive constructs it); it is comparable via `?=` identity equality but not otherwise inspectable. The identity form preserves the source Iter's slot contents wholesale, so the same instance projects the same sentinel. The sentinel participates in the sticky terminal envelope shape (§6.5.2) and in drainage discrimination (§6.5.3).

#### §6.5.2 Stepping

Unary `it%` steps the iterator once, returning one of two shapes:

- `Right@ payload`: the next value delivered from the source.
- `Left@ envelope`: the source has been exhausted; `envelope` is the sticky terminal record.

Once the terminal is reached, it is **sticky**: subsequent `it%` invocations continue to return the same `Left@ envelope` value.

**Sticky envelope shape.** The terminal envelope is a record:

```java
< sentinel: iter.sentinel, terminal: terminalPayload >
```

- `sentinel` is the iter handle's opaque runtime-minted value (§6.5.1); its presence and identity are how drainage (§6.5.3) recognizes the exhaustion terminal.
- `terminal` is the terminal payload. For Tuple-source Iters it is `empty` (no user data at exhaustion).

```java
def it: Iter@ < 1, 2 >;
it%;    // Right{1}
it%;    // Right{2}
it%;    // Left{<sentinel: .., terminal: empty>}
it%;    // Left{<sentinel: .., terminal: empty>}     -- sticky
```

Consumers detecting terminal state pattern-match on `Left`; the terminal payload is `stepResult.value.terminal`. The `.sentinel` field is comparable to `iter.sentinel` via `?=` identity but has no other semantic surface at userland.

Binary `it% v` steps the iterator delivering `v` as the value to resolve a waiting `<::` perform site inside the iterator's execution. This form is defined only on generator-produced Iters (§6.6.4); applying binary `%` to a Tuple-source or Iter-identity Iter is ill-formed:

```java
def it: Iter@ < 1, 2, 3 >;
it% 42;    // ill-formed
```

Ill-formedness is diagnosed statically at the call site when the Iter's construction path is known at compile time; otherwise it is a runtime error on `%`-hook dispatch (§6.2). Non-generator Iters have no perform sites to resolve, and silently discarding the value would mask consumer bugs.

#### §6.5.3 Draining Via `~<<`

An Iter can be eagerly consumed via the `~<<` do-comprehension form, with `Iter` as the type-LHS and the specific iterator supplied via the block-defs clause:

```java
def it: Iter@ < 10, 20, 30 >;

def res: Iter ~<< (v:: it) {
    log(`"v: `v`");
};
// v: 10
// v: 20
// v: 30

res;    // Right{empty}
```

The `::`-init on the block-defs entry supplies the iterator source; `v` binds per-iteration to each `Right@ payload` step's payload. The comprehension drives the iterator to its terminal by repeated unary stepping; the loop terminates when a step returns `Left@` (the sticky terminal envelope, §6.5.2).

**Drainage terminal shapes.**

- **Natural completion.** When the step returns the sticky terminal envelope, drainage resolves `Right@ terminal` where `terminal` is the envelope's `.terminal` payload. For Tuple-source Iters this is `Right@ empty`.
- **`Done@` early-exit.** A block-body value of `Done@ payload` terminates drainage early per §7.9 and resolves `Left@ payload` (with §7.9's empty-elision applying at accumulator-carrying comprehensions; Iter has no accumulator, so `Done@ empty` resolves `Left@ empty`).

The Right/Left split at drainage matches the composition semantic: natural completion is the success shape (Right); early exit is the interruption shape (Left). Downstream `~<` / `~map` chains short-circuit on Left; `~cata` (§7.7) forks on both branches.

Under the composition axis (§6 opener), `Iter` sits on `~<<` as an iterating outer: the consumer drives, and termination is either the iterator's own exhaustion signal or a block-body `Done@`. `Iter` is not admitted on `~<*`; it is not an emission source.

**Sentinel discrimination.** The sticky terminal envelope is recognizable by its `.sentinel` field matching `iter.sentinel`. Since Iter's step contract forbids a Left step envelope mid-stream (elements come out wrapped in `Right@` verbatim), the drainage hook can trust that any Left step is the exhaustion terminal. The sentinel field remains structurally useful for `IterP.of@` re-minting (§6.5.4) and for future extensions.

**Hook body.** The `Iter~<<` hook is stdlib self-hosted over `Effect.Host.Do ~<*` (§6.3, §3.10.9.4 OVERRIDE route). A discovery scope catches the first `Effect.Host.Do.Bind` perform's payload -- the source Iter -- via `Done@ #.value`; a sync tail-recursive `drainStep` then steps the iterator, running the block body per `Right@` step under a fresh `Effect.Host.Do ~<*` scope over `comp()` that ret-substitutes the stepped payload. On `Left@` step (sticky terminal), `drainStep` extracts the envelope's `.terminal` and returns `Right@ terminal`. On block-body `Done@ payload` (§7.9), `drainStep` returns `Left@ payload`.

```java
defn Iter~<<(comp, typ) {
    ^?(typ){
        [< Iter >]: iterBindImpl(comp);
        : Left@ "Invalid LHS"
    };
};

defn iterBindImpl(comp) {
    def iter: empty;

    // synchronously extract :: iterator binding
    Effect.Host.Do ~<* (eff:: comp(), ret) {
        ?(eff){
            [?as Effect.Host.Do.Bind]: {
                iter := #.value;
                Done@ empty
            };
            : empty
        };
    };

    ^drainStep();

    defn drainStep() {
        def stepResult: iter%;
        ^?(stepResult){
            [?as Left]: Right@ stepResult.value.terminal;
            [?as Right]: {
                def bodyTerminal: empty;
                Effect.Host.Do ~<* (eff:: comp(), ret) {
                    ?(eff){
                        [?as Effect.Host.Do.Bind]: {
                            ret(stepResult.value);
                            empty
                        };
                        [?as Effect.Host.Do.Map]: {
                            bodyTerminal := #.value;
                            Done@ empty
                        };
                    };
                };
                ?(bodyTerminal){
                    [?as Done]: Left@ #.value;
                    : drainStep()
                }
            };
        };
    };
};
```

This hook body's `?(typ)` dispatch admits only the plain single-source Iter LHS; multi-source cartesian on stateful iterators is out of scope for the current design.

#### §6.5.4 IterP Construction

`IterP` is a peer namespace to `Iter` (§6.5.1), whose step-result envelope is a Promise (§6.8). Where an `Iter` step yields a bare `Right@`/`Left@` synchronously, an IterP step yields a `Promise{Right@ ..}` mid-stream and a `Promise{Left@ ..}` at terminal. The two are distinct types; neither is a specialization of the other. IterP exists because generator bodies performing effects whose handlers introduce asynchrony (§6.6) cannot honor `Iter`'s sync-honest step contract; the Promise envelope carries that asynchrony as transport machinery, distinct from any Promise the user may hold as data (§6.5.5).

The `IterP@` constructor takes one argument and produces an IterP over the supplied source. Two source shapes are accepted:

**`List{Promise}` source:**

```java
def it: IterP@ <
    Promise.honor@ 1,
    Promise.honor@ 2,
    Promise.honor@ 3
>;
```

The list's elements become the sequence of Promise step-envelopes, delivered in list order. Elementwise Promise-type conformance is checked eagerly at construction: when the source's element type is statically known to be `Promise`, the check is compile-time; otherwise it is a runtime check at construction. A non-Promise element rejects the entire construction, before any stepping; there is no partial iteration.

Because delivery is verbatim (§6.5.5), a `Promise.renege@ ..` element in the source is delivered mid-stream as an ordinary Left-envelope step-result; envelope shape does not signal iterator termination. Only source exhaustion produces the sticky terminal, per §6.5.5.

**IterP source (identity):**

```java
def existing: IterP@ < Promise.honor@ 10, Promise.honor@ 20 >;
def same: IterP@ existing;    // same is existing, no new instance
```

`IterP@` applied to an existing IterP returns *the same instance* -- no new state, no allocation, no wrapper. This form exists so generic consumers can normalize any IterP input without penalizing callers who already hold one, mirroring `Iter@`'s identity form (§6.5.1).

Any argument other than a `List{Promise}` or an existing IterP is ill-formed at the userland construction surface. In particular, an `Iter` instance does not implicitly cross into IterP; use `IterP.of@` for that lift.

**Lifting an Iter to an IterP:**

```java
def sync: Iter@ < 1, 2, 3 >;
def wrapped: IterP.of@ sync;
```

`IterP.of@` takes an `Iter` argument and produces an IterP whose steps are the source Iter's steps wrapped in Promise envelopes. The source step's `Right`/`Left` branch becomes the transport Promise's own branch (§6.5.5), so the lift adds exactly one layer and no more. A `Right@ v` step becomes `Promise@ (Right@ v)`. A `Left@ <sentinel: srcSentinel, terminal: T>` sticky step becomes `Promise@ (Left@ <sentinel: liftedSentinel, terminal: T>)` -- the lifted IterP mints its own sentinel at construction, and re-envelopes the source's terminal payload under the lifted sentinel. Consumers holding the lifted IterP discriminate against `liftedIterP.sentinel`, not the source Iter's sentinel; the lift is the natural transformation `Iter -> IterP`, and the source Iter is walked lazily by the lifted IterP's steps, not eagerly consumed at lift time.

`IterP.of@` does not accept IterP input. Callers wanting to normalize a source of unknown iterator-shape use `IterP@` for the IterP-identity form and `IterP.of@` for the Iter lift; the two constructors together cover the normalization surface.

**NOTE:** `Iter@ < p1, p2, .. >` where the elements are Promises delivers those Promises verbatim as ordinary step-payloads; Promise there is opaque cargo under `Iter`'s polymorphic element type, not a mechanism the `Iter` interprets. `IterP@` is the constructor that treats Promise as the transport envelope for step-results. The two forms are structurally distinct: `Iter@ List{Promise}` produces `Either{Promise{v}}` step-shapes; `IterP@ List{Promise}` produces `Promise{Either{v}}` step-shapes.

**NOTE:** Stdlib-internal `IterP` construction paths -- specifically the callable source used by `Gen.runner@` at §6.6.7 -- extend the accepted source shapes for compiler-emitted runners. The callable-source path is not user-authorable and does not surface in user code; consumers of an `IterP` constructed this way still interact with it exclusively through the userland surface (§6.5.5, §6.5.6).

Two `IterP`s constructed from the same source expression have independent state:

```java
def ps: < Promise.honor@ 1, Promise.honor@ 2, Promise.honor@ 3 >;
def a: IterP@ ps;
def b: IterP@ ps;

a%;    // Promise{Right{1}}
a%;    // Promise{Right{2}}
b%;    // Promise{Right{1}}     -- independent
```

The identity form is the sole exception: passing an existing `IterP` to `IterP@` yields the same shared-state instance.

**Sentinel field.** Every `IterP@` construction mints a unique opaque runtime value at construction and writes it into IterP's per-instance slot (§6.1.5); the sentinel surfaces at userland via the instance's `.sentinel` projection. The value is unforgeable at userland (no primitive constructs it); it is comparable via `?=` identity equality but not otherwise inspectable. The identity form preserves the source IterP's slot contents wholesale, so the same instance projects the same sentinel. The sentinel participates in the sticky terminal envelope shape (§6.5.5) and in drainage discrimination (§6.5.6). Gen-IterP construction via `Gen.runner@` (§6.6.7) mints its sentinel by the same mechanism, writing it into the runner-produced IterP's slot.

#### §6.5.5 Stepping

Unary `it%` steps the IterP once, returning a Promise resolving to one of two shapes:

- `Promise{Right@ payload}`: the next value delivered from the source, mid-stream.
- `Promise{Left@ envelope}`: the source has been exhausted; `envelope` is the sticky terminal record.

**Verbatim delivery.** The stepping mechanism inspects no envelope shape at the source; whatever occupies the current source position is delivered as-is, wrapped only by the outer Promise transport (§6.5.4). A `Promise.renege@ ..` element in the source, or a Left step-envelope produced by a callable source, is delivered mid-stream as `Promise{Left@ payload}` -- envelope shape does not signal iterator termination.

```java
def it: IterP@ <
    Promise.honor@ 1,
    Promise.renege@ 42,
    Promise.honor@ 10
>;

it%;    // Promise{Right{1}}
it%;    // Promise{Left{42}}   -- verbatim cargo; iterator still active
it%;    // Promise{Right{10}}
```

The active/exhausted distinction lives in IterP's per-instance slot (§6.1.5), not in envelope shape. Iterator termination is signaled only by the exhaustion source -- for a `List{Promise}` source, the list's own end; for a generator source, the body's completion (§6.6).

**Sticky terminal.** Once the source is exhausted, the IterP writes the sticky terminal envelope into its slot (§6.1.5); subsequent `it%` invocations read that same envelope back and resolve to `Left@ envelope` where `envelope` is a record:

```java
< sentinel: iter.sentinel, terminal: terminalPayload >
```

- `sentinel` is the iter handle's opaque runtime-minted value (§6.5.4); its presence and identity are how drainage (§6.5.6) discriminates exhaustion from mid-stream cargo Left.
- `terminal` is the terminal payload. For `List{Promise}` sources it is `empty`; for generator sources it is the generator's return value (§6.6.3).

```java
def it: IterP@ < Promise.honor@ 1, Promise.honor@ 2 >;

it%;    // Promise{Right{1}}
it%;    // Promise{Right{2}}
it%;    // Promise{Left{<sentinel: .., terminal: empty>}}
it%;    // Promise{Left{<sentinel: .., terminal: empty>}}     -- sticky
```

**Manual discrimination.** A consumer inspecting raw step envelopes distinguishes exhaustion from cargo Left by comparing `env.value.sentinel ?= it.sentinel`: a match identifies the sticky exhaustion envelope minted for this IterP; a mismatch (including missing `.sentinel` field on a non-record cargo payload, which yields `empty` per §2.12.1) identifies mid-stream cargo. The natural consumption path for IterP is composition via `IterP ~<<` (§6.5.6), which does this discrimination internally and returns Right for natural completion and Left for cargo or block-body `Done@`.

**Forgery immunity.** Because the sentinel is minted per instance at construction, cross-IterP smuggling is defeated by construction: itA's sentinel `?=`-fails against itB's. Retroactive injection into an IterP's own source is impossible because the source is captured at construction. Yielded values from a generator body via `<::` are wrapped by the runner's Yield arm into `Right@ ..` envelopes, and `^`-returns are wrapped by the Return arm into the iter's own sentinel envelope; neither path exposes the sentinel field to user code for tampering.

Binary `it% v` steps a generator-produced IterP delivering `v` as the value to resolve a waiting `<::` perform site inside the generator body. This form is defined only on generator-produced IterPs (§6.6.4); applying binary `%` to a `List{Promise}`-source or IterP-identity IterP is ill-formed:

```java
def it: IterP@ < Promise.honor@ 1, Promise.honor@ 2 >;
it% 42;    // ill-formed
```

Ill-formedness is diagnosed statically at the call site when the IterP's construction path is known at compile time; otherwise it is a runtime error on `%`-hook dispatch (§6.2). Non-generator IterPs have no perform sites to resolve, and silently discarding the value would mask consumer bugs.

#### §6.5.6 Draining Via `~<<`

An IterP can be drained via the `~<<` do-comprehension form, with `IterP` as the type-LHS and the specific IterP supplied via the block-defs clause:

```java
def it: IterP@ < Promise.honor@ 10, Promise.honor@ 20, Promise.honor@ 30 >;

def res: IterP ~<< (v:: it) {
    log(`"v: `v`");
};
// v: 10
// v: 20
// v: 30

res;    // Promise{Right{empty}}
```

The `::`-init on the block-defs entry supplies the IterP source; `v` binds per-iteration to each mid-stream `Right@ payload` step's payload. Drainage drives the IterP by repeated unary stepping with per-step await; the loop terminates via one of three exit shapes.

**Drainage terminal shapes.**

- **Natural completion.** When a step returns the sticky terminal envelope -- detected by `env.value.sentinel ?= iter.sentinel` -- drainage resolves `Promise{Right@ terminal}` where `terminal` is the envelope's `.terminal` payload. For `List{Promise}`-source IterPs this is `Promise{Right{empty}}`; for generator-source IterPs this is `Promise{Right{returnValue}}` where `returnValue` is the generator's own return value.
- **Mid-stream cargo Left.** A `Promise{Left@ envValue}` step whose `envValue` does not match the sentinel is treated as cargo; drainage exits with `Promise{Left@ envValue}`, passing the cargo payload through as the drainage terminal.
- **`Done@` early-exit.** A block-body value of `Done@ payload` terminates drainage early per §7.9 and resolves `Promise{Left@ payload}`.

The Right/Left split at drainage matches the composition semantic: natural completion is the success shape (Right); cargo short-circuit and explicit block-body early-exit are both interruption shapes (Left). Downstream `~<` / `~map` chains short-circuit on Left; `~cata` (§7.7) forks on both branches. Consumers wanting to distinguish "cargo Left mid-stream" from "block-body Done@ early-exit" inspect payload shape downstream.

```java
def it: IterP@ <
    Promise.honor@ 1,
    Promise.renege@ "boom",
    Promise.honor@ 3
>;

def res: IterP ~<< (v:: it) {
    log(`"v: `v`");
};
// v: 1

res;    // Promise{Left{"boom"}}     -- cargo short-circuit at source[1]
```

```java
def it: IterP@ <
    Promise.honor@ 1,
    Promise.honor@ 2,
    Promise.honor@ 3
>;

def res: IterP ~<< (v:: it) {
    ?[v ?>= 2]: Done@ v;
};
// (no logs; body's terminal fires Done@ at v=2)

res;    // Promise{Left{2}}     -- Done@ early-exit
```

Under the composition axis (§6 opener), `IterP` sits on `~<<` as an iterating outer: the consumer drives, and termination is either the iterator's own exhaustion signal, a cargo short-circuit, or a block-body `Done@`. `IterP` is not admitted on `~<*`; it is not an emission source.

**Hook body.** The `IterP~<<` hook is stdlib self-hosted over `Effect.Host.Do ~<*` (§6.3, §3.10.9.4 OVERRIDE route). A discovery scope catches the first `Effect.Host.Do.Bind` perform's payload -- the source IterP -- via `Done@ #.value`; a Promise-threaded tail-recursive `drainStep` then steps the iterator, chains via `~<` to await the step envelope, and dispatches on the envelope shape. On `Right`, the block body runs under a fresh `Effect.Host.Do ~<*` scope over `comp()` that ret-substitutes the step payload; the arm's block-body terminal is captured via side effect into `bodyTerminal`, then inspected for `Done@`-shape (early-exit, resolving `Promise.renege@ #.value`) or plain (recurse). On `Left`, the envelope's payload is destructured; if `.sentinel` matches `iter.sentinel`, drainage resolves `Promise.honor@ terminal` (natural completion); otherwise the raw envelope value is passed through as `Promise.renege@ env.value` (cargo short-circuit).

```java
defn IterP~<<(comp, typ) {
    ^?(typ){
        [< IterP >]: iterPBindImpl(comp);
        : Left@ "Invalid LHS"
    };
};

defn iterPBindImpl(comp) {
    def iter: empty;

    // synchronously extract :: iterator binding
    Effect.Host.Do ~<* (eff:: comp(), ret) {
        ?(eff){
            [?as Effect.Host.Do.Bind]: {
                iter := #.value;
                Done@ empty
            };
            : empty
        };
    };

    ^drainStep();

    defn drainStep() {
        ^(iter% empty) ~< (env) {
            ?(env){
                [?as Right]: {
                    def bodyTerminal: empty;
                    Effect.Host.Do ~<* (eff:: comp(), ret) {
                        ?(eff){
                            [?as Effect.Host.Do.Bind]: {
                                ret(env.value);
                                empty
                            };
                            [?as Effect.Host.Do.Map]: {
                                bodyTerminal := #.value;
                                Done@ empty
                            };
                        };
                    };
                    ?(bodyTerminal){
                        [?as Done]: Promise.renege@ #.value;
                        : drainStep()
                    }
                };
                [?as Left]: {
                    def <:sentinel :? empty, :terminal :? empty>: env.value;
                    ?{
                        [sentinel ?= iter.sentinel]: Promise.honor@ terminal;
                        : Promise.renege@ env.value
                    }
                }
            }
        };
    };
};
```

This hook body's `?(typ)` dispatch admits only the plain single-source IterP LHS; multi-source composition on IterP is out of scope for the current design.

### §6.6 Generators

A **generator** is a function whose execution can be suspended mid-body; resumption is controlled **externally** on demand, via an attached iterator (`IterP` instance, §6.5.4).

Foi generators are the sole userland-observable pause point (§6 opener):
each suspension is triggered by an `Effect.Host.Gen.Yield` perform (via the
`<::` sugar of §6.2.2), and each resumption is triggered by an explicit
step on the generator's attached `IterP` instance (§6.6.2).

An `IterP` instance is advanced manually with the `%` effector operator,
or may be consumed fully to its terminal via the `IterP ~<<` do-comprehension
(§6.5.6).

**NOTE:** The `IterP` interface (§6.5.4) is stdlib-hosted, and generator
runtime support is stdlib code (`Gen.runner@`, §6.6.7) built on
`Effect.Host.Gen ~<*` (§6.3). The only compiler privilege the `Gen.` prefix
carries is (a) implicit wrapping of the function body in the runner
invocation, (b) rewriting `<::` to `Effect.Host.Gen.Yield%`, and (c)
compile-time synthesis of `Effect.Host.Gen.Return%` performs at tail
positions (§6.6.1). Everything else is self-hosted over the general
effect substrate.

#### §6.6.1 The `Gen.` Prefix

Generators must be declared with a `Gen.`-prefixed type (via `deft`),
attached to a function with `:as`:

```java
deft Gen.Numbers(int, int) ^IterP;

defn numbers(start, end) :as Gen.Numbers {
    start..end ~each (v) {
        <:: v;
    };
    ^"Complete";
};
```

The `Gen.` prefix on a `deft` declaration is compiler-privileged. It
carries three properties:

- **Runner wrapping.** Every function `:as` a `Gen.`-prefixed type has
  its body implicitly wrapped in a stdlib `Gen.runner@` invocation
  (§6.6.7). Within the wrapped body, `<::` sugar sites (§6.2.2) surface
  as `Effect.Host.Gen.Yield%` performs, and tail-position `^expr` compiles
  to `Effect.Host.Gen.Return% expr`; fall-through paths (reaching the
  natural end of the body without an explicit `^`) synthesize
  `Effect.Host.Gen.Return% empty`. The runner produces the `IterP` returned
  from invocation; no user code runs inside the function body at the
  call position -- only the IterP is produced.
- **Compiler-managed Gen effects.** `Effect.Host.Gen.*` is a
  compiler-privileged partition (§6.1.4); the runner's internal
  `Effect.Host.Gen ~<*` scope catches both `Yield` and `Return` performs
  before they escape the generator's own type surface. User source
  cannot declare `Effect.Host.Gen` in `:Effects(...)` and cannot handle it
  externally. Non-`Effect.Host.Gen` effects performed inside the body
  propagate through per §6.6.6.
- **IterP return interface.** The declared return type is `IterP`, and
  invocation evaluates to an `IterP` instance.

The `Gen.` prefix is structurally parallel to the `Effect.` prefix on
effect-kind declarations (§6.1) -- both mark compiler-privileged
type-kinds whose declaration form induces materially different
compilation of `defn` bodies annotated with them.

#### §6.6.2 Iterator Instance For Generator

Invoking the generator function produces a new `IterP` instance (§6.5.4)
whose body has not yet started:

```java
def it: numbers(2, 5);
```

Multiple `IterP` instances attached to the same generator may be started and advanced concurrently.

#### §6.6.3 IterP Stepping, Terminal Semantics

Unary `it%` steps the iterator once, running the generator body up to
the next `<::` perform-site or to natural completion. As the
generator's iterator is an `IterP` (§6.5.4), each step evaluates to a
`Promise` (§6.8) that resolves to `Right@ payload` mid-stream or to
`Left@ terminal` at completion, per the IterP step contract of §6.5.5.
Under Foi's synchronous execution model, generator progress that
completes without further external coordination resolves the Promise
immediately; consumers may inspect via `.resolved()` (§6.8) or compose
via `~<` / `~map` / `%` per Promise.

Each mid-stream step resolves to `Right@ payload`, where `payload` is
the value passed to `<::`:

```java
def it: numbers(2, 5);
it%;    // Promise{Right{2}}
it%;    // Promise{Right{3}}
it%;    // Promise{Right{4}}
it%;    // Promise{Right{5}}
```

When the generator body completes -- either by falling off the end or
reaching an explicit `^` return -- the IterP transitions to its
**terminal** state. The generator's final return value (if any) is
wrapped in the sticky terminal envelope per §6.5.5, with `.terminal`
carrying the return value:

```java
it%;    // Promise{Left{<sentinel: .., terminal: "Complete">}}
it%;    // Promise{Left{<sentinel: .., terminal: "Complete">}}
```

The `.sentinel` field carries the iter handle's opaque runtime-minted
value (§6.5.4), used by drainage (§6.5.6) to discriminate exhaustion
from mid-stream cargo Left. If the body has no explicit `^`, `.terminal`
is `empty`.

The terminal state is **sticky** per §6.5.5: subsequent `it%`
invocations return the same terminal Promise. Terminal IterPs are not
one-shot; they idempotently report their terminal result on every
inspection.

#### §6.6.4 Resume-Value via `%`

The binary form `it% v` steps the iterator and delivers `v` as the value
to resolve the waiting `<::` expression (if any) inside the generator
body. The step evaluates to a `Promise` per §6.6.3. This enables two-way
value flow between the iterator caller and the generator body:

```java
deft Gen.Adder(int) ^IterP;

defn adder(sum:? 0) :as Gen.Adder {
    ?[sum ?< 100] ~each {
        sum := sum + (<:: sum);
    };
    ^sum;
};

def it: adder(13);
it%;      // Promise{Right{13}}
it% 12;   // Promise{Right{25}}
it% 50;   // Promise{Right{75}}
it% 39;   // Promise{Left{<sentinel: .., terminal: 114>}}
it%;      // Promise{Left{<sentinel: .., terminal: 114>}}
```

Each argument passed to `it%` resolves the value of a waiting `<:: ..`
expression inside the generator body. But if no `<::` is presently
waiting, the argument is ignored. This case arises at two boundaries:

- **Before the body starts.** The first `it%` invocation runs the
  generator body up to its first `<::` site; there is no prior `<::` for
  a resume value to resolve, so any argument passed to the first `it%`
  call is dropped.
- **After the iterator has reached its terminal state.** Once the body
  has completed, no further code runs; any argument passed to a
  post-terminal `it%` call is likewise dropped.

#### §6.6.5 Draining Via `~<<`

A finite generator can be eagerly drained via the `~<<` do-comprehension on `IterP` (§6.5.6). The generator invocation supplies the IterP source via the block-defs clause:

```java
def res: IterP ~<< (v:: numbers(1, 3)) {
    log(`"v: `v`");
};
// v: 1
// v: 2
// v: 3

res;      // Promise{Right{"Complete"}}
```

The `::`-init on the block-defs entry supplies the generator-produced IterP; `v` binds per-iteration to each mid-stream `Right@ payload` step's payload. On natural completion -- the body reaching its Return arm -- the generator's step-level sticky terminal is the sentinel envelope with `.terminal` carrying the return value per §6.6.3. Drainage discriminates the envelope via `env.value.sentinel ?= iter.sentinel` (§6.5.6), extracts `.terminal`, and resolves `Promise{Right@ returnValue}` (`Promise{Right{"Complete"}}` for `numbers`).

Consumers thread the return value through plain `~<` / `~map` on the Right shape. If `Done@` or mid-stream cargo terminated the drainage instead, the resulting `Promise{Left@ ..}` short-circuits per Promise's Either-aware composition (§6.8.3).

Full drainage semantics -- including mid-stream Left short-circuit and `Done@` early-exit -- are specified at §6.5.6.

#### §6.6.6 Non-`Gen` Effects In Generators

A `Gen.`-prefixed type has its `Effect.Host.Gen.Yield` / `Effect.Host.Gen.Return`
coverage handled internally by the runner (§6.6.1); user code cannot
declare `Effect.Host.Gen` in `:Effects(...)` since the partition is
compiler-privileged (§6.1.4). Non-`Effect.Host.Gen` effects, however, may be
declared explicitly and performed inside the generator body:

```java
deft Gen.LoggingNumbers(int, int) :Effects(Log) ^IterP;

defn loggingNumbers(start, end) :as Gen.LoggingNumbers {
    Effect.Log% `"starting range `start`..`end`";
    start..end ~each (v) {
        <:: v;
    };
    ^"Complete";
};
```

The internal `Effect.Host.Gen ~<*` scope installed by the runner is
prefix-matched to `Effect.Host.Gen` only (per §6.1.4 unified prefix rule and
§6.3.1 narrowing semantic; catches both `Effect.Host.Gen.Yield` and
`Effect.Host.Gen.Return`). Non-`Effect.Host.Gen` performs -- `Effect.Log` above,
or any other declared effect -- propagate past this internal scope per
§6.1.2 dynamic lookup, resolving at the nearest enclosing handler in
the caller's dynamic scope that catches the relevant effect kind.

If no such enclosing handler is reachable at the call site, the perform
is ill-formed per the function's effect signature (§6.13).

#### §6.6.7 The `Gen.runner@` Stdlib Runner

The runtime behavior of a `Gen.`-prefixed function invocation is
furnished by the stdlib runner `Gen.runner@`. The runner is not a
compiler-privileged construct; it is ordinary Foi source built over
`Effect.Host.Gen ~<*` (§6.3) and `IterP@` (§6.5.4). The compiler's role is
limited to the three-part `Gen.` prefix privilege of §6.6.1 -- implicit
wrap of the body in a runner invocation, `<::` sugar to
`Effect.Host.Gen.Yield%`, and tail-position `^expr` synthesis of
`Effect.Host.Gen.Return%`. Everything below is stdlib source.

At each generator invocation, the runner closes over the generator body
and returns an `IterP` (§6.5.4) whose `%`-hook drives one step of the
body per call. Internal state -- captured resumption `ret`, in-flight
step Promise, sticky terminal, entry-guard flag -- lives in the
runner's closure over `:over`-marked slots (§2.11). No such state is
observable at the userland surface.

**Runner shape:**

```java
defn Gen.runner@(body) {
    def insideStep: false;
    def latestRet: empty;
    def sticky: empty;
    def waitingPr: empty;
    def started: false;

    defn doStep1() :over(started, waitingPr, sticky, latestRet) {
        started := true;
        waitingPr := Promise.subj@;
        Effect.Host.Gen ~<* (eff:: body(), ret) {
            ?(eff){
                [?as Effect.Host.Gen.Yield]: {
                    latestRet := ret;
                    waitingPr% (Right@ #.value);
                    empty;
                };
                [?as Effect.Host.Gen.Return]: {
                    sticky := Promise.renege@ #.value;
                    ?{ [!waitingPr.resolved()]: waitingPr% (Left@ #.value); };
                    Done@ #.value;
                };
            };
        };
        ^waitingPr.pr;
    };

    defn doStepN(resumeVal) :over(waitingPr, latestRet) {
        waitingPr := Promise.subj@;
        latestRet(resumeVal);
        ^waitingPr.pr;
    };

    defn step(resumeVal) :over(insideStep, sticky, started, waitingPr) {
        ^?{
            [!empty sticky]:          sticky;
            [insideStep]:             Promise.renege@ "Previous Iterator Step Running";
            ![started]: {
                insideStep := true;
                def r: doStep1();
                insideStep := false;
                r
            };
            ![waitingPr.resolved()]:  Promise.renege@ "Previous Iterator Step Incomplete";
            : {
                insideStep := true;
                def r: doStepN(resumeVal);
                insideStep := false;
                r
            };
        };
    };

    ^IterP@ step;
};
```

**Single persistent handler scope.** The runner installs one
`Effect.Host.Gen ~<*` scope at Call 1, on first entry into `step()` via
`doStep1`. This scope persists across all subsequent step invocations;
it is not reopened per step. Its two arms cover the two compiler-emitted
Gen effect kinds (§6.1.4):

- **`Effect.Host.Gen.Yield` arm** -- captures the current `ret` into the
  runner's `latestRet` slot, resolves the pending `waitingPr` with
  `Right@ #.value`, and returns `empty` as the arm's discarded scope-
  value contribution. Because arm-without-`ret` does not terminate the
  scope per §6.3.2, the scope stays live for the next perform.
- **`Effect.Host.Gen.Return` arm** -- installs the sticky terminal Promise
  (`Promise.renege@ #.value`), resolves any outstanding `waitingPr` with
  `Left@ #.value`, and terminates the scope via `Done@` (§6.4). The
  runner's step-observation channel is `waitingPr`, not the handler
  expression's resolved value; the `Done@` payload is discarded per
  §6.4.1.

**Outstanding-`waitingPr` invariant at Return.** When the body reaches
`Effect.Host.Gen.Return`, one of two situations holds for the current
`waitingPr`: either the current step invoked `latestRet(resumeVal)` and
body ran directly to Return without a Yield in between, or an outer
non-`Effect.Host.Gen` handler suspended body and the resumption path flowed
straight to Return. In both cases `waitingPr` is unresolved at Return
arm entry. The `?{ [!waitingPr.resolved()]: waitingPr% (Left@ #.value); }`
guard resolves it with the terminal payload; without this, the pending
Promise the consumer holds would leak as an unresolvable subject.

**Step-entry guards.** The `step()` function diagnoses two distinct
consumer-misuse cases; the guarded match dispatches by state:

- **Re-entrancy** -- `insideStep=true` on entry. Any `it%` invocation
  that arrives while a prior `it%` on the same iterator is still on the
  sync stack. Covers three distinguishable code shapes with the same
  runtime signature: body calls its own iterator; an outer non-Gen
  handler's arm invokes `it%` synchronously during propagation; any
  downstream sync code reachable from an outer arm's execution invokes
  `it%`. One diagnostic:
  `Promise.renege@ "Previous Iterator Step Running"`.
- **Unawaited prior step** -- `!waitingPr.resolved()` past re-entrancy
  and past not-started. The consumer received a pending Promise from
  the prior `it%`, ignored it, and invoked `it%` again before the
  Promise resolved. Under Foi's synchronous execution model, this
  arises only when the prior step's body suspended in some outer
  non-`Effect.Host.Gen` handler introducing asynchrony; the consumer arrived
  with a next call before the async completed and body resumed to a
  Gen arm. One diagnostic:
  `Promise.renege@ "Previous Iterator Step Incomplete"`.

Guard ordering matters: re-entrancy is checked before unawaited-prior-
step. During Call 1 re-entrance, both `insideStep=true` and `waitingPr`
unresolved match; ordering re-entrancy first ensures the more specific
diagnosis wins per §5 first-match-wins.

The `insideStep` flag is set at `step()` entry (immediately before
`doStep1` or `doStepN`) and cleared before `step()` returns. Under
synchronous execution, `step()`'s frame is on the sync stack if and
only if `insideStep=true` at entry; the flag is definitional. The two
guard signals -- `insideStep` and `!waitingPr.resolved()` -- diagnose
disjoint consumer mistakes with different remediation paths and are
not collapsible.

**Sequential-by-construction.** At most one live-unused `ret` exists at
any moment per handler scope; each captured `ret` is invoked at most
once (one-shot); no representable sequence produces out-of-order or
concurrent effect events. This is a language-level invariant, not a
runtime property the runner defends. It follows from single-`comp`-per-
handler (§6.3), delimited-one-shot `ret` (§6.3.2), and Foi's
synchronous execution model.

**No user-authorable callable-source path.** The final `^IterP@ step`
invocation exercises the stdlib-internal callable-source path of
`IterP@` (§6.5.4 NOTE); user code cannot construct an `IterP` from a
bare callable. The runner is the sole caller of this path in stdlib.

### §6.7 State

A **state** is a deferred computation that threads a state value through a sequence of reads and writes. Each step observes the current state and produces both a value and an updated state. No code runs at construction; execution is triggered by applying an initial state via `%`.

The userland surface is:

- `State@`: unit constructor over a state-changer function.
- Binary `%`: applies an initial state and runs the computation, evaluating to a `< value, finalState >` tuple.
- `~<<` do-block composition: sequences state operations, threading the state through each step (per §3.10.9.4 do-block-compilation split).

#### §6.7.1 State Unit Constructor

A state instance is constructed by applying `State@` to a state-changer function:

```java
def counter: State@ (defn(s) ^< s, s + 1 >);
```

The state-changer takes the current state as its parameter and returns a `< value, newState >` tuple, where `value` is the result observed at this step and `newState` is the state threaded forward. Wrapping does not execute the state-changer; it produces a deferred `State` instance whose evaluation is triggered later by `%`.

#### §6.7.2 Applying Initial State Via `%`

A `State` instance is executed by applying an initial state via the binary `%` effector operator:

```java
def counter: State@ (defn(s) ^< s, s + 1 >);

counter% 10;    // < 10, 11 >
counter% 0;     // < 0, 1 >
```

The initial state is passed as the RHS of `%`; the state-changer runs with that value as its parameter and returns the `< value, finalState >` tuple as the result of the `%` expression.

`%` dispatch on a `State` instance is realized via ordinary `_percent`-hook dispatch (§6.2); the hook is stdlib code that invokes the wrapped state-changer with the applied state.

The unary form `%` (with no RHS) is ill-formed on a `State` instance: a state instance carries no default initial state, so execution requires an explicit initial state.

#### §6.7.3 Named State Constructors

Beyond the general `State@` unit constructor, five named constructors cover the common state operations:

- `State.get@`: reads the current state as the observed value, leaves the state unchanged.
- `State.gets@`: applies a function to the current state, returns the result as the observed value, leaves the state unchanged.
- `State.of@`: produces an initial observed value without changing the state.
- `State.put@`: writes a new state, produces `empty` as the observed value.
- `State.modify@`: applies a function to transform the current state, produces `empty` as the observed value.

Each is a stdlib-provided `State` instance (or, for `gets`, `of`, `put`, and `modify`, a stdlib-provided function that produces a `State` instance):

```java
State.get@;              // aka: State@ (defn(s) ^< s, s >)
State.gets@ (*)|2|;      // aka: State@ (defn(s) ^< s * 2, s >)
State.of@ 42;            // aka: State@ (defn(s) ^< 42, s >)
State.put@ 42;           // aka: State@ (defn(s) ^< empty, 42 >)
State.modify@ (+)|1|;    // aka: State@ (defn(s) ^< empty, s + 1 >)
```

Evaluated via `%` in isolation:

```java
(State.get@)% 10;             // < 10, 10 >
(State.gets@ (*)|2|)% 10;     // < 20, 10 >
(State.of@ 42)% 10;           // < 42, 10 >
(State.put@ 42)% 10;          // < empty, 42 >
(State.modify@ (+)|1|)% 10;   // < empty, 11 >
```

`get` and `gets` observe without mutating; `put` and `modify` mutate without meaningfully observing; `of` does neither, injecting a value into the computation while leaving the state untouched. These five constructors are the primary surface for building state computations; the general `State@` form is the escape hatch for state-changers whose shape doesn't fit these idioms.

#### §6.7.4 Composition Via `~<<`

Multiple `State` operations sequence into a larger `State` computation via the `~<<` do-block form. The block is a chain of monadic binds terminated by a map -- lifting a bare value to the do-comprehension's monadic type -- on the final expression:

```java
def bump: State ~<< {
    def prev:: State.get@;
    State.put@ (prev + 1);
    prev    // bare value, map lifted to State
};

bump;        // State{..}

bump% 10;    // < 10, 11 >
bump% 50;    // < 50, 51 >
```

**NOTE:** The `%` is *evaluating* the State chain, not mutating it. That's why `bump% 50` is unaffected by the `bump% 10` invocation.

Inside the block:

- `def prev:: expr` binds `prev` to the observed value of `expr`
  (a `State` instance) and threads the updated state forward.
- A bare mid-block statement (`State.put@ ..` above) sequences/chains
  the expression as a `State` step, threading the updated state
  forward and discarding the observed value. Explicit `$expr;` at
  this position performs the bind non-receivingly -- legal when the
  step's side effect matters even though its observed value is not
  needed. `def prev:: expr` is the form when you need the unwrapped
  observed value in scope.
- The terminal expression is `~map`-lifted into the ambient monad.
  A bare terminal (`prev` above) becomes the block's observed value;
  the block evaluates to a `State` producing that value while
  preserving the threaded state.
- A `$`-prefixed terminal (`$expr`) binds `expr` before the terminal
  map (compiler-synthesized `def _r: Effect.Host.Do.Bind% expr;
  Effect.Host.Do.Map% _r` per §3.10.9.4). Use this form when the terminal
  expression is itself already lifted as a `State` instance; the
  compiler-synthesized Map tail avoids the double-wrap that a bare
  terminal would produce.

Example with a `State`-typed terminal, requiring the `$` prefix to
avoid double-wrap:

```java
def compute: State ~<< {
    State.modify@ (+)|1|;
    State.modify@ (*)|3|;
    $State.get@
};

compute% 5;    // < 18, 18 >
```

Without the `$` on the terminal `State.get@`, the block would
produce a `State{ State{...} }`: the terminal map lifting an
already-`State` value into another `State` layer. The `$` prefix
binds first, so `State.get@` lands at the correct monadic level.

Per §3.10.9.4 do-block-compilation split, `State ~<<` composition compiles via the default route (compile-time expansion to nested `~<` / `~map`).

Under the composition axis (§6 opener), `State` is a composing outer on `~<<`: successive steps chain via monadic bind, terminating at the block's terminal expression. `State` is not admitted on `~<*`, nor does it admit a compound-LHS -- state computations are synchronous, the state-changer shape (`< value, newState >`) has no async variant, and per-step Promise-lifting is not defined for `State`.

### §6.8 Promise

A **Promise** is a monadic container for an `Either` value whose resolution may be immediate or deferred. Unlike `State` (§6.7), which is a deferred computation triggered by applying `%`, a `Promise` instance is either already resolved at construction or pending resolution by an external agent -- a **subject** (§6.8.2). Operations composed against a pending promise are automatically deferred until resolution; once resolved, further operations run synchronously.

The `Either` shape carries success and failure through composition: a resolved-`Right` value flows through subsequent steps; a resolved-`Left` value short-circuits composition. Promise has no separate rejection channel; failure is signaled entirely via the `Either` payload.

**NOTE:** Although the resolved payload is written as `Right@ v` or `Left@ reason`, the `Either` shape is invariant: a `Promise` instance's payload is always one of the two tagged branches. For observation and unwrapping purposes, `Promise{Right{v}}` behaves as a single layer -- extracting the success value yields `v` directly, not `Right@ v`. The `Right` / `Left` tags discriminate the success and failure branches; they do not compose as a separate unwrap step. A `Promise` holding a distinct nested type (for instance, an `IO` inside its success payload -- `Promise{Right{IO{42}}}`) is genuinely two layers: the Either-branch discriminator is invariant, but the `IO` layer is a distinct nested type that composes independently.

The userland surface is:

- `Promise@`: unit constructor over an `Either`. Produces an already-resolved promise.
- `Promise.honor@`: named constructor sugar wrapping a bare value in `Right`.
- `Promise.renege@`: named constructor sugar wrapping a bare value in `Left`.
- `Promise.subj@`: constructs a subject whose `.pr` is a pending promise. Applying `%` to the subject with an `Either` resolves the associated promise.
- `.resolved()`: instance method returning `true` if the promise is resolved, `false` if pending.
- `Promise.race@`: coordination combinator over a list of promises. Constructs a derived `Promise` that resolves with the first source promise's payload.
- `Promise.all@`: coordination combinator over a list of promises. Constructs a derived `Promise` that resolves with a List of source payloads once every source promise has resolved.
- `~<` / `~map`: single-step chain operators, both Either-aware -- each sees through `Right` to the underlying value and forwards a `Left` unchanged without invoking the step. Composed against a pending promise, the step is deferred until resolution; against a resolved promise, it runs inline.
- `~<<` do-block composition: sequences promise operations, deferring subsequent steps across pending resolutions and short-circuiting on `Left`.

#### §6.8.1 Promise Unit Constructors

An already-resolved promise is constructed by applying `Promise@` to an `Either`:

```java
def ok: Promise@ (Right@ 42);           // Promise{Right{42}}
def bad: Promise@ (Left@ "missing");    // Promise{Left{"missing"}}
```

The wrapped `Either` is the promise's resolved value. `Promise@` requires an `Either`; applying it to a non-`Either` value is statically rejected:

```java
Promise@ 42;    // ill-formed: 42 is not an Either
```

Two named constructors wrap common cases where the value is not already an `Either`:

- `Promise.honor@ v`: equivalent to `Promise@ (Right@ v)`.
- `Promise.renege@ r`: equivalent to `Promise@ (Left@ r)`.

```java
Promise.honor@ 42;          // Promise{Right{42}}
Promise.renege@ "oops";     // Promise{Left{"oops"}}
```

These are ordinary sugars, not smart selectors; each unconditionally wraps its argument in the corresponding `Either` branch.

#### §6.8.2 Pending Promises Via `Promise.subj@`

A pending promise is created by constructing a subject:

```java
def subj: Promise.subj@;

subj.pr.resolved();      // false
```

The subject exposes a single field:

- `.pr`: the associated promise, initially pending.

Resolution is triggered by applying `%` to the subject with an `Either` payload. Either branch is admitted -- a `Right@` resolution fulfills the promise, and a `Left@` resolution rejects it:

```java
def subj: Promise.subj@;

subj% (Right@ 42);
// Right{42}

subj.pr;
// Promise{Right{42}}
```

```java
def subj: Promise.subj@;

subj% (Left@ "cancelled");
// Left{"cancelled"}

subj.pr;
// Promise{Left{"cancelled"}}
```

The `Either` supplied at `%`-time becomes the promise's resolved value. Like `Promise@` (§6.8.1), `%` on a subject requires an `Either`; a non-`Either` argument is statically rejected. Unary `subj%` is ill-formed; resolution requires the payload.

Once resolved, a promise's state is permanent. Subsequent `%` applications to the same subject do not change its state.

Operations composed against a pending promise are deferred; the branch encountered at resolution time determines whether composed steps fire or short-circuit:

```java
def subj: Promise.subj@;

def doubled: subj.pr ~map (v) { v * 2; };
// Promise{..pending..}

subj% (Right@ 21);
// Right{21}

doubled;
// Promise{Right{42}}
```

Once `subj% (Right@ 21)` fires, `subj.pr` is permanently resolved with `Right@ 21`; the deferred `~map` runs synchronously against the `Right` payload, producing `Promise{Right@ 42}`. Any subsequent operations composed off `subj.pr` (or off `doubled`) run synchronously against the resolved values.

If the subject is rejected instead, the deferred `~map` does not fire; the `Left` passes through unchanged, and the composed promise resolves with the same `Left`:

```java
def subj: Promise.subj@;

def doubled: subj.pr ~map (v) { v * 2; };
// Promise{..pending..}

subj% (Left@ "cancelled");
// Left{"cancelled"}

doubled;
// Promise{Left{"cancelled"}}
```

This mirrors the Either-aware composition semantic of `~<<` (§6.8.3): `~<` and `~map` on `Promise` see through `Right` and forward `Left` unchanged, so a rejection resolution propagates through any chain of deferred operations without executing them.

`%` dispatch on a subject is realized via ordinary `_percent`-hook dispatch (§6.2); the hook is stdlib code that writes the supplied `Either` into the associated promise's slot (§6.1.5), flips the slot's `resolved` field, and fires every deferred continuation the slot has accumulated during the pending window.

**NOTE:** The promise is separable from its subject (but not vice versa). `subj.pr` is a first-class value: it may be passed, stored, and composed independently. Applying `%` to the subject is the sole path to state transition; a subject whose holder never triggers `%` yields a permanently-pending promise.

**NOTE:** Per-instance slot representation (§6.1.5). A `Promise` instance's slot holds `< resolved, value, deferred >`: a boolean, the resolved `Either` (or `empty` while pending), and a list of continuations waiting on resolution. Already-resolved construction (`Promise@`, `Promise.honor@`, `Promise.renege@`) initializes the slot as `< true, either, <> >` and never accumulates continuations. Pending construction via `Promise.subj@` initializes as `< false, empty, <> >`; `~<` / `~map` composition against the pending promise appends the continuation to `.deferred` via the slot's read-modify-write idiom, and subject-`%` resolution rewrites the slot to `< true, either, <> >`, drains the accumulated continuations against the resolved `Either`, and runs each one synchronously. Composition against an already-resolved promise reads `.value` from the slot and runs the continuation inline without ever touching `.deferred`. The `.resolved()` method projects the slot's `resolved` field directly.

#### §6.8.3 Composition Via `~<<`

Multiple `Promise` operations sequence into a larger promise computation via the `~<<` do-block form. `Promise ~<<` composition is **Either-aware**: `::` binds see through the `Right` branch to the underlying value; a `Left` encountered mid-chain short-circuits the block.

```java
defn fetchUser(id) ^Promise.honor@ < :id, name: "Alice" >;
defn fetchOrders(userId) ^Promise.honor@ < 1, 2, 3 >;

def task: Promise ~<< {
    def user:: fetchUser(42);
    def orders:: fetchOrders(user.id);
    < :user, :orders >;
};

task;
// Promise{Right{ < user: < id: 42, name: "Alice" >, orders: < 1, 2, 3 > > }}
```

Inside the block:

- `def user:: fetchUser(42)` binds `user` to the `Right` payload of
  the promise returned by `fetchUser(42)`. If the resolved value is
  `Left@ reason`, the block short-circuits and evaluates to
  `Promise@ (Left@ reason)`; subsequent statements do not run.
- A bare mid-block statement sequences the promise step and discards
  its `Right` value; a `Left` at that step still short-circuits.
  Explicit `$expr;` at this position performs the bind non-
  receivingly -- legal when the step's resolution matters even though
  its `Right` value is not needed.
- The terminal expression is `~map`-lifted into the ambient `Promise`,
  wrapping in `Right`. A bare terminal (`< :user, :orders >` above)
  produces a `Promise@ (Right@ terminalValue)`.
- A `$`-prefixed terminal (`$expr`) binds `expr` before the terminal
  map (compiler-synthesized `def _r: Effect.Host.Do.Bind% expr;
  Effect.Host.Do.Map% _r` per §3.10.9.4), avoiding double-wrap when the
  terminal expression is itself already a `Promise`.

Each pending promise encountered in the block defers the remaining
steps until resolution.

Short-circuit example:

```java
defn fetchUser(id) ^Promise.renege@ "user not found";
defn fetchOrders(userId) ^Promise.honor@ < 1, 2, 3 >;

def task: Promise ~<< {
    def user:: fetchUser(42);
    def orders:: fetchOrders(user.id);   // not reached
    < :user, :orders >;                  // not reached
};

task;
// Promise{Left{"user not found"}}
```

Per §3.10.9.4 do-block-compilation split, `Promise ~<<` composition compiles via the default route (compile-time expansion to nested `~<` / `~map`). The Either-aware behavior of the do-block is inherited from Either-aware `~<` and `~map` hooks on `Promise`: both see through `Right` and pass `Left` unchanged.

Under the composition axis (§6 opener), `Promise` is a composing outer on `~<<`: the block sequences a single-shot chain over a single resolution, terminating at the terminal expression (or short-circuiting on a `Left`). `Promise` is not admitted on `~<*` -- open-ended consumption of promise-producing sources routes through the source's own do-comprehension arm (`Channel ~<*` §6.9, `PushStream ~<*` §6.10, `PullStream ~<<` §6.11) rather than through `Promise`. A compound-LHS `Promise{X}` is documentary only; the resolved payload's inner shape is not read into `~<<` dispatch.

**Eager async iteration.** Sequencing a bounded list of promises -- awaiting each before the next step runs -- uses the compound-LHS `List{Promise} ~<<` form, specified with worked example in §7.2.

#### §6.8.4 Promise Combinators

Two named constructors coordinate across a list of promises, each producing a derived `Promise` that resolves once the coordination outcome is determined.

**`Promise.race@`** races the input promises; the first source promise to resolve wins:

```java
def subj1: Promise.subj@;
def subj2: Promise.subj@;

def winner: Promise.race@ < subj1.pr, subj2.pr >;

winner;
// Promise{..pending..}

subj2% (Right@ 42);
// Right{42}

winner;
// Promise{Right{42}}

subj1% (Right@ 10);
// Right{10}
// (no effect on `winner`; already resolved)
```

`winner` resolves with the winning source promise's payload directly. Race is neutral about the `Right`/`Left` branch: a `Left`-resolving source promise wins the race the same way a `Right`-resolving one does. Downstream `::` binds and `~<` / `~map` on `winner` compose against that payload identically to any other promise.

When multiple source promises resolve simultaneously, arbitration follows the input list's left-to-right ordering. Producers relying on `Promise.race@` for fairness across roughly-equal sources should shuffle the input list (for instance, round-robin).

**`Promise.all@`** waits for every input promise to resolve, then delivers the resolved payloads as a List preserving input order:

```java
def subj1: Promise.subj@;
def subj2: Promise.subj@;

def combined: Promise.all@ < subj1.pr, subj2.pr >;

subj2% (Right@ 42);
// Right{42}

combined;
// Promise{..pending..}

subj1% (Right@ 10);
// Right{10}

combined;
// Promise{Right{ < 10, 42 > }}
```

The resolved List preserves the input list's ordering, independent of the order in which resolutions arrived.

If any source promise resolves with a `Left`, `combined` resolves with that `Left` -- the first rejection short-circuits the coordination, and subsequent source resolutions have no effect on `combined`.

**Empty input.** Both combinators reject an empty input list at construction, producing an already-resolved `Left`:

```java
Promise.race@ <>;
// Promise{Left{"Empty list of promises"}}

Promise.all@ <>;
// Promise{Left{"Empty list of promises"}}
```

**NOTE:** These are Promise-returning constructors; the derived promise composes uniformly with the Promise API (§6.8.1–§6.8.3) -- downstream consumers apply `~<`, `~map`, or `~<<` composition to it identically to any other promise. One-shot resolution is the derived promise's contract: like any Promise, it resolves exactly once over its lifetime.

### §6.9 Channel

A **Channel** is a coordination primitive for value transmission between producer and consumer sites, following CSP (Communicating Sequential Processes) semantics. Unlike `Promise` (§6.8), whose composition threads a single resolution through a chain, a `Channel` mediates a stream of value handoffs; unlike `State` (§6.7), which is deferred by construction, a `Channel` is *coordinative* -- each `put` and `take` operation completes only when a corresponding counterpart operation occurs (buffering excepted; see §6.9.1).

**NOTE:** A `Channel` instance is not itself monadic. It has no `~<` or `~map` hook; single-value do-block composition is not defined over `Channel` directly. Instead, every `put`/`take`/`peek` operation on a `Channel` produces a `Promise`, and single-operation composition proceeds through `Promise ~<<` (§6.8.3) over those returned promises. Repeated consumption uses `Channel ~<*` directly (§6.9.4).

Under the composition axis (§6 opener), `Channel` sits on `~<*` as an observer of external emissions: producers drive by calling `put`; the block observes each successful take. The `~<*` hook internally performs each take between iterations and unwraps the Either-`Right` payload before binding the loop variable -- callers work with the underlying value directly, not with a wrapped `Right@ v`. The loop terminates when the channel closes, and the `~<*` expression resolves to `Promise{Left{"Channel Closed"}}`.

Each operation's returned promise resolves to `Right` on success or `Left` on failure (channel already closed). The Either-aware composition of `Promise ~<<` (§6.8.3) inherits directly -- a `Left` from a channel operation short-circuits the surrounding block.

The userland surface is:

- `Channel@`: unit constructor. Optional positive integer argument sets buffer size (default `0` -- unbuffered).
- `.put(v)`: enqueue a value. Returns a `Promise` that resolves once a corresponding `take` completes (or immediately if buffer capacity is available).
- `.take()`: dequeue a value. Returns a `Promise` that resolves once a corresponding `put` completes (or immediately if a buffered value is available).
- `.peek()`: observe the next available value without consuming it. Returns a `Promise` that resolves with `Right@ v` once a value is queued; concurrent peeks all resolve to the same value.
- `.close()`: close the channel. Returns `Right@ true` on first invocation; subsequent invocations return `Left@ "Channel Closed"`. Pending `take`s at close time resolve with `Left`.
- `Channel.alts@`: race combinator over a list of channels. Constructs a one-shot derived `Channel` that receives `< :value, :channel >` for the first source channel to produce a value, then closes.
- `Channel.every@`: zip combinator over a list of channels. Constructs a one-shot derived `Channel` that receives `< ...values >` (input-order preserved) once every source channel has produced a value, then closes.
- `~<*` observer composition: observes each successful take on the channel until it closes (§6.9.4).

**NOTE:** Because Foi promises can resolve synchronously (§6.8.2), the coordination promises returned from channel operations carry no inherent race conditions. When a `put` pairs with a pending `take`, or a source channel emits into a derived combinator channel (§6.9.5), the paired operation's promise resolves in-line during the triggering call -- composed observers (via `~<<` binds, `~<*` iteration, or `.resolved()` inspection) see a consistent view with no scheduled-for-later gap admitting interleaved observations of partial state.

#### §6.9.1 Channel Unit Constructor

An unbuffered channel is constructed by nullary `Channel@`:

```java
def ch: Channel@;
```

A buffered channel is constructed by supplying a positive integer:

```java
def ch: Channel@ 3;    // buffer size 3
```

The buffer holds values placed by `put` that have not yet been taken. While the buffer has capacity, `put` operations resolve immediately with `Right@ true`; once the buffer is full, subsequent `put` operations return pending promises (identical to unbuffered semantics) until buffered values are drained by `take`.

A `Channel@` argument that is not a positive integer is ill-formed.

#### §6.9.2 Put/Take Operations

`put` and `take` are the two primary coordination operations:

```java
def ch: Channel@;

def putP: ch.put(42);    // Promise{..pending..}

def takeP: ch.take();    // Promise{Right{42}}

putP;                    // Promise{Right{true}}
```

Neither operation completes in isolation on an unbuffered channel: an isolated `put` remains pending until a corresponding `take` arrives, and likewise a `take` remains pending until a corresponding `put` arrives. Pending operations are matched in FIFO order -- the first pending `put` pairs with the first arriving `take`, and vice versa.

Both operations produce promises whose resolution branches on `Right`/`Left`:

- `.put(v)` resolves with `Right@ true` on successful transmission; `Left@ "Channel Closed"` if the channel was closed before completion.
- `.take()` resolves with `Right@ v` on successful reception, where `v` is the transmitted value; `Left@ "Channel Closed"` if the channel was closed with no pending or buffered values.

Because resolution branches on `Right`/`Left`, composition through `Promise ~<<` (§6.8.3) sees through the `Right` on `::` bind:

```java
def ch: Channel@;

def receiver: Promise ~<< {
    def v:: ch.take();
    log(`"Received: `v`");
};

ch.put(42);
// Received: 42
```

`v` is bound to the underlying `42`, not `Right@ 42`, per Promise's Either-aware composition.

Aside from `take`, an observation operation is available: `.peek()` returns a `Promise` that resolves with the next value queued on the channel, without consuming it:

```java
def ch: Channel@;

def peekP: ch.peek();    // Promise{..pending..}

ch.put(42);

peekP;                   // Promise{Right{42}}
```

Multiple concurrent `peek` operations on the same channel all resolve to the same value; peeks do not queue the way `put` and `take` do. The observed value remains queued on the channel -- a subsequent `take` still consumes it. A `peek` on a closed and drained channel resolves with `Left@ "Channel Closed"`.

Combined with `.resolved()` (§6.8), `peek` supports a deterministic queue-availability check without side effects:

```java
def ch: Channel@;

def peekP: ch.peek();
peekP.resolved();     // false -- nothing queued yet

ch.put(42);

peekP.resolved();     // true -- the pending peek resolved in-line during put

def peekQ: ch.peek();
peekQ.resolved();     // true -- value is already queued
peekQ;                // Promise{Right{42}}
```

Because Foi promises resolve synchronously, the `.resolved()` observation immediately following a `put` reflects the post-`put` state; no scheduled gap admits an intermediate observation.

The spirit of CSP is that the primary read operation is `take`, not `peek`; peek is provided for observation patterns -- for example, inspecting availability via the pattern above before committing to a `take`.

**NOTE:** Per-instance slot representation (§6.1.5). A `Channel` instance's slot holds `< closed, capacity, buffer, putQueue, takeQueue, peekWaiters >`: a one-shot `closed` flag, the construction-time buffer `capacity` (`0` for unbuffered), the current `buffer` list of values placed by `put` awaiting `take` (bounded by `capacity`), a `putQueue` of pending puts each carrying its value and resolution callback, a `takeQueue` of pending takes each carrying its resolution callback, and a `peekWaiters` list of pending peeks. `put`, `take`, `peek`, and `close` each rewrite the slot via read-modify-write (per §6.1.5's record-spread-update idiom) to enforce the coordination invariants: `putQueue` is non-empty only when `buffer` is at `capacity` and `takeQueue` is empty; `takeQueue` is non-empty only when `buffer` is empty and `putQueue` is empty; a `put` with a waiting take in `takeQueue` pairs FIFO by moving one entry from `takeQueue` and resolving both callbacks in-line (per §6.8's sync resolution); a `take` with a value in `buffer` shifts it out and, if `putQueue` is non-empty, moves one queued put's value into `buffer` and resolves its callback in the same rewrite. Peeks accumulate independently in `peekWaiters` -- they do not consume; the first value to arrive in `buffer` resolves every pending peek simultaneously and remains queued for a subsequent `take`. `close` sets the flag, drains `putQueue` with `Left@ "Channel Closed"`, resolves any `takeQueue` entries beyond the remaining buffer with the same `Left`, and drains `peekWaiters` with `Left` once the buffer is empty.

#### §6.9.3 Closing

A channel is closed via `.close()`:

```java
def ch: Channel@;

ch.close();
// Right{true}

ch.close();
// Left{"Channel Closed"}
```

Closing is a one-time state transition:

- The first invocation returns `Right@ true`.
- Subsequent invocations return `Left@ "Channel Closed"`.

Once closed:

- Any pending `take` at close time resolves with `Left@ "Channel Closed"`.
- Any subsequent `put` resolves with `Left@ "Channel Closed"`.
- A `take` on a closed channel whose buffer still contains values resolves those values in FIFO order with `Right`; only once the buffer is drained does subsequent `take` yield `Left@ "Channel Closed"`.

The `Left` from a closed-channel operation composes naturally through `Promise ~<<` -- it short-circuits the surrounding block. Under `Channel ~<*` (§6.9.4), a `Left`-resolving take signals iteration termination.

#### §6.9.4 Composition

Because `Channel` is not itself monadic, composition proceeds through the `Promise` instances produced by its operations. Two patterns dominate:

**Sequenced coordination in `Promise ~<<`.** Multiple channel operations sequence through Promise's do-block:

```java
defn relay(chIn, chOut) ^Promise ~<< {
    def v:: chIn.take();
    ::chOut.put(v);
};
```

Each `::` bind sees the `Right` payload; a `Left` at any step short-circuits the block with `Promise@ (Left@ "Channel Closed")` -- the natural error path when a channel closes mid-relay.

**Repeated consumption via `Channel ~<*`.** Consumer-side loops observe each successful take on a channel until it closes:

```java
def ch: Channel@;

// consumer
def consumer: Channel ~<* (v:: ch) {
    log(`"Got: `v`");
};

consumer;        // Promise{..pending..}

// producer
ch.put(1);       // Got: 1
ch.put(2);       // Got: 2
ch.close();      // consumer terminates

consumer;        // Promise{Left{"Channel Closed"}}
```

The `~<*` hook performs each take between iterations; `v` binds to the received payload (the Either-`Right` is unwrapped internally per §6.9's opener). The block runs once per received value; iteration terminates when the channel closes, and the `~<*` expression resolves to `Promise{Left{"Channel Closed"}}`.

Unlike the `Promise ~<<` relay pattern above, the block does not itself invoke `take`; the channel LHS supplies the take semantics, and the block observes each payload directly. `Channel` is not admitted on `~<<`; single-operation channel work uses `Promise ~<<` (relay pattern above) rather than `Channel ~<<`.

**NOTE:** The `Channel~<*` hook is self-hosted stdlib code, not runtime-privileged. Its implementation shape: a `defn Channel~<*(comp, ty)` declaration (§3.1.1.3) that establishes an inner `Effect.Host.Do ~<*` scope (prefix-catching `Effect.Host.Do.Bind` and `Effect.Host.Do.Map` per §6.1.4) over `comp` (§6.3), dispatches on `Effect.Host.Do.Bind` by looping `ch.take()` and feeding each resolved `Right` payload through `ret` to resume `comp`, and terminates the loop when a `take` resolves `Left`. `ch.take()` supplies both value emission and close-detection through the same Promise, so no additional runtime primitive is required. Userland namespaces with channel-shaped semantics can declare their own `~<*` hook by the same pattern.

Two named constructors coordinate across a list of channels, each producing a one-shot derived `Channel` that receives the coordination outcome and closes.

**`Channel.alts@`** races the input channels; the first source channel to produce a value wins:

```java
def ch1: Channel@;
def ch2: Channel@;

def winner: Channel.alts@ < ch1, ch2 >;

ch2.put(42);

winner.take();    // Promise{Right{< value: 42, channel: ch2 >}}
winner.take();    // Promise{Left{"Channel Closed"}}
```

`winner` receives a single record `< :value, :channel >` -- `value` is the value consumed from the winning source channel; `channel` is the source channel it came from -- then closes. The value is consumed from its source channel: a subsequent `take` on `ch2` above would not observe `42`. When multiple source channels have values available simultaneously, arbitration follows the input list's left-to-right ordering; this can starve later channels of visibility, so producers relying on `Channel.alts@` should shuffle the input list (for instance, round-robin).

If every source channel closes and drains before any produces a value, `winner` closes with pending takes resolving `Left@ "Channel Closed"`.

**`Channel.every@`** zips the input channels; the derived channel receives a list once every source channel has produced a value:

```java
def ch1: Channel@;
def ch2: Channel@;

def all: Channel.every@ < ch1, ch2 >;

ch2.put(10);
ch1.put(42);

all.take();    // Promise{Right{< 42, 10 >}}
all.take();    // Promise{Left{"Channel Closed"}}
```

The received list preserves the input list's ordering, independent of the order in which values arrived. Each source value is consumed from its channel as it arrives; values consumed before every-satisfaction is reached are held internally by the combinator until the derived channel emits. If any source channel closes before producing a value, `all` closes with pending takes resolving `Left@ "Channel Closed"`.

**NOTE:** These are Channel-returning constructors; the derived channel composes uniformly with the Channel API (§6.9.2-§6.9.4) -- downstream consumers apply `take` and Promise-based composition to it identically to any other channel. One-shot with auto-close is the derived channel's contract: unlike a base `Channel@`-constructed instance, it emits exactly one value over its lifetime.

### §6.10 PushStream

A **PushStream** is a monadic *subscribable source* of values -- not a container holding a value, but a protocol for value delivery to registered subscribers. Unlike `Promise` (§6.8), whose composition threads a single resolution through the chain, and unlike `Channel` (§6.9), which coordinates one-to-one value handoff between producer and consumer, a `PushStream` broadcasts each value pushed by its producer to every currently-subscribed observer.

A stream is either **open** (accepting pushed values and forwarding them to subscribers) or **closed** (no further values propagate). This is analogous to `Promise`'s pending/resolved distinction but structurally different: a promise resolves once and permanently holds that value; a stream emits values as its producer supplies them, retains no value between emissions, and terminates by transitioning to closed. Close signals propagate downstream to any composed observer.

**NOTE:** `PushStream` is monadic in the sense of the observable monad in reactive-programming literature. `~<` and `~map` are defined directly on it; `~<*` (§6.10.3) is the composition-form operator. Monad laws hold under observable-behavior equivalence: from any subscriber's viewpoint, `(PushStream.subj@).st ~< f` and the stream produced by `f v` (once `v` is pushed) yield emission sequences and close timings indistinguishable to that observer. This is a weaker equivalence than the static-value equalities that hold for `Promise` or `Id`, because a stream has no static value to equate -- only a sequence of emissions observable through subscription.

**NOTE:** Four design commitments frame `PushStream`'s subscription semantics:

- **Hot**: producers push independently of subscribers. Values pushed while no subscriber is registered are lost. Cold streams are `PullStream` (§6.11).
- **Broadcast**: every currently-subscribed observer receives every pushed value. Subscription is fanout, not queued handoff.
- **No replay**: a subscriber sees only values pushed after its subscription; values pushed before its subscription are not delivered to it. Streams retain no history.
- **Idempotent subscription**: a subscription is a relationship between subscriber and source, not an accumulating count. Establishing a subscription for a (subscriber, source) pair that already exists is a no-op. This invariant applies uniformly to every operator (`~<`, `~map`, `~<*`, combinators) that establishes subscriptions internally.

These match the hot-observable design well-worn in reactive-programming literature (with idempotent subscription as Foi's language-level addition). They distinguish `PushStream` from `Channel` (single-consumer, coordinated, back-pressured) and from `Promise` (single-value, replayable via re-observation).

The userland surface is:

- `PushStream@`: this unit constructor form exists for definitional completeness, but its use is always ill-formed and will produce a compiler error.
- `PushStream.subj@`: subject constructor. Exposes `.st` (the associated `PushStream`) as its sole field. Returns a subject.
- `subj.close()`: close the stream. Available on the subject only. Returns `Right@ true` on first invocation; subsequent invocations return `Left@ "PushStream Closed"`. Close propagates downstream to composed observers.
- `stream.closed()`: available on the stream. Returns a `Promise` that resolves to `Right@ empty` once the stream closes. For sync inspection of current state, use `.closed().resolved()` (per §6.8).
- Subject `%`: `subj% v` broadcasts `v` to all current subscribers of the associated stream. Returns a Promise (see §6.10.1).
- `~<` / `~map`: single-step chain operators. Each registers a subscriber on the source stream and produces a derived stream carrying transformed values to that derived stream's own subscribers.
`~<*` subscription form: registers the block body as a subscriber to the source stream; the block body executes per value broadcast from the source. Resolves to `Promise{Left{"PushStream Closed"}}` when the source closes, or `Promise{Left{payload}}` when a terminal `Left@ payload` in the block body signals early unsubscribe (§6.10.3). The block's terminal expression is otherwise discarded.
- `PushStream.merge@` / `.filter@` / `.scan@` / `.takeUntil@`: derived-stream constructors for fan-in, predicate filtering, stateful fold, and signal-driven close (§6.10.4).

**NOTE:** `~<<` (single-value do-block, §6.8.3) is not defined on `PushStream`. Streams have no single value to extract; `~<*` is the composition-form operator for producer-broadcast sources. This mirrors the split for other `~<*`-consuming types (§6.3, §6.9).

#### §6.10.1 PushStream Unit Constructor

A `PushStream` instance is constructed exclusively through a subject; the `PushStream@` bare unit constructor is ill-formed and cannot be used (compiler error).

**NOTE:** This reflects the producer-driven nature of push streams: a stream without a producer would be permanently silent, discarding any construction values (since no subscription could exist at construction time).

A subject is created via `PushStream.subj@`. The subject holds the write capability (broadcasting values, closing the stream); the associated stream, exposed via `.st`, holds the read capability (subscription, chain composition). `PullStream` (§6.11) makes an analogous read/write separation with the write side stdlib-privileged rather than userland-visible.

```java
def subj: PushStream.subj@;
```

The subject exposes a single field:

- `.st`: the associated `PushStream`, open at construction and awaiting subscribers.

Values are broadcast into the associated stream by applying `%` to the subject with a value:

```java
def subj: PushStream.subj@;

def observer1: subj.st ~map (v) {
    log(`"observer1: `v`");
    v;
};
// PushStream{}

subj% 1;
// observer1: 1
// Promise{Right{true}}

def observer2: subj.st ~map (v) {
    log(`"observer2: `v`");
    v;
};
// PushStream{}

subj% 2;
// observer1: 2
// observer2: 2
// Promise{Right{true}}
```

Note `observer2` receives `2` but not the earlier `1`: subscription confers visibility only for values pushed after subscription, per the no-replay commitment.

Each `%` application broadcasts its argument synchronously to all currently-subscribed observers of the associated stream, then returns a `Promise` resolving to `Right@ true` on successful broadcast, or `Left@ "PushStream Closed"` if the associated stream has been closed. Unary `subj%` is ill-formed; broadcasting requires the value.

Broadcast delivery is synchronous: subscribers registered at the moment of the `%` call receive the value within that call. Subscribers registering after the `%` call has completed do not receive that value (no-replay). The returned Promise resolves after delivery completes.

`%` dispatch on the subject is realized via ordinary `_percent`-hook dispatch (§6.2); the hook is stdlib code that broadcasts the value to the associated stream's current subscribers.

**NOTE:** The stream is separable from its subject (but not vice versa). `subj.st` is a first-class value: it may be passed, stored, composed, and observed independently. Applying `%` to the subject is the sole path for the subject's holder to broadcast values; `.close()` on the subject is the sole path to explicit close. Holders of only `.st` are pure observers -- they can subscribe, chain, and check `.closed()`, but cannot broadcast or close the source.

**NOTE:** Per-instance slot representation (§6.1.5). A `PushStream` instance's slot holds `< closed, subscribers >`: a one-shot `closed` flag and the current subscriber-callback list (kept unique per §6.10 opener's idempotent-subscription invariant). A `PushStream.subj@`-constructed subject's slot holds `< associated >`: an indirect reference to the paired `PushStream` value exposed as `.st`. Subject-`%` reads `associated` from its own slot to identify the target stream; coordinating stdlib code then walks the target stream's `subscribers` list and fires each callback synchronously with the broadcast value. `.close()` on the subject follows the same path -- read `associated`, then flip the target stream's `closed` flag and drain its `subscribers` list via §6.1.5's read-modify-write idiom. Stream-side operations (`~<`, `~map`, `~<*`, `.closed()`) touch the stream's own slot directly: chain operators append their subscriber callback to `subscribers`, `.closed()` projects the `closed` flag. The subject → stream reference lives one-way in the subject's slot only; the stream carries no reverse pointer to its subject, matching the "stream is separable from its subject (but not vice versa)" invariant. Downstream composed streams each hold their own slot; close-propagation from source to derived stream is implemented as an entry in the source's `subscribers` list that, when fired at source-close, flips the derived stream's `closed` flag and cascades onward.

#### §6.10.2 Closing

A stream is closed via `.close()` on the subject:

```java
def subj: PushStream.subj@;

subj.close();       // Right{true}

subj.close();       // Left{"PushStream Closed"}

subj.st.closed();               // Promise{Right{empty}}
subj.st.closed().resolved();    // true
```

Close capability lives on the subject; the observation of closed state lives on the stream. This matches the capability separation established in §6.10.1: subject-holders control the lifetime of the stream; stream-holders (pure observers) inspect it but cannot terminate it.

Closing is a one-time state transition:

- The first invocation of `.close()` returns `Right@ true`.
- Subsequent invocations return `Left@ "PushStream Closed"`.

Once closed:

- Any subsequent `subj% v` returns `Promise@ Left@ "PushStream Closed"` without broadcasting.
- Downstream composed streams close as the close signal propagates. `.closed()` on any downstream observer resolves to `Right@ empty` (or reports resolved via `.resolved()`).
- No further values propagate through the closed stream or its downstream chain.

Close propagates downstream, not upstream: closing a downstream observer does not close its source. The subject that owns the source retains control over the lifetime of the propagation chain rooted at it.

**NOTE:** Closing a stream releases stdlib-side memory associated with its subscriber registrations and downstream chain. Long-lived streams should be closed when no longer needed to avoid retention of subscribers.

#### §6.10.3 Subscription Via `~<*`

`PushStream ~<*` is the composition-form operator for push streams. The block-defs clause (per §16 grammar) binds each value broadcast from the source stream, and the block body executes per value received:

```java
def subj: PushStream.subj@;

def doubled: subj.st ~map (v) { v * 2 };

def done: PushStream ~<* (v:: doubled) {
    log(`"Doubled: `v`");
};
// Promise{..pending..}

subj% 1;    // Doubled: 2

subj% 2;    // Doubled: 4

subj.close();

done;       // Promise{Left{"PushStream Closed"}}
```

Semantically, `PushStream ~<*` registers the block body as a subscriber to the source stream:

- `(v:: subj.st)` in the block-defs clause identifies the source stream and binds `v` to each value received from it.
- Body statements run for side effects on each value received.
- The block's terminal expression is discarded except as an early-exit signal (see below).
- Multiple `PushStream ~<*` subscriptions on the same source each independently receive every value (broadcast).
- The `~<*` expression evaluates to a `Promise`. It resolves to `Promise{Left{"PushStream Closed"}}` when the source stream closes, or `Promise{Left{payload}}` when the block body signals early unsubscribe via a terminal `Left@ payload`.

`~<` on `PushStream` is monadic bind under observation semantics: for each value broadcast by the source, the chained function is invoked to produce an inner `PushStream`; the derived stream subscribes to that inner and forwards any values the inner emits. Subscription is idempotent (§6.10 opener): re-subscribing an already-subscribed (derived, inner) pair is a no-op. The derived stream does not drive the inner's emissions -- values flow through the derived only when the inner is driven by its own producer (a subject-holder broadcasting elsewhere). The derived stream closes when the source closes and every subscribed inner has closed.

As a consequence of subscription idempotency, composition patterns that would multiply subscriptions under a naïve counting model (e.g., `sourceSt ~< { sharedInnerSt }` with repeated source deliveries) instead maintain a single subscription per pair. The example in the next NOTE illustrates.

**NOTE:** The `PushStream~<*` hook is self-hosted stdlib code, not runtime-privileged. Its implementation shape: a `defn PushStream~<*(comp, ty)` declaration (§3.1.1.3) that establishes an inner `Effect.Host.Do ~<*` scope (prefix-catching `Effect.Host.Do.Bind` and `Effect.Host.Do.Map` per §6.1.4) over `comp` (§6.3), wraps the source via `PushStream.takeUntil@` (§6.10.4) with an internal signal subject to bound observation, subscribes a `~map` observer running each `Effect.Host.Do.Bind` dispatch's `ret` on the payload (accessed as `#.value` per §6.3.2), wires `.closed()` (§6.10.2) on the source through `~map` to resolve the completion Promise on natural close, and fires the signal subject on `Done@`-arm dispatch to trigger early unsubscribe. The Promise-returning `.closed()` API and the `PushStream.takeUntil@` combinator together supply the close-detection and unsubscribe surface the hook needs; no runtime primitive beyond `Effect ~<*` is required.

To illustrate observation-only composition, consider a shared external inner:

```java
def su1: PushStream.subj@;
def su2: PushStream.subj@;

def derived: su1.st ~< { su2.st };

PushStream ~<* (v:: derived) {
    log(`"derived: `v`");
};

su2% 10;
// (nothing -- derived isn't subscribed to su2.st yet)

su1% "a";
// (nothing observable downstream; derived now subscribed to su2.st)

su2% 20;
// derived: 20
// (su2 broadcasts 20; single subscription forwards to derived)

su1% "b";
// (idempotent no-op; already subscribed)

su2% 30;
// derived: 30
```

The first `su2% 10` broadcasts before any subscription exists on `su2.st`, so it is lost (no-replay). The first `su1% "a"` triggers the `~<` block once, which returns `su2.st`, subscribing the derived. The second `su2% 20` broadcasts `20`, which the single subscription forwards. The second `su1% "b"` re-attempts subscription to `su2.st` -- idempotent no-op. The third `su2% 30` still has a single subscription, so `30` forwards once, not twice.

`~<` and `~map` remain first-class chain operators and may be used directly for single-step subscription-with-transform:

```java
subj.st ~map (v) {
    v * 2;
};
```

**NOTE:** A `~<*` block whose terminal expression evaluates to `Left@ payload` unsubscribes *this observer* from the source stream and resolves the observer's completion Promise to `Promise{Left{payload}}`. The source stream and other subscribers are unaffected; only this block stops receiving values. Source-side termination varies per LHS type: `Channel ~<*` (§6.9.4) resolves on channel close; `PushStream ~<*` (this section) resolves on source close; effect-handler `~<*` (§6.3) terminates on handler-scope end (see §6.3 for its resolution shape).

**NOTE:** `~<*` LHS shapes under the composition axis (§6 opener). Three shapes participate: an effect-kinded LHS (`Effect.<...>`) establishes a handler scope (§6.3); a `Channel` LHS observes each successful take until the channel closes (§6.9.4); a `PushStream` LHS (this section) subscribes to a producer-broadcast source. All three share the "block body runs per external emission" pattern; they differ in what constitutes an emission, what triggers each emission, and what terminates the composition. Source-side termination varies per LHS (effect-scope end, channel close, stream close); a `Left@ ...` block-terminal unsubscribes the observer only on `PushStream ~<*`. Consumer-driven drainage lives on `~<<` (Iter §6.5.3, List §7.2, PullStream §6.11), not `~<*`.

**NOTE:** The `PushStream~<*` hook is self-hosted stdlib code, not runtime-privileged. Its implementation shape: a `defn PushStream~<*(comp, ty)` declaration (§3.1.1.3) that establishes an inner `Effect.Host.Do.<Bind, Map> ~<*` scope over `comp` (§6.3), wraps the source via `PushStream.takeUntil@` (§6.10.4) with an internal signal subject to bound observation, subscribes a `~map` observer running each `Effect.Host.Do.Bind` dispatch's `ret` on the payload, wires `.closed()` (§6.10.2) on the source through `~map` to resolve the completion Promise on natural close, and fires the signal subject on `Done@`-arm dispatch to trigger early unsubscribe. The Promise-returning `.closed()` API and the `PushStream.takeUntil@` combinator together supply the close-detection and unsubscribe surface the hook needs; no runtime primitive beyond `Effect ~<*` is required.

#### §6.10.4 PushStream Combinators

Four named constructors on the `PushStream` namespace provide the core primitives that operators alone cannot express. Each `@`-marked constructor takes a single tuple argument (per the unary-`@` convention); multi-material constructions express positional roles through the tuple shape. These four are the substrate for building richer reactive patterns (higher-order combinators, cancellation, composition strategies) in userspace.

Each combinator subscribes to its source stream(s) and produces a derived stream; per §6.10.3, subscription is observation, not driving. Values flow through the derived stream when the sources are driven by their own subject-holders (via `subj% v` on the underlying subjects, per §6.10.1).

**`PushStream.merge@ < ...sts >`** fans in a list of source streams into a single derived stream:

```java
def su1: PushStream.subj@;
def su2: PushStream.subj@;

def merged: PushStream.merge@ < su1.st, su2.st >;

PushStream ~<* (v:: merged) {
    log(`"merged: `v`");
};

su1% 1;    // merged: 1
su2% 10;   // merged: 10
su1% 2;    // merged: 2
```

The derived stream emits every value emitted by any source, in the order they arrive across sources; ordering across sources reflects arrival order. The derived stream closes once every source stream has closed.

**NOTE:** Per §6.10's idempotent-subscription commitment, listing the same source stream more than once in a `merge@` tuple is not an error but does not multiply delivery. The derived stream holds one subscription per distinct source; a source that appears twice in the input tuple contributes its emissions once.

**`PushStream.filter@ < sourceSt, pred >`** returns a derived stream that emits only source values passing a predicate:

```java
def subj: PushStream.subj@;

def evens: PushStream.filter@ <
    subj.st,
    (defn(v) ^(mod(v, 2) ?= 0))
>;

PushStream ~<* (v:: evens) {
    log(`"even: `v`");
};

subj% 1;    // (nothing)
subj% 2;    // even: 2
subj% 3;    // (nothing)
subj% 4;    // even: 4
```

`pred` is applied to each source emission; only values for which `pred(v)` returns truthy are forwarded. The derived stream closes when the source closes.

**`PushStream.scan@ < sourceSt, init, fn >`** returns a derived stream that emits accumulated values from a stateful fold across source emissions:

```java
def subj: PushStream.subj@;

def totals: PushStream.scan@ <
    subj.st,
    0,
    (defn(acc, v) ^(acc + v))
>;

PushStream ~<* (t:: totals) {
    log(`"total: `t`");
};

subj% 1;    // total: 1
subj% 2;    // total: 3
subj% 3;    // total: 6
```

`fn(acc, v)` is applied with the current accumulator and each source emission; its return value becomes both the new accumulator and the derived stream's emitted value. `init` is the initial accumulator; the derived stream does not emit `init` itself -- it emits the first result of `fn(init, v0)` when the first source value arrives. The derived stream closes when the source closes.

**`PushStream.takeUntil@ < sourceSt, signalSt >`** returns a derived stream that forwards from `sourceSt` and closes when `signalSt` emits its first value:

```java
def subj: PushStream.subj@;
def stop: PushStream.subj@;

def bounded: PushStream.takeUntil@ < subj.st, stop.st >;

PushStream ~<* (v:: bounded) {
    log(`"bounded: `v`");
};

subj% 1;      // bounded: 1
subj% 2;      // bounded: 2
stop% true;   // (bounded closes)
subj% 3;      // (nothing -- bounded is closed)
```

The signal stream's emitted value is not itself forwarded; only its arrival triggers the close of the derived stream. If either the source or signal closes without the signal ever emitting, the derived stream closes at that point.

**NOTE:** These four combinators are the atomic primitives Foi commits to on the `PushStream` namespace. Higher-order patterns familiar from reactive-programming literature -- latest-wins flatmap (`switchMap`), sequential flatmap (`concatMap`), coordinated latest values across sources (`combineLatest`), event debouncing, throttling, distinct-value filtering, and so on -- are userspace compositions of these four combinators, the `~<` / `~map` / `~<*` operators, and (for time-based patterns) IO primitives (§6.12). Foi does not commit to those higher-order patterns in spec; libraries provide them.

### §6.11 PullStream

A **PullStream** is a monadic *cold observable*: nothing runs until a consumer subscribes via `~<<`, and each subscribe triggers an independent run of the pipeline. A `PullStream` sits over a `PullStream.Buffer` filled by an independently-timed external producer; values propagate downstream only under consumer drive at the tail of the composition chain. Between the writer and the reader sits the opaque `PullStream.Buffer`: bounded, policy-governed, stdlib-mediated.

A stream is either **open** (accepting pulls and delivering values) or **closed** (no further values propagate). Close is stdlib-privileged: the writer signals end-of-values on the buffer, and the runtime propagates termination through any composed observer.

**NOTE:** `PullStream` is monadic in the sense of the observable monad in reactive-programming literature. `~<` and `~map` compose over it (§6.11.2); `PullStream.merge@` / `.filter@` / `.scan@` / `.takeUntil@` provide structural combinators (§6.11.4). Monad laws hold under observable-behavior equivalence with respect to a fixed drive schedule: from any subscriber's viewpoint under a fixed sequence of pulls at the terminus, `stFromOneValueBuffer ~< f` and `f v` produce streams indistinguishable in their emission sequence and close timing. This mirrors `PushStream`'s equivalence weakening.

**NOTE:** `PullStream` differs from `PushStream` in three concrete ways beyond the shared observable-monad shape:

- **Cold, not hot.** `PushStream` runs whether or not anyone is subscribed -- producers broadcast, subscribers see what arrives while they're listening. `PullStream` runs only when a consumer subscribes and drives. Between subscribe cycles the pipeline is inert.
- **No subject.** `PullStream` has no capability-separated subject counterpart. The write side of the bridge is stdlib-privileged (stdlib functions accept a `PullStream.Buffer` argument); there is no userland-visible write handle. The `PullStream` reader value is the only userland representation.
- **Single subscribe per cycle.** A `PullStream` supports one active subscribe at a time -- one `~<<` driving one pipeline rooted at the buffer. Binding `~<<` to a tail transitions the underlying buffer to an in-use state (`ready()` returns `false`); a second `~<<` bound to any reader rooted at the same buffer raises an immediate runtime error at the binding site. A fresh cycle over the same buffer is obtained by recycling once the current cycle closes (§6.11.5).

The userland surface is:

- `PullStream.withBuffer@ < capacity, overflow >`: fresh construction; returns a `< st, buf >` tuple pairing a `PullStream` reader with a fresh `PullStream.Buffer` handle (§6.11.1).
- `PullStream.withBuffer@ < buf >`: recycle construction; vends a fresh `PullStream` reader over a previously-used, closed `PullStream.Buffer` handle (§6.11.1). Runtime error if the buffer is not in a ready state.
- `buf.ready()`: pure predicate on a `PullStream.Buffer`; returns `true` when the buffer is available for use, `false` while it is actively in use (§6.11.1). Sole userland method on the buffer handle.
- `~<` / `~map`: single-step chain operators. Each describes a transformation applied to values pulled through the chain; each produces a derived `PullStream` inheriting pulls from its source when a `~<<` at the tail subscribes (§6.11.2).
- `~<<`: subscribe-and-drive do-loop; triggers the pipeline to start pulling and runs the block body per delivered value. Resolves to `Promise{Left{"PullStream Closed"}}` on natural exhaustion, or `Promise{Left{payload}}` / `Promise{Right{payload}}` on early exit via `Left@ payload` / `Done@ payload` (§6.11.3).
- `PullStream.merge@` / `.filter@` / `.scan@` / `.takeUntil@`: derived-stream constructors for fan-in, predicate filtering, stateful fold, and signal-driven close (§6.11.4).

#### §6.11.1 Buffer Construction and Introspection

A `PullStream.Buffer` is the opaque handle sitting between an external producer and a `PullStream` reader. Buffers are constructed via `PullStream.withBuffer@`, which comes in two forms.

**Fresh construction:**

```java
def <st, buf>: PullStream.withBuffer@ <
    capacity: 128,
    overflow: PullStream.DROP_OLDEST
>;
```

The tuple return destructures into the reader (`st`, a `PullStream`) and the buffer handle (`buf`, a `PullStream.Buffer`). The consumer holds `st` and subscribes via `~<<`; the handle `buf` is passed to a stdlib I/O function that fills it (§6.11.5).

`capacity` is the maximum count of buffered values held between writer and reader.

`overflow` is one of three named policies governing behavior when the writer attempts to enqueue into a full buffer:

- **`PullStream.DROP_OLDEST`**: the eldest buffered value is discarded to make room for the new arrival.
- **`PullStream.DROP_NEWEST`**: the incoming value is discarded; existing buffered values are unchanged.
- **`PullStream.ERROR_ON_OVERFLOW`**: the write fails and the writer surfaces the failure through its own error-return path (see §6.11.5 for how stdlib functions expose this).

**Recycle construction:**

```java
def <st, buf>: PullStream.withBuffer@ < buf: prevBuf >;
```

An existing buffer that is in a ready state is passed as the `buf` argument; a fresh `PullStream` reader is vended over it, and the same handle is returned. Runtime error if `prevBuf` is not ready at the call site. Capacity and overflow policy are preserved from the buffer's original fresh construction; they are not overridable at recycle time.

**Introspection:**

```java
buf.ready();
```

Returns `true` if `buf` is available for use: either freshly constructed and not yet handed to a producer or consumer, or previously used and subsequently closed. Returns `false` while `buf` is actively in use -- either a producer is filling it, or a `~<<` is subscribed to a reader rooted at it, or both. `ready()` is a pure query on buffer state; it carries no effect signature. It is the sole userland method on `PullStream.Buffer`.

**NOTE:** The `withBuffer@ < buf: ... >` call is the authoritative check for buffer readiness; if `ready()` returned `true` at some prior instant but a stdlib function or a `~<<` binding has since re-taken the buffer, `withBuffer@` will still runtime-error at the recycle site. Users relying on `ready()` for coordination should treat it as a hint, not a lock; the `withBuffer@` error path is the enforceable check.

**NOTE:** Per-instance slot representation (§6.1.5). A `PullStream.Buffer` instance's slot holds `< state, capacity, overflow, queued, waiters >`: the current buffer state (`Fresh`, `InUse`, or `Closed` per §6.11.5), the construction-time `capacity` and `overflow` policy, the current `queued` values list awaiting a reader, and the `waiters` list of parked reader callbacks (see §6.11.3). A `PullStream` reader instance's slot holds `< source >`: an indirect reference to its immediate source -- the paired `PullStream.Buffer` for a root reader, or the upstream derived-`PullStream` for a stream produced by `~<` / `~map` / combinator. Each `~<<` subscription walks the stream's `source` chain to reach the root buffer, transitions the buffer's `state` to `InUse` via §6.1.5's read-modify-write idiom, and drives pulls through the chain; each intermediate stream reads its own `source` slot to forward the pull upstream. Combinator-derived streams (`merge@`, `filter@`, `scan@`, `takeUntil@`) may hold multiple `source` entries in their slot -- one per upstream stream contributing to the composition. Close-propagation from buffer to the entire reader chain is implemented by the same close-signal that transitions the buffer's `state` to `Closed` also resolving the subscribed `~<<`'s completion Promise (see §6.11.3), cascading through derived observers that had chained off the same buffer. The buffer → reader reference lives one-way in the reader's slot only; the buffer carries no reverse pointer to any reader chain rooted on it, matching PullStream's "no user-visible subject" invariant -- the buffer is the write-side handle, structurally analogous to a subject, but without the direct-broadcast semantic.

#### §6.11.2 Chain Composition Via `~<` / `~map`

`~<` and `~map` are single-step chain operators on `PullStream`. Each describes a transformation applied to values pulled through the chain; each produces a derived `PullStream` inheriting pulls from its source.

```java
def <src, buf>: PullStream.withBuffer@ <
    capacity: 16,
    overflow: PullStream.DROP_OLDEST
>;

def doubled: src ~map (v) { v * 2; };
// PullStream{}

def announced: doubled ~map (v) {
    log(`"doubled: `v`");
    v;
};
// PullStream{}
```

`~map` on `PullStream` is transformation: for each value pulled through the derived stream, the function is invoked and its return value delivered onward through the chain.

`~<` on `PullStream` is monadic bind with `concatMap` semantics on cold sources: for each value pulled from the source, the chained function is invoked to produce an inner `PullStream`; the outer `~<<` subscribes to the inner, drains its values in order, then moves to the next outer value. Because `PullStream` is cold, each inner subscription triggers that inner's own producer independently per outer value. The derived stream closes when the source closes and the final inner has closed.

**NOTE:** `~<` on `PullStream` corresponds to `concatMap` on cold sources in reactive-programming literature: subscribe to each inner in turn, drain it, move to the next outer value. Other flatmap variants from that literature (`mergeMap`, `switchMap`, `exhaustMap`) are userspace compositions of `~<` alongside the combinators (§6.11.4) and driver primitives (`IO`, §6.12).

**Constructing a chain does not run it.** Derived `PullStream`s are inert descriptions of what will happen when a `~<<` at the tail of the chain subscribes and starts pulling. Deriving a stream and never binding it to `~<<` is legal but pointless -- the chain never runs.

#### §6.11.3 Consumption Via `~<<`

A `PullStream` composition chain is consumed by binding its tail as the LHS of a `~<<` do-loop. `~<<` binding is **subscribe**: it triggers the pipeline to start pulling and runs the block body per delivered value, driven to completion.

```java
def <st, buf>: PullStream.withBuffer@ <
    capacity: 16,
    overflow: PullStream.DROP_OLDEST
>;

File.readLines@ < path: "/tmp/log", :buf >;
// stdlib begins filling buf independently; the call
// returns a completion signal for the read as a whole

PullStream ~<< (line:: st) {
    log(`"line: `line`");
};
// loop iterates as values are pulled from buf; terminates when
// the writer signals close on buf
```

**NOTE:** `PullStream ~<<` resolves to a `Promise` because pull suspension across buffer arrivals is async; contrast with `Iter ~<<` (§6.5.3), which returns the `Left@ terminal` value synchronously since Iter stepping is synchronous.

Semantics:

- `(line:: st)` binds each value pulled through the chain as `line`. The block body runs once per delivered value.
- Each iteration pulls one value from the underlying buffer, walks it forward through every `~<` / `~map` / combinator transformation on the way down, and delivers the final result to the block body. When the buffer is empty but not closed, the loop suspends awaiting the next arrival.
- The loop terminates when the writer signals close on the buffer. Because close purges any residual buffered-but-unread values (§6.11.5), close-signal and drain-completion coincide from the reader's perspective: there is no "drain remaining after close" phase.
- The `~<<` expression evaluates to a `Promise`. It resolves to `Promise{Left{"PullStream Closed"}}` when the buffer signals close (natural exhaustion), `Promise{Left{payload}}` when the block body signals a terminal `Left@ payload` early exit, or `Promise{Right{payload}}` when the block signals `Done@ payload` early exit (§7.9). The block's terminal expression is otherwise discarded.

**Subscribing to any tail.** `~<<` may bind the root reader (as above) or any derived stream produced by `~<`, `~map`, or a combinator. Whichever tail is bound is what the block sees; the chain leading to that tail is the transformation the consumer receives:

```java
def <src, buf>: PullStream.withBuffer@ <
    capacity: 16,
    overflow: PullStream.DROP_OLDEST
>;

def doubled: src ~map (v) { v * 2; };

File.readInts@ < path: "/tmp/nums", :buf >;

PullStream ~<< (n:: doubled) {
    log(`"doubled: `n`");
};
// each iteration:
//   1. pulls one int from buf
//   2. runs `~map` transformation (v * 2)
//   3. delivers to block as `n`
```

**NOTE:** Suspension of `~<<` when the buffer is empty but not closed is handled through the buffer's per-instance `waiters` slot content (§6.1.5, §6.11.1): a subscribed reader that attempts to pull with no queued value available is parked as a callback in `waiters` via §6.1.5's read-modify-write idiom, and the next writer enqueue or close signal reads `waiters` back to resume the earliest parked reader. This is buffer-internal subscriber/waiter-list machinery, not effect-substrate suspension. A `PullStream` `~<<` loop that suspends awaiting a buffer arrival does not block the surrounding thread; asynchrony is surfaced through the completion `Promise` the `~<<` expression evaluates to.

**Single subscribe per cycle.** Every `PullStream` in a composition chain is ultimately rooted at exactly one `PullStream.Buffer` (or, for `merge@`-derived streams, a finite set of buffers). Binding `~<<` to any reader rooted at a buffer transitions that buffer to an in-use state (`ready()` returns `false`). A subsequent `~<<` bound to any reader rooted at the same buffer -- the same reader or any sibling derived from the same source -- raises an immediate runtime error at the binding site, before the loop iterates. The buffer returns to a ready state when the writer signals close (§6.11.5), at which point recycling via `withBuffer@ < buf: ... >` vends a fresh reader for a new cycle.

**Closed means closed.** A `PullStream` value whose `~<<` loop has terminated is permanently closed from userland's view. A subsequent cycle on the same underlying buffer is obtained through a fresh `withBuffer@ < buf: ... >` call, which vends a new `PullStream` value; the prior `PullStream` is not resurrected. The prior chain of derived `~<`/`~map`/combinator streams referred to that closed `PullStream` value and does not carry across to the new cycle; each fresh subscribe cycle requires its own chain construction over the newly-vended reader.

#### §6.11.4 PullStream Combinators

Four named constructors on the `PullStream` namespace provide the core primitives that operators alone cannot express. Each `@`-marked constructor takes a single tuple argument (per the unary-`@` convention); multi-material constructions express positional roles through the tuple shape. These four parallel §6.10.4's constructors on `PushStream` and are the substrate for building richer pull-driven patterns in userspace.

Each combinator subscribes to its source stream(s) and produces a derived `PullStream`; per §6.11.2, values flow through the derived stream when the `~<<` at the tail of the derived's chain subscribes and drives.

**`PullStream.merge@ < ...sts >`** fans in a list of source streams into a single derived stream:

```java
def <sA, bufA>: PullStream.withBuffer@ <
    capacity: 8,
    overflow: PullStream.DROP_OLDEST
>;
def <sB, bufB>: PullStream.withBuffer@ <
    capacity: 8,
    overflow: PullStream.DROP_OLDEST
>;

File.readLines@ < path: "/tmp/a.log", buf: bufA >;
File.readLines@ < path: "/tmp/b.log", buf: bufB >;

def merged: PullStream.merge@ < sA, sB >;

PullStream ~<< (line:: merged) {
    log(`"merged: `line`");
};
```

Each iteration of the subscribed `~<<` pulls one value: if exactly one source buffer has a value available, that value is delivered; if multiple sources have values available, arbitration follows the input list's left-to-right ordering; if no source has a value, the loop suspends until any source delivers. The derived stream closes once every source stream has closed.

**NOTE:** Listing the same source stream more than once in a `merge@` tuple is not an error but does not multiply delivery. The derived stream holds one subscription per distinct source; a source that appears twice in the input tuple contributes its emissions once.

**NOTE:** `merge@` widens the "single subscribe per cycle" invariant (§6.11.3) to accommodate multi-source composition: a chain subscribed via `~<<` on a `merge@`-derived stream may drive multiple upstream buffers (one per distinct source), transitioning all of them to an in-use state atomically. The invariant still holds against each individual buffer: no other `~<<` may subscribe to a chain rooted at any of `merge@`'s sources while the merge subscription is active.

**`PullStream.filter@ < sourceSt, pred >`** returns a derived stream that emits only source values passing a predicate:

```java
def <src, buf>: PullStream.withBuffer@ <
    capacity: 16,
    overflow: PullStream.DROP_OLDEST
>;

def evens: PullStream.filter@ <
    src,
    (defn(v) ^(mod(v, 2) ?= 0))
>;

File.readInts@ < path: "/tmp/nums", :buf >;

PullStream ~<< (n:: evens) {
    log(`"even: `n`");
};
```

`pred` is applied to each source value pulled through the derived; values for which `pred(v)` returns truthy are forwarded, values that fail the predicate are silently dropped. The derived stream closes when the source closes.

**NOTE:** `filter@` does not amortize discarded pulls: a filtered-out value still counts as one pull cycle from the subscribed `~<<`'s perspective. The loop pulls one value from the source, `pred` runs, and if the value is dropped, the loop does not automatically re-pull to satisfy a "one delivery per iteration" contract. Users needing "iterate until N values pass the filter" patterns compose that logic in the `~<<` block body via `Done@` (§7.9).

**`PullStream.scan@ < sourceSt, init, fn >`** returns a derived stream that emits accumulated values from a stateful fold across pulled source values:

```java
def <src, buf>: PullStream.withBuffer@ <
    capacity: 16,
    overflow: PullStream.DROP_OLDEST
>;

def totals: PullStream.scan@ <
    src,
    0,
    (defn(acc, v) ^(acc + v))
>;

File.readInts@ < path: "/tmp/nums", :buf >;

PullStream ~<< (t:: totals) {
    log(`"total: `t`");
};
```

`fn(acc, v)` is applied with the current accumulator and each pulled source value; its return value becomes both the new accumulator and the derived stream's emitted value. `init` is the initial accumulator; the derived stream does not emit `init` itself -- it emits the first result of `fn(init, v0)` when the first source value arrives. The derived stream closes when the source closes.

**`PullStream.takeUntil@ < sourceSt, signalSt >`** returns a derived `PullStream` that forwards from `sourceSt` and closes when `signalSt` emits its first value. `signalSt` may be a `PullStream` or a `PushStream`:

```java
defn dumpFile(path, stopSt) {
    def <src, srcBuf>: PullStream.withBuffer@ <
        capacity: 16,
        overflow: PullStream.DROP_OLDEST
    >;

    File.readLines@ < :path, buf: srcBuf >;

    def bounded: PullStream.takeUntil@ < src, stopSt >;

    ^PullStream ~<< (line:: bounded) {
        log(`"line: `line`");
    };
};

def stopSubj: PushStream.subj@;

Effect.Sys.SIGINT ~<* (eff:: dumpFile("/tmp/log", stopSubj.st)) {
    ?(eff){
        [?as Effect.Sys.SIGINT]: stopSubj% true;
    }
};
```

**NOTE:** `Effect.Sys.SIGINT` is how to observe the process-level `SIGINT` (stdio interrupt signal). See §6.13.6 for the broader `Sys.*` namespace-expansion register.

The signal stream's emitted value is not itself forwarded; only its arrival triggers the close of the derived stream. If either the source or signal closes without the signal ever emitting, the derived stream closes at that point.

**NOTE:** `takeUntil@` observes the signal stream via a stdlib-internal single-take, applicable uniformly across `PullStream` and `PushStream` signal sources. Users do not need to bind a separate observer (`~<<` for pull, `~<*` for push) to `signalSt`; the combinator handles signal observation internally. Consequently, when `signalSt` is a `PullStream`, the "single subscribe per cycle" invariant (§6.11.3) applies to its underlying buffer -- no user-side `~<<` may bind a reader rooted at that buffer while `takeUntil@` is active.

**NOTE:** These four combinators are the atomic primitives Foi commits to on the `PullStream` namespace. Higher-order patterns (buffering with time windows, deduplication, backpressure-aware throttling, etc.) are userspace compositions of these four combinators, the `~<` / `~map` / `~<<` operators, and (for time-based patterns) IO primitives (§6.12).

#### §6.11.5 Buffer Lifecycle and Stdlib I/O Patterns

Buffer writes, close signaling, and cross-cycle reset are exclusively stdlib-privileged. Userland receives a buffer handle from `withBuffer@`, passes it to a stdlib function, and subscribes to the resulting read stream via `~<<`. The writer side of the bridge has no user-facing API.

**Buffer state machine:**

- **Fresh**: just constructed via `withBuffer@ < capacity, overflow >`; no producer or consumer has taken it. `ready()` returns `true`.
- **In use**: a producer is filling the buffer, or a `~<<` is subscribed to a reader rooted at it, or both. `ready()` returns `false`.
- **Closed**: the producer has signaled end-of-values. The buffer purges any residual buffered values and transitions back to a ready state. `ready()` returns `true`; the buffer may be recycled via `withBuffer@ < buf: ... >`.

Close is destructive: the producer signaling close discards any buffered-but-unread values. This is the semantic that lets close and drain-completion coincide from the reader's perspective; the reader does not observe a "drain remaining" phase after close. Producers that need "no more writes but drain what's buffered" semantics must enqueue their final values before signaling close; the runtime does not provide a two-phase close on the buffer surface.

**Stdlib I/O overloading (non-normative).** Stdlib functions that produce value sequences typically overload on buffer presence:

- **Buffered form** (`File.readLines@ < path, buf >`) routes the read into `buf` and returns a completion signal (a `Promise` or `IO`) for the read as a whole. The consumer observes values through the `PullStream` vended alongside `buf`.
- **Firehose form** (`File.readLines@ < path >`) returns a bare `PushStream` value. The consumer observes via `PushStream ~<*` (§6.10.3). The producer is stdlib-internal; no subject handle is vended to userland, and no `%` or `.close()` capability is exposed. Stream termination on producer completion cascades through the runtime's subscription lifecycle in the usual way.

**NOTE:** A stdlib-vended `PushStream` returned from a firehose call is a `PushStream` value like any other from userland's perspective; it composes with `~<*`, `~<`, `~map`, and the `PushStream` combinators normally. The distinction between "userland-produced via `PushStream.subj@`" and "stdlib-vended" is not a type-level distinction; it is a lifecycle distinction. Users receive the `.st`-side of the capability split without the `subj` counterpart, which is functionally equivalent to receiving `.st` from a subject whose write capability has been retained elsewhere.

**Push→Pull bridging.** A `PullStream.Buffer` and a `PushStream` are composed only through stdlib functions that accept both as arguments. Users cannot subscribe a buffer to a push stream directly at the userland surface. The bridge is stdlib-privileged because the resource-lifetime and backpressure-signaling concerns of the coupling are stdlib-internal machinery. The userland API for consumer-timed buffered reads is `withBuffer@` plus `~<<`, and the subset of stdlib functions that accept the buffer argument handle the producer wiring.

Backpressure at the userland level is not surfaced beyond the overflow policy: `PullStream.ERROR_ON_OVERFLOW` on a full buffer causes the writing stdlib function to fail its completion signal (typically as `Left@ "Buffer Full"` on the returned `Promise` or `IO`). `PullStream.DROP_OLDEST` and `PullStream.DROP_NEWEST` do not surface backpressure at all; values are silently discarded per policy. Users needing finer-grained backpressure coordination compose it at the stdlib-function level, not through the buffer directly.

### §6.12 IO

An **IO** is a deferred computation that represents a side-effecting action -- printing, network access, file access, timers, random numbers, or any other action whose result is not solely determined by its inputs. No code runs at construction; execution is triggered by applying `%` to the IO instance.

`IO` composes four concerns into a single monadic type:

- **Task**: the deferred side-effect execution itself. An `IO` instance holds an executor function that runs when `%` is applied.
- **Reader**: an environment value threaded implicitly through the chain of composed IOs. The environment is supplied at `%`-application time and delivered to each composed executor.
- **Promise Transformer**: when an IO's execution encounters a `Promise` instance mid-chain, the surrounding IO evaluation lifts into `Promise` space (§6.8). `Channel`, `PushStream`, and `PullStream` compose with `IO` indirectly through this transformer: each type's coordinating operations (`ch.put` / `ch.take`, `subj% v` / `subj.close()`, `PushStream ~<*` / `PullStream ~<<` completions) return `Promise` instances, which thread through the transformer in the ordinary way. There is no separate Channel or stream transformer.
- **Using Transformer**: an IO constructed over a `Using` pair -- an acquire IO and a release function -- scopes the acquired resource to the continuation the IO is bound into. The acquire runs when the IO is evaluated; the release runs once that continuation has finished, on both settlement branches when the continuation lifted into `Promise` space (§6.12.6).

The userland surface is:

- `IO@`: unit constructor over an executor function.
- `IO.of@`: named unit constructor over a bare value (equivalent to `IO@ (defn() ^value)`).
- Unary `%`: runs the executor with no Reader environment.
- Binary `%`: runs the executor with the supplied Reader environment.
- `~<<` do-block composition: sequences IO operations, threading the Reader environment through each step, per §3.10.9.4 do-block-compilation split.
- `IO.ask@` / `IO.asks@`: named constructors exposing the Reader environment as a bindable value (§6.12.4).
- `IO.mapEnv@` / `IO.withEnv@` / `IO.updateEnv@`: sub-context constructors that run a sub-IO under a derived environment (§6.12.4).
- `IO.using@`: named constructor over a `Using` pair, scoping an acquired resource to the continuation the IO is bound into (§6.12.6).

#### §6.12.1 IO Unit Constructors

An `IO` instance is constructed by applying `IO@` to an executor function:

```java
def task: IO@ (defn(env) {
    log(`"env.x: `env.x`");
});
```

The executor takes an optional Reader environment as its parameter and performs whatever side-effecting work the IO represents. Wrapping does not execute the executor; it produces a deferred `IO` instance whose evaluation is triggered later by `%` (§6.12.2).

The named `IO.of@` constructor wraps a bare value, sparing the caller from writing a trivial executor:

```java
def n: IO.of@ 42;           // aka: IO@ (defn() ^42)
```

`IO.of@ v` produces an IO whose evaluation yields `v`; the executor receives (and ignores) any Reader environment supplied at `%`-time.

#### §6.12.2 Applying IO Via `%`

An `IO` instance is executed by applying `%`:

```java
def task: IO@ (defn() {
    log("Running the effect!");
    ^42;
});

task%;
// Running the effect!
// 42  <-- expression result itself
```

The unary form `task%` runs the executor with no Reader environment. The executor's return value is the result of the `%` expression; any side effects declared in the executor run during evaluation.

The binary form `task% env` supplies a Reader environment, which is passed as the executor's first argument:

```java
def task: IO@ (defn(env) {
    log(`"env.x: `env.x`");
    ^env.x * 2;
});

task% < x: 21 >;    // 42
// env.x: 21
```

`%` dispatch on an `IO` instance is realized via ordinary `_percent`-hook dispatch (§6.2); the hook is stdlib code that invokes the wrapped executor with the applied environment (or `empty` when unary).

**NOTE:** As with `State`, `%` is *evaluating* the IO, not consuming or mutating it. Each `%` invocation runs the executor fresh:

```java
task% < x: 10 >;
// env.x: 10
// 20

task% < x: 100 >;
// env.x: 100
// 200
```

An IO instance's identity is stable across evaluations; the executor may perform any side effect it declares, but the IO itself is not altered by being run.

**NOTE:** Per-instance slot representation (§6.1.5). An `IO` instance's slot holds `< id, executor >`: an identity minted at construction via `Effect.Host.Counter%`, and the executor function supplied to `IO@`. The instance value itself is bare; all state is slot-resident. `IO?=` compares the minted ids, so identity is by construction rather than by executor shape -- two IOs built from the same executor expression are distinct instances. Composition via `~<` / `~map` constructs a new IO with its own minted id wrapping the composed executor; it does not mutate the source instance's slot, which is what makes repeated `%` evaluation of any instance in a chain well-defined.

**NOTE:** Applying `%` to an IO constructed by `IO.using@` (§6.12.6) acquires the resource without releasing it, since the release is consulted only at `~<`. The `%` hook diagnoses this case rather than failing it; see §6.12.6.

#### §6.12.3 Composition Via `~<<`

Multiple `IO` operations sequence into a larger `IO` computation via the `~<<` do-block form. The composition rule is identical to `State` (§6.7.4): the block is a chain of monadic binds terminated by a map -- lifting a bare value to the do-comprehension's monadic type -- on the final expression:

```java
defn getValue() ^IO@ (defn() ^42);
defn writeValue(v) ^IO@ (defn() {
    log(`"wrote: `v`");
});

def task: IO ~<< {
    def v:: getValue();
    writeValue(v);
    v * 2;
};

task%;    // 84
// wrote: 42
```

Inside the block:

- `def v:: getValue()` binds `v` to the underlying value produced by
  `getValue()` (an `IO` instance) and sequences its executor into the
  chain.
- A bare mid-block statement sequences the IO step and discards its
  produced value. Explicit `$expr;` at this position performs the
  bind non-receivingly -- legal when the step's side effect matters
  even though its produced value is not needed.
- The terminal expression is `~map`-lifted into the ambient `IO`.
  A bare terminal (`v * 2` above) becomes the block's produced value.
- A `$`-prefixed terminal (`$expr`) binds `expr` before the terminal
  map (compiler-synthesized `def _r: Effect.Host.Do.Bind% expr;
  Effect.Host.Do.Map% _r` per §3.10.9.4), avoiding double-wrap when the
  terminal expression is itself already an `IO`.

The Reader environment supplied at `%`-application time is threaded implicitly through every composed step's executor -- each step sees the same environment (see §6.12.4).

Per §3.10.9.4 do-block-compilation split, `IO ~<<` composition compiles via the default route (compile-time expansion to nested `~<` / `~map`).

**Resource-scoped steps.** A step bound from `IO.using@` (§6.12.6) releases its resource when the continuation it was bound into completes. Because the default route expands the block into nested `~<` / `~map`, the continuation of a `def r:: usingIO;` bind is the *entire remainder of the block* -- so the release runs after the last step that could still observe `r`. Nested using-binds therefore release innermost-first, as a consequence of that same nesting rather than of any ordering rule. A using-IO placed in the block's *terminal* position expands to `~map` rather than `~<`, and acquires without releasing (§6.12.6).

#### §6.12.4 Reader Value Access

The Reader environment supplied at `%`-application time is delivered to the executor as its first argument (§6.12.2). Under `~<<` composition, the same environment is threaded through every composed step, giving each executor access to the same environment without needing to pass it explicitly:

```java
defn readX() ^IO@ (defn(env) ^env.x);
defn writeSum(v) ^IO@ (defn(env) {
    log(`"sum: `env.x + v`");
});

def task: IO ~<< {
    def v:: readX();
    writeSum(v);
};

task% < x: 21 >;
// sum: 42
```

Two named constructors expose the Reader environment as a bindable value:

- `IO.ask@`: produces an `IO` whose evaluation yields the Reader environment itself.
- `IO.asks@`: applies a function to the Reader environment and yields the result. Equivalent to `IO.ask@ ~map f`, but constructed as a single named IO instance.

```java
IO.ask@;             // aka: IO@ (defn(env) ^env)
IO.asks@ ((.)|,"x"|);     // aka: IO@ (defn(env) ^env.x)
```

Used inside a `~<<` block:

```java
def task: IO ~<< {
    def env:: IO.ask@;
    def x:: IO.asks@ ((.)|,"x"|);
    log(`"env: `env`, x: `x`");
};

task% < x: 42, y: 100 >;
// env: < x: 42, y: 100 >, x: 42
```

`ask` and `asks` mirror the `get`/`gets` pattern from `State` (§6.7.3): `ask` reads the ambient context wholesale; `asks` reads a projection of it. Neither modifies the environment; the Reader is read-only under IO's semantics.

Within a do-block, `IO.ask@` alone often suffices -- destructuring on the bind captures the projection:

```java
def task: IO ~<< {
    def < :x >:: IO.ask@;
    log(`"x: `x`");
};

task% < x: 42 >;
// x: 42
```

`IO.asks@` earns its distinct role in chain composition (`~<` / `~map` steps outside a do-block) and for constructing reusable projected IOs as first-class values:

```java
def readUserId: IO.asks@ (defn(env) ^env.user.id);

// composed in a chain:
readUserId ~< (id) { logUser(id); };
```

**Block-defs clause shorthand.** The `~<<` do-block form admits a defs-init clause (per §16 grammar) that can bind the Reader environment directly, sparing a `def env:: IO.ask@` line:

```java
def task: IO ~<< (env) {
    log(`"env.x: `env.x`");
};

task% < x: 42 >;
// env.x: 42
```

The block-defs clause combines with other bindings in the usual way:

```java
def n: IO.of@ 21;

def task: IO ~<< (env, v:: n) {
    log(`"v + env.x: `v + env.x`");
};

task% < x: 21 >;
// v + env.x: 42
```

**Sub-context constructors.** The Reader is read-only *within* a chain: no step alters the environment its successors observe. An IO that must run under a different environment therefore starts a **new IO context** rather than mutating the ambient one. Three named constructors build that context. Each takes an environment configurator and produces a **sub-IO transformer** -- a function of shape `(IO) ^IO` -- which, applied to a sub-IO, yields an outer IO that runs the sub-IO under the derived environment. The enclosing chain's own environment is unaffected. A sub-IO constructed by `IO.using@` (§6.12.6) keeps its resource scoping across the derivation: the constructed outer IO carries the sub-IO's release, wrapped so that acquire and release both run under the derived environment, while the enclosing chain's own environment stays unaffected as usual.

- `IO.mapEnv@ fn`: the primitive. Derives the sub-environment by applying `fn` to the ambient environment.
- `IO.withEnv@ newEnv`: replaces the environment wholesale. Equivalent to `IO.mapEnv@ (Function@ newEnv)`.
- `IO.updateEnv@ patchEnv`: merges a patch into the ambient environment via record spread-update. Equivalent to `IO.mapEnv@ (defn(env) ^< &env, &patchEnv >)`.

```java
defn readFlag() ^IO.asks@ ((.)|,"debug"|);

def withDebug: IO.updateEnv@ < debug: true >;

def task: IO ~<< {
    def outer:: readFlag();
    def inner:: withDebug(readFlag());
    def after:: readFlag();
    < :outer, :inner, :after >;
};

task% < debug: false >;
// < outer: false, inner: true, after: false >
```

`inner` observes the patched environment; `after` observes the original, because `withDebug` derived a separate context rather than advancing the chain's own. A configurator built once is reusable across every site that needs the same derivation, which is why the constructors take the configurator first and the sub-IO second.

#### §6.12.5 Promise Transformer

When an `IO`'s evaluation encounters a `Promise` instance mid-chain, the surrounding IO evaluation *lifts* into promise-space. Subsequent steps in the chain sequence over promise resolution, and the `%` application evaluates to a `Promise` instead of a concrete value.

```java
defn getValue() ^Promise.honor@ 42;
defn printValue(v) ^IO@ (defn() {
    log(`"Value: `v`");
});

def task: IO ~<< {
    def v:: getValue();
    ::printValue(v);
};

task%;
// Promise{}
// Value: 42
```

`def v:: getValue()` binds `v` to the `Right` payload of the resolved
promise (per §6.8.3 Either-aware `~<<`); the remaining steps in the
do-block run once the promise resolves. This folds `Promise ~<<`
semantics into the surrounding `IO ~<<` block, and `task%` evaluates
to a pending `Promise` that resolves once all lifted steps complete.

The lift occurs regardless of how the `Promise` is encountered. An `IO` may hold a `Promise`:

```java
defn readValue() ^IO.of@ (Promise.honor@ 42);
defn printValue(v) ^IO@ (defn() {
    log(`"Value: `v`");
});

def task: IO ~<< {
    def v:: readValue();
    ::printValue(v);
};

task%;
// Promise{}
// Value: 42
```

Or a `Promise` may hold an `IO`:

```java
defn readValue() ^Promise.honor@ (IO.of@ 42);
defn printValue(v) ^IO@ (defn() {
    log(`"Value: `v`");
});

def task: IO ~<< {
    def v:: readValue();
    ::printValue(v);
};

task%;
// Promise{}
// Value: 42
```

**NOTE:** Per §6.8's invariant-branch model, the `Right` discriminator on a Promise's payload is not a separate unwrap layer. In the third case above, the transformer sees the Promise's success payload as an `IO` instance directly; the `IO`-to-concrete unwrap proceeds through IO's own transformer semantics, not through a Right-peeling step.

In each case, the surrounding IO evaluation lifts, and the outer `%` yields a `Promise` (§6.8).

`Channel`, `PushStream`, and `PullStream` interact with `IO ~<<` only via their `Promise`-returning operations -- each `put` / `take`, each broadcast, each close, and the completion of a `PushStream ~<*` observation scope or `PullStream ~<<` subscribe cycle. Those promises thread through the Promise transformer above; there is no separate Channel or stream transformer.

#### §6.12.6 Resource Scoping Via `IO.using@`

Some side effects come in pairs: a file that must be closed, a lock that must be released, a connection that must be returned to a pool. `IO.using@` binds the two halves into a single `IO` so that the release is not the call site's obligation to remember.

`IO.using@` is a named constructor over a `Using` record:

```java
deft Using < acquire: IO, release: {(Any) ^IO} >;
```

- `acquire`: an `IO` whose evaluation produces the resource.
- `release`: a function from the acquired resource to an `IO` that disposes of it.

The constructed instance is an ordinary `IO` whose executor *is* the acquire. Evaluating it via `%` runs the acquire under the ambient Reader environment and produces the resource; nothing distinguishes it at the `%` surface (§6.12.2). The release is carried alongside the executor in the instance's slot (§6.1.5) and is consulted only by `~<`.

```java
defn withFile(path) ^(
    IO.using@ <
        acquire: (IO@ (defn(env){
            def fh: File.open@ path;
            log(`"`path` opened");
            ^fh
        })),
        release: (defn(fh) ^IO@ (defn(env){
            fh.close();
            log(`"`path` closed");
        }))
    >
);

def task: IO ~<< {
    def fh:: withFile("/tmp/log.txt");
    def a:: readChunk(fh);
    def b:: readChunk(fh);
    < :a, :b >;
};

task%;
// /tmp/log.txt opened
// /tmp/log.txt closed
// < a: .., b: .. >
```

**Release timing.** The release is tied to the *bind*, not to evaluation. When a using-IO is the LHS of `~<` -- directly, or as a `def r:: ..` bind under `~<<` default-route lowering (§3.10.9.4) -- evaluating the composed IO:

1. runs the acquire under the ambient environment, producing the resource;
2. applies the bind function to that resource and runs the resulting IO, also under the ambient environment;
3. runs `release(resource)` under the ambient environment;
4. produces the continuation's result unchanged. The release IO's own produced value is discarded.

When the continuation's result is a `Promise` (§6.12.5), step 3 defers until that promise settles and runs on **both** branches -- honored and reneged -- with the original settlement reconstructed afterward. A failing continuation still releases; releasing neither converts a renege into an honor nor an honor into a renege.

**Nesting.** Release order follows from bind nesting, not from a separate ordering rule: an inner using-bind's continuation is a subset of the outer one's, so the inner release completes first.

```java
def task: IO ~<< {
    def src:: withFile("/tmp/a.txt");
    def dest:: withFile("/tmp/b.txt");
    def data:: readAll(src);
    $writeAll(dest, data);
};

task%;
// /tmp/a.txt opened
// /tmp/b.txt opened
// /tmp/b.txt closed
// /tmp/a.txt closed
```

**NOTE:** Because the release lives in `~<`, a using-IO that is never bound never releases. `withFile("/tmp/log.txt")%` acquires the file and stops; so does a using-IO in a `~<<` block's terminal position, which lowers to `~map` (§6.12.3). Both are the bracket-with-no-body case -- a resource acquired for a continuation that does not exist.

**Leak diagnosis.** Neither case is silent. `IO%` and `IO~map` test the instance's slot for a release before proceeding, and perform `Effect.Sys.Warn` (§6.13.5) when they find one. The test is sound because composition never routes an IO through those hooks: `~<`, `~map`, and the sub-context constructors (§6.12.4) each read the slot and invoke the executor directly rather than applying `%`. A using-IO reaching `IO%` or `IO~map` therefore reached it without a bind. The acquire still runs and the expression still produces its value; the diagnosis reports the leak without altering the result.

Two consequences of that discipline are worth stating explicitly. Sub-context constructors do not produce the leak at all: they carry a using sub-IO's release onto the IO they construct, wrapped in the same environment derivation (§6.12.4). And two stdlib sites apply `%` to an IO they were handed rather than composed: `IO.using@` evaluates its `acquire` under the ambient environment, and the release path runs `usingRelease(res)% env`. For an ordinary acquire or release this is invisible, since a plain IO carries no release of its own and the test does not fire. For a using-IO supplied in either position it does fire, and correctly -- that inner instance's release is bound to nothing and would otherwise be discarded silently.

**NOTE:** Release covers continuation *completion*, not continuation *abandonment*. If an enclosing handler terminates the computation via `Done@` (§6.4) while a step inside the continuation is suspended at a perform, the bind function never returns and the release never runs.

### §6.13 Effect Signatures

Foi's effect system requires **discipline at the declaration surface**: every non-ambient effect a function might perform must be recorded somewhere the compiler can verify. This section specifies how that recording works: the `:Effects(...)` clause on function types, when declaration is mandatory versus inferred, and how the compiler verifies coverage across a call stack.

The discipline is intentionally light on ceremony. Declaration is required only where effects are first emitted; the compiler tracks their propagation up the call stack silently; a `~<*` handler somewhere before the outermost `%` boundary satisfies coverage.

A companion category -- **ambient effects** -- is exempted from the discipline entirely. A small stdlib-designated set (`Effect.Sys.Log`, `Effect.Sys.Warn`, `Effect.Sys.Random`, `Effect.Sys.CurrentTime`) is handled by a runtime top-level handler; those effects need no signature declaration and no user-side `~<*` coverage. §6.13.5 specifies the ambient category.

#### §6.13.1 The `:Effects(...)` Clause

An effect set is declared on a function type via `:Effects(...)`,
attached to a `deft` function-type expression (§18) between the
parameter list and the return type:

```java
deft AskName(int) :Effects(Effect.User.Ask) ^string;
deft LogTwice(int) :Effects(Effect.Sys.Log) ^empty;
deft Composite(int) :Effects(Effect.User.Ask, Effect.User.Retry) ^bool;
```

Each comma-separated entry names an effect-kind path the function
may perform. The clause **requires at least one entry**; a function
that performs no effects expresses that by omitting the clause
entirely:

```java
deft Pure(int) ^int;    // no effects
```

**Entry normalization.** Each entry is normalized before any other
semantic layer sees it, by a single rule:

> If the entry's leftmost segment is not exactly `Effect`, prefix
> `Effect.` to the entry. Otherwise leave the entry as written.

Normalization is therefore idempotent on already-prefixed entries,
and every one of these spellings reaches `Effect.User.Ask`:

```java
:Effects(Ask)                // -> Effect.Ask       -> Effect.User.Ask
:Effects(User.Ask)           // -> Effect.User.Ask  (no rewrite)
:Effects(Effect.Ask)         // as written          -> Effect.User.Ask
:Effects(Effect.User.Ask)    // as written          (no rewrite)
```

The normalized path then passes through §6.1.4's **Implicit-User
rewrite** in the ordinary way: an entry whose first segment after
`Effect.` is one of the reserved roots (`User`, `Host`, `Sys`)
resolves as written, and any other first segment resolves under
`Effect.User.*`. The two stages compose in that order -- normalize,
then rewrite -- and the pair is total over every admitted entry
spelling.

Entries prefix-match per §6.1.4: `:Effects(Effect.User.IO)` declares
that the function may perform `Effect.User.IO` or any
`Effect.User.IO.*` descendant. To narrow, name more-specific paths:

```java
deft ReadFile(string) :Effects(Effect.User.IO.Read) ^string;
deft Multi(int) :Effects(
    Effect.User.Ask,
    Effect.User.IO.Read,
    Effect.User.MyModule.CustomOp
) ^bool;
```

`:Effects(Effect.User.IO.Read, Effect.User.IO.Write)` declares those
two subtrees without also declaring the rest of `Effect.User.IO.*`.

The `:Effects(...)` clause is admitted on `deft` function-type
expressions only. It is not admitted directly on `defn`. To attach a
declared effect set to a function value, use `:as` with a type that
carries the clause:

```java
deft AskName(int) :Effects(Effect.User.Ask) ^string;

defn askName(id) :as AskName ^Effect.User.Ask% id;
```

#### §6.13.2 Emit-Edge Declaration

A function that **directly performs** a non-ambient effect must include an `:as` type attachment whose `:Effects(...)` list includes that effect. This is the **emit-edge rule**, and it is mandatory: absence of a matching declaration at an emit-edge is a compile error.

"Directly performs" means the function's own body contains a perform site (via `%` on an effect-kinded LHS, per §6.2, or via the `<::` sugar of §6.2.2) for the effect in question. Performs that occur only in callees are not direct; they belong to those callees' emit-edge declarations.

```java
deft AskName(int) :Effects(Effect.User.Ask) ^string;

defn askName(id) :as AskName ^Effect.User.Ask% id;    // legal: emit-edge declared

defn askNameUndeclared(id) ^Effect.User.Ask% id;      // COMPILE ERROR
```

The compile error localizes to the emit-edge function's definition, naming the specific effect kind that lacks declaration.

Over-declaration is legal. A `deft` may declare more effects than the function body actually performs; the extra effects broaden the caller-facing contract without changing behavior:

```java
deft AskAndMaybeRetry(int) :Effects(Effect.User.Ask, Effect.User.Retry) ^string;

defn askOnly(id) :as AskAndMaybeRetry ^Effect.User.Ask% id;   // legal
// Body performs only Ask; Retry is declared but never emitted.
```

This allowance is what admits a declared entry for an effect the function only propagates from a callee; §6.13.3 specifies why such an entry is never *required*.

Under-declaration -- declaring fewer effects than actually emitted -- is not legal.

#### §6.13.3 Propagation and Inference

A function that **only calls other functions** (performs no direct emits, or only ambient ones) does not require a `:Effects(...)` bearing type attachment. The compiler infers its applicable effect set from the union of its callees' declared effects, minus any effects handled by `~<*` scopes lexically enclosing the call sites.

```java
deft AskName(int) :Effects(Effect.User.Ask) ^string;
defn askName(id) :as AskName ^Effect.User.Ask% id;

defn greetUser(id) {    // no :as, no declared effects
    // compiler infers Effect.User.Ask in scope
    def name: askName(id);

    // Log is ambient; no tracking
    log(`"Hello, `name`");

    ^name;
};
```

`greetUser` performs no direct non-ambient emit. Its inferred effect set
includes `Ask` (propagated from `askName`). No emit-edge declaration is
required on `greetUser`; the tracking continues silently up the call
chain.

The `:Effects(...)` clause on a type attached to an effect-bearing function **must** name all of the function's **lexical direct
performs** -- perform sites appearing in its own body via `%` on an
effect-kinded LHS or via the `<::` sugar (§6.2.2). Propagated effects
from callees are never required in the declaration; the compiler tracks
propagation internally per §6.13.4's coverage verification. A function
like `greetUser` above -- calling `askName` but performing no direct
emit itself -- omits the clause entirely, since §6.13.1 requires at
least one entry and the empty set is expressed by absence.

Naming a propagated effect is nonetheless **permitted**, under
§6.13.2's over-declaration allowance: the entry broadens the
caller-facing contract and carries no other semantic weight. What the
emit-edge rule (§6.13.2) pins to direct emit sites is the *obligation*
to declare, not the *permission*. The compiler's check is therefore
one-directional -- every directly-performed effect must appear in the
declared set; the declared set may name more.

This rule follows from a structural fact: dynamic call stack chains --
through higher-order function dispatch, first-class function values
crossing module boundaries, and effect-handler-installed continuations
-- prevent a caller from statically knowing which effects a callee will
perform when the callable is dynamically invoked. Requiring
propagated-effect declaration would break the moment first-class
functions cross module boundaries. Direct performs are known at
authoring time and belong on the declaration; propagation is compiler
machinery, not user declaration burden.

**Higher-order functions.** When a function takes another function as
an argument, the callee's effect surface is known from the callee's
declared type at each call site. No effect-variable syntax is needed in
the higher-order function's signature; the compiler resolves the effect
set per-call-site:

```java
defn retry(fn) ^fn();                // no declared effects

def attempt1: retry(askName);        // resolves with Ask in scope
def attempt2: retry(pureThunk);      // resolves with empty set
```

The two invocations of `retry` induce different inferred effect surfaces
from their surrounding scopes, per the callee passed at each site.
`retry` itself remains undeclared; the effect polymorphism is a
compile-time inference, not a first-class type-language feature.

#### §6.13.4 Coverage Verification

The compiler verifies **coverage** for every non-ambient effect that propagates. For each perform-site in the program, the compiler traces outward through the call stack (statically, using declared effect surface on callee types) and confirms that at least one lexically-enclosing `~<*` handler catches the effect kind before the outermost `%` boundary is reached.

Coverage is **per-call-stack, not per-function**. A given intermediate function need not itself wrap with a handler; the requirement is only that *some* enclosing frame in the propagation path handles every emitted effect:

```java
deft AskName(int) :Effects(Effect.User.Ask) ^string;
defn askName(id) :as AskName ^Effect.User.Ask% id;

def result: (Effect.User.Ask ~<* (eff:: greetUser(42), ret) {
    ?(eff){
        [?as Effect.User.Ask]: ret(`"user-`#.value`");
    };
})%;
```

The `Effect.User.Ask ~<* (eff:: ..., ret) { ... }` handler encloses the
call to `greetUser`, which transitively performs `Effect.User.Ask`.
Coverage is satisfied; the outermost `%` invocation is well-formed.

If no such handler exists on any path from a perform-site to the outermost `%` boundary, the compile error includes the call stack from the perform-site (naming the effect kind) to the outermost `%` invocation, indicating which effect escaped without handling.

Ambient effects are pre-covered by the runtime top-level handler installed at every outermost `%` invocation (§6.13.5); they are excluded from the coverage trace entirely.

`Effect.User.Slot.*` is pre-covered by the same mechanism -- the runtime installs a slot-access handler at every outermost `%` invocation (§6.1.5.2) -- and is likewise excluded from the coverage trace. The two categories differ at declaration, not at coverage: ambients are exempt from the emit-edge rule (§6.13.2), while slot performs must be declared like any other tracked effect.

#### §6.13.5 Ambient Effects

A small built-in set of effect kinds is **ambient**. The ambient
effects are:

- `Effect.Sys.Log`: default handler: stdout write.
- `Effect.Sys.Warn`: default handler: stderr write. Payload is a
  diagnostic message; resume is `empty`. Distinct from `Sys.Log` so
  that diagnostics can be silenced, captured, or escalated
  independently of ordinary program output -- stdlib operations
  perform it to report a misuse the compiler cannot detect
  statically (§6.12.6), and user code may perform it for the same
  purpose at its own API boundaries.
- `Effect.Sys.Random`: default handler: PRNG (seedable at boundary).
- `Effect.Sys.CurrentTime`: default handler: system clock.

Ambient effects are handled by a runtime-installed handler scope
wrapping every outermost `%` invocation. Callers need not declare
ambients in `:Effects(...)`; the emit-edge rule (§6.13.2) does not
apply to them, nor does the coverage requirement (§6.13.4) apply to
them.

A user may shadow the ambient handler for a bounded region by
establishing a `~<*` scope for that effect kind lexically above a
perform site. Standard dynamic lookup (§6.1.2) finds the user's
handler before the outermost handler provided by the runtime,
handling the effect (and stopping propagation):

```java
Effect.Sys.Log ~<* (eff:: doWork(), ret) {
    ?(eff){
        [?as Effect.Sys.Log]: ret(captureForTest(#));
    };
};
```

Inside this scope, `log()` calls (or any direct `Effect.Sys.Log%`
perform) resolve to the user's `captureForTest` arm; outside, they
resolve to the runtime default (stdout).

Declaring an ambient in a `:Effects(...)` clause is legal but
redundant; the compiler neither requires it nor checks against it.
Users who wish to document ambient use explicitly at an API boundary
may do so via the explicit reserved-root path (per §6.13.1's shorthand
rules):

```java
// legal, documentary; no compile effect
deft LogsProgress(int) :Effects(Effect.Sys.Log) ^empty;
```

**NOTE:** The ambient category is deliberately narrow. Effects with
Left-carrying resume (any perform whose value the caller must
inspect), any effect that writes to persistent state, and any effect
that opens network or file resources are outside the ambient category
by design: those effects belong to the tracked discipline where
callers explicitly acknowledge them. The ambient set is fixed by the
runtime; users cannot mark their own effect kinds as ambient.

#### §6.13.6 Open: `Sys.*` Namespace Expansion

Beyond the four ambients committed in §6.13.5 (`Sys.Log`, `Sys.Warn`,
`Sys.Random`, `Sys.CurrentTime`), the `Effect.Sys.*` namespace has
room for additional host-service kinds. This subsection is a
candidate register per §0.3; per-candidate classification (ambient
vs. tracked) and precise payload/resume shapes remain open.

- **`Sys.Sleep%`** -- suspend for a specified duration; resumes
  after elapsed time.
- **`Sys.EnvVar%`** -- read a named environment variable.
- **`Sys.Args%`** -- read process command-line arguments.
- **`Sys.Cwd%`** -- read current working directory.
- **`Sys.Hostname%`** -- read machine hostname.
- **`Sys.Platform%`** -- read OS platform identifier (`"linux"`,
  `"darwin"`, `"win32"`, ...).
- **`Sys.ProcessId%`** -- read current process ID.
- **`Sys.Exit%`** -- terminate the process with a status code
  (no-resume; call site never returns).
- **`Sys.SIGINT%`** -- process-level interrupt (Ctrl-C) delivery;
  caller decides whether to continue. Referenced at §6.11.4.
- **`Sys.Signal.<kind>`** -- broader signal surface (`SIGTERM`,
  `SIGHUP`, `SIGUSR1`/`SIGUSR2`, ...). Open shape question: one
  effect kind with a signal-name payload, or per-signal sub-kinds.
- **`Sys.Clock.Monotonic%`** -- monotonic clock (immune to
  wall-clock adjustments); distinct from ambient `Sys.CurrentTime`.
  Useful for reliable duration measurement.

Out of scope for `Sys.*`: file I/O, network I/O, and any operation
opening persistent or external resources. Those belong to
user-declared effect kinds or dedicated stdlib namespaces, by the
same principle §6.13.5 applies to the ambient category. `Sys.*` is
host-service surface, not application I/O.

### §7 Loops and Comprehensions

The comprehension family -- operators of the form `~<glyph>` -- provides Foi's iteration surface across ordered containers, ranges, and monadic types. Every comprehension operator dispatches via the mechanism specified in §3.10.9: the LHS's owning namespace supplies a hook for the invoked marker; the hook receives the LHS instance as its first argument, and the operand(s) supplied at the call site as subsequent arguments. Declaration syntax for user-defined hooks is specified in §3.1.1.3.

This section specifies the concrete behavior of each comprehension operator when its LHS is a `List` -- Foi's canonical ordered-container type -- along with the imperative loop form (`~each`) and the shared early-exit sentinel (`Done@`).

Coverage of comprehension behavior for pause-able monadic types (Generator §6.6, State §6.7, Promise §6.8, Channel §6.9, PushStream §6.10, PullStream §6.11, IO §6.12) lives in each type's §6 subsection. The `~<<` (do) and `~<*` (looping-do) comprehensions on those types are specified per-type in §6; §7 covers `~<<` on `List` (§7.2) -- the residual arm with ordered-container LHS, applying uniformly to range-literal-produced Lists -- along with `Done@` early-exit integration common to all comprehension consumers (§7.9).

Covered comprehension mechanisms:

- `~each` (§7.1): imperative iteration over an ordered container.
- `~<<` on `List` (§7.2): do-comprehension with `List` as monadic wrapper.
- `~<` (§7.3): flatMap/bind on ordered containers.
- `~map` (§7.4): per-element transform, container-preserving.
- `~filter` (§7.5): predicate selection, container-preserving.
- `~fold` / `~foldR` (§7.6): left/right catamorphic reduction.
- `~cata` (§7.7): thunk-initialed catamorphism.
- `~ap` (§7.8): applicative apply.
- `Done@` (§7.9): early-exit sentinel behavior across comprehensions.

**Conditional LHS is `~each`-only.** The pattern-match conditional LHS form (`?[cond] ~op ...` / `![cond] ~op ...`, §7.1) is admitted at `~each` and at no other comprehension operator. Every other operator in this section requires a value LHS in the invoked marker's namespace. A CondClause LHS at any other comprehension operator is rejected at compile time.

The asymmetry follows from what the operators produce. `~each` drives side effects and returns its range, so a conditional that yields no container is coherent. Every other comprehension derives its result from the LHS's elements; a conditional supplies no elements to derive from.

#### §7.1 `~each`

`~each` is the imperative-iteration comprehension: for each element of the LHS in order, evaluate the iteration operand against that element. The `~each` expression's produced value is not an accumulation of per-iteration results; its purpose is side-effect driving over a bounded sequence.

The general form:

```java
lhs ~each iterOperand;
```

- `lhs` is a `List` instance.
- `iterOperand` is a function value, an inline function definition, or an inline block with block-definitions clause. In each case, the current iteration element is supplied as the single positional argument (or as the implicit input to the block).

```java
0..3 ~each (v) {
    log(`"v: `v`");
};
// v: 0
// v: 1
// v: 2
// v: 3

def xs: < "a", "b", "c" >;
xs ~each log;
// a
// b
// c
```

**Iteration order.** Left-to-right over Tuple index order. `~each` on an empty container performs no iterations. A descending range literal like `5..0` produces a Tuple in that declared order; `~each` iterates left-to-right over it accordingly.

**Conditional range (aka "while-loop" form).** In addition to a container/range LHS, `~each` admits a pattern-match conditional as its LHS: `?[cond] ~each { .. }` or `![cond] ~each { .. }`. The conditional is evaluated before each iteration; `true` proceeds, `false` terminates. This is Foi's imperative while-loop mechanism.

```java
def done: false;

![done] ~each {
    // body -- sets `done := true` eventually
};
```

Early exit via `Done@` still applies (§7.9).

**Iteration-operand shapes.** Consistent with all comprehensions (§3.10.9.2), the operand shape for `~each` is a single-parameter callable:

```java
0..3 ~each log;                         // function value
0..3 ~each { log("Hello!"); };          // bare block, no per-iter
0..3 ~each (v) { log(v); };             // block-defs clause
pairs ~each (<:k, :v>) { log(k, v); };  // destructure block-defs
```

**Produced value.** The `~each` expression evaluates to the LHS range itself, enabling chaining: `a ~each b ~each c` loops `b` over `a`, then loops `c` over `a`. For the conditional-range form (above), the produced value is an empty Tuple `<>`.

**Early exit.** Returning a `Done@`-shaped value from the iteration operand terminates the loop before natural completion. For `~each`, the payload of `Done@` is discarded (there is no accumulated result to return); the loop simply stops. See §7.9 for `Done@`'s uniform behavior across comprehensions.

```java
0..10 ~each (v) {
    log(`"v: `v`");
    ?[v ?> 3]: Done@ empty;
};
// v: 0
// v: 1
// v: 2
// v: 3
// v: 4
```

**Hook dispatch.** `~each` dispatches to the LHS's owning namespace's `~each` hook per §3.10.9. `List` declares a `~each` hook in the standard library.

`~each` is a **Tier 1** marker (§3.1.1.3): namespaces that do not declare `~each` cannot serve as `~each` LHS; there is no language-provided default composition.

#### §7.2 `~<<` on `List`

A Tuple value *is* a `List` monadic value directly -- `List` is the monadic type-name for Foi's positional-Tuple shape (§1.5).

There is no wrapping step: `< 2, 4 >` is a `List` value; `List` on the LHS of `~<<` names the type-level namespace whose `~<<` hook dispatches the composition.

```java
def xs: < 2, 4 >;
def ys: < 7, 8 >;

List ~<< {
    def x:: xs;
    def y:: ys;
    x + y;
};
// < 9, 10, 11, 12 >
```

Equivalent form using the block-defs clause:

```java
List ~<< (x:: xs, y:: ys) {
    x + y;
};
// < 9, 10, 11, 12 >
```

Under the do-block compilation split (§3.10.9.4), `List` declares a `~<<` hook (body below); `List ~<<` composition selects the override route. Each `def x::` binding and each `$expr;` mid-block statement compiles to an `Effect.Host.Do.Bind%` perform on the source expression; a bare terminal compiles to an `Effect.Host.Do.Map%` perform; a `$`-prefixed terminal compiles to a compiler-synthesized `def _r: Effect.Host.Do.Bind% expr; Effect.Host.Do.Map% _r` (Bind first, then Map lift). The hook body opens an inner `Effect.Host.Do ~<*` scope, drives the compiled `comp` under handler control via cartesian iteration, and resolves `Right@ list` at natural completion or `Left@ partial` on `Done@` early-exit (with empty-elision per §7.9).

The observable behaviors of `List ~<<` follow directly from this dispatch:

- **Successive-value binding.** `def x:: expr` binds `x` to each successive value drawn from `expr`. Each Bind perform's payload is the source list; the hook resumes `comp` once per element in cartesian order.
- **Cartesian composition.** Multiple `def ::` bindings compose cartesian-wise. Each pass through `comp` fixes one coordinate per Bind depth; the hook re-runs `comp` under a fresh handler installation per pass, advancing an odometer across the source lists.
- **Terminal collection.** Each iteration's terminal expression contributes to the accumulated result. A bare terminal (Map perform) is lifted into the collection wrap as one element. A `$`-prefixed terminal (Bind + synthesized Map tail) iterates the Bind's payload and lifts each drawn element into the wrap -- for a Tuple-shaped payload, the observable effect is to spread the payload's elements into the accumulation rather than collect the whole Tuple as one element.
- **Bare mid-block statement.** A bare mid-block statement runs as raw code inside `comp`; it neither performs nor threads its value. Explicit `$expr;` at this position performs Bind non-receivingly -- legal when the statement's perform semantic matters even though its resume-value is not needed.
- **`$`-prefixed terminal.** A `$`-prefixed terminal (`$expr`) compiles to a Bind on `expr` followed by an implicit Map on the resumed value (§3.10.9.4). For iterating outers like `List`, this spreads `expr`'s produced Tuple into the enclosing accumulation rather than collecting `expr` as one element.
- **Drainage shape.** The comprehension resolves `Right@ list` at natural completion; `Done@` early-exit resolves `Left@ partial` where `partial` is the accumulator up to and including the `Done@` iteration's contribution, per §7.9's empty-elision refinement.

**Nested-Tuple concern.** Because the default terminal Map arm collects each iteration's terminal value as *one element* of the result Tuple, a terminal expression that is itself a Tuple produces a Tuple-of-Tuples. The `$` prefix skips the lift:

```java
defn tup(x, y) ^< x + y >;

List ~<< (x:: xs, y:: ys) {
    tup(x, y);      // terminal produces Tuple; nested result
};
// < <9>, <10>, <11>, <12> >   -- likely a mistake!

List ~<< (x:: xs, y:: ys) {
    $tup(x, y);    // $-prefix binds instead of collecting
};
// < 9, 10, 11, 12 >
```

**Single-source form.** A `~<<` block with only one source binding is equivalent to `~map` on that source:

```java
def xs: < 2, 4 >;

List ~<< (x:: xs) {
    x * 10;
};
// < 20, 40 >

xs ~map (x) { x * 10; };
// < 20, 40 >
```

Prefer `~map` for the single-source case; `~<<` earns its keep when multiple sources need cartesian access in a shared scope.

**Compound-LHS `List{Promise}`.** When the source list holds promises and the block body should run per element only after each element's promise resolves (aka, "eager async iteration"), the compound-LHS form `List{Promise} ~<<` triggers per-element awaiting (per §6 opener). The whole comprehension resolves to a promise that settles once the list is drained:

```java
defn printResponses(prs) ^(
    List{Promise} ~<< (resp:: prs) {
        log(`"resp: `resp`");
    }
        ~map { "Complete."; }
);

printResponses(< pr1, pr2, pr3 >)
    ~map log;
// Promise{..pending..}
//
// ... eventually ...
//
// resp: response 1
// resp: response 2
// resp: response 3
// Complete.
```

The trailing `~map` swaps in `"Complete."` as the final resolved value; without it, the comprehension would resolve to the list-drain's own terminal value.

If any element's promise resolves with `Left@ reason`, the composition short-circuits at that element (per Promise's Either-aware `~<<` semantic, §6.8.3); subsequent elements are not awaited, and the whole comprehension resolves to `Promise{Left{reason}}`.

For the parallel case -- fire every request concurrently and wait for the full batch -- use `Promise.all@` (§6.8.4) instead.

**Not a separate hook.** `List{Promise} ~<<` shares the single `List~<<` hook (per §3.1.1's one-hook-per-operator-per-namespace rule); the hook's per-shape behavior is selected via the trailing dispatch-type value `ty` (§3.10.9.7). At a `List` call site, `ty` is `< List >` and the hook's plain arm handles ordinary cartesian iteration; at a `List{Promise}` call site, `ty` is `< List, Promise >` and the hook's compound-LHS arm delegates the per-element awaiting to `IterP ~<<` (§6.5.6) -- wrapping the source list via `IterP@` (§6.5.4) and driving the block through drainage. Natural completion resolves `Promise{Right{accumulated}}`; mid-stream Left short-circuit resolves `Promise{Left{reason}}`; `Done@` early-exit resolves `Promise{Left{partial}}` with §7.9's empty-elision applied to the accumulator. There is no grammar surface for a `List{Promise}~<<` declaration; the compound-LHS specialization is authored as a `?(ty)` arm inside `List~<<`'s body.

**Early exit.** Returning a `Done@`-shaped value from an iteration terminates the traversal. The payload is treated as that iteration's terminal contribution, dispatched exactly as a normal terminal expression would be. Under the default `~map`-lift, the payload becomes one appended element. Under a `$`-prefixed terminal (which binds/flattens instead), the payload is flattened in via `~<`; in this case both the normal terminal and the `Done@` payload must be shape-compatible with the monad (Tuple-shaped for `List`).

```java
def xs: < 1, 2, 3, 4 >;

List ~<< {
    def x:: xs;
    ?{
        [x ?> 2]: Done@ 5;
        : x * 10
    }
};
// Left{<10, 20, 5>}

List ~<< {
    def x:: xs;
    ?{
        [x ?> 2]: Done@ <5,7>;
        : x * 10
    }
};
// Left{<10, 20, <5,7>>}

List ~<< {
    def x:: xs;

    // notice $ on next line
    $ ?{
        [x ?> 2]: Done@ <5,7>;
        : < x * 10 >
    };
};
// Left{<10, 20, 5, 7>}
```

**Hook body.** The `List~<<` hook body dispatches on `typ` to select between plain-cartesian iteration (via `listBindImpl`) and outer-Promise-list per-element awaiting (via `listPromiseBindImpl`):

```java
defn List~<<(comp, typ) {
    ^?(typ){
        [< List >]: listBindImpl(comp);
        [< List, Promise >]: listPromiseBindImpl(comp);
        : Left@ "Invalid LHS"
    };
};

defn listBindImpl(comp) {
    def results: <>;
    def sources: <>;
    def coord: <>;
    def curDepth: 0;
    def firstPass: true;
    def pending: empty;
    def more: true;
    def earlyExit: false;

    ^runPass();

    defn runPass()
        :over (curDepth, pending, sources, coord, results, firstPass, more, earlyExit)
    {
        curDepth := 0;
        pending := empty;
        Effect.Host.Do ~<* (eff:: comp(), ret) {
            ?(eff){
                [?as Effect.Host.Do.Bind]: {
                    def raw: #.value;
                    ?(raw){
                        [?as Done]: {
                            more := false;
                            earlyExit := true;
                            pending := raw.value;
                            Done@ empty
                        };
                        : {
                            def d: curDepth;
                            curDepth := curDepth + 1;
                            ?[firstPass]: {
                                sources := < &sources, raw >;
                                coord := < &coord, 0 >;
                            };
                            ret(sources[d][coord[d]]);
                            empty
                        }
                    }
                };
                [?as Effect.Host.Do.Map]: {
                    def raw: #.value;
                    ?(raw){
                        [?as Done]: {
                            def v: raw.value;
                            more := false;
                            earlyExit := true;
                            pending := ?{
                                [v ?= empty]: <>;
                                : < v >
                            };
                        };
                        : pending := < raw >;
                    };
                    Done@ empty
                };
            };
        };

        results := < &results, &pending >;
        firstPass := false;
        advance();
        ^?{
            [more]: runPass();
            [earlyExit]: Left@ results;
            : Right@ results
        };
    };

    defn advance() :over (coord, more) {
        def d: size(coord) - 1;
        def carrying: true;
        ?[carrying ?and d ?>= 0] ~each {
            def nextI: coord[d] + 1;
            ?{
                [nextI ?< size(sources[d])]: {
                    coord := replaceAt(coord, d, nextI);
                    carrying := false;
                };
                : {
                    coord := replaceAt(coord, d, 0);
                    d := d - 1;
                };
            };
        };
        ?[carrying]: more := false;
    };

    defn replaceAt(list, idx, val) {
        ^< &list, %idx: val >;
    };
};

defn listPromiseBindImpl(comp) {
    ^(Effect.Host.Do ~<* (eff:: comp(), ret) {
        ?(eff){
            [?as Effect.Host.Do.Bind]: Done@ #.value;
            : empty
        };
    })
        ~< (srcList) {
            def acc: <>;
            def earlyExit: false;
            (~cata)(
                (IterP ~<< (v:: IterP@ srcList) {
                    (Effect.Host.Do ~<* (eff:: comp(), ret) {
                        ?(eff){
                            [?as Effect.Host.Do.Bind]: { ret(v) };
                            [?as Effect.Host.Do.Map]: {
                                Done@ #.value
                            };
                        };
                    })
                        ~< (res) {
                            ?(res){
                                [?as Done]: {
                                    earlyExit := true;
                                    ?[res.value ?!= empty]:
                                        acc := <&acc, res.value>;
                                };
                                : ?[!earlyExit]: acc := <&acc, res>;
                            };
                            Promise.honor@ empty;
                        }
                }),
                defn(leftVal) :over (acc, earlyExit) ^?{
                    [earlyExit]: Promise.renege@ acc;
                    : Promise.renege@ leftVal
                },
                defn(_rv) :over (acc, earlyExit) ^?{
                    [earlyExit]: Promise.renege@ acc;
                    : Promise.honor@ acc
                }
            );
        };
};
```

**Plain-cartesian arm (`listBindImpl`).** Runs `comp` under fresh `Effect.Host.Do ~<*` scope installations, once per coordinate position in the cartesian product. The first pass discovers source lists via each `Effect.Host.Do.Bind` perform's payload and initializes an odometer `coord`; subsequent passes advance the odometer and re-run `comp` with `sources[d][coord[d]]` substituted at each Bind depth. Ret is fire-and-forget per §6.3.2 (D5); the Bind arm's normal terminal is bare `empty` (arm-without-`Done@` per §6.3.2 D4) so the scope persists across multiple Bind arm firings within a single pass. The Map arm terminates the scope via `Done@`, contributing the pass's terminal value to `pending`. Both arms inspect their payloads for `Done@` shape to catch early-exit contributions: a `$Done@` at terminal enters via Bind (payload is Tuple-shaped, assigned directly to `pending` for spread into `results`); a bare-terminal `Done@` enters via Map (payload wrapped as `< payload >` in `pending`, or `<>` under empty-elision per §7.9). Either Done@ path sets `earlyExit := true` and `more := false`, terminating the scope and short-circuiting further passes. After the scope returns, `pending` spreads into `results`; at runPass return, `[more]` continues to the next pass, `[earlyExit]` returns `Left@ results`, and the natural path returns `Right@ results`.

**Outer-Promise-list arm (`listPromiseBindImpl`).** Extracts the source list via a discovery `Effect.Host.Do ~<*` scope catching the first Bind's payload, then drives `IterP ~<<` over `IterP@ srcList` for per-element awaiting. Each iteration installs a fresh `Effect.Host.Do ~<*` scope over `comp()` that ret-substitutes the awaited element into the block body; the block-body terminal Promise is captured via the chained `~<`. The chain's `res` is inspected for `Done@`: on Done@, `earlyExit := true` and `res.value` appends to `acc` unless empty (§7.9 empty-elision); on non-Done@, `!earlyExit` gates further growth. Terminal shape via `~cata` (§7.7): `IterP ~<<` natural completion (Right arm) resolves `Promise{Right{acc}}` when `!earlyExit`, else `Promise{Left{acc}}`; cargo Left short-circuit (Left arm) resolves `Promise{Left{leftVal}}` when `!earlyExit`, else `Promise{Left{acc}}`. Once `Done@` fires, subsequent IterP iterations still run (the outer `~<` fires per step), but `!earlyExit` prevents further accumulator growth; the final terminal shape is delivered at `IterP ~<<` completion.

#### §7.3 `~<`

`~<` (bind, also known as flatMap or chain) applies the iteration operand to each element of the LHS and concatenates the returned containers into a single result. The iteration operand must return an ordered-container-shaped value (Tuple/List) for each element.

```java
def xs: < 1, 2, 3 >;
defn pair(v) ^< v, v * 10 >;

xs ~< pair;
// < 1, 10, 2, 20, 3, 30 >
```

**NOTE:** `~<` has the following interchangeable named-operator aliases: `~bind`, `~flatMap`, `~chain`.

Contrast with `~map`, which wraps each iteration's result as one element:

```java
xs ~map pair;
// < <1, 10>, <2, 20>, <3, 30> >   -- nested

xs ~< pair;
// < 1, 10, 2, 20, 3, 30 >         -- flattened
```

The LHS may be a Tuple (`List`) value, including a constructed range (e.g., `2..5` which evaluates to `< 2, 3, 4, 5 >`).

```java
0..2 ~< (v) { < v, v * v >; };
// < 0, 0, 1, 1, 2, 4 >
```

**Iteration-operand shapes.** As with `~each`, the three admitted shapes are:

```java
xs ~< pair;                             // function value
xs ~< (v) { < v, v * 10 >; };           // block-defs clause
pairs ~< (<:k, :v>) { < k, v >; };      // destructure block-defs
```

**Iteration-operand return.** The operand's returned value must be shape-compatible with the LHS container -- a Tuple/List for a Tuple/List LHS. Non-container return is a shape mismatch, and will raise a type error (compiler or runtime).

**No auto-lift.** A scalar return is *not* implicitly lifted into a singleton container.

```java
def xs: < 1, 2, 3 >;

xs ~< (v) { v * 10 };           // shape mismatch -- scalar return
xs ~< (v) { < v * 10 >; };      // < 10, 20, 30 >
```

**Empty container.** `~<` on an empty container yields an empty container: `<> ~< anyFn` evaluates to `<>`.

**Early exit.** Returning a `Done@`-shaped value terminates the traversal. The payload is treated as the terminating iteration's terminal contribution -- spread into the result the same way a normal iteration's returned Tuple is spread:

```java
def xs: < 1, 2, 3, 4 >;

xs ~< (v) {
    ?{
        [v ?> 2]: Done@ < 99 >;
        : < v, v * 10 >
    }
};
// < 1, 10, 2, 20, 99 >
```

Because `~<` unconditionally spreads terminals, a scalar `Done@` payload is the same shape mismatch, diagnosed on the same path. The payload must be Tuple-shaped.

**Hook dispatch.** `~<` dispatches to the LHS's owning namespace's `~<` hook per §3.10.9. `List` declares a `~<` hook in the standard library.

`~<` is a **Tier 1** marker (§3.1.1.3): namespaces that do not declare `~<` cannot serve as `~<` LHS; there is no language-provided default composition.

#### §7.4 `~map`

`~map` is the per-element-transform comprehension: for each element of the LHS in order, evaluate the iteration operand against that element, and collect each returned value as an element of a same-length result List.

```java
defn double(v) ^v * 2;

def xs: < 1, 2, 3 >;
xs ~map double;
// < 2, 4, 6 >

0..5 ~map (v) { v * 2; };
// < 0, 2, 4, 6, 8, 10 >
```

**LHS.** A List value. (The `..` range operator produces a List, so `0..5 ~map ...` is List-shaped.)

**Iteration-operand shapes.** As with `~each`, the three admitted shapes are:

```java
xs ~map double;                         // function value
xs ~map (v) { v * 2; };                 // block-defs clause
pairs ~map (<:k, :v>) { <v, k>; };      // destructure block-defs
```

To access the value *and* index, use the `List.entries@` unit constructor to produce an *entries* list to apply to `~map`, and destructure the iteration value:

```java
def xs: < 5, 10, 15 >;

(List.entries@ xs) ~map (< i, v >) {
    (i + 1) * v
};
// < 5, 20, 30 >
```

**NOTE:** `List.entries@` produces a list of `< index, value >` tuples. `List.keys@` produces a list of indicies (`< 0, 1, 2, .. >`).

**Result shape.** `~map` is container-preserving (i.e., functor): the result is a List of the same length as the LHS, with each element the return value of the corresponding iteration.

Returning a List from the iteration produces a List of Lists (the "zip" case):

```java
defn zip(xs, ys) {
    ^(List.entries@ xs) ~map (< i, x >) {
        < x, ys[i] >
    }
};

zip(< 1, 2, 3 >, < 4, 5, 6 >);
// < <1, 4>, <2, 5>, <3, 6> >
```

To flatten instead of nesting, use `~<` (§7.3).

**Empty LHS.** `~map` on an empty List yields an empty List: `<> ~map anyFn` evaluates to `<>`.

**Composition chaining.** Multiple `~map` steps compose sequentially:

```java
defn inc(v) ^v + 1;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

< 1, 3, 5, 7, 9 > ~map inc ~map triple ~map half;
// < 3, 6, 9, 12, 15 >
```

To avoid multiple sequential `~map` operations, the functions can be composed or pipelined:

```java
< 1, 3, 5, 7, 9 > ~map (inc +> triple +> half);
// < 3, 6, 9, 12, 15 >

< 1, 3, 5, 7, 9 > ~map (v) {
    v #> inc #> triple #> half
};
// < 3, 6, 9, 12, 15 >
```

**Early exit.** Returning a `Done@`-shaped value from an iteration terminates the traversal. The payload is treated as the terminating iteration's terminal contribution -- collected as one element of the result List:

```java
def xs: < 1, 2, 3, 4 >;

xs ~map (v) {
    ?{
        [v ?> 2]: Done@ 99;
        : v * 10
    }
};
// < 10, 20, 99 >
```

A `Done@` with a List payload nests, same as a normal iteration returning a List:

```java
xs ~map (v) {
    ?{
        [v ?> 2]: Done@ < 99, 100 >;
        : v * 10
    }
};
// < 10, 20, < 99, 100 > >
```

**Hook dispatch.** `~map` dispatches to the LHS's owning namespace's `~map` hook per §3.10.9. `List` declares a `~map` hook in the standard library.

`~map` is a **Tier 2** marker (§3.1.1.3): if a namespace does not declare `~map`, the language provides a default composition using the namespace's `~<` hook and `@` unit constructor. Namespaces that declare both `~<` and `@` need not declare `~map` explicitly.

#### §7.5 `~filter`

`~filter` is the predicate-selection comprehension: for each element of the LHS in order, evaluate the iteration operand as a predicate against that element; include the element in the result List when the predicate returns `true`, exclude when `false`.

```java
defn isEven(v) ^mod(v, 2) ?= 0;

def evens: 0..9 ~filter isEven;
// < 0, 2, 4, 6, 8 >

def odds: 0..9 ~filter !isEven;
// < 1, 3, 5, 7, 9 >
```

**NOTE:** `!isEven` is `!` producing a negated predicate function.

**LHS.** A List value.

**Iteration-operand shapes.** As with `~each`, the three admitted shapes are:

```java
xs ~filter isEven;                         // function value
xs ~filter (v) { !isEven(v) };             // block-defs clause
pairs ~filter (<:k, :v>) { k ?> 0 };       // destructure block-defs
```

**Iteration-operand return.** The operand must return a boolean value. Non-boolean return is a shape mismatch, and will raise a type error (compiler or runtime).

To access the element's index within the LHS, pair with `List.entries@` (as with `~map`):

```java
def xs: < 10, 20, 30, 40 >;

(List.entries@ xs) ~filter (< i, v >) {
    ?{
        [mod(i, 2) ?= 0]: v ?> 15;
        : false
    };
};
// < <2, 30> >
```

**Result shape.** `~filter` is container-preserving in type but not length: the result is a List whose elements are a subset of the LHS's elements, in original order.

**Empty LHS.** `~filter` on an empty List yields an empty List: `<> ~filter anyPred` evaluates to `<>`.

**Composition chaining.** Multiple `~filter` steps compose sequentially, each narrowing the result:

```java
defn isEven(v) ^mod(v, 2) ?= 0;
defn isPositive(v) ^v ?> 0;

< -4, -3, 0, 1, 2, 3, 4 > ~filter isEven ~filter isPositive;
// < 2, 4 >
```

Or combine predicates directly with boolean operators:

```java
< -4, -3, 0, 1, 2, 3, 4 > ~filter (v) {
    isEven(v) ?and isPositive(v);
};
// < 2, 4 >
```

**Early exit.** Returning a `Done@`-shaped value from an iteration terminates the traversal. The payload is treated as the terminating iteration's terminal contribution -- interpreted as the predicate decision for the current element:

```java
def xs: < 1, 2, 3, 4, 5 >;

xs ~filter (v) {
    ?{
        [v ?> 3]: Done@ true;
        : isEven(v)
    }
};
// < 2, 4 >
```

Here, `v = 4` triggers `Done@ true`. `4` is included in the result and iteration stops before processing `5`. `Done@ false` would exclude the current element and stop. A non-boolean `Done@` payload is a shape mismatch, same as a normal non-boolean return (type error, compiler or runtime).

**Hook dispatch.** `~filter` dispatches to the LHS's owning namespace's `~filter` hook per §3.10.9. `List` declares a `~filter` hook in the standard library.

`~filter` is a **Tier 2** marker (§3.1.1.3): if a namespace does not declare `~filter`, the language provides a default composition using the namespace's `~<` hook and `@` unit constructor. Namespaces that declare both need not declare `~filter` explicitly.

#### §7.6 `~fold` / `~foldR`

`~fold` (aka "reduce") is the left-associative catamorphic-reduction comprehension: process the LHS elements in order, threading an accumulator through each iteration; the final accumulator value is the result. `~foldR` (aka "reduceRight") is identical except elements are processed right-to-left.

Two admitted forms distinguish whether an explicit initial accumulator is supplied:

**Two-operand inline form** (no explicit initial value). The first element of the LHS serves as the initial accumulator; iteration begins with the second element:

```java
defn add(x, y) ^x + y;
defn sub(x, y) ^x - y;

0..4 ~fold add;
// 10   (0 + 1 + 2 + 3 + 4)

1..5 ~fold sub;
// -13  (1 - 2 - 3 - 4 - 5)

1..5 ~foldR sub;
// -5   (5 - 4 - 3 - 2 - 1)
```

**Three-operand operator-as-function form** (explicit initial value). The initial accumulator is supplied as the second operand; iteration begins with the first element:

```java
(~fold)(1..5, 100, sub);
// 85   (100 - 1 - 2 - 3 - 4 - 5)
```

The three-operand form is available only via the operator-as-function invocation; the binary infix form has no syntactic position for a third operand.

`(~foldR)` takes the same three-operand shape, processing right-to-left:

```java
(~foldR)(1..5, 100, sub);
// 85   (100 - 5 - 4 - 3 - 2 - 1)
```

**LHS.** A List value.

**Iteration-operand shapes.** The iteration operand is a two-parameter callable, receiving `(accumulator, currentValue)`:

```java
xs ~fold add;                           // function value
xs ~fold (acc, v) { acc + v };          // block-defs clause
xs ~fold (acc, <:k, :v>) { acc + v };   // destructure on second param
```

**Empty and single-value behavior.**

- Two-operand form on an empty List: invalid; type error (compiler or runtime). There is no first element to serve as the initial accumulator.
- Two-operand form on a single-value List: returns that value; the iteration operand is not evaluated.
- Three-operand form on an empty List: returns the initial value.
- Three-operand form on a single-value List: iterates once with `(init, xs.0)`; returns that iteration's result.

**Accumulator shape.** The accumulator may be any value type. Building up a List is a common pattern:

```java
defn onlyOdds(list, v)
    ?[mod(v, 2) != 1]: list
    ^list + < v >;

(~fold)(0..9, <>, onlyOdds);
// < 1, 3, 5, 7, 9 >
```

**NOTE:** `List` (tuple) is a concatable, so `+` is defined to concatenate lists.

Here, the initial `<>` accumulator grows across iterations by appending values that pass the predicate.

**Early exit.** Returning a `Done@`-shaped value from an iteration terminates the traversal. The payload is treated as the terminating iteration's terminal contribution -- becomes the final accumulator (result):

```java
defn add(x, y) ^x + y;

0..9 ~fold (acc, v) {
    ?{
        [acc ?> 10]: Done@ acc;
        : acc + v
    }
};
// 15   (0 + 1 + 2 + 3 + 4 + 5 = 15; then Done@ 15 terminates)
```

`Done@` in `~fold` accepts any payload shape (matching the accumulator's freedom of shape).

**Hook dispatch.** `~fold` and `~foldR` each dispatch to the LHS's owning namespace's respective hook per §3.10.9. `List` declares both hooks in the standard library.

`~fold` and `~foldR` are **Tier 2** markers (§3.1.1.3): if a namespace does not declare them, the language provides a default composition.

#### §7.7 `~cata`

`~cata` is the catamorphism comprehension: a thunk-initialed variant of the three-operand `~fold`. Where three-operand `~fold` takes an already-computed initial accumulator, `~cata` takes a **thunk** (a zero-arg function) that computes the initial value only when needed. The distinction matters when the initial value is expensive to compute, has deferrable side effects, or is only conditionally required (e.g., on Sum-type LHS where the initial branch may not fire).

Like the three-operand `~fold`, `~cata` has no all-operands binary infix form; the initial-value operand is supplied exclusively via the operator-as-function form:

```java
defn add(x, y) ^x + y;

(~cata)(0..4, Function@ 0, add);
// 10
```

**LHS.** A List value. (`~cata`'s primary utility is on Sum-type LHS -- e.g., Maybe, Either -- where the thunk represents a lazy None-branch handler; those usages are covered in the monad sections.)

**Iteration-operand shapes.** The iteration operand is a two-parameter function, receiving `(accumulator, currentValue)` -- identical to `~fold`:

```java
(~cata)(xs, initThunk, add);
```

**Empty and single-value behavior.**

- Empty List: returns the result of invoking `initThunk` (evaluated exactly once).
- Single-value List: iterates once with `(initThunk(), xs.0)`; returns that iteration's result.

**Mutual-defaulting pair with `~fold`.** Per §3.10.9.3, `~fold` and `~cata` form a mutual-defaulting pair on the same catamorphism, differing only in the initial value's representation (eager value vs. thunk). If a namespace declares one but not the other, dispatch routes through the declared hook with an appropriate wrap or eager invocation:

- Namespace declares `~cata` only: `(~fold)(inst, init, fn)` dispatches to the `~cata` hook with `() -> init` thunk-wrap.
- Namespace declares `~fold` only: `(~cata)(inst, initThunk, fn)` dispatches to the `~fold` hook with `initThunk()` evaluated eagerly (forfeits laziness -- the cost of not declaring `~cata`).
- Neither declared: rejected at compile time.

**Early exit.** Returning a `Done@`-shaped value from an iteration terminates the traversal. The payload is treated as the terminating iteration's terminal contribution -- becomes the final accumulator (result), same as in `~fold`:

```java
(~cata)(0..9, Function@ 0, (acc, v) {
    ?{
        [acc ?> 10]: Done@ acc;
        : acc + v
    }
});
// 15
```

`Done@` in `~cata` accepts any payload shape.

**Hook dispatch.** `~cata` dispatches to the LHS's owning namespace's `~cata` hook per §3.10.9. `List` declares a `~cata` hook in the standard library.

`~cata` is a **Tier 2** marker (§3.1.1.3), member of the mutual-defaulting pair with `~fold` per §3.10.9.3.

**Prime forms.** `(~cata')` is reserved per §3.10.9.6 (semantic-reject; future activation possible for direction-reversed catamorphism).

#### §7.8 `~ap`

`~ap` is the applicative-apply comprehension. Like `~map`, it performs unary application of a function to an argument, producing a same-namespace result -- but with the polarity of holder and operand reversed. In `~map`, the LHS instance holds the *value* and the operand is a bare function. In `~ap`, the LHS instance holds the *function* and the operand supplies the value.

```java
defn add(x)(y) ^x + y;

def three: Id@ 3;
def four: Id@ 4;

(Id@ add) ~ap three ~ap four;
// Id{7}
```

For curried functions of multiple arguments, chained `~ap` applications supply arguments one at a time; each application peels one layer of the curry.

The function-held-in-container structure is the intrinsic distinguishing feature of applicative -- what the abstraction is *about*. The operand being a same-namespace instance (rather than a bare value) is a definitional convention of the applicative abstraction, chosen for uniformity across all namespaces: for `Id`, wrapping the operand is ceremony that computes the same result as a bare value would; for `Maybe`, `Either`, `List`, `Promise`, or `IO`, the operand's own context contributes to the outcome, and the wrapping is what makes the composition well-defined.

To illustrate:

```java
(Maybe@ add) ~ap (Maybe.from@ age);
```

Here, if `Maybe.from@ age` produces a `None` (because `age` is `empty`), the `~ap` still safely evaluates, but doesn't apply the invalid input to the `add` function; instead, the operation returns the `None`.

**LHS.** An instance whose held value is a function. Per §3.10.9.2, the hook receives the LHS as the function-holder: `(fnInst, valInst)`.

**Operand shape.** A single operand: an instance in the same namespace as the LHS, holding the value to apply. Function-typed value expressions like `Id@ add` and value-typed instances like `Id@ 3` are both instances; `~ap` requires both.

**No block-body operand form.** Because `~ap`'s operand is an instance value (not a per-element function or block), the block-with-defs and destructure-block forms admitted by other comprehensions do not apply. The operand is a plain expression evaluating to an instance.

**List LHS.** For `List ~ap` -- an LHS List of functions applied to an RHS List of values -- the applicative produces the Cartesian product of applications, in functions-outer / values-inner order:

```java
defn inc(v) ^v + 1;
defn double(v) ^v * 2;

< inc, double > ~ap < 10, 20, 30 >;
// < 11, 21, 31, 20, 40, 60 >
```

Each function is applied to each value in sequence: `inc(10), inc(20), inc(30), double(10), double(20), double(30)`.

**No early exit.** `~ap` performs a single application (or a Cartesian product on List); there is no per-element iteration to exit from. `Done@` has no special interpretation as an `~ap` operand or return; if such a value flows through, it is treated as an ordinary value.

**Hook dispatch.** `~ap` dispatches to the LHS's owning namespace's `~ap` hook per §3.10.9. `List` declares a `~ap` hook in the standard library.

`~ap` is a **Tier 2** marker (§3.1.1.3): if a namespace does not declare `~ap`, the language provides a default composition using the namespace's `~<` hook and `@` unit constructor. Namespaces that declare both need not declare `~ap` explicitly.

Standard Applicative-from-Monad derivation:

```
fnInst ~ap valInst   ==   fnInst ~< ((fn) { valInst ~map fn })
```

**Prime forms.** `(~ap')` rejects at the semantic layer per §3.10.9.6 (no direction axis; argument-order-swap not admitted for comprehensions).

#### §7.9 `Done@` Across Comprehensions

`Done@` is the early-exit sentinel for comprehension iterations. §6.4 specifies its full sticky-sentinel semantics and the three call classes (raw-value, comprehension iteration return, effect handler resume). This section covers the "comprehension iteration return" class.

**Uniform framing: comprehensions lift over `Done@`.** Every comprehension can be understood as a product of two orthogonal axes: a *terminal-semantic* (what to do with each iteration's terminal value -- collect, spread, fold, discard, decide) and a *control-flow signal* (whether to continue or stop). `Done@` is the control-flow axis; the payload rides on the data axis and is processed by the comprehension's normal terminal-semantic, unchanged.

Iteration return shape:

```
iterationReturn :: Terminal | Done@ Terminal
```

The comprehension's terminal-handler operates on the payload uniformly regardless of which arm delivered it; the `Done@` arm additionally halts the traversal. There is no per-comprehension `Done@` rule to learn -- learn each comprehension's terminal-semantic (§7.1–§7.8), and `Done@` slots in.

**Concrete dispatch.** Applying the uniform framing to each comprehension:

- **`~each` (§7.1).** Terminal-semantic: discard. `Done@` payload: discarded; loop stops.
- **`~<<` on `List` (§7.2).** Terminal-semantic: `~map`-lift (or `~<`-bind under `$`-prefixed terminal). `Done@` payload: lifted or bound identically, then stop.
- **`~<` (§7.3).** Terminal-semantic: spread into result. `Done@` payload: spread identically, then stop. Payload must be List-shaped.
- **`~map` (§7.4).** Terminal-semantic: collect as one element. `Done@` payload: collected as one final element, then stop.
- **`~filter` (§7.5).** Terminal-semantic: boolean predicate decision. `Done@` payload: decision for the terminating iteration (`Done@ true` includes, `Done@ false` excludes), then stop. Non-boolean payload is a shape mismatch.
- **`~fold` / `~foldR` (§7.6).** Terminal-semantic: new accumulator. `Done@` payload: becomes final accumulator (result), then stop.
- **`~cata` (§7.7).** Same as `~fold`.
- **`~ap` (§7.8).** No per-element iteration; no `Done@` interpretation. A `Done@`-shaped value flowing through is treated as an ordinary value.

**Empty-elision at accumulator-carrying `~<<` drainage.** When `Done@` fires early-exit inside a `~<<` drainage that carries an accumulator (`List` and `List{Promise}` on §7.2), the payload is folded into the partial accumulator per the comprehension's terminal-semantic, with one refinement: bare `Done@` and `Done@ empty` drop the payload rather than appending `empty` as a hanging element. `Done@ v` (`v` non-empty) appends `v` as one element via the default terminal-semantic; `$Done@ tup` spreads `tup`'s elements into the accumulator; `$Done@ <>` naturally contributes nothing. `Iter` (§6.5.3) and `IterP` (§6.5.6) have no accumulator; their drainage-Left carries the payload directly (`Left@ payload`, or `Promise{Left{payload}}` for `IterP`), with bare `Done@` and `Done@ empty` resolving `Left@ empty` (or `Promise{Left{empty}}` for `IterP`).

**Nested comprehensions.** `Done@` terminates the innermost enclosing comprehension only. To propagate an early exit through multiple nesting levels, each outer comprehension's iteration must inspect its inner result and issue its own `Done@` accordingly.

```java
def matrix: < <1,2,3,4>, <5,6,7,8> >;

matrix ~map (row) {
    row ~map (v) {
        ?{
            [v ?> 5]: Done@ v;
            : v * 10
        }
    };
};
// < <10,20,30,40>, <50,6> >
```

Row 1's inner `~map` runs to completion; Row 2's inner `~map` hits `v = 6`, returns `Done@ 6`, terminates with `6` as the final element per `~map`'s terminal-semantic. The outer `~map` sees each inner result as an ordinary value.

**Cross-reference.** For `Done@`'s base semantics -- sticky-sentinel behavior, three-call-class taxonomy, raw-value form, and effect-handler-resume interaction -- see §6.4.
