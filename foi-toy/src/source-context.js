export { sourceContext, };
export default sourceContext;


// **********************

// Render the offending source line with a caret beneath it. `pos`
// is a char offset into `source`; an absent or out-of-range one
// means the failure ran off the end of the input, so point at the
// last char.
function sourceContext(source,pos) {
	if (typeof pos != "number" || pos > source.length) {
		pos = Math.max(0,source.length - 1);
	}

	var upTo = source.slice(0,pos);
	var lineNum = (upTo.match(/\n/g) || []).length + 1;
	var lineStart = upTo.lastIndexOf("\n") + 1;
	var lineEnd = source.indexOf("\n",lineStart);
	if (lineEnd < 0) {
		lineEnd = source.length;
	}

	var line = source.slice(lineStart,lineEnd);
	var col = (pos - lineStart) + 1;
	var gutter = `${lineNum} | `;

	// Preserve tabs in the caret padding so the caret still lands
	// under the right column wherever tabs are respected.
	var padding = line.slice(0,col - 1).replace(/[^\t]/g," ");

	return [
		`  at line ${lineNum}, column ${col}`,
		`  ${gutter}${line}`,
		`  ${" ".repeat(gutter.length)}${padding}^`,
	].join("\n");
}
