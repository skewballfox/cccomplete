/**
 * Decides which text feeds which index: prompts, answers, tool calls and the transcript.
 *
 * Audience: contributors to cccomplete. Not covered: how a feed is split into
 * words (see words.ts) or stored (see lexicon.ts).
 */

import type { SessionMessage } from 'claude-code'

import type { Sources } from './config'

/**
 * One text to learn from, and how to read it.
 *
 * - `prose`: Markdown. Its words feed the prose index, and the tokens in its code spans feed the code index.
 * - `code`: source code, a path or tool output. Every token feeds the code index.
 * - `shell`: a shell command. Its tokens feed the shell index.
 */
export type Feed = Readonly<{ kind: 'prose' | 'code' | 'shell'; text: string }>

/** One finished tool call, as the hooks module or the transcript reports it. */
export type ToolUse = Readonly<{
  tool: string
  input: Readonly<Record<string, unknown>>
  text: string | undefined
  isError: boolean
}>

/** Who wrote a text. */
export type Author = 'user' | 'assistant'

/** True when text written by `author` feeds the index under `sources`. Tool calls count as Claude's. */
export const feeds = (sources: Sources, author: Author): boolean =>
  sources === 'both' || (sources === 'prompts') === (author === 'user')

const field = (input: Readonly<Record<string, unknown>>, name: string): readonly string[] => {
  const value = input[name]
  return typeof value === 'string' && value !== '' ? [value] : []
}

const code = (texts: readonly string[]): readonly Feed[] => texts.map(text => ({ kind: 'code', text }))

const prose = (text: string): readonly Feed[] => (text === '' ? [] : [{ kind: 'prose', text }])

/**
 * Returns what a tool call teaches: the shell command Claude ran, and the paths, code and file names it read or wrote.
 *
 * A call that failed teaches nothing. A tool not listed here teaches nothing,
 * because its output is not code the user is likely to type.
 */
export const toolFeeds = (use: ToolUse): readonly Feed[] => {
  if (use.isError) return []
  const output = use.text === undefined || use.text === '' ? [] : [use.text]
  switch (use.tool) {
    case 'Bash':
      return field(use.input, 'command').map(text => ({ kind: 'shell', text }))
    case 'Read':
      return code([...field(use.input, 'file_path'), ...output])
    case 'Edit':
      return code([...field(use.input, 'file_path'), ...field(use.input, 'new_string')])
    case 'Write':
      return code([...field(use.input, 'file_path'), ...field(use.input, 'content')])
    case 'NotebookEdit':
      return code([...field(use.input, 'notebook_path'), ...field(use.input, 'new_source')])
    case 'Glob':
    case 'Grep':
      return code(output)
    default:
      return []
  }
}

/** A prompt as a feed: a shell command after a leading `!`, prose otherwise. */
export const promptFeed = (text: string): Feed =>
  text.startsWith('!') ? { kind: 'shell', text: text.slice(1) } : { kind: 'prose', text }

/**
 * Groups a transcript into turns of feeds, oldest first, so the index learns it as it learned the live session.
 *
 * A turn starts at each user message that has text. Tool results arrive as
 * user messages with no text, so they stay in the turn they belong to.
 */
export const transcriptTurns = (messages: readonly SessionMessage[], sources: Sources): readonly (readonly Feed[])[] => {
  const turns: Feed[][] = []
  // A loop, because grouping messages into turns is a small state machine and one pass keeps it linear.
  for (const message of messages) {
    const own = messageFeeds(message, sources)
    const last = turns[turns.length - 1]
    if ((message.role === 'user' && message.text !== '') || last === undefined) turns.push([...own])
    else last.push(...own)
  }
  return turns
}

/**
 * What one transcript message teaches under `sources`.
 *
 * The transcript is the one input the plugin did not see arrive, and older
 * sessions may store fields in other shapes, so each field is checked here
 * and a field of the wrong shape teaches nothing.
 */
const messageFeeds = (message: SessionMessage, sources: Sources): readonly Feed[] => {
  const text = typeof message.text === 'string' ? message.text : ''
  switch (message.role) {
    case 'user':
      return text === '' || !feeds(sources, 'user') ? [] : [promptFeed(text)]
    case 'assistant':
      return feeds(sources, 'assistant') ? [...prose(text), ...storedToolUses(message.toolUses).flatMap(toolFeeds)] : []
    default:
      return []
  }
}

/** The tool calls of a stored message, keeping only those with a tool name and an input object. */
const storedToolUses = (uses: unknown): readonly ToolUse[] =>
  Array.isArray(uses) ? uses.flatMap(storedToolUse) : []

const storedToolUse = (use: unknown): readonly ToolUse[] => {
  if (typeof use !== 'object' || use === null) return []
  const tool: unknown = Reflect.get(use, 'tool')
  const input: unknown = Reflect.get(use, 'input')
  const text: unknown = Reflect.get(use, 'text')
  if (typeof tool !== 'string' || typeof input !== 'object' || input === null) return []
  return [
    {
      tool,
      input: Object.fromEntries(Object.entries(input)),
      text: typeof text === 'string' ? text : undefined,
      isError: Reflect.get(use, 'isError') === true,
    },
  ]
}
