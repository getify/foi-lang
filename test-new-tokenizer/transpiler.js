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
// OP TABLES
//
// Foi op (as concatenated by shapeUnaryTier / shapeBinTier) →
// JS lowering. Unary entries are render functions taking the
// already-emitted operand string (so non-prefix lowerings like
// `?empty x` → `(x == null)` can express the wrap). Binary
// entries are bare JS-op strings.
//
// Missing entries fall through `emit*Tier` to `fallback(node)`,
// surfacing the un-lowered op verbatim in the output as a
// commented-out Foi snippet — easier to spot than a silent
// mistranslation.
// =============================================================

var SYM_UNARY_OPS = {
	"?": x => "!!" + x,
	"!": x => "!"  + x,
};

var NAMED_UNARY_OPS = {
	"?empty": x => "(" + x + " == null)",
	"!empty": x => "(" + x + " != null)",
};

var ADD_OPS = { "+": "+", "-": "-", "$+": "+" };
var MUL_OPS = { "*": "*", "/": "/" };

var CMP_OPS = {
	"?<":  "<",
	"?<=": "<=",
	"?>":  ">",
	"?>=": ">=",
	"?=":  "===",
	"?<>": "!==",
};

var AND_OPS = { "?and": "&&" };
var OR_OPS  = { "?or":  "||" };


// =============================================================
// OP_FUNC_TABLE — bare-op OpFuncExpr lowering metadata.
//
//   kind: "fold"  — left-fold via reduce, n-ary (≥1 for value)
//   kind: "pairs" — all-pairs every, n-ary (vacuous true on <2)
//
// Primed (`node.primed`) reverses args before fold/pairs; both
// shapes emit `.reverse()` uniformly (no-op for symmetric ops).
//
// Ops absent here (`?<=>`, `?in`, `?has`, `?as`, unary forms)
// fall back — each needs its own lowering decision.
// =============================================================

var OP_FUNC_TABLE = {
	"?":      { kind: "unary", render: x => "!!" + x },
	"!":      { kind: "unary", render: x => "!" + x },
	"?empty": { kind: "unary", render: x => "(" + x + " == null)" },
	"!empty": { kind: "unary", render: x => "(" + x + " != null)" },
	"+":   { kind: "fold",  op: "+" },
	"-":   { kind: "fold",  op: "-" },
	"$+":  { kind: "fold",  op: "+" },
	"*":   { kind: "fold",  op: "*" },
	"/":   { kind: "fold",  op: "/" },
	"?and":{ kind: "fold",  op: "&&" },
	"?or": { kind: "fold",  op: "||" },
	"?=":  { kind: "pairs", op: "===" },
	"?<>": { kind: "pairs", op: "!==" },
	"?<":  { kind: "pairs", op: "<" },
	"?<=": { kind: "pairs", op: "<=" },
	"?>":  { kind: "pairs", op: ">" },
	"?>=": { kind: "pairs", op: ">=" },
};


// =============================================================
// TIER EMITTERS
//
// Both share the same op-table dispatch contract — unknown op
// falls back at node granularity rather than emitting a broken
// JS shape.
// =============================================================

var emitUnaryTier = (node, recur, opMap) => {
	var fn = opMap[node.op];
	if (fn == null) return fallback(node);
	return fn(recur(node.right));
};

var emitBinTier = (node, recur, opMap) => {
	var jsOp = opMap[node.op];
	if (jsOp == null) return fallback(node);
	return recur(node.left) + " " + jsOp + " " + recur(node.right);
};


// =============================================================
// COND-CLAUSE EMITTER
//
// Renders a CondClause (§14 explicit form, or §15 synthesized
// form inside IndepPatternStmt) as a JS boolean expression
// string. Reaches THROUGH the BracketExpr wrapper to its inner
// expr — the brackets are pure syntactic delimiters in Foi
// (`?[c]`), with no JS equivalent.
//
// Effective polarity is `polarity ?? defaultPolarity` — §14
// always sets `polarity` (grammar requires it); §15 synthesized
// clauses may have either. Falls back to "?" defensively for
// any clause missing both. `!` polarity wraps the JS test in
// `!(...)` so it composes safely as a subexpression.
// =============================================================

var emitCondClause = (clause, recur) => {
	var effective = clause.polarity || clause.defaultPolarity || "?";
	var inner = recur(clause.test.expr);
	return effective === "!" ? "!(" + inner + ")" : inner;
};


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
	// §5 EXPRESSION SCAFFOLDING
	// =============================================================

	// GroupedExpr { expr, as? } — user-written parens. Preserve
	// in JS to keep operator-precedence and ternary composition
	// intact. `:as` annotation lowering deferred — falls back
	// when present.
	GroupedExpr(node, recur) {
		if (node.as) return fallback(node);
		return "(" + recur(node.expr) + ")";
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

	// PartialCallExpr { callee, args }. PartialCallSuffix is the
	// source production; ChainExpr's fold produces this uniform
	// shape. Lowers to an IIFE-bind closure:
	//
	//   foo|a, b|
	//   → ((__c, ...__a) => (...__rest) => __c(...__a, ...__rest))(foo, a, b)
	//
	// Single-eval of callee + supplied args at partial-app time
	// matches Foi's "arguments are remembered for later" semantics.
	// Plain `(...__rest) => foo(a, b, ...__rest)` would re-eval arg
	// exprs per call — wrong for side-effecting args.
	//
	// Deferred (fall back when present):
	//   - spread arg (TriplePeriod in delims) — JS-side spread of
	//     captured-tuple needs its own lowering
	//   - NamedArg variants — same JS-side decision as CallExpr
	//
	// Skip-position form `f|1,,2|` is NOT detected at AST level —
	// Comma count in delims doesn't disambiguate skip vs trailing
	// without source-position comparison against arg spans. Current
	// lowering silently packs as `f(1,2)`. Defer detection until
	// a sample forces it.
	PartialCallExpr(node, recur) {
		if (node.delims) {
			for (let d of node.delims) {
				if (d.type === "TriplePeriod") return fallback(node);
			}
		}
		for (let a of node.args) {
			if (
				a.type === "ConciseNamedArg" ||
				a.type === "ExplicitNamedArg"
			) {
				return fallback(node);
			}
		}
		var callee = recur(node.callee);
		var argList = node.args.map(a => recur(a)).join(", ");
		var bindArgs = argList ? callee + ", " + argList : callee;
		return "((__c, ...__a) => (...__rest) => __c(...__a, ...__rest))(" + bindArgs + ")";
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

	// OpFuncExpr — operator as function reference. Bare-op arm only.
	//
	//   (+)(1,2,3,4)   → left-fold via reduce: 1+2+3+4
	//   (-')(1,6,2)    → reverse args, then left-fold: 2-6-1 = -5
	//   (?=)(x,y,z)    → all-pairs every: x===y && x===z && y===z
	//   (?<)(a,b,c)    → all-pairs every: a<b && a<c && b<c
	//   (?empty)(x)    → 1-arg lift: (x == null)
	//
	// Binary ops lift to n-ary; unary ops stay 1-ary.
	//
	// All-pairs (not chained) for compare ops — matters for non-
	// transitive `?<>` where chained would miss pairs. For symmetric
	// ops (?=, ?<>) primed is a no-op; .reverse() still emits
	// uniformly. Primed is meaningless for unary; ignored.
	//
	// Non-bare arms (range `(..)`, angle-pick `(.<a,5>)`, range-
	// access `(.[1..5])`, empty-bracket `([])`) and ops absent from
	// OP_FUNC_TABLE (?<=>, ?in, ?has, ?as) fall back.
	OpFuncExpr(node, recur) {
		if (node.properties || node.range || node.op === "[]") {
			return fallback(node);
		}
		var meta = OP_FUNC_TABLE[node.op];
		if (!meta) return fallback(node);
		if (meta.kind === "unary") {
			return "((__x) => " + meta.render("__x") + ")";
		}
		var xs = node.primed ? "__xs.reverse()" : "__xs";
		if (meta.kind === "fold") {
			return "((...__xs) => " + xs +
				".reduce((__l, __r) => __l " + meta.op + " __r))";
		}
		// pairs
		return "((...__xs) => " + xs +
			".every((__l, __i) => __xs.every((__r, __j) => __j <= __i || __l " +
			meta.op + " __r)))";
	},

	// =============================================================
	// §8 UNARY
	// =============================================================
	//
	// Both unary productions share the `{ op, right }` shape via
	// shapeUnaryTier — no `left`, no delims. Lower via op-table
	// of render functions; unknown ops fall back.
	//
	// Foi unary binds tighter than binary (operand restricted to
	// BinaryAtom), so the operand string never carries lower-
	// precedence operators that would need parenthesization at
	// this level. The named-unary lowerings still wrap in parens
	// so the resulting comparison composes safely as a subexpr.

	SymbolicUnaryExpr: (n, r) => emitUnaryTier(n, r, SYM_UNARY_OPS),
	NamedUnaryExpr:    (n, r) => emitUnaryTier(n, r, NAMED_UNARY_OPS),

	// =============================================================
	// §9 BINARY TIERS
	// =============================================================
	//
	// Six iter tiers all share the `{ left, op, right }` shape
	// via shapeBinTier — left-folded, no delims. Same emitBinTier
	// driver across all of them; only the op-table varies.
	//
	// Nested same-tier chains (a + b + c) recurse naturally
	// through `recur(left)` since the fold produces
	// AddBinExpr-of-AddBinExpr. Mixed-tier (a + b * c) lets the
	// MulBinExpr handler take its own subtree.
	//
	// TypeCompareBinExpr and FlowBinExpr deliberately omitted —
	// each needs its own lowering shape (type-of dispatch,
	// pipeline / comprehension call lowering) rather than a flat
	// op-table mapping, so they fall back until those handlers
	// land.

	AddBinExpr:     (n, r) => emitBinTier(n, r, ADD_OPS),
	MulBinExpr:     (n, r) => emitBinTier(n, r, MUL_OPS),
	CompareBinExpr: (n, r) => emitBinTier(n, r, CMP_OPS),
	AndBinExpr:     (n, r) => emitBinTier(n, r, AND_OPS),
	OrBinExpr:      (n, r) => emitBinTier(n, r, OR_OPS),

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

	// =============================================================
	// §14 CONDITIONALS / GUARDS
	// =============================================================

	// GuardedExpr { clause, consequent } — `?[c]: x` / `![c]: x`.
	// Lowers to a JS ternary with `null` else, matching Foi's
	// "evaluates to empty when the guard fails" semantics:
	//
	//   ?[c]: x   →   c ? x : null
	//   ![c]: x   →   !(c) ? x : null
	//
	// The clause is consumed via emitCondClause (reaches through
	// CondClause's BracketExpr wrapper to the inner test expr,
	// applies `!(...)` when polarity is "!"). Consequent is an
	// Expr — recur produces a JS expression that composes inside
	// the ternary.
	//
	// Consequent BlockExpr currently emits an IIFE with no
	// implicit return (block return-injection is deferred), so
	// `?[c]: { x; y }` evaluates to undefined when c is truthy.
	// Pure-side-effect consequents work; value-returning ones
	// don't until injection lands.
	GuardedExpr(node, recur) {
		var cond = emitCondClause(node.clause, recur);
		return cond + " ? " + recur(node.consequent) + " : null";
	},

	// =============================================================
	// §15 MATCH EXPRESSIONS
	// =============================================================

	// IndepMatchExpr { stmts } — `?{ ... }`. Lowers to a right-
	// folded chain of JS ternaries. Trailing ElseStmt (if any)
	// provides the chain's final else-value; without it, the
	// fall-through value is `null` (Foi's "no match" maps to
	// `empty`, which maps to `null` in this transpiler).
	//
	// Each IndepPatternStmt carries a synthesized CondClause —
	// same shape as §14's GuardedExpr.clause, so emitCondClause
	// handles both uniformly (including the implicit-? form
	// `[c]:` which sets defaultPolarity instead of polarity).
	//
	// IndepPatternStmt and IndepPatternStmtNoSemi both collapse
	// to type tag "IndepPatternStmt" at the shaper layer — only
	// one branch needed here.
	//
	// Right-fold (right-to-left iteration) so the first matching
	// clause's consequent appears outermost — the resulting JS
	// `c1 ? e1 : c2 ? e2 : default` short-circuits on the first
	// truthy condition, matching Foi's first-match-wins
	// semantics. Each ternary is paren-wrapped for safety
	// regardless of right-assoc context.
	//
	// DepMatchExpr (`?(topic){...}`) deliberately omitted —
	// needs IIFE topic-binding plus operator-led test atoms
	// (DepCondBoolExpr). Falls back until that handler lands.
	IndepMatchExpr(node, recur) {
		var stmts = node.stmts;
		if (stmts.length === 0) return "null";

		var last = stmts[stmts.length - 1];
		var hasElse = last.type === "ElseStmt";
		var result;
		var topIdx;
		if (hasElse) {
			result = recur(last.consequent);
			topIdx = stmts.length - 2;
		}
		else {
			result = "null";
			topIdx = stmts.length - 1;
		}
		for (let i = topIdx; i >= 0; i--) {
			let s = stmts[i];
			let cond = emitCondClause(s.clause, recur);
			result = "(" + cond + " ? " + recur(s.consequent) + " : " + result + ")";
		}
		return result;
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
