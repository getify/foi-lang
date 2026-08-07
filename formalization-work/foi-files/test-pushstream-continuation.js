// pushstream-trampoline-smoke.js
//
// Models the converted PushStream hooks directly — the sketch
// can't be transpiled as-is (namespace ?as lowers to a falsy
// comment, and %-dispatch falls back to identity on a missing
// hook, so a transpiled run would produce garbage rather than
// crash).
//
// Modeled:  hidden slots, Effect.Host.Counter, the §6.14.2 bounce,
//           contRamp, deliverFrom, and every converted hook.
// Not modeled: PushStream~<* (needs a do-scope stand-in with
//           one-shot ret), idempotent subscription, ~<'s inner-
//           close refcounting. Listed again at the end of the run.

"use strict";

const EMPTY = undefined;
const TRAMP = Symbol("ContinuationTrampoline");


// =================================================================
// Runtime model
// =================================================================

// Hidden slots (§6.1.5): side-table keyed on substrate identity.
var slots = new WeakMap();
var slotRead = inst => slots.get(inst);
var slotWrite = (inst, val) => { slots.set(inst, val); };

// Effect.Host.Counter (§6.1.5.8) — opaque, unique, run-local.
var counter = 0;
var mintId = () => ({ [Symbol("minted")]: ++counter });

var right = v => ({ kind: "Right", value: v });
var left = v => ({ kind: "Left", value: v });
var honor = v => ({ kind: "Promise", state: "honored", value: v });
var renege = v => ({ kind: "Promise", state: "reneged", value: v });

// closedSubj stand-in. Under the reconciliation this is a LEAF —
// .closed()'s observation surface only, never the propagation
// road. Settle count is asserted against stream-close count.
var makePromiseSubj = () => ({ settled: false, value: EMPTY, observers: [] });
var settlePromise = (p, v) => {
	if (p.settled) return;
	p.settled = true;
	p.value = v;
	stats.settles++;
	for (let cb of p.observers) cb(v);
};


// -- Continuation pair + bounce (§6.14.1, §6.14.2) -----------------

var contPair = (thunk, resume) => ({ [TRAMP]: true, thunk, resume });
var isTramp = v => v != null && v[TRAMP] === true;

var stats = {
	bounces: 0, pushes: 0, pops: 0,
	live: 0, peakLive: 0,
	settles: 0, deliveries: 0,
	reset() {
		this.bounces = this.pushes = this.pops = 0;
		this.live = this.peakLive = 0;
		this.settles = this.deliveries = 0;
	}
};

// Abstract execution per §6.14.2, verbatim: LIFO cons-cell stack,
// push-then-invoke-thunk, pop-and-resume, terminate when neither.
var bounce = inst => {
	stats.bounces++;
	var stack = null;
	var current = inst;
	for (;;) {
		if (isTramp(current)) {
			let pair = current;
			if (pair.resume !== EMPTY) {
				stack = { head: pair.resume, tail: stack };
				stats.pushes++;
				stats.live++;
				if (stats.live > stats.peakLive) stats.peakLive = stats.live;
			}
			current = pair.thunk();
		}
		else if (stack !== null) {
			let resume = stack.head;
			stack = stack.tail;
			stats.pops++;
			stats.live--;
			current = resume(current);
		}
		else break;
	}
	return current;
};

var contRamp = v => isTramp(v) ? bounce(v) : v;


// =================================================================
// Delivery strategies
// =================================================================

// CONVERTED — index-walked pair chain (§6.14.2's by-index rule).
var deliverFrom = (subs, idx, msg) =>
	idx >= subs.length
		? EMPTY
		: contPair(
			() => subs[idx](msg),
			res => deliverFrom(subs, idx + 1, msg)
		);

// CONVERTED + one-argument-form elision at the last subscriber
// (§6.14.1: a pair with no resume costs neither push nor pop).
// Measured against the plain form in T11; not in the landed sketch.
var deliverFromElided = (subs, idx, msg) =>
	idx >= subs.length
		? EMPTY
		: idx === subs.length - 1
			? contPair(() => subs[idx](msg))
			: contPair(
				() => subs[idx](msg),
				res => deliverFromElided(subs, idx + 1, msg)
			);

// CONTROL — the reconciled shape WITHOUT the trampoline. Breadth
// is a loop (no frames, same as `~each`); depth is nested calls
// (frames, and this is what overflows).
//
// NOTE: this is the pre-conversion shape of the RECONCILED design,
// not the original Promise-per-level close cascade. Modeling that
// would mean modeling Promise's own converted resolve.
var deliverNaive = (subs, idx, msg) => {
	for (let i = idx; i < subs.length; i++) subs[i](msg);
	return EMPTY;
};

// Deliberately-sliced variant. Used ONLY in T10 to show what the
// by-index rule buys. Never a candidate implementation.
var deliverSliced = (subs, msg) =>
	subs.length === 0
		? EMPTY
		: contPair(
			() => subs[0](msg),
			res => deliverSliced(subs.slice(1), msg)
		);


// =================================================================
// PushStream hooks — parameterized by delivery strategy
// =================================================================

var makeLib = (mode, deliverImpl = deliverFromElided) => {
	var converted = (mode === "converted");
	var deliver = (subs, msg) => {
		stats.deliveries++;
		return converted ? deliverImpl(subs, 0, msg) : deliverNaive(subs, 0, msg);
	};
	// Drive point: bounce in converted mode, no-op wrapper in naive.
	var drive = v => converted ? contRamp(v) : v;

	var makeStream = () => {
		var st = {};
		slotWrite(st, {
			id: mintId(),
			closed: false,
			subscribers: [],
			closedSubj: makePromiseSubj()
		});
		return st;
	};

	// Record-spread-update per §6.1.5 — a NEW array each time, so an
	// in-flight walk holds its own snapshot. T12 depends on this.
	var subscribe = (target, cb) => {
		var s = slotRead(target);
		slotWrite(target, { ...s, subscribers: [ ...s.subscribers, cb ] });
	};

	// Harness-only: bulk subscribe in one write. Spread-per-subscriber
	// is O(M^2) to BUILD M subscribers, which would hang T10 for
	// reasons unrelated to delivery. Snapshot semantics in the
	// delivery path are unaffected.
	var subscribeMany = (target, cbs) => {
		var s = slotRead(target);
		slotWrite(target, { ...s, subscribers: [ ...s.subscribers, ...cbs ] });
	};

	var closeStream = derived => {
		var dState = slotRead(derived);
		slotWrite(derived, { ...dState, closed: true });
		settlePromise(dState.closedSubj, right(EMPTY));
		return deliver(dState.subscribers, { close: true });
	};

	var subject = () => {
		var st = makeStream();
		var subj = { st, close: closeFn };
		slotWrite(subj, { id: mintId(), associated: st });
		return subj;

		// Drive point: close enters from user code.
		function closeFn() {
			let stState = slotRead(st);
			if (stState.closed) return left("PushStream Closed");
			slotWrite(st, { ...stState, closed: true });
			settlePromise(stState.closedSubj, right(EMPTY));
			drive(deliver(stState.subscribers, { close: true }));
			return right(true);
		}
	};

	// Drive point per §6.14.4 step 3. Delivery is driven to
	// completion before the Promise is honored.
	var broadcast = (inst, v) => {
		var state = slotRead(inst);
		if (!("associated" in state)) {
			return renege("PushStream: broadcast requires subject");
		}
		var stState = slotRead(state.associated);
		if (stState.closed) return renege("PushStream Closed");
		drive(deliver(stState.subscribers, { value: v }));
		return honor(true);
	};

	var map_ = (source, fn) => {
		var derived = makeStream();
		subscribe(source, pushCb);
		return derived;

		function pushCb(msg) {
			let dState = slotRead(derived);
			if (dState.closed) return EMPTY;
			if ("close" in msg) return closeStream(derived);
			return deliver(dState.subscribers, { value: fn(msg.value) });
		}
	};

	var bind_ = (source, fn) => {
		var derived = makeStream();
		subscribe(source, pushCb);
		return derived;

		function pushCb(msg) {
			let dState = slotRead(derived);
			if (dState.closed) return EMPTY;
			if ("close" in msg) return closeStream(derived);
			subscribe(fn(msg.value), forwardCb);
			return EMPTY;
		}
		function forwardCb(msg) {
			let dState = slotRead(derived);
			if (dState.closed) return EMPTY;
			if ("close" in msg) return EMPTY;
			return deliver(dState.subscribers, msg);
		}
	};

	var takeUntil = (sourceSt, signalSt) => {
		var derived = makeStream();
		subscribe(sourceSt, forwardCb);
		subscribe(signalSt, signalCb);
		return derived;

		function forwardCb(msg) {
			let dState = slotRead(derived);
			if (dState.closed) return EMPTY;
			if ("close" in msg) return closeStream(derived);
			return deliver(dState.subscribers, msg);
		}
		function signalCb(msg) {
			let dState = slotRead(derived);
			if (dState.closed) return EMPTY;
			return closeStream(derived);
		}
	};

	var merge = sts => {
		var derived = makeStream();
		var remaining = sts.length;
		for (let src of sts) subscribe(src, forwardCb);
		return derived;

		function forwardCb(msg) {
			let dState = slotRead(derived);
			if (dState.closed) return EMPTY;
			if ("close" in msg) {
				remaining--;
				return remaining === 0 ? closeStream(derived) : EMPTY;
			}
			return deliver(dState.subscribers, msg);
		}
	};

	var filter = (sourceSt, pred) => {
		var derived = makeStream();
		subscribe(sourceSt, forwardCb);
		return derived;

		function forwardCb(msg) {
			let dState = slotRead(derived);
			if (dState.closed) return EMPTY;
			if ("close" in msg) return closeStream(derived);
			if (!pred(msg.value)) return EMPTY;
			return deliver(dState.subscribers, msg);
		}
	};

	var scan = (sourceSt, init, fn) => {
		var derived = makeStream();
		var acc = init;
		subscribe(sourceSt, forwardCb);
		return derived;

		function forwardCb(msg) {
			let dState = slotRead(derived);
			if (dState.closed) return EMPTY;
			if ("close" in msg) return closeStream(derived);
			acc = fn(acc, msg.value);
			return deliver(dState.subscribers, { value: acc });
		}
	};

	// Leaf sink — no downstream stream, so no pair chain. Stands in
	// for the shape ~<*'s observerCb has, without the do-scope.
	var sink = (source, onValue, onClose = () => {}) => {
		subscribe(source, msg => {
			if ("close" in msg) onClose();
			else onValue(msg.value);
			return EMPTY;
		});
	};

	var isClosed = st => slotRead(st).closed;

	return {
		subject, broadcast, map_, bind_, takeUntil,
		merge, filter, scan, sink, isClosed, subscribeMany, makeStream
	};
};


// =================================================================
// Harness
// =================================================================

var passed = 0;
var failed = 0;
var notes = [];

var check = (label, cond, detail = "") => {
	if (cond) {
		passed++;
		console.log(`  ok   ${label}${detail ? "  (" + detail + ")" : ""}`);
	}
	else {
		failed++;
		console.log(`  FAIL ${label}${detail ? "  (" + detail + ")" : ""}`);
	}
};

var section = label => console.log(`\n${label}`);
var note = msg => { notes.push(msg); console.log(`  ..   ${msg}`); };

var eqArr = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

var overflows = fn => {
	try { fn(); return false; }
	catch (err) { return err instanceof RangeError; }
};

// Linear chain of `depth` ~map levels, terminating in a leaf sink.
var buildChain = (L, depth, onValue) => {
	var subj = L.subject();
	var cur = subj.st;
	for (let i = 0; i < depth; i++) cur = L.map_(cur, v => v + 1);
	L.sink(cur, onValue);
	return subj;
};


// =================================================================
// Tests
// =================================================================

section("T1-T3  basic delivery");
{
	let L = makeLib("converted");
	let subj = L.subject();
	let got = [];
	L.sink(L.map_(subj.st, v => v * 2), v => got.push(v));

	L.broadcast(subj, 1);
	check("T1 single observer receives", eqArr(got, [ 2 ]), `got=[${got}]`);

	let got2 = [];
	L.sink(L.map_(subj.st, v => v * 10), v => got2.push(v));
	L.broadcast(subj, 2);
	check("T2 no-replay for late subscriber", eqArr(got2, [ 20 ]), `got2=[${got2}]`);
	check("T3 broadcast reaches both", eqArr(got, [ 2, 4 ]), `got=[${got}]`);
}

section("T4  converted / naive equivalence");
{
	let run = mode => {
		let L = makeLib(mode);
		let log = [];
		let subj = L.subject();
		let a = L.filter(subj.st, v => v % 2 === 0);
		let b = L.scan(a, 0, (acc, v) => acc + v);
		let c = L.map_(b, v => `t${v}`);
		L.sink(c, v => log.push(v), () => log.push("CLOSE"));
		for (let i = 1; i <= 20; i++) L.broadcast(subj, i);
		subj.close();
		return log;
	};
	let conv = run("converted");
	let naive = run("naive");
	check("T4 pipeline output identical", eqArr(conv, naive),
		`${conv.length} events`);
	check("T4 close reached the leaf", conv[conv.length - 1] === "CLOSE");
}

section("T5  fan-out ordering (depth-first) — the new assertion");
{
	// Source has TWO subscribers. Subscriber A is a 3-level chain;
	// subscriber B is a leaf. Every level of A must fire before B.
	let run = mode => {
		let L = makeLib(mode);
		let order = [];
		let subj = L.subject();
		let a1 = L.map_(subj.st, v => { order.push("A1"); return v; });
		let a2 = L.map_(a1, v => { order.push("A2"); return v; });
		let a3 = L.map_(a2, v => { order.push("A3"); return v; });
		L.sink(a3, () => order.push("A-leaf"));
		L.sink(subj.st, () => order.push("B-leaf"));
		L.broadcast(subj, 1);
		return order;
	};
	const EXPECTED = [ "A1", "A2", "A3", "A-leaf", "B-leaf" ];
	let conv = run("converted");
	let naive = run("naive");
	check("T5 converted drains A fully before B",
		eqArr(conv, EXPECTED), `[${conv}]`);
	check("T5 matches naive nested-call order",
		eqArr(conv, naive), `[${naive}]`);
}

section("T6  chain depth — broadcast");
{
	let findOverflowDepth = () => {
		for (let d of [ 500, 1000, 2000, 4000, 8000, 16000, 32000 ]) {
			let blew = overflows(() => {
				let L = makeLib("naive");
				let subj = buildChain(L, d, () => {});
				L.broadcast(subj, 0);
			});
			if (blew) return d;
		}
		return null;
	};
	let d = findOverflowDepth();
	check("T6 CONTROL: naive path overflows on depth", d !== null,
		d === null ? "no overflow up to 32000 — test does not bite" : `at depth ${d}`);

	if (d !== null) {
		let deep = d * 4;
		let got = [];
		let survived = !overflows(() => {
			let L = makeLib("converted");
			let subj = buildChain(L, deep, v => got.push(v));
			L.broadcast(subj, 0);
		});
		check("T6 converted survives 4x that depth", survived, `depth ${deep}`);
		check("T6 value traversed every level", got.length === 1 && got[0] === deep,
			`got=${got[0]} expected=${deep}`);
	}
}

section("T7  chain depth — close cascade");
{
	let d = 8000;
	let naiveBlew = overflows(() => {
		let L = makeLib("naive");
		let subj = buildChain(L, d, () => {});
		subj.close();
	});
	check("T7 CONTROL: naive close cascade overflows", naiveBlew, `depth ${d}`);

	let closes = 0;
	let survived = !overflows(() => {
		let L = makeLib("converted");
		let subj = L.subject();
		let cur = subj.st;
		let levels = [];
		for (let i = 0; i < d; i++) { cur = L.map_(cur, v => v); levels.push(cur); }
		L.sink(cur, () => {}, () => { closes++; });
		subj.close();
		check("T7 every derived level closed",
			levels.every(st => L.isClosed(st)), `${levels.length} levels`);
	});
	check("T7 converted close cascade survives", survived, `depth ${d}`);
	check("T7 close reached the leaf exactly once", closes === 1, `closes=${closes}`);
}

section("T8  close semantics");
{
	let L = makeLib("converted");
	let subj = L.subject();
	let got = [];
	L.sink(subj.st, v => got.push(v));

	check("T8 first close returns Right", subj.close().kind === "Right");
	check("T8 second close returns Left", subj.close().kind === "Left");
	let r = L.broadcast(subj, 99);
	check("T8 broadcast after close reneges", r.state === "reneged");
	check("T8 no value delivered after close", got.length === 0);
}

section("T9  combinators");
{
	let L = makeLib("converted");
	let s1 = L.subject();
	let s2 = L.subject();
	let stop = L.subject();
	let m = L.merge([ s1.st, s2.st ]);
	let f = L.filter(m, v => v % 2 === 0);
	let sc = L.scan(f, 0, (acc, v) => acc + v);
	let b = L.takeUntil(sc, stop.st);
	let got = [];
	let closed = false;
	L.sink(b, v => got.push(v), () => { closed = true; });

	L.broadcast(s1, 1);
	L.broadcast(s2, 4);
	L.broadcast(s1, 3);
	L.broadcast(s2, 6);
	check("T9 merge+filter+scan", eqArr(got, [ 4, 10 ]), `got=[${got}]`);

	L.broadcast(stop, "x");
	check("T9 takeUntil closed derived on signal", closed);
	L.broadcast(s1, 8);
	check("T9 no delivery after takeUntil close", eqArr(got, [ 4, 10 ]));

	let L2 = makeLib("converted");
	let a = L2.subject();
	let bb = L2.subject();
	let mm = L2.merge([ a.st, bb.st ]);
	let mClosed = false;
	L2.sink(mm, () => {}, () => { mClosed = true; });
	a.close();
	check("T9 merge open while one source lives", !mClosed);
	bb.close();
	check("T9 merge closes when all sources closed", mClosed);
}

section("T10  by-index vs sliced fan-out");
{
	const WIDE = 20000;
	let build = () => {
		let L = makeLib("converted");
		let subj = L.subject();
		let hits = 0;
		let cbs = [];
		for (let i = 0; i < WIDE; i++) cbs.push(() => { hits++; return EMPTY; });
		L.subscribeMany(subj.st, cbs);
		return { L, subj, hits: () => hits };
	};

	let x = build();
	let t0 = Date.now();
	x.L.broadcast(x.subj, 1);
	let byIndexMs = Date.now() - t0;
	check("T10 all subscribers reached", x.hits() === WIDE, `${x.hits()}/${WIDE}`);

	// Same walk, sliced per step — O(N^2). Driven directly.
	let cbs2 = [];
	let hits2 = 0;
	for (let i = 0; i < WIDE; i++) cbs2.push(() => { hits2++; return EMPTY; });
	let t1 = Date.now();
	contRamp(deliverSliced(cbs2, { value: 1 }));
	let slicedMs = Date.now() - t1;

	check("T10 sliced variant reached all too", hits2 === WIDE);
	note(`by-index ${byIndexMs}ms  vs  sliced ${slicedMs}ms  ` +
		`(ratio ${slicedMs > 0 && byIndexMs > 0 ? (slicedMs / byIndexMs).toFixed(1) : "n/a"}x)`);
	check("T10 by-index is not slower than sliced", byIndexMs <= slicedMs);
}

section("T11  bounce accounting");
{
	const DEPTH = 1000;
	let measure = deliverImpl => {
		stats.reset();
		let L = makeLib("converted", deliverImpl);
		let subj = buildChain(L, DEPTH, () => {});
		L.broadcast(subj, 0);
		return { ...stats };
	};

	let plain = measure(deliverFrom);
	note(`plain    depth=${DEPTH}  bounces=${plain.bounces} ` +
		`pushes=${plain.pushes} pops=${plain.pops} peak=${plain.peakLive}`);
	check("T11 one bounce drove the whole broadcast", plain.bounces === 1,
		`bounces=${plain.bounces}`);
	check("T11 every push was popped", plain.pushes === plain.pops);
	check("T11 peak pending is O(depth), not O(depth^2)",
		plain.peakLive <= DEPTH + 2, `peak=${plain.peakLive}`);

	let elided = measure(deliverFromElided);
	note(`elided   depth=${DEPTH}  bounces=${elided.bounces} ` +
		`pushes=${elided.pushes} pops=${elided.pops} peak=${elided.peakLive}`);
	check("T11 one-argument-form elision costs no pushes on a 1-sub chain",
		elided.pushes === 0, `pushes=${elided.pushes}`);
}

section("T12  snapshot semantics + closedSubj is a leaf");
{
	let L = makeLib("converted");
	let subj = L.subject();
	let got = [];
	let lateGot = [];
	// First subscriber adds a second one mid-delivery.
	L.sink(subj.st, v => {
		got.push(v);
		if (got.length === 1) L.sink(subj.st, w => lateGot.push(w));
	});

	L.broadcast(subj, 1);
	check("T12 subscriber added mid-walk misses current value",
		lateGot.length === 0, `lateGot=[${lateGot}]`);
	L.broadcast(subj, 2);
	check("T12 and receives the next one", eqArr(lateGot, [ 2 ]));

	stats.reset();
	let L2 = makeLib("converted");
	let s2 = L2.subject();
	let cur = s2.st;
	const LEVELS = 50;
	for (let i = 0; i < LEVELS; i++) cur = L2.map_(cur, v => v);
	s2.close();
	check("T12 one closedSubj settle per closed stream",
		stats.settles === LEVELS + 1, `settles=${stats.settles} streams=${LEVELS + 1}`);
}


// =================================================================
// Summary
// =================================================================

console.log(`\n${"=".repeat(60)}`);
console.log(`${passed} passed, ${failed} failed`);
console.log(`${"=".repeat(60)}`);
console.log(`
NOT COVERED by this run — reading-level only:
  - PushStream~<* in full. Needs a do-scope stand-in with one-shot
    ret to exercise tail extraction from the Bind arm, per-emission
    ret(msg.value), Left@ discrimination in the Map arm, and the
    'finished' reentrancy guard. Reusable across every ~<< / ~<*
    hook if built; T1-T12 use a plain leaf sink instead.
  - Idempotent subscription (§6.10 opener) — deferred in the sketch.
  - ~<'s inner-close refcounting — unchanged gap from pre-conversion.
  - The §3.4 axis. V8 has no PTC, so nothing here distinguishes a
    tail call from a non-tail one. Irrelevant for PushStream (breadth
    is a loop either way), but stated so it isn't mistaken for
    coverage.
`);
