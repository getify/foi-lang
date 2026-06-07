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
(`Syntactic-Grammar.md`).

**Alias pattern.** A few visible productions emit nodes whose token type differs from the EBNF name — they are aliases for clarity at the grammar level. Three families:

- Eight Escape variants — `EscapeBacktick`, `EscapePlain`, `EscapeSpacingBacktick`, `EscapeHex`, `EscapeUnicode`, `EscapeOctal`, `EscapeBinary`, `EscapeMonadic` — all emit `Escape` tokens with distinguishing values.
- Six Number variants — `HexNumber`, `UnicodeNumber`, `OctalNumber`, `BinaryNumber`, `MonadNumber`, `BareNumber` — all emit `Number` tokens, paired with their corresponding Escape variant in `<EscapedNumber>` dispatch. The standalone `Number` (decimal source-level numbers) emits its own type.
- Two `PositiveIntegerLit` variants — `PositiveIntegerLit` (bare top-level) and `PositiveIntegerLitWithSep` (paired with `EscapePlain` in
`<EscapedNumber>` dispatch) — both emit `PositiveIntegerLit` tokens
with distinguishing content shapes (bare disallows the underscore
separator that the escaped form allows).
- Four String content emitters — `PlainStrChars`, `InterpStrChars`, `SpacingInterpStrChars`, `SpacingEscapedStrChars` — all emit `String` tokens with context-specific char predicates.

**Concat compatibility note.** Four string-form productions and their content helpers carry a `Lex` prefix (`<LexStringLit>`, `<LexInterpStr>`, `<LexSpacingInterpStr>`, `<LexSpacingEscapedStr>`, `<LexInterpStrContent>`, `<LexSpacingInterpStrContent>`, `<LexSpacingEscapedStrContent>`, `<LexInterpExpr>`) to avoid collision with same-named visible productions in `Syntactic-Grammar.md`. The lex versions describe char-level token assembly; the syn versions describe token-level assembly into AST. The lex versions are hidden and reachable from the lex `<Token>` start (which is itself unreachable from the syn `Program` start under concat).

```ebnf
(*************** Top Level ***************)

Tokens                  := Token*;

<Token>                 := Whitespace
                         | Comment
                         | LexInterpStr
                         | LexSpacingInterpStr
                         | LexSpacingEscapedStr
                         | LexStringLit
                         | EscapedNumber
                         | (Keyword ExprEndingTail)        (* Note 1, Note 9 *)
                         | (Native ExprEndingTail)         (* Note 1, Note 9 *)
                         | (Builtin ExprEndingTail)        (* Note 1, Note 9 *)
                         | (Comprehension ExprEndingTail)  (* Note 1, Note 9 *)
                         | (BooleanOper ExprEndingTail)    (* Note 1, Note 9 *)
                         | (PositiveIntegerLit ExprEndingTail)  (* Note 6, Note 9 *)
                         | (Number ExprEndingTail)              (* Note 5, Note 9 *)
                         | (General ExprEndingTail)        (* Note 9 *)
                         | TriplePeriod
                         | DoublePeriod
                         | DoubleColon
                         | EscapePlain                     (* standalone "\" *)
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

(* Number: bare decimal source-level number (no underscores, no
   escape opener). Emits Number token. *)
Number                  := "-"? NumberBody;            (* Note 5 *)
<NumberBody>            := (Digit+ "." Digit+) | Digit+;

(* PositiveIntegerLit: bare positive integer (no sign, no fractional
   part, no underscores). PEG-ordered before Number in <Token> with
   negative lookahead for "." Digit to avoid swallowing the integer
   part of decimals. Emits PositiveIntegerLit token. *)
PositiveIntegerLit        := Digit+ !("." Digit);

(* PositiveIntegerLitWithSep: positive integer with optional underscore
   separators. Fires from inside <EscapedNumber>, paired with
   EscapePlain. Emitted as PositiveIntegerLit. *)
PositiveIntegerLitWithSep := DigitsWithSep !("." Digit);   (* emitted as PositiveIntegerLit *)

(* Number variant aliases — each emits a Number token with content
   shape matching the Escape opener's digit class. *)
HexNumber               := "-"? HexDigit+;             (* emitted as Number *)
UnicodeNumber           := HexDigit+;                  (* emitted as Number; Note 6 *)
OctalNumber             := "-"? OctDigit+;             (* emitted as Number *)
BinaryNumber            := "-"? BinDigit+;             (* emitted as Number *)
MonadNumber             := "-"? HexDigitsWithSep ("." HexDigitsWithSep)?;   (* emitted as Number *)
BareNumber              := "-"? DigitsWithSep ("." DigitsWithSep)?;         (* emitted as Number *)

<DigitsWithSep>         := Digit+ (Digit | "_")*;
<HexDigitsWithSep>      := HexDigit+ (HexDigit | "_")*;

<HexDigit>              := #"[0-9a-fA-F]";
<OctDigit>              := #"[0-7]";
<BinDigit>              := #"[01]";

(* EscapedNumber: dispatch over (Escape variant, Number variant)
   pairs. Hidden — emits the Escape and Number tokens as direct
   children of the parent frame. *)
<EscapedNumber>         := (EscapeHex     HexNumber)
                         | (EscapeUnicode UnicodeNumber)
                         | (EscapeOctal   OctalNumber)
                         | (EscapeBinary  BinaryNumber)
                         | (EscapeMonadic MonadNumber)
                         | (EscapePlain   PositiveIntegerLitWithSep)
                         | (EscapePlain   BareNumber);


(*************** Escape Variants ***************)

(* Eight productions emitting Escape tokens with distinguishing
   values. EscapePlain is the only one spread standalone in
   <Token> (for a lone "\"); the others fire only from inside
   specific contexts (string-form openers, EscapedNumber). *)

EscapeBacktick          := "`";          (* emitted as Escape, value "`" *)
EscapePlain             := "\\";         (* emitted as Escape, value "\" *)
EscapeSpacingBacktick   := "\\" "`";     (* emitted as Escape, value "\`" *)
EscapeHex               := "\\" "h";     (* emitted as Escape, value "\h" *)
EscapeUnicode           := "\\" "u";     (* emitted as Escape, value "\u" *)
EscapeOctal             := "\\" "o";     (* emitted as Escape, value "\o" *)
EscapeBinary            := "\\" "b";     (* emitted as Escape, value "\b" *)
EscapeMonadic           := "\\" "@";     (* emitted as Escape, value "\@" *)


(*************** Multi-Char Operators ***************)

TriplePeriod            := "...";
DoublePeriod            := "..";
DoubleColon             := "::";


(*************** Single-Char Operators ***************)

(* Operators that end an expression context. Wrapped with
   ExprEndingTail at the Token level. See Note 9. *)
<ExprEndingOp>          := CloseParen | CloseBrace | Hash | Pipe;

(* All other single-char operators. Escape ("\") is NOT here —
   it's covered by EscapePlain in the <Token> alternation. *)
<SingleCharOp>          := Tilde | Exmark | Dollar | Percent
                         | Caret | Ampersand | Star | Plus | Equal
                         | At | Hyphen | OpenBracket | CloseBracket
                         | Qmark | Semicolon | SingleQuote
                         | OpenAngle | CloseAngle | Comma | Period
                         | Colon | ForwardSlash | OpenParen
                         | OpenBrace | Backtick;

Tilde         := "~";   Exmark      := "!";    Hash         := "#";
Dollar        := "$";   Percent     := "%";    Caret        := "^";
Ampersand     := "&";   Star        := "*";    Plus         := "+";
Equal         := "=";   At          := "@";    Hyphen       := "-";
OpenBracket   := "[";   CloseBracket:= "]";    Pipe         := "|";
Qmark         := "?";   Semicolon   := ";";    SingleQuote  := "'";
OpenAngle     := "<";   CloseAngle  := ">";    Comma        := ",";
Period        := ".";   Colon       := ":";    ForwardSlash := "/";
OpenParen     := "(";   CloseParen  := ")";    OpenBrace    := "{";
CloseBrace    := "}";   Backtick    := "`";

(* DoubleQuote is defined as a production for cross-grammar
   reference (the syntactic grammar's string-form openers
   consume DoubleQuote tokens) but is NOT in <SingleCharOp>: it
   standalone-emits only from inside the four string-form
   bodies, never as a top-level token. *)
DoubleQuote   := "\"";


(*************** Strings ***************)

(* Basic string literal: doublequote-delimited; "" inside is an
   escaped doublequote and stays inside. *)

<LexStringLit>          := "\"" StringContent* "\"";
<StringContent>         := StringEscapedChar | PlainStrChars;
PlainStrChars           := #"[^\"]"+;                     (* emitted as String *)
StringEscapedChar       := ("\"" "\"") | ("`" "`");


(*** Interpolated String:    `"..."   ***)

(* Opens with Escape("`") + DoubleQuote; closes with DoubleQuote.
   The leading backtick is emitted as an Escape token (value "`"),
   not as Backtick. *)

<LexInterpStr>          := EscapeBacktick "\"" LexInterpStrContent* "\"";

<LexInterpStrContent>   := StringEscapedChar
                         | LexInterpExpr
                         | InterpStrChars;
InterpStrChars          := #"[^`\"]"+;                    (* emitted as String *)

<LexInterpExpr>         := "`" InterpExprBody* "`";       (* Note 8: recursive Token *)
<InterpExprBody>        := !(InterpExprStop) Token;
<InterpExprStop>        := "`" (EOF | !("\""));


(*** Spacing-Form Interpolated String:    \`"..."   ***)

(* Opens with Escape("\`") + DoubleQuote. Whitespace inside the
   content emits as Whitespace tokens rather than String content. *)

<LexSpacingInterpStr>   := EscapeSpacingBacktick "\"" LexSpacingInterpStrContent* "\"";

<LexSpacingInterpStrContent> := StringEscapedChar
                              | LexInterpExpr
                              | Whitespace
                              | SpacingInterpStrChars;
SpacingInterpStrChars   := (!(WsChar) #"[^`\"]")+;        (* emitted as String *)


(*** Spacing Escaped String:    \"..."   ***)

(* Opens with Escape("\") + DoubleQuote. Whitespace inside emits
   as Whitespace; backticks are String content (no interp). *)

<LexSpacingEscapedStr>  := EscapePlain "\"" LexSpacingEscapedStrContent* "\"";

<LexSpacingEscapedStrContent> := StringEscapedChar
                               | Whitespace
                               | SpacingEscapedStrChars;
SpacingEscapedStrChars  := (!(WsChar) #"[^\"]")+;         (* emitted as String *)
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
    TriplePeriod      before DoublePeriod      before Period
    DoubleColon       before Colon
    BlockComment      before LineComment
    LexInterpStr      before the single-char Backtick
    LexSpacingInterpStr / LexSpacingEscapedStr / EscapedNumber  before EscapePlain
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

    Number and the Number variants paired with hyphen-accepting
    Escape openers (HexNumber, OctalNumber, BinaryNumber, MonadNumber,
    BareNumber) all accept an optional leading "-". For the standalone
    Number the combinator uses positive lookahead on the digit; the
    "-" is consumed and becomes part of the Number's value. This
    handles "-5" at start-of-input and immediately after non-expression-
    ending operators. The other half of the disambiguation — preventing
    "5-3" from re-lexing as Number(5) Number(-3) — is handled by
    ExprEndingTail (Note 9).

6. UnicodeNumber and PositiveIntegerLit variants reject leading sign:

    Unicode-char escapes (`\u`) produce a character/string from a hex
    codepoint and carry no sign. UnicodeNumber accepts hex digits only,
    without the optional leading "-" that other Number variants allow.

    PositiveIntegerLit and PositiveIntegerLitWithSep similarly accept
    no leading sign — the "Positive" in the name. The bare form also
    rejects underscore separators; the WithSep form accepts them. Both
    use !("." Digit) lookahead to avoid swallowing the integer part of
    decimals; a "." followed by a non-digit (range op, property access,
    spread) is fine.

7. Escape token values:

    Eight EBNF productions emit Escape tokens, distinguished by value:

    ```
    EscapeBacktick          value "`"      (one char)
    EscapePlain             value "\"      (one char)
    EscapeSpacingBacktick   value "\`"     (two chars)
    EscapeHex               value "\h"     (two chars)
    EscapeUnicode           value "\u"     (two chars)
    EscapeOctal             value "\o"     (two chars)
    EscapeBinary            value "\b"     (two chars)
    EscapeMonadic           value "\@"     (two chars)
    ```

    All eight emit single Escape tokens in the output stream. They
    exist for parity with the legacy hand-written tokenizer (which
    assembles them via deferred emission). The split into eight
    named productions lets the syntactic grammar reference each by
    name rather than by value-literal discrimination.

8. Recursive forward reference:

    LexInterpExpr's body recursively contains Tokens — including
    nested LexInterpStr, LexSpacingInterpStr, or further LexInterpExpr.
    The combinator handles this via a forward-declared lazy reference
    resolved at parse time. In EBNF the recursion is direct:
    LexInterpExpr → Token (via InterpExprBody) → LexInterpStr →
    LexInterpExpr.

9. Hyphen-as-sign disambiguation (binary-operator half):

    Foi treats "-" as a sign when leading a digit at the start of an
    expression context, and as a binary operator otherwise. Rather
    than carry cross-token state, every production whose tokens can
    end an expression is wrapped with ExprEndingTail. After the main
    production matches, ExprEndingTail optionally consumes trailing
    Whitespace and Comment tokens, then peeks for "-" followed by a
    Digit; if present, it consumes the "-" as a Hyphen token. This
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

The combinator lexer is *not exactly* compatible with the legacy hand-written tokenizer.js. For one, the handling of malformed inputs:

```
Input        Legacy tokenizer                     Combinator lexer
-----------  -----------------------------------  ---------------------------------
"\h"         Escape("\h")                         Escape("\") General("h")
"\u-5"       Escape("\u") Hyphen Number(5)        Escape("\") General("u") Hyphen Number(5)
"\h_foo"     Escape("\h") General("_foo")         Escape("\") General("h_foo")
"\@-"        Escape("\@") Number("-")             Escape("\") At Hyphen
```

The legacy tokenizer "partially commits" to an escape sequence and
leaves multi-char Escape tokens in the stream when the commit does
not complete with a valid number. The combinator lexer commits
fully or not at all; it never emits an Escape variant unless its
expected following content (Number variant for EscapedNumber, or
DoubleQuote for string-form openers) is present.

PositiveIntegerLit emission is a deliberate divergence from the legacy
tokenizer, which emits Number for these char shapes. The new lexer
emits PositiveIntegerLit wherever chars match `Digit+ !("." Digit)`
(bare) or `EscapePlain DigitsWithSep !("." Digit)` (escaped). The diff
harness normalizes PositiveIntegerLit → Number on the new side to
preserve parity validation for all other token shapes. Motivation: the
syntactic grammar restricts property-index positions to positive-int
literals, and pushing that restriction down to a token type makes the
syntactic EBNF mechanically round-trippable to combinator code.

