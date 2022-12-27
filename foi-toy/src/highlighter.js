"use strict";

const {
	OPERATORS,
	NATIVES,
	KEYWORDS,
	BUILTINS,
	COMPREHENSIONS,
	BOOLEAN_NAMED_OPERATORS,
	WHITESPACE,
} = require("./tokenizer.js");

module.exports = {
	highlight,
};
module.exports.highlight = highlight;


// **********************

async function *highlight(tokens) {
	for await (let token of tokens) {
		if (token.type == "WHITESPACE") {
			yield token.value;
		}
		else {
			// make the code HTML safe
			let value = token.value
				.replace(/&/g,"&amp;")
				.replace(/</g,"&lt;")
				.replace(/>/g,"&gt;");

			// determine CSS class to use for
			// highlighting each token type
			let className = (
				(
					[
						"COMMENT", "DOUBLE_QUOTE", "OPEN_PAREN",
						"CLOSE_PAREN",
					].includes(token.type)
				) ? "t0" :

				(token.type == "GENERAL") ? "t1" :

				(
					[ "STRING", "STRING_ESCAPED_CHAR" ]
						.includes(token.type)
				) ? "t2" :

				(
					[ "ESCAPE", "OPEN_BRACE", "CLOSE_BRACE" ]
						.includes(token.type)
				) ? "t3" :

				(token.type == "BUILTIN") ? "t4" :

				(token.type == "NATIVE") ? "t5" :

				(
					token.type == "KEYWORD" ||
					[
						"COLON", "DOUBLE_COLON", "SEMICOLON", "COMPREHENSION",
						"BOOLEAN_OPER",
					]
						.includes(token.type)
				) ? "t6" :

				(token.type == "NUMBER") ? "t7" :

				(OPERATORS.includes(token.type)) ? "t8" :

				// unassigned default, shouldn't happen
				"oops"
			);

			yield `<i class="${className}" title="${token.type}">${value}</i>`;
		}
	}
}
