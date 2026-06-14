// inspect-ast.js — temporary archetype shape review tool.
//
// Dumps AST shapes for minimal inputs covering the 6 archetype
// families (NumberLit, DefVarStmt, Program, BlockExpr, AddBinExpr,
// ChainExpr) plus key variants. Throwaway scaffolding — delete
// once archetype shapes are signed off and propagation across the
// remaining ~200 productions begins.

import util from "node:util";
import { parseFoi } from "./parser.js";


var samples = [
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
	// §11 BLOCKS / DEF-BLOCK STATEMENT
	// =============================================================

	// BlockExpr — defs-init + body + :as archetype
	{ label: "BlockExpr: bare",                      src: "{ x; };" },
	{ label: "BlockExpr: with defs",                 src: "(x: 1) { x; };" },
	{ label: "BlockExpr: defs + :as",                src: "(x: 1) { x; } :as int;" },

	// BlockDefsInitOpt — exercises VarDefInitOpt's init-less form
	{ label: "BlockExpr: defs no init",              src: "(x, y) { x; };" },
	{ label: "BlockExpr: mixed defs",                src: "(x: 1, y) { x; };" },

	// DefBlockStmt — required defs + body
	{ label: "DefBlockStmt: def (x: 1) { x; }",            src: "def (x: 1) { x; };" },
	{ label: "DefBlockStmt: def (x: 1, y: 2) { x + y; }",  src: "def (x: 1, y: 2) { x + y; };" },


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
];


for (let { label, src } of samples) {
	console.log(`\n=== ${label} ===`);
	console.log(`    src: ${src}`);
	try {
		for await (let tree of parseFoi(src)) {
			console.log(util.inspect(tree, { depth: null, colors: false }));
		}
	}
	catch (err) {
		console.log(`!! threw: ${err.message}`);
	}
}
