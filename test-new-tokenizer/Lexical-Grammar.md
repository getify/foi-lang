# Foi Lexical Grammar

Source-of-truth lexical grammar for Foi, derived from the combinator
tokenizer in `foi-lex.js`. Written in the same EBNF dialect as
`Grammar.md` (instaparse syntax). Where the lexer does things EBNF
cannot express (semantic gates over reserved-set membership, the
expression-ending wrapper's per-token emission, recursive forward
references), inline `(* ... *)` comments flag the production and the
Notes section expands.

Throughout: alternation `|` is intended as ordered choice (first
match wins; longer/more-specific alternatives are listed first
where their prefixes overlap). See Note 2.

Production names prefixed with `<>` on the LHS (e.g., `<Token>`,
`<WsChar>`) are *hidden*: they match as usual but emit no node of
their own — their content splices into the parent's children.
Unbracketed names are *visible* and correspond to
`production(NAME, ...)` wrappers in the impl; hidden names
correspond to bare `and(...)` / `or(...)` fragments. RHS references
inherit the LHS marking, so re-bracketing on use is unnecessary.
The same convention applies in the syntactic grammar
(`foi-syn-grammar.md`).

A few visible productions emit nodes whose token type differs from
the EBNF name — they are aliases for clarity at the grammar level.
`EscapeBacktick`, `EscapeSpacingBacktick`, `EscapePlain` all emit
`ESCAPE` tokens with distinguishing values. `InterpStrChars`,
`SpacingInterpStrChars`, `EscapedStrChars` all emit `STRING` tokens
with content-class-specific predicates. Inline comments flag these.

```ebnf
(*************** Top Level ***************)

Tokens                  := Token*;

<Token>                 := Whitespace
                         | Comment
                         | InterpStr
                         | SpacingInterpStr
                         | SpacingEscapedStr
                         | StringLit
                         | EscapedNumber
                         | (Keyword ExprEndingTail)        (* Note 1, Note 9 *)
                         | (Native ExprEndingTail)         (* Note 1, Note 9 *)
                         | (Builtin ExprEndingTail)        (* Note 1, Note 9 *)
                         | (Comprehension ExprEndingTail)  (* Note 1, Note 9 *)
                         | (BooleanOper ExprEndingTail)    (* Note 1, Note 9 *)
                         | (Number ExprEndingTail)         (* Note 5, Note 9 *)
                         | (General ExprEndingTail)        (* Note 9 *)
                         | TriplePeriod
                         | DoublePeriod
                         | DoubleColon
                         | (ExprEndingOp ExprEndingTail)   (* Note 9 *)
                         | SingleCharOp;                   (* Note 2 *)

<ExprEndingTail>        := ((Whitespace | Comment)* &("-" Digit) Hyphen)?;

<EOF>                   := !#"[^]";                       (* not a token *)


(*************** Whitespace & Comments ***************)

Whitespace              := WsChar+;
<WsChar>                := #"[\u0009\u000a\u000b\u000c\u000d\u0020\u0085\u00a0\u1680\u180e\u2000-\u200f\u2028\u2029\u202f\u205f\u3000\ufeff]";

Comment                 := BlockComment | LineComment;    (* block first per Note 2 *)
<BlockComment>          := "///" #"[^]*?(?:///|\z)";
<LineComment>           := "//" #"[^\n]*";


(*************** Identifiers ***************)

<IdentBody>             := (IdentStart | ("~" Alpha)) IdentCont*;  (* Note 3 *)
General                 := IdentBody;

<IdentStart>            := #"[a-zA-Z0-9_]";
<IdentCont>             := #"[a-zA-Z0-9_~]";
<Alpha>                 := #"[a-zA-Z]";
<Digit>                 := #"[0-9]";


(*************** Reserved-Word Forms ***************)

Keyword                 := (":" IdentBody) | IdentBody;   (* Note 4: KEYWORDS gate *)
Native                  := IdentBody;                     (* Note 4: NATIVES gate *)
Builtin                 := IdentBody;                     (* Note 4: BUILTINS gate *)
Comprehension           := "~" Alpha IdentCont*;          (* Note 4: COMPREHENSIONS gate *)
BooleanOper             := ("?" | "!") Alpha IdentCont*;  (* Note 4: BOOLEAN_NAMED_OPERATORS gate *)

(* Reserved-word sets:
     NATIVES                  = { "empty", "true", "false" }
     KEYWORDS                 = { "def", "defn", "deft", "import", "export",
                                  ":as", ":over", "int", "integer", "float",
                                  "bool", "boolean", "string" }
     BUILTINS                 = { "Id", "None", "Maybe", "Left", "Right", "Either",
                                  "Promise", "PromiseSubject", "PushStream",
                                  "PushSubject", "PullStream", "PullSubject",
                                  "Channel", "Gen", "IO", "Value", "Number", "List" }
     COMPREHENSIONS           = { "~each", "~map", "~filter", "~fold", "~foldR",
                                  "~cata", "~chain", "~bind", "~flatMap", "~ap",
                                  "~foldMap" }
     BOOLEAN_NAMED_OPERATORS  = { "and", "or", "as", "in", "has", "empty" }
*)


(*************** Numbers ***************)

Number                  := "-"? NumberBody;            (* Note 5 *)
<NumberBody>            := (Digit+ "." Digit+) | Digit+;

<EscapedNumber>         := "\\" EscapedNumberBody;
<EscapedNumberBody>     := ("h" "-"? HexDigit+)
                         | ("u" HexDigit+)             (* Note 6 *)
                         | ("o" "-"? OctDigit+)
                         | ("b" "-"? BinDigit+)
                         | ("@" MonadNumBody)
                         | BareNumBody;

<BareNumBody>           := "-"? DigitsWithSep ("." DigitsWithSep)?;
<DigitsWithSep>         := Digit+ (Digit | "_")*;

<MonadNumBody>          := "-"? HexDigitsWithSep ("." HexDigitsWithSep)?;
<HexDigitsWithSep>      := HexDigit+ (HexDigit | "_")*;

<HexDigit>              := #"[0-9a-fA-F]";
<OctDigit>              := #"[0-7]";
<BinDigit>              := #"[01]";


(*************** Multi-Char Operators ***************)

TriplePeriod            := "...";
DoublePeriod            := "..";
DoubleColon             := "::";


(*************** Single-Char Operators ***************)

(* Operators that end an expression context. Wrapped with
   ExprEndingTail at the Token level. See Note 9. *)
<ExprEndingOp>          := CloseParen | CloseBrace | Hash | Pipe;

(* All other single-char operators. *)
<SingleCharOp>          := Tilde | Exmark | Dollar | Percent
                         | Caret | Ampersand | Star | Plus | Equal
                         | At | Hyphen | OpenBracket | CloseBracket
                         | Qmark | Semicolon | SingleQuote
                         | OpenAngle | CloseAngle | Comma | Period
                         | Colon | ForwardSlash | Escape | OpenParen
                         | OpenBrace | Backtick;

Tilde         := "~";   Exmark      := "!";    Hash         := "#";
Dollar        := "$";   Percent     := "%";    Caret        := "^";
Ampersand     := "&";   Star        := "*";    Plus         := "+";
Equal         := "=";   At          := "@";    Hyphen       := "-";
OpenBracket   := "[";   CloseBracket:= "]";    Pipe         := "|";
Qmark         := "?";   Semicolon   := ";";    SingleQuote  := "'";
OpenAngle     := "<";   CloseAngle  := ">";    Comma        := ",";
Period        := ".";   Colon       := ":";    ForwardSlash := "/";
Escape        := "\\";  OpenParen   := "(";    CloseParen   := ")";
OpenBrace     := "{";   CloseBrace  := "}";    Backtick     := "`";


(*************** Strings ***************)

(* Basic string literal: doublequote-delimited; "" inside is an
   escaped doublequote and stays inside. The combinator's
   StringLit body absorbs the content as STRING tokens between
   DOUBLE_QUOTE openers/closers. *)

<StringLit>             := "\"" StringContent* "\"";
<StringContent>         := StringEscapedChar | #"[^\"]";
StringEscapedChar       := ("\"" "\"") | ("`" "`");


(*** Interpolated String:    `"..."   ***)

(* Opens with ESCAPE("`") + DOUBLE_QUOTE; closes with DOUBLE_QUOTE.
   The leading backtick is emitted as an ESCAPE token (value "`"),
   not as BACKTICK. See Note 7. *)

<InterpStr>             := EscapeBacktick "\"" InterpStrContent* "\"";
EscapeBacktick          := "`";        (* emitted as ESCAPE, value "`" *)

<InterpStrContent>      := StringEscapedChar
                         | InterpExpr
                         | InterpStrChars;
InterpStrChars          := #"[^`\"]"+;    (* emitted as STRING *)

<InterpExpr>            := "`" InterpExprBody* "`";    (* Note 8: recursive Token *)
<InterpExprBody>        := !(InterpExprStop) Token;
<InterpExprStop>        := "`" (EOF | !("\""));


(*** Spacing-Form Interpolated String:    \`"..."   ***)

(* Opens with ESCAPE("\`") + DOUBLE_QUOTE. Whitespace inside the
   content emits as WHITESPACE tokens rather than STRING content.
   See Note 7. *)

<SpacingInterpStr>      := EscapeSpacingBacktick "\"" SpacingInterpStrContent* "\"";
EscapeSpacingBacktick   := "\\" "`";   (* emitted as ESCAPE, value "\`" *)

<SpacingInterpStrContent> := StringEscapedChar
                           | InterpExpr
                           | Whitespace
                           | SpacingInterpStrChars;
SpacingInterpStrChars   := (!(WsChar) #"[^`\"]")+;    (* emitted as STRING *)


(*** Spacing Escaped String:    \"..."   ***)

(* Opens with ESCAPE("\") + DOUBLE_QUOTE. Whitespace inside emits
   as WHITESPACE; backticks are STRING content (no interp). See
   Note 7. *)

<SpacingEscapedStr>     := EscapePlain "\"" SpacingEscapedStrContent* "\"";
EscapePlain             := "\\";

<SpacingEscapedStrContent> := StringEscapedChar
                            | Whitespace
                            | SpacingEscapedStrChars;
SpacingEscapedStrChars  := (!(WsChar) #"[^\"]")+;     (* emitted as STRING *)
```

## Notes

1. Typed-identifier ordering:

    Keyword, Native, Builtin, Comprehension, and BooleanOper are tried
    before General in the Token alternation. Each is gated by reserved-
    set membership over the matched span; see Note 4. The first that
    matches and passes its gate wins.

2. Ordered choice:

    Alternation (|) in this lexical grammar is intended as PEG-style
    ordered choice: first match wins. Longer/more-specific forms are
    listed before their prefixes. Examples:

    ```
    TriplePeriod  before DoublePeriod  before Period
    DoubleColon   before Colon
    BlockComment  before LineComment
    InterpStr     before the single-char Backtick
    ```

    The combinator implementation enforces this ordering directly.

3. sawNonDigit gate:

    IdentBody matches sequences of identifier characters that may
    include digits, but the combinator additionally requires that at
    least one non-digit character appears in the matched span. Without
    this, a bare digit run would match IdentBody and shadow Number.
    This semantic predicate is not expressible in EBNF; the EBNF form
    above is a syntactic over-approximation.

4. Reserved-set membership gates:

    Keyword, Native, Builtin, Comprehension, and BooleanOper each
    match a broader form syntactically than their semantics permit.
    The combinator applies a positive lookahead over the matched span
    asserting membership in the corresponding reserved set; on gate
    failure the production fails and the next Token alternative is
    tried. Not expressible in EBNF.

5. Leading-sign rule (sign half):

    Number accepts a leading "-" only when followed by a Digit. The
    combinator uses positive lookahead on the digit; the "-" is
    consumed and becomes part of the Number's value. This handles "-5"
    at start-of-input and immediately after non-expression-ending
    operators. The other half of the disambiguation — preventing
    "5-3" from re-lexing as Number(5) Number(-3) — is handled by
    ExprEndingTail (Note 9).

6. `\u` rejects leading sign:

    Unicode-char escapes produce a character/string from a hex
    codepoint and carry no sign. \u accepts hex digits only.

7. Multi-char ESCAPE token values:

    Three string forms open with an ESCAPE token whose value is
    multi-character:

    ```
    InterpStr         opens with ESCAPE value "`"   (one char)
    SpacingEscapedStr opens with ESCAPE value "\"   (one char)
    SpacingInterpStr  opens with ESCAPE value "\`"  (two chars)
    ```

    In the lexer's emitted token stream these are single ESCAPE
    tokens carrying the indicated value. They exist for parity with
    the legacy hand-written tokenizer (which assembles them via
    deferred emission). Downstream consumers should treat the value
    as an opaque discriminator distinguishing the three forms.

8. Recursive forward reference:

    InterpExpr's body recursively contains Tokens — including nested
    InterpStr, SpacingInterpStr, or further InterpExpr. The combinator
    handles this via a forward-declared lazy reference resolved at
    parse time. In EBNF the recursion is direct: InterpExpr → Token
    (via InterpExprBody) → InterpStr → InterpExpr.

9. Hyphen-as-sign disambiguation (binary-operator half):

    Foi treats "-" as a sign when leading a digit at the start of an
    expression context, and as a binary operator otherwise. Rather
    than carry cross-token state, every production whose tokens can
    end an expression is wrapped with ExprEndingTail. After the main
    production matches, ExprEndingTail optionally consumes trailing
    WHITESPACE and COMMENT tokens, then peeks for "-" followed by a
    Digit; if present, it consumes the "-" as a HYPHEN token. This
    forces the next outer iteration to see a fresh digit, which
    Number's leading-sign rule (Note 5) then handles correctly.

    EBNF representational caveat: ExprEndingTail's sub-matches
    (whitespace, comment, the hyphen) are each emitted as SEPARATE
    tokens in the output stream, not grouped under the parent
    production. EBNF expresses the sequential structure but cannot
    express the per-sub-match token emission.

    The trailing trivia consume is speculative — if no "-Digit"
    follows, the optional rolls back and the trivia is picked up by
    the next outer iteration.

    The wrapped set of productions mirrors the tokenizer's
    minusOpAllowed flag: exactly the token types after which a binary
    "-" is legal. Non-expression-ending operators (Plus, Star, etc.)
    are not wrapped; a "-" immediately following them is consumed as
    a sign by Number.

### Known Divergences From Legacy Tokenizer

The combinator lexer is not bug-for-bug compatible with the legacy
hand-written tokenizer.js. All known differences are confined to
malformed inputs:

```
Input        Legacy tokenizer                     Combinator lexer
-----------  -----------------------------------  ---------------------------------
"\h"         ESCAPE("\h")                         ESCAPE("\") General("h")
"\u-5"       ESCAPE("\u") Hyphen Number(5)        ESCAPE("\") General("u") Hyphen Number(5)
"\h_foo"     ESCAPE("\h") General("_foo")         ESCAPE("\") General("h_foo")
"\@-"        ESCAPE("\@") Number("-")             ESCAPE("\") At Hyphen
```

The legacy tokenizer "partially commits" to an escape sequence and
leaves multi-char ESCAPE tokens in the stream when the commit does
not complete with a valid number. The combinator lexer commits
fully or not at all; it never emits a multi-char ESCAPE value
except as a string opener (see Note 7).
