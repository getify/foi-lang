# Foi Lexer — Implementation Notes

Companion document to the Foi Lexical Grammar (EBNF). The grammar
specifies *what* the lexer matches; this document specifies *how* the
combinator-form lexer in `foi-lex.js` implements it, with enough
detail to reproduce the implementation choices, tree shape, and event
stream byte-for-byte.

Assumes familiarity with the parser combinator library in
`parser.js` (constructs: `production`, `terminal`, `and`, `or`,
`optional`, `any`, `many`, `not`, `lookahead`, `gate`, `dispatch`,
`eof`, `until`, `sepBy`, `sepBy1`, `delim`, `delimWSReq`).


## 1. Architectural Posture

The lexer is a streaming PEG parser over character input. Tokens are
emitted as `commit` events on depth-1 frames; the top-level `Tokens`
production is the only depth-0 frame. Subscribers using
`presets.parseTokens` receive `matched`/`rollback`/`commit` events
for each token as it is recognized.

**Token grain.** Each named production whose name matches a tokenizer
type string (e.g., `"Whitespace"`, `"Comment"`, `"Number"`, the
single-char operator names) corresponds to exactly one emitted
token. The `production()` wrapper is what turns a grammar fragment
into a frame; anonymous `and(...)` / `or(...)` wrappers do not emit
their own frames, so their inner productions appear at the same
depth as their parent would.

**No cross-token state.** The lexer maintains no mutable state that
persists across token boundaries. The hyphen-as-sign disambiguation
is handled per-token via the `expressionEnding` wrapper rather than
via a global flag.

**Async streaming input.** The lexer accepts an async or sync
iterable of characters. Buffering is unbounded for v1 (no GC of
consumed prefix); fine for source-file-sized inputs.


## 2. Library Construct Choices

For each EBNF construct, the corresponding combinator construct:

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
| literal `"x"` | `ch("x")` (helper for `terminal(c => c === "x")`) |
| EOF | `eof()` |
| named non-terminal | `production("NAME", body)` |
| anonymous group | bare `and(...)` / `or(...)` |

The `ch(c, onMatch?)` helper in `foi-lex.js` wraps `terminal()` with
a single-character equality check and accepts an optional `onMatch`
callback. The two-argument form is critical and easy to break; see
§10.


## 3. What Becomes a Production

A grammar rule becomes a `production("NAME", ...)` if and only if its
name appears in the emitted token stream. Token types in the lexer's
output:

```
Whitespace, Comment, Number, PositiveIntegerLit, General,
Keyword, Native, Builtin, Comprehension, BooleanOper,
String, StringEscapedChar, DoubleQuote,
Backtick, Escape, Hyphen,
TriplePeriod, DoublePeriod, DoubleColon,
<all single-char operator names: Tilde, Exmark, ..., Backtick>
```

Each emitted type corresponds to one or more `production("Name", ...)`
call sites in the impl. Helper rules in the grammar (`IdentBody`,
`DigitsWithSep`, `HexDigitsWithSep`, `NumberBody`, the various
`*Content` rules inside strings, the various `*Body` digit helpers
inlined into Number variants) are NOT productions — they are `var`
bindings to anonymous `and(...)` / `or(...)` fragments that are
reused by name within the file but do not create frames.

The EBNF grammar marks this distinction explicitly: hidden rules
carry angle brackets on the LHS (`<Name> := ...`) and emit no node —
their content splices into the parent. Unbracketed names emit a node.
The mapping is mechanical: angle-bracketed ⟺ bare `and(...)` /
`or(...)` here; unbracketed ⟺ `production(NAME, ...)`.

**Alias families.** A number of unbracketed names are aliases for
productions whose emitted token type differs from the EBNF name:

- **Eight Escape variants** — `EscapeBacktick`, `EscapePlain`,
  `EscapeSpacingBacktick`, `EscapeHex`, `EscapeUnicode`, `EscapeOctal`,
  `EscapeBinary`, `EscapeMonadic` — all emit `Escape` tokens
  distinguished by value. See §9.
- **Six Number variants** — `HexNumber`, `UnicodeNumber`, `OctalNumber`,
  `BinaryNumber`, `MonadNumber`, `BareNumber` — all emit `Number`
  tokens, each paired with its corresponding Escape variant inside
  `EscapedNumber`. The standalone source-level decimal Number production
  (JS binding `NumberLit`, EBNF name `Number`) also emits `Number`.
- **Two PositiveIntegerLit variants** — `PositiveIntegerLit` (bare
  top-level, no underscore separators) and `PositiveIntegerLitWithSep`
  (paired with `EscapePlain` inside `EscapedNumber`, separators allowed)
  — both emit `PositiveIntegerLit` tokens. See §3.1.
- **Four String content emitters** — `PlainStrChars`, `InterpStrChars`,
  `SpacingInterpStrChars`, `SpacingEscapedStrChars` — all emit `String`
  tokens, distinguished by which characters their content predicate
  accepts. Each fires from inside exactly one string form.

These exist because the grammar reads more clearly when the role of
an emitter is named at its use site; the impl collapses each family
to its shared emitted token type. Inline EBNF comments flag each
alias.

**String forms as bare `and(...)`.** All four string-form rules
(`StringLit`, `InterpStr`, `SpacingInterpStr`, `SpacingEscapedStr`)
are bare `and(...)` expressions, not productions. The token stream
for each contains the individual `DoubleQuote` (or `Escape` +
`DoubleQuote` for the three escape-bearing forms), content tokens
(`String`, `StringEscapedChar`, `Whitespace`, `Backtick`, etc.), and
closing `DoubleQuote` as separate depth-1 emissions. Wrapping any of
them as a production would add an extra frame layer that no consumer
wants.

**`EscapedNumber` as bare `or(...)`.** `EscapedNumber` is a bare
`or(...)` of seven (Escape variant, Number-or-PositiveIntegerLit
variant) pairs: `and(EscapeHex, HexNumber)`,
`and(EscapeUnicode, UnicodeNumber)`, `and(EscapeOctal, OctalNumber)`,
`and(EscapeBinary, BinaryNumber)`, `and(EscapeMonadic, MonadNumber)`,
`and(EscapePlain, PositiveIntegerLitWithSep)`,
`and(EscapePlain, BareNumber)`. Each emits two tokens — an `Escape`
carrying the opener value (e.g. `"\h"`) and a `Number` or
`PositiveIntegerLit` carrying the digit content. Because both sides
of each pair are named productions and the dispatch itself is hidden,
the syntactic grammar can reference `EscapedNumber` and get exactly
the (Escape, content) child pair spliced into the parent.

Note the two `EscapePlain` arms: the first (paired with
`PositiveIntegerLitWithSep`) is PEG-tried before the second (paired
with `BareNumber`), so `\5_000` lexes as
`Escape("\") + PositiveIntegerLit("5_000")` rather than
`Escape("\") + Number("5_000")`. The `!("." Digit)` lookahead inside
`PositiveIntegerLitWithSep` forces fallthrough to `BareNumber` when
the digits are followed by a decimal point.

### 3.1 The PositiveIntegerLit token type

This is a deliberate divergence from the legacy hand-written
tokenizer, which classifies all positive-integer-shaped digit runs
as `Number` tokens. The motivation is round-trippability of the
syntactic grammar.

The syntactic grammar restricts a few positions to positive integer
literals only — property indexes (`<.foo, 5>`), DotIdentifier
indices (`arr.5`), etc. The shape constraint is "digit run, no
leading `-`, no fractional part." Three options were considered for
how to express this:

1. **Inline char-level shape in the syn EBNF.** Verbose; the syn
   grammar reaches into char-level fragments where it should be
   operating on tokens. Rejected.
2. **Hidden lex helper named `<PositiveIntLit>` referenced from
   syn under concat, with the syn impl applying a value-shape
   regex predicate to a Number token.** Round-trippable as EBNF
   but the syn impl needs an out-of-band "gate on token value"
   step that isn't expressible as pure combinator composition.
   Rejected.
3. **Emit `PositiveIntegerLit` as its own token type at the lex
   layer.** The shape restriction is encoded by the token type
   directly; the syn grammar references the type with no gate.
   Adopted.

Cost: the legacy-tokenizer diff harness sees `PositiveIntegerLit`
where the legacy side emits `Number`. The harness normalizes
`PositiveIntegerLit` → `Number` on the new side (see §16) so the
divergence is documented and the rest of the stream still validates
against the ground truth.

Benefit: the syntactic EBNF in `Syntactic-Grammar.md` has no
value-shape gates anywhere. Every visible production maps to a
combinator form by direct textual translation. The `PositiveIntegerLit`
token type is load-bearing for the project goal of mechanical
round-trippability of the syntactic grammar.

The implementation uses two productions emitting the same token
type (alias pattern):

```js
var NotDotDigit = not(lookahead(and(ch(C.Period), terminal(isDigit))));

export const PositiveIntegerLit = production("PositiveIntegerLit",
    and(many(terminal(isDigit)), NotDotDigit)
);

export const PositiveIntegerLitWithSep = production("PositiveIntegerLit",
    and(DigitsWithSep, NotDotDigit)
);
```

`PositiveIntegerLit` is the bare top-level form (no separators);
`PositiveIntegerLitWithSep` is the escaped form reachable only via
`EscapedNumber` paired with `EscapePlain`. The shared `NotDotDigit`
helper enforces the `!("." Digit)` lookahead so a decimal point
followed by digits doesn't get split into a positive int + a
fractional `Number` — the dispatch falls through to `NumberLit`
(bare) or to the `BareNumber` arm of `EscapedNumber` (escaped).


## 4. The IdentBody sawNonDigit Gate

The grammar's IdentBody is a syntactic over-approximation. The
combinator enforces "at least one non-digit character was seen" via
frame-local state mutated by `onMatch` callbacks:

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

Critical implementation choices:

- The `onMatch` callback fires after the character is consumed and
  receives the innermost named frame `f`. Mutating `f.state.X` is
  how frame-local state is built up during matching.
- The trailing `gate(f => f.state.sawNonDigit === true)` is the
  validation point. Without it, pure-digit runs would match
  IdentBody and shadow Number.
- `IdentBody` is itself an anonymous `and(...)`, not a production —
  so `f` in the callbacks refers to whichever named frame is
  innermost at the call site (General, Keyword, Native, etc.). This
  is intentional: each typed-identifier production gets its own
  fresh `sawNonDigit` state on each open.

`onMatch` callbacks are the general mechanism for any frame-state
accumulation during character consumption. The `ch(c, onMatch)`
helper exists specifically to make this ergonomic for single-char
matches.


## 5. Reserved-Set Membership Gates

The five typed-identifier productions each match a broader form than
their semantics permit, then apply a `gate()` over the matched
characters:

```js
export const Native = production("Native",
    and(IdentBody, gate(f => NATIVES.includes(f.matched.join(""))))
);
```

Implementation choices:

- The gate reads `f.matched`, which is the array of consumed
  characters since the frame opened. This is populated by
  `terminal()` automatically when `config.preserveTerminals` is on
  (which it is for the lexer).
- `f.matched.join("")` materializes the matched span as a string for
  set-membership testing. Cheap because token-length strings are
  short.
- On gate failure, the entire production fails — the frame is
  rolled back, the consumed characters are restored to the buffer
  position, and the next Token alternative is tried.
- `Keyword` has a slight variation: the gate strips the leading
  `:` for the extension form before checking:

  ```js
  gate(f => KEYWORDS.includes(C.Colon + f.matched.slice(1).join("")))
  ```

  Two arms in the outer `or()`: one for `:`-prefixed, one bare.
- `BooleanOper` similarly skips the leading `?` or `!`:

  ```js
  gate(f => BOOLEAN_NAMED_OPERATORS.includes(f.matched.slice(1).join("")))
  ```


## 6. The Comment Production: dispatch vs. Ordered Choice

The grammar shows `Comment := BlockComment | LineComment`. The
combinator could implement this as straight ordered choice; instead
it uses `dispatch()` on frame state after committing the `//` prefix:

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

Why dispatch instead of `or(BlockComment, LineComment)`:

- The `//` prefix is shared. Dispatch lets us commit it once and
  then branch on whether a third `/` follows, rather than
  backtracking the `//` if BlockComment fails.
- Frame state captures the decision (`kind: "line"` or
  `kind: "block"`), which is then used by `dispatch()` to pick the
  body grammar.
- The block body uses `any(and(not(lookahead(BlockClose)), terminal(_ => true)))`
  to consume any char until `BlockClose` would match, then
  `or(BlockClose, eof())` to require either the close or end-of-input.
  EOF-tolerant block comments are a deliberate behavior.

This is the canonical example of `dispatch()` usage in the lexer.


## 7. The Four String Forms

All four string forms emit at the same grain: an opening `DoubleQuote`
(preceded by an Escape variant for the three escape-bearing forms),
zero or more content tokens, and a closing `DoubleQuote`. None of the
four are themselves productions — they are bare `and(...)` expressions.

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
  chars predicates exclude `` ` `` so the content matcher yields to
  `InterpExpr` or `StringEscapedChar` at backtick positions.
- **Spacing** (the two spacing forms): `Whitespace` is in the
  alternatives, and the chars predicates exclude whitespace, so the
  content matcher yields to `Whitespace` at whitespace positions.

The two non-interp forms (`StringLit`, `SpacingEscapedStr`) reference
the narrow `StringEscapedCharDQ` escape variant; the two interp forms
reference the broad `StringEscapedChar`. See §8 for the split.

The three escape-bearing forms (`InterpStr`, `SpacingInterpStr`,
`SpacingEscapedStr`) open with one of the named Escape variants —
`EscapeBacktick`, `EscapeSpacingBacktick`, `EscapePlain` respectively
(see §9) — followed by `symb.DoubleQuote`. `StringLit` opens with
just `symb.DoubleQuote`.


## 8. StringEscapedChar — Two Combinator Bindings

Two combinator bindings, both emitting the same `StringEscapedChar`
token type, differing only in which doubled-character escape is
reachable:

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

The split tracks which string forms have a syntactic role for `` ` ``:

- `StringLit` and `SpacingEscapedStr` use `StringEscapedCharDQ`. In
  these forms `` ` `` has no syntactic significance — it's literal
  String content.
- `InterpStr` and `SpacingInterpStr` use the broad `StringEscapedChar`.
  In these forms `` ` `` opens embedded expressions, so escaping it
  via `` `` `` is meaningful.

Both productions emit the same token type, so downstream consumers
see no difference; only the reachability of the `` `` `` alternative
differs per form.

Placement in each content loop is the same: the StringEscapedChar
variant is the first alternative, before any chars matcher. The
chars matcher's predicate excludes `"` (and, in the interp forms,
`` ` ``); if StringEscapedChar were tried after the chars matcher,
the chars matcher would greedily consume characters before
StringEscapedChar could try matching the doubled-character escape.
Trying StringEscapedChar first ensures the escape is recognized.


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
                                 PositiveIntegerLitWithSep and
                                 BareNumber arms;
                                 standalone Escape for a lone "\"
EscapeSpacingBacktick   "\`"     opener of SpacingInterpStr
EscapeHex               "\h"     opener of EscapedNumber's HexNumber arm
EscapeUnicode           "\u"     opener of EscapedNumber's UnicodeNumber arm
EscapeOctal             "\o"     opener of EscapedNumber's OctalNumber arm
EscapeBinary            "\b"     opener of EscapedNumber's BinaryNumber arm
EscapeMonadic           "\@"     opener of EscapedNumber's MonadNumber arm
```

The string-form openers (`EscapeBacktick`, `EscapeSpacingBacktick`,
`EscapePlain` for the three escape-bearing string forms) are
recognized when followed by `symb.DoubleQuote`. The escaped-number
openers each pair with a specific content production inside
`EscapedNumber`; the content production requires digit content in
the appropriate class (HexDigit after `\h`/`\u`, OctDigit after
`\o`, etc.).

If a candidate opener fails to find its expected followup, the whole
pair fails atomically and the dispatch falls through; eventually
`EscapePlain` standalone catches the lone `\` after every more-
specific form has been tried (see §14 ordering). The lexer never
emits a multi-char Escape value as a standalone token — every
multi-char Escape commits only as the opener of its associated
specific form.

`EscapePlain` is the only Escape variant spread into `BaseTokenOr`
as a standalone-emission slot. The other seven fire only from inside
their specific contexts.


## 10. The ch() Helper and the Two-Argument Form

```js
var ch = (c, onMatch) => terminal(x => x === c, onMatch);
```

Critical: the helper MUST forward both arguments. An earlier version
defined it as `c => terminal(x => x === c)` (one arg). JS silently
drops extra arguments to arrow functions, so callers passing
`ch(C.ForwardSlash, onMatch)` saw the `onMatch` silently discarded.
The frame state intended to be set by the callback was never set,
downstream gates and dispatches saw `undefined`, and productions
rolled back for invisible reasons.

The lesson: any helper that wraps a callback-accepting primitive
must forward callbacks explicitly. Adding parameters to such helpers
silently is one of the few places this lexer can break in ways that
grammar-tracing alone won't catch. Always dump actual combinator
output (via `presets.parseTrace`) when debugging.


## 11. The ExpressionEnding Wrapper

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

Implementation specifics:

- `expressionEnding(p)` returns an anonymous `and(...)`, not a
  production. The wrapper's structure doesn't get a frame of its
  own — the wrapped production `p` keeps its own frame, and the
  wrapper's trailing matches emit at the same depth.
- The trailing `optional(...)` contains three pieces in sequence:
  1. `any(or(Whitespace, Comment))` — zero or more trivia tokens.
     These ARE productions; each one emits as its own depth-1 token.
  2. `lookahead(and(ch(C.Hyphen), terminal(isDigit)))` — non-consuming
     positive lookahead for `-` followed by a digit.
  3. `production("Hyphen", ch(C.Hyphen))` — consume the `-` as a
     Hyphen token.
- The `optional()` wrapper provides the speculative-rollback
  semantics. If the lookahead fails (no `-Digit` ahead), the
  trivia consumed in step 1 is rolled back via the savepoint
  mechanism in the parser library. Those Whitespace/Comment tokens
  were emitted as `matched` events but receive `rollback` events
  when the savepoint restores. They will be re-matched (and this
  time committed) by the next outer iteration.
- The wrapper is applied at the Token alternation level:

```js
BaseTokenOr = or(
    Whitespace,
    Comment,
    InterpStr,
    SpacingInterpStr,
    SpacingEscapedStr,
    StringLit,
    EscapedNumber,
    expressionEnding(Keyword),
    expressionEnding(Native),
    expressionEnding(Builtin),
    expressionEnding(Comprehension),
    expressionEnding(BooleanOper),
    expressionEnding(PositiveIntegerLit),
    expressionEnding(NumberLit),
    expressionEnding(General),
    TriplePeriod,
    DoublePeriod,
    DoubleColon,
    EscapePlain,
    ...Object.entries(symb)
        .filter(([name]) => !STANDALONE_EXCLUDED_OPS.has(name))
        .map(([name, prod]) =>
            EXPRESSION_ENDING_OP_NAMES.has(name) ? expressionEnding(prod) : prod
        )
);
```

The single-char ops are wrapped selectively via the
`EXPRESSION_ENDING_OP_NAMES` set; the rest are inlined unwrapped.
`EscapePlain` is not wrapped — `\` is not an expression-ending
form. See §13 for the `STANDALONE_EXCLUDED_OPS` exclusion mechanism.

**Subscriber-visible side effect.** A subscriber filtering for
`matched` events will see Whitespace/Comment events that are later
rolled back when the speculative tail fails. Consumers using
`presets.parseTokens` (which includes `commit` events but treats
`matched` as provisional) handle this correctly. Consumers that only
listen to `matched` and ignore `rollback` will see spurious
trivia events.


## 12. InterpExpr and the Lazy Forward Reference

```js
var BaseTokenOr;   // forward declaration; assigned after Tokens is built

var BaseTokenLazy = async function baseTokenLazy(pctx) {
    return BaseTokenOr(pctx);
};

var InterpExprStop = and(ch(C.Backtick), or(eof(), not(ch(C.DoubleQuote))));

var InterpExpr = and(
    symb.Backtick,
    any(and(not(InterpExprStop), BaseTokenLazy)),
    symb.Backtick
);
```

The recursion shape:

- `BaseTokenOr` is the top-level `or(...)` of all Token alternatives.
- `InterpExpr` lives inside `InterpStr` content alternatives, which
  are inside `BaseTokenOr`. Direct reference would be a circular
  dependency at file-evaluation time.
- The workaround: `BaseTokenOr` is `var`-declared early (hoisted)
  but not assigned. `BaseTokenLazy` is an async function that
  dereferences `BaseTokenOr` at parse time, by which point it has
  been assigned. `InterpExpr`'s body references `BaseTokenLazy`,
  not `BaseTokenOr` directly.
- `BaseTokenOr` is assigned at the bottom of the productions block,
  just before `Tokens` is defined.

`InterpExprStop` is the closing-backtick detector: a backtick NOT
followed by `"`. The `or(eof(), not(ch(C.DoubleQuote)))` form handles
both "backtick at end of input" and "backtick followed by something
other than quote." If the next char is `"`, we're entering a nested
interp string, not closing the expression; the loop continues.

The two `symb.Backtick` references emit `Backtick` tokens for the
opening and closing backticks of the embedded expression. Note that
this is the same `symb.Backtick` production that fires standalone in
`BaseTokenOr` — InterpExpr just reuses the binding.


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

Productions are generated from `C` with two exclusion mechanisms:

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

- **`STANDALONE_EXCLUDED_OPS`** — name is in `symb` (so it's defined
  for inline reuse, e.g. `symb.DoubleQuote` inside the string forms)
  but is NOT spread into `BaseTokenOr`. A lone occurrence of the
  character should fail to tokenize rather than emit a standalone
  token. Currently just `DoubleQuote`.

- **`SYMB_NAMES_EXCLUDED_FROM_C`** — name is in `C` (for char lookup
  via `C.Escape`, e.g. inside multi-char Escape productions) but no
  `symb.Name` production is generated. A different binding takes
  over the standalone role. Currently just `Escape`, which is
  superseded by `EscapePlain` (defined separately as one of the
  eight named Escape variants; see §9). `EscapePlain` is spread into
  `BaseTokenOr` explicitly, just before the `symb` spread, to fill
  the standalone-`\` slot.

The `symb` object is exported and referenced by name (`symb.Hyphen`,
`symb.OpenParen`, etc.) where needed inside the file.

In `BaseTokenOr`, the symbols are spread at the tail with selective
wrapping:

```js
...Object.entries(symb)
    .filter(([name]) => !STANDALONE_EXCLUDED_OPS.has(name))
    .map(([name, prod]) =>
        EXPRESSION_ENDING_OP_NAMES.has(name) ? expressionEnding(prod) : prod
    )
```

Adding a new single-char op is normally a one-line change to `C`.
Adding one that should be inline-only (not spread into BaseTokenOr)
also adds an entry to `STANDALONE_EXCLUDED_OPS`. Adding one whose
standalone slot is filled by a separately-defined binding adds an
entry to `SYMB_NAMES_EXCLUDED_FROM_C` and an explicit `BaseTokenOr`
entry for the replacement.


## 14. Production Ordering in BaseTokenOr

The order in `BaseTokenOr`'s `or(...)` is load-bearing — PEG ordered
choice means the first match wins, and several productions have
overlapping prefixes. The exact order, top to bottom:

```
Whitespace
Comment                              (* before single-char ForwardSlash *)
InterpStr                            (* before single-char Backtick *)
SpacingInterpStr                     (* before EscapePlain *)
SpacingEscapedStr                    (* before EscapedNumber and EscapePlain *)
StringLit                            (* anonymous and(...) — see §7 *)
EscapedNumber                        (* before EscapePlain *)
expressionEnding(Keyword)            (* before General via Note 1 in grammar *)
expressionEnding(Native)
expressionEnding(Builtin)
expressionEnding(Comprehension)
expressionEnding(BooleanOper)
expressionEnding(PositiveIntegerLit) (* before NumberLit — see below *)
expressionEnding(NumberLit)
expressionEnding(General)
TriplePeriod                         (* before DoublePeriod before single Period *)
DoublePeriod
DoubleColon                          (* before single Colon *)
EscapePlain                          (* standalone "\" — after all multi-char Escape forms *)
...(symb spread with STANDALONE_EXCLUDED_OPS filter, EXPRESSION_ENDING_OP_NAMES wrap)
```

Why each non-obvious ordering matters:

- `Comment` before `ForwardSlash`: a leading `/` could be either.
  Trying Comment first commits to comment if a second `/` follows;
  otherwise Comment fails and the spread's `ForwardSlash` catches
  the standalone `/`.
- `InterpStr` / `SpacingInterpStr` / `SpacingEscapedStr` before
  `StringLit`: `` `" ``, `\"`, and `` \` `` `"` start escape-bearing
  forms. `StringLit` only handles bare `"..."`.
- `SpacingInterpStr` / `SpacingEscapedStr` / `EscapedNumber` before
  `EscapePlain`: a `\` followed by `` ` `` (then `"`), or `"`, or
  one of `h`/`o`/`b`/`u`/`@`/digit, should open the more-specific
  form rather than emit a standalone `EscapePlain` followed by
  un-escape-aware tokens.
- The five typed identifiers before `General`: each typed form is a
  semantic specialization of General; trying them first lets the
  gate select the right type. General is the catch-all.
- `PositiveIntegerLit` before `NumberLit`: a digit run with no
  decimal point and no leading sign is a positive integer literal;
  the legacy tokenizer would emit this as `Number`, but the new
  lexer emits the more specific `PositiveIntegerLit` type. The
  `!("." Digit)` lookahead inside `PositiveIntegerLit` causes
  fallthrough to `NumberLit` for decimals (`5.5`) and the
  expression-ending tail handles signed forms (`-5`) via NumberLit's
  own leading-sign rule. See §3.1 for the round-trippability
  rationale driving this divergence.
- `TriplePeriod` before `DoublePeriod` before single `Period` (via
  the symb spread): longest match first.
- `DoubleColon` before single `Colon` (via the symb spread): same.


## 15. Configuration: preserveTerminals and preserveDelim

The lexer creates its parse handle with `preserveTerminals: true`:

```js
var handle = parse(Tokens, input, { preserveTerminals: true });
```

This causes every `terminal()` match to push the consumed character
into `frame.matched` of the innermost named frame. The gates in
typed-identifier productions read this to validate reserved-set
membership.

`preserveDelim` is NOT set (defaults to false). This means
`delim()` and `delimWSReq()` consume tokens without recording them
in `matched`. The lexer doesn't currently use these helpers (they're
for the syntactic layer that consumes tokens, not chars); but the
configuration would matter if a future implementation choice
introduced them.


## 16. The Diff Harness

The diff harness (in `test.js`) compares the new tokenizer's output
against the legacy hand-written tokenizer (`orig-tokenizer.js`). It
is not part of the tokenizer proper but is the test-of-record for
grain parity.

Components:

- `tokenize(input)`: from `tokenizer.js`. Async generator yielding
  committed tokens with PascalCase `type` strings.
- `origTokenize(input)`: from `orig-tokenizer.js`. Async generator
  yielding tokens with UPPERCASE_SNAKE `type` strings.
- `normalizeOrigStream(legacyStream)`: adapter that renames
  `token.type` from UPPERCASE_SNAKE to PascalCase via a mechanical
  pass (`OPEN_PAREN` → `OpenParen`, etc.); leaves `value` / `start`
  / `end` untouched.
- `normalizeNewStream(newStream)`: adapter that folds
  `PositiveIntegerLit` → `Number` on the new side. The legacy
  tokenizer has no `PositiveIntegerLit` type — it classifies all
  positive-integer-shaped digit runs as `Number`. The new lexer
  emits `PositiveIntegerLit` deliberately (see §3.1); the harness
  normalizes so the divergence is documented at one site and the
  rest of the token stream still validates against ground truth.
- `diffStream(input)`: async generator walking the normalized legacy
  stream and the normalized new tokenizer stream in lockstep,
  yielding `{kind: "match", index, ...}` or `{kind: "diff", ...}`
  events.
- `diff(input)`: convenience accumulator over `diffStream` for
  callers wanting a summary object.

Token grain matches on both sides — basic strings as `DoubleQuote` +
`String` content + `DoubleQuote`; escaped numbers as `Escape` +
`Number` (with `PositiveIntegerLit` normalized to `Number`); etc. —
so the harness is a direct lockstep walk after type-name
normalization on both sides. No content coalescing is needed.

The diff harness is the source of truth for "does the new tokenizer
match the legacy." A change to either side must preserve diff-
cleanliness on the smoke-test suite (88 inputs as of last sweep).
The `PositiveIntegerLit` normalization is the only known
intentional divergence; any other diff is a regression.


## 17. Streaming-Output Semantics

The lexer subscribes are async iterables (`for await (let ev of
handle.subscribe(filter))`). Token emission is interleaved with
parsing:

- `open` event when a frame opens. Subscribers see the production
  name and start position.
- `matched` event when a frame closes successfully. The frame's
  full content (matched chars, end position, children frames) is
  populated by this point.
- `rollback` event when a previously-matched frame is rolled back
  due to a parent's backtrack. Cascades top-down through children.
- `commit` event when a frame's match is finalized — no further
  rollback is possible. Cascades top-down from a top-level frame
  when the parse completes successfully.

For lexer use, the practical pattern is:

```js
for await (let ev of handle.subscribe(presets.parseTokens)) {
    if (ev.kind === "commit") {
        // emit token
    }
}
```

`presets.parseTokens` filters to depth-1 frames and to
`matched`/`rollback`/`commit` event kinds. Consumers can listen
to all three and treat `matched` as provisional (rollback may
follow), or wait for `commit` only.

A subscriber consuming the stream while parsing is still in flight
receives tokens as they are recognized, with one caveat: the
expression-ending wrapper (§11) can cause Whitespace/Comment tokens
to be emitted as `matched` and then rolled back. Consumers that
treat `matched` as final will see ephemeral trivia events.
