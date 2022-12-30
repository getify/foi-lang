import Scheduler from "./scheduler.js";
import { tokenize, } from "./tokenizer.js";
import { highlight, } from "./highlighter.js";

var inputEl;
var syntaxColorEl;
var checkSyntaxEl;
var tokenDetailsEl;
var tokenListEl;
var grammar;
var syntaxColorTmpl;
var validator;
var updater = Scheduler(50,300);
var checker = Scheduler(100,750);

main().catch(console.log);


// ****************************

async function main() {
	inputEl = document.getElementById("input");
	syntaxColorEl = document.getElementById("syntax-color");
	checkSyntaxEl = document.getElementById("check-syntax");
	tokenDetailsEl = document.getElementById("token-details");
	tokenListEl = document.getElementById("token-list");

	inputEl.addEventListener("input",onInput);

	validator = new Worker("/js/grammar-checker-manager.js");
	validator.addEventListener("message",onWorkerMessage);

	[
		syntaxColorTmpl,
		grammar
	] = await Promise.all([
		fetch("/syntax-color.html",{
			method: "GET",
			cache: "no-store",
			headers: {
				"pragma": "no-cache",
			},
		}).then(res => res.text()),

		fetch("/foi-grammar.txt",{
			method: "GET",
			cache: "no-store",
			headers: {
				"pragma": "no-cache",
			},
		}).then(res => res.text()),
	]);

	checkSyntaxEl.innerHTML = "Validating...";
	validator.postMessage({ grammar, input: inputEl.value });

	render();
}

function onInput(evt) {
	checkSyntaxEl.innerHTML = "Validating...";
	updater(render);
	checker(checkInput);
}

async function render() {
	var tokens = await tokenize(inputEl.value);
	var tokensArr = [];
	var tokensText = "";
	for await (let token of tokens) {
		tokensArr.push(token);
		let attrs = Object.entries(token).map(([prop,value]) => `${prop}: ${JSON.stringify(value)}`);
		tokensText += `{ ${attrs.join(", ")} }\n`;
	}
	tokenListEl.value = tokensText;
	tokenDetailsEl.classList.remove("hidden");

	await renderSyntaxColor(tokensArr);
}

async function renderSyntaxColor(tokens) {
	syntaxColorEl.classList.remove("hidden");

	var html = "";
	if (tokens && tokens.length > 0) {
		for await (let htmlChunk of highlight(tokens)) {
			html += htmlChunk;
		}
	}

	html = syntaxColorTmpl.replace("<pre></pre>",`<pre>${html}</pre>`);

	syntaxColorEl.contentWindow.document.open();
	syntaxColorEl.contentWindow.document.write(html);
	syntaxColorEl.contentWindow.document.close();
}

function checkInput() {
	validator.postMessage({ input: inputEl.value });
}

function onWorkerMessage({ data }) {
	if (data.valid) {
		checkSyntaxEl.innerHTML = "Valid!"
	}
	else if (data.invalid) {
		checkSyntaxEl.innerHTML = data.invalid;
		renderSyntaxColor();
		syntaxColorEl.classList.add("hidden");
		tokenListEl.innerHTML = "";
		tokenDetailsEl.classList.add("hidden");
	}
	else {
		console.log(data);
	}
}
