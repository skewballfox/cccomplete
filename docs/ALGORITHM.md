# The completion index: algorithm and rationale

**Who this is for:** contributors who need to change the index in `src/trie.ts` or the model in `src/lexicon.ts`, and reviewers who need to judge whether they fit their job.

**What this document does not cover:** how the index connects to Claude Code (see [ARCHITECTURE.md](ARCHITECTURE.md)) and how to use the plugin (see [../README.md](../README.md)).

**Evidence dates:** Claude Code facts come from its type declarations, version 2.1.292, and its documentation, both read on 2026-10-15, and from the declarations for 2.1.309, read on 2026-10-22. Measurements come from `tests/latency.test.ts`, run on 2026-10-22 on Linux (Fedora, kernel 7.2).

## Summary

The index is a set of **radix tries with a precomputed list of the best completions at every node**. A lookup walks the typed prefix and reads one stored list per trie. It never walks a subtree. An insertion updates the lists along one path.

Prose and shell words rank by a **smoothed Markov model**: an estimate of how likely each word is after the one or two words before it, a Witten–Bell interpolated trigram. For prose, its lowest level is a bundled English model of word and word-pair counts. A keystroke scores only the words in at most five stored lists, and certifies each result that provably equals a scan of every word. Code, shell commands and slash commands have tries of their own. See [Context and the model](#context-and-the-model).

## The problem

The plugin must answer one question on every keystroke: *which stored words extend the word being typed, best first?*

| Constraint | Source | What it demands |
| --- | --- | --- |
| C1. The index updates after a chat turn, not while typing. | Project requirement | Insertion may cost more than lookup. Insertion happens in a batch, off the typing path. |
| C2. A lookup must finish in under 13 ms. | Project requirement | Lookup cost must not depend on how many words the prefix matches. |
| C3. The index holds a conversation's vocabulary: thousands to tens of thousands of distinct words. | Assumption. The test uses a 400,000-word conversation with 49,742 distinct words and 340,268 contexts. | A structure sized for millions of words is not needed. |
| C4. Words only arrive. Nothing is removed. | Design choice | The structure needs no deletion. A bounded or persistent store would need eviction, which the exactness argument below rules out in the live index. |
| C5. The code runs in the Claude Code mod environment. | Type declarations, 2.1.292 | Plain TypeScript only. The environment has no WebAssembly, no native modules and no `eval`. |

C5 matters because it removes the common escape route of writing the index in a compiled language. A probe mod run on 2026-10-15 confirmed that the `WebAssembly` global does not exist. A second probe under `claude plugin test` on 2026-10-22 (2.1.309) found the same, and the 2.1.309 declarations say the omission is deliberate.

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
5. Updates the `top` list of every node on the path, the root included. If the word is in the list, it moves up past lower-ranked words. If it is not, and the list is full, it replaces the last word only when it outranks that word.

### Lookup

To look up a prefix, the trie walks the prefix from the root. If the prefix ends in the middle of an edge, the walk stops at the node below that edge, because every word under that node starts with the prefix. The trie then reads that node's `top` list, drops the prefix itself if it is a stored word, and returns the first `limit` words. With no prefix, the walk stops at once and reads the root's list: the best words of the whole trie.

### Why the lists are exact

Step 5 keeps each `top` list equal to the true best 10 of its subtree. The argument:

- A word's rank only rises. Its count never falls and its tick only grows.
- Because every rank only rises, the lowest rank in a full list never falls.
- A word outside a full list can therefore enter only by outranking the list's last word. Step 5 tests exactly that.
- A list that is not full holds every word of its subtree, because step 5 adds each new word to it.

`tests/trie.test.ts` checks the result against a plain sort-everything implementation on 6,000 random insertions and 400 random queries.

## Context and the model

### What a context is

The *context* of a word is the run of characters directly before it, when only spaces or tabs come between them (at most 8). The *two-word context* is the context of that run, a space, and the run: in `go to bed`, `bed` has the context `to` and the two-word context `go to`. A context never crosses punctuation or a line break: in `run. tests`, `tests` has no context. A context need not be a word the index completes. `to` is too short to complete, but it still predicts `be`.

In a shell command (a draft that starts with `!`), the first token of each command has a context of its own, `COMMAND_START`. A command starts at the beginning of the line and after `|`, `;`, `&` or `(`. So `!` alone predicts the commands you run most, and `!git ` predicts what follows `git`.

### Structure

A *vocabulary* is one trie of every word, plus two maps: from each context, and from each two-word context, to a trie of the words seen after it. Every insertion goes into all three. The prose and shell indexes are vocabularies.

| Index | Learns from | Serves |
| --- | --- | --- |
| Prose | Prompts and answers | Prose drafts |
| English | The bundled English model (`data/english.tsv`) and the dictionary | Prose drafts, lowest level of the model |
| Code | Code spans and fences in prompts and answers; paths, code and file contents from the Read, Edit, Write, NotebookEdit, Glob and Grep tools | Drafts whose end is inside a code span or fence |
| Shell | `!` prompts and the commands Claude ran with Bash | Drafts that start with `!` |
| Commands | `$.command.list()`, ranked by how often you ran each command | The name on a `/` line |

The draft decides which index serves it (`targetOf` in `src/draft.ts`). It reads only the end of the draft: the prefix (at most 64 code units), the two gaps and contexts before it (at most 2 × (8 + 64)), and the last 4,096 code units to see whether the end is inside code. A fence opened earlier than that is not seen.

### The score

For a word `w` after the context `c₁` and the two-word context `c₂`, the score estimates the probability that `w` comes next:

```text
P₃(w) = λ(c₂) · n(c₂, w) / n(c₂)  +  (1 − λ(c₂)) · P₂(w)
P₂(w) = λ(c₁) · n(c₁, w) / n(c₁)  +  (1 − λ(c₁)) · P₁(w)
P₁(w) = μ · n(w) / N  +  (1 − μ) · E(w)
E(w)  = λₑ(c₁) · e(c₁, w) / e(c₁)  +  (1 − λₑ(c₁)) · e(w) / Nₑ
```

- `n(c, w)` counts `w` after `c` in the conversation, `n(c)` all words after `c`, `n(w)` all uses of `w`, and `N` all words learned. `e(…)` are the same counts in the English model.
- **Witten–Bell weights:** `λ(c) = n(c) / (n(c) + d(c))`, where `d(c)` is how many different words followed `c`. A context with few, repeated followers (`git` → `commit`) is trusted; one with many different followers (`the`) leans on the level below. A context never seen has `λ = 0`.
- **The English weight:** `μ = N / (N + 500)`. A new session leans on English grammar; after a few hundred words the conversation's own frequencies take over. 500 scored best of 100, 500 and 3,000 in the replay below. With no English model (the `english` option off, or the file missing), `μ = 1`.
- Ties break by the recency of the word's last use, then by its English count, then by the word itself, so the order is total.

The English counts come with each context's true total and distinct count from before the file was pruned, so `λₑ` matches the source.

### Scoring a keystroke, and the certificate

Scoring every stored word would cost time in proportion to the vocabulary, which C2 rules out. A lookup instead reads five stored lists for the prefix, nine words each: the two-word context's trie, the context's trie, the conversation's words, the English context's trie and the English words. It scores the union, at most 45 words, by the formula above, with one count lookup per word and trie, and keeps the best `L`.

A word in none of the lists can still score higher, in principle. The bound rules that out where it can:

- Each list holds its trie's best words by count. A word outside a full list has, in that trie, a count at most the list's last count. Outside a list that is not full, its count is zero, because such a list holds every word under the prefix.
- Every weight is fixed for one lookup and none is negative, so the score rises with each count. A word outside all the lists therefore scores at most the score of those ceilings.
- Each result that scores above that bound is **certified**: no word left out can outrank it. `Ranking.certified` counts the leading certified results, and the trace shows it.
- The `min_gain` filter drops a candidate that adds fewer letters than the minimum. It runs after the lists are read, so the bound still covers every word a list left out, and a certified result stays the best of the words that pass the filter.

`tests/lexicon.test.ts` checks the certificate against a reference that counts in plain maps and scores every word: on random corpora, every certified result equals the reference, and more than half the results are certified. In the replay below, scoring only the union matched scoring every word exactly.

The stored lists stay exact by the argument above, because every trie still ranks by count and recency, and counts only rise. Only the final order is a blend, and it is computed fresh on each keystroke from counts, so no stored list depends on it.

### Next-word prediction

When the draft ends in spaces after a word, and `predict_next` is on, the lookup scores the same lists with no prefix. The root of every trie keeps a list for this. It predicts only after a word with known followers, in the conversation or in the English model: a guess after every space would be noise. Accepting a match looks up the result again, so the next word shows at once.

### What the model is worth

A replay of 15 local Claude Code sessions (2026-10-22: 32,451 words of prompts and answers, no tool output) predicted each word from what came before it, then learned it. Word completion used a two-letter prefix on words of four letters or more.

| Model | Word completion, top-1 / top-5 | Next word, top-1 / top-5 |
| --- | --- | --- |
| Ordered tiers (version 0.2.0) | 34.3% / 57.2% | 15.8% / 25.5% |
| Witten–Bell trigram, conversation only | 34.7% / 57.2% | 16.9% / 27.2% |
| Witten–Bell trigram with the English model | 36.3% / 64.0% | 17.2% / 28.7% |

**The minimum gain.** The same replay, now counting every word of three letters or more, found that the top match added only one letter in 11,406 of 35,784 completions. It was right 65% of the time, but taking it saved nothing: one key bought one letter. With `min_gain` at 2, a longer word takes that slot, and the letters saved by taking a right top match, less the key that takes it, rose from 24,645 to 26,532 (7.7%). Hit rates fall (top-1 from 47.8% to 30.1%) only because three-letter words such as `the` can no longer be the top match, and those saved nothing.

The tiers row counted next-word cases only where the context had been seen, so its next-word numbers are not directly comparable. The two Witten–Bell rows count the same cases. A cache of the last 2,000 words, the classic recency component, added nothing and was left out; so was the recent tier of 0.2.0. The replay scripts are not part of the repository.

## Cost

Let `L` be a word's length, `P` the prefix length, `K` the list size (10) and `D` the number of nodes on the insertion path (at most `L`).

| Operation | Cost | Notes |
| --- | --- | --- |
| Read the draft | `O(P + 144 + 4096)` | The prefix, two gaps and contexts, and the code window. Independent of the draft's length. |
| Lookup | `O(P + 45·(L + 5))` plus three map lookups | Five lists of at most nine words, five count lookups per word, a sort of at most 45. Independent of the vocabulary size. |
| Insert one word | `O(L + D·K)`, three times | The all-words trie, the context's and the two-word context's. Runs after a chat turn. |
| Load the English model | One weighted insert per word and per pair | Once, at session start. |
| Memory | `O(total edge characters + nodes·K)` per trie | One small trie per distinct context and two-word context. |

### Measured

These numbers come from `claude plugin test .` on 2026-10-22, on Linux. They cover the steps the plugin runs itself on a keystroke: reading the draft, the lookups and the scoring. They exclude the host's own edit and the round trips to the host's state store, which the plugin cannot change. The bench loads a synthetic English model the size of the bundled one, because the test kit cannot read files.

| Measurement | Result | Target |
| --- | --- | --- |
| One keystroke, 400,000-word conversation (49,742 words, 340,268 contexts, 20,000 samples): mean | 0.053 ms | |
| p99 | 0.128 ms | under 13 ms |
| Slowest sample | 1.4 ms | under 13 ms |
| Next-word prediction after a space: mean / p99 | 0.073 ms / 0.154 ms | under 13 ms |
| A one-letter prefix against a seven-letter prefix | 0.020 ms and 0.006 ms | both bounded |
| A 200,006-character draft full of code spans | 0.27 ms | under 13 ms |
| Learning a 32,000-character turn (6,400 words) | 8 ms | no target; runs after the turn |
| Parsing and seeding an English model of 22,000 words and 2,861 contexts | 212 ms | no target; runs once at session start |
| Parsing and seeding a 47,000-word dictionary | 145 ms | no target; runs once at session start |

The ordered tiers of 0.2.0 measured a mean of 0.016 ms and a p99 of 0.038 ms on the same machine. The model costs about three times as much and stays about 100 times under the target at p99. A one-letter prefix costs more than a long one, because it fills all five lists, but its cost is bounded and does not grow with the vocabulary. The slowest sample is a pause outside the lookup, most likely garbage collection.

**Memory is the cost to watch.** The 400,000-word bench made 340,268 contexts, each a small trie of its own. Sessions in the replay averaged about 2,000 words and a few thousand contexts. A very long session would benefit from storing a context with few followers as a short list rather than a trie. This is not built.

## Why this is the best fit

Each constraint maps to a property of the design:

- **C1 and C2 together** are what make precomputed lists worthwhile. The design moves cost from lookup to insertion. Insertion runs once per chat turn, where a few milliseconds go unnoticed. Lookup runs on every keystroke, where it must stay small, so it scores a bounded union of lists instead of the vocabulary.
- **C2** holds with a margin of about two orders of magnitude, which leaves room for the host's own work inside the 13 ms.
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
| Ordered tiers: context matches first, then every word (version 0.2.0) | Exact, but a word seen once after the context beats every common word. The replay above measured the gain of smoothing over it. |
| Storing the blended score in the lists | The score of a word changes in every context list that holds it whenever its overall count changes, so each insertion would touch every context. The model blends at lookup time instead. |
| A cache of recent words | Added nothing in the replay. |
| Decay of old counts | Ranks would fall, which breaks exactness of the stored lists. |
| Kneser–Ney smoothing | Needs a continuation count per word (how many contexts it followed) and a discount per order. Witten–Bell needs only two counters per context and did well in the replay. Worth trying if quality needs more. |
| A model call (`$.model.complete`) | Hundreds of milliseconds or more per call, against a 13 ms budget. |

### When to revisit

Revisit the choice if either assumption changes:

- **The vocabulary reaches millions of words.** The lists then cost real memory. A transducer rebuilt after each turn, or an external process reached through `$.process`, becomes worth its complexity. A process adds a round trip to every keystroke. The `prompt.edit` hook has a 50 ms limit, so measure first.
- **Ranking needs to forget.** The counts here only rise. A true decay would break the exactness argument above, and the lists would need rebuilding on decay.
- **Results are often uncertified.** If the trace shows many keystrokes with fewer certified matches than shown, longer stored lists (a larger `TOP_CAPACITY`) widen the bound at a small cost.

## Seeding

At session start the plugin fills the English index in two steps. The file formats and the sources are in [DICTIONARY.md](DICTIONARY.md).

1. **The dictionary.** It inserts each word once, last line first. The first line gets the newest tick, so earlier lines rank higher among equal counts.
2. **The English model.** It inserts each word with its count from `data/english.tsv`, in one weighted insert, and builds one trie per English context from its followers' counts. A dictionary word the model also holds ranks by the model's count.

A weighted insert of `k` ranks a word as `k` single inserts in a row would, so ranks still only rise and the lists stay exact. The conversation's own words go into the prose index, not the English one, so seeds never compete with them in a stored list. They meet only in the score, where `μ` decides their weight.

## Known behaviours

- **Case matters.** The trie stores words as written. This keeps identifiers such as `PromptEdit` intact. A smart-case lookup that matches case-insensitively when the prefix is all lowercase is possible, but the inline suggestion would then have to replace the typed prefix and not only append text.
- **UTF-16 code units.** The trie splits on code units, not code points. Letters outside the basic multilingual plane are not word characters, so they never enter the trie.
- **Capacity.** The lists hold 10 words. A lookup asks for at most 9, because the prefix may itself be a stored word and takes one slot.
- **Code tokens.** A code token is a run of letters, digits and `_ . / - : @`, less a trailing `.` or `:`, with 3 to 64 characters and a letter. `src/trie.ts` and `--plugin-dir` are one token each.
- **Not persisted.** The tries live in memory and rebuild from the dictionary, the English model, the transcript (its tool calls included) and the command list at each session start. Only the command counts persist, in `$.store`.
- **Word rules.** A word has 3 to 64 code units and at least one letter. See `src/words.ts`.
