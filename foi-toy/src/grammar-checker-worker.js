"use strict";

var path = require("path");
var fs = require("fs");
var vm = require("vm");
var { parentPort, } = require("node:worker_threads");


importScripts(
	path.join(__dirname,"grammar-checker.js"),
	path.join(__dirname,"external","ebnftest.js")
);

initChecker(parentPort);


// *******************************

function importScripts(...scripts) {
	for (let script of scripts) {
		let code = fs.readFileSync(script,"utf-8");
		vm.runInThisContext(code,script);
	}
}
