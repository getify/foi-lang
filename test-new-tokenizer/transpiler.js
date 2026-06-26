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
// NEGATE EMITTER
//
// Shared lowering for `!`-as-applied-to-anything. Foi `!` is
// operand-type-overloaded per guide §"Negating A Predicate":
//   - operand is a function → return its boolean complement
//     (a function that calls the original and negates its result)
//   - operand is anything else → boolean flip (JS `!`)
//
// `?` does NOT carry this overload — boolean coercion of any
// value is well-defined and the guide doesn't promise a "truthy-
// only" function. `?` stays raw `!!`.
//
// Two forms because the consumers want different framings:
//
//   negateBody(ref) — bare ternary body, used by OP_FUNC_TABLE's
//                     "!" render. The OpFuncExpr `kind: "unary"`
//                     arm already wraps `((__x) => <body>)`
//                     around render's output, so we contribute
//                     just the body and let it do the bind.
//
//   emitNegate(operand) — IIFE-wrapped form, used by
//                     SYM_UNARY_OPS["!"]. SymbolicUnaryExpr's
//                     operand may be an arbitrary expression
//                     (a call, member access, etc.), so we bind
//                     once into __x to avoid re-evaluating side
//                     effects across the typeof check and the
//                     two ternary arms.
//
// Both share `negateBody` as the dispatch core. __args is local
// to the inner complement arrow; nesting is safe under JS
// lexical scoping (same convention as emitRangeBody internals).
// =============================================================

var negateBody = ref =>
	"typeof " + ref + " === \"function\" " +
	"? (...__args) => !" + ref + "(...__args) " +
	": !" + ref;

var emitNegate = operand =>
	"((__x) => " + negateBody("__x") + ")(" + operand + ")";


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
	"!": emitNegate,
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
//   kind: "pipeline"  — n-ary pipeline-apply: first arg seeds the
//                      running value; each subsequent arg is called
//                      as a function with the accumulated value.
//                      `(#>)(11, f, g, h)` ≡ `h(g(f(11)))` ≡
//                      `11 #> f #> g #> h`. Primed reverses xs
//                      first via .reverse() — `(#>')(h, g, f, 11)`
//                      is the same value-wise as the canonical
//                      form. Saved into a temp at emit-site so
//                      the .reverse() only fires once.
//   kind: "spread"    — 1-ary apply lift: takes a function/op,
//                      returns a unary fn that spreads its single
//                      Tuple/array argument into the wrapped
//                      function. `(...)(+)(nums)` ≡ `(+)(...nums)`.
//                      Primed flips the lift direction — gather
//                      rather than spread: `(...')(f)(a, b, c)` ≡
//                      `f(<a, b, c>)`. The inverse of `(...)`, and
//                      the only place primed-1-ary carries meaning
//                      (the lifted-access arms have no meaningful
//                      inverse direction and stay primed-no-op).
//   kind: "range2"    — strict 2-ary inclusive range producer;
//   kind: "each"      — 2-ary side-effect loop: takes (range, body)
//                      and iterates body over range, returning
//                      the range unchanged. Body's per-iter return
//                      checked for `Done@` sentinel (early break).
//                      Mirrors emitEachOp's Tuple/Record arm only —
//                      conditional-range (CondClause) is syntactic
//                      and unreachable as a runtime value through
//                      the OpFuncExpr surface. Primed swaps to
//                      (body, range) order.
//   kind: "effector"  — variadic 1-or-2-arg `%` effector dispatch.
//                      `(%)(src)` ≡ `src%` (bare); `(%)(src, arg)`
//                      ≡ `src % arg` (binary). Runtime check for
//                      `.run` function hook; falls through to
//                      identity return of source when absent
//                      (Lazy@-mock semantic — see EffectorCallExpr
//                      handler for the matching direct lowering).
//                      Primed swaps to (arg, src) order — strictly
//                      2-arg-shaped under prime; 1-arg primed is
//                      undefined-source territory, falls through
//                      to identity-return of undefined (silent
//                      failure matches other primed fixed-arity
//                      ops like (?<=>')).
//
// Primed (`node.primed`) reverses arg order for n-ary kinds and
// swaps arg positions for fixed-arity kinds (range3, in2, has2,
// range2, each).
//
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
	"!":      { kind: "unary", render: negateBody },
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
	"#>":   { kind: "pipeline" },
	"...":  { kind: "spread" },
	"..":   { kind: "range2" },
	"~each": { kind: "each" },
	"%":     { kind: "effector" },
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
// PICKVALUE CLASSIFICATION + RENDERERS
//
// PickValue (`&foo`, `&foo.bar`, `&foo.5`, `&foo[i]`,
// `&foo.<a,b>`, `&foo.[1..5]`) is grammar-uniform — one node
// type, one source field — but semantically dispatches on the
// SOURCE's outermost chain segment after foldAccess. Two
// orthogonal axes drive the lowering:
//
//   1. Mode discriminator: does this pick contribute a NAMED
//      field to the enclosing RecordTupleLit, forcing object
//      mode? Positional / index / bulk-spread picks do not;
//      named-member picks and named-subset picks do.
//
//   2. Value shape: does it carry a SINGLE value (single-pick)
//      or a STREAM of values (spread)? Integer-member and
//      index-access shapes are single; everything else spreads.
//
// Source classification table:
//
//   Identifier / BuiltIn               bulk-spread,    neutral
//   MemberAccessExpr w/ accessor       named-pick,     OBJECT-FLIP
//   MemberAccessExpr w/ index          single-pick,    neutral
//   IndexAccessExpr                    single-pick,    neutral
//   PropertyPickExpr all-PickIndex             subset-spread,  neutral
//   PropertyPickExpr any-PickAccessor          subset-spread,  OBJECT-FLIP
//   PropertyPickExpr any-PickComputed/Spread   subset-spread,  OBJECT-FLIP
//   RangeAccessExpr                            slice-spread,   neutral
//
// Chained access (`&foo.bar.baz`, `&foo.<a,b>.x`) inherits
// classification from the OUTERMOST segment.
//
// Three renderers cover the emission shapes:
//
//   renderPickValueSingle — bare value for single-pick shapes;
//     `foo[5]`, `foo.at(-1)`, `foo[expr]`. Returns null for
//     non-single shapes.
//
//   renderPickValueSpread — record-context spread emission;
//     `...foo`, `...({ a: foo.a })`, `...[foo[1], foo[3]]`,
//     `...foo.slice(...)`. Returns null for single-pick shapes
//     and for unrenderable sub-parts. Used by renderRecordEntry
//     (object mode) and by RecordTupleLit's array-mode loop.
//
//   renderPickValueSetEntry — set-context emission. Sets are
//     flat value streams: named-member picks contribute one
//     value (not key:value), subset picks spread VALUES only.
//     Bulk / slice / index shapes match renderPickValueSpread.
//
// Cross-mode footguns left to runtime: array-spread of an
// object throws; object-spread of an array spreads numeric
// keys. Transpiler emits the natural lowering — honest failure.
// =============================================================

var pickForcesObjectMode = src => {
	if (src.type === "MemberAccessExpr") return src.accessor != null;
	if (src.type === "PropertyPickExpr") {
		// PickAccessor / PickComputed / PickSpread all force object
		// mode — each contributes named (static or dynamic) fields.
		// Only all-PickIndex stays in positional/array mode.
		return src.properties.some(p =>
			p.type === "PickAccessor" ||
			p.type === "PickComputed" ||
			p.type === "PickSpread"
		);
	}
	return false;
};

var renderPickValueSingle = (src, recur) => {
	if (src.type === "MemberAccessExpr" && src.index != null) return recur(src);
	if (src.type === "IndexAccessExpr") return recur(src);
	return null;
};

var renderPickValueSpread = (src, recur) => {
	if (src.type === "Identifier" || src.type === "BuiltIn") {
		return "..." + recur(src);
	}
	if (src.type === "RangeAccessExpr") {
		return "..." + recur(src);
	}
	if (src.type === "PropertyPickExpr") {
		let base = recur(src.object);
		let forcesObject = src.properties.some(p =>
			p.type === "PickAccessor" ||
			p.type === "PickComputed" ||
			p.type === "PickSpread"
		);
		let entries = src.properties.map(p => {
			if (p.type === "PickAccessor") {
				let name = recur(p.accessor);
				return name + ": " + base + "." + name;
			}
			if (p.type === "PickIndex") {
				// Object mode: index serves as both key and lookup.
				// Array mode: bare value only.
				return forcesObject
					? p.index + ": " + base + "[" + p.index + "]"
					: base + "[" + p.index + "]";
			}
			if (p.type === "PickComputed") {
				// Inline shape — computed expression evaluated twice
				// (property name + lookup index). Matches this site's
				// existing non-single-eval pattern for `base`; the
				// standalone PropertyPickExpr handler single-evals,
				// this PickValue-inline site does not.
				let key = recur(p.expr);
				return "[" + key + "]: " + base + "[" + key + "]";
			}
			if (p.type === "PickSpread") {
				// Source evaluated once (passed into .map()).
				let s = recur(p.source);
				return "...Object.fromEntries(" + s +
					".map(__n => [__n, " + base + "[__n]]))";
			}
			return null;
		});
		if (entries.some(e => e == null)) return null;
		return forcesObject
			? "...({ " + entries.join(", ") + " })"
			: "...[" + entries.join(", ") + "]";
	}
	return null;
};

var renderPickValueSetEntry = (src, recur) => {
	if (src.type === "Identifier" || src.type === "BuiltIn") {
		return "..." + recur(src);
	}
	if (src.type === "MemberAccessExpr" && src.accessor) {
		return recur(src);
	}
	if (src.type === "RangeAccessExpr") {
		return "..." + recur(src);
	}
	if (src.type === "PropertyPickExpr") {
		let base = recur(src.object);
		let entries = src.properties.map(p => {
			if (p.type === "PickAccessor") {
				return base + "." + recur(p.accessor);
			}
			if (p.type === "PickIndex") {
				return base + "[" + p.index + "]";
			}
			if (p.type === "PickComputed") {
				// Sets are flat value streams — only the LOOKUP
				// matters, not the key. Single use; no double-eval
				// concern beyond the source base.
				return base + "[" + recur(p.expr) + "]";
			}
			if (p.type === "PickSpread") {
				let s = recur(p.source);
				return "..." + s + ".map(__n => " + base + "[__n])";
			}
			return null;
		});
		if (entries.some(e => e == null)) return null;
		return "...[" + entries.join(", ") + "]";
	}
	return renderPickValueSingle(src, recur);
};


// =============================================================
// RECORD-ENTRY EMITTER
//
// Renders a single object-mode RecordTupleLit entry to a JS
// object-property string. Position is passed for single-pick
// PickValue shapes that take their target list position as the
// key — matches the guide's shorthand-equivalent semantic:
//   `< 1, 3, &nums.1, 7, 9 >` ≡ `< 1, 3, 2: nums.1, 7, 9 >`.
//
// Returns null only when the entry shape is genuinely
// unrenderable as an object property — RecordTupleLit's handler
// then falls back at the literal level (granular fallback).
//
//   ConcisePropDef:
//     <:foo>          → foo                  (JS shorthand)
//     <:5>            → null  (no clean JS semantic for numeric)
//
//   PickValue (source-dispatched — see PICKVALUE CLASSIFICATION):
//     <&foo>          → ...foo               (bulk spread)
//     <&Maybe>        → ...Maybe
//     <&foo.bar>      → bar: foo.bar         (named pick — rename-preserving)
//     <&foo.bar.baz>  → baz: foo.bar.baz
//     <&foo.<a,b>>    → ...({ a: foo.a, b: foo.b })  (named subset spread)
//     <&foo.<1,3>>    → ...[foo[1], foo[3]]          (positional subset spread)
//     <&foo.[1..5]>   → ...foo.slice(1, 5 + 1)       (slice spread)
//     <&foo.5> @ pos 2  → 2: foo[5]          (single-pick, target-pos key)
//     <&foo[i]> @ pos 0 → 0: foo[i]
//
//   ExplicitPropDef:
//     <x: 1>          → x: 1
//     <5: x>          → 5: x
//     <%foo: 1>       → [foo]: 1             (computed key)
// =============================================================

var renderRecordEntry = (entry, recur, position) => {
	if (entry.type === "ConcisePropDef") {
		let src = entry.source;
		if (src.type === "Identifier") return src.name;
		return null;
	}
	if (entry.type === "PickValue") {
		let src = entry.source;
		// Named pick — rename-preserving: `bar: <chain>`.
		if (src.type === "MemberAccessExpr" && src.accessor) {
			return src.accessor.name + ": " + recur(src);
		}
		// Spread shapes (bulk / subset / slice).
		let spread = renderPickValueSpread(src, recur);
		if (spread != null) return spread;
		// Single-pick shapes (integer-member, index-access):
		// emit at target position per the guide's expansion.
		let single = renderPickValueSingle(src, recur);
		if (single != null) return position + ": " + single;
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
// EACH-OP EMITTERS (FlowBinExpr ~each)
//
// Side-effect-only loop. Result is range-unchanged for Tuple /
// Record range; empty Tuple `[]` for conditional range (no
// inherent value to thread out). Per-iteration body return is
// inspected for the bespoke `Done@` sentinel — `{__tag: "Done"}`
// triggers early break, all other returns ignored. Done@ only
// breaks the innermost ~each (no labeled propagation).
//
// Two lowering shapes by LHS:
//
//   Tuple/Record range:
//     ((__r) => {
//         var __src = Array.isArray(__r) ? __r : Object.values(__r);
//         for (let __v of __src) { <bodyStmt> }
//         return __r;
//     })(<rangeExpr>)
//
//   Conditional range (CondClause LHS):
//     (() => {
//         while (<cond>) { <bodyStmt> }
//         return [];
//     })()
//
// Body per-iter shape (three RHS arms, parallel to FlowRHSImplIn):
//
//   BareBlockExpr  — IIFE-wrap body stmts, no __v param.
//   BlockExpr      — defs-init with __v as implicit source for
//                    position-0 Identifier-no-init / DestructureTarget-
//                    no-init. Reject on conditional range (no source
//                    to bind from — falls back whole node).
//   Callable RHS   — `(<rhsStr>)(__v)`. For conditional range, call
//                    with no arg.
//
// Each per-iter stmt-sequence ends with the Done@ sentinel check:
//   var __result = <body-expr>;
//   if (__result?.__tag === "Done") break;
//
// `#` (PipelineTopic) is NOT a topic ref inside compr bodies per
// Foi semantic — no topicRefBox wiring here, no implicit substitution.
// A `#` written inside a ~each body falls back via the generic
// PipelineTopic-handler path (no dedicated handler → fallback,
// emits `null /* # */`).
//
// Object.values for Record iteration allocates a fresh array per
// ~each call (once, not per-iter). Acceptable cost for unifying
// the loop body across both source shapes.
// =============================================================

var emitEachBlockBody = (rhs, recur) => {
	var defParts = [];
	for (let i = 0; i < rhs.defs.entries.length; i++) {
		let entry = rhs.defs.entries[i];
		if (entry.target.type === "Identifier") {
			// Position-0 Identifier-no-init binds from __v; other
			// positions follow standard def behavior (declared,
			// optionally initialized).
			if (i === 0 && !entry.init) {
				defParts.push("var " + entry.target.name + " = __v;");
			}
			else {
				defParts.push("var " + recur(entry) + ";");
			}
			continue;
		}
		if (entry.target.type === "DestructureTarget") {
			// Lenient form: no entry-level init → bind from __v.
			// Explicit init present → bind from it.
			let tempName = "__t" + i;
			let source = entry.init ? recur(entry.init) : "__v";
			let destructured = renderDestructure(entry.target, recur, tempName);
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
	var bodyStr = emitBlockBody(rhs.body.stmts, recur, true);
	return defs + " " + bodyStr;
};

var emitEachBodyStmt = (rhs, recur, hasValue) => {
	if (rhs.type === "BareBlockExpr") {
		return "var __result = (() => { " +
			emitBlockBody(rhs.stmts, recur, true) +
			" })(); if (__result?.__tag === \"Done\") break;";
	}
	if (rhs.type === "BlockExpr") {
		// BlockExpr's defs-init requires an implicit source; reject
		// for conditional-range (no source) by returning null →
		// caller falls back whole node.
		if (!hasValue) return null;
		let inner = emitEachBlockBody(rhs, recur);
		if (inner == null) return null;
		return "var __result = (() => { " + inner + " })(); " +
			"if (__result?.__tag === \"Done\") break;";
	}
	// Callable RHS — Identifier, CallExpr, MemberAccessExpr,
	// OpFuncExpr, GroupedExpr, etc.
	var rhsStr = recur(rhs);
	var callArg = hasValue ? "__v" : "";
	return "var __result = (" + rhsStr + ")(" + callArg + "); " +
		"if (__result?.__tag === \"Done\") break;";
};

var emitEachOp = (node, recur) => {
	var hasValue = node.left.type !== "CondClause";
	var bodyStmt = emitEachBodyStmt(node.right, recur, hasValue);
	if (bodyStmt == null) return fallback(node);

	if (!hasValue) {
		let cond = emitCondClause(node.left, recur);
		return "(() => { while (" + cond + ") { " + bodyStmt + " } return []; })()";
	}

	var rangeStr = recur(node.left);
	return "((__r) => { " +
		"var __src = Array.isArray(__r) ? __r : Object.values(__r); " +
		"for (let __v of __src) { " + bodyStmt + " } " +
		"return __r; " +
	"})(" + rangeStr + ")";
};


// =============================================================
// RANGE BODY EMITTER
//
// Shared lowering for `(..)` OpFuncExpr value form and top-level
// ClosedRangeExpr value form. Both produce an inclusive sequence
// of numbers or single-char strings; direction is inferred from
// endpoint comparison (ascending when __to >= __from, descending
// otherwise). Mismatched-type endpoints throw TypeError at run-
// time — honest failure beats JS-faithful coercion weirdness.
//
// Endpoints bind into __from / __to via the arrow's own parameter
// list. No separate IIFE wrapper is needed: at the OpFuncExpr
// site the consumer (CallExpr) supplies the args; at the
// ClosedRangeExpr site the appended `(fromStr, toStr)` does. In
// both cases the endpoint expressions are evaluated once, then
// only __from / __to are referenced inside.
//
// Primed swaps __from / __to in the parameter list. Semantically
// meaningful because direction is endpoint-derived: (..)(1,5)
// ascends; (..')(1,5) descends (__from receives 5, __to receives
// 1, step becomes -1). ClosedRangeExpr never carries primed —
// callers pass `false`.
//
//   emitRangeBody(primed, null, null)
//     → bare arrow value, used by the OpFuncExpr `range2` arm.
//       CallExpr applies args at the use site.
//
//   emitRangeBody(false, fromStr, toStr)
//     → arrow + trailing application, used by ClosedRangeExpr.
// =============================================================

var emitRangeBody = (primed, fromStr, toStr) => {
	var params = primed ? "(__to, __from)" : "(__from, __to)";
	var arrow =
		"(" + params + " => { " +
		"if (typeof __from !== typeof __to) throw new TypeError(\"range endpoints must be same type\"); " +
		"let __isStr = typeof __from === \"string\"; " +
		"let __s = __isStr ? __from.charCodeAt(0) : __from; " +
		"let __e = __isStr ? __to.charCodeAt(0) : __to; " +
		"let __step = __e >= __s ? 1 : -1; " +
		"let __len = Math.abs(__e - __s) + 1; " +
		"return Array.from({ length: __len }, __isStr " +
		"? (_, __i) => String.fromCharCode(__s + __i * __step) " +
		": (_, __i) => __s + __i * __step); })";
	if (fromStr == null) return "(" + arrow + ")";
	return "(" + arrow + "(" + fromStr + ", " + toStr + "))";
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
// DEPMATCH ATOM TABLES & RENDERER
//
// Atom op classification for DepMatchExpr clauses. Each atom in
// a DepCondClause is rendered against `__topic` (the IIFE-bound
// single-eval topic) as a boolean JS subexpression; the per-
// clause list is OR-joined and optionally negated by polarity.
//
// Three lowering paths:
//
//   DEP_INFIX_OPS — positive ops whose Foi semantic maps to a
//     direct JS infix operator. Emit `__topic <op> <rhs>`. Same
//     ops + JS mappings as CMP_OPS / AND_OPS / OR_OPS at their
//     binary positions; consistency keeps `?(x){ ?[?= 1] }` and
//     `?{ ?[x ?= 1] }` lowering to the same shape.
//
//   DEP_NEGATED_TO_POSITIVE — negated forms (!<, !<=, !>, !>=,
//     !and, !or). Emit `!(__topic <positive-op> <rhs>)`. The
//     != / !<> pair maps directly via DEP_INFIX_OPS instead
//     since JS has the natural !== / === counterparts; only the
//     order-relational and boolean-logic ops need De Morgan
//     wrapping. Single-eval __topic on both sides is from the
//     IIFE param, so no double-eval concern.
//
//   DEP_OPFUNC_OPS — ops whose 2-ary lowering involves runtime
//     dispatch (?in / !in / ?has / !has). Emit by recurring on
//     a synthesized OpFuncExpr node and calling the resulting
//     higher-order function with (__topic, <rhs>). Single source
//     of truth for the dispatch — the OP_FUNC_TABLE in2 / has2
//     templates own the logic, and atom emission mirrors what
//     the user-side `(?in)(topic, coll)` would produce.
//
// Ops outside these three sets — ?as / !as (static-checker
// layer), ?$= / !$= (set equality, out of scope), or anything
// else unrecognized — return null from renderDepAtom, triggering
// whole-node fallback in the DepMatchExpr handler. Partial
// lowering of an OR-joined atom list silently changes semantics;
// granular fallback at the atom level isn't safe here.
//
// `#` inside atoms: the topic is implicit on each op's LHS, so
// the language treats `#` inside an atom as semantically invalid.
// The atom renderer uses the OUTER `recur` (not the consequent's
// topic-rewriting dispatch); a `#` written inside an atom either
// resolves to an enclosing `#>` topic (if any) or falls back to
// `null /* # */`. Honest failure for what the language doesn't
// support.
// =============================================================

var DEP_INFIX_OPS = {
	"?=":   "===",
	"!=":   "!==",
	"?<>":  "!==",
	"!<>":  "===",
	"?<":   "<",
	"?<=":  "<=",
	"?>":   ">",
	"?>=":  ">=",
	"?and": "&&",
	"?or":  "||",
};

var DEP_NEGATED_TO_POSITIVE = {
	"!<":   "?<",
	"!<=":  "?<=",
	"!>":   "?>",
	"!>=":  "?>=",
	"!and": "?and",
	"!or":  "?or",
};

var DEP_OPFUNC_OPS = new Set([ "?in", "!in", "?has", "!has" ]);

var renderDepAtom = (atom, atomDispatch) => {
	// Bare ExprNoBlock — equality test against topic.
	if (atom.type !== "DepCondBoolExpr") {
		return "__topic === " + atomDispatch(atom);
	}

	var op = atom.op;

	if (op in DEP_INFIX_OPS) {
		return "__topic " + DEP_INFIX_OPS[op] + " " + atomDispatch(atom.right);
	}

	if (op in DEP_NEGATED_TO_POSITIVE) {
		let posJs = DEP_INFIX_OPS[DEP_NEGATED_TO_POSITIVE[op]];
		return "!(__topic " + posJs + " " + atomDispatch(atom.right) + ")";
	}

	if (DEP_OPFUNC_OPS.has(op)) {
		// Synthesize an OpFuncExpr node and recur — the existing
		// OP_FUNC_TABLE in2 / has2 templates produce the 2-ary
		// dispatch function. Calling shape mirrors the user-side
		// equivalent: `(?in)(topic, coll)`.
		let synth = { type: "OpFuncExpr", op, primed: false };
		return "(" + atomDispatch(synth) + ")(__topic, " + atomDispatch(atom.right) + ")";
	}

	// ?as / !as, ?$= / !$=, anything else — whole-node fallback.
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

	// NumberLit.text is the raw source lexeme — concat of Escape +
	// Number tokens (escape forms) or a bare Number / IntegerLit
	// value (non-escape forms). Non-escape forms are JS-compatible;
	// pass `n.text` through unchanged.
	//
	// Five escape forms dispatch on text[1]:
	//
	//   \hDIGS  → hex          → 0xDIGS                        (sign carried)
	//   \oDIGS  → octal        → 0oDIGS                        (sign carried)
	//   \bDIGS  → binary       → 0bDIGS                        (sign carried)
	//   \DIGS   → sep'd decimal/integer — strip the leading `\`;
	//             JS accepts numeric separators natively.
	//   \@DIGS  → monadic / arbitrary-precision — out of bootstrap
	//             scope (locked); falls back to placeholder.
	//
	// The lex `<EscapedNumber>` dispatcher has a sixth arm
	// (EscapeUnicode + UnicodeNumber, the `\u<hex>` form), but it is
	// NOT reachable here — the syn narrowing excludes `\u` from
	// EscapedNumberLit at value position; it's admitted exclusively
	// as the sole contents of an InterpExpr slot via a separate
	// UnicodeCharLit production (own type, own handler below).
	//
	// Sign for \h/\o/\b: per Lexical-Grammar.md Note 5, the `-` is
	// consumed inside the Number content (HexNumber/OctalNumber/
	// BinaryNumber's `"-"? Digit+`), so `\h-FF` arrives as text
	// "\h-FF" — split the sign before prepending the radix prefix,
	// then re-attach. EscapePlain's signed BareNumber comes through
	// as `\-1_000` with text "\-1_000"; just dropping the `\` yields
	// valid JS, since JS already accepts the leading `-` and the
	// numeric separators natively.
	//
	// Asymmetry note: `\5_000` (PositiveIntegerLitWithSep, unsigned
	// separator-bearing integer) emits an Escape + PositiveIntegerLit
	// pair that the syn NumberLit production DOES admit at value
	// position (via the widened first-alt). It also reaches this
	// handler via shapePropertyExpr's synthesized NumberLit (record/
	// tuple key positions). The dispatch arms below handle both
	// paths identically — the marker-digit branch covers it.
	NumberLit(n, r) {
		var text = n.text;
		if (text[0] !== "\\") return text;

		var marker = text[1];

		if (marker === "h" || marker === "o" || marker === "b") {
			let radix = marker === "h" ? "0x" : marker === "o" ? "0o" : "0b";
			let body = text.slice(2);
			let sign = "";
			if (body[0] === "-") {
				sign = "-";
				body = body.slice(1);
			}
			return sign + radix + body;
		}

		// EscapePlain — separator-bearing decimal or integer. Sign
		// and digits are already JS-compatible; just drop the `\`.
		if (marker === "-" || (marker >= "0" && marker <= "9")) {
			return text.slice(1);
		}

		// \@ — monadic / arbitrary-precision, out of bootstrap scope.
		return fallback(n);
	},

	// UnicodeCharLit.text is the verbatim "\u<hex>" lexeme. Reachable
	// only as the sole contents of an InterpExpr slot (see parser.js
	// InterpExpr) — the `\u<hex>` form is a character escape, not a
	// numeric literal, and has its own type tag distinct from
	// NumberLit. `\u` has no sign (UnicodeNumber is unsigned per
	// Lexical-Grammar.md Note 6).
	//
	// String.fromCodePoint handles the full Unicode range without
	// branching on digit count: the JS `"\uXXXX"` literal form caps
	// at four hex digits (BMP only), but UnicodeNumber admits
	// HexDigit+ of any length, so explicit fromCodePoint is needed.
	UnicodeCharLit: (n, r) => "String.fromCodePoint(0x" + n.text.slice(2) + ")",

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
	//
	// Bespoke `Done@` intercept (low-fidelity): `Done@ <expr>`
	// lowers to the sentinel object `{__tag: "Done"}`, with the
	// payload discarded. Used by ~each (and eventually other
	// comprehensions) as the early-termination signal. Grammar
	// requires a payload via AtCallExpr arm-2 (the no-payload
	// form is reserved for `BuiltinNone @`); idiomatic spelling
	// is `Done@ 1` or `Done@ empty`. The check inside ~each is
	// `__result?.__tag === "Done"` — optional-chaining handles
	// non-object results cleanly. Globally intercepted here
	// rather than scoped to ~each context; outside ~each `Done@ x`
	// just evaluates to the tagged object as a value.
	AtCallExpr(n, r) {
		if (n.callee?.type === "AtExpr" &&
			n.callee.base?.type === "Identifier" &&
			n.callee.base.name === "Done") {
			return "({__tag: \"Done\"})";
		}
		return r(n.callee) + (n.arg == null ? "()" : "(" + r(n.arg) + ")");
	},

	// EffectorCallExpr { source, arg? } — the `%` effector applied
	// to a chain-folded `source`, optionally with an argument.
	//
	// Bootstrap dispatch: if `source.run` is a function, call it
	// (with `arg` if present); otherwise the effector is an identity
	// no-op and `source` is returned unchanged. This carries the
	// Lazy@ semantic (bare values have no hook, so `x%` ≡ `x`)
	// alongside the IO semantic (instances carry `.run`, so `task%`
	// fires the effect).
	//
	// Single-eval discipline: both source and (when present) arg
	// must evaluate exactly once. The naive `src?.run ? src.run(arg)
	// : src` form evaluates `src` three times — fine for bare
	// identifiers, broken for call-bearing chains like
	// `processFile("f.txt")%` (would invoke processFile 3×). IIFE
	// wrap binds `__src` (and `__arg` in the binary form) once,
	// dispatches without re-evaluation.
	//
	// `typeof __src?.run === "function"` rather than `__src?.run`
	// alone: guards against non-function `.run` properties, which
	// would otherwise raise TypeError("not a function") at the
	// call site rather than falling through to identity. Optional
	// chaining handles null / undefined sources gracefully.
	//
	// Two-branch emission keeps the arg-absent shape clean
	// (`__src.run()` not `__src.run(undefined)`) — matches the
	// AtCallExpr `None@` convention for no-arg unit dispatch.
	//
	// Source is always a ChainExpr-fold result (Identifier / CallExpr
	// / MemberAccessExpr / IndexAccessExpr / PrimedExpr / etc.) or a
	// GroupedExprNoBlock — all valid JS expression atoms for IIFE
	// arg position.
	EffectorCallExpr(n, r) {
		var src = r(n.source);
		if (n.arg == null) {
			return "((__src) => typeof __src?.run === \"function\" ? __src.run() : __src)(" + src + ")";
		}
		var argEmit = r(n.arg);
		return "((__src, __arg) => typeof __src?.run === \"function\" ? __src.run(__arg) : __src)(" + src + ", " + argEmit + ")";
	},

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
	// positional-index form.
	//
	//   foo.bar    → foo.bar       (named accessor — JS dot)
	//   foo.List   → foo.List      (BuiltIn accessor — JS dot)
	//   arr.5      → arr[5]        (non-negative index — JS bracket)
	//   arr.0      → arr[0]        (zero — JS bracket)
	//   arr.-1     → arr.at(-1)    (negative index — from-end)
	//   arr.-2     → arr.at(-2)
	//
	// Negative-index FROM-END peephole — Foi's `.N` form is
	// ordered-structure-aware. Negative indices count from the
	// end uniformly across arrays (Tuples), strings, and
	// TypedArrays via the standard JS `.at()` API. Records have
	// no defined from-end semantic — `.at()` throws on plain
	// objects, which is the desired honest-failure mode.
	//
	// `.` and `[]` DIVERGE here for the first time anywhere in
	// the language: `arr.-1` is from-end; `arr[-1]`
	// (IndexAccessExpr) is JS-faithful and returns undefined.
	// The OpFuncExpr `(.)` and `([])` arms split accordingly —
	// see OpFuncExpr handler.
	//
	// READ-SIDE ONLY. `arr.-1 := y` must still lower to
	// `arr[-1] = y` because `.at()` returns a value, not an
	// assignable reference. AssignmentExpr's handler bypasses
	// this peephole for the integer-index LHS — see
	// AssignmentExpr handler.
	//
	// Detection uses `node.index.startsWith("-")` rather than
	// `Number(node.index) < 0` — `node.index` is a bare integer
	// string from the lexer (e.g. "5", "-1", "0"), so a leading
	// "-" is the exact discriminator. No `+0` / `-0` ambiguity.
	MemberAccessExpr(node, recur) {
		if (node.accessor) {
			return recur(node.object) + "." + recur(node.accessor);
		}
		if (node.index.startsWith("-")) {
			return recur(node.object) + ".at(" + node.index + ")";
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

	// ClosedRangeExpr { from, to } — top-level range value form
	// (`1..5`, `"a".."e"`, `i..n`). Distinct from `arr.[1..5]`
	// access, where ClosedRangeExpr appears as the `range` field
	// on RangeAccessExpr and lowers via .slice() (see above). At
	// expression position the range produces a concrete inclusive
	// sequence via the shared arrow body (see emitRangeBody) —
	// direction inferred from endpoint comparison, mismatched
	// types throw TypeError at runtime.
	//
	//   1..5     → [1, 2, 3, 4, 5]
	//   5..1     → [5, 4, 3, 2, 1]
	//   "a".."e" → ["a", "b", "c", "d", "e"]
	//   3..3     → [3]
	//
	// LeadingRangeExpr / TrailingRangeExpr no longer reach
	// expression position — narrowed at the grammar layer (§9
	// BinaryAtom drops both arms). They appear only as the
	// inner shape of RangeAccessExpr / DotBracketExpr.
	ClosedRangeExpr(node, recur) {
		return emitRangeBody(false, recur(node.from), recur(node.to));
	},

	// PropertyPickExpr { object, properties } — `.<a, b, 5, %k, &s>`
	// angle-pick. Picks the listed fields off the source and
	// returns a fresh record. Static, computed, and spread entries
	// compose via a single IIFE that single-evals the source AND
	// every dynamic-eval entry (computed key expression, spread
	// source expression) — uniform "avoid double-eval" discipline.
	// Dynamic-eval params are assigned in source order so any side
	// effects fire in user-written order.
	//
	// Static entries:
	//   PickAccessor (Identifier / BuiltIn) → `name: __o.name`.
	//   PickIndex (bare integer string)     → `<i>: __o[<i>]`.
	//     JS coerces numeric keys to strings at object storage,
	//     matching pick-by-position semantics for Tuples and
	//     harmless for Records.
	//
	// Dynamic entries:
	//   PickComputed → `[__k<N>]: __o[__k<N>]`. Key expression
	//     single-eval'd into __k<N> at IIFE invocation; reused
	//     twice inside (property name + lookup index).
	//   PickSpread   → `...Object.fromEntries(__s<N>.map(__n =>
	//     [__n, __o[__n]]))`. Source single-eval'd into __s<N>;
	//     runtime contract: source must yield a tuple of strings
	//     / string-coercible names. Honest runtime failure on
	//     shape mismatch.
	//
	// Examples:
	//   rec.<a, b>       → ((__o) => ({ a: __o.a, b: __o.b }))(rec)
	//   rec.<a, 5>       → ((__o) => ({ a: __o.a, 5: __o[5] }))(rec)
	//   rec.<%k>         → ((__o, __k0) =>
	//                        ({ [__k0]: __o[__k0] }))(rec, k)
	//   rec.<&keys>      → ((__o, __s0) => ({
	//                        ...Object.fromEntries(__s0.map(__n =>
	//                          [__n, __o[__n]]))
	//                      }))(rec, keys)
	//   rec.<a, %k, &s>  → ((__o, __k0, __s0) => ({
	//                        a: __o.a,
	//                        [__k0]: __o[__k0],
	//                        ...Object.fromEntries(__s0.map(__n =>
	//                          [__n, __o[__n]]))
	//                      }))(rec, k, s)
	//
	// Computed-key stringification footgun (audit #10) applies:
	// `%expr` whose value is a Record/Tuple stringifies via JS
	// `.toString()`, producing a stable-but-meaningless key.
	// Inherited from ExplicitPropDef's ComputedPropName lowering.
	//
	// Object.fromEntries is ES2019, same vintage as `.at()` already
	// emitted elsewhere — no prelude or polyfill needed.
	PropertyPickExpr(node, recur) {
		var bodyParts = [];
		var dynParams = [];
		var dynArgs = [];
		var keyIdx = 0;
		var spreadIdx = 0;
		for (let p of node.properties) {
			if (p.type === "PickAccessor") {
				let name = recur(p.accessor);
				bodyParts.push(name + ": __o." + name);
			}
			else if (p.type === "PickIndex") {
				bodyParts.push(p.index + ": __o[" + p.index + "]");
			}
			else if (p.type === "PickComputed") {
				let name = "__k" + (keyIdx++);
				bodyParts.push("[" + name + "]: __o[" + name + "]");
				dynParams.push(name);
				dynArgs.push(recur(p.expr));
			}
			else if (p.type === "PickSpread") {
				let name = "__s" + (spreadIdx++);
				bodyParts.push("...Object.fromEntries(" + name +
					".map(__n => [__n, __o[__n]]))");
				dynParams.push(name);
				dynArgs.push(recur(p.source));
			}
			else {
				return fallback(node);
			}
		}
		var allParams = ["__o", ...dynParams].join(", ");
		var allArgs = [recur(node.object), ...dynArgs].join(", ");
		return "((" + allParams + ") => ({ " + bodyParts.join(", ") +
			" }))(" + allArgs + ")";
	},

	// PrimedExpr — standalone form. Lower to a function value that
	// reverses its args before applying to the inner expression AND
	// preserves inner.length so downstream arity-introspecting
	// operators (curry/uncurry, partial application, etc.) see the
	// original arity through the prime wrapper.
	//
	// `Object.defineProperty` is required — rest-args arrows have
	// `.length === 0`, which would otherwise erase arity. JS spec
	// guarantees Function.length is `configurable: true`, so the
	// override is safe on every callable inner.
	//
	// Composition example this enables:
	//   (/\)(add')("a")("b")("c")  with `defn add(x,y,z) ^x + y + z`
	//   → add'.length is now 3 → curry tier-flushes at 3 args →
	//   → calls add'("a","b","c") = add("c","b","a") = "cba"
	//
	// Without length preservation, curry/uncurry would flush on the
	// first call (length 0 → trivially saturated) and produce
	// partial-application garbage.
	//
	//   foo'      → ((__f) => Object.defineProperty(
	//                  (...__a) => __f(...__a.reverse()),
	//                  "length", { value: __f.length }))(foo)
	//   foo.bar'  → same shape, with foo.bar as __f
	//
	// CallExpr / PartialCallExpr with a PrimedExpr callee bypass
	// this via their primed-callee shortcuts (cleaner direct shape
	// — `foo'(1,2,3)` → `foo(3, 2, 1)` rather than going through
	// the wrapper). This handler covers every other position:
	// DefVarStmt RHS, function call arg, binary operand, OpFuncExpr
	// composition target, etc.
	//
	// `:as` annotation dropped as transpilation no-op.
	PrimedExpr(node, recur) {
		return "((__f) => Object.defineProperty(" +
			"(...__a) => __f(...__a.reverse()), " +
			"\"length\", { value: __f.length }))(" +
			recur(node.inner) + ")";
	},

	// CurriedExpr { inner } — postfix curry operator `/\`. Wraps a
	// function value in an inline IIFE producing a curried form via
	// named function expression for self-reference. The returned
	// function accumulates args across call sites; once it has at
	// least `__f.length` args, it flushes them through to the
	// underlying function in one go (loose-curry compatible —
	// supplying all args at once short-circuits).
	//
	// Outer-tier-only per spec: multi-paramSet curry descent is
	// stdlib territory. `length === 1` (incl. multi-paramSet curried
	// `defn`s) is idempotent — the wrapper just passes args through
	// to the underlying function unchanged. To re-curry a multi-tier
	// function, uncurry it first (separate use sites; no stacking).
	//
	// Lowering shape:
	//
	//   foo/\           → ((__f) => (function __c(...__a) {
	//                       return __a.length >= __f.length
	//                         ? __f(...__a)
	//                         : (...__b) => __c(...__a, ...__b);
	//                     }))(foo)
	//
	// `foo/\(1)(2)(3)` extends naturally — the CallExpr chain wraps
	// `(1)(2)(3)` around the IIFE result.
	//
	// See Foi-Guide.md "Function Currying" for the operator-shape-
	// as-signature-shape mnemonic.
	CurriedExpr(node, recur) {
		return "((__f) => (function __c(...__a) { " +
			"return __a.length >= __f.length ? " +
			"__f(...__a) : " +
			"(...__b) => __c(...__a, ...__b); " +
			"}))(" + recur(node.inner) + ")";
	},

	// UncurriedExpr { inner } — postfix uncurry operator `\/`. Wraps
	// a function value in an inline IIFE producing a flat n-ary form
	// that walks the curried tier chain at apply time.
	//
	// At each loop iteration, consumes `__g.length || 1` args from
	// the remaining tail and advances. The `|| 1` guard prevents
	// infinite loop on 0-arity intermediates (degenerate — well-
	// formed curried functions don't produce 0-arity tiers, but the
	// guard costs nothing).
	//
	// Tier-respecting: a multi-paramSet function like
	// `defn foo(x)(y,z)(w) ^...` uncurried receives all its args
	// flat, and each tier consumes its declared arity from the stream:
	//
	//   foo\/(1, 2, 3, 4)
	//     iter 1: __g=foo,        __n=1, consume [1],    __g=foo(1)
	//     iter 2: __g=(y,z)=>...,  __n=2, consume [2,3], __g=g(2,3)
	//     iter 3: __g=(w)=>...,    __n=1, consume [4],   __g=g(4) → result
	//
	// Lowering shape:
	//
	//   foo\/           → ((__f) => (...__a) => {
	//                       var __g = __f; var __i = 0;
	//                       while (__i < __a.length &&
	//                              typeof __g === "function") {
	//                         var __n = __g.length || 1;
	//                         __g = __g(...__a.slice(__i, __i + __n));
	//                         __i += __n;
	//                       }
	//                       return __g;
	//                     })(foo)
	//
	// `foo\/(1, 2, 3)` extends via CallExpr — flat arg list passes
	// into the uncurried wrapper at apply time.
	UncurriedExpr(node, recur) {
		return "((__f) => (...__a) => { " +
			"var __g = __f; var __i = 0; " +
			"while (__i < __a.length && typeof __g === \"function\") { " +
			"var __n = __g.length || 1; " +
			"__g = __g(...__a.slice(__i, __i + __n)); " +
			"__i += __n; " +
			"} " +
			"return __g; " +
			"})(" + recur(node.inner) + ")";
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
	//   (#>)(11,f,g,h)   → pipeline-apply: h(g(f(11)))
	//                      first arg seeds the running value; each
	//                      subsequent arg is called with it
	//   (#>')(h,g,f,11)  → primed reverses xs first — semantically
	//                      equivalent to (#>)(11,f,g,h)
	//   (...)(+)         → apply lift: produces a unary fn that
	//                      spreads its Tuple arg into the wrapped
	//                      op — `(...)(+)(nums)` ≡ `(+)(...nums)`
	//   (...')(f)        → gather lift: produces a variadic fn that
	//                      packs its positional args into a single
	//                      Tuple and passes to f — `(...')(f)(a,b,c)`
	//                      ≡ `f(<a,b,c>)`. Inverse of `(...)`.
	//   (..)(1, 5)       → [1,2,3,4,5]  inclusive ascending range
	//   (..)(5, 1)       → [5,4,3,2,1]  descending (inferred from endpoints)
	//   (..)("a", "e")   → ["a","b","c","d","e"]  char range
	//   (..')(1, 5)      → [5,4,3,2,1]  primed swaps __from/__to
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
	// Access-as-function arms — strict 2-ary; primed swaps args.
	// `(.)` and `([])` DIVERGE: `(.)` is ordered-structure-aware
	// and dispatches at runtime on sign of the key (negative →
	// from-end via .at()); `([])` is JS-faithful structural with
	// no from-end semantic. This is the first place `.` and `[]`
	// split anywhere in the language — see MemberAccessExpr
	// docblock for the matching `arr.N` vs `arr[N]` split at the
	// same semantic boundary.
	//
	//   ([])(obj, i)     → obj[i]              (JS-faithful)
	//   ([])(arr, -1)    → arr[-1]             (undefined; no from-end)
	//   (.)(obj, k)      → __i < 0 ? __o.at(__i) : __o[__i]
	//   (.)(arr, -1)     → arr.at(-1)          (from-end at runtime)
	//   (.)(arr, 0)      → arr[0]              (non-negative — bracket)
	//   (.')(-1, arr)    → primed; same dispatch, __i/__o swapped
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
	// `?as` / `!as` still fall back.
	OpFuncExpr(node, recur) {
		// ([])(obj, i) → obj[i]. Strict 2-ary; primed swaps args.
		// JS-faithful structural access — no from-end semantic
		// (negative index returns undefined, matching JS bracket).
		// Partial application is the standard PartialCallExpr
		// path — nothing special at this site.
		if (node.op === "[]") {
			let params = node.primed ? "(__i, __o)" : "(__o, __i)";
			return "(" + params + " => __o[__i])";
		}
		// (.)(obj, k) — ordered-structure access. Runtime sign-
		// dispatch on the index: negative → .at() (from-end);
		// non-negative → bracket. Mirrors MemberAccessExpr's
		// `.N` peephole at the value-level. Strict 2-ary; primed
		// swaps args. See MemberAccessExpr docblock for the
		// `.N` vs `[N]` semantic split.
		if (node.op === ".") {
			let params = node.primed ? "(__i, __o)" : "(__o, __i)";
			return "(" + params + " => __i < 0 ? __o.at(__i) : __o[__i])";
		}

		// (/\)(fn) → curry; (\/)(fn) → uncurry.
		//
		// Postfix-equivalent forms exist via universal-prime:
		//   (/\')  ≡  (\/)     — primed Mountain → uncurry body
		//   (\/')  ≡  (/\)     — primed Valley   → curry body
		//
		// The (op, primed) pair collapses to a single curry-or-uncurry
		// selector: Mountain-unprimed and Valley-primed both produce
		// curry; Valley-unprimed and Mountain-primed both produce
		// uncurry. XOR over (op === "/\\") and node.primed.
		//
		// Body shape is identical to CurriedExpr / UncurriedExpr minus
		// the trailing `(<inner>)` bind site — the bare function value
		// is the output. Applied as a CallExpr callee with a function
		// arg (e.g. `(/\)(foo)`), the natural CallExpr lowering wraps
		// `(foo)` around the IIFE — semantically equivalent to `foo/\`.
		//
		// See CurriedExpr / UncurriedExpr docblocks for the body
		// rationale.
		if (node.op === "/\\" || node.op === "\\/") {
			var isCurry = (node.op === "/\\") !== !!node.primed;
			if (isCurry) {
				return "((__f) => (function __c(...__a) { " +
					"return __a.length >= __f.length ? " +
					"__f(...__a) : " +
					"(...__b) => __c(...__a, ...__b); " +
					"}))";
			}
			return "((__f) => (...__a) => { " +
				"var __g = __f; var __i = 0; " +
				"while (__i < __a.length && typeof __g === \"function\") { " +
				"var __n = __g.length || 1; " +
				"__g = __g(...__a.slice(__i, __i + __n)); " +
				"__i += __n; " +
				"} " +
				"return __g; " +
				"})";
		}

		// Angle-pick lifted: (.<a, b>) → ((__o) => ({ a: __o.a, b: __o.b }))
		//
		// Dynamic-pick lifted forms `(.<%k>)` / `(.<&keys>)` close over
		// the computed/spread eval values AT LIFT TIME (not per-apply) —
		// dynamic-eval params live in an outer IIFE that wraps the inner
		// `(__o) => ...` arrow. Consistent with the standalone
		// PropertyPickExpr lowering's single-eval discipline.
		//
		//   (.<%k>)        → ((__k0) => (__o) => ({ [__k0]: __o[__k0] }))(k)
		//   (.<&keys>)     → ((__s0) => (__o) => ({ ...Object.fromEntries(
		//                      __s0.map(__n => [__n, __o[__n]])) }))(keys)
		//   (.<a, %k, &s>) → ((__k0, __s0) => (__o) => ({
		//                      a: __o.a,
		//                      [__k0]: __o[__k0],
		//                      ...Object.fromEntries(__s0.map(__n =>
		//                        [__n, __o[__n]]))
		//                    }))(k, s)
		//
		// All-static entries preserve the bare-arrow shape (no outer
		// wrapper) — backward-compatible with prior lifted-pick lowering.
		if (node.properties) {
			let bodyParts = [];
			let dynParams = [];
			let dynArgs = [];
			let keyIdx = 0;
			let spreadIdx = 0;
			for (let p of node.properties) {
				if (p.type === "PickAccessor") {
					let name = recur(p.accessor);
					bodyParts.push(name + ": __o." + name);
				}
				else if (p.type === "PickIndex") {
					bodyParts.push(p.index + ": __o[" + p.index + "]");
				}
				else if (p.type === "PickComputed") {
					let name = "__k" + (keyIdx++);
					bodyParts.push("[" + name + "]: __o[" + name + "]");
					dynParams.push(name);
					dynArgs.push(recur(p.expr));
				}
				else if (p.type === "PickSpread") {
					let name = "__s" + (spreadIdx++);
					bodyParts.push("...Object.fromEntries(" + name +
						".map(__n => [__n, __o[__n]]))");
					dynParams.push(name);
					dynArgs.push(recur(p.source));
				}
				else {
					return fallback(node);
				}
			}
			let inner = "(__o) => ({ " + bodyParts.join(", ") + " })";
			if (dynParams.length === 0) return "(" + inner + ")";
			return "((" + dynParams.join(", ") + ") => " + inner + ")(" +
				dynArgs.join(", ") + ")";
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
		// (#>)(topic, f1, f2, ...) — pipeline-apply. First arg
		// seeds the running value; each subsequent arg is called
		// with it. Saved into __a because the primed form sets
		// xs === "__xs.reverse()" — referencing xs more than once
		// would mutate __xs repeatedly, flipping it back to
		// original on the second call. Single .reverse() at the
		// __a assignment is the only mutation needed.
		if (meta.kind === "pipeline") {
			return "((...__xs) => { var __a = " + xs +
				"; return __a.slice(1).reduce((__acc, __f) => __f(__acc), __a[0]); })";
		}
		// (...)(fn) — apply lift. 1-ary; takes a function, returns
		// a unary fn that spreads its Tuple/array arg into the
		// wrapped function. Primed flips the lift direction: "gather"
		// rather than spread: `(...')(f)(a, b, c)` ≡ `f(<a, b, c>)`.
		if (meta.kind === "spread") {
			if (node.primed) {
				return "((__fn) => (...__args) => __fn(__args))";
			}
			return "((__fn) => (__list) => __fn(...__list))";
		}
		if (meta.kind === "range2") {
			return emitRangeBody(node.primed, null, null);
		}
		// (~each)(range, body) — 2-ary side-effect loop. Primed
		// swaps arg order to (body, range). Callable-body only
		// (block forms are syntactic, not values); conditional
		// range unreachable here for the same reason. Explicit
		// 2-ary params → `.length === 2` naturally.
		if (meta.kind === "each") {
			var p1 = node.primed ? "__body" : "__r";
			var p2 = node.primed ? "__r" : "__body";
			return "((" + p1 + ", " + p2 + ") => { " +
				"var __src = Array.isArray(__r) ? __r : Object.values(__r); " +
				"for (let __v of __src) { " +
					"var __result = __body(__v); " +
					"if (__result?.__tag === \"Done\") break; " +
				"} " +
				"return __r; " +
			"})";
		}
		// (%) / (%') — effector op-as-function. Variadic 1-or-2-arg
		// shape mirrors EffectorCallExpr's direct lowering: source
		// (first arg, or second under prime) is .run-dispatched if
		// the hook exists; otherwise identity-returned. The runtime
		// `__arg !== undefined` branch picks `.run()` vs `.run(arg)`
		// so the bare-form call site `(%)(src)` lowers to the same
		// `src.run()` shape that `src%` would, no spurious undefined
		// arg threaded through.
		//
		// `typeof __src?.run === "function"` guards null / undefined
		// sources AND non-function `.run` properties — same shape
		// as EffectorCallExpr's hook check.
		if (meta.kind === "effector") {
			var p1 = node.primed ? "__arg" : "__src";
			var p2 = node.primed ? "__src" : "__arg";
			return "((" + p1 + ", " + p2 + ") => typeof __src?.run === \"function\" " +
				"? (__arg !== undefined ? __src.run(__arg) : __src.run()) " +
				": __src)";
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
	// Current coverage: PipelineOp (`#>`), both ComposeOps
	// (`+>`, `<+`), and ComprOp `~each` (delegated to emitEachOp;
	// see its docblock for shape). Remaining ComprOps (`~map`,
	// `~filter`, `~fold`, etc.) need their own lowering shapes
	// — comprehension-call rather than topic-injection — and
	// fall back until those handlers land.
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
		if (node.op === "~each") {
			return emitEachOp(node, recur);
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
	//   arr.-1 := y        → arr[-1] = y       (LHS asymmetry — see below)
	//
	// LHS asymmetry for integer-index MemberAccessExpr —
	// `arr.-1` READS from-end (peephole to `.at()`, see
	// MemberAccessExpr handler), but WRITES use JS bracket
	// because `.at()` returns a value, not an assignable
	// reference. So this handler emits the integer-index
	// MemberAccessExpr LHS directly as `<obj>[<index>]`,
	// bypassing the read-side from-end peephole in the standard
	// MemberAccessExpr handler. Named-accessor LHS
	// (`foo.bar := …`) and IndexAccessExpr LHS (`arr[i] := …`)
	// have no read/write divergence and route through recur as
	// before. This is the first place `.` and `[]` diverge
	// anywhere in Foi.
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
		var target = node.target;
		if (target.type === "MemberAccessExpr" && target.index != null) {
			return recur(target.object) + "[" + target.index + "] = " + recur(node.source);
		}
		return recur(target) + " = " + recur(node.source);
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
	//
	// AssignmentExpr consequent (`?[c]: x := 5`) composes as a
	// value-producing expression: assignment fires only when the
	// guard is truthy, and the GuardedExpr's value IS the assigned
	// value. By-contract — emerges from the AssignmentExpr handler
	// emitting bare `x = 5` (no paren-wrap, no IIFE) and JS's
	// assignment-expression returning the assigned value:
	//
	//   ?[c]: x := 5         →  c ? x = 5 : null
	//                           guard false → null, no mutation
	//                           guard true  → 5, x is assigned
	//   ?[c]: foo.bar := 42  →  c ? foo.bar = 42 : null
	//                           same conditional-fire + value-
	//                           producing semantic, independent
	//                           of LHS target shape
	//
	// Do NOT "fix" the composition by wrapping AssignmentExpr in
	// parens or IIFE at this site — both the conditional-mutation
	// and value-producing properties depend on the bare JS form.
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
	// DepMatchExpr — see handler immediately below; same right-
	// fold shape wrapped in a topic-binding IIFE.
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

	// DepMatchExpr { topic, stmts } — `?(topic){ ?[atoms]: consq;
	// ... ?: else }`. Single-eval topic into __topic via IIFE
	// param; right-fold clauses into a JS ternary cascade for
	// first-match-wins semantics. Same shape as IndepMatchExpr
	// wrapped in `((__topic) => <cascade>)(<topic>)`.
	//
	//   ?(x){
	//       ?["Kyle"]: "hi";
	//       ?[?>= 18]: "adult";
	//       ?: "other"
	//   }
	//   →
	//   ((__topic) => (
	//       __topic === "Kyle" ? "hi" :
	//       __topic >= 18 ? "adult" :
	//       "other"
	//   ))(x)
	//
	// Atom kinds (per renderDepAtom):
	//   - Bare ExprNoBlock e  → `__topic === <e>`
	//   - DepCondBoolExpr     → infix / De Morgan / OpFunc-routed
	//                           per DEP_*_OPS tables
	//
	// Clause polarity (effective: `polarity ?? defaultPolarity`):
	//   - "?"  →  `(t1 || t2 || ...)`        — any atom matches
	//   - "!"  →  `!(t1 || t2 || ...)`       — none match
	//
	// Single-atom clauses skip the OR-paren; the negated single-
	// atom case wraps as `!(<atom>)` since `?=` / `?<` etc.
	// produce loose-precedence infix expressions that need parens
	// for safe negation.
	//
	// Topic resolution:
	//   - Consequent body — PipelineTopic resolves to `__topic`
	//     via consequentDispatch closure (same shape as #>
	//     BlockExpr arm's topicRefBox.ref pattern).
	//   - Atom expressions — `#` is NOT a topic ref per Foi
	//     semantic (op's LHS is implicitly the topic). Atoms use
	//     the OUTER `recur`; a `#` written inside an atom either
	//     resolves to an enclosing #> topic (if any) or falls
	//     back. See renderDepAtom docblock.
	//
	// Nesting via JS lexical scoping: an inner DepMatchExpr
	// establishes its own IIFE __topic param + its own
	// consequentDispatch, shadowing outer __topic cleanly. The
	// outer handler never sees the inner subtree directly — it
	// just calls consequentDispatch(consq), which routes through
	// the dispatch map to the inner DepMatchExpr handler, which
	// builds its own scope from scratch.
	//
	// Empty-stmts edge case (only an ElseStmt, no pattern
	// clauses) emits the IIFE with the else consequent as the
	// cascade tail; topIdx becomes -1, the loop doesn't run.
	// Pure-empty stmts list (no patterns, no else) emits
	// `((__topic) => null)(<topic>)` — matches Foi's "no match"
	// → empty → null semantic.
	//
	// Fallback granularity: whole node, on any atom returning
	// null from renderDepAtom (?as / !as, ?$= / !$=, unrecognized
	// op). Skipping an OR-list atom silently changes semantics
	// so partial lowering isn't safe.
	DepMatchExpr(node, recur) {
		var topicStr = recur(node.topic);

		var consequentDispatch = n => {
			if (n == null) return "";
			if (n.type === "PipelineTopic") return "__topic";
			var h = handlers[n.type];
			return h ? h(n, consequentDispatch) : fallback(n);
		};

		var stmts = node.stmts;
		if (stmts.length === 0) {
			return "((__topic) => null)(" + topicStr + ")";
		}

		var last = stmts[stmts.length - 1];
		var hasElse = last.type === "ElseStmt";
		var result;
		var topIdx;
		if (hasElse) {
			result = consequentDispatch(last.consequent);
			topIdx = stmts.length - 2;
		}
		else {
			result = "null";
			topIdx = stmts.length - 1;
		}

		for (let i = topIdx; i >= 0; i--) {
			let s = stmts[i];
			let clause = s.clause;
			let effPolarity = clause.polarity ?? clause.defaultPolarity ?? "?";

			let parts = [];
			for (let atom of clause.tests) {
				// Atoms use OUTER recur per "# not available in
				// atoms" semantic (see renderDepAtom docblock).
				let rendered = renderDepAtom(atom, recur);
				if (rendered == null) return fallback(node);
				parts.push(rendered);
			}

			let cond;
			if (parts.length === 1) {
				cond = effPolarity === "!" ? "!(" + parts[0] + ")" : parts[0];
			}
			else {
				let joined = parts.join(" || ");
				cond = effPolarity === "!" ? "!(" + joined + ")" : "(" + joined + ")";
			}

			result = "(" + cond + " ? " + consequentDispatch(s.consequent) + " : " + result + ")";
		}

		return "((__topic) => " + result + ")(" + topicStr + ")";
	},


	// =============================================================
	// §17 DATA STRUCTURE LITERALS
	// =============================================================

	// RecordTupleLit { entries } — Tuple/Record discriminator.
	//
	// Mode is driven by named-key entries:
	//   ConcisePropDef / ExplicitPropDef                 → flip
	//   PickValue w/ MemberAccessExpr-accessor source    → flip
	//   PickValue w/ PropertyPickExpr any-PickAccessor   → flip
	// PickValue with any other source (bare Identifier/BuiltIn,
	// integer/index single-pick, all-PickIndex subset,
	// RangeAccessExpr) does NOT flip — it spreads into or
	// contributes a positional value to an array-mode container.
	//
	// Array mode — no flipping entries present:
	//   <1, 2, 3>             → [1, 2, 3]
	//   <&nums, 7>            → [...nums, 7]
	//   <0, &nums, 5>         → [0, ...nums, 5]
	//   <1, 3, &nums.1, 7, 9> → [1, 3, nums[1], 7, 9]
	//   <2, &nums.<1,3>, 8>   → [2, ...[nums[1], nums[3]], 8]
	//   <0, 1, &nums.[..2]>   → [0, 1, ...nums.slice(0, 2 + 1)]
	//   <&nums.[3..]>         → [...nums.slice(3)]
	//
	// Object mode — any flipping entry present. Bare entries
	// become numeric properties keyed by their entry-list
	// position; keyed entries render via renderRecordEntry,
	// which also handles target-position keying for single-pick
	// PickValues (matches the guide's shorthand-equivalent
	// semantic: `<1, 3, &nums.1, 7, 9>` ≡ `<1, 3, 2: nums.1, 7, 9>`).
	// Paren-wrapped to disambiguate from a block in expr-
	// statement position:
	//   <x: 1, :y>             → ({ x: 1, y })
	//   <&person, first: "J">  → ({ ...person, first: "J" })
	//   <first: "J", &p.last>  → ({ first: "J", last: p.last })
	//   <&p.<a,b>>             → ({ ...({ a: p.a, b: p.b }) })
	//   <&p, 7>                → ({ ...p, 1: 7 })
	//   <x: 1, &nums.0>        → ({ x: 1, 1: nums[0] })
	//
	// Cross-mode shapes (e.g. `<x: 1, &nums>` — bulk-spread of
	// an array into object mode) emit `({ x: 1, ...nums })` and
	// surface at runtime if `nums` isn't object-spreadable.
	//
	// PickValue / ConcisePropDef / ExplicitPropDef have no
	// top-level handlers — they're directives, only meaningful
	// inside record/set literals.
	RecordTupleLit(node, recur) {
		var entries = node.entries;
		var forcesObject = e =>
			e.type === "ConcisePropDef" ||
			e.type === "ExplicitPropDef" ||
			(e.type === "PickValue" && pickForcesObjectMode(e.source));
		var objectMode = entries.some(forcesObject);

		if (!objectMode) {
			let parts = [];
			for (let e of entries) {
				let rendered;
				if (e.type === "PickValue") {
					rendered = renderPickValueSpread(e.source, recur)
						?? renderPickValueSingle(e.source, recur);
				}
				else {
					rendered = recur(e);
				}
				if (rendered == null) return fallback(node);
				parts.push(rendered);
			}
			return "[" + parts.join(", ") + "]";
		}

		var parts = [];
		for (let i = 0; i < entries.length; i++) {
			let e = entries[i];
			let rendered;
			if (
				e.type === "PickValue" ||
				e.type === "ConcisePropDef" ||
				e.type === "ExplicitPropDef"
			) {
				rendered = renderRecordEntry(e, recur, i);
			}
			else {
				rendered = i + ": " + recur(e);
			}
			if (rendered == null) return fallback(node);
			parts.push(rendered);
		}
		return "({ " + parts.join(", ") + " })";
	},

	// SetLit { entries } → `new Set([...])`. Sets are flat
	// value streams — PickValue dispatches via
	// renderPickValueSetEntry, where named-member picks
	// contribute single VALUES (not key:value pairs) and
	// subset picks spread VALUES only. Per grammar SetEntry =
	// PickValue | RecordTupleValue, so PropDefs can't appear
	// here.
	//
	//   <[1, 2, 3]>           → new Set([1, 2, 3])
	//   <[&foo, &bar]>        → new Set([...foo, ...bar])
	//   <[&foo.bar, x]>       → new Set([foo.bar, x])
	//   <[&foo.5]>            → new Set([foo[5]])
	//   <[&foo.<1,3>]>        → new Set([...[foo[1], foo[3]]])
	//   <[&foo.<a,b>]>        → new Set([...[foo.a, foo.b]])
	//   <[&foo.[1..3]]>       → new Set([...foo.slice(1, 3 + 1)])
	SetLit(node, recur) {
		var parts = [];
		for (let e of node.entries) {
			if (e.type === "PickValue") {
				let rendered = renderPickValueSetEntry(e.source, recur);
				if (rendered == null) return fallback(node);
				parts.push(rendered);
			}
			else {
				parts.push(recur(e));
			}
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
