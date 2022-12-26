"use strict";

var util = require("util");
var path = require("path");
var fs = require("fs");
var args = require("minimist")(process.argv.slice(2));

const { tokenize, } = require(path.join(__dirname,"src","tokenizer.js"));
const { highlight, } = require(path.join(__dirname,"src","highlighter.js"));

main();


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
		for await (let htmlChunk of highlight(tokens)) {
			process.stdout.write(htmlChunk);
		}
	}
	else {
		for await (let token of tokens) {
			process.stdout.write(`${JSON.stringify(token)}\n`);
		}
	}
}
