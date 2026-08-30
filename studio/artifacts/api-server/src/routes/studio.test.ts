import { strict as assert } from "node:assert";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import type { Server } from "node:http";
import path from "node:path";
import test, { after, before } from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  projectsTable,
  studioJobsTable,
} from "@workspace/db";
import {
  readStudioFile,
  saveAsset,
  studioOutputPath,
  stopStudioWorker,
} from "../lib/studio-worker.js";

const createdStudioJobIds: number[] = [];
const createdProjectIds: number[] = [];
let server: Server;
let baseUrl = "";

before(async () => {
  const { default: app } = await import("../app.js");
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

async function cleanup() {
  if (createdStudioJobIds.length) {
    await db.delete(studioJobsTable).where(inArray(studioJobsTable.id, createdStudioJobIds));
    createdStudioJobIds.length = 0;
  }
  if (createdProjectIds.length) {
    await db.delete(projectsTable).where(inArray(projectsTable.id, createdProjectIds));
    createdProjectIds.length = 0;
  }
}

after(async () => {
  stopStudioWorker();
  await cleanup();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(studioOutputPath(), { recursive: true, force: true });
  await pool.end();
});

async function request(pathname: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { response, body };
}

function jsonBody(body: unknown) {
  assert.ok(body && typeof body === "object" && !Buffer.isBuffer(body));
  return body as Record<string, unknown>;
}

test("rejects asset imports without explicit consent", async () => {
  const { response, body } = await request("/assets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "voice-profile",
      name: "Unconsented voice",
      mimeType: "audio/wav",
      data: Buffer.from("not imported").toString("base64"),
      consentGranted: false,
      consentSubject: "Test subject",
    }),
  });
  assert.equal(response.status, 400);
  assert.match(String(jsonBody(body).error), /Explicit consent is required/);
});

test("serves stored files inline while rejecting unknown and unsafe paths", async () => {
  const bytes = Buffer.from("private local asset");
  const filePath = await saveAsset(bytes, "private.wav", "audio/wav", "voice-profile");
  const filename = path.basename(filePath);

  const served = await request(`/files/${filename}`);
  assert.equal(served.response.status, 200);
  assert.equal(served.response.headers.get("content-type"), "audio/wav");
  assert.match(served.response.headers.get("content-disposition") ?? "", /inline/);
  assert.deepEqual(served.body, bytes);

  const missing = await request("/files/does-not-exist.wav");
  assert.equal(missing.response.status, 404);
  const traversal = await request("/files/%2E%2E%2Fprivate.wav");
  assert.equal(traversal.response.status, 404);
  assert.equal(await readStudioFile("../private.wav"), null);
});

test("cancels queued jobs and retries cancelled or failed jobs", async () => {
  const [cancelledJob] = await db.insert(studioJobsTable).values({
    kind: "voice",
    config: { text: "Cancel me" },
  }).returning();
  createdStudioJobIds.push(cancelledJob.id);
  const cancelled = await request(`/studio-jobs/${cancelledJob.id}/cancel`, { method: "POST" });
  const cancelledBody = jsonBody(cancelled.body);
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelledBody.status, "cancelled");
  assert.equal(cancelledBody.eta, null);

  const retriedCancelled = await request(`/studio-jobs/${cancelledJob.id}/retry`, { method: "POST" });
  const retriedCancelledBody = jsonBody(retriedCancelled.body);
  assert.equal(retriedCancelled.response.status, 202);
  assert.equal(retriedCancelledBody.status, "queued");
  assert.equal(retriedCancelledBody.progress, 0);
  assert.equal(retriedCancelledBody.outputPath, null);

  const [failedJob] = await db.insert(studioJobsTable).values({
    kind: "voice",
    status: "failed",
    progress: 48,
    error: "ffmpeg failed",
    outputPath: "/api/files/old.wav",
    config: { text: "Retry me" },
  }).returning();
  createdStudioJobIds.push(failedJob.id);
  const retriedFailed = await request(`/studio-jobs/${failedJob.id}/retry`, { method: "POST" });
  const retriedFailedBody = jsonBody(retriedFailed.body);
  assert.equal(retriedFailed.response.status, 202);
  assert.equal(retriedFailedBody.status, "queued");
  assert.equal(retriedFailedBody.progress, 0);
  assert.equal(retriedFailedBody.error, null);
  assert.equal(retriedFailedBody.outputPath, null);
});