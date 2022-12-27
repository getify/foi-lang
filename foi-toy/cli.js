"use strict";

var util = require("util");
var path = require("path");
var fs = require("fs");
var fsp = require("fs/promises");
var args = require("minimist")(process.argv.slice(2));

const { tokenize, } = require(path.join(__dirname,"src","tokenizer.js"));
const { highlight, } = require(path.join(__dirname,"src","highlighter.js"));

main().catch(console.log);


// **********************

async function main() {
	if (!args.file) {
		console.log("Foi-Toy: experimental Foi tool");
		console.error("Missing --file=.. parameter.");
		return;
	}

	var fileStream = fs.createReadStream(path.resolve(process.cwd(),args.file),"utf-8");
	var tokens = tokenize(fileStream);

	if (args.color) {
		let [ tmplHTML, tmplCSS, ] = await Promise.all([
			fsp.readFile(path.join(__dirname,"src","tmpl.html"),"utf-8"),
			fsp.readFile(path.join(__dirname,"src","tmpl.css"),"utf-8"),
		]);
		let tmplParts = tmplHTML.split(/\<\/?(?:pre|style)\>/);

		process.stdout.write(tmplParts[0]);
		process.stdout.write(`<style>\n${tmplCSS}</style>`);
		process.stdout.write(`${tmplParts[2]}<pre>`);

		for await (let htmlChunk of highlight(tokens)) {
			process.stdout.write(htmlChunk);
		}

		process.stdout.write(`</pre>${tmplParts[4]}`);
	}
	else {
		for await (let token of tokens) {
			process.stdout.write(`${JSON.stringify(token)}\n`);
		}
	}
}
