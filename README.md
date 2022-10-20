# Foi: a different kind of functional programming language

I'm jotting down some very early thoughts on what I think I want to design for the **Foi** language. This stuff is pretty much all subject to change. Consider everything experimental R&D for the foreseeable future.

<details>
    <summary>Aspirational Design Ideas for Foi</summary>
    <p></p>
    <ul>
        <li>versioned, with no backwards-compat guarantee</li>
        <li>parsed, JIT'd, compiled (probably WASM), with full-fidelity AST (preserves everything including whitespace, comments, etc)</li>
        <li>semicolons and braces (both required) -- no ASI, no implicit blocks</li>
        <li>lexical and block scoped, functions are first-class and have closure</li>
        <li>side effects (non-local reassignments) must be explicitly declared in function signature</li>
        <li>no global scope (everything is in a module scope)</li>
        <li>no circular dependencies, only synchronous module initialization</li>
        <li>no references or pointers</li>
        <li>no class, nor prototype, nor `this`-awareness</li>
        <li>functional (tail-call optimized, pattern matching, curried function definitions, composition syntax, native monads, no exception handling, etc)</li>
        <li>no `const`</li>
        <li>no `let` -- block-scoped declarations are explicit syntax as part of the block</li>
        <li>function auto-hoisting, but no variable hoisting</li>
        <li>only one empty value</li>
        <li>numeric types: int, float, bigint, bigfloat</li>
        <li>everything is an expression (no statements)</li>
        <li>iteration/looping (for/foreach/filter/map) are syntactic expressions, but accept functions</li>
        <li>all keywords and operators are functions (with optional lisp-like call syntax)</li>
        <li>records/tuples (instead of objects/arrays) that are immutable and by-value primitives</li>
        <li>syntax for mutable data collection (dynamically define props/indices, like objects or arrays), but in order to use/read/pass-around, must first be "frozen" into an immutable record or tuple -- somewhat like a heap-allocated typed-array that's then accessed by a "view" (a record or tuple)</li>
        <li>strings are sugar for tuples of characters, and are interoperable as such</li>
        <li>optional named-argument call syntax</li>
        <li>asynchrony built in (syntax for future values and reactivity/streams)</li>
        <li>garbage collected</li>
        <li>type awareness: weakly typed (small, limited set of type coercions), with dynamic type inferencing as well as optional type annotations on values/expressions</li>
    </ul>
    <p>
        In addition to the above, I may pull parts of a long-ago description of [earlier ideas for this language (then called "FoilScript")](https://github.com/getify/FoilScript#whats-in).
    </p>
</details>

## Table of Contents

The following is a partial exploration of what I've been imagining for awhile. There's a lot still to work out.

* [Imports](#imports)
* [Function Calls](#function-calls)
* [Evaluation-Expression Form](#evaluation-expression-form) (optional lisp-like function call form)
    - [Reversing Argument Order](#reversing-argument-order)
    - [Partial Application](#partial-application)
    - [N-Ary Operators](#n-ary-operators)
    - [Apply (aka Spread)](#apply-aka-spread)
* [Defining Variables](#defining-variables)
    - [Block-Definitions Clause](#block-definitions-clause)
* [Boolean Logic](#boolean-logic)
* [Equality and Comparison](#equality-and-comparison)
* [Pattern Matching](#pattern-matching)
    - [Guard Expressions](#guard-expressions)
* [Records and Tuples](#records-and-tuples)
    - [Inspecting](#inspecting)
    - [Generating Sequences (Ranges)](#generating-sequences-ranges)
    - [Deriving Instead Of Mutating](#deriving-instead-of-mutating)
    - [Maps](#maps)
    - [Sets](#sets)
* [Functions](#functions)
    - [Default Parameter Values](#default-parameter-values)
    - [Negating a Predicate](#negating-a-predicate)
    - [Function Pre-conditions](#function-pre-conditions)
    - [Named Arguments](#named-arguments)
    - [Function Recursion](#function-recursion)
    - [Function Currying](#function-currying)
    - [Function Composition](#function-composition)
    - [Function Pipelines](#function-pipelines)
* [Loops and Comprehensions](#loops-and-comprehensions)
    - [Tagged Comprehensions](#tagged-comprehensions)
* [Type Annotations](#type-annotations)

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

### Function Calls

The traditional function call-form (e.g., `log("Hello")`) always requires `(    )` around the argument list, and must immediately follow the function name (no whitespace). If there are no arguments to pass, the call looks like `someFn()`.

Inside the argument list, assigning arguments to the function's parameters is done positionally, from left-to-right. To skip an argument/parameter position, simply omit anything (exception optional whitespace) between two successive `,` commas:

```java
myFn(1,,3,,,6);
```

Omitting an argument is the same as specifying `empty` for that argument:

```java
myFn(1,empty,3,empty,empty,6);
```

**Note:** Trailing comma(s) are allowed (and ignored).

### Evaluation-Expression Form

All function calls and operators can optionally be evaluated in a lisp-like evaluation-expression form, with `| |` delimiters, instead of the more typical `( )` lisp parentheses:

```java
import log from #Std;

| log "Hello" |;               // "Hello"

| log | + 6, 12 ||;            // 18
```

**Note:** Whitespace is optional inside the `|    |` form, except as required after the first element (must be function expression) before the comma-separated argument list (e.g., `6, 12` above). So, `|log "Hello"|` and `|log |+ 6,12||` are the minimal whitespace forms of the above code snippet.

Any function name -- or expression that evaluates to a function -- can be used in the first (callee) position of the `|    |` expression. However, with one exception, keywords (`import`, `def`, etc) may not be used in the callee position.

The `defn` keyword (for function definitions -- see later) is the single exception; this keyword can be used as a (function-defining!) function in the evaluation-expression form. The single argument to `defn` is the full function signature (including any optional whitespace):

```js
def fn: | defn myFn(x) ^x + 1 |;

// equivalent to:
def fn: defn myFn(x) ^x + 1;
```

In the above snippet, it doesn't seem like the special case `| defn    |` form offers any benefit, as the shorter form without the `|    |` is identical. However, it's quite helpful for readability sake, when visually delimiting an inline function definition inside in another evaluation-expression. More on this later.

----

The primary reason for the `|    |` evaluation-expression form in **Foi** is that it allows quite a bit of additional flexibility/capability at the call-site that isn't possible with the traditional call-site form (e.g., `fn(1,2,3)`). In particular, it allows operators to be treated as more general function calls.

We'll cover many of those capabilities in the following sub-sections.

#### Reversing Argument Order

One such flexibility is that we can control the treatment of input arguments in various ways.

Some operators like `+` are commutative, so the operand/argument order doesn't matter. But other operators, like `-`, are not commutative, so the order matters.

To reverse the order of applied arguments of the operator-function in question, we can use the `'` prime operator, applied first to the function:

```java
| | ' - | 1, 6 |;               // 5
```

Yes, with `| ' - |`, we just applied one operator against another operator!

**Note:** The `'` prime operator has no prefix-operator form (like `'something(42)` or `1 '- 6`); that sort of syntax could cause chaos for readbility. Thus, it can only be used inside an evaluation-expression form, as shown above.

Since this operation will be extremely common, a special sugar short-hand is available. The `'` prime operator may appear immediately preceding (no whitespace) the operator/function (or expression) it's modifying:

```java
| '- 1, 6 |;                    // 5
```

This short-hand form of `'` should be preferred for readability sake wherever practical.

#### Partial Application

It's common in functional programming to produce more specialized functions by applying only some inputs to a more generalized (higher-arity) function; the result is a another function that expects the subsequent arguments.

This is referred to as partial application, and is another flexible capability afforded by the evaluation-expression form.

Consider the `+` mathematical operator, which has a minimum arity of 2. If we provide it only one argument, the result is a partially applied function that's still waiting for the second argument:

```java
| | + 6 | 12 |;                 // 18
```

Here, the `| + 6 |` creates the partially applied (operator) function, which is then provided a second argument `12` in the outer `|    12 |` expression.

**Note:** As with the traditional call form, arguments can be skipped with successive `,` commas with nothing (except optional whitespace) between them. Also trailing comma(s) are allowed (but ignored). As such, an expression like `| myFn 1, 2, |` will be treated (for partial application argument counting purposes) as 2 arguments, not 3. To specify a third affirmative empty argument at the end of the list, add an additional trailing `,` comma (e.g., `| myFn 1, 2,, |`) or specify `empty` explicitly (e.g., `| myFn 1, 2, empty |`).

Partial application operates according to the default argument ordering, which is left-to-right. However, it's quite common (especially with operators) to want to reverse the partial application order (right-to-left). This is most useful for producing point-free expressions.

For example, let's say we want to produce a function (from the `-` operator) that will subtract `1` from its next input value. How do we partially apply the `1` when it's the second/right-most argument?

To accomplish this, recall the `'` prime operator, which reverses the argument ordering:

```java
| | '- 1 | 6 |;                 // 5
```

The `| '- 1 |` evaluation-expression applies `1` as the right-most argument to `-`, and since that's the only argument provided, the result is a right-partially applied function.

*That* function -- which is back to regular left-to-right ordering, by the way -- is then expecting its final argument, which is then provided by the outer `|    6 |` evaluation-expression.

#### N-Ary Operators

Another advantage of this form is that it allows n-ary operators -- operators accepting 3 or more operand inputs -- where typically prefix/infix/suffix operators would be limited to unary (single operand) or binary (two operands) usage.

Many operators in **Foi** are n-ary, such as the `+` operator, `+>` flow (composition) operator, and `?<=>` range-check operator.

For example, say you want to add 5 numbers together. You can obviously do:

```java
1 + 2 + 3 + 4 + 5;
```

But because `+` is an n-ary operator, you can also do:

```java
| + 1, 2, 3, 4, 5 |;
```

It's nice to only need to list the operator once instead of 4 times!

Still, as the `+` operator is a single symbol, this example (including padded whitespace) yields a slightly longer expression, which may seem disfavorable.

However, other operators are comprised of two or more symbols, so the length of the evaluation-expression form will likely end up shorter depending on how many arguments are provided.

Also, some operators may result in a change of value-type from the operand(s) to the result. In those cases, you cannot simply combine multiple infix operator usages like we did with `+`.

For example, say you wanted to test 3 variables as all being equal to each other. The `?=` infix operator can only accept two operands (left and right), so we're forced to do multiple expressions, and combine their results with the logical-AND `?and` operator:

```java
(x ?= y) ?and (y ?= z) ?and (x ?= z);
```

**Note:** The `?=` equality comparison may not be transitive, depending on the types being compared, hence why we included the `x ?= z` check for good measure.

But since the `?=` operator is n-ary, we can provide it 3 or more arguments using the evaluation-expression form, resulting in a much shorter/nicer-to-read expression:

```java
| ?= x, y, z |;
```

It should be clear how much more preferable n-ary operator evaluation can be!

#### Apply (aka Spread)

Say we have a list of values (a Tuple, as we'll see later) called `numbers`, and we want to "spread them out" as arguments to an operator/function. We can use the `...` operator (only available in the evaluation-expression form):

```java
| + ...numbers |;
| + 0, ...numbers, 1000 |;
```

OK, that's useful. But what about modifying an operator/function to automatically accept its inputs as a list?

```java
| | ... + | numbers |;
```

Since `...` is an operator, when applied against an operator/function like `+`, it produces a new function that will expect a single (Tuple) argument that's then *spread out* to the underlying operator/function.

----

As you can see from the last several sections, there's lots of additional power in the evaluation-expression form, but there are yet still other capabilities that we'll encounter later in this guide.

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

age := 42;
```

Unlike `def` definitions, `:=` re-assignments are allowed anywhere in the scope after the associated `def` definition.

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
}
```

Moreover, this definitions-block form is allowed anywhere in its enclosing scope, so it's more flexible than a non-block `def` declaration.

#### Block-Definitions Clause

In addition to the definitions-block form just shown, several other expressions in **Foi** allow a `{    }` block to be declared as part of the larger expression. For syntactic convenience, many of these expressions' blocks can be prefaced by the optional `(   )` block-definitions clause:

* A [guard block](#guard-expressions) with block-definitions clause:

    ```java
    // if x > y, swap them
    // (tmp is block-scoped)
    ?[x ?> y]: (tmp: x) {
        x := y;
        y := tmp;
    }
    ```

* A [pattern matching clause block](#pattern-matching) with block-definitions clause:

    ```java
    ?{
        // x is odd?
        // (tmp is block-scoped to the clause)
        ?[mod(x,2) ?= 1]: (tmp) {
            tmp := (x * 3) + 1;
            ?[tmp ?> 100]: tmp := 100
            myFn(tmp);
        }

        // x is non-zero (and even)?
        ?[x != 0]: myFn(x)

        // otherwise, x must be zero,
        // so skip calling function and
        // default to fixed value 1
        ?: 1
    }
    ```

* A [loop iteration block](#loops-and-comprehensions) with block-definitions clause:

    ```java
    0..3 ~ (v, idx) {
        log(v + ": " + idx)
    }
    ```

**Note:** While function body definitions, and the Record/Tuple *def*-block, both have `{    }` blocks, these *cannot* be prefaced by a block definitions clause.

### Boolean Logic

The `true` and `false` boolean values are used primarily for decision making. Accordingly, non-negated, boolean-returning operators, aka logical operators, begin with the `?` character (to signal asking a question to make a decision).

To combine two or more boolean values with logical-AND (`?and`):

```java
def isValid: true;
def isComplete: true;
def isSuccess: false;

isValid ?and isComplete;                    // true
isValid ?and isComplete ?and isSuccess;     // false

| ?and isValid, isComplete, isSuccess |;    // false
```

And for logical-OR (`?or`):

```java
def isValid: true;
def isComplete: true;
def isSuccess: false;

isValid ?or isComplete ?or isSuccess;       // true

| ?or isValid, isComplete, isSuccess |;     // true
```

**Note:** As you can see, the `?and` and `?or` operators are n-ary, meaning they can take 2 or more arguments -- but only in the evaluation-expression form.

To negate a boolean value, use the unary `!` operator:

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

We'll see more `?`-prefixed, boolean-returning operators in the next section, all of which can also be negated by swapping `?` for `!`.

### Equality And Comparison

The `?=` operator checks for equality:

```java
def x: 42;
def y: 42;
def z: 100;

x ?= 42;                    // true

| ?= x, y, z |;             // false
```

**Note:** `?=` is another n-ary operator in the evaluation-expression form. Keep in mind, equality comparison in **Foi** is not necessarily transitive.

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

**Note:** These four operators are also n-ary operator in the evaluation-expression form. They compare the first operand against all other operands/inputs. For example, `| ?< x, y, z |` is the equivalent of `(x ?< y) ?and (x ?< z)`, but *does not* compare `y ?< z`.

A very common task is to check if a value is in a range between two other values:

```java
def x: 100;

(x ?> 0) ?and (x ?< 500);   // true
```

However, this can be done more idiomatically with the range-check operators, `?<>` (non-inclusive) and `?<=>` (inclusive):

```java
def x: 100;

| ?<>  0,   x, 500 |;   // true
| ?<=> 100, x, 100 |;   // true
```

**Note:** Because these two operators have an arity of exactly 3, they cannot be used in the typical infix expression form, which would only allow two operands (left and right).

As mentioned in the previous section, all these `?`-prefixed comparison operators can also be flipped/negated by swapping the `?` with `!`:

```java
def x: 42;
def y: 100;

x ?= 42;                // true
x != 42;                // false

x ?> y;                 // false
x !> y;                 // true
x ?>= y;                // false
x !>= y;                // true

x ?< y;                 // true
x !< y;                 // false
x ?<= y;                // true
x !<= y;                // false

| ?<>  40,  x, 50  |;   // true
| !<>  40,  x, 50  |;   // false
| ?<>= 100, y, 100 |;   // true
| !<>= 100, y, 100 |;   // false
```

### Pattern Matching

To make decisions (with booleans!), use pattern matching. There are two forms:

1. Dependent: each pattern is matched against (dependent on) a single topic; delimited with an opening of `?(    ){`, and closed with `}`.

2. Independent: each pattern has its own independent topic; delimited with an opening of `?{`, and closed with `}`.

Each pattern clause is defined by `?[    ]: consq`, where the pattern is defined inside the `[    ]`. A pattern can be negated as `![    ]`. The pattern match clause's consequent (`consq`) can either be a single expression, or a `{   }` block; either way, it's only evaluated if the pattern is matched via the conditional.

Let's examine each pattern matching form separately, starting with dependent pattern matching. The topic of the match is any arbitrary expression, defined in the `?(    ){` tag.

Consider:

```java
def myName: "Kyle";

?(myName){
    ?["Kyle"]: log("Hello!")
    !["Kyle"]: log("Goodbye!")
}
// Hello!
```

In this example, the topic is the `myName` variable, which is evaluated once. Each pattern clause is evaluated, in order, and compared for equality with the topic. For the first clause whose pattern is matched, its consequent is evaluated and the result returned for the overall pattern match expression.

Dependent pattern matching expressions *should be* determinate, in that all possible conditional branches are defined. The result of a pattern matching expression is thus the consequent expression of whichever conditional clause was matched:

```java
def myName: "Kyle";

def greeting: ?(myName){
    ?["Kyle"]: "Hello!"
    !["Kyle"]: "Goodbye!"
};

greeting;               // "Hello!"
```

However, if no pattern matches, the default result of the expression is a Maybe@None -- **Foi** can be configured to issue a warning notice in such a case. More on monads later.

To explicitly define a default pattern, use `?:` (which must be the last clause in the pattern matching expression):

```java
def myName: "Kyle";

def greeting: ?(myName){
    ?["Kyle"]: "Hello!"
    ?: "Goodbye!"
};

greeting;               // "Hello!"
```

**Note:** Comparing this example to the previous one, `?:` is equivalent to the `!["Kyle"]` pattern. Readability preferences may dictate either style, depending on the circumstances.

A dependent style pattern can include a `,` comma separated list of multiple values, any of which may match the topic:

```java
def myName: "Kyle";

def greeting: ?(myName){
    ?["Kyle","Fred"]: "Hello!"
    ?: "Goodbye!"
};

greeting;               // "Hello!"
```

It may also be useful to access the topic of a pattern matching expression inside its clause(s); the topic is bound to the `#` symbol:

```java
def myName: "Kyle";

def greeting: ?(myName){
    ?["Kyle"]: | + "Hello ", #, "!" |
    ?: "Goodbye!"
};

greeting;               // "Hello Kyle!"
```

Dependent pattern matching should only be used if the patterns only need equality-comparison of one or more discrete value(s) against the topic.

For more complex boolean-logic matching patterns, the independent pattern matching form is appropriate. Independent pattern matching has no topic, and thus begins with a `?{` instead of a `?(    ){`.

In this form, each clause matches only if the pattern is a conditional that evaluates to `true`. You could thus mentally model `?{` as if it was shorthand for `?(true){`:

```java
def myName: "Kyle";

def greeting: ?{
    ?[myName ?= "Kyle"]: "Hello!"
    ![myName ?= "Kyle"]: "Goodbye!"
};

greeting;               // "Hello!"
```

**Note:** The pattern-match conditional `![myName ?= "Kyle"]` is equivalent to `?[myName != "Kyle"]`. Readability preferences may dictate either style, depending on the circumstances.

Just as with dependent pattern matching, it's preferable for the overall independent pattern matching expression to be determinate, in that all conditional branches are covered. Again, to define a default (final) clause, `?:` may be used:

```java
def myName: "Kyle";

def greeting: ?{
    ?[myName ?= "Kyle"]: "Hello!"
    ?: "Goodbye!"
};

greeting;               // "Hello!"
```

**Note:** Again comparing this example to the previous one, `?:` is equivalent to the previous snippet's `![myName ?= "Kyle"]` conditional, or even `?[myName != "Kyle"]`. Readability preferences may dictate any of those style options, depending on the circumstances.

#### Guard Expressions

When an independent pattern matching expression would only have one clause, the clause can be specified standalone, as a *guard* expression.

For example:

```java
def myName: "Kyle";

// full pattern matching expression:
?{
    ?[myName != empty]: printGreeting(myName)
}

// standalone guard expression:
?[myName != empty]: printGreeting(myName);

// or:
![myName ?= empty]: printGreeting(myName);
```

### Records And Tuples

Records are immutable collections of values, delimited by `<    >`. You can name each field of a record, but if you omit a name, numeric indexing is automatically applied. Any record with all numerically indexed fields (implicitly or explicitly defined) is a special case called a Tuple.

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

Above, Record/Tuple fields are accessed with `.` operator, whether numeric or lexical-identifier. `[    ]` field access syntax evaluates field-name expressions (including strings that may include non-identifier characters).

Since `.` is an operator, Record/Tuple field access can also be performed in the evaluation-expression form, in which case it evaluates the second argument as an expression (like the `[    ]` form does):

```java
def idx: 2;
def prop: "last";

def numbers: < 4, 5, 6 >;

| . numbers, 1 |;               // 5
| . numbers, idx |;             // 6

def person: < first: "Kyle", last: "Simpson" >;

| . person, "first" |;          // "Kyle"
| . person, prop |;             // "Simpson"
```

To define Records/Tuples using arbitrary expressions for the values, use the evaluation-expression form:

```java
import uppercase from #Std.String;

def five: 5;
def numbers: < 4, five, 6 >;

def surname: "Simpson";
def person: < first: "Kyle", last: |uppercase surname| >;
```

To keep Record/Tuple syntax complexity to a minimum, *only* the `|    |` form of evaluation-expression (function invocation, operators, etc) is allowed inside the `<    >` literal definition.

Strings are just syntax sugar for tuples of characters. Once defined, a string and a tuple of characters will behave the same.

```java
def chars: < "H", "e", "l", "l", "o" >;
def str: "Hello";

chars.1;                    // "e"
str.1;                      // "e"
```

To determine the length of a string (or a Tuple), or the count of fields in a Record, use the `size()` function:

```java
import size from #Std;

size("Hello");              // 5
size(< "O", "K" >);         // 2
size(< a: 1 >);             // 1
```

To progressively define the contents of a Record/Tuple across an arbitrary number of statements/operations, use a Record/Tuple *def-block* `<{    }>`:

```java
def numbers: <{
    def five: 5;
    def six: empty;

    #1 := 4;
    #2 := five;

    six := #1 + #2 - 3;
    #3 := six;
}>;

def person: <{
    #first := "Kyle";
    #last := "Simpson";
}>;
```

As shown, the `<{    }>` *def-block* can contain any arbitrary logic for determining the contents, including traditional function calls, loops, etc. Once the block closes, the computed value is frozen as immutable.

Inside a `<{    }>` *def-block*, the `#` sigil indicates a self-reference to the current Record/Tuple context that's being defined, and can be used either in l-value (assignment target) or r-value (value expression) positions. However, these special self-references cannot cross inner-function boundaries.

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

You can determine if a field is defined in a Record with the `?has` / `!has` operator:

```java
def person: < first: "Kyle", last: "Simpson" >;

person ?has "first";            // true
person ?has "middle";           // false

person !has "nickname";         // true
```

#### Generating Sequences (Ranges)

If you want to generate a list (tuple) of sequential ([aka "interval"](https://www.graphpad.com/support/faq/what-is-the-difference-between-ordinal-interval-and-ratio-variables-why-should-i-care/)) data, you can use the binary `..` range operator (either infix or evaluation-expression form).

This usage of the `..` operator is valid with naturally sequential (ordered, fixed interval) values, such as integers and characters:

```java
def someInts: 2..13;

someInts.5;                     // 7

def alphabet: | .. "a", "z" |;

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

#### Deriving Instead Of Mutating

Since Records/Tuples are immutable, to "change" their contents requires you to derive a new Record/Tuple.

One way to derive a new Record/Tuple is to select multiple elements using the `.<    >` syntax, with one or more source indices/keys separated by commas:

```java
def numbers: < 3, 4, 5, 6, 7 >;
def evenDigits: numbers.<1,3>;
// < 4, 6 >

def person: < first: "Kyle", last: "Simpson", nickname: "getify" >;
def profile: person.<first,nickname>;
// < first: "Kyle", nickname: "getify" >
```

Another approach is to select a ranged Tuple subset, with the `.[  ..  ]` syntax:

```java
def numbers: < 3, 4, 5, 6, 7 >;

def head: numbers.0;                // 3
def first: numbers.[..0];           // < 3 >
def leading: numbers.[..3];         // < 3, 4, 5 >

def last: numbers.-1;               // 7
def trailing: numbers.[..-1];       // < 7 >
def tail: numbers.[1..];            // < 4, 5, 6, 7 >

def middle: numbers.[1..3];         // < 4, 5, 6 >
```

**Note:** The range `.[0..-1]` would be effectively be a no-op expression, since it results in the same Tuple; as immutable values, there's no reason for **Foi** to actually copy the Tuple in such a case.

Additionally, in the definition of a Record/Tuple, the `&` pick sigil prefixed on a variable name (not an arbitrary expression) *includes* some or all of the contents of that other Record/Tuple:

```java
def numbers: < 4, 5, 6 >;
def allDigits: < 0, 1, 2, 3, &numbers, 7, 8, 9 >;
// < 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 >

def person: < first: "Kyle", last: "Simpson" >;
def friend: < &person, first: "Jenny" >;
// < first: "Jenny", last: "Simpson" >
```

**Note:** `&` (*pick*) is a sigil, not an operator, and only has meaning inside a `<    >` Record/Tuple definition (but not a `<{    }>` *def-block*).

Above, the entire contents of `numbers` and `person` are *picked*, to be included in the new Tuple and Record values, respectively. The order of field definitions is left-to-right, and subsequent field definitions override previous ones; thus, `first: "Kyle"` is reassigned to `first: "Jenny"` above.

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

Moreover, the `&numbers.1` and `&person.last` are equivalent to the more explicit:

```java
def numbers: < 4, 5, 6 >;
def oddDigits: < 1, 3, 2: numbers.1, 7, 9 >;
// < 1, 3, 5, 7, 9 >

def person: < first: "Kyle", last: "Simpson" >;
def friend: < first: "Jenny", last: person.last >;
// < first: "Jenny", last: "Simpson" >
```

**Note:** one advantage of this more verbose form is, you can re-index/rename the field (something other than `2` or `last`, respectively) in the target Record/Tuple.

The `.<    >` and `.[  ..  ]` syntaxes also work with the `&` pick sigil:

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

#### Maps

A Record can also act as a *map*, in that you can use another Record/Tuple *as a field* (not just as a value), using the `%` sigil to start the field name:

```java
def numbers: < 4, 5, 6 >;
def dataMap: < %numbers: "my favorites" >;

dataMap[numbers];           // "my favorites"
```

**Note:** Like `&`, the `%` (map-field) sigil is not an operator, and can only be used inside a `<    >` Record definition.

#### Sets

A Set is a Tuple that only has unique values. An alternate Tuple definition form, delimited with `<[    ]>` instead, is provided for convenience, to ensure each unique value is only stored once:

```java
def something: < 4, 5, 6 >;
def another: < 6, 7 >;
def uniques: <[ &something, &another ]>;
// < 4, 5, 6, 7 >
```

All syntax rules of Tuples `<    >` still apply inside the `<[    ]>`, including use of the `&` and `%` sigils; as Sets are Tuples, not Records, field names are not allowed.

The `+` operator, when both operands are Tuples, acts as a unique-only Set-append operation:

```java
def numbers: <[ 4, 5, 5, 6 ]>;

def moreNumbers: numbers + < 6, 7 >;

moreNumbers;                // < 4, 5, 6, 7 >
```

**Warning** The `+` operator only works on Tuples (Sets), not Records.

### Functions

To define a function, use the `defn` keyword. To return a value from anywhere inside the function body, use the `^` sigil:

```java
defn add(x,y) { ^x + y; }
```

Function definitions are always hoisted to their enclosing scope:

```java
add(6,12);                          // 18
| add 6, 12 |;                      // 18

defn add(x,y) { ^x + y; }
```

Function definitions are also expressions (first-class values), so they can be assigned and passed around:

```java
def myFn: defn add(x,y) { ^x + y; };

myFn(6,12);                         // 18
add(6,12);                          // 18

somethingElse(myFn);
```

Function definition expressions can also be immediately invoked, using the evaluation-expression:

```java
|
    |defn add(x,y) { ^x + y; }| 6, 12
|;                                  // 18
```

**Note:** In the above example, the `|` pair surrounding the `defn` expression is technically optional. But it's recommended for readability sake, to visually disambiguate where the inline function expression begins and ends.

Concise function definitions may omit the name and/or the `{    }` around the body, but the concise body must be an expression marked by the initial `^` return sigil:

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

#### Negating A Predicate

A predicate is a boolean-returning function. For example:

```java
defn isOdd(v) ^mod(v,2) ?= 0;
```

It can be quite useful to negate a predicate, which is easily done with the unary `!` and a function value:

```java
def isEven: !isOdd;

// or:
def isEven: | ! isOdd |;
```

**Note:** `!` is overloaded to produce a negated (aka, complement) function if used against a function value. Otherwise, it acts to flip/negate a boolean value.

#### Function Pre-conditions

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

You *could* write it this way:

```java
defn myFn(x) {
    ?{
        ?[x ?<= 1]: ^1
        ?: empty
    }

    // ..
}
```

The problem is, this `^1` "early return" isn't particularly obvious, and requires reading into the body to determine.

**Foi** functions ***can and should do better***.

Pre-conditions are [guard expressions](#guard-expressions), of the form `?[    ]: expr` or `![    ]: expr`, which are applied to *guard* against the need to run the function. One or more of these pre-conditions may appear in the function definition, between the `(    )` parameter list and the body of the function -- either the `{    }` full body, or the the `^`-denoted concise expression-body.

Thus, the above `myFn()` function could be more appropriately defined as:

```java
defn myFn(x) ?[x ?<= 1]: 1 {
    // ..
}
```

Pre-conditions are evaluated -- hoisted to the call-site -- before actual function invocation. If a pre-condition matches, the consequent `expr` is evaluated and returned (no `^` return sigil) and thus the function invocation is skipped.

----

Just like with pattern matching expressions, a preceeding `!` (in place of the `?`) negates the pre-condition. By using this form of a pre-condition, you somewhat conform it to the typical mental model of pre-conditions (as discussed earlier).

For example, if you want to define a function that only computes its result when the input is greater than `10`:

```java
defn myFn(x) ![x ?> 10]: empty {
    // ..
}
```

You can read/interpret the `![x ?> 10]: empty` pre-condition as: "x must be greater than 10; if it's not, return `empty` instead". That's basically the way we interpret pre-conditions in any programming language.

**Note:** In this usage, `empty` indicates to the calling code that the function had no valid computation to perform. However, there are other types of values that could (should!?) be returned here, such as a Maybe@None or an Either@Left. More on monads later.

----

If a function has multiple parameters, a pre-condition may imply a *relationship* between them. For example, to define a function where the first parameter must be larger than the second:

```java
defn myFn(x,y) ![x ?> y]: empty {
    ^(x - y);
}
```

Here, if `myFn(5,2)` is called, the result will be `3`. But if `myFn(2,5)` is called, the function won't be invoked at all, and the result (from the pre-condition) will be `empty`:

```java
defn myFn(x,y) ![x ?> y]: empty {
    ^(x - y);
}

def result1: ?(myFn(5,2)){
    ![empty]: #
    ?: 0
};
def result2: ?(myFn(2,5)){
    ![empty]: #
    ?: 0
/?;

result1;            // 3
result2;            // 0
```

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
defn factorial(v) ?[v ?<= 1]: 1 {
    ^v * factorial(v - 1);
}

factorial(5);                   // 120
```

Tail-calls (recursive or not) are automatically optimized by the **Foi** compiler to save call-stack resources:

```java
defn factorial(v,tot: 1) ?[v ?<= 1]: tot {
    ^factorial(v - 1,tot * v)
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
    customerCache := cacheAppend(customerCache,customer);

    // but this is disallowed because `count`
    // isn't listed in the `over` clause:
    count := count + 1;
}
```

**Note:** Closure over free/outer variables -- specifically, (r-value) read-only access -- is allowed without being listed in the `over` clause. The `over` clause must only list free/outer variables that will appear in an (l-value) assignment-target position.

#### Function Composition

Function composition can be defined in left-to-right style, with the `+>` flow operator:

```java
defn inc(v) ^v + 1;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

def compute1: inc +> triple +> half;
def compute2: | +> inc, triple, half |;

compute1(11);           // 18
compute2(11);           // 18
```

**Note:** The `+>` flow operator produces a unary function, meaning it will only accept and pass-along a single argument; any additional passed arguments are ignored.

It's also very common in FP to prefer right-to-left style composition. Probably the most obvious reason is the visual-ordering coherency between `half(triple(inc(v)))` and a composition argument list like `half, triple, inc`.

The `<+` compose-right operator is equivalent to using the `'` prime operator to reverse the order of the `+>` operator's arguments, as `'+>`:

```java
defn inc(v) ^v + 1;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

def compute1: | <+ half, triple, inc |;
def compute2: | '+> half, triple, inc |;

compute1(11);           // 18
compute2(11);           // 18
```

#### Function Pipelines

By contrast, the `#>` pipeline operator (F#-style) operates left-to-right like this:

```java
defn inc(v) ^v + 1;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

11 #> inc #> triple #> half;        // 18

11 #> | +> inc, triple, half |;     // 18
```

The first expression in a pipeline must be a value (or an expression that produces a value). Each subsequent step must resolve to a function, which when invoked produces a value to pass on to the next step.

Since the `#>` operator is n-ary, multiple steps can also be used in the evaluation-expression form:

```java
defn inc(v) ^v + 1;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

| #> 11, inc, triple, half |;       // 18
```

Recall that we can reverse the order of arguments with the `'` prime operator, allowing us to do right-to-left pipelining (if we wanted to for some reason):

```java
defn inc(v) ^v + 1;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

| '#> half, triple, inc, 11 |;       // 18
```

The *topic* of a pipeline step is the result of the previous step, and is implicitly passed as the single argument to the step's function. But the *topic* (i.e., the previous step's result value) can be explicitly referred to with the `#` sigil:

```java
defn add(x,y) ^x + y;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

11 #> add(1,#) #> triple #> half;        // 18
11 #> | add 1, # | #> triple #> half;    // 18
```

Of course, if the `add()` function is curried, we can get back to point-free style (no need for the explicit `#` topic):

```java
defn add(x)(y) ^x + y;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

11 #> add(1) #> triple #> half;        // 18
11 #> | add 1 | #> triple #> half;     // 18
```

A *pipeline function* is a specialized function definition form that replaces the `^` return sigil with a `#>` pipeline as its concise body. The *topic* of the first step is automatically bound to the first parameter of the function:

```java
defn add(x,y) ^x + y;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

defn compute(x) #> add(1,#) #> triple #> half;

compute(11);    // 18
```

And again, if we define `add()` as curried function, we can avoid the `#` topic reference:

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

def compute: | +> add(1), triple, half |;

compute(11);    // 18
```

The previous `#>` *pipeline function* form is more powerful/flexible than the `+>` approach, in that a pipeline function can declare multiple parameters, and access any of them throughout the pipeline via `#`.

### Loops and Comprehensions

Perhaps some of the most distinctive features in various programming languages (FP-oriented versus more general) is the mechanics of looping/iteration. Imperative languages tend to have a variety of loop types (`for`, `while`, `do..while`, etc), whereas FP languages favor iterations/comprehensions (`map`, `filter`, `reduce` / `fold`, etc).

**Foi** is unquestionably an FP-oriented language, but tries (to an extent!) to cast a wider, more pragmatic net, in hopes of being inclusive of broader programming styles. As such, there's a unified syntax which can be used for both imperative looping and declarative iteration/comprehension.

Let's start with the typical imperative loop approach. Here's a loop that prints `"Hello!"` four times, using the `~` loop operator:

```java
0..3 ~ {
    log("Hello!");
};
// Hello!
// Hello!
// Hello!
// Hello!
```

`~` is a operator/function that can be used either in the infix form (shown above) or the evaluation-expression form. The first operand to `~` defines the *range*, and the second operand defines the *iteration* operation(s).

1. The *range* is an expression that determines the *bounds* of the loop processing; this expression can take two forms:

    - If the *range* expression resolves to a Record/Tuple, the contents of the value are set as fixed *bounds* for loop processing. Examples of such an expression: an identifier, a function call, generated (`0..3`, as above), or explicit inline (such as `< 0, 1, 2, 3 >`).

    - If the *range* expression is a conditional of the form `?[    ]` or `![    ]` -- same as the conditional of an independent [pattern matching](#pattern-matching) clause -- the expression will be evaluated *before* each iteration, and will only proceed with the iteration if `true`; `false` signals the end of the *range* and terminates the loop.

        For example:

        ```java
        def done: false;

        ![done] ~ {
            // ..
        };
        ```

        This loop will keep running as long as `done` is false. The *range* could also have been written as `?[!done]`, but the former should generally be preferred as easier to read.

    - If the `range` expression is omitted, `~` returns another function that expects a single argument defining the *range*. For example:

        ```java
        def printAll: ~ log;

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
        0..3 ~ log;
        // 0
        // 1
        // 2
        // 3
        ```

    - an inline block with a `(    )` block-definitions clause (list of comma-separated definitions). For example:

        ```java
        2..5 ~ (v, idx) {
            log(idx + ": " + v);
        };
        // 0: 2
        // 1: 3
        // 2: 4
        // 3: 5
        ```

        **Warning:** Beware that any initializations of these definitions (e.g., `(v: 3, idx: 7)`) may very well be overwritten immediately, as they are assigned per-iteration according to the loop `range` and the iteration-type.

        If the loop iteration doesn't need any block-scoped definitions, omit the `(    )` block-definitions clause:

        ```java
        0..3 ~ {
            log("Hello!");
        };
        // Hello!
        // Hello!
        // Hello!
        // Hello!
        ```

In general, the result of the `~` operation is another *range* (e.g., Record/Tuple), such that multiple `~` expressions can be chained together. For example, `a ~ b ~ c`, which would loop performing `b` over the `a` *range*, then loop performing `c` over the resultant *range* from the first `~` operation. The same would be true of `| ~ a, b, c |`.

**Note:** For `~` looping over a Record/Tuple *range*, `~` by default produces the same *range* as its result. But in the case where the *range* was a conditional, the result of `~` will be the final boolean `false` that terminated the *range*.

#### Tagged Comprehensions

However, moving beyond imperative looping to comprehensions, `~` can be *tagged*, to indicate a more specific, declarative kind of iteration. A tagged `~` comprehension overrides control of the *iteration* and the final `~` expression result.

Supported comprehension tags on the `~` operator are: `~map`, `~filter`, `~fold`, and `~foldR`.

For example:

```java
defn double(v) ^v * 2;

def evens: 0..5 ~map double;
// < 0, 2, 4, 6, 8, 10 >
```

You can also use the inline function definition form:

```java
def evens: 0..5 ~map defn(v) ^v * 2;
// < 0, 2, 4, 6, 8, 10 >
```

And with the the inline-block form:

```java
def evens: 0..5 ~map (v) {
    v * 2;
};
// < 0, 2, 4, 6, 8, 10 >
```

To compose multiple comprehensions:

```java
defn inc(v) ^v + 1;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

def odds: < 1, 3, 5, 7, 9 >;

odds ~map inc ~map triple ~map half;
// < 3, 6, 9, 12, 15 >

odds ~map | +> inc, triple, half |;
// < 3, 6, 9, 12, 15 >

| ~map odds, inc, triple, half |;
// < 3, 6, 9, 12, 15 >
```

Further, we can take advantage of omitting the *range* to create a function out of the comprehension composition:

```java
defn inc(v) ^v + 1;
defn triple(v) ^v * 3;
defn half(v) ^v / 2;

def compute1: ~map inc ~map triple ~map half;
def compute2: | ~map , inc, triple, half |;

compute1(< 1, 3, 5, 7, 9 >);
// < 3, 6, 9, 12, 15 >

compute2(< 1, 3, 5, 7, 9 >);
// < 3, 6, 9, 12, 15 >
```

The `~filter` comprehension works like this:

```java
defn isEven(v) ^mod(v,2) ?= 0;

def evens: 0..9 ~filter isEven;
// < 0, 2, 4, 6, 8 >

def odds: 0..9 ~filter (v) {
    !isEven(v);
};
// < 1, 3, 5, 7, 9 >
```

The `~fold` comprehension (left-to-right) works like this:

```java
defn add(x,y) ^x + y;

0..9 ~fold add;
// 45

0..9 ~fold (acc,v) {
    acc + v;
};
// 45
```

The result (and type) of the `~fold` comprehension is determined by the return value of the final *iteration* (`add()` above).

The `~fold` comprehension accepts an optional third argument as an *initial-value* for the fold; however, this can only be provided in the evaluation-expression form:

```java
defn sub(x,y) ^x - y;

| ~fold 1..5, sub, 100 |;
// 85   (100 - 1 - 2 - 3 - 4 - 5)
```

Folds *can* produce a Record/Tuple result. One common way to accomplish this is for the *initial-value* to be a Record/Tuple:

```java
defn onlyOdds(list,v)
    ![mod(v,2) ?= 1]: list
        ^list + < v >

| ~fold 0..9, onlyOdds, <> |;
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

### Type Annotations

Type annotations in **Foi** are applied to values/expressions (not to variables, etc). These are optional, as **Foi** uses type inference wherever possible. But applying them can often improve the performance optimizations the **Foi** compiler can produce. A type annotation always begins with the `as` keyword:

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

The `?as` operator corresponds to the `as` type annotation keyword; it's a boolean operator that returns `true` if a value/expression matches the indicated type, `false` otherwise:

```java
def age: 42;

age ?as int;                // true

(age as bool) ?as int;      // false
```

This operator is useful in pattern matching:

```java
deft SimpleFunc (int) -> empty;
deft InterestingFunc (int,string) -> empty;

def result1: ?(myFn){
    ?[?as SimpleFunc]: myFn(42)
    ?[?as InterestingFunction]: myFn(42,"Kyle")
    ?: myFn()
};

// or:

def result2: ?{
    ?[myFn ?as SimpleFunc]: myFn(42)
    ?[myFn ?as InterestingFunction]: myFn(42,"Kyle")
    ?: myFn()
};
```

## License

[![License](https://img.shields.io/badge/license-MIT-a1356a)](LICENSE.txt)

All code and documentation are (c) 2022 Kyle Simpson and released under the [MIT License](http://getify.mit-license.org/). A copy of the MIT License [is also included](LICENSE.txt).
