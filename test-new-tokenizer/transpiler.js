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
// entries are either a bare JS-op string (transparent passthrough,
// `?and` → `&&`) or a render fn taking (left, right) for forms
// that need to wrap the whole expression (`!and` → `!(l && r)`).
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
	"!<":  (l, r) => "!(" + l + " < "   + r + ")",
	"?<=": "<=",
	"!<=": (l, r) => "!(" + l + " <= "  + r + ")",
	"?>":  ">",
	"!>":  (l, r) => "!(" + l + " > "   + r + ")",
	"?>=": ">=",
	"!>=": (l, r) => "!(" + l + " >= "  + r + ")",
	"?=":  "===",
	"!=":  (l, r) => "!(" + l + " === " + r + ")",
	"?<>": "!==",
	"!<>": (l, r) => "!(" + l + " !== " + r + ")",
};

var AND_OPS = {
	"?and": "&&",
	"!and": (l, r) => "!(" + l + " && " + r + ")",
};

var OR_OPS = {
	"?or":  "||",
	"!or":  (l, r) => "!(" + l + " || " + r + ")",
};


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
	"!and": { kind: "notAnd" },
	"!or":  { kind: "notOr" },
	"!=":   { kind: "notPairs", op: "===" },
	"!<>":  { kind: "notPairs", op: "!==" },
	"!<":   { kind: "notPairs", op: "<"  },
	"!<=":  { kind: "notPairs", op: "<=" },
	"!>":   { kind: "notPairs", op: ">"  },
	"!>=":  { kind: "notPairs", op: ">=" },
};


// =============================================================
// BLOCK-BODY EMITTER
//
// Shared lowering for the stmts portion of BareBlockExpr,
// BlockExpr, DefBlockStmt, and (eventually) DefFuncExpr's
// FuncBodyPipeline branch. Two modes:
//
//   withReturn:false → plain stmt list: `s1; s2; s3;` used by
//                      DefBlockStmt (bare JS block, no value-
//                      returning context).
//
//   withReturn:true  → return-injecting form for IIFE bodies
//                      and value-returning function bodies.
//                      Last non-DefVarStmt stmt is prepended
//                      with `return `; empty body or DefVarStmt-
//                      last gets a trailing `return null;`.
//
// Callers wrap the result with their own punctuation (IIFE,
// braces, function body, etc.).
// =============================================================

var emitBlockBody = (stmts, recur, withReturn) => {
	if (!withReturn) {
		return stmts.map(s => recur(s) + ";").join(" ");
	}
	if (stmts.length === 0) return "return null;";
	var lastIdx = stmts.length - 1;
	var injected = false;
	var body = stmts.map((s, i) => {
		var rendered = recur(s);
		if (i === lastIdx && s.type !== "DefVarStmt") {
			rendered = "return " + rendered;
			injected = true;
		}
		return rendered + ";";
	}).join(" ");
	if (!injected) body += " return null;";
	return body;
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
	var entry = opMap[node.op];
	if (entry == null) return fallback(node);
	var left  = recur(node.left);
	var right = recur(node.right);
	if (typeof entry === "function") return entry(left, right);
	return left + " " + entry + " " + right;
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
// RECORD-ENTRY EMITTER
//
// Renders a single keyed RecordTupleLit entry (PickValue,
// ConcisePropDef, or ExplicitPropDef) to a JS object-property
// string. Returns null when the entry shape can't be lowered
// — RecordTupleLit's handler then falls back at the literal
// level (granular fallback policy).
//
//   ConcisePropDef:
//     <:foo>          → foo                  (JS shorthand)
//     <:5>            → null  (no clean JS semantic for numeric)
//
//   PickValue:
//     <&foo>          → foo                  (JS shorthand)
//     <&Maybe>        → Maybe                (BuiltIn → shorthand)
//     <&foo.bar>      → bar: foo.bar         (terminal accessor as key)
//     <&foo.bar.baz>  → baz: foo.bar.baz
//     <&foo[0]>       → null  (no natural key for index)
//     <&foo.5>        → null  (no natural key for integer member)
//
//   ExplicitPropDef:
//     <x: 1>          → x: 1
//     <5: x>          → 5: x
//     <%foo: 1>       → [foo]: 1             (computed key)
// =============================================================

var renderRecordEntry = (entry, recur) => {
	if (entry.type === "ConcisePropDef") {
		let src = entry.source;
		if (src.type === "Identifier") return src.name;
		return null;
	}
	if (entry.type === "PickValue") {
		let src = entry.source;
		if (src.type === "Identifier" || src.type === "BuiltIn") {
			return src.name;
		}
		if (src.type === "MemberAccessExpr" && src.accessor) {
			return src.accessor.name + ": " + recur(src);
		}
		return null;
	}
	if (entry.type === "ExplicitPropDef") {
		let key = entry.key;
		let val = recur(entry.init);
		if (key.type === "ComputedPropName") return "[" + recur(key.expr) + "]: " + val;
		if (key.type === "Identifier")       return key.name + ": " + val;
		if (key.type === "NumberLit")        return key.text + ": " + val;
		return null;
	}
	return null;
};


// =============================================================
// DESTRUCTURE EMITTERS
//
// Lower DestructureTarget against a JS expression evaluating to
// the source value. Strategy: single-eval source into a temp
// (whose name is supplied by the caller), then one decl per
// destructure entry reading a path on that temp.
//
//   def <a: src.x, :b, #whole>: payload;
//   → var __t = payload, a = __t.src.x, b = __t.b, whole = __t
//
// Foi's destructure is path-based (pick by access chain), not
// shape-based — JS destructure patterns can't natively express
// chained accessors (`{src: {x: a}}` would require nested
// patterns, and breaks entirely on integer-index or computed-key
// segments). Single-temp + chained decls is uniform across all
// path complexity.
//
// tempName is the JS-side root identifier the destructure paths
// resolve against. Each caller-context allocates its own:
//   - DefVarStmt         → "__t"           (single; sequential
//                                            top-level DefVarStmts
//                                            safely re-`var __t`
//                                            per JS semantics)
//   - DefFuncExpr params → "__p0", "__p1"  (JS param name itself —
//                                            no separate temp)
//
// All synthesized names follow the existing __c / __a / __rest /
// __xs convention for compiler-introduced identifiers.
// =============================================================

// Renders a DestructureTarget's entries as a comma-separated
// init-list suitable for embedding inside `var <tempName> = init, ...`.
// Returns null when any entry can't be lowered — caller falls
// back at the container level.
var renderDestructure = (target, recur, tempName) => {
	var parts = [];
	for (let entry of target.entries) {
		let rendered = renderDestructureEntry(entry, recur, tempName);
		if (rendered == null) return null;
		parts.push(rendered);
	}
	return parts.join(", ");
};

var renderDestructureEntry = (entry, recur, tempName) => {
	if (entry.type === "DestructureCapture") {
		return entry.target.name + " = " + tempName;
	}
	if (entry.type === "DestructureNamedDef") {
		let pathStr = renderDestructurePath(entry.source, recur, tempName);
		if (pathStr == null) return null;
		return entry.target.name + " = " + pathStr;
	}
	if (entry.type === "DestructureConciseDef") {
		let bindName = conciseBindingName(entry.source);
		if (bindName == null) return null;
		let pathStr = renderDestructurePath(entry.source, recur, tempName);
		if (pathStr == null) return null;
		return bindName + " = " + pathStr;
	}
	return null;
};

// Concise form derives the binding name from the terminal
// segment of the source path:
//
//   :foo        → "foo"           (no access — Identifier base)
//   :foo.bar    → "bar"           (terminal named accessor)
//   :foo.5      → null            (integer member — no JS name)
//   :foo[0]     → null            (index access — no JS name)
var conciseBindingName = source => {
	if (source.type === "Identifier") return source.name;
	if (source.type === "MemberAccessExpr" && source.accessor) {
		return source.accessor.name;
	}
	return null;
};

// Renders a destructure source path rooted at <tempName>. Walks
// the chain back to its base, substitutes <tempName> for the
// base, then re-emits chain segments on top.
//
//   src           → <tempName>.src               (Identifier base)
//   src.x         → <tempName>.src.x
//   [k]           → <tempName>[k]                (BracketExpr base; NamedDef only)
//   [k].x.5       → <tempName>[k].x[5]
//   foo[bar].baz  → <tempName>.foo[bar].baz
//
// Returns null when a non-Member/Index segment appears anywhere
// in the chain (RangeAccessExpr, PropertyPickExpr) or when the
// base is unexpected — caller falls back at the entry level.
var renderDestructurePath = (source, recur, tempName) => {
	var stack = [];
	var node = source;
	while (
		node.type === "MemberAccessExpr" ||
		node.type === "IndexAccessExpr"
	) {
		stack.push(node);
		node = node.object;
	}
	var rootStr;
	if (node.type === "Identifier") {
		rootStr = tempName + "." + node.name;
	}
	else if (node.type === "BracketExpr") {
		rootStr = tempName + "[" + recur(node.expr) + "]";
	}
	else {
		return null;
	}
	var out = rootStr;
	for (let i = stack.length - 1; i >= 0; i--) {
		let seg = stack[i];
		if (seg.type === "MemberAccessExpr") {
			if (seg.accessor) out += "." + seg.accessor.name;
			else               out += "[" + seg.index + "]";
		}
		else { // IndexAccessExpr
			out += "[" + recur(seg.expr) + "]";
		}
	}
	return out;
};


// =============================================================
// DESTRUCTURE-PARAMETER LOWERING (DefFuncExpr)
//
// When DefFuncExpr's first (and only) param-set contains one or
// more DestructureTarget params, each such position is lowered as:
//
//   - JS-side param name: synthesized __pN (N = positional index)
//   - Optional `= <init>` JS default on the param itself when
//     Foi-side default is present
//   - A `var name = __pN.path` prelude decl per destructure entry,
//     injected at the head of the function body
//
//   defn f(<:a, :b>, c) ^a + b + c;
//   → function f(__p0, c) { var a = __p0.a, b = __p0.b; return a + b + c; }
//
//   defn f(<:a, :b>: defs) ^a + b;
//   → function f(__p0 = defs) { var a = __p0.a, b = __p0.b; return a + b; }
//
// Identifier params pass through unchanged. The function keeps
// its `function name(...)` / `(...) => ...` shape — no IIFE
// wrapper (the prelude lives inside the existing body braces).
//
// FuncBodyPipeline body falls back — no brace-injection point.
// FuncBodyExpr and FuncBodyBlock both render as `{ ... }` and
// accept prelude decls before their existing content.
// =============================================================

var renderFuncBodyWithPrelude = (body, prelude, recur) => {
	if (body.type === "FuncBodyPipeline") return null;
	var pre = prelude ? prelude + " " : "";
	if (body.type === "FuncBodyExpr") {
		return "{ " + pre + "return " + recur(body.body) + "; }";
	}
	if (body.type === "FuncBodyBlock") {
		var inner = body.stmts.map(s => recur(s) + ";").join(" ");
		return "{ " + pre + inner + " }";
	}
	return null;
};

var renderDestructureFunc = (node, paramSet, recur) => {
	var jsParams = [];
	var preludeDecls = [];
	for (let i = 0; i < paramSet.params.length; i++) {
		let p = paramSet.params[i];
		if (p.target.type === "Identifier") {
			let s = p.target.name;
			if (p.init) s += " = " + recur(p.init);
			jsParams.push(s);
			continue;
		}
		if (p.target.type === "DestructureTarget") {
			let pname = "__p" + i;
			let s = pname;
			if (p.init) s += " = " + recur(p.init);
			jsParams.push(s);
			let entries = renderDestructure(p.target, recur, pname);
			if (entries == null) return null;
			preludeDecls.push("var " + entries + ";");
			continue;
		}
		return null;
	}
	var prelude = preludeDecls.join(" ");
	var bodyStr = renderFuncBodyWithPrelude(node.body, prelude, recur);
	if (bodyStr == null) return null;
	var paramsStr = jsParams.join(", ");
	if (node.name) {
		return "function " + recur(node.name) + "(" + paramsStr + ") " + bodyStr;
	}
	return "(" + paramsStr + ") => " + bodyStr;
};


// =============================================================
// PIPELINE-BLOCK BODY EMITTER (shared by FuncBodyPipeline +
// FlowBinExpr `#>`)
//
// Given a BlockExpr RHS, a JS expression string evaluating to
// the pipeline topic, and a `topicRefBox` { ref } the caller
// uses to wire `#` resolution, emits:
//
//   var __topic = <topicExprStr>;
//   <per-entry defs>
//   <body stmts with return-injection>
//
// Mutates topicRefBox.ref = "__topic" so the caller's dispatch
// closure resolves `#` to the saved topic for the rest of this
// scope. (Per-entry defs may rebind the topic param's name or
// introduce destructure bindings that shadow it; saving up-front
// is uniformly correct across every collision shape — concise,
// named, capture, or Identifier target.)
//
// Per-entry defs lower:
//   Identifier-no-init:        `var x;`
//   Identifier-with-init:      `var x = <init>;`
//   DestructureTarget-no-init: `var __t<i> = __topic;
//                               var <destructured>;`
//   DestructureTarget-w/-init: `var __t<i> = <init>;
//                               var <destructured>;`
//
// Returns the inner stmt sequence (no braces, no IIFE), or null
// if any destructure entry can't be lowered. Caller wraps:
//   - FuncBodyPipeline → `{ <stmts> }` (already inside function
//     braces; no IIFE)
//   - FlowBinExpr      → `(() => { <stmts> })()` (expression
//     position; IIFE needed for value)
// =============================================================

var emitPipelineBlockBody = (rhs, topicExprStr, dispatch, topicRefBox) => {
	var defParts = [ "var __topic = " + topicExprStr + ";" ];
	topicRefBox.ref = "__topic";
	for (let i = 0; i < rhs.defs.entries.length; i++) {
		let entry = rhs.defs.entries[i];
		if (entry.target.type === "Identifier") {
			// Position-0 Identifier-no-init is the topic-naming
			// slot in lenient form — binds `__topic`. Explicit
			// init at position 0 overrides; trailing no-init
			// entries are declared-undefined (matches `def b;`
			// precedent).
			if (i === 0 && !entry.init) {
				defParts.push("var " + entry.target.name + " = __topic;");
			}
			else {
				// VarDefInitOpt handler renders `name` or
				// `name = init` exactly as needed.
				defParts.push("var " + dispatch(entry) + ";");
			}
			continue;
		}
		if (entry.target.type === "DestructureTarget") {
			// Lenient form: no entry-level init → bind from
			// __topic. Entry-level init present → bind from it
			// (explicit always wins over implicit).
			let tempName = "__t" + i;
			let source = entry.init ? dispatch(entry.init) : "__topic";
			let destructured = renderDestructure(entry.target, dispatch, tempName);
			if (destructured == null || destructured === "") {
				return null;
			}
			defParts.push(
				"var " + tempName + " = " + source +
				"; var " + destructured + ";"
			);
			continue;
		}
		return null;
	}
	var defs = defParts.join(" ");
	var bodyStr = emitBlockBody(rhs.body.stmts, dispatch, true);
	return defs + " " + bodyStr;
};


// =============================================================
// PIPELINE-BODY LOWERING (DefFuncExpr w/ FuncBodyPipeline)
//
// `defn foo(x) #> <RHS>;` inlines the pipeline RHS into the
// function's brace body. Topic = the function's first positional
// param (per Foi's `#` convention).
//
// RHS arms:
//   - BareBlockExpr → topic discarded; stmts emit with return-
//     injection. Unwrapped — already inside the function braces.
//   - BlockExpr     → delegates to emitPipelineBlockBody. The
//     `__topic` save means body-level shadowing of the param
//     name (Identifier rebind or destructure-introduced
//     binding) doesn't corrupt `#` resolution.
//   - ExprNoBlock / GroupedExpr — "pipeline body is a callable"
//     semantics. Deferred.
//
// First-slice param constraints (unchanged):
//   - Single-positional ParameterList (no multi-param, no
//     GatherParameter, no destructure params).
//   - Identifier param only.
//
// Topic resolution: the self-referential `dispatch` closure
// closes over `topicRefBox.ref` (initially the param name, may
// be flipped to "__topic" by emitPipelineBlockBody) and
// intercepts PipelineTopic before the bare handler-map. Because
// `dispatch` passes *itself* into every recurred handler, the
// interception survives arbitrary AST depth. Nested `#>` bodies
// build their own inner closures; lexical scoping handles
// shadowing for free.
//
// Returns the brace-wrapped function body `{ ... }`, or null
// when the param shape, RHS arm, or any destructure entry isn't
// lowerable — caller falls back the whole DefFuncExpr.
// =============================================================

var renderPipelineBody = (node, paramSet, recur) => {
	if (paramSet.type !== "ParameterList") return null;
	if (paramSet.params.length !== 1) return null;
	var p = paramSet.params[0];
	if (p.target.type !== "Identifier") return null;

	var topic = p.target.name;
	var rhs = node.body.body;

	var topicRefBox = { ref: topic };
	var dispatch = n => {
		if (n == null) return "";
		if (n.type === "PipelineTopic") return topicRefBox.ref;
		var h = handlers[n.type];
		return h ? h(n, dispatch) : fallback(n);
	};

	if (rhs.type === "BareBlockExpr") {
		return "{ " + emitBlockBody(rhs.stmts, dispatch, true) + " }";
	}

	if (rhs.type === "BlockExpr") {
		var inner = emitPipelineBlockBody(rhs, topic, dispatch, topicRefBox);
		if (inner == null) return null;
		return "{ " + inner + " }";
	}

	return null;
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
	// function-scope semantics for `def`.
	//
	// DestructureTarget target → single-eval init into temp `__t`,
	// then one decl per destructure entry reading a path on __t:
	//
	//   def < a: src.x, :b, #whole >: payload;
	//   → var __t = payload, a = __t.src.x, b = __t.b, whole = __t
	//
	// See renderDestructure / renderDestructurePath. Any entry
	// that can't be lowered (RangeAccessExpr or PropertyPickExpr
	// in a path, integer-index in a concise binding name) falls
	// back at the DefVarStmt level — partial destructure isn't
	// emittable.
	//
	// `__t` follows the existing __c / __a / __rest / __xs
	// convention; sequential top-level DefVarStmts re-declare
	// `var __t` safely per JS semantics (each stmt's entries read
	// the just-assigned __t).
	DefVarStmt(node, recur) {
		if (node.target.type === "Identifier") {
			return "var " + recur(node.target) + " = " + recur(node.init);
		}
		var entries = renderDestructure(node.target, recur, "__t");
		if (entries == null) return fallback(node);
		return "var __t = " + recur(node.init) + ", " + entries;
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

	// IndexAccessExpr { object, expr } — bracket access. `expr`
	// can be any expression; emit straight JS bracket notation.
	// Paired with the §17 cluster — every collection touched by
	// `arr[i]` flows through this handler.
	IndexAccessExpr(node, recur) {
		return recur(node.object) + "[" + recur(node.expr) + "]";
	},

	// OpFuncExpr — operator as function reference. Bare-op arm only.
	//
	//   (+)(1,2,3,4)     → left-fold via reduce: 1+2+3+4
	//   (-')(1,6,2)      → reverse args, then left-fold: 2-6-1 = -5
	//   (?=)(x,y,z)      → all-pairs every: x===y && x===z && y===z
	//   (?<)(a,b,c)      → all-pairs every: a<b && a<c && b<c
	//   (?empty)(x)      → 1-arg lift: (x == null)
	//   (!and)(a,b,c)    → De Morgan, any-falsy: a.some(x => !x)
	//   (!or)(a,b,c)     → De Morgan, all-falsy: a.every(x => !x)
	//   (!<)(a,b,c)      → De Morgan, some-pair-not-<: pairs.some with negated inner
	//
	// Binary ops lift to n-ary; unary ops stay 1-ary. Negated forms
	// use De Morgan — short-circuits naturally via .some/.every.
	//
	// All-pairs (not chained) for compare ops — matters for non-
	// transitive `?<>` where chained would miss pairs. For symmetric
	// ops (?=, ?<>) primed is a no-op; .reverse() still emits
	// uniformly. Primed is meaningless for unary; ignored.
	//
	// Non-bare arms (range `(..)`, angle-pick `(.<a,5>)`, range-
	// access `(.[1..5])`, empty-bracket `([])`) and ops absent from
	// OP_FUNC_TABLE (?<=>, !<=>, ?in, !in, ?has, !has, ?as, !as)
	// fall back.
	OpFuncExpr(node, recur) {
		if (node.properties || node.range || node.op === "[]") {
			return fallback(node);
		}
		var meta = OP_FUNC_TABLE[node.op];
		if (!meta) return fallback(node);
		var xs = node.primed ? "__xs.reverse()" : "__xs";
		if (meta.kind === "unary") {
			return "((__x) => " + meta.render("__x") + ")";
		}
		if (meta.kind === "fold") {
			return "((...__xs) => " + xs +
				".reduce((__l, __r) => __l " + meta.op + " __r))";
		}
		if (meta.kind === "pairs") {
			return "((...__xs) => " + xs +
				".every((__l, __i) => __xs.every((__r, __j) => __j <= __i || __l " +
				meta.op + " __r)))";
		}
		if (meta.kind === "notAnd") {
			return "((...__xs) => " + xs + ".some(__x => !__x))";
		}
		if (meta.kind === "notOr") {
			return "((...__xs) => " + xs + ".every(__x => !__x))";
		}
		if (meta.kind === "notPairs") {
			return "((...__xs) => " + xs +
				".some((__l, __i) => __xs.some((__r, __j) => __j > __i && !(__l " +
				meta.op + " __r))))";
		}
		return fallback(node);
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
	// §10 FLOW (continued)
	// =============================================================

	// FlowBinExpr { left, op, right } — `<expr> <op> <rhs>`.
	// Left-associative; chained `a #> b #> c` parses as
	// FlowBinExpr(FlowBinExpr(a, b), c), so recurring `left`
	// handles chains naturally.
	//
	// First-slice covers PipelineOp (`#>`) only. ComprOps
	// (`~map`, `~filter`, etc.) need a separate lowering shape
	// (comprehension-call rather than topic-injection) and
	// fall back until that handler lands.
	//
	// PipelineOp RHS arms — symmetric with FuncBodyPipeline's
	// renderPipelineBody, minus the function-body wrapper:
	//   - BlockExpr     → IIFE-wrap emitPipelineBlockBody's
	//                     output. Topic = recur(left) saved into
	//                     __topic; per-entry defs + body stmts
	//                     with return-injection.
	//   - BareBlockExpr → IIFE-wrap; topic discarded; stmts emit
	//                     with return-injection. (No defs, so
	//                     no __topic save needed; `#` inside
	//                     resolves via the dispatch closure to
	//                     a saved temp.)
	//   - ExprNoBlock / GroupedExpr → "pipeline body is a
	//     callable" semantics. Deferred — falls back.
	//
	// BareBlockExpr arm: still saves the topic into `__t` (not
	// `__topic`, since no defs collide) so `#` inside the body
	// has a stable JS-side name. Arbitrary LHS expressions can't
	// be substituted verbatim into every `#` site without
	// re-evaluation — and re-evaluation is wrong if LHS has
	// side effects.
	FlowBinExpr(node, recur) {
		var op = node.op;
		if (op !== "#>") return fallback(node);
		var rhs = node.right;

		var topicRefBox = { ref: null };
		var dispatch = n => {
			if (n == null) return "";
			if (n.type === "PipelineTopic") return topicRefBox.ref;
			var h = handlers[n.type];
			return h ? h(n, dispatch) : fallback(n);
		};

		var lhsStr = recur(node.left);

		if (rhs.type === "BareBlockExpr") {
			topicRefBox.ref = "__t";
			return "(() => { var __t = " + lhsStr + "; " +
				emitBlockBody(rhs.stmts, dispatch, true) + " })()";
		}

		if (rhs.type === "BlockExpr") {
			// emitPipelineBlockBody sets topicRefBox.ref to
			// "__topic" as part of the save.
			var inner = emitPipelineBlockBody(rhs, lhsStr, dispatch, topicRefBox);
			if (inner == null) return fallback(node);
			return "(() => { " + inner + " })()";
		}

		return fallback(node);
	},


	// =============================================================
	// §11 BLOCK EXPRESSIONS
	// =============================================================

	// BareBlockExpr { stmts } — `{ ... }` form, no defs-init.
	//
	// Lowers to an IIFE with the same return-injection rule as
	// BlockExpr. BareBlockExpr is reachable only at expression
	// positions (<AsableExpr> first arm, DefVarStmt RHS via <Expr>,
	// MatchConsequent / MatchConsequentNoSemi, FlowRHSImplIn no-defs
	// arm, FuncBodyPipeline no-defs arm), so a bare JS block `{...}`
	// won't do — needs to evaluate to a value.
	//
	// When BareBlockExpr appears as the `body` child of BlockExpr
	// or DefBlockStmt, the parent handler reads `node.body.stmts`
	// directly and inlines the lowering into its own emit — this
	// handler isn't invoked in those cases.
	//
	// Return-injection rules (mirrored in BlockExpr):
	//   - Last stmt is a value-bearing expression → prepend `return`
	//   - Last stmt is DefVarStmt → trailing `return null;` appended
	//   - Last stmt is DefFuncExpr → naturally `return function...`
	//     via the same prepend path
	//   - Empty body → `return null;` only
	BareBlockExpr(node, recur) {
		return "(() => { " + emitBlockBody(node.stmts, recur, true) + " })()";
	},

	// BlockExpr { defs, body } — `(defs) { body }` form. `body` is
	// the nested BareBlockExpr child; statements live at body.stmts.
	// Defs-init is required by the grammar (BlockExpr exclusively
	// names the defs-init form post-refactor; the no-defs case at
	// every implicit-input slot goes through BareBlockExpr).
	//
	// Lowers to an IIFE — needed for expression-position usage
	// (FlowRHSImplIn at ComprOp/PipelineOp RHS, FuncBodyPipeline
	// body) where a bare JS block would be a syntax error. defs
	// entries become `var` declarations inside the IIFE body,
	// function-scoped to the IIFE arrow:
	//
	//   (x: 1) { x; }       → (() => { var x = 1; return x; })()
	//   (x, y) { x; }       → (() => { var x; var y; return x; })()
	//   (x: 1, y) { x; }    → (() => { var x = 1; var y; return x; })()
	//
	// `var` (not `let`) is the locked declaration form — same as
	// stmt-level `def x: 2;` → `var x = 2;`. The IIFE arrow is the
	// function boundary, so `var` is already correctly scoped to
	// the block. `var x;` (no init) declares x as undefined —
	// matches Foi's declared-but-uninitialized semantics.
	//
	// DefBlockStmt is the asymmetric case: at stmt position it
	// lowers to a bare JS block where `let` is required for block
	// scoping — see DefBlockStmt handler below.
	//
	// DestructureTarget in a defs entry → fall back the whole
	// BlockExpr. A defs-init position has no implicit source
	// surfacing into this handler directly; when BlockExpr lands
	// at FlowRHSImplIn / FuncBodyPipeline body, the FlowBinExpr /
	// DefFuncExpr handler (when implemented) will own the
	// implicit-source binding before recurring here. A direct
	// recur with destructure entries means no enclosing source
	// was bound, so bailing is correct.
	BlockExpr(node, recur) {
		for (let entry of node.defs.entries) {
			if (entry.target.type !== "Identifier") return fallback(node);
		}
		var defs = node.defs.entries.map(e => "var " + recur(e) + ";").join(" ");
		if (defs) defs += " ";
		return "(() => { " + defs + emitBlockBody(node.body.stmts, recur, true) + " })()";
	},

	// DefBlockStmt { defs, body } — `def (x: 1) { ... };` form.
	// Always at stmt position (per grammar — DefBlockStmt is a
	// Stmt, never reachable as an Expr operand), so lowers to a
	// bare JS block with `let` decls for the defs entries.
	//
	//   def (x: 1) { x; };           → { let x = 1; x; }
	//   def (x: 1, y: 2) { x + y; }; → { let x = 1; let y = 2; x + y; }
	//   def (x) { x; };              → { let x; x; }
	//
	// DestructureTarget entries (strict grammar REQUIRES their
	// init at this position — no implicit source at top-level
	// `def (...)`) lower via a per-entry `__t<i>` temp + path
	// bindings, mirroring DefVarStmt's pattern but using `let`
	// for block scoping:
	//
	//   def (<:a, :b>: src) { a + b; };
	//   → { let __t0 = src, a = __t0.a, b = __t0.b; a + b; }
	//
	//   def (x: 1, <:a>: src) { x + a; };
	//   → { let x = 1; let __t1 = src, a = __t1.a; x + a; }
	//
	// Per-entry indexed temp (`__t<i>` where i is the entries-
	// list position) so multiple destructures within a single
	// defs-init don't collide.
	//
	// No return-injection — bare blocks don't have a value, and
	// DefBlockStmt's "result" is discarded at the JS level
	// regardless. The `def` keyword anchors the type tag and
	// carries no JS-side meaning here.
	//
	// Any destructure entry `renderDestructure` can't lower
	// (RangeAccessExpr / PropertyPickExpr in a source path,
	// integer-index in a concise binding name) → fall back the
	// whole DefBlockStmt; partial destructure isn't emittable.
	DefBlockStmt(node, recur) {
		var defParts = [];
		for (let i = 0; i < node.defs.entries.length; i++) {
			let entry = node.defs.entries[i];
			if (entry.target.type === "Identifier") {
				defParts.push("let " + recur(entry) + ";");
				continue;
			}
			if (entry.target.type === "DestructureTarget") {
				// Strict grammar requires init present here;
				// defensive guard for malformed AST.
				if (!entry.init) return fallback(node);
				let tempName = "__t" + i;
				let destructured = renderDestructure(entry.target, recur, tempName);
				if (destructured == null || destructured === "") {
					return fallback(node);
				}
				defParts.push(
					"let " + tempName + " = " + recur(entry.init) +
					", " + destructured + ";"
				);
				continue;
			}
			return fallback(node);
		}
		var defs = defParts.join(" ");
		var body = emitBlockBody(node.body.stmts, recur, false);
		return "{ " + defs + (body ? " " + body : "") + " }";
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
	// Body forms:
	//   - FuncBodyExpr / FuncBodyBlock route through their own
	//     handlers (each returns a `{ ... }` brace-wrapped block).
	//   - FuncBodyPipeline routes to renderPipelineBody — pipeline
	//     RHS gets inlined into the function's brace body. First-
	//     slice covers BareBlockExpr RHS only (topic discarded,
	//     stmts emit with return-injection). BlockExpr RHS (Form 3)
	//     and ExprNoBlock / GroupedExpr RHS fall back.
	//
	// DestructureTarget params → routed to renderDestructureFunc,
	// which synthesizes `__p<N>` for each destructure position,
	// keeps Identifier params as-is, and injects a `var name =
	// __pN.path` prelude into the function body:
	//
	//   defn f(<:a, :b>, c) ^a + b + c;
	//   → function f(__p0, c) { var a = __p0.a, b = __p0.b; return a + b + c; }
	//
	// FuncBodyPipeline body inside the destructure-param branch
	// still falls back (renderFuncBodyWithPrelude has no brace-
	// injection point for pipeline). Identifier-only ParameterLists
	// bypass that path and take the FuncBodyPipeline-aware route
	// below.
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
		var paramSet = node.paramSets[0];
		if (
			paramSet.type === "ParameterList" &&
			paramSet.params.some(p => p.target.type === "DestructureTarget")
		) {
			let result = renderDestructureFunc(node, paramSet, recur);
			if (result != null) return result;
			return fallback(node);
		}
		var params = recur(paramSet);
		var body;
		if (node.body.type === "FuncBodyPipeline") {
			body = renderPipelineBody(node, paramSet, recur);
			if (body == null) return fallback(node);
		}
		else {
			body = recur(node.body);
		}
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


	// =============================================================
	// §17 DATA STRUCTURE LITERALS
	// =============================================================

	// RecordTupleLit { entries } — Tuple/Record discriminator.
	//
	// Pure-positional (every entry is a bare value node) → JS
	// array (idiomatic):
	//   <1, 2, 3>       → [1, 2, 3]
	//   <<1,2>,<3,4>>   → [[1, 2], [3, 4]]
	//
	// Any keyed entry present (PickValue / ConcisePropDef /
	// ExplicitPropDef) → JS object. Bare entries become numeric
	// properties keyed by their entry-list position; keyed entries
	// render via renderRecordEntry. Paren-wrapped to disambiguate
	// from a block in expr-statement position:
	//   <x: 1, :y>            → ({ x: 1, y })
	//   <&foo, 42>            → ({ foo, 1: 42 })
	//   <&foo, x: 1, :bar, 42>→ ({ foo, x: 1, bar, 3: 42 })
	//
	// PickValue / ConcisePropDef / ExplicitPropDef have no
	// top-level handlers — they're directives, only meaningful
	// inside record/set literals. renderRecordEntry handles them.
	RecordTupleLit(node, recur) {
		var entries = node.entries;
		var isKeyed = e =>
			e.type === "PickValue" ||
			e.type === "ConcisePropDef" ||
			e.type === "ExplicitPropDef";
		var anyKeyed = entries.some(isKeyed);
		if (!anyKeyed) {
			return "[" + entries.map(e => recur(e)).join(", ") + "]";
		}
		var parts = [];
		for (let i = 0; i < entries.length; i++) {
			let e = entries[i];
			let rendered;
			if (isKeyed(e)) {
				rendered = renderRecordEntry(e, recur);
			}
			else {
				rendered = i + ": " + recur(e);
			}
			if (rendered == null) return fallback(node);
			parts.push(rendered);
		}
		return "({ " + parts.join(", ") + " })";
	},

	// SetLit { entries } → `new Set([...])`. PickValue in Set
	// context is a pure value lookup (no key); per grammar
	// SetEntry is PickValue | RecordTupleValue, so PropDefs
	// can't appear here.
	SetLit(node, recur) {
		var parts = [];
		for (let e of node.entries) {
			if (e.type === "PickValue") parts.push(recur(e.source));
			else parts.push(recur(e));
		}
		return "new Set([" + parts.join(", ") + "])";
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
