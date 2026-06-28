// test-parser.js — exercises parseFoi against a corpus of source samples.
//
// Two lanes:
//   - passSamples: expected to fully parse without throwing.
//   - failSamples: expected to throw a SyntaxError whose message starts
//                  with "Foi parse failed:" (the shape parseFoi emits
//                  when result.ok === false). The strict shape check
//                  distinguishes "parser correctly rejected" from
//                  "an unrelated bug threw something else".
//
// Negative-lane outcomes per sample:
//   - threw with right shape       → negative-passed
//   - did not throw                → unexpected success (regression)
//   - threw, but not our SyntaxError shape → unexpected error type

import util from "node:util";
import { parseFoi } from "./parser.js";
import { samples } from "./samples.js";


var passSamples = [
	...samples.map(sample => sample.src),

	`export {
	  :playlist, :clear, :play, :resume, :pause, :stop,
	  :onPlay, :onTimeUpdate, :onPause, :onStop,
	};

	def queue: <>;
	def player: Audio();

	defn onPlayNext(url) ^<>;
	defn next() ^playlist(queue, false, false, onPlayNext);
	defn nextLoop() ^playlist(queue, false, true, onPlayNext);

	defn playlist(
	    urls,
	    clear: false,
	    loop: false,
	    onNext: onPlayNext
	  )
	  :over(queue,onPlayNext)
	{
	  def cb: next;
	  ?[loop]: cb := nextLoop;

	  onPlayNext := onNext;
	  ?[clear]: queue := < &urls >;

	  ?{
	    ?[size(queue) ?= 0]: {
	      def upcoming: queue.[1..];
	      ?[loop]: queue := < &queue, upcoming >;

	      player.src(upcoming);
	      player.removeEventListener("ended", cb);
	      player.addEventListener("ended", cb);
	      player.play();
	      ?[size(queue) ?> 0]: onNext(upcoming)
	    };
	    ?:
	      player.removeEventListener("ended", cb)
	  }
	};

	defn clear() :over(queue) {
	  queue := <>;
	  player.removeEventListener("ended", next)
	};

	defn play(url) {
	  stop();
	  player.src(url);
	  player.play()
	};

	defn resume() ^player.play();

	defn pause() ^player.pause();

	defn stop() {
	  player.pause();
	  player.currentTime(0);
	  clear()
	};

	defn onPlay(action) {
	  defn cb() ^action(player.src);
	  player.addEventListener("play", cb);
	  ^defn() ^player.removeEventListener("play", cb)
	};

	defn onTimeUpdate(action) {
	  defn cb() ^action(player.src, player.currentTime);
	  player.addEventListener("timeupdate", cb);
	  ^defn() ^player.removeEventListener("timeupdate", cb)
	};

	defn onPause(action) {
	  defn cb() ^action(player.src);
	  player.addEventListener("pause", cb);
	  ^defn() ^player.removeEventListener("pause", cb)
	};

	defn onStop(action) {
	  defn cb() ^action(player.src);
	  player.addEventListener("ended", cb);
	  ^defn() ^player.removeEventListener("ended", cb)
	};`,
];


// Expected-fail samples — nail down the `:as` precedence rule.
// Each MUST throw a SyntaxError whose message begins with "Foi parse
// failed:". See the ":as Precedence — First-Class Rule" section of
// Syntactic-Grammar.md.
var failSamples = [
	"x + y :as int;",       // binary cannot carry :as directly
	"1..5 :as List;",       // range cannot carry :as directly
	"x..y :as int;",        // same range family
	"1..;",                 // open-ended ranges have no value semantic outside .[ ]
	"..5;",                 // same — TrailingRangeExpr at expression position
	"(1..) :as List;",      // paren-and-annotate also rejected — inner LeadingRangeExpr can't reach BinaryAtom
	"(..5) :as List;",      // same — inner TrailingRangeExpr
	"x :as int + y;",       // outer AsExpr matches `x :as int`; `+ y` dangling
	"x :as int :as bool;",  // no chained :as without parens; AsableExpr excludes AsExpr
	"(x) :as bool :as char;",         // chained :as on paren — paren-grouping not in AsableExpr, outer :as has nowhere to land
	"(x :as int) :as bool :as char;", // same — inner :as is fine, outer chain rejected
	"(x) :as bool :as char :as float;", // already rejected at the 3rd :as pre-fix; locks it as test
	"def (<:a>) { a };",
	"f +> (<:a>) { a; };",
	"(x: 1) { x; };",          // standalone (defs){body} rejected
	"(x: 1) { x; } :as int;",  // same — BlockExpr not in <AsableExpr> anyway
	"(x, y) { x; };",          // same
	"(x: 1, y) { x; };",       // same
	"10 + x := 5;",
	// Dynamic-pick boundaries — confirm grammar narrowness.
	//
	// `&`-in-pick admits PickValue's source alphabet exactly:
	// IdentBase + optional MultiAccessExpr. Call suffixes not
	// admitted (Q4=B); inline calls require pre-binding.
	"foo.<&Object.keys(rec)>;",

	// `%`-in-pick (and `%`-in-ExplicitPropDef) — narrowed
	// ComputedPropName alphabet per the §17 grammar rewrite.
	// Bare arm: BooleanLit | StringLit | <ComputedPropNumberLit> |
	// ComputedPropAccessChain. Paren-wrap arm: OperandExpr inner,
	// no `:as` tail, no AssignmentExpr / DefFuncExpr / MatchExpr /
	// BareBlockExpr inner.
	//
	// `%5` is now valid (bare positive integer) — moved to
	// positive samples. The shapes below cover the rejected
	// edges.

	// Bare-arm: call/at/postfix/pick/range chain segs all rejected
	// — paren-wrap rewrite required.
	"<%Maybe@42: 5>;",      // at-call (moved from positives — paren-wrap: %(Maybe@42))
	"<%None@: 5>;",         // bare None@ (moved from positives — paren-wrap: %(None@))
	"rec.<%Maybe@42>;",     // at-call in pick (moved from positives — paren-wrap: %(Maybe@42))
	"<%foo(x): 1>;",        // call suffix — paren-wrap: %(foo(x))
	"<%foo|x|: 1>;",        // partial-call — paren-wrap: %(foo|x|)
	"<%foo@x: 1>;",         // at-call with arg — paren-wrap: %(foo@x)
	"<%foo@: 1>;",          // bare AtExpr — paren-wrap: %(foo@)
	"<%@: 1>;",             // bare IdentityFunc — paren-wrap: %(@)
	"<%foo': 1>;",          // postfix primed — paren-wrap: %(foo')
	"<%foo.<a, b>: 1>;",    // DotAngle (pick) chain seg — paren-wrap: %(foo.<a, b>)
	"<%foo.[1..3]: 1>;",    // DotBracket (range) chain seg — paren-wrap: %(foo.[1..3])

	// Bare-arm: DataStructLit rejected even at bare top level —
	// the `:` inside `<x: 1>` collides visually with the outer
	// ExplicitPropDef separator. Paren-wrap admits.
	"<%<x: 1>: 1>;",        // bare DataStructLit — paren-wrap: %(<x: 1>)

	// Bare-arm: numeric-literal alphabet narrowed — admits every
	// NumberLit shape except monadic and unicode escapes.
	"<%\\@FF: 1>;",         // monadic escape — out of scope
	"<%\\u263A: 1>;",       // unicode escape — char-shaped, not numeric

	// Bare-arm: EmptyLit rejected (no storage slot for missing value)
	"<%empty: 1>;",

	// Paren-wrap arm: no outer `:as` tail (collides with outer Colon)
	"<%(x) :as int: 1>;",

	// Paren-wrap arm: no AsExpr inside (not in OperandExpr)
	"<%(x :as int): 1>;",

	// Paren-wrap arm: no AssignmentExpr (not in OperandExpr)
	"<%(x := 5): 1>;",

	// Paren-wrap arm: no DefFuncExpr / MatchExpr / BareBlockExpr
	// (none reachable from OperandExpr)
	"<%(defn(x)^x): 1>;",
	"<%(?{?[c]: 1; ?: 0}): 1>;",
	"<%({y; }): 1>;",
	// Mountain (`/\`) / Valley (`\/`) postfix boundaries.
	//
	// Locked rules from the curry/uncurry batch:
	//   - postfix terminates access chain (no dot/bracket after)
	//   - no trivia between function and the postfix modifier
	//   - no trivia between modifier and first CallSuffix
	//   - mutually exclusive with `'` and with each other (no stacking)
	"foo/\\.bar;",     // postfix terminates access chain (curry)
	"foo\\/.bar;",     // postfix terminates access chain (uncurry)
	"foo /\\;",        // adjacency violated — trivia before /\
	"foo \\/;",        // adjacency violated — trivia before \/
	"foo/\\ (1);",     // adjacency violated — trivia between /\ and (
	"foo\\/ (1);",     // adjacency violated — trivia between \/ and (
	"foo/\\';",        // postfix stacking — /\ then ' (locked C)
	"foo\\/';",        // postfix stacking — \/ then ' (locked C)
	"foo/\\\\/;",      // postfix stacking — /\ then \/
	"foo\\//\\;",      // postfix stacking — \/ then /\
	// Narrowed \u<hex> — character escape admitted only as the sole
	// contents of an InterpExpr slot. See parser.js InterpExpr /
	// UnicodeCharLit and Syntactic-Grammar.md §2.
	"\\u263A;",                       // \u at value position — rejected
	"def x: \\u263A;",                // same — RHS of def
	"f(\\u263A);",                    // same — call argument
	"\\u263A + 1;",                   // same — binary operand
	'`"`\\u263A + 1`";',              // escape + binary op
	'`"`\\u263A.foo`";',              // escape + chain access
	'`"`1 + \\u263A`";',              // expression then escape
	'`"`\\u263A \\u263A`";',          // two escapes in one slot
	'\\`"`\\u263A + 1`";',              // escape + binary op
	'\\`"`\\u263A.foo`";',              // escape + chain access
	'\\`"`1 + \\u263A`";',              // expression then escape
	'\\`"`\\u263A \\u263A`";',          // two escapes in one slot

	'def x: (tmp: 3) { tmp + 1; };',
	'5 + (tmp: 3) { tmp + 1; };',
	'?{ ?[x ?< 5]: (<:a>) { use(a); }; ?: 0 };',
	'?[x ?> y]: (<:a>) { use(a); };',

	// === EffectorCallExpr negatives — `%` chain-tail rejects ===

	// No LHS — `%` requires a source
	"%task;",
	"%;",
	"%(x);",

	// No stacking with PostfixCallTail modifiers — `%` is a chain terminator
	"task%';",
	"task%/\\;",
	"task%\\/;",

	// No access tail after `%` — paren the effector first
	"task%.field;",
	"task%[0];",
	"task%.<a,b>;",
	"task%.[1..3];",

	// narrowing of special-cased `@` call-operator form
	"@;",
	"@ :as Maybe;",
	"@|42|;"
];

var passed = 0;
var unexpectedFails = [];

for (let i = 0; i < passSamples.length; i++) {
	try {
		for await (let tree of parseFoi(passSamples[i],{
			// preserveSoftDelims: true,
		})) {
			// console.log(util.inspect(tree,{depth:50}));
		}
		passed++;
	}
	catch (err) {
		unexpectedFails.push({ idx: i, src: passSamples[i], err: err.message });
	}
}

var negativePassed = 0;
var unexpectedPasses = [];
var unexpectedErrors = [];

for (let i = 0; i < failSamples.length; i++) {
	let threw = null;
	try {
		for await (let tree of parseFoi(failSamples[i],{})) {
			// drain — we only care whether the iteration throws at end
		}
	}
	catch (err) {
		threw = err;
	}
	if (threw === null) {
		unexpectedPasses.push({ idx: i, src: failSamples[i] });
	}
	else if (
		threw instanceof SyntaxError &&
		threw.message.startsWith("Foi parse failed:")
	) {
		negativePassed++;
	}
	else {
		unexpectedErrors.push({ idx: i, src: failSamples[i], err: threw });
	}
}

console.log(`${passed}/${passSamples.length} passed`);
console.log(`${negativePassed}/${failSamples.length} negative-passed`);

for (let f of unexpectedFails) {
	let preview = f.src.length > 80 ? f.src.slice(0, 77) + "..." : f.src;
	console.log(`\n[pos ${f.idx}] ${f.err}`);
	console.log(`      ${preview}`);
}

for (let f of unexpectedPasses) {
	let preview = f.src.length > 80 ? f.src.slice(0, 77) + "..." : f.src;
	console.log(`\n[neg ${f.idx}] unexpected success (expected parse error)`);
	console.log(`      ${preview}`);
}

for (let f of unexpectedErrors) {
	let preview = f.src.length > 80 ? f.src.slice(0, 77) + "..." : f.src;
	console.log(`\n[neg ${f.idx}] unexpected error type: ${f.err.name}: ${f.err.message}`);
	console.log(`      ${preview}`);
}
