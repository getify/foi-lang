"use strict";

var util = require("util");
var path = require("path");
var fs = require("fs");
var fsp = require("fs/promises");
var { PassThrough } = require("node:stream");
var { Worker } = require("node:worker_threads");
var args = require("minimist")(process.argv.slice(2));

const ROOT_DIR = __dirname;
const SRC_DIR = path.join(ROOT_DIR,"src");
const WEB_JS_DIR = path.join(ROOT_DIR,"web","js");

const { tokenize, } = require(path.join(__dirname,"src","tokenizer.js"));
const { highlight, } = require(path.join(__dirname,"src","highlighter.js"));

var outStream = process.stdout;
var worker;


main().catch(console.log);


// **********************

async function main() {
	if (!args.file) {
		console.log("Foi-Toy: experimental Foi tool");
		console.error("Missing --file=.. parameter.");
		return;
	}

	var sourceFilePath = path.resolve(process.cwd(),args.file);
	var sourceFile;

	if (args.validate) {
		let grammarMD;
		[ grammarMD, sourceFile, ] = await Promise.all([
			fsp.readFile(path.join(ROOT_DIR,"..","Grammar.md"),"utf-8"),
			fsp.readFile(sourceFilePath,"utf-8"),
		]);
		let grammar = (grammarMD.match(/^```ebnf$\s([^]*?)\s^```$/m) || [null,""])[1];

		out("Validating... ");

		outStream = new PassThrough({ highWaterMark: 65535, });

		// validate the grammar via a worker
		worker = new Worker(path.join(SRC_DIR,"grammar-checker-worker.js"));
		let checkPr = new Promise(res => worker.once("message",data => {
			worker.terminate();
			res(onWorkerMessage(data));
		}));
		worker.postMessage({ grammar, input: sourceFile });

		tokenizeFile(sourceFile);

		// valid input?
		if (await checkPr) {
			outStream.pipe(process.stdout);
		}
		else {
			process.exit(1);
		}
	}
	else {
		sourceFile = fs.createReadStream(sourceFilePath,"utf-8");
		tokenizeFile(sourceFile);
	}
}

async function tokenizeFile(sourceFile) {
	var tokens = tokenize(sourceFile);

	if (args.color) {
		let [ tmplHTML, tmplCSS, ] = await Promise.all([
			fsp.readFile(path.join(__dirname,"src","tmpl.html"),"utf-8"),
			fsp.readFile(path.join(__dirname,"src","tmpl.css"),"utf-8"),
		]);
		let tmplParts = tmplHTML.split(/\<\/?(?:pre|style)\>/);

		await out(`${tmplParts[0]}<style>\n${tmplCSS}</style>${tmplParts[2]}<pre>`);

		await yieldEventLoop();

		for await (let htmlChunk of highlight(tokens)) {
			await out(htmlChunk);
			await yieldEventLoop();
		}

		await out(`</pre>${tmplParts[4]}`);
	}
	else {
		for await (let token of tokens) {
			await out(`${util.inspect(token)}\n`);
		}
	}
}

async function out(str,useStream = outStream) {
	var written = false;
	while (!written) {
		if (!useStream.write(str)) {
			await new Promise(res => useStream.once("drain",res));
		}
		else {
			written = true;
		}
	}
}

function onWorkerMessage(data) {
	if (data.valid) {
		out(`OK!\n`,process.stdout);
		return true;
	}
	else if (data.invalid) {
		out(`${data.invalid}\n`,process.stdout);
		return false;
	}
	else {
		out(data,process.stdout);
		return false;
	}
}

function yieldEventLoop() {
	return new Promise(res => setImmediate(res));
}
