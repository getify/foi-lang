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
		if (tok.type === "PositiveIntegerLit") {
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
