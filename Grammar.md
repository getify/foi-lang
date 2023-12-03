# Foi Grammar

The **Foi** language grammar in [EBNF form](https://en.wikipedia.org/wiki/Extended_Backus%E2%80%93Naur_form), as [verified here](https://mdkrajnak.github.io/ebnftest/).

You can also use this grammar to validate code using the [Online Foi-Toy web tool](https://toy.foi-lang.com) or the [Foi-Toy CLI tool](foi-toy/README.md).

```ebnf
(*************** Program / Statements ***************)

Program                 := WhSp* ((StmtSemi | ExportStmtSemi) WhSp*)* (StmtSemiOpt | ExportStmtSemiOpt)? WhSp*;

Stmt                    := DefVarStmt | DefBlockStmt | DefTypeStmt | ExprAsOpt;
StmtSemi                := Stmt? (WhSp* ";")+;
StmtSemiOpt             := Stmt? (WhSp* ";")*;
ExportStmtSemi          := ExportExpr (WhSp* ";")+;
ExportStmtSemiOpt       := ExportExpr (WhSp* ";")*;


(*************** Whitespace ***************)

WhSp                    := Whitespace | Comment;
Whitespace              := #"[\s]+" | (*u0085*) "" | (*u180e*) "᠎" | (*u200b*) "​" | (*u200c*) "‍" | (*u200d*) "‌" | (*u200e*) "‎" | (*u200f*) "‏";
Comment                 := LineComment | BlockComment;
LineComment             := "//" #"[^\n/][^\n]*"? &("\n" | Epsilon);
BlockComment            := "///" #"[^]*?///";


(*************** Core Syntax ***************)

Op                      := ComprOpNamed | NamedBoolOp | SymbolicBoolOp | SymbolicOp;
NamedBoolOp             := #"[?!](?:empty|has|and|in|as|or)";
SymbolicBoolOp          := "?<=>" | "!<=>" | #"[?!](?:>=|<=|<>|\$=)" | #"[?!][=<>]";
SymbolicOp              := "~<<" | "~<*" | "..." | ".." | "+>" | "<+" | "#>" | "~<" | "$+" | #"[+\-*/?!.']";

ReservedWord            := Empty | Boolean | NamedKeywordNoEmpty | NativeTypeNoEmpty | BuiltIn;
Empty                   := "empty";
Boolean                 := "true" | "false";
Keyword                 := NamedKeywordNoEmpty | ":as" | ":over";
NamedKeywordNoEmpty     := "def" | "defn" | "deft" | "import" | "export";
NativeType              := Empty | NativeTypeNoEmpty;
NativeTypeNoEmpty       := "int" | "integer" | "float" | "bool" | "boolean" | "str" | "string";
BuiltIn                 := "Id" | "None" | "Maybe" | "Left" | "Right" | "Either" | "Promise" | "PromiseSubject" | "PushStream" | "PushSubject" | "PullStream" | "PullSubject" | "Channel" | "Gen" | "IO" | "Value" | "Number" | "List";


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

PositiveIntLit          := Base10Digit+ | (Esc EscNumDigits) | (HexEsc HexDigit+) | (OctalEsc OctalDigit+) | (BinaryEsc BinaryDigit+);


(*************** String Literals ***************)

StrLit                  := PlainStr | SpacingStr | InterpStr | InterpSpacingStr;

InterpEsc               := "`";
InterpSpacingEsc        := Esc InterpEsc;

PlainStr                := '"' (#'[^"]' | '""')* '"';
SpacingStr              := Esc PlainStr;
InterpStr               := InterpEsc InterpLit;
InterpSpacingStr        := InterpSpacingEsc InterpLit;
InterpLit               := '"' (#'[^"`]' | '""' | "`" WhSp* InterpExprAsOpt? WhSp* "`")* '"';
InterpExprAsOpt         := !('`"') ExprAsOpt;

(* NOTE: the above `InterpExprAsOpt` production has a negative-lookahead *)
(* to avoid a grammar ambiguity with nested interpolated-strings.        *)


(*************** Data Structures ***************)

DataStructLit           := RecordTupleLit | SetLit;
RecordTupleLit          := "<" WhSp* RecordTupleEntryList WhSp* ">";
RecordTupleEntryList    := ("," WhSp*)* (RecordTupleEntry (WhSp* "," WhSp* RecordTupleEntry?)*)?;
RecordTupleEntry        := RecordTupleValue | PickValue | RecordProperty;
RecordTupleValue        := Empty | Boolean | NumberLit | StrLit | DataStructLit | IdentifierExpr | CallExpr | ("(" WhSp* RecordTupleValue WhSp* ")");
PickValue               := "&" IdentifierExpr;
RecordProperty          := (":" PropertyExpr) | ((("%" ("#" | IdentifierExpr | StrLit)) | PropertyExpr) WhSp* ":" WhSp* RecordTupleValue);
PropertyExpr            := Identifier | PositiveIntLit;
SetLit                  := "<[" WhSp* SetEntryList WhSp* "]>";
SetEntryList            := ("," WhSp*)* (SetEntry (WhSp* "," WhSp* SetEntry?)*)?;
SetEntry                := RecordTupleValue | PickValue;


(*************** Misc Expressions ***************)

Expr                    := ExprNoBlock | BlockExpr | ComprExpr | DoComprExpr | DoLoopComprExpr | GroupedExpr;
GroupedExpr             := "(" WhSp* Expr WhSp* ")";
ExprNoBlock             := OperandExpr | DefFuncExpr | AssignmentExpr | GuardedExpr | MatchExpr | ExprAccessExpr | GroupedExprNoBlock;
GroupedExprNoBlock      := "(" WhSp* ExprNoBlock WhSp* ")";
OperandExpr             := BareOperandExpr | UnaryExpr | BinaryExpr | GroupedOperandExpr;
GroupedOperandExpr      := "(" WhSp* OperandExpr WhSp* ")";
BareOperandExpr         := Empty | BareOperandExprNoEmpty | GroupedBareOperandExpr;
GroupedBareOperandExpr  := "(" WhSp* BareOperandExpr WhSp* ")";
BareOperandExprNoEmpty  := Boolean | NumberLit | StrLit | DataStructLit | ClosedRangeExpr | IdentifierExpr | OpFuncExpr | CallExpr | GroupedBareOpExprNoEmp;
GroupedBareOpExprNoEmp  := "(" WhSp* BareOperandExprNoEmpty WhSp* ")";

ExprAsOpt               := Expr | ExprNoBlockAsOpt | ((BlockExpr | GroupedExpr | ("(" WhSp* (ComprExpr | DoComprExpr | DoLoopComprExpr) WhSp* ")")) WhSp* AsAnnotationExpr) | GroupedExprAsOpt;
GroupedExprAsOpt        := "(" WhSp* ExprAsOpt WhSp* ")";
ExprNoBlockAsOpt        := ExprNoBlock | OperandExprAsOpt | ("(" WhSp* (GuardedExpr | MatchExpr | ExprAccessExpr) WhSp* ")" WhSp* AsAnnotationExpr) | GroupedExprNoBlockAsOpt;
GroupedExprNoBlockAsOpt := "(" WhSp* ExprNoBlockAsOpt WhSp* ")";
OperandExprAsOpt        := OperandExpr | BareOperandExprAsOpt | ((UnaryExpr | BinaryExpr) WhSp+ AsAnnotationExpr) | ("(" WhSp* (UnaryExpr | BinaryExpr) WhSp* ")" WhSp* AsAnnotationExpr) | GroupedOperandExprAsOpt;
GroupedOperandExprAsOpt := "(" WhSp* OperandExprAsOpt WhSp* ")";
BareOperandExprAsOpt    := BareOperandExpr | BareOpExprNoEmptyAsOpt | (BareOperandExpr WhSp+ AsAnnotationExpr) | ("(" WhSp* BareOperandExpr WhSp* ")" WhSp* AsAnnotationExpr) | GroupedBareOprExprAsOpt;
GroupedBareOprExprAsOpt := "(" WhSp* BareOperandExprAsOpt WhSp* ")";
BareOpExprNoEmptyAsOpt  := BareOperandExprNoEmpty | (BareOperandExprNoEmpty WhSp+ AsAnnotationExpr) | ("(" WhSp* BareOperandExprNoEmpty WhSp* ")" WhSp* AsAnnotationExpr) | GrpBareOpExprNoEmpAsOpt;
GrpBareOpExprNoEmpAsOpt := "(" WhSp* BareOpExprNoEmptyAsOpt WhSp* ")";

ExprNoBlockGroupedAsOpt := ExprNoBlock | GroupedExprNoBlockAsOpt;

AsAnnotationExpr        := ":as" WhSp+ NamedType;

OpFuncExpr              := "(" Op "'"? ")";

ExprAccessExpr          := (ExprNoBlock | GroupedExprAsOpt) (SingleAccessExpr | MultiAccessExpr);
AssignmentExpr          := (Identifier | IdentifierSingleExpr) WhSp* ":=" WhSp* ExprAsOpt;

UnaryExpr               := SymbolicUnaryExpr | NamedUnaryExpr | GroupedUnaryExpr;
GroupedUnaryExpr        := "(" WhSp* UnaryExpr WhSp* ")";
SymbolicUnaryExpr       := (("?" | "!") (BareOperandExprNoEmpty | BareOpExprNoEmptyAsOpt | GroupedExprAsOpt)) | (("?" | "!") WhSp+ (OperandExpr | GroupedExprAsOpt)) | ((BareOperandExpr | GroupedExprAsOpt) "'");
NamedUnaryExpr          := (("?empty" | "!empty") GroupedExprAsOpt) | (("?empty" | "!empty") WhSp+ (OperandExpr | GroupedExprAsOpt));

BinaryExpr              := SymbolicBinaryExpr | NamedBoolBinaryExpr | GroupedBinaryExpr;
GroupedBinaryExpr       := "(" WhSp* BinaryExpr WhSp* ")";
SymbolicBinaryExpr      := (OperandExpr | OperandExprAsOpt | GroupedExprAsOpt) WhSp* SymbolicRightExpr;
SymbolicRightExpr       := (("$+" | "<+" | "+>" | #"[+\-*/]") WhSp* (OperandExpr | OperandExprAsOpt | GroupedExprAsOpt)) | SymbolicBoolRightExpr | PipelineRightExpr;
SymbolicBoolRightExpr   := SymbolicBoolOp WhSp* (OperandExpr | GroupedExprAsOpt);
NamedBoolBinaryExpr     := (GroupedExprAsOpt NamedBoolRightExpr) | ((OperandExpr | GroupedExprAsOpt) WhSp+ NamedBoolRightExpr);
NamedBoolRightExpr      := (NamedBoolOp GroupedExprAsOpt) | (NamedBoolOp WhSp+ (OperandExpr | GroupedExprAsOpt)) | (("?" | "!") "as" WhSp* NativeType);
PipelineRightExpr       := "#>" WhSp* (OperandExpr | BlockExpr | GroupedExprAsOpt);

ImportExpr              := "import" WhSp+ PlainStr;
ExportExpr              := "export" WhSp+ "{" WhSp* ExportBindingsList WhSp* "}";
ExportBindingsList      := ExportBinding (WhSp* "," WhSp* ExportBinding)* (WhSp* ",")?;
ExportBinding           := ExportNamedBinding | ExportConciseBinding;
ExportNamedBinding      := Identifier WhSp* ":"  WhSp* Identifier MultiAccessExpr?;
ExportConciseBinding    := ":" Identifier SingleAccessExpr?;


(*************** Identifier / Access / Range Expressions ***************)

Identifier              := (#"(?!(?:[0-9]+|~each|~map|~filter|~fold|~foldR|~cata|~chain|~bind|~flatMap|~ap|~foldMap)\b)[a-zA-Z0-9_~]+(?<!\b(?:def|defn|deft|import|export|empty|true|false|int|integer|float|bool|boolean|str|string|Id|None|Maybe|Left|Right|Either|Promise|PromiseSubject|PushStream|PushSubject|PullStream|PullSubject|Channel|Gen|IO|Value|Number|List))") | #"[0-9]+~" | (ComprOpNamed #"[a-zA-Z0-9_~]"+) | (#"[a-zA-Z0-9_~]"+ ReservedWord);

IdentifierExpr          := "#" | "@" | Identifier | BuiltIn | IdentifierSingleExpr | IdentifierMultiExpr | AtExpr;
IdentifierSingleExpr    := ("#" | Identifier | BuiltIn) SingleAccessExpr;
IdentifierMultiExpr     := ("#" | Identifier | BuiltIn) MultiAccessExpr;
AtExpr                  := (Identifier | BuiltIn | IdentifierSingleExpr) "@";

SingleAccessExpr        := (WhSp* (DotSingleIdentifier | BracketExpr))+;
MultiAccessExpr         := (WhSp* (DotMultiIdentifier | BracketExpr | DotBracketExpr | DotAngleExpr))+;

DotSingleIdentifier     := "." WhSp* (("-"? Base10Digit+) | Identifier | BuiltIn | IdentifierSingleExpr);
DotMultiIdentifier      := "." WhSp* (Base10Digit+ | Identifier | BuiltIn | IdentifierMultiExpr);
BracketExpr             := "[" WhSp* ExprNoBlockAsOpt WhSp* "]";

DotBracketExpr          := ".[" WhSp* RangeExpr WhSp* "]";
RangeExpr               := (ClosedRangeExpr | LeadingRangeExpr | TrailingRangeExpr);
ClosedRangeExpr         := (ExprNoBlock | GroupedExprAsOpt) ".." (ExprNoBlock | GroupedExprAsOpt);
LeadingRangeExpr        := (ExprNoBlock | GroupedExprAsOpt) "..";
TrailingRangeExpr       := ".." (ExprNoBlock | GroupedExprAsOpt);

DotAngleExpr            := ".<" WhSp* AnglePropertyList WhSp* ">";
AnglePropertyList       := PropertyExpr (WhSp* "," WhSp* PropertyExpr)* (WhSp* ",")?;


(*************** Variable Definitions / Destructuring / Blocks ***************)

DefVarStmt              := "def" WhSp+ (Identifier | DestructureTarget) WhSp* ":" WhSp* (ExprAsOpt | ImportExpr);

DestructureTarget       := "<" WhSp* DestructureDefList WhSp* ">";
DestructureDefList      := DestructureDef (WhSp* "," WhSp* DestructureDef)* (WhSp* ",")?;
DestructureDef          := DestructureNamedDef | DestructureConciseDef | DestructureCapture;
DestructureNamedDef     := Identifier WhSp* ":"  WhSp* (Identifier | BracketExpr) MultiAccessExpr?;
DestructureConciseDef   := ":" Identifier SingleAccessExpr?;
DestructureCapture      := "#" Identifier;

DefBlockStmt            := "def" WhSp* BlockExprVarDef;

BlockExprVarDef         := BlockDefsInit WhSp* BareBlockExpr;
BlockExpr               := BlockDefsInitOpt? WhSp* BareBlockExpr;
BareBlockExpr           := "{" WhSp* (StmtSemi WhSp*)* StmtSemiOpt? WhSp* "}";
BlockDefsInit           := "(" WhSp* VarDefInitList WhSp* ")";
VarDefInitList          := VarDefInit (WhSp* "," WhSp* VarDefInit)* (WhSp* ",")?;
VarDefInit              := Identifier WhSp* ":" WhSp* ExprNoBlockAsOpt;
BlockDefsInitOpt        := "(" WhSp* VarDefInitOptList WhSp* ")";
VarDefInitOptList       := ("," WhSp*)* (VarDefInitOpt (WhSp* "," WhSp* VarDefInitOpt?)*)?;
VarDefInitOpt           := (Identifier (WhSp* ":" WhSp* ExprNoBlockAsOpt)?) | DestructureTarget;


(*************** Decision Making: Guard, Pattern Matching ***************)

CondClause              := ("?" | "!") BracketExpr;
GuardedExpr             := CondClause ":" WhSp* ExprAsOpt;

MatchExpr               := IndepMatchExpr | DepMatchExpr;
IndepMatchExpr          := "?{" WhSp* IndepPatternStmts WhSp* "}";
IndepPatternStmts       := IndepPatternStmtNoSemi | ((IndepPatternStmt WhSp*)+ (ElseStmt | IndepPatternStmtNoSemi)?) | ElseStmt;
IndepPatternStmtNoSemi  := IndepCondClause MatchConsequentNoSemi;
IndepPatternStmt        := IndepCondClause MatchConsequent (WhSp* ";")*;
IndepCondClause         := ("?" | "!" | Epsilon) BracketExpr;
MatchConsequentNoSemi   := ":" WhSp* ExprAsOpt | BlockExpr;
MatchConsequent         := ":" WhSp* ((ExprAsOpt WhSp* ";") | BlockExpr);
ElseStmt                := "?"? MatchConsequentNoSemi (WhSp* ";")*;
DepMatchExpr            := "?(" WhSp* ExprNoBlockAsOpt WhSp* "){" WhSp* DepPatternStmts WhSp* "}";
DepPatternStmts         := DepPatternStmtNoSemi | ((DepPatternStmt WhSp*)+ (ElseStmt | DepPatternStmtNoSemi)?) | ElseStmt;
DepPatternStmtNoSemi    := DepCondClause MatchConsequentNoSemi;
DepPatternStmt          := DepCondClause MatchConsequent (WhSp* ";")*;
DepCondClause           := ("?" | "!" | Epsilon) "[" WhSp* DepCondExprList WhSp* "]";
DepCondExprList         := (ExprNoBlockGroupedAsOpt | DepCondBinaryBoolExpr) (WhSp* "," WhSp* (ExprNoBlockGroupedAsOpt | DepCondBinaryBoolExpr))* (WhSp* ",")?;
DepCondBinaryBoolExpr   := NamedBoolRightExpr | SymbolicBoolRightExpr | ("(" WhSp* DepCondBinaryBoolExpr WhSp* ")");


(*************** Loops/Comprehensions ***************)

ComprExpr               := (((ComprRangeNoEachExpr WhSp+ ComprOpNoEach) | (ComprRangeEachExpr WhSp+ ComprOpEach) | (ComprExpr WhSp+ ComprOp)) WhSp+ ComprIterationExpr) | ("(" WhSp* ComprExpr WhSp* ")");
ComprRangeNoEachExpr    := IdentifierExpr | CallExpr | DataStructLit | ClosedRangeExpr | ExprAccessExpr | DoComprExpr | DoLoopComprExpr | ("(" WhSp* ComprRangeNoEachExpr WhSp* ")");
ComprRangeEachExpr      := CondClause | ComprRangeNoEachExpr | ("(" WhSp* ComprRangeEachExpr WhSp* ")");
ComprOp                 := ComprOpNoEach | ComprOpEach;
ComprOpNamed            := ComprOpEach | ComprOpNamedNoEach;
ComprOpEach             := "~each";
ComprOpNoEach           := ComprOpNamedNoEach | "~<";
ComprOpNamedNoEach      := "~map" | "~filter" | "~fold" | "~foldR" | "~cata" | "~chain" | "~bind" | "~flatMap" | "~ap" | "~foldMap";
ComprIterationExpr      := BlockExpr | ComprIterNoBlockExpr | GroupedExprAsOpt;
ComprIterNoBlockExpr    := ComprExpr | IdentifierExpr | CallExpr | ExprAccessExpr | ("(" WhSp* ComprIterNoBlockExpr WhSp* ")");

DoComprExpr             := (Identifier | BuiltIn) WhSp+ "~<<" WhSp* DoBlockExpr;
DoBlockExpr             := DoBlockDefsInitOpt? WhSp* DoBareBlockExpr;
DoBareBlockExpr         := "{" WhSp* (DoStmtSemi WhSp*)* (DoStmtSemiOpt | DoFinalUnwrapExpr)? WhSp* "}";
DoBlockDefsInitOpt      := "(" WhSp* DoVarDefInitOptList WhSp* ")";
DoVarDefInitOptList     := ("," WhSp*)* (DoVarDefInitOpt (WhSp* "," WhSp* DoVarDefInitOpt?)*)?;
DoVarDefInitOpt         := (Identifier (WhSp* ("::" | ":") WhSp* ExprNoBlockAsOpt)?) | DestructureTarget;
DoDefVarStmt            := "def" WhSp+ (Identifier | DestructureTarget) WhSp* "::" WhSp* ExprAsOpt;
DoStmtSemi              := DoStmt? (WhSp* ";")+;
DoStmt                  := Stmt | DoDefVarStmt;
DoStmtSemiOpt           := DoStmt? (WhSp* ";")*;
DoFinalUnwrapExpr       := "::" ExprNoBlockAsOpt (WhSp* ";")*;

DoLoopComprExpr         := ((DoLoopComprRangeExpr WhSp+) | ("(" WhSp* DoLoopComprRangeExpr WhSp* ")")) "~<*" WhSp DoLoopIterationExpr;
DoLoopComprRangeExpr    := ComprRangeNoEachExpr | ComprExpr;
DoLoopIterationExpr     := DoBlockExpr | DoLoopIterNoBlockExpr;
DoLoopIterNoBlockExpr   := IdentifierExpr | CallExpr | ExprAccessExpr | ("(" WhSp* DoLoopIterNoBlockExpr WhSp* ")");


(*************** Functions ***************)

DefFuncExpr             := "defn" (WhSp+ Identifier "@"?)? WhSp* ("(" WhSp* (ParameterList | GatherParameter)? WhSp* ")")+ FuncMeta? WhSp* FuncBody;
ParameterList           := VarDefInitOpt (WhSp* "," WhSp* VarDefInitOpt)*;
GatherParameter         := "*" Identifier;
FuncMeta                := (WhSp* FuncPrecondList (WhSp+ FuncOverClause)? (WhSp+ FuncAsClause)?) | (WhSp* FuncOverClause WhSp+ FuncAsClause) | (WhSp* FuncPrecondList) | (WhSp+ FuncOverClause) | (WhSp+ FuncAsClause);
FuncPrecondList         := FuncPrecond (WhSp+ FuncPrecond)*;
FuncPrecond             := CondClause ":" WhSp* ExprNoBlockGroupedAsOpt;
FuncOverClause          := ":over" WhSp* "(" WhSp* Identifier (WhSp* "," WhSp* Identifier)* WhSp* ")";
FuncAsClause            := ":as" WhSp+ Identifier;
FuncBody                := ("^" WhSp* (ExprNoBlock | GroupedExprAsOpt)) | PipelineRightExpr | FuncBodyBlock;
FuncBodyBlock           := "{" WhSp* (FuncBodyStmtSemi WhSp*)* FuncBodyStmtSemiOpt? WhSp* "}";
FuncBodyStmtSemi        := FuncBodyStmt (WhSp* ";")+;
FuncBodyStmtSemiOpt     := FuncBodyStmt (WhSp* ";")*;
FuncBodyStmt            := Stmt | ("^" WhSp* ExprAsOpt);


(*************** Function Calls ***************)

CallExpr                := PrefixCallExpr | PartialCallExpr | AtCallExpr;
PrefixCallExpr          := ExprNoBlockGroupedAsOpt WhSp* "(" CallArgs ")";
PartialCallExpr         := ExprNoBlockGroupedAsOpt WhSp* "|" CallArgs "|";
CallArgs                := (WhSp* CallArgList? WhSp*) | (Op "'"?);
CallArgList             := ("," WhSp*)* (CallArgExpr (WhSp* "," WhSp* CallArgExpr?)*)?;
CallArgExpr             := ExprAsOpt | NamedArgExpr | (("..." WhSp*)? CallArgExpr);
NamedArgExpr            := ((":" Identifier) | (Identifier WhSp* ":" WhSp* ExprAsOpt)) | ("(" WhSp* NamedArgExpr WhSp* ")");
AtCallExpr              := "None@" | (("@" | AtExpr | ((Identifier | BuiltIn | IdentifierSingleExpr) WhSp+ "@")) WhSp* ExprNoBlockGroupedAsOpt);


(*************** Types ***************)

DefTypeStmt             := "deft" WhSp+ Identifier ((WhSp+ NoFuncType) | (WhSp* FuncType)) WhSp*;

NoFuncType              := UnionType | NoUnionType;
UnionType               := NoUnionType (WhSp* "|" WhSp* NoUnionType)+;
NoUnionType             := SimpleType | DataStructType | NestedType | GroupedType;
SimpleType              := NamedType | PlainStr | SpacingStr | NumberLit | Boolean;
NamedType               := ((Identifier | BuiltIn) ("." (Identifier | BuiltIn))*) | NativeType;
NestedType              := NamedType WhSp* GroupedType;
GroupedType             := "{" WhSp* (NoUnionType | (UnionType (WhSp* "|")?) | FuncType) WhSp* "}";

DataStructType          := "<" WhSp* DataStructTypeList? WhSp* ("," WhSp*)? ">";
DataStructTypeList      := DataStructFinalValType | ((DataStructValueType | DataStructFieldType) (WhSp* "," WhSp* (DataStructValueType | DataStructFieldType))* (WhSp* "," WhSp* DataStructFinalValType)?);
DataStructValueType     := NoFuncType | GroupedType;
DataStructFinalValType  := "*" NoUnionType;
DataStructFieldType     := Identifier WhSp* ":" WhSp* DataStructValueType;

FuncType                := "(" WhSp* FuncTypeArgList? WhSp* ("," WhSp*)? ")" WhSp* "^" WhSp* "?"? NoUnionType;
FuncTypeArgList         := FuncTypeFinalArg | (FuncTypeArg (WhSp* "," WhSp* FuncTypeArg)* (WhSp* "," WhSp* FuncTypeFinalArg)?);
FuncTypeArg             := "?"? NoUnionType;
FuncTypeFinalArg        := FuncTypeArg | ("*" NoUnionType);
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
def 123a: empty;
def a123: empty;
def 123~: empty;
def ~123: empty;
def Value~: empty;
def ~Value: empty;
def empty~: empty;
def ~empty: empty;
def int~: empty;
def ~int: empty;
def ~eachA: empty;
def ~each~: empty;
def a~each: empty;

defn 123a() ^empty;
defn a123() ^empty;
defn 123~() ^empty;
defn ~123() ^empty;
defn Value~() ^empty;
defn ~Value() ^empty;
defn empty~() ^empty;
defn ~empty() ^empty;
defn int~() ^empty;
defn ~int() ^empty;
defn ~eachA() ^empty;
defn ~each~() ^empty;
defn a~each() ^empty;
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
\`"A single line (with
   whitespace collapsing), and a single `` backtick";
`"Special number: `-3.1415962`
   Name: `name`
   Greeting: `\`"Hello world"`
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
    yes: empty, fn(1),
    %x.y.z: false,
    %"Hello World": 2,
    %\`" this
    is `adverb` ""crazy""!": 42,
    %bar:<1>,,
>;
<[]>;
<[ 1, 2, 2 ]>;
```

```java
2+3+4;
2 + 3 + 4;
(2 + 3) + 4;
2 + (3 + 4);
x + y + true;
?x;
? x;
?(x);
!x;
! x;
!(x);
x ?and y !and z;
(x ?and !y) !or (z / 2);
(x ?and !y)!or(z/2);
?empty y;
?x;
x ?in y;
x?>y;
x ?> y;
x ?= y;
x != y;
x ?$= y;
x !$= y;
```

```java
def cb: defn(x)^x;

def (x: 2, y: empty) { f(x.2,x.-1); };

def < x : y.2, #obj, :w.4, z: [i+1], >: obj;

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
        [w]: w;
        ![x]: { fn(g) };
        ?[y]: (v, <:z>) { fn(g); }
        ?: 42
    };
    ?( fn(g) ){
        [?> y]: g;
        ?[ x, z . y [3] ]: g
    };
    ?{ ?[x]: x };
    ?(x){ ?[x]: x };
    ?{ ?[x]: x; ?[y]: y };
    ?(x){ ?[x]: x; ?[y]: y };
    ?[z]: (g: z) { fn(g) };
    x.[y..z];
    y.<first,last>;
    (+)(1,2,3,...nums);
    (+')'(1,,3);
    (')(+)(1,,3);
    myFn|2,,3|;
    myFn(3,x:2);
    myFn'|3,x:2|;
    ^42
};

1..3 ~each log;
?[x] ~each (x,y:2) { x };
foo ~map ![x] ~each foo;
x . y [3].[1..3] .<a,b,> ~filter { y };

x #> (y(#.y,2) #> z);

def cb1: f(2) +> g +> h(3)(4);
def cb2: f(2) <+ g <+ h(3)(4);
def cb3: f +> (defn(v) ^v) +> g;

defn myFn(x) #> f(#..3);

2..4 #> { f(#.0) };
```

```java
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

Promise ~<* {
    def respE:: getSomething();
    Either ~<< (resp:: respE) {
        printResp(resp);
    };
};
urls ~map fetch ~<* (resp) {
    def v:: processResp(resp);
    def success:: storeVal(v);
    ?[success]: log(v);
};
```

```java
f(@);
f(@2);
f(@ 2);
f(@(2));
f(@ (2));

f(Id@);
f(Id@2);
f(Id @2);
f(Id@ 2);
f(Id @ 2);
f(Id@(2));
f(Id@ (2));
f(Id @ (2));

f(Either.Right@);
f(Either.Right@2);
f(Either.Right @2);
f(Either.Right@ 2);
f(Either.Right @ 2);
f(Either.Right@(2));
f(Either.Right@ (2));
f(Either.Right @ (2));
```

```java
(*)(getQty(order,item), getPrice(item)) :as float;
?3 :as bool;
?(3) :as bool;
?(3):as bool;
3 * 2 :as int;
3 * (2 :as int);
(3 * 2) :as int;
(3 * 2):as int;
3 ?as bool;
(?(x){
    ?[?as int]: f(#) :as bool;
    ?: # :as bool
}):as bool;
```

```java
deft F (?X) ^G;
deft X(Y,Z) ^empty;
deft Y(_) ^Either;
deft Z() ^Either;
deft W <
    a: Q,
    b: S | int,
    c: U | {(*string) ^{bool|42}},
    d: < int, string, *bool, >,
    *< int, int >,
>;
deft Q(R) ^PushStream;
deft R(_) ^PushStream;
deft S(T) ^ PushStream;
deft T(*_)^ _;
deft U(int, string, *float) ^bool;
deft V Left | Right;
deft A { Left | Right };
deft B(str, *{(int)^int}) ^{"yes"|"no"};
```

```java
def x: import "X";
def < :log >: import "#Std";

export { :x, :y, z: zzz, };
```

## License

[![License](https://img.shields.io/badge/license-MIT-a1356a)](LICENSE.txt)

All code and documentation are (c) 2022-2023 Kyle Simpson and released under the [MIT License](http://getify.mit-license.org/). A copy of the MIT License [is also included](LICENSE.txt).
