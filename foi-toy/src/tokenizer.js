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
// authoritative source; see Lexical-Grammar.md for the EBNF
// specification and Lexical-Grammar-Combinator-Implementation.md
// for the implementation notes.
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
	":as", ":over", ":Effects",
	"int", "float", "bool", "string", "Any"
];

export const BUILTINS = [
	"Id", "None", "Maybe", "Left", "Right", "Either", "Done",
	"Promise", "PushStream", "PullStream", "Channel",
	"Iter", "Gen", "Effect", "IO", "Value", "Function",
	"Number", "List",
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
var isIdentCont  = c => /[a-zA-Z0-9_]/.test(c);
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
//     Escape, which is superseded by EscapePlain (one of the seven
//     Escape variants defined below; see Lexical-Grammar.md).
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
// Seven productions, all emitting Escape tokens with distinguishing
// values. EscapePlain is the only one spread standalone into
// BaseTokenOr (for a lone "\"); the others fire only from inside
// specific contexts (string-form openers, EscapedNumber dispatch).
//
// At the EBNF level these are named aliases (EscapeBacktick,
// EscapeHex, etc.); the impl emits all seven as Escape tokens
// (production name "Escape"), distinguished by value. See
// Lexical-Grammar.md preamble for the alias pattern.
// =============================================================

export const EscapeBacktick        = production("Escape", ch(C.Backtick));
export const EscapePlain           = production("Escape", ch(C.Escape));
export const EscapeSpacingBacktick = production("Escape", and(ch(C.Escape), ch(C.Backtick)));
export const EscapeHex             = production("Escape", and(ch(C.Escape), ch("h")));
export const EscapeUnicode         = production("Escape", and(ch(C.Escape), ch("u")));
export const EscapeOctal           = production("Escape", and(ch(C.Escape), ch("o")));
export const EscapeBinary          = production("Escape", and(ch(C.Escape), ch("b")));


// =============================================================
// MULTI-CHAR OPERATORS
// Must be tried before their single-char prefixes.
// =============================================================

export const TriplePeriod = production("TriplePeriod", and(ch(C.Period), ch(C.Period), ch(C.Period)));
export const DoublePeriod = production("DoublePeriod", and(ch(C.Period), ch(C.Period)));
export const DoubleColon  = production("DoubleColon",  and(ch(C.Colon), ch(C.Colon)));

// DoubleAt (`@@`) — thunk construct opener. Two-char token via
// maximal-munch.
//
// Placed BEFORE the symb spread in BaseTokenOr (where the bare
// `At` lives) so `@@` lexes atomically rather than as two `At`
// tokens. Without it, `@@x` reaches AtCallExpr's IdentityFunc
// arm twice — `@(@x)`, nested identity — a legal parse today
// that would compete with the thunk reading.
//
// This claims the cuddled `Foo@@x` spelling, which previously
// reached AtCallExpr arm 1 as `Foo@` applied to `@x`. Write
// `Foo@ @x` or `Foo@(@x)` for that form.
//
// Adjacency is strict: `@ @` stays two `At` tokens.
//
// See §7 ThunkExpr (parser.js) for the syntactic form.
export const DoubleAt = production("DoubleAt", and(ch(C.At), ch(C.At)));

// Mountain (`/\`) and Valley (`\/`) — postfix curry / uncurry
// operators. Two-char tokens via maximal-munch.
//
// Mountain placed BEFORE the symb spread in BaseTokenOr so `/\`
// lexes atomically rather than as `ForwardSlash` + standalone
// `EscapePlain`. The earlier `Comment` arm in BaseTokenOr still
// wins for `//` (its lookahead picks the second `/`); `/X` for
// any other X falls through past Comment and past Mountain to
// the symb spread's bare `ForwardSlash`.
//
// Valley placed BEFORE `EscapePlain` so `\/` lexes atomically
// rather than as standalone `EscapePlain` + `ForwardSlash`. The
// earlier `EscapedNumber` dispatch fails cleanly on `\/`: its
// EscapePlain arm commits the `\`, then or(PositiveIntegerLit-
// WithSep, BareNumber, General) all fail on `/`, rolling the
// whole arm back. Other Escape arms (`\h`, `\u`, `\o`, `\b`)
// require a different second char, so they pass through
// without consuming. Same for SpacingInterpStr (`\` + backtick)
// and SpacingEscapedStr (`\` + `"`) — second-char-disjoint from
// Valley.
//
// See §7 ChainExpr (parser.js) for postfix attachment, §10
// UnaryOpSym for OpFuncExpr admission + universal-prime.
export const Mountain = production("Mountain", and(ch(C.ForwardSlash), ch(C.Escape)));
export const Valley   = production("Valley",   and(ch(C.Escape), ch(C.ForwardSlash)));

// IdentBody: greedy identifier-chars with sawNonDigit gate. The
// gate rejects pure-digit runs so they fall through to Number.
// Tilde is NOT in the identifier alphabet (see Lexical-Grammar.md
// Identifiers section), so `~foo` lexes as Tilde + General("foo")
// rather than a single identifier — a `~`-prefixed name reaches
// the Comprehension production first (via the reserved-set gate),
// or splits to Tilde + <ident> otherwise.
var IdentBody = and(
	terminal(isIdentStart, (c, f) => {
		if (!isDigit(c)) f.state.sawNonDigit = true;
	}),
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


// Number variants — six productions emitting Number tokens with
// content shapes matching the Escape opener's digit class. All
// emit as Number type (alias pattern). See Lexical-Grammar.md.
export const HexNumber     = production("Number", and(optional(ch(C.Hyphen)), HexDigits, NotIdentCont));
export const UnicodeNumber = production("Number", and(HexDigits, NotIdentCont));
export const OctalNumber   = production("Number", and(optional(ch(C.Hyphen)), many(terminal(isOctDigit)), NotIdentCont));
export const BinaryNumber  = production("Number", and(optional(ch(C.Hyphen)), many(terminal(isBinDigit)), NotIdentCont));
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

// Single-char ops whose token ends an expression, after which a
// `-Digit` reads as binary subtraction. Members are wrapped with
// expressionEnding in BaseTokenOr; the rest stay unwrapped.
//
// CloseAngle is a member, but only in its structure-close role.
// `>` is also the final glyph of `?>` / `!>` / `?<>` / `!<>` /
// `?<=>` / `!<=>` / `#>` / `+>`, and wrapping it there would eat
// the sign in `x ?> -3`, which §8 leaves unparseable (no prefix
// unary minus). GtTerminalOp below matches those sequences whole,
// ahead of the spread, so a `>` reaching this set is necessarily
// closing a structure. `?>=` and `?<=` need no arm — they end in
// Equal, which is unwrapped.
//
// At and Percent are excluded for a different reason: both take
// an operand, so the `-3` in `Maybe@-3` and `task%-3` is a sign.
var EXPRESSION_ENDING_OP_NAMES = new Set([
	"CloseParen", "CloseBrace", "CloseBracket", "CloseAngle",
	"Hash", "Pipe", "SingleQuote",
]);

// <GtTerminalOp> — multi-token operator sequences ending in `>`.
// Emits constituent single-char tokens (each symb entry is its
// own production); the enclosing and/or are anonymous and commit
// nothing, same shape as expressionEnding's own wrapper. Output
// is byte-identical to what the spread would emit; the arms exist
// solely to route the CloseAngle away from the wrapped arm.
//
// Longest first per Note 2. The `<=>`/`<>` pairs are disjoint at
// their third glyph, so that ordering is presentational.
var GtTerminalOp = or(
	and(symb.Qmark,  symb.OpenAngle, symb.Equal, symb.CloseAngle),
	and(symb.Exmark, symb.OpenAngle, symb.Equal, symb.CloseAngle),
	and(symb.Qmark,  symb.OpenAngle, symb.CloseAngle),
	and(symb.Exmark, symb.OpenAngle, symb.CloseAngle),
	and(symb.Qmark,  symb.CloseAngle),
	and(symb.Exmark, symb.CloseAngle),
	and(symb.Hash,   symb.CloseAngle),
	and(symb.Plus,   symb.CloseAngle)
);

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
// catch-all. See Lexical-Grammar-Combinator-Implementation.md
// §14 for the full ordering rationale.
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
	expressionEnding(EscapedNumber),
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
	DoubleAt,
	expressionEnding(Mountain),
	expressionEnding(Valley),
	EscapePlain,
	GtTerminalOp,
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
	var result = await runPromise;

	// `Tokens` is `Token*` with an EOF requirement the combinator
	// form can't express as `eof()`: failing the production would
	// suppress cascadeCommit and yield zero tokens instead of the
	// recognized prefix. So the requirement is enforced here as a
	// post-run position check. A character no Token alternative can
	// start leaves `pos` short of the input's end; elementAt returns
	// null once past the buffered tail, which is exactly the
	// consumed-everything case.
	var stuckAt = handle.elementAt(result.pos);
	if (stuckAt != null) {
		let err = new Error(
			`Tokenizer Error: cannot advance at position ${result.pos}, ` +
			`char=${JSON.stringify(stuckAt)}`
		);
		err.pos = result.pos;
		throw err;
	}
}
