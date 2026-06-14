// test-parser.js — exercises parseFoi against a corpus of source samples.
//
// Two lanes:
//   - samples:     expected to fully parse without throwing.
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


var samples = [

	// =============================================================
	// §2 LITERALS
	// =============================================================

	'`"hi `42`!";',


	// =============================================================
	// §3 IMPORTS / EXPORTS
	// =============================================================

	"export { a: b, :y };",


	// =============================================================
	// §4 VARIABLE DEFINITIONS / DESTRUCTURING
	// =============================================================

	"def <a: b, c: d,>: empty;",


	// =============================================================
	// §5 EXPRESSION SCAFFOLDING
	// =============================================================

	"def x: ((42)); def y: (empty); 5;",
	'(42); (true); ("hi"); (empty);',


	// =============================================================
	// §6 IDENTIFIER EXPRESSIONS / ACCESS / RANGE
	// =============================================================

	"def x: foo.bar[42].baz;",
	"def last: numbers.-1;",
	"def x: arr.[1..5]; def y: arr.[..10]; def z: arr.[5..];",
	"def x: rec.<a, b, c>;",
	"def x: foo@; def y: (@); def z: #;",


	// =============================================================
	// §7 FUNCTION CALLS / OP-AS-FUNCTION
	// =============================================================

	'foo(1, 2); foo.bar(x); ("hi").len; ((42).foo)|y|;',
	"foo'(1,2,3); def revFoo: (foo'); (+'); (')(+); (+)'(1,2,3); (?empty)(x, y, z);",
	"(.)(numbers, 1);",


	// =============================================================
	// §9 BINARY TIERS
	// (and incidental §7 prime, §8 unary, FlowOp variants)
	// =============================================================

	"1 + 2 * 3; x ?<= y ?and ?empty list ?or n ?in arr; 5'; data #> f +> g;",
	"age ?as int;" +                                 // headline: ?as + NativeType
		"age !as bool;" +                                // !as + NativeType
		"myFn ?as SimpleFunc;" +                         // regression: ?as + Identifier RHS
		"x ?as List;" +                                  // ?as + BuiltIn
		"x ?as Either.Right;" +                          // ?as + dotted NamedType
		"(age ?as int) :as bool;" +                      // GroupedOpExpr wraps TypeCompareBinExpr; :as on the wrap
		"?(x){ ?[?as int]: 1; ?: 0 };" +                 // DepCondClause: bare ?as + NativeType
		"?(x){ ?[?as SimpleFunc]: 1; ?: 0 };" +          // DepCondClause: bare ?as + Identifier (regression)
		"?{ ?[x ?as int]: 1; ?: 0 };" +                  // IndepCondClause: full binary inside BracketExpr
		"x ?as int ?and y ?as bool;" +                   // tier mix: AndBinExpr wrapping two TypeCompareBinExpr
		"(?as);" +                                       // OpFuncExpr regression: ?as as op-value
		"x ?in arr;",                                    // regression: ?in still routes through CompareBinExpr


	// =============================================================
	// §11 BLOCK EXPRESSIONS
	// =============================================================

	"{ a; b; }; (x){ y; }; (x: 5, y){ x + y; }; def (a: 1) { a; };",


	// =============================================================
	// §12 ASSIGNMENT
	// =============================================================

	"x := 5; foo.bar := 42; foo.bar[0] := y + 1; a.b.c := (1 + 2);",


	// =============================================================
	// §13 FUNCTION DEFINITIONS
	// =============================================================

	"defn () ^42; " +
		"defn add(x, y) ^x + y; " +
		"defn fact@(n) { n; }; " +
		"defn curried(x)(y) ^x; " +
		"defn over_ex(x) :over(y, z) ^x; " +
		"defn typed() :as MyType ^empty; " +
		"defn pipe(x) #> log; " +
		"defn gather(*args) ^args;",


	// =============================================================
	// §14 CONDITIONALS / GUARDS
	// =============================================================

	"?[x ?< 5]: x + 1; " +                              // bare GuardedExpr
		"defn clamped(x) ?[x ?< 0]: 0 ^x; " +               // FuncPrecond
		"?[isComplete] ~each { isComplete := true; };",    // FlowLHS as CondClause + FlowRHS as BlockExpr


	// =============================================================
	// §15 MATCH EXPRESSIONS
	// =============================================================

	"?{ [x ?< 0]: -1; [x ?> 0]: 1; ?: 0; }; " +              // Indep with else
		"?(x){ [1, 2, 3]: \"low\"; [?> 10]: \"high\"; }; " +    // Dep with bare-? compare
		"?{ [ready]: { go(); }; };",                              // Indep with BlockExpr consequent


	// =============================================================
	// §16 DO-COMPREHENSIONS
	// =============================================================

	"List ~<< { def x:: xs; x + 1 }; " +              // basic DoComprExpr + DoDefVarStmt
		"Id ~<< (x:: foo) { x + 1 }; " +                  // DoBlockDefsInitOpt
		"Id ~<< { def x:: foo(); ::bar(x); }; " +         // DoFinalUnwrapExpr
		"Promise ~<* { def r:: get(); };",                // DoLoopComprExpr
	"(1..3 ~<* yield) ~map { \"done\" };" +
		"(Id ~<< { ::42; }) ~< g;" +
		"(env.start..env.end ~<* yield) ~map { \"Complete.\" };" +
		"(x + 1) ~map f;" +
		"def x: (1..3 ~<* yield) :as Foo;" +
		"(1..3 ~<* yield) :as Foo ~map f;",


	// =============================================================
	// §17 DATA STRUCTURE LITERALS
	// =============================================================

	"def t: <1, 2, 3>; " +                       // bare tuple via RecordTupleLit
		"def r: <a: 1, b: 2>; " +                    // ExplicitPropDef
		"def c: <:foo, :bar>; " +                    // ConcisePropDef
		"def cp: <%key: 5>; " +                      // ComputedPropName
		"def p: <&existing, c: 3>; " +               // PickValue
		"def s: <[1, 2, 3]>; " +                     // SetLit
		"def n: <<1, 2>, <3, 4>>;",                  // nested RecordTupleLit


	// =============================================================
	// §18 TYPE DEFINITIONS
	// =============================================================

	"deft Status int; " +                                  // bare NativeType
		"deft Color Red | Green | Blue; " +                    // UnionType (3 arms)
		"deft Point <x: int, y: int>; " +                      // DataStructType with fields
		"deft Tuple <int, string, *bool>; " +                  // DataStructType with values + gather
		"deft Adder (int, int) ^int; " +                       // FuncType
		"deft Nullary () ^empty; " +                           // empty args + EmptyLit return
		"deft Optional (?X) ^?Y; " +                           // Qmark args + Qmark return
		"deft Wrapped List{int}; " +                           // NestedType
		"deft Dotted Either.Right; " +                         // dotted NamedType (2 segments)
		"deft Complex (string, *{(int) ^int}) ^{\"yes\" | \"no\"}; " + // nested func + string union
		"deft G <*int>; " +                                    // bare gather as whole list (DataStructTypeList alt-2)
		"deft P <x: int, y: int,>; " +                         // trailing comma in DataStructType
		"deft F (int, int,) ^int; " +                          // trailing comma in FuncType args
		"deft D A.B.C; " +                                     // 3-segment dotted NamedType
		"deft H (*int) ^empty;",                               // single-arg gather func (FuncTypeArgList alt-2)


	// =============================================================
	// KITCHEN SINK / CROSS-§
	// Mixed-§ regressions and end-to-end realistic snippets.
	// =============================================================

	"def t: <0, &nums.<1,3>, &person.last, 8>; " +                      // PickValue with access
		"defn fn() ^(Promise ~<< { def x:: getX(); ::x; }); " +             // ^(DoCompr) return
		"Maybe._ @ 42; " +                                                  // AtCallExpr access-with-trivia
		"def (< :p, capt: items.0 >: getOrder(123)) { p; }; " +             // destructure-with-init in block-defs
		"Maybe ~<< (< :v >:: getMaybe()) { v; };",                          // do-destructure-with-init
	"def numbers: < 4, 5, 6 >; " +
		"def person: < first: \"Kyle\", last: \"Simpson\" >; " +
		"numbers.1; person.first; numbers[idx]; person[\"first\"]; " +
		"(.)(numbers, 1); (.)(person, \"first\"); " +
		"str.1; size(< a: 1 >); " +
		"def nums: < 5, 10, 15, %idx: 20, 25 >; " +
		"def p2: < %\"favorite number\": 42 >; " +
		"def p3: < :first, :last >; " +
		"7 ?in numbers; person ?has \"first\"; person !has \"x\"; " +
		"def r1: 2..13; def r2: two..thirteen; def r3: \"a\"..\"z\"; " +
		"def r4: (..)(\"a\", \"z\"); " +
		"odds + evens; " +
		"numbers.<1,3>; (.<1,3>)(numbers); " +
		"numbers.[..0]; numbers.[..-2]; numbers.-1; " +
		"numbers.[-1..]; numbers.[1..]; numbers.[1..3]; " +
		"(.[1..3])(numbers); " +
		"def all: < 0, 1, &numbers, 7, 8 >; " +
		"def odd: < 1, 3, &numbers.1, 7 >; " +
		"def fr: < first: \"Jenny\", &person.last >; " +
		"def ev: < 2, &numbers.<1,3>, 8 >; " +
		"def fb: < 0, 1, &numbers.[..2] >; " +
		"def pf: < &person.<first,nickname> >; " +
		"def fewer: < 0, &numbers, 2: empty, 4: empty >; " +
		"def dm: < %numbers: \"my favorites\" >; dm[numbers]; " +
		"def un: <[ &something, &another ]>; " +
		"def mn: numbers $+ < 6, 7 >; " +
		"set1 ?$= set2; set1 !$= set3;",
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
];

var passed = 0;
var unexpectedFails = [];

for (let i = 0; i < samples.length; i++) {
	try {
		for await (let tree of parseFoi(samples[i],{
			// preserveSoftDelims: true,
		})) {
			// console.log(util.inspect(tree,{depth:50}));
		}
		passed++;
	}
	catch (err) {
		unexpectedFails.push({ idx: i, src: samples[i], err: err.message });
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

console.log(`${passed}/${samples.length} passed`);
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
