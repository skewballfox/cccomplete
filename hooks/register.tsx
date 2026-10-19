/**
 * The hooks module. It connects the pure code in src/ to Claude Code and holds no logic of its own.
 *
 * Audience: contributors to cccomplete. The design is in docs/ARCHITECTURE.md.
 *
 * Events used, and what each does:
 *   session.start   register /cccomplete, seed the trie from the transcript
 *   turn.complete   add the finished turn's text to the trie (never on a keystroke)
 *   prompt.submit   remove a leftover inline suggestion, queue the prompt for the trie
 *   prompt.edit     the per-keystroke path: detach, let the host edit, attach
 *   prompt.fill     forget the suggestions when something else rewrites the box
 *   ui.render       draw the bar of suggestions above the prompt
 *   command.run     answer /cccomplete
 */

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { CompletionView } from '../types'
import { accept, actionFor, attach, clip, cycle, detach, fittingMatches, withoutGhost } from '../src/completion'
import type { EditShape, Outcome } from '../src/completion'
import { describeDictionary, describeUnreadable, parseDictionary, seedTrie } from '../src/dictionary'
import { describeKeys, describeProblem, parseConfig } from '../src/config'
import type { Sources } from '../src/config'
import { formatCombo, formatPress, recordEdit, remember } from '../src/keys'
import type { KeyPress } from '../src/keys'
import { powerbar } from '../src/powerbar'
import { CompletionTrie } from '../src/trie'

const view = atom({ plugin: 'cccomplete', key: 'view' } as const, null)

/** True when text written by `role` feeds the trie under `sources`. */
const feeds = (sources: Sources, role: 'user' | 'assistant'): boolean =>
  sources === 'both' || (sources === 'prompts') === (role === 'user')

export const register: Register = (on, options) => {
  const { config, problems } = parseConfig(options)
  const trie = new CompletionTrie()
  const pending: string[] = []
  let lastKey: KeyPress | null = null
  let recentKeys: readonly KeyPress[] = []
  let recentEdits: readonly string[] = []
  let lastMs = 0
  let worstMs = 0
  let dictionaryWords = 0

  const measure = <Result,>(work: () => Result): Result => {
    const started = performance.now()
    const result = work()
    lastMs = performance.now() - started
    worstMs = Math.max(worstMs, lastMs)
    return result
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cccomplete',
      description: 'Show the completer status and the last key it received',
    })
    // The dictionary seeds the index first, so every word from the conversation outranks it.
    const named = config.dictionary.kind === 'file' ? config.dictionary.path : null
    const fromFile = named === null ? null : await $.fs.read(named).catch(() => null)
    const text =
      config.dictionary.kind === 'none'
        ? ''
        : (fromFile ?? (await $.fs.read(`${$.plugin.root}/data/dictionary.txt`).catch(() => '')))
    dictionaryWords = seedTrie(trie, parseDictionary(text))
    if (named !== null && fromFile === null) $.ui.toast(describeUnreadable(named))
    const rows = await $.session.messages()
    rows.filter(row => feeds(config.sources, row.role)).forEach(row => trie.ingest(row.text))
    if (problems.length > 0) $.ui.toast(problems.map(describeProblem).join(' '))
    return next(e)
  })

  on('turn.complete', async (_$, e, next) => {
    if (e.agentId === undefined) {
      const prompts = pending.splice(0)
      if (config.sources !== 'answers') prompts.forEach(text => trie.ingest(text))
      if (config.sources !== 'prompts') trie.ingest(e.answer)
    }
    return next(e)
  })

  // The catch handler passes the prompt on unchanged if this hook fails: a bug here must never block a prompt.
  on('prompt.submit', async ($, e, next) => {
    const current = await read($, view)
    const text = withoutGhost(e.text, current)
    if (current !== null) await update($, view, () => null)
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') pending.push(text)
    return next(text === e.text ? e : { ...e, text })
  }).catch((_$, e, next) => next(e))

  on('prompt.edit', async ($, e, next) => {
    const current = await read($, view)
    const publish = async (outcome: Outcome): Promise<void> => {
      if (current !== null || outcome.view !== null) await update($, view, () => outcome.view)
    }
    if (e.key !== undefined) {
      lastKey = e.key
      recentKeys = remember(recentKeys, e.key, 6)
    }
    recentEdits = recordEdit(recentEdits, { key: e.key ?? null, inputText: e.inputText, start: e.start, end: e.end }, 6)

    const action = actionFor(e.key, current, config)
    if (action !== null && current !== null) {
      const outcome = measure(() =>
        action === 'accept' ? accept(current, current.index, config) : cycle(current, action === 'next' ? 1 : -1, config),
      )
      await publish(outcome)
      return { text: outcome.box.text, cursor: outcome.box.cursor, decorations: [...outcome.box.decorations] }
    }

    const edit: EditShape = {
      text: e.text,
      cursor: e.cursor,
      start: e.start,
      end: e.end,
      inputText: e.inputText,
    }
    const clean = measure(() => detach(edit, current))
    const result = await next(clean === edit ? e : { ...e, ...clean })
    const outcome = measure(() => attach({ text: result.text, cursor: result.cursor }, trie, config))
    await publish(outcome)
    return {
      text: outcome.box.text,
      cursor: outcome.box.cursor,
      decorations: [...(result.decorations ?? []), ...outcome.box.decorations],
    }
  })

  on('prompt.fill', async ($, e, next) => {
    if ((await read($, view)) !== null) await update($, view, () => null)
    return next(e)
  })

  // The band is one row high whether or not there are matches, so the prompt does not jump as you type.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || config.display === 'inline') return next(e)
    const current: CompletionView | null = await read($, view)

    const { Box, Button, Text } = $.ui.resolve(e)
    const hint = describeKeys(config)
    if (config.barStyle === 'powerline') {
      const runs = powerbar(current?.matches ?? [], current?.index ?? 0, hint, e.props.bodyColumns)
      return (
        <Box>
          {runs.map((run, index) => (
            <Text
              key={`run-${index}`}
              color={run.color}
              {...(run.background === null ? {} : { backgroundColor: run.background })}
              dimColor={run.dim}
            >
              {run.text}
            </Text>
          ))}
        </Box>
      )
    }
    if (current === null) {
      return (
        <Box>
          <Text dimColor>{clip(hint, e.props.bodyColumns)}</Text>
        </Box>
      )
    }

    const shown = fittingMatches(current.matches, e.props.bodyColumns)
    const room = e.props.bodyColumns - shown.reduce((used, match) => used + match.word.length + 5, 0)

    return (
      <Box gap={1}>
        {shown.map((match, index) => (
          <Button
            key={`match-${index}`}
            label={match.word}
            variant={index === current.index ? 'primary' : 'secondary'}
            onPress={async () => {
              const live = await read($, view)
              if (live === null) return
              await $.prompt.fill({ text: accept(live, index, config).box.text, mode: 'replace' })
              await update($, view, () => null)
            }}
          />
        ))}
        {room >= hint.length ? <Text dimColor>{hint}</Text> : null}
      </Box>
    )
  })

  on('command.run', { command: 'cccomplete' }, async () => ({
    text: [
      `words indexed: ${trie.size}`,
      `keys: accept ${config.accept.map(formatCombo).join(' or ')}, next ${formatCombo(config.next)}, previous ${formatCombo(config.previous)}`,
      describeDictionary(config.dictionary, dictionaryWords),
      `display: ${config.display}; limit: ${config.limit}; minimum letters: ${config.minPrefix}; sources: ${config.sources}`,
      `last key the prompt hook received: ${lastKey === null ? 'none yet' : formatPress(lastKey)}`,
      `recent edits that are not plain typing: ${recentEdits.length === 0 ? 'none yet' : recentEdits.join('; ')}`,
      `recent keys that are not letters or digits: ${recentKeys.length === 0 ? 'none yet' : recentKeys.map(formatPress).join(', ')}`,
      `pipeline time: last ${lastMs.toFixed(3)} ms, worst ${worstMs.toFixed(3)} ms (target: under 13 ms)`,
      ...problems.map(describeProblem),
    ].join('\n'),
  }))
}
