/* most recent run (500kb, 2 warmups)

warmup 1: 5.942s
warmup 2: 5.700s
run 1:    5.831s  (279,216 tokens, 87.5 KB/s)
run 2:    5.798s  (279,216 tokens, 88.0 KB/s)
run 3:    5.813s  (279,216 tokens, 87.8 KB/s)
run 4:    5.770s  (279,216 tokens, 88.5 KB/s)
run 5:    5.850s  (279,216 tokens, 87.2 KB/s)
bytes:        510.4 KB
tokens:       279,216
chars/token:  1.87
best run:     5.770s
all runs (s): 5.831, 5.798, 5.813, 5.770, 5.850
throughput:   0.09 MB/s
              48K tokens/sec
*/



// bench-lexer.js — streaming lexer throughput probe.
//
// Cycles through a pool of representative Foi snippets, yielding
// chunks on demand into the lexer's async-iterable input. Stops
// after a target byte count; times the full streaming pipeline.

// import { tokenize } from "./orig-tokenizer.js";
import { tokenize } from "./tokenizer.js";
import { performance } from "node:perf_hooks";


// Representative snippet pool. Mix identifiers, keywords, numbers,
// strings, operators, comments to reflect realistic source. All
// forms here are directly cribbed from existing project samples.
var SNIPPETS = [
	// Basics / literals / access
	'`"hi `42`!";',
	"export { a: b, :y };",
	"def <a: b, c: d,>: empty;",
	"def x: ((42)); def y: (empty); 5;",
	'(42); (true); ("hi"); (empty);',
	"def x: foo.bar[42].baz;",
	"def x: foo@; def y: (@); def z: #;",
	"def x: arr.[1..5]; def y: arr.[..10]; def z: arr.[5..];",
	"def x: rec.<a, b, c>;",
	'foo(1, 2); foo.bar(x); ("hi").len; ((42).foo)|y|;',

	// Binary / unary / chains
	"1 + 2 * 3; x ?<= y ?and ?empty list ?or n ?in arr; 5'; data #> f +> g;",
	"{ a; b; }; (x){ y; }; (x: 5, y){ x + y; }; def (a: 1) { a; };",
	"x := 5; foo.bar := 42; foo.bar[0] := y + 1; a.b.c := (1 + 2);",

	// defn variants
	"defn () ^42; " +
		"defn add(x, y) ^x + y; " +
		"defn fact@(n) { n; }; " +
		"defn curried(x)(y) ^x; " +
		"defn over_ex(x) :over(y, z) ^x; " +
		"defn typed() :as MyType ^empty; " +
		"defn pipe(x) #> log; " +
		"defn gather(*args) ^args;",

	// Guards / match
	"?[x ?< 5]: x + 1; " +
		"defn clamped(x) ?[x ?< 0]: 0 ^x; " +
		"?[isComplete] ~each { isComplete := true; };",
	"?{ [x ?< 0]: -1; [x ?> 0]: 1; ?: 0; }; " +
		"?(x){ [1, 2, 3]: \"low\"; [?> 10]: \"high\"; }; " +
		"?{ [ready]: { go(); }; };",

	// Do-comprehensions
	"List ~<< { def x:: xs; x + 1 }; " +
		"Id ~<< (x:: foo) { x + 1 }; " +
		"Id ~<< { def x:: foo(); ::bar(x); }; " +
		"Promise ~<* { def r:: get(); };",

	// Records / tuples / sets
	"def t: <1, 2, 3>; " +
		"def r: <a: 1, b: 2>; " +
		"def c: <:foo, :bar>; " +
		"def cp: <%key: 5>; " +
		"def p: <&existing, c: 3>; " +
		"def s: <[1, 2, 3]>; " +
		"def n: <<1, 2>, <3, 4>>;",

	// Type definitions (deft)
	"deft Status int; " +
		"deft Color Red | Green | Blue; " +
		"deft Container { Just | Nothing }; " +
		"deft Point <x: int, y: int>; " +
		"deft Tuple <int, string, *bool>; " +
		"deft Adder (int, int) ^int; " +
		"deft Nullary () ^empty; " +
		"deft Optional (?X) ^?Y; " +
		"deft Wrapped List{int}; " +
		"deft Dotted Either.Right; " +
		"deft Complex (string, *{(int) ^int}) ^{\"yes\" | \"no\"}; " +
		"deft G <*int>; " +
		"deft V {Red | Green |}; " +
		"deft P <x: int, y: int,>; " +
		"deft F (int, int,) ^int; " +
		"deft D A.B.C; " +
		"deft H (*int) ^empty;",

	// Mixed feature probes
	"def t: <0, &nums.<1,3>, &person.last, 8>; " +
		"defn fn() ^(Promise ~<< { def x:: getX(); ::x; }); " +
		"Maybe._ @ 42; " +
		"def (< :p, capt: items.0 >: getOrder(123)) { p; }; " +
		"Maybe ~<< (< :v >:: getMaybe()) { v; };",

	// Audio player module (1-tab indent variant)
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

	`///
	NOTE: this is a sketch of how Promise/PromiseSubject,
	and some associated utilities (all, race) can be
	written in Foi. It's included here because it
	demonstrates a broad cross-section of Foi's various
	features/syntax.
	///

	// type definitions
	deft PromiseConstructor(?Init) ^Promise;
	deft Init(Resolve) ^empty;
	deft Resolve(any) ^Either;
	deft Promise <
		chain: Chain,
		map: Map,
		resolved: Resolved,
	>;
	deft Chain(ChainCB) ^Promise;
	deft ChainCB(any) ^Promise;
	deft Map(MapCB) ^Promise;
	deft MapCB(any) ^any;
	deft Resolved() ^bool;
	deft Race(List{Promise}) ^Promise;
	deft All(List{Promise}) ^Promise;
	deft PromiseSubjectUnitConstructor() ^PromiseSubject;
	deft PromiseSubject <
		pr: Promise,
		resolve: Resolve,
	>;
	deft PromiseUnitConstructor(any) ^Promise;


	// module-local variables
	def subscribers: <>;


	// module-local functions
	defn subscribe(pr,cb) :over (subscribers) {
		?{
			?[subscribers ?has pr]: {
				def cbs: subscribers[pr] $+ < cb >;
				subscribers := < &subscribers, %from: cbs >;
			}
			?: {
				subscribers := < &subscribers, %pr: < cb > >;
			}
		};
	};

	defn notifyValue(pr,v)
		![subscribers ?has pr]: Left@ "No subscribers"
	{
		subscribers[stream] ~each (cb) {
			cb(v);
		};
		^Right@ true;
	};

	defn race(prs)
		![size(prs) ?> 0]: Promise@ (Left@ "Empty list of promises")
		:as Race
	{
		def subj: PromiseSubject@;
		prs ~each (pr) {
			pr ~map subj.resolve;
		};
		^subj.pr;
	};

	defn all(prs)
		![size(prs) ?> 0]: Promise@ (Left@ "Empty list of promises")
		:as All
	{
		def subj: PromiseSubject@;
		def resCount: 0;
		def res: <>;
		prs ~each (pr,idx) {
			pr ~map (v) {
				resCount := resCount + 1;
				res := < &res, %idx: v >;
				?[resCount ?= size(prs) ?and !subj.pr.resolved()]: {
					subj.resolve(res);
				};
			};
		};
		^subj.pr;
	};

	defn PromiseSubject@()
		:as PromiseSubjectUnitConstructor
	{
		def resolve: empty;
		def pr: Promise(
			defn(res) :over (resolve) { resolve := res; }
		);
		^< :pr, :resolve >;
	};

	defn Promise@(v)
		?[?empty v]: Promise()
		:as PromiseUnitConstructor
	{
		def subj: PromiseSubject@;
		subj.resolve(v);
		^subj.pr;
	};

	defn Promise(initFn)
		:as PromiseConstructor
	{
		def value: empty;
		def pending: true;
		def publicAPI: <
			:chain,
			:map,
			:resolved,
		>;
		?[initFn ?as Init]: initFn(resolve);
		^publicAPI;

		// **************************

		defn resolve(v)
			![pending]: Left@ "Promise already resolved"
			:over (value,pending)
			:as Resolve
		{
			value := v;
			pending := false;
			notifyValue(publicAPI,value);
			^Right@ v;
		};

		defn chain(fn)
			![pending]: fn(value)
			:as Chain
		{
			def subj: PromiseSubject@;
			subscribe(publicAPI,fn +> |~map ,subj.resolve|);
			^subj.pr;
		};

		defn map(fn)
			![pending]: Promise@ fn(value)
			:as Map
		{
			def subj: PromiseSubject@;
			subscribe(publicAPI,fn +> subj.resolve);
			^subj.pr;
		};

		defn resolved() :as Resolved ^!pending;
	};`,

	// OpFunc / prime modifiers
	"foo'(1,2,3); def revFoo: (foo'); (+'); (')(+); (+)'(1,2,3); (?empty)(x, y, z);",
	"(.)(numbers, 1);",
	"def last: numbers.-1;",

	// Kitchen-sink data-struct + access
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

	// Loop comprehensions with :as
	"(1..3 ~<* yield) ~map { \"done\" };" +
		"(Id ~<< { ::42; }) ~< g;" +
		"(env.start..env.end ~<* yield) ~map { \"Complete.\" };" +
		"(x + 1) ~map f;" +
		"def x: (1..3 ~<* yield) :as Foo;" +
		"(1..3 ~<* yield) :as Foo ~map f;",

	// Type-compare expressions
	"age ?as int;" +
		"age !as bool;" +
		"myFn ?as SimpleFunc;" +
		"x ?as List;" +
		"x ?as Either.Right;" +
		"(age ?as int) :as bool;" +
		"?(x){ ?[?as int]: 1; ?: 0 };" +
		"?(x){ ?[?as SimpleFunc]: 1; ?: 0 };" +
		"?{ ?[x ?as int]: 1; ?: 0 };" +
		"x ?as int ?and y ?as bool;" +
		"(?as);" +
		"x ?in arr;",

	// Basics
	"foo",
	"foo bar",
	"def x: 42;",
	"defn add(a,b) ^a + b;",
	"   ",
	"\t\n  \t",

	// Comments
	"//line\n42",
	"///block///x",
	"//",
	"//foo",
	"///",
	"///foo",
	"///foo\nbar\n///",
	"// foo\n// bar",

	// Numbers
	"123",
	"12.5",
	"12..5",
	"5",
	"5.",
	"5.foo",
	"5..10",
	"0",
	"00",
	"1_000_000",

	// NegativeIntegerLit
	"-0",
	"-1",
	"-42",
	"numbers.-1",
	"def last: arr.-1;",
	"-1.5",
	"-0.5",
	"-12.5",
	"-1_000",
	"-1foo",
	"-5..3",
	"-5..",
	"..-3",
	"-5...args",
	"-2..-1",
	"5..-1",
	"0..-1",
	"-5..0",
	"-5..-1",
	"-10..-5",
	"1..-1..3",
	"(-5)..(-1)",
	"<-5..-1>",
	"x..-1",
	"-5-3",
	"-5 - 3",
	"-5+3",
	"-5*3",
	"(-5)-3",
	"<-1, -2, -3>",
	"<-0>",
	"arr.[-2..-1]",
	"arr.[-1..]",
	"\\-5",
	"\\-123_456",
	"\\-5foo",

	// Digit-leading identifier formation
	"1foo",
	"1_foo",
	"1abc",
	"5foo",
	"5_foo",
	"5.5foo",
	"-5foo",
	"\\1foo",

	// Escaped-number / identifier boundary
	"\\1_000foo",
	"\\5.5foo",
	"\\h2Axyz",
	"\\b101xyz",
	"\\o7xyz",
	"\\u41xyz",
	"\\@FFxyz",
	"\\h_foo",

	// Escaped numbers
	"\\h1A2",
	"\\@99",
	"\\b1010",
	"\\h-5",
	"\\o-7",
	"\\b-1",
	"\\u263A",
	"\\@FF",
	"\\@-FF",
	"\\@5_FF",
	"\\@5.5",
	"\\@-5",
	"\\@5_000_003.25",
	"\\1_234_567",
	"\\1_234_567.890_123",
	"\\5_",
	"\\5_000",
	"\\5_000.25",
	"\\5",
	"\\h0",
	"\\b0",
	"\\o0",
	"\\u0",
	"\\-123_456",
	"\\-123_456.78_9",
	"\\-5.5",
	"\\-0",
	"\\b-10110",
	"\\hf123",
	"\\h-f123",
	"\\o-123",
	"\\@123_456.78_9",
	"\\@-f123",
	"\\@-123_456.78_9",
	"\\h-Fxyz",
	"\\@-5foo",

	// Tilde / comprehension forms
	"~map",
	"~map foo",
	"foo~bar",
	"~foo",

	// Reserved-set gate boundaries
	"?ands",
	"!ors",
	"?empt",
	":asx",
	":overflow",
	"~mapp",
	"~maps",
	"~fol",
	"defx",
	"defns",
	"deftype",
	"trueish",
	"falsey",
	"emptyx",
	"Maybex",
	"Functionx",
	"IOs",
	"intx",

	// Mixed gate-fallthrough probes
	"123a",
	"a123",
	"123~",
	"~123",
	"Value~",
	"~Value",
	"empty~",
	"~empty",
	"int~",
	"~int",
	"~eachA",
	"~each~",
	"a~each",
	"~Value~",
	"~empty~",
	"def 123~: empty;",
	"def ~123: empty;",
	"def Value~: empty;",
	"def ~empty: empty;",
	"def a~each: empty;",
	"defn ~each~() ^empty;",

	// Specializations
	"empty",
	"true",
	"Maybe",
	"Function",
	"~each",

	// Boolean named ops & keyword extension
	"?and",
	"!or",
	":as",
	":foo",
	":over",
	"?in",
	"!has",
	"?empty",

	// Multi-char ops
	"::",
	"...",
	"..",
	"..5",
	"...5",

	// Strings
	`"hello"`,
	`""`,
	`"foo bar baz"`,
	`" "`,

	// Interpolated strings
	'`"hello"',
	'`""',
	'`"hi `42`!"',
	'`"`name`!"',
	'`"a `x + 1` b"',

	// Nested InterpExpr
	'`" `a` "',
	'`" `foo(x, y)` "',
	'\\`" this is `\\`"my friend, `name`"`!"',
	'`"a `\\`"b"` c"',

	// Spacing-form interp strings
	'\\`"hello"',
	'\\`""',
	'\\`"a b"',
	'\\`"hi `42`!"',
	'\\`"a `x + 1` b"',

	// Escaped strings
	'\\"hello"',
	'\\""',
	'\\"a b"',
	'\\"hello world foo"',

	// STRING_ESCAPED_CHAR cases
	'""""',
	'"a"""',
	'"""b"',
	'"a""b"',
	'\\""""',
	'\\"hello"""',
	'\\"""world"',
	'\\"hello""world"',
	'`"``"',
	'`"a``"',
	'`"``b"',
	'`"a``b"',
	'`""""',
	'`"a"""',
	'`"""b"',
	'`"a""b"',
	'\\`"``"',
	'\\`"a``"',
	'\\`"``b"',
	'\\`"a``b"',
	'\\`""""',
	'\\`"a"""',
	'\\`"""b"',
	'\\`"a""b"',

	// AtCallExpr adjacency
	"f(@)",
	"f(@2)",
	"f(@ 2)",
	"f(@(2))",
	"f(@ (2))",
	"f(Id@)",
	"f(Id@2)",
	"f(Id @2)",
	"f(Id@ 2)",
	"f(Id @ 2)",
	"f(Id@(2))",
	"f(Id@ (2))",
	"f(Id @ (2))",
	"f(Either.Right@)",
	"f(Either.Right@2)",
	"f(Either.Right @2)",
	"f(Either.Right@ 2)",
	"f(Either.Right @ 2)",
	"f(Either.Right@(2))",
	"f(Either.Right@ (2))",
	"f(Either.Right @ (2))",
	"None@",
	"f(None@)",

	// :as adjacency
	"(*)(getQty(order,item), getPrice(item)) :as float",
	"?3 :as bool",
	"?(3) :as bool",
	"?(3):as bool",
	"3 * 2 :as int",
	"3 * (2 :as int)",
	"(3 * 2) :as int",
	"(3 * 2):as int",
	"3 ?as bool",
	"(?(x){ ?[?as int]: f(#) :as bool; ?: # :as bool }):as bool",
	"def x: 5 :as int;",
	"defn f(x:0) :as Whatever { ^x };",
	"defn add(x)(y) :as Adder { ^x + y };",
	"x :as int",
	"foo :as List",
	"<1,2,3> :as Tuple",
	"\"hi\" :as string",
	"x\n:as int",
	"x :as\nint",
	"x:as int",

	// Multiline / nested string stress
	'"Hello, ""Santa""!"',
	'"Here\'s a\n   multiline string"',
	'\\"A single line\n    string with whitespace collapsing, defined across multiple\n  lines"',
	'\\`"A single line (with\n   whitespace collapsing), and a single `` backtick"',
	'`"Special number: `-3.1415962`\n   Name: `name`\n   Greeting: `\\`"Hello world"`\n   Reaction: `\\"Yay!"`\n   Reply: `"Ok."`\n!"',

	// Records / tuples / sets
	"<>",
	"<  >",
	"<true>",
	"<1,2,3>",
	"<a:1>",
	"< a: 1, b: \"ok\" >",
	"<[]>",
	"<[ 1, 2, 2 ]>",
	"<\n    ,,&v.x.[3..].<a,b> , \"Hello\" , 3,,4, :foo,\n    yes: empty, fn(1),\n    %x.y.z: false,\n    %\"Hello World\": 2,\n    %\\`\" this\n    is `adverb` \"\"crazy\"\"!\": 42,\n    %bar:<1>,,\n>",

	// Computed-property names
	"%x",
	"%x.y",
	"%\"key\"",
	"%`\"key`x`\"",
	"%\\`\"key`x`\"",

	// Set literal forms
	"<[ 1, 2, 3, ]>",
	"<[true, false, empty]>",
	"<[a, b, c]>",
	"<&v, 1, 2>",

	// Range expressions
	"[1..3]",
	"[1..]",
	"[..3]",
	"x.[1..3]",
	"v.x.[3..]",

	// Type definitions (deft)
	"deft F (?X) ^G",
	"deft X(Y,Z) ^empty",
	"deft Y(_) ^Either",
	"deft Z() ^Either",
	"deft W <\n    a: Q,\n    b: S | int,\n    c: U | {(*string) ^{bool|42}},\n    d: < int, string, *bool, >,\n    *< int, int >,\n>",
	"deft Q(R) ^PushStream",
	"deft R(_) ^PushStream",
	"deft S(T) ^ PushStream",
	"deft T(*_)^ _",
	"deft U(int, string, *float) ^bool",
	"deft V Left | Right",
	"deft A { Left | Right }",
	"deft B(str, *{(int)^int}) ^{\"yes\"|\"no\"}",

	// Import / export
	"def x: import \"X\";",
	"def < :log >: import \"#Std\";",
	"export { :x, :y, z: zzz, };",
	"export { :login, :logout };",
	"export { doLogin: login, doLogout: logout };",

	// Exotic whitespace blob
	"\u0009\u000a\u000b\u000c\u000d\u0020\u0085\u00a0\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u200b\u200c\u200d\u200e\u200f\u2028\u2029\u202f\u205f\u3000\ufeff",

	// comment-inside-statement forms
	"def a: 1;",
	"def b:1; // hello",
	"def c  :   1 ; ;;",
	"def d: /// hello\n/// 3;",
	"def /// e: 3;///  f: 4;",

	// kitchen-sink defn
	"defn add(x)(y,<:z>)\n    ?[x.y]: y(z[2])\n    ![x]: z(3)\n    :over(z, w)\n    :as Whatever\n{\n    z := 2;\n    ?{?: 42;};\n    ?{\n        ?[z]: fn(g);\n        [w]: w;\n        ![x]: { fn(g) };\n        ?[y]: (v, <:z>) { fn(g); }\n        ?: 42\n    };\n    ?( fn(g) ){\n        [?> y]: g;\n        ?[ x, z . y [3] ]: g\n    };\n    ?{ ?[x]: x };\n    ?(x){ ?[x]: x };\n    ?{ ?[x]: x; ?[y]: y };\n    ?(x){ ?[x]: x; ?[y]: y };\n    ?[z]: (g: z) { fn(g) };\n    x.[y..z];\n    y.<first,last>;\n    (+)(1,2,3,...nums);\n    (+')'(1,,3);\n    (')(+)(1,,3);\n    myFn|2,,3|;\n    myFn(3,x:2);\n    myFn'|3,x:2|;\n    ^42\n}",

	// comprehensions + pipelines
	"1..3 ~each log",
	"?[x] ~each (x,y:2) { x }",
	"foo ~map ![x] ~each foo",
	"x . y [3].[1..3] .<a,b,> ~filter { y }",
	"x #> (y(#.y,2) #> z)",
	"def cb1: f(2) +> g +> h(3)(4);",
	"def cb2: f(2) <+ g <+ h(3)(4);",
	"def cb3: f +> (defn(v) ^v) +> g;",
	"defn myFn(x) #> f(#..3);",
	"2..4 #> { f(#.0) }",

	// do-comprehensions
	"List ~<< {\n    def x:: getSomething();\n    def y: uppercase(x);\n    def z:: another(y);\n    z.0\n}",
	"IO ~<< (x:: getSomething()) {\n    def y: uppercase(x);\n    def z:: another(y);\n    ::prepareValue(z);\n}",
	"Promise ~<* {\n    def respE:: getSomething();\n    Either ~<< (resp:: respE) {\n        printResp(resp);\n    };\n}",
	"urls ~map fetch ~<* (resp) {\n    def v:: processResp(resp);\n    def success:: storeVal(v);\n    ?[success]: log(v);\n}",

	// Hyphen-as-sign basic
	"-5",
	"5-3",
	"5 - 3",
	"x-5",
	"(5)-3",
	"5+-3",
	"-x",

	// expressionEnding tail — wrapped types
	"def-5",
	":as-3",
	"true-5",
	"false-3",
	"empty-7",
	"Maybe-3",
	"IO-1",
	"List-9",
	"~map-5",
	"~each-1",
	"~fold-3",
	"?and-5",
	"!or-3",
	"?has-2",
	"foo-5",
	"x-3",
	")-3",
	"}-3",
	"#-5",
	"|-5",

	// expressionEnding tail — trivia
	"foo  -5",
	"foo\t-5",
	"(5)  -3",
	"42  -3",

	// expressionEnding tail — non-fire cases
	"foo - x",
	"foo -",
	"foo -x",
	"foo- 5",

	// Operator boundary soup
	"2+3+4",
	"2 + 3 + 4",
	"(2 + 3) + 4",
	"2 + (3 + 4)",
	"x + y + true",
	"?x",
	"? x",
	"?(x)",
	"!x",
	"! x",
	"!(x)",
	"?empty y",
	"?empty(y)",
	"x ?and y !and z",
	"(x ?and !y) !or (z / 2)",
	"(x ?and !y)!or(z/2)",
	"x ?in y",
	"x ?has y",
	"x?>y",
	"x ?> y",
	"x ?= y",
	"x != y",
	"x ?$= y",
	"x !$= y",
	"x ?<=> y",
	"x !<=> y",
	"x ?<= y",
	"x ?>= y",
	"x ?<> y",
	"x ?< y",

	// OpFunc with prime modifiers
	"(+)(1,2,3)",
	"(+')(1,6)",
	"(-')(1,6)",
	"(')(-)(1,6)",
	"(+')'(1,,3)",
	"(')(+)(1,,3)",
	"myFn|2,,3|",
	"myFn(3,x:2)",
	"myFn'|3,x:2|",

	// numberEnding scope
	"5...args",
	"12.5...args",
	"foo...args",
	")...args",
	"}...args",
	"#...args",
	"|...args",
	"true...args",
	"Maybe...args",
	"~map...args",
	"?and...args",
	"def...args",

	// Mixed
	`def x: "hi";`,
	'def msg: `"hello, `name`!";',

	// Combinatorial multi-token sequences
	"def x: -42;",
	"def y: x + -1;",
	"def z : 42 ;",
	"defn safe(a) ?[a > 0]: a;",
	"defn impl() :over (List) ^v;",
	"defn add(a,b) ?[a > 0]: a + b; ^0;",
	"[1..10]",
	"<1, 2, 3>",
	"<[1, 2, 3]>",
	"foo(...args)",
	"foo(:name, age: 30)",
	"data #> filter |#, isValid|",
	"?{ ?[x > 0]: pos; ?: zero }",
	"?(x) { [1]: \"one\"; [2]: \"two\"; ?: \"other\" }",
	"Maybe ~<< { ::42 }",
	"[1..10] ~<* { ^v + 1 }",
	'import "./foo";',
	"export { x, y: foo };",
	"def <:a, :b>: point;",
	"def f: 1 + 2 - 3 * 4 / 5;",
	"def n: \\hFF_FF;",
	'def msg: \\`"hi `name`!";',
	"x.foo.bar",
	"x.<a, b, c>",
	"x.[1..3]",
	"foo()()",
	"foo|a, b|()",
	"foo@ bar",
	"Function@42;",
	"~each !{ x > 0 }",
];

var CORPUS = SNIPPETS.join("\n");
var TARGET_BYTES = 500 * 1024; // 500 KB
var WARMUP = 2;
var RUNS   = 5;


async function runOnce() {
	var bytes  = 0;
	var tokens = 0;
	while (bytes < TARGET_BYTES) {
		for await (let _ of tokenize(CORPUS)) tokens++;
		bytes += CORPUS.length;
	}
	return { bytes, tokens };
}

// Warmup — let V8 optimize the hot path.
for (let i = 0; i < WARMUP; i++) {
	let t0 = performance.now();
	await runOnce();
	let t1 = performance.now();
	console.log(`warmup ${i + 1}: ${((t1 - t0) / 1000).toFixed(3)}s`);
}

// Measure.
var samples = [];
var lastResult;
for (let i = 0; i < RUNS; i++) {
	let t0 = performance.now();
	lastResult = await runOnce();
	let t1 = performance.now();
	let dt = (t1 - t0) / 1000;
	samples.push(dt);
	console.log(`run ${i + 1}:    ${dt.toFixed(3)}s  (${lastResult.tokens.toLocaleString()} tokens, ${(lastResult.bytes / dt / 1024).toFixed(1)} KB/s)`);
}

var { bytes, tokens } = lastResult;
var best = Math.min(...samples);

console.log(`bytes:        ${(bytes / 1024).toFixed(1)} KB`);
console.log(`tokens:       ${tokens.toLocaleString()}`);
console.log(`chars/token:  ${(bytes / tokens).toFixed(2)}`);
console.log(`best run:     ${best.toFixed(3)}s`);
console.log(`all runs (s): ${samples.map(s => s.toFixed(3)).join(", ")}`);
console.log(`throughput:   ${(bytes / best / 1024 / 1024).toFixed(2)} MB/s`);
console.log(`              ${(tokens / best / 1000).toFixed(0)}K tokens/sec`);
