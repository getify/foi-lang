import Scheduler from "./scheduler.js";
import { tokenize, } from "./fast-tokenizer.js";
import { highlight, } from "./highlighter.js";
import { sourceContext, } from "./source-context.js";

var inputEl;
var syntaxColorEl;
var checkSyntaxEl;
var tokenDetailsEl;
var tokenListEl;
var astDetailsEl;
var astOutputEl;
var syntaxColorTmpl;
var parser;

// Memoized lex, keyed on the source string.
var lexSrc = null;
var lexTokens = null;
var lexError = null;

// A running parse can't be interrupted, so edits arriving during
// one collapse into a single follow-up request instead of queueing
// behind each other. Only ever one request in flight.
var checkSeq = 0;
var sentSrc = null;
var pendingSrc = null;
var inFlight = false;

var updater = Scheduler(50,150);
var checker = Scheduler(300,2500);

main().catch(console.log);


// ****************************

async function main() {
	inputEl = document.getElementById("input");
	syntaxColorEl = document.getElementById("syntax-color");
	checkSyntaxEl = document.getElementById("check-syntax");
	tokenDetailsEl = document.getElementById("token-details");
	tokenListEl = document.getElementById("token-list");
	astDetailsEl = document.getElementById("ast-details");
	astOutputEl = document.getElementById("ast-output");

	inputEl.addEventListener("input",onInput);

	parser = new Worker("/js/parse-worker.js",{ type: "module", });
	parser.addEventListener("message",onParserMessage);
	parser.addEventListener("error",onParserError);

	syntaxColorTmpl = await fetch("/syntax-color.html",{
		method: "GET",
		cache: "no-store",
		headers: {
			"pragma": "no-cache",
		},
	}).then(res => res.text());

	setStatus("Validating...");
	render();
	check();
}

function onInput() {
	setStatus("Validating...");
	updater(render);
	checker(check);
}

// Tokenize once per edit, shared by render() and the check request.
function lex(src) {
	if (src !== lexSrc) {
		lexSrc = src;
		try {
			lexTokens = tokenize(src);
			lexError = null;
		}
		catch (err) {
			lexTokens = null;
			lexError = err;
		}
	}
	return { tokens: lexTokens, error: lexError, };
}

async function render() {
	let src = inputEl.value;
	let { tokens, error, } = lex(src);

	if (error) {
		setStatus(`Tokenize error: ${error.message}\n${sourceContext(src,error.pos)}`);
		hideOutput();
		return;
	}

	let tokensText = "";
	for (let token of tokens) {
		let attrs = Object.entries(token)
			.map(([ prop, value, ]) => `${prop}: ${JSON.stringify(value)}`);
		tokensText += `{ ${attrs.join(", ")} }\n`;
	}
	tokenListEl.value = tokensText;
	tokenDetailsEl.classList.remove("hidden");

	await renderSyntaxColor(tokens);
}

function check() {
	let src = inputEl.value;
	let { error, } = lex(src);

	// A lex failure is already on screen from render(), and the
	// worker would only reproduce it.
	if (error) {
		return;
	}

	pendingSrc = src;
	sendPending();
}

function sendPending() {
	if (inFlight || pendingSrc == null) {
		return;
	}
	inFlight = true;
	checkSeq++;
	sentSrc = pendingSrc;
	pendingSrc = null;
	parser.postMessage({ seq: checkSeq, src: sentSrc, });
}

function onParserMessage({ data, }) {
	inFlight = false;

	if (data.seq == checkSeq) {
		if (data.ok) {
			setStatus("Valid!");
			// textContent, not innerHTML — string literals from the
			// source survive into the JSON, angle brackets and all.
			astOutputEl.textContent = data.ast;
			astDetailsEl.classList.remove("hidden");
		}
		else {
			// The tokens are good even though the parse isn't, so
			// the highlight stays up and only the status changes.
			setStatus(
				`${data.message}\n${sourceContext(sentSrc,data.pos)}`
			);
			// No complete AST exists; a partial one would be
			// truncated at an unmarked point.
			hideAST();
		}
	}

	sendPending();
}

function onParserError(evt) {
	inFlight = false;
	setStatus(`Parse worker failed: ${evt.message}`);
}

async function renderSyntaxColor(tokens) {
	var x = Date.now();
	var html = "";
	for await (let htmlChunk of highlight(tokens)) {
		html += htmlChunk;
	}

	html = syntaxColorTmpl.replace("<pre></pre>",`<pre>${html}</pre>`);

	syntaxColorEl.contentWindow.document.open();
	syntaxColorEl.contentWindow.document.write(html);
	syntaxColorEl.contentWindow.document.close();

	syntaxColorEl.classList.remove("hidden");
	console.log(Date.now() - x);
}

function hideOutput() {
	syntaxColorEl.classList.add("hidden");
	tokenListEl.value = "";
	tokenDetailsEl.classList.add("hidden");
	hideAST();
}

function hideAST() {
	astOutputEl.textContent = "";
	astDetailsEl.classList.add("hidden");
}

function setStatus(text) {
	// textContent, not innerHTML — the failure message embeds the
	// user's own source line.
	checkSyntaxEl.textContent = text;
}
