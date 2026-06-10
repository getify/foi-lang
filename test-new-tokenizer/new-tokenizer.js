// =============================================================
// tokenizer.js
//
// Foi tokenizer (lexical analyzer). Implements the Foi lexical
// grammar as productions over the streaming parser combinator
// library in parser-combinators.js. Exports a streaming tokenize()
// async generator yielding tokens with PascalCase type strings.
//
// The legacy hand-written tokenizer (orig-tokenizer.js) emits
// UPPERCASE_SNAKE type strings; the diff harness normalizes one
// side to compare token streams. Grammar productions are the
// authoritative source; see foi-lex-grammar.md for the EBNF
// specification and foi-lex-impl.md for the implementation notes.
// =============================================================

import {
	lazy, parse, production, terminal,
	and, or, optional, any, many,
	not, lookahead, eof, gate, dispatch,
	presets,
} from "./parser-combinators.js";


// =============================================================
// RESERVED WORD SETS
// =============================================================

export const NATIVES = [ "empty", "true", "false" ];

export const KEYWORDS = [
	"def", "defn", "deft", "import", "export",
	":as", ":over",
	"int", "integer", "float", "bool", "boolean", "string",
];

export const BUILTINS = [
	"Id", "None", "Maybe", "Left", "Right", "Either",
	"Promise", "PromiseSubject", "PushStream", "PushSubject",
	"PullStream", "PullSubject", "Channel", "Gen", "IO",
	"Value", "Number", "List",
];

export const COMPREHENSIONS = [
	"~each", "~map", "~filter", "~fold", "~foldR", "~cata",
	"~chain", "~bind", "~flatMap", "~ap", "~foldMap",
];

export const BOOLEAN_NAMED_OPERATORS = [
	"and", "or", "as", "in", "has", "empty",
];

export const WHITESPACE_CHARS = [
	"\u0009", "\u000a", "\u000b", "\u000c", "\u000d", "\u0020",
	"\u0085", "\u00a0", "\u1680", "\u180e", "\u2000", "\u2001",
	"\u2002", "\u2003", "\u2004", "\u2005", "\u2006", "\u2007",
	"\u2008", "\u2009", "\u200a", "\u200b", "\u200c", "\u200d",
	"\u200e", "\u200f", "\u2028", "\u2029", "\u202f", "\u205f",
	"\u3000", "\ufeff",
];


// =============================================================
// CHAR PREDICATES
// =============================================================

var isWS         = c => WHITESPACE_CHARS.includes(c);
var isDigit      = c => /[0-9]/.test(c);
var isHexDigit   = c => /[0-9a-fA-F]/.test(c);
var isOctDigit   = c => /[0-7]/.test(c);
var isBinDigit   = c => /[01]/.test(c);
var isIdentStart = c => /[a-zA-Z0-9_]/.test(c);
var isIdentCont  = c => /[a-zA-Z0-9_~]/.test(c);
var isAlpha      = c => /[a-zA-Z]/.test(c);


// =============================================================
// HELPERS
// =============================================================

var ch = (c, onMatch) => terminal(x => x === c, onMatch);


// =============================================================
// SINGLE-CHAR OPERATOR PRODUCTIONS
//
// Single source of truth for char values (C) and the
// corresponding productions (symb). Two exclusions:
//
//   STANDALONE_EXCLUDED_OPS: production exists but is NOT spread
//     into BaseTokenOr — a lone occurrence of the character should
//     fail to tokenize rather than emit a standalone token.
//
//   SYMB_NAMES_EXCLUDED_FROM_C: name is in C (for char lookup via
//     C.Escape etc.) but no symb.<Name> production is generated —
//     a different binding handles the production. Currently just
//     Escape, which is superseded by EscapePlain (one of the eight
//     Escape variants defined below; see foi-lex-grammar.md).
// =============================================================

var C = {
	Tilde:        "~",
	Exmark:       "!",
	Hash:         "#",
	Dollar:       "$",
	Percent:      "%",
	Caret:        "^",
	Ampersand:    "&",
	Star:         "*",
	Plus:         "+",
	Equal:        "=",
	At:           "@",
	Hyphen:       "-",
	OpenBracket:  "[",
	CloseBracket: "]",
	Pipe:         "|",
	Qmark:        "?",
	Semicolon:    ";",
	SingleQuote:  "'",
	OpenAngle:    "<",
	CloseAngle:   ">",
	Comma:        ",",
	Period:       ".",
	Colon:        ":",
	ForwardSlash: "/",
	Escape:       "\\",
	OpenParen:    "(",
	CloseParen:   ")",
	OpenBrace:    "{",
	CloseBrace:   "}",
	Backtick:     "`",
	DoubleQuote:  '"',
};

var STANDALONE_EXCLUDED_OPS    = new Set([ "DoubleQuote" ]);
var SYMB_NAMES_EXCLUDED_FROM_C = new Set([ "Escape" ]);

export const symb = {};
for (let [name, c] of Object.entries(C)) {
	if (!SYMB_NAMES_EXCLUDED_FROM_C.has(name)) {
		symb[name] = production(name, ch(c));
	}
}


// =============================================================
// ESCAPE VARIANTS
//
// Eight productions, all emitting Escape tokens with distinguishing
// values. EscapePlain is the only one spread standalone into
// BaseTokenOr (for a lone "\"); the others fire only from inside
// specific contexts (string-form openers, EscapedNumber dispatch).
//
// At the EBNF level these are named aliases (EscapeBacktick,
// EscapeHex, etc.); the impl emits all eight as Escape tokens
// (production name "Escape"), distinguished by value. See
// foi-lex-grammar.md preamble for the alias pattern.
// =============================================================

export const EscapeBacktick        = production("Escape", ch(C.Backtick));
export const EscapePlain           = production("Escape", ch(C.Escape));
export const EscapeSpacingBacktick = production("Escape", and(ch(C.Escape), ch(C.Backtick)));
export const EscapeHex             = production("Escape", and(ch(C.Escape), ch("h")));
export const EscapeUnicode         = production("Escape", and(ch(C.Escape), ch("u")));
export const EscapeOctal           = production("Escape", and(ch(C.Escape), ch("o")));
export const EscapeBinary          = production("Escape", and(ch(C.Escape), ch("b")));
export const EscapeMonadic         = production("Escape", and(ch(C.Escape), ch(C.At)));


// =============================================================
// MULTI-CHAR OPERATORS
// Must be tried before their single-char prefixes.
// =============================================================

export const TriplePeriod = production("TriplePeriod", and(ch(C.Period), ch(C.Period), ch(C.Period)));
export const DoublePeriod = production("DoublePeriod", and(ch(C.Period), ch(C.Period)));
export const DoubleColon  = production("DoubleColon",  and(ch(C.Colon), ch(C.Colon)));


// IdentBody: greedy identifier-chars with sawNonDigit gate, plus a
// tilde-leading variant (so `~foo` parses as one identifier the way
// the legacy tokenizer's TILDE+GENERAL merge does). The gate rejects
// pure-digit runs so they fall through to Number.
var IdentBody = and(
	or(
		terminal(isIdentStart, (c, f) => {
			if (!isDigit(c)) f.state.sawNonDigit = true;
		}),
		and(
			terminal(c => c === C.Tilde, (_, f) => { f.state.sawNonDigit = true; }),
			terminal(isAlpha, (_, f) => { f.state.sawNonDigit = true; })
		)
	),
	any(terminal(isIdentCont, (c, f) => {
		if (!isDigit(c)) f.state.sawNonDigit = true;
	})),
	gate(f => f.state.sawNonDigit === true)
);

// General: catch-all identifier (must run AFTER the typed forms).
export const General = production("General", IdentBody);



// =============================================================
// WHITESPACE & COMMENT
// =============================================================

export const Whitespace = production("Whitespace",
	many(terminal(isWS))
);

var BlockClose = and(
	ch(C.ForwardSlash),
	ch(C.ForwardSlash),
	ch(C.ForwardSlash)
);

export const Comment = production("Comment",
	and(
		ch(C.ForwardSlash),
		ch(
			C.ForwardSlash,
			(_, f) => { f.state.kind = "line"; }
		),
		optional(
			ch(
				C.ForwardSlash,
				(_, f) => { f.state.kind = "block"; }
			)
		),
		dispatch(f => f.state.kind, {
			line: any(terminal(c => c !== "\n")),
			block: and(
				any(and(not(lookahead(BlockClose)), terminal(_ => true))),
				or(BlockClose, eof())
			),
		})
	)
);


// =============================================================
// NUMBERS
// =============================================================

var NotIdentCont = not(lookahead(terminal(isIdentCont)));

// Char-level digit-body helpers (not productions — combinator
// bindings reused by the Number variants below).
var DigitsWithSep     = and(
	many(terminal(isDigit)),
	any(or(terminal(isDigit), ch("_")))
);
var BareNumBody       = and(
	optional(ch(C.Hyphen)),
	DigitsWithSep,
	optional(and(ch(C.Period), DigitsWithSep))
);

var HexDigits         = many(terminal(isHexDigit));
var HexDigitsWithSep  = and(
	HexDigits,
	any(or(terminal(isHexDigit), ch("_")))
);
var MonadNumBody      = and(
	optional(ch(C.Hyphen)),
	HexDigitsWithSep,
	optional(and(ch(C.Period), HexDigitsWithSep))
);


// Number variants — six productions emitting Number tokens with
// content shapes matching the Escape opener's digit class. All
// emit as Number type (alias pattern). See foi-lex-grammar.md.
export const HexNumber     = production("Number", and(optional(ch(C.Hyphen)), HexDigits, NotIdentCont));
export const UnicodeNumber = production("Number", and(HexDigits, NotIdentCont));
export const OctalNumber   = production("Number", and(optional(ch(C.Hyphen)), many(terminal(isOctDigit)), NotIdentCont));
export const BinaryNumber  = production("Number", and(optional(ch(C.Hyphen)), many(terminal(isBinDigit)), NotIdentCont));
export const MonadNumber = production("Number",
	or(
		and(optional(ch(C.Hyphen)), HexDigitsWithSep, ch(C.Period), HexDigitsWithSep),
		and(optional(ch(C.Hyphen)), HexDigitsWithSep, NotIdentCont)
	)
);
export const BareNumber = production("Number",
	or(
		// Decimal: commits.
		and(
			optional(ch(C.Hyphen)),
			DigitsWithSep,
			ch(C.Period),
			DigitsWithSep
		),
		// Integer-only: backs off on IdentCont continuation.
		and(
			optional(ch(C.Hyphen)),
			DigitsWithSep,
			NotIdentCont
		)
	)
);

// PositiveIntegerLit variants — bare top-level (no separators) and
// escaped form (separators allowed). Both emit as PositiveIntegerLit
// token type (alias pattern). The !("." Digit) lookahead avoids
// swallowing the integer part of decimals while letting through "."
// followed by non-digits (range op, property access, spread).
var NotDotDigit = not(lookahead(and(ch(C.Period), terminal(isDigit))));

export const PositiveIntegerLit = production("PositiveIntegerLit",
	and(many(terminal(isDigit)), NotDotDigit, NotIdentCont)
);

// NegativeIntegerLit — bare negative integer (required leading "-",
// no separators, no fractional part). Same NotDotDigit / NotIdentCont
// guards as PositiveIntegerLit. Emits NegativeIntegerLit token type.
export const NegativeIntegerLit = production("NegativeIntegerLit",
	and(ch(C.Hyphen), many(terminal(isDigit)), NotDotDigit, NotIdentCont)
);

// IntegerLit — hidden union covering both signs. Used in <Token> via
// expressionEnding(numberEnding(IntegerLit)). First-char disjoint
// between arms, so order is mechanical.
var IntegerLit = or(NegativeIntegerLit, PositiveIntegerLit);

export const PositiveIntegerLitWithSep = production("PositiveIntegerLit",
	and(DigitsWithSep, NotDotDigit, NotIdentCont)
);

// EscapedNumber: dispatch over the six (Escape variant, Number
// variant) pairs. Hidden — emits the Escape and Number tokens as
// direct children of the parent frame, not under an own node.
export const EscapedNumber = or(
	and(EscapeHex,     or(HexNumber,     General)),
	and(EscapeUnicode, or(UnicodeNumber, General)),
	and(EscapeOctal,   or(OctalNumber,   General)),
	and(EscapeBinary,  or(BinaryNumber,  General)),
	and(EscapeMonadic, or(MonadNumber,   General)),
	and(EscapePlain,   or(PositiveIntegerLitWithSep, BareNumber, General))
);
// =============================================================
// TYPED IDENTIFIERS
// Each gates membership in its reserved set; bare IdentBody fall-
// through goes to General.
// =============================================================

// Keyword: bare form (def, defn, deft, int, ...) or extension form
// (:as, :over). The gate validates membership in the KEYWORDS list.
export const Keyword = production("Keyword",
	or(
		and(
			ch(C.Colon),
			IdentBody,
			gate(f => KEYWORDS.includes(C.Colon + f.matched.slice(1).join("")))
		),
		and(
			IdentBody,
			gate(f => KEYWORDS.includes(f.matched.join("")))
		)
	)
);

export const Native = production("Native",
	and(IdentBody, gate(f => NATIVES.includes(f.matched.join(""))))
);

export const Builtin = production("Builtin",
	and(IdentBody, gate(f => BUILTINS.includes(f.matched.join(""))))
);

// Comprehension: ~name where name is one of the reserved comprehensions.
export const Comprehension = production("Comprehension",
	and(
		ch(C.Tilde),
		terminal(isAlpha),
		any(terminal(isIdentCont)),
		gate(f => COMPREHENSIONS.includes(f.matched.join("")))
	)
);

// BooleanOper: ?word or !word where word is one of the named operators.
export const BooleanOper = production("BooleanOper",
	and(
		or(ch(C.Qmark), ch(C.Exmark)),
		terminal(isAlpha),
		any(terminal(isIdentCont)),
		gate(f => BOOLEAN_NAMED_OPERATORS.includes(f.matched.slice(1).join("")))
	)
);

// NumberLit: bare decimal number literal (no underscore separators,
// no escape opener). Leading sign handled jointly here (accept "-"
// if followed by digit) and in the expressionEnding wrapper (which
// eats a trailing binary "-"). Emits Number token.
export const NumberLit = production("Number",
	and(
		optional(and(ch(C.Hyphen), lookahead(terminal(isDigit)))),
		or(
			and(many(terminal(isDigit)), ch(C.Period), many(terminal(isDigit))),
			and(many(terminal(isDigit)), NotIdentCont)
		)
	)
);


// =============================================================
// STRING_ESCAPED_CHAR  (used by all four string forms)
//
// Inside any string form, " is escaped by doubling: "". Inside the
// two interp forms (where ` opens an embedded expression), ` is
// also escaped by doubling: ``. The doubled pair comes out as a
// single StringEscapedChar token.
//
// Two combinator bindings, both emitting the same StringEscapedChar
// token type; they differ only in which escapes are reachable:
//
//   StringEscapedCharDQ — "" only        (used by StringLit, SpacingEscapedStr)
//   StringEscapedChar   — "" or ``       (used by InterpStr, SpacingInterpStr)
// =============================================================

var StringEscapedCharDQ = production("StringEscapedChar",
	and(ch(C.DoubleQuote), ch(C.DoubleQuote))
);

export const StringEscapedChar = production("StringEscapedChar",
	or(
		and(ch(C.DoubleQuote), ch(C.DoubleQuote)),
		and(ch(C.Backtick), ch(C.Backtick))
	)
);


// =============================================================
// BASIC STRING:  "..."   (opens ", closes ")
//
// No embedded expressions, no whitespace collapse. ` has no
// syntactic significance here — it's literal String content.
//
// PlainStrChars is the basic-string char-emitter, completing the
// four-emitter family with InterpStrChars, SpacingInterpStrChars,
// and SpacingEscapedStrChars. All four emit String tokens with
// context-specific char predicates.
// =============================================================

var PlainStrChars = production("String",
	many(terminal(c => c !== C.DoubleQuote))
);

export const StringLit = and(
	symb.DoubleQuote,
	any(or(StringEscapedCharDQ, PlainStrChars)),
	symb.DoubleQuote
);


// =============================================================
// INTERPOLATED STRING:  `"..."   (opens `", closes ")
// =============================================================

// "Lone backtick": a ` that closes an interp expression rather than
// opening a nested interp string. (Nested interp strings start with
// `", so we keep going past those.)
var InterpExprStop = lookahead(ch(C.Backtick));

// `expr`: Backtick, any base-mode tokens until a lone closing
// backtick, Backtick.
var InterpExpr = and(
	symb.Backtick,
	any(and(not(InterpExprStop), lazy(() => BaseTokenOr))),
	symb.Backtick
);

// Run of literal string content inside an interp string. Stops at
// ` (potential expression opener or escape) and at " (string close).
var InterpStrChars = production("String",
	many(terminal(c => (
		c !== C.Backtick &&
		c !== C.DoubleQuote
	)))
);

export const InterpStr = and(
	EscapeBacktick,
	symb.DoubleQuote,
	any(or(StringEscapedChar, InterpExpr, InterpStrChars)),
	symb.DoubleQuote
);


// =============================================================
// SPACING-FORM INTERPOLATED STRING:  \`"..."
//
// Embedded expressions like InterpStr, plus whitespace-collapse:
// Whitespace inside the content is emitted as its own token rather
// than as part of String content.
// =============================================================

var SpacingInterpStrChars = production("String",
	many(terminal(c => (
		c !== C.Backtick &&
		c !== C.DoubleQuote &&
		!isWS(c)
	)))
);

export const SpacingInterpStr = and(
	EscapeSpacingBacktick,
	symb.DoubleQuote,
	any(or(StringEscapedChar, InterpExpr, Whitespace, SpacingInterpStrChars)),
	symb.DoubleQuote
);


// =============================================================
// SPACING ESCAPED STRING:  \"..."
//
// No embedded expressions. Whitespace-collapse like SpacingInterpStr.
// ` has no syntactic significance here — it's literal String content.
// =============================================================

var SpacingEscapedStrChars = production("String",
	many(terminal(c => c !== C.DoubleQuote && !isWS(c)))
);

export const SpacingEscapedStr = and(
	EscapePlain,
	symb.DoubleQuote,
	any(or(StringEscapedCharDQ, Whitespace, SpacingEscapedStrChars)),
	symb.DoubleQuote
);


// =============================================================
// HYPHEN-AS-SIGN DISAMBIGUATION
// =============================================================

// Tokens whose legacy-tokenizer counterparts set minusOpAllowed = true.
// Single-char symbols in this set are wrapped with expressionEnding;
// the rest stay unwrapped.
var EXPRESSION_ENDING_OP_NAMES = new Set([
	"CloseParen", "CloseBrace", "Hash", "Pipe",
]);

// Wrap a production whose tokens semantically end an expression.
// After p matches, optionally consume trivia (Whitespace / Comment
// tokens, emitted as their own depth-1 nodes), then peek for a
// binary Hyphen preceding a digit; if present, consume the Hyphen
// too. If the tail check fails, the whole optional rolls back and
// the trivia/Hyphen are picked up by the next outer iteration.
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

// Wrap a number production. After p matches, optionally consume an
// immediate ".." (no trivia) as DoublePeriod, so a third "." in
// "5..." surfaces as a separate Period rather than getting swallowed
// into a TriplePeriod. Better error granularity on range typos —
// the only multi-dot form valid after a number is "..".
function numberEnding(p) {
	return and(p, optional(DoublePeriod));
}


// =============================================================
// TOP-LEVEL: Tokens
// Order is important. Try longer/more-specific lexemes before
// their prefixes; try typed identifiers before the General
// catch-all. See foi-lex-impl.md §13 for the full ordering
// rationale.
//
// EscapePlain appears explicitly (between DoubleColon and the
// symb spread) to provide the standalone-"\" emission slot —
// after every form that could consume "\" as a longer match
// (SpacingInterpStr, SpacingEscapedStr, EscapedNumber).
// =============================================================

var BaseTokenOr = or(
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
	numberEnding(expressionEnding(IntegerLit)),
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

export const Tokens = production("Tokens", any(BaseTokenOr));


// =============================================================
// PUBLIC API
//
// tokenize(input): async generator yielding lexer tokens as they
// are recognized. Each token: { type, value, start, end }.
//
// Token type strings are PascalCase. The legacy tokenizer
// (orig-tokenizer.js) emits UPPERCASE_SNAKE; the diff harness
// normalizes one side before lockstep comparison.
// =============================================================

export async function *tokenize(input) {
	var handle = parse(Tokens, input, { preserveTerminals: true });
	var events = handle.subscribe(presets.parseTokens);
	// Start the parse running concurrently; we consume its events
	// as they arrive. The subscription queues events if we lag.
	var runPromise = handle.run();
	for await (let ev of events) {
		if (ev.kind === "commit") {
			yield {
				type:  ev.node.production,
				value: ev.node.matched.join(""),
				start: ev.node.startPos,
				end:   ev.node.endPos - 1,
			};
		}
	}
	// Surface any parse-level error after subscription drains.
	await runPromise;
}
