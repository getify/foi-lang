// parser.js — Foi syntactic parser. Operates over tokens from new-tokenizer.js.

import util from "node:util";
import {
	parse,
	production, terminal,
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
// FORWARD-REF SCAFFOLDING
//
// Productions defined in later sections are forward-declared
// as `var` and bound to FAIL initially. Reassigned to real
// productions in §3, §4, §11, §18, etc. References use lazy()
// so the binding is resolved at parse time, not eval time.
// =============================================================

var DefBlockStmt;
var DefVarStmt;
var DefTypeStmt;
var Expr;
var ExportExpr;

var FAIL = async function failFn(_pctx) { return false; };

var lazy = getRef => async function lazyFn(pctx) {
	return await getRef()(pctx);
};

DefBlockStmt = FAIL;
DefVarStmt   = FAIL;
DefTypeStmt  = FAIL;
Expr         = FAIL;
ExportExpr   = FAIL;


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
		optional(and(or(StmtSemiOpt, ExportStmtSemiOpt), delim()))
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

// Forward ref — InterpExpr embeds a full Expr, reassigned below
// once string forms are defined. The :as forward-ref pattern same
// as §1: AsAnnotationExpr is defined in §5 (paren-grouping section).
var InterpExpr;
var AsAnnotationExpr;

InterpExpr       = FAIL;
AsAnnotationExpr = FAIL;

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
// (Defined here, not earlier — needs the Expr forward ref. Replaces FAIL
// stub bound above.)
InterpExpr = production("InterpExpr",
	and(Backtick, delim(), lazy(() => Expr), delim(), Backtick)
);


// =============================================================
// PUBLIC API
//
// parseFoi(input): async generator yielding shaped top-level
// statement AST nodes. The lex layer streams tokens into the syn
// parse; each top-level Program child is yielded as it commits.
// =============================================================

// TEMP — replaced by §5's real Expr dispatcher.
Expr = or(NumberLit, BooleanLit, EmptyLit, PlainStr, SpacingEscapedStr, InterpStr, SpacingInterpStr);


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
		throw new Error(`parse failed at token ${result.pos}`);
	}
}

for await (let node of parseFoi('`"hi `42`!";')) {
	console.log(util.inspect(node,{depth:10}));
}
