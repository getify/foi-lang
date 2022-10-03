# Foi Language AST Specification
## Program
A Foi Language Program consists of a body and comments.
```javascript
{
  "type": "Program",
  "body": [],
}
```
### Comments
Single line comments are written as
```javascript
// hello
```
`AST`.  
```javascript
"leadingComments": [
    {
        "type": "Line",
        "value": " hello",
        "range": [
        0,
        8
        ]
    }
]
```
### Variables
**Variable Declaration:**
```javascript
def x: empty;
```
`AST`.
```
type: "VariableDeclaration",
"start": 0,
"end": 13,
"declarations": [
    {
        "type": "VariableDeclarator",
        "start": 4,
        "end": 12,
        "id": {
          "type": "Identifier",
          "start": 4,
          "end": 5,
          "name": "x"
        },
        "init": {
            "type": "Literal",
            "start": 7,
            "end": 12,
            "value": null,
            "raw": "empty"
        }
    }
]
```
**Variable Reassignment:**
```javascript
x <: 1;
```
`AST`.
```
{
    "type": "ExpressionStatement",
    "start": 17,
    "end": 25,
    "id": {
        "type": "BinaryCallExpression",
        "start": 4,
        "end": 5,
        "callee": {
            "type": "Identifier",
            "start": 2,
            "end": 3,
            "name": "<:"
        },
        "arguments": [
            {
                "type": "Identifier",
                "start": 0,
                "end": 0,
                "name": "x"
            },
            {
                "type": "Literal",
                "start": 5,
                "end": 5,
                "value": 1,
                "raw": "1"
            }
        ]
    },
    "value": {
        "type": "Literal",
        "start": 11,
        "end": 15,
        "value": 1,
        "raw": "1"
    }
}
```