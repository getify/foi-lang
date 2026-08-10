import path from "node:path";
import util from "node:util";
import fsp from "node:fs/promises";

import minimist from "minimist";

import { tokenize, } from "./src/fast-tokenizer.js";
import { parseFoi, } from "./src/parser.js";
import { highlight, } from "./src/highlighter.js";
import { sourceContext, } from "./src/source-context.js";

var args = minimist(process.argv.slice(2));

const ROOT_DIR = import.meta.dirname;
const SRC_DIR = path.join(ROOT_DIR,"src");


main().catch(err => {
	console.error(err);
	process.exitCode = 1;
});


// **********************

async function main() {
	if (!args.file) {
		console.log("Foi-Toy: experimental Foi tool");
		console.error("Missing --file=.. parameter.");
		process.exitCode = 1;
		return;
	}

	var sourceFilePath = path.resolve(process.cwd(),args.file);
	var source = await fsp.readFile(sourceFilePath,"utf-8");
	var tokens;

	// Lex up front: the token list feeds both the parse and the
	// render, and nothing downstream is meaningful without it.
	try {
		tokens = tokenize(source);
	}
	catch (err) {
		reportFailure("Tokenize",err,source);
		process.exitCode = 1;
		return;
	}

	// The parse runs when either flag needs it, and only once.
	var ast = null;

	if (args.validate || args.ast) {
		if (args.validate) {
			await out("Validating... ");
		}
		try {
			// Re-use the tokens already produced rather than lexing
			// twice; the array is re-iterable, so this is safe.
			ast = [];
			for await (let node of parseFoi(source,{ tokenizer: () => tokens, })) {
				ast.push(node);
			}
		}
		catch (err) {
			if (args.validate) {
				await out("\n");
			}
			reportFailure("Parse",err,source);
			process.exitCode = 1;
			return;
		}
		if (args.validate) {
			await out("OK!\n");
		}
	}

	if (args.ast) {
		await out(`${JSON.stringify(
			ast?.[(ast?.length ?? 1) - 1] ?? ast,
			null,
			2
		)}\n`);
	}
	else {
		await renderTokens(tokens);
	}
}

async function renderTokens(tokens) {
	if (args.color) {
		let [ tmplHTML, tmplCSS, ] = await Promise.all([
			fsp.readFile(path.join(SRC_DIR,"tmpl.html"),"utf-8"),
			fsp.readFile(path.join(SRC_DIR,"tmpl.css"),"utf-8"),
		]);
		let tmplParts = tmplHTML.split(/\<\/?(?:pre|style)\>/);

		await out(`${tmplParts[0]}<style>\n${tmplCSS}</style>${tmplParts[2]}<pre>`);

		for await (let htmlChunk of highlight(tokens)) {
			await out(htmlChunk);
		}

		await out(`</pre>${tmplParts[4]}`);
	}
	else {
		for (let token of tokens) {
			await out(`${util.inspect(token)}\n`);
		}
	}
}

function reportFailure(label,err,source) {
	console.error(`${label} error: ${err.message}`);
	console.error(sourceContext(source,err.pos));
}

async function out(str) {
	if (!process.stdout.write(str)) {
		await new Promise(res => process.stdout.once("drain",res));
	}
}
