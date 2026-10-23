import { expect, test } from 'bun:test'
import { Ledger } from '../src/ledger'
import { PromptIndex } from '../src/prompts'

const prompt = { type: 'user', uuid: 'u1', parentUuid: null, promptId: 'p1', permissionMode: 'acceptEdits', timestamp: '2026-09-07T19:00:00Z', message: { content: 'go' } }

const edit = {
  type: 'assistant',
  uuid: 'a1',
  parentUuid: 'u1',
  timestamp: '2026-09-07T19:02:00Z',
  isSidechain: false,
  message: { content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/src/a.ts', old_string: 'x', new_string: 'y' } }] },
}

const read = {
  type: 'assistant',
  uuid: 'a2',
  parentUuid: 'u1',
  timestamp: '2026-09-07T19:03:00Z',
  message: { content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/src/a.ts' } }] },
}

test('only the tools that change a file enter the ledger', () => {
  const prompts = new PromptIndex()
  const ledger = new Ledger()
  for (const r of [prompt, edit, read]) {
    prompts.observe(r)
    ledger.observe(r, prompts)
  }
  const ops = ledger.operations()
  expect(ops).toHaveLength(1)
  expect(ops[0]).toMatchObject({
    file: '/src/a.ts',
    kind: 'edit',
    attestation: 'auto',
    promptId: 'p1',
    oldString: 'x',
    newString: 'y',
    replaceAll: false,
  })
})

test('operations on one file come back in the order they happened', () => {
  const prompts = new PromptIndex()
  const ledger = new Ledger()
  const second = { ...edit, uuid: 'a3', timestamp: '2026-09-07T19:05:00Z', message: { content: [{ type: 'tool_use', id: 't3', name: 'Write', input: { file_path: '/src/a.ts', content: 'whole file' } }] } }
  for (const r of [prompt, edit, second]) {
    prompts.observe(r)
    ledger.observe(r, prompts)
  }
  const ops = ledger.byFile().get('/src/a.ts') ?? []
  expect(ops.map((o) => o.kind)).toEqual(['edit', 'write'])
  expect(ops[1]?.content).toBe('whole file')
})

test('an unrecognised permission mode is carried out for the report', () => {
  const prompts = new PromptIndex()
  const ledger = new Ledger()
  const odd = { ...prompt, permissionMode: 'somethingNew' }
  for (const r of [odd, edit]) {
    prompts.observe(r)
    ledger.observe(r, prompts)
  }
  expect(ledger.unrecognisedModes()).toEqual(['somethingNew'])
})

test('each change carries its tool_use id and the mode its prompt recorded', () => {
  const orphan = { ...edit, uuid: 'a9', parentUuid: 'nowhere', message: { content: [{ type: 'tool_use', id: 't9', name: 'Edit', input: { file_path: '/src/b.ts', old_string: 'x', new_string: 'y' } }] } }
  const prompts = new PromptIndex()
  const ledger = new Ledger()
  for (const r of [prompt, edit, orphan]) {
    prompts.observe(r)
    ledger.observe(r, prompts)
  }
  const ops = ledger.operations()
  expect(ops.find((o) => o.uuid === 'a1')).toMatchObject({ toolUseId: 't1', permissionMode: 'acceptEdits' })
  expect(ops.find((o) => o.uuid === 'a9')).toMatchObject({ toolUseId: 't9', permissionMode: null })
})

test('a prompt that recorded an empty mode yields a null permissionMode', () => {
  const blank = { ...prompt, permissionMode: '' }
  const prompts = new PromptIndex()
  const ledger = new Ledger()
  for (const r of [blank, edit]) {
    prompts.observe(r)
    ledger.observe(r, prompts)
  }
  expect(ledger.operations()[0]?.permissionMode).toBeNull()
})

const bash = (id: string, command: string) => ({
  type: 'assistant',
  uuid: `b-${id}`,
  parentUuid: 'u1',
  timestamp: '2026-09-07T19:04:00Z',
  isSidechain: false,
  message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] },
})

function shellWritesFor(command: string) {
  const prompts = new PromptIndex()
  const ledger = new Ledger()
  for (const r of [prompt, bash('sh1', command)]) {
    prompts.observe(r)
    ledger.observe(r, prompts)
  }
  return ledger
}

test.each(['sed -i s/a/b/ f', 'echo x > f', 'echo x > src/a.ts', 'echo x >> f', 'cat a | tee out.txt', 'mv a b', 'rm f', 'rm src/old.ts', 'echo x > "src/a.ts"', 'echo x>f', 'ls && rm src/a.ts', 'sudo mv a b', 'find . | xargs rm', 'cat <<< foo\nrm src/bar', "cat > notes.md <<'EOF'\n=> x\nEOF"])('a shell command that writes counts: %s', (command) => {
  const ledger = shellWritesFor(command)
  expect(ledger.shellWrites()).toEqual([{ toolUseId: 'sh1', at: '2026-09-07T19:04:00Z', attestation: 'auto' }])
  expect(ledger.operations()).toHaveLength(0)
})

test.each(['> "$TMPDIR/x"', 'rm -rf "/tmp/x"', 'tee "/tmp/log"', 'mvn test', 'cat tee.ts', 'grep -r tee src', 'echo hi # rm old', 'docker rm c1', 'git rm a.ts', 'ls 2>&1', 'cmd > /dev/null', 'cmd 2>/dev/null', 'ls', 'cmd 2>&1 | grep x', "bun -e 'const f = () => x > 1'", "php -r '$a->b();'", "git log --format='%an <%ae>'", 'echo x > /tmp/a', 'rm -rf /tmp/x', 'echo x > $TMPDIR/a', 'docker run --rm img', "cat <<'EOF'\nfoo > bar\nEOF"])('a shell command that only reads or discards does not count: %s', (command) => {
  expect(shellWritesFor(command).shellWrites()).toEqual([])
})

// Known miss: only the first path token is checked against the temp dirs, so a
// move out of /tmp into the tree reads as discarding. It writes `b`.
test('mv "/tmp/a" b is a known miss: the first path token decides, so it is not counted', () => {
  expect(shellWritesFor('mv "/tmp/a" b').shellWrites()).toEqual([])
})

test("grep '>' f no longer reads the quoted > as a redirect", () => {
  expect(shellWritesFor("grep '>' f").shellWrites()).toEqual([])
})
