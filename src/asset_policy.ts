import { z } from "zod";

export const assetUploadBody = z.object({
  assetId: z.string().regex(/^[a-zA-Z0-9_-]{3,64}$/),
  playerId: z.string().regex(/^[a-zA-Z0-9_-]{3,64}$/),
  kind: z.enum(["avatar", "live_event_badge", "clan_banner"]),
  eventId: z.string().regex(/^[a-zA-Z0-9_-]{3,64}$/).optional(),
  filename: z.string().regex(/^[a-zA-Z0-9_.-]{1,100}$/),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  imageBase64: z.string().min(1),
  moderation: z.enum(["approved", "pending"]),
}).superRefine((asset, context) => {
  if (asset.kind === "live_event_badge" && !asset.eventId) {
    context.addIssue({ code: "custom", path: ["eventId"], message: "eventId is required for a live event badge" });
  }
});

export type AssetUpload = z.infer<typeof assetUploadBody>;
export type AssetDecision = {
  state: "published" | "queued_for_review";
  queue: "player-image-review" | null;
  objectKey: string;
};

export function decideAsset(asset: AssetUpload): AssetDecision {
  const needsReview = asset.moderation === "pending" || asset.kind === "live_event_badge";
  const scope = asset.eventId ? `events/${asset.eventId}` : `players/${asset.playerId}`;
  const lane = needsReview ? "quarantine" : "published";
  return {
    state: needsReview ? "queued_for_review" : "published",
    queue: needsReview ? "player-image-review" : null,
    objectKey: `${lane}/${scope}/${asset.assetId}.webp`,
  };
}
