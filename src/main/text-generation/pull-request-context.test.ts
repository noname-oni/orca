/* eslint-disable max-lines */
// Why: PR context generation depends on command order across remote-state
// variants; keeping the table of git command mocks together makes regressions
// easier to audit than splitting the suite by helper.
import { describe, expect, it, vi } from 'vitest'
import { getPullRequestDraftContext } from './pull-request-context'

type GitExec = Parameters<typeof getPullRequestDraftContext>[0]

function createContextInput(base = 'main') {
  return {
    base,
    currentTitle: 'Existing title',
    currentBody: 'Existing body',
    currentDraft: false
  }
}

describe('getPullRequestDraftContext', () => {
  it('fetches and rebases onto the resolved remote base before collecting PR context', async () => {
    const execGit = vi.fn<GitExec>(async (args) => {
      if (args[0] === 'fetch') {
        return { stdout: '', stderr: '' }
      }
      if (args[0] === 'remote') {
        return { stdout: 'origin\nupstream\n', stderr: '' }
      }
      if (args[0] === 'for-each-ref') {
        return { stdout: 'origin/HEAD\norigin/main\nupstream/main\n', stderr: '' }
      }
      if (args[0] === 'rebase') {
        return { stdout: 'Current branch feature is up to date.\n', stderr: '' }
      }
      if (args[0] === 'rev-parse') {
        return { stdout: 'unchanged-head\n', stderr: '' }
      }
      if (args[0] === 'branch') {
        return { stdout: 'feature/pr-details\n', stderr: '' }
      }
      if (args[0] === 'merge-base') {
        return { stdout: 'abc123\n', stderr: '' }
      }
      if (args[0] === 'log') {
        return { stdout: '- feat: summarize branch\n', stderr: '' }
      }
      if (args[0] === 'diff' && args[1] === '--name-status') {
        return { stdout: 'M\tsrc/file.ts\n', stderr: '' }
      }
      if (args[0] === 'diff') {
        return { stdout: 'diff --git a/src/file.ts b/src/file.ts\n+change\n', stderr: '' }
      }
      throw new Error(`Unexpected git args: ${args.join(' ')}`)
    })

    const context = await getPullRequestDraftContext(execGit, createContextInput())

    expect(context).toMatchObject({
      branch: 'feature/pr-details',
      base: 'main',
      branchChangedByPreparation: false,
      commitSummary: '- feat: summarize branch',
      changeSummary: 'M\tsrc/file.ts'
    })
    expect(execGit).toHaveBeenCalledWith(
      ['fetch', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main'],
      expect.any(Object)
    )
    expect(execGit).toHaveBeenCalledWith(['rebase', 'origin/main'], expect.any(Object))
    expect(execGit).toHaveBeenCalledWith(['merge-base', 'origin/main', 'HEAD'], expect.any(Object))

    const commandNames = execGit.mock.calls.map(([args]) => args[0])
    expect(commandNames.indexOf('fetch')).toBeLessThan(commandNames.indexOf('rebase'))
    expect(commandNames.indexOf('rebase')).toBeLessThan(commandNames.indexOf('merge-base'))
  })

  it('fetches the preferred remote base even when the tracking ref is absent locally', async () => {
    const execGit = vi.fn<GitExec>(async (args) => {
      if (args[0] === 'fetch') {
        return { stdout: '', stderr: '' }
      }
      if (args[0] === 'remote') {
        return { stdout: 'origin\n', stderr: '' }
      }
      if (args[0] === 'for-each-ref') {
        return { stdout: '', stderr: '' }
      }
      if (args[0] === 'rebase' || args[0] === 'rev-parse') {
        return { stdout: 'unchanged-head\n', stderr: '' }
      }
      if (args[0] === 'branch') {
        return { stdout: 'feature/pr-details\n', stderr: '' }
      }
      if (args[0] === 'merge-base') {
        return { stdout: 'abc123\n', stderr: '' }
      }
      if (args[0] === 'log') {
        return { stdout: '- feat: summarize branch\n', stderr: '' }
      }
      if (args[0] === 'diff') {
        return { stdout: 'M\tREADME.md\n', stderr: '' }
      }
      throw new Error(`Unexpected git args: ${args.join(' ')}`)
    })

    await getPullRequestDraftContext(execGit, createContextInput())

    expect(execGit).toHaveBeenCalledWith(
      ['fetch', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main'],
      expect.any(Object)
    )
    expect(execGit).toHaveBeenCalledWith(['rebase', 'origin/main'], expect.any(Object))
  })

  it('does not fetch unrelated fork remotes before generating PR context', async () => {
    const execGit = vi.fn<GitExec>(async (args) => {
      if (args[0] === 'fetch') {
        expect(args).not.toContain('--all')
        expect(args[2]).toBe('origin')
        return { stdout: '', stderr: '' }
      }
      if (args[0] === 'remote') {
        return { stdout: 'origin\nstale-fork\n', stderr: '' }
      }
      if (args[0] === 'for-each-ref') {
        return {
          stdout: 'origin/main\nstale-fork/feature/from-stale-fork\n',
          stderr: ''
        }
      }
      if (args[0] === 'rebase' || args[0] === 'rev-parse') {
        return { stdout: 'unchanged-head\n', stderr: '' }
      }
      if (args[0] === 'branch') {
        return { stdout: 'feature/pr-details\n', stderr: '' }
      }
      if (args[0] === 'merge-base') {
        return { stdout: 'abc123\n', stderr: '' }
      }
      if (args[0] === 'log') {
        return { stdout: '- feat: change\n', stderr: '' }
      }
      if (args[0] === 'diff') {
        return { stdout: 'M\tREADME.md\n', stderr: '' }
      }
      throw new Error(`Unexpected git args: ${args.join(' ')}`)
    })

    await expect(getPullRequestDraftContext(execGit, createContextInput())).resolves.toMatchObject({
      branch: 'feature/pr-details'
    })

    expect(execGit).not.toHaveBeenCalledWith(['fetch', '--all', '--prune'], expect.any(Object))
    expect(execGit).not.toHaveBeenCalledWith(
      expect.arrayContaining(['stale-fork']),
      expect.any(Object)
    )
  })

  it('does not guess between multiple non-preferred remote bases for a bare base name', async () => {
    const execGit = vi.fn<GitExec>(async (args) => {
      if (args[0] === 'fetch') {
        throw new Error(`Unexpected fetch: ${args.join(' ')}`)
      }
      if (args[0] === 'remote') {
        return { stdout: 'contributor-a\ncontributor-b\n', stderr: '' }
      }
      if (args[0] === 'for-each-ref') {
        return { stdout: 'contributor-a/main\ncontributor-b/main\n', stderr: '' }
      }
      if (args[0] === 'rebase') {
        expect(args[1]).toBe('main')
        return { stdout: '', stderr: '' }
      }
      if (args[0] === 'rev-parse') {
        return { stdout: 'unchanged-head\n', stderr: '' }
      }
      if (args[0] === 'branch') {
        return { stdout: 'feature\n', stderr: '' }
      }
      if (args[0] === 'merge-base') {
        expect(args[1]).toBe('main')
        return { stdout: 'abc123\n', stderr: '' }
      }
      if (args[0] === 'log') {
        return { stdout: '- feat: change\n', stderr: '' }
      }
      if (args[0] === 'diff') {
        return { stdout: 'M\tREADME.md\n', stderr: '' }
      }
      throw new Error(`Unexpected git args: ${args.join(' ')}`)
    })

    await getPullRequestDraftContext(execGit, createContextInput())

    expect(execGit).not.toHaveBeenCalledWith(
      expect.arrayContaining(['contributor-a']),
      expect.any(Object)
    )
    expect(execGit).not.toHaveBeenCalledWith(
      expect.arrayContaining(['contributor-b']),
      expect.any(Object)
    )
  })

  it('reports when preparation changes HEAD', async () => {
    let revParseCount = 0
    const execGit = vi.fn<GitExec>(async (args) => {
      if (args[0] === 'fetch' || args[0] === 'rebase') {
        return { stdout: '', stderr: '' }
      }
      if (args[0] === 'remote') {
        return { stdout: 'origin\n', stderr: '' }
      }
      if (args[0] === 'for-each-ref') {
        return { stdout: 'origin/main\n', stderr: '' }
      }
      if (args[0] === 'rev-parse') {
        revParseCount += 1
        return { stdout: `${revParseCount === 1 ? 'old-head' : 'new-head'}\n`, stderr: '' }
      }
      if (args[0] === 'branch') {
        return { stdout: 'feature\n', stderr: '' }
      }
      if (args[0] === 'merge-base') {
        return { stdout: 'abc123\n', stderr: '' }
      }
      if (args[0] === 'log') {
        return { stdout: '- feat: change\n', stderr: '' }
      }
      if (args[0] === 'diff') {
        return { stdout: 'M\tREADME.md\n', stderr: '' }
      }
      throw new Error(`Unexpected git args: ${args.join(' ')}`)
    })

    const context = await getPullRequestDraftContext(execGit, createContextInput())

    expect(context?.branchChangedByPreparation).toBe(true)
  })

  it('keeps a remote-qualified base when the selected base includes the remote', async () => {
    const execGit = vi.fn<GitExec>(async (args) => {
      if (args[0] === 'fetch' || args[0] === 'rebase') {
        return { stdout: '', stderr: '' }
      }
      if (args[0] === 'remote') {
        return { stdout: 'origin\nupstream\n', stderr: '' }
      }
      if (args[0] === 'for-each-ref') {
        return { stdout: 'origin/main\nupstream/main\n', stderr: '' }
      }
      if (args[0] === 'branch') {
        return { stdout: 'feature\n', stderr: '' }
      }
      if (args[0] === 'rev-parse') {
        return { stdout: 'abc123\n', stderr: '' }
      }
      if (args[0] === 'merge-base') {
        return { stdout: 'abc123\n', stderr: '' }
      }
      if (args[0] === 'log') {
        return { stdout: '- feat: change\n', stderr: '' }
      }
      if (args[0] === 'diff') {
        return { stdout: 'M\tREADME.md\n', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })

    await getPullRequestDraftContext(execGit, createContextInput('upstream/main'))

    expect(execGit).toHaveBeenCalledWith(
      ['fetch', '--no-tags', 'upstream', '+refs/heads/main:refs/remotes/upstream/main'],
      expect.any(Object)
    )
    expect(execGit).toHaveBeenCalledWith(['rebase', 'upstream/main'], expect.any(Object))
    expect(execGit).toHaveBeenCalledWith(
      ['merge-base', 'upstream/main', 'HEAD'],
      expect.any(Object)
    )
  })

  it('stops generation when the rebase fails', async () => {
    const execGit = vi.fn<GitExec>(async (args) => {
      if (args[0] === 'fetch') {
        return { stdout: '', stderr: '' }
      }
      if (args[0] === 'remote') {
        return { stdout: 'origin\n', stderr: '' }
      }
      if (args[0] === 'for-each-ref') {
        return { stdout: 'origin/main\n', stderr: '' }
      }
      if (args[0] === 'rev-parse') {
        return { stdout: 'abc123\n', stderr: '' }
      }
      if (args[0] === 'rebase') {
        throw new Error('Command failed: git rebase origin/main\nCONFLICT (content): README.md')
      }
      throw new Error(`Unexpected git args: ${args.join(' ')}`)
    })

    await expect(getPullRequestDraftContext(execGit, createContextInput())).rejects.toThrow(
      'Rebase before generating PR details failed: CONFLICT (content): README.md'
    )
    expect(execGit).not.toHaveBeenCalledWith(
      ['merge-base', 'origin/main', 'HEAD'],
      expect.anything()
    )
  })

  it('stops generation when the relevant base fetch fails', async () => {
    const execGit = vi.fn<GitExec>(async (args) => {
      if (args[0] === 'remote') {
        return { stdout: 'origin\nstale-fork\n', stderr: '' }
      }
      if (args[0] === 'for-each-ref') {
        return { stdout: 'origin/main\nstale-fork/main\n', stderr: '' }
      }
      if (args[0] === 'fetch') {
        if (args[2] !== 'origin') {
          throw new Error(`Fetched unrelated remote: ${args.join(' ')}`)
        }
        throw new Error(
          'Command failed: git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main\nfatal: unable to access origin'
        )
      }
      throw new Error(`Unexpected git args: ${args.join(' ')}`)
    })

    await expect(getPullRequestDraftContext(execGit, createContextInput())).rejects.toThrow(
      'Fetch before generating PR details failed: fatal: unable to access origin'
    )
  })

  it('returns null without running git when the base is invalid', async () => {
    const execGit = vi.fn<GitExec>()

    await expect(getPullRequestDraftContext(execGit, createContextInput('--main'))).resolves.toBe(
      null
    )
    expect(execGit).not.toHaveBeenCalled()
  })
})
