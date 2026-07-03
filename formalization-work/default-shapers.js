// default-shapers.js — AST shape conventions for the Foi syntactic parser.
//
// Each shaper receives (frame, parts) where parts is the source-
// ordered, delim-free sequence of terminals (tokens) and recursively-
// shaped child nodes. Returns a plain object with at minimum a `type`
// field; the machinery brand-stamps `start`/`end` (and `delims` under
// preserveSoftDelims) onto the returned node. Productions not in this
// map receive the default shape: { type, parts, start, end }.
//
// Conventions:
//   - Drop keyword/operator tokens (anchored in type tag, op field,
//     or named field — recoverable from the shape).
//   - Push structural tokens (semicolons, commas, brackets, parens,
//     braces, angles, sigils not captured in fields, etc.) into
//     node.delims for source-fidelity reconstruction. Use the
//     withDelims helper at the end of each shaper so the field is
//     omitted when empty (truthy `node.delims` checks remain valid).
//   - Promote semantically meaningful children to named fields
//     (target, init, name, op, left, right, args, callee, object,
//     segments, stmts, defs, as, ...).
//   - List-shaped productions collapse to a single array field.
//   - Optional clauses (e.g. AsAnnotationExpr) become optional
//     fields, omitted from the node when absent.
//   - Wrapper-unwrap at assignment (adaptive). When a child production
//     exists only as a single-payload wrapper around one semantic
//     value (e.g. AsAnnotationExpr around NamedType, FuncAsClause
//     around Identifier), parents fold to the payload at the slot
//     assignment when the wrapper has no delims — the slot name on
//     the parent (e.g. `parent.as`) conveys the role. When the
//     wrapper has delims (picked up under preserveSoftDelims:true,
//     or from unconsumed hard structural tokens), parents keep the
//     full wrapper to preserve them, and the slot becomes shape-
//     polymorphic. Consumers normalize via type tag:
//       var inner = wrap.type === "AsAnnotationExpr" ? wrap.annotation : wrap;
//     Exception: FuncOverClause is always retained — its parens and
//     commas are unconditional structural tokens with nowhere else
//     to live.
//   - start/end/delims rules: the machinery brand-stamps start/end
//     on every shaped node. Soft delims (Whitespace, Comment) are
//     merged into node.delims by the machinery when preserveSoftDelims
//     is on; the merge is by source position against any hard delims
//     the shaper populated. Under preserveSoftDelims:false (default
//     for test-parser.js / inspect-ast.js), no soft delims are
//     captured and shaper-emitted hard delims persist untouched.
//   - Multi-token operators (e.g. AddOp `$+`) concatenate their
//     token values into a single string in the `op` field.
//
// Token-vs-node discriminator in `parts`:
//   Raw tokens carry a `value` field (string, from the lex layer);
//   shaped nodes never expose `value` at top level. Literal
//   shapers expose source as `text`, identifiers as `name`, etc.
//   The isNode helper below tests this. SHAPERS MUST NOT set a
//   `value` field on returned nodes — doing so breaks the
//   discriminator for any parent shaper that consumes them.
//
// `:as` annotation handling — centralized via AsExpr (§5):
//   Per the grammar's first-class `:as` precedence rule, `:as`
//   binds at exactly one tier — strictly between unary and binary.
//   A single visible production, `AsExpr := <AsableExpr> _ AsAnnotationExpr`,
//   carries the annotation for non-paren expressions. Its shaper
//   UNWRAPS — attaches the annotation onto its inner node's `.as`
//   slot and returns the inner. No `AsExpr` node type appears in
//   the AST. The machinery's unconditional start/end overwrite
//   extends the returned node's span to cover the `:as` tail
//   (AsExpr frame spans from inner.start through annotation.end).
//
//   `inner.as` is shape-polymorphic per the adaptive wrapper-unwrap
//   rule (see Conventions): bare NamedType when AsAnnotationExpr
//   has no delims (default mode), the full AsAnnotationExpr node
//   when it has internal trivia (preserveSoftDelims:true with WS
//   between `:as` and the type). Same rule applies to GroupedExpr.as
//   (via shapeGrouped) and DefFuncExpr.as (via the FuncAsClause arm).
//
//   The six paren-grouping productions retain their own
//   `(_ AsAnnotationExpr)?` tail — parens are atomic groups that
//   can carry `:as` regardless of position (including as a binary
//   operand). Their shapers (via shapeGrouped) attach `as` with
//   the same adaptive fold-or-keep behavior. The four restrictive
//   paren inners additionally accept AsExpr as a first inner alt
//   so that `(?x :as bool)` etc. parse inside the parens.
//
//   Paren-grouping productions are NOT reachable from <AsableExpr>
//   (see parser.js §5). That keeps the outer AsExpr's `inner.as = ...`
//   from ever running on a GroupedExpr — eliminating the would-be
//   clobber when both the paren's own tail and an outer AsExpr both
//   try to attach a `:as` to the same node. `(x) :as bool :as char`
//   is a parse error, not a silent overwrite.
//
//   All other expression productions — literals, identifiers,
//   unary, chain/call/access, at-form, op-as-func, block — carry
//   no `:as` tail at the grammar level. Their shapers do not
//   handle `as`; AsExpr handles it for them.

// =============================================================
// HELPERS
// =============================================================

// Token-vs-node discriminator. Raw tokens have a `value` field
// (string, from the lex layer); shaped nodes never do. SHAPERS
// MUST NOT set a `value` field on returned nodes — collision with
// this predicate breaks every parent shaper's parts.filter(isNode)
// / parts.find(isNode) call.
export var isNode = p => !("value" in p);

// Attach a non-empty delims array to a shaped node. No-op if
// delims is empty; the field is omitted so consumers can use
// truthy `node.delims` checks.
function withDelims(node, delims) {
	if (delims.length > 0) node.delims = delims;
	return node;
}

// Merge wrapper-token delims onto a shaped inner node when an
// unwrap-shaper returns its single payload. The wrapper's
// structural punctuation (e.g. parens around a paren-recursive
// arm) would otherwise vanish; this lifts them onto the surviving
// inner node in source-position order. Both arrays are already
// source-ordered, so a linear two-pointer merge by `.start`
// suffices.
function liftWrapperDelims(inner, wrapperDelims) {
	if (wrapperDelims.length === 0) return inner;
	var existing = inner.delims || [];
	if (existing.length === 0) {
		inner.delims = wrapperDelims;
		return inner;
	}
	var out = [];
	var i = 0, j = 0;
	while (i < wrapperDelims.length && j < existing.length) {
		if (wrapperDelims[i].start <= existing[j].start) out.push(wrapperDelims[i++]);
		else                                              out.push(existing[j++]);
	}
	while (i < wrapperDelims.length) out.push(wrapperDelims[i++]);
	while (j < existing.length)      out.push(existing[j++]);
	inner.delims = out;
	return inner;
}

// Helper for ChainExpr's fold (below). Given an `object`
// expression and a single chain segment node, returns a typed
// wrapper node:
//
//   PrefixCallSuffix   → CallExpr         { callee, args }
//   PartialCallSuffix  → PartialCallExpr  { callee, args }
//   DotIdentifier      → MemberAccessExpr { object, accessor | index }
//   BracketExpr        → IndexAccessExpr  { object, expr }
//   DotBracketExpr     → RangeAccessExpr  { object, range }
//   DotAngleExpr       → PropertyPickExpr { object, properties }
//
// Each returned node carries explicit start/end since these are
// synthetic intermediates the machinery doesn't reach. The seg's
// own delims (its structural tokens — parens / pipes / brackets /
// angles / commas — plus any auto-merged soft delims under
// preserveSoftDelims) propagate onto the synthesized node. Without
// this propagation the seg's tokens vanish entirely from the AST
// (only seg.end survives via node.end), and source recovery for
// internal whitespace, comma spacing, and structural punctuation
// is impossible.
//
// Chain-level soft delims (WS / comments between ChainBase and
// ChainSeg, between segs, between SingleQuote and post-prime
// CallSuffix) are partitioned by ChainExpr's shaper — see
// ChainExpr below — and attached to the folded node that results
// from folding the seg AFTER each gap. Each folded node therefore
// carries source-position fidelity for both its own seg.delims
// AND any chain-level trivia preceding it. ChainExpr opts into
// preserveInnerDelim so the machinery's auto-merge of soft delims
// onto the outermost node is suppressed.
//
// Leading Periods on DotIdentifier / DotBracketExpr / DotAngleExpr
// are NOT in seg.delims — anchored in the seg's type tag and
// dropped at the seg's own shaper. Consumers re-synthesize from
// the resulting node's type.
//
// PrefixCallSuffix always exposes uniform `args`. The bare-op-in-
// parens form (`foo(+')`, gated by CallArgs' &(CloseParen)
// lookahead) is normalized upstream by PrefixCallSuffix's shaper
// into a single-element `args` containing a synthetic OpFuncExpr
// — semantically equivalent to the explicit form `foo((+)')`. So
// CallExpr's shape here is uniform: `{ callee, args }`.
//
// DotIdentifier's mutually-exclusive `accessor` (node, for
// `foo.bar` / `foo.List`) and `index` (string, for `arr.5` /
// `arr.-1`) discriminator is preserved on MemberAccessExpr.
// Consumers branch on which field is present to distinguish name
// lookup from positional index.
function applyChainSeg(object,seg) {
	var t = seg.type;
	var node;
	if (t === "PrefixCallSuffix") {
		node = {
			type: "CallExpr",
			callee: object,
			args: seg.args,
			start: object.start,
			end: seg.end,
		};
	}
	else if (t === "PartialCallSuffix") {
		node = {
			type: "PartialCallExpr",
			callee: object,
			args: seg.args,
			start: object.start,
			end: seg.end,
		};
	}
	else if (t === "DotIdentifier") {
		node = {
			type: "MemberAccessExpr",
			object,
			start: object.start,
			end: seg.end,
		};
		if (seg.accessor) node.accessor = seg.accessor;
		else node.index = seg.index;
	}
	else if (t === "BracketExpr") {
		node = {
			type: "IndexAccessExpr",
			object,
			expr: seg.expr,
			start: object.start,
			end: seg.end,
		};
	}
	else if (t === "DotBracketExpr") {
		node = {
			type: "RangeAccessExpr",
			object,
			range: seg.range,
			start: object.start,
			end: seg.end,
		};
	}
	else if (t === "DotAngleExpr") {
		node = {
			type: "PropertyPickExpr",
			object,
			properties: seg.properties,
			start: object.start,
			end: seg.end,
		};
	}
	else {
		throw new Error(`ChainExpr: unexpected segment type "${t}"`);
	}
	if (seg.delims) node.delims = seg.delims;
	return node;
}

// Helper for the seven unified access-fold sites — AtCallExpr
// base, AssignmentExpr LHS, ExportNamedBinding source,
// ExportConciseBinding source, DestructureNamedDef source,
// DestructureConciseDef source, and PickValue source. Given a
// base node and a SingleAccessExpr or MultiAccessExpr (or
// undefined), folds the access segments via applyChainSeg
// left-to-right and returns the resulting nested chain.
// undefined access returns the base unchanged.
//
// Wrapper-unwrap-at-assignment pattern — SingleAccessExpr /
// MultiAccessExpr shapers still emit their own node, but parents
// that mount an access-bearing base reach through `.segments` and
// consume the wrapper. The result is uniform with the typed-node
// fold ChainExpr produces in operand position: `foo.bar` shapes
// the same way whether it appears as a chain base or as an
// AssignmentExpr LHS.
function foldAccess(base,access) {
	if (!access) return base;
	var node = base;
	for (let seg of access.segments) {
		node = applyChainSeg(node,seg);
	}
	return node;
}

// Helper for the two "named binding" productions —
// ExportNamedBinding (§3) and DestructureNamedDef (§4). Both
// share the shape `Identifier _ Colon _ <source-base> MultiAccessExpr?`.
// Colon is a structural delim — push to node.delims.
//
// Field naming `{ target, source }` is symmetric with
// AssignmentExpr's `{ target, source }` — same conceptual roles
// (binding LHS / value RHS), inverted only in which side carries
// the access chain.
//
// `target` retains the full Identifier node — matches
// DefFuncExpr.name / DefTypeStmt.name precedent.
//
// DestructureNamedDef additionally accepts BracketExpr as the
// source-base (computed-key destructure, `def < foo: [k].bar >:`).
// foldAccess handles BracketExpr-as-base transparently.
function shapeNamedBinding(typeName,parts) {
	var nodes = [];
	var delims = [];
	for (let p of parts) {
		if (isNode(p)) nodes.push(p);
		else delims.push(p);
	}
	var [ target, sourceBase, access ] = nodes;
	return withDelims({
		type: typeName,
		target,
		source: foldAccess(sourceBase,access),
	}, delims);
}

// Helper for the two "concise binding" productions —
// ExportConciseBinding (§3) and DestructureConciseDef (§4). Both
// share the shape `Colon Identifier SingleAccessExpr?`. Colon is
// a structural delim.
//
// Single-slot shape `{ source }` — per source-fidelity, the
// concise form is deliberately distinct from the named form.
// `:foo` is NOT desugared to `foo: foo`; consumers branch on the
// concise-form type tag to learn that the binding name is
// derived from the source path's outermost name.
function shapeConciseBinding(typeName,parts) {
	var nodes = [];
	var delims = [];
	for (let p of parts) {
		if (isNode(p)) nodes.push(p);
		else delims.push(p);
	}
	var [ sourceBase, access ] = nodes;
	return withDelims({
		type: typeName,
		source: foldAccess(sourceBase,access),
	}, delims);
}

// All six shape to a single `GroupedExpr` node type at the AST
// surface; no downstream consumer branches on which variant
// matched.
//
// Surrounding parens are structural — push to delims. Inner
// expression promotes to `expr`. Optional `:as` tail attaches
// onto `as` adaptively (see AsExpr): bare NamedType when the
// AsAnnotationExpr wrapper carries no delims, the full
// AsAnnotationExpr node when it does. Consumers reading `.as`
// must accept either shape.
//
// Parens are the only construct that still carries its own `:as`
// tail post-rework — they're atomic groups, so `:as` can attach
// regardless of position (including as a binary operand, as in
// `(x + y) :as int ~map f`).
function shapeGrouped(parts) {
	var expr, as;
	var delims = [];
	for (let p of parts) {
		if (isNode(p)) {
			if (p.type === "AsAnnotationExpr") as = p.delims ? p : p.annotation;
			else expr = p;
		}
		else delims.push(p);
	}
	var node = { type: "GroupedExpr", expr };
	if (as) node.as = as;
	return withDelims(node, delims);
}

// Helper for the two §8 unary productions (NamedUnaryExpr,
// SymbolicUnaryExpr). Both share `op _ BinaryAtom` shape. The op
// runs across leading non-node tokens (single token in practice:
// ?empty/!empty as BooleanOper, or Qmark/Exmark); `right` is the
// single operand node.
//
// NO structural delims — all non-node tokens are operator chars
// consumed into the `op` field.
//
// Field naming: `{ op, right }` — `right` for positional symmetry
// with shapeBinTier's `{ left, op, right }`; unary is just a
// binary with `left` absent.
function shapeUnaryTier(typeName,parts) {
	var op = "";
	var right;
	for (let p of parts) {
		if (isNode(p)) right = p;
		else op += p.value;
	}
	return { type: typeName, op, right };
}

// Helper for the six §9 binary tier iter productions (FlowBinExpr,
// OrBinExpr, AndBinExpr, CompareBinExpr, AddBinExpr, MulBinExpr).
// Each iter is `lhs (op rhs)+` — flat-fold to nested
// `{ left, op, right }` (left-associative).
//
// NO structural delims — all non-node tokens are operator chars
// consumed into the `op` field. Multi-token ops accumulate via
// the token-run pattern (AddOp `$+` → Dollar + Plus, FlowOps
// `#>` / `+>` / `<+` → 2 tokens each, SymbolicCompareOp `?<=>`
// → 4 tokens, named/keyword ops → 1 BooleanOper/Comprehension).
//
// Intermediate fold nodes set start/end explicitly since the
// machinery only stamps the outermost return.
//
// TypeCompareBinExpr is NOT routed through this helper — it's
// non-iter (single op, RHS is NamedType) with its own shaper.
function shapeBinTier(typeName,parts) {
	var operands = [];
	var ops = [];
	var pendingOp = "";
	for (let p of parts) {
		if (isNode(p)) {
			if (pendingOp) {
				ops.push(pendingOp);
				pendingOp = "";
			}
			operands.push(p);
		}
		else {
			pendingOp += p.value;
		}
	}
	var node = operands[0];
	for (let i = 0; i < ops.length; i++) {
		node = {
			type: typeName,
			left: node,
			op: ops[i],
			right: operands[i + 1],
			start: node.start,
			end: operands[i + 1].end,
		};
	}
	return node;
}

// Helper for the polarity field naming convention used in §15
// (and reused from §14's CondClause shape rationale).
//
// When user wrote ?/! explicitly, the field is `polarity` with
// that token's value. When the polarity slot was omitted
// (allowed by <IndepCondClause> and DepCondClause, and by
// ElseStmt's leading-? form), the field is `defaultPolarity`
// with the implicit "?" value.
//
// Field-name discrimination preserves user-written vs. implicit
// source-fidelity without an extra boolean flag. Consumers
// reading effective polarity do `clause.polarity ?? clause.defaultPolarity`.
//
// Returns an object spreadable onto the caller's result.
function shapePolarity(polarityTok) {
	if (polarityTok) return { polarity: polarityTok.value };
	return { defaultPolarity: "?" };
}

// Helper for the two §15 independent-match pattern-stmt
// productions — IndepPatternStmt and IndepPatternStmtNoSemi.
// Both collapse to the same {type: "IndepPatternStmt", ...} node.
//
// <IndepCondClause> stays hidden — its content splices in.
// Parts contain: optional Qmark/Exmark, BracketExpr (the test),
// then spliced <MatchConsequent>/<MatchConsequentNoSemi> content
// (either [Colon, Expr-node, Semi] or [BareBlockExpr-node]).
//
// Synthesizes a CondClause node uniform with §14's
// GuardedExpr.clause — same {polarity|defaultPolarity, test}
// shape. Synthetic, so start/end is set explicitly. The
// synthesized CondClause does NOT carry delims of its own — the
// Qmark/Exmark token is captured into polarity, and no other raw
// tokens belong to it (the BracketExpr child owns its own
// brackets).
//
// Outer IndepPatternStmt collects Colon/Semicolon as delims.
function shapeIndepPatternStmt(parts) {
	var polarityTok, test, consequent;
	var outerDelims = [];
	for (let p of parts) {
		if (isNode(p)) {
			if (!test) test = p;
			else if (!consequent) consequent = p;
		}
		else if (p.type === "Qmark" || p.type === "Exmark") {
			polarityTok = p;
		}
		else outerDelims.push(p);
	}
	var clause = {
		type: "CondClause",
		...shapePolarity(polarityTok),
		test,
		start: polarityTok ? polarityTok.start : test.start,
		end: test.end,
	};
	return withDelims({ type: "IndepPatternStmt", clause, consequent }, outerDelims);
}

// Helper for the two §15 dependent-match pattern-stmt
// productions — DepPatternStmt and DepPatternStmtNoSemi. Both
// collapse to {type: "DepPatternStmt", ...}.
//
// DepCondClause is visible, so it arrives in parts as a typed
// node directly. Consequent comes from the spliced
// <MatchConsequent>/<MatchConsequentNoSemi> content.
//
// Outer Colon/Semicolon push to delims.
function shapeDepPatternStmt(parts) {
	var clause, consequent;
	var delims = [];
	for (let p of parts) {
		if (isNode(p)) {
			if (p.type === "DepCondClause") clause = p;
			else if (!consequent) consequent = p;
		}
		else delims.push(p);
	}
	return withDelims({ type: "DepPatternStmt", clause, consequent }, delims);
}

// Shapes a PropertyExpr key. PropertyExpr is grammar-hidden:
//
//   <PropertyExpr> := Identifier | <PositiveIntLit>;
//
// Identifier arrives as a node — passthrough. PositiveIntLit
// arrives as one or two raw tokens (bare PositiveIntegerLit, or
// [Escape, PositiveIntegerLit] for the `\5_000` form). Synthesize
// a NumberLit mirroring the existing NumberLit shaper: text =
// concat of token values; span derives from first/last token.
// Synthetic — machinery doesn't reach this node, so start/end is
// set explicitly. No delims (the Escape+digit tokens are the
// literal content, not structural).
//
// Used by ConcisePropDef.source and ExplicitPropDef.key (static
// arm).
function shapePropertyExpr(keyParts) {
	var node = keyParts.find(isNode);
	if (node) return node;
	var text = "";
	for (let p of keyParts) text += p.value;
	return {
		type: "NumberLit",
		text,
		start: keyParts[0].start,
		end:   keyParts[keyParts.length - 1].end,
	};
}

// Synthesizes a ComputedPropName AST node from the parts span
// covering Percent + bare-arm inner / paren-wrap inner.
//
// Input shape: [Percent, ...trailingParts] where trailingParts
// is one of:
//   - [<one node>]         — BooleanLit / StringLit /
//                            ComputedPropAccessChain fold output /
//                            ComputedPropParenExpr unwrap output.
//                            Inner is the node as-is.
//   - [<raw numeric tokens>] — PositiveIntegerLit alone, bare
//                              Number alone (decimal `3.14` /
//                              `-3.14`), NegativeIntegerLit alone,
//                              or Escape + PositiveIntegerLit/Number
//                              for the typed-radix, sep'd-int, and
//                              sep'd-decimal numeric-literal alphabet.
//                              Inner is a synthesized NumberLit
//                              (same pattern as shapePropertyExpr).
//
// Used by ExplicitPropDef (record/tuple computed key) and
// DotAngleExpr (angle-pick computed key) — both share the same
// narrowed alphabet per the §17 grammar.
//
// Returned node:
//   { type: "ComputedPropName", expr, start, end }
// where start is Percent.start and end is inner.end. No delims —
// the round-trip handler `gapFill("%", n, r)` reconstructs the
// Percent sigil at the gap before expr.
function shapeComputedPropName(parts) {
	var percent = parts[0]; // first token is always Percent per grammar
	var rest = parts.slice(1);
	var inner = rest.find(isNode);
	if (!inner) {
		// Numeric-literal bare arm — raw tokens only past Percent.
		var text = "";
		for (let p of rest) text += p.value;
		inner = {
			type: "NumberLit",
			text,
			start: rest[0].start,
			end:   rest[rest.length - 1].end,
		};
	}
	return {
		type: "ComputedPropName",
		expr: inner,
		start: percent.start,
		end:   inner.end,
	};
}

// α-claim shaper for StmtSemi-family productions (StmtSemi,
// StmtSemiOpt, ExportStmtSemi, ExportStmtSemiOpt,
// FuncBodyStmtSemi, FuncBodyStmtSemiOpt, DoStmtSemi,
// DoStmtSemiOpt).
//
// α-rule: a stmt's claim region is its own span plus post-stmt
// tokens up through the FIRST Semicolon. Everything past that
// (additional semis, post-claim trivia) is orphan and lifts to
// the parent stmt-list container via the machinery's __lift
// channel. Absent a semi (e.g. last stmt of a scope with no
// trailing `;`), the claim is empty and all non-node tokens
// lift.
//
// Returns the lift form `{ node, __lift }`. The machinery
// recognizes this shape and (a) skips its unconditional span
// overwrite — this shaper owns the inner stmt's `end`, setting
// it to the end of the last claimed token — and (b) splices the
// lifted tokens into the parent's merged stream immediately
// after the inner node.
//
// Empty-stmt synthesis:
//   - Bare semi run (`;`, `;;`, …) with no Stmt: first semi
//     becomes the EmptyStmt's terminator; extras lift. EmptyStmt
//     carries the first semi in its delims; subsequent semis
//     orphan to parent.
//   - Fully empty StmtSemiOpt at end of input: EmptyStmt with no
//     delims. Filtered by collectStmtList (containers) and by
//     parseFoi's per-stmt yield loop.
function shapeStmtSemi(parts) {
	var inner;
	var firstSemiIdx = -1;
	for (let i = 0; i < parts.length; i++) {
		let p = parts[i];
		if (isNode(p)) {
			if (!inner) inner = p;
		}
		else if (firstSemiIdx === -1 && p.type === "Semicolon") {
			firstSemiIdx = i;
		}
	}

	var claimed = [];
	var lift = [];
	if (firstSemiIdx !== -1) {
		for (let i = 0; i < parts.length; i++) {
			let p = parts[i];
			if (isNode(p)) continue;
			if (i <= firstSemiIdx) claimed.push(p);
			else                   lift.push(p);
		}
	}
	else {
		for (let p of parts) {
			if (!isNode(p)) lift.push(p);
		}
	}

	var node;
	if (inner) {
		if (claimed.length > 0) {
			let d = inner.delims || [];
			for (let t of claimed) d.push(t);
			inner.delims = d;
			inner.end = claimed[claimed.length - 1].end;
		}
		node = inner;
	}
	else if (claimed.length > 0) {
		node = withDelims({
			type:  "EmptyStmt",
			start: claimed[0].start,
			end:   claimed[claimed.length - 1].end,
		}, claimed);
	}
	else {
		node = { type: "EmptyStmt", start: null, end: null };
	}

	return { node, __lift: lift };
}

// Collect children of a stmt-list container (Program, BlockExpr,
// DefBlockStmt, FuncBodyBlock, DoBlockExpr). Filters fully-empty
// EmptyStmts (no delims — synthesized for fully-empty
// StmtSemiOpt at end of input). Non-node parts route to delims
// (orphan semis lifted from child StmtSemi frames land here, as
// do container-level structural tokens like braces).
function collectStmtList(parts) {
	var stmts = [];
	var delims = [];
	for (let p of parts) {
		if (isNode(p)) {
			if (p.type === "EmptyStmt" && !p.delims) continue;
			stmts.push(p);
		}
		else delims.push(p);
	}
	return { stmts, delims };
}


export const defaultShapers = {

	// =============================================================
	// §1 PROGRAM / STATEMENTS
	// =============================================================

	// Program := _ ((StmtSemi | ExportStmtSemi) _)*
	//            ((StmtSemiOpt | ExportStmtSemiOpt) _)?;
	//
	// Pure list-of-statements. Semicolons are structural — push
	// to delims; everything shaped is a top-level statement node.
	Program(frame,parts) {
		var { stmts, delims } = collectStmtList(parts);
		return withDelims({ type: "Program", stmts }, delims);
	},

	// StmtSemi          := Stmt? (_ Semicolon)+;
	// StmtSemiOpt       := Stmt? (_ Semicolon)*;
	// ExportStmtSemi    := ExportExpr (_ Semicolon)+;
	// ExportStmtSemiOpt := ExportExpr (_ Semicolon)*;
	//
	// α-claim via shapeStmtSemi: inner stmt eats trivia + first
	// semi; rest lifts to parent.
	StmtSemi         (frame,parts) { return shapeStmtSemi(parts); },
	StmtSemiOpt      (frame,parts) { return shapeStmtSemi(parts); },
	ExportStmtSemi   (frame,parts) { return shapeStmtSemi(parts); },
	ExportStmtSemiOpt(frame,parts) { return shapeStmtSemi(parts); },

	// Identifier := General;
	//
	// Bare token-stream extraction. Concatenates the part values
	// into a single `name` string. No structural delims — General
	// tokens are content, not punctuation.
	Identifier(frame,parts) {
		var name = "";
		for (let p of parts) name += p.value;
		return { type: "Identifier", name };
	},

	// BuiltIn := Builtin;
	//
	// Same pattern as Identifier. No structural delims.
	BuiltIn(frame,parts) {
		var name = "";
		for (let p of parts) name += p.value;
		return { type: "BuiltIn", name };
	},

	// PipelineTopic := Hash;
	//
	// Single Hash token; `name` is the literal "#". The Hash here
	// is the identifier-position pipeline-topic sigil — captured
	// into `name`, not a structural delim.
	PipelineTopic(frame,parts) {
		var name = "";
		for (let p of parts) name += p.value;
		return { type: "PipelineTopic", name };
	},


	// =============================================================
	// §2 LITERALS
	// =============================================================

	// NumberLit := EscapedNumber | Number | IntegerLit;
	//
	// Concatenates contained number/escape token values into a
	// single source-text string. No structural delims — all tokens
	// are literal content.
	NumberLit(frame,parts) {
		var text = "";
		for (let p of parts) text += p.value;
		return { type: "NumberLit", text };
	},

	// UnicodeCharLit := EscapeUnicode Number;
	//
	// Reachable only as the sole contents of an InterpExpr slot
	// (see parser.js InterpExpr). Same shape as NumberLit — concat
	// part values into `text` — distinct `type` tag so the
	// transpiler routes to its own handler.
	UnicodeCharLit(frame,parts) {
		var text = "";
		for (let p of parts) text += p.value;
		return { type: "UnicodeCharLit", text };
	},

	// BooleanLit := "true" | "false";
	//
	// Single Native token. Text is the raw lexeme.
	BooleanLit(frame,parts) {
		var text = "";
		for (let p of parts) text += p.value;
		return { type: "BooleanLit", text };
	},

	// EmptyLit := "empty";
	//
	// Type tag is total information; no `text` field. The
	// "empty" keyword anchors the type tag — drops.
	EmptyLit(frame,parts) {
		return { type: "EmptyLit" };
	},

	// PlainStr := DoubleQuote PlainStrContent* DoubleQuote;
	//
	// Resolves `""` escape to `"` at shape time, building `text`
	// as pre-processed content ready for downstream consumers
	// (transpile / interpret). EVERY raw token — DoubleQuote
	// wrappers and content (String / StringEscapedChar) — goes
	// to delims with source positions intact, so round-trip
	// (emitGeneric) walks pieces in source order and
	// reconstructs source verbatim. No custom round-trip handler
	// needed. Discriminator at the consumer: `text` for the
	// processed value, delims for source recovery. Same shape
	// applies uniformly across all four string forms.
	PlainStr(frame,parts) {
		var text = "";
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) continue;
			if (p.type === "String") {
				text += p.value;
			}
			else if (p.type === "StringEscapedChar") {
				text += p.value[0]; // "" → "
			}
			delims.push(p); // every non-node token preserved for round-trip
		}
		return withDelims({ type: "PlainStr", text }, delims);
	},

	// SpacingEscapedStr := EscapePlain DoubleQuote SpacingEscapedStrContent* DoubleQuote;
	//
	// Same shape as PlainStr (text + every-token delims) plus
	// the spacing-form whitespace-collapse rule: each Whitespace
	// token contributes one space to `text`. The lexer's own
	// isWS(c) predicate identifies Whitespace tokens as maximal
	// WS runs, so "one Whitespace token = one space" is the
	// authoritative collapse rule — Unicode-safe by lexer
	// construction, no regex needed downstream. The leading
	// EscapePlain `\` joins delims like every other token.
	SpacingEscapedStr(frame,parts) {
		var text = "";
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) continue;
			if (p.type === "String") {
				text += p.value;
			}
			else if (p.type === "StringEscapedChar") {
				text += p.value[0]; // "" → "
			}
			else if (p.type === "Whitespace") {
				text += " "; // collapse run → single space
			}
			delims.push(p); // every non-node token preserved for round-trip
		}
		return withDelims({ type: "SpacingEscapedStr", text }, delims);
	},

	// InterpExpr := Backtick _ Expr _ Backtick;
	//
	// Interp slot inside the two interp-string forms. Surrounding
	// Backticks are structural → delims. The inner expression is
	// exposed as `expr`.
	InterpExpr(frame,parts) {
		var expr;
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) expr = p;
			else delims.push(p); // Backtick
		}
		return withDelims({ type: "InterpExpr", expr }, delims);
	},

	// InterpStr := EscapeBacktick DoubleQuote InterpStrContent* DoubleQuote;
	//
	// Surfaces as a `chunks` array alternating pre-processed
	// string text and InterpExpr nodes — interp boundaries
	// split the chunks. Invariant: chunks.length is always odd,
	// chunks[0] and chunks[last] are always strings (possibly
	// "").
	//
	// String chunks have `""` / ` `` ` escapes resolved at
	// shape time. All raw tokens (EscapeBacktick, DoubleQuote,
	// content tokens) push to delims with source positions;
	// round-trip uses emitGeneric, picking up InterpExpr nodes
	// from the enumerable `chunks` array (bare strings in
	// chunks are filtered by isNode automatically).
	InterpStr(frame,parts) {
		var chunks = [];
		var buf = "";
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) {
				if (p.type === "InterpExpr") {
					chunks.push(buf);
					chunks.push(p);
					buf = "";
				}
				continue;
			}
			if (p.type === "String") {
				buf += p.value;
			}
			else if (p.type === "StringEscapedChar") {
				buf += p.value[0]; // "" → " or `` → `
			}
			delims.push(p); // every non-node token preserved for round-trip
		}
		chunks.push(buf);
		return withDelims({ type: "InterpStr", chunks }, delims);
	},

	// SpacingInterpStr := EscapeSpacingBacktick DoubleQuote SpacingInterpStrContent* DoubleQuote;
	//
	// Same shape as InterpStr (chunks + every-token delims)
	// plus the spacing-form whitespace-collapse rule: each
	// Whitespace token contributes one space to the current
	// chunk. Per-chunk collapse — interp boundaries are
	// independent collapse regions. Lexer's isWS(c) identifies
	// maximal WS runs as Whitespace tokens, so "one Whitespace
	// token = one space" is the authoritative Unicode-safe
	// rule.
	SpacingInterpStr(frame,parts) {
		var chunks = [];
		var buf = "";
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) {
				if (p.type === "InterpExpr") {
					chunks.push(buf);
					chunks.push(p);
					buf = "";
				}
				continue;
			}
			if (p.type === "String") {
				buf += p.value;
			}
			else if (p.type === "StringEscapedChar") {
				buf += p.value[0]; // "" → " or `` → `
			}
			else if (p.type === "Whitespace") {
				buf += " "; // collapse run → single space
			}
			delims.push(p); // every non-node token preserved for round-trip
		}
		chunks.push(buf);
		return withDelims({ type: "SpacingInterpStr", chunks }, delims);
	},


	// =============================================================
	// §3 IMPORTS / EXPORTS
	// =============================================================

	// ImportExpr := "import" _ PlainStr;
	//
	// Keyword "import" drops. The PlainStr node is kept intact.
	// No structural tokens.
	ImportExpr(frame,parts) {
		return { type: "ImportExpr", from: parts.find(isNode) };
	},

	// ExportNamedBinding := Identifier _ Colon _ Identifier MultiAccessExpr?;
	ExportNamedBinding(frame,parts)   { return shapeNamedBinding("ExportNamedBinding",parts); },

	// ExportConciseBinding := Colon Identifier SingleAccessExpr?;
	ExportConciseBinding(frame,parts) { return shapeConciseBinding("ExportConciseBinding",parts); },

	// ExportExpr := "export" _ OpenBrace _ <ExportBindingsList> _ CloseBrace;
	//
	// "export" keyword drops; braces and commas are structural →
	// delims.
	ExportExpr(frame,parts) {
		var entries = [];
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) entries.push(p);
			else if (p.type === "Keyword") continue; // "export"
			else delims.push(p); // OpenBrace, CloseBrace, Comma
		}
		return withDelims({ type: "ExportExpr", entries }, delims);
	},


	// =============================================================
	// §4 VARIABLE DEFINITIONS / DESTRUCTURING
	// =============================================================

	// DefVarStmt := "def" _ (Identifier | DestructureTarget) _ Colon _ (Expr | ImportExpr);
	//
	// "def" keyword drops; Colon is structural → delims.
	DefVarStmt(frame,parts) {
		var nodes = [];
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) nodes.push(p);
			else if (p.type === "Keyword") continue; // "def"
			else delims.push(p); // Colon
		}
		var [ target, init ] = nodes;
		return withDelims({ type: "DefVarStmt", target, init }, delims);
	},

	// DestructureNamedDef := Identifier _ Colon _ (Identifier | BracketExpr) MultiAccessExpr?;
	DestructureNamedDef(frame,parts)   { return shapeNamedBinding("DestructureNamedDef",parts); },

	// DestructureConciseDef := Colon Identifier SingleAccessExpr?;
	DestructureConciseDef(frame,parts) { return shapeConciseBinding("DestructureConciseDef",parts); },

	// DestructureCapture := Hash Identifier;
	//
	// Binds the WHOLE source value to a fresh name. Hash sigil is
	// structural → delims.
	DestructureCapture(frame,parts) {
		var target;
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) target = p;
			else delims.push(p); // Hash
		}
		return withDelims({ type: "DestructureCapture", target }, delims);
	},

	// DestructureDef := (DestructureNamedDef | DestructureConciseDef) (_ Colon Qmark _ ExprNoBlock)? | DestructureCapture;
	//
	// [SERIES 2] Subsuming shaper — DestructureDef is a visible
	// production (parser.js §4) hosting the per-entry default
	// tail (`:?`), but no DestructureDef node appears in the AST.
	// The shaper returns the inner node directly:
	//
	//   - Capture arm (single DestructureCapture node): returned
	//     unchanged.
	//   - Non-capture arm, no tail (single DestructureNamedDef or
	//     DestructureConciseDef node): returned unchanged.
	//   - Non-capture arm with tail (two nodes: inner +
	//     ExprNoBlock): fold the tail's ExprNoBlock onto inner's
	//     `.default`; append the tail's Colon+Qmark tokens to
	//     inner's `delims` (preserves source-position order for
	//     round-trip — the tail tokens come after inner's own
	//     Colon by position, so the emit walker interleaves them
	//     with the default node in the correct sequence).
	//
	// This mirrors §11's `.init` (bare `:`, strict) vs `.default`
	// (`:?`, lenient) field split — sigil-teaches-semantics
	// extended to the per-entry level of destructure definitions.
	// Downstream consumers see the same three node types they
	// always have (DestructureNamedDef, DestructureConciseDef,
	// DestructureCapture), now optionally carrying `.default`
	// on the two non-capture arms; consumers read
	// `node.default` (may be undefined) rather than a wrapping
	// DestructureDef node.
	//
	// Direct field mutation of the subsumed inner (precedent:
	// AsExpr attaches `.as`) — inner is a fresh node from its
	// own shaper in this parse frame, safe to mutate. Delims
	// concat via `(inner.delims || []).concat(tokens)` rather
	// than push, defensively guarding against a missing delims
	// array (all current inner shapers set delims via
	// withDelims, so the array is always present in practice —
	// but the guard costs nothing).
	DestructureDef(frame,parts) {
		var nodes = [];
		var tokens = [];
		for (let p of parts) {
			if (isNode(p)) nodes.push(p);
			else tokens.push(p); // Colon, Qmark (tail; absent on non-tail arms)
		}
		// Single node — capture arm, or non-capture without tail.
		// Subsume directly.
		if (nodes.length === 1) return nodes[0];
		// Two nodes — inner (Named/Concise) + default (ExprNoBlock).
		var [ inner, defaultExpr ] = nodes;
		inner.default = defaultExpr;
		inner.delims = (inner.delims || []).concat(tokens);
		return inner;
	},

	// DestructureTarget := OpenAngle _ <DestructureDefList> _ CloseAngle;
	//
	// Angle brackets and commas are structural → delims.
	DestructureTarget(frame,parts) {
		var entries = [];
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) entries.push(p);
			else delims.push(p); // OpenAngle, CloseAngle, Comma
		}
		return withDelims({ type: "DestructureTarget", entries }, delims);
	},


	// =============================================================
	// §5 EXPRESSION SCAFFOLDING
	// =============================================================

	// BareIdentifier — thin-wrapper sub-archetype. Subsumes into
	// its inner IdentBase node. No structural tokens at this
	// level (BareIdentifier wraps a single IdentBase node), so
	// the passthrough needs no wrapper-unwrap lift.
	BareIdentifier(frame,parts) {
		return parts.find(isNode);
	},

	// AsAnnotationExpr := ":as" _ NamedType;
	//
	// `:as` keyword drops (anchored in field-name semantics on
	// the parent — `inner.as` presence means user wrote `:as`).
	// No structural delims at this level; under preserveSoftDelims:true
	// the machinery auto-merges any WS between `:as` and the type
	// onto this node's delims, which AsExpr's adaptive unwrap then
	// decides whether to keep or fold (see AsExpr).
	AsAnnotationExpr(frame,parts) {
		return { type: "AsAnnotationExpr", annotation: parts.find(isNode) };
	},

	// AsExpr — Parse-time wrapper only — emits no node of its own.
	// Unwraps to the inner AsableExpr node, attaching the `:as`
	// annotation onto `inner.as`.
	//
	// `inner.as` is shape-polymorphic, by source content:
	//   - bare NamedType when AsAnnotationExpr has no delims
	//     (default mode, or preserveSoftDelims:true with no trivia
	//     between `:as` and the type)
	//   - the full AsAnnotationExpr wrapper node when it has delims
	//     (preserveSoftDelims:true with trivia in the gap)
	//
	// Folding to the bare NamedType in the no-delims case keeps the
	// default-mode AST stable and avoids paying for an extra wrapper
	// on every annotated expression. Retaining the wrapper in the
	// has-delims case preserves the soft trivia for source-fidelity
	// consumers. Consumers can normalize with:
	//   var annotation = as.type === "AsAnnotationExpr" ? as.annotation : as;
	//
	// Same adaptive shape applies to GroupedExpr.as (via
	// shapeGrouped) and DefFuncExpr.as (via the FuncAsClause arm).
	AsExpr(frame,parts) {
		var inner, as;
		for (let p of parts) {
			if (!isNode(p)) continue;
			if (p.type === "AsAnnotationExpr") as = p;
			else inner = p;
		}
		// Adaptive: fold to bare annotation when AsAnnotationExpr
		// has no delims (default mode); keep the wrapper to
		// preserve internal trivia otherwise. Shape-polymorphic
		// — consumers unwrap with: as.type === "AsAnnotationExpr"
		// ? as.annotation : as.
		inner.as = as.delims ? as : as.annotation;
		return inner;
	},

	// Paren-grouping productions. All six delegate to shapeGrouped:
	// drop the AsAnnotationExpr child via unwrap (→ `as`); push
	// parens to delims; lift inner to `expr`.
	GroupedExpr(frame,parts)              { return shapeGrouped(parts); },
	GroupedExprNoBlock(frame,parts)       { return shapeGrouped(parts); },
	GroupedOpExpr(frame,parts)            { return shapeGrouped(parts); },
	GroupedBareOpExpr(frame,parts)        { return shapeGrouped(parts); },
	GroupedBareOpExprNoEmpty(frame,parts) { return shapeGrouped(parts); },
	GroupedDoExpr(frame,parts)            { return shapeGrouped(parts); },


	// =============================================================
	// §6 IDENTIFIER EXPRESSIONS / ACCESS / RANGE
	// =============================================================

// DotIdentifier := Period _ (Identifier | BuiltIn | IntegerLit);
	//
	// Period → delims (structural punctuation; position needed to
	// round-trip WS straddling the dot, e.g. `foo. bar` vs `foo .bar`).
	// Integer text preserved raw on `.index`; renderer recovers its
	// position via single-anchor gap-walk over pieces.
	DotIdentifier(frame,parts) {
		var node = { type: "DotIdentifier" };
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) {
				node.accessor = p;
			}
			else if (
				p.type === "PositiveIntegerLit" ||
				p.type === "NegativeIntegerLit"
			) {
				node.index = p.value;
			}
			else {
				delims.push(p); // Period, plus any soft trivia
			}
		}
		return withDelims(node, delims);
	},

	// BracketExpr := OpenBracket _ ExprNoBlock _ CloseBracket;
	//
	// Brackets are structural → delims.
	BracketExpr(frame,parts) {
		var expr;
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) expr = p;
			else delims.push(p); // OpenBracket, CloseBracket
		}
		return withDelims({ type: "BracketExpr", expr }, delims);
	},

	// DotBracketExpr := Period OpenBracket _ <RangeExpr> _ CloseBracket;
	//
	// Period → delims (same rationale as DotIdentifier). Brackets
	// → delims.
	DotBracketExpr(frame,parts) {
		var range;
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) range = p;
			else delims.push(p); // Period, OpenBracket, CloseBracket
		}
		return withDelims({ type: "DotBracketExpr", range }, delims);
	},

	// DotAngleExpr := Period OpenAngle _ <AnglePickEntry> (_ Comma _ <AnglePickEntry>)* _ CloseAngle;
	//
	// Period → delims. Angles, commas, and EscapePlain (when
	// prefixing integer accessors) → delims. Property entries are
	// synthesized as Pick* nodes carrying source positions —
	// required for the renderer's gap-walk to place them correctly
	// relative to surrounding delims when WS straddles commas or
	// angle brackets. Four arm shapes:
	//
	//   PropertyExpr Identifier arm → standalone Identifier node →
	//     PickAccessor { accessor }.
	//   PropertyExpr PositiveIntLit arm → standalone PositiveIntegerLit
	//     token (optionally preceded by EscapePlain delim) →
	//     PickIndex { index }.
	//   ComputedPropName arm → Percent token + inner node
	//     (PipelineTopic | CallExpr | IdentifierExpr | StringLit) →
	//     PickComputed { expr }. Percent consumed into span — matches
	//     ExplicitPropDef's ComputedPropName synthesis precedent.
	//   SpreadPropName arm → Ampersand token + IdentBase node +
	//     optional MultiAccessExpr → PickSpread { source }. Ampersand
	//     consumed into span; access folds via foldAccess (same
	//     eight-site helper used by PickValue, AssignmentExpr LHS,
	//     etc.). PickSpread.source is the post-fold chain — Identifier
	//     / MemberAccessExpr / IndexAccessExpr / etc. — same shape
	//     PickValue.source carries.
	//
	// Walk is index-driven (not for-of) so multi-token entries
	// (Percent + inner; Ampersand + base + optional access) can
	// consume forward parts atomically.
	DotAngleExpr(frame,parts) {
		var properties = [];
		var delims = [];
		var i = 0;
		while (i < parts.length) {
			let p = parts[i];
			if (isNode(p)) {
				properties.push({
					type: "PickAccessor",
					accessor: p,
					start: p.start,
					end: p.end,
				});
				i++;
			}
			else if (p.type === "PositiveIntegerLit") {
				properties.push({
					type: "PickIndex",
					index: p.value,
					start: p.start,
					end: p.end,
				});
				i++;
			}
			else if (p.type === "Percent") {
				// ComputedPropName arm — narrowed alphabet (§17 grammar).
				// Bare arm: BooleanLit / StringLit / ComputedPropAccessChain
				// fold output (all nodes) plus the numeric-literal alphabet
				// (raw tokens — PositiveIntegerLit alone, bare Number alone,
				// NegativeIntegerLit alone, or Escape + PositiveIntegerLit/
				// Number). Paren-wrap arm: unwrapped OperandExpr node.
				//
				// Walk forward collecting the Percent and all trailing
				// non-node tokens up to the next node (or until the next
				// Percent/Ampersand/Identifier arm opener). Hand the slice
				// to shapeComputedPropName which produces a ComputedPropName
				// node; unwrap its .expr into PickComputed.
				//
				// Percent rides on PickComputed's OWN delims (not parent's)
				// — mirrors SpreadArg's TriplePeriod-on-delims pattern.
				// emitGeneric recurs into PickComputed and the inner
				// piece-walk recovers the sigil at its source position
				// alongside the expr node.
				let percent = p;
				let computedParts = [percent];
				i++;
				// Collect up to and including the first node (BooleanLit,
				// StringLit, AccessChain fold, or paren-wrap unwrap), OR
				// the full raw-integer-token sequence if no node arrives.
				let sawNode = false;
				while (i < parts.length) {
					let q = parts[i];
					if (isNode(q)) {
						computedParts.push(q);
						sawNode = true;
						i++;
						break;
					}
					// Raw token after Percent — numeric-literal alphabet
					// (PositiveIntegerLit / NegativeIntegerLit / Number
					// alone, or Escape + PositiveIntegerLit/Number).
					// Collect.
					computedParts.push(q);
					i++;
				}
				let computed = shapeComputedPropName(computedParts);
				properties.push({
					type: "PickComputed",
					expr: computed.expr,
					start: computed.start,
					end: computed.end,
					delims: [percent],
				});
			}
			else if (p.type === "Ampersand") {
				// SpreadPropName arm: Ampersand + IdentBase + optional
				// MultiAccessExpr. Ampersand rides on PickSpread's OWN
				// delims (same SpreadArg-style pattern as PickComputed).
				// Access folds via foldAccess.
				let amp = p;
				i++;
				let base = parts[i];
				i++;
				let access;
				if (
					i < parts.length &&
					isNode(parts[i]) &&
					parts[i].type === "MultiAccessExpr"
				) {
					access = parts[i];
					i++;
				}
				let source = foldAccess(base, access);
				properties.push({
					type: "PickSpread",
					source,
					start: amp.start,
					end: source.end,
					delims: [amp],
				});
			}
			else {
				delims.push(p); // Period, OpenAngle, CloseAngle, Comma, EscapePlain
				i++;
			}
		}
		return withDelims({ type: "DotAngleExpr", properties }, delims);
	},

	// SingleAccessExpr — list of access segments. Each segment is
	// already type-tagged; no structural tokens at this level.
	SingleAccessExpr(frame,parts) {
		return { type: "SingleAccessExpr", segments: parts.filter(isNode) };
	},

	// MultiAccessExpr — same shape as SingleAccessExpr with a
	// broader segment alphabet. No structural tokens.
	MultiAccessExpr(frame,parts) {
		return { type: "MultiAccessExpr", segments: parts.filter(isNode) };
	},

	// AtExpr — IdentBase + optional access + @. The `@` sigil is
	// structural → delims. Access folds via foldAccess.
	AtExpr(frame,parts) {
		var base, access;
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) {
				if (p.type === "SingleAccessExpr") access = p;
				else base = p;
			}
			else delims.push(p); // At
		}
		return withDelims({ type: "AtExpr", base: foldAccess(base,access) }, delims);
	},

	// IdentityFunc — bare `@`, the value identity function. The
	// At sigil is structural → delims. Type tag is otherwise
	// total information.
	//
	// Renamed from MonadConstructor: bare `@` is semantically the
	// identity function (`@2 ?= 2`), not a monad constructor.
	// That it serves as a unit-constructor prefix for `Id@`,
	// `Just@`, etc. is downstream of what the construct itself
	// is. `\@<digits>` is the actually-monadic number-lit form
	// and gets its own AST type when that lowering lands.
	IdentityFunc(frame,parts) {
		var delims = [];
		for (let p of parts) {
			if (!isNode(p)) delims.push(p); // At
		}
		return withDelims({ type: "IdentityFunc" }, delims);
	},

	// ClosedRangeExpr := RangeOperand _ DoublePeriod _ RangeOperand;
	//
	// DoublePeriod is the range operator, anchored in the type
	// tag — drops as operator-class.
	ClosedRangeExpr(frame,parts) {
		var [ from, to ] = parts.filter(isNode);
		return { type: "ClosedRangeExpr", from, to };
	},

	// LeadingRangeExpr := RangeOperand _ DoublePeriod;
	LeadingRangeExpr(frame,parts) {
		return { type: "LeadingRangeExpr", from: parts.find(isNode) };
	},

	// TrailingRangeExpr := DoublePeriod _ RangeOperand;
	TrailingRangeExpr(frame,parts) {
		return { type: "TrailingRangeExpr", to: parts.find(isNode) };
	},


	// =============================================================
	// §7 FUNCTION CALLS / OP-AS-FUNCTION
	// =============================================================

	// OpFuncExpr := OpenParen (DotAngleExpr | DotBracketExpr | (OpenBracket CloseBracket) | Op) SingleQuote? CloseParen;
	//
	// Surrounding parens are structural → delims. SingleQuote is
	// captured into `primed: true` (drops as state). The empty-
	// bracket form's `[]` tokens become the operator (op:"[]")
	// rather than delims — they ARE the op in that arm. Inner Op
	// tokens accumulate into `op` text. DotAngle/DotBracket inner
	// nodes unwrap to their payloads.
	OpFuncExpr(frame,parts) {
		var node = { type: "OpFuncExpr" };
		var opText = "";
		var sawBrackets = false;
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) {
				if (p.type === "DotAngleExpr") {
					node.properties = p.properties;
				}
				else if (p.type === "DotBracketExpr") {
					node.range = p.range;
				}
			}
			else if (p.type === "SingleQuote") {
				node.primed = true;
			}
			else if (p.type === "OpenParen" || p.type === "CloseParen") {
				delims.push(p);
			}
			else if (p.type === "OpenBracket" || p.type === "CloseBracket") {
				// `[]` empty-bracket arm — these ARE the op,
				// not structural delims
				sawBrackets = true;
			}
			else {
				// bare op token — accumulate text
				opText += p.value;
			}
		}
		if (sawBrackets) {
			node.op = "[]";
		}
		else if (opText) {
			node.op = opText;
		}
		return withDelims(node, delims);
	},

	// PrefixCallSuffix := OpenParen CallArgs CloseParen;
	//
	// Parens and commas are structural → delims. SingleQuote in
	// the bare-op shortcut path is captured into the synthesized
	// OpFuncExpr (drops as state for primed). Op tokens accumulate
	// into the synthetic OpFuncExpr.
	//
	// preserveInnerDelim:true on the production — soft delims
	// (Whitespace / LineComment / BlockComment) flow into `parts`
	// so the spread accumulator can capture trivia between a
	// TriplePeriod and its arg into the synthesized SpreadArg's
	// own delims. Outside spread context, soft delims push to
	// this node's delims directly — same destination as the
	// auto-merge claim path would have produced.
	//
	// Skip-position slots surface as synthetic ImpliedEmpty nodes
	// in `args`. JS-array-literal semantics on the CallArgList
	// grammar: each Comma defines a slot boundary; the Comma
	// immediately before the closing Paren is tolerated as
	// trailing and creates no extra slot.
	//
	//   foo(1,,2) → args [<1>, ImpliedEmpty, <2>]
	//   foo(,,3)  → args [ImpliedEmpty, ImpliedEmpty, <3>]
	//   foo(1,2,) → args [<1>, <2>]                       (trailing comma)
	//   foo(1,,)  → args [<1>, ImpliedEmpty]              (skip + trailing)
	//   foo()     → args []
	//
	// ImpliedEmpty carries the "implied empty VALUE at this
	// position" semantic — the call receives `empty` here, as if
	// the user wrote `empty` explicitly. Distinct from
	// PartialCallSuffix's `null` (no-value slot filled by rest-
	// call) — these are semantically different.
	//
	// `start: lastStruct.end + 1` — the source position immediately
	// after the previous structural token (OpenParen for leading
	// skips, prior Comma for inner skips). Matches the synthesized-
	// empty-ParameterList precedent. `end: null` signals "no source
	// span / synthetic" — round-trip's collectPieces filters
	// ImpliedEmpty nodes by type before sort; the start value gives
	// clean ordering for any other consumer that doesn't filter
	// (transpiler, future interpreter, error reporting).
	//
	// `awaitingArg` state matches PartialCallSuffix; the OpenParen
	// (first paren only — inner parens from NamedArgExpr's paren-
	// recursive arm shouldn't re-arm the state) sets it true.
	// Soft delims don't affect awaitingArg — they're transparent
	// to the slot-machine. Bare-op shortcut path is unaffected —
	// bare-op forms have no Commas or soft delims inside (grammar
	// `Op SingleQuote? &(CloseParen)` has no `_` calls).
	//
	// Spread sigil (TriplePeriod) prefixing an arg synthesizes a
	// SpreadArg wrapper around the arg node:
	//
	//   { type: "SpreadArg", inner: <argNode>,
	//     start: TriplePeriod.start, end: argNode.end,
	//     delims: [TriplePeriod, ...softDelimsBetween] }
	//
	//   foo(...x)        → args [SpreadArg<x>]
	//   foo(1,...x,2)    → args [<1>, SpreadArg<x>, <2>]
	//   foo(1,,...x,,2)  → args [<1>, ImpliedEmpty, SpreadArg<x>, ImpliedEmpty, <2>]
	//   foo(... args)    → SpreadArg.delims captures TriplePeriod + the WS
	//
	// TriplePeriod's source position rides on SpreadArg.delims so
	// round-trip's emitGeneric piece walk recovers it (it sorts
	// before inner by start). Consumers reading args[] see the
	// SpreadArg type directly. `spreadBuf` accumulates TriplePeriod
	// plus any soft delims between it and the arg node; the next
	// arg node consumes the buffer and wraps. Grammar guarantees a
	// TriplePeriod is always followed by an arg expression before
	// the next structural Comma / CloseParen, so the buffer never
	// dangles at loop end.
	PrefixCallSuffix(frame,parts) {
		var args = [];
		var op = "";
		var opStart, opEnd;
		var primed = false;
		var delims = [];
		var awaitingArg = false;
		var openParenSeen = false;
		var lastStructEnd = null;
		var spreadBuf = null;
		for (let p of parts) {
			if (isNode(p)) {
				if (spreadBuf) {
					let triplePeriod = spreadBuf[0];
					args.push({
						type: "SpreadArg",
						inner: p,
						start: triplePeriod.start,
						end: p.end,
						delims: spreadBuf,
					});
					spreadBuf = null;
				}
				else {
					args.push(p);
				}
				awaitingArg = false;
			}
			else if (p.type === "SingleQuote") {
				primed = true;
				opEnd = p.end;
			}
			else if (p.type === "OpenParen") {
				delims.push(p);
				if (!openParenSeen) {
					awaitingArg = true;
					openParenSeen = true;
					lastStructEnd = p.end;
				}
			}
			else if (p.type === "CloseParen") {
				delims.push(p);
			}
			else if (p.type === "Comma") {
				delims.push(p);
				if (awaitingArg) {
					args.push({
						type: "ImpliedEmpty",
						start: lastStructEnd + 1,
						end: null,
					});
				}
				awaitingArg = true;
				lastStructEnd = p.end;
			}
			else if (p.type === "TriplePeriod") {
				spreadBuf = [p];
			}
			else if (
				p.type === "Whitespace" ||
				p.type === "LineComment" ||
				p.type === "BlockComment"
			) {
				// soft delim — into SpreadArg buffer if pending,
				// else into this node's delims (same destination
				// the auto-merge claim would have produced under
				// !preserveInnerDelim)
				if (spreadBuf) spreadBuf.push(p);
				else delims.push(p);
			}
			else {
				// Op-form: accumulate operator token text and span
				if (op === "") opStart = p.start;
				if (!primed) opEnd = p.end;
				op += p.value;
			}
		}
		// Synthesize an OpFuncExpr arg for the bare-op shortcut.
		if (op) {
			let opNode = {
				type: "OpFuncExpr",
				op,
				start: opStart,
				end: opEnd,
			};
			if (primed) opNode.primed = true;
			args.push(opNode);
		}
		return withDelims({ type: "PrefixCallSuffix", args }, delims);
	},

	// PartialCallSuffix := Pipe CallArgs Pipe;
	//
	// Pipes and commas are structural → delims.
	//
	// preserveInnerDelim:true on the production — soft delims
	// (Whitespace / LineComment / BlockComment) flow into `parts`
	// so the spread accumulator can capture trivia between a
	// TriplePeriod and its arg into the synthesized SpreadArg's
	// own delims. Outside spread context, soft delims push to
	// this node's delims directly — same destination as the
	// auto-merge claim path would have produced.
	//
	// Skip-position slots surface as `null` entries in `args`,
	// matching JS-array-literal semantics for the underlying
	// CallArgList grammar (`(_ Comma)* (CallArgExpr (_ Comma (_
	// CallArgExpr)?)*)?`). Every Comma defines a slot boundary;
	// the Comma immediately before the closing Pipe is tolerated
	// as trailing and creates no extra slot.
	//
	//   f|1,,2| → args [<1>, null, <2>]
	//   f|,,3|  → args [null, null, <3>]
	//   f|1,2,| → args [<1>, <2>]            (trailing comma)
	//   f|1,,|  → args [<1>, null]           (skip slot + trailing)
	//   f||     → args []
	//
	// State: `awaitingArg` becomes true after the opening Pipe
	// or any Comma; false after consuming an arg node. A Comma
	// while `awaitingArg` is true pushes a null slot. The closing
	// Pipe doesn't fire any push, so a trailing comma decays into
	// `awaitingArg=true` at loop exit and gets ignored —
	// trailing-comma tolerance falls out of this rule for free.
	// Soft delims don't affect awaitingArg.
	//
	// Spread sigil (TriplePeriod) prefixing an arg synthesizes a
	// SpreadArg wrapper — same shape as in PrefixCallSuffix:
	//
	//   { type: "SpreadArg", inner: <argNode>,
	//     start: TriplePeriod.start, end: argNode.end,
	//     delims: [TriplePeriod, ...softDelimsBetween] }
	//
	//   f|...x|       → args [SpreadArg<x>]
	//   f|1,...x,2|   → args [<1>, SpreadArg<x>, <2>]
	//   f|1,,...x,2|  → args [<1>, null, SpreadArg<x>, <2>]
	//
	// `spreadBuf` accumulates TriplePeriod plus any soft delims
	// between it and the arg node; the next arg node consumes the
	// buffer. Grammar guarantees a TriplePeriod is always followed
	// by an arg expression before the next structural token, so
	// the buffer never dangles at loop end.
	PartialCallSuffix(frame,parts) {
		var args = [];
		var delims = [];
		var awaitingArg = false;
		var pipeCount = 0;
		var spreadBuf = null;
		for (let p of parts) {
			if (isNode(p)) {
				if (spreadBuf) {
					let triplePeriod = spreadBuf[0];
					args.push({
						type: "SpreadArg",
						inner: p,
						start: triplePeriod.start,
						end: p.end,
						delims: spreadBuf,
					});
					spreadBuf = null;
				}
				else {
					args.push(p);
				}
				awaitingArg = false;
			}
			else if (p.type === "Pipe") {
				delims.push(p);
				pipeCount++;
				if (pipeCount === 1) awaitingArg = true;
			}
			else if (p.type === "Comma") {
				delims.push(p);
				if (awaitingArg) args.push(null);
				awaitingArg = true;
			}
			else if (p.type === "TriplePeriod") {
				spreadBuf = [p];
			}
			else if (
				p.type === "Whitespace" ||
				p.type === "LineComment" ||
				p.type === "BlockComment"
			) {
				// soft delim — into SpreadArg buffer if pending,
				// else into this node's delims
				if (spreadBuf) spreadBuf.push(p);
				else delims.push(p);
			}
			else {
				delims.push(p);
			}
		}
		return withDelims({ type: "PartialCallSuffix", args }, delims);
	},

	// AtCallExpr / IdentityCallExpr — `@`-form applied to
	// (optionally) an argument. Two-arm production, two output
	// shapes:
	//
	// IdentBase-led (`Foo@`, `Foo@x`, `Foo @ x`, `Foo.bar@`,
	// `Foo.bar@x`, `Foo.bar @ x`, `None@`, `Maybe@42`): produces
	// AtCallExpr { base, arg? } where `base` is the foldAccess
	// result of the IdentBase plus optional SingleAccessExpr.
	// Matches the foldAccess-at-shape-time pattern used at the
	// other access-fold sites (AssignmentExpr.target,
	// ExportNamedBinding.source, etc.) — consumers see a uniform
	// chain in `base` regardless of whether access was present.
	//
	// IdentityFunc-led (`@x`, `@ x`): produces
	// IdentityCallExpr { arg }. The IdentityFunc node is phantom
	// — its sole At delim lifts onto the outer
	// IdentityCallExpr.delims; the inner node is discarded.
	// `@2` is one indivisible construct, not a call of `@` on
	// `2`.
	//
	// At sigil placement:
	//   - IdentityCallExpr: outer.delims = [At] (lifted from
	//     inner IdentityFunc.delims[0]).
	//   - AtCallExpr: outer.delims = [At] uniformly. Soft delims
	//     around the At auto-merge under preserveSoftDelims —
	//     `foo @ x` recovers via auto-merged WS interleaved with
	//     base / At / arg positions.
	//
	// AtExpr type retired — no longer synthesized as a callee
	// wrapper. The OLD shape `{ callee: AtExpr{base}, arg? }`
	// flattened to `{ base, arg? }`, dropping the layer. Dead
	// branches removed: the bare-BuiltIn-token arm (Arm 1 from
	// the prior parser, before IdentBase wrapped Builtin into a
	// node) and the AtExpr-pre-shaped arm (Sub-form A from the
	// prior parser, before AtExpr was retired as a production).
	AtCallExpr(frame,parts) {
		var first = parts[0];
		var delims = [];

		if (first.type === "IdentityFunc") {
			// Bare-`@` applied → IdentityCallExpr. The IdentityFunc
			// node's single At delim lifts onto the outer node;
			// the inner node is discarded — no base field. Soft
			// delims between `@` and the arg auto-merge onto
			// IdentityCallExpr.delims by the machinery after
			// return (preserveInnerDelim not set on AtCallExpr).
			delims.push(first.delims[0]);
			let arg;
			for (let p of parts.slice(1)) {
				if (isNode(p)) arg = p;
			}
			return withDelims({ type: "IdentityCallExpr", arg }, delims);
		}

		// IdentBase-led. Walk parts: IdentBase node first, then
		// optional SingleAccessExpr node, the At token, and
		// optional ExprNoBlock arg node. Fold access into base
		// via foldAccess; capture At into delims; lift arg if
		// present.
		var base = first;
		var access, arg;
		for (let p of parts.slice(1)) {
			if (isNode(p)) {
				if (p.type === "SingleAccessExpr") access = p;
				else arg = p;
			}
			else if (p.type === "At") {
				delims.push(p);
			}
		}
		var node = { type: "AtCallExpr", base: foldAccess(base, access) };
		if (arg) node.arg = arg;
		return withDelims(node, delims);
	},

	// EffectorTail := _ Percent (_ ExprNoBlock)?;
	//
	// Transient inner production — collapses to EffectorCallExpr
	// in ChainExpr's part loop (see below). Parts are:
	//   [maybe WS tokens, Percent token, maybe WS tokens,
	//    maybe ExprNoBlock node]
	// All non-node tokens (Percent + soft delims) into delims;
	// the optional ExprNoBlock node, if present, into `arg`.
	// emitGeneric piece-walks Percent + soft delims at their
	// source positions, recovering "task %" / "task % env" /
	// "task%env" / "task%(env)" alike.
	EffectorTail(frame,parts) {
		var arg = null;
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) arg = p;
			else delims.push(p); // Percent + WS / comments
		}
		var node = { type: "EffectorTail" };
		if (arg) node.arg = arg;
		return withDelims(node, delims);
	},

	// AtRefTail := Period At;
	//
	// Transient inner production — collapses to AtRefExpr in
	// ChainExpr's part loop (see below). Parts are exactly two
	// raw tokens: Period and At. The grammar admits no soft
	// delims (strict no-trivia between them, no leading trivia
	// before Period). Both structural tokens flow into `delims`
	// for the ChainExpr fold to propagate, paralleling
	// EffectorTail's handling. emitGeneric walks Period + At at
	// their source positions when round-tripping AtRefExpr,
	// reconstructing `<source>.@`.
	AtRefTail(frame,parts) {
		var delims = [];
		for (let p of parts) {
			delims.push(p); // Period, At
		}
		return withDelims({ type: "AtRefTail" }, delims);
	},

	// ChainExpr — base + ordered segments folded into JS-style
	// nested typed nodes. ChainExpr itself emits no node — it's a
	// parse vehicle only. SingleQuote captured into PrimedExpr
	// synthesis.
	//
	// preserveInnerDelim:true on the production — chain-level soft
	// delims (WS / comments between ChainBase and ChainSeg,
	// between segs, between SingleQuote and post-prime CallSuffix)
	// flow into `parts` so the shaper can distribute them.
	// `pending` accumulates soft delim tokens; when the next
	// folded node arrives, pending merges onto its delims BEFORE
	// the seg's own structural delims (all positionally precede
	// seg.delims, so simple concat is source-ordered).
	//
	// Per grammar, no `_` precedes SingleQuote (postfix prime is
	// adjacent to its preceding expression) — `pending` should be
	// empty at SingleQuote. Defensive attach to PrimedExpr in case.
	ChainExpr(frame,parts) {
		var node;
		var pending = [];
		for (let p of parts) {
			if (isNode(p)) {
				if (node === undefined) {
					node = p; // ChainBase
				}
				else if (p.type === "EffectorTail") {
					// Effector chain-tail — fold the source-so-far into
					// EffectorCallExpr. EffectorTail's own delims (Percent
					// + leading / between-arg soft delims, all with source
					// positions) propagate onto the new node. arg lifts
					// onto the EffectorCallExpr if present; bare form
					// leaves it undefined.
					//
					// Chain-level `pending` (soft delims between ChainBase
					// and EffectorTail, or between last ChainSeg and
					// EffectorTail) should be empty here — EffectorTail's
					// own leading `_` captures that trivia. Defensive
					// merge anyway, before the EffectorTail's own delims
					// (positionally precedes them).
					var newNode = {
						type: "EffectorCallExpr",
						source: node,
						start: node.start,
						end: p.end,
					};
					if (p.arg) newNode.arg = p.arg;
					var combinedDelims = [];
					if (pending.length > 0) {
						combinedDelims.push(...pending);
						pending = [];
					}
					if (p.delims) combinedDelims.push(...p.delims);
					if (combinedDelims.length > 0) newNode.delims = combinedDelims;
					node = newNode;
				}
				else if (p.type === "AtRefTail") {
					// AtRefTail chain-terminator — fold source-so-far
					// into AtRefExpr. AtRefTail's own delims ([Period,
					// At]) propagate onto the new node. No arg slot —
					// `.@` is terminator-only with no payload syntax.
					//
					// Chain-level `pending` should be empty per the
					// grammar's no-leading-`_` rule on AtRefTail (strict
					// adjacency between the preceding chain content
					// and `.@`). Defensive merge anyway, before the
					// AtRefTail's own delims (positionally precedes
					// them).
					var newNode = {
						type: "AtRefExpr",
						source: node,
						start: node.start,
						end: p.end,
					};
					var combinedDelims = [];
					if (pending.length > 0) {
						combinedDelims.push(...pending);
						pending = [];
					}
					if (p.delims) combinedDelims.push(...p.delims);
					if (combinedDelims.length > 0) newNode.delims = combinedDelims;
					node = newNode;
				}
				else {
					// ChainSeg / CallSuffix — both fold via applyChainSeg.
					node = applyChainSeg(node, p);
					if (pending.length > 0) {
						node.delims = node.delims
							? [ ...pending, ...node.delims ]
							: pending;
						pending = [];
					}
				}
			}
			else if (
				p.type === "SingleQuote" ||
				p.type === "Mountain" ||
				p.type === "Valley"
			) {
				// Three postfix modifiers, all PrimedExpr-shaped (single
				// `inner` field, span extended to the modifier token's
				// end). Wrapper type discriminates curry / uncurry /
				// prime semantics downstream. emitGeneric reconstructs
				// the modifier glyph via gapFill (modifier tokens are
				// NOT in delims — same pattern as PrimedExpr).
				var wrapperType = (
					p.type === "SingleQuote" ? "PrimedExpr"   :
					p.type === "Mountain"    ? "CurriedExpr"  :
					                           "UncurriedExpr"
				);
				node = {
					type: wrapperType,
					inner: node,
					start: node.start,
					end: p.end,
				};
				if (pending.length > 0) {
					node.delims = pending;
					pending = [];
				}
			}
			else {
				// soft delim (Whitespace / LineComment / BlockComment)
				pending.push(p);
			}
		}
		// Defensive: trailing pending shouldn't occur per grammar.
		if (pending.length > 0) {
			node.delims = node.delims
				? [ ...node.delims, ...pending ]
				: pending;
		}
		return node;
	},


	// =============================================================
	// §8 UNARY
	// =============================================================
	//
	// Both productions go through shapeUnaryTier — no structural
	// delims (all non-node tokens consumed into `op`).
	NamedUnaryExpr(frame,parts)    { return shapeUnaryTier("NamedUnaryExpr",parts); },
	SymbolicUnaryExpr(frame,parts) { return shapeUnaryTier("SymbolicUnaryExpr",parts); },


	// =============================================================
	// §9 BINARY TIERS
	// =============================================================
	//
	// Six iter tiers delegate to shapeBinTier — no structural
	// delims. TypeCompareBinExpr is non-iter (single op, NamedType
	// RHS) — same op-consumption pattern, also no delims.
	FlowBinExpr(frame,parts)    { return shapeBinTier("FlowBinExpr",parts); },
	OrBinExpr(frame,parts)      { return shapeBinTier("OrBinExpr",parts); },
	AndBinExpr(frame,parts)     { return shapeBinTier("AndBinExpr",parts); },

	TypeCompareBinExpr(frame,parts) {
		var nodes = [];
		var op = "";
		for (let p of parts) {
			if (isNode(p)) nodes.push(p);
			else op += p.value;
		}
		return {
			type: "TypeCompareBinExpr",
			left: nodes[0],
			op,
			right: nodes[1],
		};
	},

	CompareBinExpr(frame,parts) { return shapeBinTier("CompareBinExpr",parts); },
	AddBinExpr(frame,parts)     { return shapeBinTier("AddBinExpr",parts); },
	MulBinExpr(frame,parts)     { return shapeBinTier("MulBinExpr",parts); },


	// =============================================================
	// §11 BLOCK EXPRESSIONS
	// =============================================================
	//
	// Four visible productions form the block family, with
	// intentionally different reach (see parser.js §11 and the
	// "Block Expressions" section of Syntactic-Grammar.md):
	//
	//   BareBlockExpr    := OpenBrace _ BlockStmts _ CloseBrace;
	//                       (no defs-init at all)
	//   BlockExpr        := BlockDefsInitOptImplIn _ BareBlockExpr;
	//                       (defs-init REQUIRED; lenient inner;
	//                        implicit-input positions only)
	//   BlockExprStrict  := BlockDefsInitOpt _ BareBlockExpr;
	//                       (defs-init REQUIRED; strict-optional inner;
	//                        host-attached: GuardedExpr body and
	//                        MatchConsequent only — not a general Expr)
	//   DefBlockStmt     := "def" _ BlockDefsInitOpt _ BareBlockExpr;
	//                       (strict-optional inner; stmt position, no
	//                        implicit input source)
	//
	// AST shape — `body` is the nested BareBlockExpr node:
	//
	//   BareBlockExpr { type, stmts, delims? }
	//   BlockExpr     { type, defs, body }     // body = BareBlockExpr
	//   DefBlockStmt  { type, defs, body }     // body = BareBlockExpr
	//
	// BlockExpr's statements are NOT flattened onto the parent —
	// they live at body.stmts. Same for DefBlockStmt. Round-trip
	// and transpile walkers recurse `node.body` to reach the
	// statement list (and pick up the body's own delims for the
	// braces and inter-stmt semicolons). This is a deliberate
	// shape change from the previous flat-stmts layout — the
	// nested form mirrors the new grammar where BareBlockExpr is
	// itself a visible production owning the brace-delimited body.
	//
	// BlockExpr and DefBlockStmt carry only the trivia between
	// their direct children (def-keyword / defs-init / body) in
	// their own delims (via preserveInnerDelim:true on the
	// production). All internal-to-body trivia — braces,
	// inter-stmt semicolons, soft delims between stmts — is owned
	// by BareBlockExpr's delims.
	//
	// `:as` reachability:
	//   - BareBlockExpr reaches `:as` only via AsExpr-wrap (it's
	//     the first arm of <AsableExpr> in §5).
	//   - BlockExpr has NO annotation path — it's not in
	//     <AsableExpr> and its reachable contexts (FlowRHSImplIn,
	//     FuncBodyPipeline body) aren't outer-expression slots.
	//     To annotate within a ComprOp / PipelineOp /
	//     FuncBodyPipeline block, annotate the inner expression.
	//   - DefBlockStmt is a statement, not an expression — no
	//     `:as` path.
	//
	// VarDefInitOpt vs VarDefInitOptImplIn mirrors the strict /
	// lenient fork at the entry level, carrying both a
	// grammatical distinction (init-requiredness) AND a
	// sigil-semantic distinction (init form):
	//   - VarDefInitOpt (strict): bare `:` init sigil,
	//     unconditional binding. Identifier-init optional,
	//     DestructureTarget-init REQUIRED. Used at DefBlockStmt's
	//     BlockDefsInitOpt — no implicit source.
	//   - VarDefInitOptImplIn (lenient): `:?` init sigil,
	//     override-on-empty binding. Both Identifier-init and
	//     DestructureTarget-init optional. Used at implicit-input
	//     sites — ParameterList (§13, positional arg is source)
	//     and BlockDefsInitOptImplIn (here, via FlowRHSImplIn /
	//     FuncBodyPipeline body).
	//
	// The two shapers emit the same type tag "VarDefInitOpt" but
	// distinct field names — `.init` on the strict arm,
	// `.default` on the lenient arm. Downstream consumers read
	// `node.init || node.default` to source the expression
	// regardless of arm. The distinct field names preserve the
	// sigil-semantic split (unconditional bind vs override-on-
	// empty) in the AST, keeping the type tag uniform for
	// downstream walker simplicity.
	//
	// The BlockDefsInitOpt / BlockDefsInitOptImplIn wrapper pair
	// remains aliased at the bottom of this file — the wrapper
	// shaper doesn't inspect entry sigils. Downstream consumers
	// still bind no-init entries from the enclosing implicit
	// source based on parent context, not on a per-entry tag
	// check. The strict-vs-lenient distinction at the wrapper
	// level lives entirely at the parser layer.
	//
	// Both produce structurally identical AST nodes — the lenient
	// productions alias to the strict shapers at the bottom of
	// this file, so the type tag is uniform across both arms.
	// The strict-vs-lenient distinction lives entirely at the
	// parser layer: the strict form rejects DestructureTarget-no-
	// init, the lenient form accepts it. Downstream consumers
	// bind no-init entries from the enclosing implicit source
	// based on parent context, not on a per-entry tag check.

	// VarDefInitOpt := (Identifier        (_ Colon _ ExprNoBlock)?)
	//                | (DestructureTarget  _ Colon _ ExprNoBlock);
	//
	// Strict form, bare `:` init sigil (unconditional bind).
	// Colon (when init present) is structural → delims. Same
	// shaper body handles both arms — count of nodes determines
	// whether init is present.
	//
	// AST field: `.init` (present iff init expression given).
	VarDefInitOpt(frame,parts) {
		var nodes = [];
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) nodes.push(p);
			else delims.push(p); // Colon (when init present)
		}
		var [ target, init ] = nodes;
		var node = { type: "VarDefInitOpt", target };
		if (init) node.init = init;
		return withDelims(node, delims);
	},

	// VarDefInitOptImplIn := (Identifier        (_ Colon Qmark _ ExprNoBlock)?)
	//                      | (DestructureTarget (_ Colon Qmark _ ExprNoBlock)?);
	//
	// Lenient form, `:?` init sigil (override-on-empty). When
	// init is present, Colon AND Qmark are both structural →
	// delims (two-token composite mirroring AssignmentExpr's
	// `:=`). Same shaper body handles both arms — count of
	// nodes determines whether init is present.
	//
	// AST shape: same type tag "VarDefInitOpt" as the strict
	// shaper, but the init expression (when present) binds to
	// `.default` instead of `.init`. Downstream consumers read
	// `node.init || node.default` to source the expression
	// regardless of arm.
	VarDefInitOptImplIn(frame,parts) {
		var nodes = [];
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) nodes.push(p);
			else delims.push(p); // Colon + Qmark (when init present)
		}
		var [ target, defaultExpr ] = nodes;
		var node = { type: "VarDefInitOpt", target };
		if (defaultExpr) node.default = defaultExpr;
		return withDelims(node, delims);
	},

	// BlockDefsInitOpt := OpenParen _ <VarDefInitOptList> _ CloseParen;
	//
	// Strict family — entries are VarDefInitOpt. Parens and
	// commas are structural → delims.
	BlockDefsInitOpt(frame,parts) {
		var entries = [];
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) entries.push(p);
			else delims.push(p); // OpenParen, CloseParen, Comma
		}
		return withDelims({ type: "BlockDefsInitOpt", entries }, delims);
	},

	// BareBlockExpr := OpenBrace _ <BlockStmts> _ CloseBrace.
	//
	// Visible production. Owns ALL the structural tokens of the
	// brace-delimited body — OpenBrace, lifted inter-stmt
	// Semicolons (via the StmtSemi α-claim lift channel), and
	// CloseBrace. Parents (BlockExpr / DefBlockStmt) do not
	// duplicate these in their own delims.
	//
	// preserveInnerDelim:true on the production means soft delims
	// (WS, comments) between stmts auto-merge into this node's
	// delims by source position alongside the hard structural
	// tokens. collectStmtList handles the partition of lifted
	// stmt nodes from structural tokens.
	BareBlockExpr(frame,parts) {
		var { stmts, delims } = collectStmtList(parts);
		return withDelims({ type: "BareBlockExpr", stmts }, delims);
	},

	// BlockExpr := BlockDefsInitOptImplIn _ BareBlockExpr.
	//
	// Defs-init is REQUIRED (not optional) — BlockExpr now
	// exclusively names the defs-init form. The bare-body case at
	// every implicit-input slot goes through BareBlockExpr
	// directly.
	//
	// AST shape: { defs, body }. body is the BareBlockExpr node.
	// Statements live at body.stmts (not flattened onto the
	// parent); brace and inter-stmt-semi delims live at
	// body.delims.
	//
	// preserveInnerDelim:true on the production means any trivia
	// (WS, comments) between the BlockDefsInitOptImplIn child and
	// the BareBlockExpr child auto-merges into this parent's
	// delims. The defs-init child's own internal trivia (parens,
	// commas) and the body's own internal trivia stay on their
	// respective children.
	//
	// Per the grammar there are exactly two node arms in this
	// production's parts — the defs-init and the body — so the
	// non-body node is by definition the defs. No type-tag check
	// on the defs side; if a future refactor swaps in a different
	// defs-init production name, this shaper still works.
	BlockExpr(frame,parts) {
		var defs, body;
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) {
				if (p.type === "BareBlockExpr") body = p;
				else                            defs = p;
			}
			else delims.push(p); // soft delims (WS / Comment) between defs and body
		}
		return withDelims({ type: "BlockExpr", defs, body }, delims);
	},

	// DefBlockStmt := "def" _ BlockDefsInitOpt _ BareBlockExpr.
	//
	// "def" keyword drops (anchored in type tag — the leading
	// keyword distinguishes this from BlockExpr at the syntax
	// layer).
	//
	// AST shape: { defs, body } — same shape as BlockExpr.
	// Statements live at body.stmts; braces and inter-stmt semis
	// live at body.delims.
	//
	// Uses BlockDefsInitOpt (strict-optional) — there is no
	// implicit input source at a top-level `def (...)` position,
	// so DestructureTarget entries in the defs-init require their
	// own init expression. Enforced at the parser level via the
	// strict VarDefInitOpt form.
	//
	// Same defensive defs assignment as BlockExpr — the non-body
	// node is by definition the defs, no type-tag check needed.
	DefBlockStmt(frame,parts) {
		var defs, body;
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) {
				if (p.type === "BareBlockExpr") body = p;
				else                            defs = p;
			}
			else if (p.type === "Keyword") continue; // "def"
			else delims.push(p); // soft delims (WS / Comment)
		}
		return withDelims({ type: "DefBlockStmt", defs, body }, delims);
	},

	// =============================================================
	// §12 ASSIGNMENT
	// =============================================================

	// AssignmentExpr := ((IdentBase SingleAccessExpr) | Identifier) _ Colon Equal _ Expr;
	//
	// The two tokens of `:=` (Colon + Equal) are structural →
	// delims as two separate tokens.
	AssignmentExpr(frame,parts) {
		var nodes = [];
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) nodes.push(p);
			else delims.push(p); // Colon, Equal
		}
		var base, access, source;
		if (nodes.length === 2) {
			[ base, source ] = nodes;
		}
		else {
			[ base, access, source ] = nodes;
		}
		return withDelims({
			type: "AssignmentExpr",
			target: foldAccess(base,access),
			source,
		}, delims);
	},


	// =============================================================
	// §13 FUNCTION DEFINITIONS
	// =============================================================

	// ParameterList := VarDefInitOptImplIn (_ Comma _ VarDefInitOptImplIn)*;
	//
	// Lenient entries — the positional argument at each param
	// position is the implicit source for destructure-no-init.
	// Comma is structural → delims.
	ParameterList(frame,parts) {
		var params = [];
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) params.push(p);
			else delims.push(p); // Comma
		}
		return withDelims({ type: "ParameterList", params }, delims);
	},

	// GatherParameter := Star Identifier;
	//
	// Star sigil is structural → delims. Identifier flattens to
	// bare `name` string per the polymorphic-vs-monomorphic
	// convention.
	GatherParameter(frame,parts) {
		var inner;
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) inner = p;
			else delims.push(p); // Star
		}
		return withDelims({ type: "GatherParameter", name: inner.name }, delims);
	},

	// FuncPrecond := CondClause _ Colon _ ExprNoBlock;
	//
	// Colon is structural → delims.
	FuncPrecond(frame,parts) {
		var clause, consequent;
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) {
				if (p.type === "CondClause") clause = p;
				else consequent = p;
			}
			else delims.push(p); // Colon
		}
		return withDelims({ type: "FuncPrecond", clause, consequent }, delims);
	},

	// FuncOverClause := ":over" _ OpenParen _ Identifier (_ Comma _ Identifier)* _ CloseParen;
	//
	// ":over" keyword drops; parens and commas → delims.
	FuncOverClause(frame,parts) {
		var names = [];
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) names.push(p);
			else if (p.type === "Keyword") continue; // ":over"
			else delims.push(p); // OpenParen, CloseParen, Comma
		}
		return withDelims({ type: "FuncOverClause", names }, delims);
	},

	// FuncAsClause := ":as" _ Identifier;
	//
	// ":as" keyword drops (anchored in field-name semantics on the
	// parent — DefFuncExpr.as presence means user wrote `:as`).
	// No structural delims at this level; under preserveSoftDelims:true
	// the machinery auto-merges any WS between `:as` and the
	// Identifier onto this node's delims, which DefFuncExpr's
	// adaptive unwrap then decides whether to keep or fold (see
	// DefFuncExpr).
	FuncAsClause(frame,parts) {
		return { type: "FuncAsClause", annotation: parts.find(isNode) };
	},

	// ReturnExpr := Caret _ Expr;
	//
	// Caret drops (anchored in type tag — unary `^expr` return
	// form per Rule 1).
	ReturnExpr(frame,parts) {
		return { type: "ReturnExpr", expr: parts.find(isNode) };
	},

	// FuncBodyExpr := Caret _ (ExprNoBlock | GroupedExpr);
	//
	// Caret drops (anchored in type tag).
	FuncBodyExpr(frame,parts) {
		return { type: "FuncBodyExpr", body: parts.find(isNode) };
	},

	// FuncBodyPipeline := PipelineOp _ FlowRHSImplIn (_ FlowOpAndRHS)*;
	//
	// Sugar for `^ <param> #> ...` — see grammar §13 prose and parser.js.
	// Per the "conceptually rewrite to ^ x #> ..." principle, the body
	// subtree should be AST-shape-identical to what the chain would
	// produce at standalone expression position. So:
	//
	//   - 0 chain stages → body = the stage-1 RHS node directly.
	//     `defn foo(x) #> A` → body: A. (Unchanged from prior shape.)
	//   - ≥1 chain stages → body = a left-folded FlowBinExpr identical
	//     to what `A #> B #> C` (or `A #> B ~map C` etc.) shapes to at
	//     standalone-expression position. Stage 1's RHS becomes the
	//     deepest-left leaf; each subsequent FlowOpAndRHS folds in as
	//     a new outer FlowBinExpr wrapping the prior accumulator.
	//     `defn foo(x) #> A #> B` → body:
	//       FlowBinExpr{ left: A, op: "#>", right: B,
	//                    start: A.start, end: B.end, delims: [...] }.
	//
	// Parts walk under preserveInnerDelim:true — interleaved op tokens,
	// soft delims, and nodes. Routing:
	//
	//   - Op tokens (Hash/CloseAngle for `#>`; Tilde/OpenAngle/CloseAngle/
	//     Plus or a single Comprehension token for other FlowOps) before
	//     stage-1 body
	//   - Op tokens after stage-1 body → accumulate into `pendingOp`;
	//     consumed when the next node arrives (folds into a new outer
	//     FlowBinExpr).
	//   - Soft delims (Whitespace / Comment) before stage-1 body →
	//     FuncBodyPipeline's own delims. These cover trivia between the
	//     leading `#>` and stage-1 RHS; the round-trip handler
	//     (gapFill(n.op, ...)) emits `op` in the gap before them.
	//   - Soft delims after stage-1 body → outermost synthesized
	//     FlowBinExpr's delims. emitBinTier (round-trip) flattens the
	//     left-folded tree and walks delims+operands by position,
	//     emitting ops in the gaps. Matching the placement a real
	//     FlowBinExpr at standalone position would carry.
	//
	// Stage-1 RHS is FlowRHSImplIn = BlockExpr | BareBlockExpr |
	// OrDispatch. OrDispatch is one tier below FlowBinExpr in the
	// precedence chain, so the stage-1 RHS node itself is never a
	// FlowBinExpr — no concern about confusing the synthesized outer
	// FlowBinExpr with a "real" inner one.
	FuncBodyPipeline(frame,parts) {
		var op = "";
		var body;
		var pendingOp = "";
		var fbpDelims = [];
		var chainDelims = [];
		for (let p of parts) {
			if (isNode(p)) {
				if (!body) {
					body = p;
				}
				else {
					body = {
						type:  "FlowBinExpr",
						left:  body,
						op:    pendingOp,
						right: p,
						start: body.start,
						end:   p.end,
					};
					pendingOp = "";
				}
				continue;
			}
			// Token — op token or soft delim.
			if (p.type === "Whitespace" || p.type === "Comment") {
				if (!body) fbpDelims.push(p);
				else       chainDelims.push(p);
				continue;
			}
			// Op token.
			if (!body) op += p.value;
			else       pendingOp += p.value;
		}
		// Inter-stage trivia attaches to outermost synthesized FlowBinExpr
		// only when stages 2+ actually folded one. Single-stage: chainDelims
		// is empty by construction (no tokens after the lone body node).
		if (body && body.type === "FlowBinExpr" && chainDelims.length > 0) {
			body.delims = chainDelims;
		}
		return withDelims({ type: "FuncBodyPipeline", op, body }, fbpDelims);
	},

	// FuncBodyBlock := OpenBrace _ <FuncBodyStmts> _ CloseBrace;
	//
	// Braces and semicolons → delims.
	FuncBodyBlock(frame,parts) {
		var { stmts, delims } = collectStmtList(parts);
		return withDelims({ type: "FuncBodyBlock", stmts }, delims);
	},

	// FuncBodyStmtSemi    := FuncBodyStmt (_ Semicolon)+;
	// FuncBodyStmtSemiOpt := FuncBodyStmt (_ Semicolon)*;
	//
	// α-claim via shapeStmtSemi. See §1.
	FuncBodyStmtSemi   (frame,parts) { return shapeStmtSemi(parts); },
	FuncBodyStmtSemiOpt(frame,parts) { return shapeStmtSemi(parts); },

	// DefFuncExpr := "defn" (_ Identifier At?)?
	//                (_ OpenParen _ (ParameterList | GatherParameter)? _ CloseParen)+
	//                (_ <FuncPrecondList>)? (_ FuncOverClause)? (_ FuncAsClause)?
	//                _ <FuncBody>;
	//
	// "defn" keyword drops; At (when present, the method @
	// marker) drops as it's captured into `at: true`. Parens
	// are structural → delims; an empty paren-pair still
	// synthesizes a zero-content ParameterList (per the empty-
	// merged convention with end:null).
	//
	// Field shapes:
	//   - `over` is always the full FuncOverClause node (carries
	//     `.names`, parens / commas / internal trivia in `.delims`).
	//     Earlier versions folded to `over: Identifier[]` and lost
	//     the structural punctuation; rolled back.
	//   - `as` is shape-polymorphic, same rule as AsExpr's `inner.as`:
	//     bare Identifier when FuncAsClause has no delims, the full
	//     FuncAsClause wrapper when it does. Normalize with:
	//       var annotation = as.type === "FuncAsClause" ? as.annotation : as;
	DefFuncExpr(frame,parts) {
		var name, at, over, as, body;
		var paramSets = [];
		var preconditions = [];
		var delims = [];

		var lastOpenParen = null;
		var currentSet = null;

		for (let p of parts) {
			if (!isNode(p)) {
				if (p.type === "Keyword" && p.value === "defn") continue;
				if (p.type === "At") { at = true; continue; }
				if (p.type === "OpenParen") {
					lastOpenParen = p;
					currentSet = null;
					delims.push(p);
					continue;
				}
				if (p.type === "CloseParen") {
					if (currentSet) {
						paramSets.push(currentSet);
					}
					else {
						paramSets.push({
							type: "ParameterList",
							params: [],
							start: lastOpenParen.end + 1,
							end:   null,
						});
					}
					lastOpenParen = null;
					delims.push(p);
					continue;
				}
				// Any other raw token at this level — push to
				// delims for completeness (defensive; grammar
				// shouldn't produce more here).
				delims.push(p);
				continue;
			}
			// Nodes
			if (p.type === "Identifier" && !name && paramSets.length === 0 && !lastOpenParen) {
				name = p;
				continue;
			}
			if (lastOpenParen) {
				currentSet = p;
				continue;
			}
			if (p.type === "FuncPrecond")        { preconditions.push(p); continue; }
			if (p.type === "FuncOverClause")     { over = p; continue; }
			if (p.type === "FuncAsClause")       { as = p.delims ? p : p.annotation; continue; }
			if (
				p.type === "FuncBodyExpr" ||
				p.type === "FuncBodyPipeline" ||
				p.type === "FuncBodyBlock"
			) {
				body = p;
				continue;
			}
		}

		var node = { type: "DefFuncExpr" };
		if (name) node.name = name;
		if (at) node.at = true;
		node.paramSets = paramSets;
		if (preconditions.length > 0) node.preconditions = preconditions;
		if (over) node.over = over;
		if (as) node.as = as;
		node.body = body;
		return withDelims(node, delims);
	},

	// DefHookDecl := "defn" _ Identifier (At | Percent)
	//                (_ OpenParen _ (ParameterList | GatherParameter)? _ CloseParen)+
	//                (_ <FuncPrecondList>)? (_ FuncOverClause)? (_ FuncAsClause)?
	//                _ <FuncBody>;
	//
	// Mirrors DefFuncExpr's shape minus the optional `at` flag,
	// plus a REQUIRED `marker` field carrying "@" or "%".
	//
	// "defn" keyword drops; the marker token (At or Percent) drops
	// as it's captured into `marker` (parallel to DefFuncExpr's
	// `at: true` capture). Parens are structural → delims; an
	// empty paren-pair still synthesizes a zero-content
	// ParameterList (per the empty-merged convention with end:null).
	//
	// Identifier is required by grammar (no anonymous form); the
	// shaper's name-capture rule (first Identifier-typed node
	// before any paramSet) matches DefFuncExpr's.
	//
	// Field shapes match DefFuncExpr:
	//   - `over` is the full FuncOverClause node (parens / commas
	//     / internal trivia carried in `.delims`).
	//   - `as` is shape-polymorphic per AsExpr's `inner.as`
	//     convention. Normalize with:
	//       var annotation = as.type === "FuncAsClause" ? as.annotation : as;
	DefHookDecl(frame,parts) {
		var name, marker, over, as, body;
		var paramSets = [];
		var preconditions = [];
		var delims = [];

		var lastOpenParen = null;
		var currentSet = null;

		for (let p of parts) {
			if (!isNode(p)) {
				if (p.type === "Keyword" && p.value === "defn") continue;
				if (p.type === "At")      { marker = "@"; continue; }
				if (p.type === "Percent") { marker = "%"; continue; }
				if (p.type === "OpenParen") {
					lastOpenParen = p;
					currentSet = null;
					delims.push(p);
					continue;
				}
				if (p.type === "CloseParen") {
					if (currentSet) {
						paramSets.push(currentSet);
					}
					else {
						paramSets.push({
							type: "ParameterList",
							params: [],
							start: lastOpenParen.end + 1,
							end:   null,
						});
					}
					lastOpenParen = null;
					delims.push(p);
					continue;
				}
				// Any other raw token at this level — push to
				// delims for completeness (defensive; grammar
				// shouldn't produce more here).
				delims.push(p);
				continue;
			}
			// Nodes
			if (p.type === "Identifier" && !name && paramSets.length === 0 && !lastOpenParen) {
				name = p;
				continue;
			}
			if (lastOpenParen) {
				currentSet = p;
				continue;
			}
			if (p.type === "FuncPrecond")        { preconditions.push(p); continue; }
			if (p.type === "FuncOverClause")     { over = p; continue; }
			if (p.type === "FuncAsClause")       { as = p.delims ? p : p.annotation; continue; }
			if (
				p.type === "FuncBodyExpr" ||
				p.type === "FuncBodyPipeline" ||
				p.type === "FuncBodyBlock"
			) {
				body = p;
				continue;
			}
		}

		var node = { type: "DefHookDecl", name, marker };
		node.paramSets = paramSets;
		if (preconditions.length > 0) node.preconditions = preconditions;
		if (over) node.over = over;
		if (as) node.as = as;
		node.body = body;
		return withDelims(node, delims);
	},


	// =============================================================
	// §14 CONDITIONALS / GUARDS
	// =============================================================

	// CondClause := (Qmark | Exmark) BracketExpr;
	//
	// Polarity (?/!) is captured into `polarity` — drops. The
	// BracketExpr is kept as a nested node; it owns its own
	// brackets via its own shaper's delims. CondClause itself
	// carries no raw tokens beyond the polarity sigil (which
	// drops via capture).
	CondClause(frame,parts) {
		var polarity = "";
		var test;
		for (let p of parts) {
			if (isNode(p)) test = p;
			else polarity = p.value;
		}
		return { type: "CondClause", polarity, test };
	},

	// GuardedExpr := CondClause _ Colon _ Expr;
	//
	// Colon is structural → delims.
	GuardedExpr(frame,parts) {
		var clause, consequent;
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) {
				if (p.type === "CondClause") clause = p;
				else consequent = p;
			}
			else delims.push(p); // Colon
		}
		return withDelims({ type: "GuardedExpr", clause, consequent }, delims);
	},


	// =============================================================
	// §15 MATCH EXPRESSIONS
	// =============================================================

	// IndepMatchExpr := Qmark OpenBrace _ <IndepMatchStmts> _ CloseBrace;
	//
	// Qmark (form opener, not polarity) and braces are structural
	// → delims.
	IndepMatchExpr(frame,parts) {
		var stmts = [];
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) stmts.push(p);
			else delims.push(p); // Qmark, OpenBrace, CloseBrace
		}
		return withDelims({ type: "IndepMatchExpr", stmts }, delims);
	},

	IndepPatternStmt(frame,parts)       { return shapeIndepPatternStmt(parts); },
	IndepPatternStmtNoSemi(frame,parts) { return shapeIndepPatternStmt(parts); },

	// DepMatchExpr := Qmark OpenParen _ ExprNoBlock _ CloseParen
	//                 OpenBrace _ <DepMatchStmts> _ CloseBrace;
	//
	// Qmark (form opener), parens, braces → delims.
	DepMatchExpr(frame,parts) {
		var topic;
		var stmts = [];
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) {
				if (!topic) topic = p;
				else stmts.push(p);
			}
			else delims.push(p); // Qmark, OpenParen, CloseParen, OpenBrace, CloseBrace
		}
		return withDelims({ type: "DepMatchExpr", topic, stmts }, delims);
	},

	DepPatternStmt(frame,parts)       { return shapeDepPatternStmt(parts); },
	DepPatternStmtNoSemi(frame,parts) { return shapeDepPatternStmt(parts); },

	// DepCondClause := (Qmark | Exmark)? OpenBracket _ <DepCondExprList> _ CloseBracket;
	//
	// Polarity captured (drops). OpenBracket, CloseBracket,
	// Comma → delims.
	DepCondClause(frame,parts) {
		var polarityTok;
		var tests = [];
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) tests.push(p);
			else if (p.type === "Qmark" || p.type === "Exmark") polarityTok = p;
			else delims.push(p); // OpenBracket, CloseBracket, Comma
		}
		return withDelims({
			type: "DepCondClause",
			...shapePolarity(polarityTok),
			tests,
		}, delims);
	},

	// DepCondBoolExpr := AsTypeOp _ NamedType
	//                  | DepCondBoolOp _ CompareDispatch
	//                  | NamedUnaryOp
	//                  | OpenParen _ DepCondBoolExpr _ CloseParen;
	//
	// Arm 1/2: operator tokens accumulate into `op` (drop into
	// field), single RHS node into `right`. No structural delims.
	// Arm 3 (unary): single NamedUnaryOp token accumulates into
	// `op`; no RHS node — topic is implicit operand at render
	// time. `right` omitted from the shape.
	// Arm 4 (paren-recursive): UNWRAPS — returns the inner
	// DepCondBoolExpr with the wrapper parens lifted onto its
	// delims in source-position order (via liftWrapperDelims).
	DepCondBoolExpr(frame,parts) {
		var op = "";
		var right;
		var wrapperDelims = [];
		for (let p of parts) {
			if (isNode(p)) {
				right = p;
			}
			else if (p.type === "OpenParen" || p.type === "CloseParen") {
				wrapperDelims.push(p);
			}
			else {
				op += p.value;
			}
		}
		if (wrapperDelims.length > 0) return liftWrapperDelims(right, wrapperDelims);
		var node = { type: "DepCondBoolExpr", op };
		if (right) node.right = right;
		return node;
	},

	// ElseStmt := (Qmark _)? <MatchConsequentNoSemi> (_ Semicolon)*;
	//
	// Optional leading `?` captured as polarity (drops). Colon
	// (from MatchConsequentNoSemi's `: Expr` arm) and trailing
	// Semicolons → delims.
	ElseStmt(frame,parts) {
		var polarityTok, consequent;
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) {
				if (!consequent) consequent = p;
			}
			else if (p.type === "Qmark") polarityTok = p;
			else delims.push(p); // Colon, Semicolon
		}
		return withDelims({
			type: "ElseStmt",
			...shapePolarity(polarityTok),
			consequent,
		}, delims);
	},


	// =============================================================
	// §16 DO-COMPREHENSIONS
	// =============================================================

	// DoVarDefInitOpt := (Identifier        (_ (DoubleColon | Colon) _ ExprNoBlock)?)
	//                  | (DestructureTarget (_ (DoubleColon | Colon) _ ExprNoBlock)?);
	//
	// `op` (":" or "::") captured into the node — drops as field.
	// Per Rule 1, operator chars consumed into a shaper's `op`
	// field drop. No other tokens at this level. No structural
	// delims.
	DoVarDefInitOpt(frame,parts) {
		var target, init;
		var op;
		for (let p of parts) {
			if (isNode(p)) {
				if (!target) target = p;
				else init = p;
			}
			else if (p.type === "Colon" || p.type === "DoubleColon") {
				op = p.value;
			}
			// no other structural tokens at this level
		}
		var node = { type: "DoVarDefInitOpt", target };
		if (init) {
			node.op = op;
			node.init = init;
		}
		return node;
	},

	// DoBlockDefsInitOpt := OpenParen _ <DoVarDefInitOptList> _ CloseParen;
	//
	// Parens and commas are structural → delims.
	DoBlockDefsInitOpt(frame,parts) {
		var entries = [];
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) entries.push(p);
			else delims.push(p); // OpenParen, CloseParen, Comma
		}
		return withDelims({ type: "DoBlockDefsInitOpt", entries }, delims);
	},

	// DoBlockExpr := DoBlockDefsInitOpt? _ <DoBareBlockExpr>;
	//
	// Braces and semicolons (from spliced <DoBareBlockExpr>) →
	// delims.
	DoBlockExpr(frame,parts) {
		var defs;
		var rest = [];
		for (let p of parts) {
			if (isNode(p) && p.type === "DoBlockDefsInitOpt") defs = p;
			else rest.push(p);
		}
		var { stmts, delims } = collectStmtList(rest);
		var node = { type: "DoBlockExpr", stmts };
		if (defs) node.defs = defs;
		return withDelims(node, delims);
	},

	// DoStmtSemi    := DoStmt? (_ Semicolon)+;
	// DoStmtSemiOpt := DoStmt? (_ Semicolon)*;
	//
	// α-claim via shapeStmtSemi. See §1. DoFinalUnwrapExpr is
	// not a member of this family — it's a typed node carrying
	// its own DoubleColon/Semicolons; flows through
	// collectStmtList unchanged.
	DoStmtSemi   (frame,parts) { return shapeStmtSemi(parts); },
	DoStmtSemiOpt(frame,parts) { return shapeStmtSemi(parts); },

	// DoDefVarStmt := "def" _ (Identifier | DestructureTarget) _ DoubleColon _ Expr;
	//
	// "def" keyword drops; DoubleColon (structural marker
	// distinguishing this from DefVarStmt, anchored in type tag
	// + carried as delim) → delims.
	DoDefVarStmt(frame,parts) {
		var nodes = [];
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) nodes.push(p);
			else if (p.type === "Keyword") continue; // "def"
			else delims.push(p); // DoubleColon
		}
		var [ target, init ] = nodes;
		return withDelims({ type: "DoDefVarStmt", target, init }, delims);
	},

	// DoFinalUnwrapExpr := DoubleColon _ ExprNoBlock (_ Semicolon)*;
	//
	// DoubleColon (opener; anchored in type tag) and trailing
	// Semicolons → delims.
	DoFinalUnwrapExpr(frame,parts) {
		var expr;
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) expr = p;
			else delims.push(p); // DoubleColon, Semicolon
		}
		return withDelims({ type: "DoFinalUnwrapExpr", expr }, delims);
	},

	// DoComprExpr := (Identifier | BuiltIn) _ Tilde OpenAngle OpenAngle _ DoBlockExpr;
	//
	// `~<<` tokens (Tilde + OpenAngle + OpenAngle) are the
	// monadic-bind operator — anchored in type tag, drop as
	// operator-class per Rule 1.
	DoComprExpr(frame,parts) {
		var [ targetType, body ] = parts.filter(isNode);
		return { type: "DoComprExpr", targetType, body };
	},

	// DoLoopComprExpr := ExprNoBlock _ Tilde OpenAngle Star _ <DoLoopIterationExpr>;
	//
	// `~<*` tokens (Tilde + OpenAngle + Star) are the loop
	// operator — anchored in type tag, drop as operator-class.
	// The paren-recursive arm of <DoLoopIterNoBlockExpr> is
	// hidden — its OpenParen/CloseParen tokens splice up to this
	// level. Per Rule 1, those parens are structural → delims.
	DoLoopComprExpr(frame,parts) {
		var nodes = [];
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) nodes.push(p);
			else if (
				p.type === "Tilde" ||
				p.type === "OpenAngle" ||
				p.type === "Star"
			) {
				// `~<*` operator — anchored in type tag, drop
			}
			else delims.push(p); // OpenParen, CloseParen from paren-recursive arm
		}
		var [ range, iter ] = nodes;
		return withDelims({ type: "DoLoopComprExpr", range, iter }, delims);
	},


	// =============================================================
	// §17 DATA STRUCTURE LITERALS
	// =============================================================

	// RecordTupleValue := AsExpr | CallExpr | EmptyLit | BooleanLit
	//                   | NumberLit | StringLit | DataStructLit
	//                   | IdentifierExpr
	//                   | (OpenParen _ RecordTupleValue _ CloseParen);
	//
	// UNWRAPS — returns the inner node directly. Non-paren arms:
	// no wrapper tokens, liftWrapperDelims is a no-op and returns
	// the inner unchanged. Paren-recursive arm: OpenParen/CloseParen
	// lift onto the inner node's delims in source-position order
	// (same pattern as DepCondBoolExpr arm-3, GroupedTypeExpr).
	// Machinery's start/end overwrite extends the inner node's span
	// to cover the parens, matching AsExpr's behavior.
	RecordTupleValue(frame,parts) {
		var inner;
		var wrapperDelims = [];
		for (let p of parts) {
			if (isNode(p)) inner = p;
			else wrapperDelims.push(p); // OpenParen, CloseParen
		}
		return liftWrapperDelims(inner, wrapperDelims);
	},

	// RecordTupleLit := OpenAngle _ <RecordTupleEntryList> _ CloseAngle;
	//
	// Angles and commas → delims.
	RecordTupleLit(frame,parts) {
		var entries = [];
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) entries.push(p);
			else delims.push(p); // OpenAngle, CloseAngle, Comma
		}
		return withDelims({ type: "RecordTupleLit", entries }, delims);
	},

	// SetLit := OpenAngle OpenBracket _ <SetEntryList> _ CloseBracket CloseAngle;
	//
	// Compound `<[` / `]>` openers/closers and commas → delims.
	SetLit(frame,parts) {
		var entries = [];
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) entries.push(p);
			else delims.push(p); // OpenAngle, OpenBracket, CloseBracket, CloseAngle, Comma
		}
		return withDelims({ type: "SetLit", entries }, delims);
	},

	// PickValue := Ampersand <IdentBase> MultiAccessExpr?;
	//
	// Ampersand sigil is structural → delims.
	PickValue(frame,parts) {
		var nodes = [];
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) nodes.push(p);
			else delims.push(p); // Ampersand
		}
		var [ base, access ] = nodes;
		return withDelims({
			type: "PickValue",
			source: foldAccess(base, access),
		}, delims);
	},

	// ComputedPropAccessChain := IdentBase (DotIdentifier | BracketExpr)*;
	//
	// Bare identifier-access chain for the computed-key bare alphabet.
	// Folds segs via applyChainSeg (same helper ChainExpr uses) into
	// the standard MemberAccessExpr / IndexAccessExpr nesting. Bare
	// IdentBase (zero segs) returns just the IdentBase node — the
	// outer ComputedPropName synthesis sees a single Identifier /
	// BuiltIn / PipelineTopic node in that case.
	//
	// No own AST type — same fold-and-return pattern as ChainExpr's
	// shaper. Visibility at the parse-frame level is what's needed;
	// the AST surface is the folded chain.
	ComputedPropAccessChain(frame,parts) {
		var nodes = parts.filter(isNode);
		var node = nodes[0]; // IdentBase
		for (let i = 1; i < nodes.length; i++) {
			node = applyChainSeg(node, nodes[i]);
		}
		return node;
	},

	// ComputedPropParenExpr := OpenParen _ OperandExpr _ CloseParen;
	//
	// Unwrap-shaper — returns the inner OperandExpr node directly,
	// lifting OpenParen/CloseParen onto its delims in source-position
	// order (same liftWrapperDelims pattern as RecordTupleValue and
	// GroupedTypeExpr). No ComputedPropParenExpr type at the AST
	// surface — the inner node is whatever OperandExpr produces
	// (Identifier, AddBinExpr, CompareBinExpr, FlowBinExpr, etc.).
	ComputedPropParenExpr(frame,parts) {
		var inner;
		var wrapperDelims = [];
		for (let p of parts) {
			if (isNode(p)) inner = p;
			else wrapperDelims.push(p); // OpenParen, CloseParen
		}
		return liftWrapperDelims(inner, wrapperDelims);
	},

	// ConcisePropDef := Colon <PropertyExpr>;
	//
	// Colon is structural → delims. PropertyExpr arrives either
	// as a node (Identifier) or as raw integer tokens — the
	// shapePropertyExpr helper synthesizes a NumberLit for the
	// integer arm. Slice past the leading Colon (which is the
	// first token by grammar) before handing to the helper; the
	// Colon itself goes to delims.
	ConcisePropDef(frame,parts) {
		var delims = [];
		var keyParts = [];
		var sawColon = false;
		for (let p of parts) {
			if (!sawColon && !isNode(p) && p.type === "Colon") {
				delims.push(p);
				sawColon = true;
				continue;
			}
			keyParts.push(p);
		}
		return withDelims({
			type: "ConcisePropDef",
			source: shapePropertyExpr(keyParts),
		}, delims);
	},

	// ExplicitPropDef := (<ComputedPropName> | <PropertyExpr>) _ Colon _ <RecordTupleValue>;
	//
	// Outer Colon (separating key from value) → delims. The
	// Percent sigil for the computed-key arm is consumed into
	// the synthesized ComputedPropName node's span — it doesn't
	// separately surface on ExplicitPropDef.
	//
	// ComputedPropName synthesis (post-narrowing, see §17 grammar):
	// the bare arm admits four shapes — BooleanLit / StringLit
	// (always node), ComputedPropAccessChain fold output (always
	// node), and the numeric-literal alphabet (raw tokens —
	// PositiveIntegerLit alone, bare Number alone, or Escape +
	// PositiveIntegerLit/Number). The paren-wrap arm yields the
	// unwrapped inner (always node).
	//
	// So `keyParts.find(isNode)` succeeds for every shape except
	// the numeric-literal one, which arrives as raw tokens past
	// the Percent. The shapeComputedPropName helper synthesizes
	// a NumberLit for that case (same shapePropertyExpr pattern
	// used by PropertyExpr's integer arm).
	ExplicitPropDef(frame,parts) {
		var colonIdx = parts.findIndex(p => !isNode(p) && p.type === "Colon");
		var keyParts = parts.slice(0, colonIdx);
		var colonTok = parts[colonIdx];
		var valueParts = parts.slice(colonIdx + 1);

		var key;
		if (keyParts.length > 0 && !isNode(keyParts[0]) && keyParts[0].type === "Percent") {
			key = shapeComputedPropName(keyParts);
		}
		else {
			key = shapePropertyExpr(keyParts);
		}

		var init = valueParts.find(isNode);
		return withDelims({ type: "ExplicitPropDef", key, init }, [colonTok]);
	},


	// =============================================================
	// §18 TYPE DEFINITIONS
	// =============================================================

	// DefTypeStmt := "deft" _ Identifier _ <TypeExpr>;
	//
	// "deft" keyword drops. No structural tokens.
	DefTypeStmt(frame,parts) {
		var [ name, decl ] = parts.filter(isNode);
		return { type: "DefTypeStmt", name, decl };
	},

	// NamedType := ((Identifier | BuiltIn) (Period (Identifier | BuiltIn))*) | NativeType;
	//
	// Native arm: single Keyword token whose value goes into
	// `of` (drops as captured field). Bare/dotted arm: Period
	// drops (anchored in type tag as namespace separator). No
	// structural delims either way.
	NamedType(frame,parts) {
		if (parts.length === 1 && !isNode(parts[0])) {
			return { type: "NamedType", of: parts[0].value };
		}
		return { type: "NamedType", segments: parts.filter(isNode) };
	},

	// GroupedTypeExpr := OpenBrace _ (FuncTypeExpr | UnionTypeExpr (_ Pipe)? | NoUnionTypeExpr) _ CloseBrace;
	//
	// Unwrap-shaper — returns the inner type node with the
	// wrapper braces (and optional trailing Pipe in the union
	// arm) lifted onto its delims in source-position order (via
	// liftWrapperDelims).
	GroupedTypeExpr(frame,parts) {
		var inner;
		var wrapperDelims = [];
		for (let p of parts) {
			if (isNode(p)) inner = p;
			else wrapperDelims.push(p); // OpenBrace, CloseBrace, optional Pipe
		}
		return liftWrapperDelims(inner, wrapperDelims);
	},

	// NestedTypeExpr := NamedType _ GroupedTypeExpr;
	//
	// No structural tokens at this level (the GroupedTypeExpr
	// child's braces vanish via its unwrap).
	NestedTypeExpr(frame,parts) {
		var [ base, arg ] = parts.filter(isNode);
		return { type: "NestedTypeExpr", base, arg };
	},

	// UnionTypeExpr := NoUnionTypeExpr (_ Pipe _ NoUnionTypeExpr)+;
	//
	// Pipe separators are structural → delims.
	UnionTypeExpr(frame,parts) {
		var types = [];
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) types.push(p);
			else delims.push(p); // Pipe
		}
		return withDelims({ type: "UnionTypeExpr", types }, delims);
	},

	// DataStructTypeExpr := OpenAngle _ DataStructTypeList? _ (Comma _)? CloseAngle;
	//
	// Angles and commas → delims.
	DataStructTypeExpr(frame,parts) {
		var entries = [];
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) entries.push(p);
			else delims.push(p); // OpenAngle, CloseAngle, Comma
		}
		return withDelims({ type: "DataStructTypeExpr", entries }, delims);
	},

	// DataStructFieldType := Identifier _ Colon _ <DataStructValueType>;
	//
	// Colon is structural → delims.
	DataStructFieldType(frame,parts) {
		var nodes = [];
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) nodes.push(p);
			else delims.push(p); // Colon
		}
		var [ name, fieldType ] = nodes;
		return withDelims({ type: "DataStructFieldType", name, fieldType }, delims);
	},

	// DataStructFinalValType := Star (NoUnionTypeExpr | GroupedTypeExpr);
	//
	// Star (rest sigil) is structural → delims.
	DataStructFinalValType(frame,parts) {
		var fieldType;
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) fieldType = p;
			else delims.push(p); // Star
		}
		return withDelims({ type: "DataStructFinalValType", fieldType }, delims);
	},

	// FuncTypeArg := Qmark? (NoUnionTypeExpr | GroupedTypeExpr);
	//
	// Qmark (when present) is dual-purpose: captured into
	// `optional:true` flag AND pushed to delims (position needed
	// to round-trip WS between `?` and the type, e.g. `? int` vs
	// `?int`). Same dual-purpose pattern as Star in
	// FuncTypeFinalArg, and Caret in FuncTypeExpr.
	FuncTypeArg(frame,parts) {
		var node = { type: "FuncTypeArg", of: parts.find(isNode) };
		var delims = [];
		for (let p of parts) {
			if (!isNode(p) && p.type === "Qmark") {
				node.optional = true;
				delims.push(p);
			}
		}
		return withDelims(node, delims);
	},

	// FuncTypeFinalArg := (Star (NoUnionTypeExpr | GroupedTypeExpr)) | FuncTypeArg;
	//
	// Normalizes into FuncTypeArg. Star arm: Star sigil → delims
	// on the synthesized FuncTypeArg. FuncTypeArg arm: passthrough
	// (the inner FuncTypeArg already carries any of its own delims).
	//
	// Per the §15 NoSemi collapse convention, FuncTypeFinalArg
	// never appears as a node type in the AST.
	FuncTypeFinalArg(frame,parts) {
		var nodes = parts.filter(isNode);
		var starTok;
		for (let p of parts) {
			if (!isNode(p) && p.type === "Star") starTok = p;
		}
		if (starTok) {
			return withDelims(
				{ type: "FuncTypeArg", of: nodes[0], rest: true },
				[starTok]
			);
		}
		return nodes[0];
	},

	// FuncTypeExpr := OpenParen _ FuncTypeArgList? _ (Comma _)? CloseParen _ Caret _ Qmark? _ (NoUnionTypeExpr | GroupedTypeExpr);
	//
	// Parens, commas → delims. Caret is dual-purpose: drives
	// the args/return state machine AND pushes to delims. Qmark
	// after Caret is dual-purpose: captures `optionalReturn:true`
	// flag AND pushes to delims (position needed to round-trip
	// WS straddling the `?`, e.g. `^ ?int` vs `^? int`).
	FuncTypeExpr(frame,parts) {
		var argTypes = [];
		var returnType;
		var optionalReturn = false;
		var seenCaret = false;
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) {
				if (seenCaret) returnType = p;
				else argTypes.push(p);
			}
			else if (p.type === "Caret") {
				seenCaret = true;
				delims.push(p); // dual-purpose: state-driver AND delim
			}
			else if (p.type === "Qmark" && seenCaret) {
				optionalReturn = true;
				delims.push(p); // dual-purpose: flag AND delim
			}
			else delims.push(p); // OpenParen, CloseParen, Comma
		}
		var node = { type: "FuncTypeExpr", argTypes, returnType };
		if (optionalReturn) node.optionalReturn = true;
		return withDelims(node, delims);
	},
};

// =============================================================
// §11 LENIENT-FORM ALIASES
// =============================================================
//
// The §11 strict/lenient fork at the defs-init container level:
//
//   BlockDefsInitOpt / BlockDefsInitOptImplIn
//
// produces structurally identical AST nodes — the defs-init
// wrapper doesn't inspect its entries at shape-time, so a single
// shaper handles both. Alias below.
//
// The entry-level fork (VarDefInitOpt / VarDefInitOptImplIn) is
// NOT aliased under Series 1. The two shapers emit the same type
// tag "VarDefInitOpt" but distinct field names — `.init` for the
// strict (bare `:`) arm, `.default` for the lenient (`:?`) arm.
// Downstream consumers read `node.init || node.default` to
// source the expression regardless of arm. The distinct field
// names preserve the sigil-semantic split (unconditional bind vs
// override-on-empty) in the AST, keeping the type tag uniform
// for downstream walker simplicity. See the dedicated
// VarDefInitOptImplIn shaper adjacent to VarDefInitOpt above.
//
// (Note: there is no BlockExpr-level counterpart in this alias
// table. The grammar restructure folded the prior BlockExprImplIn
// production; the surviving block fork is BlockExpr — defs-init
// REQUIRED, lenient inner — vs BareBlockExpr — no defs-init.
// These are structurally distinct productions with distinct
// shapers, not a strict/lenient alias pair.)
//
// The remaining alias below reuses the strict-form BlockDefsInitOpt
// shaper function by reference — it emits its hardcoded `type:`
// string ("BlockDefsInitOpt"), so the lenient-production frame
// shapes to the same type tag. No `this` dependency in the shaper
// body makes this safe.
defaultShapers.BlockDefsInitOptImplIn = defaultShapers.BlockDefsInitOpt;

// BlockExprStrict shapes to the same { type: "BlockExpr", defs, body }
// AST as BlockExpr — the strict/lenient inner distinction is parser-
// only, downstream consumers see one unified type.
defaultShapers.BlockExprStrict = defaultShapers.BlockExpr;
