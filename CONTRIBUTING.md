# Contributing to cccomplete

**Who this is for:** people who want to change cccomplete, and people who want to know under what terms they may use or share it.

**What this document does not cover:** the rules for the code (see [CLAUDE.md](CLAUDE.md)), how the code is organised (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)) and how to use the plugin (see [README.md](README.md)).

## Licence

cccomplete is dual-licensed. You may use it under either licence, at your option:

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))
- MIT licence ([LICENSE-MIT](LICENSE-MIT))

The SPDX identifier is `MIT OR Apache-2.0`.

### The bundled dictionary

The English model in `data/english.tsv` is built from Tatoeba sentences offered under CC0 1.0, a public domain dedication; it carries no conditions. Its source and rebuild steps are in [docs/DICTIONARY.md](docs/DICTIONARY.md).

The word list in `data/dictionary.txt` is not covered by the licences above. It comes from SCOWL and has its own terms. The notice is in [data/LICENSE-SCOWL.txt](data/LICENSE-SCOWL.txt), and it must travel with any copy of the word list. The source, the changes made to it and the rebuild steps are in [docs/DICTIONARY.md](docs/DICTIONARY.md).

### Your contributions

Unless you state otherwise, any contribution you submit for inclusion in cccomplete is licensed as above, under both licences, with no extra terms.

Do not submit code or data that you do not have the right to license this way. If you add a third-party file, such as a word list, include its licence notice beside it and describe it in the pull request.

## Before you change the code

1. Read [CLAUDE.md](CLAUDE.md). Its rules are mandatory: the plain-TypeScript runtime, the latency budget, the type rules and the documentation rules.
2. Make the change, with tests that cover it.
3. Run all three checks. All must pass.

```bash
claude plugin test .          # runs the tests and prints the latency measurements
claude plugin validate .      # checks the manifest and the hooks module
tsc -p .                      # type-checks; load the plugin once first
```

`claude plugin validate .` warns that `CLAUDE.md` is not loaded as plugin context. This is expected.

## Documentation

Change the documentation in the same pull request as the code. Update [docs/ALGORITHM.md](docs/ALGORITHM.md) when the index, its ranking or its measurements change. Update the option table in the README and the detail in [docs/CONFIGURATION.md](docs/CONFIGURATION.md) when an option changes.
