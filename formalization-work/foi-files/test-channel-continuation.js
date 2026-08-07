// ============================================================
// Channel trampoline conversion — JS model + smoke test
//
// Models the converted Channel against a naive control, plus a
// legacy-reentrancy control for the slot-write-ordering fix.
// Promise is modeled per the converted sketch (fanOut pairs,
// PromiseSubject% as the drive point).
//
// Do-scope stand-in: the `~<*` body is a leaf sink (a plain JS
// function called per emission). Bind/Map arm extraction is
// unchanged by the conversion and is not under test here.
// ============================================================

const CONT = Symbol("ContinuationTrampoline");
const RIGHT = "Right";
const LEFT = "Left";
const CLOSED = "Channel Closed";

var metrics = null;

function resetMetrics() {
	metrics = {
		pushes: 0,        // total resumes pushed onto the LIFO stack
		peak: 0,          // peak heap-resident pending resumes
		bounces: 0,       // total bounce-loop entries
		peakNesting: 0,   // peak *nested* bounces (native depth proxy)
		nesting: 0,
	};
	return metrics;
}


// ------------------------------------------------------------
// ContinuationTrampoline (spec §6.14.1–§6.14.3)
// ------------------------------------------------------------

function contPair(thunk, resume) {
	return { [CONT]: true, thunk, resume };
}

function isCont(v) {
	return v != null && v[CONT] === true;
}

function bounce(inst) {
	var stack = null;      // cons cell { head, tail } — never a sliced array
	var depth = 0;
	var current = inst;

	metrics.bounces++;
	metrics.nesting++;
	if (metrics.nesting > metrics.peakNesting) metrics.peakNesting = metrics.nesting;

	while (true) {
		if (isCont(current)) {
			let pair = current;
			if (pair.resume != null) {
				stack = { head: pair.resume, tail: stack };
				depth++;
				metrics.pushes++;
				if (depth > metrics.peak) metrics.peak = depth;
			}
			current = pair.thunk();
		}
		else if (stack !== null) {
			let resume = stack.head;
			stack = stack.tail;
			depth--;
			current = resume(current);
		}
		else break;
	}

	metrics.nesting--;
	return current;
}

function contRamp(v) {
	return isCont(v) ? bounce(v) : v;
}


// ------------------------------------------------------------
// Either
// ------------------------------------------------------------

function Right(v) { return { tag: RIGHT, value: v }; }
function Left(v) { return { tag: LEFT, value: v }; }

function eitherCata(ev, leftFn, rightFn) {
	return ev.tag === LEFT ? leftFn(ev.value) : rightFn(ev.value);
}


// ------------------------------------------------------------
// Promise (converted)
// ------------------------------------------------------------

var promiseSlots = new Map();
var subjSlots = new Map();
var nextId = 1;

function promiseFactory() {
	var pr = {};
	promiseSlots.set(pr, { id: nextId++, resolved: false, either: null, deferred: [] });

	function resolve(either) {
		var state = promiseSlots.get(pr);
		if (state.resolved) return undefined;
		promiseSlots.set(pr, { ...state, resolved: true, either, deferred: [] });
		return fanOut(state.deferred, 0, either);
	}

	return { pr, resolve };
}

// Right-nested trampoline over the subscriber list. By index —
// slicing would make an N-subscriber fan-out O(N^2).
function fanOut(cbs, i, either) {
	if (i >= cbs.length) return undefined;
	return contPair(
		function () { return cbs[i](either); },
		function (prior) { return fanOut(cbs, i + 1, either); }
	);
}

function promiseSubject() {
	var made = promiseFactory();
	var subj = { pr: made.pr };
	subjSlots.set(subj, made.resolve);
	return subj;
}

// PromiseSubject% — the one drive point on the Promise side.
function subjEffector(subj, either) {
	var resolve = subjSlots.get(subj);
	contRamp(resolve(either));
	return either;
}

function promiseHonor(v) {
	var made = promiseFactory();
	made.resolve(Right(v));
	return made.pr;
}

function promiseRenege(reason) {
	var made = promiseFactory();
	made.resolve(Left(reason));
	return made.pr;
}

// NOTE arg order: leftFn second, rightFn third.
function promiseCata(inst, leftFn, rightFn) {
	var state = promiseSlots.get(inst);
	if (state.resolved) {
		return promiseHonor(eitherCata(state.either, leftFn, rightFn));
	}
	var made = promiseFactory();
	let cb = function (either) {
		// The interposition: the arm's return is wrapped and consumed
		// as a resolution value. A pair returned here would NOT bounce.
		return made.resolve(Right(eitherCata(either, leftFn, rightFn)));
	};
	promiseSlots.set(inst, { ...state, deferred: [...state.deferred, cb] });
	return made.pr;
}

function settled(pr) {
	var state = promiseSlots.get(pr);
	return state.resolved ? state.either : null;
}


// ------------------------------------------------------------
// Channel
//   opts.legacyReentrancy — resolve-before-write (the pre-fix bug),
//   used as a control to prove the re-entrancy test bites.
// ------------------------------------------------------------

var channelSlots = new Map();

function makeChannel(cap, opts) {
	var options = opts || {};
	var legacy = options.legacyReentrancy === true;
	var inst = {};

	channelSlots.set(inst, {
		id: nextId++,
		closed: false,
		capacity: cap || 0,
		buffer: [],
		putQueue: [],
		takeQueue: [],
		peekWaiters: [],
	});

	inst.put = putFn;
	inst.take = takeFn;
	inst.peek = peekFn;
	inst.close = closeFn;
	return inst;

	// ***********************

	function putFn(v) {
		var state = channelSlots.get(inst);

		if (state.closed) return promiseRenege(CLOSED);

		if (state.takeQueue.length > 0) {
			let takeSubj = state.takeQueue[0];
			channelSlots.set(inst, { ...state, takeQueue: state.takeQueue.slice(1) });
			subjEffector(takeSubj, Right(v));
			drainPeeks(v);
			return promiseHonor(true);
		}

		if (state.buffer.length < state.capacity) {
			channelSlots.set(inst, { ...state, buffer: [...state.buffer, v] });
			drainPeeks(v);
			return promiseHonor(true);
		}

		let subj = promiseSubject();
		channelSlots.set(inst, {
			...state,
			putQueue: [...state.putQueue, { subj, value: v }],
		});
		drainPeeks(v);
		return subj.pr;
	}

	function takeFn() {
		var state = channelSlots.get(inst);

		if (state.buffer.length > 0) {
			let headV = state.buffer[0];
			let restBuf = state.buffer.slice(1);

			if (state.putQueue.length > 0) {
				let putEntry = state.putQueue[0];
				let newState = {
					...state,
					buffer: [...restBuf, putEntry.value],
					putQueue: state.putQueue.slice(1),
				};
				if (legacy) {
					// pre-fix: resolve first, then clobber with a state
					// derived from the entry snapshot
					subjEffector(putEntry.subj, Right(true));
					channelSlots.set(inst, newState);
				}
				else {
					channelSlots.set(inst, newState);
					subjEffector(putEntry.subj, Right(true));
				}
			}
			else {
				channelSlots.set(inst, { ...state, buffer: restBuf });
			}
			return promiseHonor(headV);
		}

		if (state.putQueue.length > 0) {
			let putEntry = state.putQueue[0];
			channelSlots.set(inst, { ...state, putQueue: state.putQueue.slice(1) });
			subjEffector(putEntry.subj, Right(true));
			return promiseHonor(putEntry.value);
		}

		if (state.closed) return promiseRenege(CLOSED);

		let subj = promiseSubject();
		channelSlots.set(inst, { ...state, takeQueue: [...state.takeQueue, subj] });
		return subj.pr;
	}

	function peekFn() {
		var state = channelSlots.get(inst);

		if (state.buffer.length > 0) return promiseHonor(state.buffer[0]);
		if (state.putQueue.length > 0) return promiseHonor(state.putQueue[0].value);
		if (state.closed) return promiseRenege(CLOSED);

		let subj = promiseSubject();
		channelSlots.set(inst, { ...state, peekWaiters: [...state.peekWaiters, subj] });
		return subj.pr;
	}

	function closeFn() {
		var state = channelSlots.get(inst);
		if (state.closed) return Left(CLOSED);

		channelSlots.set(inst, {
			...state, closed: true, putQueue: [], takeQueue: [], peekWaiters: [],
		});

		for (let entry of state.putQueue) subjEffector(entry.subj, Left(CLOSED));
		for (let subj of state.takeQueue) subjEffector(subj, Left(CLOSED));
		if (state.buffer.length === 0) {
			for (let subj of state.peekWaiters) subjEffector(subj, Left(CLOSED));
		}
		return Right(true);
	}

	function drainPeeks(v) {
		var state = channelSlots.get(inst);
		var waiters = state.peekWaiters;
		if (legacy) {
			for (let subj of waiters) subjEffector(subj, Right(v));
			channelSlots.set(inst, { ...channelSlots.get(inst), peekWaiters: [] });
		}
		else {
			channelSlots.set(inst, { ...state, peekWaiters: [] });
			for (let subj of waiters) subjEffector(subj, Right(v));
		}
	}
}

function chState(ch) { return channelSlots.get(ch); }

// Depth-test seeding: fill the buffer directly. Bypasses put's
// coordination on purpose — put's own path is covered by T0/T1.
function seedBuffer(ch, values) {
	var state = channelSlots.get(ch);
	channelSlots.set(ch, { ...state, capacity: values.length, buffer: values.slice() });
}


// ------------------------------------------------------------
// Channel ~<* — the loop under test.
//   converted === false is the naive control (native recursion).
// ------------------------------------------------------------

function channelLoop(ch, bodyFn, converted) {
	var loopResult = promiseSubject();

	if (converted) contRamp(stepIteration());
	else stepNaive();

	return loopResult.pr;

	// ***********************

	function stepIteration() {
		return contPair(takeOnce);        // one-argument form: no push
	}

	function takeOnce() {
		var inline = true;
		var next;
		promiseCata(ch.take(), closeArm, valueArm);
		inline = false;
		return next;

		function valueArm(v) {
			bodyFn(v);
			if (inline) {
				next = stepIteration();
				return next;
			}
			return contRamp(stepIteration());
		}

		function closeArm(reason) {
			return subjEffector(loopResult, Left(reason));
		}
	}

	function stepNaive() {
		promiseCata(ch.take(), closeArmN, valueArmN);

		function valueArmN(v) {
			bodyFn(v);
			return stepNaive();
		}
		function closeArmN(reason) {
			return subjEffector(loopResult, Left(reason));
		}
	}
}


// ------------------------------------------------------------
// Runner
// ------------------------------------------------------------

var passed = 0;
var failed = 0;

function check(label, cond, detail) {
	if (cond) {
		passed++;
		console.log(`  PASS  ${label}${detail ? "  — " + detail : ""}`);
	}
	else {
		failed++;
		console.log(`  FAIL  ${label}${detail ? "  — " + detail : ""}`);
	}
}

function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function overflows(fn) {
	try { fn(); return false; }
	catch (err) { return err instanceof RangeError; }
}


// -- T0: coordination basics -------------------------------------

function T0() {
	console.log("\nT0  put/take coordination");
	resetMetrics();

	let ch = makeChannel(0);
	let pA = ch.put("a");
	check("isolated put stays pending", settled(pA) === null);

	let tA = ch.take();
	check("take resolves with the put value", eq(settled(tA), Right("a")));
	check("put resolves once taken", eq(settled(pA), Right(true)));

	let ch2 = makeChannel(0);
	ch2.put(1); ch2.put(2); ch2.put(3);
	let got = [settled(ch2.take()).value, settled(ch2.take()).value, settled(ch2.take()).value];
	check("queued puts drain FIFO", eq(got, [1, 2, 3]));

	let ch3 = makeChannel(3);
	let p1 = ch3.put(1), p2 = ch3.put(2), p3 = ch3.put(3), p4 = ch3.put(4);
	check("buffered puts resolve immediately",
		settled(p1) && settled(p2) && settled(p3));
	check("put past capacity stays pending", settled(p4) === null);
	check("take frees capacity and resolves the queued put",
		eq(settled(ch3.take()), Right(1)) && eq(settled(p4), Right(true)));
}


// -- T1: the `inline` flag across settled/pending ---------------

function T1() {
	console.log("\nT1  inline flag across the settled/pending transition");
	resetMetrics();

	let ch = makeChannel(3);
	ch.put(1); ch.put(2); ch.put(3);

	let seen = [];
	let done = channelLoop(ch, function (v) { seen.push(v); }, true);

	check("settled prefix consumed on the inline path", eq(seen, [1, 2, 3]));
	check("loop parked after draining", chState(ch).takeQueue.length === 1);

	ch.put(4);
	check("resumes across the transition", eq(seen, [1, 2, 3, 4]));

	ch.put(5);
	check("keeps running on the pending path", eq(seen, [1, 2, 3, 4, 5]));
	check("still parked, not spinning", chState(ch).takeQueue.length === 1);

	ch.close();
	check("close terminates the loop", eq(settled(done), Left(CLOSED)));
}


// -- T2: settled-path depth, with the overflow control -----------

function T2() {
	console.log("\nT2  settled-path depth");

	const CONVERTED_N = 10000;
	const CONTROL_N = 6000;

	resetMetrics();
	let ch = makeChannel(0);
	seedBuffer(ch, Array.from({ length: CONVERTED_N }, function (_, i) { return i; }));
	let count = 0;
	let blew = overflows(function () {
		channelLoop(ch, function () { count++; }, true);
	});
	check(`converted survives ${CONVERTED_N} settled takes`, !blew && count === CONVERTED_N,
		`consumed=${count}`);
	check("one-argument form pushes nothing", metrics.peak === 0,
		`peak=${metrics.peak} pushes=${metrics.pushes}`);

	resetMetrics();
	let ctl = makeChannel(0);
	seedBuffer(ctl, Array.from({ length: CONTROL_N }, function (_, i) { return i; }));
	let ctlBlew = overflows(function () {
		channelLoop(ctl, function () {}, false);
	});
	check(`CONTROL: naive overflows at ${CONTROL_N}`, ctlBlew);
}


// -- T3: re-entrancy, with the legacy control -------------------

function T3() {
	console.log("\nT3  producer resumed inside take, re-enters with a put");

	function run(legacy) {
		resetMetrics();
		let ch = makeChannel(1, { legacyReentrancy: legacy });
		ch.put("a");                       // buffered
		let pB = ch.put("b");              // queued (buffer full)
		promiseCata(pB, function () {}, function () { ch.put("c"); });
		ch.take();                         // arm 1: buffer + putQueue
		let st = chState(ch);
		return { buffer: st.buffer, queued: st.putQueue.map(function (e) { return e.value; }) };
	}

	let safe = run(false);
	check("re-entrant put survives", eq(safe.buffer, ["b"]) && eq(safe.queued, ["c"]),
		`buffer=${JSON.stringify(safe.buffer)} putQueue=${JSON.stringify(safe.queued)}`);

	let old = run(true);
	check("CONTROL: legacy ordering loses it", !eq(old.queued, ["c"]),
		`putQueue=${JSON.stringify(old.queued)}`);
}


// -- T4: the guide's unbuffered peek sequence -------------------

function T4() {
	console.log("\nT4  unbuffered peek (guide §Channel)");
	resetMetrics();

	let ch = makeChannel(0);
	let seen = [];
	for (let i = 0; i < 3; i++) {
		promiseCata(ch.peek(), function () {}, function (v) { seen.push(v); });
	}
	check("peeks park on an empty channel", chState(ch).peekWaiters.length === 3);

	let pr = ch.put(42);
	check("put stays pending (unbuffered)", settled(pr) === null);
	check("every pending peek fires", eq(seen, [42, 42, 42]));

	let later = ch.peek();
	check("peek after a queued put settles", eq(settled(later), Right(42)));

	check("take still consumes it", eq(settled(ch.take()), Right(42)));
	check("peek parks again once drained", settled(ch.peek()) === null);
}


// -- T5: relay chain — depth is composition-bounded --------------

function T5() {
	console.log("\nT5  relay chain nesting");

	function relay(chainLen, items) {
		resetMetrics();
		let chans = Array.from({ length: chainLen }, function () { return makeChannel(0); });
		let tail = [];

		for (let i = 0; i < chainLen - 1; i++) {
			let next = chans[i + 1];
			channelLoop(chans[i], function (v) { next.put(v); }, true);
		}
		channelLoop(chans[chainLen - 1], function (v) { tail.push(v); }, true);

		for (let i = 0; i < items; i++) chans[0].put(i);
		return { tail, nesting: metrics.peakNesting };
	}

	let a = relay(4, 10);
	let b = relay(4, 400);
	let c = relay(12, 10);

	check("relay delivers through the chain", a.tail.length === 10 && b.tail.length === 400);
	check("nesting flat in item count", a.nesting === b.nesting,
		`items=10 → ${a.nesting}, items=400 → ${b.nesting}`);
	check("nesting grows with chain length", c.nesting > a.nesting,
		`len=4 → ${a.nesting}, len=12 → ${c.nesting}`);
}


// -- T6: close ---------------------------------------------------

function T6() {
	console.log("\nT6  close");
	resetMetrics();

	// Separate channels: a queued put makes peek settle immediately
	// (T4), so a pending peek needs a channel with nothing queued.
	let chPut = makeChannel(0);
	let pPut = chPut.put("x");

	let chPeek = makeChannel(0);
	let pk = chPeek.peek();

	let chTake = makeChannel(0);
	let tk = chTake.take();

	check("close returns Right first time", eq(chPut.close(), Right(true)));
	check("close is one-shot", eq(chPut.close(), Left(CLOSED)));
	check("pending put gets Left", eq(settled(pPut), Left(CLOSED)));

	chPeek.close();
	check("pending peek gets Left", eq(settled(pk), Left(CLOSED)));

	chTake.close();
	check("pending take gets Left", eq(settled(tk), Left(CLOSED)));

	check("post-close put reneges", eq(settled(chPut.put(1)), Left(CLOSED)));
	check("post-close take reneges", eq(settled(chPut.take()), Left(CLOSED)));
	check("post-close peek reneges", eq(settled(chPut.peek()), Left(CLOSED)));
}


// ------------------------------------------------------------

console.log("Channel trampoline conversion — smoke test");
T0(); T1(); T2(); T3(); T4(); T5(); T6();
console.log(`\n${passed} passed, ${failed} failed`);
