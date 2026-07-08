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
- §5 Pattern matching *(done)*
- §6 Suspension and evaluation control *(done)*
- §7 Loops and comprehensions *(planned)*
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

Foi also has monadic values (`Id`, `None`, `Maybe`, `Either`, `List`, `Promise`, `IO`, etc), suspended-computation values (`Lazy@`, `Gen.`), and tagged sentinels (`Done@`). These are catalogued briefly here as members of the value universe; their construction, extraction, and monadic operations are specified in later sections:

- Suspension and evaluation control: §6
- `Done@` and the loop lifecycle: §7
- Monadic value constructors and the runtime contract: §7

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

`deft` introduces a named type:

```java
deft Age: int;
```

`deft` hoists by the same kind of rule as `defn`. Type names declared with `deft` are visible throughout their enclosing scope. Detailed semantics are specified in §9.

### §2.8 `defn` (see §3)

`defn` introduces a named function binding:

```java
defn double(v) ^v * 2;
```

The function value `defn(v) ^v * 2` is bound to the name `double`. Per §2.5, `defn` hoists and the binding is structurally constant. Detailed semantics -- parameter modifiers, body forms, preconditions, named arguments, operator-as-function, curry and uncurry -- are specified in §3.

For §2's purposes only: `defn` introduces a binding (like `def` does), it hoists, and it cannot be reassigned with `:=`.

### §2.9 Block Scoping

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

This construct (`(..) { .. }`) is another variation of the **BlockExpr** form, which appears only at **implicit-input positions**: comprehension RHS and pipeline RHS. The enclosing context supplies an implicit input value.

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
    4. Destructure target `<...>` (no initializer): destructure the context's implicit input for this entry as the source, per §2.13.6.
4. Evaluate `body`'s statements in the new frame, in source order.
5. The block's value is the value of its final value-bearing expression.

**Implicit-or-override default:** at this position, an entry's primary binding source is the implicit input from the enclosing context. A no-init entry uses that input directly, falling back to `empty` when the context supplies none. A `:?`-init entry uses that input when non-empty and evaluates its init expression only when the input is empty, overriding it. At positions where no implicit input is provided (§2.9.2, §2.9.3), the unconditional `:` sigil is used instead: an Identifier-no-init resolves to `empty`, an Identifier-`:`-init evaluates its expression unconditionally, and a destructure-no-init is rejected as having no source.

**Why four block forms:** the grammar distinguishes (a) bare block, no bindings clause (§2.9.1); (b) `def`-prefixed bindings statement, no implicit source (§2.9.2); (c) bindings expression with no implicit source, host-attached to guards and match consequents (§2.9.3); and (d) bindings expression with an implicit source from the enclosing context, at comprehension RHS or pipeline RHS.

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

A pick reads one or more values from a Record or Tuple. The single-access forms produce one value; the multi-pick forms produce a new Record containing the picked entries.

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

A destructured binding extracts one or more values from a Record or Tuple and binds them to names in the current frame. Destructure targets appear at four positions: `def` statements, the defs-init clause of `def (...) {...}` and `(...) {...}` blocks, function parameter lists, and pattern-match clauses (§5).

The target shapes are:

- `:name`: concise (i.e., `name: name`)
- `:source.name`: concise-tail (i.e., `name: source.name`)
- `name: source.other`: renamed
- `#name`: full-context capture
- `name: [sourceExpr]`: dynamic source

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

#### §2.13.5 Mixed Destructure

A destructure target may mix any combination of the entry forms from §2.13.1 through §2.13.4:

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

A function defined *without* the `@` marker cannot be invoked via the `@`-call operator; `regular@ x` is a semantic error against a `regular` that was not declared `@`-callable. The marker is the function value's opt-in.

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

The full `%`-call dispatch mechanism -- how `inst%` routes to its owning namespace's `%` hook, and the identity-fallthrough behavior when no `%` hook is declared -- is specified in §3.9.

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

**Admitted markers.** The comprehension markers admitted at declaration position are:

- Tier 1 (no language-provided default): `~<`, `~each`
- Tier 2 (language-provided default composition at call sites): `~map`, `~ap`, `~filter`, `~fold`, `~cata`, `~foldR`

Both tiers use identical declaration syntax; the tier difference affects call-site behavior when the hook is absent from a namespace (below).

The `~<<` (do) and `~<*` (looping-do) comprehensions are not admitted at declaration position pending design of a per-step-controllable override interface for these operators. Their call-site behavior stands independently -- nested `~<` / `~map` composition per each namespace's declared primitives (§3.10.9) -- and does not depend on the override interface's shape. The override interface is deferred as its own design question; the yield mechanism (TBD) is the current leading candidate. Call-site use of `~<<` / `~<*` continues to dispatch via the composition machinery over declared primitives; these operators are simply not user-overridable in this specification revision.

**Canonical markers.** The `~<` (bind) hook has surface aliases at call sites: `~chain`, `~bind`, `~flatMap`. At declaration position, only the canonical `~<` form is admitted. `defn Foo~chain(..)`, `defn Foo~bind(..)`, and `defn Foo~flatMap(..)` are rejected at compile time with a message directing the author to declare the hook as `defn Foo~<(..)`. All four spellings continue to dispatch to the `~<` hook at call sites (§3.10.9).

**Adjacency.** Strict no-trivia between the identifier and the marker, mirroring `Foo@` and `Foo%` at their declaration positions. Trivia is admitted between the marker and the first paren-set (mirrors normal `defn` paren spacing).

**Missing hook at call site.** Tier 1 markers (`~<`, `~each`) have no default; a comprehension expression against a namespace that has not declared the corresponding hook is rejected at compile time. Tier 2 markers have language-provided defaults; missing-hook call sites expand to a composition over the namespace's declared primitives (§3.10.9). Where a Tier 2 default's precondition does not structurally fit the namespace shape (e.g., `~foldR` on an infinite structure), the type checker rejects the expression at compile time.

**Multi-decl uniqueness.** At most one hook per marker per namespace per scope; multiple declarations of the same marker on the same namespace are rejected at compile time.

**Parameter constraints.** The outermost parameter list must declare the fixed shape for the hook's operation. Gather parameters are not admitted in the outermost list. Subsequent (curried) parameter lists are unconstrained.

The full comprehension-dispatch mechanism -- how a comprehension call site routes to its LHS's owning namespace's hook, how alias spellings normalize to canonical, how Tier 2 defaults expand, and the semantic error taxonomy -- is specified in §3.10.9.

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
2. The pipeline chain is evaluated per §??? (pipeline semantics) with the seed as initial topic.
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
defn factorial(n,res:? 1)
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

Foi has a family of operators that dispatch through user-declared bindings. Each operator's behavior against a value is not fixed at the language level; it is delegated to the binding that value was constructed through. `@` is the first and most fundamental member of this family. It invokes a **type namespace**: a binding whose name serves as a type identity, a constructor when invoked, and a dispatch target when values constructed through it appear in an operator position. A single binding slot (e.g., `Maybe`, `IO`, `List`, `Vector`) plays all three roles. `?as Maybe` and `:as Maybe` check namespace identity; `Maybe@x` invokes the namespace's constructor hook; `inst%` (§3.9) dispatches an effector hook on the same namespace.

The family's operators split by where they read their dispatch target. `@` reads it from the LHS namespace handle directly: `Foo@x` looks up `Foo`'s constructor hook. Operators that act on constructed values -- `%` in the next section, and eventually others -- read the dispatch target from the value itself, which carries a runtime tag identifying its owning type namespace. Both routes converge on the same rule: the operator's behavior against a value is the behavior the value's type namespace declared for that operator.

The result is an operator-overloading system that behaves as a typeclass in the ad-hoc-polymorphism sense: a type namespace's set of declared hooks IS the set of operations that admit its instances. The namespace is the main entity; there is no separate class abstraction, no external instance declarations, no orphan installations. A hook is well-defined only against the namespace that declared it; a hook is invoked only against values that identify with that namespace.

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

Identity fallthrough applies to the dispatch lookup on a namespaced instance whose namespace declares no `%` hook. It does **not** apply to `%` against a value that carries no namespace identity; that case is rejected. `%` requires an instance whose namespace has been established through an `@`-marked construction.

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

Spread is positional-only: it is not admitted in a named-argument call (§3.10.6). A call's argument list is either entirely positional (with optional skip slots and spreads) or entirely named; they're never mixed.

**Open:** Whether a Record with named slots whose names correspond to parameters may be spread into a call as a named-argument expansion (`f(...rec)`) is undecided. The current spec rejects all Record spread; admitting a named-arg form remains under consideration.

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

#### §3.10.9 The Comprehension-Call Form

An instance constructed through an `@`-marked namespace that also declares one or more comprehension-suffix hooks (§3.1.1.3) is invoked with a **comprehension-call form**:

```java
inst ~< fn;
inst ~map fn;
inst ~fold init fn;
```

The general shape is `LHS ~<glyph> operands...`, where `~<glyph>` is one of the comprehension markers admitted at §3.1.1.3 -- Tier 1 (`~<`, `~each`), Tier 2 (`~map`, `~ap`, `~filter`, `~fold`, `~cata`, `~foldR`), the deferred `~<<` / `~<*`, or one of the `~<` surface aliases (`~chain`, `~bind`, `~flatMap`).

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
- `~foldR`: two operands, an initial value and a folding function of `(value, accumulator)`. Hook signature: `(inst, init, fn)`.
- `~<<` and `~<*`: block operands per §16's do-comprehension grammar; not user-overridable in this specification revision (§3.1.1.3).

##### §3.10.9.3 Missing-Hook Behavior

**Tier 1** (`~<`, `~each`): no language-provided default. A comprehension expression against a namespace that has not declared the corresponding hook is rejected at compile time.

**Tier 2** (`~map`, `~ap`, `~filter`, `~fold`, `~cata`, `~foldR`): the language provides defaults that compose over the namespace's declared primitives.

The `~fold` and `~cata` markers form a **mutual-defaulting pair**: they express the same catamorphism, differing only in the None-branch handler's representation (eager value vs. thunk). Missing-hook dispatch routes through the other member of the pair:

- `~fold` missing, `~cata` present: `inst ~fold init fn` dispatches to the `~cata` hook with `() -> init` thunk-wrap.
- `~cata` missing, `~fold` present: `inst ~cata initThunk fn` dispatches to the `~fold` hook with `initThunk()` evaluated eagerly (forfeits laziness -- the cost of not declaring `~cata`).
- Both missing: rejected at compile time.

For the remaining Tier 2 markers (`~map`, `~ap`, `~filter`, `~foldR`), the default composition expands over the namespace's declared `~<` primitive and its `@` constructor hook. Where the composition's structural precondition does not fit the namespace's shape (e.g., `~foldR` on an infinite structure; `~filter` on a namespace without an "empty of shape"), the expansion is rejected at compile time.

**Open:** exact default-composition formulas per Tier 2 marker are pending the `__ns_defaults` runtime table design. The bootstrap transpiler currently emits direct dispatch at all comprehension-call sites and produces a runtime error on a missing Tier 2 hook; the default-composition wiring lands as follow-on work and does not affect declaration or call-site grammar.

##### §3.10.9.4 `~<<` and `~<*` Call-Site Expansion

At call sites, `~<<` (do) and `~<*` (looping-do) expand to nested `~<` / `~map` composition over the LHS's owning namespace's declared primitives, per §16's do-comprehension semantics. These operators are not admitted at declaration position and cannot be user-overridden in this specification revision (§3.1.1.3); their call-site expansion is fixed to the composition machinery.

The override interface for `~<<` and `~<*` is deferred as its own design question (yield mechanism candidate, TBD).

##### §3.10.9.5 Semantic Error Taxonomy

The following comprehension-call errors are reported at compile time:

1. **No owning namespace:** the LHS carries no runtime namespace identity. Comprehension dispatch requires an instance whose namespace was established through an `@`-marked construction.
2. **Tier 1 missing hook:** the LHS's owning namespace has not declared the invoked Tier 1 hook. `container ~< fn` where `Container` has no `~<` hook is rejected.
3. **Tier 2 mutual-pair both-missing:** for `~fold` / `~cata`, both members are absent. `container ~fold init fn` where `Container` has neither `~fold` nor `~cata` is rejected.
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

The `~<<` and `~<*` comprehensions do not lift to function values in this specification revision. Their RHS is a block (§16), not a value expression; there is no first-class function-call shape that supplies a block operand. Consistent with the deferral in §3.1.1.3, override of these operators awaits a per-step-controllable interface.

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

Any operator can be lifted to a function value by parenthesizing it: `(+)`, `(?and)`, `(.)`, `(.<a, b>)`. The `@` operator lifts the same way: `(@)` evaluates to the unary value-identity function (the `@`-call operator with no LHS callee; see §3.8.1).

The lifted value is a callable function whose application invokes the operator on the supplied arguments. The prime form `(+')` produces the reverse of the lifted operator (§3.12.1).

The per-operator argument arity, argument types, and semantic behavior of each lifted operator is specified in the section that owns that operator (e.g., `(+)` per §1.3 numeric arithmetic; `(.)` per §2.12 indexed access; `(.<a, b>)` per §2.12 multi-pick; etc.). §3 specifies only the lifting mechanism:

1. The parenthesized operator-symbol expression produces a function value.
2. Calling that function value evaluates the operator against the supplied arguments.
3. The prime `'` form applies §3.12.1 reverse semantics to the lifted function value.
4. Operator-as-function values compose freely with `|args|` (§3.11), `/\` (§3.12.2), `\/` (§3.12.3), `+>` (composition, §???), and `#>` (pipelines, §???).

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

The bare block reaches the consequent as an ordinary expression; its execution semantics are the bare-block rules of §2.9.1. The def-block form is the **BlockExprStrict** variant of §2.9.3, host-attached to the guard's colon-led body slot. Two properties are important at the def-block position:

- The def-block form is *host-attached*, admitted only at the colon-led body slots of guards (this section) and match consequents (§5). A bare `(defs) { body }` at a value-expression slot (for example, a `def x:` initializer) is a parse error.
- The def-block form uses the **strict-optional** defs-init inner: Identifier entries may omit their initializer (defaulting to `: empty`), but destructure-target entries require an explicit initializer, because a guard consequent has no implicit input to bind against.

On match, the block executes; its final value-bearing expression is the guard's value. On non-match, the block is not evaluated and the guard's value is `empty` per §4.2.

#### §4.3.3 Assignment Consequent

The consequent may be an assignment expression:

```java
?[shouldLog]: lastLog := currentTime;
?[valid]: counter := counter + 1;
```

This form has an important property that the other consequent shapes do not carry as directly:

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

## §5 Pattern Matching

**Pattern matching** extends the single-clause guard expression form of §4 to multi-clause **cascades**. A pattern-match expression is a sequence of clauses, each a CondClause-headed decision paired with a consequent, evaluated in source order with **first-match-wins** semantics. An optional trailing else clause supplies a default consequent when no pattern clause matches; if no clause matches and there is no else, the expression's value is `empty` (§1.1).

**NOTE:** Depending on compiler configuration, if a set of clauses does not have a default clause, and there is a *pattern-match coverage gap* -- a value could plausibly "fall through" and not match any of the clauses -- this situation can raise a compiler/type error.

Two forms are available:

- **Independent** pattern matching (`?{ ... }`): each clause carries its own CondClause, evaluated independently. The clauses share no common subject; each is a self-contained boolean test.

- **Dependent** pattern matching (`?(topic){ ... }`): a topic expression is evaluated once at match entry, then threaded as the implicit left-hand side of each clause. Each clause tests the (single, shared) topic against one or more atom expressions.

Both forms are value-bearing expressions: the matching clause's consequent value is the match expression's value. Both share the same consequent grammar and the same else-clause form; the two forms differ only in how their clauses read the input.

### §5.1 Independent Pattern Matching

An **independent pattern-match expression** is a brace-delimited sequence of clauses opened with `?{`:

```
IndepMatchExpr    := Qmark OpenBrace _ IndepMatchStmts _ CloseBrace
IndepPatternStmt  := IndepCondClause _ MatchConsequent (_ Semicolon)*
IndepCondClause   := (Qmark | Exmark)? BracketExpr
```

Each clause consists of a CondClause (with optionally-elided positive `?` polarity; see below) followed by a match consequent (§5.3). Clauses are separated by semicolons.

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

**Equivalence to guard expression.** With the exception of the optional compiler configuration that rejects coverage gaps (§5.5), a single-clause independent match with no else clause has the same semantics as a guard expression (§4.2): the consequent value on match, `empty` on non-match. The standalone `?[c]: e` form is the shorter surface for that case; the `?{ [c]: e }` form is preferred only when a second clause or an else is anticipated.

### §5.2 Dependent Pattern Matching

A **dependent pattern-match expression** evaluates a topic expression once, then threads the resulting value through each clause as the implicit left-hand side of the clause's tests:

```
DepMatchExpr    := Qmark OpenParen _ ExprNoBlock _ CloseParen
                    OpenBrace _ DepMatchStmts _ CloseBrace
DepPatternStmt  := DepCondClause _ MatchConsequent (_ Semicolon)*
```

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
DepCondExprList := DepCondExprAtom (_ Comma _ DepCondExprAtom)*
DepCondExprAtom := DepCondBoolExpr | ExprNoBlock
DepCondBoolExpr := AsTypeOp _ NamedType
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

3. **Type-check atom** (`DepCondBoolExpr`, `AsTypeOp` arm). A `?as` or `!as` operator followed by a named type; matches when the topic's type satisfies the annotation. Example: `[?as int]` matches when `T` is an `int`. Semantics for `?as` / `!as` and named types are specified in §9.

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

1. Evaluate each atom, in source order, against `T`:
    1. Bare expression atom: evaluate to `V`; the atom matches iff `T ?= V`.
    2. Operator-led atom: evaluate the RHS operand; the atom matches iff `T <op> RHS` holds.
    3. Type-check atom: the atom matches iff `T` satisfies the named type per §9.
    4. Unary-operator atom: the atom matches iff `<op> T` holds (the unary operator applied to the topic per §1.2).
2. Short-circuit at the first matching atom (no further atoms evaluated).
3. Apply the clause polarity:
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

#### §5.2.2.1 `#` Topic Not In DepCondClause

`#` is not available inside DepCondClause atoms.

The topic is already the implicit left-hand operand of each atom's operator (for operator-led atoms) or the implicit equality target (for bare expression atoms); there is no additional need to write `#`, and no binding is provided at that position.

A `#` written inside an atom does not refer to the match topic; it either resolves to an enclosing pipeline topic (per §???, if the match itself sits inside a `#>` pipeline body) or is otherwise a stale reference.

##### §5.2.2.2 Nested Dependent Match

A dependent match nested inside another dependent match's consequent establishes its own topic binding, shadowing the enclosing match's topic. Within the inner match's consequents, `#` refers to the inner topic; the outer topic is not directly reachable through `#` at that depth (the outer topic must be captured into a named binding at the outer scope if the inner needs it).

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

Consequent shapes: the same three sub-shapes as guard consequents (§4.3): expression consequent (§4.3.1), block consequent (§4.3.2, both bare and def-block forms), and assignment consequent (§4.3.3). Semantics are identical to their guard counterparts.

```java
?(myName){
    ["Kyle"]: log("hi");                 // expression
    ["Kyle"]: (y: 3) { log(y); ^y * 2 }; // def-block (BlockExprStrict)
    ["Kyle"]: { log("hi"); };            // bare block
    ["Kyle"]: myName := "KYLE!";         // assignment
};
```

As with guard consequents (§4.3), the block does not carry an implicit input at this position, so destructure targets in a def-block's defs clause require explicit initializers.

### §5.4 The Else Clause

Both independent and dependent match expressions admit an optional trailing **else clause**:

```
ElseStmt := (Qmark _)? MatchConsequentNoSemi (_ Semicolon)*
```

The else clause consists of an optional leading `?` sigil followed by a match consequent. It appears as the final statement in the match's brace body. When no preceding pattern clause matches, the else clause's consequent is evaluated to produce the match expression's value.

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

**Determinacy.** A match expression is *determinate* when its clauses cover all possible topic values (dependent form) or when the disjunction of clause conditions is a tautology (independent form).

Depending on compiler configuration, Foi will or will not enforce determinacy (no *pattern-match coverage gap*) at compile time: a non-determinate match's value on no match is `empty`, per the abstract execution of §5.1 and §5.2.

**Related forms.**

- **Guard expressions (§4.2)** are the single-clause degenerate case of independent pattern matching. A single-clause independent match `?{ ?[c]: e }` is semantically equivalent to the guard `?[c]: e`.

- **Function preconditions (§3.5)** share the `?[cond]:` clause syntax but compose as a shortcircuit sequence at call entry rather than as a value-bearing cascade. See §3.5.1 for the multi-parameter tier-lifting rule that governs their evaluation ordering.

- **Comprehension conditionals** (§7) reuse the CondClause primitive to gate `~each` loop-iteration continuation; see §4.1's reachability list.

## §6 Suspension and Evaluation Control

Foi programs express suspension and control-flow through three interlocking mechanisms -- **effects**, **handlers**, and **generators** -- plus a small set of sentinel forms (`Done@`, source-position `Left@` in Either-typed streams) that let loop-like constructs terminate cleanly.

Effects and handlers are the substrate; generators are a specialized surface built on the same substrate. All three mechanisms share a common shape: a *computation* runs, some position in that computation *suspends* the current work and hands a value to an outer scope, and the outer scope decides what value flows back in as the suspension's result.

The mechanisms differ in **who observes the suspension**. Effects performed inside a handler resume with the arm's return value invisibly. From userland's point of view, the perform site is an ordinary expression that produces a value; no userland code between perform and resume can run. Generators are the opposite: each yield is a perform whose resume waits until *some external agent calls `.next()`*, which means arbitrary userland code can execute between suspend and resume. Generators are the sole userland-observable pause point; every other effect is asynchronous only in the invisible-to-userland sense.

This observability distinction motivates why generators (and only generators) receive dedicated surface sugar (`<::` for Yield). Every other effect uses the general perform form because there is no ergonomic pull toward a shortened perform-site: userland cannot observe the pause, so no idiom needs to make it visually terse.

The remaining pieces this section specifies:

- Effects: what an effect kind is, how it is declared, how it is performed. (§6.1, §6.2)
- Handlers: the operators that establish a handler scope and dispatch perform-events to arms. (§6.3)
- Sentinel: `Done@` as universal loop-escape. (§6.4)
- Generators: the compiler-privileged reification transform for functions typed as `deft Gen.`-prefixed, and the `%`-driven iterator surface. (§6.6)
- Deferred type (State §6.7)
- Self-hosted pause-able types (Promise §6.8, Channel §6.9, Streams §6.10-§6.11, IO §6.12).
- Effect signatures in types. (§6.13)

**NOTE:** Effects, handlers, and their signatures reuse existing Foi surface: `deft` (with `Effect.` prefix), the `%` effector operator, `~<*` handler ops, and `:Effects(...)` narrowing. No new operators or keywords are introduced by this section; the mechanisms below specify what compiler-privileged behavior existing surface acquires when the LHS carries effect-kindedness.

### §6.1 Effects

An **effect** is a suspension point that yields control to whatever handler dynamically encloses it, along with a payload value. The handler decides what value the perform-site expression evaluates to.

Effects have three moving parts:

- An **effect kind**: a namespace declaring an operation's payload and resume shape. `Effect.Yield`, `Effect.IO`, and any user-declared effect kind are namespaces of this variety.
- A **perform site**: a source position where an effect of some kind is signaled. The perform site's expression value is set by the handler's arm return.
- A **handler scope**: established by `~<*` applied to an effect kind or set of kinds (§6.3), containing arms that inspect the perform payload and return a resume-value.

An effect kind may be performed anywhere reachable from a handler scope of that kind. If no handler scope for the kind is in effect at the perform site (dynamic through the call stack, not lexical), the perform is ill-formed under the effect-tracking discipline of §6.13; every reachable perform must be either declared upward in the caller's effect signature or caught by an enclosing handler.

#### §6.1.1 Contrast with Try/Catch

Effects superficially resemble exceptions: perform suspends the current computation and hands control up the call stack, just as `throw` does. The critical differences:

- **The computation is resumed, not abandoned.** An effect handler's
arm returns a value, and that value is the value of the original
perform-site expression; the computation continues from the perform
point with the arm-supplied result. Exceptions unwind the stack;
effects do not.
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
deft Effect.Ask(String) ^String;
deft Effect.Log(String) ^empty;
deft Effect.Retry(<attempt: int, cause: string>) ^bool;
```

The parameter position declares the **payload type**: the shape of the
value a perform-site supplies. The return position declares the **resume
type**: the shape of the value the handler's arm returns and the
perform-site expression evaluates to. `empty` in return position marks a
fire-and-forget effect (perform-site expression is `empty`).

The `Effect.` prefix is normative. A `deft` whose name lacks the prefix
is a plain type alias (§18), not an effect kind: its name cannot appear
on the LHS of a `%` perform-site (§6.2), on the LHS of a `~<*` handler
operator (§6.3), or in `:Effects(...)` narrowing (§6.13). The prefix
carries no runtime cost; it is a compile-time discriminator only.

Dotted-name at the `deft` name position is admitted specifically for
effect declaration. Non-effect `deft` retains the single-Identifier form.

The top-level of the effect namespace is always `Effect.`, but
underneath that, any dotted identifiers (of any depth) may be specified,
such as `Effect.MyModule.CustomOp`.

### §6.2 Performing Effects

A **perform site** signals that the enclosing computation is producing
an effect of some kind. Two surface forms serve as perform sites: the
general `%` effector operator applied to an effect-kinded LHS, and the
`<::` sugar specific to `Effect.Yield` (in a Generator). Both are
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
4. Deliver the payload value to the located handler's arm (§6.3).
5. The arm evaluates in its own scope and produces a **resume-value**.
6. The suspended computation resumes at the perform site. The
perform-site expression's value is the resume-value.

The suspension is not visible in the perform-site's source form. From
the perform-site expression's point of view, `Effect.Ask% "prompt"` is
a plain expression that produces a string; the runtime mechanism that
connects perform to handler is orthogonal to how the expression is read
locally.

#### §6.2.1 The `%` Perform Form

The general perform form is the `%` effector operator (§3.9) applied to
an effect-kinded LHS:

```java
Effect.Ask% "What's your name?";
Effect.Log% "starting up";
Effect.Retry% <attempt: 3, cause: "timeout">;
```

Whitespace rules follow §3.9: `Effect.Ask%"prompt"`, `Effect.Ask%
"prompt"`, and `Effect.Ask % "prompt"` all parse to the same perform
site.

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

#### §6.2.2 The `<::` Sugar for `Effect.Yield`

The composite token `<::` is surface sugar for performing `Effect.Yield`
specifically:

```java
<:: 42;                     // sugar for `Effect.Yield% 42`
<:: someValue;              // sugar for `Effect.Yield% someValue`
```

This is the only effect kind with a syntactic shorthand form. A
generator yield is Foi's sole userland-observable pause point (§6
opener); yield-heavy producer code reads cleanly with the reduced
notation.

The sugar is syntactic only. `<:: expr` and `Effect.Yield% expr` are
handled by the same call-stack walk described in §6.2's abstract
execution.

### §6.3 The Handler Operator

The `~<*` operator establishes a **handler scope**: a lexical region
within which effect performs of specified kinds are caught by
user-supplied arms. The wrapped computation runs to natural completion
inside the scope; every perform of a caught kind (not merely the first)
is dispatched to a matching arm, which returns the resume-value threaded
back to the perform site.

The general handler form:

```java
Effect.KindA ~<* (eff:: comp) { .. };
```

- The **LHS** is an effect-kind narrowing (§6.3.1): the set of kinds
this handler catches.
- The **head parens** bind `eff` to each perform-event dispatched to
this handler, and specify `comp` as the computation to run in the
handler scope.
- The **body block** contains **arms**: pattern-match clauses over `eff`
(§6.3.2). Each arm's return value is the resume-value delivered back to
the perform site inside `comp`.
- The whole form's value is `comp`'s natural return value (§6.3.3).

Effect kinds *not matching* the LHS's narrowed set propagate past the
handler and continue up the dynamic call stack per §6.1.2, subject to
§6.13's effect-tracking discipline.

**NOTE:** `~<*` is the sole Effect handler-establishing form; the
single-shot `~<<` do-comprehension (§7) does not participate in effect
handling, as only handling the first effect performed would be a
rare/unlikely approach.

#### §6.3.1 Effect-Kind Narrowing

The LHS of `~<*` is an **effect-kind narrowing expression** that names
the set of effect kinds this handler is responsible for catching. Foi
provides a small **pick-syntax DSL** for expressing this set:

```java
Effect.Ask                      // single kind, bare form
Effect.<Ask, Log, Retry>        // enumerated subset
Effect.<&Effect.IO>             // prefix inclusion: every Effect.IO.*
Effect.<Ask, Log, &Effect.IO>   // combined
```

- **Bare form**: `Effect.Name` names a single effect kind. `Effect.Ask
~<* (eff:: comp) { ... }` catches only performs of `Effect.Ask`.
- **Brace form**: `Effect.<A, B, ...>` names an enumerated subset. Each
element is either a bare kind name (`Ask`) or a prefix-inclusion
form (`&Effect.IO`).
- **Prefix inclusion**: `&Effect.IO` inside a brace form includes every
effect kind whose declared name has `Effect.IO.` as a prefix
(`Effect.IO.Read`, `Effect.IO.Write`, `Effect.IO.Close`, ...). The `&`
sigil marks the prefix relationship, distinguishing it from a bare
kind-name.

The narrowing is closed under the pick-syntax DSL: exactly what appears
in the LHS narrowing is handled, and nothing else. Any perform of a kind
outside the narrowing propagates past.

**Cross-uses.** The same pick-syntax narrowing appears in `?as` patterns
(§6.3.2) and in `:Effects(...)` type-signature narrowing (§6.13). One
DSL, three sites; §6.3.1's specification of the DSL shape governs all
three.

#### §6.3.2 Arms and Resume-Values

The body of a `~<*` handler is a **do-block** (§16): a sequence of statements terminating in a final unwrap expression `:: <expr>`. On each perform-event dispatched to this handler, the do-block runs, and `<expr>` produces the **resume-value** threaded back to the perform site inside `comp`.

The canonical arm shape is a dependent match against `eff`:

```java
Effect.<Ask, Log> ~<* (eff:: producer()) {
    :: ?(eff){
        [?as Effect.Ask]: readLine(#);
        [?as Effect.Log]: log(#);
    };
};
```

- **`(eff:: producer())`**: the DoBlockDefsInit-shaped head (§16) binds `eff` to each perform-event dispatched to this handler; the RHS is the computation whose performs are caught.
- **`:: ?(eff){ ... }`**: the do-block's final unwrap position (§16). Its value on each dispatch is the resume-value.
- **Arms**: the dependent-match clauses of `?(eff){ ... }`. Each arm's pattern is `?as Effect.KindName`, matching the perform-event's effect kind. The arm's consequent value is the resume-value.
- **Payload access via `#`**: inside an arm consequent matched by `?as Effect.KindName`, the topic reference `#` refers to the effect's declared payload value (§6.1.3), not to the perform-event wrapper. For a record-shape payload (e.g., `Effect.Retry(<attempt: int, cause: string>) ^bool`), fields are accessed as `#.attempt`, `#.cause`.

**Type check on arm consequent.** Each arm consequent must produce a value of the matched effect kind's declared resume type. `Effect.Ask` declares `^String`; its arm must produce a `String`. `Effect.Log` declares `^empty`; its arm must produce `empty`. Compile-time obligation of §6.13.

**Exhaustiveness.** The arms must cover every effect kind admitted by the LHS narrowing. `Effect.<Ask, Log>` requires arms for both `Effect.Ask` and `Effect.Log`; missing coverage is a compile-time error. A default `?:` arm (§5.4) catches otherwise-unmatched kinds, which is the ergonomic pairing for prefix-inclusion narrowings (`&Effect.IO`).

#### §6.3.3 Handler Expression Value

A `~<*` handler expression's value is `comp`'s natural return value. The handler op is transparent with respect to comp's return. The machinery wraps comp with effect-catching arms, but does not itself produce a value; whatever comp evaluates to at natural completion flows out as the handler expression's value.

If `comp` propagates an uncaught effect past this handler (a perform whose kind is outside the LHS narrowing, §6.3.1), the handler expression does not produce a value; the propagation is the exit path, and the effect continues up the dynamic call stack per §6.1.2.

Arms do not contribute to the handler expression's value. An arm's consequent is the **resume-value** delivered to the perform site inside `comp` (§6.3.2); it flows into comp's continuing execution, not out of the handler.

Value-shaping wrappers built on top of `~<*` (e.g., `Gen%` returning a Promise, IO's runner returning Either) are runner-layer concerns and live in §6.6 and §6.12. `~<*` itself carries no such wrapping.

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

- **Handler arm return** (§6.3): a `~<*` arm may return `Done@` in place
  of a resume-value; the handler scope terminates and the wrapped
  computation is not resumed. See §6.4.1.

- **Wrapped computation natural return** (§6.3.3): `Done@` returned as
  `comp`'s natural return value flows out per the transparent-return
  semantic -- the handler expression evaluates to that `Done@` value,
  which the outer context may inspect under its own discipline. This is
  not a special path; it is ordinary transparent-return.

#### §6.4.1 `Done@` in a `~<*` Arm

When a `~<*` arm evaluates to `Done@`, the handler scope terminates
immediately. The perform site inside `comp` that triggered the arm does
not receive a resume-value; the computation is abandoned at the perform
point, and control returns to the handler operator's continuation.

The handler expression itself has **no value** in this case. This is the
same exit-path shape as an uncaught effect propagating past the handler
(§6.3.3): the handler expression does not evaluate to a value; the
enclosing context does not see a return from the handler expression's slot.

```java
Effect.<Ask, Cancel> ~<* (eff:: producer()) {
    :: ?(eff){
        [?as Effect.Cancel]: Done@ empty;
        [?as Effect.Ask]:    getResponse(#);
    };
};
```

If `producer()` performs `Effect.Cancel`, that arm evaluates to
`Done@ empty`, the handler scope terminates, and the surrounding handler
expression does not produce a value. If `producer()` performs
`Effect.Ask`, that arm returns `getResponse(#)` as the resume-value and
its computation continues from the perform point.

**NOTE:** The `Done@` payload is not intrinsically inspected on the
arm-exit path. Runner layers built on top of `~<*` (§6.6, §6.12) may
inspect the arm's `Done@` payload for their own value-shaping -- e.g.,
a `Gen%` runner may treat `Done@ payload` from an arm as the terminal
value of its `.next()` surface -- but such inspection is a runner-layer
concern, not intrinsic to `~<*`. The uniform exit-path shape (no value)
is preserved at `~<*` itself.

### §6.5 Iterators

An Iterator (`Iter`) is a stateful protocol for one-at-a-time value delivery. Unlike `Promise` (single resolution), `Channel` (single-consumer handoff), or the streams (§6.10, §6.11, subscribed sources), an Iter delivers values by direct request from its holder: each step advances the source by one position and returns the next value, or a sticky terminal marker when the source has no more to give.

**NOTE:** `Iter` is not monadic. `~<` and `~map` are not defined on it; `~<*` is defined only as do-loop drainage (§6.5.3, §7), not as a subscription-composition form. `PullStream` (§6.11) is the observable-monad wrapper built over an Iter source; consumers wanting monadic composition should wrap in `PullStream` and compose there.

**NOTE:** An `Iter` is produced by two paths:

- **Explicit construction** via `Iter@` (§6.5.1) over a Tuple, Range, or another Iter.
- **Generator invocation** via the reification transform (§6.6), which produces an Iter carrying a state machine.

Both paths share the base stepping interface (§6.5.2); generator-produced Iters additionally support the binary-`%` resume-value channel per §6.6.4.

The userland surface is:

- `Iter@ source`: constructor. `source` is a Tuple, a Range, or another Iter. Returns an Iter.
- Unary `%`: `it%` steps the iterator once, returning `Right@ payload` mid-stream or a sticky `Left@ terminal` once the source has been exhausted (§6.5.2).
- Binary `%`: `it% v` steps a generator-produced Iter delivering `v` as the resume-value for a waiting `<::` perform site (§6.6.4). Ill-formed on Iters constructed via `Iter@`.
- `~<*`: do-loop drainage form; consumes the iterator to its terminal (§6.5.3, §7).

**NOTE:** Iter has no explicit close operation and no closed-state observation. An iterator is either mid-stream (`Right@` on step) or terminal (`Left@` on step, sticky); consumers detect terminal state via return-value pattern-match. Generator Iters whose sources never complete are abandoned by dropping references, or by the author passing in a value via Iter `%` to signal the generator to stop itself.

#### §6.5.1 Iter Construction

The `Iter@` constructor takes one argument and produces an Iter over the supplied source. Three source shapes are accepted:

**Tuple source:**

```java
def it: Iter@ < 1, 2, 3 >;
```

The tuple's elements become the value sequence, delivered in tuple order.

**Range source:**

```java
def it: Iter@ (1..5);
```

The range's values are delivered in ascending order.

**Iter source (identity):**

```java
def existing: Iter@ < 10, 20, 30 >;
def same: Iter@ existing;    // same is existing, no new instance
```

`Iter@` applied to an existing Iter returns *the same instance* -- no new state, no allocation, no wrapper. This form exists to let generic consumers normalize any iterable input to Iter without penalizing callers who already hold an Iter.

Any argument other than a Tuple, Range, or Iter is ill-formed.

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

#### §6.5.2 Stepping

Unary `it%` steps the iterator once, returning one of two shapes:

- `Right@ payload`: the next value delivered from the source.
- `Left@ terminal`: the source has been exhausted; no further values.

Once the terminal is reached, it is **sticky**: subsequent `it%` invocations continue to return the same `Left@` value. The terminal payload depends on how the iterator concluded:

- **Tuple/Range source exhausted:** terminal is `Left@ "Iterator Exhausted"`.
- **Generator natural completion:** terminal is the generator's return value (§6.6.3), wrapped in `Left@`.

```java
def it: Iter@ < 1, 2 >;
it%;    // Right{1}
it%;    // Right{2}
it%;    // Left{"Iterator Exhausted"}
it%;    // Left{"Iterator Exhausted"}     -- sticky
```

Binary `it% v` steps the iterator delivering `v` as the value to resolve a waiting `<::` perform site inside the iterator's execution. This form is defined only on generator-produced Iters (§6.6.4); applying binary `%` to a Tuple, Range, or Iter-identity Iter is ill-formed:

```java
def it: Iter@ < 1, 2, 3 >;
it% 42;    // ill-formed
```

Ill-formedness is diagnosed statically at the call site when the Iter's construction path is known at compile time; otherwise it is a runtime error on `%`-hook dispatch (§6.2). Non-generator Iters have no perform sites to resolve, and silently discarding the value would mask consumer bugs.

#### §6.5.3 Draining Via `~<*`

An Iter can be eagerly consumed via the `~<*` do-loop-comprehension form:

```java
def it: Iter@ < 10, 20, 30 >;

def res: it ~<* (v) {
    log(`"v: `v`");
};
// v: 10
// v: 20
// v: 30

res;    // Left{"Iterator Exhausted"}
```

The comprehension drives the iterator to its terminal by repeated unary stepping. Each `Right@ payload` step binds `payload` to the loop variable and executes the block body; the loop terminates when a step returns `Left@ terminal`. The value of the `~<*` expression is the terminal `Left@`.

Full `~<*` do-loop-comprehension semantics -- including its interaction with other iterable types, guard conditions, and `Done@` early termination -- are specified in §7. This section notes only its consumption of Iter instances.

**NOTE:** `~<*` on an Iter is a §7 iterable-drainage form, distinct from the monadic-subscription `~<*` polymorphism of `Effect` (§6.3), `Promise` (§6.8.4), `PushStream` (§6.10.3), and `PullStream` (§6.11.3). An Iter is a §7 iterable, not a §6 monadic subscribable; no `~<` or `~map` operators are defined on it. Consumers wanting monadic composition wrap the Iter in a `PullStream` (§6.11.1) and compose there.

### §6.6 Generators

A **generator** is a function whose execution can be suspended mid-body; resumption is controlled on demand via an attached iterator (`Iter` instance, §6.5).

Foi generators are the sole userland-observable pause point (§6 opener):
each suspension is triggered by an `Effect.Yield` perform (via the `<::`
sugar of §6.2.2), and each resumption is triggered by an explicit step
on the generator's attached `Iter` instance (§6.6.2).

An `Iter` instance is advanced manually with the `%` effector operator,
or may be consumed fully to its terminal via the `~<*` do-loop
comprehension.

**NOTE:** The `Iter` interface (§6.5) is stdlib-hosted; only the
reification transform triggered by the `deft Gen.` prefix is
compiler-privileged. Generator self-hosting is stdlib code built on
`Effect.Yield ~<*` (§6.3) plus the reification transform; the internal
implementation is not part of the language definition.

#### §6.6.1 `Gen.` Prefix, Reification Transform

Generators must be declared with a `Gen.`-prefixed type (via `deft`),
attached to a function with `:as`:

```java
deft Gen.Numbers(int, int) ^Iter;

defn numbers(start, end) :as Gen.Numbers {
    start..end ~each (v) {
        <:: v;
    };
    ^"Complete";
};
```

The `Gen.` prefix on a `deft` declaration is compiler-privileged. It
carries three properties:

- **Reification.** Every function `:as` a `Gen.`-prefixed type undergoes
  a **state-machine reification transform**: the body is split at each
  `<::` site into a segment-dispatched stepper. Invocation of the function
  produces an `Iter` instance rather than eagerly running the body.
- **Implicit Yield effect.** The type implicitly carries
  `:Effects(Yield)` in its effect set; explicit `:Effects(Yield)` is
  admitted but redundant. Additional effects may be declared explicitly
  (see §6.6.6).
- **Iter return interface.** The declared return type is `Iter`, and
  invocation evaluates to an `Iter` instance. No user code runs inside
  the function body at the call position; only the Iter is produced.

The `Gen.` prefix is structurally parallel to the `Effect.` prefix on
effect-kind declarations (§6.1) -- both mark compiler-privileged
type-kinds whose declaration form induces materially different
compilation of `defn` bodies annotated with them.

#### §6.6.2 Iterator Instance For Generator

Invoking the generator function produces a new `Iter` instance (§6.5)
whose body has not yet started:

```java
def it: numbers(2, 5);
```

Multiple `Iter` instances attached to the same generator may be started and advanced concurrently.

#### §6.6.3 Iterator Stepping, Terminal Semantics

Unary `it%` steps the iterator once, running the generator body up to the
next `<::` perform-site or to natural completion. Each mid-stream step
evaluates to `Right@ payload`, where `payload` is the value passed to
`<::`:

```java
def it: numbers(2, 5);
it%;    // Right{2}
it%;    // Right{3}
it%;    // Right{4}
it%;    // Right{5}
```

When the generator body completes -- either by falling off the end or
reaching an explicit `^` return -- the iterator transitions to its
**terminal** state. The generator's final return value (if any) becomes
the terminal payload wrapped in `Left@`:

```java
it%;    // Left{"Complete"}
it%;    // Left{"Complete"}
```

The terminal state is **sticky**: subsequent `it%` invocation continues
to return the same terminal `Left@` value. Terminal iterators are not
one-shot; they idempotently report their terminal result on every
inspection.

#### §6.6.4 Resume-Value via `%`

The binary form `it% v` steps the iterator and delivers `v` as the value
to resolve the waiting `<::` expression (if any) inside the generator
body. This enables two-way value flow between the iterator caller and
the generator body:

```java
deft Gen.Adder(int) ^Iter;

defn adder(sum:? 0) :as Gen.Adder {
    ?[sum ?< 100] ~each {
        sum := sum + (<:: sum);
    };
    ^sum;
};

def it: adder(13);
it%;      // Right{13}
it% 12;   // Right{25}
it% 50;   // Right{75}
it% 39;   // Left{114}
it%;      // Left{114}
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

#### §6.6.5 Draining Iterators Via `~<*`

A finite generator can be eagerly consumed via the `~<*` do-loop
comprehension, per §6.5.3's drainage semantics for `Iter` instances
generally:

```java
def res: numbers(1, 3) ~<* (v) {
    log(`"v: `v`");
};
// v: 1
// v: 2
// v: 3

res;      // Left{"Complete"}
```

The generator's return value (`"Complete"` in `numbers`) becomes the
terminal `Left@` payload per §6.6.3. Full drainage semantics --
interaction with other iterable types, guard conditions, `Done@` early
termination -- are specified in §7.

#### §6.6.6 Non-Yield Effects In Generators

A `Gen.`-prefixed type implicitly carries `Effect.Yield` in its effect
set (§6.6.1). Additional effects may be declared explicitly and performed
inside the generator body:

```java
deft Gen.LoggingNumbers(int, int) :Effects(Log) ^Iter;

defn loggingNumbers(start, end) :as Gen.LoggingNumbers {
    Effect.Log% `"starting range `start`..`end`";
    start..end ~each (v) {
        <:: v;
    };
    ^"Complete";
};
```

The internal `Effect.Yield ~<*` scope installed by the reification
transform is narrowed to `Effect.Yield` only (per §6.3.1 narrowing
semantic). Non-Yield performs -- `Effect.Log` above, or any other
declared effect -- propagate past this internal scope per §6.1.2 dynamic
lookup, resolving at the nearest enclosing handler in the caller's
dynamic scope that catches the relevant effect kind.

If no such enclosing handler is reachable at the call site, the perform
is ill-formed per the function's effect signature (§6.13).

#### §6.6.7 Abstract Execution

Three algorithms specify the mechanical semantics of generators. The
first is a compile-time source-to-source transform; the remaining two
describe runtime execution on the abstract machine.

**Reification Transform.** Applied to the body of a `defn` typed `:as T`
where `T` is a `Gen.`-prefixed type.

----

The `ReifyGenBody(body)` steps are:

1. Let `sites` be the ordered list of all `<:: expr` positions in `body`,
   in evaluation order.

2. Partition `body` into `segments`:
    - The initial segment is the code from the start of `body` up to
      and including the payload evaluation of the first site in `sites`.
    - Each subsequent segment begins at the resumption position of the
      preceding site (the expression slot the `<::` occupies) and runs
      up to and including the payload evaluation of the next site, or
      to the natural end of `body` if no further sites remain.

3. Assign each segment a state label:
    - The initial segment: `"start"`.
    - Each subsequent segment: `"seg_N"` for `N` in `1, 2, ..., Length(sites) - 1`.
    - Terminal state (post-completion): `"closed"`.

4. For each segment, compile:
    - `<::` at the segment's tail: yield the payload out of the segment
      as its return value; update the enclosing iterator's state variable
      `__s` to the next segment's label.
    - Natural completion at the segment's tail: capture the return value
      of `body` (or `empty` if none); update `__s` to `"closed"`.

5. Produce a stepper function `__stepper(__iter, __resume)`:
    - Dispatch on `__iter.__s` to the current segment.
    - Deliver `__resume` at the resumption position of the last site
      (i.e., as the value of the `<::` expression slot in that segment).
    - Run the segment to its terminator.
    - Return the segment's terminal value.

6. Emit the reified generator function whose invocation invokes
   `ConstructIter` with `__stepper` bound to this stepper.

----

**Iterator Construction.** Applied at runtime when a generator function
is invoked.

----

The `ConstructIter(genFn, args)` steps are:

1. Allocate a new `Iter` instance `__iter`.

2. Bind the parameters of `genFn` in `__iter`'s environment from `args`
   per §3.10 call-args processing. These bindings are visible to the
   generator body when its `"start"` segment runs.

3. Set `__iter.__s` to `"start"`.

4. Set `__iter.__stepper` to `genFn`'s reified stepper (produced by
   `ReifyGenBody` at compile time).

5. Set `__iter.__terminal` to `empty` (unset until the iterator reaches its terminal state).

6. Return `__iter`.

----

**Iterator Step.** Applied at runtime on `iter%` (unary) or `iter% v`
(binary), per `_percent`-hook dispatch (§6.2), when `iter` is a
generator-produced Iter. Iters constructed via `Iter@` (§6.5) have a
trivial step path per §6.5.2 that does not require an abstract-algorithm
form; binary `iter% v` on such Iters is ill-formed.

----

The `StepIter(iter, resumeVal)` steps are:

1. If `iter.__s` is `"closed"`: return `iter.__terminal`. Any supplied
   `resumeVal` is discarded (per §6.6.4 post-terminal boundary).

2. Let `outcome` be the result of `iter.__stepper(iter, resumeVal)`. The
   stepper runs the current segment as follows:
    - If the segment is `"start"`: `resumeVal` is discarded (per §6.6.4
      pre-start boundary); the segment runs from the top of `body`.
    - Otherwise: `resumeVal` is delivered as the value of the last `<::`
      expression slot; the segment resumes at that position.

3. If the stepper terminated at a `<::` site:
    - Let `payload` be the yielded value.
    - `__iter.__s` has been advanced to the next segment's label by the
      reified transform.
    - Return `Right@ payload`.

4. If the stepper terminated at the natural end of `body`:
    - Let `finalReturn` be the value

### §6.7 State

A **state** is a deferred computation that threads a state value through a sequence of reads and writes. Each step observes the current state and produces both a value and an updated state. No code runs at construction; execution is triggered by applying an initial state via `%`.

The userland surface is:

- `State@`: unit constructor over a state-changer function.
- Binary `%`: applies an initial state and runs the computation, evaluating to a `< value, finalState >` tuple.
- `~<<` do-block composition: sequences state operations, threading the state through each step (per §6.3.3 do-block-compilation split).

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

Beyond the general `State@` unit constructor, four named constructors cover the common state operations:

- `State.get@`: reads the current state as the observed value, leaves the state unchanged.
- `State.gets@`: applies a function to the current state, returns the result as the observed value, leaves the state unchanged.
- `State.put@`: writes a new state, produces `empty` as the observed value.
- `State.modify@`: applies a function to transform the current state, produces `empty` as the observed value.

Each is a stdlib-provided `State` instance (or, for `gets`, `put`, and `modify`, a stdlib-provided function that produces a `State` instance):

```java
State.get@;              // aka: State@ (defn(s) ^< s, s >)
State.gets@ (*)|2| ;     // aka: State@ (defn(s) ^< s * 2, s >)
State.put@ 42 ;          // aka: State@ (defn(s) ^< empty, 42 >)
State.modify@ (+)|1|;    // aka: State@ (defn(s) ^< empty, s + 1 >)
```

Evaluated via `%` in isolation:

```java
State.get% 10;                // < 10, 10 >
(State.gets@ (*)|2|)% 10;     // < 20, 10 >
(State.put@ 42)% 10;          // < empty, 42 >
(State.modify@ (+)|1|)% 10;   // < empty, 11 >
```

`get` and `gets` observe without mutating; `put` and `modify` mutate without meaningfully observing. These four constructors are the primary surface for building state computations; the general `State@` form is the escape hatch for state-changers whose shape doesn't fit these idioms.

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

- `def prev:: expr` binds `prev` to the observed value of `expr` (a `State` instance) and threads the updated state forward.
- A bare mid-block statement (`State.put@ ..` above) sequences/chains the expression as a `State` step, threading the updated state forward and discarding the observed value. Explicit `:: expr;` at this position is legal but redundant, because it unwraps/extracts that step's value into the do-comprehension scope, but then discards it. the `def prev:: expr` is the form when you need the unwrapped/extracted value in scope.
- The terminal expression is `~map`-lifted into the ambient monad. A bare terminal (`prev` above) becomes the block's observed value; the block evaluates to a `State` producing that value while preserving the threaded state.
- A `::`-prefixed terminal (`::expr`) binds `expr` before the terminal map. For example, the bare `prev;` could have been `::State@ prev`, but that's unnecessary ceremony. Use this form when the terminal expression is itself already lifted as a `State` instance.

Example with a `State`-typed terminal, requiring the `::` prefix to avoid double-wrap:

```java
def compute: State ~<< {
    State.modify@ (+)|1|;
    State.modify@ (*)|3|;
    ::State.get@
};

compute% 5;    // < 18, 18 >
```

Without the `::` on the terminal `State.get@`, the block would produce a `State{ State{...} }`: the terminal map lifting an already-`State` value into another `State` layer. The `::` prefix binds first, so `State.get@` lands at the correct monadic level.

Per §6.3.3 do-block-compilation split, `State ~<<` composition compiles via the default route (compile-time expansion to nested `~<` / `~map`).

### §6.8 Promise

A **Promise** is a monadic container for an `Either` value whose resolution may be immediate or deferred. Unlike `State` (§6.7), which is a deferred computation triggered by applying `%`, a `Promise` instance is either already resolved at construction or pending resolution by an external agent -- a **subject** (§6.8.2). Operations composed against a pending promise are automatically deferred until resolution; once resolved, further operations run synchronously.

The `Either` shape carries success and failure through composition: a resolved-`Right` value flows through subsequent steps; a resolved-`Left` value short-circuits composition. Promise has no separate rejection channel; failure is signaled entirely via the `Either` payload.

**NOTE:** Although the resolved payload is written as `Right@ v` or `Left@ reason`, the `Either` shape is invariant: a `Promise` instance's payload is always one of the two tagged branches. For observation and unwrapping purposes, `Promise{Right{v}}` behaves as a single layer -- extracting the success value yields `v` directly, not `Right@ v`. The `Right` / `Left` tags discriminate the success and failure branches; they do not compose as a separate unwrap step. A `Promise` holding a distinct nested type (for instance, an `IO` inside its success payload -- `Promise{Right{IO{42}}}`) is genuinely two layers: the Either-branch discriminator is invariant, but the `IO` layer is a distinct nested type that composes independently.

The userland surface is:

- `Promise@`: unit constructor over an `Either`. Produces an
already-resolved promise.
- `Promise.honor@`: named constructor sugar wrapping a bare value in
`Right`.
- `Promise.renege@`: named constructor sugar wrapping a bare value in
`Left`.
- `Promise.subj@`: constructs a subject whose `.pr` is a pending
promise. Applying `%` to the subject with an `Either` resolves the
associated promise.
- `.resolved()`: instance method returning `true` if the promise is
resolved, `false` if pending.
- `~<<` do-block composition: sequences promise operations, deferring
subsequent steps across pending resolutions and short-circuiting on
`Left`.
- `~<*` async iteration: loops over a range, awaiting each iteration's
pending promise before continuing.

#### §6.8.1 Promise Unit Constructors

An already-resolved promise is constructed by applying `Promise@` to
an `Either`:

```java
def ok: Promise@ (Right@ 42);           // Promise{Right{42}}
def bad: Promise@ (Left@ "missing");    // Promise{Left{"missing"}}
```

The wrapped `Either` is the promise's resolved value. `Promise@`
requires an `Either`; applying it to a non-`Either` value is statically
rejected:

```java
Promise@ 42;    // ill-formed: 42 is not an Either
```

Two named constructors wrap common cases where the value is not already
an `Either`:

- `Promise.honor@ v`: equivalent to `Promise@ (Right@ v)`.
- `Promise.renege@ r`: equivalent to `Promise@ (Left@ r)`.

```java
Promise.honor@ 42;        // Promise{Right{42}}
Promise.renege@ "oops";     // Promise{Left{"oops"}}
```

These are ordinary sugars, not smart selectors; each unconditionally
wraps its argument in the corresponding `Either` branch.

#### §6.8.2 Pending Promises Via `Promise.subj@`

A pending promise is created by constructing a subject:

```java
def subj: Promise.subj@;

subj.pr.resolved();      // false
```

The subject exposes a single field:

- `.pr`: the associated promise, initially pending.

Resolution is triggered by applying `%` to the subject with an `Either` payload:

```java
def subj: Promise.subj@;

subj% (Right@ 42);
// Right{42}

subj.pr;
// Promise{Right{42}}
```

The `Either` supplied at `%`-time becomes the promise's resolved value. Like `Promise@` (§6.8.1), `%` on a subject requires an `Either`; a non-`Either` argument is statically rejected. Unary `subj%` is ill-formed; resolution requires the payload.

Once resolved, a promise's state is permanent. Subsequent `%` applications to the same subject do not change its state.

Operations composed against a pending promise are deferred:

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

`%` dispatch on a subject is realized via ordinary `_percent`-hook dispatch (§6.2); the hook is stdlib code that performs the pending-to-resolved transition on the associated promise.

**NOTE:** The promise is separable from its subject (but not vice versa). `subj.pr` is a first-class value: it may be passed, stored, and composed independently. Applying `%` to the subject is the sole path to state transition; a subject whose holder never triggers `%` yields a permanently-pending promise.

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

- `def user:: fetchUser(42)` binds `user` to the `Right` payload of the
promise returned by `fetchUser(42)`. If the resolved value is `Left@
reason`, the block short-circuits and evaluates to `Promise@ (Left@
reason)`; subsequent statements do not run.
- A bare mid-block statement sequences the promise step and discards
its `Right` value; a `Left` at that step still short-circuits.
- The terminal expression is `~map`-lifted into the ambient `Promise`,
wrapping in `Right`. A bare terminal (`< :user, :orders >` above)
produces a `Promise@ (Right@ terminalValue)`.
- A `::`-prefixed terminal (`::expr`) binds `expr` before the terminal
map, avoiding double-wrap when the terminal expression is itself already
a `Promise`.

Each pending promise encountered in the block defers the remaining steps
until resolution.

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

Per §6.3.3 do-block-compilation split, `Promise ~<<` composition compiles via the default route (compile-time expansion to nested `~<` / `~map`). The Either-aware behavior of the do-block is inherited from Either-aware `~<` and `~map` hooks on `Promise`: both see through `Right` and pass `Left` unchanged.

#### §6.8.4 Async Iteration Via `~<*`

The `~<*` async-comprehension iterates over a range, awaiting any pending promise produced by each iteration before continuing:

```java
defn fetch(url) ^Promise.honor@ `"resp for `url`";

def urls: < "https://api/1", "https://api/2", "https://api/3" >;

def task: urls ~<* (url) {
    ::fetch(url) ~map (resp) {
        log(`"resp: `resp`");
    };
};
// Promise{..pending..}

// resp: resp for https://api/1
// resp: resp for https://api/2
// resp: resp for https://api/3
```

Each iteration receives the next range value and runs the body; when the body evaluates to a pending promise, the next iteration is deferred until that promise resolves. The comprehension itself evaluates to a `Promise` that resolves once iteration completes.

Bindings via `def ::` inside the loop body follow the same Either-aware rule as `~<<` (§6.8.3): a `Left` short-circuits the current iteration. If the iteration body's terminal expression resolves to `Left`, the loop terminates early -- analogous to `Done@` early-exit in synchronous comprehensions (§6.4, §7).

Non-promise values encountered in the range are automatically lifted to resolved promises for the purposes of iteration handling.

An LHS that is the ambient monadic type itself (`Promise`) rather than a concrete iterable drives an *unbounded* async loop:

```java
def loop: Promise ~<* {
    def v:: nextPayload();
    log(`"Got: `v`");
};
// loop runs until nextPayload() resolves with a Left
```

The block re-runs each time its terminal expression resolves to `Right`, threading through the Either-aware binds of §6.8.3; iteration terminates when the terminal expression resolves to `Left`. The comprehension itself evaluates to a `Promise` that resolves once iteration terminates. This form is the natural consumer surface for open-ended asynchronous sources -- a channel `take` (§6.9), a stream pull (§6.10, §6.11), or any composed sequence whose termination is signaled by `Left`.

**NOTE:** `~<*` polymorphism spans two categories.

**Iterable drainage** (§7): a Range LHS or an `Iter` LHS (§6.5) drives
one-at-a-time consumption of the source to its terminal. Each delivered
value binds to the block variable; the loop terminates when the source
exhausts. See §7 for full drainage semantics.

**Monadic subscription** (§6): four LHS shapes participate. An
effect-kinded LHS (`Effect.<...>`) establishes a handler scope (§6.3).
A `Promise` LHS drives unbounded async iteration terminated by a `Left`
terminal expression (§6.8.4). A `PushStream` LHS drives subscription to
a producer-broadcast source (§6.10.3). A `PullStream` LHS drives
subscription to a consumer-triggered delivery source (§6.11.3). The four
share the "block body runs per emission from the LHS source" pattern;
they differ in what constitutes an emission, what triggers each
emission, and what terminates the composition. Across all four, a
terminal `Left@ ...` unsubscribes the block itself; source-side
termination conditions vary per LHS (effect-scope end, Promise `Left`,
source close on streams).

### §6.9 Channel

A **Channel** is a coordination primitive for value transmission between producer and consumer sites, following CSP (Communicating Sequential Processes) semantics. Unlike `Promise` (§6.8), whose composition threads a single resolution through a chain, a `Channel` mediates a stream of value handoffs; unlike `State` (§6.7), which is deferred by construction, a `Channel` is *coordinative* -- each `put` and `take` operation completes only when a corresponding counterpart operation occurs (buffering excepted; see §6.9.1).

**NOTE:** A `Channel` instance is not itself monadic. It has no `~<` or `~map` hook; do-block composition is not defined over `Channel` directly. Instead, every operation on a `Channel` instance produces a `Promise`, and composition proceeds through `Promise`'s do-block (§6.8.3) and async-iteration (§6.8.4) machinery over those returned promises. This delegation is the primary structural difference between `Channel` and the other pause-able types in this section.

Each operation's returned promise resolves to `Right` on success or `Left` on failure (channel already closed). The Either-aware composition of `Promise ~<<` (§6.8.3) inherits directly -- a `Left` from a channel operation short-circuits the surrounding block; a `Left` from a `take` terminates the surrounding async loop.

The userland surface is:

- `Channel@`: unit constructor. Optional positive integer argument sets buffer size (default `0` -- unbuffered).
- `.put(v)`: enqueue a value. Returns a `Promise` that resolves once a corresponding `take` completes (or immediately if buffer capacity is available).
- `.take()`: dequeue a value. Returns a `Promise` that resolves once a corresponding `put` completes (or immediately if a buffered value is available).
- `.peek()`: observe the next available value without consuming it. Returns a `Promise` that resolves with `Right@ v` once a value is queued; concurrent peeks all resolve to the same value.
- `.close()`: close the channel. Returns `Right@ true` on first invocation; subsequent invocations return `Left@ "Channel Closed"`. Pending `take`s at close time resolve with `Left`.
- `Channel.alts@`: race combinator over a list of channels. Constructs a one-shot derived `Channel` that receives `< :value, :channel >` for the first source channel to produce a value, then closes.
- `Channel.every@`: zip combinator over a list of channels. Constructs a one-shot derived `Channel` that receives `< ...values >` (input-order preserved) once every source channel has produced a value, then closes.

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

The `Left` from a closed-channel operation composes naturally through `Promise ~<<` -- it short-circuits the surrounding block, and in the async-loop pattern below it terminates iteration.

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

**Repeated coordination in a `Promise`-driven async loop.** Producer- and consumer-side loops iterate through channel operations until a `Left` terminates:

```java
def ch: Channel@;

// consumer
def consumer: Promise ~<* {
    def v:: ch.take();
    log(`"Got: `v`");
};

consumer;        // Promise{..pending..}

// producer
ch.put(1);       // Got: 1
ch.put(2);       // Got: 2
ch.close();      // consumer terminates

consume;         // Promise{Left{"Channel Closed"}}
```

The consumer loop iterates while its terminal expression resolves to `Right`; a `Left` -- produced by `take` on a closed, drained channel -- terminates iteration. Because `take` on an open channel never resolves to `Left`, the consumer runs indefinitely until close, at which point the pending `take` resolves `Left` and the loop exits.

Both patterns rely on Promise's Either-aware composition (§6.8.3) -- `Channel` contributes no do-block dispatch of its own, only the promises its operations produce.

#### §6.9.5 Multi-Channel Combinators

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

**NOTE:** Four design commitments frame `PushStream`'s subscription semantics, dual to `PullStream`'s:

- **Hot**: producers push independently of subscribers. Values pushed while no subscriber is registered are lost. Cold streams are `PullStream` (§6.11).
- **Broadcast**: every currently-subscribed observer receives every pushed value. Subscription is fanout, not queued handoff.
- **No replay**: a subscriber sees only values pushed after its subscription; values pushed before its subscription are not delivered to it. Streams retain no history.
- **Idempotent subscription**: a subscription is a relationship between subscriber and source, not an accumulating count. Establishing a subscription for a (subscriber, source) pair that already exists is a no-op. This invariant applies uniformly to every operator (`~<`, `~map`, `~<*`, combinators) that establishes subscriptions internally.

These match the hot-observable design well-worn in reactive-programming literature (with idempotent subscription as Foi's language-level addition). They distinguish `PushStream` from `Channel` (single-consumer, coordinated, back-pressured) and from `Promise` (single-value, replayable via re-observation).

The userland surface is:

- `PushStream@`: this unit constructor form exists for definitional completeness, but its use is always ill-formed and will produce a compiler error.
- `PushStream.subj@`: subject constructor. Exposes `.st` (the associated `PushStream`) as its sole field. Returns a subject.
- `.close()`: close the stream. Available on the subject only. Returns `Right@ true` on first invocation; subsequent invocations return `Left@ "PushStream Closed"`. Close propagates downstream to composed observers.
- `.closed()`: available on the stream. Returns `true` if the stream is closed, `false` if open.
- Subject `%`: `subj% v` broadcasts `v` to all current subscribers of the associated stream. Returns a Promise (see §6.10.1).
- `~<` / `~map`: single-step chain operators. Each registers a subscriber on the source stream and produces a derived stream carrying transformed values to that derived stream's own subscribers.
- `~<*` subscription form: registers the block body as a subscriber to the source stream; the block body executes per value broadcast from the source; the terminal expression's value emits into a resultant `PushStream`. A terminal `Left@ ...` expression unsubscribes this observer without closing the source (§6.10.3).
- `PushStream.merge@` / `.filter@` / `.scan@` / `.takeUntil@`: derived-stream constructors for fan-in, predicate filtering, stateful fold, and signal-driven close (§6.10.4).

**NOTE:** `~<<` (single-value do-block, §6.8.3) is not defined on `PushStream`. Streams have no single value to extract; `~<*` is the composition-form operator for multi-emission sources. This mirrors the split for other multi-emission types (§6.3, §6.8.4, §6.11).

#### §6.10.1 PushStream Unit Constructor

A `PushStream` instance is constructed exclusively through a subject; the `PushStream@` bare unit constructor is ill-formed and cannot be used (compiler error).

**NOTE:** This reflects the producer-driven nature of push streams: a stream without a producer would be permanently silent, discarding any construction values (since no subscription could exist at construction time).

A subject is created via `PushStream.subj@`. The subject holds the write capability (broadcasting values, closing the stream); the associated stream, exposed via `.st`, holds the read capability (subscription, chain composition). This split mirrors `PullStream`'s capability separation (§6.11.1).

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

#### §6.10.2 Closing

A stream is closed via `.close()` on the subject:

```java
def subj: PushStream.subj@;

subj.close();       // Right{true}

subj.close();       // Left{"PushStream Closed"}

subj.st.closed();   // true
```

Close capability lives on the subject; the observation of closed state lives on the stream. This matches the capability separation established in §6.10.1: subject-holders control the lifetime of the stream; stream-holders (pure observers) inspect it but cannot terminate it.

Closing is a one-time state transition:

- The first invocation of `.close()` returns `Right@ true`.
- Subsequent invocations return `Left@ "PushStream Closed"`.

Once closed:

- Any subsequent `subj% v` returns `Promise@ Left@ "PushStream Closed"` without broadcasting.
- Downstream composed streams close as the close signal propagates. `.closed()` on any downstream observer returns `true`.
- No further values propagate through the closed stream or its downstream chain.

Close propagates downstream, not upstream: closing a downstream observer does not close its source. The subject that owns the source retains control over the lifetime of the propagation chain rooted at it.

**NOTE:** Closing a stream releases stdlib-side memory associated with its subscriber registrations and downstream chain. Long-lived streams should be closed when no longer needed to avoid retention of subscribers.

#### §6.10.3 Subscription Via `~<*`

`PushStream ~<*` is the composition-form operator for push streams. The block-defs clause (per §16 grammar) binds each value broadcast from the source stream, and the block body executes per value received:

```java
def subj: PushStream.subj@;

def doubled: PushStream ~<* (v:: subj.st) {
    log(`"Received: `v`");
    v * 2;
};
// PushStream{}

def observer: doubled ~map (v) {
    log(`"Doubled: `v`");
    v;
};
// PushStream{}

subj% 1;
// Received: 1
// Doubled: 2
// Promise{Right{true}}

subj% 2;
// Received: 2
// Doubled: 4
// Promise{Right{true}}
```

Semantically, `PushStream ~<*` registers the block body as a subscriber to the source stream:

- `(v:: subj.st)` in the block-defs clause identifies the source stream and binds `v` to each value received from it.
- Body statements run for side effects on each value received.
- The terminal expression's value emits into the resultant stream (`doubled` above), which forwards it to its own subscribers.
- Multiple `PushStream ~<*` subscriptions on the same source each independently receive every value (broadcast).
- When the source stream closes, the subscription terminates and the resultant stream closes; close propagates downstream (§6.10.2).

Per §6.3.3 do-block-compilation split, `PushStream ~<*` compiles via the default route (chain-chain-chain-map): mid-block statements and `::`-binds compile through `~<`; a bare terminal expression compiles through `~map`. `~<` and `~map` on `PushStream` are the primitives; `~<*` is do-block sugar over them.

`~<` on `PushStream` is monadic bind under observation semantics: for each value broadcast by the source, the chained function is invoked to produce an inner `PushStream`; the derived stream subscribes to that inner and forwards any values the inner emits. Subscription is idempotent (§6.10 opener): re-subscribing an already-subscribed (derived, inner) pair is a no-op. The derived stream does not drive the inner's emissions -- values flow through the derived only when the inner is driven by its own producer (a subject-holder broadcasting elsewhere). The derived stream closes when the source closes and every subscribed inner has closed.

As a consequence of subscription idempotency, composition patterns that would multiply subscriptions under a naïve counting model (e.g., `sourceSt ~< { sharedInnerSt }` with repeated source deliveries) instead maintain a single subscription per pair. The example in the next NOTE illustrates.

**NOTE:** `~<` on `PushStream` is not equivalent to any of the flatmap variants named in reactive-programming literature (mergeMap, switchMap, concatMap, exhaustMap). Those variants all presuppose that the composition operator drives inner emission; they differ only in *how* driving is scheduled. Foi's execution model separates observation from driving: `~<` composes observation, and driving is the responsibility of whatever produced the inner stream. Users seeking driving-strategy patterns compose them explicitly from combinators (§6.10.4) alongside the driver primitives (`IO`, §6.12) that supply timing and iteration.

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

**NOTE:** A `~<*` block whose terminal expression evaluates to `Left@ ...` unsubscribes *this observer* from the source stream. The source stream and other subscribers are unaffected; only this block stops receiving values. The resultant stream produced by this `~<*` closes as a consequence (its emission source is gone). The `Left` value is the unsubscribe signal, not itself emitted into the resultant. This convention is uniform across `Promise ~<*` (§6.8.4), `PushStream ~<*`, and `PullStream ~<*` (§6.11.3).

**NOTE:** `~<*` polymorphism spans two categories.

**Iterable drainage** (§7): a Range LHS or an `Iter` LHS (§6.5) drives
one-at-a-time consumption of the source to its terminal. Each delivered
value binds to the block variable; the loop terminates when the source
exhausts. See §7 for full drainage semantics.

**Monadic subscription** (§6): four LHS shapes participate. An
effect-kinded LHS (`Effect.<...>`) establishes a handler scope (§6.3).
A `Promise` LHS drives unbounded async iteration terminated by a `Left`
terminal expression (§6.8.4). A `PushStream` LHS drives subscription to
a producer-broadcast source (§6.10.3). A `PullStream` LHS drives
subscription to a consumer-triggered delivery source (§6.11.3). The four
share the "block body runs per emission from the LHS source" pattern;
they differ in what constitutes an emission, what triggers each
emission, and what terminates the composition. Across all four, a
terminal `Left@ ...` unsubscribes the block itself; source-side
termination conditions vary per LHS (effect-scope end, Promise `Left`,
source close on streams).

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

A **PullStream** is a monadic *pull-driven source* of values -- a source whose emissions are triggered by consumer demand rather than by producer initiative. Unlike `PushStream` (§6.10), whose producer broadcasts values independently of any subscribers, a `PullStream` emits values only when its holder explicitly requests them from a fixed source; between requests, the stream idles without loss.

A stream is either **open** (accepting pull requests and delivering values in response) or **closed** (no further values propagate). Close is either explicit (`.close()` on the subject) or automatic on source exhaustion (see §6.11.1). Close signals propagate downstream to any composed observer.

**NOTE:** `PullStream` is monadic in the sense of the observable monad in reactive-programming literature, dual to `PushStream`. `~<` and `~map` are defined directly on it; `~<*` (§6.11.3) is the composition-form operator. Monad laws hold under observable-behavior equivalence: from any subscriber's viewpoint under an equivalent pull schedule, `(PullStream.of@ < v >).st ~< f` and `f v` produce streams indistinguishable in their emission sequence and close timing. As with `PushStream`, this is a weaker equivalence than the static-value equalities that hold for `Promise` or `Id`.

**NOTE:** Four design commitments frame `PullStream`'s subscription semantics, dual to `PushStream`'s:

- **Cold**: no values propagate until pulled. A stream whose subject is never triggered emits nothing.
- **Broadcast**: every currently-subscribed observer receives every emitted value. Subscription is fanout; a single pull-trigger delivers each emission to all current subscribers.
- **Source-bound**: emissions originate from a fixed source (an `Iter` supplied at construction), not from producer initiative. The subject-holder controls *when* values flow, not *what* values are.
- **Idempotent subscription**: a subscription is a relationship between subscriber and source, not an accumulating count. Establishing a subscription for a (subscriber, source) pair that already exists is a no-op. This invariant applies uniformly to every operator (`~<`, `~map`, `~<*`, combinators) that establishes subscriptions internally.

These match the cold-observable design well-worn in reactive-programming literature (with idempotent subscription as Foi's language-level addition). They distinguish `PullStream` from `PushStream` (hot, producer-initiated), from `Channel` (single-consumer, back-pressured, one-to-one), and from `Promise` (single-value, replayable via re-observation).

The userland surface is:

- `PullStream@ iter`: primitive unit constructor. Takes an `Iter` instance (§6.5) as its value source. Returns a subject.
- `PullStream.of@ < ... >`: value-ingestion constructor. Takes a Tuple whose elements become the stream's value sequence. Definitionally sugar for `PullStream@ (Iter@ < ... >)`. Returns a subject.
- `.close()`: close the stream. Available on the subject only. Returns `Right@ true` on first invocation; subsequent invocations return `Left@ "PullStream Closed"`. Close propagates downstream to composed observers.
- `.closed()`: available on the stream. Returns `true` if the stream is closed, `false` if open.
- Subject `%`: `subj% n` triggers up to `n` values to be pulled from the source and emitted to subscribers; unary `subj%` defaults to `n = 1`. Returns a Promise (see §6.11.1).
- `~<` / `~map`: single-step chain operators. Each registers a subscriber on the source stream and produces a derived stream carrying transformed values to that derived stream's own subscribers.
- `~<*` subscription form: registers the block body as a subscriber to the source stream; the block body executes per value emitted; the terminal expression's value emits into a resultant `PullStream`. A terminal `Left@ ...` expression unsubscribes this observer without closing the source (§6.11.3).
- `PullStream.merge@` / `.filter@` / `.scan@` / `.takeUntil@`: derived-stream constructors for fan-in, predicate filtering, stateful fold, and signal-driven close (§6.11.4).

**NOTE:** `~<<` (single-value do-block, §6.8.3) is not defined on `PullStream`. Streams have no single value to extract; `~<*` is the composition-form operator for multi-emission sources. This mirrors the split for other multi-emission types (§6.3, §6.8.4, §6.10).

#### §6.11.1 PullStream Unit Constructors

A `PullStream` instance is constructed through a subject, from an `Iter` (§6.5) source or from a tuple (value-ingestion sugar). The subject holds the write capability (triggering pulls, closing the stream); the associated stream, exposed via `.st`, holds the read capability (subscription, chain composition). This split mirrors `PushStream.subj@`'s capability separation.

The base form takes an `Iter`:

```java
def subj: PullStream@ (Iter@ < 1, 2, 3 >);
```

The value-ingestion form takes a tuple directly:

```java
def subj: PullStream.of@ < 1, 2, 3 >;
```

`PullStream.of@ < ... >` is definitionally sugar for `PullStream@ (Iter@ < ... >)`. Both return a subject; the tuple form is the ergonomic path for source sequences known at the call site.

**NOTE:** `PullStream.of@`'s argument is *always* a Tuple; its elements become the value sequence, consumed in tuple order. This eliminates the ambiguity a bare-value form would introduce: `PullStream.of@ < 1, 2, 3 >` unambiguously specifies a stream of three values, never a stream of one three-element tuple. Bare `PullStream.of@ v` with a non-tuple argument is ill-formed and produces a compiler error.

An empty tuple is legitimate:

```java
def subj: PullStream.of@ <>;
```

This yields a subject whose associated stream is already closed at construction (per §6.11.2, an exhausted source produces a closed stream). Any `subj% n` on it returns `Left@ "PullStream Closed"`.

The subject exposes a single field:

- `.st`: the associated `PullStream`, open at construction and awaiting subscribers.

Values are pulled from the source and emitted to subscribers by applying `%` to the subject with a count:

```java
def subj: PullStream.of@ < 1, 2, 3 >;

PullStream ~<* (v:: subj.st) {
    log(`"got: `v`");
    v;
};

subj% 2;
// got: 1
// got: 2
// Promise{Right{true}}

subj% 1;
// got: 3
// Promise{Right{true}}

subj% 1;
// Promise{Left{"PullStream Exhausted"}}
```

`subj% n` requests `n` values from the source. Each value pulled is broadcast to every current subscriber of the associated stream, in source order. The returned `Promise` resolves per the outcome:

- **`Right@ true`** if all `n` values were pulled and emitted successfully.
- **`Left@ "PullStream Exhausted"`** if the source ran out of values before `n` were delivered. The stream auto-closes.
- **`Left@ "PullStream Closed"`** if the stream was already closed at call time, or `.close()` was invoked on the subject while the pull was in flight (the pull aborts immediately).

Unary `subj%` is equivalent to `subj% 1`.

**NOTE:** Concurrent `subj% n` calls on the same subject are serialized in issue order. A `subj% 3` in flight fully completes (or fails) before a subsequently-issued `subj% 2` begins pulling. This preserves source-order emission as a stable contract; interleaved concurrent batches would produce non-deterministic delivery orderings.

`%` dispatch on the subject is realized via ordinary `_percent`-hook dispatch (§6.2); the hook is stdlib code that drives the pull-and-broadcast loop against the subject's bound `Iter` and current subscriber set.

**NOTE:** The stream is separable from its subject (but not vice versa). `subj.st` is a first-class value: it may be passed, stored, composed, and observed independently. Applying `%` to the subject is the sole path for the subject's holder to trigger pulls; `.close()` on the subject is the sole path to explicit close. Holders of only `.st` are pure observers -- they can subscribe, chain, and check `.closed()`, but cannot trigger emissions or close the source.

#### §6.11.2 Closing

A stream is closed via `.close()` on the subject:

```java
def subj: PullStream.of@ < 1, 2, 3 >;

subj.close();       // Right{true}

subj.close();       // Left{"PullStream Closed"}

subj.st.closed();   // true
```

Close capability lives on the subject; the observation of closed state lives on the stream. This matches the capability separation established in §6.11.1: subject-holders control the lifetime of the stream; stream-holders (pure observers) inspect it but cannot terminate it.

Closing is a one-time state transition:

- The first invocation of `.close()` returns `Right@ true`.
- Subsequent invocations return `Left@ "PullStream Closed"`.

Once closed:

- Any subsequent `subj% n` returns `Promise@ Left@ "PullStream Closed"` without pulling from the source.
- A `subj% n` in flight at the moment of close aborts immediately; its pending Promise resolves to `Left@ "PullStream Closed"`, regardless of how many values had been delivered from the aborted batch.
- Downstream composed streams close as the close signal propagates. `.closed()` on any downstream observer returns `true`.
- No further values propagate through the closed stream or its downstream chain.

In addition to explicit close, a `PullStream` auto-closes on source exhaustion: when a `subj% n` batch drains the underlying `Iter` before `n` values have been delivered, the stream transitions to closed as the batch completes, and the returned Promise resolves to `Left@ "PullStream Exhausted"` (§6.11.1). Subsequent `subj% n` calls on the auto-closed stream return `Left@ "PullStream Closed"` in the usual way.

The exhausted-vs-closed distinction is observable only on the batch that first drives the source to exhaustion. A source that is exhausted at construction (an empty `Iter`) produces an already-closed stream; the first `subj% n` returns `Left@ "PullStream Closed"`, not `"PullStream Exhausted"`, because no batch was in flight to observe the transition.

Close propagates downstream, not upstream: closing a downstream observer does not close its source. The subject that owns the source retains control over the lifetime of the propagation chain rooted at it.

**NOTE:** Closing a stream releases stdlib-side memory associated with its subscriber registrations and downstream chain, and drops the reference to the underlying `Iter` source. Long-lived streams should be closed when no longer needed to avoid retention of subscribers and source state.

#### §6.11.3 Subscription Via `~<*`

`PullStream ~<*` is the composition-form operator for pull streams. The block-defs clause (per §16 grammar) binds each value delivered from the source stream, and the block body executes per value:

```java
def subj: PullStream.of@ < 1, 2, 3 >;

def doubled: PullStream ~<* (v:: subj.st) {
    log(`"Received: `v`");
    v * 2;
};
// PullStream{}

def observer: doubled ~map (v) {
    log(`"Doubled: `v`");
    v;
};
// PullStream{}

subj% 2;
// Received: 1
// Doubled: 2
// Received: 2
// Doubled: 4
// Promise{Right{true}}

subj% 1;
// Received: 3
// Doubled: 6
// Promise{Right{true}}
```

Semantically, `PullStream ~<*` registers the block body as a subscriber to the source stream:

- `(v:: subj.st)` in the block-defs clause identifies the source stream and binds `v` to each value delivered from it.
- Body statements run for side effects on each value delivered.
- The terminal expression's value emits into the resultant stream (`doubled` above), which forwards it to its own subscribers.
- Multiple `PullStream ~<*` subscriptions on the same source each independently receive every delivered value.
- When the source stream closes (explicitly via `.close()` on the subject, or automatically on source exhaustion), the subscription terminates and the resultant stream closes; close propagates downstream (§6.11.2).

Per §6.3.3 do-block-compilation split, `PullStream ~<*` compiles via the default route (chain-chain-chain-map): mid-block statements and `::`-binds compile through `~<`; a bare terminal expression compiles through `~map`. `~<` and `~map` on `PullStream` are the primitives; `~<*` is do-block sugar over them.

`~<` on `PullStream` is monadic bind under observation semantics: for each value delivered from the source, the chained function is invoked to produce an inner `PullStream`; the derived stream subscribes to that inner and forwards any values the inner emits. Subscription is idempotent (§6.11 opener): re-subscribing an already-subscribed (derived, inner) pair is a no-op. The derived stream does not drive the inner's emissions -- values flow through the derived only when the inner is driven by its own producer (a subject-holder pulling elsewhere, or another operator that drives streams). The derived stream closes when the source closes and every subscribed inner has closed.

As a consequence of subscription idempotency, composition patterns that would multiply subscriptions under a naïve counting model (e.g., `sourceSt ~< { sharedInnerSt }` with repeated source deliveries) instead maintain a single subscription per pair. The example in the next NOTE illustrates.

**NOTE:** `~<` on `PullStream` is not equivalent to any of the flatmap variants named in reactive-programming literature (mergeMap, switchMap, concatMap, exhaustMap). Those variants all presuppose that the composition operator drives inner emission; they differ only in *how* driving is scheduled. Foi's execution model separates observation from driving: `~<` composes observation, and driving is the responsibility of whatever produced the inner stream. Users seeking driving-strategy patterns compose them explicitly from combinators (§6.11.4) alongside the driver primitives (`IO`, §6.12) that supply timing and iteration.

To illustrate observation-only composition, consider a shared external inner:

```java
def su1: PullStream.of@ < 1, 2, 3 >;
def su2: PullStream.of@ < 10, 20, 30 >;

def derived: su1.st ~< { su2.st };

PullStream ~<* (v:: derived) {
    log(`"derived: `v`");
};

su2%;
// (nothing -- derived isn't subscribed to su2.st yet)

su1%;
// (nothing observable downstream; derived now subscribed to su2.st)

su2%;
// derived: 20
// (su2 delivers 20; single subscription forwards to derived)

su1%;
// (idempotent no-op; already subscribed)

su2%;
// derived: 30
```

The first `su2%` delivers `10` before any subscription exists on `su2.st`, so it is lost. The first `su1%` triggers the `~<` block once, which returns `su2.st`, subscribing the derived. The second `su2%` delivers `20`, which the single subscription forwards. The second `su1%` re-attempts subscription to `su2.st` -- idempotent no-op. The third `su2%` still has a single subscription, so `30` forwards once, not twice.

`~<` and `~map` remain first-class chain operators and may be used directly for single-step subscription-with-transform:

```java
subj.st ~map (v) {
    v * 2;
};
```

**NOTE:** A `~<*` block whose terminal expression evaluates to `Left@ ...` unsubscribes *this observer* from the source stream. The source stream and other subscribers are unaffected; only this block stops receiving values. The resultant stream produced by this `~<*` closes as a consequence (its emission source is gone). The `Left` value is the unsubscribe signal, not itself emitted into the resultant. This convention is uniform across `Promise ~<*` (§6.8.4), `PushStream ~<*` (§6.10.3), and `PullStream ~<*`.

For `PullStream ~<*` specifically, unsubscribe is immediate: if a `subj% n` batch is in flight and the block returns `Left@ ...` on the k-th delivered value, subsequent values within the same batch (values k+1 through n) are not delivered to this observer, but continue to be delivered to any remaining subscribers. The `subj% n` promise still resolves per its normal contract (§6.11.1), unaffected by any individual subscriber's unsubscribe.

**NOTE:** `~<*` polymorphism spans two categories.

**Iterable drainage** (§7): a Range LHS or an `Iter` LHS (§6.5) drives
one-at-a-time consumption of the source to its terminal. Each delivered
value binds to the block variable; the loop terminates when the source
exhausts. See §7 for full drainage semantics.

**Monadic subscription** (§6): four LHS shapes participate. An
effect-kinded LHS (`Effect.<...>`) establishes a handler scope (§6.3).
A `Promise` LHS drives unbounded async iteration terminated by a `Left`
terminal expression (§6.8.4). A `PushStream` LHS drives subscription to
a producer-broadcast source (§6.10.3). A `PullStream` LHS drives
subscription to a consumer-triggered delivery source (§6.11.3). The four
share the "block body runs per emission from the LHS source" pattern;
they differ in what constitutes an emission, what triggers each
emission, and what terminates the composition. Across all four, a
terminal `Left@ ...` unsubscribes the block itself; source-side
termination conditions vary per LHS (effect-scope end, Promise `Left`,
source close on streams).

#### §6.11.4 PullStream Combinators

Four named constructors on the `PullStream` namespace provide the core primitives that operators alone cannot express. Each `@`-marked constructor takes a single tuple argument (per the unary-`@` convention); multi-material constructions express positional roles through the tuple shape. These four parallel §6.10.4's constructors on `PushStream` and are the substrate for building richer pull-driven patterns in userspace.

Each combinator subscribes to its source stream(s) and produces a derived stream; per §6.11.3, subscription is observation, not driving. Values flow through the derived stream when the sources are driven by their own subject-holders (via `subj% n` on the underlying subjects, per §6.11.1).

**`PullStream.merge@ < ...sts >`** fans in a list of source streams into a single derived stream:

```java
def su1: PullStream.of@ < 1, 2, 3 >;
def su2: PullStream.of@ < 10, 20, 30 >;

def merged: PullStream.merge@ < su1.st, su2.st >;

PullStream ~<* (v:: merged) {
    log(`"merged: `v`");
};

su1%;      // merged: 1
su2%;      // merged: 10
su1%;      // merged: 2
```

The derived stream emits every value delivered by any source, in the order they arrive across sources; ordering across sources reflects arrival order at the derived stream. The derived stream closes once every source stream has closed.

**NOTE:** Per §6.11.3's idempotent-subscription invariant, listing the same source stream more than once in a `merge@` tuple is not an error but does not multiply delivery. The derived stream holds one subscription per distinct source; a source that appears twice in the input tuple contributes its emissions once.

**`PullStream.filter@ < sourceSt, pred >`** returns a derived stream that emits only source values passing a predicate:

```java
def subj: PullStream.of@ < 1, 2, 3, 4 >;

def evens: PullStream.filter@ <
    subj.st,
    (defn(v) ^(mod(v, 2) ?= 0))
>;

PullStream ~<* (v:: evens) {
    log(`"even: `v`");
};

subj% 4;
// even: 2
// even: 4
```

`pred` is applied to each source-delivered value; only values for which `pred(v)` returns truthy are forwarded to the derived stream. The derived stream closes when the source closes.

**`PullStream.scan@ < sourceSt, init, fn >`** returns a derived stream that emits accumulated values from a stateful fold across source emissions:

```java
def subj: PullStream.of@ < 1, 2, 3 >;

def totals: PullStream.scan@ <
    subj.st,
    0,
    (defn(acc, v) ^(acc + v))
>;

PullStream ~<* (t:: totals) {
    log(`"total: `t`");
};

subj% 3;
// total: 1
// total: 3
// total: 6
```

`fn(acc, v)` is applied with the current accumulator and each source-delivered value; its return value becomes both the new accumulator and the derived stream's emitted value. `init` is the initial accumulator; the derived stream does not emit `init` itself; it emits the first result of `fn(init, v0)` when the first source value is delivered. The derived stream closes when the source closes.

**`PullStream.takeUntil@ < sourceSt, signalSt >`** returns a derived stream that forwards from `sourceSt` and closes when `signalSt` emits its first value:

```java
def subj: PullStream.of@ < 1, 2, 3, 4 >;
def stop: PullStream.of@ < true >;

def bounded: PullStream.takeUntil@ < subj.st, stop.st >;

PullStream ~<* (v:: bounded) {
    log(`"bounded: `v`");
};

subj% 2;      // bounded: 1
              // bounded: 2
stop%;        // (bounded closes)
subj% 1;      // (nothing -- bounded is closed)
```

The signal stream's emitted value is not itself forwarded; only its arrival triggers the close of the derived stream. If either the source or signal closes without the signal ever emitting, the derived stream closes at that point.

**NOTE:** These four combinators are the atomic primitives Foi commits to on the `PullStream` namespace. Higher-order patterns familiar from reactive-programming literature -- latest-wins flatmap (`switchMap`), sequential flatmap (`concatMap`), coordinated latest values across sources (`combineLatest`), debouncing, throttling, distinct-value filtering, and so on -- are userspace compositions of these four combinators, the `~<` / `~map` / `~<*` operators, and (for time-based patterns) IO primitives (§6.12). Foi does not commit to those higher-order patterns in spec; libraries provide them.

### §6.12 IO

An **IO** is a deferred computation that represents a side-effecting action -- printing, network access, file access, timers, random numbers, or any other action whose result is not solely determined by its inputs. No code runs at construction; execution is triggered by applying `%` to the IO instance.

`IO` composes three concerns into a single monadic type:

- **Task**: the deferred side-effect execution itself. An `IO` instance holds an executor function that runs when `%` is applied.
- **Reader**: an environment value threaded implicitly through the chain of composed IOs. The environment is supplied at `%`-application time and delivered to each composed executor.
- **Promise Transformer**: when an IO's execution encounters a `Promise` instance mid-chain, the surrounding IO evaluation lifts into `Promise` space (§6.8). Analogous lifting occurs over `Channel` (§6.9) and Streams (§6.10, §6.11), each per that type's semantics.

The userland surface is:

- `IO@`: unit constructor over an executor function.
- `IO.of@`: named unit constructor over a bare value (equivalent to `IO@ (defn() ^value)`).
- Unary `%`: runs the executor with no Reader environment.
- Binary `%`: runs the executor with the supplied Reader environment.
- `~<<` do-block composition: sequences IO operations, threading the Reader environment through each step, per §6.3.3 do-block-compilation split.

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

- `def v:: getValue()` binds `x` to the underlying value produced by `getValue()` (an `IO` instance) and sequences its executor into the chain.
- A bare mid-block statement sequences the IO step and discards its produced value. Explicit `:: expr;` at this position is legal but redundant.
- The terminal expression is `~map`-lifted into the ambient `IO`. A bare terminal (`v * 2` above) becomes the block's produced value.
- A `::`-prefixed terminal (`::expr`) binds `expr` before the terminal map, avoiding double-wrap when the terminal expression is itself already an `IO`.

The Reader environment supplied at `%`-application time is threaded implicitly through every composed step's executor -- each step sees the same environment (see §6.12.4).

Per §6.3.3 do-block-compilation split, `IO ~<<` composition compiles via the default route (compile-time expansion to nested `~<` / `~map`).

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
IO.asks@ (.<x>);     // aka: IO@ (defn(env) ^env.x)
```

Used inside a `~<<` block:

```java
def task: IO ~<< {
    def env:: IO.ask@;
    def x:: IO.asks@ (.<x>);
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
def readUserId: IO.asks@ (.<user.id>);

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

Analogous transformer semantics apply when IO evaluation encounters a `Channel` (§6.9), `PushStream` (§6.10), or `PullStream` (§6.11) -- each per that type's semantics.

### §6.13 Effect Signatures

Foi's effect system requires **discipline at the declaration surface**: every non-ambient effect a function might perform must be recorded somewhere the compiler can verify. This section specifies how that recording works: the `:Effects(...)` clause on function types, when declaration is mandatory versus inferred, and how the compiler verifies coverage across a call stack.

The discipline is intentionally light on ceremony. Declaration is required only where effects are first emitted; the compiler tracks their propagation up the call stack silently; a `~<*` handler somewhere before the outermost `%` boundary satisfies coverage.

A companion category -- **ambient effects** -- is exempted from the discipline entirely. A small stdlib-designated set (Log, Random, CurrentTime) is handled by a runtime top-level handler; those effects need no signature declaration and no user-side `~<*` coverage. §6.13.5 specifies the ambient category.

#### §6.13.1 The `:Effects(...)` Clause

An effect set is declared on a function type via `:Effects(...)`, attached to a `deft` function-type expression (§18) between the parameter list and the return type:

```java
deft AskName(int) :Effects(Ask) ^String;
deft LogTwice(int) :Effects(Log) ^empty;
deft Composite(int) :Effects(Ask, Retry) ^bool;
```

The set expression inside the parens uses the pick-syntax DSL of §6.3.1 verbatim: bare form, brace-enumerated subset, and `&`-prefix inclusion all admitted:

```java
deft WithIO(String) :Effects(&Effect.IO) ^bool;
deft Mixed(int) :Effects(Ask, Log, &Effect.IO) ^String;
```

Empty effect set is expressed by omitting the clause; explicit `:Effects()` is legal but redundant:

```java
deft Pure(int) ^int;                 // implicit :Effects()
deft AlsoPure(int) :Effects() ^int;  // legal, redundant
```

The `:Effects(...)` clause is admitted on `deft` function-type expressions only. It is not admitted directly on `defn`. To attach a declared effect set to a function value, use `:as` with a type that carries the clause:

```java
deft AskName(int) :Effects(Ask) ^String;

defn askName(id) :as AskName ^Effect.Ask% id;
```

#### §6.13.2 Emit-Edge Declaration

A function that **directly performs** a non-ambient effect must include an `:as` type attachment whose `:Effects(...)` list includes that effect. This is the **emit-edge rule**, and it is mandatory: absence of a matching declaration at an emit-edge is a compile error.

"Directly performs" means the function's own body contains a perform site (via `%` on an effect-kinded LHS, per §6.2, or via the `<::` sugar of §6.2.2) for the effect in question. Performs that occur only in callees are not direct; they belong to those callees' emit-edge declarations.

```java
deft AskName(int) :Effects(Ask) ^String;

defn askName(id) :as AskName ^Effect.Ask% id;    // legal: emit-edge declared

defn askNameUndeclared(id) ^Effect.Ask% id;      // COMPILE ERROR
```

The compile error localizes to the emit-edge function's definition, naming the specific effect kind that lacks declaration.

Over-declaration is legal. A `deft` may declare more effects than the function body actually performs; the extra effects broaden the caller-facing contract without changing behavior:

```java
deft AskAndMaybeRetry(int) :Effects(Ask, Retry) ^String;

defn askOnly(id) :as AskAndMaybeRetry ^Effect.Ask% id;   // legal
// Body performs only Ask; Retry is declared but never emitted.
```

Under-declaration -- declaring fewer effects than actually emitted -- is not legal.

#### §6.13.3 Propagation and Inference

A function that **only calls other functions** (performs no direct emits, or only ambient ones) does not require a `:Effects(...)` bearing type attachment. The compiler infers its applicable effect set from the union of its callees' declared effects, minus any effects handled by `~<*` scopes lexically enclosing the call sites.

```java
deft AskName(int) :Effects(Ask) ^String;
defn askName(id) :as AskName ^Effect.Ask% id;

defn greetUser(id) {            // no :as, no declared effects
    def name: askName(id);      // compiler infers Ask in scope
    log(`"Hello, `name`");      // Log is ambient; no tracking
    ^name;
};
```

`greetUser` performs no direct non-ambient emit. Its inferred effect set includes `Ask` (propagated from `askName`). No emit-edge declaration is required on `greetUser`; the tracking continues silently up the call chain.

Explicit declaration at intermediate positions is legal (defensive documentation, or explicit API-boundary intent). If declared, the declared set must be a superset of the inferred set:

```java
deft GreetUser(int) :Effects(Ask) ^String;
defn greetUser(id) :as GreetUser {
    def name: askName(id);
    log(`"Hello, `name`");
    ^name;
};
```

**Higher-order functions.** When a function takes another function as an argument, the callee's effect surface is known from the callee's declared type at each call site. No effect-variable syntax is needed in the higher-order function's signature; the compiler resolves the effect set per-call-site:

```java
defn retry(fn) ^fn();                // no declared effects

def attempt1: retry(askName);        // resolves with Ask in scope
def attempt2: retry(pureThunk);      // resolves with empty set
```

The two invocations of `retry` induce different inferred effect surfaces from their surrounding scopes, per the callee passed at each site. `retry` itself remains undeclared; the effect polymorphism is a compile-time inference, not a first-class type-language feature.

#### §6.13.4 Coverage Verification

The compiler verifies **coverage** for every non-ambient effect that propagates. For each perform-site in the program, the compiler traces outward through the call stack (statically, using declared effect surface on callee types) and confirms that at least one lexically-enclosing `~<*` handler catches the effect kind before the outermost `%` boundary is reached.

Coverage is **per-call-stack, not per-function**. A given intermediate function need not itself wrap with a handler; the requirement is only that *some* enclosing frame in the propagation path handles every emitted effect:

```java
deft AskName(int) :Effects(Ask) ^String;
defn askName(id) :as AskName ^Effect.Ask% id;

def result: (Effect.Ask ~<* (eff:: greetUser(42)) {
    ::?(eff.__kind){
        ?[Effect.Ask]: `"user-`eff.payload`";
    };
})%;
```

The `Effect.Ask ~<* (eff:: ...) { ... }` handler encloses the call to `greetUser`, which transitively performs `Effect.Ask`. Coverage is satisfied; the outermost `%` invocation is well-formed.

If no such handler exists on any path from a perform-site to the outermost `%` boundary, the compile error includes the call stack from the perform-site (naming the effect kind) to the outermost `%` invocation, indicating which effect escaped without handling.

Ambient effects are pre-covered by the runtime top-level handler installed at every outermost `%` invocation (§6.13.5); they are excluded from the coverage trace entirely.

#### §6.13.5 Ambient Effects

A small built-in set of effect kinds is **ambient**. The ambient effects are:

- `Effect.Log`: default handler: stdout write.
- `Effect.Random`: default handler: PRNG (seedable at boundary).
- `Effect.CurrentTime`: default handler: system clock.

Ambient effects are handled by a runtime-installed handler scope wrapping every outermost `%` invocation. Callers need not declare ambients in `:Effects(...)`; the emit-edge rule (§6.13.2) does not apply to them, nor does the coverage requirement (§6.13.4) apply to them.

A user may shadow the ambient handler for a bounded region by establishing a `~<*` scope for that effect kind lexically above a perform site. Standard dynamic lookup (§6.1.2) finds the user's handler before the outermost handler provided by the runtime, handling the effect (and stopping propagation):

```java
Effect.Log ~<* (eff:: doWork()) {
    ::?(eff.__kind){
        ?[Effect.Log]: captureForTest(eff.payload);
    };
};
```

Inside this scope, `log()` calls (or any direct `Effect.Log%` perform) resolve to the user's `captureForTest` arm; outside, they resolve to the runtime default (stdout).

Declaring an ambient in a `:Effects(...)` clause is legal but redundant; the compiler neither requires it nor checks against it. Users who wish to document ambient use explicitly at an API boundary may do so:

```java
// legal, documentary; no compile effect
deft LogsProgress(int) :Effects(Log) ^empty;
```

**NOTE:** The ambient category is deliberately narrow. Effects with Left-carrying resume (any perform whose value the caller must inspect), any effect that writes to persistent state, and any effect that opens network or file resources are outside the ambient category by design: those effects belong to the tracked discipline where callers explicitly acknowledge them. The ambient set is fixed by the runtime; users cannot mark their own effect kinds as ambient.

#### §6.13.6 Interaction With `Gen.` Prefix

A `Gen.`-prefixed type implicitly carries `Effect.Yield` in its declared effect list (§6.6.1). The effect surface of a `Gen.` type is `{Yield} ∪ declared`.

Explicit `:Effects(Yield)` on a `Gen.` type is legal but redundant. Additional non-Yield effects are added via explicit clause and merge with the implicit Yield:

```java
// effective: {Yield}
deft Gen.Numbers(int, int) ^Iter;

// effective: {Yield, Ask}
deft Gen.AskingNumbers(int) :Effects(Ask) ^Iter;
```

The emit-edge rule of §6.13.2 applies uniformly: a generator whose body performs `Effect.Ask` must attach (via `:as`) a `Gen.`-prefixed type whose declared effects include `Ask`. `Yield` performs (via `<::`) are covered by the implicit Yield in every `Gen.` type; the emit-edge declaration for Yield is discharged by the `Gen.` prefix itself.

Coverage for `Yield` is discharged by the reification transform's internal `Effect.Yield ~<*` scope (§6.6.6): every yield performed inside a generator body is caught by the transform-installed handler before any escape. Yield never propagates past the generator's own type surface.

Non-Yield effects performed inside a generator body propagate normally: the internal `Effect.Yield ~<*` scope is narrowed to Yield only (per §6.3.1 narrowing), so a `Effect.Ask` perform in the generator body escapes past the scope and follows the standard tracking discipline, resolving at whichever handler in the generator's dynamic call stack catches `Ask`.
