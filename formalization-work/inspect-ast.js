// inspect-ast.js — temporary archetype shape review tool.
//
// Dumps AST shapes for minimal inputs covering the 6 archetype
// families (NumberLit, DefVarStmt, Program, BlockExpr, AddBinExpr,
// ChainExpr) plus key variants. Throwaway scaffolding — delete
// once archetype shapes are signed off and propagation across the
// remaining ~200 productions begins.

import util from "node:util";
import { parseFoi } from "../foi-toy/src/parser.js";
import { samples } from "./samples.js";


for (let { label, src, opts } of samples) {
	console.log(`\n=== ${label} ===`);
	console.log(`    src: ${src}`);
	try {
		for await (let tree of parseFoi(src, opts)) {
			console.log(util.inspect(tree, { depth: null, colors: false }));
		}
	}
	catch (err) {
		console.log(`!! threw: ${err.message}`);
	}
}
