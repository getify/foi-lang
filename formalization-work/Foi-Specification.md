# Foi Semantic Specification

**Version:** draft (design phase)
**Status:** §0 + §1 + §2 first draft

This document is the mid-level semantic specification for the Foi language. It sits between `Foi-Guide.md` (user-facing tutorial) and `Syntactic-Grammar.md` (pure syntactic spec). Its job is to describe **how Foi programs behave** at the level of an abstract machine: evaluation order, scope rules, frame contents, lookup semantics, and the operational meaning of each construct.

It is not a formal operational semantics in the academic sense. There are no judgment trees, no Greek-letter inference rules. The register is the WebAssembly specification or R7RS -- algorithmically described execution, expressed as steps a reader can mentally perform.

It is also not a complete specification of Foi today. The language is still in design. Where a region is unsettled, this document marks the territory as *open*, captures what has been provisionally decided, and identifies the questions that gate further commitment. The document is meant to grow incrementally as design lands.

---

## §0 Preliminaries

### §0.1 Abstract machine register

A Foi program is described as evaluation against an abstract machine. The machine is built from a small number of structures:

A **value** is anything a Foi expression evaluates to: a primitive, a Record, a Tuple, a function, a monadic value, a sentinel like `Done@...`, or a suspended computation. Values are immutable at the language level; the only mutability in Foi is reassignment of the binding slots that hold values.

A **slot** is a mutable cell holding a value. Slots exist so that reassignment (`:=`) has somewhere to write. Each binding introduces a slot.

A **frame** is a mapping from names to slots, plus a link to a parent frame. Frames form a chain along the lexical scope hierarchy. Looking up a name walks the chain from innermost frame outward until the name resolves; if no frame holds the name, the program is ill-formed.

An **environment** at a point in execution is the current innermost frame; via its parent links it implicitly references the full chain. Every expression evaluates in some environment.

### §0.2 Notation

Where this document describes the abstract execution of a construct, it does so as numbered steps. Steps are sequential unless explicitly stated otherwise. The notation is informal pseudocode and does not commit to a specific interpreter representation.

When the spec needs to refer to fresh internal names (temporaries the interpreter must allocate but the user cannot see), it uses the prefix `__`; e.g., `__t0`, `__src`. These names are illustrative; an interpreter is free to use different mechanisms (registers, SSA names, anonymous slots) as long as the observable behavior matches.

When this document shows a JS lowering, it reflects what the bootstrap transpiler emits. JS lowerings are illustrative of the operational meaning but are not normative: a future native interpreter is free to implement the same semantics differently.

### §0.3 Conventions for open territory

A region of the spec is **settled** when its operational behavior is fixed by the language design, the bootstrap transpiler, and the round-trip and parser oracles in agreement.

A region is **open** when at least one of the following holds: the design has multiple candidate semantics under active consideration; the transpiler punted on the construct; the construct depends on a yet-to-be-decided cross-cutting feature (type system lifecycle, monad runtime contract, effect tracking, module semantics).

Open regions appear inline under an **Open** heading within the relevant section.

### §0.4 Document scope

Sections are organized by semantic category, not by grammar production. Current TOC:

- §1 Values *(done)*
- §2 Bindings & Data Access *(done)*
- §3 Functions *(done)*
- §4 Decisions and guards *(done)*
- §5 Pattern matching *(planned)*
- §6 Loops and comprehensions *(planned)*
- §7 Suspension and evaluation control *(planned)*
- §8 Modules *(planned)*
- §9 Type system *(planned)*

---

## §1 Values

This section catalogues the value categories a Foi program manipulates. It specifies their literal forms and construction semantics -- what an expression produces -- without yet describing what binds those values or how they are accessed (§2 covers both).

### §1.1 The `empty` value

`empty` is a first-class value denoting "no value." It is a reserved keyword; it cannot be used as a binding name, parameter name, record field name, or any other identifier site.

```java
def age: empty;                 // age's slot holds the empty value
empty;                          // the empty value
log(empty);                     // doesn't print anything
```

`empty` is the value produced by:

- A failed guard expression (§4).
- A function parameter (with no default value) whose call omits an argument at that position.
- An implicit initializer at a defs-init clause without an explicit value (§2.9.2).
- Property reads against a missing slot (§2.12).

### §1.2 Booleans

`true` and `false` are reserved keywords denoting the two boolean values. All decision making forms (guards, pattern matching, etc) expect these boolean values.

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

### §1.3 Numbers

Foi numeric literals cover integers (`42`, `-3`) and decimals (`3.14`, `-0.001`). They may also be expressed in typed radixes: octal (`\o755`, `\o-755`), hexadecimal (`\hA3`, `\h-ff`), and binary (`\b01011101`, `\b-1100`). All typed-radix forms admit an optional leading sign inside the escape body.

Numeric literals may also carry underscore separators for readability, but only via an explicit `\` escape:

- `\5_000`: separator-bearing positive integer
- `\-1_000`: separator-bearing signed integer
- `\100_000.25`: separator-bearing decimal

Bare top-level integers and decimals do not admit separators; `100_000` written without the leading `\` is not a numeric literal.

A further escape form `\@<digits>` (hex-digit alphabet, with optional sign, separators, and fractional part; e.g. `\@FFFF`, `\@-FF_FF.AA`) is the **monadic** numeric literal. Unlike the other escape forms, this does not construct a primitive number; it constructs a monadic-wrapped numeric value, conceptually arbitrary-precision. The bootstrap stubs this form; full semantics are deferred to the monad story.

Arithmetic operations (`+`, `/`, etc) produce numeric values.

**Open:** the precise numeric tower -- distinct integer/float types vs. unified Number, arbitrary-precision integers, rational extensions, and the exact runtime contract of `\@`-monadic literals -- is not yet settled. The bootstrap inherits JS's unified number type.

### §1.4 Strings

Foi strings have two major characteristics that define their various forms: interpolation (or not) and whitespace preserving (or collapsing).

For the first characteristic:

```java
def plain: "hello world";           // "hello world"
def interp: `"hello `name`!";       // "hello Kyle"
```

A plain string has no special content parsing. It's delimited on either end by `"` double-quote characters.

An interpolated (structured interleaving of values) string parses the content to replace delimited expressions with their evaluated values. This literal form opens with backtick+quote `` `" ``, closes with a bare quote `"`, and embeds interpolated expressions in the string contents delimited by pairs of backticks (`` `expr` ``).

**Abstract execution of an interpolated string:**

1. For each segment, in source order:
    1. If the segment is literal text, append it to the result.
    2. If the segment is an interpolated expression, evaluate it in the current environment and append the result as a string.
2. The completed string is the value of the literal.

**Open:** the coercion rule for non-string values embedded in interpolations is not yet locked. The bootstrap relies on JS's stringification, which carries the same footgun as §2.12.4's computed-key issue.

#### Delimiter Escaping

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

#### Unicode Escape Sequences

To include a Unicode escape sequence (one or more characters), an interpolated string expression can contain a single `\u..` expression:

```java
`"Hello `\u263A`!";
// Hello ☺!
```

After the `\u`, any number of hexadecimal digits specify the codepoint of the Unicode character. `\u263a` (`"☺"` smiley face) is the character at codepoint `263a` (hexadecimal), which is 9786 in decimal base-10.

Unicode's code-point range is currently `\u0000` to `\u10FFFF` (six hexadecimal digits). Foi does not limit how many digits you can specify, but if you specify a value not recognized by Unicode, or outside this range, the expression will fail with a runtime error.

Foi does not accept typical escape sequences like `\n`, `\r`, and `\t`. Their equivalents can be specified with Unicode though:

```java
`"This continues`\uA`on a new line";
// This continues
// on a new line

`"Here's a `\u8` tab";
// Here's a      tab
```

**NOTE:** The `\u..` escape sequence is *only* valid as the sole expression in an interpolated string literal expression slot; it **cannot** appear standalone in other expression positions throughout the language.

#### Space-Collapsing Escaped Strings

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

#### Nested Interpolation

Nesting interpolated string literals inside other interpolated expressions is not common, but it can be necessary in some circumstances.

Consider this (broken) example:

```java
`"My current book: `uppercase(`"*`title`* by `author`")`.";
// throws parser error at the ` to the right of the (
```

The `` `" `` at the start of the first argument to the `uppercase(..)` call is ambiguous grammatically; it could be delimiting the end of the expression (albeit an invalid expression) and then the end of the string literal itself, or it could be starting a nested interpolated string literal as the function-call argument.

To avoid such ambiguity, the grammar/parser rejects when encountering *that* bare `` `" `` sequence inside any interpolated expression.

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

Foi has two structured value categories -- Tuples and Records -- that share a single literal syntax. The form is an angle-bracketed comma-separated list of entries:

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

    - If `isComputed(e.key)`: let `key` be the result of `computeKey(e.key)`; let `value` be the result of `ResolveStructureValue(e.value)`; let `hasKeyed` be `true`

    - If `isSpread(e.value)`:

        * If `HasPick(e.value)`: let `spreadValue` be the result of `ComputePick(ResolveStructureValue(e.value))`

        * Otherwise: let `spreadValue` be `ResolveStructureValue(e.value)`

        * Let `[spreadEntries, spreadNextIndex, spreadHasKeyed]` be the result of `GetEntries(spreadValue,i)`

        * Let `entries` be the concatenation of `entries` and `spreadEntries`

        * Let `i` be `spreadNextIndex`

        * Let `hasKeyed` be `hasKeyed or spreadHasKeyed`

        * Continue (4)

    - If `isConcise(e)`: let `key` be `e.name`; let `value` be the result of `ResolveStructureValue(e.value)`; let `hasKeyed` be `true`

    - Otherwise: let `key` be `e.key`; let `value` be `ResolveStructureValue(e.value)`; let `hasKeyed` be `true`

    - Append `[ key, value ]` to `entries`

5. Return `[entries, i, hasKeyed]`

----

The `ResolveStructureValue(value)` steps are:

1. If `IsStructure(value)`: return the result of `DefineStructure(value)`

2. Return `value`

#### §1.5.2 Tuple-Form Literals

When non-keyed entries are the only entries in a structure, it's interpreted as a Tuple:

```java
def coords: < 10, 20 >;
def empties: < empty, empty, empty >;
def nested: < < 1, 2 >, < 3, 4 > >;
def single: < 42 >;
```

Trailing commas are permitted and contribute nothing.

#### §1.5.3 Record-Form Literals

If there are any keyed entries present, the structure is interpreted as a Record. Any non-keyed entries in an otherwise Record are keyed as their numeric index (as in Tuples).

```java
def point: < x: 10, y: 20 >;
def order: < id: 123, items: < < price: 29.97 > > >;
```

**Entry forms** for named entries:

- `name: expr`: explicit name, explicit value.
- `:name`: concise form. The entry name is `name` (a string), and its value is the result of evaluating the identifier `name` in the current environment (i.e., `<:name>` is shorthand for `<name: name>`). To name an entry from a chained source, use `&` spread instead: `<&name.path>` (see §1.5.4).
- `%expr: value`: computed entry name (evaluating `expr`).

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

Foi also has monadic values (`Id`, `None`, `Maybe`, `Either`, `List`, `Promise`, `IO`, etc), suspended-computation values (`Lazy@`, `Gen@`), and tagged sentinels (`Done@`). These are catalogued briefly here as members of the value universe; their construction, extraction, and monadic operations are specified in later sections:

- `Done@` and the loop lifecycle: §6.
- Monadic value constructors and the runtime contract: §7.
- Suspension and force: §7.

For §2's purposes it suffices that all of these are values: they can be stored in slots, bound to names, picked from Records, and passed around like any other value.

---

## §2 Bindings & Data Access

This section specifies how names come into existence, how they are reassigned, how blocks introduce nested scopes, how function values capture their environment, and how Record and Tuple contents are accessed via picks and destructured into bindings.

### §2.1 The `def` Statement

A `def` statement introduces a new name in the current frame, allocates a slot for it, and initializes the slot with a value:

```java
def age: 42;
```

**Abstract execution:**

1. Allocate a fresh slot in the current frame, associated with the name `age`.
2. Evaluate the initializer expression `42` in the current environment.
3. Store the resulting value into the slot.

A `def` slot persists for the lifetime of its frame. When the frame is exited, the slot is no longer reachable except via closures captured before exit (§2.11).

#### §2.1.1 `def` Placement: Top Of Scope

`def` statements must appear at the top of their scope. Specifically: within any scope (module, function body, or block), `def` statements must precede all other statements except other definitional forms (`defn`, `deft`, and `import`) which may interleave freely with `def` at the top.

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

You'd rarely have a block with only `def` statement(s) in it and no evaluated statements/expressions below them. But in this example, the `def y: 42` statement has `42` as a completion value, and that same `42` value is adopted by the `{ }` block expression. Then, the same `42` value is assigned to `x`. Finally, this also means the completion value of `def x: ..` is also `42`.

### §2.2 The `Lazy@` Construct

A `Lazy@` expression defers the resolution of one or more identifier references until those identifiers have been bound in the current scope's `def` statement(s) section. It is the mechanism by which a definitional initializer may refer to bindings that exist alongside it -- generally after, but can appear before, too -- in the same section, including the binding itself being defined.

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

This pattern produces an intermediate record that exists only as a scaffold for the corrected version. Beyond the wasted construction, the `:=` introduces consequences that the program did not actually intend: the binding becomes reassignable, any enclosing function must declare `:over (life)` (§2.6) to acknowledge the non-constancy, and local reasoning about `life` weakens because the name now refers to different values at different points in the scope. None of these costs reflect the program's intent, which was to construct a single value with a self-referential field.

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

This is a runtime error (not detectable at compile time). It's reported at the unresolved name (i.e., in `seed * 2`) inside the other scope's executing body; the function body is attempting to force a thunk from a scope it doesn't own, which is not permitted.

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

The `%` effector operator dispatches to such deferred value's effect-evaluation hook (if present); when a value has no such hook, `%` acts as the identity on the value.

A `Lazy@` thunk exposes no such hook. Resolution is performed exclusively by the carry-and-force machinery (§2.2.3 through §2.2.5), which is not user-callable. So `x%` for a `Lazy@`-bound name behaves as identity, the same as a bare `x` read.

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

The language treats observably-constant bindings as candidates for the type system's constancy annotation (the `:over` form, §9) and for optimizations that depend on immutability.

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

The `:=` operator reassigns the slot of an existing binding:

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
def foo: 42;                // ill-formed: defn foo hoists to scope-top
defn foo() ^ 1;
```

```java
defn foo() ^ 1;
def foo: 42;                // ill-formed: defn foo is already bound at scope-top
```

```java
def foo: 42;
def foo: 99;                // ill-formed: foo already bound in this scope
```

```java
defn foo() ^ 1;
defn foo() ^ 2;             // ill-formed: foo already bound (both hoist)
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

### §2.7 `deft` (forward reference; details in §9)

`deft` introduces a named type:

```java
deft Age: int;
```

`deft` hoists by the same kind of rule as `defn`. Type names declared with `deft` are visible throughout their enclosing scope. Detailed semantics are specified in §9.

### §2.8 `defn` (forward reference; details in §3)

`defn` introduces a named function binding:

```java
defn double(v) ^ v * 2;
```

The function value `defn(v) ^ v * 2` is bound to the name `double`. Per §2.5, `defn` hoists and the binding is structurally constant. Detailed semantics -- parameter modifiers, body forms, preconditions, named arguments, operator-as-function, curry and uncurry -- are specified in §3.

For §2's purposes only: `defn` introduces a binding (like `def` does), it hoists, and it cannot be reassigned with `:=`.

### §2.9 Block scoping

Foi has three syntactic block forms. They all introduce a new frame whose parent is the enclosing environment.

#### §2.9.1 Bare Block Expression: `{ stmts }`

A bare block expression introduces a new frame and evaluates its statements in sequence.

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

This is the **DefBlockStmt** form. The leading `def` keyword anchors the binding region; the parenthesized clause lists the bindings that exist in the block's frame from the top of `body`.

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

This construct (`(..) { .. }`) is the first variation of the **BlockExpr** form.

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

This construct (`(..) { .. }`) is another variation of the **BlockExpr** form, which appears only at **implicit-input positions**: comprehension RHS, pipeline RHS, and pipeline-bodied function body. The enclosing context supplies an implicit input value.

It looks like §2.9.3, but a no-init entry may take its value from the context's implicit input rather than defaulting to `empty`. How many implicit inputs the context supplies, and which entries they correspond to, depends on the host construct: a comprehension like `~each` or `~map` supplies one (each element); `~fold` supplies more than one; a pipeline `#>` supplies the topic; a pipeline-bodied function supplies its positional argument.

**Abstract execution:**

1. The enclosing context provides an implicit input value `__input`.
2. Allocate a fresh frame, parent-linked to the current environment.
3. For each entry in the defs clause, in source order:
    1. Identifier `name: expr`: allocate the slot, evaluate `expr` in the new frame, store the value.
    2. Identifier `name` (no initializer): allocate the slot. If the context supplies an implicit input for this entry, bind that input; otherwise store `empty`.
    3. Destructure target `<...>: source`: evaluate `source` and destructure per §2.13.
    4. Destructure target `<...>` (no initializer): destructure the context's implicit input for this entry as the source, per §2.13.6.
4. Evaluate `body`'s statements in the new frame, in source order.
5. The block's value is the value of its final value-bearing expression.

**Implicit-or-empty default:** in any defs-init clause, a no-init entry's binding source is the implicit input from the enclosing context if one exists, otherwise `empty`. Identifier-no-init and destructure-no-init follow this same rule. At positions where no implicit input is provided (§2.9.2, §2.9.3), an Identifier-no-init resolves to `empty` and a destructure-no-init is rejected as having no source. At positions where an implicit input is provided (§2.9.4), both forms bind from that input.

**Why four block forms:** the grammar distinguishes (a) bare block, no bindings clause (§2.9.1); (b) `def`-prefixed bindings statement, no implicit source (§2.9.2); (c) bindings expression with no implicit source, host-attached to guards and match consequents (§2.9.3); and (d) bindings expression with an implicit source from the enclosing context: at comprehension RHS, pipeline RHS, or pipeline-bodied function body (§2.9.4).

### §2.10 Module scope

The outermost scope of a module follows the same `def`-at-top rule as a bare block: `def`, `defn`, and `deft` may interleave at the top of the scope, and general statements follow. The module's frame is the root of the frame chain for all expressions evaluated within the module.

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
f();                        // 2
```

#### §2.11.1 Per-Iteration Freshness

Inside loop blocks (`~each` and the comprehension family, §6), each iteration allocates a **fresh** frame for its locals. Closures captured during one iteration close over that iteration's frame, not over a shared mutable variable:

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

Each closure captures the frame in which its iteration ran; that frame is distinct for each iteration. This rule is non-negotiable for Foi's loop semantics; it is what makes `~each` compose correctly with closure-bearing bodies.

### §2.12 Pick Expressions

A pick reads one or more values from a Record or Tuple. The single-access forms produce one value; the multi-pick forms produce a new Record containing the picked entries.

#### §2.12.1 Single property access: `.name`

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

#### §2.12.7 Mixed multi-pick

Static names, positional indices, computed names, and spreads may all appear in a single multi-pick. Entries are evaluated in source order -- relevant for side effects in `%expr` computed entries and for evaluation of `&src` spread sources -- but the resulting Record follows the unordered-identity rule (§1.5): two entries that resolve to the same slot name produce one entry in the result, since the source is read once per multi-pick and each entry reads the same underlying slot.

```java
// rec: < x: 1, y: 2, z: 3 >
// extras: < "y", "z" >

rec.<x, &extras>;           // < x: 1, y: 2, z: 3 >
```

### §2.13 Destructured Bindings

A destructured binding extracts one or more values from a Record or Tuple and binds them to names in the current frame. Destructure targets appear at four positions: `def` statements, the defs-init clause of `def (...) {...}` and `(...) {...}` blocks, function parameter lists, and pattern-match clauses (§5).

The target shapes are:

- `:name`: concise (i.e., `name: name`)
- `:source.name`: concise-tail (i.e., `name: source.name`)
- `name: source.other`: renamed
- `#name`: full-context capture
- `name: [sourceExpr]`: dynamic source

#### §2.13.1 Concise Form

```java
def
    :orderID,
    :items.0.price
>: getOrder(123);
```

The concise form `:path` denotes a destructure entry whose bound name is taken from the terminal segment of `path`. With no path tail (`:orderID`), the entry name and the slot read from the source are the same. With a path tail (`:items.0.price`), the entry reads through the path and binds the terminal segment's name (`price`).

**Per-entry abstract execution** (against the destructure source `__src` established by §2.13.5):

1. Let `name` be the terminal segment of `path` (a static identifier; see Constraint below).
2. Read the value at the slot path `path` from `__src`. Per §2.12.1, any missing slot along the path resolves to `empty`, which propagates as the read value.
3. Allocate a slot in the current frame for `name` and store the value into it.

Constraint: the final path segment of a concise entry must be a static identifier; not an integer, not a computed expression. `:items.0` is rejected because `0` is not a valid identifier for the bound name.

#### §2.13.2 Renamed Form

```java
def < firstItem: items.0 >: getOrder(123);
```

The renamed form `name: path` decouples the bound name from the source path. The bound name is `name`, explicitly given. The source path is `path`. This form is **required** whenever the path's terminal segment fails the concise-form constraint -- an integer (`items.0`), computed expression, or any non-identifier terminal -- and is **available** whenever a bound name different from the path's terminal segment is preferred.

**Per-entry abstract execution** (against the destructure source `__src` established by §2.13.5):

1. Read the value at the slot path `path` from `__src`. Per §2.12.1, any missing slot along the path resolves to `empty`, which propagates as the read value.
2. Allocate a slot in the current frame for `name` and store the value into it.

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

**Per-entry abstract execution** (against the destructure source `__src` established by §2.13.5):

1. Evaluate `expr` in the current environment to a key value `__k` (an integer index or string slot name).
2. Read the value at slot `__k` from `__src`. Per §2.12.1, a missing slot resolves to `empty`.
3. Allocate a slot in the current frame for `name` and store the value into it.

The `[expr]` may also appear as the *root* of a longer path: `def < deepest: [k].sub.0 >: items;` evaluates `k`, picks `[k]` from the source, then reads through `.sub.0`. See §2.13's target shapes list and the grammar's `DestructureNamedDef` base-of-`BracketExpr` option.

#### §2.13.5 Mixed Destructure

A destructure target may mix any combination of the entry forms from §2.13.1 through §2.13.4:

```java
def
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

The single-evaluation of the source is load-bearing: a side-effecting source is observed exactly once regardless of how many entries extract from it, and all entries see a consistent snapshot of the source (immutable Records and Tuples make "consistent snapshot" trivial in practice, but the rule holds regardless).

#### §2.13.6 Implicit Source

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

**Abstract execution:** identical to §2.13.5, except that step 1 is supplied by the enclosing context rather than evaluated from a `: source` tail. The implicit input takes the role of `__src`; per-entry dispatch proceeds against it.

### §2.14 Open extensions

#### §2.14.1 The `:as` type annotation

A `def` binding (and many other expressions) may carry a `:as` tail specifying a type:

```java
def age: 42 :as int;
```

Settled: the annotation is part of the parsed AST and does not change the value the expression evaluates to.

Open: whether the annotation is checked at parse time, at a separate elaboration pass, lazily at use, or at runtime; the failure mode when the value does not satisfy the type; how `:as` participates in inference. Covered in §9.

#### §2.14.2 `:over` and constancy

Per §2.3, the operational condition for constancy is "no `:=` reassignment in scope." The full `:over` semantics -- its interaction with type inference, with mutable substructures held by constant bindings, with cross-module re-export -- is covered in §9.

#### §2.14.3 Effect tracking on bindings

Whether a `def` binding carries effect metadata in the elaborated AST is unsettled. Part of the broader effect-tracking design question.

#### §2.14.4 Computed-key dispatch

Per §2.12.5, the intended Foi semantic for computed-name picks with non-string keys is structural-equality keyed dispatch. Implementation lives at the runtime layer; migration path from bootstrap behavior is unspecified.

#### §2.14.5 Empty `< >` typing

Per §1.5.5, the polymorphism of `< >` between Record and Tuple slots may need formal type-system treatment (union, structural any-of-either, distinguished empty). Operational semantics settled; type-level representation open. Covered in §9.

## §3 Functions

This section specifies function values: how they are introduced, what their parameter shapes mean, how their bodies execute, and how a call binds arguments to parameters and produces a result.

§1.6 established that a function is a value, introduced via `defn`, first-class in every value position. §2.8 established that `defn` is a binding form that hoists and is structurally constant. §2.11 specified the closure-frame mechanics: that a function value carries the lexical frame in which it was created, and that frame is live (not a snapshot). This section assumes both and cross-refs them where relevant; it does not re-derive them.

### §3.1 Function Literal Forms

A function literal has three surface forms. All produce a function value; they differ in what name (if any) is bound, and where.

#### §3.1.1 Declaration Form

```java
defn add(x, y) ^x + y;
```

The required name (`add`) is bound in the enclosing scope as a structurally constant `defn` binding (§2.8). Through lexical scope lookup, the name is available to the function body for self-reference (recursion).

A declaration `defn` is a statement, not an expression: it cannot appear in operand position. To produce a function value at expression position with the binding effect, use a `def`-binding with a named-expression form (§3.1.2).

##### §3.1.1.1 `@`-Suffix Declaration Form

A function literal may declare itself with a `@` marker at the end of its name:

```java
defn None@() ^empty;
defn Id@(v) ^v;
defn Value@(v) ^v;
```

The `@` marker is **not part of the function's name as a binding**; `Value` is the bound name in the enclosing scope; the `@` marker is a separate AST-recorded flag on the function value. `Value` and `Value@` cannot coexist as separate bindings in the same scope.

`@`-marked functions may only have zero parameters, or one parameter; that single parameter (if any) may *not* be a gather parameter.

The marker opts the function value into the `@`-call operator (§3.8) at call sites: a no-paren single-argument call form. A `defn` may only carry the `@` marker if its outermost parameter list declares zero or one parameters; `@` on a multi-parameter `defn` is rejected at compile time.

Call shapes for `@`-marked functions (all equivalent; trivia-tolerant on both sides of `@`):

```java
Value@42;        // call: passes 42
Value @ 42;
Value@ 42;
Value @42;
Value@(42);      // ( ) is expression grouping, not arg list
```

A function defined *without* the `@` marker cannot be invoked via the `@`-call operator; `regular@x` is a semantic error against a `regular` that was not declared `@`-callable. The marker is the function value's opt-in.

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

A function defined *without* the `%` marker cannot be invoked via the `%`-call operator; `regular%env` is a semantic error against a `regular` that was not declared `%`-callable. The marker is the function value's opt-in.

The full `%`-call dispatch mechanism -- how `inst%` routes to its owning namespace's `%` hook, and the identity-fallthrough behavior when no `%` hook is declared -- is specified in §3.9.

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

A parameter list is a comma-separated sequence of parameter entries enclosed in `( )`. A function literal carries one or more parameter lists; multiple lists indicate a multi-tier (curried) shape (§3.2.5).

A parameter entry may take one of the following shapes:

- **Identifier parameter** (§3.2.1): `x`
- **Default-valued parameter** (§3.2.2): `x: expr`
- **Destructure parameter** (§3.2.3): `<:a, :b>` (with optional `: source` tail)
- **Gather parameter** (§3.2.4): `*args` (single parameter list)

#### §3.2.1 Identifier parameters

```java
defn add(x, y) ^x + y;
```

At call time, the parameter list opens a fresh frame (§2.11); each identifier parameter is bound to one positional argument value from the call site, by source position. If the call omits an argument at that position, the parameter is bound to `empty` (§1.1, §3.10.1).

#### §3.2.2 Default Parameter Values

A parameter may carry a default expression:

```java
defn add(x: 0, y: 0) ^x + y;
```

**Abstract execution at call time:**

1. For each parameter in source order:
    1. If the call site supplied a positional argument value at this position, bind the parameter to that value.
    2. Otherwise, evaluate the default expression **in the frame of the in-progress call** (parameters bound earlier in the same list are visible) and bind the result.

Default expressions can reference parameters that appear earlier in the same parameter list:

```java
defn rect(width, height: width) ^width * height;

rect(5);                            // 25
rect(5, 3);                         // 15
```

A default expression that references a later parameter is a forward reference: the later parameter has not yet been defined, and this results in an error. However, as with forward references in `def` statements, `Lazy@` (§2.2) can be used to create a deferred resolution:

```java
defn rect(width: Lazy@ height, height) ^width * height;

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
- A gather parameter `*args` may appear only in a single-tier `defn`. **Grammar permits multi-tier with gather; semantics reject. Open: enforcement location** (grammar tightening vs. shaper/interpreter rejection).
- Destructure parameters may appear at any tier.
- Defaults may appear at any tier.

### §3.3 Function Body Forms

A function body has one of three surface shapes. All three produce a single return value; multi-exit selection is expressed by pattern matching inside the body, not by multiple return statements (see §3.4 for the single-`^` rule).

#### §3.3.1 Concise return: `^expr`

```java
defn double(v) ^v * 2;
```

**Abstract execution at call time** (after parameter binding per §3.2):

1. Evaluate `expr` in the call frame.
2. The function's return value is the result.

The concise body admits any `ExprNoBlock` or a `GroupedExpr` (§13 grammar). To use a body construct that opens with `{`, paren-wrap it.

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
4. If the block completes without executing any `^`, the function returns `empty` (§3.10.9).

**Single-`^` Rule:** A block body may contain **at most one** `^` return statement, and if present it must be the body's final statement (aside from `defn` function declaration statements. Multiple exit values are expressed by placing a pattern match or guard inside that single `^`:

```java
defn classify(n) {
    ^ ?{
        [n ?< 0]: "negative";
        [n ?= 0]: "zero";
        : "positive";
    };
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
2. The pipeline chain is evaluated per §6 (pipeline semantics) with the seed as initial topic.
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

A position in a function body is **tail-position-eligible** if it's another function call whose result value can flow out without further computation; `n * fact(n - 1)` is NOT a tail call, but `fact(n - 1,curTotal)` could be.

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
- Binding initializers: In `{ def y: f(x); ^y; }`, `f(x)` is consumed by the binding, not the return. See §3.4.1.1.
- Inside a bare block expression used as `^`'s operand: In `^{ stmts; lastExpr; }`, `lastExpr` is the bare block's completion value (§2.9.1), not a return path -- the block itself is in the return path. See §3.4.1.1.

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

defn add1(x) ^f(x) + 1;                // NOT a tail call (operator consumes)
defn nested(x) ^h(f(x));               // f is NOT tail; h IS tail
```

#### §3.4.4 Single-`^` and PTC

The single-`^` rule (§3.3.2) is what allows tail-position eligibility to be a purely structural property of the AST. Because a function has at most one explicit return statement, multiple exit *values* must come from pattern-matching or guarding inside that one return; those constructs propagate eligibility to their consequents per §3.4.1. This is the design choice that lets PTC be specified without control-flow analysis.

### §3.5 Preconditions

A function definition may carry one or more **preconditions** between the parameter lists and the body:

```java
defn safeDiv(x, y) ?[y != 0]: empty ^x / y;
defn clamp(x) ?[x ?< 0]: 0 ?[x ?> 100]: 100 ^x;
```

A precondition is syntactically the same as a guard-expression: `?[cond]: consequent` or `![cond]: consequent`.

**Preconditions are call-site guards, not part of function body proper.** They are evaluated *after* the arguments have been resolved and name-bound, but *before* the function itself is invoked. Preconditions may reference only formal parameters; neither bindings from the function body's own scope nor closure-captured bindings from the enclosing scope are visible inside a precondition expression.

The function frame is provisionally allocated, and parameters are bound (preconditions may reference parameters). But if a precondition matches, the function is not invoked. Instead, the resulting value is set to the precondition's consequent value.

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

Preconditions may reference *only* formal parameters. Closure-captured bindings from the enclosing scope are not visible inside a precondition expression; preconditions are self-contained predicates over the call's arguments.

### §3.5.1 Multi-Parameter Function Preconditions

For multi-parameter (curried) function definitions with preconditions, the compiler will lift each precondition to the earliest function that can fully satisfy the precondition with the provided parameter(s).

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
defn factorial(n,res: 1)
    ?[n ?< 0]: Left@ "Undefined"
    ?[n ?> 1]: factorial(n - 1,n * res)
    ^res;
```

In this example, both the `Left@` call and the `factorial(..)` recursive call are tail-call eligible.

### §3.6 Mutable Closure-Capture Declaration: `:over`

A function literal may carry a `:over (name, name, ...)` clause between the function's preconditions (if any) and its body (but before any `:as`):

```java
defn lookup(id) :over (cache) {
    cache := cacheAppend(cache,lookupRemote(id));
    ^cache;
};
```

**Mutability and closure-capture rule.** A binding (`def`) is internally flagged as **mutable** if it is the target of any `:=` reassignment anywhere in a scope it's accessible within (§2.5). A function literal that closes over a mutable binding from its enclosing scope **MUST** list that binding in its `:over` clause. Constant bindings (those never reassigned) may be referenced freely; they need not appear in `:over`.

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

A function literal may carry a `:as Type` clause:

```java
// deft AddFunc (int,int) ^int

defn add(x, y) :as AddFunc ^x + y;
```

`:as` on a function always references a function type (§9). For §3's purposes:

- `:as Type` is transparent at runtime; it imposes no behavior beyond what §9 specifies.
- `:as` appears once, after any `:over` clause and before the body.

### §3.8 The `@`-Call Operator

Foi has a family of operators that dispatch through user-declared bindings. Each operator's behavior against a value is not fixed at the language level; it is delegated to the binding that value was constructed through. `@` is the first and most fundamental member of this family. It invokes a **type namespace** — a binding whose name serves as a type identity, a constructor when invoked, and a dispatch target when values constructed through it appear in an operator position. A single binding slot — `Maybe`, `IO`, `List`, `Vector` — plays all three roles. `?as Maybe` and `:as Maybe` check namespace identity; `Maybe@x` invokes the namespace's constructor hook; `inst%` (§3.9) dispatches an effector hook on the same namespace.

The family's operators split by where they read their dispatch target. `@` reads it from the LHS namespace handle directly: `Foo@x` looks up `Foo`'s constructor hook. Operators that act on constructed values — `%` in the next section, and eventually others — read the dispatch target from the value itself, which carries a runtime tag identifying its owning type namespace. Both routes converge on the same rule: the operator's behavior against a value is the behavior the value's type namespace declared for that operator.

The result is an operator-overloading system that behaves as a typeclass in the ad-hoc-polymorphism sense: a type namespace's set of declared hooks IS the set of operations that admit its instances. The namespace is the load-bearing entity; there is no separate class abstraction, no external instance declarations, no orphan installations. A hook is well-defined only against the namespace that declared it; a hook is invoked only against values that identify with that namespace.

The family's operator vocabulary is closed. Additional dispatch operators are added only from the existing language operator set — arithmetic, comparison, comprehension, and shape-transform operators are candidates; flow operators (`#>`, `+>`, `<+`), partial-application brackets, and access operators are not. No user-defined operator symbols, and no changes to an operator's precedence, arity, or operand contract when dispatched through a namespace. Each dispatch operator's behavior against namespaced values is a language-level extension of that operator's existing semantics, not a replacement of them.

`@` is the constructor-side member of the family. The symbol `@` is a unary call operator with an optional left-hand callee. With a callee, it dispatches a call to that function (subject to an opt-in marker on the function's definition). Without a callee, it has nothing to dispatch to, and the operator passes its right-hand value through unchanged.

This single mechanism underlies both `@`'s call-position use and its value-position use as the unary value-identity function — the latter is the former with the callee slot empty.

#### §3.8.1 `@` Used Without a Callee

When `@` is used with no left-hand callee, it has nothing to dispatch to and passes its right-hand value through unchanged. `@v` evaluates to `v`.

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

#### §3.8.2 Reference vs. Call Semantics For `@`-Marked Functions

The argument-trail expectation differs by the function's declared arity:

- A function declared with `@` and expecting one parameter: `Foo@` *alone* (no argument trail) is a **reference** to the function value, not a call. `Foo@ 42` is a call.
- A function declared with `@` and expecting zero parameters: `Foo@` *alone* is a **call** (a no-arg call). There is no argument trail to wait for; the `@`-call operator dispatches immediately. `None@` is a call producing the function's return value, not a reference to `None`.

This asymmetry exists because the call shape `Name@` has no syntactic continuation when arity is zero, so it must commit; for non-zero arity it can wait for the argument trail.

#### §3.8.3 The Two Roles Are One Operator

The value-position and call-position uses of `@` are not two separate facts but one operational rule applied with different LHS conditions:

> `@` is the unary call operator with an optional LHS callee. With a callee, it dispatches the call (subject to the `@`-marker contract on the callee's definition). Without a callee, it passes the RHS through unchanged.

The value-identity behavior in value position is what the operator does when there is no callee to call. The call behavior in call position is what the operator does when there is one. The marker requirement on `@`-marked function definitions is a contract on the callee side; it does not affect the LHS-less use form `@v`, which always behaves as identity.

### §3.9 The `%` Effector Call Operator

The symbol `%` is an effector call operator against an instance value, with an optional right-hand environment operand. It dispatches an effector call through the instance's owning namespace, subject to an opt-in `%`-marked hook (§3.1.1.2) on that namespace. If the namespace declares no such hook, the operator passes the instance through unchanged.

Where `@` invokes a namespace as a constructor (§3.8), `%` invokes an instance's namespace as an effector. An instance carries its namespace identity as a runtime contract, established at construction; `%` reads that identity to route dispatch.

The full dispatch routing is specified with the call form in §3.10.8.

#### §3.9.1 Identity Fallthrough

If the instance's owning namespace declares no `%` hook, the `%`-call form falls through to identity:

- `inst%` evaluates to `inst`.
- `inst % env` evaluates to `inst`; the `env` operand is discarded.

This fallthrough is **normative**. It admits every `@`-marked namespace's instances to the `%`-call form regardless of whether the namespace defines an effector, preserving pass-through semantics for value-like namespaces (`Lazy@`, `Id@`, etc.) that carry no effect.

Identity fallthrough applies to the dispatch lookup on a namespaced instance whose namespace declares no `%` hook. It does **not** apply to `%` against a value that carries no namespace identity — that case is rejected. `%` requires an instance whose namespace has been established through an `@`-marked construction.

#### §3.9.2 Uniformly a Call Form

`%` admits no reference-extraction form. Unlike `@`, which supports `Foo.@` to extract the constructor as a first-class function value (§3.8), there is no `inst.%` form. Every syntactic use of `%` against an instance LHS is a call: it either dispatches to the effector hook or falls through to identity per §3.9.1.

`%` also admits no LHS-less use form. `%v` is not a valid expression; `%` requires an instance LHS.

To reference the `%` operator as a first-class function value, use the operator-as-function lift form `(%)` (§3.9.3).

#### §3.9.3 `(%)` As A Function Value

The `%` operator lifts to a function value via the standard operator-as-function form (§3.13). `(%)` is a callable function whose application performs the `%`-call.

`(%)` is arity-polymorphic. It dispatches at call time on the number of arguments supplied, mirroring the `%`-call operator's LHS+RHS shape at the lifted-function layer:

- **1-arg:** `(%)(inst)` is semantically equivalent to `inst%`. If `inst`'s owning namespace declares a `%` hook, dispatch fires with `inst` as the sole argument; otherwise identity fallthrough returns `inst` unchanged.

```java
    (%)(taskInst);           // taskInst%
```

- **2-arg:** `(%)(inst, env)` is semantically equivalent to `inst % env`. If dispatch fires, the hook receives `(inst, env)`; otherwise identity fallthrough returns `inst` (discarding `env`).

```java
    (%)(taskInst, myEnv);    // taskInst % myEnv
```

The `%` operator returns a runtime error if `(%)` is called with zero arguments or with 3+ arguments.

The prime form `(%')` reverses the 2-argument order to `(env, inst)`; semantically equivalent to `(%)(inst, env)` with arguments swapped.

### §3.10 Call Semantics

This section specifies what happens when a function value is invoked. It covers the regular `foo(..)` call form and the alternate `@`-call and `%`-call forms.

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
defn f(x, y: x + 1) ^< :x, :y >;

f(5);                                    // < x: 5, y: 6 >
f(5, 10);                                // < x: 5, y: 10 >
f(5, empty);                             // < x: 5, y: 6 >
f(5, );                                  // < x: 5, y: 6 >

defn g(x)(y: x * 2) ^< :x, :y >;

g(3)();                                  // < x: 3, y: 6 >
g(3)(10);                                // < x: 3, y: 10 >
```

Tiers act like nested frames: an inner-tier default resolves names by walking outward through already-bound tiers, exactly as the body would.

A default expression may not reference a later parameter in the same tier, nor a parameter in a not-yet-bound (inner) tier.

#### §3.10.3 Gather Binding

A `*gather` parameter takes the place of an entire tier — a tier is either all-positional non-gather (§3.10.1) or a single `*gather`; the two shapes do not mix within a tier.

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

Spread is positional-only: it is not admitted in a named-argument call (§3.10.6). A call's argument list is either entirely positional (with optional skip slots and spreads) or entirely named — never mixed.

**Open:** Whether a Record with named slots whose names correspond to parameters may be spread into a call as a named-argument expansion (`f(...rec)`) is undecided. The current spec rejects all Record spread; admitting a named-arg form remains under consideration.

#### §3.10.6 Named Arguments

A regular function call (not `@` or `%`) may bind arguments by parameter name instead of position:

```java
defn add(x: 0, y) ^x + y;

add(x: 3, y: 4);                         // 7
add(y: 5);                               // 5 — x defaults to 0
```

A single call must use either positional arguments (with optional skip slots and spread, per §§3.10.4 and 3.10.5) or named arguments — the two forms cannot be mixed within a single call.

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

To reference the constructor hook as a function value, use `Foo.@` (§3.8). To invoke the operator-function form, use `(@)(Foo, x)` (§3.12).

The `@` operator, including how `Foo.@` resolves at call time and how the resulting instance carries its owning namespace identity, is specified in full in §3.8.

#### §3.10.8 The `%`-Call Form

An instance constructed through an `@`-marked namespace that also declares a `%`-suffix hook (§3.1.1.2) is invoked with the `%`-call form:

- `inst%` invokes the effector hook with `inst` as the sole argument.
- `inst % env` invokes the effector hook with `inst` and `env` as arguments.

Dispatch resolves the effector hook through the instance's owning namespace, carried as a runtime contract on the instance. Whitespace around `%` is optional.

If the instance's owning namespace declares no `%` hook, the `%`-call form falls through to identity per §3.9.1.

The `%`-call form admits exactly zero or one operand. Spread arguments and named arguments are not part of this form.

To invoke the operator-function form, use `(%)(inst)` or `(%)(inst, env)` (§3.9.3).

The `%` operator is specified in full in §3.9.

#### §3.10.9 Multi-Tier Function Call

A call against a function value with multiple parameter tiers binds the outermost tier per §3.10.1. The body of a non-innermost tier evaluates to a function value over the next tier; that value is the result of the tier call.

```java
defn add(x)(y) ^x + y;

add(3);                                  // function value over (y)
add(3)(4);                               // 7
```

Each subsequent tier call evaluates per §3.10.1 against that tier's parameter list.

Per §3.2.5, loose-curry is not provided: each tier call must satisfy that tier's parameters with its own call. To flatten the tier shape into a single argument list, use `\/` (§3.12.3).

Tiers act like nested frames for name resolution: an inner-tier body, and any default expression in an inner tier (§3.10.2), can reference parameters from outer tiers.

Preconditions are hoisted to the highest/earliest tier at which their references can be satisfied by that tier's parameters (§3.5).

#### §3.10.10 The `empty` Completion Fallthrough

A function call evaluates to `empty` when:

1. The body is a concise return `^expr` and `expr` evaluates to `empty` — `empty` flows out normally.
2. The body is a block body and no `^` statement executed — the block completed without an explicit return.
3. A precondition matched with `empty` as its consequent (e.g., `?[bad]: empty`).

This is consistent with §1.1's enumeration of `empty`-producing positions. Callers that need to distinguish "no return path taken" from "explicit `empty` return" must wrap the return at the function's signature level with `Maybe`, `Either`, or a comparable monadic carrier.

---

## §3.11 Partial Application: `f|arg,arg,..|`

The `f|arg,arg,..|` form produces a partially-applied function value:

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
4. The combined argument list is passed to `f` per §3.10.1 — at which point parameter binding, default evaluation, skip-to-`empty` binding (§3.10.4), surplus discard, and precondition evaluation occur normally.

#### §3.11.2 Arity Independence

Partial application is independent of `f`'s arity — capture is syntactic, and arity reconciliation happens at the final call:

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

Spread sources are evaluated and captured at partial-application time. This preserves "arguments are remembered for later" semantics even when the spread source is itself effectful — e.g., a generator yielding values.

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

The all-positional-or-all-named rule (§3.10.6) is enforced on the *combined* argument list at final-call time, not on either side independently. If the combined list contains a mix of positional and named entries — even when each side is internally uniform — `f` rejects the call:

```java
add|x: 4|(5);                            // ERROR — combined: < x: 4 > and 5 (mixed)
add|3|(y: 5);                            // ERROR — combined: 3 and < y: 5 > (mixed)
```

#### §3.11.7 Multi-Tier Callees

Partial application captures against a single tier of function application — the outermost tier of `f`. On final call, the outermost tier is bound per §3.10.1 using the combined argument list; the result is whatever the outermost tier would return — the body result for a single-tier `f`, or the next-tier function value for a multi-tier `f`.

```java
defn add(x)(y) ^x + y;

def addOuter: add|3|;

addOuter();                              // function value over (y) — outer tier completes with x = 3
addOuter()(4);                           // 7
```

To partially apply against a deeper tier, complete the outer tiers first and partially apply the resulting function value: `(add(3))|4|`.

#### §3.11.8 `@`-Marked and `%`-Dispatched Functions

Partial application is exclusive to standard call-form functions; a namespace declared via `defn Foo@(..)` (§3.1.1.1), or a hook declared via `defn Foo%(..)` (§3.1.1.2), opts out of this `f(args)` call surface.

`Foo|x|` and `Foo.@|x|` raise runtime errors; likewise, if `inst` is an instance of `Foo@` with an accompanying `Foo%`, `inst|x|` is rejected.

### §3.12 Function-Shape Transforms

Foi provides four operator-shape transforms on function values: prime `'` (reverse), mountain `/\` (curry), valley `\/` (uncurry), and the primed-inverse forms of each. All four are postfix operators on the function value's grammar position. All four can also appear as operator-as-function (`(/\)`, `(\/)`, `(/\')`, `(\/')`, `(')`); see §3.13.

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

The reverse is **semantic, not syntactic** — `f'` is a function value carrying a reverse-then-apply behavior, applicable at any later call. The reversal applies to the complete argument sequence delivered at the final call, including when composed with partial application (§3.11) or pipeline topic placement.

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

`/\` operates on `f`'s declared arity (the count of its outermost-tier parameters), not on multi-tier curry shape. For a function already declared with multi-tier curry shape, `/\` is idempotent — the wrapper just passes arguments through.

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

Any operator can be lifted to a function value by parenthesizing it: `(+)`, `(?and)`, `(.)`, `(.<a, b>)`. The `@` operator lifts the same way: `(@)` evaluates to the unary value-identity function (the `@`-call operator with no LHS callee; see §3.8.1).

The lifted value is a callable function whose application invokes the operator on the supplied arguments. The prime form `(+')` produces the reverse of the lifted operator (§3.12.1).

The per-operator argument arity, argument types, and semantic behavior of each lifted operator is specified in the section that owns that operator (e.g., `(+)` per §1.3 numeric arithmetic; `(.)` per §2.12 indexed access; `(.<a, b>)` per §2.12 multi-pick; etc.). §3 specifies only the lifting mechanism:

1. The parenthesized operator-symbol expression produces a function value.
2. Calling that function value evaluates the operator against the supplied arguments.
3. The prime `'` form applies §3.12.1 reverse semantics to the lifted function value.
4. Operator-as-function values compose freely with `|args|` (§3.11), `/\` (§3.12.2), `\/` (§3.12.3), `+>` (composition, §6), and `#>` (pipelines, §6).

## §4 Decisions and Guards

This section specifies the standalone **guard expression** form, `?[cond]: consequent` (and its `![cond]: consequent` negated form), together with its shared **CondClause** primitive.

A guard expression produces a value based on a single boolean test. If the test's polarity-adjusted result is `true`, the guard **matches** and the consequent is evaluated to produce the guard's value. If the guard does not match, the consequent is not evaluated and the guard's value is `empty` (§1.1).

The CondClause primitive introduced here is also the atomic decision form embedded in function preconditions (§3.5), the independent form of pattern matching (§5), and the conditional-form of the `~each` loop comprehension (§6). Pattern matching (§5) extends the single-clause shape defined here to a multi-clause first-match-wins cascade, with optional topic dispatch and an optional else clause; the forms share the `?[cond]:` clause syntax and the `?/!` polarity vocabulary, and diverge on how many clauses combine and on whether a shared topic threads through them. A single-clause independent-match expression is semantically equivalent to the guard expression form here; the standalone guard is the shorter surface.

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

1. Evaluate the test expression in the current environment.
2. The test must produce a boolean value (`true` or `false`). Non-boolean values are ill-typed per §1.2; the language provides no implicit coercion to boolean at this position.
3. Apply the polarity:
    1. If polarity is `?`, the clause **matches** when the test is `true`.
    2. If polarity is `!`, the clause **matches** when the test is `false`.
4. If the clause matches, its enclosing form (guard expression, precondition, or pattern-matching arm) proceeds to evaluate the corresponding consequent. If it does not match, the enclosing form takes its non-match path.

The `!` polarity negates the *test's truth relative to matching*, not the value of the test. This is distinct from the unary `!` operator's function-complement / boolean-flip semantics; a `!` at the head of a CondClause is a polarity sigil, not application of the `!` operator to the test.

**Reachability.** A CondClause is not a standalone form. It appears only embedded:

- In a guard expression (§4.2): `CondClause _ Colon _ consequent`.
- In a function precondition (§3.5): syntactically the same shape at the position between the parameter list and the body, with a slightly narrower consequent grammar.
- In an independent pattern-matching arm (§5), where the polarity sigil is optionally elided (bare `[test]` reads as implicit `?[test]`).
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

### §4.3 Consequent Forms

The consequent slot admits three shapes: an expression consequent, a block consequent, and an assignment consequent. The consequent's shape determines what value the guard produces on match, but the match/no-match semantic of §4.2 is uniform across all three.

#### §4.3.1 Expression Consequent

Any expression is admitted. On match, the expression evaluates in the current environment; its value is the guard's value.

```java
?[x ?> 0]: log(x);
?[x ?< 0]: Left@ "negative";
?[isReady]: task ~< process;
```

**NOTE:** As shown, these are *statements*; their resultant completion values are not preserved or used by the surrounding program. If one such statement were to appear as the final statement in a block, its completion value would be adopted as the block-expression's result value, which would further propagate up the expression evaluation chain.

#### §4.3.2 Block Consequent

The consequent may be a block expression in either of two forms: a **bare block** with no bindings clause, or a **def-block** with a leading bindings clause.

**Bare block:**

```java
?[isReady]: {
    log("starting");
    initialize();
    ^status
};
```

**Def-block:**

```java
?[x ?< 3]: (y: 3) {
    log(x + y);
    ^y * 2
};
```

The bare block reaches the consequent as an ordinary expression; its execution semantics are the bare-block rules of §2.9.1. The def-block form is the **BlockExprStrict** variant of §2.9.3, host-attached to the guard's colon-led body slot. Two properties are load-bearing at the def-block position:

- The def-block form is *host-attached*, admitted only at the colon-led body slots of guards (this section) and match consequents (§5). A bare `(defs) { body }` at a value-expression slot (for example, a `def x:` initializer) is a parse error.
- The def-block form uses the **strict-optional** defs-init inner: Identifier entries may omit their initializer (defaulting to `: empty`), but destructure-target entries require an explicit initializer, because a guard consequent has no implicit input to bind against.

On match, the block executes; its final value-bearing expression is the guard's value. On non-match, the block is not evaluated and the guard's value is `empty` per §4.2.

#### §4.3.3 Assignment Consequent

The consequent may be an assignment expression:

```java
?[shouldLog]: lastLog := currentTime;
?[valid]: counter := counter + 1;
```

This form has a load-bearing property that the other consequent shapes do not carry as directly:

**The assignment evaluates only when the guard matches.** When the CondClause does not match, the RHS is not evaluated and the target's slot is not mutated. The guard expression's value is `empty` (per §4.2), unchanged from any other non-match outcome.

**When the guard matches, the guard's value is the assigned value** -- the value written to the target's slot. This follows compositionally from three properties: the guard's value on match is the consequent value (§4.2); an assignment expression's value is the assigned RHS; and the consequent slot receives the assignment expression directly.

**Abstract execution when the guard matches:**

1. Evaluate the RHS in the current environment, producing a value `v`.
2. Assign `v` to the target per §2's assignment semantics.
3. The guard expression's value is `v`.

**Abstract execution when the guard does not match:**

1. The RHS is not evaluated.
2. The target's slot is not mutated.
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

**Related forms.**

- **Function preconditions (§3.5)** are CondClause-headed forms occupying the position between a function's parameter list and its body. They share the `?[cond]:` clause syntax and polarity vocabulary defined here, with two differences: the consequent grammar is narrower (`ExprNoBlock` rather than `BlockExprStrict | Expr`), and matching shortcircuits the function body rather than producing the guard's value in place. See §3.5 for precondition semantics and §3.5.1 for the multi-parameter tier-lifting rule.

- **Pattern matching (§5)** extends this single-clause form to multi-clause cascades. An independent-match expression (`?{ ?[c1]: e1; ?[c2]: e2; ?: else }`) is a first-match-wins ordering of clauses that reuse the CondClause primitive defined here; a single-clause independent match is semantically equivalent to a guard expression. A dependent-match expression (`?(topic){ ... }`) additionally threads a shared topic through its clauses via the DepCondClause form, which has no counterpart in the guard-expression surface.
