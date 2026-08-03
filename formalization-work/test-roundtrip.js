// test-roundtrip.js — verifies that the shaped AST + delims channel
// captures source losslessly.
//
// Procedure per sample:
//   1. parseFoi(src, { preserveSoftDelims: true }) → Program node
//   2. emit(program) → reconstructed string
//   3. assert src === reconstructed; on mismatch, report first
//      divergence point with context windows.
//
// Same samples corpus as test-parser.js (positive lane only —
// failSamples don't parse, so they can't round-trip). Soft-delim
// preservation is mandatory here; without it, whitespace and
// comments are discarded by the parser and identity is structurally
// impossible.
//
// Emission strategy: handler map keyed by node.type, generic walker
// fallback. Most handlers either (a) gap-fill — emit a re-synthesized
// anchor string at the first source-position gap among the node's
// child nodes and delim tokens — or (b) recur explicitly on known
// child slots with known re-synthesized punctuation between them
// (the chain-fold typed nodes from applyChainSeg, which carry no
// delims of their own).
//
// Binary tiers need a flatten step: shapeBinTier produces nested
// same-type intermediates without brand-stamping delims on them; all
// soft delims for the chain land on the outermost. Flattening the
// chain back to operands+ops gives a single linear walk that
// distributes ops into the gaps correctly.

import { parseFoi } from "./parser.js";
import { samples } from "./samples.js";


// =============================================================
// DISCRIMINATORS
//
// Same discriminator as the shaper layer: shapers never set
// `value` on returned nodes, so its presence marks a raw token.
// =============================================================

var isNode  = x => x != null && typeof x === "object" && !("value" in x);
var isToken = x => x != null && typeof x === "object" &&  ("value" in x);


// =============================================================
// SHARED HELPERS
// =============================================================

var SKIP_KEYS = new Set([ "type", "start", "end", "delims" ]);

// Collect child nodes from enumerable properties (skipping SKIP_KEYS)
// plus this node's delim tokens, sorted by source position.
//
// Synthetic nodes with no source representation are filtered:
//   - ImpliedEmpty (from PrefixCallSuffix skip slots) — carries the
//     "implied empty value" semantic for downstream consumers.
//   - DestructureSkipSlot (from tuple-mode DestructureTarget skip
//     positions per Foi-Specification.md §2.13.6) — carries the
//     "empty position, no binding" semantic for downstream
//     consumers.
// Null entries in arrays (PartialCallSuffix skip slots) are
// filtered implicitly by isNode (which rejects null).
var collectPieces = node => {
	var pieces = [];
	for (let key of Object.keys(node)) {
		if (SKIP_KEYS.has(key)) continue;
		let v = node[key];
		if (Array.isArray(v)) {
			for (let item of v) {
				if (
					isNode(item) &&
					item.type !== "ImpliedEmpty" &&
					item.type !== "DestructureSkipSlot"
				) {
					pieces.push(item);
				}
			}
		}
		else if (
			isNode(v) &&
			v.type !== "ImpliedEmpty" &&
			v.type !== "DestructureSkipSlot"
		) {
			pieces.push(v);
		}
	}
	if (node.delims) {
		for (let d of node.delims) pieces.push(d);
	}
	pieces.sort((a, b) => a.start - b.start);
	return pieces;
};

// Standard handler form: emit a re-synthesized anchor string at the
// FIRST source-position gap encountered while walking pieces. Used
// for every case where exactly one anchor (keyword, sigil, dropped
// operator) was lost at parse and the surviving shape has a single
// hole in source where it belongs.
//
// Covers anchored leaves (NumberLit.text, Identifier.name, EmptyLit
// "empty"), keyword stmts (def / deft / import / export), the :as
// keyword, polarity sigils, unary op fields, single-iter binary,
// lifted-wrapper inners (text between lifted parens), and more.
//
// NOT for: multi-anchor shapes (DefFuncExpr's keyword + @ marker;
// chain-fold synthetic nodes with multiple dropped punctuation
// positions; nested-same-type binary iter chains where one anchor-
// per-op is needed).
var gapFill = (anchor, node, recur, skip) => {
	var out = "";
	var anchorEmitted = false;
	var pos = node.start;
	for (let p of collectPieces(node)) {
		if (skip && skip.has(p)) continue;
		if (!anchorEmitted && p.start > pos) {
			out += anchor;
			anchorEmitted = true;
		}
		out += isNode(p) ? recur(p) : p.value;
		pos = p.end != null ? p.end + 1 : pos;
	}
	if (!anchorEmitted) out += anchor;
	return out;
};


// Binary-tier emitter. shapeBinTier folds `lhs (op rhs)+` left-assoc
// into nested same-type nodes; the machinery only brand-stamps the
// outermost return, so intermediates carry no delims and ALL of the
// iter's soft delims land on the outer. A single gap-fill on the
// outer walks pieces with inner already at the start position,
// which double-counts. Flattening same-type nested back to operands
// + ops gives a linear walk where each op lands in its own gap.
//
// Only flattens when the child's type matches `typeName` AND has
// the binary-tier shape ({left, op, right}). Mixed-tier nesting
// (AddBinExpr containing MulBinExpr) doesn't flatten — the inner
// MulBinExpr has its own frame, its own delims, recurses normally.
var emitBinTier = (typeName, node, recur) => {
	var operands = [];
	var ops = [];
	var walk = n => {
		if (n.type === typeName && "left" in n && "right" in n && typeof n.op === "string") {
			walk(n.left);
			ops.push(n.op);
			operands.push(n.right);
		}
		else {
			operands.push(n);
		}
	};
	walk(node);

	var delims = node.delims || [];
	var pieces = [ ...operands, ...delims ];
	pieces.sort((a, b) => a.start - b.start);

	var out = "";
	var pos = node.start;
	var opIdx = 0;
	for (let p of pieces) {
		if (opIdx < ops.length && p.start > pos) {
			out += ops[opIdx];
			opIdx++;
		}
		out += isNode(p) ? recur(p) : p.value;
		pos = p.end != null ? p.end + 1 : pos;
	}
	while (opIdx < ops.length) {
		out += ops[opIdx];
		opIdx++;
	}
	return out;
};

// Render OpFuncExpr's angle-pick properties as a comma-joined
// string. The lifted form has no recoverable comma/sigil
// positions at the OpFuncExpr level — surrounding `.<` `>` and
// inter-entry commas are re-synthesized here. PropertyPickExpr
// no longer uses this — it walks the propagated DotAngleExpr
// delims directly to recover internal spacing.
//
// Per-entry rendering dispatches via recur — falls through to
// each Pick*'s handler (PickAccessor / PickIndex) or to
// emitGeneric for handler-less Pick* types (PickComputed,
// PickSpread). emitGeneric walks the Pick*'s own delims (sigil
// token) + child node field (expr/source) in source-position
// order, yielding `%<expr>` and `&<source>` respectively.
var emitProperties = (properties, recur) =>
	properties.map(p => recur(p)).join(",");


// Shared emitter for postfix-modifier wrapper nodes — PrimedExpr (`'`),
// CurriedExpr (`/\`), UncurriedExpr (`\/`). All three share the same
// shape: { inner, delims?, as? }. The modifier glyph is synthetic
// (not in any token's value) and adjacent to inner.end + 1 per the
// no-trivia-between-base-and-modifier grammar rule.
//
// Walks inner + glyph + delims + .as in source-position order. Lifted
// wrapper parens (from ComputedPropParenExpr's unwrap onto these node
// types) land in delims with positions outside [inner.start, primePos],
// so source-ordered traversal places them correctly — e.g. an
// OpenParen at start < inner.start emits before inner, restoring
// `%(foo')` instead of `%foo'()`.
var emitPostfixWrap = (node, recur, glyph) => {
	var modPos = node.inner.end + 1;
	var pieces = [
		{ start: node.inner.start, kind: "inner" },
		{ start: modPos,           kind: "mod" },
	];
	if (node.as) {
		pieces.push({ start: node.as.start, kind: "as", val: node.as });
	}
	if (node.delims) {
		for (let d of node.delims) {
			pieces.push({ start: d.start, kind: "delim", val: d });
		}
	}
	pieces.sort((a, b) => a.start - b.start);
	var out = "";
	for (let p of pieces) {
		if      (p.kind === "inner") out += recur(node.inner);
		else if (p.kind === "mod")   out += glyph;
		else if (p.kind === "as")    out += recur(p.val);
		else                         out += p.val.value;
	}
	return out;
};


// =============================================================
// HANDLER MAP
//
// Keyed by node.type. Each handler: (node, recur) => string.
// `recur` is the dispatcher — call it on child nodes so any
// type-specific handler downstream fires correctly.
// =============================================================

var handlers = {

	// ---- §1 / §2 / §6 text-bearing leaves ----
	// text/name sits at node.start; gap-fill places it correctly
	// even when delims are lifted around the leaf (RecordTupleValue
	// paren-recursive arm: parens land on the leaf's delims).
	NumberLit:     (n, r) => gapFill(n.text, n, r),
	BooleanLit:    (n, r) => gapFill(n.text, n, r),
	Identifier:    (n, r) => gapFill(n.name, n, r),
	BuiltIn:       (n, r) => gapFill(n.name, n, r),
	PipelineTopic: (n, r) => gapFill(n.name, n, r),

	// ---- §2 EmptyLit ----
	EmptyLit: (n, r) => gapFill("empty", n, r),

	// ---- §2 string literals ----
	// PlainStr, SpacingEscapedStr, InterpStr, SpacingInterpStr
	// have no custom handlers. Each shaper now pushes every raw
	// token (DoubleQuote, String, StringEscapedChar, Whitespace,
	// Escape) to delims with source positions, and the interp
	// forms expose InterpExpr children via the enumerable chunks
	// array. emitGeneric walks pieces in source-position order
	// and reconstructs source verbatim.

	// ---- §3 imports / exports ----
	ImportExpr: (n, r) => gapFill("import", n, r),
	ExportExpr: (n, r) => gapFill("export", n, r),

	// ---- §4 variable definitions ----
	DefVarStmt: (n, r) => gapFill("def", n, r),

	// ---- §5 :as annotation wrapper ----
	AsAnnotationExpr: (n, r) => gapFill(":as", n, r),

	// =============================================================
	// §6 RANGES
	// =============================================================
	// DoublePeriod (`..`) is anchored in type tag — dropped at
	// parse, re-synthesized via gapFill at the first source-
	// position gap among pieces.
	//
	// gapFill is required (not bare concat) because delims CAN
	// land on these nodes from two sources:
	//   (a) StmtSemi α-claim — when a range is the outermost
	//       expression of a top-level Stmt (`5..1;`), shapeStmtSemi
	//       appends the terminating Semicolon to the range's
	//       delims and bumps its end. Bare concat drops the semi.
	//   (b) Auto-merged soft delims under preserveSoftDelims:true
	//       for any Whitespace / Comment inside the range span
	//       (`5 .. 1`). Bare concat drops them.
	// Wrapping nodes (DefVarStmt, AsAnnotationExpr, RangeAccessExpr,
	// CallExpr) absorb the α-claim when present, so the bare-
	// concat form happened to work for every previously-tested
	// shape; bare-top-level range samples surfaced the gap.

	ClosedRangeExpr:   (n, r) => gapFill("..", n, r),
	LeadingRangeExpr:  (n, r) => gapFill("..", n, r),
	TrailingRangeExpr: (n, r) => gapFill("..", n, r),

	// =============================================================
	// §7 CHAIN-FOLD SYNTHETIC NODES
	// =============================================================
	// applyChainSeg propagates seg.delims onto the synthesized
	// node, so the Period (DotIdentifier / DotBracketExpr /
	// DotAngleExpr), brackets, parens, pipes, angles, and commas
	// — plus any auto-merged soft delims (WS between args, WS
	// after commas, WS straddling the dot) — are recoverable.
	// Chain-level soft delims between segs are distributed by
	// ChainExpr's shaper onto the folded node that follows each
	// gap, so WS positions across both sides of every dot in a
	// chain are preserved.
	//
	// CallExpr / PartialCallExpr / IndexAccessExpr / RangeAccessExpr
	// / PropertyPickExpr route through emitGeneric: every structural
	// token sits in delims and every child node carries source
	// positions, so a sorted piece-walk reconstructs them. The
	// only custom §7 handler is MemberAccessExpr — its integer
	// variant has a positionless `index` string that needs
	// gap-fill.

	// MemberAccessExpr — Period is in delims (with its source
	// position), so the accessor variant routes through emitGeneric
	// uniformly. The integer variant keeps `.index` as a bare
	// string with no position; gapFill places it at the first
	// source-position gap in the piece walk (where the integer
	// token's position naturally falls relative to surrounding
	// pieces). For `arr.5` with nothing after, no gap is detected
	// mid-walk and the anchor appends at the end — also correct,
	// since node.end is the integer's end.
	MemberAccessExpr(node, recur) {
		if (node.accessor) return emitGeneric(node, recur);
		return gapFill(node.index, node, recur);
	},

	// IndexAccessExpr, CallExpr, PartialCallExpr, RangeAccessExpr,
	// PropertyPickExpr — no custom handlers. emitGeneric walks
	// (object|callee) + (expr|args|range|properties) + delims in
	// source-position order. With Period now propagated in delims
	// (DotIdentifier / DotBracketExpr / DotAngleExpr shapers) and
	// PropertyPickExpr's properties carrying PickAccessor /
	// PickIndex source positions, all structural punctuation and
	// internal WS are recoverable via the standard piece walk.

	// PickAccessor / PickIndex — synth nodes carrying source span
	// for DotAngleExpr property entries. PickAccessor wraps an
	// Identifier node; PickIndex carries a bare integer string with
	// the source position pinned on the wrapper's start/end.
	PickAccessor: (n, r) => r(n.accessor),
	PickIndex:    (n, r) => n.index,

	// Three postfix-modifier wrappers share the same shape and
	// traversal — see emitPostfixWrap above for the source-ordered
	// walk that handles lifted wrapper parens correctly. Differ only
	// in modifier glyph.
	PrimedExpr:    (n, r) => emitPostfixWrap(n, r, "'"),
	CurriedExpr:   (n, r) => emitPostfixWrap(n, r, "/\\"),
	UncurriedExpr: (n, r) => emitPostfixWrap(n, r, "\\/"),

	OpFuncExpr(node, recur) {
		// Inner content depends on which arm:
		//   - properties present → ".<a,b>" form
		//   - range present     → ".[range]" form
		//   - op === "[]"       → empty-bracket form
		//   - op otherwise      → bare-op form ("+", etc.)
		// Optional trailing "'" (primed). Then surrounding parens
		// come from node.delims via gapFill — UNLESS the node is
		// synthetic (from PrefixCallSuffix bare-op shortcut), in
		// which case no parens and we emit just `inner`.
		//
		// Pass skip to gapFill so the properties wrappers and the
		// range child node — which would otherwise show up in
		// pieces and get double-emitted around the inner string —
		// are filtered out.
		var inner;
		var skip = null;
		if (node.properties) {
			inner = ".<" + emitProperties(node.properties, recur) + ">";
			skip = new Set(node.properties);
		}
		else if (node.range) {
			inner = ".[" + recur(node.range) + "]";
			skip = new Set([ node.range ]);
		}
		else {
			inner = node.op != null ? node.op : "";
		}
		if (node.primed) inner += "'";
		if (!node.delims || node.delims.length === 0) {
			return inner;   // synthetic shortcut form (no parens)
		}
		return gapFill(inner, node, recur, skip);
	},

	// =============================================================
	// §8 UNARY
	// =============================================================

	SymbolicUnaryExpr: (n, r) => gapFill(n.op, n, r),
	NamedUnaryExpr:    (n, r) => gapFill(n.op, n, r),

	// =============================================================
	// §9 BINARY TIERS
	// =============================================================

	FlowBinExpr:        (n, r) => emitBinTier("FlowBinExpr", n, r),
	OrBinExpr:          (n, r) => emitBinTier("OrBinExpr", n, r),
	AndBinExpr:         (n, r) => emitBinTier("AndBinExpr", n, r),
	CompareBinExpr:     (n, r) => emitBinTier("CompareBinExpr", n, r),
	TypeCompareBinExpr: (n, r) => emitBinTier("TypeCompareBinExpr", n, r),
	AddBinExpr:         (n, r) => emitBinTier("AddBinExpr", n, r),
	MulBinExpr:         (n, r) => emitBinTier("MulBinExpr", n, r),

	// =============================================================
	// §11 DEF-BLOCK STATEMENT
	// =============================================================

	DefBlockStmt: (n, r) => gapFill("def", n, r),

	// =============================================================
	// §13 FUNCTION DEFINITIONS
	// =============================================================

	// DefFuncExpr — keyword "defn" + optional name + optional `@`
	// after name + paren-grouped param sets + sub-clauses + body.
	// Two re-synthesized anchors: "defn" (always, at first gap)
	// and "@" (only when at:true, injected immediately before the
	// first OpenParen).
	DefFuncExpr(node, recur) {
		var pieces = collectPieces(node);
		var out = "";
		var defnEmitted = false;
		var atEmitted = !node.at;
		var pos = node.start;
		for (let p of pieces) {
			if (!defnEmitted && p.start > pos) {
				out += "defn";
				defnEmitted = true;
			}
			if (!atEmitted && !isNode(p) && p.type === "OpenParen") {
				out += "@";
				atEmitted = true;
			}
			out += isNode(p) ? recur(p) : p.value;
			pos = p.end != null ? p.end : pos;
		}
		if (!defnEmitted) out += "defn";
		if (!atEmitted) out += "@";
		return out;
	},

	// DefHookDecl — keyword "defn" + required name + required
	// marker (`@` or `%`) after name + paren-grouped param sets
	// + sub-clauses + body. Two re-synthesized anchors: "defn"
	// (always, at first gap) and `node.marker` glyph (always,
	// immediately before the first OpenParen). Mirrors DefFuncExpr's
	// emit logic with the marker always required — DefHookDecl's
	// grammar production requires it (distinct from DefFuncExpr's
	// now-removed optional `at:true`).
	DefHookDecl(node, recur) {
		var pieces = collectPieces(node);
		var out = "";
		var defnEmitted = false;
		var markerEmitted = false;
		var pos = node.start;
		for (let p of pieces) {
			if (!defnEmitted && p.start > pos) {
				out += "defn";
				defnEmitted = true;
			}
			if (!markerEmitted && !isNode(p) && p.type === "OpenParen") {
				out += node.marker;
				markerEmitted = true;
			}
			out += isNode(p) ? recur(p) : p.value;
			pos = p.end != null ? p.end : pos;
		}
		if (!defnEmitted) out += "defn";
		if (!markerEmitted) out += node.marker;
		return out;
	},

	// GatherParameter — Star sigil is in delims, but the inner
	// Identifier node was discarded by the shaper (only its `name`
	// string survives). Emit "*" + name explicitly; ignore the
	// Star delim to avoid double-emitting.
	GatherParameter: (n, r) => "*" + n.name,

	FuncOverClause:   (n, r) => gapFill(":over", n, r),
	ReturnExpr:       (n, r) => gapFill("^", n, r),
	FuncBodyExpr:     (n, r) => gapFill("^", n, r),
	FuncBodyPipeline: (n, r) => gapFill(n.op, n, r),

	// =============================================================
	// §14 CONDITIONALS / GUARDS
	// =============================================================

	// CondClause — polarity ?/! anchored in field; emit literally
	// (or "" if no explicit polarity, which would only happen for
	// synthesized clauses but doesn't here since §14's CondClause
	// always has explicit polarity).
	CondClause: (n, r) => gapFill(n.polarity || "", n, r),

	// =============================================================
	// §15 MATCH EXPRESSIONS
	// =============================================================

	// DepCondClause — polarity or default-? form. defaultPolarity
	// means user wrote no `?` / `!`; emit empty anchor.
	DepCondClause: (n, r) => gapFill(n.polarity || "", n, r),

	// DepCondBoolExpr — arm 1/2 captures op; arm 3 (paren-
	// recursive) unwraps via liftWrapperDelims, so the resulting
	// node is a DepCondBoolExpr with parens in delims AND op set.
	// gapFill places op at the gap between parens (or between
	// operator-sigil and operand for the un-wrapped case).
	DepCondBoolExpr: (n, r) => gapFill(n.op || "", n, r),

	// ElseStmt — leading `?` is optional (the "explicit ?" else
	// form); when absent, user wrote `: expr` directly.
	ElseStmt: (n, r) => gapFill(n.polarity || "", n, r),

	// =============================================================
	// §16 DO-COMPREHENSIONS
	// =============================================================

	DoComprExpr:     (n, r) => gapFill("~<<", n, r),
	DoLoopComprExpr: (n, r) => gapFill("~<*", n, r),
	DoDefVarStmt:    (n, r) => gapFill("def", n, r),

	// DoComprLHSName — bare-or-dotted namespace path. Segments
	// joined by ".". Parallel to DefTypeName (§18). Never carries
	// lifted wrappers.
	DoComprLHSName: (node, recur) => node.segments.map(s => recur(s)).join("."),

	// DoVarDefInitOpt — op (":" or "::") captured into field when
	// init is present; bare target when no init. Use gapFill when
	// op is set; fall through to generic for bare target.
	DoVarDefInitOpt(node, recur) {
		if (node.op) return gapFill(node.op, node, recur);
		return emitGeneric(node, recur);
	},

	// =============================================================
	// §17 DATA STRUCTURE LITERALS
	// =============================================================

	// PickValue: handler removed. The Ampersand sigil sits in
	// node.delims (the shaper pushes it there explicitly), so
	// generic emit walks it correctly. The prior gapFill("&", ...)
	// handler double-emitted — `&` from delim AND `&` from anchor.
	ComputedPropName: (n, r) => gapFill("%", n, r),

	// =============================================================
	// §18 TYPE DEFINITIONS
	// =============================================================

	DefTypeStmt: (n, r) => gapFill("deft", n, r),

	// DefTypeFrom — contextual `from` keyword drops at shape time,
	// re-synthesized at the first source-position gap. Same handler
	// shape as ImportExpr's gapFill("import", ...).
	DefTypeFrom: (n, r) => gapFill("from", n, r),

	// DefTypeName — bare-or-dotted; segments joined by ".".
	// Parallel to NamedType.dotted arm; simpler because
	// DefTypeName never carries lifted wrappers.
	DefTypeName: (node, recur) => node.segments.map(s => recur(s)).join("."),

	// EffectsClause — ":Effects" keyword drops from shaper;
	// re-synthesized at gapFill's first-gap position (before the
	// OpenParen delim). Parens and commas walk from delims via
	// gapFill's piece traversal; entries walk as child nodes.
	EffectsClause: (n, r) => gapFill(":Effects", n, r),

	// NamedType — two arms:
	//   - native:  { of: "int" }            → emit `of`
	//   - dotted:  { segments: [Ident...] } → emit segments joined by "."
	// Either arm can carry lifted braces (delims = [OpenBrace,
	// CloseBrace, optional Pipe]) when this NamedType appears as
	// a GroupedTypeExpr unwrap target (e.g. NestedTypeExpr's arg
	// position, `List{int}`). Compose the content string first,
	// then gap-fill the delims around it; with no delims the
	// gap-fill is a no-op (content emits unchanged).
	NamedType(node, recur) {
		var content = node.of != null
			? node.of
			: node.segments.map(s => recur(s)).join(".");
		if (!node.delims || node.delims.length === 0) return content;
		// Lifted-wrapper case: delims surround the content. Walk
		// delims with content as anchor at the gap.
		var out = "";
		var anchorEmitted = false;
		var pos = node.start;
		for (let d of node.delims) {
			if (!anchorEmitted && d.start > pos) {
				out += content;
				anchorEmitted = true;
			}
			out += d.value;
			pos = d.end != null ? d.end : pos;
		}
		if (!anchorEmitted) out += content;
		return out;
	},

	// FuncTypeArg, FuncTypeExpr — no custom handlers. The shapers
	// now keep Qmark dual-purpose (flag AND delim), so the `?`
	// token's position is preserved in node.delims. emitGeneric
	// walks pieces in source order and the `?` emits naturally at
	// its source position, just like Star (rest sigil) and Caret
	// (return-type marker) already do.
};


// =============================================================
// GENERIC EMITTER
//
// Default path when no handler is registered. Sound when every
// structural token is in `node.delims` and every child node is
// reachable via enumerable properties — i.e. no token was dropped
// under the field-name-semantics rule.
// =============================================================

var emitGeneric = (node, recur) => {
	var pieces = collectPieces(node);
	if (pieces.length === 0) {
		if (node.text != null) return node.text;
		if (node.name != null) return node.name;
		return "";
	}
	var out = "";
	for (let p of pieces) {
		out += isNode(p) ? recur(p) : p.value;
	}
	return out;
};


// =============================================================
// DISPATCH
// =============================================================

var emit = node => {
	if (node == null) return "";
	var h = handlers[node.type];
	return h ? h(node, emit) : emitGeneric(node, emit);
};


// =============================================================
// DIFF REPORTING
// =============================================================

var firstDiff = (a, b) => {
	var n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i++) {
		if (a[i] !== b[i]) return i;
	}
	return a.length === b.length ? -1 : n;
};

var window = (s, at, span = 24) => {
	var from = Math.max(0, at - span);
	var to   = Math.min(s.length, at + span);
	var prefix = from > 0 ? "…" : "";
	var suffix = to < s.length ? "…" : "";
	return prefix + JSON.stringify(s.slice(from, to)).slice(1, -1) + suffix;
};


// =============================================================
// RUNNER
// =============================================================

var passed = 0;
var failures = [];

for (let i = 0; i < samples.length; i++) {
	let { label, src } = samples[i];

	let program = null;
	try {
		for await (let tree of parseFoi(src, { preserveSoftDelims: true })) {
			program = tree;
		}
	}
	catch (err) {
		failures.push({ idx: i, label, src, stage: "parse", err });
		continue;
	}

	if (program == null) {
		failures.push({ idx: i, label, src, stage: "parse", err: new Error("no Program node yielded") });
		continue;
	}

	let out;
	try {
		out = emit(program);
	}
	catch (err) {
		failures.push({ idx: i, label, src, stage: "emit", err });
		continue;
	}

	if (out === src) {
		passed++;
	}
	else {
		failures.push({ idx: i, label, src, out, stage: "diff", diffAt: firstDiff(src, out) });
	}
}

console.log(`${passed}/${samples.length} round-tripped`);

for (let f of failures) {
	let srcPreview = f.src.length > 60 ? f.src.slice(0, 57) + "..." : f.src;
	console.log(`\n[${f.idx}] ${f.label ?? "<unlabeled>"} — ${f.stage} failure`);
	console.log(`  src: ${JSON.stringify(srcPreview)}`);
	if (f.stage === "diff") {
		console.log(`  diverged at offset ${f.diffAt} (src len=${f.src.length}, out len=${f.out.length})`);
		console.log(`    src @${f.diffAt}: ${window(f.src, f.diffAt)}`);
		console.log(`    out @${f.diffAt}: ${window(f.out, f.diffAt)}`);
	}
	else {
		console.log(`  err: ${f.err.message}`);
	}
}

if (failures.length > 0) process.exit(1);
