const request = require('supertest');
const app = require('./app');

describe('GET /api/leaderboard', () => {
  it('returns 200 and an array', async () => {
    const res = await request(app).get('/api/leaderboard');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /api/submit-score', () => {
  it('rejects an invalid body with 400 or 403', async () => {
    const res = await request(app)
      .post('/api/submit-score')
      .send({ playerName: 'TST', seed: 'bad', finalScore: 999, actions: [] });
    expect([400, 403]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });
});

describe('Leaderboard after submit', () => {
  it('GET /api/leaderboard returns entries added via addScore directly', () => {
    // Test the store function directly — avoids needing a real verified run
    const { addScore, getLeaderboard } = require('./app');
    addScore({ playerName: 'AAA', score: 100, submittedAt: new Date().toISOString() });
    const board = getLeaderboard();
    expect(board.length).toBeGreaterThan(0);
    expect(board[0].playerName).toBe('AAA');
  });
});

describe('addScore cap', () => {
  it('keeps only the top 10 entries', () => {
    const { addScore, getLeaderboard, clearLeaderboard } = require('./app');
    clearLeaderboard(); // reset shared in-memory state before this test
    for (let i = 1; i <= 11; i++) {
      addScore({ playerName: `P${i}`, score: i * 10, submittedAt: '' });
    }
    const board = getLeaderboard();
    expect(board.length).toBe(10);
    expect(board[0].score).toBe(110); // highest
    expect(board[9].score).toBe(20);  // 11th place (score 10) is dropped
  });
});

describe('GET /api/runs', () => {
  it('returns 200 and an array', async () => {
    const res = await request(app).get('/api/runs');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('includes entries added via addScore', () => {
    const { addScore, getAllRuns } = require('./app');
    addScore({ playerName: 'SRCH', score: 55, submittedAt: new Date().toISOString() });
    const runs = getAllRuns();
    expect(runs.some(r => r.playerName === 'SRCH')).toBe(true);
  });
});
