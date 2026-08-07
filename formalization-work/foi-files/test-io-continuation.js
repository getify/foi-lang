// ============================================================
// IO × ContinuationTrampoline — standalone smoke test
//
// IO's Foi source doesn't transpile as-is, so this models the
// machinery directly: slot storage, the §6.14 bounce, contRamp,
// and the IO hooks the conversion touches (IO@, IO%, IO~<,
// IO.using@).
//
// A naive (unconverted) bind runs alongside as a reference, so
// the conversion can be checked against pre-conversion behavior
// rather than against my expectations of it.
//
// OUT OF SCOPE: the Promise arm of processIOStep, IO~map, the
// sub-context helpers. Those stay reading-level checks.
// ============================================================

const CONT_NS = "ContinuationTrampoline";
const IO_NS = "IO";

var slots = new Map();
var warnings = [];
var nextId = 1;

function slotRead(inst) {
	return slots.get(inst);
}

function slotWrite(inst, val) {
	slots.set(inst, val);
}

function warn(msg) {
	warnings.push(msg);
}


// ============================================================
// ContinuationTrampoline (spec §6.14.1, §6.14.2)
//
// Slot is the positional 2-tuple; a 1-element pair is the tail
// form (no pending resume). `undefined` stands in for `empty`.
// ============================================================

function contTrampoline(pair) {
	var inst = { __ns: CONT_NS };
	slotWrite(inst, pair);
	return inst;
}

function contBounce(inst) {
	var stack = null;
	var current = inst;
	var maxDepth = 0;
	while (true) {
		if (current != null && current.__ns === CONT_NS) {
			let [ left, right ] = slotRead(current);
			if (right !== undefined) {
				stack = [ right, stack ];
				maxDepth++;
			}
			current = left();
		}
		else if (stack !== null) {
			let [ resume, rest ] = stack;
			stack = rest;
			current = resume(current);
		}
		else break;
	}
	contBounce.lastMaxDepth = maxDepth;
	return current;
}

function contRamp(v) {
	return (v != null && v.__ns === CONT_NS) ? contBounce(v) : v;
}


// ============================================================
// IO — constructor, effector, using
// ============================================================

function IO(executor) {
	var inst = { __ns: IO_NS };
	slotWrite(inst, { id: nextId++, executor });
	return inst;
}

// IO% — sole drive point
function ioRun(inst, env) {
	var state = slotRead(inst);
	if ("usingRelease" in state) {
		warn("IO.using@ leak: no bind to release");
	}
	return contRamp(state.executor(env));
}

// IO% without the drive, for the naive reference world
function ioRunNaive(inst, env) {
	var state = slotRead(inst);
	if ("usingRelease" in state) {
		warn("IO.using@ leak: no bind to release");
	}
	return state.executor(env);
}

// IO.using@ — shared by both worlds. The acquire is a plain IO in
// every test here, so contRamp is identity on it and the two
// worlds see the same acquire behavior.
function ioUsing(acquire, release) {
	var io = IO(env => ioRun(acquire, env));
	var ioSlot = slotRead(io);
	slotWrite(io, { ...ioSlot, usingRelease: release });
	return io;
}


// ============================================================
// IO~< — converted. Release rides as the resume, so it cannot
// fire until the bounce has driven the downstream work to a
// real value.
// ============================================================

function ioBind(inst, fn) {
	var ioSlot = slotRead(inst);

	return IO(env => contTrampoline([
		() => ioSlot.executor(env),
		res => processIOStep(res, env)
	]));

	function processIOStep(res, env) {
		var next = fn(res);
		var nextState = slotRead(next);
		var step = () => nextState.executor(env);

		return ("usingRelease" in ioSlot)
			? contTrampoline([ step, releaseAfter ])
			: contTrampoline([ step ]);

		function releaseAfter(res2) {
			ioRun(ioSlot.usingRelease(res), env);
			return res2;
		}
	}
}

// IO~< — pre-conversion shape, straight-line release
function ioBindNaive(inst, fn) {
	var ioSlot = slotRead(inst);

	return IO(env => {
		let res = ioSlot.executor(env);
		let next = fn(res);
		let nextState = slotRead(next);
		let res2 = nextState.executor(env);
		if ("usingRelease" in ioSlot) {
			ioRunNaive(ioSlot.usingRelease(res), env);
		}
		return res2;
	});
}


// ============================================================
// Test programs
// ============================================================

// Mirrors §6.12.6's nested-using example:
//   def src::  withFile("a");
//   def dest:: withFile("b");
//   def data:: readAll(src);
//   $writeAll(dest, data);
function buildNestedUsing(bind, log) {
	function withFile(name) {
		return ioUsing(
			IO(() => {
				log(`${name} opened`);
				return { name };
			}),
			fh => IO(() => {
				log(`${fh.name} closed`);
			})
		);
	}

	function readAll(fh) {
		return IO(() => {
			log(`read ${fh.name}`);
			return `<contents of ${fh.name}>`;
		});
	}

	function writeAll(fh, data) {
		return IO(() => {
			log(`write ${fh.name}: ${data}`);
			return "written";
		});
	}

	return bind(withFile("a"), src =>
		bind(withFile("b"), dest =>
			bind(readAll(src), data =>
				writeAll(dest, data))));
}

function buildDeepChain(bind, n) {
	var io = IO(() => 0);
	for (let i = 0; i < n; i++) {
		io = bind(io, v => IO(() => v + 1));
	}
	return io;
}


// ============================================================
// Harness
// ============================================================

var failures = 0;

function check(label, actual, expected) {
	var ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (!ok) failures++;
	console.log(`${ok ? "  ok  " : " FAIL "} ${label}`);
	if (!ok) {
		console.log(`         expected: ${JSON.stringify(expected)}`);
		console.log(`         actual:   ${JSON.stringify(actual)}`);
	}
}

function reset() {
	warnings = [];
}


// -- 1. Nested using: order, and release strictly after the work --

reset();
var convertedLog = [];
var convertedResult = ioRun(
	buildNestedUsing(ioBind, m => convertedLog.push(m))
);

check("nested using: release order", convertedLog, [
	"a opened",
	"b opened",
	"read a",
	"write b: <contents of a>",
	"b closed",
	"a closed",
]);

check("nested using: result passes through", convertedResult, "written");

check(
	"nested using: b closes after the write (release is not early)",
	convertedLog.indexOf("b closed") > convertedLog.indexOf("write b: <contents of a>"),
	true
);

check(
	"nested using: innermost releases first",
	convertedLog.indexOf("b closed") < convertedLog.indexOf("a closed"),
	true
);


// -- 2. No spurious leak warnings during ordinary composition --

check("nested using: no leak warnings", warnings, []);


// -- 3. Converted matches the pre-conversion reference exactly --

reset();
var naiveLog = [];
var naiveResult = ioRunNaive(
	buildNestedUsing(ioBindNaive, m => naiveLog.push(m))
);

check("converted log === naive log", convertedLog, naiveLog);
check("converted result === naive result", convertedResult, naiveResult);
check("naive: no leak warnings either", warnings, []);


// -- 4. Leak diagnosis still fires when it should --

reset();
ioRun(ioUsing(IO(() => "res"), () => IO(() => {})));
check("unbound using-IO warns", warnings.length, 1);


// -- 5. Stack depth --

const DEEP_N = 100000;

reset();
var deepOk = true;
var deepResult = null;
try {
	deepResult = ioRun(buildDeepChain(ioBind, DEEP_N));
}
catch (err) {
	deepOk = false;
	console.log(`         converted threw: ${err.constructor.name}`);
}

check(`converted survives ${DEEP_N}-step chain`, deepOk, true);
check(`converted ${DEEP_N}-step result`, deepResult, DEEP_N);
console.log(`         heap stack peaked at ${contBounce.lastMaxDepth} pending resumes`);

var naiveOverflowed = false;
try {
	ioRunNaive(buildDeepChain(ioBindNaive, DEEP_N));
}
catch (err) {
	naiveOverflowed = (err instanceof RangeError);
}

check(
	`naive overflows at ${DEEP_N} (control — proves the test bites)`,
	naiveOverflowed,
	true
);


console.log(failures === 0 ? "\nall green" : `\n${failures} failure(s)`);
