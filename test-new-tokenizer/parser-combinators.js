// =============================================================
// Foi Streaming Parser Combinator Library — v1
//
// Bootstrap infrastructure for the Foi language interpreter.
// Polymorphic over element type (chars OR tokens).
// Streaming async input, backtracking, live tree as canonical state,
// event-stream output via filtered subscriptions.
//
// Not designed for performance or production use.
// =============================================================

// Sentinel returned by buffer.peek() past end-of-input.
export const EOF = Symbol("EOF");


var isWhitespaceTok = t => t && t.type === "Whitespace";
var isCommentTok    = t => t && t.type === "Comment";


// -------------------------------------------------------------
// BUFFERED INPUT
// Wraps any iterable / async iterable, exposes random-access
// peek by position. Lazily pulls from the source as needed.
// v1 keeps everything buffered indefinitely (no GC of consumed
// prefix); fine for source-file-sized inputs.
// -------------------------------------------------------------

function makeBufferedInput(source) {
	var buffer = [];
	var iter;
	if (typeof source?.[Symbol.asyncIterator] == "function") {
		iter = source[Symbol.asyncIterator]();
	}
	else if (typeof source?.[Symbol.iterator] == "function") {
		let syncIter = source[Symbol.iterator]();
		iter = {
			next() {
				return Promise.resolve(syncIter.next());
			},
		};
	}
	else {
		throw new Error("parse(): input must be iterable or async iterable");
	}
	var done = false;

	async function peek(pos) {
		while (buffer.length <= pos && !done) {
			let result = await iter.next();
			if (result.done) {
				done = true;
				break;
			}
			buffer.push(result.value);
		}
		return pos < buffer.length ? buffer[pos] : EOF;
	}

	function bufferedLength() {
		return buffer.length;
	}

	return { peek, bufferedLength };
}


// -------------------------------------------------------------
// SUBSCRIPTION
// Each subscriber holds an independent queue. Events are pushed
// to all matching subscribers as they fire; subscribers consume
// via async iteration (for-await). Pending awaiters are
// resolved directly to avoid queueing latency.
// -------------------------------------------------------------

function makeSubscription(filter) {
	var queue = [];
	var resolvers = [];
	var closed = false;

	function push(ev) {
		if (closed) return;
		if (resolvers.length > 0) {
			let r = resolvers.shift();
			r({ value: ev, done: false });
		}
		else {
			queue.push(ev);
		}
	}

	function close() {
		if (closed) return;
		closed = true;
		while (resolvers.length > 0) {
			let r = resolvers.shift();
			r({ value: undefined, done: true });
		}
	}

	var iterable = {
		[Symbol.asyncIterator]() {
			return {
				next() {
					if (queue.length > 0) {
						return Promise.resolve({ value: queue.shift(), done: false });
					}
					if (closed) {
						return Promise.resolve({ value: undefined, done: true });
					}
					return new Promise(function (resolve) {
						resolvers.push(resolve);
					});
				},
				return() {
					close();
					return Promise.resolve({ value: undefined, done: true });
				},
			};
		},
	};

	return { filter, push, close, iterable };
}


// -------------------------------------------------------------
// PARSER CONTEXT
// -------------------------------------------------------------

function makeContext(buffer, config) {
	var pctx = {
		buffer,
		pos: 0,
		frameStack: [],     // chain of currently-open named-production frames
		nextNodeId: 0,
		config,
		subscribers: [],
		liveRoots: [],      // matched top-level (parent === null) frames
	};
	pctx.emit = function emit(ev) {
		for (let sub of pctx.subscribers) {
			if (sub.filter(ev)) sub.push(ev);
		}
	};
	return pctx;
}


// -------------------------------------------------------------
// FRAME LIFECYCLE (named productions only)
// -------------------------------------------------------------

function openFrame(pctx, name) {
	var parent = pctx.frameStack.length > 0
		? pctx.frameStack[pctx.frameStack.length - 1]
		: null;
	var frame = {
		id: pctx.nextNodeId++,
		production: name,
		depth: parent ? parent.depth + 1 : 0,
		parent,
		children: [],
		startPos: pctx.pos,
		endPos: null,
		status: "open",
		state: {},
		matched: pctx.config.preserveTerminals ? [] : null,
	};
	if (parent) parent.children.push(frame);
	pctx.frameStack.push(frame);
	pctx.emit({ kind: "open", node: frame });
	return frame;
}

function closeFrameMatched(pctx, frame) {
	frame.endPos = pctx.pos;
	frame.status = "matched";
	pctx.frameStack.pop();
	pctx.emit({ kind: "matched", node: frame });
	if (frame.parent === null) {
		pctx.liveRoots.push(frame);
	}
}

function closeFrameRolledBack(pctx, frame) {
	frame.endPos = pctx.pos;
	frame.status = "rolledback";
	pctx.frameStack.pop();
	if (frame.parent) {
		// It will be the last child (we just opened it); pop defensively.
		let idx = frame.parent.children.lastIndexOf(frame);
		if (idx >= 0) frame.parent.children.splice(idx, 1);
	}
	pctx.emit({ kind: "rollback", node: frame });
}


// -------------------------------------------------------------
// SAVEPOINT / ROLLBACK (used by every combinator with backtrack)
// Captures: input position, the matched-array length of the
// innermost named frame (if preserving terminals), and the
// number of children the innermost named frame had. On restore,
// any later-added children are detached & rolled back, the
// matched array is truncated, and pos is reset.
// -------------------------------------------------------------

function savepoint(pctx) {
	var inner = pctx.frameStack[pctx.frameStack.length - 1] || null;
	return {
		pos: pctx.pos,
		innerFrame: inner,
		childrenLen: inner ? inner.children.length : 0,
		matchedLen: (inner && inner.matched) ? inner.matched.length : 0,
	};
}

function restoreSavepoint(pctx, sp) {
	if (sp.innerFrame) {
		while (sp.innerFrame.children.length > sp.childrenLen) {
			let detached = sp.innerFrame.children.pop();
			cascadeRollback(pctx, detached);
		}
		if (sp.innerFrame.matched) {
			sp.innerFrame.matched.length = sp.matchedLen;
		}
	}
	pctx.pos = sp.pos;
}

function cascadeRollback(pctx, node) {
	if (node.status !== "matched") return;
	// Bottom-up: children first, then self.
	for (let c of node.children) {
		cascadeRollback(pctx, c);
	}
	node.status = "rolledback";
	pctx.emit({ kind: "rollback", node });
}

function cascadeCommit(pctx, node) {
	if (node.status !== "matched") return;
	// Top-down: self first, then children. Matches the order
	// open events were fired, which keeps consumers' mental model simple.
	node.status = "committed";
	pctx.emit({ kind: "commit", node });
	for (let c of node.children) {
		cascadeCommit(pctx, c);
	}
}


// =============================================================
// CORE COMBINATORS
// Each combinator returns a parser function: async (pctx) => bool
// True = matched (pctx.pos advanced past what was consumed).
// False = no match (pctx state restored to call-site).
// =============================================================

// terminal(predicate, onMatch?)
//   Matches a single input element if predicate returns truthy.
//   onMatch fires AFTER consumption; can mutate the innermost
//   named frame's `state` object via its second arg.
export function terminal(predicate, onMatch) {
	return async function termFn(pctx) {
		var el = await pctx.buffer.peek(pctx.pos);
		if (el === EOF) return false;
		var innerFrame = pctx.frameStack[pctx.frameStack.length - 1] || null;
		if (!predicate(el, innerFrame)) return false;
		if (innerFrame && innerFrame.matched) {
			innerFrame.matched.push(el);
		}
		if (onMatch) onMatch(el, innerFrame);
		pctx.pos++;
		return true;
	};
}

// and(p1, p2, ...): sequence. All must match. Flattens nested and().
export function and(...ps) {
	var flat = [];
	for (let p of ps) {
		if (p && p._kind === "and") flat.push(...p._parts);
		else flat.push(p);
	}
	async function andFn(pctx) {
		var sp = savepoint(pctx);
		for (let p of flat) {
			let ok = await p(pctx);
			if (!ok) {
				restoreSavepoint(pctx, sp);
				return false;
			}
		}
		return true;
	}
	andFn._kind = "and";
	andFn._parts = flat;
	return andFn;
}

// or(p1, p2, ...): PEG ordered choice. First match wins.
export function or(...ps) {
	return async function orFn(pctx) {
		var sp = savepoint(pctx);
		for (let p of ps) {
			let ok = await p(pctx);
			if (ok) return true;
			// Child should self-restore on failure; restore defensively
			// so each alternative starts from the same checkpoint.
			restoreSavepoint(pctx, sp);
		}
		return false;
	};
}

// optional(p): zero or one. Always succeeds.
export function optional(p) {
	return async function optionalFn(pctx) {
		var sp = savepoint(pctx);
		var ok = await p(pctx);
		if (!ok) restoreSavepoint(pctx, sp);
		return true;
	};
}

// any(p): zero or more, greedy. Always succeeds.
export function any(p) {
	return async function anyFn(pctx) {
		while (true) {
			let posBefore = pctx.pos;
			let sp = savepoint(pctx);
			let ok = await p(pctx);
			if (!ok) {
				restoreSavepoint(pctx, sp);
				return true;
			}
			if (pctx.pos === posBefore) {
				// Zero-width match — break to avoid infinite loop.
				// (The match is kept; we just stop iterating.)
				return true;
			}
		}
	};
}

// many(p): one or more, greedy. Fails iff zero matches.
export function many(p) {
	return async function manyFn(pctx) {
		var outerSp = savepoint(pctx);
		var count = 0;
		while (true) {
			let posBefore = pctx.pos;
			let sp = savepoint(pctx);
			let ok = await p(pctx);
			if (!ok) {
				restoreSavepoint(pctx, sp);
				break;
			}
			count++;
			if (pctx.pos === posBefore) break;
		}
		if (count === 0) {
			restoreSavepoint(pctx, outerSp);
			return false;
		}
		return true;
	};
}

// not(p): negative lookahead. Consumes nothing.
export function not(p) {
	return async function notFn(pctx) {
		var sp = savepoint(pctx);
		var ok = await p(pctx);
		// Always restore; not/lookahead never consume.
		restoreSavepoint(pctx, sp);
		return !ok;
	};
}

// lookahead(p): positive lookahead. Consumes nothing.
export function lookahead(p) {
	return async function lookaheadFn(pctx) {
		var sp = savepoint(pctx);
		var ok = await p(pctx);
		restoreSavepoint(pctx, sp);
		return ok;
	};
}

// eof(): matches iff the buffer is exhausted at current position.
export function eof() {
	return async function eofFn(pctx) {
		var el = await pctx.buffer.peek(pctx.pos);
		return el === EOF;
	};
}

// gate(predicate): consumes nothing; succeeds iff predicate(innerFrame)
// returns truthy. Lets state mutations from earlier onMatch callbacks
// influence flow.
export function gate(predicate) {
	return async function gateFn(pctx) {
		var innerFrame = pctx.frameStack[pctx.frameStack.length - 1] || null;
		return !!predicate(innerFrame);
	};
}

// dispatch(selector, branches): state-driven alternation.
// selector(innerFrame) -> key. branches[key] is the chosen sub-parser.
// Fails iff the key is missing from branches.
export function dispatch(selector, branches) {
	return async function dispatchFn(pctx) {
		var innerFrame = pctx.frameStack[pctx.frameStack.length - 1] || null;
		var key = selector(innerFrame);
		var branch = branches[key];
		if (!branch) return false;
		return await branch(pctx);
	};
}

// until(stop, content): consume content repeatedly until stop would
// match, or input exhausts. Stop itself is NOT consumed.
// EOF-tolerant: stops at EOF without failing.
export function until(stop, content) {
	return any(and(not(lookahead(stop)), content));
}

// sepBy(p, sep): zero or more p separated by sep.
export function sepBy(p, sep) {
	return optional(and(p, any(and(sep, p))));
}

// sepBy1(p, sep): one or more p separated by sep.
export function sepBy1(p, sep) {
	return and(p, any(and(sep, p)));
}

// production(name, grammar): the ONLY way to create a tree node.
// Opens a frame, runs grammar, closes the frame as matched or
// rolled-back depending on result. Fresh `state` object on each open.
export function production(name, grammar) {
	return async function prodFn(pctx) {
		var frame = openFrame(pctx, name);
		var ok = await grammar(pctx);
		if (ok) {
			closeFrameMatched(pctx, frame);
			return true;
		}
		else {
			closeFrameRolledBack(pctx, frame);
			return false;
		}
	};
}

function recordDelim(pctx, el) {
	if (!(pctx.config.preserveTerminals && pctx.config.preserveDelim)) return;
	var innerFrame = pctx.frameStack[pctx.frameStack.length - 1];
	if (innerFrame && innerFrame.matched) innerFrame.matched.push(el);
}

// delim(): zero or more whitespace OR comment tokens, any mix.
//          Pattern: (ws | cmt)*
export function delim() {
	return async function delimFn(pctx) {
		while (true) {
			let el = await pctx.buffer.peek(pctx.pos);
			if (el === EOF) break;
			if (!isWhitespaceTok(el) && !isCommentTok(el)) break;
			recordDelim(pctx, el);
			pctx.pos++;
		}
		return true;
	};
}

// delimWSReq(): one-or-more delimiter tokens, at least one of
//               which is whitespace. Pattern: (ws | cmt)* ws (ws | cmt)*
export function delimWSReq() {
	return async function delimWSReqFn(pctx) {
		var sp = savepoint(pctx);
		var sawWs = false;
		while (true) {
			let el = await pctx.buffer.peek(pctx.pos);
			if (el === EOF) break;
			let isWs = isWhitespaceTok(el);
			let isCmt = isCommentTok(el);
			if (!isWs && !isCmt) break;
			if (isWs) sawWs = true;
			recordDelim(pctx, el);
			pctx.pos++;
		}
		if (!sawWs) {
			restoreSavepoint(pctx, sp);
			return false;
		}
		return true;
	};
}


// =============================================================
// PARSE ENTRY POINT
// =============================================================

export function parse(grammar, input, config) {
	config = Object.assign({
		preserveTerminals: false,
		preserveDelim: false,
	}, config || {});
	if (config.preserveDelim && !config.preserveTerminals) {
		throw new Error("parse(): preserveDelim requires preserveTerminals");
	}

	var buffer = makeBufferedInput(input);
	var pctx = makeContext(buffer, config);
	var started = false;

	return {
		// subscribe(filter?) -> AsyncIterable<event>
		// filter: (event) -> bool. Defaults to all events.
		// MUST be called before run() to catch all events.
		subscribe(filter) {
			if (started) {
				throw new Error("parse handle: subscribe before run()");
			}
			var sub = makeSubscription(filter || (function () { return true; }));
			pctx.subscribers.push(sub);
			return sub.iterable;
		},

		// run() -> Promise<{ok, pos, roots}>
		// ok: whether the top-level grammar matched.
		// pos: final input position.
		// roots: matched (now committed) top-level frames.
		async run() {
			if (started) {
				throw new Error("parse handle: run() already invoked");
			}
			started = true;
			try {
				let ok = await grammar(pctx);
				if (ok) {
					for (let root of pctx.liveRoots) {
						cascadeCommit(pctx, root);
					}
				}
				return { ok, pos: pctx.pos, roots: pctx.liveRoots.slice() };
			}
			finally {
				// Give subscribers a chance to drain before closing,
				// then close. Closing is synchronous from here; any
				// in-flight for-await on next() will resolve to done.
				for (let sub of pctx.subscribers) sub.close();
			}
		},
	};
}


// =============================================================
// PRESET SUBSCRIPTION FILTERS
// Users can pass these directly to handle.subscribe(...).
//
//   parse:        the final AST root. Single commit event on the
//                 top-level production. Walk node.children to read tree.
//
//   parseTrace:   every event. Full exploration trace including all
//                 provisional matches and their rollbacks. For debugging
//                 and grammar profiling.
//
//   parseTokens:  depth-1 nodes' matched / rollback / commit events,
//                 for streaming-lexer use. Subscribe and read tokens
//                 as they arrive; treat `matched` as provisional
//                 (rollback may follow); `commit` is final.
// =============================================================

export const presets = {
	parse: function (ev) {
		return ev.kind === "commit" && ev.node.parent === null;
	},
	parseTrace: function () {
		return true;
	},
	parseTokens: function (ev) {
		if (ev.node.depth !== 1) return false;
		return ev.kind === "matched" || ev.kind === "rollback" || ev.kind === "commit";
	},
	parseCommitsAtDepth(depth) {
		return function (ev) {
			return ev.kind === "commit" && ev.node.depth === depth;
		};
	},
};

// shapeNode(frame, shapers?)
// Recursively transform a committed frame into an AST node.
// shapers: { [productionName]: (frame, shapedChildren) => node }
// For each frame, looks up shapers[frame.production]:
//   - present: calls it with (frame, shapedChildren) where
//     shapedChildren is the recursively-shaped frame.children array.
//   - absent: returns the default shape
//       { type, children, tokens, start, end }
//     where children = shapedChildren, tokens = frame.matched || [],
//     and start/end are positions in the input stream (token indices
//     at the syn layer, char indices at the lex layer).
export function shapeNode(frame, shapers) {
	var shapedChildren = frame.children.map(c => shapeNode(c, shapers));
	var shaper = shapers && shapers[frame.production];
	if (shaper) return shaper(frame, shapedChildren);
	return {
		type:     frame.production,
		children: shapedChildren,
		tokens:   frame.matched || [],
		start:    frame.startPos,
		end:      frame.endPos,
	};
}
