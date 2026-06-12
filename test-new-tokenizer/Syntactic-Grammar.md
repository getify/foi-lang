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

The mechanism: `AsExpr` is reachable from `<Expr>` and
`<ExprNoBlock>` dispatchers (outer-position expression slots), but
**not** from inside `<BinaryAtom>`. The binary tier operands see
only the bare forms (no `:as`), which is what makes
`x + y :as int` rejected rather than silently binding `:as` to
`y`. The four restrictive paren-inner forms gain `AsExpr` as an
alternative so that `(?x :as bool)`, `(foo() :as int)`, etc.
continue to parse inside parens.

**Productions that carry `:as`:**
- `AsExpr` (§5) — the central carrier
- All six paren-grouping productions (`GroupedExpr`,
  `GroupedExprNoBlock`, `GroupedOpExpr`, `GroupedBareOpExpr`,
  `GroupedBareOpExprNoEmpty`, `GroupedDoExpr`)

**Productions that do NOT carry `:as`** (must be parenthesized or
wrapped via `AsExpr` to receive an annotation): everything else,
including `BinaryExpr` (and all tier iter variants),
`AssignmentExpr`, `ClosedRangeExpr` / `LeadingRangeExpr` /
`TrailingRangeExpr`, `DoComprExpr`, `DoLoopComprExpr`, `MatchExpr`,
all literal leaves (`NumberLit`, `BooleanLit`, `EmptyLit`, four
`StringLit` variants, `RecordTupleLit`, `SetLit`), `IdentifierExpr`'s
three arms, `OpFuncExpr`, `ChainExpr`, `AtCallExpr`, `UnaryExpr`'s
two arms, `BlockExpr`, `GuardedExpr`.

---

## §1 Program / Statements

```ebnf
Program             := _ ((StmtSemi | ExportStmtSemi) _)*
                       ((StmtSemiOpt | ExportStmtSemiOpt) _)?;

<Stmt>              := DefBlockStmt | DefVarStmt | DefTypeStmt | Expr;
<StmtSemi>          := Stmt? (_ Semicolon)+;
<StmtSemiOpt>       := Stmt? (_ Semicolon)*;
<ExportStmtSemi>    := ExportExpr (_ Semicolon)+;
<ExportStmtSemiOpt> := ExportExpr (_ Semicolon)*;

Identifier          := General;
BuiltIn             := Builtin;
PipelineTopic       := Hash;
```

## §2 Literals

```ebnf
(* No leaf in §2 carries its own (_ AsAnnotationExpr)?. The `:as`
   tail on a leaf is supplied by an enclosing AsExpr (§5). *)

<Literal>          := NumberLit | StringLit | BooleanLit | EmptyLit;

(* NumberLit: either a bare decimal Number token, an Escape+Number
   pair (via lex's hidden EscapedNumber dispatch, which splices its
   six (Escape variant, Number variant) pairs as direct children), or
   a bare integer literal of either sign (PositiveIntegerLit or
   NegativeIntegerLit, unified via the hidden IntegerLit from
   Lexical-Grammar.md). *)
NumberLit          := EscapedNumber | Number | IntegerLit;

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

<Expr>                 := DoComprExpr | DoLoopComprExpr | AsExpr | BlockExpr | ExprNoBlock | GroupedExpr;

<ExprNoBlock>          := DefFuncExpr | AssignmentExpr | MatchExpr | GuardedExpr | AsExpr | OperandExpr | GroupedExprNoBlock;

<OperandExpr>          := BinaryExpr;

<BareOperandExpr>      := EmptyLit | BareOperandExprNoEmpty | GroupedBareOpExpr;

<BareOperandExprNoEmpty> := CallExpr | BooleanLit | NumberLit | StringLit | DataStructLit
                          | IdentifierExpr | OpFuncExpr | GroupedBareOpExprNoEmpty;

(* AsExpr — the sole non-paren carrier of `:as`. Inner is restricted
   to <AsableExpr>: anything tighter than binary (chain/access via
   BareOperandExpr's CallExpr arm, unary, leaves, parens that allow
   operand-level inner) plus BlockExpr/GuardedExpr at the outer
   level. Ranges are deliberately NOT in <AsableExpr> — annotating
   a bare range requires explicit parens (`(1..5) :as List`).

   AsExpr is a parse-time wrapper. Its shaper unwraps — it lifts
   `as` onto its inner node and returns the inner. There is no
   AsExpr node type in the AST. *)
AsExpr                 := <AsableExpr> _ AsAnnotationExpr;
<AsableExpr>           := BlockExpr | GuardedExpr | UnaryExpr
                        | BareOperandExpr | GroupedOpExpr | GroupedDoExpr;

(* Six paren-grouping productions. The two whose inner-expr forms
   include AsExpr via dispatch (GroupedExpr's Expr, GroupedExprNoBlock's
   ExprNoBlock) need no widening. The four restrictive variants
   (OperandExpr, BareOperandExpr, BareOperandExprNoEmpty, do-compr)
   add AsExpr as an explicit first alternative.

   All six keep their own (_ AsAnnotationExpr)? trailing tail —
   parens are atomic groups that can carry their own `:as` regardless
   of position (including as a binary operand). PEG order for the
   widened forms: AsExpr first (longer with `:as` tail), falls
   through cleanly on no `:as`. *)

GroupedExpr              := OpenParen _ Expr _ CloseParen (_ AsAnnotationExpr)?;
GroupedExprNoBlock       := OpenParen _ ExprNoBlock _ CloseParen (_ AsAnnotationExpr)?;
GroupedOpExpr            := OpenParen _ (AsExpr | OperandExpr) _ CloseParen (_ AsAnnotationExpr)?;
GroupedBareOpExpr        := OpenParen _ (AsExpr | BareOperandExpr) _ CloseParen (_ AsAnnotationExpr)?;
GroupedBareOpExprNoEmpty := OpenParen _ (AsExpr | BareOperandExprNoEmpty) _ CloseParen (_ AsAnnotationExpr)?;

AsAnnotationExpr         := ":as" _ NamedType;        (* NamedType — forward ref to §18 *)
```

PEG ordering notes:

- In `<Expr>`, `AsExpr` precedes `BlockExpr` and `ExprNoBlock` —
  the longer match (with `:as` tail) wins. On no `:as`, `AsExpr`
  fails fast at the missing tail and falls through.
- In `<ExprNoBlock>`, `AsExpr` precedes `OperandExpr` and
  `GroupedExprNoBlock` for the same reason. It is placed after
  `GuardedExpr` because `<AsableExpr>` includes `GuardedExpr`;
  trying `AsExpr` first would consume the guarded body greedily
  and then fail at the `:as` tail when the body's own greedy
  `Expr` already ate any `:as`. Same fall-through semantics on
  no `:as`.
- In `<Expr>`, `BlockExpr` precedes `ExprNoBlock` so inputs like
  `(x){y;}` (a BlockExpr with bare-identifier def) parse as a
  BlockExpr rather than `(x)` as GroupedExprNoBlock with dangling
  `{y;}`. BlockExpr fails-through cleanly when no `{` follows the
  optional defs-init, so bare `(x)` still reaches GroupedExprNoBlock
  via ExprNoBlock.
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

<IdentifierExpr>     := MonadConstructor | AtExpr | BareIdentifier;

MonadConstructor     := At;
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
                | OpFuncExpr | GroupedExpr
                | EmptyLit | BooleanLit | NumberLit | StringLit | DataStructLit
                | IdentifierExpr;

<ChainSeg>     := PrefixCallSuffix | PartialCallSuffix
                | DotIdentifier | BracketExpr | DotBracketExpr | DotAngleExpr;

<CallSuffix>   := PrefixCallSuffix | PartialCallSuffix;

PrefixCallSuffix  := OpenParen CallArgs CloseParen;
PartialCallSuffix := Pipe CallArgs Pipe;

AtCallExpr           := "None" At
                      | (AtExpr | (IdentBase SingleAccessExpr? _ At) | MonadConstructor) _ ExprNoBlock;

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
   range-as-conditional); RHS may be a BlockExpr (for
   comprehension iteration / pipeline body). Other tiers allow
   neither. Semantic validity for non-`~each`/non-comprehension
   ops with these extensions is checked downstream. *)

<BinaryExpr>     := FlowDispatch;

<FlowDispatch>   := FlowBinExpr | OrDispatch;
FlowBinExpr      := FlowLHS (_ FlowOp _ FlowRHS)+;
<FlowLHS>        := CondClause | OrDispatch;
<FlowRHS>        := BlockExpr | OrDispatch;

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
(* BlockExpr loses its own `(_ AsAnnotationExpr)?` — annotation comes
   via AsExpr (§5), whose AsableExpr inner list includes BlockExpr.
   AsExpr's unwrap-shaper lifts `as` onto the BlockExpr node, so the
   AST shape for `{x;y} :as int` is unchanged from the prior design. *)

BlockExpr             := BlockDefsInitOpt? _ BareBlockExpr;
DefBlockStmt          := "def" _ BlockDefsInit _ BareBlockExpr;
<BareBlockExpr>       := OpenBrace _ BlockStmts _ CloseBrace;
<BlockStmts>          := (StmtSemi _)* StmtSemiOpt?;

BlockDefsInit         := OpenParen _ VarDefInitList _ CloseParen;
BlockDefsInitOpt      := OpenParen _ VarDefInitOptList _ CloseParen;

<VarDefInitList>      := VarDefInit (_ Comma _ VarDefInit)* (_ Comma)?;
<VarDefInitOptList>   := (_ Comma)* (VarDefInitOpt (_ Comma (_ VarDefInitOpt)?)*)?;

VarDefInit            := (Identifier | DestructureTarget) _ Colon _ ExprNoBlock;
VarDefInitOpt         := (Identifier        (_ Colon _ ExprNoBlock)?)
                       | (DestructureTarget (_ Colon _ ExprNoBlock)?);
```

## §12 Assignment

```ebnf
(* LHS restricted to identifier with optional single-access. Excludes
   multi-pick assignment and pipeline-topic assignment. No :as tail —
   parenthesize. *)

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

ParameterList         := VarDefInitOpt (_ Comma _ VarDefInitOpt)*;
GatherParameter       := Star Identifier;

<FuncPrecondList>     := FuncPrecond (_ FuncPrecond)*;
FuncPrecond           := CondClause _ Colon _ ExprNoBlock;
FuncOverClause        := ":over" _ OpenParen _ Identifier (_ Comma _ Identifier)* _ CloseParen;
FuncAsClause          := ":as" _ Identifier;

<FuncBody>            := FuncBodyExpr | FuncBodyPipeline | FuncBodyBlock;
FuncBodyExpr          := Caret _ (ExprNoBlock | GroupedExpr);
FuncBodyPipeline      := PipelineOp _ (BlockExpr | ExprNoBlock | GroupedExpr);
FuncBodyBlock         := OpenBrace _ FuncBodyStmts _ CloseBrace;

<FuncBodyStmts>       := (FuncBodyStmtSemi _)* FuncBodyStmtSemiOpt?;
<FuncBodyStmtSemi>    := FuncBodyStmt (_ Semicolon)+;
<FuncBodyStmtSemiOpt> := FuncBodyStmt (_ Semicolon)*;
<FuncBodyStmt>        := ReturnExpr | Stmt;
ReturnExpr            := Caret _ Expr;
```

PEG ordering note: in `FuncBodyPipeline`, `BlockExpr` precedes
`ExprNoBlock` so `#> (x){y;}` parses as a BlockExpr (bare-identifier
def `x`, body `{y;}`) rather than ExprNoBlock's GroupedExprNoBlock
`(x)` with dangling `{y;}`. Same shape as the `<Expr>` ordering in §5.
The filed concern about GroupedExpr-at-non-Expr-call-sites for
FuncBodyPipeline still stands — this fix only addresses arm order,
not the choice of inner-expression variant.

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
<MatchConsequent>      := (Colon _ Expr _ Semicolon) | BlockExpr;
<MatchConsequentNoSemi>:= (Colon _ Expr) | BlockExpr;
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
<DoStmtSemi>            := DoStmt? (_ Semicolon)+;
<DoStmtSemiOpt>         := DoStmt? (_ Semicolon)*;
DoFinalUnwrapExpr       := DoubleColon _ ExprNoBlock (_ Semicolon)*;

DoLoopComprExpr         := (ExprNoBlock | GroupedExpr) _ Tilde OpenAngle Star _ DoLoopIterationExpr;
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

<RecordTupleValue>     := AsExpr | CallExpr | EmptyLit | BooleanLit | NumberLit | StringLit | DataStructLit
                        | IdentifierExpr | (OpenParen _ RecordTupleValue _ CloseParen);

PickValue              := Ampersand IdentBase MultiAccessExpr?;
<RecordProperty>       := ConcisePropDef | ExplicitPropDef;
ConcisePropDef         := Colon PropertyExpr;
ExplicitPropDef        := (ComputedPropName | PropertyExpr) _ Colon _ RecordTupleValue;
<ComputedPropName>     := Percent (PipelineTopic | IdentifierExpr | StringLit);

SetLit                 := OpenAngle OpenBracket _ SetEntryList _ CloseBracket CloseAngle;
<SetEntryList>         := (_ Comma)* (SetEntry (_ Comma (_ SetEntry)?)*)?;
<SetEntry>             := PickValue | RecordTupleValue;
```

PEG ordering note for `<RecordTupleValue>`: `AsExpr` first — longer
match with `:as` tail. Falls through to `CallExpr` and the rest on
no `:as`. The remaining order is unchanged from prior design:
`CallExpr` before `IdentifierExpr` so `foo.bar` parses as a chain;
`DataStructLit` before `IdentifierExpr` (disjoint openers).

## §18 Type Definitions

```ebnf
(* Type sub-grammar. Used by:
   - DefTypeStmt (§1) for the body of `deft Name <type>` — accepts the
     full TypeExpr (union, no-union, or function).
   - AsAnnotationExpr (§5) for the type after `:as` — accepts only a
     bare NamedType (matches Foi-Guide usage: `:as int`, `:as Foo`).

   Type forms do NOT carry trailing :as — they are types, not values.
   Grammar permissive; semantic validation in interp (e.g., interp
   strings in type position, `int :as bool` chains, etc.). *)

DefTypeStmt           := "deft" _ Identifier _ TypeExpr;

<TypeExpr>            := FuncTypeExpr | NoFuncTypeExpr;

<NoFuncTypeExpr>      := UnionTypeExpr | NoUnionTypeExpr;
UnionTypeExpr         := NoUnionTypeExpr (_ Pipe _ NoUnionTypeExpr)+;

<NoUnionTypeExpr>     := NestedTypeExpr | NamedType
                       | EmptyLit | PlainStr | NumberLit | BooleanLit
                       | DataStructTypeExpr | GroupedTypeExpr;

NamedType             := ((Identifier | BuiltIn) (Period (Identifier | BuiltIn))*)
                       | NativeType;
<NativeType>          := "int" | "integer" | "float" | "bool" | "boolean" | "string";

NestedTypeExpr        := NamedType _ GroupedTypeExpr;

GroupedTypeExpr       := OpenBrace _ (FuncTypeExpr | UnionTypeExpr (_ Pipe)? | NoUnionTypeExpr) _ CloseBrace;

DataStructTypeExpr    := OpenAngle _ DataStructTypeList? _ (Comma _)? CloseAngle;
<DataStructTypeList>  := (DataStructTypeEntry (_ Comma _ DataStructTypeEntry)* (_ Comma _ DataStructFinalValType)?)
                       | DataStructFinalValType;
<DataStructTypeEntry> := DataStructFieldType | DataStructValueType;
<DataStructValueType> := NoFuncTypeExpr | GroupedTypeExpr;
DataStructFieldType   := Identifier _ Colon _ DataStructValueType;
DataStructFinalValType:= Star NoUnionTypeExpr;

FuncTypeExpr          := OpenParen _ FuncTypeArgList? _ (Comma _)? CloseParen _ Caret _ Qmark? _ NoUnionTypeExpr;
<FuncTypeArgList>     := (FuncTypeArg (_ Comma _ FuncTypeArg)* (_ Comma _ FuncTypeFinalArg)?)
                       | FuncTypeFinalArg;
FuncTypeArg           := Qmark? NoUnionTypeExpr;
FuncTypeFinalArg      := (Star NoUnionTypeExpr) | FuncTypeArg;
```

---

## Filed Open Concerns

- **PEG ordering in `<ChainBase>`, `<ExprNoBlock>`** — firm up
  during implementation against real source.
- **`AssignmentExpr` and `:as` interaction** — `:=` excluded from
  `:as`-bearing forms. May revisit if `x := (3 :as int)` vs
  `(x := 3) :as int` ambiguity has a strongly preferred
  interpretation in practice.
- **`GroupedExpr` (full-Expr) at non-Expr call sites** — several
  productions reference `GroupedExpr` where a more restrictive
  variant might be more appropriate: `FuncBodyPipeline` (§13),
  `DoLoopComprExpr` (§16), `ChainBase` (§7).
- **`ComputedPropName` (§17)** accepts only `IdentifierExpr`
  (bare/at/monad), not full access chains.
