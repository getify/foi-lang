"use strict";

// =============================================================
// PullStream / Buffer — ContinuationTrampoline conversion model
//
// Models the slot table, the §6.14 bounce, contRamp, and the
// Buffer + PullStream hooks directly in JS. Runs the converted
// implementation against a naive pre-conversion implementation
// as reference control.
//
// WHAT THIS PROVES:
//   1. Equivalence — identical delivery order, identical settle
//      shape, across map chains, concatMap with pending outers,
//      early exit, overflow policy, and recycle. This is the
//      §6.14.4 "public API is unchanged" constraint.
//   2. Peak pending resumes during a Q-value drain is 1, not Q.
//   3. Per-segment native frame cost under re-entrant close.
//
// WHAT THIS CANNOT PROVE:
//   The converted cascade is all-tail by construction, and rests
//   on §3.4's PTC guarantee for its O(1) claim. JS engines do not
//   implement PTC, so the K-deep chain overflows on BOTH paths at
//   comparable K. runPtcControl() measures and prints that rather
//   than pretending otherwise.
// =============================================================


// -------------------------------------------------------------
// SUBSTRATE — Effect.Host.Slot.*, Effect.Host.Counter, Either
// -------------------------------------------------------------

var slots = new WeakMap();
var nextMintedId = 1;

function slotRead(inst) {
	return slots.get(inst);
}

function slotWrite(inst, val) {
	slots.set(inst, val);
}

function mintId() {
	return nextMintedId++;
}

function update(st, patch) {
	return Object.assign({}, st, patch);
}

function Right(v) {
	return { tag: "Right", value: v };
}

function Left(v) {
	return { tag: "Left", value: v };
}

function isRight(e) {
	return e != null && e.tag === "Right";
}

function isLeft(e) {
	return e != null && e.tag === "Left";
}


// -------------------------------------------------------------
// §6.14 CONTINUATION TRAMPOLINE
//
// Slot is a positional 2-tuple (§6.14.1); the one-argument form
// means "nothing pending" and costs neither a push nor a pop.
// The stack is a cons cell per §6.14.2 — never sliced, never
// rebuilt by spread.
// -------------------------------------------------------------

function ContinuationTrampoline(pair) {
	var inst = { __ns: "ContinuationTrampoline" };
	slotWrite(inst, pair);
	return inst;
}

function isTrampoline(v) {
	return v != null && v.__ns === "ContinuationTrampoline";
}

var trampolineStats = {
	bounces: 0,
	pushes: 0,
	pops: 0,
	peak: 0,
	depth: 0,
};

function resetTrampolineStats() {
	trampolineStats.bounces = 0;
	trampolineStats.pushes = 0;
	trampolineStats.pops = 0;
	trampolineStats.peak = 0;
	trampolineStats.depth = 0;
}

function bounce(inst) {
	var stack = null;
	var current = inst;
	var pending = 0;

	trampolineStats.bounces++;

	for (;;) {
		if (isTrampoline(current)) {
			let pair = slotRead(current);
			let left = pair[0];
			let right = (pair.length > 1 ? pair[1] : undefined);
			if (right !== undefined) {
				stack = [ right, stack ];
				pending++;
				trampolineStats.pushes++;
				if (pending > trampolineStats.peak) {
					trampolineStats.peak = pending;
				}
			}
			current = left();
			continue;
		}
		if (stack !== null) {
			let resume = stack[0];
			stack = stack[1];
			pending--;
			trampolineStats.pops++;
			current = resume(current);
			continue;
		}
		break;
	}

	return current;
}

// §6.14.3 — the discrimination arm is not an optimization; a
// drive point may legitimately receive an instance of some other
// namespace.
function contRamp(v) {
	return (isTrampoline(v) ? bounce(v) : v);
}


// -------------------------------------------------------------
// NAIVE IMPLEMENTATION (pre-conversion reference control)
//
// Every cb invokes downstream at statement position and discards
// the result; subscribe drains its residual queue in a loop.
// -------------------------------------------------------------

var naiveImpl = (function buildNaive(){

	function makeBuffer(capacity, overflow) {
		var subj = {};
		var buf = {};

		function ready() {
			var st = slotRead(subj);
			return st.state !== "InUse";
		}

		function enqueue(v) {
			var st = slotRead(subj);
			if (st.state === "Closed") return Left("Buffer Closed");
			if (st.subscriber != null) {
				slotWrite(subj, update(st, { state: "InUse" }));
				st.subscriber(Right(v));
				return Right(true);
			}
			if (st.queued.length < st.capacity) {
				slotWrite(subj, update(st, {
					state: "InUse",
					queued: st.queued.concat([ v ]),
				}));
				return Right(true);
			}
			if (st.overflow === "DROP_OLDEST") {
				let kept = st.queued.slice(1).concat([ v ]);
				slotWrite(subj, update(st, {
					state: "InUse",
					queued: kept,
				}));
				return Right(true);
			}
			if (st.overflow === "DROP_NEWEST") return Right(true);
			return Left("Buffer Full");
		}

		function close() {
			var st = slotRead(subj);
			if (st.state === "Closed") return Left("Buffer Closed");
			slotWrite(subj, update(st, {
				state: "Closed",
				queued: [],
				subscriber: null,
			}));
			if (st.subscriber != null) {
				st.subscriber(Left("PullStream Closed"));
			}
			return Right(true);
		}

		function subscribe(cb) {
			var st = slotRead(subj);
			if (st.state === "Closed") return Left("Buffer Closed");
			if (st.subscriber != null) return Left("Buffer In Use");
			slotWrite(subj, update(st, {
				state: "InUse",
				subscriber: cb,
				queued: [],
			}));
			for (let v of st.queued) {
				cb(Right(v));
			}
			return Right(true);
		}

		function unsubscribe() {
			var st = slotRead(subj);
			slotWrite(subj, update(st, { subscriber: null }));
		}

		Object.assign(subj, {
			buf, ready, enqueue, close, subscribe, unsubscribe,
		});
		Object.assign(buf, { ready });

		slotWrite(subj, {
			id: mintId(),
			state: "Fresh",
			capacity,
			overflow,
			queued: [],
			subscriber: null,
		});
		slotWrite(buf, { id: mintId(), subj });

		return subj;
	}

	function recycle(buf) {
		var bufState = slotRead(buf);
		var subj = bufState.subj;
		var subjState = slotRead(subj);
		if (subjState.state === "InUse") return Left("Buffer Not Ready");
		slotWrite(subj, update(subjState, {
			state: "Fresh",
			queued: [],
			subscriber: null,
		}));
		return subj;
	}

	function reader(source) {
		var st = {};
		slotWrite(st, { id: mintId(), source });
		return st;
	}

	function map(source, fn) {
		var st = {};

		function wrap(downstreamCb, installer) {
			function upstreamCb(either) {
				if (isLeft(either)) {
					downstreamCb(either);
					return;
				}
				downstreamCb(Right(fn(either.value)));
			}
			installer(source, upstreamCb);
		}

		slotWrite(st, { id: mintId(), source, wrap });
		return st;
	}

	function bind(source, fn) {
		var st = {};

		function wrap(downstreamCb, installer) {
			let innerActive = false;
			let pendingOuters = [];
			let outerClosed = false;

			function innerCb(either) {
				if (isLeft(either)) {
					innerActive = false;
					if (pendingOuters.length > 0) {
						let nextV = pendingOuters[0];
						pendingOuters = pendingOuters.slice(1);
						innerActive = true;
						installer(fn(nextV), innerCb);
						return;
					}
					if (outerClosed) {
						downstreamCb(Left("PullStream Closed"));
					}
					return;
				}
				downstreamCb(either);
			}

			function outerCb(either) {
				if (isLeft(either)) {
					outerClosed = true;
					if (!innerActive) {
						downstreamCb(Left("PullStream Closed"));
					}
					return;
				}
				if (innerActive) {
					pendingOuters = pendingOuters.concat([ either.value ]);
					return;
				}
				innerActive = true;
				installer(fn(either.value), innerCb);
			}

			installer(source, outerCb);
		}

		slotWrite(st, { id: mintId(), source, wrap });
		return st;
	}

	function drive(tail, onEach) {
		var result = { status: "pending", value: undefined };

		function settle(status, value) {
			if (result.status === "pending") {
				result.status = status;
				result.value = value;
			}
		}

		function onValue(v) {
			let r = onEach(v);
			if (r != null && "left" in r) {
				settle("Left", r.left);
				return;
			}
			if (r != null && "done" in r) {
				settle("Right", r.done);
			}
		}

		function rootCb(either) {
			if (isLeft(either)) {
				settle("Left", "PullStream Closed");
				return;
			}
			onValue(either.value);
		}

		function installCb(node, downstreamCb) {
			var slot = slotRead(node);
			if ("wrap" in slot) {
				slot.wrap(downstreamCb, installCb);
				return;
			}
			slot.source.subscribe(downstreamCb);
		}

		installCb(tail, rootCb);
		return result;
	}

	return { name: "naive", makeBuffer, recycle, reader, map, bind, drive };

})();


// -------------------------------------------------------------
// CONVERTED IMPLEMENTATION
//
// Every cb and every install step returns its downstream call.
// subscribe's residual drain is reified as a pair chain walked
// by index (§6.14.2). Drive points: enqueue, close, and the
// bind-time install.
// -------------------------------------------------------------

var convertedImpl = (function buildConverted(){

	function makeBuffer(capacity, overflow) {
		var subj = {};
		var buf = {};

		function ready() {
			var st = slotRead(subj);
			return st.state !== "InUse";
		}

		// One pair per queued value; the resume advances the index
		// and does nothing else, so peak pending is 1 regardless
		// of queue length. Walked by index — never sliced.
		function drainFrom(cb, vals, i) {
			if (i < vals.length) {
				return ContinuationTrampoline([
					function drainThunk() {
						return cb(Right(vals[i]));
					},
					function drainResume(res) {
						return drainFrom(cb, vals, i + 1);
					},
				]);
			}
			return Right(true);
		}

		function enqueue(v) {
			var st = slotRead(subj);
			if (st.state === "Closed") return Left("Buffer Closed");
			if (st.subscriber != null) {
				slotWrite(subj, update(st, { state: "InUse" }));
				contRamp(st.subscriber(Right(v)));
				return Right(true);
			}
			if (st.queued.length < st.capacity) {
				slotWrite(subj, update(st, {
					state: "InUse",
					queued: st.queued.concat([ v ]),
				}));
				return Right(true);
			}
			if (st.overflow === "DROP_OLDEST") {
				let kept = st.queued.slice(1).concat([ v ]);
				slotWrite(subj, update(st, {
					state: "InUse",
					queued: kept,
				}));
				return Right(true);
			}
			if (st.overflow === "DROP_NEWEST") return Right(true);
			return Left("Buffer Full");
		}

		function close() {
			var st = slotRead(subj);
			if (st.state === "Closed") return Left("Buffer Closed");
			slotWrite(subj, update(st, {
				state: "Closed",
				queued: [],
				subscriber: null,
			}));
			if (st.subscriber != null) {
				contRamp(st.subscriber(Left("PullStream Closed")));
			}
			return Right(true);
		}

		function subscribe(cb) {
			var st = slotRead(subj);
			if (st.state === "Closed") return Left("Buffer Closed");
			if (st.subscriber != null) return Left("Buffer In Use");
			slotWrite(subj, update(st, {
				state: "InUse",
				subscriber: cb,
				queued: [],
			}));
			return drainFrom(cb, st.queued, 0);
		}

		function unsubscribe() {
			var st = slotRead(subj);
			slotWrite(subj, update(st, { subscriber: null }));
		}

		Object.assign(subj, {
			buf, ready, enqueue, close, subscribe, unsubscribe,
		});
		Object.assign(buf, { ready });

		slotWrite(subj, {
			id: mintId(),
			state: "Fresh",
			capacity,
			overflow,
			queued: [],
			subscriber: null,
		});
		slotWrite(buf, { id: mintId(), subj });

		return subj;
	}

	function recycle(buf) {
		var bufState = slotRead(buf);
		var subj = bufState.subj;
		var subjState = slotRead(subj);
		if (subjState.state === "InUse") return Left("Buffer Not Ready");
		slotWrite(subj, update(subjState, {
			state: "Fresh",
			queued: [],
			subscriber: null,
		}));
		return subj;
	}

	function reader(source) {
		var st = {};
		slotWrite(st, { id: mintId(), source });
		return st;
	}

	function map(source, fn) {
		var st = {};

		function wrap(downstreamCb, installer) {
			function upstreamCb(either) {
				return (isLeft(either)
					? downstreamCb(either)
					: downstreamCb(Right(fn(either.value))));
			}
			return installer(source, upstreamCb);
		}

		slotWrite(st, { id: mintId(), source, wrap });
		return st;
	}

	function bind(source, fn) {
		var st = {};

		function wrap(downstreamCb, installer) {
			let innerActive = false;
			let pendingOuters = [];
			let outerClosed = false;

			function innerCb(either) {
				return (isLeft(either) ? onInnerClose() : downstreamCb(either));
			}

			function onInnerClose() {
				innerActive = false;
				if (pendingOuters.length > 0) return openNext();
				if (outerClosed) return downstreamCb(Left("PullStream Closed"));
				return undefined;
			}

			function openNext() {
				let nextV = pendingOuters[0];
				pendingOuters = pendingOuters.slice(1);
				innerActive = true;
				return installer(fn(nextV), innerCb);
			}

			function outerCb(either) {
				return (isLeft(either)
					? onOuterClose()
					: onOuterValue(either.value));
			}

			function onOuterClose() {
				outerClosed = true;
				if (!innerActive) return downstreamCb(Left("PullStream Closed"));
				return undefined;
			}

			function onOuterValue(v) {
				if (innerActive) {
					pendingOuters = pendingOuters.concat([ v ]);
					return undefined;
				}
				return openInner(v);
			}

			function openInner(v) {
				innerActive = true;
				return installer(fn(v), innerCb);
			}

			return installer(source, outerCb);
		}

		slotWrite(st, { id: mintId(), source, wrap });
		return st;
	}

	function drive(tail, onEach) {
		var result = { status: "pending", value: undefined };

		function settle(status, value) {
			if (result.status === "pending") {
				result.status = status;
				result.value = value;
			}
		}

		function onValue(v) {
			let r = onEach(v);
			if (r != null && "left" in r) {
				settle("Left", r.left);
				return undefined;
			}
			if (r != null && "done" in r) {
				settle("Right", r.done);
				return undefined;
			}
			return undefined;
		}

		function rootCb(either) {
			if (isLeft(either)) {
				settle("Left", "PullStream Closed");
				return undefined;
			}
			return onValue(either.value);
		}

		function installCb(node, downstreamCb) {
			var slot = slotRead(node);
			if ("wrap" in slot) return slot.wrap(downstreamCb, installCb);
			return slot.source.subscribe(downstreamCb);
		}

		contRamp(installCb(tail, rootCb));
		return result;
	}

	return { name: "converted", makeBuffer, recycle, reader, map, bind, drive };

})();


// -------------------------------------------------------------
// SCENARIOS — run identically against either implementation
// -------------------------------------------------------------

function makeStream(impl, capacity, overflow) {
	var subj = impl.makeBuffer(capacity, overflow);
	return { subj, buf: subj.buf, reader: impl.reader(subj) };
}

// K-deep map chain over pre-queued values, then close.
function scenarioMapChain(impl, K, values) {
	var log = [];
	var s = makeStream(impl, values.length + 4, "DROP_NEWEST");
	var node = s.reader;

	for (let i = 0; i < K; i++) {
		node = impl.map(node, (v) => v + 1);
	}
	values.forEach((v) => s.subj.enqueue(v));

	var res = impl.drive(node, (v) => { log.push(v); return undefined; });
	s.subj.close();

	return { log, status: res.status, value: res.value };
}

// Values arriving live, after the drive has installed.
function scenarioLiveDelivery(impl, values) {
	var log = [];
	var s = makeStream(impl, 8, "DROP_NEWEST");
	var node = impl.map(s.reader, (v) => v * 2);

	var res = impl.drive(node, (v) => { log.push(v); return undefined; });
	values.forEach((v) => s.subj.enqueue(v));
	s.subj.close();

	return { log, status: res.status, value: res.value };
}

// concatMap: outer values queue in pendingOuters while an inner
// is active; each inner opens only on the previous inner's close.
function scenarioConcatMap(impl, outerValues) {
	var log = [];
	var innerSubjs = [];
	var outer = makeStream(impl, 64, "DROP_NEWEST");

	function fn(v) {
		let inner = makeStream(impl, 8, "DROP_NEWEST");
		inner.subj.enqueue(v * 10);
		inner.subj.enqueue(v * 10 + 1);
		innerSubjs.push(inner.subj);
		return inner.reader;
	}

	var node = impl.bind(outer.reader, fn);
	outerValues.forEach((v) => outer.subj.enqueue(v));

	var res = impl.drive(node, (v) => { log.push(v); return undefined; });

	// Close inners in the order they were opened; each close is a
	// separate top-level producer action.
	let i = 0;
	while (i < innerSubjs.length) {
		innerSubjs[i].close();
		i++;
	}
	outer.subj.close();
	while (i < innerSubjs.length) {
		innerSubjs[i].close();
		i++;
	}

	return {
		log,
		opened: innerSubjs.length,
		status: res.status,
		value: res.value,
	};
}

// Consumer terminates early; later arrivals must not re-settle.
function scenarioEarlyExit(impl, values, stopAfter) {
	var log = [];
	var s = makeStream(impl, 64, "DROP_NEWEST");
	var node = impl.map(s.reader, (v) => v);
	values.forEach((v) => s.subj.enqueue(v));

	var res = impl.drive(node, (v) => {
		log.push(v);
		return (log.length === stopAfter ? { done: v } : undefined);
	});
	s.subj.close();

	return { log, status: res.status, value: res.value };
}

function scenarioOverflow(impl, overflow, capacity, values) {
	var log = [];
	var results = [];
	var s = makeStream(impl, capacity, overflow);

	values.forEach((v) => {
		let r = s.subj.enqueue(v);
		results.push(r.tag + ":" + String(r.value));
	});

	var res = impl.drive(s.reader, (v) => { log.push(v); return undefined; });
	s.subj.close();

	return { log, results, status: res.status, value: res.value };
}

function scenarioRecycle(impl) {
	var firstLog = [];
	var secondLog = [];
	var s = makeStream(impl, 8, "DROP_NEWEST");

	s.subj.enqueue(1);
	s.subj.enqueue(2);
	var res1 = impl.drive(s.reader, (v) => { firstLog.push(v); return undefined; });
	s.subj.close();

	var recycled = impl.recycle(s.buf);
	var readyAfter = recycled.ready();
	var node2 = impl.reader(recycled);
	recycled.enqueue(3);
	var res2 = impl.drive(node2, (v) => { secondLog.push(v); return undefined; });
	recycled.close();

	return {
		firstLog,
		secondLog,
		readyAfter,
		first: res1.status + ":" + String(res1.value),
		second: res2.status + ":" + String(res2.value),
	};
}

// Re-entrant close: the consumer closes the currently-open inner
// from inside its own delivery, so segment k+1 opens from within
// segment k's frame. This is the axis the drain reification
// affects — both paths grow linearly, the converted path with a
// smaller per-segment constant.
function scenarioSegments(impl, M) {
	var innerSubjs = [];
	var delivered = 0;
	var outer = makeStream(impl, M + 4, "DROP_NEWEST");

	function fn(v) {
		let inner = makeStream(impl, 4, "DROP_NEWEST");
		inner.subj.enqueue(v);
		innerSubjs.push(inner.subj);
		return inner.reader;
	}

	var node = impl.bind(outer.reader, fn);
	for (let i = 1; i <= M; i++) {
		outer.subj.enqueue(i);
	}

	var res = impl.drive(node, (v) => {
		delivered++;
		innerSubjs[innerSubjs.length - 1].close();
		return undefined;
	});

	return { delivered, opened: innerSubjs.length, status: res.status };
}


// -------------------------------------------------------------
// HARNESS
// -------------------------------------------------------------

const LADDER = [ 100, 300, 1000, 3000, 10000, 30000, 100000 ];

var passed = 0;
var failed = 0;

function eq(a, b) {
	return JSON.stringify(a) === JSON.stringify(b);
}

function assert(label, cond, detail) {
	if (cond) {
		passed++;
		console.log("  ok    " + label);
	}
	else {
		failed++;
		console.log("  FAIL  " + label + (detail ? "\n          " + detail : ""));
	}
}

function assertSame(label, a, b) {
	assert(
		label,
		eq(a, b),
		"naive:     " + JSON.stringify(a) + "\n          converted: " + JSON.stringify(b)
	);
}

function survives(fn) {
	try {
		fn();
		return true;
	}
	catch (err) {
		if (err instanceof RangeError) return false;
		throw err;
	}
}

function overflowLadder(runAt, ladder) {
	var lastOk = 0;
	for (let n of ladder) {
		if (survives(() => runAt(n))) lastOk = n;
		else return { lastOk, firstFail: n };
	}
	return { lastOk, firstFail: null };
}

function runEquivalence() {
	console.log("\n-- equivalence (§6.14.4: public API unchanged) --");

	assertSame(
		"map chain, 5 links, pre-queued",
		scenarioMapChain(naiveImpl, 5, [ 1, 2, 3, 4 ]),
		scenarioMapChain(convertedImpl, 5, [ 1, 2, 3, 4 ])
	);

	assertSame(
		"map chain, 1 link, single value",
		scenarioMapChain(naiveImpl, 1, [ 7 ]),
		scenarioMapChain(convertedImpl, 1, [ 7 ])
	);

	assertSame(
		"map chain, empty queue",
		scenarioMapChain(naiveImpl, 3, []),
		scenarioMapChain(convertedImpl, 3, [])
	);

	assertSame(
		"live delivery after install",
		scenarioLiveDelivery(naiveImpl, [ 1, 2, 3 ]),
		scenarioLiveDelivery(convertedImpl, [ 1, 2, 3 ])
	);

	assertSame(
		"concatMap, 3 outers with pending queue",
		scenarioConcatMap(naiveImpl, [ 1, 2, 3 ]),
		scenarioConcatMap(convertedImpl, [ 1, 2, 3 ])
	);

	assertSame(
		"concatMap, single outer",
		scenarioConcatMap(naiveImpl, [ 5 ]),
		scenarioConcatMap(convertedImpl, [ 5 ])
	);

	assertSame(
		"early exit at 3rd value",
		scenarioEarlyExit(naiveImpl, [ 1, 2, 3, 4, 5 ], 3),
		scenarioEarlyExit(convertedImpl, [ 1, 2, 3, 4, 5 ], 3)
	);

	assertSame(
		"overflow DROP_OLDEST",
		scenarioOverflow(naiveImpl, "DROP_OLDEST", 2, [ 1, 2, 3, 4 ]),
		scenarioOverflow(convertedImpl, "DROP_OLDEST", 2, [ 1, 2, 3, 4 ])
	);

	assertSame(
		"overflow DROP_NEWEST",
		scenarioOverflow(naiveImpl, "DROP_NEWEST", 2, [ 1, 2, 3, 4 ]),
		scenarioOverflow(convertedImpl, "DROP_NEWEST", 2, [ 1, 2, 3, 4 ])
	);

	assertSame(
		"overflow reject (Buffer Full)",
		scenarioOverflow(naiveImpl, "REJECT", 2, [ 1, 2, 3, 4 ]),
		scenarioOverflow(convertedImpl, "REJECT", 2, [ 1, 2, 3, 4 ])
	);

	assertSame(
		"recycle across cycles",
		scenarioRecycle(naiveImpl),
		scenarioRecycle(convertedImpl)
	);

	// Sanity: the scenarios are actually exercising something.
	var chain = scenarioMapChain(convertedImpl, 5, [ 1, 2, 3, 4 ]);
	assert(
		"map chain delivered expected values",
		eq(chain.log, [ 6, 7, 8, 9 ]),
		JSON.stringify(chain.log)
	);

	var cm = scenarioConcatMap(convertedImpl, [ 1, 2, 3 ]);
	assert(
		"concatMap preserved segment order",
		eq(cm.log, [ 10, 11, 20, 21, 30, 31 ]),
		JSON.stringify(cm.log)
	);
	assert(
		"concatMap settled on final close",
		cm.status === "Left" && cm.value === "PullStream Closed",
		cm.status + ":" + String(cm.value)
	);
}

function runTrampolineStats() {
	console.log("\n-- reified drain: peak pending resumes --");

	const Q = 1000;
	var values = [];
	for (let i = 0; i < Q; i++) {
		values.push(i);
	}

	resetTrampolineStats();
	var out = scenarioMapChain(convertedImpl, 3, values);

	assert(
		"drain delivered all " + Q + " values",
		out.log.length === Q,
		String(out.log.length)
	);
	assert(
		"peak pending resumes is 1, not " + Q,
		trampolineStats.peak === 1,
		"peak=" + trampolineStats.peak
	);
	assert(
		"one push per queued value",
		trampolineStats.pushes === Q,
		"pushes=" + trampolineStats.pushes
	);
	assert(
		"every push popped",
		trampolineStats.pops === trampolineStats.pushes,
		"pushes=" + trampolineStats.pushes + " pops=" + trampolineStats.pops
	);

	console.log(
		"        bounces=" + trampolineStats.bounces +
		" pushes=" + trampolineStats.pushes +
		" peak=" + trampolineStats.peak
	);
}

// REPLACES runSegmentDepth — measurement and equivalence only.
// The depth claim this used to assert was wrong: a consumer-side
// close is itself a drive point, so it opens a nested bounce and
// the converted path nests exactly as the naive one does. The
// drain reification's benefit — subscribe returning before it
// delivers — removes the one non-tail frame per segment, which
// matters under §3.4 and is invisible without PTC.
const SEGMENT_LADDER = [ 100, 300, 1000, 3000 ];

function runSegmentDepth() {
	console.log("\n-- re-entrant segment chain --");

	assertSame(
		"200 segments, identical delivery",
		scenarioSegments(naiveImpl, 200),
		scenarioSegments(convertedImpl, 200)
	);

	var small = scenarioSegments(convertedImpl, 200);
	assert(
		"200 segments each opened and delivered once",
		small.delivered === 200 && small.opened === 200,
		JSON.stringify(small)
	);

	var naive = overflowLadder((n) => scenarioSegments(naiveImpl, n), SEGMENT_LADDER);
	var conv = overflowLadder((n) => scenarioSegments(convertedImpl, n), SEGMENT_LADDER);

	console.log("        naive     ok to M=" + naive.lastOk +
		", first overflow at " + String(naive.firstFail));
	console.log("        converted ok to M=" + conv.lastOk +
		", first overflow at " + String(conv.firstFail));
	console.log("        Expected comparable: the consumer-side close in this");
	console.log("        scenario is a drive point, so both paths nest one");
	console.log("        bounce per segment. Reported, not asserted.");
}

function runPtcControl() {
	console.log("\n-- CONTROL: chain depth (§3.4 axis, not observable in JS) --");

	var naive = overflowLadder((n) => scenarioMapChain(naiveImpl, n, [ 1 ]), LADDER);
	var conv = overflowLadder((n) => scenarioMapChain(convertedImpl, n, [ 1 ]), LADDER);

	console.log("        naive     ok to K=" + naive.lastOk +
		", first overflow at " + String(naive.firstFail));
	console.log("        converted ok to K=" + conv.lastOk +
		", first overflow at " + String(conv.firstFail));
	console.log("        Both are expected to overflow at comparable K.");
	console.log("        The converted cascade is all-tail by construction;");
	console.log("        its O(1) claim rests on §3.4 PTC, which V8 does not");
	console.log("        implement. This measures the model's limit, not the");
	console.log("        language's.");
}

function main() {
	console.log("PullStream / Buffer — ContinuationTrampoline conversion");

	runEquivalence();
	runTrampolineStats();
	runSegmentDepth();
	runPtcControl();

	console.log("\n" + passed + " passed, " + failed + " failed");
	if (failed > 0) process.exitCode = 1;
}

main();
