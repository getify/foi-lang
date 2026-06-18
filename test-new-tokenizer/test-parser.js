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
