// The sample agent, pinned.
//
// The failure this file exists to prevent is a sample that *claims* to show
// the product's promise while carrying an answer somebody wrote by hand. The
// promise is that the answer cites its source; a sample that faked the citation
// would teach the wrong thing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EXAMPLE_AGENT_NAME,
  EXAMPLE_DOCUMENTS,
  EXAMPLE_KB_NAME,
  EXAMPLE_QUESTION,
} from '../../src/lib/example-agent';
import { tokenize } from '../../src/lib/knowledge';

const SRC = readFileSync(new URL('../../src/lib/example-agent.ts', import.meta.url), 'utf8');

test('the sample is unmistakably example data', () => {
  assert.match(EXAMPLE_AGENT_NAME, /^Example: /, 'the agent says what it is');
  assert.match(EXAMPLE_KB_NAME, /^Example: /, 'and so does the handbook');
  // The handbook is about an imaginary company, so no reader can mistake it for
  // the customer's own documents.
  assert.match(EXAMPLE_DOCUMENTS[0].text, /Acme|refund|shipping/i);
});

test('the answer is the product\'s own — the loader runs the real runner', () => {
  assert.match(SRC, /runAgentRun\(/, 'the sample must run through the runner a real run uses');
  assert.match(SRC, /ingestDocument\(/, 'and the documents must be ingested the real way');
  assert.ok(
    !/reply:\s*"|answer:\s*"/.test(SRC),
    'nothing here may write an answer — the runner writes it',
  );
});

test('the sample needs no API key to be honest', () => {
  // An empty model means the runner answers from the approved sources (and
  // escalates when they do not hold the answer) — so a first run never depends
  // on a key the buyer has not got.
  assert.match(SRC, /model:\s*""/, 'the sample agent carries no model');
  assert.match(SRC, /escalate_to_human/, 'and it can still hand over to a human');
});

test('the sample asks a question its own handbook answers', () => {
  // The retriever is keyword-based, so the question and the documents have to
  // share words — otherwise the sample answers "I could not find a confident
  // answer" and demonstrates nothing.
  // The retriever's own tokeniser decides what counts, so the check uses it: the
  // question must overlap a source, and the source it overlaps must be the one
  // that answers it — otherwise the sample cites the wrong page.
  const words = tokenize(EXAMPLE_QUESTION).filter((w) => w.length > 2);
  assert.ok(words.length > 0, 'the question must survive the tokeniser');
  const hits = EXAMPLE_DOCUMENTS.filter((d) =>
    words.some((w) => d.text.toLowerCase().includes(w)),
  );
  assert.ok(hits.length > 0, 'the retriever would find no source at all');
  assert.equal(
    hits[0].title,
    EXAMPLE_DOCUMENTS[0].title,
    'the top hit must be the document that answers the question',
  );
});

test('loading twice changes nothing', () => {
  assert.match(SRC, /if \(existing\) return \{ created: false/, 'a second load must be a no-op');
});

test('the removal takes the sample and only the sample', () => {
  assert.match(SRC, /name: EXAMPLE_AGENT_NAME/, 'the agent is found by its example name');
  assert.match(SRC, /name: EXAMPLE_KB_NAME/, 'and so is the handbook');
  // The runs, the documents and the chunks cascade from those rows.
  assert.match(SRC, /prisma\.agent\.deleteMany/, 'the agent goes');
  assert.match(SRC, /prisma\.knowledgeBase\.deleteMany/, 'and the handbook goes with it');
});

test('the door is a session or a key — the browser and the machine both count', () => {
  const route = readFileSync(new URL('../../src/app/api/example-data/route.ts', import.meta.url), 'utf8');
  assert.match(route, /getSession\(\)/, "the dashboard's browser path");
  assert.match(route, /authedWorkspaceId\(request\)/, "the API's machine path");
  assert.match(route, /status: 401/, 'and an anonymous caller is refused');
});
