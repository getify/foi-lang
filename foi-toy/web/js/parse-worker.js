import { tokenize, } from "./fast-tokenizer.js";
import { parseFoi, } from "./parser.js";

self.addEventListener("message",onMessage);


// ****************************

async function onMessage({ data, }) {
	var { seq, src, } = data;
	var tokens;

	// Re-lex here rather than receiving tokens from the main
	// thread: 2ms is cheaper than structured-cloning the array.
	try {
		tokens = tokenize(src);
	}
	catch (err) {
		postFailure(seq,"Tokenize",err);
		return;
	}

	var ast = [];
	try {
		for await (let node of parseFoi(src,{ tokenizer: () => tokens, })) {
			ast.push(node);
		}
	}
	catch (err) {
		postFailure(seq,"Parse",err);
		return;
	}

	// Serialize here rather than cloning the node tree across the
	// boundary: the string is what the display needs, and the
	// stringify cost lands on this thread instead of the main one.
	self.postMessage({ seq, ok: true, ast: JSON.stringify(ast,null,2), });
}

// Error objects survive structured clone, but only their standard
// fields do — a custom `.pos` would be dropped silently. Serialize
// the parts the caller needs explicitly.
function postFailure(seq,label,err) {
	self.postMessage({
		seq,
		ok: false,
		label,
		message: err.message,
		pos: (typeof err.pos == "number") ? err.pos : null,
	});
}
