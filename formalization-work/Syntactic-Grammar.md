# Foi Syntactic Grammar

Source-of-truth syntactic grammar for Foi, derived from the
combinator parser in `parser.js`. Operates over tokens emitted by
the lex layer (see `Lexical-Grammar.md`). Instaparse-style EBNF.

Throughout: alternation `|` is intended as ordered choice (first
match wins; longer/more-specific alternatives are listed first
where their prefixes overlap).

## Notation

The grammar uses the same notation conventions as
`Lexical-Grammar.md`. Terminal references in this grammar are
token-level — they name a token *type* (e.g. `Identifier`,
`OpenParen`, `Comma`) or, for reserved-word value-literals, a
token type plus a `value` field constraint.

- **`Name`** — match a token of type `Name`. The set of token
  types is fixed by the lex layer: see `Lexical-Grammar.md`. Most
  terminal references are direct type matches.

  Also referenced this way: the hidden char-level dispatcher
  `EscapedNumber` from `Lexical-Grammar.md`. When matched, it
  splices its child tokens (one Escape variant + one Number
  variant) directly into the parent's children.

  The four `*Chars` aliases (`PlainStrChars`, `InterpStrChars`,
  `SpacingInterpStrChars`, `SpacingEscapedStrChars`) are referenced
  by name from the four context-specific `*StrContent` rules
  below — each `*StrContent` references exactly the char-emitter
  matching its string-form context.

- **`"value"`** — match a token by its `value` field. Used only
  for reserved-word value-literals, each gated through its type
  production at the lex layer:
  - `Keyword` values: `"def"`, `"defn"`, `"deft"`, `"import"`,
    `"export"`, `":as"`, `":over"`, `":Effects"`,
    `"int"`, `"float"`, `"bool"`, `"string"`, `"Any"`
  - `Native` values: `"true"`, `"false"`, `"empty"`
  - `Builtin` values: `"Id"`, `"None"`, `"Maybe"`, `"Left"`, `"Right"`,
  `"Either"`, `"Done"`, `"Promise"`, `"PushStream"`, `"PullStream"`,
  `"Channel"`, `"Iter"`, `"Gen"`, `"Effect"`, `"IO"`, `"Value"`,
  `"Function"`, `"Number"`, `"List"`
  - `BooleanOper` values: `"?and"`, `"!and"`, `"?or"`, `"!or"`,
    `"?as"`, `"!as"`, `"?in"`, `"!in"`, `"?has"`, `"!has"`,
    `"?empty"`, `"!empty"`
  - `Comprehension` is handled at the type level (`Comprehension`
    in PascalCase form); individual comprehension names are not
    referenced by value.

**Adjacency.** Adjacent productions in a sequence match adjacent
tokens — no trivia between them. Explicit trivia is marked with
`_` (optional trivia). Multi-char
operator sequences that aren't single lex tokens are written as
space-separated production references: `:=` is `Colon Equal`,
`~<<` is `Tilde OpenAngle OpenAngle`, `~<*` is `Tilde OpenAngle Star`,
`#>` is `Hash CloseAngle`, `+>` is `Plus CloseAngle`, `<+` is
`OpenAngle Plus`, `~<` is `Tilde OpenAngle`. Pre-tokenized multi-char
operators — `DoubleColon` (`::`), `DoublePeriod` (`..`), `TriplePeriod`
(`...`) — are referenced by their production names directly.

**Hidden productions** are marked with angle brackets on the LHS:
`<Name> := ...`. They match as usual but emit no node; children
splice into the parent. Use for alternation dispatchers and
punctuation wrappers. Maps onto impl as bare `and(...)` / `or(...)`.
RHS references inherit the LHS marking, so re-bracketing on use is
unnecessary — `<X>` on RHS appears only for non-named hidden
constructs.

**Visible productions** correspond to `production(NAME, ...)` in the
combinator impl — they appear as named nodes in the AST. Every
visible production emits an AST node whose type matches the
production name exactly — no aliasing, no name-rewriting. Where
multiple productions share structural shape but differ in inner
content (e.g. the six paren-grouping variants), each is its own
distinct AST node, named to reflect its inner content.

**Trivia is explicit.** One hidden helper:

```ebnf
<_>  := (Whitespace | Comment)*;       (* optional trivia *)
```

The syntactic grammar never needs a "required whitespace"
combinator — required separation between syntactic forms is
already enforced at the lex layer via token boundaries
(identifier longest-match, reserved-word gates, etc.).

## `:as` Precedence — First-Class Rule

`:as` annotations bind at exactly one level of precedence —
**strictly between unary and binary** in the tier ladder.

Tightest → loosest:

```
chain/access → unary → :as → binary tiers → range
```

Operationally: `:as` can only attach to a **complete chain, access,
unary, leaf, or parenthesized-group expression**. It cannot attach
to a bare binary or range expression — those require parentheses
to receive an annotation.

There is exactly one production in the grammar that introduces
the `:as` tail on a non-paren expression: **`AsExpr`** (§5). The
six paren-grouping productions additionally carry their own
`(_ AsAnnotationExpr)?` tail (because parens already define an
atomic group). Nothing else in the grammar carries `:as` directly.

Concrete consequences:

- `x :as int` → parses; `as` attaches to `x`
- `?x :as bool` → parses; `as` attaches to the outer
  `SymbolicUnaryExpr`, not the inner `x`
- `?empty foo :as Maybe` → parses; `as` attaches to the outer
  `NamedUnaryExpr`
- `5 :as int` → parses; `as` attaches to the `NumberLit`
- `foo() :as int` → parses; `as` attaches to the outermost typed
  chain node (e.g. `CallExpr`)
- `foo.bar@ :as Maybe` → parses; `as` attaches to the `AtExpr`
- `{ y; } :as int` → parses; `as` attaches to the `BareBlockExpr`
- **`x + y :as int` → PARSE ERROR** (must be `(x + y) :as int`)
- **`x + y :as int + z` → PARSE ERROR**
- **`1..5 :as List` → PARSE ERROR** (must be `(1..5) :as List`)
- **`x..y :as int` → PARSE ERROR** (the same ambiguity binary
  has, applied to range — require parens)
- **`x :as int + y` → PARSE ERROR** (once `AsExpr` consumes
  `x :as int` at the outer level, `+ y` has nowhere to go)
- `(x + y) :as int` → parses; `as` on the `GroupedOpExpr`
- `(1..5) :as List` → parses; `as` on the `GroupedOpExpr` wrapping
  the `ClosedRangeExpr`
- `(?x :as bool) ?and y` → parses; the inner `:as bool` rides
  inside the paren-group via `AsExpr`; outer paren has no own `:as`
- `(x + y) :as int ~map f` → parses; `GroupedOpExpr` carries its
  own `:as`, then `~map f` is the binary tail
- `10 + (x := 5)` → parses; `AssignmentExpr` is admitted as an inner
  alternative of the three operand-position restrictive paren-grouping
  productions
- `(x := 5) :as int` → parses; the paren-grouping's own `:as` tail
  attaches to the `GroupedExpr` wrapping the `AssignmentExpr`
- **`10 + x := 5` → PARSE ERROR** (bare assignment isn't admitted at
  binary-operand position; must parenthesize)
- **`(x) :as bool :as char` → PARSE ERROR** (paren-grouping is not
  in `<AsableExpr>` — the paren's own tail consumes `:as bool`, then
  the outer `:as char` has no AsExpr to land on)
- **`(x :as int) :as bool :as char` → PARSE ERROR** (inner `:as int`
  attaches to `x.as` fine; the outer `:as bool :as char` chain is
  rejected for the same reason)

The mechanism: `AsExpr` is reachable from `<Expr>` and
`<ExprNoBlock>` dispatchers (outer-position expression slots), but
**not** from inside `<BinaryAtom>`. The binary tier operands see
only the bare forms (no `:as`), which is what makes
`x + y :as int` rejected rather than silently binding `:as` to
`y`. The four restrictive paren-inner forms gain `AsExpr` as an
alternative so that `(?x :as bool)`, `(foo() :as int)`, etc.
continue to parse inside parens.

**Productions that carry `:as` directly:**
- `AsExpr` (§5) — the central carrier
- All six paren-grouping productions (`GroupedExpr`,
  `GroupedExprNoBlock`, `GroupedOpExpr`, `GroupedBareOpExpr`,
  `GroupedBareOpExprNoEmpty`, `GroupedDoExpr`)

**Productions that don't carry `:as` directly but are wrappable
via `AsExpr`** (annotation reaches them through `<AsableExpr>`):
`BareBlockExpr`, `GuardedExpr`, `UnaryExpr`'s two arms, and the
`<AsableInner>` leaves — `EmptyLit`, `CallExpr` (i.e. `ChainExpr`
and `AtCallExpr` via their `<CallExpr>` parent), `BooleanLit`,
`NumberLit`, all four `StringLit` variants, `RecordTupleLit`,
`SetLit`, `BareIdentifier`, `OpFuncExpr`.

**Productions with no `:as` path at all** (must be parenthesized
to be annotated — `(...)` wrapping reaches a paren-grouping
production, which carries its own `(_ AsAnnotationExpr)?` tail):
`BinaryExpr` and all tier iter variants (`FlowBinExpr`,
`OrBinExpr`, `AndBinExpr`, `TypeCompareBinExpr`, `CompareBinExpr`,
`AddBinExpr`, `MulBinExpr`), `AssignmentExpr`, `ClosedRangeExpr` /
`LeadingRangeExpr` / `TrailingRangeExpr`, `DoComprExpr`,
`DoLoopComprExpr`, `MatchExpr`, and `BlockExpr`. `BlockExpr` sits
in this bucket not because it's a binary form but because it's
only reachable from implicit-input positions (FlowRHSImplIn,
FuncBodyPipeline body) — there is no outer-expression slot where
an `AsExpr` could wrap it.

---

## §1 Program / Statements

```ebnf
Program             := _ ((StmtSemi | ExportStmtSemi) _)*
                       ((StmtSemiOpt | ExportStmtSemiOpt) _)?;

<Stmt>              := DefHookDecl | DefBlockStmt | DefVarStmt | DefTypeStmt | Expr;
StmtSemi            := Stmt? (_ Semicolon)+;
StmtSemiOpt         := Stmt? (_ Semicolon)*;
ExportStmtSemi      := ExportExpr (_ Semicolon)+;
ExportStmtSemiOpt   := ExportExpr (_ Semicolon)*;

Identifier          := General;
BuiltIn             := Builtin;
PipelineTopic       := Hash;
```

## §2 Literals

```ebnf
(* No leaf in §2 carries its own (_ AsAnnotationExpr)?. The `:as`
   tail on a leaf is supplied by an enclosing AsExpr (§5). *)

(* NumberLit: an escape-prefixed form, a bare decimal Number token,
   or a bare integer literal of either sign (PositiveIntegerLit or
   NegativeIntegerLit, unified via the hidden IntegerLit from
   Lexical-Grammar.md).

   <EscapedNumberLit> names the two-token shape the syn consumes when
   the lex's hidden <EscapedNumber> dispatcher matches.
   <EscapeNonUnicode> admits four Escape variants. EscapeUnicode
   (`\u<hex>`) is excluded: it is a character escape rather than a
   numeric literal, producing a single-codepoint string, and it is
   admitted exclusively from inside InterpExpr (§2, see UnicodeCharLit
   below) as the sole contents of an interpolation slot. The lexer
   recognizes it anywhere in source; the narrowness is the syn's.

   Of the four admitted arms: three produce Escape + Number
   (Hex/Octal/Binary, plus EscapePlain's BareNumber inner — all
   aliases for the Number token type per Lexical-Grammar.md
   Notes 5/7); the fourth (EscapePlain paired with
   PositiveIntegerLitWithSep) produces Escape + PositiveIntegerLit
   (alias pattern per Note 6; this routing keeps the same token type
   feeding <PositiveIntLit> at PropertyExpr-key positions). The syn
   admits both pairings so unsigned separator-bearing integers like
   `\5_000` parse at value position, not only at PropertyExpr-key
   position.

   Integer-only contexts maintain their own narrower reach —
   DotIdentifier admits bare IntegerLit only (no escape forms);
   <PositiveIntLit> in PropertyExpr admits bare PositiveIntegerLit
   plus the EscapePlain-paired form, but no signs and no \u. *)
NumberLit          := EscapedNumberLit | Number | IntegerLit;
<EscapedNumberLit> := EscapeNonUnicode (Number | PositiveIntegerLit);
<EscapeNonUnicode> := EscapeHex | EscapeOctal | EscapeBinary | EscapePlain;

BooleanLit         := "true" | "false";
EmptyLit           := "empty";

<StringLit>        := PlainStr | SpacingEscapedStr | InterpStr | SpacingInterpStr;

PlainStr           := DoubleQuote PlainStrContent* DoubleQuote;
<PlainStrContent>  := PlainStrChars | StringEscapedChar;

SpacingEscapedStr  := EscapePlain DoubleQuote SpacingEscapedStrContent* DoubleQuote;
<SpacingEscapedStrContent> := SpacingEscapedStrChars | StringEscapedChar | Whitespace;

InterpStr          := EscapeBacktick DoubleQuote InterpStrContent* DoubleQuote;
<InterpStrContent> := InterpStrChars | StringEscapedChar | InterpExpr;

SpacingInterpStr   := EscapeSpacingBacktick DoubleQuote SpacingInterpStrContent* DoubleQuote;
<SpacingInterpStrContent> := SpacingInterpStrChars | StringEscapedChar | Whitespace | InterpExpr;

(* InterpExpr admits one of two mutually exclusive shapes between the
   delimiting backticks: a UnicodeCharLit (the \u<hex> form, consuming
   the slot alone), or any Foi Expr.

   UnicodeCharLit is reachable ONLY here. It does not appear at
   value-position via NumberLit (see EscapedNumberLit above). The
   PEG ordered-choice tries UnicodeCharLit first; if it matches
   the Escape + Number pair but the trailing tokens are not the
   closing Backtick (i.e., any attempt to combine \u<hex> with
   further expression content in the same slot), the overall
   InterpExpr fails — by design. The slot-shape rule is "exactly
   one of {Expr, UnicodeCharLit}, alone."

   The lexer recognizes \u<hex> uniformly anywhere in source under
   the <EscapedNumber> dispatcher (Lexical-Grammar.md §EscapedNumber);
   the syn enforces position-narrowness here.

   UnicodeCharLit emits a UnicodeCharLit-typed node (its own AST
   type, distinct from NumberLit). The dedicated type avoids a
   production-name collision in the packrat memo table (keyed by
   "ProductionName@pos" — see parser-combinators.js); aliasing both
   productions to "NumberLit" was tried and rejected. Downstream
   consumers (shaper and transpiler) dispatch on `type ===
   "UnicodeCharLit"`, with the transpiler lowering to
   `String.fromCodePoint(0x<hex>)`. *)
InterpExpr     := Backtick _ (UnicodeCharLit | Expr) _ Backtick;
UnicodeCharLit := EscapeUnicode Number;
```

The four `*StrContent` rules each reference the lex char-emitter
specific to their context — `PlainStrChars` (no backtick/whitespace
restrictions beyond `"`), `InterpStrChars` (stops at backtick too),
`SpacingInterpStrChars` (stops at backtick and whitespace),
`SpacingEscapedStrChars` (stops at whitespace, allows backticks).
This per-context resolution means the unified grammar produces the
same parse tree the impl produces: a backtick inside an `InterpStr`
is recognized as an `InterpExpr` opener rather than absorbed into
`String` content.

## §3 Imports / Exports

```ebnf
ImportExpr            := "import" _ PlainStr;

ExportExpr            := "export" _ OpenBrace _ ExportBindingsList _ CloseBrace;
<ExportBindingsList>  := ExportBinding (_ Comma _ ExportBinding)* (_ Comma)?;
<ExportBinding>       := ExportNamedBinding | ExportConciseBinding;
ExportNamedBinding    := Identifier _ Colon _ Identifier MultiAccessExpr?;
ExportConciseBinding  := Colon Identifier SingleAccessExpr?;
```

## §4 Variable Definitions / Destructuring

```ebnf
(* DeclTypeClause is the container-type annotation on a declaration.
   It is CUDDLED to the introducing keyword -- no trivia between
   `def` / `defn` and the `{` -- so `def {int} v: 3;` is a parse
   error. The inner is a bare NamedType (§18); there is no `:as`
   inside the braces.

   Three attachment sites, spelled identically at each: DefVarStmt
   (below), and DefFuncExpr / DefHookDecl (§13).

   A `def` initializer may additionally carry its own `:as` tail
   through AsExpr (§5), which types the VALUE rather than the
   container: `def{Rec} <:a, :b>: myRecord :as Rec;`. The two are
   independent -- either, both, or neither. *)

DeclTypeClause                := OpenBrace _ NamedType _ CloseBrace;

DefVarStmt                    := "def" DeclTypeClause? _ (Identifier | DestructureTarget) _ Colon _ (Expr | ImportExpr);

DestructureTarget             := OpenAngle _ <DestructureDefList> _ CloseAngle;
<DestructureDefList>          := <RecordDestructureDefList> | <TupleDestructureDefList>;

<RecordDestructureDefList>    := DestructureDef (_ Comma _ DestructureDef)* (_ Comma)?;
DestructureDef                := (DestructureNamedDef | DestructureConciseDef) (_ Colon Qmark _ ExprNoBlock)? | DestructureCapture;

<TupleDestructureDefList>     := (_ Comma)* _ <TupleDestructureEntry> (_ Comma (_ <TupleDestructureEntry>)?)*
                               | (_ Comma)+;
<TupleDestructureEntry>       := DestructurePositionalDef | DestructureCapture;
DestructurePositionalDef      := Identifier (_ Colon Qmark _ ExprNoBlock)? &(_ (Comma | CloseAngle));

DestructureNamedDef           := Identifier _ Colon _ (Identifier | BracketExpr) MultiAccessExpr?;
DestructureConciseDef         := Colon Identifier SingleAccessExpr?;
DestructureCapture            := Hash Identifier;
```

`<DestructureDefList>` dispatches between two mutually-exclusive modes
via PEG ordered choice: tuple-mode (`<TupleDestructureDefList>`, tried
first) or record-mode (`<RecordDestructureDefList>`, fallback). Two
mechanisms combine to make the ordering robust:

1. Tuple-mode's list is non-nullable — it requires either a leading
   comma sequence or at least one entry — so an empty `<>` target
   fails both arms and is grammatically rejected.

2. `DestructurePositionalDef` carries a positive-lookahead assertion
   `&(_ (Comma | CloseAngle))` requiring the entry to terminate at
   a tuple-list boundary. This prevents tuple-mode from greedily
   consuming a bare identifier that opens a record-side Named form
   (`<a: src>`): after matching `a`, the optional `:?` tail fails
   on bare `:`, the lookahead then fails on `:` (neither Comma nor
   CloseAngle), and tuple's list fails cleanly. PEG's ordered
   choice falls through to record-mode which parses correctly.

All-capture targets (`< #whole >`) parse under tuple-mode's grammar arm
by ordering, but the DestructureTarget shaper still labels mode as
`"record"` because no positional entry is present — the grammar arm
chosen is an implementation detail; the semantic mode is determined
by entry types. The two modes do not mix within a single target — a
`<:a, b>` or `<a, :b>` combination fails to parse under both arms.
See Foi-Specification.md §2.13 opener for the mode framing.

Record-mode entries (`DestructureDef`) admit `DestructureNamedDef`,
`DestructureConciseDef`, or `DestructureCapture`. Tuple-mode entries
(`<TupleDestructureEntry>`) admit `DestructurePositionalDef` or
`DestructureCapture`. The shared `DestructureCapture` production is
position-neutral within a tuple list (does not consume a source
position); positional-vs-capture position semantics are handled by
the shaper against the `.entries` array. See Foi-Specification.md §2.13.6.

The `(_ Colon Qmark _ ExprNoBlock)?` per-entry default tail
(Foi-Specification.md §2.13.1, §2.13.2, §2.13.4, §2.13.6) appears on
the record-side `DestructureDef` and the tuple-side
`DestructurePositionalDef`. The `Colon Qmark` composite is the same
two-token sigil introduced in §11's `VarDefInitOptImplIn` (Series 1) —
trivia insignificant around the composite, but the `Qmark` must
immediately follow the `Colon` with no intervening trivia (mirrors the
`Colon Equal` convention of `AssignmentExpr` in §12).

`DestructureDef` (record-side) was previously a hidden dispatcher; it
becomes visible to host the default tail without scattering the
concern across consumers. Its shaper subsumes — the returned node is
the inner `DestructureNamedDef` or `DestructureConciseDef` (or
`DestructureCapture` unmodified), with the tail's `ExprNoBlock` folded
onto the inner node's `.default` slot and the tail's `Colon Qmark`
pushed to the inner node's `delims`. No `DestructureDef` node appears
in the AST; downstream consumers see the same three record-side node
types they always have, now optionally carrying a `.default` field on
the two non-capture arms.

`DestructurePositionalDef` (tuple-side) hosts its default tail directly
— no subsuming dispatcher needed given the single grammatical arm. Its
shaper produces a `DestructurePositionalDef` node with `.target` (the
Identifier) and optional `.default` (the tail's `ExprNoBlock`), plus
the sigil tokens in `delims`. This mirrors `DestructureCapture`'s
Identifier-wrapping node shape.

The tail is grammatically excluded from the `DestructureCapture` arm
in both modes. Per Foi-Specification.md §2.13.3, capture reads the
entire source; a destructure-against-empty errors before per-entry
procedures proceed (§3.2.3), so a capture-with-default entry is
unreachable.

`<TupleDestructureDefList>` adapts the `<RecordTupleEntryList>` shape
(§17) to preserve §1.5.2 tuple-form comma-counting rules while
remaining non-nullable. Two alternatives: the first requires at least
one entry (with any number of leading skip commas + optional interior
skips + optional trailing skip commas); the second requires at least
one leading comma with no entries (rare edge case — allows a skip-only
target like `<,>` to parse for grammatical symmetry with §1.5.2).
Leading and interior skips consume source positions per §2.13.6's
abstract execution; trailing skips are grammatically admitted but
semantically no-op. The shaper produces `DestructureSkipSlot`
sentinel nodes in the `.entries` array for empty positions,
preserving round-trip fidelity; downstream consumers (transpiler,
semantic analyzer) treat trailing skip sentinels as no-ops.

The `DestructureTarget` node carries an explicit `.mode` field
(`"record"` or `"tuple"`) set by the shaper based on which sub-list
matched. Downstream consumers dispatch on `.mode` rather than
inspecting `.entries[0].type`. An empty `<>` target parses under
tuple-mode (record's list requires at least one entry) with an empty
`.entries` array.

## §5 Expression Scaffolding

```ebnf
(* Vertical dispatchers hidden — pure parser routing. Each
   paren-grouping production is a distinct visible AST node, named
   for its inner content. Call sites reference the variant whose
   inner content they allow.

   AsExpr is the central carrier of `:as` annotations on non-paren
   expressions. It is placed in <Expr> and <ExprNoBlock> (outer
   expression slots), and as an inner alternative in the four
   restrictive paren variants (GroupedOpExpr, GroupedBareOpExpr,
   GroupedBareOpExprNoEmpty, GroupedDoExpr) so that paren-wrapped
   expressions like `(?x :as bool)` can also reach `:as`. AsExpr
   is NOT in <BinaryAtom> — that's what enforces the rule that
   `x + y :as int` is a parse error.

   See the `:as` Precedence section above. *)

<Expr>          := DoComprExpr | DoLoopComprExpr | AsExpr | BareBlockExpr | ExprNoBlock | GroupedExpr;

<ExprNoBlock>          := DefFuncExpr | AssignmentExpr | MatchExpr | GuardedExpr | AsExpr | OperandExpr | GroupedExprNoBlock;

<OperandExpr>          := BinaryExpr;

<BareOperandExpr>      := EmptyLit | BareOperandExprNoEmpty | GroupedBareOpExpr;

<BareOperandExprNoEmpty> := CallExpr | ThunkExpr | BooleanLit | NumberLit
                          | StringLit | DataStructLit | BareIdentifier
                          | OpFuncExpr | GroupedBareOpExprNoEmpty;

(* AsExpr — the sole non-paren carrier of `:as`. Inner is restricted
   to <AsableExpr>: anything tighter than binary (chain/access via
   BareOperandExpr's CallExpr arm, unary, leaves) plus BareBlockExpr
   and GuardedExpr at the outer level. BlockExpr (the defs-init form,
   §11) is deliberately NOT in <AsableExpr> — it is only reachable
   from implicit-input positions and has no annotation path. Ranges
   are deliberately NOT in <AsableExpr> — annotating a bare range
   requires explicit parens (`(1..5) :as List`).

   AsExpr is a parse-time wrapper. Its shaper unwraps — it attaches
   the annotation onto its inner node's `.as` slot and returns the
   inner. There is no AsExpr node type in the AST. The `.as` slot
   is shape-polymorphic by source content: bare NamedType when
   AsAnnotationExpr has no delims (default mode), the full
   AsAnnotationExpr wrapper when it does (preserveSoftDelims:true
   with WS between `:as` and the type). Same fold-or-keep rule
   applies to GroupedExpr.as and DefFuncExpr.as.

   <AsableExpr> excludes paren-grouping productions. Each paren-
   grouping production carries its own (_ AsAnnotationExpr)? tail;
   admitting paren forms in <AsableExpr> would allow chained `:as`
   like `(x) :as bool :as char` to parse — the paren's own tail
   would take `:as bool`, the outer AsExpr's tail would take `:as
   char`, and AsExpr's shaper would then overwrite the `bool` that
   shapeGrouped just attached to the same GroupedExpr node. Paren-
   grouping remains reachable via <BinaryAtom> for non-`:as` uses
   and via its own one-shot tail for the legitimate `(...) :as T`
   form. *)
AsExpr                 := <AsableExpr> _ AsAnnotationExpr;
<AsableExpr>           := BareBlockExpr | GuardedExpr | UnaryExpr
                        | AsableInner;
<AsableInner>          := EmptyLit | CallExpr | BooleanLit | NumberLit
                        | StringLit | DataStructLit | BareIdentifier
                        | OpFuncExpr;

(* Six paren-grouping productions. The two whose inner-expr forms
   include AsExpr via dispatch (GroupedExpr's Expr, GroupedExprNoBlock's
   ExprNoBlock) need no widening. The four restrictive variants
   (OperandExpr, BareOperandExpr, BareOperandExprNoEmpty, do-compr)
   add AsExpr as an explicit alternative.

   The three operand-position restrictive variants (GroupedOpExpr,
   GroupedBareOpExpr, GroupedBareOpExprNoEmpty) additionally admit
   DefFuncExpr, MatchExpr, and AssignmentExpr as inner alternatives.
   All three are value-producing forms that the narrow-by-default
   inner allow-list (AsExpr / OperandExpr / BareOperandExpr...)
   doesn't reach, but each composes naturally as a binary operand
   once parenthesized:

     10 + (x := 5)                        (* AssignmentExpr — JS-like *)
     (defn(x)^x*2) +> (defn(x)^x+1)       (* DefFuncExpr as compose operand *)
     (?{ [c]: f; ?: g })(7)               (* MatchExpr as chain base *)

   The bare forms remain parse errors — BinaryAtom itself admits
   none of `:=`, `defn`, or `?{`/`?(`, and there is no AsExpr-like
   fall-through that would silently re-bind their distinctive
   openers.

   GroupedDoExpr is excluded from all three widenings — its inner
   is do-compr-only by design, and any of these forms at binary-
   operand position is caught by the earlier arms in BinaryAtom's
   dispatch ordering.

   PEG order within each widened inner: DefFuncExpr first (distinct
   `defn` keyword), MatchExpr next (`?{` / `?(`, disjoint from
   GuardedExpr's `?[` reached through AsExpr), AssignmentExpr
   (Identifier-led with `:=` tail), AsExpr (`:as`-tailed), then
   the production-specific operand fall-through. All five inner
   arms are disjoint at their first one or two tokens.

   GroupedBareOpExprNoEmpty vs GroupedBareOpExpr — the structural
   reason for the split. <BareOperandExpr> admits EmptyLit at its
   top level (`empty + 1` parses at BinaryAtom); <BareOperandExprNoEmpty>
   doesn't. The paren-recursive arm preserves whichever invariant
   the outer reach already committed to: a paren reached via
   <BareOperandExpr>'s third arm becomes a GroupedBareOpExpr and
   recurses on the full BareOperandExpr (so `(empty)` is admitted
   inside); a paren reached via <BareOperandExprNoEmpty>'s eighth
   arm becomes a GroupedBareOpExprNoEmpty and recurses on the
   no-empty inner. PEG dispatch at BinaryAtom tries
   <BareOperandExprNoEmpty> before <BareOperandExpr>'s third arm,
   so `(empty)` fails fast in the NoEmpty path (its inner can't
   admit `empty`) and falls through to GroupedBareOpExpr — the
   resulting AST node tag faithfully encodes which dispatch path
   accepted the paren-wrap. User-visible parse acceptance is
   equivalent for paren-wrapped non-empty content; only `(empty)`
   is exclusive to the GroupedBareOpExpr path. The round-trip
   oracle is the load-bearing check that the split is structurally
   necessary; the design-time motivation is no-empty-invariant
   compositionality through paren-recursion. *)

GroupedExpr              := OpenParen _ Expr _ CloseParen (_ AsAnnotationExpr)?;
GroupedExprNoBlock       := OpenParen _ ExprNoBlock _ CloseParen (_ AsAnnotationExpr)?;
GroupedOpExpr            := OpenParen _ (DefFuncExpr | MatchExpr | AssignmentExpr | AsExpr | OperandExpr) _ CloseParen (_ AsAnnotationExpr)?;
GroupedBareOpExpr        := OpenParen _ (DefFuncExpr | MatchExpr | AssignmentExpr | AsExpr | BareOperandExpr) _ CloseParen (_ AsAnnotationExpr)?;
GroupedBareOpExprNoEmpty := OpenParen _ (DefFuncExpr | MatchExpr | AssignmentExpr | AsExpr | BareOperandExprNoEmpty) _ CloseParen (_ AsAnnotationExpr)?;

AsAnnotationExpr         := ":as" _ NamedType;        (* NamedType — forward ref to §18 *)
```

PEG ordering notes:

- In `<Expr>`, `AsExpr` precedes `BareBlockExpr` and `ExprNoBlock` —
  the longer match (with `:as` tail) wins. On no `:as`, `AsExpr`
  fails fast at the missing tail and falls through.
- In `<ExprNoBlock>`, `AsExpr` precedes `OperandExpr` and
  `GroupedExprNoBlock` for the same reason. It is placed after
  `GuardedExpr` because `<AsableExpr>` includes `GuardedExpr`;
  trying `AsExpr` first would consume the guarded body greedily
  and then fail at the `:as` tail when the body's own greedy
  `Expr` already ate any `:as`. Same fall-through semantics on
  no `:as`.
- In `<Expr>`, `BareBlockExpr` opens with `{` — disjoint from every
  other `<Expr>` arm's opener, so its ordering relative to
  `ExprNoBlock` / `GroupedExpr` is mechanical. The standalone form
  `(defs){body};` (which previously parsed via an optional-defs-init
  BlockExpr arm) is now intentionally rejected: `BlockExpr` (the
  defs-init form, §11) is reachable only from implicit-input
  positions (FlowRHSImplIn, FuncBodyPipeline body), not from
  `<Expr>`, and a free-standing `(defs)` group has no source for
  the defs-init to bind from. `(x){y;};` is a parse error rather
  than two separate statements because there's no semicolon
  between `(x)` and `{y;}`.
- In `<BareOperandExprNoEmpty>`, `CallExpr` (= AtCallExpr | ChainExpr)
  precedes the bare literal and identifier forms so `"hi".len`
  parses as `ChainExpr` rather than `StringLit` with dangling `.len`.
  Within `CallExpr`, `AtCallExpr` precedes `ChainExpr` so `foo@ 5`
  (an `AtCallExpr` with payload) is preferred over a no-payload
  `foo@` with a dangling `5` it can't reach.
- In `<BareOperandExprNoEmpty>`, `ThunkExpr`'s `DoubleAt` opener is
  disjoint from every other arm, so its position is mechanical. It
  sits after `CallExpr` to keep the call forms contiguous.

## §6 Identifier / Access Expressions

```ebnf
(* ChainExpr (§7) covers all post-base chains (calls, access, or
   mixed) on any base. BareIdentifier here is just the bare
   identifier / builtin / pipeline-topic form. Bare `@` as a
   value is NOT admitted at identifier position. To reference
   the `@`-call operator as a first-class function value, use
   the operator-as-function lift form `(@)` (§7 OpFuncExpr), same
   mechanism as every other operator. To extract a marker-
   preserving function reference from an `@`-hook-bearing
   namespace, use the `.@` chain-tail form (§7 AtRefExpr).
   BareIdentifier carries no `:as` directly — annotation comes
   from enclosing AsExpr (§5). *)

(* IdentityFunc is reachable ONLY from AtCallExpr's IdentityFunc
   arm (the LHS-less `@v` use form). Its single At token is
   consumed by AtCallExpr's shaper and the production is folded
   into a distinct IdentityCallExpr node — no IdentityFunc AST
   node survives shaping. The production remains named here for
   parser-grammar alignment. *)
IdentityFunc         := At;
BareIdentifier       := IdentBase;

<IdentBase>          := PipelineTopic | Identifier | BuiltIn;

(* SingleAccessExpr and MultiAccessExpr are used by special contexts
   (ExportNamedBinding, DestructureNamedDef, AssignmentExpr LHS,
   AtCallExpr's internal access) that take an identifier with an
   access tail directly, not via ChainExpr. *)

SingleAccessExpr     := SingleAccessSeg (_ SingleAccessSeg)*;
<SingleAccessSeg>    := DotIdentifier | BracketExpr;

MultiAccessExpr      := MultiAccessSeg (_ MultiAccessSeg)*;
<MultiAccessSeg>     := DotIdentifier | BracketExpr | DotBracketExpr | DotAngleExpr;

(* DotIdentifier: dot-access by name (identifier or builtin) or by
   bare integer index of either sign (via the hidden IntegerLit
   union from Lexical-Grammar.md). The negative-index form `arr.-1`
   accesses from the end of an ordered structure. Property-name
   contexts elsewhere (PropertyExpr, AnglePropertyList, record
   properties) remain positive-only via PositiveIntLit. *)
DotIdentifier        := Period _ (Identifier | BuiltIn | IntegerLit);
BracketExpr          := OpenBracket _ ExprNoBlock _ CloseBracket;
DotBracketExpr       := Period OpenBracket _ RangeExpr _ CloseBracket;
DotAngleExpr         := Period OpenAngle _ AnglePropertyList _ CloseAngle;

(* Dynamic-pick arms inside DotAngleExpr — `.<%expr>` (computed
   name, one slot) and `.<&src>` (key-stream spread, N slots).
   ComputedPropName is shared with ExplicitPropDef (§17, full
   inner alphabet parity). SpreadPropName mirrors PickValue's
   source shape: IdentBase + optional MultiAccessExpr, no call
   suffixes — inline calls require pre-binding. Runtime contract
   on `&`: source value must be a tuple of strings / string-
   coercible names; transpiler emits the natural lowering and
   fails honestly at runtime on shape mismatch.

   Computed-key stringification footgun: a `%expr` whose value
   is a Record/Tuple stringifies via JS `.toString()` to a
   stable-but-meaningless key. Inherited from ExplicitPropDef
   — fix is at the runtime layer (structural-equality Map dispatch),
   not at the grammar layer. *)
<AnglePropertyList>  := AnglePickEntry (_ Comma _ AnglePickEntry)* (_ Comma)?;
<AnglePickEntry>     := ComputedPropName | SpreadPropName | PropertyExpr;
<SpreadPropName>     := Ampersand IdentBase MultiAccessExpr?;
<PropertyExpr>       := Identifier | PositiveIntLit;

<PositiveIntLit>     := (EscapePlain PositiveIntegerLit) | PositiveIntegerLit;

(* Range operands are bare — no `:as` tail allowed directly on a
   range operand. To annotate a closed range expression as a
   whole, parenthesize it: `(1..5) :as List`.

   <RangeExpr> is referenced only by DotBracketExpr above — that
   is the sole context where open-ended ranges (LeadingRangeExpr,
   TrailingRangeExpr) are admitted. At expression position,
   <BinaryAtom> (§9) admits only ClosedRangeExpr because the
   open-ended forms have no value semantic standalone. *)
<RangeExpr>          := ClosedRangeExpr | LeadingRangeExpr | TrailingRangeExpr;
ClosedRangeExpr      := RangeOperand _ DoublePeriod _ RangeOperand;
LeadingRangeExpr     := RangeOperand _ DoublePeriod;
TrailingRangeExpr    := DoublePeriod _ RangeOperand;
<RangeOperand>       := BareOperandExpr | GroupedOpExpr;
```

## §7 Function Calls / Op-as-Function

```ebnf
(* Any post-base chain — calls, access, or mixed — parses as
   ChainExpr with a flat suffix list. The shaper layer can fold this
   into nested MemberAccessExpr / PrefixCallExpr / PartialCallExpr /
   IndexAccessExpr nodes (JS-style: each suffix wraps the previous
   expression) when the interp needs the typed-by-suffix-kind AST.

   ChainExpr requires extension beyond ChainBase — either ≥1
   ChainSeg, or a ChainTail. A bare base alone falls through to
   its non-chained form via BareOperandExprNoEmpty's later
   alternatives.

   None of ChainExpr / AtCallExpr / OpFuncExpr carry `:as` directly.
   Annotation comes from an enclosing AsExpr (§5).

   Five chain-tail forms reach the chain tail, mutually exclusive
   with one another (no stacking, no access tail after any of
   them). All terminate the access chain — to chain on the result
   of any tail, parenthesize: `(task%).field`, `(Foo.@)(x)`.

   - `'` (SingleQuote, PostfixCallTail arm) — argument-reversal /
     universal-prime inversion on the function value.
   - `/\` (Mountain, PostfixCallTail arm) — curry. Reshapes the
     function's parameter signature into a tiered pyramid (one
     param per call site, by fn.length, outer-tier-only).
   - `\/` (Valley, PostfixCallTail arm) — uncurry. Reshapes a
     tiered (curried) function into a flat n-ary application,
     walking each tier's fn.length to consume args.
   - `%` (EffectorTail) — effector application. Dispatches to
     the source's effect-evaluation hook (`_percent` at lowering
     time) with an optional argument.
   - `.@` (AtRefTail) — marker-preserving function reference
     extraction from a hook-bearing namespace. `Foo.@` lowers
     to `Foo._at`. Strict no-trivia: no `_` between Period and
     At, no `_` between the preceding chain content and `.@`.
     Stricter than DotIdentifier's trivia-tolerant Period to
     match its terminator semantics — there should be no
     variance around when the chain ends.

   Adjacency rules differ between the three tail families.

   PostfixCallTail (`'`/`/\`/`\/`): adjacent to the preceding
   expression (NO trivia between). Each may be followed only
   by zero or more call suffixes. `'` admits trivia between
   `'` and CallSuffix and between consecutive CallSuffixes.
   `/\` and `\/` admit no trivia between modifier and first
   CallSuffix, nor between consecutive CallSuffixes —
   reinforcing "this is one operator-shaped call form."

   EffectorTail (`%`): trivia-tolerant on BOTH sides of `%`
   via leading and between-arg `_`. `task%`, `task %`,
   `task % env`, `task%env`, `task%(env)` all parse. Carries
   no trailing call suffix — `task%(env)` is `%` with a
   paren-grouped operand, not `(task%)` then `(x)`.

   AtRefTail (`.@`): strict no-trivia on BOTH sides of `.@`.
   Carries no trailing form whatsoever — `Foo.@(x)`, `Foo.@%`,
   `Foo.@'`, `Foo.@.bar` all rejected.

   Examples that parse: `foo'`, `foo'(1,2,3)`, `foo.bar'`,
   `foo.bar'(1,2,3)`, `(+)'(1,2,3)`; `foo/\`, `foo/\(1)(2)(3)`,
   `foo.bar/\(1)(2)`, `foo\/`, `foo\/(1,2,3)`; `task%`, `task %`,
   `task % env`, `processFile("f.txt")%`, `obj.method(x) % cfg`;
   `Foo.@`, `Foo.bar.@`.
   Examples that do not: `foo'.bar`, `foo'[0]`, `foo' .bar`
   (trivia before `'`); `foo /\`, `foo/\ (1)`, `foo/\'`,
   `foo/\\/` (stacking or trivia-violation on the curry/uncurry
   ops); `task%.field`, `task%[0]`, `task%'` (stacking or
   access tail after `%`); `%task`, `%`, `%y` (no LHS for `%`);
   `Foo. @`, `Foo .@` (trivia in or before `.@`), `Foo.@(x)`,
   `Foo.@.bar`, `Foo.@%`, `Foo.@'` (stacking on `.@`); `.@`
   (no LHS). *)

<CallExpr>     := AtCallExpr | ChainExpr;

ChainExpr      := ChainBase
                  (
                      (_ ChainSeg)+ ChainTail?
                    | ChainTail
                  );

<ChainTail>    := EffectorTail | AtRefTail | PostfixCallTail;
EffectorTail   := _ Percent (_ ExprNoBlock)?;
AtRefTail      := Period At;
<PostfixCallTail> := SingleQuote (_ CallSuffix)*
                   | (Mountain | Valley) CallSuffix*;

<ChainBase>    := DefFuncExpr | MatchExpr | GuardedExpr | AssignmentExpr
                | OpFuncExpr | GroupedExprNoBlock
                | EmptyLit | BooleanLit | NumberLit | StringLit | DataStructLit
                | BareIdentifier;

<ChainSeg>     := PrefixCallSuffix | PartialCallSuffix
                | DotIdentifier | BracketExpr | DotBracketExpr | DotAngleExpr;

<CallSuffix>   := PrefixCallSuffix | PartialCallSuffix;

PrefixCallSuffix  := OpenParen CallArgs CloseParen;
PartialCallSuffix := Pipe CallArgs Pipe;

(* AtCallExpr is uniformly a call form post-refactor. Was: a
   ref-vs-call distinction with a separate AtExpr reference
   production gated on payload presence. Now: `Foo@` calls with
   no operand (semantic layer supplies an `empty` default);
   `Foo@x`, `Foo @ x`, `Foo.bar@x` all call with the operand.
   To extract a marker-preserving function reference instead of
   calling, use the `.@` chain-tail form (AtRefTail above,
   AtRefExpr at the AST layer).

   AtRefTail is a chain-tail of ChainExpr, NOT an arm of
   AtCallExpr — `Foo.@` parses via ChainExpr, not AtCallExpr.

   The shaper folds the IdentityFunc arm out into a distinct
   IdentityCallExpr node (no callee field — bare `@` applied to
   an argument is one indivisible language construct, not a call
   of `@` on the argument). The IdentBase arm shapes as
   AtCallExpr { base, arg? } where `base` is the foldAccess
   result of the IdentBase + optional SingleAccessExpr — the
   same foldAccess-at-shape-time pattern used at the other
   unified access-fold sites (AssignmentExpr.target,
   ExportNamedBinding.source, DestructureNamedDef.source, etc.). *)
AtCallExpr           := IdentBase SingleAccessExpr? _ At (_ ExprNoBlock)?
                      | IdentityFunc _ ExprNoBlock;

(* ThunkExpr — deferred-evaluation construct. `@@ expr` produces
   a thunk over `expr` rather than evaluating it.

   The operand is greedy `ExprNoBlock`, same as AtCallExpr's
   IdentityFunc arm and EffectorTail's optional arg: `@@ a + b`
   is a thunk over `a + b`, not a thunk over `a` added to `b`.
   Parens group for the narrower reading.

   NOT a ChainBase — `@@ f(x).bar` puts the access inside the
   thunk. To chain off the thunk itself, paren-lift:
   `(@@ f(x)).bar`, the same route `%` uses.

   NOT in <AsableInner> — the greedy operand consumes any `:as`
   tail, so `@@ x :as T` is a thunk over an annotated `x`.
   `(@@ x) :as T` annotates the thunk.

   Shapes as ThunkExpr { expr } with no callee field: `@@`
   applied to an expression is one indivisible construct, same
   rationale as IdentityCallExpr. *)
ThunkExpr            := DoubleAt _ ExprNoBlock;

<CallArgs>           := (Op SingleQuote? &(CloseParen)) | (_ CallArgList? _);
<CallArgList>        := (_ Comma)* (_ CallArgExpr (_ Comma (_ CallArgExpr)?)*)?;
<CallArgExpr>        := (TriplePeriod _)? (NamedArgExpr | Expr);

<NamedArgExpr>       := ConciseNamedArg | ExplicitNamedArg | (OpenParen _ NamedArgExpr _ CloseParen);
ConciseNamedArg      := Colon Identifier;
ExplicitNamedArg     := Identifier _ Colon _ Expr;

(* PEG ordering inside the alternation: longer-prefix arms first.
   DotAngleExpr / DotBracketExpr both open with Period — same as
   Op's UnaryOpSym(Period) — but require more after the Period.
   If Op is tried first, it matches the bare Period and commits,
   then OpFuncExpr's outer `and` fails at CloseParen and rolls
   back the whole production without giving the longer arms a
   chance. The `[]` arm is disjoint (OpenBracket opener); Op last
   catches bare-operator forms like `(.)`, `(+)`, `(..)`. *)
OpFuncExpr           := OpenParen (DotAngleExpr | DotBracketExpr | (OpenBracket CloseBracket) | Op) SingleQuote? CloseParen;
```

PEG ordering notes for `<ChainBase>`:
- `MatchExpr` / `GuardedExpr` precede `AssignmentExpr` — they have distinctive `?`/`!` openers; AssignmentExpr's identifier-led opener could conflict only with `BareIdentifier` (handled by ordering AssignmentExpr before BareIdentifier).
- `OpFuncExpr` precedes `GroupedExprNoBlock` — both open with `(`; OpFuncExpr's restricted inner shape (`DotAngleExpr`, `DotBracketExpr`, the bare `[]` op, or `Op`) fails-through cleanly to `GroupedExprNoBlock` on any other paren-wrapped content. `GroupedExprNoBlock` rather than `GroupedExpr` because paren-wrapped `BareBlockExpr` / `DoComprExpr` / `DoLoopComprExpr` cannot serve as chain bases — bind those to a name first.
- `BareIdentifier` last among identifier-led arms — AssignmentExpr's longer match wins when `:=` follows.

PEG ordering note for `<ChainSeg>`: order matches `<MultiAccessSeg>` for the four access variants (DotIdentifier before DotBracketExpr/DotAngleExpr); call suffixes are disjoint from access suffixes by opening token.

PEG ordering notes for `<ChainTail>`:
- `EffectorTail` first — Percent opener, disjoint from `AtRefTail`'s Period opener and `PostfixCallTail`'s SingleQuote/Mountain/Valley openers. Its leading `_` admits trivia before `%`.
- `AtRefTail` next — Period+At opener. Period also opens `DotIdentifier` (a `<ChainSeg>`), but DotIdentifier requires Identifier/BuiltIn/IntegerLit after the Period, so `.@` fails DotIdentifier in the seg loop and the loop exits; `AtRefTail` then matches at the tail position.
- `PostfixCallTail` last — disjoint openers from both above. The no-leading-`_` rule on its arms preserves the adjacency requirement for `'`/`/\`/`\/` against the preceding chain content.

## §8 Unary Expressions

```ebnf
(* Unary operand restricted to BinaryAtom (tier-1) — `?x + 5` parses
   as `(?x) + 5`. Use parens for broader operands: `?(x + 5)`.

   Neither unary arm carries `:as` directly. `?x :as bool` parses as
   AsExpr wrapping SymbolicUnaryExpr; AsExpr's unwrap-shaper lifts
   `as` onto the SymbolicUnaryExpr node. This is the precedence-fix
   that prompted this rework — `:as` no longer silently sticks to
   the inner BinaryAtom.

   Postfix `'` (the prime operator, argument-reversal modifier) is
   handled as a restricted tail of ChainExpr in §7, not as a UnaryExpr
   arm. It attaches only where a function value lives, terminates
   the access chain, and may be followed only by call suffixes —
   not by further dot/bracket access. *)

<UnaryExpr>       := NamedUnaryExpr | SymbolicUnaryExpr;

NamedUnaryExpr    := NamedUnaryOp _ BinaryAtom;
SymbolicUnaryExpr := (Qmark | Exmark) _ BinaryAtom;
```

## §9 Binary Expressions (Tier Ladder)

```ebnf
(* Tiered precedence ladder. Each tier has a hidden dispatcher and
   a visible iter form. The iter requires ≥1 operator at this level;
   on no-match the dispatcher falls through to the next tier. Pure
   atoms traverse all tiers and resolve at BinaryAtom — no spurious
   BinaryExpr wrappers.

   Each iter is `lhs (_ Op _ rhs)+`. AST construction left-folds
   the flat iteration into nested BinaryExpr nodes.
   `2 + 3 - 4` → BinaryExpr{-, BinaryExpr{+, 2, 3}, 4}.

   All iters are visible AST nodes. No `:as` on any tier —
   parenthesize.

   <BinaryAtom> does NOT include AsExpr. That is what enforces the
   rule that `:as` cannot attach as a tail on a binary operand —
   `x + y :as int` is a parse error rather than silently binding
   `:as` to `y`. To get a `:as`-annotated operand into a binary
   expression, use a paren-grouping variant (which DOES carry
   `:as` and also allows AsExpr inside).

   Flow tier extensions: LHS may be a CondClause (for `~each`-style
   range-as-conditional); RHS at ComprOp / PipelineOp may be a
   BlockExpr (defs-init + body) or a BareBlockExpr (bare body) —
   the implicit input (each comprehension item / pipeline topic)
   is the source the BlockExpr's defs-init binds from, and the
   BareBlockExpr arm handles the no-defs case. ComposeOp RHS
   admits no block arm — see the per-op RHS narrowing comment
   below. Other tiers allow none of these extensions. Semantic
   validity for non-`~each`/non-comprehension ops with these
   extensions is checked downstream. *)

<BinaryExpr>     := FlowDispatch;

<FlowDispatch>   := FlowBinExpr | OrDispatch;
(* Per-op RHS narrowing:
   - ComprOp and PipelineOp RHS receive an implicit input element
     (each comprehension item / pipeline topic). Both block arms
     are admitted: BlockExpr — defs-init `(...)` + body, with the
     lenient inner BlockDefsInitOptImplIn so destructure-no-init
     can bind from the implicit input — and BareBlockExpr for the
     no-defs case. See <FlowRHSImplIn>.
   - ComposeOp RHS receives a function value (compose lifts a chain
     of functions). There is no implicit element at compose, so a
     defs-init has no source to bind from, and a bare body without
     defs is not a function value. <FlowRHSStrict> therefore
     collapses to OrDispatch — no block arm at all. The compose
     operand must be a function-valued expression. *)

FlowBinExpr      := FlowLHS (_ FlowOpAndRHS)+;
<FlowOpAndRHS>   := (ComprOp     _ FlowRHSImplIn)
                  | (PipelineOp  _ FlowRHSImplIn)
                  | (ComposeOp   _ FlowRHSStrict);
<FlowRHSImplIn>  := BlockExpr | BareBlockExpr | OrDispatch;
<FlowRHSStrict>  := OrDispatch;
<FlowLHS>        := CondClause | OrDispatch;

<OrDispatch>     := OrBinExpr | AndDispatch;
OrBinExpr        := AndDispatch (_ OrOp _ AndDispatch)+;

<AndDispatch>    := AndBinExpr | CompareDispatch;
AndBinExpr       := CompareDispatch (_ AndOp _ CompareDispatch)+;

(* Compare tier has two iter forms:
   - TypeCompareBinExpr handles ?as/!as. RHS admits two shapes:
     BraceNarrowing (§16) for Effect-kind OR-union narrowing
     (`x ?as Effect.<Ask, Retry>`, spec §6.3.1's brace form at the
     standalone binary site); or NamedType for bare-or-dotted names
     including NativeType keywords like `int`/`bool`. PEG: try
     BraceNarrowing first, backtrack to NamedType on absence of
     `.<...>` suffix — same pattern as DoLoopComprLHS (§16) and
     DepCondBoolExpr's AsTypeOp arm (§14). Flat binary, non-iterated
     — `x ?as int ?as bool` requires parens, semantically unclear
     without them.
   - CompareBinExpr handles ?in/!in/?has/!has and all symbolic compare
     ops, with regular expression RHS and left-fold iteration.

   PEG ordering: TypeCompareBinExpr before CompareBinExpr — both open
   with AddDispatch; disjoint by operator value (?as/!as vs.
   ?in/!in/?has/!has/symbolic), so order is mechanical. *)

<CompareDispatch>  := TypeCompareBinExpr | CompareBinExpr | AddDispatch;
TypeCompareBinExpr := AddDispatch _ AsTypeOp _ (BraceNarrowing | NamedType);
CompareBinExpr     := AddDispatch (_ CompareOp _ AddDispatch)+;

<AddDispatch>    := AddBinExpr | MulDispatch;
AddBinExpr       := MulDispatch (_ AddOp _ MulDispatch)+;

<MulDispatch>    := MulBinExpr | BinaryAtom;
MulBinExpr       := BinaryAtom (_ MulOp _ BinaryAtom)+;

(* PEG: GroupedOpExpr before GroupedDoExpr — both open with OpenParen.
   GroupedOpExpr's inner OperandExpr is the common case (`(x + 1)`,
   `(x ~map f)`); GroupedDoExpr's inner DoComprExpr/DoLoopComprExpr
   is the niche case. Trying the common case first keeps the hot
   path cheap; on `(` followed by do-compr content, GroupedOpExpr
   fails through cleanly.

   <BinaryAtom> deliberately does NOT include AsExpr — see the
   `:as` Precedence section.

   LeadingRangeExpr / TrailingRangeExpr deliberately omitted — open-
   ended ranges have no value semantic at expression position; they
   are reachable only via <RangeExpr> inside DotBracketExpr (§6). *)
<BinaryAtom>     := ClosedRangeExpr | UnaryExpr | BareOperandExpr
                  | GroupedOpExpr | GroupedDoExpr;

(* GroupedDoExpr: parenthesized DoComprExpr/DoLoopComprExpr usable as a
   binary operand. Needed so flow-tier chains like
   `(range ~<* fn) ~map { ... }` and `(Foo ~<< { ... }) ~< g` parse —
   without this arm, a do-comprehension can never appear on the LHS
   of a comprehension/pipeline/compose operator because neither
   BareOperandExpr nor GroupedOpExpr (which wraps only OperandExpr =
   BinaryExpr) can reach the do-compr forms.

   Parens are mandatory: do-comprehensions don't appear bare as binary
   operands. Disjoint from GroupedOpExpr by inner content — PEG
   ordering in <BinaryAtom> tries GroupedOpExpr first; on inner
   content that isn't one of GroupedOpExpr's inner alts (DefFuncExpr,
   MatchExpr, AssignmentExpr, AsExpr, OperandExpr) — e.g. starts a
   DoComprExpr or DoLoopComprExpr — it fails through to GroupedDoExpr
   cleanly.

   AsExpr added to the inner so `(?x :as bool) ~<< { ... }`-style
   constructs are reachable inside the paren. Trailing `:as` allowed
   for consistency with the other parens; semantic validity (whether
   annotating a monadic do-result is meaningful) is checked downstream.

   PEG: AsExpr before DoComprExpr before DoLoopComprExpr — matches
   <Expr> ordering. Disjoint at the third token of `~<<` / `~<*`
   signatures. *)
GroupedDoExpr    := OpenParen _ (AsExpr | DoComprExpr | DoLoopComprExpr) _ CloseParen (_ AsAnnotationExpr)?;
```

**Precedence (tightest → loosest):** Unary → Mul (`*`, `/`) →
Add (`+`, `-`) → Compare/Membership/Type → And (`?and`, `!and`)
→ Or (`?or`, `!or`) → Flow (`+>`, `<+`, `#>`, all `~`-comprehensions,
`~<`). All tiers left-associative.

`:as` lives between Unary and Mul in the ladder — see the `:as`
Precedence section above.

Tier iter names: `FlowBinExpr`, `OrBinExpr`, `AndBinExpr`,
`TypeCompareBinExpr`, `CompareBinExpr`, `AddBinExpr`, `MulBinExpr`.
Each is a distinct visible AST node.

## §10 Operator Family

```ebnf
(* Op (used in OpFuncExpr) is the full union of operators —
   anything that can be quoted as a function value. *)

<Op>             := FlowOp | OrOp | AndOp | CompareOp | AsTypeOp | AddOp | MulOp | NamedUnaryOp | UnaryOpSym;

<FlowOp>         := ComprOp | PipelineOp | ComposeOp;
<ComprOp>        := Comprehension | (Tilde OpenAngle);
<PipelineOp>     := Hash CloseAngle;
<ComposeOp>      := (Plus CloseAngle) | (OpenAngle Plus);

<OrOp>           := "?or" | "!or";
<AndOp>          := "?and" | "!and";

<CompareOp>      := NamedCompareOp | SymbolicCompareOp;
<NamedCompareOp> := "?in" | "!in" | "?has" | "!has";
(* AsTypeOp is separate from CompareOp because its RHS is a NamedType,
   not a regular expression — handled by TypeCompareBinExpr at the
   Compare tier (§9). Listed in Op so `(?as)` / `(!as)` remain valid
   OpFuncExpr forms. *)
<AsTypeOp>       := "?as" | "!as";
<SymbolicCompareOp> := (Qmark | Exmark) ((OpenAngle Equal CloseAngle) | (OpenAngle Equal) | (CloseAngle Equal) | (OpenAngle CloseAngle) | Equal | OpenAngle | CloseAngle);

<AddOp>          := Plus | Hyphen;
<MulOp>          := Star | ForwardSlash;

<NamedUnaryOp>   := "?empty" | "!empty";
<UnaryOpSym> := Qmark | Exmark | SingleQuote | TriplePeriod | DoublePeriod | Period | Mountain | Valley | Percent | At;
```

PEG ordering note inside `<SymbolicCompareOp>`: longest sequence first
so `?<=>` matches before `?<=` / `?<>` / etc.

## §11 Block Expressions

```ebnf
(* Three block-related visible productions, with intentionally
   different reach.

   BareBlockExpr is the bare-body form: `{ stmts }` with no
   defs-init. It is reachable from <Expr> and <AsableExpr> (so
   `{ x; };` parses standalone and `{ x; } :as int` parses via
   AsExpr), from <FlowRHSImplIn> (the no-defs arm of compr /
   pipeline RHS), from FuncBodyPipeline (the no-defs arm of a
   pipeline-bodied function), and from MatchConsequent /
   MatchConsequentNoSemi (the bare-block arm of a match consequent
   — match consequents have no implicit input, so a defs-init
   would have no source).

   BlockExpr is the lenient defs-init form: `(defs) { stmts }`, with
   the defs-init container REQUIRED — not optional. The defs-init
   uses BlockDefsInitOptImplIn (lenient inner), so DestructureTarget
   entries may omit their init expression and bind from the enclosing
   context's implicit input. BlockExpr is reachable ONLY from
   implicit-input positions: <FlowRHSImplIn> (ComprOp / PipelineOp RHS)
   and FuncBodyPipeline (pipeline body of a function definition). It
   is NOT in <Expr>, NOT in <AsableExpr>, NOT at FuncBodyExpr /
   FuncBodyBlock / ComposeOp RHS.

   BlockExprStrict is the strict-optional defs-init form, with the
   same `(defs) { stmts }` surface but a stricter inner: it uses
   BlockDefsInitOpt, where Identifier entries may omit their init
   (implicit `: empty`) but DestructureTarget entries require their
   init explicitly. BlockExprStrict is a host-attached body form, not
   a general expression — it is admitted only at the colon-led body
   slots of GuardedExpr and MatchConsequent/MatchConsequentNoSemi.
   It is NOT an arm of <Expr>, so a free-standing `(defs) { body }`
   at a value-expression slot (e.g. a `def x:` initializer) is a
   parse error.

   DefBlockStmt is the named-binding statement form:
   `def (defs) { stmts };`. It uses BlockDefsInitOpt — the
   strict-optional inner form, where Identifier entries may omit
   their init (declared-uninitialized) but DestructureTarget
   entries require their init explicitly. There is no implicit
   input at a top-level `def (...)`; destructure-no-init at this
   position would have no source, so the grammar requires the
   `<...>: src` tail. `def (x) { ... };` parses;
   `def (<:a>) { ... };` is a parse error; `def (<:a>: src) { ... };`
   parses.

   VarDefInitOpt vs VarDefInitOptImplIn mirrors this fork at the
   entry level, carrying both a grammatical distinction (init
   requiredness) AND a sigil-semantic distinction (init form).

   VarDefInitOpt uses the bare `:` init sigil — unconditional
   binding — with Identifier-init optional and DestructureTarget-
   init required. Used at DefBlockStmt's BlockDefsInitOpt where
   no implicit source exists; the init expression, when present,
   evaluates and binds directly with no override decision.

   VarDefInitOptImplIn uses the `:?` init sigil — conditional
   override-on-empty — with both Identifier-init and
   DestructureTarget-init optional. Used at implicit-input sites:
   ParameterList (the positional argument is the source) and
   BlockDefsInitOptImplIn (via FlowRHSImplIn / FuncBodyPipeline,
   the comprehension element / pipeline topic / function arg is
   the source). When present, the init expression evaluates and
   overrides only when the implicit source at that entry is empty;
   for a non-empty source, the init is not evaluated. A no-init
   entry binds directly from the source.

   The two-token composite `:?` (Colon Qmark, no internal trivia)
   mirrors AssignmentExpr's `:=` convention — enforcement of
   adjacency lives at the parser layer, not the lexer.

   None of the three productions carries a `:as` tail. BareBlockExpr
   reaches `:as` only via AsExpr-wrap; BlockExpr has no annotation
   path at all (it isn't in <AsableExpr> and its reachable contexts
   aren't outer-expression slots); DefBlockStmt is a statement, not
   an expression. See the `:as` Precedence section. *)

BlockExpr               := BlockDefsInitOptImplIn _ BareBlockExpr;
BlockExprStrict         := BlockDefsInitOpt _ BareBlockExpr;
DefBlockStmt            := "def" _ BlockDefsInitOpt _ BareBlockExpr;
BareBlockExpr           := OpenBrace _ BlockStmts _ CloseBrace;
<BlockStmts>            := (StmtSemi _)* StmtSemiOpt?;

BlockDefsInitOpt        := OpenParen _ VarDefInitOptList _ CloseParen;
BlockDefsInitOptImplIn  := OpenParen _ VarDefInitOptImplInList _ CloseParen;

<VarDefInitOptList>        := (_ Comma)* (_ VarDefInitOpt       (_ Comma (_ VarDefInitOpt)?)*)?;
<VarDefInitOptImplInList>  := (_ Comma)* (_ VarDefInitOptImplIn (_ Comma (_ VarDefInitOptImplIn)?)*)?;

VarDefInitOpt           := (Identifier        (_ Colon _ ExprNoBlock)?)
                         | (DestructureTarget  _ Colon _ ExprNoBlock);          (* strict: bare `:` init (unconditional), required on DestructureTarget *)
VarDefInitOptImplIn     := (Identifier        (_ Colon Qmark _ ExprNoBlock)?)
                         | (DestructureTarget (_ Colon Qmark _ ExprNoBlock)?);  (* lenient: `:?` init (override-on-empty), optional on both arms *)
```

## §12 Assignment

```ebnf
(* LHS restricted to identifier with optional single-access. Excludes
   multi-pick assignment and pipeline-topic assignment. No :as tail —
   parenthesize. Value-producing (matching JS `x = 5` semantics), so
   reachable as a binary operand via the three operand-position
   paren-grouping productions in §5 — `10 + (x := 5)` parses. *)

AssignmentExpr        := ((IdentBase SingleAccessExpr) | Identifier) _ Colon Equal _ Expr;
```

## §13 Function Definitions

```ebnf
(* A declaration's container type is a cuddled DeclTypeClause (§4)
   on the introducing `defn`: `defn{Double} double(x) ^x * 2;`. It
   attaches identically at all three declaration forms in this
   section -- named, anonymous, and hook.

   There is no `:as` tail on a function declaration. A function
   VALUE is annotated by paren-wrapping, which reaches GroupedExpr's
   own (_ AsAnnotationExpr)? tail: `(defn(x) ^x) :as Foo`. *)

DefFuncExpr           := "defn" DeclTypeClause? (_ Identifier)?
                         (_ OpenParen _ (ParameterList | GatherParameter)? _ CloseParen)+
                         (_ FuncPrecondList)? (_ FuncOverClause)?
                         _ FuncBody;

(* DefHookDecl is statement-only — admitted from <Stmt> (§1), not
   from <Expr>. Anonymous hook declarations make no semantic sense
   (no namespace to attach to), so the name is required (no `?`
   on Identifier) and the form is unreachable at expression
   position. The marker declares which dispatch operator's hook is
   being installed on the named namespace:

   - `defn Foo@(...) ...`  installs the constructor hook on Foo,
     invoked by `Foo@` / `Foo@x` (AtCallExpr) and extracted by
     `Foo.@` (AtRefExpr).
   - `defn Foo%(...) ...`  installs the effect hook on Foo,
     invoked by `Foo%` / `Foo%env` when applied to an instance
     (EffectorCallExpr).
   - `defn Foo~map(...) ...` (and other single-token Comprehension
     markers: `~each`, `~filter`, `~fold`, `~foldR`, `~cata`, `~ap`,
     etc.) installs a comprehension hook on Foo, invoked by the
     corresponding comprehension operator at call sites.
   - `defn Foo~<(...) ...`  installs the bind (chain) hook on Foo,
     invoked by `~<` / `~chain` / `~bind` / `~flatMap` at call sites.
   - `defn Foo~<<(comp, ty) ...`  installs the do-comprehension
     override hook on Foo, invoked by `Foo ~<< {..}` do-blocks
     whose LHS is Foo. Calling convention `(comp, ty)` per
     Foi-Specification.md §3.1.1.3 and §3.10.9.4.
   - `defn Foo~<*(comp, ty) ...`  installs the looping-do override
     hook on Foo, invoked by `Foo ~<* (..) {..}` observer forms
     whose LHS is Foo. Same `(comp, ty)` calling convention per
     Foi-Specification.md §3.1.1.3.
   - `defn Foo+(a, b) ...`, `defn Foo-(a, b) ...`,
     `defn Foo*(a, b) ...`, `defn Foo/(a, b) ...` install arithmetic
     hooks on Foo, invoked when the LHS at a binary arithmetic
     call site is an instance of Foo (Foi-Specification.md §3.1.1.4).
   - `defn Foo?=(a, b) ...`  installs the equality hook on Foo,
     invoked when the LHS at a `?=` or `!=` call site is an
     instance of Foo. `!=` derives from `?=` via boolean negation;
     it cannot be independently attached.

   Non-canonical alias spellings for `~<` (`~chain`, `~bind`,
   `~flatMap`) parse at declaration position but are semantically
   rejected; the semantic checker directs the author to use `~<`.
   The `!=` marker (`Exmark Equal`) similarly parses at declaration
   position but is semantically rejected; the semantic checker
   directs the author to declare `?=` and let `!=` derive.

   Strict no-trivia between the hook name and the marker (including
   between a label segment and the marker, which mirrors `Foo@`
   adjacency at use sites). For the `Tilde OpenAngle` composite
   markers (`~<`, `~<<`, `~<*`) and the `Qmark Equal` / `Exmark Equal`
   composite markers (`?=`, `!=`), strict no-trivia within the
   composite as well (per the composite operators' adjacency rules
   at their respective use sites). Trivia is admitted between the
   marker and the first paren-set (mirrors normal `defn` paren
   spacing).

   The post-marker signature is identical to DefFuncExpr's — same
   paramSet+, optional precondition list, :over clause, and
   FuncBody alternatives. Grammar admits `paramSet+`; every
   marker family narrows it to exactly one parameter list with no
   gather at the semantic layer. Multi-tier (curried) hook
   declaration is rejected throughout: dispatch pins the outermost
   tier to the dispatch shape, leaving no static tier chain for
   `/\` / `\/` / precondition-hoisting to read. Per-family
   parameter counts:

   - `@`        — zero or one (Foi-Specification.md §3.1.1.1)
   - `%`        — one or two (§3.1.1.2)
   - `~<glyph>` — LHS instance, call-site operand(s), optional
                  trailing `ty` (§3.1.1.3)
   - `+ - * / ?=` — exactly two: LHS instance, RHS operand (§3.1.1.4)

   At most one hook of each kind per namespace per scope; multiple
   declarations of the same kind in one scope are not rejected at
   the grammar layer (transpiler emits last-wins; semantic checker
   enforces uniqueness). Comprehension-hook and operator-hook decls
   additionally require an accompanying declaration of the same
   identifier in the same scope -- `defn Name@(..)` or `deft Name`,
   not a `deft ... from ".."` reach (mirrors `%` hook requirement);
   rejection at semantic layer, not grammar. *)

(* Hook name: namespace, plus at most one optional label segment.
   The label is CONSTRUCTOR-ONLY discipline (Foi-Specification.md
   §3.1.1.1) — "alternate `+` for Foo" has no coherent reading,
   while "alternate constructor via a different input path" does.
   Grammar admits the label before any marker; rejection of
   label-with-non-`@` lives at the semantic layer, matching how
   alias markers (~chain/~bind) and hook-uniqueness are handled.
   A dotted name with NO marker tail falls through to DefFuncExpr
   and fails there — `defn Maybe.parse(..)` is not a declaration
   form.

   BuiltIn deliberately NOT admitted at either segment: user source
   may not declare hooks on built-in namespaces. Self-hosted stdlib
   definitions that do exactly that are runtime-bootstrap source,
   admitted by the compiler mode of Foi-Specification §10.1 -- not
   by this grammar. This is the one place DefHookName diverges from
   DefTypeName (§18), which admits BuiltIn at every segment. *)

DefHookName           := Identifier (Period Identifier)?;

DefHookDecl           := "defn" DeclTypeClause? _ DefHookName
                         ( At
                         | Percent
                         | Comprehension
                         | (Tilde OpenAngle OpenAngle)
                         | (Tilde OpenAngle Star)
                         | (Tilde OpenAngle)
                         | Plus
                         | Hyphen
                         | Star
                         | ForwardSlash
                         | (Qmark Equal)
                         | (Exmark Equal)
                         )
                         (_ OpenParen _ (ParameterList | GatherParameter)? _ CloseParen)+
                         (_ FuncPrecondList)? (_ FuncOverClause)?
                         _ FuncBody;

ParameterList         := VarDefInitOptImplIn (_ Comma _ VarDefInitOptImplIn)*;
GatherParameter       := Star Identifier;

<FuncPrecondList>     := FuncPrecond (_ FuncPrecond)*;
FuncPrecond           := CondClause _ Colon _ ExprNoBlock;
FuncOverClause        := ":over" _ OpenParen _ Identifier (_ Comma _ Identifier)* _ CloseParen;

<FuncBody>            := FuncBodyExpr | FuncBodyPipeline | FuncBodyBlock;

(* Visual-runway widening: the terse `^`-body form admits only
   expression forms whose leading tokens between `^` and any
   inner block delimiter provide unambiguous shape signal, or
   a `(...)`-wrapped escape hatch. Narrower than <ExprNoBlock>:
   DefFuncExpr, AssignmentExpr, GuardedExpr, AsExpr, and the
   entire FlowBinExpr tier (ComprOp / PipelineOp / ComposeOp
   chains) are NOT admitted directly — they either extend
   rightward without a visual close marker (chains, `:as` tails,
   assignment RHS), or resemble the block body form too closely
   (bare `^{...}` vs `defn f(x) { ... }`).
   Each rejected form paren-wraps through GroupedExpr:
   `^(x :as int)`, `^(?[c]: x)`, `^(x := 5)`, `^(defn(y)^y)`,
   `^(x ~map f)`, `^(x #> g)`, `^({x;})`. Match forms
   (`?{...}` / `?(x){...}`) are admitted directly — the `?`
   sigil is distinctive enough at terse position. Do-comprehensions
   (`~<<` / `~<*`) are admitted for the same reason: the operator
   itself lives between the `^` and the `{`. *)
FuncBodyExpr          := Caret _ (DoComprExpr | DoLoopComprExpr | MatchExpr | OrDispatch | GroupedExpr);

(* The leading `#>` is sugar: `defn foo(x) #> ...` is conceptually
   `defn foo(x) ^ x #> ...`. The function's first positional argument
   seeds the pipeline as the initial topic; the tail is the full
   FlowBinExpr chain — any mix of pipeline / comprehension / compose
   stages, no parenthesization required to switch ops mid-chain. *)
FuncBodyPipeline      := PipelineOp _ <FlowRHSImplIn> (_ <FlowOpAndRHS>)*;

FuncBodyBlock         := OpenBrace _ FuncBodyStmts _ CloseBrace;

<FuncBodyStmts>       := (FuncBodyStmtSemi _)* FuncBodyStmtSemiOpt?;
FuncBodyStmtSemi      := FuncBodyStmt (_ Semicolon)+;
FuncBodyStmtSemiOpt   := FuncBodyStmt (_ Semicolon)*;
<FuncBodyStmt>        := ReturnExpr | Stmt;
ReturnExpr            := Caret _ Expr;
```

PEG ordering notes for `FuncBodyExpr`'s inner (the five arms of
`DoComprExpr | DoLoopComprExpr | MatchExpr | OrDispatch | GroupedExpr`):

- `DoComprExpr` and `DoLoopComprExpr` first — both start with a
  `DoComprLHSName` (bare or dotted Identifier/BuiltIn) and require
  a distinctive third-token operator sequence (`~<<` / `~<*`)
  after the LHS. On `~<<`/`~<*` absence they backtrack cleanly to
  `OrDispatch`, and memoization on `DoComprLHSName` keeps the
  retry cheap. `DoLoopComprExpr`'s `BraceNarrowing` LHS
  (`Effect.<A, B>`) is reached through the shared `DoLoopComprLHS`
  production per §16.
- `MatchExpr` third — opens with `?{` (`IndepMatchExpr`) or `?(`
  (`DepMatchExpr`). Disjoint from the two do-compr openers
  (Identifier/BuiltIn) and from every `OrDispatch` tier-ladder
  arm (`BinaryAtom` rejects both match forms). Exmark-prefixed
  `!{...}` / `!(x){...}` are not admitted — `MatchExpr`'s grammar
  requires a `Qmark` opener; the Exmark forms remain parse errors
  by the same fall-through path they take everywhere else.
- `OrDispatch` next — the tier ladder from Or downward (Or → And
  → Compare → Add → Mul → Unary → BinaryAtom). Deliberately
  narrower than `<ExprNoBlock>`: `DefFuncExpr`, `AssignmentExpr`,
  `GuardedExpr`, `AsExpr`, and the entire `FlowBinExpr` tier
  (ComprOp / PipelineOp / ComposeOp chains) are NOT reachable
  through the ladder. All admit through `GroupedExpr`'s inner
  `Expr` when paren-wrapped.
- `GroupedExpr` last — the `(...)`-wrapped escape hatch, admitting
  full `Expr` inside. Every form the widening leaves out —
  arbitrary Flow-tier chains, `:as`-tailed inners, `?[c]: body`
  guarded expressions, assignment, inner `defn`, `BareBlockExpr`
  — reaches this position via the paren-wrap.

The `^x + y * z`, `^foo.bar(baz)`, `^x ?= 42`, `^!x`, `^42`,
`^"hello"`, `^Foo@x`, `^< a, b, c >` idioms all parse via
`OrDispatch` — the tight algebraic and access forms remain
concise. Chain-of-`~map` bodies, `:as`-annotated returns, and
inner function definitions require paren-wrap: `^(x ~map f)`,
`^(x :as int)`, `^(defn(y)^y)`. This is the visual-runway
principle in effect — the paren mark forces the reader's eye to
close-brace the body scope explicitly at forms that would
otherwise extend rightward past the terse marker.

PEG ordering notes for `FuncBodyPipeline`'s body (the three arms
of `<FlowRHSImplIn>`):

- `BlockExpr` first so `#> (x){y;}` parses as a BlockExpr
  (bare-identifier def `x`, body `{y;}`) rather than the `OrDispatch`
  fall-through eating `(x)` as a `GroupedExprNoBlock` and leaving
  `{y;}` dangling. BlockExpr at this position uses
  `BlockDefsInitOptImplIn` (the lenient inner form) — the function's
  positional argument is the implicit input that destructure-no-init
  binds from, so `defn f(x) #> (<:a, :b>) { ... };` parses with
  `<:a, :b>` destructuring from `x`.
- `BareBlockExpr` next handles the no-defs case `#> { y; }`.
  Disjoint from `BlockExpr` (which requires a `(...)` prefix) and
  from `OrDispatch` (whose tier ladder bottoms out at `BinaryAtom`,
  none of whose arms open with `{`).
- `OrDispatch` last carries every non-block body form via the
  precedence ladder (Or → And → Compare → Add → Mul → Unary →
  BinaryAtom). This is intentionally narrower than `<ExprNoBlock>`:
  bare `DefFuncExpr`, `MatchExpr`, `AssignmentExpr`, and `AsExpr`
  are NOT reachable through the tier ladder, so pipeline bodies
  like `#> defn(x)^x+1` or `#> ?{ ... }` are parse errors. To use
  any of those at pipeline body position, paren-wrap to reach the
  operand-position widenings in `GroupedOpExpr` / `GroupedBareOpExpr`
  / `GroupedBareOpExprNoEmpty`: `#> (defn(x)^x+1)`,
  `#> (?{ [c]: f; ?: g })`, `#> (x := 5)`. Do-comprehensions reach
  this position via `BinaryAtom`'s `GroupedDoExpr` arm —
  `#> (Foo ~<< {...})` parses through that path.

Same three-arm shape as `<FlowRHSImplIn>` in §9.

DefFuncExpr shaper-shape notes:
- `over` is always the full FuncOverClause node (carries `.names`
  plus parens, commas, and any internal trivia in `.delims`). Not
  folded — the structural punctuation around `:over(...)` would
  otherwise be lost.

## §14 Conditionals / Guards

```ebnf
(* GuardedExpr loses its own `(_ AsAnnotationExpr)?` — annotation
   comes via AsExpr (§5), whose AsableExpr inner list includes
   GuardedExpr. *)

CondClause            := (Qmark | Exmark) BracketExpr;
GuardedExpr           := CondClause _ Colon _ (BlockExprStrict | Expr);
```

## §15 Match Expressions

```ebnf
<MatchExpr>            := IndepMatchExpr | DepMatchExpr;

IndepMatchExpr         := Qmark OpenBrace _ IndepMatchStmts _ CloseBrace;
<IndepMatchStmts>      := ((IndepPatternStmt _)+ (ElseStmt | IndepPatternStmtNoSemi)?)
                        | IndepPatternStmtNoSemi
                        | ElseStmt;
IndepPatternStmt       := IndepCondClause _ MatchConsequent (_ Semicolon)*;
IndepPatternStmtNoSemi := IndepCondClause _ MatchConsequentNoSemi;
<IndepCondClause>      := (Qmark | Exmark)? BracketExpr;

DepMatchExpr           := Qmark OpenParen _ ExprNoBlock _ CloseParen OpenBrace _ DepMatchStmts _ CloseBrace;
<DepMatchStmts>        := ((DepPatternStmt _)+ (ElseStmt | DepPatternStmtNoSemi)?)
                        | DepPatternStmtNoSemi
                        | ElseStmt;
DepPatternStmt         := DepCondClause _ MatchConsequent (_ Semicolon)*;
DepPatternStmtNoSemi   := DepCondClause _ MatchConsequentNoSemi;
DepCondClause          := (Qmark | Exmark)? OpenBracket _ DepCondExprList _ CloseBracket;
<DepCondExprList>      := DepCondExprAtom (_ Comma _ DepCondExprAtom)* (_ Comma)?;
<DepCondExprAtom>      := DepCondBoolExpr | ExprNoBlock;
DepCondBoolExpr        := AsTypeOp _ (BraceNarrowing | NamedType)
                        | DepCondBoolOp _ CompareDispatch
                        | NamedUnaryOp
                        | OpenParen _ DepCondBoolExpr _ CloseParen;
<DepCondBoolOp>        := CompareOp | AndOp | OrOp;

ElseStmt               := Qmark? MatchConsequentNoSemi (_ Semicolon)*;
<MatchConsequent>      := Colon _ (BlockExprStrict | Expr) _ Semicolon;
<MatchConsequentNoSemi>:= Colon _ (BlockExprStrict | Expr);
```

`IndepPatternStmt` / `IndepPatternStmtNoSemi` and
`DepPatternStmt` / `DepPatternStmtNoSemi` are distinct visible AST
nodes. The `NoSemi` variant differs only in trailing-semicolon
handling for the final clause; downstream code treats them
uniformly.

Note: `DepCondBoolExpr`'s `NamedUnaryOp` arm is bare — a single
`?empty` / `!empty` token with no written operand. The topic supplies
the operand implicitly (extending the "topic is implicit LHS"
principle from the operator-led arm to the unary case). No `:as` tail
reachability here either; annotate at the DepCondClause level via the
paren-recursive arm if needed.

Note: `DepCondBoolExpr`'s `AsTypeOp` arm admits both `BraceNarrowing`
and `NamedType` on the RHS. `[?as Effect.<Ask, Retry>]:` applies the
OR-union prefix-match at match-arm patterns (spec §6.3.1's brace form
cross-used at `?as` arm patterns); `[?as int]:` and `[?as Effect.Ask]:`
apply the bare/dotted single-name form. PEG: BraceNarrowing first,
backtrack to NamedType on absence of `.<...>` — same pattern as
TypeCompareBinExpr (§9) and DoLoopComprLHS (§16).

Note: `<MatchConsequent>` and `<MatchConsequentNoSemi>` are colon-led
uniformly with §4 guard consequents (`GuardedExpr`) and §3.5
preconditions — every position where a CondClause / DepCondClause
attaches a consequent requires the leading `:`. The consequent slot
admits `BlockExprStrict` (host-attached def-block; strict-optional
inner because there is no implicit input source at this position) or
any `Expr` (which reaches `BareBlockExpr` through `<AsableExpr>` for
the bare `{ stmts }` consequent form). To bind names locally inside
a match consequent, use a `def` statement inside the bare-block body,
or use the def-block form directly.

## §16 Do-Comprehensions

```ebnf
<DoComprLHS>            := DoComprLHSCompound | DoComprLHSName;
DoComprLHSName          := (Identifier | BuiltIn) (Period (Identifier | BuiltIn))*;
DoComprLHSCompound      := DoComprLHSName OpenBrace _ DoComprLHSArg _ CloseBrace;
<DoComprLHSArg>         := DoComprLHSCompound | DoComprLHSName;

<DoLoopComprLHS>        := BraceNarrowing | DoComprLHSName;
BraceNarrowing          := DoComprLHSName Period OpenAngle _ DoComprLHSName (_ Comma _ DoComprLHSName)* (_ Comma)? _ CloseAngle;

DoComprExpr             := DoComprLHS _ Tilde OpenAngle OpenAngle _ DoBlockExpr;

DoBlockExpr             := DoBlockDefsInitOpt? _ DoBareBlockExpr;
<DoBareBlockExpr>       := OpenBrace _ DoBlockStmts _ CloseBrace;
<DoBlockStmts>          := (DoStmtSemi _)* (DoFinalUnwrapExpr | DoStmtSemiOpt)?;
DoBlockDefsInitOpt      := OpenParen _ DoVarDefInitOptList _ CloseParen;

<DoVarDefInitOptList>   := (_ Comma)* (_ DoVarDefInitOpt (_ Comma (_ DoVarDefInitOpt)?)*)?;
DoVarDefInitOpt         := (Identifier        (_ (DoubleColon | Colon) _ ExprNoBlock)?)
                         | (DestructureTarget (_ (DoubleColon | Colon) _ ExprNoBlock)?);

DoDefVarStmt            := "def" _ (Identifier | DestructureTarget) _ DoubleColon _ Expr;
DoNonReceivingBindStmt  := Dollar _ ExprNoBlock;
<DoStmt>                := DoDefVarStmt | DoNonReceivingBindStmt | Stmt;
DoStmtSemi              := DoStmt? (_ Semicolon)+;
DoStmtSemiOpt           := DoStmt? (_ Semicolon)*;
DoFinalUnwrapExpr       := Dollar _ ExprNoBlock (_ Semicolon)*;

DoLoopComprExpr         := DoLoopComprLHS _ Tilde OpenAngle Star _ DoBlockExpr;
```

Note: `DoComprExpr` and `DoLoopComprExpr` share the RHS shape
(`DoBlockExpr` — an optional defs-init followed by a block body) and
differ on the LHS. `<DoComprLHS>` admits a bare-or-dotted name or a
compound form (`List{Promise}`); `<DoLoopComprLHS>` admits a
bare-or-dotted name or the brace-narrowing form
(`Effect.<Ask, Retry>`).

Note: `DoComprLHSCompound` cuddles its brace to the name — no `_`
before `OpenBrace` — and recurses on itself through
`<DoComprLHSArg>`, so `List{List{Promise}}` parses. PEG: the
compound arm precedes the bare arm in `<DoComprLHS>`; both open with
`DoComprLHSName`, and the compound arm requires the cuddled brace to
follow, so `List ~<< {..}` backtracks cleanly to the bare arm. The
recursive reference sits after a non-nullable `DoComprLHSName`, so
no left-recursion arises.

The recursion's base is `DoComprLHSName`, whose alphabet excludes
`NativeType` — the argument position names a namespace, so
`List{int}` is a parse error at both segments for the same reason
the outer position rejects it.

`DoComprLHSCompound` is not an arm of `<DoLoopComprLHS>`. Per §6
opener, compound LHS is not admitted on `~<*`: the
observer-of-emissions form has no auto-lift semantics.

Note: `BraceNarrowing` is a shared production referenced at three
sites, all OR-semantic ("any of these prefix subtrees"):

  - §9  `TypeCompareBinExpr` RHS       — `x ?as Effect.<Ask, Retry>`
  - §14 `DepCondBoolExpr` AsTypeOp arm — `[?as Effect.<Ask, Retry>]:`
  - §16 `DoLoopComprLHS`               — `Effect.<Ask, Retry> ~<*`

It is NOT referenced at `EffectsClause` (§13). `:Effects(...)` carries
AND semantics (function declares it performs every listed effect);
brace narrowing carries OR semantics (handler catches any of the
listed subtrees). Different semantic roles ⇒ different grammatical
treatment; the two lists share no production. Spec §6.3.1's
"Cross-uses" prose (mentioning `:Effects(...)` as a third brace site)
is overreach — grammar deliberately keeps them separate.

Reserved-root rejection (`Effect.Host.*`, `Effect.User.Slot.*`,
`Effect.Sys.*` at declaration sites, bare `Effect.<User|Host|Sys>`)
and Implicit-User rewrite (`Effect.<X>` → `Effect.User.<X>` where `X`
is not a reserved root) apply uniformly at all three sites at the
semantic layer, not grammar. Grammar stays permissive; semantic
checker enforces (§6.1.4). They differ only in the operator (`~<<`
vs `~<*`). Per §6 opener's composition-axis framing, type-LHS is
mandatory on both operators: the dispatch to a specific hook resolves
at compile time.

`~<*` no longer admits a value-LHS with a fn-RHS iter form (e.g.,
`xs ~<* fn`). Iterable drainage over `List`, `Iter`, and `PullStream`
moved to `~<<` under Slot 15's axis lock; `~<*` retains only its
producer-broadcast admissions (`Channel`, `PushStream`, and effect
handler scopes) — all of which supply the source through the
DoBlockDefsInit clause (e.g., `Channel ~<* (v:: ch) { ... }`).

## §17 Data Structure Literals

```ebnf
(* Neither RecordTupleLit nor SetLit carries its own `(_ AsAnnotationExpr)?`.
   Annotation comes via AsExpr (§5) — since DataStructLit is reachable
   from BareOperandExprNoEmpty, an AsExpr wrapping `<lit> :as T` works
   at any outer-position expression slot.

   RecordTupleValue is a hand-listed operand alphabet parallel to
   <BareOperandExprNoEmpty> (§5), NOT a reach into it. Any new
   operand form admitted at outer-position expression slots must
   be added HERE TOO or it silently fails inside structure
   literals — entries reach RecordTupleValue directly, never
   through the §5 chain. SetEntry inherits from this production,
   so sets follow automatically.

   RecordTupleValue gains AsExpr as its first alternative so that
   `<x :as int, y>` continues to parse — without it, leaves inside
   record/tuple entries would lose access to `:as`. *)

<DataStructLit>        := SetLit | RecordTupleLit;     (* SetLit first — opens with OpenAngle OpenBracket (2 tokens); RecordTupleLit opens with just OpenAngle (1 token) *)

RecordTupleLit         := OpenAngle _ RecordTupleEntryList _ CloseAngle;
<RecordTupleEntryList> := (_ Comma)* (_ RecordTupleEntry (_ Comma (_ RecordTupleEntry)?)*)?;
<RecordTupleEntry>     := PickValue | RecordProperty | RecordTupleValue;

RecordTupleValue       := AsExpr | UnaryExpr | CallExpr | ThunkExpr
                        | EmptyLit | BooleanLit | NumberLit | StringLit
                        | DataStructLit | BareIdentifier | OpFuncExpr
                        | (OpenParen _ Expr _ CloseParen);

PickValue              := Ampersand IdentBase MultiAccessExpr?;
<RecordProperty>       := ConcisePropDef | ExplicitPropDef;
ConcisePropDef         := Colon PropertyExpr;
ExplicitPropDef        := (ComputedPropName | PropertyExpr) _ Colon _ RecordTupleValue;

(* ComputedPropName — narrowed alphabet, two arms.

   The bare arm admits only leaf-shaped values and a flat
   identifier-access chain: anything that reads unambiguously
   as a computed key expression without paren disambiguation.
   The paren-wrap arm admits the full binary expression ladder
   via OperandExpr — arithmetic, comparison, logical, flow,
   chain/at/postfix forms, etc.

   What's NOT admitted at the bare arm (must paren-wrap):
   - Call/at/partial-call suffixes (`%foo(x)`, `%foo@x`, `%foo|x|`)
   - Postfix modifiers (`%foo'`, `%foo/\`, `%foo\/`)
   - Pick chain segs (`%foo.<a,b>`)
   - Range chain segs (`%foo.[1..3]`)
   - Bare `@` (IdentityFunc), bare `None@`, etc.

   What's NEVER admitted (rejected even paren-wrapped):
   - `:as` annotations (no OptAsAnnotation tail on
     ComputedPropParenExpr; AsExpr not in inner OperandExpr).
     `%(x) :as int` and `%(x :as int)` are both parse errors.
   - `:=` assignment (AssignmentExpr not in OperandExpr inner)
   - `defn` / match expressions (not in OperandExpr inner)
   - `defs`-block bodies (BareBlockExpr not in OperandExpr inner)
   - DataStructLit at the bare top level (`%<x: 1>` — the `:`
     visually collides with the outer ExplicitPropDef separator;
     paren-wrap admits via the OperandExpr → BareOperandExpr →
     BareOperandExprNoEmpty → DataStructLit path)
   - EmptyLit (`%empty` — no storage slot for missing value)

   The numeric bare arm <ComputedPropNumberLit> admits NumberLit
   (§2) minus unicode (`\u<hex>`), a character escape rather than a
   numeric literal. Both signs and both shapes (integer/decimal)
   admitted; PropertyExpr's positive-only narrowness doesn't apply
   here since computed keys aren't dual-purposed as positional index
   lookups. See the <ComputedPropNumberLit> production block below
   for the full per-arm breakdown.

   AnglePickEntry (§6) shares this ComputedPropName, so the
   same alphabet applies in pick context: `.<%(a + b)>` and
   `.<%foo.bar.baz>` are legal; `.<%foo@x>` requires `.<%(foo@x)>`.

   Synthesized as a ComputedPropName AST node by ExplicitPropDef
   and DotAngleExpr (PickComputed in pick context). The bare-arm
   numeric-literal forms synthesize an inner NumberLit from raw
   tokens (same shapePropertyExpr pattern as PropertyExpr's
   integer arm); other bare arms and the paren-wrap arm yield
   their inner node directly. *)

<ComputedPropName>       := Percent (<ComputedPropBare> | ComputedPropParenExpr);

<ComputedPropBare>       := BooleanLit | StringLit | <ComputedPropNumberLit> | ComputedPropAccessChain;

(* <ComputedPropNumberLit>: numeric-literal alphabet at the computed-
   key bare arm. Admits every NumberLit shape except unicode
   (`\u<hex>`), a character escape rather than a numeric literal,
   narrowed at value position to InterpExpr-slot only.

   Both signs and both shapes (integer/decimal) admitted:
     - Bare integers via PositiveIntLit / NegativeIntegerLit (their
       token types win in lex PEG order over bare Number's integer
       sub-arm).
     - Bare decimals (`3.14`, `-3.14`) via the bare Number arm —
       BareNumber's decimal sub-arm emits Number.
     - The EscapePlain + Number arm covers signed separator-bearing
       integers (`\-1_000`) and separator-bearing decimals
       (`\100_000.25`) — both BareNumber sub-arms. The unsigned
       integer form `\1_000` is covered separately by PositiveIntLit's
       EscapePlain-paired arm.
     - Typed-radix (`\hFF` / `\h-FF`, `\o73` / `\o-755`, `\b1010` /
       `\b-1100`) — signs handled inside HexNumber/OctalNumber/
       BinaryNumber per the lex layer. These three have no decimal
       sub-arms per Lexical-Grammar.md, so their Number tokens are
       integer-shaped by lex contract.

   PropertyExpr's positive-integer-only narrowness doesn't apply
   here — computed keys aren't dual-purposed as positional index
   lookups, so admitting both signs and both shapes is uniform. *)
<ComputedPropNumberLit> := PositiveIntLit
                         | NegativeIntegerLit
                         | Number
                         | (EscapeHex Number)
                         | (EscapeOctal Number)
                         | (EscapeBinary Number)
                         | (EscapePlain Number);

(* ComputedPropAccessChain: flat IdentBase + dot/bracket access
   chain. Excludes DotBracketExpr (range), DotAngleExpr (pick),
   call suffixes, at-tails, and postfix modifiers. Bare IdentBase
   (zero segs) folds to just the IdentBase node; segs fold
   left-to-right via the same applyChainSeg helper ChainExpr uses,
   producing the same MemberAccessExpr / IndexAccessExpr nesting. *)
ComputedPropAccessChain  := IdentBase (DotIdentifier | BracketExpr)*;

(* ComputedPropParenExpr: paren-wrap arm. Inner is OperandExpr —
   the binary expression ladder (FlowDispatch). NO trailing
   (_ AsAnnotationExpr)? — `:as` on a computed key collides
   visually with the outer ExplicitPropDef Colon and has no
   semantic use case. Differs from §5's six paren-grouping
   productions in this respect.

   Unwrap-shaper — returns the inner OperandExpr node directly,
   lifting OpenParen/CloseParen onto its delims in source-position
   order (same pattern as RecordTupleValue and GroupedTypeExpr). *)
ComputedPropParenExpr    := OpenParen _ OperandExpr _ CloseParen;

SetLit                 := OpenAngle OpenBracket _ SetEntryList _ CloseBracket CloseAngle;
<SetEntryList>         := (_ Comma)* (_ SetEntry (_ Comma (_ SetEntry)?)*)?;
<SetEntry>             := PickValue | RecordTupleValue;
```

**Composition principle for `RecordTupleValue`'s bare arms**: forms
that already compose at this position via `CallExpr`'s `ChainBase`
surface — i.e., their `X(args)` / `X@ v` / `X.<a,b>` call/access
form parses bare here — also admit as bare values. `UnaryExpr` and
`OpFuncExpr` both satisfy this: `(+)(1,2,3)` reaches
`RecordTupleValue` via `CallExpr` (`ChainBase` = `OpFuncExpr` +
`PrefixCallSuffix`), so bare `(+)` also admits; `<AsableExpr>`
already reaches `UnaryExpr` via `AsExpr`'s `:as`-required tail, so
bare `!x` / `?x` follows the same pattern without the tail. Both
are one-sigil or paren-wrapped-operator shapes with no visual noise
inside `<...>` delimiters. The remaining `ChainBase` alternatives
(`DefFuncExpr`, `MatchExpr`, `GuardedExpr`, `AssignmentExpr`) don't
cross this bar — they create real visual chaos at property-value
position and remain paren-wrap-only.

PEG ordering note for `RecordTupleValue`: `AsExpr` first — longer
match with `:as` tail. Falls through to `UnaryExpr` and the rest on
no `:as`. `UnaryExpr` before `CallExpr` — `?`/`!` openers disjoint
from `CallExpr`'s `IdentBase` opener. `CallExpr` before
`BareIdentifier` so `foo.bar` parses as a chain. `DataStructLit`
before `BareIdentifier` (disjoint openers). `OpFuncExpr` after
`BareIdentifier`, before the paren-wrap arm — both open with `(`;
`OpFuncExpr`'s narrow inner (Op / DotAngle / DotBracket / `[]`)
fails through cleanly to the paren-wrap `(Expr)` arm on non-matching
inner content. Same PEG discipline as `ChainBase`.

The paren-wrap arm's inner is `Expr` (matching `GroupedExpr`'s
precedent), not recursive `RecordTupleValue`. Bare arms stay narrow
(visual clarity inside `<...>` separators); parens earn the right
to admit broad expressions. Forms admitted only via paren-wrap:
`DefFuncExpr`, `MatchExpr`, `AssignmentExpr`, `BareBlockExpr`,
`DoComprExpr`, `DoLoopComprExpr`, the full binary ladder (including
pipelines, comprehensions, arithmetic, and comparison):
`<foo: (1 + 2)>`, `<foo: (defn()^42)>`, `<foo: (x #> f)>`,
`<foo: (?{...})>`, `<foo: (IO ~<< {x;})>` all parse. `SetEntry`
inherits both the bare-arm widening and paren-wrap widening via
its `RecordTupleValue` arm — `<[!x, (+)]>` and
`<[(defn()^42), (x #> f)]>` both admit.

`RecordTupleValue` is visible but UNWRAPS in its shaper — returns
the inner node directly, lifting wrapper parens (from the paren-
recursive arm) onto the inner node's `delims` in source-position
order. AST surface is identical to a hidden-production version for
non-paren entries; paren-wrapped entries gain their parens at entry
granularity rather than at the enclosing literal level. Same
unwrap-shaper pattern as `AsExpr` (§5) and `DepCondBoolExpr` arm-3
(§15).

## §18 Type Definitions

```ebnf
(* Type sub-grammar. Used by:
   - DefTypeStmt (§1) for the body of `deft Name <type>` — accepts the
     full TypeExpr (union, no-union, or function).
   - AsAnnotationExpr (§5) for the type after `:as` — accepts only a
     bare NamedType (matches Foi-Guide usage: `:as int`, `:as Foo`).

   Type forms do NOT carry trailing :as — they are types, not values.
   Grammar permissive; semantic validation in interp (e.g., interp
   strings in type position, `int :as bool` chains, etc.).

   Brace-grouping rule: `{...}` appears in type expressions only where
   syntactically required: the position immediately after a `?`, `*`,
   `*:`, or `^` modifier when the inner type is a union or function.
   Bare types are required everywhere else — decorative bracing of a
   non-union, non-function type in those non-modifier positions is a
   parse error. (A narrow leakage: `(?{int})`, `(*{int})`, and `^{int}`
   technically parse because the modifier-position arms accept
   GroupedTypeExpr broadly; the strict reading is "don't brace a
   non-union/non-function" — this is conventionally discouraged but
   not grammar-rejected.) *)

DefTypeStmt           := "deft" _ DefTypeName _ ( (NamedType _ DefTypeFrom)
                                                | DefTypeFrom
                                                | TypeExpr );
DefTypeName           := (Identifier | BuiltIn) (Period (Identifier | BuiltIn))*;
DefTypeFrom           := "from" _ PlainStr;

(* `from` is a CONTEXTUAL keyword — matched as an identifier of that
   spelling at this one position, and deliberately NOT a member of the
   reserved KEYWORDS set. `def from: 5;` still declares an ordinary
   binding.

   The two `from`-bearing arms precede TypeExpr in the ordered choice.
   NamedType is reachable from TypeExpr (via NoUnionTypeExpr), so with
   TypeExpr first, `deft Coord Point from "./g.foi";` would commit
   `Point` to the TypeExpr arm and leave the `from` tail dangling at
   the statement terminator.

   DefTypeFrom takes PlainStr, matching ImportExpr (§3): a specifier is
   never computable.

   DefTypeName already admits BuiltIn at every segment, so
   `deft List from "foi:Std";` needs no provision at the name position.
   Consequence at arm 3, worth pinning: DefTypeName consumes greedily,
   so `deft from "./g.foi";` declares a type NAMED `from` whose
   declaration is the string-literal type — arm 2 cannot match, since
   the `from` token is already consumed by the name. *)

<TypeExpr>            := FuncTypeExpr | NoFuncTypeExpr;

<NoFuncTypeExpr>      := UnionTypeExpr | NoUnionTypeExpr;
UnionTypeExpr         := NoUnionTypeExpr (_ Pipe _ NoUnionTypeExpr)+;

<NoUnionTypeExpr>     := NamedType
                       | EmptyLit | PlainStr | NumberLit | BooleanLit
                       | DataStructTypeExpr;

NamedType             := ((Identifier | BuiltIn) (Period (Identifier | BuiltIn))*)
                       | NativeType;
<NativeType>          := "int" | "float" | "bool" | "string" | "Any";

GroupedTypeExpr       := OpenBrace _ (FuncTypeExpr | UnionTypeExpr (_ Pipe)?
                                    | NoUnionTypeExpr) _ CloseBrace;

DataStructTypeExpr    := OpenAngle _ DataStructTypeList? _ (Comma _)? CloseAngle;
<DataStructTypeList>  := (DataStructTypeEntry (_ Comma _ DataStructTypeEntry)* (_ Comma _ DataStructFinalValType)?)
                       | DataStructFinalValType;
<DataStructTypeEntry> := DataStructFieldType | DataStructValueType;
<DataStructValueType> := NoFuncTypeExpr;
DataStructFieldType   := Identifier _ Colon _ DataStructValueType;
DataStructFinalValType:= Star Colon? (NoUnionTypeExpr | GroupedTypeExpr);

FuncTypeExpr          := OpenParen _ FuncTypeArgList? _ (Comma _)? CloseParen _ (EffectsClause _)? Caret _ Qmark? _ (NoUnionTypeExpr | GroupedTypeExpr);
<FuncTypeArgList>     := (FuncTypeArg (_ Comma _ FuncTypeArg)* (_ Comma _ FuncTypeFinalArg)?)
                       | FuncTypeFinalArg;
FuncTypeArg           := Qmark? (NoUnionTypeExpr | GroupedTypeExpr);
FuncTypeFinalArg      := (Star (NoUnionTypeExpr | GroupedTypeExpr)) | FuncTypeArg;
EffectsClause         := ":Effects" _ OpenParen _ NamedType (_ Comma _ NamedType)* (_ Comma)? _ CloseParen;
```

## License

[![License](https://img.shields.io/badge/license-MIT-a1356a)](LICENSE.txt)

All code and documentation are (c) 2022-2026 Kyle Simpson and released under the [MIT License](http://getify.mit-license.org/). A copy of the MIT License [is also included](LICENSE.txt).
