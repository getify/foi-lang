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

- §1 Values *(this document)*
- §2 Bindings & Data Access *(this document)*
- §3 Functions *(planned)*
- §4 Decisions and guards *(planned)*
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

In the anonymous form, `defn(params) ^ body` is an expression producing a function value, with no name binding in any scope.

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
defn helper(v) ^ v + 1;
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

#### §2.2.9 The `%` Force Operator and `Lazy@`

Conceptually, a `Lazy@` thunk is a syntactically-simplified deferred value (e.g., IO, State).

The `%` postfix dispatches to such deferred value's evaluation hook (if present); when a value has no such hook, `%` acts as the identity on the value.

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
defn make(n) ^ defn(x) ^ x + n;
def addTen: make(10);
addTen(5);                  // 15
```

**Abstract execution:**

1. `make(10)` evaluates `make`'s body in a frame where `n` is bound to `10`.
2. The body returns a function value `defn(x) ^ x + n`. The function captures the frame in which it was created (the frame with `n: 10`).
3. `addTen(5)` calls the captured function, allocating a new frame where `x` is bound to `5`, with the captured frame as parent.
4. The body `x + n` resolves `x` in the local frame and `n` in the parent (captured) frame.

**Captured frames are live, not snapshots:** the closure references the frame itself; subsequent `:=` reassignments to bindings in that frame are observable through the closure on its next call.

```java
def x: 1;
def f: defn() ^ x;
x := 2;
f();                        // 2
```

#### §2.11.1 Per-iteration Freshness

Inside loop blocks (`~each` and the comprehension family, §6), each iteration allocates a **fresh** frame for its locals. Closures captured during one iteration close over that iteration's frame, not over a shared mutable variable:

```java
def fs: < >;
0..3 ~each (i) {
    fs := < &fs, defn() ^ i >;
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
