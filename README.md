# Foi: a different kind of functional programming language

I'm jotting down some very early thoughts on what I think I want to design for the Foi language. This stuff is pretty much all subject to change. Consider everything experimental R&D for the foreseeable future.

## Aspirational Design Ideas

* versioned, with no backwards-compat guarantee
* parsed, JIT'd, compiled (probably WASM), with full-fidelity AST (preserves everything including whitespace, comments, etc)
* semicolons and braces (both required) -- no ASI, no implicit blocks
* lexical and block scoped, functions are first-class and have closure
* side effects (non-local reassignments) must be explicitly declared in function signature
* no global scope (everything is in a module scope)
* no circular dependencies, only synchronous module initialization
* no references or pointers
* no class, nor prototype, nor `this`-awareness
* functional (tail-call optimized, pattern matching, curried function definitions, composition syntax, native monads, no exception handling, etc)
* no `const`
* no `let` -- block-scoped declarations are explicit syntax as part of the block
* function auto-hoisting, but no variable hoisting
* only one empty value
* numeric types: int, float, bigint, bigfloat
* everything is an expression (no statements)
* iteration/looping (for/foreach/filter/map) are syntactic expressions, but accept functions
* all keywords and operators are functions (with optional lisp-like call syntax)
* records/tuples (instead of objects/arrays) that are immutable and by-value primitives
* syntax for mutable data collection (dynamically define props/indices, like objects or arrays), but in order to use/read/pass-around, must first be "frozen" into an immutable record or tuple -- somewhat like a heap-allocated typed-array that's then accessed by a "view" (a record or tuple)
* strings are sugar for tuples of characters, and are interoperable as such
* optional named-argument call syntax
* asynchrony built in (syntax for future values and reactivity/streams)
* garbage collected
* type awareness: weakly typed (small, limited set of type coercions), with dynamic type inferencing as well as optional type annotations on values/expressions

## Prior Ideas

In addition to the above, I may pull parts of a long-ago description of [earlier ideas for this language (then called "FoilScript")](https://github.com/getify/FoilScript#whats-in).

## Exploring Code Ideas

The following is a super incomplete exploration of what I've been imagining for awhile. There's a lot still to work out.

Import named dependencies (including "globals" from `std`), use the `import` keyword:

```c
import #Std;

Std.log("Hello");               // "Hello"

Std.log(6 + 12);                // 18
```

Or import specific members `from` dependencies:

```c
import log from #Std;

log("Hello");                   // "Hello"
```

All function calls and operators can optionally be evaluated in a lisp-like expression-evaluation form (with `| |` instead of `( )`):

```c
import log from #Std;

| log "Hello" |;               // "Hello"

| log | + 6, 12 ||;            // 18
```

One main reason for the optional expression-evaluation form is that it allows for partial-application (left-to-right) by providing fewer arguments than the arity of the function:

```c
| | + 6 | 12 |;                // 18
```

Above, the `| + 6 |` creates a partially applied (operator) function, which is then provided a second argument `12` in the outer `| .. 12 |` expression.

An evaluation-expression `| .. |` expects the first element to be a function (or operator), followed optionally by whitespace. Any subsequent elements are treated as the parameter list (internally comma-separated), hence `| + 6, 12 |` in the earlier snippet.

To define variables, use the `def` keyword (not an operator/function). To block-scope one or more definitions, use the `def (..) { .. }` block form. All definitions need a value, but you can use the `empty` value if there's no other value to specify:

```c
def age: 42;

def (tmp: empty) {
    tmp = age;
    tmp++;
};
```

**Note:** `def` definitions *must not* be preceded in any scope (module, function, or block) by any other non-definition (besides `def`, `deft`, `defn`, and `import`) statements. However, the `def` block form is allowed anywhere in a scope. Moreover, as `def (tmp: empty) { .. }` and `{ def tmp: empty; .. }` are equivalent, the former is preferred for readability sake.

Records are immutable collections of values, delimited by `< .. >`. You can name each field of a record, but if you omit a name, numeric indexing is automatically applied. Any record with all numerically indexed fields (implicitly or explicitly defined) is a special case called a Tuple.

```c
def idx: 2;
def prop: "last";

def numbers: < 4, 5, 6 >;
numbers.1;                      // 5
numbers[idx];                   // 6

def person: < first: "Kyle", last: "Simpson" >;
person.first;                   // "Kyle"
person[prop];                   // "Simpson"
```

Above, Record/Tuple fields are accessed with `.` syntax, whether numeric or lexical-identifier. `[ .. ]` field access syntax evaluates field-name expressions (including strings that may include non-identifier characters).

To define Records/Tuples using arbitrary expressions, use the expression-evaluation form:

```c
import uppercase from #Std.String;

def five: 5;
def numbers: < 4, five, 6 >;

def surname: "Simpson";
def person: < first: "Kyle", last: |uppercase surname| >;
```

To keep Record/Tuple syntax simpler, *only* the `| .. |` form of expression-evaluation (function invocation, operators, etc) is allowed inside the `< .. >` literal definition.

Strings are just syntax sugar for tuples of characters. Once defined, a string and a tuple of characters will behave the same.

```c
def chars: < "H", "e", "l", "l", "o" >;
def str: "Hello";

chars.1;                    // "e"
str.1;                      // "e"
```

To determine the length of a string (or a Tuple), or the count of elements in a Record, use the `size(..)` function:

```c
import size from #Std;

size("Hello");              // 5
size(< "O", "K" >);         // 2
size(< a: 1 >);             // 1
```

To progressively define the contents of a Record/Tuple across an arbitrary number of statements/operations, use a Record/Tuple *def-block* `<{ .. }>`. The block can contain any arbitrary logic for determining the contents, including traditional function calls, loops, etc. Once the block closes, the computed value is frozen as immutable.

```c
def numbers: <{
    .1 = 4;
    .2 = 5;
    .3 = 6;
}>;

def person: <{
    .first = "Kyle";
    .last = "Simpson";
}>;
```

To derive a new Record/Tuple from an existing Record/Tuple, use the `&` include operator:

```c
def numbers: < 4, 5, 6 >;
def allDigits: < 1, 2, 3, &numbers, 7, 8, 9 >;

def person: < first: "Kyle", last: "Simpson" >;
def friend: < &person, first: "Jenny" >;
```

To define a function, use the `defn` keyword. To return a value from anywhere inside the function body, use the `^` sigil:

```c
defn add(x,y) { ^x + y; };
```

Function definitions are always hoisted:

```c
add(6,12);                          // 18
| add 6, 12 |;                      // 18

defn add(x,y) { ^x + y; };
```

Function definitions are also expressions (first-class values), so they can be assigned and passed around:

```c
def myFn: defn add(x,y) { ^x + y; };

add(6,12);                          // 18
myFn(6,12);                         // 18
```

Function definition expressions can also be immediately invoked:

```c
|
    |defn add(x,y) { ^x + y; }| 6, 12
|;                                  // 18
```

Concise function definitions may omit the name and/or the `{ .. }` around the body, but the body must be an expression delimited by the `^` return sigil:

```c
def myFn: defn(x,y) ^x + y;

|
    |defn(x,y) ^x + y| 6, 12
|;                                  // 18
```

Function definitions can optionally be curried:

```c
defn add(x)(y) ^x + y;

def add6: add(6);

add6(12);                           // 18
add(6)(12);                         // 18
```

Note that `add(6,12)` (aka, loose currying) would not work, but the expression-evaluation form of the function call supports loose-applying arguments across currying boundaries:

```c
defn add(x)(y) ^x + y;

| add 6, 12 |;                     // 18
```

Function definitions must declare side-effects (reassignment of free/outer variables) using the `over` keyword:

```c
def customerCache: empty;
def count: 0;

defn lookupCustomer(id) over (customerCache) {
    // ..

    // this reassignment side-effect allowed:
    customerCache = cacheAppend(customerCache,customer);

    // but this is disallowed because `count`
    // isn't listed in the `over` clause:
    count++;
};
```

Function composition can be defined with the `=>` flow operator, like this:

```c
defn inc(v) ^v + 1;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

| 11 | => inc, triple, half ||;     // 18

def composed: | => inc, triple, half |;
composed(11);                       // 18
```

By contrast, the `#>` pipeline operator (F#-style) operates like this:

```c
defn inc(v) ^v + 1;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

11 #> inc #> triple #> half;        // 18

11 #> | => inc, triple, half |;     // 18
```

Type annotations in Foi are applied to values/expressions (not to variables, etc). These are optional, as Foi uses type inference wherever possible. But applying them can often improve the performance optimizations the Foi compiler can produce. A type annotation always begins with the `as` keyword:

```c
def age: 42 as int;

def cost: | * getQty(order), getPrice(item) | as float;
```

Custom types can be defined, for use in subsequent annotations, with the `deft` keyword:

```c
deft OrderStatus { empty, "pending", "shipped" };

def myStatus: getOrderStatus(order) as OrderStatus;
```

Function signatures may optionally be typed via custom types:

```c
deft InterestingFunc (int,string) -> empty;

defn whatever(id,name) as InterestingFunc {
    // ..
};
```

## License

[![License](https://img.shields.io/badge/license-MIT-a1356a)](LICENSE.txt)

All code and documentation are (c) 2022 Kyle Simpson and released under the [MIT License](http://getify.mit-license.org/). A copy of the MIT License [is also included](LICENSE.txt).
