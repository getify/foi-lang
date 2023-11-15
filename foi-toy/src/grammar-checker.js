"use strict";

var document = {
	getElementById(id) {
		return elems[id];
	},
};

var elems = {
	grammar: elem("grammar"),
	input: elem("input"),
	output: elem("output"),
};

elems.grammar.value = "S := '';";


// *******************************

function initChecker(context) {
	elems.output.addEventListener("_className",evt => {
		if (elems.grammar.value != "" && elems.input.value != "") {
			context.postMessage({ [evt.target.className]: evt.target.innerText, });
		}
	});

	if (typeof context.addEventListener == "function") {
		context.addEventListener("message",onMessage);
	}
	else if (typeof context.on == "function") {
		context.on("message",onMessage);
	}
}

function onMessage(message) {
	var data = (message.data != null) ? message.data : message;
	if (data.grammar) {
		elems.grammar.value = data.grammar;
		elems.grammar.dispatchEvent({ type: "input", target: elems.grammar, });
	}
	if (data.input) {
		elems.input.value = data.input;
		elems.input.dispatchEvent({ type: "input", target: elems.input, });
	}
}

function elem(_id) {
	var _value = "";
	var _html = "";
	var _text = "";
	var _className = "valid";
	var cbs = {};
	var publicAPI = {
		addEventListener(evtName,cb) {
			cbs[evtName] = cbs[evtName] || [];
			cbs[evtName].push(cb);
		},
		dispatchEvent(evt) {
			if (cbs[evt.type] != null) {
				for (let cb of cbs[evt.type]) {
					Promise.resolve(evt).then(cb);
				}
			}
		},
		get id() {
			return _id;
		},
		set id(v) {
			_id = v;
		},
		get value() {
			return _value;
		},
		set value(v) {
			_value = v;
			publicAPI.dispatchEvent({ type: "_value", target: publicAPI });
			return v;
		},
		get innerHTML() {
			return _html;
		},
		set innerHTML(v) {
			_html = v;
			publicAPI.dispatchEvent({ type: "_innerHTML", target: publicAPI });
			return v;
		},
		get innerText() {
			return _text;
		},
		set innerText(v) {
			_text = v;
			publicAPI.dispatchEvent({ type: "_innerText", target: publicAPI });
			return v;
		},
		get className() {
			return _className;
		},
		set className(v) {
			_className = v;
			publicAPI.dispatchEvent({ type: "_className", target: publicAPI });
			return v;
		},
	};
	return publicAPI;
}
