import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

async function loadCore() {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  const match = html.match(/<script id="memory-span-app">([\s\S]*?)<\/script>/);
  assert.ok(match, 'index.html should include the memory-span-app script');

  const sandbox = {
    window: {},
    document: {
      addEventListener() {},
      getElementById() {
        return null;
      },
    },
    Blob: class Blob {},
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    performance: { now: () => 0 },
    setTimeout() {},
    clearTimeout() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(match[1], sandbox);
  return sandbox.window.MemorySpanCore;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('uses a 1 second retention interval in every generated trial', async () => {
  const core = await loadCore();
  const trials = core.buildTrials({
    mode: 'digits',
    random: () => 0.42,
    shuffle: (items) => items,
  });

  assert.equal(core.RETENTION_INTERVAL_MS, 1000);
  assert.equal(trials.length, 12);
  assert.deepEqual(
    plain(
    trials.map((trial) => trial.retentionMs),
    ),
    Array(12).fill(1000),
  );
  assert.deepEqual(
    plain(
    trials.map((trial) => trial.sequence.length),
    ),
    [3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6],
  );
});

test('generates digit and word sequences without repeating items inside a trial', async () => {
  const core = await loadCore();
  const digitSequence = core.generateSequence('digits', 6, () => 0.01);
  const wordSequence = core.generateSequence('words', 6, () => 0.01);

  assert.equal(digitSequence.length, 6);
  assert.equal(new Set(digitSequence).size, 6);
  assert.ok(digitSequence.every((item) => /^[1-9]$/.test(item)));

  assert.equal(wordSequence.length, 6);
  assert.equal(new Set(wordSequence).size, 6);
  assert.ok(wordSequence.every((item) => typeof item === 'string' && item.length > 1));
});

test('scores exact correctness and per-position correctness', async () => {
  const core = await loadCore();

  assert.deepEqual(plain(core.scoreResponse(['5', '2', '9', '1'], '5291')), {
    normalizedResponse: ['5', '2', '9', '1'],
    exactCorrect: true,
    positionCorrect: [1, 1, 1, 1],
  });

  assert.deepEqual(plain(core.scoreResponse(['river', 'chair', 'apple'], 'river apple chair', 'words')), {
    normalizedResponse: ['river', 'apple', 'chair'],
    exactCorrect: false,
    positionCorrect: [1, 0, 0],
  });
});

test('summarizes accuracy, span, and exports required CSV columns', async () => {
  const core = await loadCore();
  const rows = [
    core.createResultRow({ participantId: 'p1', trialIndex: 1, trial: { mode: 'digits', sequence: ['1', '2', '3'], retentionMs: 1000 }, response: '123', responseTimeMs: 1100, previousSequence: [] }),
    core.createResultRow({ participantId: 'p1', trialIndex: 2, trial: { mode: 'digits', sequence: ['4', '5', '6'], retentionMs: 1000 }, response: '456', responseTimeMs: 1200, previousSequence: ['1', '2', '3'] }),
    core.createResultRow({ participantId: 'p1', trialIndex: 3, trial: { mode: 'digits', sequence: ['7', '8', '9'], retentionMs: 1000 }, response: '789', responseTimeMs: 1300, previousSequence: ['4', '5', '6'] }),
    core.createResultRow({ participantId: 'p1', trialIndex: 4, trial: { mode: 'digits', sequence: ['1', '2', '3', '4'], retentionMs: 1000 }, response: '1230', responseTimeMs: 1400, previousSequence: ['7', '8', '9'] }),
  ];

  const summary = core.summarizeResults(rows);
  assert.equal(summary.totalTrials, 4);
  assert.equal(summary.exactAccuracy, 0.75);
  assert.equal(summary.estimatedSpan, 3);

  const csv = core.toCsv(rows);
  assert.ok(csv.startsWith('participant_id,trial_index,sequence_length,target_sequence,response,exact_correct,position_correct,response_time_ms,timestamp,mode,retention_interval_ms,previous_sequence'));
  assert.match(csv, /p1,1,3,123,123,1,111,1100,/);
});

test('builds a Google Sheets payload with participant metadata and trial rows', async () => {
  const core = await loadCore();
  const rows = [
    core.createResultRow({ participantId: 'p1', trialIndex: 1, trial: { mode: 'digits', sequence: ['1', '2', '3'], retentionMs: 1000 }, response: '123', responseTimeMs: 1100, previousSequence: [] }),
  ];

  assert.deepEqual(plain(core.buildSheetsPayload({ participantId: 'p1', mode: 'digits', rows })), {
    participant_id: 'p1',
    mode: 'digits',
    retention_interval_ms: 1000,
    row_count: 1,
    rows: plain(rows),
  });
});
