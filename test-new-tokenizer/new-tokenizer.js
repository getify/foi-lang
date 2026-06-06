// =============================================================
// tokenizer.js
//
// Foi tokenizer (lexical analyzer). Implements the Foi lexical
// grammar as productions over the streaming parser combinator
// library in parser-combinators.js. Exports a streaming tokenize()
// async generator with the same shape as the legacy hand-written
// tokenizer in orig-tokenizer.js, so callers can swap one for the
// other.
//
// Grammar productions are the authoritative source; see
// foi-lex-grammar.md for the EBNF specification and
// foi-lex-impl.md for the implementation notes.
// =============================================================

import {
	parse,
	production, terminal,
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

// IdentBody: greedy identifier-chars with sawNonDigit gate, plus a
// tilde-leading variant (so `~foo` parses as one identifier the way
// the legacy tokenizer's TILDE+GENERAL merge does). The gate rejects
// pure-digit runs so they fall through to NUMBER.
var IdentBody = and(
	or(
		terminal(isIdentStart, (c, f) => {
			if (!isDigit(c)) f.state.sawNonDigit = true;
		}),
		and(
			terminal(c => c === "~", (_, f) => { f.state.sawNonDigit = true; }),
			terminal(isAlpha,        (_, f) => { f.state.sawNonDigit = true; })
		)
	),
	any(terminal(isIdentCont, (c, f) => {
		if (!isDigit(c)) f.state.sawNonDigit = true;
	})),
	gate(f => f.state.sawNonDigit === true)
);


// =============================================================
// PRODUCTIONS
// Production names match the legacy tokenizer's type strings
// exactly so callers can substitute one for the other.
// =============================================================

export const WHITESPACE = production("WHITESPACE",
	many(terminal(isWS))
);

var BlockClose = and(ch("/"), ch("/"), ch("/"));

export const COMMENT = production("COMMENT",
	and(
		ch("/"),
		ch("/", (_, f) => { f.state.kind = "line"; }),
		optional(ch("/", (_, f) => { f.state.kind = "block"; })),
		dispatch(f => f.state.kind, {
			line: any(terminal(c => c !== "\n")),
			block: and(
				any(and(not(lookahead(BlockClose)), terminal(_ => true))),
				or(BlockClose, eof())
			),
		})
	)
);

// Escaped numbers: \h<hex>, \o<oct>, \b<bin>, \u<hex>, \@<num>, \<num>.
//   - \h, \o, \b accept optional leading - before digit run.
//   - \u accepts hex digits only (produces a unicode char/string),
//     with NO leading sign.
//   - \@ accepts a "monadic number" — hex digits with optional
//     _ separators and decimal point, optional leading -.
//   - Bare \ accepts a base-10 number with optional leading -,
//     _ separators (including trailing), and decimal point.
var BareDigits        = many(terminal(isDigit));
var DigitsWithSep     = and(BareDigits, any(or(terminal(isDigit), ch("_"))));
var BareNumBody       = and(
	optional(ch("-")),
	DigitsWithSep,
	optional(and(ch("."), DigitsWithSep))
);

var HexDigits         = many(terminal(isHexDigit));
var HexDigitsWithSep  = and(HexDigits, any(or(terminal(isHexDigit), ch("_"))));
var MonadNumBody      = and(
	optional(ch("-")),
	HexDigitsWithSep,
	optional(and(ch("."), HexDigitsWithSep))
);

export const EscapedNumber = or(
	and(
		production("ESCAPE", and(ch("\\"), ch("h"))),
		production("NUMBER", and(optional(ch("-")), HexDigits))
	),
	and(
		production("ESCAPE", and(ch("\\"), ch("u"))),
		production("NUMBER", HexDigits)
	),
	and(
		production("ESCAPE", and(ch("\\"), ch("o"))),
		production("NUMBER", and(optional(ch("-")), many(terminal(isOctDigit))))
	),
	and(
		production("ESCAPE", and(ch("\\"), ch("b"))),
		production("NUMBER", and(optional(ch("-")), many(terminal(isBinDigit))))
	),
	and(
		production("ESCAPE", and(ch("\\"), ch("@"))),
		production("NUMBER", MonadNumBody)
	),
	and(
		production("ESCAPE", ch("\\")),
		production("NUMBER", BareNumBody)
	)
);

// KEYWORD: bare form (def, defn, deft, int, ...) or extension form
// (:as, :over). The gate validates membership in the KEYWORDS list.
export const KEYWORD = production("KEYWORD",
	or(
		and(
			ch(":"),
			IdentBody,
			gate(f => KEYWORDS.includes(":" + f.matched.slice(1).join("")))
		),
		and(
			IdentBody,
			gate(f => KEYWORDS.includes(f.matched.join("")))
		)
	)
);

export const NATIVE = production("NATIVE",
	and(IdentBody, gate(f => NATIVES.includes(f.matched.join(""))))
);

export const BUILTIN = production("BUILTIN",
	and(IdentBody, gate(f => BUILTINS.includes(f.matched.join(""))))
);

// COMPREHENSION: ~name where name is one of the reserved comprehensions.
export const COMPREHENSION = production("COMPREHENSION",
	and(
		ch("~"),
		terminal(isAlpha),
		any(terminal(isIdentCont)),
		gate(f => COMPREHENSIONS.includes(f.matched.join("")))
	)
);

// BOOLEAN_OPER: ?word or !word where word is one of the named ops.
export const BOOLEAN_OPER = production("BOOLEAN_OPER",
	and(
		or(ch("?"), ch("!")),
		terminal(isAlpha),
		any(terminal(isIdentCont)),
		gate(f => BOOLEAN_NAMED_OPERATORS.includes(f.matched.slice(1).join("")))
	)
);

// NUMBER: bare digits, optionally with decimal point. Leading sign
// is handled jointly here (accept `-` if followed by digit) and in
// the expressionEnding wrapper (which eats a trailing binary `-`).
export const NUMBER = production("NUMBER",
	and(
		optional(and(ch("-"), lookahead(terminal(isDigit)))),
		or(
			and(many(terminal(isDigit)), ch("."), many(terminal(isDigit))),
			many(terminal(isDigit))
		)
	)
);

// GENERAL: catch-all identifier (must run AFTER the typed forms).
export const GENERAL = production("GENERAL", IdentBody);

// Multi-char operators (must be tried before their single-char prefixes).
export const TRIPLE_PERIOD = production("TRIPLE_PERIOD", and(ch("."), ch("."), ch(".")));
export const DOUBLE_PERIOD = production("DOUBLE_PERIOD", and(ch("."), ch(".")));
export const DOUBLE_COLON  = production("DOUBLE_COLON",  and(ch(":"), ch(":")));


// =============================================================
// SINGLE-CHAR OPERATOR PRODUCTIONS
// =============================================================

var SINGLE_CHAR_OPS_DEF = {
	TILDE:         "~",
	EXMARK:        "!",
	HASH:          "#",
	DOLLAR:        "$",
	PERCENT:       "%",
	CARET:         "^",
	AMPERSAND:     "&",
	STAR:          "*",
	PLUS:          "+",
	EQUAL:         "=",
	AT:            "@",
	HYPHEN:        "-",
	OPEN_BRACKET:  "[",
	CLOSE_BRACKET: "]",
	PIPE:          "|",
	QMARK:         "?",
	SEMICOLON:     ";",
	SINGLE_QUOTE:  "'",
	OPEN_ANGLE:    "<",
	CLOSE_ANGLE:   ">",
	COMMA:         ",",
	PERIOD:        ".",
	COLON:         ":",
	FORWARD_SLASH: "/",
	ESCAPE:        "\\",
	OPEN_PAREN:    "(",
	CLOSE_PAREN:   ")",
	OPEN_BRACE:    "{",
	CLOSE_BRACE:   "}",
	BACKTICK:      "`",
};

export const ops = {};
for (let [name, c] of Object.entries(SINGLE_CHAR_OPS_DEF)) {
	ops[name] = production(name, ch(c));
}


// =============================================================
// STRING_ESCAPED_CHAR  (used by all four string forms)
//
// Inside any string form, " is escaped by doubling: "". Inside the
// two interp forms (where ` opens an embedded expression), ` is
// also escaped by doubling: ``. The doubled pair comes out as a
// single STRING_ESCAPED_CHAR token.
//
// Two combinator bindings, both emitting the same STRING_ESCAPED_CHAR
// token type; they differ only in which escapes are reachable:
//
//   StringEscapedCharDQ  — "" only        (used by StringLit, SpacingEscapedStr)
//   StringEscapedChar    — "" or ``       (used by InterpStr, SpacingInterpStr)
// =============================================================

var StringEscapedCharDQ = production("STRING_ESCAPED_CHAR",
	and(ch('"'), ch('"'))
);

export const STRING_ESCAPED_CHAR = production("STRING_ESCAPED_CHAR",
	or(
		and(ch('"'), ch('"')),
		and(ch("`"), ch("`"))
	)
);


// =============================================================
// BASIC STRING:  "..."   (opens ", closes ")
//
// No embedded expressions, no whitespace collapse. ` has no
// syntactic significance here — it's literal STRING content.
// =============================================================

export const StringLit = and(
	production("DOUBLE_QUOTE", ch('"')),
	any(or(
		StringEscapedCharDQ,
		production("STRING",
			many(terminal(c => c !== '"'))
		)
	)),
	production("DOUBLE_QUOTE", ch('"'))
);


// =============================================================
// INTERPOLATED STRING:  `"..."   (opens `", closes ")
// =============================================================

// Forward decl — assigned just before Tokens is defined below.
var BaseTokenOr;

// Lazy bridge so InterpExpr can reach BaseTokenOr before it's built;
// resolved at parse time, by which point it exists.
var BaseTokenLazy = async function baseTokenLazy(pctx) {
	return BaseTokenOr(pctx);
};

// "Lone backtick": a ` that closes an interp expression rather than
// opening a nested interp string. (Nested interp strings start with
// `", so we keep going past those.)
var InterpExprStop = and(ch("`"), or(eof(), not(ch('"'))));

// `expr`: BACKTICK, any base-mode tokens until a lone closing
// backtick, BACKTICK.
var InterpExpr = and(
	production("BACKTICK", ch("`")),
	any(and(not(InterpExprStop), BaseTokenLazy)),
	production("BACKTICK", ch("`"))
);

// Run of literal string content inside an interp string. Stops at
// ` (potential expression opener or escape) and at " (string close).
var InterpStrChars = production("STRING",
	many(terminal(c => c !== "`" && c !== '"'))
);

export const InterpStr = and(
	production("ESCAPE",       ch("`")),
	production("DOUBLE_QUOTE", ch('"')),
	any(or(STRING_ESCAPED_CHAR, InterpExpr, InterpStrChars)),
	production("DOUBLE_QUOTE", ch('"'))
);


// =============================================================
// SPACING-FORM INTERPOLATED STRING:  \`"..."
//
// Embedded expressions like InterpStr, plus whitespace-collapse:
// WHITESPACE inside the content is emitted as its own token rather
// than as part of STRING content.
// =============================================================

var SpacingInterpStrChars = production("STRING",
	many(terminal(c => c !== "`" && c !== '"' && !isWS(c)))
);

export const SpacingInterpStr = and(
	production("ESCAPE",       and(ch("\\"), ch("`"))),
	production("DOUBLE_QUOTE", ch('"')),
	any(or(STRING_ESCAPED_CHAR, InterpExpr, WHITESPACE, SpacingInterpStrChars)),
	production("DOUBLE_QUOTE", ch('"'))
);


// =============================================================
// SPACING ESCAPED STRING:  \"..."
//
// No embedded expressions. Whitespace-collapse like SpacingInterpStr.
// ` has no syntactic significance here — it's literal STRING content.
// =============================================================

var SpacingEscapedStrChars = production("STRING",
	many(terminal(c => c !== '"' && !isWS(c)))
);

export const SpacingEscapedStr = and(
	production("ESCAPE",       ch("\\")),
	production("DOUBLE_QUOTE", ch('"')),
	any(or(StringEscapedCharDQ, WHITESPACE, SpacingEscapedStrChars)),
	production("DOUBLE_QUOTE", ch('"'))
);


// =============================================================
// HYPHEN-AS-SIGN DISAMBIGUATION
// =============================================================

// Tokens whose legacy-tokenizer counterparts set minusOpAllowed = true.
// Single-char ops in this set are wrapped with expressionEnding;
// the rest stay unwrapped.
var EXPRESSION_ENDING_OP_NAMES = new Set([
	"CLOSE_PAREN", "CLOSE_BRACE", "HASH", "PIPE",
]);

// Wrap a production whose tokens semantically end an expression.
// After p matches, optionally consume trivia (WHITESPACE / COMMENT
// tokens, emitted as their own depth-1 nodes), then peek for a
// binary HYPHEN preceding a digit; if present, consume the HYPHEN
// too. If the tail check fails, the whole optional rolls back and
// the trivia/HYPHEN are picked up by the next outer iteration.
function expressionEnding(p) {
	return and(
		p,
		optional(and(
			any(or(WHITESPACE, COMMENT)),
			lookahead(and(ch("-"), terminal(isDigit))),
			production("HYPHEN", ch("-"))
		))
	);
}


// =============================================================
// TOP-LEVEL: Tokens
// Order is important. Try longer/more-specific lexemes before
// their prefixes; try typed identifiers before the GENERAL
// catch-all. See foi-lex-impl.md §13 for the full ordering
// rationale.
// =============================================================

BaseTokenOr = or(
	WHITESPACE,
	COMMENT,
	InterpStr,
	SpacingInterpStr,
	SpacingEscapedStr,
	StringLit,
	EscapedNumber,
	expressionEnding(KEYWORD),
	expressionEnding(NATIVE),
	expressionEnding(BUILTIN),
	expressionEnding(COMPREHENSION),
	expressionEnding(BOOLEAN_OPER),
	expressionEnding(NUMBER),
	expressionEnding(GENERAL),
	TRIPLE_PERIOD,
	DOUBLE_PERIOD,
	DOUBLE_COLON,
	...Object.entries(ops).map(([name, prod]) =>
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
// Shape matches the legacy tokenizer's tokenize() so callers can
// substitute one for the other.
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
