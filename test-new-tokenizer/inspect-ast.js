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

	// NumberLit — literal value-extraction archetype
	{ label: "NumberLit: 42",              src: "42;" },
	{ label: "NumberLit: 42 :as int",      src: "42 :as int;" },

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

	// ChainExpr — base + heterogeneous segments archetype
	{ label: "ChainExpr: foo.bar",         src: "foo.bar;" },
	{ label: "ChainExpr: foo'",            src: "foo';" },
	{ label: "ChainExpr: foo'(a,b)",       src: "foo'(a,b);" },
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
