// =============================================================
// test.js
//
// Diff harness comparing the new combinator-based tokenizer (in
// tokenizer.js) against the legacy hand-written tokenizer (in
// orig-tokenizer.js). Fully streaming: tokens flow through the
// pipeline as they're recognized.
//
// The new tokenizer emits PascalCase token types ("OpenParen");
// the legacy tokenizer emits UPPERCASE_SNAKE ("OPEN_PAREN").
// normalizeOrigStream renames type on the legacy side via a
// mechanical UPPERCASE_SNAKE → PascalCase pass before lockstep
// comparison. Grain already matches on both sides (basic strings
// as DQ+STRING+DQ; escaped numbers as ESCAPE+NUMBER; etc.).
// =============================================================

import { tokenize as origTokenize } from "./orig-tokenizer.js";
import { tokenize } from "./new-tokenizer.js";


// Mechanical rename: UPPERCASE_SNAKE → PascalCase. Lowercase the
// input, split on underscores, capitalize each piece, rejoin.
function pascalize(s) {
	return s
		.toLowerCase()
		.split("_")
		.map(part => part.charAt(0).toUpperCase() + part.slice(1))
		.join("");
}

// Adapter over the legacy tokenizer's async-iterable output:
// renames token.type from UPPERCASE_SNAKE to PascalCase, leaves
// value / start / end untouched.
async function *normalizeOrigStream(legacyStream) {
	for await (let tok of legacyStream) {
		yield { ...tok, type: pascalize(tok.type) };
	}
}

async function *normalizeNewStream(newStream) {
	for await (let tok of newStream) {
		if (tok.type === "PositiveIntegerLit" || tok.type === "NegativeIntegerLit") {
			yield { ...tok, type: "Number" };
		}
		else {
			yield tok;
		}
	}
}

// Streaming diff. Walks the legacy stream and the new tokenizer
// stream in lockstep, yielding one event per position:
//   { kind: "match", index, token }
//   { kind: "diff",  index, orig, new }
// Generator returns when both streams are exhausted.
export async function *diffStream(input) {
	var origIter = normalizeOrigStream(origTokenize(input));
	var newIter  = normalizeNewStream(tokenize(input));

	var i = 0;
	while (true) {
		let [ a, b ] = await Promise.all([
			origIter.next(),
			newIter.next(),
		]);
		if (a.done && b.done) return;

		let aTok = a.done ? null : a.value;
		let bTok = b.done ? null : b.value;

		if (
			aTok && bTok &&
			aTok.type  === bTok.type &&
			aTok.value === bTok.value &&
			aTok.start === bTok.start &&
			aTok.end   === bTok.end
		) {
			yield { kind: "match", index: i, token: aTok };
		}
		else {
			yield { kind: "diff", index: i, orig: aTok, new: bTok };
		}
		i++;
	}
}

// Convenience accumulator over diffStream.
export async function diff(input) {
	var matches = 0;
	var diffs   = [];
	var total   = 0;
	for await (let ev of diffStream(input)) {
		if (ev.kind === "match") matches++;
		else diffs.push(ev);
		total++;
	}
	return {
		input,
		matches,
		diffs,
		total,
		summary: `${matches}/${total} matched, ${diffs.length} diff${diffs.length === 1 ? "" : "s"}`,
	};
}


// =============================================================
// KNOWN DIVERGENCES
//
// Inputs where the new tokenizer's output is expected to differ
// from the legacy tokenizer's. Each entry maps the exact input
// string to a one-line reason explaining why the divergence is
// intentional / expected.
//
// Three-state assertion: a sample is "passing" iff its diff
// outcome matches its mark here.
//   - unmarked + clean   → pass (✓)
//   - marked   + dirty   → pass (⚠), reason printed
//   - unmarked + dirty   → FAIL (✗), regression
//   - marked   + clean   → FAIL (?), divergence resolved — remove from map
// =============================================================

var KNOWN_DIVERGENT = new Map([
	[ "5.5.5",
		"Legacy emits single Number('5.5.5'); new splits into Number(5.5) + Period + Number(5). Legacy's decimal grammar extends past one fractional part; new follows the documented NumberBody := (Digit+ '.' Digit+) | Digit+" ],
	[ "12.5...args",
		"After a decimal NumberLit followed by '...', new follows PEG longest-match (TriplePeriod); legacy emits Period + DoublePeriod, an artifact of its decimal-grammar's recovery when an extra '.' appears after fractional digits" ],
	[ "-5foo",
		"Following the digit-leading-identifier principle, new emits Hyphen + General('5foo') (unary minus on identifier '5foo'). Legacy commits to number context at '-' and emits Number(-5) + General('foo'), which is internally inconsistent with its own behavior on bare '1foo' → identifier" ],
	[ "foo //c\n-5",
		"Legacy's minusOpAllowed flag gets clobbered by Comment tokens in trivia; new's expressionEnding tail correctly consumes Hyphen after Comment-bearing trivia" ],
	[ "foo /// c ///-5",
		"Same: legacy mishandles minus-after-Comment in expressionEnding tail" ],
	[ "foo // c1\n  // c2\n  -5",
		"Same: legacy mishandles minus-after-Comment in expressionEnding tail" ],
	[ "42 // c\n-3",
		"Same: legacy mishandles minus-after-Comment in expressionEnding tail" ],
	[ "`\" `\\h2A` \"",
		"Legacy bug: emits Whitespace(' ') for trailing space after escaped-number embed in InterpStr; new correctly emits String(' ') per InterpStrChars predicate. Corresponding case with a simple-identifier embed (e.g. `\" `a` \") emits String on both sides — legacy inconsistency depends on what the embed contained" ],
	[ "\\h",
		"Documented 'Known Divergences' (Lexical-Grammar.md): new emits Escape('\\') + General('h'); legacy emits Escape('\\h'). Combinator lexer commits fully or not at all on multi-char escapes; legacy partial-commits and emits the multi-char Escape even when no content follows" ],
	[ "\\u-5",
		"Documented 'Known Divergences': new emits Escape('\\') + General('u') + Hyphen + Number(5); legacy emits Escape('\\u') + Hyphen + Number(5). Same partial-commit asymmetry — when `-` follows `\\u`, General fallback in EscapedNumber fails (`-` not IdentStart), so the whole arm rolls back" ],
	[ "\\@-",
		"Documented 'Known Divergences': new emits Escape('\\') + At + Hyphen; legacy emits Escape('\\@') + Number('-'). Same partial-commit asymmetry. Legacy's bare-hyphen-as-Number value is also dubious in its own right" ],
	[ "123~",
		"Following the digit-leading-identifier principle (and Grammar.md's explicit '[0-9]+~' Identifier alternative), new emits General('123~') as a single identifier. Legacy splits into Number(123) + Tilde, internally inconsistent with its own behavior on bare '1foo' → identifier" ],
	[ "def 123~: empty;",
		"Same as bare '123~' — new emits General('123~') per the [0-9]+~ Identifier alternative; legacy splits Number(123) + Tilde. The Grammar.md test snippet block 3 has this exact form as a positive example, confirming '123~' is intended to be an identifier" ],
	[ "\\-123_456",
		"Legacy splits Escape('\\') + Number('-123') + General('_456'); new emits Escape('\\') + Number('-123_456'). Legacy's hyphen branch of EscapePlain+number doesn't carry through underscore-separator support — an internal asymmetry (legacy handles '\\123_456' fine). Grammar.md uses this exact form as a positive example, confirming new is correct per spec" ],
	[ "\\-123_456.78_9",
		"Same legacy asymmetry extended to decimals — legacy splits at the first underscore and emits a stray Period; new emits the full BareNumber decimal. Grammar.md positive example" ],
	[ "\\-5foo",
		"Escaped analog of the documented '-5foo' divergence. New: Escape('\\') + Hyphen + General('5foo') — the whole EscapePlain arm rolls back atomically (BareNumber fails NotIdentCont, General fails IdentStart on '-'). Legacy: Escape('\\') + Number(-5) + General('foo')" ],
	[ "\\h-Fxyz",
		"Sign + digit-leading-identifier in escaped hex form. New applies NotIdentCont uniformly to HexNumber, so the whole EscapeHex arm rolls back when an IdentCont follows the hex digits; legacy doesn't enforce it and commits to Escape('\\h') + Number('-F') + General('xyz')" ],
	[ "\\@-5foo",
		"Same as \\h-Fxyz but for MonadNumber. New: Escape('\\') + At + Hyphen + General('5foo'). Legacy: Escape('\\@') + Number('-5f') + General('oo') — note legacy consumes the 'f' as a hex digit since MonadNumber accepts hex" ],
	[ "\\\"A single line\n    string with whitespace collapsing, defined across multiple\n  lines\"",
		"Legacy bug: emits Keyword('string') for the substring 'string' inside a spacing-escaped string body — the KEYWORDS gate leaks into string content. New correctly emits String('string') per SpacingEscapedStrChars (typed-identifier productions never fire inside string-form bodies)" ],
	[ "`\"Special number: `-3.1415962`\n   Name: `name`\n   Greeting: `\\`\"Hello world\"`\n   Reaction: `\\\"Yay!\"`\n   Reply: `\"Ok.\"`\n!\"",
		"Legacy emits Escape('`') for an InterpExpr closing backtick when the embed contains a nested escape-bearing string form; new correctly emits Backtick per InterpExpr's symb.Backtick reference (same production for opener and closer)" ],
	[ "-1_000",
		"Same family as existing '-5foo' divergence: new applies NotIdentCont uniformly across integer-shaped productions, so NegInt backs off when followed by IdentCont. New: Hyphen + General('1_000'). Legacy: Number(-1) + General('_000') — partial-commits the integer. New's behavior is consistent with the digit-leading-identifier rules (Note 10)." ],
	[ "-1foo",
		"Same family as '-5foo' and '-1_000': uniform NotIdentCont guard prevents partial-commit. New: Hyphen + General('1foo'). Legacy: Number(-1) + General('foo')." ],
]);


// =============================================================
// SMOKE TEST (runs only if this file is invoked directly)
// =============================================================

if (import.meta.url === `file://${process.argv[1]}`) {
	let samples = [
		// Basics
		"foo",
		"foo bar",
		"def x: 42;",
		"defn add(a,b) ^a + b;",
		"",                                    // empty input
		"   ",                                 // whitespace only
		"\t\n  \t",                            // mixed whitespace

		// Comments
		"//line\n42",
		"///block///x",
		"//",                                  // bare line comment, no content
		"//foo",                               // line comment, no trailing newline (EOF)
		"///",                                 // bare block-comment opener, EOF-terminated
		"///foo",                              // block comment, EOF-terminated (no closing ///)
		"///foo\nbar\n///",                    // multiline block, normally closed
		"// foo\n// bar",                      // two line comments back to back

		// Numbers
		"123",
		"12.5",
		"12..5",
		"5",                                   // PositiveIntegerLit (normalizes to Number)

		// PositiveIntegerLit vs NumberLit boundary
		"5.",                                  // PositiveIntLit + Period (NotDotDigit allows)
		"5.foo",                               // PositiveIntLit + Period + General
		"5..10",                               // PositiveIntLit + DoublePeriod + PositiveIntLit
		"5...",                                // KNOWN_DIVERGENT
		"5.5.5",                               // KNOWN_DIVERGENT
		"0",                                   // single-digit PositiveIntLit
		"00",                                  // multi-digit, leading zero
		"1_000_000",                           // digit-leading identifier (see below)

		// =============================================================
		// NegativeIntegerLit cases.
		//
		// NegInt fires at fresh-token position with the same NotDotDigit
		// / NotIdentCont guards as PosInt; the only difference is the
		// required leading "-". Tokens normalize via the harness back to
		// Number on the new side, so these should all lockstep with the
		// legacy tokenizer.
		// =============================================================

		// Bare NegInt fires:
		"-0",                                  // sign + single zero
		"-1",                                  // sign + single digit
		"-42",                                 // sign + multi-digit
		"numbers.-1",                          // motivating case: dot-access negative index
		"def last: arr.-1;",                   // motivating case in statement context

		// NegInt declines via NotDotDigit — falls through to NumberLit:
		"-1.5",                                // decimal — NotDotDigit backs off NegInt; NumberLit decimal fires
		"-0.5",
		"-12.5",

		// NegInt declines via NotIdentCont — falls through (Hyphen + ident path):
		"-1_000",                              // separator is IdentCont; NegInt backs off; expect Hyphen + General
		"-1foo",                               // ident-cont; same path as existing "-5foo"

		// NumberEndingTail symmetry — DoublePeriod consumption after NegInt
		// parallels existing PosInt cases ("5..10", "5...args").
		"-5..3",                               // closed range LHS
		"-5..",                                // leading range
		"..-3",                                // trailing range
		"-5...args",                           // splits ... into .. + . (parallel to "5...args")

		// Bare ranges with negative endpoints (motivating cases for
		// numberEnding(expressionEnding(IntegerLit)) wrapper order).
		"-2..-1",                              // both negative — the canonical case
		"5..-1",                               // positive LHS, negative RHS
		"0..-1",                               // zero LHS, negative RHS
		"-5..0",                               // negative LHS, zero RHS
		"-5..-1",                              // both negative, multi-digit-safe
		"-10..-5",                             // both negative, both multi-digit
		"1..-1..3",                            // chained (lex-only; syn legality TBD)

		// Ranges with negative endpoints inside other constructs (probes
		// composition with surrounding contexts, no new lex behavior expected).
		"(-5)..(-1)",                          // grouped form — comparison baseline
		"<-5..-1>",                            // inside a tuple literal
		"x..-1",                               // identifier LHS — ExprEndingTail on General must decline before `..`

		// ExprEndingTail symmetry — binary Hyphen after NegInt parallels
		// PosInt behavior ("5-3" → PosInt, Hyphen, PosInt).
		"-5-3",                                // NegInt(-5), Hyphen, PosInt(3)
		"-5 - 3",                              // spaced form
		"-5+3",                                // Plus is not -Digit, no ExprEndingTail consumption
		"-5*3",                                // similar
		"(-5)-3",                              // grouped LHS

		// NegInt inside data-structure literals — already syn-reachable
		// via NumberLit, but verifying lex grain:
		"<-1, -2, -3>",                        // tuple with negative literals
		"<-0>",                                // single-entry edge case
		"arr.[-2..-1]",                        // range with negative endpoints inside DotBracketExpr
		"arr.[-1..]",                          // trailing range (already exists as `numbers.[-1..]` form)

		// Escape arm unchanged — NegInt only fires at fresh-token position,
		// not inside EscapePlain's inner alternation. These already exist
		// elsewhere; restating here as smoke-tests that they still pass:
		"\\-5",                                // EscapePlain + BareNumber(-5)
		"\\-123_456",                          // EscapePlain + BareNumber(-int with sep)
		"\\-5foo",                             // EscapePlain + General fallback (existing divergent)

		// Digit-leading identifier formation: integer-only number
		// productions back off via NotIdentCont when followed by any
		// IdentCont char, letting General consume the full ident.
		// The decimal branch keeps the digits — once "." is seen, it's
		// committed to number territory.
		"1foo",                                // digit + alpha
		"1_foo",                               // digit + underscore + alpha
		"1abc",                                // digit + alpha (different chars)
		"5foo",                                // probe: rule applies to any leading digit
		"5_foo",
		"5.5foo",                              // decimal branch — should split cleanly
		"-5foo",                               // sign branch — does NumberLit back off through "-"?
		"\\1foo",                              // escaped form — `\` declares number context, should split

		// Escaped-number / identifier boundary. PositiveIntegerLitWithSep
		// and BareNumber were patched with NotIdentCont; the hex / octal /
		// binary / monadic / unicode escape variants were NOT. These probes
		// reveal whether the boundary needs broader application.
		"\\1_000foo",                          // PositiveIntegerLitWithSep (patched) + ident
		"\\5.5foo",                            // BareNumber decimal branch — should split cleanly
		"\\h2Axyz",                            // HexNumber (unpatched) + ident
		"\\b101xyz",                           // BinaryNumber (unpatched) + ident
		"\\o7xyz",                             // OctalNumber (unpatched) + ident
		"\\u41xyz",                            // UnicodeNumber (unpatched) + ident
		"\\@FFxyz",                            // MonadNumber (unpatched) + ident

		// Malformed escape inputs (from Lexical-Grammar.md "Known
		// Divergences" table). Tests how the lexer handles multi-char
		// escape openers that don't find their expected content. The
		// General-fallback arms in EscapedNumber resolve cases where
		// IdentStart follows; cases where non-IdentStart follows (`-`,
		// EOF) remain divergent because the whole arm rolls back.
		"\\h",                                 // KNOWN_DIVERGENT — EOF after \h
		"\\u-5",                               // KNOWN_DIVERGENT — `-` not IdentStart
		"\\h_foo",                             // resolved by General fallback — regression test
		"\\@-",                                // KNOWN_DIVERGENT — `-` not IdentStart

		// Escaped numbers
		"\\h1A2",
		"\\@99",
		"\\b1010",
		"\\h-5",
		"\\o-7",
		"\\b-1",
		"\\u263A",
		"\\@FF",
		"\\@-FF",
		"\\@5_FF",
		"\\@5.5",
		"\\@-5",
		"\\@5_000_003.25",
		"\\1_234_567",
		"\\1_234_567.890_123",
		"\\5_",
		"\\5_000",                             // EscapePlain + PositiveIntLit(WithSep) — no fractional
		"\\5_000.25",                          // EscapePlain + BareNumber arm — has fractional
		"\\5",                                 // EscapePlain + PositiveIntLit (no separators)
		"\\h0",                                // single hex digit
		"\\b0",
		"\\o0",
		"\\u0",

		// Grammar.md block 4: negative escaped numbers — full sweep.
		// EscapePlain + hyphen-leading forms not currently probed:
		"\\-123_456",                          // EscapePlain + BareNumber(-int with sep) → Escape + Number
		"\\-123_456.78_9",                     // EscapePlain + BareNumber(-decimal with sep)
		"\\-5",                                // EscapePlain + BareNumber(-int, no sep)
		"\\-5.5",                              // EscapePlain + BareNumber(-decimal, no sep)
		"\\-0",                                // EscapePlain + BareNumber(-0)

		// Other Escape variants with negative content (Grammar.md spread):
		"\\b-10110",                           // EscapeBinary + BinaryNumber(-)
		"\\hf123",                             // EscapeHex + HexNumber (positive, full hex span)
		"\\h-f123",                            // EscapeHex + HexNumber(-)
		"\\o-123",                             // EscapeOctal + OctalNumber(-)
		"\\@123_456.78_9",                     // EscapeMonadic + MonadNumber (positive decimal with sep)
		"\\@-f123",                            // EscapeMonadic + MonadNumber(-hex)
		"\\@-123_456.78_9",                    // EscapeMonadic + MonadNumber(-decimal with sep)

		// Boundary: negative escaped number followed by identifier-cont.
		// Probes whether NotIdentCont composes with the sign branch correctly.
		"\\-5foo",                             // does decimal-branch fallback fire? expect: ?
		"\\h-Fxyz",                            // negative hex + ident continuation
		"\\@-5foo",                            // negative monad + ident continuation

		// Identifiers with tilde
		"~map",
		"~map foo",
		"foo~bar",
		"~foo",

		// Reserved-set gate boundaries (one char off from membership)
		"?ands",                               // BooleanOper gate fails → Qmark + General
		"!ors",
		"?empt",                               // Qmark + General
		":asx",                                // Keyword gate fails → Colon + General
		":overflow",
		"~mapp",                               // Comprehension gate fails → General (tilde-leading arm)
		"~maps",
		"~fol",
		"defx",                                // Keyword gate fails → General
		"defns",
		"deftype",
		"trueish",                             // Native gate fails → General
		"falsey",
		"emptyx",
		"Maybex",                              // Builtin gate fails → General
		"IOs",
		"intx",                                // Keyword gate fails on "intx" → General

		// Grammar.md block 3: identifier shape near-misses (tilde-decorated)
		// Probes the reserved-set gate fallthrough to General when an
		// IdentBody match's surface shape *almost* matches a reserved
		// form but the matched span doesn't pass the gate.
		"123a",                                // digit-leading General (Grammar.md form)
		"a123",                                // alpha + digit tail
		"123~",                                // digit-leading + trailing tilde
		"~123",                                // tilde + digits — tilde-alpha arm fails (1 not alpha) → Tilde + PositiveIntegerLit
		"Value~",                              // Builtin-shaped + trailing tilde → gate fails → General
		"~Value",                              // tilde-alpha start, not a comprehension → General
		"empty~",                              // Native-shaped + trailing tilde → gate fails → General
		"~empty",                              // tilde-alpha start, not a comprehension → General (not BooleanOper-shaped either)
		"int~",                                // Keyword-shaped + trailing tilde → gate fails → General
		"~int",                                // tilde-alpha start, not a comprehension → General
		"~eachA",                              // Comprehension-shaped + extra suffix → gate fails → General
		"~each~",                              // Comprehension-shaped + trailing tilde → gate fails → General
		"a~each",                              // mid-identifier tilde inside General (IdentCont includes ~)
		"~Value~",                             // both ends tilded
		"~empty~",

		// Same shapes in def/defn context — probes surrounding-token boundaries.
		"def 123~: empty;",                    // does `~:` split cleanly into Tilde + Colon?
		"def ~123: empty;",                    // Tilde + PositiveIntegerLit followed by `: empty`
		"def Value~: empty;",
		"def ~empty: empty;",                  // first `~empty` → General; second `empty` → Native
		"def a~each: empty;",                  // single identifier across the tilde
		"defn ~each~() ^empty;",

		// Specializations
		"empty",
		"true",
		"Maybe",
		"~each",

		// Boolean named ops & keyword extension
		"?and",
		"!or",
		":as",
		":foo",                                // Keyword gate fails on ":foo" → Colon + General
		":over",
		"?in",
		"!has",
		"?empty",                              // unary-named-op form

		// Multi-char ops
		"::",
		"...",
		"..",
		"..5",                                 // DoublePeriod + PositiveIntLit
		"...5",                                // TriplePeriod + PositiveIntLit

		// Strings
		`"hello"`,
		`""`,
		`"foo bar baz"`,
		`" "`,                                 // single space

		// Interpolated strings
		'`"hello"',
		'`""',
		'`"hi `42`!"',
		'`"`name`!"',
		'`"a `x + 1` b"',

		// Nested InterpExpr
		'`" `a` "',                            // simple embed (spaces around to disambiguate)
		'`" `foo(x, y)` "',                    // call inside embed
		'`" `\\h2A` "',                        // KNOWN_DIVERGENT — legacy Whitespace/String inconsistency
		'\\`" this is `\\`"my friend, `name`"`!"',  // cross-form nested interp (spacing-in-spacing via escape openers)
		'`"a `\\`"b"` c"',                     // cross-form nested interp (spacing-inside-plain)

		// Spacing-form interp strings
		'\\`"hello"',
		'\\`""',
		'\\`"a b"',
		'\\`"hi `42`!"',
		'\\`"a `x + 1` b"',

		// Escaped strings
		'\\"hello"',
		'\\""',
		'\\"a b"',
		'\\"hello world foo"',

		// STRING_ESCAPED_CHAR cases
		'""""',
		'"a"""',
		'"""b"',
		'"a""b"',
		'\\""""',
		'\\"hello"""',
		'\\"""world"',
		'\\"hello""world"',
		'`"``"',
		'`"a``"',
		'`"``b"',
		'`"a``b"',
		'`""""',
		'`"a"""',
		'`"""b"',
		'`"a""b"',
		'\\`"``"',
		'\\`"a``"',
		'\\`"``b"',
		'\\`"a``b"',
		'\\`""""',
		'\\`"a"""',
		'\\`"""b"',
		'\\`"a""b"',

		// Grammar.md block 10: @-call form variants.
		// `@` is a standalone SingleCharOp at lex; whether it adheres
		// to a preceding identifier as part of an AtExpr is a syn-level
		// concern. At lex we just verify the surrounding tokens come
		// out cleanly across all the spacing variants.

		// Bare @ (monad constructor):
		"f(@)",                                // ident + ( + @ + )
		"f(@2)",                               // @ immediately followed by digit
		"f(@ 2)",                              // @ + space + digit
		"f(@(2))",                             // @ + grouped operand
		"f(@ (2))",                            // @ + space + grouped operand

		// Builtin-prefixed @ (Id@, etc.):
		"f(Id@)",                              // adjacent
		"f(Id@2)",                             // adjacent + digit (no space)
		"f(Id @2)",                            // space before @, digit adjacent
		"f(Id@ 2)",                            // adjacent @, space before digit
		"f(Id @ 2)",                           // spaces on both sides
		"f(Id@(2))",
		"f(Id@ (2))",
		"f(Id @ (2))",

		// Dotted Builtin + @ (Either.Right@, etc.):
		"f(Either.Right@)",
		"f(Either.Right@2)",
		"f(Either.Right @2)",
		"f(Either.Right@ 2)",
		"f(Either.Right @ 2)",
		"f(Either.Right@(2))",
		"f(Either.Right@ (2))",
		"f(Either.Right @ (2))",

		// None@ — special-cased in syn's AtCallExpr but plain at lex:
		"None@",
		"f(None@)",

		// Grammar.md block 11: :as annotation forms.
		// `:as` is a Keyword(extension form) token at lex. Probes
		// adjacency with the various AsAnnotationExpr call sites:
		// after literals, grouped exprs, binary exprs, match results.

		// Basic :as on operand expressions:
		"(*)(getQty(order,item), getPrice(item)) :as float",
		"?3 :as bool",
		"?(3) :as bool",
		"?(3):as bool",                        // no-space — does `):as` split cleanly?
		"3 * 2 :as int",
		"3 * (2 :as int)",
		"(3 * 2) :as int",
		"(3 * 2):as int",                      // no-space close-paren + :as
		"3 ?as bool",                          // NOTE: ?as, not :as — BooleanOper, not Keyword

		// :as on match results (Grammar.md spread):
		"(?(x){ ?[?as int]: f(#) :as bool; ?: # :as bool }):as bool",

		// :as variants from across the file:
		"def x: 5 :as int;",                   // :as in def-binding
		"defn f(x:0) :as Whatever { ^x };",    // :as as FuncAsClause (one token, multi-arg form)
		"defn add(x)(y) :as Adder { ^x + y };", // currying + :as
		"x :as int",                           // bare :as on identifier
		"foo :as List",                        // :as Builtin
		"<1,2,3> :as Tuple",                   // :as on data struct lit
		"\"hi\" :as string",                   // :as on string

		// :as adjacency with newlines and trivia:
		"x\n:as int",                          // newline before :as
		"x :as\nint",                          // newline after :as
		"x:as int",                            // no-space (probes Keyword gate behavior on bare identifier + :as)

		// Grammar.md block 5: complex strings.
		// Stress-tests the four string forms in realistic combinations —
		// multiline content, deeply nested interps, embedded escapes.

		// Multiline basic strings:
		'"Hello, ""Santa""!"',                 // doubled-DQ escape (already covered, but in context)
		'"Here\'s a\n   multiline string"',    // multiline plain
		'\\"A single line\n    string with whitespace collapsing, defined across multiple\n  lines"',
		'\\`"A single line (with\n   whitespace collapsing), and a single `` backtick"',

		// The Grammar.md "kitchen sink" interp string — all four forms
		// nested across multiple lines with embedded escapes and numbers:
		'`"Special number: `-3.1415962`\n   Name: `name`\n   Greeting: `\\`"Hello world"`\n   Reaction: `\\"Yay!"`\n   Reply: `"Ok."`\n!"',

		// Grammar.md block 6: data structure literals.
		// Records / Tuples / Sets at lex are just angle/bracket tokens
		// around content tokens. Probes that the angle bracket disambiguation
		// (vs. comparison ops) and the bracket-inside-angle (set form)
		// tokenize cleanly across realistic content.

		"<>",                                  // empty record
		"<  >",                                // empty record with internal whitespace
		"<true>",                              // single Native
		"<1,2,3>",                             // tuple, no spaces
		"<a:1>",                               // record, concise
		"< a: 1, b: \"ok\" >",                 // record, spaced, mixed content
		"<[]>",                                // empty set
		"<[ 1, 2, 2 ]>",                       // set with dupes

		// The Grammar.md "kitchen sink" record:
		"<\n    ,,&v.x.[3..].<a,b> , \"Hello\" , 3,,4, :foo,\n    yes: empty, fn(1),\n    %x.y.z: false,\n    %\"Hello World\": 2,\n    %\\`\" this\n    is `adverb` \"\"crazy\"\"!\": 42,\n    %bar:<1>,,\n>",

		// Computed-property name forms (% prefix):
		"%x",                                  // bare % + ident
		"%x.y",                                // % + access chain
		"%\"key\"",                            // % + string
		"%`\"key`x`\"",                        // % + interp string
		"%\\`\"key`x`\"",                      // % + spacing interp string

		// Set literal with realistic content:
		"<[ 1, 2, 3, ]>",                      // trailing comma
		"<[true, false, empty]>",              // Native-only set
		"<[a, b, c]>",                         // identifier-only set
		"<&v, 1, 2>",                          // PickValue + tuple values

		// Range expressions inside data structs:
		"[1..3]",                              // closed range
		"[1..]",                               // leading range
		"[..3]",                               // trailing range
		"x.[1..3]",                            // dot-bracket access with range
		"v.x.[3..]",                           // chained access ending in range

		// Grammar.md block 12: deft (type definitions).
		// Syn-deferred (§18) but lex should tokenize cleanly. Probes
		// the Keyword('deft') + identifier + type-grammar punctuation
		// across all Grammar.md type-form variants.

		"deft F (?X) ^G",                      // simple func type with optional param
		"deft X(Y,Z) ^empty",                  // func type → Native('empty')
		"deft Y(_) ^Either",                   // _ as identifier; ^ + Builtin
		"deft Z() ^Either",                    // empty param list
		"deft W <\n    a: Q,\n    b: S | int,\n    c: U | {(*string) ^{bool|42}},\n    d: < int, string, *bool, >,\n    *< int, int >,\n>",  // record type with union, nested types, gather param
		"deft Q(R) ^PushStream",
		"deft R(_) ^PushStream",
		"deft S(T) ^ PushStream",              // space after ^
		"deft T(*_)^ _",                       // gather + naked underscore
		"deft U(int, string, *float) ^bool",   // native types in arg list
		"deft V Left | Right",                 // bare union, no parens
		"deft A { Left | Right }",             // grouped union
		"deft B(str, *{(int)^int}) ^{\"yes\"|\"no\"}",  // nested func type + string union

		// Standalone import/export forms (Grammar.md block 13) — currently
		// unprobed in test.js. Should be uneventful at lex.
		"def x: import \"X\";",
		"def < :log >: import \"#Std\";",
		"export { :x, :y, z: zzz, };",
		"export { :login, :logout };",
		"export { doLogin: login, doLogout: logout };",

		// Grammar.md block 1: recognized whitespace characters.
		// The exotic-whitespace blob — U+0085, U+200B-F, U+2028/9, etc.
		// Probes that every code point in WHITESPACE_CHARS lexes as
		// Whitespace rather than General or failing outright.
		"\u0009\u000a\u000b\u000c\u000d\u0020\u0085\u00a0\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u200b\u200c\u200d\u200e\u200f\u2028\u2029\u202f\u205f\u3000\ufeff",

		// Grammar.md block 2 extras: comment-inside-statement forms.
		"def a: 1;",
		"def b:1; // hello",                   // line comment trailing
		"def c  :   1 ; ;;",                   // extra whitespace + extra semis
		"def d: /// hello\n/// 3;",            // block comment inside def-value position
		"def /// e: 3;///  f: 4;",             // block comment between def and ident

		// Grammar.md block 8: the kitchen-sink defn with nested matches,
		// guards, assignments, indep + dep match forms, function calls,
		// dot-access chains, partial calls, op-as-function, range access.
		"defn add(x)(y,<:z>)\n    ?[x.y]: y(z[2])\n    ![x]: z(3)\n    :over(z, w)\n    :as Whatever\n{\n    z := 2;\n    ?{?: 42;};\n    ?{\n        ?[z]: fn(g);\n        [w]: w;\n        ![x]: { fn(g) };\n        ?[y]: (v, <:z>) { fn(g); }\n        ?: 42\n    };\n    ?( fn(g) ){\n        [?> y]: g;\n        ?[ x, z . y [3] ]: g\n    };\n    ?{ ?[x]: x };\n    ?(x){ ?[x]: x };\n    ?{ ?[x]: x; ?[y]: y };\n    ?(x){ ?[x]: x; ?[y]: y };\n    ?[z]: (g: z) { fn(g) };\n    x.[y..z];\n    y.<first,last>;\n    (+)(1,2,3,...nums);\n    (+')'(1,,3);\n    (')(+)(1,,3);\n    myFn|2,,3|;\n    myFn(3,x:2);\n    myFn'|3,x:2|;\n    ^42\n}",

		// Grammar.md block 8b: comprehensions + pipelines spread.
		"1..3 ~each log",
		"?[x] ~each (x,y:2) { x }",
		"foo ~map ![x] ~each foo",             // chained named comprehension ops
		"x . y [3].[1..3] .<a,b,> ~filter { y }",  // access chain + filter
		"x #> (y(#.y,2) #> z)",                // pipeline chain with topic
		"def cb1: f(2) +> g +> h(3)(4);",      // compose-right chain
		"def cb2: f(2) <+ g <+ h(3)(4);",      // compose-left chain
		"def cb3: f +> (defn(v) ^v) +> g;",    // compose with inline defn
		"defn myFn(x) #> f(#..3);",            // FuncBodyPipeline with topic + range
		"2..4 #> { f(#.0) }",                  // range piped to block

		// Grammar.md block 9: do-comprehensions + ~<* loop comprehensions.
		"List ~<< {\n    def x:: getSomething();\n    def y: uppercase(x);\n    def z:: another(y);\n    z.0\n}",
		"IO ~<< (x:: getSomething()) {\n    def y: uppercase(x);\n    def z:: another(y);\n    ::prepareValue(z);\n}",
		"Promise ~<* {\n    def respE:: getSomething();\n    Either ~<< (resp:: respE) {\n        printResp(resp);\n    };\n}",
		"urls ~map fetch ~<* (resp) {\n    def v:: processResp(resp);\n    def success:: storeVal(v);\n    ?[success]: log(v);\n}",

		// Hyphen-as-sign disambiguation — basic
		"-5",
		"5-3",
		"5 - 3",
		"x-5",
		"(5)-3",
		"5+-3",
		"-x",

		// expressionEnding tail — full coverage of wrapped types
		"def-5",                               // Keyword (bare form)
		":as-3",                               // Keyword (extension form)
		"true-5",                              // Native
		"false-3",
		"empty-7",
		"Maybe-3",                             // Builtin
		"IO-1",
		"List-9",
		"~map-5",                              // Comprehension
		"~each-1",
		"~fold-3",
		"?and-5",                              // BooleanOper
		"!or-3",
		"?has-2",
		"foo-5",                               // General
		"x-3",
		")-3",                                 // CloseParen
		"}-3",                                 // CloseBrace
		"#-5",                                 // Hash
		"|-5",                                 // Pipe

		// expressionEnding tail — trivia between expression end and binary hyphen
		"foo  -5",                             // whitespace
		"foo\t-5",                             // tab whitespace
		"foo //c\n-5",                         // KNOWN_DIVERGENT — Comment in trivia
		"foo /// c ///-5",                     // KNOWN_DIVERGENT — block Comment in trivia
		"foo // c1\n  // c2\n  -5",            // KNOWN_DIVERGENT — multi Comments
		"(5)  -3",
		"42  -3",
		"42 // c\n-3",                         // KNOWN_DIVERGENT — Comment in trivia

		// expressionEnding tail — non-fire cases (no -Digit ahead)
		"foo - x",                             // hyphen between idents, no digit after
		"foo -",                               // trailing hyphen, no digit
		"foo -x",                              // hyphen + non-digit
		"foo- 5",                              // hyphen adjacent to ident, digit after space

		// Grammar.md block 7: operator boundary soup.
		// Probes ExprEndingTail across no-space adjacencies and the
		// full symbolic comparison spread. Most should be clean —
		// the named-vs-symbolic boundaries are where surprises lurk.

		// Basic binary expressions, no-whitespace forms:
		"2+3+4",                               // chained adds, no spaces
		"2 + 3 + 4",                           // chained adds, spaced
		"(2 + 3) + 4",
		"2 + (3 + 4)",
		"x + y + true",                        // operand mixed with Native

		// Unary prefix forms, with/without space:
		"?x",                                  // no-space symbolic unary
		"? x",                                 // spaced symbolic unary
		"?(x)",                                // grouped operand
		"!x",
		"! x",
		"!(x)",
		"?empty y",                            // named unary, spaced
		"?empty(y)",                           // named unary, grouped

		// Named boolean ops:
		"x ?and y !and z",
		"(x ?and !y) !or (z / 2)",
		"(x ?and !y)!or(z/2)",                 // no-space close-paren + named-op + open-paren

		// Symbolic comparison spread (longest-first PEG ordering at the syn layer,
		// but at lex these are just bare single-char tokens — verifying no
		// premature multi-char absorption):
		"x ?in y",
		"x ?has y",
		"x?>y",                                // no-space
		"x ?> y",
		"x ?= y",
		"x != y",                              // Exmark + Equal — NOT a BooleanOper (`?and`/`!and`/etc. only)
		"x ?$= y",
		"x !$= y",
		"x ?<=> y",                            // longest symbolic comparison form
		"x !<=> y",
		"x ?<= y",
		"x ?>= y",
		"x ?<> y",
		"x ?< y",
		"x ?> y",                              // dup of above; second pass catches any ordering issue

		// OpFunc with prime modifiers (Grammar.md):
		"(+)(1,2,3)",                          // op-as-function, prefix call
		"(+')(1,6)",                           // reversed
		"(-')(1,6)",
		"(')(-)(1,6)",                         // prime as standalone op
		"(+')'(1,,3)",                         // prime after prime
		"(')(+)(1,,3)",
		"myFn|2,,3|",                          // partial call with skipped args
		"myFn(3,x:2)",                         // named arg
		"myFn'|3,x:2|",                        // reversed + partial + named

		// numberEnding scope probe: which tokens get the "..." → ".." + "."
		// rewrite when followed by three dots? New currently wraps only
		// PositiveIntegerLit and NumberLit. These probes reveal whether
		// legacy applies the same rule more broadly.
		"5...args",                            // PositiveIntegerLit (numberEnding active)
		"12.5...args",                         // NumberLit (numberEnding active)
		"foo...args",                          // General
		")...args",                            // CloseParen
		"}...args",                            // CloseBrace
		"#...args",                            // Hash
		"|...args",                            // Pipe
		"true...args",                         // Native
		"Maybe...args",                        // Builtin
		"~map...args",                         // Comprehension
		"?and...args",                         // BooleanOper
		"def...args",                          // Keyword

		// Mixed
		`def x: "hi";`,
		'def msg: `"hello, `name`!";',

		// Combinatorial multi-token sequences
		"def x: -42;",                                 // negative literal in def
		"def y: x + -1;",                              // binary minus then negative literal
		"def z : 42 ;",                                // spaces around colon and semicolon
		"defn safe(a) ?[a > 0]: a;",                   // function with guard precond
		"defn impl() :over (List) ^v;",                // :over clause
		"defn add(a,b) ?[a > 0]: a + b; ^0;",          // multiple body forms
		"[1..10]",                                     // closed range
		"<1, 2, 3>",                                   // tuple literal
		"<[1, 2, 3]>",                                 // set literal
		"foo(...args)",                                // spread arg
		"foo(:name, age: 30)",                         // named args
		"data #> filter |#, isValid|",                 // pipeline + partial
		"?{ ?[x > 0]: pos; ?: zero }",                 // independent match
		"?(x) { [1]: \"one\"; [2]: \"two\"; ?: \"other\" }",  // dependent match
		"Maybe ~<< { ::42 }",                          // do-comprehension
		"[1..10] ~<* { ^v + 1 }",                      // do-loop comprehension
		'import "./foo";',                             // import
		"export { x, y: foo };",                       // export
		"def <:a, :b>: point;",                        // destructure (concise)
		"def f: 1 + 2 - 3 * 4 / 5;",                   // operator precedence soup
		"def n: \\hFF_FF;",                            // escaped hex with underscore-bearing tail — General fallback in EscapedNumber resolves
		'def msg: \\`"hi `name`!";',                   // spacing interp in def
		"x.foo.bar",                                   // dot access chain
		"x.<a, b, c>",                                 // dot-angle access
		"x.[1..3]",                                    // dot-bracket access
		"foo()()",                                     // chained calls
		"foo|a, b|()",                                 // partial then call
		"foo@ bar",                                    // at-call form
		"~each !{ x > 0 }",                            // ~each with NamedUnaryExpr-shaped body

		// Sample Foi source: audio player module (~90 lines).
		// First real-world .foi file through the lex harness — probes the
		// realistic distribution of token shapes rather than the dense
		// pathological forms that dominate the rest of the samples.
		`export {
		  :playlist, :clear, :play, :resume, :pause, :stop,
		  :onPlay, :onTimeUpdate, :onPause, :onStop,
		};

		def queue: <>;
		def player: Audio();

		defn onPlayNext(url) ^<>;
		defn next() ^playlist(queue, false, false, onPlayNext);
		defn nextLoop() ^playlist(queue, false, true, onPlayNext);

		defn playlist(
			urls,
			clear: false,
			loop: false,
			onNext: onPlayNext
		  )
		  :over(queue,onPlayNext)
		{
		  def cb: next;
		  ?[loop]: cb := nextLoop;

		  onPlayNext := onNext;
		  ?[clear]: queue := < &urls >;

		  ?{
			?[size(queue) ?= 0]: {
			  def upcoming: queue.[1..];
			  ?[loop]: queue := < &queue, upcoming >;

			  player.src(upcoming);
			  player.removeEventListener("ended", cb);
			  player.addEventListener("ended", cb);
			  player.play();
			  ?[size(queue) ?> 0]: onNext(upcoming)
			};
			?:
			  player.removeEventListener("ended", cb)
		  }
		};

		defn clear() :over(queue) {
		  queue := <>;
		  player.removeEventListener("ended", next)
		};

		defn play(url) {
		  stop();
		  player.src(url);
		  player.play()
		};

		defn resume() ^player.play();

		defn pause() ^player.pause();

		defn stop() {
		  player.pause();
		  player.currentTime(0);
		  clear()
		};

		defn onPlay(action) {
		  defn cb() ^action(player.src);
		  player.addEventListener("play", cb);
		  ^defn() ^player.removeEventListener("play", cb)
		};

		defn onTimeUpdate(action) {
		  defn cb() ^action(player.src, player.currentTime);
		  player.addEventListener("timeupdate", cb);
		  ^defn() ^player.removeEventListener("timeupdate", cb)
		};

		defn onPause(action) {
		  defn cb() ^action(player.src);
		  player.addEventListener("pause", cb);
		  ^defn() ^player.removeEventListener("pause", cb)
		};

		defn onStop(action) {
		  defn cb() ^action(player.src);
		  player.addEventListener("ended", cb);
		  ^defn() ^player.removeEventListener("ended", cb)
		};`,

		// Sample Foi source: Promise/PromiseSubject sketch (~150 lines).
		// Denser than the audio player — exercises deft type definitions
		// in realistic positions, :over clauses, +> composition with
		// partial-call inside, ?and chains in match clauses, nested
		// defn returns after ^publicAPI, and :as annotations across
		// function definitions.
		`///
		NOTE: this is a sketch of how Promise/PromiseSubject,
		and some associated utilities (all, race) can be
		written in Foi. It's included here because it
		demonstrates a broad cross-section of Foi's various
		features/syntax.
		///

		// type definitions
		deft PromiseConstructor(?Init) ^Promise;
		deft Init(Resolve) ^empty;
		deft Resolve(any) ^Either;
		deft Promise <
			chain: Chain,
			map: Map,
			resolved: Resolved,
		>;
		deft Chain(ChainCB) ^Promise;
		deft ChainCB(any) ^Promise;
		deft Map(MapCB) ^Promise;
		deft MapCB(any) ^any;
		deft Resolved() ^bool;
		deft Race(List{Promise}) ^Promise;
		deft All(List{Promise}) ^Promise;
		deft PromiseSubjectUnitConstructor() ^PromiseSubject;
		deft PromiseSubject <
			pr: Promise,
			resolve: Resolve,
		>;
		deft PromiseUnitConstructor(any) ^Promise;


		// module-local variables
		def subscribers: <>;


		// module-local functions
		defn subscribe(pr,cb) :over (subscribers) {
			?{
				?[subscribers ?has pr]: {
					def cbs: subscribers[pr] $+ < cb >;
					subscribers := < &subscribers, %from: cbs >;
				}
				?: {
					subscribers := < &subscribers, %pr: < cb > >;
				}
			};
		};

		defn notifyValue(pr,v)
			![subscribers ?has pr]: Left@ "No subscribers"
		{
			subscribers[stream] ~each (cb) {
				cb(v);
			};
			^Right@ true;
		};

		defn race(prs)
			![size(prs) ?> 0]: Promise@ (Left@ "Empty list of promises")
			:as Race
		{
			def subj: PromiseSubject@;
			prs ~each (pr) {
				pr ~map subj.resolve;
			};
			^subj.pr;
		};

		defn all(prs)
			![size(prs) ?> 0]: Promise@ (Left@ "Empty list of promises")
			:as All
		{
			def subj: PromiseSubject@;
			def resCount: 0;
			def res: <>;
			prs ~each (pr,idx) {
				pr ~map (v) {
					resCount := resCount + 1;
					res := < &res, %idx: v >;
					?[resCount ?= size(prs) ?and !subj.pr.resolved()]: {
						subj.resolve(res);
					};
				};
			};
			^subj.pr;
		};

		defn PromiseSubject@()
			:as PromiseSubjectUnitConstructor
		{
			def resolve: empty;
			def pr: Promise(
				defn(res) :over (resolve) { resolve := res; }
			);
			^< :pr, :resolve >;
		};

		defn Promise@(v)
			?[?empty v]: Promise()
			:as PromiseUnitConstructor
		{
			def subj: PromiseSubject@;
			subj.resolve(v);
			^subj.pr;
		};

		defn Promise(initFn)
			:as PromiseConstructor
		{
			def value: empty;
			def pending: true;
			def publicAPI: <
				:chain,
				:map,
				:resolved,
			>;
			?[initFn ?as Init]: initFn(resolve);
			^publicAPI;

			// **************************

			defn resolve(v)
				![pending]: Left@ "Promise already resolved"
				:over (value,pending)
				:as Resolve
			{
				value := v;
				pending := false;
				notifyValue(publicAPI,value);
				^Right@ v;
			};

			defn chain(fn)
				![pending]: fn(value)
				:as Chain
			{
				def subj: PromiseSubject@;
				subscribe(publicAPI,fn +> |~map ,subj.resolve|);
				^subj.pr;
			};

			defn map(fn)
				![pending]: Promise@ fn(value)
				:as Map
			{
				def subj: PromiseSubject@;
				subscribe(publicAPI,fn +> subj.resolve);
				^subj.pr;
			};

			defn resolved() :as Resolved ^!pending;
		};`,
	];

	let cleanPass    = 0;   // ✓ unmarked + clean
	let expectedFail = 0;   // ⚠ marked   + dirty
	let unexpected   = 0;   // ✗ unmarked + dirty (regression)
	let staleMark    = 0;   // ? marked   + clean (divergence resolved)
	let totalMatches = 0;
	let totalTokens  = 0;

	for (let s of samples) {
		let d = await diff(s);
		let marked = KNOWN_DIVERGENT.has(s);
		let dirty  = d.diffs.length > 0;
		totalMatches += d.matches;
		totalTokens  += d.total;

		if (!marked && !dirty) {
			cleanPass++;
			console.log(`✓ ${safeShow(s).padEnd(40)} ${d.summary}`);
		}
		else if (marked && dirty) {
			expectedFail++;
			console.log(`⚠ ${safeShow(s).padEnd(40)} ${d.summary}  [expected: ${KNOWN_DIVERGENT.get(s)}]`);
		}
		else if (!marked && dirty) {
			unexpected++;
			console.log(`✗ ${safeShow(s).padEnd(40)} ${d.summary}`);
			for (let ev of d.diffs.slice(0, 4)) {
				let o = ev.orig
					? `${ev.orig.type}=${safeShow(ev.orig.value)}`
					: "<none>";
				let n = ev.new
					? `${ev.new.type}=${safeShow(ev.new.value)}`
					: "<none>";
				console.log(`    [${ev.index}] orig: ${o}`);
				console.log(`        new:  ${n}`);
			}
		}
		else {
			// marked && !dirty — divergence resolved; the map entry is stale.
			staleMark++;
			console.log(`? ${safeShow(s).padEnd(40)} ${d.summary}  [marked divergent but matched cleanly — remove from KNOWN_DIVERGENT]`);
		}
	}

	console.log("");
	console.log(`── ${cleanPass} clean, ${expectedFail} expected-divergent, ${unexpected} unexpected-divergent, ${staleMark} stale-mark  /  ${totalMatches}/${totalTokens} tokens matched`);

	let passes = cleanPass + expectedFail;
	let fails  = unexpected + staleMark;
	if (fails === 0) {
		console.log(`── all ${passes} samples passing`);
	}
	else {
		console.log(`── ${passes} passing, ${fails} failing`);
	}
}

function safeShow(str) {
	return str.replace(/\n/g, "\\n");
}
