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

test.each(['sed -i s/a/b/ f', 'echo x > f', 'echo x > src/a.ts', 'echo x >> f', 'cat a | tee out.txt', 'mv a b', 'rm f', 'rm src/old.ts', 'echo x > "src/a.ts"', 'echo x>f', 'echo "done">status.txt', "printf '%s' 'x'>>log.md", '(make)>log', 'ls && rm src/a.ts', 'sudo mv a b', 'find . | xargs rm', 'cat <<< foo\nrm src/bar', "cat > notes.md <<'EOF'\n=> x\nEOF"])('a shell command that writes counts: %s', (command) => {
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

/** A user record carrying the tool_result for one tool_use id. */
const result = (id: string, isError: boolean | undefined) => ({
  type: 'user',
  uuid: `r-${id}`,
  parentUuid: `b-${id}`,
  timestamp: '2026-09-07T19:04:01Z',
  message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: isError ? 'Permission to use Bash has been denied.' : 'ok' }] },
})

function observeAll(records: object[]) {
  const prompts = new PromptIndex()
  const ledger = new Ledger()
  for (const r of records) {
    prompts.observe(r as Record<string, unknown>)
    ledger.observe(r as Record<string, unknown>, prompts)
  }
  return ledger
}

test('a shell write whose tool_result is an error or a denial is not counted', () => {
  const ledger = observeAll([prompt, bash('sh1', 'rm a'), result('sh1', true), bash('sh2', 'rm b'), result('sh2', false), bash('sh3', 'rm c')])
  expect(ledger.shellWrites().map((w) => w.toolUseId)).toEqual(['sh2', 'sh3'])
})

test('an error result observed before its call still excludes it', () => {
  const ledger = observeAll([prompt, result('sh1', true), bash('sh1', 'rm a')])
  expect(ledger.shellWrites()).toEqual([])
})

test.each([
  'if true; then rm src/a.ts; fi',
  'for f in a b; do rm "$f"; done',
  'if x; then :; else mv a b; fi',
  '{ rm src/a.ts; }',
  'FOO=1 rm src/a.ts',
  'A=1 B=2 sudo mv a b',
  'sed -n -i s/a/b/ f',
  'sed -Ei s/a/b/ f',
  'sed -i.bak s/a/b/ f',
  'sed --in-place s/a/b/ f',
  'sed --in-place=.bak s/a/b/ f',
  'find . -name x -exec sed -i s/a/b/ {} +',
  'echo \\" > f',
  "echo $'it\\'s' > f",
  'echo x>f',
])('a write in a newly recognised position counts: %s', (command) => {
  expect(shellWritesFor(command).shellWrites()).toHaveLength(1)
})

test.each([
  'sed -n s/a/b/p f',
  'sed -e s/i/x/ f',
  'grep -c "Array<string>" f',
  'bun -e x Array<string>',
  'tsc --noEmit Map<K,V>',
  'echo x->y',
  "echo $'a\\'b > c'",
  'echo \\> f',
  'then',
  'FOO=1',
])('a command with no write in it still does not count: %s', (command) => {
  expect(shellWritesFor(command).shellWrites()).toEqual([])
})

test('quote stripping is linear: a long run of escaped quotes finishes fast', () => {
  const long = `echo ${'\\"'.repeat(50_000)}`
  const started = performance.now()
  expect(shellWritesFor(long).shellWrites()).toEqual([])
  expect(shellWritesFor(`${long} > f`).shellWrites()).toHaveLength(1)
  expect(shellWritesFor(`echo "${'\\a'.repeat(50_000)}`).shellWrites()).toEqual([])
  expect(performance.now() - started).toBeLessThan(1000)
})

test('an edit whose tool call failed is left out of the changes and returned as failed', () => {
  const prompts = new PromptIndex()
  const ledger = new Ledger()
  const failure = {
    type: 'user',
    uuid: 'r1',
    parentUuid: 'a1',
    timestamp: '2026-09-07T19:02:01Z',
    message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'String to replace not found in file.' }] },
  }
  for (const r of [prompt, edit, failure]) {
    prompts.observe(r)
    ledger.observe(r, prompts)
  }
  expect(ledger.operations()).toEqual([])
  expect([...ledger.byFile().keys()]).toEqual([])
  expect(ledger.failedOperations().map((o) => o.toolUseId)).toEqual(['t1'])
})

/** A user record answering one tool call with an error carrying `content`. */
const errored = (id: string, content: string) => ({
  type: 'user',
  uuid: `r-${id}`,
  parentUuid: `b-${id}`,
  timestamp: '2026-09-07T19:04:01Z',
  message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content }] },
})

test('a shell write that ran and exited non-zero is still counted; one refused before it ran is not', () => {
  const ledger = observeAll([
    prompt,
    bash('sh1', 'rm a'),
    errored('sh1', 'Exit code 1\nrm: cannot remove b: No such file or directory'),
    bash('sh2', 'rm b'),
    errored('sh2', 'PreToolUse:Bash hook error: blocked'),
    bash('sh3', 'rm c'),
    errored('sh3', "The user doesn't want to proceed with this tool use. The tool use was rejected."),
    bash('sh4', 'rm d'),
    errored('sh4', 'The server-side auto mode classifier gave no verdict (error), so auto mode cannot determine the safety of Bash.'),
  ])
  expect(ledger.shellWrites().map((w) => w.toolUseId)).toEqual(['sh1'])
})

test('an edit is left out on any error, an exit code included', () => {
  const ledger = observeAll([prompt, edit, errored('t1', 'Exit code 1')])
  expect(ledger.operations()).toEqual([])
  expect(ledger.failedOperations().map((o) => o.toolUseId)).toEqual(['t1'])
})

test('an unrecognised permission mode is named only when a change made under it landed', () => {
  const odd = { ...prompt, permissionMode: 'someNewMode' }
  const failedOnly = observeAll([odd, edit, errored('t1', 'String to replace not found in file.')])
  expect(failedOnly.unrecognisedModes()).toEqual([])
  const landed = observeAll([odd, edit])
  expect(landed.unrecognisedModes()).toEqual(['someNewMode'])
})

test.each([
  'sort<in>out',
  'wc -l<a>b',
  'cat <<EOF>out\nbody\nEOF',
  '\\rm a',
  'command rm a',
  'env rm a',
  'env -u HOME FOO=1 rm a',
  'nohup rm a',
  'time rm a',
  'sudo -u bob rm a',
  'sudo -u bob -g staff mv a b',
  'xargs -I {} rm {}',
  'sed -e s/a/b/ -i f',
  'sed -n -e s/a/b/p --in-place f',
  'sed -f script.sed -i f',
])('a write behind a wrapper, an escape or a later option counts: %s', (command) => {
  expect(shellWritesFor(command).shellWrites()).toHaveLength(1)
})

test.each(['echo Map<K,V>', 'echo Array<string>', 'f Array<string> x', 'echo x->y', 'command -v rm', 'sudo -u rm ls', 'sed -e s/i/x/ f', 'sed -e -i f'])(
  'a type, an arrow or a lookup still does not count: %s',
  (command) => {
    expect(shellWritesFor(command).shellWrites()).toEqual([])
  },
)

test('the cases left as they are: echo sed -i still counts, $(...) is not unpicked', () => {
  expect(shellWritesFor('echo sed -i').shellWrites()).toHaveLength(1)
  expect(shellWritesFor('x=$(rm a)').shellWrites()).toHaveLength(1)
})
