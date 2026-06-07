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


// Streaming diff. Walks the legacy stream and the new tokenizer
// stream in lockstep, yielding one event per position:
//   { kind: "match", index, token }
//   { kind: "diff",  index, orig, new }
// Generator returns when both streams are exhausted.
export async function *diffStream(input) {
	var origIter = normalizeOrigStream(origTokenize(input));
	var newIter  = tokenize(input);

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
// SMOKE TEST (runs only if this file is invoked directly)
// =============================================================

if (import.meta.url === `file://${process.argv[1]}`) {
	let samples = [
		// Basics
		"foo",
		"foo bar",
		"def x: 42;",
		"defn add(a,b) ^a + b;",
		// Comments
		"//line\n42",
		"///block///x",
		// Numbers
		"123",
		"12.5",
		"12..5",
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
		// Identifiers with tilde
		"~map",
		"~map foo",
		"foo~bar",
		"~foo",
		// Specializations
		"empty",
		"true",
		"Maybe",
		"~each",
		// Boolean named ops & keyword extension
		"?and",
		"!or",
		":as",
		":foo",
		// Multi-char ops
		"::",
		"...",
		// Strings
		`"hello"`,
		`""`,
		// Interpolated strings
		'`"hello"',
		'`""',
		'`"hi `42`!"',
		'`"`name`!"',
		'`"a `x + 1` b"',
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
		// Hyphen-as-sign disambiguation
		"-5",
		"5-3",
		"5 - 3",
		"x-5",
		"(5)-3",
		"5+-3",
		"-x",
		// Mixed
		`def x: "hi";`,
		'def msg: `"hello, `name`!";',
	];

	let totalMatches = 0;
	let totalTokens  = 0;
	let cleanSamples = 0;
	let dirtySamples = 0;

	for (let s of samples) {
		let d = await diff(s);
		totalMatches += d.matches;
		totalTokens  += d.total;
		if (d.diffs.length === 0) {
			cleanSamples++;
			console.log(`✓ ${safeShow(s).padEnd(28)} ${d.summary}`);
		}
		else {
			dirtySamples++;
			console.log(`✗ ${safeShow(s).padEnd(28)} ${d.summary}`);
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
	}

	console.log("");
	console.log(`── ${cleanSamples} clean, ${dirtySamples} dirty  /  ${totalMatches}/${totalTokens} tokens matched`);
}

function safeShow(str) {
	return str.replace(/\n/g, "\\n");
}
