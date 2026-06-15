// =============================================================
// transpile.js
//
// Bootstrap Foi → JS transpiler. Throwaway infrastructure —
// discarded once Foi self-hosts. Streaming parse, synchronous
// walk, stdout output.
//
// Dispatch contract: handlers[node.type] : (node, recur) => string.
// Same shape as default-shapers and test-roundtrip — fourth
// rehearsal of the (node, recur) skeleton.
//
// Missing handler → `null /* <orig Foi source> */` at node
// granularity. Partial transpilation is genuinely partial: gaps
// are visible JS-level placeholders that still parse, run, and
// pinpoint exactly which slice of Foi hasn't been lowered yet.
//
// Usage: node transpile.js path/to/source.foi > out.js
// =============================================================

import { readFileSync } from "node:fs";
import { parseFoi } from "./parser.js";


// =============================================================
// SOURCE CAPTURE
//
// The original source is captured at module scope so the
// fallback emitter can slice node spans to embed Foi source
// inside JS comments. Set once in main, read by `fallback`.
// =============================================================

var src = "";


// =============================================================
// FALLBACK
//
// Emit a JS expression-position placeholder for any node type
// without a registered handler. `null` carries no surprising
// runtime behavior in any position where an expression is
// expected, and the trailing comment preserves the original Foi
// for inspection and diff.
//
// Synthetic zero-span nodes (node.end == null) carry no source
// to slice — emit a type-tagged placeholder. `*/` inside the
// sliced body would terminate the comment early; escape with a
// space.
// =============================================================

var fallback = node => {
	if (node.end == null) {
		return `null /* ?${node.type} */`;
	}
	var slice = src.slice(node.start, node.end + 1).replace(/\*\//g, "* /");
	return `null /* ${slice} */`;
};


// =============================================================
// TEMPLATE-CHUNK ESCAPER
//
// Translates a literal-text chunk from an InterpStr (or
// SpacingInterpStr) into a JS-template-literal-safe form:
//
//   1. Foi `""`  → JS `"`        — Foi's doubled-quote escape resolves
//   2. Foi ` `` ` → JS ` ` `      — Foi's doubled-backtick escape resolves
//   3. JS `\`   → `\\`            — escape literal backslashes
//   4. JS ` ` ` → `\` `           — escape literal backticks
//   5. JS `${`  → `\${`           — prevent unintended interpolation
//
// Foi-escape resolution precedes JS-escape so the produced
// characters get the JS treatment. Backslash escape precedes
// backtick escape so the `\` chars we introduce in step 4 don't
// get themselves doubled.
// =============================================================

var escapeTemplateChunk = s => s
	.replace(/""/g, '"')
	.replace(/``/g, "`")
	.replace(/\\/g, "\\\\")
	.replace(/`/g, "\\`")
	.replace(/\$\{/g, "\\${");


// =============================================================
// HANDLERS
// =============================================================

var handlers = {

	// =============================================================
	// §1 PROGRAM / IDENTIFIERS
	// =============================================================

	// Pure list-of-statements. Each handler emits its content
	// without a trailing `;`; Program injects `;\n` between
	// stmts to produce JS-conformant output.
	Program(node, recur) {
		return node.stmts.map(s => recur(s) + ";\n").join("");
	},

	Identifier: (n, r) => n.name,
	BuiltIn:    (n, r) => n.name,

	// =============================================================
	// §2 LITERALS
	// =============================================================

	// NumberLit.text is the raw source lexeme — concat of Number +
	// Escape tokens. For first slice, pass through; Foi's `_`
	// separators and `\`-escape prefix are JS-incompatible and
	// will need a lowering pass once samples force it.
	NumberLit:  (n, r) => n.text,
	BooleanLit: (n, r) => n.text,

	// `empty` → `null`. Bootstrap commitment; revisits if the
	// interpreter draws a Maybe/None vs null distinction.
	EmptyLit: (n, r) => "null",

	// PlainStr.text is interior content with Foi `""` escape for
	// embedded quote. Translate to actual string value, then
	// JSON.stringify for a JS string literal — handles
	// quote-escaping, newlines, and non-printables uniformly.
	PlainStr(node, recur) {
		var raw = node.text.replace(/""/g, '"');
		return JSON.stringify(raw);
	},

	// InterpStr → JS template literal. chunks alternates string
	// text (raw Foi content, including `""` / ` `` ` escapes) and
	// InterpExpr nodes. String chunks pass through the template
	// escaper; InterpExpr chunks wrap as `${...}`.
	//
	// SpacingInterpStr has identical chunks shape — same handler
	// would work, but it's not in the first slice's sample so
	// it's left to fall back until a sample forces it.
	InterpStr(node, recur) {
		var out = "`";
		for (let c of node.chunks) {
			if (typeof c === "string") out += escapeTemplateChunk(c);
			else                       out += "${" + recur(c) + "}";
		}
		out += "`";
		return out;
	},

	// InterpExpr is only ever a chunk inside an interp-string —
	// the `${...}` wrapper is the parent's responsibility, so
	// this just renders the inner expression.
	InterpExpr: (n, r) => r(n.expr),

	// =============================================================
	// §4 VARIABLE DEFINITIONS
	// =============================================================

	// `def x: <expr>` → `var x = <expr>`. `var` matches Foi's
	// function-scope semantics for `def`. DestructureTarget
	// deferred — falls back; the lowering needs JS destructure
	// pattern synthesis that's out of first slice.
	DefVarStmt(node, recur) {
		if (node.target.type !== "Identifier") return fallback(node);
		return "var " + recur(node.target) + " = " + recur(node.init);
	},

	// =============================================================
	// §7 CHAIN-FOLD: CALL + MEMBER ACCESS
	// =============================================================

	// CallExpr { callee, args }. PrefixCallSuffix is the source
	// production; ChainExpr's fold produces this uniform shape
	// (bare-op-in-parens shortcut is normalized upstream).
	//
	// NamedArg variants (ConciseNamedArg, ExplicitNamedArg) need
	// JS-side lowering decisions — fall back when present.
	// Positional-only path for first slice.
	CallExpr(node, recur) {
		for (let a of node.args) {
			if (
				a.type === "ConciseNamedArg" ||
				a.type === "ExplicitNamedArg"
			) {
				return fallback(node);
			}
		}
		var argList = node.args.map(a => recur(a)).join(", ");
		return recur(node.callee) + "(" + argList + ")";
	},

	// MemberAccessExpr { object, accessor? | index? }. Mutually
	// exclusive: accessor is a node (Identifier or BuiltIn);
	// index is a bare integer string from the `arr.5` / `arr.-1`
	// positional-index form. JS dot-access vs bracket-access
	// reflects the same distinction.
	MemberAccessExpr(node, recur) {
		if (node.accessor) {
			return recur(node.object) + "." + recur(node.accessor);
		}
		return recur(node.object) + "[" + node.index + "]";
	},

	// =============================================================
	// §9 ADDITIVE BINARY
	// =============================================================

	// AddBinExpr { left, op, right } — left-assoc folded chain;
	// op ∈ {"+", "-", "$+"}. `$+` is Foi's explicit list/string
	// concat; JS `+` covers string concat natively. Revisits if
	// the interpreter enforces stricter typing.
	//
	// Nested same-tier folds (a + b + c) recurse naturally
	// through `recur(left)`. Mixed-tier (a + b * c) hits a
	// MulBinExpr child which falls back until that handler lands.
	AddBinExpr(node, recur) {
		var op = node.op === "$+" ? "+" : node.op;
		return recur(node.left) + " " + op + " " + recur(node.right);
	},

	// =============================================================
	// §11 BLOCK EXPRESSIONS
	// =============================================================

	// Foi BlockExpr → JS IIFE arrow form. `defs`
	// (BlockDefsInitOpt parameter set) deferred — falls back
	// when present.
	//
	// `return` injection on the last stmt is also deferred: the
	// block's value semantics in Foi (last-expression-wins) need
	// a stmt-vs-expr classification that hasn't been wired yet.
	// First-slice form runs the body for effect; the IIFE
	// expression itself evaluates to undefined.
	BlockExpr(node, recur) {
		if (node.defs) return fallback(node);
		var body = node.stmts.map(s => recur(s) + ";").join(" ");
		return "(() => { " + body + " })()";
	},

	// =============================================================
	// §13 FUNCTION DEFINITIONS
	// =============================================================

	// `defn name(params) <body>` → `function name(params) <body>`
	// `defn (params) <body>`      → `(params) => <body>`
	//
	// First-slice limits — fall back when any apply:
	//   - paramSets.length > 1 (currying — needs nested-lambda lowering)
	//   - preconditions, over, as, at (each needs its own lowering)
	//
	// Body forms (FuncBodyExpr / FuncBodyBlock / FuncBodyPipeline)
	// each render to a brace-wrapped statement block; pipeline
	// form falls back until a sample forces it.
	DefFuncExpr(node, recur) {
		if (
			node.paramSets.length !== 1 ||
			node.preconditions ||
			node.over ||
			node.as ||
			node.at
		) {
			return fallback(node);
		}
		var params = recur(node.paramSets[0]);
		var body = recur(node.body);
		if (node.name) {
			return "function " + recur(node.name) + "(" + params + ") " + body;
		}
		return "(" + params + ") => " + body;
	},

	// ParameterList { params: [VarDefInitOpt, ...] }. Joins the
	// rendered params with `, ` — same shape JS expects between
	// formal parameter declarations. An empty-paren synthetic
	// ParameterList carries params: [] and renders to "".
	ParameterList(node, recur) {
		return node.params.map(p => recur(p)).join(", ");
	},

	// VarDefInitOpt { target, init? } — shared between §13
	// (ParameterList entries: function params with optional
	// default values) and §11 (BlockDefsInitOpt entries: block-
	// scope defs with optional initializers). JS default-param
	// syntax `target = init` happens to be valid in both contexts.
	//
	// DestructureTarget target deferred — falls back. JS-side
	// destructure synthesis comes with the destructure cluster.
	VarDefInitOpt(node, recur) {
		if (node.target.type !== "Identifier") return fallback(node);
		var out = recur(node.target);
		if (node.init) out += " = " + recur(node.init);
		return out;
	},

	// FuncBodyBlock { stmts } — `{ ... }` form. Stmts emit in
	// order, each followed by `;`. ReturnExpr stmts (from `^expr`
	// inside the block) render as `return expr` and pick up the
	// `;` naturally. Foi blocks with no ReturnExpr return
	// undefined, matching JS function-body semantics.
	FuncBodyBlock(node, recur) {
		var body = node.stmts.map(s => recur(s) + ";").join(" ");
		return "{ " + body + " }";
	},

	// FuncBodyExpr { body } — `^expr` shorthand form. Single-
	// expression body whose value is the function's return.
	FuncBodyExpr(node, recur) {
		return "{ return " + recur(node.body) + "; }";
	},

	// ReturnExpr { expr } — `^expr` appearing inside a
	// FuncBodyBlock's stmt list. Just emits `return expr`; the
	// enclosing FuncBodyBlock appends the `;`.
	ReturnExpr(node, recur) {
		return "return " + recur(node.expr);
	},

};


// =============================================================
// DISPATCH
// =============================================================

var transpile = node => {
	if (node == null) return "";
	var h = handlers[node.type];
	return h ? h(node, transpile) : fallback(node);
};


// =============================================================
// MAIN
// =============================================================

var path = process.argv[2];
if (!path) {
	process.stderr.write("usage: node transpile.js <path.foi>\n");
	process.exit(1);
}

src = readFileSync(path, "utf8");

var program = null;
for await (let tree of parseFoi(src)) {
	program = tree;
}

if (program == null) {
	process.stderr.write("transpile.js: no Program node yielded\n");
	process.exit(1);
}

process.stdout.write(transpile(program));
