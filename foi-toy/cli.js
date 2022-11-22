"use strict";

var path = require("path");
var fs = require("fs");
var args = require("minimist")(process.argv.slice(2));

main();


// **********************

function main() {
	if (!args.file) {
		console.log("Foi-Toy: experimental Foi tool");
		console.error("Missing --file=.. parameter.");
		return;
	}

	var fileContents = fs.readFileSync(path.resolve(process.cwd(),args.file),"utf-8");

	console.log(
		[ ...tokenize(fileContents) ]
	);
}

function *tokenize(str) {
	var lastIdx = 0;
	var POP_STATE = Symbol("pop-state");
	var currentState = [ { type: "base", context: null, }, ];
	var prevState = null;
	var escapeToken = null;
	var pendingToken = null;
	var stateHandlers = {
		base,
		string,
		escapedString,
		escapedNumber,
		interpolatedBase,
	};

	for (let [idx,char] of Object.entries(str)) {
		idx = Number(idx);
		let charTokenized = false;

		while (!charTokenized) {
			let state = currentState[currentState.length-1];
			let [ nextToken, nextState ] =
				stateHandlers[state.type](char,idx) || [];

			if (nextToken != null) {
				charTokenized = true;

				// new token to emit?
				if (nextToken != pendingToken) {
					// new token not combined with pending
					// token?
					if (pendingToken) {
						yield pendingToken;
						pendingToken = null;
					}

					// should we defer this token?
					if (
						[ "DOUBLE_QUOTE", "ESCAPE", "HYPHEN", "WHITESPACE", "GENERAL", "STRING", "NUMBER" ]
						.includes(nextToken.type)
					) {
						pendingToken = nextToken;

						// remember previous escape token?
						if (nextToken.type == "ESCAPE") {
							escapeToken = pendingToken;
						}
					}
					// might be starting an interpolated
					// expression?
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

	function TOKEN(type,value,start) {
		// negative number literal?
		if (
			pendingToken != null &&
			pendingToken.type == "HYPHEN" &&
			type == "NUMBER"
		) {
			pendingToken.type = "NUMBER";
			pendingToken.value += value;
			pendingToken.end += value.length;
			return pendingToken;
		}
		// decimal in number literal?
		else if (
			pendingToken != null &&
			pendingToken.type == "NUMBER" &&
			!pendingToken.value.includes(".") &&
			type == "PERIOD"
		) {
			pendingToken.value += value;
			pendingToken.end++;
			return pendingToken;
		}
		// appending to pending token?
		else if (
			[ "WHITESPACE", "GENERAL", "STRING", "NUMBER" ].includes(type) &&
			pendingToken != null &&
			pendingToken.type == type
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
			case "_": {
				escapeToken = null;
				return [ TOKEN("UNDERSCORE",char,position), null ];
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
				return [ TOKEN("FORWARD_SLASH",char,position), null ];
			}

			// whitespace?
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
					return [ escapeToken, null ];
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

			case "-": {
				escapeToken = null;
				return [ TOKEN("HYPHEN",char,position), null ];
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
					return [ TOKEN("GENERAL",char,position), POP_STATE ];
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
					return [ TOKEN("PERIOD",char,position), null ];
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
						null
					];
				}
			}

			case "-": {
				// is hyphen starting the negative-
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

			// otherwise, done tokenizing escaped
			// number literal
			default: {
				let [ nextToken ] = base(char,position);
				return [ nextToken, POP_STATE ];
			}
		}
	}
}
