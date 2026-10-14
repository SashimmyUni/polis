# The archive keeps 2,000 tasks in full and folds older ones into counts

The archive keeps the project's newest 2,000 finished tasks in full (subject, district, verdict, when it was finished, its session); a task that falls off the end is not dropped but added to an exact count of finished work for its district. The archive is read back at the start of every session, so it has to stay small however long the project runs, and the full city draws each district's older work as an old town by count anyway, so the count is all it needs from a task that old.

## Considered Options

- Every finished task in full, forever: exact, but the archive and the full city's drawing grow without bound.
- A rolling window that drops old tasks: small, but the full city would forget work and shrink, which defeats a city that grows.

## Consequences

- The details of a very old task (its subject, its verdict) are gone for good; only its district's count remembers it.
- Changing the cap or the shape of an entry means migrating archives already saved in users' stores.
