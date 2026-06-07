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
  `Comment`, `String`, `StringEscapedChar`, `Hyphen`, `DoubleColon`,
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
combinator impl — they appear as named nodes in the AST.

A few visible productions emit AST nodes whose type differs from the
EBNF name (aliases). Inline comments flag each one. Two alias families
appear repeatedly:
- `Grouped*` productions all emit `GroupedExpr` (different inner
  grammars enforce context-specific restrictions on what's allowed
  inside parens; AST shape is uniform).
- `SingleAccessExpr` and `MultiAccessExpr` both emit `AccessExpr`.

**Trivia is explicit.** Two hidden helpers:

```ebnf
<_>  := (Whitespace | Comment)*;       (* optional trivia *)
<__> := _ Whitespace _;                (* required Whitespace *)
```

**`:as` annotations** attach as a final optional child of the thing
they modify. Productions carrying `(_ AsAnnotationExpr)?`:
- `GroupedExpr` family
- `BlockExpr`
- All literal leaves (`EmptyLit`, `BooleanLit`, `NumberLit`, four
  `StringLit` variants, `DataStructLit`'s two forms, `ClosedRangeExpr`)
- `IdentifierExpr`'s four arms, `OpFuncExpr`, `CallChainExpr`,
  `AtCallExpr`, `ExprAccessExpr`
- `UnaryExpr`'s three arms, `GuardedExpr`

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

(* NumberLit: either a bare decimal Number token or an Escape+Number
   pair (via lex's hidden EscapedNumber dispatch, which splices its
   six (Escape variant, Number variant) pairs as direct children). *)
NumberLit          := (EscapedNumber | Number) (_ AsAnnotationExpr)?;

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
(* Vertical dispatchers hidden — pure parser routing. Paren-grouping
   productions are visible, all aliased to GroupedExpr (preserves
   user-written parens; inner grammar varies by context). *)

<Expr>                 := ExprNoBlock | BlockExpr | DoComprExpr | DoLoopComprExpr | GroupedExpr;
GroupedExpr            := OpenParen _ Expr _ CloseParen (_ AsAnnotationExpr)?;

<ExprNoBlock>          := DefFuncExpr | AssignmentExpr | MatchExpr | GuardedExpr | ExprAccessExpr | OperandExpr | GroupedExprNoBlock;
GroupedExprNoBlock     := OpenParen _ ExprNoBlock _ CloseParen (_ AsAnnotationExpr)?;        (* emitted as GroupedExpr *)

<OperandExpr>          := BinaryExpr;

<BareOperandExpr>      := EmptyLit | BareOperandExprNoEmpty | GroupedBareOperandExpr;
GroupedBareOperandExpr := OpenParen _ BareOperandExpr _ CloseParen (_ AsAnnotationExpr)?;    (* emitted as GroupedExpr *)

<BareOperandExprNoEmpty> := BooleanLit | NumberLit | StringLit | DataStructLit | ClosedRangeExpr | CallExpr | IdentifierExpr | OpFuncExpr | GroupedBareOpExprNoEmp;
GroupedBareOpExprNoEmp := OpenParen _ BareOperandExprNoEmpty _ CloseParen (_ AsAnnotationExpr)?;  (* emitted as GroupedExpr *)

GroupedOperandExpr     := OpenParen _ OperandExpr _ CloseParen (_ AsAnnotationExpr)?;        (* emitted as GroupedExpr *)

AsAnnotationExpr       := ":as" _ NamedType;        (* NamedType — forward ref to §19 *)
```

PEG ordering note: in `<BareOperandExprNoEmpty>`, `CallExpr` precedes
`IdentifierExpr` so that `foo@ 5` (an `AtCallExpr`) is preferred
over `foo@` (an `AtExpr` alone with dangling `5`).

## §6 Identifier / Access Expressions

```ebnf
(* IdentifierSingleExpr / IdentifierMultiExpr collapsed into
   IdentifierAccessExpr (uses MultiAccessExpr — the superset).
   DotSingleIdentifier / DotMultiIdentifier collapsed into
   DotIdentifier (the Grammar.md `-`?-vs-no-`-` distinction was
   char-level; Number carries its sign at our token level). *)

<IdentifierExpr>     := MonadConstructor | AtExpr | IdentifierAccessExpr | BareIdentifier;

MonadConstructor     := At (_ AsAnnotationExpr)?;
AtExpr               := IdentBase SingleAccessExpr? At (_ AsAnnotationExpr)?;
IdentifierAccessExpr := IdentBase _ MultiAccessExpr (_ AsAnnotationExpr)?;
BareIdentifier       := IdentBase (_ AsAnnotationExpr)?;

<IdentBase>          := PipelineTopic | Identifier | BuiltIn;

SingleAccessExpr     := SingleAccessSeg (_ SingleAccessSeg)*;     (* emitted as AccessExpr *)
<SingleAccessSeg>    := DotIdentifier | BracketExpr;

MultiAccessExpr      := MultiAccessSeg (_ MultiAccessSeg)*;       (* emitted as AccessExpr *)
<MultiAccessSeg>     := DotIdentifier | BracketExpr | DotBracketExpr | DotAngleExpr;

DotIdentifier        := Period _ (Identifier | BuiltIn | Number);
BracketExpr          := OpenBracket _ ExprNoBlock _ CloseBracket;
DotBracketExpr       := Period OpenBracket _ RangeExpr _ CloseBracket;
DotAngleExpr         := Period OpenAngle _ AnglePropertyList _ CloseAngle;

<AnglePropertyList>  := PropertyExpr (_ Comma _ PropertyExpr)* (_ Comma)?;
<PropertyExpr>       := Identifier | PositiveIntLit;

(* PositiveIntLit: same structure as NumberLit but no :as tail and
   constrained to positive integers (no leading "-"). The gate is
   impl-level — checks the Number child's value. *)
PositiveIntLit       := EscapedNumber | Number;    (* gated: positive integers only *)

<RangeExpr>          := ClosedRangeExpr | LeadingRangeExpr | TrailingRangeExpr;
ClosedRangeExpr      := (ExprNoBlock | GroupedExpr) _ DoublePeriod _ (ExprNoBlock | GroupedExpr) (_ AsAnnotationExpr)?;
LeadingRangeExpr     := (ExprNoBlock | GroupedExpr) _ DoublePeriod;
TrailingRangeExpr    := DoublePeriod _ (ExprNoBlock | GroupedExpr);


(* Grammar.md's ExprAccessExpr was directly left-recursive through
   ExprNoBlock. Refactored: required trailing MultiAccessExpr beyond
   what the base captured. IdentifierExpr handles its own access
   chain greedily, so this picks up access on non-identifier bases
   (grouped exprs, call results, match results, etc.). *)

ExprAccessExpr       := ExprAccessBase _ MultiAccessExpr (_ AsAnnotationExpr)?;
<ExprAccessBase>     := DefFuncExpr | AssignmentExpr | MatchExpr | GuardedExpr | OperandExpr | GroupedExpr;
```

## §7 Function Calls / Op-as-Function

```ebnf
(* Grammar.md's PrefixCallExpr / PartialCallExpr were indirectly
   left-recursive (callable → ExprNoBlock → ... → CallExpr).
   Refactored to iterative: CallBase (non-call expression) followed
   by one or more call suffixes. `foo(a)(b)` parses flat. *)

<CallExpr>           := AtCallExpr | CallChainExpr;

CallChainExpr        := CallBase (_ CallSuffix)+ (_ AsAnnotationExpr)?;
<CallBase>           := IdentifierExpr | DefFuncExpr | OpFuncExpr | ExprAccessExpr | GroupedExpr;

<CallSuffix>         := PrefixCallSuffix | PartialCallSuffix;
PrefixCallSuffix     := OpenParen CallArgs CloseParen;
PartialCallSuffix    := Pipe CallArgs Pipe;

AtCallExpr           := "None" At (_ AsAnnotationExpr)?
                      | (AtExpr | (IdentBase _ At) | MonadConstructor) _ ExprNoBlock (_ AsAnnotationExpr)?;

<CallArgs>           := (_ CallArgList? _) | (Op SingleQuote?);
<CallArgList>        := (_ Comma)* (CallArgExpr (_ Comma (_ CallArgExpr)?)*)?;
<CallArgExpr>        := (TriplePeriod _)? (NamedArgExpr | Expr);

<NamedArgExpr>       := ConciseNamedArg | ExplicitNamedArg | (OpenParen _ NamedArgExpr _ CloseParen);
ConciseNamedArg      := Colon Identifier;
ExplicitNamedArg     := Identifier _ Colon _ Expr;

OpFuncExpr           := OpenParen (Op | DotAngleExpr | DotBracketExpr | (OpenBracket CloseBracket)) SingleQuote? CloseParen (_ AsAnnotationExpr)?;
```

PEG ordering note: `AtCallExpr` precedes `CallChainExpr` in
`<CallExpr>` so that `foo@ 5` reaches the at-form first.

## §8 Unary Expressions

```ebnf
(* Unary operand restricted to BinaryAtom (tier-1) — `?x + 5` parses
   as `(?x) + 5`. Use parens for broader operands: `?(x + 5)`. *)

<UnaryExpr>       := NamedUnaryExpr | SymbolicUnaryExpr | PostfixUnaryExpr;

NamedUnaryExpr    := ("?empty" | "!empty") _ BinaryAtom (_ AsAnnotationExpr)?;
SymbolicUnaryExpr := (Qmark | Exmark) _ BinaryAtom (_ AsAnnotationExpr)?;
PostfixUnaryExpr  := (BareOperandExpr | GroupedExpr) SingleQuote (_ AsAnnotationExpr)?;
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

   All iters emit BinaryExpr. No `:as` on any tier — parenthesize.

   Flow tier extensions: LHS may be a CondClause (for `~each`-style
   range-as-conditional); RHS may be a BlockExpr (for
   comprehension iteration / pipeline body). Other tiers allow
   neither. Semantic validity for non-`~each`/non-comprehension
   ops with these extensions is checked downstream. *)

<BinaryExpr>     := <FlowDispatch>;

<FlowDispatch>   := FlowExpr | <OrDispatch>;
FlowExpr         := <FlowLHS> (_ FlowOp _ <FlowRHS>)+;             (* emitted as BinaryExpr *)
<FlowLHS>        := CondClause | <OrDispatch>;
<FlowRHS>        := BlockExpr | <OrDispatch>;

<OrDispatch>     := OrBinExpr | <AndDispatch>;
OrBinExpr        := <AndDispatch> (_ OrOp _ <AndDispatch>)+;       (* emitted as BinaryExpr *)

<AndDispatch>    := AndBinExpr | <CompareDispatch>;
AndBinExpr       := <CompareDispatch> (_ AndOp _ <CompareDispatch>)+;  (* emitted as BinaryExpr *)

<CompareDispatch>:= CompareBinExpr | <AddDispatch>;
CompareBinExpr   := <AddDispatch> (_ CompareOp _ <AddDispatch>)+;  (* emitted as BinaryExpr *)

<AddDispatch>    := AddBinExpr | <MulDispatch>;
AddBinExpr       := <MulDispatch> (_ AddOp _ <MulDispatch>)+;      (* emitted as BinaryExpr *)

<MulDispatch>    := MulBinExpr | BinaryAtom;
MulBinExpr       := BinaryAtom (_ MulOp _ BinaryAtom)+;            (* emitted as BinaryExpr *)

<BinaryAtom>     := UnaryExpr | BareOperandExpr | GroupedOperandExpr;
```

**Precedence (tightest → loosest):** Unary → Mul (`*`, `/`) →
Add (`+`, `-`, `$+`) → Compare/Membership/Type → And (`?and`, `!and`)
→ Or (`?or`, `!or`) → Flow (`+>`, `<+`, `#>`, all `~`-comprehensions,
`~<`). All tiers left-associative.

## §10 Operator Family

```ebnf
(* Op (used in OpFuncExpr) is the full union of operators —
   anything that can be quoted as a function value. *)

<Op>             := FlowOp | OrOp | AndOp | CompareOp | AddOp | MulOp | UnaryOpSym;

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

<UnaryOpSym>     := Qmark | Exmark | SingleQuote | TriplePeriod | DoublePeriod;
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

VarDefInit            := Identifier _ Colon _ ExprNoBlock;
<VarDefInitOpt>       := (Identifier (_ Colon _ ExprNoBlock)?) | DestructureTarget;
```

## §12 Assignment

```ebnf
(* LHS restricted to identifier with optional single-access per
   Grammar.md. Excludes multi-pick assignment and pipeline-topic
   assignment. No :as tail — parenthesize. *)

AssignmentExpr        := (Identifier | (IdentBase SingleAccessExpr)) _ Colon Equal _ Expr;
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
FuncBodyExpr          := Caret _ ExprNoBlock;
FuncBodyPipeline      := PipelineOp _ (ExprNoBlock | BlockExpr | GroupedExpr);
FuncBodyBlock         := OpenBrace _ FuncBodyStmts _ CloseBrace;

<FuncBodyStmts>       := (FuncBodyStmtSemi _)* FuncBodyStmtSemiOpt?;
<FuncBodyStmtSemi>    := FuncBodyStmt (_ Semicolon)+;
<FuncBodyStmtSemiOpt> := FuncBodyStmt (_ Semicolon)*;
<FuncBodyStmt>        := ReturnExpr | Stmt;
ReturnExpr            := Caret _ Expr;
```

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
IndepPatternStmtNoSemi := IndepCondClause _ MatchConsequentNoSemi;     (* emitted as IndepPatternStmt *)
<IndepCondClause>      := (Qmark | Exmark)? BracketExpr;

DepMatchExpr           := Qmark OpenParen _ ExprNoBlock _ CloseParen _ OpenBrace _ DepMatchStmts _ CloseBrace;
<DepMatchStmts>        := ((DepPatternStmt _)+ (ElseStmt | DepPatternStmtNoSemi)?)
                        | DepPatternStmtNoSemi
                        | ElseStmt;
DepPatternStmt         := DepCondClause _ MatchConsequent (_ Semicolon)*;
DepPatternStmtNoSemi   := DepCondClause _ MatchConsequentNoSemi;       (* emitted as DepPatternStmt *)
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

## §16 Do-Comprehensions

```ebnf
DoComprExpr             := (Identifier | BuiltIn) _ Tilde OpenAngle OpenAngle _ DoBlockExpr;

<DoBlockExpr>           := DoBlockDefsInitOpt? _ DoBareBlockExpr;
<DoBareBlockExpr>       := OpenBrace _ DoBlockStmts _ CloseBrace;
<DoBlockStmts>          := (DoStmtSemi _)* (DoStmtSemiOpt | DoFinalUnwrapExpr)?;
<DoBlockDefsInitOpt>    := OpenParen _ DoVarDefInitOptList _ CloseParen;

<DoVarDefInitOptList>   := (_ Comma)* (DoVarDefInitOpt (_ Comma (_ DoVarDefInitOpt)?)*)?;
<DoVarDefInitOpt>       := (Identifier (_ (DoubleColon | Colon) _ ExprNoBlock)?) | DestructureTarget;

DoDefVarStmt            := "def" _ (Identifier | DestructureTarget) _ DoubleColon _ Expr;
<DoStmt>                := DoDefVarStmt | Stmt;
<DoStmtSemi>            := DoStmt? (_ Semicolon)+;
<DoStmtSemiOpt>         := DoStmt? (_ Semicolon)*;
DoFinalUnwrapExpr       := DoubleColon _ ExprNoBlock (_ Semicolon)*;

DoLoopComprExpr         := (ExprNoBlock | GroupedExpr) _ Tilde OpenAngle Star _ DoLoopIterationExpr;
<DoLoopIterationExpr>   := DoBlockExpr | DoLoopIterNoBlockExpr;
<DoLoopIterNoBlockExpr> := IdentifierExpr | CallExpr | ExprAccessExpr | (OpenParen _ DoLoopIterNoBlockExpr _ CloseParen);
```

## §17 Data Structure Literals

```ebnf
<DataStructLit>        := SetLit | RecordTupleLit;     (* SetLit first — opens with OpenAngle OpenBracket (2 tokens); RecordTupleLit opens with just OpenAngle (1 token) *)

RecordTupleLit         := OpenAngle _ RecordTupleEntryList _ CloseAngle (_ AsAnnotationExpr)?;
<RecordTupleEntryList> := (_ Comma)* (RecordTupleEntry (_ Comma (_ RecordTupleEntry)?)*)?;
<RecordTupleEntry>     := PickValue | RecordProperty | RecordTupleValue;

<RecordTupleValue>     := EmptyLit | BooleanLit | NumberLit | StringLit | DataStructLit
                        | IdentifierExpr | CallExpr | (OpenParen _ RecordTupleValue _ CloseParen);

PickValue              := Ampersand IdentifierExpr;
<RecordProperty>       := ConcisePropDef | ExplicitPropDef;
ConcisePropDef         := Colon PropertyExpr;
ExplicitPropDef        := (ComputedPropName | PropertyExpr) _ Colon _ RecordTupleValue;
<ComputedPropName>     := Percent (PipelineTopic | IdentifierExpr | StringLit);

SetLit                 := OpenAngle OpenBracket _ SetEntryList _ CloseBracket CloseAngle (_ AsAnnotationExpr)?;
<SetEntryList>         := (_ Comma)* (SetEntry (_ Comma (_ SetEntry)?)*)?;
<SetEntry>             := PickValue | RecordTupleValue;
```

## §19 Type Definitions

```ebnf
(* Deferred — own sub-grammar pass. Placeholder. *)

DefTypeStmt            := "deft" _ Identifier _ NamedType;
NamedType              := ???;     (* TBD *)
```

---

## Filed Open Concerns

- **`PositiveIntLit` gate** (`§6`). "Number value doesn't start
  with `-`" is impl-level; EBNF can't express it. The gate now has
  to inspect the Number child's value regardless of which arm
  (EscapedNumber pair or bare Number) matched.
- **PEG ordering in `<ExprAccessBase>`, `<CallBase>`,
  `<ExprNoBlock>`** — written approximate; firm up during
  implementation against real source.
- **`AssignmentExpr` and `:as` interaction** — `:=` excluded from
  `:as`-bearing forms. May revisit if `x := (3 :as int)` vs
  `(x := 3) :as int` ambiguity has a strongly preferred
  interpretation in practice.
- **§18 numbering gap** — Type defs is §19; nothing at §18. Renumber
  during the next pass once §19 is drafted.
- **`DefTypeStmt` deferred** — own sub-grammar pass after the rest
  of the grammar is verified against real Foi source.
- **Performance**: bare atoms traverse 7 tier dispatchers (§9). No
  memoization in the combinator lib. Profile after real source
  runs through.
