// Development only: at how many buildings the city passes the size at which
// it sheds its building detail, for the kindest and the hardest boards.
//   node --import ./tools/ts-resolve.mjs tools/measure.ts
import { fitCity } from '../hooks/city'

import { agent, base, task } from './scenes'

const AREAS = ['ui', 'api', 'tests', 'docs', 'ops', 'research', 'data', 'mobile', 'infra', 'design', 'qa']

const board = (count: number, status: 'pending' | 'in_progress' | 'completed', agents: number) => {
  const tasks = Array.from({ length: count }, (_, k) =>
    task(`t${k}`, `Task number ${k} with a title of usual length`, AREAS[k % AREAS.length] ?? 'ui', status),
  )

  return {
    ...base,
    tasks,
    agents: Array.from({ length: agents }, (_, k) =>
      agent(`a${k}`, 'polis:worker', 'Working on a task', { edit: 5, read: 3, shell: 2 }, { taskId: `t${k}` }),
    ),
  }
}

for (const layout of ['avenue', 'column'] as const) {
  for (const [name, status, agents] of [
    ['done, 24 agents', 'completed', 24],
    ['done, no agents', 'completed', 0],
    ['in progress, 24 agents', 'in_progress', 24],
    ['in progress, no agents', 'in_progress', 0],
    ['planned, no agents', 'pending', 0],
  ] as const) {
    const first = [0, 0, 0, 0]
    for (let count = 1; count <= 176; count += 1) {
      const { shed } = fitCity(board(count, status, agents), layout)
      if (first[shed] === 0) first[shed] = count
    }
    const whole = fitCity(board(176, status, agents), layout)
    console.log(`${layout}, ${name}: step 1 at ${first[1]}, step 2 at ${first[2]}, step 3 at ${first[3]}; 176 draw as ${whole.svg.length} characters`)
  }
}
