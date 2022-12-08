# Foi Grammar

The **Foi** language grammar in [EBNF form](https://en.wikipedia.org/wiki/Extended_Backus%E2%80%93Naur_form), as [verified here](https://mdkrajnak.github.io/ebnftest/):

```ebnf
Program                 := WhSp* (StmtSemi WhSp*)*;

Stmt                    := DefVarStmt | DefBlockStmt | DefFuncExpr | DefTypeStmt | ExprListNoSkip | FuncReturnStmt;
StmtSemi                := Stmt? (WhSp* ";")+;

Expr                    := BareBlockExpr | ExprNoBlock;
ExprNoBlock             := Empty | Boolean | NumberLit | StrLit | DataStructLit | IdentifierExpr | RangeExpr | GroupedExpr | BracketAccessExpr | InfixCallExpr | LispExpr | GuardedExpr | MatchExpr | DefFuncExpr | AssignmentExpr;
GroupedExpr             := "(" WhSp* ExprListNoSkip WhSp* ")";
BracketExpr             := "[" WhSp* ExprNoBlock WhSp* "]";
BracketAccessExpr       := Expr BracketExpr;

ExprList                := ("," WhSp*)* (ExprNoBlock (WhSp* "," WhSp* ExprNoBlock?)*)?;
ExprListNoSkip          := ExprNoBlock (WhSp* "," WhSp* ExprNoBlock)*;

InfixCallExpr           := ExprNoBlock WhSp* "(" WhSp* ExprList? WhSp* ")";
LispExpr                := "|" WhSp* (ExprNoBlock | Op) (WhSp+ ExprList)? WhSp* "|";

Op                      := NamedComprehension | BooleanOp | TripleOp | DoubleOp | SingleOp;
NamedComprehension      := "~each" | "~map" | "~filter" | "~fold" | "~foldR" | "~chain" | "~bind" | "~flatMap" | "~ap" | "~foldMap";
BooleanOp               := #"[?!](?:in|as|has|and|or|empty|=|>|<|>=|<=|<>|$=|<=>)";
TripleOp                := "~<<" | "~<*" | "...";
DoubleOp                := ".." | "@@" | "->" | "+>" | "<+" | "#>" | "~<" | "$+";
SingleOp                := #"[+\-*/<>\.\\':,?!@`#$%^&|]";

IdentifierExpr          := Identifier (WhSp* (DotidentifIer | BracketExpr | DotAngleExpr | DotBracketExpr))*;
Identifier              := #"\b(?!(?:def|defn|deft|import|export|empty|true|false|int|integer|float|bool|boolean|str|~each|~map|~filter|~fold|~foldR|~chain|~bind|~flatMap|~ap|~foldMap|Id|None|Maybe|Left|Right|Either|Promise|PromiseSubject|PushStream|PushSubject|PullStream|PullSubject|Channel|Gen|IO|Value|Number|List)\b)[a-zA-Z0-9_~]+";
DotidentifIer           := "." WhSp* IdentifierExpr;

DefVarStmt              := "def" WhSp+ Identifier WhSp* ("::" | ":") WhSp* ExprNoBlock;

BlockExprVarDef         := BlockDefsClause WhSp* BareBlockExpr;
BlockExpr               := BlockDefsClause? WhSp* BareBlockExpr;
BareBlockExpr           := "{" WhSp* (StmtSemi WhSp*)* ((Stmt | Expr) WhSp* ";"?)? WhSp* "}";
BlockDefsClause         := "(" WhSp* VarDefList WhSp* ")";

DefBlockStmt            := "def" WhSp* BlockExprVarDef;

VarDefInitOpt           := Identifier (WhSp* ("::" | ":") WhSp* ExprNoBlock)?;
VarDefList              := ("," WhSp*)* (VarDefInitOpt (WhSp* "," WhSp* VarDefInitOpt?)*)?;

RangeExpr               := (ClosedRangeExpr | LeadingRangeExpr | TrailingRangeExpr);
ClosedRangeExpr         := Expr ".." Expr;
LeadingRangeExpr        := Expr "..";
TrailingRangeExpr       := ".." Expr;
DotBracketExpr          := ".[" WhSp* RangeExpr WhSp* "]";

DotAngleExpr            := ".<" WhSp* ExprListNoSkip WhSp* ">";

Empty                   := "empty";
Boolean                 := "true" | "false";
Keyword                 := "def" | "defn" | "deft" | "import" | "export" | ":as" | ":over" | "int" | "integer" | "float" | "bool" | "boolean" | "str";
BuiltIn                 := "Id" | "None" | "Maybe" | "Left" | "Right" | "Either" | "Promise" | "PromiseSubject" | "PushStream" | "PushSubject" | "PullStream" | "PullSubject" | "Channel" | "Gen" | "IO" | "Value" | "Number" | "List";

AssignmentExpr          := AssignmentTarget WhSp* ":=" WhSp* (Expr | BlockExpr);
AssignmentTarget        := Identifier (WhSp* (("." WhSp* Identifier) | ("[" WhSp* ExprNoBlock WhSp* "]")))*;


(*************** Decision Making (Guard, Pattern Matching) ***************)

CondClause              := ("?" | "!") BracketExpr;
GuardedExpr             := CondClause ":" WhSp* (Expr | BlockExpr);

MatchExpr               := IndepMatchExpr | DepMatchExpr;
IndepMatchExpr          := "?{" WhSp* IndepPatternStmts WhSp* "}";
IndepPatternStmts       := ((IndepPatternStmt WhSp*)+ ElseStmt?) | ElseStmt;
IndepPatternStmt        := CondClause MatchConsequent (WhSp* ";")*;
MatchConsequent         := ":" WhSp* ((Expr WhSp* ";") | BlockExpr);
ElseStmt                := "?:" WhSp* (Expr | BlockExpr) (WhSp* ";")*;
DepMatchExpr            := "?(" WhSp* ExprNoBlock WhSp* "){" WhSp* DepPatternStmts WhSp* "}";
DepPatternStmts         := ((DepPatternStmt WhSp*)+ ElseStmt?) | ElseStmt;
DepPatternStmt          := DepCondClause MatchConsequent (WhSp* ";")*;
DepCondClause           := ("?" | "!") "[" WhSp* ExprListNoSkip WhSp* "]";


(*************** Number Literals ***************)

NumberLit               := Base10Number | EscBase10 | BinaryInteger | HexInteger | OctalInteger | UnicodeChar | MonadicNumber;

Esc                     := "\\";
BinaryEsc               := Esc "b";
HexEsc                  := Esc "h";
OctalEsc                := Esc "o";
UnicodeEsc              := Esc "u";
MonadicEsc              := Esc "@";

Base10Number            := "-"? Base10Digit+ ("." Base10Digit+)?;
Base10Digit             := OctalDigit | "8" | "9";

EscBase10               := Esc EscNum;
EscNum                  := "-"? EscNumDigits ("." EscNumDigits+)?;
EscNumDigits            := Base10Digit+ ("_" EscNumDigits)?;

BinaryInteger           := BinaryEsc "-"? BinaryDigit+;
BinaryDigit             := "0" | "1";

HexInteger              := HexEsc HexNum;
HexNum                  := "-"? HexDigit+;
HexDigit                := Base10Digit | #"[a-fA-F]";

OctalInteger            := OctalEsc "-"? OctalDigit+;
OctalDigit              := BinaryDigit | #"[2-7]";

UnicodeChar             := UnicodeEsc HexDigit+;

MonadicNumber           := MonadicEsc (EscNum | HexNum);


(*************** String Literals ***************)

StrLit                  := PlainStr | SpacingStr | InterpStr | InterpSpacingStr;

InterpEsc               := Esc "`";
InterpSpacingEsc        := Esc InterpEsc;

PlainStr                := '"' (#'[^"]' | '""')* '"';
SpacingStr              := Esc PlainStr;
InterpStr               := InterpEsc InterpLit;
InterpSpacingStr        := InterpSpacingEsc InterpLit;
InterpLit               := '"' (#'[^"`]' | '""' | "`" WhSp* Expr* WhSp* "`")* '"';


(*************** Data Structures ***************)

DataStructLit           := RecordTupleLit | SetLit;
RecordTupleLit          := "<" WhSp* RecordTupleEntryList WhSp* ">";
RecordTupleEntryList    := ("," WhSp*)* (RecordTupleEntry (WhSp* "," WhSp* RecordTupleEntry?)*)?;
RecordTupleEntry        := RecordTupleValue | PickValue | RecordProperty;
RecordTupleValue        := Empty | Boolean | NumberLit | StrLit | DataStructLit | IdentifierExpr | LispExpr | ("(" WhSp* LispExpr WhSp* ")");
PickValue               := "&" IdentifierExpr;
RecordProperty          := (":" Identifier) | ("%"? Identifier WhSp* ":" WhSp* RecordTupleValue);
SetLit                  := "<[" WhSp* SetEntryList WhSp* "]>";
SetEntryList            := ("," WhSp*)* (SetEntry (WhSp* "," WhSp* SetEntry?)*)?;
SetEntry                := RecordTupleValue | PickValue;


(*************** Functions ***************)

DefFuncExpr             := "defn" (WhSp+ Identifier)? WhSp* ("(" WhSp* ParameterList? WhSp* ")")+ FuncMeta? WhSp* FuncBody;
Parameter               := Identifier (WhSp* ":" WhSp* ExprNoBlock)?;
ParameterList           := Parameter (WhSp* "," WhSp* Parameter)*;
FuncMeta                := (WhSp* FuncPrecondList (WhSp+ FuncOverClause)? (WhSp+ FuncAsClause)?) | (WhSp* FuncOverClause WhSp+ FuncAsClause) | (WhSp* FuncPrecondList) | (WhSp+ FuncOverClause) | (WhSp+ FuncAsClause);
FuncPrecond             := CondClause ":" WhSp* ExprNoBlock;
FuncPrecondList         := FuncPrecond (WhSp+ FuncPrecond)*;
FuncOverClause          := ":over" WhSp* "(" WhSp* Identifier (WhSp* "," WhSp* Identifier)* WhSp* ")";
FuncAsClause            := ":as" WhSp+ Identifier;
FuncBody                := ("^" WhSp* ExprNoBlock) | BareBlockExpr;
FuncReturnStmt          := "^" WhSp* (Expr | BlockExpr);


(*************** Types ***************)

DefTypeStmt             := "deft" WhSp+ Identifier WhSp+ #"[^;]+" WhSp*;    (* TODO *)


(*************** Whitespace ***************)

WhSp                    := Whitespace | Comment;
Whitespace              := #"[\s]+" | (*u0085*) "" | (*u180e*) "᠎" | (*u200b*) "​" | (*u200c*) "‍" | (*u200d*) "‌" | (*u200e*) "‎" | (*u200f*) "‏";
Comment                 := LineComment | BlockComment;
LineComment             := "//" #"[^\n/][^\n]*"? &("\n" | Epsilon);
BlockComment            := "///" #"[^]*?///";
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
    ?{?: 42;};
    ?{
        ?[z]: fn(g);
        ![x]: { fn(g) };
        ?[y]: (v) { fn(g); }
        ?: 42
    };
    ?( fn(g) ){
        ?[ x, z . y [3] ]: g;
    };
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
