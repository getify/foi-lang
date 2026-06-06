# Foi Syntactic Grammar

Companion to `Lexical-Grammar.md`. Where the lexical grammar
specifies tokenization over characters, this grammar specifies
syntax over the lexer's token stream. Same EBNF dialect
(instaparse syntax: `:=` for rules, `|` for ordered choice,
`&(...)` / `!(...)` for lookahead, `(* *)` for comments).

## Conventions

Terminals in this grammar are **lexer tokens**, not characters:

- **`UPPERCASE`** — match a token by its `type` field. E.g.,
  `GENERAL` matches any token of type `GENERAL` regardless of
  value; `NUMBER`, `OPEN_PAREN`, `SEMICOLON`, etc.

- **`"value"`** — match a token by its `value` field. The token
  type is implied because the lexer only ever emits each value
  with one type. E.g., `"def"` matches a `KEYWORD` token whose
  value is `def`; `";"` matches a `SEMICOLON`; `"~map"` matches
  a `COMPREHENSION`. The convention reads like Grammar.md while
  the underlying machinery is one-token matching.

**Trivia is explicit.** `WHITESPACE` and `COMMENT` tokens are
matched only where the grammar explicitly permits them. Two hidden
productions handle this:

    <_>  := (WHITESPACE | COMMENT)*;       (* optional trivia *)
    <__> := _ WHITESPACE _;                (* required whitespace *)

Adjacent grammar elements with no marker between them require
token-stream adjacency — the parser does not absorb trivia
between them. This is verbose compared to Grammar.md's
nearly-universal `WhSp*`, but every position now carries its own
answer to "trivia allowed, required, or forbidden?".

The no-marker case subsumes what would otherwise be a separate
"tight productions" rule: multi-char operators that the lexer
emits as adjacent single-char tokens (e.g., `~<` as `TILDE`
`OPEN_ANGLE`) are productions whose bodies omit `_` between
elements. `Chain := TILDE OPEN_ANGLE;` matches `~<` but not `~ <`.

The lexer's `expressionEnding` wrapper handles hyphen-as-sign
disambiguation at the lex layer (e.g., `-5` vs `5 - 3`), and
required separation between adjacent identifier-like tokens
(e.g., `"def" "x"`) is forced by the lexer's tokenization rules.
So `__` is needed less often than Grammar.md's `WhSp+` was — but
it remains available where the language semantics genuinely
require a whitespace-or-newline between tokens that could otherwise
appear adjacent in the lex stream.

**Ordered choice.** As in the lexical grammar, `|` is PEG-style:
first match wins, longer/more-specific alternatives listed first
where prefixes overlap.

**Hidden productions** are marked with angle brackets on the LHS:
`<Name> := ...`. Their bodies match as usual but they emit no node
of their own; their children splice into the parent's children.
Use for rules that exist for grammatical structure but carry no
interpreter-relevant meaning (alternation dispatchers, punctuation
wrappers, the `*AsOpt` cluster, etc.). Maps cleanly onto the
combinator impl: `<Hidden>` ⟺ bare `and(...)` / `or(...)`;
visible ⟺ `production(NAME, ...)`. The lex grammar uses this same
convention (see updated `foi-lex-grammar.md`). Hidden marking on
the LHS propagates to every RHS reference — no need to re-bracket
references.

---

```ebnf
(*************** Program / Statements ***************)

Program             := _ ((StmtSemi | ExportStmtSemi) _)*
                       ((StmtSemiOpt | ExportStmtSemiOpt) _)?;

<Stmt>              := DefVarStmt | DefBlockStmt | DefTypeStmt | ExprAsOpt;
<StmtSemi>          := Stmt? (_ ";")+;
<StmtSemiOpt>       := Stmt? (_ ";")*;
<ExportStmtSemi>    := ExportExpr (_ ";")+;
<ExportStmtSemiOpt> := ExportExpr (_ ";")*;

(* `Identifier` is just the lexer's `GENERAL` token; the reserved
   words that Grammar.md's `Identifier` regex had to exclude via
   negative lookbehind are already classified by the lexer as
   `KEYWORD`, `NATIVE`, `BUILTIN`, `COMPREHENSION`, or
   `BOOLEAN_OPER`. Stated here so subsequent sections can use
   the name. *)

Identifier         := GENERAL;


(*************** Literals ***************)

<Literal>          := NumberLit | StringLit | BooleanLit | EmptyLit;


(*** Number Literals ***)

NumberLit          := NumberLitEscape? NUMBER;
<NumberLitEscape>  := "\\h" | "\\u" | "\\o" | "\\b" | "\\@" | "\\";


(*** String Literals ***)

(* Four string forms across two independent axes:
     interp   — contains `expr` embedded expressions
     spacing  — WHITESPACE inside content is preserved as its
                own tokens (rather than absorbed into STRING)

         form              opener   interp  spacing
         ----------------  -------  ------  -------
         PlainStr            "       no      no
         SpacingEscapedStr   \"      no      yes
         InterpStr           `"      yes     no
         SpacingInterpStr    \`"     yes     yes                  *)

<StringLit>                 := PlainStr | SpacingEscapedStr | InterpStr | SpacingInterpStr;

PlainStr                    := DOUBLE_QUOTE PlainStrContent* DOUBLE_QUOTE;
<PlainStrContent>           := STRING | STRING_ESCAPED_CHAR;

SpacingEscapedStr           := "\\" DOUBLE_QUOTE SpacingEscapedStrContent* DOUBLE_QUOTE;
<SpacingEscapedStrContent>  := STRING | STRING_ESCAPED_CHAR | WHITESPACE;

InterpStr                   := "`" DOUBLE_QUOTE InterpStrContent* DOUBLE_QUOTE;
<InterpStrContent>          := STRING | STRING_ESCAPED_CHAR | InterpExpr;

SpacingInterpStr            := "\\`" DOUBLE_QUOTE SpacingInterpStrContent* DOUBLE_QUOTE;
<SpacingInterpStrContent>   := STRING | STRING_ESCAPED_CHAR | WHITESPACE | InterpExpr;

InterpExpr                  := BACKTICK _ Expr _ BACKTICK;     (* Expr — forward ref *)


(*** Boolean / Empty Literals ***)

BooleanLit         := "true" | "false";
EmptyLit           := "empty";
```

## Size Comparison

Grammar.md §Program / Statements + §Whitespace + the relevant
fragments of §Identifier:

```
Program                 := WhSp* ((StmtSemi | ExportStmtSemi) WhSp*)* (StmtSemiOpt | ExportStmtSemiOpt)? WhSp*;
Stmt                    := DefVarStmt | DefBlockStmt | DefTypeStmt | ExprAsOpt;
StmtSemi                := Stmt? (WhSp* ";")+;
StmtSemiOpt             := Stmt? (WhSp* ";")*;
ExportStmtSemi          := ExportExpr (WhSp* ";")+;
ExportStmtSemiOpt       := ExportExpr (WhSp* ";")*;
WhSp                    := Whitespace | Comment;
Whitespace              := #"[\s]+" | (*u0085*) "..." | (*u180e*) "..." | (*7 more chars*);
Comment                 := LineComment | BlockComment;
LineComment             := "//" #"[^\n/][^\n]*"? &("\n" | Epsilon);
BlockComment            := "///" #"[^]*?///";
Identifier              := (#"(?!(?:[0-9]+|~each|~map|~filter|~fold|...)\b)[a-zA-Z0-9_~]+(?<!\b(?:def|defn|deft|import|export|empty|true|false|int|integer|float|...)") | ...
```

13 productions, ~700 chars (with the `Identifier` regex; that one
line alone is ~500 chars).

The syntactic version: 9 productions (including the `<_>` / `<__>`
trivia helpers), ~430 chars. ~40% smaller for this section, and
more importantly every trivia position is now specified explicitly
rather than absorbed by an out-of-band rule. The savings come from
the lexical concerns we moved out — trivia tokenization and
identifier-vs-keyword exclusion. Actual syntactic shape (Program
of StmtSemi-or-export-stmts) is unchanged.
