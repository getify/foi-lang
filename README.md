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

### Imports

To import named dependencies (including "globals" from `std`), use the `import` keyword:

```java
import #Std;

Std.log("Hello");               // "Hello"

Std.log(6 + 12);                // 18
```

Or import specific members `from` dependencies:

```java
import log from #Std;

log("Hello");                   // "Hello"
```

### Expression-Evaluation Form

All function calls and operators can optionally be evaluated in a lisp-like evaluation-expression form (with `| |` instead of `( )`):

```java
import log from #Std;

| log "Hello" |;               // "Hello"

| log | + 6, 12 ||;            // 18
```

An evaluation-expression `| .. |` expects the first element to be a function (or operator), followed optionally by whitespace. Any subsequent elements are treated as the parameter list (internally comma-separated), hence `| + 6, 12 |` above.

The primary reason for this optional evaluation-expression form is that it allows additional flexibility/capability at the call-site that isn't possible with the traditional call-site form (e.g., `fn(1,2,3)`).

For example, evaluation-expression allows for partial-application (left-to-right) by providing fewer arguments than the declared minimum arity of the function:

```java
| | + 6 | 12 |;                // 18
```

Above, the `| + 6 |` creates a partially applied (operator) function, which is then provided a second argument `12` in the outer `| .. 12 |` expression.

Another advantage of this form is that it allows n-ary operators, where typically operators would be limited to unary (single operand) or binary (two operands) usage. Many operators in Foi are n-ary, such as the `+` operator, the `>>` flow (composition) operator, and the `..` Tuple range operator.

There are other capabilities of this call-site form that we'll see later in this guide.

### Defining Variables

To define variables, use the `def` keyword (not an operator/function).

```java
def age: 42;
```

All definitions need a value initialization, but you can use the `empty` value if there's no other value to specify.

`def` definitions do not hoist, so to avoid confusion, they *must not* be preceded in any scope (module, function, or block) by any other non-definition (besides `def`, `deft`, `defn`, and `import`) statements.

To reassign a variable:

```java
def age: empty;

age <: 42;
```

Unlike `def` definitions, `<:` re-assignments are allowed anywhere in the scope after the associated `def` definition.

`def` definitions attach to the nearest enclosing scope, whether that be module, function, or block. A block-scoped variable definition is thus:

```java
{
    def tmp: 42;
    tmp <: 43;
}
```

However, since `def` definitions must appear at the top of their respective scopes, and there may be multiple such definitions in a block, the `def`-block form should be preferred for readability sake:

```java
def (tmp: 42) {
    tmp <: 43;
}
```

Moreover, the `def`-block is allowed anywhere in its enclosing scope, so it's more flexible than a `def`.

### Boolean Logic

The `true` and `false` boolean values are used primarily for decision making. As such, non-negated, boolean-returning operators, aka logical operators, begin with the `?` character.

To combine two or more boolean values with logical *AND* (`?and`):

```java
def isValid: true;
def isComplete: true;
def isSuccess: false;

isValid ?and isComplete;                    // true
isValid ?and isComplete ?and isSuccess;     // false

| ?and isValid, isComplete, isSuccess |;    // false
```

And for logical *OR* (`?or`):

```java
def isValid: true;
def isComplete: true;
def isSuccess: false;

isValid ?or isComplete ?or isSuccess;       // true

| ?or isValid, isComplete, isSuccess |;     // true
```

To negate a boolean value, use the `!` operator:

```java
def isValid: true;

def isInvalid: !isValid;
def isNotValid: | ! valid |;

isInvalid;              // false
isNotValid;             // false
```

Also, any `?`-prefixed logical boolean operator can be flipped/negated by swapping the `?` with the `!` operator. For example, `!and` is *NAND* (not-and) and `!or` is *NOR* (not-or):

```java
// instead of these:
!(true ?and false);             // true
!true ?or !false;               // true
!(true ?and true);              // false
!true ?or !true;                // false

// or these:
!(false ?or false);             // true
!false ?and !false;             // true
!(true ?or false);              // false
!true ?and !false;              // false

// use negated operators:
true !and false;                // true
true !and true;                 // false
false !or false;                // true
true !or false;                 // false
```

### Equality And Comparison

The `?=` operator checks for equality:

```java
def x: 42;
def y: 42;
def z: 100;

x ?= 42;                    // true

| ?= x, y, z |;             // false
```

To relationally compare (`?<` less-than, `?>` greater-than):

```java
def x: 100;
def y: 200;

x ?< y;                     // true
x ?> y;                     // false
```

And for the inclusive comparisons (`?<=` less-than-or-equal, `?>=` greater-than-or-equal):

```java
def x: 100;
def y: 200;

x ?<= x;                    // true
y ?>= y;                    // true
```

A very common task is to check if a value is in a range between two other values:

```java
def x: 100;

(x ?> 0) ?and (x ?< 500);   // true
```

However, this can be done more idiomatically with the range-check operators, `?<>` (non-inclusive) and `?<=>` (inclusive):

```java
def x: 100;

| ?<> x, 0, 500 |;          // true
| ?<=> x, 100, 100 |;       // true
```

Remember, all these `?`-prefixed operators can be flipped/negated by swapping the `?` with `!`.

### Pattern Matching

To make decisions, use pattern matching:

```java
import log from #Std;

def myName: "Kyle";

?/
    (myName ?= "Kyle"): log("Hello!")
    default: log("Goodbye!")
/;
```

Each match clause begins with a conditional -- either `( .. )` delimited expression or a `| .. |` evaluation-expression -- followed by a `:` colon an its consequent -- either an expression or a `{ }` block. If the match's conditional evaluates to `true`, the consequent is evaluated, and the pattern-match completes.

Otherwise, the next match conditional is evaluated, and so on. If no match conditional succeeds, the (required) `default` clause's consequent is evaluated.

The matched clause's consequent result value will be the final expression result:

```java
def myName: "Kyle";

def greeting: ?/
    (myName ?= "Kyle"): "Hello!"
    default: "Goodbye!"
/;

greeting;               // "Hello!"
```

### Records And Tuples

Records are immutable collections of values, delimited by `< .. >`. You can name each field of a record, but if you omit a name, numeric indexing is automatically applied. Any record with all numerically indexed fields (implicitly or explicitly defined) is a special case called a Tuple.

```java
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

To define Records/Tuples using arbitrary expressions, use the evaluation-expression form:

```java
import uppercase from #Std.String;

def five: 5;
def numbers: < 4, five, 6 >;

def surname: "Simpson";
def person: < first: "Kyle", last: |uppercase surname| >;
```

To keep Record/Tuple syntax simpler, *only* the `| .. |` form of evaluation-expression (function invocation, operators, etc) is allowed inside the `< .. >` literal definition.

Strings are just syntax sugar for tuples of characters. Once defined, a string and a tuple of characters will behave the same.

```java
def chars: < "H", "e", "l", "l", "o" >;
def str: "Hello";

chars.1;                    // "e"
str.1;                      // "e"
```

To determine the length of a string (or a Tuple), or the count of elements in a Record, use the `size(..)` function:

```java
import size from #Std;

size("Hello");              // 5
size(< "O", "K" >);         // 2
size(< a: 1 >);             // 1
```

To progressively define the contents of a Record/Tuple across an arbitrary number of statements/operations, use a Record/Tuple *def-block* `<{ .. }>`. The block can contain any arbitrary logic for determining the contents, including traditional function calls, loops, etc. Once the block closes, the computed value is frozen as immutable.

```java
def numbers: <{
    .1 <: 4;
    .2 <: 5;
    .3 <: 6;
}>;

def person: <{
    .first <: "Kyle";
    .last <: "Simpson";
}>;
```

#### Inspecting

You can determine if a value is in a Tuple with the `?in` / `!in` operator:

```java
def numbers: < 4, 5, 6 >;

7 ?in numbers;                  // false
| ?in 4 numbers |;              // true

7 !in numbers;                  // true
| !in 4 numbers |;              // false
```

**Note:** The `in` operator only inspects numerically indexed fields.

You can determine if a field is defined in a Record with the `?has` operator:

```java
def person: < first: "Kyle", last: "Simpson" >;

person ?has "first";            // true
person ?has "middle";           // false

person !has "nickname";         // true
```

#### Deriving Instead Of Mutating

Since Records/Tuples are immutable, to change their contents requires you to derive a new Record/Tuple. One way to do so is the `&` pick operator:

```java
def numbers: < 4, 5, 6 >;
def allDigits: < 1, 2, 3, &numbers, 7, 8, 9 >;

def person: < first: "Kyle", last: "Simpson" >;
def friend: < &person, first: "Jenny" >;
```

And to select only specific elements for the derived Record/Tuple:

```java
def numbers: < 4, 5, 6 >;
def oddDigits: < 1, 3, &numbers.1, 7, 9 >;

def person: < first: "Kyle", last: "Simpson" >;
def friend: < first: "Jenny", &person.last >;
```

The `&numbers.1` and `&person.last` pick operations are just sugar for:

```java
def numbers: < 4, 5, 6 >;
def oddDigits: < 1, 3, 2: numbers.1, 7, 9 >;

def person: < first: "Kyle", last: "Simpson" >;
def friend: < first: "Jenny", last: person >;
```

But in that less-sugared form, you could re-index or rename the field in the target Record/Tuple.

As a shorthand, you can also pick multiple fields at once:

```java
def numbers: < 4, 6 >;
def evenDigits: < 0, 2, &numbers.[0,1], 8 >;

def person: < first: "Kyle", last: "Simpson", nickname: "getify" >;
def profile: < &person.[first,nickname] >;
```

The `+` operator, when used with Records/Tuples, acts in an append-only (concatenation) form:

```java
def numbers: < 4, 5, 6 >;
def moreNumbers: numbers + < 7, 8, 9 >;

moreNumbers.5;              // 8
```

And to derive a new Tuple as a ranged subset of another one, use the `..` operator:

```java
def numbers: < 4, 5, 6 >;

numbers..1;                 // < 5, 6 >
numbers..-1;                // < 6 >

| .. numbers 0 2 |;          // < 4, 5 >
```

#### Maps

A Record can also act as a *map*, in that you can use another Record/Tuple *as a field* (not just as a value), using the `%` sigil to start the field name:

```java
def numbers: < 4, 5, 6 >;
def dataMap: < %numbers: "my favorites" >;

dataMap[numbers];           // "my favorites"
```

#### Sets

A Set is an alternate Tuple definition form, delimited with `[ ]` instead of `< >`, which ensures each unique value is only stored once:

```java
def numbers: [ 4, 6, 4, 5 ];

numbers;                    // < 4, 6, 5 >
```

As you can see, a Set is merely a syntactic sugar construction form for a Tuple, filtering out any duplicate values. What's created is still a Tuple, not a different value type.

The `+=` set-append operator (similar to the `+` Record/Tuple append operator) will only append values not in the previous Tuple:

```java
def numbers: [ 4, 5, 6 ];

def moreNumbers: numbers += [ 6, 7 ];

moreNumbers;                // < 4, 5, 6, 7 >
```

### Functions

To define a function, use the `defn` keyword. To return a value from anywhere inside the function body, use the `^` sigil:

```java
defn add(x,y) { ^x + y; }
```

Function definitions are always hoisted:

```java
add(6,12);                          // 18
| add 6, 12 |;                      // 18

defn add(x,y) { ^x + y; }
```

Function definitions are also expressions (first-class values), so they can be assigned and passed around:

```java
def myFn: defn add(x,y) { ^x + y; };

add(6,12);                          // 18
myFn(6,12);                         // 18
```

Function definition expressions can also be immediately invoked:

```java
|
    |defn add(x,y) { ^x + y; }| 6, 12
|;                                  // 18
```

Concise function definitions may omit the name and/or the `{ .. }` around the body, but the concise body must be an expression marked by the initial `^` return sigil:

```java
def myFn: defn(x,y) ^x + y;

|
    |defn(x,y) ^x + y| 6, 12
|;                                  // 18
```

#### Default Parameter Values

To default a function parameter value:

```java
defn add(x: 0, y: 0) ^x + y;
```

The default is applied if the corresponding argument supplied has the `empty` value, or if omitted.

#### Named Arguments

To override positional argument-parameter binding at a function call-site, the evaluation-expression form can specify which parameter name each argument corresponds to (in any order):

```java
defn add(x: 0, y) ^x + y;

| add x:3, y:4 |;               // 7
| add y:5 |;                    // 5
```

#### Function Recursion

Function recursion is supported:

```java
defn factorial(v) {
    ^?/
        (v ?<= 1): v
        default: v * factorial(v - 1)
    /;
}

factorial(5);                   // 120
```

**Note:** The `?/ .. /` syntax is pattern-matching, explained earlier.

Tail-calls (recursive or not) are automatically optimized by the Foi compiler to save call-stack resources:

```java
defn factorial(v,tot: 1) {
    ^?/
        (v ?<= 1): tot
        default: factorial(v - 1,tot * v)
    /;
}

factorial(5);                   // 120
```

#### Function Currying

Function definitions can optionally be curried:

```java
defn add(x)(y) ^x + y;

def add6: add(6);

add6(12);                           // 18
add(6)(12);                         // 18
```

Note that `add(6,12)` (aka, loose currying) would not work, but the evaluation-expression form of the function call supports loose-applying arguments across currying boundaries:

```java
defn add(x)(y) ^x + y;

| add 6, 12 |;                     // 18
```

Function definitions must declare side-effects (reassignment of free/outer variables) using the `over` keyword:

```java
def customerCache: empty;
def count: 0;

defn lookupCustomer(id) over (customerCache) {
    // ..

    // this reassignment side-effect allowed:
    customerCache <: cacheAppend(customerCache,customer);

    // but this is disallowed because `count`
    // isn't listed in the `over` clause:
    count++;
}
```

#### Function Composition

Function composition can be defined with the `>>` flow operator:

```java
defn inc(v) ^v + 1;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

|| >> inc, triple, half | 11 |;     // 18

def composed: | >> inc, triple, half |;

composed(11);                       // 18
```

Right-to-left style composition is defined with the `<<` flow-right operator:

```java
defn inc(v) ^v + 1;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

|| << half, triple, inc | 11 |;     // 18

def composed: | << half, triple, inc |;

composed(11);                       // 18
```

#### Function Pipelines

By contrast, the `#>` pipeline operator (F#-style) operates like this:

```java
defn inc(v) ^v + 1;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

11 #> inc #> triple #> half;        // 18

11 #> | >> inc, triple, half |;     // 18
```

The first expression in a pipeline must be a value or an expression that produces a value. Each subsequent step must either be a function, or an expression that resolves to a function, which then produces a value to pass on to the next step.

Since the `#>` operator is n-ary, multiple steps can also be used in the evaluation-expression form:

```java
defn inc(v) ^v + 1;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

| #> 11, inc, triple, half |;       // 18
```

The *topic* of a pipeline step is implicitly passed as the single argument to the function, but can be explicitly be passed using the `#` sigil:

```java
defn add(x,y) ^x + y;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

11 #> add(1,#) #> triple #> half;        // 18
11 #> | add 1, # | #> triple #> half;    // 18
```

A *pipeline function* is a specialized function definition form that replaces the `^` return sigil with a `#>` pipeline as its concise body. The *topic* of the first step is automatically bound to the first parameter of the function:

```java
defn add(x,y) ^x + y;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

defn compute(x) #> add(1,#) #> triple #> half;

compute(11);                            // 18
```

### Type Annotations

Type annotations in Foi are applied to values/expressions (not to variables, etc). These are optional, as Foi uses type inference wherever possible. But applying them can often improve the performance optimizations the Foi compiler can produce. A type annotation always begins with the `as` keyword:

```java
def age: 42 as int;

def cost: | * getQty(order,item), getPrice(item) | as float;
```

Custom types can be defined, for use in subsequent annotations, with the `deft` keyword:

```java
deft OrderStatus { empty, "pending", "shipped" }

def myStatus: getOrderStatus(order) as OrderStatus;
```

Function signatures may optionally be typed via custom types:

```java
deft InterestingFunc (int,string) -> empty;

defn whatever(id,name) as InterestingFunc {
    // ..
}
```

## License

[![License](https://img.shields.io/badge/license-MIT-a1356a)](LICENSE.txt)

All code and documentation are (c) 2022 Kyle Simpson and released under the [MIT License](http://getify.mit-license.org/). A copy of the MIT License [is also included](LICENSE.txt).
