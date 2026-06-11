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
		if (as) inner.as = as;
		return inner;
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
		if (as) node.as = as;
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
		if (as) node.as = as;
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
		if (as) node.as = as;
		return node;
	},
};
