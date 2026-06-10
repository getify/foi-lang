# Foi Lexical Grammar

Source-of-truth lexical grammar for Foi, derived from the
combinator tokenizer in `new-tokenizer.js`. Written in the same
EBNF dialect as `Grammar.md` (instaparse syntax). Where the
lexer does things EBNF cannot express (semantic gates over
reserved-set membership, the expression-ending wrapper's
per-token emission, recursive forward references), inline
`(* ... *)` comments flag the production and the Notes section
expands.

Throughout: alternation `|` is intended as ordered choice (first
match wins; longer/more-specific alternatives are listed first
where their prefixes overlap). See Note 2.

Production names prefixed with `<>` on the LHS (e.g., `<Token>`,
`<WsChar>`) are *hidden*: they match as usual but emit no node
of their own — their content splices into the parent's children.
Unbracketed names are *visible* and correspond to
`production(NAME, ...)` wrappers in the impl; hidden names
correspond to bare `and(...)` / `or(...)` fragments. RHS
references inherit the LHS marking, so re-bracketing on use is
unnecessary. The same convention applies in the syntactic
grammar (`Syntactic-Grammar.md`).

**Alias pattern.** A few visible productions emit nodes whose
token type differs from the EBNF name — they are aliases for
clarity at the grammar level. Four families:

- Eight Escape variants — `EscapeBacktick`, `EscapePlain`,
  `EscapeSpacingBacktick`, `EscapeHex`, `EscapeUnicode`,
  `EscapeOctal`, `EscapeBinary`, `EscapeMonadic` — all emit
  `Escape` tokens with distinguishing values.
- Six Number variants — `HexNumber`, `UnicodeNumber`,
  `OctalNumber`, `BinaryNumber`, `MonadNumber`, `BareNumber` —
  all emit `Number` tokens, paired with their corresponding
  Escape variant in `<EscapedNumber>` dispatch. The standalone
  `Number` (decimal source-level numbers) emits its own type.
- Two `PositiveIntegerLit` variants — `PositiveIntegerLit`
  (bare top-level) and `PositiveIntegerLitWithSep` (paired with
  `EscapePlain` in `<EscapedNumber>` dispatch) — both emit
  `PositiveIntegerLit` tokens with distinguishing content
  shapes (bare disallows the underscore separator that the
  escaped form allows).
- Four String content emitters — `PlainStrChars`,
  `InterpStrChars`, `SpacingInterpStrChars`,
  `SpacingEscapedStrChars` — all emit `String` tokens with
  context-specific char predicates.

**Concat compatibility note.** Four string-form productions and
their content helpers carry a `Lex` prefix (`<LexStringLit>`,
`<LexInterpStr>`, `<LexSpacingInterpStr>`, `<LexSpacingEscapedStr>`,
`<LexInterpStrContent>`, `<LexSpacingInterpStrContent>`,
`<LexSpacingEscapedStrContent>`, `<LexInterpExpr>`) to avoid
collision with same-named visible productions in
`Syntactic-Grammar.md`. The lex versions describe char-level
token assembly; the syn versions describe token-level assembly
into AST. The lex versions are hidden and reachable from the lex
`<Token>` start (which is itself unreachable from the syn
`Program` start under concat).

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
                         | (IntegerLit ExprEndingTail NumberEndingTail)  (* Note 6, Note 9, Note 11 *)
                         | (Number ExprEndingTail)         (* Note 5, Note 9 *)
                         | (General ExprEndingTail)        (* Note 9 *)
                         | TriplePeriod
                         | DoublePeriod
                         | DoubleColon
                         | EscapePlain                     (* standalone "\" *)
                         | (ExprEndingOp ExprEndingTail)   (* Note 9 *)
                         | SingleCharOp;                   (* Note 2 *)

<ExprEndingTail>        := ((Whitespace | Comment)* &("-" Digit) Hyphen)?;
<NumberEndingTail>      := DoublePeriod?;                 (* Note 11 *)

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
   escape opener). Emits Number token. Integer branch carries
   !IdentCont per Note 10. *)
Number                  := ("-" &Digit)? NumberBody;       (* Note 5 *)
<NumberBody>            := (Digit+ "." Digit+) | (Digit+ !IdentCont);

(* PositiveIntegerLit / NegativeIntegerLit: bare integer literals
   (no fractional part, no underscores). PEG-ordered before Number
   in <Token> with negative lookahead for "." Digit (avoid swallowing
   the integer part of decimals) and for IdentCont (avoid grabbing
   leading digits of digit-leading identifiers; Note 10).
   NegativeIntegerLit requires a leading "-"; PositiveIntegerLit is
   unsigned. Their first chars are disjoint, so order between them
   doesn't matter; both must precede BareNumber (whose integer branch
   would otherwise consume both shapes as Number). Separator-bearing
   integers (e.g. -1_000) and decimals (-1.5) fall through to
   BareNumber, since neither carries underscores or fractional parts. *)
PositiveIntegerLit := Digit+ !("." Digit) !IdentCont;
NegativeIntegerLit := "-" Digit+ !("." Digit) !IdentCont;

(* Hidden union for sites that accept either sign. *)
<IntegerLit> := NegativeIntegerLit | PositiveIntegerLit;

(* PositiveIntegerLitWithSep: positive integer with optional underscore
   separators. Fires from inside <EscapedNumber>, paired with
   EscapePlain. Emitted as PositiveIntegerLit. *)
PositiveIntegerLitWithSep := DigitsWithSep !("." Digit) !IdentCont;   (* emitted as PositiveIntegerLit *)

(* Number variant aliases — each emits a Number token with content
   shape matching the Escape opener's digit class. Integer-only
   forms (and the integer branch of MonadNumber/BareNumber) carry
   !IdentCont per Note 10. *)
HexNumber               := "-"? HexDigit+ !IdentCont;     (* emitted as Number *)
UnicodeNumber           := HexDigit+ !IdentCont;          (* emitted as Number; Note 6 *)
OctalNumber             := "-"? OctDigit+ !IdentCont;     (* emitted as Number *)
BinaryNumber            := "-"? BinDigit+ !IdentCont;     (* emitted as Number *)
MonadNumber             := ("-"? HexDigitsWithSep "." HexDigitsWithSep)
                         | ("-"? HexDigitsWithSep !IdentCont);  (* emitted as Number *)
BareNumber              := ("-"? DigitsWithSep "." DigitsWithSep)
                         | ("-"? DigitsWithSep !IdentCont);     (* emitted as Number *)

<DigitsWithSep>         := Digit+ (Digit | "_")*;
<HexDigitsWithSep>      := HexDigit+ (HexDigit | "_")*;

<HexDigit>              := #"[0-9a-fA-F]";
<OctDigit>              := #"[0-7]";
<BinDigit>              := #"[01]";

(* EscapedNumber: dispatch over (Escape variant, Number-or-General)
   pairs. Hidden — emits the Escape and content tokens as direct
   children of the parent frame. General fallback (Note 12) lets
   each arm commit to the Escape even when the number content
   fails, provided the tail is identifier-shaped. *)
<EscapedNumber>         := (EscapeHex     (HexNumber     | General))
                         | (EscapeUnicode (UnicodeNumber | General))
                         | (EscapeOctal   (OctalNumber   | General))
                         | (EscapeBinary  (BinaryNumber  | General))
                         | (EscapeMonadic (MonadNumber   | General))
                         | (EscapePlain   (PositiveIntegerLitWithSep | BareNumber | General));


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
<InterpExprStop>        := &"`";                          (* Note 8 *)


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

    Keyword, Native, Builtin, Comprehension, and BooleanOper are
    tried before General in the Token alternation. Each is gated
    by reserved-set membership over the matched span; see Note 4.
    The first that matches and passes its gate wins.

2. Ordered choice:

    Alternation (`|`) in this lexical grammar is intended as
    PEG-style ordered choice: first match wins. Longer/more-specific
    forms are listed before their prefixes. Examples:

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
    include digits (including as the leading character — Foi
    permits digit-leading identifiers like `1foo`, `5_value`,
    `1_000_000`). The combinator additionally requires that at
    least one non-digit character appears in the matched span.
    Without this, a bare digit run would match IdentBody and
    shadow Number. This semantic predicate is not expressible in
    EBNF; the EBNF form above is a syntactic over-approximation.

    The dual to sawNonDigit lives on the Number side: every
    integer-shaped number production carries a `!IdentCont`
    negative lookahead (Note 10) so that digit runs leading into
    identifier characters fall through to General rather than
    being prematurely captured as a Number.

4. Reserved-set membership gates:

    Keyword, Native, Builtin, Comprehension, and BooleanOper each
    match a broader form syntactically than their semantics
    permit. The combinator applies a positive lookahead over the
    matched span asserting membership in the corresponding
    reserved set; on gate failure the production fails and the
    next Token alternative is tried. Not expressible in EBNF.

5. Leading-sign rule (sign half):

    Number and the Number variants paired with hyphen-accepting
    Escape openers (HexNumber, OctalNumber, BinaryNumber,
    MonadNumber, BareNumber) all accept an optional leading `-`.
    For the standalone Number the combinator uses positive
    lookahead on the digit; the `-` is consumed and becomes part
    of the Number's value. This handles `-5` at start-of-input
    and immediately after non-expression-ending operators. The
    other half of the disambiguation — preventing `5-3` from
    re-lexing as Number(5) Number(-3) — is handled by
    ExprEndingTail (Note 9).

6. UnicodeNumber and integer-literal variants — sign handling:

    Unicode-char escapes (`\u`) produce a character/string from a
    hex codepoint and carry no sign. UnicodeNumber accepts hex
    digits only, without the optional leading `-` that other
    Number variants allow.

    Integer literals split by sign across two productions:
    PositiveIntegerLit (unsigned) and NegativeIntegerLit (requires
    leading `-`), unified at use sites by the hidden `<IntegerLit>`.
    PositiveIntegerLitWithSep (the escape-paired form inside
    `<EscapedNumber>`) remains unsigned only — the signed case
    for separator-bearing integers falls through to BareNumber.
    All four use `!("." Digit)` lookahead to avoid swallowing the
    integer part of decimals; a `.` followed by a non-digit
    (range op, property access, spread) is fine. All four also
    carry the `!IdentCont` guard per Note 10.

7. Escape token values:

    Eight EBNF productions emit Escape tokens, distinguished by
    value:

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

    All eight emit single Escape tokens in the output stream.
    The split into eight named productions lets the syntactic
    grammar reference each by name rather than by value-literal
    discrimination.

8. Recursive forward reference and embed-boundary detection:

    LexInterpExpr's body recursively contains Tokens — including
    nested LexSpacingInterpStr or further LexInterpExpr, which
    may themselves contain more nested strings. The combinator
    handles this via a forward-declared lazy reference resolved
    at parse time. In EBNF the recursion is direct:
    LexInterpExpr → Token → (LexSpacingInterpStr | LexInterpExpr)
    → LexInterpExpr.

    InterpExprStop is defined as `&"`"` — a positive lookahead
    on a bare backtick. This means LexInterpStr (the plain
    interp form) CANNOT be nested inside an InterpExpr body: its
    opener begins with a bare backtick, which the InterpExprStop
    lookahead treats as the embed-close. The simplification is
    intentional: plain-in-plain nesting would create a grammar
    ambiguity (any `` `X` `` or `` `"X"` `` inside an embed
    could be read multiple ways), and Foi forbids it by design.

    To nest interpolated strings inside an embed, use the
    spacing form (LexSpacingInterpStr), whose opener begins with
    `\` — that character does not trigger InterpExprStop. The
    nesting can be spacing-in-plain, spacing-in-spacing, or any
    depth thereof via successive `\` openers.

9. Hyphen-as-sign disambiguation (binary-operator half):

    Foi treats `-` as a sign when leading a digit at the start
    of an expression context, and as a binary operator otherwise.
    Rather than carry cross-token state, every production whose
    tokens can end an expression is wrapped with ExprEndingTail.
    After the main production matches, ExprEndingTail optionally
    consumes trailing Whitespace and Comment tokens, then peeks
    for `-` followed by a Digit; if present, it consumes the
    `-` as a Hyphen token. This forces the next outer iteration
    to see a fresh digit, which Number's leading-sign rule
    (Note 5) then handles correctly.

    EBNF representational caveat: ExprEndingTail's sub-matches
    (whitespace, comment, the hyphen) are each emitted as
    SEPARATE tokens in the output stream, not grouped under the
    parent production. EBNF expresses the sequential structure
    but cannot express the per-sub-match token emission.

    The trailing trivia consume is speculative — if no `-Digit`
    follows, the optional rolls back and the trivia is picked up
    by the next outer iteration.

    The wrapped set is exactly the token types that semantically
    end an expression context, after which a binary `-` is
    legal. Non-expression-ending operators (Plus, Star, etc.)
    are not wrapped; a `-` immediately following them is
    consumed as a sign by Number.

    For the IntegerLit slot at the Token level, ExprEndingTail
    is applied *inside* NumberEndingTail (i.e.
    `(IntegerLit ExprEndingTail NumberEndingTail)`) so that the
    lookahead for `-Digit` runs immediately after the integer,
    before any trailing `..` is consumed. The reverse order
    would cause `-2..-1` to consume the second `-` as a binary
    Hyphen rather than leaving it for NegativeIntegerLit on the
    next iteration.

10. Digit-leading identifier disambiguation (`!IdentCont`):

    Foi permits identifiers to start with digits (the
    sawNonDigit gate in Note 3 only requires that the identifier
    contain *some* non-digit character — leading digits are
    permitted). To prevent the integer-shaped number productions
    from grabbing the leading digits of an identifier, each
    integer-shaped form ends with a `!IdentCont` negative
    lookahead.

    Productions carrying `!IdentCont`:

    ```
    PositiveIntegerLit, NegativeIntegerLit, PositiveIntegerLitWithSep,
    Number (integer branch only — NumberBody),
    HexNumber, UnicodeNumber, OctalNumber, BinaryNumber,
    MonadNumber (integer branch only),
    BareNumber  (integer branch only)
    ```

    Decimal branches (with explicit fractional part) do not need
    the guard — once `.` is consumed and a fractional run
    follows, the position is unambiguously inside a number.

    Effects:

    ```
    "1foo"      → General("1foo")                  [identifier]
    "5_foo"     → General("5_foo")
    "1_000_000" → General("1_000_000")
    "5.5foo"    → Number("5.5") + General("foo")   [decimal commits]
    "\1foo"     → Escape("\") + General("1foo")    [General fallback; Note 12]
    "\h2Axyz"   → Escape("\h") + General("2Axyz")
    ```

    **Decimal-commit corner case.** The decimal branch's lack of
    a `!IdentCont` guard means that once `Digit+ "." Digit+`
    matches, the lexer commits to a decimal Number — even when
    an identifier-like continuation follows. So `"5.5foo"`
    tokenizes as `Number("5.5") + General("foo")`, not as
    `Number("5") + Period + General("5foo")` (which would be
    the property-access reading: integer 5, dot, identifier
    "5foo"). To express the property-access reading,
    parenthesize the integer: `"(5).5foo"`. This is a minor
    inconsistency in the digit-leading-identifier story (the
    lex doesn't fully respect identifier shape on the RHS of a
    `.`), but the common case is what users want, and the
    parenthesization workaround is clean.

11. NumberEndingTail (immediate `..` after integer literals):

    After an IntegerLit token (PositiveIntegerLit or
    NegativeIntegerLit), an immediate `..` (no trivia between)
    is consumed as a DoublePeriod token via the NumberEndingTail
    wrapper at the Token level. This forces a third `.` in
    `5...` to surface as a separate Period token rather than
    getting swallowed into a TriplePeriod by PEG longest-match.

    Rationale: the only multi-dot operator valid immediately
    after an integer is the range op `..`. When the user typos
    `...` after an integer, the lexer reports the syntactic
    error at the third `.` (a single ambiguous Period token),
    rather than silently committing to a TriplePeriod that would
    parse as the spread operator (a more obscure error
    downstream).

    Scope: applies to bare PositiveIntegerLit and
    NegativeIntegerLit (both arms of `<IntegerLit>`) at the
    Token level. PositiveIntegerLitWithSep (inside EscapedNumber)
    does not get the tail — a top-level DoublePeriod can still
    match immediately after the escaped form. The standalone
    Number production (decimal source-level numbers) also does
    not get the tail; applying NumberEndingTail to a decimal
    NumberLit would produce a `DoublePeriod + Period` shape for
    `12.5...` that doesn't represent any coherent Foi reading,
    so the wrapper is deliberately scoped to integer forms only.

12. General fallback within EscapedNumber:

    Each EscapedNumber arm tries the Number variant first, and
    on failure falls back to General within the same arm. This
    allows multi-char escapes followed by identifier-shaped
    content to tokenize as Escape + General rather than failing
    the whole arm and falling through to standalone EscapePlain:

    ```
    "\h_foo"   → Escape("\h"), General("_foo")
    "\h2Axyz"  → Escape("\h"), General("2Axyz")
    "\b101xyz" → Escape("\b"), General("101xyz")
    "\@FFxyz"  → Escape("\@"), General("FFxyz")
    "\1foo"    → Escape("\"),  General("1foo")
    ```

    For the EscapePlain arm specifically (the last alternative
    in EscapedNumber), the inner `or` is
    `(PositiveIntegerLitWithSep | BareNumber | General)`. PEG
    order matters: integer-with-sep is tried first, then
    decimal-bearing BareNumber, then General as catch-all.
    Critically, General is the *last* alternative within the
    arm, so it only fires when both number variants have failed.
    A two-arm structure with General as fallback of just one
    number variant would shadow the other.

    Cases where the fallback cannot fire (because no IdentStart
    follows the multi-char Escape) cause the whole arm to roll
    back atomically; the standalone EscapePlain catches the lone
    `\` and the remaining chars tokenize independently.
