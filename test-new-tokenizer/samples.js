export const samples = [
	// =============================================================
	// §1 PROGRAM / STATEMENTS
	// =============================================================

	// Program — homogeneous list-of-statements archetype
	{ label: "Program: two stmts",                   src: "def x: 1; def y: 2;" },


	// =============================================================
	// §2 LITERALS
	// =============================================================

	// NumberLit — literal value-extraction archetype
	{ label: "NumberLit: 42",                        src: "42;" },
	{ label: "NumberLit: 42 :as int",                src: "42 :as int;" },
	{ label: "NumberLit: -5",                        src: "-5;" },
	{ label: "NumberLit: -5 :as int",                src: "-5 :as int;" },

	// BooleanLit
	{ label: "BooleanLit: true",                     src: "true;" },
	{ label: "BooleanLit: false :as bool",           src: "false :as bool;" },

	// EmptyLit
	{ label: "EmptyLit: empty",                      src: "empty;" },
	{ label: "EmptyLit: empty :as int",              src: "empty :as int;" },

	// PlainStr
	{ label: "PlainStr: hello",                      src: '"hello";' },
	{ label: "PlainStr: escaped quote",              src: '"a""b";' },
	{ label: "PlainStr :as string",                  src: '"hi" :as string;' },

	// Spacing-form strings — content includes Whitespace tokens
	// (the *Chars predicates exclude whitespace, forcing it out as
	// its own token type). These productions opt into
	// preserveInnerDelim so the machinery's delim filter doesn't
	// strip whitespace from parts before the shaper sees it.
	{ label: "SpacingEscapedStr: with WS",           src: '\\"hello world";' },

	// InterpStr — with and without interpolation
	{ label: "InterpStr: no interp",                 src: '`"hello";' },
	{ label: "InterpStr: one interp",                src: '`"hi `42` there";' },
	{ label: "InterpStr: two interps",               src: '`"`a` and `b` end";' },

	// SpacingInterpStr
	{ label: "SpacingInterpStr: with WS",            src: '\\`"hi `42` world";' },


	// =============================================================
	// §3 IMPORTS / EXPORTS
	// =============================================================

	// ImportExpr — direct, also covered indirectly via DefVarStmt
	{ label: "ImportExpr (in DefVarStmt)",           src: 'def x: import "foo";' },

	// Export bindings
	{ label: "Export named, no access",              src: "export { a: b };" },
	{ label: "Export named, with access",            src: "export { a: b.c };" },
	{ label: "Export concise, no access",            src: "export { :a };" },
	{ label: "Export concise, with access",          src: "export { :a.b };" },
	{ label: "Export mixed",                         src: "export { a: b.c, :d };" },


	// =============================================================
	// §4 VARIABLE DEFINITIONS / DESTRUCTURING
	// =============================================================

	// DefVarStmt — fixed-shape definition archetype
	{ label: "DefVarStmt: def x: 5",                 src: "def x: 5;" },

	// DefVarStmt — exercises target/init alts beyond the basic case
	{ label: "DefVarStmt: destructure target (concise)", src: "def <:a, :b>: foo;" },
	{ label: "DefVarStmt: destructure target (named)",   src: "def <a: x, b: y>: foo;" },
	{ label: "DefVarStmt: import init",              src: 'def x: import "foo";' },

	// DestructureTarget / DestructureNamedDef / DestructureConciseDef / DestructureCapture
	{ label: "Destructure named, no access",          src: "def < a: src >: payload;" },
	{ label: "Destructure named, with access",        src: "def < a: src.x >: payload;" },
	{ label: "Destructure named, BracketExpr base",   src: "def < a: [k] >: payload;" },
	{ label: "Destructure named, BracketExpr+access", src: "def < a: [k].x >: payload;" },
	{ label: "Destructure concise, with access",      src: "def < :a.b >: payload;" },
	{ label: "Destructure capture (whole value)",     src: "def < #whole >: payload;" },
	{ label: "Destructure mixed (all three forms)",   src: "def < a: src.x, :b, #whole >: payload;" },


	// =============================================================
	// §5 EXPRESSION SCAFFOLDING
	// =============================================================

	// BareIdentifier — all three IdentBase arms; :as hoists onto inner.
	// (Tombstone: "Identifier (via bare): x" and "Identifier (via bare) :as int"
	//  collapsed here — same srcs as BareIdent: identifier / :as int.)
	{ label: "BareIdent: identifier",                src: "x;" },
	{ label: "BareIdent: builtin",                   src: "List;" },
	{ label: "BareIdent: pipeline-#",                src: "#;" },
	{ label: "BareIdent: identifier :as int",        src: "x :as int;" },
	{ label: "BareIdent: builtin :as int",           src: "List :as int;" },
	{ label: "BareIdent: pipeline-# :as int",        src: "# :as int;" },

	// GroupedExpr — outer Expr arm, inner BlockExpr (Expr-level only,
	// can't be reached via ExprNoBlock or below)
	{ label: "GroupedExpr: ({ x; })",                src: "({ x; });" },

	// GroupedExprNoBlock — inner ExprNoBlock (e.g. AssignmentExpr)
	{ label: "GroupedExprNoBlock: arr[(x := 5)]",    src: "arr[(x := 5)];" },

	// GroupedBareOpExpr — paren-wraps BareOperandExpr; `empty` is
	// only reachable here (BareOperandExpr's EmptyLit arm), not via
	// BareOperandExprNoEmpty
	{ label: "GroupedBareOpExpr: (empty)",           src: "(empty);" },

	// GroupedBareOpExprNoEmpty — top-level `(x)`: identifier reaches
	// BareOperandExprNoEmpty's IdentifierExpr arm; deep PEG falls
	// here last after ChainBase's GroupedExpr fails (no chain seg)
	{ label: "GroupedBareOpExprNoEmpty: (x)",        src: "(x);" },

	// GroupedDoExpr — paren-wraps DoComprExpr at binary-operand level
	{ label: "GroupedDoExpr: (m ~<< { x; })",        src: "(m ~<< { x; });" },


	// =============================================================
	// §6 IDENTIFIER EXPRESSIONS / ACCESS / RANGE
	// =============================================================

	// Range — three forms; ClosedRangeExpr requires parens for :as
	{ label: "LeadingRangeExpr (in DotBracket): arr.[5..]",  src: "arr.[5..];" },
	{ label: "TrailingRangeExpr (in DotBracket): arr.[..5]", src: "arr.[..5];" },
	{ label: "ClosedRangeExpr :as int (parenthesized)",      src: "(1..5) :as int;" },

	// MonadConstructor — bare @
	{ label: "MonadConstructor: @",                  src: "@;" },
	{ label: "MonadConstructor :as Maybe",           src: "@ :as Maybe;" },

	// AtExpr — IdentBase + optional access + @
	{ label: "AtExpr (bare base): foo@",             src: "foo@;" },
	{ label: "AtExpr (BuiltIn base): Maybe@",        src: "Maybe@;" },
	{ label: "AtExpr :as: foo@ :as int",             src: "foo@ :as int;" },

	// SingleAccessExpr surfacing via AtExpr — `foo.bar@` folds the
	// access into AtExpr.base per the unified access-fold rule.
	// (Note: same src as "AtExpr (retrofit): foo.bar@" below.)
	{ label: "SingleAccessExpr (in AtExpr): foo.bar@", src: "foo.bar@;" },
	{ label: "AtExpr (retrofit): foo.bar@",          src: "foo.bar@;" },


	// =============================================================
	// §7 FUNCTION CALLS / OP-AS-FUNCTION
	// =============================================================

	// === Access cluster — ChainExpr fold to typed nodes ===
	{ label: "MemberAccessExpr: foo.bar",            src: "foo.bar;" },
	{ label: "MemberAccessExpr (builtin): foo.List", src: "foo.List;" },
	{ label: "MemberAccessExpr (pos index): arr.5",  src: "arr.5;" },
	{ label: "MemberAccessExpr (neg index): arr.-1", src: "arr.-1;" },
	{ label: "MemberAccessExpr nested: foo.bar.baz", src: "foo.bar.baz;" },
	{ label: "IndexAccessExpr: arr[0]",              src: "arr[0];" },
	{ label: "RangeAccessExpr: arr.[1..5]",          src: "arr.[1..5];" },
	{ label: "RangeAccessExpr (leading): arr.[5..]", src: "arr.[5..];" },
	{ label: "RangeAccessExpr (trailing): arr.[..5]", src: "arr.[..5];" },
	{ label: "PropertyPickExpr: rec.<a,5>",          src: "rec.<a,5>;" },

	// === Call cluster — ChainExpr fold ===
	{ label: "CallExpr: foo(1,2)",                   src: "foo(1,2);" },
	{ label: "CallExpr (empty): foo()",              src: "foo();" },
	{ label: "PartialCallExpr: foo|1,2|",            src: "foo|1,2|;" },
	{ label: "PartialCallExpr (OpFunc arg): foo|(+)|", src: "foo|(+)|;" },

	// === Skip-position slots — JS-array-literal semantics ===
	// Exercises the awaitingArg state machine in PrefixCallSuffix
	// (ImpliedEmpty synthesis) and PartialCallSuffix (null insertion),
	// plus trailing-comma decay in both.
	{ label: "CallExpr skip (middle): foo(1,,3)",            src: "foo(1,,3);" },
	{ label: "CallExpr skip (leading): foo(,,3)",            src: "foo(,,3);" },
	{ label: "CallExpr trailing comma: foo(1,2,)",           src: "foo(1,2,);" },
	{ label: "CallExpr multi-skip (guide): myFn(1,,3,,,6)",  src: "myFn(1,,3,,,6);" },
	{ label: "PartialCallExpr skip: foo|1,,3|",              src: "foo|1,,3|;" },
	{ label: "PartialCallExpr skip + trailing: foo|1,,|",    src: "foo|1,,|;" },
	{ label: "PartialCallExpr (empty): foo||",               src: "foo||;" },
	{ label: "PartialCallExpr primed + spread: xyz'|...nums|", src: "xyz'|...nums|;" },

	// === Mixed chains — verifies fold ordering ===
	{ label: "Mixed: foo.bar(1,2)",                  src: "foo.bar(1,2);" },
	{ label: "Mixed: foo(1,2).baz",                  src: "foo(1,2).baz;" },
	{ label: "Mixed: foo.bar(1,2).baz",              src: "foo.bar(1,2).baz;" },
	{ label: "Mixed: arr[0].name",                   src: "arr[0].name;" },

	// === PrimedExpr — wrap base, post-prime calls apply on top ===
	{ label: "PrimedExpr: foo'",                     src: "foo';" },
	{ label: "PrimedExpr in call: foo'(1,2)",        src: "foo'(1,2);" },
	{ label: "PrimedExpr post-access: foo.bar'",     src: "foo.bar';" },
	{ label: "PrimedExpr post-access call: foo.bar'(1,2)", src: "foo.bar'(1,2);" },

	// === OpFuncExpr — four inner forms ===
	{ label: "OpFuncExpr (bare op): (+)",            src: "(+);" },
	{ label: "OpFuncExpr (range): (..)",             src: "(..);" },
	{ label: "OpFuncExpr (multi-tok): ($+)",         src: "($+);" },
	{ label: "OpFuncExpr (empty-bracket): ([])",     src: "([]);" },
	{ label: "OpFuncExpr (angle-pick): (.<a,5>)",    src: "(.<a,5>);" },
	{ label: "OpFuncExpr (range-access): (.[1..5])", src: "(.[1..5]);" },
	{ label: "OpFuncExpr (primed): (+')",            src: "(+');" },
	{ label: "OpFuncExpr :as int",                   src: "(+) :as int;" },
	{ label: "OpFuncExpr as callee: (+)(1,2)",       src: "(+)(1,2);" },
	{ label: "OpFuncExpr with prime + call: (+')(1,2)", src: "(+')(1,2);" },

	// === Synthetic-vs-explicit OpFuncExpr alignment ===
	// These pairs should produce identical args[0] shape (modulo span).
	{ label: "Shortcut primed: foo(+')",             src: "foo(+');" },
	{ label: "Explicit primed (inner '): foo((+'))", src: "foo((+'));" },
	{ label: "Explicit, outer ' on group: foo((+)')", src: "foo((+)');" },

	// === :as on chain forms — verifies attachment to outermost typed node ===
	{ label: "CallExpr :as int",                     src: "foo(1,2) :as int;" },
	{ label: "MemberAccessExpr :as int",             src: "foo.bar :as int;" },
	{ label: "PrimedExpr :as int",                   src: "foo' :as int;" },

	// === AtCallExpr — all four sub-forms ===
	{ label: "AtCallExpr Arm 1: None@",              src: "None@;" },
	{ label: "AtCallExpr Sub-form A: foo@ x",        src: "foo@ x;" },
	{ label: "AtCallExpr Sub-form A w/access: foo.bar@ x", src: "foo.bar@ x;" },
	{ label: "AtCallExpr Sub-form B: foo @ x",       src: "foo @ x;" },
	{ label: "AtCallExpr Sub-form B w/access: foo.bar @ x", src: "foo.bar @ x;" },
	{ label: "AtCallExpr Sub-form C: @ x",           src: "@ x;" },


	// =============================================================
	// §8 UNARY
	// =============================================================

	// SymbolicUnaryExpr — bare ?/!
	{ label: "SymbolicUnaryExpr: ?x",                src: "?x;" },
	{ label: "SymbolicUnaryExpr: !x",                src: "!x;" },

	// NamedUnaryExpr — ?empty / !empty
	{ label: "NamedUnaryExpr: ?empty x",             src: "?empty x;" },

	// Unary + Binary tier interaction — verifies unary stays at BinaryAtom level
	// Expected: AddBinExpr { left: SymbolicUnaryExpr{op:"?", right:x}, op:"+", right:5 }
	{ label: "Tier interact: ?x + 5",                src: "?x + 5;" },

	// Unary with :as
	{ label: "Unary :as: ?x :as bool",               src: "?x :as bool;" },


	// =============================================================
	// §9 BINARY TIERS
	// =============================================================

	// FlowBinExpr — Comprehension token (single)
	{ label: "FlowBinExpr: xs ~map f",               src: "xs ~map f;" },

	// FlowBinExpr — multi-token pipeline op `#>` (Hash + CloseAngle)
	{ label: "FlowBinExpr: xs #> f",                 src: "xs #> f;" },

	// OrBinExpr — single-token BooleanOper
	{ label: "OrBinExpr: a ?or b",                   src: "a ?or b;" },

	// AndBinExpr — single-token BooleanOper
	{ label: "AndBinExpr: a ?and b",                 src: "a ?and b;" },

	// TypeCompareBinExpr — single-token AsTypeOp, NamedType RHS
	{ label: "TypeCompareBinExpr: a ?as int",        src: "a ?as int;" },

	// CompareBinExpr — symbolic op (multi-token Qmark + OpenAngle + Equal)
	{ label: "CompareBinExpr: a ?<= b",              src: "a ?<= b;" },

	// CompareBinExpr — named op (single BooleanOper token)
	{ label: "CompareBinExpr: a ?in xs",             src: "a ?in xs;" },

	// AddBinExpr — flat iter left-folded binary archetype
	{ label: "AddBinExpr: a + b + c",                src: "a + b + c;" },
	{ label: "AddBinExpr: a $+ b",                   src: "a $+ b;" },

	// MulBinExpr — iter, single-token MulOp
	{ label: "MulBinExpr: a * b * c",                src: "a * b * c;" },

	// Mixed precedence — folds into AddBinExpr at the top with nested MulBinExpr
	{ label: "Mixed prec: a + b * c",                src: "a + b * c;" },


	// =============================================================
	// §11 BLOCK EXPRESSIONS / DEF-BLOCK STATEMENT
	// =============================================================
	//
	// Three visible productions: BareBlockExpr (no defs-init,
	// reachable at every block-accepting slot), BlockExpr (defs-init
	// REQUIRED, only at implicit-input positions — FlowRHSImplIn and
	// FuncBodyPipeline body), DefBlockStmt (stmt position, no
	// implicit source). Standalone `(defs){body};` is intentionally
	// rejected by the grammar — the corresponding negatives live in
	// test-parser.js failSamples.

	// BareBlockExpr — bare-body archetype
	{ label: "BareBlockExpr: standalone",                  src: "{ x; };" },
	{ label: "BareBlockExpr: empty body",                  src: "{ };" },
	{ label: "BareBlockExpr: multi-stmt",                  src: "{ x; y; z; };" },

	// BareBlockExpr at <Expr> via AsExpr-wrap (it's the first arm of <AsableExpr>)
	{ label: "BareBlockExpr: :as via AsExpr-wrap",         src: "{ x; } :as int;" },

	// BareBlockExpr at DefVarStmt RHS (reached via <Expr>)
	{ label: "BareBlockExpr: at DefVarStmt RHS",           src: "def x: { y; };" },

	// BareBlockExpr at FlowRHSImplIn — no-defs arm at ComprOp / PipelineOp RHS
	{ label: "BareBlockExpr: ~map no-defs",                src: "list ~map { x; };" },
	{ label: "BareBlockExpr: #> no-defs",                  src: "data #> { x; };" },

	// BareBlockExpr at FuncBodyPipeline body (no-defs arm)
	{ label: "BareBlockExpr: defn #> no-defs body",        src: "defn f(x) #> { x; };" },

	// BlockExpr (defs-init required) — Identifier entries at implicit-input positions
	// FlowRHSImplIn → BlockExpr → BlockDefsInitOptImplIn → VarDefInitOptImplIn
	{ label: "BlockExpr: ~map ident defs",                 src: "list ~map (x) { x; };" },
	{ label: "BlockExpr: ~map mixed defs",                 src: "list ~map (x: 1, y) { x; };" },
	{ label: "BlockExpr: #> ident defs",                   src: "data #> (x) { x; };" },
	{ label: "BlockExpr: defn #> ident defs",              src: "defn f(x) #> (y) { y; };" },

	// BlockExpr w/ destructure-no-init — lenient inner binds from the implicit source
	// (comprehension element / pipeline topic / function positional arg)
	{ label: "BlockExpr: ~map destructure no-init",
	  src: "list ~map (<:a, :b>) { a + b; };" },
	{ label: "BlockExpr: #> destructure no-init",
	  src: "data #> (<:a, :b>) { a + b; };" },
	{ label: "BlockExpr: defn #> destructure no-init",
	  src: "defn f(x) #> (<:a, :b>) { a + b; };" },

	// Lenient VarDefInitOptImplIn — Identifier-with-init and
	// DestructureTarget-with-explicit-init arms at implicit-input
	// positions. The no-init arms are covered above; these exercise
	// the with-init arms (and for destructure, the "explicit overrides
	// implicit" branch of the lenient form).
	{ label: "BlockExpr: defn #> ident-with-init",
	  src: "defn foo(x) #> (x: 3) { x + #; };" },
	{ label: "BlockExpr: defn #> destructure w/ explicit init",
	  src: "defn foo(x) #> (<:x>: src) { x + #; };" },
	{ label: "BlockExpr: #> destructure w/ explicit init",
	  src: "data #> (<:x>: src) { x + #; };" },

	// Multi-stage FuncBodyPipeline — exercises the `(_ FlowOpAndRHS)*`
	// chain iter and the FuncBodyPipeline shaper's chainDelims routing
	// (inter-stage trivia → outermost synthesized FlowBinExpr.delims).
	{ label: "FuncBodyPipeline: defn #> multi-stage",
	  src: "defn foo(x) #> { x + #; } #> { #; };" },

	// Multi-stage standalone FlowBinExpr — chained PipelineOp with
	// both stages using FlowRHSImplIn block arms. Existing
	// `data #> f +> g` is mixed-op and stage-2 ComposeOp (no block arm).
	{ label: "FlowBinExpr: #> chain w/ destructure stage-1",
	  src: "data #> (<:x>: src) { x + #; } #> { #; };" },

	{ label: "FlowBinExpr: #> callable RHS (identifier)",
	  src: "data #> inc;" },
	{ label: "FlowBinExpr: #> callable RHS (curried call)",
	  src: "data #> add(1);" },
	{ label: "FlowBinExpr: #> callable RHS w/ # placement",
	  src: "data #> add(1, #);" },
	{ label: "FlowBinExpr: #> callable multi-# placement",
	  src: "data #> foo(#, 2, #);" },
	{ label: "FuncBodyPipeline: callable-chain canonical",
	  src: "defn compute(x) #> add(1) #> triple #> half;" },

	// DefBlockStmt — strict-optional inner (Identifier-init optional;
	// DestructureTarget-init REQUIRED — no implicit source at top-level `def (...)`)
	{ label: "DefBlockStmt: def (x: 1) { x; }",            src: "def (x: 1) { x; };" },
	{ label: "DefBlockStmt: def (x: 1, y: 2) { x + y; }",  src: "def (x: 1, y: 2) { x + y; };" },
	{ label: "DefBlockStmt: ident no-init",                src: "def (x) { y; };" },
	{ label: "DefBlockStmt: destructure w/ explicit init",
	  src: "def (<:a, :b>: src) { a + b; };" },

	// BareBlockExpr at MatchConsequent / MatchConsequentNoSemi
	// (match consequents have no implicit source, so only the BareBlockExpr
	// arm — not BlockExpr — is reachable here)
	{ label: "BareBlockExpr: IndepMatch consequent",
	  src: "?{ ?[c] { y; } };" },
	{ label: "BareBlockExpr: IndepMatch else (Qmark + bare)",
	  src: "?{ ?[c]: x; ? { y; } };" },
	{ label: "BareBlockExpr: DepMatch consequent",
	  src: '?(x){ ?["a"] { y; } };' },

	// =============================================================
	// §12 ASSIGNMENT
	// =============================================================

	// AssignmentExpr — bare and access forms
	{ label: "AssignmentExpr (bare): x := 5",             src: "x := 5;" },
	{ label: "AssignmentExpr (access): foo.bar := 42",    src: "foo.bar := 42;" },
	{ label: "AssignmentExpr (multi-seg): a.b.c := 1",    src: "a.b.c := 1;" },
	{ label: "AssignmentExpr (bracket): foo[0] := y + 1", src: "foo[0] := y + 1;" },


	// =============================================================
	// §13 FUNCTION DEFINITIONS
	// =============================================================

	// DefFuncExpr cluster — every variant
	{ label: "defn: anonymous + empty params",       src: "defn () ^42;" },
	{ label: "defn: named + params + expr body",     src: "defn add(x, y) ^x + y;" },
	{ label: "defn: @ form + block body",            src: "defn fact@(n) { n; };" },
	{ label: "defn: curried (2 paramSets)",          src: "defn curried(x)(y) ^x;" },
	{ label: "defn: :over clause",                   src: "defn ovr(x) :over(y, z) ^x;" },
	{ label: "defn: :as clause + empty params",      src: "defn typed() :as MyType ^empty;" },
	{ label: "defn: pipeline body",                  src: "defn pipe(x) #> log;" },
	{ label: "defn: gather parameter",               src: "defn gather(*args) ^args;" },
	{ label: "defn: with FuncPrecond",               src: "defn clamped(x) ?[x ?< 0]: 0 ^x;" },

	{ label: "defn: curried (3 paramSets)",          src: "defn f(x)(y)(z) ^x + y + z;" },
	{ label: "defn: anonymous curried",              src: "defn(x)(y) ^x + y;" },
	{ label: "defn: curried + destructure outer",    src: "defn f(<:a>)(y) ^a + y;" },
	{ label: "defn: curried + destructure inner",    src: "defn f(x)(<:a>) ^x + a;" },
	{ label: "defn: curried + gather inner",         src: "defn f(x)(*args) ^x;" },
	{ label: "defn: curried + pipeline body",        src: "defn pipe(x)(y) #> add(1);" },

	// §13 — defn with destructure parameter (ParameterList → VarDefInitOptImplIn)
	{ label: "defn: destructure param (no default)",
	  src: "defn f(<:a, :b>) ^a + b;" },
	{ label: "defn: destructure param (with default)",
	  src: "defn f(<:a, :b>: defs) ^a + b;" },
	{ label: "defn: destructure + ident param",
	  src: "defn f(<:a, :b>, c) ^a + b + c;" },

	{ label: "defn: destructure + pipeline body",
	  src: "defn foo(<:z>) #> inc;" },
	{ label: "defn: destructure + pipeline w/ # placement",
	  src: "defn foo(<:z>) #> add(z, #);" },
	{ label: "defn: curried destructure + pipeline body",
	  src: "defn foo(<:x>)(<:y>)(<:z>) #> inc #> { x + y + #; };" },
	{ label: "defn: destructure-with-init + pipeline",
	  src: "defn foo(<:z>: src) #> inc;" },


	// =============================================================
	// §14 CONDITIONALS / GUARDS
	// =============================================================

	// CondClause + GuardedExpr — basic + variants
	{ label: "GuardedExpr: bare",                    src: "?[x ?< 5]: x + 1;" },
	{ label: "GuardedExpr: negated (Exmark)",        src: "![ready]: shutdown();" },
	{ label: "GuardedExpr: BlockExpr consequent",    src: "?[ready]: { go(); };" },
	{ label: "GuardedExpr (sanity): !empty unary",   src: "?[!empty x]: log(x);" },

	// CondClause at non-GuardedExpr call sites — same shape, different parents
	{ label: "CondClause as FlowBinExpr LHS",        src: "?[isComplete] ~each { go(); };" },
	{ label: "CondClause inside FuncPrecond",        src: "defn clamped(x) ?[x ?< 0]: 0 ^x;" },


	// =============================================================
	// §15 MATCH EXPRESSIONS
	// =============================================================

	// IndepMatchExpr / IndepPatternStmt / ElseStmt
	{ label: "IndepMatch: bare ?[..]",                    src: '?{ ?[x ?= 1]: "one" };' },
	{ label: "IndepMatch: implicit-? form [..]",          src: '?{ [x ?= 1]: "one" };' },
	{ label: "IndepMatch: negated ![..]",                 src: '?{ ![x ?= 1]: "no" };' },
	{ label: "IndepMatch: with explicit ?: else",         src: '?{ ?[x]: "yes"; ?: "no" };' },
	{ label: "IndepMatch: with abbreviated : else",       src: '?{ ?[x]: "yes"; : "no" };' },
	{ label: "IndepMatch: block consequent",              src: '?{ ?[x]: { log("hi"); "ok" }; ?: "no" };' },

	// DepMatchExpr / DepPatternStmt / DepCondClause / DepCondBoolExpr
	{ label: "DepMatch: single string atom",              src: '?(name){ ?["Kyle"]: "hi" };' },
	{ label: "DepMatch: multi-atom comma list",           src: '?(name){ ?["Kyle","Fred"]: "hi"; ?: "bye" };' },
	{ label: "DepMatch: operator-led ?and",               src: '?(x){ ?[?and y]: "ok"; ?: "no" };' },
	{ label: "DepMatch: operator-led ?=",                 src: '?(x){ ?[?= 1]: "one"; ?: "other" };' },
	{ label: "DepMatch: operator-led ?as",                src: '?(x){ ?[?as int]: "i"; ?: "?" };' },
	{ label: "DepMatch: mixed atom kinds",                src: '?(x){ ?["foo", ?= 1, ?as int]: "match"; ?: "no" };' },
	{ label: "DepMatch: paren-wrapped fragment unwraps",  src: '?(x){ ?[(?and y)]: "ok"; ?: "no" };' },
	{ label: "DepMatch: implicit-? clause",               src: '?(x){ ["Kyle"]: "hi"; ?: "bye" };' },


	// =============================================================
	// §16 DO-COMPREHENSIONS
	// =============================================================

	// DoComprExpr — bare body, no defs
	{ label: "DoComprExpr: Foo ~<< { y }",                       src: "Foo ~<< { y };" },

	// DoComprExpr — with defs
	{ label: "DoComprExpr w/defs: Foo ~<< (x) { x }",            src: "Foo ~<< (x) { x };" },

	// DoComprExpr — final unwrap
	{ label: "DoComprExpr w/final: Foo ~<< { ::y }",             src: "Foo ~<< { ::y };" },

	// DoComprExpr — full: defs + body stmts + final unwrap
	{ label: "DoComprExpr full",                                 src: "Foo ~<< (x: 1) { def y:: getY(); ::y; };" },

	// DoComprExpr — BuiltIn targetType
	{ label: "DoComprExpr (BuiltIn): IO ~<< { y }",              src: "IO ~<< { y };" },

	// DoVarDefInitOpt — both op forms and no-init
	{ label: "DoVarDefInitOpt (::): Foo ~<< (x:: 1) { y }",      src: "Foo ~<< (x:: 1) { y };" },
	{ label: "DoVarDefInitOpt (:): Foo ~<< (x: 1) { y }",        src: "Foo ~<< (x: 1) { y };" },
	{ label: "DoVarDefInitOpt (no init): Foo ~<< (x) { y }",     src: "Foo ~<< (x) { y };" },

	// DoDefVarStmt — inside a do-block
	{ label: "DoDefVarStmt: Foo ~<< { def x:: 5; y; }",          src: "Foo ~<< { def x:: 5; y; };" },

	// DoFinalUnwrapExpr — minimal
	{ label: "DoFinalUnwrapExpr: Foo ~<< { ::42 }",              src: "Foo ~<< { ::42 };" },

	// DoLoopComprExpr — non-block iter (Identifier)
	{ label: "DoLoopComprExpr (ident iter): xs ~<* fn",          src: "xs ~<* fn;" },

	// DoLoopComprExpr — non-block iter (chain)
	{ label: "DoLoopComprExpr (chain iter): xs ~<* foo.bar",     src: "xs ~<* foo.bar;" },

	// DoLoopComprExpr — block iter, no defs
	{ label: "DoLoopComprExpr (block, no defs): xs ~<* { y }",   src: "xs ~<* { y };" },

	// DoLoopComprExpr — block iter, with defs
	{ label: "DoLoopComprExpr (block + defs): xs ~<* (r) { r }", src: "xs ~<* (r) { r };" },

	// DoLoopComprExpr — block iter, with final unwrap
	{ label: "DoLoopComprExpr (block + final): xs ~<* (r) { ::r }", src: "xs ~<* (r) { ::r };" },


	// =============================================================
	// §17 DATA STRUCTURE LITERALS
	// =============================================================

	// === RecordTupleLit ===
	{ label: "RecordTupleLit: single bare value",                src: "<1>;" },
	{ label: "RecordTupleLit: bare values",                      src: "<1, 2, 3>;" },
	{ label: "RecordTupleLit: ConcisePropDef entries",           src: "<:x, :y>;" },
	{ label: "RecordTupleLit: ExplicitPropDef static",           src: "<x: 1, y: 2>;" },
	{ label: "RecordTupleLit: mixed entry types",                src: "<&foo, x: 1, :bar, 42>;" },
	{ label: "RecordTupleLit: nested",                           src: "<<1, 2>, <3, 4>>;" },
	{ label: "RecordTupleLit: realistic (combined entries)",     src: "<&order, customer: customers[idx]>;" },
	{ label: "RecordTupleLit: paren-wrapped entry",              src: "<(1), 2>;" },
	{ label: "RecordTupleLit: nested-paren entry",               src: "<((1)), 2>;" },
	{ label: "RecordTupleLit: paren-wrapped in ExplicitPropDef", src: "<x: (1)>;" },

	// === SetLit ===
	{ label: "SetLit: bare values",                              src: "<[1, 2, 3]>;" },
	{ label: "SetLit: PickValue + bare",                         src: "<[&foo, x]>;" },
	{ label: "SetLit: nested",                                   src: "<[<[1, 2]>, <[3, 4]>]>;" },
	{ label: "SetLit: paren-wrapped entry",                      src: "<[(x), y]>;" },

	// === PickValue (8th access-fold site) ===
	{ label: "PickValue: bare Identifier",                       src: "<&foo>;" },
	{ label: "PickValue: BuiltIn base",                          src: "<&Maybe>;" },
	{ label: "PickValue: single dot-access",                     src: "<&foo.bar>;" },
	{ label: "PickValue: multi-segment access fold",             src: "<&foo.bar.baz>;" },
	{ label: "PickValue: index access",                          src: "<&foo[0]>;" },

	// === ConcisePropDef (PropertyExpr arms) ===
	{ label: "ConcisePropDef: Identifier",                       src: "<:foo>;" },
	{ label: "ConcisePropDef: numeric (synth NumberLit)",        src: "<:5>;" },
	{ label: "ConcisePropDef: escaped numeric (synth NumberLit)", src: "<:\\5_000>;" },

	// === ExplicitPropDef — static keys (via shapePropertyExpr) ===
	{ label: "ExplicitPropDef: Identifier key",                  src: "<foo: 1>;" },
	{ label: "ExplicitPropDef: numeric key (synth NumberLit)",   src: "<5: x>;" },
	{ label: "ExplicitPropDef: escaped numeric key",             src: "<\\5_000: x>;" },

	// === ExplicitPropDef — computed keys (ComputedPropName synthesis) ===
	{ label: "ExplicitPropDef: computed Identifier",             src: "<%foo: 1>;" },
	{ label: "ExplicitPropDef: computed BuiltIn",                src: "<%Maybe: 1>;" },
	{ label: "ExplicitPropDef: computed StringLit",              src: "<%\"k\": 1>;" },
	{ label: "ExplicitPropDef: computed PipelineTopic",          src: "<%#: 1>;" },
	{ label: "ComputedPropName: %foo.bar (chain access)",   src: "<%foo.bar: 5>;" },
	{ label: "ComputedPropName: %foo[0] (index access)",    src: "<%foo[0]: 5>;" },
	{ label: "ComputedPropName: %Maybe@42 (at-call)",       src: "<%Maybe@42: 5>;" },
	{ label: "ComputedPropName: %None@ (bare None@)",       src: "<%None@: 5>;" },

	// =============================================================
	// §18 TYPE DEFINITIONS
	// =============================================================

	// DefTypeStmt — legacy minimal cluster (overlaps with finer §18 variants below)
	{ label: "DefTypeStmt: deft Foo int",                      src: "deft Foo int;" },
	{ label: "DefTypeStmt: deft Bar (x) ^int",                 src: "deft Bar (x) ^int;" },
	{ label: "DefTypeStmt: deft Baz int | string",             src: "deft Baz int | string;" },

	// NamedType — native arm + bare/dotted arm
	{ label: "DefTypeStmt: NamedType (native)",                src: "deft I int;" },
	{ label: "DefTypeStmt: NamedType (bare single)",           src: "deft F Foo;" },
	{ label: "DefTypeStmt: NamedType (dotted)",                src: "deft E Either.Right;" },
	{ label: "DefTypeStmt: NamedType (BuiltIn.Ident)",         src: "deft S List.Inner;" },

	// UnionTypeExpr — bare 2-arm and 3-arm
	{ label: "DefTypeStmt: UnionTypeExpr (2-arm)",             src: "deft R Ok | Err;" },
	{ label: "DefTypeStmt: UnionTypeExpr (3-arm mixed)",       src: "deft V int | string | Foo;" },

	// NestedTypeExpr — single-arg and union-arg (unwrapped GroupedTypeExpr)
	{ label: "DefTypeStmt: NestedTypeExpr (single arg)",       src: "deft L List{int};" },
	{ label: "DefTypeStmt: NestedTypeExpr (union arg)",        src: "deft E Either{Foo | Bar};" },

	// DataStructTypeExpr — positional values, named fields, rest with braced union
	{ label: "DefTypeStmt: DataStructTypeExpr (positional)",   src: "deft P <int, string>;" },
	{ label: "DefTypeStmt: DataStructTypeExpr (fields+rest)",  src: "deft S <x: int, y: string, *{bool | int}>;" },

	// FuncTypeExpr — basic and complex (optional arg, optional braced-union return, rest)
	{ label: "DefTypeStmt: FuncTypeExpr (basic)",              src: "deft F (int, string) ^ bool;" },
	{ label: "DefTypeStmt: FuncTypeExpr (complex)",            src: "deft G (?int, *{bool | string}) ^?{int | Foo};" },

	// =============================================================
	// PARSER COMPOUND REGRESSIONS
	//
	// Multi-statement and cross-section samples migrated from
	// test-parser.js. Each entry exercises the parse machinery's
	// integrity over compound inputs — adjacent statements, shape
	// interactions, and cross-section combinations not covered by
	// the per-archetype single-statement entries above. Atomic
	// duplicates of existing §-section entries above are dropped;
	// only compound and uniquely-shaped samples are preserved.
	//
	// The audio-player template literal stays in test-parser.js as
	// a realistic-snippet smoke test; its grammar coverage
	// duplicates the focused samples above.
	// =============================================================

	// §4 — DestructureTarget with trailing comma + EmptyLit init
	{ label: "compound §4: destructure trailing comma",
	  src: "def <a: b, c: d,>: empty;" },

	// §5 — nested parens, paren-around-literal
	{ label: "compound §5: nested parens + bare literal",
	  src: "def x: ((42)); def y: (empty); 5;" },
	{ label: "compound §5: paren-around literals",
	  src: '(42); (true); ("hi"); (empty);' },

	// §6 — chain access mix, range access, multi-key angle-pick, AtExpr cluster
	{ label: "compound §6: chain member+bracket+member",
	  src: "def x: foo.bar[42].baz;" },
	{ label: "compound §6: range access (closed/leading/trailing)",
	  src: "def x: arr.[1..5]; def y: arr.[..10]; def z: arr.[5..];" },
	{ label: "compound §6: 3-key angle-pick",
	  src: "def x: rec.<a, b, c>;" },
	{ label: "compound §6: AtExpr + paren-@ + Hash",
	  src: "def x: foo@; def y: (@); def z: #;" },

	// §7 — chain-call mix, primed/op-as-func mix, dot-op-as-func
	{ label: "compound §7: chain calls + bracket + partial",
	  src: 'foo(1, 2); foo.bar(x); ("hi").len; ((42).foo)|y|;' },
	{ label: "compound §7: primed + op-as-func cluster",
	  src: "foo'(1,2,3); def revFoo: (foo'); (+'); (')(+); (+)'(1,2,3); (?empty)(x, y, z);" },
	{ label: "compound §7: dot op-as-func (.)",
	  src: "(.)(numbers, 1);" },

	// §9 — binary tier compound, ?as regression cluster
	{ label: "compound §9: binary tiers + prime + flow ops",
	  src: "1 + 2 * 3; x ?<= y ?and ?empty list ?or n ?in arr; 5'; data #> f +> g;" },
	{ label: "compound §9: ?as regression cluster",
	  src: "age ?as int;" +
		"age !as bool;" +
		"myFn ?as SimpleFunc;" +
		"x ?as List;" +
		"x ?as Either.Right;" +
		"(age ?as int) :as bool;" +
		"?(x){ ?[?as int]: 1; ?: 0 };" +
		"?(x){ ?[?as SimpleFunc]: 1; ?: 0 };" +
		"?{ ?[x ?as int]: 1; ?: 0 };" +
		"x ?as int ?and y ?as bool;" +
		"(?as);" +
		"x ?in arr;" },

	// §11 — Block-family variants compound. Exercises adjacent §11
	// stmts in a Program — BareBlockExpr standalone, BareBlockExpr
	// at FlowRHSImplIn (no-defs), BlockExpr at FlowRHSImplIn (with
	// defs — only reachable from implicit-input positions), and
	// DefBlockStmt. Standalone (defs){body} is rejected by the
	// grammar and is not exercised here.
	{ label: "compound §11: block variants",
	  src: "{ a; b; }; list ~map { y; }; list ~map (x: 5, y) { x + y; }; def (a: 1) { a; };" },

	// §12 — AssignmentExpr forms
	{ label: "compound §12: assignment forms",
	  src: "x := 5; foo.bar := 42; foo.bar[0] := y + 1; a.b.c := (1 + 2);" },

	// §13 — defn cluster
	{ label: "compound §13: defn cluster",
	  src: "defn () ^42; " +
		"defn add(x, y) ^x + y; " +
		"defn fact@(n) { n; }; " +
		"defn curried(x)(y) ^x; " +
		"defn over_ex(x) :over(y, z) ^x; " +
		"defn typed() :as MyType ^empty; " +
		"defn pipe(x) #> log; " +
		"defn gather(*args) ^args;" },

	// §14 — guard variants
	{ label: "compound §14: guard variants",
	  src: "?[x ?< 5]: x + 1; " +
		"defn clamped(x) ?[x ?< 0]: 0 ^x; " +
		"?[isComplete] ~each { isComplete := true; };" },

	// §15 — match variants
	{ label: "compound §15: match variants",
	  src: "?{ [x ?< 0]: -1; [x ?> 0]: 1; ?: 0; }; " +
		"?(x){ [1, 2, 3]: \"low\"; [?> 10]: \"high\"; }; " +
		"?{ [ready]: { go(); }; };" },

	// §16 — do-compr cluster (basic forms + paren-wrap chains)
	{ label: "compound §16: do-compr basic forms",
	  src: "List ~<< { def x:: xs; x + 1 }; " +
		"Id ~<< (x:: foo) { x + 1 }; " +
		"Id ~<< { def x:: foo(); ::bar(x); }; " +
		"Promise ~<* { def r:: get(); };" },
	{ label: "compound §16: do-compr paren-wrap + chain + :as",
	  src: "(1..3 ~<* yield) ~map { \"done\" };" +
		"(Id ~<< { ::42; }) ~< g;" +
		"(env.start..env.end ~<* yield) ~map { \"Complete.\" };" +
		"(x + 1) ~map f;" +
		"def x: (1..3 ~<* yield) :as Foo;" +
		"(1..3 ~<* yield) :as Foo ~map f;" },

	// §17 — RecordTupleLit / SetLit / nested compound
	{ label: "compound §17: record/tuple/set/nested",
	  src: "def t: <1, 2, 3>; " +
		"def r: <a: 1, b: 2>; " +
		"def c: <:foo, :bar>; " +
		"def cp: <%key: 5>; " +
		"def p: <&existing, c: 3>; " +
		"def s: <[1, 2, 3]>; " +
		"def n: <<1, 2>, <3, 4>>;" },

	// §18 — deft variants (native, union, struct, func, nested, dotted, gather, trailing-comma)
	{ label: "compound §18: deft variants",
	  src: "deft Status int; " +
		"deft Color Red | Green | Blue; " +
		"deft Point <x: int, y: int>; " +
		"deft Tuple <int, string, *bool>; " +
		"deft Adder (int, int) ^int; " +
		"deft Nullary () ^empty; " +
		"deft Optional (?X) ^?Y; " +
		"deft Wrapped List{int}; " +
		"deft Dotted Either.Right; " +
		"deft Complex (string, *{(int) ^int}) ^{\"yes\" | \"no\"}; " +
		"deft G <*int>; " +
		"deft P <x: int, y: int,>; " +
		"deft F (int, int,) ^int; " +
		"deft D A.B.C; " +
		"deft H (*int) ^empty;" },

	// Cross-§ — specific cross-section regressions
	{ label: "compound cross-§: PickValue + ^(DoCompr) + Maybe._@ + destructure-with-init",
	  src: "def t: <0, &nums.<1,3>, &person.last, 8>; " +
		"defn fn() ^(Promise ~<< { def x:: getX(); ::x; }); " +
		"Maybe._ @ 42; " +
		"def (< :p, capt: items.0 >: getOrder(123)) { p; }; " +
		"Maybe ~<< (< :v >:: getMaybe()) { v; };" },

	// Kitchen sink — numbers/person realistic compound. Unique cross-§ coverage:
	// PickValue with varied access (`&nums.<1,3>`, `&nums.[..2]`, `&person.<first,nickname>`),
	// ComputedPropName in record key + computed index (`<%nums: ...>`, `dm[nums]`),
	// set ops `?$=` / `!$=`, record concat `$+`, range operand variants, `?has`/`!has`.
	{ label: "compound kitchen sink: numbers/person realistic",
	  src: "def numbers: < 4, 5, 6 >; " +
		"def person: < first: \"Kyle\", last: \"Simpson\" >; " +
		"numbers.1; person.first; numbers[idx]; person[\"first\"]; " +
		"(.)(numbers, 1); (.)(person, \"first\"); " +
		"str.1; size(< a: 1 >); " +
		"def nums: < 5, 10, 15, %idx: 20, 25 >; " +
		"def p2: < %\"favorite number\": 42 >; " +
		"def p3: < :first, :last >; " +
		"7 ?in numbers; person ?has \"first\"; person !has \"x\"; " +
		"def r1: 2..13; def r2: two..thirteen; def r3: \"a\"..\"z\"; " +
		"def r4: (..)(\"a\", \"z\"); " +
		"odds + evens; " +
		"numbers.<1,3>; (.<1,3>)(numbers); " +
		"numbers.[..0]; numbers.[..-2]; numbers.-1; " +
		"numbers.[-1..]; numbers.[1..]; numbers.[1..3]; " +
		"(.[1..3])(numbers); " +
		"def all: < 0, 1, &numbers, 7, 8 >; " +
		"def odd: < 1, 3, &numbers.1, 7 >; " +
		"def fr: < first: \"Jenny\", &person.last >; " +
		"def ev: < 2, &numbers.<1,3>, 8 >; " +
		"def fb: < 0, 1, &numbers.[..2] >; " +
		"def pf: < &person.<first,nickname> >; " +
		"def fewer: < 0, &numbers, 2: empty, 4: empty >; " +
		"def dm: < %numbers: \"my favorites\" >; dm[numbers]; " +
		"def un: <[ &something, &another ]>; " +
		"def mn: numbers $+ < 6, 7 >; " +
		"set1 ?$= set2; set1 !$= set3;" },

	// =============================================================
	// α-CLAIM — STMT-SEMI FAMILY
	//
	// Exercises shapeStmtSemi across the pattern × parent matrix.
	//   Pattern axis: stmt+1/N/0 semis, bare semi runs, leading
	//                 bare-semi → EmptyStmt synthesis.
	//   Parent axis:  the 5 stmt-list containers — Program (§1),
	//                 BlockExpr (§11), DefBlockStmt (§11),
	//                 FuncBodyBlock (§13), DoBlockExpr (§16). Each
	//                 non-Program sample also produces an outer
	//                 Program lift via its trailing `;;`.
	//
	// The fully-empty StmtSemiOpt at EOF (the case that caused
	// Program.end=null) is exercised by every sample not ending in
	// `;` — Program's trailing-Opt always fires.
	// =============================================================

	// Pattern axis — Program parent
	{ label: "α-claim: stmt + 1 semi (claim, no lift)",     src: "def x: 2;" },
	{ label: "α-claim: stmt + 2 semis (1 lifts)",           src: "def x: 2;;" },
	{ label: "α-claim: stmt + 3 semis (2 lift)",            src: "def x: 2;;;" },
	{ label: "α-claim: stmt + no semi (no claim, no lift)", src: "def x: 2" },
	{ label: "α-claim: bare 1 semi → EmptyStmt",            src: ";" },
	{ label: "α-claim: bare 2 semis (1 lifts)",             src: ";;" },
	{ label: "α-claim: leading EmptyStmt + stmt",           src: "; def x: 1;" },
	{ label: "α-claim: two stmts, each with lift",          src: "def x: 1;; def y: 2;;" },

	// Parent axis — non-Program containers
	{ label: "α-claim: ExportStmtSemi + lift to Program",   src: "export { :foo };;" },
	{ label: "α-claim: BlockExpr lift",                     src: "{ def a: 1;; };" },
	{ label: "α-claim: DefBlockStmt lift",                  src: "def (x: 1) { def a: 1;; };" },
	{ label: "α-claim: FuncBodyBlock lift",                 src: "def f: defn(){ def a: 1;; ^a };;" },
	{ label: "α-claim: DoBlockExpr lift",                   src: "def r: Foo ~<< { def x:: 1;; ::x };;" },

	// =============================================================
	// α-SOFT — SOFT-DELIM PARTITIONING UNDER preserveSoftDelims:true
	//
	// Exercises shapeFrame's lift-branch soft-delim partition:
	// soft tokens (Whitespace, Comment) inside a shaper's claim
	// region (i.e. <= node.end) merge into node.delims; soft
	// tokens past the claim end interleave into __lift in source
	// order, landing on the parent stmt-list container's delims.
	//
	// These samples MUST run with preserveSoftDelims:true (per-
	// sample opts override) — the default mode strips soft delims
	// entirely and would not exercise the partition logic.
	// =============================================================

	{ label: "α-soft: WS in claim region",       src: "def x: 2 ;",          opts: { preserveSoftDelims: true } },
	{ label: "α-soft: WS in lift region",        src: "def x: 2; ;",         opts: { preserveSoftDelims: true } },
	{ label: "α-soft: WS in both partitions",    src: "def x: 2 ; ;",        opts: { preserveSoftDelims: true } },
	{ label: "α-soft: comment in lift",          src: "def x: 2; ///c/// ;", opts: { preserveSoftDelims: true } },

	// α-WRAPPER — adaptive wrapper retention for :as / :over
	{ label: "α-wrap: AsExpr keeps wrapper",       src: "foo :as int;",                      opts: { preserveSoftDelims: true } },
	{ label: "α-wrap: GroupedExpr keeps wrapper",  src: "(x) :as int;",                      opts: { preserveSoftDelims: true } },
	{ label: "α-wrap: FuncAsClause keeps wrapper", src: "defn f() :as Int ^x;",              opts: { preserveSoftDelims: true } },
	{ label: "α-wrap: FuncOverClause w/ inner WS", src: "defn ovr(x) :over(y, z) ^x;",       opts: { preserveSoftDelims: true } },

	// α-NESTED-AS — investigate filed clobber on (x :as int) :as bool.
	// Default opts: the question is default-mode AST shape, not
	// soft-delim behavior. Reading: does inner .as survive? does
	// outer .as appear? are they on distinct nodes?
	{ label: "α-nested-as: inner only", src: "(x :as int);" },
	{ label: "α-nested-as: inner only", src: "(x :as int);", opts: { preserveSoftDelims: true } },
	{ label: "α-nested-as: outer only", src: "(x) :as bool;" },
	{ label: "α-nested-as: outer only", src: "(x) :as bool;", opts: { preserveSoftDelims: true } },
	{ label: "α-nested-as: both",       src: "(x :as int) :as bool;" },
	{ label: "α-nested-as: both",       src: "(x :as int) :as bool;", opts: { preserveSoftDelims: true } },

	// =============================================================
	// WS-permutation grid — chain-fold dot positions
	// =============================================================
	// Verifies internal WS straddling the dot is round-tripped in
	// every position. Each pattern is grammatically valid per the
	// `Period _ ...` rules in §6. preserveSoftDelims required —
	// without it WS is discarded and the variants collapse to
	// identical ASTs.

	{ label: "Member WS-before-dot: foo .bar",       src: "foo .bar;",       opts: { preserveSoftDelims: true } },
	{ label: "Member WS-after-dot: foo. bar",        src: "foo. bar;",       opts: { preserveSoftDelims: true } },
	{ label: "Member WS-both: foo . bar",            src: "foo . bar;",      opts: { preserveSoftDelims: true } },

	{ label: "Member-int WS-before: arr .5",         src: "arr .5;",         opts: { preserveSoftDelims: true } },
	{ label: "Member-int WS-after: arr. 5",          src: "arr. 5;",         opts: { preserveSoftDelims: true } },
	{ label: "Member-int WS-both: arr . 5",          src: "arr . 5;",        opts: { preserveSoftDelims: true } },
	{ label: "Member-int neg WS-after: arr. -1",     src: "arr. -1;",        opts: { preserveSoftDelims: true } },
	{ label: "Member-int neg WS-both: arr . -1",     src: "arr . -1;",       opts: { preserveSoftDelims: true } },

	{ label: "Range WS-before-dot: arr .[1..5]",     src: "arr .[1..5];",    opts: { preserveSoftDelims: true } },
	{ label: "Range WS-inside-open: arr.[ 1..5]",    src: "arr.[ 1..5];",    opts: { preserveSoftDelims: true } },
	{ label: "Range WS-inside-close: arr.[1..5 ]",   src: "arr.[1..5 ];",    opts: { preserveSoftDelims: true } },
	{ label: "Range WS-inside-both: arr.[ 1..5 ]",   src: "arr.[ 1..5 ];",   opts: { preserveSoftDelims: true } },

	{ label: "Pick WS-before-dot: rec .<a,b>",       src: "rec .<a,b>;",     opts: { preserveSoftDelims: true } },
	{ label: "Pick WS-inside-open: rec.< a,b>",      src: "rec.< a,b>;",     opts: { preserveSoftDelims: true } },
	{ label: "Pick WS-before-comma: rec.<a ,b>",     src: "rec.<a ,b>;",     opts: { preserveSoftDelims: true } },
	{ label: "Pick WS-after-comma: rec.<a, b>",      src: "rec.<a, b>;",     opts: { preserveSoftDelims: true } },
	{ label: "Pick WS-around-comma: rec.<a , b>",    src: "rec.<a , b>;",    opts: { preserveSoftDelims: true } },
	{ label: "Pick WS-inside-close: rec.<a,b >",     src: "rec.<a,b >;",     opts: { preserveSoftDelims: true } },
	{ label: "Pick WS-everywhere: rec.< a , b >",    src: "rec.< a , b >;",  opts: { preserveSoftDelims: true } },
	{ label: "Pick int WS-around-comma: rec.<a , 5>", src: "rec.<a , 5>;",   opts: { preserveSoftDelims: true } },

	// =============================================================
	// WS-permutation grid — FuncTypeExpr optional-return `?`
	// =============================================================

	{ label: "FuncTypeArg optional: deft F (?int) ^ int", src: "deft F (?int) ^ int;", opts: { preserveSoftDelims: true } },
	{ label: "FuncType opt-return adjacent: (int) ^?int", src: "deft F (int) ^?int;", opts: { preserveSoftDelims: true } },
	{ label: "FuncType opt-return WS-after-caret: (int) ^ ?int", src: "deft F (int) ^ ?int;", opts: { preserveSoftDelims: true } },
	{ label: "FuncType opt-return WS-after-qmark: (int) ^? int", src: "deft F (int) ^? int;", opts: { preserveSoftDelims: true } },
	{ label: "FuncType opt-return WS-both: (int) ^ ? int", src: "deft F (int) ^ ? int;", opts: { preserveSoftDelims: true } },

	// =============================================================
	// COMMENT COVERAGE — preserveSoftDelims:true mandatory
	//
	// Verifies LineComment (`// ... \n`) and BlockComment
	// (`/// ... ///`) tokens flow through the soft-delim machinery
	// across positions: trailing/leading statements, between
	// statements, inside expressions, straddling structural
	// punctuation. Comments are soft delims — same machinery as
	// Whitespace; coverage here verifies the token *kind* doesn't
	// matter to position-fidelity.
	// =============================================================

	{ label: "Comment line: trailing stmt",
	  src: "def x: 1; // trail\n",                                opts: { preserveSoftDelims: true } },
	{ label: "Comment line: trailing stmt, no newline",
	  src: "def x: 1; // EOF-terminated",                         opts: { preserveSoftDelims: true } },
	{ label: "Comment line: between stmts",
	  src: "def x: 1;\n// between\ndef y: 2;",                    opts: { preserveSoftDelims: true } },
	{ label: "Comment line: leading",
	  src: "// leading\ndef x: 1;",                               opts: { preserveSoftDelims: true } },
	{ label: "Comment block: inline single-line",
	  src: "def x: 1 /// inline /// + 2;",                        opts: { preserveSoftDelims: true } },
	{ label: "Comment block: multi-line",
	  src: "def x: ///\n  multi\n  line\n///\n1;",                opts: { preserveSoftDelims: true } },
	{ label: "Comment block: between stmts",
	  src: "def x: 1; /// sep /// def y: 2;",                     opts: { preserveSoftDelims: true } },
	{ label: "Comment block: straddling dot",
	  src: "foo ///c/// .bar;",                                   opts: { preserveSoftDelims: true } },
	{ label: "Comment block: inside paren-group",
	  src: "(x /// note ///);",                                   opts: { preserveSoftDelims: true } },
	{ label: "Comment line+block: adjacent",
	  src: "def x: 1; // line\n/// block ///\ndef y: 2;",         opts: { preserveSoftDelims: true } },

	// =============================================================
	// MULTI-LINE / INDENTATION COVERAGE — preserveSoftDelims:true
	//
	// Verifies newline + leading-tab runs are preserved as part of
	// soft-delim machinery and roundtrip cleanly. The Whitespace
	// token spans all WsChar+ runs (newlines and tabs/spaces folded
	// into one token), so machinery treatment is identical to
	// inline WS — these samples exercise position-fidelity over
	// larger spans across statement-list and grouped contexts.
	// =============================================================

	{ label: "Multi-line: def with newline before value",
	  src: "def x:\n\t42;",                                       opts: { preserveSoftDelims: true } },
	{ label: "Multi-line: RecordTupleLit indented",
	  src: "<\n\t1,\n\t2,\n\t3\n>;",                              opts: { preserveSoftDelims: true } },
	{ label: "Multi-line: defn body on next line",
	  src: "defn add(x, y) {\n\t^x + y;\n};",                     opts: { preserveSoftDelims: true } },
	{ label: "Multi-line: pattern match clauses",
	  src: "?{\n\t?[x ?> 0]: 1;\n\t?: 0\n};",                     opts: { preserveSoftDelims: true } },
	{ label: "Multi-line: chain access over lines",
	  src: "foo\n\t.bar\n\t.baz;",                                opts: { preserveSoftDelims: true } },
	{ label: "Multi-line: mixed with trailing line comment",
	  src: "def x:\n\t42; // note\n",                             opts: { preserveSoftDelims: true } },
];
