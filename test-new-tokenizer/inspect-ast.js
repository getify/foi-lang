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
	// BareIdentifier — subsumes to Identifier; :as hoists onto it
	{ label: "Identifier (via bare): x",      src: "x;" },
	{ label: "Identifier (via bare) :as int", src: "x :as int;" },

	// BareIdentifier variants — all three IdentBase arms
	{ label: "BareIdent: identifier",  src: "x;" },
	{ label: "BareIdent: builtin",     src: "List;" },
	{ label: "BareIdent: pipeline-#",  src: "#;" },
	{ label: "BareIdent: builtin :as int",    src: "List :as int;" },
	{ label: "BareIdent: pipeline-# :as int", src: "# :as int;" },

	// NumberLit — literal value-extraction archetype
	{ label: "NumberLit: 42",              src: "42;" },
	{ label: "NumberLit: 42 :as int",      src: "42 :as int;" },
	{ label: "NumberLit: -5",              src: "-5;" },
	{ label: "NumberLit: -5 :as int",      src: "-5 :as int;" },

	// BooleanLit
	{ label: "BooleanLit: true",           src: "true;" },
	{ label: "BooleanLit: false :as bool", src: "false :as bool;" },

	// EmptyLit
	{ label: "EmptyLit: empty",            src: "empty;" },
	{ label: "EmptyLit: empty :as int",    src: "empty :as int;" },

	// PlainStr
	{ label: "PlainStr: hello",            src: '"hello";' },
	{ label: "PlainStr: escaped quote",    src: '"a""b";' },
	{ label: "PlainStr :as string",        src: '"hi" :as string;' },

	// InterpStr — with and without interpolation
	{ label: "InterpStr: no interp",       src: '`"hello";' },
	{ label: "InterpStr: one interp",      src: '`"hi `42` there";' },
	{ label: "InterpStr: two interps",     src: '`"`a` and `b` end";' },

	// Spacing-form strings — content includes Whitespace tokens
	// (the *Chars predicates exclude whitespace, forcing it out as
	// its own token type). These productions opt into
	// preserveInnerDelim so the machinery's delim filter doesn't
	// strip whitespace from parts before the shaper sees it. No
	// dedicated shaper yet — these will show under default shape;
	// what to verify is that Whitespace tokens are present inside
	// the parts arrays.
	{ label: "SpacingEscapedStr: with WS",  src: '\\"hello world";' },
	{ label: "SpacingInterpStr: with WS",   src: '\\`"hi `42` world";' },

	// DefVarStmt — fixed-shape definition archetype
	{ label: "DefVarStmt: def x: 5",       src: "def x: 5;" },

	// Program — homogeneous list-of-statements archetype
	{ label: "Program: two stmts",         src: "def x: 1; def y: 2;" },

	// BlockExpr — defs-init + body + :as archetype
	{ label: "BlockExpr: bare",            src: "{ x; };" },
	{ label: "BlockExpr: with defs",       src: "(x: 1) { x; };" },
	{ label: "BlockExpr: defs + :as",      src: "(x: 1) { x; } :as int;" },

	// AddBinExpr — flat iter left-folded binary archetype
	{ label: "AddBinExpr: a + b + c",      src: "a + b + c;" },
	{ label: "AddBinExpr: a $+ b",         src: "a $+ b;" },

	// // SingleAccessExpr — via still-default-shaped AtExpr
	{ label: "SingleAccessExpr (in AtExpr): foo.bar@", src: "foo.bar@;" },

	// Range — three forms; ClosedRangeExpr was visible default-shaped before
	{ label: "LeadingRangeExpr (in DotBracket): arr.[5..]",  src: "arr.[5..];" },
	{ label: "TrailingRangeExpr (in DotBracket): arr.[..5]", src: "arr.[..5];" },
	{ label: "ClosedRangeExpr :as int (parenthesized)", src: "(1..5) :as int;" },

	// === Access cluster — ChainExpr fold to typed nodes ===
	{ label: "MemberAccessExpr: foo.bar",          src: "foo.bar;" },
	{ label: "MemberAccessExpr (builtin): foo.List", src: "foo.List;" },
	{ label: "MemberAccessExpr (pos index): arr.5",  src: "arr.5;" },
	{ label: "MemberAccessExpr (neg index): arr.-1", src: "arr.-1;" },
	{ label: "MemberAccessExpr nested: foo.bar.baz", src: "foo.bar.baz;" },
	{ label: "IndexAccessExpr: arr[0]",            src: "arr[0];" },
	{ label: "RangeAccessExpr: arr.[1..5]",        src: "arr.[1..5];" },
	{ label: "RangeAccessExpr (leading): arr.[5..]",  src: "arr.[5..];" },
	{ label: "RangeAccessExpr (trailing): arr.[..5]", src: "arr.[..5];" },
	{ label: "PropertyPickExpr: rec.<a,5>",        src: "rec.<a,5>;" },

	// === Call cluster — ChainExpr fold ===
	{ label: "CallExpr: foo(1,2)",                 src: "foo(1,2);" },
	{ label: "CallExpr (empty): foo()",            src: "foo();" },
	{ label: "PartialCallExpr: foo|1,2|",          src: "foo|1,2|;" },
	{ label: "PartialCallExpr (OpFunc arg): foo|(+)|", src: "foo|(+)|;" },

	// === Mixed chains — verifies fold ordering ===
	{ label: "Mixed: foo.bar(1,2)",                src: "foo.bar(1,2);" },
	{ label: "Mixed: foo(1,2).baz",                src: "foo(1,2).baz;" },
	{ label: "Mixed: foo.bar(1,2).baz",            src: "foo.bar(1,2).baz;" },
	{ label: "Mixed: arr[0].name",                 src: "arr[0].name;" },

	// === PrimedExpr — wrap base, post-prime calls apply on top ===
	{ label: "PrimedExpr: foo'",                   src: "foo';" },
	{ label: "PrimedExpr in call: foo'(1,2)",      src: "foo'(1,2);" },
	{ label: "PrimedExpr post-access: foo.bar'",   src: "foo.bar';" },
	{ label: "PrimedExpr post-access call: foo.bar'(1,2)", src: "foo.bar'(1,2);" },

	// === OpFuncExpr — four inner forms ===
	{ label: "OpFuncExpr (bare op): (+)",          src: "(+);" },
	{ label: "OpFuncExpr (range): (..)",           src: "(..);" },
	{ label: "OpFuncExpr (multi-tok): ($+)",       src: "($+);" },
	{ label: "OpFuncExpr (empty-bracket): ([])",   src: "([]);" },
	{ label: "OpFuncExpr (angle-pick): (.<a,5>)",  src: "(.<a,5>);" },
	{ label: "OpFuncExpr (range-access): (.[1..5])", src: "(.[1..5]);" },
	{ label: "OpFuncExpr (primed): (+')",          src: "(+');" },
	{ label: "OpFuncExpr :as int",                 src: "(+) :as int;" },
	{ label: "OpFuncExpr as callee: (+)(1,2)", src: "(+)(1,2);" },
	{ label: "OpFuncExpr with prime + call: (+')(1,2)", src: "(+')(1,2);" },

	// === Synthetic-vs-explicit OpFuncExpr alignment ===
	// These pairs should produce identical args[0] shape (modulo span).
	{ label: "Shortcut primed: foo(+')",                     src: "foo(+');"   },
	{ label: "Explicit primed (inner '): foo((+'))",         src: "foo((+'));" },
	{ label: "Explicit, outer ' on group: foo((+)')",        src: "foo((+)');" },

	// === :as on chain forms — verifies attachment to outermost typed node ===
	{ label: "CallExpr :as int",                   src: "foo(1,2) :as int;" },
	{ label: "MemberAccessExpr :as int",           src: "foo.bar :as int;" },
	{ label: "PrimedExpr :as int",                 src: "foo' :as int;" },

	// DefVarStmt — exercises target/init alts beyond the basic case
	{ label: "DefVarStmt: destructure target", src: "def <:a, :b>: foo;" },
	{ label: "DefVarStmt: destructure target", src: "def <a: x, b: y>: foo;" },
	{ label: "DefVarStmt: import init",        src: 'def x: import "foo";' },

	// BlockDefsInitOpt — exercises VarDefInitOpt's init-less form
	{ label: "BlockExpr: defs no init",        src: "(x, y) { x; };" },
	{ label: "BlockExpr: mixed defs",          src: "(x: 1, y) { x; };" },
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
