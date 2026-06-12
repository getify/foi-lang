# Expressiveness in Foi

Expressiveness is not about doing something that's impossible in other languages. It is about making important ideas easier, clearer, and more direct to... *express*.

**Foi**'s individual features are not necessarily unprecedented, nor are they categorically more powerful than other languages in the abstract. Most useful language ideas have precedents somewhere.

**Foi** is expressive because it promotes common practical-FP operations into direct syntax: adapting functions, composing predicates, deriving immutable data shapes, surfacing effect boundaries, and making decision logic visually consistent.

Expressiveness means reducing the distance between what the programmer means and what the code has to mechanically spell out.

## Functional Programming... Without So Many Lambdas!?

**Foi** is heavily oriented as an FP language. But many FP languages rely on functions -- especially lambdas -- as the default tool for expression-boundary abstraction. If you're writing FP, you often end up writing a *lot* of small lambda functions.

**Foi** does make `defn` relatively lightweight, especially compared to JavaScript's `function` syntax. But something more important is happening.

**Foi** does not want you to burden you with *any function definition syntax* merely to express a common adapter pattern.

Instead, **Foi** provides many syntactic affordances in places where most FP languages would require a wrapping lambda: to partially apply arguments, skip argument positions, reverse argument order, invoke operators as functions, negate predicates, spread tuple values into calls, or route a pipeline topic into a specific argument position.

In other words, **Foi** is not trying to be "less *function*-al." The goal is for functions to represent meaningful abstraction boundaries, not incidental syntax boundaries.

## Expressiveness Is Not Mere Brevity

**Foi** code is often shorter than equivalent code in more familiar languages, but terseness is not the goal by itself. A short program can still be obscure. A verbose program can still be clear.

**Foi**'s goal is semantic compression: **more of the code's visible surface should carry domain or program meaning, and less of it should be incidental scaffolding.**

That distinction matters. Expressive syntax is only valuable when it corresponds to a recurring semantic pattern. **Foi**'s asserts that several operations are common enough in practical FP to deserve first-class notation:

* reshape a function
* invoke an operator as a function
* negate a predicate or relation
* derive a new immutable record/tuple from an existing one
* expose preconditions in the function signature
* declare closure-crossing reassignment effects
* compose, pipe, map, fold, chain, and sequence computations
* comprehension operators accept blocks as *lightweight* function operands

The result is not "less code" as a vanity metric. The goal is code that says the intended move directly.

## A Coherent Surface, Not a Bag of Tricks

**Foi**'s syntax is intentionally symbolic in some places, word-based in others, and hybridized in several named operators. That mixture is not arbitrary. **Foi** uses a small keyword set, symbolic operators where they are natural, and named operators where a symbol plus word improves visual distinction and semantic grouping.

This philosophy matters to expressiveness because syntax has to do more than parse. It should create recognizable visual families.

For example:

* boolean and decision-making forms use `?` and `!`
* loops and comprehensions use `~` and `*`
* composition and pipelines visually indicate flow direction
* `^` signifies "return" from a function as result flow upward/out
* records and tuples (and maps/sets) share the unified `< .. >` notation
* record/tuple derivation uses the `&` pick sigil
* computed record keys use `%`

**Foi**'s expressiveness depends on these clusters being regular. A feature is easier to learn when it belongs to a family instead of being a one-off exception.

## Operators as Functions

**Foi** treats operators as callable values. That means an operator can be used in ordinary infix/prefix form when there are one or two operands, but it can also be invoked as a function when that better fits the intended shape of the operation.

```java
(+)(1,2,3,4,5);         // 15
```

That matters more for operators whose meaning is not simply repeated pairwise syntax. For example, checking that several values are equal is one conceptual operation:

```java
(?=)(x, y, z);
```

The less expressive spelling is not merely longer; it has to manually construct the idea from lower-level pieces:

```java
(x ?= y) ?and (y ?= z) ?and (x ?= z);
```

The operator-as-function form lets the code say "these values satisfy this relation together" instead of repeatedly writing the binary relation and combining the results.

This is especially important because many **Foi** operators are naturally n-ary. Operator-as-function syntax prevents the language from forcing every operation into binary infix shape.

## Negatable Operators

**Foi** also presents boolean-returning operators as part of a visually consistent `?` / `!` family. Affirmative predicates begin with `?`; their negated forms use `!`.

```java
x ?= 42;
x != 42;

x ?> y;
x !> y;

x ?in numbers;
x !in numbers;
```

That extends to logical operators:

```java
true ?and false;
true !and false;

false ?or false;
false !or false;
```

The point is not just that `!and` is shorter than `!(x ?and y)`. The point is that the negation is attached to the relation itself.

```java
x !and y
```

says "not both" as the operator-level idea. It does not require wrapping a larger expression in parentheses just to reverse the resulting boolean.

This is more expressive because the code names the relation being used (in a single operator), instead of encoding that relation through combined expression evaluation the reader must evaluate.

## Predicate Negation

**Foi** also allows predicate functions themselves to be negated:

```java
def isEven: !isOdd;
```

The `!` operator is polymorphic. When used with a value that can coerce to a boolean, it negates. But when used with a function, it produces a complemented predicate.

This keeps predicate adaptation in the same visual family as operator negation. Again, the important property is regularity:

```java
x != y          // negated equality operator
x !in ys        // negated inclusion operator
!isOdd          // negated predicate function
![condition]    // negated guard/pattern/precondition
```

**Foi** consistently uses `!` for "the negative version of this decision-making thing."

## Partial Application as Syntax

Functional programming depends heavily on function adaptation. In many languages, partial application is available only through currying, helper libraries, placeholder conventions, or throwaway lambdas.

**Foi** gives partial application its own call form:

```java
def add6: (+)|6|;

add6(12);       // 18
```

The `| .. |` form is not a normal invocation. It always produces a specialized function.

That becomes more valuable when only some argument positions should be fixed:

```java
def fn: xyz|3,,7|;

fn(5);          // x: 3, y: 5, z: 7
```

Without this syntax, the usual expression would be a wrapper:

```js
x => xyz(3, x, 7)
```

That wrapper is not conceptually important. It is scaffolding. **Foi**'s partial-application syntax expresses the intended transformation directly: *this function, with these argument positions already supplied*.

## Argument Reversal as Syntax

Function composition often runs into argument-order friction. The shape of a function's parameters may not match the shape needed by a composition or pipeline.

**Foi** gives argument reversal a postfix prime operator:

```java
(-)'(1,6);      // 5 :: 6 - 1
```

The same operation can be captured as a function transformation:

```java
def subtrRev: (')(-);

subtrRev(1,6);  // 5
```

And for operators, **Foi** supports the compact form:

```java
(-')(1,6);      // 5
```

The underlying idea is not new; many FP libraries have `flip`. The expressive move is making that adaptation cheap enough to use inline without interrupting the code with a named helper or wrapper lambda.

This matters because practical FP is full of small function-shaping moves. **Foi** tries to make those moves syntactically lightweight.

## Function Adaptation as a First-Class Design Axis

Several **Foi** features make more sense when grouped together:

```java
(?=)(x,y,z)     // invoke operator as n-ary function
!isOdd          // complement a predicate
foo|1,,3|       // partially apply selected argument positions
foo'(...)       // reverse argument order
(...)(+)        // adapt a function to accept a tuple/list of arguments
```

The shared theme is function adaptation.

**Foi** does not merely provide functions as first-class values. It provides syntax for reshaping functions and operators at the point of use. That is a meaningful expressiveness axis.

A lot of FP code is not just "call this function." It is:

* call this operator as a function
* turn this operator into a reusable function
* reverse this function's argument order
* fix some of this function's arguments
* spread this tuple into the call
* create a function that expects a tuple and applies it

**Foi** gives those transformations a regular syntax vocabulary.

## Comprehension Blocks as Lightweight Function Operands

JS offers `map()`, which requires you to pass a function reference as the mapping operation, either as an inline `=>` arrow lambda or a named proper function value:

```js
var doubledNums = nums.map(n => n * 2);
var tripledNums = nums.map(mulBy3);
```

But sometimes, you need bespoke inline logic, so you typically need a function value to enclose that logic:

```js
formattedPrices = prices.map(cents => {
    var dollars = Math.floor(cents / 100);
    var centsStr = String(cents % 100).padStart(2,"0");
    return `$${dollars}.${centsStr}`;
});
```

**Foi**'s comprehensions like `~map` are operators, and can similarly be invoked with functions when appropriate:

```java
def doubledNums: nums ~map defn(n) ^n * 2;
def tripledNums: nums ~map mulBy3;
```

But in the `formattedPrices` scenario above, instead of `defn`, a block (with optional block-scoped definition) serves as a lightweight function wrapper for the purpose of that operator evaluation:

```java
formattedPrices := prices ~map (cents) {
    def dollars: floor(cents / 100);
    def centsStr: modulo(cents,100) #> ToString #> padStart(#,2,"0");
    `"$`dollars`.`centsStr`";
};
```

**NOTE:** The `(cents) { .. }` block form is not a portable function value. It may only be defined inline as an operand to a comprehension, it does not allow preconditions or `:over` declarations, and its final expression is the implicit result value, without a `^` return marker.

Because this block form cannot declare `:over`, it is intentionally limited in what it may close over. It may reference outer variables only if those variables are effectively constant — that is, never reassigned lexically. Foi rejects closure over a non-constant outer variable in this form, since there is no `:over` clause available to make that dependency explicit.

This restriction is deliberate. Comprehension blocks are meant for simple inline transformation logic, not as a shorthand for full function definitions. By keeping the form narrower than `defn`, Foi can preserve clearer effect boundaries and give the compiler more room to specialize and optimize these blocks.

## Immutable Records and Tuples

**Foi** treats records and tuples as immutable value types. That has a cost: if values are immutable, then "changing" them requires deriving new values from existing ones.

A language that requires immutability but makes derivation awkward creates pressure to abandon the style. **Foi** addresses that by making structural derivation ergonomic.

The key operation is not mutation. It is deriving a new value from an old one.

```java
def person: < first: "Kyle", last: "Simpson" >;
def friend: < &person, first: "Jenny" >;
// < first: "Jenny", last: "Simpson" >
```

The new record is not produced by mutating `person`. It is produced by picking/linking from `person` and then overriding the `first` field in the new value.

That is practical FP: immutable transformation, expressed directly.

## Structural Projection and Splicing

The `&` pick sigil is one of **Foi**'s strongest expressiveness examples because it goes beyond object spread. It unifies whole-value inclusion, field projection, index projection, multi-pick, and slicing inside record/tuple construction.

Pick the whole tuple:

```java
def numbers: < 4, 5, 6 >;
def allDigits: < 0, 1, 2, 3, &numbers, 7, 8, 9 >;
// < 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 >
```

Pick one tuple position:

```java
def numbers: < 4, 5, 6 >;
def oddDigits: < 1, 3, &numbers.1, 7, 9 >;
// < 1, 3, 5, 7, 9 >
```

Pick one record field:

```java
def person: < first: "Kyle", last: "Simpson" >;
def friend: < first: "Jenny", &person.last >;
// < first: "Jenny", last: "Simpson" >
```

Pick several tuple positions:

```java
def numbers: < 3, 4, 5, 6, 7 >;
def evenDigits: < 2, &numbers.<1,3>, 8 >;
// < 2, 4, 6, 8 >
```

Pick a tuple slice:

```java
def fiveBelow: < 0, 1, 2, &numbers.[..2] >;
// < 0, 1, 2, 3, 4, 5 >
```

Pick several record fields:

```java
def person: < first: "Kyle", last: "Simpson", nickname: "getify" >;
def profile: < &person.<first,nickname> >;
// < first: "Kyle", nickname: "getify" >
```

This is not merely a shorter spelling for property access. The `&` form preserves and splices structure.

**Foi** gives structural projection and structural splicing a unified notation across records and tuples.

In many languages, the same family of operations is scattered across property access, indexing, slicing, destructuring, spreading, helper functions, temporary bindings, and reconstruction. **Foi** collapses the common "derive this shape from that shape" operation into one syntax family.

## Derivation Instead of Mutation

The `&` syntax is not isolated. It supports a broader language stance: records, tuples, maps, and sets share one structural model.

Records and tuples use `< .. >`. Sets are unique-filtered tuples. Maps are records that can use non-primitive keys through `%`.

```java
def person: < name: "Kyle Simpson", %"favorite number": 42 >;
```

This unification matters because a programmer does not need to learn unrelated literal forms for arrays, objects, maps, sets, spreading, computed keys, and derivation.

**Foi** asks the programmer to learn one structural family, then extends it with regular sigils:

* `< .. >` constructs records/tuples
* `<[ .. ]>` constructs unique tuples as sets
* `&` picks/splices existing structure into new structure
* `%` computes a record/map key
* `empty` removes a field from a derived record/tuple

That is a real expressiveness claim: one mental model covers several common data-shaping tasks.

## Preconditions in Function Signatures

**Foi**'s function preconditions are another form of expressiveness: they move important assumptions out of the function body and into the visible function header.

```java
defn factorial(v) ![v ?> 1]: 1 {
    ^v * factorial(v - 1);
};
```

This says that if `v` is not greater than `1`, the result is already known: `1`. The function body only describes the case that still needs computation.

That is different from burying the base case inside the body as an early return. **Foi** makes the boundary visible before the implementation begins.

Preconditions are not merely control flow. They are part of the function's contract:

```java
defn myFn(x,y) ![x ?> y]: empty {
    ^(x - y);
};
```

This function declares, at the header, that the meaningful computation only happens when `x` is greater than `y`; otherwise, the result is `empty`.

That is expressive because the signature says more than "this function takes x and y." It says something about the relationship between those values and the conditions under which the function's body is relevant.

## Declared Closure Reassignment with `:over`

**Foi** also treats closure-crossing reassignment as a visible effect.

Read-only closure over outer values is allowed implicitly, but reassignment of an outer variable must be declared:

```java
def customerCache: empty;
def count: 0;

defn lookupCustomer(id) :over (customerCache) {
    customerCache := cacheAppend(customerCache,customer);

    // disallowed unless `count` is listed in :over
    count := count + 1;
};
```

This is an important practical-FP design point. **Foi** does not pretend real programs never need local reassignment. It also does not allow cross-boundary reassignment to disappear into a function body unnoticed.

The `:over` clause gives syntax to a semantic distinction many languages blur:

* reading from an outer lexical environment
* reassigning into an outer lexical environment

Those are not the same operation. **Foi** makes the difference visible.

That is expressiveness through effect visibility, not through purity absolutism.

## Controlled Imperative Escape Hatches

**Foi**'s mission is not to ban imperative programming. It is to make risky or effectful operations apparent.

That matters because practical FP often fails when a language pushes all impurity into either heavy abstraction or invisible convention. **Foi** instead tries to preserve directness:

* immutable data by default
* derivation syntax instead of mutation
* reassignment allowed
* closure-crossing reassignment declared
* external effects represented through monadic constructs like `IO`
* no runtime exceptions; errors are represented as `Left`

**Foi** is expressive for the seam between pure transformation and real programs.

Many FP languages are excellent at expressing pure computation. **Foi**'s design tries to be especially readable where pure computation meets mutation, effects, errors, asynchronous work, and data derivation.

## Pattern Matching, Guards, and Decision Syntax

**Foi**'s decision-making syntax reinforces the same `?` / `!` model used by predicates and boolean operators.

Dependent pattern matching:

```java
?(myName){
    ?["Kyle"]: "Hello!";
    ?: "Goodbye!"
};
```

Independent pattern matching:

```java
?{
    ?[myName ?= "Kyle"]: "Hello!";
    ?: "Goodbye!"
};
```

Standalone guard:

```java
?[!empty myName]: printGreeting(myName);
```

These forms are not just replacements for `if` / `else if` / `switch`. They keep decision-making visually aligned with predicates, negated predicates, preconditions, and boolean-returning operators.

This is expressive because related semantic categories are visually grouped:

```java
?and
?or
?=
?empty
?has
?in
?{ ... }
?[ ... ]:
![ ... ]:
```

A reader can learn that `?` asks a question and `!` asks the negated question. That is a language-wide mental model, not just a naming convention.

## Composition and Pipeline Readability

**Foi** has both composition and pipeline syntax:

```java
def compute: inc +> triple +> half;

11 #> inc #> triple #> half;
```

The operators visually indicate direction. `+>` composes left-to-right; `<+` composes right-to-left. `#>` pipelines a value through a sequence of functions.

**Foi** also allows the pipeline topic to be referenced explicitly:

```java
11 #> add(1,#) #> triple #> half;
```

This is another practical compromise. Point-free style is often elegant when it works, but awkward when a step needs the topic in a specific argument position. **Foi** does not force every pipeline step to become a separate helper just to preserve point-free purity.

Again, the expressive goal is not maximal abstraction. It is readable composition.

## Expressiveness by Semantic Regularity

**Foi**'s strongest expressiveness argument is not any single feature. It is the way features reinforce each other.

Examples:

```java
(?=)(x,y,z)
x !and y
!isOdd
foo|1,,3|
foo'(...)
< &person.<first,nickname> >
defn myFn(x) ![x ?> 10]: empty { ... }
defn lookupCustomer(id) :over (customerCache) { ... }
```

These all follow the same design impulse:

recurring semantic operations should have direct syntax.

The operations differ, but the philosophy is consistent:

* don't simulate n-ary relation checks with repeated binary expressions
* don't simulate predicate negation with wrapper functions
* don't simulate partial application with throwaway lambdas
* don't simulate argument reversal with named helpers
* don't simulate structural projection with destructure/reconstruct boilerplate
* don't hide preconditions inside function bodies
* don't hide closure-crossing reassignment effects inside implementations

That is the heart of **Foi**'s expressiveness case.

## Novelty

Most individual ideas in **Foi** have precedents.

Operators-as-functions, partial application, function composition, pipeline operators, pattern matching, guards, immutable data, records, tuples, monads, maps, sets, slices, and spreads all have history in other languages.

**Foi** is a novel collection/combination of these features in a compact, regular, mutually reinforcing surface syntax, with some of its own unique ideas woven in.

The `&` structural projection/splicing syntax is one of the more distinctive pieces, especially because it works across whole values, fields, indexes, multi-picks, and slices. The `:over` clause is also distinctive because it separates read-only closure from closure-crossing reassignment.

For other features, the real expressive value in **Foi** is that common adaptations are cheap and visually local.

## In other words...

**Foi**'s expressiveness comes from its insistance that common semantic idioms don't suffer accidental boilerplate.

Where many languages make programmers repeatedly construct these ideas out of lower-level mechanics, **Foi** gives them native shapes:

* n-ary operators as functions
* negated operators and predicates
* positional partial application
* argument reversal
* structural pick/splice derivation
* signature-level preconditions
* declared closure reassignment
* visually consistent decision-making

**Foi** offers a deliberate, coherent surface for practical functional programming.
