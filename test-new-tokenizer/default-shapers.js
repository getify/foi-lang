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
//   - Wrapper-unwrap at assignment. When a child production exists
//     only as a single-payload wrapper around one semantic value
//     (e.g. AsAnnotationExpr around NamedType), parents unwrap to
//     the payload at the slot assignment — the slot name on the
//     parent (e.g. `parent.as`) conveys the role, so the wrapper
//     layer is redundant at the consumer surface. The wrapper's
//     own shaper still emits a node for completeness; parents
//     reach through it.
//   - start/end/delims rules: the machinery brand-stamps start/end
//     on every shaped node. Soft delims (Whitespace, Comment) are
//     merged into node.delims by the machinery when
//     preserveSoftDelims is on (hard-vs-soft merge handled in a
//     future step — for now shapers own delims entirely; under
//     test-parser.js / inspect-ast.js defaults preserveSoftDelims
//     is off, so shaper-emitted delims persist untouched).
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
//   UNWRAPS — lifts `as: annotation` onto its inner node and
//   returns the inner. No `AsExpr` node type appears in the AST.
//   The machinery's unconditional start/end overwrite extends the
//   returned node's span to cover the `:as` tail (AsExpr frame
//   spans from inner.start through annotation.end), which is
//   exactly what we want.
//
//   The six paren-grouping productions retain their own
//   `(_ AsAnnotationExpr)?` tail — parens are atomic groups that
//   can carry `:as` regardless of position (including as a binary
//   operand). Their shapers (via shapeGrouped) attach `as`
//   directly. The four restrictive paren inners additionally
//   accept AsExpr as a first inner alt so that `(?x :as bool)` etc.
//   parse inside the parens.
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
// synthetic intermediates the machinery doesn't reach. No delims
// — these synthesized nodes don't have raw tokens of their own;
// the delims of the constituent segment nodes live on those nodes.
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
	if (t === "PrefixCallSuffix") {
		return {
			type: "CallExpr",
			callee: object,
			args: seg.args,
			start: object.start,
			end: seg.end,
		};
	}
	if (t === "PartialCallSuffix") {
		return {
			type: "PartialCallExpr",
			callee: object,
			args: seg.args,
			start: object.start,
			end: seg.end,
		};
	}
	if (t === "DotIdentifier") {
		let node = {
			type: "MemberAccessExpr",
			object,
			start: object.start,
			end: seg.end,
		};
		if (seg.accessor) node.accessor = seg.accessor;
		else node.index = seg.index;
		return node;
	}
	if (t === "BracketExpr") {
		return {
			type: "IndexAccessExpr",
			object,
			expr: seg.expr,
			start: object.start,
			end: seg.end,
		};
	}
	if (t === "DotBracketExpr") {
		return {
			type: "RangeAccessExpr",
			object,
			range: seg.range,
			start: object.start,
			end: seg.end,
		};
	}
	if (t === "DotAngleExpr") {
		return {
			type: "PropertyPickExpr",
			object,
			properties: seg.properties,
			start: object.start,
			end: seg.end,
		};
	}
	throw new Error(`ChainExpr: unexpected segment type "${t}"`);
}

// Helper for the eight unified access-fold sites — AtExpr base,
// AssignmentExpr LHS, AtCallExpr's inline AtExpr synthesis,
// ExportNamedBinding source, ExportConciseBinding source,
// DestructureNamedDef source, DestructureConciseDef source, and
// PickValue source. Given a base node and a SingleAccessExpr or
// MultiAccessExpr (or undefined), folds the access segments via
// applyChainSeg left-to-right and returns the resulting nested
// chain. undefined access returns the base unchanged.
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

// Helper for the six paren-grouping productions (GroupedExpr,
// GroupedExprNoBlock, GroupedOpExpr, GroupedBareOpExpr,
// GroupedBareOpExprNoEmpty from §5; GroupedDoExpr from §9
// alongside BinaryAtom). All share the same structure: OpenParen +
// inner-expression + CloseParen + optional AsAnnotationExpr.
//
// All six shape to a single `GroupedExpr` node type at the AST
// surface; no downstream consumer branches on which variant
// matched.
//
// Surrounding parens are structural — push to delims. Inner
// expression promotes to `expr`. Optional `:as` tail unwraps onto
// `as` per the wrapper-unwrap-at-assignment convention.
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
			if (p.type === "AsAnnotationExpr") as = p.annotation;
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
// (either [Colon, Expr-node, Semi] or [BlockExpr-node]).
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
	// Concatenates interior String and StringEscapedChar token
	// values into `text`. Surrounding DoubleQuotes are structural —
	// push to delims. Escape sequences are preserved raw in `text`.
	PlainStr(frame,parts) {
		var text = "";
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) continue;
			if (p.type === "String" || p.type === "StringEscapedChar") {
				text += p.value;
			}
			else delims.push(p); // DoubleQuote
		}
		return withDelims({ type: "PlainStr", text }, delims);
	},

	// SpacingEscapedStr := EscapePlain DoubleQuote SpacingEscapedStrContent* DoubleQuote;
	//
	// Same shape as PlainStr; folds interior Whitespace into
	// `text`. The leading EscapePlain anchors the type tag —
	// drops as operator-class. Surrounding DoubleQuotes are
	// structural → delims.
	SpacingEscapedStr(frame,parts) {
		var text = "";
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) continue;
			if (
				p.type === "String" ||
				p.type === "StringEscapedChar" ||
				p.type === "Whitespace"
			) {
				text += p.value;
			}
			else if (p.type === "Escape") {
				// anchors the form via type tag — drop
			}
			else delims.push(p); // DoubleQuote
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
	// Surfaces as a `chunks` array alternating string text and
	// InterpExpr nodes. Invariant: chunks.length is always odd,
	// chunks[0] and chunks[last] are always strings (possibly "").
	// Leading EscapeBacktick anchors the form — drops. Surrounding
	// DoubleQuotes → delims.
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
			}
			else if (p.type === "String" || p.type === "StringEscapedChar") {
				buf += p.value;
			}
			else if (p.type === "Escape") {
				// anchors the form via type tag — drop
			}
			else delims.push(p); // DoubleQuote
		}
		chunks.push(buf);
		return withDelims({ type: "InterpStr", chunks }, delims);
	},

	// SpacingInterpStr := EscapeSpacingBacktick DoubleQuote SpacingInterpStrContent* DoubleQuote;
	//
	// Same chunks-array shape as InterpStr; Whitespace tokens
	// fold into the adjacent text chunk verbatim.
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
			}
			else if (
				p.type === "String" ||
				p.type === "StringEscapedChar" ||
				p.type === "Whitespace"
			) {
				buf += p.value;
			}
			else if (p.type === "Escape") {
				// anchors the form via type tag — drop
			}
			else delims.push(p); // DoubleQuote
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
	// its inner IdentBase node. Step 3: structural tokens (none
	// here — BareIdentifier wraps a single IdentBase node) simply
	// vanish; Step 5 will add proper wrapper-unwrap lift.
	BareIdentifier(frame,parts) {
		return parts.find(isNode);
	},

	// AsAnnotationExpr := ":as" _ NamedType;
	//
	// `:as` keyword drops. No structural tokens.
	AsAnnotationExpr(frame,parts) {
		return { type: "AsAnnotationExpr", annotation: parts.find(isNode) };
	},

	// AsExpr — Parse-time wrapper only — emits no node of its own.
	// Unwraps to the inner AsableExpr node, lifting `as: annotation`
	// onto it. Step 3: AsExpr's own tokens (none — AsAnnotationExpr
	// is a node, the inner AsableExpr is a node) simply vanish via
	// the unwrap; Step 5 will lift any wrapper delims.
	AsExpr(frame,parts) {
		var inner, as;
		for (let p of parts) {
			if (!isNode(p)) continue;
			if (p.type === "AsAnnotationExpr") as = p;
			else inner = p;
		}
		inner.as = as.annotation;
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
	// Period drops (anchored in type tag). Integer text is
	// preserved raw — no delims needed.
	DotIdentifier(frame,parts) {
		var node = { type: "DotIdentifier" };
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
			// else: Period — anchored in type tag, drop
		}
		return node;
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
	// Period drops (anchored in type tag). Brackets → delims.
	DotBracketExpr(frame,parts) {
		var range;
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) range = p;
			else if (p.type === "Period") continue;
			else delims.push(p); // OpenBracket, CloseBracket
		}
		return withDelims({ type: "DotBracketExpr", range }, delims);
	},

	// DotAngleExpr := Period OpenAngle _ <PropertyExpr> (_ Comma _ <PropertyExpr>)* _ CloseAngle;
	//
	// Period drops (anchored in type tag). Angles, commas, and
	// EscapePlain (when prefixing integer accessors) → delims.
	DotAngleExpr(frame,parts) {
		var properties = [];
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) {
				properties.push({ accessor: p });
			}
			else if (p.type === "PositiveIntegerLit") {
				properties.push({ index: p.value });
			}
			else if (p.type === "Period") continue;
			else delims.push(p); // OpenAngle, CloseAngle, Comma, Escape
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

	// MonadConstructor — bare `@`. The At sigil is structural →
	// delims. Type tag is otherwise total information.
	MonadConstructor(frame,parts) {
		var delims = [];
		for (let p of parts) {
			if (!isNode(p)) delims.push(p); // At
		}
		return withDelims({ type: "MonadConstructor" }, delims);
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
	PrefixCallSuffix(frame,parts) {
		var args = [];
		var op = "";
		var opStart, opEnd;
		var primed = false;
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) args.push(p);
			else if (p.type === "SingleQuote") {
				primed = true;
				opEnd = p.end;
			}
			else if (
				p.type === "OpenParen" ||
				p.type === "CloseParen" ||
				p.type === "Comma"
			) {
				delims.push(p);
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
	PartialCallSuffix(frame,parts) {
		var args = [];
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) args.push(p);
			else delims.push(p); // Pipe, Comma
		}
		return withDelims({ type: "PartialCallSuffix", args }, delims);
	},

	// AtCallExpr — at-form applied to (optionally) an argument.
	// At sigil is structural → delims. See production header
	// comment in prior versions for the four arm/sub-form table.
	AtCallExpr(frame,parts) {
		var node = { type: "AtCallExpr" };
		var first = parts[0];
		var delims = [];

		if (!isNode(first)) {
			// Arm 1: `None@`. parts is [Builtin-tok("None"), At-tok].
			let atTok;
			for (let p of parts) {
				if (!isNode(p) && p.type === "At") {
					atTok = p;
					delims.push(p);
				}
			}
			node.callee = {
				type: "AtExpr",
				base: {
					type: "BuiltIn",
					name: first.value,
					start: first.start,
					end: first.end,
				},
				start: first.start,
				end: atTok.end,
			};
		}
		else if (
			first.type === "AtExpr" ||
			first.type === "MonadConstructor"
		) {
			// Arm 2 sub-forms A and C: callee is pre-shaped.
			node.callee = first;
			for (let p of parts.slice(1)) {
				if (isNode(p)) node.arg = p;
				// no other tokens expected at this outer level
			}
		}
		else {
			// Arm 2 sub-form B: IdentBase + ?SingleAccessExpr + At-tok + ExprNoBlock.
			let base = first;
			let access, arg, atTok;
			for (let p of parts.slice(1)) {
				if (isNode(p)) {
					if (p.type === "SingleAccessExpr") access = p;
					else arg = p;
				}
				else if (p.type === "At") {
					atTok = p;
					delims.push(p);
				}
			}
			node.callee = {
				type: "AtExpr",
				base: foldAccess(base,access),
				start: base.start,
				end: atTok.end,
			};
			if (arg) node.arg = arg;
		}

		return withDelims(node, delims);
	},

	// ChainExpr — base + ordered segments folded into JS-style
	// nested typed nodes. ChainExpr itself emits no node — it's a
	// parse vehicle only. SingleQuote captured into PrimedExpr
	// synthesis. No outer node, so no delims at this level (the
	// segment nodes carry their own delims).
	ChainExpr(frame,parts) {
		var base;
		var preSegs = [];
		var postPrimeSegs = [];
		var primeTokEnd;
		for (let p of parts) {
			if (!isNode(p)) {
				// SingleQuote — the prime operator.
				primeTokEnd = p.end;
			}
			else if (base === undefined) {
				base = p;
			}
			else if (primeTokEnd !== undefined) {
				postPrimeSegs.push(p);
			}
			else {
				preSegs.push(p);
			}
		}

		var node = base;
		for (let seg of preSegs) {
			node = applyChainSeg(node, seg);
		}
		if (primeTokEnd !== undefined) {
			node = {
				type: "PrimedExpr",
				inner: node,
				start: node.start,
				end: primeTokEnd,
			};
		}
		for (let seg of postPrimeSegs) {
			node = applyChainSeg(node, seg);
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
	// §11 BLOCKS / DEF-BLOCK STATEMENT
	// =============================================================

	// VarDefInit := (Identifier | DestructureTarget) _ Colon _ ExprNoBlock;
	//
	// Colon is structural → delims.
	VarDefInit(frame,parts) {
		var nodes = [];
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) nodes.push(p);
			else delims.push(p); // Colon
		}
		var [ target, init ] = nodes;
		return withDelims({ type: "VarDefInit", target, init }, delims);
	},

	// VarDefInitOpt := (Identifier        (_ Colon _ ExprNoBlock)?)
	//                | (DestructureTarget (_ Colon _ ExprNoBlock)?);
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

	// BlockDefsInit := OpenParen _ <VarDefInitList> _ CloseParen;
	//
	// Parens and commas are structural → delims.
	BlockDefsInit(frame,parts) {
		var entries = [];
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) entries.push(p);
			else delims.push(p); // OpenParen, CloseParen, Comma
		}
		return withDelims({ type: "BlockDefsInit", entries }, delims);
	},

	// BlockDefsInitOpt := OpenParen _ <VarDefInitOptList> _ CloseParen;
	BlockDefsInitOpt(frame,parts) {
		var entries = [];
		var delims = [];
		for (let p of parts) {
			if (isNode(p)) entries.push(p);
			else delims.push(p); // OpenParen, CloseParen, Comma
		}
		return withDelims({ type: "BlockDefsInitOpt", entries }, delims);
	},

	// BlockExpr := BlockDefsInitOpt? _ <BareBlockExpr>;
	//
	// <BareBlockExpr> is hidden — its OpenBrace/Semicolons/
	// CloseBrace splice into parts. Braces and semicolons are
	// structural → delims.
	BlockExpr(frame,parts) {
		var defs;
		var rest = [];
		for (let p of parts) {
			if (isNode(p) && p.type === "BlockDefsInitOpt") defs = p;
			else rest.push(p);
		}
		var { stmts, delims } = collectStmtList(rest);
		var node = { type: "BlockExpr", stmts };
		if (defs) node.defs = defs;
		return withDelims(node, delims);
	},

	// DefBlockStmt := "def" _ BlockDefsInit _ <BareBlockExpr>;
	//
	// "def" keyword drops; braces and semicolons → delims.
	DefBlockStmt(frame,parts) {
		var defs;
		var rest = [];
		for (let p of parts) {
			if (isNode(p)) {
				if (p.type === "BlockDefsInit") defs = p;
				else rest.push(p);
			}
			else if (p.type === "Keyword") continue; // "def"
			else rest.push(p); // braces, lifted semis
		}
		var { stmts, delims } = collectStmtList(rest);
		return withDelims({ type: "DefBlockStmt", defs, stmts }, delims);
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

	// ParameterList := VarDefInitOpt (_ Comma _ VarDefInitOpt)*;
	//
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
	// ":as" keyword drops. No structural tokens.
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

	// FuncBodyPipeline := PipelineOp _ (BlockExpr | ExprNoBlock | GroupedExpr);
	//
	// Multi-token pipeline op (e.g. `#>` = Hash + CloseAngle)
	// concatenates into `op`. No structural delims.
	FuncBodyPipeline(frame,parts) {
		var op = "";
		var body;
		for (let p of parts) {
			if (isNode(p)) body = p;
			else op += p.value;
		}
		return { type: "FuncBodyPipeline", op, body };
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
			if (p.type === "FuncOverClause")     { over = p.names; continue; }
			if (p.type === "FuncAsClause")       { as = p.annotation; continue; }
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
	//                  | OpenParen _ DepCondBoolExpr _ CloseParen;
	//
	// Arm 1/2: operator tokens accumulate into `op` (drop into
	// field). No structural delims.
	// Arm 3 (paren-recursive): UNWRAPS — returns the inner
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
		return { type: "DepCondBoolExpr", op, right };
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

	// DoLoopComprExpr := (ExprNoBlock | GroupedExpr) _ Tilde OpenAngle Star _ <DoLoopIterationExpr>;
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
	ExplicitPropDef(frame,parts) {
		var colonIdx = parts.findIndex(p => !isNode(p) && p.type === "Colon");
		var keyParts = parts.slice(0, colonIdx);
		var colonTok = parts[colonIdx];
		var valueParts = parts.slice(colonIdx + 1);

		var key;
		if (keyParts.length > 0 && !isNode(keyParts[0]) && keyParts[0].type === "Percent") {
			var percent = keyParts[0];
			var inner = keyParts.find(isNode);
			key = {
				type: "ComputedPropName",
				expr: inner,
				start: percent.start,
				end: inner.end,
			};
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
	// Qmark (when present) captured into `optional:true` — drops
	// as field. No structural delims.
	FuncTypeArg(frame,parts) {
		var node = { type: "FuncTypeArg", of: parts.find(isNode) };
		for (let p of parts) {
			if (!isNode(p) && p.type === "Qmark") {
				node.optional = true;
				break;
			}
		}
		return node;
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
	// the args/return state machine AND pushes to delims (per
	// the explicit dual-purpose rule). Qmark after Caret is
	// captured into `optionalReturn:true` (drops as field).
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
			}
			else delims.push(p); // OpenParen, CloseParen, Comma
		}
		var node = { type: "FuncTypeExpr", argTypes, returnType };
		if (optionalReturn) node.optionalReturn = true;
		return withDelims(node, delims);
	},

};
