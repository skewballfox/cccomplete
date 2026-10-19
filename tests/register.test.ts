import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const finished = { durationMs: 1, isAborted: false, turnId: 'turn-1', reason: 'answer' } as const

/**
 * Answers, beneath the plugin, the engine calls that the hooks module makes at session start.
 * `files` maps a path suffix to file text; a read of any other path goes to the engine, which fails for a file that does not exist.
 */
const boot = async (
  $: Engine,
  on: On,
  files: Readonly<Record<string, string>> = {},
  toasts: string[] = [],
): Promise<() => Promise<string>> => {
  on('command.register', () => ({ value: { command: 'cccomplete' } }))
  on('session.messages', () => ({ value: [] }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('fs.read', (_$, e, next) => {
    const found = Object.entries(files).find(([suffix]) => e.path.endsWith(suffix))
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
  expect(text).toContain('words indexed: 3')
  expect(text).toContain('dictionary: bundled, 3 words')
})

test('seeds the index from the dictionary file the option names', { options: { dictionary: '/words/mine.txt' } }, async ($, on) => {
  const status = await boot($, on, { '/words/mine.txt': 'alpha\nbeta\n', '/data/dictionary.txt': dictionary })
  const text = await status()
  expect(text).toContain('words indexed: 2')
  expect(text).toContain('dictionary: /words/mine.txt, 2 words')
})

test('falls back to the bundled dictionary and says so when the named file cannot be read', { options: { dictionary: '/words/gone.txt' } }, async ($, on) => {
  const toasts: string[] = []
  const status = await boot($, on, { '/data/dictionary.txt': dictionary }, toasts)
  expect(await status()).toContain('words indexed: 3')
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
