import { tokenize, } from "./tokenizer.js";
import { highlight, } from "./highlighter.js";


main().catch(console.log);

// ****************************

async function main() {
	var tokens = await tokenize("def x: \"Hello world!\"; log(x);");

	for await (let htmlChunk of highlight(tokens)) {
		console.log(htmlChunk);
	}
}
