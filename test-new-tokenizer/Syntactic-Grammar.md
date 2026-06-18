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
    `"export"`, `":as"`, `":over"`, `"int"`, `"integer"`,
    `"float"`, `"bool"`, `"boolean"`, `"string"`
  - `Native` values: `"true"`, `"false"`, `"empty"`
  - `Builtin` values: `"Id"`, `"None"`, `"Maybe"`, `"Left"`, `"Right"`,
  `"Either"`, `"Promise"`, `"PromiseSubject"`, `"PushStream"`,
  `"PushSubject"`, `"PullStream"`, `"PullSubject"`, `"Channel"`,
  `"Gen"`, `"IO"`, `"Value"`, `"Number"`, `"List"`
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
`OpenAngle Plus`, `$+` is `Dollar Plus`, `~<` is `Tilde OpenAngle`.
Pre-tokenized multi-char operators — `DoubleColon` (`::`),
`DoublePeriod` (`..`), `TriplePeriod` (`...`) — are referenced by
their production names directly.

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
`SetLit`, the three `IdentifierExpr` arms, `OpFuncExpr`.

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

<Stmt>              := DefBlockStmt | DefVarStmt | DefTypeStmt | Expr;
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
   the lex's hidden <EscapedNumber> dispatcher matches. The lex
   dispatcher emits two distinct token pairings depending on which
   arm matched: five of its six arms produce Escape + Number
   (Hex/Unicode/Octal/Binary/Monadic, plus EscapePlain's BareNumber
   inner — all aliases for the Number token type per
   Lexical-Grammar.md Notes 5/7); the sixth (EscapePlain paired with
   PositiveIntegerLitWithSep) produces Escape + PositiveIntegerLit
   (alias pattern per Note 6; this routing keeps the same token type
   feeding <PositiveIntLit> at PropertyExpr-key positions). The syn
   admits both pairings so unsigned separator-bearing integers like
   `\5_000` parse at value position, not only at PropertyExpr-key
   position.

   Integer-only contexts maintain their own narrower reach —
   DotIdentifier admits bare IntegerLit only (no escape forms);
   <PositiveIntLit> in PropertyExpr admits bare PositiveIntegerLit
   plus the escape-paired form, but no signs. *)
NumberLit          := EscapedNumberLit | Number | IntegerLit;
<EscapedNumberLit> := Escape (Number | PositiveIntegerLit);

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

InterpExpr         := Backtick _ Expr _ Backtick;
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
DefVarStmt            := "def" _ (Identifier | DestructureTarget) _ Colon _ (Expr | ImportExpr);

DestructureTarget     := OpenAngle _ DestructureDefList _ CloseAngle;
<DestructureDefList>  := DestructureDef (_ Comma _ DestructureDef)* (_ Comma)?;
<DestructureDef>      := DestructureNamedDef | DestructureConciseDef | DestructureCapture;
DestructureNamedDef   := Identifier _ Colon _ (Identifier | BracketExpr) MultiAccessExpr?;
DestructureConciseDef := Colon Identifier SingleAccessExpr?;
DestructureCapture    := Hash Identifier;
```

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

<BareOperandExprNoEmpty> := CallExpr | BooleanLit | NumberLit | StringLit | DataStructLit
                          | IdentifierExpr | OpFuncExpr | GroupedBareOpExprNoEmpty;

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
<AsableExpr>           := BareBlockExpr | GuardedExpr | UnaryExpr | AsableInner;
<AsableInner>          := EmptyLit | CallExpr | BooleanLit | NumberLit | StringLit
                        | DataStructLit | IdentifierExpr | OpFuncExpr;

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

   All six keep their own (_ AsAnnotationExpr)? trailing tail —
   parens are atomic groups that can carry their own `:as` regardless
   of position (including as a binary operand). PEG order for the
   widened forms: AssignmentExpr first (where present, mirroring
   <ExprNoBlock>), then AsExpr (longer with `:as` tail), falls
   through cleanly on no match. *)

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
  (an `AtCallExpr`) is preferred over a bare AtExpr with dangling `5`.

## §6 Identifier / Access Expressions

```ebnf
(* ChainExpr (§7) covers all post-base chains (calls, access, or
   mixed) on any base. IdentifierExpr here is the bare/at/monad
   forms only. None of these arms carry `:as` directly — annotation
   comes from enclosing AsExpr (§5). *)

<IdentifierExpr>     := IdentityFunc | AtExpr | BareIdentifier;

IdentityFunc         := At;
AtExpr               := IdentBase SingleAccessExpr? At;
BareIdentifier       := IdentBase;

<IdentBase>          := PipelineTopic | Identifier | BuiltIn;

(* SingleAccessExpr and MultiAccessExpr are used by special contexts
   (ExportNamedBinding, DestructureNamedDef, AssignmentExpr LHS,
   AtExpr's internal access) that take an identifier with an access
   tail directly, not via ChainExpr. *)

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

<AnglePropertyList>  := PropertyExpr (_ Comma _ PropertyExpr)* (_ Comma)?;
<PropertyExpr>       := Identifier | PositiveIntLit;

<PositiveIntLit>     := (EscapePlain PositiveIntegerLit) | PositiveIntegerLit;

(* Range operands are bare — no `:as` tail allowed directly on a
   range operand. To annotate a range expression as a whole,
   parenthesize it: `(1..5) :as List`. *)
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
   ChainSeg, or a postfix `'` (prime, argument-reversal modifier).
   A bare base alone falls through to its non-chained form via
   BareOperandExprNoEmpty's later alternatives.

   None of ChainExpr / AtCallExpr / OpFuncExpr carry `:as` directly.
   Annotation comes from an enclosing AsExpr (§5).

   Postfix `'` is adjacent to the preceding expression (no trivia
   between), terminates the access chain (no dot/bracket access
   may follow), and may itself be followed only by zero or more
   call suffixes — matching its semantics as a function-value
   modifier. Examples that parse: `foo'`, `foo'(1,2,3)`,
   `foo.bar'`, `foo.bar'(1,2,3)`, `(+)'(1,2,3)`. Examples that
   do not: `foo'.bar`, `foo'[0]`, `foo' .bar` (trivia before `'`). *)

<CallExpr>     := AtCallExpr | ChainExpr;

ChainExpr      := ChainBase
                  (
                      (_ ChainSeg)+ (SingleQuote (_ CallSuffix)*)?
                    | SingleQuote (_ CallSuffix)*
                  );

<ChainBase>    := DefFuncExpr | MatchExpr | GuardedExpr | AssignmentExpr
                | OpFuncExpr | GroupedExprNoBlock
                | EmptyLit | BooleanLit | NumberLit | StringLit | DataStructLit
                | IdentifierExpr;

<ChainSeg>     := PrefixCallSuffix | PartialCallSuffix
                | DotIdentifier | BracketExpr | DotBracketExpr | DotAngleExpr;

<CallSuffix>   := PrefixCallSuffix | PartialCallSuffix;

PrefixCallSuffix  := OpenParen CallArgs CloseParen;
PartialCallSuffix := Pipe CallArgs Pipe;

(* The shaper splits the IdentityFunc arm out into a separate
   IdentityCallExpr node (no callee field — bare `@` applied to
   an argument is one indivisible language construct, not a call
   of `@` on the argument). The other three arms shape as
   AtCallExpr with a user-rooted callee. *)
AtCallExpr           := "None" At
                      | (AtExpr | (IdentBase SingleAccessExpr? _ At) | IdentityFunc) _ ExprNoBlock;

<CallArgs>           := (Op SingleQuote? &(CloseParen)) | (_ CallArgList? _);
<CallArgList>        := (_ Comma)* (CallArgExpr (_ Comma (_ CallArgExpr)?)*)?;
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
- `MatchExpr` / `GuardedExpr` precede `AssignmentExpr` — they have distinctive `?`/`!` openers; AssignmentExpr's identifier-led opener could conflict only with `IdentifierExpr` (handled by ordering AssignmentExpr before IdentifierExpr).
- `OpFuncExpr` precedes `GroupedExpr` — both open with `(`; OpFuncExpr's stricter inner shape (must be an Op) fails-through cleanly to GroupedExpr.
- `IdentifierExpr` last among identifier-led arms — AssignmentExpr's longer match wins when `:=` follows.

PEG ordering note for `<ChainSeg>`: order matches `<MultiAccessSeg>` for the four access variants (DotIdentifier before DotBracketExpr/DotAngleExpr); call suffixes are disjoint from access suffixes by opening token.

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
   - TypeCompareBinExpr handles ?as/!as, whose RHS is a NamedType
     (allowing NativeType keywords like `int`/`bool` alongside
     Identifier/BuiltIn). Flat binary, non-iterated — `x ?as int ?as bool`
     requires parens, semantically unclear without them.
   - CompareBinExpr handles ?in/!in/?has/!has and all symbolic compare
     ops, with regular expression RHS and left-fold iteration.

   PEG ordering: TypeCompareBinExpr before CompareBinExpr — both open
   with AddDispatch; disjoint by operator value (?as/!as vs.
   ?in/!in/?has/!has/symbolic), so order is mechanical. *)

<CompareDispatch>  := TypeCompareBinExpr | CompareBinExpr | AddDispatch;
TypeCompareBinExpr := AddDispatch _ AsTypeOp _ NamedType;
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
   `:as` Precedence section. *)
<BinaryAtom>     := ClosedRangeExpr | LeadingRangeExpr | TrailingRangeExpr
                  | UnaryExpr | BareOperandExpr | GroupedOpExpr | GroupedDoExpr;

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
   content that isn't an OperandExpr (e.g. starts a DoComprExpr or
   DoLoopComprExpr), it fails through to GroupedDoExpr cleanly.

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
Add (`+`, `-`, `$+`) → Compare/Membership/Type → And (`?and`, `!and`)
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
<SymbolicCompareOp> := (Qmark | Exmark) ((OpenAngle Equal CloseAngle) | (OpenAngle Equal) | (CloseAngle Equal) | (OpenAngle CloseAngle) | (Dollar Equal) | Equal | OpenAngle | CloseAngle);

<AddOp>          := (Dollar Plus) | Plus | Hyphen;
<MulOp>          := Star | ForwardSlash;

<NamedUnaryOp>   := "?empty" | "!empty";
<UnaryOpSym>     := Qmark | Exmark | SingleQuote | TriplePeriod | DoublePeriod | Period;
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

   BlockExpr is the defs-init form: `(defs) { stmts }`, with the
   defs-init container REQUIRED — not optional. The defs-init
   uses BlockDefsInitOptImplIn (lenient inner), so
   DestructureTarget entries may omit their init expression and
   bind from the enclosing context's implicit input. BlockExpr is
   reachable ONLY from implicit-input positions: <FlowRHSImplIn>
   (ComprOp / PipelineOp RHS) and FuncBodyPipeline (pipeline body
   of a function definition). It is NOT in <Expr>, NOT in
   <AsableExpr>, NOT at MatchConsequent, NOT at ComposeOp RHS,
   NOT at FuncBodyExpr / FuncBodyBlock. The reason: a defs-init
   only has meaning when something supplies the implicit input
   that destructure-no-init can bind from. Standalone
   `(defs) { body };` is syntactically rejected — no
   <Expr> alternative or <Stmt> arm reaches it.

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
   entry level. VarDefInitOpt is the strict-optional form
   (Identifier-init optional, DestructureTarget-init required),
   used at DefBlockStmt's BlockDefsInitOpt where no implicit
   source exists. VarDefInitOptImplIn is the lenient form
   (both Identifier-init and DestructureTarget-init optional),
   used at implicit-input sites: ParameterList (the positional
   argument is the source) and BlockDefsInitOptImplIn (via
   FlowRHSImplIn / FuncBodyPipeline, the comprehension element /
   pipeline topic / function arg is the source).

   None of the three productions carries a `:as` tail. BareBlockExpr
   reaches `:as` only via AsExpr-wrap; BlockExpr has no annotation
   path at all (it isn't in <AsableExpr> and its reachable contexts
   aren't outer-expression slots); DefBlockStmt is a statement, not
   an expression. See the `:as` Precedence section. *)

BlockExpr               := BlockDefsInitOptImplIn _ BareBlockExpr;
DefBlockStmt            := "def" _ BlockDefsInitOpt _ BareBlockExpr;
BareBlockExpr           := OpenBrace _ BlockStmts _ CloseBrace;
<BlockStmts>            := (StmtSemi _)* StmtSemiOpt?;

BlockDefsInitOpt        := OpenParen _ VarDefInitOptList _ CloseParen;
BlockDefsInitOptImplIn  := OpenParen _ VarDefInitOptImplInList _ CloseParen;

<VarDefInitOptList>        := (_ Comma)* (VarDefInitOpt       (_ Comma (_ VarDefInitOpt)?)*)?;
<VarDefInitOptImplInList>  := (_ Comma)* (VarDefInitOptImplIn (_ Comma (_ VarDefInitOptImplIn)?)*)?;

VarDefInitOpt           := (Identifier        (_ Colon _ ExprNoBlock)?)
                         | (DestructureTarget  _ Colon _ ExprNoBlock);   (* strict: init required *)
VarDefInitOptImplIn     := (Identifier        (_ Colon _ ExprNoBlock)?)
                         | (DestructureTarget (_ Colon _ ExprNoBlock)?); (* lenient: init optional *)
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
(* :as on a function is FuncAsClause (typing the function value
   itself), not a trailing AsAnnotationExpr. *)

DefFuncExpr           := "defn" (_ Identifier At?)?
                         (_ OpenParen _ (ParameterList | GatherParameter)? _ CloseParen)+
                         (_ FuncPrecondList)? (_ FuncOverClause)? (_ FuncAsClause)?
                         _ FuncBody;

ParameterList         := VarDefInitOptImplIn (_ Comma _ VarDefInitOptImplIn)*;
GatherParameter       := Star Identifier;

<FuncPrecondList>     := FuncPrecond (_ FuncPrecond)*;
FuncPrecond           := CondClause _ Colon _ ExprNoBlock;
FuncOverClause        := ":over" _ OpenParen _ Identifier (_ Comma _ Identifier)* _ CloseParen;
FuncAsClause          := ":as" _ Identifier;

<FuncBody>            := FuncBodyExpr | FuncBodyPipeline | FuncBodyBlock;
FuncBodyExpr          := Caret _ (ExprNoBlock | GroupedExpr);

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

PEG ordering notes for `FuncBodyPipeline`:

- `BlockExpr` first so `#> (x){y;}` parses as a BlockExpr
  (bare-identifier def `x`, body `{y;}`) rather than ExprNoBlock's
  GroupedExprNoBlock `(x)` with dangling `{y;}`. BlockExpr at this
  position uses BlockDefsInitOptImplIn (the lenient inner form) —
  the function's positional argument is the implicit input that
  destructure-no-init binds from, so `defn f(x) #> (<:a, :b>) { ... };`
  parses with `<:a, :b>` destructuring from `x`.
- `BareBlockExpr` next handles the no-defs case `#> { y; }`.
  Disjoint from BlockExpr (which requires a `(...)` prefix) and
  from ExprNoBlock / GroupedExpr (neither opens with `{`).
- `ExprNoBlock` and `GroupedExpr` handle non-block pipeline bodies.
  GroupedExpr isn't narrowed (unlike ChainBase or DoLoopComprExpr's
  iter range) — `#> (Foo ~<< {...})` is a sensible pipeline-body
  form.

Same two-block-arm shape as `<FlowRHSImplIn>` in §9.

DefFuncExpr shaper-shape notes:
- `over` is always the full FuncOverClause node (carries `.names`
  plus parens, commas, and any internal trivia in `.delims`). Not
  folded — the structural punctuation around `:over(...)` would
  otherwise be lost.
- `as` is shape-polymorphic, same fold-or-keep rule as AsExpr's
  `inner.as` (see §5): bare Identifier when FuncAsClause has no
  delims, the full FuncAsClause wrapper when it does.

## §14 Conditionals / Guards

```ebnf
(* GuardedExpr loses its own `(_ AsAnnotationExpr)?` — annotation
   comes via AsExpr (§5), whose AsableExpr inner list includes
   GuardedExpr. *)

CondClause            := (Qmark | Exmark) BracketExpr;
GuardedExpr           := CondClause _ Colon _ Expr;
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
DepCondBoolExpr        := AsTypeOp _ NamedType
                        | DepCondBoolOp _ CompareDispatch
                        | OpenParen _ DepCondBoolExpr _ CloseParen;
<DepCondBoolOp>        := CompareOp | AndOp | OrOp;

ElseStmt               := (Qmark _)? MatchConsequentNoSemi (_ Semicolon)*;
<MatchConsequent>      := (Colon _ Expr _ Semicolon) | BareBlockExpr;
<MatchConsequentNoSemi>:= (Colon _ Expr) | BareBlockExpr;
```

`IndepPatternStmt` / `IndepPatternStmtNoSemi` and
`DepPatternStmt` / `DepPatternStmtNoSemi` are distinct visible AST
nodes. The `NoSemi` variant differs only in trailing-semicolon
handling for the final clause; downstream code treats them
uniformly.

Note: `DepCondBoolExpr`'s `DepCondBoolOp _ CompareDispatch` arm
reaches `CompareDispatch` directly, not through `OperandExpr`. This
means `:as` is unreachable from inside `DepCondBoolExpr`'s
operator-led arm — `[?and x :as int]` is a parse error. To annotate,
use `[?and (x :as int)]` (the paren-recursive arm wraps the inner
operand). This is consistent with the rule that `:as` cannot attach
as a bare binary-operand suffix.

Note: `<MatchConsequent>` and `<MatchConsequentNoSemi>` use
`BareBlockExpr`, not `BlockExpr`. Match consequents have no implicit
input — a defs-init at this position would have no source for
destructure-no-init to bind from. The `(Colon _ Expr ...)` arm
handles the `: expr` consequent form; the `BareBlockExpr` arm
handles the `{ stmts }` consequent form. To bind names locally
inside a match consequent, use a `def` statement inside the
bare-block body.

## §16 Do-Comprehensions

```ebnf
DoComprExpr             := (Identifier | BuiltIn) _ Tilde OpenAngle OpenAngle _ DoBlockExpr;

DoBlockExpr             := DoBlockDefsInitOpt? _ DoBareBlockExpr;
<DoBareBlockExpr>       := OpenBrace _ DoBlockStmts _ CloseBrace;
<DoBlockStmts>          := (DoStmtSemi _)* (DoFinalUnwrapExpr | DoStmtSemiOpt)?;
DoBlockDefsInitOpt      := OpenParen _ DoVarDefInitOptList _ CloseParen;

<DoVarDefInitOptList>   := (_ Comma)* (DoVarDefInitOpt (_ Comma (_ DoVarDefInitOpt)?)*)?;
DoVarDefInitOpt         := (Identifier        (_ (DoubleColon | Colon) _ ExprNoBlock)?)
                         | (DestructureTarget (_ (DoubleColon | Colon) _ ExprNoBlock)?);

DoDefVarStmt            := "def" _ (Identifier | DestructureTarget) _ DoubleColon _ Expr;
<DoStmt>                := DoDefVarStmt | Stmt;
DoStmtSemi              := DoStmt? (_ Semicolon)+;
DoStmtSemiOpt           := DoStmt? (_ Semicolon)*;
DoFinalUnwrapExpr       := DoubleColon _ ExprNoBlock (_ Semicolon)*;

DoLoopComprExpr         := ExprNoBlock _ Tilde OpenAngle Star _ DoLoopIterationExpr;
<DoLoopIterationExpr>   := DoBlockExpr | DoLoopIterNoBlockExpr;
<DoLoopIterNoBlockExpr> := CallExpr | IdentifierExpr | (OpenParen _ DoLoopIterNoBlockExpr _ CloseParen);
```

Note: `<DoLoopIterNoBlockExpr>` lists `IdentifierExpr` directly (no
`Expr` dispatch path). `:as` on an iter function (`range ~<* foo :as Maybe`)
is therefore a parse error — wrap in parens (`range ~<* (foo :as Maybe)`)
to annotate. Consistent with the "use parens" rule.

## §17 Data Structure Literals

```ebnf
(* Neither RecordTupleLit nor SetLit carries its own `(_ AsAnnotationExpr)?`.
   Annotation comes via AsExpr (§5) — since DataStructLit is reachable
   from BareOperandExprNoEmpty, an AsExpr wrapping `<lit> :as T` works
   at any outer-position expression slot.

   RecordTupleValue gains AsExpr as its first alternative so that
   `<x :as int, y>` continues to parse — without it, leaves inside
   record/tuple entries would lose access to `:as`. *)

<DataStructLit>        := SetLit | RecordTupleLit;     (* SetLit first — opens with OpenAngle OpenBracket (2 tokens); RecordTupleLit opens with just OpenAngle (1 token) *)

RecordTupleLit         := OpenAngle _ RecordTupleEntryList _ CloseAngle;
<RecordTupleEntryList> := (_ Comma)* (RecordTupleEntry (_ Comma (_ RecordTupleEntry)?)*)?;
<RecordTupleEntry>     := PickValue | RecordProperty | RecordTupleValue;

RecordTupleValue       := AsExpr | CallExpr | EmptyLit | BooleanLit | NumberLit | StringLit | DataStructLit
                        | IdentifierExpr | (OpenParen _ RecordTupleValue _ CloseParen);

PickValue              := Ampersand IdentBase MultiAccessExpr?;
<RecordProperty>       := ConcisePropDef | ExplicitPropDef;
ConcisePropDef         := Colon PropertyExpr;
ExplicitPropDef        := (ComputedPropName | PropertyExpr) _ Colon _ RecordTupleValue;
<ComputedPropName>     := Percent (PipelineTopic | CallExpr | IdentifierExpr | StringLit);

SetLit                 := OpenAngle OpenBracket _ SetEntryList _ CloseBracket CloseAngle;
<SetEntryList>         := (_ Comma)* (SetEntry (_ Comma (_ SetEntry)?)*)?;
<SetEntry>             := PickValue | RecordTupleValue;
```

PEG ordering note for `RecordTupleValue`: `AsExpr` first — longer
match with `:as` tail. Falls through to `CallExpr` and the rest on
no `:as`. The remaining order is unchanged from prior design:
`CallExpr` before `IdentifierExpr` so `foo.bar` parses as a chain;
`DataStructLit` before `IdentifierExpr` (disjoint openers).

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
   syntactically required: NestedTypeExpr's type-argument site, and
   the position immediately after a `?`, `*`, or `^` modifier when the
   inner type is a union or function. Bare types are required
   everywhere else — decorative bracing of a non-union, non-function
   type in those non-modifier positions is a parse error. (A narrow
   leakage: `(?{int})`, `(*{int})`, and `^{int}` technically parse
   because the modifier-position arms accept GroupedTypeExpr broadly;
   the strict reading is "don't brace a non-union/non-function" — this
   is conventionally discouraged but not grammar-rejected.) *)

DefTypeStmt           := "deft" _ Identifier _ TypeExpr;

<TypeExpr>            := FuncTypeExpr | NoFuncTypeExpr;

<NoFuncTypeExpr>      := UnionTypeExpr | NoUnionTypeExpr;
UnionTypeExpr         := NoUnionTypeExpr (_ Pipe _ NoUnionTypeExpr)+;

<NoUnionTypeExpr>     := NestedTypeExpr | NamedType
                       | EmptyLit | PlainStr | NumberLit | BooleanLit
                       | DataStructTypeExpr;

NamedType             := ((Identifier | BuiltIn) (Period (Identifier | BuiltIn))*)
                       | NativeType;
<NativeType>          := "int" | "integer" | "float" | "bool" | "boolean" | "string";

NestedTypeExpr        := NamedType _ GroupedTypeExpr;

GroupedTypeExpr       := OpenBrace _ (FuncTypeExpr | UnionTypeExpr (_ Pipe)?
                                    | NoUnionTypeExpr) _ CloseBrace;

DataStructTypeExpr    := OpenAngle _ DataStructTypeList? _ (Comma _)? CloseAngle;
<DataStructTypeList>  := (DataStructTypeEntry (_ Comma _ DataStructTypeEntry)* (_ Comma _ DataStructFinalValType)?)
                       | DataStructFinalValType;
<DataStructTypeEntry> := DataStructFieldType | DataStructValueType;
<DataStructValueType> := NoFuncTypeExpr;
DataStructFieldType   := Identifier _ Colon _ DataStructValueType;
DataStructFinalValType:= Star (NoUnionTypeExpr | GroupedTypeExpr);

FuncTypeExpr          := OpenParen _ FuncTypeArgList? _ (Comma _)? CloseParen _ Caret _ Qmark? _ (NoUnionTypeExpr | GroupedTypeExpr);
<FuncTypeArgList>     := (FuncTypeArg (_ Comma _ FuncTypeArg)* (_ Comma _ FuncTypeFinalArg)?)
                       | FuncTypeFinalArg;
FuncTypeArg           := Qmark? (NoUnionTypeExpr | GroupedTypeExpr);
FuncTypeFinalArg      := (Star (NoUnionTypeExpr | GroupedTypeExpr)) | FuncTypeArg;
```
