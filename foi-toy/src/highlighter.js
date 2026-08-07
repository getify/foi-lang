import { OPERATOR_TYPES, } from "./fast-tokenizer.js";

export { highlight, };
export default highlight;


// **********************

// Token-type buckets, keyed to the CSS classes in tmpl.css and
// syntax-color.html. Checked most-specific first: several of these
// types are also in OPERATOR_TYPES (Colon, Semicolon, OpenParen,
// OpenBrace, DoubleQuote, Escape), so the operator arm must come
// last or it would swallow them.
const DELIMITER_TYPES = new Set([
	"Comment", "DoubleQuote", "Backtick", "OpenParen", "CloseParen",
]);
const STRING_TYPES = new Set([ "String", "StringEscapedChar", ]);
const ESCAPE_TYPES = new Set([ "Escape", "OpenBrace", "CloseBrace", ]);
const KEYWORD_TYPES = new Set([
	"Keyword", "Colon", "DoubleColon", "Semicolon",
	"Comprehension", "BooleanOper",
]);
const NUMBER_TYPES = new Set([
	"PositiveIntegerLit", "NegativeIntegerLit", "Number",
]);


async function *highlight(tokens) {
	for await (let token of tokens) {
		if (token.type == "Whitespace") {
			yield token.value;
			continue;
		}

		// make the code HTML safe
		let value = token.value
			.replace(/&/g,"&amp;")
			.replace(/</g,"&lt;")
			.replace(/>/g,"&gt;");

		yield `<i class="${classFor(token.type)}" title="${token.type}">${value}</i>`;
	}
}

function classFor(type) {
	return (
		DELIMITER_TYPES.has(type) ? "t0" :

		(type == "General") ? "t1" :

		STRING_TYPES.has(type) ? "t2" :

		ESCAPE_TYPES.has(type) ? "t3" :

		(type == "Builtin") ? "t4" :

		(type == "Native") ? "t5" :

		KEYWORD_TYPES.has(type) ? "t6" :

		NUMBER_TYPES.has(type) ? "t7" :

		OPERATOR_TYPES.has(type) ? "t8" :

		// unassigned default, shouldn't happen
		"oops"
	);
}
