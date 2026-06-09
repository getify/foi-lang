// grammar-check.js — LR cycle detector for the Foi syntactic grammar.
//
// Parses the EBNF code blocks out of Syntactic-Grammar.md, builds a
// directed graph where P → Q iff P can call Q before consuming any
// token (the "first-call" relation), then runs Tarjan's SCC. Any
// non-trivial SCC or self-loop is a left-recursion cycle that will
// blow the stack at parse time.

import fs from "node:fs";


// =============================================================
// EBNF EXTRACTION
// =============================================================

var extractEBNFBlocks = md => {
	var blocks = [];
	var re = /```ebnf\n([\s\S]*?)```/g;
	var m;
	while ((m = re.exec(md)) !== null) blocks.push(m[1]);
	return blocks;
};

var stripComments = s => s.replace(/\(\*[\s\S]*?\*\)/g, "");

// Split block text on top-level `;` (respecting parens and strings).
var splitProductions = blockText => {
	var productions = [];
	var depth = 0;
	var inString = false;
	var start = 0;
	for (let i = 0; i < blockText.length; i++) {
		let c = blockText[i];
		if (inString) {
			if (c === '"') inString = false;
		}
		else if (c === '"') inString = true;
		else if (c === "(") depth++;
		else if (c === ")") depth--;
		else if (c === ";" && depth === 0) {
			productions.push(blockText.slice(start, i + 1));
			start = i + 1;
		}
	}
	return productions.map(p => p.trim()).filter(p => p.length > 1);
};

// Parse "Name := body;" or "<Name> := body;"
var parseProductionHeader = text => {
	var m = text.match(/^(<?[A-Za-z_][A-Za-z0-9_]*>?)\s*:=\s*([\s\S]*);$/);
	if (!m) return null;
	var nameRaw = m[1];
	var body = m[2].trim();
	var hidden = nameRaw.startsWith("<");
	var name = hidden ? nameRaw.slice(1, -1) : nameRaw;
	return { name, hidden, body };
};


// =============================================================
// EBNF BODY PARSER
//   body  := alt
//   alt   := seq ("|" seq)*
//   seq   := term+
//   term  := atom ("?" | "*" | "+")?
//   atom  := ref | literal | "(" alt ")" | "&" "(" alt ")" | "!" "(" alt ")"
// =============================================================

var tokenizeBody = body => {
	var tokens = [];
	var i = 0;
	while (i < body.length) {
		let c = body[i];
		if (/\s/.test(c)) { i++; continue; }
		if (c === "<") {
			let end = body.indexOf(">", i);
			tokens.push({ type: "ref", value: body.slice(i + 1, end), hidden: true });
			i = end + 1;
		}
		else if (c === '"') {
			let end = body.indexOf('"', i + 1);
			tokens.push({ type: "literal", value: body.slice(i + 1, end) });
			i = end + 1;
		}
		else if (/[A-Za-z_]/.test(c)) {
			let j = i;
			while (j < body.length && /[A-Za-z0-9_]/.test(body[j])) j++;
			tokens.push({ type: "ref", value: body.slice(i, j), hidden: false });
			i = j;
		}
		else if ("|()?*+&!".includes(c)) {
			tokens.push({ type: "op", value: c });
			i++;
		}
		else throw new Error(`Unexpected char '${c}' in body at ${i}`);
	}
	return tokens;
};

var parseBody = tokens => {
	var pos = 0;
	var peek = () => tokens[pos];
	var eatOp = value => {
		let t = peek();
		if (!t || t.type !== "op" || t.value !== value) {
			throw new Error(`Expected op '${value}', got ${JSON.stringify(t)}`);
		}
		pos++;
	};
	var parseAlt = () => {
		let seqs = [parseSeq()];
		while (peek() && peek().type === "op" && peek().value === "|") {
			pos++;
			seqs.push(parseSeq());
		}
		return seqs.length === 1 ? seqs[0] : { kind: "alt", seqs };
	};
	var parseSeq = () => {
		let terms = [];
		while (peek() && !(peek().type === "op" && (peek().value === "|" || peek().value === ")"))) {
			terms.push(parseTerm());
		}
		if (terms.length === 0) throw new Error("Empty seq");
		return terms.length === 1 ? terms[0] : { kind: "seq", terms };
	};
	var parseTerm = () => {
		let a = parseAtom();
		let t = peek();
		if (t && t.type === "op" && (t.value === "?" || t.value === "*" || t.value === "+")) {
			pos++;
			return { kind: "suffix", op: t.value, inner: a };
		}
		return a;
	};
	var parseAtom = () => {
		let t = peek();
		if (!t) throw new Error("Unexpected end of body");
		if (t.type === "ref") { pos++; return { kind: "ref", name: t.value }; }
		if (t.type === "literal") { pos++; return { kind: "literal", value: t.value }; }
		if (t.type === "op" && t.value === "(") {
			pos++;
			let inner = parseAlt();
			eatOp(")");
			return inner;
		}
		if (t.type === "op" && (t.value === "&" || t.value === "!")) {
			pos++;
			eatOp("(");
			let inner = parseAlt();
			eatOp(")");
			return { kind: "lookahead", polarity: t.value, inner };
		}
		throw new Error(`Unexpected token in atom: ${JSON.stringify(t)}`);
	};

	var result = parseAlt();
	if (pos !== tokens.length) {
		throw new Error(`Trailing tokens at ${pos}: ${JSON.stringify(tokens.slice(pos))}`);
	}
	return result;
};


// =============================================================
// NULLABILITY & FIRST-CALL ANALYSIS
//
// nullable(P): can P match empty (consume zero tokens)?
// firstCalls(P): set of productions reachable before any token is consumed.
//
// A token-consuming terminal (any ref not defined as a LHS in this
// grammar, e.g. OpenParen, Whitespace, General) stops the cascade.
// A literal "value" also consumes.
// =============================================================

var analyze = productions => {
	var prods = new Map(productions.map(p => [ p.name, p ]));
	var nullable = new Map();
	var firstCalls = new Map();
	for (let p of productions) {
		nullable.set(p.name, false);
		firstCalls.set(p.name, new Set());
	}

	var exprNullable = e => {
		if (e.kind === "ref") return prods.has(e.name) ? nullable.get(e.name) : false;
		if (e.kind === "literal") return false;
		if (e.kind === "suffix") {
			if (e.op === "?" || e.op === "*") return true;
			return exprNullable(e.inner);   // "+" is nullable iff inner is
		}
		if (e.kind === "lookahead") return true;
		if (e.kind === "alt") return e.seqs.some(exprNullable);
		if (e.kind === "seq") return e.terms.every(exprNullable);
		return false;
	};

	var exprFirstCalls = e => {
		var out = new Set();
		if (e.kind === "ref") {
			if (prods.has(e.name)) out.add(e.name);
			return out;
		}
		if (e.kind === "literal") return out;
		if (e.kind === "suffix") {
			for (let c of exprFirstCalls(e.inner)) out.add(c);
			return out;
		}
		if (e.kind === "lookahead") {
			for (let c of exprFirstCalls(e.inner)) out.add(c);
			return out;
		}
		if (e.kind === "alt") {
			for (let s of e.seqs) for (let c of exprFirstCalls(s)) out.add(c);
			return out;
		}
		if (e.kind === "seq") {
			for (let t of e.terms) {
				for (let c of exprFirstCalls(t)) out.add(c);
				if (!exprNullable(t)) break;
			}
			return out;
		}
		return out;
	};

	// Fixed-point on nullable (productions can refer to each other).
	var changed = true;
	while (changed) {
		changed = false;
		for (let p of productions) {
			let was = nullable.get(p.name);
			let is = exprNullable(p.bodyAST);
			if (is !== was) { nullable.set(p.name, is); changed = true; }
		}
	}

	// Compute firstCalls (single pass — only immediate edges; transitive
	// reachability is captured by SCC analysis).
	for (let p of productions) firstCalls.set(p.name, exprFirstCalls(p.bodyAST));

	return { nullable, firstCalls };
};


// =============================================================
// TARJAN'S SCC
// =============================================================

var findSCCs = (productions, firstCalls) => {
	var index = 0;
	var stack = [];
	var indices = new Map();
	var lowlinks = new Map();
	var onStack = new Set();
	var sccs = [];

	var strongconnect = v => {
		indices.set(v, index);
		lowlinks.set(v, index);
		index++;
		stack.push(v);
		onStack.add(v);
		for (let w of (firstCalls.get(v) || new Set())) {
			if (!indices.has(w)) {
				strongconnect(w);
				lowlinks.set(v, Math.min(lowlinks.get(v), lowlinks.get(w)));
			}
			else if (onStack.has(w)) {
				lowlinks.set(v, Math.min(lowlinks.get(v), indices.get(w)));
			}
		}
		if (lowlinks.get(v) === indices.get(v)) {
			let scc = [];
			let w;
			do {
				w = stack.pop();
				onStack.delete(w);
				scc.push(w);
			} while (w !== v);
			sccs.push(scc);
		}
	};

	for (let p of productions) {
		if (!indices.has(p.name)) strongconnect(p.name);
	}
	return sccs;
};


// =============================================================
// MAIN
// =============================================================

var srcPath = process.argv[2] || "Syntactic-Grammar.md";
var src = fs.readFileSync(srcPath, "utf-8");

var blocks = extractEBNFBlocks(src);
var productions = [];
var parseErrors = [];
var placeholders = [];

for (let b of blocks) {
	let stripped = stripComments(b);
	for (let pt of splitProductions(stripped)) {
		let header = parseProductionHeader(pt);
		if (!header) {
			parseErrors.push({ text: pt, error: "header parse failed" });
			continue;
		}
		if (/\?\?\?/.test(header.body)) {
			placeholders.push(header.name);
			continue;
		}
		try {
			let tokens = tokenizeBody(header.body);
			let bodyAST = parseBody(tokens);
			productions.push({ ...header, bodyAST });
		}
		catch (e) {
			parseErrors.push({ name: header.name, body: header.body, error: e.message });
		}
	}
}

console.log(`Parsed ${productions.length} productions from ${srcPath}.`);
if (placeholders.length > 0) {
	console.log(`Skipped ${placeholders.length} placeholder(s): ${placeholders.join(", ")}`);
}
if (parseErrors.length > 0) {
	console.log(`\n⚠ ${parseErrors.length} parse error(s):`);
	for (let e of parseErrors) {
		console.log(`  - ${e.name || "<unknown>"}: ${e.error}`);
	}
}

var { nullable, firstCalls } = analyze(productions);

// Find LR cycles: non-trivial SCCs or self-loops.
var sccs = findSCCs(productions, firstCalls);
var lrCycles = [];
for (let scc of sccs) {
	if (scc.length > 1) lrCycles.push(scc);
	else if (firstCalls.get(scc[0]).has(scc[0])) lrCycles.push(scc);
}

console.log("\n=== LEFT-RECURSION ANALYSIS ===");
if (lrCycles.length === 0) {
	console.log("✓ No left-recursion cycles in the first-call graph.");
}
else {
	console.log(`✗ Found ${lrCycles.length} LR cycle(s):`);
	for (let c of lrCycles) {
		console.log(`\n  Cycle (${c.length} node${c.length === 1 ? "" : "s"}): ${c.join(" ↔ ")}`);
		for (let n of c) {
			let edges = [...firstCalls.get(n)].filter(t => c.includes(t));
			console.log(`    ${n} first-calls (within cycle): ${edges.join(", ")}`);
		}
	}
	process.exit(1);
}

var nullables = productions.filter(p => nullable.get(p.name)).map(p => p.name);
console.log(`\n=== NULLABLE PRODUCTIONS (${nullables.length}) ===`);
console.log(nullables.length ? nullables.join(", ") : "(none)");
