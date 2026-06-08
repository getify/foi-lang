// parser.js — Foi syntactic parser. Operates over tokens from new-tokenizer.js.

import util from "node:util";
import {
	lazy, parse, production, terminal,
	and, or, optional, any, many,
	not, lookahead, eof, gate, dispatch,
	delim, delimWSReq, presets, shapeNode,
} from "./parser-combinators.js";

import { tokenize } from "./new-tokenizer.js";


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

// NumberLit := (EscapedNumber | Number | PositiveIntegerLit) (_ AsAnnotationExpr)?;
//
// The lex layer's EscapedNumber is a hidden dispatcher that splices an
// (Escape variant, Number variant) pair as siblings. From the syn layer
// we consume it as two adjacent tokens: an Escape followed by a Number.
// PEG order: try the two-token escaped form first, then bare Number,
// then bare PositiveIntegerLit (longest first, per Note 2 in the lex
// grammar).
export const NumberLit = production("NumberLit",
	and(
		or(
			and(tokType("Escape"), tokType("Number")),
			tokType("Number"),
			tokType("PositiveIntegerLit")
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
// NamedType is §18 (deferred). The lazy() ref fails-through until
// §18 lands; since every AsAnnotationExpr call site wraps it in
// OptAsAnnotation, missing NamedType just means `:as` annotations
// don't parse yet.
export const AsAnnotationExpr = production("AsAnnotationExpr",
	and(KwAs, delim(), lazy(() => NamedType))
);

// <Expr> := ExprNoBlock | BlockExpr | DoComprExpr | DoLoopComprExpr | GroupedExpr;
var Expr = or(
	lazy(() => ExprNoBlock),
	lazy(() => BlockExpr),
	lazy(() => DoComprExpr),
	lazy(() => DoLoopComprExpr),
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
//
// TEMP — until §9 lands, OperandExpr drops directly to BareOperandExpr
// so literals and identifiers remain reachable through Expr. When §9
// arrives, replace with `lazy(() => BinaryExpr)` and the tier ladder
// will reach BareOperandExpr via BinaryAtom.
var OperandExpr = lazy(() => BareOperandExpr);

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


// =============================================================
// §6 IDENTIFIER / ACCESS EXPRESSIONS
// =============================================================

var At                    = tokType("At");
var Period                = tokType("Period");
var OpenBracket           = tokType("OpenBracket");
var CloseBracket          = tokType("CloseBracket");
var DoublePeriod          = tokType("DoublePeriod");
var PositiveIntegerLitTok = tokType("PositiveIntegerLit");

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

// DotIdentifier := Period _ (Identifier | BuiltIn | PositiveIntegerLit);
//
// PositiveIntegerLit here is the lex token type, not NumberLit.
export const DotIdentifier = production("DotIdentifier",
	and(Period, delim(), or(Identifier, BuiltIn, PositiveIntegerLitTok))
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

// <CallArgs> := (_ CallArgList? _) | (Op SingleQuote?);
//
// The Op-quoted arm requires Op (§10, deferred). Until §10 lands its
// lazy() ref fails-through and only the CallArgList path is reachable.
var CallArgs = or(
	and(delim(), optional(CallArgList), delim()),
	and(lazy(() => Op), optional(SingleQuote))
);

// AtCallExpr := "None" At (_ AsAnnotationExpr)?
//             | (AtExpr | (IdentBase _ At) | MonadConstructor) _ ExprNoBlock (_ AsAnnotationExpr)?;
//
// Arm 1: bare `None@` (None monad constructor, no argument).
// Arm 2: at-form applied to an ExprNoBlock argument.
//
// PEG within arm 2:
//   - AtExpr first — matches IdentBase+access+adjacent At (no trivia between IdentBase and At).
//   - `(IdentBase _ At)` — allows trivia between IdentBase and At (AtExpr does not).
//   - MonadConstructor — bare `@` fallback.
export const AtCallExpr = production("AtCallExpr",
	or(
		and(BuiltinNone, At, OptAsAnnotation),
		and(
			or(AtExpr, and(IdentBase, delim(), At), MonadConstructor),
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

// ChainExpr := ChainBase (_ ChainSeg)+ (_ AsAnnotationExpr)?;
//
// Requires ≥1 ChainSeg — a bare ChainBase alone (e.g. just an
// identifier, just a literal) falls through to the later
// alternatives in BareOperandExprNoEmpty.
export const ChainExpr = production("ChainExpr",
	and(ChainBase, many(and(delim(), ChainSeg)), OptAsAnnotation)
);

// <CallExpr> := AtCallExpr | ChainExpr;
//
// PEG: AtCallExpr first so `foo@ 5` reaches the at-form (applied
// call) rather than parsing as `foo@` (an AtExpr inside ChainExpr)
// with dangling `5`.
var CallExpr = or(AtCallExpr, ChainExpr);

// OpFuncExpr := OpenParen (Op | DotAngleExpr | DotBracketExpr | (OpenBracket CloseBracket)) SingleQuote? CloseParen (_ AsAnnotationExpr)?;
//
// Op (§10) is deferred — its lazy() ref fails-through until §10 lands.
// In the interim, OpFuncExpr only matches via DotAngleExpr,
// DotBracketExpr, or the bare `[]` arm.
export const OpFuncExpr = production("OpFuncExpr",
	and(
		OpenParen,
		or(
			lazy(() => Op),
			DotAngleExpr,
			DotBracketExpr,
			and(OpenBracket, CloseBracket)
		),
		optional(SingleQuote),
		CloseParen,
		OptAsAnnotation
	)
);


// =============================================================
// PUBLIC API
//
// parseFoi(input): async generator yielding shaped top-level
// statement AST nodes. The lex layer streams tokens into the syn
// parse; each top-level Program child is yielded as it commits.
// =============================================================

export async function *parseFoi(input) {
	var handle = parse(Program, tokenize(input), {
		preserveTerminals: true,
		preserveDelim: false,
	});
	var events = handle.subscribe(presets.parseCommitsAtDepth(1));
	var runPromise = handle.run();
	for await (let ev of events) {
		yield shapeNode(ev.node, shapers);
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


//////////////////////////////////////////////////////

// var testInput = '`"hi `42`!";';
// var testInput = "export { a: b, :y };";
// var testInput = "def <a: b, c: d,>: empty;";
// var testInput = "def x: ((42)); def y: (empty); 5;";
// var testInput = '(42); (true); ("hi"); (empty);';
// var testInput = "def x: foo.bar[42].baz;";
// var testInput = "def x: foo@; def y: (@); def z: #;";
// var testInput = "def x: arr.[1..5]; def y: arr.[..10]; def z: arr.[5..];";
// var testInput = "def x: rec.<a, b, c>;";
var testInput = 'foo(1, 2); foo.bar(x); ("hi").len; ((42).foo)|y|;';


for await (let node of parseFoi(testInput)) {
	console.log(util.inspect(node,{depth:10}));
}
