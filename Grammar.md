# Foi Grammar

The **Foi** language grammar in [EBNF form](https://en.wikipedia.org/wiki/Extended_Backus%E2%80%93Naur_form), as [verified here](https://mdkrajnak.github.io/ebnftest/):

```ebnf
Program := (Whitespace* Stmt Whitespace*)+;

Stmt := ((Expression | DefVar) Whitespace*)? ";";

Expression := Empty | Boolean | NumberLiteral | StringLiteral | Identifier;

Operator := NamedComprehension | BooleanOperator | TripleOperator | DoubleOperator | SingleOperator;
NamedComprehension := "~each" | "~map" | "~filter" | "~fold" | "~foldR" | "~chain" | "~bind" | "~flatMap" | "~ap" | "~foldMap";
BooleanOperator := #"[?!](?:in|as|has|and|or|empty|=|>|<|>=|<=|<>|$=|<=>)";
TripleOperator := "~<<" | "~<*" | "...";
DoubleOperator := ".." | "@@" | "->" | "+>" | "<+" | "#>" | "~<" | "::" | "$+";
SingleOperator := #"[+\-*/(){}<>\[\]\.\\'\":;,?!@`#$%^&|]";

Empty := "empty";
Boolean := "true" | "false";
Keyword := "def" | "defn" | "deft" | "import" | "export" | ":as" | ":over" | "int" | "integer" | "float" | "bool" | "boolean" | "string";
BuiltIn := "Id" | "None" | "Maybe" | "Left" | "Right" | "Either" | "Promise" | "PromiseSubject" | "PushStream" | "PushSubject" | "PullStream" | "PullSubject" | "Channel" | "Gen" | "IO" | "Value" | "Number" | "List";

Identifier := #"\b(?!(?:def|defn|deft|import|export|empty|true|false|int|integer|float|bool|boolean|string|~each|~map|~filter|~fold|~foldR|~chain|~bind|~flatMap|~ap|~foldMap|Id|None|Maybe|Left|Right|Either|Promise|PromiseSubject|PushStream|PushSubject|PullStream|PullSubject|Channel|Gen|IO|Value|Number|List)\b)[a-zA-Z0-9_~]+";

DefVar := "def" Whitespace+ Identifier Whitespace* ":" Whitespace* Expression;

Whitespace := #"[\s\u0085\p{Z}]"+ | Comment;

Comment := LineComment | BlockComment;
LineComment := "//" #"[^\n/][^\n]*"? &("\n" | Epsilon);
BlockComment := "///" #"[^]*?///";


(*************** Number Literals ***************)

NumberLiteral := Base10Number | EscBase10 | BinaryInteger | HexInteger | OctalInteger | UnicodeChar | MonadicNumber;

Escape := "\\";
BinaryEscape := Escape "b";
HexEscape := Escape "h";
OctalEscape := Escape "o";
UnicodeEscape := Escape "u";
MonadicEscape := Escape "@";

Base10Number := "-"? Base10Digit+ ("." Base10Digit+)?;
Base10Digit := OctalDigit | #"[89]";

EscBase10 := Escape EscNum;
EscNum := "-"? EscNumDigits ("." EscNumDigits+)?;
EscNumDigits := Base10Digit+ ("_" EscNumDigits)?;

BinaryInteger := BinaryEscape "-"? BinaryDigit+;
BinaryDigit := #"[01]";

HexInteger := HexEscape HexNum;
HexNum := "-"? HexDigit+;
HexDigit := Base10Digit | #"[a-fA-F]";

OctalInteger := OctalEscape "-"? OctalDigit+;
OctalDigit := BinaryDigit | #"[2-7]";

UnicodeChar := UnicodeEscape HexDigit+;

MonadicNumber := MonadicEscape (EscNum | HexNum);


(*************** String Literals ***************)

StringLiteral := PlainString | SpacingString | InterpolatedString | InterpolatedSpacingString;

Escape := "\\";
InterpolatedEsc := Escape "`";
InterpolatedSpacingEsc := Escape InterpolatedEsc;

PlainString := '"' (#'[^"]' | '""')* '"';
SpacingString := Escape PlainString;
InterpolatedString := InterpolatedEsc InterpolatedLiteral;
InterpolatedSpacingString := InterpolatedSpacingEsc InterpolatedLiteral;
InterpolatedLiteral := '"' (#'[^"`]' | '""' | "`" Whitespace* Expression* Whitespace* "`")* '"';
```

## Grammar Test Snippets

Here are some examples of **Foi** code to test various aspects of this grammar:

```java
def a: 1;
def b:1; // hello
def c  :   1 ; ;;
def d: /// hello
/// 3;
def /// e: 3;///  f: 4;
```

```java
123;
-123;
123.456;
-123.456;
\123_456;
\-123_456;
\123_456.78_9;
\-123_456.78_9;
\b10110;
\b-10110;
\hf123;
\h-f123;
\o123;
\o-123;
\uf123;
\@123_456.78_9;
\@-f123;
```

```java
"Hello world";
"Hello, ""Santa""!";
"Here's a
   multiline string";
\"A single line
    string with whitespace collapsing, defined across multiple
  lines";
\\`"A single line (with
   whitespace) collapsing, and a single `` backtick";
\`"Special number: `-3.1415962`
   Name: `name`
   Greeting: `\\`"Hello world"`
   Reaction: `\"Yay!"`
   Reply: `"Ok."`
!";
```

## License

[![License](https://img.shields.io/badge/license-MIT-a1356a)](LICENSE.txt)

All code and documentation are (c) 2022 Kyle Simpson and released under the [MIT License](http://getify.mit-license.org/). A copy of the MIT License [is also included](LICENSE.txt).
