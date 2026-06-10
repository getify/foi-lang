// parser.js — Foi syntactic parser. Operates over tokens from tokenizer.js.

import {
	lazy, parse, production, terminal,
	and, or, optional, any, many,
	not, lookahead, eof, gate, dispatch,
	delim, delimWSReq, presets, shapeNode,
} from "./parser-combinators.js";

import { tokenize } from "./tokenizer.js";


// =============================================================
// TOKEN-MATCHING HELPERS
// =============================================================

var tokType = name           => terminal(t => t && t.type === name);
var tokVal  = (name, value)  => terminal(t => t && t.type === name && t.value === value);


// =============================================================
// SHAPERS
// Map of production name → shaper. Each shaper receives the raw
// frame and the recursively-shaped children array. Productions not
// in this map use the default shape (type/children/tokens/start/end).
// =============================================================

export const shapers = {
	// (added section-by-section as productions are implemented)
};


// =============================================================
// PRODUCTIONS
// EBNF in Syntactic-Grammar.md is the source of truth.
// =============================================================

// =============================================================
// §1 PROGRAM / STATEMENTS
// =============================================================

// <Stmt> := DefBlockStmt | DefVarStmt | DefTypeStmt | Expr;
var Stmt = or(
	lazy(() => DefBlockStmt),
	lazy(() => DefVarStmt),
	lazy(() => DefTypeStmt),
	lazy(() => Expr)
);

var Semicolon = tokType("Semicolon");

// <StmtSemi>          := Stmt? (_ Semicolon)+;
// <StmtSemiOpt>       := Stmt? (_ Semicolon)*;
// <ExportStmtSemi>    := ExportExpr (_ Semicolon)+;
// <ExportStmtSemiOpt> := ExportExpr (_ Semicolon)*;
var StmtSemi          = and(optional(Stmt),                 many(and(delim(), Semicolon)));
var StmtSemiOpt       = and(optional(Stmt),                 any (and(delim(), Semicolon)));
var ExportStmtSemi    = and(lazy(() => ExportExpr),         many(and(delim(), Semicolon)));
var ExportStmtSemiOpt = and(lazy(() => ExportExpr),         any (and(delim(), Semicolon)));

// Program := _ ((StmtSemi | ExportStmtSemi) _)*
//            ((StmtSemiOpt | ExportStmtSemiOpt) _)?;
export const Program = production("Program",
	and(
		delim(),
		any(and(or(StmtSemi, ExportStmtSemi), delim())),
		optional(and(or(StmtSemiOpt, ExportStmtSemiOpt), delim())),
		eof()
	)
);

// Identifier    := General;
// BuiltIn       := Builtin;
// PipelineTopic := Hash;
export const Identifier    = production("Identifier",    tokType("General"));
export const BuiltIn       = production("BuiltIn",       tokType("Builtin"));
export const PipelineTopic = production("PipelineTopic", tokType("Hash"));


// =============================================================
// §2 LITERALS
// =============================================================

var OptAsAnnotation = optional(and(delim(), lazy(() => AsAnnotationExpr)));

// Integer-lit token matchers and the hidden <IntegerLit> union from
// the lex layer. Used by §2 NumberLit and §6 DotIdentifier. The
// positive-only form is referenced separately by §6 PositiveIntLit
// (property-index contexts; sign disallowed).
var PositiveIntegerLitTok = tokType("PositiveIntegerLit");
var NegativeIntegerLitTok = tokType("NegativeIntegerLit");
var IntegerLit            = or(NegativeIntegerLitTok, PositiveIntegerLitTok);

// NumberLit := (EscapedNumber | Number | IntegerLit) (_ AsAnnotationExpr)?;
//
// The lex layer's EscapedNumber is a hidden dispatcher that splices an
// (Escape variant, Number variant) pair as siblings. From the syn layer
// we consume it as two adjacent tokens: an Escape followed by a Number.
// PEG order: try the two-token escaped form first, then bare Number,
// then bare IntegerLit (longest first, per Note 2 in the lex grammar).
// IntegerLit covers both signs via the hidden union from Lexical-Grammar.md.
export const NumberLit = production("NumberLit",
	and(
		or(
			and(tokType("Escape"), tokType("Number")),
			tokType("Number"),
			IntegerLit
		),
		OptAsAnnotation
	)
);

// BooleanLit := ("true" | "false") (_ AsAnnotationExpr)?;
export const BooleanLit = production("BooleanLit",
	and(
		or(tokVal("Native", "true"), tokVal("Native", "false")),
		OptAsAnnotation
	)
);

// EmptyLit := "empty" (_ AsAnnotationExpr)?;
export const EmptyLit = production("EmptyLit",
	and(tokVal("Native", "empty"), OptAsAnnotation)
);

// Lex token-name shortcuts used inside string forms.
var DoubleQuote            = tokType("DoubleQuote");
var Backtick               = tokType("Backtick");
var StringEscapedChar      = tokType("StringEscapedChar");
var StringChars            = tokType("String");      // PlainStrChars/InterpStrChars/etc. all emit "String"
var WhitespaceTok          = tokType("Whitespace");
var EscapePlainTok         = tokVal("Escape", "\\");
var EscapeBacktickTok      = tokVal("Escape", "`");
var EscapeSpacingBacktickTok = tokVal("Escape", "\\`");

// PlainStr := DoubleQuote PlainStrContent* DoubleQuote (_ AsAnnotationExpr)?;
// <PlainStrContent> := PlainStrChars | StringEscapedChar;
var PlainStrContent = or(StringChars, StringEscapedChar);
export const PlainStr = production("PlainStr",
	and(DoubleQuote, any(PlainStrContent), DoubleQuote, OptAsAnnotation)
);

// SpacingEscapedStr := EscapePlain DoubleQuote SpacingEscapedStrContent* DoubleQuote (_ AsAnnotationExpr)?;
// <SpacingEscapedStrContent> := SpacingEscapedStrChars | StringEscapedChar | Whitespace;
var SpacingEscapedStrContent = or(StringChars, StringEscapedChar, WhitespaceTok);
export const SpacingEscapedStr = production("SpacingEscapedStr",
	and(EscapePlainTok, DoubleQuote, any(SpacingEscapedStrContent), DoubleQuote, OptAsAnnotation)
);

// InterpStr := EscapeBacktick DoubleQuote InterpStrContent* DoubleQuote (_ AsAnnotationExpr)?;
// <InterpStrContent> := InterpStrChars | StringEscapedChar | InterpExpr;
var InterpStrContent = or(StringChars, StringEscapedChar, lazy(() => InterpExpr));
export const InterpStr = production("InterpStr",
	and(EscapeBacktickTok, DoubleQuote, any(InterpStrContent), DoubleQuote, OptAsAnnotation)
);

// SpacingInterpStr := EscapeSpacingBacktick DoubleQuote SpacingInterpStrContent* DoubleQuote (_ AsAnnotationExpr)?;
// <SpacingInterpStrContent> := SpacingInterpStrChars | StringEscapedChar | Whitespace | InterpExpr;
var SpacingInterpStrContent = or(StringChars, StringEscapedChar, WhitespaceTok, lazy(() => InterpExpr));
export const SpacingInterpStr = production("SpacingInterpStr",
	and(EscapeSpacingBacktickTok, DoubleQuote, any(SpacingInterpStrContent), DoubleQuote, OptAsAnnotation)
);

// InterpExpr := Backtick _ Expr _ Backtick;
var InterpExpr = production("InterpExpr",
	and(Backtick, delim(), lazy(() => Expr), delim(), Backtick)
);

// <StringLit> := PlainStr | SpacingEscapedStr | InterpStr | SpacingInterpStr;
var StringLit = or(PlainStr, SpacingEscapedStr, InterpStr, SpacingInterpStr);

// =============================================================
// §3 IMPORTS / EXPORTS
// =============================================================

var OpenBrace  = tokType("OpenBrace");
var CloseBrace = tokType("CloseBrace");
var Comma      = tokType("Comma");
var Colon      = tokType("Colon");

var KwImport = tokVal("Keyword", "import");
var KwExport = tokVal("Keyword", "export");

// ImportExpr := "import" _ PlainStr;
var ImportExpr = production("ImportExpr",
	and(KwImport, delim(), PlainStr)
);

// ExportNamedBinding   := Identifier _ Colon _ Identifier MultiAccessExpr?;
// ExportConciseBinding := Colon Identifier SingleAccessExpr?;
//
// MultiAccessExpr and SingleAccessExpr are defined in §6.
var ExportNamedBinding = production("ExportNamedBinding",
	and(Identifier, delim(), Colon, delim(), Identifier, optional(lazy(() => MultiAccessExpr)))
);

var ExportConciseBinding = production("ExportConciseBinding",
	and(Colon, Identifier, optional(lazy(() => SingleAccessExpr)))
);

// <ExportBinding>      := ExportNamedBinding | ExportConciseBinding;
// <ExportBindingsList> := ExportBinding (_ Comma _ ExportBinding)* (_ Comma)?;
var ExportBinding      = or(ExportNamedBinding, ExportConciseBinding);
var ExportBindingsList = and(
	ExportBinding,
	any(and(delim(), Comma, delim(), ExportBinding)),
	optional(and(delim(), Comma))
);

// ExportExpr := "export" _ OpenBrace _ ExportBindingsList _ CloseBrace;
var ExportExpr = production("ExportExpr",
	and(KwExport, delim(), OpenBrace, delim(), ExportBindingsList, delim(), CloseBrace)
);


// =============================================================
// §4 VARIABLE DEFINITIONS / DESTRUCTURING
// =============================================================

var OpenAngle  = tokType("OpenAngle");
var CloseAngle = tokType("CloseAngle");
var Hash       = tokType("Hash");

var KwDef = tokVal("Keyword", "def");

// DestructureNamedDef   := Identifier _ Colon _ (Identifier | BracketExpr) MultiAccessExpr?;
// DestructureConciseDef := Colon Identifier SingleAccessExpr?;
// DestructureCapture    := Hash Identifier;
//
// BracketExpr / MultiAccessExpr / SingleAccessExpr are defined in §6.
var DestructureNamedDef = production("DestructureNamedDef",
	and(
		Identifier, delim(), Colon, delim(),
		or(Identifier, lazy(() => BracketExpr)),
		optional(lazy(() => MultiAccessExpr))
	)
);

var DestructureConciseDef = production("DestructureConciseDef",
	and(Colon, Identifier, optional(lazy(() => SingleAccessExpr)))
);

var DestructureCapture = production("DestructureCapture",
	and(Hash, Identifier)
);

// <DestructureDef>     := DestructureNamedDef | DestructureConciseDef | DestructureCapture;
// <DestructureDefList> := DestructureDef (_ Comma _ DestructureDef)* (_ Comma)?;
var DestructureDef     = or(DestructureNamedDef, DestructureConciseDef, DestructureCapture);
var DestructureDefList = and(
	DestructureDef,
	any(and(delim(), Comma, delim(), DestructureDef)),
	optional(and(delim(), Comma))
);

// DestructureTarget := OpenAngle _ DestructureDefList _ CloseAngle;
var DestructureTarget = production("DestructureTarget",
	and(OpenAngle, delim(), DestructureDefList, delim(), CloseAngle)
);

// DefVarStmt := "def" _ (Identifier | DestructureTarget) _ Colon _ (Expr | ImportExpr);
var DefVarStmt = production("DefVarStmt",
	and(
		KwDef, delim(),
		or(Identifier, DestructureTarget),
		delim(), Colon, delim(),
		or(lazy(() => Expr), ImportExpr)
	)
);


// =============================================================
// §5 EXPRESSION SCAFFOLDING
// =============================================================

var OpenParen  = tokType("OpenParen");
var CloseParen = tokType("CloseParen");

var KwAs = tokVal("Keyword", ":as");

// AsAnnotationExpr := ":as" _ NamedType;
//
// NamedType is §18; forward-ref via lazy() since §18 appears later
// in this file.
export const AsAnnotationExpr = production("AsAnnotationExpr",
	and(KwAs, delim(), lazy(() => NamedType))
);

// <Expr> := DoComprExpr | DoLoopComprExpr | BlockExpr | ExprNoBlock | GroupedExpr;
//
// PEG ordering: BlockExpr precedes ExprNoBlock so `(x){y;}` parses
// as a BlockExpr (bare-identifier def `x`, body `{y;}`) rather
// than ExprNoBlock's GroupedExprNoBlock `(x)` with dangling
// `{y;}`. BlockExpr fails-through to ExprNoBlock when no `{`
// follows the optional defs-init.
var Expr = or(
	lazy(() => DoComprExpr),
	lazy(() => DoLoopComprExpr),
	lazy(() => BlockExpr),
	lazy(() => ExprNoBlock),
	lazy(() => GroupedExpr)
);

// <ExprNoBlock> := DefFuncExpr | AssignmentExpr | MatchExpr | GuardedExpr | OperandExpr | GroupedExprNoBlock;
var ExprNoBlock = or(
	lazy(() => DefFuncExpr),
	lazy(() => AssignmentExpr),
	lazy(() => MatchExpr),
	lazy(() => GuardedExpr),
	lazy(() => OperandExpr),
	lazy(() => GroupedExprNoBlock)
);

// <OperandExpr> := BinaryExpr;
var OperandExpr = lazy(() => BinaryExpr);

// <BareOperandExpr> := EmptyLit | BareOperandExprNoEmpty | GroupedBareOpExpr;
var BareOperandExpr = or(
	EmptyLit,
	lazy(() => BareOperandExprNoEmpty),
	lazy(() => GroupedBareOpExpr)
);

// <BareOperandExprNoEmpty> := CallExpr | BooleanLit | NumberLit | StringLit | DataStructLit | IdentifierExpr | OpFuncExpr | GroupedBareOpExprNoEmpty;
//
// PEG ordering: CallExpr (= AtCallExpr | ChainExpr) precedes the
// bare literal/identifier forms so `"hi".len` parses as a ChainExpr
// rather than StringLit with dangling `.len`. ChainExpr requires
// ≥1 chain segment — bare bases (a literal alone, an identifier
// alone) fall through to the later alternatives via PEG.
var BareOperandExprNoEmpty = or(
	lazy(() => CallExpr),
	BooleanLit,
	NumberLit,
	StringLit,
	lazy(() => DataStructLit),
	lazy(() => IdentifierExpr),
	lazy(() => OpFuncExpr),
	lazy(() => GroupedBareOpExprNoEmpty)
);

// All five paren-grouping productions are distinct visible AST nodes,
// each named for its inner content. Call sites reference the variant
// whose inner content they allow.

// GroupedExpr := OpenParen _ Expr _ CloseParen (_ AsAnnotationExpr)?;
export const GroupedExpr = production("GroupedExpr",
	and(OpenParen, delim(), Expr, delim(), CloseParen, OptAsAnnotation)
);

// GroupedExprNoBlock := OpenParen _ ExprNoBlock _ CloseParen (_ AsAnnotationExpr)?;
export const GroupedExprNoBlock = production("GroupedExprNoBlock",
	and(OpenParen, delim(), ExprNoBlock, delim(), CloseParen, OptAsAnnotation)
);

// GroupedOpExpr := OpenParen _ OperandExpr _ CloseParen (_ AsAnnotationExpr)?;
export const GroupedOpExpr = production("GroupedOpExpr",
	and(OpenParen, delim(), OperandExpr, delim(), CloseParen, OptAsAnnotation)
);

// GroupedBareOpExpr := OpenParen _ BareOperandExpr _ CloseParen (_ AsAnnotationExpr)?;
export const GroupedBareOpExpr = production("GroupedBareOpExpr",
	and(OpenParen, delim(), BareOperandExpr, delim(), CloseParen, OptAsAnnotation)
);

// GroupedBareOpExprNoEmpty := OpenParen _ BareOperandExprNoEmpty _ CloseParen (_ AsAnnotationExpr)?;
export const GroupedBareOpExprNoEmpty = production("GroupedBareOpExprNoEmpty",
	and(OpenParen, delim(), BareOperandExprNoEmpty, delim(), CloseParen, OptAsAnnotation)
);

// GroupedDoExpr := OpenParen _ (DoComprExpr | DoLoopComprExpr) _ CloseParen (_ AsAnnotationExpr)?;
//
// Lets a do-comprehension appear as a binary operand (always
// parenthesized). Forward refs to §16 via lazy() — DoComprExpr /
// DoLoopComprExpr are defined later in this file. PEG order inside
// matches <Expr> ordering in §5; disjoint at the third token of the
// `~<<` / `~<*` signatures, so the order is mechanical.
export const GroupedDoExpr = production("GroupedDoExpr",
	and(
		OpenParen, delim(),
		or(lazy(() => DoComprExpr), lazy(() => DoLoopComprExpr)),
		delim(), CloseParen,
		OptAsAnnotation
	)
);


// =============================================================
// §6 IDENTIFIER / ACCESS EXPRESSIONS
// =============================================================

var At                    = tokType("At");
var Period                = tokType("Period");
var OpenBracket           = tokType("OpenBracket");
var CloseBracket          = tokType("CloseBracket");
var DoublePeriod          = tokType("DoublePeriod");

// <IdentBase> := PipelineTopic | Identifier | BuiltIn;
var IdentBase = or(PipelineTopic, Identifier, BuiltIn);

// <PositiveIntLit> := (EscapePlain PositiveIntegerLit) | PositiveIntegerLit;
//
// Escape-paired form first (two tokens, longest match), bare token
// as fallback.
var PositiveIntLit = or(
	and(EscapePlainTok, PositiveIntegerLitTok),
	PositiveIntegerLitTok
);

// <PropertyExpr> := Identifier | PositiveIntLit;
var PropertyExpr = or(Identifier, PositiveIntLit);

// <AnglePropertyList> := PropertyExpr (_ Comma _ PropertyExpr)* (_ Comma)?;
var AnglePropertyList = and(
	PropertyExpr,
	any(and(delim(), Comma, delim(), PropertyExpr)),
	optional(and(delim(), Comma))
);

// DotIdentifier := Period _ (Identifier | BuiltIn | IntegerLit);
//
// IntegerLit covers both signs at the lex token level; `arr.-1`
// accesses from the end of an ordered structure. Property-name
// contexts (PropertyExpr, AnglePropertyList, record properties)
// remain positive-only via PositiveIntLit.
export const DotIdentifier = production("DotIdentifier",
	and(Period, delim(), or(Identifier, BuiltIn, IntegerLit))
);

// BracketExpr := OpenBracket _ ExprNoBlock _ CloseBracket;
export const BracketExpr = production("BracketExpr",
	and(OpenBracket, delim(), ExprNoBlock, delim(), CloseBracket)
);

// DotBracketExpr := Period OpenBracket _ RangeExpr _ CloseBracket;
//
// No trivia between Period and OpenBracket (per grammar).
export const DotBracketExpr = production("DotBracketExpr",
	and(Period, OpenBracket, delim(), lazy(() => RangeExpr), delim(), CloseBracket)
);

// DotAngleExpr := Period OpenAngle _ AnglePropertyList _ CloseAngle;
//
// No trivia between Period and OpenAngle.
export const DotAngleExpr = production("DotAngleExpr",
	and(Period, OpenAngle, delim(), AnglePropertyList, delim(), CloseAngle)
);

// SingleAccessExpr := SingleAccessSeg (_ SingleAccessSeg)*;
// <SingleAccessSeg> := DotIdentifier | BracketExpr;
var SingleAccessSeg = or(DotIdentifier, BracketExpr);
export const SingleAccessExpr = production("SingleAccessExpr",
	and(SingleAccessSeg, any(and(delim(), SingleAccessSeg)))
);

// MultiAccessExpr := MultiAccessSeg (_ MultiAccessSeg)*;
// <MultiAccessSeg> := DotIdentifier | BracketExpr | DotBracketExpr | DotAngleExpr;
//
// PEG order: DotIdentifier first (Period + ident/builtin/posint). On
// `.[` or `.<` it fails at the inner-identifier alternative and
// backtracks cleanly, so DotBracketExpr / DotAngleExpr reach those.
var MultiAccessSeg = or(DotIdentifier, BracketExpr, DotBracketExpr, DotAngleExpr);
export const MultiAccessExpr = production("MultiAccessExpr",
	and(MultiAccessSeg, any(and(delim(), MultiAccessSeg)))
);

// MonadConstructor := At (_ AsAnnotationExpr)?;
export const MonadConstructor = production("MonadConstructor",
	and(At, OptAsAnnotation)
);

// AtExpr := IdentBase SingleAccessExpr? At (_ AsAnnotationExpr)?;
//
// No trivia between IdentBase, the optional SingleAccessExpr, and At
// (per grammar). DotIdentifier carries its own internal `_`, so
// `foo.bar@` still works; `foo .bar@` does not.
export const AtExpr = production("AtExpr",
	and(IdentBase, optional(SingleAccessExpr), At, OptAsAnnotation)
);

// BareIdentifier := IdentBase (_ AsAnnotationExpr)?;
export const BareIdentifier = production("BareIdentifier",
	and(IdentBase, OptAsAnnotation)
);

// <IdentifierExpr> := MonadConstructor | AtExpr | BareIdentifier;
//
// All identifier-led access is handled by ChainExpr (§7) now —
// IdentifierExpr is just the bare/at/monad forms.
//
// PEG order:
//   - MonadConstructor (bare @) starts with At — disjoint from IdentBase-led arms.
//   - AtExpr requires a trailing @ — fails fast on identifier-led input without @.
//   - BareIdentifier catches the remainder.
var IdentifierExpr = or(
	MonadConstructor,
	AtExpr,
	BareIdentifier
);

// <RangeOperand> := BareOperandExpr | GroupedOpExpr;
//
// Both alternatives consume tokens before reaching anything that
// could reach Range — no LR.
var RangeOperand = or(BareOperandExpr, GroupedOpExpr);

// ClosedRangeExpr   := RangeOperand _ DoublePeriod _ RangeOperand (_ AsAnnotationExpr)?;
// LeadingRangeExpr  := RangeOperand _ DoublePeriod;
// TrailingRangeExpr := DoublePeriod _ RangeOperand;
export const ClosedRangeExpr = production("ClosedRangeExpr",
	and(RangeOperand, delim(), DoublePeriod, delim(), RangeOperand, OptAsAnnotation)
);
export const LeadingRangeExpr = production("LeadingRangeExpr",
	and(RangeOperand, delim(), DoublePeriod)
);
export const TrailingRangeExpr = production("TrailingRangeExpr",
	and(DoublePeriod, delim(), RangeOperand)
);

// <RangeExpr> := ClosedRangeExpr | LeadingRangeExpr | TrailingRangeExpr;
//
// Closed first (two-sided, longest); Leading next (LHS + `..`);
// Trailing last (opens with `..`, doesn't conflict).
var RangeExpr = or(ClosedRangeExpr, LeadingRangeExpr, TrailingRangeExpr);


// =============================================================
// §7 CHAIN EXPRESSIONS / FUNCTION CALLS / OP-AS-FUNCTION
// =============================================================

var Pipe         = tokType("Pipe");
var TriplePeriod = tokType("TriplePeriod");
var SingleQuote  = tokType("SingleQuote");
var BuiltinNone  = tokVal("Builtin", "None");

// PrefixCallSuffix  := OpenParen CallArgs CloseParen;
// PartialCallSuffix := Pipe       CallArgs Pipe;
export const PrefixCallSuffix = production("PrefixCallSuffix",
	and(OpenParen, lazy(() => CallArgs), CloseParen)
);

export const PartialCallSuffix = production("PartialCallSuffix",
	and(Pipe, lazy(() => CallArgs), Pipe)
);

// <CallSuffix> := PrefixCallSuffix | PartialCallSuffix;
//
// Hidden alias used for the call-suffixes-only tail of the postfix
// `'` form in ChainExpr (the form where access is terminated but
// further calls are allowed).
var CallSuffix = or(PrefixCallSuffix, PartialCallSuffix);

// <ChainSeg> := PrefixCallSuffix | PartialCallSuffix
//             | DotIdentifier | BracketExpr | DotBracketExpr | DotAngleExpr;
//
// Order: call suffixes first (disjoint openers), then access seg
// order mirrors MultiAccessSeg — DotIdentifier before DotBracketExpr
// / DotAngleExpr since `.X` fails fast at the inner-ident alt when X
// is `[` or `<`.
var ChainSeg = or(
	PrefixCallSuffix,
	PartialCallSuffix,
	DotIdentifier,
	BracketExpr,
	DotBracketExpr,
	DotAngleExpr
);

// ConciseNamedArg  := Colon Identifier;
// ExplicitNamedArg := Identifier _ Colon _ Expr;
export const ConciseNamedArg = production("ConciseNamedArg",
	and(Colon, Identifier)
);

export const ExplicitNamedArg = production("ExplicitNamedArg",
	and(Identifier, delim(), Colon, delim(), lazy(() => Expr))
);

// <NamedArgExpr> := ConciseNamedArg | ExplicitNamedArg | (OpenParen _ NamedArgExpr _ CloseParen);
//
// The paren-wrap arm consumes `(` before recursing — no LR.
var NamedArgExpr = or(
	ConciseNamedArg,
	ExplicitNamedArg,
	and(OpenParen, delim(), lazy(() => NamedArgExpr), delim(), CloseParen)
);

// <CallArgExpr> := (TriplePeriod _)? (NamedArgExpr | Expr);
var CallArgExpr = and(
	optional(and(TriplePeriod, delim())),
	or(NamedArgExpr, lazy(() => Expr))
);

// <CallArgList> := (_ Comma)* (CallArgExpr (_ Comma (_ CallArgExpr)?)*)?;
//
// Permissive comma handling — leading commas, trailing commas, and
// gaps between commas are all allowed (per grammar).
var CallArgList = and(
	any(and(delim(), Comma)),
	optional(and(
		CallArgExpr,
		any(and(delim(), Comma, optional(and(delim(), CallArgExpr))))
	))
);

// <CallArgs> := (Op SingleQuote? &(CloseParen)) | (_ CallArgList? _);
//
// PEG ordering: Op-arm first, with CloseParen lookahead. The
// CallArgList arm can match empty (CallArgList? is optional, both
// trivia `_` slots optional), so it would shadow the Op-arm if
// tried first — `(+)` would parse with empty CallArgList and then
// fail at PrefixCallSuffix's CloseParen vs. `+`, with PEG unable
// to retry the Op-arm.
//
// The CloseParen lookahead ensures the Op-arm only commits when
// the op is the entire content of the parens. Without it,
// `(?[x]: y)` would consume `?` as a bare Qmark Op and fail at `[`.
//
// Op is §10; forward-ref via lazy().
var CallArgs = or(
	and(lazy(() => Op), optional(SingleQuote), lookahead(CloseParen)),
	and(delim(), optional(CallArgList), delim())
);

// AtCallExpr := "None" At (_ AsAnnotationExpr)?
//             | (AtExpr | (IdentBase SingleAccessExpr? _ At) | MonadConstructor) _ ExprNoBlock (_ AsAnnotationExpr)?;
//
// Arm 1: bare `None@` (None monad constructor, no argument).
// Arm 2: at-form applied to an ExprNoBlock argument.
//
// PEG within arm 2:
//   - AtExpr first — matches IdentBase+access+adjacent At (no trivia between IdentBase and At).
//   - `(IdentBase SingleAccessExpr? _ At)` — allows trivia between IdentBase (with optional access) and At (AtExpr does not).
//   - MonadConstructor — bare `@` fallback.
export const AtCallExpr = production("AtCallExpr",
	or(
		and(BuiltinNone, At, OptAsAnnotation),
		and(
			or(
				AtExpr,
				and(IdentBase, optional(SingleAccessExpr), delim(), At),
				MonadConstructor
			),
			delim(),
			lazy(() => ExprNoBlock),
			OptAsAnnotation
		)
	)
);

// <ChainBase> := DefFuncExpr | MatchExpr | GuardedExpr | AssignmentExpr
//              | OpFuncExpr | GroupedExpr
//              | EmptyLit | BooleanLit | NumberLit | StringLit | DataStructLit
//              | IdentifierExpr;
//
// PEG ordering (per grammar):
// - MatchExpr / GuardedExpr precede AssignmentExpr — distinctive `?`/`!` openers.
// - AssignmentExpr precedes IdentifierExpr — longer `:=` match wins when it follows.
// - OpFuncExpr precedes GroupedExpr — both open with `(`, OpFuncExpr's stricter
//   inner shape (must be Op | DotAngle | DotBracket | `[]`) fails-through cleanly.
var ChainBase = or(
	lazy(() => DefFuncExpr),
	lazy(() => MatchExpr),
	lazy(() => GuardedExpr),
	lazy(() => AssignmentExpr),
	lazy(() => OpFuncExpr),
	GroupedExpr,
	EmptyLit,
	BooleanLit,
	NumberLit,
	StringLit,
	lazy(() => DataStructLit),
	IdentifierExpr
);

// ChainExpr := ChainBase
//              (
//                  (_ ChainSeg)+ (SingleQuote (_ CallSuffix)*)?
//                | SingleQuote (_ CallSuffix)*
//              )
//              (_ AsAnnotationExpr)?;
//
// Requires extension beyond ChainBase — either ≥1 ChainSeg, or a
// postfix `'` (prime, argument-reversal modifier). A bare ChainBase
// alone falls through to the later alternatives in
// BareOperandExprNoEmpty.
//
// Postfix `'` is adjacent to the preceding expression (no trivia
// between), terminates the access chain (no dot/bracket access may
// follow), and may itself be followed only by zero or more call
// suffixes — matching its semantics as a function-value modifier.
// Examples that parse: `foo'`, `foo'(1,2,3)`, `foo.bar'`,
// `foo.bar'(1,2,3)`, `(+)'(1,2,3)`. Examples that do not: `foo'.bar`,
// `foo'[0]`, `foo' .bar` (trivia before `'`).
//
// PEG arm order: ChainSeg+-first before SingleQuote-only. The
// ChainSeg+-first arm requires ≥1 ChainSeg via many(); on input
// where SingleQuote immediately follows ChainBase with no ChainSeg
// (e.g. `foo'`), the first arm fails at many() and the
// SingleQuote-only arm fires.
export const ChainExpr = production("ChainExpr",
	and(
		ChainBase,
		or(
			and(
				many(and(delim(), ChainSeg)),
				optional(and(
					SingleQuote,
					any(and(delim(), CallSuffix))
				))
			),
			and(
				SingleQuote,
				any(and(delim(), CallSuffix))
			)
		),
		OptAsAnnotation
	)
);

// <CallExpr> := AtCallExpr | ChainExpr;
//
// PEG: AtCallExpr first so `foo@ 5` reaches the at-form (applied
// call) rather than parsing as `foo@` (an AtExpr inside ChainExpr)
// with dangling `5`.
var CallExpr = or(AtCallExpr, ChainExpr);

// OpFuncExpr := OpenParen (DotAngleExpr | DotBracketExpr | (OpenBracket CloseBracket) | Op) SingleQuote? CloseParen (_ AsAnnotationExpr)?;
//
// PEG ordering: longer-prefix arms first. DotAngleExpr and
// DotBracketExpr both open with Period — same as Op's UnaryOpSym
// Period — but consume more. Trying Op first would short-match
// the bare Period and then fail at CloseParen (since `<1,3>` or
// `[1..3]` follows), rolling back the whole OpFuncExpr without
// retrying the longer arms. `[]` opens with OpenBracket (disjoint
// from Period). Op last catches bare-operator forms `(.)`, `(+)`,
// `(..)`, etc.
export const OpFuncExpr = production("OpFuncExpr",
	and(
		OpenParen,
		or(
			DotAngleExpr,
			DotBracketExpr,
			and(OpenBracket, CloseBracket),
			lazy(() => Op)
		),
		optional(SingleQuote),
		CloseParen,
		OptAsAnnotation
	)
);


// =============================================================
// §8 UNARY EXPRESSIONS
// =============================================================
//
// Postfix `'` (the prime operator, argument-reversal modifier) is
// handled as a restricted tail of ChainExpr in §7, not as a UnaryExpr
// arm. It attaches only where a function value lives, terminates the
// access chain, and may be followed only by call suffixes.

var Qmark  = tokType("Qmark");
var Exmark = tokType("Exmark");

var KwQmarkEmpty  = tokVal("BooleanOper", "?empty");
var KwExmarkEmpty = tokVal("BooleanOper", "!empty");

// NamedUnaryExpr := NamedUnaryOp _ BinaryAtom (_ AsAnnotationExpr)?;
//
// NamedUnaryOp is §10; forward-ref via lazy().
export const NamedUnaryExpr = production("NamedUnaryExpr",
	and(
		lazy(() => NamedUnaryOp),
		delim(),
		lazy(() => BinaryAtom),
		OptAsAnnotation
	)
);

// SymbolicUnaryExpr := (Qmark | Exmark) _ BinaryAtom (_ AsAnnotationExpr)?;
export const SymbolicUnaryExpr = production("SymbolicUnaryExpr",
	and(
		or(Qmark, Exmark),
		delim(),
		lazy(() => BinaryAtom),
		OptAsAnnotation
	)
);

// <UnaryExpr> := NamedUnaryExpr | SymbolicUnaryExpr;
//
// PEG order:
//   - NamedUnaryExpr first: named ?empty/!empty arrive as single
//     BooleanOper tokens, distinct from bare Qmark/Exmark.
//   - SymbolicUnaryExpr next: bare ? / ! followed by operand.
var UnaryExpr = or(NamedUnaryExpr, SymbolicUnaryExpr);


// =============================================================
// §9 BINARY EXPRESSIONS (TIER LADDER)
// =============================================================
//
// Tier ladder, tightest → loosest:
//   Unary → Mul → Add → Compare → And → Or → Flow
//
// Each tier has a hidden dispatcher and a visible iter form. The
// iter requires ≥1 op match at that tier; on no-match the
// dispatcher falls through to the next tier. Pure atoms traverse
// all tiers and resolve at BinaryAtom — no spurious wrappers.
//
// All op refs forward to §10 via lazy() (forward-ref, §10 appears
// later in this file).

// <BinaryAtom> := ClosedRangeExpr | LeadingRangeExpr | TrailingRangeExpr
//               | UnaryExpr | BareOperandExpr | GroupedOpExpr | GroupedDoExpr;
//
// PEG order: Range first (Closed is two-sided, longest); Unary
// next (prefix forms consume Qmark/Exmark/?empty/!empty before
// backtracking); BareOperandExpr and GroupedOpExpr cover bare atoms
// and parenthesized op-expressions respectively. GroupedOpExpr
// before GroupedDoExpr — both open with OpenParen, but the
// op-expr inner is the common case; do-compr inner is niche and
// falls through cleanly when GroupedOpExpr's inner OperandExpr
// rejects the do-compr opener.
var BinaryAtom = or(
	ClosedRangeExpr,
	LeadingRangeExpr,
	TrailingRangeExpr,
	UnaryExpr,
	BareOperandExpr,
	GroupedOpExpr,
	GroupedDoExpr
);

// MulBinExpr := BinaryAtom (_ MulOp _ BinaryAtom)+;
export const MulBinExpr = production("MulBinExpr",
	and(BinaryAtom, many(and(delim(), lazy(() => MulOp), delim(), BinaryAtom)))
);

// <MulDispatch> := MulBinExpr | BinaryAtom;
var MulDispatch = or(MulBinExpr, BinaryAtom);

// AddBinExpr := MulDispatch (_ AddOp _ MulDispatch)+;
export const AddBinExpr = production("AddBinExpr",
	and(MulDispatch, many(and(delim(), lazy(() => AddOp), delim(), MulDispatch)))
);

// <AddDispatch> := AddBinExpr | MulDispatch;
var AddDispatch = or(AddBinExpr, MulDispatch);

// TypeCompareBinExpr := AddDispatch _ AsTypeOp _ NamedType;
//
// Carves ?as/!as out of CompareBinExpr — their RHS is a NamedType
// (allowing NativeType keywords like `int`/`bool`), not the general
// expression RHS that CompareBinExpr accepts. Flat binary, non-iterated.
// NamedType is §18 (forward-ref via lazy).
export const TypeCompareBinExpr = production("TypeCompareBinExpr",
	and(
		AddDispatch,
		delim(), lazy(() => AsTypeOp), delim(),
		lazy(() => NamedType)
	)
);

// CompareBinExpr := AddDispatch (_ CompareOp _ AddDispatch)+;
export const CompareBinExpr = production("CompareBinExpr",
	and(AddDispatch, many(and(delim(), lazy(() => CompareOp), delim(), AddDispatch)))
);

// <CompareDispatch> := TypeCompareBinExpr | CompareBinExpr | AddDispatch;
//
// PEG: TypeCompareBinExpr first. Both open with AddDispatch; disjoint
// by operator value (?as/!as vs. ?in/!in/?has/!has/symbolic), so order
// is mechanical.
var CompareDispatch = or(TypeCompareBinExpr, CompareBinExpr, AddDispatch);

// AndBinExpr := CompareDispatch (_ AndOp _ CompareDispatch)+;
export const AndBinExpr = production("AndBinExpr",
	and(CompareDispatch, many(and(delim(), lazy(() => AndOp), delim(), CompareDispatch)))
);

// <AndDispatch> := AndBinExpr | CompareDispatch;
var AndDispatch = or(AndBinExpr, CompareDispatch);

// OrBinExpr := AndDispatch (_ OrOp _ AndDispatch)+;
export const OrBinExpr = production("OrBinExpr",
	and(AndDispatch, many(and(delim(), lazy(() => OrOp), delim(), AndDispatch)))
);

// <OrDispatch> := OrBinExpr | AndDispatch;
var OrDispatch = or(OrBinExpr, AndDispatch);

// FlowBinExpr := FlowLHS (_ FlowOp _ FlowRHS)+;
// <FlowLHS>   := CondClause | OrDispatch;
// <FlowRHS>   := BlockExpr  | OrDispatch;
//
// CondClause (§14) and BlockExpr (§11) are forward-refs via lazy().
var FlowLHS = or(lazy(() => CondClause), OrDispatch);
var FlowRHS = or(lazy(() => BlockExpr),  OrDispatch);
export const FlowBinExpr = production("FlowBinExpr",
	and(FlowLHS, many(and(delim(), lazy(() => FlowOp), delim(), FlowRHS)))
);

// <FlowDispatch> := FlowBinExpr | OrDispatch;
var FlowDispatch = or(FlowBinExpr, OrDispatch);

// <BinaryExpr> := FlowDispatch;
var BinaryExpr = FlowDispatch;


// =============================================================
// §10 OPERATOR FAMILY
// =============================================================
//
// All <Op*> productions are hidden — they match operator tokens
// in op positions without emitting AST nodes. The visible iter
// rules in §9 splice them between LHS and RHS. Op (the full
// union) is consumed by OpFuncExpr (§7) and CallArgs (§7).

var Tilde         = tokType("Tilde");
var Plus          = tokType("Plus");
var Hyphen        = tokType("Hyphen");
var Star          = tokType("Star");
var ForwardSlash  = tokType("ForwardSlash");
var Equal         = tokType("Equal");
var Dollar        = tokType("Dollar");
var Comprehension = tokType("Comprehension");

// BooleanOper-value matchers for named boolean operators.
var KwQor    = tokVal("BooleanOper", "?or");
var KwExor   = tokVal("BooleanOper", "!or");
var KwQand   = tokVal("BooleanOper", "?and");
var KwExand  = tokVal("BooleanOper", "!and");
var KwQin    = tokVal("BooleanOper", "?in");
var KwExin   = tokVal("BooleanOper", "!in");
var KwQhas   = tokVal("BooleanOper", "?has");
var KwExhas  = tokVal("BooleanOper", "!has");
var KwQasOp  = tokVal("BooleanOper", "?as");
var KwExasOp = tokVal("BooleanOper", "!as");

// <ComprOp>    := Comprehension | (Tilde OpenAngle);
// <PipelineOp> := Hash CloseAngle;
// <ComposeOp>  := (Plus CloseAngle) | (OpenAngle Plus);
// <FlowOp>     := ComprOp | PipelineOp | ComposeOp;
//
// ComprOp's Comprehension arm catches named forms (~map, ~each,
// etc.) as single tokens; the (Tilde OpenAngle) arm catches the
// bare `~<` operator as two adjacent tokens. Disjoint — order is
// per grammar.
var ComprOp    = or(Comprehension, and(Tilde, OpenAngle));
var PipelineOp = and(Hash, CloseAngle);
var ComposeOp  = or(and(Plus, CloseAngle), and(OpenAngle, Plus));
var FlowOp     = or(ComprOp, PipelineOp, ComposeOp);

// <OrOp>  := "?or"  | "!or";
// <AndOp> := "?and" | "!and";
var OrOp  = or(KwQor, KwExor);
var AndOp = or(KwQand, KwExand);

// <NamedCompareOp> := "?in" | "!in" | "?has" | "!has";
// <SymbolicCompareOp> := (Qmark | Exmark) ((OpenAngle Equal CloseAngle)
//                                        | (OpenAngle Equal)
//                                        | (CloseAngle Equal)
//                                        | (OpenAngle CloseAngle)
//                                        | (Dollar Equal)
//                                        | Equal | OpenAngle | CloseAngle);
// <CompareOp>         := NamedCompareOp | SymbolicCompareOp;
//
// Inner alternation in SymbolicCompareOp is longest-first per
// grammar: ?<=> before ?<= / ?>= / ?<> / ?$= / ?= / ?< / ?>.
var NamedCompareOp = or(
	tokVal("BooleanOper", "?in"),
	tokVal("BooleanOper", "!in"),
	tokVal("BooleanOper", "?has"),
	tokVal("BooleanOper", "!has")
);

// <AsTypeOp> := "?as" | "!as";
//
// Separate from NamedCompareOp because its RHS is a NamedType, not
// a regular expression — handled by TypeCompareBinExpr at the Compare
// tier (§9). Included in Op below so `(?as)` / `(!as)` remain valid
// OpFuncExpr forms.
var AsTypeOp = or(
	tokVal("BooleanOper", "?as"),
	tokVal("BooleanOper", "!as")
);
var SymbolicCompareOp = and(
	or(Qmark, Exmark),
	or(
		and(OpenAngle, Equal, CloseAngle),
		and(OpenAngle, Equal),
		and(CloseAngle, Equal),
		and(OpenAngle, CloseAngle),
		and(Dollar, Equal),
		Equal,
		OpenAngle,
		CloseAngle
	)
);
var CompareOp = or(NamedCompareOp, SymbolicCompareOp);

// <AddOp> := (Dollar Plus) | Plus | Hyphen;
// <MulOp> := Star | ForwardSlash;
//
// AddOp: `$+` first (longest), then bare `+`, then `-`.
var AddOp = or(and(Dollar, Plus), Plus, Hyphen);
var MulOp = or(Star, ForwardSlash);

// <NamedUnaryOp> := "?empty" | "!empty";
// <UnaryOpSym>   := Qmark | Exmark | SingleQuote | TriplePeriod | DoublePeriod | Period;
var NamedUnaryOp = or(KwQmarkEmpty, KwExmarkEmpty);
var UnaryOpSym   = or(Qmark, Exmark, SingleQuote, TriplePeriod, DoublePeriod, Period);

// <Op> := FlowOp | OrOp | AndOp | CompareOp | AsTypeOp | AddOp | MulOp | NamedUnaryOp | UnaryOpSym;
//
// Longest-prefix concerns resolved by this ordering:
//   - FlowOp (`+>`, `<+`, `#>`) before AddOp (`+`) and before
//     anything matching bare `<` / `>`.
//   - CompareOp (?<=, !<>, etc.) before UnaryOpSym (bare ?, !).
//   - NamedUnaryOp (?empty/!empty) before UnaryOpSym — disjoint at
//     the lex token level (BooleanOper vs. bare Qmark/Exmark), so
//     order is mechanical; matches the named-then-symbolic pattern
//     used elsewhere.
//   - Within FlowOp, ComprOp's `~<` is disjoint from everything
//     downstream (Tilde appears nowhere else in Op).
var Op = or(FlowOp, OrOp, AndOp, CompareOp, AsTypeOp, AddOp, MulOp, NamedUnaryOp, UnaryOpSym);


// =============================================================
// §11 BLOCK EXPRESSIONS
// =============================================================

// VarDefInit := (Identifier | DestructureTarget) _ Colon _ ExprNoBlock;
//
// Required init form — used by DefBlockStmt's BlockDefsInit. Accepts
// destructure-with-init (e.g., `def (< :x >: getThing()) { ... };`).
export const VarDefInit = production("VarDefInit",
	and(
		or(Identifier, DestructureTarget),
		delim(), Colon, delim(),
		ExprNoBlock
	)
);

// <VarDefInitOpt> := (Identifier        (_ Colon _ ExprNoBlock)?)
//                  | (DestructureTarget (_ Colon _ ExprNoBlock)?);
//
// Both arms carry the optional `: ExprNoBlock` initializer. Enables
// destructure-with-init in block-defs clauses.
var VarDefInitOpt = or(
	and(Identifier,        optional(and(delim(), Colon, delim(), ExprNoBlock))),
	and(DestructureTarget, optional(and(delim(), Colon, delim(), ExprNoBlock)))
);

// <VarDefInitList> := VarDefInit (_ Comma _ VarDefInit)* (_ Comma)?;
var VarDefInitList = and(
	VarDefInit,
	any(and(delim(), Comma, delim(), VarDefInit)),
	optional(and(delim(), Comma))
);

// <VarDefInitOptList> := (_ Comma)* (VarDefInitOpt (_ Comma (_ VarDefInitOpt)?)*)?;
//
// Permissive comma handling — same shape as CallArgList in §7.
var VarDefInitOptList = and(
	any(and(delim(), Comma)),
	optional(and(
		VarDefInitOpt,
		any(and(delim(), Comma, optional(and(delim(), VarDefInitOpt))))
	))
);

// <BlockDefsInit>    := OpenParen _ VarDefInitList    _ CloseParen;
// <BlockDefsInitOpt> := OpenParen _ VarDefInitOptList _ CloseParen;
var BlockDefsInit    = and(OpenParen, delim(), VarDefInitList,    delim(), CloseParen);
var BlockDefsInitOpt = and(OpenParen, delim(), VarDefInitOptList, delim(), CloseParen);

// <BlockStmts> := (StmtSemi _)* StmtSemiOpt?;
var BlockStmts = and(
	any(and(StmtSemi, delim())),
	optional(StmtSemiOpt)
);

// <BareBlockExpr> := OpenBrace _ BlockStmts _ CloseBrace;
var BareBlockExpr = and(OpenBrace, delim(), BlockStmts, delim(), CloseBrace);

// BlockExpr := BlockDefsInitOpt? _ BareBlockExpr (_ AsAnnotationExpr)?;
export const BlockExpr = production("BlockExpr",
	and(optional(BlockDefsInitOpt), delim(), BareBlockExpr, OptAsAnnotation)
);

// DefBlockStmt := "def" _ BlockDefsInit _ BareBlockExpr;
//
// `<Stmt>` orders DefBlockStmt before DefVarStmt — both open with
// `def`, but DefBlockStmt requires a `(...)` defs-init that
// DefVarStmt's identifier/destructure-target target can't match,
// so DefBlockStmt fails-through cleanly to DefVarStmt for the
// `def x: …` form.
export const DefBlockStmt = production("DefBlockStmt",
	and(KwDef, delim(), BlockDefsInit, delim(), BareBlockExpr)
);


// =============================================================
// §12 ASSIGNMENT
// =============================================================

// AssignmentExpr := ((IdentBase SingleAccessExpr) | Identifier) _ Colon Equal _ Expr;
//
// LHS PEG order: access-form arm (IdentBase + SingleAccessExpr)
// precedes bare Identifier so `foo.bar := 5` reaches the access
// form rather than parsing `foo` as bare Identifier with dangling
// `.bar := 5`.
//
// No trivia between Colon and Equal (per grammar — `:=` is a
// two-token operator at the syn layer, not a lex-level token).
// No `:as` tail — parenthesize to annotate.
export const AssignmentExpr = production("AssignmentExpr",
	and(
		or(
			and(IdentBase, SingleAccessExpr),
			Identifier
		),
		delim(),
		Colon, Equal,
		delim(),
		lazy(() => Expr)
	)
);


// =============================================================
// §13 FUNCTION DEFINITIONS
// =============================================================

var Caret = tokType("Caret");

var KwDefn = tokVal("Keyword", "defn");
var KwOver = tokVal("Keyword", ":over");

// <ParameterList> := VarDefInitOpt (_ Comma _ VarDefInitOpt)*;
//
// VarDefInitOpt from §11 — Identifier with optional `:` initializer,
// or DestructureTarget.
var ParameterList = and(
	VarDefInitOpt,
	any(and(delim(), Comma, delim(), VarDefInitOpt))
);

// GatherParameter := Star Identifier;
//
// No trivia between Star and Identifier (per grammar — the `*`
// must be adjacent to the parameter name).
export const GatherParameter = production("GatherParameter",
	and(Star, Identifier)
);

// FuncPrecond := CondClause _ Colon _ ExprNoBlock;
//
// CondClause is §14 (forward-ref via lazy). Until §14 lands,
// FuncPrecond can't fire — the optional FuncPrecondList slot in
// DefFuncExpr falls through cleanly.
export const FuncPrecond = production("FuncPrecond",
	and(lazy(() => CondClause), delim(), Colon, delim(), ExprNoBlock)
);

// <FuncPrecondList> := FuncPrecond (_ FuncPrecond)*;
var FuncPrecondList = and(
	FuncPrecond,
	any(and(delim(), FuncPrecond))
);

// FuncOverClause := ":over" _ OpenParen _ Identifier (_ Comma _ Identifier)* _ CloseParen;
//
// No trailing comma in the identifier list (per grammar).
export const FuncOverClause = production("FuncOverClause",
	and(
		KwOver, delim(),
		OpenParen, delim(),
		Identifier,
		any(and(delim(), Comma, delim(), Identifier)),
		delim(), CloseParen
	)
);

// FuncAsClause := ":as" _ Identifier;
//
// Identifier, NOT NamedType — FuncAsClause is its own thing,
// distinct from AsAnnotationExpr's `:as NamedType`.
export const FuncAsClause = production("FuncAsClause",
	and(KwAs, delim(), Identifier)
);

// ReturnExpr := Caret _ Expr;
export const ReturnExpr = production("ReturnExpr",
	and(Caret, delim(), lazy(() => Expr))
);

// <FuncBodyStmt> := ReturnExpr | Stmt;
//
// PEG order: ReturnExpr first — opens with Caret, disjoint from
// all Stmt arms (def/defn/deft/expressions).
var FuncBodyStmt = or(ReturnExpr, Stmt);

// <FuncBodyStmtSemi>    := FuncBodyStmt (_ Semicolon)+;
// <FuncBodyStmtSemiOpt> := FuncBodyStmt (_ Semicolon)*;
var FuncBodyStmtSemi    = and(FuncBodyStmt, many(and(delim(), Semicolon)));
var FuncBodyStmtSemiOpt = and(FuncBodyStmt, any (and(delim(), Semicolon)));

// <FuncBodyStmts> := (FuncBodyStmtSemi _)* FuncBodyStmtSemiOpt?;
var FuncBodyStmts = and(
	any(and(FuncBodyStmtSemi, delim())),
	optional(FuncBodyStmtSemiOpt)
);

// FuncBodyExpr := Caret _ (ExprNoBlock | GroupedExpr);
export const FuncBodyExpr = production("FuncBodyExpr",
	and(Caret, delim(), or(ExprNoBlock, GroupedExpr))
);

// FuncBodyPipeline := PipelineOp _ (BlockExpr | ExprNoBlock | GroupedExpr);
//
// PEG order: BlockExpr before ExprNoBlock so `#> (x){y;}` parses
// as a BlockExpr (def `x`, body `{y;}`) rather than ExprNoBlock's
// GroupedExprNoBlock `(x)` with dangling `{y;}` — same shape as §5's
// Expr ordering fix.
export const FuncBodyPipeline = production("FuncBodyPipeline",
	and(
		PipelineOp, delim(),
		or(BlockExpr, ExprNoBlock, GroupedExpr)
	)
);

// FuncBodyBlock := OpenBrace _ FuncBodyStmts _ CloseBrace;
export const FuncBodyBlock = production("FuncBodyBlock",
	and(OpenBrace, delim(), FuncBodyStmts, delim(), CloseBrace)
);

// <FuncBody> := FuncBodyExpr | FuncBodyPipeline | FuncBodyBlock;
//
// Disjoint openers: Caret (Expr), Hash+CloseAngle (Pipeline `#>`),
// OpenBrace (Block).
var FuncBody = or(FuncBodyExpr, FuncBodyPipeline, FuncBodyBlock);

// DefFuncExpr := "defn" (_ Identifier At?)?
//                (_ OpenParen _ (ParameterList | GatherParameter)? _ CloseParen)+
//                (_ FuncPrecondList)? (_ FuncOverClause)? (_ FuncAsClause)?
//                _ FuncBody;
//
// - Optional name with optional adjacent `@` for naturally-recursive
//   binding.
// - One-or-more parameter groups (currying: `defn add(x)(y) …`).
// - Each clause optional; FuncBody required.
//
// PEG inside paren-group: ParameterList | GatherParameter. Openers
// disjoint (Identifier/OpenAngle vs. Star), so order is mechanical.
//
// `:as` on a defn is FuncAsClause, NOT a trailing OptAsAnnotation —
// DefFuncExpr does not carry the `(_ AsAnnotationExpr)?` tail.
export const DefFuncExpr = production("DefFuncExpr",
	and(
		KwDefn,
		optional(and(delim(), Identifier, optional(At))),
		many(and(
			delim(), OpenParen, delim(),
			optional(or(ParameterList, GatherParameter)),
			delim(), CloseParen
		)),
		optional(and(delim(), FuncPrecondList)),
		optional(and(delim(), FuncOverClause)),
		optional(and(delim(), FuncAsClause)),
		delim(), FuncBody
	)
);


// =============================================================
// §14 CONDITIONALS / GUARDS
// =============================================================

// CondClause := (Qmark | Exmark) BracketExpr;
//
// No trivia between the ?/! and the `[` — must be adjacent
// (per grammar). BracketExpr supplies its own internal trivia.
export const CondClause = production("CondClause",
	and(or(Qmark, Exmark), BracketExpr)
);

// GuardedExpr := CondClause _ Colon _ Expr (_ AsAnnotationExpr)?;
export const GuardedExpr = production("GuardedExpr",
	and(CondClause, delim(), Colon, delim(), lazy(() => Expr), OptAsAnnotation)
);


// =============================================================
// §15 MATCH EXPRESSIONS
// =============================================================

// MatchConsequent      := (Colon _ Expr _ Semicolon) | BlockExpr;
// MatchConsequentNoSemi := (Colon _ Expr) | BlockExpr;
//
// PEG: Colon-arm first (disjoint from BlockExpr's OpenBrace opener).
var MatchConsequent = or(
	and(Colon, delim(), lazy(() => Expr), delim(), Semicolon),
	lazy(() => BlockExpr)
);
var MatchConsequentNoSemi = or(
	and(Colon, delim(), lazy(() => Expr)),
	lazy(() => BlockExpr)
);

// ElseStmt := (Qmark _)? MatchConsequentNoSemi (_ Semicolon)*;
//
// Optional leading `?` distinguishes the bare-else form. PEG-wise
// the leading-? form must be tried before the bare form at all match-stmt
// dispatch sites (handled in IndepMatchStmts / DepMatchStmts ordering).
export const ElseStmt = production("ElseStmt",
	and(
		optional(and(Qmark, delim())),
		MatchConsequentNoSemi,
		any(and(delim(), Semicolon))
	)
);

// --- Independent Match -----------------------------------------

// <IndepCondClause> := (Qmark | Exmark)? BracketExpr;
//
// Optional ?/! prefix — bare BracketExpr is the implicit-? form.
var IndepCondClause = and(optional(or(Qmark, Exmark)), BracketExpr);

// IndepPatternStmt       := IndepCondClause _ MatchConsequent (_ Semicolon)*;
// IndepPatternStmtNoSemi := IndepCondClause _ MatchConsequentNoSemi;
export const IndepPatternStmt = production("IndepPatternStmt",
	and(IndepCondClause, delim(), MatchConsequent, any(and(delim(), Semicolon)))
);

export const IndepPatternStmtNoSemi = production("IndepPatternStmtNoSemi",
	and(IndepCondClause, delim(), MatchConsequentNoSemi)
);

// <IndepMatchStmts> := ((IndepPatternStmt _)+ (ElseStmt | IndepPatternStmtNoSemi)?)
//                    | IndepPatternStmtNoSemi
//                    | ElseStmt;
//
// PEG ordering within the trailing alt: ElseStmt before
// IndepPatternStmtNoSemi — ElseStmt opens with optional Qmark+
// MatchConsequentNoSemi (bare `:expr` or BlockExpr), distinct from
// IndepPatternStmtNoSemi's required BracketExpr opener. Lead arm
// (one-or-more IndepPatternStmt) before the single-stmt arms so
// repeated clauses are gathered.
var IndepMatchStmts = or(
	and(
		many(and(IndepPatternStmt, delim())),
		optional(or(ElseStmt, IndepPatternStmtNoSemi))
	),
	IndepPatternStmtNoSemi,
	ElseStmt
);

// IndepMatchExpr := Qmark OpenBrace _ IndepMatchStmts _ CloseBrace;
//
// No trivia between Qmark and OpenBrace.
export const IndepMatchExpr = production("IndepMatchExpr",
	and(Qmark, OpenBrace, delim(), IndepMatchStmts, delim(), CloseBrace)
);

// --- Dependent Match -------------------------------------------

// <DepCondBoolOp>   := CompareOp | AndOp | OrOp;
// CompareDispatch is the §9 internal — references the hidden
// dispatcher directly. Defined in §9 as `var CompareDispatch`.
var DepCondBoolOp = or(
	lazy(() => CompareOp),
	lazy(() => AndOp),
	lazy(() => OrOp)
);
// <DepCondBoolExpr> := AsTypeOp _ NamedType
//                    | DepCondBoolOp _ CompareDispatch
//                    | OpenParen _ DepCondBoolExpr _ CloseParen;
//
// PEG: AsTypeOp arm first — disjoint opener (?as/!as) from
// DepCondBoolOp (which is CompareOp|AndOp|OrOp, none of which include
// ?as/!as anymore).
var DepCondBoolExpr = or(
	and(AsTypeOp, delim(), lazy(() => NamedType)),
	and(lazy(() => DepCondBoolOp), delim(), CompareDispatch),
	and(OpenParen, delim(), lazy(() => DepCondBoolExpr), delim(), CloseParen)
);

// <DepCondExprAtom> := DepCondBoolExpr | ExprNoBlock;
//
// DepCondBoolExpr first — operator-led forms are distinct
// (start with CompareOp/AndOp/OrOp or `(`), but `(` overlaps with
// ExprNoBlock's GroupedExprNoBlock. The paren form of
// DepCondBoolExpr requires an inner DepCondBoolExpr (operator-led),
// so it fails-through cleanly on plain `(expr)`.
var DepCondExprAtom = or(DepCondBoolExpr, ExprNoBlock);

// <DepCondExprList> := DepCondExprAtom (_ Comma _ DepCondExprAtom)* (_ Comma)?;
var DepCondExprList = and(
	DepCondExprAtom,
	any(and(delim(), Comma, delim(), DepCondExprAtom)),
	optional(and(delim(), Comma))
);

// <DepCondClause> := (Qmark | Exmark)? OpenBracket _ DepCondExprList _ CloseBracket;
var DepCondClause = and(
	optional(or(Qmark, Exmark)),
	OpenBracket, delim(),
	DepCondExprList,
	delim(), CloseBracket
);

// DepPatternStmt       := DepCondClause _ MatchConsequent (_ Semicolon)*;
// DepPatternStmtNoSemi := DepCondClause _ MatchConsequentNoSemi;
export const DepPatternStmt = production("DepPatternStmt",
	and(DepCondClause, delim(), MatchConsequent, any(and(delim(), Semicolon)))
);

export const DepPatternStmtNoSemi = production("DepPatternStmtNoSemi",
	and(DepCondClause, delim(), MatchConsequentNoSemi)
);

// <DepMatchStmts> := ((DepPatternStmt _)+ (ElseStmt | DepPatternStmtNoSemi)?)
//                  | DepPatternStmtNoSemi
//                  | ElseStmt;
var DepMatchStmts = or(
	and(
		many(and(DepPatternStmt, delim())),
		optional(or(ElseStmt, DepPatternStmtNoSemi))
	),
	DepPatternStmtNoSemi,
	ElseStmt
);

// DepMatchExpr := Qmark OpenParen _ ExprNoBlock _ CloseParen OpenBrace _ DepMatchStmts _ CloseBrace;
//
// No trivia between Qmark and OpenParen.
export const DepMatchExpr = production("DepMatchExpr",
	and(
		Qmark, OpenParen, delim(), ExprNoBlock, delim(), CloseParen,
		OpenBrace, delim(), DepMatchStmts, delim(), CloseBrace
	)
);

// <MatchExpr> := IndepMatchExpr | DepMatchExpr;
//
// PEG: IndepMatchExpr opens with `?{`, DepMatchExpr opens with `?(`.
// Disjoint after first two tokens — order by either path works,
// but IndepMatchExpr first matches grammar order.
var MatchExpr = or(IndepMatchExpr, DepMatchExpr);


// =============================================================
// §16 DO-COMPREHENSIONS
// =============================================================

var DoubleColon = tokType("DoubleColon");

// DoDefVarStmt := "def" _ (Identifier | DestructureTarget) _ DoubleColon _ Expr;
//
// Same opener as DefVarStmt but uses `::` instead of `:`. In <DoStmt>,
// DoDefVarStmt is tried before Stmt — on a regular `def x:` (Colon, not
// DoubleColon), DoDefVarStmt backtracks at the DoubleColon match and
// Stmt's DefVarStmt fires.
export const DoDefVarStmt = production("DoDefVarStmt",
	and(
		KwDef, delim(),
		or(Identifier, DestructureTarget),
		delim(), DoubleColon, delim(),
		lazy(() => Expr)
	)
);

// DoFinalUnwrapExpr := DoubleColon _ ExprNoBlock (_ Semicolon)*;
//
// Opener `::` is disjoint from any DoStmt — distinguishes the final
// unwrap form from the rest of a do-block.
export const DoFinalUnwrapExpr = production("DoFinalUnwrapExpr",
	and(DoubleColon, delim(), ExprNoBlock, any(and(delim(), Semicolon)))
);

// <DoStmt> := DoDefVarStmt | Stmt;
//
// PEG: DoDefVarStmt first — Stmt's DefVarStmt would otherwise consume
// `def x:` happily and leave a dangling `:expr` from the user's `::`.
var DoStmt = or(DoDefVarStmt, Stmt);

// <DoStmtSemi>    := DoStmt? (_ Semicolon)+;
// <DoStmtSemiOpt> := DoStmt? (_ Semicolon)*;
var DoStmtSemi    = and(optional(DoStmt), many(and(delim(), Semicolon)));
var DoStmtSemiOpt = and(optional(DoStmt), any (and(delim(), Semicolon)));

// <DoBlockStmts> := (DoStmtSemi _)* (DoFinalUnwrapExpr | DoStmtSemiOpt)?;
//
// PEG ORDERING: DoFinalUnwrapExpr before DoStmtSemiOpt — DoStmtSemiOpt
// is `DoStmt? (_ Semicolon)*` with both halves optional, so it
// matches empty. If tried first, DoFinalUnwrapExpr would never be
// reached. Same shape as §15's IndepMatchStmts reordering.
var DoBlockStmts = and(
	any(and(DoStmtSemi, delim())),
	optional(or(DoFinalUnwrapExpr, DoStmtSemiOpt))
);

// <DoVarDefInitOpt> := (Identifier        (_ (DoubleColon | Colon) _ ExprNoBlock)?)
//                    | (DestructureTarget (_ (DoubleColon | Colon) _ ExprNoBlock)?);
var DoVarDefInitOpt = or(
	and(
		Identifier,
		optional(and(delim(), or(DoubleColon, Colon), delim(), ExprNoBlock))
	),
	and(
		DestructureTarget,
		optional(and(delim(), or(DoubleColon, Colon), delim(), ExprNoBlock))
	)
);

// <DoVarDefInitOptList> := (_ Comma)* (DoVarDefInitOpt (_ Comma (_ DoVarDefInitOpt)?)*)?;
//
// Permissive comma handling — same shape as CallArgList / VarDefInitOptList.
var DoVarDefInitOptList = and(
	any(and(delim(), Comma)),
	optional(and(
		DoVarDefInitOpt,
		any(and(delim(), Comma, optional(and(delim(), DoVarDefInitOpt))))
	))
);

// <DoBlockDefsInitOpt> := OpenParen _ DoVarDefInitOptList _ CloseParen;
var DoBlockDefsInitOpt = and(OpenParen, delim(), DoVarDefInitOptList, delim(), CloseParen);

// <DoBareBlockExpr> := OpenBrace _ DoBlockStmts _ CloseBrace;
var DoBareBlockExpr = and(OpenBrace, delim(), DoBlockStmts, delim(), CloseBrace);

// <DoBlockExpr> := DoBlockDefsInitOpt? _ DoBareBlockExpr;
var DoBlockExpr = and(optional(DoBlockDefsInitOpt), delim(), DoBareBlockExpr);

// DoComprExpr := (Identifier | BuiltIn) _ Tilde OpenAngle OpenAngle _ DoBlockExpr;
//
// `~<<` is Tilde + OpenAngle + OpenAngle — three adjacent single-char
// tokens (no trivia between). Range is bare Identifier or BuiltIn
// only, not arbitrary expressions.
export const DoComprExpr = production("DoComprExpr",
	and(
		or(Identifier, BuiltIn),
		delim(),
		Tilde, OpenAngle, OpenAngle,
		delim(),
		DoBlockExpr
	)
);

// <DoLoopIterNoBlockExpr> := CallExpr | IdentifierExpr | (OpenParen _ DoLoopIterNoBlockExpr _ CloseParen);
//
// PEG: CallExpr first — IdentifierExpr's bare-identifier match would
// otherwise shadow ChainExpr. Paren-recursive arm consumes `(` before
// recursing — no LR.
var DoLoopIterNoBlockExpr = or(
	CallExpr,
	IdentifierExpr,
	and(OpenParen, delim(), lazy(() => DoLoopIterNoBlockExpr), delim(), CloseParen)
);

// <DoLoopIterationExpr> := DoBlockExpr | DoLoopIterNoBlockExpr;
//
// PEG: DoBlockExpr before DoLoopIterNoBlockExpr — `(x){...}` should
// parse as DoBlockExpr (defs `x`, body `{...}`) rather than
// DoLoopIterNoBlockExpr's paren-wrap. Same shape as §5/§13 ordering.
var DoLoopIterationExpr = or(DoBlockExpr, DoLoopIterNoBlockExpr);

// DoLoopComprExpr := (ExprNoBlock | GroupedExpr) _ Tilde OpenAngle Star _ DoLoopIterationExpr;
//
// `~<*` is Tilde + OpenAngle + Star — three adjacent single-char
// tokens. PEG ordering for range: ExprNoBlock first; if its
// GroupedExprNoBlock arm can't reach the inner expr (BlockExpr,
// DoCompr, etc.), the outer GroupedExpr arm fires.
export const DoLoopComprExpr = production("DoLoopComprExpr",
	and(
		or(ExprNoBlock, GroupedExpr),
		delim(),
		Tilde, OpenAngle, Star,
		delim(),
		DoLoopIterationExpr
	)
);


// =============================================================
// §17 DATA STRUCTURE LITERALS
// =============================================================

var Ampersand = tokType("Ampersand");
var Percent   = tokType("Percent");

// PickValue := Ampersand IdentBase MultiAccessExpr?;
//
// No trivia between Ampersand and IdentBase (per grammar).
export const PickValue = production("PickValue",
	and(Ampersand, IdentBase, optional(MultiAccessExpr))
);

// <ComputedPropName> := Percent (PipelineTopic | IdentifierExpr | StringLit);
//
// No trivia between Percent and inner. PipelineTopic listed first per
// grammar; IdentifierExpr's BareIdentifier would also match a bare
// PipelineTopic via IdentBase, so the order distinguishes the shape
// of the inner node (bare PipelineTopic vs. BareIdentifier-wrapping).
var ComputedPropName = and(
	Percent,
	or(PipelineTopic, IdentifierExpr, StringLit)
);

// ConcisePropDef := Colon PropertyExpr;
//
// No trivia between Colon and PropertyExpr (per grammar). PropertyExpr
// is Identifier | PositiveIntLit — note no BuiltIn (per §6).
export const ConcisePropDef = production("ConcisePropDef",
	and(Colon, PropertyExpr)
);

// ExplicitPropDef := (ComputedPropName | PropertyExpr) _ Colon _ RecordTupleValue;
export const ExplicitPropDef = production("ExplicitPropDef",
	and(
		or(ComputedPropName, PropertyExpr),
		delim(), Colon, delim(),
		lazy(() => RecordTupleValue)
	)
);

// <RecordProperty> := ConcisePropDef | ExplicitPropDef;
//
// Disjoint openers: ConcisePropDef opens with Colon; ExplicitPropDef
// opens with Percent (ComputedPropName) or Identifier/PositiveIntegerLit
// (PropertyExpr). Order is mechanical.
var RecordProperty = or(ConcisePropDef, ExplicitPropDef);

// <RecordTupleValue> := CallExpr | EmptyLit | BooleanLit | NumberLit | StringLit
//                     | DataStructLit | IdentifierExpr
//                     | (OpenParen _ RecordTupleValue _ CloseParen);
//
// PEG: CallExpr first so `foo.bar` parses as ChainExpr rather than
// IdentifierExpr with dangling `.bar`. DataStructLit before
// IdentifierExpr — disjoint openers (`<` vs IdentBase). Paren-recursive
// arm consumes `(` before recursing — no LR.
var RecordTupleValue = or(
	CallExpr,
	EmptyLit,
	BooleanLit,
	NumberLit,
	StringLit,
	lazy(() => DataStructLit),
	IdentifierExpr,
	and(OpenParen, delim(), lazy(() => RecordTupleValue), delim(), CloseParen)
);

// <RecordTupleEntry> := PickValue | RecordProperty | RecordTupleValue;
//
// PEG:
//   - PickValue first — opens with `&`, disjoint.
//   - RecordProperty before RecordTupleValue: ExplicitPropDef's
//     PropertyExpr opener overlaps with RecordTupleValue's IdentifierExpr
//     opener (both can start with Identifier) and with NumberLit
//     (both can start with PositiveIntegerLit). ExplicitPropDef
//     requires a `_ Colon _ value` tail; missing tail backtracks
//     cleanly to RecordTupleValue.
//   - RecordTupleValue last.
var RecordTupleEntry = or(PickValue, RecordProperty, RecordTupleValue);

// <RecordTupleEntryList> := (_ Comma)* (RecordTupleEntry (_ Comma (_ RecordTupleEntry)?)*)?;
//
// Permissive comma handling — same shape as CallArgList.
var RecordTupleEntryList = and(
	any(and(delim(), Comma)),
	optional(and(
		RecordTupleEntry,
		any(and(delim(), Comma, optional(and(delim(), RecordTupleEntry))))
	))
);

// RecordTupleLit := OpenAngle _ RecordTupleEntryList _ CloseAngle (_ AsAnnotationExpr)?;
export const RecordTupleLit = production("RecordTupleLit",
	and(
		OpenAngle, delim(),
		RecordTupleEntryList,
		delim(), CloseAngle,
		OptAsAnnotation
	)
);

// <SetEntry>     := PickValue | RecordTupleValue;
// <SetEntryList> := (_ Comma)* (SetEntry (_ Comma (_ SetEntry)?)*)?;
//
// Sets don't carry RecordProperty entries — sets are unordered
// collections of values, no keys.
var SetEntry = or(PickValue, RecordTupleValue);
var SetEntryList = and(
	any(and(delim(), Comma)),
	optional(and(
		SetEntry,
		any(and(delim(), Comma, optional(and(delim(), SetEntry))))
	))
);

// SetLit := OpenAngle OpenBracket _ SetEntryList _ CloseBracket CloseAngle (_ AsAnnotationExpr)?;
//
// `<[` and `]>` are two-token compound openers/closers — no trivia
// between OpenAngle/OpenBracket or CloseBracket/CloseAngle.
export const SetLit = production("SetLit",
	and(
		OpenAngle, OpenBracket, delim(),
		SetEntryList,
		delim(), CloseBracket, CloseAngle,
		OptAsAnnotation
	)
);

// <DataStructLit> := SetLit | RecordTupleLit;
//
// PEG: SetLit first — `<[` opens with two adjacent tokens while
// RecordTupleLit's `<` opens with one. On bare `<...>`, SetLit fails
// fast at the missing OpenBracket and RecordTupleLit fires.
var DataStructLit = or(SetLit, RecordTupleLit);


// =============================================================
// §18 TYPE DEFINITIONS
// =============================================================

var KwDeft = tokVal("Keyword", "deft");

// Native type keyword matchers.
var KwInt     = tokVal("Keyword", "int");
var KwInteger = tokVal("Keyword", "integer");
var KwFloat   = tokVal("Keyword", "float");
var KwBool    = tokVal("Keyword", "bool");
var KwBoolean = tokVal("Keyword", "boolean");
var KwString  = tokVal("Keyword", "string");

// <NativeType> := "int" | "integer" | "float" | "bool" | "boolean" | "string";
var NativeType = or(KwInt, KwInteger, KwFloat, KwBool, KwBoolean, KwString);

// NamedType := ((Identifier | BuiltIn) (Period (Identifier | BuiltIn))*) | NativeType;
//
// Zero trivia between segments — Period adjacent to both surrounding
// names (per grammar). PEG: dotted-form first; falls through to
// NativeType when opener is a Keyword token rather than General/Builtin.
export const NamedType = production("NamedType",
	or(
		and(
			or(Identifier, BuiltIn),
			any(and(Period, or(Identifier, BuiltIn)))
		),
		NativeType
	)
);

// NestedTypeExpr := NamedType _ GroupedTypeExpr;
export const NestedTypeExpr = production("NestedTypeExpr",
	and(NamedType, delim(), lazy(() => GroupedTypeExpr))
);

// <NoUnionTypeExpr> := NestedTypeExpr | NamedType
//                    | EmptyLit | PlainStr | NumberLit | BooleanLit
//                    | DataStructTypeExpr | GroupedTypeExpr;
//
// PEG: NestedTypeExpr before NamedType (longer; same NamedType opener).
// Other arms disjoint by opener (literals by token type/value;
// DataStruct opens with OpenAngle; Grouped opens with OpenBrace).
var NoUnionTypeExpr = or(
	NestedTypeExpr,
	NamedType,
	EmptyLit,
	PlainStr,
	NumberLit,
	BooleanLit,
	lazy(() => DataStructTypeExpr),
	lazy(() => GroupedTypeExpr)
);

// UnionTypeExpr := NoUnionTypeExpr (_ Pipe _ NoUnionTypeExpr)+;
export const UnionTypeExpr = production("UnionTypeExpr",
	and(NoUnionTypeExpr, many(and(delim(), Pipe, delim(), NoUnionTypeExpr)))
);

// <NoFuncTypeExpr> := UnionTypeExpr | NoUnionTypeExpr;
//
// PEG: UnionTypeExpr first; iter requires ≥1 Pipe, backtracks to
// NoUnionTypeExpr if absent. Same shape as §9 tier dispatchers.
var NoFuncTypeExpr = or(UnionTypeExpr, NoUnionTypeExpr);

// GroupedTypeExpr := OpenBrace _ (FuncTypeExpr | UnionTypeExpr (_ Pipe)? | NoUnionTypeExpr) _ CloseBrace;
//
// PEG: FuncTypeExpr first (disjoint OpenParen opener). UnionTypeExpr
// before NoUnionTypeExpr (same backtrack pattern as NoFuncTypeExpr).
// Optional trailing Pipe on the union arm preserves the legacy's
// `{int | str |}` permissiveness.
export const GroupedTypeExpr = production("GroupedTypeExpr",
	and(
		OpenBrace, delim(),
		or(
			lazy(() => FuncTypeExpr),
			and(UnionTypeExpr, optional(and(delim(), Pipe))),
			NoUnionTypeExpr
		),
		delim(), CloseBrace
	)
);

// DataStructFinalValType := Star NoUnionTypeExpr;
//
// No trivia between Star and inner type (per grammar — `*` adjacent
// to its type, same as GatherParameter in §13).
export const DataStructFinalValType = production("DataStructFinalValType",
	and(Star, NoUnionTypeExpr)
);

// DataStructFieldType := Identifier _ Colon _ DataStructValueType;
export const DataStructFieldType = production("DataStructFieldType",
	and(Identifier, delim(), Colon, delim(), lazy(() => DataStructValueType))
);

// <DataStructValueType> := NoFuncTypeExpr | GroupedTypeExpr;
//
// Second arm is dead in PEG — GroupedTypeExpr reaches via
// NoFuncTypeExpr → NoUnionTypeExpr's last arm — but kept for
// legacy-grammar fidelity.
var DataStructValueType = or(NoFuncTypeExpr, lazy(() => GroupedTypeExpr));

// <DataStructTypeEntry> := DataStructFieldType | DataStructValueType;
//
// PEG: Field first — opens with `Identifier _ Colon`. On bare
// `Identifier` (no colon follows), backtracks to DataStructValueType,
// which matches via NoFuncTypeExpr → NamedType.
var DataStructTypeEntry = or(DataStructFieldType, DataStructValueType);

// <DataStructTypeList> := (DataStructTypeEntry (_ Comma _ DataStructTypeEntry)* (_ Comma _ DataStructFinalValType)?)
//                       | DataStructFinalValType;
//
// PEG: list arm first. FinalValType-only arm (bare `*int`) reached
// via fallthrough — list arm's DataStructTypeEntry opener doesn't
// include Star, so `<*int>` falls cleanly to arm 2.
var DataStructTypeList = or(
	and(
		DataStructTypeEntry,
		any(and(delim(), Comma, delim(), DataStructTypeEntry)),
		optional(and(delim(), Comma, delim(), DataStructFinalValType))
	),
	DataStructFinalValType
);

// DataStructTypeExpr := OpenAngle _ DataStructTypeList? _ (Comma _)? CloseAngle;
export const DataStructTypeExpr = production("DataStructTypeExpr",
	and(
		OpenAngle, delim(),
		optional(DataStructTypeList),
		delim(),
		optional(and(Comma, delim())),
		CloseAngle
	)
);

// FuncTypeArg := Qmark? NoUnionTypeExpr;
export const FuncTypeArg = production("FuncTypeArg",
	and(optional(Qmark), NoUnionTypeExpr)
);

// FuncTypeFinalArg := (Star NoUnionTypeExpr) | FuncTypeArg;
//
// PEG: gather arm first (distinctive Star opener); bare FuncTypeArg
// catches the non-gather final-position case.
export const FuncTypeFinalArg = production("FuncTypeFinalArg",
	or(
		and(Star, NoUnionTypeExpr),
		FuncTypeArg
	)
);

// <FuncTypeArgList> := (FuncTypeArg (_ Comma _ FuncTypeArg)* (_ Comma _ FuncTypeFinalArg)?)
//                    | FuncTypeFinalArg;
//
// PEG: list arm first. Single-FinalArg-first would commit on `(int`
// then fail at unconsumed `, str)` without backtracking past the
// committed `or` arm. Bare `(*int)` falls through to arm 2.
var FuncTypeArgList = or(
	and(
		FuncTypeArg,
		any(and(delim(), Comma, delim(), FuncTypeArg)),
		optional(and(delim(), Comma, delim(), FuncTypeFinalArg))
	),
	FuncTypeFinalArg
);

// FuncTypeExpr := OpenParen _ FuncTypeArgList? _ (Comma _)? CloseParen _ Caret _ Qmark? _ NoUnionTypeExpr;
export const FuncTypeExpr = production("FuncTypeExpr",
	and(
		OpenParen, delim(),
		optional(FuncTypeArgList),
		delim(),
		optional(and(Comma, delim())),
		CloseParen,
		delim(), Caret, delim(),
		optional(Qmark),
		delim(),
		NoUnionTypeExpr
	)
);

// <TypeExpr> := FuncTypeExpr | NoFuncTypeExpr;
//
// PEG: FuncTypeExpr first (disjoint OpenParen opener). Order mechanical.
var TypeExpr = or(FuncTypeExpr, NoFuncTypeExpr);

// DefTypeStmt := "deft" _ Identifier _ TypeExpr;
//
// <Stmt> orders DefTypeStmt after DefBlockStmt and DefVarStmt —
// disjoint opener (Keyword "deft" vs "def"). Order mechanical.
export const DefTypeStmt = production("DefTypeStmt",
	and(KwDeft, delim(), Identifier, delim(), TypeExpr)
);


// =============================================================
// PUBLIC API
//
// parseFoi(input): async generator yielding shaped top-level
// statement AST nodes. The lex layer streams tokens into the syn
// parse; each top-level Program child is yielded as it commits.
// =============================================================

export async function *parseFoi(input,opts = {}) {
	var config = {
		preserveTerminals: true,
		preserveDelim: false,
		memoize: true,
		...opts,
	};
	var handle = parse(Program, tokenize(input), config);
	var events = handle.subscribe(presets.parseCommitsAtDepth(1));
	var runPromise = handle.run();
	for await (let ev of events) {
		yield shapeNode(ev.node, shapers, config);
	}
	var result = await runPromise;
	if (!result.ok) {
		let tok = handle.elementAt(result.maxPos);
		let loc = tok
			? `unexpected ${tok.type}(${JSON.stringify(tok.value)}) at char ${tok.start}`
			: `at end of input`;
		throw new SyntaxError(`Foi parse failed: ${loc} (token ${result.maxPos})`);
	}
}
