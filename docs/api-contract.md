# Budget server API contract (v1)

The contract between the Home Assistant app (`budget-server`) and the browser client
(`src/data/apiRepository.ts`). Both are built against this document; neither may change it
unilaterally.

## Shape of the thing

The whole budget is **one JSON document**. It is small — a heavy year is a few thousand records,
well under a megabyte — and it belongs to one person. That makes a document store the right
answer rather than a row-per-record API: every write is atomic by construction, there are no
partial states to reason about, and the server needs no schema.

```jsonc
{
  "rev": 42,                 // integer, incremented by the server on every accepted write
  "data": {
    "months":     [ /* Month[] */ ],
    "expenses":   [ /* Expense[] */ ],
    "categories": [ /* Category[] */ ],
    "recurring":  [ /* RecurringExpense[] */ ],
    "sessions":   [ /* ReconciliationSession[] */ ],
    "settings":   { /* AppSettings | null */ }
  }
}
```

`data` is exactly the payload of the existing JSON backup minus its envelope, so export/restore
and the server speak the same shapes. The record types are the ones in `src/types/models.ts` and
are **not** the server's business — it stores and returns them verbatim, and validates only that
`data` is an object carrying those six keys.

## Endpoints

All paths are **relative to the page**, never absolute. Home Assistant Ingress serves the app
under a generated path prefix, so a leading slash would escape it.

### `GET api/health`

Cheap liveness probe. The client calls this at boot to decide which repository to use.

```json
{ "ok": true, "service": "budget-server", "version": "1.0.0", "rev": 42 }
```

### `GET api/state`

Returns the full document, as above. On a fresh install returns `rev: 0` and an empty `data`
(the client seeds default categories exactly as it does locally).

### `PUT api/state`

Replaces the document. Body:

```jsonc
{ "rev": 42, "data": { /* ... */ } }
```

`rev` is the revision the client believes it is updating. The server accepts the write only if it
matches the stored revision, then stores `rev + 1` and returns `{ "rev": 43 }`.

**On mismatch it returns HTTP 409** with the current document:

```jsonc
{ "error": "stale", "rev": 44, "data": { /* current */ } }
```

This is the whole concurrency story. Two tabs open on two devices can each write; the second one
to arrive is told it was working from a stale copy and hands back the current state. The client
re-applies its single pending mutation on top and retries once — see below.

### Errors

Every error is `{ "error": "<code>", "message": "<human sentence>" }` with a real status code:
`400` malformed body, `409` stale revision, `413` document over the size cap, `500` storage
failure. The client shows `message` verbatim, so write it for a person.

## Rules the client must follow

- **Never claim a write succeeded until the server says so.** No connection means no app here
  (the page is served by the same add-on), so there is no offline queue and nothing to reconcile
  — but a connection can still drop *mid-session*, and a save that failed must surface as failed.
- **One retry on 409, then surface it.** Re-apply the pending mutation onto the state the server
  returned and PUT again. If that also conflicts, stop and tell the user, rather than looping.
- **Reads come from the cached document**, which is refreshed on load and after every accepted
  write. The repository interface is synchronous-ish by design; this keeps it that way.

## Rules the server must follow

- **Atomic writes.** Write to a temp file in the same directory, `fsync`, then `rename` over the
  target. A half-written budget is worse than a lost one.
- **Persist under `/data`.** That is the directory Home Assistant's Supervisor backs up and
  preserves across add-on updates and restarts. Nothing durable goes anywhere else.
- **Keep the previous revision.** Before overwriting, move the current file to
  `budget.prev.json`. One generation is enough to recover from a bad client write and costs
  nothing at this size.
- **No dependencies.** Node's standard library only, matching the rest of this project.
- **Bind to all interfaces on the configured port** so Ingress can reach it, and serve the static
  app from `/app/www` at `/` with correct content types.
