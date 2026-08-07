# Foi Language: (Mostly Complete) Guide

Foi has stablized design wise, and now has a [full specification](formalization-work/Foi-Specification.md) though some of the details/semantics may still change.

If you're looking for the **Foi** grammar: [Lexical Grammar](formalization-work/Lexical-Grammar.md) and [Syntactic Grammar](formalization-work/Syntactic-Grammar.md)

## Table of Contents

* [Primitive Values](#primitive-values)
    - [Empty](#empty)
    - [Numbers](#numbers)
    - [Booleans](#booleans)
    - [Strings](#strings)
* [Identifiers](#identifiers)
* [Code Comments](#code-comments)
* [Imports And Exports](#imports-and-exports)
* [Function Calls](#function-calls)
    - [Invoking Operators As Functions](#invoking-operators-as-functions)
    - [Apply (aka Spread) Arguments](#apply-aka-spread-arguments)
    - [Reversing Argument Order](#reversing-argument-order)
    - [Gathering Arguments](#gathering-arguments)
    - [Partial Application](#partial-application)
    - [Currying Arguments](#currying-arguments)
    - [Named Arguments](#named-arguments)
* [Defining Variables](#defining-variables)
    - [Block-Definitions Clause](#block-definitions-clause)
    - [Destructured Definitions](#destructured-definitions)
    - [Lazy Forward References](#lazy-forward-references)
* [Boolean Logic](#boolean-logic)
* [Equality and Comparison](#equality-and-comparison)
* [Pattern Matching](#pattern-matching)
    - [Guard Expressions](#guard-expressions)
* [Records and Tuples](#records-and-tuples)
    - [Equality Comparison](#equality-comparison)
    - [Inspecting](#inspecting)
    - [Generating Sequences (Ranges)](#generating-sequences-ranges)
    - [Deriving Instead Of Mutating](#deriving-instead-of-mutating)
    - [Progressive Definition](#progressive-definition)
    - [Maps](#maps)
    - [Sets](#sets)
* [Defining Functions](#defining-functions)
    - [Default Parameter Values](#default-parameter-values)
    - [Gather Parameter](#gather-parameter)
    - [Negating a Predicate](#negating-a-predicate)
    - [Function Pre-conditions](#function-pre-conditions)
    - [Function Recursion](#function-recursion)
    - [Function Currying](#function-currying)
    - [Function Overs](#function-overs)
    - [Function Composition](#function-composition)
    - [Function Pipelines](#function-pipelines)
    - [`@`-suffix (At) Functions](#--suffix-at-functions)
    - [`%`-suffix (Percent) Functions](#--suffix-percent-functions)
    - [`~`-suffix (Comprehension) Functions](#--suffix-comprehension-functions)
* [Base Unit Functions](#base-unit-functions)
    - [Value Identity Function](#value-identity-function)
    - [Null-Application Function](#null-application-function)
* [Loops](#loops)
    - [Early Exit](#early-exit)
* [List Comprehensions](#list-comprehensions)
    - [Filter Comprehension (List)](#filter-comprehension-list)
    - [Map Comprehension (List)](#map-comprehension-list)
    - [FlatMap Comprehension (List)](#flatmap-comprehension-list)
    - [Do Comprehension (List)](#do-comprehension-list)
    - [Fold Comprehensions (List)](#fold-comprehensions-list)
* [Monads (And Friends)](#monads-and-friends)
    - [Monadic Map](#monadic-map)
    - [Monadic Bind](#monadic-bind)
    - [The Monad Laws](#the-monad-laws)
    - [Monadic Do Comprehension](#monadic-do-comprehension)
    - [Monadic Function Returns](#monadic-function-returns)
    - [Pattern Matching Monads](#pattern-matching-monads)
    - [List Monad](#list-monad)
    - [Maybe Monad](#maybe-monad)
    - [Foldable / Catamorphism](#foldable--catamorphism)
    - [Either Monad](#either-monad)
* [Broader Category Theory Capabilities](#broader-category-theory-capabilities)
    - [Applicative](#applicative)
    - [Concatable / Semigroup](#concatable--semigroup)
    - [Monoid](#monoid)
* [Concurrency / Asynchrony](#concurrency--asynchrony)
    - [Promise Monad](#promise-monad)
    - [Channel](#channel)
    - [PushStream Monad](#pushstream-monad)
    - [PullStream Monad](#pullstream-monad)
* [IO monad](#io-monad)
    - [Task](#task)
    - [Reader](#reader)
    - [Transforming Over Concurrency](#transforming-over-concurrency)
* [Iterators](#iterators)
    - [Constructing An Iterator](#constructing-an-iterator)
    - [Stepping](#stepping)
    - [Draining An Iterator](#draining-an-iterator)
* [Generators](#generators)
    - [Declaring a Generator](#declaring-a-generator)
    - [Generator Invocation](#generator-invocation)
    - [Yielding Values](#yielding-values)
    - [The Terminal Value](#the-terminal-value)
    - [Two-Way Value Flow](#two-way-value-flow)
* [Effects](#effects)
    - [Declaring an Effect](#declaring-an-effect)
    - [Performing and Handling](#performing-and-handling)
    - [Tracking Effects](#tracking-effects)
    - [Ambient Effects](#ambient-effects)
* [Type Annotations](#type-annotations)

## Primitive Values

**Foi** comes with the following built-in primitive value types:

* Empty: `empty`
* Numbers: `42`, `-3.14`
* Booleans: `true`, `false`
* Strings: `"Hello, world!"`
* [Records, Tuples](#records-and-tuples): `< id: 123 >`, `< 1, 2, 3 >`
* [Monadic instances](#monads-and-friends): `Id`, `Left`

### Empty

The `empty` value signifies the absence of any other affirmative value.

### Numbers

Numbers in **Foi** are written as base-10 literals (digits `0-9`), including negative values (with `-`) and decimals (with `.`).

There's only one kind of number. `4` and `4.0` are the same value written two ways, and every number is held exactly -- as a ratio of two whole numbers, with no limit on how big either one gets. The arithmetic you learned in school is the arithmetic you get:

```java
0.1 + 0.2 ?= 0.3;       // true

(1 / 3) * 3 ?= 1;       // true
```

**NOTE:** No more being bitten by `0.1 + 0.2` not being `0.3`!

`int` and `float` are constraints you can write about a number, not two different kinds of number. `float` means "a number"; `int` means "a whole number". Every `int` is a `float`, and not every `float` is an `int`:

```java
42 ?as float;           // true
42.0 ?as float;         // true
42.3 ?as float;         // true

42.0 ?as int;           // true
42.3 ?as int;           // false
```

There are no special numbers (`NaN`, `Infinity`) in **Foi**, and no negative zero.

Dividing by zero has no answer to give, so it stops your program and tells you where. If that's not what you want at some boundary -- a report that should show a dash instead of dying -- you can catch it and hand back something else; see the ambient effects section.

```java
6 / 0;                  // stops the run, naming the line
```

A non-numeric operand isn't arithmetic at all, and you'll usually hear about it before anything runs. Arithmetic takes numbers, so if **Foi** can see the operand isn't one, that's a compile error right there; if it can't tell yet, you get a check when it runs.

```java
6 / "a";                // compile error: "a" isn't a number
```

Arithmetic hands you back a number, and that's all its *type* says -- even when the answer is obviously whole:

```java
def n: 4 * 2;           // the value is 8; the type is float

def{int} m: 4 * 2;      // allowed, but checked when it runs
```

`int` is something you write about a position, never something arithmetic gives you.

Operations whose answers are irrational -- `sqrt`, the trig functions, the circle constant -- can't land exactly on a ratio, so they take a precision and hand back the exact number at that precision. There's a default, so you only pass one when you care.

When a number gets written out -- into a string, say -- you get text that means exactly that number, not a rounded-off version of it. Most numbers you'll meet have a decimal that ends, and that's what you see. The ones that don't come out as a ratio:

```java
`"half: `1 / 2`";       // half: 0.5
`"third: `1 / 3`";      // third: 1/3
```

`1/3` looks unusual the first time. It's the honest answer -- `0.333...` would have to stop somewhere, and wherever it stopped it would no longer be the number you divided.

To specify a *more readable* numeric literal, using `_` as an arbitrary separator (in any position), prefix the number literal with a `\`:

```java
\100_000_003.25;        // 100000003.25
```

Hexadecimal, Octal, and Binary integers can be specified with respective prefixes (lowercase):

```java
\h603A;                 // 24634
\o60072;                // 24634
\b110000000111010;      // 24634
```

**Note:** One special numeric prefix is `\u`, which produces a string (of one or more characters) from the numeric hexadecimal representation of its Unicode code-point. So the numeric literal `\u263A` produces the single-character string `"☺"`. **HOWEVER**, this escape form is *only* available inside [interpolated string literal](#strings) expressions.

### Booleans

There are two boolean values: `true` and `false`; there are no implicitly "truthy" or "falsy" values in **Foi** -- coercion to boolean is never done implicitly.

However, most non-boolean values can be explicitly converted to a `true` or `false` equivalent, via the unary `?` operator. And the `!` unary operator does the same as `?`, but also negates, from `true` to a `false` or vice versa:

```java
?0;             // false
!0;             // true

? 1;            // true
! 1;            // false

?(empty);       // false
!(empty);       // true

? "hello";      // true
! "hello";      // false
```

It's much more common/advisable to use `?` / `!` operators with a variable (e.g., `?customerOrder`, `!qty`, etc) than with a literal value.

**Note:** Whitespace is optional between `?` and the value/variable, as shown above. However, since `?empty` / `!empty` (with no whitespace) are actual operators, either whitespace (`! empty`) or parentheses (`?(empty)`, as above) are necessary to distinguish the intended expression from the operators. That said, `?(empty)` / `!(empty)` are pretty uncommon/unnecessary expressions in programs; `true` and `false` are shorter, respectively, *and* more semantic.

### Strings

Strings are always delimited with `"    "` (double-quotes).

To include a `"` character inside a string literal, it must be escaped with a second `"`, like this: `"Hello, ""friend""!"`; when printed, that value would look like `Hello, "friend"!`.

Other than the `""` escaping, the contents of strings are not, by default, parsed/processed in any way.

That is, if you spread a string across multiple lines, those new lines (and any leading whitespace) are included in the string's contents:

```java
"This is line one,
   and this is line two.";
// This is line one,
//    and this is line two.
```

If you want to collapse new lines (and line trailing/leading whitespace) into a single whitespace character, prefix the string literal with a `\`, like this:

```java
\"This is all on
   the same
 line.";
// This is all on the same line.
```

To interpolate expressions inside of a string, immediately prefix the string literal with a `` ` `` (back-tick), and then also delimit each expression inside the string with `` ` `` back-ticks:

```java
`"My name is `name`.";
// My name is Kyle.
```

The interpolated expression (inside the `` ` .. ` ``) can be any valid **Foi** expression.

**Warning:** There's one minor caveat to the above statement. An interpolated expression *cannot* itself contain a bare (`` `".." ``) interpolated string, because the `` `" `` sequence would be a grammar ambiguity (opening another interpolated string, or closing the current interpolated expression and outer string). To nest an interpolated string inside an interpolated expression, you must use a slightly unfortunate work-around. For the inner/nested interpolated string literal, escape it with combined whitespace-collapsing as well (via `` \` ``), as illustrated shortly; fortunately, the `` \`" `` sequence is *not* grammatically ambiguous.

The *value* that expression produces has to be something **Foi** can write out: a string, a number, `true`/`false`, or `empty`. That covers most of what you'd drop into a string anyway.

A Record, a Tuple, or an instance of one of your own types won't interpolate. You get a compile error right at the slot -- as opposed to JS nonsense like `[object Object]`. When you want one of those in a string, call something that returns a string:

```java
def rec: < x: 1, y: 2 >;

defn showPoint(p) ^`"(`p.x`, `p.y`)";

`"point: `showPoint(rec)`";     // point: (1, 2)
```

That's the same bargain as `?` and `!` for booleans: **Foi** won't quietly turn your value into something else, so you say how.

Interpolation is also the *best* way to include a Unicode character in a string literal, via its hexadecimal code, using the `\u` numeric prefix:

```java
`"I was happy `\u263A` to see you!";
// I was happy ☺ to see you!
```

To include a literal `` ` `` back-tick by itself (not as an interpolation delimiter) in an interpolation-parsed string, escape it with a second `` ` ``, like this:

```java
`"Here is a single `` back-tick, `name`.";
// Here is a single ` back-tick, Kyle.
```

To both collapse whitespace, as well as allow interpolation, combine the `\` and  `` ` ``, in order, like this:

```java
\`"This is
   one line, written
 by `uppercase(name)`.";
// This is one line, written by KYLE.
```

## Identifiers

In **Foi**, identifiers are case-sensitive, and can be comprised of any of these characters (with no whitespace):

* `A` - `Z`, `a` - `Z`
* `0` - `9`
* `_`

**Note:** There is no restriction on the first character of identifiers, as in some languages; so `3stars` is a valid identifier name. However, an identifier must have at least one non-digit (`0` - `9`) character somewhere in it. Otherwise, it's just a number.

Identifiers can be any length.

Identifiers cannot conflict with keywords: `def`, `defn`, `deft`, `import`, `export`, etc.

## Code Comments

Adding comments to **Foi** code takes two forms, single-line and multi-line:

```java
// this is a single line comment

whatever;   // so is this one

another; /// But...
   this is a block comment, and
   can span as many lines
     as needed.
///
```

The triple-slash `///` comment block can start anywhere on a line, span as many lines as needed (including just a single line), and must end with another triple-slash `///`.

## Imports And Exports

To import a dependency, use the `import` keyword as the value of a top-of-scope `def`:

```java
def Std: import "foi:Std";

Std.log("Hello");               // "Hello"

Std.log(6 + 12);                // 18
```

A module's exports are a Record, and `import` evaluates to that Record -- so the ordinary destructuring forms apply. Pull out specific members:

```java
def < :log >: import "foi:Std";

log("Hello");                   // "Hello"
```

Or capture the whole Record and destructure at the same time:

```java
def < :log, #Std >: import "foi:Std";
```

There are exactly two kinds of specifier.

A **package specifier** looks like `"foi:Std"` -- a package name, a `:`, then a module name within that package. It's a registry name, not a file path; everything after the `:` is the package's business, and may contain `/` without that meaning directory traversal:

```java
def < :parse >: import "graphql:client/parser";
```

`foi` is a reserved package name, and the only one. The language's own packages are modules under it: `foi:Std`, `foi:Test`.

A **relative-path specifier** must start with `./` or `../`, and must carry the `.foi` extension:

```java
def < :myHelper >: import "./utils.foi";
```

A specifier matching neither shape is a compile error. In particular: no bare names, no leaving the `.foi` extension off, no directory or `index` resolution, and no version syntax inside the string.

The specifier is never computed, either -- always a plain string literal, never an expression, never an interpolated string, never a variable holding a string.

----

To export lexical members from a module (no renaming, source and target names match):

```java
export { :login, :logout };
```

To rename lexical exports (e.g., from lexical `login` / `logout` to exported names `doLogin` / `doLogout`):

```java
export { doLogin: login, doLogout: logout };
```

An entry can also reach through an access path. In the concise form, the exported name is the final segment:

```java
export { :config.timeout };            // exported name: `timeout`
export { retries: config.attempts };   // exported name: `retries`
```

`export` is a *definition* statement, alongside `def`, `defn`, and `deft`. It lives in the same top-of-scope definition section they do, freely interleaved with them, and must come before any non-definition statement. It's admitted only at module scope -- there's no exporting from an inner block.

What an `export` entry registers is a **name paired with a lexical reference** -- not a value read at the moment the statement appears. Values arrive later: the whole definition section settles first, and only then is the export Record built from the registered references. So there's no such thing as exporting "too early," and the relative order of a `def` and the `export` naming it doesn't matter:

```java
export { :apiURL };

def apiURL: "https://example.com";
```

What *is* required is that an exported name be constant. A `defn` or `deft` name is constant by construction. A `def` binding qualifies as long as nothing assigns to it with `:=` anywhere in the visible scope chain -- whether or not that assignment would actually run:

```java
def count: 0;

export { :count };          // compile error

count := 1;
```

The error is reported at the `export` entry, and names where the offending assignment sits.

**Note:** An entry carrying an access path (`{ :config.timeout }`) *does* read a value, making it a consuming operation. If its path reaches a `def` declared later in the section, that's a forward reference and needs `Lazy@` (see [Lazy Forward References](#lazy-forward-references)).

Definition sections settle across *all* your modules together, not one module at a time. Every module's definition section runs, then every pending forward reference resolves, then the export Records get built. That's what lets two modules reference each other's bindings without one of them having to go first.

The flip side: if two modules each do something observable in their definition sections -- a `log`, anything with a side effect -- nothing fixes which one you see first. Within a single module, source order holds. Across modules, it doesn't. Don't write code that depends on it.

## Function Calls

The traditional function call-form (e.g., `log("Hello")`) always requires `(    )` around the argument list, and must immediately follow the function name (no whitespace). If there are no arguments to pass, the call looks like `someFn()`.

Inside the argument list, assigning arguments to the function's parameters is done positionally, from left-to-right. To skip an argument/parameter position, simply omit anything (exception optional whitespace) between two successive `,` commas:

```java
myFn(1,,3,,,6);
```

Omitting an argument is the same as specifying `empty` for that argument:

```java
myFn(1,empty,3,empty,empty,6);
```

**Note:** Trailing comma(s) in the argument list are allowed (and ignored).

### Invoking Operators As Functions

When you need to specify three or more operands (aka, "n-ary") to an operator, you need to invoke the operator as a function (herein referred to as *operator-as-function* form). To do so, wrap the operator in `( )` parentheses (no whitespace within), then invoke with arguments like a normal function:

```java
(+)(1,2,3,4,5);         // 15
```

It's nice to only need to list the operator once instead of 4 times!

Many operators in **Foi** are n-ary, such as the `+` operator, `+>` flow (composition) operator, and `?<=>` range-check operator.

The `+` operator is a single symbol, so the preceding example yields a longer expression than just repeating the `+` operator between each value, which may seem disfavorable.

However, other operators are comprised of two or more symbols, so the length of the operator-as-function form will likely end up shorter depending on how many arguments are provided.

Also, some operators may result in a change of value-type from the operand(s) to the result. In those cases, you cannot simply combine multiple infix operator usages like we did with `+`.

For example, say you wanted to test 3 variables as all being equal to each other. The `?=` operator used with two operands (left and right), requires multiple expressions, and combining their results with the logical-AND `?and` operator:

```java
(x ?= y) ?and (y ?= z) ?and (x ?= z);
```

**Note:** The `?=` equality comparison may not be transitive, depending on the types being compared, hence why we included the `x ?= z` check for good measure.

But since the `?=` operator is also n-ary, we can invoke it as a function and provide it 3 or more arguments, resulting in a much shorter/nicer-to-read expression:

```java
(?=)(x, y, z);
```

It should be clear how much more preferable the n-ary operator-as-function form can be!

If you only want to capture (or pass) a function reference for an operator, without invoking it:

```java
def add: (+);
def subtract: (-);

add(2,5);           // 7
subtract(8,5);      // 3
```

### Apply (aka Spread) Arguments

Say we have a list of values (a Tuple, as we'll see later) called `numbers`, and we want to "spread them out" as arguments to an operator/function. We can use the `...` operator:

```java
add(...numbers);
add(0, ...numbers, 1000);
(+)(...numbers);
(+)(0, ...numbers, 1000);
```

OK, that's useful. But what about modifying an operator/function to automatically accept its inputs as a list?

```java
def addNumsList: (...)(+);
addNumsList(numbers);
```

Since `...` is an operator, when passed an operator/function like `+`, instead of a Tuple, it produces a new function (above, `addNumsList()`) that will expect a single (Tuple) argument that's then *spread out* to the underlying operator/function when invoked.

**NOTE:** The inverse lift of spread (via `(...')`) -- gathering all positionally passed arguments into a Tuple -- will be discussed shortly.

### Reversing Argument Order

Some operators like `+` are commutative, so the operand/argument order doesn't matter (e.g., `3 + 4` is the same as `4 + 3`). But for most functions and operators, like `-`, arguments are not commutative, so the order matters.

It happens often, especially when spreading a list of arguments, that the expected order is the opposite of what we want. Instead of reversing the order of the Tuple list of arguments, you can reverse the order that a function will apply its supplied arguments.

To do so, use the postfix (immediately after!) `'` prime operator on the function/operator reference:

```java
myFunc'(...nums);               // aka, myFunc(...numsReversed)

(-)'(1,6);                      // 5 :: 6 - 1
```

Since `'` is an operator, you can also use invoke it as a function, passing to it another function or operator:

```java
def subtrRev: (')(-);

subtrRev(1,6);                  // 5
```

Yes, with `(')(-)`, we just applied one operator against another operator, producing a new function.

Since this operation will be extremely common, a special sugar short-hand is available. Inside a `( )` operator-as-function reference, the `'` prime operator may appear immediately after (no whitespace) the operator it's modifying:

```java
(-')(1,6);                      // 5
```

This short-hand form `(-')` should be preferred over the more verbose `(')(-)` form, for readability sake, wherever practical. Thus these are all equivalent, but the final one is generally preferable:

```java
(')(-)(1,6);                    // 5
(-)'(1,6);                      // 5
(-')(1,6);                      // 5
```

### Gathering Arguments

The `'` prime operator was just illustrated as "reversing argument order". But semantically, it's actually inversing the *operation* along its *natural/semantic* axis. For many functions and operators, that indeed means reversing argument order.

An illustration of *inverse* that is NOT about *argument order* can be seen with the `(...')` operator combination, otherwise known as the "gather operator".

Consider an `allFlags(..)` function, that expects a Tuple list (`perms`) of boolean permission flags:

```java
defn allFlags(perms) ^(?and)(...perms);

allFlags(< true, true, false >);    // false
allFlags(< true, true, true >);     // true
```

Next, we'll define a more specific function like `canPublish(..)` manually:

```java
defn canPublish(isVerified,ownsDocument,hasQuota)
    ^allFlags(< isVerified, ownsDocument, hasQuota >);

// or (with "gather parameter" syntax, as illustrated later
// in the guide):
//
// defn canPublish(*flags) ^allFlags(flags);

canPublish(true,true,false);    // false
canPublish(true,true,true);     // true
```

See how we're passing the boolean values positionally, and they're being manually "gathered" into the single Tuple list to pass to `allFlags(..)`?

We have another (point-free style) option for defining `canPublish(..)`, with `(...')`:

```java
def canPublish: (...')(allFlags);

canPublish(true,true,false);    // false
canPublish(true,true,true);     // true
```

The `...'` operator-combo here is lifting a Tuple-shaped function (`allFlags(..)`) to be a positional-argument-shaped function. That's the *inverse* of `...` spread, which lifts a positional-argument-shaped function to be a Tuple-shaped function.

### Partial Application

It's common in functional programming to produce more specialized functions by applying only some inputs to a more generalized (higher-arity) function; the result is a another function that expects the subsequent arguments.

This is referred to as partial application.

To signify a partial application, use `|    |` (pipes) to delimit the arguments list, instead of the traditional `(    )` parentheses:

```java
def add6: (+)|6|;

add6(12);                       // 18
```

Notice the intentional visual semantic of the `| |` pipes call-form compared to traditional `( )` call-form: the pipes are still *open*, meaning they're still expecting more arguments (the rest of the application); by contrast, the `( )` is *closed* so all arguments are assumed to already be present and application (function call) is performed immediately.

Regardless of the arity (expected number of arguments) of the function or operator, and no matter how many arguments you pass, the `|    |` will always *partially apply*, meaning the arguments are remembered for later, but the function is not yet invoked:

```java
def add37: (+)|6,12,19|;

add37(5);                       // 42
```

Partial application is also useful when you need to skip specific positional arguments (and thus provide them on the final invocation):

```java
defn xyz(x,y,z)^log(`"x: `x`, y: `y`, z: `z`");

xyz(2,4,6);                     // x: 2, y: 4, z: 6

def fn: xyz|3,,7|;

fn(5);                          // x: 3, y: 5, z: 7
```

Reversing argument order with the `'` prime operator combines with the partial application form, as expected:

```java
def sub1: (-')|1|;

sub1(6);                        // 5 :: 6 - 1
```

The `...` spread operator is allowed inside the partial application arguments list:

```java
defn xyz(x,y,z)^log(`"x: `x`, y: `y`, z: `z`");

def nums: < 9, 8, 7 >;
def fn: xyz'|...nums|;

fn();                           // x: 7, y: 8, z: 9
```

### Currying Arguments

A close *cousin* of partial-application -- also used primarily for function specialization -- is referred to as *currying*. This shape of function is appropriate when multiple inputs must be passed to invoke it, but when each input will be provided in a different call:

```java
defn buildURL(origin,path,query) ^`"`origin``path`?`query`";

def buildURLParts: buildURL/\;
```

Here, the `buildURLParts` value is now a function that expects each individual input (`origin`, `path`, and `query`) as a separate call. Each call returns an intermediate unary function expecting the next input. Once all expected inputs are provided, the original underlying function is invoked:

```java
buildURLParts("https://my.site")("/api/find")("name=getify");
// https://my.site/api/find?name=getify

def mySiteURL: buildURLParts("https://my.site");
def myFindAPI: mySiteURL("/api/find");
myFindAPI("name=getify");
// https://my.site/api/find?name=getify
```

As you can see, each individual argument naturally *specializes* the preceding generalized function, which reflect in this sample with more specialized names.

Currying can be done at the call-site or as operator-as-function:

```java
def buildURLParts: buildURL/\;

// or:
def buildURLParts: (/\)(buildURL);
```

#### Uncurrying

The inverse of currying is uncurrying (via that `\/` operator), which lowers a curried function back to a single function expecting all inputs as positional arguments in a single call:

```java
// original:
buildURL("https://my.site","/api/find","name=getify");
// https://my.site/api/find?name=getify

def alsoBuildURL: buildURLParts\/;
alsoBuildURL("https://my.site","/api/find","name=getify");
// https://my.site/api/find?name=getify
```

`buildURLParts(..)` has previously been curried, so `\/` uncurries it, making it a more normal looking single function call.

Notice the intentional visual semantic of these (admittedly, unusually shaped) operators:

* `/\` is known as *the mountain*, and hints at the operation (currying) which modifies the function so that its parameters are lifted off the ground and stacked up in a pile like a mountain (curried, one per call), to match the shape of arguments you'd pass in (e.g., `(x)(y)(z)`).

* `\/` is known as *the valley*, and hints at the inverse operation (uncurrying) -- and it also looks a bit like a "u"'ish shape -- because it modifies a function's shape by lowering its parameters from a curried stack, flattening down to match a single list of arguments all at once at the call-site (e.g., `(x,y,z)`).

#### Primed Inverses

Each operator is the *inverse* of the other, and as such, you can *technically* express one as the `'` primed version of the other:

```java
def uncurry: (/\');
def curry: (\/');
```

See how the operators are reversed here, but the `'` is what's inverting them?

**TIP:** While you can always do this (for language coherency/consistency), it's strongly recommended you use the proper `/\` or `\/` operator form.

### Named Arguments

To override positional argument->parameter binding at a function call-site, an argument can specify which parameter name it corresponds to (in any order):

```java
defn add(x:? 0, y) ^x + y;

add(x:3, y:4);                  // 7
add(y:5);                       // 5

add|x:4|(y:5);                  // 9
```

**Warning:** Be careful in relying on this capability, as it creates an additional refactoring dependency burden between the function definition and its call-site(s). If you change the name of a parameter in a function definition, any named-argument references at all call-sites must be updated.

This code style means that function parameter naming has readability implications at call-sites. If you are using this code style at call-sites, consider "standardizing" certain generic variable naming conventions in your function definitions, to make using such functions predictable.

For example:

* a general value parameter might always be named `v` or `val`
* a function-value parameter might always be named `cb` or `fn`
* a list/array parameter might always be named `list`, `arr`, or even `vs` (i.e., the plural of `v`)

## Defining Variables

To define variables, use the `def` keyword (not an operator/function):

```java
def age: 42;
```

All definitions need a value initialization, but you can use the `empty` value if there's no other value to specify.

`def` definitions do not hoist; they *must not* be preceded in any scope (module, function, or block) by any other non-definition (besides `def`, `deft`, and `defn`) statements.

To reassign a variable:

```java
def age: 41;

// later
age := 42;
```

Unlike `def` definitions, `:=` re-assignments are allowed anywhere in the scope after the associated `def` definition.

Multiple re-assignments (of the same value) can also be chained:

```java
x := y := z := 0;
```

`def` definitions attach to the nearest enclosing scope, whether that be module, function, or block. A block-scoped variable definition is thus:

```java
{
    def tmp: 42;
    tmp := 43;
}
```

However, since `def` definitions must appear at the top of their respective scopes, and there may be multiple such definitions in a block, the definitions-block form should be preferred for readability sake:

```java
def (tmp: 42) {
    tmp := 43;
};
```

Moreover, this definitions-block form is allowed anywhere in its enclosing scope, so it's more flexible than a non-block `def` declaration.

### Block-Definitions Clause

In addition to the definitions-block form just shown, several other expressions in **Foi** allow a `{    }` block to be declared as part of the larger expression. For syntactic convenience, many of these expressions' blocks can be prefaced by the optional `(   )` block-definitions clause:

* A [guard block](#guard-expressions) with block-definitions clause:

    ```java
    // if x > y, swap them
    // (tmp is block-scoped)
    ?[x ?> y]: (tmp: x) {
        x := y;
        y := tmp;
    };
    ```

* A [pattern matching clause block](#pattern-matching) with block-definitions clause:

    ```java
    ?{
        // x is odd?
        // (tmp is block-scoped to the clause)
        ?[mod(x,2) ?= 1]: (tmp) {
            tmp := (x * 3) + 1;
            ?[tmp ?> 100]: tmp := 100;
            myFn(tmp)
        };

        // x is non-zero (and even)?
        ?[x != 0]: myFn(x);

        // otherwise, x must be zero,
        // so skip calling function and
        // default to fixed value 1
        ?: 1
    };
    ```

* A [loop iteration block](#loops) with block-definitions clause:

    ```java
    0..3 ~each (v) {
        log(`"v: `v`");
    };
    ```

These host expressions split into two kinds based on whether they supply an *implicit input* to the block:

**Without an implicit input** (guard expression consequents, pattern matching consequents, top-level `def (...) {...}` blocks): every block-definition needs an explicit initializer, except for the identifier-only form (`(tmp)`, which defaults to `: empty`). A destructure target *must* have its `: source` tail; there's no implicit value to bind against.

**With an implicit input** (loop iteration blocks, comprehensions like `~each`, `~map`, `~fold`, etc., pipeline blocks i.e., `#>`, pipeline-bodied function bodies): the surrounding expression flows one or more values into the block (the current iteration element, the pipeline topic, the function's argument, etc.). Identifier definitions may omit their initializer and take their value from that implicit input. Destructure targets may also omit their `: source` tail and destructure the implicit input directly:

```java
def people: < < name: "Alice", title: "Engineer" > >;

people ~each (< :name, :title >) {
    log(`"`name` has role: `title`");
};
```

Here the comprehension supplies each `people` element as the implicit input, and the destructure clause `< :name, :title >` extracts its fields without needing an explicit source. The earlier loop example -- `0..3 ~each (v) { ... }` -- is the simpler identifier-only case: `v` has no initializer, so it takes each loop value as its implicit input.

**Note:** Function body definitions also use a `{    }` block, but cannot be prefaced by a block-definitions clause; parameters serve the equivalent purpose. See [Defining Functions](#defining-functions).

### Destructured Definitions

When defining a variable where the assignment is intended to step into (aka, "destructure") a [Record/Tuple value](#records-and-tuples)'s contents, we can use a dedicated destructuring form:

```java
def <
    :items.0.price,
    firstItem: items.0,
    #order
>: getOrder(123);

price;          // 29.97
firstItem;      // < price: 29.97, label: ... >
order;          // < id: 123, items: < < price: 29.97, ... >
```

**TIP:** Notice each entry in the destructure clause is just an access path. JS readers may be used to a different model -- nested patterns that mirror the source's shape (e.g., `const { items: [{ price }] } = order;`). **Foi destructuring is path-rooted, not structure-mirroring.** Each entry says "give me the value at *this path* from the source, and bind it to *this name*." No nested patterns, no recursion -- just paths. There's no depth tax: `:items.0.price` is no harder to write or read than `:price`. It's the same access language you'd use anywhere else, just rooted at a binding name.

The `:items.0.price` syntax form implicitly assumes a target variable name from the final source property name (`price`) above; for this syntax to be valid, the source property name must be fixed (cannot be a dynamic expression) and a valid identifier (cannot be a number like `0`).

If you need to "rename" the target variable -- for example, if the source property name isn't fixed or a suitable identifier -- the target name (`firstItem` above) may be specified before the `:`, as:

```java
def <
    itemPrice :items.0.price,
    // ..
>: getOrder(123);
```

To compute the top-level source property name with a dynamic expression:

```java
def < lastItem: [size(items)-1] >: items;
```

This form is *rename-only* -- the target name must be given explicitly. Why? Because `[expr]` has no terminal identifier for the concise form to derive a name from. The expression evaluates to an index or key, but a key like `7` or `"price"` isn't usable as a binding name on its own; you have to explicitly declare what to call it.

Any non-capture entry (e.g., `#order`) can carry an optional `:? default` expression, which fires when the entry's extraction resolves to `empty`:

```java
def <
    :name,
    :count :? 0,
    :status :? "unknown",
    #order
>: getOrder(123);
```

**NOTE:** The `:?` sigil can have optional whitespace on either side, as you see fit stylistically; all of these are accepted: `:count:?0`, `:count :? 0`, `:count:? 0`, and `:count :?0`.

If the source has no `count` slot -- or `count` is present with the value `empty` -- the entry binds `count` to `0`. If `count` is present with a non-empty value, the default is not evaluated. Defaults are *lazy*; they're only invoked when the extraction is empty.

The default expression can reference names bound by earlier entries in the same destructure (entries dispatch in source order, so earlier bindings are visible):

```java
def <
    :baseUrl,
    :apiPath :? baseUrl + "/api"
>: config;
```

Renamed and computed-source forms also allow the default expression form:

```java
def <
    firstItem: items.0 :? <>,
    lastKey: [size(keys) - 1] :? "default-key"
>: source;
```

The capture form (`#name`) does not admit a default. Capture reads the entire source value, and a destructure against an empty source errors before per-entry procedures proceed -- so a capture-with-default is unreachable.

This default expression form works everywhere destructuring appears -- function parameters, block-definition clauses, pattern-match clauses -- not just in top-level `def` statements. For example, as a function parameter:

```java
defn greet(< :name :? "friend", :greeting :? "hello" >)
    ^greeting + ", " + name + "!";

greet(< name: "Kyle" >);              // "hello, Kyle!"
greet(< greeting: "hi" >);            // "hi, friend!"
greet(<>);                            // "hello, friend!"
```

`[expr]` can also be used as the *start* of a longer access path, not just the terminal:

```java
def < deepest: [k].sub.0 >: items;
// evaluates k -> picks items[k] -> reads .sub -> reads .0
```

These various destructuring forms are also allowed in a block-definitions clause:

```java
def (< :items.0.price >: getOrder(123)) {
    price;          // 29.97
};
```

**Tuple destructuring.** The forms above read entries by name: the source is a Record whose slots you want to pull out by identifier. When the source is a Tuple (or a Record whose entries you want positionally), Foi provides a *Tuple form* of destructuring that reads by position:

```java
def < first, second, third >: coords;

first;      // coords.0
second;     // coords.1
third;      // coords.2
```

Bare identifiers (no `:` prefix, no `:` suffix) mark *positional* entries. Each name binds the value at its list-position in the source: `first` gets index `0`, `second` gets `1`, `third` gets `2`. Coming from JS, this is the Foi equivalent of `const [first, second, third] = coords;`.

Destructuring forms don't mix: a single target is either all Record-form entries or all Tuple-form entries. Combinations like `< :name, position >` or `< position, name: alt >` are rejected. If your source is a Record whose entries you want positionally, use their integer keys in Record form (e.g., `< first: [0], second: [1] >`) instead.

**Skip slots.** Not every position needs a binding. An empty comma position consumes a source position without introducing a name:

```java
def < , second, third >: coords;    // skips 0; second binds coords.1
def < first, , third >: coords;     // skips 1
def < , , third >: coords;          // third binds coords.2
```

The comma rules mirror Tuple *literal* construction from [Structured Values](#records-and-tuples): leading and interior commas open positions; a single trailing comma is a permissive terminator. So `def < a, b, >: src;` binds two entries, not three. Trailing empty positions after all bindings are no-ops, as they neither bind variables nor *skip* any position.

**Capture is position-neutral.** The `#name` capture works in the Tuple form too, binding the whole source without consuming a position:

```java
def < a, #whole, b >: coords;
// a binds coords.0, whole binds coords, b binds coords.1
```

Wherever `#whole` sits in the entry list, positional entries advance around it as if it weren't there. Multiple captures are permitted; they all alias the same source value.

**Per-entry defaults.** Positional entries admit the same `:?` default form as Record entries:

```java
def < x :? 0, y :? 0, z :? 0 >: point;
```

If a position in the source resolves to `empty` (missing or explicitly `empty`), the default expression evaluates and its value binds instead.

**Function parameters.** Both destructuring modes work everywhere destructuring appears: `def` statements, function parameters, block-definition clauses, pattern-match clauses. A common use for the Tuple form is picking apart a paired value:

```java
defn translateXY(
    < x1 :? 0, y1 :? 0 > :? <>,
    < x2 :? 0, y2 :? 0 > :? <>
)
    ^< x1 + x2, y1 + y2 >;

translateXY(< 1, 2 >, < 3, 4 >);      // < 4, 6 >
```

Two Tuple parameters, each destructured positionally.

### Lazy Forward References

Sometimes you want to define a value where one of its parts references the value itself, or another binding in the same `def` section that comes later. Consider:

```java
def life: <
    meaning: defn(x, y) ^x + y,
    answer: life.meaning(2, 40)         // `life` not yet bound!
>;
```

At the moment the record literal is being constructed, the `life` binding doesn't exist yet -- the record itself is what `life` will refer to *once construction completes*. So `life.meaning(2, 40)` can't resolve.

Without help, the *main* workaround is to construct an incomplete record, then reassign the binding to a corrected version:

```java
def life: <
    meaning: defn(x, y) ^x + y
>;
life := <
    &life,
    answer: life.meaning(2, 40)
>;
```

That works, but at significant cost. We've created an intermediate record that exists only as scaffolding. The `:=` reassignment makes `life` non-constant, which means any enclosing function that references `life` would need to declare it in a `:over (life)` clause (see [Function Overs](#function-overs)). And local reasoning about `life` weakens, because the name now refers to different values at different points in the scope.

**NOTE:** The *other* workaround would have been to lift the `defn` function outside the structure, so that it can both be included in the structure AND used to define parts of it. The downside of course is that now an otherwise unnecessary named binding has leaked to the enclosing scope around the structure.

None of that reflects what we actually wanted: a single value with a self-referential field.

The `Lazy@` construct expresses this directly:

```java
def life: <
    meaning: defn(x, y) ^x + y,
    answer: Lazy@ life.meaning(2, 40)
>;

life.answer;            // 42
```

The `Lazy@ expr` form *defers* the resolution of any unresolved identifiers in `expr` until the surrounding scope's set of `def`s completes. The binding is still defined exactly once. No intermediate value. No reassignability. No `:over` annotation. No scope pollution.

This construct exists *precisely* so that ordinary self-referential and mutually-referential value construction doesn't require mutability-flavored workarounds.

----

Other motivating examples...

**Mutual reference between sibling bindings:**

```java
def alice: < name: "Alice", friends: < Lazy@ bob > >;
def bob:   < name: "Bob",   friends: < alice > >;

alice.friends;          // < bob >
bob.friends;            // < alice >
```

Here `alice` references `bob` (which is defined *after* `alice`), so `Lazy@` defers it. The reverse direction (`bob` references `alice`) needs no `Lazy@`, because by the time `bob` is being defined, `alice` is already bound.

**Cyclic structure (state machine):**

```java
def red:    < color: "red",    next: Lazy@ green >;
def green:  < color: "green",  next: Lazy@ yellow >;
def yellow: < color: "yellow", next: red >;

red.next.color;        // "green"
green.next.color;      // "yellow"
yellow.next.color;     // "red"
```

This example shows a genuine cycle in the value graph -- which would be impossible/impractical without `Lazy@`, since each definition would have to reference the next one before it existed.

**Mixed backward and forward references:**

```java
def base: 100;
def offset: Lazy@ base + delta;  // `base` (backward); `delta` (forward)
def delta: 7;

offset;                 // 107
```

`Lazy@` resolves what it can immediately (`base` is already bound) and defers what it can't (`delta` arrives later).

#### Scope Locality

A `Lazy@` participates only in the set of `def`s of its directly enclosing scope. The deferral mechanism doesn't reach into other scopes -- a thunk that escapes its construction scope while still unresolved cannot be resolved from elsewhere.

```java
def seed: Lazy@ 7 * scale;
defn compute() ^seed * 2;
def answer: compute();      // ERROR: `seed` not resolved yet
def scale: 3;
```

When `def answer: compute()` runs, `scale` hasn't been defined yet, so `seed` is still lazy deferred. The `compute()` body tries to resolve `seed * 2` from inside its own scope, but `seed` was constructed in a different scope; that's not allowed.

The fix is either to reorder the bindings so the `Lazy@` resolves before the cross-scope use:

```java
def seed: Lazy@ 7 * scale;
defn compute() ^seed * 2;
def scale: 3;               // `seed` resolves here (`21`)
def answer: compute();      // 42 -- `seed` is just a regular value now
```

...or to restructure so the lazy deferral only gets consumed within its immediate enclosing scope.

This restriction reflects a broader **Foi** commitment: deferral doesn't quietly suspend executing functions (no deep continuations). The `def` section is the narrow, well-defined area of effect, and `Lazy@` operates within it.

#### Automatic Resolution + Errors

All `Lazy@` reference deferrals in a scope are resolved automatically with the completion of the last `def` in that scope.

If any reference deferral cannot be statically resolved, the compiler raises an error.

#### The `%` Effector Operator With `Lazy@`

The `%` operator is the effector; like `@`, it's a special paren-free call operator (but specifically dispatching to an effect-evaluation hook on the value, if any). You'll see it used heavily with explicitly-deferred monadic types like [IO](#io-monad) and `State`.

`Lazy@` references don't expose such a hook; as explained in the previous section, resolution of lazy deferred references is handled entirely internally and automatically, not via any explicit invocation. So `x%` on a `Lazy@`-bound reference behaves exactly the same as a bare `x` read; `%` silently acts as a no-op.

`%` may still be useful stylistically as a visual marker on a deferred reference, signalling "this is something that was lazily deferred."

```java
def x: Lazy@ z + 1;
def y: x% + 1;        // same as `x + y`
def z: 10;

x;      // 11
y;      // 12
z;      // 10
```

`x%` has no operational effect, but it communicates intent more explicitly to the reader.

## Boolean Logic

The `true` and `false` boolean values are used primarily for decision making. Accordingly, non-negated, boolean-returning operators, aka logical operators, begin with the `?` character (to signal asking a question to make a decision).

To combine two or more boolean values with logical-AND (`?and`):

```java
def isValid: true;
def isComplete: true;
def isSuccess: false;

isValid ?and isComplete;                    // true
isValid ?and isComplete ?and isSuccess;     // false

(?and)(isValid, isComplete, isSuccess);     // false
```

And for logical-OR (`?or`):

```java
def isValid: true;
def isComplete: true;
def isSuccess: false;

isValid ?or isComplete ?or isSuccess;       // true

(?or)(isValid, isComplete, isSuccess);      // true
```

**Note:** As you can see, the `?and` and `?or` operators are n-ary, meaning they can take 2 or more arguments.

Any `?`-prefixed logical boolean operator can be flipped/negated by swapping the `?` character with `!` in the operator. For example, `!and` is *NAND* (not-and) and `!or` is *NOR* (not-or):

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

We'll see more `?`-prefixed, boolean-returning operators in the next section, all of which can also be negated by swapping `?` for `!`.

## Equality And Comparison

The `?=` operator checks for equality:

```java
def x: 42;
def y: 42;
def z: 100;

x ?= 42;                    // true

(?=)(x, y, z);              // false
```

**Note:** `?=` is another n-ary operator in the operator-as-function form. Keep in mind, equality comparison in **Foi** is not necessarily transitive.

The `empty` value semantically means *absence of a value*. As such, checking for equality with `empty` is somewhat of a confusing construct. It's valid to do so (`x ?= empty`), but a dedicated `?empty` prefix boolean operator is provided to reduce confusion:

```java
def x: 42;
def y: empty;
def z: empty;

x ?= empty;                 // false
y ?= empty;                 // true  -- but a bit confusing!

?empty x;                   // false
?empty y;                   // true  -- clearer!

(?empty)(x, y, z);          // false
(?empty)(y, z);             // true
```

----

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

**Note:** These four operators are also n-ary operators. They compare the first operand against all other operands/inputs. For example, `(?<)(x, y, z)` is the equivalent of `(x ?< y) ?and (x ?< z)`, but *does not* compare `y ?< z`.

A very common task is to check if a value is in a range between two other values:

```java
def x: 100;

(x ?> 0) ?and (x ?< 500);   // true
```

However, this can be done more idiomatically with the n-ary range-check operators, `?<>` (non-inclusive) and `?<=>` (inclusive):

```java
def x: 100;

(?<>)( 0,   x, 500);     // true
(?<=>)(100, x, 100);     // true
```

**Note:** Because these two operators have an arity of (exactly) 3, they cannot be used in the typical infix expression form, which would only allow two operands (left and right).

----

As mentioned in the previous section, all these `?`-prefixed comparison operators can also be flipped/negated by swapping the `?` with `!`:

```java
def x: 42;
def y: 100;
def z: empty;

x ?= 42;                // true
x != 42;                // false

?empty z;               // true
!empty z;               // false

x ?> y;                 // false
x !> y;                 // true
x ?>= y;                // false
x !>= y;                // true

x ?< y;                 // true
x !< y;                 // false
x ?<= y;                // true
x !<= y;                // false

(?<>)( 40,  x, 50  );   // true
(!<>)( 40,  x, 50  );   // false
(?<=>)(100, y, 100 );   // true
(!<=>)(100, y, 100 );   // false
```

## Pattern Matching

To make decisions (with booleans!), use pattern matching. There are two forms:

1. Dependent: each pattern is matched against (dependent on) a single topic; delimited with an opening of `?(    ){`, and closed with `}`.

2. Independent: each pattern has its own independent topic; delimited with an opening of `?{`, and closed with `}`.

Each pattern clause is defined by `?[    ]: consq`, where the pattern is defined inside the `[    ]`. A pattern can be negated as `![    ]`. The pattern match clause's consequent (`consq`) can either be a single expression, or a `{   }` block; either way, it's only evaluated if the pattern is matched via the conditional.

Let's examine each pattern matching form separately, starting with dependent pattern matching. The topic of the match is any arbitrary expression, defined in the `?(    ){` clause.

Consider:

```java
def myName: "Kyle";

?(myName){
    ?["Kyle"]: log("Hello!");
    !["Kyle"]: log("Goodbye!")
}
// Hello!
```

In this example, the topic is the `myName` variable, which is evaluated once. Each pattern clause is evaluated, in order, and compared for equality with the topic. For the first clause whose pattern is matched, its consequent is evaluated and the result returned for the overall pattern match expression.

Dependent pattern matching expressions *should be* determinate, in that all possible conditional branches are defined. The result of a pattern matching expression is thus the consequent expression of whichever conditional clause was matched:

```java
def myName: "Kyle";

def greeting: ?(myName){
    ?["Kyle"]: "Hello!";
    !["Kyle"]: "Goodbye!"
};

greeting;               // "Hello!"
```

However, if no pattern matches, the default result of the expression is an `empty`.

**Note:** You can configure **Foi** to issue a warning notice in such a case.

To explicitly define a default pattern -- like an "else" clause, that matches if nothing else previously matched -- use `?:` as the last clause in the pattern matching expression:

```java
def myName: "Kyle";

def greeting: ?(myName){
    ?["Kyle"]: "Hello!";
    ?: "Goodbye!"
};

greeting;               // "Hello!"
```

The `?:` else-clause can also be abbreviated as `:` if preferred. More on that in a bit.

**Note:** Comparing this example to the previous one, `?:` is equivalent to the `!["Kyle"]` pattern. Readability preferences may dictate either style, depending on the circumstances.

A dependent style pattern can include a `,` comma separated list of multiple values, any of which may match the topic:

```java
def myName: "Kyle";

def greeting: ?(myName){
    ?["Kyle","Fred"]: "Hello!";
    ?: "Goodbye!"
};

greeting;               // "Hello!"
```

It may also be useful to access the topic of a pattern matching expression inside its clause(s); the topic is bound to the `#` symbol:

```java
def myName: "Kyle";

def greeting: ?(myName){
    ?["Kyle"]: `"Hello `#`!";
    ?: "Goodbye!"
};

greeting;               // "Hello Kyle!"
```

Dependent pattern matching should only be used if the patterns only need equality-comparison of one or more discrete value(s) against the topic.

----

For more complex boolean-logic matching patterns, the independent pattern matching form is appropriate. Independent pattern matching has no topic, and thus begins with a `?{` instead of a `?(    ){`.

In this form, each clause matches only if the pattern is a conditional that evaluates to `true`. You could thus mentally model `?{` as if it was shorthand for `?(true){`:

```java
def myName: "Kyle";

def greeting: ?{
    ?[myName ?= "Kyle"]: "Hello!";
    ![myName ?= "Kyle"]: "Goodbye!"
};

greeting;               // "Hello!"
```

**Note:** The pattern-match conditional `![myName ?= "Kyle"]` is equivalent to `?[myName != "Kyle"]`. Readability preferences may dictate either style, depending on the circumstances.

Just as with dependent pattern matching, it's preferable for the overall independent pattern matching expression to be determinate, in that all conditional branches are covered. Again, to define a default (final) clause, `?:` (or abbreviated `:`) may be used:

```java
def myName: "Kyle";

def greeting: ?{
    ?[myName ?= "Kyle"]: "Hello!";
    ?: "Goodbye!"
};

greeting;               // "Hello!"
```

**Note:** Again comparing this example to the previous one, `?:` is equivalent to the previous snippet's `![myName ?= "Kyle"]` conditional, or even `?[myName != "Kyle"]`. Moreover, `?:` is also equivalent to `?[true]`, which clearly would *always match*. Readability preferences may dictate any of those style options, depending on the circumstances, but generally the shorter `?:` form is most idiomatic.

----

Pattern-matching conditional clauses may optionally skip the leading `?` type-specifier, for visual brevity, if you so choose:

```java
?{
    [isLoggedIn()]: showDashboard();
    [isRegistered()]: showLogin();
    : showRegistration()
};
```

Here, the two `[ .. ]: ..` clauses skip the leading type-signifier (a `?` is assumed). However, the `!` type signifier is never assumed, and therefore must be explicitly stated for clauses. As mentioned earlier, the `:` by itself on the third line illustrates an abbreviated `?:` else-clause.

In cases where both affirmative and negative clauses are present, it may be desirable (for visual consistency) to specify both the `?` and `!` signifiers on the respective clauses, rather than only the `!` being present and the `?` being assumed. For example:

```java
// style 1
?{
     [isLoggedIn()]: showDashboard();
    ![isRegistered()]: showRegistration()
};

// style 2
?{
    ?[isLoggedIn()]: showDashboard();
    ![isRegistered()]: showRegistration();
}
```

While *style 1* above may be preferable (for brevity) to some, *style 2* may be seen as more consistent for readability sake. Use your best judgement.

### Guard Expressions

When an independent pattern matching expression would only have one clause, the clause can be specified standalone, as a *guard* expression.

For example:

```java
def myName: "Kyle";

// full pattern matching expression:
?{
    [!empty myName]: printGreeting(myName)
}

// standalone guard expression:
?[!empty myName]: printGreeting(myName);

// equivalent, if you prefer:
![?empty myName]: printGreeting(myName);
```

The leading `?` is required on standalone guard expressions, unlike the optional abbreviated form in pattern matching.

## Records And Tuples

Records are immutable structured values, delimited by `<    >`. Each entry is either *named* (`first: "Kyle"`) or *positional* (a bare value like `4`); positional entries get automatic numeric indices in source order (`0`-based).

A Tuple is a Record where every entry is positional -- no named entries. Tuples and Records share a single literal syntax (`< ... >`) and most operations; the distinction is just whether names are present.

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

**NOTE:** Simple values and expressions -- including primitives/natives, Records/Tuples literals, identifiers, property accesses, function calls, unary boolean operators (`?x`, `!x`, `?empty x`), and operator-as-function forms (`(+)`, `(.)`, `(.<a,b>)`) -- may appear in Record and Tuple literals as-is. But more complex expressions -- binary operations like `a + b`, `defn` function expressions, pattern match expressions, etc -- must be parenthesized (e.g., `< method: (defn()^42) >`) to avoid various syntactic ambiguities.

The empty form `< >` qualifies as both an empty Tuple AND an empty Record -- it functions as either in any context, since spreading it contributes nothing and picking from it yields the empty structure back.

Above, Record/Tuple fields are accessed with `.` operator, whether numeric or lexical-identifier. `[ ... ]` field access syntax evaluates field-name expressions (including strings that may include non-identifier characters).

Tuples (and Records with numerically-indexed positions) also support negative-index access with `.-N`, counting back from the end: `.-1` is the last positional entry, `.-2` the second-to-last, and so on.

```java
def numbers: < 4, 5, 6 >;
numbers.-1;                     // 6
numbers.-2;                     // 5
```

**Note:** The negative-index form only works with the dotted access (`.-1`), not bracketed (`[-1]`). Brackets do a literal key lookup, and since positional indices are non-negative, `numbers[-1]` returns `empty`.

Since `.` and `[]` are both access operators, Record/Tuple field access can be performed via their operator-as-function forms `(.)` and `([])`. Both evaluate the second argument as an expression to get the access key, but they diverge on negative integer indices: `(.)` counts from the end (matching the dotted form `.-N`), while `([])` does a literal key lookup (matching the bracketed form `[N]`).

```java
def idx: 2;
def prop: "last";

def numbers: < 4, 5, 6 >;

(.)(numbers, 1);                // 5
(.)(numbers, idx);              // 6
(.)(numbers, -2);               // 5

([])(numbers, 1);               // 5
([])(numbers, -1);              // empty (literal "-1" key not found)

def person: < first: "Kyle", last: "Simpson" >;

(.)(person, "first");           // "Kyle"
(.)(person, prop);              // "Simpson"
```

Strings are just syntax sugar for Tuples of characters. Once defined, a string and a Tuple of characters will behave the same.

```java
def chars: < "H", "e", "l", "l", "o" >;
def str: "Hello";

chars.1;                    // "e"
str.1;                      // "e"
```

To determine the length of a string (or a Tuple), or the count of fields in a Record, use the `size()` function:

```java
def < :size >: import "foi:Std";

size("Hello");              // 5
size(< "O", "K" >);         // 2
size(< a: 1 >);             // 1
```

If the desired index or field name is held in a variable, you can compute the field-name with an expression, by prefixing with the `%` sigil:

```java
def idx: 3;
def nums: < 5, 10, 15, %idx: 20, 25 >;
// < 5, 10, 15, 20, 25 >

def field: "first";
def person: < %field: "Kyle", last: "Simpson" >;
// < first: "Kyle", last: "Simpson" >
```

This also works with a `%`-prefixed string literal as the field name -- field names can thus contain arbitrary characters (like whitespace!):

```java
def person: < name: "Kyle Simpson", %"favorite number": 42 >;

person["favorite number"];      // 42
```

When defining a Record and the field name matches the variable holding the value, this concise syntax is allowed:

```java
def first: "Kyle";
def last: "Simpson";

def person: < :first, :last >;

// instead of:
def person: < first: first, last: last >;
```

### Equality Comparison

Since Records/Tuples are primitive (and immutable) value types in **Foi**, equality comparison is structural (meaning deep contents comparison rather than reference identity).

```java
def a: < 4, 5, 6 >;
def b: < 4, 5, 6 >;
def c: < 5, 4, 6 >;

a ?= b;         // true
b ?= c;         // false
c ?= a;         // false
```

```java
def a: < one: "hello", two: "world" >;
def b: < one: "hello", two: "world" >;
def c: < two: "world", one: "hello" >;

a ?= b;         // true
b ?= c;         // true
c ?= a;         // true
```

### Inspecting

You can determine if a value is *in* a Tuple with the `?in` / `!in` operator:

```java
def numbers: < 4, 5, 6 >;

7 ?in numbers;                  // false
(?in)(4,numbers);               // true

7 !in numbers;                  // true
(!in)(4,numbers);               // false
```

**Note:** The `in` operator only inspects numerically indexed fields.

You can determine if a field is defined in a Record with the `?has` / `!has` operator:

```java
def person: < first: "Kyle", last: "Simpson" >;

person ?has "first";            // true
person ?has "middle";           // false

person !has "nickname";         // true
```

### Generating Sequences (Ranges)

If you want to generate a list (Tuple) of sequential ([aka "interval"](https://www.graphpad.com/support/faq/what-is-the-difference-between-ordinal-interval-and-ratio-variables-why-should-i-care/)) data, you can use the binary `..` range operator (either infix or operator-as-function form).

This usage of the `..` range operator is valid with naturally sequential (ordered, fixed interval) values, such as integers and characters:

```java
def someInts: 2..13;

someInts.5;                     // 7

def alphabet: (..)("a", "z");

alphabet.5;                     // "e"
```

The bounds (start and end) of a sequence/range can be held in variables:

```java
def two: 2;
def thirteen: 13;
def someInts: two..thirteen;

def a: "a";
def z: "z";
def alphabet: a..z;
```

The start/end values must be of the same data type; `3.."g"` will not work.

### Deriving Instead Of Mutating

Since Records/Tuples are immutable, to "change" their contents requires you to derive a new Record/Tuple.

The most basic way to derive a new Tuple is to concatenate two (or more) Tuples with `+`:

```java
def odds: < 1, 3, 5, 7, 9 >;
def evens: < 0, 2, 4, 6, 8 >;

odds + evens;
// < 1, 3, 5, 7, 9, 0, 2, 4, 6, 8 >
```

Another way to derive a new Record/Tuple is to select multiple elements using the `.<    >` syntax -- should be treated as a singular compound operator -- with one or more source indices/keys separated by commas:

```java
def numbers: < 3, 4, 5, 6, 7 >;
def evenDigits: numbers.<1,3>;
// < 4, 6 >

(.<1,3>)(numbers);
// < 4, 6 >

def person: < first: "Kyle", last: "Simpson", nickname: "getify" >;
def profile: person.<first,nickname>;
// < first: "Kyle", nickname: "getify" >

(.<first,nickname>)(person);
// < first: "Kyle", nickname: "getify" >
```

**Note:** The `.<` of this operator cannot have any whitespace between the two symbols, but whitespace is allowed inside the `.<    >`.

Inside the `.< ... >`, entries can also use the `%` computed-name and `&` spread sigils -- the same forms allowed inside Record/Tuple literals:

```java
def rec: < x: 1, y: 2, z: 3 >;

def key: "x";
rec.<%key>;             // < x: 1 >

def keys: < "x", "y" >;
rec.<&keys>;            // < x: 1, y: 2 >

def extras: < "y", "z" >;
rec.<x, &extras>;       // < x: 1, y: 2, z: 3 >
```

The `%key` form looks up a single field whose name is computed from `key`. The `&keys` form spreads a Tuple of names, picking each one from the source. The two forms compose with each other and with bare static names, just like entries inside a Record literal.

You can also select a ranged Tuple subset, with the `.[  ..  ]` syntax -- should be treated as a singular compound operator -- as a shorthand for the `.<    >` form:

```java
def numbers: < 3, 4, 5, 6, 7 >;

def head: numbers.0;                // 3
def first: numbers.[..0];           // < 3 >
def leading: numbers.[..-2];        // < 3, 4, 5, 6 >

def last: numbers.-1;               // 7
def trailing: numbers.[-1..];       // < 7 >
def tail: numbers.[1..];            // < 4, 5, 6, 7 >

def middle: numbers.[1..3];         // < 4, 5, 6 >

(.[1..3])(numbers);                 // < 4, 5, 6 >
```

**Note:** The `.[` of this pick syntax form cannot have any whitespace between the two symbols; however, whitespace is allowed *around* the range and its parts (`.[ 1 .. 3 ]`).

A ranged Tuple subset such as `.[2..5]` is a shorthand equivalent for `.<2,3,4,5>` -- selecting out specific indices `2`, `3`, `4`, and `5`.

Certain ranges (e.g., `.[0..]`, `.[..-1]`, and `.[0..-1]`) are no-op expressions, since they result in the same Tuple; as immutable values, there's no reason for **Foi** to actually copy the Tuple in these cases.

A negative endpoint counts back from the end, just like `.-N` does: `-1` is the last position, `-2` the second-to-last. That's what `.[..-2]` and `.[-1..]` above are doing. Endpoints still outside the structure after that reading are silently clipped -- below the start becomes `0`, past the end becomes the last positional index. No error; just the valid subset.

```java
def items: < 10, 20, 30, 40, 50 >;

items.[3..99];      // < 40, 50 >              (end clipped to 4)
items.[-99..2];     // < 10, 20, 30 >          (start clipped to 0)
items.[-99..99];    // < 10, 20, 30, 40, 50 >  (both clipped)
```

----

Additionally, inside the `< ... >` syntactic definition of a Record/Tuple, a special `&` pick sigil prefixed on a variable name (not an arbitrary expression) *picks and includes* some or all of the contents of that other Record/Tuple:

```java
def numbers: < 4, 5, 6 >;
def allDigits: < 0, 1, 2, 3, &numbers, 7, 8, 9 >;
// < 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 >

def person: < first: "Kyle", last: "Simpson" >;
def friend: < &person, first: "Jenny" >;
// < first: "Jenny", last: "Simpson" >
```

**Note:** `&` (*pick*) is a sigil, not an operator, and only has meaning inside a static `<    >` Record/Tuple definition.

The annotations `&numbers` and `&person` *pick* the entire contents of `numbers` and `person`, respectively, to be included in the new Tuple and Record values. The order of field definitions is always left-to-right, so subsequent field definitions override previous ones; thus, `first: "Kyle"` is reassigned to `first: "Jenny"` above.

Picking is useful for merging multiple sequences. For example, to define a Tuple holding all the base-64 characters:

```java
def upper: "A".."Z";
def lower: "a".."z";
def digits: "0".."9";

def base64: < &upper, &lower, &digits, "+", "/" >;
// < "A", "B", "C", "D", ... "8", "9", "+", "/" >
```

**Note:** For type consistency, we intentionally defined `digits` as the character sequence `"0".."9"` instead of the integer sequence `0..9`.

To *pick* only a specific element:

```java
def numbers: < 4, 5, 6 >;
def oddDigits: < 1, 3, &numbers.1, 7, 9 >;
// < 1, 3, 5, 7, 9 >

def person: < first: "Kyle", last: "Simpson" >;
def friend: < first: "Jenny", &person.last >;
// < first: "Jenny", last: "Simpson" >
```

Moreover, the *picks* `&numbers.1` and `&person.last` are shorthand equivalents for:

```java
def numbers: < 4, 5, 6 >;
def oddDigits: < 1, 3, 2: numbers.1, 7, 9 >;
// < 1, 3, 5, 7, 9 >

def person: < first: "Kyle", last: "Simpson" >;
def friend: < first: "Jenny", last: person.last >;
// < first: "Jenny", last: "Simpson" >
```

One advantage of this more verbose form is, you can re-index/rename the field (something other than `2` or `last`, respectively) in the target Record/Tuple.

The `.<    >` and `.[  ..  ]` syntaxes also work with the `&` pick sigil inside a `<     >` Record/Tuple literal:

```java
def numbers: < 3, 4, 5, 6, 7 >;
def evenDigits: < 2, &numbers.<1,3>, 8 >;
// < 2, 4, 6, 8 >
def fiveBelow: < 0, 1, 2, &numbers.[..2] >;
// < 0, 1, 2, 3, 4, 5 >

def person: < first: "Kyle", last: "Simpson", nickname: "getify" >;
def profile: < &person.<first,nickname> >;
// < first: "Kyle", nickname: "getify">
```

----

There is no dedicated *exclude* syntactic form for "skipping" an index/field while deriving a new Record/Tuple. However, subsequently assigning an `empty` value to an index or field has the same effect:

```java
def numbers: < 3, 4, 5, 6, 7 >;
def fewer: < 0, &numbers, 2: empty, 4: empty >;
// < 0, 3, 5, 6 >

def person: < first: "Kyle", last: "Simpson", nickname: "getify" >;
def entry: < &person, nickname: empty >;
// < first: "Kyle", last: "Simpson" >
```

As shown, `empty` means the *absence of a value*, and thus cannot actually be held in a Record/Tuple.

#### Dynamic Pick

The `.<  ..  >` pick syntax -- either `something.< .. >` or `(.< .. >)` form -- supports dynamicism (runtime determination of property names to pick) via `&` and `%`, similar to how those sigils work in Records:

```js
def person: <
    first: "Kyle", last: "Simpson", nickname: "getify",
    title: "Developer", languages: < "Foi", "JS" >
>;
def primaryFields: < "first", "last" >;
def otherFields: < "nickname", "title" >;

def entry: person.< &primaryFields, %otherFields.1 >;
// < first: "Kyle", last: "Simpson", title: "Developer" >
```

Supported forms of dynamic pick include:

* `&something` (must resolve to a Tuple of `String`s)
* `&something.another` (must resolve to a Tuple of `String`s)
* `%whatever` (must resolve to a `String`)
* `%whatever.other` (must resolve to a `String`)
* `%whatever.1` (must resolve to a `String`)
* `%someFunc(..)` (must resolve to a `String`)

### Progressive Definition

Since Records and Tuples are immutable, if you need to define them bit by bit -- via conditionals, loops, etc -- lack of mutability can make things inconvenient. These are probably the two most obvious approaches:

1. Define all the contents ahead of time (in separate variables), and then assemble the Record/Tuple at the end:

    ```java
    def name: ?{
        ?[customer.type ?= "business"]: customer.businessName;
        ?: `"`customer.last`, `customer.first`";
    };

    def orderTotal: orders ~fold (total,order) { total + order.total };

    def record: < :name, :orderTotal >;
    ```

2. Redefine the Record/Tuple step-by-step, through derivations and variable re-assignment:

    ```java
    def record: empty;

    ?{
        ?[customer.type ?= "business"]: record := < name: customer.businessName >;
        ?: record := < name: `"`customer.last`, `customer.first`" >;
    };

    record := <
        &record,
        orderTotal: (~fold)(orders, (total,order) { total + order.total })
    >;
    ```

These accomplish the task, but they're a bit imperative.

There's another strategy which is more FP idiomatic, using the [`Id` monad](#monads-and-friends):

```java
def record:
    Id@ (?{
        ?[customer.type ?= "business"]: < name: customer.businessName >;
        ?: < name: `"`customer.last`, `customer.first`" >;
    })
    ~map (record) {
        def orderTotal: orders ~fold (total,order) { total + order.total };
        < &record, :orderTotal >;
    };
```

The benefit of this idiom is that we don't have to track reassignment of a `record` variable as each part of the Record is computed and added. Each step (typically, a `~map` comprehension as shown) just returns the new (derived) Record value.

**Note:** In this snippet, `record` is a monadic value (an instance of the `Id` identity monad); the Record itself is held inside `record`. To access/work with this underlying Record value, you can use [monadic techniques](#monads-and-friends) and [other capabilities](#broader-category-theory-capabilities).

### Maps

A Record can also act as a *map*, in that you can use another Record/Tuple *as a field* (not just as a value), using the `%` sigil to start the field name:

```java
def numbers: < 4, 5, 6 >;
def dataMap: < %numbers: "my favorites" >;

dataMap[numbers];           // "my favorites"
```

**Note:** Like `&`, the `%` (map-field) sigil is not an operator, and can only be used inside a `<    >` Record definition.

### Sets

A Set is a Tuple that only has unique values. An alternate Tuple definition form, delimited with `<[    ]>` instead, is provided for convenience, to ensure each unique value is only stored once:

```java
def something: < 4, 5, 6 >;
def another: < 6, 7 >;
def uniques: <[ &something, &another ]>;
// < 4, 5, 6, 7 >
```

All syntax rules/variation of Tuple definition `<    >` still apply inside the `<[    ]>`, including use of the `&` pick sigil (but *not* Record `%` sigil); as Sets *are* Tuples, not Records, field names are not allowed.

Unlike `+` which merely concatenates, to unique-append two or more Sets (unique-element Tuples), spread both into a fresh Set literal; the `<[ ... ]>` form deduplicates on construction:

```java
def numbers: <[ 4, 5, 5, 6 ]>;

def moreNumbers: <[ 6, 7, 7 ]>;

def digits: <[
    0, 1, 1, 2, 3,
    &numbers, 6, &moreNumbers,
    8, 9
]>;

digits;    // < 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 >
```

**Warning** The `<[ ... ]>` set literal deduplication applies to Tuple content only, not Records.

Set equality comparison deserves special attention. Since Sets are merely a construction form for Tuples, the `?=` will perform Tuple equality comparison, where order matters. This would likely produce undesired results (false negatives).

Instead, use the `setEq(..)` n-ary function, which takes two or more *sets* (tuples) and returns `true` if their contents are set-wise equal (structurally), without considering ordering.

```java
def set1: <[ 4, 5, 5, 6 ]>;     // < 4, 5, 6 >
def set2: <[ 5, 5, 6, 4 ]>;     // < 5, 6, 4 >
def set3: <[ 6, 4, 5, 0 ]>;     // < 6, 4, 5, 0 >

set1 ?= set2;                   // false

setEq(set1,set2);               // true
setEq(set1,set2,set3);          // false
```

**Note:** `setEq(..)` comparison is slower than `?=` Tuple equality. This cost is worth paying if you really need to compare two Sets, but it may be worth examining if a different approach is feasible.

## Defining Functions

To define a function, use the `defn` keyword. To return a value from anywhere inside the function body, use the `^` sigil:

```java
defn add(x,y) { ^x + y; };
```

Function definitions are always hoisted to their enclosing scope:

```java
add(6,12);                          // 18

defn add(x,y) { ^x + y; };
```

Function definitions are also expressions (first-class values), so they can be assigned and passed around:

```java
def myFn: defn add(x,y) { ^x + y; };

myFn(6,12);                         // 18
add(6,12);                          // 18

somethingElse(myFn);
```

Function definition expressions can also be immediately invoked, a so-called (IIFE: Immediately Invoked Function Expression):

```java
(defn add(x,y){ ^x + y; })(6, 12);  // 18
```

Concise function definitions may omit the name and/or the `{    }` around the body, but the concise body must be an expression marked by the initial `^` return sigil:

```java
def myFn: defn(x,y)^x + y;

(defn add(x,y)^x + y)(6, 12);       // 18
```

### Default Parameter Values

To default a function parameter value:

```java
defn add(x:? 0, y:? 0) ^x + y;
```

The default is applied if the corresponding argument supplied has the `empty` value, or if omitted.

### Gather Parameter

To specify a function that collects all individual/positional arguments into a single parameter (as a list/Tuple):

```java
defn add(*nums) ^(+)(...nums);
```

**NOTE:** The `*` sigil (not an operator), otherwise known as the *gather parameter*, can only appear in a function definition parameter list, with only one parameter listed, and must immediately prefix a single identifier (with no default value).

In the above snippet, all passed arguments will be gathered into a single list/Tuple value assigned to the `nums` parameter.

### Negating A Predicate

A predicate is a boolean-returning function. For example:

```java
defn isOdd(v) ^mod(v,2) ?= 0;
```

It can be quite useful to negate a predicate; this can be expressed with the unary `!` prefixing a function value:

```java
def isEven: !isOdd;

// or:
def isEven: (!)(isOdd);
```

**Note:** As shown here, `!` is overloaded to produce a negated (aka, complement) function if used against a function (or operator) value. Otherwise, it acts to flip/negate a boolean value.

### Function Pre-conditions

It's common that we write function logic while making certain assumptions (aka: expectations, requirements, pre-requisites) for the parameter inputs.

Functions should be as obvious as possible in surfacing such assumptions, rather than merely embedding this logic into the function body's runtime. Ideally, these pre-conditions are part of the explicit function signature, so a reader doesn't need to inspect and mentally execute the function's implementation.

Additionally, some pre-conditions may be verifiable at compile time. And even more importantly, pre-conditions can be evaluated *before* the function has been invoked, where a function might not even need to be invoked!

----

In most other programming languages, a pre-condition means: "if this condition *is not met*, the function cannot run". We might even call this an "assertion". And in some languages, exceptions might be thrown to indicate this failure.

In **Foi**, it's the opposite (indeed, **Foi** doesn't have exceptions).

We're intentionally flipping the mental model from "the function runs only if it *can*" to "the function runs only if it needs to". If a function's pre-condition *is met*, the function **doesn't need to run**; its result value is already explicitly known.

----

These aspects of the function's signature go beyond parameter [type annotations](#type-annotations). It's more than, "is this parameter always an `int`?"; pre-conditions are lifted to the call-site, applied against the function's argument input *value(s)*, and indeed the *relationship(s)* between such argument values.

Consider a function that returns `1` if its argument is less than or equal to `1`. We might call this a "base condition" or an "early return" in certain styles of programming.

You *might have expected* to write it this way:

```java
defn myFn(x) {
    // warning: this is not valid Foi, for
    // illustration purposes only
    ?[x ?<= 1]: ^1

    // ..
};
```

The problem is, this `^1` "early return" isn't particularly obvious, and requires reading into the body to determine.

**Foi** functions ***must do better***.

Pre-conditions are [guard expressions](#guard-expressions), of the form `?[    ]: expr` or `![    ]: expr`, which are applied to *guard* against the need to run the function. One or more of these pre-conditions may appear in the function definition, between the `(    )` parameter list and the body of the function -- either the `{    }` full body, or the the `^`-denoted concise expression-body.

Thus, the above `myFn()` function *hoists* that early-return guard clause out to the definition, as a pre-condition:

```java
defn myFn(x) ?[x ?<= 1]: 1 {
    // ..
};
```

**NOTE:** The `^` return sigil is not used in pre-conditions.

Pre-conditions are evaluated -- hoisted to the call-site -- before actual function invocation. If a pre-condition matches, the consequent `expr` is evaluated and returned and thus the function invocation is skipped.

----

Just like with pattern matching expressions, a preceding `!` (in place of the `?`) negates the pre-condition. By using this form of a pre-condition, you somewhat conform it to the typical mental model of pre-conditions (as discussed earlier).

For example, if you want to define a function that only computes its result when the input is greater than `10`:

```java
defn myFn(x) ![x ?> 10]: empty {
    // ..
};
```

You can read/interpret the `![x ?> 10]: empty` pre-condition as: "x must be greater than 10; if it's not, return `empty` instead". That's basically the way we interpret pre-conditions in any programming language.

**Note:** In this usage, `empty` indicates to the calling code that the function had no valid computation to perform. However, there are other types of values that could (should!?) be returned here, such as a `None` or `Left` monads (more later).

----

If a function has multiple parameters, a pre-condition may imply a *relationship* between them. For example, to define a function where the first parameter must be larger than the second:

```java
defn myFn(x,y) ![x ?> y]: empty {
    ^(x - y);
};
```

Here, if `myFn(5,2)` is called, the result will be `3`. But if `myFn(2,5)` is called, the function won't be invoked at all, and the result (from the pre-condition) will be `empty`:

```java
defn myFn(x,y) ![x ?> y]: empty {
    ^(x - y);
};

def result1: ?(myFn(5,2)){
    ![empty]: #;
    ?: 0
};
def result2: ?(myFn(2,5)){
    ![empty]: #;
    ?: 0
};

result1;            // 3
result2;            // 0
```

### Function Recursion

Function recursion is supported:

```java
defn factorial(v) ![v ?> 1]: 1 {
    ^v * factorial(v - 1);
};

factorial(5);                   // 120
```

Tail-calls (recursive or not) are automatically optimized by the **Foi** compiler to save call-stack resources:

```java
defn factorial(v,tot:? 1) ![v ?> 1]: tot {
    ^factorial(v - 1,tot * v);
};

factorial(5);                   // 120
```

### Function Currying

In addition to the `/\` operator discussed in [Currying Arguments](#currying-arguments) for currying existing function values, function definitions themselves can optionally be curried:

```java
defn add(x)(y) ^x + y;

def add6: add(6);

add6(12);                           // 18
add(6)(12);                         // 18

// loose currying:
add(6,12);                          // 18
```

The `(x)(y)` multiple-parameter-sets define the levels of currying. By strong convention, you'll almost certainly want define just one input per level, but **Foi** does not restrict the count of inputs in this definition form.

### Function Overs

Function definitions must declare non-constant free/outer variable closures using the `:over` keyword:

```java
def customerCache: empty;
def maxLookupCount: 10;

// somewhere else:
maxLookupCount := 25;

defn lookupCustomer(id) :over (customerCache) {
    // ..

    // ERROR! `maxLookupCount` reference not allowed,
    // because it isn't listed in the `:over`
    ?[customerCache.size ?< maxLookupCount]: (
        // ...but this reassignment side-effect is fine:
        customerCache := cacheAppend(customerCache,customer)
    );

    // ..
};
```

A free/outer variable is considered *constant* if it is never lexically reassigned anywhere. Constant free/outer variables may be referenced without being listed in the function's `:over` clause.

Any free/outer variable that is lexically reassigned anywhere is considered non-constant. A function may only reference a non-constant free/outer variable if that variable is listed in the function's `:over` clause.

### Function Composition

Function composition can be defined in left-to-right style, with the `+>` flow operator:

```java
defn inc(v) ^v + 1;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

def compute1: inc +> triple +> half;
def compute2: (+>)(inc, triple, half);

compute1(11);           // 18
compute2(11);           // 18
```

**Note:** The `+>` flow operator produces a unary function, meaning it will only accept and pass-along a single argument; any additional passed arguments are ignored.

It's also very common in FP to prefer right-to-left style composition. Probably the most obvious reason is the visual-ordering coherency between `half(triple(inc(v)))` and a composition argument list like `half, triple, inc`.

The `<+` compose-right operator is equivalent to using the `'` prime operator to reverse the order of the `+>` operator's arguments, as `+>'`:

```java
defn inc(v) ^v + 1;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

def compute1: (<+)(half, triple, inc);
def compute2: (+>')(half, triple, inc);

compute1(11);           // 18
compute2(11);           // 18
```

### Function Pipelines

By contrast, the `#>` pipeline operator (F#-style) operates left-to-right like this:

```java
defn inc(v) ^v + 1;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

11 #> inc #> triple #> half;        // 18

11 #> (+>)(inc, triple, half);      // 18
```

The first expression in a pipeline must be a value (or an expression that produces a value). Each subsequent step must resolve to a function, which when invoked produces a value to pass on to the next step.

Since the `#>` operator is n-ary, multiple steps can also be used in the operator-as-function form:

```java
defn inc(v) ^v + 1;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

(#>)(11, inc, triple, half);        // 18
```

Recall that we can reverse the order of arguments with the `'` prime operator, allowing us to do right-to-left pipelining (if we wanted to for some reason):

```java
defn inc(v) ^v + 1;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

(#>')(half, triple, inc, 11);       // 18
```

The *topic* of a pipeline step is the result of the previous step, and is implicitly passed as the single argument to the step's function. But the *topic* (i.e., the previous step's result value) can be explicitly referred to with the `#` sigil:

```java
defn add(x,y) ^x + y;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

11 #> add(1,#) #> triple #> half;        // 18
```

Of course, if the `add()` function is curried, we can get back to point-free style (no need for the explicit `#` topic):

```java
defn add(x)(y) ^x + y;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

11 #> add(1) #> triple #> half;        // 18
```

----

**Applying a function to a value.** A pipeline with a single stage isn't much of a pipeline -- `x #> f` is just `f(x)`, written value-first instead of function-first. On its own that's a stylistic choice. What makes it interesting is that `(#>)` is an ordinary function value, so partial application can fix the *value* and leave the *function* open:

```java
defn logIt(v) { log(`"log: `v`"); };
defn saveIt(v) { save(v); };

def handlers: < logIt, saveIt >;

handlers ~each (#>)|42|;
// log: 42
// (42 saved)
```

`(#>)|42|` is a function that takes a function and calls it with `42`. Each element of `handlers` is passed to it in turn, so each handler runs against the same value.

If you've used other FP libraries, you may know this one as `applyTo`, or the *thrush*, or the T combinator -- usually a named helper you import or hand-write. In **Foi** there's nothing to import and nothing to define: it's the pipeline operator lifted to a function value (as any operator can be), with its first argument fixed (as any function's can be).

That generalizes. Any time you find yourself writing a throwaway lambda whose whole job is "call the thing I'm given with the value I already have," `(#>)|value|` is the point-free spelling:

```java
def notifyAll: (#>)|currentUser|;

subscribers ~each notifyAll;
```

A *pipeline function* is a specialized function definition form that replaces the `^` return sigil with a `#>` pipeline as its concise body. The *topic* of the first step is automatically bound to the first parameter of the function:

```java
defn add(x,y) ^x + y;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

defn compute(x) #> add(1,#) #> triple #> half;

compute(11);    // 18
```

And again, if we define `add()` as curried function, we can avoid the explicit `#` topic reference (aka, "point free"):

```java
defn add(x)(y) ^x + y;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

defn compute(x) #> add(1) #> triple #> half;

compute(11);    // 18
```

Compare this `#>` *pipeline function* form to the previously-discussed `+>` flow operator:

```java
defn add(x)(y) ^x + y;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

def compute: (+>)(add(1), triple, half);

compute(11);    // 18
```

The previous `#>` *pipeline function* form is more powerful/flexible than the `+>` approach, in that a pipeline function can declare multiple parameters, and access any of them throughout the pipeline via `#`.

### `@`-Suffix (At) Functions

If you declare a function with a `@` suffix on its name (declaration form only), it's referred to as a "unit constructor":

```java
defn Double@(x:? 0) ^x * 2;
```

The `@` must appear in the name (`Double@` above) with no space in it; there can be optional whitespace after the `@` before the parameter list (`(x:? 0)` above).

**NOTE:** This is how various built-ins you've already seen in this guide, such as `Lazy@`, `Left@`, etc, are all declared.

This form of function declaration must include zero or one parameter (which may optionally have a default) for the first parameter set; the `*args` gather parameter form is not allowed for that parameter set.

The declaration above reserves `Double` as a lexical namespace name in that scope. No other `def` or `defn` (in that scope) may bind `Double` (bare) or `Double@`.

However, bare `Double` is not a reference to the function. To reference the function itself (for assignment, passing as a callback, etc), use the special `Double.@` form:

```js
def doub: Double.@;

doub;                   // defn Double@(...
```

#### At-Call Expression

Functions of this form are opted (exclusively) into alternate parentheses-free call syntax, with the `@` call operator:

```java
// instead of Double(21)
def v: Double@ 21;      // 42

def zero: Double@;      // 0
```

**TIP:** Conceptually, think of `defn Double@(..) { .. }` as creating a "type namespace" `Double` with a property on it called `@`; that's why `Double.@` references the function itself without an invocation. And the `Double@ 21` / `doub@ 21` call forms are dispatching to that `Double.@` function.

If the `@` function call passes no argument, as in `def zero: Double@;`, a default `empty` is passed; the parameter's default expression, if any, will thus be resolved (as above).

The `@` call form allows *optional* whitespace on either side of the `@`, so `Double@21`, `Double @ 21`, `Double@ 21` and `Double @21` are all valid, stylistically varied call forms (as are `Double@` and `Double @` for the zero-arg form).

----

`@` is an operator, so it can also be invoked in the operator-function form, as well, taking a callee ("type namespace") and an argument:

```java
(@)(Double,21);         // 42

(@)(Double,,);          // 0 -- the ,, skips the second argument
```

**TIP:** The `,,` on the second call above is necessary here -- or alternately, `,empty` -- as it forces invocation of the two-argument form of the `@` operator function, with the second argument just `empty`. Omitting a second argument entirely (i.e., `(@)(42)`) assumes the one-argument form of `@`, which assumes *no callee* to invoke. That may seem like a contradiction -- invoking a callee when there is no callee -- but, since there's nothing to call, the expression `(@)(42)` is just a no-op passthrough that resolves to the `42` value itself. We'll revisit this again shortly, in "Value Identity Function".

### `%`-Suffix (Percent) Functions

A similar special suffix function declaration form uses `%`:

```java
defn Runner@(fn) ^< :fn >;

defn Runner%(dInst,arg) ^dInst.fn(arg);
```

The `defn ...%` form *must* be accompanied in the same scope by a declaration of that name -- either a `defn ...@` unit constructor, as here, or a `deft` of the same name (see [Hooks on a Shared Type](#hooks-on-a-shared-type)). You hang hooks only on types you declared yourself.

This opts *instances* constructed by the `Runner@` unit constructor into a dispatch by the special `%` effector call-operator, to this function (passing the instance and, optionally any argument):

```java
def greet: Runner@ (
    defn(name) ^log(`"Hello, `name`!")
);

greet% "friend";            // Hello, friend!

// instead of:
greet.fn("friend");         // Hello, friend!
```

`greet` is an instance of the `Runner@` unit constructor, and `Runner` "type namespace" also has the `%` effector dispatch defined. So `greet% "friend"` invokes that `Runner%(dInst,arg)` function, passing `greet` and `"friend"` as its arguments, respectively.

You will most commonly use this form of effector `%` dispatch paired with deferred monadic types like `IO`, `State`, etc.

### `~`-Suffix (Comprehension) Functions

Comprehension operators like `~map`, `~<`, `~each`, `~fold`, and friends aren't built into the language against fixed types. They dispatch through hooks declared on the target namespace, using a suffix declaration form that mirrors `@` and `%`:

```java
defn Container@(v) ^< value: v >;

defn Container~map(inst,fn) ^Container@ fn(inst.value);
defn Container~<(inst,fn) ^fn(inst.value);
```

Now `Container@` instances flow through comprehensions naturally:

```java
def wrapped: Container@ 42;

wrapped ~map (defn(v) ^v * 2);          // Container@ 84
wrapped ~< (defn(v) ^Container@v * 2);  // Container@ 84
```

Like `%`, a `~`-suffix declaration must be accompanied in the same scope by a declaration of that name -- a `defn Name@(..)` or a `deft Name` ([Hooks on a Shared Type](#hooks-on-a-shared-type)); the hook installs onto that namespace. `Container`, `Container@`, `Container~map`, `Container~<`, and any other comprehension-suffix form on the same identifier all share one namespace.

The `~<` hook has surface aliases at call sites -- `~chain`, `~bind`, and `~flatMap` all dispatch through the same hook -- but declaration uses only the canonical `~<`.

**NOTE:** Not every comprehension needs a hook to work on a given namespace. `~map`, `~ap`, `~filter`, `~fold`, `~cata`, and `~foldR` have language-provided defaults that compose over whatever primitives you *have* declared (`~<`, `~map`, etc.). `~<` and `~each` are the primitives; if a comprehension expression reaches for one of these on a namespace that hasn't declared it, that's a compile-time rejection.

Comprehension hook declaration and the dispatch/default machinery are covered in depth in the advanced guide and specification (§3.1.1.3, §3.10.9).

### Operator-Suffix Functions

Alongside `@`, `%`, and `~`-suffix hook declarations, **Foi** lets you attach a small set of arithmetic and equality operators to your own types:

```java
defn Vector@(v) ^v;

defn Vector+(a,b) ^Vector@ < x: a.x + b.x, y: a.y + b.y >;
defn Vector-(a,b) ^Vector@ < x: a.x - b.x, y: a.y - b.y >;
defn Vector*(a,k) ^Vector@ < x: a.x * k, y: a.y * k >;
defn Vector?=(a,b) ^a.x ?= b.x ?and a.y ?= b.y;
```

**NOTE:** `/` not shown here because Vector division is ill-defined.

Now `+`, `-`, `*`, and `?=` work naturally on `Vector` instances:

```java
def v1: Vector@ < x: 1, y: 2 >;
def v2: Vector@ < x: 3, y: 4 >;

v1 + v2;                            // Vector@ < x: 4, y: 6 >
v1 * 2;                             // Vector@ < x: 2, y: 4 >
v1 ?= (Vector@ < x: 1, y: 2 >);     // true
v1 != v2;                           // true
```

Like `%` and `~`-suffix declarations, an operator-marked `defn` requires an accompanying declaration on the same identifier -- a `defn Name@(..)` or a `deft Name` ([Hooks on a Shared Type](#hooks-on-a-shared-type)); the hook installs onto that namespace. `Vector`, `Vector@`, `Vector+`, `Vector?=`, and any other operator-suffix form on the same identifier all share one namespace.

The admitted markers are `+`, `-`, `*`, `/`, and `?=`. Each hook takes two parameters: the left operand (an instance of the declaring namespace) and the right operand. When the left operand at a call site is an instance of the declaring namespace, the hook fires. If the left operand's namespace hasn't declared the operator, the call is rejected at compile time -- there's no silent fallback to numeric behavior on user types.

**`!=` derives from `?=`.** Declaring `defn Vector?=(a,b) ...` also determines what `a != b` means for `Vector` instances -- it's just the negation of the `?=` hook's result. Declaring `defn Vector!=(..)` is a compile-time rejection with a directive to declare `?=` instead.

**Ordering operators cannot be type-attached.** `?<`, `?>`, `?<=`, `?>=`, `?<=>`, and `?<>` cannot be intercepted per-namespace. If you need custom ordering on your type, define a plain named function and call it directly:

```java
defn vectorMag(v) ^v.x * v.x + v.y * v.y;
defn vectorLT(a,b) ^vectorMag(a) ?< vectorMag(b);

vectorLT(v1,v2);            // true
```

**NOTE:** When a namespace declares `+` but doesn't declare its own `~fold` / `~foldR` hook, fold comprehensions over instances of the namespace default to composing the `+` hook -- accumulator threaded, `+` applied left-to-right (or right-to-left for `~foldR`). A sum-type namespace declaring just `+` gets a natural `~fold` for free.

Operator hook declaration and the full dispatch mechanism are covered in depth in the specification (§3.1.1.4).

### Hooks on a Shared Type

Every hook so far has hung on a namespace you made with a unit constructor. There's a second way: declare a type with `deft` that names other types, and hang the hook there. Members of that type reach it.

```java
defn Meters@(n) ^< meters: n >;
defn Feet@(n) ^< meters: (n * 0.3048) >;
defn Yards@(n) ^< meters: (n * 0.9144) >;

deft Length Meters | Feet | Yards;
```

Each constructor converts on the way in, so all three carry the same field and differ only in the units they were written with. `Length` names them as its members. It has no `Length@` and never will -- there's nothing to construct, since what you construct is a `Meters`, a `Feet`, or a `Yards`. What it *can* carry is hooks:

```java
defn Length+(a,b) ^Meters@ (a.meters + b.meters);
defn Length?=(a,b) ^a.meters ?= b.meters;
```

```java
(Feet@ 10) + (Yards@ 2);        // Meters@ 4.8768
(Feet@ 3) ?= (Yards@ 1);        // true
```

Neither `Feet` nor `Yards` declares `+` or `?=`. Dispatch walks up to `Length` and finds them there -- written once, for the whole family, instead of nine near-identical hooks across three namespaces.

**A member's own hook wins.** If `Feet` declared its own `+`, that one would fire whenever a `Feet` instance is the left operand, and `Length`'s would still cover the rest. The declaration closest to the value's type is the one that runs, which is what makes a family default worth writing: members override it when they need to.

`?as` follows the same membership:

```java
def d: Feet@ 10;

d ?as Feet;         // true
d ?as Length;       // true
d ?as Yards;        // false
```

**Membership is by name, not by shape.** `Length` contains those three because you wrote them into the `deft`, not because anything about their contents matches. A separately declared type that happens to hold a `meters` field isn't a member.

**One thing to avoid.** Don't put the same hook on two unrelated types that one type belongs to. If `Feet` is a member of both `Length` and `Serializable` and both declare `?=`, then `someFeet ?= other` has two equally-close answers, and **Foi** rejects the expression rather than picking one. Neither is closer than the other, so there's nothing to prefer. Fix it where the hooks are declared -- drop it from one of them, or give `Feet` its own.

## Base Unit Functions

In the previous couple of sections, we covered the `@`-suffixed "unit constructor" functions.

In addition to `Lazy@`, `Left@`, and others you've already seen, **Foi** provides two very common/helpful base unit constructor function utilities built in.

### Value Identity Function

The first is often referred to as "identity". It's a function that takes a single input and simply returns it untouched. You could define your own like this:

```java
defn identity(v) ^v;

identity(42);       // 42
```

However, this utility is so commonly needed that **Foi** provides it built-in, as a `@` shorthand identity function:

```java
@42;                // 42
@ 42;               // 42
@(42);              // 42
```

**NOTE:** The bare `@` function can be used in a call-expression, as above, but it cannot be used as a standalone reference to that utility function itself; `def iden: @;` would be illegal. However, assuming you know only one value will ever be passed to it, you *can* get a close-approximation by referencing the `@` operator-function; for example, `def identity: (@)`, or passing it as a callback like `xs ~map (@)`.

----

Recall from a few sections ago, the discussion of the single-argument form of the `@` operator-function form, as in:

```java
(@)(42);            // 42
```

Given the obvious conceptual connection here -- compare to the previous snippet forms like `@(42)`, etc -- **Foi** allows that bare `@` identity function in a call-expression (only), as terser alias for the one-argument `(@)(..)` operator-function usage. Thus, `@42` is valid and available. These are technically different mechanisms, but yield the same outcome.

Conceptually, it's as if `@` identity function is defined as:

```java
// not actually!
defn @(v) ^(@)(v);
```

----

Here's an example of how you might use the identity unit function:

```java
defn formatRecord(record,formatFn:? (@)) {
    // ..
    ^formatFn(record);
};
```

The `(@)` operator-function serves as a default pass-through function here, presuming only one argument will be passed to it.

### Null-Application Function

It's also very common to need a function which takes no argument, but returns some fixed value. There are places where a function is expected -- for example, operators like `~cata` or `~map` -- and yet we want to provide a placeholder function that returns a fixed value.

In **Foi** this is called "null application".

We can define either dedicated functions or inline functions for this purpose. For example:

```java
defn fortyTwo() ^42;

fortyTwo();             // 42
```

But since that may happen a lot, we might want a utility for constructing such functions:

```java
defn constant(v)() ^v;

def fortyTwo: constant(42);

fortyTwo();             // 42
```

**Note:** Notice the `()` in the `constant()` function definition, which matches with the `()` at the `fortyTwo()` call-site. That's where the label "null application" comes from.

Since this is so common in FP programs, **Foi** provides a null-application unit function:

```java
def fortyTwo: Function@42;
def hello: Function@ "Hello!";
def yes: Function@(true);

fortyTwo();             // 42
hello();                // "Hello!"
yes();                  // true
```

The name of this utility (`Function@`) is a nod to the fact that it's a unit constructor for a function, specifically a null-application function (one that accepts no arguments).

Here's an example of how you might use this utility:

```java
defn getName(record,getLabel:? Function@ "Default") {
    ^(`"`getLabel(record)`: `record.name`");
};
```

The `Function@ "Default"` form here constructs a default `getLabel` function that just returns the value `"Default"` when invoked (no matter what's passed to it.

----

Admittedly, `Function@` is a little verbose. A close approximation (with an important caveat!) can be accomplished by partially-applying the `@` operator (lifted as value identity function):

```java
def fortyTwo: (@)|42|;
def hello: (@)|"Hello!"|;
def yes: (@)|true|;

fortyTwo();             // 42
hello();                // "Hello!"
yes();                  // true
```

**WARNING:** The important caveat: those functions (`fortyTwo()`, etc) must be called with **no arguments**, otherwise you'll encounter an error. The reason is, the `(@)` operator is polymorphic -- if passed more than one argument, the first argument is presumed to be the callee (as in `Foo@ 42` where `Foo` is the callee and `42` is the argument). Also, the `@` operator-function rejects (with an error) 3 or more arguments; it accepts only zero-arguments (returns `empty`), one-argument (fixed function over that value), or two-arguments (callee and single argument). Bottom line: you might be able to safely leverage the `(@)|42|` shorthand, if you're sure how the resulting null-application function will be invoked (with no arguments). Otherwise, just use the longer but more correct `Function@42` form.

## Loops

Perhaps some of the most distinctive features in various programming languages (FP-oriented versus more general) is the mechanics of looping/iteration. Imperative languages tend to have a variety of loop types (`for`, `while`, `do..while`, etc), whereas FP languages favor iterations/comprehensions (`map`, `filter`, `reduce` / `fold`, etc).

**Foi** is unquestionably an FP-oriented language, but tries (to an extent!) to cast a wider, more pragmatic net, in hopes of being inclusive of broader programming styles. As such, there's a unified syntax which can be used for both imperative looping and declarative iteration/comprehension.

Let's start with the typical imperative loop approach. Here's a loop that prints `"Hello!"` four times, using the `~each` loop operator:

```java
0..3 ~each {
    log("Hello!");
};
// Hello!
// Hello!
// Hello!
// Hello!
```

`~each` is a operator/function that can be used either in the infix form (shown above) or the operator-as-function form. The first operand to `~each` defines the *range*, and the second operand defines the *iteration* operation(s).

1. The *range* is an expression that determines the *bounds* of the loop processing; this expression can take two forms:

    - If the *range* expression resolves to a Record/Tuple, the contents of the value are set as fixed *bounds* for loop processing. Examples of such an expression: an identifier, a function call, generated (`0..3`, as above), or explicit inline (such as `< 0, 1, 2, 3 >`).

    - If the *range* expression is a conditional of the form `?[    ]` or `![    ]` -- same as the conditional of an independent [pattern matching](#pattern-matching) clause -- the expression will be evaluated *before* each iteration, and will only proceed with the iteration if `true`; `false` signals the end of the *range* and terminates the loop.

        For example:

        ```java
        def done: false;

        ![done] ~each {
            // ..
        };
        ```

        This loop will keep running as long as `done` is false. The *range* could also have been written as `?[!done]`, but the former should generally be preferred as easier to read.

    - To skip the `range` expression (and provide it later), use partial application:

        ```java
        def printAll: (~each)| , log |;

        printAll(< 1, 3, 5, 7, 9 >);
        // 1
        // 3
        // 5
        // 7
        // 9
        ```

2. The *iteration* is an expression that defines what operation(s) to perform for each iteration. This expression can take several forms:

    - an expression that evaluates to a function to invoke for each iteration. For example:

        ```java
        0..3 ~each log;
        // 0
        // 1
        // 2
        // 3
        ```

    - an inline block with a `(    )` block-definitions clause (list of comma-separated definitions). For example:

        ```java
        2..5 ~each (v) {
            log(`"v: `v`");
        };
        // v: 2
        // v: 3
        // v: 4
        // v: 5
        ```

        **Warning:** Beware that a default initialization expression on the first position (e.g., `(v:? 3)`) will be ignored (unless the value that comes through is `empty`), as it's assigned per-iteration according to the loop `range` and the iteration-type.

        If the loop iteration doesn't need any block-scoped definitions, omit the `(    )` block-definitions clause:

        ```java
        0..3 ~each {
            log("Hello!");
        };
        // Hello!
        // Hello!
        // Hello!
        // Hello!
        ```

In general, the result of the `~each` operation is the *range* (e.g., Record/Tuple), such that multiple `~each` expressions can be chained together. For example, `a ~each b ~each c`, which would loop performing `b` over the `a` *range*, then loop performing `c` over the same range.

**Note:** For `~each` looping over a Record/Tuple *range*, `~each` will result in the same Record/Tuple. But in the case where the *range* was a conditional, the result of `~each` will be an empty Tuple.

### Early Exit

To "break" out of a comprehension early, produce a `Done@..` value -- either by function return from a callback, or final expression value of the block:

```java
0..10 ~each (v) {
    log(`"v: `v`");
    ?[v ?> 3]: Done@1;
};
// v: 0
// v: 1
// v: 2
// v: 3
// v: 4
```

The loop above exited early once `v` was `4`, tripping the guard condition, which sets the block's final expression to be `Done@1`. The `Done@`-wrapped value itself (e.g., `1`) doesn't matter for `~each` as it's thrown away, but *does* matter for other comprehension types.

## List Comprehensions

However, moving beyond imperative `~each` looping of Records/Tuples, **Foi** provides a variety of list comprehensions, including: `~map`, `~flatMap`, `~filter`, `~fold`, and `~foldR`.

These must all have a non-conditional *range* operand; when the *range* is a list (Tuple), they act as *list comprehensions*.

### Filter Comprehension (List)

The *iteration* operand for the `~filter` comprehension is a *predicate*, meaning for each value in the list (Tuple), it must compute a `true` to keep (aka, "filter in") the value, or `false` to discard (aka, "filter out") the value:

```java
defn isEven(v) ^mod(v,2) ?= 0;

def evens: 0..9 ~filter isEven;
// < 0, 2, 4, 6, 8 >

def odds: 0..9 ~filter (v) {
    !isEven(v);
};
// < 1, 3, 5, 7, 9 >
```

The `~filter` comprehension requires a list (Tuple) *range*, and its final result is always another list (Tuple).

**Note:** Just like with loops, all these comprehensions support the *iteration* operand being a function, an inline function definition, or an inline-block.

### Map Comprehension (List)

Perhaps one of the most common/recognizable list comprehensions is *map*:

```java
defn double(v) ^v * 2;

def evens: 0..5 ~map double;
// < 0, 2, 4, 6, 8, 10 >
```

```java
def evens: 0..5 ~map (v) { v * 2; };
// < 0, 2, 4, 6, 8, 10 >
```

**Note:** The `~map` comprehension expresses Functor/Mappable behavior from [broader Category Theory](#broader-category-theory-capabilities) (more later).

----

To compose multiple (`~map`) comprehensions:

```java
defn inc(v) ^v + 1;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

def odds: < 1, 3, 5, 7, 9 >;

odds ~map inc ~map triple ~map half;
// < 3, 6, 9, 12, 15 >

(~map)(odds, inc, triple, half);
// < 3, 6, 9, 12, 15 >

odds ~map (+>)(inc, triple, half);
// < 3, 6, 9, 12, 15 >
```

Further, we can take advantage of omitting the *range* (via `|    |` partial application invocation) to create a function out of the comprehension composition:

```java
defn inc(v) ^v + 1;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

def compute: (~map)|, inc, triple, half|;

compute(< 1, 3, 5, 7, 9 >);
// < 3, 6, 9, 12, 15 >
```

**Note:** In `compute` definition, the leading `,` in the arguments list indicates explicitly omitting the *range*, thereby producing a partially-applied function that expects the *range* on its invocation.

----

The *iteration* operand receives exactly one argument: the current value. There's no second index parameter -- writing `(v,i)` leaves `i` as `empty`, since nothing is supplied at that position.

When the index is needed, transform the *range* first. `List.entries@` produces a list of `< index, value >` pairs, which the *iteration* can destructure:

```java
def xs: < 5, 10, 15 >;

(List.entries@ xs) ~map (< i, v >) {
    (i + 1) * v;
};
// < 5, 20, 30 >
```

This works the same way for every list comprehension -- `~filter`, `~flatMap`, and the rest -- since they all take the same single-value *iteration* operand.

**Note:** `List.keys@` is the companion, producing just the indicies (`< 0, 1, 2, .. >`).

----

A *map iteration* doesn't always have to produce a single discrete value.

Let's consider the case where a *map* operation itself returns a list (Tuple) instead of a single discrete value; the result is a list of sub-lists. This operation is typically called a *zip*:

```java
defn zip(xs,ys) ^(
    (List.entries@ xs)
        ~map (< i, x >) { < x, ys[i] >; }
);

zip(< 1, 2, 3 >,< 4, 5, 6 >);
// < <1,4>, <2,5>, <3,6> >
```

As shown, returning a list (Tuple) from the *map iteration* ends up with a list of sub-lists. When a *zip* is called for, this is the approach.

### FlatMap Comprehension (List)

When *mapping* two or more lists (Tuples) together, sometimes what we want is a single-level list, with all the sub-lists flattened out. This operation can be referred to as a *merge*.

To perform *merge* (aka, flattening while mapping), we can use the `~flatMap` comprehension:

```java
defn merge(xs,ys) ^(
    (List.entries@ xs)
        ~flatMap (< i, x >) { < x, ys[i] >; }
);

merge(< 1, 2, 3 >,< 4, 5, 6 >);
// < 1, 4, 2, 5, 3, 6 >
```

**Note:** You may recognize that "flatMap" often goes by alternate names in other contexts/languages: "bind", "chain", etc. As we'll see later with [Monadic Bind](#monadic-bind), `~flatMap` has various aliases: `~bind`, `~chain`, and the shorter/generally more preferred `~<`. They all work identically, so readability preferences dictate which to use.

### Do Comprehension (List)

It may not seem obvious yet, but `~<` (aka, `~flatMap`, `~bind`, or `~chain`) is likely to be a fairly common list (Tuple) comprehension operation in your programs.

For example, it's common to *flat-map* with multiple lists, and need access to a value from each list to perform the mapping:

```java
def xs: < 2, 4 >;
def ys: < 7, 8 >;

xs ~< (x) {
    ys ~< (y) {
        < x + y >;
    };
};
// < 9, 10, 11, 12 >
```

Notice that to pull this off -- accessing both `x` and `y` in the same scope! -- we had to nest the second `~<` operation inside the *iteration* scope of the first `~<` operation. That works, but it should *smell* a little bit.

----

By the way, we illustrated the above with two `~<` *flat-map*s, but there's an alternate way to think about it:

```java
def xs: < 2, 4 >;
def ys: < 7, 8 >;

xs ~< (x) {
    ys ~map (y) {
        x + y;
    };
};
// < 9, 10, 11, 12 >
```

Notice that here, I replaced the innermost `~<` with a `~map`, and then omitted the `<    >` Tuple wrapped around the `x + y` computation.

The end result is equivalent. Generally, it doesn't really matter which way makes most sense to you; pick one and go with it. But for this guide, I'll stick with the former double `~<` processing model.

----

Whichever way we mentally model this task, we'll likely encounter it rather often. And as ugly as multiple nested scopes can get (especially if there's 3 or more of these steps/nestings involved), **Foi** provides a special comprehension: `~<<`, called the *do comprehension*.

**Note:** In other languages (e.g., Haskell, Scala, etc), you may see something similar referred to as the "do syntax", most commonly in a monadic context. However, here we're broadening/generalizing the concept to include lists (Tuples).

Consider:

```java
def xs: < 2, 4 >;
def ys: < 7, 8 >;

List ~<< {
    def x:: xs;
    def y:: ys;
    x + y;
};
// < 9, 10, 11, 12 >
```

There are several *special* things going on here. But hopefully once I describe the processing steps, you'll recognize it as the same as the first snippet (double `~<` version) at the top of this section.

First off, the `~<<` operator's "range" operand is [`List`](#list-monad), the formal type for a Tuple. That should seem a bit strange, since nothing should really happen if you perform a comprehension/iteration across an empty list... right? But it's even more unusual, in that this is a **type** for the *range* rather than a concrete value. Just hang with me.

Notice the `::` instead of the typical `:` in the `def` statement. What `def x:: xs` is saying is, pull out each value from `xs`, one at a time, and assign each value to `x`, on successive iterations of the block.

*THAT* you should recognize as a comprehension. Moreover, the second `def y:: ys` is pulling out each value from `y` one at a time, and assigning it to `y`. Again: comprehension.

Here's the tricky part: the second comprehension is happening **for each iteration of the first comprehension**. In other words, the second is *nested in* the first. Just like the earlier double `~<` snippet, right?

When each *iteration*'s `x + y` operation is performed, the result is automatically wrapped in **the same type as** the *range* context -- remember: if omitted, an empty `<>` tuple is assumed for the *range*. Finally, that result is *flat-map*ped into the overall result.

We can also just include the special iterative assignments in a [block-definitions clause](#block-definitions-clause):

```java
List ~<< (x:: xs, y:: ys) {
    x + y;
};
// < 9, 10, 11, 12 >
```

As both forms are equivalent, readability and other code maintenance concerns dictate the appropriate style to choose.

----

Remember, the final value produced in the iteration block is automatically *wrapped* in the comprehension *range* type (list/Tuple here). That means a *double-wrapping* effect would occur if the value produced is already a list (Tuple); this might be desired but often is a mistake.

Consider the non-*do comprehension* form:

```java
def xs: < 2, 4 >;
def ys: < 7, 8 >;

xs ~< (x) {
    ys ~map (y) {
        < x + y >;   // <-- notice the tuple and ~map
    };
};
// < < 9 >, < 10 >, < 11 >, < 12 > >     <-- oops!
```

When it's a literal value like this, you can omit the `<    >`.

But when that "final" value comes from an outside computation, we can't just omit the `<    >`. So we're forced to use `~<` instead of `~map`:

```java
defn tup(x,y) ^(< x + y >);

def xs: < 2, 4 >;
def ys: < 7, 8 >;

xs ~< (x) {
    ys ~< (y) {      // <-- notice ~< instead of ~map
        tup(x,y);
    };
};
// < 9, 10, 11, 12 >
```

But for the *do comprehension* form, we ostensibly cannot control the final step's behavior -- it always `map(..)`s, generally for convenience instead of requiring every terminal to re-wrap:

```java
List ~<< (x:: xs, y:: ys) {
    tup(x,y);
};
// < < 9 >, < 10 >, < 11 >, < 12 > >     <-- oops!
```

So here are some workarounds:

```java
List ~<< (x:: xs, y:: ys) {
    tup(x,y).0          // ugh!
};
// < 9, 10, 11, 12 >


List ~<< (x:: xs, y:: ys) {
    def v:: tup(x,y);   // meh
    v
};
// < 9, 10, 11, 12 >
```

But these are a bit verbose/annoying, right?!

When you need to prevent the double-wrapping, prefix the final expression with `$`:

```java
List ~<< (x:: xs, y:: ys) {
    $tup(x,y);          // <-- notice the $
};
// < 9, 10, 11, 12 >
```

The `$` prefix on the final expression tells the *do comprehension* to bind (chain via `~<`) instead of lift-and-wrap (via `~map`). You can also think about it as skipping the automatic wrapping that would otherwise occur.

**Note:** The `$` sigil is also usable at mid-block positions -- `$expr;` performs a bind without receiving the value into a named slot. It's the sibling of `def x:: expr`: both perform binds, but `$expr` doesn't need a receiving name.

----

You may have noticed that a single list (Tuple) in this `~<<` *do comprehension* form is equivalent to the `~map` comprehension on a single list:

```java
def xs: < 2, 4 >;

List ~<< (x:: xs) {
    x * 10;
}
// < 20, 40 >


xs ~map (x) {
    x * 10;
}
// < 20, 40 >
```

The `~map` form is clearer here -- seems a bit more obvious and less magical -- and should probably be preferred in the specific case of having a single comprehension.

By contrast, the *do comprehension* form really shines when there are multiple comprehensions composed together, especially if computations need to access values from each of them, in a single scope. That's precisely what the magical *do comprehension* is all about.

### Fold Comprehensions (List)

The `~fold` comprehension (left-to-right), often referred to as *reduce*, works like this with lists (Tuples):

```java
defn add(x,y) ^x + y;

0..9 ~fold add;
// 45   (0 + 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9)

0..9 ~fold (acc,v) {
    acc + v;
};
// 45   (0 + 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9)
```

**Note:** The final result (and type) of the `~fold` comprehension is determined by the return value of the final *iteration* evaluation.

In this form of the `~fold` comprehension, the first *iteration* evaluation will receive the first value from the list (Tuple) as the *accumulator* (above: `x`, `acc`) argument, and the second value from the list as the *iteration-value* (above: `y`, `v`) argument.

So in the above snippet, the first invocation of `add()` in each comprehension will have `x` set as `0` and `y` set as `1`. That return result (`1`) comes in as `x` for the second invocation of `add()`, with `y` being `2`. And so on.

----

But, folds/reductions sometimes need to start with a specific *initial value* rather than with just the first value in the list (Tuple). In this usage, the `~fold` comprehension is a representation of generalized [Foldable behavior](#foldable--catamorphism) (covered later).

If the `~fold` comprehension's *range* argument is a list (Tuple), and there are at least two other operands specified (i.e., 3 or more operands total), then the second operand will be interpreted as the *initial-value* (or *default-value*), and the third operand is an *iteration* expression.

For example:

```java
defn sub(x,y) ^x - y;

(~fold)(1..5, 100, sub);
// 85   (100 - 1 - 2 - 3 - 4 - 5)
```

When an initial value is provided to a fold/reduce, it is set as the *accumulator* argument to the first *iteration*, and the first value in the list (Tuple) is the *iteration-value* argument.

So in the snippet above, `100` is the *initial value*, and comes in as `x` in the first invocation of `sub()`, with `y` being `1`. That return result (`99`) comes in as `x` for the second invocation of `sub()`, with `y` being `2`. And so on.

For a `~fold` comprehension to execute, there should be at least two values to operate upon. If the list (Tuple) only has one value in it, then specifying the *initial-value* provides this second value.

If there's only one value (either in the list or as the specified *initial-value*), the `~fold` comprehension short-circuits (i.e., skips evaluating the *iteration* operand), returning that single value.

But if there isn't at least one value provided, the `~fold` operation is invalid, and `empty` is the result.

**Note:** You can configure **Foi** to issue a warning notice in such a case.

----

Folds *can even* produce another Record/Tuple result. One typical way to accomplish this is for the *initial-value* operand to be an empty Record/Tuple (`<>`):

```java
defn onlyOdds(list,v)
    ![mod(v,2) ?= 1]: list
        ^list + < v >;

(~fold)(0..9, <>, onlyOdds);
// < 1, 3, 5, 7, 9 >
```

The `~foldR` comprehension works identically to the `~fold` comprehension, but in right-to-left order. Compare the two comprehensions here:

```java
defn sub(x,y) ^x - y;

1..5 ~foldR sub;
// -5    (5 - 4 - 3 - 2 - 1)

1..5 ~fold sub;
// -13   (1 - 2 - 3 - 4 - 5)
```

## Monads (And Friends)

The identity monad in **Foi** is called `Id`, and the empty monad is called `None`. These two are actually paired in the [`Maybe` monad type](#maybe-monad), as discussed later.

The `@` sigil applies the "unit constructor" for any monad type, thus a monadic value can be constructed like this:

```java
def m: Id@ 42;          // Id{42}

def nil: None@;         // None
```

A monadic value is a primitive, immutable value type in **Foi**, meaning equality comparison is structural (just like Records/Tuples). As such:

```java
def m: Id@ 42;
def g: Id@ 42;

m ?= g;                 // true
```

To get a reference to the factory function for constructing a specific monad instance, use `.@`:

```java
def ofId: Id.@;

ofId(42);               // Id{42}
```

A monadic value is a valid *range* for certain comprehensions, as we'll now explore.

### Monadic Map

Since [broader Category Theory](#broader-category-theory-capabilities) shows that Monads are Functors/Mappables, monadic values can also be used as the *range* for a `~map` comprehension:

```java
defn double(v) ^v * 2;

def m: Id@ 21;

m ~map double;                  // Id{42}

m ~map (v) { v * 2; };          // Id{42}
```

----

Comprehension operations for `None` are all no-ops, meaning they do nothing but simply return the same `None` value again:

```java
defn double(v) ^v * 2;

Id@ 21 ~map double;     // Id{42}
None@ ~map double;      // None
```

**Note:** The `double()` invocation won't happen for the `None@`-constructed monadic value.

### Monadic Bind

Monadic values also (obviously!) support the `~bind` comprehension:

```java
defn double(v) ^v * 2;

def m: Id@ 21;

m ~bind (double +> Id.@);        // Id{42}
m ~flatMap (double +> Id.@);     // Id{42}
m ~chain (double +> Id.@);       // Id{42}
m ~< (double +> Id.@);           // Id{42}
```

**Note:** As shown, for convenience/familiarity sake, `~flatMap`, `~chain` and `~<` are all aliases for the `~bind` comprehension. All 4 are interchangeable, but for brevity sake, `~<` is generally most preferable.

### The Monad Laws

For formality sake, here are the 3 monad laws demonstrated, using the `Id` monad (via its `@` unit-constructor) and the `~<` *bind* operator:

1. **Left Identity:**

    ```java
    defn incM(v) ^(Id@ v + 1);

    Id@ 41 ~< incM;
    // Id{42}
    ```

2. **Right Identity:**

    ```java
    Id@ 42 ~< Id.@;
    // Id{42}
    ```

3. **Associativity:**

    ```java
    defn incM(v) ^(Id@ v + 1);
    defn doubleM(v) ^(Id@ v * 2);

    Id@ 20 ~< incM ~< doubleM;
    // Id{42}

    Id@ 20 ~< (v) {
        incM(v) ~< doubleM;
    };
    // Id{42}
    ```

### Monadic Do Comprehension

Recall the [*do comprehension* for lists](#do-comprehension-list) with the `~<<` operator.

In the same way that `~<<` makes it convenient to compose multiple list comprehensions (via `~<` *chain*ing) while accessing values from each within a single scope, the same is possible and useful for monadic comprehensions.

Here's the nested `~<` form:

```java
defn inc(v) ^v + 1;
defn double(v) ^v * 2;

def incM: inc +> Id@;
def doubleM: double +> Id@;

incM(1) ~< (x) {
    doubleM(x) ~< (y) {
        Id@ (3 * x) + y;
    }
};
// Id{10}
```

To have access to both `x` and `y` in the final *chain* step, we used a nested scope. Alternatively, you could pack both values into a Record/Tuple to pass into the final step, but that's even uglier.

Here's the more ergonomic `~<<` *do comprehension* form:

```java
Id ~<< (x:: incM(1), y:: doubleM(x)) {
    (3 * x) + y;
};
// Id{10}

// or:

Id ~<< {
    def x:: incM(1);
    def y:: doubleM(x);
    (3 * x) + y;
};
// Id{10}
```

**Note:** These should look familiar to the various styles presented in the [Do Comprehension (List)](#do-comprehension-list) section earlier.

In these snippets, the only substantive difference from the list comprehension form is the `Id` (monad type) being passed as the first (*range*) operand to `~<<`. This provides the *type* of monad to wrap (via its `@` unit constructor) around the final computed value. Remember: if omitted, a general list (Tuple) type is assumed, which is *not* desired here.

Don't forget the special `$` prefix on the final expression, in case you need to omit the automatic monadic type wrapping:

```java
defn compute(x,y) ^Id@ ((3 * x) + y);

Id ~<< {
    def x:: incM(1);
    def y:: doubleM(x);
    compute(x,y);
};
// Id{Id{10}}            <-- oops!

Id ~<< {
    def x:: incM(1);
    def y:: doubleM(x);
    $compute(x,y);   // <-- notice $
};
// Id{10}
```

### Monadic Function Returns

A function's return value can be explicitly expressed monadically:

```java
defn incM(v) ^(Id@ v + 1);

incM(3);                // Id{4}
```

Non-monadic-returning functions can also be composed with the intended unit constructor:

```java
defn inc(v) ^v + 1;
def incM: inc +> Id.@;

incM(3);                // Id{4}
```

That approach is often useful if the non-monadic-returning function is already independently defined, so effectively a monad is just being *wrapped* around the function's return value.

Monadic function returns can also be integrated directly into a function's logic:

```java
defn factorialM(v,tot:? Id@ 1) ![v ?> 1]: tot {
    tot := tot ~map (t) { t * v; };
    ^factorialM(v - 1,tot);
};

factorialM(5);                   // Id{120}
```

### Pattern Matching Monads

You can use [pattern matching](#pattern-matching) to determine which type of monad instance is being dealt with:

```java
def m: getSomeMonad(42);

?(m){
    ?[?as Id, ?as Right]: something(m);
    ?[?as None]: something(m,"default!");
    ?[?as Left]: something(m,"oops");
    ?: something(Left@ "Unknown!","oops")
};
```

**Note:** More on [types and the `?as` operator](#type-annotations) later.

### `List` Monad

For something to be a monad, we need it to be able to satisfy [the 3 monadic laws](#the-monad-laws). In particular, it needs a *bind* operation and it needs a unit constructor.

Well... we've already seen that lists (Tuples) have the `~<` (aka `~flatMap`, `~bind`, or `~chain`) operator defined. So, all we're missing is a unit constructor for a list (Tuple).

Thankfully, **Foi** provides `List`, such that `List@` produces `<>` and `List @ 42` produces `< 42 >`.

We can thus prove `List` (any Tuple) is a monad:

```java
defn incM(v) ^(List@ v + 1);
defn doubleM(v) ^(List@ v * 2);

// (1) Left Identity:
List@ 41 ~< incM;
// < 42 >

// (2) Right Identity:
List@ 42 ~< List.@;
// < 42 >

// (3) Associativity:
List@ 20 ~< incM ~< doubleM;
// < 42 >

List@ 20 ~< (v) {
    incM(v) ~< doubleM;
};
// < 42 >
```

So, there you go: the `List` monad.

### `Maybe` Monad

The `Id` and `None` monads are paired in the `Maybe` Sum type monad. For readability preferences, `Maybe.None` is an alias for `None`, and `Maybe.Id` is an alias for `Id`. Moreover, to adhere to the monadic laws, `Maybe@` is the same as `Id@`:

```java
Maybe@ 42;              // Id{42}
Maybe@ empty;           // Id{empty}
Id@ empty;              // Id{empty}
None@;                  // None
```

But that's not particularly useful or interesting: we could already select `Id` or `None` explicitly.

A special `Maybe.from@` constructor (not the main unit constructor) inspects the provided value and selects `None` when it encounters the `empty` value, and `Id` for any other value:

```java
Maybe.from@ 42;            // Id{42}
Maybe.from@ empty;         // None
```

Instead of using `Maybe.from@`, you can define custom constructor functions that select `None` or `Id` for various values:

```java
defn nonZero@(v)
    ?[v ?= 0]: None@
    ^Id@ v;

def qty: nonZero@ 0;            // None
def cost: nonZero@ 1.99;        // Id{1.99}
```

**NOTE:** The `@` suffix in `defn nonZero@` is *required* to opt the function into `@` call syntax like `nonZero@ 1.99`. If you left the `@` off the definition, then the calls must look like `nonZero(0)` and `nonZero(1.99)`, respectively.

One common idiom where `Maybe` is used is conditional property access:

```java
defn prop(name)(obj) ^Maybe.from@ obj[name];

def order: Id@ <
    shippingAddress: <
        street: "123 Easy St",
        city: "TX",
        zip: "78889"
    >
>;

order
~< prop("shippingAddress")
~< prop("street");
// Id{"123 Easy St"}

order
~< prop("billingAddress")
~< prop("street");
// None
```

----

As with other monad kinds, `Maybe` has a `~<<` *do comprehension* form:

```java
Maybe ~<< {
    def shipAddr:: prop("shippingAddress",order);
    def street:: prop("street",shipAddr);
    Id ~<< (streetV:: street) {
        log(`"Street: `streetV`");
    };
};
// Street: 123 Easy St

Maybe ~<< {
    def billAddr:: prop("billingAddress",order);
    def street:: prop("street",billAddr);
    Id ~<< (streetV:: street) {
        log(`"Street: `streetV`");
    };
};
// None
```

Since the `prop("billingAddress",order)` returns a `None`, the rest of that second `Maybe ~<< {    }` *do comprehension* will short-circuit exit.

### Foldable / Catamorphism

We briefly mentioned Foldable earlier, with the `~fold` comprehension on lists (Tuples). We'll revisit the generalized Foldable (more broadly, Catamorphism) behavior now, in the context of monads.

Sum type monads in **Foi** have Foldable behavior built-in, expressed with the `~fold` / `~cata` (catamorphism) comprehensions.

For a monadic value *range*, the `~fold` / `~cata` comprehensions require multiple *iteration* expressions, one for each component of the Sum type; again, because this means 3 or more operands, the operator must be invoked as a function.

The difference between monadic `~fold` and `~cata` is with the *default iteration* operand. For `~fold`, this operand is an already computed *default-value*, whereas for `~cata` it's a function that computes a value. In either case, this operand is evaluated/used when the first/left-most component of the Sum type is encountered.

Let's consider a binary Sum type like `Maybe` (comprised of `None` and `Id`), which thus requires a *range* expression and **two** *iteration* expressions. For `None`, the *default iteration* expression (second operand, `"defaultMsg`s below) is evaluated; for `Id`, the *alternate iteration* expression (third operand, `(@)`s below) is invoked.

For example:

```java
def defaultMsg: (@)|"Default!"|;

def m: Maybe.from@ 42;                 // Id{42}
def g: Maybe.from@ empty;              // None

(~fold)(m, defaultMsg(), (@));        // 42
(~cata)(g, defaultMsg,   (@));        // Default!
```

As shown, for the `~fold` comprehension, we provide the already-computed result of the `defaultMsg()` function for the *default iteration* operand. With `~cata`, we provide that `defaultMsg` function reference, for it to be invoked only if needed.

**Note:** Folding (Catamorphism) of a monadic value *often* performs a *natural transformation* to another monadic type (via its unit constructor). Extracting a value (via identity `@` as shown) is a much less typical usage; that's merely convenient for illustration purposes here.

----

There's some useful conceptual symmetry to recognize, specifically between `~fold`ing a list (Tuple) with an *initial-value*, versus `~fold`ing a binary Sum type:

```java
defn two() ^2;
defn mult(x,y) ^x * y;

def list: < 1, 3, 7 >;
def m: Maybe.from@ 42;

(~fold)(list,  two(), mult);    // 42

(~fold)(m,     two(), (@) );    // 42
(~fold)(None@, two(), (@) );    // 2
```

For the list (Tuple) `~fold`, the `two()` function is eagerly invoked to provide the *initial-value* operand for the folding.

For the monadic `~fold`, the `two()` instead provides the *default-value* operand (used in the case of a `None` instance).

### `Either` Monad

The `Either` monad is another binary Sum type, pairing `Left` and `Right`. For readability preferences, `Either.Left` is an alias for `Left`, and `Either.Right` is an alias for `Right`. Also, the `Either@` unit constructor is an alias for `Right@`.

`Either` is typically used for error flow-control in FP programs (as opposed to exception handling).

By holding an error message in a `Left` -- similar to `None`, except it can represent an affirmative value -- this error message can propagate through monadic operations (which are skipped), until the program handles the message. `Right` is like `Id`, in that it only holds some *success* value, and all its comprehensions are valid.

In this example, the error message specified for `halve(0)` sets `e1` as a `Left`, and thus its associated `~map` comprehension does nothing:

```java
defn print(v) ^log(`"Value: `v`");
defn halve(v)
    ![v ?> 1]: Left@ "Value must be greater than 1"
    ![mod(v,2) ?= 0]: Right@ (v + 1) / 2
    ^Right@ v / 2;

def e1: halve(0);   // Left{"Value must be greater than 1"}
def e2: halve(4);   // Right{2}

e1 ~map print;      // Left{"Value must be greater than 1"}
e2 ~map print;      // Value: 2
```

Both `Maybe` and `Either` are foldable, so we can define *natural transformations* between them:

```java
defn halve(v)
    ![v ?> 1]: Left@ "Value must be greater than 1"
    ![mod(v,2) ?= 0]: Right@ (v + 1) / 2
    ^Right@ v / 2;

// natural transformation utilities
defn maybeFromEither(e)
    ^(~fold)(e, None.@, Id.@);
defn eitherFromMaybe(m)
    ^(~fold)(m, Left@|"Missing!"|, Right.@);

def m1: halve(0) #> maybeFromEither;      // None
def m2: halve(4) #> maybeFromEither;      // Id{2}

(~cata)(eitherFromMaybe(m1), (@), (@) );  // "Missing!"
(~cata)(eitherFromMaybe(m2), (@), (@) );  // 2
```

Above, `halve(0)` returns a `Left` holding the error message, which we then transform to a `None` with the `maybeFromEither()` utility. `halve(4)` produces a `Right{2}`, which is transformed to `Id{2}`.

Then, for `m1` and `m2` instances, we perform a *natural* transformation back to `Either`, with the `eitherFromMaybe()` utility. We fold the resulting `Either` instances, extracting the values (via `(@)` identity function): `"Missing!"` and `2`, respectively.

## Broader Category Theory Capabilities

So far, we've seen several behaviors/capabilities that are organized within broader Category Theory, such as Functor/Mappable (with `~map` comprehension), [Monad](#monads-and-friends) (with `~<` bind/chain comprehension), and [Foldable](#foldable--catamorphism) (with `~fold` / `~cata` comprehension).

But there are certainly other capabilities/behaviors to consider. While they may often show up adjacent to monads, these are separate topics.

### Applicative

Applicative is a pattern for holding a function in a monadic instance, then "applying" the underlying value from another monadic instance as an input to this function, returning the result back as another monadic value.

If the function requires multiple inputs, this "application" can be performed multiple times, providing one input at a time.

Here's how we can perform *Applicative* with `~<` and `~map`:

```java
defn add(x)(y) ^x + y;

def three: Id@ 3;
def four: Id@ 4;

(Id@ add)
    ~< (fn) {
        three ~map fn
    }
    ~< (fn) {
        four ~map fn
    };
// Id{7}
```

In this snippet, the `add()` function is wrapped in an `Id`, and then `~<` chained to access the `fn` it holds. That function is used to *map* the `three` monad, which calls `add(3)` and wraps the curried function back in another `Id`.

*That* `Id` is then `~<` chained again to access the curried function `fn`, and *that* function is used to *map* the `four` monad. This invokes `add(3)(4)` producing `7`, and then wraps that in yet another `Id`.

Restating: *Applicative* is pattern to *apply* the value(s) held in one or more monads, one at a time, as the inputs to a curried function (also held in a monad).

Of course, we could define a function helper to make this process a little cleaner:

```java
defn add(x)(y) ^x + y;
defn ap(m2)(m1) ^m1 ~< (fn) { m2 ~map fn; };

def three: Id@ 3;
def four: Id@ 4;

(Id@ add)
    #> ap(three)
    #> ap(four);
// Id{7}
```

However, for further built-in convenience and expressiveness, **Foi** provides the `~ap` operator:

```java
defn add(x)(y) ^x + y;

def three: Id@ 3;
def four: Id@ 4;

(Id@ add)
    ~ap three
    ~ap four;
// Id{7}
```

### Concatable / Semigroup

Concatable (formally, Semigroup) defines the ability for values to be "concatenated" (combined with each other).

We've already seen a number of value types in **Foi** that are concatable. For example: strings and numbers. In fact, the `+` operator invokes the underlying *concatable* behavior for all such value types:

```java
1 + 2 + 3 + 4 + 5;                  // 15
(+)(1, 2, 3, 4, 5);                 // 15

"Hello" + " " + "world";            // "Hello world"
(+)("Hello", " ", "world");         // "Hello world"
```

Most monadic values in **Foi** also implement Concatable, meaning that if used with `+`, they will delegate concatenation to their underlying value (if it is also Concatable):

```java
(Id@ 30) + (Id@ 12);
// Id{42}

(+)(Id@"Hello", Id@" ", Id@"world");
// Id{"Hello world"}
```

### Monoid

Monoid is a Semigroup plus an "empty value" -- such that when concatenated with, the original value is unchanged. For example, these are all monoids:

* string concatenation with the `""` (empty string)
* numeric addition with the `0` (empty number)
* list (Tuple) concatenation with the `<>` (empty list/Tuple)

Revisiting concatenation from the previous section, a concatenation is a specialized type of fold, so we can use the list (Tuple) `~fold` comprehension together with the `+` operator:

```java
(~fold)(< "Hello", " ", "world" >, (+));
// "Hello world"
```

We can do the same with a list (Tuple) of monadic (monoidal) values:

```java
(~fold)(< Id@ "Hello", Id@ " ", Id@ "world" >, (+));
// Id{"Hello world"}
```

It can be useful to perform a mapping on each of a list's values as they're being folded/concatenated, especially when that mapping is to lift non-monadic-but-monoidal values into monads.

The `~foldMap` comprehension does so, while applying the `+` concatenation as its *fold*:

```java
< "Hello", " ", "world" > ~foldMap Id@;
// Id{"Hello world"}
```

As shown, the `Id@` unit constructor maps each string to a monad, and then since the `Id` monad has a *concatenation* monoid (`+`) defined -- and the underlying string values are monoidal with a `+`string *concatenation* -- `~foldMap` then folds the monads (monoids) together, producing the single `Id{"Hello world"}` value.

----

For the list (Tuple) `~fold` comprehension, recall that:

* To perform a *fold*, at least two values are necessary, either both in the list (Tuple) to *fold*, or one value in the list and the *initial-value* provided in the expanded `~fold` form.

* If there's only one value provided, the *iteration* is skipped and that value is simply returned.

* If there's no value available, the `~fold` operation is invalid and returns `empty`; configure **Foi** to report a warning in such a case.

Thankfully, this familiar behavior is defined the same for `~foldMap`. Thus, if the list (Tuple) only has one element, the "empty value" of a monoid (`""` below) is a useful candidate to provide as the *default-value*, to ensure a *fold* actually occurs:

```java
(~foldMap)(< "Hello" >, "", Id.@);
// Id{"Hello"}
```

----

To define any custom monoid, provide a suitable "empty value", as an *initial-value* to the `~fold` / `~foldMap` operations.

For example, we could define a monoid as the boolean-AND (`?and`) *concatenation* of two boolean values, with `true` as the "empty value". And we can do similarly for the boolean-OR (`?or`) operation, with `false`.

Consider:

```java
defn all(bools) ^(~fold)(bools, true, (?and));
defn any(bools) ^(~fold)(bools, false, (?or));

def a: < true, true, true, true >;
def b: < true, false, true, true >;

all(a);     // true
all(b);     // false

any(b);     // true
```

The above is a nice application of a monoid, but the `?and` and `?or` operators are already n-ary, thus we could have done:

```java
defn all(bools) ^(~fold)(bools, true, (?and));
defn any(bools) ^(~fold)(bools, false, (?or));

def a: < true, true, true, true >;
def b: < true, false, true, true >;

all(a);     // true
all(b);     // false

any(b);     // true
```

So how do we apply this approach for monadic values such as `Id{true}`?

We *have* already identified the necessary monoidal empty value (`true` or `false`), which can be wrapped in `Id` (i.e., `Id{true}` and `Id{false}`). However, there's no default *concatenation* operation (`+`) defined for booleans in **Foi**; how could it know automatically whether the *concatenation* of booleans should be computed with logical-AND or logical-OR!?

Moreover, even if there were such a default `+` concatenation for booleans, the `?and` and `?or` operators are not monad-aware.

So, let's instead define custom, monad-aware concatenation logic (`andM()` and `orM()` below):

```java
defn andM(x,y) ^x ~map (xv) { xv ?and y; };
defn orM(x,y) ^x ~map (xv) { xv ?or y; };

defn all(bools) ^(~fold)(bools, Id@ true, andM);
defn any(bools) ^(~fold)(bools, Id@ false, orM);

def a: < true, true, true, true >;
def b: < true, false, true, true >;

all(a);     // Id{true}
all(b);     // Id{false}

any(b);     // Id{true}
```

`~fold` is more flexible in letting you specify custom *fold*ing (concatenation) logic for values. By contrast, `~foldMap` assumes/relies on the built-in `+` operation for values being *fold*ed (and recursively, concatenating underlying values).

## Concurrency / Asynchrony

**Foi** does not have any concurrency or asynchrony built natively into it. However, programs absolutely perform and respond to external operations that are inherently concurrent/asynchronous -- network calls, file system, timers, etc.

As such, there are a variety of language features for *managing* concurrency. These features are oriented around data transmission, but they can also be used more generally for asynchronous flow control.

**Note:** all of these features inherently operate synchronously in the language. Only external mechanisms outside the program can influence a non-synchronous delay into the program.

### `Promise` Monad

The most basic component of **Foi** concurrency/asynchrony is `Promise`. It resembles promises in other languages (JS, etc), but has some important differences.

Most importantly, `Promise` *transforms over* `Either`: the value slot inside a `Promise` is always `Right@ v` (fulfillment) or `Left@ reason` (rejection). Composition sees through the `Right` branch to the underlying value; a `Left` short-circuits the chain. `Promise` has no separate rejection channel -- success and failure are entirely the two `Either` branches.

The async layer sits on top of that. A `Promise` may already be *resolved* at construction, or *pending* awaiting an external resolution. Operations (`~map`, `~<`) composed against a pending promise are deferred; once the promise resolves, deferred operations fire synchronously against the resolved `Either`, and any further operations run synchronously from then on.

You *can* construct a `Promise` instance that's already resolved. The general-form unit constructor takes an `Either`:

```java
def pr: Promise@ (Right@ 21);
// Promise{Right{21}}
```

More commonly, use the named unit constructors `Promise.honor@` (wraps in `Right`) or `Promise.renege@` (wraps in `Left`):

```java
def pr: Promise.honor@ 21;
// Promise{Right{21}}

pr.resolved();
// true

pr ~map (v) {
    v * 2;
};
// Promise{Right{42}}
```

Notice `~map`'s block binds `v` directly to `21` (the `Right` payload), not to `Right@ 21` -- Foi's `Promise` treats the `Either` branch discriminator as invariant, not as a separate unwrap layer.

#### Deferred `Promise` Resolution

If you're constructing a `Promise` that will be resolved later, you construct a *subject*.

A subject exposes `.pr` (the associated pending promise). Applying `%` to the subject with an `Either` payload resolves the promise. Either branch is admitted -- a `Right@` payload *honors* (fulfills) the promise, and a `Left@` payload *reneges* (rejects) it.

Honoring:

```java
def subj: Promise.subj@;

subj.pr.resolved();
// false

def pr2: subj.pr ~map (v) {
    v * 2;
};
// Promise{..pending..}

pr2 ~map (v) {
    log(`"v: `v`");
};
// Promise{..pending..}

subj% (Right@ 21);
// Right{21}
// v: 42
```

The `%` broadcasts the `Either` resolution to any deferred operations; each `~map` fires synchronously once the promise settles on `Right`.

Reneging looks the same shape, but the `Left` propagates through the deferred chain without firing any `~map`s:

```java
def subj: Promise.subj@;

def pr2: subj.pr ~map (v) {
    v * 2;
};
// Promise{..pending..}

pr2 ~map (v) {
    log(`"v: `v`");
};
// Promise{..pending..}

subj% (Left@ "cancelled");
// Left{"cancelled"}
```

Neither `~map` fires -- `~map` on a `Promise` sees through `Right` and forwards `Left` unchanged. The chain resolves to `Promise{Left{"cancelled"}}` without touching any of the deferred callbacks.

Fork on success/failure by inspecting the payload with `~cata`:

```java
defn fetchCustomers() { ..returns promise.. };

defn getCacheData(key)
    ![cache ?has key]: Promise.renege@ "Not in cache"
    ^Promise.honor@ cache[key];

(~cata)(
    getCacheData("customers"),
    fetchCustomers,
    Promise.honor.@
)
    ~map printRecords;
// Promise{..pending..}
```

The `getCacheData()` function produces a `Promise{Either}` value, which resolves to a `Left` on failure or `Right` on success.

We use the `Left` to fetch the customers remotely, or the `Right` to simply wrap it back into an honored promise, so both branches match `Promise` shape for the next step, which invokes `printRecords()`.

#### `Promise ~<<` Do-Comprehension

Instead of constructing multi-step `~<` / `~map` chains, `Promise` also supports the helpful [`~<<` *do comprehension*](#monadic-do-comprehension). The promise chain from the above snippet could instead be expressed as:

```java
Promise ~<< {
    def customers:: (~cata)(
        getCacheData("customers"),
        fetchCustomers,
        Promise.honor.@
    );
    printRecords(customers);
};
// Promise{..pending..}
```

If the promises returned from `getCacheData()` or the `~cata` operation are pending when encountered, the rest of the *do comprehension* block is suspended until the promise resolves. `Promise ~<<` is Either-aware -- `::` binds see through `Right` to the underlying value, and a `Left` mid-chain short-circuits the block.

**Note:** `async..await` in JS (and other languages) *is* `Promise ~<<` do-notation. `await expr` is bind on the Promise monad -- the same operation `def x:: expr` performs inside the block above. What those languages present as dedicated asynchrony sugar is Promise's monadic do-notation with the monad hidden behind a keyword.

#### Eager Asynchronous Iteration

One question that may now come to mind: how can you perform *asynchronous comprehensions* (looping), where a pending promise suspends the sequential iteration/looping as each step resolves?

Here's one way, expressed as async recursion:

```java
defn printResponses(prs)
    ![size(prs) ?> 0]: Promise.honor@ "Complete."
{
    ^prs.0 ~< (resp) {
        log(`"resp: `resp`");
        printResponses(prs.[1..]);
    };
};

printResponses(urls ~map fetch)
    ~map log;
// Promise{..pending..}
//
// ... eventually ...
//
// resp: response 1
// resp: response 2
// resp: response 3
// Complete.
```

`printResponses()` walks the `prs` list sequentially, chaining the recursive call off each resolved promise so each response is logged before the next request is awaited.

That approach works, but it's a bit convoluted.

The `~<<` *do comprehension* on `List{Promise}` handles the same shape directly: iterate a list of promises, awaiting each before the block body runs for it.

Consider:

```java
defn printResponses(prs) ^(
    List{Promise} ~<< (resp:: prs) {
        log(`"resp: `resp`");
    }
        ~map { "Complete." }
);

printResponses(urls ~map fetch)
    ~map log;
// Promise{..pending..}
//
// ... eventually ...
//
// resp: response 1
// resp: response 2
// resp: response 3
// Complete.
```

The `{Promise}` compound annotation on the iterating `List` outer signals per-element awaiting -- each element is awaited before the block runs for it. The whole comprehension resolves to a promise that settles once the list is drained; the trailing `~map` swaps in `"Complete."` as the final resolved value, matching the recursive form's return shape so the call site's `~map log` prints the completion message.

**Note:** For the parallel-await case -- fire all requests concurrently and wait for the batch -- use `Promise.all@` (below).

#### `Promise` Combinators

It's common to want to perform operations across multiple promises. Two such promise combinators come built into **Foi**.

`Promise.race@` creates a promise that will resolve as soon as the first promise in the provided list resolves (left-to-right tie breaking):

```java
def subj1: Promise.subj@;
def subj2: Promise.subj@;

Promise.race@ < subj1.pr, subj2.pr >
    ~map (v) {
        log(`"Value: `v`");
    };
// Promise{..pending..}

subj2% (Right@ 42);
// Right{42}
// Value: 42

subj1% (Right@ 10);
// Right{10}
```

`Promise.all@` creates a promise that will resolve once all promises in the provided list have resolved; the resolved value will be a list of those source promise resolutions in the same order as the list provided to `Promise.all@`, regardless of the order of resolution operations:

```java
def subj1: Promise.subj@;
def subj2: Promise.subj@;

Promise.all@ < subj1.pr, subj2.pr >
    ~map (vals) {
        log(`"Values: `vals`");
    };
// Promise{..pending..}

subj2% (Right@ 42);
// Right{42}

subj1% (Right@ 10);
// Right{10}
// Values: < 10, 42 >
```

### `Channel`

CSP (Communicating Sequential Processes) is a classic pattern for coordinating data transmission. It's primarily used in languages like Go and Clojure, though it's been implemented in many others (including JS).

CSP Channels are a mechanism primarily useful for coordinating communication of values between separate (independent) aspects of a program, without these aspects needing to *know* about each other explicitly; the only thing they *share* is the *channel* communication conduit.

One such common coordination pattern is referred to as "back pressure", in that the producer(s) of a value into a channel is throttled to produce no faster than the consumer(s) of that channel are willing to take these values out.

----

**Foi** defines CSP as a first class feature, via the `Channel` type.

It's important to distinguish: a `Channel` instance is not *itself* monadic -- it has no `~<` / `~map` defined. However, all the operations on `Channel` instances produce `Promise` monad instances, so you still interact with `Channel` in a monadic-oriented way.

A channel is a container (by default, with no internal buffer) where both the putting-in of a value (`put()`) and reading-out of a value (`take()`) are *coordinated*. Both operations produce a `Promise` instance, and these promises won't resolve until both operations have occurred (regardless of ordering).

Both operations' promises resolve with `Either` values, indicating (eventual) success/failure of the operation.

Consider these illustrative helpers, which we'll use throughout the rest of our CSP examples:

```java
defn putVal(ch,v) ^(
    ch.push(v)
    ~map (ev) {
        Either ~<< (v:: ev) {
            log(`"Value put: `v`");
        };
    }
);

defn takeVal(ch) ^(
    ch.take()
    ~map (ev) {
        Either ~<< (v:: ev) {
            log(`"Value taken: `v`");
        };
    }
);
```

**Note:** Notice the `Either ~<< {    }` *do comprehensions* again neatly and conditionally handle the `Either` instance, either invoking `log()` or short-circuiting out of the block with a `Left`.

Now, let's create a channel and use those helpers:

```java
def ch: Channel@;

putVal(ch,42);
// Promise{..pending..}

takeVal(ch);
// Promise{}
// Value put: 42
// Value taken: 42
```

As you can see, the initial `put()` is pending until the corresponding `take()` occurs.

Multiple `put()` operations can be queued up, and each subsequent `take()` will pull the next value in order off the "queue".

```java
def ch: Channel@;

putVal(ch,42);
// Promise{..pending..}

putVal(ch,100);
// Promise{..pending..}

takeVal(ch);
// Promise{}
// Value put: 42
// Value taken: 42

takeVal(ch);
// Promise{}
// Value put: 100
// Value taken: 100
```

**Note:** Don't think of queued `put()` operations as a *buffer*. Regardless of implementation details, the best way to think of these queued `put()`s, are as values that are waiting to go into the channel, rather than values that are already in the channel. That's why we don't see the `"Value put: 100"` confirmation above until the `100` is being taken from the channel. In other words, channel is creating an implicit *dependent relationship* between each attempted `put()` and its corresponding `take()`. Channel buffering is a separate concept we'll cover in a bit.

We can also attempt a `take()` before a corresponding `put()`:

```java
def ch: Channel@;

takeVal(ch);
// Promise{..pending..}

putVal(ch,42);
// Promise{}
// Value taken: 42
// Value put: 42
```

And of course, multiple `take()` operations can be queued, satisfied sequentially by subsequent `put()` operations:

```java
def ch: Channel@;

takeVal(ch);
// Promise{..pending..}

takeVal(ch);
// Promise{..pending..}

putVal(ch,42);
// Promise{}
// Value taken: 42
// Value put: 42

putVal(ch,100);
// Promise{}
// Value taken: 100
// Value put: 100
```

**Note:** Again, don't think of multiple pending `take()`s as *buffered*, but rather as externally pending operations, until satisfied by corresponding `put()`s.

----

Recall the `~<*` async-comprehension discussed in the `Promise` section. It's quite useful for explicitly coordinating a queue of `put()`s and/or `take()`s:

```java
def ch: Channel@;

1..3 ~<* (v) {
    ::putVal(ch,v);
};
// Promise{..pending..}

// elsewhere:
Promise ~<* {
    ::takeVal(ch);
};
// Value put: 1
// Value taken: 1
// Value put: 2
// Value taken: 2
// Value put: 3
// Value taken: 3
```

The `putVal()` loop above terminates once the `1..3` *range* is eventually completed. However, the `Promise ~<* {    }` loop will remain in a paused state, waiting for the next value to come into the channel.

You may recall that `~<*` terminates only when the **final expression** resolves to a `Left`. The only way a `Channel` instance's `take()` can resolve to a `Left` is when the channel itself is closed.

So, if we issued `ch.close()` in the above program:

```java
ch.close();
// Right{true}
// Error: Channel already closed
```

The `close()` above returns `Right{true}` indicating it was successful in closing the channel.

**Note:** Subsequent `close()` calls on an already closed channel will return `Left{"Channel already closed"}`.

After closing, the pending `take()` (from inside `takeVal()`) is resolved with a `Left{"Channel already closed"}`; that short-circuits out of the `Either` *do comprehension*..

Finally, the paused `~<*` loop will terminate, when encountering that `Left{"Channel already closed"}` value.

----

As illustrated so far, channels by default have no internal buffering.

But you can override this when you construct a channel; if you set a positive integer for a buffer size, that many values may be accepted into the channel (immediately resolving the `put()`s) even before the corresponding `take()`s are received.

Buffering a channel is useful for allowing the producer side of a channel to be less back-pressure bounded to the consumer.

**Warning:** A very high value of buffer size effectively eliminates back pressure from the channel. However, you should reconsider doing so; this coordination between producer and consumer is the main point and spirit of CSP. If you really need unbounded producer-side messaging without such coordination, a `PushStream` (covered later) is a better fit.

Consider:

```java
def ch: Channel@ 3;

1..3 ~each (v) { putVal(ch,v); };
// Value put: 1
// Value put: 2
// Value put: 3

putVal(ch,4);
// Promise{..pending..}

Promise ~<* {
    ::takeVal(ch);
};
// Value put: 4
// Value taken: 1
// Value taken: 2
// Value taken: 3
// Value taken: 4

ch.close();
// Right{true}
// Error: Channel already closed
```

Any `put()` that occurs while a buffer has capacity produces an immediately resolved promise, as shown by the messages printed during the `~each` loop.

But as shown by `putVal(ch,4)` above, any `put()` that occurs while a buffer is at capacity (and no `take()`s are pending) produces a pending promise. In other words, it behaves exactly the same as on a channel with buffer size of `0` (as default).

If a `put()` is pending when a `take()` frees up capacity in the buffer, that pending `put()` is immediately resolved and its value is treated as being placed into the internal buffer. That's illustrated by the timing of the `"Value put: 4"` message above.

----

Aside from `take()`, it can also be useful to `peek()` at a channel, and *see* a value that's `put()` into it, even if there's no `take()` yet to actually retrieve it.

A `peek()` operation also produces a pending promise (until any attempted `put()`), but all *peeks* will see the same value once the next `put()` is queued and until that value is `take()`n out of the channel. In other words, `peek()` operations don't *queue* (stack on each other sequentially) the way `puts()` and `takes()` do.

Consider:

```java
defn peekAt(ch,idx) ^(
    ch.peek()
    ~map (v) {
        log(`"Peeking at value: `v`");
        v;
    }
);

def ch: Channel@;

1..3 ~each (idx) {
    peekAt(idx,ch);
};

putVal(ch,42);
// Promise{..pending..}
// Peeking at value: 42
// Peeking at value: 42
// Peeking at value: 42

peekAt(ch,4);
// Promise{42}
// Peeking at value: 42

takeVal(ch);
// Promise{}
// Value put: 42
// Value taken: 42

peekAt(ch,5);
// Promise{..pending..}
```

The spirit of CSP channels is that the primary *read* operation should be `take()`, not `peek()`.

But peeking is especially useful when coordinating (without side effects) `take()`s from multiple channels. For example: a merge operation (i.e., first-come-first-served race), or a zip operation (i.e., wait for all channels to have a value before taking them).

The merge/race operation can be performed with the `alts()` utility:

```java
def nextVal: alts(< ch1, ch2, ch3, ch4 >);
// Promise{..pending..}
```

The first channel (left to right) that has a value available (via a `put()`) will resolve the pending promise, with a record that has a `value` property with the value, and a `channel` property holding the channel the value came from.

Races like this are often used for "timeouts", where you wait for a value from a channel for only a certain amount of time, and if the timeout expires, a value comes in on a second channel, thereby short-circuiting the waiting for a value from the first channel.

**Warning:** This ordered behavior means that if `ch1` always has values available, it can *starve out* any attempt for `ch2`, `ch3`, and `ch4` channels to transmit their values. To guard against such starvation, programs should be careful to perform some shuffling of the list order provided to `alts()`, perhaps just a simple round-robin strategy.

The zip/all operation can be performed with `every()`:

```java
def nextVal: every(< ch1, ch2, ch3, ch4 >);
// Promise{..pending..}
```

The promise from `every()` will resolve once a value is available from all channels, and will contain a list of these values in the same order as provided to `every()`, regardless of what order the arrive in.

### `PushStream` Monad

If you need a producer side to be unrestrained from the consumer side, the data transmission mechanism best suited is the `PushStream` monad.

Unlike `Channel`, a `PushStream` is *hot* (producers push independently of subscribers) and *broadcast* (every subscribed observer receives every value pushed). There's no back-pressure coordination, and no replay -- values pushed before an observer subscribes aren't delivered to it.

Subscription in **Foi** is also *idempotent*: subscribing an observer to a source it's already subscribed to is a no-op, not a second subscription. This is a language-level invariant, applied uniformly across the chain operators (`~<`, `~map`), the `~<*` composition form, and every combinator.

#### Constructing A `PushStream`

For `PushStream`, the `PushStream.subj@` unit constructor produces a *subject* -- a paired write handle (the subject itself) and read handle (the associated stream). The subject can broadcast values and close; the stream is a pure observer handle for subscription and chain composition.

```java
def subj: PushStream.subj@;

def s: subj.st;
```

The `.st` field is the associated stream. You can pass `subj.st` around freely -- observers only need the read side.

#### Subscribing To A `PushStream`

Chain operators (`~map`, `~<`) implicitly register a subscriber on the source and produce a derived stream. The derived stream's values are the mapped/transformed results; the fact that a subscription was registered on the source is what makes the transform fire on each broadcast.

Multiple observers on the same source each independently receive every value (broadcast):

```java
def subj: PushStream.subj@;

def observer1: subj.st ~map (v) {
    log(`"observer(1): `v`");
    v;
};

def observer2: subj.st ~map (v) {
    log(`"observer(2): `v`");
    v;
};
```

#### Pushing Into A `PushStream`

Broadcasting a value into a `PushStream` instance is done by applying `%` to its subject:

```java
def subj: PushStream.subj@;

def observer:
    subj.st ~map (v) {
        log(`"Value: `v`");
        v;
    };
// PushStream{}

subj% 1;
// Value: 1
// Promise{Right{true}}

subj% 2;
// Value: 2
// Promise{Right{true}}
```

Each `subj% v` broadcasts synchronously to all currently-subscribed observers, then returns a `Promise` resolving to `Right@ true` (or `Left@ "PushStream Closed"` if the stream has been closed).

```java
def subj: PushStream.subj@;

def observer1: subj.st ~map (v) {
    log(`"observer(1): `v`");
    v;
};

subj% 41;
// observer(1): 41
// Promise{Right{true}}

def observer2: subj.st ~map (v) {
    log(`"observer(2): `v`");
    v;
};

subj% 42;
// observer(1): 42
// observer(2): 42
// Promise{Right{true}}
```

**Note:** `observer2` above receives values only after its subscription is established -- values pushed before it subscribed aren't delivered. That's the no-replay commitment.

#### Consuming A `PushStream`

To consume a `PushStream`, running a block body for every value that comes through, use the `~<*` composition form:

```java
def subj: PushStream.subj@;

def doubled: PushStream ~<* (v:: subj.st) {
    log(`"Received: `v`");
    v * 2;
};
// PushStream{}

def watcher: doubled ~map (v) {
    log(`"Doubled: `v`");
    v;
};

subj% 1;
// Received: 1
// Doubled: 2
// Promise{Right{true}}

subj% 2;
// Received: 2
// Doubled: 4
// Promise{Right{true}}
```

`PushStream ~<* (v:: source) { .. }` registers the block body as a subscriber to `source`; the block runs per value received, and its terminal expression becomes the value emitted into the resultant stream (`doubled` above).

**Early unsubscribe.** If the terminal expression of a `~<*` block evaluates to `Left@ ..`, this observer unsubscribes from the source; the resultant stream closes as a consequence. The source stream and other subscribers are unaffected. The `Left` value is the unsubscribe signal, not itself emitted downstream.

```java
def subj: PushStream.subj@;

PushStream ~<* (v:: subj.st) {
    log(`"v: `v`");
    ?{
        [v ?>= 3]: Left@ empty;
        : v
    };
};

subj% 1;      // v: 1
subj% 2;      // v: 2
subj% 3;      // v: 3    (unsubscribes; resultant closes)
subj% 4;      // (this block no longer receives)
```

##### Built-In `PushStream` Returns

Some stdlib functions produce streams directly, without vending a subject:

```java
def logs: File.readLines@ "/tmp/log";
// PushStream{}

PushStream ~<* (line:: logs) {
    log(`"line: `line`");
};
```

Here the write side is internal to the `File.readLines@` construction; you receive the read handle only, and observe via `~<*`. Termination cascades when the underlying producer completes.

#### Closing A `PushStream`

When the stream's job is done, close the subject:

```java
def subj: PushStream.subj@;

subj.close();        // Right{true}
subj.close();        // Left{"PushStream Closed"}

subj.st.closed();               // Promise{Right{empty}}
subj.st.closed().resolved();    // true

subj% 10;            // Promise{Left{"PushStream Closed"}}
```

Closing is one-way and propagates downstream: any observer chained from a closed source also becomes closed. It doesn't propagate upstream -- closing a downstream observer doesn't close its source.

Notice the capability separation: `.close()` lives on the subject (write side); `.closed()` lives on the stream (read side). Holders of only `subj.st` can observe closed state but can't force close.

#### `PushStream` Combinators

The `PushStream` namespace exposes four named-constructor combinators for common composition patterns: `PushStream.merge@` (fan-in of multiple source streams into one), `PushStream.filter@` (forwards only values passing a predicate), `PushStream.scan@` (stateful fold across emissions), and `PushStream.takeUntil@` (forwards from a source until a signal stream emits, then closes).

These are the primitives; higher-order patterns from reactive-programming literature (switchMap, concatMap, combineLatest, debounce, throttle, etc.) are userspace compositions of these plus `~<` / `~map` / `~<*`. See the spec for details.

### `PullStream` Monad

A `PullStream` is a **cold observable**: nothing runs until a consumer subscribes, and each subscribe triggers an independent run of the pipeline. Where a `PushStream` is hot (producers broadcast to whoever is currently subscribed), a `PullStream` is inert until the consumer at its tail reaches back through the chain and starts pulling values from a buffer at the root.

The chain built with `~<` and `~map` describes the transformation the consumer will pull through. Values sit in a `PullStream.Buffer` between the external producer and the consumer; the consumer drives iteration on its own schedule via `~<<`.

`PullStream` shares the observable-monad shape with `PushStream` (`~<` and `~map` compose the same way, and the same four combinators are provided), but differs on three concrete axes:

- **Cold, not hot.** `PushStream` runs whether or not anyone is subscribed -- producers broadcast, subscribers see what arrives while they're listening. `PullStream` runs only when a consumer subscribes and drives. Between subscribe cycles the pipeline is inert.
- **No user-visible subject.** The write side is stdlib-privileged. You construct a buffer handle, hand it to a stdlib function that fills it, and consume the associated read stream from your end. There's no userland `%` on a `PullStream`.
- **Single subscribe per cycle.** A `PullStream` supports one active subscribe at a time -- one `~<<` driving one pipeline rooted at the buffer. A fresh cycle requires recycling the buffer once the current cycle closes.

#### Constructing A `PullStream`

`PullStream.withBuffer@` allocates a fresh buffer paired with its read stream:

```java
def <st, buf>: PullStream.withBuffer@ <
    capacity: 16,
    overflow: PullStream.DROP_OLDEST
>;
```

The returned tuple has two positional fields:

1. the `PullStream` reader (destructured to `st` above) -- this is what you consume.
2. the buffer handle (destructured to `buf` above) -- this is what you hand to a stdlib producer.

**Overflow policy** determines what happens when a producer tries to write into a full buffer:

- `PullStream.ERROR_ON_OVERFLOW`: the producer's write fails, surfacing as `Left@ "Buffer Full"` on its returned `Promise` or `IO`.
- `PullStream.DROP_OLDEST`: silently discard the oldest buffered value to make room.
- `PullStream.DROP_NEWEST`: silently discard the incoming value.

Capacity and overflow policy are the two knobs by which the pipeline handles producer/consumer speed mismatch (aka "back pressure").

#### Writing Into A `PullStream`

You cannot write to a `PullStream` directly. Instead, you must hand the buffer handle to a privileged (built-in) function that pushes values into it:

```java
def <lines, linesBuf>: PullStream.withBuffer@ <
    capacity: 16,
    overflow: PullStream.DROP_OLDEST
>;

File.readLines@ < path: "/tmp/log", buf: linesBuf >;
// Promise{..pending..}
```

`File.readLines@` optionally accepts the buffer handle (`buf`); it starts writing lines into `buf` on its own schedule. The returned `Promise` signals overall completion of the read, not per-value delivery.

The stdlib function handles the write side end-to-end: writing values, signaling close when its input source is exhausted, and (per overflow policy) either failing or silently discarding on overflow. From userland, the buffer just fills.

Stdlib functions that produce sequences typically overload on the presence of a buffer argument -- call with a buffer to route into it (the buffered form shown here), or without to receive a `PushStream` directly (the firehose form covered earlier in the `PushStream` section).

#### Shaping The Pipeline

`~map` and `~<` build up the pipeline that the consumer will pull through.

`~map` transforms each pulled value:

```java
def <lines, linesBuf>: PullStream.withBuffer@ <
    capacity: 16,
    overflow: PullStream.DROP_OLDEST
>;

def parsed: lines ~map parseJSON;
```

`~<` is monadic bind: for each value pulled from the source, the block returns another `PullStream`, and the derived stream forwards values from that inner pipeline before moving to the next outer value. This is essentially Rx's `concatMap` on cold sources -- subscribe to each inner in turn, drain it, move on:

```java
def <requests, requestsBuf>: PullStream.withBuffer@ <
    capacity: 8,
    overflow: PullStream.ERROR_ON_OVERFLOW
>;

def responses: requests ~< (req) {
    def <body, bodyBuf>: PullStream.withBuffer@ <
        capacity: 64,
        overflow: PullStream.DROP_OLDEST
    >;
    Http.streamBody@ < req.url, bodyBuf >;
    body;
};
```

Each request pulled from `requests` opens its own response-body pipeline; the derived `responses` stream forwards body chunks from that pipeline until it closes, then pulls the next request and opens the next body. The consumer at the tail of `responses` sees one flat stream of body chunks across all requests.

None of this actually pulls values through the streams, yet. In the above snippets, both `parsed` and `responses` are inert descriptions of the transformations that will fire when something subscribes and pulls. Constructing a derived `PullStream` without eventually consuming it is legal but pointless -- it's a binding that does nothing, same as any other unused `def`.

#### Consuming A `PullStream`

`~<<` is subscribe: it triggers the pipeline to start running, executing the block body per pulled value (driven to completion):

```java
File.readLines@ < "/tmp/log", linesBuf >;

PullStream ~<< (line:: lines) {
    log(`"line: `line`");
};
```

Each iteration reaches through whatever chain leads to the bound tail, pulls one value from the underlying buffer, walks it forward through every `~<` / `~map` / combinator transformation on the way down, and delivers the result to the block body. If the buffer is empty but not closed, the loop suspends until a value arrives. When the buffer signals close, the loop terminates.

You subscribe to any tail you want -- the root reader, or any derived stream:

```java
PullStream ~<< (obj:: parsed) {
    log(`"obj: `obj`");
};
```

Subscribing to `parsed` pulls a line from the buffer, runs it through `parseJSON` via `parsed`, and delivers the parsed object to the block body. The chain leading to the tail you subscribe to *is* the shape the consumer sees.

Binding `~<<` to a tail transitions the underlying buffer to an in-use state (`buf.ready()` returns `false`). A second `~<<` against any reader rooted at the same buffer -- whether the same tail or a different one -- raises an immediate runtime error at the binding site, before the loop iterates. `PullStream` supports one subscribe per cycle; the buffer returns to a ready state when the writer signals close, at which point it can be recycled for a fresh cycle.

`Done@` early-exit and terminal `Left@ ..` behave here as they do for other `~<<` forms.

#### Closing A `PullStream`

A `PullStream` doesn't expose an explicit close operation to userland; the buffer's producer signals end-of-input, and the runtime propagates termination through the pipeline. From the consumer's perspective, the `~<<` loop simply ends once the buffer signals close.

The buffer handle itself has a small state machine:

- **Fresh**: just constructed via `withBuffer@ < capacity: .., overflow: .. >`; no producer or consumer has taken it yet. `buf.ready()` returns `true`.
- **In use**: a producer is writing into it, or a `~<<` is subscribed to a reader rooted at it (or both). `buf.ready()` returns `false`.
- **Closed**: the producer has signaled end-of-values; the buffer purges any residual buffered values and transitions back to a ready state.

Once a buffer is closed, you can recycle it for a fresh subscribe cycle over a new stream:

```java
def <lines2, linesBuf>: PullStream.withBuffer@ < buf: linesBuf >;
```

The recycle form of `withBuffer@` takes a previously-used, closed buffer and vends a fresh `PullStream` reader over it. Capacity and overflow policy are preserved from the original construction. It's a runtime error to recycle a buffer that isn't in a ready state.

**WARNING:** Recycling a buffer **does not recycle the original stream**. With the new `PullStream` instance from recycling the buffer, you would need to redefine whatever composition chain (`~map` / `~<`), combinators, and ultimately, a single `~<<` consumption loop.

#### `PullStream` Combinators

The `PullStream` namespace exposes four named-constructor combinators paralleling `PushStream`'s: `PullStream.merge@` (fan-in of multiple source pipelines into one), `PullStream.filter@` (forwards only values passing a predicate), `PullStream.scan@` (stateful fold across pulled values), and `PullStream.takeUntil@` (forwards from a source until a signal stream emits, then closes).

These are the primitives; higher-order patterns are userspace compositions of these plus `~<` / `~map` / `~<<`. See the spec for details.

## `IO` Monad

The first and most important *rule* of FP is that you have to be very careful to minimize and control side-effects whenever and wherever possible. Mismanaged side effects are the single greatest source of bug infection in code.

One powerful tool for managing side effects in a mathematical, predictable way is the `IO` monad.

In **Foi**, the `IO` monad is special, in that it composes (implements or transforms over) multiple behaviors/types: Task (Deferred), Reader, `Promise`, and `Using` (resource acquire/release).

Let's explore each of these capabilities separately.

### Task (Deferred)

Task (Deferred) is a pattern for lazily defining a set of actions, usually performing side-effects outside the program -- printing to the console, performing network requests, reading or writing to a file system, waiting on external async operations, generating random numbers, etc.

The key is, `IO` instances are lazy; these actions **do not run automatically**. Moreover, multiple `IO` monads are chained together to compose separate units of action into a single lazy action.

To construct an `IO` instance, we give it an *executor* function that will perform the action(s) (side effects):

```java
def task: IO@ (defn someTask(){
    log("Log messages are a side effect!");
});
// (nothing)
```

Notice that the log message didn't actually happen. `IO` instances are lazy. An `IO` instance (which may be a composed chain of many `IO`s) is run on-demand (one or more times), by applying the `%` effect operator to the instance:

```java
def task: IO@ (defn someTask(){
    log("Log messages are a side effect!");
});

task%;
// Log messages are a side effect!
```

For deferred monad types like `IO` (and `State`), `%` is the paren-free unary effector operator (similar to the `@` call operator). Where `@` constructs a monadic instance *at* a certain input value, `%` does the inverse: dispatches the instance's *effect evaluation hook* -- running whatever effects the instance represents.

When you simply want to hold a value in an `IO` instance, instead of providing a function that only returns the value, we can use a special unit constructor as a shortcut:

```java
// instead of:
// def specialNumber: IO@ (defn() ^42);

def specialNumber: IO.of@ 42;

specialNumber%;        // 42
```

----

As with all monads, we can compose instances together via comprehensions like `~map` and `~<` (chain):

```java
defn double(v) ^v * 2;

defn incIO(v) ^IO.of@ (v + 1);

defn finish(v) {
    log(`"v: `v`");
    ^incIO(v);
};

def num: IO.of@ 21;

def task: num
    ~map double
    ~< finish;

task%;   // 43
// v: 42
```

#### `IO` Do

Recall the [`~<<` do-comprehension](#monadic-do-comprehension) (for monads), which gives a special syntax for chaining monadic values together a more familiar imperative-style. It's especially convenient when you might otherwise need to nest `~<` chain steps to create a shared scope for accessing values from each step together.

Because this is so common with `IO`, the *do comprehension* form is most idiomatic. The previous snippet could be done like this:

```java
(IO ~<< (v:: num) {
    def x:: doubleIO(v);
    $finish(x);
})%;   // 43
// v: 42
```

As you can see, the `v:: num` statement unwraps the `IO` instance `num`, and assigns its value to `v`. Likewise, the `def x:: doubleIO(v)` unwraps the `IO` instance that comes back from the function call, and assigns the result to `x`.

Finally, the `IO` instance from `finish(x)` is returned (without map-wrapping, due to the `$` prefix).

**NOTE:** Where `def x::` is the "receiving bind" form, `$` is the "non-receiving bind" form. If you need to bind an `IO` but don't need the value returned to the do-block, you use `$`. The above snippet uses `$` in the final position, to force a `~<` bind instead of the typical terminal `~map`.

You can interleave `def ::` and `def :` style definitions:

```java
defn readFileSync(filename) {
    // ..
    ^IO.of@ fileContents;
};

defn writeFileSync(filename,contents) {
    // ..
    ^IO.of@ res;
};

defn processFileSync(filename) ^IO ~<< {
    def text:: readFileSync(filename);
    def uptext: uppercase(text);            // <-- : instead of ::
    def res:: writeFileSync("upper.txt",uptext);
    < :res, :text >;
};

processFileSync("my-file.txt")%;
// < res: .., text: ... >
```

### Reader

Reader is a pattern for carrying a value across monadic operations, without needing a shared outer scope to access it. We typically treat the Reader value as an *environment* context that is parameterized for the IO to run against. This enables a *pure* IO that doesn't need to access anything from its outer context.

`IO` implements Reader by allowing a single argument (optional) to be applied via the `%` operator. If a Reader value is provided, it's automatically passed as the first argument to the *executor* function:

```java
def task: IO@ (defn(readerEnv){
    log(`"X: `readerEnv.x`");
});

task % < x: 42 >;
// X: 42
```

**Note:** The Reader value can be any value, but it's most commonly a Record/Tuple.

Inside a `~<` chain step, the carried Reader value can be *accessed* as so:

```java
def task:
    IO.of@ 42
    ~< (v) {
        IO@ (defn(env){
            log(`"value: `v`, env.x: `env.x`");
        });
    };

task % < x: 3 >;
// value: 42, env.x: 3
```

This is a bit ugly/awkward, but it's cleaner in *do comprehension* form to *extract* the Reader value:

```java
def fortyTwo: IO.of@ 42;

def task: IO ~<< {
    def env:: IO.ask@;
    def v:: fortyTwo;
    log(`"Value: `v`, Env.x: `env.x`");
};

task % < x: 3 >;
// Value: 42, Env.x: 3
```

Alternatively, the block definitions clause of an `IO ~<<` automatically binds and passes in the Reader value (`env` below) in the first position:

```java
def fortyTwo: IO.of@ 42;

def task: IO ~<< (env, v:: fortyTwo) {
    log(`"Value: `v`, Env.x: `env.x`");
};

task % < x: 3 >;
// Value: 42, Env.x: 3
```

----

**Running against a different environment.** The Reader value is read-only inside a chain -- no step can change what the steps after it see. That's deliberate: it's what makes an `IO` predictable to reason about. So when part of your program needs to run against a *different* environment, you don't modify the current one; you start a new `IO` context just for that sub-computation.

`IO.updateEnv@` merges a patch into the current environment **for a sub IO computation only**. You give it the change first, and it hands back a function you apply to whichever `IO` should run under it:

```java
defn readFlag() ^IO@ (defn(env) ^env.debug);

def withDebug: IO.updateEnv@ < debug: true >;

def task: IO ~<< (env) {
    def flag:: withDebug(readFlag());
    log(`"inner: `flag`, outer: `env.debug`");
};

task % < debug: false >;
// inner: true, outer: false
```

`readFlag()` sees `debug: true` because `withDebug` ran it in a derived context. The surrounding chain still sees `debug: false` -- deriving a context doesn't disturb the one you're in.

Two siblings round it out: `IO.withEnv@` replaces the environment outright instead of patching it, and `IO.mapEnv@` takes a function, for when the new environment is computed from the old one rather than merged or replaced.

With all three unit constructors, the environment change is specified first, and a function is returned that you pass a sub-`IO` to next; this allows building a sub-environment once and using it at each bind site that needs that altered environment.

### Transforming Over Concurrency

Another super power of `IO` is that its `~<<` chain automatically threads through `Promise` resolution. If any `IO` step (including the `IO`'s own executor) yields a `Promise`, the `IO` chain evaluation *lifts* into promise-space: subsequent steps defer until the promise resolves, and the outer `%` yields a `Promise` instead of a concrete value.

```java
def task: IO ~<< {
    def user:: fetch("/api/user/123");
    def orders:: fetch("/api/orders/123");
    < :user, :orders >
};

task%;    // Promise{..pending..}
```

**NOTE:** Other deferred types (`IterP`, `Channel`, `PushStream`, and `PullStream`) also compose with `IO`, but indirectly *through* `IO`'s `Promise` transformation; each type's coordinating operations return `Promise` instances, and those promises thread through the `IO` transformer as illustrated.

#### Promise Transformation

Consider:

```java
defn getValue() ^Promise.honor@ 42;

defn printValue(v) ^IO@ (defn(){
    log(`"Value: `v`");
});

def task: IO ~<< {
    def v:: getValue();     // Promise, not IO
    $printValue(v);
};

task%;
// Promise{}
// Value: 42
```

When the promise from `getValue()` is encountered, the rest of the `IO` evaluation -- in other words, what's returned from the `%` call -- is *lifted* to a promise. Subsequent steps in the chain wait for the promise to resolve before proceeding; `v` binds to `42` (the `Right` payload) directly, per Promise's invariant-branch model.

That's basically the `Promise ~<< { .. }` behavior folded automatically into `IO`'s `~<<`.

The lift occurs regardless of how the promise is encountered. An `IO` may hold a `Promise`, or a `Promise` may hold an `IO`:

```java
defn getValue() ^IO.of@ (Promise.honor@ 42);

// or:

defn getValue() ^Promise.honor@ (IO.of@ 42);
```

In either of those forms, the previous snippet would complete with the same outcome: the surrounding `IO` evaluation lifts, and the outer `%` yields a `Promise`.

#### Channel Transformation

`Channel` isn't a transformer target, but each of its operations returns a `Promise`, so channel work composes naturally through `IO`'s `Promise` transformer:

```java
defn getValue(ch) ^ch.take();

defn printValue(v) ^IO@ (defn(){
    log(`"Value: `v`");
});

// channel buffer size: 1
def ch: Channel@ 1;

def task: IO ~<< {
    ch.put(42);
    def v:: getValue(ch);       // Promise, not IO
    ::printValue(v);
};

task%;
// Promise{}
// Value: 42
```

`ch.put(42)` returns a `Promise` (resolving immediately here because the channel is buffered) which the outer `IO ~<<` sequences and discards. `ch.take()` also returns a `Promise`, and the transformer binds `v` to the taken value directly. There's no channel-specific machinery inside the block; the composition routes through `Promise`.

#### PushStream Transformation

`PushStream` and `IO` compose along a different axis. Rather than a stream being lifted through `IO`, a stream is *observed* by a `~<*` scope wired inside an `IO` executor. The scope's setup returns a Promise immediately.

What *is* promise-shaped is the coordinating work around the stream: each `subj% v` broadcast returns a `Promise`, and closing the subject completes it. Those promises thread through the outer `IO ~<<` chain in the usual way:

```java
defn tapStream(st) ^IO@ (defn(){
    PushStream ~<* (v:: st) {
        log(`"v: `v`")
    };
    // intentionally, no return value
});

defn pumpStream(subj) ^IO ~<< {
    Promise.all@ (
        2..5 ~map (v) { subj% v }
    );
    subj.close()
};

(IO ~<< {
    def subj: PushStream.subj@;

    // returned IO is chained, but it has no
    // result value
    tapStream(subj.st);

    // returned IO is chained, promise resolves
    // only once the `subj.close()` completes
    pumpStream(subj);

    log("Complete!");
})%;
// v: 2
// v: 3
// v: 4
// v: 5
// Complete!
```

**NOTE:** Both `tapStream()` and `pumpStream()` return `IO` -- `IO{Empty}` and `IO{Promise}`, respectively -- but due to `IO` transform machinery, they could have returned `Promise{}` or even `Promise{IO}`, as needed. Since neither provides a useful return value (through the `IO`), the outer `IO ~<<` do-comprehension simply calls those functions without unwrapping them. But it could have, with something like `def res:: ...;` (`~<` unwrapping with `::` instead of `:`).

The main outer `IO ~<< { .. }` do-comprehension, which kicks everything off, first constructs a `PushStream` instance to use. Then, it sequences `tapStream()` (no return value, so nothing waits), then `pumpStream()` (which waits for the stream writes to finish and the stream to close cleanly). Finally, it logs the `"Complete!"` message.

`tapStream`'s executor -- a normal function, not an `IO ~<<` do-comprehension -- defines a `PushStream ~<*` observer, which returns a `Promise` that will resolve only when that stream closes. However, the executor returns nothing (i.e., `empty`) intentionally, so that it can omit that `Promise` from the `IO` transform machinery. If *that* `Promise` had been returned, the main outer `IO ~<<` do-comprehension would wait on it; but it'd never resolve, since the subsequent writes to the stream (via `pumpStream()`) haven't started yet.

`pumpStream` defines its own inner `IO ~<<` do-comprehension, which first waits for *all* the `Promise` results from the `subj% v` operations to complete. The terminal expression of that do-comprehension is `subj.close()`, which is itself a `Promise` that resolves when the stream finishes closing; *that* `Promise` is the result of the inner do-comprehension.

#### PullStream Transformation

The same idea applies to `PullStream`, with the observation scope being `~<<` (consumer-drives-until-done) instead of `~<*`. The `~<<` loop's completion is promise-shaped, so it threads through the outer `IO ~<<` chain the same way:

```java
defn dumpFileLines(path) ^IO ~<< {
    def < lines, linesBuf >: PullStream.withBuffer@ <
        capacity: 8,
        overflow: PullStream.DROP_OLDEST
    >;
    def lineCount: 0;

    File.readLines@ < :path, buf: linesBuf >;

    PullStream ~<< (line:: lines) {
        lineCount := lineCount + 1;
        log(`"line: `line`");
    };

    lineCount;
};

(IO ~<< {
    def count:: dumpFileLines("/tmp/log");
    log(`"`count` lines read!");
})%;
// line: ..
// line: ..
// ..
// 23 lines read!
```

The main outer `IO ~<<` do-comprehension waits for `dumpFileLines()` to complete, and `::` unwraps its result to assign to `count`.

The inner `IO ~<<` do-comprehension in `dumpFileLines()` waits for the `Promise` from the `PullStream ~<<` do-comprehension to complete, then resolves to the accumulated `lineCount` variable.

### Iterator Transformation

**NOTE:** [Iterators will be discussed](#iterators) in detail in the following section.

When you step through (or fully consume, via `~<<`) an `IterP` (promise-returning) iterator -- including a [generator-attached](#generators) `IterP` iterator -- each of its promises provide a composition point with an `IO` step:

```java
def it: IterP@ <
    Promise.honor@ 10,
    Promise.honor@ 15,
    Promise.honor@ 20
>;

(IO ~<< {
    def x:: it%;
    log(`"x: `x`");

    def y:: it%;
    log(`"y: `y`");
})%;   // Promise{..pending..}
// x: 10
// y: 15

(IO ~<< {
    $(IterP ~<< (v:: it) {
        log(`"v: `v`");
    });

    log("Complete!");
})%;  // Promise{..pending..}
// v: 10
// v: 15
// v: 20
// Complete!
```

**NOTE:** The `$` applied to the above `IterP ~<<` loop is the "non-receiving bind".

Naming each step separately gets awkward quickly -- `x`, `y`, etc carry no meaning here, since every one of them is just "the value from the step I'm on". You can reuse a single name instead:

```java
(IO ~<< {
    def v:: it%;
    log(`"first: `v`");

    def v:: it%;
    log(`"second: `v`");

    def v:: it%;
    log(`"third: `v`");
})%;   // Promise{..pending..}
// first: 10
// second: 15
// third: 20
```

This repeated `def v::` isn't redeclaration or reassignment. Each `::` bind opens a fresh scope for everything after it, so the second `def v::` *shadows* the first -- the same way a nested function's parameter shadows an outer name. The earlier `v` still exists in its own enclosing scope; you just can't reach it by that name anymore. No `:=` and no `:over` are involved, because nothing is being mutated.

Shadowing works this way in any `~<<` block, not just `IO`. It reads best exactly where this example needs it: when successive binds are steps of the same thing, and inventing fresh names for each would obscure that.

### Managing Resources

Some effects come in pairs. You open a file, you close it. You take a lock, you give it back. Imperatively that's what `try..finally` is for, and the burden is on you to remember the second half -- on every path out, including the ones that fail.

`IO.using@` folds that pair into a single `IO`. You describe both halves once, and hand back something that binds like any other step:

```java
defn withFile(path) ^(
    IO.using@ <
        acquire: (IO@ (defn(env){
            def fh: File.open@ path;
            log(`"`path` opened");
            ^fh
        })),
        release: (defn(fh) ^IO@ (defn(env){
            fh.close();
            log(`"`path` closed");
        }))
    >
);

def task: IO ~<< {
    def fh:: withFile("/tmp/log.txt");
    def a:: readChunk(fh);
    def b:: readChunk(fh);
    < :a, :b >;
};

task%;
// /tmp/log.txt opened
// /tmp/log.txt closed
// < a: .., b: .. >
```

What's different about `fh` isn't how it binds; it's its lifetime. The close isn't a line you wrote at the bottom of the block -- it's attached to the bind, and *everything after the bind* is the scope it covers. The file stays open exactly as long as there are steps left that could touch it.

Nesting two of them needs no extra thought:

```java
def task: IO ~<< {
    def src:: withFile("/tmp/a.txt");
    def dest:: withFile("/tmp/b.txt");
    def data:: readAll(src);
    $writeAll(dest, data);
};

task%;
// /tmp/a.txt opened
// /tmp/b.txt opened
// /tmp/b.txt closed
// /tmp/a.txt closed
```

`dest` closes first, then `src` -- innermost outward, the way a stack of `finally` blocks unwinds. Nobody specified that ordering; it's what "the rest of the block" means at each bind.

Failure is covered too. If the work after the bind lifts into promise-space and reneges, the release still runs before the promise settles, and the failure still propagates -- releasing a resource doesn't turn a failure into a success.

One caution, since the release rides on the bind: a `using` you never bind never releases. `withFile("/tmp/log.txt")%` opens the file and stops there, and so does putting a `using` in the *last* position of a do-block, where there's nothing after it to scope. If you're acquiring something, bind it, and make sure to use it via bind (`::`, `$`, or `~<`).

You won't have to catch that yourself, though. Running or mapping a `using` instead of binding it is a leak **Foi** can see, so it warns you rather than quietly skipping the release. The resource is still acquired and your code still gets its value -- the warning alerts you to the resource leakage.

## Iterators

An **Iterator** (`Iter`) is a stateful protocol for lazily pulling values from a *source* one at a time.

Unlike a `Promise` (which resolves once and permanently) or a `PushStream` (whose producer initiates delivery), an `Iter` delivers values only when its holder explicitly asks for the next one -- each *step* advances the source by one position.

`Iter` is similar to `PullStream`, in that it's consumer driven; what you pull is what you get.

However, iterators connect to a fixed source (tuple) or control a [generator invocation](#generator-invocation); `PullStream` only connects opaquely to a buffer (fed by a `PushStream`). Iterators are also non-monadic: there's no `~<` or `~map` defined on them. That said, iterator composition re-uses the `~<<` do-form (borrowed from monadic structures), to drain the iterator.

**Foi** provides two peer iterator namespaces: `Iter` (sync) and `IterP` (async). Both share the same stepping interface -- unary `%` to advance, sticky terminal on exhaustion -- and both may be drained via `~<<`. They differ in their step-envelope shape: `Iter` returns bare `Right@`/`Left@`, while `IterP` returns Promise-wrapped step envelopes. Explicit construction uses `Iter@` for `Iter` (Tuple sources) or `IterP@` for `IterP` (`List{Promise}` sources); generators (covered in the next section) produce an `IterP`. Generator-attached `IterP` iterators also allow two-way value flow via argument to the `%` iterator stepping.

### Constructing An Iterator

The `Iter@` constructor takes a single source argument, which must be either a Tuple (`List`) or another `Iter`.

```java
def it: Iter@ < 10, 20, 30 >;
```

The Tuple's elements become the value sequence, delivered in order. A range literal (which produces a Tuple) also works:

```java
def it: Iter@ 1..5;
```

Passing an existing `Iter` to `Iter@` returns the same instance -- no new state, no wrapper:

```java
def existing: Iter@ < 10, 20, 30 >;
def same: Iter@ existing;    // `same` IS `existing`
```

This *identity form* is what lets generic consumers accept "anything iterable" -- they can call `Iter@` on their input to normalize it, and pay no penalty if the caller already gave them an Iter.

Any argument other than a Tuple or an existing Iter is ill-formed.

Two Iters constructed from the same (non-`Iter`) source have independent state:

```java
def nums: < 1, 2, 3 >;
def a: Iter@ nums;
def b: Iter@ nums;

a%;    // Right{1}
a%;    // Right{2}
b%;    // Right{1}     -- independent
```

### Stepping

Applying `%` to an iterator -- the unary form, `it%` -- steps it once, returning one of two shapes:

* `Right@ payload` -- the next value from the source.
* `Left@ envelope` -- the source has been exhausted; no further values.

```java
def it: Iter@ < 1, 2 >;

it%;    // Right{1}
it%;    // Right{2}
it%;    // Left{< sentinel: .., terminal: empty >}
```

Once the iterator reaches its terminal, the terminal is **sticky**: subsequent `it%` invocations return the same `Left` value, forever. Iterators are not one-shot; they idempotently report their terminal on every inspection.

```java
def it: Iter@ < 1, 2 >;

it%;    // Right{1}
it%;    // Right{2}
it%;    // Left{< sentinel: .., terminal: empty >}
it%;    // Left{< sentinel: .., terminal: empty >}    -- sticky
```

The terminal `Left` payload is an **envelope** record with two fields:

* `sentinel` -- an opaque, unique value minted per-iterator at construction. Two iterators never share a sentinel; the same iterator always reports the same sentinel. It lets a consumer tell a *genuine exhaustion* envelope apart from a plain `Left@` from a step.
* `terminal` -- the actual terminal payload. `empty` for `Iter@`-constructed iterators, or the generator's own return value for generator-produced iterators (see [Generators](#generators)).

If you're stepping manually and need to distinguish exhaustion from a plain `Left` value coming normally through a step, compare the `.sentinel`:

```java
def it: Iter@ < 10, 20 >;

defn drain(it) {
    def step: it%;
    ?(step){
        [?as Right]: {
            log(`"got: `step.value`");
            drain(it)
        };
        [?as Left]: ?{
            [step.value.sentinel ?= it.sentinel]: log("done: exhausted");
            : log(`"Left: `step.value`");
        };
    }
};

drain(it);
// got: 10
// got: 20
// done: exhausted
```

Access to a missing `.sentinel` field yields `empty` (harmlessly failing the `?=` check), so the pattern is safe against any value shape. `Iter@`s over Tuple sources never actually produce plain `Left`s -- every element becomes a `Right@` step -- but `IterP`s over `List{Promise}` sources (see below) can (via `Promise.renege@` elements), and the same sentinel-check pattern applies uniformly. In practice, `~<<` drainage (next section) handles this discrimination internally; you'll only reach for manual sentinel checks when consuming iterators at a lower level than `~<<`.

**Note:** Iterators have no `close()` method and no way to observe closed-state directly. If you don't want to keep pulling from an iterator, stop pulling; the iterator will be garbage-collected along with its source. Generator-sourced iterators additionally allow you to send a signal into the generator (via the binary form, `it% signalVal`) to have the generator stop itself -- but that's a generator-side concern, covered in the next section.

### Draining An Iterator

For eager consumption, `Iter` supports the `~<<` *do comprehension* form:

```java
def it: Iter@ < 10, 20, 30 >;

def res: Iter ~<< (v:: it) {
    log(`"v: `v`");
};
// v: 10
// v: 20
// v: 30

res;    // Right{empty}
```

Notice the `Iter` on the LHS: this is a *type-LHS*, not a value. The particular iterator to drain is supplied via the `v:: it` block-defs entry.

`IterP` supports equivalent drainage via its own type-LHS. Because `IterP` step envelopes are Promise-wrapped, the drainage expression resolves to a Promise:

```java
def it: IterP@ <
    Promise.honor@ 10,
    Promise.honor@ 20,
    Promise.honor@ 30
>;

def res: IterP ~<< (v:: it) {
    log(`"v: `v`");
};
// v: 10
// v: 20
// v: 30

res;    // Promise{Right{empty}}
```

Generator-produced `IterP` drainage works the same way, and natural completion resolves to `Promise{Right{returnValue}}` where `returnValue` is the generator's own return value. Block-body `Done@ payload` early-exit resolves to `Promise{Left{payload}}` instead; mid-stream cargo `Left`s in the source likewise short-circuit to `Promise{Left{cargo}}`. Drainage discriminates via the sentinel envelope internally, so consumers see the flat Right/Left split at the drainage result.

## Generators

Generators are functions whose execution can pause mid-body and resume on demand. Each pause point yields a value out through an attached iterator; each resume hands control back into the function to run until the next pause.

Where iterators are the *interface* for one-at-a-time value delivery (see [Iterators](#iterators)), generators are the primary way to create such a data source. A generator's body reads like ordinary imperative code -- loops, branches, local variables -- with the `<::` yield operator marking each point where the function should pause and hand a value out.

Neither generators nor the iterators they produce are monadic; there's no `~<` or `~map` defined on either. Their value is in expressive authoring of stateful producers, not composition algebra.

### Declaring a Generator

A generator is declared with a `Gen.`-prefixed type (via `deft`) and a function (via `defn`) whose `:as` annotation attaches to that type:

```java
deft Gen.Numbers(int, int) ^IterP;

defn numbers(start, end) :as Gen.Numbers {
    start..end ~each (v) {
        <:: v
    };
    ^"Complete"
};
```

The `Gen.` prefix on the type is a compiler signal: functions attached to a `Gen.`-prefixed type don't run straight-through when called; instead, invocation returns an iterator, and each step of that iterator advances the body forward until the next `<::` yield. The return type is `^IterP` because invocation yields an `IterP` iterator, not the final value; the final value emerges via the iterator's terminal, covered below.

The runtime yield machinery (`<::`) is built on top of the standard effect system (see [Effects](#effects) for details).

### Generator Invocation

Calling a generator function returns an `IterP`. The body does not run at call time; no code inside the generator has executed yet:

```java
def nums: numbers(1, 3);
// nums is an IterP; the body has not run
```

The first `%` step drives the body forward until it reaches its first `<::`:

```java
nums%;    // Promise{Right{1}}
```

Subsequent steps resume at the last `<::`, run forward to the next one, and yield:

```java
nums%;    // Promise{Right{2}}
nums%;    // Promise{Right{3}}
```

When the body reaches its natural end (or an explicit `^` return), the iterator produces a sticky `Promise{Left@ envelope}` on that step and every subsequent step, where `envelope` carries the generator's return value on its `.terminal` field:

```java
nums%;    // Promise{Left{< sentinel: .., terminal: "Complete" >}}
nums%;    // Promise{Left{< sentinel: .., terminal: "Complete" >}}    -- sticky
```

See [Iterators § Stepping](#stepping) for the envelope shape and the sentinel discrimination pattern.

Because invocation returns an `IterP`, everything from the [Iterators](#iterators) section applies -- unary stepping, sticky terminal, and drainage via `IterP ~<<`:

```java
IterP ~<< (n:: numbers(1, 3)) {
    log(n)
};
// 1
// 2
// 3
```

Step results are Promise-wrapped even when the generator body runs synchronously; consumers may inspect resolved values by composing with `~<` / `~map` / `~cata`.

### Yielding Values

Inside a generator body, `<:: v` yields `v` out to the current step and pauses execution at that expression. Generator state -- local variables, loop counters, anything the body has bound -- persists across suspensions:

```java
deft Gen.RunningTotal(int) ^IterP;

defn runningTotal(count) :as Gen.RunningTotal {
    def total: 0;
    1..count ~each (i) {
        total := total + i;
        <:: total
    };
    ^"done"
};

def rt: runningTotal(4);
rt%;    // Promise{Right{1}}      -- 0+1
rt%;    // Promise{Right{3}}      -- 1+2
rt%;    // Promise{Right{6}}      -- 3+3
rt%;    // Promise{Right{10}}     -- 6+4
rt%;    // Promise{Left{< sentinel: .., terminal: "done" >}}
```

**Note:** A `<::` yield can appear anywhere an expression is admitted, not just as a standalone statement. Its evaluation-site value is whatever the consumer supplies when resuming (see [Two-Way Value Flow](#two-way-value-flow) below); when the consumer resumes with plain unary `%`, that value is `empty`.

### The Terminal Value

When a generator's body reaches its natural end, the `^`-returned value becomes the iterator's sticky terminal payload -- carried as the `.terminal` field of the sentinel envelope inside `Promise{Left@ ..}` (see [Iterators § Stepping](#stepping)). If the body has no explicit `^`, the terminal payload is `empty`.

A generator body can also short-circuit its own iterator early with `Done@`:

```java
deft Gen.SquaresUntil(int, int) ^IterP;

defn squaresUntil(count, ceiling) :as Gen.SquaresUntil {
    def res: "complete";
    (1..count) ~each (i) {
        def sq: i * i;
        ?{
            [sq ?> ceiling]: {
                res := `"exceeded at `i`";
                Done@ res
            }
            : <:: sq;
        }
    };
    ^res;
};

def sq: squaresUntil(10, 20);
sq%;    // Promise{Right{1}}
sq%;    // Promise{Right{4}}
sq%;    // Promise{Right{9}}
sq%;    // Promise{Right{16}}
sq%;    // Promise{Left{< sentinel: .., terminal: "exceeded at 5" >}}    -- 25 > 20
```

The `Done@` behavior inside a generator matches its behavior at any comprehension body: the payload becomes the `.terminal` of the sticky envelope (wrapped in `Promise{Left@ ..}`), and execution stops.

### Two-Way Value Flow

The unary step form `it%` treats the generator as a pure producer -- values flow out, nothing flows in. The **binary** form `it% v` sends `v` back into the generator as the value of the waiting (most recent) `<::` yield expression:

```java
deft Gen.Accumulator() ^IterP;

defn accumulator() :as Gen.Accumulator {
    def total: 0;
    ?[total ?< 1000] ~each {
        // yield total, receive delta
        total := total + (<:: total)
    };
    ^total
};

def acc: accumulator();
acc%;     // Promise{Right{0}}    -- initial yield
acc% 5;   // Promise{Right{5}}    -- delta=5, total becomes 5, yields 5
acc% 10;  // Promise{Right{15}}   -- delta=10, total becomes 15, yields 15
acc% 3;   // Promise{Right{18}}   -- delta=3, total becomes 18, yields 18
```

Notice `total + (<:: total)` -- the `<:: total` expression yields `total`, pauses, and on resume evaluates to the value supplied to the next `it% v`. That value then flows into the `+` expression.

Binary `%` is only defined on generator-produced iterators; using it on an `Iter@`- or `IterP@`-constructed iterator is ill-formed, since there's no `<::` yield expression to receive that value.

The first step is a special case: there's no `<::` waiting yet, so any value passed to the first step is discarded, and the generator runs from its start to its first `<::`.

Once the generator stops -- above, the `~each` loop exits once the `total` reaches or exceeds `1000` -- and the iterator reaches its terminal, further binary steps also discard the sent value and return the sticky terminal envelope inside `Promise{Left@ ..}`.

## Effects

An **effect** (aka, "algebraic effects") in **Foi** is a suspension point in a computation; the running code pauses, propagates a payload up the call stack to whichever handler catches it, and then resumes with whatever value the handler chooses to send back. Where an exception `throw` (in other languages) abandons the current work, an effect *pauses* it, so the computation *may* pick up right where it left off (the handler decides).

You've already encountered an effect (in disguise). The `<:: v` yield inside a generator body is a perform site for `Effect.Host.Gen.Yield`; the surrounding generator machinery is the handler. Generators are a built-in that sits directly on the effects system.

You don't have to reach for effects directly to use the language. The built-in types cover the common cases already. But when you need to model a suspension point of your own -- reading configuration lazily, prompting the user, retrying on failure, logging without threading a logger through every call -- effects are the mechanism.

### Declaring an Effect

An effect kind is declared with `deft`, using an `Effect.`-prefixed name:

```java
deft Effect.User.Ask(string) ^string;
deft Effect.User.Retry(<attempt: int, cause: string>) ^bool;
```

The parameter position declares the **payload type**: the shape of the value a perform site supplies. The return position declares the **resume type**: the shape of the value the handler passes to its resumption callable, which becomes the perform-site expression's value. `^empty` marks an effect whose resume carries no information -- the handler still resumes the perform site, the caller just has nothing to read from it.

The `Effect.` prefix is not decorative; it signals to the compiler that this `deft` names an effect kind, not a plain type alias. Only `Effect.`-prefixed names may appear on the LHS of a perform site, on the LHS of a `~<*` handler operator, or in an `:Effects(..)` clause on a function's type declaration.

### Performing and Handling

A **perform site** signals that the enclosing computation is producing an effect. The general form uses the `%` effector operator applied to an effect kind:

```java
Effect.User.Ask% "What is your name?";
```

The expression's value is whatever the handler resumes with: for `Effect.User.Ask` above, a `string`. Until a handler catches the perform and then affirmatively resumes it, the surrounding computation is suspended.

A **handler scope** is established (via call-stack, not lexical scope) with the `~<*` operator against an `Effect.` prefixed effect type:

```java
def result: Effect.User.Ask ~<* (eff:: greetUser(), ret) {
    ?(eff){
        [?as Effect.User.Ask]: ret("Kyle");
    };
};
```

The block definition `(eff:: greetUser(), ret)` binds each perform-event dispatched to this handler to `eff`, with `greetUser()` as the computation whose performs are caught, and binds `ret` as a **resumption callable** for use inside arms. The block body is a pattern-match over `eff`; each arm may invoke `ret(v)` to resume the perform site with `v` as its value. Inside a matched arm, the topic reference `#` is the perform-event object; the payload the perform site supplied is at `#.value`.

`~<*` catches every perform of the LHS's effect kind (or set of kinds) reachable from `comp`, not just at the top level. If `greetUser()` calls `askName()` which in turn performs `Effect.User.Ask`, this handler catches it just the same. The effect walks the call-stack *dynamically*, like a `try`/`catch`, not lexically.

The whole `~<*` expression evaluates to a `Promise` that resolves when the handler scope terminates. Because the scope above completes synchronously, that promise is already resolved by the time you compose against it -- but you still reach the value the same way you would any promise:

```java
result ~map (v) {
    log(`"greeted: `v`");
};
```

Termination happens in one of two ways. The common one is **natural completion**: the match consequents invoke `ret`, those resumes drive `comp` forward, and `comp` eventually returns -- above, the result is `"Kyle"` returned from `greetUser()` -- and resolves the overall `~<*`promise to that value. The result of each intervening matched consequent is effectively ignored/discarded.

**NOTE:** `ret` resumes the computation, and returns only once that computation reaches its next boundary: its next perform, or its completion. Subsequent operations continue after the `ret(..)` call returns (always `empty`); state flows to the handler through the payload and back through `ret`'s argument, and that pair is the whole channel.

The other termination path is a match consequent that skips calling `ret(..)` and instead evaluates to `Done@`; this signals "don't resume." The scope terminates, the computation is abandoned at the perform point, and the promise resolves with the `Done@` *payload* -- unwrapped, as an ordinary value the surrounding code can inspect. This is the escape hatch for cancellation, fatal errors, and other effects the handler decides shouldn't continue.

----

**Handling multiple effect kinds.** A single handler can catch several
prefix subtrees at once using the brace form on the LHS. Arms then
dispatch per kind via `?as`:

```java
def result: Effect.<User.Ask, Sys.Log> ~<* (eff:: doWork(), ret) {
    ?(eff){
        [?as Effect.User.Ask]: ret(readInput(#.value));
        [?as Effect.Sys.Log]: ret(log(#.value));
    };
};
```

The brace form `Effect.<A, B, ...>` means "any of these effect
subtrees." Each arm's `?as Effect.Name` narrows to one kind. Arms
run first-match-wins (§5), so if any two arm patterns overlap (a
child prefix under a parent prefix, or two brace-listed prefixes),
list the more-specific arm first.

----

Recall from the [Generators](#generators) section:

```java
<:: v
```

`<:: v` is exact sugar for `Effect.Host.Gen.Yield% v`. Generator yield has dedicated notation because, by design, it's a two-way communication channel and control coordination point between the generator code and the caller that consumes its iterator. Every other effect uses the plain `Effect.Name% payload` form.

### Tracking Effects

**Foi** tracks effects on function type declarations, similar to how mutable-closure intent is tracked on the function signature with `:over`. A function that *directly* (not through other function calls) performs a non-ambient effect must declare a type whose `:Effects(...)` clause names that effect, in a brace cuddled to `defn`:

```java
deft AskName(int) :Effects(User.Ask) ^string;

defn{AskName} askName(id) ^Effect.User.Ask% id;
```

Performing `Effect.User.Ask` in `askName()`'s body without that `{AskName}` declaration is a compile error: the "emit-edge" declaration is required wherever an effect is first performed.

Intermediate callers don't have to keep re-declaring the effect. If `greetUser` calls `askName` but doesn't itself perform anything new, no declaration is required on `greetUser`; the compiler propagates the effect surface up the call stack silently. Coverage is verified per call stack; somewhere before the outermost boundary, a `~<*` handler for `Ask` must exist. Where in the chain that handler lives is up to you.

That freedom narrows at the top of a module. Code sitting directly there -- a definition's initializer, or a plain statement after the definitions -- isn't inside any call, so there's no caller to hand the effect off to. Importing your module doesn't make the importer one either. Handle it in the same statement that performs it. Ambient effects are unaffected -- the runtime's handler is in place before any module loads.

### Ambient Effects

A small runtime-designated set of effects -- **`Effect.Sys.Log, Effect.Sys.Warn, Effect.Sys.Random, Effect.Sys.CurrentTime`** -- are exempted from the tracking discipline entirely. These are **ambient** effects: they need no `:Effects(...)` declaration on the emit-edge function, and the caller doesn't have to install a `~<*` handler for them:

```java
defn greetUser(id) {
    def name: askName(id);
    log(`"Hello, `name`");       // Effect.Sys.Log; no ceremony
    ^name;
};
```

A **Foi**-provided handler wraps your entire program run and catches ambient performs (stdout for `Effect.Sys.Log`, stderr for `Effect.Sys.Warn`, PRNG for `Effect.Sys.Random`, system clock for `Effect.Sys.CurrentTime`). "Entire run" is literal -- it's in place before your modules start loading, so a `log()` in a definition section reaches it exactly as a `log()` deep in a call stack does. `Effect.Sys.Warn` is its own kind rather than a flavor of `Log` so that you can intercept diagnostics on their own -- silence them in a test run, or route them somewhere louder -- without touching normal output.

You *can* still install your own `~<*` handler for an ambient kind if you want to intercept -- say, to capture log output in a test -- and standard dynamic lookup will find your handler before the runtime's.

**Some ambients stop your program.** Dividing by zero and a failed `:as` check are ambient effects too, but the handler **Foi** provides for them ends the run and names the spot instead of resuming. That's the right default -- nobody wants to narrow around every division on the chance a denominator was zero.

They're ordinary effects underneath, so you can catch them:

```java
Effect.Sys.Fatal ~<* (eff:: computeTotals(order), ret) {
    ?(eff){
        [?as Effect.Sys.Fatal.DivideByZero]: ret(0);
    };
};
```

Inside that scope a division by zero resumes with `0` and the work carries on. `Effect.Sys.Fatal` catches all of them at once, so you don't have to list the kinds.

One thing to know before you reach for it: what you pass to `ret` isn't checked. Division says it resumes with a number, and you can resume with a `Left` if that's what your call site is written for. That's the point of these -- they're the way out, so they let you out. It also means the code after that perform is running on a value **Foi** would otherwise have ruled out, and that part's on you.

The ambient category is deliberately narrow. Effects that write persistent state and effects that open network or file resources are outside the ambient set by design; those belong to the tracked discipline where callers explicitly acknowledge them. The ambient set is fixed by the runtime; you can't mark your own effect kinds as ambient, and the stopping ones are raised by the language rather than performed by name in your code.

## Type Annotations

Type annotations in **Foi** are optional; the compiler infers wherever it can. Writing them can improve the optimizations the compiler produces -- and, more to the point, they're how you narrow what a binding is allowed to hold.

There are two annotation surfaces, and they say different things.

### Annotating a Value

A value annotation begins with the `:as` keyword and applies to a value or expression:

```java
def age: 42 :as int;

def cost: (*)(getQty(order,item), getPrice(item)) :as float;
```

Custom types can be defined, for use in subsequent annotations, with the `deft` keyword:

```java
deft OrderStatus empty | "pending" | "shipped";

def myStatus: getOrderStatus(order) :as OrderStatus;
```

**Shapes work too.** A `deft` can name a Record or Tuple shape, and it's an exact match by default -- the value carries those entries and no others:

```java
deft Point <x: int, y: int>;

< x: 1, y: 2 >;                 // matches Point
< x: 1, y: 2, z: 3 >;           // doesn't -- extra entry
< x: 1 >;                       // doesn't -- missing y
```

To leave room for more, put a `*` entry last. `*T` leaves room for more positional entries; `*:T` leaves room for more named ones:

```java
deft Coords <*int>;
deft AtLeastX <x: int, *:Any>;

< 1, 2, 3 >;                    // matches Coords
< >;                            // matches Coords
< x: 1 >;                       // matches AtLeastX
< x: 1, label: "start" >;       // matches AtLeastX
```

One or the other, not both -- there's no way to write a shape that's open to extra names *and* extra positions at the same time.

The check happens at compile time, on the same pass that works out the rest of the types. If the value can't be what you said it is, that's a compile error at the annotation itself.

### Declaring a Binding's Type

A declaration annotation is a type name in `{ }` curly braces, immediately next to the `def` or `defn` keyword (no whitespace) that introduces the binding:

```java
def{int} count: 0;
```

That isn't a claim about the initializer -- it's a claim about the *container* (variable). `count` holds an `int` now and after every reassignment. A reassignment that doesn't agree is an error.

**NOTE:** The `{ .. }` annotation only takes type names (as defined by `deft`), not full type annotation syntax. So `def{int}` is fine, but `def{int | string}` is not allowed; `deft IntStrT int | string` and `def{IntStrT}` is how you express that.

Function declarations (`defn`) take the same brace annotation, and that's how a function gets a signature:

```java
deft InterestingFunc(int,string) ^empty;

defn{InterestingFunc} whatever(id,name) {
    // ..
};
```

The brace goes on the keyword, not after the parameter list, and there's no space before it -- `defn {InterestingFunc} whatever(..)` won't parse.

### Omitting Declaration Type Annotations

A binding with no brace has the type `Any` (i.e., implied `{Any}`). It holds anything, for as long as it lives:

```java
def x: 3;
x := "3";           // fine
```

If you're wondering: is **Foi** strict or loose about types? The answer is, there's no compiler flag, no strictness mode, no severity dial. An unannotated binding is genuinely unconstrained, and narrowing/locking it is something you can opt into by writing the declaration annotation. Adding declaration annotations to a program can only surface errors; taking them away can only hide/suppress them.

`Any` is capitalized because it isn't a runtime representation the way `int`, `float`, `bool`, and `string` are. It names the *absence* of a constraint (aka, the union of all possible types) rather than the presence of a specific shape.

### Both At Once

A `def` can carry both annotation types, and they're independent:

```java
deft Rec <a: int, b: string>;

def{Rec} <:a, :b>: payload :as Rec;
```

The brace types the container; the `:as` tail types the value the initializer produced. Either, both, or neither. When a destructure target carries a brace, the type distributes across the entries the same way the destructure does -- by field name in record-mode, by position in tuple-mode.

### Type Inferencing

An unannotated definition holds anything; but that's a rule about the *slot*, not a statement that the compiler is in the dark about what's in it. Usually it knows exactly.

The type inferencing draws on three kinds of *evidence*, in order of how much it trusts them: what you wrote (a brace, a `:as`, a `?as` test that passed), then how the value was made (a literal, a `Foo@` construction, the declared return type of something you called), then how the value gets used (reading `.name` off it means there's a `name` in there). That last one only comes into play when nothing better is available. A use tells you what the value would have to be for the line to work -- and if the line has a typo in it, that isn't something you want the compiler believing.

```java
def x: 1;    // inference: int

def y: getValue() :as string;   // inference: string

def z: person.firstName;        // inference: Record < :firstName >
```

A function type signature you didn't explicitly declare gets filled in from your call sites and from its body return expression (if any). Due to function hoisting, a call can sit above the declaration it reaches, so this is fine:

```java
def y: double(3);

defn double(x) ^x * 2;
```

The compiler reads `3` as the answer for `x` in `double(..)`, and hands `int` back out to `y`. The **first** call it reads is the one that decides. A later call passing a string to `double(..)` is an error, and it's reported at that later call -- not inside `double`, which is written correctly.

If `double` really should take both, use a union:

```java
deft Double(int | string) ^int | string;

defn{Double} double(x) ^?(x){
    [?as int]:    x * 2;
    [?as string]: x + x;
};
```

**NOTE:** One asymmetry worth knowing about is, you can pin a return type without declaring a signature, by annotating the value you return from the function (e.g., `^(compute() :as int)`). But there's no equivalent type lock for parameters. Parameters *do* have default expressions (`x:? 0`), which can participate in the type *inferencing* for values assigned to that parameter. But locking a parameter to a type requires writing a `deft` for the whole function signature.

### Type Check Narrowing

A `?as` test does double duty. It picks the branch at runtime, and inside that branch the compiler knows the test passed:

```java
?(input){
    [?as int]:    input + 1;
    [?as string]: input + "!";
};
```

Inside the first clause `input` is an `int`, so arithmetic on it is fine; inside the second it's a `string`. What the branch learned stays in the branch -- the next clause doesn't inherit it, and neither does anything after the match ends.

The same holds in an independent match or a guard, when the test is exactly a `?as`:

```java
?[order ?as Refund]: process(order);
```

Under `?and`, both sides narrow, since both had to hold to get in.

Three shapes look like they should narrow and don't:

- `![...]` and `!as`. Knowing what a value *isn't* doesn't tell you what it is.
- `?or` between two tests. Either one might have been the one that held.
- A clause that mixes a type test with something else, like `[?as int, "n/a"]`. It can match on the `"n/a"` with the type test false.

## License

[![License](https://img.shields.io/badge/license-MIT-a1356a)](LICENSE.txt)

All code and documentation are (c) 2022-2026 Kyle Simpson and released under the [MIT License](http://getify.mit-license.org/). A copy of the MIT License [is also included](LICENSE.txt).
