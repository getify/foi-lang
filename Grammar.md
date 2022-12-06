# Foi Grammar

The **Foi** language grammar in [EBNF form](https://en.wikipedia.org/wiki/Extended_Backus%E2%80%93Naur_form), as [verified here](https://mdkrajnak.github.io/ebnftest/):

```ebnf
Program                     := Whitespace* (StatementSemi Whitespace*)*;

Statement                   := DefVarStatement | DefBlockStatement | DefFunctionExpression | DefTypeStatement | ExpressionList | FunctionReturnStatement;
StatementSemi               := Statement? (Whitespace* ";")+;

Expression                  := BareBlockExpression | ExpressionNoBlock;
ExpressionNoBlock           := Empty | Boolean | NumberLiteral | StringLiteral | DataStructLiteral | IdentifierExpression | RangeExpression | GroupedExpression | BracketAccessExpression | InfixCallExpression | LispExpression | GuardedExpression | MatchExpression | DefFunctionExpression | AssignmentExpression;
GroupedExpression           := "(" Whitespace* ExpressionList Whitespace* ")";
BracketExpression           := "[" Whitespace* ExpressionNoBlock Whitespace* "]";
BracketAccessExpression     := Expression BracketExpression;
ExpressionList              := ExpressionNoBlock ((Whitespace* ",")+ Whitespace* ExpressionNoBlock)*;

InfixCallExpression         := ExpressionNoBlock Whitespace* "(" Whitespace* ("," Whitespace*)* ExpressionList? Whitespace* ("," Whitespace*)* ")";
LispExpression              := "|" Whitespace* (ExpressionNoBlock | Operator) (Whitespace+ ("," Whitespace*)* ExpressionList?)? ("," Whitespace*)* Whitespace* "|";

Operator                    := NamedComprehension | BooleanOperator | TripleOperator | DoubleOperator | SingleOperator;
NamedComprehension          := "~each" | "~map" | "~filter" | "~fold" | "~foldR" | "~chain" | "~bind" | "~flatMap" | "~ap" | "~foldMap";
BooleanOperator             := #"[?!](?:in|as|has|and|or|empty|=|>|<|>=|<=|<>|$=|<=>)";
TripleOperator              := "~<<" | "~<*" | "...";
DoubleOperator              := ".." | "@@" | "->" | "+>" | "<+" | "#>" | "~<" | "$+";
SingleOperator              := #"[+\-*/<>\.\\':,?!@`#$%^&|]";

IdentifierExpression        := Identifier (IdentifierDot | BracketExpression | DotAngleExpression | DotBracketExpression)*;
Identifier                  := #"\b(?!(?:def|defn|deft|import|export|empty|true|false|int|integer|float|bool|boolean|string|~each|~map|~filter|~fold|~foldR|~chain|~bind|~flatMap|~ap|~foldMap|Id|None|Maybe|Left|Right|Either|Promise|PromiseSubject|PushStream|PushSubject|PullStream|PullSubject|Channel|Gen|IO|Value|Number|List)\b)[a-zA-Z0-9_~]+";
IdentifierDot               := "." IdentifierExpression;

BlockExpressionVarDef       := BlockDefinitionsClause Whitespace* BareBlockExpression;
BlockExpression             := BlockDefinitionsClause? Whitespace* BareBlockExpression;
BareBlockExpression         := "{" Whitespace* (StatementSemi Whitespace*)* ((Statement | Expression) Whitespace* ";"?)? Whitespace* "}";
BlockDefinitionsClause      := "(" Whitespace* VarDefinitionList Whitespace* ")";

DefBlockStatement           := "def" Whitespace* BlockExpressionVarDef;

VarDefinitionInitOptional   := Identifier (Whitespace* ("::" | ":") Whitespace* ExpressionNoBlock)?;
VarDefinitionList           := VarDefinitionInitOptional (Whitespace* "," Whitespace* VarDefinitionInitOptional)*;

DefVarStatement             := "def" Whitespace+ Identifier Whitespace* ("::" | ":") Whitespace* ExpressionNoBlock;

RangeExpression             := (ClosedRangeExpression | LeadingRangeExpression | TrailingRangeExpression);
ClosedRangeExpression       := Expression ".." Expression;
LeadingRangeExpression      := Expression "..";
TrailingRangeExpression     := ".." Expression;
DotBracketExpression        := ".[" Whitespace* RangeExpression Whitespace* "]";

DotAngleExpression          := ".<" Whitespace* ExpressionList Whitespace* ">";

Empty                       := "empty";
Boolean                     := "true" | "false";
Keyword                     := "def" | "defn" | "deft" | "import" | "export" | ":as" | ":over" | "int" | "integer" | "float" | "bool" | "boolean" | "string";
BuiltIn                     := "Id" | "None" | "Maybe" | "Left" | "Right" | "Either" | "Promise" | "PromiseSubject" | "PushStream" | "PushSubject" | "PullStream" | "PullSubject" | "Channel" | "Gen" | "IO" | "Value" | "Number" | "List";

ConditionalClause           := ("?" | "!") "[" Whitespace* ExpressionNoBlock Whitespace* "]";
GuardedExpression           := ConditionalClause ":" Whitespace* (Expression | BlockExpression);

MatchExpression             := IndMatchExpression | DepMatchExpression;
IndMatchExpression          := "?{" Whitespace* (IndPatternStatement Whitespace*)+ ElseStatement? Whitespace* "}";
MatchConsequent             := ":" Whitespace* ((Expression ";"+) | BlockExpression);
IndPatternStatement         := ConditionalClause MatchConsequent;
ElseStatement               := "?" MatchConsequent;
DepMatchExpression          := "?(" Whitespace* ExpressionNoBlock Whitespace* ")" Whitespace* "{" Whitespace* (DepPatternStatement Whitespace*)+ ElseStatement? Whitespace* "}";
DepPatternStatement         := ("?" | "!") "[" Whitespace* ExpressionList Whitespace* "]" MatchConsequent;

AssignmentExpression        := AssignmentTarget Whitespace* ":=" Whitespace* (Expression | BlockExpression);
AssignmentTarget            := Identifier (Whitespace* (("." Whitespace* Identifier) | ("[" Whitespace* ExpressionNoBlock Whitespace* "]")))*;

Whitespace                  := #"[\s]+" | (*u0085*) "" | (*u180e*) "᠎" | (*u200b*) "​" | (*u200c*) "‍" | (*u200d*) "‌" | (*u200e*) "‎" | (*u200f*) "‏" | Comment;
Comment                     := LineComment | BlockComment;
LineComment                 := "//" #"[^\n/][^\n]*"? &("\n" | Epsilon);
BlockComment                := "///" #"[^]*?///";


(*************** Number Literals ***************)

NumberLiteral               := Base10Number | EscBase10 | BinaryInteger | HexInteger | OctalInteger | UnicodeChar | MonadicNumber;

Escape                      := "\\";
BinaryEscape                := Escape "b";
HexEscape                   := Escape "h";
OctalEscape                 := Escape "o";
UnicodeEscape               := Escape "u";
MonadicEscape               := Escape "@";

Base10Number                := "-"? Base10Digit+ ("." Base10Digit+)?;
Base10Digit                 := OctalDigit | #"[89]";

EscBase10                   := Escape EscNum;
EscNum                      := "-"? EscNumDigits ("." EscNumDigits+)?;
EscNumDigits                := Base10Digit+ ("_" EscNumDigits)?;

BinaryInteger               := BinaryEscape "-"? BinaryDigit+;
BinaryDigit                 := #"[01]";

HexInteger                  := HexEscape HexNum;
HexNum                      := "-"? HexDigit+;
HexDigit                    := Base10Digit | #"[a-fA-F]";

OctalInteger                := OctalEscape "-"? OctalDigit+;
OctalDigit                  := BinaryDigit | #"[2-7]";

UnicodeChar                 := UnicodeEscape HexDigit+;

MonadicNumber               := MonadicEscape (EscNum | HexNum);


(*************** String Literals ***************)

StringLiteral               := PlainString | SpacingString | InterpolatedString | InterpolatedSpacingString;

Escape                      := "\\";
InterpolatedEsc             := Escape "`";
InterpolatedSpacingEsc      := Escape InterpolatedEsc;

PlainString                 := '"' (#'[^"]' | '""')* '"';
SpacingString               := Escape PlainString;
InterpolatedString          := InterpolatedEsc InterpolatedLiteral;
InterpolatedSpacingString   := InterpolatedSpacingEsc InterpolatedLiteral;
InterpolatedLiteral         := '"' (#'[^"`]' | '""' | "`" Whitespace* Expression* Whitespace* "`")* '"';


(*************** Data Structures ***************)

DataStructLiteral           := RecordTupleLiteral | SetLiteral;
RecordTupleLiteral          := "<" Whitespace* ("," Whitespace*)* (DataStructEntry (Whitespace* "," Whitespace* DataStructEntry?)*)? Whitespace* ">";
DataStructEntry             := DataStructValue | PickValue | RecordProperty;
DataStructValue             := Empty | Boolean | NumberLiteral | StringLiteral | DataStructLiteral | IdentifierExpression | LispExpression | ("(" Whitespace* LispExpression Whitespace* ")");
PickValue                   := "&" IdentifierExpression;
RecordProperty              := (":" Identifier) | ("%"? Identifier Whitespace* ":" Whitespace* DataStructValue);
SetLiteral                  := "<[" Whitespace* ("," Whitespace*)* (SetEntry (Whitespace* "," Whitespace* SetEntry?)*)? Whitespace* "]>";
SetEntry                    := DataStructValue | PickValue;


(*************** Functions ***************)

DefFunctionExpression       := "defn" (Whitespace+ Identifier)? Whitespace* ("(" Whitespace* ParameterList? Whitespace* ")")+ FunctionMeta? Whitespace* FunctionBody;
Parameter                   := Identifier (Whitespace* ":" Whitespace* ExpressionNoBlock)?;
ParameterList               := Parameter (Whitespace* "," Whitespace* Parameter)*;
FunctionMeta                := (Whitespace* FunctionPreconditionList (Whitespace+ FunctionOverClause)? (Whitespace+ FunctionAsClause)?) | (Whitespace* FunctionOverClause Whitespace+ FunctionAsClause) | (Whitespace* FunctionPreconditionList) | (Whitespace+ FunctionOverClause) | (Whitespace+ FunctionAsClause);
FunctionPrecondition        := ConditionalClause ":" Whitespace* ExpressionNoBlock;
FunctionPreconditionList    := FunctionPrecondition (Whitespace+ FunctionPrecondition)*;
FunctionOverClause          := ":over" Whitespace* "(" Whitespace* Identifier (Whitespace* "," Whitespace* Identifier)* Whitespace* ")";
FunctionAsClause            := ":as" Whitespace+ Identifier;
FunctionBody                := ("^" Whitespace* ExpressionNoBlock) | BareBlockExpression;
FunctionReturnStatement     := "^" Whitespace* (Expression | BlockExpression);


(*************** Types ***************)

DefTypeStatement            := "deft" Whitespace+ Identifier Whitespace+ #"[^;]+" Whitespace*;    (* TOOD *)
```

## Grammar Test Snippets

Here are some examples of **Foi** code to test various aspects of this grammar:

----

(recognized whitespace characters)

> \u0009\u000a\u000b\u000c\u000d\u0020\u0085\u00a0\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u200b\u200c\u200d\u200e\u200f\u2028\u2029\u202f\u205f\u3000\ufeff

```java



   ᠎           ​‌‍‎‏    　﻿
```

-----

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

```java
<>;
<  >;
<true>;
<1,2,3>;
<a:1>;
< a: 1, b: "ok" >;
<
    ,,&v.x.[3..].<a,b> , "Hello" , 3,,4, :foo,
    yes: empty, (|fn 1|),
    %bar:<1>,,
>;
<[]>;
<[ 1, 2, 2 ]>;
```

```java
deft Whatever int | bool;

def cb: defn(x)^x;

defn add(x)(y)
    ?[x.y]: y(z[2])
    ![x]: z(3)
    :over(z, w)
    :as Whatever
{
    z := 2;
    ?[z]: (g: z) { fn(g) };
    x.[y..z];
    y.<first,last>;
    |+ 1,2,3|;
    ^42
};
```

## License

[![License](https://img.shields.io/badge/license-MIT-a1356a)](LICENSE.txt)

All code and documentation are (c) 2022 Kyle Simpson and released under the [MIT License](http://getify.mit-license.org/). A copy of the MIT License [is also included](LICENSE.txt).
