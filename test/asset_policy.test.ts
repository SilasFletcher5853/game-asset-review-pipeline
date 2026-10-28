import assert from "node:assert/strict";
import test from "node:test";
import { assetUploadBody, decideAsset } from "../src/asset_policy.ts";

const base = {
  assetId: "asset_1042",
  playerId: "player_7",
  filename: "badge.png",
  contentType: "image/png" as const,
  imageBase64: "aW1hZ2U=",
};

test("a live event badge is quarantined for review even when pre-approved", () => {
  const asset = assetUploadBody.parse({
    ...base,
    kind: "live_event_badge",
    eventId: "event_finals",
    moderation: "approved",
  });

  assert.deepEqual(decideAsset(asset), {
    state: "queued_for_review",
    queue: "player-image-review",
    objectKey: "quarantine/events/event_finals/asset_1042.webp",
  });
});

test("an approved avatar is placed in the published player lane", () => {
  const asset = assetUploadBody.parse({ ...base, kind: "avatar", moderation: "approved" });
  assert.deepEqual(decideAsset(asset), {
    state: "published",
    queue: null,
    objectKey: "published/players/player_7/asset_1042.webp",
  });
});
