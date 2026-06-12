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
// SymbolicUnaryExpr). Both share `op _ BinaryAtom (_ AsAnnotationExpr)?`
// shape. The op runs across leading non-node tokens (single token
// in practice: ?empty/!empty as BooleanOper, or Qmark/Exmark);
// `right` is the single operand node; optional `:as` unwraps.
//
// Field naming: `{ op, right, as? }` — `right` for positional
// symmetry with shapeBinTier's `{ left, op, right }`; unary is
// just a binary with `left` absent.
function shapeUnaryTier(typeName,parts) {
	var op = "";
	var right;
	var as;
	for (let p of parts) {
		if (isNode(p)) {
			if (p.type === "AsAnnotationExpr") as = p;
			else right = p;
		}
		else {
			op += p.value;
		}
	}
	var node = { type: typeName, op, right };
	if (as) node.as = as.annotation;
	return node;
}

export const defaultShapers = {

	// Identifier — bare token-stream extraction. Concatenates the
	// part values into a single `name` string. Used in binding
	// positions (DefVarStmt target, parameter names, DotIdentifier
	// inner, type-decl name, etc.) where no `:as` tail is grammatically
	// possible. The BareIdentifier shaper subsumes into this same
	// node type for reference-position identifiers, optionally
	// adding an `as` field — so consumers see a uniform Identifier
	// shape regardless of whether the source role was binding or
	// reference.
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
	// PipelineTopic), optionally annotating with `:as`. The
	// reference-vs-binding distinction lives in the grammar (where
	// it's load-bearing for parsing) but is dropped from the AST
	// surface — consumers see the underlying IdentBase node
	// directly. The machinery's unconditional start/end overwrite
	// extends the returned node's span through any `:as` tail,
	// which is what we want.
	BareIdentifier(frame,parts) {
		var inner, as;
		for (let p of parts) {
			if (p.type === "AsAnnotationExpr") as = p;
			else if (isNode(p)) inner = p;
		}
		if (as) inner.as = as.annotation;
		return inner;
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

	// Literal — concatenates contained number/escape token values
	// into a single source-text string. Optional :as tail becomes
	// an optional `as` field.
	NumberLit(frame,parts) {
		var text = "";
		var as;
		for (let p of parts) {
			if (p.type === "AsAnnotationExpr") as = p;
			else text += p.value;
		}
		var node = { type: "NumberLit", text };
		if (as) node.as = as.annotation;
		return node;
	},

	// Literal — boolean. Single Native token ("true" | "false")
	// plus optional :as. Text is the raw lexeme, mirroring NumberLit.
	BooleanLit(frame,parts) {
		var text;
		var as;
		for (let p of parts) {
			if (isNode(p)) as = p;
			else text = p.value;
		}
		var node = { type: "BooleanLit", text };
		if (as) node.as = as.annotation;
		return node;
	},

	// Literal — empty. Type tag is total information; no `text`
	// field. Optional :as tail becomes an optional `as` field.
	EmptyLit(frame,parts) {
		var as = parts.find(isNode);
		var node = { type: "EmptyLit" };
		if (as) node.as = as.annotation;
		return node;
	},

	// Literal — plain string. Concatenates interior String and
	// StringEscapedChar token values into `text`. Surrounding
	// DoubleQuotes are noise (recoverable from the type tag).
	// Escape sequences are preserved raw in `text` — interp's job
	// to resolve them.
	PlainStr(frame,parts) {
		var text = "";
		var as;
		for (let p of parts) {
			if (isNode(p)) {
				if (p.type === "AsAnnotationExpr") as = p;
			}
			else if (p.type === "String" || p.type === "StringEscapedChar") {
				text += p.value;
			}
			// else: DoubleQuote — skip
		}
		var node = { type: "PlainStr", text };
		if (as) node.as = as.annotation;
		return node;
	},

	// Literal — spacing-escaped string. Same shape as PlainStr;
	// additionally folds interior Whitespace tokens into `text`
	// verbatim (the production opts into preserveInnerDelim so the
	// whitespace tokens reach us in parts). Leading Escape and
	// surrounding DoubleQuotes are noise.
	SpacingEscapedStr(frame,parts) {
		var text = "";
		var as;
		for (let p of parts) {
			if (isNode(p)) {
				if (p.type === "AsAnnotationExpr") as = p;
			}
			else if (
				p.type === "String" ||
				p.type === "StringEscapedChar" ||
				p.type === "Whitespace"
			) {
				text += p.value;
			}
			// else: Escape, DoubleQuote — skip
		}
		var node = { type: "SpacingEscapedStr", text };
		if (as) node.as = as.annotation;
		return node;
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
	// surrounding DoubleQuotes are noise.
	InterpStr(frame,parts) {
		var chunks = [];
		var buf = "";
		var as;
		for (let p of parts) {
			if (isNode(p)) {
				if (p.type === "InterpExpr") {
					chunks.push(buf);
					chunks.push(p);
					buf = "";
				}
				else if (p.type === "AsAnnotationExpr") {
					as = p;
				}
			}
			else if (p.type === "String" || p.type === "StringEscapedChar") {
				buf += p.value;
			}
			// else: Escape, DoubleQuote — skip
		}
		chunks.push(buf);
		var node = { type: "InterpStr", chunks };
		if (as) node.as = as.annotation;
		return node;
	},

	// Literal — spacing-interpolated string. Same chunks-array
	// shape as InterpStr; Whitespace tokens fold into the
	// adjacent text chunk verbatim (preserveInnerDelim delivers
	// them in parts).
	SpacingInterpStr(frame,parts) {
		var chunks = [];
		var buf = "";
		var as;
		for (let p of parts) {
			if (isNode(p)) {
				if (p.type === "InterpExpr") {
					chunks.push(buf);
					chunks.push(p);
					buf = "";
				}
				else if (p.type === "AsAnnotationExpr") {
					as = p;
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
		var node = { type: "SpacingInterpStr", chunks };
		if (as) node.as = as.annotation;
		return node;
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

	// Compound with optional defs-init clause, required body
	// statements, optional :as tail. With BlockDefsInitOpt and
	// VarDefInitOpt now visible, defs flows in as a single node.
	BlockExpr(frame,parts) {
		var defs, as;
		var stmts = [];
		for (let p of parts) {
			if (p.type === "BlockDefsInitOpt") defs = p;
			else if (p.type === "AsAnnotationExpr") as = p;
			else if (isNode(p)) stmts.push(p);
		}
		var node = { type: "BlockExpr", stmts };
		if (defs) node.defs = defs;
		if (as) node.as = as.annotation;
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
	// MonadConstructor — bare `@`. Type tag is total information;
	// only optional `:as` carries data.
	//
	// AtExpr — `IdentBase SingleAccessExpr? At (_ AsAnnotationExpr)?`.
	// Shape `{ base, access?, as? }`. The `@` itself is noise
	// (recoverable from type tag). `base` is the identifier being
	// lifted; `access` retains the SingleAccessExpr node intact
	// (not unwrapped — SingleAccessExpr is reused in non-AtExpr
	// contexts so consumers expect the wrapper layer).
	// =============================================================

	// AtExpr — IdentBase + optional access + @, optional :as.
	AtExpr(frame,parts) {
		var base, access, as;
		for (let p of parts) {
			if (isNode(p)) {
				if (p.type === "AsAnnotationExpr") as = p;
				else if (p.type === "SingleAccessExpr") access = p;
				else base = p;
			}
			// else: At token — skip
		}
		var node = { type: "AtExpr", base };
		if (access) node.access = access;
		if (as) node.as = as.annotation;
		return node;
	},

	// MonadConstructor — bare @, optional :as.
	MonadConstructor(frame,parts) {
		var as;
		for (let p of parts) {
			if (isNode(p) && p.type === "AsAnnotationExpr") as = p;
			// else: At token — skip
		}
		var node = { type: "MonadConstructor" };
		if (as) node.as = as.annotation;
		return node;
	},

	// Range — closed form (`x..y`). Two operands `from`/`to`. No
	// `:as` per grammar (must parenthesize: `(x..y) :as T`) — the
	// trailing-position RangeOperand would otherwise greedily
	// absorb `:as` via its own inner literal, same family as
	// BinaryExpr's exclusion.
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
	// Optional `primed: true` (the `'` modifier) and optional `as`
	// (NamedType, wrapper-unwrapped per convention). Surrounding
	// parens are noise.
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
		var as;
		var opText = "";
		var sawBrackets = false;
		for (let p of parts) {
			if (isNode(p)) {
				if (p.type === "AsAnnotationExpr") {
					as = p;
				}
				else if (p.type === "DotAngleExpr") {
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
		if (as) node.as = as.annotation;
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
	//   Arm 1: "None" At (_ AsAnnotationExpr)?
	//   Arm 2: (AtExpr | (IdentBase SingleAccessExpr? _ At) | MonadConstructor)
	//          _ ExprNoBlock (_ AsAnnotationExpr)?
	//
	// Arm 2 has three sub-forms: pre-shaped AtExpr (no trivia between
	// IdentBase and @), inline IdentBase+access+@ (trivia-tolerant
	// equivalent), or pre-shaped MonadConstructor (bare @).
	//
	// Normalizes to a uniform shape `{ callee, arg?, as? }`:
	//
	//   - Arm 1 (`None@`): synthesize an AtExpr with a BuiltIn("None")
	//     base. No arg.
	//   - Arm 2, AtExpr sub-form: callee = the pre-shaped AtExpr
	//     (preserves its own internal :as, if any).
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
	// Discrimination on parts[0]:
	//   - Builtin token → Arm 1
	//   - AtExpr node → Arm 2 sub-form A
	//   - MonadConstructor node → Arm 2 sub-form C
	//   - any other node (Identifier|BuiltIn|PipelineTopic) → Arm 2 sub-form B
	// =============================================================
	AtCallExpr(frame,parts) {
		var node = { type: "AtCallExpr" };
		var as;
		var first = parts[0];

		if (!isNode(first)) {
			// Arm 1: `None@`. parts is [Builtin-tok("None"), At-tok, ?AsAnnotationExpr].
			let atTok;
			for (let p of parts) {
				if (!isNode(p) && p.type === "At") atTok = p;
				else if (isNode(p) && p.type === "AsAnnotationExpr") as = p;
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
				if (isNode(p)) {
					if (p.type === "AsAnnotationExpr") as = p;
					else node.arg = p;
				}
			}
		}
		else {
			// Arm 2 sub-form B: IdentBase + ?SingleAccessExpr + At-tok + ExprNoBlock + ?AsAnnotationExpr.
			// Synthesize an AtExpr from the spliced parts.
			let base = first;
			let access, arg, atTok;
			for (let p of parts.slice(1)) {
				if (isNode(p)) {
					if (p.type === "SingleAccessExpr") access = p;
					else if (p.type === "AsAnnotationExpr") as = p;
					else arg = p;
				}
				else if (p.type === "At") atTok = p;
			}
			node.callee = {
				type: "AtExpr",
				base,
				start: base.start,
				end: atTok.end,
			};
			if (access) node.callee.access = access;
			if (arg) node.arg = arg;
		}

		if (as) node.as = as.annotation;
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
	// suffixes then apply on top of that wrapper. `:as` attaches
	// to the outermost node — semantically annotates the whole
	// chained value.
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
		var as;
		for (let p of parts) {
			if (p.type === "AsAnnotationExpr") {
				as = p;
			}
			else if (!isNode(p)) {
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

		if (as) node.as = as.annotation;
		return node;
	},
};
