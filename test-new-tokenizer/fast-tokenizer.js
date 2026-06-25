// =============================================================
// fast-tokenizer.js
//
// Bespoke performant tokenizer for the Foi lexical grammar.
// Sync API, no external dependencies. Targets foi-toy as a
// drop-in replacement for the legacy hand-written tokenizer.
//
// Validated against tokenizer.js (the combinator-form exec-spec
// of the lex grammar) via the diff harness in test-tokenizer.js.
// The combinator version remains authoritative; this file is
// the performant implementation.
//
// Architecture:
//   - Single string + integer position; no async, no buffering.
//   - Mode stack for the four string forms + interp-expr
//     re-entry. Modes: base, string-lit, interp-str,
//     spacing-interp-str, spacing-escaped-str, interp-expr.
//   - First-char dispatch in base mode. No backtracking through
//     the input; each sub-tokenizer either commits or peeks
//     without consuming.
//   - expressionEnding / numberEnding implemented as post-emit
//     tail probes that buffer trivia and only commit on success.
//
// Token shape (matches combinator output):
//   { type, value, start, end }
//   - type:   PascalCase string
//   - value:  raw matched span
//   - start:  inclusive starting position
//   - end:    inclusive ending position
// =============================================================


// =============================================================
// RESERVED WORD SETS
// Same content as tokenizer.js; exported for shared use.
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
	"Value", "Function", "Number", "List",
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

var NATIVES_SET                  = new Set(NATIVES);
var KEYWORDS_SET                 = new Set(KEYWORDS);
var BUILTINS_SET                 = new Set(BUILTINS);
var COMPREHENSIONS_SET           = new Set(COMPREHENSIONS);
var BOOLEAN_NAMED_OPERATORS_SET  = new Set(BOOLEAN_NAMED_OPERATORS);
var WHITESPACE_SET               = new Set(WHITESPACE_CHARS);


// =============================================================
// SINGLE-CHAR OPERATOR TABLE
//
// Mirrors the `C` table in tokenizer.js. Two exclusion sets:
//   STANDALONE_EXCLUDED: in symb-equivalent but not spread into
//     base dispatch (DoubleQuote — emits only from inside string
//     forms).
//   SYMB_NAMES_EXCLUDED:  in C but no own production (Escape —
//     standalone slot filled by EscapePlain).
// =============================================================

var C = {
	Tilde: "~",        Exmark: "!",        Hash: "#",        Dollar: "$",
	Percent: "%",      Caret: "^",         Ampersand: "&",   Star: "*",
	Plus: "+",         Equal: "=",         At: "@",          Hyphen: "-",
	OpenBracket: "[",  CloseBracket: "]",  Pipe: "|",        Qmark: "?",
	Semicolon: ";",    SingleQuote: "'",   OpenAngle: "<",   CloseAngle: ">",
	Comma: ",",        Period: ".",        Colon: ":",       ForwardSlash: "/",
	Escape: "\\",      OpenParen: "(",     CloseParen: ")",  OpenBrace: "{",
	CloseBrace: "}",   Backtick: "`",      DoubleQuote: '"',
};

var STANDALONE_EXCLUDED  = new Set([ "DoubleQuote" ]);
var SYMB_NAMES_EXCLUDED  = new Set([ "Escape" ]);

// Reverse lookup: char → op name. Excludes Escape (handled
// separately) and never emits DoubleQuote at top level.
var CHAR_TO_OP_NAME = {};
for (let [name, ch] of Object.entries(C)) {
	if (SYMB_NAMES_EXCLUDED.has(name)) continue;
	CHAR_TO_OP_NAME[ch] = name;
}

// Single-char ops whose tokens end an expression — receive
// expressionEnding tail probe after emission.
var EXPR_ENDING_OP_NAMES = new Set([
	"CloseParen", "CloseBrace", "Hash", "Pipe",
]);


// =============================================================
// CHAR PREDICATES
//
// String comparisons rather than charCodeAt — fine at this
// granularity in modern V8. The ident predicates match
// tokenizer.js's regex semantics char-for-char.
// =============================================================

var isWS         = c => WHITESPACE_SET.has(c);
var isDigit      = c => c >= "0" && c <= "9";
var isHexDigit   = c => isDigit(c) || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
var isOctDigit   = c => c >= "0" && c <= "7";
var isBinDigit   = c => c === "0" || c === "1";
var isAlpha      = c => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
var isIdentStart = c => isAlpha(c) || isDigit(c) || c === "_";
var isIdentCont  = c => isIdentStart(c) || c === "~";


// =============================================================
// PUBLIC API
// =============================================================

export function tokenize(src) {
	var state = {
		src,
		pos: 0,
		tokens: [],
		modeStack: [ "base" ],
	};
	while (state.pos < src.length) {
		let mode = state.modeStack[state.modeStack.length - 1];
		let ok;
		switch (mode) {
			case "base":
			case "interp-expr":
				ok = stepBase(state, mode);
				break;
			case "string-lit":
				ok = stepStringLit(state);
				break;
			case "interp-str":
				ok = stepInterpStr(state);
				break;
			case "spacing-interp-str":
				ok = stepSpacingInterpStr(state);
				break;
			case "spacing-escaped-str":
				ok = stepSpacingEscapedStr(state);
				break;
			default:
				throw new Error(`tokenize: unknown mode ${mode}`);
		}
		if (!ok) {
			throw new Error(
				`tokenize: cannot advance at position ${state.pos}, ` +
				`char=${JSON.stringify(src[state.pos])}, mode=${mode}`
			);
		}
	}
	return state.tokens;
}


// =============================================================
// EMISSION HELPER
// =============================================================

function emit(state, type, value, start, end) {
	state.tokens.push({ type, value, start, end });
}


// =============================================================
// BASE MODE (and INTERP-EXPR MODE)
//
// interp-expr differs from base only in that a bare backtick
// closes the embed; all other tokenization is identical.
// =============================================================

function stepBase(state, mode) {
	var src = state.src;
	var pos = state.pos;
	var c = src[pos];

	// interp-expr close: bare backtick exits the embed.
	if (mode === "interp-expr" && c === "`") {
		emit(state, "Backtick", "`", pos, pos);
		state.pos = pos + 1;
		state.modeStack.pop();
		return true;
	}

	// Whitespace (highest priority — never wrapped with
	// expressionEnding, never typed-ident).
	if (isWS(c)) {
		let end = pos + 1;
		while (end < src.length && isWS(src[end])) end++;
		emit(state, "Whitespace", src.slice(pos, end), pos, end - 1);
		state.pos = end;
		return true;
	}

	// First-char dispatch. Productions overlap on first char are
	// resolved per dispatch function (longest-match within each).
	switch (c) {
		case "/":  return stepSlash(state);
		case "\"": return openStringLit(state);
		case "`":  return openInterpStr(state);
		case "\\": return stepBackslash(state);
		case "~":  return stepTilde(state);
		case "?":  return stepQmarkOrExmark(state, "Qmark", "?");
		case "!":  return stepQmarkOrExmark(state, "Exmark", "!");
		case ":":  return stepColon(state);
		case ".":  return stepPeriod(state);
		case "-":  return stepHyphen(state);
	}

	if (isDigit(c)) {
		return stepDigitStart(state);
	}

	if (isAlpha(c) || c === "_") {
		return stepIdentStart(state);
	}

	// Other single-char ops (the symb spread). Excludes
	// DoubleQuote (only emits from inside string forms) and
	// Escape (handled by stepBackslash above).
	var opName = CHAR_TO_OP_NAME[c];
	if (opName && !STANDALONE_EXCLUDED.has(opName)) {
		emit(state, opName, c, pos, pos);
		state.pos = pos + 1;
		if (EXPR_ENDING_OP_NAMES.has(opName)) {
			tryExprEndingTail(state);
		}
		return true;
	}

	return false;
}


// =============================================================
// SLASH:  Comment | Mountain | ForwardSlash
//
// `//`  → line comment (until newline or EOF)
// `///` → block comment (until next `///` or EOF)
// `/\`  → Mountain (curry operator)
// `/`   → standalone ForwardSlash
// =============================================================

function stepSlash(state) {
	var src = state.src;
	var pos = state.pos;
	var c1 = src[pos + 1];

	if (c1 === "/") {
		// Block vs line: third char decides.
		if (src[pos + 2] === "/") {
			return scanBlockComment(state);
		}
		return scanLineComment(state);
	}

	if (c1 === "\\") {
		emit(state, "Mountain", "/\\", pos, pos + 1);
		state.pos = pos + 2;
		return true;
	}

	// Standalone ForwardSlash.
	emit(state, "ForwardSlash", "/", pos, pos);
	state.pos = pos + 1;
	return true;
}

// Line comment: `// ... \n` (newline NOT consumed; picked up
// as Whitespace next iteration). EOF-tolerant.
function scanLineComment(state) {
	var src = state.src;
	var start = state.pos;
	var end = start + 2;  // past the `//`
	while (end < src.length && src[end] !== "\n") end++;
	emit(state, "Comment", src.slice(start, end), start, end - 1);
	state.pos = end;
	return true;
}

// Block comment: `/// ... ///`. The closing `///` IS consumed.
// EOF-tolerant — an unclosed block ends at EOF without error.
function scanBlockComment(state) {
	var src = state.src;
	var start = state.pos;
	var pos = start + 3;  // past opening `///`
	while (pos < src.length) {
		if (src[pos] === "/" && src[pos + 1] === "/" && src[pos + 2] === "/") {
			pos += 3;
			emit(state, "Comment", src.slice(start, pos), start, pos - 1);
			state.pos = pos;
			return true;
		}
		pos++;
	}
	// EOF reached without close — emit what we have.
	emit(state, "Comment", src.slice(start, src.length), start, src.length - 1);
	state.pos = src.length;
	return true;
}


// =============================================================
// STRING FORMS
//
// All four forms split into an "open" routine (emits the
// opener tokens, pushes mode) and a per-mode step routine.
// =============================================================

// Bare `"...":  StringLit. No escape-prefix; opens with raw DQ.
function openStringLit(state) {
	var pos = state.pos;
	emit(state, "DoubleQuote", "\"", pos, pos);
	state.pos = pos + 1;
	state.modeStack.push("string-lit");
	return true;
}

// `"..." (Backtick + DQ): InterpStr. Backtick is emitted as
// an Escape token with value "`", not as a Backtick token.
function openInterpStr(state) {
	var src = state.src;
	var pos = state.pos;
	if (src[pos + 1] === "\"") {
		emit(state, "Escape", "`", pos, pos);
		emit(state, "DoubleQuote", "\"", pos + 1, pos + 1);
		state.pos = pos + 2;
		state.modeStack.push("interp-str");
		return true;
	}
	// Standalone Backtick (single-char op). Not expression-ending.
	emit(state, "Backtick", "`", pos, pos);
	state.pos = pos + 1;
	return true;
}


// =============================================================
// STRING-LIT MODE
//
// Plain "..." — content is either StringEscapedChar (`""` →
// emits StringEscapedChar) or a run of non-`"` chars (emits as
// String). Closing `"` exits mode.
// =============================================================

function stepStringLit(state) {
	var src = state.src;
	var pos = state.pos;
	var c = src[pos];

	if (c === undefined) return false;

	if (c === "\"") {
		if (src[pos + 1] === "\"") {
			// Escaped doublequote: emit StringEscapedChar.
			emit(state, "StringEscapedChar", "\"\"", pos, pos + 1);
			state.pos = pos + 2;
			return true;
		}
		// Closing DQ.
		emit(state, "DoubleQuote", "\"", pos, pos);
		state.pos = pos + 1;
		state.modeStack.pop();
		return true;
	}

	// Run of String chars (anything not `"`).
	var end = pos;
	while (end < src.length && src[end] !== "\"") end++;
	emit(state, "String", src.slice(pos, end), pos, end - 1);
	state.pos = end;
	return true;
}


// =============================================================
// INTERP-STR MODE
//
// `"..." — content alternatives: StringEscapedChar (`""` or
// ``` `` ```), InterpExpr (bare `\``), or String chars (excluding
// `"` and `` ` ``).
// =============================================================

function stepInterpStr(state) {
	var src = state.src;
	var pos = state.pos;
	var c = src[pos];

	if (c === undefined) return false;

	if (c === "\"") {
		if (src[pos + 1] === "\"") {
			emit(state, "StringEscapedChar", "\"\"", pos, pos + 1);
			state.pos = pos + 2;
			return true;
		}
		emit(state, "DoubleQuote", "\"", pos, pos);
		state.pos = pos + 1;
		state.modeStack.pop();
		return true;
	}

	if (c === "`") {
		if (src[pos + 1] === "`") {
			emit(state, "StringEscapedChar", "``", pos, pos + 1);
			state.pos = pos + 2;
			return true;
		}
		// Open InterpExpr: emit Backtick, push interp-expr mode.
		emit(state, "Backtick", "`", pos, pos);
		state.pos = pos + 1;
		state.modeStack.push("interp-expr");
		return true;
	}

	// String chars: until `"` or `` ` ``.
	var end = pos;
	while (end < src.length && src[end] !== "\"" && src[end] !== "`") end++;
	emit(state, "String", src.slice(pos, end), pos, end - 1);
	state.pos = end;
	return true;
}


// =============================================================
// SPACING-INTERP-STR MODE
//
// Same as interp-str but Whitespace runs emit as their own
// tokens (chars predicate excludes WS too).
// =============================================================

function stepSpacingInterpStr(state) {
	var src = state.src;
	var pos = state.pos;
	var c = src[pos];

	if (c === undefined) return false;

	if (c === "\"") {
		if (src[pos + 1] === "\"") {
			emit(state, "StringEscapedChar", "\"\"", pos, pos + 1);
			state.pos = pos + 2;
			return true;
		}
		emit(state, "DoubleQuote", "\"", pos, pos);
		state.pos = pos + 1;
		state.modeStack.pop();
		return true;
	}

	if (c === "`") {
		if (src[pos + 1] === "`") {
			emit(state, "StringEscapedChar", "``", pos, pos + 1);
			state.pos = pos + 2;
			return true;
		}
		emit(state, "Backtick", "`", pos, pos);
		state.pos = pos + 1;
		state.modeStack.push("interp-expr");
		return true;
	}

	if (isWS(c)) {
		let end = pos + 1;
		while (end < src.length && isWS(src[end])) end++;
		emit(state, "Whitespace", src.slice(pos, end), pos, end - 1);
		state.pos = end;
		return true;
	}

	// String chars: until `"`, `` ` ``, or WS.
	var end = pos;
	while (end < src.length) {
		let ch = src[end];
		if (ch === "\"" || ch === "`" || isWS(ch)) break;
		end++;
	}
	emit(state, "String", src.slice(pos, end), pos, end - 1);
	state.pos = end;
	return true;
}


// =============================================================
// SPACING-ESCAPED-STR MODE
//
// Like string-lit + Whitespace runs as own tokens. No
// embed-handling — `` ` `` is literal String content.
// =============================================================

function stepSpacingEscapedStr(state) {
	var src = state.src;
	var pos = state.pos;
	var c = src[pos];

	if (c === undefined) return false;

	if (c === "\"") {
		if (src[pos + 1] === "\"") {
			emit(state, "StringEscapedChar", "\"\"", pos, pos + 1);
			state.pos = pos + 2;
			return true;
		}
		emit(state, "DoubleQuote", "\"", pos, pos);
		state.pos = pos + 1;
		state.modeStack.pop();
		return true;
	}

	if (isWS(c)) {
		let end = pos + 1;
		while (end < src.length && isWS(src[end])) end++;
		emit(state, "Whitespace", src.slice(pos, end), pos, end - 1);
		state.pos = end;
		return true;
	}

	// String chars: until `"` or WS. (Backtick stays as content.)
	var end = pos;
	while (end < src.length) {
		let ch = src[end];
		if (ch === "\"" || isWS(ch)) break;
		end++;
	}
	emit(state, "String", src.slice(pos, end), pos, end - 1);
	state.pos = end;
	return true;
}


// =============================================================
// BACKSLASH DISPATCH
//
// Order matches tokenizer.js's BaseTokenOr for `\`-leading:
//   1. SpacingInterpStr  (\` + ")
//   2. SpacingEscapedStr (\")
//   3. EscapedNumber arms (\h, \u, \o, \b, \@, \) — each
//      arm is atomic: opener + (number | General) or
//      whole-arm rollback.
//   4. Valley (\/)
//   5. Standalone EscapePlain (\)
// =============================================================

function stepBackslash(state) {
	var src = state.src;
	var pos = state.pos;
	var c1 = src[pos + 1];

	// SpacingInterpStr: \` + "
	if (c1 === "`" && src[pos + 2] === "\"") {
		emit(state, "Escape", "\\`", pos, pos + 1);
		emit(state, "DoubleQuote", "\"", pos + 2, pos + 2);
		state.pos = pos + 3;
		state.modeStack.push("spacing-interp-str");
		return true;
	}

	// SpacingEscapedStr: \"
	if (c1 === "\"") {
		emit(state, "Escape", "\\", pos, pos);
		emit(state, "DoubleQuote", "\"", pos + 1, pos + 1);
		state.pos = pos + 2;
		state.modeStack.push("spacing-escaped-str");
		return true;
	}

	// EscapedNumber arms. Each arm: try opener, then try inner
	// number production, fall back to General. If both inner
	// alternatives fail, the whole arm rolls back (caller is
	// state.pos unchanged) and the next arm is tried.
	if (tryEscapedNumberArm(state, c1, "h", "\\h", "hex"))      return true;
	if (tryEscapedNumberArm(state, c1, "u", "\\u", "unicode"))  return true;
	if (tryEscapedNumberArm(state, c1, "o", "\\o", "octal"))    return true;
	if (tryEscapedNumberArm(state, c1, "b", "\\b", "binary"))   return true;
	if (tryEscapedNumberArm(state, c1, "@", "\\@", "monadic"))  return true;
	if (tryEscapedPlainArm(state))                              return true;

	// Valley: \/
	if (c1 === "/") {
		emit(state, "Valley", "\\/", pos, pos + 1);
		state.pos = pos + 2;
		return true;
	}

	// Standalone EscapePlain.
	emit(state, "Escape", "\\", pos, pos);
	state.pos = pos + 1;
	return true;
}

// Try one of the typed-escape number arms (\h, \u, \o, \b, \@).
// Atomic: either commits Escape + (Number | General), or
// leaves state.pos unchanged.
function tryEscapedNumberArm(state, c1, expectedC1, escapeVal, kind) {
	if (c1 !== expectedC1) return false;
	var pos = state.pos;
	var innerStart = pos + 2;

	// Try the typed number content.
	var numEnd = scanTypedNumberContent(state.src, innerStart, kind);
	if (numEnd > innerStart && !isIdentCont(state.src[numEnd] || "")) {
		emit(state, "Escape", escapeVal, pos, pos + 1);
		emit(state, "Number", state.src.slice(innerStart, numEnd), innerStart, numEnd - 1);
		state.pos = numEnd;
		return true;
	}

	// Fall back to General-as-content.
	var identEnd = scanGeneralBody(state.src, innerStart);
	if (identEnd > innerStart) {
		emit(state, "Escape", escapeVal, pos, pos + 1);
		emit(state, "General", state.src.slice(innerStart, identEnd), innerStart, identEnd - 1);
		state.pos = identEnd;
		return true;
	}

	return false;
}

// EscapePlain arm: \ + (PositiveIntegerLitWithSep | BareNumber
// | General). Atomic per the same pattern.
function tryEscapedPlainArm(state) {
	var src = state.src;
	var pos = state.pos;
	var innerStart = pos + 1;

	// PositiveIntegerLitWithSep: digits+sep+digits, NotDotDigit,
	// NotIdentCont.
	var posIntEnd = scanPositiveIntegerWithSep(src, innerStart);
	if (posIntEnd > innerStart) {
		emit(state, "Escape", "\\", pos, pos);
		emit(state, "PositiveIntegerLit", src.slice(innerStart, posIntEnd), innerStart, posIntEnd - 1);
		state.pos = posIntEnd;
		return true;
	}

	// BareNumber: -? digits-with-sep (. digits-with-sep)?
	var bareEnd = scanBareNumber(src, innerStart);
	if (bareEnd > innerStart) {
		emit(state, "Escape", "\\", pos, pos);
		emit(state, "Number", src.slice(innerStart, bareEnd), innerStart, bareEnd - 1);
		state.pos = bareEnd;
		return true;
	}

	// General fallback.
	var identEnd = scanGeneralBody(src, innerStart);
	if (identEnd > innerStart) {
		emit(state, "Escape", "\\", pos, pos);
		emit(state, "General", src.slice(innerStart, identEnd), innerStart, identEnd - 1);
		state.pos = identEnd;
		return true;
	}

	return false;
}

// Scan the content for a typed escape (hex/unicode/octal/binary
// /monadic). Returns end position (exclusive) or innerStart if
// no content matched. Sign rules per Lexical-Grammar.md Note 5:
// hex/octal/binary/monadic admit optional leading "-"; unicode
// does not.
function scanTypedNumberContent(src, start, kind) {
	var p = start;
	var predicate;
	if (kind === "hex" || kind === "unicode") predicate = isHexDigit;
	else if (kind === "octal")                predicate = isOctDigit;
	else if (kind === "binary")               predicate = isBinDigit;
	else if (kind === "monadic")              predicate = isHexDigit;
	else return start;

	if (kind !== "unicode" && src[p] === "-") p++;

	// Monadic uses with-sep + optional fractional part.
	if (kind === "monadic") {
		let digsEnd = scanDigitsWithSep(src, p, predicate);
		if (digsEnd === p) return start;
		p = digsEnd;
		if (src[p] === "." && predicate(src[p + 1] || "")) {
			p++;
			p = scanDigitsWithSep(src, p, predicate);
		}
		return p;
	}

	// Plain typed digits (no separators in the inner content for
	// hex/unicode/octal/binary).
	let digsEnd = p;
	while (digsEnd < src.length && predicate(src[digsEnd])) digsEnd++;
	if (digsEnd === p) return start;
	return digsEnd;
}

// Scan digits-with-sep: one or more matching digits, then any
// run of (matching digit | "_"). Returns end (exclusive).
function scanDigitsWithSep(src, start, predicate) {
	var p = start;
	while (p < src.length && predicate(src[p])) p++;
	if (p === start) return start;
	while (p < src.length && (predicate(src[p]) || src[p] === "_")) p++;
	return p;
}

// PositiveIntegerLitWithSep: digits-with-sep + NotDotDigit +
// NotIdentCont. Returns end (exclusive) or start on no-match.
function scanPositiveIntegerWithSep(src, start) {
	var end = scanDigitsWithSep(src, start, isDigit);
	if (end === start) return start;
	// NotDotDigit
	if (src[end] === "." && isDigit(src[end + 1] || "")) return start;
	// NotIdentCont
	if (isIdentCont(src[end] || "")) return start;
	return end;
}

// BareNumber: optional "-" + digits-with-sep + optional ("."
// digits-with-sep). Integer-only branch requires NotIdentCont.
// Decimal branch commits without NotIdentCont (matches
// tokenizer.js).
function scanBareNumber(src, start) {
	var p = start;
	if (src[p] === "-") p++;
	var digsEnd = scanDigitsWithSep(src, p, isDigit);
	if (digsEnd === p) return start;
	// Decimal branch.
	if (src[digsEnd] === "." && isDigit(src[digsEnd + 1] || "")) {
		let fracStart = digsEnd + 1;
		let fracEnd = scanDigitsWithSep(src, fracStart, isDigit);
		if (fracEnd > fracStart) return fracEnd;
		return start;
	}
	// Integer-only branch: NotIdentCont required.
	if (isIdentCont(src[digsEnd] || "")) return start;
	return digsEnd;
}


// =============================================================
// TILDE DISPATCH:  Comprehension | General(~-leading) | Tilde
// =============================================================

function stepTilde(state) {
	var src = state.src;
	var pos = state.pos;
	var c1 = src[pos + 1];

	if (c1 && isAlpha(c1)) {
		// Scan ~ + alpha + identCont*
		var end = pos + 2;
		while (end < src.length && isIdentCont(src[end])) end++;
		var word = src.slice(pos, end);

		if (COMPREHENSIONS_SET.has(word)) {
			emit(state, "Comprehension", word, pos, end - 1);
			state.pos = end;
			tryExprEndingTail(state);
			return true;
		}

		// Falls through to General (sawNonDigit is implied by
		// the alpha after `~`).
		emit(state, "General", word, pos, end - 1);
		state.pos = end;
		tryExprEndingTail(state);
		return true;
	}

	// Standalone Tilde.
	emit(state, "Tilde", "~", pos, pos);
	state.pos = pos + 1;
	return true;
}


// =============================================================
// ?/! DISPATCH:  BooleanOper | single-char op
// =============================================================

function stepQmarkOrExmark(state, opName, opChar) {
	var src = state.src;
	var pos = state.pos;
	var c1 = src[pos + 1];

	if (c1 && isAlpha(c1)) {
		var end = pos + 2;
		while (end < src.length && isIdentCont(src[end])) end++;
		var trailing = src.slice(pos + 1, end);
		if (BOOLEAN_NAMED_OPERATORS_SET.has(trailing)) {
			let word = src.slice(pos, end);
			emit(state, "BooleanOper", word, pos, end - 1);
			state.pos = end;
			tryExprEndingTail(state);
			return true;
		}
	}

	emit(state, opName, opChar, pos, pos);
	state.pos = pos + 1;
	return true;
}


// =============================================================
// COLON DISPATCH:  Keyword(:as / :over) | DoubleColon | Colon
// =============================================================

function stepColon(state) {
	var src = state.src;
	var pos = state.pos;

	// Try :-prefixed Keyword.
	var c1 = src[pos + 1];
	if (c1 && isIdentStart(c1)) {
		var end = pos + 2;
		while (end < src.length && isIdentCont(src[end])) end++;
		var word = src.slice(pos, end);
		if (KEYWORDS_SET.has(word)) {
			emit(state, "Keyword", word, pos, end - 1);
			state.pos = end;
			tryExprEndingTail(state);
			return true;
		}
		// Not a keyword — fall through (the leading `:` stays
		// available as Colon or DoubleColon).
	}

	// DoubleColon.
	if (c1 === ":") {
		emit(state, "DoubleColon", "::", pos, pos + 1);
		state.pos = pos + 2;
		return true;
	}

	// Standalone Colon.
	emit(state, "Colon", ":", pos, pos);
	state.pos = pos + 1;
	return true;
}


// =============================================================
// PERIOD DISPATCH: TriplePeriod | DoublePeriod | Period
// =============================================================

function stepPeriod(state) {
	var src = state.src;
	var pos = state.pos;
	if (src[pos + 1] === "." && src[pos + 2] === ".") {
		emit(state, "TriplePeriod", "...", pos, pos + 2);
		state.pos = pos + 3;
		return true;
	}
	if (src[pos + 1] === ".") {
		emit(state, "DoublePeriod", "..", pos, pos + 1);
		state.pos = pos + 2;
		return true;
	}
	emit(state, "Period", ".", pos, pos);
	state.pos = pos + 1;
	return true;
}


// =============================================================
// HYPHEN DISPATCH:  NegativeIntegerLit | NumberLit(decimal) |
// Hyphen
//
// Only fires at fresh-token position; expressionEnding consumes
// the binary form after qualifying tokens.
// =============================================================

function stepHyphen(state) {
	var src = state.src;
	var pos = state.pos;

	if (isDigit(src[pos + 1])) {
		// Try NegativeIntegerLit: - + digits + NotDotDigit +
		// NotIdentCont.
		var p = pos + 1;
		while (p < src.length && isDigit(src[p])) p++;
		var afterDigs = p;
		var notDotDigit = !(src[afterDigs] === "." && isDigit(src[afterDigs + 1] || ""));
		var notIdentCont = !isIdentCont(src[afterDigs] || "");
		if (notDotDigit && notIdentCont) {
			emit(state, "NegativeIntegerLit", src.slice(pos, afterDigs), pos, afterDigs - 1);
			state.pos = afterDigs;
			tryExprEndingTail(state);
			tryNumberEndingTail(state);
			return true;
		}

		// Try NumberLit (decimal with sign).
		var numEnd = scanNumberLitDecimal(src, pos);
		if (numEnd > pos) {
			emit(state, "Number", src.slice(pos, numEnd), pos, numEnd - 1);
			state.pos = numEnd;
			tryExprEndingTail(state);
			return true;
		}
	}

	// Standalone Hyphen.
	emit(state, "Hyphen", "-", pos, pos);
	state.pos = pos + 1;
	return true;
}

// NumberLit decimal scan: -? digits . digits. Returns end on
// success, start on fail. Does NOT include the integer-only
// arm (callers route digit-only matches through IntegerLit
// instead).
function scanNumberLitDecimal(src, start) {
	var p = start;
	if (src[p] === "-") {
		if (!isDigit(src[p + 1])) return start;
		p++;
	}
	while (p < src.length && isDigit(src[p])) p++;
	if (src[p] !== ".") return start;
	if (!isDigit(src[p + 1])) return start;
	p++;
	while (p < src.length && isDigit(src[p])) p++;
	return p;
}


// =============================================================
// DIGIT-START DISPATCH:  PositiveIntegerLit | NumberLit | General
// =============================================================

function stepDigitStart(state) {
	var src = state.src;
	var pos = state.pos;

	// PositiveIntegerLit: digits + NotDotDigit + NotIdentCont.
	var p = pos;
	while (p < src.length && isDigit(src[p])) p++;
	var afterDigs = p;
	var notDotDigit  = !(src[afterDigs] === "." && isDigit(src[afterDigs + 1] || ""));
	var notIdentCont = !isIdentCont(src[afterDigs] || "");

	if (notDotDigit && notIdentCont) {
		emit(state, "PositiveIntegerLit", src.slice(pos, afterDigs), pos, afterDigs - 1);
		state.pos = afterDigs;
		tryExprEndingTail(state);
		tryNumberEndingTail(state);
		return true;
	}

	// NumberLit decimal.
	if (!notDotDigit) {
		var numEnd = scanNumberLitDecimal(src, pos);
		if (numEnd > pos) {
			emit(state, "Number", src.slice(pos, numEnd), pos, numEnd - 1);
			state.pos = numEnd;
			tryExprEndingTail(state);
			return true;
		}
	}

	// General: digit-leading identifier (1_000, 3stars, etc).
	// IdentBody's sawNonDigit gate is satisfied as long as some
	// non-digit char appears in the run; the body scan continues
	// across all identCont chars.
	var identEnd = scanGeneralBody(src, pos);
	if (identEnd > pos) {
		emit(state, "General", src.slice(pos, identEnd), pos, identEnd - 1);
		state.pos = identEnd;
		tryExprEndingTail(state);
		return true;
	}

	return false;
}


// =============================================================
// IDENT-START DISPATCH:  Keyword | Native | Builtin | General
//
// Letters and `_` only. Scans the body, then classifies by
// reserved-set membership in PEG order.
// =============================================================

function stepIdentStart(state) {
	var src = state.src;
	var pos = state.pos;

	// Scan body greedily; sawNonDigit always true (we started
	// with non-digit).
	var end = pos + 1;
	while (end < src.length && isIdentCont(src[end])) end++;
	var word = src.slice(pos, end);

	var type =
		KEYWORDS_SET.has(word) ? "Keyword" :
		NATIVES_SET.has(word)  ? "Native"  :
		BUILTINS_SET.has(word) ? "Builtin" :
		"General";

	emit(state, type, word, pos, end - 1);
	state.pos = end;
	tryExprEndingTail(state);
	return true;
}


// =============================================================
// IDENT BODY SCANNERS
//
// scanGeneralBody: matches IdentBody's two arms.
//   - identStart + identCont*
//   - tilde + alpha + identCont*
// Returns end (exclusive) or start on no-match. Applies
// sawNonDigit gate (requires at least one non-digit char).
// =============================================================

function scanGeneralBody(src, start) {
	var c0 = src[start];
	if (c0 === undefined) return start;
	var p;
	var sawNonDigit = false;

	if (c0 === "~") {
		var c1 = src[start + 1];
		if (!c1 || !isAlpha(c1)) return start;
		p = start + 2;
		sawNonDigit = true;
	}
	else if (isIdentStart(c0)) {
		p = start + 1;
		if (!isDigit(c0)) sawNonDigit = true;
	}
	else {
		return start;
	}

	while (p < src.length && isIdentCont(src[p])) {
		if (!isDigit(src[p])) sawNonDigit = true;
		p++;
	}
	if (!sawNonDigit) return start;
	return p;
}


// =============================================================
// expressionEnding TAIL PROBE
//
// After emitting an expression-ending token, probe forward
// through Whitespace/Comment trivia for a binary `-<digit>`. On
// match: emit the buffered trivia tokens + a Hyphen token,
// advancing state.pos. On miss: nothing committed, trivia
// untouched.
// =============================================================

function tryExprEndingTail(state) {
	var src = state.src;
	var probePos = state.pos;
	var triviaTokens = [];

	while (probePos < src.length) {
		let c = src[probePos];
		if (isWS(c)) {
			let end = probePos + 1;
			while (end < src.length && isWS(src[end])) end++;
			triviaTokens.push({
				type: "Whitespace",
				value: src.slice(probePos, end),
				start: probePos,
				end: end - 1,
			});
			probePos = end;
			continue;
		}
		if (c === "/" && src[probePos + 1] === "/") {
			// Line or block comment.
			let isBlock = src[probePos + 2] === "/";
			let start = probePos;
			let end;
			if (isBlock) {
				let p = probePos + 3;
				while (p < src.length) {
					if (src[p] === "/" && src[p + 1] === "/" && src[p + 2] === "/") {
						p += 3;
						break;
					}
					p++;
				}
				end = p;
			}
			else {
				let p = probePos + 2;
				while (p < src.length && src[p] !== "\n") p++;
				end = p;
			}
			triviaTokens.push({
				type: "Comment",
				value: src.slice(start, end),
				start,
				end: end - 1,
			});
			probePos = end;
			continue;
		}
		break;
	}

	// Lookahead: `-` immediately followed by a digit.
	if (src[probePos] === "-" && isDigit(src[probePos + 1] || "")) {
		for (let t of triviaTokens) state.tokens.push(t);
		state.tokens.push({
			type: "Hyphen",
			value: "-",
			start: probePos,
			end: probePos,
		});
		state.pos = probePos + 1;
	}
	// Else: probe discarded; trivia picked up on next iteration.
}


// =============================================================
// numberEnding TAIL PROBE
//
// After an IntegerLit, consume an immediate `..` (no trivia)
// as DoublePeriod. A third `.` is left as a separate Period.
// =============================================================

function tryNumberEndingTail(state) {
	var src = state.src;
	var pos = state.pos;
	if (src[pos] === "." && src[pos + 1] === ".") {
		emit(state, "DoublePeriod", "..", pos, pos + 1);
		state.pos = pos + 2;
	}
}
