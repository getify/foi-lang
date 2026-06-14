// default-shapers.js — AST shape conventions for the Foi syntactic parser.
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
// After node-filter:
//   - Without access: [target-Identifier, source-base]
//   - With access:    [target-Identifier, source-base, MultiAccessExpr]
//
// Field naming `{ target, source }` is symmetric with
// AssignmentExpr's `{ target, source }` — same conceptual roles
// (binding LHS / value RHS), inverted only in which side carries
// the access chain. Assignment puts the chain on `target` (you
// assign INTO a path); binding puts it on `source` (you read
// FROM a path).
//
// `target` retains the full Identifier node — matches
// DefFuncExpr.name / DefTypeStmt.name precedent; these binding
// sites are independently navigable in tooling. The
// GatherParameter flatten-to-string convention is reserved for
// purely structural sigil prefixes where the Identifier wrapper
// carries no independent value.
//
// DestructureNamedDef additionally accepts BracketExpr as the
// source-base (computed-key destructure, `def < foo: [k].bar >:`).
// foldAccess handles BracketExpr-as-base transparently — the
// fold wraps it like any other base node, so consumers see e.g.
// `MemberAccessExpr{object: BracketExpr{...}, accessor: ...}` for
// `[k].bar` and a bare BracketExpr node for `[k]` alone.
function shapeNamedBinding(typeName,parts) {
	var nodes = parts.filter(isNode);
	var [ target, sourceBase, access ] = nodes;
	return {
		type: typeName,
		target,
		source: foldAccess(sourceBase,access),
	};
}

// Helper for the two "concise binding" productions —
// ExportConciseBinding (§3) and DestructureConciseDef (§4). Both
// share the shape `Colon Identifier SingleAccessExpr?`. After
// node-filter:
//   - Without access: [source-base]
//   - With access:    [source-base, SingleAccessExpr]
//
// Single-slot shape `{ source }` — per source-fidelity, the
// concise form is deliberately distinct from the named form.
// `:foo` is NOT desugared to `foo: foo`; consumers branch on the
// concise-form type tag to learn that the binding name is
// derived from the source path's outermost name (the bare
// Identifier when no access; the last access segment when access
// is present). That derivation belongs in the interpreter, not
// the shaper.
function shapeConciseBinding(typeName,parts) {
	var nodes = parts.filter(isNode);
	var [ sourceBase, access ] = nodes;
	return {
		type: typeName,
		source: foldAccess(sourceBase,access),
	};
}

// Helper for the six paren-grouping productions (GroupedExpr,
// GroupedExprNoBlock, GroupedOpExpr, GroupedBareOpExpr,
// GroupedBareOpExprNoEmpty from §5; GroupedDoExpr from §9
// alongside BinaryAtom). All share the same structure: OpenParen +
// inner-expression + CloseParen + optional AsAnnotationExpr.
//
// The grammar-level variants exist purely for PEG parse-time
// discrimination — each restricts what inner expression form is
// allowed at its call site. Once a parse succeeds, that constraint
// is already enforced, and the inner node's own type encodes what's
// actually there. So all six shape to a single `GroupedExpr` node
// type at the AST surface; no downstream consumer branches on which
// variant matched.
//
// Surrounding parens are noise (recoverable from the type tag —
// `GroupedExpr` signals user-written parens). Inner expression
// promotes to `expr`. Optional `:as` tail unwraps onto `as` per
// the wrapper-unwrap-at-assignment convention.
//
// Parens are the only construct that still carries its own `:as`
// tail post-rework — they're atomic groups, so `:as` can attach
// regardless of position (including as a binary operand, as in
// `(x + y) :as int ~map f`).
function shapeGrouped(parts) {
	var expr, as;
	for (let p of parts) {
		if (isNode(p)) {
			if (p.type === "AsAnnotationExpr") as = p.annotation;
			else expr = p;
		}
		// else: OpenParen, CloseParen — skip
	}
	var node = { type: "GroupedExpr", expr };
	if (as) node.as = as;
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

// Helper for the polarity field naming convention used in §15
// (and reused from §14's CondClause shape rationale).
//
// When user wrote ?/! explicitly, the field is `polarity` with
// that token's value. When the polarity slot was omitted
// (allowed by <IndepCondClause> and DepCondClause, and by
// ElseStmt's leading-? form), the field is `defaultPolarity`
// with the implicit "?" value — per the Foi-Guide convention
// that omitted polarity defaults to ?.
//
// Field-name discrimination preserves user-written vs. implicit
// source-fidelity without an extra boolean flag. Consumers
// reading effective polarity do `clause.polarity ?? clause.defaultPolarity`.
//
// Used by:
//   - shapeIndepPatternStmt (CondClause synthesis)
//   - DepCondClause shaper
//   - ElseStmt shaper
//
// §14's CondClause does NOT use this helper — its grammar
// requires polarity, so the field is unconditionally `polarity`
// with no implicit-default branch needed.
//
// Returns an object spreadable onto the caller's result.
function shapePolarity(polarityTok) {
	if (polarityTok) return { polarity: polarityTok.value };
	return { defaultPolarity: "?" };
}

// Helper for the two §15 independent-match pattern-stmt
// productions — IndepPatternStmt and IndepPatternStmtNoSemi.
// Both collapse to the same {type: "IndepPatternStmt", ...} node;
// the trailing-semi distinction is a source-fidelity bit handled
// by the deferred terminators audit, not by a separate node type.
//
// <IndepCondClause> stays hidden — its content splices in.
// Parts contain: optional Qmark/Exmark, BracketExpr (the test),
// then spliced <MatchConsequent>/<MatchConsequentNoSemi> content
// (either [Colon, Expr-node, Semi] or [BlockExpr-node]).
//
// Synthesizes a CondClause node uniform with §14's
// GuardedExpr.clause — same {polarity|defaultPolarity, test}
// shape. Synthetic, so start/end is set explicitly.
function shapeIndepPatternStmt(parts) {
	var polarityTok, test, consequent;
	for (let p of parts) {
		if (isNode(p)) {
			if (!test) test = p;
			else if (!consequent) consequent = p;
		}
		else if (p.type === "Qmark" || p.type === "Exmark") {
			polarityTok = p;
		}
		// else: Colon, Semicolon — skip
	}
	var clause = {
		type: "CondClause",
		...shapePolarity(polarityTok),
		test,
		start: polarityTok ? polarityTok.start : test.start,
		end: test.end,
	};
	return { type: "IndepPatternStmt", clause, consequent };
}

// Helper for the two §15 dependent-match pattern-stmt
// productions — DepPatternStmt and DepPatternStmtNoSemi. Both
// collapse to {type: "DepPatternStmt", ...}.
//
// DepCondClause is visible, so it arrives in parts as a typed
// node directly. Consequent comes from the spliced
// <MatchConsequent>/<MatchConsequentNoSemi> content (Expr or
// BlockExpr node).
function shapeDepPatternStmt(parts) {
	var clause, consequent;
	for (let p of parts) {
		if (isNode(p)) {
			if (p.type === "DepCondClause") clause = p;
			else if (!consequent) consequent = p;
		}
		// else: Colon, Semicolon — skip
	}
	return { type: "DepPatternStmt", clause, consequent };
}

// Shapes a PropertyExpr key. PropertyExpr is grammar-hidden:
//
//   <PropertyExpr> := Identifier | <PositiveIntLit>;
//
// Identifier arrives as a node — passthrough. PositiveIntLit
// arrives as one or two raw tokens (bare PositiveIntegerLit, or
// [Escape, PositiveIntegerLit] for the `\5_000` form). We
// synthesize a NumberLit mirroring the existing NumberLit shaper:
// text = concat of token values; span derives from first/last
// token. Synthetic — machinery doesn't reach this node, so we set
// start/end explicitly.
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


export const defaultShapers = {

	// =============================================================
	// §1 PROGRAM / STATEMENTS
	// =============================================================

	// Program := _ ((StmtSemi | ExportStmtSemi) _)*
	//            ((StmtSemiOpt | ExportStmtSemiOpt) _)?;
	//
	// Pure list-of-statements. Semicolons are noise; everything
	// shaped is a top-level statement node.
	Program(frame,parts) {
		var stmts = parts.filter(isNode);
		return { type: "Program", stmts };
	},

	// Identifier := General;
	//
	// Bare token-stream extraction. Concatenates the part values
	// into a single `name` string. Used in binding positions
	// (DefVarStmt target, parameter names, DotIdentifier inner,
	// type-decl name, etc.) where no `:as` tail is grammatically
	// possible. The BareIdentifier shaper subsumes into this same
	// node type for reference-position identifiers — consumers see
	// a uniform Identifier shape regardless of whether the source
	// role was binding or reference.
	Identifier(frame,parts) {
		var name = "";
		for (let p of parts) name += p.value;
		return { type: "Identifier", name };
	},

	// BuiltIn := Builtin;
	//
	// Same pattern as Identifier: concat token values to `name`.
	// Single-token in practice (the production wraps one Builtin
	// token), but the loop form keeps the shape symmetric with
	// Identifier and robust to any future grammar widening.
	BuiltIn(frame,parts) {
		var name = "";
		for (let p of parts) name += p.value;
		return { type: "BuiltIn", name };
	},

	// PipelineTopic := Hash;
	//
	// Same pattern. Wraps a single Hash token; `name` is the
	// literal "#".
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
	// single source-text string. No `:as` tail at the grammar
	// level — annotation comes via AsExpr.
	NumberLit(frame,parts) {
		var text = "";
		for (let p of parts) text += p.value;
		return { type: "NumberLit", text };
	},

	// BooleanLit := "true" | "false";
	//
	// Single Native token. Text is the raw lexeme, mirroring
	// NumberLit. No `:as` tail.
	BooleanLit(frame,parts) {
		var text = "";
		for (let p of parts) text += p.value;
		return { type: "BooleanLit", text };
	},

	// EmptyLit := "empty";
	//
	// Type tag is total information; no `text` field. No `:as` tail.
	EmptyLit(frame,parts) {
		return { type: "EmptyLit" };
	},

	// PlainStr := DoubleQuote PlainStrContent* DoubleQuote;
	//
	// Concatenates interior String and StringEscapedChar token
	// values into `text`. Surrounding DoubleQuotes are noise
	// (recoverable from the type tag). Escape sequences are
	// preserved raw in `text` — interp's job to resolve them.
	// No `:as` tail.
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

	// SpacingEscapedStr := EscapePlain DoubleQuote SpacingEscapedStrContent* DoubleQuote;
	//
	// Same shape as PlainStr; additionally folds interior
	// Whitespace tokens into `text` verbatim (the production opts
	// into preserveInnerDelim so the whitespace tokens reach us in
	// parts). Leading Escape and surrounding DoubleQuotes are
	// noise. No `:as` tail.
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

	// InterpExpr := Backtick _ Expr _ Backtick;
	//
	// Interp slot inside the two interp-string forms. Surrounding
	// Backticks are noise; the inner expression is exposed as
	// `expr`. Parts is exactly [Backtick, exprNode, Backtick].
	InterpExpr(frame,parts) {
		var expr = parts.find(isNode);
		return { type: "InterpExpr", expr };
	},

	// InterpStr := EscapeBacktick DoubleQuote InterpStrContent* DoubleQuote;
	//
	// Surfaces as a `chunks` array alternating string text and
	// InterpExpr nodes. Invariant: chunks.length is always odd,
	// chunks[0] and chunks[last] are always strings (possibly "").
	// Consumers discriminate elements via `typeof === "string"`.
	// Leading Escape and surrounding DoubleQuotes are noise.
	// No `:as` tail.
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

	// SpacingInterpStr := EscapeSpacingBacktick DoubleQuote SpacingInterpStrContent* DoubleQuote;
	//
	// Same chunks-array shape as InterpStr; Whitespace tokens
	// fold into the adjacent text chunk verbatim (preserveInnerDelim
	// delivers them in parts). No `:as` tail.
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


	// =============================================================
	// §3 IMPORTS / EXPORTS
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

	// ExportNamedBinding := Identifier _ Colon _ Identifier MultiAccessExpr?;
	//
	// Shape `{ target, source }` per shapeNamedBinding. `target`
	// is the externally-visible exported name (LHS of `:`);
	// `source` is the local-scope reference being exported, folded
	// with any trailing access chain.
	ExportNamedBinding(frame,parts)   { return shapeNamedBinding("ExportNamedBinding",parts); },

	// ExportConciseBinding := Colon Identifier SingleAccessExpr?;
	//
	// Shape `{ source }` per shapeConciseBinding. Exported name is
	// derived from the source path; see the helper's comment.
	ExportConciseBinding(frame,parts) { return shapeConciseBinding("ExportConciseBinding",parts); },

	// ExportExpr := "export" _ OpenBrace _ <ExportBindingsList> _ CloseBrace;
	//
	// ExportBindingsList is hidden, so binding nodes splice up
	// directly. Keyword "export", braces, and commas are noise.
	// Field name `entries` matches the BlockDefsInit /
	// BlockDefsInitOpt / DoBlockDefsInitOpt convention — the
	// parent type tag tells the consumer what kind of entries.
	ExportExpr(frame,parts) {
		return { type: "ExportExpr", entries: parts.filter(isNode) };
	},


	// =============================================================
	// §4 VARIABLE DEFINITIONS / DESTRUCTURING
	// =============================================================

	// DefVarStmt := "def" _ (Identifier | DestructureTarget) _ Colon _ (Expr | ImportExpr);
	//
	// `def` keyword and `:` colon are noise; the two semantic
	// children (target = Identifier|DestructureTarget, init =
	// Expr|ImportExpr) take named fields.
	DefVarStmt(frame,parts) {
		var nodes = parts.filter(isNode);
		var [ target, init ] = nodes;
		return { type: "DefVarStmt", target, init };
	},

	// DestructureNamedDef := Identifier _ Colon _ (Identifier | BracketExpr) MultiAccessExpr?;
	//
	// Shape `{ target, source }` per shapeNamedBinding. `target`
	// is the new local binding name (LHS of `:`); `source` is the
	// field path inside the destructured value, folded with any
	// trailing access. See the helper's comment for the
	// BracketExpr-as-base detail (`def < foo: [k].bar >: src;`).
	DestructureNamedDef(frame,parts)   { return shapeNamedBinding("DestructureNamedDef",parts); },

	// DestructureConciseDef := Colon Identifier SingleAccessExpr?;
	//
	// Shape `{ source }` per shapeConciseBinding. New local
	// binding name is derived from the source path; see helper.
	DestructureConciseDef(frame,parts) { return shapeConciseBinding("DestructureConciseDef",parts); },

	// DestructureCapture := Hash Identifier;
	//
	// Binds the WHOLE source value to a fresh name. NOT a "rest"
	// pattern — `#foo` and bare destructure entries can coexist
	// in the same DestructureTarget, each pulling from the same
	// source (the `#foo` form just additionally captures the
	// entire payload under `foo`). The `#` is noise (recoverable
	// from the type tag).
	//
	// `target` retains the Identifier node — same call as the
	// Named productions in this cluster (see shapeNamedBinding's
	// comment on the GatherParameter flatten-to-string exception).
	DestructureCapture(frame,parts) {
		return { type: "DestructureCapture", target: parts.find(isNode) };
	},

	// DestructureTarget := OpenAngle _ <DestructureDefList> _ CloseAngle;
	//
	// DestructureDefList is hidden, so def nodes splice up
	// directly. Angle brackets and commas are noise. `entries`
	// matches the ExportExpr / BlockDefsInit* / DoBlockDefsInitOpt
	// convention.
	DestructureTarget(frame,parts) {
		return { type: "DestructureTarget", entries: parts.filter(isNode) };
	},


	// =============================================================
	// §5 EXPRESSION SCAFFOLDING
	// =============================================================

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

	// AsAnnotationExpr := ":as" _ NamedType;
	//
	// `:as` keyword (noise; recoverable from the type tag) plus a
	// NamedType promoted to `annotation`. Per the wrapper-unwrap
	// convention, parents that mount this at their `.as` slot
	// store `.annotation` directly rather than the wrapper itself.
	// The shaper still emits the wrapper node so the production
	// round-trips through default tooling; no current parent
	// retains it intact.
	AsAnnotationExpr(frame,parts) {
		return { type: "AsAnnotationExpr", annotation: parts.find(isNode) };
	},

	// AsExpr := <AsableExpr> _ AsAnnotationExpr;
	// <AsableExpr> := BlockExpr | GuardedExpr | UnaryExpr
	//               | BareOperandExpr | GroupedOpExpr | GroupedDoExpr;
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
	GroupedExpr(frame,parts)              { return shapeGrouped(parts); },
	GroupedExprNoBlock(frame,parts)       { return shapeGrouped(parts); },
	GroupedOpExpr(frame,parts)            { return shapeGrouped(parts); },
	GroupedBareOpExpr(frame,parts)        { return shapeGrouped(parts); },
	GroupedBareOpExprNoEmpty(frame,parts) { return shapeGrouped(parts); },
	GroupedDoExpr(frame,parts)            { return shapeGrouped(parts); },


	// =============================================================
	// §6 IDENTIFIER EXPRESSIONS / ACCESS / RANGE
	// =============================================================

	// DotIdentifier := Period (Identifier | BuiltIn | PositiveIntegerLit | NegativeIntegerLit);
	//
	// Dot-access by name or index. Four inner cases:
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

	// BracketExpr := OpenBracket _ ExprNoBlock _ CloseBracket;
	//
	// Bracket-access (`arr[expr]`). Brackets are noise; the inner
	// ExprNoBlock takes the `expr` field.
	BracketExpr(frame,parts) {
		return { type: "BracketExpr", expr: parts.find(isNode) };
	},

	// DotBracketExpr := Period OpenBracket _ <RangeExpr> _ CloseBracket;
	//
	// Range-access (`arr.[1..5]`). Period and brackets are noise;
	// the inner RangeExpr (ClosedRangeExpr | LeadingRangeExpr |
	// TrailingRangeExpr — each its own type tag once shaped) takes
	// the `range` field.
	DotBracketExpr(frame,parts) {
		return { type: "DotBracketExpr", range: parts.find(isNode) };
	},

	// DotAngleExpr := Period OpenAngle _ <PropertyExpr> (_ Comma _ <PropertyExpr>)* _ CloseAngle;
	//
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

	// SingleAccessExpr — list of access segments used by special
	// contexts (AssignmentExpr LHS, AtExpr internal access,
	// ExportNamedBinding, ExportConciseBinding, DestructureNamedDef,
	// DestructureConciseDef, PickValue) — NOT by ChainExpr, which
	// folds its segments into typed nested nodes. Each segment is
	// a DotIdentifier or BracketExpr; already type-tagged, just
	// collected.
	SingleAccessExpr(frame,parts) {
		return { type: "SingleAccessExpr", segments: parts.filter(isNode) };
	},

	// MultiAccessExpr — same shape as SingleAccessExpr with a
	// broader segment alphabet (adds DotBracketExpr, DotAngleExpr).
	MultiAccessExpr(frame,parts) {
		return { type: "MultiAccessExpr", segments: parts.filter(isNode) };
	},

	// AtExpr — IdentBase + optional access + @. Shape `{ base }`,
	// where `base` is folded via the unified access-fold rule (see
	// foldAccess above): bare `foo@` → `AtExpr{ base: Identifier{
	// name:"foo"} }`; access form `foo.bar@` → `AtExpr{ base:
	// MemberAccessExpr{ object: Identifier{name:"foo"}, accessor:
	// Identifier{name:"bar"} } }`. So the access portion of an at-
	// expression shapes identically to the same access appearing in
	// operand position — no separate `access` slot to special-case.
	// The `@` itself is noise (recoverable from type tag).
	//
	// No `:as` tail post-rework — annotation comes via AsExpr.
	// AsExpr's unwrap lifts `as` onto the returned AtExpr node.
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

	// MonadConstructor — bare `@`. Type tag is total information.
	//
	// No `:as` tail post-rework — annotation comes via AsExpr.
	// AsExpr's unwrap lifts `as` onto the returned MonadConstructor
	// node.
	MonadConstructor(frame,parts) {
		// All parts are the At token; nothing semantic to collect.
		return { type: "MonadConstructor" };
	},

	// ClosedRangeExpr := RangeOperand _ DoublePeriod _ RangeOperand;
	//
	// Range — closed form (`x..y`). Two operands `from`/`to`. No
	// `:as` per grammar (must parenthesize: `(x..y) :as T`) — the
	// trailing-position RangeOperand would otherwise greedily
	// absorb `:as`, and ranges are deliberately omitted from
	// <AsableExpr> as well, making `1..5 :as List` a parse error.
	ClosedRangeExpr(frame,parts) {
		var [ from, to ] = parts.filter(isNode);
		return { type: "ClosedRangeExpr", from, to };
	},

	// LeadingRangeExpr := RangeOperand _ DoublePeriod;
	//
	// Range — leading-open form (`x..`). Single operand, no `:as`
	// per grammar.
	LeadingRangeExpr(frame,parts) {
		return { type: "LeadingRangeExpr", from: parts.find(isNode) };
	},

	// TrailingRangeExpr := DoublePeriod _ RangeOperand;
	//
	// Range — trailing-open form (`..y`). Single operand, no `:as`
	// per grammar.
	TrailingRangeExpr(frame,parts) {
		return { type: "TrailingRangeExpr", to: parts.find(isNode) };
	},


	// =============================================================
	// §7 FUNCTION CALLS / OP-AS-FUNCTION
	// =============================================================

	// OpFuncExpr := OpenParen (DotAngleExpr | DotBracketExpr | (OpenBracket CloseBracket) | Op) SingleQuote? CloseParen;
	//
	// Op-as-function-value. Four inner forms (per the grammar's
	// disjoint alternatives), surfaced via three mutually-exclusive
	// payload fields:
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

	// PrefixCallSuffix := OpenParen CallArgs CloseParen;
	//
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

	// PartialCallSuffix := Pipe CallArgs Pipe;
	//
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

	// AtCallExpr := "None" At
	//             | (AtExpr | (IdentBase SingleAccessExpr? _ At) | MonadConstructor) _ ExprNoBlock;
	//
	// At-form applied to (optionally) an argument. Two arms:
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

	// ChainExpr := ChainBase
	//              (
	//                  (_ ChainSeg)+ (SingleQuote (_ CallSuffix)*)?
	//                | SingleQuote (_ CallSuffix)*
	//              );
	//
	// Base + ordered segments folded into JS-style nested typed
	// nodes. Each segment wraps the previous expression; outermost
	// = last applied. Single-segment cases unwrap directly to the
	// typed node (no degenerate single-element wrapper). ChainExpr
	// itself emits no node — it's a parse vehicle only.
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
	// §8 UNARY
	// =============================================================
	//
	// Two productions, prefix-unary shape, distinguished only by
	// op kind (named ?empty/!empty vs symbolic ?/!). Both go
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
	NamedUnaryExpr(frame,parts)    { return shapeUnaryTier("NamedUnaryExpr",parts); },
	SymbolicUnaryExpr(frame,parts) { return shapeUnaryTier("SymbolicUnaryExpr",parts); },


	// =============================================================
	// §9 BINARY TIERS
	// =============================================================
	//
	// Seven productions ordered loosest → tightest: FlowBinExpr,
	// OrBinExpr, AndBinExpr, TypeCompareBinExpr, CompareBinExpr,
	// AddBinExpr, MulBinExpr.
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


	// =============================================================
	// §11 BLOCKS / DEF-BLOCK STATEMENT
	// =============================================================

	// VarDefInit := (Identifier | DestructureTarget) _ Colon _ ExprNoBlock;
	//
	// Var-def, required init. Two semantic children: target
	// (Identifier or DestructureTarget) and init (ExprNoBlock).
	VarDefInit(frame,parts) {
		var [ target, init ] = parts.filter(isNode);
		return { type: "VarDefInit", target, init };
	},

	// VarDefInitOpt := (Identifier        (_ Colon _ ExprNoBlock)?)
	//                | (DestructureTarget (_ Colon _ ExprNoBlock)?);
	//
	// Var-def, optional init. Same shape as VarDefInit but init
	// may be absent.
	VarDefInitOpt(frame,parts) {
		var [ target, init ] = parts.filter(isNode);
		var node = { type: "VarDefInitOpt", target };
		if (init) node.init = init;
		return node;
	},

	// BlockDefsInit := OpenParen _ <VarDefInitList> _ CloseParen;
	//
	// Paren-bounded list of var-defs (required-init form).
	// Used by DefBlockStmt.
	BlockDefsInit(frame,parts) {
		return { type: "BlockDefsInit", entries: parts.filter(isNode) };
	},

	// BlockDefsInitOpt := OpenParen _ <VarDefInitOptList> _ CloseParen;
	//
	// Paren-bounded list of var-defs (optional-init form).
	// Used by BlockExpr.
	BlockDefsInitOpt(frame,parts) {
		return { type: "BlockDefsInitOpt", entries: parts.filter(isNode) };
	},

	// BlockExpr := BlockDefsInitOpt? _ <BareBlockExpr>;
	//
	// Compound with optional defs-init clause and required body
	// statements. <BareBlockExpr> is hidden, so OpenBrace, stmts,
	// Semicolons, and CloseBrace splice into parts. The
	// BlockDefsInitOpt child (when present) sits alongside stmt
	// nodes and is identified by its type tag.
	//
	// No `:as` tail post-rework — annotation comes via AsExpr
	// (BlockExpr is in <AsableExpr>). AsExpr's unwrap lifts `as`
	// onto the returned BlockExpr node, so `{x;y} :as int` still
	// shapes to `BlockExpr{stmts:[...], as:"int"}`.
	//
	// Field order: always-present first (`stmts`), then optional
	// `defs`.
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
	// §13 FUNCTION DEFINITIONS
	// =============================================================

	// ParameterList := VarDefInitOpt (_ Comma _ VarDefInitOpt)*;
	//
	// Comma-separated list of optional-init parameter defs. Used
	// by DefFuncExpr per paren-group.
	ParameterList(frame,parts) {
		return { type: "ParameterList", params: parts.filter(isNode) };
	},

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

	// FuncBodyBlock := OpenBrace _ <FuncBodyStmts> _ CloseBrace;
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
	//                (_ <FuncPrecondList>)? (_ FuncOverClause)? (_ FuncAsClause)?
	//                _ <FuncBody>;
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
	// `params: []` and a zero-length span: `start` anchored at
	// `openParen.end + 1`, `end: null`. The `null` end matches
	// the machinery's empty-merged edge case (shapeNode in
	// parser-combinators.js) — both signal "no content, no end
	// character." Consumers detect emptiness via `node.end === null`.
	// The synthesized node is honest about being a ParameterList —
	// `paramSets[i].type` is uniform regardless of arity.
	//
	// <FuncPrecondList> is hidden, so its FuncPrecond children bubble
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
							end:   null,
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
	// §14 CONDITIONALS / GUARDS
	// =============================================================

	// CondClause := (Qmark | Exmark) BracketExpr;
	//
	// Polarity (`?` or `!`) is required — the production guarantees
	// one, so the field is unconditionally `polarity` (no implicit-
	// default branch via shapePolarity). BracketExpr is kept as a
	// nested node rather than unwrapped to its inner expr;
	// BracketExpr already surfaces in the AST in other contexts
	// (e.g. DestructureNamedDef's BracketExpr arm), so this shape
	// stays uniform across roles. The `test` field name conveys
	// the semantic role; the BracketExpr type tag conveys the
	// syntactic shape (`[...]`).
	//
	// Used at three call sites with the same node shape:
	//   - GuardedExpr (§14)        — as `clause`
	//   - FuncPrecond (§13)        — as `clause`
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
	// MatchConsequent produces in §15.
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
	// §15 MATCH EXPRESSIONS
	// =============================================================

	// IndepMatchExpr := Qmark OpenBrace _ <IndepMatchStmts> _ CloseBrace;
	//
	// <IndepMatchStmts> hidden — its list of IndepPatternStmt
	// nodes (plus optional trailing ElseStmt or
	// IndepPatternStmtNoSemi) splices up directly. The NoSemi
	// variant collapses to IndepPatternStmt at shape time, so
	// consumers see uniform `IndepPatternStmt` type tags in stmts.
	// Qmark and braces are noise.
	IndepMatchExpr(frame,parts) {
		return { type: "IndepMatchExpr", stmts: parts.filter(isNode) };
	},

	// IndepPatternStmt       := <IndepCondClause> _ <MatchConsequent>       (_ Semicolon)*;
	// IndepPatternStmtNoSemi := <IndepCondClause> _ <MatchConsequentNoSemi>;
	//
	// Both delegate to shapeIndepPatternStmt and emit the same
	// {type: "IndepPatternStmt", ...} node. See the helper's
	// comment for shape details. The NoSemi-vs-Semi distinction is
	// a source-fidelity bit deferred to the terminators audit.
	IndepPatternStmt(frame,parts)       { return shapeIndepPatternStmt(parts); },
	IndepPatternStmtNoSemi(frame,parts) { return shapeIndepPatternStmt(parts); },

	// DepMatchExpr := Qmark OpenParen _ ExprNoBlock _ CloseParen
	//                 OpenBrace _ <DepMatchStmts> _ CloseBrace;
	//
	// Two semantic parts: the topic (the ExprNoBlock between the
	// parens) and the list of stmts (DepPatternStmt nodes, possibly
	// ending with ElseStmt). Topic arrives as the first node in
	// source order; subsequent nodes are stmts.
	DepMatchExpr(frame,parts) {
		var topic;
		var stmts = [];
		for (let p of parts) {
			if (isNode(p)) {
				if (!topic) topic = p;
				else stmts.push(p);
			}
			// else: Qmark, OpenParen, CloseParen, OpenBrace, CloseBrace — skip
		}
		return { type: "DepMatchExpr", topic, stmts };
	},

	// DepPatternStmt       := DepCondClause _ <MatchConsequent>       (_ Semicolon)*;
	// DepPatternStmtNoSemi := DepCondClause _ <MatchConsequentNoSemi>;
	//
	// Both delegate to shapeDepPatternStmt and emit the same
	// {type: "DepPatternStmt", ...} node.
	DepPatternStmt(frame,parts)       { return shapeDepPatternStmt(parts); },
	DepPatternStmtNoSemi(frame,parts) { return shapeDepPatternStmt(parts); },

	// DepCondClause := (Qmark | Exmark)? OpenBracket _ <DepCondExprList> _ CloseBracket;
	//
	// Shape `{polarity|defaultPolarity, tests}`. `tests` (plural of
	// CondClause.test) is the list of values/operator-led fragments
	// matched against the dependent-match topic. Atoms are typed
	// nodes — DepCondBoolExpr for operator-led fragments
	// (`?and x`, `?= "Kyle"`, `?as int`) or any ExprNoBlock-shaped
	// node for plain values.
	//
	// OpenBracket/CloseBracket/Comma are noise.
	DepCondClause(frame,parts) {
		var polarityTok;
		var tests = [];
		for (let p of parts) {
			if (isNode(p)) tests.push(p);
			else if (p.type === "Qmark" || p.type === "Exmark") polarityTok = p;
			// else: OpenBracket, CloseBracket, Comma — skip
		}
		return {
			type: "DepCondClause",
			...shapePolarity(polarityTok),
			tests,
		};
	},

	// DepCondBoolExpr := AsTypeOp _ NamedType
	//                  | DepCondBoolOp _ CompareDispatch
	//                  | OpenParen _ DepCondBoolExpr _ CloseParen;
	//
	// Shape `{op, right}` — monadic operator + single operand.
	// These are expression FRAGMENTS (op + RHS, with the implicit
	// LHS being the dependent-match topic), not full binary
	// expressions, so there's no `left` slot. The fragment nature
	// is also why the paren-recursive arm earns no node: there's
	// nothing to group around a monadic op+operand.
	//
	// Arm 3 (paren-recursive) UNWRAPS — return the inner
	// DepCondBoolExpr unchanged. The machinery's start/end overwrite
	// then extends the inner node's span to cover the outer parens
	// (same pattern as AsExpr's unwrap; see top-of-file `:as`
	// annotation handling comment).
	//
	// Multi-token ops (?<=, ?<=>, etc.) concatenate token values
	// into the op string — same pattern as the binary tier helper.
	// Single-token BooleanOper ops (?and, ?or, ?=, ?as, etc.) just
	// pass their full value through.
	DepCondBoolExpr(frame,parts) {
		var op = "";
		var right;
		var sawOpenParen = false;
		for (let p of parts) {
			if (isNode(p)) {
				right = p;
			}
			else if (p.type === "OpenParen") {
				sawOpenParen = true;
			}
			else if (p.type === "CloseParen") {
				// noise
			}
			else {
				op += p.value;
			}
		}
		// Paren arm: right is the inner DepCondBoolExpr; unwrap.
		if (sawOpenParen) return right;
		return { type: "DepCondBoolExpr", op, right };
	},

	// ElseStmt := (Qmark _)? <MatchConsequentNoSemi> (_ Semicolon)*;
	//
	// Optional leading `?` distinguishes the explicit `?:` form
	// from the abbreviated `:` form (semantically identical per
	// Foi-Guide). Per the same precedent as IndepCondClause /
	// DepCondClause, the explicit form sets `polarity: "?"` and
	// the abbreviated form sets `defaultPolarity: "?"`. The grammar
	// only allows Qmark here (no Exmark), so polarity value is
	// always "?".
	//
	// Consequent is the trailing node (Expr or BlockExpr — both
	// arms of <MatchConsequentNoSemi> splice in either way).
	// Trailing semicolons are dropped per source-fidelity deferral.
	ElseStmt(frame,parts) {
		var polarityTok, consequent;
		for (let p of parts) {
			if (isNode(p)) {
				if (!consequent) consequent = p;
			}
			else if (p.type === "Qmark") polarityTok = p;
			// else: Colon, Semicolon — skip
		}
		return {
			type: "ElseStmt",
			...shapePolarity(polarityTok),
			consequent,
		};
	},


	// =============================================================
	// §16 DO-COMPREHENSIONS
	// =============================================================

	// DoVarDefInitOpt := (Identifier        (_ (DoubleColon | Colon) _ ExprNoBlock)?)
	//                  | (DestructureTarget (_ (DoubleColon | Colon) _ ExprNoBlock)?);
	//
	// Parallel to VarDefInitOpt but adds the `op` discriminator
	// for the DoubleColon / Colon distinction (monadic-unwrap-bind
	// vs regular-bind). `op` is the literal token text ("::" or
	// ":"), present only when `init` is present; bare-identifier
	// forms shape as just `{target}`.
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
			// else: structural delim — skip
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
	// Same shape as BlockDefsInitOpt, just carrying DoVarDefInitOpt
	// entries (which may use `:` or `::`) instead of VarDefInitOpt.
	DoBlockDefsInitOpt(frame,parts) {
		return { type: "DoBlockDefsInitOpt", entries: parts.filter(isNode) };
	},

	// DoBlockExpr := DoBlockDefsInitOpt? _ <DoBareBlockExpr>;
	//
	// Parallel to BlockExpr (§11), minus the `as` slot (no `:as`
	// on do-blocks at the grammar level — annotate via AsExpr at
	// the outer DoComprExpr / GroupedDoExpr level instead).
	// <DoBareBlockExpr> is hidden, so OpenBrace / stmts /
	// Semicolons / CloseBrace splice into parts.
	//
	// DoFinalUnwrapExpr (when present) is grammar-positioned as
	// the LAST entry of `stmts`. Consumers check
	// `stmts[stmts.length-1]?.type === "DoFinalUnwrapExpr"` to
	// detect the monadic-unwrap form.
	//
	// Field order: always-present first (`stmts`), then optional
	// `defs`.
	DoBlockExpr(frame,parts) {
		var defs;
		var stmts = [];
		for (let p of parts) {
			if (p.type === "DoBlockDefsInitOpt") defs = p;
			else if (isNode(p)) stmts.push(p);
			// else: OpenBrace, CloseBrace, Semicolons — skip
		}
		var node = { type: "DoBlockExpr", stmts };
		if (defs) node.defs = defs;
		return node;
	},

	// DoDefVarStmt := "def" _ (Identifier | DestructureTarget) _ DoubleColon _ Expr;
	//
	// Mirrors DefVarStmt — same `{target, init}` shape. The `::`
	// vs `:` distinction lives in the type tag (DoDefVarStmt vs
	// DefVarStmt). "def" and "::" are noise.
	DoDefVarStmt(frame,parts) {
		var [ target, init ] = parts.filter(isNode);
		return { type: "DoDefVarStmt", target, init };
	},

	// DoFinalUnwrapExpr := DoubleColon _ ExprNoBlock (_ Semicolon)*;
	//
	// The `::` opener is noise (recoverable from type tag).
	// Trailing semicolons dropped per current convention. Single
	// semantic child surfaces as `expr` (matches BracketExpr.expr
	// / InterpExpr.expr).
	DoFinalUnwrapExpr(frame,parts) {
		return { type: "DoFinalUnwrapExpr", expr: parts.find(isNode) };
	},

	// DoComprExpr := (Identifier | BuiltIn) _ Tilde OpenAngle OpenAngle _ DoBlockExpr;
	//
	// Shape `{ targetType, body }`. `targetType` is the monad type
	// being lifted into (`Foo ~<< {...}` / `IO ~<< {...}`). `body`
	// is the wrapped DoBlockExpr node — uniform with the
	// "right-slot-is-a-node" convention used by FlowBinExpr for
	// `~map { ... }` and friends. Consumer reads `body.stmts`,
	// `body.defs?`.
	//
	// `~<<` tokens (Tilde, OpenAngle, OpenAngle) are noise.
	DoComprExpr(frame,parts) {
		var [ targetType, body ] = parts.filter(isNode);
		return { type: "DoComprExpr", targetType, body };
	},

	// DoLoopComprExpr := (ExprNoBlock | GroupedExpr) _ Tilde OpenAngle Star _ <DoLoopIterationExpr>;
	//
	// Shape `{ range, iter }`. `range` is the iterable source;
	// `iter` is the per-item iteration target — a DoBlockExpr
	// (when block-form: `xs ~<* (r) { ... }`) or a CallExpr /
	// IdentifierExpr / MemberAccessExpr / etc. (when non-block:
	// `xs ~<* fn`, `xs ~<* foo.bar`). Uniform slot; consumer
	// branches on `iter.type === "DoBlockExpr"`.
	//
	// `<DoLoopIterationExpr>` and `<DoLoopIterNoBlockExpr>` are
	// hidden — their non-paren-recursive contents resolve to the
	// underlying typed node (DoBlockExpr, CallExpr, etc.) which
	// surfaces directly in parts. The paren-recursive arm of
	// DoLoopIterNoBlockExpr drops user parens around the iter
	// (the parens never reach GroupedExpr here — they're internal
	// to the production).
	//
	// `~<*` tokens (Tilde, OpenAngle, Star) are noise. So are any
	// OpenParen/CloseParen tokens from the paren-recursive non-
	// block arm.
	DoLoopComprExpr(frame,parts) {
		var [ range, iter ] = parts.filter(isNode);
		return { type: "DoLoopComprExpr", range, iter };
	},


	// =============================================================
	// §17 DATA STRUCTURE LITERALS
	// =============================================================

	// RecordTupleLit := OpenAngle _ <RecordTupleEntryList> _ CloseAngle;
	//
	// <RecordTupleEntryList> is hidden, so entry nodes (PickValue
	// | ConcisePropDef | ExplicitPropDef | <RecordTupleValue>'s
	// resolved leaf) splice up directly. Angle brackets and commas
	// are noise. `entries` matches the established list-container
	// convention (ExportExpr / DestructureTarget / BlockDefsInit*).
	//
	// <RecordTupleValue>'s paren-recursive arm is hidden, so user
	// parens around an entry value drop as noise tokens — the inner
	// node bubbles up unchanged. Parallel to the DepCondBoolExpr
	// paren-arm unwrap pattern (parens around a non-Expr-grade
	// form earn no node).
	//
	// No `:as` tail — annotation comes via AsExpr (§5).
	RecordTupleLit(frame,parts) {
		return { type: "RecordTupleLit", entries: parts.filter(isNode) };
	},

	// SetLit := OpenAngle OpenBracket _ <SetEntryList> _ CloseBracket CloseAngle;
	//
	// Same shape as RecordTupleLit modulo entry kind: <SetEntry>
	// is `PickValue | <RecordTupleValue>` (no RecordProperty
	// arms — sets are keyless). Compound `<[` / `]>` openers and
	// commas are noise.
	//
	// No `:as` tail — annotation comes via AsExpr (§5).
	SetLit(frame,parts) {
		return { type: "SetLit", entries: parts.filter(isNode) };
	},

	// PickValue := Ampersand <IdentBase> MultiAccessExpr?;
	//
	// 8th access-fold site (joins AtExpr, AssignmentExpr LHS,
	// AtCallExpr Arm 2 sub-form B inline AtExpr, ExportNamedBinding,
	// ExportConciseBinding, DestructureNamedDef, DestructureConciseDef).
	// <IdentBase> is hidden — the inner Identifier or BuiltIn node
	// arrives directly. foldAccess returns base unchanged when no
	// access fragment follows.
	//
	// `source` matches the Export/Destructure binding convention
	// (read FROM a path). Ampersand is noise.
	PickValue(frame,parts) {
		var [ base, access ] = parts.filter(isNode);
		return {
			type: "PickValue",
			source: foldAccess(base, access),
		};
	},

	// ConcisePropDef := Colon <PropertyExpr>;
	//
	// Single-slot `{source}` per the concise-form convention
	// (matches ExportConciseBinding / DestructureConciseDef).
	// The `:foo` form is deliberately NOT desugared to `foo: foo`
	// — derivation belongs in the interpreter. Numeric concise
	// form `:5` is grammar-legal (permissive); the interpreter
	// validates that the source is path-derivable.
	//
	// Colon is noise.
	ConcisePropDef(frame,parts) {
		return {
			type: "ConcisePropDef",
			source: shapePropertyExpr(parts.slice(1)),
		};
	},

	// ExplicitPropDef := (<ComputedPropName> | <PropertyExpr>) _ Colon _ <RecordTupleValue>;
	//
	// Field names `{key, init}` — record-property semantics.
	// `init` mirrors DefVarStmt's RHS slot (definition site with
	// name on the left, initial value on the right). Avoids the
	// reserved `value` field name (collides with the isNode token
	// discriminator). Distinct from binding-flavor `{target,
	// source}`: a property definition writes a name→value pair
	// into a structure rather than binding a name to a read path.
	//
	// Two shapes for `key`:
	// - Static arm (<PropertyExpr>): Identifier node (passthrough)
	//   or synthetic NumberLit, via shapePropertyExpr.
	// - Computed arm (<ComputedPropName>): synthesized
	//   ComputedPropName{expr: <inner-node>} wrapper. The
	//   <ComputedPropName> grammar helper is hidden-but-named;
	//   promoting it at shape time gives consumers a uniform
	//   `key.type === "ComputedPropName"` discriminator (no
	//   parallel boolean flag). Parallels §15 CondClause
	//   synthesis — same pattern of materializing a named-but-
	//   hidden grammar helper to carry real semantic identity.
	//
	// Computed-arm inner is one of PipelineTopic | IdentifierExpr's
	// resolved leaf (Identifier | BuiltIn | ...) | StringLit's
	// resolved leaf (PlainStr | InterpStr | SpacingEscapedStr |
	// SpacingInterpStr) — all node forms.
	//
	// Colon is noise. Percent is consumed into the synthesized
	// ComputedPropName node's span (start = Percent.start).
	ExplicitPropDef(frame,parts) {
		var colonIdx = parts.findIndex(p => !isNode(p) && p.type === "Colon");
		var keyParts = parts.slice(0, colonIdx);
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
		return { type: "ExplicitPropDef", key, init };
	},


	// =============================================================
	// §18 TYPE DEFINITIONS
	// =============================================================

	// DefTypeStmt := "deft" _ Identifier _ <TypeExpr>;
	//
	// Shape `{ name, decl }`. `decl` (declaration) holds whichever
	// type-tagged node TypeExpr resolves to — FuncTypeExpr,
	// UnionTypeExpr, NamedType, NestedTypeExpr, DataStructTypeExpr,
	// or a leaf literal (EmptyLit / NumberLit / PlainStr /
	// BooleanLit). GroupedTypeExpr never appears here — it
	// unwrap-shapes to its inner.
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

	// NamedType := ((Identifier | BuiltIn) (Period (Identifier | BuiltIn))*) | NativeType;
	//
	// Two arms surfaced as mutually exclusive fields:
	//
	// - Native arm — single Keyword token, no nodes. Shape
	//   `{type, of: <keyword-text>}` where `of` carries the
	//   native-type spelling (`"int"` / `"integer"` / `"float"` /
	//   `"bool"` / `"boolean"` / `"string"`). The field name `of`
	//   mirrors FuncTypeArg.of and reads as "NamedType of int."
	//
	// - Bare/dotted arm — one or more Identifier/BuiltIn nodes
	//   interleaved with Period tokens. Shape `{type, segments:
	//   [...]}`. Periods drop as noise (namespace separator, not
	//   value-position member access — NOT folded via foldAccess).
	//   Single bare segment (e.g. `Foo`) carries segments of
	//   length 1; consumer treats the list uniformly regardless of
	//   arity.
	//
	// Consumer discrimination: branch on which field is present
	// (`if (node.of) ... else ... node.segments`). The two fields
	// are mutually exclusive at construction.
	NamedType(frame,parts) {
		if (parts.length === 1 && !isNode(parts[0])) {
			return { type: "NamedType", of: parts[0].value };
		}
		return { type: "NamedType", segments: parts.filter(isNode) };
	},

	// GroupedTypeExpr := OpenBrace _ (FuncTypeExpr | UnionTypeExpr (_ Pipe)? | NoUnionTypeExpr) _ CloseBrace;
	//
	// Unwrap-shaper — returns the inner type node directly.
	// Mirrors AsExpr's unwrap-and-lift pattern: GroupedTypeExpr
	// never appears in the AST. Under the strict-B brace rule,
	// GroupedTypeExpr only appears at sites where braces serve as
	// disambiguation (NestedTypeExpr's type-arg site; the position
	// after `?`/`*`/`^` modifiers in FuncTypeArg /
	// FuncTypeFinalArg / FuncTypeExpr). At every such site the
	// braces' structural role is owned by the parent production;
	// the wrapper carries no AST identity of its own.
	//
	// Optional trailing Pipe inside the UnionTypeExpr arm drops
	// as noise — its source-fidelity bit belongs in the audit,
	// not on a wrapper node we erase.
	GroupedTypeExpr(frame,parts) {
		return parts.find(isNode);
	},

	// NestedTypeExpr := NamedType _ GroupedTypeExpr;
	//
	// Two-slot `{base, arg}`. `base` is the type constructor
	// (NamedType node); `arg` is the parameterizing type — the
	// GroupedTypeExpr's inner node, which arrives already
	// unwrapped via GroupedTypeExpr's unwrap-shaper.
	NestedTypeExpr(frame,parts) {
		var [ base, arg ] = parts.filter(isNode);
		return { type: "NestedTypeExpr", base, arg };
	},

	// UnionTypeExpr := NoUnionTypeExpr (_ Pipe _ NoUnionTypeExpr)+;
	//
	// Flat `types` list. Union is associative — no precedence to
	// encode via left-folded nesting (unlike §9 binary tiers).
	// Pipes drop as noise.
	UnionTypeExpr(frame,parts) {
		return { type: "UnionTypeExpr", types: parts.filter(isNode) };
	},

	// DataStructTypeExpr := OpenAngle _ DataStructTypeList? _ (Comma _)? CloseAngle;
	//
	// Heterogeneous `entries` — discriminate via `entry.type`:
	//   - DataStructFieldType    — `name: type` slot
	//   - DataStructFinalValType — `*type` rest-slot (always last)
	//   - bare type node          — positional value (NamedType /
	//     UnionTypeExpr / NestedTypeExpr / etc, arriving directly
	//     via the hidden <DataStructValueType> production)
	//
	// Angle brackets and commas are noise. Trailing comma —
	// deferred to source-fidelity audit.
	DataStructTypeExpr(frame,parts) {
		return { type: "DataStructTypeExpr", entries: parts.filter(isNode) };
	},

	// DataStructFieldType := Identifier _ Colon _ <DataStructValueType>;
	//
	// Two slots: `name` (Identifier node, kept as node for
	// span/source-fidelity — mirrors DefFuncExpr.name and the
	// binding-target convention) and `fieldType` (the RHS type
	// node). Field name `fieldType` distinct from FuncTypeArg's
	// `of` to avoid conflating "type slot in a record" with "type
	// slot in a function signature" — they read at different
	// semantic registers.
	//
	// Colon is noise.
	DataStructFieldType(frame,parts) {
		var [ name, fieldType ] = parts.filter(isNode);
		return { type: "DataStructFieldType", name, fieldType };
	},

	// DataStructFinalValType := Star (NoUnionTypeExpr | GroupedTypeExpr);
	//
	// Single slot `fieldType`. The Star modifier's "rest" semantic
	// is recoverable from the type tag (unlike FuncTypeFinalArg,
	// which normalizes into FuncTypeArg with rest:true —
	// DataStructFinalValType keeps its own tag because there's no
	// non-rest sibling shape to merge with). The GroupedTypeExpr
	// arm arrives already unwrapped, so `fieldType` is the inner
	// type node regardless of arm.
	//
	// Star token drops as noise.
	DataStructFinalValType(frame,parts) {
		return { type: "DataStructFinalValType", fieldType: parts.find(isNode) };
	},

	// FuncTypeArg := Qmark? (NoUnionTypeExpr | GroupedTypeExpr);
	//
	// Unified shape `{of, optional?, rest?}`. `of` always carries
	// the arg's type (the GroupedTypeExpr arm arrives already
	// unwrapped, so `of` is always the inner type node).
	// `optional:true` set when a Qmark token precedes; absent when
	// bare. `rest` is set only by FuncTypeFinalArg's Star arm —
	// never directly here.
	//
	// Qmark drops as noise (recoverable from the `optional`
	// flag).
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
	// Normalizes into FuncTypeArg shape — FuncTypeFinalArg never
	// appears as a node type in the AST. Two arms:
	//
	// - Star arm: parts contain [Star token, type node]. Build a
	//   FuncTypeArg with rest:true. The GroupedTypeExpr arm
	//   arrives already unwrapped, so the type node is the inner
	//   regardless.
	// - FuncTypeArg arm: parts contain a single already-shaped
	//   FuncTypeArg child node. Unwrap (return the inner) — the
	//   "final position" semantic is recoverable from being the
	//   last entry in FuncTypeExpr.argTypes; no AST flag needed
	//   to mark it.
	//
	// Parallel to the collapse-rule for parse-time-only variants
	// (cf. §15 NoSemi siblings): two productions differing only
	// in trailing/position syntax collapse to one AST type tag.
	FuncTypeFinalArg(frame,parts) {
		var nodes = parts.filter(isNode);
		var hasStar = parts.some(p => !isNode(p) && p.type === "Star");
		if (hasStar) {
			return { type: "FuncTypeArg", of: nodes[0], rest: true };
		}
		return nodes[0];
	},

	// FuncTypeExpr := OpenParen _ FuncTypeArgList? _ (Comma _)? CloseParen _ Caret _ Qmark? _ (NoUnionTypeExpr | GroupedTypeExpr);
	//
	// Shape `{argTypes, optionalReturn?, returnType}`. `argTypes`
	// is a list of FuncTypeArg nodes (FuncTypeFinalArg normalizes
	// into FuncTypeArg via its own shaper, so the list is uniform
	// in element type). Empty arg list (`() ^ T`) → argTypes is
	// `[]`.
	//
	// Caret marks the args/return boundary; Qmark after Caret
	// sets `optionalReturn:true` (parallel to FuncTypeArg's
	// `optional` flag). GroupedTypeExpr return arm arrives
	// already unwrapped — `returnType` is the inner type node
	// regardless of arm.
	//
	// Parens, commas, Caret drop as noise (recoverable from the
	// type tag and field layout).
	FuncTypeExpr(frame,parts) {
		var argTypes = [];
		var returnType;
		var optionalReturn = false;
		var seenCaret = false;
		for (let p of parts) {
			if (isNode(p)) {
				if (seenCaret) returnType = p;
				else argTypes.push(p);
			}
			else if (p.type === "Caret") seenCaret = true;
			else if (p.type === "Qmark" && seenCaret) optionalReturn = true;
			// else: OpenParen / CloseParen / Comma — noise
		}
		var node = { type: "FuncTypeExpr", argTypes, returnType };
		if (optionalReturn) node.optionalReturn = true;
		return node;
	},

};
