// =============================================================
// transpile.js
//
// Bootstrap Foi → JS transpiler. Throwaway infrastructure —
// discarded once Foi self-hosts. Streaming parse, synchronous
// walk, stdout output.
//
// Dispatch contract: handlers[node.type] : (node, recur) => string.
// Same shape as test-roundtrip's emitter; the eventual interpreter
// will reuse the (node, recur) skeleton with a different return
// type. (default-shapers runs at parse time and uses a different
// shape — (frame, parts) => node.)
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
// Translates a pre-processed (shaper-resolved) text chunk from
// an InterpStr / SpacingInterpStr into a JS-template-literal-
// safe form. Foi escapes (`""` → `"`, `` `` `` → `` ` ``) are
// resolved at shape time, so only JS-side escaping happens
// here:
//
//   1. `\`   → `\\`     — escape literal backslashes
//   2. `` ` `` → `\` `  — escape literal backticks
//   3. `${`  → `\${`    — prevent unintended interpolation
//
// Backslash escape precedes backtick escape so the `\` chars
// we introduce in step 2 don't get themselves doubled.
// =============================================================

var escapeTemplateChunk = s =>
	s.replace(/\\/g, "\\\\")
	 .replace(/`/g, "\\`")
	 .replace(/\$\{/g, "\\${");


// =============================================================
// INTERP-STRING EMITTER
//
// Shared lowering for InterpStr and SpacingInterpStr. Both
// chunks arrays alternate pre-processed string text (shaper
// resolved Foi escapes; spacing form additionally collapsed
// WS) and InterpExpr nodes. String chunks pass through
// escapeTemplateChunk; InterpExpr chunks wrap as `${...}`.
// =============================================================

var emitInterp = (node, recur) => {
	var out = "`";
	for (let c of node.chunks) {
		if (typeof c === "string") out += escapeTemplateChunk(c);
		else                       out += "${" + recur(c) + "}";
	}
	out += "`";
	return out;
};


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
//   kind: "unary"    — 1-arg, render fn produces body
//   kind: "fold"     — left-fold via reduce, n-ary (≥1 for value)
//   kind: "pairs"    — all-pairs every, n-ary (vacuous true on <2)
//   kind: "notAnd"   — De Morgan: any-falsy
//   kind: "notOr"    — De Morgan: all-falsy
//   kind: "notPairs" — De Morgan: some-pair-not-op
//   kind: "range3"   — strict 3-ary inclusive range check
//   kind: "in2"      — strict 2-ary membership; runtime-dispatched
//                      on container: array/string → .includes,
//                      object → numeric-key value scan
//   kind: "has2"     — strict 2-ary key-presence check
//   kind: "composeFwd" — n-ary forward composition; produces a
//                      unary fn that runs args L→R via .reduce
//   kind: "composeRev" — n-ary reverse composition; produces a
//                      unary fn that runs args R→L via .reduceRight
//
// Primed (`node.primed`) reverses arg order for n-ary kinds and
// swaps arg positions for fixed-arity kinds (range3, in2, has2).
// `.reverse()` is a no-op for symmetric ops; emit shape stays
// uniform regardless.
//
// `negate: true` on range3 / in2 / has2 wraps the test body in
// `!(...)` — used for `!<=>`, `!in`, `!has` without duplicating
// body construction.
//
// Remaining absent ops (`?as`, `!as`) fall back — runtime type-
// check semantics not yet committed for the bootstrap.
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
	"?<=>": { kind: "range3" },
	"!<=>": { kind: "range3", negate: true },
	"?in":  { kind: "in2" },
	"!in":  { kind: "in2", negate: true },
	"?has": { kind: "has2" },
	"!has": { kind: "has2", negate: true },
	"+>":   { kind: "composeFwd" },
	"<+":   { kind: "composeRev" },
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
// PER-TIER PARAM RENDERING (DefFuncExpr)
//
// Each paramSet (DefFuncExpr.paramSets[i], with tier index i)
// renders independently to:
//   - jsParams: a parenthesizable param-list string
//                ("a, b" | "__p0_0, c" | "...args" | "")
//   - prelude:  a destructure-prelude string injected at the head
//                of the tier's body ("var a = __p0_0.a, b = __p0_0.b;")
//                or "" when the tier has no destructure params
//
// DestructureTarget params at position N within tier T are lowered
// as a synthesized __p<T>_<N> JS param plus a `var name = __p<T>_<N>.path`
// prelude decl per destructure entry. Identifier params pass
// through. GatherParameter sets emit `...name`.
//
// Tier-indexed naming (__p<T>_<N>, always — no special-casing on
// collision) ensures no synthesized param at any inner tier
// shadows an outer-tier synthesized param. Outer-tier synthesized
// names stay reachable from inner-tier bodies via closure, which
// matters for FuncBodyPipeline lowering: the seed expression
// derived from the OUTERMOST paramSet lives at the outer tier
// but is referenced from the innermost body where the chain emits.
//
// Used by DefFuncExpr for both single-paramSet (the legacy path,
// flat name/anonymous emission) and multi-paramSet (nested-arrow
// folding inside-out with the outermost tier carrying the name
// when present).
//
// renderFuncBodyWithPrelude (below) injects a prelude into either
// FuncBodyExpr or FuncBodyBlock; FuncBodyPipeline returns null
// (no brace-injection point — caller routes the prelude through
// renderPipelineBody instead, which owns the body brace).
//
// Returns null when any param shape can't be lowered (non-
// Identifier/DestructureTarget target, or destructure entries
// that renderDestructure rejects) — caller falls back at the
// DefFuncExpr level.
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


// =============================================================
// PRECOND PRELUDE EMITTER (DefFuncExpr w/ FuncPrecondList)
//
// Each FuncPrecond `?[cond]: consequent` or `![cond]: consequent`
// lowers to a JS `if (<cond>) return <consequent>;` stmt prepended
// at the function body head (after any destructure prelude — preconds
// may reference destructured names). Sequential `if`-return matches
// Foi's first-match-wins semantics for free.
//
// emitCondClause handles polarity uniformly:
//   ?[c]: x   →   if (c) return x;
//   ![c]: x   →   if (!(c)) return x;
//
// Bootstrap injection strategy (curried multi-paramSet): preconds
// inject at the INNERMOST tier where all params are known. Preconds
// referencing only outer-tier params could theoretically fire at an
// earlier tier but that needs free-variable analysis; deferred.
//
// Returns "" for missing/empty preconds — DefFuncExpr's combined-
// prelude builder filters empties.
// =============================================================

var renderPrecondPrelude = (preconditions, recur) => {
	if (!preconditions || preconditions.length === 0) return "";
	return preconditions.map(pc => {
		var cond = emitCondClause(pc.clause, recur);
		return "if (" + cond + ") return " + recur(pc.consequent) + ";";
	}).join(" ");
};

var renderTierParams = (paramSet, tierIdx, recur) => {
	if (paramSet.type === "GatherParameter") {
		return { jsParams: "..." + paramSet.name, prelude: "" };
	}
	if (paramSet.type !== "ParameterList") return null;
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
			let pname = "__p" + tierIdx + "_" + i;
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
	return {
		jsParams: jsParams.join(", "),
		prelude: preludeDecls.join(" "),
	};
};


// =============================================================
// PIPELINE-BLOCK BODY EMITTER (FlowBinExpr `#>` BlockExpr arm)
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
// if any destructure entry can't be lowered. Sole caller is
// the FlowBinExpr `#>` handler, which IIFE-wraps for expression
// position: `(() => { <stmts> })()`. FuncBodyPipeline reaches
// this same path via renderPipelineBody → synthesized FlowBinExpr
// → recur → FlowBinExpr handler, so it picks up the IIFE wrap too.
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
// PIPELINE STAGE EMITTER (FlowBinExpr `#>` RHS handling)
//
// Emits one pipeline stage: `<lhsStr> #> <rhs>` as a JS expression
// string. lhsStr is already-rendered JS — the topic value flowing
// in. rhs is the unrendered AST node for the stage RHS.
//
// Three RHS arms (mirror FlowRHSImplIn alternates):
//   - BareBlockExpr → IIFE-wrap; topic saved into `__t`; stmts
//                     emit via dispatch with return-injection.
//                     `#` resolves to `__t`.
//   - BlockExpr     → defs-init + body, emitted by
//                     emitPipelineBlockBody (handles per-entry
//                     destructure binding with topic source);
//                     wrapped in IIFE. Returns null on
//                     unrenderable entries.
//   - Callable RHS  → IIFE; topic saved into `__t`. RHS evaluates
//                     to a function. When `#` appears in RHS it
//                     substitutes for the topic; otherwise the
//                     RHS is paren-wrapped and called with `__t`
//                     as the implicit final argument.
//
// Used by:
//   - FlowBinExpr `#>` handler — passes `recur(node.left)` as
//     lhsStr.
//   - renderPipelineBody — derives the seed expression string
//     from the outermost paramSet, then folds lhsStr through
//     each stage by calling emitPipelineStage iteratively.
//
// Returns the JS string for the stage, or null when the BlockExpr
// arm rejects (caller falls back at its own granularity).
// =============================================================

var emitPipelineStage = (rhs, lhsStr, recur) => {
	var topicRefBox = { ref: null, used: false };
	var dispatch = n => {
		if (n == null) return "";
		if (n.type === "PipelineTopic") {
			topicRefBox.used = true;
			return topicRefBox.ref;
		}
		var h = handlers[n.type];
		return h ? h(n, dispatch) : fallback(n);
	};

	if (rhs.type === "BareBlockExpr") {
		topicRefBox.ref = "__t";
		return "(() => { var __t = " + lhsStr + "; " +
			emitBlockBody(rhs.stmts, dispatch, true) + " })()";
	}

	if (rhs.type === "BlockExpr") {
		let inner = emitPipelineBlockBody(rhs, lhsStr, dispatch, topicRefBox);
		if (inner == null) return null;
		return "(() => { " + inner + " })()";
	}

	// Callable RHS — Identifier, CallExpr, MemberAccessExpr,
	// OpFuncExpr, GroupedExpr, etc. (every non-block arm of
	// FlowRHSImplIn's OrDispatch).
	topicRefBox.ref = "__t";
	var rhsStr = dispatch(rhs);
	var callExpr = topicRefBox.used ? rhsStr : "(" + rhsStr + ")(__t)";
	return "((__t) => " + callExpr + ")(" + lhsStr + ")";
};


// =============================================================
// COMPOSE CHAIN EMITTER (FlowBinExpr +> / <+)
//
// FlowBinExpr left-folds, so `f +> g +> h` parses as
// FlowBinExpr(FlowBinExpr(f,+>,g),+>,h). The handler gathers
// same-op leaves by walking the left subtree while `node.op`
// matches, accumulating leaves in source order; a non-matching
// subtree (different op, or any other node) is rendered as a
// single leaf via recur and contributes its arrow exactly once.
//
// Direction of emission:
//   - Forward `+>`: leftmost leaf runs first / innermost call.
//     Leaves [f, g, h] → ((__v) => (h)((g)((f)(__v)))).
//   - Reverse `<+`: leftmost leaf runs last / outermost call.
//     Leaves [f, g, h] → ((__v) => (f)((g)((h)(__v)))).
//
// Each leaf paren-wrapped — same convention as #> callable-RHS,
// defensive against leaves whose root precedence is looser than
// a call suffix (OrBinExpr / GroupedExpr / etc.).
//
// `__v` reused per nesting level — when a leaf is itself a
// compose-arrow (nested via mixed-direction parens etc.), the
// inner arrow's `__v` shadows the outer's. JS lexical scoping
// makes this safe; noisy but bootstrap-acceptable.
//
// Mixed-op chains (`f +> g <+ h`) parse as nested FlowBinExpr
// nodes with differing `op` fields. The gather walks only into
// same-op left subtrees; the differing-op subtree emits its own
// arrow via natural recursion through the FlowBinExpr handler
// and lands as one leaf in the outer gather. No explicit
// mixed-op branch needed.
// =============================================================

var gatherComposeLeaves = (node, op, recur) => {
	var leaves = [];
	var walk = n => {
		if (n.type === "FlowBinExpr" && n.op === op) {
			walk(n.left);
			leaves.push(recur(n.right));
		}
		else {
			leaves.push(recur(n));
		}
	};
	walk(node);
	return leaves;
};

var emitComposeChain = (node, recur) => {
	var leaves = gatherComposeLeaves(node, node.op, recur);
	// Forward `+>`: leaves applied L→R (leftmost is innermost call).
	// Reverse `<+`: leaves applied R→L (leftmost is outermost call).
	var ordered = node.op === "+>" ? leaves : leaves.slice().reverse();
	var inner = "__v";
	for (let leaf of ordered) {
		inner = "(" + leaf + ")(" + inner + ")";
	}
	return "((__v) => " + inner + ")";
};


// =============================================================
// PIPELINE-BODY LOWERING (DefFuncExpr w/ FuncBodyPipeline)
//
// `defn foo(x) #> ...` is conceptually sugar for `defn foo(x) ^ x #> ...`.
// This lowering literalizes the sugar: derive a seed expression
// string from the OUTERMOST paramSet's first positional, then fold
// lhsStr through the staged chain by calling emitPipelineStage
// per stage.
//
// Seeding from the outermost tier (not the innermost) treats the
// paren-grouping in `defn foo(x)(y, z)` as a CALL-SHAPE affordance
// rather than a closure-chain semantic. A defn's parameter list
// is one logical paramlist regardless of paren-grouping; the
// pipeline always flows the function's first positional argument.
// This keeps semantics stable under tier-splitting refactors and
// under partial application: `foo(3)(4, 5)`, `foo(3, 4, 5)` (if
// legal), and `foo|3|(4, 5)` all flow `3` through the same chain.
//
// Seed derivation from the outermost paramSet (= node.paramSets[0]):
//
//   - ParameterList, params.length === 0:
//       no seed → null (caller falls back the whole DefFuncExpr).
//
//   - ParameterList, position 0 = Identifier:
//       seedExprStr = the identifier's name.
//
//   - ParameterList, position 0 = DestructureTarget:
//       seedExprStr = "__p0_0" — matches renderTierParams'
//       synthesized JS param name for the outermost tier (0),
//       position 0. The destructure prelude (`var a = __p0_0.a; ...`)
//       lives at the OUTERMOST tier's body brace, emitted by the
//       multi-tier chain machinery in DefFuncExpr. Closure carries
//       __p0_0 and the destructured locals into the innermost
//       body where this chain emits.
//
//   - GatherParameter:
//       Supported only when paramSets.length === 1. Multi-tier
//       with gather anywhere → null (transpiler scope; grammar-
//       level gather positioning is a separate decision). For
//       single-tier, seedExprStr = "<gathername>[0]" — the first
//       positional argument the function received. NOT the gather
//       array itself; if the caller wants the whole arg-list to
//       flow, they pass a Tuple at the call site.
//
//   - Any other position-0 target shape:
//       null.
//
// Topic-seeding rule (orthogonal to destructure): the first
// positional ARGUMENT seeds. Destructure is an independent
// binding side-effect — destructured locals are reachable from
// stages via `#` placement or via lexical reference, but what
// flows into stage 1 is the seed value itself.
//
//   defn foo(x) #> bar;              → bar(x)
//   defn foo(<:a, :b>) #> bar;       → bar(__p0_0)  ← record flows
//   defn foo(x, y) #> add(#, y);     → add(x, y)     ← x seeds; y closes
//   defn foo(x)(y, z) #> add(#, y);  → add(x, y)     ← x seeds (outermost)
//   defn foo(*args) #> bar;          → bar(args[0])  ← first arg flows
//
// Stage iteration:
//
//   Single-stage: fbp.body is the stage-1 RHS node directly (not
//   a FlowBinExpr). Walk pushes it with fbp.op as its connector.
//
//   Multi-stage: fbp.body is itself a left-folded FlowBinExpr
//   (built by the FuncBodyPipeline shaper). Walk flattens to
//   operands+ops; deepest-left operand is stage 1 (connector =
//   fbp.op), subsequent operands carry their own connector via
//   the FlowBinExpr structure.
//
//   Per-stage: if the op is anything other than `#>`, lhsStr is
//   replaced with `null /* ?FlowBinExpr */` and iteration
//   continues — matching the FlowBinExpr handler's wholesale-
//   fallback semantic at standalone position. Subsequent `#>`
//   stages still emit, wrapping the marker.
//
// Output shape: `{ <innerTierPrelude> <precondPrelude> return <chain>; }`.
// innerTierPrelude carries destructure decls for the INNERMOST
// tier's params (covers innermost destructure positions, NOT
// outer-tier destructures — those live at their own tier's
// brace via the multi-tier chain machinery). precondPrelude
// carries precond `if`-return stmts firing at the innermost
// tier (the locked point where every param is in scope). Either
// may be empty.
//
// Returns the brace-wrapped function body string, or null when
// the outermost paramSet provides no usable seed — caller falls
// back the whole DefFuncExpr.
// =============================================================

var renderPipelineBody = (node, outerSet, innerTierPrelude, precondPrelude, recur) => {
	var seedExprStr;
	if (outerSet.type === "GatherParameter") {
		// Gather-as-seed only legal when there's exactly one tier.
		// Multi-tier with gather anywhere → fall back (transpiler
		// scope; grammar-level positioning is a separate question).
		if (node.paramSets.length !== 1) return null;
		seedExprStr = outerSet.name + "[0]";
	}
	else if (outerSet.type === "ParameterList") {
		if (outerSet.params.length === 0) return null;
		let p0 = outerSet.params[0];
		if (p0.target.type === "Identifier") {
			seedExprStr = p0.target.name;
		}
		else if (p0.target.type === "DestructureTarget") {
			seedExprStr = "__p0_0";
		}
		else {
			return null;
		}
	}
	else {
		return null;
	}

	var fbp = node.body;

	// Walk fbp.body to collect stages in left-to-right order.
	// Single-stage: fbp.body is the stage-1 RHS node directly;
	// connector is fbp.op. Multi-stage: fbp.body is a left-folded
	// FlowBinExpr, deepest-left node is stage-1's RHS, each fold
	// carries its own connector.
	var stages = [];
	var walk = n => {
		if (n.type === "FlowBinExpr") {
			walk(n.left);
			stages.push({ op: n.op, right: n.right });
		}
		else {
			stages.push({ op: fbp.op, right: n });
		}
	};
	walk(fbp.body);

	var lhsStr = seedExprStr;
	for (let stage of stages) {
		if (stage.op !== "#>") {
			// Non-`#>` stage falls back wholesale at this point in
			// the chain — matches FlowBinExpr handler's behavior at
			// standalone position. Subsequent `#>` stages still emit
			// and wrap the marker.
			lhsStr = "null /* ?FlowBinExpr */";
			continue;
		}
		let out = emitPipelineStage(stage.right, lhsStr, recur);
		if (out == null) return null;
		lhsStr = out;
	}

	// Both preludes terminate with `;` and no trailing space;
	// append " " before "return" for each non-empty piece so the
	// literal "return" lands separated.
	var pre = "";
	if (innerTierPrelude) pre += innerTierPrelude + " ";
	if (precondPrelude)   pre += precondPrelude + " ";
	return "{ " + pre + "return " + lhsStr + "; }";
};


// =============================================================
// HANDLERS
// =============================================================

var handlers = {

	// =============================================================
	// §1 PROGRAM / IDENTIFIERS
	// =============================================================

	// Pure list-of-statements. Each handler emits its content
	// without a trailing `;`; Program appends `;\n` after every
	// stmt to produce JS-conformant output.
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

	// PlainStr / SpacingEscapedStr — `text` is already pre-
	// processed by the shaper (Foi `""` escape resolved; in
	// the spacing form, Whitespace tokens already collapsed
	// to single spaces per the lexer's authoritative isWS
	// predicate). JSON.stringify handles quote-escaping,
	// newlines, and non-printables uniformly for the JS
	// string literal.
	PlainStr:          (n, r) => JSON.stringify(n.text),
	SpacingEscapedStr: (n, r) => JSON.stringify(n.text),

	// InterpStr / SpacingInterpStr → JS template literal.
	// Both chunks arrays are pre-processed by their shapers
	// (Foi escapes resolved; spacing form additionally
	// collapsed WS to single spaces). Lowering delegated to
	// emitInterp.
	InterpStr:        emitInterp,
	SpacingInterpStr: emitInterp,

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
	// intact. `:as` annotation dropped as transpilation no-op.
	GroupedExpr(node, recur) {
		return "(" + recur(node.expr) + ")";
	},

	// =============================================================
	// §7 CHAIN-FOLD: CALL + MEMBER ACCESS
	// =============================================================

	// ImpliedEmpty — synthetic node from PrefixCallSuffix's skip-
	// position detection. Carries "implied empty value at this
	// position" semantic. Lowers to JS `undefined` because JS
	// default-arg semantics only fire on `undefined`, not on
	// `null` (so `f(1, undefined, 3)` triggers position 1's default
	// param the way Foi's `f(1, empty, 3)` would; `null` would
	// pass through as a real null value).
	ImpliedEmpty: () => "undefined",

	// =============================================================
	// §7 @ FAMILY — IdentityFunc / IdentityCallExpr / AtExpr / AtCallExpr
	// =============================================================
	//
	// Bare `@` is the value identity function (`@2 ?= 2`). The
	// `@` sigil's call-form variants are syntactic sugar that
	// lower identically to non-`@` forms — what specific runtime
	// value the callee resolves to (`Id@`, `Maybe@`, `IO@`, etc.)
	// is the stdlib/runtime's concern, not the transpiler's.

	// IdentityFunc { } — standalone bare `@` as a function value
	// (e.g. `def f: @;`). Lowers to a JS arrow that returns its
	// sole argument.
	IdentityFunc: () => "((__v) => __v)",

	// IdentityCallExpr { arg } — bare `@` applied to an argument.
	// One indivisible construct: `@2` evaluates to `2`, `@ x` to
	// `x`. Emit just the arg — no wrapping call, no IIFE.
	// PartialCallExpr-on-IdentityFunc (`@|42|`) still reaches the
	// IdentityFunc handler through PartialCallExpr's generic
	// callee path; that lowers to `((__v) => __v)(42)`, which
	// evaluates to 42 — correct without a separate shortcut here.
	IdentityCallExpr: (n, r) => r(n.arg),

	// AtExpr { base } — `foo@`, `foo.bar@`, `Maybe@` as a
	// function value (no application). The `@` sigil is sugar;
	// the value is just the base. Lower by emitting the base.
	AtExpr: (n, r) => r(n.base),

	// AtCallExpr { callee, arg? } — user-callee `@`-form applied
	// (or `None@` with no arg). Covers `Foo@ x`, `foo.bar@ x`,
	// `foo @ x`, and `None@`. Callee is always an AtExpr; r(callee)
	// emits the base via the AtExpr handler. Arg-absent `None@`
	// lowers to `None()` (no-arg call — matches the unit-
	// constructor convention).
	AtCallExpr: (n, r) =>
		r(n.callee) + (n.arg == null ? "()" : "(" + r(n.arg) + ")"),

	// CallExpr { callee, args }. PrefixCallSuffix is the source
	// production; ChainExpr's fold produces this uniform shape.
	// Generic emission: recur callee + paren-wrapped arg list.
	// Two callee-shape shortcuts and one arg-shape special case:
	//
	//   - PrimedExpr callee (`foo'(a,b,c)`) — pre-reverse the
	//     args array so the emitted call applies them already in
	//     reversed order. Matches Foi guide: `f'(a,b,c)` → `f(c,
	//     b, a)`.
	//
	//     SPREAD INTERACTION: static array-reverse on args[]
	//     reorders argument positions but cannot reverse the
	//     contents of a spread (length unknown at compile time).
	//     `foo'(a, ...x, b)` requires `foo(b, ...x.toReversed(), a)`
	//     semantically — equivalent to `foo(...[a, ...x, b].reverse())`.
	//     When spread is present we emit that runtime-reverse
	//     form instead of the static-reverse shortcut.
	//
	//   - Bare-prime callee applied to a function (`(')(foo)`) —
	//     emit the same shape as `foo'` directly, skipping the
	//     wrapper IIFE OpFuncExpr's bare-prime handler would
	//     otherwise produce. Requires exactly one regular arg
	//     (not null, not ImpliedEmpty, not a NamedArg, not a
	//     SpreadArg). Multi-arg forms aren't semantically
	//     meaningful for the unary prime operator; fall through
	//     to the generic OpFuncExpr-bare-prime emission so user
	//     gets an n-ary-call shape that errors at runtime rather
	//     than producing wrong-arity JS.
	//
	//   - SpreadArg in args (`foo(...x)`, `foo(1, ...x, 2)`) —
	//     emit `..." + recur(inner)` at the spread position, JS
	//     spread does the rest. NamedArg bailout looks through
	//     SpreadArg.inner.
	CallExpr(node, recur) {
		var hasSpread = false;
		for (let a of node.args) {
			let inner = a.type === "SpreadArg" ? a.inner : a;
			if (
				inner.type === "ConciseNamedArg" ||
				inner.type === "ExplicitNamedArg"
			) {
				return fallback(node);
			}
			if (a.type === "SpreadArg") hasSpread = true;
		}
		var callee = node.callee;
		var args = node.args;
		var renderArg = a =>
			a.type === "SpreadArg"
				? "..." + recur(a.inner)
				: recur(a);
		if (callee.type === "PrimedExpr") {
			callee = callee.inner;
			if (hasSpread) {
				// Runtime reverse — static array-reverse can't
				// reverse spread contents.
				let argList = args.map(renderArg).join(", ");
				return recur(callee) + "(...[" + argList + "].reverse())";
			}
			args = args.slice().reverse();
		}
		else if (
			callee.type === "OpFuncExpr" &&
			callee.op == null && callee.primed &&
			args.length === 1 &&
			args[0] != null &&
			args[0].type !== "ImpliedEmpty" &&
			args[0].type !== "SpreadArg"
		) {
			return "((...__a) => " + recur(args[0]) +
				"(...__a.reverse()))";
		}
		var argList = args.map(renderArg).join(", ");
		return recur(callee) + "(" + argList + ")";
	},

	// PartialCallExpr { callee, args }. PartialCallSuffix is the
	// source production; ChainExpr's fold produces this uniform
	// shape. Lowers to an IIFE-bind closure that single-evals the
	// callee + supplied args at partial-app time, matching Foi's
	// "arguments are remembered for later" semantics. Plain
	// `(...__rest) => foo(a, b, ...__rest)` would re-eval arg
	// exprs per call — wrong for side-effecting args.
	//
	// Skip slots arrive as `null` entries in args (per the
	// PartialCallSuffix shaper's JS-array-literal semantic).
	// The null carries no value — the rest-call fills the slot.
	//
	// No-skip form (every arg slot bound):
	//
	//   foo|a, b|
	//   → ((__c, ...__a) => (...__rest) => __c(...__a, ...__rest))(foo, a, b)
	//
	// Skip-bearing form: walk args; null → __rest slot, node →
	// __a slot. Trailing rest spreads from the tail.
	//
	//   f|1,,2|
	//   → ((__c, ...__a) => (...__rest) =>
	//        __c(__a[0], __rest[0], __a[1], ...__rest.slice(1)))(f, 1, 2)
	//
	//   f|,,3|
	//   → ((__c, ...__a) => (...__rest) =>
	//        __c(__rest[0], __rest[1], __a[0], ...__rest.slice(2)))(f, 3)
	//
	// Primed callee: at final invocation, reverse the COMPLETE
	// accumulated arg sequence (bound + rest) before applying to
	// callee. Matches Foi guide: `(-')|1|(6)` → `-(6, 1) = 5`.
	// Uniform across all three shape arms — wrap the arg sequence
	// in `[...].reverse()` and re-spread.
	//
	//   foo'|1, 2|
	//   → ((__c, ...__a) => (...__rest) =>
	//        __c(...[...__a, ...__rest].reverse()))(foo, 1, 2)
	//
	//   f'|1,,3|
	//   → ((__c, ...__a) => (...__rest) =>
	//        __c(...[__a[0], __rest[0], __a[1], ...__rest.slice(1)].reverse()))(f, 1, 3)
	//
	// Spread-bearing form: when any SpreadArg is present, the
	// static `__a[i]` indexing breaks (a spread occupies a runtime-
	// variable number of slots), so we switch to a per-arg-named
	// bind shape. Each bound regular arg gets its own `__aN`
	// parameter; each spread gets `__sprN` bound to `[...expr]`
	// (the iterable is evaluated and captured to an array at
	// partial-app time, preserving "remembered for later"
	// semantics for spread sources like generators); each null
	// slot resolves to `__rest[N]` from the rest-call.
	//
	//   f|...x|
	//   → ((__c, __spr0) => (...__rest) =>
	//        __c(...__spr0, ...__rest))(f, [...x])
	//
	//   f|1, ...x, 2|
	//   → ((__c, __a0, __spr0, __a1) => (...__rest) =>
	//        __c(__a0, ...__spr0, __a1, ...__rest))(f, 1, [...x], 2)
	//
	//   f|1,, ...x, 2|
	//   → ((__c, __a0, __spr0, __a1) => (...__rest) =>
	//        __c(__a0, __rest[0], ...__spr0, __a1, ...__rest.slice(1)))(f, 1, [...x], 2)
	//
	//   f'|1, ...x|
	//   → ((__c, __a0, __spr0) => (...__rest) =>
	//        __c(...[__a0, ...__spr0, ...__rest].reverse()))(f, 1, [...x])
	//
	// Trailing rest emits as `...__rest` when no skips were seen,
	// otherwise `...__rest.slice(restIdx)` — the slice(0) variant
	// is functionally equivalent but noisier, and the no-skip
	// no-spread fast-path elsewhere in this handler already emits
	// the simpler form for that case.
	//
	// Deferred (fall back when present):
	//   - NamedArg variants — same JS-side decision as CallExpr.
	//     SpreadArg-wrapped NamedArg also falls back (bailout
	//     looks through SpreadArg.inner).
	PartialCallExpr(node, recur) {
		var hasSpread = false;
		for (let a of node.args) {
			if (a == null) continue;
			let inner = a.type === "SpreadArg" ? a.inner : a;
			if (
				inner.type === "ConciseNamedArg" ||
				inner.type === "ExplicitNamedArg"
			) {
				return fallback(node);
			}
			if (a.type === "SpreadArg") hasSpread = true;
		}
		var calleeNode = node.callee;
		var primed = calleeNode.type === "PrimedExpr";
		if (primed) calleeNode = calleeNode.inner;
		var callee = recur(calleeNode);
		var args = node.args;

		// Spread present — per-arg-named bind shape (uniform
		// across with/without skips, with/without primed).
		if (hasSpread) {
			let params = ["__c"];
			let binds = [callee];
			let slots = [];
			let argIdx = 0;
			let spreadIdx = 0;
			let restIdx = 0;
			for (let a of args) {
				if (a == null) {
					slots.push("__rest[" + restIdx + "]");
					restIdx++;
				}
				else if (a.type === "SpreadArg") {
					let name = "__spr" + spreadIdx;
					params.push(name);
					binds.push("[..." + recur(a.inner) + "]");
					slots.push("..." + name);
					spreadIdx++;
				}
				else {
					let name = "__a" + argIdx;
					params.push(name);
					binds.push(recur(a));
					slots.push(name);
					argIdx++;
				}
			}
			slots.push(
				restIdx === 0
					? "...__rest"
					: "...__rest.slice(" + restIdx + ")"
			);
			let inner = slots.join(", ");
			if (primed) inner = "...[" + inner + "].reverse()";
			return "((" + params.join(", ") + ") => (...__rest) => __c(" +
				inner + "))(" + binds.join(", ") + ")";
		}

		var boundArgs = args.filter(a => a != null);
		var innerArgs;

		// Zero bound args: just bind callee.
		if (boundArgs.length === 0) {
			innerArgs = primed ? "...__rest.reverse()" : "...__rest";
			return "((__c, ...__a) => (...__rest) => __c(" + innerArgs +
				"))(" + callee + ")";
		}

		var argList = boundArgs.map(a => recur(a)).join(", ");
		var bindArgs = callee + ", " + argList;
		var hasSkips = args.some(a => a == null);

		// No-skip fast path — preserves the simpler spread shape.
		if (!hasSkips) {
			innerArgs = primed
				? "...[...__a, ...__rest].reverse()"
				: "...__a, ...__rest";
			return "((__c, ...__a) => (...__rest) => __c(" + innerArgs +
				"))(" + bindArgs + ")";
		}

		// Skip path: walk args; null → __rest slot, node → __a slot.
		var slotExprs = [];
		var restIdx = 0;
		var boundIdx = 0;
		for (let a of args) {
			if (a == null) {
				slotExprs.push("__rest[" + restIdx + "]");
				restIdx++;
			}
			else {
				slotExprs.push("__a[" + boundIdx + "]");
				boundIdx++;
			}
		}
		var slotList = slotExprs.join(", ") + ", ...__rest.slice(" + restIdx + ")";
		innerArgs = primed ? "...[" + slotList + "].reverse()" : slotList;
		return "((__c, ...__a) => (...__rest) => __c(" + innerArgs +
			"))(" + bindArgs + ")";
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

	// RangeAccessExpr { object, range } — `.[range]` slice access.
	// Lowers to JS .slice(). Range end is inclusive per Foi
	// semantics, so closed/trailing forms emit `to + 1` as the
	// slice end. Object recurred once; .slice() reads receiver
	// and args left-to-right with no re-evaluation concerns.
	//
	//   arr.[1..5]   → arr.slice(1, 5 + 1)
	//   arr.[5..]    → arr.slice(5)
	//   arr.[..10]   → arr.slice(0, 10 + 1)
	//
	// Works uniformly on arrays (Tuples) and strings. Records
	// don't implement .slice() — runtime throws, matching Foi's
	// "range access is undefined on unordered records" semantics.
	RangeAccessExpr(node, recur) {
		var obj = recur(node.object);
		var range = node.range;
		if (range.type === "ClosedRangeExpr") {
			return obj + ".slice(" + recur(range.from) + ", " + recur(range.to) + " + 1)";
		}
		if (range.type === "LeadingRangeExpr") {
			return obj + ".slice(" + recur(range.from) + ")";
		}
		if (range.type === "TrailingRangeExpr") {
			return obj + ".slice(0, " + recur(range.to) + " + 1)";
		}
		return fallback(node);
	},

	// PropertyPickExpr { object, properties } — `.<a, b, 5>`
	// angle-pick. Picks the listed fields off the source and
	// returns a fresh record. Source bound into __o once (uniform
	// shape — avoids double-eval on side-effecting bases; no
	// peephole for simple identifiers).
	//
	//   rec.<a, b>   → ((__o) => ({ a: __o.a, b: __o.b }))(rec)
	//   rec.<a, 5>   → ((__o) => ({ a: __o.a, 5: __o[5] }))(rec)
	//
	// PickAccessor entries (Identifier or BuiltIn) emit
	// `name: __o.name`. PickIndex entries (bare integer string)
	// emit `<i>: __o[<i>]` — JS coerces numeric keys to strings
	// at object storage, matching pick-by-position semantics for
	// Tuples and harmless for Records.
	PropertyPickExpr(node, recur) {
		var entries = node.properties.map(p => {
			if (p.type === "PickAccessor") {
				let name = recur(p.accessor);
				return name + ": __o." + name;
			}
			if (p.type === "PickIndex") {
				return p.index + ": __o[" + p.index + "]";
			}
			return null;
		});
		if (entries.some(e => e == null)) return fallback(node);
		return "((__o) => ({ " + entries.join(", ") + " }))(" + recur(node.object) + ")";
	},

	// PrimedExpr { inner } — postfix `'` (argument-reversal
	// modifier) wrapping a chain-fold expression. Standalone form:
	// lower to a function value that reverses its args before
	// applying to the inner expression.
	//
	//   foo'      → ((...__a) => foo(...__a.reverse()))
	//   foo.bar'  → ((...__a) => foo.bar(...__a.reverse()))
	//
	// CallExpr / PartialCallExpr with a PrimedExpr callee bypass
	// this via their own primed-callee shortcuts (cleaner direct
	// shape — `foo'(1,2,3)` → `foo(3, 2, 1)` rather than going
	// through the wrapper). This handler covers every other
	// position: DefVarStmt RHS, function call arg, binary operand,
	// etc.
	//
	// `:as` annotation dropped as transpilation no-op.
	PrimedExpr(node, recur) {
		return "((...__a) => " + recur(node.inner) + "(...__a.reverse()))";
	},

	// OpFuncExpr — operator as function reference.
	//
	// Bare-op arm:
	//
	//   (+)(1,2,3,4)     → left-fold via reduce: 1+2+3+4
	//   (-')(1,6,2)      → reverse args, then left-fold: 2-6-1 = -5
	//   (')              → bare-prime as function value: __f => f'
	//   (')(foo)         → equivalent to `foo'` (see CallExpr shortcut)
	//   (?=)(x,y,z)      → all-pairs every: x===y && x===z && y===z
	//   (?<)(a,b,c)      → all-pairs every: a<b && a<c && b<c
	//   (?empty)(x)      → 1-arg lift: (x == null)
	//   (!and)(a,b,c)    → De Morgan, any-falsy: a.some(x => !x)
	//   (!or)(a,b,c)     → De Morgan, all-falsy: a.every(x => !x)
	//   (!<)(a,b,c)      → De Morgan, some-pair-not-<: pairs.some with negated inner
	//   (+>)(f,g,h)      → forward compose: produces (__v) => h(g(f(__v)))
	//                      via .reduce L→R
	//   (<+)(f,g,h)      → reverse compose: produces (__v) => f(g(h(__v)))
	//                      via .reduceRight R→L
	//   (+>')(f,g,h)     → primed reverses xs first, then reduce —
	//                      semantically equivalent to (<+)(f,g,h)
	//
	// Binary ops lift to n-ary; unary ops stay 1-ary. Negated forms
	// use De Morgan — short-circuits naturally via .some/.every.
	//
	// All-pairs (not chained) for compare ops — matters for non-
	// transitive `?<>` where chained would miss pairs. For symmetric
	// ops (?=, ?<>) primed is a no-op; .reverse() still emits
	// uniformly. Primed is meaningless for unary; ignored.
	//
	// Lifted-access arms:
	//
	//   (.<a,b>)(rec)    → fresh record with the picked fields
	//   (.[1..5])(arr)   → array/string slice, inclusive end
	//
	// Both are 1-arg function values; the source is bound once
	// into __o regardless of caller shape. Primed is meaningless
	// for these (1-arg); emitted shape is identical regardless.
	// Mirrors the standalone PropertyPickExpr / RangeAccessExpr
	// lowerings minus the bind-site application.
	//
	// Access-as-function arms — strict 2-ary; primed swaps.
	// `(.)` and `([])` lower identically: both are 2-ary forms
	// of property access where the 2nd argument is evaluated as
	// the key expression (per Foi-Guide, `.` as op-func
	// evaluates its second argument the same way `[ ]` does).
	//
	//   ([])(obj, i)     → obj[i]
	//   (.)(obj, k)      → obj[k]
	//
	// Fixed-arity range/membership/has — driven by OP_FUNC_TABLE
	// kinds range3 / in2 / has2:
	//
	//   (?<=>)(lo, x, hi)  → x >= lo && x <= hi
	//   (!<=>)(lo, x, hi)  → !(x >= lo && x <= hi)
	//   (?in)(x, c)        → element-of, runtime-dispatched on c
	//   (!in)(x, c)        → !(?in)
	//   (?has)(c, k)       → k in c
	//   (!has)(c, k)       → !(?has)
	//
	// Composition — composeFwd / composeRev kinds. Higher-order:
	// emits a function that takes the composition's arg list and
	// returns a unary function applying them in chain order. The
	// reduce-based shape is uniform across no-spread and spread
	// callsites — `(+>)(...fns)` evaluates the spread into __xs at
	// call time, then the inner arrow runs `__xs.reduce(...)`. No
	// branch on SpreadArg presence needed at this site.
	//
	// `..` (bare range op) and `?as` / `!as` still fall back.
	OpFuncExpr(node, recur) {
		// Empty-bracket lifted: ([])(obj, i) → obj[i]. Strict
		// 2-ary; primed swaps to ((__i, __o) => __o[__i]).
		// Partial application is the standard PartialCallExpr
		// path — nothing special at this site.
		if (node.op === "[]" || node.op === ".") {
			let params = node.primed ? "(__i, __o)" : "(__o, __i)";
			return "(" + params + " => __o[__i])";
		}

		// Angle-pick lifted: (.<a, b>) → ((__o) => ({ a: __o.a, b: __o.b }))
		if (node.properties) {
			let entries = node.properties.map(p => {
				if (p.type === "PickAccessor") {
					let name = recur(p.accessor);
					return name + ": __o." + name;
				}
				if (p.type === "PickIndex") {
					return p.index + ": __o[" + p.index + "]";
				}
				return null;
			});
			if (entries.some(e => e == null)) return fallback(node);
			return "((__o) => ({ " + entries.join(", ") + " }))";
		}

		// Range-access lifted: (.[1..5]) → ((__o) => __o.slice(1, 5 + 1))
		if (node.range) {
			let range = node.range;
			let sliceArgs;
			if (range.type === "ClosedRangeExpr") {
				sliceArgs = recur(range.from) + ", " + recur(range.to) + " + 1";
			}
			else if (range.type === "LeadingRangeExpr") {
				sliceArgs = recur(range.from);
			}
			else if (range.type === "TrailingRangeExpr") {
				sliceArgs = "0, " + recur(range.to) + " + 1";
			}
			else {
				return fallback(node);
			}
			return "((__o) => __o.slice(" + sliceArgs + "))";
		}
		// Bare-prime form: `(')` — the prime operator as a first-
		// class function value. `node.op` undefined with `primed:
		// true` uniquely identifies the standalone prime (other
		// primed forms like `(+')` carry both fields). Lowers to a
		// higher-order wrapper that takes a function and returns
		// its argument-reversing variant. `(')(foo)` evaluates to
		// the same function value `foo'` would produce; the direct
		// shortcut path lives in CallExpr (see Patch 5 / Patch 2
		// stack).
		if (node.op == null && node.primed) {
			return "(__f => (...__a) => __f(...__a.reverse()))";
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
		if (meta.kind === "range3") {
			let params = node.primed ? "(__hi, __x, __lo)" : "(__lo, __x, __hi)";
			let inner = "__x >= __lo && __x <= __hi";
			let body = meta.negate ? "!(" + inner + ")" : inner;
			return "(" + params + " => " + body + ")";
		}
		if (meta.kind === "in2") {
			let params = node.primed ? "(__c, __x)" : "(__x, __c)";
			let inner =
				"Array.isArray(__c) || typeof __c === \"string\" " +
				"? __c.includes(__x) " +
				": Object.keys(__c).some(__k => /^\\d+$/.test(__k) && __c[__k] === __x)";
			let body = meta.negate ? "!(" + inner + ")" : inner;
			return "(" + params + " => " + body + ")";
		}
		if (meta.kind === "has2") {
			let params = node.primed ? "(__k, __c)" : "(__c, __k)";
			let inner = "__k in __c";
			let body = meta.negate ? "!(" + inner + ")" : inner;
			return "(" + params + " => " + body + ")";
		}
		if (meta.kind === "composeFwd") {
			return "((...__xs) => (__v) => " + xs +
				".reduce((__acc, __f) => __f(__acc), __v))";
		}
		if (meta.kind === "composeRev") {
			return "((...__xs) => (__v) => " + xs +
				".reduceRight((__acc, __f) => __f(__acc), __v))";
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
	// op-table mapping. TypeCompareBinExpr falls back at node
	// granularity; FlowBinExpr has a dedicated handler below
	// (currently `#>` only).

	AddBinExpr:     (n, r) => emitBinTier(n, r, ADD_OPS),
	MulBinExpr:     (n, r) => emitBinTier(n, r, MUL_OPS),
	CompareBinExpr: (n, r) => emitBinTier(n, r, CMP_OPS),
	AndBinExpr:     (n, r) => emitBinTier(n, r, AND_OPS),
	OrBinExpr:      (n, r) => emitBinTier(n, r, OR_OPS),

	// =============================================================
	// §9 FLOW (continued)
	// =============================================================

	// FlowBinExpr { left, op, right } — `<expr> <op> <rhs>`.
	// Left-associative; chained `a #> b #> c` parses as
	// FlowBinExpr(FlowBinExpr(a, b), c), so recurring `left`
	// handles chains naturally.
	//
	// Current coverage: PipelineOp (`#>`) and both ComposeOps
	// (`+>`, `<+`). ComprOps (`~map`, `~filter`, etc.) need a
	// separate lowering shape (comprehension-call rather than
	// topic-injection) and fall back until that handler lands.
	//
	// PipelineOp RHS arms — symmetric with FuncBodyPipeline's
	// renderPipelineBody, minus the function-body wrapper:
	//   - BlockExpr     → IIFE-wrap emitPipelineBlockBody's
	//                     output. Topic = recur(left) saved into
	//                     __topic; per-entry defs + body stmts
	//                     with return-injection.
	//   - BareBlockExpr → IIFE-wrap; topic saved into __t; stmts
	//                     emit with return-injection.
	//   - Callable RHS  → IIFE-wrap; topic saved into __t. The
	//     RHS evaluates to a function; topic substitutes for any
	//     `#` references in the RHS, or is appended as the
	//     implicit final argument when no `#` appears.
	//
	//        data #> inc          → ((__t) => (inc)(__t))(data)
	//        data #> add(1)       → ((__t) => (add(1))(__t))(data)
	//        data #> add(1, #)    → ((__t) => add(1, __t))(data)
	//        data #> foo(#, 2, #) → ((__t) => foo(__t, 2, __t))(data)
	//
	//     RHS is paren-wrapped in the no-`#` shape so the
	//     trailing `(__t)` call binds tighter than any infix
	//     operator that might appear at the RHS root (rare but
	//     possible via GroupedExpr / BinaryAtom). Detection of
	//     `#` presence is via topicRefBox.used, set by dispatch
	//     when it lowers a PipelineTopic node.
	//
	// BareBlockExpr / Callable arms save the topic into `__t`
	// (not `__topic`, since no defs collide) so `#` inside the
	// body / RHS has a stable JS-side name. Arbitrary LHS
	// expressions can't be substituted verbatim into every `#`
	// site without re-evaluation — and re-evaluation is wrong
	// if LHS has side effects.
	//
	// Foi-side guarantee: callable-arm RHS must evaluate to a
	// function. Non-function RHS throws at runtime — JS-faithful
	// to the source.
	//
	// ComposeOp (`+>`, `<+`) arms — delegated to emitComposeChain.
	// Flat-inline arrow with same-op leaf-gathering across the
	// left subtree; no helper, no runtime library. Each leaf
	// paren-wrapped per the same defensive convention as `#>`
	// callable RHS. See emitComposeChain's docblock for direction
	// rules and mixed-op interaction. ComposeOp RHS is grammar-
	// restricted to OrDispatch (function value) — no block arms,
	// so no FlowRHSImplIn dispatch needed at this site.
	FlowBinExpr(node, recur) {
		if (node.op === "#>") {
			let lhsStr = recur(node.left);
			let out = emitPipelineStage(node.right, lhsStr, recur);
			return out == null ? fallback(node) : out;
		}
		if (node.op === "+>" || node.op === "<+") {
			return emitComposeChain(node, recur);
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
	// BlockExpr. The pipeline paths that handle destructure
	// binding (FlowBinExpr's `#>` BlockExpr RHS arm, and
	// FuncBodyPipeline via renderPipelineBody → synthesized
	// FlowBinExpr) don't recur into this handler — they pass
	// the BlockExpr node directly to emitPipelineBlockBody,
	// which owns the implicit-source binding. Reaching this
	// handler with destructure entries means no enclosing
	// source was wired in, so bailing is correct.
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


	// AssignmentExpr { target, source } — `x := 5`,
	// `foo.bar := 42`, `arr[0] := y + 1`. The shaper folds the
	// LHS access chain via foldAccess, so `target` is already an
	// Identifier, MemberAccessExpr, or IndexAccessExpr — each
	// with a working handler.
	//
	//   x := 5             → x = 5
	//   foo.bar := 42      → foo.bar = 42
	//   arr[0] := y + 1    → arr[0] = y + 1
	//   a.b.c := 1         → a.b.c = 1
	//
	// Assignment is value-producing in Foi (the assigned value
	// is the result of the expression), matching JS's own
	// assignment-expression semantic — `x = 5` evaluates to 5.
	// So bare emission is correct at every position the grammar
	// admits AssignmentExpr:
	//
	//   - stmt position             → `x = 5;`
	//   - DefVarStmt RHS            → `var y = x = 5;` (chained)
	//   - match consequent          → `c ? (x = 5) : null`
	//                                 (paren from outer ternary,
	//                                 not from this handler)
	//
	//   - stmt position             → `x = 5;`
	//   - DefVarStmt RHS            → `var y = x = 5;` (chained)
	//   - match consequent          → `c ? (x = 5) : null`
	//                                 (paren from outer ternary,
	//                                 not from this handler)
	//   - binary operand (paren)    → `10 + (x = 5)`
	//                                 (paren from outer GroupedExpr,
	//                                 not from this handler)
	//
	// No paren-wrap from this handler. Source-level parens around
	// an assignment used as a binary operand (`10 + (x := 5)`)
	// shape into a GroupedExpr that wraps this node; that wrapper's
	// handler emits the parens. The three operand-position paren-
	// grouping productions (GroupedOpExpr, GroupedBareOpExpr,
	// GroupedBareOpExprNoEmpty) are the only path that reaches
	// AssignmentExpr inside a binary-operand slot — BinaryAtom
	// itself doesn't admit AssignmentExpr, so the bare form
	// `10 + x := 5` remains a source-level parse error.
	AssignmentExpr(node, recur) {
		return recur(node.target) + " = " + recur(node.source);
	},


	// =============================================================
	// §13 FUNCTION DEFINITIONS
	// =============================================================

	// `defn name(params) <body>` → `function name(params) <body>`
	// `defn (params) <body>`     → `(params) => <body>`
	//
	// Multi-paramSet (currying) lowers as nested arrows inside-
	// out, with the outermost tier carrying the name when present:
	//
	//   defn add(x)(y) ^x + y;
	//   → function add(x) { return (y) => { return x + y; }; }
	//
	//   defn(x)(y) ^x + y;
	//   → (x) => (y) => { return x + y; }
	//
	// Body attaches to the innermost function; outer tiers close
	// over their params lexically (visible to the body via JS
	// closure). FuncBodyPipeline's first-positional-seeds-topic
	// rule applies to the INNERMOST tier — `defn foo(x)(y) #> ...`
	// seeds `y`, not `x`.
	//
	// Preconditions (FuncPrecondList) lower via renderPrecondPrelude
	// to a sequence of `if (cond) return consequent;` stmts injected
	// at the innermost-tier body head, AFTER the destructure prelude
	// (preconds may reference destructured names). Bootstrap strategy
	// for curried multi-paramSet: ALL preconds inject at the innermost
	// tier where every param is in scope. Preconds referencing only
	// outer-tier params could theoretically fire earlier in the call
	// chain but that needs free-variable analysis; deferred.
	//
	// Per-tier shapes (renderTierParams with tier index T):
	//   - identifier ParameterList → `(a, b) =>`
	//   - destructure ParameterList → `(__p<T>_<N>, ...) => { var prelude; return ... }`
	//   - GatherParameter → `(...args) =>`
	//   - empty ParameterList → `() =>`
	//
	// :as, :over, and the `@` method sigil (`node.at` boolean
	// flag from `defn Foo@(x) ^...`) dropped as transpilation
	// no-ops. The `@` on a defn is sugar that opts the function
	// into the no-paren call form (`Foo@ x`); call-site lowering
	// is symmetric with non-`@` calls, so the def-side flag
	// carries no JS-side meaning.
	//
	// Pipeline-body seeding: the OUTERMOST paramSet's first
	// positional seeds the chain. Trailing positionals at the
	// outermost tier and every param at inner tiers are reachable
	// from chain stages via lexical scope / closure. Multi-tier
	// is one logical paramlist for seeding purposes; paren-grouping
	// is a call-shape affordance, not a semantic boundary.
	//
	// Fall-back conditions:
	//   - any tier renderTierParams rejects (non-Identifier/
	//     DestructureTarget target, or unrenderable destructure)
	//   - renderPipelineBody returns null:
	//     · empty outermost ParameterList (no seed available)
	//     · first-positional target neither Identifier nor
	//       DestructureTarget
	//     · multi-tier with GatherParameter anywhere (gather-as-seed
	//       is single-tier only at the transpiler level)
	DefFuncExpr(node, recur) {
		var sets = node.paramSets;
		var innermostIdx = sets.length - 1;

		var tiers = [];
		for (let i = 0; i < sets.length; i++) {
			let t = renderTierParams(sets[i], i, recur);
			if (t == null) return fallback(node);
			tiers.push(t);
		}

		var precondPrelude = renderPrecondPrelude(node.preconditions, recur);

		var innermostTier = tiers[innermostIdx];
		var innermostBody;
		if (node.body.type === "FuncBodyPipeline") {
			// Seed comes from the OUTERMOST paramSet (sets[0]);
			// innerTierPrelude is the INNERMOST tier's destructure
			// decls (lands inside the pipeline body brace). Outer-
			// tier destructure preludes land at their own brace via
			// the multi-tier chain machinery below.
			innermostBody = renderPipelineBody(node, sets[0], innermostTier.prelude, precondPrelude, recur);
			if (innermostBody == null) return fallback(node);
		}
		else {
			// Combine destructure + precond preludes; either may be
			// empty. Filter empties so the joined result has no
			// stray spaces. When BOTH are empty, fall through to
			// bare body recur (preserves the no-prelude fast path).
			let combinedPrelude = [innermostTier.prelude, precondPrelude]
				.filter(Boolean)
				.join(" ");
			if (combinedPrelude) {
				innermostBody = renderFuncBodyWithPrelude(node.body, combinedPrelude, recur);
				if (innermostBody == null) return fallback(node);
			}
			else {
				innermostBody = recur(node.body);
			}
		}

		// Single-paramSet — innermost IS outermost; emit directly,
		// no chain wrapping (innermostBody is already brace-form).
		if (sets.length === 1) {
			if (node.name) {
				return "function " + recur(node.name) + "(" + innermostTier.jsParams + ") " + innermostBody;
			}
			return "(" + innermostTier.jsParams + ") => " + innermostBody;
		}

		// Multi-paramSet — fold inner tiers inside-out as arrows
		// over the next-inner chain; outermost handled separately
		// for the `function name` form.
		var chain = "(" + innermostTier.jsParams + ") => " + innermostBody;
		for (let i = innermostIdx - 1; i >= 1; i--) {
			let t = tiers[i];
			if (t.prelude) {
				chain = "(" + t.jsParams + ") => { " + t.prelude + " return " + chain + "; }";
			}
			else {
				chain = "(" + t.jsParams + ") => " + chain;
			}
		}

		var outerTier = tiers[0];
		if (node.name) {
			if (outerTier.prelude) {
				return "function " + recur(node.name) + "(" + outerTier.jsParams + ") { " + outerTier.prelude + " return " + chain + "; }";
			}
			return "function " + recur(node.name) + "(" + outerTier.jsParams + ") { return " + chain + "; }";
		}
		if (outerTier.prelude) {
			return "(" + outerTier.jsParams + ") => { " + outerTier.prelude + " return " + chain + "; }";
		}
		return "(" + outerTier.jsParams + ") => " + chain;
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
	// `;` naturally. Bootstrap commitment: a block with no
	// ReturnExpr falls through with no JS-side `return`, leaving
	// the function value as JS undefined. Whether Foi's settled
	// semantic for the no-^ case is undefined / empty / something
	// else is a downstream interpreter question.
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
	// BareBlockExpr consequent (`?[c]: { x; y }`) composes
	// correctly: recur invokes the BareBlockExpr handler, which
	// emits an IIFE with return-injection (via emitBlockBody's
	// withReturn:true mode), so `?[c]: { x; y }` lowers to
	// `c ? (() => { x; return y; })() : null` and evaluates to
	// `y` when c is truthy. BlockExpr (the defs-init form) isn't
	// reachable as a GuardedExpr consequent — it's only admitted
	// at FlowRHSImplIn / FuncBodyPipeline positions per §11.
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
