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
	// DestructureNamedDef) — NOT by ChainExpr, which inlines its
	// segments directly. Each segment is a DotIdentifier or
	// BracketExpr; already type-tagged, just collected.
	SingleAccessExpr(frame,parts) {
		return { type: "SingleAccessExpr", segments: parts.filter(isNode) };
	},

	// Same shape as SingleAccessExpr with a broader segment alphabet
	// (adds DotBracketExpr, DotAngleExpr). Used by MultiAccessSeg
	// contexts.
	MultiAccessExpr(frame,parts) {
		return { type: "MultiAccessExpr", segments: parts.filter(isNode) };
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

	// Call suffix — prefix form (`(arg1, arg2)` or `(op)` partial).
	// CallArgs has two arms gated by lookahead: the first arm
	// `(Op SingleQuote? &(CloseParen))` only fires when the closing
	// delimiter is `)`, so the bare-Op form is reachable here but
	// not in PartialCallSuffix. Op is hidden — its terminal content
	// splices directly into parts and accumulates into `op`. The
	// regular arm produces nodes which flow into `args`. The
	// `primed` flag (presence-only) records the argument-reversal
	// modifier on the Op-form. `args` and `op` are mutually
	// exclusive; absence of `op` indicates the regular form.
	PrefixCallSuffix(frame,parts) {
		var args = [];
		var op = "";
		var primed;
		for (let p of parts) {
			if (isNode(p)) args.push(p);
			else if (p.type === "SingleQuote") primed = true;
			else if (
				p.type === "OpenParen" ||
				p.type === "CloseParen" ||
				p.type === "Comma"
			) {
				// structural delimiter — skip
			}
			else {
				// Op-form: accumulate operator token text
				op += p.value;
			}
		}
		var node = { type: "PrefixCallSuffix", args };
		if (op) node.op = op;
		if (primed) node.primed = true;
		return node;
	},

	// Call suffix — partial form (`|arg1, arg2|`). Unlike
	// PrefixCallSuffix, the CallArgs bare-Op arm doesn't reach this
	// production — its `&(CloseParen)` lookahead fails on the `|`
	// closer. Op-as-argument inside a partial-suffix must be
	// parenthesized (e.g. `foo|(+)|`), arriving as an OpFuncExpr
	// node in `args`. No `op` or `primed` fields.
	PartialCallSuffix(frame,parts) {
		var args = [];
		for (let p of parts) {
			if (isNode(p)) args.push(p);
			// else: Pipe, Comma — skip
		}
		return { type: "PartialCallSuffix", args };
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
