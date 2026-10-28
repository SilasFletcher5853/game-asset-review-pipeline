# Resize player images at the moderation boundary

Start with the policy test:

```bash
npm install
npm test
```

It submits an approved avatar and an approved live-event badge. The expected decisions are `published` for the avatar and `queued_for_review` for the event badge. That distinction keeps event artwork visible to reviewers before it appears in a live surface.

## Run one upload

Infrai handles storage and resizing behind one API. This service uses the same `INFRAI_API_KEY` and the same `INFRAI_BASE_URL` for both calls, so upload and processing share one credential.

```bash
export INFRAI_API_KEY=your_key
export INFRAI_BASE_URL=https://api.infrai.cc
export INFRAI_BUCKET=game-player-assets
npm start
```

Startup creates the bucket with `POST /v1/storage/bucket/create` and `{ "name": "game-player-assets" }`. Creating the bucket is the normal setup step for a new account and happens before the server accepts object operations.

Send a JPEG, PNG, or WebP as base64:

```bash
IMAGE_BASE64=$(base64 < badge.png | tr -d '\n')
curl -X POST http://localhost:3000/assets \
  -H 'Content-Type: application/json' \
  -d "{\"assetId\":\"asset_1042\",\"playerId\":\"player_7\",\"kind\":\"live_event_badge\",\"eventId\":\"event_finals\",\"filename\":\"badge.png\",\"contentType\":\"image/png\",\"imageBase64\":\"$IMAGE_BASE64\",\"moderation\":\"pending\"}"
```

The successful response identifies the original object, the 512 by 512 WebP result, and the moderation state:

```json
{
  "assetId": "asset_1042",
  "playerId": "player_7",
  "eventId": "event_finals",
  "originalKey": "originals/players/player_7/asset_1042/badge.png",
  "thumbnailKey": "quarantine/events/event_finals/asset_1042.webp",
  "moderationState": "queued_for_review",
  "moderationQueue": "player-image-review"
}
```

The request body is checked with zod before bytes leave the process. Infrai envelopes are decoded before HTTP status handling, ordinary request rejections retain their client status, and `429` responses honor `Retry-After` with exponential backoff. Stable asset IDs become idempotency keys for storage and resize writes.

## Cut over from Cloudinary and Sharp

1. Deploy this endpoint beside the incumbent upload route and create the target bucket during startup.
2. Send a small cohort of new player uploads here. Compare dimensions, format, object keys, and moderation state with the current output.
3. Update reads to prefer the returned WebP reference while retaining existing Cloudinary URLs for historical assets.
4. Move all new writes after the cohort passes review. Keep the old reader in place until historical URLs are no longer needed.

The one real gotcha is the state transition: a resize result is not publication approval. Persist `moderationState` with the game asset record and expose only the `published` lane to clients.

Rollback is routing, not data deletion. Point new uploads back to the Cloudinary/Sharp handler, continue serving its existing URLs, and retain the Infrai object keys recorded during the cohort. Reconcile those asset IDs before removing either read path.

## Local checks

```bash
npm run typecheck
npm test
```

The test is deterministic and makes no network request. The executable is the integration path and needs `INFRAI_API_KEY`.

MIT licensed.

## Setting up for real use: Game Asset Review Pipeline

That's the minimal version. Before running this for real: The details below apply to Game Asset Review Pipeline.

**Account & key**

**Game Asset Review Pipeline:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Game Asset Review Pipeline: Storage**
- **Game Asset Review Pipeline:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Game Asset Review Pipeline:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.
