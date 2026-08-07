// Slot storage. Spec keys on (namespace-identity, value-identity);
// this keys on value alone, which is sound here only because
// ContinuationTrampoline is the single slot-using namespace in the program.
var HOST_SLOTS = new WeakMap();

var Effect = {
	Host: {
		Slot: {
			// dispatch helper calls __src.__ns._percent(__src, __arg)
			// Read's __arg is the bare instance
			Read: {
				__ns: {
					_percent: (kind, inst) => HOST_SLOTS.get(inst),
				},
			},
			// Write's __arg is the [inst, value] tuple
			Write: {
				__ns: {
					_percent: (kind, payload) => {
						HOST_SLOTS.set(payload[0], payload[1]);
						return undefined;
					},
				},
			},
		},
	},
};

// only if the prelude doesn't already supply it
var Done = { _at: (v) => ({ __tag: "Done", value: v }) };





var ContinuationTrampoline = { _at: ((__inner) => (...__a) => { var __r = __inner(...__a); if (typeof __r === "object" && __r !== null && !("__ns" in __r)) __r.__ns = ContinuationTrampoline; return __r; })((pair) => { var inst = []; ((__src, __arg) => typeof __src?.__ns?._percent === "function" ? __src.__ns._percent(__src, __arg) : __src)(Effect.Host.Slot.Write, [inst, pair]); return inst; }), _percent: (inst) => { var stack = null; var current = inst; (() => { while (true) { var __result = (() => { return (current?.__ns === ContinuationTrampoline ? (() => { var __t = ((__src, __arg) => typeof __src?.__ns?._percent === "function" ? __src.__ns._percent(__src, __arg) : __src)(Effect.Host.Slot.Read, current), left = __t[0], right = ((__d) => __d == null ? null : __d)(__t[1]); (right != null) ? stack = [right, stack] : null; current = left(); return null; })() : ((stack != null) ? (() => { var __t = stack, resume = __t[0], rest = __t[1]; stack = rest; current = resume(current); return null; })() : Done._at())); })(); if (__result?.__tag === "Done") break; } return []; })(); return current; } };
null /* deft ContThunk() ^any; */;
null /* deft ContResume(any) ^any; */;
null /* deft ContPair < ContThunk, ContResume >; */;
null /* deft ContConstruct(ContPair) :Effects(Effect.Host.Slot.Write) ^ContinuationTrampoline; */;
null /* deft ContBounce(ContinuationTrampoline) :Effects(Effect.Host.Slot.Read) ^any; */;
/* ContinuationTrampoline@ hoisted */;
/* ContinuationTrampoline% hoisted */;
null /* deft Deferred() ^any; */;
null /* deft MapFn(any) ^any; */;
null /* deft ContRampT(Any) ^Any; */;
function contRamp(v) { return (v?.__ns === ContinuationTrampoline ? ((__src) => typeof __src?.__ns?._percent === "function" ? __src.__ns._percent(__src) : __src)(v) : v); };
null /* deft DeferredOf(any) ^Deferred; */;
null /* deft DeferredMap(Deferred, MapFn) ^Deferred; */;
null /* deft DeferredRun(Deferred) ^any; */;

// function of(v) { return (() => { return v; }); };
// function map(d, fn) { return (() => { return ContinuationTrampoline._at([d, fn]); }); };
// function run(d) { return (((__t) => (contRamp)(__t))(d())); };
// function buildDeep(n) { var d = of(0); ((__r) => { var __src = Array.isArray(__r) ? __r : Object.values(__r); for (let __v of __src) { var __result = (() => { var i = __v; return d = map(d, ((__c, ...__a) => (...__rest) => __c(...__a, ...__rest))(((...__xs) => __xs.reduce((__l, __r) => __l + __r)), 1)); })(); if (__result?.__tag === "Done") break; } return __r; })((((__from, __to) => { if (typeof __from !== typeof __to) throw new TypeError("range endpoints must be same type"); let __isStr = typeof __from === "string"; let __s = __isStr ? __from.charCodeAt(0) : __from; let __e = __isStr ? __to.charCodeAt(0) : __to; let __step = __e >= __s ? 1 : -1; let __len = Math.abs(__e - __s) + 1; return Array.from({ length: __len }, __isStr ? (_, __i) => String.fromCharCode(__s + __i * __step) : (_, __i) => __s + __i * __step); })(1, n))); return d; };

// console.log(
// 	run(buildDeep(1000000))
// );


function chain2(tag) { return ContinuationTrampoline._at([() => { console.log(`${tag}1`); null; }, (prior) => { console.log(`${tag}2`); null; }]); };
null /* deft FanT(List, int) ^Any; */;
function fan(cbs, i) { return (i >= cbs.length ? null : ContinuationTrampoline._at([() => { return cbs[i](); }, (prior) => { return fan(cbs, i + 1); }])); };
var subs = [() => { return chain2("A"); }, () => { return chain2("B"); }];
contRamp(fan(subs, 0));
