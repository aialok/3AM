// Verifies the saved TrueForge agent end-to-end: session → turn → terminal state.
// Env-driven: TRUEFORGE_BASE_URL, TRUEFORGE_AGENT_NAME. No hardcoding.
import { TrueForge } from '@truefoundry/trueforge-sdk';

const client = new TrueForge({
  baseUrl: process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790',
  timeoutInSeconds: 600,
});

const agentName = process.env.TRUEFORGE_AGENT_NAME ?? 'three-am-investigator';

const { data: session } = await client.sessions.create({
  agent: { name: agentName },
});
console.log('session:', session.id);

const { data: turn } = await client.sessions.createTurn(session.id, {
  input: [{ type: 'user.message', content: 'Hello!' }],
});
console.log('turn:', turn.id, turn.state.status);

let latest = turn;
const deadline = Date.now() + 5 * 60 * 1000;
while (latest.state.status === 'running' && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 2000));
  ({ data: latest } = await client.sessions.getTurn(session.id, turn.id));
  console.log('poll:', latest.state.status);
}

console.log('final:', JSON.stringify(latest.state, null, 2));
if (latest.state.status !== 'done') process.exitCode = 1;
