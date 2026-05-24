import { migrate } from '../db/migrate.js'
import { listFollowedProjectIds } from '../repositories/projectFlags.js'
import { syncProject } from '../services/syncProject.js'

migrate()

const ids = listFollowedProjectIds()
if (ids.length === 0) {
  console.log('no_followed_projects')
  process.exit(0)
}

let okCount = 0
let failCount = 0

for (const id of ids) {
  const result = await syncProject(id)
  if (result.ok) {
    okCount += 1
  } else {
    failCount += 1
  }
}

console.log(
  JSON.stringify(
    {
      okCount,
      failCount,
      total: ids.length,
      finishedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
)

