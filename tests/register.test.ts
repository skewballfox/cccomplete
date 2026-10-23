import type { On, SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { raise } from './support'

const finished = { durationMs: 1, isAborted: false, turnId: 'turn-1', reason: 'answer' } as const

/** What the stand-in host holds: its store, and the commands it lists. */
type Host = { store: Record<string, unknown>; commands: string[]; messages: SessionMessage[]; messagesError?: string }

/**
 * Answers, beneath the plugin, the engine calls that the hooks module makes at session start.
 * `files` maps a path suffix to file text; a read of any other path goes to the engine, which fails for a file that does not exist.
 */
const boot = async (
  $: Engine,
  on: On,
  files: Readonly<Record<string, string>> = {},
  toasts: string[] = [],
  host: Host = { store: {}, commands: [], messages: [] },
): Promise<() => Promise<string>> => {
  on('command.register', () => ({ value: { command: 'cccomplete' } }))
  on('command.list', () => ({
    value: host.commands.map(name => ({ name, description: '', source: 'builtin' as const })),
  }))
  on('store.get', (_$, e) => ({ value: host.store[e.key] }))
  on('store.set', (_$, e) => {
    host.store[e.key] = e.value
    return { value: undefined }
  })
  on('session.messages', () => {
    if (host.messagesError !== undefined) throw new Error(host.messagesError)
    return { value: host.messages }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  // The English model reads as empty unless a test gives it, so most tests count only their own words.
  const known = { '/data/english.tsv': '', ...files }
  on('fs.read', (_$, e, next) => {
    const found = Object.entries(known).find(([suffix]) => e.path.endsWith(suffix))
    return found === undefined ? next(e) : { value: found[1] }
  })
  await $.session.start({ cwd: '/', surface: null, isInteractive: true })
  return async () => (await $.command.run({ command: 'cccomplete', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })).text ?? ''
}

test('learns the words of a finished turn after it ends', async ($, on) => {
  const status = await boot($, on)
  expect(await status()).toContain('words indexed: 0')
  await $.turn.complete({ ...finished, answer: 'quokka habitat quokka' })
  expect(await status()).toContain('words indexed: 2')
})

test('ignores a subagent turn', async ($, on) => {
  const status = await boot($, on)
  await $.turn.complete({ ...finished, agentId: 'agent-1', answer: 'quokka habitat' })
  expect(await status()).toContain('words indexed: 0')
})

test('ignores answers when the sources are prompts only', { options: { sources: 'prompts' } }, async ($, on) => {
  const status = await boot($, on)
  await $.turn.complete({ ...finished, answer: 'quokka habitat' })
  expect(await status()).toContain('words indexed: 0')
})

test('reports the keys in effect and any invalid option', { options: { accept_key: 'ctrl+y', next_key: 'q' } }, async ($, on) => {
  const status = await boot($, on)
  const text = await status()
  expect(text).toContain('accept ctrl+y')
  expect(text).toContain('next ctrl+d')
  expect(text).toContain('next_key: "q" is not valid (needs-modifier)')
})

const dictionary = '# header\nquokka\nwombat\nplatypus\n'

test('seeds the index from the bundled dictionary at session start', async ($, on) => {
  const status = await boot($, on, { '/data/dictionary.txt': dictionary })
  const text = await status()
  expect(text).toContain('English: 3 words')
  expect(text).toContain('dictionary: bundled, 3 words')
})

test('seeds the index from the dictionary file the option names', { options: { dictionary: '/words/mine.txt' } }, async ($, on) => {
  const status = await boot($, on, { '/words/mine.txt': 'alpha\nbeta\n', '/data/dictionary.txt': dictionary })
  const text = await status()
  expect(text).toContain('English: 2 words')
  expect(text).toContain('dictionary: /words/mine.txt, 2 words')
})

test('falls back to the bundled dictionary and says so when the named file cannot be read', { options: { dictionary: '/words/gone.txt' } }, async ($, on) => {
  const toasts: string[] = []
  const status = await boot($, on, { '/data/dictionary.txt': dictionary }, toasts)
  expect(await status()).toContain('English: 3 words')
  expect(toasts).toEqual(['dictionary: cannot read "/words/gone.txt"; using the bundled dictionary.'])
})

test('loads no dictionary when the option is none', { options: { dictionary: 'none' } }, async ($, on) => {
  const status = await boot($, on, { '/data/dictionary.txt': dictionary })
  const text = await status()
  expect(text).toContain('words indexed: 0')
  expect(text).toContain('dictionary: none')
})

test('starts with an empty index when the bundled file is missing', async ($, on) => {
  const status = await boot($, on)
  const text = await status()
  expect(text).toContain('words indexed: 0')
  expect(text).toContain('dictionary: bundled, 0 words')
})

const composer = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

test('learns the shell commands and paths of tool calls in the turn they ran', async ($, on) => {
  on('tool.call', () => ({ result: {}, text: 'src/trie.ts' }))
  const status = await boot($, on)
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  await $.tool.call({ tool: 'Read', file_path: 'src/trie.ts' })
  expect(await status()).toContain('code: 0; shell: 0')
  await $.turn.complete({ ...finished, answer: '' })
  expect(await status()).toContain('code: 1; shell: 2')
})

test('counts the slash commands the user runs and keeps the count in the store', async ($, on) => {
  const host: Host = { store: { 'command-uses': { compact: 1 } }, commands: ['clear', 'compact'], messages: [] }
  on('command.run', { command: 'compact' }, () => ({ text: '' }))
  const status = await boot($, on, {}, [], host)
  expect(await status()).toContain('commands: 2')
  await $.command.run({ command: 'compact', args: '', ...composer })
  expect(host.store['command-uses']).toMatchObject({ compact: 2 })
})

test('builds a fresh index at each session start, so a /clear does not count the dictionary twice', async ($, on) => {
  const status = await boot($, on, { '/data/dictionary.txt': 'quokka\n' })
  await $.session.start({ cwd: '/', surface: null, isInteractive: true })
  expect(await status()).toContain('English: 1 words')
})

test('learns the transcript at session start, tool calls included', async ($, on) => {
  const messages: SessionMessage[] = [
    { role: 'user', text: 'quokka habitat', toolUses: [] },
    { role: 'assistant', text: 'ok', toolUses: [{ tool_use_id: 't', tool: 'Bash', input: { command: 'ls -la' }, text: '' }] },
  ]
  const status = await boot($, on, {}, [], { store: {}, commands: [], messages })
  expect(await status()).toContain('words indexed: 2 ')
  expect(await status()).toContain('shell: 1')
})

test('adds the matches to the host typeahead after the host rows', async ($, on) => {
  on('prompt.autocomplete', () => ({ suggestions: [{ text: '#1' }] }))
  await boot($, on)
  await $.turn.complete({ ...finished, answer: 'quokka quokka' })
  expect(await raise($.prompt, 'autocomplete', { text: 'say quo', cursor: 7, token: 'quo', start: 4 })).toEqual({
    suggestions: [{ text: '#1' }, { text: 'quokka', label: 'quokka', description: 'cccomplete' }],
  })
})

/** Stands in for the host's `$.state`, which the kit does not hold, and for the editor beneath `prompt.edit`. */
const holdHost = (on: On): void => {
  const state = new Map<string, unknown>()
  on('state.get', (_$, e) => ({ value: { value: state.get(e.key), version: 1 } }))
  on('state.set', (_$, e) => {
    state.set(e.key, e.value)
    return { value: { isSet: true, version: 2 } }
  })
  on('prompt.edit', (_$, e) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
  }))
}

/** One typed character at the end of `text`, as the host raises it. */
const typing = (text: string, inputText: string): unknown => ({
  origin: { kind: 'composer' },
  key: { key: inputText },
  text,
  cursor: text.length,
  start: text.length,
  end: text.length,
  inputText,
})

test('a keystroke leaves the typed text alone and draws the best match after it as virtual text', async ($, on) => {
  holdHost(on)
  await boot($, on)
  await $.turn.complete({ ...finished, answer: 'quokka quokka' })
  expect(await raise($.prompt, 'edit', typing('say qu', 'o'))).toEqual({
    text: 'say quo',
    cursor: 7,
    decorations: [{ start: 7, end: 7, virtualText: 'kka', dimColor: true }],
  })
})

test('the accept key writes the word and a space, then accepts the predicted next word', async ($, on) => {
  holdHost(on)
  await boot($, on)
  await $.turn.complete({ ...finished, answer: 'quokka habitat' })
  const right = (text: string): unknown => ({ origin: { kind: 'composer' }, key: { key: 'right' }, text, cursor: text.length, start: text.length, end: text.length, inputText: '' })
  await raise($.prompt, 'edit', typing('say qu', 'o'))
  expect(await raise($.prompt, 'edit', right('say quo'))).toEqual({
    text: 'say quokka ',
    cursor: 11,
    decorations: [{ start: 11, end: 11, virtualText: 'habitat', dimColor: true }],
  })
  expect(await raise($.prompt, 'edit', right('say quokka '))).toMatchObject({ text: 'say quokka habitat ', decorations: [] })
  // With no view left, the key goes to the host, which moves nothing at the end of the draft.
  expect(await raise($.prompt, 'edit', right('say quokka habitat '))).toMatchObject({ text: 'say quokka habitat ' })
})

test('a complete slash command name gets no suggestion, so Enter runs the command typed', async ($, on) => {
  holdHost(on)
  await boot($, on, {}, [], { store: {}, commands: ['clear', 'compact'], messages: [] })
  await $.turn.complete({ ...finished, answer: 'clearing clearing' })
  expect(await raise($.prompt, 'edit', typing('/clea', 'r'))).toEqual({ text: '/clear', cursor: 6, decorations: [] })
  expect(await raise($.prompt, 'edit', typing('/c', 'o'))).toMatchObject({
    text: '/co',
    decorations: [{ virtualText: 'mpact' }],
  })
})

test('records a failed session start step and keeps the rest of the index', async ($, on) => {
  const host: Host = { store: {}, commands: [], messages: [], messagesError: 'transcript unavailable' }
  const status = await boot($, on, { '/data/dictionary.txt': 'quokka\n' }, [], host)
  const text = await status()
  expect(text).toContain('English: 1 words')
  // The kit reports a stand-in that throws as unanswered, so the reason it gives is its own.
  expect(text).toContain('failures: session.start transcript:')
})

test('lists no trace by default, and the session start steps and keystrokes with trace on', { options: { trace: true } }, async ($, on) => {
  holdHost(on)
  const status = await boot($, on, { '/data/dictionary.txt': 'quokka\n' })
  await raise($.prompt, 'edit', typing('qu', 'o'))
  const text = await status()
  expect(text).toContain('failures: none')
  expect(text).toContain('session.start dictionary: 1 words')
  expect(text).toContain('session.start transcript: 0 turns, 0 words')
  expect(text).toContain('prompt.edit o → edit: prose, 1 matches')
})

test('shows no trace section when trace is off', async ($, on) => {
  const status = await boot($, on)
  expect(await status()).not.toContain('trace, oldest first')
})
