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


// isDelim(p): true if p is a delim token (Whitespace or Comment).
// Returns false for shaped AST nodes (which carry production-name
// types like "BinExpr") and for null/undefined. Intended for use
// inside custom shapers that do positional extraction from `parts`
// and want to skip over delim tokens preserved by
// `preserveDelim: true`. With `preserveDelim: false` (the default
// in parseFoi), no delim tokens reach `parts` and the filter is a
// no-op — but writing shapers with the filter in place keeps them
// correct under either config.
export function isDelim(p) {
	return isWhitespaceTok(p) || isCommentTok(p);
}


// lazy(getRef): forward-reference helper. `getRef` is a thunk
// returning a parser. Useful for recursive grammars where a
// production references a sibling not yet defined at the point
// of construction.
//
//   var A = or(lazy(() => B), C);   // B defined later
//   var B = ...;
//
// The thunk is invoked on every parse-time invocation, not
// memoized — reassigning the referenced binding mid-parse would
// be visible.
//
// Tolerant of two kinds of unresolved references: the thunk's
// referenced binding being undefined (typeof !== "function"), and
// the thunk itself throwing ReferenceError (a `var`-hoisted but
// never-assigned binding). Both cases fail the parser cleanly so
// PEG ordered choice can fall through to the next alternative.
export function lazy(getRef) {
	return async function lazyFn(pctx) {
		var p;
		try { p = getRef(); }
		catch (e) {
			if (e instanceof ReferenceError) return false;
			throw e;
		}
		if (typeof p !== "function") return false;
		return await p(pctx);
	};
}


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

	function elementAt(pos) {
		return pos < buffer.length ? buffer[pos] : null;
	}

	return { peek, bufferedLength, elementAt };
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
//
// `pos` is the current input position; it moves backward on
// rollback. `maxPos` is the high-water mark — it only advances,
// never retreats. Useful for error reporting: when a parse fails,
// `maxPos` points to the furthest position parsing ever reached
// before the failing alternative caused the cascade of rollbacks
// back to the call site.
//
// `memo` is the packrat memoization table when config.memoize is
// on. Keyed by "ProductionName@pos"; value is either { ok: false,
// endPos } (cached failure) or { ok: true, endPos, frame } (cached
// success with the parsed frame subtree as a clone source).
// -------------------------------------------------------------

function makeContext(buffer, config) {
	var pctx = {
		buffer,
		pos: 0,
		maxPos: 0,          // monotonic high-water mark; never decreases
		frameStack: [],     // chain of currently-open named-production frames
		nextNodeId: 0,
		config,
		subscribers: [],
		liveRoots: [],      // matched top-level (parent === null) frames
		memo: config.memoize ? new Map() : null,
	};
	pctx.emit = function emit(ev) {
		for (let sub of pctx.subscribers) {
			if (sub.filter(ev)) sub.push(ev);
		}
	};
	pctx.bumpMaxPos = function bumpMaxPos() {
		if (pctx.pos > pctx.maxPos) pctx.maxPos = pctx.pos;
	};
	return pctx;
}


// -------------------------------------------------------------
// FRAME LIFECYCLE (named productions only)
//
// `matched` and `matchedPositions` are kept in lockstep: for
// each matched terminal (or recorded delim), `matched` holds the
// element and `matchedPositions` holds its `pctx.pos` at consumption
// time. shapeNode uses the positions to interleave terminals with
// child frames in source order — necessary because with
// `preserveDelim: false` the parent's pos advances over delim
// tokens that aren't recorded in `matched`, so a naive
// one-position-per-matched-entry count is wrong.
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
		matched:          pctx.config.preserveTerminals ? [] : null,
		matchedPositions: pctx.config.preserveTerminals ? [] : null,
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
// MEMO REPLAY
//
// cloneFrameSubtree: deep-clone a memoized frame subtree so it
// can be attached as a child of a different parent. Fresh `id`s
// from pctx.nextNodeId; new depth/parent pointers; matched arrays
// shallow-copied; children recursively cloned. Status is forced
// to "matched" — the memo only stores successful parses, but the
// original frame's status may have changed to "rolledback" if the
// outer parse backed out after the original (now-memoed) match.
//
// emitClonedSubtree: re-fires open + matched events for the clone
// in the same order a real parse would (open self, recurse for each
// child, matched self). Commit events are deferred to cascadeCommit
// when the parent's parse finalizes — same as for normally-parsed
// frames.
// -------------------------------------------------------------

function cloneFrameSubtree(srcFrame, newParent, pctx) {
	var cloned = {
		id: pctx.nextNodeId++,
		production: srcFrame.production,
		depth: newParent ? newParent.depth + 1 : 0,
		parent: newParent,
		children: [],
		startPos: srcFrame.startPos,
		endPos: srcFrame.endPos,
		status: "matched",
		state: Object.assign({}, srcFrame.state),
		matched:          srcFrame.matched          ? srcFrame.matched.slice()          : null,
		matchedPositions: srcFrame.matchedPositions ? srcFrame.matchedPositions.slice() : null,
	};
	for (let child of srcFrame.children) {
		cloned.children.push(cloneFrameSubtree(child, cloned, pctx));
	}
	return cloned;
}

function emitClonedSubtree(pctx, frame) {
	pctx.emit({ kind: "open", node: frame });
	for (let child of frame.children) {
		emitClonedSubtree(pctx, child);
	}
	pctx.emit({ kind: "matched", node: frame });
}


// -------------------------------------------------------------
// SAVEPOINT / ROLLBACK (used by every combinator with backtrack)
// Captures: input position, the matched-array length of the
// innermost named frame (if preserving terminals), and the
// number of children the innermost named frame had. On restore,
// any later-added children are detached & rolled back, the
// matched array is truncated, and pos is reset.
//
// Note: maxPos is NOT captured / restored — it's monotonic and
// the whole point is to remember the furthest progress regardless
// of rollback. The memo table is also NOT captured / restored —
// memoized results are deterministic functions of (name, pos) and
// remain valid across rollbacks.
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
			sp.innerFrame.matched.length          = sp.matchedLen;
			sp.innerFrame.matchedPositions.length = sp.matchedLen;
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
			innerFrame.matchedPositions.push(pctx.pos);
		}
		if (onMatch) onMatch(el, innerFrame);
		pctx.pos++;
		pctx.bumpMaxPos();
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
//
// NOTE: gate breaks the state-free invariant that packrat memoization
// relies on. Grammars using gate must NOT enable config.memoize.
export function gate(predicate) {
	return async function gateFn(pctx) {
		var innerFrame = pctx.frameStack[pctx.frameStack.length - 1] || null;
		return !!predicate(innerFrame);
	};
}

// dispatch(selector, branches): state-driven alternation.
// selector(innerFrame) -> key. branches[key] is the chosen sub-parser.
// Fails iff the key is missing from branches.
//
// NOTE: like gate, dispatch is state-dependent and incompatible
// with config.memoize.
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
//
// When config.memoize is on, consults pctx.memo at (name, pos)
// before opening a frame:
//   - Cached failure → return false immediately. No frame opened,
//     no events emitted.
//   - Cached success → clone the memoized frame subtree, attach
//     under the current parent, advance pos to the cached endPos,
//     and re-emit open + matched events for the cloned subtree.
//     Commit events fire later via cascadeCommit, same as for
//     normally-parsed frames.
//
// Memo entries are stored on both success (with the frame as a
// clone source) and failure (with just the endPos for symmetry,
// though only the boolean is checked on hit).
export function production(name, grammar) {
	return async function prodFn(pctx) {
		var memoize = !!pctx.memo;
		var startPos = pctx.pos;
		var memoKey  = memoize ? (name + "@" + startPos) : null;

		if (memoize && pctx.memo.has(memoKey)) {
			let entry = pctx.memo.get(memoKey);
			if (!entry.ok) return false;
			let parent = pctx.frameStack.length > 0
				? pctx.frameStack[pctx.frameStack.length - 1]
				: null;
			let cloned = cloneFrameSubtree(entry.frame, parent, pctx);
			if (parent) parent.children.push(cloned);
			else        pctx.liveRoots.push(cloned);
			pctx.pos = entry.endPos;
			pctx.bumpMaxPos();
			emitClonedSubtree(pctx, cloned);
			return true;
		}

		var frame = openFrame(pctx, name);
		var ok = await grammar(pctx);
		if (ok) {
			closeFrameMatched(pctx, frame);
			if (memoize) pctx.memo.set(memoKey, { ok: true, endPos: pctx.pos, frame });
			return true;
		}
		else {
			closeFrameRolledBack(pctx, frame);
			if (memoize) pctx.memo.set(memoKey, { ok: false, endPos: startPos });
			return false;
		}
	};
}


// =============================================================
// DELIMITER HANDLING (syntactic layer only)
// Delimiter tokens (whitespace / comments) are recognized by
// the user's tokenizer. delim() / delimWSReq() consume them
// directly so the `preserveDelim` config flag can correctly
// decide whether delimiter tokens are recorded in the innermost
// frame's `matched` array.
// =============================================================

function recordDelim(pctx, el) {
	if (!(pctx.config.preserveTerminals && pctx.config.preserveDelim)) return;
	var innerFrame = pctx.frameStack[pctx.frameStack.length - 1];
	if (innerFrame && innerFrame.matched) {
		innerFrame.matched.push(el);
		innerFrame.matchedPositions.push(pctx.pos);
	}
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
			pctx.bumpMaxPos();
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
			pctx.bumpMaxPos();
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
		memoize: false,
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

		// run() -> Promise<{ok, pos, maxPos, roots}>
		// ok: whether the top-level grammar matched.
		// pos: final input position (may have rolled back to 0 on
		//      total parse failure).
		// maxPos: monotonic high-water mark — furthest position
		//         parsing ever reached. Useful for error reporting:
		//         the input element AT maxPos is the one that caused
		//         the parse to start failing.
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
				return {
					ok,
					pos: pctx.pos,
					maxPos: pctx.maxPos,
					roots: pctx.liveRoots.slice(),
				};
			}
			finally {
				// Give subscribers a chance to drain before closing,
				// then close. Closing is synchronous from here; any
				// in-flight for-await on next() will resolve to done.
				for (let sub of pctx.subscribers) sub.close();
			}
		},

		// elementAt(pos): synchronous lookup into the buffered input
		// at the given position. Returns the element if buffered, or
		// null if past the buffered tail. Useful after run() returns
		// for error reporting against maxPos.
		elementAt(pos) {
			return buffer.elementAt(pos);
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
//
//   parseCommitsAtDepth(n): factory — commit events at the given
//                 depth. For streaming AST consumers that want
//                 finalized shaped nodes at a specific tree level.
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
//
// Default shape: { type, parts, start, end }
//   - parts: terminals (tokens) and shaped child nodes, merged in
//     source order. Tokens are distinguishable from shaped nodes
//     by having a `value` field (tokens) rather than `parts`
//     (shaped nodes).
//   - start, end: character-level positions in the original source
//     text. Tokens carry char positions directly from the lex
//     layer; shaped nodes derive their positions from the .start
//     of the leftmost descendant and the .end of the rightmost
//     descendant. These fields are written after the custom-
//     shaper branch runs, so custom shapers cannot accidentally
//     drop or mistype them.
//
// shapers: { [productionName]: (frame, parts) => node }
//   When a shaper is registered for a production, it receives the
//   raw frame and the merged `parts` array, and returns a custom
//   AST node shape. The returned object is mutated to attach
//   char-level start/end; any start/end the shaper itself wrote
//   are overwritten.
//
// Merge logic: each matched terminal carries its input position in
// frame.matchedPositions (parallel array to frame.matched).
// Children carry startPos/endPos. We walk children and, before each
// one, drain any terminals whose recorded position falls before the
// child's startPos. Robust to `preserveDelim: false` — delim tokens
// advance pctx.pos without being added to matched, so the position-
// gap between consecutive matched entries can be > 1.
//
// Empty-parts edge case: a production that retained zero elements
// (all consumed input was filtered delim) yields start/end of null.
// Visible productions in practical grammars should not hit this;
// noted here for completeness.
export function shapeNode(frame, shapers) {
	var shapedChildren = frame.children.map(c => shapeNode(c, shapers));
	var tokens   = frame.matched          || [];
	var tokenPos = frame.matchedPositions || [];

	var parts = [];
	var ti = 0;
	for (let i = 0; i < frame.children.length; i++) {
		let child = frame.children[i];
		while (ti < tokens.length && tokenPos[ti] < child.startPos) {
			parts.push(tokens[ti++]);
		}
		parts.push(shapedChildren[i]);
	}
	while (ti < tokens.length) {
		parts.push(tokens[ti++]);
	}

	// Derive char-level start/end from the leftmost and rightmost
	// descendants. Tokens (from the lex layer) and already-shaped
	// child nodes (from prior recursion) both carry .start/.end as
	// char positions, so the same indexing works uniformly.
	var charStart = parts.length > 0 ? parts[0].start              : null;
	var charEnd   = parts.length > 0 ? parts[parts.length - 1].end : null;

	var shaper = shapers && shapers[frame.production];
	var node = shaper
		? shaper(frame, parts)
		: { type: frame.production, parts };
	node.start = charStart;
	node.end   = charEnd;
	return node;
}
