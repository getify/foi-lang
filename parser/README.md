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
**Function calls**
```javascript
log("hello")
```
`AST`
```
{
  "type": "ExpressionStatement",
  "expression": {
    "type": "CallExpression",
    "callee": {
      "type": "Identifier",
      "name": "log"
    },
    "arguments": [
      {
        "type": "Literal",
        "value": "hello",
        "raw": "\"hello\""
      }
    ]
  }
}
```
**Function calls**
```javascript
| log "hello" |
```
`AST`
```
{
  "type": "ExpressionStatement",
  "expression": {
    "type": "EvalCallExpression",
    "callee": {
      "type": "Identifier",
      "name": "log"
    },
    "arguments": [
      {
        "type": "Literal",
        "value": "hello",
        "raw": "\"hello\""
      }
    ]
  }
}
```
```javascript
| log | + 2, 3 ||
```
```
{
      "type": "ExpressionStatement",
      "expression": {
        "type": "EvalCallExpression",
        "callee": {
          "type": "Identifier",
          "name": "log"
        },
        "arguments": [
          {
            "type": "EvalCallExpression",
            "callee": {
              "type": "Identifier",
              "name": "+"
            },
            "arguments": [
              {
                "type": "Literal",
                "value": 2,
                "raw": "2"
              },
              {
                "type": "Literal",
                "value": 3,
                "raw": "3"
              }
            ]
          }
        ]
      }
    }
```
**Reverse Function Call Order**
```javascript
| |'- | 1, 6 |
| '- 1, 6 |
```
```
{
  "type": "ExpressionStatement",
  "expression": {
    "type": "UnaryExpression",
    "operator": "'",
    "argument": {
        "type": "EvalCallExpression",
        "callee": {
          "type": "Identifier",
          "name": "-"
        },
        "arguments": [
          {
            "type": "Literal",
            "value": 1,
            "raw": "1"
          },
          {
            "type": "Literal",
            "value": 6,
            "raw": "6"
          }
        ]
    },
  }
}
```
**Partial Function Application**
```javascript
// where `+` has an arity of 2
| + 2 |
```
```
{
  "type": "ExpressionStatement",
  "expression": {
    "type": "PartialCallApplication",
    "callee": {
      "type": "Identifier",
      "name": "+"
    },
    "arguments": [
      {
        "type": "Literal",
        "value": 2,
        "raw": "2"
      }
    ]
  }
}
```
```javascript
| | + 2 | 2 | // 4
```
`AST`
```
{
  "type": "EvalCallExpression",
  "callee": {
    "type": "PartialCallApplication",
    "callee": {
      "type": "Identifier",
      "name": "+"
    },
    "arguments": [
      {
        "type": "Literal",
        "value": 2,
        "raw": "2"
      }
    ]
  },
  "arguments": [
    {
      "type": "Literal",
      "value": 2,
      "raw": "2"
    }
  ]
}
```