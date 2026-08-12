# Foi Symbol-Table Contract

**Version:** draft (design phase)
**Status:** In Progress

This document specifies the **symbol table**: the data structure produced by
the scope-analysis pass and consumed by every pass after it. It is derived
from `Foi-Specification.md` and is subordinate to it. Where this document and
the spec disagree, the spec is correct and this document has a defect.

It is a *data* contract, not an algorithm. Any implementation producing a
conforming table for a conforming AST is correct, regardless of how it walks.

## §1 Position In The Pipeline

```
source  ->  tokenizer  ->  parser  ->  AST (JSON)
                                        |
                                        v
                             scope analysis  ->  { scopes, bindings,
                                                   references, diagnostics }
                                        |
                                        v
                      type elaboration, effect coverage, codegen
```

The pass is a **pure function**: AST in, table and diagnostics out as data.
No I/O, no source text reads, no filesystem, no module loading. Every position
it reports is an offset pair carried on the AST node it came from.

**It runs per module.** Cross-module resolution is not its job — an imported
binding is reached through the local name its `import` bound (§7.4).

**It is not order-dependent on itself.** The pass is phased (§8); no phase
reads a field a later phase writes.

**Offsets are inclusive on both ends.** A node's `start` and `end` are the
first and last character positions of its own text; a one-character token has
`start == end`. Diagnostic spans carry the same convention.

## §2 Scopes

### §2.1 What Introduces A Scope

A scope corresponds to a **frame** in §0.1's sense, with the exceptions noted
in the table. The nodes that introduce one:

| Introducer | Spec | Note |
|---|---|---|
| the pre-seeded root | §7.4 | not an AST node; no frame; scope `0` |
| module root | §2.10 | `Program`; parent is the pre-seeded root, not `null` |
| `DefFuncExpr` | §2.11 | one scope **per paramSet** — see below |
| `DefHookDecl` | §2.11 | same — one scope per paramSet |
| `BareBlockExpr` | §2.9.1 | |
| `BlockExpr` | §2.9.3, §2.9.4 | defs clause and body share **one** scope |
| `DefBlockStmt` | §2.9.2 | defs clause and body share **one** scope |
| `DoBlockExpr` | §2.9.1, §2.1.1 | `~<<` / `~<*` body; outermost of the chain; `doBlock: true` |
| a `::` bind | §2.1.1 | `DoVarDefInitOpt` with `op: "::"`, or `DoDefVarStmt`; one each; `doBlock: true` |
| topic-binder region | §5.2.2 | dependent match; each `#>` stage — no frame; see §5 |

**Curried declarations get one scope per paramSet.** §2.11 allocates a frame
per *call*, and `defn f(x)(y)` is two nested function values, so `x` and `y`
cannot share a frame. The scope for paramSet *n+1* is the child of paramSet
*n*'s; the body belongs to the innermost.

This applies to `DefHookDecl` on identical terms. `paramSets` is an array on
both node types, the grammar admits `(...)+` at both, and the corpus carries
curried hook declarations (`defn Foo@(x)(y) ^x;`, `defn Bar%(self)(env) ^env;`).
Whether a hook *may* be curried is §3.1.1's question and not this pass's; the
pass walks what the parser produced.

**One `:over` clause governs every tier.** The declaration carries exactly one
`FuncOverClause`, after the last paramSet; every tier scope carries its names
in `overNames`. Only two positions in a curried declaration can reference a
binding from outside the innermost tier — a parameter's `:? default` (§3.2.2)
and a precondition hoisted to an outer tier (§3.5.1). Both are governed by
that one clause.

**A paramSet is either a `ParameterList` or a bare `GatherParameter`.** The
gather form does not sit inside a `ParameterList`; it occupies the paramSet
slot directly. Read `paramSets[n]` by type before reaching for `.params`.

**What does not introduce a scope.** Per §0.1: bare-expression positions, and
function-body statements not enclosed by a nested block, evaluate in the
enclosing frame. A non-block match or guard consequent (`?[c]: expr`) is such
a position. Only the forms above introduce scopes; a consequent *block* does
so as a `BareBlockExpr` or `BlockExpr`, by its own row.

**The do-block body is its own node type.** A `~<<` / `~<*` body is a
`DoBlockExpr`, not a `BareBlockExpr`, and it owns the defs clause —
`DoComprExpr.body.defs`, not `DoComprExpr.defs`. It introduces the outermost
scope of the chain below, and carries `doBlock: true`. The clause is
`DoBlockDefsInitOpt` holding `DoVarDefInitOpt` entries; both are distinct
node types from §11's `BlockDefsInitOpt` / `VarDefInitOpt`.

**`::` is what nests, and a defs clause and the statement list are one
chain.** §2.1.1 casts each bind as its own `~<` chain step nested in the one
ahead of it, and §3.10.9.4 lowers it to a bind whose continuation takes the
name. Two surfaces spell a bind: a defs entry with `op: "::"`, and a
`DoDefVarStmt` statement. Walk them in order, carrying a current scope that
starts at the `DoBlockExpr` scope:

- a **bind** opens a child of the current scope; its **initializer resolves
  in the current scope**, and its **target registers in the new one**, which
  then becomes current;
- a defs entry with `op: ":"` or no `init` registers in the current scope;
- every other statement evaluates in the current scope and registers there.

The order is what makes shadowing work. `def x:: parse(x);` after
`def x:: readLine();` resolves its argument to the first binding, because the
initializer is resolved before the second target exists. Registering first
would make it a self-reference.

```java
def r: IO ~<< {
    def x:: readLine();
    def x:: parse(x);
    x;
};
```

A non-receiving bind binds nothing at either position —
`DoNonReceivingBindStmt` mid-block, `DoFinalUnwrapExpr` terminal. A
single-colon `def x: expr` inside the body is an ordinary `DefVarStmt`
registering in the current scope, and re-binding a name the current scope
already holds is an ordinary §2.6 collision.

Two further consequences `doBlock` carries: `def` placement is unconstrained
in such a scope, and a `Lazy@` anywhere within is a diagnostic (§7.3).

### §2.2 Scope Record

```json
{
    "id": 12,
    "parent": 4,
    "node": { "type": "BlockExpr", "start": 220, "end": 388 },
    "kind": "block",
    "overNames": [],
    "defSectionEnd": 3,
    "doBlock": false,
    "bindings": [31, 32, 33]
}
```

- **`id`** — dense integer. `0` is the pre-seeded root (§7.4), `1` is the
  module scope, and the rest are assigned in pre-order from there.
- **`parent`** — enclosing scope's `id`. `null` on the pre-seeded root alone;
  the module scope's parent is `0`.
- **`node`** — type tag and span of the introducing node. Span is what
  diagnostics point at. **`null` on the pre-seeded root**, which has no node.
  On a topic scope, the binder node — see §5 for why the span is not the
  binding region.
- **`kind`** — one of `root`, `module`, `function`, `block`, `topic`. Read
  this for *diagnostics and reporting*. Rules do not branch on it, except
  `crossesFunction` (§4.1), which is defined in terms of `function`. A
  `DoBlockExpr` scope and every `::` bind scope are `block`.
- **`overNames`** — names listed in the governing `FuncOverClause`, or `[]`.
  Empty on any scope whose `kind` is not `function`. Every paramSet scope of
  one declaration carries the same set (§2.1).
- **`defSectionEnd`** — index into the scope's statement list, one past the
  last definitional statement. §2.1.1's `def` section is `[0, defSectionEnd)`.
  `0` where the scope opens with a non-definitional statement, and `0` on a
  scope with no statement list at all — the root, every topic scope, and
  every `::` bind scope. Computed on a `doBlock` scope like any other; the
  flag suppresses the *check* (§7.3), not the field. A `BlockExpr` /
  `DefBlockStmt` defs clause counts as inside the section.
- **`doBlock`** — `true` on a `DoBlockExpr` scope and on every `::` bind
  scope within it, per §2.1.1's exemption.
- **`bindings`** — binding ids registered here, in source order. A name
  appears at most once per `(scope, ns)` pair (§2.6).

## §3 Bindings

### §3.1 The Two Namespaces

§2.6 fixes two, and they do not overlap:

- **`lex`** — the lexical identifier namespace. `def`, `defn`, parameters,
  destructure entries, gather parameters, `import` bindings, the topic.
- **`type`** — the type namespace. `deft`, the type half of
  `defn Name@(..)`, and the intrinsics of §7.4.

Lookup is keyed on `(name, ns)`. A reference site fixes which namespace it
searches, and never searches the other (§4.2).

**`defn Name@(..)` registers two bindings, not one.** §9.1: the type half and
the function value "register together and cannot be separated." The pass emits
one `type` binding and one `lex` binding sharing a `pairId`. A redeclaration
diagnostic against either must name both.

**Within `type`, the four-way collapse holds** (§3.8, §9.1): type, namespace,
constructor, and typeclass are one entity under one name. The table carries no
sub-discriminator, because there is nothing to discriminate. `deft Foo` in a
scope already holding `defn Foo@(..)` is a redeclaration error (§9.5), which
falls out of the single-slot rule with no special case.

### §3.2 The Binding Record

```json
{
    "id": 31,
    "scope": 12,
    "name": "counter",
    "ns": "lex",
    "kind": "def",
    "node": { "type": "DefVarStmt", "start": 224, "end": 240 },
    "nameNode": { "start": 228, "end": 235 },
    "assignable": true,
    "positional": true,
    "constant": false,
    "writes": [88, 91],
    "pairId": null
}
```

- **`kind`** — one of `def`, `defn`, `deft`, `deft-reach`, `param`, `gather`,
  `destructure`, `import`, `topic`, `intrinsic`. Provenance.
- **`node`** / **`nameNode`** — the introducing node's span, and the span of
  the name token specifically. Redeclaration diagnostics point at `nameNode`.
  Both `null` on an `intrinsic`. `nameNode` alone is `null` on a `topic`
  (nothing in source spells `#` at its binding site) and on a `gather`
  (`GatherParameter` flattens its identifier to a bare `name` string and
  keeps no node for it).
- **`assignable`**, **`positional`**, **`constant`** — derived; §3.4, §3.5.
- **`writes`** — reference ids of every `:=` resolving to this binding.
  Empty for a non-assignable binding, by construction.
- **`pairId`** — the sibling binding's id for a `defn Name@(..)` pair;
  `null` otherwise.

### §3.3 What Introduces A Binding

| Form | AST node | `ns` | `kind` |
|---|---|---|---|
| `def x: ..` | `DefVarStmt` (Identifier target) | `lex` | `def` |
| `def <..>: ..` | `DefVarStmt` (DestructureTarget target) | `lex` | `destructure` — one per entry |
| `def x: import ".."` | `DefVarStmt` with `ImportExpr` init | `lex` | `import` |
| `defn f(..)` | `DefFuncExpr` with `name` | `lex` | `defn` |
| `defn Foo@(..)`, `defn Foo.bar@(..)` | `DefHookDecl`, `@` marker | both | `defn` + `deft`, paired |
| `deft T ..` | `DefTypeStmt`, no `from` | `type` | `deft` |
| `deft T .. from ".."` | `DefTypeStmt` with `from` | `type` | `deft-reach` |
| parameter | `VarDefInitOpt` in a `ParameterList` | `lex` | `param` |
| gather parameter | `GatherParameter` at a paramSet slot | `lex` | `gather` |
| defs-clause entry | `VarDefInitOpt` in a `BlockDefsInitOpt` | `lex` | `def` |
| do defs entry, `op: "::"` | `DoVarDefInitOpt` | `lex` | `def` — binds in the child scope |
| do defs entry, `op: ":"` or no `init` | `DoVarDefInitOpt` | `lex` | `def` |
| `::` do-statement | `DoDefVarStmt` | `lex` | `def` — binds in the child scope |
| the topic | dependent match, `#>` stage | `lex` | `topic` — §5 |
| language-supplied names | — | `type` | `intrinsic` — §7.4 |
| `export { .. }` | `ExportExpr` entries | — | **binds nothing**; §4.4 |
| `defn Foo%(..)`, `defn Foo~map(..)`, `defn Foo+(..)`, … | `DefHookDecl`, non-`@` marker | — | **binds nothing**; §3.6 |
| tuple-mode skip position | `DestructureSkipSlot` | — | **binds nothing**; see below |

**Parameters and §11 defs-clause entries are the same node type.** Both are
`VarDefInitOpt`; the parser's strict and lenient productions shape to one AST
type, and `kind` is fixed by position rather than by node type. The
initializer arrives on `.init` for a bare `:` or on `.default` for `:?`;
nothing in the AST records which production matched.

**A do-comprehension defs entry is a different node with an explicit
operator.** `DoVarDefInitOpt` carries `op` — `":"` or `"::"` — and sets it
only when `init` is present, so the three cases are `op === "::"` (a bind,
§2.1), `op === ":"` (an ordinary binding), and no `init`. Read `op`; do not
infer the form from which fields exist.

**`DestructureSkipSlot` is a positional placeholder with no span.** It appears
in a tuple-mode `DestructureTarget`'s `entries` alongside the binding forms,
carries no fields at all, and introduces nothing. It is the one node in the
AST with no `start` / `end`, so any walker that assumes a span on every node
fails here.

**Destructure entries.** Each of `DestructureNamedDef`, `DestructureConciseDef`,
`DestructureCapture`, `DestructurePositionalDef` introduces exactly one binding
under the name it establishes, in the scope containing the target. §2.13.
Nested targets recurse; the entries flatten into the same scope. Which field
carries the name differs per form, and one of them is not a name at all —
see §4.5.

**An entry's initializer binds nothing; it resolves.** The `:? default` tail
on a parameter or destructure entry, and the `:` init on a §11 defs-clause
entry, are *expressions* evaluated in the scope being built, and their
identifier references resolve against entries **earlier in the same list**
(§3.2.2, §2.9.2). Register every binding for a paramSet or §11 defs clause
before resolving any initializer in it, then resolve initializers left to
right with visibility truncated at the declaring entry's own position. An
initializer naming a later entry is a forward reference and is a diagnostic
unless wrapped in `Lazy@`.

**A do-comprehension defs clause does not follow that order.** A `::` entry
resolves its initializer *before* its target registers, and registers into a
child scope rather than this one (§2.1). Register-then-resolve would make
`(x:: f(x))` a self-reference. A `:` or no-`init` entry in that clause follows
the ordinary rule above, against whatever the current scope holds at its
position.

**A `defn` expression's own name is not in the enclosing scope.** §3.1.2: a
named function *expression* binds its name only in the function's own scope,
for self-reference. Register it in the function scope, `kind: "defn"`. A
`defn` *declaration* (§3.1.1) binds in the enclosing scope and is visible in
the body by ordinary outward lookup — do not register it twice.

**The `@` marker is not part of the bound name.** §3.1.1.1: `defn Nothing@()`
binds `Nothing`; `Nothing` and `Nothing@` cannot coexist. A **labeled**
constructor (`defn Maybe.from@(v)`) declares on the same terms — the label
names an alternate constructor on the namespace the leading segment
establishes, and the spec requires no prior declaration for it. Register under
the leading segment; the label is not a name this pass resolves.

**A multi-segment declaration name registers under its leading segment.**
`DefTypeName` carries a `segments` array and admits dotted names
(`deft Foo.Bar from "./x.foi";`), as `DefHookName` does. Register the leading
segment and treat the remainder as a label, on the labeled-constructor rule
above: under the four-way collapse a namespace is one entity under one name,
so there is no second name for a trailing segment to bind. This is derived
from §3.1.1.1's rule rather than stated for `deft` in §9; it is the reading
consistent with §9.1, and a §9 statement to the contrary supersedes it.

### §3.4 Derived Flags

**`assignable`** — `true` for `kind` in `{ def, param, gather, destructure,
import }`; `false` for `{ defn, deft, deft-reach, topic, intrinsic }`. §2.3
names the first group "assignable bindings"; §2.3.1 makes `defn` and `deft`
structurally constant; §5.2.2 makes `#` never assignable.

**`positional`** — `true` when the binding becomes visible only after its own
declaration point, `false` when it is visible throughout its scope. §2.5 fixes
this for source declarations: `def` and everything sharing its shape are
positional; `defn` and `deft` are not, and §9.1.1 restates the same for type
names. Two further bindings are non-positional because there is no declaration
point to be after: the topic (§5) and every intrinsic (§7.4).

`positional` is what §4.2's resolver reads. It is not derivable from `kind`
alone — the topic and the intrinsics are the cases that break such a rule —
so it is carried on the record.

**`constant`** — `true` when `assignable` is `false`, or when `assignable` is
`true` and `writes` is empty. §2.3: an assignable binding never reassigned is
observably constant; a structurally constant one is unconditionally so.

`constant` is **not flow-sensitive**. §2.3: any `:=` to the name anywhere in
the scope chain the binding is visible to makes it mutable, "regardless of
whether that assignment actually executes." A `:=` inside a never-taken branch
counts. This is why `writes` must be complete before `constant` is computed,
and why the pass is phased (§8).

### §3.5 Scoping Rules Read `assignable`, Never `kind`

Every rule that asks "may this be reassigned / does this need `:over` / does
this get a slot" reads the derived boolean. Parameters and destructure entries
are implicit `def`s: §2.3 opens by saying all three "introduce a slot on
identical terms," and §3.6 restates it for `:over`. A rule branching on `kind`
will get parameters wrong, because the interesting parameter cases
(`defn countdown(n) { defn step() :over(n) { n := n - 1; }; }`, §3.6) are
exactly the ones a `def`-only branch misses.

**One carve-out, and it is not a scoping rule.** §3.6's accompanying-
declaration check asks what *declaration form* introduced a name, because the
spec's own rule is stated in those terms — a reach does not satisfy it. That
check reads `kind` to tell `deft` from `deft-reach`. Nothing about
visibility, mutability, or slot allocation does.

### §3.6 Non-`@` Hook Declarations Reference, They Do Not Declare

§9.1: exactly two constructs declare a type — `deft`, and `defn Name@(..)`.
Every other `DefHookDecl` marker (`%`, the comprehension family, and
`+ - * / ?=`) attaches a hook to a namespace that must **already** be
declared. Syntactic-Grammar §13 states the requirement directly: such a
declaration requires an accompanying declaration of the same identifier in
the same scope — a `defn Name@(..)` or a `deft Name`, and not a
`deft .. from ".."` reach.

Two consequences for the table:

- The hook declaration emits a **`read` reference** against the namespace
  name in the `type` namespace. It registers nothing. Treating it as a
  declaration would make `defn Foo%(self, env)` resolve clean with no `Foo`
  anywhere, and would make an accompanying `defn Foo@(..)` a spurious
  redeclaration.
- The accompanying-declaration requirement is **checked here** (§7.2). It is
  a question about what a scope holds, and by phase 2 this pass holds every
  declaration in every scope; no later pass is better placed. The check is
  narrower than resolution in two ways: the name must be registered *in the
  same scope* as the hook declaration, so a reference resolving outward to an
  enclosing scope satisfies resolution and still fails this; and the
  registered binding's `kind` must be `deft` or the `deft` half of a
  `defn Name@(..)` pair, never `deft-reach`.

The hook's own parameters bind in its scope as any function's do. Marker
validity, per-family parameter counts, and hook uniqueness are not this
pass's (§9).

## §4 References

### §4.1 The Reference Record

```json
{
    "id": 88,
    "scope": 12,
    "name": "counter",
    "ns": "lex",
    "node": { "type": "AssignmentExpr", "start": 260, "end": 279 },
    "nameNode": { "start": 260, "end": 267 },
    "role": "write",
    "binding": 31,
    "crossesFunction": true
}
```

- **`role`** — `read`, `write`, or `over`. A `write` is a `:=` LHS (§2.4); an
  `over` is a name inside a `FuncOverClause` (§3.6 of the spec). A `#` is a
  `read` — §5 makes it a reference like any other, and a role of its own would
  contradict that.
- **`binding`** — resolved binding id, or `null` when unresolved (with a
  matching diagnostic).
- **`crossesFunction`** — `true` when the walk from `scope` to the binding's
  scope passes a scope whose `kind` is `function`. This is what `:over`
  checking reads (§4.3), and what closure-capture analysis reads later. A
  topic scope is not a function scope, so it does not set the flag — which is
  what §5's transparency claim amounts to.

### §4.2 One Resolver

`:=` targets and ordinary reads are **the same operation at different
syntactic positions**. §2.4 step 1 walks the frame chain for a slot; §0.1
walks the frame chain for a name. There is one resolver:

```
resolve(name, ns, scope):
    for s = scope, s != null, s = s.parent:
        b = s.bindings where b.name == name and b.ns == ns
        if b exists:
            if not b.positional:                              return b
            if reference is textually after b's declaration:   return b
            if reference is inside a Lazy@ operand:            return b
            return UNRESOLVED_FORWARD (§2.5)
    return UNRESOLVED
```

Do not build a separate environment structure. The scope tree plus the
bindings array **is** the environment; resolution is a walk over it.

**The positional test applies only to positional bindings.** §2.5: `defn` and
`deft` are visible throughout the scope including above their own position;
`def` becomes visible after its statement. §9.1.1 restates it for types: a
declared type name "is in scope throughout its entire lexical scope, not only
textually below itself," and a resolver "collects a scope's declaration set
before resolving any name within it." The topic and the intrinsics carry
`positional: false` because neither has a declaration point (§3.4).

**A `Lazy@` operand suspends the positional test, not the resolution.** §2.2.2
resolves a `Lazy@`'s free identifiers against the same scope chain; what
differs is that a later `def` in the same section is legal rather than a
forward-reference error. The pass records such a reference resolved, and marks
it `pending: true` for the settle-pass machinery downstream. It does not model
pending sets, listeners, or resolution order — that is runtime (§2.2.4).

**Namespace is fixed by position, not by token type.** A name at a type
position resolves in `type` whether its AST node is an `Identifier` or a
`BuiltIn` — `BuiltIn` is a node type carrying a `name`, not a distinct kind of
reference. This is what makes §7.4's pre-seeded root reachable: `IO` at a
`~<<` LHS and `List` inside a `DeclTypeClause` are ordinary `type` references
that terminate at root bindings.

### §4.3 What The Pass Checks About `:over`

§3.6: a function literal closing over a **mutable** binding from an enclosing
scope must list it in `:over`. Two diagnostics fall out once `constant` and
`crossesFunction` are known:

- A reference with `crossesFunction: true` to a binding with
  `constant: false`, from a function whose `:over` does not name it →
  missing-`:over`.
- A name in a `FuncOverClause` that either resolves to a `constant: true`
  binding or is not closed over at all → superfluous-`:over`.

**Direct closure only.** §3.6: a parent function needs no `:over` for a
mutable binding only its nested function touches. Read `crossesFunction`
against the nearest enclosing function scope, not any of them.

**A curried declaration's tiers are one boundary for this check.** Satisfy
the obligation from the referencing scope's `overNames`, which every tier of
a declaration shares (§2.1).

### §4.4 `export` References, Not Bindings

§8.3: an `export` entry registers an export name and *references* a binding.
It introduces nothing into any scope. Emit a `read` reference per entry —
against the source identifier for `{ target: source }`, against the leading
segment of the source path for `{ :a.b }`. The `target` of a named entry is
the external name and resolves to nothing.

The pass **does** check §8.3.2: an export entry resolving to a binding with
`constant: false` is a diagnostic, reported **at the export entry** and naming
the offending assignment's source position.

**The naming half needs a whole-module `writes` set.** §9.7.3 fixes the write
set as lexically bounded: a `def`'s writers are its initializer, every `:=` in
the declaring scope, and every `:=` inside a function naming it in `:over` —
all of which sit in the declaring scope's subtree. `export` is a module-scope
form, so the relevant subtree is the module, and the diagnostic can only be
raised after phase 3 has resolved every `:=` in it. This is why the check sits
in phase 4 rather than beside the export entry's own resolution.

### §4.5 Which Identifier Positions Are References

The grammar reuses `Identifier` for names, references, and property keys, so
the resolver dispatches on **parent node type and field**, never on the token.
The discriminating question at each position: does this identifier name a slot
in a *scope*, or a slot in a *value*? Only the first resolves.

Two fields make this concrete, because one helper shapes both and the roles
invert. `DestructureNamedDef` / `ExportNamedBinding` both produce
`{ target, source }`; `DestructureConciseDef` / `ExportConciseBinding` both
produce `{ source }`. In an export, `source` is a lexical reference. In a
destructure, `source` is an access path **rooted at the destructured value** —
`def < :items.0.price >: payload;` folds to a member chain whose base
`Identifier` is `items`, a slot name on `payload` and not a binding. Resolving
it produces a spurious unresolved on every path-form destructure in the
corpus.

| Position | Resolves | Namespace |
|---|---|---|
| operand `Identifier` | yes | `lex` |
| `MemberAccessExpr.object` (chain base) | yes | `lex` |
| `MemberAccessExpr.accessor` | no — property name | — |
| `IndexAccessExpr.expr` | yes — ordinary expression | `lex` |
| `AtCallExpr` leading base (`Foo@x`) | yes — namespace | `type` |
| `ThunkExpr` operand (`@@ expr`) | yes — ordinary expression | `lex` |
| `FuncOverClause.names` | yes — `role: over` | `lex` |
| `PipelineTopic` | yes — §5 | `lex` |
| `DestructureNamedDef.target` | no — binds | — |
| `DestructureNamedDef.source` base | no — slot name on the source value | — |
| `DestructureConciseDef.source` base | no — slot name; outermost accessor is the bound name | — |
| `DestructureCapture.target` | no — binds | — |
| `DestructurePositionalDef.target` | no — binds | — |
| any entry's `.init` / `.default` | yes — ordinary expression | `lex` |
| a `BracketExpr` base inside a destructure source | yes — computed key, evaluated in the enclosing scope | `lex` |
| `ExportNamedBinding.target` | no — external name | — |
| `ExportNamedBinding.source` / `ExportConciseBinding.source` base | yes | `lex` |
| `ImportExpr.from`, `DefTypeFrom.specifier` | no — string literal | — |
| `DefTypeStmt.name` | no — binds | — |
| `DefTypeStmt.decl`, **`from` absent** | yes — local type reference | `type` |
| `DefTypeStmt.decl`, **`from` present** | no — names a type in the other module | — |
| `DefHookDecl.name`, `@` marker | no — binds | — |
| `DefHookDecl.name`, non-`@` marker | yes — §3.6 | `type` |
| `DefHookName.label` | no | — |
| `DeclTypeClause.annotation` leading segment | yes | `type` |
| `DoComprLHSName` leading segment | yes | `type` |
| `DestructureSkipSlot` | no — no fields | — |
| `DoVarDefInitOpt.target`, `DoDefVarStmt.target` | no — binds | — |
| `DoVarDefInitOpt.init` / `DoDefVarStmt.init`, `op: "::"` | yes — **in the parent scope**, §2.1 | `lex` |

The `deft` row is the one that changes meaning with a sibling field:
`deft Alias Foo;` makes `Foo` a local type reference, and
`deft Coord Point from "./geometry.foi";` makes `Point` a name in the reached
module that this pass cannot and must not resolve.

This table is the set established against the grammar and the shapers so far.
Completing it is a walk over `Syntactic-Grammar.md`'s productions for every
position admitting `Identifier`, `IdentBase`, or `BuiltIn` — mechanical, and
part of building the pass rather than a question left open by it.

## §5 The Pipeline Topic `#`

`#` is a reference that resolves like any other, against a **synthetic
binding**. It is not a second resolution axis and not a second edge kind. In
the AST it is its own node type, `PipelineTopic`, carrying `name: "#"` — it is
never an `Identifier`, so it cannot collide with a lexical lookup.

**The binding.** `kind: "topic"`, `ns: "lex"`, `assignable: false`,
`positional: false`, `constant: true`, `name: "#"`. It carries a `node` span
but no `nameNode` — nothing in source declares it.

**Exactly two binders** (§5.2.2):

1. A **dependent match** (`?(topic){ .. }`) binds `#` over its consequents.
2. A **`#>` pipeline** (§3.10.12) binds `#` per stage — **one binding record
   per stage**, since each stage's topic is a different value.

An independent match (`?{ .. }`) binds nothing. §5.2.2: "Nesting is not what
shadows; binding is."

**A pipeline stage is not a node, and `#>` is not a distinct node type.**
Every flow operator shapes to `FlowBinExpr` and is discriminated only by the
`op` string. A stage is the `right` child of a `FlowBinExpr` whose `op` is
`"#>"`; the topic's value comes from `left`. Reading the node type instead of
`op` binds a topic inside every comprehension body — and comprehension bodies
bind no topic at all (§5.2.2), so `~map` / `~each` / `~<` must fall through
this rule untouched.

**Binding extent is narrower than the syntactic node** (§5.2.2.1). A dependent
match binds `#` over its pattern-clause consequents and else consequent
**only**. Two positions sit inside the node and outside the binding:

- the **topic expression**, which has not produced a value yet;
- the **`DepCondClause` atoms**, where the topic is already the implicit left
  operand.

A `#` at either position resolves **outward**, to the next enclosing binder.

**Membership in a topic scope is structural, not positional.** A dependent
match's consequents are non-contiguous in source — `DepPatternStmt.consequent`
and `ElseStmt.consequent` are separated by the clauses between them — so no
span covers exactly the binding region, and a containment test cannot decide
membership. The walk decides it instead: descend into `DepMatchExpr.topic` and
each `DepPatternStmt.clause` with the **enclosing** scope current, and into
each `DepPatternStmt.consequent` and `ElseStmt.consequent` with the **topic**
scope current. §5.2.2.1's two-positions-outside rule then falls out of the
descent rather than being checked separately.

A topic scope's `node` is therefore the binder node — the `DepMatchExpr`, or
the stage's own node for a pipeline — and is for diagnostics only. Nothing
reads it to decide what is inside.

**The walk is the ordinary outward lexical walk.** Nothing filters it to
binders and nothing special-cases function literals: a `#` inside a function
literal inside a consequent resolves outward through the function scope to the
topic scope, exactly as any free variable would. Closure over `#` is ordinary
closure. `crossesFunction` is set by the ordinary rule (§4.1) and nothing
reads it for a topic, since `#` is never assignable and `:over` never applies.

Where no enclosing binder exists, `#` is unresolved and a compile error
(§5.2.2, §5.2.2.1) — the ordinary unresolved-reference diagnostic, not a
special one.

## §6 Output Envelope

```json
{
    "module": "<opaque module key>",
    "scopes": [ ... ],
    "bindings": [ ... ],
    "references": [ ... ],
    "diagnostics": [ ... ]
}
```

Arrays are indexed by `id`: `scopes[n].id === n`, and likewise for `bindings`
and `references`. Consumers may index directly. The pre-seeded root (§7.4) is
`scopes[0]`; the module scope is `scopes[1]`.

The table is emitted **even when `diagnostics` is non-empty**. A downstream
pass reads `diagnostics` to decide whether to proceed; it does not receive a
truncated table. Unresolvable references carry `binding: null` rather than
being omitted.

## §7 Diagnostics

```json
{
    "code": "FOI-SCOPE-004",
    "severity": "error",
    "message": "`counter` is mutable and closed over; add `:over(counter)`",
    "span": { "start": 260, "end": 267 },
    "related": [ { "span": { "start": 224, "end": 240 }, "note": "declared here" } ]
}
```

`span` is where the reader's cursor should land. `related` carries the other
positions a reader needs; several spec rules fix which end reports.

`severity` is `error` or `warning`. There is no third value. Every diagnostic
below is an `error` except superfluous-`:over`, which is a `warning` — §3.6
makes listing a mutable capture a MUST and says nothing against listing more.

### §7.1 Reported At The Reference

- Unresolved name — lexical chain exhausted (§9.1.2 rule 3, §2.4).
- Forward reference to a positional binding (§2.5).
- `:=` LHS resolving to nothing (§2.4).
- `:=` LHS carrying an access tail (§2.4.2) — grammar admits it, this pass
  rejects it in user-source mode.
- `#` with no enclosing binder (§5.2.2.1).
- Missing `:over` (error) / superfluous `:over` (warning) — §3.6.

### §7.2 Reported At The Declaration

- Redeclaration in one scope, one namespace (§2.6). Reported at the **`def`**
  when the collision is `def` against `defn`, "regardless of source order,"
  because `defn` hoists to scope top.
- `deft` against `defn Name@(..)` in one scope (§9.1, §9.5).
- A non-`@` hook declaration whose namespace name is not declared **in the
  same scope**, or is declared only by a reach (§3.6). Reported at the hook
  declaration's name.

### §7.3 Reported At The Construct

- `def` below a non-definitional statement (§2.1.1) — at the `def`. Not
  checked in a scope with `doBlock: true`.
- `def` with no initializer at statement position (§2.1.2) — the defs-clause
  form is exempt (§2.9.2).
- `Lazy@` inside a `doBlock` scope, or directly inside a `@@` operand
  (§2.2.6).
- Export entry referencing a non-constant binding (§8.3.2) — at the **entry**,
  naming the assignment.

### §7.4 Unresolved Is Always An Error

There is no deferred case. Cross-module *pending* (§2.2.4) concerns values
that have not settled, not names that cannot resolve: every imported binding
arrives through a local name (`def Std: import "foi:Std";`), so `Std.foo`
resolves `Std` in this module and `foo` is an access path, never a free
identifier. A name the lexical chain does not hold is an error at module root
on the same terms as anywhere else.

**The chain does not end at the module scope.** The module scope's parent is a
**pre-seeded root**, scope `0`, holding the names that resolve without any
declaration:

- `Effect`, in the `type` namespace. §8.5: always in scope, never imported,
  never reached; there is no module in which a declared effect kind is out of
  scope.
- Native type keywords and `BuiltIn`-rooted namespace names, in the `type`
  namespace (§9). These are reached by ordinary `type` references per §4.2 —
  a `BuiltIn` node at a type position is a reference like any other.

Root bindings carry `kind: "intrinsic"`, `assignable: false`,
`positional: false`, `constant: true`, and no `node` or `nameNode`. They are
listed in the root scope's own `bindings` like any others; a consumer reaching
one sees a binding whose `scope` is `0`. A module-scope declaration shadowing
a root name is an ordinary shadow (§2.6), not a redeclaration.

## §8 Phase Order

The pass runs in four phases. **Constancy is two-phase and not flow-sensitive
(§3.4); a single downward accumulating walk gets it wrong**, because a `:=`
below a closure decides the constancy of a binding the closure captured above
it.

1. **Seed the root, then build the scope tree.** Emit scope `0` and its
   bindings (§7.4) before reading the AST; they come from the language, not
   from source. Then pre-order walk, emitting a scope per §2.1's table, with
   the module scope parented to `0`. Bind nothing from the AST.
2. **Register bindings.** Per scope, collect the whole declaration set before
   resolving anything in it (§9.1.1). Redeclaration diagnostics fire here.
3. **Resolve every reference.** Reads, writes, and `over` names, by §4.2's
   single resolver against §4.5's position inventory. Populate `binding`,
   `crossesFunction`, and each binding's `writes`.
4. **Mark and check.** Compute `constant` from complete `writes`. Then check
   `:over` (§4.3), export constancy (§4.4), and the accompanying-declaration
   requirement on non-`@` hook declarations (§3.6) — all three need a
   resolution or a write set that phase 3 produces.

No phase reads a field a later phase writes.

## §9 Out Of Scope For This Pass

Emitting nothing about any of the following is correct behavior, not a gap:

- **Types.** No inference, no conformance, no `:as` / `?as` checking (§9.7).
  The `type` namespace is *registered and resolved*; nothing is elaborated.
- **Effects.** No `:Effects(..)` reading, no coverage verification (§6.13.4),
  no `@@` purity gate (§3.14.2).
- **`Lazy@` settling.** No pending sets, no listeners, no settle pass
  (§2.2.4, §2.2.5). References inside a `Lazy@` operand are marked and
  handed on.
- **Hook dispatch.** Marker validity, per-family parameter counts, hook
  uniqueness, alias rejection, whether a hook may be curried, and the
  constructor-only restriction on labels (§3.1.1.1–§3.1.1.4). This pass
  checks only that a non-`@` hook's namespace is declared in the same scope
  (§3.6).
- **Module loading.** No specifier resolution, no canonicalization, no graph
  (§8.4). The module key is opaque.
- **Do-block lowering.** §3.10.9.4's statement lowering — which effect kinds
  are performed per statement, and how a `~<<` hook walks them. The scope
  nesting that `::` statements induce *is* modeled (§2.1).
