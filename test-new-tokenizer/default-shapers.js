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
//     (target, init, name, op, left, right, args, base, segments,
//     stmts, defs, as, ...).
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
//     shaper itself (e.g. left-folded binary nesting, or sub-
//     structures reconstructed from spliced hidden-helper
//     contents), which the machinery doesn't reach.
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

	// Binary tier — flat iter `lhs (op rhs)+` left-folds into
	// nested {left, op, right}. Multi-token AddOps ($+) concat.
	// Intermediate fold nodes must set start/end manually since
	// the machinery only brand-stamps the outermost return.
	AddBinExpr(frame,parts) {
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
				type: "AddBinExpr",
				left: node,
				op: ops[i],
				right: operands[i + 1],
				start: node.start,
				end: operands[i + 1].end,
			};
		}
		return node;
	},

	// Chain — base + ordered heterogeneous segments. Postfix `'`
	// (prime, the SingleQuote token) splits segments into
	// pre-prime (general access/call) and post-prime (call
	// suffixes only, reversed-arg semantics). Presence of the
	// `primeCallSuffixes` field IS the prime flag — empty array
	// for `foo'`, populated for `foo'(a,b)`.
	ChainExpr(frame,parts) {
		var base;
		var segments = [];
		var primeCallSuffixes;
		var as;
		for (let p of parts) {
			if (p.type === "AsAnnotationExpr") {
				as = p;
			}
			else if (!isNode(p)) {
				// SingleQuote — the prime operator
				primeCallSuffixes = [];
			}
			else if (base === undefined) {
				base = p;
			}
			else if (primeCallSuffixes !== undefined) {
				primeCallSuffixes.push(p);
			}
			else {
				segments.push(p);
			}
		}
		var node = { type: "ChainExpr", base, segments };
		if (primeCallSuffixes !== undefined) node.primeCallSuffixes = primeCallSuffixes;
		if (as) node.as = as.annotation;
		return node;
	},
};
