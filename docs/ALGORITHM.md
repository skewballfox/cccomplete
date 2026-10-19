# The completion index: algorithm and rationale

**Who this is for:** contributors who need to change the index in `src/trie.ts`, and reviewers who need to judge whether it fits its job.

**What this document does not cover:** how the index connects to Claude Code (see [ARCHITECTURE.md](ARCHITECTURE.md)) and how to use the plugin (see [../README.md](../README.md)).

**Evidence dates:** Claude Code facts come from its type declarations, version 2.1.292, and its documentation, both read on 2026-10-15. Measurements come from `tests/latency.test.ts`, run on 2026-10-15 on macOS.

## Summary

The index is a **radix trie with a precomputed list of the best completions at every node**. A lookup walks the typed prefix and reads one stored list. It never walks a subtree. An insertion updates the lists along one path.

## The problem

The plugin must answer one question on every keystroke: *which stored words extend the word being typed, best first?*

| Constraint | Source | What it demands |
| --- | --- | --- |
| C1. The index updates after a chat turn, not while typing. | Project requirement | Insertion may cost more than lookup. Insertion happens in a batch, off the typing path. |
| C2. A lookup must finish in under 13 ms. | Project requirement | Lookup cost must not depend on how many words the prefix matches. |
| C3. The index holds a conversation's vocabulary: thousands to tens of thousands of distinct words. | Assumption. The test uses 52,203 words. | A structure sized for millions of words is not needed. |
| C4. Words only arrive. Nothing is removed. | Design choice | The structure needs no deletion. A bounded or persistent store would need eviction, which the exactness argument below rules out in the live index. |
| C5. The code runs in the Claude Code mod environment. | Type declarations, 2.1.292 | Plain TypeScript only. The environment has no WebAssembly, no native modules and no `eval`. |

C5 matters because it removes the common escape route of writing the index in a compiled language. A probe mod run on 2026-10-15 confirmed that the `WebAssembly` global does not exist.

## How it works

### Structure

Each node holds:

- `edge`: the characters on the edge from its parent. A radix trie stores a run of characters on one edge, not one character per node.
- `children`: the child nodes, found by the first character of their edge.
- `end`: the word that ends exactly at this node, if one does. It holds the word, its count and the tick of its latest occurrence.
- `top`: the best words in this node's subtree, best first, at most 10.

All `top` lists point to the same word objects. When a word's count changes, every list that holds it sees the change.

### Ranking

A word ranks higher when its count is higher. Among words with equal counts, the word seen more recently ranks higher. Each insertion takes a new, larger tick, so two words never tie. The order is total and deterministic.

### Insertion

To insert a word, the trie:

1. Walks from the root, following the edge that shares the next character.
2. Splits an edge in two when the word shares only the start of it. The new middle node copies the lower node's `top` list, because both cover the same words.
3. Adds a leaf for any remaining characters.
4. Adds one to the word's count and sets its tick.
5. Updates the `top` list of every node on the path. If the word is in the list, it moves up past lower-ranked words. If it is not, and the list is full, it replaces the last word only when it outranks that word.

### Lookup

To look up a prefix, the trie walks the prefix from the root. If the prefix ends in the middle of an edge, the walk stops at the node below that edge, because every word under that node starts with the prefix. The trie then reads that node's `top` list, drops the prefix itself if it is a stored word, and returns the first `limit` words.

### Why the lists are exact

Step 5 keeps each `top` list equal to the true best 10 of its subtree. The argument:

- A word's rank only rises. Its count never falls and its tick only grows.
- Because every rank only rises, the lowest rank in a full list never falls.
- A word outside a full list can therefore enter only by outranking the list's last word. Step 5 tests exactly that.
- A list that is not full holds every word of its subtree, because step 5 adds each new word to it.

`tests/trie.test.ts` checks the result against a plain sort-everything implementation on 6,000 random insertions and 400 random queries.

## Cost

Let `L` be a word's length, `P` the prefix length, `K` the list size (10) and `D` the number of nodes on the insertion path (at most `L`).

| Operation | Cost | Notes |
| --- | --- | --- |
| Lookup | `O(P + K)` | Independent of the vocabulary size and of how many words match. |
| Insert one word | `O(L + D·K)` | Runs after a chat turn. |
| Memory | `O(total edge characters + nodes·K)` | Edges are shared between words with a common start. |

### Measured

These numbers come from `claude plugin test .` on 2026-10-15. They cover the steps the plugin runs itself, `detach` and `attach`. They exclude the host's own edit and the round trips to the host's state store, which the plugin cannot change.

| Measurement | Result | Target |
| --- | --- | --- |
| One keystroke on a trie of 52,203 words (20,000 samples): mean | 0.001 ms | |
| p99 | 0.003 ms | under 13 ms |
| Slowest sample | 0.16 ms | under 13 ms |
| A one-letter prefix against a seven-letter prefix | 0.0004 ms and 0.0003 ms | equal cost |
| A 200,006-character draft | 0.03 ms | under 13 ms |
| Folding in a 31,200-character turn (6,000 words) | 2 to 3 ms | no target; runs after the turn |
| Parsing and seeding a 47,000-word dictionary (2026-10-19) | 57 ms | no target; runs once at session start |

The equal cost of the short and long prefix shows the property that matters. A one-letter prefix matches a large share of the vocabulary. The lookup still reads one list.

## Why this is the best fit

Each constraint maps to a property of the design:

- **C1 and C2 together** are what make precomputed lists worthwhile. The design moves cost from lookup to insertion. Insertion runs once per chat turn, where 2 to 3 ms goes unnoticed. Lookup runs on every keystroke, where it must stay small.
- **C2** holds with a margin of more than three orders of magnitude, which leaves room for the host's own work inside the 13 ms.
- **C3** means memory is not the limiting resource. The cost of `K` entries per node is acceptable at this size.
- **C4** means the lists never need rebuilding after a removal.
- **C5** is met by plain TypeScript with no dependencies.

### Alternatives considered

| Alternative | Why it was not chosen |
| --- | --- |
| Plain character trie, then collect and sort the subtree | Lookup cost grows with the number of matching words. A one- or two-letter prefix matches the most words, which is the case that happens first on every word. |
| Radix trie without the lists | Same lookup cost as above. The lists are the part that removes it. |
| Ternary search tree | Compact, but a top-N query still has to visit the subtree. |
| Sorted array with binary search | Finding the range of matching words is fast. Ranking inside the range needs a scan or a range-maximum structure. Each insertion shifts the array. |
| Hash map from every prefix to its best list | Lookup is `O(1)`, but memory grows with every character of every word times `K`. A radix trie shares those characters. |
| Minimal automaton or finite-state transducer | Very compact, but it is built once and not updated. Rebuilding after every turn is possible. It adds a build step and still needs weights. The vocabulary here does not need the compactness. |
| Native or WebAssembly index | Not available in the mod environment (constraint C5). |

### When to revisit

Revisit the choice if either assumption changes:

- **The vocabulary reaches millions of words.** The lists then cost real memory. A transducer rebuilt after each turn, or an external process reached through `$.process`, becomes worth its complexity. A process adds a round trip to every keystroke. The `prompt.edit` hook has a 50 ms limit, so measure first.
- **Ranking needs to forget.** The ranks here only rise. A decay would break the exactness argument above, and the lists would need rebuilding on decay.

## Seeding from a dictionary

At session start the plugin inserts the words of a dictionary file, last line first, each once. The first line gets the newest tick, so earlier lines rank higher among equal counts. The file format and its source are in [DICTIONARY.md](DICTIONARY.md).

This uses only `insert`, so the exactness argument holds without change. Each seed word has a count of one. The plugin inserts seed words before the transcript, so every word from the conversation has a newer tick. A word from the conversation therefore outranks every seed word it ties on count with, and any word with a higher count outranks it by count.

## Known behaviours

- **Case matters.** The trie stores words as written. This keeps identifiers such as `PromptEdit` intact. A smart-case lookup that matches case-insensitively when the prefix is all lowercase is possible, but the inline suggestion would then have to replace the typed prefix and not only append text.
- **UTF-16 code units.** The trie splits on code units, not code points. Letters outside the basic multilingual plane are not word characters, so they never enter the trie.
- **Capacity.** The lists hold 10 words. A lookup asks for at most 9, because the prefix may itself be a stored word and takes one slot.
- **Word rules.** A word has 3 to 64 code units and at least one letter. See `src/words.ts`.
