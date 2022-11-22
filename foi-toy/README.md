# Foi-Toy

This is an experimental tool for toying around with **Foi** code. It is **not** an official implementation of the **Foi** language.

## Status

Right now, all Foi-Toy does is tokenize a Foi file. All of this is subject to change at any time.

## To Use

Write **Foi** code and save it in a file (generally with a `.foi` filename extension, but you can use whatever you like).

Then invoke `node cli.js --file={FILE-PATH}` with a path to the file you want to check.

Foi-Toy will print out a list of tokens that were processed from the file.

## Tests

There are some test files provided in `./test/` that illustrate some of the syntactic edge cases for tokenizing **Foi** code, especially escaped number literals and escaped string literals (including interpolated string literals).

## License

[![License](https://img.shields.io/badge/license-MIT-a1356a)](LICENSE.txt)

All code and documentation are (c) 2022 Kyle Simpson and released under the [MIT License](http://getify.mit-license.org/). A copy of the MIT License [is also included](../LICENSE.txt).
