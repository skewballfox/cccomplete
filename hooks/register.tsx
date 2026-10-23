/**
 * The hooks module. It connects the pure code in src/ to Claude Code and holds no logic of its own.
 *
 * Audience: contributors to cccomplete. The design is in docs/ARCHITECTURE.md.
 *
 * Events used, and what each does:
 *   session.start   register /cccomplete, build the index from the dictionary, the transcript and the command list
 *   tool.call       queue what a finished tool call teaches (paths, code, shell commands)
 *   command.run     count each slash command the user runs, and answer /cccomplete
 *   turn.complete   add the finished turn to the index (never on a keystroke)
 *   prompt.submit   queue the prompt for the index
 *   prompt.edit     the per-keystroke path: let the host edit, then look up and draw the inline suggestion
 *   prompt.fill     forget the suggestions when something else rewrites the box
 *   prompt.change   the same, for a recalled history entry or a cleared box
 *   prompt.autocomplete  list the matches in the host's typeahead, where tab takes one
 *   ui.render       draw the bar of suggestions above the prompt
 */

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { CompletionView } from '../types'
import { accept, actionFor, attach, clip, cycle, fittingMatches, typeaheadRows } from '../src/completion'
import type { Outcome } from '../src/completion'
import { describeDictionary, describeUnreadable, parseDictionary } from '../src/dictionary'
import { parseEnglish } from '../src/english'
import { describeKeys, describeProblem, parseConfig } from '../src/config'
import { feeds, promptFeed, toolFeeds, transcriptTurns } from '../src/feeds'
import type { Feed } from '../src/feeds'
import { formatCombo, formatPress, recordEdit, remember } from '../src/keys'
import type { KeyPress } from '../src/keys'
import { countUse, describeSize, Lexicon, parseCommandUses } from '../src/lexicon'
import { powerbar } from '../src/powerbar'
import { appendBounded, describeError, describeFailure, MAX_FAILURES, MAX_TRACE, traceEdit } from '../src/trace'

// The shape tag makes a view stored by the version that kept the suggestion in the draft read as `null`.
const view = atom({ plugin: 'cccomplete', key: 'view' } as const, null, { shape: 'virtual-1' })

/** The `$.store` key that keeps how often the user ran each slash command, across sessions. */
const COMMAND_USES = 'command-uses'

export const register: Register = (on, options) => {
  const { config, problems } = parseConfig(options)
  let lexicon = new Lexicon()
  let commandUses: Readonly<Record<string, number>> = {}
  let pending: readonly Feed[] = []
  let lastKey: KeyPress | null = null
  let recentKeys: readonly KeyPress[] = []
  let recentEdits: readonly string[] = []
  let lastMs = 0
  let worstMs = 0
  let dictionaryWords = 0
  // Failures are always kept; trace lines only when the `trace` option is on.
  let failures: readonly string[] = []
  let traces: readonly string[] = []
  const fail = (line: string): void => {
    failures = appendBounded(failures, line, MAX_FAILURES)
  }
  const trace = (line: string): void => {
    if (config.trace) traces = appendBounded(traces, line, MAX_TRACE)
  }

  const measure = <Result,>(work: () => Result): Result => {
    const started = performance.now()
    const result = work()
    lastMs = performance.now() - started
    worstMs = Math.max(worstMs, lastMs)
    return result
  }

  // A fresh index each time, so a /clear or a reload never counts the dictionary twice.
  // Each step that can fail is caught on its own, so one failure leaves the rest of the index built.
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cccomplete',
      description: 'Show the completer status and the last key it received',
    })
    const built = new Lexicon()
    // The dictionary seeds the index first, so every word from the conversation outranks it.
    const named = config.dictionary.kind === 'file' ? config.dictionary.path : null
    const fromFile = named === null ? null : await $.fs.read(named).catch(() => null)
    const text =
      config.dictionary.kind === 'none'
        ? ''
        : (fromFile ?? (await $.fs.read(`${$.plugin.root}/data/dictionary.txt`).catch(() => '')))
    dictionaryWords = built.seed(parseDictionary(text))
    trace(`session.start dictionary: ${dictionaryWords} words`)
    if (named !== null && fromFile === null) $.ui.toast(describeUnreadable(named))
    // The English counts go in after the dictionary, so a word they hold ranks by its count.
    if (config.english) {
      const english = await $.fs.read(`${$.plugin.root}/data/english.tsv`).catch((error: unknown) => {
        fail(describeError('session.start english', error))
        return ''
      })
      trace(`session.start english: ${built.seedEnglish(parseEnglish(english))} words`)
    }
    try {
      const turns = transcriptTurns(await $.session.messages(), config.sources)
      const recorded = turns.reduce((sum, turn) => sum + built.learn(turn), 0)
      trace(`session.start transcript: ${turns.length} turns, ${recorded} words`)
    } catch (error) {
      fail(describeError('session.start transcript', error))
    }
    try {
      commandUses = parseCommandUses(await $.store.get(COMMAND_USES))
    } catch (error) {
      fail(describeError('session.start store', error))
    }
    try {
      const commands = await $.command.list()
      trace(`session.start commands: ${built.setCommands(commands.map(command => command.name), commandUses)} of ${commands.length}`)
    } catch (error) {
      fail(describeError('session.start commands', error))
    }
    lexicon = built
    pending = []
    if (problems.length > 0) $.ui.toast(problems.map(describeProblem).join(' '))
    return next(e)
  }).catch((_$, e, next) => {
    fail(describeFailure('session.start', next.error))
    return next(e)
  })

  // The catch handler passes the call on: a bug here must never change what a tool returns.
  on('tool.call', async (_$, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && feeds(config.sources, 'assistant')) {
      const use = { tool: e.tool, input: e, text: result.text, isError: result.isError === true }
      pending = [...pending, ...toolFeeds(use)]
    }
    return result
  }).catch((_$, e, next) => {
    fail(describeFailure('tool.call', next.error))
    return next(e)
  })

  on('command.run', async ($, e, next) => {
    if (e.origin.kind === 'composer') {
      commandUses = countUse(commandUses, e.command)
      await $.store.set(COMMAND_USES, commandUses)
    }
    return next(e)
  }).catch((_$, e, next) => {
    fail(describeFailure('command.run', next.error))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const answer: readonly Feed[] = feeds(config.sources, 'assistant') ? [{ kind: 'prose', text: e.answer }] : []
      lexicon.learn([...pending, ...answer])
      pending = []
      const commands = await $.command.list().catch(() => null)
      if (commands !== null) lexicon.setCommands(commands.map(command => command.name), commandUses)
      trace(`turn.complete: ${describeSize(lexicon.size)}`)
    }
    return next(e)
  }).catch((_$, e, next) => {
    fail(describeFailure('turn.complete', next.error))
    return next(e)
  })

  // The catch handler passes the prompt on unchanged if this hook fails: a bug here must never block a prompt.
  on('prompt.submit', async ($, e, next) => {
    if ((await read($, view)) !== null) await update($, view, () => null)
    const typed = e.command === undefined ? e.text : e.command.args
    if ((e.origin.kind === 'composer' || e.origin.kind === 'bridge') && feeds(config.sources, 'user') && typed !== '') {
      pending = [...pending, promptFeed(typed)]
    }
    return next(e)
  }).catch((_$, e, next) => {
    fail(describeFailure('prompt.submit', next.error))
    return next(e)
  })

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

    const action = actionFor(e.key, current, { text: e.text, cursor: e.cursor }, config)
    if (action !== null && current !== null) {
      const outcome = measure(() =>
        action === 'accept'
          ? accept(current, current.index, lexicon, config)
          : cycle(current, action === 'next' ? 1 : -1, config),
      )
      await publish(outcome)
      trace(traceEdit(e.key, action, outcome, lastMs))
      return { text: outcome.box.text, cursor: outcome.box.cursor, decorations: [...outcome.box.decorations] }
    }

    const result = await next(e)
    const outcome = measure(() => attach({ text: result.text, cursor: result.cursor }, lexicon, config))
    await publish(outcome)
    trace(traceEdit(e.key, 'edit', outcome, lastMs))
    return { ...result, decorations: [...(result.decorations ?? []), ...outcome.box.decorations] }
  }).catch((_$, e, next) => {
    fail(describeFailure('prompt.edit', next.error))
    return next(e)
  })

  on('prompt.fill', async ($, e, next) => {
    if ((await read($, view)) !== null) await update($, view, () => null)
    return next(e)
  }).catch((_$, e, next) => {
    fail(describeFailure('prompt.fill', next.error))
    return next(e)
  })

  on('prompt.change', async ($, e, next) => {
    if ((await read($, view)) !== null) await update($, view, () => null)
    return next(e)
  }).catch((_$, e, next) => {
    fail(describeFailure('prompt.change', next.error))
    return next(e)
  })

  // The catch handler passes the menu on: a bug here must never hide the host's own rows.
  on('prompt.autocomplete', async (_$, e, next) => {
    const below = await next(e)
    const rows = measure(() => typeaheadRows(e, lexicon, config))
    trace(`prompt.autocomplete: ${rows.length} rows`)
    return rows.length === 0 ? below : { suggestions: [...below.suggestions, ...rows] }
  }).catch((_$, e, next) => {
    fail(describeFailure('prompt.autocomplete', next.error))
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
              await $.prompt.fill({ text: accept(live, index, lexicon, config).box.text, mode: 'replace' })
              await update($, view, () => null)
            }}
          />
        ))}
        {room >= hint.length ? <Text dimColor>{hint}</Text> : null}
      </Box>
    )
  }).catch((_$, e, next) => {
    fail(describeFailure('ui.render', next.error))
    return next(e)
  })

  on('command.run', { command: 'cccomplete' }, async () => ({
    text: [
      describeSize(lexicon.size),
      `keys: accept ${config.accept.map(formatCombo).join(' or ')}, next ${formatCombo(config.next)}, previous ${formatCombo(config.previous)}`,
      describeDictionary(config.dictionary, dictionaryWords),
      `display: ${config.display}; limit: ${config.limit}; minimum letters: ${config.minPrefix}; minimum letters added: ${config.minGain}; predict next word: ${config.predictNext}; English counts: ${config.english}; sources: ${config.sources}`,
      `last key the prompt hook received: ${lastKey === null ? 'none yet' : formatPress(lastKey)}`,
      `recent edits that are not plain typing: ${recentEdits.length === 0 ? 'none yet' : recentEdits.join('; ')}`,
      `recent keys that are not letters or digits: ${recentKeys.length === 0 ? 'none yet' : recentKeys.map(formatPress).join(', ')}`,
      `pipeline time: last ${lastMs.toFixed(3)} ms, worst ${worstMs.toFixed(3)} ms (target: under 13 ms)`,
      `failures: ${failures.length === 0 ? 'none' : failures.join('; ')}`,
      ...(config.trace ? ['trace, oldest first:', ...(traces.length === 0 ? ['  nothing yet'] : traces.map(line => `  ${line}`))] : []),
      ...problems.map(describeProblem),
    ].join('\n'),
  })).catch((_$, e, next) => {
    fail(describeFailure('command.run cccomplete', next.error))
    return next(e)
  })
}
