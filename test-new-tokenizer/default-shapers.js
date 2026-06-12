// shapers.js — AST shape conventions for the Foi syntactic parser.
//
// Each shaper receives (frame, parts) where parts is the source-
// ordered, delim-free sequence of terminals (tokens) and recursively-
// shaped child nodes. Returns a plain object with at minimum a `type`
// field; the machinery brand-stamps `start`/`end` (and `delims` under
// preserveDelim) onto the returned node. Productions not in this map
// receive the default shape: { type, parts, start, end }.
//
// Conventions:
//   - Drop noise tokens (keywords, punctuation, structural
//     delimiters). They're recoverable from the production name.
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
//   - start/end/delims are machinery's job, never set by shapers
//     — except on synthetic intermediate nodes built by the
//     shaper itself (left-folded binary nesting, ChainExpr's
//     typed-node fold, or sub-structures reconstructed from
//     spliced hidden-helper contents), which the machinery
//     doesn't reach.
//   - Multi-token operators (e.g. AddOp `$+`) concatenate their
//     token values into a single string in the `op` field.
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
//
// Token-vs-node discriminator in `parts`:
//   Raw tokens carry a `value` field (string, from the lex layer);
//   shaped nodes never expose `value` at top level. Literal
//   shapers expose source as `text`, identifiers as `name`, etc.
//   The isNode helper below tests this. SHAPERS MUST NOT set a
//   `value` field on returned nodes — doing so breaks the
//   discriminator for any parent shaper that consumes them.

export var isNode = p => !("value" in p);

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
// synthetic intermediates the machinery doesn't reach.
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

// Helper for fold-access call sites — AtExpr base, AssignmentExpr LHS,
// AtCallExpr's inline AtExpr synthesis, and (when their shapers are
// eventually written) ExportNamedBinding, ExportConciseBinding,
// DestructureNamedDef, DestructureConciseDef. Given a base node and a
// SingleAccessExpr or MultiAccessExpr (or undefined), folds the
// access segments via applyChainSeg left-to-right and returns the
// resulting nested chain. undefined access returns the base
// unchanged.
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

// Helper for the six paren-grouping productions (GroupedExpr,
// GroupedExprNoBlock, GroupedOpExpr, GroupedBareOpExpr,
// GroupedBareOpExprNoEmpty from §5; GroupedDoExpr from §9
// alongside BinaryAtom). All share the same structure: OpenParen +
// inner-expression + CloseParen + optional AsAnnotationExpr. Each
// shaper differs only in its type tag, so the per-production
// shaper is a one-line delegate.
//
// Surrounding parens are noise (recoverable from the type tag —
// every Grouped*Expr signals user-written parens). Inner expression
// promotes to `expr`. Optional `:as` tail unwraps onto `as` per
// the wrapper-unwrap-at-assignment convention.
//
// Parens are the only construct that still carries its own `:as`
// tail post-rework — they're atomic groups, so `:as` can attach
// regardless of position (including as a binary operand, as in
// `(x + y) :as int ~map f`).
function shapeGrouped(typeName,parts) {
	var expr, as;
	for (let p of parts) {
		if (isNode(p)) {
			if (p.type === "AsAnnotationExpr") as = p.annotation;
			else expr = p;
		}
		// else: OpenParen, CloseParen — skip
	}
	var node = { type: typeName, expr };
	if (as) node.as = as;
	return node;
}

// Helper for the six §9 binary tier iter productions (FlowBinExpr,
// OrBinExpr, AndBinExpr, CompareBinExpr, AddBinExpr, MulBinExpr).
// Each iter is `lhs (op rhs)+` — flat-fold to nested
// `{ left, op, right }` (left-associative).
//
// Parts arrive interleaved: [n1, opTok…, n2, opTok…, n3, …]. Runs
// of non-node tokens between nodes are accumulated into a single
// op string, handling multi-token ops:
//   - AddOp `$+` → Dollar + Plus (2 tokens)
//   - FlowOps `#>` / `+>` / `<+` → 2 tokens each
//   - FlowOp `~<` → Tilde + OpenAngle (2 tokens)
//   - SymbolicCompareOp `?<=>` → Qmark + OpenAngle + Equal + CloseAngle (4 tokens)
//   - Named/keyword ops (?and, ?or, ?in, ~map, etc.) → 1 BooleanOper or
//     Comprehension token
//
// FlowBinExpr's LHS may be a CondClause and RHS may be a BlockExpr
// (per §9's flow-tier extensions); both arrive as shaped nodes so
// the same accumulator pattern applies — no special-case needed.
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

// Helper for the two §8 unary productions (NamedUnaryExpr,
// SymbolicUnaryExpr). Both share `op _ BinaryAtom` shape. The op
// runs across leading non-node tokens (single token in practice:
// ?empty/!empty as BooleanOper, or Qmark/Exmark); `right` is the
// single operand node.
//
// No `:as` handling — unary productions lost their own
// `(_ AsAnnotationExpr)?` tail in the :as rework. Annotation
// comes via AsExpr (UnaryExpr is in <AsableExpr>); AsExpr's
// unwrap-shaper lifts `as` onto the returned unary node, so the
// resulting AST shape for `?x :as bool` is
// `SymbolicUnaryExpr{op:"?", right:Identifier{name:"x"}, as:"bool"}`.
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

export const defaultShapers = {

	// Identifier — bare token-stream extraction. Concatenates the
	// part values into a single `name` string. Used in binding
	// positions (DefVarStmt target, parameter names, DotIdentifier
	// inner, type-decl name, etc.) where no `:as` tail is grammatically
	// possible. The BareIdentifier shaper subsumes into this same
	// node type for reference-position identifiers — consumers see
	// a uniform Identifier shape regardless of whether the source
	// role was binding or reference.
	Identifier(frame,parts) {
		var name = "";
		for (let p of parts) name += p.value;
		return { type: "Identifier", name };
	},

	// BuiltIn — bare token-stream extraction. Same pattern as
	// Identifier: concat token values to `name`. Single-token in
	// practice (the production wraps one Builtin token), but the
	// loop form keeps the shape symmetric with Identifier and
	// robust to any future grammar widening.
	BuiltIn(frame,parts) {
		var name = "";
		for (let p of parts) name += p.value;
		return { type: "BuiltIn", name };
	},

	// PipelineTopic — bare token-stream extraction. Same pattern.
	// Wraps a single Hash token; `name` is the literal "#".
	PipelineTopic(frame,parts) {
		var name = "";
		for (let p of parts) name += p.value;
		return { type: "PipelineTopic", name };
	},

	// BareIdentifier — thin-wrapper sub-archetype. Subsumes into
	// its inner IdentBase node (Identifier, BuiltIn, or
	// PipelineTopic). The reference-vs-binding distinction lives
	// in the grammar (where it's load-bearing for parsing) but is
	// dropped from the AST surface — consumers see the underlying
	// IdentBase node directly.
	//
	// Post `:as` rework, BareIdentifier has no `:as` tail —
	// annotation comes via AsExpr (BareIdentifier is reachable
	// from <AsableExpr> via BareOperandExpr → BareOperandExprNoEmpty
	// → IdentifierExpr). AsExpr's unwrap lifts `as` onto the
	// returned IdentBase node, so `x :as int` still shapes to
	// `Identifier{name:"x", as:"int"}`.
	BareIdentifier(frame,parts) {
		return parts.find(isNode);
	},

	// AsAnnotationExpr — `:as` keyword (noise; recoverable from
	// the type tag) plus a NamedType promoted to `annotation`. Per
	// the wrapper-unwrap convention, parents that mount this at
	// their `.as` slot store `.annotation` directly rather than the
	// wrapper itself. The shaper still emits the wrapper node so
	// the production round-trips through default tooling; no
	// current parent retains it intact.
	AsAnnotationExpr(frame,parts) {
		return { type: "AsAnnotationExpr", annotation: parts.find(isNode) };
	},

	// AsExpr — the centralized `:as` carrier (§5). Grammar:
	//
	//   AsExpr        := <AsableExpr> _ AsAnnotationExpr;
	//   <AsableExpr>  := BlockExpr | GuardedExpr | UnaryExpr
	//                  | BareOperandExpr | GroupedOpExpr | GroupedDoExpr;
	//
	// Parse-time wrapper only — emits no node of its own. Unwraps
	// to the inner AsableExpr node, lifting `as: annotation` onto
	// it. Same pattern as BareIdentifier subsumption.
	//
	// Span: the machinery's unconditional start/end overwrite runs
	// AFTER this shaper returns, deriving span from the AsExpr
	// frame (leftmost-descendant start through AsAnnotationExpr's
	// rightmost-descendant end). That correctly extends the inner
	// node's `end` to cover the `:as TYPE` tail — exactly what we
	// want.
	//
	// No collision risk on `inner.as`: post-rework, no non-paren
	// inner sets its own `as`, so the lift is always a fresh slot
	// assignment. Paren productions carry their own `:as` and are
	// reached directly (not via AsExpr's outer level), so they
	// never appear as AsExpr's inner with a pre-existing `as`.
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

	// Literal — concatenates contained number/escape token values
	// into a single source-text string. No `:as` tail at the
	// grammar level — annotation comes via AsExpr.
	NumberLit(frame,parts) {
		var text = "";
		for (let p of parts) text += p.value;
		return { type: "NumberLit", text };
	},

	// Literal — boolean. Single Native token ("true" | "false").
	// Text is the raw lexeme, mirroring NumberLit. No `:as` tail.
	BooleanLit(frame,parts) {
		var text = "";
		for (let p of parts) text += p.value;
		return { type: "BooleanLit", text };
	},

	// Literal — empty. Type tag is total information; no `text`
	// field. No `:as` tail.
	EmptyLit(frame,parts) {
		return { type: "EmptyLit" };
	},

	// Literal — plain string. Concatenates interior String and
	// StringEscapedChar token values into `text`. Surrounding
	// DoubleQuotes are noise (recoverable from the type tag).
	// Escape sequences are preserved raw in `text` — interp's job
	// to resolve them. No `:as` tail.
	PlainStr(frame,parts) {
		var text = "";
		for (let p of parts) {
			if (isNode(p)) continue;
			if (p.type === "String" || p.type === "StringEscapedChar") {
				text += p.value;
			}
			// else: DoubleQuote — skip
		}
		return { type: "PlainStr", text };
	},

	// Literal — spacing-escaped string. Same shape as PlainStr;
	// additionally folds interior Whitespace tokens into `text`
	// verbatim (the production opts into preserveInnerDelim so the
	// whitespace tokens reach us in parts). Leading Escape and
	// surrounding DoubleQuotes are noise. No `:as` tail.
	SpacingEscapedStr(frame,parts) {
		var text = "";
		for (let p of parts) {
			if (isNode(p)) continue;
			if (
				p.type === "String" ||
				p.type === "StringEscapedChar" ||
				p.type === "Whitespace"
			) {
				text += p.value;
			}
			// else: Escape, DoubleQuote — skip
		}
		return { type: "SpacingEscapedStr", text };
	},

	// Interp slot inside the two interp-string forms. Surrounding
	// Backticks are noise; the inner expression is exposed as
	// `expr`. (Grammar: `InterpExpr := Backtick _ Expr _ Backtick;`
	// — `_` is delim, so parts is exactly [Backtick, exprNode,
	// Backtick].)
	InterpExpr(frame,parts) {
		var expr = parts.find(isNode);
		return { type: "InterpExpr", expr };
	},

	// Literal — interpolated string. Surfaces as a `chunks` array
	// alternating string text and InterpExpr nodes. Invariant:
	// chunks.length is always odd, chunks[0] and chunks[last] are
	// always strings (possibly ""). Consumers discriminate
	// elements via `typeof === "string"`. Leading Escape and
	// surrounding DoubleQuotes are noise. No `:as` tail.
	InterpStr(frame,parts) {
		var chunks = [];
		var buf = "";
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
			// else: Escape, DoubleQuote — skip
		}
		chunks.push(buf);
		return { type: "InterpStr", chunks };
	},

	// Literal — spacing-interpolated string. Same chunks-array
	// shape as InterpStr; Whitespace tokens fold into the
	// adjacent text chunk verbatim (preserveInnerDelim delivers
	// them in parts). No `:as` tail.
	SpacingInterpStr(frame,parts) {
		var chunks = [];
		var buf = "";
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
			// else: Escape, DoubleQuote — skip
		}
		chunks.push(buf);
		return { type: "SpacingInterpStr", chunks };
	},

	// Definition — `def` keyword and `:` colon are noise; the two
	// semantic children (target = Identifier|DestructureTarget,
	// init = Expr|ImportExpr) take named fields.
	DefVarStmt(frame,parts) {
		var nodes = parts.filter(isNode);
		var [ target, init ] = nodes;
		return { type: "DefVarStmt", target, init };
	},

	// Pure list-of-statements. Semicolons are noise; everything
	// shaped is a top-level statement node.
	Program(frame,parts) {
		var stmts = parts.filter(isNode);
		return { type: "Program", stmts };
	},

	// Compound with optional defs-init clause and required body
	// statements. With BlockDefsInitOpt and VarDefInitOpt now
	// visible, defs flows in as a single node.
	//
	// No `:as` tail post-rework — annotation comes via AsExpr
	// (BlockExpr is in <AsableExpr>). AsExpr's unwrap lifts `as`
	// onto the returned BlockExpr node, so `{x;y} :as int` still
	// shapes to `BlockExpr{stmts:[...], as:"int"}`.
	BlockExpr(frame,parts) {
		var defs;
		var stmts = [];
		for (let p of parts) {
			if (p.type === "BlockDefsInitOpt") defs = p;
			else if (isNode(p)) stmts.push(p);
		}
		var node = { type: "BlockExpr", stmts };
		if (defs) node.defs = defs;
		return node;
	},

	// =============================================================
	// Paren-grouping productions. Six structurally-identical
	// variants distinguished only by what inner-expression form
	// they accept (Expr | ExprNoBlock | OperandExpr | BareOperandExpr
	// | BareOperandExprNoEmpty | DoCompr/DoLoopCompr). Five live
	// in §5; GroupedDoExpr lives in §9 alongside BinaryAtom (lets
	// a do-compr appear as a binary operand). Each emits a node
	// whose type matches its production name — user-written parens
	// are preserved in the AST as a discrete node.
	//
	// All retain their own `(_ AsAnnotationExpr)?` tail post-rework
	// — parens are the sole exception to the centralized `:as` rule
	// because they're atomic groups that can carry `:as` regardless
	// of position (including as a binary operand). The four
	// restrictive paren inners (GroupedOpExpr, GroupedBareOpExpr,
	// GroupedBareOpExprNoEmpty, GroupedDoExpr) additionally accept
	// AsExpr as their first inner alt so that constructs like
	// `(?x :as bool)` parse correctly inside the parens.
	//
	// All delegate to shapeGrouped: drop parens, lift inner to
	// `expr`, unwrap optional :as onto `as`.
	// =============================================================
	GroupedExpr(frame,parts)              { return shapeGrouped("GroupedExpr",parts); },
	GroupedExprNoBlock(frame,parts)       { return shapeGrouped("GroupedExprNoBlock",parts); },
	GroupedOpExpr(frame,parts)            { return shapeGrouped("GroupedOpExpr",parts); },
	GroupedBareOpExpr(frame,parts)        { return shapeGrouped("GroupedBareOpExpr",parts); },
	GroupedBareOpExprNoEmpty(frame,parts) { return shapeGrouped("GroupedBareOpExprNoEmpty",parts); },
	GroupedDoExpr(frame,parts)            { return shapeGrouped("GroupedDoExpr",parts); },

	// Var-def, required init. Two semantic children: target
	// (Identifier or DestructureTarget) and init (ExprNoBlock).
	VarDefInit(frame,parts) {
		var [ target, init ] = parts.filter(isNode);
		return { type: "VarDefInit", target, init };
	},

	// Var-def, optional init. Same shape as VarDefInit but init
	// may be absent.
	VarDefInitOpt(frame,parts) {
		var [ target, init ] = parts.filter(isNode);
		var node = { type: "VarDefInitOpt", target };
		if (init) node.init = init;
		return node;
	},

	// Paren-bounded list of var-defs (required-init form).
	// Used by DefBlockStmt.
	BlockDefsInit(frame,parts) {
		return { type: "BlockDefsInit", entries: parts.filter(isNode) };
	},

	// Paren-bounded list of var-defs (optional-init form).
	// Used by BlockExpr.
	BlockDefsInitOpt(frame,parts) {
		return { type: "BlockDefsInitOpt", entries: parts.filter(isNode) };
	},

	// Comma-separated list of optional-init parameter defs.
	// Used by DefFuncExpr per paren-group.
	ParameterList(frame,parts) {
		return { type: "ParameterList", params: parts.filter(isNode) };
	},

	// =============================================================
	// Unary tier (§8). Two productions, prefix-unary shape, distinguished
	// only by op kind (named ?empty/!empty vs symbolic ?/!). Both go
	// through shapeUnaryTier. Operand is restricted to BinaryAtom
	// (tightest tier) per grammar — `?x + 5` parses as `(?x) + 5`.
	//
	// No `:as` tail post-rework — annotation comes via AsExpr
	// (UnaryExpr is in <AsableExpr>). AsExpr's unwrap lifts `as`
	// onto the unary node; see shapeUnaryTier's comment.
	//
	// Postfix `'` (the prime modifier) is NOT a unary form here —
	// it's a restricted tail of ChainExpr (§7), where it terminates
	// access and allows only call suffixes after.
	// =============================================================
	NamedUnaryExpr(frame,parts)    { return shapeUnaryTier("NamedUnaryExpr",parts); },
	SymbolicUnaryExpr(frame,parts) { return shapeUnaryTier("SymbolicUnaryExpr",parts); },

	// =============================================================
	// Binary tiers (§9). Seven productions ordered loosest →
	// tightest: FlowBinExpr, OrBinExpr, AndBinExpr,
	// TypeCompareBinExpr, CompareBinExpr, AddBinExpr, MulBinExpr.
	//
	// Six iter tiers share `lhs (op rhs)+` shape and delegate to
	// shapeBinTier — flat-fold to nested {left, op, right}
	// (left-associative), multi-token ops concatenated via the
	// token-accumulator pattern.
	//
	// TypeCompareBinExpr carves ?as/!as out of the Compare tier:
	// single-op (non-iter), RHS is a NamedType rather than an
	// expression. Distinct shape handler below.
	//
	// No tier carries its own `:as` tail. By design — `x + y :as int`
	// is a parse error per the first-class precedence rule, which
	// is enforced by AsExpr living at the dispatcher level above
	// the binary tiers (not inside BinaryAtom). To annotate a
	// binary expression, parenthesize: `(x + y) :as int`.
	// =============================================================
	FlowBinExpr(frame,parts)    { return shapeBinTier("FlowBinExpr",parts); },
	OrBinExpr(frame,parts)      { return shapeBinTier("OrBinExpr",parts); },
	AndBinExpr(frame,parts)     { return shapeBinTier("AndBinExpr",parts); },

	// TypeCompareBinExpr — single-op binary, RHS is NamedType (not
	// a general expression). Op is the single ?as/!as BooleanOper
	// token. Shape matches sibling iter tiers (`{ left, op, right }`)
	// for consumer uniformity; `right` carries a NamedType node.
	// No iteration — `x ?as int ?as bool` must be parenthesized
	// per grammar.
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

	// Dot-access by name or index. Three inner cases:
	//   foo.bar   → accessor = Identifier-node
	//   foo.List  → accessor = BuiltIn-node
	//   arr.5     → index = "5"
	//   arr.-1    → index = "-1"
	// `accessor` and `index` are mutually exclusive — the grammar
	// puts them in disjoint inner alternatives. Consumers branch
	// on which field is present to distinguish name lookup from
	// positional index. Integer text is preserved raw (no parse to
	// Number) so source fidelity is exact and signs are unambiguous.
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
			// else: Period — skip
		}
		return node;
	},

	// Bracket-access (`arr[expr]`). Brackets are noise; the inner
	// ExprNoBlock takes the `expr` field.
	BracketExpr(frame,parts) {
		return { type: "BracketExpr", expr: parts.find(isNode) };
	},

	// Range-access (`arr.[1..5]`). Period and brackets are noise;
	// the inner RangeExpr (ClosedRangeExpr | LeadingRangeExpr |
	// TrailingRangeExpr — each its own type tag once shaped) takes
	// the `range` field.
	DotBracketExpr(frame,parts) {
		return { type: "DotBracketExpr", range: parts.find(isNode) };
	},

	// Angle-property access (`rec.<a,b,5>`). List of property
	// accessors; each element is either { accessor: Identifier-node }
	// or { index: "<digits>" } (positive-only here, per the §6
	// PropertyExpr grammar). Mirrors DotIdentifier's discriminator
	// pattern. Period, OpenAngle, CloseAngle, Comma are noise;
	// EscapePlain (the optional `\` prefix on integer accessors)
	// is also dropped — its role is purely tokenizer-side
	// disambiguation, no semantic content.
	DotAngleExpr(frame,parts) {
		var properties = [];
		for (let p of parts) {
			if (isNode(p)) {
				properties.push({ accessor: p });
			}
			else if (p.type === "PositiveIntegerLit") {
				properties.push({ index: p.value });
			}
			// else: Period, OpenAngle, CloseAngle, Comma, EscapePlain — skip
		}
		return { type: "DotAngleExpr", properties };
	},

	// List of access segments used by special contexts
	// (AssignmentExpr LHS, AtExpr internal access, ExportNamedBinding,
	// DestructureNamedDef) — NOT by ChainExpr, which folds its
	// segments into typed nested nodes. Each segment is a
	// DotIdentifier or BracketExpr; already type-tagged, just
	// collected.
	SingleAccessExpr(frame,parts) {
		return { type: "SingleAccessExpr", segments: parts.filter(isNode) };
	},

	// Same shape as SingleAccessExpr with a broader segment alphabet
	// (adds DotBracketExpr, DotAngleExpr). Used by MultiAccessSeg
	// contexts.
	MultiAccessExpr(frame,parts) {
		return { type: "MultiAccessExpr", segments: parts.filter(isNode) };
	},

	// =============================================================
	// At-cluster (§6 IdentifierExpr + §7 CallExpr).
	//
	// MonadConstructor — bare `@`. Type tag is total information.
	//
	// AtExpr — `IdentBase SingleAccessExpr? At`. Shape `{ base }`,
	// where `base` is folded via the unified access-fold rule (see
	// foldAccess above): bare `foo@` → `AtExpr{ base: Identifier{
	// name:"foo"} }`; access form `foo.bar@` → `AtExpr{ base:
	// MemberAccessExpr{ object: Identifier{name:"foo"}, accessor:
	// Identifier{name:"bar"} } }`. So the access portion of an at-
	// expression shapes identically to the same access appearing in
	// operand position — no separate `access` slot to special-case.
	// The `@` itself is noise (recoverable from type tag).
	//
	// Neither carries a `:as` tail post-rework — annotation comes
	// via AsExpr. AsExpr's unwrap lifts `as` onto the returned
	// AtExpr/MonadConstructor node.
	// =============================================================

	// AtExpr — IdentBase + optional access + @. Access folds into base.
	AtExpr(frame,parts) {
		var base, access;
		for (let p of parts) {
			if (isNode(p)) {
				if (p.type === "SingleAccessExpr") access = p;
				else base = p;
			}
			// else: At token — skip
		}
		return { type: "AtExpr", base: foldAccess(base,access) };
	},

	// MonadConstructor — bare @.
	MonadConstructor(frame,parts) {
		// All parts are the At token; nothing semantic to collect.
		return { type: "MonadConstructor" };
	},

	// Range — closed form (`x..y`). Two operands `from`/`to`. No
	// `:as` per grammar (must parenthesize: `(x..y) :as T`) — the
	// trailing-position RangeOperand would otherwise greedily
	// absorb `:as`, and ranges are deliberately omitted from
	// <AsableExpr> as well, making `1..5 :as List` a parse error.
	ClosedRangeExpr(frame,parts) {
		var [ from, to ] = parts.filter(isNode);
		return { type: "ClosedRangeExpr", from, to };
	},

	// Range — leading-open form (`x..`). Single operand, no `:as`
	// per grammar.
	LeadingRangeExpr(frame,parts) {
		return { type: "LeadingRangeExpr", from: parts.find(isNode) };
	},

	// Range — trailing-open form (`..y`). Single operand, no `:as`
	// per grammar.
	TrailingRangeExpr(frame,parts) {
		return { type: "TrailingRangeExpr", to: parts.find(isNode) };
	},

	// OpFuncExpr — op-as-function-value. Four inner forms (per the
	// grammar's disjoint alternatives), surfaced via three
	// mutually-exclusive payload fields:
	//
	//   (+) / (..)   → op: "<text>"   (bare operator, possibly
	//                                  multi-token e.g. "$+")
	//   ([])         → op: "[]"       (empty-collection op;
	//                                  brackets are the operator)
	//   (.<a,b,5>)   → properties     (unwrapped from DotAngleExpr —
	//                                  parameterizes the angle-pick op)
	//   (.[1..5])    → range          (unwrapped from DotBracketExpr —
	//                                  parameterizes the range-access op)
	//
	// Optional `primed: true` (the `'` modifier). Surrounding
	// parens are noise. No `:as` tail post-rework — annotation
	// comes via AsExpr (OpFuncExpr is reachable from <AsableExpr>
	// via BareOperandExpr → BareOperandExprNoEmpty).
	//
	// The DotAngleExpr / DotBracketExpr inner forms are unwrapped
	// to their semantic payload — in this context they don't
	// represent access against an object, they parameterize an
	// op-as-function with a property list or range. Same
	// wrapper-unwrap convention as AsAnnotationExpr.
	//
	// MATCHES the synthetic OpFuncExpr created by
	// PrefixCallSuffix's bare-op shortcut normalization, so
	// `foo(+')` and `foo((+)')` produce identical args[0] shapes.
	OpFuncExpr(frame,parts) {
		var node = { type: "OpFuncExpr" };
		var opText = "";
		var sawBrackets = false;
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
				// call-form delimiters — skip
			}
			else if (p.type === "OpenBracket" || p.type === "CloseBracket") {
				// empty-bracket form
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
		return node;
	},

	// Call suffix — prefix form (`(arg1, arg2)` or the bare-op
	// shortcut `(+)` / `(+')`). CallArgs has two arms gated by
	// lookahead: the first arm `(Op SingleQuote? &(CloseParen))`
	// only fires when the closing delimiter is `)`, so the bare-Op
	// form is reachable here but not in PartialCallSuffix. Op is
	// hidden — its terminal content splices directly into parts
	// and accumulates into the synthetic OpFuncExpr's `op` field.
	//
	// The bare-op shortcut `foo(+')` is semantically identical to
	// the explicit form `foo((+)')` — both pass an op-as-function
	// as a single argument. This shaper normalizes the shortcut
	// into an `args` array containing a synthetic OpFuncExpr,
	// matching the explicit form's eventual shape. CallExpr (built
	// from this segment by ChainExpr's fold) then has uniform
	// `{ callee, args }` regardless of which source form was used.
	//
	// Position tracking on the synthetic OpFuncExpr: opStart is the
	// first Op token's start, opEnd is the last Op token's end (or
	// the SingleQuote token's end when primed). Real positions —
	// these are synthetic to the AST surface but the underlying
	// tokens are real.
	PrefixCallSuffix(frame,parts) {
		var args = [];
		var op = "";
		var opStart, opEnd;
		var primed = false;
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
				// structural delimiter — skip
			}
			else {
				// Op-form: accumulate operator token text and span
				if (op === "") opStart = p.start;
				if (!primed) opEnd = p.end;
				op += p.value;
			}
		}
		// Synthesize an OpFuncExpr arg for the bare-op shortcut.
		// `args` is grammatically empty in the op-form (per the
		// &(CloseParen) lookahead), so this never collides with
		// regular-form args.
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
		return { type: "PrefixCallSuffix", args };
	},

	// Call suffix — partial form (`|arg1, arg2|`). Unlike
	// PrefixCallSuffix, the CallArgs bare-Op arm doesn't reach this
	// production — its `&(CloseParen)` lookahead fails on the `|`
	// closer. Op-as-argument inside a partial-suffix must be
	// parenthesized (e.g. `foo|(+)|`), arriving as an OpFuncExpr
	// node in `args`. No `op` or `primed` fields.
	//
	// NOTE: when this segment is consumed by ChainExpr's fold, it
	// becomes a PartialCallExpr — see applyChainSeg above.
	PartialCallSuffix(frame,parts) {
		var args = [];
		for (let p of parts) {
			if (isNode(p)) args.push(p);
			// else: Pipe, Comma — skip
		}
		return { type: "PartialCallSuffix", args };
	},

	// =============================================================
	// AtCallExpr — at-form applied to (optionally) an argument. The
	// grammar has two arms:
	//
	//   Arm 1: "None" At
	//   Arm 2: (AtExpr | (IdentBase SingleAccessExpr? _ At) | MonadConstructor)
	//          _ ExprNoBlock
	//
	// Arm 2 has three sub-forms: pre-shaped AtExpr (no trivia between
	// IdentBase and @), inline IdentBase+access+@ (trivia-tolerant
	// equivalent), or pre-shaped MonadConstructor (bare @).
	//
	// Normalizes to a uniform shape `{ callee, arg? }`:
	//
	//   - Arm 1 (`None@`): synthesize an AtExpr with a BuiltIn("None")
	//     base. No arg.
	//   - Arm 2, AtExpr sub-form: callee = the pre-shaped AtExpr.
	//   - Arm 2, IdentBase+access+@ sub-form: synthesize an AtExpr
	//     from the spliced parts (trivia-tolerance is a parsing
	//     concern, not an AST concern).
	//   - Arm 2, MonadConstructor sub-form: callee = the pre-shaped
	//     MonadConstructor.
	//
	// Consumers branch on `callee.type` (AtExpr vs MonadConstructor)
	// to discriminate base-bearing vs bare-@ calls. The Arm 1 vs
	// Arm 2 distinction surfaces as `arg`-presence.
	//
	// No `:as` tail post-rework — annotation comes via AsExpr
	// (AtCallExpr is reachable from <AsableExpr> via BareOperandExpr
	// → BareOperandExprNoEmpty → CallExpr).
	//
	// Discrimination on parts[0]:
	//   - Builtin token → Arm 1
	//   - AtExpr node → Arm 2 sub-form A
	//   - MonadConstructor node → Arm 2 sub-form C
	//   - any other node (Identifier|BuiltIn|PipelineTopic) → Arm 2 sub-form B
	// =============================================================
	AtCallExpr(frame,parts) {
		var node = { type: "AtCallExpr" };
		var first = parts[0];

		if (!isNode(first)) {
			// Arm 1: `None@`. parts is [Builtin-tok("None"), At-tok].
			let atTok;
			for (let p of parts) {
				if (!isNode(p) && p.type === "At") atTok = p;
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
			// No arg for Arm 1.
		}
		else if (
			first.type === "AtExpr" ||
			first.type === "MonadConstructor"
		) {
			// Arm 2 sub-forms A and C: callee is pre-shaped.
			node.callee = first;
			for (let p of parts.slice(1)) {
				if (isNode(p)) node.arg = p;
			}
		}
		else {
			// Arm 2 sub-form B: IdentBase + ?SingleAccessExpr + At-tok + ExprNoBlock.
			// Synthesize an AtExpr from the spliced parts.
			let base = first;
			let access, arg, atTok;
			for (let p of parts.slice(1)) {
				if (isNode(p)) {
					if (p.type === "SingleAccessExpr") access = p;
					else arg = p;
				}
				else if (p.type === "At") atTok = p;
			}
			node.callee = {
				type: "AtExpr",
				base: foldAccess(base,access),
				start: base.start,
				end: atTok.end,
			};
			if (arg) node.arg = arg;
		}

		return node;
	},

	// Chain — base + ordered segments folded into JS-style nested
	// typed nodes. Each segment wraps the previous expression;
	// outermost = last applied. Single-segment cases unwrap
	// directly to the typed node (no degenerate single-element
	// wrapper). ChainExpr itself emits no node — it's a parse
	// vehicle only.
	//
	// Postfix `'` (prime, the SingleQuote token) wraps the pre-
	// prime expression in a PrimedExpr; any post-prime call
	// suffixes then apply on top of that wrapper.
	//
	// No `:as` tail post-rework — annotation comes via AsExpr
	// (ChainExpr is reachable from <AsableExpr> via BareOperandExpr
	// → BareOperandExprNoEmpty → CallExpr). AsExpr's unwrap lifts
	// `as` onto whatever outermost typed node ChainExpr's fold
	// produces (CallExpr, MemberAccessExpr, PrimedExpr, etc.) —
	// semantically annotates the whole chained value, as before.
	//
	// Segment-to-typed-node mappings live in applyChainSeg above.
	//
	// All intermediate folds set start/end explicitly — machinery
	// only stamps the outermost return.
	ChainExpr(frame,parts) {
		var base;
		var preSegs = [];
		var postPrimeSegs = [];
		var primeTokEnd;
		for (let p of parts) {
			if (!isNode(p)) {
				// SingleQuote — the prime operator. Capture end
				// position for PrimedExpr's span.
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
	// §14 CONDITIONALS / GUARDS
	// =============================================================

	// CondClause := (Qmark | Exmark) BracketExpr;
	//
	// Polarity (`?` or `!`) is required — the production guarantees
	// one. BracketExpr is kept as a nested node rather than unwrapped
	// to its inner expr; BracketExpr already surfaces in the AST in
	// other contexts (e.g. DestructureNamedDef's BracketExpr arm),
	// so this shape stays uniform across roles. The `test` field name
	// conveys the semantic role; the BracketExpr type tag conveys the
	// syntactic shape (`[...]`).
	//
	// Used at three call sites with the same shape:
	//   - GuardedExpr (§14)        — as `clause`
	//   - FuncPrecond (§13)        — as `clause` (default-shape today)
	//   - FlowBinExpr LHS (§9)     — as `left` via shapeBinTier
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
	// Colon is noise (recoverable from the type tag — every
	// GuardedExpr has a `:` between clause and consequent). The
	// CondClause shapes per its own shaper above; the inner Expr
	// fills `consequent`.
	//
	// No `:as` handling — GuardedExpr is in <AsableExpr>, so
	// annotation comes via AsExpr's unwrap, which lifts `as` onto
	// the returned GuardedExpr from the outside.
	//
	// Field name `consequent` (not `body`): "body" is associated
	// with blocks/functions; "consequent" is the natural term for
	// the branch of a conditional, and lines up with what
	// MatchConsequent will produce in §15.
	GuardedExpr(frame,parts) {
		var clause;
		var consequent;
		for (let p of parts) {
			if (isNode(p)) {
				if (p.type === "CondClause") clause = p;
				else consequent = p;
			}
			// else: Colon — skip
		}
		return { type: "GuardedExpr", clause, consequent };
	},

	// =============================================================
	// §13 FUNCTION DEFINITIONS
	// =============================================================

	// GatherParameter := Star Identifier;
	//
	// Flattened: name is the bare string, not an Identifier node.
	// Convention: monomorphic-Identifier slots use a string `name`;
	// polymorphic slots (Identifier | DestructureTarget, etc.) use a
	// node `target`. The parent's type (GatherParameter) implies the
	// slot semantics, so the Identifier wrapper is redundant.
	GatherParameter(frame,parts) {
		var inner = parts.find(isNode);
		return { type: "GatherParameter", name: inner.name };
	},

	// FuncPrecond := CondClause _ Colon _ ExprNoBlock;
	//
	// Same shape as GuardedExpr (§14) — { clause, consequent }.
	// The two productions differ only in body restriction (Expr vs.
	// ExprNoBlock); from the consumer surface they're uniform.
	FuncPrecond(frame,parts) {
		var clause;
		var consequent;
		for (let p of parts) {
			if (isNode(p)) {
				if (p.type === "CondClause") clause = p;
				else consequent = p;
			}
			// else: Colon — skip
		}
		return { type: "FuncPrecond", clause, consequent };
	},

	// FuncOverClause := ":over" _ OpenParen _ Identifier (_ Comma _ Identifier)* _ CloseParen;
	//
	// Wrapper around an identifier list. DefFuncExpr unwraps to
	// `over: names` at the slot assignment — mirrors AsAnnotationExpr
	// / FuncAsClause unwrap pattern. Wrapper still emits a node for
	// completeness; parents reach through.
	FuncOverClause(frame,parts) {
		var names = [];
		for (let p of parts) {
			if (isNode(p)) names.push(p);
			// else: Keyword(:over), OpenParen, CloseParen, Comma — skip
		}
		return { type: "FuncOverClause", names };
	},

	// FuncAsClause := ":as" _ Identifier;
	//
	// Mirrors AsAnnotationExpr — wrapper around the annotation.
	// DefFuncExpr unwraps to `as: annotation` at slot assignment.
	// Note: the `as` field on DefFuncExpr carries an Identifier
	// node (per the grammar — FuncAsClause is NOT AsAnnotationExpr),
	// whereas `as` elsewhere via AsExpr-unwrap carries a NamedType.
	// Consumers branch on `.type` if they care which.
	FuncAsClause(frame,parts) {
		return { type: "FuncAsClause", annotation: parts.find(isNode) };
	},

	// ReturnExpr := Caret _ Expr;
	//
	// Caret is noise (recoverable from type tag). The inner Expr
	// promotes to `expr` — generic inner-expression convention
	// (same as paren-wrap, index-access, etc.).
	ReturnExpr(frame,parts) {
		return { type: "ReturnExpr", expr: parts.find(isNode) };
	},

	// FuncBodyExpr := Caret _ (ExprNoBlock | GroupedExpr);
	//
	// `body` field, not `expr` — body is the natural term for a
	// function body, and lines up with FuncBodyBlock/FuncBodyPipeline
	// (which also use `body`). The three FuncBody* shapers expose a
	// uniform discriminator: parent reads `.type` to learn the form,
	// `.body`/`.stmts` to access content.
	FuncBodyExpr(frame,parts) {
		return { type: "FuncBodyExpr", body: parts.find(isNode) };
	},

	// FuncBodyPipeline := PipelineOp _ (BlockExpr | ExprNoBlock | GroupedExpr);
	//
	// Multi-token op (e.g. `#>` = Hash + CloseAngle) concatenates
	// into the op string — same pattern as binary tier ops. Body is
	// the trailing node.
	FuncBodyPipeline(frame,parts) {
		var op = "";
		var body;
		for (let p of parts) {
			if (isNode(p)) body = p;
			else op += p.value;
		}
		return { type: "FuncBodyPipeline", op, body };
	},

	// FuncBodyBlock := OpenBrace _ FuncBodyStmts _ CloseBrace;
	//
	// FuncBodyStmts is hidden, so its child FuncBodyStmt nodes
	// (ReturnExpr | Stmt) bubble up directly. Braces and semicolons
	// are noise. Mirrors BlockExpr's stmts-collect pattern.
	FuncBodyBlock(frame,parts) {
		var stmts = [];
		for (let p of parts) {
			if (isNode(p)) stmts.push(p);
			// else: OpenBrace, CloseBrace, Semicolons — skip
		}
		return { type: "FuncBodyBlock", stmts };
	},

	// DefFuncExpr := "defn" (_ Identifier At?)?
	//                (_ OpenParen _ (ParameterList | GatherParameter)? _ CloseParen)+
	//                (_ FuncPrecondList)? (_ FuncOverClause)? (_ FuncAsClause)?
	//                _ FuncBody;
	//
	// State-machine shaper — the most complex in the file. The
	// only state needed is which paren-pair we're currently inside
	// (for synthesizing an empty ParameterList when the pair has
	// no inner). All other dispatch is by node-type alone since
	// each post-paren clause type is unique.
	//
	// Output shape:
	//   {
	//     type: "DefFuncExpr",
	//     name?: Identifier,                    // omit when anonymous
	//     at?: true,                            // omit when no @
	//     paramSets: [ParameterList|GatherParameter, ...],  // ≥1 entry
	//     preconditions?: [FuncPrecond, ...],   // omit when empty
	//     over?: [Identifier, ...],             // omit when absent
	//     as?: Identifier,                      // omit when absent
	//     body: FuncBodyExpr|FuncBodyPipeline|FuncBodyBlock,
	//   }
	//
	// Empty paren-pair `()` synthesizes a ParameterList with
	// `params: []` and a zero-length span (start: openParen.end+1,
	// end: openParen.end). The synthesized node is honest about
	// being a ParameterList — consumers can branch uniformly on
	// `paramSets[i].type` without a null check.
	//
	// FuncPrecondList is hidden, so its FuncPrecond children bubble
	// up directly into parts. FuncOverClause and FuncAsClause unwrap
	// to their payload fields at slot assignment (`over: p.names`,
	// `as: p.annotation`) per the wrapper-unwrap convention.
	//
	// No `:as` handling for AsExpr — DefFuncExpr is NOT in
	// <AsableExpr>; its `:as` is the dedicated FuncAsClause grammar
	// path, distinct from AsAnnotationExpr.
	DefFuncExpr(frame,parts) {
		var name, at, over, as, body;
		var paramSets = [];
		var preconditions = [];

		var lastOpenParen = null;  // OpenParen tok while between Open and Close
		var currentSet = null;     // inner node of the current paren-pair

		for (let p of parts) {
			if (!isNode(p)) {
				if (p.type === "Keyword" && p.value === "defn") continue;
				if (p.type === "At") { at = true; continue; }
				if (p.type === "OpenParen") {
					lastOpenParen = p;
					currentSet = null;
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
							end:   lastOpenParen.end,
						});
					}
					lastOpenParen = null;
					continue;
				}
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
		return node;
	},


	// =============================================================
	// §3 IMPORTS
	// =============================================================

	// ImportExpr := "import" _ PlainStr;
	//
	// Keyword "import" is noise. The PlainStr node is kept intact —
	// its own `.text` field carries the import target string; the
	// wrapping node retains span info covering the quotes.
	//
	// Field name `from` matches the literal source-form
	// (`def x: import "..."` reads "from a source"); also lines up
	// with ES-module-style mental model.
	ImportExpr(frame,parts) {
		return { type: "ImportExpr", from: parts.find(isNode) };
	},

	// =============================================================
	// §11 DEF-BLOCK STATEMENT
	// =============================================================

	// DefBlockStmt := "def" _ BlockDefsInit _ <BareBlockExpr>;
	//
	// Field names `defs` + `stmts` mirror BlockExpr for consumer
	// uniformity. Difference vs BlockExpr: `defs` is REQUIRED here
	// (BlockDefsInit, not the Opt variant) — always present, no
	// omission. <BareBlockExpr> is hidden, so OpenBrace, Semicolons,
	// and CloseBrace bubble up directly into parts; the
	// BlockDefsInit child sits alongside stmt nodes and is
	// identified by its type tag.
	//
	// "def" keyword and structural delimiters (braces, semicolons)
	// are noise (recoverable from the type tag).
	DefBlockStmt(frame,parts) {
		var defs;
		var stmts = [];
		for (let p of parts) {
			if (p.type === "BlockDefsInit") defs = p;
			else if (isNode(p)) stmts.push(p);
			// else: KwDef, OpenBrace, CloseBrace, Semicolons — skip
		}
		return { type: "DefBlockStmt", defs, stmts };
	},

	// =============================================================
	// §12 ASSIGNMENT
	// =============================================================

	// AssignmentExpr := ((IdentBase SingleAccessExpr) | Identifier) _ Colon Equal _ Expr;
	//
	// Shape `{ target, source }`. The LHS folds via the unified
	// access-fold rule (see foldAccess above): bare-arm LHS is the
	// raw IdentBase node; access-arm LHS becomes the same nested
	// MemberAccessExpr / IndexAccessExpr chain that ChainExpr
	// produces in operand position. So `foo.bar := 5` and the
	// operand-position expression `foo.bar` share an identical
	// shape for the access chain — only the outer node type
	// differs.
	//
	// `:` and `=` (the two tokens of `:=`) are noise. No `:as` tail
	// per grammar — parenthesize to annotate.
	//
	// Parts layout (after node-filter):
	//   - Bare arm:   [ Identifier-node,            Expr-node ]
	//   - Access arm: [ IdentBase-node, AccessNode, Expr-node ]
	// The middle node (when present) is always SingleAccessExpr.
	AssignmentExpr(frame,parts) {
		var nodes = parts.filter(isNode);
		var base, access, source;
		if (nodes.length === 2) {
			[ base, source ] = nodes;
		}
		else {
			[ base, access, source ] = nodes;
		}
		return {
			type: "AssignmentExpr",
			target: foldAccess(base,access),
			source,
		};
	},

	// =============================================================
	// §18 TYPE DEFINITION
	// =============================================================

	// DefTypeStmt := "deft" _ Identifier _ TypeExpr;
	//
	// Shape `{ name, decl }`. `decl` (declaration) holds whichever
	// type-tagged node TypeExpr resolves to — FuncTypeExpr,
	// UnionTypeExpr, NamedType, NestedTypeExpr, DataStructTypeExpr,
	// GroupedTypeExpr, or a leaf literal (EmptyLit / NumberLit /
	// PlainStr / BooleanLit). All §18 productions are currently on
	// default shape, but their type tags survive, so consumers can
	// branch on `decl.type`.
	//
	// `name` is the Identifier node (mirrors DefFuncExpr.name —
	// keep node for span/source-fidelity; the GatherParameter
	// flatten-to-string convention is reserved for adjacency-
	// marked names where the wrapper is purely structural).
	// "deft" keyword is noise.
	DefTypeStmt(frame,parts) {
		var [ name, decl ] = parts.filter(isNode);
		return { type: "DefTypeStmt", name, decl };
	},
};
