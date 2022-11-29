"use strict";

var util = require("util");
var path = require("path");
var fs = require("fs");
var args = require("minimist")(process.argv.slice(2));

const OPERATORS = [
	"BACKTICK", "TILDE", "EXMARK", "HASH", "DOLLAR", "PERCENT",
	"CARET", "AMPERSAND", "STAR", "PLUS", "EQUAL", "AT", "HYPHEN",
	"OPEN_BRACKET", "CLOSE_BRACKET", "PIPE", "COLON", "SEMICOLON",
	"SINGLE_QUOTE", "OPEN_ANGLE", "CLOSE_ANGLE", "COMMA", "PERIOD",
	"DOUBLE_PERIOD", "TRIPLE_PERIOD", "QMARK", "FORWARD_SLASH",
];
const NATIVES = [ "empty", "true", "false", ];
const KEYWORDS = [
	"def", "defn", "deft", "import", "export", "as", "over", "int",
	"integer", "float", "bool", "boolean", "string",
];
const BUILTINS = [
	"Id", "None", "Maybe", "Left", "Right", "Either", "Promise",
	"PromiseSubject", "PushStream", "PushSubject", "PullStream",
	"PullSubject", "Channel", "Gen", "IO", "Value", "Number", "List",
];
const COMPREHENSIONS = [
	"~each", "~map", "~filter", "~fold", "~foldR", "~cata",
	"~chain", "~bind", "~flatMap",
];
const BOOLEAN_NAMED_OPERATORS = [
	"and", "or", "as", "in", "has", "empty",
];

main();


// **********************

function main() {
	if (!args.file) {
		console.log("Foi-Toy: experimental Foi tool");
		console.error("Missing --file=.. parameter.");
		return;
	}

	// allow Node to print out the entire array
	util.inspect.defaultOptions.maxArrayLength = null;

	var fileContents = fs.readFileSync(path.resolve(process.cwd(),args.file),"utf-8");
	var tokens = [ ...tokenize(fileContents) ];

	if (args.color) {
		let html = highlight(tokens);
		console.log(html);
	}
	else {
		console.log(tokens);
	}
}

function *tokenize(str) {
	var lastIdx = 0;
	var POP_STATE = Symbol("pop-state");
	var currentState = [ { type: "base", context: null, }, ];
	var prevState = null;
	var escapeToken = null;
	var pendingToken = null;
	var pendingToken2 = null;
	var stateHandlers = {
		base,
		string,
		escapedString,
		escapedNumber,
		interpolatedBase,
		comment,
	};

	for (let [idx,char] of Object.entries(str)) {
		idx = Number(idx);
		let charTokenized = false;

		while (!charTokenized) {
			let state = currentState[currentState.length-1];
			let [ nextToken, nextState ] =
				stateHandlers[state.type](char,idx) || [];

			// token to handle?
			if (nextToken != null) {
				charTokenized = true;

				// new token to emit?
				if (![ pendingToken, pendingToken2 ].includes(nextToken)) {
					// need to defer a second token?
					if (
						pendingToken != null &&
						pendingToken2 == null &&
						(
							(
								pendingToken.type == "NUMBER" &&
								nextToken.type == "PERIOD"
							) ||
							(
								[ "QMARK", "EXMARK" ].includes(pendingToken.type) &&
								nextToken.type == "GENERAL"
							)
						)
					) {
						pendingToken2 = nextToken;
					}
					else {
						// already two pending tokens, both
						// ready to emit?
						if (pendingToken2 != null) {
							// a named boolean operator?
							if (
								[ "QMARK", "EXMARK" ].includes(pendingToken.type) &&
								pendingToken2.type == "GENERAL" &&
								BOOLEAN_NAMED_OPERATORS.includes(pendingToken2.value)
							) {
								// ex: BOOLEAN_IS, BOOLEAN_NOT_AND, etc
								pendingToken.type = `BOOLEAN_OP${
									pendingToken.type == "EXMARK" ? "_NOT" : ""
								}_${pendingToken2.value.toUpperCase()}`;
								pendingToken.value += pendingToken2.value;
								pendingToken.end = pendingToken2.end;
								yield pendingToken;
								pendingToken = pendingToken2 = null;
							}
							// otherwise, just emit both
							// pending tokens
							else {
								yield pendingToken;
								yield pendingToken2;
								pendingToken = pendingToken2 = null;
							}
						}
						// otherwise, single pending token
						// ready to emit?
						else if (pendingToken != null) {
							// need to specialize a "GENERAL"
							// token type?
							if (pendingToken.type == "GENERAL") {
								pendingToken = specializeGeneralToken(pendingToken);
							}

							yield pendingToken;
							pendingToken = null;
						}

						// should we defer this next token?
						if (
							[
								"DOUBLE_QUOTE", "ESCAPE", "HYPHEN", "WHITESPACE",
								"GENERAL", "STRING", "NUMBER", "FORWARD_SLASH",
								"COMMENT", "PERIOD", "TILDE", "QMARK", "EXMARK",
							]
							.includes(nextToken.type)
						) {
							pendingToken = nextToken;

							// remember previous escape token?
							if (nextToken.type == "ESCAPE") {
								escapeToken = pendingToken;
							}
						}
						// might be starting an interpolated
						// expression, so defer?
						else if (
							state.type == "escapedString" &&
							nextToken.type == "BACKTICK"
						) {
							pendingToken = nextToken;
						}
						// otherwise this token is ready to
						// emit now!
						else {
							yield nextToken;
						}
					}
				}
				// a pending string with only an
				// escaped " or ` in it?
				else if (
					pendingToken != null &&
					[ '""', "``" ].includes(pendingToken.value)
				) {
					pendingToken.type = "STRING_ESCAPED_CHAR";
					yield pendingToken;
					pendingToken = null;
				}
			}

			// (possibly) need a state transition?
			if (nextState != null) {
				// done with current state?
				if (nextState == POP_STATE) {
					prevState = currentState[currentState.length-1];
					currentState.pop();
				}
				// transitioning to a different state?
				else if (nextState.type != state.type) {
					prevState = currentState[currentState.length-1];
					currentState.push(nextState);
				}
			}
		}
	}


	// ***************************************

	function specializeGeneralToken(token) {
		if (NATIVES.includes(token.value)) {
			token.type = "NATIVE";
		}
		else if (KEYWORDS.includes(token.value)) {
			token.type = "KEYWORD";
		}
		else if (BUILTINS.includes(token.value)) {
			token.type = "BUILTIN";
		}
		else if (COMPREHENSIONS.includes(token.value)) {
			token.type = "COMPREHENSION";
		}
		return token;
	}

	function TOKEN(type,value,start) {
		// digit(s) followed by a general letter?
		if (
			pendingToken != null &&
			pendingToken.type == "NUMBER" &&
			!pendingToken.value.includes("-") &&
			!pendingToken.value.includes(".") &&
			escapeToken == null &&
			pendingToken2 == null &&
			type == "GENERAL"
		) {
			pendingToken.type = "GENERAL";
			pendingToken.value += value;
			pendingToken.end += value.length;
			return pendingToken;
		}
		// negative number literal?
		else if (
			pendingToken != null &&
			pendingToken.type == "HYPHEN" &&
			type == "NUMBER"
		) {
			pendingToken.type = "NUMBER";
			pendingToken.value += value;
			pendingToken.end += value.length;
			return pendingToken;
		}
		else if (type == "PERIOD") {
			// could be decimal in number literal?
			if (
				pendingToken != null &&
				pendingToken.type == "NUMBER" &&
				!pendingToken.value.includes(".")
			) {
				// double period ("..") adjacent to
				// number?
				if (
					pendingToken2 != null &&
					pendingToken2.type == "PERIOD"
				) {
					pendingToken2.type = "DOUBLE_PERIOD";
					pendingToken2.value += value;
					pendingToken2.end++;
					return pendingToken2;
				}
				// otherwise, period should be held as
				// pending alongside previous pending
				// number
				else {
					return {
						type,
						value,
						start,
						end: (start + value.length - 1),
					};
				}
			}
			// double-period ("..") or triple-period
			// ("..") by itself (not adjacent to number)?
			else if (
				pendingToken != null &&
				[ "PERIOD", "DOUBLE_PERIOD" ].includes(pendingToken.type)
			) {
				pendingToken.value += value;
				pendingToken.end++;
				if (pendingToken.value == "...") {
					pendingToken.type = "TRIPLE_PERIOD";
				}
				else {
					pendingToken.type = "DOUBLE_PERIOD";
				}
				return pendingToken;
			}
			// otherwise, period will be held as
			// pending alongside previous pending
			// number
			else {
				return {
					type,
					value,
					start,
					end: (start + value.length - 1),
				};
			}
		}
		// append number to pending number?
		else if (
			pendingToken != null &&
			pendingToken.type == "NUMBER" &&
			type == pendingToken.type
		) {
			// is there an intervening "." or ".."
			// between current number and pending
			// number token?
			if (
				pendingToken2 != null &&
				[ "PERIOD", "DOUBLE_PERIOD" ].includes(pendingToken2.type)
			) {
				// was there only a single "."
				// between?
				if (pendingToken2.type == "PERIOD") {
					// combine the period into the
					// pending number token, as well
					// as the next next number
					pendingToken.value += pendingToken2.value + value;
					pendingToken.end = start + value.length - 1;
					pendingToken2 = null;
					return pendingToken;
				}
				else {
					return {
						type,
						value,
						start,
						end: (start + value.length - 1),
					};
				}
			}
			// otherwise, just append the adjacent
			// numbers
			else {
				pendingToken.value += value;
				pendingToken.end += value.length;
				return pendingToken;
			}
		}
		else if (type == "TILDE") {
			// appending to a "GENERAL" token?
			if (
				pendingToken != null &&
				pendingToken.type == "GENERAL"
			) {
				pendingToken.value += value;
				pendingToken.end += value.length;
				return pendingToken;
			}
			else {
				return {
					type,
					value,
					start,
					end: (start + value.length - 1),
				};
			}
		}
		else if (
			pendingToken != null &&
			pendingToken.type == "TILDE" &&
			type == "GENERAL"
		) {
			pendingToken.type = "GENERAL";
			pendingToken.value += value;
			pendingToken.end += value.length;
			return pendingToken;
		}
		// starting a comment?
		else if (
			pendingToken != null &&
			pendingToken.type == "FORWARD_SLASH" &&
			type == "FORWARD_SLASH"
		) {
			pendingToken.type = "COMMENT";
			pendingToken.value += value;
			pendingToken.end += value.length;
			return pendingToken;
		}
		// append to pending token?
		else if (
			pendingToken != null &&
			(
				[ "WHITESPACE", "GENERAL", "STRING", "COMMENT" ]
				.includes(pendingToken.type)
			) &&
			type == pendingToken.type
		) {
			pendingToken.value += value;
			pendingToken.end += value.length;
			return pendingToken;
		}
		// append to second pending token?
		else if (
			pendingToken2 != null &&
			(
				[ "WHITESPACE", "GENERAL", "STRING", "COMMENT" ]
				.includes(pendingToken2.type)
			) &&
			type == pendingToken2.type
		) {
			pendingToken2.value += value;
			pendingToken2.end += value.length;
			return pendingToken2;
		}
		else {
			return {
				type,
				value,
				start,
				end: (start + value.length - 1),
			};
		}
	}

	function base(char,position) {
		switch (char) {
			// operator characters
			case "~": {
				escapeToken = null;
				return [ TOKEN("TILDE",char,position), null ];
			}
			case "!": {
				escapeToken = null;
				return [ TOKEN("EXMARK",char,position), null ];
			}
			case "#": {
				escapeToken = null;
				return [ TOKEN("HASH",char,position), null ];
			}
			case "$": {
				escapeToken = null;
				return [ TOKEN("DOLLAR",char,position), null ];
			}
			case "%": {
				escapeToken = null;
				return [ TOKEN("PERCENT",char,position), null ];
			}
			case "^": {
				escapeToken = null;
				return [ TOKEN("CARET",char,position), null ];
			}
			case "&": {
				escapeToken = null;
				return [ TOKEN("AMPERSAND",char,position), null ];
			}
			case "*": {
				escapeToken = null;
				return [ TOKEN("STAR",char,position), null ];
			}
			case "(": {
				escapeToken = null;
				return [ TOKEN("OPEN_PAREN",char,position), null ];
			}
			case ")": {
				escapeToken = null;
				return [ TOKEN("CLOSE_PAREN",char,position), null ];
			}
			case "-": {
				escapeToken = null;
				return [ TOKEN("HYPHEN",char,position), null ];
			}
			case "+": {
				escapeToken = null;
				return [ TOKEN("PLUS",char,position), null ];
			}
			case "=": {
				escapeToken = null;
				return [ TOKEN("EQUAL",char,position), null ];
			}
			case "{": {
				escapeToken = null;
				return [ TOKEN("OPEN_BRACE",char,position), null ];
			}
			case "[": {
				escapeToken = null;
				return [ TOKEN("OPEN_BRACKET",char,position), null ];
			}
			case "}": {
				escapeToken = null;
				return [ TOKEN("CLOSE_BRACE",char,position), null ];
			}
			case "]": {
				escapeToken = null;
				return [ TOKEN("CLOSE_BRACKET",char,position), null ];
			}
			case "|": {
				escapeToken = null;
				return [ TOKEN("PIPE",char,position), null ];
			}
			case ":": {
				escapeToken = null;
				return [ TOKEN("COLON",char,position), null ];
			}
			case ";": {
				escapeToken = null;
				return [ TOKEN("SEMICOLON",char,position), null ];
			}
			case "'": {
				escapeToken = null;
				return [ TOKEN("SINGLE_QUOTE",char,position), null ];
			}
			case "<": {
				escapeToken = null;
				return [ TOKEN("OPEN_ANGLE",char,position), null ];
			}
			case ",": {
				escapeToken = null;
				return [ TOKEN("COMMA",char,position), null ];
			}
			case ">": {
				escapeToken = null;
				return [ TOKEN("CLOSE_ANGLE",char,position), null ];
			}
			case ".": {
				escapeToken = null;
				return [ TOKEN("PERIOD",char,position), null ];
			}
			case "?": {
				escapeToken = null;
				return [ TOKEN("QMARK",char,position), null ];
			}

			case "/": {
				escapeToken = null;
				let nextToken = TOKEN("FORWARD_SLASH",char,position);

				// started a comment?
				if (nextToken.type == "COMMENT") {
					return [
						nextToken,
						{ type: "comment", context: nextToken.value, }
					];
				}
				else {
					return [ nextToken, null ];
				}
			}

			// whitespace?
			// TODO: handle more kinds of whitespace,
			// like unicode characters
			case " ":
			case "\t":
			case "\r":
			case "\n": {
				escapeToken = null;
				return [ TOKEN("WHITESPACE",char,position), null ];
			}

			// digits?
			case "0":
			case "1":
			case "2":
			case "3":
			case "4":
			case "5":
			case "6":
			case "7":
			case "8":
			case "9": {
				// plain escape on regular number
				// literal?
				if (
					escapeToken != null &&
					escapeToken.value == "\\"
				) {
					let context = escapeToken;
					escapeToken = null;
					// re-tokenize character in next state
					return [
						null,
						{ type: "escapedNumber", context, }
					];
				}
				// otherwise, bare digit
				else {
					escapeToken = null;
					return [ TOKEN("NUMBER",char,position), null ];
				}
			}

			case "u":
			case "h":
			case "b":
			case "o": {
				// completing a number escape sequence?
				if (
					escapeToken != null &&
					escapeToken.value == "\\"
				) {
					escapeToken.value += char;
					escapeToken.end++;
					return [
						escapeToken,
						{ type: "escapedNumber", context: escapeToken }
					];
				}
				// otherwise, just general text
				else {
					return [ TOKEN("GENERAL",char,position), null ];
				}
			}

			// escape sequence?
			case "\\": {
				// extending an escape sequence?
				if (
					escapeToken != null &&
					escapeToken.value == "\\"
				) {
					escapeToken.value += char;
					escapeToken.end++;
					return [ escapeToken, null ];
				}
				else {
					escapeToken = null;
					return [ TOKEN("ESCAPE",char,position), null ];
				}
			}

			// backtick?
			case "`": {
				// interpolated string escape?
				if (
					escapeToken != null &&
					[ "\\", "\\\\" ].includes(escapeToken.value)
				) {
					escapeToken.value += char;
					escapeToken.end++;
					return [ escapeToken, null ];
				}
				else {
					escapeToken = null;
					return [ TOKEN("BACKTICK",char,position), null ];
				}
			}

			case "@": {
				// completing monadic escape sequence?
				if (
					escapeToken != null &&
					escapeToken.value == "\\"
				) {
					escapeToken.value += char;
					escapeToken.end++;
					return [
						escapeToken,
						{ type: "escapedNumber", context: escapeToken, }
					];
				}
				else {
					escapeToken = null;
					return [ TOKEN("AT",char,position), null ];
				}
			}

			// starting a string literal?
			case "\"": {
				// starting an escaped string literal?
				if (
					escapeToken != null &&
					[ "\\", "\\`", "\\\\`" ].includes(escapeToken.value)
				) {
					let context = escapeToken;
					escapeToken = null;
					return [
						TOKEN("DOUBLE_QUOTE",char,position),
						{ type: "escapedString", context, }
					];
				}
				// actually, an escaped double-quote
				// found inside a string?
				else if (
					pendingToken != null &&
					pendingToken.type == "DOUBLE_QUOTE"
				) {
					escapeToken = null;
					pendingToken.type = "STRING";
					pendingToken.value += char;
					pendingToken.end++;
					// go right back into previous
					// string-tokenizing state
					return [ pendingToken, prevState ];
				}
				// otherwise, starting a regular string
				else {
					escapeToken = null;
					return [
						TOKEN("DOUBLE_QUOTE",char,position),
						{ type: "string", context: null }
					];
				}
			}

			// general text
			default: {
				escapeToken = null;
				return [ TOKEN("GENERAL",char,position), null ];
			}
		};
	}

	function string(char,position) {
		escapeToken = null;

		switch (char) {
			// possibly end of the string literal?
			case "\"": return [ TOKEN("DOUBLE_QUOTE",char,position), POP_STATE ];

			// general text
			default: return [ TOKEN("STRING",char,position), null ];
		};
	}

	function escapedString(char,position) {
		var state = currentState[currentState.length-1];
		var escapeType = (
			state.context.value == "\\`" ? "interpolated" :
			state.context.value == "\\\\`" ? "interpolatedSpacing" :
			"regular"
		);

		switch (char) {
			// whitespace?
			// TODO: handle more kinds of whitespace,
			// like unicode characters
			case " ":
			case "\t":
			case "\r":
			case "\n": {
				if ([ "regular", "interpolatedSpacing" ].includes(escapeType)) {
					return [ TOKEN("WHITESPACE",char,position), null ];
				}
				else {
					return string(char,position);
				}
			}

			case "`": {
				// possibly starting an interpolated
				// expression?
				if ([ "interpolated", "interpolatedSpacing" ].includes(escapeType)) {
					return [
						TOKEN("BACKTICK",char,position),
						{ type: "interpolatedBase", context: null }
					];
				}
				// otherwise, just general text in
				// the string
				else {
					return string(char,position);
				}
			}

			// general text
			default: return string(char,position);
		}
	}

	function interpolatedBase(char,position) {
		switch (char) {
			case "`": {
				// an escaped backtick found
				// inside a string?
				if (
					pendingToken != null &&
					pendingToken.type == "BACKTICK"
				) {
					pendingToken.type = "STRING";
					pendingToken.value += char;
					pendingToken.end++;
					// go right back into previous
					// string-tokenizing state
					return [ pendingToken, POP_STATE ];
				}
				// not part of an escape sequence, so
				// must be ending the interpolated expression?
				else if (
					escapeToken == null ||
					![ "\\", "\\\\" ].includes(escapeToken.value)
				) {
					return [ TOKEN("BACKTICK",char,position), POP_STATE ];
				}
				else {
					return base(char,position);
				}
			}

			default: return base(char,position);
		}
	}

	function escapedNumber(char,position) {
		var state = currentState[currentState.length-1];
		var escapeType = (
			state.context.value == "\\@" ? "monad" :
			(state.context.value == "\\h" || state.context.value == "\\u") ? "hex" :
			state.context.value == "\\b" ? "binary" :
			state.context.value == "\\o" ? "octal" :
			"regular"
		);
		escapeToken = null;

		switch (char) {
			// binary digits?
			case "0":
			case "1": return [ TOKEN("NUMBER",char,position), null ];

			// octal digits?
			case "2":
			case "3":
			case "4":
			case "5":
			case "6":
			case "7": {
				// tokening a octal-compatible number
				// literal?
				if ([ "regular", "hex", "octal", "monad" ].includes(escapeType)) {
					return [ TOKEN("NUMBER",char,position), null ];
				}
				// otherwise, no longer in a valid
				// escaped number literal
				else {
					return [ TOKEN("GENERAL",char,position), POP_STATE ];
				}
			}

			// remaining digits?
			case "8":
			case "9": {
				// tokening a octal-compatible number
				// literal?
				if ([ "regular", "hex", "monad" ].includes(escapeType)) {
					return [ TOKEN("NUMBER",char,position), null ];
				}
				// otherwise, no longer in a valid
				// escaped number literal
				else {
					return [ TOKEN("GENERAL",char,position), POP_STATE ];
				}
			}

			// hex digits?
			case "a":
			case "b":
			case "c":
			case "d":
			case "e":
			case "f":
			case "A":
			case "B":
			case "C":
			case "D":
			case "E":
			case "F": {
				// tokening a hex-compatible number
				// literal?
				if ([ "hex", "monad" ].includes(escapeType)) {
					return [ TOKEN("NUMBER",char,position), null ];
				}
				// otherwise, no longer in a valid
				// escaped number literal
				else {
					return [
						TOKEN("GENERAL",char,position),
						POP_STATE
					];
				}
			}

			// decimal?
			case ".": {
				// tokenizing a decimal-compatible
				// number literal?
				if (
					pendingToken != null &&
					pendingToken.type == "NUMBER" &&
					!pendingToken.value.includes(".") &&
					[ "regular", "monad" ].includes(escapeType)
				) {
					let nextToken = TOKEN("PERIOD",char,position);
					if (nextToken.type == "DOUBLE_PERIOD") {
						return [ nextToken, POP_STATE ];
					}
					else {
						return [ nextToken, null ];
					}
				}
				else {
					return [
						// NOTE: intentionally avoiding
						// `TOKEN(..)` here, to force
						// a PERIOD token out
						{
							type: "PERIOD",
							value: char,
							start: position,
							end: position
						},
						POP_STATE
					];
				}
			}

			case "-": {
				// is hyphen starting a negative-
				// compatible number literal (non-
				// unicode)
				if (
					(
						pendingToken == null ||
						pendingToken.type != "NUMBER"
					) &&
					state.context.value != "\\u"
				) {
					return [
						TOKEN("NUMBER",char,position),
						null
					];
				}
				// otherwise, must be a minus sign that
				// ends the number literal
				else {
					return [
						TOKEN("HYPHEN",char,position),
						POP_STATE
					];
				}
			}

			case "_": {
				// separator in valid position in
				// escaped number literal?
				if (
					[ "regular", "monad" ].includes(escapeType) &&
					pendingToken != null &&
					pendingToken.type == "NUMBER" &&
					(
						[ "0","1","2","3","4","5","6","7","8","9"]
						.includes(pendingToken.value[pendingToken.value.length-1])
					)
				) {
					return [ TOKEN("NUMBER",char,position), null ];
				}
				// otherwise, must exit from the
				// number literal
				else {
					return [
						TOKEN("GENERAL",char,position),
						POP_STATE
					];
				}
			}

			// otherwise, done tokenizing escaped
			// number literal
			default: {
				let [ nextToken ] = base(char,position);
				return [ nextToken, POP_STATE ];
			}
		}
	}

	function comment(char,position) {
		var state = currentState[currentState.length-1];
		var commentType = (
			state.context == "//" ? "line" : "block"
		);
		escapeToken = null;

		switch (char) {
			case "/": {
				let nextToken = TOKEN("COMMENT",char,position);

				// started a comment-block with
				// triple-slash (///)?
				if (pendingToken.value == "///") {
					state.context = "///";
				}

				// ending a block-comment?
				if (
					commentType == "block" &&
					pendingToken.value.length >= 6 &&
					pendingToken.value.slice(-3) == "///"
				) {
					return [ nextToken, POP_STATE ];
				}
				// otherwise, just part of the comment
				else {
					return [ nextToken, null ];
				}
			}

			case "\n": {
				// ending a line-comment?
				if (commentType == "line") {
					return [
						TOKEN("WHITESPACE",char,position),
						POP_STATE
					];
				}
				else {
					return [ TOKEN("COMMENT",char,position), null ];
				}
			}

			default: return [ TOKEN("COMMENT",char,position), null ];
		}
	}
}

function highlight(tokens) {
	var html = "";
	for (let token of tokens) {
		if (token.type == "WHITESPACE") {
			html += token.value;
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
					[ "COLON", "SEMICOLON", "COMPREHENSION" ]
						.includes(token.type) ||
					token.type.startsWith("BOOLEAN_OP_")
				) ? "t6" :

				(token.type == "NUMBER") ? "t7" :

				(OPERATORS.includes(token.type)) ? "t8" :

				// unassigned default, shouldn't happen
				"oops"
			);

			html += `<i class="${className}">${value}</i>`;
		}
	}

	var tmpl = fs.readFileSync(path.join(__dirname,"src","tmpl.html"),"utf-8");
	return tmpl.replace("<pre></pre>",`<pre>${html}</pre>`);
}
