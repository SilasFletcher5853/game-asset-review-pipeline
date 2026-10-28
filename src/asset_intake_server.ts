import { createServer } from "node:http";
import { ZodError } from "zod";
import { assetUploadBody, decideAsset } from "./asset_policy.ts";
import { InfraiError, InfraiMediaClient } from "./infrai_media_client.ts";

const bucket = process.env.INFRAI_BUCKET ?? "game-player-assets";
const client = InfraiMediaClient.fromEnvironment();

async function start(): Promise<void> {
  await client.createBucket(bucket);

  createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/assets") {
      send(response, 404, { error: "Route not found" });
      return;
    }

    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const asset = assetUploadBody.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      const bytes = Buffer.from(asset.imageBase64, "base64");
      if (bytes.length === 0 || bytes.length > 8_000_000) throw new RangeError("Image must be between 1 byte and 8 MB");

      const decision = decideAsset(asset);
      const originalKey = `originals/players/${asset.playerId}/${asset.assetId}/${asset.filename}`;
      await client.putObject(bucket, originalKey, asset.imageBase64, asset.contentType, `original:${asset.assetId}`);
      const thumbnail = await client.resize(
        `data:${asset.contentType};base64,${asset.imageBase64}`,
        `thumbnail:${asset.assetId}`,
      );

      send(response, 201, {
        assetId: asset.assetId,
        playerId: asset.playerId,
        eventId: asset.eventId ?? null,
        originalKey,
        thumbnailKey: decision.objectKey,
        moderationState: decision.state,
        moderationQueue: decision.queue,
        thumbnail,
      });
    } catch (error) {
      const status = statusFor(error);
      send(response, status, {
        error: error instanceof InfraiError ? error.code : error instanceof Error ? error.message : "Request rejected",
      });
    }
  }).listen(Number(process.env.PORT ?? 3000), () => {
    console.log("game asset intake listening on http://localhost:3000");
  });
}

function statusFor(error: unknown): number {
  if (error instanceof InfraiError) return error.status >= 400 && error.status < 500 ? error.status : 502;
  if (error instanceof ZodError || error instanceof SyntaxError || error instanceof RangeError) return 400;
  return 502;
}

function send(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

start().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
