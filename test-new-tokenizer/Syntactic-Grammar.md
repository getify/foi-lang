# Foi Syntactic Grammar

Source-of-truth syntactic grammar for Foi, operating over the lexer's
token stream. Companion to `Lexical-Grammar.md`. Same EBNF dialect
(instaparse syntax: `:=` for rules, `|` for ordered choice, `&(...)` /
`!(...)` for lookahead, `(* *)` for comments).

Refactored from the original character-level `Grammar.md` to:
- Operate over the lexer's token stream rather than raw characters
- Use PEG-style ordered choice (first match wins) throughout
- Eliminate left-recursion in favor of iterative forms
- Encode operator precedence via a tier ladder
- Preserve concrete syntax that the user wrote (e.g. parentheses,
  `:as` annotations) as visible AST nodes

This grammar is designed to concatenate cleanly with `Lexical-Grammar.md`
into a single valid EBNF document — every production reference here
resolves to a lex-layer production, and value-literals are restricted
to reserved-word values that resolve through their lex type production.

## Conventions

**Terminals are lexer tokens, not characters.** Two reference forms:

- **`PascalCase`** — match a token by its `type` field. These are
  production names from `Lexical-Grammar.md`; the syntactic grammar
  consumes them whole. Token-emitting productions referenced this
  way include: `General`, `Number`, `Builtin`, `Whitespace`,
  `Comment`, `StringEscapedChar`, `Hyphen`, `DoubleColon`,
  `DoublePeriod`, `TriplePeriod`, all single-char operator
  productions (`Semicolon`, `OpenParen`, `Colon`, `Hash`, `At`, …),
  and the eight Escape variants (`EscapeBacktick`, `EscapePlain`,
  `EscapeSpacingBacktick`, `EscapeHex`, `EscapeUnicode`,
  `EscapeOctal`, `EscapeBinary`, `EscapeMonadic`).

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
tokens — no trivia between them. Explicit trivia is marked with `_`
(optional trivia) or `__` (required `Whitespace`). Multi-char
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

**Visible productions** correspond to `production(NAME, ...)` in the
combinator impl — they appear as named nodes in the AST. Every
visible production emits an AST node whose type matches the
production name exactly — no aliasing, no name-rewriting. Where
multiple productions share structural shape but differ in inner
content (e.g. the five paren-grouping variants), each is its own
distinct AST node, named to reflect its inner content.

**Trivia is explicit.** Two hidden helpers:

```ebnf
<_>  := (Whitespace | Comment)*;       (* optional trivia *)
<__> := _ Whitespace _;                (* required Whitespace *)
```

**`:as` annotations** attach as a final optional child of the thing
they modify. Productions carrying `(_ AsAnnotationExpr)?`:
- All five paren-grouping productions (`GroupedExpr`,
  `GroupedExprNoBlock`, `GroupedOpExpr`, `GroupedBareOpExpr`,
  `GroupedBareOpExprNoEmpty`)
- `BlockExpr`
- All literal leaves (`EmptyLit`, `BooleanLit`, `NumberLit`, four
  `StringLit` variants, `DataStructLit`'s two forms, `ClosedRangeExpr`)
- `IdentifierExpr`'s three arms, `OpFuncExpr`, `ChainExpr`,
  `AtCallExpr`
- `UnaryExpr`'s two arms, `GuardedExpr`

Productions that do NOT carry `:as` (must be parenthesized to receive
an annotation): `BinaryExpr` (and all tier iter variants),
`AssignmentExpr`, `DoComprExpr`, `DoLoopComprExpr`, `MatchExpr`.
`DefFuncExpr`'s `:as` is its inner `FuncAsClause`, not a tail.

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
<Literal>          := NumberLit | StringLit | BooleanLit | EmptyLit;

(* NumberLit: either a bare decimal Number token, an Escape+Number
   pair (via lex's hidden EscapedNumber dispatch, which splices its
   six (Escape variant, Number variant) pairs as direct children), or
   a bare integer literal of either sign (PositiveIntegerLit or
   NegativeIntegerLit, unified via the hidden <IntegerLit> from
   Lexical-Grammar.md). *)
NumberLit          := (EscapedNumber | Number | IntegerLit) (_ AsAnnotationExpr)?;

BooleanLit         := ("true" | "false") (_ AsAnnotationExpr)?;
EmptyLit           := "empty" (_ AsAnnotationExpr)?;

<StringLit>        := PlainStr | SpacingEscapedStr | InterpStr | SpacingInterpStr;

PlainStr           := DoubleQuote PlainStrContent* DoubleQuote (_ AsAnnotationExpr)?;
<PlainStrContent>  := PlainStrChars | StringEscapedChar;

SpacingEscapedStr  := EscapePlain DoubleQuote SpacingEscapedStrContent* DoubleQuote (_ AsAnnotationExpr)?;
<SpacingEscapedStrContent> := SpacingEscapedStrChars | StringEscapedChar | Whitespace;

InterpStr          := EscapeBacktick DoubleQuote InterpStrContent* DoubleQuote (_ AsAnnotationExpr)?;
<InterpStrContent> := InterpStrChars | StringEscapedChar | InterpExpr;

SpacingInterpStr   := EscapeSpacingBacktick DoubleQuote SpacingInterpStrContent* DoubleQuote (_ AsAnnotationExpr)?;
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
   inner content they allow. *)

<Expr>                 := DoComprExpr | DoLoopComprExpr | BlockExpr | ExprNoBlock | GroupedExpr;

<ExprNoBlock>          := DefFuncExpr | AssignmentExpr | MatchExpr | GuardedExpr | OperandExpr | GroupedExprNoBlock;

<OperandExpr>          := BinaryExpr;

<BareOperandExpr>      := EmptyLit | BareOperandExprNoEmpty | GroupedBareOpExpr;

<BareOperandExprNoEmpty> := CallExpr | BooleanLit | NumberLit | StringLit | DataStructLit
                          | IdentifierExpr | OpFuncExpr | GroupedBareOpExprNoEmpty;

GroupedExpr              := OpenParen _ Expr _ CloseParen (_ AsAnnotationExpr)?;
GroupedExprNoBlock       := OpenParen _ ExprNoBlock _ CloseParen (_ AsAnnotationExpr)?;
GroupedOpExpr            := OpenParen _ OperandExpr _ CloseParen (_ AsAnnotationExpr)?;
GroupedBareOpExpr        := OpenParen _ BareOperandExpr _ CloseParen (_ AsAnnotationExpr)?;
GroupedBareOpExprNoEmpty := OpenParen _ BareOperandExprNoEmpty _ CloseParen (_ AsAnnotationExpr)?;

AsAnnotationExpr         := ":as" _ NamedType;        (* NamedType — forward ref to §18 *)
```

PEG ordering notes:
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
(* Access on identifier-led bases is no longer handled by a dedicated
   IdentifierAccessExpr — the unified ChainExpr in §7 covers all
   post-base chains. IdentifierExpr is just the bare/at/monad forms. *)

<IdentifierExpr>     := MonadConstructor | AtExpr | BareIdentifier;

MonadConstructor     := At (_ AsAnnotationExpr)?;
AtExpr               := IdentBase SingleAccessExpr? At (_ AsAnnotationExpr)?;
BareIdentifier       := IdentBase (_ AsAnnotationExpr)?;

<IdentBase>          := PipelineTopic | Identifier | BuiltIn;

(* SingleAccessExpr and MultiAccessExpr remain — used by special
   contexts (ExportNamedBinding, DestructureNamedDef,
   AssignmentExpr LHS, AtExpr's internal access) that take an
   identifier with an access tail directly, not via ChainExpr. *)

SingleAccessExpr     := SingleAccessSeg (_ SingleAccessSeg)*;
<SingleAccessSeg>    := DotIdentifier | BracketExpr;

MultiAccessExpr      := MultiAccessSeg (_ MultiAccessSeg)*;
<MultiAccessSeg>     := DotIdentifier | BracketExpr | DotBracketExpr | DotAngleExpr;

(* DotIdentifier: dot-access by name (identifier or builtin) or by
   bare integer index of either sign (via the hidden <IntegerLit>
   union from Lexical-Grammar.md). The negative-index form `arr.-1`
   accesses from the end of an ordered structure. Property-name
   contexts elsewhere (PropertyExpr, AnglePropertyList, record
   properties) remain positive-only via <PositiveIntLit>. *)
DotIdentifier        := Period _ (Identifier | BuiltIn | IntegerLit);
BracketExpr          := OpenBracket _ ExprNoBlock _ CloseBracket;
DotBracketExpr       := Period OpenBracket _ RangeExpr _ CloseBracket;
DotAngleExpr         := Period OpenAngle _ AnglePropertyList _ CloseAngle;

<AnglePropertyList>  := PropertyExpr (_ Comma _ PropertyExpr)* (_ Comma)?;
<PropertyExpr>       := Identifier | PositiveIntLit;

<PositiveIntLit>     := (EscapePlain PositiveIntegerLit) | PositiveIntegerLit;

<RangeExpr>          := ClosedRangeExpr | LeadingRangeExpr | TrailingRangeExpr;
ClosedRangeExpr      := RangeOperand _ DoublePeriod _ RangeOperand (_ AsAnnotationExpr)?;
LeadingRangeExpr     := RangeOperand _ DoublePeriod;
TrailingRangeExpr    := DoublePeriod _ RangeOperand;
<RangeOperand>       := BareOperandExpr | GroupedOpExpr;
```

## §7 Function Calls / Op-as-Function

```ebnf
(* ChainExpr unifies what was previously split between
   CallChainExpr and ExprAccessExpr. Any post-base chain — calls,
   access, or mixed — parses as ChainExpr with a flat suffix
   list. The shaper layer can fold this into nested
   MemberAccessExpr / PrefixCallExpr / PartialCallExpr / IndexAccessExpr
   nodes (JS-style: each suffix wraps the previous expression) when
   the interp needs the typed-by-suffix-kind AST.

   ChainExpr requires extension beyond ChainBase — either ≥1
   ChainSeg, or a postfix `'` (prime, argument-reversal modifier).
   A bare base alone falls through to its non-chained form via
   BareOperandExprNoEmpty's later alternatives.

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
                  )
                  (_ AsAnnotationExpr)?;

<ChainBase>    := DefFuncExpr | MatchExpr | GuardedExpr | AssignmentExpr
                | OpFuncExpr | GroupedExpr
                | EmptyLit | BooleanLit | NumberLit | StringLit | DataStructLit
                | IdentifierExpr;

<ChainSeg>     := PrefixCallSuffix | PartialCallSuffix
                | DotIdentifier | BracketExpr | DotBracketExpr | DotAngleExpr;

<CallSuffix>   := PrefixCallSuffix | PartialCallSuffix;

PrefixCallSuffix  := OpenParen CallArgs CloseParen;
PartialCallSuffix := Pipe CallArgs Pipe;

AtCallExpr           := "None" At (_ AsAnnotationExpr)?
                      | (AtExpr | (IdentBase SingleAccessExpr? _ At) | MonadConstructor) _ ExprNoBlock (_ AsAnnotationExpr)?;

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
OpFuncExpr           := OpenParen (DotAngleExpr | DotBracketExpr | (OpenBracket CloseBracket) | Op) SingleQuote? CloseParen (_ AsAnnotationExpr)?;
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

   Postfix `'` (the prime operator, argument-reversal modifier) is
   handled as a restricted tail of ChainExpr in §7, not as a UnaryExpr
   arm. It attaches only where a function value lives, terminates
   the access chain, and may be followed only by call suffixes —
   not by further dot/bracket access. *)

<UnaryExpr>       := NamedUnaryExpr | SymbolicUnaryExpr;

NamedUnaryExpr    := NamedUnaryOp _ BinaryAtom (_ AsAnnotationExpr)?;
SymbolicUnaryExpr := (Qmark | Exmark) _ BinaryAtom (_ AsAnnotationExpr)?;
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

   Flow tier extensions: LHS may be a CondClause (for `~each`-style
   range-as-conditional); RHS may be a BlockExpr (for
   comprehension iteration / pipeline body). Other tiers allow
   neither. Semantic validity for non-`~each`/non-comprehension
   ops with these extensions is checked downstream. *)

<BinaryExpr>     := <FlowDispatch>;

<FlowDispatch>   := FlowBinExpr | <OrDispatch>;
FlowBinExpr      := <FlowLHS> (_ FlowOp _ <FlowRHS>)+;
<FlowLHS>        := CondClause | <OrDispatch>;
<FlowRHS>        := BlockExpr | <OrDispatch>;

<OrDispatch>     := OrBinExpr | <AndDispatch>;
OrBinExpr        := <AndDispatch> (_ OrOp _ <AndDispatch>)+;

<AndDispatch>    := AndBinExpr | <CompareDispatch>;
AndBinExpr       := <CompareDispatch> (_ AndOp _ <CompareDispatch>)+;

<CompareDispatch>:= CompareBinExpr | <AddDispatch>;
CompareBinExpr   := <AddDispatch> (_ CompareOp _ <AddDispatch>)+;

<AddDispatch>    := AddBinExpr | <MulDispatch>;
AddBinExpr       := <MulDispatch> (_ AddOp _ <MulDispatch>)+;

<MulDispatch>    := MulBinExpr | BinaryAtom;
MulBinExpr       := BinaryAtom (_ MulOp _ BinaryAtom)+;

(* PEG: GroupedOpExpr before GroupedDoExpr — both open with OpenParen.
   GroupedOpExpr's inner OperandExpr is the common case (`(x + 1)`,
   `(x ~map f)`); GroupedDoExpr's inner DoComprExpr/DoLoopComprExpr
   is the niche case. Trying the common case first keeps the hot
   path cheap; on `(` followed by do-compr content, GroupedOpExpr
   fails through cleanly. *)
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

   Trailing `:as` allowed for consistency with GroupedOpExpr; semantic
   validity (whether annotating a monadic do-result is meaningful) is
   checked downstream. *)
(* PEG: DoComprExpr before DoLoopComprExpr — matches <Expr> ordering
   in §5. Disjoint at the third token of their `~<<` / `~<*`
   signatures, so the order is mechanical, not discriminating. *)
GroupedDoExpr    := OpenParen _ (DoComprExpr | DoLoopComprExpr) _ CloseParen (_ AsAnnotationExpr)?;
```

**Precedence (tightest → loosest):** Unary → Mul (`*`, `/`) →
Add (`+`, `-`, `$+`) → Compare/Membership/Type → And (`?and`, `!and`)
→ Or (`?or`, `!or`) → Flow (`+>`, `<+`, `#>`, all `~`-comprehensions,
`~<`). All tiers left-associative.

Tier iter names: `FlowBinExpr`, `OrBinExpr`, `AndBinExpr`,
`CompareBinExpr`, `AddBinExpr`, `MulBinExpr`. Each is a distinct
visible AST node.

## §10 Operator Family

```ebnf
(* Op (used in OpFuncExpr) is the full union of operators —
   anything that can be quoted as a function value. *)

<Op>             := FlowOp | OrOp | AndOp | CompareOp | AddOp | MulOp | NamedUnaryOp | UnaryOpSym;

<FlowOp>         := ComprOp | PipelineOp | ComposeOp;
<ComprOp>        := Comprehension | (Tilde OpenAngle);
<PipelineOp>     := Hash CloseAngle;
<ComposeOp>      := (Plus CloseAngle) | (OpenAngle Plus);

<OrOp>           := "?or" | "!or";
<AndOp>          := "?and" | "!and";

<CompareOp>      := NamedCompareOp | SymbolicCompareOp;
<NamedCompareOp> := "?in" | "!in" | "?has" | "!has" | "?as" | "!as";
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
BlockExpr             := BlockDefsInitOpt? _ BareBlockExpr (_ AsAnnotationExpr)?;
DefBlockStmt          := "def" _ BlockDefsInit _ BareBlockExpr;
<BareBlockExpr>       := OpenBrace _ BlockStmts _ CloseBrace;
<BlockStmts>          := (StmtSemi _)* StmtSemiOpt?;

<BlockDefsInit>       := OpenParen _ VarDefInitList _ CloseParen;
<BlockDefsInitOpt>    := OpenParen _ VarDefInitOptList _ CloseParen;

<VarDefInitList>      := VarDefInit (_ Comma _ VarDefInit)* (_ Comma)?;
<VarDefInitOptList>   := (_ Comma)* (VarDefInitOpt (_ Comma (_ VarDefInitOpt)?)*)?;

VarDefInit            := (Identifier | DestructureTarget) _ Colon _ ExprNoBlock;
<VarDefInitOpt>       := (Identifier        (_ Colon _ ExprNoBlock)?)
                       | (DestructureTarget (_ Colon _ ExprNoBlock)?);
```

## §12 Assignment

```ebnf
(* LHS restricted to identifier with optional single-access per
   Grammar.md. Excludes multi-pick assignment and pipeline-topic
   assignment. No :as tail — parenthesize. *)

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

<ParameterList>       := VarDefInitOpt (_ Comma _ VarDefInitOpt)*;
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
CondClause            := (Qmark | Exmark) BracketExpr;
GuardedExpr           := CondClause _ Colon _ Expr (_ AsAnnotationExpr)?;
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

DepMatchExpr           := Qmark OpenParen _ ExprNoBlock _ CloseParen _ OpenBrace _ DepMatchStmts _ CloseBrace;
<DepMatchStmts>        := ((DepPatternStmt _)+ (ElseStmt | DepPatternStmtNoSemi)?)
                        | DepPatternStmtNoSemi
                        | ElseStmt;
DepPatternStmt         := DepCondClause _ MatchConsequent (_ Semicolon)*;
DepPatternStmtNoSemi   := DepCondClause _ MatchConsequentNoSemi;
<DepCondClause>        := (Qmark | Exmark)? OpenBracket _ DepCondExprList _ CloseBracket;
<DepCondExprList>      := DepCondExprAtom (_ Comma _ DepCondExprAtom)* (_ Comma)?;
<DepCondExprAtom>      := DepCondBoolExpr | ExprNoBlock;
<DepCondBoolExpr>      := DepCondBoolOp _ <CompareDispatch>
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

## §16 Do-Comprehensions

```ebnf
DoComprExpr             := (Identifier | BuiltIn) _ Tilde OpenAngle OpenAngle _ DoBlockExpr;

<DoBlockExpr>           := DoBlockDefsInitOpt? _ DoBareBlockExpr;
<DoBareBlockExpr>       := OpenBrace _ DoBlockStmts _ CloseBrace;
<DoBlockStmts>          := (DoStmtSemi _)* (DoFinalUnwrapExpr | DoStmtSemiOpt)?;
<DoBlockDefsInitOpt>    := OpenParen _ DoVarDefInitOptList _ CloseParen;

<DoVarDefInitOptList>   := (_ Comma)* (DoVarDefInitOpt (_ Comma (_ DoVarDefInitOpt)?)*)?;
<DoVarDefInitOpt>       := (Identifier        (_ (DoubleColon | Colon) _ ExprNoBlock)?)
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

## §17 Data Structure Literals

```ebnf
<DataStructLit>        := SetLit | RecordTupleLit;     (* SetLit first — opens with OpenAngle OpenBracket (2 tokens); RecordTupleLit opens with just OpenAngle (1 token) *)

RecordTupleLit         := OpenAngle _ RecordTupleEntryList _ CloseAngle (_ AsAnnotationExpr)?;
<RecordTupleEntryList> := (_ Comma)* (RecordTupleEntry (_ Comma (_ RecordTupleEntry)?)*)?;
<RecordTupleEntry>     := PickValue | RecordProperty | RecordTupleValue;

<RecordTupleValue>     := CallExpr | EmptyLit | BooleanLit | NumberLit | StringLit | DataStructLit
                        | IdentifierExpr | (OpenParen _ RecordTupleValue _ CloseParen);

PickValue              := Ampersand IdentBase MultiAccessExpr?;
<RecordProperty>       := ConcisePropDef | ExplicitPropDef;
ConcisePropDef         := Colon PropertyExpr;
ExplicitPropDef        := (ComputedPropName | PropertyExpr) _ Colon _ RecordTupleValue;
<ComputedPropName>     := Percent (PipelineTopic | IdentifierExpr | StringLit);

SetLit                 := OpenAngle OpenBracket _ SetEntryList _ CloseBracket CloseAngle (_ AsAnnotationExpr)?;
<SetEntryList>         := (_ Comma)* (SetEntry (_ Comma (_ SetEntry)?)*)?;
<SetEntry>             := PickValue | RecordTupleValue;
```

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
