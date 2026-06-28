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

	// NumberLit escape forms — the five EscapedNumber dispatch arms
	// reachable from syn NumberLit at value position. Four emit
	// Escape + Number (Hex, Octal, Binary, Monadic, plus EscapePlain's
	// BareNumber inner covering signed `\-1_000` and decimal
	// `\100_000.25`); the fifth (EscapePlain + PositiveIntegerLitWithSep,
	// unsigned `\5_000`) emits Escape + PositiveIntegerLit and reaches
	// value position via NumberLit's widened first-alt. The dedicated
	// `\5_000` cluster below verifies that path through OperandExpr
	// and call-arg contexts; §17 ExplicitPropDef key samples cover
	// the PropertyExpr-position reach. The sixth lex arm (EscapeUnicode,
	// `\u<hex>`) is excluded — admitted only inside InterpExpr via
	// UnicodeCharLit.
	//
	// Signed-integer-with-sep (`\-1_000`) goes through BareNumber's
	// "-"? + DigitsWithSep + NotIdentCont arm, which emits Number,
	// so it parses cleanly at value position.
	{ label: "NumberLit: \\hFF (hex)",                            src: "\\hFF;" },
	{ label: "NumberLit: \\h-603A (hex negative)",                src: "\\h-603A;" },
	{ label: "NumberLit: \\o755 (octal)",                         src: "\\o755;" },
	{ label: "NumberLit: \\o-755 (octal negative)",               src: "\\o-755;" },
	{ label: "NumberLit: \\b1100 (binary)",                       src: "\\b1100;" },
	{ label: "NumberLit: \\b-1100 (binary negative)",             src: "\\b-1100;" },
	{ label: "NumberLit: \\-1_000 (sep'd signed integer)",        src: "\\-1_000;" },
	{ label: "NumberLit: \\100_000_003.25 (sep'd decimal)",       src: "\\100_000_003.25;" },
	{ label: "NumberLit: \\@FFFF (monadic, fallback)",            src: "\\@FFFF;" },

	// NumberLit `\u263A` form — NARROWED. No longer reachable at value
	// position; admitted only as the sole contents of an interpolation
	// slot (see InterpExpr in parser.js). Value-position use case is
	// covered in failSamples (test-parser.js).
	{ label: "InterpStr: \\u263A in interp slot (sole)",          src: "`\"`\\u263A`\";" },
	{ label: "InterpStr: \\u263A flanked by text",                src: "`\"hello `\\u263A` world\";" },
	{ label: "SpacingInterpStr: \\u263A in interp slot",          src: "\\`\"`\\u263A`\";" },

	// === InterpExpr slot — Expr arm coverage ===
	// PEG ordered-choice with UnicodeCharLit in front: confirm the
	// Expr arm is fully reachable across all admissible expression
	// shapes. Regression seed: PositiveIntegerLit("42") was rejected
	// when UnicodeCharLit's name-aliased production collided with
	// NumberLit's memo key.

	// NumberLit forms inside slot — every escape arm + bare numbers
	{ label: "InterpStr: slot bare positive int",         src: '`"hi `42` there";' },
	{ label: "InterpStr: slot bare negative int",         src: '`"hi `-5` there";' },
	{ label: "InterpStr: slot bare decimal",              src: '`"hi `3.14` there";' },
	{ label: "InterpStr: slot bare negative decimal",     src: '`"hi `-3.14` there";' },
	{ label: "InterpStr: slot hex escape",                src: '`"hi `\\hFF` there";' },
	{ label: "InterpStr: slot hex negative",              src: '`"hi `\\h-FF` there";' },
	{ label: "InterpStr: slot octal escape",              src: '`"hi `\\o755` there";' },
	{ label: "InterpStr: slot binary escape",             src: '`"hi `\\b1100` there";' },
	{ label: "InterpStr: slot sep'd signed int",          src: '`"hi `\\-1_000` there";' },
	{ label: "InterpStr: slot sep'd decimal",             src: '`"hi `\\100_000.25` there";' },
	{ label: "InterpStr: slot monadic fallback",          src: '`"hi `\\@FFFF` there";' },

	// Other leaf forms inside slot
	{ label: "InterpStr: slot bare Identifier",           src: '`"hi `name` there";' },
	{ label: "InterpStr: slot BooleanLit",                src: '`"hi `true` there";' },
	{ label: "InterpStr: slot EmptyLit",                  src: '`"hi `empty` there";' },
	{ label: "InterpStr: slot BuiltIn ident",             src: '`"hi `Maybe` there";' },

	// CallExpr / chain forms inside slot
	{ label: "InterpStr: slot chain access",              src: '`"hi `foo.bar` there";' },
	{ label: "InterpStr: slot index access",              src: '`"hi `foo[0]` there";' },
	{ label: "InterpStr: slot mixed chain",               src: '`"hi `foo.bar[0].baz` there";' },
	{ label: "InterpStr: slot AtExpr",                    src: '`"hi `Maybe@42` there";' },
	{ label: "InterpStr: slot bare None@",                src: '`"hi `None@` there";' },
	{ label: "InterpStr: slot prefix call",               src: '`"hi `f(1, 2)` there";' },

	// Operator-bearing expressions inside slot
	{ label: "InterpStr: slot binary expr",               src: '`"hi `x + y` there";' },
	{ label: "InterpStr: slot unary bool",                src: '`"hi `?x` there";' },
	{ label: "InterpStr: slot negation",                  src: '`"hi `!x` there";' },
	{ label: "InterpStr: slot pipeline",                  src: '`"hi `x #> f` there";' },
	{ label: "InterpStr: slot AsExpr",                    src: '`"hi `x :as int` there";' },

	// DataStruct forms inside slot
	{ label: "InterpStr: slot RecordTupleLit",            src: '`"hi `<1, 2, 3>` there";' },
	{ label: "InterpStr: slot RecordTupleLit named",      src: '`"hi `<x: 1>` there";' },

	// Nested string forms — spacing-form for the inner per the
	// grammar's plain-in-plain prohibition
	{ label: "InterpStr: slot nested spacing interp",     src: '`"hi `\\`"`name`"` there";' },

	// SpacingInterpStr counterparts — verify the slot grammar works
	// under the spacing form too
	{ label: "SpacingInterpStr: slot bare positive int",  src: '\\`"hi `42` world";' },
	{ label: "SpacingInterpStr: slot bare Identifier",    src: '\\`"hi `name` world";' },
	{ label: "SpacingInterpStr: slot binary expr",        src: '\\`"hi `x + y` world";' },
	{ label: "SpacingInterpStr: slot AsExpr",             src: '\\`"hi `x :as int` world";' },
	{ label: "SpacingInterpStr: slot \\u263A sole",       src: '\\`"hi `\\u263A` world";' },


	// NumberLit `\5_000` form — unsigned separator-bearing integer,
	// routes through PositiveIntegerLitWithSep (emits PositiveIntegerLit).
	// Now admitted at value position via the widened NumberLit first-alt.
	// Compositional samples verify it threads through OperandExpr and
	// call-argument paths (the original parse error fired at NumberLit
	// itself, so any position reachable from NumberLit was blocked).
	{ label: "NumberLit: \\5_000 (sep'd unsigned int, value position)",
	  src: "\\5_000;" },
	{ label: "NumberLit: \\5_000 + 1 (binary operand)",
	  src: "\\5_000 + 1;" },
	{ label: "NumberLit: foo(\\5_000) (call arg)",
	  src: "foo(\\5_000);" },
	{ label: "NumberLit: def x: \\5_000",
	  src: "def x: \\5_000;" },

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

	// ClosedRangeExpr value-form coverage — exercises the top-level
	// expression-position handler (vs. the lifted DotBracket forms
	// above which go through RangeAccessExpr). Covers descending,
	// single-element, and variable-bound forms; ascending and char
	// ranges already present in compound kitchen sink (`2..13`,
	// `\"a\"..\"z\"`).
	{ label: "ClosedRangeExpr value: descending",            src: "5..1;" },
	{ label: "ClosedRangeExpr value: single-element",        src: "3..3;" },
	{ label: "ClosedRangeExpr value: variable bounds",       src: "i..n;" },
	{ label: "ClosedRangeExpr value: char descending",       src: "\"e\"..\"a\";" },

	// (..) op-func form — bare and primed, plus spread call.
	// `(..)(\"a\", \"z\")` already present in compound kitchen sink.
	{ label: "OpFuncExpr (..): descending call",             src: "(..)(5, 1);" },
	{ label: "OpFuncExpr (..) primed: (..')(1, 5)",          src: "(..')(1, 5);" },
	{ label: "OpFuncExpr (..) spread: (..)(...args)",        src: "(..)(...args);" },
	{ label: "OpFuncExpr (pipeline bare): (#>)",     src: "(#>);" },
	{ label: "OpFuncExpr (apply bare): (...)",       src: "(...);" },
	{ label: "OpFuncExpr (...') spread primed (aka gather)",       src: "(...');" },

	// =============================================================
	// ~each — side-effect-only loop. Result is range unchanged
	// (Tuple/Record), empty Tuple for conditional range. Body's
	// per-iter return is discarded except for `Done@` sentinel
	// (early break, innermost loop only).
	// =============================================================

	{ label: "FlowBinExpr ~each: Tuple range, callable RHS",
	  src: "< 1, 2, 3 > ~each log;" },
	{ label: "FlowBinExpr ~each: identifier range, callable RHS",
	  src: "xs ~each log;" },
	{ label: "FlowBinExpr ~each: BareBlockExpr body",
	  src: "xs ~each { log(\"hi\"); };" },
	{ label: "FlowBinExpr ~each: BlockExpr body w/ ident defs",
	  src: "xs ~each (v) { log(v); };" },
	{ label: "FlowBinExpr ~each: BlockExpr body w/ destructure",
	  src: "pairs ~each (<:k, :v>) { log(k, v); };" },
	{ label: "FlowBinExpr ~each: Record range",
	  src: "< a: 1, b: 2 > ~each (v) { log(v); };" },

	// Conditional range (FlowLHS = CondClause). `?[c] ~each` runs
	// while c is truthy; `![c] ~each` runs while c is falsy.
	{ label: "FlowBinExpr ~each: ?[cond] range, BareBlockExpr body",
	  src: "?[!done] ~each { done := true; };" },
	{ label: "FlowBinExpr ~each: ![cond] range, BareBlockExpr body",
	  src: "![done] ~each { done := true; };" },

	// Done@ early termination.
	{ label: "FlowBinExpr ~each: Done@ sentinel in body",
	  src: "xs ~each (v) { ?[v ?> 10]: Done@ empty; log(v); };" },

	// OpFuncExpr surface — bare and primed (primed swaps args).
	{ label: "OpFuncExpr (~each): bare",
	  src: "(~each);" },
	{ label: "OpFuncExpr (~each) applied",
	  src: "(~each)(xs, log);" },
	{ label: "OpFuncExpr (~each) primed: (~each')",
	  src: "(~each');" },
	{ label: "OpFuncExpr (~each) primed applied: (~each')(log, xs)",
	  src: "(~each')(log, xs);" },

	// Partial application — skip range for later supply.
	{ label: "PartialCallExpr on (~each): (~each)|, log|",
	  src: "(~each)|, log|;" },

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
	{ label: "MemberAccessExpr from-end wrap: def last: arr.-1",  src: "def last: arr.-1;" },
	{ label: "MemberAccessExpr from-end -2 wrap: def second: arr.-2", src: "def second: arr.-2;" },
	{ label: "MemberAccessExpr zero-index wrap (regression): def first: arr.0", src: "def first: arr.0;" },
	{ label: "MemberAccessExpr nested: foo.bar.baz", src: "foo.bar.baz;" },
	{ label: "IndexAccessExpr: arr[0]",              src: "arr[0];" },
	{ label: "RangeAccessExpr: arr.[1..5]",          src: "arr.[1..5];" },
	{ label: "RangeAccessExpr (leading): arr.[5..]", src: "arr.[5..];" },
	{ label: "RangeAccessExpr (trailing): arr.[..5]", src: "arr.[..5];" },
	{ label: "PropertyPickExpr: rec.<a,5>",          src: "rec.<a,5>;" },

	// AnglePickEntry shares ComputedPropName with ExplicitPropDef
	// (§17 grammar) — same narrowed alphabet applies. Call/at/
	// postfix forms move to failSamples; paren-wrap rewrites
	// covered below.
	{ label: "PropertyPickExpr (computed ident): rec.<%k>",          src: "rec.<%k>;" },
	{ label: "PropertyPickExpr (computed builtin): rec.<%Maybe>",    src: "rec.<%Maybe>;" },
	{ label: "PropertyPickExpr (computed string): rec.<%\"k\">",     src: "rec.<%\"k\">;" },
	{ label: "PropertyPickExpr (computed pipeline): rec.<%#>",       src: "rec.<%#>;" },
	{ label: "PropertyPickExpr (computed chain): rec.<%foo.bar>",    src: "rec.<%foo.bar>;" },
	{ label: "PropertyPickExpr (computed multi-seg): rec.<%foo.bar.baz>", src: "rec.<%foo.bar.baz>;" },
	{ label: "PropertyPickExpr (computed bracket): rec.<%foo[0]>",   src: "rec.<%foo[0]>;" },
	{ label: "PropertyPickExpr (computed integer): rec.<%5>",        src: "rec.<%5>;" },
	{ label: "PropertyPickExpr (computed bool): rec.<%true>",        src: "rec.<%true>;" },
	{ label: "PropertyPickExpr (computed paren-arith): rec.<%(a + b)>", src: "rec.<%(a + b)>;" },
	{ label: "PropertyPickExpr (computed paren-at): rec.<%(Maybe@42)>", src: "rec.<%(Maybe@42)>;" },
	{ label: "PropertyPickExpr (spread bare): rec.<&keys>",          src: "rec.<&keys>;" },
	{ label: "PropertyPickExpr (spread chain): rec.<&keys.subset>",  src: "rec.<&keys.subset>;" },
	{ label: "PropertyPickExpr (spread index): rec.<&keys[0]>",      src: "rec.<&keys[0]>;" },
	{ label: "PropertyPickExpr (mixed all): rec.<a, 5, %k, &keys>",  src: "rec.<a, 5, %k, &keys>;" },
	{ label: "PropertyPickExpr (bare decimal in pick): %3.14", src: "rec.<%3.14>;" },

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

	// === Spread cluster — TriplePeriod-prefixed args ===
	// Shaper wraps each spread arg in a SpreadArg node. CallExpr
	// emits direct JS spread. PartialCallExpr switches to per-arg-
	// named bind shape (uniform across skip/no-skip × primed/no-
	// primed). The xyz' sample above falls into this same path.
	{ label: "CallExpr spread: foo(...args)",                src: "foo(...args);" },
	{ label: "CallExpr spread + positional: foo(1,...args,2)", src: "foo(1,...args,2);" },
	{ label: "CallExpr primed + spread: foo'(1,...args)",    src: "foo'(1,...args);" },
	{ label: "CallExpr spread w/ inner WS: foo(... args)",   src: "foo(... args);", opts: { preserveSoftDelims: true } },
	{ label: "PartialCallExpr spread: foo|...args|",         src: "foo|...args|;" },
	{ label: "PartialCallExpr spread + positional: foo|1,...args,2|", src: "foo|1,...args,2|;" },
	{ label: "PartialCallExpr skip + spread: foo|1,,...args,2|", src: "foo|1,,...args,2|;" },

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
	{ label: "OpFuncExpr (angle-pick computed): (.<%k>)",         src: "(.<%k>);" },
	{ label: "OpFuncExpr (angle-pick spread): (.<&keys>)",        src: "(.<&keys>);" },
	{ label: "OpFuncExpr (angle-pick mixed dynamic): (.<a,%k,&ks>)", src: "(.<a,%k,&ks>);" },
	{ label: "OpFuncExpr (range-access): (.[1..5])", src: "(.[1..5]);" },
	{ label: "OpFuncExpr (primed): (+')",            src: "(+');" },

	// === Mountain (`/\`) and Valley (`\/`) — postfix curry/uncurry ===
	// Operator shape IS the function's resulting parameter signature
	// shape. `/\` (mountain) → curry: tiered pyramid (one param per
	// call site, by fn.length, outer-tier-only). `\/` (valley) →
	// uncurry: flat n-ary (walks tier chain at apply time).
	//
	// Three postfix mods share the chain-tail slot; mutually exclusive
	// (no stacking). Adjacency to preceding expr and to first CallSuffix
	// is required for /\ and \/.
	{ label: "CurriedExpr: foo/\\",                       src: "foo/\\;" },
	{ label: "UncurriedExpr: foo\\/",                     src: "foo\\/;" },
	{ label: "CurriedExpr + calls: foo/\\(1)(2)(3)",      src: "foo/\\(1)(2)(3);" },
	{ label: "UncurriedExpr + call: foo\\/(1,2,3)",       src: "foo\\/(1, 2, 3);" },
	{ label: "CurriedExpr after access: foo.bar/\\(1)(2)", src: "foo.bar/\\(1)(2);" },
	{ label: "UncurriedExpr after access: foo.bar\\/(1,2)", src: "foo.bar\\/(1, 2);" },

	// OpFuncExpr arms — bare and primed.
	// `(/\')` and `(\/')` are universal-prime forms — admitted by
	// grammar (UnaryOpSym + OpFuncExpr's optional SingleQuote tail),
	// transpiler maps primed-mountain to uncurry body and primed-
	// valley to curry body per inverse-of-inverse semantics.
	{ label: "OpFuncExpr (curry): (/\\)",                 src: "(/\\);" },
	{ label: "OpFuncExpr (uncurry): (\\/)",               src: "(\\/);" },
	{ label: "OpFuncExpr (curry primed → uncurry): (/\\')", src: "(/\\');" },
	{ label: "OpFuncExpr (uncurry primed → curry): (\\/')", src: "(\\/');" },

	// OpFuncExpr applied — semantically equivalent to postfix form.
	{ label: "OpFuncExpr-applied curry: (/\\)(foo)",      src: "(/\\)(foo);" },
	{ label: "OpFuncExpr-applied uncurry: (\\/)(foo)",    src: "(\\/)(foo);" },
	{ label: "OpFuncExpr-applied curry + calls: (/\\)(foo)(1)(2)", src: "(/\\)(foo)(1)(2);" },
	{ label: "OpFuncExpr-applied uncurry + call: (\\/)(foo)(1,2)", src: "(\\/)(foo)(1, 2);" },

	{ label: "OpFuncExpr :as int",                   src: "(+) :as int;" },
	{ label: "OpFuncExpr as callee: (+)(1,2)",       src: "(+)(1,2);" },
	{ label: "OpFuncExpr with prime + call: (+')(1,2)", src: "(+')(1,2);" },
	{ label: "OpFuncExpr (.) from-end: (.)(arr, -1)", src: "(.)(arr, -1);" },
	{ label: "OpFuncExpr (.) non-neg: (.)(arr, 0)",   src: "(.)(arr, 0);" },
	{ label: "OpFuncExpr (.') primed: (.')(-1, arr)", src: "(.')(-1, arr);" },
	{ label: "OpFuncExpr ([]) JS-faithful (regression): ([])(arr, -1)", src: "([])(arr, -1);" },

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
	{ label: "IdentityCallExpr (spaced): @ x",       src: "@ x;" },
	{ label: "IdentityCallExpr (no-space): @2",      src: "@2;" },

	// EffectorCallExpr — `%` effector chain-tail. Single AST type
	// (EffectorCallExpr { source, arg? }) with optional arg; all
	// trivia variants admit, all collapse to the same AST shape
	// modulo source positions.

	// Bare effector forms (no arg)
	{ label: "EffectorCallExpr (bare, no trivia): task%",        src: "task%;" },
	{ label: "EffectorCallExpr (bare, trivia): task %",          src: "task %;" },
	{ label: "EffectorCallExpr (bare, multi-WS): task   %",      src: "task   %;" },

	// Binary forms (with arg) — four trivia variants, same AST
	{ label: "EffectorCallExpr (binary, no trivia): task%env",       src: "task%env;" },
	{ label: "EffectorCallExpr (binary, LHS trivia): task %env",     src: "task %env;" },
	{ label: "EffectorCallExpr (binary, RHS trivia): task% env",     src: "task% env;" },
	{ label: "EffectorCallExpr (binary, both trivia): task % env",   src: "task % env;" },

	// Paren-grouped arg — same AST as un-parenned binary form
	{ label: "EffectorCallExpr (paren arg, no trivia): task%(env)",  src: "task%(env);" },
	{ label: "EffectorCallExpr (paren arg, trivia): task % (env)",   src: "task % (env);" },
	{ label: "EffectorCallExpr (paren arg complex): task%(a + b)",   src: "task%(a + b);" },

	// Full ChainExpr LHS — call / member / index source
	{ label: "EffectorCallExpr (call source): processFile(\"f.txt\")%", src: "processFile(\"f.txt\")%;" },
	{ label: "EffectorCallExpr (member source): obj.task%",         src: "obj.task%;" },
	{ label: "EffectorCallExpr (member-call source): obj.method(x)%", src: "obj.method(x)%;" },
	{ label: "EffectorCallExpr (index source): arr[0]%",            src: "arr[0]%;" },
	{ label: "EffectorCallExpr (call w/arg): processFile(\"f.txt\") % cfg", src: "processFile(\"f.txt\") % cfg;" },

	// Chained on result — parens around effector lift to ChainBase
	{ label: "EffectorCallExpr (chained access): (task%).field",    src: "(task%).field;" },
	{ label: "EffectorCallExpr (chained call): (task%(x))(y)",      src: "(task%(x))(y);" },
	{ label: "EffectorCallExpr (chained .field on arg form): (task % env).field", src: "(task % env).field;" },

	// Greedy ExprNoBlock — `task%(x)(y)` parses as `task % ((x)(y))`,
	// where the arg is `(x)` called on `y`. Same pattern as `@`'s
	// arg consumption (`foo@ (x)(y)` ≡ `foo @ ((x)(y))`). For the
	// "call result of effector" reading, paren the effector:
	// `(task%(x))(y)` — covered above.
	{ label: "EffectorCallExpr (greedy arg: call result): task%(x)(y)", src: "task%(x)(y);" },

	// :as on EffectorCallExpr — annotation wraps the whole effector
	{ label: "EffectorCallExpr :as: (task%) :as Maybe",             src: "(task%) :as Maybe;" },

	// Op-as-function — (%) and (%')
	{ label: "OpFuncExpr (%) bare",                                 src: "(%);" },
	{ label: "OpFuncExpr (%') primed",                              src: "(%');" },
	{ label: "OpFuncExpr (%) applied: (%)(task, env)",              src: "(%)(task, env);" },
	{ label: "OpFuncExpr (%') applied: (%')(env, task)",            src: "(%')(env, task);" },
	{ label: "OpFuncExpr (%) partial: (%)|myIO|",                   src: "(%)|myIO|;" },
	{ label: "OpFuncExpr (%) as def value: def run: (%)",           src: "def run: (%);" },
	{ label: "OpFuncExpr (%) in pipeline: ios ~map (%)",            src: "ios ~map (%);" },

	{ label: "OpFuncExpr (@) 0-arg",                  src: "(@)();" },
	{ label: "OpFuncExpr (@) 1-arg identity",         src: "(@)(7);" },
	{ label: "OpFuncExpr (@) 2-arg dispatch",         src: "(@)(double, 7);" },
	{ label: "OpFuncExpr (@') 1-arg no-op",           src: "(@')(7);" },
	{ label: "OpFuncExpr (@') 2-arg swap",            src: "(@')(7, double);" },
	{ label: "OpFuncExpr (@) partial: (@)|42|",       src: "(@)|42|;" },
	{ label: "OpFuncExpr (@) null-app via partial",   src: "def f: (@)|42|; f();" },

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

	// ComposeOp `+>` / `<+` — FlowBinExpr with strict-OrDispatch RHS.
	// `+>` is forward (left runs first / innermost); `<+` is reverse
	// (left runs last / outermost). Same-op leaves are gathered into
	// a single flat-inline arrow; mixed-op chains naturally split per
	// op via recursion through FlowBinExpr.
	{ label: "FlowBinExpr: +> single stage",
	  src: "inc +> triple;" },
	{ label: "FlowBinExpr: +> chain (guide compute1)",
	  src: "def compute1: inc +> triple +> half;" },
	{ label: "FlowBinExpr: <+ chain",
	  src: "def compute1: half <+ triple <+ inc;" },
	{ label: "FlowBinExpr: +> chain at call-site",
	  src: "(inc +> triple +> half)(11);" },
	{ label: "FlowBinExpr: +> via OpFuncExpr (guide compute2)",
	  src: "def compute2: (+>)(inc, triple, half);" },
	{ label: "FlowBinExpr: <+ via OpFuncExpr",
	  src: "def compute1: (<+)(half, triple, inc);" },
	{ label: "FlowBinExpr: +> primed via OpFuncExpr",
	  src: "def compute2: (+>')(half, triple, inc);" },
	{ label: "FlowBinExpr: +> spread args",
	  src: "(+>)(...fns);" },
	{ label: "FlowBinExpr: <+ spread args",
	  src: "(<+)(...fns);" },
	{ label: "FlowBinExpr: #> via OpFuncExpr (guide)",
	  src: "(#>)(11, inc, triple, half);" },
	{ label: "FlowBinExpr: #>' primed via OpFuncExpr (guide)",
	  src: "(#>')(half, triple, inc, 11);" },
	{ label: "OpFuncExpr (...) apply lift (guide addNumsList)",
	  src: "def addNumsList: (...)(+);" },

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
	{ label: "AssignmentExpr (neg index LHS regression): arr.-1 := y", src: "arr.-1 := y;" },

	// Assignment as binary operand — §5 paren-grouping admits
	// AssignmentExpr in the three operand-position restrictive
	// variants. The bare form `10 + x := 5` is rejected (negative
	// sample below).
	{ label: "GroupedBareOpExprNoEmpty: 10 + (x := 5)",        src: "10 + (x := 5);" },
	{ label: "GroupedBareOpExprNoEmpty: (x := 5) + 1",         src: "(x := 5) + 1;" },
	{ label: "GroupedBareOpExprNoEmpty: (foo.bar := 42) + 1",  src: "(foo.bar := 42) + 1;" },
	{ label: "GroupedBareOpExprNoEmpty: (x := 5) :as int",     src: "(x := 5) :as int;" },

	// GroupedOpExpr inner widening — DefFuncExpr and MatchExpr at
	// binary-operand position. Parallels the (x := 5) admission
	// pattern; both produce values, both compose naturally as
	// flow-tier operands when parenthesized.
	{ label: "GroupedOpExpr (defn): (defn(x)^x+1) +> inc",
	  src: "(defn(x)^x+1) +> inc;" },
	{ label: "GroupedOpExpr (defn): inc +> (defn(x)^x+1)",
	  src: "inc +> (defn(x)^x+1);" },
	{ label: "GroupedOpExpr (defn): (defn) #> (defn) chain",
	  src: "(defn(x)^x*2) #> (defn(x)^x+1);" },
	{ label: "GroupedOpExpr (IndepMatch): (?{...}) +> inc",
	  src: "(?{ ?[c]: 1; ?: 0 }) +> inc;" },
	{ label: "GroupedOpExpr (DepMatch): (?(x){...}) +> log",
	  src: '(?(name){ ?["Kyle"]: "hi"; ?: "?" }) +> log;' },
	{ label: "GroupedOpExpr (IndepMatch): 10 + (?{...}) binary operand",
	  src: "10 + (?{ ?[c]: 1; ?: 0 });" },
	{ label: "GroupedBareOpExprNoEmpty (defn): (defn(x)^x+1)(7) chain base",
	  src: "(defn(x)^x+1)(7);" },
	{ label: "GroupedBareOpExprNoEmpty (IndepMatch): (?{...})(7) chain base",
	  src: "(?{ ?[c]: f; ?: g })(7);" },
	{ label: "GroupedOpExpr canonical: (defn ...) #> (...') — addAll",
	  src: "def addAll: (defn addAll_(args)^(+)(...args)) #> (...');" },

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

	{ label: "GuardedExpr: BlockExprStrict body, ident init", src: '?[x ?> y]: (tmp: x) { x := y; y := tmp; };' },
	{ label: "GuardedExpr: BlockExprStrict body, ident no-init", src: '?[x ?> y]: (tmp) { tmp := x; tmp; };' },
	{ label: "GuardedExpr: BlockExprStrict body, multi entries", src: '?[x ?> y]: (a, b: 0) { a := x; b := y; a + b; };' },

	// CondClause at non-GuardedExpr call sites — same shape, different parents
	{ label: "CondClause as FlowBinExpr LHS",        src: "?[isComplete] ~each { go(); };" },
	{ label: "CondClause inside FuncPrecond",        src: "defn clamped(x) ?[x ?< 0]: 0 ^x;" },
	{ label: "FuncPrecond: negated polarity",        src: "defn require_pos(x) ![x ?> 0]: empty ^x;" },
	{ label: "FuncPrecond: multiple",                src: "defn clamp(x) ?[x ?< 0]: 0 ?[x ?> 100]: 100 ^x;" },
	{ label: "FuncPrecond: with destructure",        src: "defn unpacker(<:a>) ?[a ?< 0]: 0 ^a;" },
	{ label: "FuncPrecond: with curried",            src: "defn divide(x)(y) ?[y ?= 0]: empty ^x / y;" },
	{ label: "FuncPrecond: with block body",         src: "defn block_guarded(x) ?[x ?< 0]: 0 { ^x; };" },
	{ label: "FuncPrecond: with explicit ^x pipeline body", src: "defn pipe_guarded(x) ?[x ?< 0]: 0 ^x #> inc;" },

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

	{ label: "IndepMatch: BlockExprStrict consequent, ident init", src: '?{ ?[x ?< 5]: (y: 3) { x + y; }; ?: 0 };' },
	{ label: "IndepMatch: BlockExprStrict consequent, ident no-init", src: '?{ ?[x ?< 5]: (tmp) { tmp := x; tmp + 1; }; ?: 0 };' },
	{ label: "DepMatch: BlockExprStrict consequent", src: '?(x){ ?[?>= 0]: (tmp: x) { tmp + 1; }; ?: 0 };' },

	// DepMatchExpr / DepPatternStmt / DepCondClause / DepCondBoolExpr
	{ label: "DepMatch: single string atom",              src: '?(name){ ?["Kyle"]: "hi" };' },
	{ label: "DepMatch: multi-atom comma list",           src: '?(name){ ?["Kyle","Fred"]: "hi"; ?: "bye" };' },
	{ label: "DepMatch: operator-led ?and",               src: '?(x){ ?[?and y]: "ok"; ?: "no" };' },
	{ label: "DepMatch: operator-led ?=",                 src: '?(x){ ?[?= 1]: "one"; ?: "other" };' },
	{ label: "DepMatch: operator-led ?as",                src: '?(x){ ?[?as int]: "i"; ?: "?" };' },
	{ label: "DepMatch: mixed atom kinds",                src: '?(x){ ?["foo", ?= 1, ?as int]: "match"; ?: "no" };' },
	{ label: "DepMatch: paren-wrapped fragment unwraps",  src: '?(x){ ?[(?and y)]: "ok"; ?: "no" };' },
	{ label: "DepMatch: implicit-? clause",               src: '?(x){ ["Kyle"]: "hi"; ?: "bye" };' },

	// DepMatchExpr — polarity variants
	{ label: "DepMatch: negated clause ![..]",            src: '?(name){ !["Kyle"]: "stranger"; ?: "friend" };' },
	{ label: "DepMatch: negated multi-atom ![.., ..]",    src: '?(x){ ![1, 2, 3]: "out"; ?: "in" };' },

	// DepMatchExpr — else variants
	{ label: "DepMatch: abbreviated : else",              src: '?(name){ ?["Kyle"]: "hi"; : "bye" };' },
	{ label: "DepMatch: BareBlockExpr else consequent",   src: '?(x){ ?[?= 1]: "one"; ? { log("none"); "?" } };' },

	// DepMatchExpr — # topic reference
	{ label: "DepMatch: # in colon-expr consequent",      src: '?(name){ ?["Kyle"]: log(#); ?: "no" };' },
	{ label: "DepMatch: # in BareBlockExpr consequent",   src: '?(x){ ?[?>= 0] { log(#); "pos" }; ?: "neg" };' },

	// DepMatchExpr — nesting
	{ label: "DepMatch: nested DepMatch in consequent",   src: '?(name){ ?["Kyle"]: ?(age){ ?[?>= 18]: "adult"; ?: "minor" }; ?: "?" };' },

	// DepMatchExpr — multi-clause cascade
	{ label: "DepMatch: multi-clause cascade",            src: '?(x){ ?[1]: "a"; ?[2]: "b"; ?[3]: "c"; ?: "d" };' },

	// DepMatchExpr — operator variations
	{ label: "DepMatch: operator-led !<",                 src: '?(x){ ?[!< 18]: "adult"; ?: "minor" };' },
	{ label: "DepMatch: operator-led ?or",                src: '?(x){ ?[?or y]: "ok"; ?: "no" };' },
	{ label: "DepMatch: operator-led ?in",                src: '?(x){ ?[?in coll]: "found"; ?: "no" };' },

	// DepMatchExpr — topic shape
	{ label: "DepMatch: CallExpr topic",                  src: '?(getName()){ ?["Kyle"]: "hi"; ?: "?" };' },


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

	// Paren-wrap arm widened to `Expr` — admits DefFuncExpr,
	// MatchExpr, AssignmentExpr, BareBlockExpr, DoComprExpr,
	// DoLoopComprExpr, and the full binary ladder (arithmetic,
	// logical, comparison, flow, comprehension) via paren-wrap.
	// Bare arms remain narrow.

	// Binary ladder (rejected bare, admitted paren-wrapped)
	{ label: "RecordTupleLit: paren-wrap AddBinExpr",            src: "<foo: (1 + 2)>;" },
	{ label: "RecordTupleLit: paren-wrap MulBinExpr",            src: "<foo: (a * b)>;" },
	{ label: "RecordTupleLit: paren-wrap CompareBinExpr",        src: "<foo: (x ?= y)>;" },
	{ label: "RecordTupleLit: paren-wrap AndBinExpr",            src: "<foo: (x ?and y)>;" },
	{ label: "RecordTupleLit: paren-wrap pipeline",              src: "<foo: (x #> f)>;" },
	{ label: "RecordTupleLit: paren-wrap comprehension",         src: "<foo: (xs ~map fn)>;" },

	// DefFuncExpr (concise body and block body)
	{ label: "RecordTupleLit: paren-wrap DefFuncExpr concise",   src: "<foo: (defn(x)^x + 1)>;" },
	{ label: "RecordTupleLit: paren-wrap DefFuncExpr block",     src: "<foo: (defn(x){x;})>;" },

	// MatchExpr (independent and dependent)
	{ label: "RecordTupleLit: paren-wrap MatchExpr indep",       src: "<foo: (?{?[c]: 1; ?: 0})>;" },
	{ label: "RecordTupleLit: paren-wrap MatchExpr dep",         src: "<foo: (?(x){?[1]: \"one\";})>;" },

	// AssignmentExpr
	{ label: "RecordTupleLit: paren-wrap AssignmentExpr",        src: "<foo: (x := 5)>;" },

	// BareBlockExpr / do-comprehensions
	{ label: "RecordTupleLit: paren-wrap BareBlockExpr",         src: "<foo: ({x; y;})>;" },
	{ label: "RecordTupleLit: paren-wrap DoComprExpr",           src: "<foo: (IO ~<< {x;})>;" },
	{ label: "RecordTupleLit: paren-wrap DoLoopComprExpr",       src: "<foo: (xs ~<* {y;})>;" },

	// Bare-entry forms (not keyed via ExplicitPropDef)
	{ label: "RecordTupleLit: bare-entry paren-wrap DefFuncExpr", src: "<(defn(x)^x + 1)>;" },
	{ label: "RecordTupleLit: bare-entry paren-wrap pipeline",    src: "<(x #> f), (y #> g)>;" },

	// === SetLit ===
	{ label: "SetLit: bare values",                              src: "<[1, 2, 3]>;" },
	{ label: "SetLit: PickValue + bare",                         src: "<[&foo, x]>;" },
	{ label: "SetLit: nested",                                   src: "<[<[1, 2]>, <[3, 4]>]>;" },
	{ label: "SetLit: paren-wrapped entry",                      src: "<[(x), y]>;" },

	// SetEntry inherits the widening via its RecordTupleValue arm
	{ label: "SetLit: paren-wrap DefFuncExpr",                   src: "<[(defn(x)^x + 1)]>;" },
	{ label: "SetLit: paren-wrap pipeline",                      src: "<[(x #> f), (1 + 2)]>;" },
	{ label: "SetLit: paren-wrap MatchExpr",                     src: "<[(?{?[c]: 1; ?: 0})]>;" },

	// === PickValue (8th access-fold site) ===
	{ label: "PickValue: bare Identifier",                       src: "<&foo>;" },
	{ label: "PickValue: BuiltIn base",                          src: "<&Maybe>;" },
	{ label: "PickValue: single dot-access",                     src: "<&foo.bar>;" },
	{ label: "PickValue: multi-segment access fold",             src: "<&foo.bar.baz>;" },
	{ label: "PickValue: integer member access",                 src: "<&foo.5>;" },
	{ label: "PickValue: negative integer member access",        src: "<&foo.-1>;" },
	{ label: "PickValue: index access",                          src: "<&foo[0]>;" },
	{ label: "PickValue: angle-pick subset (positional)",        src: "<&foo.<1,3>>;" },
	{ label: "PickValue: angle-pick subset (named)",             src: "<&foo.<a,b>>;" },
	{ label: "PickValue: range-pick slice (closed)",             src: "<&foo.[1..3]>;" },
	{ label: "PickValue: range-pick slice (leading)",            src: "<&foo.[2..]>;" },
	{ label: "PickValue: range-pick slice (trailing)",           src: "<&foo.[..3]>;" },

	// Dynamic-pick subsets nested inside PickValue context.
	{ label: "PickValue: angle-pick (computed)",                 src: "<&foo.<%k>>;" },
	{ label: "PickValue: angle-pick (spread)",                   src: "<&foo.<&keys>>;" },
	{ label: "PickValue: angle-pick (mixed dynamic)",            src: "<&foo.<a, %k, &keys>>;" },

	// Set-context dynamic-pick.
	{ label: "SetLit: angle-pick (computed)",                    src: "<[&foo.<%k>]>;" },
	{ label: "SetLit: angle-pick (spread)",                      src: "<[&foo.<&keys>]>;" },

	// === ConcisePropDef (PropertyExpr arms) ===
	{ label: "ConcisePropDef: Identifier",                       src: "<:foo>;" },
	{ label: "ConcisePropDef: numeric (synth NumberLit)",        src: "<:5>;" },
	{ label: "ConcisePropDef: escaped numeric (synth NumberLit)", src: "<:\\5_000>;" },

	// === ExplicitPropDef — static keys (via shapePropertyExpr) ===
	{ label: "ExplicitPropDef: Identifier key",                  src: "<foo: 1>;" },
	{ label: "ExplicitPropDef: numeric key (synth NumberLit)",   src: "<5: x>;" },
	{ label: "ExplicitPropDef: escaped numeric key",             src: "<\\5_000: x>;" },

	// === ExplicitPropDef — computed keys (ComputedPropName synthesis) ===
	//
	// Narrowed alphabet per the §17 ComputedPropName rewrite. Bare arm
	// admits BooleanLit / StringLit / numeric-literal forms /
	// ComputedPropAccessChain (IdentBase + flat dot/bracket access);
	// paren-wrap arm admits the full binary expression ladder via
	// OperandExpr. Call/at/postfix/pick-seg/range-seg forms moved to
	// failSamples; paren-wrap rewrites available for each rejected
	// shape and covered as new positives below.

	// Bare-arm: simple IdentBase / BuiltIn / PipelineTopic
	{ label: "ExplicitPropDef: computed Identifier",             src: "<%foo: 1>;" },
	{ label: "ExplicitPropDef: computed BuiltIn",                src: "<%Maybe: 1>;" },
	{ label: "ExplicitPropDef: computed StringLit",              src: "<%\"k\": 1>;" },
	{ label: "ExplicitPropDef: computed PipelineTopic",          src: "<%#: 1>;" },

	// Bare-arm: access chains (ComputedPropAccessChain — IdentBase
	// + flat dot/bracket segs to arbitrary depth; no pick/range)
	{ label: "ComputedPropName: %foo.bar (single seg dot)",      src: "<%foo.bar: 5>;" },
	{ label: "ComputedPropName: %foo.bar.baz (multi-seg dot)",   src: "<%foo.bar.baz: 5>;" },
	{ label: "ComputedPropName: %foo[0] (bracket index)",        src: "<%foo[0]: 5>;" },
	{ label: "ComputedPropName: %foo.4 (dot integer index)",     src: "<%foo.4: 5>;" },
	{ label: "ComputedPropName: %foo.-3 (dot negative index)",   src: "<%foo.-3: 5>;" },
	{ label: "ComputedPropName: %foo[0].bar (mixed segs)",       src: "<%foo[0].bar: 5>;" },
	{ label: "ComputedPropName: %foo[a + b] (bracket expr)",     src: "<%foo[a + b]: 5>;" },

	// Bare-arm: BooleanLit
	{ label: "ComputedPropName: %true",                          src: "<%true: 1>;" },
	{ label: "ComputedPropName: %false",                         src: "<%false: 1>;" },

	// Bare-arm: numeric-literal alphabet (ComputedPropNumberLit —
	// integers and decimals, signed and unsigned, all escape forms
	// except monadic and unicode escapes — see failSamples.
	{ label: "ComputedPropName: %42 (bare positive integer)",    src: "<%42: 1>;" },
	{ label: "ComputedPropName: %-5 (bare negative integer)",    src: "<%-5: 1>;" },
	{ label: "ComputedPropName: %\\5_000 (escape sep'd integer)", src: "<%\\5_000: 1>;" },
	{ label: "ComputedPropName: %\\-1_000 (signed sep'd int)",   src: "<%\\-1_000: 1>;" },
	{ label: "ComputedPropName: %\\hFF (escape hex)",            src: "<%\\hFF: 1>;" },
	{ label: "ComputedPropName: %\\h-FF (signed hex)",           src: "<%\\h-FF: 1>;" },
	{ label: "ComputedPropName: %\\o73 (escape octal)",          src: "<%\\o73: 1>;" },
	{ label: "ComputedPropName: %\\o-755 (signed octal)",        src: "<%\\o-755: 1>;" },
	{ label: "ComputedPropName: %\\b1010 (escape binary)",       src: "<%\\b1010: 1>;" },
	{ label: "ComputedPropName: %\\b-1100 (signed binary)",      src: "<%\\b-1100: 1>;" },

	// Bare-arm: decimal/float forms (ComputedPropNumberLit's bare
	// Number arm + EscapePlain + Number's BareNumber decimal sub-arm)
	{ label: "ComputedPropName: %3.14 (bare decimal)",           src: "<%3.14: 1>;" },
	{ label: "ComputedPropName: %-3.14 (bare negative decimal)", src: "<%-3.14: 1>;" },
	{ label: "ComputedPropName: %\\100.25 (escape decimal)",     src: "<%\\100.25: 1>;" },
	{ label: "ComputedPropName: %\\100_000.25 (escape sep'd decimal)", src: "<%\\100_000.25: 1>;" },
	{ label: "ComputedPropName: %\\-100.25 (escape negative decimal)", src: "<%\\-100.25: 1>;" },

	// Paren-wrap arm (ComputedPropParenExpr — OperandExpr inner)
	{ label: "ComputedPropName: %(x) (paren-wrap ident)",        src: "<%(x): 1>;" },
	{ label: "ComputedPropName: %(foo.bar) (paren-wrap access)", src: "<%(foo.bar): 1>;" },
	{ label: "ComputedPropName: %(\"u_\" + id) (string concat)", src: "<%(\"u_\" + id): 1>;" },
	{ label: "ComputedPropName: %(a + b) (paren-wrap arith)",    src: "<%(a + b): 1>;" },
	{ label: "ComputedPropName: %(Maybe@42) (paren-wrap at-call)", src: "<%(Maybe@42): 1>;" },
	{ label: "ComputedPropName: %(None@) (paren-wrap None@)",    src: "<%(None@): 1>;" },
	{ label: "ComputedPropName: %(foo(x)) (paren-wrap call)",    src: "<%(foo(x)): 1>;" },
	{ label: "ComputedPropName: %(foo') (paren-wrap primed)",    src: "<%(foo'): 1>;" },
	{ label: "ComputedPropName: %(foo.<a,b>) (paren-wrap pick)", src: "<%(foo.<a,b>): 1>;" },
	{ label: "ComputedPropName: %(foo.[1..3]) (paren-wrap range)", src: "<%(foo.[1..3]): 1>;" },
	{ label: "ComputedPropName: %(<x: 1>) (paren-wrap record)",  src: "<%(<x: 1>): 1>;" },
	{ label: "ComputedPropName: %(3.14) (paren-wrap decimal)",   src: "<%(3.14): 1>;" },
	{ label: "ComputedPropName: %(-3.14) (paren-wrap negative decimal)", src: "<%(-3.14): 1>;" },

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

	// =============================================================
	// Leading-skip-comma + trivia + first item — exercises the
	// `(_ Comma)* (_ X ...)?` fix across all six list productions.
	// Without the leading `_` inside the optional, PEG can't admit
	// trivia between the last leading-skip-comma and the first
	// item (`foo(, x)` would fail at the space).
	// =============================================================

	{ label: "CallArgList: leading-skip + WS + arg in PrefixCallSuffix",
	  src: "foo(, a);" },
	{ label: "VarDefInitOptList: leading-skip + WS + entry in DefBlockStmt",
	  src: "def (, x: 5) { x; };" },
	{ label: "VarDefInitOptImplInList: leading-skip + WS + entry in BlockExpr",
	  src: "data #> (, x: 5) { x + #; };" },
	{ label: "DoVarDefInitOptList: leading-skip + WS + entry in DoBlockExpr",
	  src: "Id ~<< (, x:: foo) { x; };" },
	{ label: "RecordTupleEntryList: leading-skip + WS + entry",
	  src: "<, 1, 2>;" },
	{ label: "SetEntryList: leading-skip + WS + entry",
	  src: "<[, 1, 2]>;" },
];
