import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const finished = { durationMs: 1, isAborted: false, turnId: 'turn-1', reason: 'answer' } as const

/** Answers, beneath the plugin, the engine calls that the hooks module makes at session start. */
const boot = async ($: Engine, on: On): Promise<() => Promise<string>> => {
  on('command.register', () => ({ value: { command: 'cccomplete' } }))
  on('session.messages', () => ({ value: [] }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.toast', () => ({ value: undefined }))
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
  expect(text).toContain('next ctrl+n')
  expect(text).toContain('next_key: "q" is not valid (needs-modifier)')
})
