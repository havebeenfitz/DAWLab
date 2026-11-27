# DAWLab Hub: shared folders (spaces)

A **space** is a shared folder: a named set of projects plus the people who can
reach it. It replaces per-project edit/listen links as the way to share. The
older `/api/project` routes keep working for projects shared before spaces.

Everything is only reachable from the DAWLab app. The hub has no web pages:
without a valid key, token or invite code every request still gets the same
empty `404` (`Content-Length: 0`, `Connection: close`).

## Roles

| Role     | Projects: files, versions | Previews | Comments                     | Manage people and invites |
|----------|---------------------------|----------|------------------------------|---------------------------|
| `owner`  | read + write              | yes      | add; edit/delete any         | yes                       |
| `edit`   | read + write              | yes      | add; edit/delete own         | no                        |
| `listen` | no                        | yes      | add; edit/delete own         | no                        |

A space has exactly one owner, the member who created it.

## Tokens and storage

- Every member has their own token, sent as `X-Hub-Token` (or `Authorization: Bearer`).
- `tokens/<sha256(token)>.json` holds `{ "kind": "member", "spaceId", "memberId" }`. Legacy project tokens hold `{ projectId, role }` and keep working on the `/api/project` routes only.
- The member's role is read from `spaces/<spaceId>/members.json` on every request, so role changes and removals take effect at once. A removed member's token record is deleted.
- Space layout:

  ```
  spaces/<id>/meta.json      { id, name, createdAt, deleted? }
  spaces/<id>/members.json   [{ id, name, role, joinedAt, tokenHash }]
  spaces/<id>/invites.json   [{ id, codeHash, role, createdAt, expiresAt, maxUses, uses, createdBy }]
  spaces/<id>/projects.json  [{ id, name, daw, addedAt, addedBy }]
  invites/<codeHash>.json    { spaceId, inviteId }   (lookup index so a join finds its space)
  ```

- Project data stays at `projects/<projectId>/...`. Each project's `meta.json` gains `spaceId` and `updatedAt` (set on every log write; `projects[].updatedAt` comes from it).

## Invite codes

- Format: `DAWL-XXXX-XXXX-XXXX`. That is 12 Crockford base32 characters (`0-9 A-Z`, without `I L O U`), 60 random bits.
- Normalize before hashing: uppercase, strip everything except `[0-9A-Z]`, drop the `DAWL` prefix, map `I L` → `1` and `O` → `0`.
- Only `sha256(normalized)` is stored. Codes expire after 1–30 days (default 7) and allow 1–100 uses (default 10).
- An app link carries the hub address too: `dawlab://join?hub=<urlencoded hub origin>&code=<code>`.

## API

All bodies are JSON. Errors that a caller without access could use to probe the hub are the hidden empty `404`. Errors shown to a valid member are `{ "error": "<text a musician can read>" }`.

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/api/spaces` | `X-Hub-Key` | `{ name, memberName }` | `201 { space, me, token }`. The key is checked first (bad key: hidden 404); then a blank `name` or `memberName` is `400 { error }` with nothing created, so the app can use it as a "test connection". |
| GET | `/api/space` | member | – | `{ space, me, members, projects }` |
| GET | `/api/space/events` | member | – | `200 text/event-stream`, see [Change events](#change-events). |
| PATCH | `/api/space` | owner | `{ name }` | `{ space }` |
| DELETE | `/api/space` | owner | – | `204`. Deletes every member token and marks the space deleted. |
| PATCH | `/api/space/members/:memberId` | owner | `{ role: "edit" \| "listen" }` | `{ member }`. The owner's role can't be changed. |
| DELETE | `/api/space/members/:memberId` | owner, or the member themself (leaving) | – | `204`. The owner can't remove themself; they use `DELETE /api/space`. |
| GET | `/api/space/invites` | owner | – | `[{ id, role, expiresAt, maxUses, uses }]`. Codes are never returned again. |
| POST | `/api/space/invites` | owner | `{ role, expiresInDays?, maxUses? }` | `201 { id, code, role, expiresAt, maxUses }` |
| DELETE | `/api/space/invites/:inviteId` | owner | – | `204` |
| POST | `/api/join` | invite code in body | `{ code, memberName }` | `200 { space, me, token }`. A bad, expired or used-up code gets the hidden 404. Rate limited per IP: 10 failures per 15 minutes, then everything is the hidden 404 until the window passes. Malformed JSON is also the hidden 404. A valid code with a bad `memberName` is `400 { error }` and doesn't use the code up. |
| POST | `/api/invite/peek` | invite code in body | `{ code }` | `200 { space: { id, name }, role, invitedBy, projectCount, memberCount, expiresAt }` (`InvitePreview`). Doesn't use the code up. Anything else is the hidden 404; failed peeks count toward the same per-IP limit as `/api/join`. |
| POST | `/api/space/projects` | owner/edit | `{ log }` (same as the old create) | `201 { project: { id, name, daw, addedAt, addedBy } }` |
| DELETE | `/api/space/projects/:projectId` | owner | – | `204`. Removes the project from the space. |
| * | `/api/space/projects/:projectId/...` | member | – | Same sub-routes and semantics as `/api/project/...`: `GET ''`, `PUT log`, `POST objects/missing`, `PUT\|GET\|HEAD objects/:hash`, `PUT\|GET commits/:cid/filemap`, `GET\|POST commits/:cid/comments`. Write and filemap routes need owner/edit. `GET ''` returns `{ role, log }`, with `role` mapped `owner` → `edit`. |

Validation: `name` (space) is trimmed, 1–100 characters; `memberName` is trimmed, 1–60 characters. Invite `expiresInDays` and `maxUses` must be whole numbers in range or are `400`. `GET /api/space/invites` lists every invite the owner hasn't revoked, expired and used-up ones included (compare `expiresAt` and `uses`/`maxUses`).

Response shapes:

- `space` = `{ id, name, createdAt }`
- `me` = `{ id, name, role }`
- `members` = `[{ id, name, role, joinedAt }]`
- `projects` = `[{ id, name, daw, addedAt, addedBy, updatedAt }]`, where `updatedAt` is when that project's log was last written.

A project id that isn't in the caller's space is the hidden 404, exactly like a bad token.

## Change events

Apps don't poll. Each app keeps one `GET /api/space/events` stream open per shared folder, with its member token in `X-Hub-Token` (a bad token is the hidden 404, like everywhere else). The hub writes:

- `event: hello` once, when the stream opens.
- `event: change` with `data: { kind, projectId?, by }` when another member changed the folder. `kind` is `versions` (a `PUT log`), `projects` (a project added, renamed or deleted) or `space` (folder renamed, someone joined, a role changed, someone left or was removed). The member who made the change (`by`) doesn't get it.
- `event: closed`, then the end of the stream, when that member was removed or left, or the folder was deleted.
- A comment line `:` every 50 seconds as a heartbeat, so proxies keep the connection open and the app can tell a dead stream from a quiet one.

Events carry no content: the app fetches what changed with the usual routes. It reconnects with growing, jittered waits (2 s up to 5 min), treats 2 minutes without a byte as a dead stream, and after a reconnect looks once for anything it missed. At most 3 streams per member token stay open; a new one closes the oldest.

Comment rule in spaces: the server records which member wrote each comment and each reply (`authorMemberId`, set by the server and never taken from the body). A member may change or delete only their own comments and replies; the owner may change any. Anyone in the space, listeners included, may add comments and add replies to any comment. Changes the caller isn't allowed to make are dropped silently (the response is the merged list, so the client sees what stuck). Authorship never changes. The merge never removes entries, so a delete is a change: the client sends the comment or reply with a tombstone field (for example `deleted: true`), and the same rule applies.

Shared helpers in `shared/hub-protocol.ts`: `normalizeInviteCode`, `isInviteCode`, `formatInviteCode`, `buildJoinLink(hubUrl, code)` and `parseJoinLink(link)`, which returns `{ hubUrl, code }` with `code` already formatted as `DAWL-XXXX-XXXX-XXXX`.
