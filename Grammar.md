# Foi Grammar

The **Foi** language grammar in [EBNF form](https://en.wikipedia.org/wiki/Extended_Backus%E2%80%93Naur_form), as [verified here](https://mdkrajnak.github.io/ebnftest/):

```ebnf
Program                 := WhSp* (StmtSemi WhSp*)* StmtSemiOpt?;

Stmt                    := DefVarStmt | DefBlockStmt | DefTypeStmt | Expr;
StmtSemi                := Stmt? (WhSp* ";")+;
StmtSemiOpt             := Stmt? (WhSp* ";")*;

Op                      := NamedComprOp | BooleanOp | TripleOp | DoubleOp | SingleOp;
NamedComprOp            := "~each" | "~map" | "~filter" | "~fold" | "~foldR" | "~chain" | "~bind" | "~flatMap" | "~ap" | "~foldMap";
BooleanOp               := #"[?!](?:in|as|has|and|or|empty|=|>|<|>=|<=|<>|$=|<=>)";
TripleOp                := "~<<" | "~<*" | "...";
DoubleOp                := ".." | "@@" | "->" | "+>" | "<+" | "#>" | "~<" | "$+";
SingleOp                := #"[+\-*/<>\.\\':,?!@`#$%^&|]";

Empty                   := "empty";
Boolean                 := "true" | "false";
Keyword                 := "def" | "defn" | "deft" | "import" | "export" | ":as" | ":over" | "int" | "integer" | "float" | "bool" | "boolean" | "str";
BuiltIn                 := "Id" | "None" | "Maybe" | "Left" | "Right" | "Either" | "Promise" | "PromiseSubject" | "PushStream" | "PushSubject" | "PullStream" | "PullSubject" | "Channel" | "Gen" | "IO" | "Value" | "Number" | "List";

AssignmentExpr          := Identifier WhSp* ":=" WhSp* Expr;

PipelineExpr            := (PipelineSourceExpr PipelineTargetExpr) | ("(" WhSp* PipelineExpr WhSp* ")");
PipelineSourceExpr      := ExprTrailingWhSp | PipelineNoWhSpExpr;
PipelineTargetExpr      := "#>" (ExprLeadingWhSp | PipelineNoWhSpExpr | PipelineSubExpr);
PipelineSubExpr         := ((ExprWhSp | PipelineNoWhSpExpr) PipelineTargetExpr) | ("(" WhSp* PipelineSubExpr WhSp* ")");
PipelineNoWhSpExpr      := BlockExpr | ("(" WhSp* Expr WhSp* ")");


(*************** General Expressions ***************)

Expr                    := BlockExpr | ExprNoBlock | ComprExpr | DoComprExpr | ("(" WhSp* Expr WhSp* ")");
ExprNoBlock             := Empty | Boolean | NumberLit | StrLit | DataStructLit | ClosedRangeExpr | IdentifierExpr | CallExpr | GuardedExpr | MatchExpr | DefFuncExpr | AssignmentExpr | PipelineExpr | ExprAccessExpr | ("(" WhSp* ExprNoBlock WhSp* ")");
ExprTrailingWhSp        := Expr WhSp+;
ExprLeadingWhSp         := WhSp+ Expr;
ExprWhSp                := ExprLeadingWhSp WhSp+;
ExprAccessExpr          := (ExprNoBlock | ("(" WhSp* Expr WhSp* ")")) (SingleAccessExpr | MultiAccessExpr);


(*************** Identifier / Access / Range Expressions ***************)

Identifier              := #"\b(?!(?:def|defn|deft|import|export|empty|true|false|int|integer|float|bool|boolean|str|~each|~map|~filter|~fold|~foldR|~chain|~bind|~flatMap|~ap|~foldMap|Id|None|Maybe|Left|Right|Either|Promise|PromiseSubject|PushStream|PushSubject|PullStream|PullSubject|Channel|Gen|IO|Value|Number|List)\b)[a-zA-Z0-9_~]+";

IdentifierExpr          := "#" | Identifier | IdentifierSingleExpr | IdentifierMultiExpr;
IdentifierSingleExpr    := ("#" | Identifier) SingleAccessExpr;
IdentifierMultiExpr     := ("#" | Identifier) MultiAccessExpr;

SingleAccessExpr        := (WhSp* (DotSingleIdentifier | BracketExpr))+;
MultiAccessExpr         := (WhSp* (DotMultiIdentifier | BracketExpr | DotBracketExpr | DotAngleExpr))+;

DotSingleIdentifier     := "." WhSp* (Identifier | IdentifierSingleExpr);
DotMultiIdentifier      := "." WhSp* (Identifier | IdentifierMultiExpr);
BracketExpr             := "[" WhSp* ExprNoBlock WhSp* "]";

DotBracketExpr          := ".[" WhSp* RangeExpr WhSp* "]";
RangeExpr               := (ClosedRangeExpr | LeadingRangeExpr | TrailingRangeExpr);
ClosedRangeExpr         := ExprNoBlock ".." ExprNoBlock;
LeadingRangeExpr        := ExprNoBlock "..";
TrailingRangeExpr       := ".." ExprNoBlock;

DotAngleExpr            := ".<" WhSp* AnglePropertyList WhSp* ">";
AnglePropertyList       := PropertyExpr (WhSp* "," WhSp* PropertyExpr)* (WhSp* ",")?;


(*************** Variable Definitions / Destructuring / Blocks ***************)

DefVarStmt              := "def" WhSp+ (Identifier | DestructureTarget) WhSp* ":" WhSp* Expr;

DestructureTarget       := "<" WhSp* DestructureDefList WhSp* ">";
DestructureDefList      := DestructureDef (WhSp* "," WhSp* DestructureDef)* (WhSp* ",")?
DestructureDef          := DestructureNamedDef | DestructureConciseDef | DestructureCapture;
DestructureNamedDef     := Identifier WhSp* ":"  WhSp* Identifier MultiAccessExpr?;
DestructureConciseDef   := ":" Identifier SingleAccessExpr?;
DestructureCapture      := "#" Identifier;

DefBlockStmt            := "def" WhSp* BlockExprVarDef;

BlockExprVarDef         := BlockDefsInit WhSp* BareBlockExpr;
BlockExpr               := BlockDefsInitOpt? WhSp* BareBlockExpr;
BareBlockExpr           := "{" WhSp* (StmtSemi WhSp*)* StmtSemiOpt? WhSp* "}";
BlockDefsInit           := "(" WhSp* VarDefInitList WhSp* ")";
VarDefInitList          := VarDefInit (WhSp* "," WhSp* VarDefInit)* (WhSp* ",")?;
VarDefInit              := Identifier WhSp* ":" WhSp* ExprNoBlock;
BlockDefsInitOpt        := "(" WhSp* VarDefInitOptList WhSp* ")";
VarDefInitOptList       := ("," WhSp*)* (VarDefInitOpt (WhSp* "," WhSp* VarDefInitOpt?)*)?;
VarDefInitOpt           := (Identifier (WhSp* ":" WhSp* ExprNoBlock)?) | DestructureTarget;


(*************** Decision Making -- Guard, Pattern Matching ***************)

CondClause              := ("?" | "!") BracketExpr;
GuardedExpr             := CondClause ":" WhSp* Expr;

MatchExpr               := IndepMatchExpr | DepMatchExpr;
IndepMatchExpr          := "?{" WhSp* IndepPatternStmts WhSp* "}";
IndepPatternStmts       := ((IndepPatternStmt WhSp*)+ ElseStmt?) | ElseStmt;
IndepPatternStmt        := CondClause MatchConsequent (WhSp* ";")*;
MatchConsequent         := ":" WhSp* ((Expr WhSp* ";") | BlockExpr);
ElseStmt                := "?:" WhSp* Expr (WhSp* ";")*;
DepMatchExpr            := "?(" WhSp* ExprNoBlock WhSp* "){" WhSp* DepPatternStmts WhSp* "}";
DepPatternStmts         := ((DepPatternStmt WhSp*)+ ElseStmt?) | ElseStmt;
DepPatternStmt          := DepCondClause MatchConsequent (WhSp* ";")*;
DepCondClause           := ("?" | "!") "[" WhSp* DepCondExprList WhSp* "]";
DepCondExprList         := ExprNoBlock (WhSp* "," WhSp* ExprNoBlock)* (WhSp* ",")?;


(*************** Loops/Comprehensions ***************)

ComprExpr               := (((ComprRangeNoEachExpr WhSp+ ComprOpNoEach) | (ComprRangeEachExpr WhSp+ ComprOpEach) | (ComprExpr WhSp+ ComprOp)) WhSp+ ComprIterationExpr) | ("(" WhSp* ComprExpr WhSp* ")");
ComprRangeNoEachExpr    := IdentifierExpr | CallExpr | DataStructLit | ClosedRangeExpr | ExprAccessExpr | ("(" WhSp* ComprRangeNoEachExpr WhSp* ")");
ComprRangeEachExpr      := CondClause | ComprRangeNoEachExpr | ("(" WhSp* ComprRangeEachExpr WhSp* ")");
ComprOp                 := ComprOpNoEach | ComprOpEach;
ComprOpEach             := "~each";
ComprOpNoEach           := "~map" | "~filter" | "~fold" | "~foldR" | "~chain" | "~bind" | "~flatMap" | "~ap" | "~foldMap" | "~<";
ComprIterationExpr      := BlockExpr | ComprIterNoBlockExpr;
ComprIterNoBlockExpr    := ComprExpr | IdentifierExpr | CallExpr | ExprAccessExpr |("(" WhSp* ComprIterNoBlockExpr WhSp* ")");

DoComprExpr             := (Identifier | BuiltIn) WhSp+ "~<<" WhSp* DoBlockExpr;
DoBlockExpr             := DoBlockDefsInitOpt? WhSp* DoBareBlockExpr;
DoBareBlockExpr         := "{" WhSp* (DoStmtSemi WhSp*)* (DoStmtSemiOpt | DoFinalUnwrapExpr)? WhSp* "}";
DoBlockDefsInitOpt      := "(" WhSp* DoVarDefInitOptList WhSp* ")";
DoVarDefInitOptList     := ("," WhSp*)* (DoVarDefInitOpt (WhSp* "," WhSp* DoVarDefInitOpt?)*)?;
DoVarDefInitOpt         := (Identifier (WhSp* ("::" | ":") WhSp* ExprNoBlock)?) | DestructureTarget;
DoDefVarStmt            := "def" WhSp+ (Identifier | DestructureTarget) WhSp* "::" WhSp* Expr;
DoStmtSemi              := DoStmt? (WhSp* ";")+;
DoStmt                  := Stmt | DoDefVarStmt;
DoStmtSemiOpt           := DoStmt? (WhSp* ";")*;
DoFinalUnwrapExpr       := "::" ExprNoBlock (WhSp* ";")*;


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
EscNum                  := "-"? EscNumDigits ("." EscNumDigits)?;
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

PositiveIntLit          := Base10Digit+ | (Esc EscNumDigits) (HexEsc HexDigit+) | (OctalEsc OctalDigit+) | (BinaryEsc BinaryDigit+);


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
RecordTupleValue        := Empty | Boolean | NumberLit | StrLit | DataStructLit | IdentifierExpr | LispCallExpr | ("(" WhSp* RecordTupleValue WhSp* ")");
PickValue               := "&" IdentifierExpr;
RecordProperty          := (":" PropertyExpr) | ((("%" ("#" | Identifier)) | PropertyExpr) WhSp* ":" WhSp* RecordTupleValue);
PropertyExpr            := Identifier | PositiveIntLit;
SetLit                  := "<[" WhSp* SetEntryList WhSp* "]>";
SetEntryList            := ("," WhSp*)* (SetEntry (WhSp* "," WhSp* SetEntry?)*)?;
SetEntry                := RecordTupleValue | PickValue;


(*************** Functions ***************)

DefFuncExpr             := "defn" (WhSp+ Identifier "@"?)? WhSp* ("(" WhSp* (ParameterList | GatherParameter)? WhSp* ")")+ FuncMeta? WhSp* FuncBody;
ParameterList           := VarDefInitOpt (WhSp* "," WhSp* VarDefInitOpt)*;
GatherParameter         := "*" Identifier;
FuncMeta                := (WhSp* FuncPrecondList (WhSp+ FuncOverClause)? (WhSp+ FuncAsClause)?) | (WhSp* FuncOverClause WhSp+ FuncAsClause) | (WhSp* FuncPrecondList) | (WhSp+ FuncOverClause) | (WhSp+ FuncAsClause);
FuncPrecondList         := FuncPrecond (WhSp+ FuncPrecond)*;
FuncPrecond             := CondClause ":" WhSp* ExprNoBlock;
FuncOverClause          := ":over" WhSp* "(" WhSp* Identifier (WhSp* "," WhSp* Identifier)* WhSp* ")";
FuncAsClause            := ":as" WhSp+ Identifier;
FuncBody                := ("^" WhSp* ExprNoBlock) | PipelineTargetExpr | FuncBodyBlock;
FuncBodyBlock           := "{" WhSp* (FuncBodyStmtSemi WhSp*)* FuncBodyStmtSemiOpt? WhSp* "}";
FuncBodyStmtSemi        := FuncBodyStmt (WhSp* ";")+;
FuncBodyStmtSemiOpt     := FuncBodyStmt (WhSp* ";")*;
FuncBodyStmt            := Stmt | ("^" WhSp* Expr);


(*************** Function Calls ***************)

CallExpr                := InfixCallExpr | LispCallExpr | ("(" WhSp* CallExpr WhSp* ")");
InfixCallExpr           := ExprNoBlock WhSp* "(" WhSp* InfixArgList? WhSp* ")";
InfixArgList            := ("," WhSp*)* (ExprNoBlock (WhSp* "," WhSp* ExprNoBlock?)*)?;
LispCallExpr            := "|" WhSp* (("'"? ExprNoBlock (WhSp+ LispArgList)?) | ((("'"? Op) | DotBracketExpr | DotAngleExpr)) WhSp+ LispArgList) WhSp* "|";
LispArgList             := ("," WhSp*)* (LispArgExpr (WhSp* "," WhSp* LispArgExpr?)*)?;
LispArgExpr             := ExprNoBlock | NamedArgExpr;
NamedArgExpr            := ((":" Identifier) | (Identifier WhSp* ":" WhSp* ExprNoBlock)) | ("(" WhSp* NamedArgExpr WhSp* ")");


(*************** Types ***************)
(* TODO: finish these *)

DefTypeStmt             := "deft" WhSp+ Identifier WhSp+ #"[^;]+" WhSp*;


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

def (x: 2, y: empty) { f(x.2); };

def < x : y.2, #obj, :w.4 >: obj;

def f: defn(*x)^x.[1..];

defn add(x)(y,<:z>)
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
        ?[y]: (v, <:z>) { fn(g); }
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

1..3 ~each log;
?[x] ~each (x,y:2) { x };
foo ~map ![x] ~each foo;
x . y [3].[1..3] .<a,b,> ~filter { y };

x #> (y(#.y,2) #> z);

defn myFn(x) #> f(#..3);

2..4 #> { f(#.0) };

List ~<< {
    def x:: getSomething();
    def y: uppercase(x);
    def z:: another(y);
    z.0
};

IO ~<< (x:: getSomething()) {
    def y: uppercase(x);
    def z:: another(y);
    ::prepareValue(z);
};
```

## License

[![License](https://img.shields.io/badge/license-MIT-a1356a)](LICENSE.txt)

All code and documentation are (c) 2022 Kyle Simpson and released under the [MIT License](http://getify.mit-license.org/). A copy of the MIT License [is also included](LICENSE.txt).
