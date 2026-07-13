// parser.js — Foi syntactic parser. Operates over tokens from tokenizer.js.

import {
	lazy, parse, production, terminal,
	and, or, optional, any, many, lookahead,
	eof, delim, presets, shapeNode,
} from "./parser-combinators.js";

import { tokenize } from "./tokenizer.js";
import { defaultShapers } from "./default-shapers.js";


// =============================================================
// TOKEN-MATCHING HELPERS
// =============================================================

var tokType = name           => terminal(t => t && t.type === name);
var tokVal  = (name, value)  => terminal(t => t && t.type === name && t.value === value);


// =============================================================
// PRODUCTIONS
// EBNF in Syntactic-Grammar.md is the source of truth.
// =============================================================

// =============================================================
// §1 PROGRAM / STATEMENTS
// =============================================================

// <Stmt> := DefHookDecl | DefBlockStmt | DefVarStmt | DefTypeStmt | Expr;
//
// PEG: DefHookDecl first — both DefHookDecl and Expr→DefFuncExpr
// open with `defn`. DefHookDecl additionally requires a marker
// (At, Percent, Comprehension, or Tilde+OpenAngle) between
// Identifier and paren-set; the marker-bearing form commits to
// DefHookDecl, and the marker-less form falls through cleanly to
// Expr→DefFuncExpr. Anonymous DefFuncExpr (no Identifier) also
// falls through — DefHookDecl requires the Identifier.
var Stmt = or(
	lazy(() => DefHookDecl),
	lazy(() => DefBlockStmt),
	lazy(() => DefVarStmt),
	lazy(() => DefTypeStmt),
	lazy(() => Expr)
);

var Semicolon = tokType("Semicolon");

// StmtSemi          := Stmt? (_ Semicolon)+;
// StmtSemiOpt       := Stmt? (_ Semicolon)*;
// ExportStmtSemi    := ExportExpr (_ Semicolon)+;
// ExportStmtSemiOpt := ExportExpr (_ Semicolon)*;
export const StmtSemi          = production("StmtSemi", and(optional(Stmt), many(and(delim(), Semicolon))));
export const StmtSemiOpt       = production("StmtSemiOpt", and(optional(Stmt), any (and(delim(), Semicolon))));
export const ExportStmtSemi    = production("ExportStmtSemi", and(lazy(() => ExportExpr), many(and(delim(), Semicolon))));
export const ExportStmtSemiOpt = production("ExportStmtSemiOpt", and(lazy(() => ExportExpr), any (and(delim(), Semicolon))));

// Program := _ ((StmtSemi | ExportStmtSemi) _)*
//            ((StmtSemiOpt | ExportStmtSemiOpt) _)?;
export const Program = production("Program",
	and(
		delim(),
		any(and(or(StmtSemi, ExportStmtSemi), delim())),
		optional(and(or(StmtSemiOpt, ExportStmtSemiOpt), delim())),
		eof()
	),
	{ preserveInnerDelim: true }
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

// Integer-lit token matchers and the hidden <IntegerLit> union from
// the lex layer. Used by §2 NumberLit and §6 DotIdentifier. The
// positive-only form is referenced separately by §6 PositiveIntLit
// (property-index contexts; sign disallowed).
var PositiveIntegerLitTok = tokType("PositiveIntegerLit");
var NegativeIntegerLitTok = tokType("NegativeIntegerLit");
var IntegerLit            = or(NegativeIntegerLitTok, PositiveIntegerLitTok);

// NumberLit         := EscapedNumberLit | Number | IntegerLit;
// <EscapedNumberLit> := EscapeNonUnicode (Number | PositiveIntegerLit);
// <EscapeNonUnicode> := EscapeHex | EscapeOctal | EscapeBinary | EscapeMonadic | EscapePlain;
//
// No `:as` tail — annotation comes via AsExpr (§5) where applicable.
//
// <EscapedNumberLit> names the two-token shape the syn consumes when
// the lex's hidden <EscapedNumber> dispatcher matched. The lex dispatcher
// has six arms; FIVE are reachable here at value position. The sixth
// (EscapeUnicode) is excluded — \u<hex> is a character escape, not a
// numeric literal, and is admitted exclusively from inside InterpExpr
// (see UnicodeCharLit, defined alongside InterpExpr below). The narrow
// `or(...)` over the five non-\u Escape values is what enforces this
// at the parser layer; the lexer still emits Escape("\\u") + Number
// anywhere in source.
//
// Of the five: four produce Escape + Number (Hex/Octal/Binary/Monadic,
// plus EscapePlain's BareNumber inner — all aliases for Number per
// Lexical-Grammar.md Notes 5/7); the fifth (EscapePlain paired with
// PositiveIntegerLitWithSep) produces Escape + PositiveIntegerLit
// (alias pattern per Note 6; routes through PositiveIntegerLit so the
// same token type feeds <PositiveIntLit> at PropertyExpr-key positions).
// NumberLit admits both pairings so unsigned separator-bearing integers
// like `\5_000` parse at value position, not only at PropertyExpr-key
// position.
//
// PEG order inside NumberLit: EscapedNumberLit first (two-token match,
// longest per Note 2 in the lex grammar), then bare Number, then bare
// IntegerLit. Inner or(Number, PositiveIntegerLit) is mechanical — the
// two token types are disjoint and the lex layer produces exactly one
// of them for any given escape match.
//
// Integer-only contexts maintain their own narrower reach —
// DotIdentifier (§6) admits bare IntegerLit only (whole numbers, no
// fractional/escape forms — that's the contract); PropertyExpr's
// <PositiveIntLit> (§6) admits bare PositiveIntegerLit plus the
// EscapePlain-paired form, but no signs and no \u.
var EscapeHexTok       = tokVal("Escape", "\\h");
var EscapeOctalTok     = tokVal("Escape", "\\o");
var EscapeBinaryTok    = tokVal("Escape", "\\b");
var EscapeMonadicTok   = tokVal("Escape", "\\@");
var EscapePlainTok     = tokVal("Escape", "\\");
var EscapeNonUnicode   = or(
	EscapeHexTok,
	EscapeOctalTok,
	EscapeBinaryTok,
	EscapeMonadicTok,
	EscapePlainTok
);

var EscapedNumberLit = and(
	EscapeNonUnicode,
	or(tokType("Number"), PositiveIntegerLitTok)
);

export const NumberLit = production("NumberLit",
	or(EscapedNumberLit, tokType("Number"), IntegerLit)
);

// BooleanLit := "true" | "false";
export const BooleanLit = production("BooleanLit",
	or(tokVal("Native", "true"), tokVal("Native", "false"))
);

// EmptyLit := "empty";
export const EmptyLit = production("EmptyLit",
	tokVal("Native", "empty")
);

// Lex token-name shortcuts used inside string forms.
var DoubleQuote            = tokType("DoubleQuote");
var Backtick               = tokType("Backtick");
var StringEscapedChar      = tokType("StringEscapedChar");
var StringChars            = tokType("String");      // PlainStrChars/InterpStrChars/etc. all emit "String"
var WhitespaceTok          = tokType("Whitespace");
var EscapeBacktickTok      = tokVal("Escape", "`");
var EscapeSpacingBacktickTok = tokVal("Escape", "\\`");

// PlainStr := DoubleQuote PlainStrContent* DoubleQuote;
// <PlainStrContent> := PlainStrChars | StringEscapedChar;
var PlainStrContent = or(StringChars, StringEscapedChar);
export const PlainStr = production("PlainStr",
	and(DoubleQuote, any(PlainStrContent), DoubleQuote)
);

// SpacingEscapedStr := EscapePlain DoubleQuote SpacingEscapedStrContent* DoubleQuote;
// <SpacingEscapedStrContent> := SpacingEscapedStrChars | StringEscapedChar | Whitespace;
var SpacingEscapedStrContent = or(StringChars, StringEscapedChar, WhitespaceTok);
export const SpacingEscapedStr = production("SpacingEscapedStr",
	and(EscapePlainTok, DoubleQuote, any(SpacingEscapedStrContent), DoubleQuote),
	{ preserveInnerDelim: true }
);

// InterpStr := EscapeBacktick DoubleQuote InterpStrContent* DoubleQuote;
// <InterpStrContent> := InterpStrChars | StringEscapedChar | InterpExpr;
var InterpStrContent = or(StringChars, StringEscapedChar, lazy(() => InterpExpr));
export const InterpStr = production("InterpStr",
	and(EscapeBacktickTok, DoubleQuote, any(InterpStrContent), DoubleQuote)
);

// SpacingInterpStr := EscapeSpacingBacktick DoubleQuote SpacingInterpStrContent* DoubleQuote;
// <SpacingInterpStrContent> := SpacingInterpStrChars | StringEscapedChar | Whitespace | InterpExpr;
var SpacingInterpStrContent = or(StringChars, StringEscapedChar, WhitespaceTok, lazy(() => InterpExpr));
export const SpacingInterpStr = production("SpacingInterpStr",
	and(EscapeSpacingBacktickTok, DoubleQuote, any(SpacingInterpStrContent), DoubleQuote),
	{ preserveInnerDelim: true }
);

// InterpExpr := Backtick _ (UnicodeCharLit | Expr) _ Backtick;
// UnicodeCharLit := EscapeUnicode Number;
//
// UnicodeCharLit is reachable ONLY from here — the \u<hex> form is
// excluded from NumberLit at value position (see EscapedNumberLit
// above) and admitted exclusively as the sole contents of an
// interpolation slot.
//
// UnicodeCharLit gets its own production name (NOT a NumberLit
// alias). Two productions sharing a name would collide in the
// packrat memo table (keyed by "ProductionName@pos" — see
// parser-combinators.js). The collision symptom: UnicodeCharLit
// fails at a position, caches failure under "NumberLit@N", and
// the subsequent Expr → NumberLit attempt at the same position
// returns the cached failure without trying.
//
// PEG ordered-choice: UnicodeCharLit tried before Expr. If
// UnicodeCharLit matches Escape("\\u") + Number and trailing tokens
// are not the closing Backtick (e.g., `\u263A + 1` or `\u263A.foo`
// inside an interp slot), the outer `and(Backtick, ..., Backtick)`
// fails — PEG commits to the matched UnicodeCharLit and does not
// retry the Expr arm. This is intentional: the slot-shape rule is
// "Expr alone, OR \u<hex> alone, never mixed."
var EscapeUnicodeTok = tokVal("Escape", "\\u");

export const UnicodeCharLit = production("UnicodeCharLit",
	and(EscapeUnicodeTok, tokType("Number"))
);

var InterpExpr = production("InterpExpr",
	and(
		Backtick,
		delim(),
		or(UnicodeCharLit, lazy(() => Expr)),
		delim(),
		Backtick
	)
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
var Qmark      = tokType("Qmark");

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

// DestructureDef              := (DestructureNamedDef | DestructureConciseDef) (_ Colon Qmark _ ExprNoBlock)? | DestructureCapture;
// <RecordDestructureDefList>  := DestructureDef (_ Comma _ DestructureDef)* (_ Comma)?;
//
// [SERIES 2] `:?` per-entry default tail. The `Colon Qmark`
// two-token composite is the same sigil introduced in §11 for
// VarDefInitOptImplIn — no delim() between the two tokens
// (mirrors the `Colon Equal` adjacency convention of
// AssignmentExpr in §12). The tail is attached at the
// alternation level: admitted on the two non-capture arms,
// excluded from DestructureCapture (capture reads the entire
// source, and destructure-against-empty errors before per-entry
// procedures per Foi-Specification.md §3.2.3, so a
// capture-with-default is unreachable).
//
// DestructureDef was previously a hidden dispatcher (plain
// `or()`); it becomes a visible `production()` here so its
// shaper can capture the tail. The shaper subsumes — the
// returned node is the inner DestructureNamedDef,
// DestructureConciseDef, or DestructureCapture directly, with
// the tail's ExprNoBlock folded onto the inner node's `.default`
// slot and the tail's `Colon Qmark` pushed to the inner node's
// `delims`. No `DestructureDef` node appears in the AST;
// downstream consumers see the same three node types they always
// have, now optionally carrying a `.default` field on the two
// non-capture arms. This mirrors §11's split of `.init` (bare
// `:`, strict positions) from `.default` (`:?`, lenient
// positions) — sigil-teaches-semantics extended per-entry.
//
// PEG: non-capture arm first (opens with Identifier or Colon);
// DestructureCapture second (opens with Hash). Disjoint openers
// make ordering mechanical.
var DestructureDef = production("DestructureDef",
	or(
		and(
			or(DestructureNamedDef, DestructureConciseDef),
			optional(and(delim(), Colon, Qmark, delim(), lazy(() => ExprNoBlock)))
		),
		DestructureCapture
	)
);

var RecordDestructureDefList = and(
	DestructureDef,
	any(and(delim(), Comma, delim(), DestructureDef)),
	optional(and(delim(), Comma))
);

// DestructurePositionalDef  := Identifier (_ Colon Qmark _ ExprNoBlock)?;
// <TupleDestructureEntry>   := DestructurePositionalDef | DestructureCapture;
// <TupleDestructureDefList> := (_ Comma)* (_ <TupleDestructureEntry> (_ Comma (_ <TupleDestructureEntry>)?)*)?;
//
// [DESTRUCTURE MODE SPLIT] Tuple-mode admits bare Identifier as
// a positional entry (list position → source position, per
// Foi-Specification.md §2.13.6) alongside DestructureCapture.
// The per-entry `:?` default tail (same `Colon Qmark` composite
// as record-side) attaches directly to the positional-def leaf
// — no dispatcher needed given a single grammatical arm.
// DestructurePositionalDef is visible so its shaper produces a
// dedicated positional-entry node with `.target` (the Identifier)
// and optional `.default` (the tail's `ExprNoBlock`), plus the
// sigil tokens in `delims`.
//
// The list combinator mirrors RecordTupleEntryList (§17) to
// preserve §1.5.2 tuple-form comma-counting rules: leading
// `any(and(delim(), Comma))` admits leading skip positions;
// the inner `any(and(delim(), Comma, optional(and(delim(),
// TupleDestructureEntry))))` admits interior skips as empty
// entries between commas; a lone trailing comma is permissive;
// additional trailing commas admit trailing skip positions.
// The DestructureTarget shaper walks the flattened parts,
// producing DestructureSkipSlot sentinel nodes in `.entries`
// for empty positions (Foi-Specification.md §2.13.6 abstract
// execution consumes leading + interior skips; trailing skips
// are grammatically admitted but semantically no-op — preserved
// in `.entries` for round-trip fidelity, ignored at emit).
//
// PEG: DestructurePositionalDef first (opens with Identifier);
// DestructureCapture second (opens with Hash). Disjoint openers.
var DestructurePositionalDef = production("DestructurePositionalDef",
	and(
		Identifier,
		optional(and(delim(), Colon, Qmark, delim(), lazy(() => ExprNoBlock))),
		// Positive lookahead — the entry must terminate at a
		// tuple-list boundary (Comma or CloseAngle). Prevents
		// tuple-mode from greedily consuming a bare Identifier
		// that opens a record-side Named form (`<a: src>`):
		// after Identifier matches `a`, the optional `:?` tail
		// fails on the bare `:` (Qmark absent), and this
		// lookahead then fails on `:` (neither Comma nor
		// CloseAngle), causing DestructurePositionalDef to fail
		// cleanly. TupleDestructureEntry falls through to
		// DestructureCapture (also fails), TupleDestructureEntry
		// fails, tuple's list fails, and PEG's ordered choice at
		// DestructureDefList falls through to RecordDestructureDefList
		// which parses the input correctly.
		//
		// Without this assertion, PEG would commit to tuple's
		// arm after PositionalDef succeeds on a bare `a`, then
		// fail at the outer DestructureTarget's CloseAngle
		// expectation — with no backtrack path to record.
		lookahead(and(delim(), or(Comma, CloseAngle)))
	)
);

var TupleDestructureEntry = or(DestructurePositionalDef, DestructureCapture);

// Non-nullable — two alternatives:
//   Alt 1: (_ Comma)* _ <TupleDestructureEntry> (_ Comma (_ <TupleDestructureEntry>)?)*
//          — at least one entry, with optional leading + interior + trailing skips
//   Alt 2: (_ Comma)+
//          — leading commas only, no entries (skip-only target)
// The non-nullability is load-bearing at DestructureDefList's PEG
// ordered choice — see the note below on tuple-first ordering.
var TupleDestructureDefList = or(
	// Alt 1: ≥1 entry, optional skips
	and(
		any(and(delim(), Comma)),
		delim(),
		TupleDestructureEntry,
		any(and(delim(), Comma, optional(and(delim(), TupleDestructureEntry))))
	),
	// Alt 2: ≥1 leading comma, no entries
	and(delim(), Comma, any(and(delim(), Comma)))
);

// <DestructureDefList> := <TupleDestructureDefList> | <RecordDestructureDefList>;
//
// PEG ordered choice — tuple-mode tried first. Non-nullability
// of tuple's list is load-bearing: without it, record-mode
// inputs like `<:a>` would trigger tuple's empty-match, commit
// via ordered choice, and fail at the outer CloseAngle without
// falling through to record. With non-nullability, tuple fails
// cleanly on record-opener inputs (`:name`, `name:`) → record
// arm fires. Conversely, tuple-first ordering avoids record's
// greedy-consumption-then-outer-fail issue (record's list
// `DestructureDef (_ Comma _ DestructureDef)* (_ Comma)?`
// would over-consume on `<#whole, a, b>`: match `#whole` +
// permissive trailing comma, then outer CloseAngle fails on
// `a`, with no PEG backtrack to alternative arm).
//
// All-capture targets (`< #whole >`) parse under tuple-mode's
// grammar arm by ordering; the DestructureTarget shaper still
// labels mode as "record" via its Pass 1 default (no positional
// entry → mode null → "record"). Grammar arm chosen is an
// implementation detail; semantic mode is determined by entry
// types.
//
// Empty `<>` fails under both arms (both non-nullable) —
// destructure-to-nothing is semantically vacuous and
// grammatically rejected.
//
// Mixed openings (`<:a, b>`, `<a, :b>`) fail under both arms
// → whole target rejected.
//
// The DestructureTarget shaper reads mode from the parts:
// presence of DestructurePositionalDef → tuple; presence of
// Named/Concise → record; else (all-capture / skip-only) →
// record by shaper default. Skip-slot sentinels are inserted
// at tuple-mode shaping time based on comma-vs-node
// interleaving in the parts stream.
var DestructureDefList = or(TupleDestructureDefList, RecordDestructureDefList);

// DestructureTarget := OpenAngle _ <DestructureDefList> _ CloseAngle;
export const DestructureTarget = production("DestructureTarget",
	and(OpenAngle, delim(), DestructureDefList, delim(), CloseAngle)
);

// DefVarStmt := "def" _ (Identifier | DestructureTarget) _ Colon _ (Expr | ImportExpr);
export const DefVarStmt = production("DefVarStmt",
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
// NamedType is §18 (forward-ref via lazy). Used by AsExpr (below)
// and by all six paren-grouping productions' optional trailing `:as`.
export const AsAnnotationExpr = production("AsAnnotationExpr",
	and(KwAs, delim(), lazy(() => NamedType))
);

// Shared optional `:as` tail. Now used ONLY by the six paren-grouping
// productions in §5 and §9 — leaves and other intermediates no longer
// carry their own `:as` tail. See the `:as` Precedence section in
// Syntactic-Grammar.md.
var OptAsAnnotation = optional(and(delim(), AsAnnotationExpr));

// <Expr> := DoComprExpr | DoLoopComprExpr | AsExpr | BareBlockExpr | ExprNoBlock | GroupedExpr;
//
// PEG ordering:
// - DoCompr / DoLoopCompr first (niche; distinctive `~<<` / `~<*` openers
//   reached after a leading Identifier/BuiltIn or ExprNoBlock; ordering
//   them first keeps them reachable before BareBlockExpr/ExprNoBlock try
//   to consume the leading token).
// - AsExpr before BareBlockExpr/ExprNoBlock — longer match (`...` + `:as`
//   tail) wins. Falls through cleanly on no `:as`.
// - BareBlockExpr opens with `{` — disjoint from every other `<Expr>`
//   arm's opener, so its ordering relative to ExprNoBlock / GroupedExpr
//   is mechanical. The standalone `(defs){body};` form (which previously
//   parsed via an optional-defs-init BlockExpr arm) is now intentionally
//   rejected: BlockExpr (the defs-init form, §11) is reachable only from
//   implicit-input positions (FlowRHSImplIn, FuncBodyPipeline body), not
//   from <Expr>, and a free-standing `(defs)` group has no source for the
//   defs-init to bind from. `(x){y;};` is a parse error rather than two
//   separate statements because there's no semicolon between `(x)` and
//   `{y;}`.
var Expr = or(
	lazy(() => DoComprExpr),
	lazy(() => DoLoopComprExpr),
	lazy(() => AsExpr),
	lazy(() => BareBlockExpr),
	lazy(() => ExprNoBlock),
	lazy(() => GroupedExpr)
);

// <ExprNoBlock> := DefFuncExpr | AssignmentExpr | MatchExpr | GuardedExpr | AsExpr | OperandExpr | GroupedExprNoBlock;
//
// PEG ordering:
// - DefFunc/Assignment/MatchExpr/GuardedExpr first (distinctive
//   `defn`/`:=`/`?{`/`?(`/`?[`/`![` openers).
// - AsExpr after GuardedExpr: GuardedExpr's body Expr is greedy
//   (consumes any inner `:as`), so trying AsExpr first when the
//   input is `?[c]:y :as int` would have AsExpr's <AsableExpr>
//   match GuardedExpr → body greedily eat `y :as int` → AsExpr's
//   outer `:as` tail then unsatisfied. Backtracking to plain
//   GuardedExpr produces the correct shape. Placing GuardedExpr
//   before AsExpr makes this the direct path.
// - AsExpr before OperandExpr — longer match (`...` + `:as` tail)
//   wins. Falls through cleanly on no `:as`, so `x + y` reaches
//   OperandExpr → BinaryExpr, and `x + y :as int` becomes a parse
//   error because AsExpr fails fast at `+` and then OperandExpr
//   matches `x + y` leaving `:as int` dangling.
var ExprNoBlock = or(
	lazy(() => DefFuncExpr),
	lazy(() => AssignmentExpr),
	lazy(() => MatchExpr),
	lazy(() => GuardedExpr),
	lazy(() => AsExpr),
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

// <BareOperandExprNoEmpty> := CallExpr | BooleanLit | NumberLit | StringLit | DataStructLit | BareIdentifier | OpFuncExpr | GroupedBareOpExprNoEmpty;
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
	lazy(() => BareIdentifier),
	lazy(() => OpFuncExpr),
	lazy(() => GroupedBareOpExprNoEmpty)
);

// AsExpr := <AsableExpr> _ AsAnnotationExpr;
// <AsableExpr>  := BareBlockExpr | GuardedExpr | UnaryExpr | AsableInner;
// <AsableInner> := EmptyLit | CallExpr | BooleanLit | NumberLit | StringLit
//                | DataStructLit | BareIdentifier | OpFuncExpr;
//
// The central carrier of `:as` annotations on non-paren expressions.
// Reachable from <Expr> and <ExprNoBlock> dispatchers (outer-position
// expression slots) and from the inner-expr alt of the four
// restrictive paren variants. NOT reachable from <BinaryAtom> — that
// is the mechanism that makes `x + y :as int` a parse error.
//
// PAREN-GROUPING productions are also deliberately NOT reachable
// from <AsableExpr>. Each paren-grouping production carries its own
// `(_ AsAnnotationExpr)?` tail; admitting paren forms here would
// allow `(x) :as bool :as char` — the paren's own tail consumes
// `:as bool`, the outer AsExpr's tail consumes `:as char`, and the
// AsExpr shaper's `inner.as = ...` then overwrites the `bool` that
// shapeGrouped already attached to the same GroupedExpr node.
// Removing paren reach turns the chain into a parse error. Paren-
// grouping remains reachable via <BinaryAtom> (for use as binary
// operands and chain bases), where each paren still carries its own
// one-shot `:as` tail for the legitimate `(...) :as T` form.
//
// <AsableInner> mirrors BareOperandExpr's content minus the two
// paren-grouping arms (GroupedBareOpExpr, GroupedBareOpExprNoEmpty).
// PEG order matches BareOperandExpr's effective inner order: EmptyLit
// first (longest distinctive prefix), then CallExpr (so `"hi".len`
// parses as a chain rather than StringLit with a dangling `.len`),
// then the bare leaves.
//
// PEG order in <AsableExpr>:
// - BareBlockExpr first (distinctive `{` opener).
// - GuardedExpr (distinctive `?[`/`![`).
// - UnaryExpr (`?`/`!`/named-unary).
// - AsableInner — paren-free operand-level forms.
//
// BlockExpr (the defs-init form, §11) is deliberately NOT in
// <AsableExpr>. It is only reachable from implicit-input positions
// (FlowRHSImplIn, FuncBodyPipeline body) and has no annotation path
// at all — there's no outer-expression slot where an AsExpr could
// wrap it. See the `:as` Precedence section in Syntactic-Grammar.md.
//
// Ranges deliberately omitted — `1..5 :as List` must be a parse
// error. Annotating a range requires explicit parens.
//
// AsExpr is a parse-time wrapper: its shaper unwraps, lifting `as`
// onto the inner node. No AsExpr node type appears in the AST.
var AsableInner = or(
	EmptyLit,
	lazy(() => CallExpr),
	BooleanLit,
	NumberLit,
	StringLit,
	lazy(() => DataStructLit),
	lazy(() => BareIdentifier),
	lazy(() => OpFuncExpr)
);
var AsableExpr = or(
	lazy(() => BareBlockExpr),
	lazy(() => GuardedExpr),
	lazy(() => UnaryExpr),
	AsableInner
);
export const AsExpr = production("AsExpr",
	and(AsableExpr, delim(), AsAnnotationExpr)
);

// All five §5 paren-grouping productions below are distinct visible
// AST nodes, each named for its inner content. Call sites reference
// the variant whose inner content they allow. (A sixth grouping
// production, GroupedDoExpr, is defined in §9 alongside BinaryAtom.)
//
// All six retain their own `(_ AsAnnotationExpr)?` trailing tail —
// parens are atomic groups that can carry `:as` regardless of
// position. The four restrictive variants additionally allow
// `AsExpr` as a first alternative in their inner slot so that
// constructs like `(?x :as bool)` parse correctly inside the parens.
//
// The three operand-position restrictive variants — GroupedOpExpr,
// GroupedBareOpExpr, GroupedBareOpExprNoEmpty — also admit
// DefFuncExpr, MatchExpr, and AssignmentExpr as inner alternatives.
// All three are value-producing constructs that the narrow-by-
// default inner allow-list (AsExpr / OperandExpr / BareOperandExpr
// ...) doesn't reach, but each composes naturally as a binary
// operand once parenthesized:
//
//   10 + (x := 5)                       AssignmentExpr — JS `x = 5`-like
//   (defn(x)^x*2) +> (defn(x)^x+1)      DefFuncExpr as compose operand
//   (?{ [c]: f; ?: g })(7)              MatchExpr as chain base
//
// The bare forms (`10 + x := 5`, `defn(x)^x*2 +> defn(x)^x+1`,
// `?{...} + 1`) remain parse errors — BinaryAtom itself admits
// none of `:=`, `defn`, or `?{`/`?(`, and there's no AsExpr-like
// fall-through that would silently re-bind their distinctive
// openers.
//
// GroupedDoExpr is excluded from all three widenings — its inner
// is do-compr-only by design, and any of these forms at binary-
// operand position is caught by the earlier arms in BinaryAtom's
// dispatch ordering.
//
// PEG order within each widened inner: DefFuncExpr first (distinct
// `defn` keyword), MatchExpr next (`?{` / `?(`, disjoint from
// GuardedExpr's `?[` reached through AsExpr), AssignmentExpr
// (Identifier-led with `:=` tail), AsExpr (`:as`-tailed), then
// the production-specific operand fall-through. All five inner
// arms are disjoint at their first one or two tokens.

// GroupedExpr := OpenParen _ Expr _ CloseParen (_ AsAnnotationExpr)?;
//
// Inner Expr reaches AsExpr via dispatch, so no widening needed.
export const GroupedExpr = production("GroupedExpr",
	and(OpenParen, delim(), Expr, delim(), CloseParen, OptAsAnnotation)
);

// GroupedExprNoBlock := OpenParen _ ExprNoBlock _ CloseParen (_ AsAnnotationExpr)?;
//
// Inner ExprNoBlock reaches AsExpr via dispatch, so no widening needed.
export const GroupedExprNoBlock = production("GroupedExprNoBlock",
	and(OpenParen, delim(), ExprNoBlock, delim(), CloseParen, OptAsAnnotation)
);

// GroupedOpExpr := OpenParen _ (DefFuncExpr | MatchExpr | AssignmentExpr | AsExpr | OperandExpr) _ CloseParen (_ AsAnnotationExpr)?;
//
// Canonical operand-position widening — this block carries the
// full rationale that GroupedBareOpExpr and GroupedBareOpExprNoEmpty
// defer to.
//
// AsExpr admitted so `:as`-bearing operand-level expressions like
// `(?x :as bool)` parse inside the parens.
//
// AssignmentExpr admitted so a parenthesized assignment can appear
// as a binary operand: `10 + (x := 5)`. The bare form `10 + x := 5`
// remains a parse error — BinaryAtom itself doesn't admit `:=`, and
// there's no AsExpr-like fall-through that would silently re-bind
// the assignment against the LHS.
//
// DefFuncExpr and MatchExpr admitted as inner alts so paren-wrapped
// function and match values compose naturally at binary-operand
// position — `(defn(x)^x+1) +> inc`, `(?{...})(7)`, etc. Both are
// value-producing constructs that the narrow-by-default inner
// allow-list (AsExpr / OperandExpr) doesn't reach, but each is
// reachable through ExprNoBlock at top-level — the omission at
// operand position was a hole, not a deliberate restriction. Same
// bare-form-rejection logic as AssignmentExpr: BinaryAtom admits
// neither `defn` nor `?{`/`?(`, so `defn(x)^x+1 +> inc` and
// `?{...} + 1` remain parse errors.
//
// PEG ordering inside the inner-alts `or(...)`:
//   1. DefFuncExpr      — distinct `defn` keyword, disjoint from all
//                         others.
//   2. MatchExpr        — `?{` or `?(`. Disjoint from GuardedExpr's
//                         `?[` (reached via AsExpr's AsableExpr arm)
//                         at the second token; disjoint from
//                         compare/and/or `?`-tokens (which are
//                         multi-char like `?=`, `?and`, never
//                         followed by `{`/`(` at the start of an
//                         operand).
//   3. AssignmentExpr   — Identifier-led with `:=` tail; mirrors
//                         <ExprNoBlock> ordering, where both
//                         AssignmentExpr and AsExpr can open with
//                         Identifier and the discriminating tail
//                         (`:=` vs `:as`) decides. Both fail fast
//                         on the wrong tail and fall through
//                         cleanly.
//   4. AsExpr           — `:as`-tailed; longer match wins over a
//                         bare OperandExpr that would otherwise
//                         leave `:as T` dangling.
//   5. OperandExpr      — general operand case, last.
//
// All five inner arms are disjoint at their first one or two tokens;
// PEG order is mechanical aside from the AssignmentExpr-before-AsExpr
// discriminator already noted.
export const GroupedOpExpr = production("GroupedOpExpr",
	and(
		OpenParen, delim(),
		or(
			lazy(() => DefFuncExpr),
			lazy(() => MatchExpr),
			lazy(() => AssignmentExpr),
			AsExpr,
			OperandExpr
		),
		delim(), CloseParen,
		OptAsAnnotation
	)
);

// GroupedBareOpExpr := OpenParen _ (DefFuncExpr | MatchExpr | AssignmentExpr | AsExpr | BareOperandExpr) _ CloseParen (_ AsAnnotationExpr)?;
//
// DefFuncExpr, MatchExpr, and AssignmentExpr admitted for
// parenthesized-value-as-binary-operand at the bare-operand reach.
// See GroupedOpExpr above for the full rationale and bare-form
// rejection logic. PEG ordering identical to GroupedOpExpr's
// inner-alts: DefFuncExpr (distinct `defn`), MatchExpr (`?{`/`?(`,
// disjoint from GuardedExpr's `?[` via AsableExpr), AssignmentExpr
// (Identifier-led, `:=` tail), AsExpr (`:as`-tailed), BareOperandExpr
// last for the production-specific operand fall-through.
export const GroupedBareOpExpr = production("GroupedBareOpExpr",
	and(
		OpenParen, delim(),
		or(
			lazy(() => DefFuncExpr),
			lazy(() => MatchExpr),
			lazy(() => AssignmentExpr),
			AsExpr,
			BareOperandExpr
		),
		delim(), CloseParen,
		OptAsAnnotation
	)
);

// GroupedBareOpExprNoEmpty := OpenParen _ (DefFuncExpr | MatchExpr | AssignmentExpr | AsExpr | BareOperandExprNoEmpty) _ CloseParen (_ AsAnnotationExpr)?;
//
// DefFuncExpr, MatchExpr, and AssignmentExpr admitted for
// parenthesized-value-as-binary-operand at the bare-operand-no-empty
// reach. See GroupedOpExpr above for the full rationale and bare-
// form rejection logic. PEG ordering identical to GroupedOpExpr's
// inner-alts: DefFuncExpr (distinct `defn`), MatchExpr (`?{`/`?(`,
// disjoint from GuardedExpr's `?[` via AsableExpr), AssignmentExpr
// (Identifier-led, `:=` tail), AsExpr (`:as`-tailed),
// BareOperandExprNoEmpty last for the production-specific operand
// fall-through.
//
// This is the inner-recursive paren form whose path excludes the
// EmptyLit-bearing variants (BareOperandExpr's first alt and
// GroupedBareOpExpr's BareOperandExpr inner). The structural fact
// is verified by the round-trip oracle; the original design
// rationale for that exclusion is not documented in the parser
// or grammar source.
export const GroupedBareOpExprNoEmpty = production("GroupedBareOpExprNoEmpty",
	and(
		OpenParen, delim(),
		or(
			lazy(() => DefFuncExpr),
			lazy(() => MatchExpr),
			lazy(() => AssignmentExpr),
			AsExpr,
			BareOperandExprNoEmpty
		),
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
var Ampersand             = tokType("Ampersand");

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

// <SpreadPropName> := Ampersand IdentBase MultiAccessExpr?;
//
// Spread-pick sigil inside DotAngleExpr — `&` followed by a
// source whose runtime value is a tuple of strings (or string-
// coercible names). Source alphabet mirrors PickValue exactly:
// IdentBase + optional MultiAccessExpr, no call suffixes.
// Inline calls require pre-binding: `def ks: Object.keys(rec); foo.<&ks>`.
//
// `&` keeps a single sigil meaning across contexts — "spread N
// slots from this source"; the slot shape varies by context. In
// a record literal `<&bar>`: bar contributes entries (k/v pairs).
// In a pick `.<&ks>`: ks contributes key NAMES. The source
// contract differs; the sigil's "spread" intent does not.
//
// No trivia between Ampersand and IdentBase (per grammar).
var SpreadPropName = and(Ampersand, IdentBase, optional(lazy(() => MultiAccessExpr)));

// <AnglePickEntry> := ComputedPropName | SpreadPropName | PropertyExpr;
//
// Three disjoint-opener arms: ComputedPropName on Percent,
// SpreadPropName on Ampersand, PropertyExpr on Identifier /
// PositiveIntegerLit / EscapePlain. Order is mechanical.
//
// ComputedPropName is defined in §17 (alongside ExplicitPropDef
// where it's also used) — forward-ref via lazy. Full alphabet
// parity with the existing ExplicitPropDef computed-key arm:
// `%foo`, `%foo.bar`, `%Maybe@42`, `%None@`, `%"k"`, `%#`.
var AnglePickEntry = or(
	lazy(() => ComputedPropName),
	SpreadPropName,
	PropertyExpr
);

// <AnglePropertyList> := AnglePickEntry (_ Comma _ AnglePickEntry)* (_ Comma)?;
var AnglePropertyList = and(
	AnglePickEntry,
	any(and(delim(), Comma, delim(), AnglePickEntry)),
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

// IdentityFunc := At;
//
// Bare `@` is the value identity function. The construct's
// distinguishing structural feature is the single At token.
// No `:as` tail — annotation comes via AsExpr (§5).
export const IdentityFunc = production("IdentityFunc", At);

// BareIdentifier := IdentBase;
//
// No `:as` tail — annotation comes via AsExpr (§5). The shaper
// subsumes BareIdentifier to its inner IdentBase node. Bare `@`
// as a value is NOT admitted at identifier position; the LHS-less
// identity-function value is reached via OpFuncExpr's operator-
// as-function lift `(@)`, same mechanism as every other operator.
// To extract a marker-preserving function reference from an
// `@`-hook-bearing namespace, use the `.@` chain-tail form
// (AtRefTail, §7).
export const BareIdentifier = production("BareIdentifier", IdentBase);

// <RangeOperand> := BareOperandExpr | GroupedOpExpr;
//
// Both alternatives consume tokens before reaching anything that
// could reach Range — no LR. Range operands are bare (no `:as`);
// annotating a range as a whole requires explicit parens.
var RangeOperand = or(BareOperandExpr, GroupedOpExpr);

// ClosedRangeExpr      := RangeOperand _ DoublePeriod _ RangeOperand;
export const ClosedRangeExpr = production("ClosedRangeExpr",
	and(RangeOperand, delim(), DoublePeriod, delim(), RangeOperand)
);
// LeadingRangeExpr  := RangeOperand _ DoublePeriod;
export const LeadingRangeExpr = production("LeadingRangeExpr",
	and(RangeOperand, delim(), DoublePeriod)
);
// TrailingRangeExpr := DoublePeriod _ RangeOperand;
export const TrailingRangeExpr = production("TrailingRangeExpr",
	and(DoublePeriod, delim(), RangeOperand)
);

// <RangeExpr> := ClosedRangeExpr | LeadingRangeExpr | TrailingRangeExpr;
//
// Closed first (two-sided, longest); Leading next (LHS + `..`);
// Trailing last (opens with `..`, doesn't conflict).
var RangeExpr = or(ClosedRangeExpr, LeadingRangeExpr, TrailingRangeExpr);


// =============================================================
// §7 Function Calls / Op-as-Function
// =============================================================

var Pipe         = tokType("Pipe");
var TriplePeriod = tokType("TriplePeriod");
var SingleQuote  = tokType("SingleQuote");
var Mountain     = tokType("Mountain");
var Valley       = tokType("Valley");
var Percent      = tokType("Percent");

// PrefixCallSuffix  := OpenParen CallArgs CloseParen;
export const PrefixCallSuffix = production("PrefixCallSuffix",
	and(OpenParen, lazy(() => CallArgs), CloseParen),
	{ preserveInnerDelim: true }
);

// PartialCallSuffix := Pipe       CallArgs Pipe;
export const PartialCallSuffix = production("PartialCallSuffix",
	and(Pipe, lazy(() => CallArgs), Pipe),
	{ preserveInnerDelim: true }
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
export const ConciseNamedArg = production("ConciseNamedArg",
	and(Colon, Identifier)
);

// ExplicitNamedArg := Identifier _ Colon _ Expr;
export const ExplicitNamedArg = production("ExplicitNamedArg",
	and(Identifier, delim(), Colon, delim(), Expr)
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
	or(NamedArgExpr, Expr)
);

// <CallArgList> := (_ Comma)* (_ CallArgExpr (_ Comma (_ CallArgExpr)?)*)?;
//
// Permissive comma handling — leading commas, trailing commas, and
// gaps between commas are all allowed (per grammar). Leading `_`
// inside the optional admits trivia between any trailing leading-
// skip-comma and the first arg (e.g., `foo(, a)`, `bar|, log|`).
// Without it, the `(_ Comma)*` iter rolls back its last failed `_`
// consumption and the optional opens at a position with no leading
// `_` available.
var CallArgList = and(
	any(and(delim(), Comma)),
	optional(and(
		delim(),
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

// AtCallExpr := IdentBase SingleAccessExpr? _ At (_ ExprNoBlock)?
//             | IdentityFunc _ ExprNoBlock;
//
// Uniformly a call form post-refactor (was: ref-vs-call distinction
// gated on payload presence, with a separate AtExpr reference
// production). To extract a marker-preserving function reference
// instead of calling, use the `.@` chain-tail form (AtRefTail,
// above).
//
// Arm 1 (user-rooted): `Foo@`, `Foo@x`, `Foo @ x`, `Foo.bar@`,
// `Foo.bar@x`, `Foo.bar @ x`. Trailing arg optional — when
// absent, semantic layer supplies `empty` default. Any IdentBase
// admits the no-payload form, including `None@` and other
// builtins.
//
// Arm 2 (IdentityFunc): `@x`, `@ x` — bare-`@` identity form,
// arg required.
//
// No `:as` tail — annotation comes via AsExpr (§5).
//
// PEG arm order: IdentBase arm first, IdentityFunc arm second.
// Disjoint openers (IdentBase: PipelineTopic/Identifier/Builtin;
// IdentityFunc: bare At). Order is mechanical.
//
// The shaper folds Arm 1 into AtCallExpr { base, arg? } where
// `base` is the foldAccess result of IdentBase + optional
// SingleAccessExpr (matching the foldAccess-at-shape-time
// pattern at the other unified access-fold sites). Arm 2 folds
// into IdentityCallExpr { arg }. See default-shapers.js
// AtCallExpr for the dispatch logic.
export const AtCallExpr = production("AtCallExpr",
	or(
		and(
			IdentBase, optional(SingleAccessExpr),
			delim(), At,
			optional(and(delim(), ExprNoBlock))
		),
		and(IdentityFunc, delim(), ExprNoBlock)
	)
);

// <ChainBase> := DefFuncExpr | MatchExpr | GuardedExpr | AssignmentExpr
//              | OpFuncExpr | GroupedExprNoBlock
//              | EmptyLit | BooleanLit | NumberLit | StringLit | DataStructLit
//              | BareIdentifier;
//
// PEG ordering (per grammar):
// - MatchExpr / GuardedExpr precede AssignmentExpr — distinctive `?`/`!` openers.
// - AssignmentExpr precedes BareIdentifier — longer `:=` match wins when it follows.
// - OpFuncExpr precedes GroupedExprNoBlock — both open with `(`, OpFuncExpr's stricter
//   inner shape (must be Op | DotAngle | DotBracket | `[]`) fails-through cleanly.
//
// GroupedExprNoBlock (not GroupedExpr) — paren-wrapped BareBlockExpr,
// DoComprExpr, and DoLoopComprExpr cannot serve as chain bases.
// Bind to a name first (`def x: {...}; x.foo`) to chain on those.
var ChainBase = or(
	lazy(() => DefFuncExpr),
	lazy(() => MatchExpr),
	lazy(() => GuardedExpr),
	lazy(() => AssignmentExpr),
	lazy(() => OpFuncExpr),
	GroupedExprNoBlock,
	EmptyLit,
	BooleanLit,
	NumberLit,
	StringLit,
	lazy(() => DataStructLit),
	BareIdentifier
);

// <ChainTail>       := EffectorTail | PostfixCallTail;
// EffectorTail      := _ Percent (_ ExprNoBlock)?;
// <PostfixCallTail> := SingleQuote (_ CallSuffix)*
//                    | (Mountain | Valley) CallSuffix*;
//
// ChainExpr := ChainBase
//              (
//                  (_ ChainSeg)+ ChainTail?
//                | ChainTail
//              );
//
// Requires extension beyond ChainBase — either ≥1 ChainSeg, or a
// chain tail (`'`, `/\`, `\/`, `%`, or `.@`). A bare ChainBase
// alone falls through to the later alternatives in
// BareOperandExprNoEmpty.
//
// No `:as` tail — annotation comes via AsExpr (§5).
//
// Five chain-tail forms, all mutually exclusive (no stacking with
// each other, no access tail after any of them):
//
//   `'`     — argument-reversal / universal-prime inversion on the
//             function value.
//   `/\`    — curry. Reshapes the function's parameter signature
//             into a tiered pyramid (one param per call site, by
//             arity from fn.length, outer-tier-only).
//   `\/`    — uncurry. Reshapes a tiered (curried) function into a
//             flat n-ary application, walking each tier's
//             fn.length to consume args from the call's arg list.
//   `%`     — effector application. Dispatches to the source's
//             effect-evaluation hook with an optional argument.
//             See EffectorTail (below) for details.
//   `.@`    — marker-preserving function reference extraction
//             from a hook-bearing namespace. `Foo.@` lowers to
//             `Foo._at`. See AtRefTail (below) for details.
//
// Mountain/Valley operator shapes ARE the resulting function's
// parameter-signature shape — see Foi-Guide.md.
//
// Adjacency rules differ across the three tail families:
//
//   PostfixCallTail (`'`/`/\`/`\/`): adjacent to the preceding
//     expression (NO trivia between). Each may be followed only
//     by zero or more call suffixes (terminates the access chain):
//       `'`     — trivia allowed between `'` and CallSuffix, and
//                 between consecutive CallSuffixes. `foo'(1,2,3)`
//                 and `foo' (1,2,3)` both parse.
//       `/\`/`\/` — NO trivia between modifier and first CallSuffix,
//                 nor between consecutive CallSuffixes. Reinforces
//                 "this is one operator-shaped call form, not a
//                 free chain of calls." `foo/\(1)(2)(3)` parses;
//                 `foo/\ (1)`, `foo/\(1) (2)` do not.
//
//   EffectorTail (`%`): trivia-tolerant on BOTH sides via leading
//     and between-arg `_`. `task%`, `task %`, `task% env`,
//     `task %env`, `task % env`, `task%env`, `task%(env)` all
//     parse. Carries no trailing call suffix — `task%(x)` is the
//     paren-grouped-arg binary form, not `(task%)` then `(x)`.
//
//   AtRefTail (`.@`): strict NO-trivia on both sides. No `_`
//     between Period and At, no leading `_` before Period.
//     Terminator — no trailing form admitted. To use the
//     extracted reference in a call, parenthesize: `(Foo.@)(x)`.
//
// Examples that parse: `foo'`, `foo'(1,2,3)`, `foo.bar'`,
// `foo.bar'(1,2,3)`, `(+)'(1,2,3)`; `foo/\`, `foo/\(1)(2)(3)`,
// `foo.bar/\(1)(2)`, `foo\/`, `foo\/(1,2,3)`; `task%`, `task %`,
// `task % env`, `processFile("f.txt")%`, `obj.method(x) % cfg`;
// `Foo.@`, `Foo.bar.@`.
// Examples that do not: `foo'.bar`, `foo'[0]`, `foo' .bar` (trivia
// before `'`); `foo /\`, `foo/\ (1)`, `foo/\'`, `foo/\\/` (stacking
// or trivia-violation on the curry/uncurry ops); `task%.field`,
// `task%[0]`, `task%'` (stacking or access tail after `%`); `%task`,
// `%`, `%y` (no LHS for `%`); `Foo. @`, `Foo .@` (trivia in or
// before `.@`), `Foo.@(x)`, `Foo.@.bar`, `Foo.@%`, `Foo.@'`
// (stacking on `.@`), `.@` (no LHS for `.@`).
//
// PEG arm order inside PostfixCallTail: SingleQuote first
// (single-char), then Mountain/Valley (two-char). Disjoint first
// chars — order is mechanical, not load-bearing.
//
// PEG arm order inside ChainTail: EffectorTail first (Percent
// opener), AtRefTail second (Period+At), PostfixCallTail last
// (SingleQuote / Mountain / Valley). All three first-tokens are
// disjoint, so the choice between EffectorTail and AtRefTail is
// mechanical. PostfixCallTail's no-leading-`_` rule is what
// makes `foo '` (WS before `'`) correctly fail: EffectorTail
// fails at Percent, AtRefTail fails at Period, PostfixCallTail
// fails on the leading WS, whole ChainTail fails, optional
// retracts. Preserves the no-trivia rule for `'`/`/\`/`\/`.
//
// AtRefTail's Period opener shares an opening token with
// DotIdentifier (a <ChainSeg>), but DotIdentifier requires
// Identifier/BuiltIn/IntegerLit after the Period. On `.@`,
// DotIdentifier fails in the seg loop; the loop exits and
// AtRefTail matches at the tail position.
//
// PEG arm order in ChainExpr outer: ChainSeg+-first before
// ChainTail-only. The ChainSeg+-first arm requires ≥1 ChainSeg
// via many(); on input where a tail form immediately follows
// ChainBase with no ChainSeg (e.g. `foo'`, `foo/\`, `task%`,
// `task %`, `Foo.@`), the first arm fails at many() and the
// ChainTail-only arm fires.
var PostfixCallTail = or(
	and(SingleQuote, any(and(delim(), CallSuffix))),
	and(or(Mountain, Valley), any(CallSuffix))
);

// EffectorTail := _ Percent (_ ExprNoBlock)?;
//
// The effector chain tail — applies `%` to the preceding chain
// expression, optionally with an argument. Bare `task%` is the
// no-arg form; `task % env`, `task%env`, `task%(env)` are the
// arg-taking forms — parens are expression grouping, not call
// form (`task%(env)` ≡ `task % env`, same AST).
//
// Trivia-tolerant on BOTH sides of `%` — `task %`, `task % env`,
// `task% env`, `task %env` all parse. The single AST type
// (EffectorCallExpr) carries an optional arg slot — trivia
// variants collapse into one node shape.
//
// Contrast with AtCallExpr (§7), which is also trivia-tolerant
// on both sides of `@` but folds via the same `IdentBase access?
// _ At (_ ExprNoBlock)?` production — `foo@`, `foo @ x`,
// `foo.bar@x` all collapse into a flat AtCallExpr { base,
// access?, arg? }. Contrast with AtRefTail (`.@`), which is
// strict NO-trivia on both sides — its terminator semantics
// demand a fixed `.@` form.
//
// Chain terminator: no stacking with `'`/`/\`/`\/`/`.@`, no
// access tail after `%`. To chain on the result: `(task%).field`,
// `(task%)(arg)`. Identical chain-terminator semantics to
// PostfixCallTail and AtRefTail.
//
// Shaper produces a transient `EffectorTail { arg?, delims }` node
// that ChainExpr's shaper intercepts and folds into EffectorCallExpr.
export const EffectorTail = production("EffectorTail",
	and(delim(), Percent, optional(and(delim(), lazy(() => ExprNoBlock))))
);

// AtRefTail := Period At;
//
// Marker-preserving function reference extraction tail —
// `Foo.@` lowers to `Foo._at`. Strict no-trivia on BOTH sides
// of `.@`:
//   - No `_` between Period and At (per grammar — `.@` is a
//     fixed conceptual token to keep its terminator semantics
//     unambiguous).
//   - No leading `_` before Period (consistent with
//     PostfixCallTail's adjacency rule, distinct from
//     EffectorTail which is trivia-tolerant).
//
// Chain terminator: no stacking with any other tail (`'`,
// `/\`, `\/`, `%`, `.@` itself), no access tail, no adjacency
// call. To use the extracted reference in a call,
// parenthesize: `(Foo.@)(x)`.
//
// Period also opens DotIdentifier (a <ChainSeg>), but
// DotIdentifier requires Identifier/BuiltIn/IntegerLit after
// the Period — `@` is a distinct token type, so DotIdentifier
// fails in the seg loop on `.@`, the loop exits, and AtRefTail
// matches at the tail position.
//
// Shaper produces a transient `AtRefTail { delims: [Period, At] }`
// node that ChainExpr's shaper intercepts and folds into
// `AtRefExpr { source }` (where `source` is the chain-fold up
// to the `.@`). See default-shapers.js ChainExpr for the
// interception path.
export const AtRefTail = production("AtRefTail",
	and(Period, At)
);

// <ChainTail> := EffectorTail | AtRefTail | PostfixCallTail;
//
// PEG order:
//   - EffectorTail first — Percent opener, disjoint from
//     AtRefTail's Period and PostfixCallTail's SingleQuote /
//     Mountain / Valley. Its leading `_` admits trivia before `%`.
//   - AtRefTail next — Period+At opener. Strict no-trivia on
//     both sides; period opener is disjoint from EffectorTail's
//     Percent and from PostfixCallTail's modifier tokens.
//   - PostfixCallTail last — adjacency-required (no leading `_`),
//     so `foo '` (WS before `'`) correctly fails: EffectorTail
//     fails at Percent, AtRefTail fails at Period, PostfixCallTail
//     fails on the leading WS, whole ChainTail fails, optional
//     retracts. Preserves the no-trivia rule for `'`/`/\`/`\/`.
var ChainTail = or(EffectorTail, AtRefTail, PostfixCallTail);

export const ChainExpr = production("ChainExpr",
	and(
		ChainBase,
		or(
			and(
				many(and(delim(), ChainSeg)),
				optional(ChainTail)
			),
			ChainTail
		)
	),
	{ preserveInnerDelim: true }
);

// <CallExpr> := AtCallExpr | ChainExpr;
//
// PEG: AtCallExpr first so `foo@ 5` reaches the at-form (call
// with payload) rather than `foo@` (call with empty default,
// via AtCallExpr's optional payload) followed by a dangling
// `5` that ChainExpr can't reach. AtCallExpr's `IdentBase
// access? _ At (_ ExprNoBlock)?` always consumes the trailing
// payload when present at this position.
var CallExpr = or(AtCallExpr, ChainExpr);

// OpFuncExpr := OpenParen (DotAngleExpr | DotBracketExpr | (OpenBracket CloseBracket) | Op) SingleQuote? CloseParen;
//
// No `:as` tail — annotation comes via AsExpr (§5).
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
		CloseParen
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
//
// Neither unary arm carries `:as` directly — annotation comes via
// AsExpr (§5). This is the precedence-fix that prompted the rework:
// `?x :as bool` now correctly hoists `as` onto the outer
// SymbolicUnaryExpr rather than the inner Identifier.

var Exmark = tokType("Exmark");

var KwQmarkEmpty  = tokVal("BooleanOper", "?empty");
var KwExmarkEmpty = tokVal("BooleanOper", "!empty");

// NamedUnaryExpr := NamedUnaryOp _ BinaryAtom;
//
// NamedUnaryOp is §10; forward-ref via lazy().
export const NamedUnaryExpr = production("NamedUnaryExpr",
	and(
		lazy(() => NamedUnaryOp),
		delim(),
		lazy(() => BinaryAtom)
	)
);

// SymbolicUnaryExpr := (Qmark | Exmark) _ BinaryAtom;
export const SymbolicUnaryExpr = production("SymbolicUnaryExpr",
	and(
		or(Qmark, Exmark),
		delim(),
		lazy(() => BinaryAtom)
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
// <BinaryAtom> does NOT include AsExpr. That is what enforces the
// rule that `:as` cannot attach as a tail on a binary operand —
// `x + y :as int` is a parse error rather than silently binding
// `:as` to `y`. See the `:as` Precedence section of the grammar.
//
// All op refs forward to §10 via lazy() (forward-ref, §10 appears
// later in this file).

// <BinaryAtom> := ClosedRangeExpr | UnaryExpr | BareOperandExpr
//               | GroupedOpExpr | GroupedDoExpr;
//
// PEG order: ClosedRangeExpr first (two-sided, longest); Unary
// next (prefix forms consume Qmark/Exmark/?empty/!empty before
// backtracking); BareOperandExpr and GroupedOpExpr cover bare atoms
// and parenthesized op-expressions respectively. GroupedOpExpr
// before GroupedDoExpr — both open with OpenParen, but the
// op-expr inner is the common case; do-compr inner is niche and
// falls through cleanly when GroupedOpExpr's inner OperandExpr
// rejects the do-compr opener.
//
// LeadingRangeExpr / TrailingRangeExpr deliberately omitted —
// open-ended ranges have no value semantic at expression position.
// Both productions still exist and are reachable via <RangeExpr>
// inside DotBracketExpr (`arr.[5..]`, `arr.[..5]`).
var BinaryAtom = or(
	ClosedRangeExpr,
	UnaryExpr,
	BareOperandExpr,
	GroupedOpExpr,
	lazy(() => GroupedDoExpr)
);

// GroupedDoExpr := OpenParen _ (AsExpr | DoComprExpr | DoLoopComprExpr) _ CloseParen (_ AsAnnotationExpr)?;
//
// Lets a do-comprehension appear as a binary operand (always
// parenthesized). Forward refs to §16 via lazy(). PEG order inside
// matches <Expr> ordering: AsExpr first (for `(?x :as bool)`-style
// inputs that route here when other variants reject them), then
// the two do-compr arms.
export const GroupedDoExpr = production("GroupedDoExpr",
	and(
		OpenParen, delim(),
		or(
			AsExpr,
			lazy(() => DoComprExpr),
			lazy(() => DoLoopComprExpr)
		),
		delim(), CloseParen,
		OptAsAnnotation
	)
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

// <FlowLHS>        := CondClause | OrDispatch;
// <FlowRHSImplIn>  := BlockExpr | BareBlockExpr | OrDispatch;
// <FlowRHSStrict>  := OrDispatch;
//
// Per-op RHS narrowing — see Syntactic-Grammar.md §9.
//
// ComprOp / PipelineOp RHS receive an implicit input element (each
// comprehension item / pipeline topic). Both block arms are admitted:
// BlockExpr (defs-init `(...)` + body, using the lenient inner
// BlockDefsInitOptImplIn so destructure-no-init can bind from the
// implicit input) and BareBlockExpr (no-defs case).
//
// ComposeOp RHS receives a function value (compose lifts a chain of
// functions). There is no implicit element at compose, so a defs-init
// has no source to bind from, and a bare body without defs is not a
// function value. FlowRHSStrict therefore collapses to OrDispatch —
// no block arm at all. The compose operand must be a function-valued
// expression.
//
// CondClause (§14), BlockExpr (§11), and BareBlockExpr (§11) are
// forward-refs via lazy().
var FlowLHS       = or(lazy(() => CondClause), OrDispatch);
var FlowRHSImplIn = or(lazy(() => BlockExpr), lazy(() => BareBlockExpr), OrDispatch);
var FlowRHSStrict = OrDispatch;

// FlowBinExpr      := FlowLHS (_ FlowOpAndRHS)+;
// <FlowOpAndRHS>   := (ComprOp     _ FlowRHSImplIn)
//                   | (PipelineOp  _ FlowRHSImplIn)
//                   | (ComposeOp   _ FlowRHSStrict);
//
// PEG order on FlowOpAndRHS: ComprOp / PipelineOp / ComposeOp
// have disjoint openers (Tilde / Hash / Plus|OpenAngle), so order
// is mechanical.
//
// ComprOp / PipelineOp / ComposeOp live in §10, defined AFTER
// this point in the file. Forward-ref each via lazy().
var FlowOpAndRHS = or(
	and(lazy(() => ComprOp),    delim(), FlowRHSImplIn),
	and(lazy(() => PipelineOp), delim(), FlowRHSImplIn),
	and(lazy(() => ComposeOp),  delim(), FlowRHSStrict)
);
export const FlowBinExpr = production("FlowBinExpr",
	and(FlowLHS, many(and(delim(), FlowOpAndRHS)))
);

// <FlowDispatch> := FlowBinExpr | OrDispatch;
var FlowDispatch = or(FlowBinExpr, OrDispatch);

// <BinaryExpr> := FlowDispatch;
var BinaryExpr = FlowDispatch;


// =============================================================
// §10 OPERATOR FAMILY
// =============================================================
//
// Op (used in OpFuncExpr) is the full union of operators —
// anything that can be quoted as a function value.

var Tilde          = tokType("Tilde");
var Plus           = tokType("Plus");
var Hyphen         = tokType("Hyphen");
var Star           = tokType("Star");
var ForwardSlash   = tokType("ForwardSlash");
var Dollar         = tokType("Dollar");
var Equal          = tokType("Equal");
var Caret          = tokType("Caret");
var ComprehensionTok = tokType("Comprehension");

// <ComprOp> := Comprehension | (Tilde OpenAngle);
var ComprOp = or(ComprehensionTok, and(Tilde, OpenAngle));

// <PipelineOp> := Hash CloseAngle;
var PipelineOp = and(Hash, CloseAngle);

// <ComposeOp> := (Plus CloseAngle) | (OpenAngle Plus);
var ComposeOp = or(and(Plus, CloseAngle), and(OpenAngle, Plus));

// <FlowOp> := ComprOp | PipelineOp | ComposeOp;
var FlowOp = or(ComprOp, PipelineOp, ComposeOp);

// <OrOp>  := "?or" | "!or";
// <AndOp> := "?and" | "!and";
var OrOp  = or(tokVal("BooleanOper", "?or"),  tokVal("BooleanOper", "!or"));
var AndOp = or(tokVal("BooleanOper", "?and"), tokVal("BooleanOper", "!and"));

// <NamedCompareOp> := "?in" | "!in" | "?has" | "!has";
var NamedCompareOp = or(
	tokVal("BooleanOper", "?in"),
	tokVal("BooleanOper", "!in"),
	tokVal("BooleanOper", "?has"),
	tokVal("BooleanOper", "!has")
);

// <AsTypeOp> := "?as" | "!as";
var AsTypeOp = or(tokVal("BooleanOper", "?as"), tokVal("BooleanOper", "!as"));

// <SymbolicCompareOp> := (Qmark | Exmark) ((OpenAngle Equal CloseAngle) | (OpenAngle Equal) | (CloseAngle Equal) | (OpenAngle CloseAngle) | (Dollar Equal) | Equal | OpenAngle | CloseAngle);
//
// Longest sequence first so `?<=>` matches before `?<=` / `?<>` / etc.
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

// <CompareOp> := NamedCompareOp | SymbolicCompareOp;
var CompareOp = or(NamedCompareOp, SymbolicCompareOp);

// <AddOp> := (Dollar Plus) | Plus | Hyphen;
//
// PEG: Dollar Plus first (two-token longest), then bare Plus/Hyphen.
var AddOp = or(and(Dollar, Plus), Plus, Hyphen);

// <MulOp> := Star | ForwardSlash;
var MulOp = or(Star, ForwardSlash);

// <NamedUnaryOp> := "?empty" | "!empty";
var NamedUnaryOp = or(KwQmarkEmpty, KwExmarkEmpty);

// <UnaryOpSym> := Qmark | Exmark | SingleQuote | TriplePeriod | DoublePeriod | Period | Mountain | Valley | Percent | At;
//
// Mountain (`/\`), Valley (`\/`), Percent (`%`), and At (`@`)
// admitted so OpFuncExpr picks up the bare op-as-function forms
// `(/\)` / `(\/)` / `(%)` / `(@)` alongside the universal-prime
// forms `(/\')` / `(\/')` / `(%')` / `(@')` via OpFuncExpr's
// existing `optional(SingleQuote)` tail.
//
// Chain-tail attachment of `'` / `/\` / `\/` to a function value
// is handled by ChainExpr's PostfixCallTail (§7); `%`'s chain-tail
// attachment is handled by ChainExpr's EffectorTail (§7); `@`'s
// call-form is handled by AtCallExpr (§7), not here. Neither bare
// `@` nor bare `%` is reachable at value position — `(@)` and
// `(%)` (the op-as-function lifts admitted here) are the only
// first-class-value routes.
var UnaryOpSym = or(Qmark, Exmark, SingleQuote, TriplePeriod, DoublePeriod, Period, Mountain, Valley, Percent, At);

// <Op> := FlowOp | OrOp | AndOp | CompareOp | AsTypeOp | AddOp | MulOp | NamedUnaryOp | UnaryOpSym;
var Op = or(FlowOp, OrOp, AndOp, CompareOp, AsTypeOp, AddOp, MulOp, NamedUnaryOp, UnaryOpSym);


// =============================================================
// §11 BLOCK EXPRESSIONS
// =============================================================
//
// Three productions form the block family:
//
//   BareBlockExpr := OpenBrace _ BlockStmts _ CloseBrace;
//                    (no defs-init at all)
//   BlockExpr     := BlockDefsInitOptImplIn _ BareBlockExpr;
//                    (defs-init REQUIRED; lenient inner; implicit-input
//                     positions only)
//   DefBlockStmt  := "def" _ BlockDefsInitOpt _ BareBlockExpr;
//                    (strict-optional inner; stmt position, no implicit
//                     input source)
//
// Where each is reachable:
//
// - BareBlockExpr — reachable from <Expr>, <AsableExpr>, <FlowRHSImplIn>,
//   and FuncBodyPipeline body. Also reachable transitively at
//   MatchConsequent / GuardedExpr colon-led body slots through their
//   inner Expr arm (Expr → AsableExpr → BareBlockExpr). Carries the
//   bare-body case at every block-accepting slot.
//
// - BlockExpr — only at <FlowRHSImplIn> (ComprOp / PipelineOp RHS) and
//   FuncBodyPipeline body. Both are implicit-input positions: the
//   enclosing context supplies the source the defs-init binds from
//   (each comprehension item / pipeline topic / positional argument
//   into the function). Defs-init is required — the bare-body form
//   at these positions goes through BareBlockExpr instead.
//
// - DefBlockStmt — only at <Stmt>. No implicit input source at a
//   top-level `def (...)` position, so destructure-no-init has nothing
//   to bind from. The strict-optional inner enforces this:
//   `def (x) { ... };` parses (Identifier-no-init is allowed —
//   declares x as undefined); `def (<:a>) { ... };` is a parse error;
//   `def (<:a>: src) { ... };` parses with explicit init.
//
// Standalone rejection: `(defs) { body };` with no enclosing
// implicit-input context is intentionally not in the grammar. Free-
// standing defs-init has no source to bind from, so admitting it
// would be semantically meaningless. See §5's <Expr> PEG note.
//
// VarDefInitOpt vs. VarDefInitOptImplIn mirrors this fork at the
// entry level, carrying both a grammatical distinction (init-
// requiredness) AND a sigil-semantic distinction (init form):
//   - VarDefInitOpt (strict): bare `:` init sigil, unconditional
//     binding. Identifier-init optional, DestructureTarget-init
//     required. Used at DefBlockStmt's BlockDefsInitOpt where no
//     implicit source exists.
//   - VarDefInitOptImplIn (lenient): `:?` init sigil, override-on-
//     empty binding. Both Identifier-init and DestructureTarget-init
//     optional. Used at implicit-input sites — ParameterList (the
//     positional argument is the source) and BlockDefsInitOptImplIn
//     (via FlowRHSImplIn / FuncBodyPipeline body — the comprehension
//     element / pipeline topic / function arg is the source).
//     The `:?` composite is Colon Qmark with no internal trivia,
//     same convention as AssignmentExpr's `:=`.
//
// `:as` reachability:
//   - BareBlockExpr reaches `:as` via AsExpr-wrap (it's in <AsableExpr>).
//   - BlockExpr has NO annotation path at all — it isn't in
//     <AsableExpr>, and its reachable contexts aren't outer-expression
//     slots where an AsExpr could wrap it. To annotate within a
//     ComprOp/PipelineOp/FuncBodyPipeline block, annotate the inner
//     expression instead.
//   - DefBlockStmt is a statement, not an expression — no `:as` path.

// VarDefInitOpt := (Identifier        (_ Colon _ ExprNoBlock)?)
//                | (DestructureTarget  _ Colon _ ExprNoBlock);
//
// Strict-optional form: DestructureTarget requires init. DefBlockStmt
// (this production's only consumer via BlockDefsInitOpt) has no
// implicit source.
export const VarDefInitOpt = production("VarDefInitOpt",
	or(
		and(Identifier,        optional(and(delim(), Colon, delim(), ExprNoBlock))),
		and(DestructureTarget,          and(delim(), Colon, delim(), ExprNoBlock))
	)
);

// VarDefInitOptImplIn := (Identifier        (_ Colon Qmark _ ExprNoBlock)?)
//                      | (DestructureTarget (_ Colon Qmark _ ExprNoBlock)?);
//
// Lenient form for implicit-input positions: ParameterList (positional
// arg is source) and BlockDefsInitOptImplIn (via FlowRHSImplIn /
// FuncBodyPipeline body — the comprehension/pipeline element / function
// arg is source).
//
// Init sigil is `:?` (Colon Qmark, no internal trivia — the `Colon,
// Qmark,` in the production body has no `delim()` between them,
// mirroring AssignmentExpr's `Colon, Equal,`). Semantic is override-
// on-empty: the init evaluates only when the implicit source at this
// entry is empty, otherwise the source binds directly and the init
// is not evaluated. Distinct from VarDefInitOpt (bare `:`,
// unconditional binding at no-implicit-source positions).
export const VarDefInitOptImplIn = production("VarDefInitOptImplIn",
	or(
		and(Identifier,        optional(and(delim(), Colon, Qmark, delim(), ExprNoBlock))),
		and(DestructureTarget, optional(and(delim(), Colon, Qmark, delim(), ExprNoBlock)))
	)
);

// <VarDefInitOptList>       := (_ Comma)* (_ VarDefInitOpt       (_ Comma (_ VarDefInitOpt)?)*)?;
// <VarDefInitOptImplInList> := (_ Comma)* (_ VarDefInitOptImplIn (_ Comma (_ VarDefInitOptImplIn)?)*)?;
//
// Leading `_` inside the optional admits trivia between any trailing
// leading-skip-comma and the first entry. See CallArgList for the
// PEG-mechanics rationale.
var VarDefInitOptList = and(
	any(and(delim(), Comma)),
	optional(and(
		delim(),
		VarDefInitOpt,
		any(and(delim(), Comma, optional(and(delim(), VarDefInitOpt))))
	))
);
var VarDefInitOptImplInList = and(
	any(and(delim(), Comma)),
	optional(and(
		delim(),
		VarDefInitOptImplIn,
		any(and(delim(), Comma, optional(and(delim(), VarDefInitOptImplIn))))
	))
);

// BlockDefsInitOpt       := OpenParen _ VarDefInitOptList       _ CloseParen;
// BlockDefsInitOptImplIn := OpenParen _ VarDefInitOptImplInList _ CloseParen;
export const BlockDefsInitOpt = production("BlockDefsInitOpt",
	and(OpenParen, delim(), VarDefInitOptList, delim(), CloseParen)
);
export const BlockDefsInitOptImplIn = production("BlockDefsInitOptImplIn",
	and(OpenParen, delim(), VarDefInitOptImplInList, delim(), CloseParen)
);

// <BlockStmts> := (StmtSemi _)* StmtSemiOpt?;
var BlockStmts = and(
	any(and(StmtSemi, delim())),
	optional(StmtSemiOpt)
);

// BareBlockExpr := OpenBrace _ BlockStmts _ CloseBrace.
//
// Visible production. Carries the bare-body case at every block-
// accepting slot in the grammar. preserveInnerDelim:true so the
// shaper sees inner trivia between stmts (needed for round-trip).
//
// No `:as` tail on the production itself — annotation comes via
// AsExpr (§5), where BareBlockExpr is the first arm of <AsableExpr>.
export const BareBlockExpr = production("BareBlockExpr",
	and(OpenBrace, delim(), BlockStmts, delim(), CloseBrace),
	{ preserveInnerDelim: true }
);

// BlockExpr := BlockDefsInitOptImplIn _ BareBlockExpr.
//
// Defs-init is REQUIRED (not optional) — BlockExpr now exclusively
// names the defs-init form. The bare-body form at every implicit-
// input slot goes through BareBlockExpr.
//
// Only reachable from implicit-input positions: <FlowRHSImplIn>
// (ComprOp / PipelineOp RHS) and FuncBodyPipeline body. The
// enclosing context supplies the source that destructure-no-init
// entries bind from — hence the lenient inner BlockDefsInitOptImplIn.
//
// No `:as` tail and no annotation path at all. BlockExpr is not in
// <AsableExpr> and its reachable contexts are not outer-expression
// slots. To annotate within a ComprOp/PipelineOp/FuncBodyPipeline
// block, annotate the inner expression instead.
//
// preserveInnerDelim:true so trivia between BlockDefsInitOptImplIn
// and the BareBlockExpr child is preserved for round-trip. The
// child's own internal trivia is handled by its own preserveInnerDelim.
export const BlockExpr = production("BlockExpr",
	and(BlockDefsInitOptImplIn, delim(), BareBlockExpr),
	{ preserveInnerDelim: true }
);

// BlockExprStrict := BlockDefsInitOpt _ BareBlockExpr.
//
// Host-attached body form (not a general expression). Reachable
// only from the colon-led body slots of GuardedExpr and
// MatchConsequent/MatchConsequentNoSemi — never from <Expr>.
//
// Uses the strict-optional inner: Identifier entries may omit
// their init (implicit `: empty`), but DestructureTarget entries
// require their init explicitly. The host positions have no
// implicit input source, so destructure-no-init has nothing to
// bind from.
//
// Same { type: "BlockExpr", defs, body } AST as BlockExpr —
// shaper alias at the bottom of default-shapers.js.
export const BlockExprStrict = production("BlockExprStrict",
	and(BlockDefsInitOpt, delim(), BareBlockExpr),
	{ preserveInnerDelim: true }
);

// DefBlockStmt := "def" _ BlockDefsInitOpt _ BareBlockExpr.
//
// `<Stmt>` orders DefBlockStmt before DefVarStmt — both open with
// `def`, but DefBlockStmt requires a `(...)` defs-init that
// DefVarStmt's identifier/destructure-target target can't match,
// so DefBlockStmt fails-through cleanly to DefVarStmt for the
// `def x: …` form.
//
// Uses the strict-optional BlockDefsInitOpt (Identifier-init
// optional, DestructureTarget-init required) — there is no implicit
// input at a top-level `def (...)` position, so a destructure-no-init
// entry would have no source to bind from. `def (x) { ... };` parses
// (Identifier-no-init declares x as undefined); `def (<:a>) { ... };`
// is a parse error; `def (<:a>: src) { ... };` parses.
//
// preserveInnerDelim:true so trivia between the `def` keyword,
// BlockDefsInitOpt, and the BareBlockExpr child is preserved for
// round-trip.
export const DefBlockStmt = production("DefBlockStmt",
	and(KwDef, delim(), BlockDefsInitOpt, delim(), BareBlockExpr),
	{ preserveInnerDelim: true }
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
		Expr
	)
);


// =============================================================
// §13 FUNCTION DEFINITIONS
// =============================================================

var KwDefn = tokVal("Keyword", "defn");
var KwOver = tokVal("Keyword", ":over");

// ParameterList := VarDefInitOptImplIn (_ Comma _ VarDefInitOptImplIn)*;
//
// Lenient — the positional argument at each param position is the
// implicit source for destructure-no-init.
export const ParameterList = production("ParameterList",
	and(
		VarDefInitOptImplIn,
		any(and(delim(), Comma, delim(), VarDefInitOptImplIn))
	)
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
// CondClause is §14; forward-ref via lazy.
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
	and(Caret, delim(), Expr)
);

// <FuncBodyStmt> := ReturnExpr | Stmt;
//
// PEG order: ReturnExpr first — opens with Caret, disjoint from
// all Stmt arms (def/defn/deft/expressions).
var FuncBodyStmt = or(ReturnExpr, Stmt);

// FuncBodyStmtSemi    := FuncBodyStmt (_ Semicolon)+;
// FuncBodyStmtSemiOpt := FuncBodyStmt (_ Semicolon)*;
export const FuncBodyStmtSemi    = production("FuncBodyStmtSemi", and(FuncBodyStmt, many(and(delim(), Semicolon))));
export const FuncBodyStmtSemiOpt = production("FuncBodyStmtSemiOpt", and(FuncBodyStmt, any (and(delim(), Semicolon))));

// <FuncBodyStmts> := (FuncBodyStmtSemi _)* FuncBodyStmtSemiOpt?;
var FuncBodyStmts = and(
	any(and(FuncBodyStmtSemi, delim())),
	optional(FuncBodyStmtSemiOpt)
);

// FuncBodyExpr := Caret _ (ExprNoBlock | GroupedExpr);
export const FuncBodyExpr = production("FuncBodyExpr",
	and(Caret, delim(), or(ExprNoBlock, GroupedExpr))
);

// FuncBodyPipeline := PipelineOp _ FlowRHSImplIn (_ FlowOpAndRHS)*;
//
// Conceptually sugar for `^ <first-positional-param> #> ...` — the
// function's first positional arg seeds the pipeline as the initial
// topic; the tail is the full FlowBinExpr chain.
//
// Stage 1 RHS is FlowRHSImplIn (identical to FlowBinExpr's PipelineOp
// RHS narrowing): BlockExpr | BareBlockExpr | OrDispatch. Stages 2+
// are the same FlowOpAndRHS iter FlowBinExpr uses — any mix of
// pipeline / comprehension / compose stages, no parens required to
// switch ops mid-chain.
//
// PEG: BlockExpr first so `#> (x){y;}` parses as BlockExpr (def `x`,
// body `{y;}`). BlockExpr at this position uses BlockDefsInitOptImplIn
// — the function's positional arg is the implicit input that
// destructure-no-init binds from. BareBlockExpr next handles the
// no-defs case `#> { y; }`. OrDispatch last carries every non-block
// form. Stage-1 ExprNoBlock / GroupedExpr arms from the prior single-
// RHS form are unified into OrDispatch — every reachable body form
// remains expressible via BinaryAtom's grouped variants.
//
// preserveInnerDelim:true so the shaper sees inter-stage soft delims
// directly and can route them: pre-stage-1 trivia onto FuncBodyPipeline.
// delims, inter-stage trivia onto the outermost synthesized FlowBinExpr
// (matching the delim placement a real FlowBinExpr at standalone
// position would carry). See the FuncBodyPipeline shaper in
// default-shapers.js for the routing logic.
export const FuncBodyPipeline = production("FuncBodyPipeline",
	and(
		PipelineOp, delim(), FlowRHSImplIn,
		any(and(delim(), FlowOpAndRHS))
	),
	{ preserveInnerDelim: true }
);

// FuncBodyBlock := OpenBrace _ FuncBodyStmts _ CloseBrace;
export const FuncBodyBlock = production("FuncBodyBlock",
	and(OpenBrace, delim(), FuncBodyStmts, delim(), CloseBrace),
	{ preserveInnerDelim: true }
);

// <FuncBody> := FuncBodyExpr | FuncBodyPipeline | FuncBodyBlock;
//
// Disjoint openers: Caret (Expr), Hash+CloseAngle (Pipeline `#>`),
// OpenBrace (Block).
var FuncBody = or(FuncBodyExpr, FuncBodyPipeline, FuncBodyBlock);

// DefFuncExpr := "defn" (_ Identifier)?
//                (_ OpenParen _ (ParameterList | GatherParameter)? _ CloseParen)+
//                (_ FuncPrecondList)? (_ FuncOverClause)? (_ FuncAsClause)?
//                _ FuncBody;
//
// `:as` on a defn is FuncAsClause, NOT a trailing OptAsAnnotation —
// DefFuncExpr does not carry any `(_ AsAnnotationExpr)?` tail.
//
// Legacy `@` marker (`defn Foo@(x) ^...`) removed — hook-bearing
// declarations now go through DefHookDecl (statement-only, §1).
// `defn Foo@(...)` at expression position is a parse error;
// statement-position usage commits to DefHookDecl via the §1 Stmt
// dispatcher.
export const DefFuncExpr = production("DefFuncExpr",
	and(
		KwDefn,
		optional(and(delim(), Identifier)),
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

// DefHookDecl := "defn" _ Identifier
//                (At | Percent | Comprehension | (Tilde OpenAngle))
//                (_ OpenParen _ (ParameterList | GatherParameter)? _ CloseParen)+
//                (_ FuncPrecondList)? (_ FuncOverClause)? (_ FuncAsClause)?
//                _ FuncBody;
//
// Statement-only — admitted from <Stmt> (§1), not from <Expr>.
// Anonymous hook declarations make no semantic sense (no namespace
// to attach to), so Identifier is required (no `optional()` on it,
// distinct from DefFuncExpr's anonymous-admissible form).
//
// Marker admits six disjoint shapes:
//   - At (@)                          — constructor hook (§3.1.1.1)
//   - Percent (%)                     — effect hook (§3.1.1.2)
//   - Comprehension                   — single-token comprehension
//                                       hook: ~map, ~each, ~filter,
//                                       ~fold, ~foldR, ~cata, ~ap
//                                       (and the lexed aliases
//                                       ~chain/~bind/~flatMap, which
//                                       parse here but semantic-
//                                       reject as aliases of ~<)
//                                       (§3.1.1.3)
//   - Tilde OpenAngle OpenAngle       — three-token composite for
//                                       the do-comprehension hook
//                                       ~<< (§3.1.1.3, §3.10.9.4)
//   - Tilde OpenAngle Star            — three-token composite for
//                                       the looping-do hook ~<*
//                                       (§3.1.1.3)
//   - Tilde OpenAngle                 — two-token composite for
//                                       the bind hook ~< (§3.1.1.3)
//
// Strict no-trivia between Identifier and the marker (mirrors the
// `Foo@` adjacency at use sites in AtCallExpr, and same rule for
// `Foo%` and `Foo~<glyph>`). For the Tilde OpenAngle composite
// markers (`~<`, `~<<`, `~<*`), strict no-trivia within the composite
// as well — matches the composite operators' adjacency rules at
// their respective use sites in §10. Trivia IS
// admitted between the marker and the first paren-set (mirrors
// normal `defn` paren spacing).
//
// Post-marker signature identical to DefFuncExpr — same paramSet+,
// optional precondition list, :over, :as, and FuncBody alternatives.
// Distinct production rather than shared because the AST shape and
// transpiler lowering diverge: DefHookDecl carries a `marker` field
// (surface glyph string: "@", "%", "~map", "~<", etc.), has no `at`
// flag, and hoists into a namespace literal via the transpiler's
// pre-pass.
//
// Marker token(s) survive in parts for the shaper to capture into
// `marker`. The marker disjunction must be positionally adjacent to
// Identifier in the and(...) sequence — no `delim()` between — to
// enforce the no-trivia rule.
//
// PEG ordering of the marker disjunction: At, Percent, and
// Comprehension arms are disjoint at token-type level, so their
// order is mechanical. The three Tilde-led composite arms all share
// the Tilde OpenAngle prefix; they MUST be ordered longest-match-
// first — (Tilde OpenAngle OpenAngle) and (Tilde OpenAngle Star)
// before (Tilde OpenAngle), otherwise the shorter arm would greedily
// match the leading two tokens of ~<< / ~<* and leave the third
// (OpenAngle / Star) dangling into the paren-slot.
export const DefHookDecl = production("DefHookDecl",
	and(
		KwDefn, delim(),
		Identifier,
		or(
			At,
			Percent,
			ComprehensionTok,
			and(Tilde, OpenAngle, OpenAngle),
			and(Tilde, OpenAngle, Star),
			and(Tilde, OpenAngle)
		),
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

// GuardedExpr := CondClause _ Colon _ (BlockExprStrict | Expr);
//
// PEG: BlockExprStrict before Expr — longer match wins when the
// body opens `(defs) { ... }`. On no `{` after the close paren,
// BlockExprStrict fails cleanly and Expr's grouped/operand arms
// parse the bare `(...)` form.
//
// No `:as` tail — annotation comes via AsExpr (§5).
export const GuardedExpr = production("GuardedExpr",
	and(CondClause, delim(), Colon, delim(), or(lazy(() => BlockExprStrict), Expr))
);


// =============================================================
// §15 MATCH EXPRESSIONS
// =============================================================

// MatchConsequent      := Colon _ (BlockExprStrict | Expr) _ Semicolon;
//
// Colon-led uniformly with §14 GuardedExpr and §3.5 preconditions —
// every CondClause/DepCondClause consequent attachment requires the
// leading `:`. BlockExprStrict precedes Expr — longer match wins when
// the consequent body opens `(defs) { ... }`. On no `{` after the
// close paren, BlockExprStrict fails cleanly and Expr's grouped/
// operand arms parse the bare `(...)` form. The bare `{ stmts }`
// consequent form reaches through Expr's <AsableExpr> path to
// BareBlockExpr.
//
// BlockExprStrict uses the strict-optional inner — match consequents
// have no implicit input source, so destructure-no-init entries are
// rejected.
var MatchConsequent = and(Colon, delim(), or(lazy(() => BlockExprStrict), Expr), delim(), Semicolon);

// MatchConsequentNoSemi := Colon _ (BlockExprStrict | Expr);
//
// Same BlockExprStrict-before-Expr rationale as MatchConsequent.
var MatchConsequentNoSemi = and(Colon, delim(), or(lazy(() => BlockExprStrict), Expr));

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
// MatchConsequentNoSemi (bare `:expr` or BareBlockExpr), distinct from
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

// <DepCondBoolOp> := CompareOp | AndOp | OrOp;
var DepCondBoolOp = or(
	CompareOp,
	AndOp,
	OrOp
);

// DepCondBoolExpr := AsTypeOp _ NamedType
//                  | DepCondBoolOp _ CompareDispatch
//                  | NamedUnaryOp
//                  | OpenParen _ DepCondBoolExpr _ CloseParen;
//
// PEG: AsTypeOp arm first — disjoint opener (?as/!as) from
// DepCondBoolOp (which is CompareOp|AndOp|OrOp, none of which include
// ?as/!as anymore). NamedUnaryOp arm is a single BooleanOper token
// (?empty/!empty), disjoint from AsTypeOp, DepCondBoolOp, and the
// paren-recursive arm's OpenParen opener. Bare form — no RHS; the
// topic supplies the implicit operand at atom-render time.
export const DepCondBoolExpr = production("DepCondBoolExpr",
	or(
		and(AsTypeOp, delim(), lazy(() => NamedType)),
		and(DepCondBoolOp, delim(), CompareDispatch),
		NamedUnaryOp,
		and(OpenParen, delim(), lazy(() => DepCondBoolExpr), delim(), CloseParen)
	)
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

// DepCondClause := (Qmark | Exmark)? OpenBracket _ DepCondExprList _ CloseBracket;
export const DepCondClause = production("DepCondClause",
	and(
		optional(or(Qmark, Exmark)),
		OpenBracket, delim(),
		DepCondExprList,
		delim(), CloseBracket
	)
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
		Expr
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

// DoStmtSemi    := DoStmt? (_ Semicolon)+;
// DoStmtSemiOpt := DoStmt? (_ Semicolon)*;
export const DoStmtSemi    = production("DoStmtSemi", and(optional(DoStmt), many(and(delim(), Semicolon))));
export const DoStmtSemiOpt = production("DoStmtSemiOpt", and(optional(DoStmt), any (and(delim(), Semicolon))));

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

// DoVarDefInitOpt := (Identifier        (_ (DoubleColon | Colon) _ ExprNoBlock)?)
//                    | (DestructureTarget (_ (DoubleColon | Colon) _ ExprNoBlock)?);
export const DoVarDefInitOpt = production("DoVarDefInitOpt",
	or(
		and(Identifier,        optional(and(delim(), or(DoubleColon, Colon), delim(), ExprNoBlock))),
		and(DestructureTarget, optional(and(delim(), or(DoubleColon, Colon), delim(), ExprNoBlock)))
	)
);

// <DoVarDefInitOptList> := (_ Comma)* (_ DoVarDefInitOpt (_ Comma (_ DoVarDefInitOpt)?)*)?;
//
// Leading `_` inside the optional admits trivia between any trailing
// leading-skip-comma and the first entry. See CallArgList for the
// PEG-mechanics rationale.
var DoVarDefInitOptList = and(
	any(and(delim(), Comma)),
	optional(and(
		delim(),
		DoVarDefInitOpt,
		any(and(delim(), Comma, optional(and(delim(), DoVarDefInitOpt))))
	))
);

// DoBlockDefsInitOpt := OpenParen _ DoVarDefInitOptList _ CloseParen;
export const DoBlockDefsInitOpt = production("DoBlockDefsInitOpt",
	and(OpenParen, delim(), DoVarDefInitOptList, delim(), CloseParen)
);

// <DoBareBlockExpr> := OpenBrace _ DoBlockStmts _ CloseBrace;
var DoBareBlockExpr = and(OpenBrace, delim(), DoBlockStmts, delim(), CloseBrace);

// DoBlockExpr := DoBlockDefsInitOpt? _ DoBareBlockExpr;
//
// `<DoBareBlockExpr>` stays hidden; its OpenBrace/stmts/CloseBrace
// contents splice into DoBlockExpr's parts. Parallel to BlockExpr/
// BareBlockExpr in §11, but DoBlockExpr keeps the optional defs-init
// shape (do-comprehensions have their own implicit-input semantics
// distinct from the §11 BlockExpr / BareBlockExpr fork).
export const DoBlockExpr = production("DoBlockExpr",
	and(optional(DoBlockDefsInitOpt), delim(), DoBareBlockExpr),
	{ preserveInnerDelim: true }
);

// <DoComprLHS> := Identifier | BuiltIn;
//
// Shared LHS shape for DoComprExpr and DoLoopComprExpr. Type-LHS only
// per Slot 15's axis lock — the dispatch to a specific hook resolves
// at compile time. Iterable drainage over List/Iter/PullStream moved
// to `~<<`; `~<*` retains producer-broadcast admissions (Channel,
// PushStream, effect handler scopes).
var DoComprLHS = or(Identifier, BuiltIn);

// DoComprExpr := DoComprLHS _ Tilde OpenAngle OpenAngle _ DoBlockExpr;
//
// `~<<` is Tilde + OpenAngle + OpenAngle — three adjacent single-char
// tokens at the syn layer.
export const DoComprExpr = production("DoComprExpr",
	and(
		DoComprLHS,
		delim(),
		Tilde, OpenAngle, OpenAngle,
		delim(),
		DoBlockExpr
	)
);

// DoLoopComprExpr := DoComprLHS _ Tilde OpenAngle Star _ DoBlockExpr;
//
// `~<*` is Tilde + OpenAngle + Star — three adjacent single-char
// tokens. Shares LHS (DoComprLHS) and RHS (DoBlockExpr) shape with
// DoComprExpr; differs only in the operator.
//
// Value-LHS-with-fn-RHS iter form (`xs ~<* fn`) is gone under Slot 15.
// Source enters via DoBlockDefsInit clause (`Channel ~<* (v:: ch) {...}`).
export const DoLoopComprExpr = production("DoLoopComprExpr",
	and(
		DoComprLHS,
		delim(),
		Tilde, OpenAngle, Star,
		delim(),
		DoBlockExpr
	)
);


// =============================================================
// §17 DATA STRUCTURE LITERALS
// =============================================================

// PickValue := Ampersand IdentBase MultiAccessExpr?;
//
// No trivia between Ampersand and IdentBase (per grammar).
export const PickValue = production("PickValue",
	and(Ampersand, IdentBase, optional(MultiAccessExpr))
);

// ComputedPropAccessChain := IdentBase ((DotIdentifier | BracketExpr))*;
//
// Bare identifier-access chain for the computed-key bare alphabet.
// IdentBase (PipelineTopic | Identifier | BuiltIn) optionally
// followed by 0+ dot/bracket access segs to arbitrary depth.
//
// Excludes DotBracketExpr (range), DotAngleExpr (pick), call
// suffixes, at-tails, and PostfixCallTail — `%foo.<a,b>`,
// `%foo.[1..3]`, `%foo(x)`, `%foo@x`, `%foo'`, etc. are all
// rejected at the bare arm; paren-wrap rewrite is available
// (`%(foo.<a,b>)` etc.).
//
// Bare IdentBase (zero segs) folds to just the IdentBase node;
// segs fold left-to-right via applyChainSeg into the same
// MemberAccessExpr / IndexAccessExpr nesting ChainExpr produces.
export const ComputedPropAccessChain = production("ComputedPropAccessChain",
	and(
		IdentBase,
		any(or(DotIdentifier, lazy(() => BracketExpr)))
	)
);

// ComputedPropParenExpr := OpenParen _ OperandExpr _ CloseParen;
//
// Paren-wrap arm of ComputedPropName. Inner is OperandExpr — the
// full binary expression ladder (Flow → Or → And → Compare → Add
// → Mul → Unary → BinaryAtom). Reaches arithmetic, comparison,
// logical, flow, comprehension, plus chain/at/postfix-modified
// forms via BareOperandExpr's CallExpr arm.
//
// Excludes AsExpr / AssignmentExpr / DefFuncExpr / MatchExpr /
// BareBlockExpr / DoComprExpr / DoLoopComprExpr — none reachable
// from OperandExpr. This bounds the visual cost: no `:as`-tailed
// or `:`-bearing top-level forms inside `%(...)` would collide
// with the outer ExplicitPropDef Colon.
//
// NO trailing (_ AsAnnotationExpr)? — `:as` on a computed key
// has no semantic use case and would collide visually with the
// ExplicitPropDef Colon. Differs from §5's six paren-grouping
// productions in this respect.
//
// Unwrap-shaper — returns the inner OperandExpr node directly,
// lifting OpenParen/CloseParen onto its delims (same pattern as
// RecordTupleValue / GroupedTypeExpr).
export const ComputedPropParenExpr = production("ComputedPropParenExpr",
	and(
		OpenParen, delim(),
		OperandExpr,
		delim(), CloseParen
	)
);

// <ComputedPropNumberLit> := PositiveIntLit
//                          | NegativeIntegerLit
//                          | Number
//                          | (EscapeHex Number)
//                          | (EscapeOctal Number)
//                          | (EscapeBinary Number)
//                          | (EscapePlain Number);
//
// Numeric-literal alphabet for the computed-key bare arm. Admits
// every NumberLit shape EXCEPT monadic (`\@FF`) and unicode
// (`\u<hex>`) — both categorically not numeric (monadic =
// arbitrary-precision / out of bootstrap scope; unicode = char
// escape, narrowed to InterpExpr-slot at value position).
//
// Reach:
//   - Bare integers: `42`, `-5` — via PositiveIntLit and
//     NegativeIntegerLit (their token types win in lex PEG order
//     over bare Number's integer sub-arm)
//   - Bare decimals: `3.14`, `-3.14` — via the bare Number arm
//     (BareNumber's decimal sub-arm emits Number)
//   - Escape-paired sep'd: `\5_000` (via PositiveIntLit's
//     EscapePlain arm), `\-1_000` and `\100_000.25`
//     (EscapePlain + Number — BareNumber's integer / decimal
//     sub-arms)
//   - Escape-paired typed-radix, signed or unsigned: `\hFF` /
//     `\h-FF`, `\o73` / `\o-755`, `\b1010` / `\b-1100` — signs
//     handled inside HexNumber/OctalNumber/BinaryNumber per the
//     lex layer; these three have no decimal sub-arms per
//     Lexical-Grammar.md, so the Number tokens they emit are
//     integer-shaped by lex contract
//
// Deliberately excluded (no Escape variant present in the or):
//   - Monadic (`\@FF`, `\@FF.AA` — EscapeMonadicTok not in arms)
//   - Unicode (`\u263A` — EscapeUnicodeTok not in arms)
//   - EmptyLit (`%empty` — not numeric; not handled here either)
//
// PEG order:
//   1. PositiveIntLit — covers bare positive int (PositiveIntegerLit
//      token) and EscapePlain-paired positive sep'd int.
//   2. NegativeIntegerLit — bare negative int (NegativeIntegerLit
//      token, disjoint type from Number).
//   3. Bare Number — catches bare decimal `3.14` / `-3.14`. Bare
//      integers don't reach here (PositiveIntegerLit / NegativeIntegerLit
//      win in lex PEG order before Number's integer sub-arm).
//   4. Four Escape-paired arms — first chars (\h, \o, \b, \)
//      disjoint from preceding arms.
var ComputedPropNumberLit = or(
	PositiveIntLit,
	NegativeIntegerLitTok,
	tokType("Number"),
	and(EscapeHexTok,    tokType("Number")),
	and(EscapeOctalTok,  tokType("Number")),
	and(EscapeBinaryTok, tokType("Number")),
	and(EscapePlainTok,  tokType("Number"))
);

// <ComputedPropBare> := BooleanLit | StringLit | ComputedPropNumberLit | ComputedPropAccessChain;
//
// Bare alphabet for `%key` outside parens. Visual-clarity test:
// every admitted form reads unambiguously as a leaf-shaped key
// expression (literal, identifier, or simple access path).
//
// PEG ordering: BooleanLit (Native opener `true`/`false`),
// StringLit (DoubleQuote / Escape openers), ComputedPropNumberLit
// (digit / Escape openers), ComputedPropAccessChain (IdentBase
// opener: PipelineTopic / Identifier / BuiltIn). All four arms
// open with disjoint first tokens — order is mechanical.
var ComputedPropBare = or(
	BooleanLit,
	StringLit,
	ComputedPropNumberLit,
	ComputedPropAccessChain
);

// <ComputedPropName> := Percent (<ComputedPropBare> | ComputedPropParenExpr);
//
// No trivia between Percent and inner. Synthesized as a
// ComputedPropName AST node by ExplicitPropDef and DotAngleExpr
// shapers (no own production — stays hidden, matching the prior
// design pre-narrowing).
//
// Reach narrowed to a small, visually-distinct alphabet:
//   - Bare arm admits leaf-shaped values + identifier-access chains.
//     Multi-seg dot/bracket access is fine; pick/range/call/at/
//     postfix-modifier forms are not.
//   - Paren-wrap arm admits the full binary expression ladder.
//
// What was previously admitted but now requires paren-wrap:
//   - `%foo(x)` (call suffix)        → `%(foo(x))`
//   - `%foo|x|` (partial-call)       → `%(foo|x|)`
//   - `%foo@x`, `%Maybe@42`, `%foo@` → `%(foo@x)` etc.
//   - `%foo'` (primed)               → `%(foo')`
//   - `%foo.<a,b>` (pick)            → `%(foo.<a,b>)`
//   - `%foo.[1..3]` (range)          → `%(foo.[1..3])`
//   - `%@` (bare IdentityFunc)       → `%(@)`
//
// What was previously rejected and remains rejected:
//   - `%defn(x)^x` — DefFuncExpr base (not in OperandExpr)
//   - `%?{...}` — MatchExpr base (not in OperandExpr)
//   - `%(x) :as int` — outer `:as` tail dropped from
//     ComputedPropParenExpr
//   - `%(x := 5)` — AssignmentExpr (not in OperandExpr)
//   - `%(<x: 1>)` parses; bare `%<x: 1>` does NOT (no DataStructLit
//     in ComputedPropBare).
//
// AnglePickEntry shares this alphabet via the same ComputedPropName
// reference — full parity in both contexts.
//
// PEG inside the inner or(...): ComputedPropBare opens with
// Native/Quote/Escape/Digit/IdentBase tokens; ComputedPropParenExpr
// opens with OpenParen. Disjoint, order mechanical.
var ComputedPropName = and(
	Percent,
	or(ComputedPropBare, ComputedPropParenExpr)
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

// RecordTupleValue := AsExpr | CallExpr | EmptyLit | BooleanLit | NumberLit | StringLit
//                   | DataStructLit | BareIdentifier
//                   | (OpenParen _ Expr _ CloseParen);
//
// PEG order:
// - AsExpr first — longer match with `:as` tail; falls through on no `:as`.
//   Preserves `<x :as int, y>` after the `:as` rework (leaves no longer
//   carry `:as` directly).
// - CallExpr next so `foo.bar` parses as ChainExpr rather than
//   BareIdentifier with dangling `.bar`.
// - DataStructLit before BareIdentifier — disjoint openers
//   (`<` vs IdentBase).
// - Paren-wrap arm last — consumes `(` before recursing, no LR.
//
// Paren-wrap inner is `Expr` (matching GroupedExpr's precedent), not
// recursive RecordTupleValue. The bare arms stay narrow (visual
// clarity inside `<...>` separators), but parens earn the right to
// admit broad expressions. Forms newly admitted via paren-wrap:
// DefFuncExpr (`<foo: (defn()^42)>`), MatchExpr (`<foo: (?{...})>`),
// AssignmentExpr (`<foo: (x := 5)>`), BareBlockExpr
// (`<foo: ({x; y;})>`), DoComprExpr (`<foo: (IO ~<< {x;})>`),
// DoLoopComprExpr, plus the full binary ladder (arithmetic,
// logical, comparison, flow/pipeline, comprehension): `<foo: (1 + 2)>`,
// `<foo: (x #> f)>`, `<foo: (xs ~map fn)>`. SetEntry inherits this
// widening via its RecordTupleValue arm — `<[(defn()^42), (x #> f)]>`
// also admits.
//
// Visible production (promoted from combinator alias): the paren-
// wrap arm needs its own frame so its OpenParen/CloseParen tokens
// land at entry granularity rather than splicing up to
// RecordTupleLit/SetLit/ExplicitPropDef. Shaper unwraps — returns
// the inner node, lifting wrapper parens onto its delims (same
// pattern as DepCondBoolExpr arm-3 and GroupedTypeExpr). AST surface
// for previously-admitted shapes (`(1)`, `((1))`, `(x)`) is unchanged
// because the inner Expr dispatch reaches the same leaf nodes
// through its own paren-wrap/unwrap path (GroupedExprNoBlock etc.),
// and those productions also lift parens onto inner-node delims.
var RecordTupleValue = production("RecordTupleValue", or(
	AsExpr,
	CallExpr,
	EmptyLit,
	BooleanLit,
	NumberLit,
	StringLit,
	lazy(() => DataStructLit),
	BareIdentifier,
	and(OpenParen, delim(), lazy(() => Expr), delim(), CloseParen)
));

// <RecordTupleEntry> := PickValue | RecordProperty | RecordTupleValue;
//
// PEG:
//   - PickValue first — opens with `&`, disjoint.
//   - RecordProperty before RecordTupleValue: ExplicitPropDef's
//     PropertyExpr opener overlaps with RecordTupleValue's BareIdentifier
//     opener (both can start with Identifier) and with NumberLit
//     (both can start with PositiveIntegerLit). ExplicitPropDef
//     requires a `_ Colon _ value` tail; missing tail backtracks
//     cleanly to RecordTupleValue.
//   - RecordTupleValue last.
var RecordTupleEntry = or(PickValue, RecordProperty, RecordTupleValue);

// <RecordTupleEntryList> := (_ Comma)* (_ RecordTupleEntry (_ Comma (_ RecordTupleEntry)?)*)?;
//
// Permissive comma handling — same shape as CallArgList. Leading `_`
// inside the optional admits trivia between any trailing leading-
// skip-comma and the first entry.
var RecordTupleEntryList = and(
	any(and(delim(), Comma)),
	optional(and(
		delim(),
		RecordTupleEntry,
		any(and(delim(), Comma, optional(and(delim(), RecordTupleEntry))))
	))
);

// RecordTupleLit := OpenAngle _ RecordTupleEntryList _ CloseAngle;
//
// No `:as` tail — annotation comes via AsExpr (§5).
export const RecordTupleLit = production("RecordTupleLit",
	and(
		OpenAngle, delim(),
		RecordTupleEntryList,
		delim(), CloseAngle
	)
);

// <SetEntry>     := PickValue | RecordTupleValue;
// <SetEntryList> := (_ Comma)* (_ SetEntry (_ Comma (_ SetEntry)?)*)?;
//
// Sets don't carry RecordProperty entries — sets are unordered
// collections of values, no keys. Leading `_` inside the optional
// admits trivia between any trailing leading-skip-comma and the
// first entry (same fix as CallArgList et al).
var SetEntry = or(PickValue, RecordTupleValue);
var SetEntryList = and(
	any(and(delim(), Comma)),
	optional(and(
		delim(),
		SetEntry,
		any(and(delim(), Comma, optional(and(delim(), SetEntry))))
	))
);

// SetLit := OpenAngle OpenBracket _ SetEntryList _ CloseBracket CloseAngle;
//
// `<[` and `]>` are two-token compound openers/closers — no trivia
// between OpenAngle/OpenBracket or CloseBracket/CloseAngle.
//
// No `:as` tail — annotation comes via AsExpr (§5).
export const SetLit = production("SetLit",
	and(
		OpenAngle, OpenBracket, delim(),
		SetEntryList,
		delim(), CloseBracket, CloseAngle
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
//                    | DataStructTypeExpr;
//
// PEG: NestedTypeExpr before NamedType (longer; same NamedType opener).
// Other arms disjoint by opener (literals by token type/value;
// DataStruct opens with OpenAngle).
//
// GroupedTypeExpr is NOT an arm here. The brace-grouped form is
// reached as an explicit `(NoUnionTypeExpr | GroupedTypeExpr)`
// alternative at the three sites that admit it: FuncTypeArg,
// FuncTypeFinalArg's Star-prefixed arm, and FuncTypeExpr's return
// slot. Admitting it here would make those explicit arms redundant
// and would silently admit decorative bracing in
// DataStructValueType / DataStructFinalValType / NestedTypeExpr-arg
// where the strict-B brace rule wants it rejected.
var NoUnionTypeExpr = or(
	NestedTypeExpr,
	NamedType,
	EmptyLit,
	PlainStr,
	NumberLit,
	BooleanLit,
	lazy(() => DataStructTypeExpr)
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
// Trailing `|` allowed only inside grouped union type, per grammar.
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

// <DataStructValueType> := NoFuncTypeExpr;
//
// Strict-B brace rule: decorative bracing of a non-union type in
// field/value position is rejected. Unions are bare (`<x: a|b>`);
// function-typed fields must be named via DefTypeStmt rather than
// inlined.
var DataStructValueType = NoFuncTypeExpr;

// DataStructFieldType   := Identifier _ Colon _ DataStructValueType;
export const DataStructFieldType = production("DataStructFieldType",
	and(Identifier, delim(), Colon, delim(), DataStructValueType)
);

// DataStructFinalValType := Star (NoUnionTypeExpr | GroupedTypeExpr);
//
// Strict-B brace rule: `*{T|U}` parallel to `?{T|U}` / `^{T|U}`.
// Bare union at rest-position is rejected for uniformity, not
// because the position is ambiguous.
export const DataStructFinalValType = production("DataStructFinalValType",
	and(Star, or(NoUnionTypeExpr, GroupedTypeExpr))
);

// <DataStructTypeEntry> := DataStructFieldType | DataStructValueType;
//
// PEG: DataStructFieldType first (Identifier + Colon + value). On
// missing Colon, backtracks to DataStructValueType.
var DataStructTypeEntry = or(DataStructFieldType, DataStructValueType);

// <DataStructTypeList> := (DataStructTypeEntry (_ Comma _ DataStructTypeEntry)* (_ Comma _ DataStructFinalValType)?)
//                       | DataStructFinalValType;
//
// PEG: entry-list-first arm before the bare-final arm. The entry-list
// arm requires ≥1 DataStructTypeEntry, so on input starting with
// Star (DataStructFinalValType's opener), it fails fast and the
// bare-final arm fires.
var DataStructTypeList = or(
	and(
		DataStructTypeEntry,
		any(and(delim(), Comma, delim(), DataStructTypeEntry)),
		optional(and(delim(), Comma, delim(), DataStructFinalValType))
	),
	DataStructFinalValType
);

// DataStructTypeExpr := OpenAngle _ DataStructTypeList? _ (Comma _)? CloseAngle;
//
// Trailing comma allowed.
export const DataStructTypeExpr = production("DataStructTypeExpr",
	and(
		OpenAngle, delim(),
		optional(DataStructTypeList),
		delim(),
		optional(and(Comma, delim())),
		CloseAngle
	)
);

// FuncTypeArg      := Qmark? (NoUnionTypeExpr | GroupedTypeExpr);
//
// PEG note for the `or(NoUnionTypeExpr, GroupedTypeExpr)` alternative
// at FuncTypeArg/FuncTypeFinalArg-Star/FuncTypeExpr-return: disjoint
// by opener — NoUnionTypeExpr never starts with `{`, GroupedTypeExpr
// always does. Order is mechanical.
export const FuncTypeArg = production("FuncTypeArg",
	and(optional(Qmark), or(NoUnionTypeExpr, GroupedTypeExpr))
);

// FuncTypeFinalArg := (Star (NoUnionTypeExpr | GroupedTypeExpr)) | FuncTypeArg;
export const FuncTypeFinalArg = production("FuncTypeFinalArg",
	or(and(Star, or(NoUnionTypeExpr, GroupedTypeExpr)), FuncTypeArg)
);

// <FuncTypeArgList> := (FuncTypeArg (_ Comma _ FuncTypeArg)* (_ Comma _ FuncTypeFinalArg)?)
//                    | FuncTypeFinalArg;
//
// PEG: same ordering rationale as DataStructTypeList.
var FuncTypeArgList = or(
	and(
		FuncTypeArg,
		any(and(delim(), Comma, delim(), FuncTypeArg)),
		optional(and(delim(), Comma, delim(), FuncTypeFinalArg))
	),
	FuncTypeFinalArg
);

// FuncTypeExpr := OpenParen _ FuncTypeArgList? _ (Comma _)? CloseParen _ Caret _ Qmark? _ (NoUnionTypeExpr | GroupedTypeExpr);
export const FuncTypeExpr = production("FuncTypeExpr",
	and(
		OpenParen, delim(),
		optional(FuncTypeArgList),
		delim(),
		optional(and(Comma, delim())),
		CloseParen, delim(),
		Caret, delim(),
		optional(Qmark), delim(),
		or(NoUnionTypeExpr, GroupedTypeExpr)
	)
);

// <TypeExpr> := FuncTypeExpr | NoFuncTypeExpr;
//
// PEG: FuncTypeExpr first — opens with `(` which could conflict with
// nothing in NoFuncTypeExpr (NoUnionTypeExpr doesn't include a paren
// form). Mechanical ordering.
var TypeExpr = or(FuncTypeExpr, NoFuncTypeExpr);

// DefTypeStmt := "deft" _ Identifier _ TypeExpr;
export const DefTypeStmt = production("DefTypeStmt",
	and(KwDeft, delim(), Identifier, delim(), TypeExpr)
);


// =============================================================
// PUBLIC API
//
// parseFoi(input,opts): async generator yielding shaped top-level
// statement AST nodes. The lex layer streams tokens into the syn
// parse; each top-level Program child is yielded as it commits.
// =============================================================

export async function *parseFoi(input,opts = {}) {
	var { shapers = defaultShapers, ...rest } = opts;
	var config = {
		preserveTerminals: true,
		preserveSoftDelims: false,
		memoize: true,
		...rest,
	};
	var handle = parse(Program, tokenize(input), config);
	var events = handle.subscribe(presets.parseCommitsAtDepth(1,{ includeDepths: true }));
	var runPromise = handle.run();
	for await (let ev of events) {
		var node = shapeNode(ev.node, shapers, config);
		if (node.type === "EmptyStmt" && !node.delims) continue;
		yield node;
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
