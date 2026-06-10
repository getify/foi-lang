# Foi Lexer — Implementation Notes

Companion document to the Foi Lexical Grammar (EBNF) in
`Lexical-Grammar.md`. The grammar specifies *what* the lexer
matches; this document specifies *how* the combinator-form lexer
in `new-tokenizer.js` implements it, with enough detail to
reproduce the implementation choices, tree shape, and event
stream.

The combinator constructs used (`lazy`, `parse`, `production`,
`terminal`, `and`, `or`, `optional`, `any`, `many`, `not`,
`lookahead`, `eof`, `gate`, `dispatch`, `presets`) are exported
from `parser-combinators.js`. Their internal mechanics are out
of scope here; this document only describes how they are
*composed* to realize the Foi lex grammar.


## 1. Architectural Posture

The lexer is a streaming PEG parser over character input. Tokens
are emitted as `commit` events on depth-1 frames; the top-level
`Tokens` production is the only depth-0 frame. Subscribers using
`presets.parseTokens` receive emission events for each token as
it is recognized.

**Token grain.** Each named production whose name matches a
tokenizer type string (e.g., `"Whitespace"`, `"Comment"`,
`"Number"`, the single-char operator names) corresponds to
exactly one emitted token. The `production()` wrapper is what
turns a grammar fragment into a frame; anonymous `and(...)` /
`or(...)` wrappers do not emit their own frames, so their inner
productions appear at the same depth as their parent would.

**No cross-token state.** The lexer maintains no mutable state
that persists across token boundaries. The hyphen-as-sign
disambiguation is handled per-token via the `expressionEnding`
wrapper (§11) rather than via a global flag.

**Async streaming input.** The lexer accepts an async or sync
iterable of characters. Buffering is unbounded; sufficient for
source-file-sized inputs.


## 2. EBNF-to-Implementation Mapping

Each EBNF construct in `Lexical-Grammar.md` maps to a fixed
combinator form:

| EBNF | Combinator |
| --- | --- |
| sequence `A B` | `and(A, B)` |
| ordered choice `A \| B` | `or(A, B)` |
| optional `A?` | `optional(A)` |
| zero-or-more `A*` | `any(A)` |
| one-or-more `A+` | `many(A)` |
| positive lookahead `&(A)` | `lookahead(A)` |
| negative lookahead `!(A)` | `not(A)` |
| regex char class `#"[...]"` | `terminal(c => /[...]/u.test(c))` |
| literal `"x"` | `ch("x")` |
| EOF | `eof()` |
| visible non-terminal `Name := …` | `production("Name", body)` |
| hidden non-terminal `<Name> := …` | bare `and(...)` / `or(...)` bound to a `var` |
| forward reference | `lazy(() => Name)` |

The mapping is purely textual: a grammar reader can produce the
combinator form for any rule by direct substitution. The places
where the impl reaches outside this table — `gate()`,
`dispatch()`, `onMatch` callbacks — are flagged in the EBNF with
inline `(* … *)` notes and expanded in the relevant section
below.


## 3. What Becomes a Production

A grammar rule becomes a `production("NAME", ...)` if and only
if its name appears in the emitted token stream. Token types in
the lexer's output:

```
Whitespace, Comment, Number, PositiveIntegerLit, NegativeIntegerLit, General,
Keyword, Native, Builtin, Comprehension, BooleanOper,
String, StringEscapedChar, DoubleQuote,
Backtick, Escape, Hyphen,
TriplePeriod, DoublePeriod, DoubleColon,
<all single-char operator names: Tilde, Exmark, …, Backtick>
```

Helper rules in the grammar (`IdentBody`, `DigitsWithSep`,
`HexDigitsWithSep`, `NumberBody`, the various `*Content` rules
inside strings, the digit helpers inlined into Number variants)
are NOT productions — they are `var` bindings to anonymous
`and(...)` / `or(...)` fragments reused by name within the file
but creating no frames.

The EBNF marks this distinction directly: hidden rules carry
angle brackets on the LHS (`<Name> := ...`) and emit no node —
their content splices into the parent. Unbracketed names emit a
node. The mapping is mechanical: angle-bracketed ⟺ bare
`and(...)` / `or(...)`; unbracketed ⟺ `production(NAME, ...)`.

**Alias families.** Several unbracketed names are aliases for
productions whose emitted token type differs from the EBNF name:

- **Eight Escape variants** — `EscapeBacktick`, `EscapePlain`,
  `EscapeSpacingBacktick`, `EscapeHex`, `EscapeUnicode`,
  `EscapeOctal`, `EscapeBinary`, `EscapeMonadic` — all emit
  `Escape` tokens distinguished by value. See §9.
- **Six Number variants** — `HexNumber`, `UnicodeNumber`,
  `OctalNumber`, `BinaryNumber`, `MonadNumber`, `BareNumber` —
  all emit `Number` tokens, each paired with its corresponding
  Escape variant inside `EscapedNumber`. The standalone
  source-level decimal Number production (JS binding `NumberLit`,
  EBNF name `Number`) also emits `Number`.
- **`PositiveIntegerLitWithSep`** is an alias for
  `PositiveIntegerLit` — separator-bearing form paired with
  `EscapePlain` inside `EscapedNumber`; emits a
  `PositiveIntegerLit` token. See §3.1 for the full integer-lit
  story including the non-alias siblings (bare
  `PositiveIntegerLit`, `NegativeIntegerLit`, and the hidden
  `<IntegerLit>` union).
- **Four String content emitters** — `PlainStrChars`,
  `InterpStrChars`, `SpacingInterpStrChars`,
  `SpacingEscapedStrChars` — all emit `String` tokens,
  distinguished by which characters their content predicate
  accepts. Each fires from inside exactly one string form.

These exist because the grammar reads more clearly when the role
of an emitter is named at its use site; the impl collapses each
family to its shared emitted token type. Inline EBNF comments
flag each alias.

**String forms as bare `and(...)`.** All four string-form rules
(`StringLit`, `InterpStr`, `SpacingInterpStr`,
`SpacingEscapedStr`) are bare `and(...)` expressions, not
productions. The token stream for each contains the individual
`DoubleQuote` (or `Escape` + `DoubleQuote` for the three
escape-bearing forms), content tokens (`String`,
`StringEscapedChar`, `Whitespace`, `Backtick`, etc.), and closing
`DoubleQuote` as separate depth-1 emissions. Wrapping any of
them as a production would add an extra frame layer that no
consumer wants.

**`EscapedNumber` as bare `or(...)`.** `EscapedNumber` is a bare
`or(...)` of six arms, each pairing an Escape variant with an
inner `or(...)` that tries the appropriate Number variant first
and falls back to `General` if the Number variant fails:

```js
EscapedNumber = or(
    and(EscapeHex,     or(HexNumber,     General)),
    and(EscapeUnicode, or(UnicodeNumber, General)),
    and(EscapeOctal,   or(OctalNumber,   General)),
    and(EscapeBinary,  or(BinaryNumber,  General)),
    and(EscapeMonadic, or(MonadNumber,   General)),
    and(EscapePlain,   or(PositiveIntegerLitWithSep, BareNumber, General))
);
```

Each arm emits two tokens — an `Escape` carrying the opener value
(e.g. `"\h"`) and the inner production's token (a `Number`,
`PositiveIntegerLit`, or `General`). Because both sides of each
pair are named productions and the dispatch itself is hidden, the
syntactic grammar can reference `EscapedNumber` and get exactly
the (Escape, content) child pair spliced into the parent.

**General fallback rationale.** When a multi-char Escape opener
commits but the expected number content doesn't match, the
General fallback allows the arm to still succeed if the trailing
content is identifier-shaped. Without this, cases like `\h_foo`,
`\h2Axyz`, `\b101xyz`, etc. would roll back the entire arm and
fall through to standalone `EscapePlain`.

**The EscapePlain arm.** This single arm has three
sub-alternatives inside the inner `or`:
`PositiveIntegerLitWithSep` first, `BareNumber` second, `General`
last. PEG order matters:

- `PositiveIntegerLitWithSep` first means `\5_000` lexes as
  `Escape("\") + PositiveIntegerLit("5_000")` rather than falling
  through to `BareNumber`.
- `BareNumber` catches decimal-bearing forms (`\5.5` →
  `Escape("\") + Number("5.5")`).
- `General` is the last fallback, firing only when both number
  variants have failed. So `\1foo` →
  `Escape("\") + General("1foo")` (both number variants fail
  their `NotIdentCont` guard; General matches the digit-leading
  identifier).

The `!("." Digit)` lookahead inside `PositiveIntegerLitWithSep`
forces fallthrough to `BareNumber` when the digits are followed
by a decimal point.

### 3.1 The IntegerLit Token Types

The syntactic grammar carves out two related restrictions at the
token level. Property indexes (`<.foo, 5>`) accept positive
integer literals only; the shape constraint is "digit run, no
leading `-`, no fractional part, doesn't extend into an
identifier." Dot-access indices (`arr.5`, `arr.-1`) accept
integer literals of either sign; the shape adds "optional leading
`-`" but is otherwise identical.

Two visible token types encode the restrictions directly:
`PositiveIntegerLit` (positive-only) and `NegativeIntegerLit`
(sign required). The hidden `<IntegerLit>` union covers either
sign and is used at sites that accept both.

The rationale: encoding the shape restriction as a token type
keeps the syntactic grammar free of value-shape gates. Every
visible syn production maps to a combinator form by direct
textual translation; nowhere does the syn impl need an
out-of-band "gate on this token's value" step. This is
load-bearing for the mechanical round-trippability of
`Syntactic-Grammar.md`.

The implementation uses three productions and a hidden union:

```js
var NotDotDigit  = not(lookahead(and(ch(C.Period), terminal(isDigit))));
var NotIdentCont = not(lookahead(terminal(isIdentCont)));

export const PositiveIntegerLit = production("PositiveIntegerLit",
    and(many(terminal(isDigit)), NotDotDigit, NotIdentCont)
);

export const NegativeIntegerLit = production("NegativeIntegerLit",
    and(ch(C.Hyphen), many(terminal(isDigit)), NotDotDigit, NotIdentCont)
);

// Hidden union — used in <Token> via numberEnding(expressionEnding(IntegerLit)).
var IntegerLit = or(NegativeIntegerLit, PositiveIntegerLit);

export const PositiveIntegerLitWithSep = production("PositiveIntegerLit",
    and(DigitsWithSep, NotDotDigit, NotIdentCont)
);
```

`PositiveIntegerLit` is the bare top-level positive form (no
separators); `PositiveIntegerLitWithSep` is the escaped positive
form reachable only via `EscapedNumber` paired with `EscapePlain`
(alias pattern — both emit `PositiveIntegerLit` token type).
`NegativeIntegerLit` is the bare top-level negative form,
emitting its own distinct token type. There's no separator-bearing
escaped negative form; signed integers with separators fall
through to `BareNumber` instead. The hidden `IntegerLit` union
covers both signs at sites that accept either.

The shared `NotDotDigit` helper enforces the `!("." Digit)`
lookahead so a decimal point followed by digits doesn't get
split into an integer + a fractional `Number` — the dispatch
falls through to `NumberLit` (bare) or to the `BareNumber` arm
of `EscapedNumber` (escaped). The shared `NotIdentCont` helper
enforces digit-leading-identifier disambiguation; see §3.2.

### 3.2 The NotIdentCont Guard Family

Foi permits identifiers to start with digits (`1foo`, `5_value`,
`1_000_000`). The `sawNonDigit` gate (§4) ensures that
pure-digit runs become Numbers rather than identifiers, but says
nothing about runs that START with digits and CONTINUE into
identifier chars. Without an additional guard, the
integer-shaped number productions would prematurely match the
leading digits, leaving the trailing identifier-chars as a
separate (incoherent) token.

The fix is a uniform `NotIdentCont` guard on every
integer-shaped number production:

```js
var NotIdentCont = not(lookahead(terminal(isIdentCont)));
```

Productions carrying `NotIdentCont`:

```
PositiveIntegerLit,  NegativeIntegerLit,  PositiveIntegerLitWithSep,
NumberLit (integer branch only),
HexNumber,  UnicodeNumber,  OctalNumber,  BinaryNumber,
MonadNumber (integer branch only),
BareNumber  (integer branch only)
```

The decimal branches of `NumberLit`, `MonadNumber`, and
`BareNumber` do NOT need the guard — once `.` is consumed and a
fractional digit run follows, the position is unambiguously
inside a number. The structural split for `NumberLit`:

```js
export const NumberLit = production("Number",
    and(
        optional(and(ch(C.Hyphen), lookahead(terminal(isDigit)))),
        or(
            // Decimal: commits.
            and(many(terminal(isDigit)), ch(C.Period), many(terminal(isDigit))),
            // Integer-only: backs off on IdentCont continuation.
            and(many(terminal(isDigit)), NotIdentCont)
        )
    )
);
```

The decimal arm tries first; if it fails (no `.` after the digit
run), the integer arm with `NotIdentCont` tries. On
`IdentCont`-leading continuations, NumberLit's integer arm itself
backs off; an outer Hyphen + General path then consumes the
input. Result: `-5foo` lexes as `Hyphen, General("5foo")`.


## 4. The IdentBody sawNonDigit Gate

The grammar's `IdentBody` is a syntactic over-approximation that
permits digits anywhere — including as the leading character.
Foi identifiers may start with digits (`1foo`, `5_value`). The
combinator additionally requires that at least one non-digit
character appears in the matched span (so that pure-digit runs
fall through to `Number` rather than shadow it). This is
enforced via frame-local state mutated by `onMatch` callbacks
attached to the character matchers:

```js
var IdentBody = and(
    or(
        terminal(isIdentStart, (c, f) => {
            if (!isDigit(c)) f.state.sawNonDigit = true;
        }),
        and(
            terminal(c => c === C.Tilde, (_, f) => { f.state.sawNonDigit = true; }),
            terminal(isAlpha,             (_, f) => { f.state.sawNonDigit = true; })
        )
    ),
    any(terminal(isIdentCont, (c, f) => {
        if (!isDigit(c)) f.state.sawNonDigit = true;
    })),
    gate(f => f.state.sawNonDigit === true)
);
```

`IdentBody` is itself an anonymous `and(...)`, not a production —
so `f.state` in the callbacks refers to whichever named frame is
innermost at the call site (`General`, `Keyword`, `Native`, etc.).
This is intentional: each typed-identifier production gets its
own fresh `sawNonDigit` state on each open. Without the trailing
`gate()`, pure-digit runs would match `IdentBody` and shadow
`Number`.

The dual to `sawNonDigit` lives on the Number side: every
integer-shaped number production carries a `NotIdentCont`
negative lookahead (§3.2). Together they form the
digit-leading-identifier disambiguation — `sawNonDigit` keeps
pure-digit runs out of identifier-land; `NotIdentCont` keeps
mixed digit-then-letter runs out of number-land.


## 5. Reserved-Set Membership Gates

The five typed-identifier productions each match a broader form
than their semantics permit, then apply a `gate()` over the
matched characters:

```js
export const Native = production("Native",
    and(IdentBody, gate(f => NATIVES.includes(f.matched.join(""))))
);
```

The gate reads `f.matched`, the array of consumed characters
since the frame opened; `f.matched.join("")` materializes the
span as a string for set-membership testing. On gate failure the
production fails and the next Token alternative is tried.

`Keyword` strips the leading `:` for the extension form before
checking; two arms in the outer `or()` cover `:`-prefixed and
bare:

```js
gate(f => KEYWORDS.includes(C.Colon + f.matched.slice(1).join("")))
```

`BooleanOper` similarly skips the leading `?` or `!`:

```js
gate(f => BOOLEAN_NAMED_OPERATORS.includes(f.matched.slice(1).join("")))
```


## 6. The Comment Production: dispatch vs. Ordered Choice

The grammar shows `Comment := BlockComment | LineComment`. The
combinator could implement this as straight ordered choice;
instead it uses `dispatch()` on frame state after committing the
`//` prefix:

```js
export const Comment = production("Comment",
    and(
        ch(C.ForwardSlash),
        ch(C.ForwardSlash, (_, f) => { f.state.kind = "line"; }),
        optional(ch(C.ForwardSlash, (_, f) => { f.state.kind = "block"; })),
        dispatch(f => f.state.kind, {
            line:  any(terminal(c => c !== "\n")),
            block: and(
                any(and(not(lookahead(BlockClose)), terminal(_ => true))),
                or(BlockClose, eof())
            ),
        })
    )
);

var BlockClose = and(ch(C.ForwardSlash), ch(C.ForwardSlash), ch(C.ForwardSlash));
```

Why dispatch instead of `or(BlockComment, LineComment)`: the
`//` prefix is shared; dispatch commits it once and then branches
on whether a third `/` follows, rather than backtracking the `//`
if BlockComment fails. Frame state captures the decision
(`kind: "line"` or `kind: "block"`), which dispatch then uses to
pick the body grammar.

The block body uses
`any(and(not(lookahead(BlockClose)), terminal(_ => true)))` to
consume any char until `BlockClose` would match, then
`or(BlockClose, eof())` to require either the close or
end-of-input. EOF-tolerant block comments are a deliberate
behavior.


## 7. The Four String Forms

All four string forms emit at the same grain: an opening
`DoubleQuote` (preceded by an Escape variant for the three
escape-bearing forms), zero or more content tokens, and a
closing `DoubleQuote`. None of the four are themselves
productions — they are bare `and(...)` expressions.

The content alternatives vary by form:

```js
StringLit:           any(or(StringEscapedCharDQ, PlainStrChars))
InterpStr:           any(or(StringEscapedChar, InterpExpr, InterpStrChars))
SpacingInterpStr:    any(or(StringEscapedChar, InterpExpr, Whitespace, SpacingInterpStrChars))
SpacingEscapedStr:   any(or(StringEscapedCharDQ, Whitespace, SpacingEscapedStrChars))
```

The differences encode each form's syntactic features along two
independent axes:

- **Embeds** (the two interp forms): `InterpExpr` is in the
  alternatives, allowing nested expressions via `` `...` ``. The
  chars predicates exclude `` ` `` so the content matcher yields
  to `InterpExpr` or `StringEscapedChar` at backtick positions.
- **Spacing** (the two spacing forms): `Whitespace` is in the
  alternatives, and the chars predicates exclude whitespace, so
  the content matcher yields to `Whitespace` at whitespace
  positions.

The two non-interp forms (`StringLit`, `SpacingEscapedStr`)
reference the narrow `StringEscapedCharDQ` escape variant; the
two interp forms reference the broad `StringEscapedChar`. See
§8 for the split.

The three escape-bearing forms (`InterpStr`, `SpacingInterpStr`,
`SpacingEscapedStr`) open with one of the named Escape variants —
`EscapeBacktick`, `EscapeSpacingBacktick`, `EscapePlain`
respectively (see §9) — followed by `symb.DoubleQuote`.
`StringLit` opens with just `symb.DoubleQuote`.


## 8. StringEscapedChar — Two Bindings

Two combinator bindings, both emitting the same
`StringEscapedChar` token type, differing only in which
doubled-character escape is reachable:

```js
var StringEscapedCharDQ = production("StringEscapedChar",
    and(ch(C.DoubleQuote), ch(C.DoubleQuote))
);

export const StringEscapedChar = production("StringEscapedChar",
    or(
        and(ch(C.DoubleQuote), ch(C.DoubleQuote)),
        and(ch(C.Backtick), ch(C.Backtick))
    )
);
```

The split tracks which string forms have a syntactic role for
`` ` ``:

- `StringLit` and `SpacingEscapedStr` use `StringEscapedCharDQ`.
  In these forms `` ` `` has no syntactic significance — it's
  literal String content.
- `InterpStr` and `SpacingInterpStr` use the broad
  `StringEscapedChar`. In these forms `` ` `` opens embedded
  expressions, so escaping it via `` `` `` is meaningful.

Both productions emit the same token type, so downstream
consumers see no difference; only the reachability of the
`` `` `` alternative differs per form.

Placement in each content loop is the same: the
StringEscapedChar variant is the first alternative, before any
chars matcher. The chars matcher's predicate excludes `"` (and,
in the interp forms, `` ` ``); if StringEscapedChar were tried
after the chars matcher, the chars matcher would greedily
consume characters before StringEscapedChar could try matching
the doubled-character escape. Trying StringEscapedChar first
ensures the escape is recognized.


## 9. Escape Token Emission

The lexer emits `Escape` tokens via eight named productions,
distinguished by value. Each is a JS binding mapping to
`production("Escape", ...)`:

```
JS binding              value    context
----------------------  -------  -----------------------------------
EscapeBacktick          "`"      opener of InterpStr
EscapePlain             "\"      opener of SpacingEscapedStr;
                                 bare-\ opener of EscapedNumber's
                                 EscapePlain arm;
                                 standalone Escape for a lone "\"
EscapeSpacingBacktick   "\`"     opener of SpacingInterpStr
EscapeHex               "\h"     opener of EscapedNumber's HexNumber arm
EscapeUnicode           "\u"     opener of EscapedNumber's UnicodeNumber arm
EscapeOctal             "\o"     opener of EscapedNumber's OctalNumber arm
EscapeBinary            "\b"     opener of EscapedNumber's BinaryNumber arm
EscapeMonadic           "\@"     opener of EscapedNumber's MonadNumber arm
```

The string-form openers (`EscapeBacktick`,
`EscapeSpacingBacktick`, `EscapePlain` for the three
escape-bearing string forms) are recognized when followed by
`symb.DoubleQuote`. The escaped-number openers each pair with a
specific content production (or General fallback, §3) inside
`EscapedNumber`.

If a candidate opener fails to find any of its valid followups
(neither Number variant nor General), the whole arm fails
atomically and the dispatch falls through; eventually
`EscapePlain` standalone catches the lone `\` after every
more-specific form has been tried (see §14 ordering). The lexer
never emits a multi-char Escape value as a standalone token —
every multi-char Escape commits only as the opener of its
associated specific form.

`EscapePlain` is the only Escape variant spread into
`BaseTokenOr` as a standalone-emission slot. The other seven
fire only from inside their specific contexts.


## 10. The ch() Helper

```js
var ch = (c, onMatch) => terminal(x => x === c, onMatch);
```

A thin wrapper over `terminal()` specialized to single-character
equality, accepting the same optional `onMatch` callback that
`terminal()` does. Used throughout the file for single-char
literal matches.


## 11. The expressionEnding Wrapper

```js
var EXPRESSION_ENDING_OP_NAMES = new Set([
    "CloseParen", "CloseBrace", "Hash", "Pipe",
]);

function expressionEnding(p) {
    return and(
        p,
        optional(and(
            any(or(Whitespace, Comment)),
            lookahead(and(ch(C.Hyphen), terminal(isDigit))),
            production("Hyphen", ch(C.Hyphen))
        ))
    );
}
```

The wrapper returns an anonymous `and(...)`, not a production —
the wrapped production `p` keeps its own frame, and the
wrapper's trailing matches emit at the same depth.

The trailing `optional(...)` contains three pieces in sequence:

1. `any(or(Whitespace, Comment))` — zero or more trivia tokens.
   Each one emits as its own depth-1 token.
2. `lookahead(and(ch(C.Hyphen), terminal(isDigit)))` —
   non-consuming positive lookahead for `-` followed by a digit.
3. `production("Hyphen", ch(C.Hyphen))` — consume the `-` as a
   Hyphen token.

If the lookahead fails (no `-Digit` ahead), the trivia consumed
in step 1 rolls back; those Whitespace/Comment tokens will be
re-matched and emitted by the next outer iteration.

The wrapper is applied at the Token alternation level (see §14
for the full BaseTokenOr listing). The single-char ops are
wrapped selectively via the `EXPRESSION_ENDING_OP_NAMES` set;
the rest are inlined unwrapped. `EscapePlain` is not wrapped —
`\` is not an expression-ending form.

### 11.1 The NumberEnding Wrapper

Companion to `expressionEnding`, applied only to `IntegerLit`
(the hidden union of `PositiveIntegerLit` and
`NegativeIntegerLit`) at the Token level:

```js
function numberEnding(p) {
    return and(p, optional(DoublePeriod));
}
```

Used in `BaseTokenOr`:

```js
numberEnding(expressionEnding(IntegerLit)),
expressionEnding(NumberLit),                       // NOT wrapped with numberEnding
```

The trailing `optional(DoublePeriod)` consumes an
immediately-adjacent `..` token (no trivia between the wrapped
production and the dots), emitting it as a `DoublePeriod` token
at the same depth as the wrapped production.

**Composition order.** `numberEnding(expressionEnding(p))` runs
`expressionEnding`'s `-Digit` lookahead first (innermost), then
`numberEnding`'s `..` check (outermost). Order matters: a `-`
immediately following an integer is the start of the next
expression's signed literal, not a binary op. `-2..-1` must lex
as `NegativeIntegerLit(-2), DoublePeriod, NegativeIntegerLit(-1)`,
not as `NegativeIntegerLit(-2), DoublePeriod, Hyphen,
PositiveIntegerLit(1)`. The inner `expressionEnding` declines
(the next `-` is followed by a digit, but it's at the start of a
range-RHS expression context — `expressionEnding` only consumes
`-Digit` when there's preceding trivia). Then `numberEnding`
consumes the `..`, leaving the `-1` for a fresh
`NegativeIntegerLit` iteration.

**Rationale.** This wrapper forces a third `.` in `5...` to
surface as a separate `Period` token rather than being absorbed
into a `TriplePeriod` by PEG longest-match. The only multi-dot
operator valid immediately after an integer is the range op `..`,
so when the user typos `...`, the lexer reports the syntactic
error at the third `.` rather than silently committing to a
meaningless `TriplePeriod`.

**Scope.** Applies to `IntegerLit` (both `PositiveIntegerLit`
and `NegativeIntegerLit`). `NumberLit` (decimal source-level
numbers) is wrapped with just `expressionEnding`, not
`numberEnding`. Applying `numberEnding` to `NumberLit` would
produce a `DoublePeriod + Period` shape for `12.5...` that
doesn't represent any coherent Foi reading. Leaving it unwrapped
yields `TriplePeriod` (PEG longest-match), which parses
naturally as "decimal + spread" when surrounded by appropriate
syntactic context.


## 12. InterpExpr and the Lazy Forward Reference

```js
var BaseTokenOr;   // forward declaration; assigned after Tokens is built

var InterpExprStop = lookahead(ch(C.Backtick));

var InterpExpr = and(
    symb.Backtick,
    any(and(not(InterpExprStop), lazy(() => BaseTokenOr))),
    symb.Backtick
);
```

`BaseTokenOr` is the top-level `or(...)` of all Token
alternatives. `InterpExpr` lives inside `InterpStr` content
alternatives, which are inside `BaseTokenOr`. Direct reference
would be a circular dependency at file-evaluation time;
`lazy()` defers the lookup until parse time. `BaseTokenOr` is
assigned at the bottom of the productions block, just before
`Tokens` is defined.

**The InterpExprStop simplification.** A positive lookahead on a
bare backtick. Any backtick inside the InterpExpr body closes
the embed. The body loop exits at that position, and the
trailing `symb.Backtick` in `InterpExpr` consumes the closing
backtick as a `Backtick` token.

This means `LexInterpStr` (the plain interp form) cannot be
nested inside an InterpExpr body — its opener begins with a bare
backtick, which the InterpExprStop lookahead treats as the
embed-close. Plain-in-plain nesting creates a genuine grammar
ambiguity that Foi forbids by design; the simplification matches
the language semantics.

Cross-form nesting (spacing-in-plain, spacing-in-spacing) still
works: the nested spacing form opens with `\` followed by
`` ` `` followed by `"`. The first char (`\`) doesn't trigger
InterpExprStop, so the body loop continues, the lazy reference
matches the nested SpacingInterpStr, and tokens emit correctly.

The two `symb.Backtick` references in `InterpExpr` emit
`Backtick` tokens for the opening and closing backticks of the
embedded expression — the same `symb.Backtick` production that
fires standalone in `BaseTokenOr`.


## 13. Single-Char Operators as a Dynamic Map

The `C` table is the single source of truth for char values:

```js
var C = {
    Tilde: "~",        Exmark: "!",        Hash: "#",        Dollar: "$",
    Percent: "%",      Caret: "^",         Ampersand: "&",   Star: "*",
    Plus: "+",         Equal: "=",         At: "@",          Hyphen: "-",
    OpenBracket: "[",  CloseBracket: "]",  Pipe: "|",        Qmark: "?",
    Semicolon: ";",    SingleQuote: "'",   OpenAngle: "<",   CloseAngle: ">",
    Comma: ",",        Period: ".",        Colon: ":",       ForwardSlash: "/",
    Escape: "\\",      OpenParen: "(",     CloseParen: ")",  OpenBrace: "{",
    CloseBrace: "}",   Backtick: "`",      DoubleQuote: '"',
};
```

Productions are generated from `C` with two exclusion
mechanisms:

```js
var STANDALONE_EXCLUDED_OPS    = new Set([ "DoubleQuote" ]);
var SYMB_NAMES_EXCLUDED_FROM_C = new Set([ "Escape" ]);

export const symb = {};
for (let [name, c] of Object.entries(C)) {
    if (!SYMB_NAMES_EXCLUDED_FROM_C.has(name)) {
        symb[name] = production(name, ch(c));
    }
}
```

The two exclusion sets serve different purposes:

- **`STANDALONE_EXCLUDED_OPS`** — name is in `symb` (so it's
  defined for inline reuse, e.g. `symb.DoubleQuote` inside the
  string forms) but is NOT spread into `BaseTokenOr`. A lone
  occurrence of the character should fail to tokenize rather
  than emit a standalone token. Currently just `DoubleQuote`.

- **`SYMB_NAMES_EXCLUDED_FROM_C`** — name is in `C` (for char
  lookup via `C.Escape`, e.g. inside multi-char Escape
  productions) but no `symb.Name` production is generated. A
  different binding takes over the standalone role. Currently
  just `Escape`, whose standalone slot is filled by `EscapePlain`
  (defined separately as one of the eight named Escape variants;
  see §9). `EscapePlain` is spread into `BaseTokenOr` explicitly,
  just before the `symb` spread.

In `BaseTokenOr`, the symbols are spread at the tail with
selective wrapping:

```js
...Object.entries(symb)
    .filter(([name]) => !STANDALONE_EXCLUDED_OPS.has(name))
    .map(([name, prod]) =>
        EXPRESSION_ENDING_OP_NAMES.has(name) ? expressionEnding(prod) : prod
    )
```

Adding a new single-char op is normally a one-line change to
`C`. Adding one that should be inline-only (not spread into
BaseTokenOr) also adds an entry to `STANDALONE_EXCLUDED_OPS`.
Adding one whose standalone slot is filled by a
separately-defined binding adds an entry to
`SYMB_NAMES_EXCLUDED_FROM_C` and an explicit `BaseTokenOr` entry
for the replacement.


## 14. Production Ordering in BaseTokenOr

The order in `BaseTokenOr`'s `or(...)` is load-bearing — PEG
ordered choice means the first match wins, and several
productions have overlapping prefixes. The exact order, top to
bottom:

```
Whitespace
Comment                              (* before single-char ForwardSlash *)
InterpStr                            (* before single-char Backtick *)
SpacingInterpStr                     (* before EscapePlain *)
SpacingEscapedStr                    (* before EscapedNumber and EscapePlain *)
StringLit                            (* anonymous and(...) — see §7 *)
EscapedNumber                        (* before EscapePlain *)
expressionEnding(Keyword)            (* before General *)
expressionEnding(Native)
expressionEnding(Builtin)
expressionEnding(Comprehension)
expressionEnding(BooleanOper)
numberEnding(expressionEnding(IntegerLit))  (* before NumberLit *)
expressionEnding(NumberLit)
expressionEnding(General)
TriplePeriod                         (* before DoublePeriod before single Period *)
DoublePeriod
DoubleColon                          (* before single Colon *)
EscapePlain                          (* standalone "\" — after all multi-char Escape forms *)
...(symb spread with STANDALONE_EXCLUDED_OPS filter, EXPRESSION_ENDING_OP_NAMES wrap)
```

Why each non-obvious ordering matters:

- `Comment` before `ForwardSlash`: a leading `/` could be
  either. Trying Comment first commits to comment if a second
  `/` follows; otherwise Comment fails and the spread's
  `ForwardSlash` catches the standalone `/`.
- `InterpStr` / `SpacingInterpStr` / `SpacingEscapedStr` before
  `StringLit`: `` `" ``, `\"`, and `` \` `` `"` start
  escape-bearing forms. `StringLit` only handles bare `"..."`.
- `SpacingInterpStr` / `SpacingEscapedStr` / `EscapedNumber`
  before `EscapePlain`: a `\` followed by `` ` `` (then `"`),
  or `"`, or one of `h`/`o`/`b`/`u`/`@`/digit, should open the
  more-specific form rather than emit a standalone `EscapePlain`
  followed by un-escape-aware tokens.
- The five typed identifiers before `General`: each typed form
  is a semantic specialization of General; trying them first
  lets the gate select the right type. General is the catch-all.
- `IntegerLit` (`PositiveIntegerLit` / `NegativeIntegerLit`)
  before `NumberLit`: a digit run with no decimal point that's
  also not extending into an identifier is an integer literal —
  positive if no leading sign, negative if `-` adjacent. The
  `!("." Digit)` lookahead inside both productions causes
  fallthrough to `NumberLit` for decimals (`5.5`, `-5.5`); the
  `!IdentCont` guard (§3.2) causes fallthrough for digit-leading
  identifiers (`1foo`, `-1foo`). See §3.1 for the
  round-trippability rationale.
- `IntegerLit` wrapped with
  `numberEnding(expressionEnding(IntegerLit))` (§11.1):
  immediate `..` after an integer gets consumed as a
  `DoublePeriod` token, so `5...` and `-5...` split into
  `Number(5/-5)`, `DoublePeriod`, `Period` rather than
  collapsing the trailing `...` into a `TriplePeriod`. The
  wrapper order is significant — `expressionEnding` runs inside
  `numberEnding` so the `-Digit` lookahead fires before any
  trailing `..` is consumed, ensuring `-2..-1` lexes as two
  `NegativeIntegerLit` tokens around a `DoublePeriod` rather
  than consuming the second `-` as a binary `Hyphen`.
  `NumberLit` is NOT wrapped with `numberEnding` — see §11.1 for
  rationale.
- `TriplePeriod` before `DoublePeriod` before single `Period`
  (via the symb spread): longest match first.
- `DoubleColon` before single `Colon` (via the symb spread):
  same.


## 15. Parse Configuration

The lexer creates its parse handle with `preserveTerminals: true`:

```js
var handle = parse(Tokens, input, { preserveTerminals: true });
```

This causes every `terminal()` match to push the consumed
character into `frame.matched` of the innermost named frame. The
gates in typed-identifier productions (§4, §5) and the
`sawNonDigit` accumulator (§4) all read from `f.matched`, so this
config is mandatory.

Memoization is off; the lex grammar is shallow and ordered choice
rarely backtracks far enough to make it worthwhile. (The
syntactic layer uses memoization; the lex layer does not.)


## 16. Public API

```js
export async function *tokenize(input) {
    var handle = parse(Tokens, input, { preserveTerminals: true });
    var events = handle.subscribe(presets.parseTokens);
    var runPromise = handle.run();
    for await (let ev of events) {
        if (ev.kind === "commit") {
            yield {
                type:  ev.node.production,
                value: ev.node.matched.join(""),
                start: ev.node.startPos,
                end:   ev.node.endPos - 1,
            };
        }
    }
    await runPromise;
}
```

`tokenize(input)` is an async generator yielding token objects
`{ type, value, start, end }` as they are recognized. The
`runPromise` is awaited after the event loop drains, so any
parse-level error (unrecognized input at the final position)
surfaces from the generator.
