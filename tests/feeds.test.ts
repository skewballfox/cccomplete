import { describe, expect, test } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'

import { feeds, promptFeed, toolFeeds, transcriptTurns } from '../src/feeds'

const use = (tool: string, input: Record<string, unknown>, text?: string, isError = false) => ({
  tool,
  input,
  text,
  isError,
})

describe('toolFeeds', () => {
  test('reads a shell command from Bash, and paths and code from the file tools', () => {
    expect(toolFeeds(use('Bash', { command: 'git status' }, 'clean'))).toEqual([{ kind: 'shell', text: 'git status' }])
    expect(toolFeeds(use('Read', { file_path: '/a/b.ts' }, 'const x = 1'))).toEqual([
      { kind: 'code', text: '/a/b.ts' },
      { kind: 'code', text: 'const x = 1' },
    ])
    expect(toolFeeds(use('Edit', { file_path: '/a/b.ts', old_string: 'old', new_string: 'fresh' }))).toEqual([
      { kind: 'code', text: '/a/b.ts' },
      { kind: 'code', text: 'fresh' },
    ])
    expect(toolFeeds(use('Write', { file_path: '/c.ts', content: 'body' }))).toEqual([
      { kind: 'code', text: '/c.ts' },
      { kind: 'code', text: 'body' },
    ])
    expect(toolFeeds(use('NotebookEdit', { notebook_path: '/n.ipynb', new_source: 'cell' }))).toHaveLength(2)
    expect(toolFeeds(use('Grep', { pattern: 'x' }, 'src/a.ts\nsrc/b.ts'))).toEqual([{ kind: 'code', text: 'src/a.ts\nsrc/b.ts' }])
  })

  test('teaches nothing from a failed call, an unknown tool, or a field that is not text', () => {
    expect(toolFeeds(use('Bash', { command: 'rm x' }, 'denied', true))).toEqual([])
    expect(toolFeeds(use('WebFetch', { url: 'https://x' }, 'page'))).toEqual([])
    expect(toolFeeds(use('Bash', { command: 3 }))).toEqual([])
    expect(toolFeeds(use('Glob', { pattern: '*' }, ''))).toEqual([])
  })
})

describe('promptFeed', () => {
  test('reads a leading ! as a shell command', () => {
    expect(promptFeed('!ls -la')).toEqual({ kind: 'shell', text: 'ls -la' })
    expect(promptFeed('hello')).toEqual({ kind: 'prose', text: 'hello' })
  })
})

describe('feeds', () => {
  test('lets each source through only when the option includes it', () => {
    expect([feeds('both', 'user'), feeds('both', 'assistant')]).toEqual([true, true])
    expect([feeds('prompts', 'user'), feeds('prompts', 'assistant')]).toEqual([true, false])
    expect([feeds('answers', 'user'), feeds('answers', 'assistant')]).toEqual([false, true])
  })
})

describe('transcriptTurns', () => {
  const message = (role: 'user' | 'assistant', text: string, toolUses: SessionMessage['toolUses'] = []): SessionMessage => ({
    role,
    text,
    toolUses,
  })
  const bash = { tool_use_id: 't1', tool: 'Bash', input: { command: 'git log' }, text: 'ok' }

  test('starts a turn at each prompt and keeps tool results in their turn', () => {
    const turns = transcriptTurns(
      [
        message('user', 'first'),
        message('assistant', 'answer', [bash]),
        message('user', ''),
        message('assistant', 'more'),
        message('user', '!pwd'),
      ],
      'both',
    )
    expect(turns).toEqual([
      [
        { kind: 'prose', text: 'first' },
        { kind: 'prose', text: 'answer' },
        { kind: 'shell', text: 'git log' },
        { kind: 'prose', text: 'more' },
      ],
      [{ kind: 'shell', text: 'pwd' }],
    ])
  })

  test('keeps only the sources the option names, and opens a turn for leading answers', () => {
    const messages = [message('assistant', 'hello', [bash]), message('user', 'prompt')]
    expect(transcriptTurns(messages, 'prompts')).toEqual([[], [{ kind: 'prose', text: 'prompt' }]])
    expect(transcriptTurns(messages, 'answers')).toEqual([[{ kind: 'prose', text: 'hello' }, { kind: 'shell', text: 'git log' }], []])
    expect(transcriptTurns([], 'both')).toEqual([])
  })

  test('skips stored fields of the wrong shape and keeps the rest', () => {
    const odd: unknown[] = [null, 'text', { tool: 3, input: {} }, { tool: 'Bash', input: null }, { tool: 'Bash', input: { command: 'pwd' }, text: 7 }]
    const stored: SessionMessage = { role: 'assistant', text: 'fine', toolUses: [] }
    Reflect.set(stored, 'toolUses', odd)
    expect(transcriptTurns([stored], 'both')).toEqual([[{ kind: 'prose', text: 'fine' }, { kind: 'shell', text: 'pwd' }]])
    const noUses: SessionMessage = { role: 'assistant', text: 'alone', toolUses: [] }
    Reflect.deleteProperty(noUses, 'toolUses')
    expect(transcriptTurns([noUses], 'both')).toEqual([[{ kind: 'prose', text: 'alone' }]])
  })
})
