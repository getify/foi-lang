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
	// // BareIdentifier — subsumes to Identifier; :as hoists onto it
	// { label: "Identifier (via bare): x",      src: "x;" },
	// { label: "Identifier (via bare) :as int", src: "x :as int;" },

	// // BareIdentifier variants — all three IdentBase arms
	// { label: "BareIdent: identifier",  src: "x;" },
	// { label: "BareIdent: builtin",     src: "List;" },
	// { label: "BareIdent: pipeline-#",  src: "#;" },
	// { label: "BareIdent: builtin :as int",    src: "List :as int;" },
	// { label: "BareIdent: pipeline-# :as int", src: "# :as int;" },

	// // NumberLit — literal value-extraction archetype
	// { label: "NumberLit: 42",              src: "42;" },
	// { label: "NumberLit: 42 :as int",      src: "42 :as int;" },

	// // BooleanLit
	// { label: "BooleanLit: true",           src: "true;" },
	// { label: "BooleanLit: false :as bool", src: "false :as bool;" },

	// // EmptyLit
	// { label: "EmptyLit: empty",            src: "empty;" },
	// { label: "EmptyLit: empty :as int",    src: "empty :as int;" },

	// // PlainStr
	// { label: "PlainStr: hello",            src: '"hello";' },
	// { label: "PlainStr: escaped quote",    src: '"a""b";' },
	// { label: "PlainStr :as string",        src: '"hi" :as string;' },

	// // InterpStr — with and without interpolation
	// { label: "InterpStr: no interp",       src: '`"hello";' },
	// { label: "InterpStr: one interp",      src: '`"hi `42` there";' },
	// { label: "InterpStr: two interps",     src: '`"`a` and `b` end";' },

	// // Spacing-form strings — content includes Whitespace tokens
	// // (the *Chars predicates exclude whitespace, forcing it out as
	// // its own token type). These productions opt into
	// // preserveInnerDelim so the machinery's delim filter doesn't
	// // strip whitespace from parts before the shaper sees it. No
	// // dedicated shaper yet — these will show under default shape;
	// // what to verify is that Whitespace tokens are present inside
	// // the parts arrays.
	// { label: "SpacingEscapedStr: with WS",  src: '\\"hello world";' },
	// { label: "SpacingInterpStr: with WS",   src: '\\`"hi `42` world";' },

	// // DefVarStmt — fixed-shape definition archetype
	// { label: "DefVarStmt: def x: 5",       src: "def x: 5;" },

	// // Program — homogeneous list-of-statements archetype
	// { label: "Program: two stmts",         src: "def x: 1; def y: 2;" },

	// // BlockExpr — defs-init + body + :as archetype
	// { label: "BlockExpr: bare",            src: "{ x; };" },
	// { label: "BlockExpr: with defs",       src: "(x: 1) { x; };" },
	// { label: "BlockExpr: defs + :as",      src: "(x: 1) { x; } :as int;" },

	// // AddBinExpr — flat iter left-folded binary archetype
	// { label: "AddBinExpr: a + b + c",      src: "a + b + c;" },
	// { label: "AddBinExpr: a $+ b",         src: "a $+ b;" },

	// // ChainExpr — base + heterogeneous segments archetype
	// { label: "ChainExpr: foo.bar",         src: "foo.bar;" },
	// { label: "ChainExpr: foo'",            src: "foo';" },
	// { label: "ChainExpr: foo'(a,b)",       src: "foo'(a,b);" },

	// // Access segments — via ChainExpr.segments (direct exposure)
	// { label: "DotIdentifier: foo.List",    src: "foo.List;" },
	// { label: "DotIdentifier: arr.5",       src: "arr.5;" },
	// { label: "DotIdentifier: arr.-1",      src: "arr.-1;" },
	// { label: "BracketExpr: arr[0]",        src: "arr[0];" },
	// { label: "DotBracketExpr: arr.[1..5]", src: "arr.[1..5];" },
	// { label: "DotAngleExpr: rec.<a,5>",    src: "rec.<a,5>;" },
	// { label: "ChainExpr: foo.bar.baz",     src: "foo.bar.baz;" },

	// // SingleAccessExpr — via still-default-shaped AtExpr
	{ label: "SingleAccessExpr (in AtExpr): foo.bar@", src: "foo.bar@;" },

	// Range — three forms; ClosedRangeExpr was visible default-shaped before
	{ label: "LeadingRangeExpr (in DotBracket): arr.[5..]",  src: "arr.[5..];" },
	{ label: "TrailingRangeExpr (in DotBracket): arr.[..5]", src: "arr.[..5];" },
	{ label: "ClosedRangeExpr :as int (parenthesized)", src: "(1..5) :as int;" },

	// Call suffixes — via ChainExpr
	{ label: "PrefixCallSuffix: foo(1,2)",  src: "foo(1,2);" },
	{ label: "PrefixCallSuffix: foo(+')",   src: "foo(+');" },
	{ label: "PartialCallSuffix: foo|1,2|", src: "foo|1,2|;" },

	{ label: "PartialCallSuffix: foo|+|", src: "foo|(+)|;" },
];

for (let { label, src } of samples) {
	console.log(`\n=== ${label} ===`);
	console.log(`    src: ${src}`);
	try {
		for await (let tree of parseFoi(src)) {
			console.log(util.inspect(tree, { depth: null, colors: true }));
		}
	}
	catch (err) {
		console.log(`!! threw: ${err.message}`);
	}
}
